"use client";

import type {
  ActivityCategory,
  ActivityOutcome,
  ListActivityRequest,
} from "@repo/zod-types";
import { ActivityCategoryEnum } from "@repo/zod-types";
import {
  Bot,
  Download,
  Fingerprint,
  FolderCog,
  KeyRound,
  LockKeyhole,
  LogIn,
  type LucideIcon,
  ScrollText,
  Search,
  Settings,
  Share2,
  ShieldHalf,
  UserCog,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/hooks/useTranslations";
import { type RouterOutputs, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Entry =
  RouterOutputs["frontend"]["admin"]["activity"]["list"]["entries"][number];

const PAGE_SIZE = 50;
const ALL = "all";

const CATEGORY_ICONS: Record<ActivityCategory, LucideIcon> = {
  auth: LogIn,
  users: UserCog,
  groups: Users,
  roles: ShieldHalf,
  sso: Fingerprint,
  settings: Settings,
  sharing: Share2,
  resources: FolderCog,
  api_keys: KeyRound,
  security: LockKeyhole,
};

const PERIODS = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
  "90d": 24 * 90,
} as const;
type Period = keyof typeof PERIODS | typeof ALL;

function isCategory(value: string): value is ActivityCategory {
  return (ActivityCategoryEnum.options as string[]).includes(value);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "∅";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Short, factual summary chips of an entry's details. */
function detailChips(details: Record<string, unknown>): string[] {
  const chips: string[] = [];
  const changes = details.changes;
  if (changes && typeof changes === "object") {
    for (const [field, change] of Object.entries(
      changes as Record<string, { from?: unknown; to?: unknown }>,
    )) {
      chips.push(
        `${field}: ${formatValue(change?.from)} → ${formatValue(change?.to)}`,
      );
    }
  }
  for (const [key, value] of Object.entries(details)) {
    if (key === "changes") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    chips.push(`${key}: ${formatValue(value)}`);
  }
  return chips;
}

function useSystemLabel() {
  const { t } = useTranslations();
  return (label: string | null) => {
    if (!label) return t("admin:activity.system.default");
    const key = `admin:activity.system.${label.replace(/[^A-Za-z]/g, "")}`;
    const translated = t(key);
    return translated === key ? label : translated;
  };
}

function ActorLabel({ entry }: { entry: Entry }) {
  const systemLabel = useSystemLabel();
  if (entry.actorType === "system") {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Bot className="size-3.5 text-muted-foreground" aria-hidden />
        {systemLabel(entry.actorName)}
      </span>
    );
  }
  return (
    <span className="font-medium">
      {entry.actorName || entry.actorEmail || entry.actorId}
    </span>
  );
}

function EntryRow({
  entry,
  onOpen,
  locale,
}: {
  entry: Entry;
  onOpen: () => void;
  locale: string;
}) {
  const { t } = useTranslations();
  const category = isCategory(entry.category) ? entry.category : "settings";
  const Icon = CATEGORY_ICONS[category];
  const denied = entry.outcome !== "success";
  const chips = detailChips(entry.details);
  const time = new Date(entry.createdAt);
  const sameSubject =
    entry.targetType === "user" && entry.targetId === entry.actorId;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
      >
        <span
          className={cn(
            "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border",
            denied
              ? "border-tone-danger/30 bg-tone-danger/10 text-tone-danger"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">
              {t(`admin:activity.actions.${entry.action}`)}
            </span>
            {denied && (
              <span className="inline-flex h-5 items-center rounded-md border border-tone-danger/30 bg-tone-danger/10 px-1.5 text-[11px] font-medium text-tone-danger">
                {t(`admin:activity.outcome.${entry.outcome}`)}
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <ActorLabel entry={entry} />
            {entry.targetLabel && !sameSubject && (
              <>
                <span aria-hidden>→</span>
                <span className="truncate text-foreground/80">
                  {entry.targetLabel}
                </span>
              </>
            )}
          </span>
          {chips.length > 0 && (
            <span className="flex flex-wrap gap-1.5 pt-0.5">
              {chips.slice(0, 4).map((chip) => (
                <code
                  key={chip}
                  className="max-w-full truncate rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {chip}
                </code>
              ))}
              {chips.length > 4 && (
                <span className="text-[11px] text-muted-foreground">
                  +{chips.length - 4}
                </span>
              )}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
          <time
            dateTime={time.toISOString()}
            title={time.toLocaleString(locale)}
            className="tabular-nums"
          >
            {time.toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          {entry.ipAddress && (
            <span className="font-mono">{entry.ipAddress}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function EntrySheet({
  entry,
  onClose,
  locale,
}: {
  entry: Entry | null;
  onClose: () => void;
  locale: string;
}) {
  const { t } = useTranslations();
  const systemLabel = useSystemLabel();
  if (!entry) {
    return (
      <Sheet open={false} onOpenChange={onClose}>
        <SheetContent />
      </Sheet>
    );
  }
  const rows: [string, string | null][] = [
    ["time", new Date(entry.createdAt).toLocaleString(locale)],
    [
      "actor",
      entry.actorType === "system"
        ? systemLabel(entry.actorName)
        : [entry.actorName, entry.actorEmail].filter(Boolean).join(" · "),
    ],
    ["actorId", entry.actorId],
    ["action", entry.action],
    ["category", t(`admin:activity.categories.${entry.category}`)],
    ["outcome", t(`admin:activity.outcome.${entry.outcome}`)],
    ["target", entry.targetLabel],
    ["targetType", entry.targetType],
    ["targetId", entry.targetId],
    ["ipAddress", entry.ipAddress],
    ["userAgent", entry.userAgent],
  ];
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>{t(`admin:activity.actions.${entry.action}`)}</SheetTitle>
          <SheetDescription>
            {t("admin:activity.sheetDescription")}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {rows
              .filter(([, value]) => value)
              .map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">
                    {t(`admin:activity.fields.${key}`)}
                  </dt>
                  <dd className="min-w-0 break-words font-mono text-xs leading-5">
                    {value}
                  </dd>
                </div>
              ))}
          </dl>
          {Object.keys(entry.details).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                {t("admin:activity.fields.details")}
              </h3>
              <CodeBlock language="json" maxHeight="360px">
                {JSON.stringify(entry.details, null, 2)}
              </CodeBlock>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function dayLabel(date: Date, locale: string, t: (key: string) => string) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) {
    return t("admin:activity.today");
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return t("admin:activity.yesterday");
  }
  return date.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ActivityPage() {
  const { t, locale } = useTranslations();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ActivityCategory | typeof ALL>(ALL);
  const [outcome, setOutcome] = useState<ActivityOutcome | typeof ALL>(ALL);
  const [period, setPeriod] = useState<Period>("30d");
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [exporting, setExporting] = useState(false);

  // The start of the period is fixed when filters change, not on every render.
  const filters = useMemo(() => {
    const from =
      period === ALL
        ? undefined
        : new Date(Date.now() - PERIODS[period] * 3_600_000);
    return {
      search: search.trim() || undefined,
      category: category === ALL ? undefined : category,
      outcome: outcome === ALL ? undefined : outcome,
      from,
    } satisfies Partial<ListActivityRequest>;
  }, [search, category, outcome, period]);

  const activity = trpc.frontend.admin.activity.list.useQuery(
    { ...filters, offset: 0, limit: PAGE_SIZE * pages },
    { placeholderData: (previous) => previous },
  );
  const entries = useMemo(() => activity.data?.entries ?? [], [activity.data]);
  const total = activity.data?.total ?? 0;

  const days = useMemo(() => {
    const groups: { label: string; entries: Entry[] }[] = [];
    for (const entry of entries) {
      const label = dayLabel(new Date(entry.createdAt), locale, t);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.entries.push(entry);
      else groups.push({ label, entries: [entry] });
    }
    return groups;
  }, [entries, locale, t]);

  const resetPaging = () => setPages(1);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { csv, truncated } =
        await utils.frontend.admin.activity.export.fetch({
          ...filters,
          offset: 0,
          limit: PAGE_SIZE,
        });
      const blob = new Blob([String.fromCharCode(0xfeff) + csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `metamcp-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      if (truncated) toast.warning(t("admin:activity.exportTruncated"));
    } catch (error) {
      toast.error(t("admin:activity.exportError"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  const retentionDays = activity.data?.retentionDays;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={ScrollText}
        title={t("admin:activity.title")}
        description={
          retentionDays
            ? t("admin:activity.descriptionRetention", { days: retentionDays })
            : t("admin:activity.description")
        }
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={exporting}>
            <Download className="mr-2 size-4" aria-hidden />
            {t("admin:activity.export")}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:max-w-sm lg:flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPaging();
            }}
            placeholder={t("admin:activity.searchPlaceholder")}
            aria-label={t("admin:activity.searchPlaceholder")}
            className="pl-8"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex">
          <Select
            value={category}
            onValueChange={(value) => {
              setCategory(value as ActivityCategory | typeof ALL);
              resetPaging();
            }}
          >
            <SelectTrigger
              className="lg:w-44"
              aria-label={t("admin:activity.filters.category")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("admin:activity.filters.allCategories")}
              </SelectItem>
              {ActivityCategoryEnum.options.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`admin:activity.categories.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={outcome}
            onValueChange={(value) => {
              setOutcome(value as ActivityOutcome | typeof ALL);
              resetPaging();
            }}
          >
            <SelectTrigger
              className="lg:w-40"
              aria-label={t("admin:activity.filters.outcome")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("admin:activity.filters.allOutcomes")}
              </SelectItem>
              {(["success", "denied", "failure"] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`admin:activity.outcome.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={period}
            onValueChange={(value) => {
              setPeriod(value as Period);
              resetPaging();
            }}
          >
            <SelectTrigger
              className="lg:w-44"
              aria-label={t("admin:activity.filters.period")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {t(`admin:activity.periods.${value}`)}
                  </SelectItem>
                ),
              )}
              <SelectItem value={ALL}>
                {t("admin:activity.periods.all")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {activity.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <ScrollText className="size-10 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">{t("admin:activity.empty.title")}</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {t("admin:activity.empty.description")}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {days.map((day) => (
            <section key={day.label} className="space-y-2">
              <h2 className="sticky top-0 z-10 bg-background/95 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                {day.label}
              </h2>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {day.entries.map((entry) => (
                  <EntryRow
                    key={entry.uuid}
                    entry={entry}
                    locale={locale}
                    onOpen={() => setSelected(entry)}
                  />
                ))}
              </ul>
            </section>
          ))}
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <span>
              {t("admin:activity.showing", {
                shown: entries.length,
                total,
              })}
            </span>
            {entries.length < total && (
              <Button
                variant="outline"
                onClick={() => setPages((value) => value + 1)}
                disabled={activity.isFetching}
              >
                {t("admin:activity.loadMore")}
              </Button>
            )}
          </div>
        </div>
      )}

      <EntrySheet
        entry={selected}
        locale={locale}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
