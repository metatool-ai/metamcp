"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Fingerprint,
  FlaskConical,
  Globe2,
  MoreHorizontal,
  Package,
  Pencil,
  Server,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  LevelBadge,
  RoleBadge,
  SourceBadge,
} from "@/components/access/access-badges";
import { GroupAvatar, UserAvatar } from "@/components/access/user-avatar";
import { AddMembersDialog } from "@/components/admin/add-members-dialog";
import { GroupFormDialog } from "@/components/admin/group-form-dialog";
import { TagInput } from "@/components/admin/tag-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/hooks/useTranslations";
import { dateLocale } from "@/lib/date-locale";
import { getLocalizedPath } from "@/lib/i18n";
import { type GroupDetailRow, trpc } from "@/lib/trpc";

function MembersTab({ group }: { group: GroupDetailRow }) {
  const { t, locale } = useTranslations();
  const utils = trpc.useUtils();
  const [addOpen, setAddOpen] = useState(false);

  const removeMember = trpc.frontend.admin.groups.removeMember.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:groups.membersError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:groups.memberRemoved"));
      await utils.frontend.admin.groups.invalidate();
      await utils.frontend.admin.users.invalidate();
    },
  });

  if (group.systemKey === "everyone") {
    return (
      <div className="flex items-start gap-3 rounded-xl border bg-card p-5">
        <Globe2 className="mt-0.5 size-5 text-primary" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-medium">
            {t("admin:groups.everyoneMembersTitle")}
          </p>
          <p className="text-muted-foreground">
            {t("admin:groups.everyoneMembersDescription")}
          </p>
        </div>
      </div>
    );
  }

  const oidcCount = group.members.filter(
    (member) => member.source === "oidc",
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t("admin:groups.membersSummary", {
            count: group.members.length,
            oidc: oidcCount,
          })}
        </p>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus className="mr-2 size-4" aria-hidden />
          {t("admin:groups.addMembers")}
        </Button>
      </div>

      {group.members.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <Users className="size-10 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t("admin:groups.noMembers")}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {group.oidcGroups.length > 0
              ? t("admin:groups.noMembersSso")
              : t("admin:groups.noMembersManual")}
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {group.members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center gap-3 px-4 py-3"
            >
              <UserAvatar
                name={member.name}
                email={member.email}
                image={member.image}
                seed={member.userId}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.name}
                  {member.disabled && (
                    <span className="ml-2 text-xs font-normal text-destructive">
                      {t("admin:users.status.disabled")}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email}
                </p>
              </div>
              <RoleBadge role={member.role} className="hidden sm:inline-flex" />
              <SourceBadge source={member.source} />
              <span className="hidden w-28 text-right text-xs text-muted-foreground md:block">
                {formatDistanceToNow(new Date(member.addedAt), {
                  addSuffix: true,
                  locale: dateLocale(locale),
                })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                disabled={removeMember.isPending}
                onClick={() =>
                  removeMember.mutate({
                    groupUuid: group.uuid,
                    userId: member.userId,
                  })
                }
                aria-label={t("admin:groups.removeMember", {
                  name: member.name,
                })}
              >
                <UserMinus className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {oidcCount > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Fingerprint className="size-3.5 text-tone-sso" aria-hidden />
          {t("admin:groups.oidcRemovalNote")}
        </p>
      )}

      <AddMembersDialog
        groupUuid={group.uuid}
        groupName={group.name}
        existingMemberIds={group.members.map((member) => member.userId)}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  );
}

