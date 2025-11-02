import { Suspense } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { vanillaTrpcClient } from "@/lib/trpc";

import { LoginForm } from "./login-form";

async function getAuthConfig() {
  try {
    const config = await vanillaTrpcClient.frontend.config.getAuthConfig.query();
    return config;
  } catch (error) {
    console.error("Failed to fetch auth config:", error);
    return {
      isSignupDisabled: false,
      isBasicAuthDisabled: false,
      isOidcEnabled: false,
    };
  }
}

export default async function LoginPage() {
  const authConfig = await getAuthConfig();

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm mx-auto flex flex-col justify-center space-y-6">
        <Suspense fallback={<div>Loading...</div>}>
          <LoginForm
            isSignupDisabled={authConfig.isSignupDisabled}
            isBasicAuthDisabled={authConfig.isBasicAuthDisabled}
            isOidcEnabled={authConfig.isOidcEnabled}
          />
        </Suspense>
      </div>
    </div>
  );
}
