import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

const isDevelopment = process.env.NODE_ENV !== "production";

const queryCache = new QueryCache({
  onError: (error, query) => {
    if (!isDevelopment) return;
    // eslint-disable-next-line no-console
    console.error("[TanStack Query] Query failed", {
      queryKey: query?.queryKey,
      error,
    });
  },
});

const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    if (!isDevelopment) return;
    // eslint-disable-next-line no-console
    console.error("[TanStack Query] Mutation failed", {
      mutationKey: mutation?.options?.mutationKey,
      error,
    });
  },
});

export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: { retry: 0 },
  },
});

export default queryClient;
