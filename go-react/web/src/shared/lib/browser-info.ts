/**
 * 3DS 2.0 browser data, required by the Sale call.
 *
 * The server filters these against a fixed list of eight names before they go anywhere near
 * the gateway — see browserFields in main.go — and adds the Accept and User-Agent headers
 * itself, from the request rather than from the body, so a caller cannot spoof them.
 * Everything else the Sale needs is the server's: a body naming `amount` would otherwise have
 * chosen what the payer is charged.
 */
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
