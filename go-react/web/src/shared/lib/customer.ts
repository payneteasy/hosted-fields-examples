/* Our own fields -----------------------------------------------------------
   Same-origin inputs, so unlike the card boxes they get per-field validity and
   a message of their own.                                                   */

/** Payer details collected next to the card iframes, as the /pay route receives them. */
export interface Customer {
  firstName: string;
  lastName: string;
  email: string;
  /**
   * The card holder name, composed by the page from the two above: the hosted fields token
   * does not carry it, and with the token the platform leaves the holder empty unless it is
   * sent here — which some acquirers do not survive.
   */
  cardPrintedName: string;
}

export type CustomerFieldId = 'firstName' | 'lastName' | 'cardholderName' | 'email';

export type CustomerValues = Record<CustomerFieldId, string>;

export const EMPTY_CUSTOMER: CustomerValues = {
  firstName: '',
  lastName: '',
  cardholderName: '',
  email: '',
};

// Latin only, and no digits. Neither is the platform's rule — its API validator accepts any
// character — but a name embossed on a card is Latin, some acquirers push the holder through an
// ASCII converter, and the gateway's own payment form rejects digits outright. Better to say so
// here than to have the card refused later.
const NAME_PATTERN = /^[A-Za-z][A-Za-z .'-]*$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

// The Sale documentation gives first_name and last_name 50 characters each, and
// card_printed_name 128 of its own.
const NAME_MAX_LENGTH = 50;
const CARD_NAME_MAX_LENGTH = 128;

interface CustomerField {
  id: CustomerFieldId;
  empty: string;
  invalid: string;
  pattern: RegExp;
  maxLength?: number;
}

export const CUSTOMER_FIELDS: readonly CustomerField[] = [
  {
    id: 'firstName',
    empty: 'Enter the name on the card.',
    invalid: 'Up to 50 Latin letters, as printed on the card.',
    pattern: NAME_PATTERN,
    maxLength: NAME_MAX_LENGTH,
  },
  {
    id: 'lastName',
    empty: 'Enter the surname on the card.',
    invalid: 'Up to 50 Latin letters, as printed on the card.',
    pattern: NAME_PATTERN,
    maxLength: NAME_MAX_LENGTH,
  },
  {
    id: 'cardholderName',
    empty: 'Enter the name as printed on the card.',
    invalid: 'Latin letters only, as printed on the card.',
    pattern: NAME_PATTERN,
    maxLength: CARD_NAME_MAX_LENGTH,
  },
  {
    id: 'email',
    empty: 'Enter an email we can send the receipt to.',
    invalid: 'This does not look like an email address.',
    pattern: EMAIL_PATTERN,
  },
];

export type CustomerProblems = Partial<Record<CustomerFieldId, string>>;

/**
 * Checked here rather than after tokenization: a Sale the gateway refuses has already spent the
 * ephemeralTicket, and the payer would have to start over for a typo in their own name.
 */
export function validateCustomer(values: CustomerValues): {
  valid: boolean;
  problems: CustomerProblems;
  customer: Customer;
} {
  const problems: CustomerProblems = {};

  for (const field of CUSTOMER_FIELDS) {
    const value = values[field.id].trim();
    if (value === '') {
      problems[field.id] = field.empty;
    } else if (
      (field.maxLength !== undefined && value.length > field.maxLength) ||
      !field.pattern.test(value)
    ) {
      problems[field.id] = field.invalid;
    }
  }

  return {
    valid: Object.keys(problems).length === 0,
    problems,
    customer: {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      email: values.email.trim(),
      // What the payer sees in the field is what the gateway gets, edited or not.
      cardPrintedName: values.cardholderName.trim(),
    },
  };
}

/**
 * The name for the card, suggested from the first and last name. The platform splits this
 * string back apart on the FIRST space, so the halves are joined by exactly one.
 */
export function cardPrintedName(values: CustomerValues): string {
  return `${values.firstName.trim()} ${values.lastName.trim()}`.replace(/\s+/g, ' ');
}
