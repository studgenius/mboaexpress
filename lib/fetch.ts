import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/expo";

/**
 * Token getter function type — matches the shape returned by Clerk's
 * useAuth().getToken without depending on the hook at module level.
 */
export type TokenGetter = () => Promise<string | null>;

/**
 * Calls fetch with the Authorization header set to the Clerk session token.
 * The token getter is passed in by the caller (typically from useAuth().getToken)
 * to keep this function usable outside React component scope.
 */
export async function authFetch(
  url: string,
  getToken: TokenGetter,
  options?: RequestInit,
): Promise<any> {
  const token = await getToken();

  if (!token) {
    throw new Error("Authentication required. Please sign in again.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(options?.headers as Record<string, string> | undefined),
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export const fetchAPI = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
};

/**
 * useAuthFetch — same shape as useFetch but injects the Clerk session
 * token as a Bearer header on every request.
 */
export const useAuthFetch = <T>(url: string | null, options?: RequestInit) => {
  const { getToken } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!url) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await authFetch(url, getToken, options);
      setData(result.data ?? result);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    } finally {
      setLoading(false);
    }
  }, [url, options, getToken]);

  useEffect(() => {
    let cancelled = false;

    if (!url) {
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      try {
        const result = await authFetch(url, getToken, options);

        if (!cancelled) {
          setData(result.data ?? result);
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "An unexpected error occurred.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    const start = async () => {
      await Promise.resolve();

      if (!cancelled) {
        setLoading(true);
        void load();
      }
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, [url, options, getToken]);

  return { data, loading, error, refetch: fetchData };
};

export const useFetch = <T>(url: string | null, options?: RequestInit) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!url) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await fetchAPI(url, options);
      setData(result.data ?? result);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    } finally {
      setLoading(false);
    }
  }, [url, options]);

  useEffect(() => {
    let cancelled = false;

    if (!url) {
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      try {
        const result = await fetchAPI(url, options);

        if (!cancelled) {
          setData(result.data ?? result);
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "An unexpected error occurred.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    const start = async () => {
      await Promise.resolve();

      if (!cancelled) {
        setLoading(true);
        void load();
      }
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, [url, options]);

  return { data, loading, error, refetch: fetchData };
};
