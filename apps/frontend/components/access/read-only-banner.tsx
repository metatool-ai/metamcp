"use client";

import type { ResourceAccess, ResourceOwner } from "@repo/zod-types";
import { EyeOff, Lock } from "lucide-react";

import { useTranslations } from "@/hooks/useTranslations";

/**
 * Explains why actions are missing on a resource shared with the user at
 * "use" level (and, optionally, that its secrets are hidden).
 */
export function ReadOnlyBanner({
  access,
  owner,
  kind,
  secretsHidden = false,
}: {
  access: ResourceAccess | null | undefined;
  owner: ResourceOwner | null | undefined;
  kind: "mcp_server" | "namespace";
  secretsHidden?: boolean;
}) {
  const { t } = useTranslations();
  if (!access || access.level !== "use") return null;

  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-tone-viewer/25 bg-tone-viewer/5 px-4 py-3"
    >
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-tone-viewer/10 text-tone-viewer">
        <Lock className="size-4" aria-hidden />
      </span>
      <div className="space-y-1 text-sm">
        <p className="font-medium">
          {t(`access:readOnly.title.${kind}`, {
            owner: owner?.name ?? t("access:owner.organization"),
          })}
        </p>
        <p className="text-muted-foreground">
          {t(`access:readOnly.description.${kind}`)}
        </p>
        {secretsHidden && (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <EyeOff className="size-3.5" aria-hidden />
            {t("access:readOnly.secretsHidden")}
          </p>
        )}
      </div>
    </div>
  );
}
