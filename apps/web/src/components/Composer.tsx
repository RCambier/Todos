import { useEffect, useRef, useState } from "react";

interface ComposerProps {
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

/** Inline top-of-column task composer. Enter adds, Escape (or losing focus empty) cancels. */
export function Composer({ onSubmit, onCancel }: ComposerProps) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(): void {
    const trimmed = title.trim();
    if (trimmed) {
      onSubmit(trimmed);
    } else {
      onCancel();
    }
  }

  return (
    <div className="composer">
      <input
        ref={inputRef}
        type="text"
        placeholder="Task title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="hint">
        <kbd>↵</kbd> add &nbsp;·&nbsp; <kbd>esc</kbd> cancel
      </div>
    </div>
  );
}
