"use client";

import {
  BulkImportMcpServersRequest,
  McpServerTypeEnum,
} from "@repo/zod-types";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

export function ExportImportButtons() {
  const { t } = useTranslations();
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState("");

  // Use tRPC query for data fetching
  const { data: serversResponse } = trpc.frontend.mcpServers.list.useQuery();
  const servers = serversResponse?.success ? serversResponse.data : [];

  // Get the utils for invalidating queries
  const utils = trpc.useUtils();

  // Use tRPC mutation for bulk import
  const bulkImportMutation = trpc.frontend.mcpServers.bulkImport.useMutation({
    onSuccess: (result) => {
      // Check if the operation was actually successful
      if (result.success) {
        console.log(`Successfully imported ${result.imported} MCP servers`);
        const plural = result.imported !== 1 ? "s" : "";
        toast.success(t("mcp-servers:import.imported"), {
          description: t("mcp-servers:import.importedDescription", {
            count: result.imported,
            plural,
          }),
        });
        if (result.errors && result.errors.length > 0) {
          console.warn("Import errors:", result.errors);
          const errorPlural = result.errors.length !== 1 ? "s" : "";
          toast.warning(t("mcp-servers:import.importedWithWarnings"), {
            description: t(
              "mcp-servers:import.importedWithWarningsDescription",
              {
                count: result.errors.length,
                plural: errorPlural,
              },
            ),
          });
        }

        // Invalidate the MCP servers list query to refetch data
        utils.frontend.mcpServers.list.invalidate();

        // Close the dialog and reset
        setImportOpen(false);
        setImportJson("");
        setImportError("");
      } else {
        // Handle business logic failures
        console.error("Import failed:", result.message);
        toast.error(t("mcp-servers:import.importFailed"), {
          description:
            result.message || t("mcp-servers:import.importFailedDescription"),
        });
        setImportError(
          result.message || t("mcp-servers:import.importFailedDescription"),
        );
      }
    },
    onError: (error) => {
      console.error("Error importing MCP servers:", error);
      toast.error(t("mcp-servers:import.importFailed"), {
        description:
          error.message || t("mcp-servers:import.importFailedDescription"),
      });
      setImportError(t("mcp-servers:import.checkConsole"));
    },
  });

  // Function to generate export JSON
  const generateExportJson = () => {
    const mcpServersConfig: Record<string, Record<string, unknown>> = {};

    servers.forEach((server) => {
      const config: Record<string, unknown> = {
        type: server.type.toUpperCase(),
      };

      if (server.description) {
        config.description = server.description;
      }

      if (server.type === McpServerTypeEnum.Enum.STDIO) {
        if (server.command) {
          config.command = server.command;
        }
        if (server.args && server.args.length > 0) {
          config.args = server.args;
        }
        if (server.env && Object.keys(server.env).length > 0) {
          config.env = server.env;
        }
      } else if (
        server.type === McpServerTypeEnum.Enum.SSE ||
        server.type === McpServerTypeEnum.Enum.STREAMABLE_HTTP
      ) {
        if (server.url) {
          config.url = server.url;
        }
        if (server.bearerToken) {
          config.bearerToken = server.bearerToken;
        }
      }

      mcpServersConfig[server.name] = config;
    });

    return {
      mcpServers: mcpServersConfig,
    };
  };

  // Function to download JSON file
  const downloadExportJson = () => {
    const exportData = generateExportJson();
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mcp-servers-export.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t("mcp-servers:export.downloaded"), {
      description: t("mcp-servers:export.downloadedDescription"),
    });
  };

  // Function to copy JSON to clipboard
  const copyExportJson = () => {
    const exportData = generateExportJson();
    const jsonString = JSON.stringify(exportData, null, 2);
    navigator.clipboard.writeText(jsonString).then(() => {
      toast.success(t("mcp-servers:export.copiedToClipboard"), {
        description: t("mcp-servers:export.copiedDescription"),
      });
    });
  };

  // Function to handle import
  const handleImport = async () => {
    // Parse the JSON
    let parsedJson;
    try {
      parsedJson = JSON.parse(importJson);
    } catch (_e) {
      setImportError(t("mcp-servers:import.invalidJson"));
      return;
    }

    // Validate the JSON structure
    if (!parsedJson.mcpServers || typeof parsedJson.mcpServers !== "object") {
      setImportError(t("mcp-servers:import.invalidStructure"));
      return;
    }

    console.log("Importing servers:", parsedJson);

    // Call the tRPC mutation
    const apiPayload: BulkImportMcpServersRequest = {
      mcpServers: parsedJson.mcpServers,
    };

    bulkImportMutation.mutate(apiPayload);
  };

  return (
    <div className="flex gap-2">
      {/* Export Button */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            {t("mcp-servers:export.exportJson")}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t("mcp-servers:export.title")}</DialogTitle>
            <DialogDescription>
              {t("mcp-servers:export.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                {t("mcp-servers:export.preview")}
              </label>
              <CodeBlock language="json" maxHeight="256px" className="text-xs">
                {JSON.stringify(generateExportJson(), null, 2)}
              </CodeBlock>
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setExportOpen(false)}
              >
                {t("common:close")}
              </Button>
              <Button type="button" variant="outline" onClick={copyExportJson}>
                {t("mcp-servers:export.copyToClipboard")}
              </Button>
              <Button type="button" onClick={downloadExportJson}>
                {t("mcp-servers:export.downloadJson")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Button */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Upload className="mr-2 h-4 w-4" />
            {t("mcp-servers:import.importJson")}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("mcp-servers:import.title")}</DialogTitle>
            <DialogDescription>
              {t("mcp-servers:import.description")}
            </DialogDescription>
            <CodeBlock
              language="json"
              maxHeight="128px"
              className="mt-2 text-xs"
            >
              {`{
  "mcpServers": {
    "CommandBasedServerName": {
      "command": "command",
      "args": ["arg1", "arg2"],
      "env": {
        "KEY": "value"
      },
      "description": "Optional description",
      "type": "stdio" // optional, defaults to "stdio" (case-insensitive)
    },
    "UrlBasedServerName": {
      "url": "https://example.com/sse",
      "description": "Optional description",
      "type": "sse" // optional, defaults to "stdio" (case-insensitive)
    },
    "StreamableHttpServerName": {
      "url": "https://example.com/mcp",
      "description": "Optional description",
      "type": "streamable_http" // case-insensitive
    }
  }
}`}
            </CodeBlock>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-hidden">
            <div className="flex flex-col h-full p-1">
              <label className="text-sm font-medium mb-2">
                {t("mcp-servers:import.jsonContent")}
              </label>
              <Textarea
                value={importJson}
                onChange={(e) => {
                  setImportJson(e.target.value);
                  setImportError("");
                }}
                placeholder={t("mcp-servers:import.placeholder")}
                className="font-mono text-sm flex-1 min-h-[200px] max-h-[300px] resize-none overflow-y-auto"
              />
              {importError && (
                <p className="text-sm text-red-500 mt-1">{importError}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setImportOpen(false);
                setImportJson("");
                setImportError("");
              }}
              disabled={bulkImportMutation.isPending}
            >
              {t("common:cancel")}
            </Button>
            <Button
              type="button"
              disabled={bulkImportMutation.isPending}
              onClick={handleImport}
            >
              {bulkImportMutation.isPending
                ? t("mcp-servers:import.importing")
                : t("mcp-servers:import.importJson")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
