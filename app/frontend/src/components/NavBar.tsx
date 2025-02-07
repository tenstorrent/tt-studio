// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC


import { useMemo, useRef, useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Home,
  Boxes,
  BotMessageSquare,
  Notebook,
  FileText,
  Image,
  Eye,
  type LucideIcon,
} from "lucide-react";

import logo from "../assets/tt_logo.svg";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from "./ui/navigation-menu";
import { Separator } from "./ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

import ModeToggle from "./DarkModeToggle";
import HelpIcon from "./HelpIcon";
import Sidebar from "./SideBar";
import ResetIcon from "./ResetIcon";
import CustomToaster from "./CustomToaster";

import { useTheme } from "../providers/ThemeProvider";
import { useRefresh } from "../providers/RefreshContext";
import { useModels } from "../providers/ModelsContext";
import { handleModelNavigationClick } from "../api/modelsDeployedApis";

interface AnimatedIconProps {
  icon: LucideIcon;
  className?: string;
}

const AnimatedIcon: React.FC<AnimatedIconProps> = ({
  icon: Icon,
  ...props
}) => (
  <motion.div
    whileHover={{ scale: 1.2 }}
    whileTap={{ scale: 0.9 }}
    transition={{ type: "spring", stiffness: 400, damping: 17 }}
  >
    <Icon {...props} />
  </motion.div>
);

