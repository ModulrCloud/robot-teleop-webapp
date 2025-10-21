import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function usePageTitle() {
  const location = useLocation();

  useEffect(() => {
    const baseTitle = " | Modulr"; // default title
    let title = "Unknown";

    switch (location.pathname) {
      case "/":
        title = "Home";
        break;
      case "/signin":
        title = "Sign In";
        break;
      case "/user-setup":
        title = "User Setup";
        break;
      case "/robots":
        title = "Robots";
        break;
      case "/services":
        title = "Services";
        break;
      case "/teleop":
        title = "Teleoperation Session";
        break;
      // add other routes here
      default:
        break;
    }

    document.title = title + baseTitle;
  }, [location.pathname]);
}