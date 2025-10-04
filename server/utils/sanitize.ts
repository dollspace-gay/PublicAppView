/**
 * Sanitization utilities for database operations
 * PostgreSQL doesn't allow null bytes (\u0000) in text/JSON columns
 */

/**
 * Remove null bytes from a string
 */
export function sanitizeString(str: string | null | undefined): string | null | undefined {
  if (str === null || str === undefined) return str;
  return str.replace(/\u0000/g, '');
}

/**
 * Recursively sanitize all string values in an object
 * This removes null bytes that PostgreSQL cannot handle
 */
export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj) as T;
  }

  // Preserve Date objects and other special types
  if (obj instanceof Date || obj instanceof RegExp || obj instanceof Error) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item)) as T;
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }

  return obj;
}
