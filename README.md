# maskify-sense

Mask sensitive data for loggers

Created this tiny library as a way to log data objects in loggers even if they contained JSON stringify values

## Install

```shell
yarn add maskify-sense
```

```shell
npm install maskify-sense
```

## Usage

To use it we need to create a `mask` instance using the creator with a configuration object

```javascript
// import MaskifySense from 'maskify-sense';
const MaskifySense = require('maskify-sense');

const mask = MaskifySense({
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
```

The configuration object is an object with categories of masking... each category will have a `mask` field which can be a `String` or a `Function` and a `fields` field which will be an array of targeted fields to mask (transform).

The category names (keys of the configuration object) are only to have an organization of the different mask strategies for all your fields. They are not used in any other place so you can name them whatever you want.

If the `mask` field is empty a default mask function will take place (can be override later on).

```javascript
(str) => `*****${str.slice(-4)}`;
```

If the `mask` is a `String` it will override completely the value of the field in the data object with that mask string value.

```javascript
const MaskifySense = require('maskify-sense');
const mask = MaskifySense({
  simple: {
    mask: '[redacted]',
    fields: ['password'],
  },
});

console.log(mask({ password: 'mySecretPassword' }));
// logs => { password: '[redacted]' }
```

If the `mask` is a `Function` it will transform the value accordingly with the masked function.

```javascript
const MaskifySense = require('maskify-sense');
const mask = MaskifySense({
  simple: {
    mask: (v) => `*****${str.slice(-4)}`,
    fields: ['password'],
  },
});

console.log(mask({ password: 'mySecretPassword' }));
// logs => { password: '*****word' }
```

The masked function accepts only one argument which would be the value that is being evaluated.

The mask can evaluate also stringified json strings

```javascript
const MaskifySense = require('maskify-sense');
const mask = MaskifySense({
  passwords: {
    mask: '***',
    fields: ['password', 'secret'],
  },
  accounts: {
    mask: (v) => `*****${str.slice(-4)}`,
    fields: ['routing', 'bankAccount'],
  },
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

You can check also the `test/script.js` file for more examples.
