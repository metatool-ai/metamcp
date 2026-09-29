"use client";

import {
  type Capability,
  type ConfigurableRole,
  DEFAULT_ROLE_PERMISSIONS,
  type Role,
  type RolePermissions,
} from "@repo/zod-types";
import {
  Check,
  KeyRound,
  Lock,
  Package,
  SearchCode,
  Server,
  Share2,
  ShieldHalf,
  TerminalSquare,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/access/access-badges";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RoleSelect } from "@/components/admin/user-dialogs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type CapabilityRow = {
  capability: Capability;
  icon: typeof Server;
  risky?: boolean;
};

const SECTIONS: { key: string; rows: CapabilityRow[] }[] = [
  {
    key: "servers",
    rows: [
      { capability: "mcp_servers.create", icon: Server },
      {
        capability: "mcp_servers.create_stdio",
        icon: TerminalSquare,
        risky: true,
      },
    ],
  },
  {
    key: "publishing",
    rows: [
      { capability: "namespaces.create", icon: Package },
      { capability: "endpoints.create", icon: Share2 },
      { capability: "resources.share", icon: Share2 },
    ],
  },
  {
    key: "usage",
    rows: [
      { capability: "api_keys.create", icon: KeyRound },
      { capability: "inspector.use", icon: SearchCode },
    ],
  },
];

const CONFIGURABLE: ConfigurableRole[] = ["editor", "viewer"];

const ADMIN_ONLY = [
  "users",
  "settings",
  "logs",
  "organisation",
  "openEndpoints",
  "adminTools",
] as const;

function samePermissions(a: RolePermissions, b: RolePermissions): boolean {
  return CONFIGURABLE.every(
    (role) => [...a[role]].sort().join() === [...b[role]].sort().join(),
  );
}

export default function RolesPage() {
  const { t } = useTranslations();
  const utils = trpc.useUtils();
  const permissions = trpc.frontend.admin.roles.getPermissions.useQuery();
  const sso = trpc.frontend.admin.sso.getSettings.useQuery();
  const [draft, setDraft] = useState<RolePermissions | null>(null);

  useEffect(() => {
    if (permissions.data) setDraft(permissions.data);
  }, [permissions.data]);

  const save = trpc.frontend.admin.roles.setPermissions.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:roles.saveError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:roles.saved"));
      await utils.frontend.admin.roles.invalidate();
      await utils.frontend.access.me.invalidate();
    },
    onError: (error) =>
      toast.error(t("admin:roles.saveError"), { description: error.message }),
  });
  const updateDefaultRole = trpc.frontend.admin.sso.updateSettings.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:roles.saveError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:roles.defaultRoleSaved"));
      await utils.frontend.admin.sso.invalidate();
    },
    onError: (error) =>
      toast.error(t("admin:roles.saveError"), { description: error.message }),
  });

  const dirty = useMemo(
    () =>
      Boolean(
        draft && permissions.data && !samePermissions(draft, permissions.data),
      ),
    [draft, permissions.data],
  );
  const isDefault = draft
    ? samePermissions(draft, DEFAULT_ROLE_PERMISSIONS)
    : true;

  const toggle = (
    role: ConfigurableRole,
    capability: Capability,
    enabled: boolean,
  ) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            [role]: enabled
              ? [...new Set([...current[role], capability])]
              : current[role].filter((item) => item !== capability),
          }
        : current,
    );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={ShieldHalf}
        title={t("admin:roles.title")}
        description={t("admin:roles.description")}
      />

      <div className="grid gap-3 md:grid-cols-3">
        {(["admin", "editor", "viewer"] as Role[]).map((role) => (
          <div key={role} className="space-y-2 rounded-xl border bg-card p-4">
            <RoleBadge role={role} />
            <p className="text-sm text-muted-foreground">
              {t(`access:roleDescriptions.${role}`)}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h2 className="font-semibold">{t("admin:roles.matrixTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("admin:roles.matrixDescription")}
          </p>
        </div>
        {!isDefault && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDraft(DEFAULT_ROLE_PERMISSIONS)}
          >
            {t("admin:roles.restoreDefaults")}
          </Button>
        )}
      </div>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] items-center border-b bg-muted/40 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid-cols-[minmax(0,1fr)_repeat(3,7rem)]">
          <span>{t("admin:roles.capability")}</span>
          {(["admin", "editor", "viewer"] as Role[]).map((role) => (
            <span key={role} className="flex justify-center">
              <RoleBadge role={role} />
            </span>
          ))}
        </div>

        {!draft ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          SECTIONS.map((section) => (
            <div key={section.key}>
              <p className="border-b bg-background px-4 pb-2 pt-4 text-xs font-semibold text-muted-foreground">
                {t(`admin:roles.sections.${section.key}`)}
              </p>
              {section.rows.map((row) => (
                <div
                  key={row.capability}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] items-center gap-y-1 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_repeat(3,7rem)]",
                    row.risky && "bg-tone-danger/[0.03]",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3 pr-2">
                    <row.icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        row.risky
                          ? "text-tone-danger"
                          : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {t(`admin:roles.capabilities.${row.capability}.label`)}
                        {row.risky && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-tone-danger/30 bg-tone-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-tone-danger">
                            <TriangleAlert className="size-3" aria-hidden />
                            {t("admin:roles.highRisk")}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          `admin:roles.capabilities.${row.capability}.description`,
                        )}
                      </p>
                    </div>
                  </div>
                  <span className="flex justify-center">
                    <span
                      className="inline-flex size-7 items-center justify-center rounded-full bg-tone-admin/10 text-tone-admin"
                      title={t("admin:roles.adminAlways")}
                    >
                      <Check
                        className="size-4"
                        aria-label={t("admin:roles.adminAlways")}
                      />
                    </span>
                  </span>
                  {CONFIGURABLE.map((role) => (
                    <span key={role} className="flex justify-center">
                      <Switch
                        checked={draft[role].includes(row.capability)}
                        onCheckedChange={(checked) =>
                          toggle(role, row.capability, checked)
                        }
                        aria-label={t("admin:roles.toggleLabel", {
                          role: t(`access:roles.${role}`),
                          capability: t(
                            `admin:roles.capabilities.${row.capability}.label`,
                          ),
                        })}
                      />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <div className="space-y-1">
            <h2 className="font-semibold">
              {t("admin:roles.defaultRole.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("admin:roles.defaultRole.description")}
            </p>
          </div>
          {sso.data ? (
            <RoleSelect
              value={sso.data.defaultRole}
              disabled={updateDefaultRole.isPending}
              onChange={(role) =>
                updateDefaultRole.mutate({ defaultRole: role })
              }
            />
          ) : (
            <Skeleton className="h-9 w-full" />
          )}
          <p className="text-xs text-muted-foreground">
            {t("admin:roles.defaultRole.help")}
          </p>
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2">
            <Lock className="size-4 text-tone-admin" aria-hidden />
            <h2 className="font-semibold">
              {t("admin:roles.adminOnly.title")}
            </h2>
          </div>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {ADMIN_ONLY.map((item) => (
              <li key={item} className="flex gap-2">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-tone-admin"
                  aria-hidden
                />
                {t(`admin:roles.adminOnly.${item}`)}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {dirty && draft && (
        <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {t("admin:roles.unsaved")}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => permissions.data && setDraft(permissions.data)}
              >
                {t("admin:roles.discard")}
              </Button>
              <Button
                disabled={save.isPending}
                onClick={() => save.mutate(draft)}
              >
                {t("admin:roles.save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
