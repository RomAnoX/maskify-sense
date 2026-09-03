'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const maskify = require('..');

const make = () =>
  maskify({
    ssn: {
      mask: (str) => `+++_++_${str.slice(-4)}`,
      fields: ['ssn', 'taxId', 'sin'],
    },
    accounts: {
      fields: ['account', 'routing'],
    },
    password: {
      mask: '[redacted]',
      fields: ['password'],
    },
  });

// ---------------------------------------------------------------------------
// Historical behavior kept (backwards compatibility)
// ---------------------------------------------------------------------------

test('masks scalar fields with string and function masks', () => {
  const mask = make();
  assert.deepEqual(
    mask({ password: 'hunter2', ssn: '123-45-6789', name: 'Jane' }),
    { password: '[redacted]', ssn: '+++_++_6789', name: 'Jane' },
  );
});

test('fields without a mask use the default replacer', () => {
  const mask = make();
  assert.deepEqual(mask({ account: '12345678' }), { account: '*****5678' });
});

test('masks nested keys at any depth', () => {
  const mask = make();
  assert.deepEqual(mask({ a: { b: { password: 'x', keep: 1 } } }), {
    a: { b: { password: '[redacted]', keep: 1 } },
  });
});

test('masks rows inside arrays', () => {
  const mask = make();
  assert.deepEqual(
    mask([{ sin: '123-456-789', account: 456, keep: true }]),
    [{ sin: '+++_++_-789', account: '*****456', keep: true }],
  );
});

test('the per-call defaultReplacer only affects fields without an explicit mask', () => {
  const mask = make();
  const custom = (s) => `~${s}~`;
  assert.deepEqual(mask({ account: '1234', password: 'pwd' }, custom), {
    account: '~1234~',
    password: '[redacted]', // explicit category mask wins over the per-call override
  });
});

test('masking is a deep copy and never mutates the input', () => {
  const mask = make();
  const input = { password: 'pwd', nested: { ssn: '888-88-8888' } };
  const snapshot = JSON.stringify(input);
  const output = mask(input);
  assert.notEqual(output, input);
  assert.notEqual(output.nested, input.nested);
  assert.equal(JSON.stringify(input), snapshot);
});

test('top-level scalars are masked with the (per-call) default replacer', () => {
  const mask = make();
  assert.equal(mask('888-88-8888'), '*****8888');
  assert.equal(mask('888-88-8888', mask.config.password.mask), '[redacted]');
  assert.equal(mask(12345), '*****2345');
  assert.equal(mask(12345, (s) => s), '12345');
});

test('falsy inputs pass through unchanged', () => {
  const mask = make();
  assert.equal(mask(''), '');
  assert.equal(mask(0), 0);
  assert.equal(mask(null), null);
  assert.equal(mask(undefined), undefined);
  assert.equal(mask(false), false);
});

test('exposes is / empty / config statics', () => {
  const config = {
    password: { mask: '[redacted]', fields: ['password'] },
  };
  const mask = maskify(config);
  assert.equal(mask.is.string('x'), true);
  assert.equal(mask.is.number(1), true);
  assert.equal(mask.is.fn(() => {}), true);
  assert.equal(typeof mask.empty, 'symbol');
  assert.equal(mask.config, config);
});

// ---------------------------------------------------------------------------
// JSON-text strings
// ---------------------------------------------------------------------------

test('masks fields inside stringified JSON (README example)', () => {
  const mask = maskify({
    passwords: { mask: '***', fields: ['password', 'secret'] },
    accounts: { mask: (v) => `*****${v.slice(-4)}`, fields: ['routing', 'bankAccount'] },
  });
  assert.deepEqual(
    mask({
      name: 'John Doe',
      bankData: '{"bankAccount":12345678,"routing":9876543}',
      credentials: '{"username":"UA","password":"12345","secret":"ABC"}',
    }),
    {
      name: 'John Doe',
      bankData: '{"bankAccount":"*****5678","routing":"*****6543"}',
      credentials: '{"username":"UA","password":"***","secret":"***"}',
    },
  );
});

test('masks JSON text nested several layers deep, keeping the result a string', () => {
  const mask = maskify({ p: { mask: 'R', fields: ['password'] } });
  assert.equal(
    mask({ s: '{"level1":{"password":{"deep":"value"},"keep":1}}' }).s,
    '{"level1":{"password":"R","keep":1}}',
  );
});

test('JSON text with whitespace is parsed and re-serialized canonically', () => {
  const mask = maskify({ p: { mask: 'R', fields: ['password'] } });
  assert.equal(mask({ s: '  { "password" : "x" }  ' }).s, '{"password":"R"}');
});

