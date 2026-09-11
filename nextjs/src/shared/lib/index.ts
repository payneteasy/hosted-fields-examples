// The client-safe half of shared/lib. oauth.ts, paynet.ts and callback.ts are server-only —
// they reach for node:crypto and node:fs — and are imported straight from src/app/**.

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
export {
  type OrderStatusData,
  statusAmount,
  statusCard,
  statusPick,
} from './status-format';
export { THEME_BOOTSTRAP, THEME_KEY } from './theme';
export { type Order, useOrderStatus } from './use-order-status';
export { type Theme, useTheme } from './use-theme';
