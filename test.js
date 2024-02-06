const MaskifySense = require('./index.js');

const mask = MaskifySense({
  ssn: {
    mask: str => `+++_++_${str.slice(-4)}`,
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

console.log('Text', mask('888-88-8888', mask.config.password.mask));

console.log(
  'Array',
  mask([
    { sin: '123-456-789', account: '456' },
    { sin: '987-654-321', account: '987' },
  ]),
);

console.log(
  'Object',
  mask({
    ssn: '888-88-8888',
    password: 'password',
    accounts: [
      { account: 123, routing: '456' },
      { account: 124, routing: '987' },
    ],
  }),
);

console.log(
  'Object with JSON',
  mask({
    ssn: '888-88-8888',
    password: 'password',
    accounts: JSON.stringify([
      { account: '123', routing: '456' },
      { account: '124', routing: '987' },
    ]),
    other: JSON.stringify({
      sin: '999-999-999',
      social: 'Facebook',
      password: 'something',
    }),
  }),
);
