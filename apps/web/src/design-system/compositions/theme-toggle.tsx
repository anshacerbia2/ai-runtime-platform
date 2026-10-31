import { Icon } from '../components/icon';
import { MODE_COOKIE, resolveMode } from '../theme';

// A year: the choice outlives the session, as a preference should.
const MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Switches the console between the dark and the light mode. The mode lives on the theme root (<html>,
// ADR-0033) and in a cookie, so the server renders the next page in it. The button draws both glyphs
// and the stylesheet shows the one for the mode it would switch to, so the server's markup and the
// browser's never differ.
export function ThemeToggle() {
  return (
    <button
      type="button"
      className="ds-icon-button ds-theme-toggle"
      aria-label="Switch between dark and light mode"
      title="Switch between dark and light mode"
      onClick={() => {
        const root = document.documentElement;
        const next =
          resolveMode(root.dataset.scnxResolvedMode) === 'dark'
            ? 'light'
            : 'dark';
        root.dataset.scnxResolvedMode = next;
        document.cookie = `${MODE_COOKIE}=${next}; path=/; max-age=${MODE_COOKIE_MAX_AGE}; samesite=lax`;
      }}
    >
      <Icon name="sun" className="ds-theme-to-light" />
      <Icon name="moon" className="ds-theme-to-dark" />
    </button>
  );
}
