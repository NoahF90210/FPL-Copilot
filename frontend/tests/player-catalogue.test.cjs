const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

// Exercise the production TS helper with the project's existing compiler, no new test dependency.
const source = fs.readFileSync(path.join(__dirname, "../lib/player-catalogue.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const context = { exports: {} };
vm.runInNewContext(compiled.outputText, context);
const { forecastsAreCurrent, isPlayerCatalogue, withPlayerForecasts } = context.exports;
const snapshot = require("../data/player-catalogue.json");
const catalogue = { ...snapshot, source: "official_fpl" };

function syntheticForecast() {
  return {
    serving_mode: "database", is_stale: false, target_gameweek: 11,
    generated_at: new Date().toISOString(),
    players: [{ ...snapshot.players[0], season: snapshot.season, target_gameweek: 11, predicted_points: 9.75 }],
  };
}

test("bundled snapshot has valid identity, stats and provenance", () => {
  assert.ok(isPlayerCatalogue(snapshot));
  assert.ok(withPlayerForecasts(snapshot, null).every((p) => p.predicted_points === undefined));
});

test("rejects empty, duplicate, malformed and nonfinite catalogue responses", () => {
  for (const invalid of [null, {}, { ...catalogue, players: [], total: 0 },
    { ...catalogue, total: 2, players: [snapshot.players[0], snapshot.players[0]] },
    { ...catalogue, total: 1, players: [{ ...snapshot.players[0], price: Infinity }] },
    { ...catalogue, fetched_at: "not a timestamp" }]) assert.equal(isPlayerCatalogue(invalid), false);
});

test("only current database forecasts can join live official stats", () => {
  const forecast = syntheticForecast();
  assert.equal(withPlayerForecasts(catalogue, forecast)[0].predicted_points, 9.75);
  assert.equal(withPlayerForecasts(snapshot, forecast)[0].predicted_points, undefined);
  assert.equal(withPlayerForecasts(catalogue, { ...forecast, serving_mode: "unavailable" })[0].predicted_points, undefined);
  assert.equal(withPlayerForecasts(catalogue, { ...forecast, is_stale: true })[0].predicted_points, undefined);
  assert.equal(withPlayerForecasts(catalogue, { ...forecast, generated_at: "2020-01-01T00:00:00Z" })[0].predicted_points, undefined);
});

test("refuses reused IDs, wrong season, changed identity/status and invalid values", () => {
  for (const overrides of [
    { player_code: -1 }, { season: "2025/26" }, { full_name: "Different person" },
    { name: "Changed display" }, { team_short: "OTHER" }, { position: "OTHER" },
    { status: "i" }, { target_gameweek: 1 }, { predicted_points: Infinity }, { predicted_points: -1 },
  ]) {
    const forecast = syntheticForecast();
    Object.assign(forecast.players[0], overrides);
    assert.equal(withPlayerForecasts(catalogue, forecast)[0].predicted_points, undefined, JSON.stringify(overrides));
  }
});

test("freshness handles UTC timestamps without suffix and rejects future/expired data", () => {
  const now = Date.parse("2026-11-07T19:00:00Z");
  const forecast = { ...syntheticForecast(), generated_at: "2026-11-07T18:00:00" };
  assert.equal(forecastsAreCurrent(forecast, now), true);
  assert.equal(forecastsAreCurrent({ ...forecast, generated_at: "2026-11-08T18:00:00Z" }, now), false);
  assert.equal(forecastsAreCurrent({ ...forecast, generated_at: "2026-11-01T18:00:00Z" }, now), false);
});

test("malformed forecast payloads fail closed without taking down descriptive rows", () => {
  for (const players of ["bad", [null], [{}], [42], [syntheticForecast().players[0], syntheticForecast().players[0]],
    [{ ...syntheticForecast().players[0], next_opponent: {} }]]) {
    const malformed = { ...syntheticForecast(), players };
    assert.equal(forecastsAreCurrent(malformed), false);
    const rows = withPlayerForecasts(catalogue, malformed);
    assert.equal(rows.length, snapshot.total);
    assert.ok(rows.every((row) => row.predicted_points === undefined));
  }
});
