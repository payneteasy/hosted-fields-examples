/* window.CONFIG — everything the browser half is told -----------------------

   The Go server writes this as a script of its own, GET {prefix}/config.js, with
   Cache-Control: no-store because the ticket inside is single-use, and the HTML templates
   load it ahead of the bundle. It is the one generated thing in this example.

   Nothing else reaches this build. There is no PUBLIC_* variable inlined at compile time, so
   dist/ holds no endpoint id, no gateway host and no prefix: change a setting, restart the
   server, reload the page. That is also why a credential cannot end up in a file a payer
   downloads — the bundle has nowhere to put one.                                          */

/** What the payment page is handed. The server builds it in handleConfigJS. */
export interface CheckoutConfig {
  basePath: string;
  sdkUrl: string;
  endpointId: string;
  /** Empty when the ticket call failed. The page then says so and the button stays dead. */
  ephemeralTicket: string;
  /** Why there is no ticket. For the log only — never shown to the payer. */
  error?: string;
  amount: string;
  currency: string;
}

/** What the 3DS return page is handed: no ticket, because there is no card on it. */
export interface ResultConfig {
  basePath: string;
  amount: string;
  currency: string;
}

declare global {
  interface Window {
    /** Written by {prefix}/config.js and {prefix}/result-config.js, never by this bundle. */
    CONFIG?: Partial<CheckoutConfig>;
  }
}

/**
 * config.js is a blocking script in the template, so by the time this bundle runs it has
 * either set window.CONFIG or failed to load. Failing to load is treated the same way a
 * failed ticket call is: the page renders and says it cannot take a payment.
 */
export function checkoutConfig(): CheckoutConfig {
  const config = window.CONFIG ?? {};
  return {
    basePath: config.basePath ?? '',
    sdkUrl: config.sdkUrl ?? '',
    endpointId: config.endpointId ?? '',
    ephemeralTicket: config.ephemeralTicket ?? '',
    error: config.error ?? (window.CONFIG ? undefined : 'config.js did not load'),
    amount: config.amount ?? '',
    currency: config.currency ?? '',
  };
}

export function resultConfig(): ResultConfig {
  const config = window.CONFIG ?? {};
  return {
    basePath: config.basePath ?? '',
    amount: config.amount ?? '',
    currency: config.currency ?? '',
  };
}
