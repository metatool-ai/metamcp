"use client";

import type { Role, UserStatus } from "@repo/zod-types";
import { formatDistanceToNow } from "date-fns";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  KeyRound,
  LogOut,
  MoreHorizontal,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/access/access-badges";
import { UserAvatar } from "@/components/access/user-avatar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { UserDetailsSheet } from "@/components/admin/user-details-sheet";
import {
  AddUserDialog,
  DeleteUserDialog,
  ResetPasswordDialog,
} from "@/components/admin/user-dialogs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccess } from "@/hooks/useAccess";
import { useTranslations } from "@/hooks/useTranslations";
import { dateLocale } from "@/lib/date-locale";
import { type AdminUserRow, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const ALL = "all";

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function StatTile({
  label,
  value,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number | undefined;
  active: boolean;
  onClick: () => void;
  tone?: "admin" | "editor" | "viewer" | "danger";
}) {
  const accent = {
    admin: "bg-tone-admin",
    editor: "bg-tone-editor",
    viewer: "bg-tone-viewer",
    danger: "bg-tone-danger",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group relative flex flex-col items-start gap-1 overflow-hidden rounded-xl border bg-card px-4 py-3 text-left transition-colors",
        "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
        active && "border-primary/60 ring-1 ring-primary/30",
      )}
    >
      {tone && (
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-1", accent[tone])}
        />
      )}
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">
        {value === undefined ? <Skeleton className="h-7 w-10" /> : value}
      </span>
    </button>
  );
}

function SignInMethods({ methods }: { methods: string[] }) {
  const { t } = useTranslations();
  const hasPassword = methods.includes("credential");
  const sso = methods.filter((method) => method !== "credential");
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {hasPassword && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex size-7 items-center justify-center rounded-md border">
              <KeyRound
                className="size-3.5"
                aria-label={t("admin:users.signIn.password")}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("admin:users.signIn.password")}</TooltipContent>
        </Tooltip>
      )}
      {sso.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex size-7 items-center justify-center rounded-md border border-tone-sso/30 bg-tone-sso/10 text-tone-sso">
              <Fingerprint
                className="size-3.5"
                aria-label={t("admin:users.signIn.sso")}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("admin:users.signIn.ssoWith", { providers: sso.join(", ") })}
          </TooltipContent>
        </Tooltip>
      )}
      {methods.length === 0 && <span className="text-xs">—</span>}
    </div>
  );
}

