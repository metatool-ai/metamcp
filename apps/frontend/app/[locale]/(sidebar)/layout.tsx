"use client";

import type { Capability } from "@repo/zod-types";
import {
  FileTerminal,
  Fingerprint,
  History,
  Key,
  Link as LinkIcon,
  LucideIcon,
  Package,
  ScrollText,
  Search,
  SearchCode,
  Server,
  Settings,
  ShieldHalf,
  UserCog,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { RoleBadge } from "@/components/access/access-badges";
import { UserAvatar } from "@/components/access/user-avatar";
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
import { useAccess } from "@/hooks/useAccess";
import { useTranslations } from "@/hooks/useTranslations";
import { authClient } from "@/lib/auth-client";
import { getLocalizedPath, getPathnameWithoutLocale } from "@/lib/i18n";

type MenuItem = {
  title: string;
  path: string;
  icon: LucideIcon;
  /** Hidden unless the user holds this capability (admins hold them all). */
  capability?: Capability;
};

function isActivePath(current: string, path: string): boolean {
  return current === path || current.startsWith(`${path}/`);
}

function NavItems({ items }: { items: MenuItem[] }) {
  const { locale } = useTranslations();
  const pathname = getPathnameWithoutLocale(usePathname() ?? "/");
  return (
    <>
      {items.map((item) => (
        <SidebarMenuItem key={item.path}>
          <SidebarMenuButton
            asChild
            isActive={isActivePath(pathname, item.path)}
          >
            <Link href={getLocalizedPath(item.path, locale)}>
              <item.icon />
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </>
  );
}

function LiveLogsMenuItem() {
  const { t, locale } = useTranslations();
  const pathname = getPathnameWithoutLocale(usePathname() ?? "/");

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActivePath(pathname, "/live-logs")}
      >
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
  const { me } = useAccess();

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
          <p className="text-xs text-muted-foreground">v2.5-ai-dev</p>
        </div>
        <Separator />
        {me && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <UserAvatar
                name={me.name}
                email={me.email}
                image={me.image}
                seed={me.userId}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">
                  {me.name || me.email}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {me.email}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <RoleBadge role={me.role} />
              {me.groups
                .filter((group) => group.systemKey !== "everyone")
                .slice(0, 2)
                .map((group) => (
                  <span
                    key={group.uuid}
                    className="inline-flex h-6 max-w-[9rem] items-center truncate rounded-md border px-2 text-xs text-muted-foreground"
                    title={group.name}
                  >
                    {group.name}
                  </span>
                ))}
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
  const { t } = useTranslations();
  const { isAdmin, can } = useAccess();

  const applicationItems: MenuItem[] = [
    {
      title: t("navigation:exploreMcpServers"),
      path: "/search",
      icon: Search,
      capability: "mcp_servers.create" as const,
    },
    { title: t("navigation:mcpServers"), path: "/mcp-servers", icon: Server },
    {
      title: t("navigation:metamcpNamespaces"),
      path: "/namespaces",
      icon: Package,
    },
    {
      title: t("navigation:metamcpEndpoints"),
      path: "/endpoints",
      icon: LinkIcon,
    },
    {
      title: t("navigation:mcpInspector"),
      path: "/mcp-inspector",
      icon: SearchCode,
      capability: "inspector.use" as const,
    },
    { title: t("navigation:apiKeys"), path: "/api-keys", icon: Key },
    { title: t("navigation:auditLogs"), path: "/audit-logs", icon: History },
  ].filter((item) => !item.capability || can(item.capability));

  const adminItems: MenuItem[] = [
    { title: t("navigation:users"), path: "/admin/users", icon: UserCog },
    { title: t("navigation:groups"), path: "/admin/groups", icon: Users },
    { title: t("navigation:roles"), path: "/admin/roles", icon: ShieldHalf },
    { title: t("navigation:sso"), path: "/admin/sso", icon: Fingerprint },
    {
      title: t("navigation:activity"),
      path: "/admin/activity",
      icon: ScrollText,
    },
    { title: t("navigation:settings"), path: "/settings", icon: Settings },
  ];

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="flex flex-col justify-center items-center px-2 py-4">
          <div className="flex items-center justify-center w-full mb-2">
            <div className="flex items-center gap-4">
              <Image
                src="/favicon.ico"
                alt="MetaMCP Logo"
                width={256}
                height={256}
                className="h-12 w-12"
              />
              <h2 className="text-2xl font-semibold">MetaMCP</h2>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{t("navigation:application")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavItems items={applicationItems} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {isAdmin && (
            <SidebarGroup>
              <SidebarGroupLabel>
                {t("navigation:administration")}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <NavItems items={adminItems} />
                  <LiveLogsMenuItem />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
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
