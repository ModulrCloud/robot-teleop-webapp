import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTimes,
  faCoins,
  faCheck,
  faStar,
} from '@fortawesome/free-solid-svg-icons';
import { useUserCredits } from '../hooks/useUserCredits';
import { formatCurrency } from '../utils/credits';
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { logger } from '../utils/logger';
import './PurchaseCreditsModal.css';

const client = generateClient<Schema>();

interface PurchaseCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CreditTier {
  id: string;
  name: string;
  price?: number;
  credits?: number;
  bonusCredits?: number;
  isPopular?: boolean;
  isOnSale?: boolean;
  salePrice?: number;
  isEnterprise?: boolean;
  contactEmail?: string;
}

const DEFAULT_TIERS: CreditTier[] = [
  {
    id: '20',
    name: 'Starter Pack',
    price: 20.00,
    credits: 2000,
    bonusCredits: 0,
  },
  {
    id: '50',
    name: 'Pro Pack',
    price: 50.00,
    credits: 5000,
    bonusCredits: 500,
    isPopular: true,
  },
  {
    id: '100',
    name: 'Elite Pack',
    price: 100.00,
    credits: 10000,
    bonusCredits: 1500,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    isEnterprise: true,
    contactEmail: 'Sales@modulr.cloud',
  },
];

