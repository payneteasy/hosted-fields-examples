'use client';

import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  browserInfo,
  type CustomerProblems,
  type CustomerValues,
  cardPrintedName,
  EMPTY_CUSTOMER,
  fieldStyle,
  type Order,
  type OrderStatusData,
  statusAmount,
  useOrderStatus,
  useTheme,
  validateCustomer,
} from '@/shared/lib';
import { FIELD_IDS, HostedField } from './hosted-field';
import { OrderSummary } from './order-summary';
import { StatusPanel } from './status-panel';
import { ThemeToggle } from './theme-toggle';

/** What the server hands the page. The same values the other two examples inject as
 *  `window.CONFIG`, passed as props instead. */
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

/* Errors -------------------------------------------------------------------
   There is no per-field validity: the SDK sets .hf-field--error on all three
   at once, so the message has to say which value to look at. Two flavours —
   `retry` leaves the button live, the terminal ones do not, because the
   session is gone and only a reload can help.                               */

type ErrorKind = 'retry' | 'rejected' | 'spent' | 'network' | 'unavailable';

const ERROR_COPY: Record<ErrorKind, string> = {
  retry:
    'Your card was declined by the issuing bank. Check the number, expiry and CVV, or try another card.',
  rejected:
    'That card number was not accepted. Check the digits, then reload the page to start a new payment.',
  spent: 'This payment session has already been used. Reload the page to try again.',
  network: 'We could not reach the payment gateway. Check your connection and try again.',
  unavailable: 'This page could not be prepared for a payment. Reload it to try again.',
};

/** Errors the button cannot come back from. Two of them burn the ephemeralTicket, so a retry
 *  would need one this page no longer has; `unavailable` means the page never got one at all.
 *  This table and ERROR_COPY above are the plain-JS ones ported — shared/public/checkout.js is
 *  the other copy, and the payer must read the same words in both. */
const TERMINAL_ERRORS: Partial<Record<ErrorKind, string>> = {
  rejected: 'Reload to try again',
  spent: 'Payment session closed',
  unavailable: 'Reload to try again',
};

