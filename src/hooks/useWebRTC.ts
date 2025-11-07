import { useState, useEffect, useRef, useCallback } from 'react';

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
  const { wsUrl, myId = 'browser1', robotId = 'robot1' } = options;
  const [status, setStatus] = useState<WebRTCStatus>({
    connecting: false,
    connected: false,
    error: null,
    videoStream: null,
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rosBridgeRef = useRef<WebRTCRosBridge | null>(null);

  const cleanup = useCallback(() => {
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
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onerror = (error) => {
        setStatus(prev => ({ ...prev, connecting: false, error: 'WebSocket connection error' }));
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        setStatus(prev => ({ ...prev, connecting: false, connected: false }));
        cleanup();
      };

      ws.onopen = async () => {
        ws.send(JSON.stringify({ type: 'register', from: myId }));

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        pcRef.current = pc;

        pc.onicecandidate = (event) => {
          if (event.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'candidate',
                from: myId,
                to: robotId,
                candidate: event.candidate,
              })
            );
          }
        };

        pc.ontrack = (event) => {
          const stream = event.streams[0];
          setStatus(prev => ({
            ...prev,
            connected: true,
            connecting: false,
            videoStream: stream,
          }));
        };

        const channel = pc.createDataChannel('control');
        channel.onopen = async () => {
          rosBridgeRef.current = new WebRTCRosBridge(channel);
          
          // Subscribe to camera topic
          if (rosBridgeRef.current) {
            await rosBridgeRef.current.send({
              op: 'subscribe',
              id: 'chatter',
              topic: '/camera/image_raw',
              type: 'sensor_msgs/Image',
            });
          }
        };

        pc.addTransceiver('video', { direction: 'recvonly' });

        ws.onmessage = async (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === 'answer' && msg.sdp) {
            await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
          } else if (msg.type === 'candidate' && msg.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (e) {
              console.error('Error adding ICE candidate:', e);
            }
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        ws.send(
          JSON.stringify({
            to: robotId,
            from: myId,
            type: 'offer',
            sdp: pc.localDescription?.sdp,
          })
        );
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
      op: 'publish',
      topic: '/cmd_vel',
      msg: {
        header: {
          stamp: { sec: 0, nanosec: 0 },
          frame_id: 'base_link',
        },
        twist: {
          linear: { x: linearX, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: angularZ },
        },
      },
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
