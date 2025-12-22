/**
 * Utility functions for handling credits safely
 */

/**
 * Safely gets credits value, handling null, undefined, NaN, or invalid values
 * @param userCredits - The credits value from database (can be null, undefined, number, etc.)
 * @returns A valid number (0 if invalid)
 */
export function getCredits(userCredits: number | null | undefined): number {
  // Handle null, undefined, NaN, or non-number values
  if (userCredits === null || userCredits === undefined) {
    return 0;
  }
  
  const credits = Number(userCredits);
  
  // If not a valid number, return 0
  if (isNaN(credits) || !isFinite(credits)) {
    return 0;
  }
  
  // Ensure it's a non-negative integer
  return Math.max(0, Math.floor(credits));
}

/**
 * Currency conversion utilities
 * Converts credits to user's preferred currency for display
 * 
 * Credit conversion: $20 USD = 2000 credits (1 credit = $0.01 USD)
 */

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY';

export interface CurrencyInfo {
  code: CurrencyCode;
  symbol: string;
  name: string;
}

// Currency information (symbols and names)
const CURRENCY_INFO: Record<CurrencyCode, CurrencyInfo> = {
  USD: { code: 'USD', symbol: '$', name: 'US Dollar' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro' },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound' },
  CAD: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
};

// Exchange rate cache (refreshed periodically)
let exchangeRateCache: {
  rates: Record<string, number>;
  timestamp: number;
} | null = null;

const EXCHANGE_RATE_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Fetches real-time exchange rates from exchangerate-api.com (free tier)
 * Falls back to cached rates if API fails
 */
export async function fetchExchangeRates(): Promise<Record<string, number>> {
  // Check cache first
  if (exchangeRateCache && Date.now() - exchangeRateCache.timestamp < EXCHANGE_RATE_CACHE_DURATION) {
    return exchangeRateCache.rates;
  }

  try {
    // Using exchangerate-api.com free tier (no API key needed for basic usage)
    // Alternative: Use a Lambda function to fetch rates server-side
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    
    if (!response.ok) {
      throw new Error('Failed to fetch exchange rates');
    }
    
    const data = await response.json();
    const rates = data.rates || {};
    
    // Cache the rates
    exchangeRateCache = {
      rates,
      timestamp: Date.now(),
    };
    
    return rates;
  } catch (error) {
    console.warn('Failed to fetch exchange rates, using cached or default rates:', error);
    
    // Fallback to cached rates if available
    if (exchangeRateCache) {
      return exchangeRateCache.rates;
    }
    
    // Last resort: return default rates (will be inaccurate but won't break)
    return {
      USD: 1.0,
      EUR: 0.92,
      GBP: 0.79,
      CAD: 1.36,
      AUD: 1.52,
      JPY: 150.0,
    };
  }
}

/**
 * Gets currency information
 */
export function getCurrencyInfo(currencyCode: CurrencyCode | string | null | undefined): CurrencyInfo {
  const code = (currencyCode || 'USD').toUpperCase() as CurrencyCode;
  return CURRENCY_INFO[code] || CURRENCY_INFO.USD;
}

/**
 * Converts credits to currency value using real-time exchange rates
 * Conversion: 1 credit = $0.01 USD (so $20 = 2000 credits)
 * @param credits - Number of credits
 * @param currencyCode - User's preferred currency
 * @returns Promise<number> Currency value
 */
export async function creditsToCurrency(
  credits: number,
  currencyCode: CurrencyCode | string | null | undefined = 'USD'
): Promise<number> {
  const safeCredits = getCredits(credits);
  const code = (currencyCode || 'USD').toUpperCase() as CurrencyCode;
  
  // If USD, direct conversion
  if (code === 'USD') {
    return safeCredits * 0.01; // 1 credit = $0.01
  }
  
  // For other currencies, fetch exchange rate
  const rates = await fetchExchangeRates();
  const usdValue = safeCredits * 0.01; // Convert credits to USD first
  const exchangeRate = rates[code] || 1.0;
  
  // Convert USD to target currency
  return usdValue * exchangeRate;
}

/**
 * Synchronous version that uses cached rates (for immediate display)
 * Falls back to approximate rates if cache is empty
 */
export function creditsToCurrencySync(
  credits: number,
  currencyCode: CurrencyCode | string | null | undefined = 'USD',
  exchangeRates?: Record<string, number>
): number {
  const safeCredits = getCredits(credits);
  const code = (currencyCode || 'USD').toUpperCase() as CurrencyCode;
  
  // If USD, direct conversion
  if (code === 'USD') {
    return safeCredits * 0.01; // 1 credit = $0.01
  }
  
  // Use provided rates or cached rates
  const rates = exchangeRates || exchangeRateCache?.rates || {
    EUR: 0.92,
    GBP: 0.79,
    CAD: 1.36,
    AUD: 1.52,
    JPY: 150.0,
  };
  
  const usdValue = safeCredits * 0.01;
  const exchangeRate = rates[code] || 1.0;
  
  return usdValue * exchangeRate;
}

/**
 * Formats currency value for display
 * @param value - Currency value
 * @param currencyCode - Currency code
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string (e.g., "$25.00" or "€22.50")
 */
export function formatCurrency(
  value: number,
  currencyCode: CurrencyCode | string | null | undefined = 'USD',
  decimals: number = 2
): string {
  const currency = getCurrencyInfo(currencyCode);
  const formattedValue = value.toFixed(decimals);
  
  // For JPY, no decimals
  if (currencyCode === 'JPY') {
    return `${currency.symbol}${Math.round(value).toLocaleString()}`;
  }
  
  return `${currency.symbol}${parseFloat(formattedValue).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Formats credits for display (with currency conversion) - async version
 * @param credits - Number of credits
 * @param currencyCode - User's preferred currency
 * @returns Promise<string> Formatted string (e.g., "$25.00" or "€22.50")
 */
export async function formatCreditsAsCurrency(
  credits: number | null | undefined,
  currencyCode: CurrencyCode | string | null | undefined = 'USD'
): Promise<string> {
  const safeCredits = getCredits(credits);
  const currencyValue = await creditsToCurrency(safeCredits, currencyCode);
  return formatCurrency(currencyValue, currencyCode);
}

/**
 * Formats credits for display (with currency conversion) - sync version (uses cached rates)
 * @param credits - Number of credits
 * @param currencyCode - User's preferred currency
 * @param exchangeRates - Optional exchange rates to use
 * @returns Formatted string (e.g., "$25.00" or "€22.50")
 */
export function formatCreditsAsCurrencySync(
  credits: number | null | undefined,
  currencyCode: CurrencyCode | string | null | undefined = 'USD',
  exchangeRates?: Record<string, number>
): string {
  const safeCredits = getCredits(credits);
  const currencyValue = creditsToCurrencySync(safeCredits, currencyCode, exchangeRates);
  return formatCurrency(currencyValue, currencyCode);
}

