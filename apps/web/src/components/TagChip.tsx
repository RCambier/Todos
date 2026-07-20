import { useState } from "react";
import { setTagColor, TAG_COLORS, tagColorId } from "../lib/tagColor.js";

interface TagChipProps {
  name: string;
  /** Resolved `tag-<color>` class (from `useTagColors()` in the parent). */
  colorClass: string;
  /** Editable chips let you click to recolor and (with onRemove) delete. */
  editable?: boolean;
  onRemove?: () => void;
}

/**
 * One tag pill. Read-only by default; when `editable`, clicking the label opens
 * a small swatch picker (recolor persists locally, everywhere the tag shows)
 * and the × removes it.
 */
export function TagChip({ name, colorClass, editable, onRemove }: TagChipProps) {
  const [picking, setPicking] = useState(false);

  if (!editable) return <span className={`tag ${colorClass}`}>{name}</span>;

  return (
    <span className={`tag tag-editable ${colorClass}`}>
      <button
        type="button"
        className="tag-label"
        aria-label={`Change color of ${name}`}
        aria-haspopup="menu"
        aria-expanded={picking}
        onClick={(e) => {
          e.stopPropagation();
          setPicking((v) => !v);
        }}
      >
        {name}
      </button>
      {onRemove && (
        <button
          type="button"
          className="tag-remove"
          aria-label={`Remove tag ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
      {picking && (
        <>
          <div
            className="menu-backdrop"
            onClick={(e) => {
              e.stopPropagation();
              setPicking(false);
            }}
          />
          <div className="tag-swatches" role="menu" aria-label={`Color for ${name}`}>
            {TAG_COLORS.map((color) => {
              const active = tagColorId(name) === color;
              return (
                <button
                  key={color}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  aria-label={color}
                  className={`tag-swatch sw-${color}${active ? " active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTagColor(name, color);
                    setPicking(false);
                  }}
                />
              );
            })}
          </div>
        </>
      )}
    </span>
  );
}
