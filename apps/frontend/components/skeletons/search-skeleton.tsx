import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SearchSkeleton() {
  return (
    <div className="container mx-auto py-8 space-y-6 flex flex-col items-center">
      {/* Title skeleton */}
      <Skeleton className="h-8 w-80" />

      {/* Search input skeleton */}
      <Skeleton className="h-10 max-w-xl w-full mx-auto" />

      {/* Card grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="flex flex-col">
            <CardHeader>
              {/* Title and stars */}
              <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-40" />
                <div className="flex items-center gap-1">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 w-8" />
                </div>
              </div>
              {/* Description */}
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardHeader>

            <CardContent className="flex-grow space-y-3">
              {/* Package */}
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-32" />
              </div>

              {/* Command */}
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-6 w-40 rounded" />
              </div>

              {/* Args */}
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-6 w-36 rounded" />
              </div>

              {/* Environment Variables */}
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <div className="flex flex-wrap gap-1">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              </div>

              {/* Registry */}
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>

              {/* Downloads */}
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            </CardContent>

            <CardFooter className="flex gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-24" />
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* Pagination skeleton */}
      <div className="flex items-center justify-center space-x-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-8" />
        <Skeleton className="h-9 w-8" />
        <Skeleton className="h-9 w-8" />
        <Skeleton className="h-9 w-20" />
      </div>
    </div>
  );
}