export function CheckoutForm({ config }: { config: CheckoutConfig }) {
  const [values, setValues] = useState<CustomerValues>(EMPTY_CUSTOMER);
  const [problems, setProblems] = useState<CustomerProblems>({});
  const [ready, setReady] = useState(false);
  const [formError, setFormError] = useState<{ kind: ErrorKind; text: string } | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [theme, setTheme] = useTheme();

  const sdk = useRef<HostedFieldsInstance | null>(null);
  const started = useRef(false);
  const cardholderTouched = useRef(false);
  const caret = useRef<number | null>(null);
  const cardholderInput = useRef<HTMLInputElement>(null);
  // The SDK callbacks are created once and outlive every render, so the values they send have
  // to be read from a ref rather than captured.
  const latestValues = useRef(values);
  latestValues.current = values;

  const polled = useOrderStatus(order);
  const money = statusAmount({ amount: config.amount, currency: config.currency });
  const payLabel = money ? `Pay ${money}` : 'Pay';
  const terminal = formError ? TERMINAL_ERRORS[formError.kind] : undefined;

  const showFormError = useCallback((kind: ErrorKind, message?: string) => {
    setFormError({ kind, text: message || ERROR_COPY[kind] });
    setInFlight(false);
  }, []);

  /* The error ring is added with classList, not with a rendered className: the SDK toggles
     hf-field--focus / --filled on these same elements, and a className React computes would
     overwrite them on the next render. */
  useEffect(() => {
    for (const id of FIELD_IDS) {
      document.getElementById(id)?.classList.toggle('hf-field--error', formError !== null);
    }
  }, [formError]);

  /* Step 2. Load the SDK and create the fields. Once: React 19 runs an effect twice in
     development StrictMode, and the SDK must not be initialised twice. Nothing is destroyed
     on cleanup for the same reason — the fields live as long as the document does, and this
     page never unmounts them. */
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    /* The ticket is the one thing the server generates for this page. When the gateway call
       behind it failed there is nothing to tokenize with, so say so and do not load an SDK that
       could not be used anyway. Terminal either way — only a reload can produce a new ticket. */
    if (!config.ephemeralTicket) {
      // The reason is for the log, the way error.message is: what the payer is shown says what
      // they can do about it, and "fetch failed" does not.
      console.error(`[HostedFields] no ephemeralTicket: ${config.error || 'reason unknown'}`);
      showFormError('unavailable');
      return;
    }

    const style = fieldStyle();

    window.onHostedFieldsReady = (HostedFields) => {
      sdk.current = HostedFields.init({
        endpointId: config.endpointId,
        // The ids of the containers double as the keys of the fields map.
        fields: {
          cardNumber: { type: 'pan', placeholder: '1234 1234 1234 1234', style },
          expiryDate: { type: 'exp', style },
          cvv: { type: 'cvv', style },
        },
        onReady: () => setReady(true),
        onToken: sendTokenToServer,
        onError: showError,
      });
    };

    // The SDK must be loaded from the gateway host with a classic script tag.
    const script = document.createElement('script');
    script.src = config.sdkUrl;
    script.async = true;
    script.onerror = () => {
      console.error(`[HostedFields] the SDK bundle failed to load from ${config.sdkUrl}`);
      showFormError('unavailable');
    };
    document.head.appendChild(script);

    // Step 3. Only the token reaches our server, never the card data.
    async function sendTokenToServer(hostedFieldsToken: string) {
      console.log('[HostedFields] token received');

      try {
        const response = await fetch(`${config.basePath}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostedFieldsToken,
            browser: browserInfo(),
            customer: validateCustomer(latestValues.current).customer,
          }),
        });
        const sale = (await response.json()) as Record<string, unknown>;

        if (!sale['paynet-order-id']) {
          showFormError('retry', String(sale['error-message'] ?? sale.error ?? ''));
          return;
        }
        setOrder({
          basePath: config.basePath,
          orderId: String(sale['paynet-order-id']),
          clientOrderId: String(sale.clientOrderId),
        });
      } catch (error) {
        showFormError('network', (error as Error).message);
      }
    }

    // message and tip are for the log, payerMessage is the only part safe to show to the payer
    function showError(error: HostedFieldsError) {
      console.error(`[HostedFields] ${error.code}: ${error.message}`, error.tip, error.field);

      // The whole 4xxx class spends the ephemeralTicket, so any retry needs a new one. 4004 is
      // the everyday case — a mistyped card — and saying "this session has already been used"
      // for a wrong digit only confuses the payer.
      const spentTicket = error.code >= 4000 && error.code < 5000;
      const kind: ErrorKind = error.code === 4004 ? 'rejected' : spentTicket ? 'spent' : 'retry';
      showFormError(kind, spentTicket ? undefined : error.payerMessage);
    }
  }, [config, showFormError]);

  /* CSS handles the container. The iframes get nothing from a media query or a class, so
     every theme change has to be pushed field by field — and after the attribute is on
     <html>, or fieldStyle() would read the old values back. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: theme is the trigger, not an input
  useEffect(() => {
    if (!sdk.current) {
      return;
    }
    const style = fieldStyle();
    for (const id of FIELD_IDS) {
      sdk.current.setStyle(id, style);
    }
  }, [theme]);

  /* Upper-casing is one-for-one, so the caret index does not move — but React rewrites the
     value, which drops it to the end. Put it back. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the value is the trigger
  useLayoutEffect(() => {
    if (caret.current !== null && cardholderInput.current) {
      cardholderInput.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [values.cardholderName]);

  function editName(id: 'firstName' | 'lastName', value: string) {
    setValues((current) => {
      const next = { ...current, [id]: value };
      /* Until the payer touches the field themselves it follows the name and surname. After
         the first edit it stops: the card may read something else entirely, and overwriting
         that would undo their correction on the next keystroke upstairs. */
      if (!cardholderTouched.current) {
        next.cardholderName = cardPrintedName(next).toUpperCase();
      }
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const checked = validateCustomer(latestValues.current);
    setProblems(checked.problems);
    if (!checked.valid) {
      return;
    }

    setFormError(null);
    setInFlight(true); // one tokenization per ephemeralTicket
    sdk.current?.tokenize(config.ephemeralTicket);
  }

  // setInFlight opens the panel on submit, before the token exists. If tokenizing or the sale
  // then fails, the panel must not keep saying we are waiting on the bank.
  const panel: OrderStatusData | null = order
    ? (polled ?? { status: 'processing' })
    : inFlight
      ? { status: 'processing' }
      : null;

  return (
    <>
      <OrderSummary amount={money} />

      <ThemeToggle theme={theme} onChange={setTheme} />

      {/* pay-form--loading is on until onReady fires. */}
      <form
        id="payForm"
        className={ready ? 'pay-form' : 'pay-form pay-form--loading'}
        autoComplete="on"
        noValidate
        onSubmit={handleSubmit}
      >
        {/* Our own inputs: same-origin, so full CSS and per-field validation. They are usable
            while the card iframes are still loading. */}
        <section className="pay-section">
          <div className="pay-section__head">
            <h2>Your details</h2>
          </div>

          <div className="pay-row pay-row--even">
            <div className="pay-group">
              <label htmlFor="firstName">First name</label>
              <input
                className={problems.firstName ? 'pay-input pay-input--error' : 'pay-input'}
                id="firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                maxLength={50}
                placeholder="Anna"
                aria-describedby="firstNameHint"
                aria-invalid={problems.firstName ? 'true' : undefined}
                required
                value={values.firstName}
                onChange={(event) => editName('firstName', event.target.value)}
              />
              <p className="pay-hint" id="firstNameHint" aria-live="polite">
                {problems.firstName ?? ''}
              </p>
            </div>
            <div className="pay-group">
              <label htmlFor="lastName">Last name</label>
              <input
                className={problems.lastName ? 'pay-input pay-input--error' : 'pay-input'}
                id="lastName"
                name="lastName"
                type="text"
                autoComplete="family-name"
                maxLength={50}
                placeholder="Weber"
                aria-describedby="lastNameHint"
                aria-invalid={problems.lastName ? 'true' : undefined}
                required
                value={values.lastName}
                onChange={(event) => editName('lastName', event.target.value)}
              />
              <p className="pay-hint" id="lastNameHint" aria-live="polite">
                {problems.lastName ?? ''}
              </p>
            </div>
          </div>

          <div className="pay-group">
            <label htmlFor="email">Email</label>
            <input
              className={problems.email ? 'pay-input pay-input--error' : 'pay-input'}
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-describedby="emailHint"
              aria-invalid={problems.email ? 'true' : undefined}
              required
              value={values.email}
              onChange={(event) => setValues((v) => ({ ...v, email: event.target.value }))}
            />
            <p className="pay-hint" id="emailHint" aria-live="polite">
              {problems.email ?? ''}
            </p>
          </div>
        </section>

        <section className="pay-section">
          <div className="pay-section__head">
            <h2>Card details</h2>
            {/* Scheme wordmarks live here, outside every field box: an element overlaying a
                card input is rejected by the SDK. */}
            <span className="pay-scheme" id="cardScheme">
              Visa · Mastercard · Amex
            </span>
          </div>

          <HostedField id="cardNumber" label="Card number" />

          {/* Our own input, same-origin, sitting between the gateway's iframes. This is the
              thing Hosted Fields buy over a redirect to a payment page: the merchant lays out
              a field of their own in the middle of the card fields, while the number and the
              CVV still live in another origin. The SDK does not collect the holder name. */}
          <div className="pay-group">
            <label htmlFor="cardholderName">Cardholder name</label>
            <input
              ref={cardholderInput}
              className={problems.cardholderName ? 'pay-input pay-input--error' : 'pay-input'}
              id="cardholderName"
              name="cardholderName"
              type="text"
              autoComplete="cc-name"
              maxLength={128}
              placeholder="ANNA WEBER"
              aria-describedby="cardholderNameHint"
              aria-invalid={problems.cardholderName ? 'true' : undefined}
              value={values.cardholderName}
              onChange={(event) => {
                // Cards emboss the holder in capitals, so the field shows capitals as they are
                // typed rather than quietly changing the value on submit.
                caret.current = event.target.selectionStart;
                cardholderTouched.current = true;
                const upper = event.target.value.toUpperCase();
                setValues((v) => ({ ...v, cardholderName: upper }));
              }}
            />
            <p className="pay-hint" id="cardholderNameHint" aria-live="polite">
              {problems.cardholderName ?? ''}
            </p>
          </div>

          <div className="pay-row">
            <HostedField id="expiryDate" label="Expiry date" />
            <HostedField id="cvv" label="CVV" />
          </div>

          {/* Hidden by #formError:not([role="alert"]), so the glyph can stay in the markup and
              the error is never carried by colour alone. */}
          <p id="formError" role={formError ? 'alert' : undefined}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path
                d="M8 1.4 15 14H1L8 1.4Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path
                d="M8 6v3.4M8 11.4v.9"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            {formError && <span>{formError.text}</span>}
          </p>
        </section>

        <div className="pay-actions">
          <button type="submit" id="pay" disabled={!ready || inFlight || terminal !== undefined}>
            {!ready ? 'Preparing…' : inFlight ? 'Processing…' : (terminal ?? payLabel)}
          </button>

          <p className="pay-secure">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect
                x="3"
                y="7"
                width="10"
                height="7"
                rx="1.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            <span>
              Card details are encrypted inside the payment gateway. They are never sent to
              Northwind Supply.
            </span>
          </p>
        </div>
      </form>

      {panel && <StatusPanel data={panel} basePath={config.basePath} />}
    </>
  );
}
