"use client";

import { Check, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/access/access-badges";
import { UserAvatar } from "@/components/access/user-avatar";
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
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function AddMembersDialog({
  groupUuid,
  groupName,
  existingMemberIds,
  open,
  onOpenChange,
}: {
  groupUuid: string;
  groupName: string;
  existingMemberIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslations();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected([]);
    }
  }, [open]);

  const users = trpc.frontend.admin.users.list.useQuery(
    { search: debounced || undefined, status: "active", limit: 50, offset: 0 },
    { enabled: open },
  );
  const candidates = (users.data?.users ?? []).filter(
    (user) => !existingMemberIds.includes(user.id),
  );

  const add = trpc.frontend.admin.groups.addMembers.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("admin:groups.membersError"), {
          description: result.message,
        });
        return;
      }
      toast.success(t("admin:groups.membersAdded", { count: selected.length }));
      await utils.frontend.admin.groups.invalidate();
      await utils.frontend.admin.users.invalidate();
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(t("admin:groups.membersError"), {
        description: error.message,
      }),
  });

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {t("admin:groups.addMembersTitle", { name: groupName })}
          </DialogTitle>
          <DialogDescription>
            {t("admin:groups.addMembersDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("admin:users.searchPlaceholder")}
            aria-label={t("admin:users.searchPlaceholder")}
            className="pl-8"
            autoFocus
          />
        </div>
        <ul
          className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border p-1"
          aria-label={t("admin:groups.candidates")}
        >
          {candidates.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
              {users.isLoading
                ? t("access:share.searching")
                : t("access:share.noResults")}
            </li>
          )}
          {candidates.map((user) => {
            const isSelected = selected.includes(user.id);
            return (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => toggle(user.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-left hover:bg-accent",
                    isSelected && "bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                      isSelected &&
                        "border-primary bg-primary text-primary-foreground",
                    )}
                    aria-hidden
                  >
                    {isSelected && <Check className="size-3" />}
                  </span>
                  <UserAvatar
                    name={user.name}
                    email={user.email}
                    seed={user.id}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {user.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </span>
                  <RoleBadge role={user.role} />
                </button>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:cancel")}
          </Button>
          <Button
            disabled={selected.length === 0 || add.isPending}
            onClick={() => add.mutate({ groupUuid, userIds: selected })}
          >
            {t("admin:groups.addSelected", { count: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
