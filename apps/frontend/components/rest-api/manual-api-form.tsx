"use client";

import { ManualApiFormSchema, ManualEndpointFormSchema } from "@repo/zod-types";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslations } from "@/hooks/useTranslations";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

interface ManualApiFormProps {
  onSubmit: (data: z.infer<typeof ManualApiFormSchema>) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

export function ManualApiForm({ onSubmit, onCancel, isLoading }: ManualApiFormProps) {
  const { t } = useTranslations();

  const form = useForm<z.infer<typeof ManualApiFormSchema>>({
    resolver: zodResolver(ManualApiFormSchema),
    defaultValues: {
      name: "",
      description: "",
      base_url: "",
      auth_type: "none",
      endpoints: [
        {
          name: "",
          method: "GET",
          path: "",
          description: "",
          parameters_json: "",
          request_body_json: "",
          responses_json: "",
          headers_json: "",
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "endpoints",
  });

  const authType = form.watch("auth_type");

  const handleSubmit = async (data: z.infer<typeof ManualApiFormSchema>) => {
    try {
      await onSubmit(data);
    } catch (error) {
      console.error("Form submission failed:", error);
    }
  };

  const addEndpoint = () => {
    append({
      name: "",
      method: "GET",
      path: "",
      description: "",
      parameters_json: "",
      request_body_json: "",
      responses_json: "",
      headers_json: "",
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* API Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("rest-api:apiInformation")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rest-api:apiName")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("rest-api:apiNamePlaceholder")} {...field} />
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
                  <FormLabel>{t("rest-api:apiDescription")}</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder={t("rest-api:apiDescriptionPlaceholder")} 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="base_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rest-api:baseUrl")}</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="https://api.example.com" 
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription>
                    {t("rest-api:baseUrlDescription")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Authentication */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("rest-api:authentication")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="auth_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rest-api:authType")}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("rest-api:selectAuthType")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">{t("rest-api:authNone")}</SelectItem>
                      <SelectItem value="bearer">{t("rest-api:authBearer")}</SelectItem>
                      <SelectItem value="api_key">{t("rest-api:authApiKey")}</SelectItem>
                      <SelectItem value="basic">{t("rest-api:authBasic")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {authType === "bearer" && (
              <FormField
                control={form.control}
                name="auth_token"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("rest-api:bearerToken")}</FormLabel>
                    <FormControl>
                      <Input 
                        type="password" 
                        placeholder={t("rest-api:bearerTokenPlaceholder")} 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {authType === "api_key" && (
              <>
                <FormField
                  control={form.control}
                  name="auth_key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("rest-api:apiKey")}</FormLabel>
                      <FormControl>
                        <Input 
                          type="password" 
                          placeholder={t("rest-api:apiKeyPlaceholder")} 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="auth_key_location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("rest-api:keyLocation")}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("rest-api:selectKeyLocation")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="header">{t("rest-api:header")}</SelectItem>
                            <SelectItem value="query">{t("rest-api:query")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="auth_key_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("rest-api:keyName")}</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="X-API-Key" 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            )}

            {authType === "basic" && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="auth_username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("rest-api:username")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="auth_password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("rest-api:password")}</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Endpoints */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                {t("rest-api:endpoints")}
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addEndpoint}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t("rest-api:addEndpoint")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {fields.map((field, index) => (
              <Card key={field.id} className="border-dashed">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {t("rest-api:endpoint")} {index + 1}
                    </CardTitle>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name={`endpoints.${index}.name`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("rest-api:endpointName")}</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="getUser" 
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`endpoints.${index}.method`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("rest-api:method")}</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="GET">GET</SelectItem>
                              <SelectItem value="POST">POST</SelectItem>
                              <SelectItem value="PUT">PUT</SelectItem>
                              <SelectItem value="DELETE">DELETE</SelectItem>
                              <SelectItem value="PATCH">PATCH</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name={`endpoints.${index}.path`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("rest-api:path")}</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="/users/{id}" 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          {t("rest-api:pathDescription")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`endpoints.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("rest-api:endpointDescription")}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t("rest-api:endpointDescriptionPlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Advanced configuration - collapsed by default */}
                  <details className="space-y-4">
                    <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                      {t("rest-api:advancedConfiguration")}
                    </summary>
                    <div className="space-y-4 pl-4 border-l-2 border-muted">
                      <FormField
                        control={form.control}
                        name={`endpoints.${index}.parameters_json`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("rest-api:parametersJson")}</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder='[{"name": "id", "in": "path", "type": "string", "required": true}]'
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              {t("rest-api:parametersJsonDescription")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`endpoints.${index}.request_body_json`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("rest-api:requestBodyJson")}</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder='{"contentType": "application/json", "required": true}'
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              {t("rest-api:requestBodyJsonDescription")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`endpoints.${index}.headers_json`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("rest-api:headersJson")}</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder='{"Content-Type": "application/json"}'
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              {t("rest-api:headersJsonDescription")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </details>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>

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
          <Button type="submit" disabled={isLoading}>
            {isLoading ? t("common:importing") : t("rest-api:importApi")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
