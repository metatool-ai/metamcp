"use client";

import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  ClientRequest,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceResultSchema,
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { useTranslations } from "@/hooks/useTranslations";

interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

interface InspectorResourcesProps {
  makeRequest: <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: RequestOptions & { suppressToast?: boolean },
  ) => Promise<z.output<T>>;
  enabled?: boolean;
}

export function InspectorResources({
  makeRequest,
  enabled = true,
}: InspectorResourcesProps) {
  const { t } = useTranslations();
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceTemplates, setResourceTemplates] = useState<
    ResourceTemplate[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  );
  const [resourceContent, setResourceContent] =
    useState<ResourceContent | null>(null);
  const [reading, setReading] = useState(false);
  const [expandedResource, setExpandedResource] = useState<string | null>(null);
  const [nextResourceCursor, setNextResourceCursor] = useState<
    string | undefined
  >();
  const [nextTemplateCursor, setNextTemplateCursor] = useState<
    string | undefined
  >();
  const [resourceSubscriptions, setResourceSubscriptions] = useState<
    Set<string>
  >(new Set());

  const fetchResources = useCallback(
    async (cursor?: string) => {
      if (!enabled) return;

      setLoading(true);
      try {
        const response = await makeRequest(
          {
            method: "resources/list" as const,
            params: cursor ? { cursor } : {},
          },
          ListResourcesResultSchema,
          { suppressToast: true },
        );

        if (cursor) {
          // Append to existing resources if we're fetching more
          setResources((prev) => [...prev, ...(response.resources || [])]);
        } else {
          // Replace resources if this is the first fetch
          setResources(response.resources || []);
        }

        setNextResourceCursor(response.nextCursor);

        if (response.resources && response.resources.length === 0 && !cursor) {
          toast.info(t("inspector:resourcesComponent.noResourcesFound"));
        }
      } catch (error) {
        console.error("Error fetching resources:", error);
        toast.error(t("inspector:resourcesComponent.fetchResourcesError"), {
          description: error instanceof Error ? error.message : String(error),
        });
        if (!cursor) {
          setResources([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [makeRequest, enabled, t],
  );

  const fetchResourceTemplates = useCallback(
    async (cursor?: string) => {
      if (!enabled) return;

      setTemplatesLoading(true);
      try {
        const response = await makeRequest(
          {
            method: "resources/templates/list" as const,
            params: cursor ? { cursor } : {},
          },
          ListResourceTemplatesResultSchema,
          { suppressToast: true },
        );

        if (cursor) {
          // Append to existing templates if we're fetching more
          setResourceTemplates((prev) => [
            ...prev,
            ...(response.resourceTemplates || []),
          ]);
        } else {
          // Replace templates if this is the first fetch
          setResourceTemplates(response.resourceTemplates || []);
        }

        setNextTemplateCursor(response.nextCursor);

        if (
          response.resourceTemplates &&
          response.resourceTemplates.length === 0 &&
          !cursor
        ) {
          toast.info(
            t("inspector:resourcesComponent.noResourceTemplatesFound"),
          );
        }
      } catch (error) {
        console.error("Error fetching resource templates:", error);
        // Templates are optional, so don't show error toast for missing capability
        if (!cursor) {
          setResourceTemplates([]);
        }
      } finally {
        setTemplatesLoading(false);
      }
    },
    [makeRequest, enabled, t],
  );

  const clearResources = () => {
    setResources([]);
    setSelectedResource(null);
    setResourceContent(null);
    setNextResourceCursor(undefined);
  };

  const clearResourceTemplates = () => {
    setResourceTemplates([]);
    setNextTemplateCursor(undefined);
  };

  const handleResourceRead = async (resource: Resource) => {
    setReading(true);
    setResourceContent(null);

    try {
      const response = await makeRequest(
        {
          method: "resources/read" as const,
          params: {
            uri: resource.uri,
          },
        },
        ReadResourceResultSchema,
        { suppressToast: true },
      );

      if (response?.contents && response.contents.length > 0) {
        setResourceContent(response.contents[0]!);
        toast.success(
          t("inspector:resourcesComponent.resourceReadSuccess", {
            resourceName: resource.name || resource.uri,
          }),
        );
      } else {
        toast.error(t("inspector:resourcesComponent.noContentFound"));
      }
    } catch (error) {
      console.error("Error reading resource:", error);
      toast.error(
        t("inspector:resourcesComponent.resourceReadError", {
          resourceName: resource.name || resource.uri,
        }),
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    } finally {
      setReading(false);
    }
  };

  const subscribeToResource = async (uri: string) => {
    if (resourceSubscriptions.has(uri)) return;

    try {
      await makeRequest(
        {
          method: "resources/subscribe" as const,
          params: { uri },
        },
        z.object({}),
        { suppressToast: true },
      );

      const newSubscriptions = new Set(resourceSubscriptions);
      newSubscriptions.add(uri);
      setResourceSubscriptions(newSubscriptions);

      toast.success(
        t("inspector:resourcesComponent.subscribeSuccess", { uri }),
      );
    } catch (error) {
      console.error("Error subscribing to resource:", error);
      toast.error(t("inspector:resourcesComponent.subscribeError", { uri }), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const unsubscribeFromResource = async (uri: string) => {
    if (!resourceSubscriptions.has(uri)) return;

    try {
      await makeRequest(
        {
          method: "resources/unsubscribe" as const,
          params: { uri },
        },
        z.object({}),
        { suppressToast: true },
      );

      const newSubscriptions = new Set(resourceSubscriptions);
      newSubscriptions.delete(uri);
      setResourceSubscriptions(newSubscriptions);

      toast.success(
        t("inspector:resourcesComponent.unsubscribeSuccess", { uri }),
      );
    } catch (error) {
      console.error("Error unsubscribing from resource:", error);
      toast.error(t("inspector:resourcesComponent.unsubscribeError", { uri }), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const formatResourceContent = (content: ResourceContent) => {
    if (content.text) {
      return content.text;
    } else if (content.blob) {
      return t("inspector:resourcesComponent.binaryContent", {
        length: content.blob.length,
      });
    }
    return t("inspector:resourcesComponent.noContentAvailable");
  };

  const getResourceDisplayName = (resource: Resource) => {
    return resource.name || resource.uri.split("/").pop() || resource.uri;
  };

  if (!enabled) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <h4 className="text-sm font-medium">
          {t("inspector:resourcesComponent.resourcesNotSupported")}
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          {t("inspector:resourcesComponent.resourcesNotSupportedDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-green-500" />
          <span className="text-sm font-medium">
            {t("inspector:resourcesComponent.resourcesCount", {
              count: resources.length,
            })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={clearResources}
            disabled={loading || resources.length === 0}
          >
            {t("inspector:resourcesComponent.clear")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchResources()}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            {loading
              ? t("inspector:resourcesComponent.loading")
              : t("inspector:resourcesComponent.loadResources")}
          </Button>
          {nextResourceCursor && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchResources(nextResourceCursor)}
              disabled={loading}
            >
              {t("inspector:resourcesComponent.loadMore")}
            </Button>
          )}
        </div>
      </div>

      {/* Resource Templates Section */}
      {resourceTemplates.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">
                {t("inspector:resourcesComponent.resourceTemplatesCount", {
                  count: resourceTemplates.length,
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={clearResourceTemplates}
                disabled={templatesLoading || resourceTemplates.length === 0}
              >
                {t("inspector:resourcesComponent.clearTemplates")}
              </Button>
              {nextTemplateCursor && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchResourceTemplates(nextTemplateCursor)}
                  disabled={templatesLoading}
                >
                  {t("inspector:resourcesComponent.loadMoreTemplates")}
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {resourceTemplates.map((template) => (
              <div
                key={template.uriTemplate}
                className="border rounded-lg p-3 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Plus className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">
                    {template.name ||
                      t("inspector:resourcesComponent.unnamedTemplate")}
                  </span>
                </div>
                {template.description && (
                  <div className="text-xs text-muted-foreground mb-2">
                    {template.description}
                  </div>
                )}
                <div className="text-xs font-mono bg-white dark:bg-gray-800 p-2 rounded border">
                  {template.uriTemplate}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resources List */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Left: Resource List */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">
            {t("inspector:resourcesComponent.availableResources")}
          </h4>
          {loading && resources.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t("inspector:resourcesComponent.loadingResources")}
            </div>
          ) : resources.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t("inspector:resourcesComponent.clickLoadResources")}
            </div>
          ) : (
            <div className="space-y-1">
              {resources.map((resource) => (
                <div
                  key={resource.uri}
                  className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                    selectedResource?.uri === resource.uri
                      ? "border-green-500 bg-green-50 dark:bg-green-950/20 dark:border-green-400"
                      : "hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                  onClick={() => {
                    setSelectedResource(resource);
                    setExpandedResource(resource.uri);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-green-500" />
                      <div>
                        <div className="text-sm font-medium">
                          {getResourceDisplayName(resource)}
                        </div>
                        {resource.description && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {resource.description}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {resourceSubscriptions.has(resource.uri) && (
                        <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 px-2 py-1 rounded">
                          {t("inspector:resourcesComponent.subscribed")}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedResource(
                            expandedResource === resource.uri
                              ? null
                              : resource.uri,
                          );
                        }}
                      >
                        {expandedResource === resource.uri ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {expandedResource === resource.uri && (
                    <div className="mt-2 pt-2 border-t space-y-2">
                      <div className="text-xs text-muted-foreground">
                        <div>
                          {t("inspector:resourcesComponent.uri")}:{" "}
                          {resource.uri}
                        </div>
                        {resource.mimeType && (
                          <div>
                            {t("inspector:resourcesComponent.mimeType")}:{" "}
                            {resource.mimeType}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResourceRead(resource);
                          }}
                          disabled={reading}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          {t("inspector:resourcesComponent.read")}
                        </Button>
                        {!resourceSubscriptions.has(resource.uri) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              subscribeToResource(resource.uri);
                            }}
                          >
                            {t("inspector:resourcesComponent.subscribe")}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              unsubscribeFromResource(resource.uri);
                            }}
                          >
                            {t("inspector:resourcesComponent.unsubscribe")}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Resource Content */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">
            {t("inspector:resourcesComponent.resourceContent")}
          </h4>
          {!selectedResource ? (
            <div className="text-sm text-muted-foreground">
              {t("inspector:resourcesComponent.selectResource")}
            </div>
          ) : reading ? (
            <div className="text-sm text-muted-foreground">
              {t("inspector:resourcesComponent.readingContent")}
            </div>
          ) : !resourceContent ? (
            <div className="text-sm text-muted-foreground">
              {t("inspector:resourcesComponent.clickRead", {
                resourceName: getResourceDisplayName(selectedResource),
              })}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                <div>
                  {t("inspector:resourcesComponent.uri")}: {resourceContent.uri}
                </div>
                {resourceContent.mimeType && (
                  <div>
                    {t("inspector:resourcesComponent.mimeType")}:{" "}
                    {resourceContent.mimeType}
                  </div>
                )}
              </div>
              <div className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-900/50 max-h-96 overflow-y-auto">
                <CodeBlock
                  language="json"
                  maxHeight="384px"
                  className="text-xs"
                  wrapLines={true}
                >
                  {formatResourceContent(resourceContent)}
                </CodeBlock>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info Section */}
      <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-4">
        <div className="flex items-start gap-3">
          <FileText className="h-5 w-5 text-green-500 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-green-900 dark:text-green-100 mb-1">
              {t("inspector:resourcesComponent.aboutResources")}
            </h4>
            <p className="text-xs text-green-700 dark:text-green-300">
              {t("inspector:resourcesComponent.aboutResourcesDesc")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
