// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// Pure ANSI parsing utilities and log level coloring helpers

export interface AnsiSegment {
  text: string;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface ParsedLogLine {
  text: string;
  level?: string;
  hasColors: boolean;
  segments: AnsiSegment[];
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\u001b\[[0-9;]*m/g;
const LOG_LEVEL_REGEX = /(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL)/i;

type AnsiStyle = {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
};

const ansiCodeToStyle = (code: string): AnsiStyle => {
  const num = parseInt(code);
  const styles: AnsiStyle = {};

  switch (num) {
    case 0:
      return {}; // Reset
    case 1:
      styles.bold = true;
      break; // Bold
    case 3:
      styles.italic = true;
      break; // Italic
    case 30:
      styles.color = "#000000";
      break; // Black
    case 31:
      styles.color = "#FF5555";
      break; // Red
    case 32:
      styles.color = "#50FA7B";
      break; // Green
    case 33:
      styles.color = "#F1FA8C";
      break; // Yellow
    case 34:
      styles.color = "#BD93F9";
      break; // Blue
    case 35:
      styles.color = "#FF79C6";
      break; // Magenta
    case 36:
      styles.color = "#8BE9FD";
      break; // Cyan
    case 37:
      styles.color = "#F8F8F2";
      break; // White
    case 90:
      styles.color = "#6272A4";
      break; // Bright Black (Gray)
    case 91:
      styles.color = "#FF6E6E";
      break; // Bright Red
    case 92:
      styles.color = "#69FF94";
      break; // Bright Green
    case 93:
      styles.color = "#FFFFA5";
      break; // Bright Yellow
    case 94:
      styles.color = "#D6ACFF";
      break; // Bright Blue
    case 95:
      styles.color = "#FF92DF";
      break; // Bright Magenta
    case 96:
      styles.color = "#A4FFFF";
      break; // Bright Cyan
    case 97:
      styles.color = "#FFFFFF";
      break; // Bright White
    default:
      break;
  }

  return styles;
};

export const parseAnsiColors = (text: string): ParsedLogLine => {
  const segments: ParsedLogLine["segments"] = [];
  let currentStyles: AnsiStyle = {};
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const hasColors = ANSI_REGEX.test(text);

  // Reset regex index before use
  ANSI_REGEX.lastIndex = 0;

  while ((match = ANSI_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore) {
        segments.push({
          text: textBefore,
          ...currentStyles,
        });
      }
    }

    const ansiCode = match[0];
    const codes = ansiCode.slice(2, -1).split(";");
    for (const code of codes) {
      const newStyles = ansiCodeToStyle(code);
      if (code === "0") {
        currentStyles = {};
      } else {
        currentStyles = { ...currentStyles, ...newStyles };
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    if (remainingText) {
      segments.push({
        text: remainingText,
        ...currentStyles,
      });
    }
  }

  if (segments.length === 0) {
    segments.push({ text: text.replace(ANSI_REGEX, "") });
  }

  const cleanText = text.replace(ANSI_REGEX, "");
  const levelMatch = cleanText.match(LOG_LEVEL_REGEX);

  return {
    text: cleanText,
    level: levelMatch ? levelMatch[1].toUpperCase() : undefined,
    hasColors,
    segments,
  };
};

export const getLogLevelColor = (level?: string): string => {
  switch (level) {
    case "ERROR":
    case "FATAL":
    case "CRITICAL":
      return "text-red-400";
    case "WARN":
    case "WARNING":
      return "text-yellow-400";
    case "INFO":
      return "text-blue-400";
    case "DEBUG":
    case "TRACE":
      return "text-gray-400";
    default:
      return "text-green-400";
  }
};
