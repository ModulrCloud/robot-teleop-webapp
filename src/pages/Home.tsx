import { useEffect } from "react";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { usePageTitle } from "../hooks/usePageTitle"
import { useLocation, useNavigate } from "react-router-dom";
import { logger } from "../utils/logger";

export const Home = () => {
  usePageTitle();
  const { isLoggedIn, loading, user } = useAuthStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const hasUserGroup = !!user?.group;

  useEffect(() => {
    if (!loading && !hasUserGroup) {
      logger.log("Redirecting to user setup page...");
      navigate("/user-setup", { replace: true, state: { from: location } });
    }
  }, [isLoggedIn, loading, navigate, location]);

  return <p>You're Home!</p>
}
