"use client";

import type { Role } from "@repo/zod-types";
import { Building2, Eye, EyeOff, Trash2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/access/access-badges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "@/hooks/useTranslations";
import { type AdminUserRow, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const ROLES: Role[] = ["viewer", "editor", "admin"];

export function RoleSelect({
  value,
  onChange,
  id,
  disabled,
}: {
  value: Role;
  onChange: (role: Role) => void;
  id?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslations();
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as Role)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((role) => (
          <SelectItem
            key={role}
            value={role}
            className="py-2"
            description={t(`access:roleDescriptions.${role}`)}
          >
            <RoleBadge role={role} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslations();
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pr-10"
        minLength={8}
        required
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0.5 top-0.5 size-8 text-muted-foreground"
        onClick={() => setVisible((current) => !current)}
        aria-label={
          visible
            ? t("admin:users.hidePassword")
            : t("admin:users.showPassword")
        }
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
}

export function AddUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslations();
  const utils = trpc.useUtils();
  const groups = trpc.frontend.admin.groups.list.useQuery(undefined, {
    enabled: open,
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [groupUuids, setGroupUuids] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setName("");
      setEmail("");
      setPassword("");
      setRole("viewer");
      setGroupUuids([]);
    }
  }, [open]);

  const create = trpc.frontend.admin.users.create.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:users.createError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:users.created", { name }));
      await utils.frontend.admin.users.invalidate();
      await utils.frontend.admin.groups.invalidate();
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(t("admin:users.createError"), { description: error.message }),
  });

  const assignable = (groups.data ?? []).filter(
    (group) => group.systemKey !== "everyone",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("admin:users.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("admin:users.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({
              name,
              email,
              password,
              baseRole: role,
              groupUuids,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-user-name">{t("admin:users.name")}</Label>
              <Input
                id="new-user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-email">{t("admin:users.email")}</Label>
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="off"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-password">
              {t("admin:users.initialPassword")}
            </Label>
            <PasswordInput
              id="new-user-password"
              value={password}
              onChange={setPassword}
            />
            <p className="text-xs text-muted-foreground">
              {t("admin:users.passwordHelp")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-role">{t("admin:users.baseRole")}</Label>
            <RoleSelect id="new-user-role" value={role} onChange={setRole} />
          </div>
          {assignable.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                {t("admin:users.groups")}
              </legend>
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                {assignable.map((group) => {
                  const checked = groupUuids.includes(group.uuid);
                  return (
                    <label
                      key={group.uuid}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          setGroupUuids((current) =>
                            value
                              ? [...current, group.uuid]
                              : current.filter((uuid) => uuid !== group.uuid),
                          )
                        }
                      />
                      <span className="truncate">{group.name}</span>
                      {group.role && (
                        <RoleBadge role={group.role} className="ml-auto" />
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common:cancel")}
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || password.length < 8}
            >
              {create.isPending
                ? t("admin:users.creating")
                : t("admin:users.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: AdminUserRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslations();
  const [password, setPassword] = useState("");
  useEffect(() => setPassword(""), [user?.id]);

  const setUserPassword = trpc.frontend.admin.users.setPassword.useMutation({
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(t("admin:users.passwordError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:users.passwordUpdated"));
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(t("admin:users.passwordError"), {
        description: error.message,
      }),
  });

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t("admin:users.resetPasswordTitle")}</DialogTitle>
          <DialogDescription>
            {t("admin:users.resetPasswordDescription", {
              name: user?.name ?? "",
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (user) setUserPassword.mutate({ id: user.id, password });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="reset-password">
              {t("admin:users.newPassword")}
            </Label>
            <PasswordInput
              id="reset-password"
              value={password}
              onChange={setPassword}
            />
            <p className="text-xs text-muted-foreground">
              {t("admin:users.resetPasswordHelp")}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common:cancel")}
            </Button>
            <Button
              type="submit"
              disabled={setUserPassword.isPending || password.length < 8}
            >
              {t("admin:users.setPassword")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type TransferMode = "organization" | "user" | "delete";

export function DeleteUserDialog({
  user,
  onOpenChange,
}: {
  user: AdminUserRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslations();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<TransferMode>("organization");
  const [targetId, setTargetId] = useState<string>("");
  const candidates = trpc.frontend.admin.users.list.useQuery(
    { status: "active", limit: 200, offset: 0 },
    { enabled: Boolean(user) && mode === "user" },
  );

  useEffect(() => {
    setMode("organization");
    setTargetId("");
  }, [user?.id]);

  const remove = trpc.frontend.admin.users.delete.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:users.deleteError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:users.deleted", { name: user?.name ?? "" }));
      await utils.frontend.admin.users.invalidate();
      await utils.frontend.admin.groups.invalidate();
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(t("admin:users.deleteError"), { description: error.message }),
  });

  const counts = user?.resourceCounts;
  const owned =
    (counts?.mcpServers ?? 0) +
    (counts?.namespaces ?? 0) +
    (counts?.endpoints ?? 0);

  const options: {
    value: TransferMode;
    icon: typeof Building2;
    title: string;
    description: string;
    danger?: boolean;
  }[] = [
    {
      value: "organization",
      icon: Building2,
      title: t("admin:users.transfer.organization"),
      description: t("admin:users.transfer.organizationHelp"),
    },
    {
      value: "user",
      icon: UserRound,
      title: t("admin:users.transfer.user"),
      description: t("admin:users.transfer.userHelp"),
    },
    {
      value: "delete",
      icon: Trash2,
      title: t("admin:users.transfer.delete"),
      description: t("admin:users.transfer.deleteHelp"),
      danger: true,
    },
  ];

  const submit = () => {
    if (!user) return;
    remove.mutate({
      id: user.id,
      transfer:
        mode === "user"
          ? { mode: "user", userId: targetId }
          : mode === "delete"
            ? { mode: "delete" }
            : { mode: "organization" },
    });
  };

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {t("admin:users.deleteTitle", { name: user?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {t("admin:users.deleteDescription")}
          </DialogDescription>
        </DialogHeader>

        {owned > 0 ? (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              {t("admin:users.transfer.legend", {
                servers: counts?.mcpServers ?? 0,
                namespaces: counts?.namespaces ?? 0,
                endpoints: counts?.endpoints ?? 0,
              })}
            </legend>
            {options.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                  mode === option.value
                    ? option.danger
                      ? "border-destructive/50 bg-destructive/5"
                      : "border-primary/50 bg-primary/5"
                    : "hover:bg-accent/50",
                )}
              >
                <input
                  type="radio"
                  name="transfer-mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  className="mt-1 accent-[var(--color-primary)]"
                />
                <option.icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    option.danger
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">
                    {option.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
            {mode === "user" && (
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("admin:users.transfer.choose")} />
                </SelectTrigger>
                <SelectContent>
                  {(candidates.data?.users ?? [])
                    .filter((candidate) => candidate.id !== user?.id)
                    .map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name} · {candidate.email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </fieldset>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("admin:users.noOwnedResources")}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {t("admin:users.deleteKeysNote", { count: counts?.apiKeys ?? 0 })}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={remove.isPending || (mode === "user" && !targetId)}
          >
            {remove.isPending
              ? t("admin:users.deleting")
              : t("admin:users.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
