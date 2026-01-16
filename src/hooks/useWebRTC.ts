import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { logger } from '../utils/logger';
import {
  signalling,
  agent,
  parseMessage,
  ProtocolEnvelope,
  SignallingAnswerPayload,
  SignallingIceCandidatePayload,
} from '../utils/protocol';

export interface WebRTCStatus {
  connecting: boolean;
  connected: boolean;
  error: string | null;
  videoStream: MediaStream | null;
  robotBusy: boolean;
  busyUser: string | null;
  sessionId: string | null;
}

export interface WebRTCOptions {
  wsUrl: string;
  myId?: string;
  robotId?: string;
}

class WebRTCRosBridge {
  private channel: RTCDataChannel;
  private callbacks: Record<string, (msg: ProtocolEnvelope) => void> = {};

  constructor(dc: RTCDataChannel) {
    this.channel = dc;
    dc.onmessage = (event) => {
      const msg = parseMessage(event.data);
      if (!msg) {
        logger.warn('[WEBRTC] Received non-protocol message:', event.data);
        return;
      }
      if (msg.correlationId && this.callbacks[msg.correlationId]) {
        this.callbacks[msg.correlationId](msg);
        delete this.callbacks[msg.correlationId];
      }
    };
  }

  send(envelope: ProtocolEnvelope): Promise<void> {
    return new Promise((resolve) => {
      if (envelope.correlationId) {
        this.callbacks[envelope.id] = () => resolve();
      }
      this.channel.send(JSON.stringify(envelope));
      if (!envelope.correlationId) resolve();
    });
  }
}

// =============================================================================
// Connection Lock
// Prevents duplicate WebSocket connections during React StrictMode remounts.
// The lock auto-expires after a timeout to handle edge cases.
// =============================================================================

const CONNECTION_LOCK_TIMEOUT_MS = 3000;

let connectionLockActive = false;
let connectionLockTimer: ReturnType<typeof setTimeout> | null = null;

function acquireConnectionLock(): boolean {
  if (connectionLockActive) {
    return false;
  }
  
  if (connectionLockTimer) {
    clearTimeout(connectionLockTimer);
  }
  
  connectionLockActive = true;
  
  // Auto-release lock after timeout as a safety net
  connectionLockTimer = setTimeout(() => {
    logger.warn('[WEBRTC] Connection lock auto-released after timeout');
    connectionLockActive = false;
    connectionLockTimer = null;
  }, CONNECTION_LOCK_TIMEOUT_MS);
  
  return true;
}

function releaseConnectionLock(): void {
  connectionLockActive = false;
  if (connectionLockTimer) {
    clearTimeout(connectionLockTimer);
    connectionLockTimer = null;
  }
}

