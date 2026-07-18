import { afterEach, describe, expect, it, vi } from "vitest";
import { findBoards, RemoteBoardCatalog, RemoteSheetStore } from "../../api/_lib/sheetStore.js";

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 404 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("findBoards", () => {
  it("lists tagged boards newest-first with id, name and modifiedTime", async () => {
    const files = [
      { id: "sheet-abc", name: "Todos", modifiedTime: "2026-07-18T10:00:00.000Z" },
      { id: "sheet-def", name: "Notes", modifiedTime: "2026-07-01T10:00:00.000Z" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ files }));
    vi.stubGlobal("fetch", fetchMock);

    const boards = await findBoards("test-token");

    expect(boards).toEqual(files);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://www.googleapis.com/drive/v3/files");
    expect(url).toContain("orderBy=modifiedTime+desc");
    expect(url).toContain("fields=files%28id%2Cname%2CmodifiedTime%29");
    expect(url).toContain(encodeURIComponent("todosBoard"));
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("returns an empty list when Drive reports no matching files", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ files: [] })));
    expect(await findBoards("test-token")).toEqual([]);
  });

  it("returns an empty list when the files field is absent entirely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    expect(await findBoards("test-token")).toEqual([]);
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
    await expect(findBoards("test-token")).rejects.toThrow(/bad token/);
  });
});

describe("RemoteSheetStore", () => {
  it("reads from the spreadsheet it was bound to, with no Drive call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ values: [["id", "title"]] }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new RemoteSheetStore("test-token", "sheet-xyz");
    await store.readRows();

    const urls = fetchMock.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("sheets.googleapis.com");
    expect(urls[0]).toContain("sheet-xyz");
  });
});

describe("RemoteBoardCatalog", () => {
  it("lists boards once and reuses the result across calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        files: [{ id: "sheet-abc", name: "Todos", modifiedTime: "2026-07-18T10:00:00.000Z" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const catalog = new RemoteBoardCatalog("test-token");
    await catalog.listBoards();
    await catalog.listBoards();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens a store bound to the requested board without touching Drive", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ values: [["id", "title"]] }));
    vi.stubGlobal("fetch", fetchMock);

    const catalog = new RemoteBoardCatalog("test-token");
    await catalog.openBoard("sheet-xyz").readRows();

    const urls = fetchMock.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("sheets.googleapis.com");
    expect(urls[0]).toContain("sheet-xyz");
  });
});
