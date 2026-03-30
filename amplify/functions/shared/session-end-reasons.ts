/**
 * Stored on Session.endReason (orthogonal to status) for support/analytics.
 * Use these literals only — do not repurpose status strings as reasons.
 */
export const SESSION_END_REASON = {
  USER_SESSIONS_CLEARED: "user_sessions_cleared",
  WEBSOCKET_DISCONNECT: "websocket_disconnect",
  STALE_CONNECTION_CLEANUP: "stale_connection_cleanup",
  FREE_CAP_EXCEEDED: "free_cap_exceeded",
  INSUFFICIENT_FUNDS: "insufficient_funds",
  /** process-session-payment free-robot path when no prior reason was set */
  LEGACY_FREE_PAYMENT_CLOSE: "legacy_free_payment_close",
} as const;
