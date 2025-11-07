"use client";

import { useState } from "react";
import { Shield, ShieldOff, Users as UsersIcon, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
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
import { trpc } from "@/lib/trpc";
import { useTranslations } from "@/hooks/useTranslations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

// Component to show OAuth clients count for a user
function UserOAuthClientsCount({ userId }: { userId: string }) {
  const { data: clientsResponse, isLoading } = trpc.frontend.oauth.getClientsByUserId.useQuery({
    userId,
  });

  if (isLoading) {
    return <span className="text-sm text-muted-foreground">...</span>;
  }

  const count = clientsResponse?.success ? clientsResponse.data.length : 0;

  return (
    <Badge variant={count > 0 ? "default" : "outline"} className="gap-1">
      <Shield className="h-3 w-3" />
      {count}
    </Badge>
  );
}

export default function UsersPage() {
  const { t } = useTranslations();
  const [page, setPage] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    userId: string;
    userName: string;
    action: "grant" | "revoke";
  }>({ open: false, userId: "", userName: "", action: "grant" });
  const [userClientsCount, setUserClientsCount] = useState<Record<string, number>>({});
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

  const handleAdminAccessChange = (userId: string, userName: string, currentIsAdmin: boolean) => {
    setConfirmDialog({
      open: true,
      userId,
      userName,
      action: currentIsAdmin ? "revoke" : "grant",
    });
  };

  const confirmAdminAccessChange = () => {
    updateAdminAccessMutation.mutate({
      userId: confirmDialog.userId,
      isAdmin: confirmDialog.action === "grant",
    });
    setConfirmDialog({ open: false, userId: "", userName: "", action: "grant" });
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
    <div className="space-y-6 p-6">
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
                        <UserOAuthClientsCount userId={user.id} />
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
                        <Button
                          variant={user.isAdmin ? "destructive" : "default"}
                          size="sm"
                          onClick={() => handleAdminAccessChange(user.id, user.name, user.isAdmin)}
                          disabled={updateAdminAccessMutation.isPending}
                        >
                          {user.isAdmin ? (
                            <>
                              <ShieldOff className="h-3 w-3 mr-1" />
                              {t("users:revokeAdminAccess")}
                            </>
                          ) : (
                            <>
                              <Shield className="h-3 w-3 mr-1" />
                              {t("users:grantAdminAccess")}
                            </>
                          )}
                        </Button>
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

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog.action === "grant"
                ? t("users:grantAdminAccess")
                : t("users:revokeAdminAccess")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === "grant"
                ? t("users:confirmGrantAdmin", { name: confirmDialog.userName })
                : t("users:confirmRevokeAdmin", { name: confirmDialog.userName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAdminAccessChange}>
              {t("common:confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
