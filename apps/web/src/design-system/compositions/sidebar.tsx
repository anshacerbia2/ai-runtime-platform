import { Icon } from '../components/icon.js';
import { navigationGroups, type AppSection } from './navigation-model.js';

export function Sidebar({
  active,
  collapsed,
  onNavigate,
  onToggle,
}: {
  active: AppSection;
  collapsed: boolean;
  onNavigate(section: AppSection): void;
  onToggle(): void;
}) {
  return (
    <aside className={collapsed ? 'ds-sidebar is-collapsed' : 'ds-sidebar'}>
      <div className="ds-sidebar-inner">
        <div className="ds-brand-slot">
          <button
            className="ds-brand"
            onClick={() => onNavigate('playground')}
            aria-label="AI Runtime Platform home"
          >
            <span className="ds-brand-mark" aria-hidden="true">
              AI
            </span>
            <span className="ds-brand-name">AI Runtime</span>
          </button>
        </div>

        <nav className="ds-navigation" aria-label="Platform navigation">
          {navigationGroups.map((group) => (
            <div key={group.label}>
              <div className="ds-nav-label">{group.label}</div>
              <div className="ds-nav-items">
                {group.items.map((item) => {
                  const activeItem = active === item.id;
                  return (
                    <button
                      key={item.id}
                      className={
                        activeItem ? 'ds-nav-item is-active' : 'ds-nav-item'
                      }
                      onClick={() => onNavigate(item.id)}
                      aria-current={activeItem ? 'page' : undefined}
                      // The label is clipped away in the collapsed rail, so the
                      // accessible name cannot depend on the visible span.
                      aria-label={item.label}
                      title={collapsed ? item.label : item.detail}
                    >
                      <span className="ds-nav-icon">
                        <Icon name={item.icon} />
                      </span>
                      <span className="ds-nav-text">{item.label}</span>
                      {activeItem ? (
                        <span className="ds-nav-rail" aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <button
        className="ds-sidebar-toggle"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        aria-expanded={!collapsed}
      >
        <Icon name={collapsed ? 'chevron' : 'chevron-left'} />
      </button>
    </aside>
  );
}
