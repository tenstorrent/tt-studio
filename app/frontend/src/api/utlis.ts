import { useEffect } from "react";

export function setTitleBasedOnEnvironment() {
  useEffect(() => {
    // const isLocalhost = window.location.hostname === "localhost";
    const defaultTitle = import.meta.env.VITE_APP_TITLE || "TT-Studio";
    console.log("defaultTitle", defaultTitle);

    document.title = defaultTitle;
  }, []);
}
