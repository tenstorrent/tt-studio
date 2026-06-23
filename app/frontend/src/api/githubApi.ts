// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

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
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${TT_STUDIO_REPO}/releases`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`
      );
    }

    const releases: GitHubRelease[] = await response.json();

    // Filter out drafts and prereleases, sort by published date
    const publishedReleases = releases
      .filter((release) => !release.draft && !release.prerelease)
      .sort(
        (a, b) =>
          new Date(b.published_at).getTime() -
          new Date(a.published_at).getTime()
      );

    if (publishedReleases.length === 0) {
      throw new Error("No published releases found");
    }

    const latest = publishedReleases[0];
    const previous =
      publishedReleases.length > 1 ? publishedReleases[1] : undefined;

    // Get current version from package.json or use a fallback
    const currentVersion = getCurrentVersion();

    // Check if current version is the latest 
    const isLatest =
      !!currentVersion && normalizeVersion(latest.tag_name) === normalizeVersion(currentVersion);

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
 * Strip a leading "v" and surrounding whitespace so version strings compare
 * consistently regardless of how the tag was written.
 */
const normalizeVersion = (version: string): string =>
  version.trim().replace(/^v/i, "");

export interface BuildInfo {
  /** Official release tag (e.g. "v2.6.0") when this build sits on a tag, else "". */
  version: string;
  /** Git branch name (e.g. "dev") for unofficial builds, else "". */
  branch: string;
  /** True when this build was produced from an exact release tag. */
  isOfficialRelease: boolean;
  /** Display label for the footer: "v2.6.0" for releases, branch name otherwise, "" if unknown. */
  label: string;
}

/**
 * Resolve the version/branch of the build the user is actually running.
 *
 * Both values are injected at build time by run.py via git (see set_app_version_env):
 *   - VITE_APP_VERSION    — the release tag, set only when HEAD is exactly on a tag
 *   - VITE_APP_GIT_BRANCH — the branch name, used as the label for unofficial builds
 */
export const getBuildInfo = (): BuildInfo => {
  const version = (import.meta.env.VITE_APP_VERSION || "").trim();
  const branch = (import.meta.env.VITE_APP_GIT_BRANCH || "").trim();
  const isOfficialRelease = version.length > 0;

  let label = "";
  if (isOfficialRelease) {
    label = version.startsWith("v") ? version : `v${version}`;
  } else if (branch) {
    label = branch;
  }

  return { version, branch, isOfficialRelease, label };
};

/**
 * Get the current release version of TT Studio (the injected git tag), or "" for
 * unofficial builds. Used to compare against the latest published GitHub release.
 */
const getCurrentVersion = (): string => getBuildInfo().version;

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

    if (
      trimmedLine.toLowerCase().includes("bug") ||
      trimmedLine.includes("🐛")
    ) {
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
