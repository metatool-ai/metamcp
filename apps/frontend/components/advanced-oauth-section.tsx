"use client";

import { OAuthClientAuthMethodEnum } from "@repo/zod-types";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "@/hooks/useTranslations";

interface AdvancedOAuthSectionProps {
  // Generic-typed form; the fields below must exist on the parent form.
  // Both CreateServerFormData and EditServerFormData declare the same
  // `oauth_*` field names, so the cast is safe at the call site.
  form: UseFormReturn<FieldValues>;
  defaultOpen?: boolean;
  idPrefix?: string;
}

export function AdvancedOAuthSection({
  form,
  defaultOpen = false,
  idPrefix = "oauth",
}: AdvancedOAuthSectionProps) {
  const { t } = useTranslations();
  const [open, setOpen] = useState(defaultOpen);
  // Auto-expand when defaultOpen becomes true after an async prefill (e.g.
  // the edit modal loading the existing oauth_sessions row). The initial
  // useState happens before the query resolves, so we sync on change.
  useEffect(() => {
    if (defaultOpen) {
      setOpen(true);
    }
  }, [defaultOpen]);
  const errors = form.formState.errors as Record<string, { message?: string }>;

  const setOauthField = (name: string, value: string) =>
    form.setValue(name, value, { shouldDirty: true, shouldValidate: true });

  return (
    <div className="rounded-md border border-dashed bg-muted/30">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={`${idPrefix}-advanced-oauth-content`}
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          {t("mcp-servers:advancedOauth.title")}
        </span>
        <span className="text-xs text-muted-foreground font-normal">
          {t("mcp-servers:advancedOauth.advancedHint")}
        </span>
      </button>

      {open && (
        <div
          id={`${idPrefix}-advanced-oauth-content`}
          className="space-y-3 border-t p-3"
        >
          <p className="text-xs text-muted-foreground">
            {t("mcp-servers:advancedOauth.description")}
          </p>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={`${idPrefix}-oauth-client-id`}
              className="text-sm font-medium"
            >
              {t("mcp-servers:advancedOauth.clientId")}
            </label>
            <Input
              id={`${idPrefix}-oauth-client-id`}
              {...form.register("oauth_client_id")}
              placeholder="3MVG9..."
              autoComplete="off"
            />
            {errors.oauth_client_id?.message && (
              <p className="text-sm text-red-500">
                {errors.oauth_client_id.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={`${idPrefix}-oauth-client-secret`}
              className="text-sm font-medium"
            >
              {t("mcp-servers:advancedOauth.clientSecret")}
            </label>
            <Input
              id={`${idPrefix}-oauth-client-secret`}
              {...form.register("oauth_client_secret")}
              type="password"
              autoComplete="new-password"
              placeholder={t(
                "mcp-servers:advancedOauth.clientSecretPlaceholder",
              )}
            />
            <p className="text-xs text-muted-foreground">
              {t("mcp-servers:advancedOauth.clientSecretHelp")}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={`${idPrefix}-oauth-auth-endpoint`}
              className="text-sm font-medium"
            >
              {t("mcp-servers:advancedOauth.authorizationEndpoint")}
            </label>
            <Input
              id={`${idPrefix}-oauth-auth-endpoint`}
              {...form.register("oauth_authorization_endpoint")}
              type="url"
              placeholder="https://login.salesforce.com/services/oauth2/authorize"
              autoComplete="off"
            />
            {errors.oauth_authorization_endpoint?.message && (
              <p className="text-sm text-red-500">
                {errors.oauth_authorization_endpoint.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={`${idPrefix}-oauth-token-endpoint`}
              className="text-sm font-medium"
            >
              {t("mcp-servers:advancedOauth.tokenEndpoint")}
            </label>
            <Input
              id={`${idPrefix}-oauth-token-endpoint`}
              {...form.register("oauth_token_endpoint")}
              type="url"
              placeholder="https://login.salesforce.com/services/oauth2/token"
              autoComplete="off"
            />
            {errors.oauth_token_endpoint?.message && (
              <p className="text-sm text-red-500">
                {errors.oauth_token_endpoint.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={`${idPrefix}-oauth-scope`}
              className="text-sm font-medium"
            >
              {t("mcp-servers:advancedOauth.scope")}
            </label>
            <Input
              id={`${idPrefix}-oauth-scope`}
              {...form.register("oauth_scope")}
              placeholder="api refresh_token"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {t("mcp-servers:advancedOauth.scopeHelp")}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">
              {t("mcp-servers:advancedOauth.tokenEndpointAuthMethod")}
            </label>
            <Select
              value={
                (form.watch("oauth_token_endpoint_auth_method") as
                  | string
                  | undefined) ?? "none"
              }
              onValueChange={(value) =>
                setOauthField("oauth_token_endpoint_auth_method", value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OAuthClientAuthMethodEnum.options.map((method) => (
                  <SelectItem key={method} value={method}>
                    {method}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => {
              setOauthField("oauth_client_id", "");
              setOauthField("oauth_client_secret", "");
              setOauthField("oauth_authorization_endpoint", "");
              setOauthField("oauth_token_endpoint", "");
              setOauthField("oauth_scope", "");
              setOauthField("oauth_token_endpoint_auth_method", "none");
            }}
          >
            {t("mcp-servers:advancedOauth.clearFields")}
          </Button>
        </div>
      )}
    </div>
  );
}
