import { useState, useEffect, useCallback } from "react";

export const fetchAPI = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
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
