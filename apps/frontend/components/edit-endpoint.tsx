"use client";

import {
  EditEndpointFormData,
  editEndpointFormSchema,
  EndpointWithNamespace,
  UpdateEndpointRequest,
} from "@repo/zod-types";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { createTranslatedZodResolver } from "@/lib/zod-resolver";

interface EditEndpointProps {
  endpoint: EndpointWithNamespace | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedEndpoint: EndpointWithNamespace) => void;
}

export function EditEndpoint({
  endpoint,
  isOpen,
  onClose,
  onSuccess,
}: EditEndpointProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedNamespaceUuid, setSelectedNamespaceUuid] =
    useState<string>("");
  const [selectedNamespaceName, setSelectedNamespaceName] =
    useState<string>("");
  const { t } = useTranslations();

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // Fetch namespaces list
  const { data: namespacesResponse, isLoading: namespacesLoading } =
    trpc.frontend.namespaces.list.useQuery();
  const availableNamespaces = namespacesResponse?.success
    ? namespacesResponse.data
    : [];

  // tRPC mutation for updating endpoint
  const updateEndpointMutation = trpc.frontend.endpoints.update.useMutation({
    onSuccess: (data) => {
      if (data.success && data.data) {
        // Invalidate both the list and individual endpoint queries, and MCP servers list
        utils.frontend.endpoints.list.invalidate();
        utils.frontend.mcpServers.list.invalidate();
        if (endpoint) {
          utils.frontend.endpoints.get.invalidate({ uuid: endpoint.uuid });
        }

        toast.success(t("endpoints:edit.updateSuccess"), {
          description: t("endpoints:edit.updateSuccessDescription"),
        });

        // Get the updated endpoint with namespace info for the callback
        const updatedEndpoint: EndpointWithNamespace = {
          ...data.data,
          namespace:
            availableNamespaces.find(
              (ns) => ns.uuid === data.data!.namespace_uuid,
            ) || endpoint!.namespace,
        };

        onSuccess(updatedEndpoint);
        onClose();
        editForm.reset();
      } else {
        toast.error(t("endpoints:edit.updateFailed"), {
          description:
            data.message || t("endpoints:edit.updateFailedDescription"),
        });
      }
    },
    onError: (error) => {
      console.error("Error updating endpoint:", error);
      toast.error(t("endpoints:edit.updateFailed"), {
        description: error.message || t("common:unexpectedError"),
      });
    },
    onSettled: () => {
      setIsUpdating(false);
    },
  });

  const editForm = useForm<EditEndpointFormData>({
    resolver: createTranslatedZodResolver(editEndpointFormSchema, t),
    defaultValues: {
      name: "",
      description: "",
      namespaceUuid: "",
      enableApiKeyAuth: true,
      enableMaxRate: false,
      enableClientMaxRate: false,
      maxRate: undefined,
      maxRateSeconds: undefined,
      clientMaxRate: undefined,
      clientMaxRateSeconds: undefined,
      clientMaxRateStrategy: "ip",
      clientMaxRateStrategyKey: "",
      enableOauth: false,
      useQueryParamAuth: false,
    },
  });

  // Pre-populate form when endpoint changes
  useEffect(() => {
    if (endpoint && isOpen) {
      editForm.reset({
        name: endpoint.name,
        description: endpoint.description || "",
        namespaceUuid: endpoint.namespace.uuid,
        enableApiKeyAuth: endpoint.enable_api_key_auth ?? true,
        enableMaxRate: endpoint.enableMaxRate,
        enableClientMaxRate: endpoint.enableClientMaxRate,
        maxRate: endpoint.maxRate,
        maxRateSeconds: endpoint.maxRateSeconds,
        clientMaxRate: endpoint.clientMaxRate,
        clientMaxRateSeconds: endpoint.clientMaxRateSeconds,
        clientMaxRateStrategy: endpoint.clientMaxRateStrategy,
        clientMaxRateStrategyKey: endpoint.clientMaxRateStrategyKey,
        enableOauth: endpoint.enable_oauth ?? false,
        useQueryParamAuth: endpoint.use_query_param_auth ?? false,
      });
      setSelectedNamespaceUuid(endpoint.namespace.uuid);
      setSelectedNamespaceName(endpoint.namespace.name);
    }
  }, [endpoint, isOpen, editForm]);

  // Handle namespace selection
  const handleNamespaceSelect = (
    namespaceUuid: string,
    namespaceName: string,
  ) => {
    setSelectedNamespaceUuid(namespaceUuid);
    setSelectedNamespaceName(namespaceName);
    editForm.setValue("namespaceUuid", namespaceUuid);
    editForm.clearErrors("namespaceUuid");
  };

  // Handle edit endpoint
  const handleEditEndpoint = async (data: EditEndpointFormData) => {
    if (!endpoint) return;

    setIsUpdating(true);
    try {
      // Create the API request payload
      const apiPayload: UpdateEndpointRequest = {
        uuid: endpoint.uuid,
        name: data.name,
        description: data.description,
        namespaceUuid: data.namespaceUuid,
        enableApiKeyAuth: data.enableApiKeyAuth,
        enableMaxRate: data.enableMaxRate,
        enableClientMaxRate: data.enableClientMaxRate,
        maxRate: data.maxRate,
        maxRateSeconds: data.maxRateSeconds,
        clientMaxRate: data.clientMaxRate,
        clientMaxRateSeconds: data.clientMaxRateSeconds,
        clientMaxRateStrategy: data.clientMaxRateStrategy,
        clientMaxRateStrategyKey: data.clientMaxRateStrategyKey,
        enableOauth: data.enableOauth,
        useQueryParamAuth: data.useQueryParamAuth,
      };
      // Use tRPC mutation
      updateEndpointMutation.mutate(apiPayload);
    } catch (error) {
      setIsUpdating(false);
      console.error("Error preparing endpoint data:", error);
      toast.error(t("endpoints:edit.updateFailed"), {
        description:
          error instanceof Error ? error.message : t("common:unexpectedError"),
      });
    }
  };

  const handleClose = () => {
    onClose();
    editForm.reset({
      name: "",
      description: "",
      namespaceUuid: "",
      enableApiKeyAuth: true,
      enableOauth: false,
      useQueryParamAuth: false,
    });
    setSelectedNamespaceUuid("");
    setSelectedNamespaceName("");
  };

  if (!endpoint) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("endpoints:edit.title")}</DialogTitle>
          <DialogDescription>
            {t("endpoints:edit.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={editForm.handleSubmit(handleEditEndpoint)}>
          <div className="grid gap-4 py-4">
            {/* Endpoint Name */}
            <div className="space-y-2">
              <label htmlFor="edit-name" className="text-sm font-medium">
                {t("endpoints:edit.nameLabel")} *
              </label>
              <Input
                id="edit-name"
                placeholder={t("endpoints:edit.namePlaceholder")}
                {...editForm.register("name")}
                disabled={isUpdating}
              />
              {editForm.formState.errors.name && (
                <p className="text-sm text-red-500">
                  {editForm.formState.errors.name.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("endpoints:edit.nameHelpText")}
              </p>
            </div>

            {/* Endpoint Description */}
            <div className="space-y-2">
              <label htmlFor="edit-description" className="text-sm font-medium">
                {t("endpoints:edit.descriptionLabel")}
              </label>
              <Textarea
                id="edit-description"
                placeholder={t("endpoints:edit.descriptionPlaceholder")}
                {...editForm.register("description")}
                disabled={isUpdating}
                rows={3}
              />
              {editForm.formState.errors.description && (
                <p className="text-sm text-red-500">
                  {editForm.formState.errors.description.message}
                </p>
              )}
            </div>

            {/* Namespace Selection */}
            <div className="space-y-2">
              <label htmlFor="edit-namespace" className="text-sm font-medium">
                {t("endpoints:edit.namespaceLabel")} *
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between"
                    disabled={namespacesLoading || isUpdating}
                  >
                    {selectedNamespaceName ||
                      t("endpoints:edit.selectNamespace")}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-full"
                  style={{
                    minWidth: "var(--radix-dropdown-menu-trigger-width)",
                  }}
                >
                  {availableNamespaces.map((namespace) => (
                    <DropdownMenuItem
                      key={namespace.uuid}
                      onClick={() =>
                        handleNamespaceSelect(namespace.uuid, namespace.name)
                      }
                      className="flex items-center justify-between"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{namespace.name}</span>
                        {namespace.description && (
                          <span className="text-xs text-muted-foreground">
                            {namespace.description}
                          </span>
                        )}
                      </div>
                      {selectedNamespaceUuid === namespace.uuid && (
                        <Check className="h-4 w-4" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {editForm.formState.errors.namespaceUuid && (
                <p className="text-sm text-red-500">
                  {editForm.formState.errors.namespaceUuid.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("endpoints:edit.namespaceHelpText")}
              </p>
            </div>
            {/* Rate Limit Settings */}
            <div className="space-y-4 border-t pt-4">
              <h4 className="text-sm font-medium">
                {t("endpoints:rateLimit")}
              </h4>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">
                    {t("endpoints:enableMaxRate")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("endpoints:enableMaxRateDescription")}
                  </p>
                </div>
                <Switch
                  checked={editForm.watch("enableMaxRate")}
                  onCheckedChange={(checked) =>
                    editForm.setValue("enableMaxRate", checked)
                  }
                  disabled={isUpdating}
                />
              </div>
              {editForm.watch("enableMaxRate") && (
                <>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="maxRate" className="text-sm font-medium">
                      {t("endpoints:maxRate")}
                    </label>
                    <Input
                      id="maxRate"
                      {...editForm.register("maxRate", { valueAsNumber: true })}
                      placeholder={t("endpoints:maxRatePlaceholder")}
                      type="number"
                    />
                    {editForm.formState.errors.maxRate && (
                      <p className="text-sm text-red-500">
                        {editForm.formState.errors.maxRate.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t("endpoints:maxRateDescription")}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="maxRateSeconds" className="text-sm font-medium">
                      {t("endpoints:maxRateSeconds")}
                    </label>
                    <Input
                      id="maxRateSeconds"
                      type="number"
                      {...editForm.register("maxRateSeconds", { valueAsNumber: true })}
                      placeholder={t("endpoints:maxRateSecondsPlaceholder")}
                    />
                    {editForm.formState.errors.maxRateSeconds && (
                      <p className="text-sm text-red-500">
                        {editForm.formState.errors.maxRateSeconds.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t("endpoints:maxRateSecondsDescription")}
                    </p>
                  </div>
                </>)}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">
                    {t("endpoints:enableClientMaxRate")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("endpoints:enableClientMaxRateDescription")}
                  </p>
                </div>
                <Switch
                  checked={editForm.watch("enableClientMaxRate")}
                  onCheckedChange={(checked) =>
                    editForm.setValue("enableClientMaxRate", checked)
                  }
                  disabled={isUpdating}
                />
              </div>
              {editForm.watch("enableClientMaxRate") && (
                <>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="clientMaxRate" className="text-sm font-medium">
                      {t("endpoints:clientMaxRate")}
                    </label>
                    <Input
                      id="clientMaxRate"
                      {...editForm.register("clientMaxRate", { valueAsNumber: true })}
                      type="number"
                      placeholder={t("endpoints:clientMaxRatePlaceholder")}
                    />
                    {editForm.formState.errors.clientMaxRate && (
                      <p className="text-sm text-red-500">
                        {editForm.formState.errors.clientMaxRate.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t("endpoints:clientMaxRateDescription")}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="clientMaxRateSeconds" className="text-sm font-medium">
                      {t("endpoints:clientMaxRateSeconds")}
                    </label>
                    <Input
                      id="clientMaxRateSeconds"
                      {...editForm.register("clientMaxRateSeconds", { valueAsNumber: true })}
                      placeholder={t("endpoints:clientMaxRateSecondsPlaceholder")}
                      type="number"
                    />
                    {editForm.formState.errors.clientMaxRateSeconds && (
                      <p className="text-sm text-red-500">
                        {editForm.formState.errors.clientMaxRateSeconds.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t("endpoints:clientMaxRateSecondsDescription")}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="clientMaxRateStrategy" className="text-sm font-medium">
                      {t("endpoints:clientMaxRateStrategy")}
                    </label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-between"
                          type="button"
                        >
                          <span>
                            {editForm.watch("clientMaxRateStrategy") === null ? t("endpoints:selectStrategy") : editForm.watch("clientMaxRateStrategy") === "ip" ? t("endpoints:ipStrategy") : editForm.watch("clientMaxRateStrategy") === "header" ? t("endpoints:headerStrategy") : t("endpoints:selectStrategy")}
                          </span>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)]">
                        <DropdownMenuItem
                          onClick={() => editForm.setValue("clientMaxRateStrategy", "ip")}
                        >
                          {t("endpoints:ipStrategy")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => editForm.setValue("clientMaxRateStrategy", "header")}
                        >
                          {t("endpoints:headerStrategy")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {editForm.formState.errors.clientMaxRateStrategy && (
                      <p className="text-sm text-red-500">
                        {editForm.formState.errors.clientMaxRateStrategy.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t("endpoints:clientMaxRateStrategyDescription")}
                    </p>
                  </div>
                  {editForm.watch("clientMaxRateStrategy") === "header" && (
                    <div className="flex flex-col gap-2">
                      <label htmlFor="clientMaxRateStrategyKey" className="text-sm font-medium">
                        {t("endpoints:clientMaxRateStrategyKey")}
                      </label>
                      <Input
                        id="clientMaxRateStrategyKey"
                        {...editForm.register("clientMaxRateStrategyKey")}
                        placeholder={t("endpoints:clientMaxRateStrategyKeyPlaceholder")}
                      />
                      {editForm.formState.errors.clientMaxRateStrategyKey && (
                        <p className="text-sm text-red-500">
                          {editForm.formState.errors.clientMaxRateStrategyKey.message}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {t("endpoints:clientMaxRateStrategyKeyDescription")}
                      </p>
                    </div>
                  )}
                </>)}
            </div>
            {/* API Key Authentication Settings */}
            <div className="space-y-4 border-t pt-4">
              <h4 className="text-sm font-medium">
                {t("endpoints:edit.apiKeyAuthSection")}
              </h4>

              {/* Enable API Key Auth */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">
                    {t("endpoints:edit.enableApiKeyAuthLabel")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("endpoints:edit.enableApiKeyAuthDescription")}
                  </p>
                </div>
                <Switch
                  checked={editForm.watch("enableApiKeyAuth")}
                  onCheckedChange={(checked) =>
                    editForm.setValue("enableApiKeyAuth", checked)
                  }
                  disabled={isUpdating}
                />
              </div>

              {/* Query Parameter Auth */}
              {editForm.watch("enableApiKeyAuth") && (
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium">
                      {t("endpoints:edit.useQueryParamAuthLabel")}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {t("endpoints:edit.useQueryParamAuthDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={editForm.watch("useQueryParamAuth")}
                    onCheckedChange={(checked) =>
                      editForm.setValue("useQueryParamAuth", checked)
                    }
                    disabled={isUpdating}
                  />
                </div>
              )}
            </div>

            {/* OAuth Authentication Settings */}
            <div className="space-y-4 border-t pt-4">
              <h4 className="text-sm font-medium">
                {t("endpoints:edit.oauthAuthSection")}
              </h4>

              {/* Enable OAuth Auth */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">
                    {t("endpoints:edit.enableOauthLabel")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("endpoints:edit.enableOauthDescription")}
                  </p>
                </div>
                <Switch
                  checked={editForm.watch("enableOauth")}
                  onCheckedChange={(checked) =>
                    editForm.setValue("enableOauth", checked)
                  }
                  disabled={isUpdating}
                />
              </div>

              {/* OAuth HTTPS Warning */}
              {editForm.watch("enableOauth") && (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800/30 rounded-md">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    {t("endpoints:edit.oauthHttpsWarning")}
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isUpdating}
            >
              {t("common:cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isUpdating || !selectedNamespaceUuid}
            >
              {isUpdating
                ? t("endpoints:edit.updating")
                : t("endpoints:edit.updateEndpoint")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
