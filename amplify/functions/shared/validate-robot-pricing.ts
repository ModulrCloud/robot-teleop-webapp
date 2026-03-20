/**
 * Server-side bounds for robot pricing. GraphQL already types these as numbers;
 * this blocks NaN/Infinity, negatives, and absurd magnitudes (no injection into Dynamo — values are numeric types only).
 *
 * Keep `MAX_FREE_SESSION_SECONDS` aligned with `src/utils/freeSessionLimit.ts` → `MAX_FREE_SESSION_SECONDS_CAP`.
 */
export const MAX_HOURLY_RATE_CREDITS = 1_000_000_000_000;

export function assertFiniteHourlyRateCredits(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_HOURLY_RATE_CREDITS) {
    throw new Error(
      `Invalid hourlyRateCredits: must be a finite number from 0 to ${MAX_HOURLY_RATE_CREDITS}`,
    );
  }
  return n;
}

/** Cap free-session length to one week (seconds). */
export const MAX_FREE_SESSION_SECONDS = 604800;

export function assertPositiveIntMaxFreeSessionSeconds(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > MAX_FREE_SESSION_SECONDS) {
    throw new Error(
      `Invalid maxFreeSessionSeconds: must be a positive integer up to ${MAX_FREE_SESSION_SECONDS}`,
    );
  }
  return n;
}
