import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BASE_PATH, ENDPOINT_ID, MERCHANT_CONTROL, ORDER_AMOUNT, ORDER_CURRENCY, PORT, SDK_URL } from './config.js';
import { createSale, getEphemeralTicket, getStatus } from './paynet.js';

// Assets sit next to the bundle in a build, and one level up from src/ in the repo
const here = dirname(fileURLToPath(import.meta.url));
const rootDir = existsSync(join(here, 'views')) ? here : join(here, '..');
const publicDir = join(rootDir, 'public');
const viewsDir = join(rootDir, 'views');
const app = express();
const router = express.Router();

app.set('trust proxy', true); // behind nginx req.ip comes from X-Forwarded-For
app.use(express.json());
// The gateway posts the 3DS return as a form
app.use(express.urlencoded({ extended: false }));

// Anchored to the real line: the comment above it names the placeholder too, and
// a plain replace() would substitute that one instead. (Go strips HTML comments,
// so its copy never hits this.)
const CONFIG_LINE = /^ {2}<script>window\.CONFIG = __CONFIG__;<\/script>$/m;

function renderPage(name, config) {
  const page = readFileSync(join(viewsDir, name), 'utf8');
  if (!CONFIG_LINE.test(page)) throw new Error(`${name} has no config injection line`);
  return page.replace(CONFIG_LINE, `  <script>window.CONFIG = ${JSON.stringify(config)};</script>`);
}

// The gateway wants a plain address for fraud screening, not an IPv6-mapped loopback
function clientIp(req) {
  const ip = req.ip ?? '';
  if (ip === '::1') return '127.0.0.1';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

// Payment page. A fresh ephemeralTicket is issued per page load: it is single-use.
router.get('/', async (req, res, next) => {
  try {
    const config = {
      basePath: BASE_PATH,
      sdkUrl: SDK_URL,
      endpointId: ENDPOINT_ID,
      ephemeralTicket: await getEphemeralTicket(),
      // The page shows what the server will actually charge
      amount: ORDER_AMOUNT,
      currency: ORDER_CURRENCY,
    };
    res.type('html').send(renderPage('checkout.html', config));
  } catch (error) {
    next(error);
  }
});

// Step 3. The page sends the hostedFieldsToken here, the server initiates the payment.
router.post('/pay', async (req, res, next) => {
  try {
    const { hostedFieldsToken, browser, customer } = req.body;
    if (!hostedFieldsToken) return res.status(400).json({ error: 'hostedFieldsToken is required' });

    const clientOrderId = `hf-${Date.now()}`;
    const sale = await createSale({
      hostedFieldsToken,
      clientOrderId,
      customer,
      ipaddress: clientIp(req),
      browser: {
        ...browser,
        customer_browser_accept_header: req.headers.accept ?? '*/*',
        customer_browser_user_agent: req.headers['user-agent'] ?? '',
      },
    });

    res.json({ clientOrderId, ...sale });
  } catch (error) {
    next(error);
  }
});

// Order status, polled by the page every few seconds until a final status
router.get('/status', async (req, res, next) => {
  try {
    const { orderId, clientOrderId } = req.query;
    if (!orderId || !clientOrderId) return res.status(400).json({ error: 'orderId and clientOrderId are required' });
    res.set('Cache-Control', 'no-store').json(await getStatus({ orderId, clientOrderId }));
  } catch (error) {
    next(error);
  }
});

// The checksum the gateway signs its callbacks with
// https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html
function validCallback({ status = '', orderid = '', merchant_order = '', control = '' }) {
  const expected = createHash('sha1').update(`${status}${orderid}${merchant_order}${MERCHANT_CONTROL}`).digest('hex');
  return control.length === expected.length && timingSafeEqual(Buffer.from(control), Buffer.from(expected));
}

// Where the payer lands after a 3DS challenge. The gateway returns the payer with a
// POST whose parameters are signed, so the order is taken from there — the browser is
// never asked to carry it across the redirect.
router.all('/result', (req, res) => {
  const page = { basePath: BASE_PATH, amount: ORDER_AMOUNT, currency: ORDER_CURRENCY };

  if (req.method === 'POST') {
    if (!validCallback(req.body)) {
      console.error('[error] callback signature mismatch for order', req.body.orderid);
      return res.status(403).type('text').send('invalid callback signature');
    }
    // The callback carries the outcome too, but the documentation says not to treat it
    // as the status — the order is looked up over the API instead.
    page.orderId = req.body.orderid;
    page.clientOrderId = req.body.merchant_order;
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.sendStatus(405);
  }

  res.type('html').send(renderPage('result.html', page));
});

router.use(express.static(publicDir));

// Keeps the relative asset URLs on the payment page working
app.use((req, res, next) => (req.originalUrl === BASE_PATH ? res.redirect(`${BASE_PATH}/`) : next()));
app.use(BASE_PATH, router);

app.use((error, _req, res, _next) => {
  console.error('[error]', error.message);
  res.status(502).json({ error: error.message });
});

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}${BASE_PATH}/`));
