// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

export interface GitHubReleaseInfo {
  latest: GitHubRelease;
  previous?: GitHubRelease;
  currentVersion: string;
  isLatest: boolean;
}

const GITHUB_API_BASE = "https://api.github.com";
const TT_STUDIO_REPO = "tenstorrent/tt-studio";

// Cache for release data to avoid excessive API calls
let releaseCache: GitHubReleaseInfo | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch the latest release information from GitHub
 */
export const fetchLatestRelease = async (): Promise<GitHubReleaseInfo> => {
  // Check cache first
  const now = Date.now();
  if (releaseCache && now - cacheTimestamp < CACHE_DURATION) {
    return releaseCache;
  }

  try {
    // Fetch releases from GitHub API
    const response = await fetch(`${GITHUB_API_BASE}/repos/${TT_STUDIO_REPO}/releases`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "TT-Studio-Client",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const releases: GitHubRelease[] = await response.json();

    // Filter out drafts and prereleases, sort by published date
    const publishedReleases = releases
      .filter((release) => !release.draft && !release.prerelease)
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

    if (publishedReleases.length === 0) {
      throw new Error("No published releases found");
    }

    const latest = publishedReleases[0];
    const previous = publishedReleases.length > 1 ? publishedReleases[1] : undefined;

    // Get current version from package.json or use a fallback
    const currentVersion = getCurrentVersion();

    // Check if current version is the latest
    const isLatest = latest.tag_name === currentVersion;

    const releaseInfo: GitHubReleaseInfo = {
      latest,
      previous,
      currentVersion,
      isLatest,
    };

    // Update cache
    releaseCache = releaseInfo;
    cacheTimestamp = now;

    return releaseInfo;
  } catch (error) {
    console.error("Failed to fetch GitHub releases:", error);

    // Return fallback data if API fails
    const fallbackData = {
      latest: {
        id: 0,
        tag_name: "v2.0.1",
        name: "TT Studio 2.0.1",
        body: "Latest patch release with bug fixes and UI/UX improvements",
        published_at: "2025-07-21T00:00:00Z",
        html_url: "https://github.com/tenstorrent/tt-studio/releases/latest",
        draft: false,
        prerelease: false,
      },
      currentVersion: getCurrentVersion(),
      isLatest: true,
    };

    // If we have cached data, return it instead of fallback
    if (releaseCache) {
      console.log("Using cached release data due to API error");
      return releaseCache;
    }

    return fallbackData;
  }
};

/**
 * Get the current version of TT Studio
 */
const getCurrentVersion = (): string => {
  // Try to get version from environment variable
  const envVersion = import.meta.env.VITE_APP_VERSION;
  if (envVersion) {
    return envVersion;
  }

  // Try to get version from package.json (this will be replaced during build)
  const packageVersion = import.meta.env.VITE_PACKAGE_VERSION;
  if (packageVersion) {
    return packageVersion;
  }

  // Fallback to hardcoded version
  return "v2.0.1";
};

/**
 * Parse release notes from GitHub release body
 */
export const parseReleaseNotes = (
  body: string
): {
  bugFixes: string[];
  features: string[];
  community: string[];
} => {
  const bugFixes: string[] = [];
  const features: string[] = [];
  const community: string[] = [];

  const lines = body.split("\n");
  let currentSection = "";

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.toLowerCase().includes("bug") || trimmedLine.includes("🐛")) {
      currentSection = "bugFixes";
    } else if (
      trimmedLine.toLowerCase().includes("feature") ||
      trimmedLine.includes("🚀") ||
      trimmedLine.includes("✨") ||
      trimmedLine.includes("🎙️") ||
      trimmedLine.includes("⚙️") ||
      trimmedLine.includes("🧠") ||
      trimmedLine.includes("👁️")
    ) {
      currentSection = "features";
    } else if (
      trimmedLine.toLowerCase().includes("community") ||
      trimmedLine.includes("👥") ||
      trimmedLine.includes("contributor")
    ) {
      currentSection = "community";
    } else if (trimmedLine.startsWith("•") || trimmedLine.startsWith("-")) {
      const content = trimmedLine.substring(1).trim();
      if (content) {
        switch (currentSection) {
          case "bugFixes":
            bugFixes.push(content);
            break;
          case "features":
            features.push(content);
            break;
          case "community":
            community.push(content);
            break;
        }
      }
    }
  }

  return { bugFixes, features, community };
};

/**
 * Format release date for display
 */
export const formatReleaseDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};
