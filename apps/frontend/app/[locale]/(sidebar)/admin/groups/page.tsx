"use client";

import {
  ArrowRight,
  Fingerprint,
  Globe2,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { RoleBadge } from "@/components/access/access-badges";
import { GroupAvatar } from "@/components/access/user-avatar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { GroupFormDialog } from "@/components/admin/group-form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/hooks/useTranslations";
import { getLocalizedPath } from "@/lib/i18n";
import { type GroupRow, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

function GroupMark({ group }: { group: GroupRow }) {
  if (group.systemKey === "everyone") {
    return (
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Globe2 className="size-5" aria-hidden />
      </span>
    );
  }
  if (group.systemKey === "admins") {
    return (
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-tone-admin/10 text-tone-admin">
        <ShieldCheck className="size-5" aria-hidden />
      </span>
    );
  }
  return (
    <GroupAvatar name={group.name} seed={group.uuid} className="size-10" />
  );
}

function GroupCard({ group }: { group: GroupRow }) {
  const { t, locale } = useTranslations();
  const href = getLocalizedPath(`/admin/groups/${group.uuid}`, locale);
  const mappings = group.oidcGroups;

  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col gap-4 rounded-xl border bg-card p-4 transition-all",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
      )}
    >
      <div className="flex items-start gap-3">
        <GroupMark group={group} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-semibold">
              {group.systemKey === "everyone"
                ? t("access:share.everyone")
                : group.name}
            </h2>
            {group.systemKey && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("admin:groups.system")}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {group.description || t("admin:groups.noDescription")}
          </p>
        </div>
        <ArrowRight
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {group.role ? (
          <RoleBadge role={group.role} />
        ) : (
          <span className="inline-flex h-6 items-center rounded-md border border-dashed px-2 text-xs text-muted-foreground">
            {t("admin:groups.noRole")}
          </span>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" aria-hidden />
          {group.systemKey === "everyone"
            ? t("admin:groups.allUsers")
            : t("admin:groups.memberCount", { count: group.memberCount })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Share2 className="size-3.5" aria-hidden />
          {t("admin:groups.shareCount", { count: group.shareCount })}
        </span>
        {mappings.length > 0 && (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-tone-sso">
            <Fingerprint className="size-3.5 shrink-0" aria-hidden />
            <code className="truncate font-mono">{mappings[0]}</code>
            {mappings.length > 1 && <span>+{mappings.length - 1}</span>}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function GroupsPage() {
  const { t, locale } = useTranslations();
  const router = useRouter();
  const groups = trpc.frontend.admin.groups.list.useQuery();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = groups.data ?? [];
    if (!query) return list;
    return list.filter(
      (group) =>
        group.name.toLowerCase().includes(query) ||
        (group.description ?? "").toLowerCase().includes(query) ||
        group.oidcGroups.some((mapping) =>
          mapping.toLowerCase().includes(query),
        ),
    );
  }, [groups.data, search]);

  const system = filtered.filter((group) => group.systemKey);
  const custom = filtered.filter((group) => !group.systemKey);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Users}
        title={t("admin:groups.title")}
        description={t("admin:groups.description")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" aria-hidden />
            {t("admin:groups.create")}
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("admin:groups.searchPlaceholder")}
          aria-label={t("admin:groups.searchPlaceholder")}
          className="pl-8"
        />
      </div>

      {groups.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {system.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("admin:groups.systemGroups")}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {system.map((group) => (
                  <GroupCard key={group.uuid} group={group} />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("admin:groups.customGroups")}
            </h2>
            {custom.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
                <Users className="size-10 text-muted-foreground" aria-hidden />
                <div className="space-y-1">
                  <p className="font-medium">{t("admin:groups.empty.title")}</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    {t("admin:groups.empty.description")}
                  </p>
                </div>
                <Button variant="outline" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-2 size-4" aria-hidden />
                  {t("admin:groups.create")}
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {custom.map((group) => (
                  <GroupCard key={group.uuid} group={group} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <GroupFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(uuid) =>
          router.push(getLocalizedPath(`/admin/groups/${uuid}`, locale))
        }
      />
    </div>
  );
}
