"use client";

import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Fingerprint,
  FlaskConical,
  RefreshCw,
  ShieldOff,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/access/access-badges";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/hooks/useTranslations";
import { getLocalizedPath } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

function FlowStep({
  index,
  title,
  description,
  tone,
}: {
  index: number;
  title: string;
  description: string;
  tone: "sso" | "editor" | "admin";
}) {
  const toneClass = {
    sso: "bg-tone-sso/10 text-tone-sso border-tone-sso/25",
    editor: "bg-tone-editor/10 text-tone-editor border-tone-editor/25",
    admin: "bg-tone-admin/10 text-tone-admin border-tone-admin/25",
  }[tone];
  return (
    <li className="flex min-w-0 flex-1 items-start gap-3">
      <span
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
          toneClass,
        )}
      >
        {index}
      </span>
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </li>
  );
}

export default function SsoPage() {
  const { t, locale } = useTranslations();
  const utils = trpc.useUtils();
  const settings = trpc.frontend.admin.sso.getSettings.useQuery();
  const groups = trpc.frontend.admin.groups.list.useQuery();
  const [claim, setClaim] = useState("");
  const [sample, setSample] = useState("");

  useEffect(() => {
    if (settings.data) setClaim(settings.data.groupsClaim);
  }, [settings.data]);

  const update = trpc.frontend.admin.sso.updateSettings.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:sso.saveError"), { description: result.message });
        return;
      }
      toast.success(t("admin:sso.saved"));
      await utils.frontend.admin.sso.invalidate();
    },
    onError: (error) =>
      toast.error(t("admin:sso.saveError"), { description: error.message }),
  });
  const test = trpc.frontend.admin.sso.testMapping.useMutation();

  const mapped = (groups.data ?? []).filter(
    (group) => group.oidcGroups.length > 0,
  );
  const sampleGroups = sample
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Fingerprint}
        title={t("admin:sso.title")}
        description={t("admin:sso.description")}
      />

      {settings.isLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : settings.data?.oidcConfigured ? (
        <div className="flex items-start gap-3 rounded-xl border border-tone-sso/25 bg-tone-sso/5 p-4">
          <CheckCircle2 className="mt-0.5 size-5 text-tone-sso" aria-hidden />
          <div className="space-y-0.5 text-sm">
            <p className="font-medium">{t("admin:sso.configured")}</p>
            <p className="text-muted-foreground">
              {t("admin:sso.providerId")}{" "}
              <code className="font-mono text-foreground">
                {settings.data.providerId}
              </code>
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-tone-admin/25 bg-tone-admin/5 p-4">
          <CircleAlert className="mt-0.5 size-5 text-tone-admin" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium">{t("admin:sso.notConfigured")}</p>
            <p className="text-muted-foreground">
              {t("admin:sso.notConfiguredHelp")}
            </p>
          </div>
        </div>
      )}

      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold">{t("admin:sso.flow.title")}</h2>
        <ol className="flex flex-col gap-4 md:flex-row md:items-start">
          <FlowStep
            index={1}
            tone="sso"
            title={t("admin:sso.flow.step1")}
            description={t("admin:sso.flow.step1Help", {
              claim: settings.data?.groupsClaim ?? "groups",
            })}
          />
          <ArrowRight
            className="hidden size-4 shrink-0 self-center text-muted-foreground md:block"
            aria-hidden
          />
          <FlowStep
            index={2}
            tone="editor"
            title={t("admin:sso.flow.step2")}
            description={t("admin:sso.flow.step2Help")}
          />
          <ArrowRight
            className="hidden size-4 shrink-0 self-center text-muted-foreground md:block"
            aria-hidden
          />
          <FlowStep
            index={3}
            tone="admin"
            title={t("admin:sso.flow.step3")}
            description={t("admin:sso.flow.step3Help")}
          />
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-5 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">{t("admin:sso.settings")}</h2>
          <div className="space-y-2">
            <Label htmlFor="groups-claim">{t("admin:sso.groupsClaim")}</Label>
            <div className="flex gap-2">
              <Input
                id="groups-claim"
                value={claim}
                onChange={(event) => setClaim(event.target.value)}
                className="font-mono"
              />
              <Button
                variant="outline"
                disabled={
                  !claim.trim() ||
                  claim === settings.data?.groupsClaim ||
                  update.isPending
                }
                onClick={() => update.mutate({ groupsClaim: claim.trim() })}
              >
                {t("admin:sso.save")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("admin:sso.groupsClaimHelp")}
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 border-t pt-4">
            <div className="space-y-1">
              <Label htmlFor="sync-groups" className="flex items-center gap-2">
                <RefreshCw
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                {t("admin:sso.syncGroups")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("admin:sso.syncGroupsHelp")}
              </p>
            </div>
            <Switch
              id="sync-groups"
              checked={settings.data?.syncGroups ?? true}
              disabled={!settings.data || update.isPending}
              onCheckedChange={(checked) =>
                update.mutate({ syncGroups: checked })
              }
            />
          </div>

          <div className="flex items-start justify-between gap-4 border-t pt-4">
            <div className="space-y-1">
              <Label
                htmlFor="require-match"
                className="flex items-center gap-2"
              >
                <ShieldOff
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                {t("admin:sso.requireMatch")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("admin:sso.requireMatchHelp")}
              </p>
            </div>
            <Switch
              id="require-match"
              checked={settings.data?.requireGroupMatch ?? false}
              disabled={!settings.data || update.isPending}
              onCheckedChange={(checked) =>
                update.mutate({ requireGroupMatch: checked })
              }
            />
          </div>
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-tone-sso" aria-hidden />
            <h2 className="font-semibold">{t("admin:sso.tester.title")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("admin:sso.tester.description")}
          </p>
          <Textarea
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            placeholder={t("admin:sso.tester.placeholder")}
            aria-label={t("admin:sso.tester.title")}
            className="font-mono text-xs"
            rows={4}
          />
          <Button
            variant="outline"
            className="w-full"
            disabled={sampleGroups.length === 0 || test.isPending}
            onClick={() => test.mutate({ groups: sampleGroups })}
          >
            {t("admin:sso.tester.run")}
          </Button>
          {test.data && (
            <div role="status" className="space-y-3 rounded-lg border p-3">
              {test.data.denied ? (
                <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <ShieldOff className="size-4" aria-hidden />
                  {t("admin:sso.tester.denied")}
                </p>
              ) : (
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {t("admin:sso.tester.resultingRole")}
                  <RoleBadge role={test.data.resultingRole} />
                </p>
              )}
              {test.data.matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("admin:sso.tester.noMatch")}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {test.data.matches.map((match) => (
                    <li
                      key={match.groupUuid}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="font-medium">{match.groupName}</span>
                      {match.role && <RoleBadge role={match.role} />}
                      <span className="text-xs text-muted-foreground">
                        ←{" "}
                        <code className="font-mono">
                          {match.matchedBy.join(", ")}
                        </code>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t("admin:sso.mappings.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("admin:sso.mappings.description")}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={getLocalizedPath("/admin/groups", locale)}>
              <Users className="mr-2 size-4" aria-hidden />
              {t("admin:sso.mappings.manage")}
            </Link>
          </Button>
        </div>
        {mapped.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("admin:sso.mappings.empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {mapped.map((group) => (
              <li key={group.uuid}>
                <Link
                  href={getLocalizedPath(`/admin/groups/${group.uuid}`, locale)}
                  className="flex flex-col gap-2 px-4 py-3 hover:bg-accent/40 sm:flex-row sm:items-center"
                >
                  <span className="flex flex-1 flex-wrap gap-1.5">
                    {group.oidcGroups.map((value) => (
                      <code
                        key={value}
                        className="rounded border border-tone-sso/25 bg-tone-sso/10 px-1.5 py-0.5 font-mono text-xs text-tone-sso"
                      >
                        {value}
                      </code>
                    ))}
                  </span>
                  <ArrowRight
                    className="hidden size-4 shrink-0 text-muted-foreground sm:block"
                    aria-hidden
                  />
                  <span className="flex items-center gap-2 sm:w-64">
                    <span className="truncate text-sm font-medium">
                      {group.name}
                    </span>
                    {group.role && <RoleBadge role={group.role} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
