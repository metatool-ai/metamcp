"use client";

import { McpServerTypeEnum, NamespaceServer } from "@repo/zod-types";
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
  ExternalLink,
  Eye,
  FileText,
  MoreHorizontal,
  Search,
  Server,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

interface NamespaceServersTableProps {
  servers: NamespaceServer[];
  namespaceUuid: string;
}

export function NamespaceServersTable({
  servers,
  namespaceUuid,
}: NamespaceServersTableProps) {
  const router = useRouter();
  const { t } = useTranslations();
  const [sorting, setSorting] = useState<SortingState>([
    {
      id: "name",
      desc: false,
    },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  // TRPC utils for invalidating queries
  const utils = trpc.useUtils();

  // TRPC mutation for updating server status
  const updateServerStatusMutation =
    trpc.frontend.namespaces.updateServerStatus.useMutation({
      onSuccess: (data) => {
        toast.success(t("namespaces:serversTable.serverStatusUpdated"), {
          description:
            data.message ||
            t("namespaces:serversTable.serverStatusUpdatedDescription"),
        });
        // Use setData to update the cache directly instead of invalidating
        // This preserves the current sort order and table state
        utils.frontend.namespaces.get.setData(
          { uuid: namespaceUuid },
          (oldData) => {
            if (!oldData?.success || !oldData.data) return oldData;
            return {
              ...oldData,
              data: {
                ...oldData.data,
                servers: oldData.data.servers.map((server) =>
                  server.uuid ===
                  updateServerStatusMutation.variables?.serverUuid
                    ? {
                        ...server,
                        status: updateServerStatusMutation.variables?.status as
                          | "ACTIVE"
                          | "INACTIVE",
                      }
                    : server,
                ),
              },
            };
          },
        );
      },
      onError: (error) => {
        toast.error(t("namespaces:serversTable.failedToUpdateServerStatus"), {
          description: error.message || t("common:unexpectedError"),
        });
        // Revert the optimistic update on error
        utils.frontend.namespaces.get.invalidate({ uuid: namespaceUuid });
      },
    });

  const handleStatusToggle = (serverUuid: string, currentStatus: string) => {
    const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    // Optimistic update: immediately update the UI
    utils.frontend.namespaces.get.setData(
      { uuid: namespaceUuid },
      (oldData) => {
        if (!oldData?.success || !oldData.data) return oldData;
        return {
          ...oldData,
          data: {
            ...oldData.data,
            servers: oldData.data.servers.map((server) =>
              server.uuid === serverUuid
                ? { ...server, status: newStatus as "ACTIVE" | "INACTIVE" }
                : server,
            ),
          },
        };
      },
    );

    // Then make the API call
    updateServerStatusMutation.mutate({
      namespaceUuid,
      serverUuid,
      status: newStatus,
    });
  };

  // Define columns for the data table
  const columns: ColumnDef<NamespaceServer>[] = [
    {
      accessorKey: "name",
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
            <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
              {type.toUpperCase()}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("common:status")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const server = row.original;
        const isActive = server.status === "ACTIVE";
        const isUpdating = updateServerStatusMutation.isPending;

        return (
          <div className="px-3 py-2">
            <div className="flex items-center space-x-2">
              <Switch
                checked={isActive}
                onCheckedChange={() =>
                  handleStatusToggle(server.uuid, server.status)
                }
                disabled={isUpdating}
                aria-label={t("namespaces:serversTable.toggleStatus", {
                  name: server.name,
                })}
              />
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "details",
      header: t("namespaces:serversTable.configuration"),
      cell: ({ row }) => {
        const server = row.original;
        const details = [];

        if (server.command) {
          details.push(
            `${t("namespaces:serversTable.command")}: ${server.command}`,
          );
        }
        if (server.args.length > 0) {
          details.push(
            `${t("namespaces:serversTable.args")}: ${server.args.join(" ")}`,
          );
        }
        if (server.url) {
          details.push(`${t("namespaces:serversTable.url")}: ${server.url}`);
        }
        if (Object.keys(server.env).length > 0) {
          details.push(
            `${t("namespaces:serversTable.env")}: ${t("namespaces:serversTable.envVars", { count: Object.keys(server.env).length })}`,
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
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("common:created")}
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
      header: t("common:actions"),
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

        const handleViewDetails = () => {
          router.push(`/mcp-servers/${server.uuid}`);
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
                {t("namespaces:serversTable.copyServerUuid")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyServerJson}>
                <FileText className="mr-2 h-4 w-4" />
                {t("namespaces:serversTable.copyServerJson")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleViewDetails}>
                <Eye className="mr-2 h-4 w-4" />
                {t("namespaces:serversTable.viewDetails")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href={`/mcp-servers/${server.uuid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t("namespaces:serversTable.openInNewTab")}
                </Link>
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
    // Maintain sorting stability
    manualSorting: false,
    enableSorting: true,
  });

  if (servers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <div className="flex flex-col items-center justify-center mx-auto max-w-md">
          <Server className="size-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">
            {t("namespaces:serversTable.noServers")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("namespaces:serversTable.noServersDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("namespaces:serversTable.searchServers")}
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
                  {t("common:noData")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="text-sm text-muted-foreground">
          {t("namespaces:serversTable.serversTotal", {
            count: table.getFilteredRowModel().rows.length,
          })}
        </div>
      </div>
    </div>
  );
}
