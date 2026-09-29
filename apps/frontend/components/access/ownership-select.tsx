"use client";

import { Building2, User } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "@/hooks/useTranslations";

/**
 * Owner picker for administrators. `undefined` = the current user (private),
 * `null` = the organisation (managed by administrators, visible only to the
 * people and groups it is shared with). Other users always own what they
 * create, so the picker is not rendered for them.
 */
export function OwnershipSelect({
  value,
  onChange,
  id,
}: {
  value: string | null | undefined;
  onChange: (value: null | undefined) => void;
  id?: string;
}) {
  const { t } = useTranslations();
  const current = value === null ? "organization" : "me";
  return (
    <div className="space-y-1.5">
      <Select
        value={current}
        onValueChange={(next) =>
          onChange(next === "organization" ? null : undefined)
        }
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            value="me"
            className="py-2"
            description={t("access:ownership.meHelp")}
          >
            <User className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{t("access:ownership.me")}</span>
          </SelectItem>
          <SelectItem
            value="organization"
            className="py-2"
            description={t("access:ownership.organizationHelp")}
          >
            <Building2 className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">
              {t("access:ownership.organization")}
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Owner picker used when editing an existing resource (administrators only):
 * keep the current owner, take it over, or move it to the organisation.
 */
export function OwnerTransferSelect({
  value,
  onChange,
  currentOwner,
  currentUserId,
  id,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  currentOwner: { id: string; name: string } | null | undefined;
  currentUserId: string;
  id?: string;
}) {
  const { t } = useTranslations();
  const selected =
    value === null ? "organization" : value === currentUserId ? "me" : "owner";
  return (
    <Select
      value={selected}
      onValueChange={(next) =>
        onChange(
          next === "organization"
            ? null
            : next === "me"
              ? currentUserId
              : (currentOwner?.id ?? currentUserId),
        )
      }
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {currentOwner && currentOwner.id !== currentUserId && (
          <SelectItem value="owner">
            <span className="flex items-center gap-2">
              <User className="size-4 text-muted-foreground" aria-hidden />
              {currentOwner.name}
            </span>
          </SelectItem>
        )}
        <SelectItem value="me">
          <span className="flex items-center gap-2">
            <User className="size-4 text-muted-foreground" aria-hidden />
            {t("access:ownership.me")}
          </span>
        </SelectItem>
        <SelectItem value="organization">
          <span className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" aria-hidden />
            {t("access:ownership.organization")}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
