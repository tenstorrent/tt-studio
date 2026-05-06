// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Square,
  RotateCcw,
  Sparkles,
  User,
  Bot,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  Brain,
  AlertCircle,
  Rocket,
  Cpu,
  Cloud,
  Thermometer,
  Paperclip,
  X,
  Image as ImageIcon,
} from "lucide-react";
import type { CanvasChatMessage } from "./useCanvasState";
import type { CanvasCreativity } from "./useCanvasState";
import type { CanvasFileAttachment } from "./canvasSystemPrompt";

interface CanvasChatProps {
  messages: CanvasChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  streamingThinking: string;
  onSend: (text: string, files?: CanvasFileAttachment[]) => void;
  onStop: () => void;
  onReset: () => void;
  hasCode: boolean;
  modelId: string | null;
  isCloudMode: boolean;
  modelName: string | null;
  creativity: CanvasCreativity;
  onCreativityChange: (c: CanvasCreativity) => void;
}

const STARTER_PROMPTS = [
  {
    label: "Interactive Chart",
    prompt:
      "Build an interactive bar chart that lets me add/remove data points with animations",
    icon: "📊",
  },
  {
    label: "Calculator",
    prompt:
      "Build a sleek calculator app with keyboard support and history of operations",
    icon: "🧮",
  },
  {
    label: "Data Table",
    prompt:
      "Build a sortable, filterable data table with sample employee data and pagination",
    icon: "📋",
  },
  {
    label: "Contact Form",
    prompt:
      "Build a modern contact form with validation, floating labels, and success animation",
    icon: "📝",
  },
];

