// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import React, { useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { useTheme } from "../../hooks/useTheme";

interface CodeBlockProps {
  // For chat UI compatibility
  blockMatch?: {
    output: string;
    language: string;
  };
  // For generic use
  code?: string;
  language?: string;
  showLineNumbers?: boolean;
  showCopyButton?: boolean;
  className?: string;
}

// Utility function to determine if the current theme is dark
const isDarkTheme = (theme: string): boolean => {
  if (theme === "dark") return true;
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return false;
};

// Utility function to get the appropriate Shiki theme
const getShikiTheme = (theme: string): string => {
  return isDarkTheme(theme) ? "one-dark-pro" : "github-light";
};

const CodeBlock: React.FC<CodeBlockProps> = ({
  blockMatch,
  code,
  language,
  showLineNumbers = false,
  showCopyButton = true,
  className = "",
}) => {
  const [highlightedCode, setHighlightedCode] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const { theme } = useTheme();

  // Extract code and language from props (support both interfaces)
  const actualCode = blockMatch?.output || code || "";
  const actualLanguage = blockMatch?.language || language || "text";

  // Get theme-aware background classes
  const getBackgroundClasses = () => {
    const isDark = isDarkTheme(theme);
    return isDark
      ? "bg-black border border-gray-700"
      : "bg-gray-50 border-2 border-gray-400 shadow-md";
  };

  const getCopyButtonClasses = () => {
    const isDark = isDarkTheme(theme);
    return isDark
      ? "absolute top-2 right-2 bg-gray-600 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-500 border border-gray-500"
      : "absolute top-2 right-2 bg-white text-gray-800 px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-50 border border-gray-400 shadow-sm";
  };

  useEffect(() => {
    const highlightCode = async () => {
      try {
        const shikiTheme = getShikiTheme(theme);

        const html = await codeToHtml(actualCode, {
          lang: actualLanguage,
          theme: shikiTheme,
          ...(showLineNumbers && {
            transformers: [
              {
                name: "line-numbers",
                line(node, line) {
                  this.addClassToHast(node, "line");
                  node.children.unshift({
                    type: "element",
                    tagName: "span",
                    properties: { className: ["line-number"] },
                    children: [{ type: "text", value: line.toString() }],
                  });
                },
              },
            ],
          }),
        });

        setHighlightedCode(html);
      } catch (error) {
        console.error("Error highlighting code:", error);
        // Shiki will gracefully fallback to plain text for unknown languages
        const fallbackHtml = await codeToHtml(actualCode, {
          lang: "text",
          theme: getShikiTheme(theme),
        });
        setHighlightedCode(fallbackHtml);
      } finally {
        setIsLoading(false);
      }
    };

    highlightCode();
  }, [actualCode, actualLanguage, showLineNumbers, theme]); // Add theme to dependencies

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(actualCode);
    } catch (error) {
      console.error("Failed to copy code:", error);
    }
  };

  if (isLoading) {
    return (
      <div className={`code-block-loading ${className}`}>
        <pre className="bg-black text-green-400 p-4 rounded-md font-mono">
          <code>{actualCode}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className={`relative group ${className}`}>
      <div
        className={`code-block ${showLineNumbers ? "with-line-numbers" : ""} ${getBackgroundClasses()} rounded-md overflow-x-auto font-mono text-sm`}
        style={{
          padding: "1rem",
          fontFamily: 'Monaco, Consolas, "Courier New", monospace',
          fontSize: "0.875rem",
          lineHeight: "1.4",
        }}
        dangerouslySetInnerHTML={{ __html: highlightedCode }}
      />
      {showCopyButton && (
        <button className={getCopyButtonClasses()} onClick={handleCopy}>
          Copy
        </button>
      )}
    </div>
  );
};

export default CodeBlock;
