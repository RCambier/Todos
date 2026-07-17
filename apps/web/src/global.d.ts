// Minimal shapes for the Google Identity Services and Picker globals, which
// load from Google's CDN via <script> tags — there is no npm package for
// either, so we hand-declare just the surface this app uses.

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type: string; message?: string }) => void;
  }): GoogleTokenClient;
  revoke(token: string, done: () => void): void;
}

interface GooglePickerDoc {
  id: string;
  name: string;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDoc[];
}

interface GooglePickerBuilderInstance {
  addView(view: unknown): GooglePickerBuilderInstance;
  setOAuthToken(token: string): GooglePickerBuilderInstance;
  setDeveloperKey(key: string): GooglePickerBuilderInstance;
  setCallback(cb: (response: GooglePickerResponse) => void): GooglePickerBuilderInstance;
  build(): { setVisible(visible: boolean): void };
}

interface GooglePickerNamespace {
  Action: { PICKED: string; CANCEL: string };
  ViewId: { SPREADSHEETS: string };
  DocsView: new (viewId: string) => unknown;
  PickerBuilder: new () => GooglePickerBuilderInstance;
}

interface Window {
  google?: {
    accounts: { oauth2: GoogleAccountsOAuth2 };
    picker: GooglePickerNamespace;
  };
  gapi?: {
    load(api: string, callback: () => void): void;
  };
}
