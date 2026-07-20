import { useState } from "react";
import type { CollectionKind } from "../api/drive.js";
import type { UserProfile } from "../auth/googleAuth.js";
import { beginTasksConsent } from "../auth/session.js";
import { useBoard } from "../board/useBoard.js";
import { useTasksMirror } from "../calendar/useTasksMirror.js";
import { getCalendarMirrorEnabled, setCalendarMirrorEnabled } from "../lib/storage.js";
import { useBackClose } from "../lib/useBackClose.js";
import { useNotes } from "../notes/useNotes.js";
import { Board } from "./Board.js";
import { MalformedBanner } from "./MalformedBanner.js";
import { NoteEditor } from "./NoteEditor.js";
import { NotesGrid } from "./NotesGrid.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { Topbar } from "./Topbar.js";

interface ShellProps {
  /** Null while the session is still being restored — the view renders from cache and mutations queue. */
  token: string | null;
  /** True when the session couldn't be restored for network reasons (offline boot). */
  sessionOffline?: boolean;
  spreadsheetId: string;
  /** Which view this spreadsheet gets: the kanban board or the notes grid. */
  kind: CollectionKind;
  profile: UserProfile | null;
  /** Which kinds have a connected sheet (for the fixed Todos/Notes tabs). */
  connectedKinds: Record<CollectionKind, boolean>;
  /** False on popup-fallback deployments — the calendar mirror needs the auth backend. */
  calendarMirrorAvailable?: boolean;
  /** Whether the current session's grant includes the Google Tasks scope. */
  hasTasksScope?: boolean;
  onSelectKind: (kind: CollectionKind) => void;
  onSignOut: () => void;
  onOpenSetup: () => void;
}

/** Chooses the view for the active collection. Split so each view mounts only its own data hook. */
export function Shell(props: ShellProps) {
  return props.kind === "notes" ? <NotesShell {...props} /> : <BoardShell {...props} />;
}

function BoardShell({
  token,
  sessionOffline = false,
  spreadsheetId,
  profile,
  connectedKinds,
  calendarMirrorAvailable = false,
  hasTasksScope = false,
  onSelectKind,
  onSignOut,
  onOpenSetup,
}: ShellProps) {
  const { state, lastSyncedAt, offline, pendingCount, addTask, updateTask, moveTask, deleteTask } = useBoard(
    token,
    spreadsheetId,
  );
  const [settingsOpen, setSettingsOpen] = useState<false | "agents" | "calendar">(false);
  useBackClose(settingsOpen !== false, () => setSettingsOpen(false));
  const [mirrorEnabled, setMirrorEnabled] = useState(getCalendarMirrorEnabled);

  const readOnly = state.status !== "ready";
  const tasks = state.status === "ready" ? state.tasks : [];

  useTasksMirror({
    token,
    boardId: spreadsheetId,
    tasks: state.status === "ready" ? state.tasks : null,
    active: mirrorEnabled && hasTasksScope && calendarMirrorAvailable,
  });

  /** Turning it on without the scope yet → re-consent redirect; the flag survives the round-trip. */
  function handleMirrorToggle(): void {
    const next = !mirrorEnabled;
    setCalendarMirrorEnabled(next);
    setMirrorEnabled(next);
    if (next && !hasTasksScope) beginTasksConsent();
  }

  return (
    <div className="app">
      <Topbar
        spreadsheetId={spreadsheetId}
        status={state.status}
        lastSyncedAt={lastSyncedAt}
        offline={offline || sessionOffline}
        pendingCount={pendingCount}
        profile={profile}
        activeKind="board"
        connectedKinds={connectedKinds}
        onSelectKind={onSelectKind}
        onOpenSettings={(section) => setSettingsOpen(section)}
        onSignOut={onSignOut}
        onOpenSetup={onOpenSetup}
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
        onEdit={(id, patch) => void updateTask(id, patch)}
        onDelete={(id) => void deleteTask(id)}
      />

      {settingsOpen !== false && (
        <SettingsPanel
          initialSection={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          calendarMirror={
            calendarMirrorAvailable
              ? { enabled: mirrorEnabled, hasScope: hasTasksScope, onToggle: handleMirrorToggle }
              : null
          }
        />
      )}
    </div>
  );
}

function NotesShell({
  token,
  sessionOffline = false,
  spreadsheetId,
  profile,
  connectedKinds,
  onSelectKind,
  onSignOut,
  onOpenSetup,
}: ShellProps) {
  const { state, lastSyncedAt, offline, pendingCount, addNote, updateNote, deleteNote } = useNotes(
    token,
    spreadsheetId,
  );
  const [settingsOpen, setSettingsOpen] = useState<false | "agents" | "calendar">(false);
  // The open note, if any — looked up live so a sync refreshes the dialog.
  const [open, setOpen] = useState<{ id: string; isNew: boolean } | null>(null);
  useBackClose(settingsOpen !== false, () => setSettingsOpen(false));
  useBackClose(open !== null, () => setOpen(null));

  const readOnly = state.status !== "ready";
  const notes = state.status === "ready" ? state.notes : [];
  const openNote = open ? notes.find((n) => n.id === open.id) : undefined;

  function handleCreate(): void {
    const note = addNote({});
    if (note) setOpen({ id: note.id, isNew: true });
  }

  return (
    <div className="app">
      <Topbar
        spreadsheetId={spreadsheetId}
        status={state.status}
        lastSyncedAt={lastSyncedAt}
        offline={offline || sessionOffline}
        pendingCount={pendingCount}
        profile={profile}
        activeKind="notes"
        connectedKinds={connectedKinds}
        onSelectKind={onSelectKind}
        onOpenSettings={(section) => setSettingsOpen(section)}
        onSignOut={onSignOut}
        onOpenSetup={onOpenSetup}
      />

      {state.status === "malformed" && <MalformedBanner error={state.error} spreadsheetId={spreadsheetId} />}
      {state.status === "error" && (
        <div className="banner">
          <span className="icon">⚠</span>
          <div>
            <strong>Can&rsquo;t reach the sheet right now</strong>
            <span>{state.message} Notes keep trying every few seconds.</span>
          </div>
        </div>
      )}

      <NotesGrid
        notes={notes}
        token={token}
        readOnly={readOnly}
        onOpen={(id) => setOpen({ id, isNew: false })}
        onCreate={handleCreate}
      />

      {openNote && open && (
        <NoteEditor
          note={openNote}
          token={token}
          readOnly={readOnly}
          startInEdit={open.isNew}
          onClose={() => setOpen(null)}
          onSave={(patch) => updateNote(openNote.id, patch)}
          onDelete={() => deleteNote(openNote.id)}
        />
      )}

      {/* The calendar mirror is a board concern (it mirrors due-dated tasks);
          from the notes view the panel just shows the agents section. */}
      {settingsOpen !== false && (
        <SettingsPanel
          initialSection={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          calendarMirror={null}
        />
      )}
    </div>
  );
}