function IdentityProviderTab({ group }: { group: GroupDetailRow }) {
  const { t } = useTranslations();
  const utils = trpc.useUtils();
  const [mappings, setMappings] = useState<string[]>(group.oidcGroups);
  const [sample, setSample] = useState("");
  const sso = trpc.frontend.admin.sso.getSettings.useQuery();

  useEffect(() => setMappings(group.oidcGroups), [group.oidcGroups]);

  const save = trpc.frontend.admin.groups.update.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:groups.saveError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:groups.mappingsSaved"));
      await utils.frontend.admin.groups.invalidate();
    },
  });
  const test = trpc.frontend.admin.sso.testMapping.useMutation();

  if (group.systemKey === "everyone") {
    return (
      <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        {t("admin:groups.everyoneNoMapping")}
      </p>
    );
  }

  const dirty =
    JSON.stringify([...mappings].sort()) !==
    JSON.stringify([...group.oidcGroups].sort());
  const sampleGroups = sample
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const thisGroupMatch = test.data?.matches.find(
    (match) => match.groupUuid === group.uuid,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <section className="space-y-3 rounded-xl border bg-card p-5">
        <div className="space-y-1">
          <h2 className="font-semibold">{t("admin:groups.idpGroups")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("admin:groups.mappingIntro", {
              claim: sso.data?.groupsClaim ?? "groups",
            })}
          </p>
        </div>
        <TagInput
          value={mappings}
          onChange={setMappings}
          placeholder={t("admin:groups.idpGroupsPlaceholder")}
          ariaLabel={t("admin:groups.idpGroups")}
          removeLabel={(tag) => t("admin:groups.removeMapping", { tag })}
        />
        <ul className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-3">
          <li>
            <code className="font-mono text-foreground">metamcp-admins</code>
            <span className="block">{t("admin:groups.examples.exact")}</span>
          </li>
          <li>
            <code className="font-mono text-foreground">/engineering/*</code>
            <span className="block">{t("admin:groups.examples.wildcard")}</span>
          </li>
          <li>
            <code className="font-mono text-foreground">0b8c…-guid</code>
            <span className="block">{t("admin:groups.examples.guid")}</span>
          </li>
        </ul>
        {!sso.data?.oidcConfigured && (
          <p className="rounded-md bg-tone-admin/10 px-3 py-2 text-xs text-tone-admin">
            {t("admin:groups.oidcNotConfigured")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!dirty}
            onClick={() => setMappings(group.oidcGroups)}
          >
            {t("admin:groups.reset")}
          </Button>
          <Button
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate({ uuid: group.uuid, oidcGroups: mappings })
            }
          >
            {t("admin:groups.saveMappings")}
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 text-tone-sso" aria-hidden />
          <h2 className="font-semibold">{t("admin:sso.tester.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("admin:groups.testerIntro")}
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
          disabled={sampleGroups.length === 0 || test.isPending || dirty}
          onClick={() => test.mutate({ groups: sampleGroups })}
        >
          {t("admin:sso.tester.run")}
        </Button>
        {dirty && (
          <p className="text-xs text-muted-foreground">
            {t("admin:groups.saveBeforeTest")}
          </p>
        )}
        {test.data && (
          <div
            role="status"
            className={
              thisGroupMatch
                ? "rounded-md border border-tone-sso/30 bg-tone-sso/10 p-3 text-sm"
                : "rounded-md border bg-muted/50 p-3 text-sm"
            }
          >
            {thisGroupMatch ? (
              <p>
                {t("admin:groups.testMatched", {
                  values: thisGroupMatch.matchedBy.join(", "),
                })}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {t("admin:groups.testNotMatched")}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function AccessTab({ group }: { group: GroupDetailRow }) {
  const { t, locale } = useTranslations();
  if (group.shares.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
        <Package className="size-10 text-muted-foreground" aria-hidden />
        <p className="font-medium">{t("admin:groups.noShares")}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("admin:groups.noSharesDescription")}
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {group.shares.map((share) => {
        const Icon = share.resourceType === "mcp_server" ? Server : Package;
        const href =
          share.resourceType === "mcp_server"
            ? `/mcp-servers/${share.resourceUuid}`
            : `/namespaces/${share.resourceUuid}`;
        return (
          <li key={share.shareUuid}>
            <Link
              href={getLocalizedPath(href, locale)}
              className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
            >
              <span className="inline-flex size-8 items-center justify-center rounded-md border bg-background">
                <Icon className="size-4 text-muted-foreground" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {share.resourceName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(`access:share.kind.${share.resourceType}`)}
                </span>
              </span>
              <LevelBadge level={share.level} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function GroupDetailPage() {
  const { t, locale } = useTranslations();
  const params = useParams<{ uuid: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const group = trpc.frontend.admin.groups.get.useQuery({ uuid: params.uuid });
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const remove = trpc.frontend.admin.groups.delete.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:groups.deleteError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:groups.deleted"));
      await utils.frontend.admin.groups.invalidate();
      await utils.frontend.admin.users.invalidate();
      router.push(getLocalizedPath("/admin/groups", locale));
    },
  });

  const backLink = (
    <Link
      href={getLocalizedPath("/admin/groups", locale)}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("admin:groups.back")}
    </Link>
  );

  if (group.isLoading) {
    return (
      <div className="space-y-6">
        {backLink}
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (!group.data) {
    return (
      <div className="space-y-6">
        {backLink}
        <p className="text-muted-foreground">{t("admin:groups.notFound")}</p>
      </div>
    );
  }

  const data = group.data;
  const title =
    data.systemKey === "everyone" ? t("access:share.everyone") : data.name;

  return (
    <div className="space-y-6">
      {backLink}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          {data.systemKey === "admins" ? (
            <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl bg-tone-admin/10 text-tone-admin">
              <ShieldCheck className="size-7" aria-hidden />
            </span>
          ) : data.systemKey === "everyone" ? (
            <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Globe2 className="size-7" aria-hidden />
            </span>
          ) : (
            <GroupAvatar
              name={data.name}
              seed={data.uuid}
              className="size-14 rounded-xl"
            />
          )}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
              {data.systemKey && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("admin:groups.system")}
                </span>
              )}
            </div>
            <p className="max-w-2xl text-muted-foreground">
              {data.description || t("admin:groups.noDescription")}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {t("admin:groups.membersGet")}
              </span>
              {data.role ? (
                <RoleBadge role={data.role} />
              ) : (
                <span className="text-muted-foreground">
                  {t("admin:groups.noRole")}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 size-4" aria-hidden />
            {t("admin:groups.edit")}
          </Button>
          {!data.systemKey && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("admin:groups.more")}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2
                    className="mr-2 size-4 text-destructive"
                    aria-hidden
                  />
                  {t("admin:groups.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Tabs defaultValue="members" className="gap-4">
        <TabsList>
          <TabsTrigger value="members">
            <Users className="mr-1.5 size-4" aria-hidden />
            {t("admin:groups.tabs.members")}
          </TabsTrigger>
          <TabsTrigger value="idp">
            <Fingerprint className="mr-1.5 size-4" aria-hidden />
            {t("admin:groups.tabs.idp")}
          </TabsTrigger>
          <TabsTrigger value="access">
            <Package className="mr-1.5 size-4" aria-hidden />
            {t("admin:groups.tabs.access")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTab group={data} />
        </TabsContent>
        <TabsContent value="idp">
          <IdentityProviderTab group={data} />
        </TabsContent>
        <TabsContent value="access">
          <AccessTab group={data} />
        </TabsContent>
      </Tabs>

      <GroupFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        group={data}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("admin:groups.deleteTitle", { name: data.name })}
            </DialogTitle>
            <DialogDescription>
              {t("admin:groups.deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ uuid: data.uuid })}
            >
              {t("admin:groups.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
