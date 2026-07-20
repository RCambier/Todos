import { useState } from "react";
import { buildClaudeCodeCliSnippet, buildConnectorUrl } from "../lib/mcpSnippet.js";

interface SettingsPanelProps {
  onClose: () => void;
  /** Null on deployments without the auth backend (the mirror needs it). */
  calendarMirror: {
    enabled: boolean;
    hasScope: boolean;
    onToggle: () => void;
  } | null;
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

export function SettingsPanel({ onClose, calendarMirror }: SettingsPanelProps) {
  const connectorUrl = buildConnectorUrl(window.location.origin);
  const cliSnippet = buildClaudeCodeCliSnippet(window.location.origin);

  const mirrorStatus = !calendarMirror
    ? null
    : !calendarMirror.enabled
      ? "Off"
      : calendarMirror.hasScope
        ? "On — tasks with a due date appear in Google Calendar"
        : "Waiting for Google permission — toggle again to finish connecting";

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h2>Connect from agents</h2>
        <p className="settings-intro">
          Your agents get the same board over MCP — list, add, move, and complete tasks. Nothing to install:
          each agent signs in with your Google account and sees only this app&rsquo;s boards, never the rest
          of your Drive.
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
            <strong>claude.ai</strong> (chats, projects, scheduled routines): Settings → Connectors → Add
            custom connector → paste the URL → approve the Google consent screen.
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
            Any other MCP client works the same way — it&rsquo;s a standard remote MCP server (Streamable HTTP
            + OAuth).
          </p>
        </div>

        <div className="settings-step">
          <h4>
            <span className="step-num">3</span> Use it
          </h4>
          <p className="step-desc">
            Ask your agent about your board — &ldquo;what&rsquo;s in progress?&rdquo; — or let a routine file
            and complete tasks. Tasks agents create carry a small ✳ chip here. Revoke access anytime from your
            Google account&rsquo;s third-party access page.
          </p>
        </div>

        {calendarMirror && (
          <div className="settings-section">
            <h2>Google Calendar</h2>
            <p className="settings-intro">
              Mirror tasks that have a due date into a &ldquo;Memoria&rdquo; Google Tasks list — they show up
              in Google Calendar on their due date. One-way: the board stays the source of truth; edits in
              Google are overwritten on the next sync.
            </p>
            <div className="mirror-row">
              <button
                type="button"
                role="switch"
                aria-checked={calendarMirror.enabled}
                className={`mirror-toggle${calendarMirror.enabled ? " on" : ""}`}
                onClick={calendarMirror.onToggle}
              >
                <span className="knob" />
              </button>
              <span className="mirror-status">{mirrorStatus}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
