/**
 * The order summary. The amount is the first thing on the page: the payer is here to confirm
 * a number, not to admire a form. It is formatted on the server from the same settings the
 * Sale will use, so what the payer confirms is what the server charges.
 */
export function OrderSummary({ amount, orderRef }: { amount: string; orderRef?: string }) {
  return (
    <div className="pay-summary">
      <div>
        <span className="pay-summary__merchant">Northwind Supply</span>
        <span className="pay-summary__order" id="orderRef">
          {orderRef ?? 'Hosted Fields example order'}
        </span>
      </div>
      <div className="pay-summary__total">
        <span className="pay-summary__label">Total</span>
        <span className="pay-summary__amount" id="orderAmount">
          {amount}
        </span>
      </div>
    </div>
  );
}
