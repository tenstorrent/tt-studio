// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import React, { type CSSProperties, useEffect } from "react";
import { createPortal } from "react-dom";
import { Toaster, toast } from "react-hot-toast";
import { useTheme } from "../hooks/useTheme";
import { Check, X, Info, AlertTriangle, Trash2 } from "lucide-react";

const getToastStyle = (
  theme: string,
  type?: "success" | "error" | "warning" | "info" | "destructive" | "notice"
) => {
  const isDark = theme === "dark";

  const accentByType: Record<string, string> = {
    success: isDark ? "rgba(52,211,153,0.35)" : "rgba(16,185,129,0.25)", // green-400/500
    error: isDark ? "rgba(248,113,113,0.40)" : "rgba(239,68,68,0.25)", // red-400/500
    destructive: isDark ? "rgba(248,113,113,0.40)" : "rgba(239,68,68,0.25)",
    warning: isDark ? "rgba(250,204,21,0.35)" : "rgba(234,179,8,0.25)", // yellow-400/500
    info: isDark ? "rgba(96,165,250,0.35)" : "rgba(59,130,246,0.25)", // blue-400/500
    notice: isDark ? "rgba(147,51,234,0.35)" : "rgba(147,51,234,0.20)", // purple accent fallback
  };
  const accent = type ? accentByType[type] : accentByType.notice;

  const baseShadow = isDark
    ? "0 12px 28px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)"
    : "0 10px 24px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.6)";

  return {
    borderRadius: "12px",
    padding: "10px 14px",
    fontSize: "14px",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    background: isDark
      ? "linear-gradient(180deg, rgba(38,38,45,0.96), rgba(26,26,33,0.96))"
      : "linear-gradient(180deg, rgba(255,255,255,0.95), rgba(245,245,245,0.95))",
    color: isDark ? "#FAFAFA" : "#222",
    minHeight: "44px",
    width: "auto",
    maxWidth: "720px",
    boxShadow: `${baseShadow}, 0 0 0 1px ${accent}, 0 8px 28px ${accent}`,
    border: isDark
      ? "1px solid rgba(255,255,255,0.04)"
      : "1px solid rgba(0,0,0,0.06)",
    backdropFilter: "blur(6px)",
  } as CSSProperties;
};

const ToastContent = ({
  message,
  icon: Icon,
  iconColor,
  t,
  type,
  durationMs,
}: {
  message: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  iconColor: string;
  t: { id: string; visible?: boolean };
  type?: "success" | "error" | "warning" | "info" | "destructive" | "notice";
  durationMs?: number;
}) => {
  const handleDismiss = () => {
    toast.dismiss(t.id);
    toast.remove(t.id);
  };

  // Manual auto-dismiss fallback (custom toasts don't always respect duration)
  useEffect(() => {
    if (durationMs == null || durationMs <= 0) return;
    const toastId = t.id;
    const timer = setTimeout(() => {
      toast.dismiss(toastId);
      toast.remove(toastId);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, t.id]);

  return (
    <div
      className={`${t.visible ? "animate-enter" : "animate-leave"} !z-[99999] pointer-events-auto`}
      style={getToastStyle(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
        type
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Icon size={16} className={`${iconColor} shrink-0`} />
        <span className="whitespace-pre-wrap break-words leading-relaxed">
          {message}
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleDismiss();
        }}
        className="ml-2 p-1 opacity-60 hover:opacity-100 shrink-0"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export const customToast = {
  success: (message: string) =>
    toast.custom(
      (t) => (
        <ToastContent
          message={message}
          icon={Check}
          iconColor="text-green-400"
          t={t}
          type="success"
          durationMs={3000}
        />
      ),
      {
        duration: 3000,
        id: `tt-toast-success-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      }
    ),
  error: (message: string) =>
    toast.custom(
      (t) => (
        <ToastContent
          message={message}
          icon={X}
          iconColor="text-red-400"
          t={t}
          type="error"
          durationMs={4000}
        />
      ),
      {
        id: `tt-toast-error-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        duration: 4000,
      }
    ),
  warning: (message: string) =>
    toast.custom(
      (t) => (
        <ToastContent
          message={message}
          icon={AlertTriangle}
          iconColor="text-yellow-400"
          t={t}
          type="warning"
          durationMs={3000}
        />
      ),
      {
        id: `tt-global-toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        duration: 3000,
      }
    ),
  info: (message: string) =>
    toast.custom(
      (t) => (
        <ToastContent
          message={message}
          icon={Info}
          iconColor="text-blue-400"
          t={t}
          type="info"
          durationMs={3000}
        />
      ),
      {
        id: `tt-global-toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        duration: 3000,
      }
    ),
  destructive: (message: string) =>
    toast.custom(
      (t) => (
        <ToastContent
          message={message}
          icon={Trash2}
          iconColor="text-red-400"
          t={t}
          type="destructive"
          durationMs={4000}
        />
      ),
      {
        id: `tt-global-toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        duration: 4000,
      }
    ),
  persistentNotice: (message: string) =>
    toast.custom(
      (t) => (
        <ToastContent
          message={message}
          icon={AlertTriangle}
          iconColor="text-yellow-400"
          t={t}
          type="notice"
        />
      ),
      { id: "tt-startup-notice", duration: Infinity }
    ),
  promise: (
    promise: Promise<unknown>,
    messages: { loading: string; success: string; error: string }
  ) =>
    toast.promise(
      promise,
      {
        loading: messages.loading,
        success: messages.success,
        error: messages.error,
      },
      {
        id: `tt-global-toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        duration: 3000,
        success: { duration: 3000 },
        error: { duration: 4000 },
        style: getToastStyle(
          document.documentElement.classList.contains("dark") ? "dark" : "light"
        ),
      }
    ),
};

const TOASTER_Z_INDEX = 99999;

const CustomToaster = () => {
  const { theme } = useTheme();

  const toaster = (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: TOASTER_Z_INDEX }}
    >
      <div className="absolute bottom-24 right-8 pointer-events-auto sm:right-12 md:right-16">
        <Toaster
          position="bottom-right"
          gutter={10}
          toastOptions={{
            duration: 4000,
            style: getToastStyle(theme),
          }}
          containerClassName="!z-[99999]"
          containerStyle={{ bottom: 24, right: 96 }}

        />
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(toaster, document.body)
    : toaster;
};

export default CustomToaster;
