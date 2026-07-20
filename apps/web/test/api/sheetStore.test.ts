import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteCatalog } from "../../api/_lib/sheetStore.js";
import { findCollections } from "../../src/api/drive.js";
import { HttpSheetStore } from "../../src/api/sheetStore.js";

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 404 });
}

/** A Drive files.list payload with one board and one notes collection. */
const mixedFiles = {
  files: [
    {
      id: "sheet-board",
      name: "Todos",
      modifiedTime: "2026-07-18T10:00:00.000Z",
      appProperties: { todosBoard: "1" },
    },
    {
      id: "sheet-notes",
      name: "Notes",
      modifiedTime: "2026-07-01T10:00:00.000Z",
      appProperties: { memoriaNotes: "1" },
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("findCollections", () => {
  it("lists tagged sheets newest-first, deriving each file's kind from its appProperties", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mixedFiles));
    vi.stubGlobal("fetch", fetchMock);

    const collections = await findCollections("test-token");

    expect(collections).toEqual([
      { id: "sheet-board", name: "Todos", modifiedTime: "2026-07-18T10:00:00.000Z", kind: "board" },
      { id: "sheet-notes", name: "Notes", modifiedTime: "2026-07-01T10:00:00.000Z", kind: "notes" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://www.googleapis.com/drive/v3/files");
    expect(url).toContain("orderBy=modifiedTime+desc");
    expect(url).toContain(encodeURIComponent("todosBoard"));
    expect(url).toContain(encodeURIComponent("memoriaNotes"));
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("returns an empty list when Drive reports no matching files", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ files: [] })));
    expect(await findCollections("test-token")).toEqual([]);
  });

  it("returns an empty list when the files field is absent entirely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    expect(await findCollections("test-token")).toEqual([]);
  });

  it("propagates a Google API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { message: "bad token" } }), { status: 401 }),
        ),
    );
    await expect(findCollections("test-token")).rejects.toThrow(/bad token/);
  });
});

describe("HttpSheetStore", () => {
  it("reads from the spreadsheet it was bound to, with no Drive call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ values: [["id", "title"]] }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new HttpSheetStore("test-token", "sheet-xyz");
    await store.readRows();

    const urls = fetchMock.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("sheets.googleapis.com");
    expect(urls[0]).toContain("sheet-xyz");
  });
});

describe("RemoteCatalog", () => {
  it("serves boards and notes collections from one Drive listing, split by kind", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mixedFiles));
    vi.stubGlobal("fetch", fetchMock);

    const catalog = new RemoteCatalog("test-token");
    const boards = await catalog.listBoards();
    const notes = await catalog.listNotesCollections();

    // Kind is an internal discriminator — the tool output shape stays BoardInfo.
    expect(boards).toEqual([{ id: "sheet-board", name: "Todos", modifiedTime: "2026-07-18T10:00:00.000Z" }]);
    expect(notes).toEqual([{ id: "sheet-notes", name: "Notes", modifiedTime: "2026-07-01T10:00:00.000Z" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens a store bound to the requested board without touching Drive", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ values: [["id", "title"]] }));
    vi.stubGlobal("fetch", fetchMock);

    const catalog = new RemoteCatalog("test-token");
    await catalog.openBoard("sheet-xyz").readRows();

    const urls = fetchMock.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("sheets.googleapis.com");
    expect(urls[0]).toContain("sheet-xyz");
  });

  it("binds openNotes to the Notes tab", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ values: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const catalog = new RemoteCatalog("test-token");
    await catalog.openNotes("sheet-notes").readRows();

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("sheet-notes");
    expect(decodeURIComponent(url)).toContain("Notes!");
  });
});
