"use client";

import type { ResourceOwner } from "@repo/zod-types";
import { Building2 } from "lucide-react";

import { useTranslations } from "@/hooks/useTranslations";
import { cn } from "@/lib/utils";

import { UserAvatar } from "./user-avatar";

/** "You", "Organisation" or the owner's name, with a small avatar. */
export function OwnerLabel({
  owner,
  currentUserId,
  className,
}: {
  owner: ResourceOwner | null | undefined;
  currentUserId?: string | null;
  className?: string;
}) {
  const { t } = useTranslations();

  if (!owner) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-sm text-muted-foreground",
          className,
        )}
      >
        <Building2 className="size-4" aria-hidden />
        {t("access:owner.organization")}
      </span>
    );
  }

  const isMe = currentUserId !== undefined && owner.id === currentUserId;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-sm",
        className,
      )}
      title={owner.email}
    >
      <UserAvatar
        name={owner.name}
        email={owner.email}
        seed={owner.id}
        size="sm"
      />
      <span className="truncate">
        {isMe ? t("access:owner.you") : owner.name}
      </span>
    </span>
  );
}
