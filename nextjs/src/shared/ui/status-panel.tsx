'use client';

import { Fragment, type ReactElement } from 'react';
import { type OrderStatusData, statusAmount, statusCard, statusPick } from '@/shared/lib';

/* The order panel: verdict and amount first, then the handful of values a payer or a support
   agent would actually quote, then everything the gateway returned behind a disclosure. */

type Glyph = 'check' | 'cross' | 'dots';

const STATUS_GLYPH: Record<Glyph, ReactElement> = {
  check: (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M4.5 10.6l3.6 3.6L15.6 6.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  cross: (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path
        d="M6 6l8 8M14 6l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  ),
  dots: (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r="7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeDasharray="3.2 3.6"
        strokeLinecap="round"
      />
    </svg>
  ),
};

interface StatusCopy {
  eyebrow: string;
  title: string;
  body: string;
  glyph: Glyph;
  /** The primary button; null means the panel ends with the details. */
  action: string | null;
}

/** One entry per final status the gateway can report, plus the in-flight case. */
const STATUS_COPY: Record<string, StatusCopy> = {
  processing: {
    eyebrow: 'In progress',
    title: 'Contacting your bank',
    body: 'This can take up to a minute. Please do not close or reload this window.',
    glyph: 'dots',
    action: null,
  },
  approved: {
    eyebrow: 'Payment complete',
    title: 'Approved',
    body: 'The merchant has been notified. A receipt is on its way to your email.',
    glyph: 'check',
    action: 'Back to the store',
  },
  declined: {
    eyebrow: 'Not completed',
    title: 'Declined',
    body: 'Your bank did not authorise this payment. Nothing has been charged. You can try again with another card.',
    glyph: 'cross',
    action: 'Try another card',
  },
  error: {
    eyebrow: 'Not completed',
    title: 'Something went wrong',
    body: 'The payment could not be finished and nothing has been charged. Reload the page to start a new payment.',
    glyph: 'cross',
    action: 'Reload the page',
  },
  filtered: {
    eyebrow: 'Filtered',
    title: 'Filtered',
    body: 'This payment was stopped by a security check and nothing has been charged. Contact the merchant if you believe this is a mistake.',
    glyph: 'dots',
    action: 'Contact the merchant',
  },
};

/** Which gateway fields get promoted into the readable list, in order. A row with no value
 *  is dropped. The gateway answers in kebab-case, so those spellings come first. */
const STATUS_ROWS: readonly { label: string; format?: 'amount' | 'card'; keys?: string[] }[] = [
  { label: 'Amount', format: 'amount' },
  { label: 'Card', format: 'card' },
  { label: 'Cardholder', keys: ['cardholder-name', 'cardholder_name'] },
  { label: 'Order', keys: ['merchant-order-id', 'merchant_order_id', 'order_id'] },
  {
    label: 'Reference',
    keys: ['paynet-order-id', 'paynet_order_id', 'processor-rrn', 'processor_rrn'],
  },
  { label: 'Approval code', keys: ['approval-code', 'approval_code'] },
  { label: 'Bank message', keys: ['bank_message', 'error-message', 'error_message'] },
  { label: 'Filter', keys: ['filter_message', 'fraud_message'] },
];

const IN_FLIGHT_STAGES: readonly [string, boolean][] = [
  ['Card details tokenized', true],
  ['Payment sent to the gateway', true],
  ['Waiting for the bank', false],
];

export function StatusPanel({ data, basePath }: { data: OrderStatusData; basePath: string }) {
  const key = String(data.status ?? 'processing').toLowerCase();
  const copy = STATUS_COPY[key] ?? STATUS_COPY.error;
  const isFinal = key !== 'processing';
  // Everything lives under basePath: "/" would leave the app
  const home = `${basePath}/`;

  const rows = STATUS_ROWS.map((row) => {
    if (row.format === 'amount') {
      return { label: row.label, value: statusAmount(data) };
    }
    if (row.format === 'card') {
      return { label: row.label, value: statusCard(data) };
    }
    return { label: row.label, value: statusPick(data, row.keys ?? []) };
  }).filter((row) => row.value !== '');

  const allKeys = Object.keys(data).sort();

  return (
    <div
      id="orderStatus"
      className={`status status--${isFinal ? key : 'processing'}`}
      aria-live="polite"
      aria-busy={isFinal ? 'false' : 'true'}
    >
      <div className="status__head">
        <span className="status__badge">{STATUS_GLYPH[copy.glyph]}</span>
        <div>
          <div className="status__eyebrow">{copy.eyebrow}</div>
          <h2 className="status__title">{copy.title}</h2>
        </div>
      </div>

      <p className="status__body">{copy.body}</p>

      {!isFinal && (
        <ol className="status__steps">
          {IN_FLIGHT_STAGES.map(([text, done]) => (
            <li key={text} className={`status__step${done ? ' status__step--done' : ''}`}>
              {text}
            </li>
          ))}
        </ol>
      )}

      {isFinal && rows.length > 0 && (
        <dl className="status__rows">
          {rows.map((row) => (
            <Fragment key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      {isFinal && allKeys.length > 0 && (
        <details className="status__raw">
          <summary>Show all {allKeys.length} gateway fields</summary>
          <dl className="status__grid">
            {allKeys.map((name) => (
              <Fragment key={name}>
                <dt>{name}</dt>
                <dd>{String(data[name])}</dd>
              </Fragment>
            ))}
          </dl>
        </details>
      )}

      {isFinal && copy.action && (
        <div className="status__actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              if (key === 'error') {
                window.location.reload();
              } else {
                window.location.href = home;
              }
            }}
          >
            {copy.action}
          </button>
          {copy.action !== 'Back to the store' && (
            <a className="btn-secondary" href={home}>
              Back to the store
            </a>
          )}
        </div>
      )}
    </div>
  );
}
