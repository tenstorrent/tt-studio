// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { useRef, useEffect, forwardRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Home,
  Boxes,
  BotMessageSquare,
  Notebook,
  FileText,
  Eye,
  AudioLines,
  Image,
  ChevronRight,
  ChevronLeft,
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
import ResetIcon from "./ResetIcon";
import CustomToaster from "./CustomToaster";
import Sidebar from "./SideBar";

import { useTheme } from "../providers/ThemeProvider";
import { useRefresh } from "../providers/RefreshContext";
import { useModels } from "../providers/ModelsContext";
import { handleModelNavigationClick } from "../api/modelsDeployedApis";

// Interfaces for our components
interface AnimatedIconProps {
  icon: LucideIcon;
  className?: string;
  [key: string]: any;
}

interface NavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  tooltip?: string;
  isChatUI: boolean;
  iconColor: string;
  getNavLinkClass: (isActive: boolean) => string;
  isMobile?: boolean;
}

interface ButtonNavItemProps {
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  isChatUI: boolean;
  iconColor: string;
  getNavLinkClass: (isActive: boolean, isChatUIIcon?: boolean) => string;
  isActive?: boolean;
  isDisabled?: boolean;
  tooltipText: string;
  isMobile?: boolean;
}

// Type for components used in action buttons
interface ActionButtonProps {
  icon: React.ComponentType<any>;
  onClick: (() => void) | null;
  tooltipText: string;
}

