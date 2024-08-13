import { Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";
import { useTheme } from "../providers/ThemeProvider";

const ModeToggle = () => {
  const { setTheme, theme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <Button
      onClick={toggleTheme}
      variant="outline"
      size="icon"
      className={`relative inline-flex items-center justify-center p-2 rounded-full transition-all duration-300 ease-in-out group ${
        theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300"
      }`}
    >
      <Sun
        className={`h-[1.4rem] w-[1.4rem] text-yellow-600 fill-yellow-500 dark:fill-yellow-300 shadow-xl rotate-0 scale-100 transition-transform duration-300 ease-in-out dark:-rotate-90 dark:scale-0 group-hover:animate-spin-slow`}
      />
      <Moon
        className={`absolute h-[1.4rem] w-[1.4rem] text-zinc-200 fill-zinc-300 dark:fill-stone-500 rotate-90 scale-0 transition-transform duration-300 ease-in-out dark:rotate-0 dark:scale-100`}
      />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
};

export default ModeToggle;
