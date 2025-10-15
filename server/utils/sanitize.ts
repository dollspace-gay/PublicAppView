/**
 * Database sanitization utilities for null byte handling
 * PostgreSQL doesn't allow null bytes (\u0000) in text/JSON columns
 */

/**
 * Remove null bytes from a string
 * PostgreSQL cannot store null bytes in text/JSON fields
 */
export function sanitizeString(
  str: string | null | undefined
): string | null | undefined {
  if (str === null || str === undefined) return str;
  return str.replace(/\u0000/g, '');
}

/**
 * Recursively remove null bytes from all string values in an object
 *
 * ⚠️ SECURITY WARNING: This function does NOT sanitize for XSS, SQL injection, or other security vulnerabilities!
 * It ONLY removes null bytes (\u0000) that PostgreSQL cannot handle.
 *
 * For security sanitization:
 * - Use proper HTML escaping for user-facing outputs (React does this by default)
 * - Use parameterized queries for SQL (Drizzle ORM handles this)
 * - Validate and sanitize user inputs before rendering or storing
 *
 * @param obj - The object to process
 * @returns A new object with null bytes removed from all string values
 */
export function removeNullBytesFromObject<T>(obj: T): T {
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
    return obj.map((item) => removeNullBytesFromObject(item)) as T;
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = removeNullBytesFromObject(value);
    }
    return sanitized;
  }

  return obj;
}

/**
 * @deprecated Use removeNullBytesFromObject() instead for clarity.
 * The name "sanitizeObject" is misleading - this function only removes null bytes,
 * it does NOT sanitize for security vulnerabilities like XSS or SQL injection.
 */
export function sanitizeObject<T>(obj: T): T {
  return removeNullBytesFromObject(obj);
}
