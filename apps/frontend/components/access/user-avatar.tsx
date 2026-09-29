"use client";

import { Users } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/** Deterministic hue (0-359) so a person keeps the same color everywhere. */
function hueFor(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

function initialsFor(name: string, email?: string | null): string {
  const source = name.trim() || email?.trim() || "?";
  const parts = source
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const [first, second] = parts;
  const letters =
    first && second
      ? `${first[0] ?? ""}${second[0] ?? ""}`
      : source.slice(0, 2);
  return letters.toUpperCase();
}

const sizes = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-12 text-sm",
} as const;

export function UserAvatar({
  name,
  email,
  image,
  seed,
  size = "md",
  className,
}: {
  name: string;
  email?: string | null;
  image?: string | null;
  seed?: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const style = {
    "--avatar-hue": hueFor(seed ?? email ?? name),
  } as CSSProperties;

  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-provided avatar URLs from the IdP
      <img
        src={image}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover",
          sizes[size],
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-wide",
        "bg-[oklch(0.93_0.045_var(--avatar-hue))] text-[oklch(0.38_0.09_var(--avatar-hue))]",
        "dark:bg-[oklch(0.34_0.06_var(--avatar-hue))] dark:text-[oklch(0.88_0.06_var(--avatar-hue))]",
        sizes[size],
        className,
      )}
    >
      {initialsFor(name, email)}
    </span>
  );
}

/** Square "group" mark, tinted like avatars so groups are recognisable. */
export function GroupAvatar({
  name,
  seed,
  size = "md",
  className,
}: {
  name: string;
  seed?: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const style = { "--avatar-hue": hueFor(seed ?? name) } as CSSProperties;
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg",
        "bg-[oklch(0.94_0.035_var(--avatar-hue))] text-[oklch(0.42_0.09_var(--avatar-hue))]",
        "dark:bg-[oklch(0.32_0.05_var(--avatar-hue))] dark:text-[oklch(0.86_0.06_var(--avatar-hue))]",
        sizes[size],
        className,
      )}
    >
      <Users className="size-[55%]" />
    </span>
  );
}
