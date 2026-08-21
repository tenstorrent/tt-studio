// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useRef, useEffect, forwardRef, useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Home,
  Boxes,
  BotMessageSquare,
  Notebook,
  Image,
  Eye,
  AudioLines,
  Mic,
  Volume2,
  ScanFace,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  BrainCog,
  Video,
  type LucideIcon,
  History,
  Settings as SettingsIcon,
  Workflow,
  PanelLeft,
  Plus,
  LayoutGrid,
} from "lucide-react";

import { useLogo } from "../utils/logo";
import { useStrayContainers } from "../hooks/useStrayContainers";

import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from "./ui/navigation-menu";
import { Separator } from "./ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import ModeToggle from "./DarkModeToggle";
import ResetIcon from "./ResetIcon";
import { BugReportButton } from "./bug-report/BugReportButton";
import SettingsDialog from "./SettingsDialog";
import { Button } from "./ui/button";

import { useTheme } from "../hooks/useTheme";
import { useRefresh } from "../hooks/useRefresh";
import { useModels } from "../hooks/useModels";
import {
  handleModelNavigationClick,
  getDestinationFromModelType,
  ModelType,
  getModelTypeFromName,
  getModelTypeFromBackendType,
  fetchModelHealth,
} from "../api/modelsDeployedApis";
import type { HealthStatus } from "../types/models";

