import { useState } from "react";
import { useBoard } from "../board/useBoard.js";
import { Board } from "./Board.js";
import { MalformedBanner } from "./MalformedBanner.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { Topbar } from "./Topbar.js";

interface ShellProps {
  token: string;
  spreadsheetId: string;
  onDisconnect: () => void;
}

export function Shell({ token, spreadsheetId, onDisconnect }: ShellProps) {
  const { state, lastSyncedAt, addTask, moveTask, deleteTask } = useBoard(token, spreadsheetId);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const readOnly = state.status !== "ready";
  const tasks = state.status === "ready" ? state.tasks : [];

  return (
    <div className="app">
      <Topbar
        spreadsheetId={spreadsheetId}
        boardStatus={state.status}
        lastSyncedAt={lastSyncedAt}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {state.status === "malformed" && <MalformedBanner error={state.error} spreadsheetId={spreadsheetId} />}
      {state.status === "error" && (
        <div className="banner">
          <span className="icon">⚠</span>
          <div>
            <strong>Can&rsquo;t reach the sheet right now</strong>
            <span>{state.message} The board keeps trying every few seconds.</span>
          </div>
        </div>
      )}

      <Board
        tasks={tasks}
        readOnly={readOnly}
        onAdd={(status, title) => void addTask({ title, status })}
        onMove={(id, status, dropIndex) => void moveTask(id, status, dropIndex)}
        onDelete={(id) => void deleteTask(id)}
      />

      {settingsOpen && (
        <SettingsPanel
          token={token}
          spreadsheetId={spreadsheetId}
          onClose={() => setSettingsOpen(false)}
          onDisconnect={onDisconnect}
        />
      )}
    </div>
  );
}
