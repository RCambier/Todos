/**
 * The Memoria logo — design 3b "Asterisk": the agent mark as the brand, a
 * rounded asterisk on a circular disc. One mark for app and agent (it echoes
 * the ✳ chip on agent-written cards). Colors ride the theme variables, so it
 * is near-black-on-white in light mode and inverts in dark mode.
 */
export function Logo({ size = 24 }: { size?: number }) {
  // The mockup thickens the stroke at chip sizes so the mark stays legible.
  const strokeWidth = size <= 32 ? 8 : 6;
  return (
    <svg width={size} height={size} viewBox="0 0 88 88" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="72" height="72" rx="36" fill="var(--accent)" />
      <g stroke="var(--accent-contrast)" strokeWidth={strokeWidth} strokeLinecap="round">
        <line x1="44" y1="27" x2="44" y2="61" />
        <line x1="29.3" y1="35.5" x2="58.7" y2="52.5" />
        <line x1="58.7" y1="35.5" x2="29.3" y2="52.5" />
      </g>
    </svg>
  );
}
