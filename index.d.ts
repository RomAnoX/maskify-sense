/**
 * Type definitions for maskify-sense.
 */

/**
 * A mask strategy:
 *  - a string replaces the value completely;
 *  - a function receives the string form of a scalar value and returns the
 *    replacement (its return value is used as-is).
 */
export type Mask = string | ((value: string) => unknown);

export interface Category {
  /** Optional mask strategy. When omitted, the default replacer applies. */
  mask?: Mask;
  /** Field names (object keys anywhere in the tree) to mask. */
  fields: string[];
}

export type Config = Record<string, Category>;

export interface MaskInstance {
  /**
   * Returns a deep copy of `input` with every configured field masked.
   *
   * The output is the same *shape* as `input`, but leaf values under a
   * configured field may be replaced by a string mask (e.g. `[redacted]`) and
   * any value under a configured field is removed entirely, so treat the
   * result as a best-effort `T` when you need precise types.
   *
   * Never mutates `input` and never throws on circular references, BigInt,
   * throwing getters, etc.
   *
   * @param input            payload to mask (object, array, JSON-text string, scalar)
   * @param defaultReplacer  overrides the default mask for fields configured
   *                         without an explicit `mask`
   */
  <T>(input: T, defaultReplacer?: Mask): T;

  /** Type guards exposed for convenience. */
  is: {
    string(input: unknown): input is string;
    number(input: unknown): input is number;
    fn(input: unknown): boolean;
  };
  /** Symbol stored for categories configured without a mask. */
  empty: symbol;
  /** The configuration object the mask was built from. */
  config: Config;
}

/**
 * Create a `mask` function from a configuration of masking categories.
 *
 * @example
 * const maskify = require('maskify-sense');
 * const mask = maskify({
 *   password: { mask: '[redacted]', fields: ['password'] },
 *   accounts: { fields: ['account', 'routing'] }, // default replacer
 * });
 * console.log(mask({ user: 'x', password: 'hunter2' })); // { user: 'x', password: '[redacted]' }
 */
declare function maskify(config: Config): MaskInstance;

export default maskify;
