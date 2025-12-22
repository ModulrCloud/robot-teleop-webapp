import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../amplify/data/resource';
import { useAuthStatus } from "./hooks/useAuthStatus";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

const client = generateClient<Schema>();
import {
  faHome,
  faRobot,
  faClockRotateLeft,
  faUser,
  faChevronDown,
  faRightFromBracket,
  faCog,
  faGlobe,
  faList,
  faBuilding,
  faHandshake
} from '@fortawesome/free-solid-svg-icons';
import "./Navbar.css";
import { formatGroupName, capitalizeName } from "./utils/formatters";

export default function Navbar() {
  const { isLoggedIn, signOut, user } = useAuthStatus();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [hasPartnerProfile, setHasPartnerProfile] = useState<boolean | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !user?.username) {
      setHasPartnerProfile(null);
      return;
    }
    setHasPartnerProfile(null);
    let cancelled = false;
    const checkPartnerProfile = async () => {
      if (user?.group === "PARTNERS") {
        try {
          const res = await client.models.Partner.list({
            filter: { cognitoUsername: { eq: user.username } },
            limit: 1,
          });
          if (!cancelled) {
            setHasPartnerProfile((res.data?.length || 0) > 0);
          }
        } catch {
          if (!cancelled) setHasPartnerProfile(null);
        }
      } else {
        setHasPartnerProfile(null);
      }
    };
    checkPartnerProfile();
    return () => { cancelled = true; };
  }, [isLoggedIn, user?.group, user?.username, location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    setShowUserMenu(false);
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="app-navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">
          <img src="/logo-large.png" alt="Modulr" />
        </Link>

        <a 
          href="https://www.modulr.cloud" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="navbar-external-link"
          title="Visit Modulr Website"
        >
          <FontAwesomeIcon icon={faGlobe} />
          <span>Website</span>
        </a>

        {isLoggedIn && (
          <div className="navbar-links">
            <Link 
              to="/" 
              className={`nav-link ${isActive('/') ? 'active' : ''}`}
            >
              <FontAwesomeIcon icon={faHome} />
              <span>Dashboard</span>
            </Link>
            <Link 
              to="/robots" 
              className={`nav-link ${isActive('/robots') ? 'active' : ''}`}
            >
              <FontAwesomeIcon icon={faRobot} />
              <span>Robots</span>
            </Link>
            <Link 
              to="/services" 
              className={`nav-link ${isActive('/services') ? 'active' : ''}`}
            >
              <FontAwesomeIcon icon={faHandshake} />
              <span>Services</span>
            </Link>
            {user?.group === "PARTNERS" && (
              <Link 
                to="/my-robots" 
                className={`nav-link ${isActive('/my-robots') ? 'active' : ''}`}
              >
                <FontAwesomeIcon icon={faList} />
                <span>My Robots</span>
              </Link>
            )}
            <Link 
              to="/sessions" 
              className={`nav-link ${isActive('/sessions') ? 'active' : ''}`}
            >
              <FontAwesomeIcon icon={faClockRotateLeft} />
              <span>Sessions</span>
            </Link>
            {user?.group === "PARTNERS" && (
              <Link 
                to="/create-robot-listing" 
                className={`nav-link ${isActive('/create-robot-listing') ? 'active' : ''}`}
              >
                <FontAwesomeIcon icon={faRobot} />
                <span>List Robot</span>
              </Link>
            )}
          </div>
        )}

        <div className="navbar-actions">
          {isLoggedIn ? (
            <div className="user-menu-wrapper" ref={menuRef}>
              <button 
                className="user-menu-button"
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <div className="user-avatar">
                  {user?.email?.[0].toUpperCase() || 'U'}
                </div>
                <span className="user-name">{capitalizeName(user?.email?.split('@')[0]) || 'User'}</span>
                <FontAwesomeIcon icon={faChevronDown} className="dropdown-icon" />
              </button>

              {showUserMenu && (
                <div className="user-dropdown">
                  <div className="dropdown-header">
                    <div className="dropdown-user-info">
                      <div className="dropdown-avatar">
                        {user?.email?.[0].toUpperCase() || 'U'}
                      </div>
                      <div>
                        <div className="dropdown-name">{capitalizeName(user?.email?.split('@')[0])}</div>
                        <div className="dropdown-email">{user?.email}</div>
                        {user?.group && (
                          <div className="dropdown-role">{formatGroupName(user.group)}</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="dropdown-divider"></div>
                  <Link to="/profile" className="dropdown-item" onClick={() => setShowUserMenu(false)}>
                    <FontAwesomeIcon icon={faUser} />
                    <span>Profile</span>
                  </Link>
                  {user?.group === "PARTNERS" && (
                    <Link to="/partner-profile/edit" className="dropdown-item" onClick={() => setShowUserMenu(false)}>
                      <FontAwesomeIcon icon={faBuilding} />
                      <span>{hasPartnerProfile === null ? 'Company Profile' : hasPartnerProfile ? 'Edit Company Profile' : 'Create Company Profile'}</span>
                    </Link>
                  )}
                  <Link to="/settings" className="dropdown-item" onClick={() => setShowUserMenu(false)}>
                    <FontAwesomeIcon icon={faCog} />
                    <span>Settings</span>
                  </Link>
                  <div className="dropdown-divider"></div>
                  <button className="dropdown-item danger" onClick={handleSignOut}>
                    <FontAwesomeIcon icon={faRightFromBracket} />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/signin" className="sign-in-button">
              Sign In
            </Link>
          )}

          {isLoggedIn && (
            <button 
              className="mobile-menu-toggle"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
            >
              <div className={`hamburger ${showMobileMenu ? 'active' : ''}`}>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </button>
          )}
        </div>
      </div>

      {isLoggedIn && showMobileMenu && (
        <div className="mobile-menu">
          <Link to="/" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
            <FontAwesomeIcon icon={faHome} />
            <span>Dashboard</span>
          </Link>
          <Link to="/robots" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
            <FontAwesomeIcon icon={faRobot} />
            <span>Robots</span>
          </Link>
          <Link to="/services" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
            <FontAwesomeIcon icon={faHandshake} />
            <span>Services</span>
          </Link>
          {user?.group === "PARTNERS" && (
            <Link to="/my-robots" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
              <FontAwesomeIcon icon={faList} />
              <span>My Robots</span>
            </Link>
          )}
          <Link to="/sessions" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
            <FontAwesomeIcon icon={faClockRotateLeft} />
            <span>Sessions</span>
          </Link>
          {user?.group === "PARTNERS" && (
            <Link to="/create-robot-listing" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
              <FontAwesomeIcon icon={faRobot} />
              <span>List Robot</span>
            </Link>
          )}
          <Link to="/profile" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
            <FontAwesomeIcon icon={faUser} />
            <span>Profile</span>
          </Link>
          <button className="mobile-nav-link danger" onClick={handleSignOut}>
            <FontAwesomeIcon icon={faRightFromBracket} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </nav>
  );
}