export default function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { triggerRefresh, refreshTrigger } = useRefresh();
  const { models, refreshModels } = useModels();
  const sidebarRef = useRef<{ toggleSidebar: () => void }>(null);

  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const textColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverTextColor =
    theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
  const activeBorderColor =
    theme === "dark" ? "border-TT-purple-accent" : "border-TT-purple-accent-2";
  const hoverBackgroundColor =
    theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";

  const navLinkClass = useMemo(
    () =>
      `flex items-center justify-center px-2 py-2 rounded-md text-sm font-medium ${textColor} transition-all duration-300 ease-in-out`,
    [textColor],
  );

  const getNavLinkClass = (isActive: boolean, isChatUIIcon = false) =>
    `${navLinkClass} ${
      isActive || (isChatUIIcon && location.pathname === "/chat-ui")
        ? `border-2 ${activeBorderColor}`
        : "border-transparent"
    } ${hoverTextColor} ${hoverBackgroundColor} hover:border-4 hover:scale-105 hover:shadow-lg dark:hover:shadow-TT-dark-shadow dark:hover:border-TT-light-border transition-all duration-300 ease-in-out`;

  const handleToggleSidebar = () => {
    if (sidebarRef.current) {
      sidebarRef.current.toggleSidebar();
    }
  };

  const handleReset = () => {
    triggerRefresh();
  };

  const handleNavigation = (route: string) => {
    if (models.length > 0) {
      const firstModel = models[0];
      if (firstModel.id && firstModel.name) {
        handleModelNavigationClick(firstModel.id, firstModel.name, navigate);
      } else {
        console.error("Model ID or name is undefined");
      }
    } else {
      navigate(route);
    }
  };

  const handleImageGenerationClick = () => {
    handleNavigation("/image-generation");
  };

  const handleChatUIClick = () => {
    handleNavigation("/models-deployed");
  };

  const handleObjectDetectionClick = () => {
    handleNavigation("/object-detection");
  };

  useEffect(() => {
    refreshModels();
  }, [refreshModels, refreshTrigger]);

  const isVerticalLayout = location.pathname === "/chat-ui" || location.pathname === "/image-generation";

  return (
    <div>
      <TooltipProvider>
        <div
          className={`${
            isVerticalLayout
              ? "fixed top-0 left-0 h-full w-20 flex flex-col items-center dark:border-b-4 dark:border-TT-dark rounded-r-3xl"
              : "relative w-full dark:border-b-4 dark:border-TT-dark rounded-b-3xl"
          } border-b-4 border-secondary dark:bg-TT-black bg-secondary shadow-xl z-50`}
        >
          <CustomToaster />
          <div
            className={`font-tt_a_mono flex ${
              isVerticalLayout
                ? "flex-col items-center"
                : "items-center justify-between"
            } w-full px-4 py-2 sm:px-5 sm:py-3`}
          >
            <a
              href="https://www.tenstorrent.com"
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center ${
                isVerticalLayout ? "mb-6 justify-center" : ""
              }`}
            >
              <motion.img
                src={logo}
                alt="Tenstorrent Logo"
                className="w-10 h-10 sm:w-14 sm:h-14"
                whileHover={{ scale: 1.1, rotate: 360 }}
                transition={{ type: "spring", stiffness: 300, damping: 10 }}
              />
              {!isVerticalLayout && (
                <h4
                  className={`hidden sm:block text-lg sm:text-2xl font-tt_a_mono ${textColor} ml-3 bold font-roboto`}
                >
                  TT-Studio
                </h4>
              )}
            </a>
            <NavigationMenu className={`w-full ${isVerticalLayout ? "mt-4" : ""}`}>
              <NavigationMenuList
                className={`flex ${
                  isVerticalLayout
                    ? "flex-col items-center space-y-4"
                    : "justify-between"
                }`}
              >
                <NavigationMenuItem
                  className={`${isVerticalLayout ? "w-full flex justify-center" : ""}`}
                >
                  <motion.div
                    whileHover={{ y: -2 }}
                    transition={{ type: "spring", stiffness: 300, damping: 10 }}
                  >
                    <NavLink
                      to="/"
                      className={({ isActive }) => getNavLinkClass(isActive)}
                    >
                      {isVerticalLayout ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AnimatedIcon
                              icon={Home}
                              className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Home</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <>
                        <AnimatedIcon
                          icon={Home}
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                        <span>Home</span>
                      </>
                    )}
                  </NavLink>
                </motion.div>
              </NavigationMenuItem>
              {!isVerticalLayout && (
                <Separator
                  className="h-6 w-px bg-zinc-400"
                  orientation="vertical"
                />
              )}
              <NavigationMenuItem
                className={`${isVerticalLayout ? "w-full flex justify-center" : ""}`}
              >
                <motion.div
                  whileHover={{ y: -2 }}
                  transition={{ type: "spring", stiffness: 300, damping: 10 }}
                >
                  <NavLink
                    to="/rag-management"
                    className={({ isActive }) => getNavLinkClass(isActive)}
                  >
                    {isVerticalLayout ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AnimatedIcon
                            icon={Notebook}
                            className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Rag Management</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <>
                        <AnimatedIcon
                          icon={Notebook}
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                        <span>Rag Management</span>
                      </>
                    )}
                  </NavLink>
                </motion.div>
              </NavigationMenuItem>
              {!isVerticalLayout && (
                <Separator
                  className="h-6 w-px bg-zinc-400"
                  orientation="vertical"
                />
              )}
              <NavigationMenuItem
                className={`${isVerticalLayout ? "w-full flex justify-center" : ""}`}
              >
                <motion.div
                  whileHover={{ y: -2 }}
                  transition={{ type: "spring", stiffness: 300, damping: 10 }}
                >
                  <NavLink
                    to="/models-deployed"
                    className={({ isActive }) => getNavLinkClass(isActive)}
                  >
                    {isVerticalLayout ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AnimatedIcon
                            icon={Boxes}
                            className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Models Deployed</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <>
                        <AnimatedIcon
                          icon={Boxes}
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                        <span>Models Deployed</span>
                      </>
                    )}
                  </NavLink>
                </motion.div>
              </NavigationMenuItem>
              {!isVerticalLayout && (
                <Separator
                  className="h-6 w-px bg-zinc-400"
                  orientation="vertical"
                />
              )}
              <NavigationMenuItem
                className={`${isVerticalLayout ? "w-full flex justify-center" : ""}`}
              >
                <NavLink
                  to="/logs"
                  className={({ isActive }) => getNavLinkClass(isActive)}
                >
                  {isVerticalLayout ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <FileText
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Logs</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <>
                      <FileText
                        className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                      />
                      <span>Logs</span>
                    </>
                  )}
                </NavLink>
              </NavigationMenuItem>
                {!isVerticalLayout && (
                  <Separator
                    className="h-6 w-px bg-zinc-400"
                    orientation="vertical"
                  />
                )}
                <NavigationMenuItem
                  className={`${isVerticalLayout ? "w-full flex justify-center" : ""}`}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleImageGenerationClick}
                        className={`${getNavLinkClass(false, true)} ${
                          models.length > 0
                            ? ""
                            : "opacity-50 cursor-not-allowed"
                        }`}
                      >
                        <Image
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                        {!isVerticalLayout && <span>Image Generation</span>}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {models.length > 0
                        ? "Open Image Generation"
                        : "Deploy a model to use Image Generation"}
                    </TooltipContent>
                  </Tooltip>
                </NavigationMenuItem>
                {!isVerticalLayout && (
                  <Separator
                    className="h-6 w-px bg-zinc-400"
                    orientation="vertical"
                  />
                )}
                <NavigationMenuItem
                  className={`${isVerticalLayout ? "w-full flex justify-center" : ""}`}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleChatUIClick}
                        className={`${getNavLinkClass(false, true)} ${
                          models.length > 0
                            ? ""
                            : "opacity-50 cursor-not-allowed"
                        }`}
                      >
                        <BotMessageSquare
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                        {!isVerticalLayout && <span>Chat UI</span>}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {models.length > 0
                        ? "Open Chat UI"
                        : "Deploy a model to use Chat UI"}
                    </TooltipContent>
                  </Tooltip>
                </NavigationMenuItem>
                {!isVerticalLayout && (
                  <Separator
                    className="h-6 w-px bg-zinc-400"
                    orientation="vertical"
                  />
                )}
                <NavigationMenuItem
                  className={`${isVerticalLayout ? "w-full flex justify-center" : ""}`}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleObjectDetectionClick}
                        className={`${getNavLinkClass(false)} ${
                          models.length > 0 ? "" : "opacity-50 cursor-not-allowed"
                        }`}
                      >
                        <Eye
                          className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
                        />
                        {!isVerticalLayout && <span>Object Detection</span>}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {models.length > 0
                        ? "Open Object Detection"
                        : "Deploy a model to use Object Detection"}
                    </TooltipContent>
                  </Tooltip>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
            {!isVerticalLayout && (
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
          {isVerticalLayout && (
            <div className="mt-auto flex flex-col items-center mb-4 space-y-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <ModeToggle />
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Toggle Dark/Light Mode</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <ResetIcon onReset={handleReset} />
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reset Board</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <HelpIcon toggleSidebar={handleToggleSidebar} />
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Get Help</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
          <Sidebar ref={sidebarRef} />
        </div>
      </TooltipProvider>
    </div>
  );
}

