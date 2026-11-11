export function createConcurrencyLimiter(maxConcurrency: number) {
  const limit = Math.max(1, Math.floor(maxConcurrency));
  let active = 0;
  const waiters: Array<() => void> = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    } else {
      active += 1;
    }

    try {
      return await task();
    } finally {
      const next = waiters.shift();
      if (next) {
        // Transfer the occupied slot directly to the next waiter.
        next();
      } else {
        active -= 1;
      }
    }
  };
}
