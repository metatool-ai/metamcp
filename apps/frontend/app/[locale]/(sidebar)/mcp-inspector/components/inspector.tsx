"use client";

import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ClientRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  ActivitySquare,
  FileText,
  FolderTree,
  MessageSquare,
  SearchCode,
  Wrench,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "@/hooks/useTranslations";

import { InspectorPing } from "./inspector/inspector-ping";
import { InspectorPrompts } from "./inspector/inspector-prompts";
import { InspectorResources } from "./inspector/inspector-resources";
import { InspectorRoots } from "./inspector/inspector-roots";
import { InspectorSampling } from "./inspector/inspector-sampling";
import { InspectorTools } from "./inspector/inspector-tools";

interface InspectorProps {
  mcpServerUuid: string;
  makeRequest: <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: RequestOptions & { suppressToast?: boolean },
  ) => Promise<z.output<T>>;
  serverCapabilities?: Record<string, unknown> | null;
}

export function Inspector({
  mcpServerUuid,
  makeRequest,
  serverCapabilities,
}: InspectorProps) {
  const { t } = useTranslations();
  const [activeTab, setActiveTab] = useState("tools");

  // Check server capabilities to determine which tabs to show
  const hasTools = serverCapabilities?.tools !== undefined;
  const hasResources = serverCapabilities?.resources !== undefined;
  const hasPrompts = serverCapabilities?.prompts !== undefined;
  const hasRoots = serverCapabilities?.roots !== undefined;
  const hasSampling = serverCapabilities?.sampling !== undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SearchCode className="h-5 w-5 text-muted-foreground" />
        <h4 className="text-sm font-medium">{t("inspector:title")}</h4>
        <span className="text-xs text-muted-foreground">
          {t("inspector:subtitle")}
        </span>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="tools" className="flex items-center gap-1">
            <Wrench className="h-4 w-4" />
            {t("inspector:tools")}
          </TabsTrigger>
          <TabsTrigger value="resources" className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            {t("inspector:resources")}
          </TabsTrigger>
          <TabsTrigger value="prompts" className="flex items-center gap-1">
            <MessageSquare className="h-4 w-4" />
            {t("inspector:prompts")}
          </TabsTrigger>
          <TabsTrigger value="ping" className="flex items-center gap-1">
            <Zap className="h-4 w-4" />
            {t("inspector:ping")}
          </TabsTrigger>
          <TabsTrigger value="roots" className="flex items-center gap-1">
            <FolderTree className="h-4 w-4" />
            {t("inspector:roots")}
          </TabsTrigger>
          <TabsTrigger value="sampling" className="flex items-center gap-1">
            <ActivitySquare className="h-4 w-4" />
            {t("inspector:sampling")}
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="tools">
            <InspectorTools makeRequest={makeRequest} enabled={hasTools} />
          </TabsContent>

          <TabsContent value="resources">
            <InspectorResources
              makeRequest={makeRequest}
              enabled={hasResources}
            />
          </TabsContent>

          <TabsContent value="prompts">
            <InspectorPrompts makeRequest={makeRequest} enabled={hasPrompts} />
          </TabsContent>

          <TabsContent value="ping">
            <InspectorPing makeRequest={makeRequest} />
          </TabsContent>

          <TabsContent value="roots">
            <InspectorRoots enabled={hasRoots} />
          </TabsContent>

          <TabsContent value="sampling">
            <InspectorSampling
              mcpServerUuid={mcpServerUuid}
              makeRequest={makeRequest}
              enabled={hasSampling}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
