import { useEffect } from "react";

// Convert to a custom Hook (starts with 'use')
export function useTitleBasedOnEnvironment() {
  useEffect(() => {
    const defaultTitle = import.meta.env.VITE_APP_TITLE || "TT-Studio";
    document.title = defaultTitle;
  }, []);
}

// If you need to use this in a component
export function TitleSetter() {
  useTitleBasedOnEnvironment();
  return null; // or return any component you need
}
