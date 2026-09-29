"use client";

import type { Role } from "@repo/zod-types";
import { formatDistanceToNow } from "date-fns";
import {
  Ban,
  Fingerprint,
  KeyRound,
  LogOut,
  Mail,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { RoleBadge, SourceBadge } from "@/components/access/access-badges";
import { UserAvatar } from "@/components/access/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAccess } from "@/hooks/useAccess";
import { useTranslations } from "@/hooks/useTranslations";
import { dateLocale } from "@/lib/date-locale";
import { type AdminUserRow, trpc } from "@/lib/trpc";

import { RoleSelect } from "./user-dialogs";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function UserDetailsSheet({
  user,
  onOpenChange,
  onResetPassword,
}: {
  user: AdminUserRow | null;
  onOpenChange: (open: boolean) => void;
  onResetPassword: (user: AdminUserRow) => void;
}) {
  const { t, locale } = useTranslations();
  const { me } = useAccess();
  const utils = trpc.useUtils();

  const refresh = async () => {
    await utils.frontend.admin.users.invalidate();
    await utils.frontend.admin.groups.invalidate();
    await utils.frontend.access.me.invalidate();
  };

  const update = trpc.frontend.admin.users.update.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:users.updateError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:users.roleUpdated"));
      await refresh();
    },
  });
  const setDisabled = trpc.frontend.admin.users.setDisabled.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:users.updateError"), {
          description: result.message,
        });
        return;
      }
      toast.success(result.message ?? "");
      await refresh();
    },
  });
  const revoke = trpc.frontend.admin.users.revokeSessions.useMutation({
    onSuccess: (result) =>
      result.success
        ? toast.success(t("admin:users.sessionsRevoked"))
        : toast.error(t("admin:users.updateError"), {
            description: result.message,
          }),
  });

  if (!user) {
    return (
      <Sheet open={false} onOpenChange={onOpenChange}>
        <SheetContent />
      </Sheet>
    );
  }

  const isSelf = user.id === me?.userId;
  const grantingGroups = user.groups.filter((group) => group.role);
  const elevated = user.role !== user.baseRole;

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b pb-4">
          <div className="flex items-center gap-3">
            <UserAvatar
              name={user.name}
              email={user.email}
              image={user.image}
              seed={user.id}
              size="lg"
            />
            <div className="min-w-0">
              <SheetTitle className="truncate text-lg">{user.name}</SheetTitle>
              <SheetDescription className="flex items-center gap-1.5 truncate">
                <Mail className="size-3.5 shrink-0" aria-hidden />
                {user.email}
              </SheetDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <RoleBadge role={user.role} />
            {user.disabled && (
              <span className="inline-flex h-6 items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 text-xs font-medium text-destructive">
                <Ban className="size-3.5" aria-hidden />
                {t("admin:users.status.disabled")}
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="space-y-6 p-4">
          <Section title={t("admin:users.details.role")}>
            <RoleSelect
              value={user.baseRole}
              disabled={update.isPending}
              onChange={(role: Role) =>
                update.mutate({ id: user.id, baseRole: role })
              }
            />
            <p className="text-xs text-muted-foreground">
              {elevated
                ? t("admin:users.details.elevated", {
                    role: t(`access:roles.${user.role}`),
                    groups: grantingGroups
                      .map((group) => group.name)
                      .join(", "),
                  })
                : t("admin:users.details.baseRoleHelp")}
            </p>
          </Section>

          <Section title={t("admin:users.details.groups")}>
            {user.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("admin:users.details.noGroups")}
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {user.groups.map((group) => (
                  <li
                    key={group.uuid}
                    className="flex items-center gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {group.name}
                    </span>
                    {group.role && <RoleBadge role={group.role} />}
                    <SourceBadge source={group.source} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t("admin:users.details.identityProvider")}>
            {user.externalGroupsSyncedAt ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {user.externalGroups.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                      {t("admin:users.details.noExternalGroups")}
                    </span>
                  )}
                  {user.externalGroups.map((group) => (
                    <code
                      key={group}
                      className="rounded border border-tone-sso/25 bg-tone-sso/10 px-1.5 py-0.5 font-mono text-xs text-tone-sso"
                    >
                      {group}
                    </code>
                  ))}
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Fingerprint className="size-3.5" aria-hidden />
                  {t("admin:users.details.syncedAt", {
                    time: formatDistanceToNow(
                      new Date(user.externalGroupsSyncedAt),
                      { addSuffix: true, locale: dateLocale(locale) },
                    ),
                  })}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("admin:users.details.neverSynced")}
              </p>
            )}
          </Section>

          <Section title={t("admin:users.details.resources")}>
            <dl className="grid grid-cols-4 gap-2 text-center">
              {(
                [
                  ["mcpServers", user.resourceCounts.mcpServers],
                  ["namespaces", user.resourceCounts.namespaces],
                  ["endpoints", user.resourceCounts.endpoints],
                  ["apiKeys", user.resourceCounts.apiKeys],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-lg border px-2 py-2">
                  <dd className="text-lg font-semibold tabular-nums">
                    {value}
                  </dd>
                  <dt className="text-[11px] leading-tight text-muted-foreground">
                    {t(`admin:users.resources.${key}`)}
                  </dt>
                </div>
              ))}
            </dl>
          </Section>

          <Section title={t("admin:users.details.actions")}>
            <div className="grid gap-2">
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => onResetPassword(user)}
              >
                <KeyRound className="mr-2 size-4" aria-hidden />
                {user.authMethods.includes("credential")
                  ? t("admin:users.resetPassword")
                  : t("admin:users.addPassword")}
              </Button>
              <Button
                variant="outline"
                className="justify-start"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ id: user.id })}
              >
                <LogOut className="mr-2 size-4" aria-hidden />
                {t("admin:users.revokeSessions")}
              </Button>
              {!isSelf && (
                <Button
                  variant="outline"
                  className={
                    user.disabled
                      ? "justify-start"
                      : "justify-start text-destructive hover:text-destructive"
                  }
                  disabled={setDisabled.isPending}
                  onClick={() =>
                    setDisabled.mutate({
                      id: user.id,
                      disabled: !user.disabled,
                    })
                  }
                >
                  {user.disabled ? (
                    <RotateCcw className="mr-2 size-4" aria-hidden />
                  ) : (
                    <Ban className="mr-2 size-4" aria-hidden />
                  )}
                  {user.disabled
                    ? t("admin:users.enable")
                    : t("admin:users.disable")}
                </Button>
              )}
            </div>
            {!user.disabled && !isSelf && (
              <p className="text-xs text-muted-foreground">
                {t("admin:users.disableHelp")}
              </p>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
