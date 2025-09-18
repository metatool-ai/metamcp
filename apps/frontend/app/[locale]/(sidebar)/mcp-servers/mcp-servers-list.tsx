"use client";

import {
  McpServer,
  McpServerErrorStatusEnum,
  McpServerTypeEnum,
} from "@repo/zod-types";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  Copy,
  Edit,
  Eye,
  FileText,
  MoreHorizontal,
  Search,
  SearchCode,
  Server,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EditMcpServer } from "@/components/edit-mcp-server";
import { McpServersListSkeleton } from "@/components/skeletons/mcp-servers-list-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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

interface McpServersListProps {
  onRefresh?: () => void;
}

export function McpServersList({ onRefresh }: McpServersListProps) {
  const { t } = useTranslations();
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([
    {
      id: "created_at",
      desc: true,
    },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<McpServer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [serverToEdit, setServerToEdit] = useState<McpServer | null>(null);

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // Use tRPC query for data fetching
  const {
    data: serversResponse,
    error,
    isLoading,
    refetch,
  } = trpc.frontend.mcpServers.list.useQuery();

  // tRPC mutation for deleting server
  const deleteServerMutation = trpc.frontend.mcpServers.delete.useMutation({
    onSuccess: (result) => {
      // Check if the operation was actually successful
      if (result.success) {
        // Invalidate and refetch the server list
        utils.frontend.mcpServers.list.invalidate();
        setDeleteDialogOpen(false);
        setServerToDelete(null);
        toast.success(t("mcp-servers:list.deleteServerSuccess"));
      } else {
        // Handle business logic failures
        console.error("Delete failed:", result.message);
        toast.error(t("mcp-servers:list.deleteServerError"), {
          description:
            result.message || t("mcp-servers:list.deleteServerError"),
        });
      }
    },
    onError: (error) => {
      console.error("Error deleting server:", error);
      toast.error(t("mcp-servers:list.deleteServerError"), {
        description: error.message,
      });
    },
    onSettled: () => {
      setIsDeleting(false);
    },
  });

  const servers = serversResponse?.success ? serversResponse.data : [];

  // Handle delete server
  const handleDeleteServer = async (server: McpServer) => {
    setIsDeleting(true);
    deleteServerMutation.mutate({
      uuid: server.uuid,
    });
  };

  // Handle successful edit
  const handleEditSuccess = () => {
    // Invalidate and refetch the server list
    utils.frontend.mcpServers.list.invalidate();
    setEditDialogOpen(false);
    setServerToEdit(null);
  };

  // Define columns for the data table
  const columns: ColumnDef<McpServer>[] = [
    {
      accessorKey: "name",
      size: 200,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("common:name")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const server = row.original;
        return (
          <div className="space-y-1 px-3 py-2">
            <div
              className="font-medium cursor-pointer hover:bg-muted/50 hover:text-primary rounded px-2 py-1 -mx-2 -my-1 transition-colors"
              onClick={() => router.push(`/mcp-servers/${server.uuid}`)}
            >
              {server.name}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "type",
      size: 120,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("common:type")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const type = row.getValue("type") as string;
        return (
          <div className="px-3 py-2">
            <Badge variant="info">{type.toUpperCase()}</Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "error_status",
      size: 120,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("mcp-servers:list.errorStatus")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const errorStatus = row.getValue("error_status") as string;
        const hasError = errorStatus === McpServerErrorStatusEnum.Enum.ERROR;
        return (
          <div className="px-3 py-2">
            <Badge variant={hasError ? "destructive" : "success"}>
              {hasError
                ? t("mcp-servers:list.error")
                : t("mcp-servers:list.noError")}
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "user_id",
      size: 120,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("mcp-servers:list.ownership")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const server = row.original;
        const isPublic = server.user_id === null;
        return (
          <div className="px-3 py-2">
            <Badge variant={isPublic ? "success" : "neutral"}>
              {isPublic ? t("mcp-servers:public") : t("mcp-servers:private")}
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "details",
      header: t("mcp-servers:list.configuration"),
      cell: ({ row }) => {
        const server = row.original;
        const details = [];

        if (server.command) {
          details.push(
            t("mcp-servers:list.command", { command: server.command }),
          );
        }
        if (server.args.length > 0) {
          details.push(
            t("mcp-servers:list.args", { args: server.args.join(" ") }),
          );
        }
        if (server.url) {
          details.push(t("mcp-servers:list.url", { url: server.url }));
        }
        if (Object.keys(server.env).length > 0) {
          details.push(
            t("mcp-servers:list.envVars", {
              count: Object.keys(server.env).length,
            }),
          );
        }

        return (
          <div className="text-sm space-y-1 w-full">
            {details.map((detail, index) => (
              <div
                key={index}
                className="text-muted-foreground break-words whitespace-normal overflow-wrap-anywhere"
              >
                {detail}
              </div>
            ))}
          </div>
        );
      },
    },
    {
      accessorKey: "created_at",
      size: 180,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("mcp-servers:list.created")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = new Date(row.getValue("created_at"));
        return (
          <div className="text-sm text-muted-foreground px-3 py-2">
            {date.toLocaleDateString()} {date.toLocaleTimeString()}
          </div>
        );
      },
    },
    {
      id: "actions",
      size: 100,
      header: t("mcp-servers:list.actions"),
      cell: ({ row }) => {
        const server = row.original;

        const copyServerJson = () => {
          const config: Record<string, unknown> = {
            type: server.type,
          };

          if (server.description) {
            config.description = server.description;
          }

          if (server.type === McpServerTypeEnum.Enum.STDIO) {
            if (server.command) {
              config.command = server.command;
            }
            if (server.args && server.args.length > 0) {
              config.args = server.args;
            }
            if (server.env && Object.keys(server.env).length > 0) {
              config.env = server.env;
            }
          } else if (
            server.type === McpServerTypeEnum.Enum.SSE ||
            server.type === McpServerTypeEnum.Enum.STREAMABLE_HTTP
          ) {
            if (server.url) {
              config.url = server.url;
            }
            if (server.bearerToken) {
              config.bearerToken = server.bearerToken;
            }
          }

          const exportFormat = {
            mcpServers: {
              [server.name]: config,
            },
          };

          const serverJson = JSON.stringify(exportFormat, null, 2);
          navigator.clipboard.writeText(serverJson);
        };

        const handleInspect = () => {
          router.push(
            `/mcp-inspector?server=${encodeURIComponent(server.uuid)}`,
          );
        };

        const handleViewDetails = () => {
          router.push(`/mcp-servers/${server.uuid}`);
        };

        const handleDeleteClick = () => {
          setServerToDelete(server);
          setDeleteDialogOpen(true);
        };

        const handleEditClick = () => {
          setServerToEdit(server);
          setEditDialogOpen(true);
        };

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => navigator.clipboard.writeText(server.uuid)}
              >
                <Copy className="mr-2 h-4 w-4" />
                {t("mcp-servers:list.copyServerUuid")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyServerJson}>
                <FileText className="mr-2 h-4 w-4" />
                {t("mcp-servers:list.copyServerJson")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleInspect}>
                <SearchCode className="mr-2 h-4 w-4" />
                {t("mcp-servers:list.inspect")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleViewDetails}>
                <Eye className="mr-2 h-4 w-4" />
                {t("mcp-servers:list.viewDetails")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleEditClick}>
                <Edit className="mr-2 h-4 w-4" />
                {t("mcp-servers:editServer")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600"
                onClick={handleDeleteClick}
              >
                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                {t("mcp-servers:deleteServer")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const table = useReactTable({
    data: servers,
    columns,
    onSortingChange: setSorting,
    onGlobalFilterChange: (value) => setGlobalFilter(value || ""),
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.uuid,
    state: {
      sorting,
      globalFilter,
    },
  });

  // Expose mutate function for parent component
  const handleRefresh = () => {
    refetch();
    onRefresh?.();
  };

  if (error) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <div className="flex flex-col items-center justify-center mx-auto max-w-md">
          <Server className="size-12 text-red-400" />
          <h3 className="mt-4 text-lg font-semibold">
            {t("mcp-servers:list.errorLoadingTitle")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {error.message || t("mcp-servers:list.errorLoadingDescription")}
          </p>
          <Button onClick={handleRefresh} className="mt-4" variant="outline">
            {t("mcp-servers:list.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <McpServersListSkeleton />;
  }

  if (servers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <div className="flex flex-col items-center justify-center mx-auto max-w-md">
          <Server className="size-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">
            {t("mcp-servers:list.noServersTitle")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("mcp-servers:list.noServersDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Edit Server Dialog */}
      <EditMcpServer
        server={serverToEdit}
        isOpen={editDialogOpen}
        onClose={() => {
          setEditDialogOpen(false);
          setServerToEdit(null);
        }}
        onSuccess={handleEditSuccess}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("mcp-servers:list.deleteConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("mcp-servers:list.deleteConfirmDescription", {
                name: serverToDelete?.name || "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setServerToDelete(null);
              }}
              disabled={isDeleting}
            >
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                serverToDelete && handleDeleteServer(serverToDelete)
              }
              disabled={isDeleting}
            >
              {isDeleting
                ? t("mcp-servers:list.deleting")
                : t("mcp-servers:deleteServer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("mcp-servers:list.searchPlaceholder")}
              value={globalFilter || ""}
              onChange={(event) => setGlobalFilter(event.target.value || "")}
              className="pl-8"
            />
          </div>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead
                        key={header.id}
                        className={
                          header.column.id === "details"
                            ? "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-normal w-full [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
                            : undefined
                        }
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={
                          cell.column.id === "details"
                            ? "p-2 align-middle whitespace-normal w-full [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
                            : undefined
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    {t("mcp-servers:list.noResults")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-end space-x-2 py-4">
          <div className="text-sm text-muted-foreground">
            {t("mcp-servers:list.totalServers", {
              count: table.getFilteredRowModel().rows.length,
            })}
          </div>
        </div>
      </div>
    </>
  );
}
