// Everything here runs in the browser. There is no other kind of file in this project: the
// server is a Go process next door, and the only things that cross between them are the two
// requests in src/shared/api and the window.CONFIG script in src/shared/config.

export { browserInfo } from './browser-info';
export {
  CUSTOMER_FIELDS,
  type Customer,
  type CustomerFieldId,
  type CustomerProblems,
  type CustomerValues,
  cardPrintedName,
  EMPTY_CUSTOMER,
  validateCustomer,
} from './customer';
export { fieldStyle } from './field-style';
export { statusAmount, statusCard, statusPick } from './status-format';
export { applyStoredTheme, readStoredTheme, systemTheme, THEME_KEY, type Theme } from './theme';
export { type Order, useOrderStatus } from './use-order-status';
export { useTheme } from './use-theme';
