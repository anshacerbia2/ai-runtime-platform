// The platform's mark: two bars, offset, wider than tall (scnehaux-design brand/Brand.html), drawn in
// the ink role by the stylesheet, so it is light on the dark mode and dark on the light one.
export function BrandMark({
  className = 'ds-brand-mark',
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="2 8 21 9"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M23 8L20 12L9 12L12 8ZM16 13L13 17L2 17L5 13Z" />
    </svg>
  );
}
