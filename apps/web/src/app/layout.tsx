import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
// The UI Platform's stylesheets first: its components, then the scnx-platform theme (ADR-0033). The
// application's own stylesheet follows and places itself in the layers after theirs.
import '@scnx/system/styles/components.css';
import '@scnx/system/tokens/css/scnx-platform.css';
import '../styles/main.scss';
import {
  MODE_COOKIE,
  PLATFORM_THEME,
  resolveMode,
} from '../design-system/theme';

export const metadata: Metadata = {
  title: { default: 'AI Runtime Platform', template: '%s · AI Runtime' },
  description: 'Application-scoped AI runtime and control plane.',
  robots: { index: false, follow: false },
};

// The theme root is <html>: the theme stylesheet selects its tokens there, by the theme and the
// resolved mode, so the server renders both and the first paint already has every token. The mode is
// the viewer's stored choice, and dark until they make one.
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const mode = resolveMode((await cookies()).get(MODE_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-scnx-theme={PLATFORM_THEME}
      data-scnx-resolved-mode={mode}
    >
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
