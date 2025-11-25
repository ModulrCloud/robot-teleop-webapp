// src/config/signaling.ts
export function getSignalingUrl(): string {
  // 1) Environment override (CI / production)
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (envUrl && envUrl.trim() !== '') return envUrl;

  // 2) Local dev fallback
  if (window.location.hostname === 'localhost') {
    return 'ws://192.168.132.19:8765';
  }

  // 3) Derive from current website URL
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${proto}//${host}/ws`;
}
