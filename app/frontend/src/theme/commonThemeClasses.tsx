import { useMemo } from "react";
import { useTheme } from "../providers/ThemeProvider";

interface CommonClasses {
  textColor: string;
  hoverTextColor: string;
  activeBorderColor: string;
  hoverBackgroundColor: string;
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
