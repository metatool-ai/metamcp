"use client";

import { OpenApiSpecSchema } from "@repo/zod-types";
import { zodResolver } from "@hookform/resolvers/zod";
import { Upload, FileText, ArrowLeft, Globe, AlertCircle } from "lucide-react";
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

const OpenApiImportFormSchema = z.object({
  server_name: z.string().min(1, "Server name is required"),
  server_description: z.string().optional(),
  import_method: z.enum(["file", "url", "paste"]),
  openapi_url: z.string().url().optional(),
  openapi_content: z.string().optional(),
});

interface OpenApiImportFormProps {
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

export function OpenApiImportForm({ onSubmit, onCancel, isLoading }: OpenApiImportFormProps) {
  const { t } = useTranslations();
  const [parsedSpec, setParsedSpec] = useState<any>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const form = useForm<z.infer<typeof OpenApiImportFormSchema>>({
    resolver: zodResolver(OpenApiImportFormSchema),
    defaultValues: {
      server_name: "",
      server_description: "",
      import_method: "paste",
      openapi_url: "",
      openapi_content: "",
    },
  });

  const importMethod = form.watch("import_method");

  const validateOpenApiSpec = async (content: string) => {
    setIsValidating(true);
    setParseError(null);
    setParsedSpec(null);

    try {
      const parsed = JSON.parse(content);
      const validated = OpenApiSpecSchema.parse(parsed);
      setParsedSpec(validated);
      
      // Auto-fill server name if not provided
      if (!form.getValues("server_name") && validated.info?.title) {
        form.setValue("server_name", validated.info.title);
      }
      
      // Auto-fill description if not provided
      if (!form.getValues("server_description") && validated.info?.description) {
        form.setValue("server_description", validated.info.description);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        setParseError(t("rest-api:invalidJsonFormat"));
      } else if (error instanceof z.ZodError) {
        setParseError(t("rest-api:invalidOpenApiSpec") + ": " + error.errors[0]?.message);
      } else {
        setParseError(t("rest-api:specValidationFailed"));
      }
    } finally {
      setIsValidating(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      form.setValue("openapi_content", content);
      validateOpenApiSpec(content);
    };
    reader.readAsText(file);
  };

  const handleUrlLoad = async () => {
    const url = form.getValues("openapi_url");
    if (!url) return;

    setIsValidating(true);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const content = await response.text();
      form.setValue("openapi_content", content);
      await validateOpenApiSpec(content);
    } catch (error) {
      setParseError(
        error instanceof Error 
          ? t("rest-api:urlLoadFailed") + ": " + error.message
          : t("rest-api:urlLoadFailed")
      );
    } finally {
      setIsValidating(false);
    }
  };

  const handleContentChange = (content: string) => {
    form.setValue("openapi_content", content);
    if (content.trim()) {
      validateOpenApiSpec(content);
    } else {
      setParsedSpec(null);
      setParseError(null);
    }
  };

  const handleSubmit = async (data: z.infer<typeof OpenApiImportFormSchema>) => {
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

  const getEndpointsCount = () => {
    if (!parsedSpec?.paths) return 0;
    return Object.values(parsedSpec.paths).reduce((count: number, pathItem: any) => {
      return count + Object.keys(pathItem).filter(key => 
        ['get', 'post', 'put', 'delete', 'patch'].includes(key)
      ).length;
    }, 0);
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

        {/* Import Method */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("rest-api:importMethod")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="import_method"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <div className="grid grid-cols-3 gap-4">
                      <Card 
                        className={`cursor-pointer transition-colors ${
                          field.value === "file" ? "ring-2 ring-primary" : "hover:bg-accent"
                        }`}
                        onClick={() => field.onChange("file")}
                      >
                        <CardContent className="flex flex-col items-center justify-center p-4">
                          <Upload className="h-8 w-8 mb-2" />
                          <span className="text-sm font-medium">{t("rest-api:uploadFile")}</span>
                        </CardContent>
                      </Card>

                      <Card 
                        className={`cursor-pointer transition-colors ${
                          field.value === "url" ? "ring-2 ring-primary" : "hover:bg-accent"
                        }`}
                        onClick={() => field.onChange("url")}
                      >
                        <CardContent className="flex flex-col items-center justify-center p-4">
                          <Globe className="h-8 w-8 mb-2" />
                          <span className="text-sm font-medium">{t("rest-api:fromUrl")}</span>
                        </CardContent>
                      </Card>

                      <Card 
                        className={`cursor-pointer transition-colors ${
                          field.value === "paste" ? "ring-2 ring-primary" : "hover:bg-accent"
                        }`}
                        onClick={() => field.onChange("paste")}
                      >
                        <CardContent className="flex flex-col items-center justify-center p-4">
                          <FileText className="h-8 w-8 mb-2" />
                          <span className="text-sm font-medium">{t("rest-api:pasteContent")}</span>
                        </CardContent>
                      </Card>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {importMethod === "file" && (
              <div>
                <FormLabel>{t("rest-api:selectFile")}</FormLabel>
                <Input
                  type="file"
                  accept=".json,.yaml,.yml"
                  onChange={handleFileUpload}
                  className="mt-2"
                />
                <FormDescription>
                  {t("rest-api:supportedFormats")}
                </FormDescription>
              </div>
            )}

            {importMethod === "url" && (
              <div className="space-y-2">
                <FormField
                  control={form.control}
                  name="openapi_url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("rest-api:specUrl")}</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input 
                            placeholder="https://api.example.com/openapi.json" 
                            {...field} 
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleUrlLoad}
                          disabled={isValidating || !field.value}
                        >
                          {isValidating ? t("common:loading") : t("rest-api:load")}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {importMethod === "paste" && (
              <FormField
                control={form.control}
                name="openapi_content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("rest-api:pasteSpec")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("rest-api:pasteSpecPlaceholder")}
                        className="min-h-[200px] font-mono text-sm"
                        {...field}
                        onChange={(e) => handleContentChange(e.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("rest-api:pasteSpecDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
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
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {t("rest-api:specValidationSuccess")}
                    </AlertDescription>
                  </Alert>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium">{t("rest-api:apiTitle")}:</span>
                      <p className="text-sm text-muted-foreground">{parsedSpec.info?.title}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium">{t("rest-api:apiVersion")}:</span>
                      <p className="text-sm text-muted-foreground">{parsedSpec.info?.version}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium">{t("rest-api:endpointsCount")}:</span>
                      <Badge variant="secondary">{getEndpointsCount()}</Badge>
                    </div>
                    <div>
                      <span className="text-sm font-medium">{t("rest-api:serversCount")}:</span>
                      <Badge variant="secondary">{parsedSpec.servers?.length || 0}</Badge>
                    </div>
                  </div>
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
