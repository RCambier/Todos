import { uploadFile } from "../api/drive.js";
import { ensureMemoriaFolders } from "../api/folders.js";

/**
 * Image attachments for notes: a pasted or dropped image is uploaded to
 * `Memoria/notes/attachments/` in the user's Drive, and the note embeds it
 * as `![name](drive:<fileId>)` — resolved back through the user's own token
 * at render time (`components/Markdown.tsx`). The image is a plain Drive
 * file the user owns, visible in Drive like everything else Memoria stores.
 */

/** Only images are accepted as note attachments. */
export function isAttachableImage(file: { type: string }): boolean {
  return file.type.startsWith("image/");
}

function attachmentName(file: File | Blob): string {
  const named = file instanceof File && file.name && file.name !== "image.png" ? file.name : null;
  if (named) return named;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = (file.type.split("/")[1] ?? "png").split("+")[0];
  return `pasted-${stamp}.${ext}`;
}

/** Uploads one image and returns the markdown that embeds it. */
export async function uploadAttachment(
  token: string,
  file: File | Blob,
): Promise<{ fileId: string; markdown: string }> {
  const folders = await ensureMemoriaFolders(token);
  const name = attachmentName(file);
  const { id } = await uploadFile(token, folders.attachmentsId, name, file);
  // Alt text must survive the markdown syntax: strip characters that would
  // close the bracket early.
  const alt = name.replace(/[[\]()\n]/g, "");
  return { fileId: id, markdown: `![${alt}](drive:${id})` };
}
