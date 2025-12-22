import { useState, useEffect } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { useUserCredits } from "../hooks/useUserCredits";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCoins,
  faHistory,
  faCreditCard,
  faToggleOn,
  faToggleOff,
  faArrowUp,
  faArrowDown,
  faInfoCircle,
  faCalendar,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import { formatCurrency } from "../utils/credits";
import { logger } from "../utils/logger";
import { PurchaseCreditsModal } from "../components/PurchaseCreditsModal";
import "./Credits.css";

const client = generateClient<Schema>();

interface CreditTransaction {
  id: string;
  amount: number;
  pricePaid?: number | null;
  currency?: string | null;
  tier?: string | null;
  transactionType: string;
  description?: string | null;
  createdAt: string;
}

export const Credits = () => {
  usePageTitle();
  const { user } = useAuthStatus();
  const { credits, currency: preferredCurrency, formattedBalance, loading: creditsLoading } = useUserCredits();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);

  // Auto top-up settings state
  const [autoTopUpEnabled, setAutoTopUpEnabled] = useState(false);
  const [autoTopUpThreshold, setAutoTopUpThreshold] = useState(100);
  const [autoTopUpTier, setAutoTopUpTier] = useState("50");
  const [hasPaymentMethod, setHasPaymentMethod] = useState(false);
  // Initialize with default tiers so dropdown works immediately
  const [availableTiers, setAvailableTiers] = useState<Array<{tierId: string, name: string, basePrice: number}>>([
    { tierId: '20', name: 'Starter Pack', basePrice: 20 },
    { tierId: '50', name: 'Pro Pack', basePrice: 50 },
    { tierId: '100', name: 'Elite Pack', basePrice: 100 },
  ]);

  // Load user credits data and transactions
  useEffect(() => {
    if (user?.username) {
      loadCreditsData();
      loadTransactions();
      loadAvailableTiers();
    }
  }, [user?.username]);

  const loadCreditsData = async () => {
    if (!user?.username) return;

    try {
      const { data: userCreditsList } = await client.models.UserCredits.list({
        filter: { userId: { eq: user.username } },
      });

      if (userCreditsList && userCreditsList.length > 0) {
        const userCredits = userCreditsList[0];
        setAutoTopUpEnabled(userCredits.autoTopUpEnabled || false);
        setAutoTopUpThreshold(userCredits.autoTopUpThreshold || 100);
        setAutoTopUpTier(userCredits.autoTopUpTier || "50");
        setHasPaymentMethod(!!userCredits.stripePaymentMethodId);
      }
    } catch (err) {
      logger.error("Error loading credits data:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async () => {
    if (!user?.username) return;

    try {
      const { data: transactionList } = await client.models.CreditTransaction.list({
        filter: { userId: { eq: user.username } },
      });

      if (transactionList) {
        const sortedTransactions: CreditTransaction[] = [...transactionList]
          .sort((a, b) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
          .map(t => ({
            id: t.id || '',
            amount: t.amount || 0,
            pricePaid: t.pricePaid ?? undefined,
            currency: t.currency ?? undefined,
            tier: t.tier ?? undefined,
            transactionType: t.transactionType,
            description: t.description ?? undefined,
            createdAt: t.createdAt,
          }));

        setTransactions(sortedTransactions);
      }
    } catch (err) {
      logger.error("Error loading transactions:", err);
    }
  };

  const loadAvailableTiers = async () => {
    try {
      // Load all tiers and filter by isActive in JavaScript (DynamoDB doesn't support boolean filters)
      const { data: tiersList } = await client.models.CreditTier.list();

      if (tiersList && tiersList.length > 0) {
        const sortedTiers = tiersList
          .filter(tier => tier.isActive !== false) // Filter active tiers
          .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
          .map(tier => ({
            tierId: tier.tierId || '',
            name: tier.name || '',
            basePrice: tier.basePrice || 0,
          }));

        if (sortedTiers.length > 0) {
          setAvailableTiers(sortedTiers);

          // If no tier is selected or selected tier doesn't exist, default to first tier
          if (!sortedTiers.find(t => t.tierId === autoTopUpTier)) {
            setAutoTopUpTier(sortedTiers[0].tierId);
          }
          return; // Success, exit early
        }
      }
      
      // If no tiers found, keep default tiers (already set in initial state)
      logger.log("No CreditTier records found in database, using default tiers");
    } catch (err) {
      logger.error("Error loading available tiers:", err);
      // If error, keep default tiers (already set in initial state)
    }
  };

  const handleSaveAutoTopUp = async () => {
    if (!user?.username) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { data: userCreditsList } = await client.models.UserCredits.list({
        filter: { userId: { eq: user.username } },
      });

      if (userCreditsList && userCreditsList.length > 0) {
        const userCredits = userCreditsList[0];
        await client.models.UserCredits.update({
          id: userCredits.id,
          autoTopUpEnabled,
          autoTopUpThreshold,
          autoTopUpTier,
        });

        setSuccess("Auto top-up settings saved successfully!");
        setTimeout(() => setSuccess(""), 3000);
      } else {
        // Create new UserCredits record if it doesn't exist
        await client.models.UserCredits.create({
          userId: user.username,
          credits: 0,
          autoTopUpEnabled,
          autoTopUpThreshold,
          autoTopUpTier,
        });

        setSuccess("Auto top-up settings saved successfully!");
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch (err) {
      logger.error("Error saving auto top-up settings:", err);
      setError("Failed to save auto top-up settings");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'purchase':
        return faArrowUp;
      case 'deduction':
        return faArrowDown;
      case 'refund':
        return faArrowUp;
      case 'bonus':
        return faArrowUp;
      default:
        return faCoins;
    }
  };

  const getTransactionColor = (_type: string, amount: number) => {
    if (amount > 0) {
      return '#4caf50'; // Green for credits added
    }
    return '#f44336'; // Red for credits deducted
  };

  const getTierLabel = (tier: {tierId: string, name: string, basePrice: number}) => {
    return `${tier.name} (${formatCurrency(tier.basePrice, preferredCurrency || 'USD')})`;
  };

  if (loading || creditsLoading) {
    return (
      <div className="credits-page">
        <div className="loading">Loading credits...</div>
      </div>
    );
  }

  return (
    <div className="credits-page">
      <div className="page-header">
        <div className="header-icon">
          <FontAwesomeIcon icon={faCoins} />
        </div>
        <div className="header-content">
          <h1>Credits</h1>
          <p>Manage your credits, view transaction history, and configure auto top-up</p>
        </div>
      </div>

      {/* Current Balance Card */}
      <div className="balance-card">
        <div className="balance-info">
          <div className="balance-label">Current Balance</div>
          <div className="balance-amount">{formattedBalance}</div>
          <div className="balance-credits">{credits?.toLocaleString() || 0} Credits</div>
        </div>
        <button 
          className="purchase-button"
          onClick={() => setShowPurchaseModal(true)}
        >
          <FontAwesomeIcon icon={faWallet} />
          <span>Purchase Credits</span>
        </button>
      </div>

      {/* Auto Top-Up Settings */}
      <div className="settings-section">
        <div className="section-header">
          <FontAwesomeIcon icon={faCreditCard} />
          <h2>Auto Top-Up</h2>
        </div>
        <p className="section-description">
          Automatically purchase credits when your balance falls below a threshold
        </p>

        {success && (
          <div className="success-message">{success}</div>
        )}
        {error && (
          <div className="error-message">{error}</div>
        )}

        <div className="auto-topup-settings">
          <div className="setting-row">
            <div className="setting-info">
              <label>Enable Auto Top-Up</label>
              <span className="setting-description">
                Automatically purchase credits when balance is low
              </span>
            </div>
            <button
              className="toggle-button"
              onClick={() => setAutoTopUpEnabled(!autoTopUpEnabled)}
              type="button"
            >
              <FontAwesomeIcon 
                icon={autoTopUpEnabled ? faToggleOn : faToggleOff} 
                className={autoTopUpEnabled ? 'enabled' : 'disabled'}
              />
            </button>
          </div>

          {autoTopUpEnabled && (
            <>
              <div className="setting-row">
                <div className="setting-info">
                  <label>Threshold</label>
                  <span className="setting-description">
                    Top up when credits fall below this amount
                  </span>
                </div>
                <div className="threshold-input-group">
                  <input
                    type="number"
                    className="threshold-input"
                    value={autoTopUpThreshold}
                    onChange={(e) => setAutoTopUpThreshold(parseInt(e.target.value) || 100)}
                    min="0"
                    max="10000"
                  />
                  <span className="threshold-label">Credits</span>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <label>Purchase Tier</label>
                  <span className="setting-description">
                    Which credit pack to purchase automatically
                  </span>
                </div>
                {availableTiers.length > 0 ? (
                  <select
                    className="tier-select"
                    value={autoTopUpTier}
                    onChange={(e) => setAutoTopUpTier(e.target.value)}
                  >
                    {availableTiers.map(tier => (
                      <option key={tier.tierId} value={tier.tierId}>
                        {getTierLabel(tier)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select className="tier-select" disabled>
                    <option>Loading tiers...</option>
                  </select>
                )}
              </div>

              {!hasPaymentMethod && (
                <div className="info-banner">
                  <FontAwesomeIcon icon={faInfoCircle} />
                  <span>
                    You'll need to save a payment method to enable auto top-up. 
                    This will be available after your first purchase.
                  </span>
                </div>
              )}

              <div className="save-button-container">
                <button
                  className="save-button"
                  onClick={handleSaveAutoTopUp}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Transaction History */}
      <div className="settings-section">
        <div className="section-header">
          <FontAwesomeIcon icon={faHistory} />
          <h2>Transaction History</h2>
        </div>
        <p className="section-description">
          View all your credit purchases, deductions, and transactions
        </p>

        {transactions.length === 0 ? (
          <div className="empty-state">
            <FontAwesomeIcon icon={faHistory} />
            <h3>No transactions yet</h3>
            <p>Your credit transactions will appear here</p>
          </div>
        ) : (
          <div className="transactions-list">
            {transactions.map(transaction => (
              <div key={transaction.id} className="transaction-card">
                <div className="transaction-icon">
                  <FontAwesomeIcon 
                    icon={getTransactionIcon(transaction.transactionType)}
                    style={{ color: getTransactionColor(transaction.transactionType, transaction.amount) }}
                  />
                </div>
                <div className="transaction-details">
                  <div className="transaction-type">
                    {transaction.description || transaction.transactionType}
                  </div>
                  <div className="transaction-meta">
                    <FontAwesomeIcon icon={faCalendar} />
                    <span>{formatDate(transaction.createdAt)}</span>
                    {transaction.tier && (
                      <>
                        <span className="meta-separator">•</span>
                        <span>Tier: {transaction.tier}</span>
                      </>
                    )}
                  </div>
                </div>
                <div 
                  className="transaction-amount"
                  style={{ color: getTransactionColor(transaction.transactionType, transaction.amount) }}
                >
                  {transaction.amount > 0 ? '+' : ''}
                  {transaction.amount.toLocaleString()} Credits
                </div>
                {transaction.pricePaid && transaction.currency && (
                  <div className="transaction-price">
                    {formatCurrency(transaction.pricePaid, transaction.currency)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Purchase Credits Modal */}
      <PurchaseCreditsModal 
        isOpen={showPurchaseModal} 
        onClose={() => {
          setShowPurchaseModal(false);
          loadCreditsData();
          loadTransactions();
        }} 
      />
    </div>
  );
};

