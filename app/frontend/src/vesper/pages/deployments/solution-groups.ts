// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { DeploymentItem, DeploymentState } from "@/src/vesper/types";

/** A set of deployments started together as one solution (e.g. the voice agent). */
export interface SolutionGroup {
  id: string;
  name: string;
  createdAt: number;
  members: { modelId: string; modelName: string; jobId: string }[];
}

const STORAGE_KEY = "vesper-solution-groups";
const listeners = new Set<() => void>();
let groups: SolutionGroup[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
})();

function setGroups(next: SolutionGroup[]) {
  groups = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: groups only last for this page load
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const SOLUTION_KEY_PREFIX = "solution:";

// the state a group shows: its most urgent member's
const STATE_PRIORITY: DeploymentState[] = [
  "error",
  "deploy-failed",
  "download-failed",
  "downloading",
  "deploying",
  "active",
];

function memberItems(group: SolutionGroup, items: DeploymentItem[]) {
  return group.members
    .map((member) =>
      items.find(
        (item) =>
          item.jobId === member.jobId ||
          item.key === member.jobId ||
          (item.containerId &&
            item.modelName === member.modelName &&
            (item.startedAt ?? Infinity) >= group.createdAt - 60_000)
      )
    )
    .filter((item): item is DeploymentItem => !!item);
}

/**
 * Solution groups, and the deployment list with each group's members folded
 * into one combined item. A group is forgotten once none of its deployments
 * are left, which can't be told while the list is `loading`.
 */
export function useSolutionGroups(items: DeploymentItem[], loading: boolean) {
  const all = useSyncExternalStore(subscribe, () => groups);

  const addGroup = useCallback((group: SolutionGroup) => {
    setGroups([...groups.filter((g) => g.id !== group.id), group]);
  }, []);

  const removeGroup = useCallback((id: string) => {
    setGroups(groups.filter((g) => g.id !== id));
  }, []);

  const { groupedItems, staleGroupIds } = useMemo(() => {
    const consumed = new Set<string>();
    const combined: DeploymentItem[] = [];
    const stale: string[] = [];
    for (const group of all) {
      const members = memberItems(group, items);
      if (members.length === 0) {
        stale.push(group.id);
        continue;
      }
      members.forEach((m) => consumed.add(m.key));
      const state =
        STATE_PRIORITY.find((s) => members.some((m) => m.state === s)) ??
        "active";
      const progressValues = members
        .filter((m) => m.state === "downloading" || m.state === "deploying")
        .map((m) => m.progress ?? 0);
      combined.push({
        key: `${SOLUTION_KEY_PREFIX}${group.id}`,
        state,
        modelName: group.name,
        deviceIds: [...new Set(members.flatMap((m) => m.deviceIds))].sort(
          (a, b) => a - b
        ),
        progress:
          progressValues.length > 0
            ? Math.round(
                progressValues.reduce((sum, p) => sum + p, 0) /
                  progressValues.length
              )
            : null,
        stageLabel: members.find((m) => m.state === state)?.stageLabel,
        startedAt: group.createdAt,
        members,
      });
    }
    const rest = items.filter((item) => !consumed.has(item.key));
    return {
      groupedItems: [...combined, ...rest].sort(
        (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)
      ),
      staleGroupIds: stale,
    };
  }, [all, items]);

  // forget groups whose deployments are all gone; while the list loads, its
  // members may just not be in it yet (and a reload would forget every group)
  useEffect(() => {
    if (!loading && staleGroupIds.length > 0) {
      setGroups(groups.filter((g) => !staleGroupIds.includes(g.id)));
    }
  }, [staleGroupIds, loading]);

  return { groupedItems, addGroup, removeGroup };
}
