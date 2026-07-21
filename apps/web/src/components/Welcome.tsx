import { Logo } from "./Logo.js";

interface WelcomeProps {
  error: string | null;
  onConnect: () => void;
}

/**
 * The logged-out landing screen — design 3d "Connect": one headline, one
 * button, one trust line, and the layer diagram (agent cursors → cards →
 * your sheet) as the pitch, followed by a four-card feature band and a
 * closing no-lock-in line.
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

      <FeatureBand />

      <p className="welcome-freedom">
        You own the sheet, so you're never locked in — stop using Memoria any
        day and your data is still just a spreadsheet in your Drive.
      </p>
    </div>
  );
}

/** The four claims the hero scene shows but never names, spelled out. */
function FeatureBand() {
  return (
    <div className="welcome-features">
      <div className="feature-card">
        <FreeGlyph />
        <span className="feature-title">Free &amp; open source</span>
        <p className="feature-body">
          No plans, no paywalls. Use the hosted app or deploy your own fork in
          about 15 minutes.
        </p>
      </div>
      <div className="feature-card">
        <SheetsGlyph size={20} />
        <span className="feature-title">Your data is a Google Sheet</span>
        <p className="feature-body">
          The only backend is a spreadsheet in your own Drive. No servers, no
          database, nothing stored about you.
        </p>
      </div>
      <div className="feature-card">
        <BoardGlyph />
        <span className="feature-title">A board for you</span>
        <p className="feature-body">
          Kanban todos, markdown notes, and AI memories — a fast, human-friendly
          UI over the sheet.
        </p>
      </div>
      <div className="feature-card">
        <AgentGlyph />
        <span className="feature-title">MCP for your agents</span>
        <p className="feature-body">
          Claude, Codex, or any MCP client reads and writes the same sheet
          through the built-in connector.
        </p>
      </div>
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

/** Google-Sheets-style file tile for the mock sheet's header and feature band. */
function SheetsGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="2" width="18" height="20" rx="2.5" fill="#188038" />
      <rect x="6.5" y="10" width="11" height="8" rx="1" fill="#fff" />
      <line x1="6.5" y1="14" x2="17.5" y2="14" stroke="#188038" strokeWidth="1.2" />
      <line x1="12" y1="10" x2="12" y2="18" stroke="#188038" strokeWidth="1.2" />
    </svg>
  );
}

/** A zero-dollar price tag: free, with nothing hiding behind it. */
function FreeGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 4.5 A1.5 1.5 0 0 1 5 3 h6.3 a2 2 0 0 1 1.4.6 l7.2 7.2 a2 2 0 0 1 0 2.8 l-6.3 6.3 a2 2 0 0 1-2.8 0 L3.6 12.7 A2 2 0 0 1 3 11.3 Z"
        fill="var(--status-done-dot)"
      />
      <circle cx="7.6" cy="7.6" r="1.5" fill="#fff" />
      <text x="13.4" y="16.4" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">
        0
      </text>
    </svg>
  );
}

/** A tiny three-column kanban board — the human side of the sheet. */
function BoardGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="3" width="19" height="18" rx="2.5" fill="var(--accent)" />
      <rect x="5" y="6" width="4.2" height="9" rx="1" fill="#fff" opacity="0.92" />
      <rect x="9.9" y="6" width="4.2" height="12" rx="1" fill="#fff" opacity="0.92" />
      <rect x="14.8" y="6" width="4.2" height="6.5" rx="1" fill="#fff" opacity="0.92" />
    </svg>
  );
}

/** The agent cursor from the hero scene, promoted to a feature icon. */
function AgentGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 3 L20 11 L12.5 12.8 L9 20 Z"
        fill="var(--warn)"
        stroke="var(--card)"
        strokeWidth="1.5"
      />
      <text x="18.5" y="21.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--warn)">
        ✳
      </text>
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

      <div className="hero-card hero-card-memories">
        <span className="hero-card-title">AI Memories</span>
        <div className="hero-card-lines">
          <span className="hero-bar note" style={{ width: "90%" }} />
          <span className="hero-bar note" style={{ width: "70%" }} />
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
