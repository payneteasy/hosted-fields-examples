// The test-only control surface. Nothing the three applications know about.

import type { ServerResponse } from 'node:http';
import { sendJson } from './http.ts';
import { isScenario } from './scenarios.ts';
import { reset, setPendingScenario } from './state.ts';

export function setScenario(response: ServerResponse, body: string): void {
  let name: unknown;
  try {
    name = (JSON.parse(body) as { scenario?: unknown }).scenario;
  } catch {
    sendJson(response, 400, { error: 'malformed control request' });
    return;
  }

  if (!isScenario(name)) {
    sendJson(response, 400, { error: `unknown scenario ${String(name)}` });
    return;
  }

  setPendingScenario(name);
  sendJson(response, 200, { scenario: name });
}

export function resetState(response: ServerResponse): void {
  reset();
  sendJson(response, 200, { reset: true });
}
