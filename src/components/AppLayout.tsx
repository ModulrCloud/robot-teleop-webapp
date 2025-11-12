import { UnderConstruction } from "./UnderConstruction";
import "./AppLayout.css";

interface AppLayoutProps {
  children: React.ReactNode;
  showBanner?: boolean;
}

export const AppLayout = ({ children, showBanner = true }: AppLayoutProps) => {
  return (
    <div className="app-layout">
      {showBanner && (
        <div className="global-banner-container">
          <UnderConstruction 
            mode="banner" 
            message="This application is in active development. Features may be incomplete or subject to change."
          />
        </div>
      )}
      <div className="app-content">
        {children}
      </div>
    </div>
  );
};