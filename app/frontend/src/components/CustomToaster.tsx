// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { Toaster, toast } from "react-hot-toast";
import { useTheme } from "../providers/ThemeProvider";

export const customToast = {
  success: (message: string) =>
    toast.success(message, {
      style: {
        borderRadius: "10px",
        background: "#333",
        color: "#fff",
      },
    }),
  error: (message: string) =>
    toast.error(message, {
      style: {
        borderRadius: "10px",
        background: "#333",
        color: "#fff",
      },
    }),
  promise: (
    promise: Promise<unknown>,
    messages: { loading: string; success: string; error: string },
  ) =>
    toast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: messages.error,
    }),
};

const CustomToaster = () => {
  const { theme } = useTheme();

  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: theme === "dark" ? "#333" : "#fff",
          color: theme === "dark" ? "#fff" : "#000",
        },
      }}
    />
  );
};

export default CustomToaster;
