import { Logo } from "./Logo.js";

interface WelcomeProps {
  error: string | null;
  onConnect: () => void;
}

/** The logged-out landing screen — design 1a "Connect": what Memoria is, in three quiet cards. */
export function Welcome({ error, onConnect }: WelcomeProps) {
  return (
    <div className="welcome">
      <span className="welcome-glyph" aria-hidden="true">
        <Logo size={44} />
      </span>
      <h1>
        Memor<span className="wordmark-ia">ia</span>
      </h1>
      <p className="welcome-tagline">A quiet memory for you and your agents — over a Google Sheet you own.</p>

      <div className="welcome-features">
        <div className="feature-card">
          <span className="feature-icon" aria-hidden="true">
            ✳
          </span>
          <span className="feature-title">Agents write</span>
          <span className="feature-desc">Your AI agents read &amp; write over MCP.</span>
        </div>
        <div className="feature-card">
          <span className="feature-icon" aria-hidden="true">
            ⌗
          </span>
          <span className="feature-title">Sheets store</span>
          <span className="feature-desc">Everything lives in plain spreadsheets in your Drive.</span>
        </div>
        <div className="feature-card">
          <span className="feature-icon" aria-hidden="true">
            ▦
          </span>
          <span className="feature-title">You see</span>
          <span className="feature-desc">Boards and lists on top. Every view stays in sync.</span>
        </div>
      </div>

      {error && <div className="first-run-error">{error}</div>}

      <button className="btn-primary btn-hero" onClick={onConnect}>
        Connect Google Drive
      </button>
      <p className="welcome-fineprint">
        Read/write access only to sheets this app creates or that you pick — never the rest of your Drive.
      </p>
    </div>
  );
}
