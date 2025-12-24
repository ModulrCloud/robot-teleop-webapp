import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { hasAdminAccess } from "../utils/admin";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faShieldAlt,
  faUsers,
  faCoins,
  faCog,
  faExclamationTriangle,
  faCheckCircle,
  faInfoCircle,
  faPlus,
  faTimes,
  faEye,
  faChevronLeft,
  faChevronRight,
  faDollarSign,
  faChartLine,
  faHistory,
  faTrash,
  faRobot,
  faSlidersH,
  faEdit,
  faSave,
  faBan,
} from "@fortawesome/free-solid-svg-icons";
import { logger } from "../utils/logger";
import "./Admin.css";

const client = generateClient<Schema>();

export const Admin = () => {
  usePageTitle();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthStatus();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [paginationToken, setPaginationToken] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [showUserDetail, setShowUserDetail] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  
  // System stats
  const [systemStats, setSystemStats] = useState<any | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  
  // Audit logs
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  
  // User detail data
  const [userRobots, setUserRobots] = useState<any[]>([]);
  const [userTransactions, setUserTransactions] = useState<any[]>([]);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);
  
  // Platform Settings
  const [platformMarkup, setPlatformMarkup] = useState<number>(30);
  const [loadingMarkup, setLoadingMarkup] = useState(false);
  const [savingMarkup, setSavingMarkup] = useState(false);
  const [markupSettingId, setMarkupSettingId] = useState<string | null>(null);
  
  // Credit Tiers
  const [creditTiers, setCreditTiers] = useState<any[]>([]);
  const [loadingTiers, setLoadingTiers] = useState(false);
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [newTier, setNewTier] = useState<any | null>(null);

  // Check if user has admin access (domain-based: @modulr.cloud)
  useEffect(() => {
    if (!authLoading && user) {
      const isAdmin = hasAdminAccess(user.email, user.group ? [user.group] : undefined);
      
      if (!isAdmin) {
        // User doesn't have admin access - redirect to home
        logger.log("⚠️ Unauthorized admin access attempt:", {
          email: user.email,
          username: user.username,
        });
        setError("Access denied. Admin page is only available to Modulr employees.");
        setTimeout(() => {
          navigate("/");
        }, 3000);
        setLoading(false);
        return;
      }
      
      // User has admin access - load all data
      setLoading(false);
      
      // Load each section independently so errors don't block others
      loadSystemStats().catch(err => logger.error("Failed to load system stats:", err));
      loadAuditLogs().catch(err => logger.error("Failed to load audit logs:", err));
      loadPlatformMarkup().catch(err => logger.error("Failed to load platform markup:", err));
      loadCreditTiers().catch(err => logger.error("Failed to load credit tiers:", err));
      loadUsers().catch(err => {
        logger.error("Failed to load users:", err);
        setError(`Failed to load users: ${err instanceof Error ? err.message : 'Unknown error'}`);
      });
    } else if (!authLoading && !user) {
      // Not logged in - redirect to sign in
      navigate("/signin");
    }
  }, [authLoading, user, navigate]);

  // Debug function to check Client and Partner models directly
  const debugClientAndPartnerModels = async () => {
    try {
      console.log("🔍 [DEBUG] Checking Client model...");
      const { data: clients, errors: clientErrors } = await client.models.Client.list();
      console.log("📊 [DEBUG] Client model results:", {
        count: clients?.length || 0,
        clients: clients,
        errors: clientErrors,
      });

      console.log("🔍 [DEBUG] Checking Partner model...");
      const { data: partners, errors: partnerErrors } = await client.models.Partner.list();
      console.log("📊 [DEBUG] Partner model results:", {
        count: partners?.length || 0,
        partners: partners,
        errors: partnerErrors,
      });

      // Log all cognitoUsernames
      const allClientUsernames = clients?.map(c => c.cognitoUsername).filter(Boolean) || [];
      const allPartnerUsernames = partners?.map(p => p.cognitoUsername).filter(Boolean) || [];
      console.log("👥 [DEBUG] All Client cognitoUsernames:", allClientUsernames);
      console.log("👥 [DEBUG] All Partner cognitoUsernames:", allPartnerUsernames);
      console.log("👥 [DEBUG] Total unique users:", new Set([...allClientUsernames, ...allPartnerUsernames]).size);
    } catch (err) {
      console.error("❌ [DEBUG] Error checking Client/Partner models:", err);
    }
  };

  const loadUsers = async (token?: string | null) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoadingUsers(true);
    try {
      // First, debug Client and Partner models
      await debugClientAndPartnerModels();

      logger.log("🔍 Calling listUsersLambda...", { token });
      const result = await client.queries.listUsersLambda({
        limit: 50,
        paginationToken: token || undefined,
      });
      console.log("🔍 [DEBUG] Raw listUsersLambda response:", JSON.stringify(result, null, 2));
      logger.log("✅ listUsersLambda response:", result);
      
      // Parse the JSON response
      let usersData: { success?: boolean; users?: any[]; nextToken?: string | null } | null = null;
      
      if (!result || !result.data) {
        console.error("❌ [DEBUG] No data in response:", result);
        logger.error("❌ No data in response:", result);
        setError("Failed to load users: No response from server");
        return;
      }
      
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            usersData = JSON.parse(firstParse);
          } else {
            usersData = firstParse;
          }
        } catch (e) {
          console.error("❌ [DEBUG] Failed to parse JSON response:", e, "Raw data:", result.data);
          logger.error("❌ Failed to parse JSON response:", e, "Raw data:", result.data);
          setError("Failed to load users: Invalid JSON response");
          return;
        }
      } else {
        usersData = result.data as any;
      }

      console.log("📊 [DEBUG] Parsed users data:", JSON.stringify(usersData, null, 2));
      logger.log("📊 Parsed users data:", usersData);

      if (!usersData) {
        console.error("❌ [DEBUG] Users data is null or undefined");
        logger.error("❌ Users data is null or undefined");
        setError("Failed to load users: No data returned from server");
        return;
      }

      if (usersData.success !== false) {
        // Success
        console.log("✅ [DEBUG] Setting users:", usersData.users?.length || 0, "users");
        console.log("✅ [DEBUG] Users array:", JSON.stringify(usersData.users, null, 2));
        setUsers(usersData.users || []);
        setPaginationToken(usersData.nextToken || null);
        setError(null); // Clear any previous errors
        logger.log(`✅ Successfully loaded ${usersData.users?.length || 0} users`);
      } else {
        console.error("❌ [DEBUG] Users data indicates failure:", usersData);
        logger.error("❌ Users data indicates failure:", usersData);
        setError("Failed to load users: Server returned error");
      }
    } catch (err) {
      console.error("❌ [DEBUG] Error loading users:", err);
      logger.error("❌ Error loading users:", err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load users: ${errorMessage}`);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleViewUser = async (user: any) => {
    setSelectedUser(user);
    setShowUserDetail(true);
    await loadUserDetailData(user.username);
  };

  const handleNextPage = () => {
    if (paginationToken) {
      loadUsers(paginationToken);
    }
  };

  const handlePrevPage = () => {
    // Note: Cognito doesn't support backward pagination easily
    // We'd need to maintain our own pagination state
    // For now, just reload from the beginning
    loadUsers(null);
  };

  const handleClassificationChange = async (username: string, newClassification: string) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    // Don't allow changing admin classification from here
    if (newClassification === 'ADMIN') {
      setError("To assign admin status, use the Admin Users section");
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      console.log(`🔄 Changing classification for ${username} to ${newClassification}`);
      
      // Use setUserGroupLambda to change the Cognito group
      const groupValue = newClassification.toLowerCase() === 'partner' ? 'partner' : 'client';
      const response = await client.mutations.setUserGroupLambda({
        group: groupValue,
        targetUsername: username, // Admin can change other users' groups
      });

      console.log("✅ setUserGroupLambda response:", response);

      // Also update the Partner/Client models
      if (newClassification === 'PARTNER') {
        // Check if Partner record exists, create if not
        const { data: partners } = await client.models.Partner.list({
          filter: { cognitoUsername: { eq: username } },
        });
        if (!partners || partners.length === 0) {
          await client.models.Partner.create({
            cognitoUsername: username,
            name: username, // Default name
            description: 'Partner account',
          });
        }
        // Remove from Client if exists
        const { data: clients } = await client.models.Client.list({
          filter: { cognitoUsername: { eq: username } },
        });
        if (clients && clients.length > 0) {
          await client.models.Client.delete({ id: clients[0].id });
        }
      } else if (newClassification === 'CLIENT') {
        // Check if Client record exists, create if not
        const { data: clients } = await client.models.Client.list({
          filter: { cognitoUsername: { eq: username } },
        });
        if (!clients || clients.length === 0) {
          await client.models.Client.create({
            cognitoUsername: username,
          });
        }
        // Remove from Partner if exists
        const { data: partners } = await client.models.Partner.list({
          filter: { cognitoUsername: { eq: username } },
        });
        if (partners && partners.length > 0) {
          await client.models.Partner.delete({ id: partners[0].id });
        }
      }

      setSuccess(`User classification updated to ${newClassification}`);
      setTimeout(() => setSuccess(null), 3000);
      
      // Reload users to reflect the change
      await loadUsers(paginationToken || null);
    } catch (err) {
      console.error("❌ Error changing classification:", err);
      logger.error("Error changing user classification:", err);
      setError(`Failed to change classification: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const loadSystemStats = async () => {
    console.log("🔍 [SYSTEM STATS] loadSystemStats called");
    
    if (!user?.email || !hasAdminAccess(user.email)) {
      console.warn("⚠️ [SYSTEM STATS] No admin access, skipping");
      return;
    }

    console.log("✅ [SYSTEM STATS] Admin access confirmed, loading stats...");
    setLoadingStats(true);
    try {
      console.log("🔍 [SYSTEM STATS] Calling getSystemStatsLambda...");
      logger.log("🔍 Calling getSystemStatsLambda...");
      const result = await client.queries.getSystemStatsLambda();
      console.log("📊 [SYSTEM STATS] Raw result from Lambda:", result);
      logger.log("📊 Raw result from getSystemStatsLambda:", result);
      
      let statsData: { success?: boolean; stats?: any } | null = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            statsData = JSON.parse(firstParse);
          } else {
            statsData = firstParse;
          }
        } catch (e) {
          logger.error("❌ Failed to parse JSON response:", e, "Raw data:", result.data);
          statsData = { success: false };
        }
      } else {
        statsData = result.data as typeof statsData;
      }

      console.log("📈 [SYSTEM STATS] Parsed stats data:", statsData);
      logger.log("📈 Parsed stats data:", statsData);

      if (statsData?.success && statsData.stats) {
        // Ensure all stats are numbers, defaulting to 0 if undefined
        const stats = {
          totalUsers: statsData.stats.totalUsers ?? 0,
          totalRobots: statsData.stats.totalRobots ?? 0,
          totalRevenue: statsData.stats.totalRevenue ?? 0,
          totalCredits: statsData.stats.totalCredits ?? 0,
          activeSessions: statsData.stats.activeSessions ?? 0,
        };
        console.log("✅ [SYSTEM STATS] Final stats object:", stats);
        console.log("✅ [SYSTEM STATS] Total Robots value:", stats.totalRobots, "Type:", typeof stats.totalRobots);
        logger.log("✅ Setting system stats:", stats);
        setSystemStats(stats);
      } else {
        console.error("❌ [SYSTEM STATS] Invalid response:", statsData);
        logger.error("❌ Failed to load system stats - invalid response:", statsData);
        setError("Failed to load system statistics");
      }
    } catch (err) {
      console.error("❌ [SYSTEM STATS] Error:", err);
      logger.error("❌ Error loading system stats:", err);
      setError(`Failed to load system statistics: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoadingStats(false);
    }
  };

  const loadAuditLogs = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoadingAuditLogs(true);
    try {
      const result = await client.queries.listAuditLogsLambda({ limit: 50 });
      
      let logsData: { success?: boolean; auditLogs?: any[] } | null = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            logsData = JSON.parse(firstParse);
          } else {
            logsData = firstParse;
          }
        } catch (e) {
          logsData = { success: false };
        }
      } else {
        logsData = result.data as typeof logsData;
      }

      if (logsData?.success && logsData.auditLogs) {
        setAuditLogs(logsData.auditLogs);
      }
    } catch (err) {
      logger.error("Error loading audit logs:", err);
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  const loadUserDetailData = async (username: string) => {
    if (!username) return;

    setLoadingUserDetail(true);
    try {
      // Get user's partnerId to find their robots
      const partners = await client.models.Partner.list({
        filter: { cognitoUsername: { eq: username } },
      });

      if (partners.data && partners.data.length > 0) {
        const partnerId = partners.data[0].id;
        
        // Get user's robots
        const robots = await client.models.Robot.list({
          filter: { partnerId: { eq: partnerId || undefined } },
        });
        setUserRobots(robots.data || []);
      } else {
        setUserRobots([]);
      }

      // Get user's transactions
      const transactions = await client.models.CreditTransaction.list({
        filter: { userId: { eq: username } },
      });
      // Filter out null values (GraphQL can return [null] for empty results)
      setUserTransactions((transactions.data || []).filter(t => t !== null));
    } catch (err) {
      logger.error("Error loading user detail data:", err);
    } finally {
      setLoadingUserDetail(false);
    }
  };

  const loadPlatformMarkup = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoadingMarkup(true);
    try {
      const { data: settings } = await client.models.PlatformSettings.list({
        filter: { settingKey: { eq: 'platformMarkupPercent' } },
      });

      if (settings && settings.length > 0) {
        const markupValue = parseFloat(settings[0].settingValue || '30');
        setPlatformMarkup(markupValue);
        setMarkupSettingId(settings[0].id);
      } else {
        // Default to 30% if not set
        setPlatformMarkup(30);
      }
    } catch (err) {
      logger.error("Error loading platform markup:", err);
    } finally {
      setLoadingMarkup(false);
    }
  };

  const savePlatformMarkup = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setSavingMarkup(true);
    setError(null);
    setSuccess(null);

    try {
      const markupValue = platformMarkup.toString();
      const now = new Date().toISOString();

      if (markupSettingId) {
        // Update existing setting
        const { errors } = await client.models.PlatformSettings.update({
          id: markupSettingId,
          settingValue: markupValue,
          updatedBy: user.username || user.email || 'admin',
          updatedAt: now,
        });

        if (errors) {
          setError("Failed to update platform markup");
        } else {
          setSuccess("Platform markup updated successfully!");
          setTimeout(() => setSuccess(null), 3000);
        }
      } else {
        // Create new setting
        const { errors } = await client.models.PlatformSettings.create({
          settingKey: 'platformMarkupPercent',
          settingValue: markupValue,
          description: 'Platform markup percentage applied to partner robot hourly rates',
          updatedBy: user.username || user.email || 'admin',
          updatedAt: now,
        });

        if (errors) {
          setError("Failed to create platform markup setting");
        } else {
          setSuccess("Platform markup created successfully!");
          setTimeout(() => setSuccess(null), 3000);
          loadPlatformMarkup(); // Reload to get the ID
        }
      }
    } catch (err) {
      logger.error("Error saving platform markup:", err);
      setError("An error occurred while saving platform markup");
    } finally {
      setSavingMarkup(false);
    }
  };

  const loadCreditTiers = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoadingTiers(true);
    try {
      const { data: tiers } = await client.models.CreditTier.list();
      
      if (tiers && tiers.length > 0) {
        // Sort by displayOrder or tierId
        const sortedTiers = [...tiers].sort((a, b) => {
          if (a.displayOrder !== null && b.displayOrder !== null) {
            return (a.displayOrder || 0) - (b.displayOrder || 0);
          }
          return (a.tierId || '').localeCompare(b.tierId || '');
        });
        setCreditTiers(sortedTiers);
      } else {
        // No tiers found - initialize default tiers
        await initializeDefaultTiers();
        // Reload tiers after initialization
        const { data: reloadedTiers } = await client.models.CreditTier.list();
        if (reloadedTiers) {
          const sortedTiers = [...reloadedTiers].sort((a, b) => {
            if (a.displayOrder !== null && b.displayOrder !== null) {
              return (a.displayOrder || 0) - (b.displayOrder || 0);
            }
            return (a.tierId || '').localeCompare(b.tierId || '');
          });
          setCreditTiers(sortedTiers);
        }
      }
    } catch (err) {
      logger.error("Error loading credit tiers:", err);
    } finally {
      setLoadingTiers(false);
    }
  };

  const initializeDefaultTiers = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    try {
      const now = new Date().toISOString();
      const defaultTiers = [
        {
          tierId: '20',
          name: 'Starter Pack',
          basePrice: 20.00,
          baseCredits: 2000,
          bonusCredits: 0,
          isActive: true,
          displayOrder: 1,
          description: 'Perfect for getting started',
        },
        {
          tierId: '50',
          name: 'Pro Pack',
          basePrice: 50.00,
          baseCredits: 5000,
          bonusCredits: 500,
          isActive: true,
          displayOrder: 2,
          description: 'Great value with bonus credits',
        },
        {
          tierId: '100',
          name: 'Elite Pack',
          basePrice: 100.00,
          baseCredits: 10000,
          bonusCredits: 1500,
          isActive: true,
          displayOrder: 3,
          description: 'Maximum value for power users',
        },
      ];

      for (const tier of defaultTiers) {
        // Check if tier already exists
        const { data: existing } = await client.models.CreditTier.list({
          filter: { tierId: { eq: tier.tierId } },
        });

        if (!existing || existing.length === 0) {
          await client.models.CreditTier.create({
            ...tier,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    } catch (err) {
      logger.error("Error initializing default tiers:", err);
    }
  };

  const saveCreditTier = async (tier: any) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setSavingMarkup(true);
    setError(null);
    setSuccess(null);

    try {
      const now = new Date().toISOString();
      const tierData = {
        tierId: tier.tierId,
        name: tier.name,
        basePrice: tier.basePrice,
        baseCredits: tier.baseCredits,
        bonusCredits: tier.bonusCredits || 0,
        isActive: tier.isActive !== false,
        description: tier.description,
        displayOrder: tier.displayOrder || 0,
        updatedAt: now,
      };

      if (tier.id) {
        // Update existing tier
        const { errors } = await client.models.CreditTier.update({
          id: tier.id,
          ...tierData,
        });

        if (errors) {
          setError("Failed to update credit tier");
        } else {
          setSuccess("Credit tier updated successfully!");
          setTimeout(() => setSuccess(null), 3000);
          setEditingTier(null);
          loadCreditTiers();
        }
      } else {
        // Create new tier
        const { errors } = await client.models.CreditTier.create({
          ...tierData,
          createdAt: now,
        });

        if (errors) {
          setError("Failed to create credit tier");
        } else {
          setSuccess("Credit tier created successfully!");
          setTimeout(() => setSuccess(null), 3000);
          setNewTier(null);
          loadCreditTiers();
        }
      }
    } catch (err) {
      logger.error("Error saving credit tier:", err);
      setError("An error occurred while saving credit tier");
    } finally {
      setSavingMarkup(false);
    }
  };

  const deleteCreditTier = async (tierId: string) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    if (!confirm("Are you sure you want to delete this credit tier? This action cannot be undone.")) {
      return;
    }

    setSavingMarkup(true);
    setError(null);
    setSuccess(null);

    try {
      const tier = creditTiers.find(t => t.id === tierId);
      if (!tier) {
        setError("Tier not found");
        return;
      }

      const { errors } = await client.models.CreditTier.delete({ id: tierId });

      if (errors) {
        setError("Failed to delete credit tier");
      } else {
        setSuccess("Credit tier deleted successfully!");
        setTimeout(() => setSuccess(null), 3000);
        loadCreditTiers();
      }
    } catch (err) {
      logger.error("Error deleting credit tier:", err);
      setError("An error occurred while deleting credit tier");
    } finally {
      setSavingMarkup(false);
    }
  };

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

  if (error && !hasAdminAccess(user?.email)) {
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

      {success && (
        <div className="admin-alert admin-alert-success">
          <FontAwesomeIcon icon={faCheckCircle} />
          <span>{success}</span>
        </div>
      )}

      <div className="admin-content">
        {/* System Statistics Section */}
        <div className="admin-section">
          <div className="section-header">
            <FontAwesomeIcon icon={faChartLine} className="section-icon" />
            <h2>System Statistics</h2>
          </div>
          <div className="section-content">
            {loadingStats ? (
              <div className="loading-state">
                <p>Loading statistics...</p>
              </div>
            ) : systemStats ? (
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-icon">
                    <FontAwesomeIcon icon={faUsers} />
                  </div>
                  <div className="stat-content">
                    <div className="stat-value">{systemStats.totalUsers || 'N/A'}</div>
                    <div className="stat-label">Total Users</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon">
                    <FontAwesomeIcon icon={faRobot} />
                  </div>
                  <div className="stat-content">
                    <div className="stat-value">{systemStats.totalRobots !== undefined && systemStats.totalRobots !== null ? systemStats.totalRobots : 'N/A'}</div>
                    <div className="stat-label">Total Robots</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon">
                    <FontAwesomeIcon icon={faDollarSign} />
                  </div>
                  <div className="stat-content">
                    <div className="stat-value">${systemStats.totalRevenue?.toLocaleString() || '0.00'}</div>
                    <div className="stat-label">Total Revenue</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon">
                    <FontAwesomeIcon icon={faCoins} />
                  </div>
                  <div className="stat-content">
                    <div className="stat-value">{systemStats.totalCredits?.toLocaleString() || '0'}</div>
                    <div className="stat-label">Total Credits</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon">
                    <FontAwesomeIcon icon={faHistory} />
                  </div>
                  <div className="stat-content">
                    <div className="stat-value">{systemStats.activeSessions || '0'}</div>
                    <div className="stat-label">Active Sessions</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <FontAwesomeIcon icon={faInfoCircle} />
                <p>Failed to load statistics</p>
              </div>
            )}
          </div>
        </div>

        {/* Audit Log Section */}
        <div className="admin-section">
          <div className="section-header">
            <FontAwesomeIcon icon={faHistory} className="section-icon" />
            <h2>Audit Log</h2>
          </div>
          <div className="section-content">
            <p className="section-description">
              All admin actions are logged here for security and compliance. This log can be integrated with blockchain in the future.
            </p>
            
            {loadingAuditLogs ? (
              <div className="loading-state">
                <p>Loading audit logs...</p>
              </div>
            ) : (
              <div className="audit-logs-list">
                {auditLogs.length === 0 ? (
                  <div className="empty-state">
                    <FontAwesomeIcon icon={faInfoCircle} />
                    <p>No audit logs found.</p>
                  </div>
                ) : (
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Action</th>
                        <th>Admin</th>
                        <th>Target User</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log, index) => (
                        <tr key={index}>
                          <td>{log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}</td>
                          <td>
                            <span className="action-badge">{log.action || 'N/A'}</span>
                          </td>
                          <td>{log.adminUserId || 'N/A'}</td>
                          <td>{log.targetUserId || 'N/A'}</td>
                          <td>{log.reason || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Platform Settings Section */}
        <div className="admin-section">
          <div className="section-header">
            <FontAwesomeIcon icon={faSlidersH} className="section-icon" />
            <h2>Platform Settings</h2>
          </div>
          <div className="section-content">
            <p className="section-description">
              Configure platform-wide settings including markup percentage and credit tier management.
            </p>

            {/* Platform Markup */}
            <div className="platform-setting-card">
              <h3>Platform Markup Percentage</h3>
              <p className="setting-description">
                The percentage markup applied to partner robot hourly rates. This is the platform's revenue share.
              </p>
              <div className="setting-input-group">
                <label className="markup-input-label">
                  Markup Percentage:
                  <div className="markup-input-wrapper">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={platformMarkup}
                      onChange={(e) => setPlatformMarkup(parseFloat(e.target.value) || 0)}
                      disabled={loadingMarkup || savingMarkup}
                      className="markup-input"
                    />
                    <span className="input-suffix">%</span>
                  </div>
                </label>
                <button
                  className="admin-button"
                  onClick={savePlatformMarkup}
                  disabled={loadingMarkup || savingMarkup}
                >
                  {savingMarkup ? (
                    <>
                      <FontAwesomeIcon icon={faCog} spin />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <FontAwesomeIcon icon={faSave} />
                      <span>Save Markup</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Credit Tiers Management */}
            <div className="platform-setting-card">
              <div className="setting-header-row">
                <h3>Credit Tiers</h3>
                <button
                  className="admin-button"
                  onClick={() => setNewTier({
                    tierId: '',
                    name: '',
                    basePrice: 0,
                    baseCredits: 0,
                    bonusCredits: 0,
                    isActive: true,
                    displayOrder: creditTiers.length + 1,
                  })}
                >
                  <FontAwesomeIcon icon={faPlus} />
                  <span>Add New Tier</span>
                </button>
              </div>
              <p className="setting-description">
                Manage credit purchase tiers. Users can buy credits in these predefined packages with optional bonus credits.
              </p>

              {loadingTiers ? (
                <div className="loading-state">
                  <p>Loading credit tiers...</p>
                </div>
              ) : (
                <div className="tiers-list">
                  {newTier && (
                    <div className="tier-card tier-editing">
                      <h4>New Credit Tier</h4>
                      <div className="tier-form">
                        <div className="form-row">
                          <label>
                            Tier ID (unique):
                            <input
                              type="text"
                              value={newTier.tierId}
                              onChange={(e) => setNewTier({ ...newTier, tierId: e.target.value })}
                              placeholder="e.g., '20', '50', '100'"
                            />
                          </label>
                          <label>
                            Display Name:
                            <input
                              type="text"
                              value={newTier.name}
                              onChange={(e) => setNewTier({ ...newTier, name: e.target.value })}
                              placeholder="e.g., 'Starter Pack'"
                            />
                          </label>
                        </div>
                        <div className="form-row">
                          <label>
                            Base Price (USD):
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={newTier.basePrice}
                              onChange={(e) => setNewTier({ ...newTier, basePrice: parseFloat(e.target.value) || 0 })}
                            />
                          </label>
                          <label>
                            Base Credits:
                            <input
                              type="number"
                              min="0"
                              step="100"
                              value={newTier.baseCredits}
                              onChange={(e) => setNewTier({ ...newTier, baseCredits: parseInt(e.target.value) || 0 })}
                            />
                          </label>
                        </div>
                        <div className="form-row">
                          <label>
                            Bonus Credits:
                            <input
                              type="number"
                              min="0"
                              step="100"
                              value={newTier.bonusCredits}
                              onChange={(e) => setNewTier({ ...newTier, bonusCredits: parseInt(e.target.value) || 0 })}
                            />
                          </label>
                          <label>
                            Display Order:
                            <input
                              type="number"
                              min="0"
                              value={newTier.displayOrder}
                              onChange={(e) => setNewTier({ ...newTier, displayOrder: parseInt(e.target.value) || 0 })}
                            />
                          </label>
                        </div>
                        <div className="form-row">
                          <label>
                            Description:
                            <input
                              type="text"
                              value={newTier.description || ''}
                              onChange={(e) => setNewTier({ ...newTier, description: e.target.value })}
                              placeholder="Optional description"
                            />
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={newTier.isActive}
                              onChange={(e) => setNewTier({ ...newTier, isActive: e.target.checked })}
                            />
                            Active (available for purchase)
                          </label>
                        </div>
                        <div className="tier-actions">
                          <button
                            className="admin-button"
                            onClick={() => saveCreditTier(newTier)}
                            disabled={savingMarkup || !newTier.tierId || !newTier.name}
                          >
                            <FontAwesomeIcon icon={faSave} />
                            <span>Create Tier</span>
                          </button>
                          <button
                            className="admin-button admin-button-secondary"
                            onClick={() => setNewTier(null)}
                          >
                            <FontAwesomeIcon icon={faBan} />
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {creditTiers.length === 0 && !newTier ? (
                    <div className="empty-state">
                      <FontAwesomeIcon icon={faInfoCircle} />
                      <p>No credit tiers found. Create your first tier to get started.</p>
                    </div>
                  ) : (
                    creditTiers.map((tier) => (
                      <div key={tier.id} className={`tier-card ${editingTier === tier.id ? 'tier-editing' : ''}`}>
                        {editingTier === tier.id ? (
                          <>
                            <h4>Edit Tier: {tier.name}</h4>
                            <div className="tier-form">
                              <div className="form-row">
                                <label>
                                  Tier ID:
                                  <input
                                    type="text"
                                    value={tier.tierId}
                                    onChange={(e) => {
                                      const updated = creditTiers.map(t => 
                                        t.id === tier.id ? { ...t, tierId: e.target.value } : t
                                      );
                                      setCreditTiers(updated);
                                    }}
                                    disabled
                                  />
                                </label>
                                <label>
                                  Display Name:
                                  <input
                                    type="text"
                                    value={tier.name}
                                    onChange={(e) => {
                                      const updated = creditTiers.map(t => 
                                        t.id === tier.id ? { ...t, name: e.target.value } : t
                                      );
                                      setCreditTiers(updated);
                                    }}
                                  />
                                </label>
                              </div>
                              <div className="form-row">
                                <label>
                                  Base Price (USD):
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={tier.basePrice}
                                    onChange={(e) => {
                                      const updated = creditTiers.map(t => 
                                        t.id === tier.id ? { ...t, basePrice: parseFloat(e.target.value) || 0 } : t
                                      );
                                      setCreditTiers(updated);
                                    }}
                                  />
                                </label>
                                <label>
                                  Base Credits:
                                  <input
                                    type="number"
                                    min="0"
                                    step="100"
                                    value={tier.baseCredits}
                                    onChange={(e) => {
                                      const updated = creditTiers.map(t => 
                                        t.id === tier.id ? { ...t, baseCredits: parseInt(e.target.value) || 0 } : t
                                      );
                                      setCreditTiers(updated);
                                    }}
                                  />
                                </label>
                              </div>
                              <div className="form-row">
                                <label>
                                  Bonus Credits:
                                  <input
                                    type="number"
                                    min="0"
                                    step="100"
                                    value={tier.bonusCredits || 0}
                                    onChange={(e) => {
                                      const updated = creditTiers.map(t => 
                                        t.id === tier.id ? { ...t, bonusCredits: parseInt(e.target.value) || 0 } : t
                                      );
                                      setCreditTiers(updated);
                                    }}
                                  />
                                </label>
                                <label>
                                  Display Order:
                                  <input
                                    type="number"
                                    min="0"
                                    value={tier.displayOrder || 0}
                                    onChange={(e) => {
                                      const updated = creditTiers.map(t => 
                                        t.id === tier.id ? { ...t, displayOrder: parseInt(e.target.value) || 0 } : t
                                      );
                                      setCreditTiers(updated);
                                    }}
                                  />
                                </label>
                              </div>
                              <div className="form-row">
                                <label>
                                  Description:
                                  <input
                                    type="text"
                                    value={tier.description || ''}
                                    onChange={(e) => {
                                      const updated = creditTiers.map(t => 
                                        t.id === tier.id ? { ...t, description: e.target.value } : t
                                      );
                                      setCreditTiers(updated);
                                    }}
                                  />
                                </label>
                                <label className="checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={tier.isActive !== false}
                                    onChange={(e) => {
                                      const updated = creditTiers.map(t => 
                                        t.id === tier.id ? { ...t, isActive: e.target.checked } : t
                                      );
                                      setCreditTiers(updated);
                                    }}
                                  />
                                  Active (available for purchase)
                                </label>
                              </div>
                              <div className="tier-actions">
                                <button
                                  className="admin-button"
                                  onClick={() => {
                                    const tierToSave = creditTiers.find(t => t.id === tier.id);
                                    if (tierToSave) saveCreditTier(tierToSave);
                                  }}
                                  disabled={savingMarkup}
                                >
                                  <FontAwesomeIcon icon={faSave} />
                                  <span>Save Changes</span>
                                </button>
                                <button
                                  className="admin-button admin-button-secondary"
                                  onClick={() => {
                                    setEditingTier(null);
                                    loadCreditTiers(); // Reload to reset changes
                                  }}
                                >
                                  <FontAwesomeIcon icon={faBan} />
                                  <span>Cancel</span>
                                </button>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="tier-header">
                              <div>
                                <h4>{tier.name}</h4>
                                <p className="tier-id">Tier ID: {tier.tierId}</p>
                              </div>
                              <div className="tier-status">
                                {tier.isActive ? (
                                  <span className="status-badge status-active">Active</span>
                                ) : (
                                  <span className="status-badge status-inactive">Inactive</span>
                                )}
                              </div>
                            </div>
                            <div className="tier-details">
                              <div className="tier-detail-item">
                                <span className="detail-label">Base Price:</span>
                                <span className="detail-value">${tier.basePrice?.toFixed(2) || '0.00'}</span>
                              </div>
                              <div className="tier-detail-item">
                                <span className="detail-label">Base Credits:</span>
                                <span className="detail-value">{tier.baseCredits?.toLocaleString() || '0'}</span>
                              </div>
                              <div className="tier-detail-item">
                                <span className="detail-label">Bonus Credits:</span>
                                <span className="detail-value highlight">{tier.bonusCredits?.toLocaleString() || '0'}</span>
                              </div>
                              <div className="tier-detail-item">
                                <span className="detail-label">Total Credits:</span>
                                <span className="detail-value highlight">
                                  {((tier.baseCredits || 0) + (tier.bonusCredits || 0)).toLocaleString()}
                                </span>
                              </div>
                              {tier.description && (
                                <div className="tier-detail-item full-width">
                                  <span className="detail-label">Description:</span>
                                  <span className="detail-value">{tier.description}</span>
                                </div>
                              )}
                            </div>
                            <div className="tier-actions">
                              <button
                                className="admin-button"
                                onClick={() => setEditingTier(tier.id || null)}
                              >
                                <FontAwesomeIcon icon={faEdit} />
                                <span>Edit</span>
                              </button>
                              <button
                                className="admin-button admin-button-danger"
                                onClick={() => tier.id && deleteCreditTier(tier.id)}
                              >
                                <FontAwesomeIcon icon={faTrash} />
                                <span>Delete</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Users Management Section */}
        <div className="admin-section">
          <div className="section-header">
            <FontAwesomeIcon icon={faUsers} className="section-icon" />
            <h2>Users</h2>
          </div>
          <div className="section-content">
            <p className="section-description">
              View and manage all platform users. Click "View Details" to see full profile information and manage credits.
            </p>
            
            {loadingUsers ? (
              <div className="loading-state">
                <p>Loading users...</p>
              </div>
            ) : (
              <div className="users-list">
                {users.length === 0 ? (
                  <div className="empty-state">
                    <FontAwesomeIcon icon={faInfoCircle} />
                    <p>No users found.</p>
                  </div>
                ) : (
                  <>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Classification</th>
                          <th>Credits</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user, index) => (
                          <tr key={index}>
                            <td>{user.name || 'N/A'}</td>
                            <td>{user.email || 'N/A'}</td>
                            <td>
                              <select
                                className="classification-select"
                                value={user.classification || 'CLIENT'}
                                onChange={(e) => handleClassificationChange(user.username, e.target.value)}
                                disabled={user.classification === 'ADMIN' || !user.enabled}
                                title={user.classification === 'ADMIN' ? 'Cannot change admin classification' : ''}
                              >
                                <option value="CLIENT">Client</option>
                                <option value="PARTNER">Partner</option>
                                <option value="ADMIN" disabled>Admin (use Admin panel)</option>
                              </select>
                            </td>
                            <td>
                              <span className="credits-display">
                                <FontAwesomeIcon icon={faCoins} />
                                {user.credits?.toLocaleString() || '0'}
                              </span>
                            </td>
                            <td>
                              <span className={`status-badge ${user.enabled ? 'status-active' : 'status-inactive'}`}>
                                <FontAwesomeIcon icon={user.enabled ? faCheckCircle : faExclamationTriangle} />
                                {user.enabled ? 'Active' : 'Disabled'}
                              </span>
                            </td>
                            <td>
                              <button
                                className="admin-button admin-button-secondary"
                                onClick={() => handleViewUser(user)}
                                title="View user details"
                              >
                                <FontAwesomeIcon icon={faEye} />
                                <span>View Details</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    
                    {/* Pagination */}
                    <div className="pagination">
                      <button
                        className="admin-button"
                        onClick={handlePrevPage}
                        disabled={!paginationToken || loadingUsers}
                      >
                        <FontAwesomeIcon icon={faChevronLeft} />
                        <span>Previous</span>
                      </button>
                      <span className="pagination-info">
                        Showing {users.length} users
                        {paginationToken && ' (more available)'}
                      </span>
                      <button
                        className="admin-button"
                        onClick={handleNextPage}
                        disabled={!paginationToken || loadingUsers}
                      >
                        <span>Next</span>
                        <FontAwesomeIcon icon={faChevronRight} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* User Detail Modal */}
      {showUserDetail && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowUserDetail(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>User Details</h2>
              <button
                className="modal-close"
                onClick={() => setShowUserDetail(false)}
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="user-detail-section">
                <h3>Profile Information</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <label>Username</label>
                    <div>{selectedUser.username || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <label>Email</label>
                    <div>{selectedUser.email || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <label>Name</label>
                    <div>{selectedUser.name || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <label>Status</label>
                    <div>
                      <span className={`status-badge ${selectedUser.enabled ? 'status-active' : 'status-inactive'}`}>
                        {selectedUser.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                  <div className="detail-item">
                    <label>Created</label>
                    <div>{selectedUser.createdAt ? new Date(selectedUser.createdAt).toLocaleDateString() : 'N/A'}</div>
                  </div>
                </div>
              </div>

              <div className="user-detail-section">
                <h3>Credit Balance</h3>
                <div className="credit-display-large">
                  <FontAwesomeIcon icon={faCoins} />
                  <span>{selectedUser.credits?.toLocaleString() || '0'} credits</span>
                </div>
              </div>

              {/* User's Robots */}
              <div className="user-detail-section">
                <h3>User's Robots</h3>
                {loadingUserDetail ? (
                  <div className="loading-state">
                    <p>Loading robots...</p>
                  </div>
                ) : userRobots.length === 0 ? (
                  <div className="empty-state">
                    <FontAwesomeIcon icon={faInfoCircle} />
                    <p>This user has no robots listed.</p>
                  </div>
                ) : (
                  <div className="user-robots-list">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Model</th>
                          <th>Location</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {userRobots.map((robot) => (
                          <tr key={robot.id}>
                            <td>{robot.name || 'N/A'}</td>
                            <td>{robot.model || 'N/A'}</td>
                            <td>
                              {[robot.city, robot.state, robot.country].filter(Boolean).join(', ') || 'N/A'}
                            </td>
                            <td>
                              <button
                                className="admin-button admin-button-danger"
                                onClick={() => {
                                  // TODO: Implement remove robot
                                  logger.log("Remove robot:", robot.id);
                                }}
                                title="Remove robot"
                              >
                                <FontAwesomeIcon icon={faTrash} />
                                <span>Remove</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Transaction History */}
              <div className="user-detail-section">
                <h3>Transaction History</h3>
                {loadingUserDetail ? (
                  <div className="loading-state">
                    <p>Loading transactions...</p>
                  </div>
                ) : userTransactions.length === 0 ? (
                  <div className="empty-state">
                    <FontAwesomeIcon icon={faInfoCircle} />
                    <p>No transactions found for this user.</p>
                  </div>
                ) : (
                  <div className="user-transactions-list">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Amount</th>
                          <th>Price Paid</th>
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {userTransactions.filter(t => t !== null).map((transaction) => (
                          <tr key={transaction.id}>
                            <td>
                              {transaction.createdAt 
                                ? new Date(transaction.createdAt).toLocaleString() 
                                : 'N/A'}
                            </td>
                            <td>
                              <span className={`action-badge ${transaction.type === 'purchase' ? 'badge-success' : 'badge-warning'}`}>
                                {transaction.type || 'N/A'}
                              </span>
                            </td>
                            <td>{transaction.amount?.toLocaleString() || '0'} credits</td>
                            <td>
                              {transaction.pricePaid 
                                ? `${transaction.currency || 'USD'} ${transaction.pricePaid.toFixed(2)}`
                                : '-'}
                            </td>
                            <td>{transaction.description || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* User Management Actions */}
              <div className="user-detail-section">
                <h3>User Management</h3>
                <div className="user-actions">
                  {selectedUser.email && !selectedUser.email.toLowerCase().endsWith('@modulr.cloud') ? (
                    <button
                      className="admin-button admin-button-danger"
                      onClick={() => {
                        // TODO: Implement remove user
                        logger.log("Remove user:", selectedUser.username);
                      }}
                      title="Remove user from platform"
                    >
                      <FontAwesomeIcon icon={faTrash} />
                      <span>Remove User from Platform</span>
                    </button>
                  ) : (
                    <div className="info-message">
                      <FontAwesomeIcon icon={faInfoCircle} />
                      <p>Modulr employees (@modulr.cloud) cannot be removed from the platform.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