export function useWebRTC(options: WebRTCOptions) {
  const { wsUrl, myId, robotId = 'robot1' } = options;
  const [status, setStatus] = useState<WebRTCStatus>({
    connecting: false,
    connected: false,
    error: null,
    videoStream: null,
    robotBusy: false,
    busyUser: null,
    sessionId: null,
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rosBridgeRef = useRef<WebRTCRosBridge | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const webrtcTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const welcomeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const webrtcConnectedRef = useRef<boolean>(false);
  const myIdRef = useRef<string>(myId || ''); // Store actual connection ID
  const isThisInstanceConnecting = useRef<boolean>(false); // Track if this instance initiated the connection

  const cleanup = useCallback(() => {
    // Note: Connection lock is intentionally NOT released here.
    // Lock release is handled by acquireConnectionLock timeout or explicit releaseConnectionLock calls.
    // This prevents React StrictMode double-mounting from creating duplicate connections.
    isThisInstanceConnecting.current = false;
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (webrtcTimeoutRef.current) {
      clearTimeout(webrtcTimeoutRef.current);
      webrtcTimeoutRef.current = null;
    }
    if (welcomeTimeoutRef.current) {
      clearTimeout(welcomeTimeoutRef.current);
      welcomeTimeoutRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    rosBridgeRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    // Acquire connection lock to prevent duplicate connections
    if (!acquireConnectionLock()) {
      logger.debug('[WEBRTC] Connection already in progress, skipping duplicate attempt');
      return;
    }
    isThisInstanceConnecting.current = true;

    if (pcRef.current || wsRef.current) {
      cleanup();
    }

    setStatus({ connecting: true, connected: false, error: null, videoStream: null, robotBusy: false, busyUser: null, sessionId: null });

    try {
      // Get JWT token for WebSocket authentication
      let token: string | undefined;
      try {
        const session = await fetchAuthSession();
        token = session.tokens?.idToken?.toString();
      } catch (authError) {
        logger.warn('[WEBRTC] Failed to get auth token:', authError);
        releaseConnectionLock();
        isThisInstanceConnecting.current = false;
        setStatus(prev => ({ ...prev, connecting: false, error: 'Authentication required' }));
        return;
      }

      // Append token to WebSocket URL if we have one
      const urlWithToken = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
      logger.log('[WEBRTC] Connecting to WebSocket:', wsUrl);
      logger.log('[WEBRTC] Target robot:', robotId);
      const ws = new WebSocket(urlWithToken);
      wsRef.current = ws;

      let connectionEstablished = false;

      // Set timeout for WebSocket connection (10 seconds)
      connectionTimeoutRef.current = setTimeout(() => {
        if (!connectionEstablished && ws.readyState !== WebSocket.OPEN) {
          logger.error('[WEBRTC] WebSocket connection timeout');
          setStatus(prev => ({ 
            ...prev, 
            connecting: false, 
            error: 'Connection timeout: Unable to establish WebSocket connection. Please check your network and try again.' 
          }));
          cleanup();
        }
      }, 10000); // 10 second timeout

      ws.onerror = (error) => {
        logger.error('[WEBRTC] WebSocket error:', error);
        releaseConnectionLock();
        isThisInstanceConnecting.current = false;
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        setStatus(prev => ({ ...prev, connecting: false, error: 'WebSocket connection error' }));
      };

      ws.onclose = (event) => {
        logger.log('[WEBRTC] WebSocket closed:', { code: event.code, reason: event.reason, wasClean: event.wasClean });
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        // Only set error if connection closed before being established
        if (!connectionEstablished) {
          logger.error('[WEBRTC] Connection closed before establishing');
          setStatus(prev => ({ 
            ...prev, 
            connecting: false, 
            connected: false,
            error: prev.error || 'Connection closed before establishing. Please check the server and try again.'
          }));
        } else {
          setStatus(prev => ({ ...prev, connecting: false, connected: false }));
        }
        cleanup();
      };

      ws.onopen = async () => {
        logger.log('[WEBRTC] WebSocket opened, sending ready message...');
        connectionEstablished = true;
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        
        // Send ready message to get our connection ID
        ws.send(JSON.stringify({ type: 'ready' }));
        
        // Set timeout for welcome message (15 seconds)
        welcomeTimeoutRef.current = setTimeout(() => {
          logger.error('[WEBRTC] Welcome message timeout');
          setStatus(prev => ({ 
            ...prev, 
            connecting: false, 
            error: 'Server connection timeout: Did not receive connection confirmation.' 
          }));
          cleanup();
        }, 15000);
      };

      // Handle all messages including welcome
      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        logger.log('[WEBRTC] Received message from server:', msg.type);

        if (msg.type === 'session-locked') {
          logger.warn('[WEBRTC] Robot is locked by another user:', msg.lockedBy);
          setStatus(prev => ({
            ...prev,
            connecting: false,
            connected: false,
            error: null,
            robotBusy: true,
            busyUser: msg.lockedBy || 'Another user',
          }));
          cleanup();
          return;
        }

        // Handle error messages from signaling handler
        if (msg.type === 'error') {
          if (msg.error === 'insufficient_funds') {
            logger.warn('[BROWSER] Insufficient funds to start session:', msg.message);
            setStatus(prev => ({
              ...prev,
              connecting: false,
              connected: false,
              error: msg.message || 'Insufficient credits to start session. Please top up your account.',
              robotBusy: false,
            }));
          } else if (msg.error === 'access_denied') {
            logger.warn('[BROWSER] Access denied to robot:', msg.message);
            setStatus(prev => ({
              ...prev,
              connecting: false,
              connected: false,
              error: msg.message || 'You are not authorized to access this robot. The robot owner may have restricted access to specific users.',
              robotBusy: false,
            }));
          } else {
            // Generic error handling
            logger.warn('[BROWSER] Error from server:', msg.message);
            setStatus(prev => ({
              ...prev,
              connecting: false,
              connected: false,
              error: msg.message || 'An error occurred. Please try again.',
              robotBusy: false,
            }));
          }
          cleanup();
          return;
        }
        
        if (msg.type === 'session-created' && msg.sessionId) {
          logger.log('[WEBRTC] Session created with ID:', msg.sessionId);
          setStatus(prev => ({
            ...prev,
            sessionId: msg.sessionId,
          }));
          return;
        }

        // Handle welcome message with our connection ID
        if (msg.type === 'welcome' && msg.connectionId) {
          if (welcomeTimeoutRef.current) {
            clearTimeout(welcomeTimeoutRef.current);
            welcomeTimeoutRef.current = null;
          }
          
          logger.log('[WEBRTC] Received connection ID:', msg.connectionId);
          myIdRef.current = msg.connectionId;
          
          // Now start WebRTC connection
          logger.log('[WEBRTC] Creating RTCPeerConnection for robot:', robotId);
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });
          pcRef.current = pc;

          // Set timeout for WebRTC connection establishment (15 seconds)
          webrtcConnectedRef.current = false;
          webrtcTimeoutRef.current = setTimeout(() => {
            if (!webrtcConnectedRef.current) {
              logger.error('[WEBRTC] WebRTC connection timeout - robot may be offline');
              setStatus(prev => ({ 
                ...prev, 
                connecting: false, 
                error: 'WebRTC connection timeout: Unable to establish video connection. The robot may be offline or unreachable.' 
              }));
              cleanup();
            }
          }, 15000);

          pc.onicecandidate = (event) => {
            if (event.candidate && ws.readyState === WebSocket.OPEN) {
              logger.log('[WEBRTC] Sending ICE candidate to robot:', robotId);
              const iceMsg = signalling.iceCandidate(robotId, event.candidate);
              ws.send(JSON.stringify(iceMsg));
            }
          };

          pc.ontrack = (event) => {
            logger.log('[WEBRTC] Received video track from robot!');
            webrtcConnectedRef.current = true;
            if (webrtcTimeoutRef.current) {
              clearTimeout(webrtcTimeoutRef.current);
              webrtcTimeoutRef.current = null;
            }
            releaseConnectionLock();
            logger.log('[WEBRTC] Video stream received, connection established');
            const stream = event.streams[0];
            setStatus(prev => ({
              ...prev,
              connected: true,
              connecting: false,
              error: null,
              videoStream: stream,
            }));
          };

          const channel = pc.createDataChannel('control');
          channel.onopen = async () => {
            logger.log('[WEBRTC] Data channel opened');
            rosBridgeRef.current = new WebRTCRosBridge(channel);
          };

          pc.addTransceiver('video', { direction: 'recvonly' });

          logger.log('[WEBRTC] Creating WebRTC offer...');
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          logger.log('[WEBRTC] Offer created, sending to robot:', robotId);

          const offerMsg = signalling.offer(robotId, pc.localDescription?.sdp || '');
          logger.log('[WEBRTC] Sending offer message:', { 
            type: offerMsg.type,
            connectionId: offerMsg.payload?.connectionId,
            sdpLength: offerMsg.payload?.sdp?.length 
          });
          
          ws.send(JSON.stringify(offerMsg));
          logger.log('[WEBRTC] Offer sent! Waiting for answer from robot...');
          return;
        }

        // Handle WebRTC signaling messages (support both legacy and new protocol)
        const pc = pcRef.current;
        if (!pc) return;

        // New protocol format: signalling.answer
        if (msg.type === 'signalling.answer') {
          const payload = msg.payload as SignallingAnswerPayload | undefined;
          if (payload?.sdp) {
            logger.log('[WEBRTC] Received answer (v0.0), setting remote description...');
            try {
              await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
              logger.log('[WEBRTC] Remote description set successfully');
            } catch (e) {
              logger.error('[WEBRTC] Error setting remote description:', e);
            }
          }
        }
        // Legacy format: type='answer' with top-level sdp
        else if (msg.type === 'answer' && msg.sdp) {
          logger.log('[WEBRTC] Received answer (legacy), setting remote description...');
          try {
            await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
            logger.log('[WEBRTC] Remote description set successfully');
          } catch (e) {
            logger.error('[WEBRTC] Error setting remote description:', e);
          }
        }
        // New protocol format: signalling.ice_candidate
        else if (msg.type === 'signalling.ice_candidate') {
          const payload = msg.payload as SignallingIceCandidatePayload | undefined;
          if (payload?.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate({
                candidate: payload.candidate,
                sdpMid: payload.sdpMid,
                sdpMLineIndex: payload.sdpMLineIndex,
              }));
              logger.log('[WEBRTC] Added ICE candidate (v0.0) from robot');
            } catch (e) {
              logger.error('[WEBRTC] Error adding ICE candidate:', e);
            }
          }
        }
        // Legacy format: type='candidate' with top-level candidate object
        else if (msg.type === 'candidate' && msg.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            logger.log('[WEBRTC] Added ICE candidate (legacy) from robot');
          } catch (e) {
            logger.error('[WEBRTC] Error adding ICE candidate:', e);
          }
        }
      };

    } catch (error) {
      setStatus(prev => ({
        ...prev,
        connecting: false,
        error: error instanceof Error ? error.message : 'Failed to connect',
      }));
      cleanup();
    }
  }, [wsUrl, myId, robotId, cleanup]);

  const sendCommand = useCallback((linearX: number, angularZ: number) => {
    if (!rosBridgeRef.current) return;
    rosBridgeRef.current.send(agent.movement(linearX, angularZ));
  }, []);

  const stopRobot = useCallback(() => {
    sendCommand(0, 0);
  }, [sendCommand]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    connect,
    disconnect: cleanup,
    sendCommand,
    stopRobot,
  };
}
