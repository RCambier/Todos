/**
 * The mobile-only "+" button, bottom-right. One consistent, on-brand create
 * affordance across both views — a todo on the board, a note in Notes.
 * Hidden on desktop by CSS (the board has per-column adds; Notes has the
 * capture bar).
 */
export function AddFab({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="fab-add" aria-label={label} title={label} onClick={onClick}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </button>
  );
}
