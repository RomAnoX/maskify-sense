/**
 * ESM entry for maskify-sense.
 *
 * The implementation stays in CommonJS (index.js) so both module systems
 * share the exact same code; this wrapper only provides the `import` surface.
 */
import maskify from './index.js';

export default maskify;
export { maskify };
