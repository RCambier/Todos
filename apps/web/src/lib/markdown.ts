/**
 * A deliberately small markdown dialect for notes — headings, lists (with
 * checkboxes), quotes, fenced code, emphasis, links, and images. Parsed to a
 * typed AST and rendered to React elements (`components/Markdown.tsx`), never
 * to HTML strings — raw HTML in a note is shown as text, so there is no
 * sanitizer to get wrong and nothing an agent-written note can inject.
 *
 * Images accept two sources: `https://…` and `drive:<fileId>` — the latter is
 * what pasting an image into the editor produces (the file lands in
 * `Memoria/notes/attachments/` and is fetched back with the user's token).
 */

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "image"; src: string; alt: string };

export interface ListItem {
  children: InlineNode[];
  /** Set only for checkbox items (`- [ ]` / `- [x]`). */
  checked?: boolean;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: "paragraph"; lines: InlineNode[][] }
  | { type: "bullets"; items: ListItem[] }
  | { type: "numbered"; items: ListItem[] }
  | { type: "quote"; lines: InlineNode[][] }
  | { type: "code"; text: string }
  | { type: "hr" };

// One alternation, tried left to right: code span, image, link, bold, italic, bare URL.
const INLINE_RE =
  /(`[^`\n]+`)|(!\[[^\]\n]*\]\((?:https?:\/\/|drive:)[^\s)]+\))|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(\*\*[^*\n]+?\*\*)|(\*[^*\n]+?\*)|(https?:\/\/[^\s<>"]+)/g;

const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** Parses one line's inline markup. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const start = match.index;
    let raw = match[0];

    // Bare URLs: leave sentence-level trailing punctuation out of the link.
    if (match[6]) {
      const trimmed = raw.replace(TRAILING_PUNCTUATION, "");
      if (trimmed.length > "https://".length) raw = trimmed;
    }

    if (start > last) nodes.push({ type: "text", text: text.slice(last, start) });

    if (match[1]) {
      nodes.push({ type: "code", text: raw.slice(1, -1) });
    } else if (match[2]) {
      const m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(raw)!;
      nodes.push({ type: "image", src: m[2]!, alt: m[1]! });
    } else if (match[3]) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw)!;
      nodes.push({ type: "link", href: m[2]!, children: parseInline(m[1]!) });
    } else if (match[4]) {
      nodes.push({ type: "strong", children: parseInline(raw.slice(2, -2)) });
    } else if (match[5]) {
      nodes.push({ type: "em", children: parseInline(raw.slice(1, -1)) });
    } else {
      nodes.push({ type: "link", href: raw, children: [{ type: "text", text: raw }] });
    }
    last = start + raw.length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes;
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const BULLET_RE = /^[-*]\s+(.*)$/;
const CHECKBOX_RE = /^\[([ xX])\]\s+(.*)$/;
const NUMBERED_RE = /^\d+[.)]\s+(.*)$/;
const HR_RE = /^(?:-{3,}|\*{3,})\s*$/;
const FENCE_RE = /^```/;

/** Parses a whole note body into blocks. Pure; exported for tests. */
export function parseBlocks(text: string): Block[] {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: InlineNode[][] = [];

  function flushParagraph(): void {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraph });
      paragraph = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (FENCE_RE.test(line)) {
      flushParagraph();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i]!)) {
        code.push(lines[i]!);
        i++;
      }
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (HR_RE.test(line)) {
      flushParagraph();
      blocks.push({ type: "hr" });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        children: parseInline(heading[2]!),
      });
      continue;
    }

    const quoted = line.startsWith(">");
    if (quoted) {
      flushParagraph();
      const quoteLines: InlineNode[][] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) {
        quoteLines.push(parseInline(lines[i]!.replace(/^>\s?/, "")));
        i++;
      }
      i--;
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushParagraph();
      const items: ListItem[] = [];
      let j = i;
      while (j < lines.length) {
        const m = BULLET_RE.exec(lines[j]!);
        if (!m) break;
        const check = CHECKBOX_RE.exec(m[1]!);
        items.push(
          check
            ? { children: parseInline(check[2]!), checked: check[1] !== " " }
            : { children: parseInline(m[1]!) },
        );
        j++;
      }
      i = j - 1;
      blocks.push({ type: "bullets", items });
      continue;
    }

    const numbered = NUMBERED_RE.exec(line);
    if (numbered) {
      flushParagraph();
      const items: ListItem[] = [];
      let j = i;
      while (j < lines.length) {
        const m = NUMBERED_RE.exec(lines[j]!);
        if (!m) break;
        items.push({ children: parseInline(m[1]!) });
        j++;
      }
      i = j - 1;
      blocks.push({ type: "numbered", items });
      continue;
    }

    // Plain text: consecutive lines form one paragraph, single newlines are
    // hard breaks — what people expect when jotting notes.
    paragraph.push(parseInline(line));
  }

  flushParagraph();
  return blocks;
}
