"use client";

import { X } from "lucide-react";
import { useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Free-form list of values rendered as removable chips. Enter, Tab or a comma
 * commits the current text; pasting a list splits it on commas and newlines;
 * Backspace on an empty field removes the last chip.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  removeLabel,
  className,
  mono = true,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  ariaLabel: string;
  removeLabel: (tag: string) => string;
  className?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const commit = (raw: string) => {
    const additions = raw
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (additions.length === 0) return;
    const existing = new Set(value.map((tag) => tag.toLowerCase()));
    const next = [...value];
    for (const addition of additions) {
      if (!existing.has(addition.toLowerCase())) {
        existing.add(addition.toLowerCase());
        next.push(addition);
      }
    }
    onChange(next);
    setDraft("");
  };

  return (
    <div
      className={cn(
        "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-sm shadow-xs",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className={cn(
            "inline-flex h-7 max-w-full items-center gap-1 rounded-md border border-tone-sso/25 bg-tone-sso/10 pl-2 pr-1 text-xs text-tone-sso",
            mono && "font-mono",
          )}
        >
          <span className="truncate">{tag}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onChange(value.filter((candidate) => candidate !== tag));
            }}
            className="inline-flex size-5 items-center justify-center rounded-sm hover:bg-tone-sso/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
            aria-label={removeLabel(tag)}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        ref={inputRef}
        value={draft}
        aria-label={ariaLabel}
        placeholder={value.length === 0 ? placeholder : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (/[,\n]/.test(text)) {
            event.preventDefault();
            commit(`${draft}${text}`);
          }
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" ||
            event.key === "," ||
            (event.key === "Tab" && draft)
          ) {
            if (draft.trim()) {
              event.preventDefault();
              commit(draft);
            } else if (event.key === "Enter") {
              event.preventDefault();
            }
          } else if (event.key === "Backspace" && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        className={cn(
          "h-7 min-w-[10rem] flex-1 bg-transparent outline-none placeholder:text-muted-foreground",
          mono && "font-mono text-xs",
        )}
      />
    </div>
  );
}
