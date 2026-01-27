import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTimes,
  faAt,
  faCheck,
  faSpinner,
  faExclamationTriangle,
  faCoins,
  faLock,
  faGlobe,
} from '@fortawesome/free-solid-svg-icons';
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { useUserCredits } from '../hooks/useUserCredits';
import { logger } from '../utils/logger';
import './UsernameRegistrationModal.css';

const client = generateClient<Schema>();

interface UsernameRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (username: string) => void;
}

type ValidationStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'reserved';

interface UsernameValidation {
  status: ValidationStatus;
  message: string;
}

// Username tier pricing (in MTR credits)
// Conversion: 1 USD = 100 MTR
const USERNAME_TIERS = {
  og: { minLength: 1, maxLength: 3, price: 7900, label: 'OG', description: 'Extremely rare' },
  premium: { minLength: 4, maxLength: 5, price: 1900, label: 'Premium', description: 'Short & memorable' },
  standard: { minLength: 6, maxLength: 20, price: 500, label: 'Standard', description: 'Most users' },
};

// Reserved system usernames
const SYSTEM_RESERVED = [
  'admin', 'administrator', 'support', 'help', 'modulr', 'modulrcloud',
  'official', 'verified', 'system', 'bot', 'robot', 'api', 'dev', 'developer',
  'null', 'undefined', 'test', 'demo', 'example', 'root', 'superuser',
  'about', 'home', 'settings', 'profile', 'login', 'logout', 'signup',
  'register', 'dashboard', 'explore', 'search', 'notifications', 'messages',
];

// Basic profanity filter (expand this list or use a library in production)
const PROFANITY_LIST = [
  // Add profanity words here - keeping minimal for code review
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'crap',
];

function getTierForLength(length: number): keyof typeof USERNAME_TIERS | null {
  if (length >= USERNAME_TIERS.og.minLength && length <= USERNAME_TIERS.og.maxLength) return 'og';
  if (length >= USERNAME_TIERS.premium.minLength && length <= USERNAME_TIERS.premium.maxLength) return 'premium';
  if (length >= USERNAME_TIERS.standard.minLength && length <= USERNAME_TIERS.standard.maxLength) return 'standard';
  return null;
}

function formatMtrAsUsd(mtr: number): string {
  const usd = mtr / 100;
  return `$${usd.toFixed(2)}`;
}

