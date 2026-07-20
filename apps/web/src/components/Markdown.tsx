import { useEffect, useState, type ReactNode } from "react";
import { downloadFile } from "../api/drive.js";
import { parseBlocks, type InlineNode } from "../lib/markdown.js";

/**
 * Renders a note body (`lib/markdown.ts` dialect) as React elements. Images
 * with a `drive:<fileId>` source — pasted attachments — are fetched with the
 * user's token and shown from an object URL; plain `https://` images render
 * as ordinary `<img>` tags.
 */

/** Object-URL cache: each attachment is downloaded once per session. */
const driveImageCache = new Map<string, Promise<string>>();

function driveImageUrl(token: string, fileId: string): Promise<string> {
  let cached = driveImageCache.get(fileId);
  if (!cached) {
    cached = downloadFile(token, fileId).then((blob) => URL.createObjectURL(blob));
    driveImageCache.set(fileId, cached);
    cached.catch(() => driveImageCache.delete(fileId));
  }
  return cached;
}

function DriveImage({ fileId, alt, token }: { fileId: string; alt: string; token: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setFailed(false);
    driveImageUrl(token, fileId)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, fileId]);

  if (url) return <img className="md-img" src={url} alt={alt} />;
  return (
    <span className={`md-img-loading${failed ? " failed" : ""}`} role="img" aria-label={alt || "image"}>
      {failed ? "⚠ image unavailable" : alt || "Loading image…"}
    </span>
  );
}

function renderInline(nodes: InlineNode[], token: string | null, keyPrefix = ""): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`;
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return <code key={key}>{node.text}</code>;
      case "strong":
        return <strong key={key}>{renderInline(node.children, token, `${key}.`)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, token, `${key}.`)}</em>;
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
          >
            {renderInline(node.children, token, `${key}.`)}
          </a>
        );
      case "image":
        return node.src.startsWith("drive:") ? (
          <DriveImage key={key} fileId={node.src.slice("drive:".length)} alt={node.alt} token={token} />
        ) : (
          <img key={key} className="md-img" src={node.src} alt={node.alt} referrerPolicy="no-referrer" />
        );
    }
  });
}

function renderLines(lines: InlineNode[][], token: string | null): ReactNode[] {
  return lines.flatMap((line, i) => {
    const rendered = renderInline(line, token, `${i}.`);
    return i === 0 ? rendered : [<br key={`br${i}`} />, ...rendered];
  });
}

export function Markdown({ text, token }: { text: string; token: string | null }) {
  const blocks = parseBlocks(text);
  return (
    <div className="markdown">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading": {
            const H = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
            return <H key={i}>{renderInline(block.children, token)}</H>;
          }
          case "paragraph":
            return <p key={i}>{renderLines(block.lines, token)}</p>;
          case "quote":
            return <blockquote key={i}>{renderLines(block.lines, token)}</blockquote>;
          case "code":
            return (
              <pre key={i}>
                <code>{block.text}</code>
              </pre>
            );
          case "hr":
            return <hr key={i} />;
          case "bullets":
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j} className={item.checked !== undefined ? "task-item" : undefined}>
                    {item.checked !== undefined && (
                      <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} />
                    )}
                    {renderInline(item.children, token, `${j}.`)}
                  </li>
                ))}
              </ul>
            );
          case "numbered":
            return (
              <ol key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item.children, token, `${j}.`)}</li>
                ))}
              </ol>
            );
        }
      })}
    </div>
  );
}
