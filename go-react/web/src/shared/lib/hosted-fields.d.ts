// The Hosted Fields SDK, served by the gateway and loaded with a classic script tag.
// https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html
//
// Ambient on purpose: the bundle defines a global and calls window.onHostedFieldsReady,
// so there is nothing to import.

/** Only these properties survive the SDK's allowlist; anything else is dropped. */
type HostedFieldsCss = Record<string, string>;

interface HostedFieldsStyle {
  input?: HostedFieldsCss;
  placeholder?: HostedFieldsCss;
  focus?: HostedFieldsCss;
}

interface HostedFieldsDescriptor {
  type: 'pan' | 'exp' | 'cvv';
  placeholder?: string;
  style?: HostedFieldsStyle;
}

interface HostedFieldsError {
  code: number;
  /** For the log. */
  message: string;
  tip?: string;
  field?: string;
  /** The only part safe to show to the payer; comes from the gateway's own bundle. */
  payerMessage?: string;
}

interface HostedFieldsOptions {
  endpointId: string;
  /** The keys are the ids of the container divs the iframes are injected into. */
  fields: Record<string, HostedFieldsDescriptor>;
  onReady?: () => void;
  onToken: (hostedFieldsToken: string) => void;
  onError: (error: HostedFieldsError) => void;
}

interface HostedFieldsInstance {
  /** Exchanges the card for a hosted fields token. One call per ephemeralTicket. */
  tokenize(ephemeralTicket: string): void;
  setStyle(divId: string, style: HostedFieldsStyle): void;
  destroy?(): void;
}

interface HostedFieldsStatic {
  init(options: HostedFieldsOptions): HostedFieldsInstance;
}

interface Window {
  /** The SDK bundle calls this once it has loaded. */
  onHostedFieldsReady?: (hostedFields: HostedFieldsStatic) => void;
}
