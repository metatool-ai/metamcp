"use client";

import type {
  ShareLevel,
  ShareResourceType,
  ShareSubject,
} from "@repo/zod-types";
import {
  Building2,
  Globe2,
  Info,
  Loader2,
  Search,
  Share2,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccess } from "@/hooks/useAccess";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

import { AccessBadge } from "./access-badges";
import { OwnerLabel } from "./owner-label";
import { GroupAvatar, UserAvatar } from "./user-avatar";

const LEVELS: ShareLevel[] = ["use", "edit", "manage"];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function SubjectAvatar({ subject }: { subject: ShareSubject }) {
  if (subject.type === "group") {
    if (subject.systemKey === "everyone") {
      return (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Globe2 className="size-5" aria-hidden />
        </span>
      );
    }
    return <GroupAvatar name={subject.name} seed={subject.id} />;
  }
  return (
    <UserAvatar
      name={subject.name}
      email={subject.email}
      image={subject.image}
      seed={subject.id}
    />
  );
}

function SubjectText({ subject }: { subject: ShareSubject }) {
  const { t } = useTranslations();
  const title =
    subject.systemKey === "everyone"
      ? t("access:share.everyone")
      : subject.name;
  const subtitle =
    subject.type === "user"
      ? subject.email
      : subject.systemKey === "everyone"
        ? t("access:share.everyoneHint")
        : t("access:share.memberCount", { count: subject.memberCount ?? 0 });
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium">{title}</span>
      {subtitle && (
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      )}
    </span>
  );
}

