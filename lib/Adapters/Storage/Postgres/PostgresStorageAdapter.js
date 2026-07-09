"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.PostgresStorageAdapter = void 0;
var _PostgresClient = require("./PostgresClient");
var _node = _interopRequireDefault(require("parse/node"));
var _lodash = _interopRequireDefault(require("lodash"));
var _crypto = require("crypto");
var _sql = _interopRequireDefault(require("./sql"));
var _StorageAdapter = require("../StorageAdapter");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// -disable-next
// -disable-next
// -disable-next
const Utils = require('../../../Utils');
const PostgresRelationDoesNotExistError = '42P01';
const PostgresDuplicateRelationError = '42P07';
const PostgresDuplicateColumnError = '42701';
const PostgresMissingColumnError = '42703';
const PostgresUniqueIndexViolationError = '23505';
const logger = require('../../../logger');
const debug = function (...args) {
  args = ['PG: ' + arguments[0]].concat(args.slice(1, args.length));
  const log = logger.getLogger();
  log.debug.apply(log, args);
};
const parseTypeToPostgresType = type => {
  switch (type.type) {
    case 'String':
      return 'text';
    case 'Date':
      return 'timestamp with time zone';
    case 'Object':
      return 'jsonb';
    case 'File':
      return 'text';
    case 'Boolean':
      return 'boolean';
    case 'Pointer':
      return 'text';
    case 'Number':
      return 'double precision';
    case 'GeoPoint':
      return 'point';
    case 'Bytes':
      return 'jsonb';
    case 'Polygon':
      return 'polygon';
    case 'Array':
      if (type.contents && type.contents.type === 'String') {
        return 'text[]';
      } else {
        return 'jsonb';
      }
    default:
      throw `no type for ${JSON.stringify(type)} yet`;
  }
};
const ParseToPosgresComparator = {
  $gt: '>',
  $lt: '<',
  $gte: '>=',
  $lte: '<='
};
const mongoAggregateToPostgres = {
  $dayOfMonth: 'DAY',
  $dayOfWeek: 'DOW',
  $dayOfYear: 'DOY',
  $isoDayOfWeek: 'ISODOW',
  $isoWeekYear: 'ISOYEAR',
  $hour: 'HOUR',
  $minute: 'MINUTE',
  $second: 'SECOND',
  $millisecond: 'MILLISECONDS',
  $month: 'MONTH',
  $week: 'WEEK',
  $year: 'YEAR'
};
const toPostgresValue = value => {
  if (typeof value === 'object') {
    if (value.__type === 'Date') {
      return value.iso;
    }
    if (value.__type === 'File') {
      return value.name;
    }
  }
  return value;
};
const toPostgresValueCastType = value => {
  const postgresValue = toPostgresValue(value);
  let castType;
  switch (typeof postgresValue) {
    case 'number':
      castType = 'double precision';
      break;
    case 'boolean':
      castType = 'boolean';
      break;
    default:
      castType = undefined;
  }
  return castType;
};
const transformValue = value => {
  if (typeof value === 'object' && value.__type === 'Pointer') {
    return value.objectId;
  }
  return value;
};

// Duplicate from then mongo adapter...
const emptyCLPS = Object.freeze({
  find: {},
  get: {},
  count: {},
  create: {},
  update: {},
  delete: {},
  addField: {},
  protectedFields: {}
});
const defaultCLPS = Object.freeze({
  ACL: {
    '*': {
      read: true,
      write: true
    }
  },
  find: {
    '*': true
  },
  get: {
    '*': true
  },
  count: {
    '*': true
  },
  create: {
    '*': true
  },
  update: {
    '*': true
  },
  delete: {
    '*': true
  },
  addField: {
    '*': true
  },
  protectedFields: {
    '*': []
  }
});
const toParseSchema = schema => {
  if (schema.className === '_User') {
    delete schema.fields._hashed_password;
  }
  if (schema.fields) {
    delete schema.fields._wperm;
    delete schema.fields._rperm;
  }
  let clps = defaultCLPS;
  if (schema.classLevelPermissions) {
    clps = {
      ...emptyCLPS,
      ...schema.classLevelPermissions
    };
  }
  let indexes = {};
  if (schema.indexes) {
    indexes = {
      ...schema.indexes
    };
  }
  return {
    className: schema.className,
    fields: schema.fields,
    classLevelPermissions: clps,
    indexes
  };
};
const toPostgresSchema = schema => {
  if (!schema) {
    return schema;
  }
  schema.fields = schema.fields || {};
  schema.fields._wperm = {
    type: 'Array',
    contents: {
      type: 'String'
    }
  };
  schema.fields._rperm = {
    type: 'Array',
    contents: {
      type: 'String'
    }
  };
  if (schema.className === '_User') {
    schema.fields._hashed_password = {
      type: 'String'
    };
    schema.fields._password_history = {
      type: 'Array'
    };
  }
  return schema;
};
const isArrayIndex = arrayIndex => Array.from(arrayIndex).every(c => c >= '0' && c <= '9');
const handleDotFields = object => {
  Object.keys(object).forEach(fieldName => {
    if (fieldName.indexOf('.') > -1) {
      const components = fieldName.split('.');
      const first = components.shift();
      object[first] = object[first] || {};
      let currentObj = object[first];
      let next;
      let value = object[fieldName];
      if (value && value.__op === 'Delete') {
        value = undefined;
      }
      while (next = components.shift()) {
        currentObj[next] = currentObj[next] || {};
        if (components.length === 0) {
          currentObj[next] = value;
        }
        currentObj = currentObj[next];
      }
      delete object[fieldName];
    }
  });
  return object;
};
const escapeSqlString = value => value.replace(/'/g, "''");
const escapeJsonString = value => JSON.stringify(value).slice(1, -1);
const transformDotFieldToComponents = fieldName => {
  return fieldName.split('.').map((cmpt, index) => {
    if (index === 0) {
      return `"${cmpt.replace(/"/g, '""')}"`;
    }
    if (isArrayIndex(cmpt)) {
      return Number(cmpt);
    } else {
      return `'${escapeSqlString(cmpt)}'`;
    }
  });
};
const transformDotField = fieldName => {
  if (fieldName.indexOf('.') === -1) {
    return `"${fieldName.replace(/"/g, '""')}"`;
  }
  const components = transformDotFieldToComponents(fieldName);
  let name = components.slice(0, components.length - 1).join('->');
  name += '->>' + components[components.length - 1];
  return name;
};
const validateAggregateFieldName = name => {
  if (typeof name !== 'string' || !name.match(/^[a-zA-Z][a-zA-Z0-9_]*$/)) {
    throw new _node.default.Error(_node.default.Error.INVALID_KEY_NAME, `Invalid field name: ${name}`);
  }
};
const transformAggregateField = fieldName => {
  if (typeof fieldName !== 'string') {
    return fieldName;
  }
  if (fieldName === '$_created_at') {
    return 'createdAt';
  }
  if (fieldName === '$_updated_at') {
    return 'updatedAt';
  }
  if (!fieldName.startsWith('$')) {
    throw new _node.default.Error(_node.default.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}`);
  }
  const name = fieldName.substring(1);
  validateAggregateFieldName(name);
  return name;
};
const validateKeys = object => {
  if (typeof object == 'object') {
    for (const key in object) {
      if (typeof object[key] == 'object') {
        validateKeys(object[key]);
      }
      if (key.includes('$') || key.includes('.')) {
        throw new _node.default.Error(_node.default.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
      }
    }
  }
};

// Returns the list of join tables on a schema
const joinTablesForSchema = schema => {
  const list = [];
  if (schema) {
    Object.keys(schema.fields).forEach(field => {
      if (schema.fields[field].type === 'Relation') {
        list.push(`_Join:${field}:${schema.className}`);
      }
    });
  }
  return list;
};
const buildWhereClause = ({
  schema,
  query,
  index,
  caseInsensitive
}) => {
  const patterns = [];
  let values = [];
  const sorts = [];
  schema = toPostgresSchema(schema);
  for (const fieldName in query) {
    const isArrayField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array';
    const initialPatternsLength = patterns.length;
    const fieldValue = query[fieldName];

    // nothing in the schema, it's gonna blow up
    if (!schema.fields[fieldName]) {
      // as it won't exist
      if (fieldValue && fieldValue.$exists === false) {
        continue;
      }
    }
    const authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
    if (authDataMatch) {
      // TODO: Handle querying by _auth_data_provider, authData is stored in authData field
      continue;
    } else if (caseInsensitive && (fieldName === 'username' || fieldName === 'email')) {
      patterns.push(`LOWER($${index}:name) = LOWER($${index + 1})`);
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (fieldName.indexOf('.') >= 0) {
      let name = transformDotField(fieldName);
      if (fieldValue === null) {
        patterns.push(`$${index}:raw IS NULL`);
        values.push(name);
        index += 1;
        continue;
      } else {
        if (fieldValue.$in) {
          name = transformDotFieldToComponents(fieldName).join('->');
          patterns.push(`($${index}:raw)::jsonb @> $${index + 1}::jsonb`);
          values.push(name, JSON.stringify(fieldValue.$in));
          index += 2;
        } else if (fieldValue.$regex) {
          // Handle later
        } else if (typeof fieldValue !== 'object') {
          patterns.push(`$${index}:raw = $${index + 1}::text`);
          values.push(name, fieldValue);
          index += 2;
        } else if (typeof fieldValue === 'object' && !Object.keys(fieldValue).some(key => key.startsWith('$'))) {
          name = transformDotFieldToComponents(fieldName).join('->');
          patterns.push(`($${index}:raw)::jsonb = $${index + 1}::jsonb`);
          values.push(name, JSON.stringify(fieldValue));
          index += 2;
        }
      }
    } else if (fieldValue === null || fieldValue === undefined) {
      patterns.push(`$${index}:name IS NULL`);
      values.push(fieldName);
      index += 1;
      continue;
    } else if (typeof fieldValue === 'string') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (typeof fieldValue === 'boolean') {
      patterns.push(`$${index}:name = $${index + 1}`);
      // Can't cast boolean to double precision
      if (schema.fields[fieldName] && schema.fields[fieldName].type === 'Number') {
        // Should always return zero results
        const MAX_INT_PLUS_ONE = 9223372036854775808;
        values.push(fieldName, MAX_INT_PLUS_ONE);
      } else {
        values.push(fieldName, fieldValue);
      }
      index += 2;
    } else if (typeof fieldValue === 'number') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (['$or', '$nor', '$and'].includes(fieldName)) {
      const clauses = [];
      const clauseValues = [];
      fieldValue.forEach(subQuery => {
        const clause = buildWhereClause({
          schema,
          query: subQuery,
          index,
          caseInsensitive
        });
        if (clause.pattern.length > 0) {
          clauses.push(clause.pattern);
          clauseValues.push(...clause.values);
          index += clause.values.length;
        }
      });
      const orOrAnd = fieldName === '$and' ? ' AND ' : ' OR ';
      const not = fieldName === '$nor' ? ' NOT ' : '';
      patterns.push(`${not}(${clauses.join(orOrAnd)})`);
      values.push(...clauseValues);
    }
    if (fieldValue.$ne !== undefined) {
      if (isArrayField) {
        fieldValue.$ne = JSON.stringify([fieldValue.$ne]);
        patterns.push(`NOT array_contains($${index}:name, $${index + 1})`);
      } else {
        if (fieldValue.$ne === null) {
          patterns.push(`$${index}:name IS NOT NULL`);
          values.push(fieldName);
          index += 1;
          continue;
        } else {
          // if not null, we need to manually exclude null
          if (fieldValue.$ne.__type === 'GeoPoint') {
            patterns.push(`($${index}:name <> POINT($${index + 1}, $${index + 2}) OR $${index}:name IS NULL)`);
          } else {
            if (fieldName.indexOf('.') >= 0) {
              const castType = toPostgresValueCastType(fieldValue.$ne);
              const constraintFieldName = castType ? `CAST ((${transformDotField(fieldName)}) AS ${castType})` : transformDotField(fieldName);
              patterns.push(`(${constraintFieldName} <> $${index + 1} OR ${constraintFieldName} IS NULL)`);
            } else if (typeof fieldValue.$ne === 'object' && fieldValue.$ne.$relativeTime) {
              throw new _node.default.Error(_node.default.Error.INVALID_JSON, '$relativeTime can only be used with the $lt, $lte, $gt, and $gte operators');
            } else {
              patterns.push(`($${index}:name <> $${index + 1} OR $${index}:name IS NULL)`);
            }
          }
        }
      }
      if (fieldValue.$ne.__type === 'GeoPoint') {
        const point = fieldValue.$ne;
        values.push(fieldName, point.longitude, point.latitude);
        index += 3;
      } else {
        // TODO: support arrays
        values.push(fieldName, fieldValue.$ne);
        index += 2;
      }
    }
    if (fieldValue.$eq !== undefined) {
      if (fieldValue.$eq === null) {
        patterns.push(`$${index}:name IS NULL`);
        values.push(fieldName);
        index += 1;
      } else {
        if (fieldName.indexOf('.') >= 0) {
          const castType = toPostgresValueCastType(fieldValue.$eq);
          const constraintFieldName = castType ? `CAST ((${transformDotField(fieldName)}) AS ${castType})` : transformDotField(fieldName);
          values.push(fieldValue.$eq);
          patterns.push(`${constraintFieldName} = $${index++}`);
        } else if (typeof fieldValue.$eq === 'object' && fieldValue.$eq.$relativeTime) {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, '$relativeTime can only be used with the $lt, $lte, $gt, and $gte operators');
        } else {
          values.push(fieldName, fieldValue.$eq);
          patterns.push(`$${index}:name = $${index + 1}`);
          index += 2;
        }
      }
    }
    const isInOrNin = Array.isArray(fieldValue.$in) || Array.isArray(fieldValue.$nin);
    if (Array.isArray(fieldValue.$in) && isArrayField && schema.fields[fieldName].contents && schema.fields[fieldName].contents.type === 'String') {
      const inPatterns = [];
      let allowNull = false;
      values.push(fieldName);
      fieldValue.$in.forEach((listElem, listIndex) => {
        if (listElem === null) {
          allowNull = true;
        } else {
          values.push(listElem);
          inPatterns.push(`$${index + 1 + listIndex - (allowNull ? 1 : 0)}`);
        }
      });
      if (allowNull) {
        patterns.push(`($${index}:name IS NULL OR $${index}:name && ARRAY[${inPatterns.join()}])`);
      } else {
        patterns.push(`$${index}:name && ARRAY[${inPatterns.join()}]`);
      }
      index = index + 1 + inPatterns.length;
    } else if (isInOrNin) {
      var createConstraint = (baseArray, notIn) => {
        const not = notIn ? ' NOT ' : '';
        if (baseArray.length > 0) {
          if (isArrayField) {
            patterns.push(`${not} array_contains($${index}:name, $${index + 1})`);
            values.push(fieldName, JSON.stringify(baseArray));
            index += 2;
          } else {
            // Handle Nested Dot Notation Above
            if (fieldName.indexOf('.') >= 0) {
              return;
            }
            const fieldType = schema.fields[fieldName]?.type;
            if (fieldType === 'String') {
              const operatorName = notIn ? '$nin' : '$in';
              for (const elem of baseArray) {
                if (elem != null && typeof elem !== 'string') {
                  throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `${operatorName} element type mismatch: expected string for field "${fieldName}"`);
                }
              }
            }
            const inPatterns = [];
            values.push(fieldName);
            baseArray.forEach((listElem, listIndex) => {
              if (listElem != null) {
                values.push(listElem);
                inPatterns.push(`$${index + 1 + listIndex}`);
              }
            });
            patterns.push(`$${index}:name ${not} IN (${inPatterns.join()})`);
            index = index + 1 + inPatterns.length;
          }
        } else if (!notIn) {
          values.push(fieldName);
          patterns.push(`$${index}:name IS NULL`);
          index = index + 1;
        } else {
          // Handle empty array
          if (notIn) {
            patterns.push('1 = 1'); // Return all values
          } else {
            patterns.push('1 = 2'); // Return no values
          }
        }
      };
      if (fieldValue.$in) {
        createConstraint(_lodash.default.flatMap(fieldValue.$in, elt => elt), false);
      }
      if (fieldValue.$nin) {
        createConstraint(_lodash.default.flatMap(fieldValue.$nin, elt => elt), true);
      }
    } else if (typeof fieldValue.$in !== 'undefined') {
      throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $in value');
    } else if (typeof fieldValue.$nin !== 'undefined') {
      throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $nin value');
    }
    if (Array.isArray(fieldValue.$all) && isArrayField) {
      if (isAnyValueRegexStartsWith(fieldValue.$all)) {
        if (!isAllValuesRegexOrNone(fieldValue.$all)) {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'All $all values must be of regex type or none: ' + fieldValue.$all);
        }
        for (let i = 0; i < fieldValue.$all.length; i += 1) {
          const value = processRegexPattern(fieldValue.$all[i].$regex);
          fieldValue.$all[i] = value.substring(1) + '%';
        }
        patterns.push(`array_contains_all_regex($${index}:name, $${index + 1}::jsonb)`);
      } else {
        patterns.push(`array_contains_all($${index}:name, $${index + 1}::jsonb)`);
      }
      values.push(fieldName, JSON.stringify(fieldValue.$all));
      index += 2;
    } else if (Array.isArray(fieldValue.$all)) {
      if (fieldValue.$all.length === 1) {
        patterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.$all[0].objectId);
        index += 2;
      }
    }
    if (typeof fieldValue.$exists !== 'undefined') {
      if (typeof fieldValue.$exists === 'object' && fieldValue.$exists.$relativeTime) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, '$relativeTime can only be used with the $lt, $lte, $gt, and $gte operators');
      } else if (fieldValue.$exists) {
        patterns.push(`$${index}:name IS NOT NULL`);
      } else {
        patterns.push(`$${index}:name IS NULL`);
      }
      values.push(fieldName);
      index += 1;
    }
    if (fieldValue.$containedBy) {
      const arr = fieldValue.$containedBy;
      if (!Array.isArray(arr)) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $containedBy: should be an array`);
      }
      patterns.push(`$${index}:name <@ $${index + 1}::jsonb`);
      values.push(fieldName, JSON.stringify(arr));
      index += 2;
    }
    if (fieldValue.$text) {
      const search = fieldValue.$text.$search;
      let language = 'english';
      if (typeof search !== 'object') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $search, should be object`);
      }
      if (!search.$term || typeof search.$term !== 'string') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $term, should be string`);
      }
      if (search.$language && typeof search.$language !== 'string') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $language, should be string`);
      } else if (search.$language) {
        language = search.$language;
      }
      if (search.$caseSensitive && typeof search.$caseSensitive !== 'boolean') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $caseSensitive, should be boolean`);
      } else if (search.$caseSensitive) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $caseSensitive not supported, please use $regex or create a separate lower case column.`);
      }
      if (search.$diacriticSensitive && typeof search.$diacriticSensitive !== 'boolean') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $diacriticSensitive, should be boolean`);
      } else if (search.$diacriticSensitive === false) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $diacriticSensitive - false not supported, install Postgres Unaccent Extension`);
      }
      patterns.push(`to_tsvector($${index}, $${index + 1}:name) @@ to_tsquery($${index + 2}, $${index + 3})`);
      values.push(language, fieldName, language, search.$term);
      index += 4;
    }
    if (fieldValue.$nearSphere) {
      const point = fieldValue.$nearSphere;
      const distance = fieldValue.$maxDistance;
      const distanceInKM = distance * 6371 * 1000;
      patterns.push(`ST_DistanceSphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) <= $${index + 3}`);
      sorts.push(`ST_DistanceSphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) ASC`);
      values.push(fieldName, point.longitude, point.latitude, distanceInKM);
      index += 4;
    }
    if (fieldValue.$within && fieldValue.$within.$box) {
      const box = fieldValue.$within.$box;
      const left = box[0].longitude;
      const bottom = box[0].latitude;
      const right = box[1].longitude;
      const top = box[1].latitude;
      patterns.push(`$${index}:name::point <@ $${index + 1}::box`);
      values.push(fieldName, `((${left}, ${bottom}), (${right}, ${top}))`);
      index += 2;
    }
    if (fieldValue.$geoWithin && fieldValue.$geoWithin.$centerSphere) {
      const centerSphere = fieldValue.$geoWithin.$centerSphere;
      if (!Array.isArray(centerSphere) || centerSphere.length < 2) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere should be an array of Parse.GeoPoint and distance');
      }
      // Get point, convert to geo point if necessary and validate
      let point = centerSphere[0];
      if (Array.isArray(point) && point.length === 2) {
        point = new _node.default.GeoPoint(point[1], point[0]);
      } else if (!GeoPointCoder.isValidJSON(point)) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere geo point invalid');
      }
      _node.default.GeoPoint._validate(point.latitude, point.longitude);
      // Get distance and validate
      const distance = centerSphere[1];
      if (isNaN(distance) || distance < 0) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere distance invalid');
      }
      const distanceInKM = distance * 6371 * 1000;
      patterns.push(`ST_DistanceSphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) <= $${index + 3}`);
      values.push(fieldName, point.longitude, point.latitude, distanceInKM);
      index += 4;
    }
    if (fieldValue.$geoWithin && fieldValue.$geoWithin.$polygon) {
      const polygon = fieldValue.$geoWithin.$polygon;
      let points;
      if (typeof polygon === 'object' && polygon.__type === 'Polygon') {
        if (!polygon.coordinates || polygon.coordinates.length < 3) {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; Polygon.coordinates should contain at least 3 lon/lat pairs');
        }
        points = polygon.coordinates;
      } else if (Array.isArray(polygon)) {
        if (polygon.length < 3) {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should contain at least 3 GeoPoints');
        }
        points = polygon;
      } else {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, "bad $geoWithin value; $polygon should be Polygon object or Array of Parse.GeoPoint's");
      }
      points = points.map(point => {
        if (Array.isArray(point) && point.length === 2) {
          _node.default.GeoPoint._validate(point[1], point[0]);
          return `(${point[0]}, ${point[1]})`;
        }
        if (typeof point !== 'object' || point.__type !== 'GeoPoint') {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value');
        } else {
          _node.default.GeoPoint._validate(point.latitude, point.longitude);
        }
        return `(${point.longitude}, ${point.latitude})`;
      }).join(', ');
      patterns.push(`$${index}:name::point <@ $${index + 1}::polygon`);
      values.push(fieldName, `(${points})`);
      index += 2;
    }
    if (fieldValue.$geoIntersects && fieldValue.$geoIntersects.$point) {
      const point = fieldValue.$geoIntersects.$point;
      if (typeof point !== 'object' || point.__type !== 'GeoPoint') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoIntersect value; $point should be GeoPoint');
      } else {
        _node.default.GeoPoint._validate(point.latitude, point.longitude);
      }
      patterns.push(`$${index}:name::polygon @> $${index + 1}::point`);
      values.push(fieldName, `(${point.longitude}, ${point.latitude})`);
      index += 2;
    }
    if (fieldValue.$regex) {
      let regex = fieldValue.$regex;
      let operator = '~';
      const opts = fieldValue.$options;
      if (opts) {
        if (opts.indexOf('i') >= 0) {
          operator = '~*';
        }
        if (opts.indexOf('x') >= 0) {
          regex = removeWhiteSpace(regex);
        }
      }
      regex = processRegexPattern(regex);
      if (fieldName.indexOf('.') >= 0) {
        const name = transformDotField(fieldName);
        patterns.push(`$${index}:raw ${operator} '$${index + 1}:raw'`);
        values.push(name, regex);
      } else {
        patterns.push(`$${index}:name ${operator} '$${index + 1}:raw'`);
        values.push(fieldName, regex);
      }
      index += 2;
    }
    if (fieldValue.__type === 'Pointer') {
      if (isArrayField) {
        patterns.push(`array_contains($${index}:name, $${index + 1})`);
        values.push(fieldName, JSON.stringify([fieldValue]));
        index += 2;
      } else {
        patterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.objectId);
        index += 2;
      }
    }
    if (fieldValue.__type === 'Date') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue.iso);
      index += 2;
    }
    if (fieldValue.__type === 'GeoPoint') {
      patterns.push(`$${index}:name ~= POINT($${index + 1}, $${index + 2})`);
      values.push(fieldName, fieldValue.longitude, fieldValue.latitude);
      index += 3;
    }
    if (fieldValue.__type === 'Polygon') {
      const value = convertPolygonToSQL(fieldValue.coordinates);
      patterns.push(`$${index}:name ~= $${index + 1}::polygon`);
      values.push(fieldName, value);
      index += 2;
    }
    Object.keys(ParseToPosgresComparator).forEach(cmp => {
      if (fieldValue[cmp] || fieldValue[cmp] === 0) {
        const pgComparator = ParseToPosgresComparator[cmp];
        let constraintFieldName;
        let postgresValue = toPostgresValue(fieldValue[cmp]);
        if (fieldName.indexOf('.') >= 0) {
          const castType = toPostgresValueCastType(fieldValue[cmp]);
          constraintFieldName = castType ? `CAST ((${transformDotField(fieldName)}) AS ${castType})` : transformDotField(fieldName);
        } else {
          if (typeof postgresValue === 'object' && postgresValue.$relativeTime) {
            if (schema.fields[fieldName].type !== 'Date') {
              throw new _node.default.Error(_node.default.Error.INVALID_JSON, '$relativeTime can only be used with Date field');
            }
            const parserResult = Utils.relativeTimeToDate(postgresValue.$relativeTime);
            if (parserResult.status === 'success') {
              postgresValue = toPostgresValue(parserResult.result);
            } else {
              // eslint-disable-next-line no-console
              console.error('Error while parsing relative date', parserResult);
              throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $relativeTime (${postgresValue.$relativeTime}) value. ${parserResult.info}`);
            }
          }
          constraintFieldName = `$${index++}:name`;
          values.push(fieldName);
        }
        values.push(postgresValue);
        patterns.push(`${constraintFieldName} ${pgComparator} $${index++}`);
      }
    });
    if (initialPatternsLength === patterns.length) {
      throw new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, `Postgres doesn't support this query type yet ${JSON.stringify(fieldValue)}`);
    }
  }
  values = values.map(transformValue);
  return {
    pattern: patterns.join(' AND '),
    values,
    sorts
  };
};
class PostgresStorageAdapter {
  // Private

  constructor({
    uri,
    collectionPrefix = '',
    databaseOptions = {}
  }) {
    const options = {
      ...databaseOptions
    };
    this._collectionPrefix = collectionPrefix;
    this.enableSchemaHooks = !!databaseOptions.enableSchemaHooks;
    this.disableIndexFieldValidation = !!databaseOptions.disableIndexFieldValidation;
    this.schemaCacheTtl = databaseOptions.schemaCacheTtl;
    for (const key of ['enableSchemaHooks', 'schemaCacheTtl', 'disableIndexFieldValidation']) {
      delete options[key];
    }
    const {
      client,
      pgp
    } = (0, _PostgresClient.createClient)(uri, options);
    this._client = client;
    this._onchange = () => {};
    this._pgp = pgp;
    this._uuid = (0, _crypto.randomUUID)();
    this.canSortOnJoinTables = false;
  }
  watch(callback) {
    this._onchange = callback;
  }

