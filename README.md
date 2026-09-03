# maskify-sense

Mask sensitive data for loggers.

A tiny, dependency-free helper that returns a **deep copy** of a log payload
with the fields you choose masked — including fields hiding inside
stringified-JSON values — so you can log whole objects without leaking
secrets, and without crashing on circular references, `BigInt`, or other
values `JSON.stringify` chokes on.

## Install

```shell
npm install maskify-sense
```

```shell
yarn add maskify-sense
```

## Usage

Create a `mask` instance by passing a configuration object. Each key is a
category name (free-form, only for your own organization) whose value is:

| option   | type                 | description                                                              |
| -------- | -------------------- | ------------------------------------------------------------------------ |
| `fields` | `string[]`           | **required** — object keys to mask, matched by name at any depth         |
| `mask`   | `string \| function` | optional — see below; defaults to the default replacer when omitted      |

```javascript
const maskify = require('maskify-sense');

const mask = maskify({
  ssn: {
    mask: (str) => `+++_++_${str.slice(-4)}`,
    fields: ['ssn', 'taxId', 'sin'],
  },
  accounts: {
    // no mask -> default replacer applies
    fields: ['account', 'routing'],
  },
  password: {
    mask: '[redacted]',
    fields: ['password'],
  },
});

console.log(mask({ user: 'Jane', password: 'mySecretPassword' }));
// logs => { user: 'Jane', password: '[redacted]' }
```

### Mask strategies

- **String mask** — completely replaces the value:

  ```javascript
  const mask = maskify({ simple: { mask: '[redacted]', fields: ['password'] } });

  console.log(mask({ password: 'mySecretPassword' }));
  // logs => { password: '[redacted]' }
  ```

- **Function mask** — receives the string form of the scalar value and its
  return value is used as-is:

  ```javascript
  const mask = maskify({
    simple: { mask: (v) => `*****${v.slice(-4)}`, fields: ['password'] },
  });

  console.log(mask({ password: 'mySecretPassword' }));
  // logs => { password: '*****word' }
  ```

- **No mask** — the default replacer is used:

  ```javascript
  (str) => `*****${str.slice(-4)}`;
  ```

  You can override it per call; it only affects fields configured *without*
  an explicit mask (explicit category masks always win):

  ```javascript
  mask(payload, (v) => `~~${v.slice(-2)}~~`);
  ```

### Masking inside stringified JSON

Any string value that holds JSON object/array text is parsed, masked, and
re-serialized, so secrets stored inside JSON blobs never reach the log:

```javascript
const mask = maskify({
  passwords: { mask: '***', fields: ['password', 'secret'] },
  accounts: { mask: (v) => `*****${v.slice(-4)}`, fields: ['routing', 'bankAccount'] },
});

console.log(
  mask({
    name: 'John Doe',
    bankData: '{"bankAccount":12345678,"routing":9876543}',
    credentials: '{"username":"UA","password":"12345","secret":"ABC"}',
  }),
);
// logs =>
// {
//   name: 'John Doe',
//   bankData: '{"bankAccount":"*****5678","routing":"*****6543"}',
//   credentials: '{"username":"UA","password":"***","secret":"***"}',
// }
```

Plain prose and strings that merely look like numbers are **never** parsed —
`"  42  "` stays `"  42  "`, huge numeric IDs keep every digit, `"true"`
stays `"true"`.

## Behavior & guarantees

- **Deep copy, no mutation.** The input is never modified; a new structure is
  returned. Shared references stay shared, and circular references come back
  as circular deep copies instead of throwing.
- **Never throws.** Circular references, `BigInt`, throwing getters,
  pathological nesting — the worst case is that a value passes through or is
  skipped, never a crash of your log line.
- **Sensitive keys holding structured values are removed entirely.** If a
  configured field contains an object/array/`Date`/etc., the whole subtree is
  replaced (by the category's string mask, or `[redacted]`) — it is never
  walked, so unlisted nested fields such as `{ password: { hash, salt } }`
  cannot leak. A configured field whose value is a JSON-text string is
  redacted the same way.
- **Prototype-safe.** Field names like `toString`, `constructor`,
  `hasOwnProperty` or even `__proto__` in your data are handled as plain data:
  they can neither corrupt the output nor bypass masking (the field registry
  is a `Map`, output keys are defined with `Object.defineProperty`).

### Type handling

| value                    | behavior                                                                |
| ------------------------ | ----------------------------------------------------------------------- |
| `string`, `number`       | masked when under a configured key (function masks get `String(value)`) |
| `boolean`, `null`, `undefined` | passed through unchanged (nothing to hide)                        |
| `BigInt`                 | converted to its decimal string (not JSON-serializable)                 |
| object / array / `Date` / `Map` / `Set` / `Buffer` / typed arrays | copied as their own type; matched by key name → whole value redacted |
| functions, symbols       | dropped from output                                                     |
| own key with `undefined` value | kept as an own key with `undefined`                                 |

### Configuration validation

Invalid configurations throw a descriptive error at creation time:

```javascript
maskify(null);                       // TypeError
maskify({ x: {} });                  // TypeError: category "x" is missing the required "fields" array
maskify({ x: { fields: [1] } });     // TypeError: ... "fields" must be an array of strings
maskify({ x: { mask: 123, fields: ['a'] } }); // TypeError: ... "mask" must be a string or a function
maskify({ a: { fields: ['k'] }, b: { fields: ['k'] } }); // Error: field "k" is configured in both "a" and "b"
```

### API

- `maskify(config)` → `mask`
- `mask(input, defaultReplacer?)` → masked deep copy. `input` can be an object,
  array, JSON-text string, or scalar.
- `mask.config` — the config the instance was built from
- `mask.is.string / is.number / is.fn` — small type guards
- `mask.empty` — the internal "no explicit mask" marker

### TypeScript

Type definitions ship with the package (`index.d.ts`):

```typescript
import maskify from 'maskify-sense';

const mask = maskify({
  password: { mask: '[redacted]', fields: ['password'] },
  accounts: { fields: ['account', 'routing'] },
});
```

### ES modules

```javascript
import maskify from 'maskify-sense';
// or: import { maskify } from 'maskify-sense';
```

## Known limits

- Inside legitimate JSON *object text*, numbers go through `JSON.parse` /
  `JSON.stringify`, so values beyond `Number.MAX_SAFE_INTEGER` are rounded
  exactly as they would be by any plain `JSON.parse`. Only strings that
  actually hold `{...}`/`[...]` text are touched.
- Non-enumerable and symbol-keyed properties are not copied (same as
  `JSON.stringify`).
- Class instances are copied as plain records of their own enumerable
  properties.

## v2 changes (breaking)

- Values under a configured key that are **not** plain scalars are now fully
  redacted instead of being walked (this was a data-leak vector).
- `BigInt` no longer throws — it is stringified.
- A field listed in two categories now throws instead of silently letting one
  category win.
- Malformed configurations throw descriptive `TypeError`s.
- Field names such as `__proto__` are now maskable; data keys named after
  `Object.prototype` members no longer get corrupted.
- ESM entry (`index.mjs`) and TypeScript definitions added.

## Development

```shell
npm test      # node:test suite (zero dependencies)
npm run demo  # interactive example: examples/demo.js
```

## License

GPL-3.0 — see [LICENSE](LICENSE).
