// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useMemo, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import logo from "../assets/tt_logo.svg";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from "./ui/navigation-menu";
import { Home, BrainCog, BotMessageSquare, Notebook } from "lucide-react";
import ModeToggle from "./DarkModeToggle";
import HelpIcon from "./HelpIcon";
import { Separator } from "./ui/separator";
import Sidebar from "./SideBar";
import { useTheme } from "../providers/ThemeProvider";
import ResetIcon from "./ResetIcon";
import CustomToaster from "./CustomToaster";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { useRefresh } from "../providers/RefreshContext";

export default function NavBar() {
  const location = useLocation();
  const { theme } = useTheme();
  const { triggerRefresh } = useRefresh();
  const sidebarRef = useRef<{ toggleSidebar: () => void }>(null);

  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const textColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverTextColor =
    theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
  const activeBorderColor =
    theme === "dark" ? "border-zinc-400" : "border-black";
  const hoverBackgroundColor =
    theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";

  const navLinkClass = useMemo(
    () =>
      `flex items-center justify-center px-2 py-2 rounded-md text-sm font-medium ${textColor} transition-all duration-300 ease-in-out`,
    [textColor],
  );

  const getNavLinkClass = (isActive: boolean) =>
    `${navLinkClass} ${
      isActive ? `border-2 ${activeBorderColor}` : "border-transparent"
    } ${hoverTextColor} ${hoverBackgroundColor} hover:border-4 hover:scale-105 hover:shadow-lg dark:hover:shadow-TT-dark-shadow dark:hover:border-TT-light-border transition-all duration-300 ease-in-out`;

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
            ? "fixed top-0 left-0 h-full w-20 flex flex-col items-center dark:border-b-4 dark:border-TT-dark"
            : "relative w-full dark:border-b-4 dark:border-TT-dark"
        } border-b-4 border-secondary dark:bg-TT-black bg-secondary shadow-xl z-50`}
      >
        <CustomToaster />
        <div
          className={`font-tt_a_mono flex ${
            isChatUI ? "flex-col items-center" : "items-center justify-between"
          } w-full px-4 py-2 sm:px-5 sm:py-3`}
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
          <NavigationMenu className={`w-full ${isChatUI ? "mt-4" : ""}`}>
            <NavigationMenuList
              className={`flex ${
                isChatUI ? "flex-col items-center space-y-4" : "justify-between"
              }`}
            >
              <NavigationMenuItem
                className={`${isChatUI ? "w-full flex justify-center" : ""}`}
              >
                <NavLink
                  to="/"
                  className={({ isActive }) => getNavLinkClass(isActive)}
                >
                  {isChatUI ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Home
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Home</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <>
                      <Home
                        className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                      />
                      <span>Home</span>
                    </>
                  )}
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
                  to="/rag-management"
                  className={({ isActive }) => getNavLinkClass(isActive)}
                >
                  {isChatUI ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Notebook
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Rag Management</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <>
                      <Notebook
                        className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                      />
                      <span>Rag Management</span>
                    </>
                  )}
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
                  className={({ isActive }) => getNavLinkClass(isActive)}
                >
                  {isChatUI ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <BrainCog
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Models Deployed</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <>
                      <BrainCog
                        className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                      />
                      <span>Models Deployed</span>
                    </>
                  )}
                </NavLink>
              </NavigationMenuItem>
              {isChatUI && (
                <NavigationMenuItem
                  className={`${isChatUI ? "w-full flex justify-center" : ""}`}
                >
                  <NavLink
                    to="/chat-ui"
                    className={({ isActive }) => getNavLinkClass(isActive)}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <BotMessageSquare
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Chat UI</p>
                      </TooltipContent>
                    </Tooltip>
                  </NavLink>
                </NavigationMenuItem>
              )}
            </NavigationMenuList>
          </NavigationMenu>
          {!isChatUI && (
            <div className={`flex items-center space-x-2 sm:space-x-4`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <ModeToggle />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Toggle Dark/Light Mode</p>
                </TooltipContent>
              </Tooltip>
              <Separator
                className="h-6 w-px bg-zinc-400"
                orientation="vertical"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <ResetIcon onReset={handleReset} />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reset Board</p>
                </TooltipContent>
              </Tooltip>
              <Separator
                className="h-6 w-px bg-zinc-400"
                orientation="vertical"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <HelpIcon toggleSidebar={handleToggleSidebar} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" align="center">
                  <p>Get Help</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
        {isChatUI && (
          <div className="mt-auto flex flex-col items-center mb-4 space-y-4">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <ModeToggle />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Toggle Dark/Light Mode</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <ResetIcon onReset={handleReset} />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reset Board</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <HelpIcon toggleSidebar={handleToggleSidebar} />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Get Help</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        <Sidebar ref={sidebarRef} />
      </div>
    </TooltipProvider>
  );
}
