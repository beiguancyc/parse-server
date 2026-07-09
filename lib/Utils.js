"use strict";

/**
 * utils.js
 * @file General purpose utilities
 * @description General purpose utilities.
 */

const path = require('path');
const fs = require('fs').promises;
const {
  types
} = require('util');

/**
 * The general purpose utilities.
 */
class Utils {
  /**
   * @function getLocalizedPath
   * @description Returns a localized file path accoring to the locale.
   *
   * Localized files are searched in subfolders of a given path, e.g.
   *
   * root/
   * ├── base/                    // base path to files
   * │   ├── example.html         // default file
   * │   └── de/                  // de language folder
   * │   │   └── example.html     // de localized file
   * │   └── de-AT/               // de-AT locale folder
   * │   │   └── example.html     // de-AT localized file
   *
   * Files are matched with the locale in the following order:
   * 1. Locale match, e.g. locale `de-AT` matches file in folder `de-AT`.
   * 2. Language match, e.g. locale `de-AT` matches file in folder `de`.
   * 3. Default; file in base folder is returned.
   *
   * @param {String} defaultPath The absolute file path, which is also
   * the default path returned if localization is not available.
   * @param {String} locale The locale.
   * @returns {Promise<Object>} The object contains:
   * - `path`: The path to the localized file, or the original path if
   *   localization is not available.
   * - `subdir`: The subdirectory of the localized file, or undefined if
   *   there is no matching localized file.
   */
  static async getLocalizedPath(defaultPath, locale) {
    // Get file name and paths
    const file = path.basename(defaultPath);
    const basePath = path.dirname(defaultPath);

    // If locale is not set return default file
    if (!locale) {
      return {
        path: defaultPath
      };
    }

    // Check file for locale exists
    const localePath = path.join(basePath, locale, file);
    const localeFileExists = await Utils.fileExists(localePath);

    // If file for locale exists return file
    if (localeFileExists) {
      return {
        path: localePath,
        subdir: locale
      };
    }

    // Check file for language exists
    const language = locale.split('-')[0];
    const languagePath = path.join(basePath, language, file);
    const languageFileExists = await Utils.fileExists(languagePath);

    // If file for language exists return file
    if (languageFileExists) {
      return {
        path: languagePath,
        subdir: language
      };
    }

    // Return default file
    return {
      path: defaultPath
    };
  }

  /**
   * @function fileExists
   * @description Checks whether a file exists.
   * @param {String} path The file path.
   * @returns {Promise<Boolean>} Is true if the file can be accessed, false otherwise.
   */
  static async fileExists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @function isPath
   * @description Evaluates whether a string is a file path (as opposed to a URL for example).
   * @param {String} s The string to evaluate.
   * @returns {Boolean} Returns true if the evaluated string is a path.
   */
  static isPath(s) {
    return /(^\/)|(^\.\/)|(^\.\.\/)/.test(s);
  }

