import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTimes,
  faDollarSign,
  faCoins,
  faCalendarAlt,
  faBolt,
} from '@fortawesome/free-solid-svg-icons';
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import { logger } from '../utils/logger';
import './PayoutPreferencesModal.css';

const client = generateClient<Schema>();

export type PayoutType = '' | 'fiat' | 'mdr';

interface PayoutPreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  partnerId: string;
  preferredPayoutType: PayoutType | null | undefined;
  mdrPublicKey: string | null | undefined;
  onSaved?: () => void;
}

export function PayoutPreferencesModal({
  isOpen,
  onClose,
  partnerId,
  preferredPayoutType,
  mdrPublicKey,
  onSaved,
}: PayoutPreferencesModalProps) {
  const [selected, setSelected] = useState<PayoutType>(preferredPayoutType || '');
  const [mdrKeyTease, setMdrKeyTease] = useState(mdrPublicKey || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    setSelected(preferredPayoutType || '');
    setMdrKeyTease(mdrPublicKey || '');
  }, [isOpen, preferredPayoutType, mdrPublicKey]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await client.models.Partner.update({
        id: partnerId,
        preferredPayoutType: selected || undefined,
        mdrPublicKey: selected === 'mdr' ? (mdrKeyTease || undefined) : undefined,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      logger.error('PayoutPreferencesModal save failed', err);
      setError(err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="payout-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="payout-modal-title">
      <div className="payout-modal-content" onClick={e => e.stopPropagation()}>
        <div className="payout-modal-header">
          <h2 id="payout-modal-title">How you get paid</h2>
          <button type="button" className="payout-modal-close" onClick={onClose} aria-label="Close">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
        <p className="payout-modal-subtitle">Choose your preferred payout method. You can change this anytime.</p>

        <div className="payout-options">
          <label className={`payout-option ${selected === '' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="payoutType"
              value=""
              checked={selected === ''}
              onChange={() => setSelected('')}
            />
            <span className="payout-option-title">Not set</span>
            <span className="payout-option-desc">Choose how you’d like to receive earnings when you’re ready.</span>
          </label>

          <label className={`payout-option ${selected === 'fiat' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="payoutType"
              value="fiat"
              checked={selected === 'fiat'}
              onChange={() => setSelected('fiat')}
            />
            <span className="payout-option-icon"><FontAwesomeIcon icon={faDollarSign} /></span>
            <span className="payout-option-title">Fiat (Stripe)</span>
            <ul className="payout-option-benefits">
              <li><FontAwesomeIcon icon={faCalendarAlt} /> Monthly payouts</li>
              <li>Minimum balance $100 USD to receive payout</li>
              <li>Secure, traditional banking</li>
            </ul>
          </label>

          <label className={`payout-option payout-option-mdr ${selected === 'mdr' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="payoutType"
              value="mdr"
              checked={selected === 'mdr'}
              onChange={() => setSelected('mdr')}
            />
            <span className="payout-option-icon"><FontAwesomeIcon icon={faCoins} /></span>
            <span className="payout-option-title">MDR (crypto)</span>
            <span className="payout-option-badge">Coming soon</span>
            <ul className="payout-option-benefits">
              <li><FontAwesomeIcon icon={faBolt} /> Weekly payouts (eventually daily)</li>
              <li>No minimum — get paid as you earn</li>
              <li>Our native token; wallet coming soon</li>
            </ul>
            <div className="payout-mdr-key-tease">
              <label className="payout-mdr-key-label">Wallet public key</label>
              <input
                type="text"
                className="payout-mdr-key-input"
                placeholder="Coming soon — enter your wallet public key when MDR is live"
                value={mdrKeyTease}
                onChange={e => setMdrKeyTease(e.target.value)}
                disabled
                aria-label="MDR wallet public key (coming soon)"
              />
            </div>
          </label>
        </div>

        {error && <p className="payout-modal-error" role="alert">{error}</p>}
        <div className="payout-modal-actions">
          <button type="button" className="payout-modal-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="payout-modal-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
