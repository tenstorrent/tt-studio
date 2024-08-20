import { useMemo, useRef } from "react";
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
import { Separator } from "./ui/separator";
import useCommonClasses from "../theme/commonThemeClasses";
import Sidebar from "./SideBar";

export default function NavBar() {
  const location = useLocation();
  const { textColor, hoverTextColor, activeBorderColor, hoverBackgroundColor } =
    useCommonClasses();

  const navLinkClass = useMemo(
    () =>
      `flex items-center justify-center px-2 py-2 rounded-md text-sm font-medium ${textColor} transition-all duration-300 ease-in-out`,
    [textColor]
  );

  const getNavLinkClass = (isActive: boolean) =>
    `${navLinkClass} ${
      isActive ? `border-2 ${activeBorderColor}` : "border-transparent"
    } ${hoverTextColor} ${hoverBackgroundColor} hover:border-4 hover:scale-105 hover:shadow-lg dark:hover:shadow-TT-dark-shadow dark:hover:border-TT-light-border transition-all duration-300 ease-in-out`;

  const sidebarRef = useRef<{ toggleSidebar: () => void }>(null);

  const handleToggleSidebar = () => {
    if (sidebarRef.current) {
      sidebarRef.current.toggleSidebar();
    }
  };

  const isChatUI = location.pathname === "/chat-ui";

  return (
    <div
      className={`${
        isChatUI
          ? "fixed top-0 left-0 h-full w-20 flex flex-col items-center dark:border-b-4 dark:border-TT-dark"
          : "relative w-full dark:border-b-4 dark:border-TT-dark"
      } border-b-4 border-secondary dark:bg-TT-black bg-secondary shadow-xl z-50`}
    >
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
                <Home className={`mr-0 ${textColor}`} />
                {!isChatUI && <span>Home</span>}
              </NavLink>
            </NavigationMenuItem>
            {!isChatUI && (
              <Separator
                className="h-6 w-px bg-zinc-400"
                orientation="vertical"
              />
            )}
            <NavigationMenuItem
              className={`${isChatUI ? "w-full flex justify=center" : ""}`}
            >
              <NavLink
                to="/models-deployed"
                className={({ isActive }) => getNavLinkClass(isActive)}
              >
                <BrainCog className={`mr-0 ${textColor}`} />
                {!isChatUI && <span>Models Deployed</span>}
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
                  <BotMessageSquare className={`mr-0 ${textColor}`} />
                </NavLink>
              </NavigationMenuItem>
            )}
          </NavigationMenuList>
        </NavigationMenu>
        {!isChatUI && (
          <div className={`flex items-center space-x-2 sm:space-x-4`}>
            <ModeToggle />
            <Separator
              className="h-6 w-px bg-zinc-400"
              orientation="vertical"
            />
            <HelpIcon toggleSidebar={handleToggleSidebar} />
          </div>
        )}
      </div>
      {isChatUI && (
        <div className="mt-auto flex flex-col items-center mb-4 space-y-4">
          <ModeToggle />
          <HelpIcon toggleSidebar={handleToggleSidebar} />
        </div>
      )}
      <Sidebar ref={sidebarRef} />
    </div>
  );
}
