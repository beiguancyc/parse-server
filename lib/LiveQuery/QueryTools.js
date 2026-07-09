"use strict";

var equalObjects = require('./equalObjects');
var Id = require('./Id');
var Parse = require('parse/node');
var vm = require('vm');
var logger = require('../logger').default;
var regexTimeout = 0;
// IMPORTANT: vmContext is shared across all calls for performance (vm.createContext() is expensive).
// This is safe because safeRegexTest is synchronous — setting the context properties and calling
// runInContext happen in the same event loop tick with no interruption possible. Do NOT add any
// asynchronous operations (await, callbacks, promises) between setting vmContext properties and
// calling script.runInContext, as this would allow other calls to overwrite the context values
// and cause cross-contamination between regex evaluations.
var vmContext = vm.createContext(Object.create(null));
var scriptCache = new Map();
var SCRIPT_CACHE_MAX = 1000;
function setRegexTimeout(ms) {
  regexTimeout = ms;
}

// IMPORTANT: This function must remain synchronous. See vmContext comment above.
function safeRegexTest(pattern, flags, input) {
  try {
    if (!regexTimeout) {
      var re = new RegExp(pattern, flags);
      return re.test(input);
    }
    var cacheKey = flags + ':' + pattern;
    var script = scriptCache.get(cacheKey);
    if (!script) {
      if (scriptCache.size >= SCRIPT_CACHE_MAX) {
        scriptCache.clear();
      }
      script = new vm.Script('new RegExp(pattern, flags).test(input)');
      scriptCache.set(cacheKey, script);
    }
    vmContext.pattern = pattern;
    vmContext.flags = flags;
    vmContext.input = input;
    return script.runInContext(vmContext, {
      timeout: regexTimeout
    });
  } catch (e) {
    if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      logger.warn(`Regex timeout: pattern "${pattern}" with flags "${flags}" exceeded ${regexTimeout}ms limit`);
    } else {
      logger.warn(`Invalid regex: pattern "${pattern}" with flags "${flags}": ${e.message}`);
    }
    return false;
  }
}

/**
 * Query Hashes are deterministic hashes for Parse Queries.
 * Any two queries that have the same set of constraints will produce the same
 * hash. This lets us reliably group components by the queries they depend upon,
 * and quickly determine if a query has changed.
 */

/**
 * Convert $or queries into an array of where conditions
 */
function flattenOrQueries(where) {
  if (!Object.prototype.hasOwnProperty.call(where, '$or')) {
    return where;
  }
  var accum = [];
  for (var i = 0; i < where.$or.length; i++) {
    accum = accum.concat(where.$or[i]);
  }
  return accum;
}

/**
 * Deterministically turns an object into a string. Disregards ordering
 */
function stringify(object) {
  if (typeof object !== 'object' || object === null) {
    if (typeof object === 'string') {
      return '"' + object.replace(/\|/g, '%|') + '"';
    }
    return object + '';
  }
  if (Array.isArray(object)) {
    var copy = object.map(stringify);
    copy.sort();
    return '[' + copy.join(',') + ']';
  }
  var sections = [];
  var keys = Object.keys(object);
  keys.sort();
  for (var k = 0; k < keys.length; k++) {
    sections.push(stringify(keys[k]) + ':' + stringify(object[keys[k]]));
  }
  return '{' + sections.join(',') + '}';
}

/**
 * Generate a hash from a query, with unique fields for columns, values, order,
 * skip, and limit.
 */
function queryHash(query) {
  if (query instanceof Parse.Query) {
    query = {
      className: query.className,
      where: query._where
    };
  }
  var where = flattenOrQueries(query.where || {});
  var columns = [];
  var values = [];
  var i;
  if (Array.isArray(where)) {
    var uniqueColumns = {};
    for (i = 0; i < where.length; i++) {
      var subValues = {};
      var keys = Object.keys(where[i]);
      keys.sort();
      for (var j = 0; j < keys.length; j++) {
        subValues[keys[j]] = where[i][keys[j]];
        uniqueColumns[keys[j]] = true;
      }
      values.push(subValues);
    }
    columns = Object.keys(uniqueColumns);
    columns.sort();
  } else {
    columns = Object.keys(where);
    columns.sort();
    for (i = 0; i < columns.length; i++) {
      values.push(where[columns[i]]);
    }
  }
  var sections = [columns.join(','), stringify(values)];
  return query.className + ':' + sections.join('|');
}

/**
 * contains -- Determines if an object is contained in a list with special handling for Parse pointers.
 */
function contains(haystack, needle) {
  if (needle && needle.__type && needle.__type === 'Pointer') {
    for (const i in haystack) {
      const ptr = haystack[i];
      if (typeof ptr === 'string' && ptr === needle.objectId) {
        return true;
      }
      if (ptr.className === needle.className && ptr.objectId === needle.objectId) {
        return true;
      }
    }
    return false;
  }
  if (Array.isArray(needle)) {
    for (const need of needle) {
      if (contains(haystack, need)) {
        return true;
      }
    }
  }
  return haystack.indexOf(needle) > -1;
}
/**
 * matchesQuery -- Determines if an object would be returned by a Parse Query
 * It's a lightweight, where-clause only implementation of a full query engine.
 * Since we find queries that match objects, rather than objects that match
 * queries, we can avoid building a full-blown query tool.
 */
function matchesQuery(object, query) {
  if (query instanceof Parse.Query) {
    var className = object.id instanceof Id ? object.id.className : object.className;
    if (className !== query.className) {
      return false;
    }
    return matchesQuery(object, query._where);
  }
  for (var field in query) {
    if (!matchesKeyConstraints(object, field, query[field])) {
      return false;
    }
  }
  return true;
}
function equalObjectsGeneric(obj, compareTo, eqlFn) {
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      if (eqlFn(obj[i], compareTo)) {
        return true;
      }
    }
    return false;
  }
  return eqlFn(obj, compareTo);
}

/**
 * Determines whether an object matches a single key's constraints
 */
