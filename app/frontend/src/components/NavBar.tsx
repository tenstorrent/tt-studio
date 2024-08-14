import React, { useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
import Sidebar from "./SideBar";
import { useRefresh } from "../providers/RefreshContext";

const NavBar: React.FC = () => {
  const { theme } = useTheme();
  const location = useLocation();
  const sidebarRef = useRef<{ toggleSidebar: () => void }>(null);
  const { triggerRefresh } = useRefresh();
  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const textColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverTextColor =
    theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
  const activeBorderColor =
    theme === "dark" ? "border-zinc-400" : "border-black";
  const hoverBackgroundColor =
    theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";

  const navLinkClass = (isActive: boolean): string =>
    `flex items-center justify-center px-3 py-3 rounded-md text-sm font-medium ${textColor} transition-all duration-300 ease-in-out ${
      isActive ? `border-2 ${activeBorderColor}` : "border-transparent"
    } ${hoverTextColor} ${hoverBackgroundColor}`;

  const handleToggleSidebar = () => {
    if (sidebarRef.current) {
      sidebarRef.current.toggleSidebar();
    }
  };

  const handleReset = () => {
    triggerRefresh();
  };

  const isChatUI = location.pathname === "/chat-ui";

  return (
    <TooltipProvider>
      <div
        className={`${
          isChatUI
            ? "fixed top-0 left-0 h-full w-20 flex flex-col justify-between items-center pt-6 pb-6"
            : "relative w-full flex justify-between items-center px-4 py-2 sm:px-5 sm:py-3"
        } bg-secondary shadow-xl z-50`}
      >
        <CustomToaster />
        <div
          className={`font-tt_a_mono flex ${
            isChatUI
              ? "flex-col items-center space-y-6"
              : "flex items-center space-x-6"
          }`}
        >
          <a
            href="https://www.tenstorrent.com"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center ${
              isChatUI ? "mb-6 justify-center" : ""
            }`}
          >
            <img
              src={logo}
              alt="Tenstorrent Logo"
              className="w-10 h-10 sm:w-14 sm:h-14 transform transition duration-300 hover:scale-110"
            />
            {!isChatUI && (
              <h4
                className={`hidden sm:block text-lg sm:text-2xl font-tt_a_mono ${textColor} ml-3 bold font-roboto`}
              >
                LLM Studio
              </h4>
            )}
          </a>
          <NavigationMenu
            className={`w-full ${isChatUI ? "mt-4" : "flex-grow"}`}
          >
            <NavigationMenuList
              className={`flex ${
                isChatUI
                  ? "flex-col items-center space-y-4"
                  : "justify-start space-x-4"
              }`}
            >
              <NavigationMenuItem
                className={`${isChatUI ? "w-full flex justify-center" : ""}`}
              >
                <NavLink
                  to="/"
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  <Home className={`mr-2 sm:mr-0 ${iconColor}`} />
                  {!isChatUI && <span className="ml-2 sm:ml-0">Home</span>}
                </NavLink>
              </NavigationMenuItem>
              {!isChatUI && (
                <Separator
                  className="h-6 w-px bg-zinc-400"
                  orientation="vertical"
                />
              )}
              <NavigationMenuItem
                className={`${isChatUI ? "w-full flex justify-center" : ""}`}
              >
                <NavLink
                  to="/models-deployed"
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  <BrainCog className={`mr-2 sm:mr-0 ${iconColor}`} />
                  {!isChatUI && (
                    <span className="ml-2 sm:ml-0">Models Deployed</span>
                  )}
                </NavLink>
              </NavigationMenuItem>
              {isChatUI && (
                <NavigationMenuItem
                  className={`${isChatUI ? "w-full flex justify-center" : ""}`}
                >
                  <NavLink
                    to="/chat-ui"
                    className={({ isActive }) => navLinkClass(isActive)}
                  >
                    <BotMessageSquare className={`mr-2 sm:mr-0 ${iconColor}`} />
                  </NavLink>
                </NavigationMenuItem>
              )}
            </NavigationMenuList>
          </NavigationMenu>
        </div>
        <div
          className={`flex ${
            isChatUI
              ? "flex-col items-center space-y-4 sm:space-y-6"
              : "flex-row items-center space-x-4 sm:space-x-6"
          } ${isChatUI ? "mt-auto" : ""}`}
        >
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
            className={`${
              isChatUI ? "w-10 h-px bg-zinc-400" : "h-6 w-px bg-zinc-400"
            }`}
            orientation={isChatUI ? "horizontal" : "vertical"}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <ResetIcon onReset={handleReset} /> {/* Pass the handler */}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <div>Reset Board</div>
            </TooltipContent>
          </Tooltip>
          <Separator
            className={`${
              isChatUI ? "w-10 h-px bg-zinc-400" : "h-6 w-px bg-zinc-400"
            }`}
            orientation={isChatUI ? "horizontal" : "vertical"}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <HelpIcon toggleSidebar={handleToggleSidebar} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" align="center">
              <div>Get Help</div>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <Sidebar ref={sidebarRef} />
    </TooltipProvider>
  );
};

export default NavBar;
