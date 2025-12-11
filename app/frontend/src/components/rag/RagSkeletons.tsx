// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { Skeleton } from "@/src/components/ui/skeleton";
import { Card } from "@/src/components/ui/card";
import { useTheme } from "@/src/hooks/useTheme";
import { ScrollArea, ScrollBar } from "@/src/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";

// Simplified Skeleton for the RagManagement component
export function RagManagementSkeleton() {
  const { theme } = useTheme();

  return (
    <div className="h-screen flex-1 w-full dark:bg-black bg-white dark:bg-dot-white/[0.2] bg-dot-black/[0.2] relative flex items-center justify-center">
      <div
        className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
        style={{
          maskImage:
            "radial-gradient(ellipse at center, transparent 20%, black 100%)",
        }}
      ></div>
      <div className="flex flex-col h-screen w-full px-4 md:px-20 pt-8 md:pt-8 pb-16 md:pb-28 overflow-hidden mt-8">
        <Card
          className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg overflow-hidden mt-8 md:mt-0`}
        >
          <ScrollArea className="whitespace-nowrap rounded-md border w-full max-w-full p-2 sm:p-0">
            {/* Form skeleton */}
            <div className="p-4 border-b">
              <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2 mb-4">
                <Skeleton className="h-10 w-full md:w-2/3" />
                <Skeleton className="h-10 w-full md:w-1/3" />
              </div>
            </div>

            {/* Simple table skeleton */}
            <div className="overflow-x-auto">
              <Table className="w-full">
                <TableCaption>
                  <Skeleton className="h-8 w-64 mx-auto" />
                </TableCaption>
                <TableHeader>
                  <TableRow
                    className={theme === "dark" ? "bg-zinc-900" : "bg-zinc-200"}
                  >
                    <TableHead className="w-8 p-2">
                      {/* Empty for expansion button */}
                    </TableHead>
                    <TableHead className="text-left">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4 rounded-full" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                    </TableHead>
                    <TableHead className="text-left hidden sm:table-cell">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4 rounded-full" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Skeleton className="h-4 w-4 rounded-full" />
                        <Skeleton className="h-4 w-16 hidden sm:inline-block" />
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="animate-pulse">
                  {/* Simple rows without expansions */}
                  {[...Array(7)].map((_, i) => (
                    <TableRow
                      key={`row-${i}`}
                      className="hover:bg-gray-50 dark:hover:bg-zinc-800"
                    >
                      <TableCell className="w-8 p-2">
                        <Skeleton className="h-6 w-6 rounded-md" />
                      </TableCell>
                      <TableCell className="font-medium text-left">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-4 w-4 rounded-full" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-xs sm:hidden">
                          <Skeleton className="h-3 w-3 rounded-full" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </TableCell>
                      <TableCell className="text-left hidden sm:table-cell">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-4 w-4 rounded-full" />
                          <Skeleton className="h-4 w-40" />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap gap-1 justify-end">
                          <Skeleton className="h-8 w-[60px] sm:w-[80px] rounded-lg" />
                          <Skeleton className="h-8 w-[60px] sm:w-[80px] rounded-lg" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}

// Skeleton for RagAdmin login form
export function RagAdminLoginSkeleton() {
  const { theme } = useTheme();

  return (
    <Card
      className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg p-6 max-w-md mx-auto`}
    >
      <div className="flex items-center justify-center mb-6">
        <Skeleton className="h-8 w-8 mr-2 rounded-full" />
        <Skeleton className="h-8 w-56" />
      </div>

      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </Card>
  );
}

// Skeleton for the RagAdmin component - using actual Table components for consistency
export function RagAdminSkeleton() {
  const { theme } = useTheme();

  return (
    <Card
      className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg p-6 w-full mx-auto`}
    >
      {/* Header skeleton */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center">
          <Skeleton className="h-8 w-8 mr-2 rounded-full" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* Table skeleton with ScrollArea */}
      <ScrollArea className="whitespace-nowrap rounded-md border">
        <Table className="w-full">
          <TableCaption>
            <Skeleton className="h-8 w-48 mx-auto" />
          </TableCaption>
          <TableHeader>
            <TableRow
              className={theme === "dark" ? "bg-zinc-900" : "bg-zinc-200"}
            >
              <TableHead className="text-left">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-8" />
                </div>
              </TableHead>
              <TableHead className="text-left">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </TableHead>
              <TableHead className="text-left">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </TableHead>
              <TableHead className="text-left">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </TableHead>
              <TableHead className="text-left">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </TableHead>
              <TableHead className="text-left">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-28" />
                </div>
              </TableHead>
              <TableHead className="text-left">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="animate-pulse">
            {[...Array(6)].map((_, i) => (
              <TableRow key={`admin-row-${i}`}>
                <TableCell className="text-left">
                  <Skeleton className="h-5 w-32" />
                </TableCell>
                <TableCell className="text-left">
                  <Skeleton className="h-5 w-32" />
                </TableCell>
                <TableCell className="text-left">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                </TableCell>
                <TableCell className="text-left">
                  <Skeleton className="h-5 w-28" />
                </TableCell>
                <TableCell className="text-left">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-5 w-36" />
                  </div>
                </TableCell>
                <TableCell className="text-left">
                  <Skeleton className="h-5 w-24" />
                </TableCell>
                <TableCell className="text-left">
                  <Skeleton className="h-8 w-24 rounded-md" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </Card>
  );
}
