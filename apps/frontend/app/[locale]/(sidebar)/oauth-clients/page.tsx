"use client";

import { OAuthClient } from "@repo/zod-types";
import {
  Calendar,
  CheckCircle,
  Eye,
  ExternalLink,
  Key,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Shield,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

type OAuthClientDisplay = Omit<OAuthClient, "created_at" | "updated_at"> & {
  created_at: string;
  updated_at?: string;
};

export default function OAuthClientsPage() {
  const { t } = useTranslations();
  const [searchTerm, setSearchTerm] = useState("");

  // Get all OAuth clients
  const {
    data: clientsResponse,
    isLoading,
    refetch,
  } = trpc.frontend.oauth.getAllClients.useQuery();

  const clients: OAuthClientDisplay[] = clientsResponse?.success
    ? clientsResponse.data
    : [];

  // Update admin access mutation
  const updateAdminAccessMutation =
    trpc.frontend.oauth.updateClientAdminAccess.useMutation({
      onSuccess: (data) => {
        if (data.success) {
          toast.success(t("oauth-clients:adminAccessUpdated"));
          refetch();
        } else {
          toast.error(data.message || t("oauth-clients:updateFailed"));
        }
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });

  // Delete client mutation
  const deleteClientMutation = trpc.frontend.oauth.deleteClient.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(t("oauth-clients:clientDeleted"));
        refetch();
      } else {
        toast.error(data.message || t("oauth-clients:deleteFailed"));
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Handle admin access toggle
  const handleAdminAccessToggle = (clientId: string, canAccess: boolean) => {
    updateAdminAccessMutation.mutate({
      clientId,
      canAccessAdmin: canAccess,
    });
  };

  // Handle delete client
  const handleDeleteClient = (clientId: string, clientName: string) => {
    if (
      confirm(
        t("oauth-clients:confirmDelete", {
          name: clientName,
        }),
      )
    ) {
      deleteClientMutation.mutate({ clientId });
    }
  };

  // Filter clients
  const filteredClients = clients.filter(
    (client) =>
      client.client_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.client_id.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("oauth-clients:title")}</h1>
          <p className="text-muted-foreground">
            {t("oauth-clients:description")}
          </p>
        </div>
        <Button onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          {t("common:refresh")}
        </Button>
      </div>

      {/* Stats Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              {t("oauth-clients:totalClients")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{clients.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              {t("oauth-clients:withAdminAccess")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {clients.filter((c) => c.can_access_admin).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              {t("oauth-clients:mcpClientsOnly")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {clients.filter((c) => !c.can_access_admin).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Clients Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("oauth-clients:registeredClients")}</CardTitle>
              <CardDescription>
                {t("oauth-clients:manageOAuthClients")}
              </CardDescription>
            </div>
            <div className="w-64">
              <Input
                placeholder={t("oauth-clients:searchClients")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredClients.length === 0 ? (
            <div className="text-center py-8">
              <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {searchTerm
                  ? t("oauth-clients:noClientsMatch")
                  : t("oauth-clients:noClients")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {searchTerm
                  ? t("oauth-clients:tryDifferentSearch")
                  : t("oauth-clients:clientsWillAppear")}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("oauth-clients:clientName")}</TableHead>
                  <TableHead>{t("oauth-clients:email")}</TableHead>
                  <TableHead>{t("oauth-clients:clientId")}</TableHead>
                  <TableHead>{t("oauth-clients:adminAccess")}</TableHead>
                  <TableHead>{t("oauth-clients:grantTypes")}</TableHead>
                  <TableHead>{t("oauth-clients:created")}</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client) => (
                  <TableRow key={client.client_id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-blue-500" />
                        <span>{client.client_name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {client.email ? (
                        <div className="flex items-center gap-2">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{client.email}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground italic">
                          {t("oauth-clients:noEmail")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Key className="h-3 w-3 text-muted-foreground" />
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {client.client_id}
                        </code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={client.can_access_admin}
                          onCheckedChange={(checked) =>
                            handleAdminAccessToggle(client.client_id, checked)
                          }
                          disabled={updateAdminAccessMutation.isPending}
                        />
                        {client.can_access_admin ? (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle className="h-3 w-3" />
                            {t("oauth-clients:enabled")}
                          </Badge>
                        ) : (
                          <Badge variant="neutral" className="gap-1">
                            <XCircle className="h-3 w-3" />
                            {t("oauth-clients:disabled")}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {client.grant_types.map((gt) => (
                          <Badge key={gt} variant="outline" className="text-xs">
                            {gt}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {formatDate(client.created_at)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <a
                              href={`/oauth-clients/${client.client_id}/logs`}
                              className="flex items-center"
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              {t("oauth-clients:viewLogs")}
                            </a>
                          </DropdownMenuItem>
                          {client.client_uri && (
                            <DropdownMenuItem asChild>
                              <a
                                href={client.client_uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center"
                              >
                                <ExternalLink className="mr-2 h-4 w-4" />
                                {t("oauth-clients:visitWebsite")}
                              </a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() =>
                              handleDeleteClient(
                                client.client_id,
                                client.client_name,
                              )
                            }
                            className="text-destructive"
                            disabled={deleteClientMutation.isPending}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("oauth-clients:delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
