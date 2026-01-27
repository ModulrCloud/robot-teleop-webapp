import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faCrown, 
  faTimes, 
  faCheckCircle, 
  faCoins,
  faRocket,
  faCalendarAlt,
  faInfoCircle,
  faSpinner,
  faGift
} from '@fortawesome/free-solid-svg-icons';
import { useUserCredits } from '../hooks/useUserCredits';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import './SubscriptionModal.css';

const client = generateClient<Schema>();

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (plan: 'monthly' | 'annual') => void;
  currentStatus: string | null; // 'none' | 'trial' | 'active' | 'cancelled' | 'expired'
  currentPlan: string | null; // 'monthly' | 'annual' | null
  pendingSubscriptionPlan: string | null; // Scheduled subscription plan
  pendingSubscriptionStartsAt: string | null; // When scheduled subscription starts
  isOgPricing: boolean;
  ogPriceMonthly: number | null;
  ogPriceAnnual: number | null;
  trialEndsAt: string | null;
}

// Standard pricing (in MTR credits)
const STANDARD_PRICING = {
  monthly: 399,    // $3.99/mo
  annual: 4000,    // $40/yr (~$3.33/mo)
};

// OG pricing for early adopters (same as standard currently, but locked in)
const OG_PRICING = {
  monthly: 399,
  annual: 4000,
};

