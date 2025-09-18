"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { DomainWarningBanner } from "@/components/domain-warning-banner";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useTranslations } from "@/hooks/useTranslations";
import { authClient } from "@/lib/auth-client";
import { vanillaTrpcClient } from "@/lib/trpc";

function LoadingFallback() {
  const { t } = useTranslations();
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("common:loading")}
        </h1>
      </div>
    </div>
  );
}

function RegisterForm() {
  const { t } = useTranslations();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isSignupDisabled, setIsSignupDisabled] = useState(false);
  const [checkingSignupStatus, setCheckingSignupStatus] = useState(true);

  const router = useRouter();

  // Function to check signup status
  const checkSignupStatus = async () => {
    try {
      const isDisabled =
        await vanillaTrpcClient.frontend.config.getSignupDisabled.query();
      setIsSignupDisabled(isDisabled);
    } catch (error) {
      console.error("Failed to check signup status:", error);
      // If we can't check, allow signup to proceed (fail open)
      setIsSignupDisabled(false);
    } finally {
      setCheckingSignupStatus(false);
    }
  };

  // Check signup status on mount
  useEffect(() => {
    checkSignupStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Re-check signup status before attempting to register
    await checkSignupStatus();

    if (isSignupDisabled) {
      setError(t("auth:registrationDisabledError"));
      return;
    }

    setIsLoading(true);
    setError("");

    if (password !== confirmPassword) {
      setError(t("auth:passwordsDoNotMatch"));
      setIsLoading(false);
      return;
    }

    if (password.length < 8) {
      setError(t("auth:passwordTooShort"));
      setIsLoading(false);
      return;
    }

    try {
      const { error } = await authClient.signUp.email({
        email,
        password,
        name,
        callbackURL: "/",
      });

      if (error) {
        // Check if signup is actually disabled by checking the current status
        const currentSignupStatus =
          await vanillaTrpcClient.frontend.config.getSignupDisabled.query();

        if (currentSignupStatus) {
          // Signup is actually disabled, show that message
          setError(t("auth:registrationDisabledError"));
          setIsSignupDisabled(true);
        } else {
          // Signup is enabled but registration failed for other reasons (validation, etc.)
          // Show the actual error message from the backend
          setError(error.message || t("auth:registrationFailed"));
        }
      } else {
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      // Handle any other errors
      console.error("Registration error:", err);

      // Check if signup is actually disabled
      try {
        const currentSignupStatus =
          await vanillaTrpcClient.frontend.config.getSignupDisabled.query();

        if (currentSignupStatus) {
          setError(t("auth:registrationDisabledError"));
          setIsSignupDisabled(true);
        } else {
          // Show the actual error message or a generic fallback
          setError((err as Error)?.message || t("auth:registrationFailed"));
        }
      } catch (_statusCheckError) {
        // If we can't check status, just show the original error
        setError((err as Error)?.message || t("auth:registrationFailed"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingSignupStatus) {
    return (
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("common:loading")}
          </h1>
        </div>
      </div>
    );
  }

  if (isSignupDisabled) {
    return (
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("auth:registrationDisabled")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("auth:registrationDisabledMessage")}
          </p>
        </div>
        <div className="text-center text-sm">
          <span className="text-muted-foreground">
            {t("auth:alreadyHaveAccount")}{" "}
          </span>
          <Link href="/login" className="underline underline-offset-4">
            {t("auth:signIn")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("auth:createAccount")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("auth:enterAccountDetails")}
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("auth:name")}
          </label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder={t("auth:namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            {t("auth:email")}
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder={t("auth:emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            {t("auth:password")}
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={t("auth:passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="text-sm font-medium">
            {t("auth:confirmPassword")}
          </label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder={t("auth:confirmPasswordPlaceholder")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={isLoading}
          />
        </div>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading
            ? t("auth:creatingAccount")
            : t("auth:createAccountButton")}
        </Button>
      </form>

      <div className="text-center text-sm">
        <span className="text-muted-foreground">
          {t("auth:alreadyHaveAccount")}{" "}
        </span>
        <Link href="/login" className="underline underline-offset-4">
          {t("auth:signIn")}
        </Link>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm mx-auto flex flex-col justify-center space-y-6">
        <DomainWarningBanner />
        <Suspense fallback={<LoadingFallback />}>
          <RegisterForm />
        </Suspense>
      </div>
    </div>
  );
}
