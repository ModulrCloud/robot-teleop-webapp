import { Button } from "react-bootstrap";
import { useAuthStatus } from "./hooks/useAuthStatus";
import { useNavigate } from "react-router-dom";

type NavbarProps = {
};

export default function Navbar(_props: NavbarProps) {

  const { isLoggedIn, signOut } = useAuthStatus();
  const navigate = useNavigate();
  
  const handleSignInOut = async () => {
    if (isLoggedIn) {
      await signOut();
    } else {
      navigate("/signin");
    }
  };
  return (
    <>
      <div
        data-animation="default"
        className="navbar2_component w-nav"
        data-easing2="ease"
        fs-scrolldisable-element="smart-nav"
        data-easing="ease"
        data-collapse="medium"
        data-w-id="b61d2364-40b5-e1d9-13b6-00f11fb665f8"
        role="banner"
        data-duration="400"
      >
        <div className="navbar2_container-2">
          <a
            href="/"
            aria-current="page"
            className="navbar2_logo-link w-nav-brand w--current"
            aria-label="home"
          >
            <img
              loading="lazy"
              src="/logo-large.png"
              alt=""
              className="navbar2_logo"
            />
          </a>
          <nav
            role="navigation"
            className="navbar2_menu w-nav-menu"
            id="w-node-b61d2364-40b5-e1d9-13b6-00f11fb665fc-1fb665f8"
          >
            <a href="/" aria-current="page" className="navbar2_link w-nav-link">
              Home
            </a>
            <a href="/technology-overview" className="navbar2_link w-nav-link">
              Technology Overview
            </a>
            <a href="/roadmap" className="navbar2_link w-nav-link">
              Roadmap
            </a>
            <a href="/team" className="navbar2_link w-nav-link">
              Team
            </a>
            <Button onClick={handleSignInOut} className="button-yellow mobile-nav w-button">
              {isLoggedIn ? "Sign Out" : "Sign In"}
            </Button>
          </nav>
          <div
            id="w-node-b61d2364-40b5-e1d9-13b6-00f11fb66607-1fb665f8"
            className="navbar2_button-wrapper"
          >
            <Button onClick={handleSignInOut} className="button-yellow desktop-nav w-button">
              {isLoggedIn ? "Sign Out" : "Sign In"}
            </Button>
            <div
              className="navbar2_menu-button w-nav-button"
              style={{ WebkitUserSelect: "text" }}
              aria-label="menu"
              role="button"
              tabIndex={0}
              aria-controls="w-nav-overlay-0"
              aria-haspopup="menu"
              aria-expanded="false"
            >
              <div className="menu-icon2">
                <div className="menu-icon2_line-top"></div>
                <div className="menu-icon2_line-middle">
                  <div className="menu-icon2_line-middle-inner"></div>
                </div>
                <div className="menu-icon2_line-bottom"></div>
              </div>
            </div>
          </div>
        </div>
        <div
          className="w-nav-overlay"
          data-wf-ignore=""
          id="w-nav-overlay-0"
        ></div>
      </div>
    </>
  );
}
