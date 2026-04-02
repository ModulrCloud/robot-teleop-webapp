import { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { hasAdminAccess } from "../utils/admin";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faShieldAlt,
  faUsers,
  faExclamationTriangle,
  faDollarSign,
  faChartLine,
  faCoins,
  faHistory,
  faSlidersH,
  faBroom,
  faFileContract,
  faBullhorn,
  faClipboardCheck,
  faImage,
} from "@fortawesome/free-solid-svg-icons";

type AdminTab = "dashboard" | "users" | "approvals";
import { logger } from "../utils/logger";
import "./Admin.css";


const SystemStats = lazy(() => import("./admin/components/SystemStats").then(module => ({ default: module.SystemStats })));
const PlatformRevenueTimeline = lazy(() => import("./admin/components/PlatformRevenueTimeline").then(module => ({ default: module.PlatformRevenueTimeline })));
const AuditLogs = lazy(() => import("./admin/components/AuditLogs").then(module => ({ default: module.AuditLogs })));
const ConnectionCleanup = lazy(() => import("./admin/components/ConnectionCleanup").then(module => ({ default: module.ConnectionCleanup })));
const PlatformSettings = lazy(() => import("./admin/components/PlatformSettings").then(module => ({ default: module.PlatformSettings })));
const PayoutManagement = lazy(() => import("./admin/components/PayoutManagement").then(module => ({ default: module.PayoutManagement })));
const UserManagement = lazy(() => import("./admin/components/UserManagement").then(module => ({ default: module.UserManagement })));
const TermsOfServiceAdmin = lazy(() => import("./admin/components/TermsOfServiceAdmin").then(module => ({ default: module.TermsOfServiceAdmin })));
const WhatsNewAdmin = lazy(() => import("./admin/components/WhatsNewAdmin").then(module => ({ default: module.WhatsNewAdmin })));
const CertificationRequests = lazy(() => import("./admin/components/CertificationRequests").then(module => ({ default: module.CertificationRequests })));
const ImageVerificationRequests = lazy(() => import("./admin/components/ImageVerificationRequests").then(module => ({ default: module.ImageVerificationRequests })));

