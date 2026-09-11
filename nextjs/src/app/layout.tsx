import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { BASE_PATH } from '@/shared/config';
import { THEME_BOOTSTRAP } from '@/shared/lib/theme';

export const metadata: Metadata = {
  title: 'Payment · Northwind Supply',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The bootstrap script below sets data-theme before React hydrates, which is a difference
    // from the server's markup by design.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Served straight out of public/, byte-for-byte the same file as go-js and
            nodejs-express-js. Never imported, so no build step can touch it. */}
        <link rel="stylesheet" href={`${BASE_PATH}/styles.css`} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant, and it has to run before paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
