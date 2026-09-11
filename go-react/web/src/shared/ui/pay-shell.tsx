import type { ReactNode } from 'react';

/** The page shell both screens share: one card on a plain background. */
export function PayShell({ children }: { children: ReactNode }) {
  return (
    <main className="pay-wrap">
      <div className="pay-card">{children}</div>
      <p className="pay-foot">Payments processed by Payneteasy</p>
    </main>
  );
}