  /**
   * Flattens an object and crates new keys with custom delimiters.
   * @param {Object} obj The object to flatten.
   * @param {String} [delimiter='.'] The delimiter of the newly generated keys.
   * @param {Object} result
   * @returns {Object} The flattened object.
   **/
  static flattenObject(obj, parentKey, delimiter = '.', result = {}) {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const newKey = parentKey ? parentKey + delimiter + key : key;
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          this.flattenObject(obj[key], newKey, delimiter, result);
        } else {
          result[newKey] = obj[key];
        }
      }
    }
    return result;
  }

  /**
   * Realm-safe check for Date.
   * @param {any} value The value to check.
   * @returns {Boolean} Returns true if the value is a Date.
   */
  static isDate(value) {
    return types.isDate(value);
  }

  /**
   * Realm-safe check for RegExp.
   * @param {any} value The value to check.
   * @returns {Boolean} Returns true if the value is a RegExp.
   */
  static isRegExp(value) {
    return types.isRegExp(value);
  }

  /**
   * Realm-safe check for Map.
   * @param {any} value The value to check.
   * @returns {Boolean} Returns true if the value is a Map.
   */
  static isMap(value) {
    return types.isMap(value);
  }

  /**
   * Realm-safe check for Set.
   * @param {any} value The value to check.
   * @returns {Boolean} Returns true if the value is a Set.
   */
  static isSet(value) {
    return types.isSet(value);
  }

  /**
   * Realm-safe check for native Error.
   * @param {any} value The value to check.
   * @returns {Boolean} Returns true if the value is a native Error.
   */
  static isNativeError(value) {
    return types.isNativeError(value);
  }

  /**
   * Realm-safe check for Promise (duck-typed as thenable).
   * Guards against Object.prototype pollution by ensuring `then` is not
   * inherited solely from Object.prototype.
   * @param {any} value The value to check.
   * @returns {Boolean} Returns true if the value is a Promise or thenable.
   */
  static isPromise(value) {
    if (value == null || typeof value.then !== 'function') {
      return false;
    }
    return Object.getPrototypeOf(value) !== Object.prototype || Object.prototype.hasOwnProperty.call(value, 'then');
  }

  /**
   * Realm-safe check for object type. Uses `typeof` instead of `instanceof Object`
   * which fails across realms. Returns true for any non-null value where
   * `typeof` is `'object'`, including plain objects, arrays, dates, maps, sets,
   * regex, and boxed primitives (e.g. `new String()`). Returns false for `null`,
   * `undefined`, unboxed primitives, and functions.
   * @param {any} value The value to check.
   * @returns {Boolean} Returns true if the value is a non-null object type.
   */
  static isObject(value) {
    return typeof value === 'object' && value !== null;
  }

  /**
   * Creates an object with all permutations of the original keys.
   * For example, this definition:
   * ```
   * {
   *   a: [true, false],
   *   b: [1, 2],
   *   c: ['x']
   * }
   * ```
   * permutates to:
   * ```
   * [
   *   { a: true, b: 1, c: 'x' },
   *   { a: true, b: 2, c: 'x' },
   *   { a: false, b: 1, c: 'x' },
   *   { a: false, b: 2, c: 'x' }
   * ]
   * ```
   * @param {Object} object The object to permutate.
   * @param {Integer} [index=0] The current key index.
   * @param {Object} [current={}] The current result entry being composed.
   * @param {Array} [results=[]] The resulting array of permutations.
   */
  static getObjectKeyPermutations(object, index = 0, current = {}, results = []) {
    const keys = Object.keys(object);
    const key = keys[index];
    const values = object[key];
    for (const value of values) {
      current[key] = value;
      const nextIndex = index + 1;
      if (nextIndex < keys.length) {
        Utils.getObjectKeyPermutations(object, nextIndex, current, results);
      } else {
        const result = Object.assign({}, current);
        results.push(result);
      }
    }
    return results;
  }

  /**
   * Validates parameters and throws if a parameter is invalid.
   * Example parameter types syntax:
   * ```
   * {
   *   parameterName: {
   *      t: 'boolean',
   *      v: isBoolean,
   *      o: true
   *   },
   *   ...
   * }
   * ```
   * @param {Object} params The parameters to validate.
   * @param {Array<Object>} types The parameter types used for validation.
   * @param {Object} types.t The parameter type; used for error message, not for validation.
   * @param {Object} types.v The function to validate the parameter value.
   * @param {Boolean} [types.o=false] Is true if the parameter is optional.
   */
  static validateParams(params, types) {
    for (const key of Object.keys(params)) {
      const type = types[key];
      const isOptional = !!type.o;
      const param = params[key];
      if (!(isOptional && param == null) && !type.v(param)) {
        throw `Invalid parameter ${key} must be of type ${type.t} but is ${typeof param}`;
      }
    }
  }

  /**
   * Computes the relative date based on a string.
   * @param {String} text The string to interpret the date from.
   * @param {Date} now The date the string is comparing against.
   * @returns {Object} The relative date object.
   **/
  static relativeTimeToDate(text, now = new Date()) {
    text = text.toLowerCase();
    let parts = text.split(' ');

    // Filter out whitespace
    parts = parts.filter(part => part !== '');
    const future = parts[0] === 'in';
    const past = parts[parts.length - 1] === 'ago';
    if (!future && !past && text !== 'now') {
      return {
        status: 'error',
        info: "Time should either start with 'in' or end with 'ago'"
      };
    }
    if (future && past) {
      return {
        status: 'error',
        info: "Time cannot have both 'in' and 'ago'"
      };
    }

    // strip the 'ago' or 'in'
    if (future) {
      parts = parts.slice(1);
    } else {
      // past
      parts = parts.slice(0, parts.length - 1);
    }
    if (parts.length % 2 !== 0 && text !== 'now') {
      return {
        status: 'error',
        info: 'Invalid time string. Dangling unit or number.'
      };
    }
    const pairs = [];
    while (parts.length) {
      pairs.push([parts.shift(), parts.shift()]);
    }
    let seconds = 0;
    for (const [num, interval] of pairs) {
      const val = Number(num);
      if (!Number.isInteger(val)) {
        return {
          status: 'error',
          info: `'${num}' is not an integer.`
        };
      }
      switch (interval) {
        case 'yr':
        case 'yrs':
        case 'year':
        case 'years':
          seconds += val * 31536000; // 365 * 24 * 60 * 60
          break;
        case 'wk':
        case 'wks':
        case 'week':
        case 'weeks':
          seconds += val * 604800; // 7 * 24 * 60 * 60
          break;
        case 'd':
        case 'day':
        case 'days':
          seconds += val * 86400; // 24 * 60 * 60
          break;
        case 'hr':
        case 'hrs':
        case 'hour':
        case 'hours':
          seconds += val * 3600; // 60 * 60
          break;
        case 'min':
        case 'mins':
        case 'minute':
        case 'minutes':
          seconds += val * 60;
          break;
        case 'sec':
        case 'secs':
        case 'second':
        case 'seconds':
          seconds += val;
          break;
        default:
          return {
            status: 'error',
            info: `Invalid interval: '${interval}'`
          };
      }
    }
    const milliseconds = seconds * 1000;
    if (future) {
      return {
        status: 'success',
        info: 'future',
        result: new Date(now.valueOf() + milliseconds)
      };
    } else if (past) {
      return {
        status: 'success',
        info: 'past',
        result: new Date(now.valueOf() - milliseconds)
      };
    } else {
      return {
        status: 'success',
        info: 'present',
        result: new Date(now.valueOf())
      };
    }
  }

  /**
   * Deep-scans an object for a matching key/value definition.
   * @param {Object} obj The object to scan.
   * @param {String | undefined} key The key to match, or undefined if only the value should be matched.
   * @param {any | undefined} value The value to match, or undefined if only the key should be matched.
   * @returns {Boolean} True if a match was found, false otherwise.
   */
  static objectContainsKeyValue(obj, key, value) {
    const isMatch = (a, b) => typeof a === 'string' && new RegExp(b).test(a) || a === b;
    const isKeyMatch = k => isMatch(k, key);
    const isValueMatch = v => isMatch(v, value);
    const stack = [obj];
    const seen = new WeakSet();
    while (stack.length > 0) {
      const current = stack.pop();
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      for (const [k, v] of Object.entries(current)) {
        if (key !== undefined && value === undefined && isKeyMatch(k)) {
          return true;
        } else if (key === undefined && value !== undefined && isValueMatch(v)) {
          return true;
        } else if (key !== undefined && value !== undefined && isKeyMatch(k) && isValueMatch(v)) {
          return true;
        }
        if (['[object Object]', '[object Array]'].includes(Object.prototype.toString.call(v))) {
          stack.push(v);
        }
      }
    }
    return false;
  }
  static checkProhibitedKeywords(config, data) {
    if (config?.requestKeywordDenylist) {
      // Scan request data for denied keywords
      for (const keyword of config.requestKeywordDenylist) {
        const match = Utils.objectContainsKeyValue(data, keyword.key, keyword.value);
        if (match) {
          throw `Prohibited keyword in request data: ${JSON.stringify(keyword)}.`;
        }
      }
    }
  }

  /**
   * Moves the nested keys of a specified key in an object to the root of the object.
   *
   * @param {Object} obj The object to modify.
   * @param {String} key The key whose nested keys will be moved to root.
   * @returns {Object} The modified object, or the original object if no modification happened.
   * @example
   * const obj = {
   *   a: 1,
   *   b: {
   *     c: 2,
   *     d: 3
   *   },
   *   e: 4
   * };
   * addNestedKeysToRoot(obj, 'b');
   * console.log(obj);
   * // Output: { a: 1, e: 4, c: 2, d: 3 }
  */
  static addNestedKeysToRoot(obj, key) {
    if (obj[key] && typeof obj[key] === 'object') {
      // Add nested keys to root
      Object.assign(obj, {
        ...obj[key]
      });
      // Delete original nested key
      delete obj[key];
    }
    return obj;
  }

  /**
   * Encodes a string to be used in a URL.
   * @param {String} input The string to encode.
   * @returns {String} The encoded string.
   */
  static encodeForUrl(input) {
    return encodeURIComponent(input).replace(/[!'.()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  }

  /**
   * Creates a JSON replacer function that handles Map, Set, and circular references.
   * This replacer can be used with JSON.stringify to safely serialize complex objects.
   *
   * @returns {Function} A replacer function for JSON.stringify that:
   * - Converts Map instances to plain objects
   * - Converts Set instances to arrays
   * - Replaces circular references with '[Circular]' marker
   *
   * @example
   * const obj = { name: 'test', map: new Map([['key', 'value']]) };
   * obj.self = obj; // circular reference
   * JSON.stringify(obj, Utils.getCircularReplacer());
   * // Output: {"name":"test","map":{"key":"value"},"self":"[Circular]"}
   */
  static getCircularReplacer() {
    const seen = new WeakSet();
    return (key, value) => {
      if (Utils.isMap(value)) {
        return Object.fromEntries(value);
      }
      if (Utils.isSet(value)) {
        return Array.from(value);
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    };
  }

  /**
   * Gets a nested property value from an object using dot notation.
   * @param {Object} obj The object to get the property from.
   * @param {String} path The property path in dot notation, e.g. 'databaseOptions.allowPublicExplain'.
   * @returns {any} The property value or undefined if not found.
   * @example
   * const obj = { database: { options: { enabled: true } } };
   * Utils.getNestedProperty(obj, 'database.options.enabled');
   * // Output: true
   */
  static getNestedProperty(obj, path) {
    if (!obj || !path) {
      return undefined;
    }
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current == null || typeof current !== 'object') {
        return undefined;
      }
      current = current[key];
    }
    return current;
  }

  /**
   * Parses a human-readable size string into a byte count.
   * @param {number | string} size - A number (floored to an integer), a numeric string
   *   (treated as bytes), or a string with a unit suffix: `b`, `kb`, `mb`, `gb`
   *   (case-insensitive). Examples: `'20mb'`, `'512kb'`, `'1.5gb'`, `1048576`.
   * @returns {number} The size in bytes, floored to the nearest integer.
   * @throws {Error} If the string does not match the expected format.
   */
  static parseSizeToBytes(size) {
    if (typeof size === 'number') {
      if (!Number.isFinite(size) || size < 0) {
        throw new Error(`Invalid size value: ${size}`);
      }
      return Math.floor(size);
    }
    const str = String(size).trim().toLowerCase();
    const match = str.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
    if (!match) {
      throw new Error(`Invalid size value: ${size}`);
    }
    const num = parseFloat(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'kb':
        return Math.floor(num * 1024);
      case 'mb':
        return Math.floor(num * 1024 * 1024);
      case 'gb':
        return Math.floor(num * 1024 * 1024 * 1024);
      default:
        return Math.floor(num);
    }
  }
}
module.exports = Utils;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwicHJvbWlzZXMiLCJ0eXBlcyIsIlV0aWxzIiwiZ2V0TG9jYWxpemVkUGF0aCIsImRlZmF1bHRQYXRoIiwibG9jYWxlIiwiZmlsZSIsImJhc2VuYW1lIiwiYmFzZVBhdGgiLCJkaXJuYW1lIiwibG9jYWxlUGF0aCIsImpvaW4iLCJsb2NhbGVGaWxlRXhpc3RzIiwiZmlsZUV4aXN0cyIsInN1YmRpciIsImxhbmd1YWdlIiwic3BsaXQiLCJsYW5ndWFnZVBhdGgiLCJsYW5ndWFnZUZpbGVFeGlzdHMiLCJhY2Nlc3MiLCJpc1BhdGgiLCJzIiwidGVzdCIsImZsYXR0ZW5PYmplY3QiLCJvYmoiLCJwYXJlbnRLZXkiLCJkZWxpbWl0ZXIiLCJyZXN1bHQiLCJrZXkiLCJPYmplY3QiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJuZXdLZXkiLCJpc0RhdGUiLCJ2YWx1ZSIsImlzUmVnRXhwIiwiaXNNYXAiLCJpc1NldCIsImlzTmF0aXZlRXJyb3IiLCJpc1Byb21pc2UiLCJ0aGVuIiwiZ2V0UHJvdG90eXBlT2YiLCJpc09iamVjdCIsImdldE9iamVjdEtleVBlcm11dGF0aW9ucyIsIm9iamVjdCIsImluZGV4IiwiY3VycmVudCIsInJlc3VsdHMiLCJrZXlzIiwidmFsdWVzIiwibmV4dEluZGV4IiwibGVuZ3RoIiwiYXNzaWduIiwicHVzaCIsInZhbGlkYXRlUGFyYW1zIiwicGFyYW1zIiwidHlwZSIsImlzT3B0aW9uYWwiLCJvIiwicGFyYW0iLCJ2IiwidCIsInJlbGF0aXZlVGltZVRvRGF0ZSIsInRleHQiLCJub3ciLCJEYXRlIiwidG9Mb3dlckNhc2UiLCJwYXJ0cyIsImZpbHRlciIsInBhcnQiLCJmdXR1cmUiLCJwYXN0Iiwic3RhdHVzIiwiaW5mbyIsInNsaWNlIiwicGFpcnMiLCJzaGlmdCIsInNlY29uZHMiLCJudW0iLCJpbnRlcnZhbCIsInZhbCIsIk51bWJlciIsImlzSW50ZWdlciIsIm1pbGxpc2Vjb25kcyIsInZhbHVlT2YiLCJvYmplY3RDb250YWluc0tleVZhbHVlIiwiaXNNYXRjaCIsImEiLCJiIiwiUmVnRXhwIiwiaXNLZXlNYXRjaCIsImsiLCJpc1ZhbHVlTWF0Y2giLCJzdGFjayIsInNlZW4iLCJXZWFrU2V0IiwicG9wIiwiaGFzIiwiYWRkIiwiZW50cmllcyIsInVuZGVmaW5lZCIsImluY2x1ZGVzIiwidG9TdHJpbmciLCJjaGVja1Byb2hpYml0ZWRLZXl3b3JkcyIsImNvbmZpZyIsImRhdGEiLCJyZXF1ZXN0S2V5d29yZERlbnlsaXN0Iiwia2V5d29yZCIsIm1hdGNoIiwiSlNPTiIsInN0cmluZ2lmeSIsImFkZE5lc3RlZEtleXNUb1Jvb3QiLCJlbmNvZGVGb3JVcmwiLCJpbnB1dCIsImVuY29kZVVSSUNvbXBvbmVudCIsInJlcGxhY2UiLCJjaGFyIiwiY2hhckNvZGVBdCIsInRvVXBwZXJDYXNlIiwiZ2V0Q2lyY3VsYXJSZXBsYWNlciIsImZyb21FbnRyaWVzIiwiQXJyYXkiLCJmcm9tIiwiZ2V0TmVzdGVkUHJvcGVydHkiLCJwYXJzZVNpemVUb0J5dGVzIiwic2l6ZSIsImlzRmluaXRlIiwiRXJyb3IiLCJNYXRoIiwiZmxvb3IiLCJzdHIiLCJTdHJpbmciLCJ0cmltIiwicGFyc2VGbG9hdCIsInVuaXQiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vc3JjL1V0aWxzLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogdXRpbHMuanNcbiAqIEBmaWxlIEdlbmVyYWwgcHVycG9zZSB1dGlsaXRpZXNcbiAqIEBkZXNjcmlwdGlvbiBHZW5lcmFsIHB1cnBvc2UgdXRpbGl0aWVzLlxuICovXG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJykucHJvbWlzZXM7XG5jb25zdCB7IHR5cGVzIH0gPSByZXF1aXJlKCd1dGlsJyk7XG5cbi8qKlxuICogVGhlIGdlbmVyYWwgcHVycG9zZSB1dGlsaXRpZXMuXG4gKi9cbmNsYXNzIFV0aWxzIHtcbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBnZXRMb2NhbGl6ZWRQYXRoXG4gICAqIEBkZXNjcmlwdGlvbiBSZXR1cm5zIGEgbG9jYWxpemVkIGZpbGUgcGF0aCBhY2NvcmluZyB0byB0aGUgbG9jYWxlLlxuICAgKlxuICAgKiBMb2NhbGl6ZWQgZmlsZXMgYXJlIHNlYXJjaGVkIGluIHN1YmZvbGRlcnMgb2YgYSBnaXZlbiBwYXRoLCBlLmcuXG4gICAqXG4gICAqIHJvb3QvXG4gICAqIOKUnOKUgOKUgCBiYXNlLyAgICAgICAgICAgICAgICAgICAgLy8gYmFzZSBwYXRoIHRvIGZpbGVzXG4gICAqIOKUgiAgIOKUnOKUgOKUgCBleGFtcGxlLmh0bWwgICAgICAgICAvLyBkZWZhdWx0IGZpbGVcbiAgICog4pSCICAg4pSU4pSA4pSAIGRlLyAgICAgICAgICAgICAgICAgIC8vIGRlIGxhbmd1YWdlIGZvbGRlclxuICAgKiDilIIgICDilIIgICDilJTilIDilIAgZXhhbXBsZS5odG1sICAgICAvLyBkZSBsb2NhbGl6ZWQgZmlsZVxuICAgKiDilIIgICDilJTilIDilIAgZGUtQVQvICAgICAgICAgICAgICAgLy8gZGUtQVQgbG9jYWxlIGZvbGRlclxuICAgKiDilIIgICDilIIgICDilJTilIDilIAgZXhhbXBsZS5odG1sICAgICAvLyBkZS1BVCBsb2NhbGl6ZWQgZmlsZVxuICAgKlxuICAgKiBGaWxlcyBhcmUgbWF0Y2hlZCB3aXRoIHRoZSBsb2NhbGUgaW4gdGhlIGZvbGxvd2luZyBvcmRlcjpcbiAgICogMS4gTG9jYWxlIG1hdGNoLCBlLmcuIGxvY2FsZSBgZGUtQVRgIG1hdGNoZXMgZmlsZSBpbiBmb2xkZXIgYGRlLUFUYC5cbiAgICogMi4gTGFuZ3VhZ2UgbWF0Y2gsIGUuZy4gbG9jYWxlIGBkZS1BVGAgbWF0Y2hlcyBmaWxlIGluIGZvbGRlciBgZGVgLlxuICAgKiAzLiBEZWZhdWx0OyBmaWxlIGluIGJhc2UgZm9sZGVyIGlzIHJldHVybmVkLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gZGVmYXVsdFBhdGggVGhlIGFic29sdXRlIGZpbGUgcGF0aCwgd2hpY2ggaXMgYWxzb1xuICAgKiB0aGUgZGVmYXVsdCBwYXRoIHJldHVybmVkIGlmIGxvY2FsaXphdGlvbiBpcyBub3QgYXZhaWxhYmxlLlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbG9jYWxlIFRoZSBsb2NhbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IFRoZSBvYmplY3QgY29udGFpbnM6XG4gICAqIC0gYHBhdGhgOiBUaGUgcGF0aCB0byB0aGUgbG9jYWxpemVkIGZpbGUsIG9yIHRoZSBvcmlnaW5hbCBwYXRoIGlmXG4gICAqICAgbG9jYWxpemF0aW9uIGlzIG5vdCBhdmFpbGFibGUuXG4gICAqIC0gYHN1YmRpcmA6IFRoZSBzdWJkaXJlY3Rvcnkgb2YgdGhlIGxvY2FsaXplZCBmaWxlLCBvciB1bmRlZmluZWQgaWZcbiAgICogICB0aGVyZSBpcyBubyBtYXRjaGluZyBsb2NhbGl6ZWQgZmlsZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBnZXRMb2NhbGl6ZWRQYXRoKGRlZmF1bHRQYXRoLCBsb2NhbGUpIHtcbiAgICAvLyBHZXQgZmlsZSBuYW1lIGFuZCBwYXRoc1xuICAgIGNvbnN0IGZpbGUgPSBwYXRoLmJhc2VuYW1lKGRlZmF1bHRQYXRoKTtcbiAgICBjb25zdCBiYXNlUGF0aCA9IHBhdGguZGlybmFtZShkZWZhdWx0UGF0aCk7XG5cbiAgICAvLyBJZiBsb2NhbGUgaXMgbm90IHNldCByZXR1cm4gZGVmYXVsdCBmaWxlXG4gICAgaWYgKCFsb2NhbGUpIHtcbiAgICAgIHJldHVybiB7IHBhdGg6IGRlZmF1bHRQYXRoIH07XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgZmlsZSBmb3IgbG9jYWxlIGV4aXN0c1xuICAgIGNvbnN0IGxvY2FsZVBhdGggPSBwYXRoLmpvaW4oYmFzZVBhdGgsIGxvY2FsZSwgZmlsZSk7XG4gICAgY29uc3QgbG9jYWxlRmlsZUV4aXN0cyA9IGF3YWl0IFV0aWxzLmZpbGVFeGlzdHMobG9jYWxlUGF0aCk7XG5cbiAgICAvLyBJZiBmaWxlIGZvciBsb2NhbGUgZXhpc3RzIHJldHVybiBmaWxlXG4gICAgaWYgKGxvY2FsZUZpbGVFeGlzdHMpIHtcbiAgICAgIHJldHVybiB7IHBhdGg6IGxvY2FsZVBhdGgsIHN1YmRpcjogbG9jYWxlIH07XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgZmlsZSBmb3IgbGFuZ3VhZ2UgZXhpc3RzXG4gICAgY29uc3QgbGFuZ3VhZ2UgPSBsb2NhbGUuc3BsaXQoJy0nKVswXTtcbiAgICBjb25zdCBsYW5ndWFnZVBhdGggPSBwYXRoLmpvaW4oYmFzZVBhdGgsIGxhbmd1YWdlLCBmaWxlKTtcbiAgICBjb25zdCBsYW5ndWFnZUZpbGVFeGlzdHMgPSBhd2FpdCBVdGlscy5maWxlRXhpc3RzKGxhbmd1YWdlUGF0aCk7XG5cbiAgICAvLyBJZiBmaWxlIGZvciBsYW5ndWFnZSBleGlzdHMgcmV0dXJuIGZpbGVcbiAgICBpZiAobGFuZ3VhZ2VGaWxlRXhpc3RzKSB7XG4gICAgICByZXR1cm4geyBwYXRoOiBsYW5ndWFnZVBhdGgsIHN1YmRpcjogbGFuZ3VhZ2UgfTtcbiAgICB9XG5cbiAgICAvLyBSZXR1cm4gZGVmYXVsdCBmaWxlXG4gICAgcmV0dXJuIHsgcGF0aDogZGVmYXVsdFBhdGggfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb24gZmlsZUV4aXN0c1xuICAgKiBAZGVzY3JpcHRpb24gQ2hlY2tzIHdoZXRoZXIgYSBmaWxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhdGggVGhlIGZpbGUgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Qm9vbGVhbj59IElzIHRydWUgaWYgdGhlIGZpbGUgY2FuIGJlIGFjY2Vzc2VkLCBmYWxzZSBvdGhlcndpc2UuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmlsZUV4aXN0cyhwYXRoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGZzLmFjY2VzcyhwYXRoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb24gaXNQYXRoXG4gICAqIEBkZXNjcmlwdGlvbiBFdmFsdWF0ZXMgd2hldGhlciBhIHN0cmluZyBpcyBhIGZpbGUgcGF0aCAoYXMgb3Bwb3NlZCB0byBhIFVSTCBmb3IgZXhhbXBsZSkuXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzIFRoZSBzdHJpbmcgdG8gZXZhbHVhdGUuXG4gICAqIEByZXR1cm5zIHtCb29sZWFufSBSZXR1cm5zIHRydWUgaWYgdGhlIGV2YWx1YXRlZCBzdHJpbmcgaXMgYSBwYXRoLlxuICAgKi9cbiAgc3RhdGljIGlzUGF0aChzKSB7XG4gICAgcmV0dXJuIC8oXlxcLyl8KF5cXC5cXC8pfCheXFwuXFwuXFwvKS8udGVzdChzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGbGF0dGVucyBhbiBvYmplY3QgYW5kIGNyYXRlcyBuZXcga2V5cyB3aXRoIGN1c3RvbSBkZWxpbWl0ZXJzLlxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqIFRoZSBvYmplY3QgdG8gZmxhdHRlbi5cbiAgICogQHBhcmFtIHtTdHJpbmd9IFtkZWxpbWl0ZXI9Jy4nXSBUaGUgZGVsaW1pdGVyIG9mIHRoZSBuZXdseSBnZW5lcmF0ZWQga2V5cy5cbiAgICogQHBhcmFtIHtPYmplY3R9IHJlc3VsdFxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBUaGUgZmxhdHRlbmVkIG9iamVjdC5cbiAgICoqL1xuICBzdGF0aWMgZmxhdHRlbk9iamVjdChvYmosIHBhcmVudEtleSwgZGVsaW1pdGVyID0gJy4nLCByZXN1bHQgPSB7fSkge1xuICAgIGZvciAoY29uc3Qga2V5IGluIG9iaikge1xuICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGtleSkpIHtcbiAgICAgICAgY29uc3QgbmV3S2V5ID0gcGFyZW50S2V5ID8gcGFyZW50S2V5ICsgZGVsaW1pdGVyICsga2V5IDoga2V5O1xuXG4gICAgICAgIGlmICh0eXBlb2Ygb2JqW2tleV0gPT09ICdvYmplY3QnICYmIG9ialtrZXldICE9PSBudWxsKSB7XG4gICAgICAgICAgdGhpcy5mbGF0dGVuT2JqZWN0KG9ialtrZXldLCBuZXdLZXksIGRlbGltaXRlciwgcmVzdWx0KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHRbbmV3S2V5XSA9IG9ialtrZXldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvKipcbiAgICogUmVhbG0tc2FmZSBjaGVjayBmb3IgRGF0ZS5cbiAgICogQHBhcmFtIHthbnl9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge0Jvb2xlYW59IFJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgYSBEYXRlLlxuICAgKi9cbiAgc3RhdGljIGlzRGF0ZSh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlcy5pc0RhdGUodmFsdWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWxtLXNhZmUgY2hlY2sgZm9yIFJlZ0V4cC5cbiAgICogQHBhcmFtIHthbnl9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge0Jvb2xlYW59IFJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgYSBSZWdFeHAuXG4gICAqL1xuICBzdGF0aWMgaXNSZWdFeHAodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZXMuaXNSZWdFeHAodmFsdWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWxtLXNhZmUgY2hlY2sgZm9yIE1hcC5cbiAgICogQHBhcmFtIHthbnl9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge0Jvb2xlYW59IFJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgYSBNYXAuXG4gICAqL1xuICBzdGF0aWMgaXNNYXAodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZXMuaXNNYXAodmFsdWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWxtLXNhZmUgY2hlY2sgZm9yIFNldC5cbiAgICogQHBhcmFtIHthbnl9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge0Jvb2xlYW59IFJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgYSBTZXQuXG4gICAqL1xuICBzdGF0aWMgaXNTZXQodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZXMuaXNTZXQodmFsdWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWxtLXNhZmUgY2hlY2sgZm9yIG5hdGl2ZSBFcnJvci5cbiAgICogQHBhcmFtIHthbnl9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge0Jvb2xlYW59IFJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgYSBuYXRpdmUgRXJyb3IuXG4gICAqL1xuICBzdGF0aWMgaXNOYXRpdmVFcnJvcih2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlcy5pc05hdGl2ZUVycm9yKHZhbHVlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFsbS1zYWZlIGNoZWNrIGZvciBQcm9taXNlIChkdWNrLXR5cGVkIGFzIHRoZW5hYmxlKS5cbiAgICogR3VhcmRzIGFnYWluc3QgT2JqZWN0LnByb3RvdHlwZSBwb2xsdXRpb24gYnkgZW5zdXJpbmcgYHRoZW5gIGlzIG5vdFxuICAgKiBpbmhlcml0ZWQgc29sZWx5IGZyb20gT2JqZWN0LnByb3RvdHlwZS5cbiAgICogQHBhcmFtIHthbnl9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge0Jvb2xlYW59IFJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgYSBQcm9taXNlIG9yIHRoZW5hYmxlLlxuICAgKi9cbiAgc3RhdGljIGlzUHJvbWlzZSh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IHR5cGVvZiB2YWx1ZS50aGVuICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpICE9PSBPYmplY3QucHJvdG90eXBlIHx8IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh2YWx1ZSwgJ3RoZW4nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFsbS1zYWZlIGNoZWNrIGZvciBvYmplY3QgdHlwZS4gVXNlcyBgdHlwZW9mYCBpbnN0ZWFkIG9mIGBpbnN0YW5jZW9mIE9iamVjdGBcbiAgICogd2hpY2ggZmFpbHMgYWNyb3NzIHJlYWxtcy4gUmV0dXJucyB0cnVlIGZvciBhbnkgbm9uLW51bGwgdmFsdWUgd2hlcmVcbiAgICogYHR5cGVvZmAgaXMgYCdvYmplY3QnYCwgaW5jbHVkaW5nIHBsYWluIG9iamVjdHMsIGFycmF5cywgZGF0ZXMsIG1hcHMsIHNldHMsXG4gICAqIHJlZ2V4LCBhbmQgYm94ZWQgcHJpbWl0aXZlcyAoZS5nLiBgbmV3IFN0cmluZygpYCkuIFJldHVybnMgZmFsc2UgZm9yIGBudWxsYCxcbiAgICogYHVuZGVmaW5lZGAsIHVuYm94ZWQgcHJpbWl0aXZlcywgYW5kIGZ1bmN0aW9ucy5cbiAgICogQHBhcmFtIHthbnl9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge0Jvb2xlYW59IFJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgYSBub24tbnVsbCBvYmplY3QgdHlwZS5cbiAgICovXG4gIHN0YXRpYyBpc09iamVjdCh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYW4gb2JqZWN0IHdpdGggYWxsIHBlcm11dGF0aW9ucyBvZiB0aGUgb3JpZ2luYWwga2V5cy5cbiAgICogRm9yIGV4YW1wbGUsIHRoaXMgZGVmaW5pdGlvbjpcbiAgICogYGBgXG4gICAqIHtcbiAgICogICBhOiBbdHJ1ZSwgZmFsc2VdLFxuICAgKiAgIGI6IFsxLCAyXSxcbiAgICogICBjOiBbJ3gnXVxuICAgKiB9XG4gICAqIGBgYFxuICAgKiBwZXJtdXRhdGVzIHRvOlxuICAgKiBgYGBcbiAgICogW1xuICAgKiAgIHsgYTogdHJ1ZSwgYjogMSwgYzogJ3gnIH0sXG4gICAqICAgeyBhOiB0cnVlLCBiOiAyLCBjOiAneCcgfSxcbiAgICogICB7IGE6IGZhbHNlLCBiOiAxLCBjOiAneCcgfSxcbiAgICogICB7IGE6IGZhbHNlLCBiOiAyLCBjOiAneCcgfVxuICAgKiBdXG4gICAqIGBgYFxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IFRoZSBvYmplY3QgdG8gcGVybXV0YXRlLlxuICAgKiBAcGFyYW0ge0ludGVnZXJ9IFtpbmRleD0wXSBUaGUgY3VycmVudCBrZXkgaW5kZXguXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbY3VycmVudD17fV0gVGhlIGN1cnJlbnQgcmVzdWx0IGVudHJ5IGJlaW5nIGNvbXBvc2VkLlxuICAgKiBAcGFyYW0ge0FycmF5fSBbcmVzdWx0cz1bXV0gVGhlIHJlc3VsdGluZyBhcnJheSBvZiBwZXJtdXRhdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgZ2V0T2JqZWN0S2V5UGVybXV0YXRpb25zKG9iamVjdCwgaW5kZXggPSAwLCBjdXJyZW50ID0ge30sIHJlc3VsdHMgPSBbXSkge1xuICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhvYmplY3QpO1xuICAgIGNvbnN0IGtleSA9IGtleXNbaW5kZXhdO1xuICAgIGNvbnN0IHZhbHVlcyA9IG9iamVjdFtrZXldO1xuXG4gICAgZm9yIChjb25zdCB2YWx1ZSBvZiB2YWx1ZXMpIHtcbiAgICAgIGN1cnJlbnRba2V5XSA9IHZhbHVlO1xuICAgICAgY29uc3QgbmV4dEluZGV4ID0gaW5kZXggKyAxO1xuXG4gICAgICBpZiAobmV4dEluZGV4IDwga2V5cy5sZW5ndGgpIHtcbiAgICAgICAgVXRpbHMuZ2V0T2JqZWN0S2V5UGVybXV0YXRpb25zKG9iamVjdCwgbmV4dEluZGV4LCBjdXJyZW50LCByZXN1bHRzKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IE9iamVjdC5hc3NpZ24oe30sIGN1cnJlbnQpO1xuICAgICAgICByZXN1bHRzLnB1c2gocmVzdWx0KTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdHM7XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHBhcmFtZXRlcnMgYW5kIHRocm93cyBpZiBhIHBhcmFtZXRlciBpcyBpbnZhbGlkLlxuICAgKiBFeGFtcGxlIHBhcmFtZXRlciB0eXBlcyBzeW50YXg6XG4gICAqIGBgYFxuICAgKiB7XG4gICAqICAgcGFyYW1ldGVyTmFtZToge1xuICAgKiAgICAgIHQ6ICdib29sZWFuJyxcbiAgICogICAgICB2OiBpc0Jvb2xlYW4sXG4gICAqICAgICAgbzogdHJ1ZVxuICAgKiAgIH0sXG4gICAqICAgLi4uXG4gICAqIH1cbiAgICogYGBgXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBwYXJhbXMgVGhlIHBhcmFtZXRlcnMgdG8gdmFsaWRhdGUuXG4gICAqIEBwYXJhbSB7QXJyYXk8T2JqZWN0Pn0gdHlwZXMgVGhlIHBhcmFtZXRlciB0eXBlcyB1c2VkIGZvciB2YWxpZGF0aW9uLlxuICAgKiBAcGFyYW0ge09iamVjdH0gdHlwZXMudCBUaGUgcGFyYW1ldGVyIHR5cGU7IHVzZWQgZm9yIGVycm9yIG1lc3NhZ2UsIG5vdCBmb3IgdmFsaWRhdGlvbi5cbiAgICogQHBhcmFtIHtPYmplY3R9IHR5cGVzLnYgVGhlIGZ1bmN0aW9uIHRvIHZhbGlkYXRlIHRoZSBwYXJhbWV0ZXIgdmFsdWUuXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gW3R5cGVzLm89ZmFsc2VdIElzIHRydWUgaWYgdGhlIHBhcmFtZXRlciBpcyBvcHRpb25hbC5cbiAgICovXG4gIHN0YXRpYyB2YWxpZGF0ZVBhcmFtcyhwYXJhbXMsIHR5cGVzKSB7XG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocGFyYW1zKSkge1xuICAgICAgY29uc3QgdHlwZSA9IHR5cGVzW2tleV07XG4gICAgICBjb25zdCBpc09wdGlvbmFsID0gISF0eXBlLm87XG4gICAgICBjb25zdCBwYXJhbSA9IHBhcmFtc1trZXldO1xuICAgICAgaWYgKCEoaXNPcHRpb25hbCAmJiBwYXJhbSA9PSBudWxsKSAmJiAhdHlwZS52KHBhcmFtKSkge1xuICAgICAgICB0aHJvdyBgSW52YWxpZCBwYXJhbWV0ZXIgJHtrZXl9IG11c3QgYmUgb2YgdHlwZSAke3R5cGUudH0gYnV0IGlzICR7dHlwZW9mIHBhcmFtfWA7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbXB1dGVzIHRoZSByZWxhdGl2ZSBkYXRlIGJhc2VkIG9uIGEgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1N0cmluZ30gdGV4dCBUaGUgc3RyaW5nIHRvIGludGVycHJldCB0aGUgZGF0ZSBmcm9tLlxuICAgKiBAcGFyYW0ge0RhdGV9IG5vdyBUaGUgZGF0ZSB0aGUgc3RyaW5nIGlzIGNvbXBhcmluZyBhZ2FpbnN0LlxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBUaGUgcmVsYXRpdmUgZGF0ZSBvYmplY3QuXG4gICAqKi9cbiAgc3RhdGljIHJlbGF0aXZlVGltZVRvRGF0ZSh0ZXh0LCBub3cgPSBuZXcgRGF0ZSgpKSB7XG4gICAgdGV4dCA9IHRleHQudG9Mb3dlckNhc2UoKTtcbiAgICBsZXQgcGFydHMgPSB0ZXh0LnNwbGl0KCcgJyk7XG5cbiAgICAvLyBGaWx0ZXIgb3V0IHdoaXRlc3BhY2VcbiAgICBwYXJ0cyA9IHBhcnRzLmZpbHRlcihwYXJ0ID0+IHBhcnQgIT09ICcnKTtcblxuICAgIGNvbnN0IGZ1dHVyZSA9IHBhcnRzWzBdID09PSAnaW4nO1xuICAgIGNvbnN0IHBhc3QgPSBwYXJ0c1twYXJ0cy5sZW5ndGggLSAxXSA9PT0gJ2Fnbyc7XG5cbiAgICBpZiAoIWZ1dHVyZSAmJiAhcGFzdCAmJiB0ZXh0ICE9PSAnbm93Jykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICBpbmZvOiBcIlRpbWUgc2hvdWxkIGVpdGhlciBzdGFydCB3aXRoICdpbicgb3IgZW5kIHdpdGggJ2FnbydcIixcbiAgICAgIH07XG4gICAgfVxuXG4gICAgaWYgKGZ1dHVyZSAmJiBwYXN0KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXM6ICdlcnJvcicsXG4gICAgICAgIGluZm86IFwiVGltZSBjYW5ub3QgaGF2ZSBib3RoICdpbicgYW5kICdhZ28nXCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIHN0cmlwIHRoZSAnYWdvJyBvciAnaW4nXG4gICAgaWYgKGZ1dHVyZSkge1xuICAgICAgcGFydHMgPSBwYXJ0cy5zbGljZSgxKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gcGFzdFxuICAgICAgcGFydHMgPSBwYXJ0cy5zbGljZSgwLCBwYXJ0cy5sZW5ndGggLSAxKTtcbiAgICB9XG5cbiAgICBpZiAocGFydHMubGVuZ3RoICUgMiAhPT0gMCAmJiB0ZXh0ICE9PSAnbm93Jykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICBpbmZvOiAnSW52YWxpZCB0aW1lIHN0cmluZy4gRGFuZ2xpbmcgdW5pdCBvciBudW1iZXIuJyxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3QgcGFpcnMgPSBbXTtcbiAgICB3aGlsZSAocGFydHMubGVuZ3RoKSB7XG4gICAgICBwYWlycy5wdXNoKFtwYXJ0cy5zaGlmdCgpLCBwYXJ0cy5zaGlmdCgpXSk7XG4gICAgfVxuXG4gICAgbGV0IHNlY29uZHMgPSAwO1xuICAgIGZvciAoY29uc3QgW251bSwgaW50ZXJ2YWxdIG9mIHBhaXJzKSB7XG4gICAgICBjb25zdCB2YWwgPSBOdW1iZXIobnVtKTtcbiAgICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcih2YWwpKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICAgIGluZm86IGAnJHtudW19JyBpcyBub3QgYW4gaW50ZWdlci5gLFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBzd2l0Y2ggKGludGVydmFsKSB7XG4gICAgICAgIGNhc2UgJ3lyJzpcbiAgICAgICAgY2FzZSAneXJzJzpcbiAgICAgICAgY2FzZSAneWVhcic6XG4gICAgICAgIGNhc2UgJ3llYXJzJzpcbiAgICAgICAgICBzZWNvbmRzICs9IHZhbCAqIDMxNTM2MDAwOyAvLyAzNjUgKiAyNCAqIDYwICogNjBcbiAgICAgICAgICBicmVhaztcblxuICAgICAgICBjYXNlICd3ayc6XG4gICAgICAgIGNhc2UgJ3drcyc6XG4gICAgICAgIGNhc2UgJ3dlZWsnOlxuICAgICAgICBjYXNlICd3ZWVrcyc6XG4gICAgICAgICAgc2Vjb25kcyArPSB2YWwgKiA2MDQ4MDA7IC8vIDcgKiAyNCAqIDYwICogNjBcbiAgICAgICAgICBicmVhaztcblxuICAgICAgICBjYXNlICdkJzpcbiAgICAgICAgY2FzZSAnZGF5JzpcbiAgICAgICAgY2FzZSAnZGF5cyc6XG4gICAgICAgICAgc2Vjb25kcyArPSB2YWwgKiA4NjQwMDsgLy8gMjQgKiA2MCAqIDYwXG4gICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgY2FzZSAnaHInOlxuICAgICAgICBjYXNlICdocnMnOlxuICAgICAgICBjYXNlICdob3VyJzpcbiAgICAgICAgY2FzZSAnaG91cnMnOlxuICAgICAgICAgIHNlY29uZHMgKz0gdmFsICogMzYwMDsgLy8gNjAgKiA2MFxuICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgIGNhc2UgJ21pbic6XG4gICAgICAgIGNhc2UgJ21pbnMnOlxuICAgICAgICBjYXNlICdtaW51dGUnOlxuICAgICAgICBjYXNlICdtaW51dGVzJzpcbiAgICAgICAgICBzZWNvbmRzICs9IHZhbCAqIDYwO1xuICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgIGNhc2UgJ3NlYyc6XG4gICAgICAgIGNhc2UgJ3NlY3MnOlxuICAgICAgICBjYXNlICdzZWNvbmQnOlxuICAgICAgICBjYXNlICdzZWNvbmRzJzpcbiAgICAgICAgICBzZWNvbmRzICs9IHZhbDtcbiAgICAgICAgICBicmVhaztcblxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXM6ICdlcnJvcicsXG4gICAgICAgICAgICBpbmZvOiBgSW52YWxpZCBpbnRlcnZhbDogJyR7aW50ZXJ2YWx9J2AsXG4gICAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtaWxsaXNlY29uZHMgPSBzZWNvbmRzICogMTAwMDtcbiAgICBpZiAoZnV0dXJlKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXM6ICdzdWNjZXNzJyxcbiAgICAgICAgaW5mbzogJ2Z1dHVyZScsXG4gICAgICAgIHJlc3VsdDogbmV3IERhdGUobm93LnZhbHVlT2YoKSArIG1pbGxpc2Vjb25kcyksXG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAocGFzdCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiAnc3VjY2VzcycsXG4gICAgICAgIGluZm86ICdwYXN0JyxcbiAgICAgICAgcmVzdWx0OiBuZXcgRGF0ZShub3cudmFsdWVPZigpIC0gbWlsbGlzZWNvbmRzKSxcbiAgICAgIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1czogJ3N1Y2Nlc3MnLFxuICAgICAgICBpbmZvOiAncHJlc2VudCcsXG4gICAgICAgIHJlc3VsdDogbmV3IERhdGUobm93LnZhbHVlT2YoKSksXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWVwLXNjYW5zIGFuIG9iamVjdCBmb3IgYSBtYXRjaGluZyBrZXkvdmFsdWUgZGVmaW5pdGlvbi5cbiAgICogQHBhcmFtIHtPYmplY3R9IG9iaiBUaGUgb2JqZWN0IHRvIHNjYW4uXG4gICAqIEBwYXJhbSB7U3RyaW5nIHwgdW5kZWZpbmVkfSBrZXkgVGhlIGtleSB0byBtYXRjaCwgb3IgdW5kZWZpbmVkIGlmIG9ubHkgdGhlIHZhbHVlIHNob3VsZCBiZSBtYXRjaGVkLlxuICAgKiBAcGFyYW0ge2FueSB8IHVuZGVmaW5lZH0gdmFsdWUgVGhlIHZhbHVlIHRvIG1hdGNoLCBvciB1bmRlZmluZWQgaWYgb25seSB0aGUga2V5IHNob3VsZCBiZSBtYXRjaGVkLlxuICAgKiBAcmV0dXJucyB7Qm9vbGVhbn0gVHJ1ZSBpZiBhIG1hdGNoIHdhcyBmb3VuZCwgZmFsc2Ugb3RoZXJ3aXNlLlxuICAgKi9cbiAgc3RhdGljIG9iamVjdENvbnRhaW5zS2V5VmFsdWUob2JqLCBrZXksIHZhbHVlKSB7XG4gICAgY29uc3QgaXNNYXRjaCA9IChhLCBiKSA9PiAodHlwZW9mIGEgPT09ICdzdHJpbmcnICYmIG5ldyBSZWdFeHAoYikudGVzdChhKSkgfHwgYSA9PT0gYjtcbiAgICBjb25zdCBpc0tleU1hdGNoID0gayA9PiBpc01hdGNoKGssIGtleSk7XG4gICAgY29uc3QgaXNWYWx1ZU1hdGNoID0gdiA9PiBpc01hdGNoKHYsIHZhbHVlKTtcbiAgICBjb25zdCBzdGFjayA9IFtvYmpdO1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgV2Vha1NldCgpO1xuICAgIHdoaWxlIChzdGFjay5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBjdXJyZW50ID0gc3RhY2sucG9wKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMoY3VycmVudCkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBzZWVuLmFkZChjdXJyZW50KTtcbiAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKGN1cnJlbnQpKSB7XG4gICAgICAgIGlmIChrZXkgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSA9PT0gdW5kZWZpbmVkICYmIGlzS2V5TWF0Y2goaykpIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmIChrZXkgPT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIGlzVmFsdWVNYXRjaCh2KSkge1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKGtleSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSB1bmRlZmluZWQgJiYgaXNLZXlNYXRjaChrKSAmJiBpc1ZhbHVlTWF0Y2godikpIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoWydbb2JqZWN0IE9iamVjdF0nLCAnW29iamVjdCBBcnJheV0nXS5pbmNsdWRlcyhPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodikpKSB7XG4gICAgICAgICAgc3RhY2sucHVzaCh2KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBzdGF0aWMgY2hlY2tQcm9oaWJpdGVkS2V5d29yZHMoY29uZmlnLCBkYXRhKSB7XG4gICAgaWYgKGNvbmZpZz8ucmVxdWVzdEtleXdvcmREZW55bGlzdCkge1xuICAgICAgLy8gU2NhbiByZXF1ZXN0IGRhdGEgZm9yIGRlbmllZCBrZXl3b3Jkc1xuICAgICAgZm9yIChjb25zdCBrZXl3b3JkIG9mIGNvbmZpZy5yZXF1ZXN0S2V5d29yZERlbnlsaXN0KSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gVXRpbHMub2JqZWN0Q29udGFpbnNLZXlWYWx1ZShkYXRhLCBrZXl3b3JkLmtleSwga2V5d29yZC52YWx1ZSk7XG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgIHRocm93IGBQcm9oaWJpdGVkIGtleXdvcmQgaW4gcmVxdWVzdCBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGtleXdvcmQpfS5gO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1vdmVzIHRoZSBuZXN0ZWQga2V5cyBvZiBhIHNwZWNpZmllZCBrZXkgaW4gYW4gb2JqZWN0IHRvIHRoZSByb290IG9mIHRoZSBvYmplY3QuXG4gICAqXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmogVGhlIG9iamVjdCB0byBtb2RpZnkuXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBrZXkgVGhlIGtleSB3aG9zZSBuZXN0ZWQga2V5cyB3aWxsIGJlIG1vdmVkIHRvIHJvb3QuXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IFRoZSBtb2RpZmllZCBvYmplY3QsIG9yIHRoZSBvcmlnaW5hbCBvYmplY3QgaWYgbm8gbW9kaWZpY2F0aW9uIGhhcHBlbmVkLlxuICAgKiBAZXhhbXBsZVxuICAgKiBjb25zdCBvYmogPSB7XG4gICAqICAgYTogMSxcbiAgICogICBiOiB7XG4gICAqICAgICBjOiAyLFxuICAgKiAgICAgZDogM1xuICAgKiAgIH0sXG4gICAqICAgZTogNFxuICAgKiB9O1xuICAgKiBhZGROZXN0ZWRLZXlzVG9Sb290KG9iaiwgJ2InKTtcbiAgICogY29uc29sZS5sb2cob2JqKTtcbiAgICogLy8gT3V0cHV0OiB7IGE6IDEsIGU6IDQsIGM6IDIsIGQ6IDMgfVxuICAqL1xuICBzdGF0aWMgYWRkTmVzdGVkS2V5c1RvUm9vdChvYmosIGtleSkge1xuICAgIGlmIChvYmpba2V5XSAmJiB0eXBlb2Ygb2JqW2tleV0gPT09ICdvYmplY3QnKSB7XG4gICAgICAvLyBBZGQgbmVzdGVkIGtleXMgdG8gcm9vdFxuICAgICAgT2JqZWN0LmFzc2lnbihvYmosIHsgLi4ub2JqW2tleV0gfSk7XG4gICAgICAvLyBEZWxldGUgb3JpZ2luYWwgbmVzdGVkIGtleVxuICAgICAgZGVsZXRlIG9ialtrZXldO1xuICAgIH1cbiAgICByZXR1cm4gb2JqO1xuICB9XG5cbiAgLyoqXG4gICAqIEVuY29kZXMgYSBzdHJpbmcgdG8gYmUgdXNlZCBpbiBhIFVSTC5cbiAgICogQHBhcmFtIHtTdHJpbmd9IGlucHV0IFRoZSBzdHJpbmcgdG8gZW5jb2RlLlxuICAgKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgZW5jb2RlZCBzdHJpbmcuXG4gICAqL1xuICBzdGF0aWMgZW5jb2RlRm9yVXJsKGlucHV0KSB7XG4gICAgcmV0dXJuIGVuY29kZVVSSUNvbXBvbmVudChpbnB1dCkucmVwbGFjZSgvWyEnLigpKl0vZywgY2hhciA9PlxuICAgICAgJyUnICsgY2hhci5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpXG4gICAgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgSlNPTiByZXBsYWNlciBmdW5jdGlvbiB0aGF0IGhhbmRsZXMgTWFwLCBTZXQsIGFuZCBjaXJjdWxhciByZWZlcmVuY2VzLlxuICAgKiBUaGlzIHJlcGxhY2VyIGNhbiBiZSB1c2VkIHdpdGggSlNPTi5zdHJpbmdpZnkgdG8gc2FmZWx5IHNlcmlhbGl6ZSBjb21wbGV4IG9iamVjdHMuXG4gICAqXG4gICAqIEByZXR1cm5zIHtGdW5jdGlvbn0gQSByZXBsYWNlciBmdW5jdGlvbiBmb3IgSlNPTi5zdHJpbmdpZnkgdGhhdDpcbiAgICogLSBDb252ZXJ0cyBNYXAgaW5zdGFuY2VzIHRvIHBsYWluIG9iamVjdHNcbiAgICogLSBDb252ZXJ0cyBTZXQgaW5zdGFuY2VzIHRvIGFycmF5c1xuICAgKiAtIFJlcGxhY2VzIGNpcmN1bGFyIHJlZmVyZW5jZXMgd2l0aCAnW0NpcmN1bGFyXScgbWFya2VyXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGNvbnN0IG9iaiA9IHsgbmFtZTogJ3Rlc3QnLCBtYXA6IG5ldyBNYXAoW1sna2V5JywgJ3ZhbHVlJ11dKSB9O1xuICAgKiBvYmouc2VsZiA9IG9iajsgLy8gY2lyY3VsYXIgcmVmZXJlbmNlXG4gICAqIEpTT04uc3RyaW5naWZ5KG9iaiwgVXRpbHMuZ2V0Q2lyY3VsYXJSZXBsYWNlcigpKTtcbiAgICogLy8gT3V0cHV0OiB7XCJuYW1lXCI6XCJ0ZXN0XCIsXCJtYXBcIjp7XCJrZXlcIjpcInZhbHVlXCJ9LFwic2VsZlwiOlwiW0NpcmN1bGFyXVwifVxuICAgKi9cbiAgc3RhdGljIGdldENpcmN1bGFyUmVwbGFjZXIoKSB7XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBXZWFrU2V0KCk7XG4gICAgcmV0dXJuIChrZXksIHZhbHVlKSA9PiB7XG4gICAgICBpZiAoVXRpbHMuaXNNYXAodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXModmFsdWUpO1xuICAgICAgfVxuICAgICAgaWYgKFV0aWxzLmlzU2V0KHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh2YWx1ZSk7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCkge1xuICAgICAgICBpZiAoc2Vlbi5oYXModmFsdWUpKSB7XG4gICAgICAgICAgcmV0dXJuICdbQ2lyY3VsYXJdJztcbiAgICAgICAgfVxuICAgICAgICBzZWVuLmFkZCh2YWx1ZSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIGEgbmVzdGVkIHByb3BlcnR5IHZhbHVlIGZyb20gYW4gb2JqZWN0IHVzaW5nIGRvdCBub3RhdGlvbi5cbiAgICogQHBhcmFtIHtPYmplY3R9IG9iaiBUaGUgb2JqZWN0IHRvIGdldCB0aGUgcHJvcGVydHkgZnJvbS5cbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhdGggVGhlIHByb3BlcnR5IHBhdGggaW4gZG90IG5vdGF0aW9uLCBlLmcuICdkYXRhYmFzZU9wdGlvbnMuYWxsb3dQdWJsaWNFeHBsYWluJy5cbiAgICogQHJldHVybnMge2FueX0gVGhlIHByb3BlcnR5IHZhbHVlIG9yIHVuZGVmaW5lZCBpZiBub3QgZm91bmQuXG4gICAqIEBleGFtcGxlXG4gICAqIGNvbnN0IG9iaiA9IHsgZGF0YWJhc2U6IHsgb3B0aW9uczogeyBlbmFibGVkOiB0cnVlIH0gfSB9O1xuICAgKiBVdGlscy5nZXROZXN0ZWRQcm9wZXJ0eShvYmosICdkYXRhYmFzZS5vcHRpb25zLmVuYWJsZWQnKTtcbiAgICogLy8gT3V0cHV0OiB0cnVlXG4gICAqL1xuICBzdGF0aWMgZ2V0TmVzdGVkUHJvcGVydHkob2JqLCBwYXRoKSB7XG4gICAgaWYgKCFvYmogfHwgIXBhdGgpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGNvbnN0IGtleXMgPSBwYXRoLnNwbGl0KCcuJyk7XG4gICAgbGV0IGN1cnJlbnQgPSBvYmo7XG4gICAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xuICAgICAgaWYgKGN1cnJlbnQgPT0gbnVsbCB8fCB0eXBlb2YgY3VycmVudCAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50W2tleV07XG4gICAgfVxuICAgIHJldHVybiBjdXJyZW50O1xuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBhIGh1bWFuLXJlYWRhYmxlIHNpemUgc3RyaW5nIGludG8gYSBieXRlIGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlciB8IHN0cmluZ30gc2l6ZSAtIEEgbnVtYmVyIChmbG9vcmVkIHRvIGFuIGludGVnZXIpLCBhIG51bWVyaWMgc3RyaW5nXG4gICAqICAgKHRyZWF0ZWQgYXMgYnl0ZXMpLCBvciBhIHN0cmluZyB3aXRoIGEgdW5pdCBzdWZmaXg6IGBiYCwgYGtiYCwgYG1iYCwgYGdiYFxuICAgKiAgIChjYXNlLWluc2Vuc2l0aXZlKS4gRXhhbXBsZXM6IGAnMjBtYidgLCBgJzUxMmtiJ2AsIGAnMS41Z2InYCwgYDEwNDg1NzZgLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBUaGUgc2l6ZSBpbiBieXRlcywgZmxvb3JlZCB0byB0aGUgbmVhcmVzdCBpbnRlZ2VyLlxuICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIHN0cmluZyBkb2VzIG5vdCBtYXRjaCB0aGUgZXhwZWN0ZWQgZm9ybWF0LlxuICAgKi9cbiAgc3RhdGljIHBhcnNlU2l6ZVRvQnl0ZXMoc2l6ZSkge1xuICAgIGlmICh0eXBlb2Ygc2l6ZSA9PT0gJ251bWJlcicpIHtcbiAgICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHNpemUpIHx8IHNpemUgPCAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzaXplIHZhbHVlOiAke3NpemV9YCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gTWF0aC5mbG9vcihzaXplKTtcbiAgICB9XG4gICAgY29uc3Qgc3RyID0gU3RyaW5nKHNpemUpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IG1hdGNoID0gc3RyLm1hdGNoKC9eKFxcZCsoPzpcXC5cXGQrKT8pXFxzKihifGtifG1ifGdiKT8kLyk7XG4gICAgaWYgKCFtYXRjaCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNpemUgdmFsdWU6ICR7c2l6ZX1gKTtcbiAgICB9XG4gICAgY29uc3QgbnVtID0gcGFyc2VGbG9hdChtYXRjaFsxXSk7XG4gICAgY29uc3QgdW5pdCA9IG1hdGNoWzJdO1xuICAgIHN3aXRjaCAodW5pdCkge1xuICAgICAgY2FzZSAna2InOlxuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcihudW0gKiAxMDI0KTtcbiAgICAgIGNhc2UgJ21iJzpcbiAgICAgICAgcmV0dXJuIE1hdGguZmxvb3IobnVtICogMTAyNCAqIDEwMjQpO1xuICAgICAgY2FzZSAnZ2InOlxuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcihudW0gKiAxMDI0ICogMTAyNCAqIDEwMjQpO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmV0dXJuIE1hdGguZmxvb3IobnVtKTtcbiAgICB9XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBVdGlscztcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQ0UsUUFBUTtBQUNqQyxNQUFNO0VBQUVDO0FBQU0s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