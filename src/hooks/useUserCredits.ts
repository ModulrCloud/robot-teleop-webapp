import { useState, useEffect, useCallback } from 'react';
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
  refreshCredits: () => Promise<void>;
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

  const loadCredits = useCallback(async () => {
    if (!user?.username) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch user credits using Lambda query (uses secondary index directly, same as addCredits)
      let userCredits;
      try {
        // Use the Lambda query that uses the secondary index directly (same approach as addCredits)
        const result = await client.queries.getUserCreditsLambda();
        
        // Parse the JSON response
        let queryData: { success?: boolean; userCredits?: any };
        if (typeof result.data === 'string') {
          try {
            const firstParse = JSON.parse(result.data);
            if (typeof firstParse === 'string') {
              queryData = JSON.parse(firstParse);
            } else {
              queryData = firstParse;
            }
          } catch (e) {
            queryData = { success: false };
          }
        } else {
          queryData = result.data as typeof queryData;
        }
        
        userCredits = queryData.userCredits || null;
      } catch (err) {
        userCredits = null;
      }
      
      const creditsValue = getCredits(userCredits?.credits);
      setCredits(creditsValue);

      // Fetch user's preferred currency - check Partner model first (for partners), then Client model (for clients)
      let preferredCurrency: CurrencyCode | null = null;
      
      try {
        // Check if user is a partner first
        const { data: partners } = await client.models.Partner.list({
          filter: { cognitoUsername: { eq: user.username } },
        });

        if (partners && partners.length > 0) {
          // User is a partner - use Partner record's currency preference
          preferredCurrency = partners[0]?.preferredCurrency 
            ? (partners[0].preferredCurrency.toUpperCase() as CurrencyCode)
            : null;
        } else {
          // User is a client - check Client record
          const { data: clients } = await client.models.Client.list({
            filter: { cognitoUsername: { eq: user.username } },
          });
          const clientRecord = clients?.[0];
          preferredCurrency = clientRecord?.preferredCurrency 
            ? (clientRecord.preferredCurrency.toUpperCase() as CurrencyCode)
            : null;
        }
      } catch (currencyError) {
        // If currency lookup fails, continue with null (will show "?" fallback)
        console.warn('Failed to load currency preference:', currencyError);
      }

      setCurrency(preferredCurrency || 'USD'); // Fallback to USD for state, but pass null to formatter for "?" display

      // Format balance with currency conversion
      // Pass null if currency couldn't be loaded to trigger "?" fallback
      const formatted = formatCreditsAsCurrencySync(creditsValue, preferredCurrency, exchangeRates);
      setFormattedBalance(formatted);
    } catch (err) {
      setError('Failed to load credits');
      setFormattedBalance('$0.00');
    } finally {
      setLoading(false);
    }
  }, [user?.username, exchangeRates]);

  // Fetch user credits and currency preference
  useEffect(() => {
    loadCredits();
  }, [loadCredits]);

  // Listen for credit update events (e.g., when admin adjusts credits for current user)
  useEffect(() => {
    const handleCreditsUpdate = () => {
      console.log("🔄 Custom event 'creditsUpdated' received, refreshing credits...");
      loadCredits();
    };

    window.addEventListener('creditsUpdated', handleCreditsUpdate);

    return () => {
      window.removeEventListener('creditsUpdated', handleCreditsUpdate);
    };
  }, [loadCredits]); // Dependency on loadCredits to ensure it's the latest version

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
    refreshCredits: loadCredits,
  };
}

