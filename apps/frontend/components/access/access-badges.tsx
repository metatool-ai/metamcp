"use client";

import type {
  MembershipSource,
  ResourceAccess,
  Role,
  ShareLevel,
} from "@repo/zod-types";
import {
  Eye,
  Fingerprint,
  KeyRound,
  Pencil,
  Plug,
  ShieldCheck,
  SquarePen,
  User,
  UserPlus,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "@/hooks/useTranslations";
import { cn } from "@/lib/utils";

const toneClasses = {
  admin: "text-tone-admin bg-tone-admin/10 border-tone-admin/25",
  editor: "text-tone-editor bg-tone-editor/10 border-tone-editor/25",
  viewer: "text-tone-viewer bg-tone-viewer/10 border-tone-viewer/25",
  sso: "text-tone-sso bg-tone-sso/10 border-tone-sso/25",
  neutral: "text-muted-foreground bg-muted border-border",
} as const;

const chipBase =
  "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-xs font-medium [&>svg]:size-3.5";

const roleIcons = { admin: ShieldCheck, editor: SquarePen, viewer: Eye };

export function RoleBadge({
  role,
  className,
  muted = false,
}: {
  role: Role;
  className?: string;
  /** Render a quieter chip (e.g. for a base role that is overridden). */
  muted?: boolean;
}) {
  const { t } = useTranslations();
  const Icon = roleIcons[role];
  return (
    <span
      className={cn(
        chipBase,
        muted ? toneClasses.neutral : toneClasses[role],
        className,
      )}
    >
      <Icon aria-hidden />
      {t(`access:roles.${role}`)}
    </span>
  );
}

const levelIcons: Record<ShareLevel, typeof Plug> = {
  use: Plug,
  edit: Pencil,
  manage: KeyRound,
};

/** "Can use / Can edit / Can manage" chip for a share level. */
export function LevelBadge({
  level,
  className,
}: {
  level: ShareLevel;
  className?: string;
}) {
  const { t } = useTranslations();
  const Icon = levelIcons[level];
  const tone =
    level === "manage"
      ? toneClasses.admin
      : level === "edit"
        ? toneClasses.editor
        : toneClasses.viewer;
  return (
    <span className={cn(chipBase, tone, className)}>
      <Icon aria-hidden />
      {t(`access:levels.${level}`)}
    </span>
  );
}

/**
 * The current user's access to a resource: owner, admin override or the
 * level shared with them (with a tooltip explaining what it allows).
 */
export function AccessBadge({
  access,
  className,
}: {
  access: ResourceAccess | null | undefined;
  className?: string;
}) {
  const { t } = useTranslations();
  if (!access) return null;

  if (access.reason === "owner") {
    return (
      <span className={cn(chipBase, toneClasses.neutral, className)}>
        <User aria-hidden />
        {t("access:reasons.owner")}
      </span>
    );
  }
  if (access.reason === "admin") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(chipBase, toneClasses.admin, className)}>
            <ShieldCheck aria-hidden />
            {t("access:reasons.admin")}
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("access:reasons.adminTooltip")}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex", className)}>
          <LevelBadge level={access.level} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {t(`access:levelDescriptions.${access.level}`)}
      </TooltipContent>
    </Tooltip>
  );
}

/** How a membership was created: synced from the IdP or added manually. */
export function SourceBadge({
  source,
  className,
}: {
  source: MembershipSource;
  className?: string;
}) {
  const { t } = useTranslations();
  const isSso = source === "oidc";
  const Icon = isSso ? Fingerprint : UserPlus;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            chipBase,
            isSso ? toneClasses.sso : toneClasses.neutral,
            className,
          )}
        >
          <Icon aria-hidden />
          {t(`access:source.${source}`)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {t(`access:source.${source}Tooltip`)}
      </TooltipContent>
    </Tooltip>
  );
}