test('strings that are not JSON containers are left untouched', () => {
  const mask = make();
  const input = {
    prose: 'This is not a json',
    code: '{oops',
    broken: '{"a": nope}',
    deepBroken: '{{{{{{',
  };
  assert.deepEqual(mask(input), input);
});

test('numeric-looking strings are no longer parsed/re-serialized (no corruption)', () => {
  const mask = maskify({}); // empty config = pure copy
  const input = {
    padded: '  42  ',
    huge: '12345678901234567890',
    booly: 'true',
    nullish: 'null',
    exponent: '1e3',
    leadingZeros: '007',
  };
  assert.deepEqual(mask(input), input); // byte-for-byte identical
});

test('masking inside JSON text preserves moderate numeric values', () => {
  const mask = maskify({ a: { mask: (v) => `#${v}`, fields: ['account'] } });
  assert.equal(mask({ s: '{"lat":1.5,"account":100}' }).s, '{"lat":1.5,"account":"#100"}');
});

test('top-level JSON text is masked inside instead of hint-masked', () => {
  const mask = maskify({ p: { mask: 'R', fields: ['password'] } });
  assert.equal(mask('{"password":"x"}'), '{"password":"R"}');
});

// ---------------------------------------------------------------------------
// Prototype / reserved keys (were corrupted, crashed or silently bypassed)
// ---------------------------------------------------------------------------

test('data keys named like Object.prototype members survive untouched', () => {
  const mask = make();
  const input = {
    toString: 'own-toString',
    constructor: 'own-constructor',
    hasOwnProperty: 'own-hasOwnProperty',
    valueOf: 'own-valueOf',
  };
  assert.deepEqual(mask(input), input);
});

test('masking output cannot be polluted via a "__proto__" data key', () => {
  const mask = make();
  const parsed = JSON.parse('{"__proto__":{"polluted":true},"a":1}');
  const out = mask(parsed);
  assert.equal(Object.prototype.hasOwnProperty.call(out, '__proto__'), true);
  assert.deepEqual(out.__proto__, { polluted: true }); // own data property, not a prototype read
  assert.equal(out.a, 1);
  assert.equal({}.polluted, undefined); // no global prototype pollution
});

test('a configured field named "__proto__" is now masked (Map registry)', () => {
  const mask = maskify({ x: { mask: '[redacted]', fields: ['__proto__'] } });
  const out = mask(JSON.parse('{"__proto__":"secret","a":1}'));
  assert.equal(Object.prototype.hasOwnProperty.call(out, '__proto__'), true);
  assert.equal(out.__proto__, '[redacted]');
  assert.equal(out.a, 1);
});

// ---------------------------------------------------------------------------
// Sensitive keys holding structured values: fully redacted (was: leaked)
// ---------------------------------------------------------------------------

test('a configured key holding an object is redacted whole', () => {
  const mask = make();
  assert.deepEqual(mask({ password: { hash: 'abc', salt: 'xyz' } }), {
    password: '[redacted]',
  });
});

test('a configured key (no explicit mask) holding an object/array is redacted whole', () => {
  const mask = maskify({ k: { fields: ['k'] } });
  assert.deepEqual(mask({ k: { a: 1, b: 'secret' } }), { k: '[redacted]' });
  assert.deepEqual(mask({ k: [1, 2, 3] }), { k: '[redacted]' });
});

test('a configured key holding JSON text is redacted instead of hint-masked', () => {
  const mask = maskify({ p: { mask: (s) => `~${s}~`, fields: ['password'] } });
  assert.deepEqual(mask({ password: '{"inner":"secret"}' }), { password: '[redacted]' });
});

test('string masks fully replace structured values under a configured key', () => {
  const mask = maskify({ p: { mask: '[hidden]', fields: ['password'] } });
  assert.deepEqual(mask({ password: { hash: 'a' }, other: { password: 'b' } }), {
    password: '[hidden]',
    other: { password: '[hidden]' },
  });
});

test('function masks receive the actual scalar, never a serialized blob', () => {
  const seen = [];
  const mask = maskify({
    p: { mask: (s) => { seen.push(s); return 'M'; }, fields: ['password'] },
  });
  assert.deepEqual(mask({ password: 'abc' }), { password: 'M' });
  assert.deepEqual(mask({ password: { hash: 'abc' } }), { password: '[redacted]' });
  assert.deepEqual(seen, ['abc']); // the function was never fed an object string
});

// ---------------------------------------------------------------------------
// Type handling: never throws, type-honest copies
// ---------------------------------------------------------------------------

test('circular references return a circular deep copy instead of throwing', () => {
  const mask = maskify({});
  const input = { a: 1 };
  input.self = input;
  const out = mask(input);
  assert.equal(out.a, 1);
  assert.equal(out.self, out);
});

