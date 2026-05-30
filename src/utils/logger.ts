export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[minLevel];
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) console.debug(`[debug] ${message}`, ...args);
  },
  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) console.info(`[info] ${message}`, ...args);
  },
  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) console.warn(`[warn] ${message}`, ...args);
  },
  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) console.error(`[error] ${message}`, ...args);
  },
};
