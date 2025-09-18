"use client";

import {
  EditServerFormData,
  EditServerFormSchema,
  McpServer,
  McpServerTypeEnum,
  UpdateMcpServerRequest,
} from "@repo/zod-types";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

interface EditMcpServerProps {
  server: McpServer | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedServer: McpServer) => void;
}

export function EditMcpServer({
  server,
  isOpen,
  onClose,
  onSuccess,
}: EditMcpServerProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const { t } = useTranslations();

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // tRPC mutation for updating MCP server
  const updateServerMutation = trpc.frontend.mcpServers.update.useMutation({
    onSuccess: (data) => {
      if (data.success && data.data) {
        // Invalidate both the list and individual server queries
        utils.frontend.mcpServers.list.invalidate();
        if (server) {
          utils.frontend.mcpServers.get.invalidate({ uuid: server.uuid });
        }

        toast.success(t("mcp-servers:serverUpdated"), {
          description: t("mcp-servers:serverUpdateSuccess", {
            name: data.data.name,
          }),
        });
        onSuccess(data.data);
        onClose();
        editForm.reset();
      } else {
        // Handle business logic errors returned by the backend
        const errorMessage = data.message || t("mcp-servers:serverUpdateError");

        // Check if this is a unique constraint violation for server name
        if (
          errorMessage.includes("already exists") &&
          errorMessage.includes("Server names must be unique")
        ) {
          // Set form error for the name field
          editForm.setError("name", {
            type: "manual",
            message: errorMessage,
          });
          toast.error(t("mcp-servers:serverNameExists"), {
            description: t("mcp-servers:serverNameExistsDesc"),
          });
        } else if (
          errorMessage.includes("is invalid") &&
          errorMessage.includes("Server names must only contain")
        ) {
          // Handle invalid server name format
          editForm.setError("name", {
            type: "manual",
            message: errorMessage,
          });
          toast.error(t("mcp-servers:invalidServerName"), {
            description: t("mcp-servers:invalidServerNameDesc"),
          });
        } else {
          // Generic error handling
          toast.error(t("mcp-servers:serverUpdateError"), {
            description: errorMessage,
          });
        }
      }
    },
    onError: (error) => {
      console.error("Error updating server:", error);

      // Check if this is a unique constraint violation for server name
      if (
        error.message.includes("already exists") &&
        error.message.includes("Server names must be unique")
      ) {
        // Set form error for the name field
        editForm.setError("name", {
          type: "manual",
          message: error.message,
        });
        toast.error(t("mcp-servers:serverNameExists"), {
          description: t("mcp-servers:serverNameExistsDesc"),
        });
      } else if (
        error.message.includes("is invalid") &&
        error.message.includes("Server names must only contain")
      ) {
        // Handle invalid server name format
        editForm.setError("name", {
          type: "manual",
          message: error.message,
        });
        toast.error(t("mcp-servers:invalidServerName"), {
          description: t("mcp-servers:invalidServerNameDesc"),
        });
      } else {
        // Generic error handling
        toast.error(t("mcp-servers:serverUpdateError"), {
          description: error.message || t("common:unexpectedError"),
        });
      }
    },
    onSettled: () => {
      setIsUpdating(false);
    },
  });

  const editForm = useForm<EditServerFormData>({
    resolver: createTranslatedZodResolver(EditServerFormSchema, t),
    defaultValues: {
      name: "",
      description: "",
      type: McpServerTypeEnum.Enum.STDIO,
      command: "",
      args: "",
      url: "",
      bearerToken: "",
      env: "",
      user_id: undefined,
    },
  });

  // Watch for type changes in edit form and clear irrelevant fields
  useEffect(() => {
    const subscription = editForm.watch((value, { name }) => {
      if (name === "type" && value.type) {
        if (value.type === McpServerTypeEnum.Enum.STDIO) {
          // Clear URL and bearer token when switching to stdio
          editForm.setValue("url", "");
          editForm.setValue("bearerToken", "");
        } else if (
          value.type === McpServerTypeEnum.Enum.SSE ||
          value.type === McpServerTypeEnum.Enum.STREAMABLE_HTTP
        ) {
          // Clear command, args, and env when switching to sse or streamable_http
          editForm.setValue("command", "");
          editForm.setValue("args", "");
          editForm.setValue("env", "");
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [editForm]);

  // Pre-populate form when server changes
  useEffect(() => {
    if (server && isOpen) {
      editForm.reset({
        name: server.name,
        description: server.description || "",
        type: server.type,
        command: server.command || "",
        args: server.args.join(" "),
        url: server.url || "",
        bearerToken: server.bearerToken || "",
        env: Object.entries(server.env)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
        user_id: server.user_id,
      });
    }
  }, [server, isOpen, editForm]);

  // Handle edit server
  const handleEditServer = async (data: EditServerFormData) => {
    if (!server) return;

    setIsUpdating(true);
    try {
      // Parse args string into array by splitting on spaces
      const argsArray = data.args
        ? data.args
            .trim()
            .split(/\s+/)
            .filter((arg) => arg.length > 0)
        : [];

      // Parse env string into object
      const envObject: Record<string, string> = {};
      if (data.env) {
        const envLines = data.env.trim().split("\n");
        for (const line of envLines) {
          const trimmedLine = line.trim();
          if (trimmedLine && trimmedLine.includes("=")) {
            const [key, ...valueParts] = trimmedLine.split("=");
            const value = valueParts.join("="); // Handle values that contain '='
            if (key?.trim()) {
              envObject[key.trim()] = value;
            }
          }
        }
      }

      // Create the API request payload
      const apiPayload: UpdateMcpServerRequest = {
        uuid: server.uuid,
        name: data.name,
        description: data.description,
        type: data.type,
        command: data.command,
        args: argsArray,
        env: envObject,
        url: data.url,
        bearerToken: data.bearerToken,
        user_id: data.user_id,
      };

      // Use tRPC mutation instead of direct fetch
      updateServerMutation.mutate(apiPayload);
    } catch (error) {
      setIsUpdating(false);
      console.error("Error preparing server data:", error);
      toast.error(t("mcp-servers:serverUpdateError"), {
        description:
          error instanceof Error ? error.message : t("common:unexpectedError"),
      });
    }
  };

  const handleClose = () => {
    onClose();
    editForm.reset();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t("mcp-servers:editServer")}</DialogTitle>
          <DialogDescription>
            {t("mcp-servers:addServerDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={editForm.handleSubmit(handleEditServer)}
          className="space-y-4"
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="edit-name" className="text-sm font-medium">
              {t("mcp-servers:name")}
            </label>
            <Input
              id="edit-name"
              {...editForm.register("name")}
              placeholder={t("mcp-servers:namePlaceholder")}
            />
            {editForm.formState.errors.name && (
              <p className="text-sm text-red-500">
                {editForm.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="edit-description" className="text-sm font-medium">
              {t("mcp-servers:descriptionLabel")}
            </label>
            <Input
              id="edit-description"
              {...editForm.register("description")}
              placeholder={t("mcp-servers:descriptionPlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">
              {t("mcp-servers:ownership")}
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  type="button"
                >
                  {editForm.watch("user_id") === null
                    ? t("mcp-servers:public")
                    : t("mcp-servers:private")}
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)]">
                <DropdownMenuItem
                  onClick={() => editForm.setValue("user_id", undefined)}
                >
                  {t("mcp-servers:private")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editForm.setValue("user_id", null)}
                >
                  {t("mcp-servers:public")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">
              {t("mcp-servers:ownershipHelp")}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">
              {t("mcp-servers:type")}
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  type="button"
                >
                  {editForm.watch("type") === McpServerTypeEnum.Enum.STDIO
                    ? t("mcp-servers:stdio")
                    : editForm.watch("type") === McpServerTypeEnum.Enum.SSE
                      ? t("mcp-servers:sse")
                      : editForm.watch("type") ===
                          McpServerTypeEnum.Enum.STREAMABLE_HTTP
                        ? "Streamable HTTP"
                        : t("mcp-servers:selectType")}
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)]">
                <DropdownMenuItem
                  onClick={() =>
                    editForm.setValue("type", McpServerTypeEnum.Enum.STDIO)
                  }
                >
                  {t("mcp-servers:stdio")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    editForm.setValue("type", McpServerTypeEnum.Enum.SSE)
                  }
                >
                  {t("mcp-servers:sse")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    editForm.setValue(
                      "type",
                      McpServerTypeEnum.Enum.STREAMABLE_HTTP,
                    )
                  }
                >
                  Streamable HTTP
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {editForm.watch("type") === McpServerTypeEnum.Enum.STDIO && (
            <>
              <div className="flex flex-col gap-2">
                <label htmlFor="edit-command" className="text-sm font-medium">
                  {t("mcp-servers:command")}
                </label>
                <Input
                  id="edit-command"
                  {...editForm.register("command")}
                  placeholder={t("mcp-servers:commandPlaceholder")}
                />
                {editForm.formState.errors.command && (
                  <p className="text-sm text-red-500">
                    {editForm.formState.errors.command.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="edit-args" className="text-sm font-medium">
                  {t("mcp-servers:args")}
                </label>
                <Input
                  id="edit-args"
                  {...editForm.register("args")}
                  placeholder={t("mcp-servers:argsPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  Separate arguments with spaces
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="edit-env" className="text-sm font-medium">
                  {t("mcp-servers:env")}
                </label>
                <Textarea
                  id="edit-env"
                  {...editForm.register("env")}
                  placeholder={t("mcp-servers:envPlaceholder")}
                  className="h-24 whitespace-pre-wrap break-all overflow-x-hidden"
                />
                <p className="text-xs text-muted-foreground">
                  One environment variable per line in KEY=VALUE format
                </p>
              </div>
            </>
          )}

          {(editForm.watch("type") === McpServerTypeEnum.Enum.SSE ||
            editForm.watch("type") ===
              McpServerTypeEnum.Enum.STREAMABLE_HTTP) && (
            <>
              <div className="flex flex-col gap-2">
                <label htmlFor="edit-url" className="text-sm font-medium">
                  {t("mcp-servers:url")}
                </label>
                <Input
                  id="edit-url"
                  {...editForm.register("url")}
                  placeholder={t("mcp-servers:urlPlaceholder")}
                />
                {editForm.formState.errors.url && (
                  <p className="text-sm text-red-500">
                    {editForm.formState.errors.url.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="edit-bearerToken"
                  className="text-sm font-medium"
                >
                  {t("mcp-servers:bearerToken")}
                </label>
                <Input
                  id="edit-bearerToken"
                  {...editForm.register("bearerToken")}
                  placeholder={t("mcp-servers:bearerTokenPlaceholder")}
                  type="password"
                />
              </div>
            </>
          )}

          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isUpdating}
            >
              {t("common:cancel")}
            </Button>
            <Button type="submit" disabled={isUpdating}>
              {isUpdating ? t("common:updating") : t("common:update")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
