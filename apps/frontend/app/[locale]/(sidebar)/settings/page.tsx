"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type SettingsFormData, SettingsFormSchema } from "@repo/zod-types";
import React, { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

export default function SettingsPage() {
  const { t } = useTranslations();
  const [isSignupDisabled, setIsSignupDisabled] = useState(false);
  const [isSsoSignupDisabled, setIsSsoSignupDisabled] = useState(false);
  const [mcpResetTimeoutOnProgress, setMcpResetTimeoutOnProgress] =
    useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Form setup
  const form = useForm<SettingsFormData>({
    resolver: zodResolver(SettingsFormSchema),
    defaultValues: {
      mcpTimeout: 60000,
      mcpMaxTotalTimeout: 60000,
      mcpMaxAttempts: 1,
    },
  });

  const {
    handleSubmit,
    reset,
    formState: { isDirty, isSubmitting },
  } = form;

  // Get current settings
  const {
    data: signupDisabled,
    isLoading: signupLoading,
    refetch: refetchSignup,
  } = trpc.frontend.config.getSignupDisabled.useQuery();

  const {
    data: ssoSignupDisabled,
    isLoading: ssoSignupLoading,
    refetch: refetchSsoSignup,
  } = trpc.frontend.config.getSsoSignupDisabled.useQuery();

  const {
    data: mcpResetTimeoutOnProgressData,
    isLoading: mcpResetLoading,
    refetch: refetchMcpReset,
  } = trpc.frontend.config.getMcpResetTimeoutOnProgress.useQuery();

  const {
    data: mcpTimeoutData,
    isLoading: mcpTimeoutLoading,
    refetch: refetchMcpTimeout,
  } = trpc.frontend.config.getMcpTimeout.useQuery();

  const {
    data: mcpMaxTotalTimeoutData,
    isLoading: mcpMaxTotalLoading,
    refetch: refetchMcpMaxTotal,
  } = trpc.frontend.config.getMcpMaxTotalTimeout.useQuery();

  const {
    data: mcpMaxAttemptsData,
    isLoading: mcpMaxAttemptsLoading,
    refetch: refetchMcpMaxAttempts,
  } = trpc.frontend.config.getMcpMaxAttempts.useQuery();

  // Mutations
  const setSignupDisabledMutation =
    trpc.frontend.config.setSignupDisabled.useMutation({
      onSuccess: (data) => {
        if (data.success) {
          refetchSignup();
        } else {
          console.error("Failed to update signup setting");
        }
      },
    });

  const setSsoSignupDisabledMutation =
    trpc.frontend.config.setSsoSignupDisabled.useMutation({
      onSuccess: (data) => {
        if (data.success) {
          refetchSsoSignup();
        } else {
          console.error("Failed to update SSO signup setting");
        }
      },
    });

  const setMcpResetTimeoutOnProgressMutation =
    trpc.frontend.config.setMcpResetTimeoutOnProgress.useMutation({
      onSuccess: (data) => {
        if (data.success) {
          refetchMcpReset();
        } else {
          console.error("Failed to update MCP reset timeout setting");
        }
      },
    });

  const setMcpTimeoutMutation = trpc.frontend.config.setMcpTimeout.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        refetchMcpTimeout();
        setHasUnsavedChanges(false);
      } else {
        console.error("Failed to update MCP timeout setting");
      }
    },
  });

  const setMcpMaxTotalTimeoutMutation =
    trpc.frontend.config.setMcpMaxTotalTimeout.useMutation({
      onSuccess: (data) => {
        if (data.success) {
          refetchMcpMaxTotal();
          setHasUnsavedChanges(false);
        } else {
          console.error("Failed to update MCP max total timeout setting");
        }
      },
    });

  const setMcpMaxAttemptsMutation =
    trpc.frontend.config.setMcpMaxAttempts.useMutation({
      onSuccess: (data) => {
        if (data.success) {
          refetchMcpMaxAttempts();
          setHasUnsavedChanges(false);
        } else {
          console.error("Failed to update MCP max attempts setting");
        }
      },
    });

  // Update local state when data is loaded
  useEffect(() => {
    if (signupDisabled !== undefined) {
      setIsSignupDisabled(signupDisabled);
    }
  }, [signupDisabled]);

  useEffect(() => {
    if (ssoSignupDisabled !== undefined) {
      setIsSsoSignupDisabled(ssoSignupDisabled);
    }
  }, [ssoSignupDisabled]);

  useEffect(() => {
    if (mcpResetTimeoutOnProgressData !== undefined) {
      setMcpResetTimeoutOnProgress(mcpResetTimeoutOnProgressData);
    }
  }, [mcpResetTimeoutOnProgressData]);

  useEffect(() => {
    if (mcpTimeoutData !== undefined) {
      form.setValue("mcpTimeout", mcpTimeoutData);
    }
  }, [mcpTimeoutData, form]);

  useEffect(() => {
    if (mcpMaxTotalTimeoutData !== undefined) {
      form.setValue("mcpMaxTotalTimeout", mcpMaxTotalTimeoutData);
    }
  }, [mcpMaxTotalTimeoutData, form]);

  useEffect(() => {
    if (mcpMaxAttemptsData !== undefined) {
      form.setValue("mcpMaxAttempts", mcpMaxAttemptsData);
    }
  }, [mcpMaxAttemptsData, form]);

  // Reset form with loaded data to establish proper baseline for change detection
  useEffect(() => {
    if (
      mcpTimeoutData !== undefined &&
      mcpMaxTotalTimeoutData !== undefined &&
      mcpMaxAttemptsData !== undefined
    ) {
      form.reset({
        mcpTimeout: mcpTimeoutData,
        mcpMaxTotalTimeout: mcpMaxTotalTimeoutData,
        mcpMaxAttempts: mcpMaxAttemptsData,
      });
    }
  }, [mcpTimeoutData, mcpMaxTotalTimeoutData, mcpMaxAttemptsData, form]);

  // Handle immediate switch updates
  const handleSignupToggle = async (checked: boolean) => {
    setIsSignupDisabled(checked);
    try {
      await setSignupDisabledMutation.mutateAsync({ disabled: checked });
      toast.success(
        checked
          ? t("settings:signupDisabledSuccess")
          : t("settings:signupEnabledSuccess"),
      );
    } catch (error) {
      setIsSignupDisabled(!checked);
      console.error("Failed to update signup setting:", error);
      toast.error(t("settings:signupToggleError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleSsoSignupToggle = async (checked: boolean) => {
    setIsSsoSignupDisabled(checked);
    try {
      await setSsoSignupDisabledMutation.mutateAsync({ disabled: checked });
      toast.success(
        checked
          ? t("settings:ssoSignupDisabledSuccess")
          : t("settings:ssoSignupEnabledSuccess"),
      );
    } catch (error) {
      setIsSsoSignupDisabled(!checked);
      console.error("Failed to update SSO signup setting:", error);
      toast.error(t("settings:ssoSignupToggleError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleMcpResetTimeoutToggle = async (checked: boolean) => {
    setMcpResetTimeoutOnProgress(checked);
    try {
      await setMcpResetTimeoutOnProgressMutation.mutateAsync({
        enabled: checked,
      });
      toast.success(
        checked
          ? t("settings:mcpResetTimeoutEnabledSuccess")
          : t("settings:mcpResetTimeoutDisabledSuccess"),
      );
    } catch (error) {
      setMcpResetTimeoutOnProgress(!checked);
      console.error("Failed to update MCP reset timeout setting:", error);
      toast.error(t("settings:mcpResetTimeoutToggleError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Handle form submission
  const onSubmit = async (data: SettingsFormData) => {
    try {
      await Promise.all([
        setMcpTimeoutMutation.mutateAsync({ timeout: data.mcpTimeout }),
        setMcpMaxTotalTimeoutMutation.mutateAsync({
          timeout: data.mcpMaxTotalTimeout,
        }),
        setMcpMaxAttemptsMutation.mutateAsync({
          maxAttempts: data.mcpMaxAttempts,
        }),
      ]);
      reset(data); // Reset form state to match current values
      toast.success(t("settings:saved"));
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(t("settings:error"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Check for unsaved changes
  useEffect(() => {
    setHasUnsavedChanges(isDirty);
  }, [isDirty]);

  const isLoading =
    signupLoading ||
    ssoSignupLoading ||
    mcpResetLoading ||
    mcpTimeoutLoading ||
    mcpMaxTotalLoading ||
    mcpMaxAttemptsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("settings:title")}
          </h1>
          <p className="text-muted-foreground">{t("settings:description")}</p>
        </div>
        <div>{t("settings:loading")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {t("settings:title")}
        </h1>
        <p className="text-muted-foreground">{t("settings:description")}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings:authSettings")}</CardTitle>
            <CardDescription>
              {t("settings:authSettingsDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="disable-signup" className="text-base">
                  {t("settings:disableSignup")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings:disableSignupDescription")}
                </p>
              </div>
              <Switch
                id="disable-signup"
                checked={isSignupDisabled}
                onCheckedChange={handleSignupToggle}
                disabled={setSignupDisabledMutation.isPending}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="disable-sso-signup" className="text-base">
                  {t("settings:disableSsoSignup")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings:disableSsoSignupDescription")}
                </p>
              </div>
              <Switch
                id="disable-sso-signup"
                checked={isSsoSignupDisabled}
                onCheckedChange={handleSsoSignupToggle}
                disabled={setSsoSignupDisabledMutation.isPending}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings:mcpSettings")}</CardTitle>
            <CardDescription>
              {t("settings:mcpSettingsDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="mcp-reset-timeout" className="text-base">
                  {t("settings:mcpResetTimeoutOnProgress")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings:mcpResetTimeoutOnProgressDescription")}
                </p>
              </div>
              <Switch
                id="mcp-reset-timeout"
                checked={mcpResetTimeoutOnProgress}
                onCheckedChange={handleMcpResetTimeoutToggle}
                disabled={setMcpResetTimeoutOnProgressMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-timeout" className="text-base">
                {t("settings:mcpTimeout")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings:mcpTimeoutDescription")}
              </p>
              <div className="flex items-center space-x-2">
                <Controller
                  name="mcpTimeout"
                  control={form.control}
                  render={({ field }) => (
                    <Input
                      {...field}
                      id="mcp-timeout"
                      type="number"
                      min="1000"
                      max="3000000"
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        field.onChange(isNaN(value) ? 1000 : value);
                      }}
                      className="w-32"
                    />
                  )}
                />
                <span className="text-sm text-muted-foreground">ms</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-max-total-timeout" className="text-base">
                {t("settings:mcpMaxTotalTimeout")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings:mcpMaxTotalTimeoutDescription")}
              </p>
              <div className="flex items-center space-x-2">
                <Controller
                  name="mcpMaxTotalTimeout"
                  control={form.control}
                  render={({ field }) => (
                    <Input
                      {...field}
                      id="mcp-max-total-timeout"
                      type="number"
                      min="1000"
                      max="3000000"
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        field.onChange(isNaN(value) ? 1000 : value);
                      }}
                      className="w-32"
                    />
                  )}
                />
                <span className="text-sm text-muted-foreground">ms</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-max-attempts" className="text-base">
                {t("settings:mcpMaxAttempts")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings:mcpMaxAttemptsDescription")}
              </p>
              <div className="flex items-center space-x-2">
                <Controller
                  name="mcpMaxAttempts"
                  control={form.control}
                  render={({ field }) => (
                    <Input
                      {...field}
                      id="mcp-max-attempts"
                      type="number"
                      min="1"
                      max="10"
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        field.onChange(isNaN(value) ? 1 : value);
                      }}
                      className="w-32"
                    />
                  )}
                />
                <span className="text-sm text-muted-foreground">
                  {t("settings:attempts")}
                </span>
              </div>
            </div>

            {/* Apply Changes Button - only show when there are unsaved changes */}
            {hasUnsavedChanges && (
              <div className="flex items-center justify-between pt-4 border-t">
                <div className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
                  <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
                  {t("settings:unsavedChangesTitle")}
                </div>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-w-[120px]"
                >
                  {isSubmitting
                    ? t("settings:loading")
                    : t("settings:applyChanges")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
