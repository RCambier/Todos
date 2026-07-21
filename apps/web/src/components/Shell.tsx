import { blockedColumnId, columnIds, doneColumnId } from "@memoria/sheet-core";
import { useMemo, useState } from "react";
import type { Collection, CollectionKind } from "../api/drive.js";
import type { UserProfile } from "../auth/googleAuth.js";
import { beginTasksConsent } from "../auth/session.js";
import { useBoard } from "../board/useBoard.js";
import { useColumns } from "../board/useColumns.js";
import { useTasksMirror } from "../calendar/useTasksMirror.js";
import { getCalendarMirrorEnabled, setCalendarMirrorEnabled } from "../lib/storage.js";
import { useBackClose } from "../lib/useBackClose.js";
import { useMemories } from "../memories/useMemories.js";
import { uploadMemoryAttachment } from "../notes/attachments.js";
import { useNotes } from "../notes/useNotes.js";
import { Board } from "./Board.js";
import { KindEmpty } from "./KindEmpty.js";
import { MalformedBanner } from "./MalformedBanner.js";
import { NoteEditor } from "./NoteEditor.js";
import { NotesGrid } from "./NotesGrid.js";
import { SettingsPanel, type SettingsSection } from "./SettingsPanel.js";
import { Topbar } from "./Topbar.js";

/** The settings panes available off the board view (the others omit "columns"). */
const BOARD_SECTIONS: readonly SettingsSection[] = ["columns", "agents", "calendar"];
const NON_BOARD_SECTIONS: readonly SettingsSection[] = ["agents", "calendar"];

interface ShellProps {
  /** Null while the session is still being restored — the view renders from cache and mutations queue. */
  token: string | null;
  /** True when the session couldn't be restored for network reasons (offline boot). */
  sessionOffline?: boolean;
  /** Empty string when the active kind has no connected sheet — then the tab shows inline setup (9b). */
  spreadsheetId: string;
  /** Which view this spreadsheet gets: the kanban board, the notes grid, or the AI Memories grid. */
  kind: CollectionKind;
  profile: UserProfile | null;
  /** Which kinds have a connected sheet (for the fixed Todos/Notes/AI Memories tabs). */
  connectedKinds: Record<CollectionKind, boolean>;
  /** Other tagged sheets of the active kind, offered by the empty state as "connect existing". */
  extras: Collection[];
  /** True while the Drive listing is still loading (empty state shows a placeholder, not the prompt). */
  listingLoading: boolean;
  /** False on popup-fallback deployments — the calendar mirror needs the auth backend. */
  calendarMirrorAvailable?: boolean;
  /** Whether the current session's grant includes the Google Tasks scope. */
  hasTasksScope?: boolean;
  onSelectKind: (kind: CollectionKind) => void;
  onSheetReady: (kind: CollectionKind, id: string) => void;
  onSignOut: () => void;
}

/** Chooses the view for the active kind. Empty (no sheet) → inline setup; otherwise the board, notes, or memories view. */
export function Shell(props: ShellProps) {
  if (!props.spreadsheetId) return <EmptyShell {...props} />;
  if (props.kind === "memories") return <MemoriesShell {...props} />;
  return props.kind === "notes" ? <NotesShell {...props} /> : <BoardShell {...props} />;
}

