import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuthStatus } from "./hooks/useAuthStatus";
import { useUserCredits } from "./hooks/useUserCredits";
import { hasAdminAccess } from "./utils/admin";
import { PurchaseCreditsModal } from "./components/PurchaseCreditsModal";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRobot,
  faUser,
  faChevronDown,
  faRightFromBracket,
  faCog,
  faBuilding,
  faHandshake,
  faUsers,
  faCoins,
  faWallet,
  faShieldAlt,
  faGaugeHigh,
  faGlobe,
  faSatelliteDish,
  faBullhorn,
  faExternalLinkAlt,
} from '@fortawesome/free-solid-svg-icons';
import "./Navbar.css";
import { formatGroupName, capitalizeName } from "./utils/formatters";
import { MOCK_ORGANIZATIONS } from "./mocks/organization";

// Phase 0: dummy What's New items (replace with API in Phase 2)
const WHATS_NEW_DUMMY_ITEMS = [
  {
    id: "dummy-1",
    title: "What's New",
    summary: "What's new is What's New. This is where we'll highlight new features and link to the User Guide.",
    link: "/terms",
  },
  {
    id: "dummy-2",
    title: "Feature highlights",
    summary: "Each item will have a short summary and a Find Out More button linking to the User Guide.",
    link: "#",
  },
];

