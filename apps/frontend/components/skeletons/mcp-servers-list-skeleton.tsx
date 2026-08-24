import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function McpServersListSkeleton() {
  return (
    <div className="space-y-4">
      {/* Search bar skeleton */}
      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Skeleton className="h-9 w-full" />
        </div>
      </div>

      {/* Table skeleton */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Skeleton className="h-5 w-16" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-5 w-12" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-5 w-14" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-5 w-24" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-5 w-16" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-5 w-16" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, index) => (
              <TableRow key={index}>
                {/* Name column */}
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-5 w-32" />
                </TableCell>
                {/* Type column */}
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-6 w-16 rounded-md" />
                </TableCell>
                {/* Status column */}
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-6 w-10 rounded-full" />
                </TableCell>
                {/* Configuration column */}
                <TableCell className="px-3 py-2">
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </TableCell>
                {/* Created column */}
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                {/* Actions column */}
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-8 w-8 rounded" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Footer skeleton */}
      <div className="flex items-center justify-end space-x-2 py-4">
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}
