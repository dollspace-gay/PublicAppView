import { queryClient } from './queryClient';

// A simple wrapper around fetch to handle auth and errors

// --- Cookie-Based Authentication ---
// SECURITY: We use HttpOnly cookies for authentication instead of localStorage
// This prevents XSS attacks from stealing authentication tokens
// The backend sets the 'auth_token' cookie, and we just need to send it with 'credentials: include'

// --- CSRF Token Management ---
let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

async function fetchCSRFToken(): Promise<string> {
  // Return cached token if available
  if (csrfToken) return csrfToken;

  // Return existing promise if one is in progress
  if (csrfTokenPromise) return csrfTokenPromise;

  // Create new promise for token fetch
  csrfTokenPromise = (async () => {
    try {
      console.log('[CSRF] Fetching new token...');
      const res = await fetch('/api/csrf-token', {
        credentials: 'include', // Ensure cookies are sent
        headers: {
          Accept: 'application/json',
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.csrfToken) {
          csrfToken = data.csrfToken;
          console.log('[CSRF] Token fetched successfully');
          return csrfToken;
        } else {
          console.warn('[CSRF] No token in response:', data);
        }
      } else {
        console.warn(
          '[CSRF] Failed to fetch token:',
          res.status,
          res.statusText
        );
      }
    } catch (error) {
      console.warn('[CSRF] Failed to fetch token:', error);
    }

    // Clear the promise on error so we can retry
    csrfTokenPromise = null;
    return '';
  })();

  return csrfTokenPromise;
}

// Force refresh CSRF token
async function refreshCSRFToken(): Promise<string> {
  console.log('[CSRF] Forcing token refresh...');
  csrfToken = null;
  csrfTokenPromise = null;
  return fetchCSRFToken();
}

// Initialize CSRF token on load
fetchCSRFToken();

// --- Main API Request Logic ---
const request = async <T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  retryCount = 0
): Promise<T> => {
  const csrf = await fetchCSRFToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add CSRF token for state-changing requests
  if (csrf && method !== 'GET') {
    headers['X-CSRF-Token'] = csrf;
  }

  console.log(`[API] ${method} ${url}`, {
    hasCSRF: !!csrf,
    retryCount,
    usingCookieAuth: true,
  });

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include', // Send HttpOnly cookies (auth_token)
  });

  if (!response.ok) {
    // Handle CSRF token errors with retry
    if (response.status === 403 && method !== 'GET' && retryCount === 0) {
      try {
        const errorData = await response.json();
        if (
          errorData.error === 'CSRF validation failed' ||
          errorData.message?.includes('CSRF')
        ) {
          console.warn(
            '[CSRF] Token validation failed, refreshing token and retrying...'
          );
          await refreshCSRFToken();
          return request(method, url, body, retryCount + 1);
        }
      } catch {
        // If we can't parse the error, continue with normal error handling
      }
    }

    // On 401, invalidate session cache so UI updates
    if (response.status === 401) {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/session'] });
    }

    const error = new Error(
      `HTTP error! status: ${response.status}`
    ) as Error & { data?: unknown };
    try {
      error.data = await response.json();
    } catch {
      error.data = { message: 'Could not parse error response.' };
    }
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const api = {
  get: <T = unknown>(url: string): Promise<T> => request<T>('GET', url),
  post: <T = unknown>(url: string, body: unknown): Promise<T> =>
    request<T>('POST', url, body),
  put: <T = unknown>(url: string, body: unknown): Promise<T> =>
    request<T>('PUT', url, body),
  delete: <T = unknown>(url: string): Promise<T> => request<T>('DELETE', url),
  // Expose refresh function for manual CSRF token refresh if needed
  refreshCSRFToken,
};

export { api, refreshCSRFToken };
