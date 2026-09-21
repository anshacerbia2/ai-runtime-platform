import type { SVGProps } from 'react';

export type IconName =
  'flask' | 'control' | 'schema' | 'history' | 'roadmap' | 'pulse' | 'chevron';

const paths: Record<IconName, string> = {
  flask:
    'M9 3h6M10 3v5l-4.5 7.5A3 3 0 0 0 8.1 20h7.8a3 3 0 0 0 2.6-4.5L14 8V3M8 14h8',
  control:
    'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M14 4v4M8 10v4M14 16v4',
  schema: 'M5 4h14v5H5zM5 15h6v5H5zM15 15h4v5h-4zM12 9v3M8 12h9M8 12v3M17 12v3',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  roadmap: 'M5 4h6v5H5zM13 15h6v5h-6zM8 9v3h8v3M16 12V9',
  pulse: 'M3 12h4l2-5 4 10 2-5h6',
  chevron: 'm9 6 6 6-6 6',
};

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
