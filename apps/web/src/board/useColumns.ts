import { LEGACY_COLUMNS, type BoardColumn } from "@memoria/sheet-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { readColumnsTab, writeColumnsTab } from "../api/columnsSheet.js";
import { readColumnsCache, writeColumnsCache } from "../lib/storage.js";

interface UseColumnsResult {
  /** The board's columns, in display order. Empty only before the first read of a board with no cache. */
  columns: BoardColumn[];
  /** True once the columns have been read from the sheet (or restored from cache) at least once. */
  ready: boolean;
  /** Persists a new column set to the sheet, optimistically. Rejects (and reconciles) on write failure. */
  saveColumns: (next: BoardColumn[]) => Promise<void>;
  /** Last save error, surfaced so a failed settings write is never silent. */
  saveError: string | null;
}

/**
 * Owns one board's column configuration (the `Columns` tab), the mirror of
 * `useBoard` for settings rather than tasks:
 *
 * - Paints instantly from a per-board cache, then reads the tab.
 * - **Migration**: a board with no `Columns` tab (every board created before
 *   customizable columns) is migrated once, in place, to the legacy column
 *   set — so an existing board keeps exactly the columns it always showed,
 *   now stored explicitly. Brand-new boards are created with their tab
 *   already written, so they never hit this path.
 * - Saves are optimistic and whole-tab (reordering/removing a column
 *   rewrites the small config grid); a failed save reconciles from the sheet.
 */
export function useColumns(token: string | null, spreadsheetId: string | null): UseColumnsResult {
  const [columns, setColumns] = useState<BoardColumn[]>(() =>
    spreadsheetId ? (readColumnsCache(spreadsheetId) ?? []) : [],
  );
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset when the board changes (render-time guard, like useBoard).
  const boardIdRef = useRef(spreadsheetId);
  if (boardIdRef.current !== spreadsheetId) {
    boardIdRef.current = spreadsheetId;
    setColumns(spreadsheetId ? (readColumnsCache(spreadsheetId) ?? []) : []);
    setReady(false);
    setSaveError(null);
  }

  const migratedRef = useRef<string | null>(null);

  const adopt = useCallback((id: string, next: BoardColumn[]) => {
    if (boardIdRef.current !== id) return;
    setColumns(next);
    writeColumnsCache(id, next);
  }, []);

  useEffect(() => {
    if (!token || !spreadsheetId) return;
    let cancelled = false;
    void (async () => {
      try {
        const fromSheet = await readColumnsTab(token, spreadsheetId);
        if (cancelled || boardIdRef.current !== spreadsheetId) return;
        if (fromSheet && fromSheet.length > 0) {
          adopt(spreadsheetId, fromSheet);
        } else if (migratedRef.current !== spreadsheetId) {
          // No columns tab (or an empty one): migrate this pre-customization
          // board to the legacy set, once, preserving its historical columns.
          migratedRef.current = spreadsheetId;
          const legacy = [...LEGACY_COLUMNS];
          adopt(spreadsheetId, legacy);
          await writeColumnsTab(token, spreadsheetId, legacy);
        }
      } catch {
        // Transient read/migration failure — keep the cached columns; the
        // next mount retries. Never blocks the board.
      } finally {
        if (!cancelled && boardIdRef.current === spreadsheetId) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, spreadsheetId, adopt]);

  const saveColumns = useCallback(
    async (next: BoardColumn[]) => {
      if (!token || !spreadsheetId) return;
      const previous = columns;
      setSaveError(null);
      adopt(spreadsheetId, next);
      try {
        await writeColumnsTab(token, spreadsheetId, next);
      } catch (err) {
        // Roll back to what the sheet last confirmed and surface the failure.
        adopt(spreadsheetId, previous);
        const message = err instanceof Error ? err.message : String(err);
        setSaveError(message);
        throw err;
      }
    },
    [token, spreadsheetId, columns, adopt],
  );

  return { columns, ready, saveColumns, saveError };
}
