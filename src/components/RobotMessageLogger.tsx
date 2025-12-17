import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { logger } from '../utils/logger';
import {
  faCopy,
  faTrash,
  faPause,
  faPlay,
  faCircle,
  faFilter,
  faSearch,
  faCheckCircle,
  faExclamationTriangle,
  faInfoCircle
} from '@fortawesome/free-solid-svg-icons';
import './RobotMessageLogger.css';

interface LogEntry {
  id: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing' | 'system';
  type: string;
  message: any;
  raw: string;
  isValid: boolean;
  error?: string;
}

interface RobotMessageLoggerProps {
  robotId: string;
  wsUrl: string;
}

export function RobotMessageLogger({ robotId, wsUrl }: RobotMessageLoggerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const [isTesting, setIsTesting] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef(0);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && !isPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isPaused]);

  // Validate and parse message
  const parseMessage = useCallback((raw: string): { message: any; isValid: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(raw);
      return { message: parsed, isValid: true };
    } catch (error) {
      return {
        message: { raw },
        isValid: false,
        error: error instanceof Error ? error.message : 'Invalid JSON'
      };
    }
  }, []);

  // Check if message is related to this robot
  const isRobotMessage = useCallback((msg: any): boolean => {
    if (!msg || typeof msg !== 'object') return false;
    
    // If message has _monitor flag, it's a monitoring copy - always include it
    if (msg._monitor === true) {
      return true;
    }
    
    // Check various fields that might contain robotId
    const robotIdFields = ['robotId', 'to', 'from'];
    return robotIdFields.some(field => {
      const value = msg[field];
      return value === robotId || (typeof value === 'string' && value.includes(robotId));
    });
  }, [robotId]);

  // Add log entry
  const addLog = useCallback((direction: 'incoming' | 'outgoing' | 'system', raw: string, message?: any) => {
    if (isPaused) return;

    const { message: parsedMessage, isValid, error } = message 
      ? { message, isValid: true } 
      : parseMessage(raw);

    const logEntry: LogEntry = {
      id: `log-${++logIdCounter.current}`,
      timestamp: Date.now(),
      direction,
      type: parsedMessage?.type || 'unknown',
      message: parsedMessage,
      raw,
      isValid,
      error,
    };

    // Only add if it's related to this robot or it's a system message
    if (direction === 'system' || isRobotMessage(parsedMessage)) {
      setLogs(prev => [...prev, logEntry]);
    }
  }, [isPaused, parseMessage, isRobotMessage]);

  // Connect to WebSocket
  useEffect(() => {
    let mounted = true;

    const connect = async () => {
      try {
        logger.log('[LOGGER] Starting connection...', { wsUrl, robotId });
        
        // Get auth token
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        
        if (!token) {
          logger.error('[LOGGER] No auth token available');
          addLog('system', '', { type: 'error', message: 'Authentication required' });
          return;
        }

        logger.log('[LOGGER] Got auth token, connecting to WebSocket...');
        const urlWithToken = `${wsUrl}?token=${encodeURIComponent(token)}`;
        logger.log('[LOGGER] WebSocket URL:', urlWithToken.substring(0, 100) + '...');
        const ws = new WebSocket(urlWithToken);
        wsRef.current = ws;

        ws.onopen = () => {
          logger.log('[LOGGER] WebSocket opened!', { readyState: ws.readyState });
          if (mounted) {
            setIsConnected(true);
            addLog('system', '', { 
              type: 'connected', 
              message: `Connected to signaling server (monitoring robot: ${robotId})` 
            });
            
            // Wait a small delay to ensure connection is fully established
            // Then send monitor message to subscribe to all messages for this robot
            setTimeout(() => {
              if (mounted && robotId && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                const monitorMessage = {
                  type: 'monitor',
                  robotId: robotId,
                };
                logger.log('[LOGGER] Sending monitor message:', monitorMessage, 'readyState:', wsRef.current.readyState);
                try {
                  wsRef.current.send(JSON.stringify(monitorMessage));
                  logger.log('[LOGGER] Monitor message sent successfully');
                  addLog('outgoing', JSON.stringify(monitorMessage), monitorMessage);
                } catch (error) {
                  logger.error('[LOGGER] Error sending monitor message:', error);
                  addLog('system', '', {
                    type: 'error',
                    message: `Failed to send monitor message: ${error instanceof Error ? error.message : 'Unknown error'}`
                  });
                }
              } else {
                logger.warn('[LOGGER] Cannot send monitor message - robotId:', robotId, 'readyState:', wsRef.current?.readyState, 'mounted:', mounted);
              }
            }, 100); // Small delay to ensure connection is fully ready
          }
        };

        ws.onmessage = (event) => {
          if (mounted) {
            // Parse message to check if it's a monitor copy or confirmation
            try {
              const parsed = JSON.parse(event.data);
              
              // Debug: Log all incoming messages to console
              logger.log('[LOGGER] Received message:', parsed);
              
              // Handle monitor-confirmed message specially
              if (parsed.type === 'monitor-confirmed') {
                addLog('system', event.data, {
                  type: 'monitor-confirmed',
                  message: parsed.message || `Now monitoring messages for robot ${parsed.robotId || robotId}`,
                  robotId: parsed.robotId || robotId,
                });
                return;
              }
              
              // Monitor messages are copies of forwarded messages, show as incoming
              // Messages with _monitor flag are copies sent to monitoring connections
              // Always log monitor messages - they're already filtered by the server
              if (parsed._monitor === true) {
                // This is a monitor copy - always display it
                addLog('incoming', event.data, parsed);
              } else {
                // Regular message - check if it's for this robot
                addLog('incoming', event.data, parsed);
              }
            } catch (error) {
              // If parsing fails, just log as incoming
              logger.warn('[LOGGER] Failed to parse message:', event.data, error);
              addLog('incoming', event.data);
            }
          }
        };

        ws.onerror = (error) => {
          logger.error('[LOGGER] WebSocket error:', error);
          if (mounted) {
            addLog('system', '', { 
              type: 'error', 
              message: `WebSocket error: ${error instanceof Error ? error.message : 'Unknown error'}` 
            });
          }
        };

        ws.onclose = (event) => {
          logger.log('[LOGGER] WebSocket closed:', { code: event.code, reason: event.reason, wasClean: event.wasClean });
          if (mounted) {
            setIsConnected(false);
            addLog('system', '', { 
              type: 'disconnected', 
              message: `Connection closed (code: ${event.code})` 
            });
            
            // Attempt to reconnect after 3 seconds
            setTimeout(() => {
              if (mounted) {
                logger.log('[LOGGER] Attempting to reconnect...');
                connect();
              }
            }, 3000);
          }
        };
      } catch (error) {
        if (mounted) {
          addLog('system', '', { 
            type: 'error', 
            message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}` 
          });
        }
      }
    };

    connect();

    return () => {
      mounted = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, [wsUrl, robotId, addLog]);

  // Filter logs
  const filteredLogs = logs.filter(log => {
    if (filterType !== 'all' && log.type !== filterType) return false;
    if (searchTerm && !JSON.stringify(log.message).toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    return true;
  });

  // All known message types in the system (for filter dropdown)
  const allMessageTypes = [
    'register',
    'offer',
    'answer',
    'candidate',
    'ice-candidate',
    'takeover',
    'monitor',
    'monitor-confirmed',
    'connected',
    'disconnected',
    'error',
    'unknown'
  ];

  // Get unique message types that have appeared in logs
  const seenMessageTypes = Array.from(new Set(logs.map(log => log.type))).filter(Boolean);
  
  // Combine all types, but mark which ones have been seen
  const messageTypes = allMessageTypes.map(type => ({
    value: type,
    seen: seenMessageTypes.includes(type)
  }));

  // Show toast notification
  const showToast = (message: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, visible: true });
    toastTimeoutRef.current = setTimeout(() => {
      setToast({ message: '', visible: false });
    }, 2000);
  };

  // Copy functions
  const copyLog = async (log: LogEntry) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log.message, null, 2));
      showToast('Message copied to clipboard');
    } catch (error) {
      showToast('Failed to copy message');
    }
  };

  const copyAllLogs = async () => {
    try {
      const allLogsText = filteredLogs.map(log => 
        `[${new Date(log.timestamp).toISOString()}] ${log.direction.toUpperCase()} - ${log.type}\n${JSON.stringify(log.message, null, 2)}`
      ).join('\n\n');
      await navigator.clipboard.writeText(allLogsText);
      showToast(`Copied ${filteredLogs.length} log${filteredLogs.length !== 1 ? 's' : ''} to clipboard`);
    } catch (error) {
      showToast('Failed to copy logs');
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  // Send test message to verify logger is working
  const sendTestMessage = async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      showToast('Not connected to server. Please wait for connection.');
      return;
    }

    setIsTesting(true);
    try {
      // Send a test register message (simulating what the Python script would send)
      const testMessage = {
        type: 'register',
        robotId: robotId,
      };
      
      // Log it as outgoing before sending
      addLog('outgoing', JSON.stringify(testMessage), testMessage);
      
      // Send it through the WebSocket
      wsRef.current.send(JSON.stringify(testMessage));
      
      showToast('Test message sent! Check logs below.');
    } catch (error) {
      showToast('Failed to send test message');
      logger.error('Error sending test message:', error);
    } finally {
      setIsTesting(false);
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${timeStr}.${ms}`;
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'register': return '#ffb700';
      case 'offer': return '#4CAF50';
      case 'answer': return '#2196F3';
      case 'candidate': return '#9C27B0';
      case 'error': return '#f44336';
      case 'connected': return '#4CAF50';
      case 'disconnected': return '#ff9800';
      default: return '#666';
    }
  };

  return (
    <div className="robot-message-logger">
      <div className="logger-header">
        <div className="logger-title">
          <h3>Message Logger</h3>
          <div 
            className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}
            title={isConnected 
              ? 'WebSocket connection to signaling server is active. Waiting for robot messages...' 
              : 'WebSocket connection to signaling server is not active. Attempting to reconnect...'}
          >
            <FontAwesomeIcon icon={faCircle} />
            <span>{isConnected ? 'Connected to Server' : 'Disconnected'}</span>
          </div>
        </div>
        <div className="logger-controls">
          <button 
            onClick={() => setIsPaused(!isPaused)}
            className="control-button"
            title={isPaused ? 'Resume logging' : 'Pause logging'}
          >
            <FontAwesomeIcon icon={isPaused ? faPlay : faPause} />
          </button>
          <button 
            onClick={sendTestMessage}
            className="control-button"
            title="Send test message to verify logger is working"
            disabled={!isConnected || isTesting}
          >
            <FontAwesomeIcon icon={faCheckCircle} />
            {isTesting ? 'Testing...' : 'Test Connection'}
          </button>
          <button 
            onClick={copyAllLogs}
            className="control-button"
            title="Copy all logs"
          >
            <FontAwesomeIcon icon={faCopy} />
            Copy All
          </button>
          <button 
            onClick={clearLogs}
            className="control-button"
            title="Clear logs"
          >
            <FontAwesomeIcon icon={faTrash} />
            Clear
          </button>
        </div>
      </div>

      <div className="logger-filters">
        <div className="filter-group">
          <FontAwesomeIcon icon={faFilter} />
          <select 
            value={filterType} 
            onChange={(e) => setFilterType(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Types</option>
            {messageTypes.map(({ value, seen }) => (
              <option key={value} value={value}>
                {value}{seen ? '' : ' (not seen yet)'}
              </option>
            ))}
          </select>
        </div>
        <div className="search-group">
          <FontAwesomeIcon icon={faSearch} />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
        <label className="auto-scroll-toggle">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
      </div>

      <div className="logger-stats">
        <span>Total: {logs.length}</span>
        <span>Filtered: {filteredLogs.length}</span>
        <span>Errors: {logs.filter(l => !l.isValid).length}</span>
      </div>

      <div className="log-viewer">
        {filteredLogs.length === 0 ? (
          <div className="log-empty">
            <FontAwesomeIcon icon={faInfoCircle} />
            <p>No messages yet. Waiting for robot activity...</p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div 
              key={log.id} 
              className={`log-entry ${log.direction} ${!log.isValid ? 'invalid' : ''}`}
            >
              <div className="log-header">
                <span className="log-timestamp">{formatTimestamp(log.timestamp)}</span>
                <span 
                  className="log-type"
                  style={{ color: getTypeColor(log.type) }}
                >
                  {log.type}
                </span>
                <span className="log-direction">
                  {log.message?._direction ? log.message._direction : log.direction}
                </span>
                {log.message?._monitor && (
                  <span className="log-monitor-badge" title="This is a monitoring copy of a forwarded message">
                    📡 Monitor
                  </span>
                )}
                {!log.isValid && (
                  <span className="log-error-badge">
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    Invalid
                  </span>
                )}
                <button 
                  onClick={() => copyLog(log)}
                  className="log-copy-button"
                  title="Copy this message"
                >
                  <FontAwesomeIcon icon={faCopy} />
                </button>
              </div>
              {log.error && (
                <div className="log-error">
                  <FontAwesomeIcon icon={faExclamationTriangle} />
                  {log.error}
                </div>
              )}
              <pre className="log-content">
                {JSON.stringify(log.message, null, 2)}
              </pre>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Toast Notification */}
      {toast.visible && (
        <div className="toast-notification">
          <FontAwesomeIcon icon={faCheckCircle} />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