function ThinkingBlock({
  thinking,
  isLive,
}: {
  thinking: string;
  isLive: boolean;
}) {
  const [expanded, setExpanded] = useState(isLive);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive) setExpanded(true);
  }, [isLive]);

  useEffect(() => {
    if (isLive && expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinking, isLive, expanded]);

  if (!thinking) return null;

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700/50 bg-zinc-50 dark:bg-zinc-800/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
        )}
        <Brain className="w-3 h-3 text-amber-500 shrink-0" />
        <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
          {isLive ? "Reasoning..." : "Reasoning"}
        </span>
        {isLive && (
          <motion.span
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
          />
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div
              ref={scrollRef}
              className="px-2.5 pb-2 max-h-48 overflow-y-auto"
            >
              <p className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500 whitespace-pre-wrap break-words font-mono">
                {thinking}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const CREATIVITY_OPTIONS: { value: CanvasCreativity; label: string }[] = [
  { value: "low", label: "Precise" },
  { value: "medium", label: "Balanced" },
  { value: "high", label: "Creative" },
];

export default function CanvasChat({
  messages,
  isStreaming,
  streamingText,
  streamingThinking,
  onSend,
  onStop,
  onReset,
  hasCode,
  modelId,
  isCloudMode,
  modelName,
  creativity,
  onCreativityChange,
}: CanvasChatProps) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<CanvasFileAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const needsModel = !isCloudMode && !modelId;

  useEffect(() => {
    if (!isStreaming) userScrolledUp.current = false;
  }, [isStreaming]);

  useEffect(() => {
    if (scrollRef.current && !userScrolledUp.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText, streamingThinking]);

  const handleChatScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distFromBottom > 40;
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const processImageFile = useCallback(async (file: File) => {
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) return;
    if (!file.type.startsWith("image/")) return;

    return new Promise<CanvasFileAttachment | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        resolve({
          type: "image_url",
          image_url: { url: `data:${file.type};base64,${base64}` },
          name: file.name,
        });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      const results = await Promise.all(imageFiles.map(processImageFile));
      const valid = results.filter(Boolean) as CanvasFileAttachment[];
      if (valid.length > 0) {
        setAttachedFiles((prev) => [...prev, ...valid]);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [processImageFile],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      const results = await Promise.all(imageFiles.map(processImageFile));
      const valid = results.filter(Boolean) as CanvasFileAttachment[];
      if (valid.length > 0) {
        setAttachedFiles((prev) => [...prev, ...valid]);
      }
    },
    [processImageFile],
  );

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isStreaming || needsModel) return;
    onSend(input.trim(), attachedFiles.length > 0 ? attachedFiles : undefined);
    setInput("");
    setAttachedFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStarterClick = (prompt: string) => {
    onSend(prompt, undefined);
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            Canvas
          </span>
        </div>
        {hasCode && (
          <button
            onClick={onReset}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Reset canvas"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
      </div>

      {/* Messages area */}
      <div ref={scrollRef} onScroll={handleChatScroll} className="grow overflow-y-auto px-4 py-3">
        {needsModel ? (
          <div className="flex flex-col items-center justify-center h-full gap-5 px-6">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-amber-400" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                No model available
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-56 leading-relaxed">
                Canvas needs a running model to generate code. Either deploy a local model or enable cloud inference.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-52">
              <button
                onClick={() => navigate("/models-deployed")}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors w-full"
              >
                <Rocket className="w-3.5 h-3.5" />
                Deploy a Model
              </button>
              <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500 text-xs font-medium w-full cursor-not-allowed">
                <Cloud className="w-3.5 h-3.5" />
                Enable Cloud Inference
                <span className="text-[9px] text-zinc-400 dark:text-zinc-600">(set in .env)</span>
              </div>
            </div>
          </div>
        ) : isEmpty && !isStreaming ? (
          <div className="flex flex-col items-center justify-center h-full gap-5">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-violet-400" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                What would you like to build?
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-56">
                Describe a UI component, app, or visualization and watch it come
                to life.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 w-full max-w-72">
              {STARTER_PROMPTS.map((sp) => (
                <button
                  key={sp.label}
                  onClick={() => handleStarterClick(sp.prompt)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-violet-400 dark:hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-all text-left group"
                >
                  <span className="text-base">{sp.icon}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                      {sp.label}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-start gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500 max-w-64">
              <Lightbulb className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                After generating, give feedback like "make the buttons bigger"
                or "add a dark mode toggle" to iterate.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-left">
            {messages.map((msg) => (
              <div key={msg.id} className="flex gap-2.5">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    msg.role === "user"
                      ? "bg-zinc-200 dark:bg-zinc-700"
                      : "bg-violet-100 dark:bg-violet-900/50"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User className="w-3 h-3 text-zinc-600 dark:text-zinc-300" />
                  ) : (
                    <Bot className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                  )}
                </div>
                <div className="min-w-0 pt-0.5 space-y-2 flex-1">
                  {msg.role === "assistant" && msg.thinking && (
                    <ThinkingBlock thinking={msg.thinking} isLive={false} />
                  )}
                  {msg.files && msg.files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {msg.files.map((f, i) => (
                        <div key={i} className="w-16 h-16 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
                          <img src={f.url} alt={f.name} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words leading-relaxed text-left">
                    {msg.content}
                  </p>
                </div>
              </div>
            ))}

            {/* Live streaming section */}
            <AnimatePresence>
              {isStreaming && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex gap-2.5"
                >
                  <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="min-w-0 pt-0.5 space-y-2 flex-1">
                    {/* Live thinking */}
                    {streamingThinking && (
                      <ThinkingBlock
                        thinking={streamingThinking}
                        isLive={true}
                      />
                    )}

                    {/* Streaming status */}
                    {!streamingThinking && streamingText.length === 0 && (
                      <div className="flex items-center gap-1.5">
                        <motion.div
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{
                            repeat: Infinity,
                            duration: 1.5,
                            ease: "easeInOut",
                          }}
                          className="flex gap-1"
                        >
                          <span className="w-1.5 h-1.5 bg-violet-400 rounded-full" />
                          <span className="w-1.5 h-1.5 bg-violet-400 rounded-full" />
                          <span className="w-1.5 h-1.5 bg-violet-400 rounded-full" />
                        </motion.div>
                        <span className="text-xs text-zinc-400">
                          Thinking...
                        </span>
                      </div>
                    )}

                    {/* Code generation status */}
                    {streamingText.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{
                            repeat: Infinity,
                            duration: 1,
                            ease: "linear",
                          }}
                        >
                          <Sparkles className="w-3 h-3 text-violet-400" />
                        </motion.div>
                        <span className="text-xs text-violet-400">
                          Writing code...
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Input area */}
      <div
        className="px-3 pb-3 pt-1 shrink-0 space-y-1.5"
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-violet-500/10 border-2 border-dashed border-violet-400 rounded-xl backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <ImageIcon className="w-6 h-6 text-violet-400" />
              <span className="text-xs font-medium text-violet-400">Drop image here</span>
            </div>
          </div>
        )}

        {/* File previews */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {attachedFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="relative group w-12 h-12 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700"
              >
                <img
                  src={file.image_url.url}
                  alt={file.name}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
                <div className="absolute bottom-0 inset-x-0 bg-black/60 px-0.5 py-px">
                  <span className="text-[8px] text-white truncate block">{file.name}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              hasCode
                ? "Describe changes... (e.g. 'make buttons blue')"
                : "Describe what to build..."
            }
            rows={2}
            className="w-full resize-none rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-9 py-2.5 pr-10 text-xs text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-400/50 focus:border-violet-400 transition-all"
          />
          {/* Attach button */}
          <div className="absolute left-2 bottom-2.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              title="Attach image"
            >
              <Paperclip className="w-3.5 h-3.5 text-zinc-400" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
          {/* Send/Stop button */}
          <div className="absolute right-2 bottom-2.5">
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="p-1.5 rounded-lg bg-red-500 hover:bg-red-600 transition-colors"
                title="Stop generation"
              >
                <Square className="w-3 h-3 text-white" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && attachedFiles.length === 0}
                className="p-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed transition-colors"
                title="Send"
              >
                <Send className="w-3 h-3 text-white" />
              </button>
            )}
          </div>
        </form>

        {/* Model & creativity bar */}
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mode badge */}
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
              {isCloudMode ? (
                <Cloud className="w-3 h-3 text-sky-400" />
              ) : (
                <Cpu className="w-3 h-3 text-violet-400" />
              )}
              <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
                {isCloudMode ? "Cloud" : "Local"}
              </span>
            </div>

            {/* Model name */}
            {modelName && (
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate max-w-32" title={modelName}>
                {modelName}
              </span>
            )}
          </div>

          {/* Creativity selector */}
          <div className="flex items-center gap-1">
            <Thermometer className="w-3 h-3 text-zinc-400" />
            <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              {CREATIVITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onCreativityChange(opt.value)}
                  className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    creativity === opt.value
                      ? "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300"
                      : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
