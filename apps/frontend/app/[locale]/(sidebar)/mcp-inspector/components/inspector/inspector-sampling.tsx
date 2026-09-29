"use client";

import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ClientRequest } from "@modelcontextprotocol/sdk/types.js";
import { ActivitySquare, AlertTriangle, Brain, Settings } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/hooks/useTranslations";

interface SamplingMessage {
  role: "user" | "assistant" | "system";
  content: {
    type: "text";
    text: string;
  };
}

interface SamplingRequest {
  messages: SamplingMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  modelPreferences?: {
    hints?: Array<{
      name?: string;
    }>;
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
  };
}

interface SamplingResponse {
  role: "assistant";
  content: {
    type: "text";
    text: string;
  };
  model: string;
  stopReason?: "endTurn" | "stopSequence" | "maxTokens";
}

// Define schema (currently unused but available for future MCP integration)
const _CreateMessageResultSchema = z.object({
  role: z.literal("assistant"),
  content: z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  model: z.string(),
  stopReason: z.enum(["endTurn", "stopSequence", "maxTokens"]).optional(),
});

interface InspectorSamplingProps {
  mcpServerUuid: string;
  makeRequest: <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: RequestOptions & { suppressToast?: boolean },
  ) => Promise<z.output<T>>;
  enabled?: boolean;
}