test('shared references stay shared in the copy', () => {
  const mask = maskify({});
  const shared = { n: 1 };
  const out = mask({ x: shared, y: shared });
  assert.notEqual(out.x, shared);
  assert.equal(out.x, out.y);
});

test('BigInt values become strings instead of throwing', () => {
  const mask = maskify({});
  assert.deepEqual(mask({ n: 10n }), { n: '10' });
  assert.deepEqual(mask([10n, { b: 20n }]), ['10', { b: '20' }]);
  assert.equal(mask(10n), '*****10');
});

test('BigInt under a configured key is masked like a number', () => {
  const mask = maskify({ k: { fields: ['k'] } });
  assert.deepEqual(mask({ k: 10n }), { k: '*****10' });
});

test('Dates are copied as Dates, not stringified', () => {
  const mask = maskify({ p: { mask: 'X', fields: ['password'] } });
  const date = new Date(1234);
  const out = mask({ at: date, password: 'x' });
  assert.ok(out.at instanceof Date);
  assert.notEqual(out.at, date);
  assert.equal(out.at.getTime(), 1234);
  assert.equal(out.password, 'X');
});

test('Maps and Sets are copied and their members masked', () => {
  const mask = maskify({ p: { mask: 'X', fields: ['password'] } });
  const out = mask({
    m: new Map([['password', 'x'], ['plain', 'fine']]),
    s: new Set([{ password: 'x' }]),
  });
  assert.ok(out.m instanceof Map);
  assert.equal(out.m.get('plain'), 'fine');
  assert.equal(out.m.get('password'), 'x'); // map keys are values, not object field names
  assert.ok(out.s instanceof Set);
  assert.deepEqual([...out.s], [{ password: 'X' }]);
});

test('Buffers and typed arrays are copied without changing type', () => {
  const mask = maskify({});
  const buf = Buffer.from('abc');
  const bytes = new Uint8Array([1, 2, 3]);
  const out = mask({ buf, bytes });
  assert.ok(Buffer.isBuffer(out.buf));
  assert.notEqual(out.buf, buf);
  assert.equal(out.buf.toString(), 'abc');
  assert.ok(out.bytes instanceof Uint8Array);
  assert.notEqual(out.bytes, bytes);
  assert.deepEqual([...out.bytes], [1, 2, 3]);
});

test('function properties are dropped; undefined-valued keys are kept', () => {
  const mask = maskify({});
  const out = mask({ fn: () => {}, u: undefined, keep: 1 });
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'fn'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'u'), true);
  assert.equal(out.u, undefined);
  assert.equal(out.keep, 1);
});

test('throwing getters are skipped instead of crashing the mask', () => {
  const mask = maskify({});
  const input = { keep: 'v' };
  Object.defineProperty(input, 'boom', {
    enumerable: true,
    get() {
      throw new Error('nope');
    },
  });
  assert.deepEqual(mask(input), { keep: 'v' });
});

test('an empty config acts as a pure deep copy', () => {
  const mask = maskify({});
  const out = mask({ a: { b: [1, { c: 2 }] } });
  assert.deepEqual(out, { a: { b: [1, { c: 2 }] } });
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

test('config validation gives clear errors', () => {
  assert.throws(() => maskify(null), TypeError);
  assert.throws(() => maskify([]), TypeError);
  assert.throws(() => maskify('nope'), TypeError);
  assert.throws(() => maskify({ x: {} }), /fields/);
  assert.throws(() => maskify({ x: { fields: 'account' } }), /fields/);
  assert.throws(() => maskify({ x: { fields: [1] } }), /strings/);
  assert.throws(() => maskify({ x: { mask: 123, fields: ['a'] } }), /mask/);
  assert.throws(() => maskify({ x: { mask: {}, fields: ['a'] } }), /mask/);
});

test('a field configured in two categories throws instead of silently losing', () => {
  assert.throws(
    () => maskify({ a: { fields: ['k'] }, b: { mask: 'X', fields: ['k'] } }),
    /field "k" is configured in both "a" and "b"/,
  );
});

test('duplicates within one category are tolerated', () => {
  const mask = maskify({ a: { fields: ['k', 'k'] } });
  assert.deepEqual(mask({ k: 'secret' }), { k: '*****cret' });
});

test('the package resolves itself by name (exports self-reference)', () => {
  assert.equal(require('maskify-sense'), maskify);
});

test('a mask of null / undefined / empty string falls back to the default replacer', () => {
  const mask = maskify({
    a: { mask: null, fields: ['k'] },
    b: { fields: ['j'] },
  });
  assert.deepEqual(mask({ k: 'abcdef', j: 'abcdef' }), {
    k: '*****cdef',
    j: '*****cdef',
  });
});
