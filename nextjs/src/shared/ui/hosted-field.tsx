import { memo } from 'react';

/** The ids of the containers double as the keys of the SDK's `fields` map. */
export const FIELD_IDS = ['cardNumber', 'expiryDate', 'cvv'] as const;

export type FieldId = (typeof FIELD_IDS)[number];

/**
 * One card field: a label and an EMPTY container the SDK fills with a cross-origin iframe.
 *
 * Two rules keep React and the SDK out of each other's way, and both are easy to break:
 *
 *  - the container renders no children, ever. React leaves DOM it did not create alone, so
 *    the injected iframe survives every re-render — but a child here would make React own
 *    the subtree and throw the iframe away;
 *  - `className` is a constant. The SDK toggles hf-field--focus / --filled / --error on this
 *    same element, and React writes the whole attribute whenever the rendered value changes,
 *    which would wipe them. The error ring is added with classList in checkout-form.tsx for
 *    exactly this reason.
 *
 * memo() is belt and braces: with constant props there is nothing to re-render anyway.
 */
export const HostedField = memo(function HostedField({
  id,
  label,
}: {
  id: FieldId;
  label: string;
}) {
  return (
    <div className="pay-group">
      <label htmlFor={id}>{label}</label>
      <div className="hf-field" id={id} />
    </div>
  );
});
