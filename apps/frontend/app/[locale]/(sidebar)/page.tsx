"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldOff, Mail } from "lucide-react";

import { useTranslations } from "@/hooks/useTranslations";
import { authClient, User, isAuthenticatedUser } from "@/lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function RootPage() {
  const { t } = useTranslations();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authClient.getSession().then((session) => {
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
        setLoading(false);
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

  // Show non-admin placeholder
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
                Your account: <span className="font-mono">{user?.email}</span>
              </p>
            </AlertDescription>
          </Alert>

          <div className="bg-muted p-4 rounded-lg">
            <h3 className="font-semibold text-sm mb-2">What you can do:</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Register OAuth clients for MCP server access</li>
              <li>• Use API keys to connect to MetaMCP endpoints</li>
              <li>• Make requests to MCP servers through authorized endpoints</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
