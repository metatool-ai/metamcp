import { Skeleton } from "@/components/ui/skeleton";

export function ToolManagementSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header with search/filter controls */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>

      {/* Tool list items */}
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>

      {/* Status message */}
      <div className="flex justify-center">
        <Skeleton className="h-4 w-48" />
      </div>
    </div>
  );
}
