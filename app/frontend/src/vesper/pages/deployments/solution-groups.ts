// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { DeploymentItem, DeploymentState } from "@/src/vesper/types";

/** A set of deployments started together as one solution (e.g. the voice agent). */
export interface SolutionGroup {
  id: string;
  name: string;
  createdAt: number;
  members: {
    modelId: string;
    modelName: string;
    jobId: string;
    /** The member's container, once its deploy job has led to one */
    containerId?: string;
  }[];
}

type SolutionMember = SolutionGroup["members"][number];

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

/**
 * The deployment a group member is, if it's in the list: the container it was
 * bound to; else whatever its deploy job is; else, for a container whose job
 * is long gone (e.g. after a reload), one of the same model that is known to
 * have started along with the group.
 */
function findMember(
  group: SolutionGroup,
  member: SolutionMember,
  items: DeploymentItem[]
) {
  if (member.containerId) {
    // only ever that container, so a later deploy of the same model can't
    // take its place once it's gone
    return items.find((item) => item.containerId === member.containerId);
  }
  return items.find(
    (item) =>
      item.jobId === member.jobId ||
      item.key === member.jobId ||
      (!!item.containerId &&
        item.modelName === member.modelName &&
        // an unknown start (e.g. no history record) could be any deployment
        item.startedAt !== undefined &&
        item.startedAt >= group.createdAt - 60_000)
  );
}

function memberItems(group: SolutionGroup, items: DeploymentItem[]) {
  return group.members
    .map((member) => findMember(group, member, items))
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

  // Bind each member to its container while its deploy job still links the
  // two, so it's matched exactly from then on rather than by model name.
  useEffect(() => {
    if (loading) return;
    let changed = false;
    const next = all.map((group) => {
      let groupChanged = false;
      const members = group.members.map((member) => {
        if (member.containerId) return member;
        const containerId = findMember(group, member, items)?.containerId;
        if (!containerId) return member;
        groupChanged = true;
        return { ...member, containerId };
      });
      if (!groupChanged) return group;
      changed = true;
      return { ...group, members };
    });
    if (changed) setGroups(next);
  }, [all, items, loading]);

  // forget groups whose deployments are all gone; while the list loads, its
  // members may just not be in it yet (and a reload would forget every group)
  useEffect(() => {
    if (!loading && staleGroupIds.length > 0) {
      setGroups(groups.filter((g) => !staleGroupIds.includes(g.id)));
    }
  }, [staleGroupIds, loading]);

  return { groupedItems, addGroup, removeGroup };
}
