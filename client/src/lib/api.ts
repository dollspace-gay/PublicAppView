import { queryClient } from "./queryClient";

// A simple wrapper around fetch to handle auth and errors

// --- Auth Token Management ---
const getAuthToken = (): string | null => {
  try {
    return localStorage.getItem("dashboard_token");
  } catch (error) {
    console.error("Failed to read from localStorage:", error);
    return null;
  }
};

const setAuthToken = (token: string): void => {
  try {
    localStorage.setItem("dashboard_token", token);
  } catch (error) {
    console.error("Failed to write to localStorage:", error);
  }
};

const clearAuthToken = (): void => {
  try {
    localStorage.removeItem("dashboard_token");
  } catch (error) {
    console.error("Failed to remove from localStorage:", error);
  }
};

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
          'Accept': 'application/json',
        }
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
        console.warn('[CSRF] Failed to fetch token:', res.status, res.statusText);
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
const request = async (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: any,
  retryCount = 0,
): Promise<any> => {
  const authToken = getAuthToken();
  const csrf = await fetchCSRFToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  if (csrf && method !== 'GET') {
    headers['X-CSRF-Token'] = csrf;
  }

  console.log(`[API] ${method} ${url}`, { 
    hasAuth: !!authToken, 
    hasCSRF: !!csrf, 
    retryCount 
  });

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include', // Ensure cookies are sent
  });

  if (!response.ok) {
    // Handle CSRF token errors with retry
    if (response.status === 403 && method !== 'GET' && retryCount === 0) {
      try {
        const errorData = await response.json();
        if (errorData.error === 'CSRF validation failed' || 
            errorData.message?.includes('CSRF')) {
          console.warn('[CSRF] Token validation failed, refreshing token and retrying...');
          await refreshCSRFToken();
          return request(method, url, body, retryCount + 1);
        }
      } catch (e) {
        // If we can't parse the error, continue with normal error handling
      }
    }

    if (response.status === 401) {
      clearAuthToken();
      queryClient.invalidateQueries({ queryKey: ['/api/auth/session'] });
    }
    
    const error: any = new Error(`HTTP error! status: ${response.status}`);
    try {
      error.data = await response.json();
    } catch (e) {
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
  get: <T>(url: string): Promise<T> => request('GET', url),
  post: <T>(url: string, body: any): Promise<T> => request('POST', url, body),
  put: <T>(url: string, body: any): Promise<T> => request('PUT', url, body),
  delete: <T>(url: string): Promise<T> => request('DELETE', url),
  // Expose refresh function for manual token refresh if needed
  refreshCSRFToken,
};

export { api, setAuthToken, refreshCSRFToken };