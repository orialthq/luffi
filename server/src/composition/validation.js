import { createHash } from "node:crypto";
import { AppError } from "../errors.js";
import { normalizeIsoTimestamp } from "../common/iso_time.js";

export class ResourceError extends AppError {
  constructor(code, message) {
    super(code, message, { httpStatus: code === "RESOURCE_NOT_FOUND" ? 404 :
      code === "INVALID_RESOURCE_STATE" ? 500 :
        ["RESOURCE_COMMAND_CONFLICT", "RESOURCE_REVISION_CONFLICT", "RESOURCE_ID_EXISTS",
          "RESOURCE_UNAVAILABLE", "RESOURCE_CAPACITY_CONFLICT", "RESOURCE_CLAIM_RELEASED",
          "RESOURCE_OBSERVATION_OUTDATED"].includes(code) ? 409 : 422 });
    this.name = "ResourceError";
  }
}

export function fail(code, message) { throw new ResourceError(code, message); }
export function object(value, label, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_RESOURCE_INPUT", `${label} must be a plain object`);
  }
  for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key) || (allowed && !allowed.includes(key))) {
      fail("INVALID_RESOURCE_INPUT", `${label}.${key} is not supported`);
    }
  }
  return value;
}
export function string(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    fail("INVALID_RESOURCE_INPUT", `${label} must be a nonempty string of at most 512 characters`);
  }
  return value;
}
export function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail("INVALID_RESOURCE_INPUT", `${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}
export function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) fail("INVALID_RESOURCE_INPUT", `${label} must be one of ${allowed.join(", ")}`);
  return value;
}
export function date(value, label) {
  const normalized = normalizeIsoTimestamp(value, { minYear: 1970 });
  if (!normalized) fail("INVALID_RESOURCE_INPUT", `${label} must be a real ISO timestamp with timezone and millisecond or coarser precision`);
  return normalized;
}
export function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  return date(value instanceof Date ? value.toISOString() : value ?? new Date().toISOString(), "now");
}
export function timeRange(value, label = "timeRange") {
  if (value == null) return null;
  object(value, label, ["start", "end"]);
  const start = date(value.start, `${label}.start`);
  const end = date(value.end, `${label}.end`);
  if (start >= end) fail("INVALID_RESOURCE_INPUT", `${label} must have start before end`);
  return { start, end };
}
export function json(value, depth = 0, ancestors = new Set()) {
  if (depth > 32) fail("INVALID_RESOURCE_INPUT", "JSON is too deeply nested");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ancestors.has(value)) fail("INVALID_RESOURCE_INPUT", "Only finite acyclic JSON is accepted");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from(value, (item) => json(item, depth + 1, ancestors));
    }
    object(value, "JSON");
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item, depth + 1, ancestors)]));
  } finally { ancestors.delete(value); }
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function fingerprint(value) { return createHash("sha256").update(stableJson(value)).digest("hex"); }

export function unitPolicy(value) {
  object(value, "unitPolicy", ["canonicalUnit", "precision", "conversions"]);
  const canonicalUnit = string(value.canonicalUnit, "unitPolicy.canonicalUnit");
  const precision = integer(value.precision, "unitPolicy.precision", 0, 6);
  const conversions = value.conversions ?? [];
  if (!Array.isArray(conversions)) fail("INVALID_RESOURCE_INPUT", "unitPolicy.conversions must be an array");
  const units = new Set([canonicalUnit]);
  return { canonicalUnit, precision, conversions: conversions.map((conversion) => {
    object(conversion, "unit conversion", ["unit", "factor"]);
    const unit = string(conversion.unit, "unit conversion.unit");
    if (units.has(unit)) fail("INVALID_RESOURCE_INPUT", "Unit conversion must be unique and cannot replace the canonical unit");
    units.add(unit);
    if (typeof conversion.factor !== "number" || !Number.isFinite(conversion.factor) || conversion.factor <= 0) {
      fail("INVALID_RESOURCE_INPUT", "Unit conversion.factor must be finite and positive");
    }
    return { unit, factor: conversion.factor };
  }) };
}

// Decimal arithmetic at the public JSON boundary prevents 0.1 + 0.2 capacity
// errors. BigInts are only temporary; persisted quantities use safe integer units.
function fraction(value) {
  const [mantissa, exponent = "0"] = value.toString().toLowerCase().split("e");
  const [whole, decimal = ""] = mantissa.split(".");
  const power = Number(exponent) - decimal.length;
  const numerator = BigInt(whole + decimal);
  return power >= 0 ? [numerator * 10n ** BigInt(power), 1n] : [numerator, 10n ** BigInt(-power)];
}
export function quantityUnits(quantity, unit, policy, { positive = false } = {}) {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0 || (positive && quantity === 0)) {
    fail("INVALID_RESOURCE_INPUT", `quantity must be finite and ${positive ? "positive" : "nonnegative"}`);
  }
  string(unit, "unit");
  const factor = unit === policy.canonicalUnit ? 1 : policy.conversions.find((item) => item.unit === unit)?.factor;
  if (factor == null) fail("RESOURCE_UNIT_MISMATCH", `No explicit conversion from ${unit} to ${policy.canonicalUnit}`);
  const [quantityN, quantityD] = fraction(quantity);
  const [factorN, factorD] = fraction(factor);
  const numerator = quantityN * factorN * 10n ** BigInt(policy.precision);
  const denominator = quantityD * factorD;
  if (numerator % denominator !== 0n) fail("RESOURCE_PRECISION_MISMATCH", "Quantity cannot be represented by the resource's precision without rounding");
  const result = numerator / denominator;
  // At most 15 decimal digits also keep the public numeric quantity faithful
  // after dividing by its scale; MAX_SAFE_INTEGER alone is not sufficient there.
  if (result > 999999999999999n) fail("INVALID_RESOURCE_INPUT", "Canonical quantity exceeds supported decimal precision");
  return Number(result);
}
export function displayQuantity(units, policy) { return units / 10 ** policy.precision; }
