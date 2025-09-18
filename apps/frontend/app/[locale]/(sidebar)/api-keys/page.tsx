"use client";

import { CreateApiKeyFormSchema } from "@repo/zod-types";
import { format } from "date-fns";
import { Copy, Eye, EyeOff, Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { createTranslatedZodResolver } from "@/lib/zod-resolver";

type CreateApiKeyFormData = z.infer<typeof CreateApiKeyFormSchema>;

export default function ApiKeysPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [apiKeyToDelete, setApiKeyToDelete] = useState<{
    uuid: string;
    name: string;
  } | null>(null);
  const { t } = useTranslations();

  const { data: apiKeys, refetch } = trpc.frontend.apiKeys.list.useQuery();
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
    },
  });

  const onSubmit = (data: CreateApiKeyFormData) => {
    createMutation.mutate(data);
  };

  const handleCreateSuccess = () => {
    form.reset();
    setCreateDialogOpen(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("api-keys:copyToClipboard"));
  };

  const toggleKeyVisibility = (uuid: string) => {
    setVisibleKeys((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(uuid)) {
        newSet.delete(uuid);
      } else {
        newSet.add(uuid);
      }
      return newSet;
    });
  };

  const maskKey = (key: string) => {
    return "•".repeat(key.length);
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
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              {t("api-keys:createApiKey")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("api-keys:createApiKey")}</DialogTitle>
              <DialogDescription>
                {t("api-keys:createApiKeyDescription")}
              </DialogDescription>
            </DialogHeader>
            {newApiKey ? (
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-2">
                    {t("api-keys:newApiKey")}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 bg-background rounded border text-sm font-mono break-all">
                      {newApiKey}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(newApiKey)}
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
                  {t("api-keys:done")}
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
                <div>
                  <Label htmlFor="ownership" className="text-sm font-medium">
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
                        {t("api-keys:everyone")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("api-keys:ownershipDescription")}
                  </p>
                </div>
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
      </div>

      <Separator />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("common:name")}</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>{t("api-keys:created")}</TableHead>
              <TableHead>{t("common:status")}</TableHead>
              <TableHead>{t("api-keys:ownership")}</TableHead>
              <TableHead className="w-[100px]">{t("common:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apiKeys?.apiKeys?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
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
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono break-all">
                        {visibleKeys.has(apiKey.uuid)
                          ? apiKey.key
                          : maskKey(apiKey.key)}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleKeyVisibility(apiKey.uuid)}
                        title={
                          visibleKeys.has(apiKey.uuid)
                            ? t("api-keys:hideApiKey")
                            : t("api-keys:showApiKey")
                        }
                      >
                        {visibleKeys.has(apiKey.uuid) ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(apiKey.key)}
                        title={t("api-keys:copyFullApiKey")}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    {format(new Date(apiKey.created_at), "MMM d, yyyy")}
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
                    <Badge
                      variant="outline"
                      className={
                        apiKey.user_id === null
                          ? "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
                          : "bg-gray-50 dark:bg-gray-950/20 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800"
                      }
                    >
                      {apiKey.user_id === null
                        ? t("api-keys:public")
                        : t("api-keys:private")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteClick({ uuid: apiKey.uuid, name: apiKey.name })}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
              {deleteMutation.isPending ? t("common:deleting") : t("api-keys:delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
