// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import { type CSSProperties } from "react";
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
}: {
  message: string;
  icon: any;
  iconColor: string;
  t: any;
  type?: "success" | "error" | "warning" | "info" | "destructive" | "notice";
}) => (
  <div
    className={`${t.visible ? "animate-enter" : "animate-leave"} !z-[99999]`}
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
      onClick={() => toast.dismiss(t.id)}
      className="ml-2 p-1 opacity-60 hover:opacity-100 shrink-0"
    >
      <X size={14} />
    </button>
  </div>
);

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
        />
      ),
      {
        duration: 2000,
        id: "tt-global-toast",
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
        />
      ),
      {
        id: "tt-global-toast",
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
        />
      ),
      {
        id: "tt-global-toast",
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
        />
      ),
      {
        id: "tt-global-toast",
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
        />
      ),
      {
        id: "tt-global-toast",
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
        id: "tt-global-toast",
        style: getToastStyle(
          document.documentElement.classList.contains("dark") ? "dark" : "light"
        ),
      }
    ),
};

const CustomToaster = () => {
  const { theme } = useTheme();

  return (
    <Toaster
      position="bottom-right"
      gutter={10}
      toastOptions={{
        duration: 4000,
        style: getToastStyle(theme),
      }}
      containerClassName="pointer-events-none !z-[99999]"
      containerStyle={{ bottom: 24, right: 96 }}
    />
  );
};

export default CustomToaster;
