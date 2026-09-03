import { test } from 'node:test';
import assert from 'node:assert/strict';

import maskifyDefault, { maskify as maskifyNamed } from '../index.mjs';

test('ESM default and named imports resolve to the CJS implementation', () => {
  assert.equal(typeof maskifyDefault, 'function');
  assert.equal(maskifyNamed, maskifyDefault);

  const mask = maskifyDefault({ p: { mask: 'R', fields: ['password'] } });
  assert.deepEqual(mask({ password: 'x', a: 1 }), { password: 'R', a: 1 });
});
