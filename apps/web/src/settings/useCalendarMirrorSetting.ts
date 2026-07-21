import { CALENDAR_MIRROR_SETTING, type AppSettings } from "@memoria/sheet-core";
import { useEffect, useRef, useState } from "react";
import { findSettingsSheet } from "../api/drive.js";
import { ensureSettingsSheet, readSettings, writeSettings } from "../api/settingsSheet.js";
import { clearLegacyCalendarMirrorFlag, readLegacyCalendarMirrorFlag } from "../lib/storage.js";

/** The calendar-mirror toggle, backed by the Settings sheet in Drive. */
export interface CalendarMirrorSetting {
  /** False until the Settings sheet has been consulted — the toggle waits, so a load can't undo a click. */
  ready: boolean;
  enabled: boolean;
  /** Set when persisting a toggle to the sheet failed (the toggle reverts). */
  saveError: string | null;
  /** Flips the toggle and persists it. Resolves true only once the sheet write succeeded. */
  setEnabled: (next: boolean) => Promise<boolean>;
}

/**
 * Loads and persists the Google Tasks mirror toggle from the `Settings`
 * spreadsheet, so the setting follows the account instead of the browser.
 * The sheet is created lazily on the first toggle; until then (and while
 * offline) every read falls back to "off". A flag from the pre-sheet era
 * still in localStorage is migrated in once, then cleared.
 *
 * Pass a null token on deployments where the mirror can't run — nothing is
 * fetched and the toggle just stays off.
 */
export function useCalendarMirrorSetting(token: string | null): CalendarMirrorSetting {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sheetIdRef = useRef<string | null>(null);
  /** Last-read full grid, so writing one key preserves the others (read-modify-write). */
  const settingsRef = useRef<AppSettings>({});
  useEffect(() => {
    // Load once per mount (`ready` guards) — a refreshed token must not
    // re-read the sheet and stomp a toggle made since. A token change while
    // the first load is still in flight cancels and restarts it instead.
    if (!token || ready) return;
    let cancelled = false;
    void (async () => {
      let settings: AppSettings = {};
      try {
        const sheetId = await findSettingsSheet(token);
        if (sheetId) {
          sheetIdRef.current = sheetId;
          settings = await readSettings(token, sheetId);
        }
        const legacy = readLegacyCalendarMirrorFlag();
        if (legacy === true && settings[CALENDAR_MIRROR_SETTING] === undefined) {
          // The old localStorage flag was on and the sheet has no say yet —
          // move it in. Only clear the local flag once the write landed.
          sheetIdRef.current ??= await ensureSettingsSheet(token);
          settings = { ...settings, [CALENDAR_MIRROR_SETTING]: "on" };
          await writeSettings(token, sheetIdRef.current, settings);
        }
        // An off/overridden legacy flag carries no information — drop it.
        clearLegacyCalendarMirrorFlag();
      } catch {
        // Offline or a Drive hiccup: fall back to "off" for this session.
        // The mirror needs the network anyway, and the next boot retries.
      }
      if (cancelled) return;
      settingsRef.current = settings;
      setEnabled(settings[CALENDAR_MIRROR_SETTING] === "on");
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, ready]);

  async function persist(next: boolean): Promise<boolean> {
    if (!token) return false;
    setSaveError(null);
    setEnabled(next);
    try {
      sheetIdRef.current ??= await ensureSettingsSheet(token);
      const updated = { ...settingsRef.current, [CALENDAR_MIRROR_SETTING]: next ? "on" : "off" };
      await writeSettings(token, sheetIdRef.current, updated);
      settingsRef.current = updated;
      return true;
    } catch (err) {
      // The toggle must reflect what the sheet actually says — revert and tell.
      setEnabled(!next);
      setSaveError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  return { ready, enabled, saveError, setEnabled: persist };
}
