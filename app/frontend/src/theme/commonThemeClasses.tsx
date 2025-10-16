// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { useMemo } from "react";
import { useTheme } from "../hooks/useTheme";

interface CommonClasses {
  textColor: string;
  hoverTextColor: string;
  activeBorderColor: string;
  hoverBackgroundColor: string;
}

interface TableCommonClasses {
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  tableCaptionColor: string;
  tableRowBgColor: string;
  tableRowFadeBgColor: string;
}

export default function useCommonClasses(): CommonClasses {
  const { theme } = useTheme();

  return useMemo(() => {
    const textColor = theme === "dark" ? "text-zinc-200" : "text-black";
    const hoverTextColor =
      theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
    const activeBorderColor =
      theme === "dark" ? "border-zinc-400" : "border-black";
    const hoverBackgroundColor =
      theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";

    return {
      textColor,
      hoverTextColor,
      activeBorderColor,
      hoverBackgroundColor,
    };
  }, [theme]);
}

export function useTableCommonClasses(): TableCommonClasses {
  const { theme } = useTheme();

  return useMemo(() => {
    const textColor = theme === "dark" ? "text-zinc-200" : "text-black";
    const backgroundColor = theme === "dark" ? "bg-zinc-900" : "bg-white";
    const borderColor =
      theme === "dark" ? "border-zinc-400" : "border-gray-500";
    const tableCaptionColor =
      theme === "dark" ? "text-zinc-400" : "text-gray-500";
    const tableRowBgColor = theme === "dark" ? "bg-zinc-900" : "bg-zinc-200";
    const tableRowFadeBgColor =
      theme === "dark" ? "bg-zinc-700" : "bg-zinc-200";

    return {
      textColor,
      backgroundColor,
      borderColor,
      tableCaptionColor,
      tableRowBgColor,
      tableRowFadeBgColor,
    };
  }, [theme]);
}