export function UsernameRegistrationModal({ isOpen, onClose, onSuccess }: UsernameRegistrationModalProps) {
  const { user } = useAuthStatus();
  const { credits, refreshCredits } = useUserCredits();
  const [username, setUsername] = useState('');
  const [validation, setValidation] = useState<UsernameValidation>({ status: 'idle', message: '' });
  const [promoCode, setPromoCode] = useState('');
  const [promoDiscount, setPromoDiscount] = useState(0); // Percentage discount
  const [promoValidation, setPromoValidation] = useState<{ status: 'idle' | 'validating' | 'valid' | 'invalid'; message: string }>({ status: 'idle', message: '' });
  const [bonusTrialMonths, setBonusTrialMonths] = useState(0);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const promoValidationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const tier = username.length > 0 ? getTierForLength(username.length) : null;
  const tierInfo = tier ? USERNAME_TIERS[tier] : null;
  const basePrice = tierInfo?.price || 0;
  const discountAmount = Math.floor(basePrice * (promoDiscount / 100));
  const finalPrice = basePrice - discountAmount;
  const hasEnoughCredits = credits >= finalPrice;

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isPurchasing) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, isPurchasing]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Auto-focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUsername('');
      setValidation({ status: 'idle', message: '' });
      setPromoCode('');
      setPromoDiscount(0);
      setPromoValidation({ status: 'idle', message: '' });
      setBonusTrialMonths(0);
      setPurchaseError('');
      setPurchaseSuccess(false);
    }
  }, [isOpen]);

  // Validate promo code when user enters/changes it
  const validatePromoCode = useCallback(async (code: string) => {
    if (!code || code.trim().length === 0) {
      setPromoDiscount(0);
      setBonusTrialMonths(0);
      setPromoValidation({ status: 'idle', message: '' });
      return;
    }

    setPromoValidation({ status: 'validating', message: 'Validating code...' });

    try {
      const result = await client.queries.validatePromoCodeLambda({
        code: code.trim().toUpperCase(),
      });

      if (!result.data) {
        throw new Error(result.errors?.[0]?.message || 'Failed to validate promo code');
      }

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

      if (response.valid) {
        setPromoDiscount(response.usernameDiscountPercent || 0);
        setBonusTrialMonths(response.trialMonths || 0);
        setPromoValidation({ 
          status: 'valid', 
          message: response.usernameDiscountPercent 
            ? `${response.usernameDiscountPercent}% off${response.trialMonths ? ` + ${response.trialMonths} bonus trial months` : ''}`
            : response.trialMonths 
              ? `${response.trialMonths} bonus trial months`
              : 'Code applied'
        });
      } else {
        setPromoDiscount(0);
        setBonusTrialMonths(0);
        setPromoValidation({ status: 'invalid', message: response.reason || 'Invalid promo code' });
      }
    } catch (error: unknown) {
      if (import.meta.env.DEV) {
        logger.error('[UsernameModal] Promo code validation error:', error);
      }
      setPromoDiscount(0);
      setBonusTrialMonths(0);
      setPromoValidation({ 
        status: 'invalid', 
        message: error instanceof Error ? error.message : 'Failed to validate promo code' 
      });
    }
  }, [client]);

  // Debounce promo code validation
  useEffect(() => {
    if (promoValidationTimeoutRef.current) {
      clearTimeout(promoValidationTimeoutRef.current);
    }

    if (promoCode.trim().length > 0) {
      promoValidationTimeoutRef.current = setTimeout(() => {
        validatePromoCode(promoCode);
      }, 500); // Wait 500ms after user stops typing
    } else {
      setPromoDiscount(0);
      setBonusTrialMonths(0);
      setPromoValidation({ status: 'idle', message: '' });
    }

    return () => {
      if (promoValidationTimeoutRef.current) {
        clearTimeout(promoValidationTimeoutRef.current);
      }
    };
  }, [promoCode, validatePromoCode]);

  // Validate username format (client-side)
  const validateFormat = useCallback((value: string): UsernameValidation => {
    if (value.length === 0) {
      return { status: 'idle', message: '' };
    }

    // Check length
    if (value.length > 20) {
      return { status: 'invalid', message: 'Username must be 20 characters or less' };
    }

    // Check characters (alphanumeric + underscore only)
    if (!/^[a-z0-9_]+$/.test(value)) {
      return { status: 'invalid', message: 'Only lowercase letters, numbers, and underscores allowed' };
    }

    // Check for consecutive underscores
    if (/__/.test(value)) {
      return { status: 'invalid', message: 'No consecutive underscores allowed' };
    }

    // Check start/end with underscore
    if (value.startsWith('_') || value.endsWith('_')) {
      return { status: 'invalid', message: 'Cannot start or end with underscore' };
    }

    // Check system reserved names
    if (SYSTEM_RESERVED.includes(value)) {
      return { status: 'reserved', message: 'This username is reserved' };
    }

    // Check profanity (basic check)
    const lowerValue = value.toLowerCase();
    for (const word of PROFANITY_LIST) {
      if (lowerValue.includes(word)) {
        return { status: 'invalid', message: 'Username contains inappropriate content' };
      }
    }

    return { status: 'checking', message: 'Checking availability...' };
  }, []);

  // Check username availability (server-side)
  const checkAvailability = useCallback(async (value: string): Promise<UsernameValidation> => {
    try {
      // Check if username exists in SocialProfile
      const { data: existingProfiles } = await client.models.SocialProfile.list({
        filter: { username: { eq: value } },
        limit: 1,
      });

      if (existingProfiles && existingProfiles.length > 0) {
        return { status: 'taken', message: 'This username is already taken' };
      }

      // Check if username is in ReservedUsername table
      const { data: reservedUsernames } = await client.models.ReservedUsername.list({
        filter: { username: { eq: value } },
        limit: 1,
      });

      if (reservedUsernames && reservedUsernames.length > 0) {
        const reserved = reservedUsernames[0];
        if (reserved?.contactRequired) {
          return { 
            status: 'reserved', 
            message: 'This username is reserved. Contact support@modulr.cloud to claim it.' 
          };
        }
        return { status: 'reserved', message: 'This username is reserved' };
      }

      return { status: 'available', message: 'Username is available!' };
    } catch (error) {
      logger.error('Error checking username availability:', error);
      return { status: 'invalid', message: 'Error checking availability. Please try again.' };
    }
  }, []);

  // Debounced validation
  const validateUsername = useCallback((value: string) => {
    // Clear previous timeout
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }

    // Normalize to lowercase
    const normalizedValue = value.toLowerCase().replace(/[^a-z0-9_]/g, '');

    // Client-side validation first
    const formatValidation = validateFormat(normalizedValue);
    setValidation(formatValidation);

    // If format is valid, check server-side availability after debounce
    if (formatValidation.status === 'checking') {
      validationTimeoutRef.current = setTimeout(async () => {
        const availabilityValidation = await checkAvailability(normalizedValue);
        setValidation(availabilityValidation);
      }, 300);
    }
  }, [validateFormat, checkAvailability]);

  // Handle username input change
  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(value);
    validateUsername(value);
    setPurchaseError('');
  };

  // Handle purchase - uses dedicated Lambda for atomic credit deduction + profile creation
  const handlePurchase = async () => {
    if (!user?.username || validation.status !== 'available' || !tierInfo || isPurchasing) {
      return;
    }

    if (!hasEnoughCredits) {
      setPurchaseError(`Insufficient MTR credits. You need ${finalPrice.toLocaleString()} MTR but only have ${credits.toLocaleString()} MTR.`);
      return;
    }

    setIsPurchasing(true);
    setPurchaseError('');

    try {
      // Call dedicated Lambda that handles credit deduction + profile creation atomically
      const result = await client.mutations.purchaseUsernameLambda({
        username: username,
        promoCode: promoCode.trim().length > 0 ? promoCode.trim().toUpperCase() : undefined,
      });

      if (!result.data) {
        throw new Error(result.errors?.[0]?.message || 'Failed to purchase username - no data returned');
      }

      // The result.data might be a string that needs parsing (Lambda returns JSON)
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
      
      // Check for Lambda errors (statusCode 4xx/5xx)
      if (parsedData.statusCode && parsedData.statusCode >= 400) {
        // Special case: User already has a username, but profile was repaired
        if (response.profileRepaired) {
          // Dispatch events to refresh profile data
          window.dispatchEvent(new Event('socialProfileUpdated'));
          window.dispatchEvent(new Event('creditsUpdated'));
          setPurchaseSuccess(true);
          setTimeout(() => {
            onSuccess?.(response.error?.match(/@(\w+)/)?.[1] || username);
          }, 1500);
          return;
        }
        
        throw new Error(response.error || response.details || 'Failed to purchase username');
      }
      
      if (!response.success) {
        throw new Error(response.error || response.details || 'Failed to purchase username');
      }

      // Success!
      setPurchaseSuccess(true);
      
      // Refresh credits locally and notify all other components (like navbar) via global event
      refreshCredits();
      window.dispatchEvent(new Event('creditsUpdated'));
      
      // Notify all useSocialProfile hooks to refetch (for gating checks)
      window.dispatchEvent(new Event('socialProfileUpdated'));
      
      // Call success callback after a short delay
      setTimeout(() => {
        onSuccess?.(response.username);
      }, 2000);

    } catch (error: unknown) {
      // Only log errors in development
      if (import.meta.env.DEV) {
        logger.error('[UsernameModal] Purchase error:', error);
      }
      
      let errorMessage = 'Failed to purchase username. Please try again.';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      setPurchaseError(errorMessage);
    } finally {
      setIsPurchasing(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="username-modal-overlay" onClick={!isPurchasing ? onClose : undefined}>
      <div className="username-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="username-modal-header">
          <div className="username-modal-header-left">
            <FontAwesomeIcon icon={faAt} className="username-modal-icon" />
            <div>
              <h2>Register Your Username</h2>
              <p className="username-modal-subtitle">Claim your unique @handle on Modulr</p>
            </div>
          </div>
          <button 
            className="username-modal-close" 
            onClick={onClose} 
            aria-label="Close"
            disabled={isPurchasing}
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {/* Body */}
        <div className="username-modal-body">
          {purchaseSuccess ? (
            <div className="username-success">
              <div className="username-success-icon">
                <FontAwesomeIcon icon={faCheck} />
              </div>
              <h3>Welcome, @{username}!</h3>
              <p>Your username has been registered successfully.</p>
              <p className="username-success-trial">
                You've been granted <strong>3 months of Pro access</strong> as an early adopter!
              </p>
            </div>
          ) : (
            <>
              {/* Username Input */}
              <div className="username-input-section">
                <label htmlFor="username-input">Choose your username</label>
                <div className="username-input-wrapper">
                  <span className="username-prefix">@</span>
                  <input
                    ref={inputRef}
                    id="username-input"
                    type="text"
                    value={username}
                    onChange={handleUsernameChange}
                    placeholder="yourname"
                    maxLength={20}
                    disabled={isPurchasing}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck="false"
                  />
                </div>
                
                {/* Validation Status */}
                {validation.status !== 'idle' && (
                  <div className={`username-validation ${validation.status}`}>
                    {validation.status === 'checking' && (
                      <FontAwesomeIcon icon={faSpinner} spin />
                    )}
                    {validation.status === 'available' && (
                      <FontAwesomeIcon icon={faCheck} />
                    )}
                    {(validation.status === 'taken' || validation.status === 'invalid' || validation.status === 'reserved') && (
                      <FontAwesomeIcon icon={faExclamationTriangle} />
                    )}
                    <span>{validation.message}</span>
                  </div>
                )}

                <p className="username-hint">
                  1-20 characters. Letters, numbers, and underscores only.
                </p>
              </div>

              {/* Tier Display */}
              {tierInfo && validation.status === 'available' && (
                <div className="username-tier-section">
                  <div className="username-tier-header">
                    <span className={`username-tier-badge ${tier}`}>{tierInfo.label}</span>
                    <span className="username-tier-description">{tierInfo.description}</span>
                  </div>
                  
                  <div className="username-pricing">
                    <div className="username-price-row">
                      <span>Base price</span>
                      <span>{basePrice.toLocaleString()} MTR ({formatMtrAsUsd(basePrice)})</span>
                    </div>
                    {promoDiscount > 0 && (
                      <div className="username-price-row discount">
                        <span>Promo discount ({promoDiscount}%)</span>
                        <span>-{discountAmount.toLocaleString()} MTR</span>
                      </div>
                    )}
                    {bonusTrialMonths > 0 && (
                      <div className="username-price-row bonus-trial">
                        <span>Bonus trial months</span>
                        <span>+{bonusTrialMonths} months</span>
                      </div>
                    )}
                    <div className="username-price-row total">
                      <span>Total</span>
                      <span>{finalPrice.toLocaleString()} MTR ({formatMtrAsUsd(finalPrice)})</span>
                    </div>
                  </div>

                  <div className="username-balance">
                    <FontAwesomeIcon icon={faCoins} />
                    <span>Your balance: {credits.toLocaleString()} MTR</span>
                    {!hasEnoughCredits && (
                      <span className="username-balance-warning">
                        (Need {(finalPrice - credits).toLocaleString()} more)
                      </span>
                    )}
                  </div>

                  {/* Promo Code */}
                  <div className="username-promo">
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="Promo code (optional)"
                      maxLength={20}
                      disabled={isPurchasing}
                      className={
                        promoValidation.status === 'valid' ? 'promo-valid' :
                        promoValidation.status === 'invalid' ? 'promo-invalid' :
                        promoValidation.status === 'validating' ? 'promo-validating' : ''
                      }
                    />
                    {promoValidation.status === 'validating' && (
                      <div className="promo-validation-message validating">
                        <FontAwesomeIcon icon={faSpinner} spin />
                        <span>{promoValidation.message}</span>
                      </div>
                    )}
                    {promoValidation.status === 'valid' && (
                      <div className="promo-validation-message valid">
                        <FontAwesomeIcon icon={faCheck} />
                        <span>{promoValidation.message}</span>
                      </div>
                    )}
                    {promoValidation.status === 'invalid' && (
                      <div className="promo-validation-message invalid">
                        <FontAwesomeIcon icon={faExclamationTriangle} />
                        <span>{promoValidation.message}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Benefits */}
              <div className="username-benefits">
                <h4>What you get:</h4>
                <ul>
                  <li>
                    <FontAwesomeIcon icon={faLock} />
                    <span>Permanent ownership - yours forever</span>
                  </li>
                  <li>
                    <FontAwesomeIcon icon={faGlobe} />
                    <span>Portable to Modulr blockchain (coming soon)</span>
                  </li>
                  <li>
                    <FontAwesomeIcon icon={faCheck} />
                    <span>3 months Pro access as early adopter</span>
                  </li>
                </ul>
              </div>

              {/* Error Message */}
              {purchaseError && (
                <div className="username-error">
                  <FontAwesomeIcon icon={faExclamationTriangle} />
                  <span>{purchaseError}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!purchaseSuccess && (
          <div className="username-modal-footer">
            <button 
              className="username-cancel-btn" 
              onClick={onClose}
              disabled={isPurchasing}
            >
              Cancel
            </button>
            <button
              className="username-purchase-btn"
              onClick={handlePurchase}
              disabled={
                validation.status !== 'available' || 
                !hasEnoughCredits || 
                isPurchasing
              }
            >
              {isPurchasing ? (
                <>
                  <FontAwesomeIcon icon={faSpinner} spin />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faCoins} />
                  <span>Purchase - {finalPrice.toLocaleString()} MTR</span>
                </>
              )}
            </button>
          </div>
        )}

        {purchaseSuccess && (
          <div className="username-modal-footer">
            <button className="username-done-btn" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
