/**
 * The data key used for new writes: the newest key whose activation time has
 * passed. A key created by a rotation is loaded by every instance before it
 * activates; if none is activated yet (clock skew right after the first key
 * is created), the earliest key is used.
 */
export function pickActiveKey<T extends { activated_at: Date }>(
  rows: T[],
  now: Date,
): T | undefined {
  const byActivation = [...rows].sort(
    (a, b) => a.activated_at.getTime() - b.activated_at.getTime(),
  );
  const activated = byActivation.filter(
    (row) => row.activated_at.getTime() <= now.getTime(),
  );
  return activated[activated.length - 1] ?? byActivation[0];
}
