import { useEffect, useState } from "react";
import type { BoardColumn } from "@memoria/sheet-core";
import type { MirrorStatus } from "../calendar/useTasksMirror.js";
import { buildClaudeCodeCliSnippet, buildConnectorUrl } from "../lib/mcpSnippet.js";
import { AgentMark } from "./AgentMark.js";
import { ColumnsSettings } from "./ColumnsSettings.js";

/** The calendar-mirror control, present only where the auth backend can drive it (the board view). */
interface CalendarMirror {
  enabled: boolean;
  hasScope: boolean;
  /** What the mirror is actually doing — so a failure is never silent. */
  status: MirrorStatus;
  onToggle: () => void;
}

/** The board-columns editor's data, present only on the board view. */
interface ColumnsEditor {
  columns: BoardColumn[];
  saveError: string | null;
  onSave: (next: BoardColumn[]) => Promise<void>;
}

/** Which pane of the unified settings dialog is showing. */
export type SettingsSection = "columns" | "agents" | "calendar";

interface SettingsPanelProps {
  /** The pane to open on. */
  section: SettingsSection;
  /** Which panes are available (the board view adds "columns"). */
  sections: readonly SettingsSection[];
  onClose: () => void;
  /** Null on deployments/views without the mirror — the calendar pane then points to the Todos view. */
  calendarMirror: CalendarMirror | null;
  /** Null off the board view — the columns pane is board-only. */
  columnsEditor: ColumnsEditor | null;
}

const SECTION_TITLE: Record<SettingsSection, string> = {
  columns: "Board columns",
  agents: "AI agents",
  calendar: "Google Calendar",
};

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
 * The unified settings dialog. One overlay with a nav of the available panes —
 * Board columns (board view only), AI agents, and Google Calendar — so
 * settings are one consistent place instead of separate one-off drawers.
 */
export function SettingsPanel({
  section,
  sections,
  onClose,
  calendarMirror,
  columnsEditor,
}: SettingsPanelProps) {
  const [active, setActive] = useState<SettingsSection>(
    sections.includes(section) ? section : (sections[0] ?? "agents"),
  );

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

        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map((s) => (
            <button
              key={s}
              type="button"
              className={s === active ? "active" : ""}
              aria-current={s === active ? "page" : undefined}
              onClick={() => setActive(s)}
            >
              {SECTION_TITLE[s]}
            </button>
          ))}
        </nav>

        {active === "columns" && columnsEditor && (
          <ColumnsSettings
            columns={columnsEditor.columns}
            saveError={columnsEditor.saveError}
            onSave={columnsEditor.onSave}
          />
        )}
        {active === "agents" && <AgentsSection />}
        {active === "calendar" && <CalendarSection mirror={calendarMirror} />}
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

/** One-line summary of what the mirror is doing right now. */
function mirrorSummary(mirror: CalendarMirror): string {
  if (!mirror.enabled) return "Off";
  if (!mirror.hasScope) return "Waiting for Google permission — toggle again to finish connecting";
  switch (mirror.status.state) {
    case "syncing":
      return "Syncing with Google Tasks…";
    case "synced":
      return mirror.status.mirrored === 0
        ? "On — but no task has a date yet, so there's nothing to show in Calendar"
        : `On — ${mirror.status.mirrored} dated task${mirror.status.mirrored === 1 ? "" : "s"} mirrored`;
    case "error":
      return "Google rejected the last sync";
    default:
      return "On — waiting for the first sync";
  }
}

/** The one-way Google Tasks / Calendar mirror toggle. */
function CalendarSection({ mirror }: { mirror: CalendarMirror | null }) {
  if (!mirror) {
    return (
      <section className="settings-body" aria-label="Google Calendar sync">
        <p className="settings-intro">
          Mirror dated tasks into a &ldquo;Memoria&rdquo; Google Tasks list — anything with a due date, or
          blocked until a date, shows up in Google Calendar on that date.
        </p>
        <p className="settings-intro">
          The sync toggle lives on the board — switch to the <strong>Todos</strong> tab and open this menu
          entry again to turn it on.
        </p>
      </section>
    );
  }

  const failed = mirror.enabled && mirror.hasScope && mirror.status.state === "error";

  return (
    <section className="settings-body" aria-label="Google Calendar sync">
      <p className="settings-intro">
        Mirror dated tasks into a &ldquo;Memoria&rdquo; Google Tasks list, so they show up in Google Calendar
        on their date. A task appears if it has a <strong>due date</strong> or is{" "}
        <strong>blocked until</strong> a date, and isn&rsquo;t done — a task blocked until an <em>event</em>{" "}
        (&ldquo;Trip done&rdquo;) has no date, so it can&rsquo;t be placed. One-way: the board stays the
        source of truth; edits in Google are overwritten on the next sync.
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
        <span className="mirror-status">{mirrorSummary(mirror)}</span>
      </div>
      {failed && mirror.status.state === "error" && (
        <p className="mirror-error">
          {mirror.status.message}
          <br />
          <span className="mirror-error-hint">
            If this mentions the Tasks API being disabled, enable “Google Tasks API” for your project in the
            Google Cloud console, then reload.
          </span>
        </p>
      )}
    </section>
  );
}
