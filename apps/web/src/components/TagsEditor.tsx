import { useState } from "react";
import { useTagColors } from "../lib/tagColor.js";
import { TagChip } from "./TagChip.js";

interface TagsEditorProps {
  tags: string[];
  readOnly?: boolean;
  /** Called with the full next tag list on every add/remove. */
  onChange: (tags: string[]) => void;
}

/**
 * The shared tag editor: colored chips (each recolorable and removable) plus a
 * type-to-add input. Comma or Enter commits a tag; Backspace on an empty input
 * peels the last one off. Used by the add composer and the task detail.
 */
export function TagsEditor({ tags, readOnly, onChange }: TagsEditorProps) {
  const tagClass = useTagColors();
  const [draft, setDraft] = useState("");

  function commitDraft(): void {
    const t = draft.trim().replace(/,/g, "");
    setDraft("");
    if (t !== "" && !tags.includes(t)) onChange([...tags, t]);
  }

  if (readOnly) {
    if (tags.length === 0) return null;
    return (
      <div className="card-tags">
        {tags.map((t) => (
          <TagChip key={t} name={t} colorClass={tagClass(t)} />
        ))}
      </div>
    );
  }

  return (
    <div className="composer-tags">
      {tags.map((t) => (
        <TagChip
          key={t}
          name={t}
          colorClass={tagClass(t)}
          editable
          onRemove={() => onChange(tags.filter((x) => x !== t))}
        />
      ))}
      <input
        type="text"
        className="tag-input"
        placeholder={tags.length === 0 ? "Add tag…" : ""}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commitDraft();
          }
          if (e.key === "Backspace" && draft === "" && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={commitDraft}
      />
    </div>
  );
}
