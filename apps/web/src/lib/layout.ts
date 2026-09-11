export interface LaidOutEvent<T> {
  event: T;
  column: number;
  columnCount: number;
}

/**
 * Greedy column packing for overlapping time-ranged events (day/week grid).
 *
 * Column count is computed per *cluster* of transitively-overlapping events,
 * not globally for the whole input — otherwise one unrelated overlap
 * anywhere in the set (e.g. two early-morning events scrolled out of view)
 * would force every other, non-overlapping event to split width with a
 * phantom neighbor it never actually touches.
 */
export function packOverlaps<T>(
  events: T[],
  getStart: (e: T) => Date,
  getEnd: (e: T) => Date
): LaidOutEvent<T>[] {
  const sorted = [...events].sort((a, b) => getStart(a).getTime() - getStart(b).getTime());

  const clusters: T[][] = [];
  let clusterEnd = -Infinity;
  for (const event of sorted) {
    if (clusters.length > 0 && getStart(event).getTime() < clusterEnd) {
      clusters[clusters.length - 1].push(event);
    } else {
      clusters.push([event]);
    }
    clusterEnd = Math.max(clusterEnd, getEnd(event).getTime());
  }

  const result: LaidOutEvent<T>[] = [];
  for (const cluster of clusters) {
    const columns: T[][] = [];
    const placement = new Map<T, number>();
    for (const event of cluster) {
      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        const last = columns[i][columns[i].length - 1];
        if (getEnd(last).getTime() <= getStart(event).getTime()) {
          columns[i].push(event);
          placement.set(event, i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([event]);
        placement.set(event, columns.length - 1);
      }
    }
    const columnCount = columns.length || 1;
    for (const event of cluster) {
      result.push({ event, column: placement.get(event)!, columnCount });
    }
  }

  return result;
}
