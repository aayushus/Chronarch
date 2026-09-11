export interface LaidOutEvent<T> {
  event: T;
  column: number;
  columnCount: number;
}

/** Greedy column packing for overlapping time-ranged events (day/week grid). */
export function packOverlaps<T>(
  events: T[],
  getStart: (e: T) => Date,
  getEnd: (e: T) => Date
): LaidOutEvent<T>[] {
  const sorted = [...events].sort((a, b) => getStart(a).getTime() - getStart(b).getTime());
  const columns: T[][] = [];

  const placement = new Map<T, number>();
  for (const event of sorted) {
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
  return sorted.map((event) => ({ event, column: placement.get(event)!, columnCount }));
}
