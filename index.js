'use strict';

/**
 * maskify-sense
 *
 * Builds a `mask` function that returns a deep copy of log payloads with
 * sensitive fields replaced, so the result is safe to print, store or ship
 * to a logger.
 *
 * The implementation walks values by hand instead of abusing
 * `JSON.stringify(value, replacer)` so that:
 *   - it never throws (circular references, BigInt, throwing getters, ...);
 *   - the input object is never mutated and a deep copy is always returned;
 *   - shared references and circular references survive as shared/cloned refs;
 *   - Dates, Maps, Sets, Buffers and typed arrays are copied as their own type;
 *   - keys such as "toString", "constructor" or "__proto__" cannot corrupt
 *     or bypass masking (field lookup is a Map, output keys are defined with
 *     Object.defineProperty).
 *
 * Full documentation lives in README.md.
 */

const DEFAULT_REPLACER = (str) => `*****${str.slice(-4)}`;

/** Marker stored for categories declared without a `mask` (default replacer applies). */
const empty = Symbol('empty');

/**
 * Replacement used when the value under a sensitive key is not a plain
 * scalar. Structured values are never walked (walking could leak unlisted
 * nested fields such as `{ password: { hash, salt } }`), they are removed as
 * a whole.
 */
const REDACTED = '[redacted]';

const is = {
  string: (input) => typeof input === 'string',
  number: (input) => typeof input === 'number',
  fn: (input) => Object.prototype.toString.call(input) === '[object Function]',
};

const isJsonWhitespace = (code) =>
  code === 0x20 /* space */ || code === 0x09 /* \t */ || code === 0x0a /* \n */ || code === 0x0d; /* \r */

/**
 * First significant character of a string. JSON only allows space/tab/newline/
 * carriage-return around a top-level value, so this cheap scan is an exact
 * gate: it avoids running (and paying the cost of) JSON.parse on the
 * overwhelming majority of strings, and - more importantly - it means plain
 * strings that merely *look* numeric ("  42  ", huge integers, "true", ...)
 * are never parsed and re-serialized, which used to silently corrupt them.
 */
const firstSignificantChar = (value) => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (!isJsonWhitespace(code)) return code;
  }
  return -1;
};

/** Only strings that can only be JSON objects/arrays are candidates for parse-and-mask-inside. */
const looksLikeJsonContainer = (value) => {
  const code = firstSignificantChar(value);
  return code === 0x7b /* { */ || code === 0x5b; /* [ */
};

/**
 * Define an own enumerable property instead of plain assignment so that keys
 * such as "__proto__" are stored as plain data and cannot trip prototype
 * setters (which silently swallowed config/dataset entries before).
 */
const defineOwn = (object, key, value) => {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

const describe = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
};

