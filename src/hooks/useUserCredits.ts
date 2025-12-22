import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import { useAuthStatus } from './useAuthStatus';
import { getCredits, formatCreditsAsCurrencySync, fetchExchangeRates, type CurrencyCode } from '../utils/credits';

const client = generateClient<Schema>();

interface UserCreditsData {
  credits: number;
  currency: CurrencyCode;
  formattedBalance: string;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to fetch and manage user credits
 * Automatically fetches user's preferred currency and displays balance
 */
export function useUserCredits(): UserCreditsData {
  const { user } = useAuthStatus();
  const [credits, setCredits] = useState<number>(0);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [formattedBalance, setFormattedBalance] = useState<string>('$0.00');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | undefined>();

  // Fetch exchange rates on mount
  useEffect(() => {
    fetchExchangeRates().then(rates => {
      setExchangeRates(rates);
    }).catch(err => {
      console.warn('Failed to fetch exchange rates:', err);
    });
  }, []);

  // Fetch user credits and currency preference
  useEffect(() => {
    const loadCredits = async () => {
      if (!user?.username) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Fetch user credits
        const { data: userCreditsList } = await client.models.UserCredits.list({
          filter: { userId: { eq: user.username } },
        });

        const userCredits = userCreditsList?.[0];
        const creditsValue = getCredits(userCredits?.credits);
        setCredits(creditsValue);

        // Fetch user's preferred currency from Client model
        const { data: clients } = await client.models.Client.list({
          filter: { cognitoUsername: { eq: user.username } },
        });

        const clientRecord = clients?.[0];
        const preferredCurrency = (clientRecord?.preferredCurrency || 'USD').toUpperCase() as CurrencyCode;
        setCurrency(preferredCurrency);

        // Format balance with currency conversion
        const formatted = formatCreditsAsCurrencySync(creditsValue, preferredCurrency, exchangeRates);
        setFormattedBalance(formatted);
      } catch (err) {
        console.error('Error loading user credits:', err);
        setError('Failed to load credits');
        setFormattedBalance('$0.00');
      } finally {
        setLoading(false);
      }
    };

    loadCredits();
  }, [user?.username, exchangeRates]);

  // Update formatted balance when credits or currency changes
  useEffect(() => {
    if (!loading) {
      const formatted = formatCreditsAsCurrencySync(credits, currency, exchangeRates);
      setFormattedBalance(formatted);
    }
  }, [credits, currency, exchangeRates, loading]);

  return {
    credits,
    currency,
    formattedBalance,
    loading,
    error,
  };
}

