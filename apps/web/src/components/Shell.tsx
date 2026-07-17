import { useState } from "react";
import type { UserProfile } from "../auth/googleAuth.js";
import { useBoard } from "../board/useBoard.js";
import { Board } from "./Board.js";
import { MalformedBanner } from "./MalformedBanner.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { Topbar } from "./Topbar.js";

interface ShellProps {
  token: string;
  spreadsheetId: string;
  profile: UserProfile | null;
  onSignOut: () => void;
  onSwitchBoard: () => void;
}

export function Shell({ token, spreadsheetId, profile, onSignOut, onSwitchBoard }: ShellProps) {
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
        profile={profile}
        onOpenSettings={() => setSettingsOpen(true)}
        onSignOut={onSignOut}
        onSwitchBoard={onSwitchBoard}
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
        onAdd={(status, input) => void addTask({ ...input, status })}
        onMove={(id, status, dropIndex) => void moveTask(id, status, dropIndex)}
        onDelete={(id) => void deleteTask(id)}
      />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
