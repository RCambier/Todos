import { GOOGLE_API_KEY } from "../config.js";

// Types for `window.google.picker` / `window.gapi` live in ../global.d.ts —
// both load from Google's CDN via <script> tags, there is no npm package.

let gapiLoadPromise: Promise<void> | null = null;

function loadPickerApi(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (gapiLoadPromise) return gapiLoadPromise;

  gapiLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.gapi?.load("picker", () => resolve());
    };
    script.onerror = () => reject(new Error("Failed to load the Google Picker script."));
    document.head.appendChild(script);
  });
  return gapiLoadPromise;
}

/**
 * Opens the Google Picker restricted to Sheets, and resolves with the
 * chosen file's ID, or `null` if the user cancelled.
 */
export async function pickSpreadsheet(token: string): Promise<string | null> {
  await loadPickerApi();
  if (!window.google?.picker) throw new Error("Google Picker failed to load.");
  const picker = window.google.picker;

  return new Promise<string | null>((resolve, reject) => {
    try {
      const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
      const builder = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setCallback((response) => {
          if (response.action === picker.Action.PICKED) {
            resolve(response.docs?.[0]?.id ?? null);
          } else if (response.action === picker.Action.CANCEL) {
            resolve(null);
          }
        });
      builder.build().setVisible(true);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
