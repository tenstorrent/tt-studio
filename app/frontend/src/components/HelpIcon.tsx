import React from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "./ui/button";
import { useTheme } from "../providers/ThemeProvider";

interface HelpIconProps {
  toggleSidebar: () => void;
}

const HelpIcon: React.FC<HelpIconProps> = ({ toggleSidebar }) => {
  const { theme } = useTheme();

  const handleHelpClick = (): void => {
    toggleSidebar();
  };

  const iconColor = theme === "dark" ? "text-zinc-200" : "text-gray-600";
  const hoverIconColor =
    theme === "dark" ? "hover:text-blue-300" : "hover:text-blue-500";
  const buttonBackgroundColor = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const hoverButtonBackgroundColor =
    theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-200";

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={handleHelpClick}
      className={`transition duration-300 ${buttonBackgroundColor} ${hoverButtonBackgroundColor}`}
    >
      <div className="flex items-center justify-center transform transition duration-300 hover:scale-110">
        <HelpCircle
          className={`h-[1.4rem] w-[1.4rem] ${iconColor} ${hoverIconColor}`}
        />
        <span className="sr-only">Help</span>
      </div>
    </Button>
  );
};

export default HelpIcon;
