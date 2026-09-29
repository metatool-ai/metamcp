"use client";

import { formatDistanceToNow } from "date-fns";
import { KeyRound, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useTranslations } from "@/hooks/useTranslations";
import { dateLocale } from "@/lib/date-locale";
import { trpc } from "@/lib/trpc";

/**
 * Consent step of the MetaMCP OAuth server: an MCP client asks to act on
 * behalf of the signed-in user. Nothing is issued until the user decides.
 */
function ConsentForm() {
  const { t, locale } = useTranslations();
  const request = useSearchParams().get("request") ?? "";
  const [decision, setDecision] = useState<"approve" | "deny" | null>(null);

  const me = trpc.frontend.access.me.useQuery();
  const consent = trpc.frontend.oauthConsent.describe.useQuery(
    { request },
    { enabled: request.length > 0, retry: false },
  );
  const decide = trpc.frontend.oauthConsent.decide.useMutation({
    onSuccess: ({ redirectUrl }) => {
      window.location.assign(redirectUrl);
    },
    onError: () => setDecision(null),
  });

  const submit = (approve: boolean) => {
    setDecision(approve ? "approve" : "deny");
    decide.mutate({ request, approve });
  };

  if (!request || consent.isError) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("auth:consent.invalidTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("auth:consent.invalidDescription")}
        </p>
        <Button asChild variant="outline">
          <Link href="/">{t("auth:consent.backHome")}</Link>
        </Button>
      </div>
    );
  }

  const client = consent.data;
  if (!client) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        {t("auth:consent.loading")}
      </p>
    );
  }

  const busy = decide.isPending || decision !== null;

  return (
    <div className="space-y-6">
      <div className="space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("auth:consent.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("auth:consent.intro", { client: client.clientName })}
        </p>
      </div>

      <dl className="space-y-3 rounded-lg border bg-card p-4 text-sm">
        {me.data && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">
              {t("auth:consent.signedInAs")}
            </dt>
            <dd className="truncate font-medium" title={me.data.email}>
              {me.data.email}
            </dd>
          </div>
        )}
        <div className="space-y-1">
          <dt className="text-muted-foreground">
            {t("auth:consent.redirectsTo")}
          </dt>
          <dd className="break-all font-mono text-base font-semibold">
            {client.redirectOrigin}
          </dd>
          <dd className="break-all font-mono text-xs text-muted-foreground">
            {client.redirectUri}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">{t("auth:consent.access")}</dt>
          <dd>{t("auth:consent.accessDescription")}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">
            {t("auth:consent.registered")}
          </dt>
          <dd>
            {formatDistanceToNow(new Date(client.registeredAt), {
              addSuffix: true,
              locale: dateLocale(locale),
            })}
          </dd>
        </div>
      </dl>

      <div
        role="note"
        className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200"
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{t("auth:consent.warning")}</p>
      </div>

      {decide.isError && (
        <div
          role="alert"
          className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
        >
          {t("auth:consent.error")}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={() => submit(false)} disabled={busy}>
          {decision === "deny"
            ? t("auth:consent.denying")
            : t("auth:consent.deny")}
        </Button>
        <Button onClick={() => submit(true)} disabled={busy}>
          {decision === "approve"
            ? t("auth:consent.allowing")
            : t("auth:consent.allow")}
        </Button>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>
      <div className="mx-auto flex w-full max-w-md flex-col justify-center py-12">
        <Suspense fallback={null}>
          <ConsentForm />
        </Suspense>
      </div>
    </div>
  );
}
