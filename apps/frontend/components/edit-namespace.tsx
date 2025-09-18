"use client";

import {
  EditNamespaceFormData,
  editNamespaceFormSchema,
  Namespace,
  NamespaceWithServers,
  UpdateNamespaceRequest,
} from "@repo/zod-types";
import { Check, ChevronDown, Server } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { createTranslatedZodResolver } from "@/lib/zod-resolver";

interface EditNamespaceProps {
  namespace: NamespaceWithServers | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedNamespace: Namespace) => void;
}

export function EditNamespace({
  namespace,
  isOpen,
  onClose,
  onSuccess,
}: EditNamespaceProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedServerUuids, setSelectedServerUuids] = useState<string[]>([]);
  const { t } = useTranslations();

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // Fetch MCP servers list
  const { data: serversResponse, isLoading: serversLoading } =
    trpc.frontend.mcpServers.list.useQuery();
  const availableServers = serversResponse?.success ? serversResponse.data : [];

  // tRPC mutation for updating namespace
  const updateNamespaceMutation = trpc.frontend.namespaces.update.useMutation({
    onSuccess: (data) => {
      if (data.success && data.data) {
        // Invalidate both the list and individual namespace queries
        utils.frontend.namespaces.list.invalidate();
        if (namespace) {
          utils.frontend.namespaces.get.invalidate({ uuid: namespace.uuid });
        }

        toast.success(t("namespaces:edit.updateSuccess"), {
          description: t("namespaces:edit.updateSuccessDescription"),
        });
        onSuccess(data.data);
        onClose();
        editForm.reset({
          name: "",
          description: "",
          mcpServerUuids: [],
          user_id: undefined,
        });
      } else {
        toast.error(t("namespaces:edit.updateFailed"), {
          description:
            data.message || t("namespaces:edit.updateFailedDescription"),
        });
      }
    },
    onError: (error) => {
      console.error("Error updating namespace:", error);
      toast.error(t("namespaces:edit.updateFailed"), {
        description: error.message || t("namespaces:edit.unexpectedError"),
      });
    },
    onSettled: () => {
      setIsUpdating(false);
    },
  });

  const editForm = useForm<EditNamespaceFormData>({
    resolver: createTranslatedZodResolver(editNamespaceFormSchema, t),
    defaultValues: {
      name: "",
      description: "",
      mcpServerUuids: [],
      user_id: undefined,
    },
  });

  // Pre-populate form when namespace changes
  useEffect(() => {
    if (namespace && isOpen) {
      const serverUuids = namespace.servers
        ? namespace.servers.map((server) => server.uuid)
        : [];
      editForm.reset({
        name: namespace.name,
        description: namespace.description || "",
        mcpServerUuids: serverUuids,
        user_id: namespace.user_id,
      });
      setSelectedServerUuids(serverUuids);
    }
  }, [namespace, isOpen, editForm]);

  // Handle server selection
  const handleServerToggle = (serverUuid: string) => {
    setSelectedServerUuids((prev) => {
      const newSelection = prev.includes(serverUuid)
        ? prev.filter((uuid) => uuid !== serverUuid)
        : [...prev, serverUuid];

      // Update the form value
      editForm.setValue("mcpServerUuids", newSelection);
      return newSelection;
    });
  };

  // Handle edit namespace
  const handleEditNamespace = async (data: EditNamespaceFormData) => {
    if (!namespace) return;

    setIsUpdating(true);
    try {
      // Create the API request payload
      const apiPayload: UpdateNamespaceRequest = {
        uuid: namespace.uuid,
        name: data.name,
        description: data.description,
        mcpServerUuids: selectedServerUuids,
        user_id: data.user_id,
      };

      // Use tRPC mutation instead of direct fetch
      updateNamespaceMutation.mutate(apiPayload);
    } catch (error) {
      setIsUpdating(false);
      console.error("Error preparing namespace data:", error);
      toast.error(t("namespaces:edit.updateFailed"), {
        description:
          error instanceof Error
            ? error.message
            : t("namespaces:edit.unexpectedError"),
      });
    }
  };

  const handleClose = () => {
    onClose();
    editForm.reset({
      name: "",
      description: "",
      mcpServerUuids: [],
      user_id: undefined,
    });
    setSelectedServerUuids([]);
  };

  if (!namespace) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("namespaces:edit.title")}</DialogTitle>
          <DialogDescription>
            {t("namespaces:edit.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={editForm.handleSubmit(handleEditNamespace)}>
          <div className="grid gap-4 py-4">
            {/* Namespace Name */}
            <div className="space-y-2">
              <label htmlFor="edit-name" className="text-sm font-medium">
                {t("namespaces:edit.nameRequired")}
              </label>
              <Input
                id="edit-name"
                placeholder={t("namespaces:edit.namePlaceholder")}
                {...editForm.register("name")}
                disabled={isUpdating}
              />
              {editForm.formState.errors.name && (
                <p className="text-sm text-red-500">
                  {editForm.formState.errors.name.message}
                </p>
              )}
            </div>

            {/* Namespace Description */}
            <div className="space-y-2">
              <label htmlFor="edit-description" className="text-sm font-medium">
                {t("namespaces:edit.descriptionLabel")}
              </label>
              <Textarea
                id="edit-description"
                placeholder={t("namespaces:edit.descriptionPlaceholder")}
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

            {/* Namespace Ownership */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("namespaces:ownership")}
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between"
                    type="button"
                    disabled={isUpdating}
                  >
                    {editForm.watch("user_id") === null
                      ? t("namespaces:everyone")
                      : t("namespaces:forMyself")}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)]">
                  <DropdownMenuItem
                    onClick={() => editForm.setValue("user_id", undefined)}
                  >
                    {t("namespaces:forMyself")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editForm.setValue("user_id", null)}
                  >
                    {t("namespaces:everyone")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* MCP Servers Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("namespaces:edit.mcpServersLabel", {
                  count: selectedServerUuids.length,
                })}
              </label>
              <div className="border rounded-md p-3 max-h-[200px] overflow-y-auto">
                {serversLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="text-sm text-muted-foreground">
                      {t("namespaces:edit.loadingServers")}
                    </div>
                  </div>
                ) : availableServers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <Server className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {t("namespaces:edit.noMcpServersAvailable")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("namespaces:edit.createMcpServersFirst")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableServers.map((server) => {
                      const isSelected = selectedServerUuids.includes(
                        server.uuid,
                      );
                      return (
                        <div
                          key={server.uuid}
                          className={`flex items-start space-x-3 p-2 rounded-md cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-blue-50 border border-blue-200"
                              : "hover:bg-gray-50"
                          }`}
                          onClick={() => handleServerToggle(server.uuid)}
                        >
                          <div
                            className={`flex-shrink-0 w-4 h-4 border rounded flex items-center justify-center mt-0.5 ${
                              isSelected
                                ? "bg-blue-600 border-blue-600 text-white"
                                : "border-gray-300"
                            }`}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2 mb-1">
                              <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <span className="text-sm font-medium break-words">
                                {server.name}
                              </span>
                              <span className="text-xs text-muted-foreground px-2 py-1 bg-gray-100 rounded flex-shrink-0">
                                {server.type}
                              </span>
                            </div>
                            {server.description && (
                              <p className="text-xs text-muted-foreground break-words whitespace-normal">
                                {server.description}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("namespaces:edit.selectMcpServersHelp")}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isUpdating}
            >
              {t("namespaces:edit.cancel")}
            </Button>
            <Button type="submit" disabled={isUpdating}>
              {isUpdating
                ? t("namespaces:edit.updating")
                : t("namespaces:edit.updateButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
