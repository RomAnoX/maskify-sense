const DEFAULT_REPLACER = str => `*****${str.slice(-4)}`;

const clone = input => JSON.parse(JSON.stringify(input));
const isObject = input => input && typeof input === 'object';
const isArray = input => input && Array.isArray(input);
const isString = input => typeof input === 'string';
const isNumber = input => typeof input === 'number';
const isFunction = input => input && typeof input === 'function';
const isToConvert = input => isString(input) || isNumber(input);

const convert = (input, replacer) => {
  return isString(replacer)
    ? replacer
    : isFunction(replacer)
    ? replacer(`${input}`)
    : input;
};

const getFields = (config, replacer) => {
  const fields = {};
  for (const type in config) {
    const mask = config[type].mask || replacer;
    if (config[type].fields && isArray(config[type].fields)) {
      config[type].fields.forEach(field => {
        fields[field] = { type, mask };
      });
    }
  }
  return fields;
};

const maskObject = (input, config, replacer = DEFAULT_REPLACER) => {
  const data = clone(input);
  const fields = getFields(config, replacer);
  for (const key in data) {
    const element = data[key];
    if (fields[key] && isToConvert(element)) {
      data[key] = convert(element, fields[key].mask);
    } else if (element && isObject(element)) {
      data[key] = maskObject(element, config, replacer);
    } else if (isArray(element)) {
      data[key] = maskArray(element, config, replacer);
    } else if (element && isString(element)) {
      // it can be a hidden JSON
      try {
        const newElement = JSON.parse(element);
        if (Array.isArray(newElement)) {
          data[key] = maskArray(newElement, config, replacer);
        } else if (isObject(newElement)) {
          data[key] = maskObject(newElement, config, replacer);
        }
        data[key] = JSON.stringify(data[key]);
      } catch {
        // ignore
      }
    }
  }
  return data;
};

const maskArray = (input, config, replacer = DEFAULT_REPLACER) => {
  const data = [];
  for (let i = 0; i < input.length; i++) {
    const element = input[i];
    if (isArray(element)) {
      data.push(maskArray(element, config, replacer));
    } else if (isObject(element)) {
      data.push(maskObject(element, config, replacer));
    } else {
      data.push(element);
    }
  }
  return data;
};

const create = config => {
  const mask = (input, replacer = DEFAULT_REPLACER) => {
    if (!input) return input;
    const data = clone(input);
    if (isArray(data)) {
      return maskArray(data, config, replacer);
    } else if (isObject(data)) {
      return maskObject(data, config, replacer);
    } else if (isToConvert(data)) {
      return convert(data, replacer);
    }
    return data;
  };

  mask.config = config;
  return mask;
};

module.exports = create;
