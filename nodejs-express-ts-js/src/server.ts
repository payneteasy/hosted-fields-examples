import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { SIGNED_CALLBACK_FIELDS, validCallback } from './callback.ts';
import { BASE_PATH, ENDPOINT_ID, LISTEN_ADDR, ORDER_AMOUNT, ORDER_CURRENCY, PORT, SDK_ORIGIN, SDK_URL } from './config.ts';
import { isJsonObject, type JsonObject, message, text } from './json.ts';
import { createSale, getEphemeralTicket, getStatus } from './paynet.ts';

// Assets sit next to the bundle in a build, and one level up from src/ in the repo
const here = dirname(fileURLToPath(import.meta.url));
const rootDir = existsSync(join(here, 'views')) ? here : join(here, '..');
const publicDir = join(rootDir, 'public');
const viewsDir = join(rootDir, 'views');
const app = express();
const router = express.Router();

// Behind nginx req.ip comes from X-Forwarded-For. The header is taken on trust, which is one of
// the reasons the app binds to loopback by default: exposed straight to the internet this would
// let any caller pick the address the gateway screens for fraud.
app.set('trust proxy', true);
app.use(express.json());
// The gateway posts the 3DS return as a form
app.use(express.urlencoded({ extended: false }));

// window.CONFIG as a script of its own: the only thing this server generates. Everything in
// views/ is served exactly as it is written, which is what lets those files be identical
// whatever language the example is in.
function sendConfigJS(res: Response, config: Record<string, string>): void {
  res
    .type('text/javascript')
    // The ticket inside is single-use, so this must never come from a cache
    .set('Cache-Control', 'no-store')
    .send(`window.CONFIG = ${JSON.stringify(config)};\n`);
}

/* What a payment page ought to send. The policy is worth reading as part of the example: the
   card fields are iframes from the gateway, so the SDK host has to be named in frame-src as well
   as in script-src, and everything else is denied by default.

   No 'unsafe-inline' anywhere, which is why the result page's script lives in public/result.js
   rather than in the markup: nothing in views/ is templated, so there is nowhere to put a nonce. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `script-src 'self' ${SDK_ORIGIN}`,
  "style-src 'self'",
  // The three card inputs are cross-origin iframes served by the gateway
  `frame-src ${SDK_ORIGIN}`,
  `connect-src 'self' ${SDK_ORIGIN}`,
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const sendView = (res: Response, name: string): void => {
  res
    .set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    .set('X-Content-Type-Options', 'nosniff')
    .set('Referrer-Policy', 'no-referrer')
    // The page carries the signed order parameters in its URL, and it is one payment's page
    .set('Cache-Control', 'no-store')
    .sendFile(join(viewsDir, name));
};

// The 3DS 2.0 fields the page is allowed to supply. Everything the Sale needs besides these —
// amount, currency, redirect_url, hosted_fields_token, client_orderid — is the server's own, so
// the request body is filtered here rather than merged: a body that named `amount` would
// otherwise have chosen what the payer is charged.
const BROWSER_FIELDS = [
  'customer_browser_info',
  'customer_browser_javascript_enabled',
  'customer_browser_java_enabled',
  'customer_browser_accept_language',
  'customer_browser_color_depth',
  'customer_browser_screen_width',
  'customer_browser_screen_height',
  'customer_browser_time_zone',
];

// The two headers below are read from the request, never from the body, so they cannot be spoofed
// by the caller. Unknown keys are dropped.
function pickBrowser(src: JsonObject, headers: IncomingHttpHeaders): Record<string, string> {
  const browser: Record<string, string> = {};
  for (const name of BROWSER_FIELDS) {
    if (src[name] !== undefined) browser[name] = String(src[name]);
  }
  browser.customer_browser_accept_header = headers.accept ?? '*/*';
  browser.customer_browser_user_agent = headers['user-agent'] ?? '';
  return browser;
}