export default function Navbar() {
  const { isLoggedIn, signOut, user } = useAuthStatus();
  const { formattedBalance, loading: creditsLoading } = useUserCredits();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showWhatsNewPanel, setShowWhatsNewPanel] = useState(false);
  const [whatsNewReadIds, setWhatsNewReadIds] = useState<Set<string>>(new Set());
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const whatsNewRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const whatsNewUnreadCount = WHATS_NEW_DUMMY_ITEMS.filter((item) => !whatsNewReadIds.has(item.id)).length;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setShowUserMenu(false);
      }
      if (whatsNewRef.current && !whatsNewRef.current.contains(target)) {
        setShowWhatsNewPanel(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    setShowUserMenu(false);
  };

  const markWhatsNewItemRead = (id: string) => {
    setWhatsNewReadIds((prev) => new Set(prev).add(id));
  };

  const markAllWhatsNewRead = () => {
    setWhatsNewReadIds(new Set(WHATS_NEW_DUMMY_ITEMS.map((item) => item.id)));
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="app-navbar">
      <div className="navbar-container">
        <Link to="/" className={`navbar-logo ${isActive('/') ? 'active' : ''}`}>
          <img src="/logo-large.png" alt="Modulr" />
        </Link>

        <a
          href="https://modulr.cloud"
          target="_blank"
          rel="noopener noreferrer"
          className="navbar-external-link"
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
              <FontAwesomeIcon icon={faGaugeHigh} />
              <span>Dashboard</span>
            </Link>
            {user?.group === 'ORGANIZATIONS' ? (
              MOCK_ORGANIZATIONS.length > 0 && (
                <Link
                  to={`/command-hq/${MOCK_ORGANIZATIONS[0].id}`}
                  className={`nav-link ${location.pathname.startsWith('/command-hq') ? 'active' : ''}`}
                >
                  <FontAwesomeIcon icon={faSatelliteDish} />
                  <span>Command HQ</span>
                </Link>
              )
            ) : (
              <>
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
                <Link
                  to="/social"
                  className={`nav-link ${isActive('/social') ? 'active' : ''}`}
                >
                  <FontAwesomeIcon icon={faUsers} />
                  <span>Social</span>
                </Link>
              </>
            )}
          </div>
        )}

        <div className="navbar-actions">
          {isLoggedIn ? (
            <>
              {/* What's New - Phase 0: dummy content, local read state */}
              <div className="whats-new-wrapper" ref={whatsNewRef}>
                <button
                  type="button"
                  className="whats-new-button"
                  onClick={() => setShowWhatsNewPanel(!showWhatsNewPanel)}
                  title="What's New"
                  aria-expanded={showWhatsNewPanel}
                  aria-haspopup="true"
                >
                  <FontAwesomeIcon icon={faBullhorn} className="whats-new-icon" />
                  {whatsNewUnreadCount > 0 && (
                    <span className="whats-new-badge" aria-label={`${whatsNewUnreadCount} unread`}>
                      {whatsNewUnreadCount}
                    </span>
                  )}
                </button>
                {showWhatsNewPanel && (
                  <div className="whats-new-panel" role="dialog" aria-label="What's New">
                    <div className="whats-new-panel-header">
                      <h3 className="whats-new-panel-title">What&apos;s New</h3>
                      {whatsNewUnreadCount > 0 && (
                        <button
                          type="button"
                          className="whats-new-mark-all"
                          onClick={markAllWhatsNewRead}
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <ul className="whats-new-list">
                      {WHATS_NEW_DUMMY_ITEMS.map((item) => (
                        <li key={item.id} className="whats-new-item">
                          <div className="whats-new-item-header">
                            <span className="whats-new-item-title">{item.title}</span>
                            {!whatsNewReadIds.has(item.id) && (
                              <span className="whats-new-item-dot" aria-hidden />
                            )}
                          </div>
                          <p className="whats-new-item-summary">{item.summary}</p>
                          {item.link.startsWith("/") ? (
                            <Link
                              to={item.link}
                              className="whats-new-item-link"
                              onClick={() => {
                                markWhatsNewItemRead(item.id);
                                setShowWhatsNewPanel(false);
                              }}
                            >
                              Find Out More <FontAwesomeIcon icon={faExternalLinkAlt} />
                            </Link>
                          ) : (
                            <a
                              href={item.link}
                              className="whats-new-item-link"
                              onClick={() => {
                                markWhatsNewItemRead(item.id);
                                setShowWhatsNewPanel(false);
                              }}
                            >
                              Find Out More <FontAwesomeIcon icon={faExternalLinkAlt} />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Credits - hidden for ORGANIZATIONS group (Kenneth's change) */}
              {user?.group && user.group !== 'ORGANIZATIONS' && (
                <button
                  className="credits-balance"
                  onClick={() => setShowPurchaseModal(true)}
                  title="Click to purchase credits"
                >
                  <FontAwesomeIcon icon={faCoins} className="credits-icon" />
                  <span className="credits-amount">
                    {creditsLoading ? '...' : formattedBalance}
                  </span>
                </button>
              )}

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
                        <span>Edit Company Profile</span>
                      </Link>
                    )}
                    <Link to="/settings" className="dropdown-item" onClick={() => setShowUserMenu(false)}>
                      <FontAwesomeIcon icon={faCog} />
                      <span>Settings</span>
                    </Link>
                    {user?.group !== 'ORGANIZATIONS' && (
                      <Link to="/credits" className="dropdown-item" onClick={() => setShowUserMenu(false)}>
                        <FontAwesomeIcon icon={faCoins} />
                        <span>Credits</span>
                      </Link>
                    )}
                    {user?.group === 'ORGANIZATIONS' && MOCK_ORGANIZATIONS.length > 0 && (
                      <Link to={`/command-hq/${MOCK_ORGANIZATIONS[0].id}`} className="dropdown-item" onClick={() => setShowUserMenu(false)}>
                        <FontAwesomeIcon icon={faSatelliteDish} />
                        <span>Command HQ</span>
                      </Link>
                    )}
                    {hasAdminAccess(user?.email, user?.group ? [user.group] : undefined) && (
                      <Link to="/admin" className="dropdown-item" onClick={() => setShowUserMenu(false)}>
                        <FontAwesomeIcon icon={faShieldAlt} />
                        <span>Admin</span>
                      </Link>
                    )}
                    {user?.group !== 'ORGANIZATIONS' && (
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setShowUserMenu(false);
                          setShowPurchaseModal(true);
                        }}
                      >
                        <FontAwesomeIcon icon={faWallet} />
                        <span>Purchase Credits</span>
                      </button>
                    )}
                    <div className="dropdown-divider"></div>
                    <button className="dropdown-item danger" onClick={handleSignOut}>
                      <FontAwesomeIcon icon={faRightFromBracket} />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            </>
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
          <a
            href="https://modulr.cloud"
            target="_blank"
            rel="noopener noreferrer"
            className="mobile-nav-link external"
            onClick={() => setShowMobileMenu(false)}
          >
            <FontAwesomeIcon icon={faGlobe} />
            <span>Website ↗</span>
          </a>
          <Link to="/" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
            <FontAwesomeIcon icon={faGaugeHigh} />
            <span>Dashboard</span>
          </Link>
          {user?.group === 'ORGANIZATIONS' ? (
            MOCK_ORGANIZATIONS.length > 0 && (
              <Link to={`/command-hq/${MOCK_ORGANIZATIONS[0].id}`} className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
                <FontAwesomeIcon icon={faSatelliteDish} />
                <span>Command HQ</span>
              </Link>
            )
          ) : (
            <>
              <Link to="/robots" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
                <FontAwesomeIcon icon={faRobot} />
                <span>Robots</span>
              </Link>
              <Link to="/services" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
                <FontAwesomeIcon icon={faHandshake} />
                <span>Services</span>
              </Link>
              <Link to="/social" className="mobile-nav-link" onClick={() => setShowMobileMenu(false)}>
                <FontAwesomeIcon icon={faUsers} />
                <span>Social</span>
              </Link>
              <button
                type="button"
                className="mobile-nav-link"
                onClick={() => {
                  setShowMobileMenu(false);
                  setShowWhatsNewPanel(true);
                }}
              >
                <FontAwesomeIcon icon={faBullhorn} />
                <span>What&apos;s New</span>
              </button>
            </>
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

      {/* Purchase Credits Modal */}
      <PurchaseCreditsModal
        isOpen={showPurchaseModal}
        onClose={() => setShowPurchaseModal(false)}
      />
    </nav>
  );
}