export default function UsersPage() {
  const { t, locale } = useTranslations();
  const { me } = useAccess();
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | typeof ALL>(ALL);
  const [status, setStatus] = useState<UserStatus | typeof ALL>(ALL);
  const [groupUuid, setGroupUuid] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const debouncedSearch = useDebounced(search, 250);

  const [addOpen, setAddOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [passwordUser, setPasswordUser] = useState<AdminUserRow | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUserRow | null>(null);

  useEffect(() => setPage(0), [debouncedSearch, role, status, groupUuid]);

  const filters = {
    search: debouncedSearch || undefined,
    role: role === ALL ? undefined : role,
    status: status === ALL ? undefined : status,
    groupUuid: groupUuid === ALL ? undefined : groupUuid,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const users = trpc.frontend.admin.users.list.useQuery(filters, {
    placeholderData: (previous) => previous,
  });
  const groups = trpc.frontend.admin.groups.list.useQuery();

  // Summary tiles
  const statQuery = (input: { role?: Role; status?: UserStatus }) =>
    ({ ...input, limit: 1, offset: 0 }) as const;
  const totalAll = trpc.frontend.admin.users.list.useQuery(statQuery({}));
  const totalAdmins = trpc.frontend.admin.users.list.useQuery(
    statQuery({ role: "admin" }),
  );
  const totalEditors = trpc.frontend.admin.users.list.useQuery(
    statQuery({ role: "editor" }),
  );
  const totalViewers = trpc.frontend.admin.users.list.useQuery(
    statQuery({ role: "viewer" }),
  );
  const totalDisabled = trpc.frontend.admin.users.list.useQuery(
    statQuery({ status: "disabled" }),
  );

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
    onError: (error) =>
      toast.error(t("admin:users.updateError"), { description: error.message }),
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
    onError: (error) =>
      toast.error(t("admin:users.updateError"), { description: error.message }),
  });
  const revoke = trpc.frontend.admin.users.revokeSessions.useMutation({
    onSuccess: (result) =>
      result.success
        ? toast.success(t("admin:users.sessionsRevoked"))
        : toast.error(t("admin:users.updateError"), {
            description: result.message,
          }),
  });

  const rows = users.data?.users ?? [];
  const total = users.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const detailsUser = rows.find((user) => user.id === detailsId) ?? null;

  const quickFilter = (next: { role?: Role; status?: UserStatus }) => {
    setRole(next.role ?? ALL);
    setStatus(next.status ?? ALL);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={UserCog}
        title={t("admin:users.title")}
        description={t("admin:users.description")}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="mr-2 size-4" aria-hidden />
            {t("admin:users.add")}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label={t("admin:users.stats.total")}
          value={totalAll.data?.total}
          active={role === ALL && status === ALL}
          onClick={() => quickFilter({})}
        />
        <StatTile
          label={t("access:roles.admin")}
          tone="admin"
          value={totalAdmins.data?.total}
          active={role === "admin"}
          onClick={() => quickFilter({ role: "admin" })}
        />
        <StatTile
          label={t("access:roles.editor")}
          tone="editor"
          value={totalEditors.data?.total}
          active={role === "editor"}
          onClick={() => quickFilter({ role: "editor" })}
        />
        <StatTile
          label={t("access:roles.viewer")}
          tone="viewer"
          value={totalViewers.data?.total}
          active={role === "viewer"}
          onClick={() => quickFilter({ role: "viewer" })}
        />
        <StatTile
          label={t("admin:users.stats.disabled")}
          tone="danger"
          value={totalDisabled.data?.total}
          active={status === "disabled"}
          onClick={() => quickFilter({ status: "disabled" })}
        />
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("admin:users.searchPlaceholder")}
            className="pl-8"
            aria-label={t("admin:users.searchPlaceholder")}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={role}
            onValueChange={(value) => setRole(value as Role | typeof ALL)}
          >
            <SelectTrigger
              className="w-[150px]"
              aria-label={t("admin:users.filters.role")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("admin:users.filters.allRoles")}
              </SelectItem>
              <SelectItem value="admin">{t("access:roles.admin")}</SelectItem>
              <SelectItem value="editor">{t("access:roles.editor")}</SelectItem>
              <SelectItem value="viewer">{t("access:roles.viewer")}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) =>
              setStatus(value as UserStatus | typeof ALL)
            }
          >
            <SelectTrigger
              className="w-[150px]"
              aria-label={t("admin:users.filters.status")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("admin:users.filters.allStatuses")}
              </SelectItem>
              <SelectItem value="active">
                {t("admin:users.status.active")}
              </SelectItem>
              <SelectItem value="disabled">
                {t("admin:users.status.disabled")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={groupUuid} onValueChange={setGroupUuid}>
            <SelectTrigger
              className="w-[190px]"
              aria-label={t("admin:users.filters.group")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("admin:users.filters.allGroups")}
              </SelectItem>
              {(groups.data ?? [])
                .filter((group) => group.systemKey !== "everyone")
                .map((group) => (
                  <SelectItem key={group.uuid} value={group.uuid}>
                    {group.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[240px]">
                {t("admin:users.columns.user")}
              </TableHead>
              <TableHead>{t("admin:users.columns.role")}</TableHead>
              <TableHead className="hidden md:table-cell">
                {t("admin:users.columns.groups")}
              </TableHead>
              <TableHead className="hidden lg:table-cell">
                {t("admin:users.columns.signIn")}
              </TableHead>
              <TableHead className="hidden lg:table-cell">
                {t("admin:users.columns.lastSeen")}
              </TableHead>
              <TableHead className="w-12">
                <span className="sr-only">
                  {t("admin:users.columns.actions")}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isLoading &&
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {!users.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <Users
                      className="size-10 text-muted-foreground"
                      aria-hidden
                    />
                    <p className="font-medium">
                      {t("admin:users.empty.title")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("admin:users.empty.description")}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {rows.map((user) => {
              const isSelf = user.id === me?.userId;
              const visibleGroups = user.groups.filter(
                (group) => group.systemKey !== "everyone",
              );
              return (
                <TableRow
                  key={user.id}
                  className={cn(
                    "cursor-pointer",
                    user.disabled && "opacity-60",
                  )}
                  onClick={() => setDetailsId(user.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        name={user.name}
                        email={user.email}
                        image={user.image}
                        seed={user.id}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">
                            {user.name}
                          </span>
                          {isSelf && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                              {t("access:owner.you")}
                            </span>
                          )}
                          {user.disabled && (
                            <span className="inline-flex items-center gap-1 text-xs text-destructive">
                              <Ban className="size-3" aria-hidden />
                              {t("admin:users.status.disabled")}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <RoleBadge role={user.role} />
                      {user.role !== user.baseRole && (
                        <span className="text-[11px] text-muted-foreground">
                          {t("admin:users.viaGroup")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex max-w-[260px] flex-wrap gap-1">
                      {visibleGroups.slice(0, 3).map((group) => (
                        <span
                          key={group.uuid}
                          className={cn(
                            "inline-flex h-6 max-w-[10rem] items-center gap-1 truncate rounded-md border px-2 text-xs",
                            group.source === "oidc" &&
                              "border-tone-sso/25 bg-tone-sso/5",
                          )}
                          title={group.name}
                        >
                          {group.source === "oidc" && (
                            <Fingerprint
                              className="size-3 shrink-0 text-tone-sso"
                              aria-hidden
                            />
                          )}
                          <span className="truncate">{group.name}</span>
                        </span>
                      ))}
                      {visibleGroups.length > 3 && (
                        <span className="inline-flex h-6 items-center rounded-md px-1.5 text-xs text-muted-foreground">
                          +{visibleGroups.length - 3}
                        </span>
                      )}
                      {visibleGroups.length === 0 && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <SignInMethods methods={user.authMethods} />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {user.lastSeenAt
                      ? formatDistanceToNow(new Date(user.lastSeenAt), {
                          addSuffix: true,
                          locale: dateLocale(locale),
                        })
                      : t("admin:users.never")}
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t("admin:users.actionsFor", {
                            name: user.name,
                          })}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="truncate">
                          {user.name}
                        </DropdownMenuLabel>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <ShieldCheck className="mr-2 size-4" aria-hidden />
                            {t("admin:users.changeRole")}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuRadioGroup
                              value={user.baseRole}
                              onValueChange={(value) =>
                                update.mutate({
                                  id: user.id,
                                  baseRole: value as Role,
                                })
                              }
                            >
                              {(["admin", "editor", "viewer"] as const).map(
                                (option) => (
                                  <DropdownMenuRadioItem
                                    key={option}
                                    value={option}
                                  >
                                    {t(`access:roles.${option}`)}
                                  </DropdownMenuRadioItem>
                                ),
                              )}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem onClick={() => setPasswordUser(user)}>
                          <KeyRound className="mr-2 size-4" aria-hidden />
                          {user.authMethods.includes("credential")
                            ? t("admin:users.resetPassword")
                            : t("admin:users.addPassword")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => revoke.mutate({ id: user.id })}
                        >
                          <LogOut className="mr-2 size-4" aria-hidden />
                          {t("admin:users.revokeSessions")}
                        </DropdownMenuItem>
                        {!isSelf && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() =>
                                setDisabled.mutate({
                                  id: user.id,
                                  disabled: !user.disabled,
                                })
                              }
                            >
                              {user.disabled ? (
                                <RotateCcw
                                  className="mr-2 size-4"
                                  aria-hidden
                                />
                              ) : (
                                <Ban className="mr-2 size-4" aria-hidden />
                              )}
                              {user.disabled
                                ? t("admin:users.enable")
                                : t("admin:users.disable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteUser(user)}
                            >
                              <Trash2
                                className="mr-2 size-4 text-destructive"
                                aria-hidden
                              />
                              {t("admin:users.delete")}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("admin:users.count", { count: total })}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((current) => current - 1)}
            aria-label={t("admin:users.previousPage")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tabular-nums">
            {page + 1} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((current) => current + 1)}
            aria-label={t("admin:users.nextPage")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} />
      <ResetPasswordDialog
        user={passwordUser}
        onOpenChange={(open) => !open && setPasswordUser(null)}
      />
      <DeleteUserDialog
        user={deleteUser}
        onOpenChange={(open) => !open && setDeleteUser(null)}
      />
      <UserDetailsSheet
        user={detailsUser}
        onOpenChange={(open) => !open && setDetailsId(null)}
        onResetPassword={(user) => setPasswordUser(user)}
      />
    </div>
  );
}