// Animated icon component
const AnimatedIcon = forwardRef<HTMLDivElement, AnimatedIconProps>(
  ({ icon: Icon, ...props }, ref) => (
    <motion.div
      ref={ref}
      whileHover={{ scale: 1.2 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
    >
      <Icon {...props} />
    </motion.div>
  )
);

AnimatedIcon.displayName = "AnimatedIcon";

// NavItem component for standard navigation links
const NavItem: React.FC<NavItemProps> = ({
  to,
  icon: Icon,
  label,
  tooltip,
  isChatUI,
  iconColor,
  getNavLinkClass,
  isMobile = false,
}) => (
  <NavigationMenuItem className={isChatUI ? "w-full flex justify-center" : ""}>
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 300, damping: 10 }}
      className={`flex ${isChatUI ? "justify-center" : "justify-start"} w-full`}
    >
      <NavLink
        to={to}
        className={({ isActive }) =>
          `${getNavLinkClass(isActive)} flex ${isChatUI ? "justify-center" : "justify-start"} items-center`
        }
      >
        {isChatUI || isMobile ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <AnimatedIcon
                icon={Icon}
                className={`${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
              />
            </TooltipTrigger>
            <TooltipContent>
              <p>{tooltip || label}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <>
            <AnimatedIcon
              icon={Icon}
              className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
            />
            <span>{label}</span>
          </>
        )}
      </NavLink>
    </motion.div>
  </NavigationMenuItem>
);

// ButtonNavItem component for button-based navigation
const ButtonNavItem: React.FC<ButtonNavItemProps> = ({
  onClick,
  icon: Icon,
  label,
  isChatUI,
  iconColor,
  getNavLinkClass,
  isActive = false,
  isDisabled = false,
  tooltipText = "",
  isMobile = false,
}) => (
  <NavigationMenuItem className={isChatUI ? "w-full flex justify-center" : ""}>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`${getNavLinkClass(isActive, label === "Chat UI")} ${
            isDisabled ? "opacity-50 cursor-not-allowed" : ""
          } flex ${isChatUI ? "justify-center" : "justify-start"} items-center w-full`}
        >
          <Icon
            className={`${isChatUI || isMobile ? "" : "mr-2"} ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
          />
          {!isChatUI && !isMobile && <span>{label}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  </NavigationMenuItem>
);

// Action button component for the utility actions
const ActionButton: React.FC<ActionButtonProps> = ({
  icon: IconComponent,
  onClick,
  tooltipText,
}) => {
  // Handle different component types - some use onReset, others use onClick directly
  const renderIcon = () => {
    if (IconComponent === ModeToggle) {
      return <ModeToggle />;
    } else if (IconComponent === ResetIcon) {
      // Only pass onReset if onClick is not null
      return onClick ? (
        <ResetIcon onReset={onClick} />
      ) : (
        <ResetIcon onReset={() => {}} />
      );
    } else if (IconComponent === HelpIcon) {
      return onClick ? (
        <HelpIcon toggleSidebar={onClick} />
      ) : (
        <HelpIcon toggleSidebar={() => {}} />
      );
    } else {
      // Fallback for any other icon component
      return <IconComponent />;
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
          {renderIcon()}
        </motion.div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
};

// Define types for our navigation and action items
interface NavItemType {
  type: "link";
  to: string;
  icon: LucideIcon;
  label: string;
  tooltip?: string;
}

interface ButtonNavItemType {
  type: "button";
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  isDisabled: boolean;
  tooltipText: string;
  route?: string; // Optional route property for active state detection
}

type NavItemData = NavItemType | ButtonNavItemType;

interface ActionButtonType {
  icon: React.ComponentType<any>;
  tooltipText: string;
  onClick: (() => void) | null;
}

export default function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { triggerRefresh, refreshTrigger } = useRefresh();
  const { models, refreshModels } = useModels();
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [isHorizontalExpanded, setIsHorizontalExpanded] = useState(false);
  const sidebarRef = useRef<{ toggleSidebar: () => void }>(null);

  const isDeployedEnabled = import.meta.env.VITE_ENABLE_DEPLOYED === "true";

  // Check if we're in Chat UI mode
  const isChatUI =
    location.pathname === "/chat-ui" ||
    location.pathname === "/image-generation";

  // Track window resize for responsive behavior
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      // Close mobile menu on resize to prevent weird states
      if (isMobileMenuOpen && window.innerWidth >= 640) {
        setIsMobileMenuOpen(false);
      }
      // Reset expanded state on resize
      if (window.innerWidth >= 640) {
        setIsHorizontalExpanded(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [isMobileMenuOpen]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isMobileMenuOpen &&
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node)
      ) {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    refreshModels();
  }, [refreshModels, refreshTrigger]);

  // Determine if mobile view should be used
  const isMobile = windowWidth < 640;

  // Hide navbar when in mobile AND chat UI mode
  if (isMobile && isChatUI) {
    return null;
  }

  const shouldUseVerticalNav = isChatUI; // Use vertical nav in Chat UI for non-mobile
  const shouldShowMobileMenu = isMobile && !shouldUseVerticalNav;

  const isRouteActive = (route: string): boolean => {
    return location.pathname === route;
  };

  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const textColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverTextColor =
    theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
  const activeBorderColor =
    theme === "dark" ? "border-TT-purple-accent" : "border-TT-purple-accent-2";
  const hoverBackgroundColor =
    theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";

  const navLinkClass = `flex items-center justify-center px-2 py-2 rounded-md text-sm font-medium ${textColor} transition-all duration-300 ease-in-out`;

  const getNavLinkClass = (isActive: boolean, isChatUIIcon = false): string => {
    return `${navLinkClass} ${
      isActive ||
      (isChatUIIcon &&
        (location.pathname === "/chat-ui" ||
          location.pathname === "/image-generation"))
        ? `border-2 ${activeBorderColor}`
        : "border-transparent"
    } ${hoverTextColor} ${hoverBackgroundColor} hover:border-4 hover:scale-105 hover:shadow-lg dark:hover:shadow-TT-dark-shadow dark:hover:border-TT-light-border transition-all duration-300 ease-in-out`;
  };

  const handleReset = (): void => {
    triggerRefresh();
  };

  const handleToggleSidebar = () => {
    if (sidebarRef.current) {
      sidebarRef.current.toggleSidebar();
    }
  };

  const handleNavigation = (route: string): void => {
    if (isDeployedEnabled) {
      navigate(route);
      return;
    }

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

  const toggleHorizontalExpand = (): void => {
    setIsHorizontalExpanded(!isHorizontalExpanded);
  };

  // Define base navigation items always shown regardless of flags
  const baseNavItems: NavItemData[] = [
    {
      type: "link",
      to: "/",
      icon: Home,
      label: "Home",
    },
    {
      type: "link",
      to: "/rag-management",
      icon: Notebook,
      label: "Rag Management",
      tooltip: "Manage Retrieval Augmented Generation data",
    },
  ];

  // Define deployed feature navigation items (shown only when isDeployedEnabled is false)
  const deployedNavItems: NavItemData[] = [
    {
      type: "link",
      to: "/models-deployed",
      icon: Boxes,
      label: "Models Deployed",
    },
    {
      type: "link",
      to: "/logs",
      icon: FileText,
      label: "Logs",
    },
  ];

  // Define model-based navigation items (shown only when isDeployedEnabled is true)
  // When isDeployedEnabled is true, we assume models are already active and available
  const modelNavItems: NavItemData[] = [
    {
      type: "button",
      icon: BotMessageSquare,
      label: "Chat UI",
      onClick: () => handleNavigation("/chat-ui"),
      isDisabled: !isDeployedEnabled && models.length === 0, // Only disabled when not enabled and no models
      tooltipText: isDeployedEnabled
        ? "Chat UI with Llama 3.1 70B"
        : models.length > 0
          ? "Chat UI with Llama 3.1 70B"
          : "Deploy a model to use Chat UI with Llama 3.1 70B",
      route: "/chat-ui", // Add route for active state detection
    },
    {
      type: "button",
      icon: Image,
      label: "Image Generation",
      onClick: handleImageGenerationClick,
      isDisabled: !isDeployedEnabled && models.length === 0,
      tooltipText: isDeployedEnabled
        ? "Open Image Generation"
        : models.length > 0
          ? "Open Image Generation"
          : "Deploy a model to use Image Generation",
      route: "/image-generation",
    },
    {
      type: "button",
      icon: Eye,
      label: "Object Detection",
      onClick: () => handleNavigation("/object-detection"),
      isDisabled: !isDeployedEnabled && models.length === 0, // Only disabled when not enabled and no models
      tooltipText: isDeployedEnabled
        ? "Object Detection with YOLOv5"
        : models.length > 0
          ? "Object Detection with YOLOv5"
          : "Deploy a model to use Object Detection with YOLOv5",
      route: "/object-detection", // Add route for active state detection
    },
    {
      type: "button",
      icon: AudioLines,
      label: "Whisper Detection",
      onClick: () => handleNavigation("/audio-detection"),
      isDisabled: !isDeployedEnabled && models.length === 0, // Only disabled when not enabled and no models
      tooltipText: isDeployedEnabled
        ? "Audio Transcription with Whisper Model"
        : models.length > 0
          ? "Audio Transcription with Whisper Model"
          : "Deploy a model to use Whisper Model Audio Transcription",
      route: "/audio-detection", // Add route for active state detection
    },
  ];

  // Select the appropriate navigation items based on the environment variable
  const navItems: NavItemData[] = [
    ...baseNavItems,
    ...(isDeployedEnabled ? modelNavItems : deployedNavItems),
  ];

  // Define action buttons based on deployment state - include HelpIcon
  const actionButtons: ActionButtonType[] = [
    {
      icon: ModeToggle,
      tooltipText: "Toggle Dark/Light Mode",
      onClick: null, // ModeToggle handles its own click
    },
    ...(isDeployedEnabled
      ? []
      : [
          {
            icon: ResetIcon,
            tooltipText: "Reset Board",
            onClick: handleReset,
          },
        ]),
    {
      icon: HelpIcon,
      tooltipText: "Get Help",
      onClick: handleToggleSidebar,
    },
  ];

  // Render vertical navbar for chat UI mode (non-mobile)
  if (shouldUseVerticalNav) {
    return (
      <TooltipProvider>
        <div className="h-screen w-16 fixed left-0 top-0 dark:border-r-4 dark:border-TT-dark border-r-4 border-secondary dark:bg-TT-black bg-secondary shadow-xl z-50">
          <CustomToaster />
          <div className="font-tt_a_mono flex flex-col items-center justify-between h-full py-4">
            {/* Logo */}
            <div className="flex flex-col items-center">
              <a
                href="https://www.tenstorrent.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mb-6"
              >
                <motion.img
                  src={logo}
                  alt="Tenstorrent Logo"
                  className="w-10 h-10"
                  whileHover={{ scale: 1.1, rotate: 360 }}
                  transition={{ type: "spring", stiffness: 300, damping: 10 }}
                />
              </a>

              {/* Navigation Menu */}
              <NavigationMenu orientation="vertical" className="w-full">
                <NavigationMenuList className="flex flex-col space-y-4 list-none">
                  {navItems.map((item) => (
                    <div key={item.label}>
                      {item.type === "link" ? (
                        <NavItem
                          to={item.to}
                          icon={item.icon}
                          label={item.label}
                          tooltip={item.tooltip}
                          isChatUI={true}
                          iconColor={iconColor}
                          getNavLinkClass={getNavLinkClass}
                        />
                      ) : (
                        <ButtonNavItem
                          onClick={item.onClick}
                          icon={item.icon}
                          label={item.label}
                          isChatUI={true}
                          iconColor={iconColor}
                          getNavLinkClass={getNavLinkClass}
                          isActive={
                            item.type === "button" && item.route
                              ? isRouteActive(item.route)
                              : false
                          }
                          isDisabled={item.isDisabled}
                          tooltipText={item.tooltipText}
                        />
                      )}
                    </div>
                  ))}
                </NavigationMenuList>
              </NavigationMenu>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col items-center space-y-4">
              {actionButtons.map((button) => (
                <ActionButton
                  key={button.tooltipText}
                  icon={button.icon}
                  onClick={button.onClick}
                  tooltipText={button.tooltipText}
                />
              ))}
            </div>
          </div>
          <Sidebar ref={sidebarRef} />
        </div>
      </TooltipProvider>
    );
  }

  // Horizontal navbar on mobile screens
  if (shouldShowMobileMenu) {
    return (
      <TooltipProvider>
        <div className="fixed top-0 w-full dark:border-b-4 dark:border-TT-dark border-b-4 border-secondary dark:bg-TT-black bg-secondary shadow-xl z-50">
          <CustomToaster />
          <div className="font-tt_a_mono flex items-center justify-between w-full px-2 py-2">
            {/* Logo */}
            <a
              href="https://www.tenstorrent.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center"
            >
              <motion.img
                src={logo}
                alt="Tenstorrent Logo"
                className="w-8 h-8"
                whileHover={{ scale: 1.1, rotate: 360 }}
                transition={{ type: "spring", stiffness: 300, damping: 10 }}
              />
            </a>

            <div className="flex items-center">
              {/* Show all nav icons by default */}
              <div className="flex items-center space-x-1 list-none">
                {navItems.map((item) => (
                  <div key={item.label}>
                    {item.type === "link" ? (
                      <NavItem
                        to={item.to}
                        icon={item.icon}
                        label={item.label}
                        tooltip={item.tooltip}
                        isChatUI={false}
                        iconColor={iconColor}
                        getNavLinkClass={getNavLinkClass}
                        isMobile={true}
                      />
                    ) : (
                      <ButtonNavItem
                        onClick={item.onClick}
                        icon={item.icon}
                        label={item.label}
                        isChatUI={false}
                        iconColor={iconColor}
                        getNavLinkClass={getNavLinkClass}
                        isActive={
                          item.type === "button" && item.route
                            ? isRouteActive(item.route)
                            : false
                        }
                        isDisabled={item.isDisabled}
                        tooltipText={item.tooltipText}
                        isMobile={true}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Expand button - only show if needed */}
              {isHorizontalExpanded ? (
                <button
                  onClick={toggleHorizontalExpand}
                  className="focus:outline-none ml-2"
                  aria-label="Collapse menu"
                >
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <ChevronLeft className={`w-6 h-6 ${iconColor}`} />
                  </motion.div>
                </button>
              ) : (
                <button
                  onClick={toggleHorizontalExpand}
                  className="focus:outline-none ml-2"
                  aria-label="Expand menu"
                >
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <ChevronRight className={`w-6 h-6 ${iconColor}`} />
                  </motion.div>
                </button>
              )}
            </div>
          </div>

          {/* Expanded Horizontal Menu */}
          {isHorizontalExpanded && (
            <motion.div
              ref={mobileMenuRef}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full bg-secondary dark:bg-TT-black py-2 px-4 shadow-md"
            >
              <NavigationMenu className="w-full">
                <NavigationMenuList className="flex flex-wrap gap-3 justify-center list-none">
                  {navItems.map((item) => (
                    <div key={item.label} className="">
                      {item.type === "link" ? (
                        <NavItem
                          to={item.to}
                          icon={item.icon}
                          label={item.label}
                          tooltip={item.tooltip}
                          isChatUI={false}
                          iconColor={iconColor}
                          getNavLinkClass={getNavLinkClass}
                          isMobile={false}
                        />
                      ) : (
                        <ButtonNavItem
                          onClick={item.onClick}
                          icon={item.icon}
                          label={item.label}
                          isChatUI={false}
                          iconColor={iconColor}
                          getNavLinkClass={getNavLinkClass}
                          isActive={
                            item.type === "button" && item.route
                              ? isRouteActive(item.route)
                              : false
                          }
                          isDisabled={item.isDisabled}
                          tooltipText={item.tooltipText}
                          isMobile={false}
                        />
                      )}
                    </div>
                  ))}
                </NavigationMenuList>
              </NavigationMenu>

              {/* Action Buttons in Expanded Menu */}
              <div className="flex justify-center mt-4 pb-2">
                {actionButtons.map((button) => (
                  <ActionButton
                    key={button.tooltipText}
                    icon={button.icon}
                    onClick={button.onClick}
                    tooltipText={button.tooltipText}
                  />
                ))}
              </div>
            </motion.div>
          )}
          <Sidebar ref={sidebarRef} />
        </div>
      </TooltipProvider>
    );
  }

  // Original horizontal navbar for normal mode and larger screens
  return (
    <TooltipProvider>
      <div className="relative w-full dark:border-b-4 dark:border-TT-dark rounded-b-3xl border-b-4 border-secondary dark:bg-TT-black bg-secondary shadow-xl z-50">
        <CustomToaster />
        <div className="font-tt_a_mono flex items-center justify-between w-full px-4 py-2 sm:px-5 sm:py-3">
          {/* Logo */}
          <a
            href="https://www.tenstorrent.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center"
          >
            <motion.img
              src={logo}
              alt="Tenstorrent Logo"
              className="w-10 h-10 sm:w-14 sm:h-14"
              whileHover={{ scale: 1.1, rotate: 360 }}
              transition={{ type: "spring", stiffness: 300, damping: 10 }}
            />
            <h4
              className={`hidden sm:block text-lg sm:text-2xl font-tt_a_mono ${textColor} ml-3 bold font-roboto`}
            >
              {isDeployedEnabled ? "AI Playground" : "TT-Studio"}
            </h4>
          </a>

          {/* Navigation Menu */}
          <NavigationMenu className="w-full px-4">
            <NavigationMenuList className="flex justify-between list-none">
              {navItems.map((item, index) => (
                <div key={item.label} className="flex items-center">
                  {item.type === "link" ? (
                    <NavItem
                      to={item.to}
                      icon={item.icon}
                      label={item.label}
                      tooltip={item.tooltip}
                      isChatUI={false}
                      iconColor={iconColor}
                      getNavLinkClass={getNavLinkClass}
                      isMobile={isMobile}
                    />
                  ) : (
                    <ButtonNavItem
                      onClick={item.onClick}
                      icon={item.icon}
                      label={item.label}
                      isChatUI={false}
                      iconColor={iconColor}
                      getNavLinkClass={getNavLinkClass}
                      isActive={
                        item.type === "button" && item.route
                          ? isRouteActive(item.route)
                          : false
                      }
                      isDisabled={item.isDisabled}
                      tooltipText={item.tooltipText}
                      isMobile={isMobile}
                    />
                  )}
                  {index < navItems.length - 1 && (
                    <Separator
                      className="h-6 w-px bg-zinc-400 mx-1"
                      orientation="vertical"
                    />
                  )}
                </div>
              ))}
            </NavigationMenuList>
          </NavigationMenu>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2 sm:space-x-4">
            {actionButtons.map((button, index) => (
              <div key={button.tooltipText} className="flex items-center">
                <ActionButton
                  icon={button.icon}
                  onClick={button.onClick}
                  tooltipText={button.tooltipText}
                />
                {index < actionButtons.length - 1 && (
                  <Separator
                    className="h-6 w-px bg-zinc-400 ml-2"
                    orientation="vertical"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <Sidebar ref={sidebarRef} />
      </div>
    </TooltipProvider>
  );
}
