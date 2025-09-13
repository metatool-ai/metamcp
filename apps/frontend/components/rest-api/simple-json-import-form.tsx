"use client";

import { SimpleJsonApiSchema } from "@repo/zod-types";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, FileText, AlertCircle, CheckCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslations } from "@/hooks/useTranslations";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const SimpleJsonImportFormSchema = z.object({
  server_name: z.string().min(1, "Server name is required"),
  server_description: z.string().optional(),
  json_content: z.string().min(1, "JSON content is required"),
});

interface SimpleJsonImportFormProps {
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

export function SimpleJsonImportForm({ onSubmit, onCancel, isLoading }: SimpleJsonImportFormProps) {
  const { t } = useTranslations();
  const [parsedSpec, setParsedSpec] = useState<any>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const form = useForm<z.infer<typeof SimpleJsonImportFormSchema>>({
    resolver: zodResolver(SimpleJsonImportFormSchema),
    defaultValues: {
      server_name: "",
      server_description: "",
      json_content: "",
    },
  });

  const validateJsonSpec = async (content: string) => {
    setIsValidating(true);
    setParseError(null);
    setParsedSpec(null);

    try {
      const parsed = JSON.parse(content);
      const validated = SimpleJsonApiSchema.parse(parsed);
      setParsedSpec(validated);
      
      // Auto-fill server name if not provided
      if (!form.getValues("server_name") && validated.name) {
        form.setValue("server_name", validated.name);
      }
      
      // Auto-fill description if not provided
      if (!form.getValues("server_description") && validated.description) {
        form.setValue("server_description", validated.description);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        setParseError(t("rest-api:invalidJsonFormat"));
      } else if (error instanceof z.ZodError) {
        const firstError = error.errors[0];
        setParseError(
          t("rest-api:invalidSimpleJsonSpec") + 
          (firstError ? `: ${firstError.path.join('.')} - ${firstError.message}` : "")
        );
      } else {
        setParseError(t("rest-api:specValidationFailed"));
      }
    } finally {
      setIsValidating(false);
    }
  };

  const handleContentChange = (content: string) => {
    form.setValue("json_content", content);
    if (content.trim()) {
      validateJsonSpec(content);
    } else {
      setParsedSpec(null);
      setParseError(null);
    }
  };

  const handleSubmit = async (data: z.infer<typeof SimpleJsonImportFormSchema>) => {
    if (!parsedSpec) {
      setParseError(t("rest-api:validSpecRequired"));
      return;
    }

    try {
      await onSubmit({
        ...parsedSpec,
        name: data.server_name,
        description: data.server_description,
      });
    } catch (error) {
      console.error("Form submission failed:", error);
    }
  };

  const exampleJson = {
    name: "Example API",
    description: "A simple example API",
    base_url: "https://api.example.com",
    auth: {
      type: "bearer",
      token: "your-api-token"
    },
    endpoints: [
      {
        name: "getUser",
        method: "GET",
        path: "/users/{id}",
        description: "Get user by ID",
        parameters: [
          {
            name: "id",
            in: "path",
            type: "string",
            required: true,
            description: "User ID"
          }
        ]
      },
      {
        name: "updateUser",
        method: "PUT",
        path: "/users/{id}",
        description: "Update user information",
        parameters: [
          {
            name: "id",
            in: "path",
            type: "string",
            required: true,
            description: "User ID"
          }
        ],
        requestBody: {
          contentType: "application/json",
          required: true
        }
      }
    ]
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Server Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("rest-api:serverInformation")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="server_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rest-api:serverName")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("rest-api:serverNamePlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="server_description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rest-api:serverDescription")}</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder={t("rest-api:serverDescriptionPlaceholder")} 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* JSON Content */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("rest-api:apiSpecification")}
            </CardTitle>
            <CardDescription>
              {t("rest-api:simpleJsonDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="json_content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rest-api:jsonContent")}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={JSON.stringify(exampleJson, null, 2)}
                      className="min-h-[300px] font-mono text-sm"
                      {...field}
                      onChange={(e) => handleContentChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("rest-api:jsonContentDescription")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Example JSON */}
            <details className="space-y-2">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                {t("rest-api:showExample")}
              </summary>
              <Card className="bg-muted/50">
                <CardContent className="p-4">
                  <pre className="text-xs overflow-x-auto">
                    {JSON.stringify(exampleJson, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </details>
          </CardContent>
        </Card>

        {/* Validation Results */}
        {(parseError || parsedSpec) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t("rest-api:validationResults")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {parseError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{parseError}</AlertDescription>
                </Alert>
              )}

              {parsedSpec && (
                <div className="space-y-4">
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      {t("rest-api:specValidationSuccess")}
                    </AlertDescription>
                  </Alert>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium">{t("rest-api:apiName")}:</span>
                      <p className="text-sm text-muted-foreground">{parsedSpec.name}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium">{t("rest-api:baseUrl")}:</span>
                      <p className="text-sm text-muted-foreground">{parsedSpec.base_url}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium">{t("rest-api:endpointsCount")}:</span>
                      <Badge variant="secondary">{parsedSpec.endpoints?.length || 0}</Badge>
                    </div>
                    <div>
                      <span className="text-sm font-medium">{t("rest-api:authType")}:</span>
                      <Badge variant="outline">{parsedSpec.auth?.type || "none"}</Badge>
                    </div>
                  </div>

                  {parsedSpec.endpoints && parsedSpec.endpoints.length > 0 && (
                    <div>
                      <span className="text-sm font-medium">{t("rest-api:endpoints")}:</span>
                      <div className="mt-2 space-y-1">
                        {parsedSpec.endpoints.map((endpoint: any, index: number) => (
                          <div key={index} className="flex items-center gap-2 text-sm">
                            <Badge variant="outline" className="text-xs">
                              {endpoint.method}
                            </Badge>
                            <span className="font-mono">{endpoint.path}</span>
                            <span className="text-muted-foreground">- {endpoint.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Form Actions */}
        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("common:back")}
          </Button>
          <Button 
            type="submit" 
            disabled={isLoading || !parsedSpec || isValidating}
          >
            {isLoading ? t("common:importing") : t("rest-api:importApi")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
