// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import React, { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

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

  // Extract code and language from props (support both interfaces)
  const actualCode = blockMatch?.output || code || "";
  const actualLanguage = blockMatch?.language || language || "text";

  useEffect(() => {
    const highlightCode = async () => {
      try {
        const html = await codeToHtml(actualCode, {
          lang: actualLanguage,
          theme: "github-dark",
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
          theme: "github-dark",
        });
        setHighlightedCode(fallbackHtml);
      } finally {
        setIsLoading(false);
      }
    };

    highlightCode();
  }, [actualCode, actualLanguage, showLineNumbers]);

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
        <pre>
          <code>{actualCode}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className={`relative group ${className}`}>
      <div
        className={`code-block ${showLineNumbers ? "with-line-numbers" : ""} bg-gray-800 rounded-md p-4 my-4 overflow-x-auto`}
        dangerouslySetInnerHTML={{ __html: highlightedCode }}
      />
      {showCopyButton && (
        <button
          className="absolute top-2 right-2 bg-gray-700 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-600"
          onClick={handleCopy}
        >
          Copy
        </button>
      )}
    </div>
  );
};

export default CodeBlock;
