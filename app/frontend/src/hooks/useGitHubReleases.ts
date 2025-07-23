// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useCallback } from "react";
import {
  fetchLatestRelease,
  GitHubReleaseInfo,
  parseReleaseNotes,
  formatReleaseDate,
} from "../api/githubApi";

export interface ReleaseData {
  releaseInfo: GitHubReleaseInfo | null;
  parsedNotes: {
    bugFixes: string[];
    features: string[];
    community: string[];
  } | null;
  formattedDate: string | null;
  loading: boolean;
  error: string | null;
}

export const useGitHubReleases = (): ReleaseData & { refetch: () => Promise<void> } => {
  const [releaseInfo, setReleaseInfo] = useState<GitHubReleaseInfo | null>(null);
  const [parsedNotes, setParsedNotes] = useState<{
    bugFixes: string[];
    features: string[];
    community: string[];
  } | null>(null);
  const [formattedDate, setFormattedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReleases = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await fetchLatestRelease();
      setReleaseInfo(data);

      // Parse release notes if available
      if (data.latest?.body) {
        const notes = parseReleaseNotes(data.latest.body);
        setParsedNotes(notes);
      }

      // Format release date
      if (data.latest?.published_at) {
        const date = formatReleaseDate(data.latest.published_at);
        setFormattedDate(date);
      }
    } catch (err) {
      console.error("Error fetching GitHub releases:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch release information");
    } finally {
      setLoading(false);
    }
  }, []);

  const refetch = useCallback(async () => {
    await fetchReleases();
  }, [fetchReleases]);

  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);

  return {
    releaseInfo,
    parsedNotes,
    formattedDate,
    loading,
    error,
    refetch,
  };
};
