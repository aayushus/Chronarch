import React, { useEffect, useMemo, useRef, useState } from "react";

import Icon, { IconName } from "./Icon";

export interface PaletteAction {
  id: string;
  title: string;
  hint: string;
  icon: IconName;
  run: () => void;
}

interface Props {
  open: boolean;
  actions: PaletteAction[];
  onClose: () => void;
}

/** Command palette (Chronarch design philosophy): ⌘K everywhere. Fuzzy
 * substring filter, ↑↓ + Enter keyboard flow, Esc closes.
 */
export default function Palette({ open, actions, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => `${a.title} ${a.hint}`.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open ]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  function choose(i: number) {
    const action = matches[Math.min(i, matches.length - 1)];
    if (!action) return;
    onClose();
    action.run();
  }

  return (
    <div className="palette-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette-card mount-rise">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command or describe a meeting…"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              choose(index);
            }
          }}
        />
        <div className="palette-list">
          {matches.length === 0 && <div className="palette-row">No matches</div>}
          {matches.map((a, i) => (
            <div
              key={a.id}
              className={`palette-row${i === index ? " selected" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(i)}
            >
              <Icon name={a.icon} size={15} />
              {a.title}
              <small>{a.hint}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
