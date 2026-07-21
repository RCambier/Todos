import { useEffect, useState } from "react";
import { buildClaudeCodeCliSnippet, buildConnectorUrl } from "../lib/mcpSnippet.js";
import { AgentMark } from "./AgentMark.js";

/** The calendar-mirror control, present only where the auth backend can drive it (the board view). */
interface CalendarMirror {
  enabled: boolean;
  hasScope: boolean;
  onToggle: () => void;
}

interface SettingsPanelProps {
  /** Which drawer this is — each account-menu entry opens its own. */
  section: "agents" | "calendar";
  onClose: () => void;
  /** Null on deployments/views without the mirror — the calendar drawer then points to the Todos view. */
  calendarMirror: CalendarMirror | null;
}

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
 * A settings drawer. Two account-menu entries — "Connect with AI agents" and
 * "Sync with Google Calendar" — each open their own drawer showing exactly
 * one section; there are no tabs inside.
 */
export function SettingsPanel({ section, onClose, calendarMirror }: SettingsPanelProps) {
  const title = section === "agents" ? "Connect with AI agents" : "Sync with Google Calendar";

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
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <h2 className="settings-title">{title}</h2>
          <button className="close" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </div>

        {section === "agents" ? <AgentsSection /> : <CalendarSection mirror={calendarMirror} />}
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
          complete tasks, or have it leave a note in Notes. Anything agents create carries a small{" "}
          <AgentMark size={11} /> chip here. Revoke access anytime from your Google account&rsquo;s
          third-party access page.
        </p>
      </div>
    </section>
  );
}

/** The one-way Google Tasks / Calendar mirror toggle. */
function CalendarSection({ mirror }: { mirror: CalendarMirror | null }) {
  if (!mirror) {
    return (
      <section className="settings-body" aria-label="Google Calendar sync">
        <p className="settings-intro">
          Mirror tasks that have a due date into a &ldquo;Memoria&rdquo; Google Tasks list — they show up in
          Google Calendar on their due date.
        </p>
        <p className="settings-intro">
          The sync toggle lives on the board — switch to the <strong>Todos</strong> tab and open this menu
          entry again to turn it on.
        </p>
      </section>
    );
  }

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
