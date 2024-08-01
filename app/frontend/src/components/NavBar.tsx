import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import logo from "../assets/tt_logo.svg";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from "./ui/navigation-menu";
import { Home, BrainCog, BotMessageSquare } from "lucide-react";
import ModeToggle from "./DarkModeToggle";
import HelpIcon from "./HelpIcon";
import { useTheme } from "../providers/ThemeProvider";
import { Separator } from "./ui/separator";
import ResetIcon from "./ResetIcon";
import CustomToaster from "./CustomToaster";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

const NavBar: React.FC = () => {
  const { theme } = useTheme();
  const [chatUIActive] = useState(false);

  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const textColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverTextColor = theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
  const activeBorderColor = theme === "dark" ? "border-zinc-400" : "border-black";
  const hoverBackgroundColor = theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";

  const navLinkClass = (isActive: boolean): string =>
    `flex items-center px-2 py-2 rounded-md text-sm font-medium ${textColor} transition-all duration-300 ease-in-out ${
      isActive ? `border-2 ${activeBorderColor}` : "border-transparent"
    } ${hoverTextColor} ${hoverBackgroundColor}`;

  return (
    <TooltipProvider>
      <div className="relative w-full">
        <CustomToaster />
        <div className="flex items-center justify-between w-full px-4 py-2 sm:px-5 sm:py-3 bg-secondary border-b-4 rounded-2xl shadow-xl">
          <div className="flex items-center space-x-4 sm:space-x-6">
            <a
              href="https://www.tenstorrent.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center"
            >
              <img
                src={logo}
                alt="Tenstorrent Logo"
                className="w-10 h-10 sm:w-14 sm:h-14 transform transition duration-300 hover:scale-110"
              />
              <h4
                className={`hidden sm:block text-lg sm:text-2xl font-medium ${textColor} ml-3 bold font-roboto`}
              >
                llm-studio
              </h4>
            </a>
            <NavigationMenu className="flex-grow px-28">
              <NavigationMenuList className="flex justify-between">
                <NavigationMenuItem>
                  <NavLink
                    to="/"
                    className={({ isActive }) => navLinkClass(isActive)}
                  >
                    <Home className={`mr-1 ${iconColor}`} />
                    <span className="hidden sm:inline">Home</span>
                  </NavLink>
                </NavigationMenuItem>
                <Separator
                  className="h-6 w-px bg-zinc-400"
                  orientation="vertical"
                />
                <NavigationMenuItem>
                  <NavLink
                    to="/models-deployed"
                    className={({ isActive }) => navLinkClass(isActive)}
                  >
                    <BrainCog className={`mr-1 ${iconColor}`} />
                    <span className="hidden sm:inline">Models Deployed</span>
                  </NavLink>
                </NavigationMenuItem>
                {chatUIActive && (
                  <>
                    <Separator
                      className="h-6 w-px bg-zinc-400"
                      orientation="vertical"
                    />
                    <NavigationMenuItem>
                      <NavLink
                        to="/chat-ui"
                        className={({ isActive }) => navLinkClass(isActive)}
                      >
                        <BotMessageSquare className={`mr-1 ${iconColor}`} />
                        <span className="hidden sm:inline">Chat UI</span>
                      </NavLink>
                    </NavigationMenuItem>
                  </>
                )}
              </NavigationMenuList>
            </NavigationMenu>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <ModeToggle />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div>Toggle Dark/Light Mode</div>
              </TooltipContent>
            </Tooltip>
            <Separator
              className="h-6 w-px bg-zinc-400"
              orientation="vertical"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <ResetIcon />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div>Reset Board</div>
              </TooltipContent>
            </Tooltip>
            <Separator
              className="h-6 w-px bg-zinc-400"
              orientation="vertical"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <HelpIcon />
                </div>
              </TooltipTrigger>
              <TooltipContent side="left" align="center">
                <div>Get Help</div>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default NavBar;
