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
import './PurchaseCreditsModal.css';

interface PurchaseCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CreditTier {
  id: string;
  name: string;
  price: number;
  credits: number;
  bonusCredits: number;
  isPopular?: boolean;
  isOnSale?: boolean;
  salePrice?: number;
}

// Default tiers (will be replaced with dynamic data from CreditTier model later)
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
];

export function PurchaseCreditsModal({ isOpen, onClose }: PurchaseCreditsModalProps) {
  const { currency, formattedBalance } = useUserCredits();
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [tiers] = useState<CreditTier[]>(DEFAULT_TIERS);

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

  const handlePurchase = (tierId: string) => {
    setSelectedTier(tierId);
    // TODO: Integrate with Stripe checkout
    console.log('Purchase tier:', tierId);
    // For now, just show a message
    setTimeout(() => {
      alert('Stripe integration coming soon! This will redirect to Stripe checkout.');
      setSelectedTier(null);
    }, 100);
  };

  if (!isOpen) return null;

  // Render modal using portal to body to avoid z-index/overflow issues
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
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

        {/* Tiers Grid */}
        <div className="modal-body">
          <div className="tiers-grid">
            {tiers.map((tier) => {
              const totalCredits = tier.credits + tier.bonusCredits;
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
                      {formatCurrency(displayPrice, currency)}
                    </div>
                  </div>

                  <div className="tier-credits">
                    <div className="credits-main">
                      <FontAwesomeIcon icon={faCoins} />
                      <span className="credits-amount">{tier.credits.toLocaleString()}</span>
                      <span className="credits-label">Credits</span>
                    </div>
                    {tier.bonusCredits > 0 && (
                      <div className="credits-bonus">
                        <FontAwesomeIcon icon={faCheck} />
                        <span>+{tier.bonusCredits.toLocaleString()} Bonus</span>
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
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <p className="modal-note">
            <FontAwesomeIcon icon={faCoins} />
            <span>Credits never expire. Use them for teleoperation sessions.</span>
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

