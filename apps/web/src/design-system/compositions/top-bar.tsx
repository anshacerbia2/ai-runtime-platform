import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/icon.js';
import { navigationGroups, type AppSection } from './navigation-model.js';

function AccountMenu() {
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
        A
      </button>
      {open ? (
        <div className="ds-account-menu" role="menu">
          <div className="ds-account-identity">
            <strong>Local operator</strong>
            <span>m0-playground</span>
          </div>
          <button type="button" role="menuitem" className="ds-account-item">
            Workspace settings
          </button>
          <button type="button" role="menuitem" className="ds-account-item">
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({
  active,
  onToggle,
}: {
  active: AppSection;
  onToggle(): void;
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

          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