export function SubscriptionModal({
  isOpen,
  onClose,
  onSuccess,
  currentStatus,
  currentPlan,
  pendingSubscriptionPlan,
  pendingSubscriptionStartsAt,
  isOgPricing,
  ogPriceMonthly,
  ogPriceAnnual,
  trialEndsAt,
}: SubscriptionModalProps) {
  const { user } = useAuthStatus();
  const { credits, refreshCredits } = useUserCredits();
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Get pricing based on OG status
  const monthlyPrice = isOgPricing && ogPriceMonthly ? ogPriceMonthly : STANDARD_PRICING.monthly;
  const annualPrice = isOgPricing && ogPriceAnnual ? ogPriceAnnual : STANDARD_PRICING.annual;
  
  const selectedPrice = selectedPlan === 'monthly' ? monthlyPrice : annualPrice;
  const hasScheduledSubscription = !!pendingSubscriptionPlan;
  const isScheduled = (currentStatus === 'trial' || currentStatus === 'active') && !hasScheduledSubscription;
  const hasEnoughCredits = credits >= selectedPrice;
  const needsCreditsNow = !isScheduled; // Only need credits immediately if not scheduling

  // Calculate savings
  const annualMonthlyCost = annualPrice / 12;
  const monthlySavingsPercent = Math.round((1 - annualMonthlyCost / monthlyPrice) * 100);

  // Calculate trial days remaining
  const getTrialDaysRemaining = () => {
    if (!trialEndsAt) return 0;
    const endDate = new Date(trialEndsAt);
    const now = new Date();
    const diffTime = endDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  };

  const trialDaysRemaining = getTrialDaysRemaining();

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPurchaseError('');
      setPurchaseSuccess(false);
      setSelectedPlan('annual'); // Default to annual (best value)
    }
  }, [isOpen]);

  const handleCancelScheduled = async () => {
    if (!user?.username || isPurchasing) return;

    setIsPurchasing(true);
    setPurchaseError('');

    try {
      // Get current profile to update
      const profileResult = await client.queries.getSocialProfileLambda();
      
      let profileResponse;
      if (typeof profileResult.data === 'string') {
        const parsedData = JSON.parse(profileResult.data);
        profileResponse = parsedData.body ? JSON.parse(parsedData.body) : parsedData;
      } else {
        profileResponse = profileResult.data;
      }

      if (!profileResponse?.success || !profileResponse?.profile) {
        throw new Error('Failed to load profile');
      }

      const profile = profileResponse.profile;

      // Update profile to remove pending subscription
      await client.models.SocialProfile.update({
        id: profile.id,
        pendingSubscriptionPlan: null,
        pendingSubscriptionStartsAt: null,
      });

      // Refresh profile data
      window.dispatchEvent(new Event('socialProfileUpdated'));
      setPurchaseSuccess(true);
      setSuccessMessage('Scheduled subscription cancelled successfully.');
      
      setTimeout(() => {
        onClose();
      }, 2000);

    } catch (error: unknown) {
      let errorMessage = 'Failed to cancel scheduled subscription. Please try again.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      setPurchaseError(errorMessage);
    } finally {
      setIsPurchasing(false);
    }
  };

  const handlePurchase = async () => {
    if (!user?.username || isPurchasing) return;

    // Only check credits if not scheduling (i.e., starting immediately)
    if (!isScheduled && !hasEnoughCredits) {
      setPurchaseError(`Insufficient MTR credits. You need ${selectedPrice.toLocaleString()} MTR but only have ${credits.toLocaleString()} MTR.`);
      return;
    }

    setIsPurchasing(true);
    setPurchaseError('');

    try {
      const result = await client.mutations.purchaseSubscriptionLambda({
        plan: selectedPlan,
      });

      if (!result.data) {
        throw new Error(result.errors?.[0]?.message || 'Failed to process subscription');
      }

      // Parse the Lambda response
      let parsedData = result.data;
      if (typeof result.data === 'string') {
        try {
          parsedData = JSON.parse(result.data);
        } catch {
          // Keep original if parse fails
        }
      }

      let response;
      try {
        response = typeof parsedData.body === 'string'
          ? JSON.parse(parsedData.body)
          : parsedData.body || {};
      } catch {
        throw new Error('Invalid response from server');
      }

      // Check for Lambda errors
      if (parsedData.statusCode && parsedData.statusCode >= 400) {
        throw new Error(response.error || response.details || 'Failed to process subscription');
      }

      if (!response.success) {
        throw new Error(response.error || response.details || 'Failed to process subscription');
      }

      // Success!
      setPurchaseSuccess(true);
      setSuccessMessage(response.message || `Your ${selectedPlan} subscription is now active.`);
      refreshCredits();
      window.dispatchEvent(new Event('creditsUpdated'));
      window.dispatchEvent(new Event('socialProfileUpdated'));
      
      setTimeout(() => {
        onSuccess?.(selectedPlan);
      }, 3000); // Give more time to read scheduled message

    } catch (error: unknown) {
      let errorMessage = 'Failed to process subscription. Please try again.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      setPurchaseError(errorMessage);
    } finally {
      setIsPurchasing(false);
    }
  };

  if (!isOpen) return null;

  // Determine what action this modal is for
  const getModalTitle = () => {
    switch (currentStatus) {
      case 'trial':
        return 'Subscribe to Pro';
      case 'cancelled':
        return 'Reactivate Pro';
      case 'expired':
      case 'none':
      case null:
        return 'Upgrade to Pro';
      case 'active':
        return currentPlan === 'monthly' ? 'Switch to Annual' : 'Manage Subscription';
      default:
        return 'Modulr Pro';
    }
  };

  const getModalSubtitle = () => {
    switch (currentStatus) {
      case 'trial':
        return `Your trial ends in ${trialDaysRemaining} days. Subscribe now to keep Pro features!`;
      case 'cancelled':
        return 'Reactivate your subscription to regain Pro features';
      case 'expired':
        return 'Your Pro access has expired. Subscribe to get it back!';
      case 'active':
        return currentPlan === 'monthly' 
          ? `Save ${monthlySavingsPercent}% by switching to annual billing`
          : 'You\'re on the best plan!';
      default:
        return 'Unlock unlimited posts, comments, and exclusive features';
    }
  };

  return createPortal(
    <div className="subscription-modal-overlay" onClick={!isPurchasing ? onClose : undefined}>
      <div className="subscription-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="subscription-modal-header">
          <div className="subscription-modal-header-left">
            <FontAwesomeIcon icon={faCrown} className="subscription-modal-icon" />
            <div>
              <h2>{getModalTitle()}</h2>
              <p className="subscription-modal-subtitle">{getModalSubtitle()}</p>
            </div>
          </div>
          <button 
            className="subscription-modal-close" 
            onClick={onClose}
            disabled={isPurchasing}
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {/* Success State */}
        {purchaseSuccess ? (
          <div className="subscription-modal-success">
            <FontAwesomeIcon icon={faCheckCircle} className="success-icon" />
            <h3>{successMessage.includes('scheduled') ? 'Subscription Scheduled!' : 'Welcome to Pro!'}</h3>
            <p>{successMessage}</p>
          </div>
        ) : (
          <>
            {/* Plan Selection */}
            <div className="subscription-modal-plans">
              {/* Monthly Plan */}
              <div 
                className={`plan-card ${selectedPlan === 'monthly' ? 'selected' : ''}`}
                onClick={() => setSelectedPlan('monthly')}
              >
                <div className="plan-header">
                  <FontAwesomeIcon icon={faCalendarAlt} />
                  <span>Monthly</span>
                </div>
                <div className="plan-price">
                  <span className="price-amount">{monthlyPrice.toLocaleString()}</span>
                  <span className="price-unit">MTR/mo</span>
                </div>
                <div className="plan-price-usd">
                  ${(monthlyPrice / 100).toFixed(2)}/month
                </div>
                <div className="plan-features">
                  <span>Cancel anytime</span>
                </div>
                <div className={`plan-radio ${selectedPlan === 'monthly' ? 'checked' : ''}`} />
              </div>

              {/* Annual Plan */}
              <div 
                className={`plan-card ${selectedPlan === 'annual' ? 'selected' : ''} recommended`}
                onClick={() => setSelectedPlan('annual')}
              >
                <div className="plan-badge">Best Value</div>
                <div className="plan-header">
                  <FontAwesomeIcon icon={faRocket} />
                  <span>Annual</span>
                </div>
                <div className="plan-price">
                  <span className="price-amount">{annualPrice.toLocaleString()}</span>
                  <span className="price-unit">MTR/yr</span>
                </div>
                <div className="plan-price-usd">
                  ${(annualPrice / 100).toFixed(2)}/year
                  <span className="plan-monthly-equivalent">
                    (~${(annualPrice / 12 / 100).toFixed(2)}/mo)
                  </span>
                </div>
                <div className="plan-features">
                  <span className="plan-savings">Save {monthlySavingsPercent}%</span>
                </div>
                <div className={`plan-radio ${selectedPlan === 'annual' ? 'checked' : ''}`} />
              </div>
            </div>

            {/* OG Pricing Notice */}
            {isOgPricing && (
              <div className="subscription-og-notice">
                <FontAwesomeIcon icon={faGift} />
                <div>
                  <strong>OG Pricing Locked In!</strong>
                  <p>As an early adopter, you've secured special pricing. Keep your subscription active to maintain it!</p>
                </div>
              </div>
            )}

            {/* Scheduled Subscription Notice - Only show if there's actually a scheduled subscription */}
            {hasScheduledSubscription && pendingSubscriptionStartsAt && (
              <div className="subscription-scheduled-notice">
                <FontAwesomeIcon icon={faCalendarAlt} />
                <div>
                  <strong>Subscription Scheduled</strong>
                  <p>
                    Your <strong>{pendingSubscriptionPlan}</strong> subscription is scheduled to start on{' '}
                    <strong>{new Date(pendingSubscriptionStartsAt).toLocaleDateString()}</strong>.
                    You'll be charged {pendingSubscriptionPlan === 'monthly' ? monthlyPrice : annualPrice} MTR at that time.
                  </p>
                  <button
                    className="btn-cancel-scheduled"
                    onClick={handleCancelScheduled}
                    disabled={isPurchasing}
                  >
                    Cancel Scheduled Subscription
                  </button>
                </div>
              </div>
            )}

            {/* Balance Display */}
            <div className="subscription-modal-balance">
              <div className="balance-info">
                <FontAwesomeIcon icon={faCoins} />
                <span>Your balance: <strong>{credits.toLocaleString()} MTR</strong></span>
              </div>
              {!isScheduled && !hasEnoughCredits && (
                <span className="balance-warning">
                  (Need {(selectedPrice - credits).toLocaleString()} more)
                </span>
              )}
              {isScheduled && !hasEnoughCredits && (
                <span className="balance-info-text" style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginLeft: '0.5rem' }}>
                  (You'll need {selectedPrice.toLocaleString()} MTR when your subscription starts)
                </span>
              )}
            </div>

            {/* Pro Benefits */}
            <div className="subscription-modal-benefits">
              <h4>What you get with Pro:</h4>
              <ul>
                <li><FontAwesomeIcon icon={faCheckCircle} /> Unlimited posts per day</li>
                <li><FontAwesomeIcon icon={faCheckCircle} /> Unlimited comments per day</li>
                <li><FontAwesomeIcon icon={faCheckCircle} /> Extended post length (4,092 chars)</li>
                <li><FontAwesomeIcon icon={faCheckCircle} /> Pro badge on your profile</li>
                <li><FontAwesomeIcon icon={faCheckCircle} /> Video uploads (coming soon)</li>
                <li><FontAwesomeIcon icon={faCheckCircle} /> Code execution (coming soon)</li>
              </ul>
            </div>

            {/* Error Display */}
            {purchaseError && (
              <div className="subscription-modal-error">
                <FontAwesomeIcon icon={faInfoCircle} />
                {purchaseError}
              </div>
            )}

            {/* Action Buttons */}
            <div className="subscription-modal-actions">
              <button
                className="btn-cancel"
                onClick={onClose}
                disabled={isPurchasing}
              >
                Cancel
              </button>
              <button
                className="btn-subscribe"
                onClick={handlePurchase}
                disabled={isPurchasing || (!isScheduled && !hasEnoughCredits)}
              >
                {isPurchasing ? (
                  <>
                    <FontAwesomeIcon icon={faSpinner} spin />
                    Processing...
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faCrown} />
                    Subscribe - {selectedPrice.toLocaleString()} MTR
                  </>
                )}
              </button>
            </div>

            {/* Terms Notice */}
            <p className="subscription-modal-terms">
              {selectedPlan === 'monthly' 
                ? 'Billed monthly. Cancel anytime.'
                : 'Billed annually. Cancel anytime for a prorated refund.'}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
