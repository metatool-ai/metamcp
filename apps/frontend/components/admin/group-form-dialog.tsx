"use client";

import type { Role } from "@repo/zod-types";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/access/access-badges";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/hooks/useTranslations";
import { type GroupRow, trpc } from "@/lib/trpc";

import { TagInput } from "./tag-input";

const NO_ROLE = "none";

export function GroupFormDialog({
  open,
  onOpenChange,
  group,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this group; create a new one when omitted. */
  group?: GroupRow | null;
  onCreated?: (uuid: string) => void;
}) {
  const { t } = useTranslations();
  const utils = trpc.useUtils();
  const isEdit = Boolean(group);
  const isAdmins = group?.systemKey === "admins";
  const isEveryone = group?.systemKey === "everyone";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState<Role | typeof NO_ROLE>(NO_ROLE);
  const [oidcGroups, setOidcGroups] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setDescription(group?.description ?? "");
      setRole(group?.role ?? NO_ROLE);
      setOidcGroups(group?.oidcGroups ?? []);
    }
  }, [open, group]);

  const onDone = async (message: string) => {
    toast.success(message);
    await utils.frontend.admin.groups.invalidate();
    await utils.frontend.admin.users.invalidate();
    await utils.frontend.access.me.invalidate();
    onOpenChange(false);
  };

  const create = trpc.frontend.admin.groups.create.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:groups.saveError"), {
          description: result.message,
        });
        return;
      }
      await onDone(t("admin:groups.created", { name }));
      if (result.uuid) onCreated?.(result.uuid);
    },
    onError: (error) =>
      toast.error(t("admin:groups.saveError"), { description: error.message }),
  });
  const update = trpc.frontend.admin.groups.update.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:groups.saveError"), {
          description: result.message,
        });
        return;
      }
      await onDone(t("admin:groups.saved"));
    },
    onError: (error) =>
      toast.error(t("admin:groups.saveError"), { description: error.message }),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const payloadRole = role === NO_ROLE ? null : role;
    if (group) {
      update.mutate({
        uuid: group.uuid,
        name: group.systemKey ? undefined : name,
        description: description || null,
        role: isAdmins ? undefined : payloadRole,
        oidcGroups: isEveryone ? undefined : oidcGroups,
      });
    } else {
      create.mutate({
        name,
        description: description || null,
        role: payloadRole,
        oidcGroups,
        memberIds: [],
      });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t("admin:groups.editTitle")
              : t("admin:groups.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("admin:groups.formDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">{t("admin:groups.name")}</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={Boolean(group?.systemKey)}
              required
              maxLength={64}
            />
            {group?.systemKey && (
              <p className="text-xs text-muted-foreground">
                {t("admin:groups.systemNameLocked")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="group-description">
              {t("admin:groups.descriptionLabel")}
            </Label>
            <Textarea
              id="group-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="group-role">{t("admin:groups.grantedRole")}</Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as Role | typeof NO_ROLE)}
              disabled={isAdmins}
            >
              <SelectTrigger id="group-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value={NO_ROLE}
                  className="py-2"
                  description={t("admin:groups.noRoleHelp")}
                >
                  <span className="font-medium">
                    {t("admin:groups.noRole")}
                  </span>
                </SelectItem>
                {(["viewer", "editor", "admin"] as const)
                  .filter((option) => !(isEveryone && option === "admin"))
                  .map((option) => (
                    <SelectItem
                      key={option}
                      value={option}
                      className="py-2"
                      description={t(`access:roleDescriptions.${option}`)}
                    >
                      <RoleBadge role={option} />
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isAdmins
                ? t("admin:groups.adminsRoleLocked")
                : t("admin:groups.grantedRoleHelp")}
            </p>
          </div>
          {!isEveryone && (
            <div className="space-y-2">
              <Label>{t("admin:groups.idpGroups")}</Label>
              <TagInput
                value={oidcGroups}
                onChange={setOidcGroups}
                placeholder={t("admin:groups.idpGroupsPlaceholder")}
                ariaLabel={t("admin:groups.idpGroups")}
                removeLabel={(tag) => t("admin:groups.removeMapping", { tag })}
              />
              <p className="text-xs text-muted-foreground">
                {t("admin:groups.idpGroupsHelp")}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common:cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {isEdit ? t("admin:groups.save") : t("admin:groups.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
