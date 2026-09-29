"use client";

import type { LucideIcon } from "lucide-react";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { useTranslations } from "@/hooks/useTranslations";

/** Page header shared by the administration pages. */
export function AdminPageHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  const { t } = useTranslations();
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-xl border bg-card text-primary shadow-xs">
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-tone-admin">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("admin:eyebrow")}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="max-w-2xl text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
