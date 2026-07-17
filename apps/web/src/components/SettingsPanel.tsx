import { useState } from "react";
import { shareWithServiceAccount } from "../api/drive.js";
import { buildMcpConfigSnippet } from "../lib/mcpSnippet.js";

interface SettingsPanelProps {
  token: string;
  spreadsheetId: string;
  onClose: () => void;
  onDisconnect: () => void;
}

type ShareStatus = { kind: "idle" | "sharing" | "success" | "error"; message?: string };

export function SettingsPanel({ token, spreadsheetId, onClose, onDisconnect }: SettingsPanelProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<ShareStatus>({ kind: "idle" });
  const snippet = buildMcpConfigSnippet(spreadsheetId);

  async function handleShare(): Promise<void> {
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus({ kind: "sharing" });
    try {
      await shareWithServiceAccount(token, spreadsheetId, trimmed);
      setStatus({ kind: "success", message: `Shared with ${trimmed} as a writer.` });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close" aria-label="Close settings" onClick={onClose}>
          ×
        </button>
        <h2>Settings</h2>

        <div>
          <h3>Connect an agent</h3>
          <p style={{ fontSize: "12.5px", color: "var(--ink-muted)", margin: "0 0 10px" }}>
            Paste your service account&rsquo;s email to share this board with it — writer access, no
            notification email sent.
          </p>
          <div className="field">
            <input
              type="email"
              placeholder="my-agent@my-project.iam.gserviceaccount.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="btn-primary" onClick={handleShare} disabled={status.kind === "sharing"}>
              {status.kind === "sharing" ? "Sharing…" : "Share"}
            </button>
            {status.message && (
              <span
                className={`status-msg${status.kind === "success" ? " success" : ""}${status.kind === "error" ? " error" : ""}`}
              >
                {status.message}
              </span>
            )}
          </div>
        </div>

        <hr />

        <div>
          <h3>Spreadsheet ID</h3>
          <pre>{spreadsheetId}</pre>
        </div>

        <div>
          <h3>MCP config</h3>
          <p style={{ fontSize: "12.5px", color: "var(--ink-muted)", margin: "0 0 10px" }}>
            Add to your Claude Code or Codex MCP settings. Point <code>GOOGLE_APPLICATION_CREDENTIALS</code>{" "}
            at your service account&rsquo;s key file.
          </p>
          <pre>{snippet}</pre>
        </div>

        <hr />

        <button className="top-link" style={{ alignSelf: "flex-start" }} onClick={onDisconnect}>
          Disconnect this browser
        </button>
      </div>
    </div>
  );
}
