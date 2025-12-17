type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  args: unknown[];
}

type LogListener = () => void;

class AppLogger {
  private static instance: AppLogger;
  private logs: LogEntry[] = [];
  private snapshot: LogEntry[] = [];
  private maxLogs = 500;
  private idCounter = 0;
  private listeners: Set<LogListener> = new Set();
  private consoleEnabled: boolean;

  private constructor() {
    this.consoleEnabled =
      new URLSearchParams(window.location.search).has('console') ||
      localStorage.getItem('modulr-console') === 'true';
  }

  static getInstance(): AppLogger {
    if (!AppLogger.instance) {
      AppLogger.instance = new AppLogger();
    }
    return AppLogger.instance;
  }

  private updateSnapshot(): void {
    this.snapshot = [...this.logs];
  }

  private add(level: LogLevel, args: unknown[]): void {
    const entry: LogEntry = {
      id: ++this.idCounter,
      timestamp: Date.now(),
      level,
      args,
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    if (this.consoleEnabled) {
      console[level](...args);
    }

    this.updateSnapshot();
    
    this.listeners.forEach((cb) => cb());
  }

  log = (...args: unknown[]): void => this.add('info', args);
  info = (...args: unknown[]): void => this.add('info', args);
  warn = (...args: unknown[]): void => this.add('warn', args);
  error = (...args: unknown[]): void => this.add('error', args);
  debug = (...args: unknown[]): void => this.add('debug', args);

  getSnapshot = (): LogEntry[] => this.snapshot;
  
  clear = (): void => {
    this.logs = [];
    this.updateSnapshot();
    this.listeners.forEach((cb) => cb());
  };

  subscribe = (cb: LogListener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  setConsoleOutput(enabled: boolean): void {
    this.consoleEnabled = enabled;
    localStorage.setItem('modulr-console', String(enabled));
  }

  isConsoleEnabled = (): boolean => this.consoleEnabled;

  exportLogs = (): string => {
    return this.logs
      .map((log) => {
        const time = new Date(log.timestamp).toISOString();
        const argsStr = log.args
          .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
          .join(' ');
        return `[${time}] [${log.level.toUpperCase()}] ${argsStr}`;
      })
      .join('\n');
  };
}

export const logger = AppLogger.getInstance();