const maskify = (config) => {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError(`maskify(config): expected an object of categories, got ${describe(config)}`);
  }

  /**
   * Field registry: field name -> replacer (a string, a function, or the
   * `empty` symbol when the category only listed the field). A Map avoids the
   * whole class of Object.prototype / __proto__ collisions and keeps lookups
   * O(1).
   */
  const fields = new Map();
  const owners = new Map();

  for (const [categoryName, category] of Object.entries(config)) {
    if (category === null || typeof category !== 'object' || Array.isArray(category)) {
      throw new TypeError(
        `maskify(config): category "${categoryName}" must be an object with a "fields" array`,
      );
    }
    const { mask, fields: fieldNames } = category;
    if (!Array.isArray(fieldNames)) {
      throw new TypeError(
        `maskify(config): category "${categoryName}" is missing the required "fields" array`,
      );
    }
    if (mask !== undefined && mask !== null && typeof mask !== 'string' && typeof mask !== 'function') {
      throw new TypeError(
        `maskify(config): category "${categoryName}" "mask" must be a string or a function`,
      );
    }
    for (const field of fieldNames) {
      if (typeof field !== 'string') {
        throw new TypeError(
          `maskify(config): category "${categoryName}" "fields" must be an array of strings`,
        );
      }
      const owner = owners.get(field);
      if (owner === categoryName) continue; // listed twice in the same category: ignore
      if (owner !== undefined) {
        throw new Error(
          `maskify(config): field "${field}" is configured in both "${owner}" and "${categoryName}". ` +
            'Merge the categories - a field can only have one mask strategy.',
        );
      }
      owners.set(field, categoryName);
      fields.set(field, mask || empty); // null / undefined / '' fall back to the default replacer
    }
  }

  /** Apply a mask to the string form of a scalar value. */
  const maskScalar = (value, mask) => (typeof mask === 'string' ? mask : mask(String(value)));

  /**
   * Decide the replacement for a value found under a configured sensitive key.
   *  - string scalars   -> masked (whole value replaced by a string mask, or
   *                        transformed by a function mask);
   *  - JSON-text scalars -> treated like structured data (a trailing hint of a
   *                        serialized blob can leak real characters);
   *  - numbers / BigInt -> masked like strings;
   *  - objects/arrays/Date/Map/... -> whole subtree removed (string mask if
   *                        configured, otherwise REDACTED); never walked;
   *  - booleans / null / undefined -> left untouched (nothing to hide, and
   *                        this preserves the historical behavior).
   */
  const maskMatched = (raw, mask) => {
    if (typeof raw === 'string') {
      if (looksLikeJsonContainer(raw)) return typeof mask === 'string' ? mask : REDACTED;
      return maskScalar(raw, mask);
    }
    if (typeof raw === 'number' || typeof raw === 'bigint') return maskScalar(String(raw), mask);
    if (raw !== null && typeof raw === 'object') return typeof mask === 'string' ? mask : REDACTED;
    return raw;
  };

  /**
   * Mask the *contents* of a string that holds JSON object/array text, keeping
   * it a string afterwards. Values that do not parse are returned untouched;
   * anything that goes wrong (pathologically deep nesting, etc.) also falls
   * back to the original string - never a throw.
   */
  const maskJsonText = (value, defaultReplacer, cache) => {
    if (!looksLikeJsonContainer(value)) return value;
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
    if (parsed === null || typeof parsed !== 'object') return value;
    try {
      return JSON.stringify(walk(parsed, defaultReplacer, cache));
    } catch {
      return value;
    }
  };

  /**
   * Deep walk + mask. `cache` maps every visited source object to its clone so
   * shared references stay shared and circular structures come back as
   * circular clones instead of throwing.
   */
  const walk = (value, defaultReplacer, cache) => {
    if (typeof value === 'string') return maskJsonText(value, defaultReplacer, cache);
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'bigint') return value.toString(); // BigInt is not JSON-serializable
      return value; // numbers, booleans, undefined, functions and symbols handled by callers
    }

    if (cache.has(value)) return cache.get(value);

    if (Array.isArray(value)) {
      const clone = [];
      cache.set(value, clone); // cache *before* filling so self-referencing arrays work
      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) continue; // keep sparse arrays sparse
        let raw;
        try {
          raw = value[i];
        } catch {
          continue; // accessor threw - skip the element instead of crashing the log line
        }
        if (typeof raw === 'function' || typeof raw === 'symbol') {
          clone[i] = undefined; // JSON.stringify would emit null; undefined is the closest plain value
        } else {
          clone[i] = walk(raw, defaultReplacer, cache);
        }
      }
      return clone;
    }

    if (typeof Date === 'function' && value instanceof Date) {
      const copy = new Date(value.getTime());
      cache.set(value, copy);
      return copy;
    }
    if (typeof RegExp === 'function' && value instanceof RegExp) {
      const copy = new RegExp(value.source, value.flags);
      cache.set(value, copy);
      return copy;
    }
    if (typeof Map === 'function' && value instanceof Map) {
      const copy = new Map();
      cache.set(value, copy);
      for (const [key, member] of value) copy.set(key, walk(member, defaultReplacer, cache));
      return copy;
    }
    if (typeof Set === 'function' && value instanceof Set) {
      const copy = new Set();
      cache.set(value, copy);
      for (const member of value) copy.add(walk(member, defaultReplacer, cache));
      return copy;
    }
    if (typeof Buffer === 'function' && Buffer.isBuffer(value)) {
      const copy = Buffer.from(value);
      cache.set(value, copy);
      return copy;
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
      let copy;
      if (typeof DataView === 'function' && value instanceof DataView) {
        copy = new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      } else {
        copy = new value.constructor(value);
      }
      cache.set(value, copy);
      return copy;
    }

    // Plain record (covers plain objects and, as a best effort, class
    // instances: their own enumerable string keys are copied).
    const clone = {};
    cache.set(value, clone);
    for (const key of Object.keys(value)) {
      let raw;
      try {
        raw = value[key];
      } catch {
        continue; // throwing accessor - skip rather than crash
      }
      if (typeof raw === 'function' || typeof raw === 'symbol') continue; // not loggable, drop
      const replacer = fields.get(key);
      if (replacer !== undefined) {
        defineOwn(clone, key, maskMatched(raw, replacer === empty ? defaultReplacer : replacer));
      } else {
        defineOwn(clone, key, walk(raw, defaultReplacer, cache));
      }
    }
    return clone;
  };

  /**
   * Mask a payload. Accepts objects, arrays, JSON-text strings and scalars.
   * `defaultReplacer` overrides the default mask used for fields that were
   * configured *without* an explicit mask (fields with an explicit mask keep
   * it, as before). Returns a deep copy; the input is never mutated.
   */
  const mask = (input, defaultReplacer = DEFAULT_REPLACER) => {
    if (typeof defaultReplacer !== 'string' && typeof defaultReplacer !== 'function') {
      defaultReplacer = DEFAULT_REPLACER; // ignore malformed per-call overrides
    }

    if (input === null || typeof input !== 'object') {
      if (typeof input === 'string') {
        if (!input) return input; // historical pass-through for falsy input
        if (looksLikeJsonContainer(input)) return maskJsonText(input, defaultReplacer, new Map());
        return maskScalar(input, defaultReplacer);
      }
      if (typeof input === 'number' || typeof input === 'bigint') {
        if (!input) return input; // 0 / 0n keep the historical pass-through
        return maskScalar(String(input), defaultReplacer);
      }
      return input; // booleans, null, undefined, functions, symbols
    }

    return walk(input, defaultReplacer, new Map());
  };

  // Public-ish helpers kept for backwards compatibility.
  mask.is = is;
  mask.empty = empty;
  mask.config = config;

  return mask;
};

module.exports = maskify;
