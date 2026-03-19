/** Max minutes we allow partners to set for a capped free session (8 hours). */
export const MAX_FREE_SESSION_MINUTES = 480;

/** Empty / invalid input → unlimited (no Dynamo attribute). */
export function freeMinutesInputToSeconds(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const m = parseInt(t, 10);
  if (!Number.isFinite(m) || m < 1) return null;
  return Math.min(MAX_FREE_SESSION_MINUTES, m) * 60;
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
