const DEFAULT_TICK_LIMIT = 10;

/** @param {string} date */
export function roundEndTimestamp(date) {
  return Date.parse(`${date}T00:00:00Z`);
}

/** @param {Array<Record<string, unknown> & { round_end_date: string }>} points */
export function buildPerformanceChartData(points) {
  return points.map((point) => ({
    ...point,
    round_end_timestamp: roundEndTimestamp(point.round_end_date),
  }));
}

/**
 * Keep printed charts predictable, while allowing fewer labels on narrow screens.
 * The default is also used for the server render before the container is measured.
 *
 * @param {number | null} width
 * @param {boolean} printing
 */
export function xAxisTickLimit(width, printing = false) {
  if (printing) return 8;
  if (width === null || width <= 0) return DEFAULT_TICK_LIMIT;
  if (width < 480) return 5;
  if (width < 768) return 6;
  if (width >= 1280) return 12;
  return DEFAULT_TICK_LIMIT;
}

/**
 * Choose unique timestamps at evenly distributed indices, including both ends.
 *
 * @param {readonly number[]} timestamps
 * @param {number} limit
 */
export function selectXAxisTicks(timestamps, limit) {
  const uniqueTimestamps = [...new Set(timestamps)].sort((left, right) => left - right);
  if (uniqueTimestamps.length <= limit) return uniqueTimestamps;
  if (limit <= 1) return uniqueTimestamps.slice(0, 1);

  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round(index * (uniqueTimestamps.length - 1) / (limit - 1));
    return uniqueTimestamps[sourceIndex];
  });
}
