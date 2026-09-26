/**
 * Wireframe schematic of what this platform actually does: an application
 * request entering the managed envelope, passing routing / policy / budget,
 * and leaving to a runtime. The motion is the request travelling that path.
 *
 * Decorative only — `aria-hidden`, and every stroke inherits colour from CSS
 * so the token boundary is never crossed here. Motion stops under
 * `prefers-reduced-motion` via the global rule in foundations/reset.
 */
export function SignInSchematic() {
  const sources = [88, 180, 272];
  const targets = [88, 180, 272];

  return (
    <svg
      className="signin-schematic"
      viewBox="0 0 560 360"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      fill="none"
    >
      <defs>
        <pattern
          id="signin-grid"
          width="28"
          height="28"
          patternUnits="userSpaceOnUse"
        >
          <path className="schematic-grid" d="M28 0H0V28" />
        </pattern>
      </defs>

      <rect width="560" height="360" fill="url(#signin-grid)" />

      {/* Application tier */}
      {sources.map((y, index) => (
        <g key={`source-${y}`} className="schematic-node">
          <rect
            className="schematic-outline"
            x="28"
            y={y - 18}
            width="96"
            height="36"
            rx="8"
          />
          <circle
            className={`schematic-dot schematic-delay-${index}`}
            cx="46"
            cy={y}
            r="3"
          />
          <path
            className="schematic-hint"
            d={`M60 ${y - 4}h44M60 ${y + 4}h28`}
          />
        </g>
      ))}

      {/* Inbound paths */}
      {sources.map((y, index) => (
        <g key={`in-${y}`}>
          <path
            className="schematic-link"
            d={`M124 ${y}H168Q188 ${y} 188 ${y + (180 - y) / 2}V${180 - (180 - y) / 2}Q188 180 208 180H216`}
          />
          <path
            className={`schematic-pulse schematic-delay-${index}`}
            d={`M124 ${y}H168Q188 ${y} 188 ${y + (180 - y) / 2}V${180 - (180 - y) / 2}Q188 180 208 180H216`}
          />
        </g>
      ))}

      {/* Managed envelope */}
      <g className="schematic-core">
        <rect
          className="schematic-core-ring"
          x="208"
          y="108"
          width="144"
          height="144"
          rx="16"
        />
        <rect
          className="schematic-outline"
          x="216"
          y="116"
          width="128"
          height="128"
          rx="12"
        />
        <path className="schematic-divider" d="M216 156h128M216 204h128" />
        <path
          className="schematic-hint"
          d="M236 136h52M236 180h68M236 224h40"
        />
        <circle className="schematic-core-dot" cx="324" cy="136" r="3" />
        <circle className="schematic-core-dot" cx="324" cy="180" r="3" />
        <circle className="schematic-core-dot" cx="324" cy="224" r="3" />
      </g>

      {/* Outbound paths */}
      {targets.map((y, index) => (
        <g key={`out-${y}`}>
          <path
            className="schematic-link"
            d={`M344 180H352Q372 180 372 ${180 - (180 - y) / 2}V${y + (180 - y) / 2}Q372 ${y} 392 ${y}H436`}
          />
          <path
            className={`schematic-pulse schematic-delay-${index + 1}`}
            d={`M344 180H352Q372 180 372 ${180 - (180 - y) / 2}V${y + (180 - y) / 2}Q372 ${y} 392 ${y}H436`}
          />
        </g>
      ))}

      {/* Runtime tier */}
      {targets.map((y, index) => (
        <g key={`target-${y}`} className="schematic-node">
          <rect
            className="schematic-outline"
            x="436"
            y={y - 18}
            width="96"
            height="36"
            rx="8"
          />
          <circle
            className={`schematic-dot schematic-delay-${index + 2}`}
            cx="454"
            cy={y}
            r="3"
          />
          <path
            className="schematic-hint"
            d={`M468 ${y - 4}h44M468 ${y + 4}h24`}
          />
        </g>
      ))}
    </svg>
  );
}
