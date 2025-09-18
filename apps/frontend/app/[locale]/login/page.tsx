"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { DomainWarningBanner } from "@/components/domain-warning-banner";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useTranslations } from "@/hooks/useTranslations";
import { authClient } from "@/lib/auth-client";
import { vanillaTrpcClient } from "@/lib/trpc";

function LoginForm() {
  const { t } = useTranslations();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isSignupDisabled, setIsSignupDisabled] = useState(false);
  const [isOidcLoading, setIsOidcLoading] = useState(false);
  const [isOidcEnabled, setIsOidcEnabled] = useState(false);
  const [authProvidersLoading, setAuthProvidersLoading] = useState(true);

  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  // Check if signup is disabled
  useEffect(() => {
    const checkSignupStatus = async () => {
      try {
        const isDisabled =
          await vanillaTrpcClient.frontend.config.getSignupDisabled.query();
        setIsSignupDisabled(isDisabled);
      } catch (error) {
        console.error("Failed to fetch signup status:", error);
      }
    };

    checkSignupStatus();
  }, []);

  // Check if OIDC is enabled
  useEffect(() => {
    const checkOidcStatus = async () => {
      try {
        const providers =
          await vanillaTrpcClient.frontend.config.getAuthProviders.query();
        const oidcProvider = providers.find(
          (provider) => provider.id === "oidc" && provider.enabled,
        );
        setIsOidcEnabled(!!oidcProvider);
      } catch (error) {
        console.error("Failed to fetch OIDC config:", error);
      } finally {
        setAuthProvidersLoading(false);
      }
    };

    checkOidcStatus();
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const { error } = await authClient.signIn.email({
        email,
        password,
        callbackURL: callbackUrl,
      });

      if (error) {
        setError(error.message || t("auth:signInError"));
      } else {
        router.push(callbackUrl);
      }
    } catch (_err) {
      setError(t("auth:signInError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOidcSignIn = async () => {
    setIsOidcLoading(true);
    try {
      await authClient.signIn.social({
        provider: "oidc",
        callbackURL: callbackUrl,
      });
    } catch (error) {
      console.error("OIDC sign in failed:", error);
      setError(t("auth:oidcSignInError"));
    } finally {
      setIsOidcLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("auth:signInToAccount")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("auth:enterCredentials")}
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSignIn} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            {t("auth:email")}
          </label>
          <Input
            id="email"
            type="email"
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
            type="password"
            placeholder={t("auth:passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
          />
        </div>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? t("auth:signingIn") : t("auth:signIn")}
        </Button>
      </form>

      {!authProvidersLoading && isOidcEnabled && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                {t("auth:orContinueWith")}
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleOidcSignIn}
            disabled={isOidcLoading}
          >
            {isOidcLoading ? t("auth:signingIn") : t("auth:signInWithOidc")}
          </Button>
        </>
      )}

      {!isSignupDisabled && (
        <div className="text-center text-sm">
          <span className="text-muted-foreground">{t("auth:noAccount")} </span>
          <Link href="/register" className="underline underline-offset-4">
            {t("auth:signUp")}
          </Link>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm mx-auto flex flex-col justify-center space-y-6">
        <DomainWarningBanner />
        <Suspense fallback={<div>Loading...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
