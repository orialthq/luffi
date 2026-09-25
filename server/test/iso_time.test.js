import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIsoTimestamp } from "../src/common/iso_time.js";

test("strict ISO timestamps normalize equivalent zone instants and millisecond precision", () => {
  assert.equal(normalizeIsoTimestamp("2026-09-25T18:30:00.5+09:00"), "2026-09-25T09:30:00.500Z");
  assert.equal(normalizeIsoTimestamp("2026-09-25T09:30:00.500Z"), "2026-09-25T09:30:00.500Z");
  assert.equal(normalizeIsoTimestamp("2024-02-29T23:59:59-14:00"), "2024-03-01T13:59:59.000Z");
  assert.equal(normalizeIsoTimestamp("2000-02-29T00:00:00+14:00"), "2000-02-28T10:00:00.000Z");
});

test("strict ISO timestamps reject calendar rollover, invalid offsets, and unsupported precision", () => {
  for (const value of [
    "2026-02-29T12:00:00Z", "1900-02-29T12:00:00Z", "2026-02-30T12:00:00Z",
    "2026-04-31T12:00:00Z", "2026-09-25T24:00:00Z", "2026-09-25T12:00:60Z",
    "2026-09-25T12:00:00+14:01", "2026-09-25T12:00:00-15:00",
    "2026-09-25T12:00:00+09:60", "2026-09-25T12:00:00.1234Z",
    "2026-09-25T12:00:00", "2026-09-25", 42, null,
  ]) assert.equal(normalizeIsoTimestamp(value), null, `${String(value)} should be rejected`);
});

test("resources can require a later minimum year without changing other domains", () => {
  assert.equal(normalizeIsoTimestamp("1969-12-31T23:59:59Z", { minYear: 1970 }), null);
  assert.equal(normalizeIsoTimestamp("1970-01-01T00:00:00Z", { minYear: 1970 }), "1970-01-01T00:00:00.000Z");
  assert.equal(normalizeIsoTimestamp("1969-12-31T23:59:59Z"), "1969-12-31T23:59:59.000Z");
});