/** The active kind has no connected sheet — topbar + tabs stay, the content area is the setup (9b). */
function EmptyShell({
  token,
  kind,
  profile,
  connectedKinds,
  extras,
  listingLoading,
  onSelectKind,
  onSheetReady,
  onSignOut,
}: ShellProps) {
  const [settingsOpen, setSettingsOpen] = useState<SettingsSection | null>(null);
  useBackClose(settingsOpen !== null, () => setSettingsOpen(null));

  return (
    <div className="app">
      <Topbar
        spreadsheetId=""
        status="ready"
        lastSyncedAt={null}
        offline={false}
        pendingCount={0}
        profile={profile}
        activeKind={kind}
        connectedKinds={connectedKinds}
        onSelectKind={onSelectKind}
        onOpenSettings={setSettingsOpen}
        onSignOut={onSignOut}
      />

      {listingLoading ? (
        <div className="kind-empty">
          <p className="kind-empty-note">Loading…</p>
        </div>
      ) : (
        <KindEmpty token={token} kind={kind} extras={extras} onSheetReady={onSheetReady} />
      )}

      {settingsOpen && (
        <SettingsPanel
          section={settingsOpen}
          sections={NON_BOARD_SECTIONS}
          onClose={() => setSettingsOpen(null)}
          calendarMirror={null}
          columnsEditor={null}
        />
      )}
    </div>
  );
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
}: ShellProps) {
  const { columns, saveColumns, saveError: columnsSaveError } = useColumns(token, spreadsheetId);
  const columnOrder = useMemo(() => columnIds(columns), [columns]);
  const doneStatus = doneColumnId(columns);
  const blockedStatus = blockedColumnId(columns);
  const {
    state,
    lastSyncedAt,
    offline,
    pendingCount,
    writeRejected,
    addTask,
    updateTask,
    moveTask,
    deleteTask,
  } = useBoard(token, spreadsheetId, columnOrder, doneStatus ?? "done");
  const [settingsOpen, setSettingsOpen] = useState<SettingsSection | null>(null);
  useBackClose(settingsOpen !== null, () => setSettingsOpen(null));
  const [mirrorEnabled, setMirrorEnabled] = useState(getCalendarMirrorEnabled);

  const readOnly = state.status !== "ready";
  const tasks = state.status === "ready" ? state.tasks : [];

  const mirrorStatus = useTasksMirror({
    token,
    boardId: spreadsheetId,
    tasks: state.status === "ready" ? state.tasks : null,
    doneStatus,
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
        onOpenSettings={setSettingsOpen}
        onSignOut={onSignOut}
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
      {writeRejected && (
        <div className="banner">
          <span className="icon">⚠</span>
          <div>
            <strong>Google rejected a queued change</strong>
            <span>{writeRejected} Edit or delete that item to unblock syncing.</span>
          </div>
        </div>
      )}

      <Board
        tasks={tasks}
        columns={columns}
        doneStatus={doneStatus}
        token={token}
        readOnly={readOnly}
        // A task created already waiting on something starts in the Blocked
        // column (if the board has one), not the column whose composer happened
        // to be open.
        onAdd={(status, input) =>
          void addTask({ ...input, status: input.blockedUntil && blockedStatus ? blockedStatus : status })
        }
        onMove={(id, status, dropIndex) => void moveTask(id, status, dropIndex)}
        onEdit={(id, patch) => {
          void updateTask(id, patch);
          // The Blocked column (if designated) tracks the schedule: gaining a
          // blocked-until moves the task there; losing it (cleared, or swapped
          // for a due date) releases it to the first column. Done tasks are
          // left alone. With no Blocked column, nothing auto-moves.
          if (!blockedStatus) return;
          const current = tasks.find((t) => t.id === id);
          if (!current || (doneStatus && current.status === doneStatus)) return;
          if (patch.blockedUntil && current.status !== blockedStatus) {
            void moveTask(id, blockedStatus, 0);
          } else if (patch.blockedUntil === "" && current.status === blockedStatus) {
            void moveTask(id, columnOrder[0] ?? current.status, 0);
          }
        }}
        onDelete={(id) => void deleteTask(id)}
      />

      {settingsOpen && (
        <SettingsPanel
          section={settingsOpen}
          sections={BOARD_SECTIONS}
          onClose={() => setSettingsOpen(null)}
          columnsEditor={{ columns, saveError: columnsSaveError, onSave: saveColumns }}
          calendarMirror={
            calendarMirrorAvailable
              ? {
                  enabled: mirrorEnabled,
                  hasScope: hasTasksScope,
                  status: mirrorStatus,
                  onToggle: handleMirrorToggle,
                }
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
}: ShellProps) {
  const { state, lastSyncedAt, offline, pendingCount, writeRejected, addNote, updateNote, deleteNote } =
    useNotes(token, spreadsheetId);
  const [settingsOpen, setSettingsOpen] = useState<SettingsSection | null>(null);
  // The open note, if any — looked up live so a sync refreshes the dialog.
  const [open, setOpen] = useState<{ id: string; isNew: boolean } | null>(null);
  useBackClose(settingsOpen !== null, () => setSettingsOpen(null));
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
        onOpenSettings={setSettingsOpen}
        onSignOut={onSignOut}
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
      {writeRejected && (
        <div className="banner">
          <span className="icon">⚠</span>
          <div>
            <strong>Google rejected a queued change</strong>
            <span>{writeRejected} Edit or delete that note to unblock syncing.</span>
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

      {/* The calendar mirror and columns are board concerns; from the notes
          view the calendar pane points back to the Todos tab. */}
      {settingsOpen && (
        <SettingsPanel
          section={settingsOpen}
          sections={NON_BOARD_SECTIONS}
          onClose={() => setSettingsOpen(null)}
          calendarMirror={null}
          columnsEditor={null}
        />
      )}
    </div>
  );
}

/** The AI Memories view — the notes shell's twin, with tags on the cards and in the editor. */
function MemoriesShell({
  token,
  sessionOffline = false,
  spreadsheetId,
  profile,
  connectedKinds,
  onSelectKind,
  onSignOut,
}: ShellProps) {
  const { state, lastSyncedAt, offline, pendingCount, writeRejected, updateMemory, deleteMemory } =
    useMemories(token, spreadsheetId);
  const [settingsOpen, setSettingsOpen] = useState<SettingsSection | null>(null);
  // The open memory, if any — looked up live so a sync refreshes the dialog.
  const [open, setOpen] = useState<string | null>(null);
  useBackClose(settingsOpen !== null, () => setSettingsOpen(null));
  useBackClose(open !== null, () => setOpen(null));

  const readOnly = state.status !== "ready";
  const memories = state.status === "ready" ? state.memories : [];
  const openMemory = open ? memories.find((m) => m.id === open) : undefined;

  return (
    <div className="app">
      <Topbar
        spreadsheetId={spreadsheetId}
        status={state.status}
        lastSyncedAt={lastSyncedAt}
        offline={offline || sessionOffline}
        pendingCount={pendingCount}
        profile={profile}
        activeKind="memories"
        connectedKinds={connectedKinds}
        onSelectKind={onSelectKind}
        onOpenSettings={setSettingsOpen}
        onSignOut={onSignOut}
      />

      {state.status === "malformed" && <MalformedBanner error={state.error} spreadsheetId={spreadsheetId} />}
      {state.status === "error" && (
        <div className="banner">
          <span className="icon">⚠</span>
          <div>
            <strong>Can&rsquo;t reach the sheet right now</strong>
            <span>{state.message} Memories keep trying every few seconds.</span>
          </div>
        </div>
      )}
      {writeRejected && (
        <div className="banner">
          <span className="icon">⚠</span>
          <div>
            <strong>Google rejected a queued change</strong>
            <span>{writeRejected} Edit or delete that memory to unblock syncing.</span>
          </div>
        </div>
      )}

      {/* No onCreate: memories are written by agents (via the MCP tools), never
          composed by hand — the view is for reading and curating (edit, delete). */}
      <NotesGrid
        notes={memories}
        token={token}
        readOnly={readOnly}
        onOpen={(id) => setOpen(id)}
        provenance={false}
        copy={{
          emptyAll:
            "No memories yet. Connect an agent (Account menu → Connect from agents) and it will gather facts about you here over time.",
          noun: "memories",
        }}
      />

      {openMemory && (
        <NoteEditor
          note={openMemory}
          token={token}
          readOnly={readOnly}
          startInEdit={false}
          provenance={false}
          noun="memory"
          uploadAttachment={uploadMemoryAttachment}
          onClose={() => setOpen(null)}
          onSave={(patch) => updateMemory(openMemory.id, patch)}
          onTagsChange={(tags) => updateMemory(openMemory.id, { tags })}
          onExpiresChange={(expiresAt) => updateMemory(openMemory.id, { expiresAt })}
          onDelete={() => deleteMemory(openMemory.id)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          section={settingsOpen}
          sections={NON_BOARD_SECTIONS}
          onClose={() => setSettingsOpen(null)}
          calendarMirror={null}
          columnsEditor={null}
        />
      )}
    </div>
  );
}
