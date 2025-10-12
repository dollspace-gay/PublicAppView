/**
 * Security utilities for input validation and sanitization
 */

/**
 * Validates that a URL is safe to fetch from (prevents SSRF attacks)
 * @param url The URL to validate
 * @returns true if the URL is safe, false otherwise
 */
export function isUrlSafeToFetch(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only allow HTTP/HTTPS protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    
    // Prevent requests to localhost or private IP ranges
    const hostname = parsed.hostname.toLowerCase();
    
    // Block localhost variants
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname === '::1'
    ) {
      return false;
    }
    
    // Block private IP ranges (IPv4)
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = hostname.match(ipv4Regex);
    
    if (ipv4Match) {
      const octets = ipv4Match.slice(1).map(Number);
      
      // 10.0.0.0/8
      if (octets[0] === 10) {
        return false;
      }
      
      // 172.16.0.0/12
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
        return false;
      }
      
      // 192.168.0.0/16
      if (octets[0] === 192 && octets[1] === 168) {
        return false;
      }
      
      // 169.254.0.0/16 (link-local)
      if (octets[0] === 169 && octets[1] === 254) {
        return false;
      }
      
      // 127.0.0.0/8 (loopback)
      if (octets[0] === 127) {
        return false;
      }
    }
    
    // Block private IPv6 ranges
    if (hostname.includes(':')) {
      // Simplified check for private IPv6 addresses
      const lowerHostname = hostname.toLowerCase();
      
      // Link-local addresses (fe80::/10)
      if (lowerHostname.startsWith('fe80:') || lowerHostname.startsWith('[fe80:')) {
        return false;
      }
      
      // Unique local addresses (fc00::/7)
      if (lowerHostname.startsWith('fc') || lowerHostname.startsWith('fd') ||
          lowerHostname.startsWith('[fc') || lowerHostname.startsWith('[fd')) {
        return false;
      }
    }
    
    return true;
  } catch (error) {
    // Invalid URL format
    return false;
  }
}

/**
 * Sanitizes a URL path for safe use in HTML transformation
 * Removes potentially dangerous characters and patterns
 * @param url The URL to sanitize
 * @returns The sanitized URL
 */
export function sanitizeUrlPath(url: string): string {
  // Remove any null bytes
  let sanitized = url.replace(/\0/g, '');
  
  // Remove any script tags or javascript: protocol
  sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '');
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/on\w+=/gi, '');
  
  // Limit to reasonable length
  if (sanitized.length > 2048) {
    sanitized = sanitized.substring(0, 2048);
  }
  
  return sanitized;
}

/**
 * Validates that response content type is safe to proxy
 * @param contentType The content-type header value
 * @returns true if the content type is safe to proxy
 */
export function isContentTypeSafe(contentType: string | undefined): boolean {
  if (!contentType) {
    return true; // Allow if no content-type specified
  }
  
  const type = contentType.toLowerCase().split(';')[0].trim();
  
  // Allow common safe content types
  const safeTypes = [
    'application/json',
    'application/javascript',
    'text/plain',
    'image/',
    'video/',
    'audio/',
    'application/octet-stream',
    'application/cbor',
    'application/vnd.ipld.car',
  ];
  
  return safeTypes.some(safe => type.startsWith(safe));
}
