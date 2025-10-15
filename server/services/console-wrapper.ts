/**
 * Console Wrapper with Log Aggregation
 *
 * Provides aggregated console methods that reduce log spam by grouping
 * similar messages and only outputting them periodically.
 */

import { logAggregator } from './log-aggregator';

interface ConsoleWrapper {
  log: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
}

class AggregatedConsole implements ConsoleWrapper {
  log(message: string, ...args: any[]) {
    const fullMessage =
      args.length > 0 ? `${message} ${args.join(' ')}` : message;
    logAggregator.log(fullMessage);
  }

  warn(message: string, ...args: any[]) {
    const fullMessage =
      args.length > 0 ? `${message} ${args.join(' ')}` : message;
    logAggregator.warn(fullMessage);
  }

  error(message: string, ...args: any[]) {
    const fullMessage =
      args.length > 0 ? `${message} ${args.join(' ')}` : message;
    logAggregator.error(fullMessage);
  }

  info(message: string, ...args: any[]) {
    const fullMessage =
      args.length > 0 ? `${message} ${args.join(' ')}` : message;
    logAggregator.log(fullMessage);
  }
}

// Create the aggregated console instance
export const aggregatedConsole = new AggregatedConsole();

// Helper function to check if a log message should be aggregated
export function shouldAggregateLog(message: string): boolean {
  // Aggregate logs that are likely to be spammy
  const spammyPatterns = [
    /\[DID_RESOLVER\].*(?:Timeout|Network error|Attempt.*failed|Circuit breaker)/,
  ];

  return spammyPatterns.some((pattern) => pattern.test(message));
}

// Enhanced console wrapper that conditionally aggregates
export class SmartConsole implements ConsoleWrapper {
  log(message: string, ...args: any[]) {
    const fullMessage =
      args.length > 0 ? `${message} ${args.join(' ')}` : message;

    if (shouldAggregateLog(fullMessage)) {
      logAggregator.log(fullMessage);
    } else {
      console.log(fullMessage);
    }
  }

  warn(message: string, ...args: any[]) {
    const fullMessage =
      args.length > 0 ? `${message} ${args.join(' ')}` : message;

    if (shouldAggregateLog(fullMessage)) {
      logAggregator.warn(fullMessage);
    } else {
      console.warn(fullMessage);
    }
  }

  error(message: string, ...args: any[]) {
    const fullMessage =
      args.length > 0 ? `${message} ${args.join(' ')}` : message;

    if (shouldAggregateLog(fullMessage)) {
      logAggregator.error(fullMessage);
    } else {
      console.error(fullMessage);
    }
  }

  info(message: string, ...args: any[]) {
    const fullMessage =
      args.length > 0 ? `${message} ${args.join(' ')}` : message;

    if (shouldAggregateLog(fullMessage)) {
      logAggregator.log(fullMessage);
    } else {
      console.log(fullMessage);
    }
  }
}

// Export the smart console as the default
export const smartConsole = new SmartConsole();
