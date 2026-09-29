"use client";

import { CreateApiKeyFormSchema } from "@repo/zod-types";
import { format } from "date-fns";
import {
  Copy,
  Key,
  KeyRound,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  Waypoints,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ApiKeyScopeFields } from "@/components/api-keys/api-key-scope-fields";
import { EditApiKeyDialog } from "@/components/api-keys/edit-api-key-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccess } from "@/hooks/useAccess";
import { useTranslations } from "@/hooks/useTranslations";
import { dateLocale } from "@/lib/date-locale";
import { type ApiKeyRow, trpc } from "@/lib/trpc";
import { createTranslatedZodResolver } from "@/lib/zod-resolver";

type CreateApiKeyFormData = z.infer<typeof CreateApiKeyFormSchema>;

export default function ApiKeysPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  // Shown once: MetaMCP only stores a fingerprint of the key.
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [apiKeyToDelete, setApiKeyToDelete] = useState<{
    uuid: string;
    name: string;
  } | null>(null);
  const [apiKeyToEdit, setApiKeyToEdit] = useState<ApiKeyRow | null>(null);
  // Administrators: also the keys of every user (to revoke a leaked one)
  const [showAllUsers, setShowAllUsers] = useState(false);
  const { t, locale } = useTranslations();
  const { isAdmin, can } = useAccess();
  const allUsers = isAdmin && showAllUsers;

  const { data: apiKeys, refetch } = trpc.frontend.apiKeys.list.useQuery({
    allUsers,
  });
  const createMutation = trpc.frontend.apiKeys.create.useMutation({
    onSuccess: (data) => {
      setNewApiKey(data.key);
      refetch();
      toast.success(t("api-keys:apiKeyCreated"));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = trpc.frontend.apiKeys.delete.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        refetch();
        toast.success(t("api-keys:apiKeyDeleted"));
        setDeleteDialogOpen(false);
        setApiKeyToDelete(null);
      } else {
        // Handle backend error response
        toast.error(data.message || t("api-keys:apiKeyDeleted"));
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const form = useForm<CreateApiKeyFormData>({
    resolver: createTranslatedZodResolver(CreateApiKeyFormSchema, t),
    defaultValues: {
      name: "",
      user_id: undefined, // Will be set based on ownership selection
      scope: "user",
      endpoint_uuids: [],
    },
  });

  const onSubmit = (data: CreateApiKeyFormData) => {
    createMutation.mutate({
      ...data,
      endpoint_uuids: data.scope === "endpoints" ? data.endpoint_uuids : [],
    });
  };
  const scopeError = form.formState.errors.endpoint_uuids?.message;

  const handleCreateSuccess = () => {
    form.reset();
    setCreateDialogOpen(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("api-keys:copyToClipboard"));
  };

  const handleDeleteClick = (apiKey: { uuid: string; name: string }) => {
    setApiKeyToDelete(apiKey);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (apiKeyToDelete) {
      deleteMutation.mutate({ uuid: apiKeyToDelete.uuid });
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setApiKeyToDelete(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Key className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("api-keys:title")}
            </h1>
            <p className="text-muted-foreground">{t("api-keys:description")}</p>
          </div>
        </div>
        {can("api_keys.create") && (
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {t("api-keys:createApiKey")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{t("api-keys:createApiKey")}</DialogTitle>
                <DialogDescription>
                  {t("api-keys:createApiKeyDescription")}
                </DialogDescription>
              </DialogHeader>
              {newApiKey ? (
                <div className="space-y-4">
                  <div
                    role="alert"
                    className="flex items-start gap-3 rounded-lg border border-tone-admin/30 bg-tone-admin/5 p-3"
                  >
                    <ShieldAlert
                      className="mt-0.5 size-5 shrink-0 text-tone-admin"
                      aria-hidden
                    />
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">
                        {t("api-keys:keyOnceTitle")}
                      </p>
                      <p className="text-muted-foreground">
                        {t("api-keys:keyOnceWarning")}
                      </p>
                    </div>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-2">
                      {t("api-keys:newApiKey")}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 p-2 bg-background rounded border text-sm font-mono break-all select-all">
                        {newApiKey}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(newApiKey)}
                        aria-label={t("api-keys:copy")}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      setNewApiKey(null);
                      handleCreateSuccess();
                    }}
                    className="w-full"
                  >
                    {t("api-keys:copied")}
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                >
                  <div>
                    <label className="text-sm font-medium">
                      {t("api-keys:name")}
                    </label>
                    <Input
                      {...form.register("name")}
                      placeholder={t("api-keys:namePlaceholder")}
                    />
                    {form.formState.errors.name && (
                      <p className="text-sm text-destructive mt-1">
                        {form.formState.errors.name.message}
                      </p>
                    )}
                  </div>
                  {isAdmin && (
                    <div>
                      <Label
                        htmlFor="ownership"
                        className="text-sm font-medium"
                      >
                        {t("api-keys:ownership")}
                      </Label>
                      <Select
                        value={
                          form.watch("user_id") === null ? "public" : "private"
                        }
                        onValueChange={(value) => {
                          form.setValue(
                            "user_id",
                            value === "public" ? null : undefined,
                          );
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("api-keys:ownership")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="private">
                            {t("api-keys:forMyself")}
                          </SelectItem>
                          <SelectItem value="public">
                            {t("access:organizationKey")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("access:organizationKeyHelp")}
                      </p>
                    </div>
                  )}
                  <ApiKeyScopeFields
                    scope={form.watch("scope")}
                    endpointUuids={form.watch("endpoint_uuids")}
                    onScopeChange={(scope) =>
                      form.setValue("scope", scope, {
                        shouldValidate: form.formState.isSubmitted,
                      })
                    }
                    onEndpointUuidsChange={(uuids) =>
                      form.setValue("endpoint_uuids", uuids, {
                        shouldValidate: form.formState.isSubmitted,
                      })
                    }
                    organization={form.watch("user_id") === null}
                    error={scopeError ? t(scopeError) : undefined}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCreateDialogOpen(false)}
                      className="flex-1"
                    >
                      {t("api-keys:cancel")}
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending}
                      className="flex-1"
                    >
                      {createMutation.isPending
                        ? t("common:creating")
                        : t("common:create")}
                    </Button>
                  </div>
                </form>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Separator />

      {isAdmin && (
        <div className="flex items-center justify-end gap-2">
          <Switch
            id="api-keys-all-users"
            checked={showAllUsers}
            onCheckedChange={setShowAllUsers}
          />
          <Label htmlFor="api-keys-all-users" className="text-sm">
            {t("api-keys:allUsersKeys")}
          </Label>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("common:name")}</TableHead>
              <TableHead>{t("api-keys:key")}</TableHead>
              <TableHead>{t("api-keys:created")}</TableHead>
              <TableHead>{t("common:status")}</TableHead>
              <TableHead>{t("api-keys:scopeColumn")}</TableHead>
              <TableHead>
                {allUsers ? t("api-keys:owner") : t("api-keys:ownership")}
              </TableHead>
              <TableHead className="w-[100px]">{t("common:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apiKeys?.apiKeys?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Key className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      {t("api-keys:noApiKeys")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("api-keys:createFirstApiKey")}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              apiKeys?.apiKeys?.map((apiKey) => (
                <TableRow key={apiKey.uuid}>
                  <TableCell className="font-medium">{apiKey.name}</TableCell>
                  <TableCell>
                    <code
                      className="text-sm font-mono text-muted-foreground"
                      title={t("api-keys:previewHint")}
                    >
                      {apiKey.key_preview}
                    </code>
                  </TableCell>
                  <TableCell>
                    {format(new Date(apiKey.created_at), "PP", {
                      locale: dateLocale(locale),
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={apiKey.is_active ? "default" : "secondary"}
                      className={
                        apiKey.is_active
                          ? "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800"
                          : "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800"
                      }
                    >
                      {apiKey.is_active
                        ? t("common:active")
                        : t("common:inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ScopeBadge apiKey={apiKey} />
                  </TableCell>
                  <TableCell>
                    {allUsers && apiKey.owner ? (
                      <span className="block max-w-[14rem] truncate text-sm">
                        <span className="font-medium">{apiKey.owner.name}</span>{" "}
                        <span className="text-muted-foreground">
                          {apiKey.owner.email}
                        </span>
                      </span>
                    ) : (
                      <Badge
                        variant="outline"
                        className={
                          apiKey.user_id === null
                            ? "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
                            : "bg-gray-50 dark:bg-gray-950/20 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800"
                        }
                      >
                        {apiKey.user_id === null
                          ? t("api-keys:ownerOrganization")
                          : t("api-keys:ownerPersonal")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setApiKeyToEdit(apiKey)}
                        aria-label={`${t("api-keys:edit")} ${apiKey.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          handleDeleteClick({
                            uuid: apiKey.uuid,
                            name: apiKey.name,
                          })
                        }
                        disabled={deleteMutation.isPending}
                        aria-label={`${t("api-keys:delete")} ${apiKey.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <EditApiKeyDialog
        apiKey={apiKeyToEdit}
        onClose={() => setApiKeyToEdit(null)}
        onSaved={() => refetch()}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("api-keys:confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("api-keys:deleteConfirmation")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeleteCancel}>
              {t("api-keys:cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending
                ? t("common:deleting")
                : t("api-keys:delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Full access, or the endpoints an endpoint-scoped key is limited to. */
function ScopeBadge({ apiKey }: { apiKey: ApiKeyRow }) {
  const { t } = useTranslations();
  if (apiKey.scope === "user") {
    return (
      <Badge variant="outline" className="gap-1 font-normal">
        <KeyRound className="size-3" aria-hidden />
        {t("api-keys:scopeAll")}
      </Badge>
    );
  }
  if (apiKey.endpoints.length === 0) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
      >
        <Waypoints className="size-3" aria-hidden />
        {t("api-keys:scopeNoEndpoint")}
      </Badge>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          tabIndex={0}
          className="gap-1 border-primary/40 font-normal text-primary"
        >
          <Waypoints className="size-3" aria-hidden />
          {apiKey.endpoints.length === 1
            ? apiKey.endpoints[0]?.name
            : t("api-keys:scopeEndpointsBadge", {
                count: apiKey.endpoints.length,
              })}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5 font-mono text-xs">
          {apiKey.endpoints.map((endpoint) => (
            <li key={endpoint.uuid}>{endpoint.name}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