export function InspectorSampling({
  makeRequest: _makeRequest,
  enabled = true,
}: InspectorSamplingProps) {
  const { t } = useTranslations();
  const [messages, setMessages] = useState<SamplingMessage[]>([
    {
      role: "user",
      content: { type: "text", text: "Hello! Can you help me?" },
    },
  ]);
  const [maxTokens, setMaxTokens] = useState<number>(1000);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [topP, setTopP] = useState<number>(1.0);
  const [stopSequences, setStopSequences] = useState<string>("");
  const [response, setResponse] = useState<SamplingResponse | null>(null);
  const [sampling, setSampling] = useState(false);
  const [newMessageText, setNewMessageText] = useState("");
  const [newMessageRole, setNewMessageRole] = useState<"user" | "system">(
    "user",
  );

  const handleAddMessage = () => {
    if (!newMessageText.trim()) return;

    const newMessage: SamplingMessage = {
      role: newMessageRole,
      content: { type: "text", text: newMessageText.trim() },
    };

    setMessages((prev) => [...prev, newMessage]);
    setNewMessageText("");
  };

  const handleRemoveMessage = (index: number) => {
    setMessages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSample = async () => {
    if (messages.length === 0) {
      toast.error(t("inspector:samplingComponent.addMessageFirst"));
      return;
    }

    setSampling(true);
    setResponse(null);

    try {
      const _samplingRequest: SamplingRequest = {
        messages,
        maxTokens,
        temperature,
        topP,
        ...(stopSequences.trim() && {
          stopSequences: stopSequences
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      };

      // Note: Sampling is not a standard MCP protocol feature
      // This is a placeholder that simulates the functionality
      await new Promise((resolve) => setTimeout(resolve, 1500)); // Simulate processing time

      const simulatedResult = {
        role: "assistant" as const,
        content: {
          type: "text" as const,
          text: t("inspector:samplingComponent.simulatedResponse"),
        },
        model: "simulated-model",
        stopReason: "endTurn" as const,
      };

      setResponse(simulatedResult);
      toast.info(t("inspector:samplingComponent.simulationDone"));
    } catch (error) {
      console.error("Error during sampling:", error);
      toast.error(t("inspector:samplingComponent.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSampling(false);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "user":
        return "bg-blue-50 border-blue-200 text-blue-900";
      case "assistant":
        return "bg-green-50 border-green-200 text-green-900";
      case "system":
        return "bg-orange-50 border-orange-200 text-orange-900";
      default:
        return "bg-gray-50 border-gray-200 text-gray-900";
    }
  };

  if (!enabled) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <h4 className="text-sm font-medium">
          {t("inspector:samplingComponent.notSupportedTitle")}
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          {t("inspector:samplingComponent.notSupportedDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ActivitySquare className="h-5 w-5 text-pink-500" />
          <span className="text-sm font-medium">
            {t("inspector:samplingComponent.title")}
          </span>
        </div>
        <Button
          onClick={handleSample}
          disabled={sampling || messages.length === 0}
          className="flex items-center gap-2"
        >
          <Brain className={`h-4 w-4 ${sampling ? "animate-pulse" : ""}`} />
          {sampling
            ? t("inspector:samplingComponent.sampling")
            : t("inspector:samplingComponent.sample")}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Messages and Configuration */}
        <div className="space-y-6">
          {/* Messages */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold">
              {t("inspector:samplingComponent.messages")}
            </h4>

            {/* Existing Messages */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border ${getRoleColor(message.role)}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium uppercase">
                      {message.role}
                    </span>
                    <button
                      onClick={() => handleRemoveMessage(index)}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      {t("inspector:samplingComponent.remove")}
                    </button>
                  </div>
                  <div className="text-sm">{message.content.text}</div>
                </div>
              ))}
            </div>

            {/* Add New Message */}
            <div className="border rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">
                  {t("inspector:samplingComponent.addMessageLabel")}
                </span>
                <select
                  value={newMessageRole}
                  onChange={(e) =>
                    setNewMessageRole(e.target.value as "user" | "system")
                  }
                  className="text-xs border rounded px-2 py-1"
                >
                  <option value="user">
                    {t("inspector:samplingComponent.roleUser")}
                  </option>
                  <option value="system">
                    {t("inspector:samplingComponent.roleSystem")}
                  </option>
                </select>
              </div>
              <Textarea
                placeholder={t(
                  "inspector:samplingComponent.messagePlaceholder",
                )}
                value={newMessageText}
                onChange={(e) => setNewMessageText(e.target.value)}
                rows={3}
              />
              <Button
                onClick={handleAddMessage}
                disabled={!newMessageText.trim()}
                size="sm"
                className="w-full"
              >
                {t("inspector:samplingComponent.addMessage")}
              </Button>
            </div>
          </div>

          {/* Configuration */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">
                {t("inspector:samplingComponent.parameters")}
              </h4>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("inspector:samplingComponent.maxTokens")}
                </label>
                <Input
                  type="number"
                  min="1"
                  max="4000"
                  value={maxTokens}
                  onChange={(e) =>
                    setMaxTokens(parseInt(e.target.value) || 1000)
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("inspector:samplingComponent.temperature")}
                </label>
                <Input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) =>
                    setTemperature(parseFloat(e.target.value) || 0.7)
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("inspector:samplingComponent.topP")}
                </label>
                <Input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={topP}
                  onChange={(e) => setTopP(parseFloat(e.target.value) || 1.0)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("inspector:samplingComponent.stopSequences")}
                </label>
                <Input
                  placeholder={t(
                    "inspector:samplingComponent.stopSequencesPlaceholder",
                  )}
                  value={stopSequences}
                  onChange={(e) => setStopSequences(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Response */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold">
            {t("inspector:samplingComponent.response")}
          </h4>

          {response ? (
            <div className="space-y-4">
              {/* Response Message */}
              <div
                className={`p-4 rounded-lg border ${getRoleColor("assistant")}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium uppercase">
                    {t("inspector:samplingComponent.assistantResponse")}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Brain className="h-3 w-3" />
                    {response.model}
                  </div>
                </div>
                <div className="text-sm whitespace-pre-wrap">
                  {response.content.text}
                </div>
              </div>

              {/* Response Metadata */}
              <div className="bg-gray-50 p-3 rounded border">
                <div className="text-xs font-medium uppercase text-muted-foreground mb-2">
                  {t("inspector:samplingComponent.metadata")}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span>{t("inspector:samplingComponent.model")}</span>
                    <span className="font-mono">{response.model}</span>
                  </div>
                  {response.stopReason && (
                    <div className="flex justify-between">
                      <span>{t("inspector:samplingComponent.stopReason")}</span>
                      <span className="font-mono">{response.stopReason}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>{t("inspector:samplingComponent.length")}</span>
                    <span className="font-mono">
                      {t("inspector:samplingComponent.chars", {
                        count: response.content.text.length,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="border border-dashed rounded-lg p-8 text-center">
              <Brain className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {sampling
                  ? t("inspector:samplingComponent.generating")
                  : t("inspector:samplingComponent.idle")}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Info Section */}
      <div className="rounded-lg bg-pink-50 border border-pink-200 p-4">
        <div className="flex items-start gap-3">
          <ActivitySquare className="h-5 w-5 text-pink-500 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-pink-900 mb-1">
              {t("inspector:samplingComponent.aboutTitle")}
            </h4>
            <p className="text-xs text-pink-700">
              {t("inspector:samplingComponent.aboutDescription")}
            </p>
            <div className="mt-2 text-xs text-pink-600">
              <strong>
                {t("inspector:samplingComponent.parametersLabel")}
              </strong>
              <ul className="mt-1 space-y-1">
                <li>
                  •{" "}
                  <strong>
                    {t("inspector:samplingComponent.labelWithColon", {
                      label: t("inspector:samplingComponent.temperature"),
                    })}
                  </strong>{" "}
                  {t("inspector:samplingComponent.temperatureHelp")}
                </li>
                <li>
                  •{" "}
                  <strong>
                    {t("inspector:samplingComponent.labelWithColon", {
                      label: t("inspector:samplingComponent.topP"),
                    })}
                  </strong>{" "}
                  {t("inspector:samplingComponent.topPHelp")}
                </li>
                <li>
                  •{" "}
                  <strong>
                    {t("inspector:samplingComponent.labelWithColon", {
                      label: t("inspector:samplingComponent.maxTokens"),
                    })}
                  </strong>{" "}
                  {t("inspector:samplingComponent.maxTokensHelp")}
                </li>
                <li>
                  •{" "}
                  <strong>
                    {t("inspector:samplingComponent.labelWithColon", {
                      label: t("inspector:samplingComponent.stopSequences"),
                    })}
                  </strong>{" "}
                  {t("inspector:samplingComponent.stopSequencesHelp")}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
