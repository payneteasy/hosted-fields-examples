// What the fake gateway does with a payment.
//
// A scenario is chosen by the test over /__control/scenario before the page loads, and is then
// bound into the ephemeral ticket the page is rendered with. Everything downstream — the token,
// the sale, the order — carries it along, so a flow already in progress cannot be changed out
// from under itself by the next test.

export const SCENARIOS = [
  /** The card is charged and the first status poll already says so. */
  'approved',
  /** The sale is accepted, the bank says no. */
  'declined',
  /** The bank wants a 3DS challenge: the payer is sent to the ACS page and comes back approved. */
  'threeds',
  /** The gateway refuses to mint an ephemeral ticket, so the page never gets one. */
  'no-ticket',
  /** The Sale itself is rejected, with an error-message and no order id. */
  'sale-error',
] as const;

export type Scenario = (typeof SCENARIOS)[number];

export const DEFAULT_SCENARIO: Scenario = 'approved';

export function isScenario(value: unknown): value is Scenario {
  return typeof value === 'string' && (SCENARIOS as readonly string[]).includes(value);
}
