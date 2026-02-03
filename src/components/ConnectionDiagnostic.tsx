import { useState, useCallback } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
  faTimesCircle,
  faSpinner,
  faPlay,
  faCopy,
  faExclamationTriangle,
  faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";
import { logger } from "../utils/logger";
import "./ConnectionDiagnostic.css";

import outputs from "../../amplify_outputs.json";

const client = generateClient<Schema>();

const WSS_TIMEOUT_MS = 8000;
const WEBRTC_TIMEOUT_MS = 15000;
const STUN_GATHERING_TIMEOUT_MS = 5000;
const STUN_HOST = "stun.l.google.com";
const STUN_PORT = 19302;
const DEFAULT_STUN = { urls: `stun:${STUN_HOST}:${STUN_PORT}` };

/** Wait for ICE gathering to complete (or timeout) so SDP includes candidates. Timeout avoids hanging when STUN is blocked. */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = STUN_GATHERING_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      pc.onicegatheringstatechange = null;
      resolve();
    }, timeoutMs);
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") {
        pc.onicegatheringstatechange = null;
        clearTimeout(t);
        resolve();
      }
    };
    pc.onicegatheringstatechange = onStateChange;
  });
}

export type CheckStatus = "idle" | "running" | "ok" | "fail";

export interface DiagnosticResult {
  api: { status: CheckStatus; message?: string; durationMs?: number };
  backend: { status: CheckStatus; message?: string; durationMs?: number };
  wss: { status: CheckStatus; message?: string; durationMs?: number };
  stun: { status: CheckStatus; message?: string; durationMs?: number };
  turn: { status: CheckStatus; message?: string; durationMs?: number };
  webrtc: {
    status: CheckStatus;
    message?: string;
    durationMs?: number;
    pathType?: "direct" | "relay" | "unknown";
  };
}

