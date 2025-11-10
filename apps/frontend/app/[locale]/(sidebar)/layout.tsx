"use client";

import {
  FileTerminal,
  Key,
  Link as LinkIcon,
  Package,
  Search,
  SearchCode,
  Server,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { LogsStatusIndicator } from "@/components/logs-status-indicator";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useTranslations } from "@/hooks/useTranslations";
import { authClient, User, SessionResponse } from "@/lib/auth-client";
import { getLocalizedPath, SupportedLocale } from "@/lib/i18n";

// Menu items function - now takes locale and isAdmin parameters
const getMenuItems = (t: (key: string) => string, locale: SupportedLocale, isAdmin: boolean = true) => {
  const allItems = [
    {
      title: t("navigation:exploreMcpServers"),
      url: getLocalizedPath("/search", locale),
      icon: Search,
      adminOnly: true,
    },
    {
      title: t("navigation:mcpServers"),
      url: getLocalizedPath("/mcp-servers", locale),
      icon: Server,
      adminOnly: true,
    },
    {
      title: t("navigation:metamcpNamespaces"),
      url: getLocalizedPath("/namespaces", locale),
      icon: Package,
      adminOnly: true,
    },
    {
      title: t("navigation:metamcpEndpoints"),
      url: getLocalizedPath("/endpoints", locale),
      icon: LinkIcon,
      adminOnly: true,
    },
    {
      title: t("navigation:mcpInspector"),
      url: getLocalizedPath("/mcp-inspector", locale),
      icon: SearchCode,
      adminOnly: true,
    },
    {
      title: t("navigation:apiKeys"),
      url: getLocalizedPath("/api-keys", locale),
      icon: Key,
      adminOnly: true, // Only admins can manage API keys
    },
    {
      title: t("navigation:oauthClients"),
      url: getLocalizedPath("/oauth-clients", locale),
      icon: Shield,
      adminOnly: true, // Only admins can manage OAuth clients
    },
    {
      title: t("navigation:users"),
      url: getLocalizedPath("/users", locale),
      icon: Users,
      adminOnly: true, // Only admins can manage users
    },
    {
      title: t("navigation:settings"),
      url: getLocalizedPath("/settings", locale),
      icon: Settings,
      adminOnly: true, // Only admins can access settings
    },
  ];

  // Filter items based on admin status
  return allItems.filter(item => !item.adminOnly || isAdmin);
};

function LiveLogsMenuItem({ isAdmin }: { isAdmin: boolean }) {
  const { t, locale } = useTranslations();

  // Only show for admins
  if (!isAdmin) {
    return null;
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link href={getLocalizedPath("/live-logs", locale)}>
          <FileTerminal />
          <span>{t("navigation:liveLogs")}</span>
          <LogsStatusIndicator />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function UserInfoFooter() {
  const { t } = useTranslations();
  const [user, setUser] = useState<User | null>(null);

  // Get user info
  useEffect(() => {
    authClient.getSession().then((session: SessionResponse) => {
      if (session?.data?.user) {
        setUser(session.data.user as User);
      }
    });
  }, []);

  const handleSignOut = async () => {
    await authClient.signOut();
    window.location.href = "/login";
  };

  return (
    <SidebarFooter>
      <div className="flex flex-col gap-4 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
          <p className="text-xs text-muted-foreground">v2.4.17</p>
        </div>
        <Separator />
        {user && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {user.name || user.email}
              </span>
              <span className="text-xs text-muted-foreground">
                {user.email}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              className="w-full"
            >
              {t("auth:signOut")}
            </Button>
          </div>
        )}
      </div>
    </SidebarFooter>
  );
}

export default function SidebarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t, locale } = useTranslations();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Get user info to determine admin status
  useEffect(() => {
    authClient.getSession().then((session: SessionResponse) => {
      if (session?.data?.user) {
        setUser(session.data.user as User);
      } else {
        setUser(null);
      }
      setLoading(false);
    });
  }, []);

  // If loading, show nothing (or a loader)
  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">{t("common:loading")}</div>;
  }

  // If user is not authenticated, render children without sidebar
  if (!user) {
    return (
      <div className="flex min-h-screen">
        <div className="flex flex-1 flex-col">
          {children}
        </div>
      </div>
    );
  }

  // User is authenticated, show sidebar with filtered menu items
  const items = getMenuItems(t, locale, user.isAdmin);

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                <LiveLogsMenuItem isAdmin={user.isAdmin} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <UserInfoFooter />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="ml-1 cursor-pointer" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
