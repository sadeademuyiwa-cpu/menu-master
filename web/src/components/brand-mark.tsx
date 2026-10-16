/**
 * The Rising Bowl: Menu Master NG's mark, inline so it needs no request and
 * follows the colour scheme. Source of truth is branding/03-logo/svg/mark.svg;
 * the paths here are copied from it unchanged.
 *
 * The bowl is Forest Green on light backgrounds and white in dark mode
 * (`--mm-brand-bowl` in globals.css); the bars are always Harvest Gold.
 */
export function BrandMark({ size = 30, className = '' }: { size?: number; className?: string }) {
  // The mark is 620 x 520 units; `size` is its height.
  const width = Math.round((size * 620) / 520)
  return (
    <svg
      className={`mm-brand-mark ${className}`.trim()}
      width={width}
      height={size}
      viewBox="230 218 620 520"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="var(--mm-brand-gold)">
        <path d="M400 330a14 14 0 0 1 14-14h52a14 14 0 0 1 14 14v80h-80z" />
        <path d="M500 282a14 14 0 0 1 14-14h52a14 14 0 0 1 14 14v98l-40 75l-40-75z" />
        <path d="M600 232a14 14 0 0 1 14-14h52a14 14 0 0 1 14 14v178h-80z" />
      </g>
      <g fill="var(--mm-brand-bowl)">
        <path
          fillRule="evenodd"
          d="M230 405h620a310 290 0 0 1-620 0z M292 432h128v191a250 232 0 0 1-128-191z M788 432h-128v191a250 232 0 0 0 128-191z M495 405l45 80l45-80v245h-90z"
        />
        <path d="M420 690V405h75l45 80l45-80h75v285h-75V540l-45 70l-45-70v150z" />
        <rect x="395" y="700" width="290" height="38" rx="14" />
      </g>
    </svg>
  )
}

/**
 * The horizontal lockup: mark plus the wordmark as real text, so it is crisp,
 * selectable, readable by screen readers and themed like the mark. "Menu
 * Master" is set in the display face at weight 800; "NG" is gold and a little
 * smaller, as in the logo artwork. Use where the product introduces itself
 * (landing, sign-in, setup); inside the app the mark sits beside the
 * business's own name instead.
 */
export function BrandLockup({ size = 44, className = '' }: { size?: number; className?: string }) {
  // Proportions of branding/03-logo/svg/lockup-horizontal.svg: the wordmark is
  // 0.46 of the mark's height and sits 0.22 of it to the right. `size` is the
  // mark's height; keep it at 40 or more so the wordmark stays legible.
  return (
    <span className={`mm-brand-lockup ${className}`.trim()} style={{ gap: Math.round(size * 0.22) }}>
      <BrandMark size={size} />
      <span className="mm-brand-word" style={{ fontSize: Math.round(size * 0.46) }}>
        Menu Master <span className="mm-brand-ng">NG</span>
      </span>
    </span>
  )
}
