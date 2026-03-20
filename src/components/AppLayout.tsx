import { Link, useLocation } from "react-router-dom";
import "./AppLayout.css";

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  const location = useLocation();
  const isTeleopPage = location.pathname === "/teleop";

  return (
    <div className="app-layout">
      <div className="app-content">
        {children}
      </div>
      {!isTeleopPage && (
        <footer className="app-footer">
          <Link to="/terms">Terms of Service</Link>
        </footer>
      )}
    </div>
  );
};