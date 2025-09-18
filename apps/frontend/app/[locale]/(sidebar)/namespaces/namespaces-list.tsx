"use client";

import { Namespace } from "@repo/zod-types";
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
  Eye,
  MoreHorizontal,
  Package,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

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

export function NamespacesList() {
  const { t } = useTranslations();
  const [sorting, setSorting] = useState<SortingState>([
    {
      id: "created_at",
      desc: true,
    },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [namespaceToDelete, setNamespaceToDelete] = useState<Namespace | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // Use tRPC query for data fetching
  const {
    data: namespacesResponse,
    error,
    isLoading,
  } = trpc.frontend.namespaces.list.useQuery();

  // tRPC mutation for deleting namespace
  const deleteNamespaceMutation = trpc.frontend.namespaces.delete.useMutation({
    onSuccess: (result) => {
      // Check if the operation was actually successful
      if (result.success) {
        // Invalidate and refetch the namespace list
        utils.frontend.namespaces.list.invalidate();
        setDeleteDialogOpen(false);
        setNamespaceToDelete(null);
        toast.success(t("namespaces.namespaceDeletedSuccess"));
      } else {
        // Handle business logic failures
        console.error("Delete failed:", result.message);
        toast.error(t("namespaces.failedToDeleteNamespace"), {
          description: result.message || t("common.unexpectedError"),
        });
      }
    },
    onError: (error) => {
      console.error("Error deleting namespace:", error);
      toast.error(t("namespaces.failedToDeleteNamespace"), {
        description: error.message,
      });
    },
    onSettled: () => {
      setIsDeleting(false);
    },
  });

  const namespaces = namespacesResponse?.success ? namespacesResponse.data : [];

  // Handle delete namespace
  const handleDeleteNamespace = async (namespace: Namespace) => {
    setIsDeleting(true);
    deleteNamespaceMutation.mutate({
      uuid: namespace.uuid,
    });
  };

  // Define columns for the data table
  const columns: ColumnDef<Namespace>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("namespaces.name")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const namespace = row.original;
        return (
          <div className="px-3 py-2">
            <Link
              href={`/namespaces/${namespace.uuid}`}
              className="font-medium hover:text-blue-600 transition-colors"
            >
              {namespace.name}
            </Link>
          </div>
        );
      },
    },
    {
      accessorKey: "description",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("common.description")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const namespace = row.original;
        return (
          <div className="px-3 py-2">
            {namespace.description ? (
              <div className="text-sm text-muted-foreground">
                {namespace.description}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                {t("namespaces.noDescription")}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "user_id",
      header: t("namespaces.ownership"),
      cell: ({ row }) => {
        const namespace = row.original;
        const isPublic = namespace.user_id === null;
        return (
          <div className="py-2">
            <Badge variant={isPublic ? "success" : "neutral"}>
              {isPublic ? t("namespaces.public") : t("namespaces.private")}
            </Badge>
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
            {t("namespaces.created")}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = new Date(row.getValue("created_at"));
        return (
          <div className="px-3 py-2">
            <div className="text-sm">{date.toLocaleDateString()}</div>
            <div className="text-xs text-muted-foreground">
              {date.toLocaleTimeString()}
            </div>
          </div>
        );
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const namespace = row.original;

        const handleDeleteClick = () => {
          setNamespaceToDelete(namespace);
          setDeleteDialogOpen(true);
        };

        return (
          <div className="px-3 py-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link
                    href={`/namespaces/${namespace.uuid}`}
                    className="flex items-center cursor-pointer"
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    {t("namespaces.viewDetails")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600"
                  onClick={handleDeleteClick}
                >
                  <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                  {t("namespaces.deleteNamespace")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  // Table configuration
  const table = useReactTable({
    data: namespaces,
    columns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onGlobalFilterChange: (value) => setGlobalFilter(value || ""),
    state: {
      sorting,
      globalFilter,
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("namespaces.searchPlaceholder")}
              className="pl-8"
              disabled
            />
          </div>
        </div>

        <div className="rounded-md border">
          <div className="p-4 text-center text-muted-foreground">
            {t("namespaces.loadingNamespaces")}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("namespaces.searchPlaceholder")}
              className="pl-8"
              disabled
            />
          </div>
        </div>

        <div className="rounded-md border">
          <div className="p-4 text-center text-red-500">
            {t("namespaces.errorLoadingNamespaces")} {error.message}
          </div>
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
            placeholder={t("namespaces.searchPlaceholder")}
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
                    <TableHead key={header.id}>
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
                    <TableCell key={cell.id}>
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
                  <div className="flex flex-col items-center justify-center">
                    <Package className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">
                      {t("namespaces.noNamespaces")}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t("namespaces.createFirstNamespace")}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="text-sm text-muted-foreground">
          {t("namespaces.namespacesTotal", {
            count: table.getFilteredRowModel().rows.length,
          })}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("namespaces.deleteNamespaceTitle")}</DialogTitle>
            <DialogDescription>
              {t("namespaces.deleteNamespaceDescription", {
                name: namespaceToDelete?.name || "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setNamespaceToDelete(null);
              }}
              disabled={isDeleting}
            >
              {t("namespaces.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (namespaceToDelete) {
                  handleDeleteNamespace(namespaceToDelete);
                }
              }}
              disabled={isDeleting}
            >
              {isDeleting ? t("namespaces.deleting") : t("namespaces.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
