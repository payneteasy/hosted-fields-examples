/**
 * The 3DS 2.0 fields the page is allowed to supply. Everything else the Sale needs — amount,
 * currency, redirect_url, hosted_fields_token, client_orderid — belongs to the server, so
 * `POST /pay` filters the request body against this list rather than merging it: a body naming
 * `amount` would otherwise have chosen what the payer is charged.
 *
 * The list lives next to browserInfo() on purpose. The page below sends exactly these, and a
 * field added to one and not the other is then hard to miss.
 */
export const BROWSER_FIELDS = [
  'customer_browser_info',
  'customer_browser_javascript_enabled',
  'customer_browser_java_enabled',
  'customer_browser_accept_language',
  'customer_browser_color_depth',
  'customer_browser_screen_width',
  'customer_browser_screen_height',
  'customer_browser_time_zone',
] as const;

/**
 * Keeps the allowed fields and drops everything else. The two header values are read from the
 * request, never from the body, so the caller cannot spoof them.
 */
export function pickBrowser(
  src: Record<string, string> | undefined,
  headers: Headers,
): Record<string, string> {
  const browser: Record<string, string> = {};
  for (const name of BROWSER_FIELDS) {
    const value = src?.[name];
    if (value !== undefined) {
      browser[name] = String(value);
    }
  }
  browser.customer_browser_accept_header = headers.get('accept') ?? '*/*';
  browser.customer_browser_user_agent = headers.get('user-agent') ?? '';
  return browser;
}

/** 3DS 2.0 browser data required by the Sale call. */
export function browserInfo(): Record<string, string> {
  return {
    customer_browser_info: 'true',
    customer_browser_javascript_enabled: 'true',
    customer_browser_java_enabled: String(
      typeof navigator.javaEnabled === 'function' && navigator.javaEnabled(),
    ),
    customer_browser_accept_language: navigator.language,
    customer_browser_color_depth: String(screen.colorDepth),
    customer_browser_screen_width: String(screen.width),
    customer_browser_screen_height: String(screen.height),
    customer_browser_time_zone: String(new Date().getTimezoneOffset()),
  };
}
