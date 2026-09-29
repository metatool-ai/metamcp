"use client";

import type { ApiKeyScope } from "@repo/zod-types";
import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";
import { type ApiKeyRow, trpc } from "@/lib/trpc";

import { ApiKeyScopeFields } from "./api-key-scope-fields";

const NAME_PATTERN = /^[a-zA-Z0-9_\s-]+$/;

/** Name, status and scope of an existing key (the key itself never changes). */
export function EditApiKeyDialog({
  apiKey,
  onClose,
  onSaved,
}: {
  apiKey: ApiKeyRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslations();
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [scope, setScope] = useState<ApiKeyScope>("user");
  const [endpointUuids, setEndpointUuids] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (apiKey) {
      setName(apiKey.name);
      setIsActive(apiKey.is_active);
      setScope(apiKey.scope);
      setEndpointUuids(apiKey.endpoints.map((endpoint) => endpoint.uuid));
      setSubmitted(false);
    }
  }, [apiKey]);

  const updateMutation = trpc.frontend.apiKeys.update.useMutation({
    onSuccess: () => {
      toast.success(t("api-keys:apiKeyUpdated"));
      onSaved();
      onClose();
    },
    onError: (error) => {
      toast.error(t("api-keys:updateError"), { description: error.message });
    },
  });

  const nameError = !name.trim()
    ? t("validation:apiKeyName.required")
    : !NAME_PATTERN.test(name)
      ? t("api-keys:nameInvalid")
      : undefined;
  const endpointsError =
    scope === "endpoints" && endpointUuids.length === 0
      ? t("validation:apiKeyScope.endpointsRequired")
      : undefined;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!apiKey || nameError || endpointsError) return;
    const scopeChanged =
      scope !== apiKey.scope ||
      (scope === "endpoints" &&
        [...endpointUuids].sort().join() !==
          apiKey.endpoints
            .map((endpoint) => endpoint.uuid)
            .sort()
            .join());
    updateMutation.mutate({
      uuid: apiKey.uuid,
      name: name.trim(),
      is_active: isActive,
      ...(scopeChanged
        ? {
            scope,
            ...(scope === "endpoints" ? { endpoint_uuids: endpointUuids } : {}),
          }
        : {}),
    });
  };

  return (
    <Dialog open={apiKey !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("api-keys:editApiKey")}</DialogTitle>
          <DialogDescription>
            {t("api-keys:editApiKeyDescription")}
          </DialogDescription>
        </DialogHeader>
        {apiKey && (
          <form onSubmit={save} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="api-key-name">{t("api-keys:name")}</Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={submitted && Boolean(nameError)}
              />
              {submitted && nameError && (
                <p role="alert" className="text-sm text-destructive">
                  {nameError}
                </p>
              )}
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="api-key-active">{t("common:active")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("api-keys:activeDescription")}
                </p>
              </div>
              <Switch
                id="api-key-active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>

            <ApiKeyScopeFields
              scope={scope}
              endpointUuids={endpointUuids}
              onScopeChange={setScope}
              onEndpointUuidsChange={setEndpointUuids}
              organization={apiKey.user_id === null}
              error={submitted ? endpointsError : undefined}
            />

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={onClose}
              >
                {t("api-keys:cancel")}
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending
                  ? t("api-keys:saving")
                  : t("api-keys:save")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
