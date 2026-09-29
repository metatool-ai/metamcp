"use client";

import { ArrowLeft, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { RoleBadge } from "@/components/access/access-badges";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/useAccess";
import { useTranslations } from "@/hooks/useTranslations";
import { getLocalizedPath } from "@/lib/i18n";

function AccessDeniedContent() {
  const { t, locale } = useTranslations();
  const { role } = useAccess();
  const searchParams = useSearchParams();
  // Echoed from the URL: only when it looks like an application path, so a
  // crafted link cannot display arbitrary text here.
  const fromParam = searchParams.get("from");
  const from =
    fromParam && /^\/[\w\-./]{0,200}$/.test(fromParam) ? fromParam : null;

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="relative mb-6">
          <div
            aria-hidden
            className="absolute inset-0 -m-4 rounded-full bg-[radial-gradient(circle,var(--color-tone-admin)_0%,transparent_70%)] opacity-15"
          />
          <span className="relative inline-flex size-16 items-center justify-center rounded-2xl border bg-card shadow-sm">
            <LockKeyhole className="size-8 text-tone-admin" aria-hidden />
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("access:denied.title")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t("access:denied.description")}
        </p>
        {from && (
          <p className="mt-3 font-mono text-xs text-muted-foreground">{from}</p>
        )}
        {role && (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            {t("access:denied.yourRole")} <RoleBadge role={role} />
          </p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          {t("access:denied.contact")}
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href={getLocalizedPath("/mcp-servers", locale)}>
            <ArrowLeft className="mr-2 size-4" aria-hidden />
            {t("access:denied.back")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function AccessDeniedPage() {
  return (
    <Suspense>
      <AccessDeniedContent />
    </Suspense>
  );
}
