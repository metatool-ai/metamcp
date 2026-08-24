import { Skeleton } from "@/components/ui/skeleton";

export function ServerDetailsSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Basic Information */}
      <div className="rounded-lg border p-6">
        <Skeleton className="h-6 w-32 mb-4" />
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-6 w-16" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className="rounded-lg border p-6">
        <Skeleton className="h-6 w-24 mb-4" />
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-32" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-8 w-40" />
          </div>
        </div>
      </div>

      {/* Environment Variables */}
      <div className="rounded-lg border p-6 md:col-span-2">
        <Skeleton className="h-6 w-40 mb-4" />
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}
