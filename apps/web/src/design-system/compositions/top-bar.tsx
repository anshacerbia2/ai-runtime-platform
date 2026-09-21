import { Badge } from '../components/badge.js';
import { Icon } from '../components/icon.js';
import { navigationGroups, type AppSection } from './navigation-model.js';

export function TopBar({ active }: { active: AppSection }) {
  const current = navigationGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === active);

  return (
    <header className="ds-topbar">
      <div className="ds-breadcrumb">
        <span>AI Runtime</span>
        <Icon name="chevron" />
        <strong>{current?.label}</strong>
      </div>
      <div className="ds-topbar-status">
        <span className="ds-live-dot" />
        <span>M0 + M1 healthy</span>
        <Badge tone="neutral">Local</Badge>
      </div>
    </header>
  );
}
