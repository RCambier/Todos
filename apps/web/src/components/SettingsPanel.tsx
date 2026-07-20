import { useEffect, useState } from "react";
import { buildClaudeCodeCliSnippet, buildConnectorUrl } from "../lib/mcpSnippet.js";

/** The calendar-mirror control, present only where the auth backend can drive it (the board view). */
interface CalendarMirror {
  enabled: boolean;
  hasScope: boolean;
  onToggle: () => void;
}

interface SettingsPanelProps {
  onClose: () => void;
  /** Null on deployments/views without the mirror — then Settings has only the AI-agents section. */
  calendarMirror: CalendarMirror | null;
}

type SettingsTab = "agents" | "calendar";

/** Copies `value` to the clipboard, showing a transient "Copied" confirmation. */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied outright — the text is still
      // selectable from the <pre> next to this button.
    }
  }

  return (
    <button type="button" className="copy-btn" onClick={() => void handleCopy()}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * The Settings drawer. One entry point (the account menu's "Settings"),
 * split into sections shown one at a time via a tab switcher — never two
 * menu items landing on the same scroll of one long page. "AI agents" is
 * always present; "Google Calendar" appears only where the mirror can run.
 */
export function SettingsPanel({ onClose, calendarMirror }: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>("agents");
  const showCalendarTab = calendarMirror !== null;

  // Escape closes, like every other overlay in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <h2 className="settings-title">Settings</h2>
          <button className="close" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </div>

        {showCalendarTab && (
          <div className="settings-tabs" role="tablist" aria-label="Settings sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "agents"}
              className={`settings-tab${tab === "agents" ? " active" : ""}`}
              onClick={() => setTab("agents")}
            >
              AI agents
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "calendar"}
              className={`settings-tab${tab === "calendar" ? " active" : ""}`}
              onClick={() => setTab("calendar")}
            >
              Google Calendar
            </button>
          </div>
        )}

        {tab === "agents" && <AgentsSection />}
        {tab === "calendar" && calendarMirror && <CalendarSection mirror={calendarMirror} />}
      </div>
    </div>
  );
}

/** The MCP-connector walkthrough: copy the URL, add it to an agent, use it. */
function AgentsSection() {
  const connectorUrl = buildConnectorUrl(window.location.origin);
  const cliSnippet = buildClaudeCodeCliSnippet(window.location.origin);

  return (
    <section className="settings-body" aria-label="Connect AI agents">
      <p className="settings-intro">
        Your agents get the same collections over MCP — list, add, move, and complete tasks, and read or write
        notes. Nothing to install: each agent signs in with your Google account and sees only this app&rsquo;s
        sheets, never the rest of your Drive.
      </p>

      <div className="settings-step">
        <h4>
          <span className="step-num">1</span> Copy the connector URL
        </h4>
        <div className="field">
          <div className="copy-row">
            <pre>{connectorUrl}</pre>
            <CopyButton value={connectorUrl} />
          </div>
        </div>
      </div>

      <div className="settings-step">
        <h4>
          <span className="step-num">2</span> Add it to your agent
        </h4>
        <p className="step-desc">
          <strong>claude.ai</strong> (chats, projects, scheduled routines): Settings → Connectors → Add custom
          connector → paste the URL → approve the Google consent screen.
        </p>
        <p className="step-desc">
          <strong>Claude Code</strong> (terminal):
        </p>
        <div className="field">
          <div className="copy-row">
            <pre>{cliSnippet}</pre>
            <CopyButton value={cliSnippet} />
          </div>
        </div>
        <p className="step-desc">
          Any other MCP client works the same way — it&rsquo;s a standard remote MCP server (Streamable HTTP +
          OAuth).
        </p>
      </div>

      <div className="settings-step">
        <h4>
          <span className="step-num">3</span> Use it
        </h4>
        <p className="step-desc">
          Ask your agent about your board — &ldquo;what&rsquo;s in progress?&rdquo; — let a routine file and
          complete tasks, or have it leave a note in Notes. Anything agents create carries a small ✳ chip
          here. Revoke access anytime from your Google account&rsquo;s third-party access page.
        </p>
      </div>
    </section>
  );
}

/** The one-way Google Tasks / Calendar mirror toggle. */
function CalendarSection({ mirror }: { mirror: CalendarMirror }) {
  const status = !mirror.enabled
    ? "Off"
    : mirror.hasScope
      ? "On — tasks with a due date appear in Google Calendar"
      : "Waiting for Google permission — toggle again to finish connecting";

  return (
    <section className="settings-body" aria-label="Google Calendar sync">
      <p className="settings-intro">
        Mirror tasks that have a due date into a &ldquo;Memoria&rdquo; Google Tasks list — they show up in
        Google Calendar on their due date. One-way: the board stays the source of truth; edits in Google are
        overwritten on the next sync.
      </p>
      <div className="mirror-row">
        <button
          type="button"
          role="switch"
          aria-checked={mirror.enabled}
          className={`mirror-toggle${mirror.enabled ? " on" : ""}`}
          onClick={mirror.onToggle}
        >
          <span className="knob" />
        </button>
        <span className="mirror-status">{status}</span>
      </div>
    </section>
  );
}
