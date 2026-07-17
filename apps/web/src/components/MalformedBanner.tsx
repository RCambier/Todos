import type { SheetError } from "@todos/sheet-core";

interface MalformedBannerProps {
  error: SheetError;
  spreadsheetId: string;
}

/** Precise, read-only-mode banner — never "repairs" the sheet, just says what's wrong and where. */
export function MalformedBanner({ error, spreadsheetId }: MalformedBannerProps) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  return (
    <div className="banner">
      <span className="icon">⚠</span>
      <div>
        <strong>Sheet doesn&rsquo;t match the expected format</strong>
        <span>
          {error.message}{" "}
          <a href={url} target="_blank" rel="noreferrer">
            Open the sheet
          </a>{" "}
          to fix it — the board will resume on the next sync.
        </span>
      </div>
    </div>
  );
}
