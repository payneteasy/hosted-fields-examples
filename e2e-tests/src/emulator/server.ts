// The fake gateway: one origin serving both the API the servers call and the SDK the browser
// loads. They have to share an origin — the examples build their Content-Security-Policy from
// SDK_URL, and `script-src` / `frame-src` / `connect-src` name exactly that host.

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { EMULATOR_ORIGIN, PROJECT_ROOT } from '../settings.ts';
import { challengePage } from './acs.ts';
import { resetState, setScenario } from './control.ts';
import { createEphemeralTicket, gatewayCommand, sale, status } from './gateway.ts';
import { formParams, readBody, sendJson, sendText } from './http.ts';
import { verifyOAuth } from './oauth-verify.ts';
import { tokenize } from './tokenize.ts';

const SDK_DIR = join(PROJECT_ROOT, 'src', 'sdk');

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/sdk.js': {
    file: 'hosted-fields.js',
    type: 'application/javascript; charset=utf-8',
  },
  '/hf/field.js': {
    file: 'field.js',
    type: 'application/javascript; charset=utf-8',
  },
  '/hf/field.css': { file: 'field.css', type: 'text/css; charset=utf-8' },
};

function serveStatic(response: ServerResponse, entry: { file: string; type: string }): void {
  // Read per request rather than at startup: editing the shim and reloading the page is how you
  // debug the browser half, and a cached copy would quietly serve the old one.
  const body = readFileSync(join(SDK_DIR, entry.file), 'utf8');
  response.writeHead(200, {
    'content-type': entry.type,
    'cache-control': 'no-store',
  });
  response.end(body);
}

/** The card fields live on this origin; the page that tokenizes them does not. */
function allowCrossOrigin(response: ServerResponse, origin: string | undefined): void {
  response.setHeader('access-control-allow-origin', origin ?? '*');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  response.setHeader('vary', 'Origin');
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', EMULATOR_ORIGIN);
  const path = url.pathname;
  const method = request.method ?? 'GET';

  if (method === 'GET' && STATIC_FILES[path]) {
    serveStatic(response, STATIC_FILES[path]);
    return;
  }

  // The three card fields. Each is a document of its own on this origin.
  if (method === 'GET' && path.startsWith('/hf/')) {
    const page = readFileSync(join(SDK_DIR, 'field.html'), 'utf8');
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(page);
    return;
  }

  if (method === 'GET' && path === '/acs') {
    challengePage(response, url.searchParams.get('order') ?? '');
    return;
  }

  // The fake SDK calls this with fetch from the merchant page, so it is cross-origin and the
  // JSON content type makes the browser send a preflight first. The real gateway answers both;
  // without this the tokenize call never leaves the browser and the payment silently stops.
  if (path === '/api/v4/tokenize/hosted-fields') {
    allowCrossOrigin(response, request.headers.origin);
    if (method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (method === 'POST') {
      tokenize(response, await readBody(request));
      return;
    }
  }

  if (method === 'POST' && path === '/__control/scenario') {
    setScenario(response, await readBody(request));
    return;
  }
  if (method === 'POST' && path === '/__control/reset') {
    resetState(response);
    return;
  }
  if (method === 'GET' && path === '/__control/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  const command = gatewayCommand(path);
  if (method === 'POST' && command) {
    const params = formParams(await readBody(request));

    // Every server call is signed. Verifying it here is the only place the bytes actually on
    // the wire are checked against the key — the unit tests in go-js and nodejs-express-js only
    // check each signer against a fixed base string.
    const signature = verifyOAuth(
      method,
      EMULATOR_ORIGIN + path,
      params,
      request.headers.authorization,
    );
    if (!signature.ok) {
      // Plain text, not JSON, and deliberately so: a JSON body would be decoded by the apps as
      // an ordinary gateway reply and reach the payer as a decline. A body that is not JSON at
      // all is the one thing they treat as a failed call, which is what a bad signature is.
      console.error('[emulator] %s rejected: %s', path, signature.reason);
      sendText(response, 401, `invalid signature: ${signature.reason}`);
      return;
    }

    if (command === 'tokenize/create-ephemeral-ticket') {
      createEphemeralTicket(response);
      return;
    }
    if (command === 'sale') {
      sale(response, params);
      return;
    }
    if (command === 'status') {
      status(response, params);
      return;
    }
  }

  sendText(response, 404, `no route for ${method} ${path}`);
}

export function createEmulator(): Server {
  return createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      console.error('[emulator] unhandled error', error);
      if (!response.headersSent) {
        sendText(response, 500, 'emulator error');
      } else {
        response.end();
      }
    });
  });
}
