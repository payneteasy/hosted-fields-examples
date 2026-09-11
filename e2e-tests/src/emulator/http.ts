// Small helpers over node:http. The emulator has no framework on purpose: it is a test double,
// and a dependency here would be one more thing to explain.

import type { IncomingMessage, ServerResponse } from 'node:http';

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function formParams(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    out[key] = value;
  }
  return out;
}

/**
 * The gateway answers JSON because the caller asked for it with
 * `Accept: application/vnd.pay+json`. A rejected request is a 4xx *with a JSON body* carrying
 * error-message — the apps decode the body whatever the status, and only a reply that is not
 * JSON at all counts as a failed call.
 */
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/vnd.pay+json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(text);
}

export function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
}

export function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}
