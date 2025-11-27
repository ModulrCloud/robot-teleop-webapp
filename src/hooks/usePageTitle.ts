import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function usePageTitle() {
  const location = useLocation();

  useEffect(() => {
    const baseTitle = " | Modulr"; // default title
    let title = "Unknown";

    switch (location.pathname) {
      case "/":
        title = "Dashboard";
        break;
      case "/signin":
        title = "Sign In";
        break;
      case "/user-setup":
        title = "User Setup";
        break;
      case "/profile":
        title = "Profile";
        break;
      case "/settings":
        title = "Settings";
        break;
      case "/robots":
        title = "Select Robot";
        break;
      case "/services":
        title = "Select Services";
        break;
      case "/teleop":
        title = "Teleoperation Session";
        break;
      case "/endsession":
        title = "Session Complete";
        break;
      case "/sessions":
        title = "Session History";
        break;
      case "/create-robot-listing":
        title = "List Robot";
        break;
      default:
        title = location.pathname
          .split("/")
          .filter(Boolean)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
        break;
    }

    document.title = title + baseTitle;
  }, [location.pathname]);
}