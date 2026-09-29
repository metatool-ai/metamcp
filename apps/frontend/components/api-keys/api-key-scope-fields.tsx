"use client";

import type { ApiKeyScope } from "@repo/zod-types";
import { Check, KeyRound, Search, Waypoints } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type ApiKeyScopeFieldsProps = {
  scope: ApiKeyScope;
  endpointUuids: string[];
  onScopeChange: (scope: ApiKeyScope) => void;
  onEndpointUuidsChange: (uuids: string[]) => void;
  /** Organisation keys reach the namespaces shared with everyone. */
  organization?: boolean;
  error?: string;
  disabled?: boolean;
};

/**
 * What an API key may be used for: everything its owner can do, or only the
 * MCP servers of some endpoints (checked again on every request).
 */
export function ApiKeyScopeFields({
  scope,
  endpointUuids,
  onScopeChange,
  onEndpointUuidsChange,
  organization = false,
  error,
  disabled = false,
}: ApiKeyScopeFieldsProps) {
  const { t } = useTranslations();
  const name = useId();

  const options: Array<{
    value: ApiKeyScope;
    icon: typeof KeyRound;
    title: string;
    description: string;
  }> = [
    {
      value: "user",
      icon: KeyRound,
      title: t("api-keys:scopeUser"),
      description: organization
        ? t("api-keys:scopeUserOrgDescription")
        : t("api-keys:scopeUserDescription"),
    },
    {
      value: "endpoints",
      icon: Waypoints,
      title: t("api-keys:scopeEndpoints"),
      description: t("api-keys:scopeEndpointsDescription"),
    },
  ];

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">
        {t("api-keys:scope")}
      </legend>
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const Icon = option.icon;
          const checked = scope === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "relative flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
                checked
                  ? "border-primary bg-primary/5"
                  : "hover:border-foreground/30 hover:bg-muted/50",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onScopeChange(option.value)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    checked ? "text-primary" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                {option.title}
                {checked && (
                  <Check className="ml-auto size-4 text-primary" aria-hidden />
                )}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {option.description}
              </span>
            </label>
          );
        })}
      </div>

      {scope === "endpoints" && (
        <EndpointPicker
          selected={endpointUuids}
          onChange={onEndpointUuidsChange}
          error={error}
        />
      )}
    </fieldset>
  );
}

function EndpointPicker({
  selected,
  onChange,
  error,
}: {
  selected: string[];
  onChange: (uuids: string[]) => void;
  error?: string;
}) {
  const { t } = useTranslations();
  const [search, setSearch] = useState("");
  const listId = useId();
  const errorId = useId();
  const { data, isLoading } = trpc.frontend.endpoints.list.useQuery();

  const endpoints = useMemo(
    () =>
      (data?.success ? data.data : [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const query = search.trim().toLowerCase();
  const visible = query
    ? endpoints.filter(
        (endpoint) =>
          endpoint.name.toLowerCase().includes(query) ||
          endpoint.namespace.name.toLowerCase().includes(query),
      )
    : endpoints;
  const selectedSet = new Set(selected);

  const toggle = (uuid: string) => {
    onChange(
      selectedSet.has(uuid)
        ? selected.filter((value) => value !== uuid)
        : [...selected, uuid],
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span id={listId} className="text-sm font-medium">
          {t("api-keys:endpoints")}
        </span>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {t("api-keys:selectedEndpoints", { count: selected.length })}
        </span>
      </div>
      {endpoints.length > 6 && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("api-keys:searchEndpoints")}
            aria-label={t("api-keys:searchEndpoints")}
            className="pl-8"
          />
        </div>
      )}
      <div
        role="group"
        aria-labelledby={listId}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "max-h-56 overflow-y-auto rounded-md border",
          error && "border-destructive",
        )}
      >
        {isLoading ? (
          <p className="p-3 text-sm text-muted-foreground">
            {t("common:loading")}
          </p>
        ) : visible.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {endpoints.length === 0
              ? t("api-keys:noEndpoints")
              : t("api-keys:noEndpointMatch")}
          </p>
        ) : (
          <ul className="divide-y">
            {visible.map((endpoint) => {
              const checked = selectedSet.has(endpoint.uuid);
              return (
                <li key={endpoint.uuid}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(endpoint.uuid)}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm">
                        {endpoint.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {endpoint.namespace.name}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
