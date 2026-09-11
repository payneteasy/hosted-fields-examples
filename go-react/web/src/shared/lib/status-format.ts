import type { OrderStatusData } from '@/shared/api';

const CURRENCY_SIGN: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  RUB: '₽',
};

/** First key that is present wins. The gateway answers in kebab-case, so those spellings
 *  come first in every list. */
export function statusPick(data: OrderStatusData, keys: readonly string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && String(value) !== '') {
      return String(value);
    }
  }
  return '';
}

/** Space-grouped thousands with the sign in front, per the brand's numbers
 *  convention: "$ 6 410 879.00". The spaces are non-breaking. */
export function statusAmount(data: OrderStatusData): string {
  const raw = statusPick(data, ['amount', 'sum', 'total']);
  if (!raw) {
    return '';
  }

  const [whole, fraction] = raw.replace(',', '.').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const cents = fraction === undefined ? '' : `.${fraction}`;
  const code = statusPick(data, ['currency', 'currency_code']).toUpperCase();
  const sign = CURRENCY_SIGN[code];

  if (sign) {
    return `${sign}\u00a0${grouped}${cents}`;
  }
  return grouped + cents + (code ? `\u00a0${code}` : '');
}

export function statusCard(data: OrderStatusData): string {
  const type = statusPick(data, ['card-type', 'card_type', 'card_brand', 'payment_method']);
  const last = statusPick(data, ['last-four-digits', 'last_four_digits', 'card_last4', 'last4']);
  if (!type && !last) {
    return '';
  }
  if (!last) {
    return type;
  }
  return `${type ? `${type} ` : ''}\u2022\u2022\u2022\u2022\u00a0${last}`;
}
