"use client";

import { CreateApiKeyFormSchema } from "@repo/zod-types";
import { format } from "date-fns";
import {
  Copy,
  Eye,
  EyeOff,
  Key,
  Plus,
  Shield,
  Terminal,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  const { t } = useTranslations();

  const { data: apiKeys, refetch } = trpc.apiKeys.list.useQuery();
  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (data) => {
      setNewApiKey(data.key);
      refetch();
      toast.success(t("api-keys:apiKeyCreated"));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = trpc.apiKeys.delete.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("api-keys:apiKeyDeleted"));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const form = useForm<CreateApiKeyFormData>({
    resolver: createTranslatedZodResolver(CreateApiKeyFormSchema, t),
    defaultValues: {
      name: "",
      type: "MCP",
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

  // Filter API keys by type
  const mcpApiKeys =
    apiKeys?.apiKeys?.filter((key) => key.type === "MCP") || [];
  const adminApiKeys =
    apiKeys?.apiKeys?.filter((key) => key.type === "ADMIN") || [];

  const renderApiKeysTable = (
    keys: typeof mcpApiKeys,
    keyType: "MCP" | "ADMIN",
  ) => {
    if (keys.length === 0) {
      const emptyStateKey =
        keyType === "MCP" ? "noMcpApiKeys" : "noAdminApiKeys";
      const createFirstKey =
        keyType === "MCP" ? "createFirstMcpApiKey" : "createFirstAdminApiKey";

      return (
        <div className="text-center py-12">
          <div className="flex flex-col items-center gap-2">
            {keyType === "MCP" ? (
              <Terminal className="h-8 w-8 text-muted-foreground" />
            ) : (
              <Shield className="h-8 w-8 text-muted-foreground" />
            )}
            <p className="text-muted-foreground">
              {t(`api-keys:${emptyStateKey}`)}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(`api-keys:${createFirstKey}`)}
            </p>
          </div>
        </div>
      );
    }

    return (
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
          {keys.map((apiKey) => (
            <TableRow key={apiKey.uuid}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {apiKey.name}
                  <Badge variant="outline" className="text-xs">
                    {apiKey.type}
                  </Badge>
                </div>
              </TableCell>
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
                <span
                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    apiKey.is_active
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {apiKey.is_active ? t("common:active") : t("common:inactive")}
                </span>
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                    apiKey.user_id === null
                      ? "bg-green-50 text-green-700 ring-green-700/10"
                      : "bg-gray-50 text-gray-700 ring-gray-700/10"
                  }`}
                >
                  {apiKey.user_id === null
                    ? t("api-keys:public")
                    : t("api-keys:private")}
                </span>
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => deleteMutation.mutate({ uuid: apiKey.uuid })}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
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
                  <Label htmlFor="type" className="text-sm font-medium">
                    {t("api-keys:type")}
                  </Label>
                  <Select
                    value={form.watch("type")}
                    onValueChange={(value) => {
                      form.setValue("type", value as "MCP" | "ADMIN");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("api-keys:type")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MCP">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {t("api-keys:typeMcp")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("api-keys:mcpTypeDescription")}
                          </span>
                        </div>
                      </SelectItem>
                      <SelectItem value="ADMIN">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {t("api-keys:typeAdmin")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("api-keys:adminTypeDescription")}
                          </span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("api-keys:typeDescription")}
                  </p>
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

                <Button
                  type="submit"
                  className="w-full"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending
                    ? t("api-keys:creating")
                    : t("api-keys:createApiKey")}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* MCP API Keys Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            <CardTitle>{t("api-keys:mcpApiKeysSection")}</CardTitle>
          </div>
          <CardDescription>
            {t("api-keys:mcpApiKeysDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            {renderApiKeysTable(mcpApiKeys, "MCP")}
          </div>
        </CardContent>
      </Card>

      {/* Admin API Keys Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>{t("api-keys:adminApiKeysSection")}</CardTitle>
          </div>
          <CardDescription>
            {t("api-keys:adminApiKeysDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            {renderApiKeysTable(adminApiKeys, "ADMIN")}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
