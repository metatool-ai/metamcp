"use client";

import { Suspense } from "react";

import OAuthCallback from "@/components/OAuthCallback";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useTranslations } from "@/hooks/useTranslations";

function LoadingFallback() {
  const { t } = useTranslations();
  return <div>{t("common:loading")}</div>;
}

export default function OAuthCallbackPage() {
  return (
    <div className="relative min-h-screen">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Suspense fallback={<LoadingFallback />}>
        <OAuthCallback />
      </Suspense>
    </div>
  );
}
