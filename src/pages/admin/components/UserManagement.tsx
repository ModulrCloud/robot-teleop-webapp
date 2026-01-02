import { useState, useEffect } from "react";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { hasAdminAccess } from "../../../utils/admin";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUsers,
  faCoins,
  faCheckCircle,
  faExclamationTriangle,
  faInfoCircle,
  faTimes,
  faEye,
  faChevronLeft,
  faChevronRight,
  faEdit,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { logger } from "../../../utils/logger";
import "../../Admin.css";
import type {
  User,
  UserRobot,
  CreditTransaction,
  UsersResponse,
  CreditAdjustmentResponse,
  GraphQLError,
  LambdaResponse,
} from "../types";

const client = generateClient<Schema>();

export const UserManagement = () => {
  const { user } = useAuthStatus();
  
  // Users state
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [paginationToken, setPaginationToken] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showUserDetail, setShowUserDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success'; visible: boolean }>({ 
    message: '', 
    type: 'error', 
    visible: false 
  });
  
  // User detail data
  const [userRobots, setUserRobots] = useState<UserRobot[]>([]);
  const [userTransactions, setUserTransactions] = useState<CreditTransaction[]>([]);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);
  
  // Credit adjustment
  const [creditAdjustment, setCreditAdjustment] = useState<string>('');
  const [creditDescription, setCreditDescription] = useState<string>('');
  const [adjustingCredits, setAdjustingCredits] = useState(false);

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
      let usersData: UsersResponse | null = null;
      
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

  useEffect(() => {
    if (user?.email && hasAdminAccess(user.email)) {
      loadUsers().catch(err => {
        logger.error("Failed to load users on mount:", err);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const handleViewUser = async (user: User) => {
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
        const errorMessages = result.errors.map((e) => (e as unknown as GraphQLError).message || JSON.stringify(e)).join(', ');
        logger.error("❌ GraphQL errors:", result.errors);
        setError(`GraphQL Error: ${errorMessages}`);
        return;
      }

      let resultData: CreditAdjustmentResponse | null = null;
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
        resultData = result.data as CreditAdjustmentResponse | null;
      }

      logger.log("✅ Parsed result data:", resultData);

      if (resultData && 'success' in resultData && resultData.success) {
        const action = credits > 0 ? 'added' : 'deducted';
        setSuccess(`Successfully ${action} ${Math.abs(credits).toLocaleString()} credits. New balance: ${resultData.newBalance?.toLocaleString() || 'N/A'}`);
        
        // Update selected user's credit balance in the UI
        if (selectedUser) {
          setSelectedUser({
            ...selectedUser,
            credits: resultData.newBalance,
          });
        }

        // Also update the user in the users array to keep table and modal in sync
        setUsers(prevUsers => {
          const updatedUsers = prevUsers.map(u => {
            // Match by username (userId is the username)
            if (u.username === userId) {
              logger.log("🔄 Updating user in table:", {
                username: u.username,
                oldCredits: u.credits,
                newCredits: resultData.newBalance
              });
              return { ...u, credits: resultData.newBalance };
            }
            return u;
          });
          
          // Verify the update worked
          const updatedUser = updatedUsers.find(u => u.username === userId);
          if (updatedUser) {
            logger.log("✅ User credits updated in table:", {
              username: updatedUser.username,
              credits: updatedUser.credits
            });
          } else {
            logger.warn("⚠️ Could not find user in array to update:", userId);
          }
          
          return updatedUsers;
        });

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
        
        // Trigger audit log refresh
        window.dispatchEvent(new CustomEvent('refreshAuditLogs'));

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
      let responseData: LambdaResponse<{ success?: boolean; error?: string; message?: string; details?: string }> | null = null;
      if (response.data) {
        if (typeof response.data === 'string') {
          try {
            responseData = JSON.parse(response.data);
          } catch (e) {
            responseData = { body: response.data } as LambdaResponse<{ success?: boolean; error?: string; message?: string; details?: string }>;
          }
        } else {
          responseData = response.data as LambdaResponse<{ success?: boolean; error?: string; message?: string; details?: string }>;
        }
      }

      // Check if the Lambda returned an error
      if (responseData?.statusCode && responseData.statusCode !== 200) {
        let errorMessage = "Failed to change user classification";
        if (responseData.body) {
          try {
            const bodyData = typeof responseData.body === 'string' ? JSON.parse(responseData.body) : responseData.body;
            if (typeof bodyData === 'object' && bodyData !== null) {
              errorMessage = (bodyData as { error?: string; message?: string }).error || (bodyData as { error?: string; message?: string }).message || errorMessage;
              // Include details if available
              if ('details' in bodyData && typeof (bodyData as { details?: string }).details === 'string') {
                errorMessage += `: ${(bodyData as { details: string }).details}`;
              }
            } else if (typeof responseData.body === 'string') {
              errorMessage = responseData.body;
            }
          } catch (e) {
            if (typeof responseData.body === 'string') {
              errorMessage = responseData.body;
            }
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
        // Type assertion: Robot model has compatible fields with UserRobot
        setUserRobots((robots.data || []) as UserRobot[]);
      } else {
        setUserRobots([]);
      }

      // Get user's transactions
      const transactions = await client.models.CreditTransaction.list({
        filter: { userId: { eq: username } },
      });
      // Filter out null values and type assert (GraphQL can return [null] for empty results)
      setUserTransactions((transactions.data || []).filter(t => t !== null) as CreditTransaction[]);
    } catch (err) {
      logger.error("Error loading user detail data:", err);
    } finally {
      setLoadingUserDetail(false);
    }
  };

  return (
    <>
      <div className="admin-section">
        <div className="section-header">
          <FontAwesomeIcon icon={faUsers} className="section-icon" />
          <h2>Users</h2>
        </div>
        <div className="section-content">
          {error && !showUserDetail && (
            <div className="error-message" style={{ marginBottom: '1rem' }}>
              <FontAwesomeIcon icon={faInfoCircle} style={{ marginRight: '0.5rem' }} />
              {error}
            </div>
          )}
          {success && !showUserDetail && (
            <div className="success-message" style={{ marginBottom: '1rem' }}>
              <FontAwesomeIcon icon={faInfoCircle} style={{ marginRight: '0.5rem' }} />
              {success}
            </div>
          )}
          
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
    </>
  );
};