function getWsUrl(): string {
  if (outputs?.custom?.signaling?.websocketUrl) return outputs.custom.signaling.websocketUrl;
  return (import.meta as unknown as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL ?? "";
}

function getTurnUrl(): string {
  const env = import.meta as unknown as { env?: { VITE_TURN_URL?: string } };
  const custom = outputs?.custom?.signaling as { turnUrl?: string } | undefined;
  return custom?.turnUrl ?? env?.env?.VITE_TURN_URL ?? "";
}

export function ConnectionDiagnostic() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<DiagnosticResult>({
    api: { status: "idle" },
    backend: { status: "idle" },
    wss: { status: "idle" },
    stun: { status: "idle" },
    turn: { status: "idle" },
    webrtc: { status: "idle" },
  });
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const runApiCheck = useCallback(async (): Promise<{ status: CheckStatus; message?: string; durationMs?: number }> => {
    const start = Date.now();
    try {
      await fetchAuthSession();
      return { status: "ok", durationMs: Date.now() - start };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed";
      logger.error("Connection diagnostic API check failed:", err);
      return { status: "fail", message: msg, durationMs: Date.now() - start };
    }
  }, []);

  const runBackendCheck = useCallback(async (): Promise<{ status: CheckStatus; message?: string; durationMs?: number }> => {
    const start = Date.now();
    try {
      await client.models.PlatformSettings.list({ limit: 1 });
      return { status: "ok", durationMs: Date.now() - start };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Backend/DB request failed";
      logger.error("Connection diagnostic backend check failed:", err);
      return { status: "fail", message: msg, durationMs: Date.now() - start };
    }
  }, []);

  const runWssCheck = useCallback(async (wsUrl: string): Promise<{ status: CheckStatus; message?: string; durationMs?: number }> => {
    if (!wsUrl) {
      return { status: "fail", message: "No WebSocket URL configured (missing amplify_outputs or VITE_WS_URL)" };
    }
    // Use same auth as teleop: signaling server expects JWT in query string (useWebRTC does this)
    let urlToUse = wsUrl;
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (token) urlToUse = `${wsUrl}?token=${encodeURIComponent(token)}`;
    } catch (e) {
      logger.warn("[ConnectionDiagnostic] No auth token for WSS check, connection may be rejected:", e);
    }
    const start = Date.now();
    return new Promise((resolve) => {
      let resolved = false;
      let ws: WebSocket;

      const finish = (status: CheckStatus, message?: string) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        try {
          ws?.close();
        } catch {
          // ignore
        }
        resolve({ status, message, durationMs: Date.now() - start });
      };

      const timeout = setTimeout(() => {
        finish("fail", "Connection timed out");
      }, WSS_TIMEOUT_MS);

      try {
        ws = new WebSocket(urlToUse);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create WebSocket";
        resolve({ status: "fail", message: msg, durationMs: Date.now() - start });
        return;
      }

      ws.onopen = () => finish("ok");
      ws.onerror = () => finish("fail", "WebSocket error");
      ws.onclose = (ev) => {
        if (!resolved) {
          finish("fail", ev.reason || `Closed (code ${ev.code})`);
        }
      };
    });
  }, []);

  const runStunCheck = useCallback(async (): Promise<{ status: CheckStatus; message?: string; durationMs?: number }> => {
    const start = Date.now();
    const pc = new RTCPeerConnection({ iceServers: [DEFAULT_STUN] });
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc, 4000);
      const stats = await pc.getStats();
      let hasSrflxOrRelay = false;
      stats.forEach((report) => {
        if (report.type === "local-candidate" || report.type === "remote-candidate") {
          const type = (report as RTCStats & { candidateType?: string }).candidateType;
          if (type === "srflx" || type === "relay") hasSrflxOrRelay = true;
        }
      });
      pc.close();
      return {
        status: "ok",
        durationMs: Date.now() - start,
        message: hasSrflxOrRelay
          ? `Reachable (UDP ${STUN_PORT})`
          : `No srflx — port ${STUN_PORT} may be blocked or server unreachable`,
      };
    } catch (err) {
      try {
        pc.close();
      } catch {
        // ignore
      }
      logger.error("Connection diagnostic STUN check failed:", err);
      return {
        status: "fail",
        message: `Port ${STUN_PORT} unreachable (firewall, UDP block, or server down)`,
        durationMs: Date.now() - start,
      };
    }
  }, []);

  const runTurnCheck = useCallback(async (): Promise<{ status: CheckStatus; message?: string; durationMs?: number }> => {
    const turnUrl = getTurnUrl();
    const start = Date.now();
    if (!turnUrl) {
      return { status: "ok", message: "Not configured", durationMs: 0 };
    }
    const env = import.meta as unknown as { env?: { VITE_TURN_USERNAME?: string; VITE_TURN_CREDENTIAL?: string } };
    const custom = outputs?.custom?.signaling as { turnUsername?: string; turnCredential?: string } | undefined;
    const username = custom?.turnUsername ?? env?.env?.VITE_TURN_USERNAME ?? undefined;
    const credential = custom?.turnCredential ?? env?.env?.VITE_TURN_CREDENTIAL ?? undefined;
    const iceServers: RTCIceServer[] =
      username != null && credential != null
        ? [{ urls: turnUrl, username, credential }]
        : [{ urls: turnUrl }];
    const pc = new RTCPeerConnection({ iceServers });
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc, 6000);
      const stats = await pc.getStats();
      let hasRelay = false;
      stats.forEach((report) => {
        if (report.type === "local-candidate" || report.type === "remote-candidate") {
          const type = (report as RTCStats & { candidateType?: string }).candidateType;
          if (type === "relay") hasRelay = true;
        }
      });
      pc.close();
      return {
        status: "ok",
        durationMs: Date.now() - start,
        message: hasRelay ? "Reachable (relay)" : "No relay (TURN may be blocked or misconfigured)",
      };
    } catch (err) {
      try {
        pc.close();
      } catch {
        // ignore
      }
      const msg = err instanceof Error ? err.message : "TURN check failed";
      logger.error("Connection diagnostic TURN check failed:", err);
      return { status: "fail", message: msg, durationMs: Date.now() - start };
    }
  }, []);

  const runWebRtcCheck = useCallback(async (): Promise<{
    status: CheckStatus;
    message?: string;
    durationMs?: number;
    pathType?: "direct" | "relay" | "unknown";
  }> => {
    const start = Date.now();
    const pc1 = new RTCPeerConnection({ iceServers: [DEFAULT_STUN] });
    const pc2 = new RTCPeerConnection({ iceServers: [DEFAULT_STUN] });

    const cleanup = () => {
      try {
        pc1.close();
        pc2.close();
      } catch {
        // ignore
      }
    };

    let didResolve = false;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        finish("fail", { message: "WebRTC connection timed out" });
      }, WEBRTC_TIMEOUT_MS);

      const finish = (
        status: "ok" | "fail",
        opts: { message?: string; pathType?: "direct" | "relay" | "unknown" } = {}
      ) => {
        if (didResolve) return;
        didResolve = true;
        clearTimeout(timeout);
        cleanup();
        resolve({
          status,
          message: opts.message,
          durationMs: Date.now() - start,
          pathType: opts.pathType,
        });
      };

      const resolveWithStats = () => {
        pc1.getStats().then((stats) => {
          let pathType: "direct" | "relay" | "unknown" = "unknown";
          stats.forEach((report) => {
            if (report.type === "candidate-pair" && report.state === "succeeded") {
              const local = stats.get(report.localCandidateId);
              const remote = stats.get(report.remoteCandidateId);
              const localType = local?.candidateType;
              const remoteType = remote?.candidateType;
              if (localType === "relay" || remoteType === "relay") pathType = "relay";
              else if (localType === "host" && remoteType === "host") pathType = "direct";
              else if (pathType === "unknown") pathType = "direct";
            }
          });
          finish("ok", { pathType });
        }).catch(() => {
          finish("ok", { pathType: "unknown" });
        });
      };

      pc1.oniceconnectionstatechange = () => {
        if (pc1.iceConnectionState === "connected" || pc1.iceConnectionState === "completed") {
          resolveWithStats();
        }
      };

      pc1.onconnectionstatechange = () => {
        if (pc1.connectionState === "failed") {
          finish("fail", { message: "WebRTC connection failed" });
        }
      };

      const dc = pc1.createDataChannel("diagnostic");
      dc.onopen = () => resolveWithStats();

      // Wait for ICE gathering so SDP includes candidates; otherwise loopback often never connects
      pc1
        .createOffer()
        .then((offer) => pc1.setLocalDescription(offer))
        .then(() => waitForIceGathering(pc1))
        .then(() => {
          if (!pc1.localDescription) return;
          return pc2.setRemoteDescription(pc1.localDescription);
        })
        .then(() => pc2.createAnswer())
        .then((answer) => pc2.setLocalDescription(answer))
        .then(() => waitForIceGathering(pc2))
        .then(() => {
          if (!pc2.localDescription) return;
          return pc1.setRemoteDescription(pc2.localDescription);
        })
        .catch((err) => {
          clearTimeout(timeout);
          cleanup();
          didResolve = true;
          logger.error("Connection diagnostic WebRTC check failed:", err);
          resolve({
            status: "fail",
            message: err instanceof Error ? err.message : "WebRTC setup failed",
            durationMs: Date.now() - start,
          });
        });
    });
  }, []);

  const runDiagnostic = useCallback(() => {
    setRunning(true);
    setResults({
      api: { status: "running" },
      backend: { status: "running" },
      wss: { status: "running" },
      stun: { status: "running" },
      turn: { status: "running" },
      webrtc: { status: "running" },
    });

    const wsUrl = getWsUrl();
    let completed = 0;
    const onSettle = () => {
      completed += 1;
      if (completed === 6) setRunning(false);
    };

    // Run all six in parallel; update results as each completes (streaming)
    runApiCheck()
      .then((apiResult) => setResults((prev) => ({ ...prev, api: apiResult })))
      .catch((err) => {
        logger.error("Connection diagnostic API check failed:", err);
        setResults((prev) => ({ ...prev, api: { status: "fail", message: "Unexpected error" } }));
      })
      .finally(onSettle);

    runBackendCheck()
      .then((backendResult) => setResults((prev) => ({ ...prev, backend: backendResult })))
      .catch((err) => {
        logger.error("Connection diagnostic backend check failed:", err);
        setResults((prev) => ({ ...prev, backend: { status: "fail", message: "Unexpected error" } }));
      })
      .finally(onSettle);

    runWssCheck(wsUrl)
      .then((wssResult) => setResults((prev) => ({ ...prev, wss: wssResult })))
      .catch((err) => {
        logger.error("Connection diagnostic WSS check failed:", err);
        setResults((prev) => ({ ...prev, wss: { status: "fail", message: "Unexpected error" } }));
      })
      .finally(onSettle);

    runStunCheck()
      .then((stunResult) => setResults((prev) => ({ ...prev, stun: stunResult })))
      .catch((err) => {
        logger.error("Connection diagnostic STUN check failed:", err);
        setResults((prev) => ({ ...prev, stun: { status: "fail", message: "Unexpected error" } }));
      })
      .finally(onSettle);

    runTurnCheck()
      .then((turnResult) => setResults((prev) => ({ ...prev, turn: turnResult })))
      .catch((err) => {
        logger.error("Connection diagnostic TURN check failed:", err);
        setResults((prev) => ({ ...prev, turn: { status: "fail", message: "Unexpected error" } }));
      })
      .finally(onSettle);

    runWebRtcCheck()
      .then((webrtcResult) => setResults((prev) => ({ ...prev, webrtc: webrtcResult })))
      .catch((err) => {
        logger.error("Connection diagnostic WebRTC check failed:", err);
        setResults((prev) => ({ ...prev, webrtc: { status: "fail", message: "Unexpected error" } }));
      })
      .finally(onSettle);
  }, [runApiCheck, runBackendCheck, runWssCheck, runStunCheck, runTurnCheck, runWebRtcCheck]);

  const buildReport = useCallback(() => {
    const lines: string[] = [
      `Connection Diagnostic Report - ${new Date().toISOString()}`,
      "",
      `API: ${results.api.status === "ok" ? "OK" : results.api.status === "fail" ? "FAIL" : results.api.status}${results.api.durationMs != null ? ` (${results.api.durationMs}ms)` : ""}${results.api.message ? ` - ${results.api.message}` : ""}`,
      `Backend (API + DB): ${results.backend.status === "ok" ? "OK" : results.backend.status === "fail" ? "FAIL" : results.backend.status}${results.backend.durationMs != null ? ` (${results.backend.durationMs}ms)` : ""}${results.backend.message ? ` - ${results.backend.message}` : ""}`,
      `WebSocket (WSS): ${results.wss.status === "ok" ? "OK" : results.wss.status === "fail" ? "FAIL" : results.wss.status}${results.wss.durationMs != null ? ` (${results.wss.durationMs}ms)` : ""}${results.wss.message ? ` - ${results.wss.message}` : ""}`,
      `STUN (Google, UDP ${STUN_PORT}): ${results.stun.status === "ok" ? "OK" : results.stun.status === "fail" ? "FAIL" : results.stun.status}${results.stun.durationMs != null ? ` (${results.stun.durationMs}ms)` : ""}${results.stun.message ? ` - ${results.stun.message}` : ""}`,
      `TURN: ${results.turn.status === "ok" ? "OK" : results.turn.status === "fail" ? "FAIL" : results.turn.status}${results.turn.durationMs != null ? ` (${results.turn.durationMs}ms)` : ""}${results.turn.message ? ` - ${results.turn.message}` : ""}`,
      `WebRTC: ${results.webrtc.status === "ok" ? "OK" : results.webrtc.status === "fail" ? "FAIL" : results.webrtc.status}${results.webrtc.pathType ? ` (${results.webrtc.pathType})` : ""}${results.webrtc.durationMs != null ? ` (${results.webrtc.durationMs}ms)` : ""}${results.webrtc.message ? ` - ${results.webrtc.message}` : ""}`,
    ];
    return lines.join("\n");
  }, [results]);

  const handleCopyReport = useCallback(async () => {
    const text = buildReport();
    setCopyError(null);

    const tryClipboard = async (): Promise<boolean> => {
      if (typeof navigator.clipboard?.writeText !== "function") return false;
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    };

    const tryExecCommand = (): boolean => {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
      } catch {
        return false;
      }
    };

    if (await tryClipboard()) {
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    if (tryExecCommand()) {
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    setCopyError("Copy failed. Check browser permissions or try a different browser.");
  }, [buildReport]);

  const allDone =
    results.api.status !== "running" &&
    results.backend.status !== "running" &&
    results.wss.status !== "running" &&
    results.stun.status !== "running" &&
    results.turn.status !== "running" &&
    results.webrtc.status !== "running";
  const anyFail =
    results.api.status === "fail" ||
    results.backend.status === "fail" ||
    results.wss.status === "fail" ||
    results.stun.status === "fail" ||
    results.turn.status === "fail" ||
    results.webrtc.status === "fail";

  const getSuggestedAction = (): string => {
    if (!allDone || running) return "";
    if (results.api.status === "fail") {
      return "We can't reach our servers. Check your internet connection. If other sites work, try again later or contact support with the report below.";
    }
    if (results.backend.status === "fail") {
      return "Backend or database is unreachable. The API may be down or your request may be blocked. Try again or contact support with the report below.";
    }
    if (results.wss.status === "fail") {
      return "WebSocket (signaling) is blocked or failing on this network. Try another network (e.g. mobile hotspot) or a different browser. Share the report with support if the issue continues.";
    }
    if (results.stun.status === "fail") {
      return `STUN (Google, UDP port ${STUN_PORT}) may be blocked or the server unreachable. WebRTC often needs STUN. Try another network or contact support; we may need TURN/relay.`;
    }
    if (results.turn.status === "fail") {
      return "TURN (relay) server is unreachable or misconfigured. Sessions may fail when direct/STUN connection isn't possible. Check TURN URL/credentials or contact support.";
    }
    if (results.webrtc.status === "fail") {
      return "Real-time connection (WebRTC) failed. Your network may block UDP or WebRTC. Try another network or contact support; we may need to enable TURN/relay options.";
    }
    if (results.webrtc.pathType === "relay") {
      return "Your connection will work but may be slower or higher latency (using relay). For best quality, try a network that allows direct connection.";
    }
    return "Your connection looks good. If you still have issues in a session, they may be robot-side or temporary—try again or share this report with support.";
  };

  const wsUrl = getWsUrl();

  return (
    <div className="connection-diagnostic">
      <h2>Connection Diagnostic</h2>
      <p className="section-description">
        Test whether your network can reach our API, WebSocket signaling, and WebRTC. Use this if sessions fail to connect or are unstable.
      </p>

      <div className="connection-diagnostic-actions">
        <button
          type="button"
          className="action-btn connection-diagnostic-run"
          onClick={runDiagnostic}
          disabled={running}
        >
          {running ? (
            <>
              <FontAwesomeIcon icon={faSpinner} spin />
              <span>Running tests…</span>
            </>
          ) : (
            <>
              <FontAwesomeIcon icon={faPlay} />
              <span>Run diagnostic</span>
            </>
          )}
        </button>
        {allDone && (
          <button
            type="button"
            className="connection-diagnostic-copy"
            onClick={handleCopyReport}
          >
            <FontAwesomeIcon icon={faCopy} />
            <span>{copied ? "Copied!" : "Copy report for support"}</span>
          </button>
        )}
      </div>

      {copyError && (
        <div className="connection-diagnostic-warning" role="alert">
          <FontAwesomeIcon icon={faExclamationTriangle} />
          <span>{copyError}</span>
        </div>
      )}

      {!wsUrl && (
        <div className="connection-diagnostic-warning">
          <FontAwesomeIcon icon={faExclamationTriangle} />
          <span>WebSocket URL is not configured (e.g. missing amplify_outputs or VITE_WS_URL). WSS test will fail.</span>
        </div>
      )}

      <div className="connection-diagnostic-results">
        <ResultRow
          label="API (HTTPS)"
          result={results.api}
          help="Can this device reach auth (Cognito)?"
        />
        <ResultRow
          label="Backend (API + DB)"
          result={results.backend}
          help="Can the app reach our API and database (e.g. AppSync + DynamoDB)?"
        />
        <ResultRow
          label="WebSocket (WSS) signaling"
          result={results.wss}
          help="Can this device open a WebSocket to our signaling server?"
        />
        <ResultRow
          label={`STUN (Google, UDP port ${STUN_PORT})`}
          result={results.stun}
          help={`Can this device reach Google's STUN server on UDP port ${STUN_PORT}? (stun.l.google.com)`}
        />
        <ResultRow
          label="TURN (relay)"
          result={results.turn}
          help="Can this device reach the TURN relay server? (Optional; set VITE_TURN_URL or custom.signaling.turnUrl to test.)"
        />
        <ResultRow
          label="WebRTC"
          result={results.webrtc}
          help="In-browser loopback test (STUN only, no TURN). Path: direct or relay."
        />
      </div>

      {allDone && (anyFail || results.webrtc.pathType === "relay" || results.api.status === "ok") && (
        <div className="connection-diagnostic-suggestion">
          <FontAwesomeIcon icon={faInfoCircle} />
          <p>{getSuggestedAction()}</p>
        </div>
      )}
    </div>
  );
}

