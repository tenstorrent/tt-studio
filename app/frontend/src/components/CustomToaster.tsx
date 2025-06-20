// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { Toaster, toast } from "react-hot-toast";
import { useTheme } from "../providers/ThemeProvider";
import { Check, X, Info, AlertTriangle, Trash2 } from "lucide-react";

const getToastStyle = (theme: string, _type?: string) => {
  const baseStyle = {
    borderRadius: "10px",
    padding: "8px 12px",
    fontSize: "14px",
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    background: theme === "dark" ? "#333" : "#fff",
    color: theme === "dark" ? "#fff" : "#000",
    minHeight: "40px",
    width: "100%",
    maxWidth: "420px",
  };

  return baseStyle;
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
    style={getToastStyle(document.documentElement.classList.contains("dark") ? "dark" : "light")}
  >
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <Icon size={16} className={`${iconColor} shrink-0`} />
      <span className="truncate">{message}</span>
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
      (t) => <ToastContent message={message} icon={Check} iconColor="text-green-400" t={t} />,
      {
        duration: 2000,
      }
    ),
  error: (message: string) =>
    toast.custom((t) => <ToastContent message={message} icon={X} iconColor="text-red-400" t={t} />),
  warning: (message: string) =>
    toast.custom((t) => (
      <ToastContent message={message} icon={AlertTriangle} iconColor="text-yellow-400" t={t} />
    )),
  info: (message: string) =>
    toast.custom((t) => (
      <ToastContent message={message} icon={Info} iconColor="text-blue-400" t={t} />
    )),
  destructive: (message: string) =>
    toast.custom((t) => (
      <ToastContent message={message} icon={Trash2} iconColor="text-red-400" t={t} />
    )),
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
      toastOptions={{
        duration: 4000,
        style: getToastStyle(theme),
      }}
    />
  );
};

export default CustomToaster;
