// The boundary where a type system stops helping, and the only module the JavaScript example
// next door does not have.
//
// JSON.parse is typed `any`, and so is req.body. Writing `as SaleResponse` over either would
// type-check and would be a lie: the gateway's reply and the page's request are the two values
// in this app that are not ours to promise anything about. So both arrive as `unknown` and come
// through these three functions, which check at runtime what the annotation would only have
// claimed.

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A field as the gateway sends it, or '' when it is absent. Same coercion the JavaScript
// example does inline with String(source[name] ?? '').
export function text(source: JsonObject, name: string): string {
  const value = source[name];
  return value === undefined || value === null ? '' : String(value);
}

// Express's catch clauses are `unknown` under strict, and so is anything fetch rejects with.
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