function ResultRow({
  label,
  result,
  help,
}: {
  label: string;
  result: { status: CheckStatus; message?: string; durationMs?: number; pathType?: "direct" | "relay" | "unknown" };
  help: string;
}) {
  const isRunning = result.status === "running";
  const isOk = result.status === "ok";
  const isFail = result.status === "fail";

  const messageIsInfo = isOk && result.message;

  return (
    <div className={`connection-diagnostic-row${messageIsInfo ? " connection-diagnostic-row--message-info" : ""}`}>
      <div className="connection-diagnostic-row-header">
        <span className="connection-diagnostic-label">{label}</span>
        {isRunning && <FontAwesomeIcon icon={faSpinner} spin className="connection-diagnostic-icon running" />}
        {isOk && <FontAwesomeIcon icon={faCheckCircle} className="connection-diagnostic-icon ok" />}
        {isFail && <FontAwesomeIcon icon={faTimesCircle} className="connection-diagnostic-icon fail" />}
        {result.status === "idle" && <span className="connection-diagnostic-icon idle">—</span>}
      </div>
      {(result.message || result.durationMs != null || result.pathType) && (
        <div className="connection-diagnostic-row-detail">
          {result.durationMs != null && <span>{result.durationMs}ms</span>}
          {result.pathType && <span>path: {result.pathType}</span>}
          {result.message && <span className="connection-diagnostic-message">{result.message}</span>}
        </div>
      )}
      <p className="connection-diagnostic-help">{help}</p>
    </div>
  );
}
