import { Skeleton } from "./ui/skeleton";

export function ModelsDeployedSkeleton() {
  return (
    <div className="rounded-lg border p-4">
      <Skeleton className="h-8 w-full mb-4" /> {/* Table Header */}
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center space-x-4">
            <Skeleton className="h-4 w-[15%]" /> {/* Container ID */}
            <Skeleton className="h-4 w-[20%]" /> {/* Image */}
            <Skeleton className="h-4 w-[15%]" /> {/* Status */}
            <Skeleton className="h-4 w-[15%]" /> {/* Health */}
            <Skeleton className="h-4 w-[15%]" /> {/* Ports */}
            <Skeleton className="h-4 w-[15%]" /> {/* Names */}
            <Skeleton className="h-4 w-[10%]" /> {/* Manage */}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ModelsDeployedSkeleton;
