import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '../styles/main.scss';

export const metadata: Metadata = {
  title: { default: 'AI Runtime Platform', template: '%s · AI Runtime' },
  description: 'Application-scoped AI runtime and control plane.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