  //Note that analyze=true will run the query, executing INSERTS, DELETES, etc.
  createExplainableQuery(query, analyze = false) {
    if (analyze) {
      return 'EXPLAIN (ANALYZE, FORMAT JSON) ' + query;
    } else {
      return 'EXPLAIN (FORMAT JSON) ' + query;
    }
  }
  handleShutdown() {
    if (this._stream) {
      this._stream.done();
      delete this._stream;
    }
    if (!this._client) {
      return;
    }
    this._client.$pool.end();
  }
  async _listenToSchema() {
    if (!this._stream && this.enableSchemaHooks) {
      this._stream = await this._client.connect({
        direct: true
      });
      this._stream.client.on('notification', data => {
        const payload = JSON.parse(data.payload);
        if (payload.senderId !== this._uuid) {
          this._onchange();
        }
      });
      await this._stream.none('LISTEN $1~', 'schema.change');
    }
  }
  _notifySchemaChange() {
    if (this._stream) {
      this._stream.none('NOTIFY $1~, $2', ['schema.change', {
        senderId: this._uuid
      }]).catch(error => {
        // eslint-disable-next-line no-console
        console.log('Failed to Notify:', error); // unlikely to ever happen
      });
    }
  }
  async _ensureSchemaCollectionExists(conn) {
    conn = conn || this._client;
    await conn.none('CREATE TABLE IF NOT EXISTS "_SCHEMA" ( "className" varChar(120), "schema" jsonb, "isParseClass" bool, PRIMARY KEY ("className") )').catch(error => {
      throw error;
    });
  }
  async classExists(name) {
    return this._client.one('SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)', [name], a => a.exists);
  }
  async setClassLevelPermissions(className, CLPs) {
    await this._client.task('set-class-level-permissions', async t => {
      const values = [className, 'schema', 'classLevelPermissions', JSON.stringify(CLPs)];
      await t.none(`UPDATE "_SCHEMA" SET $2:name = json_object_set_key($2:name, $3::text, $4::jsonb) WHERE "className" = $1`, values);
    });
    this._notifySchemaChange();
  }
  async setIndexesWithSchemaFormat(className, submittedIndexes, existingIndexes = {}, fields, conn) {
    conn = conn || this._client;
    const self = this;
    if (submittedIndexes === undefined) {
      return Promise.resolve();
    }
    if (Object.keys(existingIndexes).length === 0) {
      existingIndexes = {
        _id_: {
          _id: 1
        }
      };
    }
    const deletedIndexes = [];
    const insertedIndexes = [];
    Object.keys(submittedIndexes).forEach(name => {
      const field = submittedIndexes[name];
      if (existingIndexes[name] && field.__op !== 'Delete') {
        throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Index ${name} exists, cannot update.`);
      }
      if (!existingIndexes[name] && field.__op === 'Delete') {
        throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Index ${name} does not exist, cannot delete.`);
      }
      if (field.__op === 'Delete') {
        deletedIndexes.push(name);
        delete existingIndexes[name];
      } else {
        Object.keys(field).forEach(key => {
          if (!this.disableIndexFieldValidation && !Object.prototype.hasOwnProperty.call(fields, key)) {
            throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Field ${key} does not exist, cannot add index.`);
          }
        });
        existingIndexes[name] = field;
        insertedIndexes.push({
          key: field,
          name
        });
      }
    });
    await conn.tx('set-indexes-with-schema-format', async t => {
      try {
        if (insertedIndexes.length > 0) {
          await self.createIndexes(className, insertedIndexes, t);
        }
      } catch (e) {
        // pg-promise use Batch error see https://github.com/vitaly-t/spex/blob/e572030f261be1a8e9341fc6f637e36ad07f5231/src/errors/batch.js#L59
        const columnDoesNotExistError = e.getErrors && e.getErrors()[0] && e.getErrors()[0].code === '42703';
        // Specific case when the column does not exist
        if (columnDoesNotExistError) {
          // If the disableIndexFieldValidation is true, we should ignore the error
          if (!this.disableIndexFieldValidation) {
            throw e;
          }
        } else {
          throw e;
        }
      }
      if (deletedIndexes.length > 0) {
        await self.dropIndexes(className, deletedIndexes, t);
      }
      await t.none('UPDATE "_SCHEMA" SET $2:name = json_object_set_key($2:name, $3::text, $4::jsonb) WHERE "className" = $1', [className, 'schema', 'indexes', JSON.stringify(existingIndexes)]);
    });
    this._notifySchemaChange();
  }
  async createClass(className, schema, conn) {
    conn = conn || this._client;
    const parseSchema = await conn.tx('create-class', async t => {
      await this.createTable(className, schema, t);
      await t.none('INSERT INTO "_SCHEMA" ("className", "schema", "isParseClass") VALUES ($<className>, $<schema>, true)', {
        className,
        schema
      });
      await this.setIndexesWithSchemaFormat(className, schema.indexes, {}, schema.fields, t);
      return toParseSchema(schema);
    }).catch(err => {
      if (err.code === PostgresUniqueIndexViolationError && err.detail.includes(className)) {
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, `Class ${className} already exists.`);
      }
      throw err;
    });
    this._notifySchemaChange();
    return parseSchema;
  }

  // Just create a table, do not insert in schema
  async createTable(className, schema, conn) {
    conn = conn || this._client;
    debug('createTable');
    const valuesArray = [];
    const patternsArray = [];
    const fields = Object.assign({}, schema.fields);
    if (className === '_User') {
      fields._email_verify_token_expires_at = {
        type: 'Date'
      };
      fields._email_verify_token = {
        type: 'String'
      };
      fields._account_lockout_expires_at = {
        type: 'Date'
      };
      fields._failed_login_count = {
        type: 'Number'
      };
      fields._perishable_token = {
        type: 'String'
      };
      fields._perishable_token_expires_at = {
        type: 'Date'
      };
      fields._password_changed_at = {
        type: 'Date'
      };
      fields._password_history = {
        type: 'Array'
      };
    }
    let index = 2;
    const relations = [];
    Object.keys(fields).forEach(fieldName => {
      const parseType = fields[fieldName];
      // Skip when it's a relation
      // We'll create the tables later
      if (parseType.type === 'Relation') {
        relations.push(fieldName);
        return;
      }
      if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
        parseType.contents = {
          type: 'String'
        };
      }
      valuesArray.push(fieldName);
      valuesArray.push(parseTypeToPostgresType(parseType));
      patternsArray.push(`$${index}:name $${index + 1}:raw`);
      if (fieldName === 'objectId') {
        patternsArray.push(`PRIMARY KEY ($${index}:name)`);
      }
      index = index + 2;
    });
    const qs = `CREATE TABLE IF NOT EXISTS $1:name (${patternsArray.join()})`;
    const values = [className, ...valuesArray];
    return conn.task('create-table', async t => {
      try {
        await t.none(qs, values);
      } catch (error) {
        if (error.code !== PostgresDuplicateRelationError) {
          throw error;
        }
        // ELSE: Table already exists, must have been created by a different request. Ignore the error.
      }
      await t.tx('create-table-tx', tx => {
        return tx.batch(relations.map(fieldName => {
          return tx.none('CREATE TABLE IF NOT EXISTS $<joinTable:name> ("relatedId" varChar(120), "owningId" varChar(120), PRIMARY KEY("relatedId", "owningId") )', {
            joinTable: `_Join:${fieldName}:${className}`
          });
        }));
      });
    });
  }
  async schemaUpgrade(className, schema, conn) {
    debug('schemaUpgrade');
    conn = conn || this._client;
    const self = this;
    await conn.task('schema-upgrade', async t => {
      const columns = await t.map('SELECT column_name FROM information_schema.columns WHERE table_name = $<className>', {
        className
      }, a => a.column_name);
      const newColumns = Object.keys(schema.fields).filter(item => columns.indexOf(item) === -1).map(fieldName => self.addFieldIfNotExists(className, fieldName, schema.fields[fieldName]));
      await t.batch(newColumns);
    });
  }
  async addFieldIfNotExists(className, fieldName, type) {
    // TODO: Must be revised for invalid logic...
    debug('addFieldIfNotExists');
    const self = this;
    await this._client.tx('add-field-if-not-exists', async t => {
      if (type.type !== 'Relation') {
        try {
          await t.none('ALTER TABLE $<className:name> ADD COLUMN IF NOT EXISTS $<fieldName:name> $<postgresType:raw>', {
            className,
            fieldName,
            postgresType: parseTypeToPostgresType(type)
          });
        } catch (error) {
          if (error.code === PostgresRelationDoesNotExistError) {
            return self.createClass(className, {
              fields: {
                [fieldName]: type
              }
            }, t);
          }
          if (error.code !== PostgresDuplicateColumnError) {
            throw error;
          }
          // Column already exists, created by other request. Carry on to see if it's the right type.
        }
      } else {
        await t.none('CREATE TABLE IF NOT EXISTS $<joinTable:name> ("relatedId" varChar(120), "owningId" varChar(120), PRIMARY KEY("relatedId", "owningId") )', {
          joinTable: `_Join:${fieldName}:${className}`
        });
      }
      const result = await t.any('SELECT "schema" FROM "_SCHEMA" WHERE "className" = $<className> and ("schema"::json->\'fields\'->$<fieldName>) is not null', {
        className,
        fieldName
      });
      if (result[0]) {
        throw 'Attempted to add a field that already exists';
      } else {
        const path = `{fields,${fieldName}}`;
        await t.none('UPDATE "_SCHEMA" SET "schema"=jsonb_set("schema", $<path>, $<type>)  WHERE "className"=$<className>', {
          path,
          type,
          className
        });
      }
    });
    this._notifySchemaChange();
  }
  async updateFieldOptions(className, fieldName, type) {
    await this._client.tx('update-schema-field-options', async t => {
      const path = `{fields,${fieldName}}`;
      await t.none('UPDATE "_SCHEMA" SET "schema"=jsonb_set("schema", $<path>, $<type>)  WHERE "className"=$<className>', {
        path,
        type,
        className
      });
    });
  }

  // Drops a collection. Resolves with true if it was a Parse Schema (eg. _User, Custom, etc.)
  // and resolves with false if it wasn't (eg. a join table). Rejects if deletion was impossible.
  async deleteClass(className) {
    const operations = [{
      query: `DROP TABLE IF EXISTS $1:name`,
      values: [className]
    }, {
      query: `DELETE FROM "_SCHEMA" WHERE "className" = $1`,
      values: [className]
    }];
    const response = await this._client.tx(t => t.none(this._pgp.helpers.concat(operations))).then(() => className.indexOf('_Join:') != 0); // resolves with false when _Join table

    this._notifySchemaChange();
    return response;
  }

  // Delete all data known to this adapter. Used for testing.
  async deleteAllClasses() {
    const now = new Date().getTime();
    const helpers = this._pgp.helpers;
    debug('deleteAllClasses');
    if (this._client?.$pool.ended) {
      return;
    }
    await this._client.task('delete-all-classes', async t => {
      try {
        const results = await t.any('SELECT * FROM "_SCHEMA"');
        const joins = results.reduce((list, schema) => {
          return list.concat(joinTablesForSchema(schema.schema));
        }, []);
        const classes = ['_SCHEMA', '_PushStatus', '_JobStatus', '_JobSchedule', '_Hooks', '_GlobalConfig', '_GraphQLConfig', '_Audience', '_Idempotency', ...results.map(result => result.className), ...joins];
        const queries = classes.map(className => ({
          query: 'DROP TABLE IF EXISTS $<className:name>',
          values: {
            className
          }
        }));
        await t.tx(tx => tx.none(helpers.concat(queries)));
      } catch (error) {
        if (error.code !== PostgresRelationDoesNotExistError) {
          throw error;
        }
        // No _SCHEMA collection. Don't delete anything.
      }
    }).then(() => {
      debug(`deleteAllClasses done in ${new Date().getTime() - now}`);
    });
  }

  // Remove the column and all the data. For Relations, the _Join collection is handled
  // specially, this function does not delete _Join columns. It should, however, indicate
  // that the relation fields does not exist anymore. In mongo, this means removing it from
  // the _SCHEMA collection.  There should be no actual data in the collection under the same name
  // as the relation column, so it's fine to attempt to delete it. If the fields listed to be
  // deleted do not exist, this function should return successfully anyways. Checking for
  // attempts to delete non-existent fields is the responsibility of Parse Server.

  // This function is not obligated to delete fields atomically. It is given the field
  // names in a list so that databases that are capable of deleting fields atomically
  // may do so.

  // Returns a Promise.
  async deleteFields(className, schema, fieldNames) {
    debug('deleteFields');
    fieldNames = fieldNames.reduce((list, fieldName) => {
      const field = schema.fields[fieldName];
      if (field.type !== 'Relation') {
        list.push(fieldName);
      }
      delete schema.fields[fieldName];
      return list;
    }, []);
    const values = [className, ...fieldNames];
    const columns = fieldNames.map((name, idx) => {
      return `$${idx + 2}:name`;
    }).join(', DROP COLUMN');
    await this._client.tx('delete-fields', async t => {
      await t.none('UPDATE "_SCHEMA" SET "schema" = $<schema> WHERE "className" = $<className>', {
        schema,
        className
      });
      if (values.length > 1) {
        await t.none(`ALTER TABLE $1:name DROP COLUMN IF EXISTS ${columns}`, values);
      }
    });
    this._notifySchemaChange();
  }

  // Return a promise for all schemas known to this adapter, in Parse format. In case the
  // schemas cannot be retrieved, returns a promise that rejects. Requirements for the
  // rejection reason are TBD.
  async getAllClasses() {
    return this._client.task('get-all-classes', async t => {
      return await t.map('SELECT * FROM "_SCHEMA"', null, row => toParseSchema({
        className: row.className,
        ...row.schema
      }));
    });
  }

  // Return a promise for the schema with the given name, in Parse format. If
  // this adapter doesn't know about the schema, return a promise that rejects with
  // undefined as the reason.
  async getClass(className) {
    debug('getClass');
    return this._client.any('SELECT * FROM "_SCHEMA" WHERE "className" = $<className>', {
      className
    }).then(result => {
      if (result.length !== 1) {
        throw undefined;
      }
      return result[0].schema;
    }).then(toParseSchema);
  }

  // TODO: remove the mongo format dependency in the return value
  async createObject(className, schema, object, transactionalSession) {
    debug('createObject');
    let columnsArray = [];
    const valuesArray = [];
    schema = toPostgresSchema(schema);
    const geoPoints = {};
    object = handleDotFields(object);
    validateKeys(object);
    Object.keys(object).forEach(fieldName => {
      if (object[fieldName] === null) {
        return;
      }
      var authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
      const authDataAlreadyExists = !!object.authData;
      if (authDataMatch) {
        var provider = authDataMatch[1];
        object['authData'] = object['authData'] || {};
        object['authData'][provider] = object[fieldName];
        delete object[fieldName];
        fieldName = 'authData';
        // Avoid adding authData multiple times to the query
        if (authDataAlreadyExists) {
          return;
        }
      }
      columnsArray.push(fieldName);
      if (!schema.fields[fieldName] && className === '_User') {
        if (fieldName === '_email_verify_token' || fieldName === '_failed_login_count' || fieldName === '_perishable_token' || fieldName === '_password_history') {
          valuesArray.push(object[fieldName]);
        }
        if (fieldName === '_email_verify_token_expires_at') {
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
        }
        if (fieldName === '_account_lockout_expires_at' || fieldName === '_perishable_token_expires_at' || fieldName === '_password_changed_at') {
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
        }
        return;
      }
      switch (schema.fields[fieldName].type) {
        case 'Date':
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
          break;
        case 'Pointer':
          valuesArray.push(object[fieldName].objectId);
          break;
        case 'Array':
          if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
            valuesArray.push(object[fieldName]);
          } else {
            valuesArray.push(JSON.stringify(object[fieldName]));
          }
          break;
        case 'Object':
        case 'Bytes':
        case 'String':
        case 'Number':
        case 'Boolean':
          valuesArray.push(object[fieldName]);
          break;
        case 'File':
          valuesArray.push(object[fieldName].name);
          break;
        case 'Polygon':
          {
            const value = convertPolygonToSQL(object[fieldName].coordinates);
            valuesArray.push(value);
            break;
          }
        case 'GeoPoint':
          // pop the point and process later
          geoPoints[fieldName] = object[fieldName];
          columnsArray.pop();
          break;
        default:
          throw `Type ${schema.fields[fieldName].type} not supported yet`;
      }
    });
    columnsArray = columnsArray.concat(Object.keys(geoPoints));
    const initialValues = valuesArray.map((val, index) => {
      let termination = '';
      const fieldName = columnsArray[index];
      if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
        termination = '::text[]';
      } else if (schema.fields[fieldName] && schema.fields[fieldName].type === 'Array') {
        termination = '::jsonb';
      }
      return `$${index + 2 + columnsArray.length}${termination}`;
    });
    const geoPointsInjects = Object.keys(geoPoints).map(key => {
      const value = geoPoints[key];
      valuesArray.push(value.longitude, value.latitude);
      const l = valuesArray.length + columnsArray.length;
      return `POINT($${l}, $${l + 1})`;
    });
    const columnsPattern = columnsArray.map((col, index) => `$${index + 2}:name`).join();
    const valuesPattern = initialValues.concat(geoPointsInjects).join();
    const qs = `INSERT INTO $1:name (${columnsPattern}) VALUES (${valuesPattern})`;
    const values = [className, ...columnsArray, ...valuesArray];
    const promise = (transactionalSession ? transactionalSession.t : this._client).none(qs, values).then(() => ({
      ops: [object]
    })).catch(error => {
      if (error.code === PostgresUniqueIndexViolationError) {
        const err = new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;
        if (error.constraint) {
          // Check for authData unique index violations first
          const authDataMatch = error.constraint.match(/_User_unique_authData_([a-zA-Z0-9_]+)_id/);
          if (authDataMatch) {
            err.userInfo = {
              duplicated_field: `_auth_data_${authDataMatch[1]}`
            };
          } else {
            const matches = error.constraint.match(/unique_([a-zA-Z]+)/);
            if (matches && Array.isArray(matches)) {
              err.userInfo = {
                duplicated_field: matches[1]
              };
            }
          }
        }
        error = err;
      }
      throw error;
    });
    if (transactionalSession) {
      transactionalSession.batch.push(promise);
    }
    return promise;
  }

  // Remove all objects that match the given Parse Query.
  // If no objects match, reject with OBJECT_NOT_FOUND. If objects are found and deleted, resolve with undefined.
  // If there is some other error, reject with INTERNAL_SERVER_ERROR.
  async deleteObjectsByQuery(className, schema, query, transactionalSession) {
    debug('deleteObjectsByQuery');
    const values = [className];
    const index = 2;
    const where = buildWhereClause({
      schema,
      index,
      query,
      caseInsensitive: false
    });
    values.push(...where.values);
    if (Object.keys(query).length === 0) {
      where.pattern = 'TRUE';
    }
    const qs = `WITH deleted AS (DELETE FROM $1:name WHERE ${where.pattern} RETURNING *) SELECT count(*) FROM deleted`;
    const promise = (transactionalSession ? transactionalSession.t : this._client).one(qs, values, a => +a.count).then(count => {
      if (count === 0) {
        throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'Object not found.');
      } else {
        return count;
      }
    }).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }
      // ELSE: Don't delete anything if doesn't exist
    });
    if (transactionalSession) {
      transactionalSession.batch.push(promise);
    }
    return promise;
  }
  // Return value not currently well specified.
  async findOneAndUpdate(className, schema, query, update, transactionalSession) {
    debug('findOneAndUpdate');
    return this.updateObjectsByQuery(className, schema, query, update, transactionalSession).then(val => val[0]);
  }

  // Apply the update to all objects that match the given Parse Query.
  async updateObjectsByQuery(className, schema, query, update, transactionalSession) {
    debug('updateObjectsByQuery');
    const updatePatterns = [];
    const values = [className];
    let index = 2;
    schema = toPostgresSchema(schema);
    const originalUpdate = {
      ...update
    };

    // Set flag for dot notation fields
    const dotNotationOptions = {};
    Object.keys(update).forEach(fieldName => {
      if (fieldName.indexOf('.') > -1) {
        const components = fieldName.split('.');
        const first = components.shift();
        dotNotationOptions[first] = true;
      } else {
        dotNotationOptions[fieldName] = false;
      }
    });
    update = handleDotFields(update);
    // Resolve authData first,
    // So we don't end up with multiple key updates
    for (const fieldName in update) {
      const authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
      if (authDataMatch) {
        var provider = authDataMatch[1];
        const value = update[fieldName];
        delete update[fieldName];
        update['authData'] = update['authData'] || {};
        update['authData'][provider] = value;
      }
    }
    for (const fieldName in update) {
      const fieldValue = update[fieldName];
      // Drop any undefined values.
      if (typeof fieldValue === 'undefined') {
        delete update[fieldName];
      } else if (fieldValue === null) {
        updatePatterns.push(`$${index}:name = NULL`);
        values.push(fieldName);
        index += 1;
      } else if (fieldName == 'authData') {
        // This recursively sets the json_object
        // Only 1 level deep
        const generate = (jsonb, key, value) => {
          return `json_object_set_key(COALESCE(${jsonb}, '{}'::jsonb), ${key}, ${value})::jsonb`;
        };
        const generateRemove = (jsonb, key) => {
          return `(COALESCE(${jsonb}, '{}'::jsonb) - ${key})`;
        };
        const lastKey = `$${index}:name`;
        const fieldNameIndex = index;
        index += 1;
        values.push(fieldName);
        const update = Object.keys(fieldValue).reduce((lastKey, key) => {
          let value = fieldValue[key];
          if (value && value.__op === 'Delete') {
            value = null;
          }
          if (value === null) {
            const str = generateRemove(lastKey, `$${index}::text`);
            values.push(key);
            index += 1;
            return str;
          }
          const str = generate(lastKey, `$${index}::text`, `$${index + 1}::jsonb`);
          index += 2;
          if (value) {
            value = JSON.stringify(value);
          }
          values.push(key, value);
          return str;
        }, lastKey);
        updatePatterns.push(`$${fieldNameIndex}:name = ${update}`);
      } else if (fieldValue.__op === 'Increment') {
        updatePatterns.push(`$${index}:name = COALESCE($${index}:name, 0) + $${index + 1}`);
        values.push(fieldName, fieldValue.amount);
        index += 2;
      } else if (fieldValue.__op === 'Add') {
        updatePatterns.push(`$${index}:name = array_add(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldValue.__op === 'Delete') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, null);
        index += 2;
      } else if (fieldValue.__op === 'Remove') {
        updatePatterns.push(`$${index}:name = array_remove(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldValue.__op === 'AddUnique') {
        updatePatterns.push(`$${index}:name = array_add_unique(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldName === 'updatedAt') {
        //TODO: stop special casing this. It should check for __type === 'Date' and use .iso
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'string') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'boolean') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (fieldValue.__type === 'Pointer') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.objectId);
        index += 2;
      } else if (fieldValue.__type === 'Date') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue));
        index += 2;
      } else if (Utils.isDate(fieldValue)) {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (fieldValue.__type === 'File') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue));
        index += 2;
      } else if (fieldValue.__type === 'GeoPoint') {
        updatePatterns.push(`$${index}:name = POINT($${index + 1}, $${index + 2})`);
        values.push(fieldName, fieldValue.longitude, fieldValue.latitude);
        index += 3;
      } else if (fieldValue.__type === 'Polygon') {
        const value = convertPolygonToSQL(fieldValue.coordinates);
        updatePatterns.push(`$${index}:name = $${index + 1}::polygon`);
        values.push(fieldName, value);
        index += 2;
      } else if (fieldValue.__type === 'Relation') {
        // noop
      } else if (typeof fieldValue === 'number') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'object' && schema.fields[fieldName] && schema.fields[fieldName].type === 'Object') {
        // Gather keys to increment
        const keysToIncrement = Object.keys(originalUpdate).filter(k => {
          // choose top level fields that have a delete operation set
          // Note that Object.keys is iterating over the **original** update object
          // and that some of the keys of the original update could be null or undefined:
          // (See the above check `if (fieldValue === null || typeof fieldValue == "undefined")`)
          const value = originalUpdate[k];
          return value && value.__op === 'Increment' && k.split('.').length === 2 && k.split('.')[0] === fieldName;
        }).map(k => k.split('.')[1]);
        let incrementPatterns = '';
        const incrementValues = [];
        if (keysToIncrement.length > 0) {
          incrementPatterns = ' || ' + keysToIncrement.map(c => {
            const amount = fieldValue[c].amount;
            if (typeof amount !== 'number') {
              throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'incrementing must provide a number');
            }
            incrementValues.push(amount);
            const amountIndex = index + incrementValues.length;
            const jsonSafeName = escapeSqlString(escapeJsonString(c));
            const sqlSafeName = escapeSqlString(c);
            return `CONCAT('{"${jsonSafeName}":', COALESCE($${index}:name->>'${sqlSafeName}','0')::int + $${amountIndex}, '}')::jsonb`;
          }).join(' || ');
          // Strip the keys
          keysToIncrement.forEach(key => {
            delete fieldValue[key];
          });
        }
        const keysToDelete = Object.keys(originalUpdate).filter(k => {
          // choose top level fields that have a delete operation set.
          const value = originalUpdate[k];
          return value && value.__op === 'Delete' && k.split('.').length === 2 && k.split('.')[0] === fieldName;
        }).map(k => k.split('.')[1]);
        const deletePatterns = keysToDelete.reduce((p, c, i) => {
          return p + ` - '$${index + 1 + incrementValues.length + i}:value'`;
        }, '');
        // Override Object
        let updateObject = "'{}'::jsonb";
        if (dotNotationOptions[fieldName]) {
          // Merge Object
          updateObject = `COALESCE($${index}:name, '{}'::jsonb)`;
        }
        updatePatterns.push(`$${index}:name = (${updateObject} ${deletePatterns} ${incrementPatterns} || $${index + 1 + incrementValues.length + keysToDelete.length}::jsonb )`);
        values.push(fieldName, ...incrementValues, ...keysToDelete, JSON.stringify(fieldValue));
        index += 2 + incrementValues.length + keysToDelete.length;
      } else if (Array.isArray(fieldValue) && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array') {
        const expectedType = parseTypeToPostgresType(schema.fields[fieldName]);
        if (expectedType === 'text[]') {
          updatePatterns.push(`$${index}:name = $${index + 1}::text[]`);
          values.push(fieldName, fieldValue);
          index += 2;
        } else {
          updatePatterns.push(`$${index}:name = $${index + 1}::jsonb`);
          values.push(fieldName, JSON.stringify(fieldValue));
          index += 2;
        }
      } else {
        debug('Not supported update', {
          fieldName,
          fieldValue
        });
        return Promise.reject(new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, `Postgres doesn't support update ${JSON.stringify(fieldValue)} yet`));
      }
    }
    const where = buildWhereClause({
      schema,
      index,
      query,
      caseInsensitive: false
    });
    values.push(...where.values);
    const whereClause = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const qs = `UPDATE $1:name SET ${updatePatterns.join()} ${whereClause} RETURNING *`;
    const promise = (transactionalSession ? transactionalSession.t : this._client).any(qs, values).catch(error => {
      if (error.code === PostgresUniqueIndexViolationError) {
        const err = new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;
        if (error.constraint) {
          const authDataMatch = error.constraint.match(/_User_unique_authData_([a-zA-Z0-9_]+)_id/);
          if (authDataMatch) {
            err.userInfo = {
              duplicated_field: `_auth_data_${authDataMatch[1]}`
            };
          } else {
            const matches = error.constraint.match(/unique_([a-zA-Z]+)/);
            if (matches && Array.isArray(matches)) {
              err.userInfo = {
                duplicated_field: matches[1]
              };
            }
          }
        }
        throw err;
      }
      throw error;
    });
    if (transactionalSession) {
      transactionalSession.batch.push(promise);
    }
    return promise;
  }

  // Hopefully, we can get rid of this. It's only used for config and hooks.
  upsertOneObject(className, schema, query, update, transactionalSession) {
    debug('upsertOneObject');
    const createValue = Object.assign({}, query, update);
    return this.createObject(className, schema, createValue, transactionalSession).catch(error => {
      // ignore duplicate value errors as it's upsert
      if (error.code !== _node.default.Error.DUPLICATE_VALUE) {
        throw error;
      }
      return this.findOneAndUpdate(className, schema, query, update, transactionalSession);
    });
  }
  find(className, schema, query, {
    skip,
    limit,
    sort,
    keys,
    caseInsensitive,
    explain
  }) {
    debug('find');
    const hasLimit = limit !== undefined;
    const hasSkip = skip !== undefined;
    let values = [className];
    const where = buildWhereClause({
      schema,
      query,
      index: 2,
      caseInsensitive
    });
    values.push(...where.values);
    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const limitPattern = hasLimit ? `LIMIT $${values.length + 1}` : '';
    if (hasLimit) {
      values.push(limit);
    }
    const skipPattern = hasSkip ? `OFFSET $${values.length + 1}` : '';
    if (hasSkip) {
      values.push(skip);
    }
    let sortPattern = '';
    if (sort) {
      const sortCopy = sort;
      const sorting = Object.keys(sort).map(key => {
        const transformKey = transformDotFieldToComponents(key).join('->');
        // Using $idx pattern gives:  non-integer constant in ORDER BY
        if (sortCopy[key] === 1) {
          return `${transformKey} ASC`;
        }
        return `${transformKey} DESC`;
      }).join();
      sortPattern = sort !== undefined && Object.keys(sort).length > 0 ? `ORDER BY ${sorting}` : '';
    }
    if (where.sorts && Object.keys(where.sorts).length > 0) {
      sortPattern = `ORDER BY ${where.sorts.join()}`;
    }
    let columns = '*';
    if (keys) {
      // Exclude empty keys
      // Replace ACL by it's keys
      keys = keys.reduce((memo, key) => {
        if (key === 'ACL') {
          memo.push('_rperm');
          memo.push('_wperm');
        } else if (key.length > 0 && (
        // Remove selected field not referenced in the schema
        // Relation is not a column in postgres
        // $score is a Parse special field and is also not a column
        schema.fields[key] && schema.fields[key].type !== 'Relation' || key === '$score')) {
          memo.push(key);
        }
        return memo;
      }, []);
      columns = keys.map((key, index) => {
        if (key === '$score') {
          return `ts_rank_cd(to_tsvector($${2}, $${3}:name), to_tsquery($${4}, $${5}), 32) as score`;
        }
        return `$${index + values.length + 1}:name`;
      }).join();
      values = values.concat(keys);
    }
    const originalQuery = `SELECT ${columns} FROM $1:name ${wherePattern} ${sortPattern} ${limitPattern} ${skipPattern}`;
    const qs = explain ? this.createExplainableQuery(originalQuery) : originalQuery;
    return this._client.any(qs, values).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError && error.code !== PostgresMissingColumnError) {
        throw error;
      }
      return [];
    }).then(results => {
      if (explain) {
        return results;
      }
      return results.map(object => this.postgresObjectToParseObject(className, object, schema));
    });
  }

  // Converts from a postgres-format object to a REST-format object.
  // Does not strip out anything based on a lack of authentication.
  postgresObjectToParseObject(className, object, schema) {
    Object.keys(schema.fields).forEach(fieldName => {
      if (schema.fields[fieldName].type === 'Pointer' && object[fieldName]) {
        object[fieldName] = {
          objectId: object[fieldName],
          __type: 'Pointer',
          className: schema.fields[fieldName].targetClass
        };
      }
      if (schema.fields[fieldName].type === 'Relation') {
        object[fieldName] = {
          __type: 'Relation',
          className: schema.fields[fieldName].targetClass
        };
      }
      if (object[fieldName] && schema.fields[fieldName].type === 'GeoPoint') {
        object[fieldName] = {
          __type: 'GeoPoint',
          latitude: object[fieldName].y,
          longitude: object[fieldName].x
        };
      }
      if (object[fieldName] && schema.fields[fieldName].type === 'Polygon') {
        let coords = new String(object[fieldName]);
        coords = coords.substring(2, coords.length - 2).split('),(');
        const updatedCoords = coords.map(point => {
          return [parseFloat(point.split(',')[1]), parseFloat(point.split(',')[0])];
        });
        object[fieldName] = {
          __type: 'Polygon',
          coordinates: updatedCoords
        };
      }
      if (object[fieldName] && schema.fields[fieldName].type === 'File') {
        object[fieldName] = {
          __type: 'File',
          name: object[fieldName]
        };
      }
    });
    //TODO: remove this reliance on the mongo format. DB adapter shouldn't know there is a difference between created at and any other date field.
    if (object.createdAt) {
      object.createdAt = object.createdAt.toISOString();
    }
    if (object.updatedAt) {
      object.updatedAt = object.updatedAt.toISOString();
    }
    if (object.expiresAt) {
      object.expiresAt = {
        __type: 'Date',
        iso: object.expiresAt.toISOString()
      };
    }
    if (object._email_verify_token_expires_at) {
      object._email_verify_token_expires_at = {
        __type: 'Date',
        iso: object._email_verify_token_expires_at.toISOString()
      };
    }
    if (object._account_lockout_expires_at) {
      object._account_lockout_expires_at = {
        __type: 'Date',
        iso: object._account_lockout_expires_at.toISOString()
      };
    }
    if (object._perishable_token_expires_at) {
      object._perishable_token_expires_at = {
        __type: 'Date',
        iso: object._perishable_token_expires_at.toISOString()
      };
    }
    if (object._password_changed_at) {
      object._password_changed_at = {
        __type: 'Date',
        iso: object._password_changed_at.toISOString()
      };
    }
    for (const fieldName in object) {
      if (object[fieldName] === null) {
        delete object[fieldName];
      }
      if (Utils.isDate(object[fieldName])) {
        object[fieldName] = {
          __type: 'Date',
          iso: object[fieldName].toISOString()
        };
      }
    }
    return object;
  }

  // Create a unique index. Unique indexes on nullable fields are not allowed. Since we don't
  // currently know which fields are nullable and which aren't, we ignore that criteria.
  // As such, we shouldn't expose this function to users of parse until we have an out-of-band
  // Way of determining if a field is nullable. Undefined doesn't count against uniqueness,
  // which is why we use sparse indexes.
  async ensureUniqueness(className, schema, fieldNames) {
    const constraintName = `${className}_unique_${fieldNames.sort().join('_')}`;
    const constraintPatterns = fieldNames.map((fieldName, index) => `$${index + 3}:name`);
    const qs = `CREATE UNIQUE INDEX IF NOT EXISTS $2:name ON $1:name(${constraintPatterns.join()})`;
    return this._client.none(qs, [className, constraintName, ...fieldNames]).catch(error => {
      if (error.code === PostgresDuplicateRelationError && error.message.includes(constraintName)) {
        // Index already exists. Ignore error.
      } else if (error.code === PostgresUniqueIndexViolationError && error.message.includes(constraintName)) {
        // Cast the error into the proper parse error
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      } else {
        throw error;
      }
    });
  }

  // Creates a unique index on authData-><provider>->>'id' to prevent
  // race conditions during concurrent signups with the same authData.
  async ensureAuthDataUniqueness(provider) {
    const indexName = `_User_unique_authData_${provider}_id`;
    const qs = `CREATE UNIQUE INDEX IF NOT EXISTS $1:name ON "_User" (("authData"->$2::text->>'id')) WHERE "authData"->$2::text->>'id' IS NOT NULL`;
    await this._client.none(qs, [indexName, provider]).catch(error => {
      if (error.code === PostgresDuplicateRelationError && error.message.includes(indexName)) {
        // Index already exists. Ignore error.
      } else if (error.code === PostgresUniqueIndexViolationError && error.message.includes(indexName)) {
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'Tried to ensure field uniqueness for a class that already has duplicates.');
      } else {
        throw error;
      }
    });
  }

  // Executes a count.
  async count(className, schema, query, readPreference, estimate = true) {
    debug('count');
    const values = [className];
    const where = buildWhereClause({
      schema,
      query,
      index: 2,
      caseInsensitive: false
    });
    values.push(...where.values);
    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    let qs = '';
    if (where.pattern.length > 0 || !estimate) {
      qs = `SELECT count(*) FROM $1:name ${wherePattern}`;
    } else {
      qs = 'SELECT reltuples AS approximate_row_count FROM pg_class WHERE relname = $1';
    }
    return this._client.one(qs, values, a => {
      if (a.approximate_row_count == null || a.approximate_row_count == -1) {
        return !isNaN(+a.count) ? +a.count : 0;
      } else {
        return +a.approximate_row_count;
      }
    }).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError && error.code !== PostgresMissingColumnError) {
        throw error;
      }
      return 0;
    });
  }
  async distinct(className, schema, query, fieldName) {
    debug('distinct');
    const fieldSegments = fieldName.split('.');
    for (const segment of fieldSegments) {
      if (!segment.match(/^[a-zA-Z][a-zA-Z0-9_]*$/)) {
        throw new _node.default.Error(_node.default.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}`);
      }
    }
    let field = fieldName;
    let column = fieldName;
    const isNested = fieldName.indexOf('.') >= 0;
    if (isNested) {
      field = transformDotFieldToComponents(fieldName).join('->');
      column = fieldSegments[0];
    }
    const isArrayField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array';
    const isPointerField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Pointer';
    const values = [field, column, className];
    const where = buildWhereClause({
      schema,
      query,
      index: 4,
      caseInsensitive: false
    });
    values.push(...where.values);
    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const transformer = isArrayField ? 'jsonb_array_elements' : 'ON';
    let qs = `SELECT DISTINCT ${transformer}($1:name) $2:name FROM $3:name ${wherePattern}`;
    if (isNested) {
      qs = `SELECT DISTINCT ${transformer}($1:raw) $2:raw FROM $3:name ${wherePattern}`;
    }
    return this._client.any(qs, values).catch(error => {
      if (error.code === PostgresMissingColumnError) {
        return [];
      }
      throw error;
    }).then(results => {
      if (!isNested) {
        results = results.filter(object => object[field] !== null);
        return results.map(object => {
          if (!isPointerField) {
            return object[field];
          }
          return {
            __type: 'Pointer',
            className: schema.fields[fieldName].targetClass,
            objectId: object[field]
          };
        });
      }
      const child = fieldName.split('.')[1];
      return results.map(object => object[column][child]);
    }).then(results => results.map(object => this.postgresObjectToParseObject(className, object, schema)));
  }
  async aggregate(className, schema, pipeline, readPreference, hint, explain) {
    debug('aggregate');
    const values = [className];
    let index = 2;
    let columns = [];
    let countField = null;
    let groupValues = null;
    let wherePattern = '';
    let limitPattern = '';
    let skipPattern = '';
    let sortPattern = '';
    let groupPattern = '';
    for (let i = 0; i < pipeline.length; i += 1) {
      const stage = pipeline[i];
      if (stage.$group) {
        for (const field in stage.$group) {
          const value = stage.$group[field];
          if (value === null || value === undefined) {
            continue;
          }
          if (field === '_id' && typeof value === 'string' && value !== '') {
            columns.push(`$${index}:name AS "objectId"`);
            groupPattern = `GROUP BY $${index}:name`;
            values.push(transformAggregateField(value));
            index += 1;
            continue;
          }
          if (field === '_id' && typeof value === 'object' && Object.keys(value).length !== 0) {
            groupValues = value;
            const groupByFields = [];
            for (const alias in value) {
              if (typeof value[alias] === 'string' && value[alias]) {
                const source = transformAggregateField(value[alias]);
                if (!groupByFields.includes(`"${source}"`)) {
                  groupByFields.push(`"${source}"`);
                }
                values.push(source, alias);
                columns.push(`$${index}:name AS $${index + 1}:name`);
                index += 2;
              } else {
                const operation = Object.keys(value[alias])[0];
                const source = transformAggregateField(value[alias][operation]);
                if (mongoAggregateToPostgres[operation]) {
                  if (!groupByFields.includes(`"${source}"`)) {
                    groupByFields.push(`"${source}"`);
                  }
                  columns.push(`EXTRACT(${mongoAggregateToPostgres[operation]} FROM $${index}:name AT TIME ZONE 'UTC')::integer AS $${index + 1}:name`);
                  values.push(source, alias);
                  index += 2;
                }
              }
            }
            groupPattern = `GROUP BY $${index}:raw`;
            values.push(groupByFields.join());
            index += 1;
            continue;
          }
          if (typeof value === 'object') {
            if (value.$sum) {
              if (typeof value.$sum === 'string') {
                columns.push(`SUM($${index}:name) AS $${index + 1}:name`);
                values.push(transformAggregateField(value.$sum), field);
                index += 2;
              } else {
                countField = field;
                columns.push(`COUNT(*) AS $${index}:name`);
                values.push(field);
                index += 1;
              }
            }
            if (value.$max) {
              columns.push(`MAX($${index}:name) AS $${index + 1}:name`);
              values.push(transformAggregateField(value.$max), field);
              index += 2;
            }
            if (value.$min) {
              columns.push(`MIN($${index}:name) AS $${index + 1}:name`);
              values.push(transformAggregateField(value.$min), field);
              index += 2;
            }
            if (value.$avg) {
              columns.push(`AVG($${index}:name) AS $${index + 1}:name`);
              values.push(transformAggregateField(value.$avg), field);
              index += 2;
            }
          }
        }
      } else {
        columns.push('*');
      }
      if (stage.$project) {
        if (columns.includes('*')) {
          columns = [];
        }
        for (const field in stage.$project) {
          const value = stage.$project[field];
          if (value === 1 || value === true) {
            columns.push(`$${index}:name`);
            values.push(field);
            index += 1;
          }
        }
      }
      if (stage.$match) {
        const patterns = [];
        const orOrAnd = Object.prototype.hasOwnProperty.call(stage.$match, '$or') ? ' OR ' : ' AND ';
        if (stage.$match.$or) {
          const collapse = {};
          stage.$match.$or.forEach(element => {
            for (const key in element) {
              collapse[key] = element[key];
            }
          });
          stage.$match = collapse;
        }
        for (let field in stage.$match) {
          const value = stage.$match[field];
          if (field === '_id') {
            field = 'objectId';
          }
          const matchPatterns = [];
          Object.keys(ParseToPosgresComparator).forEach(cmp => {
            if (value[cmp]) {
              const pgComparator = ParseToPosgresComparator[cmp];
              matchPatterns.push(`$${index}:name ${pgComparator} $${index + 1}`);
              values.push(field, toPostgresValue(value[cmp]));
              index += 2;
            }
          });
          if (matchPatterns.length > 0) {
            patterns.push(`(${matchPatterns.join(' AND ')})`);
          }
          if (schema.fields[field] && schema.fields[field].type && matchPatterns.length === 0) {
            patterns.push(`$${index}:name = $${index + 1}`);
            values.push(field, value);
            index += 2;
          }
        }
        wherePattern = patterns.length > 0 ? `WHERE ${patterns.join(` ${orOrAnd} `)}` : '';
      }
      if (stage.$limit) {
        limitPattern = `LIMIT $${index}`;
        values.push(stage.$limit);
        index += 1;
      }
      if (stage.$skip) {
        skipPattern = `OFFSET $${index}`;
        values.push(stage.$skip);
        index += 1;
      }
      if (stage.$sort) {
        const sort = stage.$sort;
        const keys = Object.keys(sort);
        const sorting = keys.map(key => {
          const transformer = sort[key] === 1 ? 'ASC' : 'DESC';
          const order = `$${index}:name ${transformer}`;
          index += 1;
          return order;
        }).join();
        values.push(...keys);
        sortPattern = sort !== undefined && sorting.length > 0 ? `ORDER BY ${sorting}` : '';
      }
    }
    if (groupPattern) {
      columns.forEach((e, i, a) => {
        if (e && e.trim() === '*') {
          a[i] = '';
        }
      });
    }
    const originalQuery = `SELECT ${columns.filter(Boolean).join()} FROM $1:name ${wherePattern} ${skipPattern} ${groupPattern} ${sortPattern} ${limitPattern}`;
    const qs = explain ? this.createExplainableQuery(originalQuery) : originalQuery;
    return this._client.any(qs, values).then(a => {
      if (explain) {
        return a;
      }
      const results = a.map(object => this.postgresObjectToParseObject(className, object, schema));
      results.forEach(result => {
        if (!Object.prototype.hasOwnProperty.call(result, 'objectId')) {
          result.objectId = null;
        }
        if (groupValues) {
          result.objectId = {};
          for (const key in groupValues) {
            result.objectId[key] = result[key];
            delete result[key];
          }
        }
        if (countField) {
          result[countField] = parseInt(result[countField], 10);
        }
      });
      return results;
    });
  }
  async performInitialization({
    VolatileClassesSchemas
  }) {
    // TODO: This method needs to be rewritten to make proper use of connections (@vitaly-t)
    debug('performInitialization');
    await this._ensureSchemaCollectionExists();
    const promises = VolatileClassesSchemas.map(schema => {
      return this.createTable(schema.className, schema).catch(err => {
        if (err.code === PostgresDuplicateRelationError || err.code === _node.default.Error.INVALID_CLASS_NAME) {
          return Promise.resolve();
        }
        throw err;
      }).then(() => this.schemaUpgrade(schema.className, schema));
    });
    promises.push(this._listenToSchema());
    return Promise.all(promises).then(() => {
      return this._client.tx('perform-initialization', async t => {
        await t.none(_sql.default.misc.jsonObjectSetKeys);
        await t.none(_sql.default.array.add);
        await t.none(_sql.default.array.addUnique);
        await t.none(_sql.default.array.remove);
        await t.none(_sql.default.array.containsAll);
        await t.none(_sql.default.array.containsAllRegex);
        await t.none(_sql.default.array.contains);
        return t.ctx;
      });
    }).then(ctx => {
      debug(`initializationDone in ${ctx.duration}`);
    }).catch(error => {
      // eslint-disable-next-line no-console
      console.error(error);
    });
  }
  async createIndexes(className, indexes, conn) {
    return (conn || this._client).tx(t => t.batch(indexes.map(i => {
      return t.none('CREATE INDEX IF NOT EXISTS $1:name ON $2:name ($3:name)', [i.name, className, i.key]);
    })));
  }
  async createIndexesIfNeeded(className, fieldName, type, conn) {
    await (conn || this._client).none('CREATE INDEX IF NOT EXISTS $1:name ON $2:name ($3:name)', [fieldName, className, type]);
  }
  async dropIndexes(className, indexes, conn) {
    const queries = indexes.map(i => ({
      query: 'DROP INDEX $1:name',
      values: i
    }));
    await (conn || this._client).tx(t => t.none(this._pgp.helpers.concat(queries)));
  }
  async getIndexes(className) {
    const qs = 'SELECT * FROM pg_indexes WHERE tablename = ${className}';
    return this._client.any(qs, {
      className
    });
  }
  async updateSchemaWithIndexes() {
    return Promise.resolve();
  }

  // Used for testing purposes
  async updateEstimatedCount(className) {
    return this._client.none('ANALYZE $1:name', [className]);
  }
  async createTransactionalSession() {
    return new Promise(resolve => {
      const transactionalSession = {};
      transactionalSession.result = this._client.tx(t => {
        transactionalSession.t = t;
        transactionalSession.promise = new Promise(resolve => {
          transactionalSession.resolve = resolve;
        });
        transactionalSession.batch = [];
        resolve(transactionalSession);
        return transactionalSession.promise;
      });
    });
  }
  commitTransactionalSession(transactionalSession) {
    transactionalSession.resolve(transactionalSession.t.batch(transactionalSession.batch));
    return transactionalSession.result;
  }
  abortTransactionalSession(transactionalSession) {
    const result = transactionalSession.result.catch();
    transactionalSession.batch.push(Promise.reject());
    transactionalSession.resolve(transactionalSession.t.batch(transactionalSession.batch));
    return result;
  }
  async ensureIndex(className, schema, fieldNames, indexName, caseInsensitive = false, options = {}) {
    const conn = options.conn !== undefined ? options.conn : this._client;
    const defaultIndexName = `parse_default_${fieldNames.sort().join('_')}`;
    const indexNameOptions = indexName != null ? {
      name: indexName
    } : {
      name: defaultIndexName
    };
    const constraintPatterns = caseInsensitive ? fieldNames.map((fieldName, index) => `lower($${index + 3}:name) varchar_pattern_ops`) : fieldNames.map((fieldName, index) => `$${index + 3}:name`);
    const qs = `CREATE INDEX IF NOT EXISTS $1:name ON $2:name (${constraintPatterns.join()})`;
    const setIdempotencyFunction = options.setIdempotencyFunction !== undefined ? options.setIdempotencyFunction : false;
    if (setIdempotencyFunction) {
      await this.ensureIdempotencyFunctionExists(options);
    }
    await conn.none(qs, [indexNameOptions.name, className, ...fieldNames]).catch(error => {
      if (error.code === PostgresDuplicateRelationError && error.message.includes(indexNameOptions.name)) {
        // Index already exists. Ignore error.
      } else if (error.code === PostgresUniqueIndexViolationError && error.message.includes(indexNameOptions.name)) {
        // Cast the error into the proper parse error
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      } else {
        throw error;
      }
    });
  }
  async deleteIdempotencyFunction(options = {}) {
    const conn = options.conn !== undefined ? options.conn : this._client;
    const qs = 'DROP FUNCTION IF EXISTS idempotency_delete_expired_records()';
    return conn.none(qs).catch(error => {
      throw error;
    });
  }
  async ensureIdempotencyFunctionExists(options = {}) {
    const conn = options.conn !== undefined ? options.conn : this._client;
    const ttlOptions = options.ttl !== undefined ? `${options.ttl} seconds` : '60 seconds';
    const qs = 'CREATE OR REPLACE FUNCTION idempotency_delete_expired_records() RETURNS void LANGUAGE plpgsql AS $$ BEGIN DELETE FROM "_Idempotency" WHERE expire < NOW() - INTERVAL $1; END; $$;';
    return conn.none(qs, [ttlOptions]).catch(error => {
      throw error;
    });
  }
}
exports.PostgresStorageAdapter = PostgresStorageAdapter;
function convertPolygonToSQL(polygon) {
  if (polygon.length < 3) {
    throw new _node.default.Error(_node.default.Error.INVALID_JSON, `Polygon must have at least 3 values`);
  }
  if (polygon[0][0] !== polygon[polygon.length - 1][0] || polygon[0][1] !== polygon[polygon.length - 1][1]) {
    polygon.push(polygon[0]);
  }
  const unique = polygon.filter((item, index, ar) => {
    let foundIndex = -1;
    for (let i = 0; i < ar.length; i += 1) {
      const pt = ar[i];
      if (pt[0] === item[0] && pt[1] === item[1]) {
        foundIndex = i;
        break;
      }
    }
    return foundIndex === index;
  });
  if (unique.length < 3) {
    throw new _node.default.Error(_node.default.Error.INTERNAL_SERVER_ERROR, 'GeoJSON: Loop must have at least 3 different vertices');
  }
  const points = polygon.map(point => {
    _node.default.GeoPoint._validate(parseFloat(point[1]), parseFloat(point[0]));
    return `(${point[1]}, ${point[0]})`;
  }).join(', ');
  return `(${points})`;
}
function removeWhiteSpace(regex) {
  if (!regex.endsWith('\n')) {
    regex += '\n';
  }

  // remove non escaped comments
  return regex.replace(/([^\\])#.*\n/gim, '$1')
  // remove lines starting with a comment
  .replace(/^#.*\n/gim, '')
  // remove non escaped whitespace
  .replace(/([^\\])\s+/gim, '$1')
  // remove whitespace at the beginning of a line
  .replace(/^\s+/, '').trim();
}
function processRegexPattern(s) {
  if (s && s.startsWith('^')) {
    // regex for startsWith
    return '^' + literalizeRegexPart(s.slice(1));
  } else if (s && s.endsWith('$')) {
    // regex for endsWith
    return literalizeRegexPart(s.slice(0, s.length - 1)) + '$';
  }

  // regex for contains
  return literalizeRegexPart(s);
}
function isStartsWithRegex(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('^')) {
    return false;
  }
  const matches = value.match(/\^\\Q.*\\E/);
  return !!matches;
}
function isAllValuesRegexOrNone(values) {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return true;
  }
  const firstValuesIsRegex = isStartsWithRegex(values[0].$regex);
  if (values.length === 1) {
    return firstValuesIsRegex;
  }
  for (let i = 1, length = values.length; i < length; ++i) {
    if (firstValuesIsRegex !== isStartsWithRegex(values[i].$regex)) {
      return false;
    }
  }
  return true;
}
function isAnyValueRegexStartsWith(values) {
  return values.some(function (value) {
    return isStartsWithRegex(value.$regex);
  });
}
function createLiteralRegex(remaining) {
  return remaining.split('').map(c => {
    const regex = RegExp('[0-9 ]|\\p{L}', 'u'); // Support all Unicode letter chars
    if (c.match(regex) !== null) {
      // Don't escape alphanumeric characters
      return c;
    }
    // Escape everything else (single quotes with single quotes, everything else with a backslash)
    return c === `'` ? `''` : `\\${c}`;
  }).join('');
}
function literalizeRegexPart(s) {
  const matcher1 = /\\Q((?!\\E).*)\\E$/;
  const result1 = s.match(matcher1);
  if (result1 && result1.length > 1 && result1.index > -1) {
    // Process Regex that has a beginning and an end specified for the literal text
    const prefix = s.substring(0, result1.index);
    const remaining = result1[1];
    return literalizeRegexPart(prefix) + createLiteralRegex(remaining);
  }

  // Process Regex that has a beginning specified for the literal text
  const matcher2 = /\\Q((?!\\E).*)$/;
  const result2 = s.match(matcher2);
  if (result2 && result2.length > 1 && result2.index > -1) {
    const prefix = s.substring(0, result2.index);
    const remaining = result2[1];
    return literalizeRegexPart(prefix) + createLiteralRegex(remaining);
  }

  // Remove problematic chars from remaining text
  return s
  // Remove all instances of \Q and \E
  .replace(/([^\\])(\\E)/, '$1').replace(/([^\\])(\\Q)/, '$1').replace(/^\\E/, '').replace(/^\\Q/, '')
  // Ensure even number of single quote sequences by adding an extra single quote if needed;
  // this ensures that every single quote is escaped
  .replace(/'+/g, match => {
    return match.length % 2 === 0 ? match : match + "'";
  });
}
var GeoPointCoder = {
  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'GeoPoint';
  }
};
var _default = exports.default = PostgresStorageAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfUG9zdGdyZXNDbGllbnQiLCJyZXF1aXJlIiwiX25vZGUiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwiX2xvZGFzaCIsIl9jcnlwdG8iLCJfc3FsIiwiX1N0b3JhZ2VBZGFwdGVyIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiVXRpbHMiLCJQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IiLCJQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IiLCJQb3N0Z3Jlc0R1cGxpY2F0ZUNvbHVtbkVycm9yIiwiUG9zdGdyZXNNaXNzaW5nQ29sdW1uRXJyb3IiLCJQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3IiLCJsb2dnZXIiLCJkZWJ1ZyIsImFyZ3MiLCJhcmd1bWVudHMiLCJjb25jYXQiLCJzbGljZSIsImxlbmd0aCIsImxvZyIsImdldExvZ2dlciIsImFwcGx5IiwicGFyc2VUeXBlVG9Qb3N0Z3Jlc1R5cGUiLCJ0eXBlIiwiY29udGVudHMiLCJKU09OIiwic3RyaW5naWZ5IiwiUGFyc2VUb1Bvc2dyZXNDb21wYXJhdG9yIiwiJGd0IiwiJGx0IiwiJGd0ZSIsIiRsdGUiLCJtb25nb0FnZ3JlZ2F0ZVRvUG9zdGdyZXMiLCIkZGF5T2ZNb250aCIsIiRkYXlPZldlZWsiLCIkZGF5T2ZZZWFyIiwiJGlzb0RheU9mV2VlayIsIiRpc29XZWVrWWVhciIsIiRob3VyIiwiJG1pbnV0ZSIsIiRzZWNvbmQiLCIkbWlsbGlzZWNvbmQiLCIkbW9udGgiLCIkd2VlayIsIiR5ZWFyIiwidG9Qb3N0Z3Jlc1ZhbHVlIiwidmFsdWUiLCJfX3R5cGUiLCJpc28iLCJuYW1lIiwidG9Qb3N0Z3Jlc1ZhbHVlQ2FzdFR5cGUiLCJwb3N0Z3Jlc1ZhbHVlIiwiY2FzdFR5cGUiLCJ1bmRlZmluZWQiLCJ0cmFuc2Zvcm1WYWx1ZSIsIm9iamVjdElkIiwiZW1wdHlDTFBTIiwiT2JqZWN0IiwiZnJlZXplIiwiZmluZCIsImdldCIsImNvdW50IiwiY3JlYXRlIiwidXBkYXRlIiwiZGVsZXRlIiwiYWRkRmllbGQiLCJwcm90ZWN0ZWRGaWVsZHMiLCJkZWZhdWx0Q0xQUyIsIkFDTCIsInJlYWQiLCJ3cml0ZSIsInRvUGFyc2VTY2hlbWEiLCJzY2hlbWEiLCJjbGFzc05hbWUiLCJmaWVsZHMiLCJfaGFzaGVkX3Bhc3N3b3JkIiwiX3dwZXJtIiwiX3JwZXJtIiwiY2xwcyIsImNsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsImluZGV4ZXMiLCJ0b1Bvc3RncmVzU2NoZW1hIiwiX3Bhc3N3b3JkX2hpc3RvcnkiLCJpc0FycmF5SW5kZXgiLCJhcnJheUluZGV4IiwiQXJyYXkiLCJmcm9tIiwiZXZlcnkiLCJjIiwiaGFuZGxlRG90RmllbGRzIiwib2JqZWN0Iiwia2V5cyIsImZvckVhY2giLCJmaWVsZE5hbWUiLCJpbmRleE9mIiwiY29tcG9uZW50cyIsInNwbGl0IiwiZmlyc3QiLCJzaGlmdCIsImN1cnJlbnRPYmoiLCJuZXh0IiwiX19vcCIsImVzY2FwZVNxbFN0cmluZyIsInJlcGxhY2UiLCJlc2NhcGVKc29uU3RyaW5nIiwidHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMiLCJtYXAiLCJjbXB0IiwiaW5kZXgiLCJOdW1iZXIiLCJ0cmFuc2Zvcm1Eb3RGaWVsZCIsImpvaW4iLCJ2YWxpZGF0ZUFnZ3JlZ2F0ZUZpZWxkTmFtZSIsIm1hdGNoIiwiUGFyc2UiLCJFcnJvciIsIklOVkFMSURfS0VZX05BTUUiLCJ0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCIsInN0YXJ0c1dpdGgiLCJzdWJzdHJpbmciLCJ2YWxpZGF0ZUtleXMiLCJrZXkiLCJpbmNsdWRlcyIsIklOVkFMSURfTkVTVEVEX0tFWSIsImpvaW5UYWJsZXNGb3JTY2hlbWEiLCJsaXN0IiwiZmllbGQiLCJwdXNoIiwiYnVpbGRXaGVyZUNsYXVzZSIsInF1ZXJ5IiwiY2FzZUluc2Vuc2l0aXZlIiwicGF0dGVybnMiLCJ2YWx1ZXMiLCJzb3J0cyIsImlzQXJyYXlGaWVsZCIsImluaXRpYWxQYXR0ZXJuc0xlbmd0aCIsImZpZWxkVmFsdWUiLCIkZXhpc3RzIiwiYXV0aERhdGFNYXRjaCIsIiRpbiIsIiRyZWdleCIsInNvbWUiLCJNQVhfSU5UX1BMVVNfT05FIiwiY2xhdXNlcyIsImNsYXVzZVZhbHVlcyIsInN1YlF1ZXJ5IiwiY2xhdXNlIiwicGF0dGVybiIsIm9yT3JBbmQiLCJub3QiLCIkbmUiLCJjb25zdHJhaW50RmllbGROYW1lIiwiJHJlbGF0aXZlVGltZSIsIklOVkFMSURfSlNPTiIsInBvaW50IiwibG9uZ2l0dWRlIiwibGF0aXR1ZGUiLCIkZXEiLCJpc0luT3JOaW4iLCJpc0FycmF5IiwiJG5pbiIsImluUGF0dGVybnMiLCJhbGxvd051bGwiLCJsaXN0RWxlbSIsImxpc3RJbmRleCIsImNyZWF0ZUNvbnN0cmFpbnQiLCJiYXNlQXJyYXkiLCJub3RJbiIsImZpZWxkVHlwZSIsIm9wZXJhdG9yTmFtZSIsImVsZW0iLCJJTlZBTElEX1FVRVJZIiwiXyIsImZsYXRNYXAiLCJlbHQiLCIkYWxsIiwiaXNBbnlWYWx1ZVJlZ2V4U3RhcnRzV2l0aCIsImlzQWxsVmFsdWVzUmVnZXhPck5vbmUiLCJpIiwicHJvY2Vzc1JlZ2V4UGF0dGVybiIsIiRjb250YWluZWRCeSIsImFyciIsIiR0ZXh0Iiwic2VhcmNoIiwiJHNlYXJjaCIsImxhbmd1YWdlIiwiJHRlcm0iLCIkbGFuZ3VhZ2UiLCIkY2FzZVNlbnNpdGl2ZSIsIiRkaWFjcml0aWNTZW5zaXRpdmUiLCIkbmVhclNwaGVyZSIsImRpc3RhbmNlIiwiJG1heERpc3RhbmNlIiwiZGlzdGFuY2VJbktNIiwiJHdpdGhpbiIsIiRib3giLCJib3giLCJsZWZ0IiwiYm90dG9tIiwicmlnaHQiLCJ0b3AiLCIkZ2VvV2l0aGluIiwiJGNlbnRlclNwaGVyZSIsImNlbnRlclNwaGVyZSIsIkdlb1BvaW50IiwiR2VvUG9pbnRDb2RlciIsImlzVmFsaWRKU09OIiwiX3ZhbGlkYXRlIiwiaXNOYU4iLCIkcG9seWdvbiIsInBvbHlnb24iLCJwb2ludHMiLCJjb29yZGluYXRlcyIsIiRnZW9JbnRlcnNlY3RzIiwiJHBvaW50IiwicmVnZXgiLCJvcGVyYXRvciIsIm9wdHMiLCIkb3B0aW9ucyIsInJlbW92ZVdoaXRlU3BhY2UiLCJjb252ZXJ0UG9seWdvblRvU1FMIiwiY21wIiwicGdDb21wYXJhdG9yIiwicGFyc2VyUmVzdWx0IiwicmVsYXRpdmVUaW1lVG9EYXRlIiwic3RhdHVzIiwicmVzdWx0IiwiY29uc29sZSIsImVycm9yIiwiaW5mbyIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJQb3N0Z3Jlc1N0b3JhZ2VBZGFwdGVyIiwiY29uc3RydWN0b3IiLCJ1cmkiLCJjb2xsZWN0aW9uUHJlZml4IiwiZGF0YWJhc2VPcHRpb25zIiwib3B0aW9ucyIsIl9jb2xsZWN0aW9uUHJlZml4IiwiZW5hYmxlU2NoZW1hSG9va3MiLCJkaXNhYmxlSW5kZXhGaWVsZFZhbGlkYXRpb24iLCJzY2hlbWFDYWNoZVR0bCIsImNsaWVudCIsInBncCIsImNyZWF0ZUNsaWVudCIsIl9jbGllbnQiLCJfb25jaGFuZ2UiLCJfcGdwIiwiX3V1aWQiLCJyYW5kb21VVUlEIiwiY2FuU29ydE9uSm9pblRhYmxlcyIsIndhdGNoIiwiY2FsbGJhY2siLCJjcmVhdGVFeHBsYWluYWJsZVF1ZXJ5IiwiYW5hbHl6ZSIsImhhbmRsZVNodXRkb3duIiwiX3N0cmVhbSIsImRvbmUiLCIkcG9vbCIsImVuZCIsIl9saXN0ZW5Ub1NjaGVtYSIsImNvbm5lY3QiLCJkaXJlY3QiLCJvbiIsImRhdGEiLCJwYXlsb2FkIiwicGFyc2UiLCJzZW5kZXJJZCIsIm5vbmUiLCJfbm90aWZ5U2NoZW1hQ2hhbmdlIiwiY2F0Y2giLCJfZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyIsImNvbm4iLCJjbGFzc0V4aXN0cyIsIm9uZSIsImEiLCJleGlzdHMiLCJzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJDTFBzIiwidGFzayIsInQiLCJzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdCIsInN1Ym1pdHRlZEluZGV4ZXMiLCJleGlzdGluZ0luZGV4ZXMiLCJzZWxmIiwiUHJvbWlzZSIsInJlc29sdmUiLCJfaWRfIiwiX2lkIiwiZGVsZXRlZEluZGV4ZXMiLCJpbnNlcnRlZEluZGV4ZXMiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJ0eCIsImNyZWF0ZUluZGV4ZXMiLCJjb2x1bW5Eb2VzTm90RXhpc3RFcnJvciIsImdldEVycm9ycyIsImNvZGUiLCJkcm9wSW5kZXhlcyIsImNyZWF0ZUNsYXNzIiwicGFyc2VTY2hlbWEiLCJjcmVhdGVUYWJsZSIsImVyciIsImRldGFpbCIsIkRVUExJQ0FURV9WQUxVRSIsInZhbHVlc0FycmF5IiwicGF0dGVybnNBcnJheSIsImFzc2lnbiIsIl9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCIsIl9lbWFpbF92ZXJpZnlfdG9rZW4iLCJfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQiLCJfZmFpbGVkX2xvZ2luX2NvdW50IiwiX3BlcmlzaGFibGVfdG9rZW4iLCJfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0IiwiX3Bhc3N3b3JkX2NoYW5nZWRfYXQiLCJyZWxhdGlvbnMiLCJwYXJzZVR5cGUiLCJxcyIsImJhdGNoIiwiam9pblRhYmxlIiwic2NoZW1hVXBncmFkZSIsImNvbHVtbnMiLCJjb2x1bW5fbmFtZSIsIm5ld0NvbHVtbnMiLCJmaWx0ZXIiLCJpdGVtIiwiYWRkRmllbGRJZk5vdEV4aXN0cyIsInBvc3RncmVzVHlwZSIsImFueSIsInBhdGgiLCJ1cGRhdGVGaWVsZE9wdGlvbnMiLCJkZWxldGVDbGFzcyIsIm9wZXJhdGlvbnMiLCJyZXNwb25zZSIsImhlbHBlcnMiLCJ0aGVuIiwiZGVsZXRlQWxsQ2xhc3NlcyIsIm5vdyIsIkRhdGUiLCJnZXRUaW1lIiwiZW5kZWQiLCJyZXN1bHRzIiwiam9pbnMiLCJyZWR1Y2UiLCJjbGFzc2VzIiwicXVlcmllcyIsImRlbGV0ZUZpZWxkcyIsImZpZWxkTmFtZXMiLCJpZHgiLCJnZXRBbGxDbGFzc2VzIiwicm93IiwiZ2V0Q2xhc3MiLCJjcmVhdGVPYmplY3QiLCJ0cmFuc2FjdGlvbmFsU2Vzc2lvbiIsImNvbHVtbnNBcnJheSIsImdlb1BvaW50cyIsImF1dGhEYXRhQWxyZWFkeUV4aXN0cyIsImF1dGhEYXRhIiwicHJvdmlkZXIiLCJwb3AiLCJpbml0aWFsVmFsdWVzIiwidmFsIiwidGVybWluYXRpb24iLCJnZW9Qb2ludHNJbmplY3RzIiwibCIsImNvbHVtbnNQYXR0ZXJuIiwiY29sIiwidmFsdWVzUGF0dGVybiIsInByb21pc2UiLCJvcHMiLCJ1bmRlcmx5aW5nRXJyb3IiLCJjb25zdHJhaW50IiwidXNlckluZm8iLCJkdXBsaWNhdGVkX2ZpZWxkIiwibWF0Y2hlcyIsImRlbGV0ZU9iamVjdHNCeVF1ZXJ5Iiwid2hlcmUiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwiZmluZE9uZUFuZFVwZGF0ZSIsInVwZGF0ZU9iamVjdHNCeVF1ZXJ5IiwidXBkYXRlUGF0dGVybnMiLCJvcmlnaW5hbFVwZGF0ZSIsImRvdE5vdGF0aW9uT3B0aW9ucyIsImdlbmVyYXRlIiwianNvbmIiLCJnZW5lcmF0ZVJlbW92ZSIsImxhc3RLZXkiLCJmaWVsZE5hbWVJbmRleCIsInN0ciIsImFtb3VudCIsIm9iamVjdHMiLCJpc0RhdGUiLCJrZXlzVG9JbmNyZW1lbnQiLCJrIiwiaW5jcmVtZW50UGF0dGVybnMiLCJpbmNyZW1lbnRWYWx1ZXMiLCJhbW91bnRJbmRleCIsImpzb25TYWZlTmFtZSIsInNxbFNhZmVOYW1lIiwia2V5c1RvRGVsZXRlIiwiZGVsZXRlUGF0dGVybnMiLCJwIiwidXBkYXRlT2JqZWN0IiwiZXhwZWN0ZWRUeXBlIiwicmVqZWN0Iiwid2hlcmVDbGF1c2UiLCJ1cHNlcnRPbmVPYmplY3QiLCJjcmVhdGVWYWx1ZSIsInNraXAiLCJsaW1pdCIsInNvcnQiLCJleHBsYWluIiwiaGFzTGltaXQiLCJoYXNTa2lwIiwid2hlcmVQYXR0ZXJuIiwibGltaXRQYXR0ZXJuIiwic2tpcFBhdHRlcm4iLCJzb3J0UGF0dGVybiIsInNvcnRDb3B5Iiwic29ydGluZyIsInRyYW5zZm9ybUtleSIsIm1lbW8iLCJvcmlnaW5hbFF1ZXJ5IiwicG9zdGdyZXNPYmplY3RUb1BhcnNlT2JqZWN0IiwidGFyZ2V0Q2xhc3MiLCJ5IiwieCIsImNvb3JkcyIsIlN0cmluZyIsInVwZGF0ZWRDb29yZHMiLCJwYXJzZUZsb2F0IiwiY3JlYXRlZEF0IiwidG9JU09TdHJpbmciLCJ1cGRhdGVkQXQiLCJleHBpcmVzQXQiLCJlbnN1cmVVbmlxdWVuZXNzIiwiY29uc3RyYWludE5hbWUiLCJjb25zdHJhaW50UGF0dGVybnMiLCJtZXNzYWdlIiwiZW5zdXJlQXV0aERhdGFVbmlxdWVuZXNzIiwiaW5kZXhOYW1lIiwicmVhZFByZWZlcmVuY2UiLCJlc3RpbWF0ZSIsImFwcHJveGltYXRlX3Jvd19jb3VudCIsImRpc3RpbmN0IiwiZmllbGRTZWdtZW50cyIsInNlZ21lbnQiLCJjb2x1bW4iLCJpc05lc3RlZCIsImlzUG9pbnRlckZpZWxkIiwidHJhbnNmb3JtZXIiLCJjaGlsZCIsImFnZ3JlZ2F0ZSIsInBpcGVsaW5lIiwiaGludCIsImNvdW50RmllbGQiLCJncm91cFZhbHVlcyIsImdyb3VwUGF0dGVybiIsInN0YWdlIiwiJGdyb3VwIiwiZ3JvdXBCeUZpZWxkcyIsImFsaWFzIiwic291cmNlIiwib3BlcmF0aW9uIiwiJHN1bSIsIiRtYXgiLCIkbWluIiwiJGF2ZyIsIiRwcm9qZWN0IiwiJG1hdGNoIiwiJG9yIiwiY29sbGFwc2UiLCJlbGVtZW50IiwibWF0Y2hQYXR0ZXJucyIsIiRsaW1pdCIsIiRza2lwIiwiJHNvcnQiLCJvcmRlciIsInRyaW0iLCJCb29sZWFuIiwicGFyc2VJbnQiLCJwZXJmb3JtSW5pdGlhbGl6YXRpb24iLCJWb2xhdGlsZUNsYXNzZXNTY2hlbWFzIiwicHJvbWlzZXMiLCJJTlZBTElEX0NMQVNTX05BTUUiLCJhbGwiLCJzcWwiLCJtaXNjIiwianNvbk9iamVjdFNldEtleXMiLCJhcnJheSIsImFkZCIsImFkZFVuaXF1ZSIsInJlbW92ZSIsImNvbnRhaW5zQWxsIiwiY29udGFpbnNBbGxSZWdleCIsImNvbnRhaW5zIiwiY3R4IiwiZHVyYXRpb24iLCJjcmVhdGVJbmRleGVzSWZOZWVkZWQiLCJnZXRJbmRleGVzIiwidXBkYXRlU2NoZW1hV2l0aEluZGV4ZXMiLCJ1cGRhdGVFc3RpbWF0ZWRDb3VudCIsImNyZWF0ZVRyYW5zYWN0aW9uYWxTZXNzaW9uIiwiY29tbWl0VHJhbnNhY3Rpb25hbFNlc3Npb24iLCJhYm9ydFRyYW5zYWN0aW9uYWxTZXNzaW9uIiwiZW5zdXJlSW5kZXgiLCJkZWZhdWx0SW5kZXhOYW1lIiwiaW5kZXhOYW1lT3B0aW9ucyIsInNldElkZW1wb3RlbmN5RnVuY3Rpb24iLCJlbnN1cmVJZGVtcG90ZW5jeUZ1bmN0aW9uRXhpc3RzIiwiZGVsZXRlSWRlbXBvdGVuY3lGdW5jdGlvbiIsInR0bE9wdGlvbnMiLCJ0dGwiLCJleHBvcnRzIiwidW5pcXVlIiwiYXIiLCJmb3VuZEluZGV4IiwicHQiLCJJTlRFUk5BTF9TRVJWRVJfRVJST1IiLCJlbmRzV2l0aCIsInMiLCJsaXRlcmFsaXplUmVnZXhQYXJ0IiwiaXNTdGFydHNXaXRoUmVnZXgiLCJmaXJzdFZhbHVlc0lzUmVnZXgiLCJjcmVhdGVMaXRlcmFsUmVnZXgiLCJyZW1haW5pbmciLCJSZWdFeHAiLCJtYXRjaGVyMSIsInJlc3VsdDEiLCJwcmVmaXgiLCJtYXRjaGVyMiIsInJlc3VsdDIiLCJfZGVmYXVsdCJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL1Bvc3RncmVzL1Bvc3RncmVzU3RvcmFnZUFkYXB0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQGZsb3dcbmltcG9ydCB7IGNyZWF0ZUNsaWVudCB9IGZyb20gJy4vUG9zdGdyZXNDbGllbnQnO1xuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHNxbCBmcm9tICcuL3NxbCc7XG5pbXBvcnQgeyBTdG9yYWdlQWRhcHRlciB9IGZyb20gJy4uL1N0b3JhZ2VBZGFwdGVyJztcbmltcG9ydCB0eXBlIHsgU2NoZW1hVHlwZSwgUXVlcnlUeXBlLCBRdWVyeU9wdGlvbnMgfSBmcm9tICcuLi9TdG9yYWdlQWRhcHRlcic7XG5jb25zdCBVdGlscyA9IHJlcXVpcmUoJy4uLy4uLy4uL1V0aWxzJyk7XG5cbmNvbnN0IFBvc3RncmVzUmVsYXRpb25Eb2VzTm90RXhpc3RFcnJvciA9ICc0MlAwMSc7XG5jb25zdCBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IgPSAnNDJQMDcnO1xuY29uc3QgUG9zdGdyZXNEdXBsaWNhdGVDb2x1bW5FcnJvciA9ICc0MjcwMSc7XG5jb25zdCBQb3N0Z3Jlc01pc3NpbmdDb2x1bW5FcnJvciA9ICc0MjcwMyc7XG5jb25zdCBQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3IgPSAnMjM1MDUnO1xuY29uc3QgbG9nZ2VyID0gcmVxdWlyZSgnLi4vLi4vLi4vbG9nZ2VyJyk7XG5cbmNvbnN0IGRlYnVnID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueSkge1xuICBhcmdzID0gWydQRzogJyArIGFyZ3VtZW50c1swXV0uY29uY2F0KGFyZ3Muc2xpY2UoMSwgYXJncy5sZW5ndGgpKTtcbiAgY29uc3QgbG9nID0gbG9nZ2VyLmdldExvZ2dlcigpO1xuICBsb2cuZGVidWcuYXBwbHkobG9nLCBhcmdzKTtcbn07XG5cbmNvbnN0IHBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlID0gdHlwZSA9PiB7XG4gIHN3aXRjaCAodHlwZS50eXBlKSB7XG4gICAgY2FzZSAnU3RyaW5nJzpcbiAgICAgIHJldHVybiAndGV4dCc7XG4gICAgY2FzZSAnRGF0ZSc6XG4gICAgICByZXR1cm4gJ3RpbWVzdGFtcCB3aXRoIHRpbWUgem9uZSc7XG4gICAgY2FzZSAnT2JqZWN0JzpcbiAgICAgIHJldHVybiAnanNvbmInO1xuICAgIGNhc2UgJ0ZpbGUnOlxuICAgICAgcmV0dXJuICd0ZXh0JztcbiAgICBjYXNlICdCb29sZWFuJzpcbiAgICAgIHJldHVybiAnYm9vbGVhbic7XG4gICAgY2FzZSAnUG9pbnRlcic6XG4gICAgICByZXR1cm4gJ3RleHQnO1xuICAgIGNhc2UgJ051bWJlcic6XG4gICAgICByZXR1cm4gJ2RvdWJsZSBwcmVjaXNpb24nO1xuICAgIGNhc2UgJ0dlb1BvaW50JzpcbiAgICAgIHJldHVybiAncG9pbnQnO1xuICAgIGNhc2UgJ0J5dGVzJzpcbiAgICAgIHJldHVybiAnanNvbmInO1xuICAgIGNhc2UgJ1BvbHlnb24nOlxuICAgICAgcmV0dXJuICdwb2x5Z29uJztcbiAgICBjYXNlICdBcnJheSc6XG4gICAgICBpZiAodHlwZS5jb250ZW50cyAmJiB0eXBlLmNvbnRlbnRzLnR5cGUgPT09ICdTdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiAndGV4dFtdJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiAnanNvbmInO1xuICAgICAgfVxuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBgbm8gdHlwZSBmb3IgJHtKU09OLnN0cmluZ2lmeSh0eXBlKX0geWV0YDtcbiAgfVxufTtcblxuY29uc3QgUGFyc2VUb1Bvc2dyZXNDb21wYXJhdG9yID0ge1xuICAkZ3Q6ICc+JyxcbiAgJGx0OiAnPCcsXG4gICRndGU6ICc+PScsXG4gICRsdGU6ICc8PScsXG59O1xuXG5jb25zdCBtb25nb0FnZ3JlZ2F0ZVRvUG9zdGdyZXMgPSB7XG4gICRkYXlPZk1vbnRoOiAnREFZJyxcbiAgJGRheU9mV2VlazogJ0RPVycsXG4gICRkYXlPZlllYXI6ICdET1knLFxuICAkaXNvRGF5T2ZXZWVrOiAnSVNPRE9XJyxcbiAgJGlzb1dlZWtZZWFyOiAnSVNPWUVBUicsXG4gICRob3VyOiAnSE9VUicsXG4gICRtaW51dGU6ICdNSU5VVEUnLFxuICAkc2Vjb25kOiAnU0VDT05EJyxcbiAgJG1pbGxpc2Vjb25kOiAnTUlMTElTRUNPTkRTJyxcbiAgJG1vbnRoOiAnTU9OVEgnLFxuICAkd2VlazogJ1dFRUsnLFxuICAkeWVhcjogJ1lFQVInLFxufTtcblxuY29uc3QgdG9Qb3N0Z3Jlc1ZhbHVlID0gdmFsdWUgPT4ge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgIGlmICh2YWx1ZS5fX3R5cGUgPT09ICdEYXRlJykge1xuICAgICAgcmV0dXJuIHZhbHVlLmlzbztcbiAgICB9XG4gICAgaWYgKHZhbHVlLl9fdHlwZSA9PT0gJ0ZpbGUnKSB7XG4gICAgICByZXR1cm4gdmFsdWUubmFtZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufTtcblxuY29uc3QgdG9Qb3N0Z3Jlc1ZhbHVlQ2FzdFR5cGUgPSB2YWx1ZSA9PiB7XG4gIGNvbnN0IHBvc3RncmVzVmFsdWUgPSB0b1Bvc3RncmVzVmFsdWUodmFsdWUpO1xuICBsZXQgY2FzdFR5cGU7XG4gIHN3aXRjaCAodHlwZW9mIHBvc3RncmVzVmFsdWUpIHtcbiAgICBjYXNlICdudW1iZXInOlxuICAgICAgY2FzdFR5cGUgPSAnZG91YmxlIHByZWNpc2lvbic7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdib29sZWFuJzpcbiAgICAgIGNhc3RUeXBlID0gJ2Jvb2xlYW4nO1xuICAgICAgYnJlYWs7XG4gICAgZGVmYXVsdDpcbiAgICAgIGNhc3RUeXBlID0gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBjYXN0VHlwZTtcbn07XG5cbmNvbnN0IHRyYW5zZm9ybVZhbHVlID0gdmFsdWUgPT4ge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZS5fX3R5cGUgPT09ICdQb2ludGVyJykge1xuICAgIHJldHVybiB2YWx1ZS5vYmplY3RJZDtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59O1xuXG4vLyBEdXBsaWNhdGUgZnJvbSB0aGVuIG1vbmdvIGFkYXB0ZXIuLi5cbmNvbnN0IGVtcHR5Q0xQUyA9IE9iamVjdC5mcmVlemUoe1xuICBmaW5kOiB7fSxcbiAgZ2V0OiB7fSxcbiAgY291bnQ6IHt9LFxuICBjcmVhdGU6IHt9LFxuICB1cGRhdGU6IHt9LFxuICBkZWxldGU6IHt9LFxuICBhZGRGaWVsZDoge30sXG4gIHByb3RlY3RlZEZpZWxkczoge30sXG59KTtcblxuY29uc3QgZGVmYXVsdENMUFMgPSBPYmplY3QuZnJlZXplKHtcbiAgQUNMOiB7XG4gICAgJyonOiB7XG4gICAgICByZWFkOiB0cnVlLFxuICAgICAgd3JpdGU6IHRydWUsXG4gICAgfSxcbiAgfSxcbiAgZmluZDogeyAnKic6IHRydWUgfSxcbiAgZ2V0OiB7ICcqJzogdHJ1ZSB9LFxuICBjb3VudDogeyAnKic6IHRydWUgfSxcbiAgY3JlYXRlOiB7ICcqJzogdHJ1ZSB9LFxuICB1cGRhdGU6IHsgJyonOiB0cnVlIH0sXG4gIGRlbGV0ZTogeyAnKic6IHRydWUgfSxcbiAgYWRkRmllbGQ6IHsgJyonOiB0cnVlIH0sXG4gIHByb3RlY3RlZEZpZWxkczogeyAnKic6IFtdIH0sXG59KTtcblxuY29uc3QgdG9QYXJzZVNjaGVtYSA9IHNjaGVtYSA9PiB7XG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZDtcbiAgfVxuICBpZiAoc2NoZW1hLmZpZWxkcykge1xuICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl93cGVybTtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fcnBlcm07XG4gIH1cbiAgbGV0IGNscHMgPSBkZWZhdWx0Q0xQUztcbiAgaWYgKHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnMpIHtcbiAgICBjbHBzID0geyAuLi5lbXB0eUNMUFMsIC4uLnNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnMgfTtcbiAgfVxuICBsZXQgaW5kZXhlcyA9IHt9O1xuICBpZiAoc2NoZW1hLmluZGV4ZXMpIHtcbiAgICBpbmRleGVzID0geyAuLi5zY2hlbWEuaW5kZXhlcyB9O1xuICB9XG4gIHJldHVybiB7XG4gICAgY2xhc3NOYW1lOiBzY2hlbWEuY2xhc3NOYW1lLFxuICAgIGZpZWxkczogc2NoZW1hLmZpZWxkcyxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGNscHMsXG4gICAgaW5kZXhlcyxcbiAgfTtcbn07XG5cbmNvbnN0IHRvUG9zdGdyZXNTY2hlbWEgPSBzY2hlbWEgPT4ge1xuICBpZiAoIXNjaGVtYSkge1xuICAgIHJldHVybiBzY2hlbWE7XG4gIH1cbiAgc2NoZW1hLmZpZWxkcyA9IHNjaGVtYS5maWVsZHMgfHwge307XG4gIHNjaGVtYS5maWVsZHMuX3dwZXJtID0geyB0eXBlOiAnQXJyYXknLCBjb250ZW50czogeyB0eXBlOiAnU3RyaW5nJyB9IH07XG4gIHNjaGVtYS5maWVsZHMuX3JwZXJtID0geyB0eXBlOiAnQXJyYXknLCBjb250ZW50czogeyB0eXBlOiAnU3RyaW5nJyB9IH07XG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICAgIHNjaGVtYS5maWVsZHMuX3Bhc3N3b3JkX2hpc3RvcnkgPSB7IHR5cGU6ICdBcnJheScgfTtcbiAgfVxuICByZXR1cm4gc2NoZW1hO1xufTtcblxuY29uc3QgaXNBcnJheUluZGV4ID0gKGFycmF5SW5kZXgpID0+IEFycmF5LmZyb20oYXJyYXlJbmRleCkuZXZlcnkoYyA9PiBjID49ICcwJyAmJiBjIDw9ICc5Jyk7XG5cbmNvbnN0IGhhbmRsZURvdEZpZWxkcyA9IG9iamVjdCA9PiB7XG4gIE9iamVjdC5rZXlzKG9iamVjdCkuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID4gLTEpIHtcbiAgICAgIGNvbnN0IGNvbXBvbmVudHMgPSBmaWVsZE5hbWUuc3BsaXQoJy4nKTtcbiAgICAgIGNvbnN0IGZpcnN0ID0gY29tcG9uZW50cy5zaGlmdCgpO1xuICAgICAgb2JqZWN0W2ZpcnN0XSA9IG9iamVjdFtmaXJzdF0gfHwge307XG4gICAgICBsZXQgY3VycmVudE9iaiA9IG9iamVjdFtmaXJzdF07XG4gICAgICBsZXQgbmV4dDtcbiAgICAgIGxldCB2YWx1ZSA9IG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgaWYgKHZhbHVlICYmIHZhbHVlLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgIHZhbHVlID0gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgICAgd2hpbGUgKChuZXh0ID0gY29tcG9uZW50cy5zaGlmdCgpKSkge1xuICAgICAgICBjdXJyZW50T2JqW25leHRdID0gY3VycmVudE9ialtuZXh0XSB8fCB7fTtcbiAgICAgICAgaWYgKGNvbXBvbmVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgY3VycmVudE9ialtuZXh0XSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICAgIGN1cnJlbnRPYmogPSBjdXJyZW50T2JqW25leHRdO1xuICAgICAgfVxuICAgICAgZGVsZXRlIG9iamVjdFtmaWVsZE5hbWVdO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBvYmplY3Q7XG59O1xuXG5jb25zdCBlc2NhcGVTcWxTdHJpbmcgPSB2YWx1ZSA9PiB2YWx1ZS5yZXBsYWNlKC8nL2csIFwiJydcIik7XG5jb25zdCBlc2NhcGVKc29uU3RyaW5nID0gdmFsdWUgPT4gSlNPTi5zdHJpbmdpZnkodmFsdWUpLnNsaWNlKDEsIC0xKTtcblxuY29uc3QgdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMgPSBmaWVsZE5hbWUgPT4ge1xuICByZXR1cm4gZmllbGROYW1lLnNwbGl0KCcuJykubWFwKChjbXB0LCBpbmRleCkgPT4ge1xuICAgIGlmIChpbmRleCA9PT0gMCkge1xuICAgICAgcmV0dXJuIGBcIiR7Y21wdC5yZXBsYWNlKC9cIi9nLCAnXCJcIicpfVwiYDtcbiAgICB9XG4gICAgaWYgKGlzQXJyYXlJbmRleChjbXB0KSkge1xuICAgICAgcmV0dXJuIE51bWJlcihjbXB0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGAnJHtlc2NhcGVTcWxTdHJpbmcoY21wdCl9J2A7XG4gICAgfVxuICB9KTtcbn07XG5cbmNvbnN0IHRyYW5zZm9ybURvdEZpZWxkID0gZmllbGROYW1lID0+IHtcbiAgaWYgKGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPT09IC0xKSB7XG4gICAgcmV0dXJuIGBcIiR7ZmllbGROYW1lLnJlcGxhY2UoL1wiL2csICdcIlwiJyl9XCJgO1xuICB9XG4gIGNvbnN0IGNvbXBvbmVudHMgPSB0cmFuc2Zvcm1Eb3RGaWVsZFRvQ29tcG9uZW50cyhmaWVsZE5hbWUpO1xuICBsZXQgbmFtZSA9IGNvbXBvbmVudHMuc2xpY2UoMCwgY29tcG9uZW50cy5sZW5ndGggLSAxKS5qb2luKCctPicpO1xuICBuYW1lICs9ICctPj4nICsgY29tcG9uZW50c1tjb21wb25lbnRzLmxlbmd0aCAtIDFdO1xuICByZXR1cm4gbmFtZTtcbn07XG5cbmNvbnN0IHZhbGlkYXRlQWdncmVnYXRlRmllbGROYW1lID0gbmFtZSA9PiB7XG4gIGlmICh0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycgfHwgIW5hbWUubWF0Y2goL15bYS16QS1aXVthLXpBLVowLTlfXSokLykpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgYEludmFsaWQgZmllbGQgbmFtZTogJHtuYW1lfWApO1xuICB9XG59O1xuXG5jb25zdCB0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCA9IGZpZWxkTmFtZSA9PiB7XG4gIGlmICh0eXBlb2YgZmllbGROYW1lICE9PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBmaWVsZE5hbWU7XG4gIH1cbiAgaWYgKGZpZWxkTmFtZSA9PT0gJyRfY3JlYXRlZF9hdCcpIHtcbiAgICByZXR1cm4gJ2NyZWF0ZWRBdCc7XG4gIH1cbiAgaWYgKGZpZWxkTmFtZSA9PT0gJyRfdXBkYXRlZF9hdCcpIHtcbiAgICByZXR1cm4gJ3VwZGF0ZWRBdCc7XG4gIH1cbiAgaWYgKCFmaWVsZE5hbWUuc3RhcnRzV2l0aCgnJCcpKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsIGBJbnZhbGlkIGZpZWxkIG5hbWU6ICR7ZmllbGROYW1lfWApO1xuICB9XG4gIGNvbnN0IG5hbWUgPSBmaWVsZE5hbWUuc3Vic3RyaW5nKDEpO1xuICB2YWxpZGF0ZUFnZ3JlZ2F0ZUZpZWxkTmFtZShuYW1lKTtcbiAgcmV0dXJuIG5hbWU7XG59O1xuXG5jb25zdCB2YWxpZGF0ZUtleXMgPSBvYmplY3QgPT4ge1xuICBpZiAodHlwZW9mIG9iamVjdCA9PSAnb2JqZWN0Jykge1xuICAgIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xuICAgICAgaWYgKHR5cGVvZiBvYmplY3Rba2V5XSA9PSAnb2JqZWN0Jykge1xuICAgICAgICB2YWxpZGF0ZUtleXMob2JqZWN0W2tleV0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoa2V5LmluY2x1ZGVzKCckJykgfHwga2V5LmluY2x1ZGVzKCcuJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfTkVTVEVEX0tFWSxcbiAgICAgICAgICBcIk5lc3RlZCBrZXlzIHNob3VsZCBub3QgY29udGFpbiB0aGUgJyQnIG9yICcuJyBjaGFyYWN0ZXJzXCJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbi8vIFJldHVybnMgdGhlIGxpc3Qgb2Ygam9pbiB0YWJsZXMgb24gYSBzY2hlbWFcbmNvbnN0IGpvaW5UYWJsZXNGb3JTY2hlbWEgPSBzY2hlbWEgPT4ge1xuICBjb25zdCBsaXN0ID0gW107XG4gIGlmIChzY2hlbWEpIHtcbiAgICBPYmplY3Qua2V5cyhzY2hlbWEuZmllbGRzKS5mb3JFYWNoKGZpZWxkID0+IHtcbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIGxpc3QucHVzaChgX0pvaW46JHtmaWVsZH06JHtzY2hlbWEuY2xhc3NOYW1lfWApO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG4gIHJldHVybiBsaXN0O1xufTtcblxuaW50ZXJmYWNlIFdoZXJlQ2xhdXNlIHtcbiAgcGF0dGVybjogc3RyaW5nO1xuICB2YWx1ZXM6IEFycmF5PGFueT47XG4gIHNvcnRzOiBBcnJheTxhbnk+O1xufVxuXG5jb25zdCBidWlsZFdoZXJlQ2xhdXNlID0gKHsgc2NoZW1hLCBxdWVyeSwgaW5kZXgsIGNhc2VJbnNlbnNpdGl2ZSB9KTogV2hlcmVDbGF1c2UgPT4ge1xuICBjb25zdCBwYXR0ZXJucyA9IFtdO1xuICBsZXQgdmFsdWVzID0gW107XG4gIGNvbnN0IHNvcnRzID0gW107XG5cbiAgc2NoZW1hID0gdG9Qb3N0Z3Jlc1NjaGVtYShzY2hlbWEpO1xuICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBxdWVyeSkge1xuICAgIGNvbnN0IGlzQXJyYXlGaWVsZCA9XG4gICAgICBzY2hlbWEuZmllbGRzICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0FycmF5JztcbiAgICBjb25zdCBpbml0aWFsUGF0dGVybnNMZW5ndGggPSBwYXR0ZXJucy5sZW5ndGg7XG4gICAgY29uc3QgZmllbGRWYWx1ZSA9IHF1ZXJ5W2ZpZWxkTmFtZV07XG5cbiAgICAvLyBub3RoaW5nIGluIHRoZSBzY2hlbWEsIGl0J3MgZ29ubmEgYmxvdyB1cFxuICAgIGlmICghc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdKSB7XG4gICAgICAvLyBhcyBpdCB3b24ndCBleGlzdFxuICAgICAgaWYgKGZpZWxkVmFsdWUgJiYgZmllbGRWYWx1ZS4kZXhpc3RzID09PSBmYWxzZSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgYXV0aERhdGFNYXRjaCA9IGZpZWxkTmFtZS5tYXRjaCgvXl9hdXRoX2RhdGFfKFthLXpBLVowLTlfXSspJC8pO1xuICAgIGlmIChhdXRoRGF0YU1hdGNoKSB7XG4gICAgICAvLyBUT0RPOiBIYW5kbGUgcXVlcnlpbmcgYnkgX2F1dGhfZGF0YV9wcm92aWRlciwgYXV0aERhdGEgaXMgc3RvcmVkIGluIGF1dGhEYXRhIGZpZWxkXG4gICAgICBjb250aW51ZTtcbiAgICB9IGVsc2UgaWYgKGNhc2VJbnNlbnNpdGl2ZSAmJiAoZmllbGROYW1lID09PSAndXNlcm5hbWUnIHx8IGZpZWxkTmFtZSA9PT0gJ2VtYWlsJykpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goYExPV0VSKCQke2luZGV4fTpuYW1lKSA9IExPV0VSKCQke2luZGV4ICsgMX0pYCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9IGVsc2UgaWYgKGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPj0gMCkge1xuICAgICAgbGV0IG5hbWUgPSB0cmFuc2Zvcm1Eb3RGaWVsZChmaWVsZE5hbWUpO1xuICAgICAgaWYgKGZpZWxkVmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9OnJhdyBJUyBOVUxMYCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKG5hbWUpO1xuICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChmaWVsZFZhbHVlLiRpbikge1xuICAgICAgICAgIG5hbWUgPSB0cmFuc2Zvcm1Eb3RGaWVsZFRvQ29tcG9uZW50cyhmaWVsZE5hbWUpLmpvaW4oJy0+Jyk7XG4gICAgICAgICAgcGF0dGVybnMucHVzaChgKCQke2luZGV4fTpyYXcpOjpqc29uYiBAPiAkJHtpbmRleCArIDF9Ojpqc29uYmApO1xuICAgICAgICAgIHZhbHVlcy5wdXNoKG5hbWUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUuJGluKSk7XG4gICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLiRyZWdleCkge1xuICAgICAgICAgIC8vIEhhbmRsZSBsYXRlclxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpyYXcgPSAkJHtpbmRleCArIDF9Ojp0ZXh0YCk7XG4gICAgICAgICAgdmFsdWVzLnB1c2gobmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgICB0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICAgICAgICAhT2JqZWN0LmtleXMoZmllbGRWYWx1ZSkuc29tZShrZXkgPT4ga2V5LnN0YXJ0c1dpdGgoJyQnKSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgbmFtZSA9IHRyYW5zZm9ybURvdEZpZWxkVG9Db21wb25lbnRzKGZpZWxkTmFtZSkuam9pbignLT4nKTtcbiAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAoJCR7aW5kZXh9OnJhdyk6Ompzb25iID0gJCR7aW5kZXggKyAxfTo6anNvbmJgKTtcbiAgICAgICAgICB2YWx1ZXMucHVzaChuYW1lLCBKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlKSk7XG4gICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCB8fCBmaWVsZFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIElTIE5VTExgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgIC8vIENhbid0IGNhc3QgYm9vbGVhbiB0byBkb3VibGUgcHJlY2lzaW9uXG4gICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnTnVtYmVyJykge1xuICAgICAgICAvLyBTaG91bGQgYWx3YXlzIHJldHVybiB6ZXJvIHJlc3VsdHNcbiAgICAgICAgY29uc3QgTUFYX0lOVF9QTFVTX09ORSA9IDkyMjMzNzIwMzY4NTQ3NzU4MDg7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgTUFYX0lOVF9QTFVTX09ORSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgfVxuICAgICAgaW5kZXggKz0gMjtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnbnVtYmVyJykge1xuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9IGVsc2UgaWYgKFsnJG9yJywgJyRub3InLCAnJGFuZCddLmluY2x1ZGVzKGZpZWxkTmFtZSkpIHtcbiAgICAgIGNvbnN0IGNsYXVzZXMgPSBbXTtcbiAgICAgIGNvbnN0IGNsYXVzZVZhbHVlcyA9IFtdO1xuICAgICAgZmllbGRWYWx1ZS5mb3JFYWNoKHN1YlF1ZXJ5ID0+IHtcbiAgICAgICAgY29uc3QgY2xhdXNlID0gYnVpbGRXaGVyZUNsYXVzZSh7XG4gICAgICAgICAgc2NoZW1hLFxuICAgICAgICAgIHF1ZXJ5OiBzdWJRdWVyeSxcbiAgICAgICAgICBpbmRleCxcbiAgICAgICAgICBjYXNlSW5zZW5zaXRpdmUsXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoY2xhdXNlLnBhdHRlcm4ubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNsYXVzZXMucHVzaChjbGF1c2UucGF0dGVybik7XG4gICAgICAgICAgY2xhdXNlVmFsdWVzLnB1c2goLi4uY2xhdXNlLnZhbHVlcyk7XG4gICAgICAgICAgaW5kZXggKz0gY2xhdXNlLnZhbHVlcy5sZW5ndGg7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBvck9yQW5kID0gZmllbGROYW1lID09PSAnJGFuZCcgPyAnIEFORCAnIDogJyBPUiAnO1xuICAgICAgY29uc3Qgbm90ID0gZmllbGROYW1lID09PSAnJG5vcicgPyAnIE5PVCAnIDogJyc7XG5cbiAgICAgIHBhdHRlcm5zLnB1c2goYCR7bm90fSgke2NsYXVzZXMuam9pbihvck9yQW5kKX0pYCk7XG4gICAgICB2YWx1ZXMucHVzaCguLi5jbGF1c2VWYWx1ZXMpO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRuZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoaXNBcnJheUZpZWxkKSB7XG4gICAgICAgIGZpZWxkVmFsdWUuJG5lID0gSlNPTi5zdHJpbmdpZnkoW2ZpZWxkVmFsdWUuJG5lXSk7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYE5PVCBhcnJheV9jb250YWlucygkJHtpbmRleH06bmFtZSwgJCR7aW5kZXggKyAxfSlgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChmaWVsZFZhbHVlLiRuZSA9PT0gbnVsbCkge1xuICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIElTIE5PVCBOVUxMYCk7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIGlmIG5vdCBudWxsLCB3ZSBuZWVkIHRvIG1hbnVhbGx5IGV4Y2x1ZGUgbnVsbFxuICAgICAgICAgIGlmIChmaWVsZFZhbHVlLiRuZS5fX3R5cGUgPT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgICAgIGAoJCR7aW5kZXh9Om5hbWUgPD4gUE9JTlQoJCR7aW5kZXggKyAxfSwgJCR7aW5kZXggKyAyfSkgT1IgJCR7aW5kZXh9Om5hbWUgSVMgTlVMTClgXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+PSAwKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGNhc3RUeXBlID0gdG9Qb3N0Z3Jlc1ZhbHVlQ2FzdFR5cGUoZmllbGRWYWx1ZS4kbmUpO1xuICAgICAgICAgICAgICBjb25zdCBjb25zdHJhaW50RmllbGROYW1lID0gY2FzdFR5cGVcbiAgICAgICAgICAgICAgICA/IGBDQVNUICgoJHt0cmFuc2Zvcm1Eb3RGaWVsZChmaWVsZE5hbWUpfSkgQVMgJHtjYXN0VHlwZX0pYFxuICAgICAgICAgICAgICAgIDogdHJhbnNmb3JtRG90RmllbGQoZmllbGROYW1lKTtcbiAgICAgICAgICAgICAgcGF0dGVybnMucHVzaChcbiAgICAgICAgICAgICAgICBgKCR7Y29uc3RyYWludEZpZWxkTmFtZX0gPD4gJCR7aW5kZXggKyAxfSBPUiAke2NvbnN0cmFpbnRGaWVsZE5hbWV9IElTIE5VTEwpYFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZS4kbmUgPT09ICdvYmplY3QnICYmIGZpZWxkVmFsdWUuJG5lLiRyZWxhdGl2ZVRpbWUpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgICAnJHJlbGF0aXZlVGltZSBjYW4gb25seSBiZSB1c2VkIHdpdGggdGhlICRsdCwgJGx0ZSwgJGd0LCBhbmQgJGd0ZSBvcGVyYXRvcnMnXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAoJCR7aW5kZXh9Om5hbWUgPD4gJCR7aW5kZXggKyAxfSBPUiAkJHtpbmRleH06bmFtZSBJUyBOVUxMKWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGZpZWxkVmFsdWUuJG5lLl9fdHlwZSA9PT0gJ0dlb1BvaW50Jykge1xuICAgICAgICBjb25zdCBwb2ludCA9IGZpZWxkVmFsdWUuJG5lO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHBvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGUpO1xuICAgICAgICBpbmRleCArPSAzO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVE9ETzogc3VwcG9ydCBhcnJheXNcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLiRuZSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChmaWVsZFZhbHVlLiRlcSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoZmllbGRWYWx1ZS4kZXEgPT09IG51bGwpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgSVMgTlVMTGApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICBpbmRleCArPSAxO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPj0gMCkge1xuICAgICAgICAgIGNvbnN0IGNhc3RUeXBlID0gdG9Qb3N0Z3Jlc1ZhbHVlQ2FzdFR5cGUoZmllbGRWYWx1ZS4kZXEpO1xuICAgICAgICAgIGNvbnN0IGNvbnN0cmFpbnRGaWVsZE5hbWUgPSBjYXN0VHlwZVxuICAgICAgICAgICAgPyBgQ0FTVCAoKCR7dHJhbnNmb3JtRG90RmllbGQoZmllbGROYW1lKX0pIEFTICR7Y2FzdFR5cGV9KWBcbiAgICAgICAgICAgIDogdHJhbnNmb3JtRG90RmllbGQoZmllbGROYW1lKTtcbiAgICAgICAgICB2YWx1ZXMucHVzaChmaWVsZFZhbHVlLiRlcSk7XG4gICAgICAgICAgcGF0dGVybnMucHVzaChgJHtjb25zdHJhaW50RmllbGROYW1lfSA9ICQke2luZGV4Kyt9YCk7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpZWxkVmFsdWUuJGVxID09PSAnb2JqZWN0JyAmJiBmaWVsZFZhbHVlLiRlcS4kcmVsYXRpdmVUaW1lKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJyRyZWxhdGl2ZVRpbWUgY2FuIG9ubHkgYmUgdXNlZCB3aXRoIHRoZSAkbHQsICRsdGUsICRndCwgYW5kICRndGUgb3BlcmF0b3JzJ1xuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLiRlcSk7XG4gICAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBpc0luT3JOaW4gPSBBcnJheS5pc0FycmF5KGZpZWxkVmFsdWUuJGluKSB8fCBBcnJheS5pc0FycmF5KGZpZWxkVmFsdWUuJG5pbik7XG4gICAgaWYgKFxuICAgICAgQXJyYXkuaXNBcnJheShmaWVsZFZhbHVlLiRpbikgJiZcbiAgICAgIGlzQXJyYXlGaWVsZCAmJlxuICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLmNvbnRlbnRzICYmXG4gICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0uY29udGVudHMudHlwZSA9PT0gJ1N0cmluZydcbiAgICApIHtcbiAgICAgIGNvbnN0IGluUGF0dGVybnMgPSBbXTtcbiAgICAgIGxldCBhbGxvd051bGwgPSBmYWxzZTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBmaWVsZFZhbHVlLiRpbi5mb3JFYWNoKChsaXN0RWxlbSwgbGlzdEluZGV4KSA9PiB7XG4gICAgICAgIGlmIChsaXN0RWxlbSA9PT0gbnVsbCkge1xuICAgICAgICAgIGFsbG93TnVsbCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFsdWVzLnB1c2gobGlzdEVsZW0pO1xuICAgICAgICAgIGluUGF0dGVybnMucHVzaChgJCR7aW5kZXggKyAxICsgbGlzdEluZGV4IC0gKGFsbG93TnVsbCA/IDEgOiAwKX1gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBpZiAoYWxsb3dOdWxsKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCgkJHtpbmRleH06bmFtZSBJUyBOVUxMIE9SICQke2luZGV4fTpuYW1lICYmIEFSUkFZWyR7aW5QYXR0ZXJucy5qb2luKCl9XSlgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lICYmIEFSUkFZWyR7aW5QYXR0ZXJucy5qb2luKCl9XWApO1xuICAgICAgfVxuICAgICAgaW5kZXggPSBpbmRleCArIDEgKyBpblBhdHRlcm5zLmxlbmd0aDtcbiAgICB9IGVsc2UgaWYgKGlzSW5Pck5pbikge1xuICAgICAgdmFyIGNyZWF0ZUNvbnN0cmFpbnQgPSAoYmFzZUFycmF5LCBub3RJbikgPT4ge1xuICAgICAgICBjb25zdCBub3QgPSBub3RJbiA/ICcgTk9UICcgOiAnJztcbiAgICAgICAgaWYgKGJhc2VBcnJheS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgaWYgKGlzQXJyYXlGaWVsZCkge1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJHtub3R9IGFycmF5X2NvbnRhaW5zKCQke2luZGV4fTpuYW1lLCAkJHtpbmRleCArIDF9KWApO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShiYXNlQXJyYXkpKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEhhbmRsZSBOZXN0ZWQgRG90IE5vdGF0aW9uIEFib3ZlXG4gICAgICAgICAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+PSAwKSB7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGZpZWxkVHlwZSA9IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXT8udHlwZTtcbiAgICAgICAgICAgIGlmIChmaWVsZFR5cGUgPT09ICdTdHJpbmcnKSB7XG4gICAgICAgICAgICAgIGNvbnN0IG9wZXJhdG9yTmFtZSA9IG5vdEluID8gJyRuaW4nIDogJyRpbic7XG4gICAgICAgICAgICAgIGZvciAoY29uc3QgZWxlbSBvZiBiYXNlQXJyYXkpIHtcbiAgICAgICAgICAgICAgICBpZiAoZWxlbSAhPSBudWxsICYmIHR5cGVvZiBlbGVtICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgICAgICAgICAgICAgICBgJHtvcGVyYXRvck5hbWV9IGVsZW1lbnQgdHlwZSBtaXNtYXRjaDogZXhwZWN0ZWQgc3RyaW5nIGZvciBmaWVsZCBcIiR7ZmllbGROYW1lfVwiYFxuICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGluUGF0dGVybnMgPSBbXTtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgICBiYXNlQXJyYXkuZm9yRWFjaCgobGlzdEVsZW0sIGxpc3RJbmRleCkgPT4ge1xuICAgICAgICAgICAgICBpZiAobGlzdEVsZW0gIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKGxpc3RFbGVtKTtcbiAgICAgICAgICAgICAgICBpblBhdHRlcm5zLnB1c2goYCQke2luZGV4ICsgMSArIGxpc3RJbmRleH1gKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSAke25vdH0gSU4gKCR7aW5QYXR0ZXJucy5qb2luKCl9KWApO1xuICAgICAgICAgICAgaW5kZXggPSBpbmRleCArIDEgKyBpblBhdHRlcm5zLmxlbmd0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoIW5vdEluKSB7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOVUxMYCk7XG4gICAgICAgICAgaW5kZXggPSBpbmRleCArIDE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gSGFuZGxlIGVtcHR5IGFycmF5XG4gICAgICAgICAgaWYgKG5vdEluKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKCcxID0gMScpOyAvLyBSZXR1cm4gYWxsIHZhbHVlc1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKCcxID0gMicpOyAvLyBSZXR1cm4gbm8gdmFsdWVzXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgaWYgKGZpZWxkVmFsdWUuJGluKSB7XG4gICAgICAgIGNyZWF0ZUNvbnN0cmFpbnQoXG4gICAgICAgICAgXy5mbGF0TWFwKGZpZWxkVmFsdWUuJGluLCBlbHQgPT4gZWx0KSxcbiAgICAgICAgICBmYWxzZVxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKGZpZWxkVmFsdWUuJG5pbikge1xuICAgICAgICBjcmVhdGVDb25zdHJhaW50KFxuICAgICAgICAgIF8uZmxhdE1hcChmaWVsZFZhbHVlLiRuaW4sIGVsdCA9PiBlbHQpLFxuICAgICAgICAgIHRydWVcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlLiRpbiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgJGluIHZhbHVlJyk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZS4kbmluICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCAkbmluIHZhbHVlJyk7XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZS4kYWxsKSAmJiBpc0FycmF5RmllbGQpIHtcbiAgICAgIGlmIChpc0FueVZhbHVlUmVnZXhTdGFydHNXaXRoKGZpZWxkVmFsdWUuJGFsbCkpIHtcbiAgICAgICAgaWYgKCFpc0FsbFZhbHVlc1JlZ2V4T3JOb25lKGZpZWxkVmFsdWUuJGFsbCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAnQWxsICRhbGwgdmFsdWVzIG11c3QgYmUgb2YgcmVnZXggdHlwZSBvciBub25lOiAnICsgZmllbGRWYWx1ZS4kYWxsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZmllbGRWYWx1ZS4kYWxsLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBwcm9jZXNzUmVnZXhQYXR0ZXJuKGZpZWxkVmFsdWUuJGFsbFtpXS4kcmVnZXgpO1xuICAgICAgICAgIGZpZWxkVmFsdWUuJGFsbFtpXSA9IHZhbHVlLnN1YnN0cmluZygxKSArICclJztcbiAgICAgICAgfVxuICAgICAgICBwYXR0ZXJucy5wdXNoKGBhcnJheV9jb250YWluc19hbGxfcmVnZXgoJCR7aW5kZXh9Om5hbWUsICQke2luZGV4ICsgMX06Ompzb25iKWApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgYXJyYXlfY29udGFpbnNfYWxsKCQke2luZGV4fTpuYW1lLCAkJHtpbmRleCArIDF9Ojpqc29uYilgKTtcbiAgICAgIH1cbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgSlNPTi5zdHJpbmdpZnkoZmllbGRWYWx1ZS4kYWxsKSk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShmaWVsZFZhbHVlLiRhbGwpKSB7XG4gICAgICBpZiAoZmllbGRWYWx1ZS4kYWxsLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLiRhbGxbMF0ub2JqZWN0SWQpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZmllbGRWYWx1ZS4kZXhpc3RzICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgaWYgKHR5cGVvZiBmaWVsZFZhbHVlLiRleGlzdHMgPT09ICdvYmplY3QnICYmIGZpZWxkVmFsdWUuJGV4aXN0cy4kcmVsYXRpdmVUaW1lKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJyRyZWxhdGl2ZVRpbWUgY2FuIG9ubHkgYmUgdXNlZCB3aXRoIHRoZSAkbHQsICRsdGUsICRndCwgYW5kICRndGUgb3BlcmF0b3JzJ1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLiRleGlzdHMpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgSVMgTk9UIE5VTExgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIElTIE5VTExgKTtcbiAgICAgIH1cbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBpbmRleCArPSAxO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRjb250YWluZWRCeSkge1xuICAgICAgY29uc3QgYXJyID0gZmllbGRWYWx1ZS4kY29udGFpbmVkQnk7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkoYXJyKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgYmFkICRjb250YWluZWRCeTogc2hvdWxkIGJlIGFuIGFycmF5YCk7XG4gICAgICB9XG5cbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIDxAICQke2luZGV4ICsgMX06Ompzb25iYCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGFycikpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kdGV4dCkge1xuICAgICAgY29uc3Qgc2VhcmNoID0gZmllbGRWYWx1ZS4kdGV4dC4kc2VhcmNoO1xuICAgICAgbGV0IGxhbmd1YWdlID0gJ2VuZ2xpc2gnO1xuICAgICAgaWYgKHR5cGVvZiBzZWFyY2ggIT09ICdvYmplY3QnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGBiYWQgJHRleHQ6ICRzZWFyY2gsIHNob3VsZCBiZSBvYmplY3RgKTtcbiAgICAgIH1cbiAgICAgIGlmICghc2VhcmNoLiR0ZXJtIHx8IHR5cGVvZiBzZWFyY2guJHRlcm0gIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGBiYWQgJHRleHQ6ICR0ZXJtLCBzaG91bGQgYmUgc3RyaW5nYCk7XG4gICAgICB9XG4gICAgICBpZiAoc2VhcmNoLiRsYW5ndWFnZSAmJiB0eXBlb2Ygc2VhcmNoLiRsYW5ndWFnZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYGJhZCAkdGV4dDogJGxhbmd1YWdlLCBzaG91bGQgYmUgc3RyaW5nYCk7XG4gICAgICB9IGVsc2UgaWYgKHNlYXJjaC4kbGFuZ3VhZ2UpIHtcbiAgICAgICAgbGFuZ3VhZ2UgPSBzZWFyY2guJGxhbmd1YWdlO1xuICAgICAgfVxuICAgICAgaWYgKHNlYXJjaC4kY2FzZVNlbnNpdGl2ZSAmJiB0eXBlb2Ygc2VhcmNoLiRjYXNlU2Vuc2l0aXZlICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICR0ZXh0OiAkY2FzZVNlbnNpdGl2ZSwgc2hvdWxkIGJlIGJvb2xlYW5gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2UgaWYgKHNlYXJjaC4kY2FzZVNlbnNpdGl2ZSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRjYXNlU2Vuc2l0aXZlIG5vdCBzdXBwb3J0ZWQsIHBsZWFzZSB1c2UgJHJlZ2V4IG9yIGNyZWF0ZSBhIHNlcGFyYXRlIGxvd2VyIGNhc2UgY29sdW1uLmBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGlmIChzZWFyY2guJGRpYWNyaXRpY1NlbnNpdGl2ZSAmJiB0eXBlb2Ygc2VhcmNoLiRkaWFjcml0aWNTZW5zaXRpdmUgIT09ICdib29sZWFuJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRkaWFjcml0aWNTZW5zaXRpdmUsIHNob3VsZCBiZSBib29sZWFuYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChzZWFyY2guJGRpYWNyaXRpY1NlbnNpdGl2ZSA9PT0gZmFsc2UpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICR0ZXh0OiAkZGlhY3JpdGljU2Vuc2l0aXZlIC0gZmFsc2Ugbm90IHN1cHBvcnRlZCwgaW5zdGFsbCBQb3N0Z3JlcyBVbmFjY2VudCBFeHRlbnNpb25gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBwYXR0ZXJucy5wdXNoKFxuICAgICAgICBgdG9fdHN2ZWN0b3IoJCR7aW5kZXh9LCAkJHtpbmRleCArIDF9Om5hbWUpIEBAIHRvX3RzcXVlcnkoJCR7aW5kZXggKyAyfSwgJCR7aW5kZXggKyAzfSlgXG4gICAgICApO1xuICAgICAgdmFsdWVzLnB1c2gobGFuZ3VhZ2UsIGZpZWxkTmFtZSwgbGFuZ3VhZ2UsIHNlYXJjaC4kdGVybSk7XG4gICAgICBpbmRleCArPSA0O1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRuZWFyU3BoZXJlKSB7XG4gICAgICBjb25zdCBwb2ludCA9IGZpZWxkVmFsdWUuJG5lYXJTcGhlcmU7XG4gICAgICBjb25zdCBkaXN0YW5jZSA9IGZpZWxkVmFsdWUuJG1heERpc3RhbmNlO1xuICAgICAgY29uc3QgZGlzdGFuY2VJbktNID0gZGlzdGFuY2UgKiA2MzcxICogMTAwMDtcbiAgICAgIHBhdHRlcm5zLnB1c2goXG4gICAgICAgIGBTVF9EaXN0YW5jZVNwaGVyZSgkJHtpbmRleH06bmFtZTo6Z2VvbWV0cnksIFBPSU5UKCQke2luZGV4ICsgMX0sICQke2luZGV4ICsgMlxuICAgICAgICB9KTo6Z2VvbWV0cnkpIDw9ICQke2luZGV4ICsgM31gXG4gICAgICApO1xuICAgICAgc29ydHMucHVzaChcbiAgICAgICAgYFNUX0Rpc3RhbmNlU3BoZXJlKCQke2luZGV4fTpuYW1lOjpnZW9tZXRyeSwgUE9JTlQoJCR7aW5kZXggKyAxfSwgJCR7aW5kZXggKyAyXG4gICAgICAgIH0pOjpnZW9tZXRyeSkgQVNDYFxuICAgICAgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgcG9pbnQubG9uZ2l0dWRlLCBwb2ludC5sYXRpdHVkZSwgZGlzdGFuY2VJbktNKTtcbiAgICAgIGluZGV4ICs9IDQ7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuJHdpdGhpbiAmJiBmaWVsZFZhbHVlLiR3aXRoaW4uJGJveCkge1xuICAgICAgY29uc3QgYm94ID0gZmllbGRWYWx1ZS4kd2l0aGluLiRib3g7XG4gICAgICBjb25zdCBsZWZ0ID0gYm94WzBdLmxvbmdpdHVkZTtcbiAgICAgIGNvbnN0IGJvdHRvbSA9IGJveFswXS5sYXRpdHVkZTtcbiAgICAgIGNvbnN0IHJpZ2h0ID0gYm94WzFdLmxvbmdpdHVkZTtcbiAgICAgIGNvbnN0IHRvcCA9IGJveFsxXS5sYXRpdHVkZTtcblxuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWU6OnBvaW50IDxAICQke2luZGV4ICsgMX06OmJveGApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBgKCgke2xlZnR9LCAke2JvdHRvbX0pLCAoJHtyaWdodH0sICR7dG9wfSkpYCk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRnZW9XaXRoaW4gJiYgZmllbGRWYWx1ZS4kZ2VvV2l0aGluLiRjZW50ZXJTcGhlcmUpIHtcbiAgICAgIGNvbnN0IGNlbnRlclNwaGVyZSA9IGZpZWxkVmFsdWUuJGdlb1dpdGhpbi4kY2VudGVyU3BoZXJlO1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGNlbnRlclNwaGVyZSkgfHwgY2VudGVyU3BoZXJlLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgc2hvdWxkIGJlIGFuIGFycmF5IG9mIFBhcnNlLkdlb1BvaW50IGFuZCBkaXN0YW5jZSdcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIEdldCBwb2ludCwgY29udmVydCB0byBnZW8gcG9pbnQgaWYgbmVjZXNzYXJ5IGFuZCB2YWxpZGF0ZVxuICAgICAgbGV0IHBvaW50ID0gY2VudGVyU3BoZXJlWzBdO1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocG9pbnQpICYmIHBvaW50Lmxlbmd0aCA9PT0gMikge1xuICAgICAgICBwb2ludCA9IG5ldyBQYXJzZS5HZW9Qb2ludChwb2ludFsxXSwgcG9pbnRbMF0pO1xuICAgICAgfSBlbHNlIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkSlNPTihwb2ludCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgZ2VvIHBvaW50IGludmFsaWQnXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAvLyBHZXQgZGlzdGFuY2UgYW5kIHZhbGlkYXRlXG4gICAgICBjb25zdCBkaXN0YW5jZSA9IGNlbnRlclNwaGVyZVsxXTtcbiAgICAgIGlmIChpc05hTihkaXN0YW5jZSkgfHwgZGlzdGFuY2UgPCAwKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkY2VudGVyU3BoZXJlIGRpc3RhbmNlIGludmFsaWQnXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBjb25zdCBkaXN0YW5jZUluS00gPSBkaXN0YW5jZSAqIDYzNzEgKiAxMDAwO1xuICAgICAgcGF0dGVybnMucHVzaChcbiAgICAgICAgYFNUX0Rpc3RhbmNlU3BoZXJlKCQke2luZGV4fTpuYW1lOjpnZW9tZXRyeSwgUE9JTlQoJCR7aW5kZXggKyAxfSwgJCR7aW5kZXggKyAyXG4gICAgICAgIH0pOjpnZW9tZXRyeSkgPD0gJCR7aW5kZXggKyAzfWBcbiAgICAgICk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHBvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGUsIGRpc3RhbmNlSW5LTSk7XG4gICAgICBpbmRleCArPSA0O1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRnZW9XaXRoaW4gJiYgZmllbGRWYWx1ZS4kZ2VvV2l0aGluLiRwb2x5Z29uKSB7XG4gICAgICBjb25zdCBwb2x5Z29uID0gZmllbGRWYWx1ZS4kZ2VvV2l0aGluLiRwb2x5Z29uO1xuICAgICAgbGV0IHBvaW50cztcbiAgICAgIGlmICh0eXBlb2YgcG9seWdvbiA9PT0gJ29iamVjdCcgJiYgcG9seWdvbi5fX3R5cGUgPT09ICdQb2x5Z29uJykge1xuICAgICAgICBpZiAoIXBvbHlnb24uY29vcmRpbmF0ZXMgfHwgcG9seWdvbi5jb29yZGluYXRlcy5sZW5ndGggPCAzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyBQb2x5Z29uLmNvb3JkaW5hdGVzIHNob3VsZCBjb250YWluIGF0IGxlYXN0IDMgbG9uL2xhdCBwYWlycydcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHBvaW50cyA9IHBvbHlnb24uY29vcmRpbmF0ZXM7XG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkocG9seWdvbikpIHtcbiAgICAgICAgaWYgKHBvbHlnb24ubGVuZ3RoIDwgMykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJHBvbHlnb24gc2hvdWxkIGNvbnRhaW4gYXQgbGVhc3QgMyBHZW9Qb2ludHMnXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBwb2ludHMgPSBwb2x5Z29uO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBcImJhZCAkZ2VvV2l0aGluIHZhbHVlOyAkcG9seWdvbiBzaG91bGQgYmUgUG9seWdvbiBvYmplY3Qgb3IgQXJyYXkgb2YgUGFyc2UuR2VvUG9pbnQnc1wiXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBwb2ludHMgPSBwb2ludHNcbiAgICAgICAgLm1hcChwb2ludCA9PiB7XG4gICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocG9pbnQpICYmIHBvaW50Lmxlbmd0aCA9PT0gMikge1xuICAgICAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50WzFdLCBwb2ludFswXSk7XG4gICAgICAgICAgICByZXR1cm4gYCgke3BvaW50WzBdfSwgJHtwb2ludFsxXX0pYDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHR5cGVvZiBwb2ludCAhPT0gJ29iamVjdCcgfHwgcG9pbnQuX190eXBlICE9PSAnR2VvUG9pbnQnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICRnZW9XaXRoaW4gdmFsdWUnKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50LmxhdGl0dWRlLCBwb2ludC5sb25naXR1ZGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gYCgke3BvaW50LmxvbmdpdHVkZX0sICR7cG9pbnQubGF0aXR1ZGV9KWA7XG4gICAgICAgIH0pXG4gICAgICAgIC5qb2luKCcsICcpO1xuXG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZTo6cG9pbnQgPEAgJCR7aW5kZXggKyAxfTo6cG9seWdvbmApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBgKCR7cG9pbnRzfSlgKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuICAgIGlmIChmaWVsZFZhbHVlLiRnZW9JbnRlcnNlY3RzICYmIGZpZWxkVmFsdWUuJGdlb0ludGVyc2VjdHMuJHBvaW50KSB7XG4gICAgICBjb25zdCBwb2ludCA9IGZpZWxkVmFsdWUuJGdlb0ludGVyc2VjdHMuJHBvaW50O1xuICAgICAgaWYgKHR5cGVvZiBwb2ludCAhPT0gJ29iamVjdCcgfHwgcG9pbnQuX190eXBlICE9PSAnR2VvUG9pbnQnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ2JhZCAkZ2VvSW50ZXJzZWN0IHZhbHVlOyAkcG9pbnQgc2hvdWxkIGJlIEdlb1BvaW50J1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50LmxhdGl0dWRlLCBwb2ludC5sb25naXR1ZGUpO1xuICAgICAgfVxuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWU6OnBvbHlnb24gQD4gJCR7aW5kZXggKyAxfTo6cG9pbnRgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgYCgke3BvaW50LmxvbmdpdHVkZX0sICR7cG9pbnQubGF0aXR1ZGV9KWApO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kcmVnZXgpIHtcbiAgICAgIGxldCByZWdleCA9IGZpZWxkVmFsdWUuJHJlZ2V4O1xuICAgICAgbGV0IG9wZXJhdG9yID0gJ34nO1xuICAgICAgY29uc3Qgb3B0cyA9IGZpZWxkVmFsdWUuJG9wdGlvbnM7XG4gICAgICBpZiAob3B0cykge1xuICAgICAgICBpZiAob3B0cy5pbmRleE9mKCdpJykgPj0gMCkge1xuICAgICAgICAgIG9wZXJhdG9yID0gJ34qJztcbiAgICAgICAgfVxuICAgICAgICBpZiAob3B0cy5pbmRleE9mKCd4JykgPj0gMCkge1xuICAgICAgICAgIHJlZ2V4ID0gcmVtb3ZlV2hpdGVTcGFjZShyZWdleCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmVnZXggPSBwcm9jZXNzUmVnZXhQYXR0ZXJuKHJlZ2V4KTtcblxuICAgICAgaWYgKGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPj0gMCkge1xuICAgICAgICBjb25zdCBuYW1lID0gdHJhbnNmb3JtRG90RmllbGQoZmllbGROYW1lKTtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9OnJhdyAke29wZXJhdG9yfSAnJCR7aW5kZXggKyAxfTpyYXcnYCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKG5hbWUsIHJlZ2V4KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lICR7b3BlcmF0b3J9ICckJHtpbmRleCArIDF9OnJhdydgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCByZWdleCk7XG4gICAgICB9XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICBpZiAoaXNBcnJheUZpZWxkKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYGFycmF5X2NvbnRhaW5zKCQke2luZGV4fTpuYW1lLCAkJHtpbmRleCArIDF9KWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KFtmaWVsZFZhbHVlXSkpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS5vYmplY3RJZCk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnRGF0ZScpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLmlzbyk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0dlb1BvaW50Jykge1xuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgfj0gUE9JTlQoJCR7aW5kZXggKyAxfSwgJCR7aW5kZXggKyAyfSlgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS5sb25naXR1ZGUsIGZpZWxkVmFsdWUubGF0aXR1ZGUpO1xuICAgICAgaW5kZXggKz0gMztcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS5fX3R5cGUgPT09ICdQb2x5Z29uJykge1xuICAgICAgY29uc3QgdmFsdWUgPSBjb252ZXJ0UG9seWdvblRvU1FMKGZpZWxkVmFsdWUuY29vcmRpbmF0ZXMpO1xuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgfj0gJCR7aW5kZXggKyAxfTo6cG9seWdvbmApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCB2YWx1ZSk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIE9iamVjdC5rZXlzKFBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvcikuZm9yRWFjaChjbXAgPT4ge1xuICAgICAgaWYgKGZpZWxkVmFsdWVbY21wXSB8fCBmaWVsZFZhbHVlW2NtcF0gPT09IDApIHtcbiAgICAgICAgY29uc3QgcGdDb21wYXJhdG9yID0gUGFyc2VUb1Bvc2dyZXNDb21wYXJhdG9yW2NtcF07XG4gICAgICAgIGxldCBjb25zdHJhaW50RmllbGROYW1lO1xuICAgICAgICBsZXQgcG9zdGdyZXNWYWx1ZSA9IHRvUG9zdGdyZXNWYWx1ZShmaWVsZFZhbHVlW2NtcF0pO1xuXG4gICAgICAgIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID49IDApIHtcbiAgICAgICAgICBjb25zdCBjYXN0VHlwZSA9IHRvUG9zdGdyZXNWYWx1ZUNhc3RUeXBlKGZpZWxkVmFsdWVbY21wXSk7XG4gICAgICAgICAgY29uc3RyYWludEZpZWxkTmFtZSA9IGNhc3RUeXBlXG4gICAgICAgICAgICA/IGBDQVNUICgoJHt0cmFuc2Zvcm1Eb3RGaWVsZChmaWVsZE5hbWUpfSkgQVMgJHtjYXN0VHlwZX0pYFxuICAgICAgICAgICAgOiB0cmFuc2Zvcm1Eb3RGaWVsZChmaWVsZE5hbWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmICh0eXBlb2YgcG9zdGdyZXNWYWx1ZSA9PT0gJ29iamVjdCcgJiYgcG9zdGdyZXNWYWx1ZS4kcmVsYXRpdmVUaW1lKSB7XG4gICAgICAgICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgIT09ICdEYXRlJykge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAgICckcmVsYXRpdmVUaW1lIGNhbiBvbmx5IGJlIHVzZWQgd2l0aCBEYXRlIGZpZWxkJ1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgcGFyc2VyUmVzdWx0ID0gVXRpbHMucmVsYXRpdmVUaW1lVG9EYXRlKHBvc3RncmVzVmFsdWUuJHJlbGF0aXZlVGltZSk7XG4gICAgICAgICAgICBpZiAocGFyc2VyUmVzdWx0LnN0YXR1cyA9PT0gJ3N1Y2Nlc3MnKSB7XG4gICAgICAgICAgICAgIHBvc3RncmVzVmFsdWUgPSB0b1Bvc3RncmVzVmFsdWUocGFyc2VyUmVzdWx0LnJlc3VsdCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciB3aGlsZSBwYXJzaW5nIHJlbGF0aXZlIGRhdGUnLCBwYXJzZXJSZXN1bHQpO1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAgIGBiYWQgJHJlbGF0aXZlVGltZSAoJHtwb3N0Z3Jlc1ZhbHVlLiRyZWxhdGl2ZVRpbWV9KSB2YWx1ZS4gJHtwYXJzZXJSZXN1bHQuaW5mb31gXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0cmFpbnRGaWVsZE5hbWUgPSBgJCR7aW5kZXgrK306bmFtZWA7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgfVxuICAgICAgICB2YWx1ZXMucHVzaChwb3N0Z3Jlc1ZhbHVlKTtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJHtjb25zdHJhaW50RmllbGROYW1lfSAke3BnQ29tcGFyYXRvcn0gJCR7aW5kZXgrK31gKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChpbml0aWFsUGF0dGVybnNMZW5ndGggPT09IHBhdHRlcm5zLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICBgUG9zdGdyZXMgZG9lc24ndCBzdXBwb3J0IHRoaXMgcXVlcnkgdHlwZSB5ZXQgJHtKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlKX1gXG4gICAgICApO1xuICAgIH1cbiAgfVxuICB2YWx1ZXMgPSB2YWx1ZXMubWFwKHRyYW5zZm9ybVZhbHVlKTtcbiAgcmV0dXJuIHsgcGF0dGVybjogcGF0dGVybnMuam9pbignIEFORCAnKSwgdmFsdWVzLCBzb3J0cyB9O1xufTtcblxuZXhwb3J0IGNsYXNzIFBvc3RncmVzU3RvcmFnZUFkYXB0ZXIgaW1wbGVtZW50cyBTdG9yYWdlQWRhcHRlciB7XG4gIGNhblNvcnRPbkpvaW5UYWJsZXM6IGJvb2xlYW47XG4gIGVuYWJsZVNjaGVtYUhvb2tzOiBib29sZWFuO1xuXG4gIC8vIFByaXZhdGVcbiAgX2NvbGxlY3Rpb25QcmVmaXg6IHN0cmluZztcbiAgX2NsaWVudDogYW55O1xuICBfb25jaGFuZ2U6IGFueTtcbiAgX3BncDogYW55O1xuICBfc3RyZWFtOiBhbnk7XG4gIF91dWlkOiBhbnk7XG4gIHNjaGVtYUNhY2hlVHRsOiA/bnVtYmVyO1xuICBkaXNhYmxlSW5kZXhGaWVsZFZhbGlkYXRpb246IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3IoeyB1cmksIGNvbGxlY3Rpb25QcmVmaXggPSAnJywgZGF0YWJhc2VPcHRpb25zID0ge30gfTogYW55KSB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHsgLi4uZGF0YWJhc2VPcHRpb25zIH07XG4gICAgdGhpcy5fY29sbGVjdGlvblByZWZpeCA9IGNvbGxlY3Rpb25QcmVmaXg7XG4gICAgdGhpcy5lbmFibGVTY2hlbWFIb29rcyA9ICEhZGF0YWJhc2VPcHRpb25zLmVuYWJsZVNjaGVtYUhvb2tzO1xuICAgIHRoaXMuZGlzYWJsZUluZGV4RmllbGRWYWxpZGF0aW9uID0gISFkYXRhYmFzZU9wdGlvbnMuZGlzYWJsZUluZGV4RmllbGRWYWxpZGF0aW9uO1xuXG4gICAgdGhpcy5zY2hlbWFDYWNoZVR0bCA9IGRhdGFiYXNlT3B0aW9ucy5zY2hlbWFDYWNoZVR0bDtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBbJ2VuYWJsZVNjaGVtYUhvb2tzJywgJ3NjaGVtYUNhY2hlVHRsJywgJ2Rpc2FibGVJbmRleEZpZWxkVmFsaWRhdGlvbiddKSB7XG4gICAgICBkZWxldGUgb3B0aW9uc1trZXldO1xuICAgIH1cblxuICAgIGNvbnN0IHsgY2xpZW50LCBwZ3AgfSA9IGNyZWF0ZUNsaWVudCh1cmksIG9wdGlvbnMpO1xuICAgIHRoaXMuX2NsaWVudCA9IGNsaWVudDtcbiAgICB0aGlzLl9vbmNoYW5nZSA9ICgpID0+IHsgfTtcbiAgICB0aGlzLl9wZ3AgPSBwZ3A7XG4gICAgdGhpcy5fdXVpZCA9IHJhbmRvbVVVSUQoKTtcbiAgICB0aGlzLmNhblNvcnRPbkpvaW5UYWJsZXMgPSBmYWxzZTtcbiAgfVxuXG4gIHdhdGNoKGNhbGxiYWNrOiAoKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5fb25jaGFuZ2UgPSBjYWxsYmFjaztcbiAgfVxuXG4gIC8vTm90ZSB0aGF0IGFuYWx5emU9dHJ1ZSB3aWxsIHJ1biB0aGUgcXVlcnksIGV4ZWN1dGluZyBJTlNFUlRTLCBERUxFVEVTLCBldGMuXG4gIGNyZWF0ZUV4cGxhaW5hYmxlUXVlcnkocXVlcnk6IHN0cmluZywgYW5hbHl6ZTogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgaWYgKGFuYWx5emUpIHtcbiAgICAgIHJldHVybiAnRVhQTEFJTiAoQU5BTFlaRSwgRk9STUFUIEpTT04pICcgKyBxdWVyeTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuICdFWFBMQUlOIChGT1JNQVQgSlNPTikgJyArIHF1ZXJ5O1xuICAgIH1cbiAgfVxuXG4gIGhhbmRsZVNodXRkb3duKCkge1xuICAgIGlmICh0aGlzLl9zdHJlYW0pIHtcbiAgICAgIHRoaXMuX3N0cmVhbS5kb25lKCk7XG4gICAgICBkZWxldGUgdGhpcy5fc3RyZWFtO1xuICAgIH1cbiAgICBpZiAoIXRoaXMuX2NsaWVudCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLl9jbGllbnQuJHBvb2wuZW5kKCk7XG4gIH1cblxuICBhc3luYyBfbGlzdGVuVG9TY2hlbWEoKSB7XG4gICAgaWYgKCF0aGlzLl9zdHJlYW0gJiYgdGhpcy5lbmFibGVTY2hlbWFIb29rcykge1xuICAgICAgdGhpcy5fc3RyZWFtID0gYXdhaXQgdGhpcy5fY2xpZW50LmNvbm5lY3QoeyBkaXJlY3Q6IHRydWUgfSk7XG4gICAgICB0aGlzLl9zdHJlYW0uY2xpZW50Lm9uKCdub3RpZmljYXRpb24nLCBkYXRhID0+IHtcbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IEpTT04ucGFyc2UoZGF0YS5wYXlsb2FkKTtcbiAgICAgICAgaWYgKHBheWxvYWQuc2VuZGVySWQgIT09IHRoaXMuX3V1aWQpIHtcbiAgICAgICAgICB0aGlzLl9vbmNoYW5nZSgpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHRoaXMuX3N0cmVhbS5ub25lKCdMSVNURU4gJDF+JywgJ3NjaGVtYS5jaGFuZ2UnKTtcbiAgICB9XG4gIH1cblxuICBfbm90aWZ5U2NoZW1hQ2hhbmdlKCkge1xuICAgIGlmICh0aGlzLl9zdHJlYW0pIHtcbiAgICAgIHRoaXMuX3N0cmVhbVxuICAgICAgICAubm9uZSgnTk9USUZZICQxfiwgJDInLCBbJ3NjaGVtYS5jaGFuZ2UnLCB7IHNlbmRlcklkOiB0aGlzLl91dWlkIH1dKVxuICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICAgICAgY29uc29sZS5sb2coJ0ZhaWxlZCB0byBOb3RpZnk6JywgZXJyb3IpOyAvLyB1bmxpa2VseSB0byBldmVyIGhhcHBlblxuICAgICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBfZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyhjb25uOiBhbnkpIHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgYXdhaXQgY29ublxuICAgICAgLm5vbmUoXG4gICAgICAgICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyBcIl9TQ0hFTUFcIiAoIFwiY2xhc3NOYW1lXCIgdmFyQ2hhcigxMjApLCBcInNjaGVtYVwiIGpzb25iLCBcImlzUGFyc2VDbGFzc1wiIGJvb2wsIFBSSU1BUlkgS0VZIChcImNsYXNzTmFtZVwiKSApJ1xuICAgICAgKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGNsYXNzRXhpc3RzKG5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQub25lKFxuICAgICAgJ1NFTEVDVCBFWElTVFMgKFNFTEVDVCAxIEZST00gaW5mb3JtYXRpb25fc2NoZW1hLnRhYmxlcyBXSEVSRSB0YWJsZV9uYW1lID0gJDEpJyxcbiAgICAgIFtuYW1lXSxcbiAgICAgIGEgPT4gYS5leGlzdHNcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgc2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nLCBDTFBzOiBhbnkpIHtcbiAgICBhd2FpdCB0aGlzLl9jbGllbnQudGFzaygnc2V0LWNsYXNzLWxldmVsLXBlcm1pc3Npb25zJywgYXN5bmMgdCA9PiB7XG4gICAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lLCAnc2NoZW1hJywgJ2NsYXNzTGV2ZWxQZXJtaXNzaW9ucycsIEpTT04uc3RyaW5naWZ5KENMUHMpXTtcbiAgICAgIGF3YWl0IHQubm9uZShcbiAgICAgICAgYFVQREFURSBcIl9TQ0hFTUFcIiBTRVQgJDI6bmFtZSA9IGpzb25fb2JqZWN0X3NldF9rZXkoJDI6bmFtZSwgJDM6OnRleHQsICQ0Ojpqc29uYikgV0hFUkUgXCJjbGFzc05hbWVcIiA9ICQxYCxcbiAgICAgICAgdmFsdWVzXG4gICAgICApO1xuICAgIH0pO1xuICAgIHRoaXMuX25vdGlmeVNjaGVtYUNoYW5nZSgpO1xuICB9XG5cbiAgYXN5bmMgc2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc3VibWl0dGVkSW5kZXhlczogYW55LFxuICAgIGV4aXN0aW5nSW5kZXhlczogYW55ID0ge30sXG4gICAgZmllbGRzOiBhbnksXG4gICAgY29ubjogP2FueVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHN1Ym1pdHRlZEluZGV4ZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXMoZXhpc3RpbmdJbmRleGVzKS5sZW5ndGggPT09IDApIHtcbiAgICAgIGV4aXN0aW5nSW5kZXhlcyA9IHsgX2lkXzogeyBfaWQ6IDEgfSB9O1xuICAgIH1cbiAgICBjb25zdCBkZWxldGVkSW5kZXhlcyA9IFtdO1xuICAgIGNvbnN0IGluc2VydGVkSW5kZXhlcyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKHN1Ym1pdHRlZEluZGV4ZXMpLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICBjb25zdCBmaWVsZCA9IHN1Ym1pdHRlZEluZGV4ZXNbbmFtZV07XG4gICAgICBpZiAoZXhpc3RpbmdJbmRleGVzW25hbWVdICYmIGZpZWxkLl9fb3AgIT09ICdEZWxldGUnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBgSW5kZXggJHtuYW1lfSBleGlzdHMsIGNhbm5vdCB1cGRhdGUuYCk7XG4gICAgICB9XG4gICAgICBpZiAoIWV4aXN0aW5nSW5kZXhlc1tuYW1lXSAmJiBmaWVsZC5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgICBgSW5kZXggJHtuYW1lfSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGRlbGV0ZS5gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoZmllbGQuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgZGVsZXRlZEluZGV4ZXMucHVzaChuYW1lKTtcbiAgICAgICAgZGVsZXRlIGV4aXN0aW5nSW5kZXhlc1tuYW1lXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIE9iamVjdC5rZXlzKGZpZWxkKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgIXRoaXMuZGlzYWJsZUluZGV4RmllbGRWYWxpZGF0aW9uICYmXG4gICAgICAgICAgICAhT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGZpZWxkcywga2V5KVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgICAgICAgICBgRmllbGQgJHtrZXl9IGRvZXMgbm90IGV4aXN0LCBjYW5ub3QgYWRkIGluZGV4LmBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgZXhpc3RpbmdJbmRleGVzW25hbWVdID0gZmllbGQ7XG4gICAgICAgIGluc2VydGVkSW5kZXhlcy5wdXNoKHtcbiAgICAgICAgICBrZXk6IGZpZWxkLFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGF3YWl0IGNvbm4udHgoJ3NldC1pbmRleGVzLXdpdGgtc2NoZW1hLWZvcm1hdCcsIGFzeW5jIHQgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKGluc2VydGVkSW5kZXhlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgYXdhaXQgc2VsZi5jcmVhdGVJbmRleGVzKGNsYXNzTmFtZSwgaW5zZXJ0ZWRJbmRleGVzLCB0KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBwZy1wcm9taXNlIHVzZSBCYXRjaCBlcnJvciBzZWUgaHR0cHM6Ly9naXRodWIuY29tL3ZpdGFseS10L3NwZXgvYmxvYi9lNTcyMDMwZjI2MWJlMWE4ZTkzNDFmYzZmNjM3ZTM2YWQwN2Y1MjMxL3NyYy9lcnJvcnMvYmF0Y2guanMjTDU5XG4gICAgICAgIGNvbnN0IGNvbHVtbkRvZXNOb3RFeGlzdEVycm9yID0gZS5nZXRFcnJvcnMgJiYgZS5nZXRFcnJvcnMoKVswXSAmJiBlLmdldEVycm9ycygpWzBdLmNvZGUgPT09ICc0MjcwMyc7XG4gICAgICAgIC8vIFNwZWNpZmljIGNhc2Ugd2hlbiB0aGUgY29sdW1uIGRvZXMgbm90IGV4aXN0XG4gICAgICAgIGlmIChjb2x1bW5Eb2VzTm90RXhpc3RFcnJvcikge1xuICAgICAgICAgIC8vIElmIHRoZSBkaXNhYmxlSW5kZXhGaWVsZFZhbGlkYXRpb24gaXMgdHJ1ZSwgd2Ugc2hvdWxkIGlnbm9yZSB0aGUgZXJyb3JcbiAgICAgICAgICBpZiAoIXRoaXMuZGlzYWJsZUluZGV4RmllbGRWYWxpZGF0aW9uKSB7XG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoZGVsZXRlZEluZGV4ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBhd2FpdCBzZWxmLmRyb3BJbmRleGVzKGNsYXNzTmFtZSwgZGVsZXRlZEluZGV4ZXMsIHQpO1xuICAgICAgfVxuICAgICAgYXdhaXQgdC5ub25lKFxuICAgICAgICAnVVBEQVRFIFwiX1NDSEVNQVwiIFNFVCAkMjpuYW1lID0ganNvbl9vYmplY3Rfc2V0X2tleSgkMjpuYW1lLCAkMzo6dGV4dCwgJDQ6Ompzb25iKSBXSEVSRSBcImNsYXNzTmFtZVwiID0gJDEnLFxuICAgICAgICBbY2xhc3NOYW1lLCAnc2NoZW1hJywgJ2luZGV4ZXMnLCBKU09OLnN0cmluZ2lmeShleGlzdGluZ0luZGV4ZXMpXVxuICAgICAgKTtcbiAgICB9KTtcbiAgICB0aGlzLl9ub3RpZnlTY2hlbWFDaGFuZ2UoKTtcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZUNsYXNzKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGNvbm46ID9hbnkpIHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3QgcGFyc2VTY2hlbWEgPSBhd2FpdCBjb25uXG4gICAgICAudHgoJ2NyZWF0ZS1jbGFzcycsIGFzeW5jIHQgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZVRhYmxlKGNsYXNzTmFtZSwgc2NoZW1hLCB0KTtcbiAgICAgICAgYXdhaXQgdC5ub25lKFxuICAgICAgICAgICdJTlNFUlQgSU5UTyBcIl9TQ0hFTUFcIiAoXCJjbGFzc05hbWVcIiwgXCJzY2hlbWFcIiwgXCJpc1BhcnNlQ2xhc3NcIikgVkFMVUVTICgkPGNsYXNzTmFtZT4sICQ8c2NoZW1hPiwgdHJ1ZSknLFxuICAgICAgICAgIHsgY2xhc3NOYW1lLCBzY2hlbWEgfVxuICAgICAgICApO1xuICAgICAgICBhd2FpdCB0aGlzLnNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KGNsYXNzTmFtZSwgc2NoZW1hLmluZGV4ZXMsIHt9LCBzY2hlbWEuZmllbGRzLCB0KTtcbiAgICAgICAgcmV0dXJuIHRvUGFyc2VTY2hlbWEoc2NoZW1hKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgaWYgKGVyci5jb2RlID09PSBQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3IgJiYgZXJyLmRldGFpbC5pbmNsdWRlcyhjbGFzc05hbWUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSwgYENsYXNzICR7Y2xhc3NOYW1lfSBhbHJlYWR5IGV4aXN0cy5gKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9KTtcbiAgICB0aGlzLl9ub3RpZnlTY2hlbWFDaGFuZ2UoKTtcbiAgICByZXR1cm4gcGFyc2VTY2hlbWE7XG4gIH1cblxuICAvLyBKdXN0IGNyZWF0ZSBhIHRhYmxlLCBkbyBub3QgaW5zZXJ0IGluIHNjaGVtYVxuICBhc3luYyBjcmVhdGVUYWJsZShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBjb25uOiBhbnkpIHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgZGVidWcoJ2NyZWF0ZVRhYmxlJyk7XG4gICAgY29uc3QgdmFsdWVzQXJyYXkgPSBbXTtcbiAgICBjb25zdCBwYXR0ZXJuc0FycmF5ID0gW107XG4gICAgY29uc3QgZmllbGRzID0gT2JqZWN0LmFzc2lnbih7fSwgc2NoZW1hLmZpZWxkcyk7XG4gICAgaWYgKGNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgICAgZmllbGRzLl9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCA9IHsgdHlwZTogJ0RhdGUnIH07XG4gICAgICBmaWVsZHMuX2VtYWlsX3ZlcmlmeV90b2tlbiA9IHsgdHlwZTogJ1N0cmluZycgfTtcbiAgICAgIGZpZWxkcy5fYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQgPSB7IHR5cGU6ICdEYXRlJyB9O1xuICAgICAgZmllbGRzLl9mYWlsZWRfbG9naW5fY291bnQgPSB7IHR5cGU6ICdOdW1iZXInIH07XG4gICAgICBmaWVsZHMuX3BlcmlzaGFibGVfdG9rZW4gPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gICAgICBmaWVsZHMuX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCA9IHsgdHlwZTogJ0RhdGUnIH07XG4gICAgICBmaWVsZHMuX3Bhc3N3b3JkX2NoYW5nZWRfYXQgPSB7IHR5cGU6ICdEYXRlJyB9O1xuICAgICAgZmllbGRzLl9wYXNzd29yZF9oaXN0b3J5ID0geyB0eXBlOiAnQXJyYXknIH07XG4gICAgfVxuICAgIGxldCBpbmRleCA9IDI7XG4gICAgY29uc3QgcmVsYXRpb25zID0gW107XG4gICAgT2JqZWN0LmtleXMoZmllbGRzKS5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICBjb25zdCBwYXJzZVR5cGUgPSBmaWVsZHNbZmllbGROYW1lXTtcbiAgICAgIC8vIFNraXAgd2hlbiBpdCdzIGEgcmVsYXRpb25cbiAgICAgIC8vIFdlJ2xsIGNyZWF0ZSB0aGUgdGFibGVzIGxhdGVyXG4gICAgICBpZiAocGFyc2VUeXBlLnR5cGUgPT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgcmVsYXRpb25zLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKFsnX3JwZXJtJywgJ193cGVybSddLmluZGV4T2YoZmllbGROYW1lKSA+PSAwKSB7XG4gICAgICAgIHBhcnNlVHlwZS5jb250ZW50cyA9IHsgdHlwZTogJ1N0cmluZycgfTtcbiAgICAgIH1cbiAgICAgIHZhbHVlc0FycmF5LnB1c2goZmllbGROYW1lKTtcbiAgICAgIHZhbHVlc0FycmF5LnB1c2gocGFyc2VUeXBlVG9Qb3N0Z3Jlc1R5cGUocGFyc2VUeXBlKSk7XG4gICAgICBwYXR0ZXJuc0FycmF5LnB1c2goYCQke2luZGV4fTpuYW1lICQke2luZGV4ICsgMX06cmF3YCk7XG4gICAgICBpZiAoZmllbGROYW1lID09PSAnb2JqZWN0SWQnKSB7XG4gICAgICAgIHBhdHRlcm5zQXJyYXkucHVzaChgUFJJTUFSWSBLRVkgKCQke2luZGV4fTpuYW1lKWApO1xuICAgICAgfVxuICAgICAgaW5kZXggPSBpbmRleCArIDI7XG4gICAgfSk7XG4gICAgY29uc3QgcXMgPSBgQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgJDE6bmFtZSAoJHtwYXR0ZXJuc0FycmF5LmpvaW4oKX0pYDtcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lLCAuLi52YWx1ZXNBcnJheV07XG5cbiAgICByZXR1cm4gY29ubi50YXNrKCdjcmVhdGUtdGFibGUnLCBhc3luYyB0ID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHQubm9uZShxcywgdmFsdWVzKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICAvLyBFTFNFOiBUYWJsZSBhbHJlYWR5IGV4aXN0cywgbXVzdCBoYXZlIGJlZW4gY3JlYXRlZCBieSBhIGRpZmZlcmVudCByZXF1ZXN0LiBJZ25vcmUgdGhlIGVycm9yLlxuICAgICAgfVxuICAgICAgYXdhaXQgdC50eCgnY3JlYXRlLXRhYmxlLXR4JywgdHggPT4ge1xuICAgICAgICByZXR1cm4gdHguYmF0Y2goXG4gICAgICAgICAgcmVsYXRpb25zLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHR4Lm5vbmUoXG4gICAgICAgICAgICAgICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAkPGpvaW5UYWJsZTpuYW1lPiAoXCJyZWxhdGVkSWRcIiB2YXJDaGFyKDEyMCksIFwib3duaW5nSWRcIiB2YXJDaGFyKDEyMCksIFBSSU1BUlkgS0VZKFwicmVsYXRlZElkXCIsIFwib3duaW5nSWRcIikgKScsXG4gICAgICAgICAgICAgIHsgam9pblRhYmxlOiBgX0pvaW46JHtmaWVsZE5hbWV9OiR7Y2xhc3NOYW1lfWAgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBzY2hlbWFVcGdyYWRlKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGNvbm46IGFueSkge1xuICAgIGRlYnVnKCdzY2hlbWFVcGdyYWRlJyk7XG4gICAgY29ubiA9IGNvbm4gfHwgdGhpcy5fY2xpZW50O1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuXG4gICAgYXdhaXQgY29ubi50YXNrKCdzY2hlbWEtdXBncmFkZScsIGFzeW5jIHQgPT4ge1xuICAgICAgY29uc3QgY29sdW1ucyA9IGF3YWl0IHQubWFwKFxuICAgICAgICAnU0VMRUNUIGNvbHVtbl9uYW1lIEZST00gaW5mb3JtYXRpb25fc2NoZW1hLmNvbHVtbnMgV0hFUkUgdGFibGVfbmFtZSA9ICQ8Y2xhc3NOYW1lPicsXG4gICAgICAgIHsgY2xhc3NOYW1lIH0sXG4gICAgICAgIGEgPT4gYS5jb2x1bW5fbmFtZVxuICAgICAgKTtcbiAgICAgIGNvbnN0IG5ld0NvbHVtbnMgPSBPYmplY3Qua2V5cyhzY2hlbWEuZmllbGRzKVxuICAgICAgICAuZmlsdGVyKGl0ZW0gPT4gY29sdW1ucy5pbmRleE9mKGl0ZW0pID09PSAtMSlcbiAgICAgICAgLm1hcChmaWVsZE5hbWUgPT4gc2VsZi5hZGRGaWVsZElmTm90RXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0pKTtcblxuICAgICAgYXdhaXQgdC5iYXRjaChuZXdDb2x1bW5zKTtcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGFkZEZpZWxkSWZOb3RFeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkTmFtZTogc3RyaW5nLCB0eXBlOiBhbnkpIHtcbiAgICAvLyBUT0RPOiBNdXN0IGJlIHJldmlzZWQgZm9yIGludmFsaWQgbG9naWMuLi5cbiAgICBkZWJ1ZygnYWRkRmllbGRJZk5vdEV4aXN0cycpO1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIGF3YWl0IHRoaXMuX2NsaWVudC50eCgnYWRkLWZpZWxkLWlmLW5vdC1leGlzdHMnLCBhc3luYyB0ID0+IHtcbiAgICAgIGlmICh0eXBlLnR5cGUgIT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0Lm5vbmUoXG4gICAgICAgICAgICAnQUxURVIgVEFCTEUgJDxjbGFzc05hbWU6bmFtZT4gQUREIENPTFVNTiBJRiBOT1QgRVhJU1RTICQ8ZmllbGROYW1lOm5hbWU+ICQ8cG9zdGdyZXNUeXBlOnJhdz4nLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICAgIGZpZWxkTmFtZSxcbiAgICAgICAgICAgICAgcG9zdGdyZXNUeXBlOiBwYXJzZVR5cGVUb1Bvc3RncmVzVHlwZSh0eXBlKSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmIChlcnJvci5jb2RlID09PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICAgIHJldHVybiBzZWxmLmNyZWF0ZUNsYXNzKGNsYXNzTmFtZSwgeyBmaWVsZHM6IHsgW2ZpZWxkTmFtZV06IHR5cGUgfSB9LCB0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGVycm9yLmNvZGUgIT09IFBvc3RncmVzRHVwbGljYXRlQ29sdW1uRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBDb2x1bW4gYWxyZWFkeSBleGlzdHMsIGNyZWF0ZWQgYnkgb3RoZXIgcmVxdWVzdC4gQ2Fycnkgb24gdG8gc2VlIGlmIGl0J3MgdGhlIHJpZ2h0IHR5cGUuXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHQubm9uZShcbiAgICAgICAgICAnQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgJDxqb2luVGFibGU6bmFtZT4gKFwicmVsYXRlZElkXCIgdmFyQ2hhcigxMjApLCBcIm93bmluZ0lkXCIgdmFyQ2hhcigxMjApLCBQUklNQVJZIEtFWShcInJlbGF0ZWRJZFwiLCBcIm93bmluZ0lkXCIpICknLFxuICAgICAgICAgIHsgam9pblRhYmxlOiBgX0pvaW46JHtmaWVsZE5hbWV9OiR7Y2xhc3NOYW1lfWAgfVxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0LmFueShcbiAgICAgICAgJ1NFTEVDVCBcInNjaGVtYVwiIEZST00gXCJfU0NIRU1BXCIgV0hFUkUgXCJjbGFzc05hbWVcIiA9ICQ8Y2xhc3NOYW1lPiBhbmQgKFwic2NoZW1hXCI6Ompzb24tPlxcJ2ZpZWxkc1xcJy0+JDxmaWVsZE5hbWU+KSBpcyBub3QgbnVsbCcsXG4gICAgICAgIHsgY2xhc3NOYW1lLCBmaWVsZE5hbWUgfVxuICAgICAgKTtcblxuICAgICAgaWYgKHJlc3VsdFswXSkge1xuICAgICAgICB0aHJvdyAnQXR0ZW1wdGVkIHRvIGFkZCBhIGZpZWxkIHRoYXQgYWxyZWFkeSBleGlzdHMnO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgcGF0aCA9IGB7ZmllbGRzLCR7ZmllbGROYW1lfX1gO1xuICAgICAgICBhd2FpdCB0Lm5vbmUoXG4gICAgICAgICAgJ1VQREFURSBcIl9TQ0hFTUFcIiBTRVQgXCJzY2hlbWFcIj1qc29uYl9zZXQoXCJzY2hlbWFcIiwgJDxwYXRoPiwgJDx0eXBlPikgIFdIRVJFIFwiY2xhc3NOYW1lXCI9JDxjbGFzc05hbWU+JyxcbiAgICAgICAgICB7IHBhdGgsIHR5cGUsIGNsYXNzTmFtZSB9XG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGhpcy5fbm90aWZ5U2NoZW1hQ2hhbmdlKCk7XG4gIH1cblxuICBhc3luYyB1cGRhdGVGaWVsZE9wdGlvbnMoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkTmFtZTogc3RyaW5nLCB0eXBlOiBhbnkpIHtcbiAgICBhd2FpdCB0aGlzLl9jbGllbnQudHgoJ3VwZGF0ZS1zY2hlbWEtZmllbGQtb3B0aW9ucycsIGFzeW5jIHQgPT4ge1xuICAgICAgY29uc3QgcGF0aCA9IGB7ZmllbGRzLCR7ZmllbGROYW1lfX1gO1xuICAgICAgYXdhaXQgdC5ub25lKFxuICAgICAgICAnVVBEQVRFIFwiX1NDSEVNQVwiIFNFVCBcInNjaGVtYVwiPWpzb25iX3NldChcInNjaGVtYVwiLCAkPHBhdGg+LCAkPHR5cGU+KSAgV0hFUkUgXCJjbGFzc05hbWVcIj0kPGNsYXNzTmFtZT4nLFxuICAgICAgICB7IHBhdGgsIHR5cGUsIGNsYXNzTmFtZSB9XG4gICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gRHJvcHMgYSBjb2xsZWN0aW9uLiBSZXNvbHZlcyB3aXRoIHRydWUgaWYgaXQgd2FzIGEgUGFyc2UgU2NoZW1hIChlZy4gX1VzZXIsIEN1c3RvbSwgZXRjLilcbiAgLy8gYW5kIHJlc29sdmVzIHdpdGggZmFsc2UgaWYgaXQgd2Fzbid0IChlZy4gYSBqb2luIHRhYmxlKS4gUmVqZWN0cyBpZiBkZWxldGlvbiB3YXMgaW1wb3NzaWJsZS5cbiAgYXN5bmMgZGVsZXRlQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBvcGVyYXRpb25zID0gW1xuICAgICAgeyBxdWVyeTogYERST1AgVEFCTEUgSUYgRVhJU1RTICQxOm5hbWVgLCB2YWx1ZXM6IFtjbGFzc05hbWVdIH0sXG4gICAgICB7XG4gICAgICAgIHF1ZXJ5OiBgREVMRVRFIEZST00gXCJfU0NIRU1BXCIgV0hFUkUgXCJjbGFzc05hbWVcIiA9ICQxYCxcbiAgICAgICAgdmFsdWVzOiBbY2xhc3NOYW1lXSxcbiAgICAgIH0sXG4gICAgXTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuX2NsaWVudFxuICAgICAgLnR4KHQgPT4gdC5ub25lKHRoaXMuX3BncC5oZWxwZXJzLmNvbmNhdChvcGVyYXRpb25zKSkpXG4gICAgICAudGhlbigoKSA9PiBjbGFzc05hbWUuaW5kZXhPZignX0pvaW46JykgIT0gMCk7IC8vIHJlc29sdmVzIHdpdGggZmFsc2Ugd2hlbiBfSm9pbiB0YWJsZVxuXG4gICAgdGhpcy5fbm90aWZ5U2NoZW1hQ2hhbmdlKCk7XG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuICB9XG5cbiAgLy8gRGVsZXRlIGFsbCBkYXRhIGtub3duIHRvIHRoaXMgYWRhcHRlci4gVXNlZCBmb3IgdGVzdGluZy5cbiAgYXN5bmMgZGVsZXRlQWxsQ2xhc3NlcygpIHtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcbiAgICBjb25zdCBoZWxwZXJzID0gdGhpcy5fcGdwLmhlbHBlcnM7XG4gICAgZGVidWcoJ2RlbGV0ZUFsbENsYXNzZXMnKTtcbiAgICBpZiAodGhpcy5fY2xpZW50Py4kcG9vbC5lbmRlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLl9jbGllbnRcbiAgICAgIC50YXNrKCdkZWxldGUtYWxsLWNsYXNzZXMnLCBhc3luYyB0ID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgdC5hbnkoJ1NFTEVDVCAqIEZST00gXCJfU0NIRU1BXCInKTtcbiAgICAgICAgICBjb25zdCBqb2lucyA9IHJlc3VsdHMucmVkdWNlKChsaXN0OiBBcnJheTxzdHJpbmc+LCBzY2hlbWE6IGFueSkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGxpc3QuY29uY2F0KGpvaW5UYWJsZXNGb3JTY2hlbWEoc2NoZW1hLnNjaGVtYSkpO1xuICAgICAgICAgIH0sIFtdKTtcbiAgICAgICAgICBjb25zdCBjbGFzc2VzID0gW1xuICAgICAgICAgICAgJ19TQ0hFTUEnLFxuICAgICAgICAgICAgJ19QdXNoU3RhdHVzJyxcbiAgICAgICAgICAgICdfSm9iU3RhdHVzJyxcbiAgICAgICAgICAgICdfSm9iU2NoZWR1bGUnLFxuICAgICAgICAgICAgJ19Ib29rcycsXG4gICAgICAgICAgICAnX0dsb2JhbENvbmZpZycsXG4gICAgICAgICAgICAnX0dyYXBoUUxDb25maWcnLFxuICAgICAgICAgICAgJ19BdWRpZW5jZScsXG4gICAgICAgICAgICAnX0lkZW1wb3RlbmN5JyxcbiAgICAgICAgICAgIC4uLnJlc3VsdHMubWFwKHJlc3VsdCA9PiByZXN1bHQuY2xhc3NOYW1lKSxcbiAgICAgICAgICAgIC4uLmpvaW5zLFxuICAgICAgICAgIF07XG4gICAgICAgICAgY29uc3QgcXVlcmllcyA9IGNsYXNzZXMubWFwKGNsYXNzTmFtZSA9PiAoe1xuICAgICAgICAgICAgcXVlcnk6ICdEUk9QIFRBQkxFIElGIEVYSVNUUyAkPGNsYXNzTmFtZTpuYW1lPicsXG4gICAgICAgICAgICB2YWx1ZXM6IHsgY2xhc3NOYW1lIH0sXG4gICAgICAgICAgfSkpO1xuICAgICAgICAgIGF3YWl0IHQudHgodHggPT4gdHgubm9uZShoZWxwZXJzLmNvbmNhdChxdWVyaWVzKSkpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBObyBfU0NIRU1BIGNvbGxlY3Rpb24uIERvbid0IGRlbGV0ZSBhbnl0aGluZy5cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgZGVidWcoYGRlbGV0ZUFsbENsYXNzZXMgZG9uZSBpbiAke25ldyBEYXRlKCkuZ2V0VGltZSgpIC0gbm93fWApO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBSZW1vdmUgdGhlIGNvbHVtbiBhbmQgYWxsIHRoZSBkYXRhLiBGb3IgUmVsYXRpb25zLCB0aGUgX0pvaW4gY29sbGVjdGlvbiBpcyBoYW5kbGVkXG4gIC8vIHNwZWNpYWxseSwgdGhpcyBmdW5jdGlvbiBkb2VzIG5vdCBkZWxldGUgX0pvaW4gY29sdW1ucy4gSXQgc2hvdWxkLCBob3dldmVyLCBpbmRpY2F0ZVxuICAvLyB0aGF0IHRoZSByZWxhdGlvbiBmaWVsZHMgZG9lcyBub3QgZXhpc3QgYW55bW9yZS4gSW4gbW9uZ28sIHRoaXMgbWVhbnMgcmVtb3ZpbmcgaXQgZnJvbVxuICAvLyB0aGUgX1NDSEVNQSBjb2xsZWN0aW9uLiAgVGhlcmUgc2hvdWxkIGJlIG5vIGFjdHVhbCBkYXRhIGluIHRoZSBjb2xsZWN0aW9uIHVuZGVyIHRoZSBzYW1lIG5hbWVcbiAgLy8gYXMgdGhlIHJlbGF0aW9uIGNvbHVtbiwgc28gaXQncyBmaW5lIHRvIGF0dGVtcHQgdG8gZGVsZXRlIGl0LiBJZiB0aGUgZmllbGRzIGxpc3RlZCB0byBiZVxuICAvLyBkZWxldGVkIGRvIG5vdCBleGlzdCwgdGhpcyBmdW5jdGlvbiBzaG91bGQgcmV0dXJuIHN1Y2Nlc3NmdWxseSBhbnl3YXlzLiBDaGVja2luZyBmb3JcbiAgLy8gYXR0ZW1wdHMgdG8gZGVsZXRlIG5vbi1leGlzdGVudCBmaWVsZHMgaXMgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIFBhcnNlIFNlcnZlci5cblxuICAvLyBUaGlzIGZ1bmN0aW9uIGlzIG5vdCBvYmxpZ2F0ZWQgdG8gZGVsZXRlIGZpZWxkcyBhdG9taWNhbGx5LiBJdCBpcyBnaXZlbiB0aGUgZmllbGRcbiAgLy8gbmFtZXMgaW4gYSBsaXN0IHNvIHRoYXQgZGF0YWJhc2VzIHRoYXQgYXJlIGNhcGFibGUgb2YgZGVsZXRpbmcgZmllbGRzIGF0b21pY2FsbHlcbiAgLy8gbWF5IGRvIHNvLlxuXG4gIC8vIFJldHVybnMgYSBQcm9taXNlLlxuICBhc3luYyBkZWxldGVGaWVsZHMoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgZmllbGROYW1lczogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBkZWJ1ZygnZGVsZXRlRmllbGRzJyk7XG4gICAgZmllbGROYW1lcyA9IGZpZWxkTmFtZXMucmVkdWNlKChsaXN0OiBBcnJheTxzdHJpbmc+LCBmaWVsZE5hbWU6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgZmllbGQgPSBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICBpZiAoZmllbGQudHlwZSAhPT0gJ1JlbGF0aW9uJykge1xuICAgICAgICBsaXN0LnB1c2goZmllbGROYW1lKTtcbiAgICAgIH1cbiAgICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICByZXR1cm4gbGlzdDtcbiAgICB9LCBbXSk7XG5cbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lLCAuLi5maWVsZE5hbWVzXTtcbiAgICBjb25zdCBjb2x1bW5zID0gZmllbGROYW1lc1xuICAgICAgLm1hcCgobmFtZSwgaWR4KSA9PiB7XG4gICAgICAgIHJldHVybiBgJCR7aWR4ICsgMn06bmFtZWA7XG4gICAgICB9KVxuICAgICAgLmpvaW4oJywgRFJPUCBDT0xVTU4nKTtcblxuICAgIGF3YWl0IHRoaXMuX2NsaWVudC50eCgnZGVsZXRlLWZpZWxkcycsIGFzeW5jIHQgPT4ge1xuICAgICAgYXdhaXQgdC5ub25lKCdVUERBVEUgXCJfU0NIRU1BXCIgU0VUIFwic2NoZW1hXCIgPSAkPHNjaGVtYT4gV0hFUkUgXCJjbGFzc05hbWVcIiA9ICQ8Y2xhc3NOYW1lPicsIHtcbiAgICAgICAgc2NoZW1hLFxuICAgICAgICBjbGFzc05hbWUsXG4gICAgICB9KTtcbiAgICAgIGlmICh2YWx1ZXMubGVuZ3RoID4gMSkge1xuICAgICAgICBhd2FpdCB0Lm5vbmUoYEFMVEVSIFRBQkxFICQxOm5hbWUgRFJPUCBDT0xVTU4gSUYgRVhJU1RTICR7Y29sdW1uc31gLCB2YWx1ZXMpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHRoaXMuX25vdGlmeVNjaGVtYUNoYW5nZSgpO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgcHJvbWlzZSBmb3IgYWxsIHNjaGVtYXMga25vd24gdG8gdGhpcyBhZGFwdGVyLCBpbiBQYXJzZSBmb3JtYXQuIEluIGNhc2UgdGhlXG4gIC8vIHNjaGVtYXMgY2Fubm90IGJlIHJldHJpZXZlZCwgcmV0dXJucyBhIHByb21pc2UgdGhhdCByZWplY3RzLiBSZXF1aXJlbWVudHMgZm9yIHRoZVxuICAvLyByZWplY3Rpb24gcmVhc29uIGFyZSBUQkQuXG4gIGFzeW5jIGdldEFsbENsYXNzZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC50YXNrKCdnZXQtYWxsLWNsYXNzZXMnLCBhc3luYyB0ID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0Lm1hcCgnU0VMRUNUICogRlJPTSBcIl9TQ0hFTUFcIicsIG51bGwsIHJvdyA9PlxuICAgICAgICB0b1BhcnNlU2NoZW1hKHsgY2xhc3NOYW1lOiByb3cuY2xhc3NOYW1lLCAuLi5yb3cuc2NoZW1hIH0pXG4gICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgcHJvbWlzZSBmb3IgdGhlIHNjaGVtYSB3aXRoIHRoZSBnaXZlbiBuYW1lLCBpbiBQYXJzZSBmb3JtYXQuIElmXG4gIC8vIHRoaXMgYWRhcHRlciBkb2Vzbid0IGtub3cgYWJvdXQgdGhlIHNjaGVtYSwgcmV0dXJuIGEgcHJvbWlzZSB0aGF0IHJlamVjdHMgd2l0aFxuICAvLyB1bmRlZmluZWQgYXMgdGhlIHJlYXNvbi5cbiAgYXN5bmMgZ2V0Q2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICBkZWJ1ZygnZ2V0Q2xhc3MnKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50XG4gICAgICAuYW55KCdTRUxFQ1QgKiBGUk9NIFwiX1NDSEVNQVwiIFdIRVJFIFwiY2xhc3NOYW1lXCIgPSAkPGNsYXNzTmFtZT4nLCB7XG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgIH0pXG4gICAgICAudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICBpZiAocmVzdWx0Lmxlbmd0aCAhPT0gMSkge1xuICAgICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0WzBdLnNjaGVtYTtcbiAgICAgIH0pXG4gICAgICAudGhlbih0b1BhcnNlU2NoZW1hKTtcbiAgfVxuXG4gIC8vIFRPRE86IHJlbW92ZSB0aGUgbW9uZ28gZm9ybWF0IGRlcGVuZGVuY3kgaW4gdGhlIHJldHVybiB2YWx1ZVxuICBhc3luYyBjcmVhdGVPYmplY3QoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIG9iamVjdDogYW55LFxuICAgIHRyYW5zYWN0aW9uYWxTZXNzaW9uOiA/YW55XG4gICkge1xuICAgIGRlYnVnKCdjcmVhdGVPYmplY3QnKTtcbiAgICBsZXQgY29sdW1uc0FycmF5ID0gW107XG4gICAgY29uc3QgdmFsdWVzQXJyYXkgPSBbXTtcbiAgICBzY2hlbWEgPSB0b1Bvc3RncmVzU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgZ2VvUG9pbnRzID0ge307XG5cbiAgICBvYmplY3QgPSBoYW5kbGVEb3RGaWVsZHMob2JqZWN0KTtcblxuICAgIHZhbGlkYXRlS2V5cyhvYmplY3QpO1xuXG4gICAgT2JqZWN0LmtleXMob2JqZWN0KS5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdmFyIGF1dGhEYXRhTWF0Y2ggPSBmaWVsZE5hbWUubWF0Y2goL15fYXV0aF9kYXRhXyhbYS16QS1aMC05X10rKSQvKTtcbiAgICAgIGNvbnN0IGF1dGhEYXRhQWxyZWFkeUV4aXN0cyA9ICEhb2JqZWN0LmF1dGhEYXRhO1xuICAgICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgICAgdmFyIHByb3ZpZGVyID0gYXV0aERhdGFNYXRjaFsxXTtcbiAgICAgICAgb2JqZWN0WydhdXRoRGF0YSddID0gb2JqZWN0WydhdXRoRGF0YSddIHx8IHt9O1xuICAgICAgICBvYmplY3RbJ2F1dGhEYXRhJ11bcHJvdmlkZXJdID0gb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgICAgIGRlbGV0ZSBvYmplY3RbZmllbGROYW1lXTtcbiAgICAgICAgZmllbGROYW1lID0gJ2F1dGhEYXRhJztcbiAgICAgICAgLy8gQXZvaWQgYWRkaW5nIGF1dGhEYXRhIG11bHRpcGxlIHRpbWVzIHRvIHRoZSBxdWVyeVxuICAgICAgICBpZiAoYXV0aERhdGFBbHJlYWR5RXhpc3RzKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbHVtbnNBcnJheS5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBpZiAoIXNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJiBjbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGZpZWxkTmFtZSA9PT0gJ19lbWFpbF92ZXJpZnlfdG9rZW4nIHx8XG4gICAgICAgICAgZmllbGROYW1lID09PSAnX2ZhaWxlZF9sb2dpbl9jb3VudCcgfHxcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGVyaXNoYWJsZV90b2tlbicgfHxcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGFzc3dvcmRfaGlzdG9yeSdcbiAgICAgICAgKSB7XG4gICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmllbGROYW1lID09PSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0Jykge1xuICAgICAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSkge1xuICAgICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXS5pc28pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG51bGwpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnIHx8XG4gICAgICAgICAgZmllbGROYW1lID09PSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCcgfHxcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGFzc3dvcmRfY2hhbmdlZF9hdCdcbiAgICAgICAgKSB7XG4gICAgICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdKSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLmlzbyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gobnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHN3aXRjaCAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUpIHtcbiAgICAgICAgY2FzZSAnRGF0ZSc6XG4gICAgICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdKSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLmlzbyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gobnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdQb2ludGVyJzpcbiAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLm9iamVjdElkKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnQXJyYXknOlxuICAgICAgICAgIGlmIChbJ19ycGVybScsICdfd3Blcm0nXS5pbmRleE9mKGZpZWxkTmFtZSkgPj0gMCkge1xuICAgICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2goSlNPTi5zdHJpbmdpZnkob2JqZWN0W2ZpZWxkTmFtZV0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ09iamVjdCc6XG4gICAgICAgIGNhc2UgJ0J5dGVzJzpcbiAgICAgICAgY2FzZSAnU3RyaW5nJzpcbiAgICAgICAgY2FzZSAnTnVtYmVyJzpcbiAgICAgICAgY2FzZSAnQm9vbGVhbic6XG4gICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ0ZpbGUnOlxuICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gob2JqZWN0W2ZpZWxkTmFtZV0ubmFtZSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ1BvbHlnb24nOiB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBjb252ZXJ0UG9seWdvblRvU1FMKG9iamVjdFtmaWVsZE5hbWVdLmNvb3JkaW5hdGVzKTtcbiAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKHZhbHVlKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlICdHZW9Qb2ludCc6XG4gICAgICAgICAgLy8gcG9wIHRoZSBwb2ludCBhbmQgcHJvY2VzcyBsYXRlclxuICAgICAgICAgIGdlb1BvaW50c1tmaWVsZE5hbWVdID0gb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgICAgICAgY29sdW1uc0FycmF5LnBvcCgpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IGBUeXBlICR7c2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGV9IG5vdCBzdXBwb3J0ZWQgeWV0YDtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbHVtbnNBcnJheSA9IGNvbHVtbnNBcnJheS5jb25jYXQoT2JqZWN0LmtleXMoZ2VvUG9pbnRzKSk7XG4gICAgY29uc3QgaW5pdGlhbFZhbHVlcyA9IHZhbHVlc0FycmF5Lm1hcCgodmFsLCBpbmRleCkgPT4ge1xuICAgICAgbGV0IHRlcm1pbmF0aW9uID0gJyc7XG4gICAgICBjb25zdCBmaWVsZE5hbWUgPSBjb2x1bW5zQXJyYXlbaW5kZXhdO1xuICAgICAgaWYgKFsnX3JwZXJtJywgJ193cGVybSddLmluZGV4T2YoZmllbGROYW1lKSA+PSAwKSB7XG4gICAgICAgIHRlcm1pbmF0aW9uID0gJzo6dGV4dFtdJztcbiAgICAgIH0gZWxzZSBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnQXJyYXknKSB7XG4gICAgICAgIHRlcm1pbmF0aW9uID0gJzo6anNvbmInO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGAkJHtpbmRleCArIDIgKyBjb2x1bW5zQXJyYXkubGVuZ3RofSR7dGVybWluYXRpb259YDtcbiAgICB9KTtcbiAgICBjb25zdCBnZW9Qb2ludHNJbmplY3RzID0gT2JqZWN0LmtleXMoZ2VvUG9pbnRzKS5tYXAoa2V5ID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZ2VvUG9pbnRzW2tleV07XG4gICAgICB2YWx1ZXNBcnJheS5wdXNoKHZhbHVlLmxvbmdpdHVkZSwgdmFsdWUubGF0aXR1ZGUpO1xuICAgICAgY29uc3QgbCA9IHZhbHVlc0FycmF5Lmxlbmd0aCArIGNvbHVtbnNBcnJheS5sZW5ndGg7XG4gICAgICByZXR1cm4gYFBPSU5UKCQke2x9LCAkJHtsICsgMX0pYDtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbHVtbnNQYXR0ZXJuID0gY29sdW1uc0FycmF5Lm1hcCgoY29sLCBpbmRleCkgPT4gYCQke2luZGV4ICsgMn06bmFtZWApLmpvaW4oKTtcbiAgICBjb25zdCB2YWx1ZXNQYXR0ZXJuID0gaW5pdGlhbFZhbHVlcy5jb25jYXQoZ2VvUG9pbnRzSW5qZWN0cykuam9pbigpO1xuXG4gICAgY29uc3QgcXMgPSBgSU5TRVJUIElOVE8gJDE6bmFtZSAoJHtjb2x1bW5zUGF0dGVybn0pIFZBTFVFUyAoJHt2YWx1ZXNQYXR0ZXJufSlgO1xuICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWUsIC4uLmNvbHVtbnNBcnJheSwgLi4udmFsdWVzQXJyYXldO1xuICAgIGNvbnN0IHByb21pc2UgPSAodHJhbnNhY3Rpb25hbFNlc3Npb24gPyB0cmFuc2FjdGlvbmFsU2Vzc2lvbi50IDogdGhpcy5fY2xpZW50KVxuICAgICAgLm5vbmUocXMsIHZhbHVlcylcbiAgICAgIC50aGVuKCgpID0+ICh7IG9wczogW29iamVjdF0gfSkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNVbmlxdWVJbmRleFZpb2xhdGlvbkVycm9yKSB7XG4gICAgICAgICAgY29uc3QgZXJyID0gbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLFxuICAgICAgICAgICAgJ0EgZHVwbGljYXRlIHZhbHVlIGZvciBhIGZpZWxkIHdpdGggdW5pcXVlIHZhbHVlcyB3YXMgcHJvdmlkZWQnXG4gICAgICAgICAgKTtcbiAgICAgICAgICBlcnIudW5kZXJseWluZ0Vycm9yID0gZXJyb3I7XG4gICAgICAgICAgaWYgKGVycm9yLmNvbnN0cmFpbnQpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBhdXRoRGF0YSB1bmlxdWUgaW5kZXggdmlvbGF0aW9ucyBmaXJzdFxuICAgICAgICAgICAgY29uc3QgYXV0aERhdGFNYXRjaCA9IGVycm9yLmNvbnN0cmFpbnQubWF0Y2goL19Vc2VyX3VuaXF1ZV9hdXRoRGF0YV8oW2EtekEtWjAtOV9dKylfaWQvKTtcbiAgICAgICAgICAgIGlmIChhdXRoRGF0YU1hdGNoKSB7XG4gICAgICAgICAgICAgIGVyci51c2VySW5mbyA9IHsgZHVwbGljYXRlZF9maWVsZDogYF9hdXRoX2RhdGFfJHthdXRoRGF0YU1hdGNoWzFdfWAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSBlcnJvci5jb25zdHJhaW50Lm1hdGNoKC91bmlxdWVfKFthLXpBLVpdKykvKTtcbiAgICAgICAgICAgICAgaWYgKG1hdGNoZXMgJiYgQXJyYXkuaXNBcnJheShtYXRjaGVzKSkge1xuICAgICAgICAgICAgICAgIGVyci51c2VySW5mbyA9IHsgZHVwbGljYXRlZF9maWVsZDogbWF0Y2hlc1sxXSB9O1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGVycm9yID0gZXJyO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSk7XG4gICAgaWYgKHRyYW5zYWN0aW9uYWxTZXNzaW9uKSB7XG4gICAgICB0cmFuc2FjdGlvbmFsU2Vzc2lvbi5iYXRjaC5wdXNoKHByb21pc2UpO1xuICAgIH1cbiAgICByZXR1cm4gcHJvbWlzZTtcbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgb2JqZWN0cyB0aGF0IG1hdGNoIHRoZSBnaXZlbiBQYXJzZSBRdWVyeS5cbiAgLy8gSWYgbm8gb2JqZWN0cyBtYXRjaCwgcmVqZWN0IHdpdGggT0JKRUNUX05PVF9GT1VORC4gSWYgb2JqZWN0cyBhcmUgZm91bmQgYW5kIGRlbGV0ZWQsIHJlc29sdmUgd2l0aCB1bmRlZmluZWQuXG4gIC8vIElmIHRoZXJlIGlzIHNvbWUgb3RoZXIgZXJyb3IsIHJlamVjdCB3aXRoIElOVEVSTkFMX1NFUlZFUl9FUlJPUi5cbiAgYXN5bmMgZGVsZXRlT2JqZWN0c0J5UXVlcnkoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgdHJhbnNhY3Rpb25hbFNlc3Npb246ID9hbnlcbiAgKSB7XG4gICAgZGVidWcoJ2RlbGV0ZU9iamVjdHNCeVF1ZXJ5Jyk7XG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZV07XG4gICAgY29uc3QgaW5kZXggPSAyO1xuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRXaGVyZUNsYXVzZSh7XG4gICAgICBzY2hlbWEsXG4gICAgICBpbmRleCxcbiAgICAgIHF1ZXJ5LFxuICAgICAgY2FzZUluc2Vuc2l0aXZlOiBmYWxzZSxcbiAgICB9KTtcbiAgICB2YWx1ZXMucHVzaCguLi53aGVyZS52YWx1ZXMpO1xuICAgIGlmIChPYmplY3Qua2V5cyhxdWVyeSkubGVuZ3RoID09PSAwKSB7XG4gICAgICB3aGVyZS5wYXR0ZXJuID0gJ1RSVUUnO1xuICAgIH1cbiAgICBjb25zdCBxcyA9IGBXSVRIIGRlbGV0ZWQgQVMgKERFTEVURSBGUk9NICQxOm5hbWUgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufSBSRVRVUk5JTkcgKikgU0VMRUNUIGNvdW50KCopIEZST00gZGVsZXRlZGA7XG4gICAgY29uc3QgcHJvbWlzZSA9ICh0cmFuc2FjdGlvbmFsU2Vzc2lvbiA/IHRyYW5zYWN0aW9uYWxTZXNzaW9uLnQgOiB0aGlzLl9jbGllbnQpXG4gICAgICAub25lKHFzLCB2YWx1ZXMsIGEgPT4gK2EuY291bnQpXG4gICAgICAudGhlbihjb3VudCA9PiB7XG4gICAgICAgIGlmIChjb3VudCA9PT0gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnT2JqZWN0IG5vdCBmb3VuZC4nKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gY291bnQ7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgICAgLy8gRUxTRTogRG9uJ3QgZGVsZXRlIGFueXRoaW5nIGlmIGRvZXNuJ3QgZXhpc3RcbiAgICAgIH0pO1xuICAgIGlmICh0cmFuc2FjdGlvbmFsU2Vzc2lvbikge1xuICAgICAgdHJhbnNhY3Rpb25hbFNlc3Npb24uYmF0Y2gucHVzaChwcm9taXNlKTtcbiAgICB9XG4gICAgcmV0dXJuIHByb21pc2U7XG4gIH1cbiAgLy8gUmV0dXJuIHZhbHVlIG5vdCBjdXJyZW50bHkgd2VsbCBzcGVjaWZpZWQuXG4gIGFzeW5jIGZpbmRPbmVBbmRVcGRhdGUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgdXBkYXRlOiBhbnksXG4gICAgdHJhbnNhY3Rpb25hbFNlc3Npb246ID9hbnlcbiAgKTogUHJvbWlzZTxhbnk+IHtcbiAgICBkZWJ1ZygnZmluZE9uZUFuZFVwZGF0ZScpO1xuICAgIHJldHVybiB0aGlzLnVwZGF0ZU9iamVjdHNCeVF1ZXJ5KGNsYXNzTmFtZSwgc2NoZW1hLCBxdWVyeSwgdXBkYXRlLCB0cmFuc2FjdGlvbmFsU2Vzc2lvbikudGhlbihcbiAgICAgIHZhbCA9PiB2YWxbMF1cbiAgICApO1xuICB9XG5cbiAgLy8gQXBwbHkgdGhlIHVwZGF0ZSB0byBhbGwgb2JqZWN0cyB0aGF0IG1hdGNoIHRoZSBnaXZlbiBQYXJzZSBRdWVyeS5cbiAgYXN5bmMgdXBkYXRlT2JqZWN0c0J5UXVlcnkoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgdXBkYXRlOiBhbnksXG4gICAgdHJhbnNhY3Rpb25hbFNlc3Npb246ID9hbnlcbiAgKTogUHJvbWlzZTxbYW55XT4ge1xuICAgIGRlYnVnKCd1cGRhdGVPYmplY3RzQnlRdWVyeScpO1xuICAgIGNvbnN0IHVwZGF0ZVBhdHRlcm5zID0gW107XG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZV07XG4gICAgbGV0IGluZGV4ID0gMjtcbiAgICBzY2hlbWEgPSB0b1Bvc3RncmVzU2NoZW1hKHNjaGVtYSk7XG5cbiAgICBjb25zdCBvcmlnaW5hbFVwZGF0ZSA9IHsgLi4udXBkYXRlIH07XG5cbiAgICAvLyBTZXQgZmxhZyBmb3IgZG90IG5vdGF0aW9uIGZpZWxkc1xuICAgIGNvbnN0IGRvdE5vdGF0aW9uT3B0aW9ucyA9IHt9O1xuICAgIE9iamVjdC5rZXlzKHVwZGF0ZSkuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgaWYgKGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPiAtMSkge1xuICAgICAgICBjb25zdCBjb21wb25lbnRzID0gZmllbGROYW1lLnNwbGl0KCcuJyk7XG4gICAgICAgIGNvbnN0IGZpcnN0ID0gY29tcG9uZW50cy5zaGlmdCgpO1xuICAgICAgICBkb3ROb3RhdGlvbk9wdGlvbnNbZmlyc3RdID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRvdE5vdGF0aW9uT3B0aW9uc1tmaWVsZE5hbWVdID0gZmFsc2U7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdXBkYXRlID0gaGFuZGxlRG90RmllbGRzKHVwZGF0ZSk7XG4gICAgLy8gUmVzb2x2ZSBhdXRoRGF0YSBmaXJzdCxcbiAgICAvLyBTbyB3ZSBkb24ndCBlbmQgdXAgd2l0aCBtdWx0aXBsZSBrZXkgdXBkYXRlc1xuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIHVwZGF0ZSkge1xuICAgICAgY29uc3QgYXV0aERhdGFNYXRjaCA9IGZpZWxkTmFtZS5tYXRjaCgvXl9hdXRoX2RhdGFfKFthLXpBLVowLTlfXSspJC8pO1xuICAgICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgICAgdmFyIHByb3ZpZGVyID0gYXV0aERhdGFNYXRjaFsxXTtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgICAgZGVsZXRlIHVwZGF0ZVtmaWVsZE5hbWVdO1xuICAgICAgICB1cGRhdGVbJ2F1dGhEYXRhJ10gPSB1cGRhdGVbJ2F1dGhEYXRhJ10gfHwge307XG4gICAgICAgIHVwZGF0ZVsnYXV0aERhdGEnXVtwcm92aWRlcl0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiB1cGRhdGUpIHtcbiAgICAgIGNvbnN0IGZpZWxkVmFsdWUgPSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgIC8vIERyb3AgYW55IHVuZGVmaW5lZCB2YWx1ZXMuXG4gICAgICBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIGRlbGV0ZSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9IE5VTExgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGROYW1lID09ICdhdXRoRGF0YScpIHtcbiAgICAgICAgLy8gVGhpcyByZWN1cnNpdmVseSBzZXRzIHRoZSBqc29uX29iamVjdFxuICAgICAgICAvLyBPbmx5IDEgbGV2ZWwgZGVlcFxuICAgICAgICBjb25zdCBnZW5lcmF0ZSA9IChqc29uYjogc3RyaW5nLCBrZXk6IHN0cmluZywgdmFsdWU6IGFueSkgPT4ge1xuICAgICAgICAgIHJldHVybiBganNvbl9vYmplY3Rfc2V0X2tleShDT0FMRVNDRSgke2pzb25ifSwgJ3t9Jzo6anNvbmIpLCAke2tleX0sICR7dmFsdWV9KTo6anNvbmJgO1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBnZW5lcmF0ZVJlbW92ZSA9IChqc29uYjogc3RyaW5nLCBrZXk6IHN0cmluZykgPT4ge1xuICAgICAgICAgIHJldHVybiBgKENPQUxFU0NFKCR7anNvbmJ9LCAne30nOjpqc29uYikgLSAke2tleX0pYDtcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgbGFzdEtleSA9IGAkJHtpbmRleH06bmFtZWA7XG4gICAgICAgIGNvbnN0IGZpZWxkTmFtZUluZGV4ID0gaW5kZXg7XG4gICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgIGNvbnN0IHVwZGF0ZSA9IE9iamVjdC5rZXlzKGZpZWxkVmFsdWUpLnJlZHVjZSgobGFzdEtleTogc3RyaW5nLCBrZXk6IHN0cmluZykgPT4ge1xuICAgICAgICAgIGxldCB2YWx1ZSA9IGZpZWxkVmFsdWVba2V5XTtcbiAgICAgICAgICBpZiAodmFsdWUgJiYgdmFsdWUuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgICAgIHZhbHVlID0gbnVsbDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHZhbHVlID09PSBudWxsKSB7XG4gICAgICAgICAgICBjb25zdCBzdHIgPSBnZW5lcmF0ZVJlbW92ZShsYXN0S2V5LCBgJCR7aW5kZXh9Ojp0ZXh0YCk7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaChrZXkpO1xuICAgICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgICAgIHJldHVybiBzdHI7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHN0ciA9IGdlbmVyYXRlKGxhc3RLZXksIGAkJHtpbmRleH06OnRleHRgLCBgJCR7aW5kZXggKyAxfTo6anNvbmJgKTtcbiAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgdmFsdWUgPSBKU09OLnN0cmluZ2lmeSh2YWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHZhbHVlcy5wdXNoKGtleSwgdmFsdWUpO1xuICAgICAgICAgIHJldHVybiBzdHI7XG4gICAgICAgIH0sIGxhc3RLZXkpO1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtmaWVsZE5hbWVJbmRleH06bmFtZSA9ICR7dXBkYXRlfWApO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fb3AgPT09ICdJbmNyZW1lbnQnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gQ09BTEVTQ0UoJCR7aW5kZXh9Om5hbWUsIDApICsgJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUuYW1vdW50KTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX29wID09PSAnQWRkJykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKFxuICAgICAgICAgIGAkJHtpbmRleH06bmFtZSA9IGFycmF5X2FkZChDT0FMRVNDRSgkJHtpbmRleH06bmFtZSwgJ1tdJzo6anNvbmIpLCAkJHtpbmRleCArIDF9Ojpqc29uYilgXG4gICAgICAgICk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgSlNPTi5zdHJpbmdpZnkoZmllbGRWYWx1ZS5vYmplY3RzKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgbnVsbCk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX19vcCA9PT0gJ1JlbW92ZScpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChcbiAgICAgICAgICBgJCR7aW5kZXh9Om5hbWUgPSBhcnJheV9yZW1vdmUoQ09BTEVTQ0UoJCR7aW5kZXh9Om5hbWUsICdbXSc6Ompzb25iKSwgJCR7aW5kZXggKyAxXG4gICAgICAgICAgfTo6anNvbmIpYFxuICAgICAgICApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUub2JqZWN0cykpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fb3AgPT09ICdBZGRVbmlxdWUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYCQke2luZGV4fTpuYW1lID0gYXJyYXlfYWRkX3VuaXF1ZShDT0FMRVNDRSgkJHtpbmRleH06bmFtZSwgJ1tdJzo6anNvbmIpLCAkJHtpbmRleCArIDFcbiAgICAgICAgICB9Ojpqc29uYilgXG4gICAgICAgICk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgSlNPTi5zdHJpbmdpZnkoZmllbGRWYWx1ZS5vYmplY3RzKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkTmFtZSA9PT0gJ3VwZGF0ZWRBdCcpIHtcbiAgICAgICAgLy9UT0RPOiBzdG9wIHNwZWNpYWwgY2FzaW5nIHRoaXMuIEl0IHNob3VsZCBjaGVjayBmb3IgX190eXBlID09PSAnRGF0ZScgYW5kIHVzZSAuaXNvXG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS5vYmplY3RJZCk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnRGF0ZScpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgdG9Qb3N0Z3Jlc1ZhbHVlKGZpZWxkVmFsdWUpKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoVXRpbHMuaXNEYXRlKGZpZWxkVmFsdWUpKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0ZpbGUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHRvUG9zdGdyZXNWYWx1ZShmaWVsZFZhbHVlKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnR2VvUG9pbnQnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gUE9JTlQoJCR7aW5kZXggKyAxfSwgJCR7aW5kZXggKyAyfSlgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLmxvbmdpdHVkZSwgZmllbGRWYWx1ZS5sYXRpdHVkZSk7XG4gICAgICAgIGluZGV4ICs9IDM7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBjb252ZXJ0UG9seWdvblRvU1FMKGZpZWxkVmFsdWUuY29vcmRpbmF0ZXMpO1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX06OnBvbHlnb25gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCB2YWx1ZSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIC8vIG5vb3BcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgdHlwZW9mIGZpZWxkVmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJlxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ09iamVjdCdcbiAgICAgICkge1xuICAgICAgICAvLyBHYXRoZXIga2V5cyB0byBpbmNyZW1lbnRcbiAgICAgICAgY29uc3Qga2V5c1RvSW5jcmVtZW50ID0gT2JqZWN0LmtleXMob3JpZ2luYWxVcGRhdGUpXG4gICAgICAgICAgLmZpbHRlcihrID0+IHtcbiAgICAgICAgICAgIC8vIGNob29zZSB0b3AgbGV2ZWwgZmllbGRzIHRoYXQgaGF2ZSBhIGRlbGV0ZSBvcGVyYXRpb24gc2V0XG4gICAgICAgICAgICAvLyBOb3RlIHRoYXQgT2JqZWN0LmtleXMgaXMgaXRlcmF0aW5nIG92ZXIgdGhlICoqb3JpZ2luYWwqKiB1cGRhdGUgb2JqZWN0XG4gICAgICAgICAgICAvLyBhbmQgdGhhdCBzb21lIG9mIHRoZSBrZXlzIG9mIHRoZSBvcmlnaW5hbCB1cGRhdGUgY291bGQgYmUgbnVsbCBvciB1bmRlZmluZWQ6XG4gICAgICAgICAgICAvLyAoU2VlIHRoZSBhYm92ZSBjaGVjayBgaWYgKGZpZWxkVmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIGZpZWxkVmFsdWUgPT0gXCJ1bmRlZmluZWRcIilgKVxuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBvcmlnaW5hbFVwZGF0ZVtrXTtcbiAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgIHZhbHVlICYmXG4gICAgICAgICAgICAgIHZhbHVlLl9fb3AgPT09ICdJbmNyZW1lbnQnICYmXG4gICAgICAgICAgICAgIGsuc3BsaXQoJy4nKS5sZW5ndGggPT09IDIgJiZcbiAgICAgICAgICAgICAgay5zcGxpdCgnLicpWzBdID09PSBmaWVsZE5hbWVcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAubWFwKGsgPT4gay5zcGxpdCgnLicpWzFdKTtcblxuICAgICAgICBsZXQgaW5jcmVtZW50UGF0dGVybnMgPSAnJztcbiAgICAgICAgY29uc3QgaW5jcmVtZW50VmFsdWVzID0gW107XG4gICAgICAgIGlmIChrZXlzVG9JbmNyZW1lbnQubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGluY3JlbWVudFBhdHRlcm5zID1cbiAgICAgICAgICAgICcgfHwgJyArXG4gICAgICAgICAgICBrZXlzVG9JbmNyZW1lbnRcbiAgICAgICAgICAgICAgLm1hcChjID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBhbW91bnQgPSBmaWVsZFZhbHVlW2NdLmFtb3VudDtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGFtb3VudCAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdpbmNyZW1lbnRpbmcgbXVzdCBwcm92aWRlIGEgbnVtYmVyJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGluY3JlbWVudFZhbHVlcy5wdXNoKGFtb3VudCk7XG4gICAgICAgICAgICAgICAgY29uc3QgYW1vdW50SW5kZXggPSBpbmRleCArIGluY3JlbWVudFZhbHVlcy5sZW5ndGg7XG4gICAgICAgICAgICAgICAgY29uc3QganNvblNhZmVOYW1lID0gZXNjYXBlU3FsU3RyaW5nKGVzY2FwZUpzb25TdHJpbmcoYykpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHNxbFNhZmVOYW1lID0gZXNjYXBlU3FsU3RyaW5nKGMpO1xuICAgICAgICAgICAgICAgIHJldHVybiBgQ09OQ0FUKCd7XCIke2pzb25TYWZlTmFtZX1cIjonLCBDT0FMRVNDRSgkJHtpbmRleH06bmFtZS0+Picke3NxbFNhZmVOYW1lfScsJzAnKTo6aW50ICsgJCR7YW1vdW50SW5kZXh9LCAnfScpOjpqc29uYmA7XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIC5qb2luKCcgfHwgJyk7XG4gICAgICAgICAgLy8gU3RyaXAgdGhlIGtleXNcbiAgICAgICAgICBrZXlzVG9JbmNyZW1lbnQuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgICAgZGVsZXRlIGZpZWxkVmFsdWVba2V5XTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGtleXNUb0RlbGV0ZTogQXJyYXk8c3RyaW5nPiA9IE9iamVjdC5rZXlzKG9yaWdpbmFsVXBkYXRlKVxuICAgICAgICAgIC5maWx0ZXIoayA9PiB7XG4gICAgICAgICAgICAvLyBjaG9vc2UgdG9wIGxldmVsIGZpZWxkcyB0aGF0IGhhdmUgYSBkZWxldGUgb3BlcmF0aW9uIHNldC5cbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gb3JpZ2luYWxVcGRhdGVba107XG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICB2YWx1ZSAmJlxuICAgICAgICAgICAgICB2YWx1ZS5fX29wID09PSAnRGVsZXRlJyAmJlxuICAgICAgICAgICAgICBrLnNwbGl0KCcuJykubGVuZ3RoID09PSAyICYmXG4gICAgICAgICAgICAgIGsuc3BsaXQoJy4nKVswXSA9PT0gZmllbGROYW1lXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLm1hcChrID0+IGsuc3BsaXQoJy4nKVsxXSk7XG5cbiAgICAgICAgY29uc3QgZGVsZXRlUGF0dGVybnMgPSBrZXlzVG9EZWxldGUucmVkdWNlKChwOiBzdHJpbmcsIGM6IHN0cmluZywgaTogbnVtYmVyKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHAgKyBgIC0gJyQke2luZGV4ICsgMSArIGluY3JlbWVudFZhbHVlcy5sZW5ndGggKyBpfTp2YWx1ZSdgO1xuICAgICAgICB9LCAnJyk7XG4gICAgICAgIC8vIE92ZXJyaWRlIE9iamVjdFxuICAgICAgICBsZXQgdXBkYXRlT2JqZWN0ID0gXCIne30nOjpqc29uYlwiO1xuXG4gICAgICAgIGlmIChkb3ROb3RhdGlvbk9wdGlvbnNbZmllbGROYW1lXSkge1xuICAgICAgICAgIC8vIE1lcmdlIE9iamVjdFxuICAgICAgICAgIHVwZGF0ZU9iamVjdCA9IGBDT0FMRVNDRSgkJHtpbmRleH06bmFtZSwgJ3t9Jzo6anNvbmIpYDtcbiAgICAgICAgfVxuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKFxuICAgICAgICAgIGAkJHtpbmRleH06bmFtZSA9ICgke3VwZGF0ZU9iamVjdH0gJHtkZWxldGVQYXR0ZXJuc30gJHtpbmNyZW1lbnRQYXR0ZXJuc30gfHwgJCR7aW5kZXggKyAxICsgaW5jcmVtZW50VmFsdWVzLmxlbmd0aCArIGtleXNUb0RlbGV0ZS5sZW5ndGhcbiAgICAgICAgICB9Ojpqc29uYiApYFxuICAgICAgICApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIC4uLmluY3JlbWVudFZhbHVlcywgLi4ua2V5c1RvRGVsZXRlLCBKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlKSk7XG4gICAgICAgIGluZGV4ICs9IDIgKyBpbmNyZW1lbnRWYWx1ZXMubGVuZ3RoICsga2V5c1RvRGVsZXRlLmxlbmd0aDtcbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgIEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZSkgJiZcbiAgICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmXG4gICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnQXJyYXknXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gcGFyc2VUeXBlVG9Qb3N0Z3Jlc1R5cGUoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdKTtcbiAgICAgICAgaWYgKGV4cGVjdGVkVHlwZSA9PT0gJ3RleHRbXScpIHtcbiAgICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX06OnRleHRbXWApO1xuICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX06Ompzb25iYCk7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlKSk7XG4gICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVidWcoJ05vdCBzdXBwb3J0ZWQgdXBkYXRlJywgeyBmaWVsZE5hbWUsIGZpZWxkVmFsdWUgfSk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcbiAgICAgICAgICBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICAgICAgYFBvc3RncmVzIGRvZXNuJ3Qgc3VwcG9ydCB1cGRhdGUgJHtKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlKX0geWV0YFxuICAgICAgICAgIClcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkV2hlcmVDbGF1c2Uoe1xuICAgICAgc2NoZW1hLFxuICAgICAgaW5kZXgsXG4gICAgICBxdWVyeSxcbiAgICAgIGNhc2VJbnNlbnNpdGl2ZTogZmFsc2UsXG4gICAgfSk7XG4gICAgdmFsdWVzLnB1c2goLi4ud2hlcmUudmFsdWVzKTtcblxuICAgIGNvbnN0IHdoZXJlQ2xhdXNlID0gd2hlcmUucGF0dGVybi5sZW5ndGggPiAwID8gYFdIRVJFICR7d2hlcmUucGF0dGVybn1gIDogJyc7XG4gICAgY29uc3QgcXMgPSBgVVBEQVRFICQxOm5hbWUgU0VUICR7dXBkYXRlUGF0dGVybnMuam9pbigpfSAke3doZXJlQ2xhdXNlfSBSRVRVUk5JTkcgKmA7XG4gICAgY29uc3QgcHJvbWlzZSA9ICh0cmFuc2FjdGlvbmFsU2Vzc2lvbiA/IHRyYW5zYWN0aW9uYWxTZXNzaW9uLnQgOiB0aGlzLl9jbGllbnQpXG4gICAgICAuYW55KHFzLCB2YWx1ZXMpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNVbmlxdWVJbmRleFZpb2xhdGlvbkVycm9yKSB7XG4gICAgICAgICAgY29uc3QgZXJyID0gbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLFxuICAgICAgICAgICAgJ0EgZHVwbGljYXRlIHZhbHVlIGZvciBhIGZpZWxkIHdpdGggdW5pcXVlIHZhbHVlcyB3YXMgcHJvdmlkZWQnXG4gICAgICAgICAgKTtcbiAgICAgICAgICBlcnIudW5kZXJseWluZ0Vycm9yID0gZXJyb3I7XG4gICAgICAgICAgaWYgKGVycm9yLmNvbnN0cmFpbnQpIHtcbiAgICAgICAgICAgIGNvbnN0IGF1dGhEYXRhTWF0Y2ggPSBlcnJvci5jb25zdHJhaW50Lm1hdGNoKC9fVXNlcl91bmlxdWVfYXV0aERhdGFfKFthLXpBLVowLTlfXSspX2lkLyk7XG4gICAgICAgICAgICBpZiAoYXV0aERhdGFNYXRjaCkge1xuICAgICAgICAgICAgICBlcnIudXNlckluZm8gPSB7IGR1cGxpY2F0ZWRfZmllbGQ6IGBfYXV0aF9kYXRhXyR7YXV0aERhdGFNYXRjaFsxXX1gIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjb25zdCBtYXRjaGVzID0gZXJyb3IuY29uc3RyYWludC5tYXRjaCgvdW5pcXVlXyhbYS16QS1aXSspLyk7XG4gICAgICAgICAgICAgIGlmIChtYXRjaGVzICYmIEFycmF5LmlzQXJyYXkobWF0Y2hlcykpIHtcbiAgICAgICAgICAgICAgICBlcnIudXNlckluZm8gPSB7IGR1cGxpY2F0ZWRfZmllbGQ6IG1hdGNoZXNbMV0gfTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgICBpZiAodHJhbnNhY3Rpb25hbFNlc3Npb24pIHtcbiAgICAgIHRyYW5zYWN0aW9uYWxTZXNzaW9uLmJhdGNoLnB1c2gocHJvbWlzZSk7XG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG5cbiAgLy8gSG9wZWZ1bGx5LCB3ZSBjYW4gZ2V0IHJpZCBvZiB0aGlzLiBJdCdzIG9ubHkgdXNlZCBmb3IgY29uZmlnIGFuZCBob29rcy5cbiAgdXBzZXJ0T25lT2JqZWN0KFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBxdWVyeTogUXVlcnlUeXBlLFxuICAgIHVwZGF0ZTogYW55LFxuICAgIHRyYW5zYWN0aW9uYWxTZXNzaW9uOiA/YW55XG4gICkge1xuICAgIGRlYnVnKCd1cHNlcnRPbmVPYmplY3QnKTtcbiAgICBjb25zdCBjcmVhdGVWYWx1ZSA9IE9iamVjdC5hc3NpZ24oe30sIHF1ZXJ5LCB1cGRhdGUpO1xuICAgIHJldHVybiB0aGlzLmNyZWF0ZU9iamVjdChjbGFzc05hbWUsIHNjaGVtYSwgY3JlYXRlVmFsdWUsIHRyYW5zYWN0aW9uYWxTZXNzaW9uKS5jYXRjaChlcnJvciA9PiB7XG4gICAgICAvLyBpZ25vcmUgZHVwbGljYXRlIHZhbHVlIGVycm9ycyBhcyBpdCdzIHVwc2VydFxuICAgICAgaWYgKGVycm9yLmNvZGUgIT09IFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSkge1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLmZpbmRPbmVBbmRVcGRhdGUoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCB1cGRhdGUsIHRyYW5zYWN0aW9uYWxTZXNzaW9uKTtcbiAgICB9KTtcbiAgfVxuXG4gIGZpbmQoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgeyBza2lwLCBsaW1pdCwgc29ydCwga2V5cywgY2FzZUluc2Vuc2l0aXZlLCBleHBsYWluIH06IFF1ZXJ5T3B0aW9uc1xuICApIHtcbiAgICBkZWJ1ZygnZmluZCcpO1xuICAgIGNvbnN0IGhhc0xpbWl0ID0gbGltaXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBoYXNTa2lwID0gc2tpcCAhPT0gdW5kZWZpbmVkO1xuICAgIGxldCB2YWx1ZXMgPSBbY2xhc3NOYW1lXTtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkV2hlcmVDbGF1c2Uoe1xuICAgICAgc2NoZW1hLFxuICAgICAgcXVlcnksXG4gICAgICBpbmRleDogMixcbiAgICAgIGNhc2VJbnNlbnNpdGl2ZSxcbiAgICB9KTtcbiAgICB2YWx1ZXMucHVzaCguLi53aGVyZS52YWx1ZXMpO1xuICAgIGNvbnN0IHdoZXJlUGF0dGVybiA9IHdoZXJlLnBhdHRlcm4ubGVuZ3RoID4gMCA/IGBXSEVSRSAke3doZXJlLnBhdHRlcm59YCA6ICcnO1xuICAgIGNvbnN0IGxpbWl0UGF0dGVybiA9IGhhc0xpbWl0ID8gYExJTUlUICQke3ZhbHVlcy5sZW5ndGggKyAxfWAgOiAnJztcbiAgICBpZiAoaGFzTGltaXQpIHtcbiAgICAgIHZhbHVlcy5wdXNoKGxpbWl0KTtcbiAgICB9XG4gICAgY29uc3Qgc2tpcFBhdHRlcm4gPSBoYXNTa2lwID8gYE9GRlNFVCAkJHt2YWx1ZXMubGVuZ3RoICsgMX1gIDogJyc7XG4gICAgaWYgKGhhc1NraXApIHtcbiAgICAgIHZhbHVlcy5wdXNoKHNraXApO1xuICAgIH1cblxuICAgIGxldCBzb3J0UGF0dGVybiA9ICcnO1xuICAgIGlmIChzb3J0KSB7XG4gICAgICBjb25zdCBzb3J0Q29weTogYW55ID0gc29ydDtcbiAgICAgIGNvbnN0IHNvcnRpbmcgPSBPYmplY3Qua2V5cyhzb3J0KVxuICAgICAgICAubWFwKGtleSA9PiB7XG4gICAgICAgICAgY29uc3QgdHJhbnNmb3JtS2V5ID0gdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMoa2V5KS5qb2luKCctPicpO1xuICAgICAgICAgIC8vIFVzaW5nICRpZHggcGF0dGVybiBnaXZlczogIG5vbi1pbnRlZ2VyIGNvbnN0YW50IGluIE9SREVSIEJZXG4gICAgICAgICAgaWYgKHNvcnRDb3B5W2tleV0gPT09IDEpIHtcbiAgICAgICAgICAgIHJldHVybiBgJHt0cmFuc2Zvcm1LZXl9IEFTQ2A7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBgJHt0cmFuc2Zvcm1LZXl9IERFU0NgO1xuICAgICAgICB9KVxuICAgICAgICAuam9pbigpO1xuICAgICAgc29ydFBhdHRlcm4gPSBzb3J0ICE9PSB1bmRlZmluZWQgJiYgT2JqZWN0LmtleXMoc29ydCkubGVuZ3RoID4gMCA/IGBPUkRFUiBCWSAke3NvcnRpbmd9YCA6ICcnO1xuICAgIH1cbiAgICBpZiAod2hlcmUuc29ydHMgJiYgT2JqZWN0LmtleXMoKHdoZXJlLnNvcnRzOiBhbnkpKS5sZW5ndGggPiAwKSB7XG4gICAgICBzb3J0UGF0dGVybiA9IGBPUkRFUiBCWSAke3doZXJlLnNvcnRzLmpvaW4oKX1gO1xuICAgIH1cblxuICAgIGxldCBjb2x1bW5zID0gJyonO1xuICAgIGlmIChrZXlzKSB7XG4gICAgICAvLyBFeGNsdWRlIGVtcHR5IGtleXNcbiAgICAgIC8vIFJlcGxhY2UgQUNMIGJ5IGl0J3Mga2V5c1xuICAgICAga2V5cyA9IGtleXMucmVkdWNlKChtZW1vLCBrZXkpID0+IHtcbiAgICAgICAgaWYgKGtleSA9PT0gJ0FDTCcpIHtcbiAgICAgICAgICBtZW1vLnB1c2goJ19ycGVybScpO1xuICAgICAgICAgIG1lbW8ucHVzaCgnX3dwZXJtJyk7XG4gICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAga2V5Lmxlbmd0aCA+IDAgJiZcbiAgICAgICAgICAvLyBSZW1vdmUgc2VsZWN0ZWQgZmllbGQgbm90IHJlZmVyZW5jZWQgaW4gdGhlIHNjaGVtYVxuICAgICAgICAgIC8vIFJlbGF0aW9uIGlzIG5vdCBhIGNvbHVtbiBpbiBwb3N0Z3Jlc1xuICAgICAgICAgIC8vICRzY29yZSBpcyBhIFBhcnNlIHNwZWNpYWwgZmllbGQgYW5kIGlzIGFsc28gbm90IGEgY29sdW1uXG4gICAgICAgICAgKChzY2hlbWEuZmllbGRzW2tleV0gJiYgc2NoZW1hLmZpZWxkc1trZXldLnR5cGUgIT09ICdSZWxhdGlvbicpIHx8IGtleSA9PT0gJyRzY29yZScpXG4gICAgICAgICkge1xuICAgICAgICAgIG1lbW8ucHVzaChrZXkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBtZW1vO1xuICAgICAgfSwgW10pO1xuICAgICAgY29sdW1ucyA9IGtleXNcbiAgICAgICAgLm1hcCgoa2V5LCBpbmRleCkgPT4ge1xuICAgICAgICAgIGlmIChrZXkgPT09ICckc2NvcmUnKSB7XG4gICAgICAgICAgICByZXR1cm4gYHRzX3JhbmtfY2QodG9fdHN2ZWN0b3IoJCR7Mn0sICQkezN9Om5hbWUpLCB0b190c3F1ZXJ5KCQkezR9LCAkJHs1fSksIDMyKSBhcyBzY29yZWA7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBgJCR7aW5kZXggKyB2YWx1ZXMubGVuZ3RoICsgMX06bmFtZWA7XG4gICAgICAgIH0pXG4gICAgICAgIC5qb2luKCk7XG4gICAgICB2YWx1ZXMgPSB2YWx1ZXMuY29uY2F0KGtleXMpO1xuICAgIH1cblxuICAgIGNvbnN0IG9yaWdpbmFsUXVlcnkgPSBgU0VMRUNUICR7Y29sdW1uc30gRlJPTSAkMTpuYW1lICR7d2hlcmVQYXR0ZXJufSAke3NvcnRQYXR0ZXJufSAke2xpbWl0UGF0dGVybn0gJHtza2lwUGF0dGVybn1gO1xuICAgIGNvbnN0IHFzID0gZXhwbGFpbiA/IHRoaXMuY3JlYXRlRXhwbGFpbmFibGVRdWVyeShvcmlnaW5hbFF1ZXJ5KSA6IG9yaWdpbmFsUXVlcnk7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudFxuICAgICAgLmFueShxcywgdmFsdWVzKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGVycm9yLmNvZGUgIT09IFBvc3RncmVzUmVsYXRpb25Eb2VzTm90RXhpc3RFcnJvciAmJlxuICAgICAgICAgIGVycm9yLmNvZGUgIT09IFBvc3RncmVzTWlzc2luZ0NvbHVtbkVycm9yXG4gICAgICAgICkge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH0pXG4gICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgaWYgKGV4cGxhaW4pIHtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0cy5tYXAob2JqZWN0ID0+IHRoaXMucG9zdGdyZXNPYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gQ29udmVydHMgZnJvbSBhIHBvc3RncmVzLWZvcm1hdCBvYmplY3QgdG8gYSBSRVNULWZvcm1hdCBvYmplY3QuXG4gIC8vIERvZXMgbm90IHN0cmlwIG91dCBhbnl0aGluZyBiYXNlZCBvbiBhIGxhY2sgb2YgYXV0aGVudGljYXRpb24uXG4gIHBvc3RncmVzT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHNjaGVtYTogYW55KSB7XG4gICAgT2JqZWN0LmtleXMoc2NoZW1hLmZpZWxkcykuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9pbnRlcicgJiYgb2JqZWN0W2ZpZWxkTmFtZV0pIHtcbiAgICAgICAgb2JqZWN0W2ZpZWxkTmFtZV0gPSB7XG4gICAgICAgICAgb2JqZWN0SWQ6IG9iamVjdFtmaWVsZE5hbWVdLFxuICAgICAgICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgICAgICAgIGNsYXNzTmFtZTogc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnRhcmdldENsYXNzLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgICBjbGFzc05hbWU6IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50YXJnZXRDbGFzcyxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0dlb1BvaW50Jykge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX3R5cGU6ICdHZW9Qb2ludCcsXG4gICAgICAgICAgbGF0aXR1ZGU6IG9iamVjdFtmaWVsZE5hbWVdLnksXG4gICAgICAgICAgbG9uZ2l0dWRlOiBvYmplY3RbZmllbGROYW1lXS54LFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgICAgbGV0IGNvb3JkcyA9IG5ldyBTdHJpbmcob2JqZWN0W2ZpZWxkTmFtZV0pO1xuICAgICAgICBjb29yZHMgPSBjb29yZHMuc3Vic3RyaW5nKDIsIGNvb3Jkcy5sZW5ndGggLSAyKS5zcGxpdCgnKSwoJyk7XG4gICAgICAgIGNvbnN0IHVwZGF0ZWRDb29yZHMgPSBjb29yZHMubWFwKHBvaW50ID0+IHtcbiAgICAgICAgICByZXR1cm4gW3BhcnNlRmxvYXQocG9pbnQuc3BsaXQoJywnKVsxXSksIHBhcnNlRmxvYXQocG9pbnQuc3BsaXQoJywnKVswXSldO1xuICAgICAgICB9KTtcbiAgICAgICAgb2JqZWN0W2ZpZWxkTmFtZV0gPSB7XG4gICAgICAgICAgX190eXBlOiAnUG9seWdvbicsXG4gICAgICAgICAgY29vcmRpbmF0ZXM6IHVwZGF0ZWRDb29yZHMsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdGaWxlJykge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX3R5cGU6ICdGaWxlJyxcbiAgICAgICAgICBuYW1lOiBvYmplY3RbZmllbGROYW1lXSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICAvL1RPRE86IHJlbW92ZSB0aGlzIHJlbGlhbmNlIG9uIHRoZSBtb25nbyBmb3JtYXQuIERCIGFkYXB0ZXIgc2hvdWxkbid0IGtub3cgdGhlcmUgaXMgYSBkaWZmZXJlbmNlIGJldHdlZW4gY3JlYXRlZCBhdCBhbmQgYW55IG90aGVyIGRhdGUgZmllbGQuXG4gICAgaWYgKG9iamVjdC5jcmVhdGVkQXQpIHtcbiAgICAgIG9iamVjdC5jcmVhdGVkQXQgPSBvYmplY3QuY3JlYXRlZEF0LnRvSVNPU3RyaW5nKCk7XG4gICAgfVxuICAgIGlmIChvYmplY3QudXBkYXRlZEF0KSB7XG4gICAgICBvYmplY3QudXBkYXRlZEF0ID0gb2JqZWN0LnVwZGF0ZWRBdC50b0lTT1N0cmluZygpO1xuICAgIH1cbiAgICBpZiAob2JqZWN0LmV4cGlyZXNBdCkge1xuICAgICAgb2JqZWN0LmV4cGlyZXNBdCA9IHtcbiAgICAgICAgX190eXBlOiAnRGF0ZScsXG4gICAgICAgIGlzbzogb2JqZWN0LmV4cGlyZXNBdC50b0lTT1N0cmluZygpLFxuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKG9iamVjdC5fZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQpIHtcbiAgICAgIG9iamVjdC5fZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQgPSB7XG4gICAgICAgIF9fdHlwZTogJ0RhdGUnLFxuICAgICAgICBpc286IG9iamVjdC5fZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQudG9JU09TdHJpbmcoKSxcbiAgICAgIH07XG4gICAgfVxuICAgIGlmIChvYmplY3QuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0KSB7XG4gICAgICBvYmplY3QuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0ID0ge1xuICAgICAgICBfX3R5cGU6ICdEYXRlJyxcbiAgICAgICAgaXNvOiBvYmplY3QuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0LnRvSVNPU3RyaW5nKCksXG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAob2JqZWN0Ll9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQpIHtcbiAgICAgIG9iamVjdC5fcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0ID0ge1xuICAgICAgICBfX3R5cGU6ICdEYXRlJyxcbiAgICAgICAgaXNvOiBvYmplY3QuX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdC50b0lTT1N0cmluZygpLFxuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKG9iamVjdC5fcGFzc3dvcmRfY2hhbmdlZF9hdCkge1xuICAgICAgb2JqZWN0Ll9wYXNzd29yZF9jaGFuZ2VkX2F0ID0ge1xuICAgICAgICBfX3R5cGU6ICdEYXRlJyxcbiAgICAgICAgaXNvOiBvYmplY3QuX3Bhc3N3b3JkX2NoYW5nZWRfYXQudG9JU09TdHJpbmcoKSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gb2JqZWN0KSB7XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gPT09IG51bGwpIHtcbiAgICAgICAgZGVsZXRlIG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgfVxuICAgICAgaWYgKFV0aWxzLmlzRGF0ZShvYmplY3RbZmllbGROYW1lXSkpIHtcbiAgICAgICAgb2JqZWN0W2ZpZWxkTmFtZV0gPSB7XG4gICAgICAgICAgX190eXBlOiAnRGF0ZScsXG4gICAgICAgICAgaXNvOiBvYmplY3RbZmllbGROYW1lXS50b0lTT1N0cmluZygpLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cblxuICAvLyBDcmVhdGUgYSB1bmlxdWUgaW5kZXguIFVuaXF1ZSBpbmRleGVzIG9uIG51bGxhYmxlIGZpZWxkcyBhcmUgbm90IGFsbG93ZWQuIFNpbmNlIHdlIGRvbid0XG4gIC8vIGN1cnJlbnRseSBrbm93IHdoaWNoIGZpZWxkcyBhcmUgbnVsbGFibGUgYW5kIHdoaWNoIGFyZW4ndCwgd2UgaWdub3JlIHRoYXQgY3JpdGVyaWEuXG4gIC8vIEFzIHN1Y2gsIHdlIHNob3VsZG4ndCBleHBvc2UgdGhpcyBmdW5jdGlvbiB0byB1c2VycyBvZiBwYXJzZSB1bnRpbCB3ZSBoYXZlIGFuIG91dC1vZi1iYW5kXG4gIC8vIFdheSBvZiBkZXRlcm1pbmluZyBpZiBhIGZpZWxkIGlzIG51bGxhYmxlLiBVbmRlZmluZWQgZG9lc24ndCBjb3VudCBhZ2FpbnN0IHVuaXF1ZW5lc3MsXG4gIC8vIHdoaWNoIGlzIHdoeSB3ZSB1c2Ugc3BhcnNlIGluZGV4ZXMuXG4gIGFzeW5jIGVuc3VyZVVuaXF1ZW5lc3MoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgZmllbGROYW1lczogc3RyaW5nW10pIHtcbiAgICBjb25zdCBjb25zdHJhaW50TmFtZSA9IGAke2NsYXNzTmFtZX1fdW5pcXVlXyR7ZmllbGROYW1lcy5zb3J0KCkuam9pbignXycpfWA7XG4gICAgY29uc3QgY29uc3RyYWludFBhdHRlcm5zID0gZmllbGROYW1lcy5tYXAoKGZpZWxkTmFtZSwgaW5kZXgpID0+IGAkJHtpbmRleCArIDN9Om5hbWVgKTtcbiAgICBjb25zdCBxcyA9IGBDUkVBVEUgVU5JUVVFIElOREVYIElGIE5PVCBFWElTVFMgJDI6bmFtZSBPTiAkMTpuYW1lKCR7Y29uc3RyYWludFBhdHRlcm5zLmpvaW4oKX0pYDtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50Lm5vbmUocXMsIFtjbGFzc05hbWUsIGNvbnN0cmFpbnROYW1lLCAuLi5maWVsZE5hbWVzXSkuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgaWYgKGVycm9yLmNvZGUgPT09IFBvc3RncmVzRHVwbGljYXRlUmVsYXRpb25FcnJvciAmJiBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKGNvbnN0cmFpbnROYW1lKSkge1xuICAgICAgICAvLyBJbmRleCBhbHJlYWR5IGV4aXN0cy4gSWdub3JlIGVycm9yLlxuICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNVbmlxdWVJbmRleFZpb2xhdGlvbkVycm9yICYmXG4gICAgICAgIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoY29uc3RyYWludE5hbWUpXG4gICAgICApIHtcbiAgICAgICAgLy8gQ2FzdCB0aGUgZXJyb3IgaW50byB0aGUgcHJvcGVyIHBhcnNlIGVycm9yXG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsXG4gICAgICAgICAgJ0EgZHVwbGljYXRlIHZhbHVlIGZvciBhIGZpZWxkIHdpdGggdW5pcXVlIHZhbHVlcyB3YXMgcHJvdmlkZWQnXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIENyZWF0ZXMgYSB1bmlxdWUgaW5kZXggb24gYXV0aERhdGEtPjxwcm92aWRlcj4tPj4naWQnIHRvIHByZXZlbnRcbiAgLy8gcmFjZSBjb25kaXRpb25zIGR1cmluZyBjb25jdXJyZW50IHNpZ251cHMgd2l0aCB0aGUgc2FtZSBhdXRoRGF0YS5cbiAgYXN5bmMgZW5zdXJlQXV0aERhdGFVbmlxdWVuZXNzKHByb3ZpZGVyOiBzdHJpbmcpIHtcbiAgICBjb25zdCBpbmRleE5hbWUgPSBgX1VzZXJfdW5pcXVlX2F1dGhEYXRhXyR7cHJvdmlkZXJ9X2lkYDtcbiAgICBjb25zdCBxcyA9IGBDUkVBVEUgVU5JUVVFIElOREVYIElGIE5PVCBFWElTVFMgJDE6bmFtZSBPTiBcIl9Vc2VyXCIgKChcImF1dGhEYXRhXCItPiQyOjp0ZXh0LT4+J2lkJykpIFdIRVJFIFwiYXV0aERhdGFcIi0+JDI6OnRleHQtPj4naWQnIElTIE5PVCBOVUxMYDtcbiAgICBhd2FpdCB0aGlzLl9jbGllbnQubm9uZShxcywgW2luZGV4TmFtZSwgcHJvdmlkZXJdKS5jYXRjaChlcnJvciA9PiB7XG4gICAgICBpZiAoXG4gICAgICAgIGVycm9yLmNvZGUgPT09IFBvc3RncmVzRHVwbGljYXRlUmVsYXRpb25FcnJvciAmJlxuICAgICAgICBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKGluZGV4TmFtZSlcbiAgICAgICkge1xuICAgICAgICAvLyBJbmRleCBhbHJlYWR5IGV4aXN0cy4gSWdub3JlIGVycm9yLlxuICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNVbmlxdWVJbmRleFZpb2xhdGlvbkVycm9yICYmXG4gICAgICAgIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoaW5kZXhOYW1lKVxuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsXG4gICAgICAgICAgJ1RyaWVkIHRvIGVuc3VyZSBmaWVsZCB1bmlxdWVuZXNzIGZvciBhIGNsYXNzIHRoYXQgYWxyZWFkeSBoYXMgZHVwbGljYXRlcy4nXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIEV4ZWN1dGVzIGEgY291bnQuXG4gIGFzeW5jIGNvdW50KFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBxdWVyeTogUXVlcnlUeXBlLFxuICAgIHJlYWRQcmVmZXJlbmNlPzogc3RyaW5nLFxuICAgIGVzdGltYXRlPzogYm9vbGVhbiA9IHRydWVcbiAgKSB7XG4gICAgZGVidWcoJ2NvdW50Jyk7XG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZV07XG4gICAgY29uc3Qgd2hlcmUgPSBidWlsZFdoZXJlQ2xhdXNlKHtcbiAgICAgIHNjaGVtYSxcbiAgICAgIHF1ZXJ5LFxuICAgICAgaW5kZXg6IDIsXG4gICAgICBjYXNlSW5zZW5zaXRpdmU6IGZhbHNlLFxuICAgIH0pO1xuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG5cbiAgICBjb25zdCB3aGVyZVBhdHRlcm4gPSB3aGVyZS5wYXR0ZXJuLmxlbmd0aCA+IDAgPyBgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufWAgOiAnJztcbiAgICBsZXQgcXMgPSAnJztcblxuICAgIGlmICh3aGVyZS5wYXR0ZXJuLmxlbmd0aCA+IDAgfHwgIWVzdGltYXRlKSB7XG4gICAgICBxcyA9IGBTRUxFQ1QgY291bnQoKikgRlJPTSAkMTpuYW1lICR7d2hlcmVQYXR0ZXJufWA7XG4gICAgfSBlbHNlIHtcbiAgICAgIHFzID0gJ1NFTEVDVCByZWx0dXBsZXMgQVMgYXBwcm94aW1hdGVfcm93X2NvdW50IEZST00gcGdfY2xhc3MgV0hFUkUgcmVsbmFtZSA9ICQxJztcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY2xpZW50XG4gICAgICAub25lKHFzLCB2YWx1ZXMsIGEgPT4ge1xuICAgICAgICBpZiAoYS5hcHByb3hpbWF0ZV9yb3dfY291bnQgPT0gbnVsbCB8fCBhLmFwcHJveGltYXRlX3Jvd19jb3VudCA9PSAtMSkge1xuICAgICAgICAgIHJldHVybiAhaXNOYU4oK2EuY291bnQpID8gK2EuY291bnQgOiAwO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiArYS5hcHByb3hpbWF0ZV9yb3dfY291bnQ7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yICYmXG4gICAgICAgICAgZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNNaXNzaW5nQ29sdW1uRXJyb3JcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGRpc3RpbmN0KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIGZpZWxkTmFtZTogc3RyaW5nKSB7XG4gICAgZGVidWcoJ2Rpc3RpbmN0Jyk7XG4gICAgY29uc3QgZmllbGRTZWdtZW50cyA9IGZpZWxkTmFtZS5zcGxpdCgnLicpO1xuICAgIGZvciAoY29uc3Qgc2VnbWVudCBvZiBmaWVsZFNlZ21lbnRzKSB7XG4gICAgICBpZiAoIXNlZ21lbnQubWF0Y2goL15bYS16QS1aXVthLXpBLVowLTlfXSokLykpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsIGBJbnZhbGlkIGZpZWxkIG5hbWU6ICR7ZmllbGROYW1lfWApO1xuICAgICAgfVxuICAgIH1cbiAgICBsZXQgZmllbGQgPSBmaWVsZE5hbWU7XG4gICAgbGV0IGNvbHVtbiA9IGZpZWxkTmFtZTtcbiAgICBjb25zdCBpc05lc3RlZCA9IGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPj0gMDtcbiAgICBpZiAoaXNOZXN0ZWQpIHtcbiAgICAgIGZpZWxkID0gdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMoZmllbGROYW1lKS5qb2luKCctPicpO1xuICAgICAgY29sdW1uID0gZmllbGRTZWdtZW50c1swXTtcbiAgICB9XG4gICAgY29uc3QgaXNBcnJheUZpZWxkID1cbiAgICAgIHNjaGVtYS5maWVsZHMgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnQXJyYXknO1xuICAgIGNvbnN0IGlzUG9pbnRlckZpZWxkID1cbiAgICAgIHNjaGVtYS5maWVsZHMgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9pbnRlcic7XG4gICAgY29uc3QgdmFsdWVzID0gW2ZpZWxkLCBjb2x1bW4sIGNsYXNzTmFtZV07XG4gICAgY29uc3Qgd2hlcmUgPSBidWlsZFdoZXJlQ2xhdXNlKHtcbiAgICAgIHNjaGVtYSxcbiAgICAgIHF1ZXJ5LFxuICAgICAgaW5kZXg6IDQsXG4gICAgICBjYXNlSW5zZW5zaXRpdmU6IGZhbHNlLFxuICAgIH0pO1xuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG5cbiAgICBjb25zdCB3aGVyZVBhdHRlcm4gPSB3aGVyZS5wYXR0ZXJuLmxlbmd0aCA+IDAgPyBgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufWAgOiAnJztcbiAgICBjb25zdCB0cmFuc2Zvcm1lciA9IGlzQXJyYXlGaWVsZCA/ICdqc29uYl9hcnJheV9lbGVtZW50cycgOiAnT04nO1xuICAgIGxldCBxcyA9IGBTRUxFQ1QgRElTVElOQ1QgJHt0cmFuc2Zvcm1lcn0oJDE6bmFtZSkgJDI6bmFtZSBGUk9NICQzOm5hbWUgJHt3aGVyZVBhdHRlcm59YDtcbiAgICBpZiAoaXNOZXN0ZWQpIHtcbiAgICAgIHFzID0gYFNFTEVDVCBESVNUSU5DVCAke3RyYW5zZm9ybWVyfSgkMTpyYXcpICQyOnJhdyBGUk9NICQzOm5hbWUgJHt3aGVyZVBhdHRlcm59YDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudFxuICAgICAgLmFueShxcywgdmFsdWVzKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IFBvc3RncmVzTWlzc2luZ0NvbHVtbkVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICBpZiAoIWlzTmVzdGVkKSB7XG4gICAgICAgICAgcmVzdWx0cyA9IHJlc3VsdHMuZmlsdGVyKG9iamVjdCA9PiBvYmplY3RbZmllbGRdICE9PSBudWxsKTtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0cy5tYXAob2JqZWN0ID0+IHtcbiAgICAgICAgICAgIGlmICghaXNQb2ludGVyRmllbGQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG9iamVjdFtmaWVsZF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgICAgICAgY2xhc3NOYW1lOiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udGFyZ2V0Q2xhc3MsXG4gICAgICAgICAgICAgIG9iamVjdElkOiBvYmplY3RbZmllbGRdLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBjaGlsZCA9IGZpZWxkTmFtZS5zcGxpdCgnLicpWzFdO1xuICAgICAgICByZXR1cm4gcmVzdWx0cy5tYXAob2JqZWN0ID0+IG9iamVjdFtjb2x1bW5dW2NoaWxkXSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PlxuICAgICAgICByZXN1bHRzLm1hcChvYmplY3QgPT4gdGhpcy5wb3N0Z3Jlc09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSkpXG4gICAgICApO1xuICB9XG5cbiAgYXN5bmMgYWdncmVnYXRlKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogYW55LFxuICAgIHBpcGVsaW5lOiBhbnksXG4gICAgcmVhZFByZWZlcmVuY2U6ID9zdHJpbmcsXG4gICAgaGludDogP21peGVkLFxuICAgIGV4cGxhaW4/OiBib29sZWFuXG4gICkge1xuICAgIGRlYnVnKCdhZ2dyZWdhdGUnKTtcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lXTtcbiAgICBsZXQgaW5kZXg6IG51bWJlciA9IDI7XG4gICAgbGV0IGNvbHVtbnM6IHN0cmluZ1tdID0gW107XG4gICAgbGV0IGNvdW50RmllbGQgPSBudWxsO1xuICAgIGxldCBncm91cFZhbHVlcyA9IG51bGw7XG4gICAgbGV0IHdoZXJlUGF0dGVybiA9ICcnO1xuICAgIGxldCBsaW1pdFBhdHRlcm4gPSAnJztcbiAgICBsZXQgc2tpcFBhdHRlcm4gPSAnJztcbiAgICBsZXQgc29ydFBhdHRlcm4gPSAnJztcbiAgICBsZXQgZ3JvdXBQYXR0ZXJuID0gJyc7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaXBlbGluZS5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgY29uc3Qgc3RhZ2UgPSBwaXBlbGluZVtpXTtcbiAgICAgIGlmIChzdGFnZS4kZ3JvdXApIHtcbiAgICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBzdGFnZS4kZ3JvdXApIHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IHN0YWdlLiRncm91cFtmaWVsZF07XG4gICAgICAgICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZmllbGQgPT09ICdfaWQnICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgdmFsdWUgIT09ICcnKSB7XG4gICAgICAgICAgICBjb2x1bW5zLnB1c2goYCQke2luZGV4fTpuYW1lIEFTIFwib2JqZWN0SWRcImApO1xuICAgICAgICAgICAgZ3JvdXBQYXR0ZXJuID0gYEdST1VQIEJZICQke2luZGV4fTpuYW1lYDtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlKSk7XG4gICAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChmaWVsZCA9PT0gJ19pZCcgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiBPYmplY3Qua2V5cyh2YWx1ZSkubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgICAgICBncm91cFZhbHVlcyA9IHZhbHVlO1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBCeUZpZWxkcyA9IFtdO1xuICAgICAgICAgICAgZm9yIChjb25zdCBhbGlhcyBpbiB2YWx1ZSkge1xuICAgICAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlW2FsaWFzXSA9PT0gJ3N0cmluZycgJiYgdmFsdWVbYWxpYXNdKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc291cmNlID0gdHJhbnNmb3JtQWdncmVnYXRlRmllbGQodmFsdWVbYWxpYXNdKTtcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQnlGaWVsZHMuaW5jbHVkZXMoYFwiJHtzb3VyY2V9XCJgKSkge1xuICAgICAgICAgICAgICAgICAgZ3JvdXBCeUZpZWxkcy5wdXNoKGBcIiR7c291cmNlfVwiYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHNvdXJjZSwgYWxpYXMpO1xuICAgICAgICAgICAgICAgIGNvbHVtbnMucHVzaChgJCR7aW5kZXh9Om5hbWUgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zdCBvcGVyYXRpb24gPSBPYmplY3Qua2V5cyh2YWx1ZVthbGlhc10pWzBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlW2FsaWFzXVtvcGVyYXRpb25dKTtcbiAgICAgICAgICAgICAgICBpZiAobW9uZ29BZ2dyZWdhdGVUb1Bvc3RncmVzW29wZXJhdGlvbl0pIHtcbiAgICAgICAgICAgICAgICAgIGlmICghZ3JvdXBCeUZpZWxkcy5pbmNsdWRlcyhgXCIke3NvdXJjZX1cImApKSB7XG4gICAgICAgICAgICAgICAgICAgIGdyb3VwQnlGaWVsZHMucHVzaChgXCIke3NvdXJjZX1cImApO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgY29sdW1ucy5wdXNoKFxuICAgICAgICAgICAgICAgICAgICBgRVhUUkFDVCgke21vbmdvQWdncmVnYXRlVG9Qb3N0Z3Jlc1tvcGVyYXRpb25dXG4gICAgICAgICAgICAgICAgICAgIH0gRlJPTSAkJHtpbmRleH06bmFtZSBBVCBUSU1FIFpPTkUgJ1VUQycpOjppbnRlZ2VyIEFTICQke2luZGV4ICsgMX06bmFtZWBcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICB2YWx1ZXMucHVzaChzb3VyY2UsIGFsaWFzKTtcbiAgICAgICAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBncm91cFBhdHRlcm4gPSBgR1JPVVAgQlkgJCR7aW5kZXh9OnJhd2A7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaChncm91cEJ5RmllbGRzLmpvaW4oKSk7XG4gICAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBpZiAodmFsdWUuJHN1bSkge1xuICAgICAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlLiRzdW0gPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgY29sdW1ucy5wdXNoKGBTVU0oJCR7aW5kZXh9Om5hbWUpIEFTICQke2luZGV4ICsgMX06bmFtZWApO1xuICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRzdW0pLCBmaWVsZCk7XG4gICAgICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb3VudEZpZWxkID0gZmllbGQ7XG4gICAgICAgICAgICAgICAgY29sdW1ucy5wdXNoKGBDT1VOVCgqKSBBUyAkJHtpbmRleH06bmFtZWApO1xuICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkKTtcbiAgICAgICAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsdWUuJG1heCkge1xuICAgICAgICAgICAgICBjb2x1bW5zLnB1c2goYE1BWCgkJHtpbmRleH06bmFtZSkgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRtYXgpLCBmaWVsZCk7XG4gICAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsdWUuJG1pbikge1xuICAgICAgICAgICAgICBjb2x1bW5zLnB1c2goYE1JTigkJHtpbmRleH06bmFtZSkgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRtaW4pLCBmaWVsZCk7XG4gICAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsdWUuJGF2Zykge1xuICAgICAgICAgICAgICBjb2x1bW5zLnB1c2goYEFWRygkJHtpbmRleH06bmFtZSkgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRhdmcpLCBmaWVsZCk7XG4gICAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb2x1bW5zLnB1c2goJyonKTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kcHJvamVjdCkge1xuICAgICAgICBpZiAoY29sdW1ucy5pbmNsdWRlcygnKicpKSB7XG4gICAgICAgICAgY29sdW1ucyA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZmllbGQgaW4gc3RhZ2UuJHByb2plY3QpIHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IHN0YWdlLiRwcm9qZWN0W2ZpZWxkXTtcbiAgICAgICAgICBpZiAodmFsdWUgPT09IDEgfHwgdmFsdWUgPT09IHRydWUpIHtcbiAgICAgICAgICAgIGNvbHVtbnMucHVzaChgJCR7aW5kZXh9Om5hbWVgKTtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJG1hdGNoKSB7XG4gICAgICAgIGNvbnN0IHBhdHRlcm5zID0gW107XG4gICAgICAgIGNvbnN0IG9yT3JBbmQgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoc3RhZ2UuJG1hdGNoLCAnJG9yJylcbiAgICAgICAgICA/ICcgT1IgJ1xuICAgICAgICAgIDogJyBBTkQgJztcblxuICAgICAgICBpZiAoc3RhZ2UuJG1hdGNoLiRvcikge1xuICAgICAgICAgIGNvbnN0IGNvbGxhcHNlID0ge307XG4gICAgICAgICAgc3RhZ2UuJG1hdGNoLiRvci5mb3JFYWNoKGVsZW1lbnQgPT4ge1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gZWxlbWVudCkge1xuICAgICAgICAgICAgICBjb2xsYXBzZVtrZXldID0gZWxlbWVudFtrZXldO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHN0YWdlLiRtYXRjaCA9IGNvbGxhcHNlO1xuICAgICAgICB9XG4gICAgICAgIGZvciAobGV0IGZpZWxkIGluIHN0YWdlLiRtYXRjaCkge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gc3RhZ2UuJG1hdGNoW2ZpZWxkXTtcbiAgICAgICAgICBpZiAoZmllbGQgPT09ICdfaWQnKSB7XG4gICAgICAgICAgICBmaWVsZCA9ICdvYmplY3RJZCc7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IG1hdGNoUGF0dGVybnMgPSBbXTtcbiAgICAgICAgICBPYmplY3Qua2V5cyhQYXJzZVRvUG9zZ3Jlc0NvbXBhcmF0b3IpLmZvckVhY2goY21wID0+IHtcbiAgICAgICAgICAgIGlmICh2YWx1ZVtjbXBdKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHBnQ29tcGFyYXRvciA9IFBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvcltjbXBdO1xuICAgICAgICAgICAgICBtYXRjaFBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lICR7cGdDb21wYXJhdG9yfSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkLCB0b1Bvc3RncmVzVmFsdWUodmFsdWVbY21wXSkpO1xuICAgICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChtYXRjaFBhdHRlcm5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCgke21hdGNoUGF0dGVybnMuam9pbignIEFORCAnKX0pYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlICYmIG1hdGNoUGF0dGVybnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkLCB2YWx1ZSk7XG4gICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB3aGVyZVBhdHRlcm4gPSBwYXR0ZXJucy5sZW5ndGggPiAwID8gYFdIRVJFICR7cGF0dGVybnMuam9pbihgICR7b3JPckFuZH0gYCl9YCA6ICcnO1xuICAgICAgfVxuICAgICAgaWYgKHN0YWdlLiRsaW1pdCkge1xuICAgICAgICBsaW1pdFBhdHRlcm4gPSBgTElNSVQgJCR7aW5kZXh9YDtcbiAgICAgICAgdmFsdWVzLnB1c2goc3RhZ2UuJGxpbWl0KTtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kc2tpcCkge1xuICAgICAgICBza2lwUGF0dGVybiA9IGBPRkZTRVQgJCR7aW5kZXh9YDtcbiAgICAgICAgdmFsdWVzLnB1c2goc3RhZ2UuJHNraXApO1xuICAgICAgICBpbmRleCArPSAxO1xuICAgICAgfVxuICAgICAgaWYgKHN0YWdlLiRzb3J0KSB7XG4gICAgICAgIGNvbnN0IHNvcnQgPSBzdGFnZS4kc29ydDtcbiAgICAgICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHNvcnQpO1xuICAgICAgICBjb25zdCBzb3J0aW5nID0ga2V5c1xuICAgICAgICAgIC5tYXAoa2V5ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRyYW5zZm9ybWVyID0gc29ydFtrZXldID09PSAxID8gJ0FTQycgOiAnREVTQyc7XG4gICAgICAgICAgICBjb25zdCBvcmRlciA9IGAkJHtpbmRleH06bmFtZSAke3RyYW5zZm9ybWVyfWA7XG4gICAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgICAgcmV0dXJuIG9yZGVyO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmpvaW4oKTtcbiAgICAgICAgdmFsdWVzLnB1c2goLi4ua2V5cyk7XG4gICAgICAgIHNvcnRQYXR0ZXJuID0gc29ydCAhPT0gdW5kZWZpbmVkICYmIHNvcnRpbmcubGVuZ3RoID4gMCA/IGBPUkRFUiBCWSAke3NvcnRpbmd9YCA6ICcnO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChncm91cFBhdHRlcm4pIHtcbiAgICAgIGNvbHVtbnMuZm9yRWFjaCgoZSwgaSwgYSkgPT4ge1xuICAgICAgICBpZiAoZSAmJiBlLnRyaW0oKSA9PT0gJyonKSB7XG4gICAgICAgICAgYVtpXSA9ICcnO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBvcmlnaW5hbFF1ZXJ5ID0gYFNFTEVDVCAke2NvbHVtbnNcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKCl9IEZST00gJDE6bmFtZSAke3doZXJlUGF0dGVybn0gJHtza2lwUGF0dGVybn0gJHtncm91cFBhdHRlcm59ICR7c29ydFBhdHRlcm59ICR7bGltaXRQYXR0ZXJufWA7XG4gICAgY29uc3QgcXMgPSBleHBsYWluID8gdGhpcy5jcmVhdGVFeHBsYWluYWJsZVF1ZXJ5KG9yaWdpbmFsUXVlcnkpIDogb3JpZ2luYWxRdWVyeTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50LmFueShxcywgdmFsdWVzKS50aGVuKGEgPT4ge1xuICAgICAgaWYgKGV4cGxhaW4pIHtcbiAgICAgICAgcmV0dXJuIGE7XG4gICAgICB9XG4gICAgICBjb25zdCByZXN1bHRzID0gYS5tYXAob2JqZWN0ID0+IHRoaXMucG9zdGdyZXNPYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpKTtcbiAgICAgIHJlc3VsdHMuZm9yRWFjaChyZXN1bHQgPT4ge1xuICAgICAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChyZXN1bHQsICdvYmplY3RJZCcpKSB7XG4gICAgICAgICAgcmVzdWx0Lm9iamVjdElkID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZ3JvdXBWYWx1ZXMpIHtcbiAgICAgICAgICByZXN1bHQub2JqZWN0SWQgPSB7fTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBncm91cFZhbHVlcykge1xuICAgICAgICAgICAgcmVzdWx0Lm9iamVjdElkW2tleV0gPSByZXN1bHRba2V5XTtcbiAgICAgICAgICAgIGRlbGV0ZSByZXN1bHRba2V5XTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNvdW50RmllbGQpIHtcbiAgICAgICAgICByZXN1bHRbY291bnRGaWVsZF0gPSBwYXJzZUludChyZXN1bHRbY291bnRGaWVsZF0sIDEwKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHBlcmZvcm1Jbml0aWFsaXphdGlvbih7IFZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMgfTogYW55KSB7XG4gICAgLy8gVE9ETzogVGhpcyBtZXRob2QgbmVlZHMgdG8gYmUgcmV3cml0dGVuIHRvIG1ha2UgcHJvcGVyIHVzZSBvZiBjb25uZWN0aW9ucyAoQHZpdGFseS10KVxuICAgIGRlYnVnKCdwZXJmb3JtSW5pdGlhbGl6YXRpb24nKTtcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlbWFDb2xsZWN0aW9uRXhpc3RzKCk7XG4gICAgY29uc3QgcHJvbWlzZXMgPSBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzLm1hcChzY2hlbWEgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGFibGUoc2NoZW1hLmNsYXNzTmFtZSwgc2NoZW1hKVxuICAgICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBlcnIuY29kZSA9PT0gUG9zdGdyZXNEdXBsaWNhdGVSZWxhdGlvbkVycm9yIHx8XG4gICAgICAgICAgICBlcnIuY29kZSA9PT0gUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5zY2hlbWFVcGdyYWRlKHNjaGVtYS5jbGFzc05hbWUsIHNjaGVtYSkpO1xuICAgIH0pO1xuICAgIHByb21pc2VzLnB1c2godGhpcy5fbGlzdGVuVG9TY2hlbWEoKSk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2xpZW50LnR4KCdwZXJmb3JtLWluaXRpYWxpemF0aW9uJywgYXN5bmMgdCA9PiB7XG4gICAgICAgICAgYXdhaXQgdC5ub25lKHNxbC5taXNjLmpzb25PYmplY3RTZXRLZXlzKTtcbiAgICAgICAgICBhd2FpdCB0Lm5vbmUoc3FsLmFycmF5LmFkZCk7XG4gICAgICAgICAgYXdhaXQgdC5ub25lKHNxbC5hcnJheS5hZGRVbmlxdWUpO1xuICAgICAgICAgIGF3YWl0IHQubm9uZShzcWwuYXJyYXkucmVtb3ZlKTtcbiAgICAgICAgICBhd2FpdCB0Lm5vbmUoc3FsLmFycmF5LmNvbnRhaW5zQWxsKTtcbiAgICAgICAgICBhd2FpdCB0Lm5vbmUoc3FsLmFycmF5LmNvbnRhaW5zQWxsUmVnZXgpO1xuICAgICAgICAgIGF3YWl0IHQubm9uZShzcWwuYXJyYXkuY29udGFpbnMpO1xuICAgICAgICAgIHJldHVybiB0LmN0eDtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oY3R4ID0+IHtcbiAgICAgICAgZGVidWcoYGluaXRpYWxpemF0aW9uRG9uZSBpbiAke2N0eC5kdXJhdGlvbn1gKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlSW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZywgaW5kZXhlczogYW55LCBjb25uOiA/YW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIChjb25uIHx8IHRoaXMuX2NsaWVudCkudHgodCA9PlxuICAgICAgdC5iYXRjaChcbiAgICAgICAgaW5kZXhlcy5tYXAoaSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHQubm9uZSgnQ1JFQVRFIElOREVYIElGIE5PVCBFWElTVFMgJDE6bmFtZSBPTiAkMjpuYW1lICgkMzpuYW1lKScsIFtcbiAgICAgICAgICAgIGkubmFtZSxcbiAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgIGkua2V5LFxuICAgICAgICAgIF0pO1xuICAgICAgICB9KVxuICAgICAgKVxuICAgICk7XG4gIH1cblxuICBhc3luYyBjcmVhdGVJbmRleGVzSWZOZWVkZWQoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGROYW1lOiBzdHJpbmcsXG4gICAgdHlwZTogYW55LFxuICAgIGNvbm46ID9hbnlcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgKGNvbm4gfHwgdGhpcy5fY2xpZW50KS5ub25lKCdDUkVBVEUgSU5ERVggSUYgTk9UIEVYSVNUUyAkMTpuYW1lIE9OICQyOm5hbWUgKCQzOm5hbWUpJywgW1xuICAgICAgZmllbGROYW1lLFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgdHlwZSxcbiAgICBdKTtcbiAgfVxuXG4gIGFzeW5jIGRyb3BJbmRleGVzKGNsYXNzTmFtZTogc3RyaW5nLCBpbmRleGVzOiBhbnksIGNvbm46IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHF1ZXJpZXMgPSBpbmRleGVzLm1hcChpID0+ICh7XG4gICAgICBxdWVyeTogJ0RST1AgSU5ERVggJDE6bmFtZScsXG4gICAgICB2YWx1ZXM6IGksXG4gICAgfSkpO1xuICAgIGF3YWl0IChjb25uIHx8IHRoaXMuX2NsaWVudCkudHgodCA9PiB0Lm5vbmUodGhpcy5fcGdwLmhlbHBlcnMuY29uY2F0KHF1ZXJpZXMpKSk7XG4gIH1cblxuICBhc3luYyBnZXRJbmRleGVzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgcXMgPSAnU0VMRUNUICogRlJPTSBwZ19pbmRleGVzIFdIRVJFIHRhYmxlbmFtZSA9ICR7Y2xhc3NOYW1lfSc7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC5hbnkocXMsIHsgY2xhc3NOYW1lIH0pO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlU2NoZW1hV2l0aEluZGV4ZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgLy8gVXNlZCBmb3IgdGVzdGluZyBwdXJwb3Nlc1xuICBhc3luYyB1cGRhdGVFc3RpbWF0ZWRDb3VudChjbGFzc05hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQubm9uZSgnQU5BTFlaRSAkMTpuYW1lJywgW2NsYXNzTmFtZV0pO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlVHJhbnNhY3Rpb25hbFNlc3Npb24oKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgICBjb25zdCB0cmFuc2FjdGlvbmFsU2Vzc2lvbiA9IHt9O1xuICAgICAgdHJhbnNhY3Rpb25hbFNlc3Npb24ucmVzdWx0ID0gdGhpcy5fY2xpZW50LnR4KHQgPT4ge1xuICAgICAgICB0cmFuc2FjdGlvbmFsU2Vzc2lvbi50ID0gdDtcbiAgICAgICAgdHJhbnNhY3Rpb25hbFNlc3Npb24ucHJvbWlzZSA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4ge1xuICAgICAgICAgIHRyYW5zYWN0aW9uYWxTZXNzaW9uLnJlc29sdmUgPSByZXNvbHZlO1xuICAgICAgICB9KTtcbiAgICAgICAgdHJhbnNhY3Rpb25hbFNlc3Npb24uYmF0Y2ggPSBbXTtcbiAgICAgICAgcmVzb2x2ZSh0cmFuc2FjdGlvbmFsU2Vzc2lvbik7XG4gICAgICAgIHJldHVybiB0cmFuc2FjdGlvbmFsU2Vzc2lvbi5wcm9taXNlO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBjb21taXRUcmFuc2FjdGlvbmFsU2Vzc2lvbih0cmFuc2FjdGlvbmFsU2Vzc2lvbjogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJhbnNhY3Rpb25hbFNlc3Npb24ucmVzb2x2ZSh0cmFuc2FjdGlvbmFsU2Vzc2lvbi50LmJhdGNoKHRyYW5zYWN0aW9uYWxTZXNzaW9uLmJhdGNoKSk7XG4gICAgcmV0dXJuIHRyYW5zYWN0aW9uYWxTZXNzaW9uLnJlc3VsdDtcbiAgfVxuXG4gIGFib3J0VHJhbnNhY3Rpb25hbFNlc3Npb24odHJhbnNhY3Rpb25hbFNlc3Npb246IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IHRyYW5zYWN0aW9uYWxTZXNzaW9uLnJlc3VsdC5jYXRjaCgpO1xuICAgIHRyYW5zYWN0aW9uYWxTZXNzaW9uLmJhdGNoLnB1c2goUHJvbWlzZS5yZWplY3QoKSk7XG4gICAgdHJhbnNhY3Rpb25hbFNlc3Npb24ucmVzb2x2ZSh0cmFuc2FjdGlvbmFsU2Vzc2lvbi50LmJhdGNoKHRyYW5zYWN0aW9uYWxTZXNzaW9uLmJhdGNoKSk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIGFzeW5jIGVuc3VyZUluZGV4KFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBmaWVsZE5hbWVzOiBzdHJpbmdbXSxcbiAgICBpbmRleE5hbWU6ID9zdHJpbmcsXG4gICAgY2FzZUluc2Vuc2l0aXZlOiBib29sZWFuID0gZmFsc2UsXG4gICAgb3B0aW9ucz86IE9iamVjdCA9IHt9XG4gICk6IFByb21pc2U8YW55PiB7XG4gICAgY29uc3QgY29ubiA9IG9wdGlvbnMuY29ubiAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5jb25uIDogdGhpcy5fY2xpZW50O1xuICAgIGNvbnN0IGRlZmF1bHRJbmRleE5hbWUgPSBgcGFyc2VfZGVmYXVsdF8ke2ZpZWxkTmFtZXMuc29ydCgpLmpvaW4oJ18nKX1gO1xuICAgIGNvbnN0IGluZGV4TmFtZU9wdGlvbnM6IE9iamVjdCA9XG4gICAgICBpbmRleE5hbWUgIT0gbnVsbCA/IHsgbmFtZTogaW5kZXhOYW1lIH0gOiB7IG5hbWU6IGRlZmF1bHRJbmRleE5hbWUgfTtcbiAgICBjb25zdCBjb25zdHJhaW50UGF0dGVybnMgPSBjYXNlSW5zZW5zaXRpdmVcbiAgICAgID8gZmllbGROYW1lcy5tYXAoKGZpZWxkTmFtZSwgaW5kZXgpID0+IGBsb3dlcigkJHtpbmRleCArIDN9Om5hbWUpIHZhcmNoYXJfcGF0dGVybl9vcHNgKVxuICAgICAgOiBmaWVsZE5hbWVzLm1hcCgoZmllbGROYW1lLCBpbmRleCkgPT4gYCQke2luZGV4ICsgM306bmFtZWApO1xuICAgIGNvbnN0IHFzID0gYENSRUFURSBJTkRFWCBJRiBOT1QgRVhJU1RTICQxOm5hbWUgT04gJDI6bmFtZSAoJHtjb25zdHJhaW50UGF0dGVybnMuam9pbigpfSlgO1xuICAgIGNvbnN0IHNldElkZW1wb3RlbmN5RnVuY3Rpb24gPVxuICAgICAgb3B0aW9ucy5zZXRJZGVtcG90ZW5jeUZ1bmN0aW9uICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLnNldElkZW1wb3RlbmN5RnVuY3Rpb24gOiBmYWxzZTtcbiAgICBpZiAoc2V0SWRlbXBvdGVuY3lGdW5jdGlvbikge1xuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVJZGVtcG90ZW5jeUZ1bmN0aW9uRXhpc3RzKG9wdGlvbnMpO1xuICAgIH1cbiAgICBhd2FpdCBjb25uLm5vbmUocXMsIFtpbmRleE5hbWVPcHRpb25zLm5hbWUsIGNsYXNzTmFtZSwgLi4uZmllbGROYW1lc10pLmNhdGNoKGVycm9yID0+IHtcbiAgICAgIGlmIChcbiAgICAgICAgZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNEdXBsaWNhdGVSZWxhdGlvbkVycm9yICYmXG4gICAgICAgIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoaW5kZXhOYW1lT3B0aW9ucy5uYW1lKVxuICAgICAgKSB7XG4gICAgICAgIC8vIEluZGV4IGFscmVhZHkgZXhpc3RzLiBJZ25vcmUgZXJyb3IuXG4gICAgICB9IGVsc2UgaWYgKFxuICAgICAgICBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3IgJiZcbiAgICAgICAgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhpbmRleE5hbWVPcHRpb25zLm5hbWUpXG4gICAgICApIHtcbiAgICAgICAgLy8gQ2FzdCB0aGUgZXJyb3IgaW50byB0aGUgcHJvcGVyIHBhcnNlIGVycm9yXG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsXG4gICAgICAgICAgJ0EgZHVwbGljYXRlIHZhbHVlIGZvciBhIGZpZWxkIHdpdGggdW5pcXVlIHZhbHVlcyB3YXMgcHJvdmlkZWQnXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZUlkZW1wb3RlbmN5RnVuY3Rpb24ob3B0aW9ucz86IE9iamVjdCA9IHt9KTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCBjb25uID0gb3B0aW9ucy5jb25uICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLmNvbm4gOiB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3QgcXMgPSAnRFJPUCBGVU5DVElPTiBJRiBFWElTVFMgaWRlbXBvdGVuY3lfZGVsZXRlX2V4cGlyZWRfcmVjb3JkcygpJztcbiAgICByZXR1cm4gY29ubi5ub25lKHFzKS5jYXRjaChlcnJvciA9PiB7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGVuc3VyZUlkZW1wb3RlbmN5RnVuY3Rpb25FeGlzdHMob3B0aW9ucz86IE9iamVjdCA9IHt9KTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCBjb25uID0gb3B0aW9ucy5jb25uICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLmNvbm4gOiB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3QgdHRsT3B0aW9ucyA9IG9wdGlvbnMudHRsICE9PSB1bmRlZmluZWQgPyBgJHtvcHRpb25zLnR0bH0gc2Vjb25kc2AgOiAnNjAgc2Vjb25kcyc7XG4gICAgY29uc3QgcXMgPVxuICAgICAgJ0NSRUFURSBPUiBSRVBMQUNFIEZVTkNUSU9OIGlkZW1wb3RlbmN5X2RlbGV0ZV9leHBpcmVkX3JlY29yZHMoKSBSRVRVUk5TIHZvaWQgTEFOR1VBR0UgcGxwZ3NxbCBBUyAkJCBCRUdJTiBERUxFVEUgRlJPTSBcIl9JZGVtcG90ZW5jeVwiIFdIRVJFIGV4cGlyZSA8IE5PVygpIC0gSU5URVJWQUwgJDE7IEVORDsgJCQ7JztcbiAgICByZXR1cm4gY29ubi5ub25lKHFzLCBbdHRsT3B0aW9uc10pLmNhdGNoKGVycm9yID0+IHtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRQb2x5Z29uVG9TUUwocG9seWdvbikge1xuICBpZiAocG9seWdvbi5sZW5ndGggPCAzKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYFBvbHlnb24gbXVzdCBoYXZlIGF0IGxlYXN0IDMgdmFsdWVzYCk7XG4gIH1cbiAgaWYgKFxuICAgIHBvbHlnb25bMF1bMF0gIT09IHBvbHlnb25bcG9seWdvbi5sZW5ndGggLSAxXVswXSB8fFxuICAgIHBvbHlnb25bMF1bMV0gIT09IHBvbHlnb25bcG9seWdvbi5sZW5ndGggLSAxXVsxXVxuICApIHtcbiAgICBwb2x5Z29uLnB1c2gocG9seWdvblswXSk7XG4gIH1cbiAgY29uc3QgdW5pcXVlID0gcG9seWdvbi5maWx0ZXIoKGl0ZW0sIGluZGV4LCBhcikgPT4ge1xuICAgIGxldCBmb3VuZEluZGV4ID0gLTE7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhci5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgY29uc3QgcHQgPSBhcltpXTtcbiAgICAgIGlmIChwdFswXSA9PT0gaXRlbVswXSAmJiBwdFsxXSA9PT0gaXRlbVsxXSkge1xuICAgICAgICBmb3VuZEluZGV4ID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmb3VuZEluZGV4ID09PSBpbmRleDtcbiAgfSk7XG4gIGlmICh1bmlxdWUubGVuZ3RoIDwgMykge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUixcbiAgICAgICdHZW9KU09OOiBMb29wIG11c3QgaGF2ZSBhdCBsZWFzdCAzIGRpZmZlcmVudCB2ZXJ0aWNlcydcbiAgICApO1xuICB9XG4gIGNvbnN0IHBvaW50cyA9IHBvbHlnb25cbiAgICAubWFwKHBvaW50ID0+IHtcbiAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwYXJzZUZsb2F0KHBvaW50WzFdKSwgcGFyc2VGbG9hdChwb2ludFswXSkpO1xuICAgICAgcmV0dXJuIGAoJHtwb2ludFsxXX0sICR7cG9pbnRbMF19KWA7XG4gICAgfSlcbiAgICAuam9pbignLCAnKTtcbiAgcmV0dXJuIGAoJHtwb2ludHN9KWA7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZVdoaXRlU3BhY2UocmVnZXgpIHtcbiAgaWYgKCFyZWdleC5lbmRzV2l0aCgnXFxuJykpIHtcbiAgICByZWdleCArPSAnXFxuJztcbiAgfVxuXG4gIC8vIHJlbW92ZSBub24gZXNjYXBlZCBjb21tZW50c1xuICByZXR1cm4gKFxuICAgIHJlZ2V4XG4gICAgICAucmVwbGFjZSgvKFteXFxcXF0pIy4qXFxuL2dpbSwgJyQxJylcbiAgICAgIC8vIHJlbW92ZSBsaW5lcyBzdGFydGluZyB3aXRoIGEgY29tbWVudFxuICAgICAgLnJlcGxhY2UoL14jLipcXG4vZ2ltLCAnJylcbiAgICAgIC8vIHJlbW92ZSBub24gZXNjYXBlZCB3aGl0ZXNwYWNlXG4gICAgICAucmVwbGFjZSgvKFteXFxcXF0pXFxzKy9naW0sICckMScpXG4gICAgICAvLyByZW1vdmUgd2hpdGVzcGFjZSBhdCB0aGUgYmVnaW5uaW5nIG9mIGEgbGluZVxuICAgICAgLnJlcGxhY2UoL15cXHMrLywgJycpXG4gICAgICAudHJpbSgpXG4gICk7XG59XG5cbmZ1bmN0aW9uIHByb2Nlc3NSZWdleFBhdHRlcm4ocykge1xuICBpZiAocyAmJiBzLnN0YXJ0c1dpdGgoJ14nKSkge1xuICAgIC8vIHJlZ2V4IGZvciBzdGFydHNXaXRoXG4gICAgcmV0dXJuICdeJyArIGxpdGVyYWxpemVSZWdleFBhcnQocy5zbGljZSgxKSk7XG4gIH0gZWxzZSBpZiAocyAmJiBzLmVuZHNXaXRoKCckJykpIHtcbiAgICAvLyByZWdleCBmb3IgZW5kc1dpdGhcbiAgICByZXR1cm4gbGl0ZXJhbGl6ZVJlZ2V4UGFydChzLnNsaWNlKDAsIHMubGVuZ3RoIC0gMSkpICsgJyQnO1xuICB9XG5cbiAgLy8gcmVnZXggZm9yIGNvbnRhaW5zXG4gIHJldHVybiBsaXRlcmFsaXplUmVnZXhQYXJ0KHMpO1xufVxuXG5mdW5jdGlvbiBpc1N0YXJ0c1dpdGhSZWdleCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycgfHwgIXZhbHVlLnN0YXJ0c1dpdGgoJ14nKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoZXMgPSB2YWx1ZS5tYXRjaCgvXFxeXFxcXFEuKlxcXFxFLyk7XG4gIHJldHVybiAhIW1hdGNoZXM7XG59XG5cbmZ1bmN0aW9uIGlzQWxsVmFsdWVzUmVnZXhPck5vbmUodmFsdWVzKSB7XG4gIGlmICghdmFsdWVzIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykgfHwgdmFsdWVzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgY29uc3QgZmlyc3RWYWx1ZXNJc1JlZ2V4ID0gaXNTdGFydHNXaXRoUmVnZXgodmFsdWVzWzBdLiRyZWdleCk7XG4gIGlmICh2YWx1ZXMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGZpcnN0VmFsdWVzSXNSZWdleDtcbiAgfVxuXG4gIGZvciAobGV0IGkgPSAxLCBsZW5ndGggPSB2YWx1ZXMubGVuZ3RoOyBpIDwgbGVuZ3RoOyArK2kpIHtcbiAgICBpZiAoZmlyc3RWYWx1ZXNJc1JlZ2V4ICE9PSBpc1N0YXJ0c1dpdGhSZWdleCh2YWx1ZXNbaV0uJHJlZ2V4KSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBpc0FueVZhbHVlUmVnZXhTdGFydHNXaXRoKHZhbHVlcykge1xuICByZXR1cm4gdmFsdWVzLnNvbWUoZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgcmV0dXJuIGlzU3RhcnRzV2l0aFJlZ2V4KHZhbHVlLiRyZWdleCk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVMaXRlcmFsUmVnZXgocmVtYWluaW5nOiBzdHJpbmcpIHtcbiAgcmV0dXJuIHJlbWFpbmluZ1xuICAgIC5zcGxpdCgnJylcbiAgICAubWFwKGMgPT4ge1xuICAgICAgY29uc3QgcmVnZXggPSBSZWdFeHAoJ1swLTkgXXxcXFxccHtMfScsICd1Jyk7IC8vIFN1cHBvcnQgYWxsIFVuaWNvZGUgbGV0dGVyIGNoYXJzXG4gICAgICBpZiAoYy5tYXRjaChyZWdleCkgIT09IG51bGwpIHtcbiAgICAgICAgLy8gRG9uJ3QgZXNjYXBlIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzXG4gICAgICAgIHJldHVybiBjO1xuICAgICAgfVxuICAgICAgLy8gRXNjYXBlIGV2ZXJ5dGhpbmcgZWxzZSAoc2luZ2xlIHF1b3RlcyB3aXRoIHNpbmdsZSBxdW90ZXMsIGV2ZXJ5dGhpbmcgZWxzZSB3aXRoIGEgYmFja3NsYXNoKVxuICAgICAgcmV0dXJuIGMgPT09IGAnYCA/IGAnJ2AgOiBgXFxcXCR7Y31gO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xufVxuXG5mdW5jdGlvbiBsaXRlcmFsaXplUmVnZXhQYXJ0KHM6IHN0cmluZykge1xuICBjb25zdCBtYXRjaGVyMSA9IC9cXFxcUSgoPyFcXFxcRSkuKilcXFxcRSQvO1xuICBjb25zdCByZXN1bHQxOiBhbnkgPSBzLm1hdGNoKG1hdGNoZXIxKTtcbiAgaWYgKHJlc3VsdDEgJiYgcmVzdWx0MS5sZW5ndGggPiAxICYmIHJlc3VsdDEuaW5kZXggPiAtMSkge1xuICAgIC8vIFByb2Nlc3MgUmVnZXggdGhhdCBoYXMgYSBiZWdpbm5pbmcgYW5kIGFuIGVuZCBzcGVjaWZpZWQgZm9yIHRoZSBsaXRlcmFsIHRleHRcbiAgICBjb25zdCBwcmVmaXggPSBzLnN1YnN0cmluZygwLCByZXN1bHQxLmluZGV4KTtcbiAgICBjb25zdCByZW1haW5pbmcgPSByZXN1bHQxWzFdO1xuXG4gICAgcmV0dXJuIGxpdGVyYWxpemVSZWdleFBhcnQocHJlZml4KSArIGNyZWF0ZUxpdGVyYWxSZWdleChyZW1haW5pbmcpO1xuICB9XG5cbiAgLy8gUHJvY2VzcyBSZWdleCB0aGF0IGhhcyBhIGJlZ2lubmluZyBzcGVjaWZpZWQgZm9yIHRoZSBsaXRlcmFsIHRleHRcbiAgY29uc3QgbWF0Y2hlcjIgPSAvXFxcXFEoKD8hXFxcXEUpLiopJC87XG4gIGNvbnN0IHJlc3VsdDI6IGFueSA9IHMubWF0Y2gobWF0Y2hlcjIpO1xuICBpZiAocmVzdWx0MiAmJiByZXN1bHQyLmxlbmd0aCA+IDEgJiYgcmVzdWx0Mi5pbmRleCA+IC0xKSB7XG4gICAgY29uc3QgcHJlZml4ID0gcy5zdWJzdHJpbmcoMCwgcmVzdWx0Mi5pbmRleCk7XG4gICAgY29uc3QgcmVtYWluaW5nID0gcmVzdWx0MlsxXTtcblxuICAgIHJldHVybiBsaXRlcmFsaXplUmVnZXhQYXJ0KHByZWZpeCkgKyBjcmVhdGVMaXRlcmFsUmVnZXgocmVtYWluaW5nKTtcbiAgfVxuXG4gIC8vIFJlbW92ZSBwcm9ibGVtYXRpYyBjaGFycyBmcm9tIHJlbWFpbmluZyB0ZXh0XG4gIHJldHVybiBzXG4gICAgLy8gUmVtb3ZlIGFsbCBpbnN0YW5jZXMgb2YgXFxRIGFuZCBcXEVcbiAgICAucmVwbGFjZSgvKFteXFxcXF0pKFxcXFxFKS8sICckMScpXG4gICAgLnJlcGxhY2UoLyhbXlxcXFxdKShcXFxcUSkvLCAnJDEnKVxuICAgIC5yZXBsYWNlKC9eXFxcXEUvLCAnJylcbiAgICAucmVwbGFjZSgvXlxcXFxRLywgJycpXG4gICAgLy8gRW5zdXJlIGV2ZW4gbnVtYmVyIG9mIHNpbmdsZSBxdW90ZSBzZXF1ZW5jZXMgYnkgYWRkaW5nIGFuIGV4dHJhIHNpbmdsZSBxdW90ZSBpZiBuZWVkZWQ7XG4gICAgLy8gdGhpcyBlbnN1cmVzIHRoYXQgZXZlcnkgc2luZ2xlIHF1b3RlIGlzIGVzY2FwZWRcbiAgICAucmVwbGFjZSgvJysvZywgbWF0Y2ggPT4ge1xuICAgICAgcmV0dXJuIG1hdGNoLmxlbmd0aCAlIDIgPT09IDAgPyBtYXRjaCA6IG1hdGNoICsgXCInXCI7XG4gICAgfSk7XG59XG5cbnZhciBHZW9Qb2ludENvZGVyID0ge1xuICBpc1ZhbGlkSlNPTih2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmIHZhbHVlLl9fdHlwZSA9PT0gJ0dlb1BvaW50JztcbiAgfSxcbn07XG5cbmV4cG9ydCBkZWZhdWx0IFBvc3RncmVzU3RvcmFnZUFkYXB0ZXI7XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUNBLElBQUFBLGVBQUEsR0FBQUMsT0FBQTtBQUVBLElBQUFDLEtBQUEsR0FBQUMsc0JBQUEsQ0FBQUYsT0FBQTtBQUVBLElBQUFHLE9BQUEsR0FBQUQsc0JBQUEsQ0FBQUYsT0FBQTtBQUVBLElBQUFJLE9BQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLElBQUEsR0FBQUgsc0JBQUEsQ0FBQUYsT0FBQTtBQUNBLElBQUFNLGVBQUEsR0FBQU4sT0FBQTtBQUFtRCxTQUFBRSx1QkFBQUssQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FB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