// The gateway wants a plain address for fraud screening, not an IPv6-mapped loopback
function clientIp(req: Request): string {
  const ip = req.ip ?? '';
  if (ip === '::1') return '127.0.0.1';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

// req.query values are strings, arrays or nested objects, so a parameter that must be a single
// string is read as one. The JavaScript example passes ?orderId=a&orderId=b straight through.
function queryValue(req: Request, name: string): string {
  const value = req.query[name];
  return typeof value === 'string' ? value : '';
}

router.get('/', (_req: Request, res: Response) => sendView(res, 'checkout.html'));

// Step 1. A fresh ephemeralTicket per page load: it is single-use.
router.get('/config.js', async (_req: Request, res: Response) => {
  const config: Record<string, string> = {
    basePath: BASE_PATH,
    sdkUrl: SDK_URL,
    endpointId: ENDPOINT_ID,
    // The page shows what the server will actually charge
    amount: ORDER_AMOUNT,
    currency: ORDER_CURRENCY,
  };

  try {
    config.ephemeralTicket = await getEphemeralTicket();
  } catch (error) {
    // This has to stay valid JavaScript whatever happened upstream, or the page cannot even
    // tell the payer that it did. checkout.js reads the absent ticket as terminal.
    console.error('[error]', message(error));
    config.error = message(error);
  }

  sendConfigJS(res, config);
});

// The 3DS return page needs no ticket: there is no card on it to tokenize.
router.get('/result-config.js', (_req: Request, res: Response) =>
  sendConfigJS(res, { basePath: BASE_PATH, amount: ORDER_AMOUNT, currency: ORDER_CURRENCY }),
);

// Step 3. The page sends the hostedFieldsToken here, the server initiates the payment.
router.post('/pay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // express.json() hands back `any`. Narrowing it here is the whole point of the example:
    // every field below is checked rather than declared.
    const body: unknown = req.body;
    if (!isJsonObject(body)) return res.status(400).json({ error: 'a JSON body is required' });

    const hostedFieldsToken = text(body, 'hostedFieldsToken');
    if (!hostedFieldsToken) return res.status(400).json({ error: 'hostedFieldsToken is required' });

    // Random rather than clock-based: the page hands this back on every /status poll, so an id
    // that can be guessed would make somebody else's order readable — and two payers in the
    // same millisecond would have collided.
    const clientOrderId = `hf-${randomUUID()}`;
    const sale = await createSale({
      hostedFieldsToken,
      clientOrderId,
      customer: isJsonObject(body.customer) ? body.customer : {},
      ipaddress: clientIp(req),
      browser: pickBrowser(isJsonObject(body.browser) ? body.browser : {}, req.headers),
    });

    // clientOrderId last: it is the server's, and a gateway field of the same name must not win
    res.json({ ...sale, clientOrderId });
  } catch (error) {
    next(error);
  }
});

// Order status, polled by the page every few seconds until a final status
router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = queryValue(req, 'orderId');
    const clientOrderId = queryValue(req, 'clientOrderId');
    if (!orderId || !clientOrderId) return res.status(400).json({ error: 'orderId and clientOrderId are required' });
    res.set('Cache-Control', 'no-store').json(await getStatus({ orderId, clientOrderId }));
  } catch (error) {
    next(error);
  }
});

function resultUrl(callback: JsonObject): string {
  const signed = new URLSearchParams();
  for (const name of SIGNED_CALLBACK_FIELDS) {
    if (callback[name]) signed.set(name, text(callback, name));
  }
  const query = signed.toString();
  return `${BASE_PATH}/result${query ? `?${query}` : ''}`;
}

// Step 5. Where the gateway returns the payer after a 3DS challenge, with a POST. It is not a
// page, because a page cannot be delivered by POST and still be reloadable: the signature is
// checked here and the payer is sent on to /result with the same signed parameters in the
// query. The browser carries them, but it cannot forge them — it does not know
// MERCHANT_CONTROL — and /result checks them again before it serves anything.
router.post('/result/callback', (req: Request, res: Response) => {
  const body: unknown = req.body;
  const callback = isJsonObject(body) ? body : {};
  if (!validCallback(callback)) {
    console.error('[error] callback signature mismatch for order', text(callback, 'orderid'));
    return res.status(403).type('text').send('invalid callback signature');
  }
  // 303, so the browser follows with a GET whatever it arrived with
  res.redirect(303, resultUrl(callback));
});

// A GET here is nobody arriving from a payment; send them to the empty page.
router.get('/result/callback', (_req: Request, res: Response) => res.redirect(303, resultUrl({})));

// The 3DS return page. The callback carries the outcome too, but the documentation says not to
// treat it as the status — the page looks the order up over the API instead.
router.get('/result', (req: Request, res: Response) => {
  // The query is only there when the payer came through the callback. Rechecking it here is
  // what stops a hand-edited URL: without it the page would happily poll somebody else's
  // order. No query at all is fine — the page then says there is nothing to show.
  if (req.query.orderid && !validCallback(req.query)) {
    console.error('[error] result signature mismatch for order', queryValue(req, 'orderid'));
    return res.status(403).type('text').send('invalid result signature');
  }
  sendView(res, 'result.html');
});

router.use(express.static(publicDir));

// Keeps the relative asset URLs on the payment page working
app.use((req: Request, res: Response, next: NextFunction) => (req.originalUrl === BASE_PATH ? res.redirect(`${BASE_PATH}/`) : next()));
app.use(BASE_PATH, router);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', message(error));
  res.status(502).json({ error: message(error) });
});

app.listen(PORT, LISTEN_ADDR, () => console.log(`Listening on http://${LISTEN_ADDR}:${PORT}${BASE_PATH}/`));
