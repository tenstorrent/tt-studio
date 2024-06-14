import { Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useTheme } from "../providers/ThemeProvider";

const ModeToggle = () => {
  const { setTheme, theme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={`relative inline-flex items-center justify-center p-2 rounded-full transition-all duration-300 ease-in-out ${
            theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300"
          }`}
        >
          <Sun
            className={`h-[1.4rem] w-[1.4rem] text-yellow-600 dark:text-yellow-400 shadow-xl rotate-0 scale-100 transition-transform duration-300 ease-in-out dark:-rotate-90 dark:scale-0 stroke-current stroke-1`}
          />
          <Moon
            className={`absolute h-[1.4rem] w-[1.4rem] rotate-90 scale-0 transition-transform duration-300 ease-in-out dark:rotate-0 dark:scale-100 text-zinc-200`}
          />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dark:bg-zinc-800">
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          className="dark:text-zinc-200 hover:bg-gray-200 dark:hover:bg-zinc-600 dark:hover:text-white"
        >
          Light
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          className="dark:text-zinc-200 hover:bg-gray-200 dark:hover:bg-zinc-600 dark:hover:text-white"
        >
          Dark
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ModeToggle;
