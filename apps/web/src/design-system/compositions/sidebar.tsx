import { Badge } from '../components/badge.js';
import { Icon } from '../components/icon.js';
import { navigationGroups, type AppSection } from './navigation-model.js';

export function Sidebar({
  active,
  onNavigate,
}: {
  active: AppSection;
  onNavigate(section: AppSection): void;
}) {
  return (
    <aside className="ds-sidebar">
      <button
        className="ds-brand"
        onClick={() => onNavigate('playground')}
        aria-label="AI Runtime Platform home"
      >
        <span className="ds-brand-mark">AI</span>
        <span>
          <strong>AI Runtime</strong>
          <small>Platform Console</small>
        </span>
      </button>

      <div className="ds-environment-card">
        <div>
          <span className="ds-live-dot" />
          <strong>Local workspace</strong>
        </div>
        <Badge tone="success">P1 local complete</Badge>
      </div>

      <nav className="ds-navigation" aria-label="Platform navigation">
        {navigationGroups.map((group) => (
          <div className="ds-nav-group" key={group.label}>
            <span className="ds-nav-label">{group.label}</span>
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
                >
                  <Icon name={item.icon} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="ds-sidebar-principle">
        <span className="ds-eyebrow">Platform boundary</span>
        <strong>App owns workflow.</strong>
        <span>Platform owns AI execution and durable control.</span>
      </div>
    </aside>
  );
}
