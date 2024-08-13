const DEFAULT_REPLACER = (str) => `*****${str.slice(-4)}`;

const is = {
  string: (input) => typeof input === 'string',
  number: (input) => typeof input === 'number',
  fn: (input) => Object.prototype.toString.call(input) === '[object Function]',
};

const empty = Symbol('empty');
const toConvert = (input) => is.string(input) || is.number(input);

const transform = (input, replacer) =>
  is.string(replacer)
    ? replacer
    : is.fn(replacer)
    ? replacer(`${input}`)
    : input;

const maskify = (config) => {
  const fields = {};

  for (const type of Object.values(config)) {
    for (const field of type.fields) {
      fields[field] = type.mask || empty;
    }
  }

  const createReplacer = (defaultReplacer) => (key, value) => {
    if (fields[key] && toConvert(value)) {
      const replacer = fields[key] === empty ? defaultReplacer : fields[key];
      return transform(value, replacer);
    }
    if (is.string(value)) {
      try {
        const newElement = JSON.parse(value);
        return JSON.stringify(newElement, createReplacer(defaultReplacer));
      } catch {}
    }
    return value;
  };

  const mask = (input, defaultReplacer = DEFAULT_REPLACER) => {
    if (!input) return input;
    if (toConvert(input)) return transform(input, defaultReplacer);

    return JSON.parse(JSON.stringify(input, createReplacer(defaultReplacer)));
  };

  mask.is = is;
  mask.empty = empty;
  mask.config = config;

  return mask;
};

module.exports = maskify;
