"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldOff, Mail } from "lucide-react";

import { useTranslations } from "@/hooks/useTranslations";
import { authClient, User, isAuthenticatedUser, SessionResponse } from "@/lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function RootPage() {
  const { t } = useTranslations();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authClient.getSession().then((session: SessionResponse) => {
      if (session?.data?.user && isAuthenticatedUser(session.data.user)) {
        const authenticatedUser = session.data.user as User;
        setUser(authenticatedUser);
        // If user is admin, redirect to MCP servers page
        if (authenticatedUser.isAdmin) {
          router.replace("/mcp-servers");
        } else {
          setLoading(false);
        }
      } else {
        // User is not authenticated - redirect directly to login page
        router.replace("/login");
      }
    });
  }, [router]);

  // Return a loading state while checking user role
  if (loading || (user && user.isAdmin)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("common:loading")}
          </h1>
        </div>
      </div>
    );
  }

  // Show unauthenticated placeholder
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-200px)] p-6">
        <Card className="max-w-2xl w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="rounded-full bg-muted p-3">
                <ShieldOff className="h-10 w-10 text-muted-foreground" />
              </div>
            </div>
            <CardTitle className="text-2xl">{t("auth:notLoggedIn")}</CardTitle>
            <CardDescription className="text-base mt-2">
              {t("auth:pleaseLoginToAccess")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <button
              onClick={() => router.push("/auth/login")}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              {t("auth:loginButton")}
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show non-admin placeholder (user is authenticated but not admin)
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-200px)] p-6">
      <Card className="max-w-2xl w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-muted p-3">
              <ShieldOff className="h-10 w-10 text-muted-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl">{t("users:noAdminAccess")}</CardTitle>
          <CardDescription className="text-base mt-2">
            {t("users:noAdminAccessDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Mail className="h-4 w-4" />
            <AlertDescription>
              <strong>{t("users:contactAdmin")}</strong>
              <p className="text-sm text-muted-foreground mt-1">
                {t("users:yourAccount")} <span className="font-mono">{user.email}</span>
              </p>
            </AlertDescription>
          </Alert>

          <div className="bg-muted p-4 rounded-lg">
            <h3 className="font-semibold text-sm mb-2">{t("users:whatYouCanDo")}</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• {t("users:canMakeRequests")}</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