// Interfaces for our components
interface AnimatedIconProps {
  icon: LucideIcon;
  className?: string;
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
  icon: React.ComponentType<Record<string, unknown>>;
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
          className={`${getNavLinkClass(isActive, label === "Chat UI")} ${isDisabled ? "opacity-50 cursor-not-allowed" : ""
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

// Grouped dropdown for the horizontal desktop navbar. Renders a trigger styled
// like a regular nav link and lists the group's items in a dropdown; the
// trigger takes the active border when any child route is the current one.
interface NavDropdownProps {
  label: string;
  icon: LucideIcon;
  items: NavItemData[];
  iconColor: string;
  getNavLinkClass: (isActive: boolean) => string;
  isRouteActive: (route: string) => boolean;
  onNavigate: (to: string) => void;
}

const NavDropdown: React.FC<NavDropdownProps> = ({
  label,
  icon: Icon,
  items,
  iconColor,
  getNavLinkClass,
  isRouteActive,
  onNavigate,
}) => {
  const isActive = items.some((item) =>
    item.type === "link"
      ? isRouteActive(item.to)
      : item.route
        ? isRouteActive(item.route)
        : false
  );
  return (
    <NavigationMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={`${getNavLinkClass(isActive)} flex justify-start items-center`}
          >
            <Icon
              className={`mr-2 ${iconColor} transition-colors duration-300 ease-in-out hover:text-TT-purple`}
            />
            <span>{label}</span>
            <ChevronDown className={`ml-1 h-4 w-4 ${iconColor}`} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="font-tt_a_mono">
          {items.map((item, index) => (
            <DropdownMenuItem
              key={`${item.label}-${index}`}
              disabled={item.type === "button" && item.isDisabled}
              title={item.type === "link" ? item.tooltip : item.tooltipText}
              className="cursor-pointer"
              onSelect={() =>
                item.type === "link" ? onNavigate(item.to) : item.onClick()
              }
            >
              <item.icon className="mr-2 h-4 w-4" />
              <span>{item.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </NavigationMenuItem>
  );
};

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
        <ResetIcon onReset={() => { }} />
      );
      // HelpIcon handling removed
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
  icon: React.ComponentType<Record<string, unknown>>;
  tooltipText: string;
  onClick: (() => void) | null;
}

export default function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { triggerRefresh, refreshTrigger } = useRefresh();
  const { models, refreshModels } = useModels();
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [isHorizontalExpanded, setIsHorizontalExpanded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Sidebar reference removed
  const { logoUrl } = useLogo();

  const isDeployedEnabled = import.meta.env.VITE_ENABLE_DEPLOYED === "true";

  // A model shows up in `models` (from the deployments endpoint) as soon as its
  // container exists, but it isn't usable until it finishes warming up. Probe the
  // authoritative readiness endpoint (the same one HealthBadge uses) so navbar
  // entries only appear once a model is healthy. Poll on a light interval, keyed
  // on the set of deployed model ids so the interval isn't torn down on every
  // 5s provider refresh.
  const [healthById, setHealthById] = useState<Record<string, HealthStatus>>({});
  const modelIdsKey = useMemo(
    () => models.map((m) => m.id).sort().join(","),
    [models]
  );

  useEffect(() => {
    const ids = modelIdsKey ? modelIdsKey.split(",") : [];
    if (ids.length === 0) {
      setHealthById({});
      return;
    }
    let cancelled = false;
    const probe = async () => {
      const entries = await Promise.all(
        ids.map(async (id) => [id, await fetchModelHealth(id)] as const)
      );
      if (!cancelled) setHealthById(Object.fromEntries(entries));
    };
    probe();
    const intervalId = setInterval(probe, 5000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [modelIdsKey]);

  // Only models that are actually healthy/usable should surface in the navbar.
  const healthyModels = useMemo(
    () => models.filter((m) => healthById[m.id] === "healthy"),
    [models, healthById]
  );

  // Voice agent requires all three model types: LLM/VLM, speech recognition (Whisper), and TTS
  const isVoiceAgentReady = useMemo(() => {
    const getType = (m: (typeof healthyModels)[number]) =>
      m.model_type
        ? getModelTypeFromBackendType(m.model_type)
        : getModelTypeFromName(m.name, m.image);
    const hasLlm = healthyModels.some((m) => {
      const t = getType(m);
      return t === ModelType.ChatModel || t === ModelType.VLM;
    });
    const hasStt = healthyModels.some(
      (m) => getType(m) === ModelType.SpeechRecognitionModel
    );
    const hasTts = healthyModels.some((m) => getType(m) === ModelType.TTS);
    return hasLlm && hasStt && hasTts;
  }, [healthyModels]);

  // Surface the Register Model entry only when there's a stray container to adopt.
  const { hasStray } = useStrayContainers();

  // Workflows and Canvas both drive an LLM/VLM under the hood, so they're only
  // usable once a chat-capable model is healthy. Gate the navbar entries the
  // same way we gate Voice Agent / Coding Agents.
  const isLlmReady = useMemo(
    () =>
      healthyModels.some((m) => {
        const t = m.model_type
          ? getModelTypeFromBackendType(m.model_type)
          : getModelTypeFromName(m.name, m.image);
        return t === ModelType.ChatModel || t === ModelType.VLM;
      }),
    [healthyModels],
  );

  // Check if we're in Chat UI, Image Generation, Video Generation, Workflows, or Canvas mode
  const isChatUI = location.pathname === "/chat";
  const isImageGeneration = location.pathname === "/image-generation";
  const isVideoGeneration = location.pathname === "/video-generation";
  const isWorkflows = location.pathname === "/workflows";
  const isCanvas = location.pathname === "/canvas";
  const shouldUseVerticalNav =
    isChatUI || isImageGeneration || isVideoGeneration || isWorkflows || isCanvas;

  // console.log("Path:", location.pathname);
  // console.log("isChatUI:", isChatUI);
  // console.log("isImageGeneration:", isImageGeneration);
  // console.log("shouldUseVerticalNav:", shouldUseVerticalNav);

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

  // Dark/light mode toggle is disabled; force dark mode.
  useEffect(() => {
    if (theme !== "dark") {
      setTheme("dark");
    }
  }, [theme, setTheme]);

  const isMobile = windowWidth < 640;

  if (isMobile && (isChatUI || isCanvas)) {
    return null;
  }

  const shouldShowMobileMenu = isMobile && !shouldUseVerticalNav;

  const isRouteActive = (route: string): boolean => {
    return location.pathname === route;
  };

  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const textColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverTextColor =
    theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
  const activeBorderColor = "border-TT-purple-accent";
  const hoverBackgroundColor =
    theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-300";

  const navLinkClass = `flex items-center justify-center px-2 py-2 rounded-md text-sm font-medium ${textColor} transition-all duration-300 ease-in-out`;

  const getNavLinkClass = (isActive: boolean): string => {
    return `${navLinkClass} ${isActive ? `border-2 ${activeBorderColor}` : "border-transparent"
      } ${hoverTextColor} ${hoverBackgroundColor} hover:border-4 hover:scale-105 hover:shadow-lg dark:hover:shadow-TT-dark-shadow dark:hover:border-TT-light-border transition-all duration-300 ease-in-out`;
  };

  const handleReset = (): void => {
    triggerRefresh();
  };

  // Sidebar toggle function removed

  const handleNavigation = (route: string): void => {
    if (isDeployedEnabled) {
      navigate(route);
      return;
    }

    if (models.length > 0) {
      const firstModel = models[0];
      if (firstModel.id && firstModel.name) {
        handleModelNavigationClick(
          firstModel.id,
          firstModel.name,
          navigate,
          firstModel.model_type
        );
      } else {
        console.error("Model ID or name is undefined");
      }
    } else {
      navigate(route);
    }
  };

  // Removed unused handleImageGenerationClick - functionality is already handled by handleNavigation

  const toggleHorizontalExpand = (): void => {
    setIsHorizontalExpanded(!isHorizontalExpanded);
  };

  const getNavIconFromModelType = (model_type: string): LucideIcon => {
    switch (model_type) {
      case ModelType.ChatModel:
      case ModelType.VLM:
      case ModelType.Embedding:
        return BotMessageSquare;
      case ModelType.ImageGeneration:
        return Image;
      case ModelType.VideoGeneration:
        return Video;
      case ModelType.ObjectDetectionModel:
      case ModelType.CNN:
        return Eye;
      case ModelType.SpeechRecognitionModel:
        return AudioLines;
      case ModelType.FaceRecognitionModel:
        return ScanFace;
      case ModelType.TTS:
        return Volume2;
      case ModelType.Training:
        return BrainCog;
      default:
        return BotMessageSquare;
    }
  };

  const getModelPageNameFromModelType = (model_type: string) => {
    switch (model_type) {
      case ModelType.ChatModel:
        return "Chat UI";
      case ModelType.VLM:
        return "Chat UI";
      case ModelType.ImageGeneration:
        return "Image Generation";
      case ModelType.VideoGeneration:
        return "Video Generation";
      case ModelType.ObjectDetectionModel:
        return "Object Detection";
      case ModelType.CNN:
        return "Object Detection";
      case ModelType.SpeechRecognitionModel:
        return "Speech to Text";
      case ModelType.FaceRecognitionModel:
        return "Face Recognition";
      case ModelType.TTS:
        return "Text to Speech";
      case ModelType.Embedding:
        return "Chat UI";
      case ModelType.Training:
        return "Training";
      default:
        return "Model";
    }
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
    {
      type: "link",
      to: "/models-deployed",
      icon: Boxes,
      label: "Models Deployed",
      tooltip: "Manage deployed models",
    },
    {
      type: "link",
      to: "/deployment-history",
      icon: History,
      label: "Deployment History",
      tooltip: "View deployment history and container status",
    },
    {
      type: "link",
      to: "/apps",
      icon: LayoutGrid,
      label: "Apps",
      tooltip: "Launch apps that use your deployed models",
    },
    ...(hasStray
      ? [
        {
          type: "link" as const,
          to: "/register-model",
          icon: Plus,
          label: "Register Model",
          tooltip: "Adopt a running container as a deployed model",
        },
      ]
      : []),
    // Workflows and Canvas both need a healthy chat-capable model to be useful,
    // so only surface them once one is up.
    ...(isLlmReady
      ? [
        {
          type: "link" as const,
          to: "/workflows",
          icon: Workflow,
          label: "Workflows",
          tooltip: "Build and run multi-step AI pipelines",
        },
        {
          type: "link" as const,
          to: "/canvas",
          icon: PanelLeft,
          label: "Canvas",
          tooltip: "AI code canvas with live preview",
        },
      ]
      : []),
    // Voice Agent is only shown when all three voice-stack models are deployed
    ...(isVoiceAgentReady
      ? [
        {
          type: "link" as const,
          to: "/voice-agent",
          icon: Mic,
          label: "Voice Agent",
          tooltip: "Full conversational AI interface with voice chat",
        },
      ]
      : []),
  ];

  // Define model-based navigation items (shown only when isDeployedEnabled is true)
  // When isDeployedEnabled is true, we assume models are already active and available
  const createModelNavItems = (): NavItemData[] => {
    if (isDeployedEnabled) {
      // In AI Playground mode, show navigation for models that are healthy and
      // ready to use. Models still deploying/warming up are intentionally hidden.
      if (healthyModels.length > 0) {
        // Show navigation items for each healthy model
        return healthyModels.map((model) => {
          const modelType = model.model_type
            ? getModelTypeFromBackendType(model.model_type)
            : getModelTypeFromName(model.name, model.image);
          const route = getDestinationFromModelType(modelType);
          return {
            type: "button",
            icon: getNavIconFromModelType(modelType),
            label: getModelPageNameFromModelType(modelType),
            onClick: () =>
              navigate(route, {
                state: { containerID: model.id, modelName: model.name },
              }),
            isDisabled: false,
            tooltipText: `Open ${getModelPageNameFromModelType(modelType)} (${model.name})`,
            route,
          };
        });
      } else {
        // If no models are deployed, show all available model types as disabled
        return [
          {
            type: "button",
            icon: BotMessageSquare,
            label: "Chat UI",
            onClick: () => handleNavigation("/chat"),
            isDisabled: true,
            tooltipText: "Deploy a chat model to use Chat UI",
            route: "/chat",
          },
          {
            type: "button",
            icon: Image,
            label: "Image Generation",
            onClick: () => handleNavigation("/image-generation"),
            isDisabled: true,
            tooltipText:
              "Deploy an image generation model to use Image Generation",
            route: "/image-generation",
          },
          {
            type: "button",
            icon: Eye,
            label: "Object Detection",
            onClick: () => handleNavigation("/object-detection"),
            isDisabled: true,
            tooltipText:
              "Deploy an object detection model to use Object Detection",
            route: "/object-detection",
          },
          {
            type: "button",
            icon: AudioLines,
            label: "Speech to Text",
            onClick: () => handleNavigation("/speech-to-text"),
            isDisabled: true,
            tooltipText:
              "Deploy a speech recognition model to use Speech to Text",
            route: "/speech-to-text",
          },
        ];
      }
    } else {
      // In TT-Studio mode, show only models that are healthy and ready to use.
      console.log("TT-Studio mode - creating navigation for healthy models");
      return healthyModels.map((model) => {
        const modelType = model.model_type
          ? getModelTypeFromBackendType(model.model_type)
          : getModelTypeFromName(model.name, model.image);
        const route = getDestinationFromModelType(modelType);
        return {
          type: "button",
          icon: getNavIconFromModelType(modelType),
          label: getModelPageNameFromModelType(modelType),
          onClick: () =>
            navigate(route, {
              state: { containerID: model.id, modelName: model.name },
            }),
          isDisabled: false,
          tooltipText: `Open ${getModelPageNameFromModelType(modelType)}`,
          route,
        };
      });
    }
  };

  const navItems: NavItemData[] = [...baseNavItems, ...createModelNavItems()];

  // Group the flat nav items into submenus for the horizontal desktop navbar.
  // Home stays top-level; anything not claimed by Model Lifecycle/Tools (the
  // deployed model pages: Chat UI, Speech to Text, etc.) lands in Model
  // Interaction. The vertical and mobile navbars keep the flat icon list.
  const modelsGroupLabels = [
    "Models Deployed",
    "Deployment History",
    "Register Model",
  ];
  const toolsGroupLabels = [
    "Rag Management",
    "Workflows",
    "Canvas",
    "Connect Agents",
    "Voice Agent",
  ];
  const homeNavItem = navItems.find((item) => item.label === "Home");
  const navGroups = [
    {
      label: "Model Lifecycle",
      icon: Boxes,
      items: navItems.filter((item) => modelsGroupLabels.includes(item.label)),
    },
    {
      label: "Tools",
      icon: Workflow,
      items: navItems.filter((item) => toolsGroupLabels.includes(item.label)),
    },
    {
      label: "Model Interaction",
      icon: BotMessageSquare,
      items: navItems.filter(
        (item) =>
          item.label !== "Home" &&
          !modelsGroupLabels.includes(item.label) &&
          !toolsGroupLabels.includes(item.label)
      ),
    },
  ].filter((group) => group.items.length > 0);

  // Define action buttons based on deployment state - include HelpIcon
  const actionButtons: ActionButtonType[] = [
    // Dark/light mode toggle disabled — app stays in dark mode.
    // {
    //   icon: ModeToggle,
    //   tooltipText: "Toggle Dark/Light Mode",
    //   onClick: null, // ModeToggle handles its own click
    // },
    {
      icon: ResetIcon,
      tooltipText: "Reset Board",
      onClick: handleReset,
    },
  ];

  const SettingsNavButton = (_props: { vertical?: boolean } = {}) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
          <Button
            variant="navbar"
            size="icon"
            onClick={() => setIsSettingsOpen(true)}
            className="relative inline-flex items-center justify-center p-2 rounded-full transition-all duration-300 ease-in-out"
            aria-label="Settings"
          >
            <SettingsIcon className="w-5 h-5" />
          </Button>
        </motion.div>
      </TooltipTrigger>
      <TooltipContent>
        <p>Settings</p>
      </TooltipContent>
    </Tooltip>
  );

  // Render vertical navbar for chat UI mode or image generation (regardless of device)
  if (shouldUseVerticalNav) {
    return (
      <TooltipProvider>
        <SettingsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
        />
        <div className="h-screen w-16 fixed left-0 top-0 dark:border-r-4 dark:border-TT-dark border-r-4 border-secondary dark:bg-TT-black bg-secondary shadow-xl z-50">
          <div className="font-tt_a_mono flex flex-col items-center justify-between h-full py-4">
            {/* Logo */}
            <div className="flex flex-col items-center">
              <a
                href="https://www.tenstorrent.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mb-6"
              >
                {logoUrl && (
                  <motion.img
                    src={logoUrl}
                    alt="Tenstorrent Logo"
                    className="w-10 h-10"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display =
                        "none";
                    }}
                    whileHover={{ scale: 1.1, rotate: 360 }}
                    transition={{ type: "spring", stiffness: 300, damping: 10 }}
                  />
                )}
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
              <SettingsNavButton vertical />
            </div>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  if (shouldShowMobileMenu) {
    return (
      <TooltipProvider>
        <SettingsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
        />
        <div className="fixed top-0 w-full dark:border-b-4 dark:border-TT-dark border-b-4 border-secondary dark:bg-TT-black bg-secondary shadow-xl z-50">
          <div className="font-tt_a_mono flex items-center justify-between w-full px-2 py-2">
            {/* Logo */}
            <a
              href="https://www.tenstorrent.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center"
            >
              {logoUrl && (
                <motion.img
                  src={logoUrl}
                  alt="Tenstorrent Logo"
                  className="w-8 h-8"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      "none";
                  }}
                  whileHover={{ scale: 1.1, rotate: 360 }}
                  transition={{ type: "spring", stiffness: 300, damping: 10 }}
                />
              )}
            </a>

            <div className="flex items-center">
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
              <div className="flex justify-center mt-4 pb-2 flex-col items-center gap-1">
                {actionButtons.map((button) => (
                  <ActionButton
                    key={button.tooltipText}
                    icon={button.icon}
                    onClick={button.onClick}
                    tooltipText={button.tooltipText}
                  />
                ))}
                <SettingsNavButton />
                <BugReportButton variant="icon" />
              </div>
            </motion.div>
          )}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <div className="relative w-full dark:border-b-4 dark:border-TT-dark rounded-b-3xl border-b-4 border-secondary dark:bg-TT-black bg-secondary shadow-xl z-50">
        <div className="font-tt_a_mono flex items-center justify-between w-full px-4 py-2 sm:px-5 sm:py-3">
          {/* Logo */}
          <a
            href="https://www.tenstorrent.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center"
          >
            {logoUrl && (
              <motion.img
                src={logoUrl}
                alt="Tenstorrent Logo"
                className="w-10 h-10 sm:w-14 sm:h-14"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
                whileHover={{ scale: 1.1, rotate: 360 }}
                transition={{ type: "spring", stiffness: 300, damping: 10 }}
              />
            )}
            <h4
              className={`hidden sm:block text-lg sm:text-2xl font-tt_a_mono ${textColor} ml-3 bold font-roboto flex items-center`}
            >
              {isDeployedEnabled ? "AI Playground" : "TT-Studio"}
              {import.meta.env.DEV && (
                <span className="ml-2 px-2 py-1 text-xs bg-orange-500 text-white rounded-md font-mono">
                  DEV
                </span>
              )}
            </h4>
          </a>

          {/* Navigation Menu */}
          <NavigationMenu className="w-full px-4">
            <NavigationMenuList className="flex justify-between list-none">
              {homeNavItem && homeNavItem.type === "link" && (
                <div className="flex items-center">
                  <NavItem
                    to={homeNavItem.to}
                    icon={homeNavItem.icon}
                    label={homeNavItem.label}
                    tooltip={homeNavItem.tooltip}
                    isChatUI={false}
                    iconColor={iconColor}
                    getNavLinkClass={getNavLinkClass}
                    isMobile={isMobile}
                  />
                  {navGroups.length > 0 && (
                    <Separator
                      className="h-6 w-px bg-zinc-400 mx-1"
                      orientation="vertical"
                    />
                  )}
                </div>
              )}
              {navGroups.map((group, index) => (
                <div key={group.label} className="flex items-center">
                  <NavDropdown
                    label={group.label}
                    icon={group.icon}
                    items={group.items}
                    iconColor={iconColor}
                    getNavLinkClass={getNavLinkClass}
                    isRouteActive={isRouteActive}
                    onNavigate={navigate}
                  />
                  {index < navGroups.length - 1 && (
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
          <div className="flex items-center space-x-4">
            {actionButtons.map((button) => (
              <ActionButton
                key={button.tooltipText}
                icon={button.icon}
                onClick={button.onClick}
                tooltipText={button.tooltipText}
              />
            ))}
            <SettingsNavButton />
            <BugReportButton variant="icon" />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
