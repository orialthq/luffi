import { AppError } from "../errors.js";

export class DomainContractError extends AppError {
  constructor(code, message, path = "$", options = {}) {
    super(code, `${path}: ${message}`, { httpStatus: 400, ...options });
    this.name = "DomainContractError";
    this.path = path;
  }
}

export const ref = ($ref) => ({ $ref });
export const text = { type: "string", minLength: 1 };
export const positive = { type: "number", exclusiveMinimum: 0 };
export const nonnegative = { type: "number", minimum: 0 };
export const integer = { type: "integer", minimum: 1 };
export const enumeration = (...values) => ({ enum: values });
export const array = (items, minItems = 0) => ({ type: "array", items, minItems });
export const object = (properties, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false,
});

export function fail(message, path = "$") {
  throw new DomainContractError("INVALID_DOMAIN_VALUE", message, path);
}

function isTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour < 24 && minute < 60 && second < 60;
}

// Deliberately small schema vocabulary. These are repository-owned contracts,
// not arbitrary JSON Schema documents or executable model output.
export function validateSchema(schema, value, resolveType, path = "$") {
  if (schema.$ref) {
    const type = resolveType(schema.$ref);
    validateSchema(type.schema, value, resolveType, path);
    type.validate?.(value);
    return value;
  }
  if (schema.oneOf) {
    let matches = 0;
    for (const candidate of schema.oneOf) {
      try {
        validateSchema(candidate, value, resolveType, path);
        matches += 1;
      } catch (error) {
        if (!(error instanceof DomainContractError) || error.code !== "INVALID_DOMAIN_VALUE") throw error;
      }
    }
    if (matches !== 1) fail("must match exactly one registered value shape", path);
    return value;
  }
  if (schema.enum) {
    if (!schema.enum.includes(value)) fail(`must be one of ${schema.enum.join(", ")}`, path);
    return value;
  }
  switch (schema.type) {
    case "string":
      if (typeof value !== "string" || value.trim().length < (schema.minLength ?? 0)) fail("must be a nonempty string", path);
      if (schema.format === "date-time" && !isTimestamp(value)) {
        fail("must be an ISO date-time with a timezone", path);
      }
      break;
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isSafeInteger(value))) fail(`must be a finite safe ${schema.type}`, path);
      if (schema.minimum !== undefined && value < schema.minimum) fail(`must be at least ${schema.minimum}`, path);
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail(`must be greater than ${schema.exclusiveMinimum}`, path);
      break;
    case "boolean":
      if (typeof value !== "boolean") fail("must be a boolean", path);
      break;
    case "array":
      if (!Array.isArray(value)) fail("must be an array", path);
      if (value.length < (schema.minItems ?? 0)) fail(`requires at least ${schema.minItems} items`, path);
      value.forEach((item, index) => validateSchema(schema.items, item, resolveType, `${path}[${index}]`));
      break;
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("must be a plain object", path);
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key)) fail("is required", `${path}.${key}`);
      }
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) fail("is not a registered field", `${path}.${key}`);
        validateSchema(schema.properties[key], value[key], resolveType, `${path}.${key}`);
      }
      break;
    default:
      throw new DomainContractError("INVALID_DOMAIN_PACK", "unsupported schema", path);
  }
  return value;
}

export function assertUnique(items, key, path = "$") {
  const seen = new Set();
  items.forEach((item, index) => {
    if (seen.has(item[key])) fail(`duplicate ${key}: ${item[key]}`, `${path}[${index}].${key}`);
    seen.add(item[key]);
  });
}
