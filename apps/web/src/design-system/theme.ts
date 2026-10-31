// The UI Platform theme this console draws in (ADR-0033), and where the viewer's choice of mode is kept.
// The mode cookie is a per-viewer convenience, not a credential; it is readable by script so the
// theme toggle can write it, and the server reads it to render the chosen mode on the first paint.
export const PLATFORM_THEME = 'scnx-platform';

export const MODE_COOKIE = 'ai-runtime-mode';

export type ResolvedMode = 'dark' | 'light';

export const resolveMode = (value: string | undefined): ResolvedMode =>
  value === 'light' ? 'light' : 'dark';
