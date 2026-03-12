/**
 * Server-side in-memory cache for the live portfolio.
 * Module-level state persists across requests in the same Node.js process.
 * TTL default: 90 seconds.
 */

import { getLivePortfolio } from "./snapshot";

const TTL_MS = 90_000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  promise: Promise<T> | null;
}

type PortfolioData = Awaited<ReturnType<typeof getLivePortfolio>>;

const cache: CacheEntry<PortfolioData> = {
  data: null as unknown as PortfolioData,
  fetchedAt: 0,
  promise: null,
};

/**
 * Returns cached portfolio data if fresh, otherwise fetches and caches it.
 * Concurrent calls while a fetch is in-flight all await the same promise (no stampede).
 */
export async function getCachedPortfolio(): Promise<PortfolioData> {
  const now = Date.now();

  // Fresh cache — return immediately
  if (cache.data && now - cache.fetchedAt < TTL_MS) {
    return cache.data;
  }

  // Fetch already in-flight — wait for it
  if (cache.promise) {
    return cache.promise;
  }

  // Start a new fetch
  cache.promise = getLivePortfolio().then((data) => {
    cache.data = data;
    cache.fetchedAt = Date.now();
    cache.promise = null;
    return data;
  }).catch((err) => {
    cache.promise = null;
    // Return stale data if available rather than crashing
    if (cache.data) return cache.data;
    throw err;
  });

  return cache.promise;
}

/** Force-invalidate the cache (called after taking a snapshot). */
export function invalidatePortfolioCache() {
  cache.fetchedAt = 0;
  cache.promise = null;
}
