/**
 * Six-ray spark in currentColor — the agent mark used on agent-written cards
 * and the "By agents" filter. An SVG rather than the raw ✳ glyph because
 * phones give that codepoint emoji presentation; this renders identically
 * everywhere and matches the Logo's asterisk geometry.
 */
export function AgentMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.2v11.6M2.98 5.1l10.04 5.8M13.02 5.1 2.98 10.9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
