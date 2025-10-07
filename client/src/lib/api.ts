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

async function fetchCSRFToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  try {
    const res = await fetch('/api/csrf-token');
    if (res.ok) {
      const data = await res.json();
      csrfToken = data.csrfToken;
      return csrfToken!;
    }
  } catch (error) {
    console.warn('[CSRF] Failed to fetch token:', error);
  }
  return '';
}

// Initialize CSRF token on load
fetchCSRFToken();

// --- Main API Request Logic ---
const request = async (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: any,
) => {
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

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
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
};

export { api, setAuthToken };