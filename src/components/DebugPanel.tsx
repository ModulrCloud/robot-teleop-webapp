import { useState, useEffect, useSyncExternalStore, useCallback, useRef } from 'react';
import { logger, LogEntry } from '../utils/logger';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash, faCopy, faDownload, faXmark, faBug, faGripVertical } from '@fortawesome/free-solid-svg-icons';
import './DebugPanel.css';

interface Position {
  x: number;
  y: number;
}

export function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; panelX: number; panelY: number } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const prevLogsLengthRef = useRef(0);
  const userScrolledRef = useRef(false);

  const logs = useSyncExternalStore(
    logger.subscribe,
    logger.getSnapshot,
    logger.getSnapshot
  );

  // Toggle with Ctrl+Shift+D (or Cmd+Shift+D on Mac)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Handle drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      
      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;
      
      setPosition({
        x: dragStartRef.current.panelX + deltaX,
        y: dragStartRef.current.panelY + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: position.x,
      panelY: position.y,
    };
  };

  // Scroll to bottom when panel opens
  useEffect(() => {
    if (isOpen && logsEndRef.current) {
      setTimeout(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'instant' });
        setAutoScroll(true);
      }, 0);
    }
  }, [isOpen]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (!isOpen || !logsEndRef.current) return;
    
    if (logs.length > prevLogsLengthRef.current && autoScroll) {
      setTimeout(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 0);
    }
    
    prevLogsLengthRef.current = logs.length;
  }, [logs, isOpen, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!logsContainerRef.current) return;
    
    const container = logsContainerRef.current;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    
    if (isAtBottom) {
      setAutoScroll(true);
      userScrolledRef.current = false;
    } else if (!userScrolledRef.current) {
      userScrolledRef.current = true;
      setAutoScroll(false);
    }
  }, []);

  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter((log) => log.level === filter);

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + '.' + date.getMilliseconds().toString().padStart(3, '0');
  };

  const formatArgs = (args: unknown[]): string => {
    return args
      .map((a) => {
        if (typeof a === 'object') {
          try {
            return JSON.stringify(a, null, 2);
          } catch {
            return String(a);
          }
        }
        return String(a);
      })
      .join(' ');
  };

  const handleCopyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logger.exportLogs());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy logs:', err);
    }
  }, []);

  const handleDownload = useCallback(() => {
    const blob = new Blob([logger.exportLogs()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modulr-debug-${new Date().toISOString().split('T')[0]}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const scrollToBottom = useCallback(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAutoScroll(true);
    userScrolledRef.current = false;
  }, []);

  const resetPosition = useCallback(() => {
    setPosition({ x: 0, y: 0 });
  }, []);

  const getLevelClass = (level: string): string => {
    switch (level) {
      case 'error': return 'log-error';
      case 'warn': return 'log-warn';
      case 'debug': return 'log-debug';
      default: return 'log-info';
    }
  };

  const toggleButton = (
    <button
      className="debug-toggle-button"
      onClick={() => setIsOpen((v) => !v)}
      title="Toggle Modulr Debug Panel (Ctrl+Shift+D)"
    >
      <FontAwesomeIcon icon={faBug} />
      {logs.filter((l) => l.level === 'error').length > 0 && (
        <span className="error-badge">
          {logs.filter((l) => l.level === 'error').length}
        </span>
      )}
    </button>
  );

  if (!isOpen) {
    return toggleButton;
  }

  const panelStyle: React.CSSProperties = {
    transform: `translate(${position.x}px, ${position.y}px)`,
    cursor: isDragging ? 'grabbing' : undefined,
  };

  return (
    <>
      {toggleButton}
      <div className="debug-panel" style={panelStyle}>
        <div className="debug-panel-header">
          <div 
            className="debug-panel-drag-handle"
            onMouseDown={handleDragStart}
            title="Drag to move panel"
          >
            <FontAwesomeIcon icon={faGripVertical} />
          </div>
          <div className="debug-panel-title">
            <FontAwesomeIcon icon={faBug} />
            <span>Debug Console</span>
            <span className="log-count">({filteredLogs.length})</span>
          </div>
          <div className="debug-panel-controls">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="filter-select"
            >
              <option value="all">All</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
            </select>
            <button 
              onClick={scrollToBottom} 
              title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF - Click to scroll to latest"}
              className={autoScroll ? 'auto-scroll-active' : ''}
            >
              ↓
            </button>
            <button onClick={resetPosition} title="Reset position">
              ⌂
            </button>
            <button onClick={handleCopyAll} title="Copy all logs">
              <FontAwesomeIcon icon={faCopy} />
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={handleDownload} title="Download logs">
              <FontAwesomeIcon icon={faDownload} />
            </button>
            <button onClick={logger.clear} title="Clear logs">
              <FontAwesomeIcon icon={faTrash} />
            </button>
            <button onClick={() => setIsOpen(false)} title="Close panel">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </div>
        <div 
          className="debug-panel-logs" 
          ref={logsContainerRef}
          onScroll={handleScroll}
        >
          {filteredLogs.length === 0 ? (
            <div className="debug-panel-empty">No logs yet</div>
          ) : (
            filteredLogs.map((log: LogEntry) => (
              <div key={log.id} className={`log-entry ${getLevelClass(log.level)}`}>
                <span className="log-time">{formatTime(log.timestamp)}</span>
                <span className="log-level">[{log.level.toUpperCase()}]</span>
                <span className="log-message">{formatArgs(log.args)}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </>
  );
}
