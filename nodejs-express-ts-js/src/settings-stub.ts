// config.ts validates the settings when it is imported, and both modules under test reach it
// through the import graph. Tests do not sign anything and do not call the gateway, so the values
// only have to be present — except MERCHANT_CONTROL, which the callback checksum is built from.
export const MERCHANT_CONTROL = 'test-merchant-control';

export function stubSettings(): void {
  process.env.API_URL ??= 'https://gateway.example/paynet';
  process.env.SDK_URL ??= 'https://gateway.example/assets/hosted-fields.js';
  process.env.ENDPOINT_ID ??= '1234567';
  process.env.MERCHANT_LOGIN ??= 'test-merchant';
  process.env.MERCHANT_CONTROL ??= MERCHANT_CONTROL;
  process.env.PRIVATE_KEY ??= 'not a key: nothing here signs anything';
}
