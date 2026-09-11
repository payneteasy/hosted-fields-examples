/* Every request this page makes to its own server, and there are only two of them. The third
   thing the server hands over — window.CONFIG — arrives as a script tag instead, see
   src/shared/config. Nothing here talks to the gateway: the merchant's credentials and the
   RSA key that signs the gateway calls live in the Go process and nowhere else. */

export { getOrderStatus, type OrderStatusData } from './order';
export { postSale, type SaleRequest, type SaleResult } from './pay';
