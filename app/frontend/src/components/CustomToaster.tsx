// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { Toaster, toast } from "react-hot-toast";
import { useTheme } from "../hooks/useTheme";
import { Check, X, Info, AlertTriangle, Trash2 } from "lucide-react";

const getToastStyle = (theme: string, _type?: string) => {
  const isDark = theme === "dark";
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
      ? "linear-gradient(180deg, rgba(34,34,34,0.95), rgba(20,20,20,0.95))"
      : "linear-gradient(180deg, rgba(255,255,255,0.95), rgba(245,245,245,0.95))",
    color: isDark ? "#EDEDED" : "#222",
    minHeight: "44px",
    width: "auto",
    maxWidth: "720px",
    boxShadow: isDark
      ? "0 12px 28px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)"
      : "0 10px 24px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.6)",
    border: isDark
      ? "1px solid rgba(255,255,255,0.06)"
      : "1px solid rgba(0,0,0,0.06)",
    backdropFilter: "blur(6px)",
  } as React.CSSProperties;
};

const ToastContent = ({
  message,
  icon: Icon,
  iconColor,
  t,
}: {
  message: string;
  icon: any;
  iconColor: string;
  t: any;
}) => (
  <div
    className={`${t.visible ? "animate-enter" : "animate-leave"}`}
    style={getToastStyle(
      document.documentElement.classList.contains("dark") ? "dark" : "light"
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
        />
      ),
      { id: "tt-global-toast" }
    ),
  warning: (message: string) =>
    toast.custom(
      (t) => (
        <ToastContent
          message={message}
          icon={AlertTriangle}
          iconColor="text-yellow-400"
          t={t}
        />
      ),
      { id: "tt-global-toast" }
    ),
  info: (message: string) =>
    toast.custom(
      (t) => (
        <ToastContent
          message={message}
          icon={Info}
          iconColor="text-blue-400"
          t={t}
        />
      ),
      { id: "tt-global-toast" }
    ),
  destructive: (message: string) =>
    toast.custom(
      (t) => (
        <ToastContent
          message={message}
          icon={Trash2}
          iconColor="text-red-400"
          t={t}
        />
      ),
      { id: "tt-global-toast" }
    ),
  persistentNotice: (message: string) =>
    toast.custom(
      (t) => (
        <ToastContent
          message={message}
          icon={AlertTriangle}
          iconColor="text-yellow-400"
          t={t}
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
      containerClassName="pointer-events-none !z-[9999]"
      containerStyle={{ bottom: 24, right: 96 }}
    />
  );
};

export default CustomToaster;