function matchesKeyConstraints(object, key, constraints) {
  if (constraints === null) {
    return false;
  }
  if (key.indexOf('.') >= 0) {
    // Key references a subobject
    var keyComponents = key.split('.');
    var subObjectKey = keyComponents[0];
    var keyRemainder = keyComponents.slice(1).join('.');
    return matchesKeyConstraints(object[subObjectKey] || {}, keyRemainder, constraints);
  }
  var i;
  if (key === '$or') {
    if (!Array.isArray(constraints)) {
      return false;
    }
    for (i = 0; i < constraints.length; i++) {
      if (matchesQuery(object, constraints[i])) {
        return true;
      }
    }
    return false;
  }
  if (key === '$and') {
    if (!Array.isArray(constraints)) {
      return false;
    }
    for (i = 0; i < constraints.length; i++) {
      if (!matchesQuery(object, constraints[i])) {
        return false;
      }
    }
    return true;
  }
  if (key === '$nor') {
    if (!Array.isArray(constraints)) {
      return false;
    }
    for (i = 0; i < constraints.length; i++) {
      if (matchesQuery(object, constraints[i])) {
        return false;
      }
    }
    return true;
  }
  if (key === '$relatedTo') {
    // Bail! We can't handle relational queries locally
    return false;
  }
  // Decode Date JSON value
  if (object[key] && object[key].__type == 'Date') {
    object[key] = new Date(object[key].iso);
  }
  // Equality (or Array contains) cases
  if (typeof constraints !== 'object') {
    if (Array.isArray(object[key])) {
      return object[key].indexOf(constraints) > -1;
    }
    return object[key] === constraints;
  }
  var compareTo;
  if (constraints.__type) {
    if (constraints.__type === 'Pointer') {
      return equalObjectsGeneric(object[key], constraints, function (obj, ptr) {
        return typeof obj !== 'undefined' && ptr.className === obj.className && ptr.objectId === obj.objectId;
      });
    }
    return equalObjectsGeneric(object[key], Parse._decode(key, constraints), equalObjects);
  }
  // More complex cases
  for (var condition in constraints) {
    compareTo = constraints[condition];
    if (compareTo?.__type) {
      compareTo = Parse._decode(key, compareTo);
    }
    switch (condition) {
      case '$lt':
        if (object[key] >= compareTo) {
          return false;
        }
        break;
      case '$lte':
        if (object[key] > compareTo) {
          return false;
        }
        break;
      case '$gt':
        if (object[key] <= compareTo) {
          return false;
        }
        break;
      case '$gte':
        if (object[key] < compareTo) {
          return false;
        }
        break;
      case '$eq':
        if (!equalObjects(object[key], compareTo)) {
          return false;
        }
        break;
      case '$ne':
        if (equalObjects(object[key], compareTo)) {
          return false;
        }
        break;
      case '$in':
        if (!contains(compareTo, object[key])) {
          return false;
        }
        break;
      case '$nin':
        if (contains(compareTo, object[key])) {
          return false;
        }
        break;
      case '$all':
        if (!object[key]) {
          return false;
        }
        for (i = 0; i < compareTo.length; i++) {
          if (object[key].indexOf(compareTo[i]) < 0) {
            return false;
          }
        }
        break;
      case '$exists':
        {
          const propertyExists = typeof object[key] !== 'undefined';
          const existenceIsRequired = constraints['$exists'];
          if (typeof constraints['$exists'] !== 'boolean') {
            // The SDK will never submit a non-boolean for $exists, but if someone
            // tries to submit a non-boolean for $exits outside the SDKs, just ignore it.
            break;
          }
          if (!propertyExists && existenceIsRequired || propertyExists && !existenceIsRequired) {
            return false;
          }
          break;
        }
      case '$regex':
        {
          if (typeof compareTo === 'object') {
            if (!safeRegexTest(compareTo.source, compareTo.flags, object[key])) {
              return false;
            }
            break;
          }
          // JS doesn't support perl-style escaping
          var expString = '';
          var escapeEnd = -2;
          var escapeStart = compareTo.indexOf('\\Q');
          while (escapeStart > -1) {
            // Add the unescaped portion
            expString += compareTo.substring(escapeEnd + 2, escapeStart);
            escapeEnd = compareTo.indexOf('\\E', escapeStart);
            if (escapeEnd > -1) {
              expString += compareTo.substring(escapeStart + 2, escapeEnd).replace(/\\\\\\\\E/g, '\\E').replace(/\W/g, '\\$&');
            }
            escapeStart = compareTo.indexOf('\\Q', escapeEnd);
          }
          expString += compareTo.substring(Math.max(escapeStart, escapeEnd + 2));
          if (!safeRegexTest(expString, constraints.$options || '', object[key])) {
            return false;
          }
          break;
        }
      case '$nearSphere':
        if (!compareTo || !object[key]) {
          return false;
        }
        var distance = compareTo.radiansTo(object[key]);
        var max = constraints.$maxDistance || Infinity;
        return distance <= max;
      case '$within':
        if (!compareTo || !object[key]) {
          return false;
        }
        var southWest = compareTo.$box[0];
        var northEast = compareTo.$box[1];
        if (southWest.latitude > northEast.latitude || southWest.longitude > northEast.longitude) {
          // Invalid box, crosses the date line
          return false;
        }
        return object[key].latitude > southWest.latitude && object[key].latitude < northEast.latitude && object[key].longitude > southWest.longitude && object[key].longitude < northEast.longitude;
      case '$containedBy':
        {
          for (const value of object[key]) {
            if (!contains(compareTo, value)) {
              return false;
            }
          }
          return true;
        }
      case '$geoWithin':
        {
          if (compareTo.$polygon) {
            const points = compareTo.$polygon.map(geoPoint => [geoPoint.latitude, geoPoint.longitude]);
            const polygon = new Parse.Polygon(points);
            return polygon.containsPoint(object[key]);
          }
          if (compareTo.$centerSphere) {
            const [WGS84Point, maxDistance] = compareTo.$centerSphere;
            const centerPoint = new Parse.GeoPoint({
              latitude: WGS84Point[1],
              longitude: WGS84Point[0]
            });
            const point = new Parse.GeoPoint(object[key]);
            const distance = point.radiansTo(centerPoint);
            return distance <= maxDistance;
          }
          break;
        }
      case '$geoIntersects':
        {
          const polygon = new Parse.Polygon(object[key].coordinates);
          const point = new Parse.GeoPoint(compareTo.$point);
          return polygon.containsPoint(point);
        }
      case '$options':
        // Not a query type, but a way to add options to $regex. Ignore and
        // avoid the default
        break;
      case '$maxDistance':
        // Not a query type, but a way to add a cap to $nearSphere. Ignore and
        // avoid the default
        break;
      case '$select':
        return false;
      case '$dontSelect':
        return false;
      default:
        return false;
    }
  }
  return true;
}
var QueryTools = {
  queryHash: queryHash,
  matchesQuery: matchesQuery,
  setRegexTimeout: setRegexTimeout
};
module.exports = QueryTools;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJlcXVhbE9iamVjdHMiLCJyZXF1aXJlIiwiSWQiLCJQYXJzZSIsInZtIiwibG9nZ2VyIiwiZGVmYXVsdCIsInJlZ2V4VGltZW91dCIsInZtQ29udGV4dCIsImNyZWF0ZUNvbnRleHQiLCJPYmplY3QiLCJjcmVhdGUiLCJzY3JpcHRDYWNoZSIsIk1hcCIsIlNDUklQVF9DQUNIRV9NQVgiLCJzZXRSZWdleFRpbWVvdXQiLCJtcyIsInNhZmVSZWdleFRlc3QiLCJwYXR0ZXJuIiwiZmxhZ3MiLCJpbnB1dCIsInJlIiwiUmVnRXhwIiwidGVzdCIsImNhY2hlS2V5Iiwic2NyaXB0IiwiZ2V0Iiwic2l6ZSIsImNsZWFyIiwiU2NyaXB0Iiwic2V0IiwicnVuSW5Db250ZXh0IiwidGltZW91dCIsImUiLCJjb2RlIiwid2FybiIsIm1lc3NhZ2UiLCJmbGF0dGVuT3JRdWVyaWVzIiwid2hlcmUiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJhY2N1bSIsImkiLCIkb3IiLCJsZW5ndGgiLCJjb25jYXQiLCJzdHJpbmdpZnkiLCJvYmplY3QiLCJyZXBsYWNlIiwiQXJyYXkiLCJpc0FycmF5IiwiY29weSIsIm1hcCIsInNvcnQiLCJqb2luIiwic2VjdGlvbnMiLCJrZXlzIiwiayIsInB1c2giLCJxdWVyeUhhc2giLCJxdWVyeSIsIlF1ZXJ5IiwiY2xhc3NOYW1lIiwiX3doZXJlIiwiY29sdW1ucyIsInZhbHVlcyIsInVuaXF1ZUNvbHVtbnMiLCJzdWJWYWx1ZXMiLCJqIiwiY29udGFpbnMiLCJoYXlzdGFjayIsIm5lZWRsZSIsIl9fdHlwZSIsInB0ciIsIm9iamVjdElkIiwibmVlZCIsImluZGV4T2YiLCJtYXRjaGVzUXVlcnkiLCJpZCIsImZpZWxkIiwibWF0Y2hlc0tleUNvbnN0cmFpbnRzIiwiZXF1YWxPYmplY3RzR2VuZXJpYyIsIm9iaiIsImNvbXBhcmVUbyIsImVxbEZuIiwia2V5IiwiY29uc3RyYWludHMiLCJrZXlDb21wb25lbnRzIiwic3BsaXQiLCJzdWJPYmplY3RLZXkiLCJrZXlSZW1haW5kZXIiLCJzbGljZSIsIkRhdGUiLCJpc28iLCJfZGVjb2RlIiwiY29uZGl0aW9uIiwicHJvcGVydHlFeGlzdHMiLCJleGlzdGVuY2VJc1JlcXVpcmVkIiwic291cmNlIiwiZXhwU3RyaW5nIiwiZXNjYXBlRW5kIiwiZXNjYXBlU3RhcnQiLCJzdWJzdHJpbmciLCJNYXRoIiwibWF4IiwiJG9wdGlvbnMiLCJkaXN0YW5jZSIsInJhZGlhbnNUbyIsIiRtYXhEaXN0YW5jZSIsIkluZmluaXR5Iiwic291dGhXZXN0IiwiJGJveCIsIm5vcnRoRWFzdCIsImxhdGl0dWRlIiwibG9uZ2l0dWRlIiwidmFsdWUiLCIkcG9seWdvbiIsInBvaW50cyIsImdlb1BvaW50IiwicG9seWdvbiIsIlBvbHlnb24iLCJjb250YWluc1BvaW50IiwiJGNlbnRlclNwaGVyZSIsIldHUzg0UG9pbnQiLCJtYXhEaXN0YW5jZSIsImNlbnRlclBvaW50IiwiR2VvUG9pbnQiLCJwb2ludCIsImNvb3JkaW5hdGVzIiwiJHBvaW50IiwiUXVlcnlUb29scyIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvTGl2ZVF1ZXJ5L1F1ZXJ5VG9vbHMuanMiXSwic291cmNlc0NvbnRlbnQiOlsidmFyIGVxdWFsT2JqZWN0cyA9IHJlcXVpcmUoJy4vZXF1YWxPYmplY3RzJyk7XG52YXIgSWQgPSByZXF1aXJlKCcuL0lkJyk7XG52YXIgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJyk7XG52YXIgdm0gPSByZXF1aXJlKCd2bScpO1xudmFyIGxvZ2dlciA9IHJlcXVpcmUoJy4uL2xvZ2dlcicpLmRlZmF1bHQ7XG5cbnZhciByZWdleFRpbWVvdXQgPSAwO1xuLy8gSU1QT1JUQU5UOiB2bUNvbnRleHQgaXMgc2hhcmVkIGFjcm9zcyBhbGwgY2FsbHMgZm9yIHBlcmZvcm1hbmNlICh2bS5jcmVhdGVDb250ZXh0KCkgaXMgZXhwZW5zaXZlKS5cbi8vIFRoaXMgaXMgc2FmZSBiZWNhdXNlIHNhZmVSZWdleFRlc3QgaXMgc3luY2hyb25vdXMg4oCUIHNldHRpbmcgdGhlIGNvbnRleHQgcHJvcGVydGllcyBhbmQgY2FsbGluZ1xuLy8gcnVuSW5Db250ZXh0IGhhcHBlbiBpbiB0aGUgc2FtZSBldmVudCBsb29wIHRpY2sgd2l0aCBubyBpbnRlcnJ1cHRpb24gcG9zc2libGUuIERvIE5PVCBhZGQgYW55XG4vLyBhc3luY2hyb25vdXMgb3BlcmF0aW9ucyAoYXdhaXQsIGNhbGxiYWNrcywgcHJvbWlzZXMpIGJldHdlZW4gc2V0dGluZyB2bUNvbnRleHQgcHJvcGVydGllcyBhbmRcbi8vIGNhbGxpbmcgc2NyaXB0LnJ1bkluQ29udGV4dCwgYXMgdGhpcyB3b3VsZCBhbGxvdyBvdGhlciBjYWxscyB0byBvdmVyd3JpdGUgdGhlIGNvbnRleHQgdmFsdWVzXG4vLyBhbmQgY2F1c2UgY3Jvc3MtY29udGFtaW5hdGlvbiBiZXR3ZWVuIHJlZ2V4IGV2YWx1YXRpb25zLlxudmFyIHZtQ29udGV4dCA9IHZtLmNyZWF0ZUNvbnRleHQoT2JqZWN0LmNyZWF0ZShudWxsKSk7XG52YXIgc2NyaXB0Q2FjaGUgPSBuZXcgTWFwKCk7XG52YXIgU0NSSVBUX0NBQ0hFX01BWCA9IDEwMDA7XG5cbmZ1bmN0aW9uIHNldFJlZ2V4VGltZW91dChtcykge1xuICByZWdleFRpbWVvdXQgPSBtcztcbn1cblxuLy8gSU1QT1JUQU5UOiBUaGlzIGZ1bmN0aW9uIG11c3QgcmVtYWluIHN5bmNocm9ub3VzLiBTZWUgdm1Db250ZXh0IGNvbW1lbnQgYWJvdmUuXG5mdW5jdGlvbiBzYWZlUmVnZXhUZXN0KHBhdHRlcm4sIGZsYWdzLCBpbnB1dCkge1xuICB0cnkge1xuICAgIGlmICghcmVnZXhUaW1lb3V0KSB7XG4gICAgICB2YXIgcmUgPSBuZXcgUmVnRXhwKHBhdHRlcm4sIGZsYWdzKTtcbiAgICAgIHJldHVybiByZS50ZXN0KGlucHV0KTtcbiAgICB9XG4gICAgdmFyIGNhY2hlS2V5ID0gZmxhZ3MgKyAnOicgKyBwYXR0ZXJuO1xuICAgIHZhciBzY3JpcHQgPSBzY3JpcHRDYWNoZS5nZXQoY2FjaGVLZXkpO1xuICAgIGlmICghc2NyaXB0KSB7XG4gICAgICBpZiAoc2NyaXB0Q2FjaGUuc2l6ZSA+PSBTQ1JJUFRfQ0FDSEVfTUFYKSB7IHNjcmlwdENhY2hlLmNsZWFyKCk7IH1cbiAgICAgIHNjcmlwdCA9IG5ldyB2bS5TY3JpcHQoJ25ldyBSZWdFeHAocGF0dGVybiwgZmxhZ3MpLnRlc3QoaW5wdXQpJyk7XG4gICAgICBzY3JpcHRDYWNoZS5zZXQoY2FjaGVLZXksIHNjcmlwdCk7XG4gICAgfVxuICAgIHZtQ29udGV4dC5wYXR0ZXJuID0gcGF0dGVybjtcbiAgICB2bUNvbnRleHQuZmxhZ3MgPSBmbGFncztcbiAgICB2bUNvbnRleHQuaW5wdXQgPSBpbnB1dDtcbiAgICByZXR1cm4gc2NyaXB0LnJ1bkluQ29udGV4dCh2bUNvbnRleHQsIHsgdGltZW91dDogcmVnZXhUaW1lb3V0IH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKGUuY29kZSA9PT0gJ0VSUl9TQ1JJUFRfRVhFQ1VUSU9OX1RJTUVPVVQnKSB7XG4gICAgICBsb2dnZXIud2FybihgUmVnZXggdGltZW91dDogcGF0dGVybiBcIiR7cGF0dGVybn1cIiB3aXRoIGZsYWdzIFwiJHtmbGFnc31cIiBleGNlZWRlZCAke3JlZ2V4VGltZW91dH1tcyBsaW1pdGApO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2dnZXIud2FybihgSW52YWxpZCByZWdleDogcGF0dGVybiBcIiR7cGF0dGVybn1cIiB3aXRoIGZsYWdzIFwiJHtmbGFnc31cIjogJHtlLm1lc3NhZ2V9YCk7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFF1ZXJ5IEhhc2hlcyBhcmUgZGV0ZXJtaW5pc3RpYyBoYXNoZXMgZm9yIFBhcnNlIFF1ZXJpZXMuXG4gKiBBbnkgdHdvIHF1ZXJpZXMgdGhhdCBoYXZlIHRoZSBzYW1lIHNldCBvZiBjb25zdHJhaW50cyB3aWxsIHByb2R1Y2UgdGhlIHNhbWVcbiAqIGhhc2guIFRoaXMgbGV0cyB1cyByZWxpYWJseSBncm91cCBjb21wb25lbnRzIGJ5IHRoZSBxdWVyaWVzIHRoZXkgZGVwZW5kIHVwb24sXG4gKiBhbmQgcXVpY2tseSBkZXRlcm1pbmUgaWYgYSBxdWVyeSBoYXMgY2hhbmdlZC5cbiAqL1xuXG4vKipcbiAqIENvbnZlcnQgJG9yIHF1ZXJpZXMgaW50byBhbiBhcnJheSBvZiB3aGVyZSBjb25kaXRpb25zXG4gKi9cbmZ1bmN0aW9uIGZsYXR0ZW5PclF1ZXJpZXMod2hlcmUpIHtcbiAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwod2hlcmUsICckb3InKSkge1xuICAgIHJldHVybiB3aGVyZTtcbiAgfVxuICB2YXIgYWNjdW0gPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB3aGVyZS4kb3IubGVuZ3RoOyBpKyspIHtcbiAgICBhY2N1bSA9IGFjY3VtLmNvbmNhdCh3aGVyZS4kb3JbaV0pO1xuICB9XG4gIHJldHVybiBhY2N1bTtcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmlzdGljYWxseSB0dXJucyBhbiBvYmplY3QgaW50byBhIHN0cmluZy4gRGlzcmVnYXJkcyBvcmRlcmluZ1xuICovXG5mdW5jdGlvbiBzdHJpbmdpZnkob2JqZWN0KTogc3RyaW5nIHtcbiAgaWYgKHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnIHx8IG9iamVjdCA9PT0gbnVsbCkge1xuICAgIGlmICh0eXBlb2Ygb2JqZWN0ID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuICdcIicgKyBvYmplY3QucmVwbGFjZSgvXFx8L2csICclfCcpICsgJ1wiJztcbiAgICB9XG4gICAgcmV0dXJuIG9iamVjdCArICcnO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KG9iamVjdCkpIHtcbiAgICB2YXIgY29weSA9IG9iamVjdC5tYXAoc3RyaW5naWZ5KTtcbiAgICBjb3B5LnNvcnQoKTtcbiAgICByZXR1cm4gJ1snICsgY29weS5qb2luKCcsJykgKyAnXSc7XG4gIH1cbiAgdmFyIHNlY3Rpb25zID0gW107XG4gIHZhciBrZXlzID0gT2JqZWN0LmtleXMob2JqZWN0KTtcbiAga2V5cy5zb3J0KCk7XG4gIGZvciAodmFyIGsgPSAwOyBrIDwga2V5cy5sZW5ndGg7IGsrKykge1xuICAgIHNlY3Rpb25zLnB1c2goc3RyaW5naWZ5KGtleXNba10pICsgJzonICsgc3RyaW5naWZ5KG9iamVjdFtrZXlzW2tdXSkpO1xuICB9XG4gIHJldHVybiAneycgKyBzZWN0aW9ucy5qb2luKCcsJykgKyAnfSc7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgYSBoYXNoIGZyb20gYSBxdWVyeSwgd2l0aCB1bmlxdWUgZmllbGRzIGZvciBjb2x1bW5zLCB2YWx1ZXMsIG9yZGVyLFxuICogc2tpcCwgYW5kIGxpbWl0LlxuICovXG5mdW5jdGlvbiBxdWVyeUhhc2gocXVlcnkpIHtcbiAgaWYgKHF1ZXJ5IGluc3RhbmNlb2YgUGFyc2UuUXVlcnkpIHtcbiAgICBxdWVyeSA9IHtcbiAgICAgIGNsYXNzTmFtZTogcXVlcnkuY2xhc3NOYW1lLFxuICAgICAgd2hlcmU6IHF1ZXJ5Ll93aGVyZSxcbiAgICB9O1xuICB9XG4gIHZhciB3aGVyZSA9IGZsYXR0ZW5PclF1ZXJpZXMocXVlcnkud2hlcmUgfHwge30pO1xuICB2YXIgY29sdW1ucyA9IFtdO1xuICB2YXIgdmFsdWVzID0gW107XG4gIHZhciBpO1xuICBpZiAoQXJyYXkuaXNBcnJheSh3aGVyZSkpIHtcbiAgICB2YXIgdW5pcXVlQ29sdW1ucyA9IHt9O1xuICAgIGZvciAoaSA9IDA7IGkgPCB3aGVyZS5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIHN1YlZhbHVlcyA9IHt9O1xuICAgICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyh3aGVyZVtpXSk7XG4gICAgICBrZXlzLnNvcnQoKTtcbiAgICAgIGZvciAodmFyIGogPSAwOyBqIDwga2V5cy5sZW5ndGg7IGorKykge1xuICAgICAgICBzdWJWYWx1ZXNba2V5c1tqXV0gPSB3aGVyZVtpXVtrZXlzW2pdXTtcbiAgICAgICAgdW5pcXVlQ29sdW1uc1trZXlzW2pdXSA9IHRydWU7XG4gICAgICB9XG4gICAgICB2YWx1ZXMucHVzaChzdWJWYWx1ZXMpO1xuICAgIH1cbiAgICBjb2x1bW5zID0gT2JqZWN0LmtleXModW5pcXVlQ29sdW1ucyk7XG4gICAgY29sdW1ucy5zb3J0KCk7XG4gIH0gZWxzZSB7XG4gICAgY29sdW1ucyA9IE9iamVjdC5rZXlzKHdoZXJlKTtcbiAgICBjb2x1bW5zLnNvcnQoKTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgY29sdW1ucy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFsdWVzLnB1c2god2hlcmVbY29sdW1uc1tpXV0pO1xuICAgIH1cbiAgfVxuXG4gIHZhciBzZWN0aW9ucyA9IFtjb2x1bW5zLmpvaW4oJywnKSwgc3RyaW5naWZ5KHZhbHVlcyldO1xuXG4gIHJldHVybiBxdWVyeS5jbGFzc05hbWUgKyAnOicgKyBzZWN0aW9ucy5qb2luKCd8Jyk7XG59XG5cbi8qKlxuICogY29udGFpbnMgLS0gRGV0ZXJtaW5lcyBpZiBhbiBvYmplY3QgaXMgY29udGFpbmVkIGluIGEgbGlzdCB3aXRoIHNwZWNpYWwgaGFuZGxpbmcgZm9yIFBhcnNlIHBvaW50ZXJzLlxuICovXG5mdW5jdGlvbiBjb250YWlucyhoYXlzdGFjazogQXJyYXksIG5lZWRsZTogYW55KTogYm9vbGVhbiB7XG4gIGlmIChuZWVkbGUgJiYgbmVlZGxlLl9fdHlwZSAmJiBuZWVkbGUuX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICBmb3IgKGNvbnN0IGkgaW4gaGF5c3RhY2spIHtcbiAgICAgIGNvbnN0IHB0ciA9IGhheXN0YWNrW2ldO1xuICAgICAgaWYgKHR5cGVvZiBwdHIgPT09ICdzdHJpbmcnICYmIHB0ciA9PT0gbmVlZGxlLm9iamVjdElkKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgaWYgKHB0ci5jbGFzc05hbWUgPT09IG5lZWRsZS5jbGFzc05hbWUgJiYgcHRyLm9iamVjdElkID09PSBuZWVkbGUub2JqZWN0SWQpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkobmVlZGxlKSkge1xuICAgIGZvciAoY29uc3QgbmVlZCBvZiBuZWVkbGUpIHtcbiAgICAgIGlmIChjb250YWlucyhoYXlzdGFjaywgbmVlZCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGhheXN0YWNrLmluZGV4T2YobmVlZGxlKSA+IC0xO1xufVxuLyoqXG4gKiBtYXRjaGVzUXVlcnkgLS0gRGV0ZXJtaW5lcyBpZiBhbiBvYmplY3Qgd291bGQgYmUgcmV0dXJuZWQgYnkgYSBQYXJzZSBRdWVyeVxuICogSXQncyBhIGxpZ2h0d2VpZ2h0LCB3aGVyZS1jbGF1c2Ugb25seSBpbXBsZW1lbnRhdGlvbiBvZiBhIGZ1bGwgcXVlcnkgZW5naW5lLlxuICogU2luY2Ugd2UgZmluZCBxdWVyaWVzIHRoYXQgbWF0Y2ggb2JqZWN0cywgcmF0aGVyIHRoYW4gb2JqZWN0cyB0aGF0IG1hdGNoXG4gKiBxdWVyaWVzLCB3ZSBjYW4gYXZvaWQgYnVpbGRpbmcgYSBmdWxsLWJsb3duIHF1ZXJ5IHRvb2wuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoZXNRdWVyeShvYmplY3Q6IGFueSwgcXVlcnk6IGFueSk6IGJvb2xlYW4ge1xuICBpZiAocXVlcnkgaW5zdGFuY2VvZiBQYXJzZS5RdWVyeSkge1xuICAgIHZhciBjbGFzc05hbWUgPSBvYmplY3QuaWQgaW5zdGFuY2VvZiBJZCA/IG9iamVjdC5pZC5jbGFzc05hbWUgOiBvYmplY3QuY2xhc3NOYW1lO1xuICAgIGlmIChjbGFzc05hbWUgIT09IHF1ZXJ5LmNsYXNzTmFtZSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gbWF0Y2hlc1F1ZXJ5KG9iamVjdCwgcXVlcnkuX3doZXJlKTtcbiAgfVxuICBmb3IgKHZhciBmaWVsZCBpbiBxdWVyeSkge1xuICAgIGlmICghbWF0Y2hlc0tleUNvbnN0cmFpbnRzKG9iamVjdCwgZmllbGQsIHF1ZXJ5W2ZpZWxkXSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIGVxdWFsT2JqZWN0c0dlbmVyaWMob2JqLCBjb21wYXJlVG8sIGVxbEZuKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KG9iaikpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9iai5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGVxbEZuKG9ialtpXSwgY29tcGFyZVRvKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcmV0dXJuIGVxbEZuKG9iaiwgY29tcGFyZVRvKTtcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmVzIHdoZXRoZXIgYW4gb2JqZWN0IG1hdGNoZXMgYSBzaW5nbGUga2V5J3MgY29uc3RyYWludHNcbiAqL1xuZnVuY3Rpb24gbWF0Y2hlc0tleUNvbnN0cmFpbnRzKG9iamVjdCwga2V5LCBjb25zdHJhaW50cykge1xuICBpZiAoY29uc3RyYWludHMgPT09IG51bGwpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGtleS5pbmRleE9mKCcuJykgPj0gMCkge1xuICAgIC8vIEtleSByZWZlcmVuY2VzIGEgc3Vib2JqZWN0XG4gICAgdmFyIGtleUNvbXBvbmVudHMgPSBrZXkuc3BsaXQoJy4nKTtcbiAgICB2YXIgc3ViT2JqZWN0S2V5ID0ga2V5Q29tcG9uZW50c1swXTtcbiAgICB2YXIga2V5UmVtYWluZGVyID0ga2V5Q29tcG9uZW50cy5zbGljZSgxKS5qb2luKCcuJyk7XG4gICAgcmV0dXJuIG1hdGNoZXNLZXlDb25zdHJhaW50cyhvYmplY3Rbc3ViT2JqZWN0S2V5XSB8fCB7fSwga2V5UmVtYWluZGVyLCBjb25zdHJhaW50cyk7XG4gIH1cbiAgdmFyIGk7XG4gIGlmIChrZXkgPT09ICckb3InKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGNvbnN0cmFpbnRzKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBmb3IgKGkgPSAwOyBpIDwgY29uc3RyYWludHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChtYXRjaGVzUXVlcnkob2JqZWN0LCBjb25zdHJhaW50c1tpXSkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoa2V5ID09PSAnJGFuZCcpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoY29uc3RyYWludHMpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGZvciAoaSA9IDA7IGkgPCBjb25zdHJhaW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKCFtYXRjaGVzUXVlcnkob2JqZWN0LCBjb25zdHJhaW50c1tpXSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICBpZiAoa2V5ID09PSAnJG5vcicpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoY29uc3RyYWludHMpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGZvciAoaSA9IDA7IGkgPCBjb25zdHJhaW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKG1hdGNoZXNRdWVyeShvYmplY3QsIGNvbnN0cmFpbnRzW2ldKSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIGlmIChrZXkgPT09ICckcmVsYXRlZFRvJykge1xuICAgIC8vIEJhaWwhIFdlIGNhbid0IGhhbmRsZSByZWxhdGlvbmFsIHF1ZXJpZXMgbG9jYWxseVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvLyBEZWNvZGUgRGF0ZSBKU09OIHZhbHVlXG4gIGlmIChvYmplY3Rba2V5XSAmJiBvYmplY3Rba2V5XS5fX3R5cGUgPT0gJ0RhdGUnKSB7XG4gICAgb2JqZWN0W2tleV0gPSBuZXcgRGF0ZShvYmplY3Rba2V5XS5pc28pO1xuICB9XG4gIC8vIEVxdWFsaXR5IChvciBBcnJheSBjb250YWlucykgY2FzZXNcbiAgaWYgKHR5cGVvZiBjb25zdHJhaW50cyAhPT0gJ29iamVjdCcpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShvYmplY3Rba2V5XSkpIHtcbiAgICAgIHJldHVybiBvYmplY3Rba2V5XS5pbmRleE9mKGNvbnN0cmFpbnRzKSA+IC0xO1xuICAgIH1cbiAgICByZXR1cm4gb2JqZWN0W2tleV0gPT09IGNvbnN0cmFpbnRzO1xuICB9XG4gIHZhciBjb21wYXJlVG87XG4gIGlmIChjb25zdHJhaW50cy5fX3R5cGUpIHtcbiAgICBpZiAoY29uc3RyYWludHMuX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgIHJldHVybiBlcXVhbE9iamVjdHNHZW5lcmljKG9iamVjdFtrZXldLCBjb25zdHJhaW50cywgZnVuY3Rpb24gKG9iaiwgcHRyKSB7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgdHlwZW9mIG9iaiAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICAgICAgICBwdHIuY2xhc3NOYW1lID09PSBvYmouY2xhc3NOYW1lICYmXG4gICAgICAgICAgcHRyLm9iamVjdElkID09PSBvYmoub2JqZWN0SWRcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBlcXVhbE9iamVjdHNHZW5lcmljKG9iamVjdFtrZXldLCBQYXJzZS5fZGVjb2RlKGtleSwgY29uc3RyYWludHMpLCBlcXVhbE9iamVjdHMpO1xuICB9XG4gIC8vIE1vcmUgY29tcGxleCBjYXNlc1xuICBmb3IgKHZhciBjb25kaXRpb24gaW4gY29uc3RyYWludHMpIHtcbiAgICBjb21wYXJlVG8gPSBjb25zdHJhaW50c1tjb25kaXRpb25dO1xuICAgIGlmIChjb21wYXJlVG8/Ll9fdHlwZSkge1xuICAgICAgY29tcGFyZVRvID0gUGFyc2UuX2RlY29kZShrZXksIGNvbXBhcmVUbyk7XG4gICAgfVxuICAgIHN3aXRjaCAoY29uZGl0aW9uKSB7XG4gICAgICBjYXNlICckbHQnOlxuICAgICAgICBpZiAob2JqZWN0W2tleV0gPj0gY29tcGFyZVRvKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnJGx0ZSc6XG4gICAgICAgIGlmIChvYmplY3Rba2V5XSA+IGNvbXBhcmVUbykge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJyRndCc6XG4gICAgICAgIGlmIChvYmplY3Rba2V5XSA8PSBjb21wYXJlVG8pIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICckZ3RlJzpcbiAgICAgICAgaWYgKG9iamVjdFtrZXldIDwgY29tcGFyZVRvKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnJGVxJzpcbiAgICAgICAgaWYgKCFlcXVhbE9iamVjdHMob2JqZWN0W2tleV0sIGNvbXBhcmVUbykpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICckbmUnOlxuICAgICAgICBpZiAoZXF1YWxPYmplY3RzKG9iamVjdFtrZXldLCBjb21wYXJlVG8pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnJGluJzpcbiAgICAgICAgaWYgKCFjb250YWlucyhjb21wYXJlVG8sIG9iamVjdFtrZXldKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJyRuaW4nOlxuICAgICAgICBpZiAoY29udGFpbnMoY29tcGFyZVRvLCBvYmplY3Rba2V5XSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICckYWxsJzpcbiAgICAgICAgaWYgKCFvYmplY3Rba2V5XSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgY29tcGFyZVRvLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgaWYgKG9iamVjdFtrZXldLmluZGV4T2YoY29tcGFyZVRvW2ldKSA8IDApIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICckZXhpc3RzJzoge1xuICAgICAgICBjb25zdCBwcm9wZXJ0eUV4aXN0cyA9IHR5cGVvZiBvYmplY3Rba2V5XSAhPT0gJ3VuZGVmaW5lZCc7XG4gICAgICAgIGNvbnN0IGV4aXN0ZW5jZUlzUmVxdWlyZWQgPSBjb25zdHJhaW50c1snJGV4aXN0cyddO1xuICAgICAgICBpZiAodHlwZW9mIGNvbnN0cmFpbnRzWyckZXhpc3RzJ10gIT09ICdib29sZWFuJykge1xuICAgICAgICAgIC8vIFRoZSBTREsgd2lsbCBuZXZlciBzdWJtaXQgYSBub24tYm9vbGVhbiBmb3IgJGV4aXN0cywgYnV0IGlmIHNvbWVvbmVcbiAgICAgICAgICAvLyB0cmllcyB0byBzdWJtaXQgYSBub24tYm9vbGVhbiBmb3IgJGV4aXRzIG91dHNpZGUgdGhlIFNES3MsIGp1c3QgaWdub3JlIGl0LlxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGlmICgoIXByb3BlcnR5RXhpc3RzICYmIGV4aXN0ZW5jZUlzUmVxdWlyZWQpIHx8IChwcm9wZXJ0eUV4aXN0cyAmJiAhZXhpc3RlbmNlSXNSZXF1aXJlZCkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlICckcmVnZXgnOiB7XG4gICAgICAgIGlmICh0eXBlb2YgY29tcGFyZVRvID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgIGlmICghc2FmZVJlZ2V4VGVzdChjb21wYXJlVG8uc291cmNlLCBjb21wYXJlVG8uZmxhZ3MsIG9iamVjdFtrZXldKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICAvLyBKUyBkb2Vzbid0IHN1cHBvcnQgcGVybC1zdHlsZSBlc2NhcGluZ1xuICAgICAgICB2YXIgZXhwU3RyaW5nID0gJyc7XG4gICAgICAgIHZhciBlc2NhcGVFbmQgPSAtMjtcbiAgICAgICAgdmFyIGVzY2FwZVN0YXJ0ID0gY29tcGFyZVRvLmluZGV4T2YoJ1xcXFxRJyk7XG4gICAgICAgIHdoaWxlIChlc2NhcGVTdGFydCA+IC0xKSB7XG4gICAgICAgICAgLy8gQWRkIHRoZSB1bmVzY2FwZWQgcG9ydGlvblxuICAgICAgICAgIGV4cFN0cmluZyArPSBjb21wYXJlVG8uc3Vic3RyaW5nKGVzY2FwZUVuZCArIDIsIGVzY2FwZVN0YXJ0KTtcbiAgICAgICAgICBlc2NhcGVFbmQgPSBjb21wYXJlVG8uaW5kZXhPZignXFxcXEUnLCBlc2NhcGVTdGFydCk7XG4gICAgICAgICAgaWYgKGVzY2FwZUVuZCA+IC0xKSB7XG4gICAgICAgICAgICBleHBTdHJpbmcgKz0gY29tcGFyZVRvXG4gICAgICAgICAgICAgIC5zdWJzdHJpbmcoZXNjYXBlU3RhcnQgKyAyLCBlc2NhcGVFbmQpXG4gICAgICAgICAgICAgIC5yZXBsYWNlKC9cXFxcXFxcXFxcXFxcXFxcRS9nLCAnXFxcXEUnKVxuICAgICAgICAgICAgICAucmVwbGFjZSgvXFxXL2csICdcXFxcJCYnKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBlc2NhcGVTdGFydCA9IGNvbXBhcmVUby5pbmRleE9mKCdcXFxcUScsIGVzY2FwZUVuZCk7XG4gICAgICAgIH1cbiAgICAgICAgZXhwU3RyaW5nICs9IGNvbXBhcmVUby5zdWJzdHJpbmcoTWF0aC5tYXgoZXNjYXBlU3RhcnQsIGVzY2FwZUVuZCArIDIpKTtcbiAgICAgICAgaWYgKCFzYWZlUmVnZXhUZXN0KGV4cFN0cmluZywgY29uc3RyYWludHMuJG9wdGlvbnMgfHwgJycsIG9iamVjdFtrZXldKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJyRuZWFyU3BoZXJlJzpcbiAgICAgICAgaWYgKCFjb21wYXJlVG8gfHwgIW9iamVjdFtrZXldKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHZhciBkaXN0YW5jZSA9IGNvbXBhcmVUby5yYWRpYW5zVG8ob2JqZWN0W2tleV0pO1xuICAgICAgICB2YXIgbWF4ID0gY29uc3RyYWludHMuJG1heERpc3RhbmNlIHx8IEluZmluaXR5O1xuICAgICAgICByZXR1cm4gZGlzdGFuY2UgPD0gbWF4O1xuICAgICAgY2FzZSAnJHdpdGhpbic6XG4gICAgICAgIGlmICghY29tcGFyZVRvIHx8ICFvYmplY3Rba2V5XSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc291dGhXZXN0ID0gY29tcGFyZVRvLiRib3hbMF07XG4gICAgICAgIHZhciBub3J0aEVhc3QgPSBjb21wYXJlVG8uJGJveFsxXTtcbiAgICAgICAgaWYgKHNvdXRoV2VzdC5sYXRpdHVkZSA+IG5vcnRoRWFzdC5sYXRpdHVkZSB8fCBzb3V0aFdlc3QubG9uZ2l0dWRlID4gbm9ydGhFYXN0LmxvbmdpdHVkZSkge1xuICAgICAgICAgIC8vIEludmFsaWQgYm94LCBjcm9zc2VzIHRoZSBkYXRlIGxpbmVcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICBvYmplY3Rba2V5XS5sYXRpdHVkZSA+IHNvdXRoV2VzdC5sYXRpdHVkZSAmJlxuICAgICAgICAgIG9iamVjdFtrZXldLmxhdGl0dWRlIDwgbm9ydGhFYXN0LmxhdGl0dWRlICYmXG4gICAgICAgICAgb2JqZWN0W2tleV0ubG9uZ2l0dWRlID4gc291dGhXZXN0LmxvbmdpdHVkZSAmJlxuICAgICAgICAgIG9iamVjdFtrZXldLmxvbmdpdHVkZSA8IG5vcnRoRWFzdC5sb25naXR1ZGVcbiAgICAgICAgKTtcbiAgICAgIGNhc2UgJyRjb250YWluZWRCeSc6IHtcbiAgICAgICAgZm9yIChjb25zdCB2YWx1ZSBvZiBvYmplY3Rba2V5XSkge1xuICAgICAgICAgIGlmICghY29udGFpbnMoY29tcGFyZVRvLCB2YWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICBjYXNlICckZ2VvV2l0aGluJzoge1xuICAgICAgICBpZiAoY29tcGFyZVRvLiRwb2x5Z29uKSB7XG4gICAgICAgICAgY29uc3QgcG9pbnRzID0gY29tcGFyZVRvLiRwb2x5Z29uLm1hcChnZW9Qb2ludCA9PiBbXG4gICAgICAgICAgICBnZW9Qb2ludC5sYXRpdHVkZSxcbiAgICAgICAgICAgIGdlb1BvaW50LmxvbmdpdHVkZSxcbiAgICAgICAgICBdKTtcbiAgICAgICAgICBjb25zdCBwb2x5Z29uID0gbmV3IFBhcnNlLlBvbHlnb24ocG9pbnRzKTtcbiAgICAgICAgICByZXR1cm4gcG9seWdvbi5jb250YWluc1BvaW50KG9iamVjdFtrZXldKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY29tcGFyZVRvLiRjZW50ZXJTcGhlcmUpIHtcbiAgICAgICAgICBjb25zdCBbV0dTODRQb2ludCwgbWF4RGlzdGFuY2VdID0gY29tcGFyZVRvLiRjZW50ZXJTcGhlcmU7XG4gICAgICAgICAgY29uc3QgY2VudGVyUG9pbnQgPSBuZXcgUGFyc2UuR2VvUG9pbnQoe1xuICAgICAgICAgICAgbGF0aXR1ZGU6IFdHUzg0UG9pbnRbMV0sXG4gICAgICAgICAgICBsb25naXR1ZGU6IFdHUzg0UG9pbnRbMF0sXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgY29uc3QgcG9pbnQgPSBuZXcgUGFyc2UuR2VvUG9pbnQob2JqZWN0W2tleV0pO1xuICAgICAgICAgIGNvbnN0IGRpc3RhbmNlID0gcG9pbnQucmFkaWFuc1RvKGNlbnRlclBvaW50KTtcbiAgICAgICAgICByZXR1cm4gZGlzdGFuY2UgPD0gbWF4RGlzdGFuY2U7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlICckZ2VvSW50ZXJzZWN0cyc6IHtcbiAgICAgICAgY29uc3QgcG9seWdvbiA9IG5ldyBQYXJzZS5Qb2x5Z29uKG9iamVjdFtrZXldLmNvb3JkaW5hdGVzKTtcbiAgICAgICAgY29uc3QgcG9pbnQgPSBuZXcgUGFyc2UuR2VvUG9pbnQoY29tcGFyZVRvLiRwb2ludCk7XG4gICAgICAgIHJldHVybiBwb2x5Z29uLmNvbnRhaW5zUG9pbnQocG9pbnQpO1xuICAgICAgfVxuICAgICAgY2FzZSAnJG9wdGlvbnMnOlxuICAgICAgICAvLyBOb3QgYSBxdWVyeSB0eXBlLCBidXQgYSB3YXkgdG8gYWRkIG9wdGlvbnMgdG8gJHJlZ2V4LiBJZ25vcmUgYW5kXG4gICAgICAgIC8vIGF2b2lkIHRoZSBkZWZhdWx0XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnJG1heERpc3RhbmNlJzpcbiAgICAgICAgLy8gTm90IGEgcXVlcnkgdHlwZSwgYnV0IGEgd2F5IHRvIGFkZCBhIGNhcCB0byAkbmVhclNwaGVyZS4gSWdub3JlIGFuZFxuICAgICAgICAvLyBhdm9pZCB0aGUgZGVmYXVsdFxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJyRzZWxlY3QnOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICBjYXNlICckZG9udFNlbGVjdCc6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbnZhciBRdWVyeVRvb2xzID0ge1xuICBxdWVyeUhhc2g6IHF1ZXJ5SGFzaCxcbiAgbWF0Y2hlc1F1ZXJ5OiBtYXRjaGVzUXVlcnksXG4gIHNldFJlZ2V4VGltZW91dDogc2V0UmVnZXhUaW1lb3V0LFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBRdWVyeVRvb2xzO1xuIl0sIm1hcHBpbmdzIjoiOztBQUFBLElBQUlBLFlBQVksR0FBR0MsT0FBTyxDQUFDLGdCQUFnQixDQUFDO0FBQzVDLElBQUlDLEVBQUUsR0FBR0QsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUN4QixJQUFJRSxLQUFLLEdBQUdGLE9BQU8sQ0FBQyxZQUFZLENBQUM7QUFDakMsSUFBSUcsRUFBRSxHQUFHSCxPQUFPLENBQUMsSUFBSSxDQUFDO0FBQ3RCLElBQUlJLE1BQU0sR0FBR0osT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDSyxPQUFPO0FBRXpDLElBQUlDLFlBQVksR0FBRyxDQUFDO0FBQ3BCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUlDLFNBQVMsR0FBR0osRUFBRSxDQUFDSyxhQUFhLENBQUNDLE1BQU0sQ0FBQ0MsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3JELElBQUlDLFdBQVcsR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FBQztBQUMzQixJQUFJQyxnQkFBZ0IsR0FBRyxJQUFJO0FBRTNCLFNBQVNDLGVBQWVBLENBQUNDLEVBQUUsRUFBRTtFQUMzQlQsWUFBWSxHQUFHUyxFQUFFO0FBQ25COztBQUVBO0FBQ0EsU0FBU0MsYUFBYUEsQ0FBQ0MsT0FBTyxFQUFFQyxLQUFLLEVBQUVDLEtBQUssRUFBRTtFQUM1QyxJQUFJO0lBQ0YsSUFBSSxDQUFDYixZQUFZLEVBQUU7TUFDakIsSUFBSWMsRUFBRSxHQUFHLElBQUlDLE1BQU0sQ0FBQ0osT0FBTyxFQUFFQyxLQUFLLENBQUM7TUFDbkMsT0FBT0UsRUFBRSxDQUFDRSxJQUFJLENBQUNILEtBQUssQ0FBQztJQUN2QjtJQUNBLElBQUlJLFFBQVEsR0FBR0wsS0FBSyxHQUFHLEdBQUcsR0FBR0QsT0FBTztJQUNwQyxJQUFJTyxNQUFNLEdBQUdiLFdBQVcsQ0FBQ2MsR0FBRyxDQUFDRixRQUFRLENBQUM7SUFDdEMsSUFBSSxDQUFDQyxNQUFNLEVBQUU7TUFDWCxJQUFJYixXQUFXLENBQUNlLElBQUksSUFBSWIsZ0JBQWdCLEVBQUU7UUFBRUYsV0FBVyxDQUFDZ0IsS0FBSyxDQUFDLENBQUM7TUFBRTtNQUNqRUgsTUFBTSxHQUFHLElBQUlyQixFQUFFLENBQUN5QixNQUFNLENBQUMsd0NBQXdDLENBQUM7TUFDaEVqQixXQUFXLENBQUNrQixHQUFHLENBQUNOLFFBQVEsRUFBRUMsTUFBTSxDQUFDO0lBQ25DO0lBQ0FqQixTQUFTLENBQUNVLE9BQU8sR0FBR0EsT0FBTztJQUMzQlYsU0FBUyxDQUFDVyxLQUFLLEdBQUdBLEtBQUs7SUFDdkJYLFNBQVMsQ0FBQ1ksS0FBSyxHQUFHQSxLQUFLO0lBQ3ZCLE9BQU9LLE1BQU0sQ0FBQ00sWUFBWSxDQUFDdkIsU0FBUyxFQUFFO01BQUV3QixPQUFPLEVBQUV6QjtJQUFhLENBQUMsQ0FBQztFQUNsRSxDQUFDLENBQUMsT0FBTzBCLENBQUMsRUFBRTtJQUNWLElBQUlBLENBQUMsQ0FBQ0MsSUFBSSxLQUFLLDhCQUE4QixFQUFFO01BQzdDN0IsTUFBTSxDQUFDOEIsSUFBSSxDQUFDLDJCQUEyQmpCLE9BQU8saUJBQWlCQyxLQUFLLGNBQWNaLFlBQVksVUFBVSxDQUFDO0lBQzNHLENBQUMsTUFBTTtNQUNMRixNQUFNLENBQUM4QixJQUFJLENBQUMsMkJBQTJCakIsT0FBTyxpQkFBaUJDLEtBQUssTUFBTWMsQ0FBQyxDQUFDRyxPQUFPLEVBQUUsQ0FBQztJQUN4RjtJQUNBLE9BQU8sS0FBSztFQUNkO0FBQ0Y7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLFNBQVNDLGdCQUFnQkEsQ0FBQ0MsS0FBSyxFQUFFO0VBQy9CLElBQUksQ0FBQzVCLE1BQU0sQ0FBQzZCLFNBQVMsQ0FBQ0MsY0FBYyxDQUFDQyxJQUFJLENBQUNILEtBQUssRUFBRSxLQUFLLENBQUMsRUFBRTtJQUN2RCxPQUFPQSxLQUFLO0VBQ2Q7RUFDQSxJQUFJSSxLQUFLLEdBQUcsRUFBRTtFQUNkLEtBQUssSUFBSUMsQ0FBQyxHQUFHLENBQUMsRUFBRUEsQ0FBQyxHQUFHTCxLQUFLLENBQUNNLEdBQUcsQ0FBQ0MsTUFBTSxFQUFFRixDQUFDLEVBQUUsRUFBRTtJQUN6Q0QsS0FBSyxHQUFHQSxLQUFLLENBQUNJLE1BQU0sQ0FBQ1IsS0FBSyxDQUFDTSxHQUFHLENBQUNELENBQUMsQ0FBQyxDQUFDO0VBQ3BDO0VBQ0EsT0FBT0QsS0FBSztBQUNkOztBQUVBO0FBQ0E7QUFDQTtBQUNBLFNBQVNLLFNBQVNBLENBQUNDLE1BQU0sRUFBVTtFQUNqQyxJQUFJLE9BQU9BLE1BQU0sS0FBSyxRQUFRLElBQUlBLE1BQU0sS0FBSyxJQUFJLEVBQUU7SUFDakQsSUFBSSxPQUFPQSxNQUFNLEtBQUssUUFBUSxFQUFFO01BQzlCLE9BQU8sR0FBRyxHQUFHQSxNQUFNLENBQUNDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEdBQUcsR0FBRztJQUNoRDtJQUNBLE9BQU9ELE1BQU0sR0FBRyxFQUFFO0VBQ3BCO0VBQ0EsSUFBSUUsS0FBSyxDQUFDQyxPQUFPLENBQUNILE1BQU0sQ0FBQyxFQUFFO0lBQ3pCLElBQUlJLElBQUksR0FBR0osTUFBTSxDQUFDSyxHQUFHLENBQUNOLFNBQVMsQ0FBQztJQUNoQ0ssSUFBSSxDQUFDRSxJQUFJLENBQUMsQ0FBQztJQUNYLE9BQU8sR0FBRyxHQUFHRixJQUFJLENBQUNHLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHO0VBQ25DO0VBQ0EsSUFBSUMsUUFBUSxHQUFHLEVBQUU7RUFDakIsSUFBSUMsSUFBSSxHQUFHL0MsTUFBTSxDQUFDK0MsSUFBSSxDQUFDVCxNQUFNLENBQUM7RUFDOUJTLElBQUksQ0FBQ0gsSUFBSSxDQUFDLENBQUM7RUFDWCxLQUFLLElBQUlJLENBQUMsR0FBRyxDQUFDLEVBQUVBLENBQUMsR0FBR0QsSUFBSSxDQUFDWixNQUFNLEVBQUVhLENBQUMsRUFBRSxFQUFFO0lBQ3BDRixRQUFRLENBQUNHLElBQUksQ0FBQ1osU0FBUyxDQUFDVSxJQUFJLENBQUNDLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxHQUFHWCxTQUFTLENBQUNDLE1BQU0sQ0FBQ1MsSUFBSSxDQUFDQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7RUFDdEU7RUFDQSxPQUFPLEdBQUcsR0FBR0YsUUFBUSxDQUFDRCxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRztBQUN2Qzs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVNLLFNBQVNBLENBQUNDLEtBQUssRUFBRTtFQUN4QixJQUFJQSxLQUFLLFlBQVkxRCxLQUFLLENBQUMyRCxLQUFLLEVBQUU7SUFDaENELEtBQUssR0FBRztNQUNORSxTQUFTLEVBQUVGLEtBQUssQ0FBQ0UsU0FBUztNQUMxQnpCLEtBQUssRUFBRXVCLEtBQUssQ0FBQ0c7SUFDZixDQUFDO0VBQ0g7RUFDQSxJQUFJMUIsS0FBSyxHQUFHRCxnQkFBZ0IsQ0FBQ3dCLEtBQUssQ0FBQ3ZCLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQztFQUMvQyxJQUFJMkIsT0FBTyxHQUFHLEVBQUU7RUFDaEIsSUFBSUMsTUFBTSxHQUFHLEVBQUU7RUFDZixJQUFJdkIsQ0FBQztFQUNMLElBQUlPLEtBQUssQ0FBQ0MsT0FBTyxDQUFDYixLQUFLLENBQUMsRUFBRTtJQUN4QixJQUFJNkIsYUFBYSxHQUFHLENBQUMsQ0FBQztJQUN0QixLQUFLeEIsQ0FBQyxHQUFHLENBQUMsRUFBRUEsQ0FBQyxHQUFHTCxLQUFLLENBQUNPLE1BQU0sRUFBRUYsQ0FBQyxFQUFFLEVBQUU7TUFDakMsSUFBSXlCLFNBQVMsR0FBRyxDQUFDLENBQUM7TUFDbEIsSUFBSVgsSUFBSSxHQUFHL0MsTUFBTSxDQUFDK0MsSUFBSSxDQUFDbkIsS0FBSyxDQUFDSyxDQUFDLENBQUMsQ0FBQztNQUNoQ2MsSUFBSSxDQUFDSCxJQUFJLENBQUMsQ0FBQztNQUNYLEtBQUssSUFBSWUsQ0FBQyxHQUFHLENBQUMsRUFBRUEsQ0FBQyxHQUFHWixJQUFJLENBQUNaLE1BQU0sRUFBRXdCLENBQUMsRUFBRSxFQUFFO1FBQ3BDRCxTQUFTLENBQUNYLElBQUksQ0FBQ1ksQ0FBQyxDQUFDLENBQUMsR0FBRy9CLEtBQUssQ0FBQ0ssQ0FBQyxDQUFDLENBQUNjLElBQUksQ0FBQ1ksQ0FBQyxDQUFDLENBQUM7UUFDdENGLGFBQWEsQ0FBQ1YsSUFBSSxDQUFDWSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUk7TUFDL0I7TUFDQUgsTUFBTSxDQUFDUCxJQUFJLENBQUNTLFNBQVMsQ0FBQztJQUN4QjtJQUNBSCxPQUFPLEdBQUd2RCxNQUFNLENBQUMrQyxJQUFJLENBQUNVLGFBQWEsQ0FBQztJQUNwQ0YsT0FBTyxDQUFDWCxJQUFJLENBQUMsQ0FBQztFQUNoQixDQUFDLE1BQU07SUFDTFcsT0FBTyxHQUFHdkQsTUFBTSxDQUFDK0MsSUFBSSxDQUFDbkIsS0FBSyxDQUFDO0lBQzVCMkIsT0FBTyxDQUFDWCxJQUFJLENBQUMsQ0FBQztJQUNkLEtBQUtYLENBQUMsR0FBRyxDQUFDLEVBQUVBLENBQUMsR0FBR3NCLE9BQU8sQ0FBQ3BCLE1BQU0sRUFBRUYsQ0FBQyxFQUFFLEVBQUU7TUFDbkN1QixNQUFNLENBQUNQLElBQUksQ0FBQ3JCLEtBQUssQ0FBQzJCLE9BQU8sQ0FBQ3RCLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDaEM7RUFDRjtFQUVBLElBQUlhLFFBQVEsR0FBRyxDQUFDUyxPQUFPLENBQUNWLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRVIsU0FBUyxDQUFDbUIsTUFBTSxDQUFDLENBQUM7RUFFckQsT0FBT0wsS0FBSyxDQUFDRSxTQUFTLEdBQUcsR0FBRyxHQUFHUCxRQUFRLENBQUNELElBQUksQ0FBQyxHQUFHLENBQUM7QUFDbkQ7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsU0FBU2UsUUFBUUEsQ0FBQ0MsUUFBZSxFQUFFQyxNQUFXLEVBQVc7RUFDdkQsSUFBSUEsTUFBTSxJQUFJQSxNQUFNLENBQUNDLE1BQU0sSUFBSUQsTUFBTSxDQUFDQyxNQUFNLEtBQUssU0FBUyxFQUFFO0lBQzFELEtBQUssTUFBTTlCLENBQUMsSUFBSTRCLFFBQVEsRUFBRTtNQUN4QixNQUFNRyxHQUFHLEdBQUdILFFBQVEsQ0FBQzVCLENBQUMsQ0FBQztNQUN2QixJQUFJLE9BQU8rQixHQUFHLEtBQUssUUFBUSxJQUFJQSxHQUFHLEtBQUtGLE1BQU0sQ0FBQ0csUUFBUSxFQUFFO1FBQ3RELE9BQU8sSUFBSTtNQUNiO01BQ0EsSUFBSUQsR0FBRyxDQUFDWCxTQUFTLEtBQUtTLE1BQU0sQ0FBQ1QsU0FBUyxJQUFJVyxHQUFHLENBQUNDLFFBQVEsS0FBS0gsTUFBTSxDQUFDRyxRQUFRLEVBQUU7UUFDMUUsT0FBTyxJQUFJO01BQ2I7SUFDRjtJQUVBLE9BQU8sS0FBSztFQUNkO0VBRUEsSUFBSXpCLEtBQUssQ0FBQ0MsT0FBTyxDQUFDcUIsTUFBTSxDQUFDLEVBQUU7SUFDekIsS0FBSyxNQUFNSSxJQUFJLElBQUlKLE1BQU0sRUFBRTtNQUN6QixJQUFJRixRQUFRLENBQUNDLFFBQVEsRUFBRUssSUFBSSxDQUFDLEVBQUU7UUFDNUIsT0FBTyxJQUFJO01BQ2I7SUFDRjtFQUNGO0VBRUEsT0FBT0wsUUFBUSxDQUFDTSxPQUFPLENBQUNMLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUN0QztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVNNLFlBQVlBLENBQUM5QixNQUFXLEVBQUVhLEtBQVUsRUFBVztFQUN0RCxJQUFJQSxLQUFLLFlBQVkxRCxLQUFLLENBQUMyRCxLQUFLLEVBQUU7SUFDaEMsSUFBSUMsU0FBUyxHQUFHZixNQUFNLENBQUMrQixFQUFFLFlBQVk3RSxFQUFFLEdBQUc4QyxNQUFNLENBQUMrQixFQUFFLENBQUNoQixTQUFTLEdBQUdmLE1BQU0sQ0FBQ2UsU0FBUztJQUNoRixJQUFJQSxTQUFTLEtBQUtGLEtBQUssQ0FBQ0UsU0FBUyxFQUFFO01BQ2pDLE9BQU8sS0FBSztJQUNkO0lBQ0EsT0FBT2UsWUFBWSxDQUFDOUIsTUFBTSxFQUFFYSxLQUFLLENBQUNHLE1BQU0sQ0FBQztFQUMzQztFQUNBLEtBQUssSUFBSWdCLEtBQUssSUFBSW5CLEtBQUssRUFBRTtJQUN2QixJQUFJLENBQUNvQixxQkFBcUIsQ0FBQ2pDLE1BQU0sRUFBRWdDLEtBQUssRUFBRW5CLEtBQUssQ0FBQ21CLEtBQUssQ0FBQyxDQUFDLEVBQUU7TUFDdkQsT0FBTyxLQUFLO0lBQ2Q7RUFDRjtFQUNBLE9BQU8sSUFBSTtBQUNiO0FBRUEsU0FBU0UsbUJBQW1CQSxDQUFDQyxHQUFHLEVBQUVDLFNBQVMsRUFBRUMsS0FBSyxFQUFFO0VBQ2xELElBQUluQyxLQUFLLENBQUNDLE9BQU8sQ0FBQ2dDLEdBQUcsQ0FBQyxFQUFFO0lBQ3RCLEtBQUssSUFBSXhDLENBQUMsR0FBRyxDQUFDLEVBQUVBLENBQUMsR0FBR3dDLEdBQUcsQ0FBQ3RDLE1BQU0sRUFBRUYsQ0FBQyxFQUFFLEVBQUU7TUFDbkMsSUFBSTBDLEtBQUssQ0FBQ0YsR0FBRyxDQUFDeEMsQ0FBQyxDQUFDLEVBQUV5QyxTQUFTLENBQUMsRUFBRTtRQUM1QixPQUFPLElBQUk7TUFDYjtJQUNGO0lBQ0EsT0FBTyxLQUFLO0VBQ2Q7RUFFQSxPQUFPQyxLQUFLLENBQUNGLEdBQUcsRUFBRUMsU0FBUyxDQUFDO0FBQzlCOztBQUVBO0FBQ0E7QUFDQTtBQUNBLFNBQVNILHFCQUFxQkEsQ0FBQ2pDLE1BQU0sRUFBRXNDLEdBQUcsRUFBRUMsV0FBVyxFQUFFO0VBQ3ZELElBQUlBLFdBQVcsS0FBSyxJQUFJLEVBQUU7SUFDeEIsT0FBTyxLQUFLO0VBQ2Q7RUFDQSxJQUFJRCxHQUFHLENBQUNULE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUU7SUFDekI7SUFDQSxJQUFJVyxhQUFhLEdBQUdGLEdBQUcsQ0FBQ0csS0FBSyxDQUFDLEdBQUcsQ0FBQztJQUNsQyxJQUFJQyxZQUFZLEdBQUdGLGFBQWEsQ0FBQyxDQUFDLENBQUM7SUFDbkMsSUFBSUcsWUFBWSxHQUFHSCxhQUFhLENBQUNJLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ3JDLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDbkQsT0FBTzBCLHFCQUFxQixDQUFDakMsTUFBTSxDQUFDMEMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUVDLFlBQVksRUFBRUosV0FBVyxDQUFDO0VBQ3JGO0VBQ0EsSUFBSTVDLENBQUM7RUFDTCxJQUFJMkMsR0FBRyxLQUFLLEtBQUssRUFBRTtJQUNqQixJQUFJLENBQUNwQyxLQUFLLENBQUNDLE9BQU8sQ0FBQ29DLFdBQVcsQ0FBQyxFQUFFO01BQy9CLE9BQU8sS0FBSztJQUNkO0lBQ0EsS0FBSzVDLENBQUMsR0FBRyxDQUFDLEVBQUVBLENBQUMsR0FBRzRDLFdBQVcsQ0FBQzFDLE1BQU0sRUFBRUYsQ0FBQyxFQUFFLEVBQUU7TUFDdkMsSUFBSW1DLFlBQVksQ0FBQzlCLE1BQU0sRUFBRXVDLFdBQVcsQ0FBQzVDLENBQUMsQ0FBQyxDQUFDLEVBQUU7UUFDeEMsT0FBTyxJQUFJO01BQ2I7SUFDRjtJQUNBLE9BQU8sS0FBSztFQUNkO0VBQ0EsSUFBSTJDLEdBQUcsS0FBSyxNQUFNLEVBQUU7SUFDbEIsSUFBSSxDQUFDcEMsS0FBSyxDQUFDQyxPQUFPLENBQUNvQyxXQUFXLENBQUMsRUFBRTtNQUMvQixPQUFPLEtBQUs7SUFDZDtJQUNBLEtBQUs1QyxDQUFDLEdBQUcsQ0FBQyxFQUFFQSxDQUFDLEdBQUc0QyxXQUFXLENBQUMxQyxNQUFNLEVBQUVGLENBQUMsRUFBRSxFQUFFO01BQ3ZDLElBQUksQ0FBQ21DLFlBQVksQ0FBQzlCLE1BQU0sRUFBRXVDLFdBQVcsQ0FBQzVDLENBQUMsQ0FBQyxDQUFDLEVBQUU7UUFDekMsT0FBTyxLQUFLO01BQ2Q7SUFDRjtJQUNBLE9BQU8sSUFBSTtFQUNiO0VBQ0EsSUFBSTJDLEdBQUcsS0FBSyxNQUFNLEVBQUU7SUFDbEIsSUFBSSxDQUFDcEMsS0FBSyxDQUFDQyxPQUFPLENBQUNvQyxXQUFXLENBQUMsRUFBRTtNQUMvQixPQUFPLEtBQUs7SUFDZDtJQUNBLEtBQUs1QyxDQUFDLEdBQUcsQ0FBQyxFQUFFQSxDQUFDLEdBQUc0QyxXQUFXLENBQUMxQyxNQUFNLEVBQUVGLENBQUMsRUFBRSxFQUFFO01BQ3ZDLElBQUltQyxZQUFZLENBQUM5QixNQUFNLEVBQUV1QyxXQUFXLENBQUM1QyxDQUFDLENBQUMsQ0FBQyxFQUFFO1FBQ3hDLE9BQU8sS0FBSztNQUNkO0lBQ0Y7SUFDQSxPQUFPLElBQUk7RUFDYjtFQUNBLElBQUkyQyxHQUFHLEtBQUssWUFBWSxFQUFFO0lBQ3hCO0lBQ0EsT0FBTyxLQUFLO0VBQ2Q7RUFDQTtFQUNBLElBQUl0QyxNQUFNLENBQUNzQyxHQUFHLENBQUMsSUFBSXRDLE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxDQUFDYixNQUFNLElBQUksTUFBTSxFQUFFO0lBQy9DekIsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLEdBQUcsSUFBSU8sSUFBSSxDQUFDN0MsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLENBQUNRLEdBQUcsQ0FBQztFQUN6QztFQUNBO0VBQ0EsSUFBSSxPQUFPUCxXQUFXLEtBQUssUUFBUSxFQUFFO0lBQ25DLElBQUlyQyxLQUFLLENBQUNDLE9BQU8sQ0FBQ0gsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLENBQUMsRUFBRTtNQUM5QixPQUFPdEMsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLENBQUNULE9BQU8sQ0FBQ1UsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQzlDO0lBQ0EsT0FBT3ZDLE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxLQUFLQyxXQUFXO0VBQ3BDO0VBQ0EsSUFBSUgsU0FBUztFQUNiLElBQUlHLFdBQVcsQ0FBQ2QsTUFBTSxFQUFFO0lBQ3RCLElBQUljLFdBQVcsQ0FBQ2QsTUFBTSxLQUFLLFNBQVMsRUFBRTtNQUNwQyxPQUFPUyxtQkFBbUIsQ0FBQ2xDLE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxFQUFFQyxXQUFXLEVBQUUsVUFBVUosR0FBRyxFQUFFVCxHQUFHLEVBQUU7UUFDdkUsT0FDRSxPQUFPUyxHQUFHLEtBQUssV0FBVyxJQUMxQlQsR0FBRyxDQUFDWCxTQUFTLEtBQUtvQixHQUFHLENBQUNwQixTQUFTLElBQy9CVyxHQUFHLENBQUNDLFFBQVEsS0FBS1EsR0FBRyxDQUFDUixRQUFRO01BRWpDLENBQUMsQ0FBQztJQUNKO0lBRUEsT0FBT08sbUJBQW1CLENBQUNsQyxNQUFNLENBQUNzQyxHQUFHLENBQUMsRUFBRW5GLEtBQUssQ0FBQzRGLE9BQU8sQ0FBQ1QsR0FBRyxFQUFFQyxXQUFXLENBQUMsRUFBRXZGLFlBQVksQ0FBQztFQUN4RjtFQUNBO0VBQ0EsS0FBSyxJQUFJZ0csU0FBUyxJQUFJVCxXQUFXLEVBQUU7SUFDakNILFNBQVMsR0FBR0csV0FBVyxDQUFDUyxTQUFTLENBQUM7SUFDbEMsSUFBSVosU0FBUyxFQUFFWCxNQUFNLEVBQUU7TUFDckJXLFNBQVMsR0FBR2pGLEtBQUssQ0FBQzRGLE9BQU8sQ0FBQ1QsR0FBRyxFQUFFRixTQUFTLENBQUM7SUFDM0M7SUFDQSxRQUFRWSxTQUFTO01BQ2YsS0FBSyxLQUFLO1FBQ1IsSUFBSWhELE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxJQUFJRixTQUFTLEVBQUU7VUFDNUIsT0FBTyxLQUFLO1FBQ2Q7UUFDQTtNQUNGLEtBQUssTUFBTTtRQUNULElBQUlwQyxNQUFNLENBQUNzQyxHQUFHLENBQUMsR0FBR0YsU0FBUyxFQUFFO1VBQzNCLE9BQU8sS0FBSztRQUNkO1FBQ0E7TUFDRixLQUFLLEtBQUs7UUFDUixJQUFJcEMsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLElBQUlGLFNBQVMsRUFBRTtVQUM1QixPQUFPLEtBQUs7UUFDZDtRQUNBO01BQ0YsS0FBSyxNQUFNO1FBQ1QsSUFBSXBDLE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxHQUFHRixTQUFTLEVBQUU7VUFDM0IsT0FBTyxLQUFLO1FBQ2Q7UUFDQTtNQUNGLEtBQUssS0FBSztRQUNSLElBQUksQ0FBQ3BGLFlBQVksQ0FBQ2dELE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxFQUFFRixTQUFTLENBQUMsRUFBRTtVQUN6QyxPQUFPLEtBQUs7UUFDZDtRQUNBO01BQ0YsS0FBSyxLQUFLO1FBQ1IsSUFBSXBGLFlBQVksQ0FBQ2dELE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxFQUFFRixTQUFTLENBQUMsRUFBRTtVQUN4QyxPQUFPLEtBQUs7UUFDZDtRQUNBO01BQ0YsS0FBSyxLQUFLO1FBQ1IsSUFBSSxDQUFDZCxRQUFRLENBQUNjLFNBQVMsRUFBRXBDLE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7VUFDckMsT0FBTyxLQUFLO1FBQ2Q7UUFDQTtNQUNGLEtBQUssTUFBTTtRQUNULElBQUloQixRQUFRLENBQUNjLFNBQVMsRUFBRXBDLE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7VUFDcEMsT0FBTyxLQUFLO1FBQ2Q7UUFDQTtNQUNGLEtBQUssTUFBTTtRQUNULElBQUksQ0FBQ3RDLE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxFQUFFO1VBQ2hCLE9BQU8sS0FBSztRQUNkO1FBQ0EsS0FBSzNDLENBQUMsR0FBRyxDQUFDLEVBQUVBLENBQUMsR0FBR3lDLFNBQVMsQ0FBQ3ZDLE1BQU0sRUFBRUYsQ0FBQyxFQUFFLEVBQUU7VUFDckMsSUFBSUssTUFBTSxDQUFDc0MsR0FBRyxDQUFDLENBQUNULE9BQU8sQ0FBQ08sU0FBUyxDQUFDekMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUU7WUFDekMsT0FBTyxLQUFLO1VBQ2Q7UUFDRjtRQUNBO01BQ0YsS0FBSyxTQUFTO1FBQUU7VUFDZCxNQUFNc0QsY0FBYyxHQUFHLE9BQU9qRCxNQUFNLENBQUNzQyxHQUFHLENBQUMsS0FBSyxXQUFXO1VBQ3pELE1BQU1ZLG1CQUFtQixHQUFHWCxXQUFXLENBQUMsU0FBUyxDQUFDO1VBQ2xELElBQUksT0FBT0EsV0FBVyxDQUFDLFNBQVMsQ0FBQyxLQUFLLFNBQVMsRUFBRTtZQUMvQztZQUNBO1lBQ0E7VUFDRjtVQUNBLElBQUssQ0FBQ1UsY0FBYyxJQUFJQyxtQkFBbUIsSUFBTUQsY0FBYyxJQUFJLENBQUNDLG1CQUFvQixFQUFFO1lBQ3hGLE9BQU8sS0FBSztVQUNkO1VBQ0E7UUFDRjtNQUNBLEtBQUssUUFBUTtRQUFFO1VBQ2IsSUFBSSxPQUFPZCxTQUFTLEtBQUssUUFBUSxFQUFFO1lBQ2pDLElBQUksQ0FBQ25FLGFBQWEsQ0FBQ21FLFNBQVMsQ0FBQ2UsTUFBTSxFQUFFZixTQUFTLENBQUNqRSxLQUFLLEVBQUU2QixNQUFNLENBQUNzQyxHQUFHLENBQUMsQ0FBQyxFQUFFO2NBQ2xFLE9BQU8sS0FBSztZQUNkO1lBQ0E7VUFDRjtVQUNBO1VBQ0EsSUFBSWMsU0FBUyxHQUFHLEVBQUU7VUFDbEIsSUFBSUMsU0FBUyxHQUFHLENBQUMsQ0FBQztVQUNsQixJQUFJQyxXQUFXLEdBQUdsQixTQUFTLENBQUNQLE9BQU8sQ0FBQyxLQUFLLENBQUM7VUFDMUMsT0FBT3lCLFdBQVcsR0FBRyxDQUFDLENBQUMsRUFBRTtZQUN2QjtZQUNBRixTQUFTLElBQUloQixTQUFTLENBQUNtQixTQUFTLENBQUNGLFNBQVMsR0FBRyxDQUFDLEVBQUVDLFdBQVcsQ0FBQztZQUM1REQsU0FBUyxHQUFHakIsU0FBUyxDQUFDUCxPQUFPLENBQUMsS0FBSyxFQUFFeUIsV0FBVyxDQUFDO1lBQ2pELElBQUlELFNBQVMsR0FBRyxDQUFDLENBQUMsRUFBRTtjQUNsQkQsU0FBUyxJQUFJaEIsU0FBUyxDQUNuQm1CLFNBQVMsQ0FBQ0QsV0FBVyxHQUFHLENBQUMsRUFBRUQsU0FBUyxDQUFDLENBQ3JDcEQsT0FBTyxDQUFDLFlBQVksRUFBRSxLQUFLLENBQUMsQ0FDNUJBLE9BQU8sQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDO1lBQzNCO1lBRUFxRCxXQUFXLEdBQUdsQixTQUFTLENBQUNQLE9BQU8sQ0FBQyxLQUFLLEVBQUV3QixTQUFTLENBQUM7VUFDbkQ7VUFDQUQsU0FBUyxJQUFJaEIsU0FBUyxDQUFDbUIsU0FBUyxDQUFDQyxJQUFJLENBQUNDLEdBQUcsQ0FBQ0gsV0FBVyxFQUFFRCxTQUFTLEdBQUcsQ0FBQyxDQUFDLENBQUM7VUFDdEUsSUFBSSxDQUFDcEYsYUFBYSxDQUFDbUYsU0FBUyxFQUFFYixXQUFXLENBQUNtQixRQUFRLElBQUksRUFBRSxFQUFFMUQsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLENBQUMsRUFBRTtZQUN0RSxPQUFPLEtBQUs7VUFDZDtVQUNBO1FBQ0Y7TUFDQSxLQUFLLGFBQWE7UUFDaEIsSUFBSSxDQUFDRixTQUFTLElBQUksQ0FBQ3BDLE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxFQUFFO1VBQzlCLE9BQU8sS0FBSztRQUNkO1FBQ0EsSUFBSXFCLFFBQVEsR0FBR3ZCLFNBQVMsQ0FBQ3dCLFNBQVMsQ0FBQzVELE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxDQUFDO1FBQy9DLElBQUltQixHQUFHLEdBQUdsQixXQUFXLENBQUNzQixZQUFZLElBQUlDLFFBQVE7UUFDOUMsT0FBT0gsUUFBUSxJQUFJRixHQUFHO01BQ3hCLEtBQUssU0FBUztRQUNaLElBQUksQ0FBQ3JCLFNBQVMsSUFBSSxDQUFDcEMsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLEVBQUU7VUFDOUIsT0FBTyxLQUFLO1FBQ2Q7UUFDQSxJQUFJeUIsU0FBUyxHQUFHM0IsU0FBUyxDQUFDNEIsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUNqQyxJQUFJQyxTQUFTLEdBQUc3QixTQUFTLENBQUM0QixJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQ2pDLElBQUlELFNBQVMsQ0FBQ0csUUFBUSxHQUFHRCxTQUFTLENBQUNDLFFBQVEsSUFBSUgsU0FBUyxDQUFDSSxTQUFTLEdBQUdGLFNBQVMsQ0FBQ0UsU0FBUyxFQUFFO1VBQ3hGO1VBQ0EsT0FBTyxLQUFLO1FBQ2Q7UUFDQSxPQUNFbkUsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLENBQUM0QixRQUFRLEdBQUdILFNBQVMsQ0FBQ0csUUFBUSxJQUN6Q2xFLE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxDQUFDNEIsUUFBUSxHQUFHRCxTQUFTLENBQUNDLFFBQVEsSUFDekNsRSxNQUFNLENBQUNzQyxHQUFHLENBQUMsQ0FBQzZCLFNBQVMsR0FBR0osU0FBUyxDQUFDSSxTQUFTLElBQzNDbkUsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLENBQUM2QixTQUFTLEdBQUdGLFNBQVMsQ0FBQ0UsU0FBUztNQUUvQyxLQUFLLGNBQWM7UUFBRTtVQUNuQixLQUFLLE1BQU1DLEtBQUssSUFBSXBFLE1BQU0sQ0FBQ3NDLEdBQUcsQ0FBQyxFQUFFO1lBQy9CLElBQUksQ0FBQ2hCLFFBQVEsQ0FBQ2MsU0FBUyxFQUFFZ0MsS0FBSyxDQUFDLEVBQUU7Y0FDL0IsT0FBTyxLQUFLO1lBQ2Q7VUFDRjtVQUNBLE9BQU8sSUFBSTtRQUNiO01BQ0EsS0FBSyxZQUFZO1FBQUU7VUFDakIsSUFBSWhDLFNBQVMsQ0FBQ2lDLFFBQVEsRUFBRTtZQUN0QixNQUFNQyxNQUFNLEdBQUdsQyxTQUFTLENBQUNpQyxRQUFRLENBQUNoRSxHQUFHLENBQUNrRSxRQUFRLElBQUksQ0FDaERBLFFBQVEsQ0FBQ0wsUUFBUSxFQUNqQkssUUFBUSxDQUFDSixTQUFTLENBQ25CLENBQUM7WUFDRixNQUFNSyxPQUFPLEdBQUcsSUFBSXJILEtBQUssQ0FBQ3NILE9BQU8sQ0FBQ0gsTUFBTSxDQUFDO1lBQ3pDLE9BQU9FLE9BQU8sQ0FBQ0UsYUFBYSxDQUFDMUUsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLENBQUM7VUFDM0M7VUFDQSxJQUFJRixTQUFTLENBQUN1QyxhQUFhLEVBQUU7WUFDM0IsTUFBTSxDQUFDQyxVQUFVLEVBQUVDLFdBQVcsQ0FBQyxHQUFHekMsU0FBUyxDQUFDdUMsYUFBYTtZQUN6RCxNQUFNRyxXQUFXLEdBQUcsSUFBSTNILEtBQUssQ0FBQzRILFFBQVEsQ0FBQztjQUNyQ2IsUUFBUSxFQUFFVSxVQUFVLENBQUMsQ0FBQyxDQUFDO2NBQ3ZCVCxTQUFTLEVBQUVTLFVBQVUsQ0FBQyxDQUFDO1lBQ3pCLENBQUMsQ0FBQztZQUNGLE1BQU1JLEtBQUssR0FBRyxJQUFJN0gsS0FBSyxDQUFDNEgsUUFBUSxDQUFDL0UsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLENBQUM7WUFDN0MsTUFBTXFCLFFBQVEsR0FBR3FCLEtBQUssQ0FBQ3BCLFNBQVMsQ0FBQ2tCLFdBQVcsQ0FBQztZQUM3QyxPQUFPbkIsUUFBUSxJQUFJa0IsV0FBVztVQUNoQztVQUNBO1FBQ0Y7TUFDQSxLQUFLLGdCQUFnQjtRQUFFO1VBQ3JCLE1BQU1MLE9BQU8sR0FBRyxJQUFJckgsS0FBSyxDQUFDc0gsT0FBTyxDQUFDekUsTUFBTSxDQUFDc0MsR0FBRyxDQUFDLENBQUMyQyxXQUFXLENBQUM7VUFDMUQsTUFBTUQsS0FBSyxHQUFHLElBQUk3SCxLQUFLLENBQUM0SCxRQUFRLENBQUMzQyxTQUFTLENBQUM4QyxNQUFNLENBQUM7VUFDbEQsT0FBT1YsT0FBTyxDQUFDRSxhQUFhLENBQUNNLEtBQUssQ0FBQztRQUNyQztNQUNBLEtBQUssVUFBVTtRQUNiO1FBQ0E7UUFDQTtNQUNGLEtBQUssY0FBYztRQUNqQjtRQUNBO1FBQ0E7TUFDRixLQUFLLFNBQVM7UUFDWixPQUFPLEtBQUs7TUFDZCxLQUFLLGFBQWE7UUFDaEIsT0FBTyxLQUFLO01BQ2Q7UUFDRSxPQUFPLEtBQUs7SUFDaEI7RUFDRjtFQUNBLE9BQU8sSUFBSTtBQUNiO0FBRUEsSUFBSUcsVUFBVSxHQUFHO0VBQ2Z2RSxTQUFTLEVBQUVBLFNBQVM7RUFDcEJrQixZQUFZLEVBQUVBLFlBQVk7RUFDMUIvRCxlQUFlLEVBQUVBO0FBQ25CLENBQUM7QUFFRHFILE1BQU0sQ0FBQ0MsT0FBTyxHQUFHRixVQUFVIiwiaWdub3JlTGlzdCI6W119