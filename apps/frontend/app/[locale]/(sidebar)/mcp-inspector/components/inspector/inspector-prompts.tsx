/* eslint-disable @next/next/no-img-element */
"use client";

import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  ClientRequest,
  GetPromptResultSchema,
  ListPromptsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Play,
  RefreshCw,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/hooks/useTranslations";

interface Prompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

// Use the actual MCP SDK types instead of custom interfaces
type PromptGetResponse = z.infer<typeof GetPromptResultSchema>;
type PromptMessage = PromptGetResponse["messages"][0];

interface InspectorPromptsProps {
  makeRequest: <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: RequestOptions & { suppressToast?: boolean },
  ) => Promise<z.output<T>>;
  enabled?: boolean;
}

export function InspectorPrompts({
  makeRequest,
  enabled = true,
}: InspectorPromptsProps) {
  const { t } = useTranslations();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({});
  const [promptResult, setPromptResult] = useState<PromptGetResponse | null>(
    null,
  );
  const [getting, setGetting] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();

  const fetchPrompts = useCallback(
    async (cursor?: string) => {
      if (!enabled) return;

      setLoading(true);
      try {
        const response = await makeRequest(
          {
            method: "prompts/list" as const,
            params: cursor ? { cursor } : {},
          },
          ListPromptsResultSchema,
          { suppressToast: true },
        );

        if (cursor) {
          // Append to existing prompts if we're fetching more
          setPrompts((prev) => [...prev, ...(response.prompts || [])]);
        } else {
          // Replace prompts if this is the first fetch
          setPrompts(response.prompts || []);
        }

        setNextCursor(response.nextCursor);

        if (response.prompts && response.prompts.length === 0 && !cursor) {
          toast.info(t("inspector:promptsComponent.noPromptsFound"));
        }
      } catch (error) {
        console.error("Error fetching prompts:", error);
        toast.error("Failed to fetch prompts from MCP server", {
          description: error instanceof Error ? error.message : String(error),
        });
        if (!cursor) {
          setPrompts([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [makeRequest, enabled, t],
  );

  const clearPrompts = () => {
    setPrompts([]);
    setSelectedPrompt(null);
    setPromptResult(null);
    setNextCursor(undefined);
  };

  const handlePromptGet = async () => {
    if (!selectedPrompt) return;

    setGetting(true);
    setPromptResult(null);

    try {
      const response = await makeRequest(
        {
          method: "prompts/get" as const,
          params: {
            name: selectedPrompt.name,
            arguments: promptArgs,
          },
        },
        GetPromptResultSchema,
        { suppressToast: true },
      );

      setPromptResult(response);
      toast.success(
        t("inspector:promptsComponent.promptRetrievedSuccess", {
          promptName: selectedPrompt.name,
        }),
      );
    } catch (error) {
      console.error("Error getting prompt:", error);
      toast.error(
        t("inspector:promptsComponent.promptRetrievalError", {
          promptName: selectedPrompt.name,
        }),
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    } finally {
      setGetting(false);
    }
  };

  const handleArgChange = (argName: string, value: string) => {
    setPromptArgs((prev) => ({
      ...prev,
      [argName]: value,
    }));
  };

  const renderMessage = (message: PromptMessage, index: number) => {
    const getRoleColor = (role: string) => {
      switch (role) {
        case "user":
          return "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800";
        case "assistant":
          return "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800";
        case "system":
          return "text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800";
        default:
          return "text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700";
      }
    };

    return (
      <div
        key={index}
        className={`p-3 rounded-lg border ${getRoleColor(message.role)}`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium uppercase">{message.role}</span>
          <span className="text-xs opacity-75">({message.content.type})</span>
        </div>
        {message.content.type === "text" && message.content.text && (
          <div className="text-sm whitespace-pre-wrap">
            {message.content.text}
          </div>
        )}
        {message.content.type === "image" && (
          <div className="text-xs text-muted-foreground">
            [{t("inspector:promptsComponent.imageData")} -{" "}
            {message.content.mimeType ||
              t("inspector:promptsComponent.unknownFormat")}
            ]
            {message.content.data && (
              <img
                src={`data:${message.content.mimeType};base64,${message.content.data}`}
                alt="Prompt image"
                className="mt-2 max-w-full h-auto"
              />
            )}
          </div>
        )}
        {message.content.type === "audio" && (
          <div className="text-xs text-muted-foreground">
            [{t("inspector:promptsComponent.audioData")} -{" "}
            {message.content.mimeType ||
              t("inspector:promptsComponent.unknownFormat")}
            ]
            {message.content.data && (
              <audio
                controls
                className="mt-2 w-full"
                src={`data:${message.content.mimeType};base64,${message.content.data}`}
              >
                {t("inspector:promptsComponent.audioNotSupported")}
              </audio>
            )}
          </div>
        )}
        {message.content.type === "resource" && (
          <div className="text-xs text-muted-foreground">
            [{t("inspector:promptsComponent.resource")} -{" "}
            {message.content.resource?.mimeType ||
              t("inspector:promptsComponent.unknownFormat")}
            ]
            <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded border">
              <div className="font-mono text-xs break-all">
                URI: {message.content.resource?.uri}
              </div>
              {message.content.resource?.text ? (
                <div className="mt-1 text-sm">
                  {String(message.content.resource.text)}
                </div>
              ) : null}
              {message.content.resource?.blob ? (
                <div className="mt-1 text-xs">
                  [
                  {t("inspector:promptsComponent.binaryData", {
                    length: String(message.content.resource.blob).length,
                  })}
                  ]
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!enabled) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <h4 className="text-sm font-medium">
          {t("inspector:promptsComponent.promptsNotSupported")}
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          {t("inspector:promptsComponent.promptsNotSupportedDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-purple-500" />
          <span className="text-sm font-medium">
            {t("inspector:promptsComponent.title")} ({prompts.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={clearPrompts}
            disabled={loading || prompts.length === 0}
          >
            {t("common:clear")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchPrompts()}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            {loading
              ? t("inspector:promptsComponent.loadingPrompts")
              : t("inspector:promptsComponent.loadPrompts")}
          </Button>
          {nextCursor && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchPrompts(nextCursor)}
              disabled={loading}
            >
              {t("inspector:promptsComponent.loadMore")}
            </Button>
          )}
        </div>
      </div>

      {/* Prompts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Prompt Selection and Arguments */}
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-2">
              {t("inspector:promptsComponent.availablePrompts")}
            </h4>
            {loading && prompts.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t("inspector:promptsComponent.loadingPrompts")}
              </div>
            ) : prompts.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t("inspector:promptsComponent.clickLoadPrompts")}
              </div>
            ) : (
              <div className="space-y-2">
                {prompts.map((prompt) => (
                  <div
                    key={prompt.name}
                    className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                      selectedPrompt?.name === prompt.name
                        ? "border-purple-500 bg-purple-50 dark:bg-purple-950/20 dark:border-purple-400"
                        : "hover:border-gray-300 dark:hover:border-gray-600"
                    }`}
                    onClick={() => {
                      setSelectedPrompt(prompt);
                      setPromptResult(null);
                      // Reset args when selecting a new prompt
                      const initialArgs: Record<string, string> = {};
                      if (prompt.arguments) {
                        prompt.arguments.forEach((arg) => {
                          initialArgs[arg.name] = "";
                        });
                      }
                      setPromptArgs(initialArgs);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-purple-500" />
                        <div>
                          <div className="font-medium text-sm">
                            {prompt.name}
                          </div>
                          {prompt.description && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {prompt.description}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {prompt.arguments && prompt.arguments.length > 0 && (
                          <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 px-2 py-1 rounded">
                            {prompt.arguments.length}{" "}
                            {prompt.arguments.length > 1
                              ? t("inspector:promptsComponent.args")
                              : t("inspector:promptsComponent.arg")}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedPrompt(
                              expandedPrompt === prompt.name
                                ? null
                                : prompt.name,
                            );
                          }}
                        >
                          {expandedPrompt === prompt.name ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {expandedPrompt === prompt.name && (
                      <div className="mt-2 pt-2 border-t space-y-2">
                        <div className="text-xs text-muted-foreground">
                          <div>
                            {t("common:name")}: {prompt.name}
                          </div>
                          {prompt.description && (
                            <div>
                              {t("inspector:promptsComponent.description")}:{" "}
                              {prompt.description}
                            </div>
                          )}
                        </div>
                        {prompt.arguments && prompt.arguments.length > 0 && (
                          <div>
                            <div className="text-xs font-medium mb-1">
                              {t("inspector:promptsComponent.arguments")}:
                            </div>
                            <div className="space-y-1">
                              {prompt.arguments.map((arg) => (
                                <div
                                  key={arg.name}
                                  className="text-xs bg-white dark:bg-gray-800 p-2 rounded border"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono">
                                      {arg.name}
                                    </span>
                                    {arg.required && (
                                      <span className="text-red-500 text-xs">
                                        {t(
                                          "inspector:promptsComponent.required",
                                        )}
                                      </span>
                                    )}
                                  </div>
                                  {arg.description && (
                                    <div className="text-muted-foreground mt-1">
                                      {arg.description}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Arguments Form */}
          {selectedPrompt &&
            selectedPrompt.arguments &&
            selectedPrompt.arguments.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">
                  {t("inspector:promptsComponent.arguments")}
                </h4>
                <div className="space-y-3">
                  {selectedPrompt.arguments.map((arg) => (
                    <div key={arg.name}>
                      <label className="text-xs font-medium">
                        {arg.name}
                        {arg.required && (
                          <span className="text-red-500 ml-1">*</span>
                        )}
                      </label>
                      {arg.description && (
                        <div className="text-xs text-muted-foreground mb-1">
                          {arg.description}
                        </div>
                      )}
                      <Input
                        value={promptArgs[arg.name] || ""}
                        onChange={(e) =>
                          handleArgChange(arg.name, e.target.value)
                        }
                        placeholder={t(
                          "inspector:promptsComponent.enterValue",
                          { argName: arg.name },
                        )}
                        className="text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Get Prompt Button */}
          {selectedPrompt && (
            <Button
              onClick={handlePromptGet}
              disabled={getting}
              className="w-full"
            >
              <Play className="h-4 w-4 mr-2" />
              {getting
                ? t("inspector:promptsComponent.getting")
                : t("inspector:promptsComponent.getPrompt")}
            </Button>
          )}
        </div>

        {/* Right: Prompt Result */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">
            {t("inspector:promptsComponent.promptResult")}
          </h4>
          {!selectedPrompt ? (
            <div className="text-sm text-muted-foreground">
              {t("inspector:promptsComponent.selectPrompt")}
            </div>
          ) : getting ? (
            <div className="text-sm text-muted-foreground">
              {t("inspector:promptsComponent.gettingPromptResult")}
            </div>
          ) : !promptResult ? (
            <div className="text-sm text-muted-foreground">
              {t("inspector:promptsComponent.clickGetPrompt", {
                promptName: selectedPrompt.name,
              })}
            </div>
          ) : (
            <div className="space-y-4">
              {promptResult.description && (
                <div className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-900/50">
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {t("inspector:promptsComponent.description")}
                  </div>
                  <div className="text-sm">{promptResult.description}</div>
                </div>
              )}

              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  {t("inspector:promptsComponent.messages")} (
                  {promptResult.messages.length})
                </div>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {promptResult.messages.map((message, index) =>
                    renderMessage(message, index),
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info Section */}
      <div className="rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 p-4">
        <div className="flex items-start gap-3">
          <MessageSquare className="h-5 w-5 text-purple-500 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-purple-900 dark:text-purple-100 mb-1">
              {t("inspector:promptsComponent.aboutPrompts")}
            </h4>
            <p className="text-xs text-purple-700 dark:text-purple-300">
              {t("inspector:promptsComponent.aboutPromptsDesc")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
