import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

export interface WebRTCStatus {
  connecting: boolean;
  connected: boolean;
  error: string | null;
  videoStream: MediaStream | null;
}

export interface WebRTCOptions {
  wsUrl: string;
  myId?: string;
  robotId?: string;
}

class WebRTCRosBridge {
  private channel: RTCDataChannel;
  private callbacks: Record<string, (msg: any) => void> = {};

  constructor(dc: RTCDataChannel) {
    this.channel = dc;
    dc.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks[msg.id]) {
        this.callbacks[msg.id](msg);
        delete this.callbacks[msg.id];
      } else if (msg.op === 'publish') {
        // Handle other ROS messages if needed
        console.log('Topic ' + msg.topic + ': ' + JSON.stringify(msg.msg));
      }
    };
  }

  send(msg: any): Promise<void> {
    return new Promise((resolve) => {
      if (msg.id) this.callbacks[msg.id] = resolve;
      this.channel.send(JSON.stringify(msg));
      if (!msg.id) resolve();
    });
  }
}

export function useWebRTC(options: WebRTCOptions) {
  const { wsUrl, myId, robotId = 'robot1' } = options;
  const [status, setStatus] = useState<WebRTCStatus>({
    connecting: false,
    connected: false,
    error: null,
    videoStream: null,
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rosBridgeRef = useRef<WebRTCRosBridge | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const webrtcTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const welcomeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const webrtcConnectedRef = useRef<boolean>(false);
  const myIdRef = useRef<string>(myId || ''); // Store actual connection ID

  const cleanup = useCallback(() => {
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
    if (pcRef.current || wsRef.current) {
      cleanup();
    }

    setStatus({ connecting: true, connected: false, error: null, videoStream: null });

    try {
      // Get JWT token for WebSocket authentication
      let token: string | undefined;
      try {
        const session = await fetchAuthSession();
        token = session.tokens?.idToken?.toString();
      } catch (authError) {
        console.warn('Failed to get auth token for WebSocket:', authError);
        setStatus(prev => ({ ...prev, connecting: false, error: 'Authentication required' }));
        return;
      }

      // Append token to WebSocket URL if we have one
      const urlWithToken = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
      console.log('[BROWSER] Connecting to WebSocket:', wsUrl);
      console.log('[BROWSER] Target robot:', robotId);
      const ws = new WebSocket(urlWithToken);
      wsRef.current = ws;

      let connectionEstablished = false;

      // Set timeout for WebSocket connection (10 seconds)
      connectionTimeoutRef.current = setTimeout(() => {
        if (!connectionEstablished && ws.readyState !== WebSocket.OPEN) {
          console.error('[BROWSER] WebSocket connection timeout');
          setStatus(prev => ({ 
            ...prev, 
            connecting: false, 
            error: 'Connection timeout: Unable to establish WebSocket connection. Please check your network and try again.' 
          }));
          cleanup();
        }
      }, 10000); // 10 second timeout

      ws.onerror = (error) => {
        console.error('[BROWSER] WebSocket error:', error);
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        setStatus(prev => ({ ...prev, connecting: false, error: 'WebSocket connection error' }));
      };

      ws.onclose = (event) => {
        console.log('[BROWSER] WebSocket closed:', { code: event.code, reason: event.reason, wasClean: event.wasClean });
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        // Only set error if connection closed before being established
        if (!connectionEstablished) {
          console.error('[BROWSER] Connection closed before establishing');
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
        console.log('[BROWSER] WebSocket opened, waiting for connection ID...');
        connectionEstablished = true;
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        
        welcomeTimeoutRef.current = setTimeout(() => {
          console.error('[BROWSER] Welcome message timeout');
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
        console.log('[BROWSER] Received message from server:', msg.type);

        // Handle welcome message with our connection ID
        if (msg.type === 'welcome' && msg.connectionId) {
          if (welcomeTimeoutRef.current) {
            clearTimeout(welcomeTimeoutRef.current);
            welcomeTimeoutRef.current = null;
          }
          
          console.log('[BROWSER] Received connection ID:', msg.connectionId);
          myIdRef.current = msg.connectionId;
          
          // Now start WebRTC connection
          console.log('[BROWSER] Creating RTCPeerConnection for robot:', robotId);
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });
          pcRef.current = pc;

          // Set timeout for WebRTC connection establishment (15 seconds)
          webrtcConnectedRef.current = false;
          webrtcTimeoutRef.current = setTimeout(() => {
            if (!webrtcConnectedRef.current) {
              console.error('[BROWSER] WebRTC connection timeout - robot may be offline');
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
              console.log('[BROWSER] Sending ICE candidate to robot:', robotId);
              ws.send(
                JSON.stringify({
                  type: 'candidate',
                  from: myIdRef.current,
                  to: robotId,
                  candidate: event.candidate,
                })
              );
            }
          };

          pc.ontrack = (event) => {
            console.log('[BROWSER] Received video track from robot!');
            webrtcConnectedRef.current = true;
            if (webrtcTimeoutRef.current) {
              clearTimeout(webrtcTimeoutRef.current);
              webrtcTimeoutRef.current = null;
            }
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
            console.log('[BROWSER] Data channel opened');
            rosBridgeRef.current = new WebRTCRosBridge(channel);
          };

          pc.addTransceiver('video', { direction: 'recvonly' });

          console.log('[BROWSER] Creating WebRTC offer...');
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          console.log('[BROWSER] Offer created, sending to robot:', robotId);

          const offerMessage = {
            to: robotId,
            from: myIdRef.current,
            type: 'offer',
            sdp: pc.localDescription?.sdp,
          };
          console.log('[BROWSER] Sending offer message:', { 
            to: offerMessage.to, 
            from: offerMessage.from, 
            type: offerMessage.type,
            sdpLength: offerMessage.sdp?.length 
          });
          
          ws.send(JSON.stringify(offerMessage));
          console.log('[BROWSER] Offer sent! Waiting for answer from robot...');
          return;
        }

        // Handle WebRTC signaling messages
        const pc = pcRef.current;
        if (!pc) return;

        if (msg.type === 'answer' && msg.sdp) {
          console.log('[BROWSER] Received answer from robot, setting remote description...');
          try {
            await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
            console.log('[BROWSER] Remote description set successfully');
          } catch (e) {
            console.error('[BROWSER] Error setting remote description:', e);
          }
        } else if (msg.type === 'candidate' && msg.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            console.log('[BROWSER] Added ICE candidate from robot');
          } catch (e) {
            console.error('[BROWSER] Error adding ICE candidate:', e);
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

    rosBridgeRef.current.send({
      type: "MovementCommand",
      params: {
        "forward": linearX,
        "turn": angularZ,
      }
    });
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
