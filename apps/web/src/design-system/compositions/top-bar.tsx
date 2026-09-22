import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/icon';
import { navigationGroups, type AppSection } from './navigation-model';

interface Account {
  name: string;
  subject: string;
  local: boolean;
}
function AccountMenu({ user }: { user: Account }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="ds-account" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ds-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((previous) => !previous)}
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>
      {open ? (
        <div className="ds-account-menu" role="menu">
          <div className="ds-account-identity">
            <strong>{user.name}</strong>
            <span>{user.local ? 'Local development' : 'Keycloak session'}</span>
          </div>
          <a href="/docs" role="menuitem" className="ds-account-item">
            Documentation
          </a>
          <form action="/auth/logout" method="post">
            <button type="submit" role="menuitem" className="ds-account-item">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({
  active,
  onToggle,
  user,
}: {
  active: AppSection;
  onToggle(): void;
  user: Account;
}) {
  const current = navigationGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === active);

  return (
    <header className="ds-topbar">
      <div className="ds-topbar-inner">
        <div className="ds-topbar-left">
          <button
            className="ds-topbar-menu"
            onClick={onToggle}
            aria-label="Toggle navigation"
          >
            <Icon name="menu" />
          </button>

          <div className="ds-search">
            <Icon name="search" className="ds-search-icon" />
            <input
              type="search"
              placeholder="Search resource…"
              aria-label="Search resource"
            />
          </div>
        </div>

        <div className="ds-topbar-right">
          <div className="ds-access-level">
            <span className="ds-access-caption">Access level</span>
            <span className="ds-access-value">
              {current?.label ?? 'Console'}
            </span>
          </div>

          <button className="ds-icon-button" aria-label="Notifications">
            <Icon name="bell" />
            <span className="ds-bell-dot" aria-hidden="true" />
          </button>

          <AccountMenu user={user} />
        </div>
      </div>
    </header>
  );
}
