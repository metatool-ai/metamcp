"use client";

import {
  CreateNamespaceFormData,
  createNamespaceFormSchema,
  CreateNamespaceRequest,
} from "@repo/zod-types";
import { ChevronDown, Package, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { createTranslatedZodResolver } from "@/lib/zod-resolver";

import { NamespacesList } from "./namespaces-list";

export default function NamespacesPage() {
  const { t } = useTranslations();
  const [createOpen, setCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedServerUuids, setSelectedServerUuids] = useState<string[]>([]);

  // Get the tRPC query client for cache invalidation
  const utils = trpc.useUtils();

  // Fetch available MCP servers for selection
  const { data: serversResponse, isLoading: serversLoading } =
    trpc.frontend.mcpServers.list.useQuery();

  const availableServers = serversResponse?.success ? serversResponse.data : [];

  // tRPC mutation for creating namespace
  const createNamespaceMutation = trpc.frontend.namespaces.create.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(t("namespaces:namespaceCreated"), {
          description: t("namespaces:namespaceCreatedDescription", {
            name: form.getValues().name,
          }),
        });
        setCreateOpen(false);
        form.reset({
          name: "",
          description: "",
          user_id: undefined, // Default to "For myself" (Private)
        });
        setSelectedServerUuids([]);
        // Invalidate and refetch the namespace list
        utils.frontend.namespaces.list.invalidate();
      } else {
        // Handle backend error response
        toast.error(data.message || t("namespaces:createNamespaceError"));
      }
    },
    onError: (error) => {
      console.error("Error creating namespace:", error);
      toast.error(t("namespaces:createNamespaceError"), {
        description: error.message || "An unexpected error occurred",
      });
    },
    onSettled: () => {
      setIsSubmitting(false);
    },
  });

  const form = useForm<CreateNamespaceFormData>({
    resolver: createTranslatedZodResolver(createNamespaceFormSchema, t),
    defaultValues: {
      name: "",
      description: "",
      mcpServerUuids: [],
      user_id: undefined, // Default to "For myself" (Private)
    },
  });

  const onSubmit = async (data: CreateNamespaceFormData) => {
    setIsSubmitting(true);
    try {
      // Create the API request payload
      const apiPayload: CreateNamespaceRequest = {
        name: data.name,
        description: data.description,
        mcpServerUuids: selectedServerUuids,
        user_id: data.user_id,
      };

      // Use tRPC mutation
      createNamespaceMutation.mutate(apiPayload);
    } catch (error) {
      setIsSubmitting(false);
      console.error("Error preparing namespace data:", error);
      toast.error(t("namespaces:createNamespaceError"), {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      });
    }
  };

  const handleServerToggle = (serverUuid: string) => {
    setSelectedServerUuids((prev) =>
      prev.includes(serverUuid)
        ? prev.filter((uuid) => uuid !== serverUuid)
        : [...prev, serverUuid],
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("namespaces:title")}
            </h1>
            <p className="text-muted-foreground">
              {t("namespaces:description")}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {t("namespaces:createNamespace")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{t("namespaces:createNamespace")}</DialogTitle>
                <DialogDescription>
                  {t("namespaces:createNamespaceDescription")}
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <div className="flex flex-col gap-2">
                  <label htmlFor="name" className="text-sm font-medium">
                    {t("namespaces:name")}
                  </label>
                  <Input
                    id="name"
                    {...form.register("name")}
                    placeholder={t("namespaces:namePlaceholder")}
                  />
                  {form.formState.errors.name && (
                    <p className="text-sm text-red-500">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="description" className="text-sm font-medium">
                    {t("namespaces:description")}
                  </label>
                  <Textarea
                    id="description"
                    {...form.register("description")}
                    placeholder={t("namespaces:descriptionPlaceholder")}
                    className="h-20"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">
                    {t("namespaces:ownership")}
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between"
                        type="button"
                      >
                        {form.watch("user_id") === null
                          ? t("namespaces:everyone")
                          : t("namespaces:forMyself")}
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)]">
                      <DropdownMenuItem
                        onClick={() => form.setValue("user_id", undefined)}
                      >
                        {t("namespaces:forMyself")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => form.setValue("user_id", null)}
                      >
                        {t("namespaces:everyone")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">
                    {t("namespaces:mcpServers")}
                  </label>
                  <div className="border rounded-md p-3 max-h-48 overflow-y-auto">
                    {serversLoading ? (
                      <div className="text-sm text-muted-foreground">
                        {t("namespaces:loadingServers")}
                      </div>
                    ) : availableServers.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        {t("namespaces:noMcpServersAvailable")}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {availableServers.map((server) => (
                          <div
                            key={server.uuid}
                            className="flex items-center space-x-2"
                          >
                            <input
                              type="checkbox"
                              id={server.uuid}
                              checked={selectedServerUuids.includes(
                                server.uuid,
                              )}
                              onChange={() => handleServerToggle(server.uuid)}
                              className="rounded border-gray-300"
                            />
                            <label
                              htmlFor={server.uuid}
                              className="text-sm flex-1 cursor-pointer"
                            >
                              <div className="font-medium">{server.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {server.type} •{" "}
                                {server.description || "No description"}
                              </div>
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("namespaces:selectMcpServersDescription")}
                  </p>
                </div>

                <div className="flex justify-end space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setCreateOpen(false);
                      form.reset({
                        name: "",
                        description: "",
                        user_id: undefined, // Default to "For myself" (Private)
                      });
                      setSelectedServerUuids([]);
                    }}
                    disabled={isSubmitting}
                  >
                    {t("namespaces:cancel")}
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting
                      ? t("namespaces:creating")
                      : t("namespaces:createNamespace")}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <NamespacesList />
    </div>
  );
}
