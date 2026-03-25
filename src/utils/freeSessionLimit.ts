/**
 * Platform max for a capped free session. Must stay in sync with
 * `amplify/functions/shared/validate-robot-pricing.ts` → `MAX_FREE_SESSION_SECONDS`.
 */
export const MAX_FREE_SESSION_SECONDS_CAP = 604800;

export const MAX_FREE_SESSION_MINUTES = MAX_FREE_SESSION_SECONDS_CAP / 60;

export const FREE_SESSION_CAP_VALIDATION_ERROR = `Enter whole minutes from 1 to ${MAX_FREE_SESSION_MINUTES}, or leave empty for no limit.`;

/** Strip non-digits so the field cannot hold letters/symbols. */
export function sanitizeFreeSessionMinutesTyping(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Parse partner input when saving. Empty → unlimited (`seconds: null`).
 * Non-empty but not a positive whole minute value → error (do not treat as unlimited).
 */
export function resolveFreeSessionCapForSave(raw: string):
  | { ok: true; seconds: null }
  | { ok: true; seconds: number }
  | { ok: false; message: string } {
  const t = raw.trim();
  if (!t) return { ok: true, seconds: null };
  if (!/^\d+$/.test(t)) {
    return { ok: false, message: FREE_SESSION_CAP_VALIDATION_ERROR };
  }
  const m = parseInt(t, 10);
  if (!Number.isFinite(m) || m < 1) {
    return { ok: false, message: FREE_SESSION_CAP_VALIDATION_ERROR };
  }
  const clamped = Math.min(MAX_FREE_SESSION_MINUTES, m);
  return { ok: true, seconds: clamped * 60 };
}

/** Empty / invalid → null. Prefer {@link resolveFreeSessionCapForSave} when saving so invalid input is not treated as unlimited. */
export function freeMinutesInputToSeconds(raw: string): number | null {
  const r = resolveFreeSessionCapForSave(raw);
  if (!r.ok) return null;
  return r.seconds;
}

export function secondsToFreeMinutesInput(seconds: number | undefined | null): string {
  if (seconds == null || seconds <= 0) return '';
  return String(Math.max(1, Math.round(seconds / 60)));
}

export function freeRobotCardLabel(maxFreeSeconds?: number | null): string {
  if (maxFreeSeconds != null && maxFreeSeconds > 0) {
    return `Free · max ${Math.round(maxFreeSeconds / 60)} min`;
  }
  return 'Free';
}

/** Upper bound for trial length in minutes (align with {@link MAX_FREE_SESSION_MINUTES}). */
export const MAX_TRIAL_MINUTES = MAX_FREE_SESSION_MINUTES;

export const TRIAL_MINUTES_VALIDATION_ERROR = `Enter whole minutes from 1 to ${MAX_TRIAL_MINUTES}, or leave empty for no trial.`;

/** Parse paid-robot trial length. Empty → no trial (`seconds: null`). */
export function resolveTrialMinutesForSave(raw: string):
  | { ok: true; seconds: null }
  | { ok: true; seconds: number }
  | { ok: false; message: string } {
  const t = raw.trim();
  if (!t) return { ok: true, seconds: null };
  if (!/^\d+$/.test(t)) {
    return { ok: false, message: TRIAL_MINUTES_VALIDATION_ERROR };
  }
  const m = parseInt(t, 10);
  if (!Number.isFinite(m) || m < 1) {
    return { ok: false, message: TRIAL_MINUTES_VALIDATION_ERROR };
  }
  const clamped = Math.min(MAX_TRIAL_MINUTES, m);
  return { ok: true, seconds: clamped * 60 };
}

export function secondsToTrialMinutesInput(seconds: number | undefined | null): string {
  if (seconds == null || seconds <= 0) return '';
  return String(Math.max(1, Math.round(seconds / 60)));
}
