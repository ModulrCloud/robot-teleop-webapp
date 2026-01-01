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
  faBroom,
  faSync,
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
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success'; visible: boolean }>({ 
    message: '', 
    type: 'error', 
    visible: false 
  });
  
  // System stats
  const [systemStats, setSystemStats] = useState<any | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  
  // Audit logs
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [auditLogsPaginationToken, setAuditLogsPaginationToken] = useState<string | null>(null);
  
  // Payouts
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loadingPayouts, setLoadingPayouts] = useState(false);
  const [payoutsPaginationToken, setPayoutsPaginationToken] = useState<string | null>(null);
  const [payoutStatusFilter, setPayoutStatusFilter] = useState<string>('pending');
  const [processingPayouts, setProcessingPayouts] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'earnings' | 'date'>('earnings'); // 'earnings' = highest first, 'date' = newest first
  
  // User detail data
  const [userRobots, setUserRobots] = useState<any[]>([]);
  const [userTransactions, setUserTransactions] = useState<any[]>([]);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);
  
  // Credit adjustment
  const [creditAdjustment, setCreditAdjustment] = useState<string>('');
  const [creditDescription, setCreditDescription] = useState<string>('');
  const [adjustingCredits, setAdjustingCredits] = useState(false);
  
  // Active robots and cleanup
  const [activeRobots, setActiveRobots] = useState<any | null>(null);
  const [loadingActiveRobots, setLoadingActiveRobots] = useState(false);
  const [triggeringCleanup, setTriggeringCleanup] = useState(false);
  
  // Sanitize and validate credit adjustment input
  const handleCreditAdjustmentChange = (value: string) => {
    // Remove any non-numeric characters except minus sign at the start
    let sanitized = value.replace(/[^\d-]/g, '');
    
    // Only allow minus sign at the beginning
    if (sanitized.includes('-')) {
      const minusIndex = sanitized.indexOf('-');
      if (minusIndex !== 0) {
        sanitized = sanitized.replace(/-/g, '');
      } else if (sanitized.split('-').length > 2) {
        // Multiple minus signs, keep only the first one
        sanitized = '-' + sanitized.replace(/-/g, '');
      }
    }
    
    // Remove leading zeros (but keep -0 or 0)
    if (sanitized.length > 1 && sanitized[0] === '0' && sanitized[1] !== '.') {
      sanitized = sanitized.substring(1);
    }
    if (sanitized.length > 2 && sanitized[0] === '-' && sanitized[1] === '0' && sanitized[2] !== '.') {
      sanitized = '-' + sanitized.substring(2);
    }
    
    setCreditAdjustment(sanitized);
  };
  
  // Platform Settings
  const [platformMarkup, setPlatformMarkup] = useState<number>(30);
  const [loadingMarkup, setLoadingMarkup] = useState(false);
  const [savingMarkup, setSavingMarkup] = useState(false);
  const [markupSettingId, setMarkupSettingId] = useState<string | null>(null);
  
  // Low Credits Warning Setting
  const [lowCreditsWarningMinutes, setLowCreditsWarningMinutes] = useState<number>(1);
  const [loadingWarningSetting, setLoadingWarningSetting] = useState(false);
  const [savingWarningSetting, setSavingWarningSetting] = useState(false);
  const [warningSettingId, setWarningSettingId] = useState<string | null>(null);
  
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
      loadActiveRobots().catch(err => logger.error("Failed to load active robots:", err));
      loadAuditLogs().catch(err => logger.error("Failed to load audit logs:", err));
      loadPlatformMarkup().catch(err => logger.error("Failed to load platform markup:", err));
      loadLowCreditsWarningSetting().catch(err => logger.error("Failed to load low credits warning setting:", err));
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
      logger.debug("🔍 [DEBUG] Checking Client model...");
      const { data: clients, errors: clientErrors } = await client.models.Client.list();
      logger.debug("📊 [DEBUG] Client model results:", {
        count: clients?.length || 0,
        clients: clients,
        errors: clientErrors,
      });

      logger.debug("🔍 [DEBUG] Checking Partner model...");
      const { data: partners, errors: partnerErrors } = await client.models.Partner.list();
      logger.debug("📊 [DEBUG] Partner model results:", {
        count: partners?.length || 0,
        partners: partners,
        errors: partnerErrors,
      });

      // Log all cognitoUsernames
      const allClientUsernames = clients?.map(c => c.cognitoUsername).filter(Boolean) || [];
      const allPartnerUsernames = partners?.map(p => p.cognitoUsername).filter(Boolean) || [];
      logger.debug("👥 [DEBUG] All Client cognitoUsernames:", allClientUsernames);
      logger.debug("👥 [DEBUG] All Partner cognitoUsernames:", allPartnerUsernames);
      logger.debug("👥 [DEBUG] Total unique users:", new Set([...allClientUsernames, ...allPartnerUsernames]).size);
    } catch (err) {
      logger.error("❌ [DEBUG] Error checking Client/Partner models:", err);
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
      logger.debug("🔍 [DEBUG] Raw listUsersLambda response:", JSON.stringify(result, null, 2));
      logger.log("✅ listUsersLambda response:", result);
      
      // Parse the JSON response
      let usersData: { success?: boolean; users?: any[]; nextToken?: string | null } | null = null;
      
      if (!result || !result.data) {
        logger.error("❌ [DEBUG] No data in response:", result);
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
          logger.error("❌ [DEBUG] Failed to parse JSON response:", e, "Raw data:", result.data);
          setError("Failed to load users: Invalid JSON response");
          return;
        }
      } else {
        usersData = result.data as any;
      }

      logger.debug("📊 [DEBUG] Parsed users data:", JSON.stringify(usersData, null, 2));
      logger.log("📊 Parsed users data:", usersData);

      if (!usersData) {
        logger.error("❌ [DEBUG] Users data is null or undefined");
        setError("Failed to load users: No data returned from server");
        return;
      }

      if (usersData.success !== false) {
        // Success
        logger.debug("✅ [DEBUG] Setting users:", usersData.users?.length || 0, "users");
        logger.debug("✅ [DEBUG] Users array:", JSON.stringify(usersData.users, null, 2));
        setUsers(usersData.users || []);
        setPaginationToken(usersData.nextToken || null);
        setError(null); // Clear any previous errors
        logger.log("✅ [DEBUG] Set pagination token:", usersData.nextToken);
        logger.log(`✅ Successfully loaded ${usersData.users?.length || 0} users`);
      } else {
        logger.error("❌ [DEBUG] Users data indicates failure:", usersData);
        setError("Failed to load users: Server returned error");
      }
    } catch (err) {
      logger.error("❌ [DEBUG] Error loading users:", err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load users: ${errorMessage}`);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleViewUser = async (user: any) => {
    setSelectedUser(user);
    setShowUserDetail(true);
    // Clear credit adjustment fields when opening modal
    setCreditAdjustment('');
    setCreditDescription('');
    await loadUserDetailData(user.username);
  };

  const handleAdjustCredits = async (userId: string, credits: number) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      setError("Unauthorized: Admin access required");
      return;
    }

    if (!credits || credits === 0) {
      setError("Credit amount cannot be zero");
      return;
    }

    setAdjustingCredits(true);
    setError(null);
    setSuccess(null);

    try {
      logger.log("🔄 Adjusting credits:", { userId, credits, description: creditDescription });
      
      const result = await client.mutations.addCreditsLambda({
        userId,
        credits,
        description: creditDescription || undefined,
      });

      logger.log("📦 Raw result from addCreditsLambda:", result);
      logger.debug("📦 Full result object:", JSON.stringify(result, null, 2));

      // Check for errors in the result
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        logger.error("❌ GraphQL errors:", result.errors);
        setError(`GraphQL Error: ${errorMessages}`);
        return;
      }

      let resultData: any = null;
      if (typeof result.data === 'string') {
        try {
          // The data might be double-encoded JSON (string containing JSON string)
          let parsed = JSON.parse(result.data);
          // If it's still a string, parse it again
          if (typeof parsed === 'string') {
            resultData = JSON.parse(parsed);
          } else {
            resultData = parsed;
          }
        } catch (e) {
          logger.error("Failed to parse result.data as JSON:", e, "Raw data:", result.data);
          setError(`Failed to parse response: ${result.data}`);
          return;
        }
      } else {
        resultData = result.data;
      }

      logger.log("✅ Parsed result data:", resultData);

      if (resultData?.success) {
        const action = credits > 0 ? 'added' : 'deducted';
        setSuccess(`Successfully ${action} ${Math.abs(credits).toLocaleString()} credits. New balance: ${resultData.newBalance?.toLocaleString() || 'N/A'}`);
        
        // Update selected user's credit balance in the UI
        if (selectedUser) {
          setSelectedUser({
            ...selectedUser,
            credits: resultData.newBalance,
          });
        }

        // If the updated user is the current logged-in user, trigger a refresh of their credits in the Navbar
        if (user?.username && userId === user.username) {
          // Dispatch a custom event to trigger credit refresh in Navbar
          window.dispatchEvent(new CustomEvent('creditsUpdated'));
        }

        // Clear form
        setCreditAdjustment('');
        setCreditDescription('');

        // Reload user detail data to refresh transactions
        await loadUserDetailData(userId);
        
        // Reload audit logs to show the new entry
        await loadAuditLogs();

        setTimeout(() => setSuccess(null), 5000);
      } else {
        const errorMsg = resultData?.error || resultData?.message || "Failed to adjust credits";
        logger.error("❌ Credit adjustment failed:", resultData);
        setError(errorMsg);
      }
    } catch (err) {
      logger.error("❌ Error adjusting credits:", err);
      logger.error("❌ Full error object:", err);
      
      // Extract more detailed error information
      let errorMessage = "Failed to adjust credits";
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'object' && err !== null) {
        // Try to extract error message from various error formats
        const errObj = err as any;
        errorMessage = errObj.message || errObj.error?.message || errObj.errors?.[0]?.message || JSON.stringify(err);
      }
      
      setError(errorMessage);
    } finally {
      setAdjustingCredits(false);
    }
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
      logger.log(`🔄 Changing classification for ${username} to ${newClassification}`);
      
      // Check for robots BEFORE attempting conversion (only when converting Partner to Client)
      if (newClassification === 'CLIENT') {
        logger.debug(`🔍 Checking for robots before converting ${username} to CLIENT...`);
        const { data: partners } = await client.models.Partner.list({
          filter: { cognitoUsername: { eq: username } },
        });
        
        logger.debug(`📊 Found ${partners?.length || 0} partner record(s) for ${username}`);
        
        if (partners && partners.length > 0) {
          const partnerId = partners[0].id;
          logger.debug(`🤖 Checking for robots with partnerId: ${partnerId}`);
          
          // Check if this partner has any robots
          const { data: robots } = await client.models.Robot.list({
            filter: { partnerId: { eq: partnerId || undefined } },
          });
          
          logger.debug(`📊 Found ${robots?.length || 0} robot(s) for partner ${partnerId}`);
          
          if (robots && robots.length > 0) {
            const errorMsg = `Cannot convert Partner to Client: This partner has ${robots.length} robot(s) listed. Please delete or transfer all robots before converting.`;
            logger.error(`❌ ${errorMsg}`);
            setError(errorMsg);
            // Show toast notification
            setToast({ message: errorMsg, type: 'error', visible: true });
            setTimeout(() => {
              setToast(prev => ({ ...prev, visible: false }));
              setTimeout(() => setError(null), 300);
            }, 6000);
            return;
          }
        } else {
          logger.debug(`ℹ️ No partner record found for ${username}, skipping robot check`);
        }
      }
      
      // Use setUserGroupLambda to change the Cognito group
      const groupValue = newClassification.toLowerCase() === 'partner' ? 'partner' : 'client';
      const response = await client.mutations.setUserGroupLambda({
        group: groupValue,
        targetUsername: username, // Admin can change other users' groups
      });

      logger.log("✅ setUserGroupLambda response:", response);

      // Parse the response to check for errors
      let responseData: any = null;
      if (response.data) {
        if (typeof response.data === 'string') {
          try {
            responseData = JSON.parse(response.data);
          } catch (e) {
            responseData = response.data;
          }
        } else {
          responseData = response.data;
        }
      }

      // Check if the Lambda returned an error
      if (responseData?.statusCode && responseData.statusCode !== 200) {
        let errorMessage = "Failed to change user classification";
        if (responseData.body) {
          try {
            const bodyData = typeof responseData.body === 'string' ? JSON.parse(responseData.body) : responseData.body;
            errorMessage = bodyData.error || bodyData.message || errorMessage;
            // Include details if available
            if (bodyData.details) {
              errorMessage += `: ${bodyData.details}`;
            }
          } catch (e) {
            errorMessage = responseData.body;
          }
        }
        setError(errorMessage);
        logger.error("❌ Classification change failed:", responseData);
        return;
      }

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
        // Remove from Partner if exists (we already checked for robots above)
        const { data: partners } = await client.models.Partner.list({
          filter: { cognitoUsername: { eq: username } },
        });
        
        if (partners && partners.length > 0) {
          // Safe to delete Partner record (no robots - we checked above)
          await client.models.Partner.delete({ id: partners[0].id });
        }
        
        // Check if Client record exists, create if not
        const { data: clients } = await client.models.Client.list({
          filter: { cognitoUsername: { eq: username } },
        });
        if (!clients || clients.length === 0) {
          await client.models.Client.create({
            cognitoUsername: username,
          });
        }
      }

      setSuccess(`User classification updated to ${newClassification}`);
      setTimeout(() => setSuccess(null), 3000);
      
      // Reload users to reflect the change
      await loadUsers(paginationToken || null);
    } catch (err) {
      logger.error("❌ Error changing classification:", err);
      setError(`Failed to change classification: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const loadSystemStats = async () => {
    logger.debug("🔍 [SYSTEM STATS] loadSystemStats called");
    
    if (!user?.email || !hasAdminAccess(user.email)) {
      logger.warn("⚠️ [SYSTEM STATS] No admin access, skipping");
      return;
    }

    logger.debug("✅ [SYSTEM STATS] Admin access confirmed, loading stats...");
    setLoadingStats(true);
    try {
      logger.debug("🔍 [SYSTEM STATS] Calling getSystemStatsLambda...");
      logger.log("🔍 Calling getSystemStatsLambda...");
      const result = await client.queries.getSystemStatsLambda();
      logger.debug("📊 [SYSTEM STATS] Raw result from Lambda:", result);
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

      logger.debug("📈 [SYSTEM STATS] Parsed stats data:", statsData);
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
        logger.debug("✅ [SYSTEM STATS] Final stats object:", stats);
        logger.debug("✅ [SYSTEM STATS] Total Robots value:", stats.totalRobots, "Type:", typeof stats.totalRobots);
        logger.log("✅ Setting system stats:", stats);
        setSystemStats(stats);
      } else {
        logger.error("❌ [SYSTEM STATS] Invalid response:", statsData);
        setError("Failed to load system statistics");
      }
    } catch (err) {
      logger.error("❌ [SYSTEM STATS] Error:", err);
      setError(`Failed to load system statistics: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoadingStats(false);
    }
  };

  const loadActiveRobots = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoadingActiveRobots(true);
    try {
      logger.log("🔍 Calling getActiveRobotsLambda...");
      const result = await client.queries.getActiveRobotsLambda();
      logger.log("📊 Raw result from getActiveRobotsLambda:", result);
      
      // Check for GraphQL errors first
      if (result.errors && result.errors.length > 0) {
        logger.error("GraphQL errors in getActiveRobotsLambda:", result.errors);
        setError(`Failed to load active robots: ${result.errors.map((e: any) => e.message).join(', ')}`);
        return;
      }
      
      let robotsData: any = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          robotsData = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
        } catch (e) {
          logger.error("Failed to parse active robots response:", e);
          robotsData = null;
        }
      } else {
        robotsData = result.data;
      }

      logger.log("📈 Parsed active robots data:", robotsData);
      if (robotsData) {
        setActiveRobots(robotsData);
      } else {
        logger.warn("No active robots data returned");
      }
    } catch (err) {
      logger.error("Error loading active robots:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Full error details:", { error: err, message: errorMessage });
      // Don't set error state for this - it's not critical, just log it
      // setError(`Failed to load active robots: ${errorMessage}`);
    } finally {
      setLoadingActiveRobots(false);
    }
  };

  const handleTriggerCleanup = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      setError("Unauthorized: Admin access required");
      return;
    }

    setTriggeringCleanup(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await client.mutations.triggerConnectionCleanupLambda();
      
      let cleanupResult: any = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          cleanupResult = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
        } catch (e) {
          logger.error("Failed to parse cleanup response:", e);
        }
      } else {
        cleanupResult = result.data;
      }

      if (cleanupResult?.result?.stats) {
        const stats = cleanupResult.result.stats;
        setSuccess(
          `Cleanup completed! Scanned: ${stats.totalConnections || 0}, ` +
          `Stale: ${stats.staleConnections || 0}, ` +
          `Cleaned: ${stats.cleanedConnections || 0} connections`
        );
        // Reload active robots to reflect cleanup
        await loadActiveRobots();
      } else {
        setSuccess("Cleanup triggered successfully");
      }
    } catch (err) {
      logger.error("Error triggering cleanup:", err);
      setError(`Failed to trigger cleanup: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTriggeringCleanup(false);
    }
  };

  const loadAuditLogs = async (token?: string | null) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoadingAuditLogs(true);
    try {
      const result = await client.queries.listAuditLogsLambda({ 
        limit: 10, // 10 records per page
        paginationToken: token || undefined,
      });
      
      let logsData: { success?: boolean; auditLogs?: any[]; nextToken?: string | null } | null = null;
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
        setAuditLogsPaginationToken(logsData.nextToken || null);
      }
    } catch (err) {
      logger.error("Error loading audit logs:", err);
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  const handleAuditLogsNextPage = () => {
    if (auditLogsPaginationToken) {
      loadAuditLogs(auditLogsPaginationToken);
    }
  };

  const handleAuditLogsPrevPage = () => {
    // Note: DynamoDB doesn't support backward pagination easily
    // For now, just reload from the beginning
    setAuditLogsPaginationToken(null);
    loadAuditLogs(null);
  };

  const loadPayouts = async (token?: string | null, status?: string) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoadingPayouts(true);
    try {
      const result = await client.queries.listPartnerPayoutsLambda({ 
        limit: 50,
        status: status || payoutStatusFilter || undefined,
        nextToken: token || undefined,
      });
      
      let payoutsData: { success?: boolean; payouts?: any[]; nextToken?: string | null } | null = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            payoutsData = JSON.parse(firstParse);
          } else {
            payoutsData = firstParse;
          }
        } catch (e) {
          payoutsData = { success: false };
        }
      } else {
        payoutsData = result.data as typeof payoutsData;
      }

      if (payoutsData?.success && payoutsData.payouts) {
        // Sort payouts: by earnings (highest first) or by date (newest first)
        const sortedPayouts = [...payoutsData.payouts].sort((a, b) => {
          if (sortBy === 'earnings') {
            // Sort by creditsEarnedDollars (highest first)
            return (b.creditsEarnedDollars || 0) - (a.creditsEarnedDollars || 0);
          } else {
            // Sort by date (newest first)
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
          }
        });
        setPayouts(sortedPayouts);
        setPayoutsPaginationToken(payoutsData.nextToken || null);
      } else {
        setPayouts([]);
        setPayoutsPaginationToken(null);
      }
    } catch (err) {
      logger.error("Failed to load payouts:", err);
      setError("Failed to load payouts");
      setPayouts([]);
    } finally {
      setLoadingPayouts(false);
    }
  };

  useEffect(() => {
    if (user?.email && hasAdminAccess(user.email)) {
      loadPayouts(null, payoutStatusFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutStatusFilter]);

  const handlePayoutsNextPage = () => {
    if (payoutsPaginationToken) {
      loadPayouts(payoutsPaginationToken, payoutStatusFilter);
    }
  };

  const handlePayoutsPrevPage = () => {
    setPayoutsPaginationToken(null);
    loadPayouts(null, payoutStatusFilter);
  };

  const handleProcessPayout = async (payoutId: string) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      setError("Unauthorized: Admin access required");
      return;
    }

    setProcessingPayouts(prev => new Set(prev).add(payoutId));
    setError(null);
    setSuccess(null);

    try {
      logger.log("🔄 Processing payout:", payoutId);
      
      const result = await client.mutations.processPayoutLambda({
        payoutIds: [payoutId],
      });

      logger.log("📦 Raw result from processPayoutLambda:", result);

      // Parse the JSON response
      let resultData: any = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            resultData = JSON.parse(firstParse);
          } else {
            resultData = firstParse;
          }
        } catch (e) {
          logger.error("Failed to parse result.data as JSON:", e, "Raw data:", result.data);
          setError(`Failed to parse response: ${result.data}`);
          return;
        }
      } else {
        resultData = result.data as any;
      }

      // Check for errors in the result
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        logger.error("❌ GraphQL errors:", result.errors);
        setError(`GraphQL Error: ${errorMessages}`);
        return;
      }

      if (resultData?.statusCode === 200) {
        const body = typeof resultData.body === 'string' ? JSON.parse(resultData.body) : resultData.body;
        if (body.success) {
          setSuccess(`Successfully processed payout: $${body.totalDollars?.toFixed(2) || '0.00'}`);
          // Reload payouts to reflect the updated status
          await loadPayouts(null, payoutStatusFilter);
        } else {
          setError(body.error || "Failed to process payout");
        }
      } else {
        const body = typeof resultData?.body === 'string' ? JSON.parse(resultData.body) : resultData?.body;
        setError(body?.error || "Failed to process payout");
      }
    } catch (err) {
      logger.error("❌ Error processing payout:", err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to process payout: ${errorMessage}`);
    } finally {
      setProcessingPayouts(prev => {
        const newSet = new Set(prev);
        newSet.delete(payoutId);
        return newSet;
      });
    }
  };

  const handleProcessMultiplePayouts = async (payoutIds: string[]) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      setError("Unauthorized: Admin access required");
      return;
    }

    if (payoutIds.length === 0) {
      setError("No payouts selected");
      return;
    }

    // Add all IDs to processing set
    setProcessingPayouts(prev => {
      const newSet = new Set(prev);
      payoutIds.forEach(id => newSet.add(id));
      return newSet;
    });
    setError(null);
    setSuccess(null);

    try {
      logger.log("🔄 Processing multiple payouts:", payoutIds);
      
      const result = await client.mutations.processPayoutLambda({
        payoutIds,
      });

      logger.log("📦 Raw result from processPayoutLambda:", result);

      // Parse the JSON response
      let resultData: any = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            resultData = JSON.parse(firstParse);
          } else {
            resultData = firstParse;
          }
        } catch (e) {
          logger.error("Failed to parse result.data as JSON:", e, "Raw data:", result.data);
          setError(`Failed to parse response: ${result.data}`);
          return;
        }
      } else {
        resultData = result.data as any;
      }

      // Check for errors in the result
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        logger.error("❌ GraphQL errors:", result.errors);
        setError(`GraphQL Error: ${errorMessages}`);
        return;
      }

      if (resultData?.statusCode === 200) {
        const body = typeof resultData.body === 'string' ? JSON.parse(resultData.body) : resultData.body;
        if (body.success) {
          setSuccess(`Successfully processed ${body.processedCount || 0} payout(s): $${body.totalDollars?.toFixed(2) || '0.00'}`);
          // Reload payouts to reflect the updated status
          await loadPayouts(null, payoutStatusFilter);
        } else {
          setError(body.error || "Failed to process payouts");
        }
      } else {
        const body = typeof resultData?.body === 'string' ? JSON.parse(resultData.body) : resultData?.body;
        setError(body?.error || "Failed to process payouts");
      }
    } catch (err) {
      logger.error("❌ Error processing payouts:", err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to process payouts: ${errorMessage}`);
    } finally {
      // Remove all IDs from processing set
      setProcessingPayouts(prev => {
        const newSet = new Set(prev);
        payoutIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    }
  };

  const handleExportPayouts = () => {
    if (payouts.length === 0) {
      setError("No payouts to export");
      return;
    }

    try {
      // Create CSV header
      const headers = [
        'Date',
        'Partner Email',
        'Partner ID',
        'Robot Name',
        'Robot ID',
        'Earnings ($)',
        'Platform Fee ($)',
        'Total Charged ($)',
        'Status',
        'Type',
        'Payout Date',
        'Session ID',
        'Reservation ID',
        'Duration (seconds)',
        'Duration (minutes)',
      ];

      // Create CSV rows
      const rows = payouts.map(payout => [
        payout.createdAt ? new Date(payout.createdAt).toISOString() : '',
        payout.partnerEmail || '',
        payout.partnerId || '',
        payout.robotName || '',
        payout.robotId || '',
        (payout.creditsEarnedDollars || 0).toFixed(2),
        (payout.platformFeeDollars || 0).toFixed(2),
        (payout.totalCreditsChargedDollars || 0).toFixed(2),
        payout.status || '',
        payout.reservationId ? 'Reservation' : payout.sessionId ? 'Session' : '',
        payout.payoutDate ? new Date(payout.payoutDate).toISOString() : '',
        payout.sessionId || '',
        payout.reservationId || '',
        payout.durationSeconds || '',
        payout.durationMinutes || '',
      ]);

      // Escape CSV values (handle commas, quotes, newlines)
      const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      // Combine headers and rows
      const csvContent = [
        headers.map(escapeCsvValue).join(','),
        ...rows.map(row => row.map(escapeCsvValue).join(','))
      ].join('\n');

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      const timestamp = new Date().toISOString().split('T')[0];
      const statusLabel = payoutStatusFilter || 'all';
      link.setAttribute('href', url);
      link.setAttribute('download', `payouts_${statusLabel}_${timestamp}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setSuccess(`Exported ${payouts.length} payout(s) to CSV`);
    } catch (err) {
      logger.error("Error exporting payouts:", err);
      setError("Failed to export payouts");
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

  const loadLowCreditsWarningSetting = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoadingWarningSetting(true);
    try {
      const { data: settings } = await client.models.PlatformSettings.list({
        filter: { settingKey: { eq: 'lowCreditsWarningMinutes' } },
      });

      if (settings && settings.length > 0) {
        const warningValue = parseFloat(settings[0].settingValue || '1');
        setLowCreditsWarningMinutes(warningValue);
        setWarningSettingId(settings[0].id);
      } else {
        // Default to 1 minute if not set
        setLowCreditsWarningMinutes(1);
      }
    } catch (err) {
      logger.error("Error loading low credits warning setting:", err);
    } finally {
      setLoadingWarningSetting(false);
    }
  };

  const saveLowCreditsWarningSetting = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setSavingWarningSetting(true);
    setError(null);
    setSuccess(null);

    try {
      const warningValue = lowCreditsWarningMinutes.toString();
      const now = new Date().toISOString();

      if (warningSettingId) {
        // Update existing setting
        const { errors } = await client.models.PlatformSettings.update({
          id: warningSettingId,
          settingValue: warningValue,
          updatedBy: user.username || user.email || 'admin',
          updatedAt: now,
        });

        if (errors) {
          setError("Failed to update low credits warning setting");
        } else {
          setSuccess("Low credits warning setting updated successfully!");
          setTimeout(() => setSuccess(null), 3000);
        }
      } else {
        // Create new setting
        const { errors } = await client.models.PlatformSettings.create({
          settingKey: 'lowCreditsWarningMinutes',
          settingValue: warningValue,
          description: 'Number of minutes of credits remaining before showing low credits warning to users',
          updatedBy: user.username || user.email || 'admin',
          updatedAt: now,
        });

        if (errors) {
          setError("Failed to create low credits warning setting");
        } else {
          setSuccess("Low credits warning setting created successfully!");
          setTimeout(() => setSuccess(null), 3000);
          loadLowCreditsWarningSetting(); // Reload to get the ID
        }
      }
    } catch (err) {
      logger.error("Error saving low credits warning setting:", err);
      setError("An error occurred while saving low credits warning setting");
    } finally {
      setSavingWarningSetting(false);
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

  // Helper function to generate tierId from basePrice
  const generateTierId = (basePrice: number): string => {
    // If price is a whole number, return it as string (e.g., 20 -> "20")
    // Otherwise, return the price with 2 decimal places (e.g., 19.99 -> "19.99")
    if (basePrice % 1 === 0) {
      return basePrice.toString();
    }
    return basePrice.toFixed(2);
  };

  const initializeDefaultTiers = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    try {
      const now = new Date().toISOString();
      const defaultTiers = [
        {
          tierId: generateTierId(20.00),
          name: 'Starter Pack',
          basePrice: 20.00,
          baseCredits: 2000,
          bonusCredits: 0,
          isActive: true,
          displayOrder: 1,
          description: 'Perfect for getting started',
        },
        {
          tierId: generateTierId(50.00),
          name: 'Pro Pack',
          basePrice: 50.00,
          baseCredits: 5000,
          bonusCredits: 500,
          isActive: true,
          displayOrder: 2,
          description: 'Great value with bonus credits',
        },
        {
          tierId: generateTierId(100.00),
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
    logger.debug('[saveCreditTier] Called with tier:', tier);
    logger.debug('[saveCreditTier] User:', user?.email);
    logger.debug('[saveCreditTier] Has admin access:', user?.email ? hasAdminAccess(user.email) : false);
    
    if (!user?.email || !hasAdminAccess(user.email)) {
      const errorMsg = "Unauthorized: Admin access required. Only @modulr.cloud email addresses can manage credit tiers.";
      logger.debug('[saveCreditTier] Setting error:', errorMsg);
      setError(errorMsg);
      setTimeout(() => setError(null), 5000);
      return;
    }

    // Enforce 3-tier limit when creating new tier
    if (!tier.id && creditTiers.length >= 3) {
      setError("Maximum of 3 credit tiers allowed. Please delete an existing tier before adding a new one.");
      setTimeout(() => setError(null), 5000);
      return;
    }

    setSavingMarkup(true);
    setError(null);
    setSuccess(null);

    try {
      logger.debug('[saveCreditTier] Starting save process...');
      const now = new Date().toISOString();
      // Auto-generate tierId from basePrice (use existing tierId if updating)
      const tierId = tier.id ? tier.tierId : generateTierId(tier.basePrice);
      logger.debug('[saveCreditTier] Generated tierId:', tierId);
      
      const tierData = {
        tierId: tierId,
        name: tier.name,
        basePrice: tier.basePrice,
        baseCredits: tier.baseCredits,
        bonusCredits: tier.bonusCredits || 0,
        isActive: tier.isActive !== false,
        description: tier.description,
        displayOrder: tier.displayOrder || 0,
        updatedAt: now,
      };
      logger.debug('[saveCreditTier] Tier data to save:', tierData);

      if (tier.id) {
        // Update existing tier
        logger.debug('[saveCreditTier] Calling update mutation...');
        const result = await client.mutations.manageCreditTierLambda({
          action: 'update',
          tierId: tier.id,
          tierData: JSON.stringify(tierData),
        });
        logger.debug('[saveCreditTier] Update result:', result);

        if (result.errors && result.errors.length > 0) {
          logger.error('[saveCreditTier] GraphQL errors:', result.errors);
          const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
          setError(`Failed to update credit tier: ${errorMessages}`);
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }

        if (!result.data) {
          logger.error('[saveCreditTier] No data returned from mutation');
          setError('Failed to update credit tier: No data returned');
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }

        logger.debug('[saveCreditTier] Parsing result data...');
        logger.debug('[saveCreditTier] result.data type:', typeof result.data);
        logger.debug('[saveCreditTier] result.data:', result.data);
        
        // GraphQL may double-encode JSON strings, so we need to parse twice if needed
        let resultData: any;
        if (typeof result.data === 'string') {
          try {
            // First parse - might be a JSON string
            const firstParse = JSON.parse(result.data);
            // If the first parse is still a string, parse again
            if (typeof firstParse === 'string') {
              resultData = JSON.parse(firstParse);
            } else {
              resultData = firstParse;
            }
          } catch (e) {
            logger.error('[saveCreditTier] Error parsing result.data:', e);
            throw new Error('Failed to parse result data');
          }
        } else {
          resultData = result.data;
        }
        
        logger.debug('[saveCreditTier] Parsed result data:', resultData);
        logger.debug('[saveCreditTier] resultData.success:', resultData.success);
        logger.debug('[saveCreditTier] resultData.success type:', typeof resultData.success);
        
        if (resultData.success === true || resultData.success === 'true') {
          logger.debug('[saveCreditTier] Update successful! Clearing edit state and reloading...');
          // Clear editing state immediately so edit dialog disappears
          setEditingTier(null);
          setSuccess("Credit tier updated successfully!");
          setTimeout(() => setSuccess(null), 3000);
          // Reload tiers immediately
          await loadCreditTiers();
          logger.debug('[saveCreditTier] Tiers reloaded, setting saving to false');
          setSavingMarkup(false);
        } else {
          logger.error('[saveCreditTier] Update failed. resultData:', resultData);
          logger.error('[saveCreditTier] resultData.success:', resultData.success);
          logger.error('[saveCreditTier] resultData.message:', resultData.message);
          setError(`Failed to update credit tier: ${resultData.message || 'Unknown error'}`);
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
        }
      } else {
        // Create new tier - check limit again before creating
        if (creditTiers.length >= 3) {
          setError("Maximum of 3 credit tiers allowed. Please delete an existing tier before adding a new one.");
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }

        logger.debug('[saveCreditTier] Creating tier in database...');
        const result = await client.mutations.manageCreditTierLambda({
          action: 'create',
          tierData: JSON.stringify({
            ...tierData,
            createdAt: now,
          }),
        });
        logger.debug('[saveCreditTier] Create result:', result);

        if (result.errors && result.errors.length > 0) {
          logger.error('[saveCreditTier] GraphQL errors:', result.errors);
          const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
          setError(`Failed to create credit tier: ${errorMessages}`);
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }

        if (!result.data) {
          logger.error('[saveCreditTier] No data returned from mutation');
          setError('Failed to create credit tier: No data returned');
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }

        logger.debug('[saveCreditTier] Parsing result data...');
        logger.debug('[saveCreditTier] result.data type:', typeof result.data);
        logger.debug('[saveCreditTier] result.data:', result.data);
        
        // GraphQL may double-encode JSON strings, so we need to parse twice if needed
        let resultData: any;
        if (typeof result.data === 'string') {
          try {
            // First parse - might be a JSON string
            const firstParse = JSON.parse(result.data);
            // If the first parse is still a string, parse again
            if (typeof firstParse === 'string') {
              resultData = JSON.parse(firstParse);
            } else {
              resultData = firstParse;
            }
          } catch (e) {
            logger.error('[saveCreditTier] Error parsing result.data:', e);
            throw new Error('Failed to parse result data');
          }
        } else {
          resultData = result.data;
        }
        
        logger.debug('[saveCreditTier] Parsed result data:', resultData);
        logger.debug('[saveCreditTier] resultData.success:', resultData.success);
        
        if (resultData.success === true || resultData.success === 'true') {
          logger.debug('[saveCreditTier] Create successful! Clearing form and reloading...');
          // Clear form immediately so user sees it disappear
          setNewTier(null);
          setSuccess("Credit tier created successfully!");
          setTimeout(() => setSuccess(null), 3000);
          // Reload tiers immediately to show the new tier in the list
          await loadCreditTiers();
          logger.debug('[saveCreditTier] Tiers reloaded, setting saving to false');
          setSavingMarkup(false);
        } else {
          logger.error('[saveCreditTier] Create failed:', resultData.message);
          setError(`Failed to create credit tier: ${resultData.message || 'Unknown error'}`);
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
        }
      }
    } catch (err) {
      logger.error("Error saving credit tier:", err);
      setError(`An error occurred while saving credit tier: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setTimeout(() => setError(null), 5000);
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

      const result = await client.mutations.manageCreditTierLambda({
        action: 'delete',
        tierId: tierId,
      });

      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        setError(`Failed to delete credit tier: ${errorMessages}`);
        setTimeout(() => setError(null), 5000);
        return;
      }

      if (!result.data) {
        setError('Failed to delete credit tier: No data returned');
        setTimeout(() => setError(null), 5000);
        setSavingMarkup(false);
        return;
      }

      // GraphQL may double-encode JSON strings, so we need to parse twice if needed
      let resultData: any;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          resultData = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
        } catch (e) {
          logger.error("Error parsing delete result:", e);
          setError('Failed to parse delete result');
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }
      } else {
        resultData = result.data;
      }
      
      if (resultData.success === true || resultData.success === 'true') {
        setSuccess("Credit tier deleted successfully!");
        setTimeout(() => setSuccess(null), 3000);
        await loadCreditTiers();
        setSavingMarkup(false);
      } else {
        setError(`Failed to delete credit tier: ${resultData.message || 'Unknown error'}`);
        setTimeout(() => setError(null), 5000);
        setSavingMarkup(false);
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
                    <FontAwesomeIcon icon={faRobot} style={{ color: '#ffc107' }} />
                  </div>
                  <div className="stat-content">
                    <div className="stat-value">
                      {loadingActiveRobots ? '...' : (activeRobots?.activeRobots ?? 'N/A')}
                    </div>
                    <div className="stat-label">Active Robots</div>
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
                      {auditLogs.map((log, index) => {
                        // Format action with details for ADJUST_CREDITS
                        let actionDisplay = log.action || 'N/A';
                        if (log.action === 'ADJUST_CREDITS' && log.metadata) {
                          const creditsAmount = log.metadata.creditsAmount;
                          if (creditsAmount !== undefined) {
                            const action = creditsAmount > 0 ? 'Added' : 'Reduced';
                            actionDisplay = `${action} ${Math.abs(creditsAmount).toLocaleString()} credits`;
                          }
                        } else if (log.action === 'DELETE_ROBOT' && log.metadata) {
                          const robotName = log.metadata.robotName || 'Unknown Robot';
                          actionDisplay = `Deleted robot "${robotName}"`;
                        } else if (log.action === 'CHANGE_USER_CLASSIFICATION' && log.metadata) {
                          const oldClass = log.metadata.oldClassification || 'Unknown';
                          const newClass = log.metadata.newClassification || 'Unknown';
                          actionDisplay = `Changed classification: ${oldClass} → ${newClass}`;
                        }
                        
                        return (
                          <tr key={index}>
                            <td>{log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}</td>
                            <td>
                              <span className="action-badge">{actionDisplay}</span>
                              {log.metadata && (
                                <div className="action-metadata">
                                  {log.metadata.robotName && log.metadata.robotModel && (
                                    <span>Model: {log.metadata.robotModel}</span>
                                  )}
                                  {log.metadata.oldBalance !== undefined && log.metadata.newBalance !== undefined && (
                                    <span>Balance: {log.metadata.oldBalance} &rarr; {log.metadata.newBalance}</span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td>{log.adminEmail || log.adminUserId || 'N/A'}</td>
                            <td>{log.targetEmail || log.targetUserId || 'N/A'}</td>
                            <td>{log.reason || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {auditLogs.length > 0 && (
                  <div className="pagination-controls">
                    <button
                      className="admin-button admin-button-secondary"
                      onClick={handleAuditLogsPrevPage}
                      disabled={loadingAuditLogs}
                      title="Reload from beginning"
                    >
                      <FontAwesomeIcon icon={faChevronLeft} />
                      <span>Previous</span>
                    </button>
                    <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>
                      Showing {auditLogs.length} record{auditLogs.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      className="admin-button admin-button-secondary"
                      onClick={handleAuditLogsNextPage}
                      disabled={!auditLogsPaginationToken || loadingAuditLogs}
                    >
                      <span>Next</span>
                      <FontAwesomeIcon icon={faChevronRight} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Connection Cleanup Section */}
        <div className="admin-section">
          <div className="section-header">
            <FontAwesomeIcon icon={faBroom} className="section-icon" />
            <h2>Connection Cleanup</h2>
          </div>
          <div className="section-content">
            <p className="section-description">
              Manually trigger cleanup of stale WebSocket connections. The cleanup job automatically runs every hour,
              but you can trigger it manually if needed. This removes dead connections and updates robot online status.
            </p>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
              <button
                className="admin-button admin-button-primary"
                onClick={handleTriggerCleanup}
                disabled={triggeringCleanup}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <FontAwesomeIcon icon={triggeringCleanup ? faSync : faBroom} spin={triggeringCleanup} />
                {triggeringCleanup ? 'Running Cleanup...' : 'Trigger Cleanup Now'}
              </button>
              {activeRobots && (
                <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem' }}>
                  <strong>Active:</strong> {activeRobots.activeRobots || 0} robots, {activeRobots.totalConnections || 0} total connections
                  {activeRobots.clientConnections > 0 && ` (${activeRobots.clientConnections} clients, ${activeRobots.monitorConnections || 0} monitors)`}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Payout Management Section */}
        <div className="admin-section">
          <div className="section-header">
            <FontAwesomeIcon icon={faDollarSign} className="section-icon" />
            <h2>Payout Management</h2>
          </div>
          <div className="section-content">
            <p className="section-description">
              View and manage partner payouts. Process payouts when they reach $100 (10,000 credits) or more. Click "Mark as Paid" to process individual payouts.
            </p>
            
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {payouts.filter(p => p.status === 'pending').length > 0 && (
                <button
                  className="admin-button admin-button-primary"
                  onClick={() => {
                    const pendingIds = payouts.filter(p => p.status === 'pending').map(p => p.id);
                    if (pendingIds.length > 0) {
                      handleProcessMultiplePayouts(pendingIds);
                    }
                  }}
                  disabled={processingPayouts.size > 0}
                >
                  {processingPayouts.size > 0 
                    ? `Processing ${processingPayouts.size} payout(s)...` 
                    : `Process All Pending (${payouts.filter(p => p.status === 'pending').length})`}
                </button>
              )}
              
              <button
                className="admin-button admin-button-secondary"
                onClick={handleExportPayouts}
                disabled={payouts.length === 0 || loadingPayouts}
                style={{ marginLeft: 'auto' }}
              >
                <FontAwesomeIcon icon={faChartLine} style={{ marginRight: '0.5rem' }} />
                Export CSV
              </button>
            </div>
            
            <div className="payout-filters" style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                Filter by Status:
              </label>
              <select
                value={payoutStatusFilter}
                onChange={(e) => {
                  setPayoutStatusFilter(e.target.value);
                  setPayoutsPaginationToken(null);
                }}
              >
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
                <option value="">All</option>
              </select>
              
              <label style={{ color: 'rgba(255, 255, 255, 0.7)', marginLeft: '1rem' }}>
                Sort by:
              </label>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as 'earnings' | 'date');
                  // Re-sort existing payouts
                  const sorted = [...payouts].sort((a, b) => {
                    if (e.target.value === 'earnings') {
                      return (b.creditsEarnedDollars || 0) - (a.creditsEarnedDollars || 0);
                    } else {
                      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                      return dateB - dateA;
                    }
                  });
                  setPayouts(sorted);
                }}
              >
                <option value="earnings">Highest Earnings First</option>
                <option value="date">Newest First</option>
              </select>
            </div>
            
            {loadingPayouts ? (
              <div className="loading-state">
                <p>Loading payouts...</p>
              </div>
            ) : (
              <div className="payouts-list">
                {payouts.length === 0 ? (
                  <div className="empty-state">
                    <FontAwesomeIcon icon={faInfoCircle} />
                    <p>No payouts found.</p>
                  </div>
                ) : (
                  <>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Partner</th>
                          <th>Robot</th>
                          <th>Earnings</th>
                          <th>Platform Fee</th>
                          <th>Total Charged</th>
                          <th>Status</th>
                          <th>Type</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payouts.map((payout, index) => (
                          <tr key={payout.id || index}>
                            <td>{payout.createdAt ? new Date(payout.createdAt).toLocaleDateString() : 'N/A'}</td>
                            <td>{payout.partnerEmail || payout.partnerId || 'N/A'}</td>
                            <td>{payout.robotName || payout.robotId || 'N/A'}</td>
                            <td>${payout.creditsEarnedDollars?.toFixed(2) || '0.00'}</td>
                            <td>${payout.platformFeeDollars?.toFixed(2) || '0.00'}</td>
                            <td>${payout.totalCreditsChargedDollars?.toFixed(2) || '0.00'}</td>
                            <td>
                              <span className={`status-badge ${payout.status || 'pending'}`}>
                                {payout.status || 'pending'}
                              </span>
                            </td>
                            <td>{payout.reservationId ? 'Reservation' : payout.sessionId ? 'Session' : 'N/A'}</td>
                            <td>
                              {payout.status === 'pending' && (
                                <button
                                  className="admin-button admin-button-primary"
                                  onClick={() => handleProcessPayout(payout.id)}
                                  disabled={processingPayouts.has(payout.id)}
                                  style={{ 
                                    padding: '0.25rem 0.5rem',
                                    fontSize: '0.875rem',
                                  }}
                                >
                                  {processingPayouts.has(payout.id) ? 'Processing...' : 'Mark as Paid'}
                                </button>
                              )}
                              {payout.status === 'paid' && (
                                <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.875rem' }}>
                                  Processed
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {payouts.length > 0 && (
                      <div className="pagination-controls">
                        <button
                          className="admin-button admin-button-secondary"
                          onClick={handlePayoutsPrevPage}
                          disabled={loadingPayouts || !payoutsPaginationToken}
                          title="Previous page"
                        >
                          <FontAwesomeIcon icon={faChevronLeft} />
                          Previous
                        </button>
                        <button
                          className="admin-button admin-button-secondary"
                          onClick={handlePayoutsNextPage}
                          disabled={loadingPayouts || !payoutsPaginationToken}
                          title="Next page"
                        >
                          Next
                          <FontAwesomeIcon icon={faChevronRight} />
                        </button>
                      </div>
                    )}
                  </>
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

            {/* Low Credits Warning Setting */}
            <div className="platform-setting-card">
              <h3>Low Credits Warning Threshold</h3>
              <p className="setting-description">
                Number of minutes of credits remaining before users see a warning notification. This helps users know when they need to top up their account.
              </p>
              <div className="setting-input-group">
                <label className="markup-input-label">
                  Warning Threshold (minutes):
                  <div className="markup-input-wrapper">
                    <div className="duration-input-wrapper">
                      <input
                        type="number"
                        min="0.5"
                        max="60"
                        step="0.5"
                        value={lowCreditsWarningMinutes}
                        onChange={(e) => setLowCreditsWarningMinutes(parseFloat(e.target.value) || 1)}
                        disabled={loadingWarningSetting || savingWarningSetting}
                        className="markup-input"
                      />
                      <div className="spinner-buttons">
                        <button
                          type="button"
                          className="spinner-btn spinner-up"
                          onClick={() => setLowCreditsWarningMinutes(Math.min(60, lowCreditsWarningMinutes + 0.5))}
                          disabled={loadingWarningSetting || savingWarningSetting || lowCreditsWarningMinutes >= 60}
                          aria-label="Increase threshold"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="spinner-btn spinner-down"
                          onClick={() => setLowCreditsWarningMinutes(Math.max(0.5, lowCreditsWarningMinutes - 0.5))}
                          disabled={loadingWarningSetting || savingWarningSetting || lowCreditsWarningMinutes <= 0.5}
                          aria-label="Decrease threshold"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                    <span className="input-suffix">min</span>
                  </div>
                </label>
                <button
                  className="admin-button"
                  onClick={saveLowCreditsWarningSetting}
                  disabled={loadingWarningSetting || savingWarningSetting}
                >
                  {savingWarningSetting ? (
                    <>
                      <FontAwesomeIcon icon={faCog} spin />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <FontAwesomeIcon icon={faSave} />
                      <span>Save Warning Threshold</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Credit Tiers Management */}
            <div className="platform-setting-card">
              <div className="setting-header-row">
                <div>
                  <h3>Credit Tiers</h3>
                  <span style={{ 
                    fontSize: '0.85rem', 
                    color: creditTiers.length >= 3 ? 'rgba(255, 183, 0, 0.9)' : 'rgba(255, 255, 255, 0.6)',
                    fontWeight: creditTiers.length >= 3 ? 600 : 400
                  }}>
                    {creditTiers.length} / 3 tiers
                  </span>
                </div>
                <button
                  className="admin-button"
                  onClick={() => {
                    // Enforce 3-tier limit
                    if (creditTiers.length >= 3) {
                      setError("Maximum of 3 credit tiers allowed. Please delete an existing tier before adding a new one.");
                      setTimeout(() => setError(null), 5000);
                      return;
                    }
                    setNewTier({
                      name: '',
                      basePrice: 0,
                      baseCredits: 0,
                      bonusCredits: 0,
                      isActive: true,
                      displayOrder: creditTiers.length + 1,
                    });
                  }}
                  disabled={creditTiers.length >= 3}
                  title={creditTiers.length >= 3 ? "Maximum of 3 tiers allowed" : "Add new credit tier"}
                >
                  <FontAwesomeIcon icon={faPlus} />
                  <span>Add New Tier</span>
                </button>
              </div>
              <p className="setting-description">
                Manage credit purchase tiers. Users can buy credits in these predefined packages with optional bonus credits.
                <strong style={{ display: 'block', marginTop: '0.5rem', color: 'rgba(255, 183, 0, 0.9)' }}>
                  Maximum of 3 tiers allowed. These will be displayed in a 3-wide grid in the purchase modal.
                </strong>
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
                              onChange={(e) => {
                                const price = parseFloat(e.target.value) || 0;
                                setNewTier({ ...newTier, basePrice: price });
                              }}
                            />
                            <small style={{ display: 'block', marginTop: '0.25rem', color: 'rgba(255, 255, 255, 0.6)' }}>
                              Tier ID will be auto-generated from price: {newTier.basePrice > 0 ? generateTierId(newTier.basePrice) : '—'}
                            </small>
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
                            onClick={async () => {
                              logger.debug('[Button Click] Create Tier clicked');
                              logger.debug('[Button Click] newTier:', newTier);
                              try {
                                await saveCreditTier(newTier);
                              } catch (err) {
                                logger.error('[Button Click] Error in saveCreditTier:', err);
                                setError(`Unexpected error: ${err instanceof Error ? err.message : 'Unknown error'}`);
                                setTimeout(() => setError(null), 5000);
                              }
                            }}
                            disabled={savingMarkup || !newTier.basePrice || newTier.basePrice <= 0 || !newTier.name}
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
                                  Tier ID: <strong style={{ color: 'rgba(255, 183, 0, 0.9)' }}>{tier.tierId}</strong>
                                  <small style={{ display: 'block', marginTop: '0.25rem', color: 'rgba(255, 255, 255, 0.6)' }}>
                                    (Auto-generated from price, cannot be changed)
                                  </small>
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
                    {users.length > 0 && (
                      <div className="pagination-controls">
                        <button
                          className="admin-button admin-button-secondary"
                          onClick={handlePrevPage}
                          disabled={loadingUsers}
                          title="Reload from beginning"
                        >
                          <FontAwesomeIcon icon={faChevronLeft} />
                          <span>Previous</span>
                        </button>
                        <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>
                          Showing {users.length} user{users.length !== 1 ? 's' : ''}
                        </span>
                        <button
                          className="admin-button admin-button-secondary"
                          onClick={handleNextPage}
                          disabled={!paginationToken || loadingUsers}
                        >
                          <span>Next</span>
                          <FontAwesomeIcon icon={faChevronRight} />
                        </button>
                      </div>
                    )}
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

              {/* Credit Adjustment (Admin Only) */}
              {user?.email && hasAdminAccess(user.email) && (
                <div className="user-detail-section">
                  <h3>Adjust Credits</h3>
                  <div className="form-row">
                    <div className="input-group">
                      <label htmlFor="creditAdjustment">Amount (positive to add, negative to remove)</label>
                      <input
                        id="creditAdjustment"
                        type="text"
                        inputMode="numeric"
                        value={creditAdjustment}
                        onChange={(e) => handleCreditAdjustmentChange(e.target.value)}
                        placeholder="e.g., 1000 or -500"
                        disabled={adjustingCredits}
                        pattern="^-?\d+$"
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor="creditDescription">Reason (optional)</label>
                      <input
                        id="creditDescription"
                        type="text"
                        value={creditDescription}
                        onChange={(e) => setCreditDescription(e.target.value)}
                        placeholder="e.g., 'Bonus for testing', 'Refund for issue'"
                        disabled={adjustingCredits}
                      />
                    </div>
                  </div>
                  <div className="credit-adjustment-buttons">
                    <button
                      className="admin-button admin-button-primary"
                      onClick={() => {
                        const sanitizedValue = creditAdjustment.trim();
                        if (!sanitizedValue) {
                          setError("Please enter an amount");
                          return;
                        }
                        
                        const creditsValue = parseInt(sanitizedValue);
                        if (isNaN(creditsValue) || creditsValue === 0) {
                          setError("Please enter a valid non-zero number");
                          return;
                        }
                        
                        handleAdjustCredits(selectedUser.username, creditsValue);
                      }}
                      disabled={!creditAdjustment.trim() || adjustingCredits}
                    >
                      <FontAwesomeIcon icon={faEdit} />
                      <span>Update Credits</span>
                    </button>
                    <button
                      className="admin-button admin-button-secondary"
                      onClick={() => {
                        setCreditAdjustment('');
                        setCreditDescription('');
                      }}
                      disabled={adjustingCredits}
                    >
                      Clear
                    </button>
                  </div>
                  {error && selectedUser && (
                    <div className="credit-adjustment-error" style={{ marginTop: '0.5rem', color: '#f44336', fontSize: '0.85rem' }}>
                      <FontAwesomeIcon icon={faExclamationTriangle} /> {error}
                    </div>
                  )}
                  {success && selectedUser && (
                    <div className="credit-adjustment-success" style={{ marginTop: '0.5rem', color: '#4caf50', fontSize: '0.85rem' }}>
                      <FontAwesomeIcon icon={faCheckCircle} /> {success}
                    </div>
                  )}
                </div>
              )}

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
                      title="Remove user"
                    >
                      <FontAwesomeIcon icon={faTrash} />
                      <span>Remove User</span>
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

      {/* Toast Notification */}
      {toast.visible && (
        <div className={`toast-notification ${toast.type}`}>
          <FontAwesomeIcon icon={toast.type === 'error' ? faExclamationTriangle : faCheckCircle} />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};