function LevelSelect({
  value,
  onChange,
  disabled,
  allowed,
  label,
}: {
  value: ShareLevel;
  onChange: (level: ShareLevel) => void;
  disabled?: boolean;
  allowed?: ShareLevel[];
  label: string;
}) {
  const { t } = useTranslations();
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ShareLevel)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="w-[132px] shrink-0"
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="w-72">
        {LEVELS.map((level) => (
          <SelectItem
            key={level}
            value={level}
            disabled={allowed ? !allowed.includes(level) : false}
            className="py-2"
            description={t(`access:levelDescriptions.${level}`)}
          >
            <span className="font-medium">{t(`access:levels.${level}`)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ShareDialog({
  resourceType,
  resourceUuid,
  resourceName,
  open,
  onOpenChange,
}: {
  resourceType: ShareResourceType;
  resourceUuid: string;
  resourceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslations();
  const { me, isAdmin } = useAccess();
  const utils = trpc.useUtils();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [newLevel, setNewLevel] = useState<ShareLevel>("use");
  const debouncedQuery = useDebounced(query, 200);

  const shares = trpc.frontend.shares.list.useQuery(
    { resourceType, resourceUuid },
    { enabled: open },
  );
  const canManage = shares.data?.canManage ?? false;

  const search = trpc.frontend.shares.searchSubjects.useQuery(
    { query: debouncedQuery, limit: 8 },
    { enabled: open && canManage },
  );

  const invalidate = async () => {
    await Promise.all([
      utils.frontend.shares.list.invalidate({ resourceType, resourceUuid }),
      resourceType === "mcp_server"
        ? utils.frontend.mcpServers.invalidate()
        : utils.frontend.namespaces.invalidate(),
      utils.frontend.endpoints.list.invalidate(),
    ]);
  };

  const upsert = trpc.frontend.shares.upsert.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("access:share.error"), { description: result.message });
        return;
      }
      await invalidate();
    },
    onError: (error) =>
      toast.error(t("access:share.error"), { description: error.message }),
  });
  const remove = trpc.frontend.shares.remove.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t("access:share.error"), { description: result.message });
        return;
      }
      await invalidate();
    },
    onError: (error) =>
      toast.error(t("access:share.error"), { description: error.message }),
  });

  const existingIds = useMemo(
    () => new Set((shares.data?.shares ?? []).map((share) => share.subject.id)),
    [shares.data],
  );
  const candidates = useMemo(
    () =>
      (search.data?.subjects ?? []).filter(
        (subject) =>
          !existingIds.has(subject.id) && subject.id !== shares.data?.owner?.id,
      ),
    [search.data, existingIds, shares.data?.owner?.id],
  );
  const showResults = canManage && query.trim().length > 0;

  useEffect(() => setActiveIndex(0), [debouncedQuery]);
  useEffect(() => {
    if (!open) {
      setQuery("");
      setNewLevel("use");
    }
  }, [open]);

  const allowedLevelsFor = (subject: ShareSubject): ShareLevel[] =>
    subject.systemKey === "everyone" && !isAdmin ? ["use"] : LEVELS;

  const add = (subject: ShareSubject) => {
    const level = allowedLevelsFor(subject).includes(newLevel)
      ? newLevel
      : "use";
    upsert.mutate(
      {
        resourceType,
        resourceUuid,
        subjectType: subject.type,
        subjectId: subject.id,
        level,
      },
      {
        onSuccess: (result) => {
          if (result.success) {
            toast.success(
              t("access:share.added", {
                name:
                  subject.systemKey === "everyone"
                    ? t("access:share.everyone")
                    : subject.name,
              }),
            );
            setQuery("");
            inputRef.current?.focus();
          }
        },
      },
    );
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults || candidates.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % candidates.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (index) => (index - 1 + candidates.length) % candidates.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const subject = candidates[activeIndex];
      if (subject) add(subject);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setQuery("");
    }
  };

  const kindLabel = t(`access:share.kind.${resourceType}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-5 text-primary" aria-hidden />
            {t("access:share.title", { name: resourceName })}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{kindLabel}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              {t("access:share.ownedBy")}
              <OwnerLabel
                owner={shares.data?.owner}
                currentUserId={me?.userId}
              />
            </span>
          </DialogDescription>
        </DialogHeader>

        {canManage && (
          <div className="relative">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={t("access:share.searchPlaceholder")}
                  className="pl-8"
                  role="combobox"
                  aria-expanded={showResults}
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    showResults && candidates[activeIndex]
                      ? `${listboxId}-${candidates[activeIndex].id}`
                      : undefined
                  }
                />
              </div>
              <LevelSelect
                value={newLevel}
                onChange={setNewLevel}
                label={t("access:share.levelForNew")}
              />
            </div>

            {showResults && (
              <ul
                id={listboxId}
                role="listbox"
                aria-label={t("access:share.results")}
                className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
              >
                {search.isFetching && candidates.length === 0 && (
                  <li className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {t("access:share.searching")}
                  </li>
                )}
                {!search.isFetching && candidates.length === 0 && (
                  <li className="px-2 py-3 text-sm text-muted-foreground">
                    {t("access:share.noResults")}
                  </li>
                )}
                {candidates.map((subject, index) => (
                  <li
                    key={`${subject.type}-${subject.id}`}
                    id={`${listboxId}-${subject.id}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      add(subject);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5",
                      index === activeIndex &&
                        "bg-accent text-accent-foreground",
                    )}
                  >
                    <SubjectAvatar subject={subject} />
                    <SubjectText subject={subject} />
                    <span className="text-xs text-muted-foreground">
                      {t(`access:share.subjectType.${subject.type}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <section aria-labelledby={`${listboxId}-heading`} className="space-y-2">
          <h3
            id={`${listboxId}-heading`}
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {t("access:share.withAccess")}
          </h3>

          <ul className="divide-y rounded-lg border">
            <li className="flex items-center gap-3 px-3 py-2.5">
              {shares.data?.owner ? (
                <UserAvatar
                  name={shares.data.owner.name}
                  email={shares.data.owner.email}
                  seed={shares.data.owner.id}
                />
              ) : (
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Building2 className="size-5" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {shares.data?.owner
                    ? shares.data.owner.id === me?.userId
                      ? t("access:owner.you")
                      : shares.data.owner.name
                    : t("access:owner.organization")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {shares.data?.owner
                    ? shares.data.owner.email
                    : t("access:share.organizationHint")}
                </span>
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {t("access:share.ownerRole")}
              </span>
            </li>

            {shares.isLoading && (
              <li className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("access:share.loading")}
              </li>
            )}

            {(shares.data?.shares ?? []).map((share) => (
              <li
                key={share.uuid}
                className="flex items-center gap-3 px-3 py-2"
              >
                <SubjectAvatar subject={share.subject} />
                <SubjectText subject={share.subject} />
                {canManage ? (
                  <>
                    <LevelSelect
                      value={share.level}
                      allowed={allowedLevelsFor(share.subject)}
                      disabled={upsert.isPending}
                      label={t("access:share.levelFor", {
                        name: share.subject.name,
                      })}
                      onChange={(level) =>
                        upsert.mutate({
                          resourceType,
                          resourceUuid,
                          subjectType: share.subject.type,
                          subjectId: share.subject.id,
                          level,
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ shareUuid: share.uuid })}
                      aria-label={t("access:share.remove", {
                        name: share.subject.name,
                      })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                ) : (
                  <AccessBadge
                    access={{ level: share.level, reason: "share" }}
                  />
                )}
              </li>
            ))}

            {!shares.isLoading &&
              canManage &&
              (shares.data?.shares.length ?? 0) === 0 && (
                <li className="px-3 py-4 text-sm text-muted-foreground">
                  {t("access:share.notShared")}
                </li>
              )}
          </ul>

          {!canManage && shares.data && (
            <p className="text-sm text-muted-foreground">
              {t("access:share.readOnlyHint")}
            </p>
          )}
        </section>

        <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t(`access:share.explain.${resourceType}`)}</span>
        </p>
      </DialogContent>
    </Dialog>
  );
}
