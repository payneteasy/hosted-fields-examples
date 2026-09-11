import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { checkoutConfig } from '@/shared/config';
import { applyStoredTheme } from '@/shared/lib';
import { CheckoutForm, PayShell } from '@/shared/ui';

/* The payment page, GET {prefix}/ — dist/index.html plus this bundle.

   This file is the whole of the seam. Above it is a Go process that holds the credentials,
   signs the gateway calls and generated the config.js the template loaded a moment ago; below
   it is React, which from here on talks to that process through two fetches and nothing else.
   Everything in src/ runs in the browser, which is the reason this example exists next to
   nextjs/, where the same code is spread across a server component, a client component and an
   edge middleware in one src/ tree.                                                        */

// Before React renders, so a stored preference is applied to <html> as early as the
// Content-Security-Policy allows. See applyStoredTheme() for what that costs.
applyStoredTheme();

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root is missing from the page template');
}

createRoot(root).render(
  // StrictMode runs every effect twice in development, which is the thing the ref guard around
  // HostedFields.init() in checkout-form.tsx exists for. Keeping it on is how that guard stays
  // honest; React drops the double invocation from the production build either way.
  <StrictMode>
    <PayShell>
      <CheckoutForm config={checkoutConfig()} />
    </PayShell>
  </StrictMode>,
);
