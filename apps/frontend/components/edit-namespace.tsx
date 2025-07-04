"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  EditNamespaceFormData,
  editNamespaceFormSchema,
  Namespace,
  NamespaceWithServers,
  UpdateNamespaceRequest,
} from "@repo/zod-types";
import { Check, Server } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

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

        toast.success("Namespace Updated", {
          description: "Namespace has been updated successfully",
        });
        onSuccess(data.data);
        onClose();
        editForm.reset();
      } else {
        toast.error("Update Failed", {
          description: data.message || "Failed to update namespace",
        });
      }
    },
    onError: (error) => {
      console.error("Error updating namespace:", error);
      toast.error("Update Failed", {
        description: error.message || "An unexpected error occurred",
      });
    },
    onSettled: () => {
      setIsUpdating(false);
    },
  });

  const editForm = useForm<EditNamespaceFormData>({
    resolver: zodResolver(editNamespaceFormSchema),
    defaultValues: {
      name: "",
      description: "",
      mcpServerUuids: [],
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
      };

      // Use tRPC mutation instead of direct fetch
      updateNamespaceMutation.mutate(apiPayload);
    } catch (error) {
      setIsUpdating(false);
      console.error("Error preparing namespace data:", error);
      toast.error("Update Failed", {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      });
    }
  };

  const handleClose = () => {
    onClose();
    editForm.reset();
    setSelectedServerUuids([]);
  };

  if (!namespace) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Namespace</DialogTitle>
          <DialogDescription>
            Update the namespace name, description, and manage MCP server
            associations.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={editForm.handleSubmit(handleEditNamespace)}>
          <div className="grid gap-4 py-4">
            {/* Namespace Name */}
            <div className="space-y-2">
              <label htmlFor="edit-name" className="text-sm font-medium">
                Name *
              </label>
              <Input
                id="edit-name"
                placeholder="Enter namespace name"
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
                Description
              </label>
              <Textarea
                id="edit-description"
                placeholder="Enter namespace description (optional)"
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

            {/* MCP Servers Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                MCP Servers ({selectedServerUuids.length} selected)
              </label>
              <div className="border rounded-md p-3 max-h-[200px] overflow-y-auto">
                {serversLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="text-sm text-muted-foreground">
                      Loading servers...
                    </div>
                  </div>
                ) : availableServers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <Server className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No MCP servers available
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Create some MCP servers first to add them to this
                      namespace
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
                Select the MCP servers to include in this namespace. You can add
                or remove servers at any time.
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
              Cancel
            </Button>
            <Button type="submit" disabled={isUpdating}>
              {isUpdating ? "Updating..." : "Update Namespace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
