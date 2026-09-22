import type { IconName } from '../components/icon';

export type AppSection =
  'playground' | 'control-plane' | 'contracts' | 'history' | 'phases' | 'docs';

export interface NavItem {
  id: AppSection;
  label: string;
  detail: string;
  icon: IconName;
}

export const navigationGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Workbench',
    items: [
      {
        id: 'playground',
        label: 'Contract Lab',
        detail: 'Validate requests',
        icon: 'flask',
      },
    ],
  },
  {
    label: 'Control',
    items: [
      {
        id: 'control-plane',
        label: 'Control Plane',
        detail: 'M1 durable state',
        icon: 'control',
      },
    ],
  },
  {
    label: 'Developer',
    items: [
      {
        id: 'contracts',
        label: 'Schema Explorer',
        detail: 'Contract catalogue',
        icon: 'schema',
      },
      {
        id: 'history',
        label: 'Validation History',
        detail: 'PostgreSQL audit',
        icon: 'history',
      },
    ],
  },
  {
    label: 'Reference',
    items: [
      {
        id: 'phases',
        label: 'Delivery Plan',
        detail: 'Milestones & commands',
        icon: 'roadmap',
      },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      {
        id: 'docs',
        label: 'Documentation',
        detail: 'Versioned project records',
        icon: 'schema',
      },
    ],
  },
];

export const sectionPaths: Record<AppSection, string> = {
  playground: '/contract-lab',
  'control-plane': '/control-plane',
  contracts: '/schemas',
  history: '/history',
  phases: '/delivery-plan',
  docs: '/docs',
};
