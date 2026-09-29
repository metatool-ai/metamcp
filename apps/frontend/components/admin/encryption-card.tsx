"use client";

import type { EncryptionKeyState } from "@repo/zod-types";
import {
  CircleAlert,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
  Vault,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const STATE_STYLES: Record<EncryptionKeyState, string> = {
  active: "border-tone-sso/30 bg-tone-sso/10 text-tone-sso",
  pending: "border-tone-editor/30 bg-tone-editor/10 text-tone-editor",
  retired: "border-border bg-muted text-muted-foreground",
};

function formatDate(value: string | Date, locale: string) {
  return new Date(value).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Encryption at rest (administrators): where the key protecting stored
 * secrets comes from, the data keys and their rotation.
 */
export function EncryptionCard() {
  const { t, locale } = useTranslations();
  const utils = trpc.useUtils();
  const status = trpc.frontend.admin.security.getEncryptionStatus.useQuery();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rotate = trpc.frontend.admin.security.rotateDataKey.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:security.rotateError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:security.rotated"), {
        description: result.activatesAt
          ? t("admin:security.rotatedDescription", {
              key: result.keyId ?? "",
              time: formatDate(result.activatesAt, locale),
            })
          : undefined,
      });
      setConfirmOpen(false);
      await utils.frontend.admin.security.getEncryptionStatus.invalidate();
    },
    onError: (error) =>
      toast.error(t("admin:security.rotateError"), {
        description: error.message,
      }),
  });

  const data = status.data;
  const delayMinutes = data
    ? Math.max(1, Math.round(data.activationDelaySeconds / 60))
    : 0;

  const source = data?.source;
  const SourceIcon =
    source === "openbao"
      ? Vault
      : source === "dedicated"
        ? KeyRound
        : Fingerprint;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockKeyhole className="size-5 text-tone-sso" aria-hidden />
          {t("admin:security.title")}
        </CardTitle>
        <CardDescription>{t("admin:security.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {status.isLoading || !data ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : (
          <>
            {/* Key source */}
            <div
              className={cn(
                "flex items-start gap-3 rounded-lg border p-4",
                source === "derived"
                  ? data.usesExampleAuthSecret
                    ? "border-tone-danger/30 bg-tone-danger/5"
                    : "border-tone-admin/30 bg-tone-admin/5"
                  : "border-tone-sso/25 bg-tone-sso/5",
              )}
            >
              <SourceIcon
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  source === "derived"
                    ? data.usesExampleAuthSecret
                      ? "text-tone-danger"
                      : "text-tone-admin"
                    : "text-tone-sso",
                )}
                aria-hidden
              />
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium">
                  {t(`admin:security.source.${source}.title`)}
                </p>
                <p className="text-muted-foreground">
                  {source === "derived" && data.usesExampleAuthSecret
                    ? t("admin:security.source.derived.exampleSecret")
                    : t(`admin:security.source.${source}.description`)}
                </p>
                {Object.keys(data.details).length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pt-1 text-xs">
                    {Object.entries(data.details).map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="text-muted-foreground">
                          {t(`admin:security.details.${key}`)}
                        </dt>
                        <dd className="truncate font-mono">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>

            {data.plaintextValues > 0 && (
              <p className="flex items-center gap-2 text-sm text-tone-admin">
                <CircleAlert className="size-4 shrink-0" aria-hidden />
                {t("admin:security.plaintextPending", {
                  count: data.plaintextValues,
                })}
              </p>
            )}

            {/* What is protected */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="mb-1 flex items-center gap-2 text-sm font-medium">
                  <LockKeyhole className="size-4 text-tone-sso" aria-hidden />
                  {t("admin:security.encryptedTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("admin:security.encryptedList")}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-1 flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="size-4 text-tone-sso" aria-hidden />
                  {t("admin:security.hashedTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("admin:security.hashedList")}
                </p>
              </div>
            </div>

            {/* Data keys */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">
                  {t("admin:security.keysTitle")}
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={rotate.isPending}
                >
                  <RefreshCcw className="mr-2 size-4" aria-hidden />
                  {t("admin:security.rotate")}
                </Button>
              </div>
              <ul className="divide-y rounded-lg border">
                {data.keys.map((key) => (
                  <li
                    key={key.id}
                    className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3"
                  >
                    <code className="font-mono text-xs">{key.id}</code>
                    <span
                      className={cn(
                        "inline-flex h-5 w-fit items-center rounded-md border px-1.5 text-[11px] font-medium",
                        STATE_STYLES[key.state],
                      )}
                    >
                      {t(`admin:security.state.${key.state}`)}
                    </span>
                    <span className="text-xs text-muted-foreground sm:ml-auto">
                      {key.state === "pending"
                        ? t("admin:security.activatesAt", {
                            time: formatDate(key.activatedAt, locale),
                          })
                        : t("admin:security.createdAt", {
                            time: formatDate(key.createdAt, locale),
                          })}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground sm:w-28 sm:text-right">
                      {t("admin:security.values", { count: key.values })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin:security.rotateTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin:security.rotateDescription", {
                minutes: delayMinutes,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                rotate.mutate();
              }}
              disabled={rotate.isPending}
            >
              {t("admin:security.rotateConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
