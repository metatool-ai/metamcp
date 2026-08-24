import { Skeleton } from "@/components/ui/skeleton";

export function InspectorSkeleton() {
  return (
    <div className="space-y-4">
      {/* Tab navigation */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>

      {/* Content areas */}
      <div className="space-y-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>

      {/* Status message */}
      <div className="flex justify-center">
        <Skeleton className="h-4 w-56" />
      </div>
    </div>
  );
}
