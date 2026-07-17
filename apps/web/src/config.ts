/** Build-time config, public by design (baked into the static bundle). See .env.example. */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY ?? "";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * Everything the app asks Google for: file access scoped to files it created
 * or the user picked, plus basic profile (name, picture, email) so the
 * account menu can show who's signed in. All non-sensitive scopes.
 */
export const AUTH_SCOPES = `openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email ${DRIVE_FILE_SCOPE}`;

export function assertConfigured(): void {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      "VITE_GOOGLE_CLIENT_ID is not set. Copy apps/web/.env.example to apps/web/.env and fill it " +
        "in — see docs/SETUP.md.",
    );
  }
}
