import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { api } from "./api";

type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn =
  <T>(options?: { on401?: UnauthorizedBehavior }): QueryFunction<T> =>
  async ({ queryKey }) => {
    const url = queryKey.join("/");
    try {
      const data = await api.get<T>(url);
      return data;
    } catch (error: any) {
      if (options?.on401 === "returnNull" && error.response?.status === 401) {
        return null as T;
      }
      // Re-throw other errors to be handled by React Query
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: (failureCount, error: any) => {
        if (
          error.response?.status === 401 ||
          error.response?.status === 403 ||
          error.response?.status === 404
        ) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});