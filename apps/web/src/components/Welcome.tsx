import { Logo } from "./Logo.js";

interface WelcomeProps {
  error: string | null;
  onConnect: () => void;
}

/**
 * The logged-out landing screen — design 3d "Connect": one headline, one
 * button, one trust line, and the layer diagram (agent cursors → cards →
 * your sheet) as the pitch.
 */
export function Welcome({ error, onConnect }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-brand">
        <Logo size={30} />
        <span className="welcome-wordmark">
          Memor<span className="wordmark-ia">ia</span>
        </span>
      </div>
      <h1 className="welcome-headline">
        Memory for your AI agents.
        <br />
        Stored in your Google Sheets.
      </h1>

      {error && <div className="first-run-error">{error}</div>}

      <button className="btn-drive" onClick={onConnect}>
        <DriveGlyph />
        Connect Google Drive
      </button>
      <p className="welcome-fineprint">
        Access only to sheets Memoria creates or that you pick — never the rest of your Drive.
      </p>

      <HeroScene />
    </div>
  );
}

/** Google Drive's tri-color triangle, drawn inline so it needs no asset. */
function DriveGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.2 3 L15.8 3 L22 13.6 L18.2 20.2 L12 9.6 Z" fill="#FFCF3F" />
      <path d="M8.2 3 L2 13.6 L5.8 20.2 L12 9.6 Z" fill="#11A861" />
      <path d="M5.8 20.2 L18.2 20.2 L22 13.6 L9.5 13.6 Z" fill="#3E7BFA" opacity="0.95" />
    </svg>
  );
}

/** Google-Sheets-style file tile for the mock sheet's header. */
function SheetsGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="2" width="18" height="20" rx="2.5" fill="#188038" />
      <rect x="6.5" y="10" width="11" height="8" rx="1" fill="#fff" />
      <line x1="6.5" y1="14" x2="17.5" y2="14" stroke="#188038" strokeWidth="1.2" />
      <line x1="12" y1="10" x2="12" y2="18" stroke="#188038" strokeWidth="1.2" />
    </svg>
  );
}

function CursorGlyph({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 3 L20 11 L12.5 12.8 L9 20 Z" fill={color} stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * The three-layer diagram from design 3d: a faded spreadsheet in the back,
 * the app's card views floating over it, agent cursors on top. Purely
 * decorative — everything it says, the headline already said.
 */
function HeroScene() {
  return (
    <div className="hero-scene" aria-hidden="true">
      <div className="hero-sheet">
        <div className="hero-sheet-header">
          <SheetsGlyph />
          <span>Memoria — your Drive</span>
        </div>
        <div className="hero-sheet-grid" />
      </div>

      <div className="hero-card hero-card-todos">
        <span className="hero-card-title">Todos</span>
        <div className="hero-card-lines">
          <div className="hero-todo">
            <span className="hero-checkbox" />
            <span className="hero-bar" />
          </div>
          <div className="hero-todo">
            <span className="hero-checkbox" />
            <span className="hero-bar" style={{ flex: "0 0 70%" }} />
          </div>
          <div className="hero-todo">
            <span className="hero-checkbox done">✓</span>
            <span className="hero-bar faint" style={{ flex: "0 0 55%" }} />
          </div>
        </div>
      </div>

      <div className="hero-card hero-card-notes">
        <span className="hero-card-title">Notes</span>
        <div className="hero-card-lines">
          <span className="hero-bar note" />
          <span className="hero-bar note" style={{ width: "85%" }} />
          <span className="hero-bar note" style={{ width: "60%" }} />
        </div>
      </div>

      <div className="hero-cursor hero-cursor-claude">
        <CursorGlyph color="var(--accent)" />
        <span>✳ Claude</span>
      </div>
      <div className="hero-cursor hero-cursor-agent">
        <CursorGlyph color="var(--warn)" />
        <span>✳ Your agent</span>
      </div>
    </div>
  );
}
