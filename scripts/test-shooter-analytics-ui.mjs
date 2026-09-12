import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Statistics is a routed shooter destination backed by one server RPC", async () => {
  const [shell, page, data] = await Promise.all([
    read("src/components/app-shell.tsx"),
    read("src/app/(app)/statistics/page.tsx"),
    read("src/lib/shooter-analytics.ts"),
  ]);
  assert.match(shell, /label: "Statistics"[\s\S]*href: "\/statistics"/);
  assert.doesNotMatch(shell, /Competition statistics are not available yet/);
  assert.match(page, /getMyShooterAnalytics\(filters\.rpc\)/);
  assert.match(data, /supabase\.rpc\("get_my_shooter_analytics", filters\)/);
  assert.doesNotMatch(page, /shooting_score_values|competition_score_usages/);
});

test("analytics UI covers empty, one-point, responsive, filter, tooltip and text-equivalent contracts", async () => {
  const [dashboard, chart] = await Promise.all([
    read("src/components/shooter-analytics-dashboard.tsx"),
    read("src/components/shooter-performance-chart.tsx"),
  ]);
  assert.match(dashboard, /No released scores yet/);
  assert.match(dashboard, /No scores match these filters/);
  assert.match(dashboard, /summary\.physical_shoot_count === 0/);
  assert.match(dashboard, /Season[\s\S]*Equipment[\s\S]*Position \/ style[\s\S]*Distance/);
  assert.match(dashboard, /defaultValue=\{value\}/);
  assert.match(dashboard, /Component view:/);
  assert.match(dashboard, /max-w-full overflow-x-auto/);
  assert.match(chart, /ResponsiveContainer width="100%" height="100%"/);
  assert.match(chart, /accessibilityLayer/);
  assert.match(chart, /View chart as text/);
  assert.match(chart, /Round end/);
  assert.match(chart, /achieved/);
  assert.match(chart, /point\.x_total/);
  assert.match(chart, /dot=\{\{/);
  assert.doesNotMatch(`${dashboard}\n${chart}`, />\s*\{?(?:point\.)?(?:source_id|competition_id|season_id)\}?\s*</);
});

test("filter parser rejects malformed URL state without forwarding ownership claims", async () => {
  const data = await read("src/lib/shooter-analytics.ts");
  assert.match(data, /positiveIntegerPattern/);
  assert.match(data, /fixedDistancePattern/);
  assert.match(data, /p_season_id/);
  assert.match(data, /p_position_mode/);
  assert.match(data, /p_distance_mode/);
  assert.doesNotMatch(data, /p_shooter|shooter_profile_id/);
});
