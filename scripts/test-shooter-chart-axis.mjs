import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPerformanceChartData,
  roundEndTimestamp,
  selectXAxisTicks,
  xAxisTickLimit,
} from "../src/lib/shooter-chart-axis.mjs";

function dateAtDay(day) {
  const date = new Date(Date.UTC(2024, 0, 1) + day * 86_400_000);
  return date.toISOString().slice(0, 10);
}

test("duplicate Round End timestamps remain plotted but produce unique axis ticks", () => {
  const points = [
    { event_key: "first", round_end_date: "2025-03-15" },
    { event_key: "second", round_end_date: "2025-03-15" },
    { event_key: "third", round_end_date: "2025-04-15" },
  ];
  const chartData = buildPerformanceChartData(points);
  const ticks = selectXAxisTicks(
    chartData.map((point) => point.round_end_timestamp),
    xAxisTickLimit(1024),
  );

  assert.equal(chartData.length, 3);
  assert.equal(chartData[0].round_end_timestamp, chartData[1].round_end_timestamp);
  assert.deepEqual(ticks, [
    roundEndTimestamp("2025-03-15"),
    roundEndTimestamp("2025-04-15"),
  ]);
  assert.equal(new Set(ticks).size, ticks.length);
});

test("138 points across two years keep every point and use bounded representative ticks", () => {
  const points = Array.from({ length: 138 }, (_, index) => ({
    event_key: `event-${index}`,
    // 138 physical scores over 125 unique dates deliberately includes shared dates.
    round_end_date: dateAtDay(Math.round(Math.round(index * 124 / 137) * 729 / 124)),
  }));
  const chartData = buildPerformanceChartData(points);
  const timestamps = chartData.map((point) => point.round_end_timestamp);
  const uniqueTimestamps = [...new Set(timestamps)].sort((left, right) => left - right);
  const desktopTicks = selectXAxisTicks(timestamps, xAxisTickLimit(1024));
  const mobileTicks = selectXAxisTicks(timestamps, xAxisTickLimit(390));
  const printTicks = selectXAxisTicks(timestamps, xAxisTickLimit(1024, true));

  assert.equal(chartData.length, 138);
  assert.equal(uniqueTimestamps.length, 125);
  assert.equal(desktopTicks.length, 10);
  assert.equal(mobileTicks.length, 5);
  assert.equal(printTicks.length, 8);
  assert.equal(new Set(desktopTicks).size, desktopTicks.length);
  assert.equal(desktopTicks[0], uniqueTimestamps[0]);
  assert.equal(desktopTicks.at(-1), uniqueTimestamps.at(-1));
  assert.ok(desktopTicks.every((tick, index) => index === 0 || tick > desktopTicks[index - 1]));
});
