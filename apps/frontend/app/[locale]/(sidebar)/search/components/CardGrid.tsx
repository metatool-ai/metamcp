import {
  CreateMcpServerRequest,
  CreateServerFormData,
  createServerFormSchema,
  McpServerTypeEnum,
} from "@repo/zod-types";
import { Github, Plus } from "lucide-react";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { createTranslatedZodResolver } from "@/lib/zod-resolver";
import type { SearchIndex } from "@/types/search";

interface CreateServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultValues: CreateServerFormData;
}

function CreateServerDialog({
  open,
  onOpenChange,
  defaultValues,
}: CreateServerDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useTranslations();

  // Get the tRPC query client for cache invalidation
  const utils = trpc.useUtils();

  // tRPC mutation for creating MCP server
  const createServerMutation = trpc.frontend.mcpServers.create.useMutation({
    onSuccess: (data) => {
      // Check if the operation was actually successful
      if (data.success) {
        toast.success(t("search:dialog.messages.success"), {
          description: t("search:dialog.messages.successDescription", {
            name: form.getValues().name,
          }),
        });
        onOpenChange(false);
        form.reset(defaultValues);
        // Invalidate and refetch the server list
        utils.frontend.mcpServers.list.invalidate();
      } else {
        // Handle business logic errors returned by the backend
        const errorMessage =
          data.message || t("search:dialog.messages.createFailed");

        // Check if this is a unique constraint violation for server name
        if (
          errorMessage.includes("already exists") &&
          errorMessage.includes("Server names must be unique")
        ) {
          // Set form error for the name field
          form.setError("name", {
            type: "manual",
            message: errorMessage,
          });
          toast.error(t("search:dialog.messages.nameExists"), {
            description: t("search:dialog.messages.nameExistsDescription"),
          });
        } else if (
          errorMessage.includes("is invalid") &&
          errorMessage.includes("Server names must only contain")
        ) {
          // Handle invalid server name format
          form.setError("name", {
            type: "manual",
            message: errorMessage,
          });
          toast.error(t("search:dialog.messages.invalidName"), {
            description: t("search:dialog.messages.invalidNameDescription"),
          });
        } else {
          // Generic error handling
          toast.error(t("search:dialog.messages.createFailed"), {
            description: errorMessage,
          });
        }
      }
    },
    onError: (error) => {
      console.error("Error creating server:", error);

      // Check if this is a unique constraint violation for server name
      if (
        error.message.includes("already exists") &&
        error.message.includes("Server names must be unique")
      ) {
        // Set form error for the name field
        form.setError("name", {
          type: "manual",
          message: error.message,
        });
        toast.error(t("search:dialog.messages.nameExists"), {
          description: t("search:dialog.messages.nameExistsDescription"),
        });
      } else if (
        error.message.includes("is invalid") &&
        error.message.includes("Server names must only contain")
      ) {
        // Handle invalid server name format
        form.setError("name", {
          type: "manual",
          message: error.message,
        });
        toast.error(t("search:dialog.messages.invalidName"), {
          description: t("search:dialog.messages.invalidNameDescription"),
        });
      } else {
        // Generic error handling
        toast.error(t("search:dialog.messages.createFailed"), {
          description:
            error.message || t("search:dialog.messages.unexpectedError"),
        });
      }
    },
    onSettled: () => {
      setIsSubmitting(false);
    },
  });

  const form = useForm<CreateServerFormData>({
    resolver: createTranslatedZodResolver(createServerFormSchema, t),
    defaultValues,
  });

  // Reset form when dialog opens with new defaultValues
  useEffect(() => {
    if (open) {
      form.reset(defaultValues);
    } else {
      // Reset form when dialog closes to ensure clean state
      form.reset(defaultValues);
    }
  }, [open, defaultValues, form]);

  const onSubmit = async (data: CreateServerFormData) => {
    setIsSubmitting(true);
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
      const apiPayload: CreateMcpServerRequest = {
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

      // Use tRPC mutation
      createServerMutation.mutate(apiPayload);
    } catch (error) {
      setIsSubmitting(false);
      console.error("Error preparing server data:", error);
      toast.error("Failed to Create Server", {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t("search:dialog.title")}</DialogTitle>
          <DialogDescription>
            {t("search:dialog.description")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("search:dialog.form.name")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={t("search:dialog.form.placeholders.name")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("search:dialog.form.description")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder={t(
                        "search:dialog.form.placeholders.description",
                      )}
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("search:dialog.form.type")}</FormLabel>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between"
                      >
                        {field.value === McpServerTypeEnum.Enum.STDIO
                          ? "STDIO"
                          : field.value === McpServerTypeEnum.Enum.SSE
                            ? "SSE"
                            : field.value ===
                                McpServerTypeEnum.Enum.STREAMABLE_HTTP
                              ? "Streamable HTTP"
                              : t("search:dialog.form.placeholders.selectType")}
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)]"
                      align="start"
                    >
                      <DropdownMenuItem
                        onClick={() =>
                          field.onChange(McpServerTypeEnum.Enum.STDIO)
                        }
                      >
                        STDIO
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          field.onChange(McpServerTypeEnum.Enum.SSE)
                        }
                      >
                        SSE
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          field.onChange(McpServerTypeEnum.Enum.STREAMABLE_HTTP)
                        }
                      >
                        Streamable HTTP
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("search:dialog.form.ownershipLabel")}
                  </FormLabel>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between"
                      >
                        {field.value === null
                          ? t("search:dialog.form.ownership.public")
                          : t("search:dialog.form.ownership.private")}
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)]"
                      align="start"
                    >
                      <DropdownMenuItem
                        onClick={() => field.onChange(undefined)}
                      >
                        {t("search:dialog.form.ownership.private")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => field.onChange(null)}>
                        {t("search:dialog.form.ownership.public")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("search:dialog.form.ownership.helpText")}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch("type") === McpServerTypeEnum.Enum.STDIO && (
              <>
                <FormField
                  control={form.control}
                  name="command"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("search:dialog.form.command")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t(
                            "search:dialog.form.placeholders.command",
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="args"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("search:dialog.form.arguments")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t(
                            "search:dialog.form.placeholders.arguments",
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="env"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("search:dialog.form.envVars")}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder={t(
                            "search:dialog.form.placeholders.envVars",
                          )}
                          rows={3}
                          className="whitespace-pre-wrap break-all overflow-x-hidden"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {(form.watch("type") === McpServerTypeEnum.Enum.SSE ||
              form.watch("type") ===
                McpServerTypeEnum.Enum.STREAMABLE_HTTP) && (
              <>
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("search:dialog.form.url")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("search:dialog.form.placeholders.url")}
                          type="url"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bearerToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("search:dialog.form.bearerToken")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t(
                            "search:dialog.form.placeholders.bearerToken",
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  form.reset(defaultValues);
                  onOpenChange(false);
                }}
                disabled={isSubmitting}
              >
                {t("search:dialog.buttons.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("search:dialog.buttons.creating")
                  : t("search:dialog.buttons.create")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function CardGrid({ items }: { items: SearchIndex }) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CreateServerFormData | null>(
    null,
  );
  const { t } = useTranslations();

  const handleAddServer = (item: SearchIndex[string]) => {
    // Prepare default values for the form
    const sanitizedName = item.name.replace(/[^a-zA-Z0-9_-]/g, "-");
    const envString =
      item.envs && item.envs.length > 0
        ? item.envs.map((env) => `${env}=`).join("\n")
        : "";

    const defaultValues: CreateServerFormData = {
      name: sanitizedName,
      description: item.description,
      type: McpServerTypeEnum.Enum.STDIO,
      command: item.command,
      args: item.args?.join(" ") || "",
      url: "",
      bearerToken: "",
      env: envString,
      user_id: undefined, // Default to private
    };

    setSelectedItem(defaultValues);
    setCreateDialogOpen(true);
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(items).map(([key, item]) => (
          <Card key={key} className="flex flex-col">
            <CardHeader>
              <CardTitle>
                <span>{item.name}</span>
              </CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex-grow space-y-3">
              {item.package_name && (
                <div>
                  <span className="text-sm font-medium">
                    {t("search:card.package")}
                  </span>{" "}
                  <span className="text-sm text-muted-foreground">
                    {item.package_name}
                  </span>
                </div>
              )}

              <div>
                <span className="text-sm font-medium">
                  {t("search:card.command")}
                </span>{" "}
                <code className="text-sm bg-muted px-1 py-0.5 rounded">
                  {item.command}
                </code>
              </div>

              {item.args && item.args.length > 0 && (
                <div>
                  <span className="text-sm font-medium">
                    {t("search:card.args")}
                  </span>{" "}
                  <code className="text-sm bg-muted px-1 py-0.5 rounded">
                    {item.args.join(" ")}
                  </code>
                </div>
              )}

              {item.envs.length > 0 && (
                <div>
                  <span className="text-sm font-medium block mb-2">
                    {t("search:card.envVars")}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {item.envs.map((env) => (
                      <Badge key={env} variant="secondary" className="text-xs">
                        {env}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {item.package_registry && (
                <div>
                  <span className="text-sm font-medium">
                    {t("search:card.registry")}
                  </span>{" "}
                  <span className="text-sm text-muted-foreground">
                    {item.package_registry}
                  </span>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex gap-2">
              {item.githubUrl && (
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={item.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github className="w-4 h-4 mr-2" />
                    {t("search:card.github")}
                  </Link>
                </Button>
              )}

              <Button
                variant="default"
                size="sm"
                onClick={() => handleAddServer(item)}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t("search:card.addServer")}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {selectedItem && (
        <CreateServerDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          defaultValues={selectedItem}
        />
      )}
    </>
  );
}