export const Admin = () => {
  usePageTitle();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthStatus();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");

  useEffect(() => {
    if (!authLoading && user) {
      const isAdmin = hasAdminAccess(user.email, user.group ? [user.group] : undefined);
      
      if (!isAdmin) {
      logger.log("Unauthorized admin access attempt:", user.email);
        setError("Access denied. Admin page is only available to Modulr employees.");
        setTimeout(() => {
          navigate("/");
        }, 3000);
        setLoading(false);
        return;
      }
      
      setLoading(false);
    } else if (!authLoading && !user) {
      navigate("/signin");
    }
  }, [authLoading, user, navigate]);

  if (authLoading || loading) {
    return (
      <div className="admin-page">
        <div className="admin-loading">
          <FontAwesomeIcon icon={faShieldAlt} spin className="loading-icon" />
          <p>Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (error && !hasAdminAccess(user?.email, user?.group ? [user.group] : undefined)) {
    return (
      <div className="admin-page">
        <div className="admin-error">
          <FontAwesomeIcon icon={faExclamationTriangle} className="error-icon" />
          <h2>Access Denied</h2>
          <p>{error}</p>
          <p className="redirect-message">Redirecting to home page...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div className="header-icon">
          <FontAwesomeIcon icon={faShieldAlt} />
        </div>
        <div className="header-content">
          <h1>Admin Panel</h1>
          <p>Manage platform settings, users, and system configuration</p>
        </div>
      </div>

      {error && (
        <div className="admin-alert admin-alert-error">
          <FontAwesomeIcon icon={faExclamationTriangle} />
          <span>{error}</span>
        </div>
      )}

      <nav className="admin-tabs" aria-label="Admin sections">
        <button
          type="button"
          className={`admin-tab ${activeTab === "dashboard" ? "active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
          aria-selected={activeTab === "dashboard"}
        >
          <FontAwesomeIcon icon={faChartLine} className="admin-tab-icon" />
          Dashboard
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "users" ? "active" : ""}`}
          onClick={() => setActiveTab("users")}
          aria-selected={activeTab === "users"}
        >
          <FontAwesomeIcon icon={faUsers} className="admin-tab-icon" />
          User Management
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "approvals" ? "active" : ""}`}
          onClick={() => setActiveTab("approvals")}
          aria-selected={activeTab === "approvals"}
        >
          <FontAwesomeIcon icon={faClipboardCheck} className="admin-tab-icon" />
          Approvals
        </button>
      </nav>

      <div className="admin-content">
        {activeTab === "dashboard" && (
        <>
        <Suspense fallback={
          <div className="admin-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faChartLine} className="section-icon" />
              <h2>System Statistics</h2>
            </div>
            <div className="section-content">
              <div className="loading-state">
                <p>Loading statistics component...</p>
              </div>
            </div>
          </div>
        }>
          <SystemStats />
        </Suspense>
        <Suspense fallback={
          <div className="admin-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faCoins} className="section-icon" />
              <h2>Platform revenue timeline</h2>
            </div>
            <div className="section-content">
              <div className="loading-state">
                <p>Loading revenue timeline...</p>
              </div>
            </div>
          </div>
        }>
          <PlatformRevenueTimeline />
        </Suspense>
        </>
        )}

        {activeTab === "users" && (
        <>
        <Suspense fallback={
          <div className="admin-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faUsers} className="section-icon" />
              <h2>User Management</h2>
            </div>
            <div className="section-content">
              <div className="loading-state">
                <p>Loading user management...</p>
              </div>
            </div>
          </div>
        }>
          <UserManagement />
        </Suspense>

        <Suspense fallback={
          <div className="admin-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faHistory} className="section-icon" />
              <h2>Audit Log</h2>
            </div>
            <div className="section-content">
              <div className="loading-state">
                <p>Loading audit logs component...</p>
              </div>
            </div>
          </div>
        }>
          <AuditLogs />
        </Suspense>

        <Suspense fallback={
          <div className="admin-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faBroom} className="section-icon" />
              <h2>Connection Cleanup</h2>
            </div>
            <div className="section-content">
              <p>Loading connection cleanup...</p>
            </div>
          </div>
        }>
          <ConnectionCleanup />
        </Suspense>

        <Suspense fallback={
          <div className="admin-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faDollarSign} className="section-icon" />
              <h2>Payout Management</h2>
            </div>
            <div className="section-content">
              <div className="loading-state">
                <p>Loading payout management...</p>
              </div>
            </div>
          </div>
        }>
          <PayoutManagement />
        </Suspense>

        <Suspense fallback={
          <div className="admin-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faSlidersH} className="section-icon" />
              <h2>Platform Settings</h2>
            </div>
            <div className="section-content">
              <p>Loading platform settings...</p>
            </div>
          </div>
        }>
          <PlatformSettings />
        </Suspense>

        <Suspense fallback={
          <div className="admin-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faFileContract} className="section-icon" />
              <h2>Terms of Service</h2>
            </div>
            <div className="section-content">
              <p>Loading...</p>
            </div>
          </div>
        }>
          <TermsOfServiceAdmin />
        </Suspense>

        <Suspense fallback={
          <div className="admin-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faBullhorn} className="section-icon" />
              <h2>What&apos;s New</h2>
            </div>
            <div className="section-content">
              <p>Loading...</p>
            </div>
          </div>
        }>
          <WhatsNewAdmin />
        </Suspense>
        </>
        )}

        {activeTab === "approvals" && (
        <>
        <Suspense fallback={
          <div className="admin-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faClipboardCheck} className="section-icon" />
              <h2>Certification requests</h2>
            </div>
            <div className="section-content">
              <p className="loading-state">Loading certification requests...</p>
            </div>
          </div>
        }>
          <CertificationRequests />
        </Suspense>
        <Suspense fallback={
          <div className="admin-section" style={{ marginTop: "2rem" }}>
            <div className="section-header">
              <FontAwesomeIcon icon={faImage} className="section-icon" />
              <h2>Image verification requests</h2>
            </div>
            <div className="section-content">
              <p className="loading-state">Loading image verification requests...</p>
            </div>
          </div>
        }>
          <ImageVerificationRequests />
        </Suspense>
        </>
        )}

      </div>
    </div>
  );
};

