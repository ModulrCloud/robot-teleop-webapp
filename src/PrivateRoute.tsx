import { JSX, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStatus } from "./hooks/useAuthStatus";
import { LoadingWheel } from "./components/LoadingWheel";

interface PrivateRouteProps {
  children: JSX.Element;
}

export function PrivateRoute({ children }: PrivateRouteProps) {
  const { isLoggedIn, loading, user } = useAuthStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const hasUserGroup = !!user?.group;

  useEffect(() => {
    const from = location.state?.from;
    const returnTo = from ? from : location;

    if (!loading && !isLoggedIn && location.pathname !== "/signin") {
      console.log("Redirecting to signin page...");
      // Redirect to /signin and remember the page the user tried to access
      navigate("/signin", { replace: true, state: { from: returnTo } });
    }

    if (!loading && !hasUserGroup && location.pathname !== "/user-setup") {
      console.log("Redirecting to user setup page...");
      // Redirect to /user-setup and remember the page
      navigate("/user-setup", { replace: true, state: { from: returnTo } });
    }
  }, [isLoggedIn, loading, navigate, location]);

  if (loading) return <LoadingWheel />;

  return isLoggedIn ? children : null;
}
