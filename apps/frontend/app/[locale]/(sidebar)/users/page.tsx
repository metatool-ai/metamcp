"use client";

import { useState } from "react";
import { Shield, ShieldOff, Users as UsersIcon, CheckCircle2, XCircle, ExternalLink, Trash2, Key, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { useTranslations } from "@/hooks/useTranslations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// Component to show OAuth clients count for a user
function UserOAuthClientsCount({ userId, onClick }: { userId: string; onClick: () => void }) {
  const { data: clientsResponse, isLoading } = trpc.frontend.oauth.getClientsByUserId.useQuery({
    userId,
  });

  if (isLoading) {
    return <span className="text-sm text-muted-foreground">...</span>;
  }

  const count = clientsResponse?.success ? clientsResponse.data.length : 0;

  return (
    <Badge
      variant={count > 0 ? "default" : "outline"}
      className="gap-1 cursor-pointer hover:opacity-80 transition-opacity"
      onClick={onClick}
    >
      <Shield className="h-3 w-3" />
      {count}
    </Badge>
  );
}

export default function UsersPage() {
  const { t } = useTranslations();
  const [page, setPage] = useState(0);
  const [oauthClientsDialog, setOauthClientsDialog] = useState<{
    open: boolean;
    userId: string;
    userName: string;
  }>({ open: false, userId: "", userName: "" });
  const pageSize = 50;

  const { data: usersResponse, isLoading, refetch } = trpc.frontend.users.getAllUsers.useQuery({
    limit: pageSize,
    offset: page * pageSize,
  });

  const updateAdminAccessMutation = trpc.frontend.users.updateUserAdminAccess.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        refetch();
      } else {
        toast.error(data.message || t("users:failedToUpdateAccess"));
      }
    },
    onError: () => {
      toast.error(t("users:failedToUpdateAccess"));
    },
  });

  const deleteOAuthClientMutation = trpc.frontend.oauth.deleteClient.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(t("oauth-clients:clientDeleted"));
      } else {
        toast.error(data.message || t("oauth-clients:deleteFailed"));
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleAdminAccessToggle = (userId: string, isAdmin: boolean) => {
    updateAdminAccessMutation.mutate({
      userId,
      isAdmin,
    });
  };

  const handleShowOAuthClients = (userId: string, userName: string) => {
    setOauthClientsDialog({ open: true, userId, userName });
  };

  const handleDeleteOAuthClient = (clientId: string, clientName: string) => {
    if (confirm(t("oauth-clients:confirmDelete", { name: clientName }))) {
      deleteOAuthClientMutation.mutate({ clientId });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t("users:loadingUsers")}</div>
      </div>
    );
  }

  const users = usersResponse?.data || [];
  const total = usersResponse?.total || 0;
  const adminCount = users.filter((u) => u.isAdmin).length;
  const regularCount = users.filter((u) => !u.isAdmin).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">{t("users:userManagement")}</h1>
        <p className="text-muted-foreground">{t("users:manageUsersDescription")}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("users:totalUsers")}</CardTitle>
            <UsersIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("users:adminUsers")}</CardTitle>
            <Shield className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{adminCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("users:regularUsers")}</CardTitle>
            <UsersIcon className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">{regularCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("users:allUsers")}</CardTitle>
          <CardDescription>
            {t("common:pagination.showing")} {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} {t("common:pagination.of")} {total}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">{t("users:noUsers")}</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("users:name")}</TableHead>
                    <TableHead>{t("users:email")}</TableHead>
                    <TableHead>{t("users:role")}</TableHead>
                    <TableHead>{t("users:oauthClients")}</TableHead>
                    <TableHead>{t("users:emailVerified")}</TableHead>
                    <TableHead>{t("users:createdAt")}</TableHead>
                    <TableHead>{t("users:actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        {user.isAdmin ? (
                          <Badge className="bg-green-500">
                            <Shield className="h-3 w-3 mr-1" />
                            {t("users:admin")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{t("users:user")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <UserOAuthClientsCount
                          userId={user.id}
                          onClick={() => handleShowOAuthClients(user.id, user.name)}
                        />
                      </TableCell>
                      <TableCell>
                        {user.emailVerified ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={user.isAdmin}
                            onCheckedChange={(checked) =>
                              handleAdminAccessToggle(user.id, checked)
                            }
                            disabled={updateAdminAccessMutation.isPending}
                          />
                          {user.isAdmin ? (
                            <Badge className="bg-green-500 gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              {t("users:admin")}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <XCircle className="h-3 w-3" />
                              {t("users:user")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {total > pageSize && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    {t("common:pagination.showing")} {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} {t("common:pagination.of")} {total}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                    >
                      {t("common:pagination.previous")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page + 1)}
                      disabled={(page + 1) * pageSize >= total}
                    >
                      {t("common:pagination.next")}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* OAuth Clients Dialog */}
      <OAuthClientsDialog
        open={oauthClientsDialog.open}
        userId={oauthClientsDialog.userId}
        userName={oauthClientsDialog.userName}
        onOpenChange={(open) => setOauthClientsDialog({ ...oauthClientsDialog, open })}
        onDeleteClient={handleDeleteOAuthClient}
      />
    </div>
  );
}

// Component to display OAuth clients in a dialog
function OAuthClientsDialog({
  open,
  userId,
  userName,
  onOpenChange,
  onDeleteClient,
}: {
  open: boolean;
  userId: string;
  userName: string;
  onOpenChange: (open: boolean) => void;
  onDeleteClient: (clientId: string, clientName: string) => void;
}) {
  const { t } = useTranslations();
  const { data: clientsResponse, isLoading } = trpc.frontend.oauth.getClientsByUserId.useQuery(
    { userId },
    { enabled: open }
  );

  const clients = clientsResponse?.success ? clientsResponse.data : [];

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("users:oauthClientsFor", { name: userName })}</DialogTitle>
          <DialogDescription>
            {t("users:manageOAuthClientsDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">{t("common:loading")}</div>
            </div>
          ) : clients.length === 0 ? (
            <div className="text-center py-8">
              <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">
                {t("oauth-clients:noClients")}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("oauth-clients:clientName")}</TableHead>
                  <TableHead>{t("oauth-clients:clientId")}</TableHead>
                  <TableHead>{t("oauth-clients:created")}</TableHead>
                  <TableHead className="w-[60px]">{t("users:actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.client_id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-blue-500" />
                        <span>{client.client_name}</span>
                      </div>
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
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {formatDate(client.created_at)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeleteClient(client.client_id, client.client_name)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