export function PurchaseCreditsModal({ isOpen, onClose }: PurchaseCreditsModalProps) {
  const { currency, formattedBalance } = useUserCredits();
  const { user } = useAuthStatus();
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [tiers, setTiers] = useState<CreditTier[]>([]);
  const [loadingTiers, setLoadingTiers] = useState(true);
  const [error, setError] = useState<string>('');

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

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

  // Load credit tiers from database
  useEffect(() => {
    const loadTiers = async () => {
      if (!isOpen) return; // Only load when modal is open
      
      setLoadingTiers(true);
      try {
        const { data: tiersList } = await client.models.CreditTier.list();
        
        if (tiersList && tiersList.length > 0) {
          const activeTiers = tiersList
            .filter(tier => tier.isActive !== false)
            .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
            .slice(0, 3)
            .map((tier, index) => ({
              id: tier.tierId || tier.id || '',
              name: tier.name || '',
              price: tier.basePrice || 0,
              credits: tier.baseCredits || 0,
              bonusCredits: tier.bonusCredits || 0,
              isPopular: index === 1 && tiersList.length >= 2,
              isOnSale: tier.isOnSale || false,
              salePrice: tier.salePrice || undefined,
              isEnterprise: false,
            }));

          const allTiers = [
            ...activeTiers,
            {
              id: 'enterprise',
              name: 'Enterprise',
              isEnterprise: true,
              contactEmail: 'Sales@modulr.cloud',
            },
          ];

          setTiers(allTiers);
        } else {
          setTiers(DEFAULT_TIERS);
        }
      } catch (err) {
        logger.error('Error loading credit tiers:', err);
        setTiers(DEFAULT_TIERS);
      } finally {
        setLoadingTiers(false);
      }
    };

    loadTiers();
  }, [isOpen]);

  const handlePurchase = async (tierId: string) => {
    if (!user?.username) {
      setError('You must be logged in to purchase credits');
      return;
    }

    const tier = tiers.find(t => t.id === tierId);
    
    // Handle Enterprise tier - open email client
    if (tier?.isEnterprise && tier.contactEmail) {
      window.location.href = `mailto:${tier.contactEmail}?subject=Enterprise Credit Package Inquiry`;
      return;
    }

    setSelectedTier(tierId);
    setError('');

    try {
      const result = await client.mutations.createStripeCheckoutLambda({
        tierId,
        userId: user.username,
      });

      if (result.errors && result.errors.length > 0) {
        throw new Error(result.errors.map(e => e.message).join(', '));
      }

      if (!result.data) {
        throw new Error('No data returned from server');
      }

      let checkoutData: { checkoutUrl?: string; sessionId?: string };
      
      if (typeof result.data === 'string') {
        const firstParse = JSON.parse(result.data);
        checkoutData = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
      } else {
        checkoutData = result.data as { checkoutUrl?: string; sessionId?: string };
      }

      if (!checkoutData?.checkoutUrl) {
        throw new Error('No checkout URL returned from server');
      }

      window.location.href = checkoutData.checkoutUrl;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create checkout session';
      logger.error('Stripe checkout error:', errorMessage);
      setError(errorMessage);
      setSelectedTier(null);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-left">
            <FontAwesomeIcon icon={faCoins} className="modal-icon" />
            <div>
              <h2>Purchase Credits</h2>
              <p className="modal-subtitle">Your current balance: {formattedBalance}</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {error && (
          <div className="modal-error" style={{ 
            padding: '12px', 
            margin: '0 24px', 
            backgroundColor: '#f44336', 
            color: 'white', 
            borderRadius: '4px',
            marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        <div className="modal-body">
          {loadingTiers ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'rgba(255, 255, 255, 0.6)' }}>
              Loading credit tiers...
            </div>
          ) : (
            <>
              <div className="tiers-grid">
            {tiers
              .filter(tier => !tier.isEnterprise)
              .map((tier) => {
                const totalCredits = (tier.credits || 0) + (tier.bonusCredits || 0);
                const displayPrice = tier.isOnSale && tier.salePrice 
                  ? tier.salePrice 
                  : tier.price;
                
                return (
                  <div
                    key={tier.id}
                    className={`tier-card ${tier.isPopular ? 'popular' : ''} ${selectedTier === tier.id ? 'selected' : ''}`}
                  >
                    {tier.isPopular && (
                      <div className="popular-badge">
                        <FontAwesomeIcon icon={faStar} />
                        <span>Most Popular</span>
                      </div>
                    )}
                    {tier.isOnSale && (
                      <div className="sale-badge">On Sale</div>
                    )}
                    
                    <div className="tier-header">
                      <h3>{tier.name}</h3>
                      <div className="tier-price">
                        {displayPrice ? formatCurrency(displayPrice, currency) : ''}
                      </div>
                    </div>

                    <div className="tier-credits">
                      <div className="credits-main">
                        <FontAwesomeIcon icon={faCoins} />
                        <span className="credits-amount">{(tier.credits || 0).toLocaleString()}</span>
                        <span className="credits-label">Credits</span>
                      </div>
                      {(tier.bonusCredits || 0) > 0 && (
                        <div className="credits-bonus">
                          <FontAwesomeIcon icon={faCheck} />
                          <span>+{(tier.bonusCredits || 0).toLocaleString()} Bonus</span>
                        </div>
                      )}
                    </div>

                    <div className="tier-total">
                      <span className="total-label">Total:</span>
                      <span className="total-credits">{totalCredits.toLocaleString()} Credits</span>
                    </div>

                    <button
                      className="tier-button"
                      onClick={() => handlePurchase(tier.id)}
                      disabled={selectedTier === tier.id}
                    >
                      {selectedTier === tier.id ? 'Processing...' : 'Purchase'}
                    </button>
                  </div>
                );
              })}
          </div>

          {tiers.find(tier => tier.isEnterprise) && (() => {
            const enterpriseTier = tiers.find(tier => tier.isEnterprise)!;
            const mailtoUrl = `mailto:${enterpriseTier.contactEmail}?subject=Enterprise%20Credit%20Package%20Inquiry`;
            return (
              <div className="enterprise-bar">
                <div className="enterprise-content">
                  <div className="enterprise-info">
                    <h3>{enterpriseTier.name}</h3>
                    <div className="enterprise-message">
                      <span>Please contact</span>
                      <a 
                        href={mailtoUrl}
                        className="enterprise-email"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {enterpriseTier.contactEmail}
                      </a>
                    </div>
                  </div>
                  <a
                    href={mailtoUrl}
                    className="enterprise-button"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Contact Sales
                  </a>
                </div>
              </div>
            );
          })()}
            </>
          )}
        </div>

        <div className="modal-footer">
          <p className="modal-note">
            <FontAwesomeIcon icon={faCoins} />
            <span>Credits never expire. Use them for teleoperation sessions.</span>
          </p>
          <p className="modal-note payment-note">
            <span>Secure checkout via Stripe. Pay with card or cryptocurrency.</span>
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

