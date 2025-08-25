"use client";

import {
  CreateMcpServerRequest,
  CreateServerFormData,
  createServerFormSchema,
  McpServerTypeEnum,
} from "@repo/zod-types";
import { ChevronDown, Plus, Server } from "lucide-react";
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

import { ExportImportButtons } from "./export-import-buttons";
import { McpServersList } from "./mcp-servers-list";

export default function McpServersPage() {
  const { t } = useTranslations();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const form = useForm<CreateServerFormData>({
    resolver: createTranslatedZodResolver(createServerFormSchema, t),
    defaultValues: {
      name: "",
      description: "",
      type: McpServerTypeEnum.Enum.STDIO,
      command: "",
      args: "",
      env: "",
      url: "",
      bearerToken: "",
      user_id: undefined, // Default to private (current user)
    },
  });

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  const createMutation = trpc.frontend.mcpServers.create.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        // Invalidate and refetch the server list
        utils.frontend.mcpServers.list.invalidate();
        setIsDialogOpen(false);
        form.reset();
        toast.success(t("mcp-servers:serverCreated"));
      } else {
        // Handle backend error response
        toast.error(data.message || t("mcp-servers:createError"));
      }
    },
    onError: (error) => {
      toast.error(t("mcp-servers:createError") + ": " + error.message);
    },
  });

  const onSubmit = (data: CreateServerFormData) => {
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

    const request: CreateMcpServerRequest = {
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

    createMutation.mutate(request);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("mcp-servers:title")}
            </h1>
            <p className="text-muted-foreground">
              {t("mcp-servers:description")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportImportButtons />
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {t("mcp-servers:addServer")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{t("mcp-servers:addServer")}</DialogTitle>
                <DialogDescription>
                  {t("mcp-servers:addServerDescription")}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("mcp-servers:name")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t("mcp-servers:namePlaceholder")}
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
                        <FormLabel>
                          {t("mcp-servers:descriptionLabel")}
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder={t(
                              "mcp-servers:descriptionPlaceholder",
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
                        <FormLabel>{t("mcp-servers:type")}</FormLabel>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-between"
                            >
                              {field.value === McpServerTypeEnum.Enum.STDIO
                                ? t("mcp-servers:stdio")
                                : field.value === McpServerTypeEnum.Enum.SSE
                                  ? t("mcp-servers:sse")
                                  : field.value ===
                                      McpServerTypeEnum.Enum.STREAMABLE_HTTP
                                    ? "Streamable HTTP"
                                    : t("mcp-servers:selectType")}
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
                              {t("mcp-servers:stdio")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                field.onChange(McpServerTypeEnum.Enum.SSE)
                              }
                            >
                              {t("mcp-servers:sse")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                field.onChange(
                                  McpServerTypeEnum.Enum.STREAMABLE_HTTP,
                                )
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
                        <FormLabel>{t("mcp-servers:ownership")}</FormLabel>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-between"
                            >
                              {field.value === null
                                ? t("mcp-servers:public")
                                : t("mcp-servers:private")}
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
                              {t("mcp-servers:private")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => field.onChange(null)}
                            >
                              {t("mcp-servers:public")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("mcp-servers:ownershipHelp")}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* STDIO specific fields */}
                  {form.watch("type") === McpServerTypeEnum.Enum.STDIO && (
                    <>
                      <FormField
                        control={form.control}
                        name="command"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("mcp-servers:command")}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t(
                                  "mcp-servers:commandPlaceholder",
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
                            <FormLabel>{t("mcp-servers:args")}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t("mcp-servers:argsPlaceholder")}
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
                            <FormLabel>{t("mcp-servers:env")}</FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                placeholder={t("mcp-servers:envPlaceholder")}
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

                  {/* SSE and STREAMABLE_HTTP specific fields */}
                  {(form.watch("type") === McpServerTypeEnum.Enum.SSE ||
                    form.watch("type") ===
                      McpServerTypeEnum.Enum.STREAMABLE_HTTP) && (
                    <>
                      <FormField
                        control={form.control}
                        name="url"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("mcp-servers:url")}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t("mcp-servers:urlPlaceholder")}
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
                              {t("mcp-servers:bearerToken")}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t(
                                  "mcp-servers:bearerTokenPlaceholder",
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
                      onClick={() => setIsDialogOpen(false)}
                    >
                      {t("common:cancel")}
                    </Button>
                    <Button type="submit" disabled={createMutation.isPending}>
                      {createMutation.isPending
                        ? t("common:creating")
                        : t("common:create")}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <McpServersList />
    </div>
  );
}
