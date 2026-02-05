import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSlidersH,
  faSave,
  faCog,
  faPlus,
  faEdit,
  faTrash,
  faBan,
  faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { hasAdminAccess } from "../../../utils/admin";
import { logger } from "../../../utils/logger";
import "../../Admin.css";
import type {
  CreditTier,
  CreditTierResponse,
  LambdaResponse,
  GraphQLError,
} from "../types";

const client = generateClient<Schema>();

export const PlatformSettings = () => {
  const { user } = useAuthStatus();
  
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
  const [creditTiers, setCreditTiers] = useState<CreditTier[]>([]);
  const [loadingTiers, setLoadingTiers] = useState(false);
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [newTier, setNewTier] = useState<Partial<CreditTier> & { name?: string; basePrice?: number; baseCredits?: number } | null>(null);
  
  // Local error/success state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Helper function to generate tierId from basePrice
  const generateTierId = (basePrice: number): string => {
    if (basePrice % 1 === 0) {
      return basePrice.toString();
    }
    return basePrice.toFixed(2);
  };

  const loadPlatformMarkup = async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
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
        setPlatformMarkup(30);
      }
    } catch (err) {
      logger.error("Error loading platform markup:", err);
    } finally {
      setLoadingMarkup(false);
    }
  };

  const savePlatformMarkup = async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
      return;
    }

    setSavingMarkup(true);
    setError(null);
    setSuccess(null);

    try {
      const markupValue = platformMarkup.toString();
      const now = new Date().toISOString();

      if (markupSettingId) {
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
          loadPlatformMarkup();
        }
      }
    } catch (err) {
      logger.error("Error saving platform markup:", err);
      setError("An error occurred while saving platform markup");
    } finally {
      setSavingMarkup(false);
    }
  };

  const loadLowCreditsWarningSetting = async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
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
        setLowCreditsWarningMinutes(1);
      }
    } catch (err) {
      logger.error("Error loading low credits warning setting:", err);
    } finally {
      setLoadingWarningSetting(false);
    }
  };

  const saveLowCreditsWarningSetting = async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
      return;
    }

    setSavingWarningSetting(true);
    setError(null);
    setSuccess(null);

    try {
      const warningValue = lowCreditsWarningMinutes.toString();
      const now = new Date().toISOString();

      if (warningSettingId) {
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
          loadLowCreditsWarningSetting();
        }
      }
    } catch (err) {
      logger.error("Error saving low credits warning setting:", err);
      setError("An error occurred while saving low credits warning setting");
    } finally {
      setSavingWarningSetting(false);
    }
  };

  const initializeDefaultTiers = async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
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

  const loadCreditTiers = async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
      return;
    }

    setLoadingTiers(true);
    try {
      const { data: tiers } = await client.models.CreditTier.list();
      
      if (tiers && tiers.length > 0) {
        const sortedTiers = [...tiers].sort((a, b) => {
          if (a.displayOrder !== null && b.displayOrder !== null) {
            return (a.displayOrder || 0) - (b.displayOrder || 0);
          }
          return (a.tierId || '').localeCompare(b.tierId || '');
        });
        setCreditTiers(sortedTiers as CreditTier[]);
      } else {
        await initializeDefaultTiers();
        const { data: reloadedTiers } = await client.models.CreditTier.list();
        if (reloadedTiers) {
          const sortedTiers = [...reloadedTiers].sort((a, b) => {
            if (a.displayOrder !== null && b.displayOrder !== null) {
              return (a.displayOrder || 0) - (b.displayOrder || 0);
            }
            return (a.tierId || '').localeCompare(b.tierId || '');
          });
          setCreditTiers(sortedTiers as CreditTier[]);
        }
      }
    } catch (err) {
      logger.error("Error loading credit tiers:", err);
    } finally {
      setLoadingTiers(false);
    }
  };

  const saveCreditTier = async (tier: Partial<CreditTier> & Pick<CreditTier, 'name' | 'basePrice' | 'baseCredits'>) => {
    logger.log("🔵 [FRONTEND] saveCreditTier function called");
    logger.log("🔵 [FRONTEND] Tier data:", JSON.stringify(tier, null, 2));
    logger.log("🔵 [FRONTEND] User email:", user?.email);
    logger.log("🔵 [FRONTEND] Has admin access:", hasAdminAccess(user?.email || '', user?.group ? [user.group] : undefined));
    
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
      logger.error("🔴 [FRONTEND] Unauthorized - no admin access");
      setError("Unauthorized: Admin access required. Only @modulr.cloud email addresses can manage credit tiers.");
      setTimeout(() => setError(null), 5000);
      return;
    }

    if (!tier.id && creditTiers.length >= 3) {
      setError("Maximum of 3 credit tiers allowed. Please delete an existing tier before adding a new one.");
      setTimeout(() => setError(null), 5000);
      return;
    }

    setSavingMarkup(true);
    setError(null);
    setSuccess(null);

    try {
      const now = new Date().toISOString();
      const tierId = tier.id ? tier.tierId : generateTierId(tier.basePrice);
      
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

      if (tier.id) {
        logger.log("🟡 [FRONTEND] Calling manageCreditTierLambda with UPDATE action");
        logger.log("🟡 [FRONTEND] tierId:", tier.id);
        logger.log("🟡 [FRONTEND] tierData (stringified):", JSON.stringify(tierData));
        
        const result = await client.mutations.manageCreditTierLambda({
          action: 'update',
          tierId: tier.id,
          tierData: JSON.stringify(tierData),
        });
        
        logger.log("🟢 [FRONTEND] manageCreditTierLambda response received");
        logger.log("🟢 [FRONTEND] Result:", JSON.stringify(result, null, 2));

        if (result.errors && result.errors.length > 0) {
          const errorMessages = result.errors.map((e) => (e as unknown as GraphQLError).message || JSON.stringify(e)).join(', ');
          setError(`Failed to update credit tier: ${errorMessages}`);
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }

        if (!result.data) {
          setError('Failed to update credit tier: No data returned');
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }

        let resultData: CreditTierResponse | LambdaResponse<CreditTierResponse>;
        if (typeof result.data === 'string') {
          try {
            const firstParse = JSON.parse(result.data);
            resultData = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
          } catch (e) {
            logger.error('[saveCreditTier] Error parsing result.data:', e);
            throw new Error('Failed to parse result data');
          }
        } else {
          resultData = result.data as CreditTierResponse | LambdaResponse<CreditTierResponse>;
        }
        
        // Type guard for success check
        const isSuccess = (data: CreditTierResponse | LambdaResponse<CreditTierResponse>): boolean => {
          if (typeof data === 'object' && data !== null) {
            if ('success' in data) {
              return data.success === true || data.success === 'true';
            }
            if ('body' in data && typeof data.body === 'object' && data.body !== null && 'success' in data.body) {
              const body = data.body as CreditTierResponse;
              return body.success === true || body.success === 'true';
            }
          }
          return false;
        };
        
        if (isSuccess(resultData)) {
          logger.log("✅ [FRONTEND] Tier update successful, dispatching refresh event");
          
          // Log debug info from Lambda if available
          if ('debug' in resultData && resultData.debug) {
            logger.log("🔍 [FRONTEND] Lambda debug info:", JSON.stringify(resultData.debug, null, 2));
            if (resultData.debug.auditLogCalled) {
              logger.log(`🔍 [FRONTEND] Audit log was called: ${resultData.debug.auditLogCreated ? '✅ Created' : '❌ Failed'}`);
              if (resultData.debug.auditLogError) {
                logger.error(`🔴 [FRONTEND] Audit log error: ${resultData.debug.auditLogError}`);
              }
            }
          }
          
          setEditingTier(null);
          setSuccess("Credit tier updated successfully!");
          setTimeout(() => setSuccess(null), 3000);
          await loadCreditTiers();
          // Dispatch event to trigger audit log refresh
          window.dispatchEvent(new CustomEvent('refreshAuditLogs'));
          setSavingMarkup(false);
        } else {
          setError(`Failed to update credit tier: ${resultData.message || 'Unknown error'}`);
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
        }
      } else {
        if (creditTiers.length >= 3) {
          setError("Maximum of 3 credit tiers allowed. Please delete an existing tier before adding a new one.");
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }

        const result = await client.mutations.manageCreditTierLambda({
          action: 'create',
          tierData: JSON.stringify({
            ...tierData,
            createdAt: now,
          }),
        });

        if (result.errors && result.errors.length > 0) {
          const errorMessages = result.errors.map((e) => (e as unknown as GraphQLError).message || JSON.stringify(e)).join(', ');
          setError(`Failed to create credit tier: ${errorMessages}`);
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }

        if (!result.data) {
          setError('Failed to create credit tier: No data returned');
          setTimeout(() => setError(null), 5000);
          setSavingMarkup(false);
          return;
        }

        let resultData: CreditTierResponse | LambdaResponse<CreditTierResponse>;
        if (typeof result.data === 'string') {
          try {
            const firstParse = JSON.parse(result.data);
            resultData = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
          } catch (e) {
            logger.error('[saveCreditTier] Error parsing result.data:', e);
            throw new Error('Failed to parse result data');
          }
        } else {
          resultData = result.data as CreditTierResponse | LambdaResponse<CreditTierResponse>;
        }
        
        // Type guard for success check
        const isSuccess = (data: CreditTierResponse | LambdaResponse<CreditTierResponse>): boolean => {
          if (typeof data === 'object' && data !== null) {
            if ('success' in data) {
              return data.success === true || data.success === 'true';
            }
            if ('body' in data && typeof data.body === 'object' && data.body !== null && 'success' in data.body) {
              const body = data.body as CreditTierResponse;
              return body.success === true || body.success === 'true';
            }
          }
          return false;
        };
        
        if (isSuccess(resultData)) {
          setNewTier(null);
          setSuccess("Credit tier created successfully!");
          setTimeout(() => setSuccess(null), 3000);
          await loadCreditTiers();
          setSavingMarkup(false);
        } else {
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
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
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
        const errorMessages = result.errors.map((e) => (e as unknown as GraphQLError).message || JSON.stringify(e)).join(', ');
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

      let resultData: CreditTierResponse | LambdaResponse<CreditTierResponse>;
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
        resultData = result.data as CreditTierResponse | LambdaResponse<CreditTierResponse>;
      }
      
      // Type guard to check if it's a successful response
      const isSuccess = (data: CreditTierResponse | LambdaResponse<CreditTierResponse>): data is CreditTierResponse => {
        return typeof data === 'object' && data !== null && ('success' in data && data.success === true);
      };
      
      if (isSuccess(resultData)) {
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
      setTimeout(() => setError(null), 5000);
    } finally {
      setSavingMarkup(false);
    }
  };

  useEffect(() => {
    if (user?.email && hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
      loadPlatformMarkup();
      loadLowCreditsWarningSetting();
      loadCreditTiers();
    }
  }, [user?.email]);

  // Listen for custom event to refresh audit logs when tier changes
  useEffect(() => {
    const handleTierChange = () => {
      logger.log("🔄 [PLATFORM SETTINGS] Tier change event received, audit logs should refresh");
      // Dispatch event to trigger audit log refresh in parent Admin component
      window.dispatchEvent(new CustomEvent('refreshAuditLogs'));
    };
    
    window.addEventListener('tierChanged', handleTierChange);
    return () => window.removeEventListener('tierChanged', handleTierChange);
  }, []);

  return (
    <div className="admin-section">
      <div className="section-header">
        <FontAwesomeIcon icon={faSlidersH} className="section-icon" />
        <h2>Platform Settings</h2>
      </div>
      <div className="section-content">
        <p className="section-description">
          Configure platform-wide settings including markup percentage and credit tier management.
        </p>

        {error && (
          <div className="error-message" style={{ marginBottom: '1rem' }}>
            <FontAwesomeIcon icon={faInfoCircle} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="success-message" style={{ marginBottom: '1rem' }}>
            <FontAwesomeIcon icon={faInfoCircle} />
            <span>{success}</span>
          </div>
        )}

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
                          Tier ID will be auto-generated from price: {(newTier.basePrice ?? 0) > 0 ? generateTierId(newTier.basePrice ?? 0) : '—'}
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
                          if (!newTier?.name || newTier.basePrice == null || newTier.baseCredits == null) return;
                          try {
                            await saveCreditTier({
                              ...newTier,
                              name: newTier.name,
                              basePrice: newTier.basePrice,
                              baseCredits: newTier.baseCredits,
                            });
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
                                logger.log("🟣 [FRONTEND] Save Changes button clicked!");
                                logger.log("🟣 [FRONTEND] Tier ID:", tier.id);
                                logger.log("🟣 [FRONTEND] Full tier object:", JSON.stringify(tier, null, 2));
                                const tierToSave = creditTiers.find(t => t.id === tier.id);
                                logger.log("🟣 [FRONTEND] Found tier to save:", tierToSave ? "YES" : "NO");
                                if (tierToSave) {
                                  logger.log("🟣 [FRONTEND] Calling saveCreditTier...");
                                  saveCreditTier(tierToSave);
                                } else {
                                  logger.error("🔴 [FRONTEND] Tier not found in creditTiers array!");
                                }
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
                                loadCreditTiers();
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
                            onClick={() => {
                              logger.log("🟠 [FRONTEND] Edit button clicked!");
                              logger.log("🟠 [FRONTEND] Tier ID:", tier.id);
                              logger.log("🟠 [FRONTEND] Setting editingTier to:", tier.id);
                              setEditingTier(tier.id || null);
                            }}
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
  );
};

