"use strict";

var _logger = _interopRequireDefault(require("../../../logger"));
var _lodash = _interopRequireDefault(require("lodash"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var mongodb = require('mongodb');
var Parse = require('parse/node').Parse;
const Utils = require('../../../Utils');
const transformKey = (className, fieldName, schema) => {
  // Check if the schema is known since it's a built-in field.
  switch (fieldName) {
    case 'objectId':
      return '_id';
    case 'createdAt':
      return '_created_at';
    case 'updatedAt':
      return '_updated_at';
    case 'sessionToken':
      return '_session_token';
    case 'lastUsed':
      return '_last_used';
    case 'timesUsed':
      return 'times_used';
  }
  if (schema.fields[fieldName] && schema.fields[fieldName].__type == 'Pointer') {
    fieldName = '_p_' + fieldName;
  } else if (schema.fields[fieldName] && schema.fields[fieldName].type == 'Pointer') {
    fieldName = '_p_' + fieldName;
  }
  return fieldName;
};
const transformKeyValueForUpdate = (className, restKey, restValue, parseFormatSchema) => {
  // Check if the schema is known since it's a built-in field.
  var key = restKey;
  var timeField = false;
  switch (key) {
    case 'objectId':
    case '_id':
      if (['_GlobalConfig', '_GraphQLConfig'].includes(className)) {
        return {
          key: key,
          value: parseInt(restValue)
        };
      }
      key = '_id';
      break;
    case 'createdAt':
    case '_created_at':
      key = '_created_at';
      timeField = true;
      break;
    case 'updatedAt':
    case '_updated_at':
      key = '_updated_at';
      timeField = true;
      break;
    case 'sessionToken':
    case '_session_token':
      key = '_session_token';
      break;
    case 'expiresAt':
    case '_expiresAt':
      key = 'expiresAt';
      timeField = true;
      break;
    case '_email_verify_token_expires_at':
      key = '_email_verify_token_expires_at';
      timeField = true;
      break;
    case '_account_lockout_expires_at':
      key = '_account_lockout_expires_at';
      timeField = true;
      break;
    case '_failed_login_count':
      key = '_failed_login_count';
      break;
    case '_perishable_token_expires_at':
      key = '_perishable_token_expires_at';
      timeField = true;
      break;
    case '_password_changed_at':
      key = '_password_changed_at';
      timeField = true;
      break;
    case '_rperm':
    case '_wperm':
      return {
        key: key,
        value: restValue
      };
    case 'lastUsed':
    case '_last_used':
      key = '_last_used';
      timeField = true;
      break;
    case 'timesUsed':
    case 'times_used':
      key = 'times_used';
      timeField = true;
      break;
  }
  if (parseFormatSchema.fields[key] && parseFormatSchema.fields[key].type === 'Pointer' || !key.includes('.') && !parseFormatSchema.fields[key] && restValue && restValue.__type == 'Pointer' // Do not use the _p_ prefix for pointers inside nested documents
  ) {
    key = '_p_' + key;
  }

  // Handle atomic values
  var value = transformTopLevelAtom(restValue);
  if (value !== CannotTransform) {
    if (timeField && typeof value === 'string') {
      value = new Date(value);
    }
    if (restKey.indexOf('.') > 0) {
      return {
        key,
        value: restValue
      };
    }
    return {
      key,
      value
    };
  }

  // Handle arrays
  if (Array.isArray(restValue)) {
    value = restValue.map(transformInteriorValue);
    return {
      key,
      value
    };
  }

  // Handle update operators
  if (typeof restValue === 'object' && '__op' in restValue) {
    return {
      key,
      value: transformUpdateOperator(restValue, false)
    };
  }

  // Handle normal objects by recursing
  value = mapValues(restValue, transformInteriorValue);
  return {
    key,
    value
  };
};
const isRegex = value => {
  return value && Utils.isRegExp(value);
};
const isStartsWithRegex = value => {
  if (!isRegex(value)) {
    return false;
  }
  const matches = value.toString().match(/\/\^\\Q.*\\E\//);
  return !!matches;
};
const isAllValuesRegexOrNone = values => {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return true;
  }
  const firstValuesIsRegex = isStartsWithRegex(values[0]);
  if (values.length === 1) {
    return firstValuesIsRegex;
  }
  for (let i = 1, length = values.length; i < length; ++i) {
    if (firstValuesIsRegex !== isStartsWithRegex(values[i])) {
      return false;
    }
  }
  return true;
};
const isAnyValueRegex = values => {
  return values.some(function (value) {
    return isRegex(value);
  });
};
const transformInteriorValue = restValue => {
  if (restValue !== null && typeof restValue === 'object' && Object.keys(restValue).some(key => key.includes('$') || key.includes('.'))) {
    throw new Parse.Error(Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
  }
  // Handle atomic values
  var value = transformInteriorAtom(restValue);
  if (value !== CannotTransform) {
    if (value && typeof value === 'object') {
      if (Utils.isDate(value)) {
        return value;
      }
      if (Array.isArray(value)) {
        value = value.map(transformInteriorValue);
      } else {
        value = mapValues(value, transformInteriorValue);
      }
    }
    return value;
  }

  // Handle arrays
  if (Array.isArray(restValue)) {
    return restValue.map(transformInteriorValue);
  }

  // Handle update operators
  if (typeof restValue === 'object' && '__op' in restValue) {
    return transformUpdateOperator(restValue, true);
  }

  // Handle normal objects by recursing
  return mapValues(restValue, transformInteriorValue);
};
const valueAsDate = value => {
  if (typeof value === 'string') {
    return new Date(value);
  } else if (Utils.isDate(value)) {
    return value;
  }
  return false;
};
function transformQueryKeyValue(className, key, value, schema, count = false) {
  switch (key) {
    case 'createdAt':
      if (valueAsDate(value)) {
        return {
          key: '_created_at',
          value: valueAsDate(value)
        };
      }
      key = '_created_at';
      break;
    case 'updatedAt':
      if (valueAsDate(value)) {
        return {
          key: '_updated_at',
          value: valueAsDate(value)
        };
      }
      key = '_updated_at';
      break;
    case 'expiresAt':
      if (valueAsDate(value)) {
        return {
          key: 'expiresAt',
          value: valueAsDate(value)
        };
      }
      break;
    case '_email_verify_token_expires_at':
      if (valueAsDate(value)) {
        return {
          key: '_email_verify_token_expires_at',
          value: valueAsDate(value)
        };
      }
      break;
    case 'objectId':
      {
        if (['_GlobalConfig', '_GraphQLConfig'].includes(className)) {
          value = parseInt(value);
        }
        return {
          key: '_id',
          value
        };
      }
    case '_account_lockout_expires_at':
      if (valueAsDate(value)) {
        return {
          key: '_account_lockout_expires_at',
          value: valueAsDate(value)
        };
      }
      break;
    case '_failed_login_count':
      return {
        key,
        value
      };
    case 'sessionToken':
      return {
        key: '_session_token',
        value
      };
    case '_perishable_token_expires_at':
      if (valueAsDate(value)) {
        return {
          key: '_perishable_token_expires_at',
          value: valueAsDate(value)
        };
      }
      break;
    case '_password_changed_at':
      if (valueAsDate(value)) {
        return {
          key: '_password_changed_at',
          value: valueAsDate(value)
        };
      }
      break;
    case '_rperm':
    case '_wperm':
    case '_perishable_token':
    case '_email_verify_token':
      return {
        key,
        value
      };
    case '$or':
    case '$and':
    case '$nor':
      return {
        key: key,
        value: value.map(subQuery => transformWhere(className, subQuery, schema, count))
      };
    case 'lastUsed':
      if (valueAsDate(value)) {
        return {
          key: '_last_used',
          value: valueAsDate(value)
        };
      }
      key = '_last_used';
      break;
    case 'timesUsed':
      return {
        key: 'times_used',
        value: value
      };
    default:
      {
        // Other auth data
        const authDataMatch = key.match(/^authData\.([a-zA-Z0-9_]+)(\.(.+))?$/);
        if (authDataMatch && className === '_User') {
          const provider = authDataMatch[1];
          const subField = authDataMatch[3];
          return {
            key: `_auth_data_${provider}${subField ? `.${subField}` : ''}`,
            value
          };
        }
      }
  }
  const expectedTypeIsArray = schema && schema.fields[key] && schema.fields[key].type === 'Array';
  const expectedTypeIsPointer = schema && schema.fields[key] && schema.fields[key].type === 'Pointer';
  const field = schema && schema.fields[key];
  if (expectedTypeIsPointer || !schema && !key.includes('.') && value && value.__type === 'Pointer') {
    key = '_p_' + key;
  }

  // Handle query constraints
  const transformedConstraint = transformConstraint(value, field, key, count);
  if (transformedConstraint !== CannotTransform) {
    if (transformedConstraint.$text) {
      return {
        key: '$text',
        value: transformedConstraint.$text
      };
    }
    if (transformedConstraint.$elemMatch) {
      return {
        key: '$nor',
        value: [{
          [key]: transformedConstraint
        }]
      };
    }
    return {
      key,
      value: transformedConstraint
    };
  }
  if (expectedTypeIsArray && !Array.isArray(value)) {
    return {
      key,
      value: {
        $all: [transformInteriorAtom(value)]
      }
    };
  }

  // Handle atomic values
  const transformRes = key.includes('.') ? transformInteriorAtom(value) : transformTopLevelAtom(value);
  if (transformRes !== CannotTransform) {
    return {
      key,
      value: transformRes
    };
  } else {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `You cannot use ${value} as a query parameter.`);
  }
}

// Main exposed method to help run queries.
// restWhere is the "where" clause in REST API form.
// Returns the mongo form of the query.
function transformWhere(className, restWhere, schema, count = false) {
  const mongoWhere = {};
  for (const restKey in restWhere) {
    const out = transformQueryKeyValue(className, restKey, restWhere[restKey], schema, count);
    mongoWhere[out.key] = out.value;
  }
  return mongoWhere;
}
const parseObjectKeyValueToMongoObjectKeyValue = (restKey, restValue, schema) => {
  // Check if the schema is known since it's a built-in field.
  let transformedValue;
  let coercedToDate;
  switch (restKey) {
    case 'objectId':
      return {
        key: '_id',
        value: restValue
      };
    case 'expiresAt':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return {
        key: 'expiresAt',
        value: coercedToDate
      };
    case '_email_verify_token_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return {
        key: '_email_verify_token_expires_at',
        value: coercedToDate
      };
    case '_account_lockout_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return {
        key: '_account_lockout_expires_at',
        value: coercedToDate
      };
    case '_perishable_token_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return {
        key: '_perishable_token_expires_at',
        value: coercedToDate
      };
    case '_password_changed_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return {
        key: '_password_changed_at',
        value: coercedToDate
      };
    case '_failed_login_count':
    case '_rperm':
    case '_wperm':
    case '_email_verify_token':
    case '_hashed_password':
    case '_perishable_token':
      return {
        key: restKey,
        value: restValue
      };
    case 'sessionToken':
      return {
        key: '_session_token',
        value: restValue
      };
    default:
      // Auth data should have been transformed already
      if (restKey.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'can only query on ' + restKey);
      }
      // Trust that the auth data has been transformed and save it directly
      if (restKey.match(/^_auth_data_[a-zA-Z0-9_]+$/)) {
        return {
          key: restKey,
          value: restValue
        };
      }
  }
  //skip straight to transformTopLevelAtom for Bytes, they don't show up in the schema for some reason
  if (restValue && restValue.__type !== 'Bytes') {
    //Note: We may not know the type of a field here, as the user could be saving (null) to a field
    //That never existed before, meaning we can't infer the type.
    if (schema.fields[restKey] && schema.fields[restKey].type == 'Pointer' || restValue.__type == 'Pointer') {
      restKey = '_p_' + restKey;
    }
  }

  // Handle atomic values
  var value = transformTopLevelAtom(restValue);
  if (value !== CannotTransform) {
    return {
      key: restKey,
      value: value
    };
  }

  // ACLs are handled before this method is called
  // If an ACL key still exists here, something is wrong.
  if (restKey === 'ACL') {
    throw 'There was a problem transforming an ACL.';
  }

  // Handle arrays
  if (Array.isArray(restValue)) {
    value = restValue.map(transformInteriorValue);
    return {
      key: restKey,
      value: value
    };
  }

  // Handle normal objects by recursing
  if (Object.keys(restValue).some(key => key.includes('$') || key.includes('.'))) {
    throw new Parse.Error(Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
  }
  value = mapValues(restValue, transformInteriorValue);
  return {
    key: restKey,
    value
  };
};
const parseObjectToMongoObjectForCreate = (className, restCreate, schema) => {
  restCreate = addLegacyACL(restCreate);
  const mongoCreate = {};
  for (const restKey in restCreate) {
    if (restCreate[restKey] && restCreate[restKey].__type === 'Relation') {
      continue;
    }
    const {
      key,
      value
    } = parseObjectKeyValueToMongoObjectKeyValue(restKey, restCreate[restKey], schema);
    if (value !== undefined) {
      mongoCreate[key] = value;
    }
  }

  // Use the legacy mongo format for createdAt and updatedAt
  if (mongoCreate.createdAt) {
    mongoCreate._created_at = new Date(mongoCreate.createdAt.iso || mongoCreate.createdAt);
    delete mongoCreate.createdAt;
  }
  if (mongoCreate.updatedAt) {
    mongoCreate._updated_at = new Date(mongoCreate.updatedAt.iso || mongoCreate.updatedAt);
    delete mongoCreate.updatedAt;
  }
  return mongoCreate;
};

// Main exposed method to help update old objects.
const transformUpdate = (className, restUpdate, parseFormatSchema) => {
  const mongoUpdate = {};
  const acl = addLegacyACL(restUpdate);
  if (acl._rperm || acl._wperm || acl._acl) {
    mongoUpdate.$set = {};
    if (acl._rperm) {
      mongoUpdate.$set._rperm = acl._rperm;
    }
    if (acl._wperm) {
      mongoUpdate.$set._wperm = acl._wperm;
    }
    if (acl._acl) {
      mongoUpdate.$set._acl = acl._acl;
    }
  }
  for (var restKey in restUpdate) {
    if (restUpdate[restKey] && restUpdate[restKey].__type === 'Relation') {
      continue;
    }
    var out = transformKeyValueForUpdate(className, restKey, restUpdate[restKey], parseFormatSchema);

    // If the output value is an object with any $ keys, it's an
    // operator that needs to be lifted onto the top level update
    // object.
    if (typeof out.value === 'object' && out.value !== null && out.value.__op) {
      mongoUpdate[out.value.__op] = mongoUpdate[out.value.__op] || {};
      mongoUpdate[out.value.__op][out.key] = out.value.arg;
    } else {
      mongoUpdate['$set'] = mongoUpdate['$set'] || {};
      mongoUpdate['$set'][out.key] = out.value;
    }
  }
  return mongoUpdate;
};

// Add the legacy _acl format.
const addLegacyACL = restObject => {
  const restObjectCopy = {
    ...restObject
  };
  const _acl = {};
  if (restObject._wperm) {
    restObject._wperm.forEach(entry => {
      _acl[entry] = {
        w: true
      };
    });
    restObjectCopy._acl = _acl;
  }
  if (restObject._rperm) {
    restObject._rperm.forEach(entry => {
      if (!(entry in _acl)) {
        _acl[entry] = {
          r: true
        };
      } else {
        _acl[entry].r = true;
      }
    });
    restObjectCopy._acl = _acl;
  }
  return restObjectCopy;
};

// A sentinel value that helper transformations return when they
// cannot perform a transformation
function CannotTransform() {}
const transformInteriorAtom = atom => {
  // TODO: check validity harder for the __type-defined types
  if (typeof atom === 'object' && atom && !Utils.isDate(atom) && atom.__type === 'Pointer') {
    return {
      __type: 'Pointer',
      className: atom.className,
      objectId: atom.objectId
    };
  } else if (typeof atom === 'function' || typeof atom === 'symbol') {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `cannot transform value: ${atom}`);
  } else if (DateCoder.isValidJSON(atom)) {
    return DateCoder.JSONToDatabase(atom);
  } else if (BytesCoder.isValidJSON(atom)) {
    return BytesCoder.JSONToDatabase(atom);
  } else if (typeof atom === 'object' && atom && atom.$regex !== undefined) {
    return new RegExp(atom.$regex);
  } else {
    return atom;
  }
};

// Helper function to transform an atom from REST format to Mongo format.
// An atom is anything that can't contain other expressions. So it
// includes things where objects are used to represent other
// datatypes, like pointers and dates, but it does not include objects
// or arrays with generic stuff inside.
// Raises an error if this cannot possibly be valid REST format.
// Returns CannotTransform if it's just not an atom
function transformTopLevelAtom(atom, field) {
  switch (typeof atom) {
    case 'number':
    case 'boolean':
    case 'undefined':
      return atom;
    case 'string':
      if (field && field.type === 'Pointer') {
        return `${field.targetClass}$${atom}`;
      }
      return atom;
    case 'symbol':
    case 'function':
      throw new Parse.Error(Parse.Error.INVALID_JSON, `cannot transform value: ${atom}`);
    case 'object':
      if (Utils.isDate(atom)) {
        // Technically dates are not rest format, but, it seems pretty
        // clear what they should be transformed to, so let's just do it.
        return atom;
      }
      if (atom === null) {
        return atom;
      }

      // TODO: check validity harder for the __type-defined types
      if (atom.__type == 'Pointer') {
        return `${atom.className}$${atom.objectId}`;
      }
      if (DateCoder.isValidJSON(atom)) {
        return DateCoder.JSONToDatabase(atom);
      }
      if (BytesCoder.isValidJSON(atom)) {
        return BytesCoder.JSONToDatabase(atom);
      }
      if (GeoPointCoder.isValidJSON(atom)) {
        return GeoPointCoder.JSONToDatabase(atom);
      }
      if (PolygonCoder.isValidJSON(atom)) {
        return PolygonCoder.JSONToDatabase(atom);
      }
      if (FileCoder.isValidJSON(atom)) {
        return FileCoder.JSONToDatabase(atom);
      }
      return CannotTransform;
    default:
      // I don't think typeof can ever let us get here
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, `really did not expect value: ${atom}`);
  }
}

// Transforms a query constraint from REST API format to Mongo format.
// A constraint is something with fields like $lt.
// If it is not a valid constraint but it could be a valid something
// else, return CannotTransform.
// inArray is whether this is an array field.
function transformConstraint(constraint, field, queryKey, count = false) {
  const inArray = field && field.type && field.type === 'Array';
  // Check wether the given key has `.`
  const isNestedKey = queryKey.indexOf('.') > -1;
  if (typeof constraint !== 'object' || !constraint) {
    return CannotTransform;
  }
  // For inArray or nested key, we need to transform the interior atom
  const transformFunction = inArray || isNestedKey ? transformInteriorAtom : transformTopLevelAtom;
  const transformer = atom => {
    const result = transformFunction(atom, field);
    if (result === CannotTransform) {
      throw new Parse.Error(Parse.Error.INVALID_JSON, `bad atom: ${JSON.stringify(atom)}`);
    }
    return result;
  };
  // keys is the constraints in reverse alphabetical order.
  // This is a hack so that:
  //   $regex is handled before $options
  //   $nearSphere is handled before $maxDistance
  var keys = Object.keys(constraint).sort().reverse();
  var answer = {};
  for (var key of keys) {
    switch (key) {
      case '$lt':
      case '$lte':
      case '$gt':
      case '$gte':
      case '$exists':
      case '$ne':
      case '$eq':
        {
          const val = constraint[key];
          if (val && typeof val === 'object' && val.$relativeTime) {
            if (field && field.type !== 'Date') {
              throw new Parse.Error(Parse.Error.INVALID_JSON, '$relativeTime can only be used with Date field');
            }
            switch (key) {
              case '$exists':
              case '$ne':
              case '$eq':
                throw new Parse.Error(Parse.Error.INVALID_JSON, '$relativeTime can only be used with the $lt, $lte, $gt, and $gte operators');
            }
            const parserResult = Utils.relativeTimeToDate(val.$relativeTime);
            if (parserResult.status === 'success') {
              answer[key] = parserResult.result;
              break;
            }
            _logger.default.info('Error while parsing relative date', parserResult);
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $relativeTime (${key}) value. ${parserResult.info}`);
          }
          answer[key] = transformer(val);
          break;
        }
      case '$in':
      case '$nin':
        {
          const arr = constraint[key];
          if (!Array.isArray(arr)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad ' + key + ' value');
          }
          answer[key] = _lodash.default.flatMap(arr, value => {
            return (atom => {
              if (Array.isArray(atom)) {
                return value.map(transformer);
              } else {
                return transformer(atom);
              }
            })(value);
          });
          break;
        }
      case '$all':
        {
          const arr = constraint[key];
          if (!Array.isArray(arr)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad ' + key + ' value');
          }
          answer[key] = arr.map(transformInteriorAtom);
          const values = answer[key];
          if (isAnyValueRegex(values) && !isAllValuesRegexOrNone(values)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'All $all values must be of regex type or none: ' + values);
          }
          break;
        }
      case '$regex':
        var s = constraint[key];
        if (typeof s !== 'string') {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad regex: ' + s);
        }
        answer[key] = s;
        break;
      case '$containedBy':
        {
          const arr = constraint[key];
          if (!Array.isArray(arr)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $containedBy: should be an array`);
          }
          answer.$elemMatch = {
            $nin: arr.map(transformer)
          };
          break;
        }
      case '$options':
        answer[key] = constraint[key];
        break;
      case '$text':
        {
          const search = constraint[key].$search;
          if (typeof search !== 'object') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $search, should be object`);
          }
          if (!search.$term || typeof search.$term !== 'string') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $term, should be string`);
          } else {
            answer[key] = {
              $search: search.$term
            };
          }
          if (search.$language && typeof search.$language !== 'string') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $language, should be string`);
          } else if (search.$language) {
            answer[key].$language = search.$language;
          }
          if (search.$caseSensitive && typeof search.$caseSensitive !== 'boolean') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $caseSensitive, should be boolean`);
          } else if (search.$caseSensitive) {
            answer[key].$caseSensitive = search.$caseSensitive;
          }
          if (search.$diacriticSensitive && typeof search.$diacriticSensitive !== 'boolean') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $diacriticSensitive, should be boolean`);
          } else if (search.$diacriticSensitive) {
            answer[key].$diacriticSensitive = search.$diacriticSensitive;
          }
          break;
        }
      case '$nearSphere':
        {
          const point = constraint[key];
          if (count) {
            answer.$geoWithin = {
              $centerSphere: [[point.longitude, point.latitude], constraint.$maxDistance]
            };
          } else {
            answer[key] = [point.longitude, point.latitude];
          }
          break;
        }
      case '$maxDistance':
        {
          if (count) {
            break;
          }
          answer[key] = constraint[key];
          break;
        }
      // The SDKs don't seem to use these but they are documented in the
      // REST API docs.
      case '$maxDistanceInRadians':
        answer['$maxDistance'] = constraint[key];
        break;
      case '$maxDistanceInMiles':
        answer['$maxDistance'] = constraint[key] / 3959;
        break;
      case '$maxDistanceInKilometers':
        answer['$maxDistance'] = constraint[key] / 6371;
        break;
      case '$select':
      case '$dontSelect':
        throw new Parse.Error(Parse.Error.COMMAND_UNAVAILABLE, 'the ' + key + ' constraint is not supported yet');
      case '$within':
        var box = constraint[key]['$box'];
        if (!box || box.length != 2) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'malformatted $within arg');
        }
        answer[key] = {
          $box: [[box[0].longitude, box[0].latitude], [box[1].longitude, box[1].latitude]]
        };
        break;
      case '$geoWithin':
        {
          const polygon = constraint[key]['$polygon'];
          const centerSphere = constraint[key]['$centerSphere'];
          if (polygon !== undefined) {
            let points;
            if (typeof polygon === 'object' && polygon.__type === 'Polygon') {
              if (!polygon.coordinates || polygon.coordinates.length < 3) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; Polygon.coordinates should contain at least 3 lon/lat pairs');
              }
              points = polygon.coordinates;
            } else if (Array.isArray(polygon)) {
              if (polygon.length < 3) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should contain at least 3 GeoPoints');
              }
              points = polygon;
            } else {
              throw new Parse.Error(Parse.Error.INVALID_JSON, "bad $geoWithin value; $polygon should be Polygon object or Array of Parse.GeoPoint's");
            }
            points = points.map(point => {
              if (Array.isArray(point) && point.length === 2) {
                Parse.GeoPoint._validate(point[1], point[0]);
                return point;
              }
              if (!GeoPointCoder.isValidJSON(point)) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value');
              } else {
                Parse.GeoPoint._validate(point.latitude, point.longitude);
              }
              return [point.longitude, point.latitude];
            });
            answer[key] = {
              $polygon: points
            };
          } else if (centerSphere !== undefined) {
            if (!Array.isArray(centerSphere) || centerSphere.length < 2) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere should be an array of Parse.GeoPoint and distance');
            }
            // Get point, convert to geo point if necessary and validate
            let point = centerSphere[0];
            if (Array.isArray(point) && point.length === 2) {
              point = new Parse.GeoPoint(point[1], point[0]);
            } else if (!GeoPointCoder.isValidJSON(point)) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere geo point invalid');
            }
            Parse.GeoPoint._validate(point.latitude, point.longitude);
            // Get distance and validate
            const distance = centerSphere[1];
            if (isNaN(distance) || distance < 0) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere distance invalid');
            }
            answer[key] = {
              $centerSphere: [[point.longitude, point.latitude], distance]
            };
          }
          break;
        }
      case '$geoIntersects':
        {
          const point = constraint[key]['$point'];
          if (!GeoPointCoder.isValidJSON(point)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoIntersect value; $point should be GeoPoint');
          } else {
            Parse.GeoPoint._validate(point.latitude, point.longitude);
          }
          answer[key] = {
            $geometry: {
              type: 'Point',
              coordinates: [point.longitude, point.latitude]
            }
          };
          break;
        }
      default:
        if (key.match(/^\$+/)) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad constraint: ' + key);
        }
        return CannotTransform;
    }
  }
  return answer;
}

// Transforms an update operator from REST format to mongo format.
// To be transformed, the input should have an __op field.
// If flatten is true, this will flatten operators to their static
// data format. For example, an increment of 2 would simply become a
// 2.
// The output for a non-flattened operator is a hash with __op being
// the mongo op, and arg being the argument.
// The output for a flattened operator is just a value.
// Returns undefined if this should be a no-op.

function transformUpdateOperator({
  __op,
  amount,
  objects
}, flatten) {
  switch (__op) {
    case 'Delete':
      if (flatten) {
        return undefined;
      } else {
        return {
          __op: '$unset',
          arg: ''
        };
      }
    case 'Increment':
      if (typeof amount !== 'number') {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'incrementing must provide a number');
      }
      if (flatten) {
        return amount;
      } else {
        return {
          __op: '$inc',
          arg: amount
        };
      }
    case 'SetOnInsert':
      if (flatten) {
        return amount;
      } else {
        return {
          __op: '$setOnInsert',
          arg: amount
        };
      }
    case 'Add':
    case 'AddUnique':
      if (!Array.isArray(objects)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'objects to add must be an array');
      }
      var toAdd = objects.map(transformInteriorAtom);
      if (flatten) {
        return toAdd;
      } else {
        var mongoOp = {
          Add: '$push',
          AddUnique: '$addToSet'
        }[__op];
        return {
          __op: mongoOp,
          arg: {
            $each: toAdd
          }
        };
      }
    case 'Remove':
      if (!Array.isArray(objects)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'objects to remove must be an array');
      }
      var toRemove = objects.map(transformInteriorAtom);
      if (flatten) {
        return [];
      } else {
        return {
          __op: '$pullAll',
          arg: toRemove
        };
      }
    default:
      throw new Parse.Error(Parse.Error.COMMAND_UNAVAILABLE, `The ${__op} operator is not supported yet.`);
  }
}
function mapValues(object, iterator) {
  const result = {};
  Object.keys(object).forEach(key => {
    result[key] = iterator(object[key]);
  });
  return result;
}
const nestedMongoObjectToNestedParseObject = mongoObject => {
  switch (typeof mongoObject) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'undefined':
      return mongoObject;
    case 'symbol':
    case 'function':
      throw 'bad value in nestedMongoObjectToNestedParseObject';
    case 'object':
      if (mongoObject === null) {
        return null;
      }
      if (Array.isArray(mongoObject)) {
        return mongoObject.map(nestedMongoObjectToNestedParseObject);
      }
      if (Utils.isDate(mongoObject)) {
        return Parse._encode(mongoObject);
      }
      if (mongoObject instanceof mongodb.Long) {
        return mongoObject.toNumber();
      }
      if (mongoObject instanceof mongodb.Double) {
        return mongoObject.value;
      }
      if (BytesCoder.isValidDatabaseObject(mongoObject)) {
        return BytesCoder.databaseToJSON(mongoObject);
      }
      if (Object.prototype.hasOwnProperty.call(mongoObject, '__type') && mongoObject.__type == 'Date' && Utils.isDate(mongoObject.iso)) {
        mongoObject.iso = mongoObject.iso.toJSON();
        return mongoObject;
      }
      return mapValues(mongoObject, nestedMongoObjectToNestedParseObject);
    default:
      throw 'unknown js type';
  }
};
const transformPointerString = (schema, field, pointerString) => {
  const objData = pointerString.split('$');
  if (objData[0] !== schema.fields[field].targetClass) {
    throw 'pointer to incorrect className';
  }
  return {
    __type: 'Pointer',
    className: objData[0],
    objectId: objData[1]
  };
};

// Converts from a mongo-format object to a REST-format object.
// Does not strip out anything based on a lack of authentication.
const mongoObjectToParseObject = (className, mongoObject, schema) => {
  switch (typeof mongoObject) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'undefined':
      return mongoObject;
    case 'symbol':
    case 'function':
      throw 'bad value in mongoObjectToParseObject';
    case 'object':
      {
        if (mongoObject === null) {
          return null;
        }
        if (Array.isArray(mongoObject)) {
          return mongoObject.map(nestedMongoObjectToNestedParseObject);
        }
        if (Utils.isDate(mongoObject)) {
          return Parse._encode(mongoObject);
        }
        if (mongoObject instanceof mongodb.Long) {
          return mongoObject.toNumber();
        }
        if (mongoObject instanceof mongodb.Double) {
          return mongoObject.value;
        }
        if (BytesCoder.isValidDatabaseObject(mongoObject)) {
          return BytesCoder.databaseToJSON(mongoObject);
        }
        const restObject = {};
        if (mongoObject._rperm || mongoObject._wperm) {
          restObject._rperm = mongoObject._rperm || [];
          restObject._wperm = mongoObject._wperm || [];
          delete mongoObject._rperm;
          delete mongoObject._wperm;
        }
        for (var key in mongoObject) {
          switch (key) {
            case '_id':
              restObject['objectId'] = '' + mongoObject[key];
              break;
            case '_hashed_password':
              restObject._hashed_password = mongoObject[key];
              break;
            case '_acl':
              break;
            case '_email_verify_token':
            case '_perishable_token':
            case '_perishable_token_expires_at':
            case '_password_changed_at':
            case '_tombstone':
            case '_email_verify_token_expires_at':
            case '_account_lockout_expires_at':
            case '_failed_login_count':
            case '_password_history':
              // Those keys will be deleted if needed in the DB Controller
              restObject[key] = mongoObject[key];
              break;
            case '_session_token':
              restObject['sessionToken'] = mongoObject[key];
              break;
            case 'updatedAt':
            case '_updated_at':
              restObject['updatedAt'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;
            case 'createdAt':
            case '_created_at':
              restObject['createdAt'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;
            case 'expiresAt':
            case '_expiresAt':
              restObject['expiresAt'] = Parse._encode(new Date(mongoObject[key]));
              break;
            case 'lastUsed':
            case '_last_used':
              restObject['lastUsed'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;
            case 'timesUsed':
            case 'times_used':
              restObject['timesUsed'] = mongoObject[key];
              break;
            case 'authData':
              if (className === '_User') {
                _logger.default.warn('ignoring authData in _User as this key is reserved to be synthesized of `_auth_data_*` keys');
              } else {
                restObject['authData'] = mongoObject[key];
              }
              break;
            default:
              // Check other auth data keys
              var authDataMatch = key.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
              if (authDataMatch && className === '_User') {
                var provider = authDataMatch[1];
                restObject['authData'] = restObject['authData'] || {};
                restObject['authData'][provider] = mongoObject[key];
                break;
              }
              if (key.indexOf('_p_') == 0) {
                var newKey = key.substring(3);
                if (!schema.fields[newKey]) {
                  _logger.default.info('transform.js', 'Found a pointer column not in the schema, dropping it.', className, newKey);
                  break;
                }
                if (schema.fields[newKey].type !== 'Pointer') {
                  _logger.default.info('transform.js', 'Found a pointer in a non-pointer column, dropping it.', className, key);
                  break;
                }
                if (mongoObject[key] === null) {
                  break;
                }
                restObject[newKey] = transformPointerString(schema, newKey, mongoObject[key]);
                break;
              } else if (key[0] == '_' && key != '__type') {
                throw 'bad key in untransform: ' + key;
              } else {
                var value = mongoObject[key];
                if (schema.fields[key] && schema.fields[key].type === 'File' && FileCoder.isValidDatabaseObject(value)) {
                  restObject[key] = FileCoder.databaseToJSON(value);
                  break;
                }
                if (schema.fields[key] && schema.fields[key].type === 'GeoPoint' && GeoPointCoder.isValidDatabaseObject(value)) {
                  restObject[key] = GeoPointCoder.databaseToJSON(value);
                  break;
                }
                if (schema.fields[key] && schema.fields[key].type === 'Polygon' && PolygonCoder.isValidDatabaseObject(value)) {
                  restObject[key] = PolygonCoder.databaseToJSON(value);
                  break;
                }
                if (schema.fields[key] && schema.fields[key].type === 'Bytes' && BytesCoder.isValidDatabaseObject(value)) {
                  restObject[key] = BytesCoder.databaseToJSON(value);
                  break;
                }
              }
              restObject[key] = nestedMongoObjectToNestedParseObject(mongoObject[key]);
          }
        }
        const relationFieldNames = Object.keys(schema.fields).filter(fieldName => schema.fields[fieldName].type === 'Relation');
        const relationFields = {};
        relationFieldNames.forEach(relationFieldName => {
          relationFields[relationFieldName] = {
            __type: 'Relation',
            className: schema.fields[relationFieldName].targetClass
          };
        });
        return {
          ...restObject,
          ...relationFields
        };
      }
    default:
      throw 'unknown js type';
  }
};
var DateCoder = {
  JSONToDatabase(json) {
    return new Date(json.iso);
  },
  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Date';
  }
};
var BytesCoder = {
  base64Pattern: new RegExp('^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'),
  isBase64Value(object) {
    if (typeof object !== 'string') {
      return false;
    }
    return this.base64Pattern.test(object);
  },
  databaseToJSON(object) {
    let value;
    if (this.isBase64Value(object)) {
      value = object;
    } else {
      value = object.buffer.toString('base64');
    }
    return {
      __type: 'Bytes',
      base64: value
    };
  },
  isValidDatabaseObject(object) {
    return object instanceof mongodb.Binary || this.isBase64Value(object);
  },
  JSONToDatabase(json) {
    return new mongodb.Binary(Buffer.from(json.base64, 'base64'));
  },
  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Bytes';
  }
};
var GeoPointCoder = {
  databaseToJSON(object) {
    return {
      __type: 'GeoPoint',
      latitude: object[1],
      longitude: object[0]
    };
  },
  isValidDatabaseObject(object) {
    return Array.isArray(object) && object.length == 2;
  },
  JSONToDatabase(json) {
    return [json.longitude, json.latitude];
  },
  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'GeoPoint';
  }
};
var PolygonCoder = {
  databaseToJSON(object) {
    // Convert lng/lat -> lat/lng
    const coords = object.coordinates[0].map(coord => {
      return [coord[1], coord[0]];
    });
    return {
      __type: 'Polygon',
      coordinates: coords
    };
  },
  isValidDatabaseObject(object) {
    const coords = object.coordinates[0];
    if (object.type !== 'Polygon' || !Array.isArray(coords)) {
      return false;
    }
    for (let i = 0; i < coords.length; i++) {
      const point = coords[i];
      if (!GeoPointCoder.isValidDatabaseObject(point)) {
        return false;
      }
      Parse.GeoPoint._validate(parseFloat(point[1]), parseFloat(point[0]));
    }
    return true;
  },
  JSONToDatabase(json) {
    let coords = json.coordinates;
    // Add first point to the end to close polygon
    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
      coords.push(coords[0]);
    }
    const unique = coords.filter((item, index, ar) => {
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
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'GeoJSON: Loop must have at least 3 different vertices');
    }
    // Convert lat/long -> long/lat
    coords = coords.map(coord => {
      return [coord[1], coord[0]];
    });
    return {
      type: 'Polygon',
      coordinates: [coords]
    };
  },
  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Polygon';
  }
};
var FileCoder = {
  databaseToJSON(object) {
    return {
      __type: 'File',
      name: object
    };
  },
  isValidDatabaseObject(object) {
    return typeof object === 'string';
  },
  JSONToDatabase(json) {
    return json.name;
  },
  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'File';
  }
};
module.exports = {
  transformKey,
  parseObjectToMongoObjectForCreate,
  transformUpdate,
  transformWhere,
  mongoObjectToParseObject,
  transformConstraint,
  transformPointerString
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbG9nZ2VyIiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfbG9kYXNoIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwibW9uZ29kYiIsIlBhcnNlIiwiVXRpbHMiLCJ0cmFuc2Zvcm1LZXkiLCJjbGFzc05hbWUiLCJmaWVsZE5hbWUiLCJzY2hlbWEiLCJmaWVsZHMiLCJfX3R5cGUiLCJ0eXBlIiwidHJhbnNmb3JtS2V5VmFsdWVGb3JVcGRhdGUiLCJyZXN0S2V5IiwicmVzdFZhbHVlIiwicGFyc2VGb3JtYXRTY2hlbWEiLCJrZXkiLCJ0aW1lRmllbGQiLCJpbmNsdWRlcyIsInZhbHVlIiwicGFyc2VJbnQiLCJ0cmFuc2Zvcm1Ub3BMZXZlbEF0b20iLCJDYW5ub3RUcmFuc2Zvcm0iLCJEYXRlIiwiaW5kZXhPZiIsIkFycmF5IiwiaXNBcnJheSIsIm1hcCIsInRyYW5zZm9ybUludGVyaW9yVmFsdWUiLCJ0cmFuc2Zvcm1VcGRhdGVPcGVyYXRvciIsIm1hcFZhbHVlcyIsImlzUmVnZXgiLCJpc1JlZ0V4cCIsImlzU3RhcnRzV2l0aFJlZ2V4IiwibWF0Y2hlcyIsInRvU3RyaW5nIiwibWF0Y2giLCJpc0FsbFZhbHVlc1JlZ2V4T3JOb25lIiwidmFsdWVzIiwibGVuZ3RoIiwiZmlyc3RWYWx1ZXNJc1JlZ2V4IiwiaSIsImlzQW55VmFsdWVSZWdleCIsInNvbWUiLCJPYmplY3QiLCJrZXlzIiwiRXJyb3IiLCJJTlZBTElEX05FU1RFRF9LRVkiLCJ0cmFuc2Zvcm1JbnRlcmlvckF0b20iLCJpc0RhdGUiLCJ2YWx1ZUFzRGF0ZSIsInRyYW5zZm9ybVF1ZXJ5S2V5VmFsdWUiLCJjb3VudCIsInN1YlF1ZXJ5IiwidHJhbnNmb3JtV2hlcmUiLCJhdXRoRGF0YU1hdGNoIiwicHJvdmlkZXIiLCJzdWJGaWVsZCIsImV4cGVjdGVkVHlwZUlzQXJyYXkiLCJleHBlY3RlZFR5cGVJc1BvaW50ZXIiLCJmaWVsZCIsInRyYW5zZm9ybWVkQ29uc3RyYWludCIsInRyYW5zZm9ybUNvbnN0cmFpbnQiLCIkdGV4dCIsIiRlbGVtTWF0Y2giLCIkYWxsIiwidHJhbnNmb3JtUmVzIiwiSU5WQUxJRF9KU09OIiwicmVzdFdoZXJlIiwibW9uZ29XaGVyZSIsIm91dCIsInBhcnNlT2JqZWN0S2V5VmFsdWVUb01vbmdvT2JqZWN0S2V5VmFsdWUiLCJ0cmFuc2Zvcm1lZFZhbHVlIiwiY29lcmNlZFRvRGF0ZSIsIklOVkFMSURfS0VZX05BTUUiLCJwYXJzZU9iamVjdFRvTW9uZ29PYmplY3RGb3JDcmVhdGUiLCJyZXN0Q3JlYXRlIiwiYWRkTGVnYWN5QUNMIiwibW9uZ29DcmVhdGUiLCJ1bmRlZmluZWQiLCJjcmVhdGVkQXQiLCJfY3JlYXRlZF9hdCIsImlzbyIsInVwZGF0ZWRBdCIsIl91cGRhdGVkX2F0IiwidHJhbnNmb3JtVXBkYXRlIiwicmVzdFVwZGF0ZSIsIm1vbmdvVXBkYXRlIiwiYWNsIiwiX3JwZXJtIiwiX3dwZXJtIiwiX2FjbCIsIiRzZXQiLCJfX29wIiwiYXJnIiwicmVzdE9iamVjdCIsInJlc3RPYmplY3RDb3B5IiwiZm9yRWFjaCIsImVudHJ5IiwidyIsInIiLCJhdG9tIiwib2JqZWN0SWQiLCJEYXRlQ29kZXIiLCJpc1ZhbGlkSlNPTiIsIkpTT05Ub0RhdGFiYXNlIiwiQnl0ZXNDb2RlciIsIiRyZWdleCIsIlJlZ0V4cCIsInRhcmdldENsYXNzIiwiR2VvUG9pbnRDb2RlciIsIlBvbHlnb25Db2RlciIsIkZpbGVDb2RlciIsIklOVEVSTkFMX1NFUlZFUl9FUlJPUiIsImNvbnN0cmFpbnQiLCJxdWVyeUtleSIsImluQXJyYXkiLCJpc05lc3RlZEtleSIsInRyYW5zZm9ybUZ1bmN0aW9uIiwidHJhbnNmb3JtZXIiLCJyZXN1bHQiLCJKU09OIiwic3RyaW5naWZ5Iiwic29ydCIsInJldmVyc2UiLCJhbnN3ZXIiLCJ2YWwiLCIkcmVsYXRpdmVUaW1lIiwicGFyc2VyUmVzdWx0IiwicmVsYXRpdmVUaW1lVG9EYXRlIiwic3RhdHVzIiwibG9nIiwiaW5mbyIsImFyciIsIl8iLCJmbGF0TWFwIiwicyIsIiRuaW4iLCJzZWFyY2giLCIkc2VhcmNoIiwiJHRlcm0iLCIkbGFuZ3VhZ2UiLCIkY2FzZVNlbnNpdGl2ZSIsIiRkaWFjcml0aWNTZW5zaXRpdmUiLCJwb2ludCIsIiRnZW9XaXRoaW4iLCIkY2VudGVyU3BoZXJlIiwibG9uZ2l0dWRlIiwibGF0aXR1ZGUiLCIkbWF4RGlzdGFuY2UiLCJDT01NQU5EX1VOQVZBSUxBQkxFIiwiYm94IiwiJGJveCIsInBvbHlnb24iLCJjZW50ZXJTcGhlcmUiLCJwb2ludHMiLCJjb29yZGluYXRlcyIsIkdlb1BvaW50IiwiX3ZhbGlkYXRlIiwiJHBvbHlnb24iLCJkaXN0YW5jZSIsImlzTmFOIiwiJGdlb21ldHJ5IiwiYW1vdW50Iiwib2JqZWN0cyIsImZsYXR0ZW4iLCJ0b0FkZCIsIm1vbmdvT3AiLCJBZGQiLCJBZGRVbmlxdWUiLCIkZWFjaCIsInRvUmVtb3ZlIiwib2JqZWN0IiwiaXRlcmF0b3IiLCJuZXN0ZWRNb25nb09iamVjdFRvTmVzdGVkUGFyc2VPYmplY3QiLCJtb25nb09iamVjdCIsIl9lbmNvZGUiLCJMb25nIiwidG9OdW1iZXIiLCJEb3VibGUiLCJpc1ZhbGlkRGF0YWJhc2VPYmplY3QiLCJkYXRhYmFzZVRvSlNPTiIsInByb3RvdHlwZSIsImhhc093blByb3BlcnR5IiwiY2FsbCIsInRvSlNPTiIsInRyYW5zZm9ybVBvaW50ZXJTdHJpbmciLCJwb2ludGVyU3RyaW5nIiwib2JqRGF0YSIsInNwbGl0IiwibW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0IiwiX2hhc2hlZF9wYXNzd29yZCIsIndhcm4iLCJuZXdLZXkiLCJzdWJzdHJpbmciLCJyZWxhdGlvbkZpZWxkTmFtZXMiLCJmaWx0ZXIiLCJyZWxhdGlvbkZpZWxkcyIsInJlbGF0aW9uRmllbGROYW1lIiwianNvbiIsImJhc2U2NFBhdHRlcm4iLCJpc0Jhc2U2NFZhbHVlIiwidGVzdCIsImJ1ZmZlciIsImJhc2U2NCIsIkJpbmFyeSIsIkJ1ZmZlciIsImZyb20iLCJjb29yZHMiLCJjb29yZCIsInBhcnNlRmxvYXQiLCJwdXNoIiwidW5pcXVlIiwiaXRlbSIsImluZGV4IiwiYXIiLCJmb3VuZEluZGV4IiwicHQiLCJuYW1lIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvVHJhbnNmb3JtLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vLi4vbG9nZ2VyJztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG52YXIgbW9uZ29kYiA9IHJlcXVpcmUoJ21vbmdvZGInKTtcbnZhciBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZTtcbmNvbnN0IFV0aWxzID0gcmVxdWlyZSgnLi4vLi4vLi4vVXRpbHMnKTtcblxuY29uc3QgdHJhbnNmb3JtS2V5ID0gKGNsYXNzTmFtZSwgZmllbGROYW1lLCBzY2hlbWEpID0+IHtcbiAgLy8gQ2hlY2sgaWYgdGhlIHNjaGVtYSBpcyBrbm93biBzaW5jZSBpdCdzIGEgYnVpbHQtaW4gZmllbGQuXG4gIHN3aXRjaCAoZmllbGROYW1lKSB7XG4gICAgY2FzZSAnb2JqZWN0SWQnOlxuICAgICAgcmV0dXJuICdfaWQnO1xuICAgIGNhc2UgJ2NyZWF0ZWRBdCc6XG4gICAgICByZXR1cm4gJ19jcmVhdGVkX2F0JztcbiAgICBjYXNlICd1cGRhdGVkQXQnOlxuICAgICAgcmV0dXJuICdfdXBkYXRlZF9hdCc7XG4gICAgY2FzZSAnc2Vzc2lvblRva2VuJzpcbiAgICAgIHJldHVybiAnX3Nlc3Npb25fdG9rZW4nO1xuICAgIGNhc2UgJ2xhc3RVc2VkJzpcbiAgICAgIHJldHVybiAnX2xhc3RfdXNlZCc7XG4gICAgY2FzZSAndGltZXNVc2VkJzpcbiAgICAgIHJldHVybiAndGltZXNfdXNlZCc7XG4gIH1cblxuICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS5fX3R5cGUgPT0gJ1BvaW50ZXInKSB7XG4gICAgZmllbGROYW1lID0gJ19wXycgKyBmaWVsZE5hbWU7XG4gIH0gZWxzZSBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09ICdQb2ludGVyJykge1xuICAgIGZpZWxkTmFtZSA9ICdfcF8nICsgZmllbGROYW1lO1xuICB9XG5cbiAgcmV0dXJuIGZpZWxkTmFtZTtcbn07XG5cbmNvbnN0IHRyYW5zZm9ybUtleVZhbHVlRm9yVXBkYXRlID0gKGNsYXNzTmFtZSwgcmVzdEtleSwgcmVzdFZhbHVlLCBwYXJzZUZvcm1hdFNjaGVtYSkgPT4ge1xuICAvLyBDaGVjayBpZiB0aGUgc2NoZW1hIGlzIGtub3duIHNpbmNlIGl0J3MgYSBidWlsdC1pbiBmaWVsZC5cbiAgdmFyIGtleSA9IHJlc3RLZXk7XG4gIHZhciB0aW1lRmllbGQgPSBmYWxzZTtcbiAgc3dpdGNoIChrZXkpIHtcbiAgICBjYXNlICdvYmplY3RJZCc6XG4gICAgY2FzZSAnX2lkJzpcbiAgICAgIGlmIChbJ19HbG9iYWxDb25maWcnLCAnX0dyYXBoUUxDb25maWcnXS5pbmNsdWRlcyhjbGFzc05hbWUpKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAga2V5OiBrZXksXG4gICAgICAgICAgdmFsdWU6IHBhcnNlSW50KHJlc3RWYWx1ZSksXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBrZXkgPSAnX2lkJztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2NyZWF0ZWRBdCc6XG4gICAgY2FzZSAnX2NyZWF0ZWRfYXQnOlxuICAgICAga2V5ID0gJ19jcmVhdGVkX2F0JztcbiAgICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICBjYXNlICd1cGRhdGVkQXQnOlxuICAgIGNhc2UgJ191cGRhdGVkX2F0JzpcbiAgICAgIGtleSA9ICdfdXBkYXRlZF9hdCc7XG4gICAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnc2Vzc2lvblRva2VuJzpcbiAgICBjYXNlICdfc2Vzc2lvbl90b2tlbic6XG4gICAgICBrZXkgPSAnX3Nlc3Npb25fdG9rZW4nO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZXhwaXJlc0F0JzpcbiAgICBjYXNlICdfZXhwaXJlc0F0JzpcbiAgICAgIGtleSA9ICdleHBpcmVzQXQnO1xuICAgICAgdGltZUZpZWxkID0gdHJ1ZTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ19lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgICBrZXkgPSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JztcbiAgICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnOlxuICAgICAga2V5ID0gJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCc7XG4gICAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnX2ZhaWxlZF9sb2dpbl9jb3VudCc6XG4gICAgICBrZXkgPSAnX2ZhaWxlZF9sb2dpbl9jb3VudCc7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0JzpcbiAgICAgIGtleSA9ICdfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0JztcbiAgICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdfcGFzc3dvcmRfY2hhbmdlZF9hdCc6XG4gICAgICBrZXkgPSAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnO1xuICAgICAgdGltZUZpZWxkID0gdHJ1ZTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ19ycGVybSc6XG4gICAgY2FzZSAnX3dwZXJtJzpcbiAgICAgIHJldHVybiB7IGtleToga2V5LCB2YWx1ZTogcmVzdFZhbHVlIH07XG4gICAgY2FzZSAnbGFzdFVzZWQnOlxuICAgIGNhc2UgJ19sYXN0X3VzZWQnOlxuICAgICAga2V5ID0gJ19sYXN0X3VzZWQnO1xuICAgICAgdGltZUZpZWxkID0gdHJ1ZTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3RpbWVzVXNlZCc6XG4gICAgY2FzZSAndGltZXNfdXNlZCc6XG4gICAgICBrZXkgPSAndGltZXNfdXNlZCc7XG4gICAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gIH1cblxuICBpZiAoXG4gICAgKHBhcnNlRm9ybWF0U2NoZW1hLmZpZWxkc1trZXldICYmIHBhcnNlRm9ybWF0U2NoZW1hLmZpZWxkc1trZXldLnR5cGUgPT09ICdQb2ludGVyJykgfHxcbiAgICAoIWtleS5pbmNsdWRlcygnLicpICYmXG4gICAgICAhcGFyc2VGb3JtYXRTY2hlbWEuZmllbGRzW2tleV0gJiZcbiAgICAgIHJlc3RWYWx1ZSAmJlxuICAgICAgcmVzdFZhbHVlLl9fdHlwZSA9PSAnUG9pbnRlcicpIC8vIERvIG5vdCB1c2UgdGhlIF9wXyBwcmVmaXggZm9yIHBvaW50ZXJzIGluc2lkZSBuZXN0ZWQgZG9jdW1lbnRzXG4gICkge1xuICAgIGtleSA9ICdfcF8nICsga2V5O1xuICB9XG5cbiAgLy8gSGFuZGxlIGF0b21pYyB2YWx1ZXNcbiAgdmFyIHZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gIGlmICh2YWx1ZSAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgaWYgKHRpbWVGaWVsZCAmJiB0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICB2YWx1ZSA9IG5ldyBEYXRlKHZhbHVlKTtcbiAgICB9XG4gICAgaWYgKHJlc3RLZXkuaW5kZXhPZignLicpID4gMCkge1xuICAgICAgcmV0dXJuIHsga2V5LCB2YWx1ZTogcmVzdFZhbHVlIH07XG4gICAgfVxuICAgIHJldHVybiB7IGtleSwgdmFsdWUgfTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBhcnJheXNcbiAgaWYgKEFycmF5LmlzQXJyYXkocmVzdFZhbHVlKSkge1xuICAgIHZhbHVlID0gcmVzdFZhbHVlLm1hcCh0cmFuc2Zvcm1JbnRlcmlvclZhbHVlKTtcbiAgICByZXR1cm4geyBrZXksIHZhbHVlIH07XG4gIH1cblxuICAvLyBIYW5kbGUgdXBkYXRlIG9wZXJhdG9yc1xuICBpZiAodHlwZW9mIHJlc3RWYWx1ZSA9PT0gJ29iamVjdCcgJiYgJ19fb3AnIGluIHJlc3RWYWx1ZSkge1xuICAgIHJldHVybiB7IGtleSwgdmFsdWU6IHRyYW5zZm9ybVVwZGF0ZU9wZXJhdG9yKHJlc3RWYWx1ZSwgZmFsc2UpIH07XG4gIH1cblxuICAvLyBIYW5kbGUgbm9ybWFsIG9iamVjdHMgYnkgcmVjdXJzaW5nXG4gIHZhbHVlID0gbWFwVmFsdWVzKHJlc3RWYWx1ZSwgdHJhbnNmb3JtSW50ZXJpb3JWYWx1ZSk7XG4gIHJldHVybiB7IGtleSwgdmFsdWUgfTtcbn07XG5cbmNvbnN0IGlzUmVnZXggPSB2YWx1ZSA9PiB7XG4gIHJldHVybiB2YWx1ZSAmJiBVdGlscy5pc1JlZ0V4cCh2YWx1ZSk7XG59O1xuXG5jb25zdCBpc1N0YXJ0c1dpdGhSZWdleCA9IHZhbHVlID0+IHtcbiAgaWYgKCFpc1JlZ2V4KHZhbHVlKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoZXMgPSB2YWx1ZS50b1N0cmluZygpLm1hdGNoKC9cXC9cXF5cXFxcUS4qXFxcXEVcXC8vKTtcbiAgcmV0dXJuICEhbWF0Y2hlcztcbn07XG5cbmNvbnN0IGlzQWxsVmFsdWVzUmVnZXhPck5vbmUgPSB2YWx1ZXMgPT4ge1xuICBpZiAoIXZhbHVlcyB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZXMpIHx8IHZhbHVlcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGNvbnN0IGZpcnN0VmFsdWVzSXNSZWdleCA9IGlzU3RhcnRzV2l0aFJlZ2V4KHZhbHVlc1swXSk7XG4gIGlmICh2YWx1ZXMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGZpcnN0VmFsdWVzSXNSZWdleDtcbiAgfVxuXG4gIGZvciAobGV0IGkgPSAxLCBsZW5ndGggPSB2YWx1ZXMubGVuZ3RoOyBpIDwgbGVuZ3RoOyArK2kpIHtcbiAgICBpZiAoZmlyc3RWYWx1ZXNJc1JlZ2V4ICE9PSBpc1N0YXJ0c1dpdGhSZWdleCh2YWx1ZXNbaV0pKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5jb25zdCBpc0FueVZhbHVlUmVnZXggPSB2YWx1ZXMgPT4ge1xuICByZXR1cm4gdmFsdWVzLnNvbWUoZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgcmV0dXJuIGlzUmVnZXgodmFsdWUpO1xuICB9KTtcbn07XG5cbmNvbnN0IHRyYW5zZm9ybUludGVyaW9yVmFsdWUgPSByZXN0VmFsdWUgPT4ge1xuICBpZiAoXG4gICAgcmVzdFZhbHVlICE9PSBudWxsICYmXG4gICAgdHlwZW9mIHJlc3RWYWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICBPYmplY3Qua2V5cyhyZXN0VmFsdWUpLnNvbWUoa2V5ID0+IGtleS5pbmNsdWRlcygnJCcpIHx8IGtleS5pbmNsdWRlcygnLicpKVxuICApIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5JTlZBTElEX05FU1RFRF9LRVksXG4gICAgICBcIk5lc3RlZCBrZXlzIHNob3VsZCBub3QgY29udGFpbiB0aGUgJyQnIG9yICcuJyBjaGFyYWN0ZXJzXCJcbiAgICApO1xuICB9XG4gIC8vIEhhbmRsZSBhdG9taWMgdmFsdWVzXG4gIHZhciB2YWx1ZSA9IHRyYW5zZm9ybUludGVyaW9yQXRvbShyZXN0VmFsdWUpO1xuICBpZiAodmFsdWUgIT09IENhbm5vdFRyYW5zZm9ybSkge1xuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICBpZiAoVXRpbHMuaXNEYXRlKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICB9XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdmFsdWUgPSB2YWx1ZS5tYXAodHJhbnNmb3JtSW50ZXJpb3JWYWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YWx1ZSA9IG1hcFZhbHVlcyh2YWx1ZSwgdHJhbnNmb3JtSW50ZXJpb3JWYWx1ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBhcnJheXNcbiAgaWYgKEFycmF5LmlzQXJyYXkocmVzdFZhbHVlKSkge1xuICAgIHJldHVybiByZXN0VmFsdWUubWFwKHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICB9XG5cbiAgLy8gSGFuZGxlIHVwZGF0ZSBvcGVyYXRvcnNcbiAgaWYgKHR5cGVvZiByZXN0VmFsdWUgPT09ICdvYmplY3QnICYmICdfX29wJyBpbiByZXN0VmFsdWUpIHtcbiAgICByZXR1cm4gdHJhbnNmb3JtVXBkYXRlT3BlcmF0b3IocmVzdFZhbHVlLCB0cnVlKTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBub3JtYWwgb2JqZWN0cyBieSByZWN1cnNpbmdcbiAgcmV0dXJuIG1hcFZhbHVlcyhyZXN0VmFsdWUsIHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xufTtcblxuY29uc3QgdmFsdWVBc0RhdGUgPSB2YWx1ZSA9PiB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKHZhbHVlKTtcbiAgfSBlbHNlIGlmIChVdGlscy5pc0RhdGUodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbmZ1bmN0aW9uIHRyYW5zZm9ybVF1ZXJ5S2V5VmFsdWUoY2xhc3NOYW1lLCBrZXksIHZhbHVlLCBzY2hlbWEsIGNvdW50ID0gZmFsc2UpIHtcbiAgc3dpdGNoIChrZXkpIHtcbiAgICBjYXNlICdjcmVhdGVkQXQnOlxuICAgICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4geyBrZXk6ICdfY3JlYXRlZF9hdCcsIHZhbHVlOiB2YWx1ZUFzRGF0ZSh2YWx1ZSkgfTtcbiAgICAgIH1cbiAgICAgIGtleSA9ICdfY3JlYXRlZF9hdCc7XG4gICAgICBicmVhaztcbiAgICBjYXNlICd1cGRhdGVkQXQnOlxuICAgICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4geyBrZXk6ICdfdXBkYXRlZF9hdCcsIHZhbHVlOiB2YWx1ZUFzRGF0ZSh2YWx1ZSkgfTtcbiAgICAgIH1cbiAgICAgIGtleSA9ICdfdXBkYXRlZF9hdCc7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdleHBpcmVzQXQnOlxuICAgICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4geyBrZXk6ICdleHBpcmVzQXQnLCB2YWx1ZTogdmFsdWVBc0RhdGUodmFsdWUpIH07XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGtleTogJ19lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCcsXG4gICAgICAgICAgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ29iamVjdElkJzoge1xuICAgICAgaWYgKFsnX0dsb2JhbENvbmZpZycsICdfR3JhcGhRTENvbmZpZyddLmluY2x1ZGVzKGNsYXNzTmFtZSkpIHtcbiAgICAgICAgdmFsdWUgPSBwYXJzZUludCh2YWx1ZSk7XG4gICAgICB9XG4gICAgICByZXR1cm4geyBrZXk6ICdfaWQnLCB2YWx1ZSB9O1xuICAgIH1cbiAgICBjYXNlICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnOlxuICAgICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGtleTogJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCcsXG4gICAgICAgICAgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgICAgcmV0dXJuIHsga2V5LCB2YWx1ZSB9O1xuICAgIGNhc2UgJ3Nlc3Npb25Ub2tlbic6XG4gICAgICByZXR1cm4geyBrZXk6ICdfc2Vzc2lvbl90b2tlbicsIHZhbHVlIH07XG4gICAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgICBpZiAodmFsdWVBc0RhdGUodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAga2V5OiAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCcsXG4gICAgICAgICAgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ19wYXNzd29yZF9jaGFuZ2VkX2F0JzpcbiAgICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIHsga2V5OiAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnLCB2YWx1ZTogdmFsdWVBc0RhdGUodmFsdWUpIH07XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdfcnBlcm0nOlxuICAgIGNhc2UgJ193cGVybSc6XG4gICAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW4nOlxuICAgIGNhc2UgJ19lbWFpbF92ZXJpZnlfdG9rZW4nOlxuICAgICAgcmV0dXJuIHsga2V5LCB2YWx1ZSB9O1xuICAgIGNhc2UgJyRvcic6XG4gICAgY2FzZSAnJGFuZCc6XG4gICAgY2FzZSAnJG5vcic6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBrZXk6IGtleSxcbiAgICAgICAgdmFsdWU6IHZhbHVlLm1hcChzdWJRdWVyeSA9PiB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHN1YlF1ZXJ5LCBzY2hlbWEsIGNvdW50KSksXG4gICAgICB9O1xuICAgIGNhc2UgJ2xhc3RVc2VkJzpcbiAgICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIHsga2V5OiAnX2xhc3RfdXNlZCcsIHZhbHVlOiB2YWx1ZUFzRGF0ZSh2YWx1ZSkgfTtcbiAgICAgIH1cbiAgICAgIGtleSA9ICdfbGFzdF91c2VkJztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3RpbWVzVXNlZCc6XG4gICAgICByZXR1cm4geyBrZXk6ICd0aW1lc191c2VkJywgdmFsdWU6IHZhbHVlIH07XG4gICAgZGVmYXVsdDoge1xuICAgICAgLy8gT3RoZXIgYXV0aCBkYXRhXG4gICAgICBjb25zdCBhdXRoRGF0YU1hdGNoID0ga2V5Lm1hdGNoKC9eYXV0aERhdGFcXC4oW2EtekEtWjAtOV9dKykoXFwuKC4rKSk/JC8pO1xuICAgICAgaWYgKGF1dGhEYXRhTWF0Y2ggJiYgY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgICAgIGNvbnN0IHByb3ZpZGVyID0gYXV0aERhdGFNYXRjaFsxXTtcbiAgICAgICAgY29uc3Qgc3ViRmllbGQgPSBhdXRoRGF0YU1hdGNoWzNdO1xuICAgICAgICByZXR1cm4geyBrZXk6IGBfYXV0aF9kYXRhXyR7cHJvdmlkZXJ9JHtzdWJGaWVsZCA/IGAuJHtzdWJGaWVsZH1gIDogJyd9YCwgdmFsdWUgfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBleHBlY3RlZFR5cGVJc0FycmF5ID0gc2NoZW1hICYmIHNjaGVtYS5maWVsZHNba2V5XSAmJiBzY2hlbWEuZmllbGRzW2tleV0udHlwZSA9PT0gJ0FycmF5JztcblxuICBjb25zdCBleHBlY3RlZFR5cGVJc1BvaW50ZXIgPVxuICAgIHNjaGVtYSAmJiBzY2hlbWEuZmllbGRzW2tleV0gJiYgc2NoZW1hLmZpZWxkc1trZXldLnR5cGUgPT09ICdQb2ludGVyJztcblxuICBjb25zdCBmaWVsZCA9IHNjaGVtYSAmJiBzY2hlbWEuZmllbGRzW2tleV07XG4gIGlmIChcbiAgICBleHBlY3RlZFR5cGVJc1BvaW50ZXIgfHxcbiAgICAoIXNjaGVtYSAmJiAha2V5LmluY2x1ZGVzKCcuJykgJiYgdmFsdWUgJiYgdmFsdWUuX190eXBlID09PSAnUG9pbnRlcicpXG4gICkge1xuICAgIGtleSA9ICdfcF8nICsga2V5O1xuICB9XG5cbiAgLy8gSGFuZGxlIHF1ZXJ5IGNvbnN0cmFpbnRzXG4gIGNvbnN0IHRyYW5zZm9ybWVkQ29uc3RyYWludCA9IHRyYW5zZm9ybUNvbnN0cmFpbnQodmFsdWUsIGZpZWxkLCBrZXksIGNvdW50KTtcbiAgaWYgKHRyYW5zZm9ybWVkQ29uc3RyYWludCAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgaWYgKHRyYW5zZm9ybWVkQ29uc3RyYWludC4kdGV4dCkge1xuICAgICAgcmV0dXJuIHsga2V5OiAnJHRleHQnLCB2YWx1ZTogdHJhbnNmb3JtZWRDb25zdHJhaW50LiR0ZXh0IH07XG4gICAgfVxuICAgIGlmICh0cmFuc2Zvcm1lZENvbnN0cmFpbnQuJGVsZW1NYXRjaCkge1xuICAgICAgcmV0dXJuIHsga2V5OiAnJG5vcicsIHZhbHVlOiBbeyBba2V5XTogdHJhbnNmb3JtZWRDb25zdHJhaW50IH1dIH07XG4gICAgfVxuICAgIHJldHVybiB7IGtleSwgdmFsdWU6IHRyYW5zZm9ybWVkQ29uc3RyYWludCB9O1xuICB9XG5cbiAgaWYgKGV4cGVjdGVkVHlwZUlzQXJyYXkgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgcmV0dXJuIHsga2V5LCB2YWx1ZTogeyAkYWxsOiBbdHJhbnNmb3JtSW50ZXJpb3JBdG9tKHZhbHVlKV0gfSB9O1xuICB9XG5cbiAgLy8gSGFuZGxlIGF0b21pYyB2YWx1ZXNcbiAgY29uc3QgdHJhbnNmb3JtUmVzID0ga2V5LmluY2x1ZGVzKCcuJylcbiAgICA/IHRyYW5zZm9ybUludGVyaW9yQXRvbSh2YWx1ZSlcbiAgICA6IHRyYW5zZm9ybVRvcExldmVsQXRvbSh2YWx1ZSk7XG4gIGlmICh0cmFuc2Zvcm1SZXMgIT09IENhbm5vdFRyYW5zZm9ybSkge1xuICAgIHJldHVybiB7IGtleSwgdmFsdWU6IHRyYW5zZm9ybVJlcyB9O1xuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgIGBZb3UgY2Fubm90IHVzZSAke3ZhbHVlfSBhcyBhIHF1ZXJ5IHBhcmFtZXRlci5gXG4gICAgKTtcbiAgfVxufVxuXG4vLyBNYWluIGV4cG9zZWQgbWV0aG9kIHRvIGhlbHAgcnVuIHF1ZXJpZXMuXG4vLyByZXN0V2hlcmUgaXMgdGhlIFwid2hlcmVcIiBjbGF1c2UgaW4gUkVTVCBBUEkgZm9ybS5cbi8vIFJldHVybnMgdGhlIG1vbmdvIGZvcm0gb2YgdGhlIHF1ZXJ5LlxuZnVuY3Rpb24gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCByZXN0V2hlcmUsIHNjaGVtYSwgY291bnQgPSBmYWxzZSkge1xuICBjb25zdCBtb25nb1doZXJlID0ge307XG4gIGZvciAoY29uc3QgcmVzdEtleSBpbiByZXN0V2hlcmUpIHtcbiAgICBjb25zdCBvdXQgPSB0cmFuc2Zvcm1RdWVyeUtleVZhbHVlKGNsYXNzTmFtZSwgcmVzdEtleSwgcmVzdFdoZXJlW3Jlc3RLZXldLCBzY2hlbWEsIGNvdW50KTtcbiAgICBtb25nb1doZXJlW291dC5rZXldID0gb3V0LnZhbHVlO1xuICB9XG4gIHJldHVybiBtb25nb1doZXJlO1xufVxuXG5jb25zdCBwYXJzZU9iamVjdEtleVZhbHVlVG9Nb25nb09iamVjdEtleVZhbHVlID0gKHJlc3RLZXksIHJlc3RWYWx1ZSwgc2NoZW1hKSA9PiB7XG4gIC8vIENoZWNrIGlmIHRoZSBzY2hlbWEgaXMga25vd24gc2luY2UgaXQncyBhIGJ1aWx0LWluIGZpZWxkLlxuICBsZXQgdHJhbnNmb3JtZWRWYWx1ZTtcbiAgbGV0IGNvZXJjZWRUb0RhdGU7XG4gIHN3aXRjaCAocmVzdEtleSkge1xuICAgIGNhc2UgJ29iamVjdElkJzpcbiAgICAgIHJldHVybiB7IGtleTogJ19pZCcsIHZhbHVlOiByZXN0VmFsdWUgfTtcbiAgICBjYXNlICdleHBpcmVzQXQnOlxuICAgICAgdHJhbnNmb3JtZWRWYWx1ZSA9IHRyYW5zZm9ybVRvcExldmVsQXRvbShyZXN0VmFsdWUpO1xuICAgICAgY29lcmNlZFRvRGF0ZSA9XG4gICAgICAgIHR5cGVvZiB0cmFuc2Zvcm1lZFZhbHVlID09PSAnc3RyaW5nJyA/IG5ldyBEYXRlKHRyYW5zZm9ybWVkVmFsdWUpIDogdHJhbnNmb3JtZWRWYWx1ZTtcbiAgICAgIHJldHVybiB7IGtleTogJ2V4cGlyZXNBdCcsIHZhbHVlOiBjb2VyY2VkVG9EYXRlIH07XG4gICAgY2FzZSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JzpcbiAgICAgIHRyYW5zZm9ybWVkVmFsdWUgPSB0cmFuc2Zvcm1Ub3BMZXZlbEF0b20ocmVzdFZhbHVlKTtcbiAgICAgIGNvZXJjZWRUb0RhdGUgPVxuICAgICAgICB0eXBlb2YgdHJhbnNmb3JtZWRWYWx1ZSA9PT0gJ3N0cmluZycgPyBuZXcgRGF0ZSh0cmFuc2Zvcm1lZFZhbHVlKSA6IHRyYW5zZm9ybWVkVmFsdWU7XG4gICAgICByZXR1cm4geyBrZXk6ICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnLCB2YWx1ZTogY29lcmNlZFRvRGF0ZSB9O1xuICAgIGNhc2UgJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCc6XG4gICAgICB0cmFuc2Zvcm1lZFZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gICAgICBjb2VyY2VkVG9EYXRlID1cbiAgICAgICAgdHlwZW9mIHRyYW5zZm9ybWVkVmFsdWUgPT09ICdzdHJpbmcnID8gbmV3IERhdGUodHJhbnNmb3JtZWRWYWx1ZSkgOiB0cmFuc2Zvcm1lZFZhbHVlO1xuICAgICAgcmV0dXJuIHsga2V5OiAnX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0JywgdmFsdWU6IGNvZXJjZWRUb0RhdGUgfTtcbiAgICBjYXNlICdfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0JzpcbiAgICAgIHRyYW5zZm9ybWVkVmFsdWUgPSB0cmFuc2Zvcm1Ub3BMZXZlbEF0b20ocmVzdFZhbHVlKTtcbiAgICAgIGNvZXJjZWRUb0RhdGUgPVxuICAgICAgICB0eXBlb2YgdHJhbnNmb3JtZWRWYWx1ZSA9PT0gJ3N0cmluZycgPyBuZXcgRGF0ZSh0cmFuc2Zvcm1lZFZhbHVlKSA6IHRyYW5zZm9ybWVkVmFsdWU7XG4gICAgICByZXR1cm4geyBrZXk6ICdfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0JywgdmFsdWU6IGNvZXJjZWRUb0RhdGUgfTtcbiAgICBjYXNlICdfcGFzc3dvcmRfY2hhbmdlZF9hdCc6XG4gICAgICB0cmFuc2Zvcm1lZFZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gICAgICBjb2VyY2VkVG9EYXRlID1cbiAgICAgICAgdHlwZW9mIHRyYW5zZm9ybWVkVmFsdWUgPT09ICdzdHJpbmcnID8gbmV3IERhdGUodHJhbnNmb3JtZWRWYWx1ZSkgOiB0cmFuc2Zvcm1lZFZhbHVlO1xuICAgICAgcmV0dXJuIHsga2V5OiAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnLCB2YWx1ZTogY29lcmNlZFRvRGF0ZSB9O1xuICAgIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgIGNhc2UgJ19ycGVybSc6XG4gICAgY2FzZSAnX3dwZXJtJzpcbiAgICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuJzpcbiAgICBjYXNlICdfaGFzaGVkX3Bhc3N3b3JkJzpcbiAgICBjYXNlICdfcGVyaXNoYWJsZV90b2tlbic6XG4gICAgICByZXR1cm4geyBrZXk6IHJlc3RLZXksIHZhbHVlOiByZXN0VmFsdWUgfTtcbiAgICBjYXNlICdzZXNzaW9uVG9rZW4nOlxuICAgICAgcmV0dXJuIHsga2V5OiAnX3Nlc3Npb25fdG9rZW4nLCB2YWx1ZTogcmVzdFZhbHVlIH07XG4gICAgZGVmYXVsdDpcbiAgICAgIC8vIEF1dGggZGF0YSBzaG91bGQgaGF2ZSBiZWVuIHRyYW5zZm9ybWVkIGFscmVhZHlcbiAgICAgIGlmIChyZXN0S2V5Lm1hdGNoKC9eYXV0aERhdGFcXC4oW2EtekEtWjAtOV9dKylcXC5pZCQvKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgJ2NhbiBvbmx5IHF1ZXJ5IG9uICcgKyByZXN0S2V5KTtcbiAgICAgIH1cbiAgICAgIC8vIFRydXN0IHRoYXQgdGhlIGF1dGggZGF0YSBoYXMgYmVlbiB0cmFuc2Zvcm1lZCBhbmQgc2F2ZSBpdCBkaXJlY3RseVxuICAgICAgaWYgKHJlc3RLZXkubWF0Y2goL15fYXV0aF9kYXRhX1thLXpBLVowLTlfXSskLykpIHtcbiAgICAgICAgcmV0dXJuIHsga2V5OiByZXN0S2V5LCB2YWx1ZTogcmVzdFZhbHVlIH07XG4gICAgICB9XG4gIH1cbiAgLy9za2lwIHN0cmFpZ2h0IHRvIHRyYW5zZm9ybVRvcExldmVsQXRvbSBmb3IgQnl0ZXMsIHRoZXkgZG9uJ3Qgc2hvdyB1cCBpbiB0aGUgc2NoZW1hIGZvciBzb21lIHJlYXNvblxuICBpZiAocmVzdFZhbHVlICYmIHJlc3RWYWx1ZS5fX3R5cGUgIT09ICdCeXRlcycpIHtcbiAgICAvL05vdGU6IFdlIG1heSBub3Qga25vdyB0aGUgdHlwZSBvZiBhIGZpZWxkIGhlcmUsIGFzIHRoZSB1c2VyIGNvdWxkIGJlIHNhdmluZyAobnVsbCkgdG8gYSBmaWVsZFxuICAgIC8vVGhhdCBuZXZlciBleGlzdGVkIGJlZm9yZSwgbWVhbmluZyB3ZSBjYW4ndCBpbmZlciB0aGUgdHlwZS5cbiAgICBpZiAoXG4gICAgICAoc2NoZW1hLmZpZWxkc1tyZXN0S2V5XSAmJiBzY2hlbWEuZmllbGRzW3Jlc3RLZXldLnR5cGUgPT0gJ1BvaW50ZXInKSB8fFxuICAgICAgcmVzdFZhbHVlLl9fdHlwZSA9PSAnUG9pbnRlcidcbiAgICApIHtcbiAgICAgIHJlc3RLZXkgPSAnX3BfJyArIHJlc3RLZXk7XG4gICAgfVxuICB9XG5cbiAgLy8gSGFuZGxlIGF0b21pYyB2YWx1ZXNcbiAgdmFyIHZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gIGlmICh2YWx1ZSAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgcmV0dXJuIHsga2V5OiByZXN0S2V5LCB2YWx1ZTogdmFsdWUgfTtcbiAgfVxuXG4gIC8vIEFDTHMgYXJlIGhhbmRsZWQgYmVmb3JlIHRoaXMgbWV0aG9kIGlzIGNhbGxlZFxuICAvLyBJZiBhbiBBQ0wga2V5IHN0aWxsIGV4aXN0cyBoZXJlLCBzb21ldGhpbmcgaXMgd3JvbmcuXG4gIGlmIChyZXN0S2V5ID09PSAnQUNMJykge1xuICAgIHRocm93ICdUaGVyZSB3YXMgYSBwcm9ibGVtIHRyYW5zZm9ybWluZyBhbiBBQ0wuJztcbiAgfVxuXG4gIC8vIEhhbmRsZSBhcnJheXNcbiAgaWYgKEFycmF5LmlzQXJyYXkocmVzdFZhbHVlKSkge1xuICAgIHZhbHVlID0gcmVzdFZhbHVlLm1hcCh0cmFuc2Zvcm1JbnRlcmlvclZhbHVlKTtcbiAgICByZXR1cm4geyBrZXk6IHJlc3RLZXksIHZhbHVlOiB2YWx1ZSB9O1xuICB9XG5cbiAgLy8gSGFuZGxlIG5vcm1hbCBvYmplY3RzIGJ5IHJlY3Vyc2luZ1xuICBpZiAoT2JqZWN0LmtleXMocmVzdFZhbHVlKS5zb21lKGtleSA9PiBrZXkuaW5jbHVkZXMoJyQnKSB8fCBrZXkuaW5jbHVkZXMoJy4nKSkpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5JTlZBTElEX05FU1RFRF9LRVksXG4gICAgICBcIk5lc3RlZCBrZXlzIHNob3VsZCBub3QgY29udGFpbiB0aGUgJyQnIG9yICcuJyBjaGFyYWN0ZXJzXCJcbiAgICApO1xuICB9XG4gIHZhbHVlID0gbWFwVmFsdWVzKHJlc3RWYWx1ZSwgdHJhbnNmb3JtSW50ZXJpb3JWYWx1ZSk7XG5cbiAgcmV0dXJuIHsga2V5OiByZXN0S2V5LCB2YWx1ZSB9O1xufTtcblxuY29uc3QgcGFyc2VPYmplY3RUb01vbmdvT2JqZWN0Rm9yQ3JlYXRlID0gKGNsYXNzTmFtZSwgcmVzdENyZWF0ZSwgc2NoZW1hKSA9PiB7XG4gIHJlc3RDcmVhdGUgPSBhZGRMZWdhY3lBQ0wocmVzdENyZWF0ZSk7XG4gIGNvbnN0IG1vbmdvQ3JlYXRlID0ge307XG4gIGZvciAoY29uc3QgcmVzdEtleSBpbiByZXN0Q3JlYXRlKSB7XG4gICAgaWYgKHJlc3RDcmVhdGVbcmVzdEtleV0gJiYgcmVzdENyZWF0ZVtyZXN0S2V5XS5fX3R5cGUgPT09ICdSZWxhdGlvbicpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCB7IGtleSwgdmFsdWUgfSA9IHBhcnNlT2JqZWN0S2V5VmFsdWVUb01vbmdvT2JqZWN0S2V5VmFsdWUoXG4gICAgICByZXN0S2V5LFxuICAgICAgcmVzdENyZWF0ZVtyZXN0S2V5XSxcbiAgICAgIHNjaGVtYVxuICAgICk7XG4gICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIG1vbmdvQ3JlYXRlW2tleV0gPSB2YWx1ZTtcbiAgICB9XG4gIH1cblxuICAvLyBVc2UgdGhlIGxlZ2FjeSBtb25nbyBmb3JtYXQgZm9yIGNyZWF0ZWRBdCBhbmQgdXBkYXRlZEF0XG4gIGlmIChtb25nb0NyZWF0ZS5jcmVhdGVkQXQpIHtcbiAgICBtb25nb0NyZWF0ZS5fY3JlYXRlZF9hdCA9IG5ldyBEYXRlKG1vbmdvQ3JlYXRlLmNyZWF0ZWRBdC5pc28gfHwgbW9uZ29DcmVhdGUuY3JlYXRlZEF0KTtcbiAgICBkZWxldGUgbW9uZ29DcmVhdGUuY3JlYXRlZEF0O1xuICB9XG4gIGlmIChtb25nb0NyZWF0ZS51cGRhdGVkQXQpIHtcbiAgICBtb25nb0NyZWF0ZS5fdXBkYXRlZF9hdCA9IG5ldyBEYXRlKG1vbmdvQ3JlYXRlLnVwZGF0ZWRBdC5pc28gfHwgbW9uZ29DcmVhdGUudXBkYXRlZEF0KTtcbiAgICBkZWxldGUgbW9uZ29DcmVhdGUudXBkYXRlZEF0O1xuICB9XG5cbiAgcmV0dXJuIG1vbmdvQ3JlYXRlO1xufTtcblxuLy8gTWFpbiBleHBvc2VkIG1ldGhvZCB0byBoZWxwIHVwZGF0ZSBvbGQgb2JqZWN0cy5cbmNvbnN0IHRyYW5zZm9ybVVwZGF0ZSA9IChjbGFzc05hbWUsIHJlc3RVcGRhdGUsIHBhcnNlRm9ybWF0U2NoZW1hKSA9PiB7XG4gIGNvbnN0IG1vbmdvVXBkYXRlID0ge307XG4gIGNvbnN0IGFjbCA9IGFkZExlZ2FjeUFDTChyZXN0VXBkYXRlKTtcbiAgaWYgKGFjbC5fcnBlcm0gfHwgYWNsLl93cGVybSB8fCBhY2wuX2FjbCkge1xuICAgIG1vbmdvVXBkYXRlLiRzZXQgPSB7fTtcbiAgICBpZiAoYWNsLl9ycGVybSkge1xuICAgICAgbW9uZ29VcGRhdGUuJHNldC5fcnBlcm0gPSBhY2wuX3JwZXJtO1xuICAgIH1cbiAgICBpZiAoYWNsLl93cGVybSkge1xuICAgICAgbW9uZ29VcGRhdGUuJHNldC5fd3Blcm0gPSBhY2wuX3dwZXJtO1xuICAgIH1cbiAgICBpZiAoYWNsLl9hY2wpIHtcbiAgICAgIG1vbmdvVXBkYXRlLiRzZXQuX2FjbCA9IGFjbC5fYWNsO1xuICAgIH1cbiAgfVxuICBmb3IgKHZhciByZXN0S2V5IGluIHJlc3RVcGRhdGUpIHtcbiAgICBpZiAocmVzdFVwZGF0ZVtyZXN0S2V5XSAmJiByZXN0VXBkYXRlW3Jlc3RLZXldLl9fdHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHZhciBvdXQgPSB0cmFuc2Zvcm1LZXlWYWx1ZUZvclVwZGF0ZShcbiAgICAgIGNsYXNzTmFtZSxcbiAgICAgIHJlc3RLZXksXG4gICAgICByZXN0VXBkYXRlW3Jlc3RLZXldLFxuICAgICAgcGFyc2VGb3JtYXRTY2hlbWFcbiAgICApO1xuXG4gICAgLy8gSWYgdGhlIG91dHB1dCB2YWx1ZSBpcyBhbiBvYmplY3Qgd2l0aCBhbnkgJCBrZXlzLCBpdCdzIGFuXG4gICAgLy8gb3BlcmF0b3IgdGhhdCBuZWVkcyB0byBiZSBsaWZ0ZWQgb250byB0aGUgdG9wIGxldmVsIHVwZGF0ZVxuICAgIC8vIG9iamVjdC5cbiAgICBpZiAodHlwZW9mIG91dC52YWx1ZSA9PT0gJ29iamVjdCcgJiYgb3V0LnZhbHVlICE9PSBudWxsICYmIG91dC52YWx1ZS5fX29wKSB7XG4gICAgICBtb25nb1VwZGF0ZVtvdXQudmFsdWUuX19vcF0gPSBtb25nb1VwZGF0ZVtvdXQudmFsdWUuX19vcF0gfHwge307XG4gICAgICBtb25nb1VwZGF0ZVtvdXQudmFsdWUuX19vcF1bb3V0LmtleV0gPSBvdXQudmFsdWUuYXJnO1xuICAgIH0gZWxzZSB7XG4gICAgICBtb25nb1VwZGF0ZVsnJHNldCddID0gbW9uZ29VcGRhdGVbJyRzZXQnXSB8fCB7fTtcbiAgICAgIG1vbmdvVXBkYXRlWyckc2V0J11bb3V0LmtleV0gPSBvdXQudmFsdWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG1vbmdvVXBkYXRlO1xufTtcblxuLy8gQWRkIHRoZSBsZWdhY3kgX2FjbCBmb3JtYXQuXG5jb25zdCBhZGRMZWdhY3lBQ0wgPSByZXN0T2JqZWN0ID0+IHtcbiAgY29uc3QgcmVzdE9iamVjdENvcHkgPSB7IC4uLnJlc3RPYmplY3QgfTtcbiAgY29uc3QgX2FjbCA9IHt9O1xuXG4gIGlmIChyZXN0T2JqZWN0Ll93cGVybSkge1xuICAgIHJlc3RPYmplY3QuX3dwZXJtLmZvckVhY2goZW50cnkgPT4ge1xuICAgICAgX2FjbFtlbnRyeV0gPSB7IHc6IHRydWUgfTtcbiAgICB9KTtcbiAgICByZXN0T2JqZWN0Q29weS5fYWNsID0gX2FjbDtcbiAgfVxuXG4gIGlmIChyZXN0T2JqZWN0Ll9ycGVybSkge1xuICAgIHJlc3RPYmplY3QuX3JwZXJtLmZvckVhY2goZW50cnkgPT4ge1xuICAgICAgaWYgKCEoZW50cnkgaW4gX2FjbCkpIHtcbiAgICAgICAgX2FjbFtlbnRyeV0gPSB7IHI6IHRydWUgfTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIF9hY2xbZW50cnldLnIgPSB0cnVlO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJlc3RPYmplY3RDb3B5Ll9hY2wgPSBfYWNsO1xuICB9XG5cbiAgcmV0dXJuIHJlc3RPYmplY3RDb3B5O1xufTtcblxuLy8gQSBzZW50aW5lbCB2YWx1ZSB0aGF0IGhlbHBlciB0cmFuc2Zvcm1hdGlvbnMgcmV0dXJuIHdoZW4gdGhleVxuLy8gY2Fubm90IHBlcmZvcm0gYSB0cmFuc2Zvcm1hdGlvblxuZnVuY3Rpb24gQ2Fubm90VHJhbnNmb3JtKCkge31cblxuY29uc3QgdHJhbnNmb3JtSW50ZXJpb3JBdG9tID0gYXRvbSA9PiB7XG4gIC8vIFRPRE86IGNoZWNrIHZhbGlkaXR5IGhhcmRlciBmb3IgdGhlIF9fdHlwZS1kZWZpbmVkIHR5cGVzXG4gIGlmICh0eXBlb2YgYXRvbSA9PT0gJ29iamVjdCcgJiYgYXRvbSAmJiAhVXRpbHMuaXNEYXRlKGF0b20pICYmIGF0b20uX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICByZXR1cm4ge1xuICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICBjbGFzc05hbWU6IGF0b20uY2xhc3NOYW1lLFxuICAgICAgb2JqZWN0SWQ6IGF0b20ub2JqZWN0SWQsXG4gICAgfTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgYXRvbSA9PT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2YgYXRvbSA9PT0gJ3N5bWJvbCcpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgY2Fubm90IHRyYW5zZm9ybSB2YWx1ZTogJHthdG9tfWApO1xuICB9IGVsc2UgaWYgKERhdGVDb2Rlci5pc1ZhbGlkSlNPTihhdG9tKSkge1xuICAgIHJldHVybiBEYXRlQ29kZXIuSlNPTlRvRGF0YWJhc2UoYXRvbSk7XG4gIH0gZWxzZSBpZiAoQnl0ZXNDb2Rlci5pc1ZhbGlkSlNPTihhdG9tKSkge1xuICAgIHJldHVybiBCeXRlc0NvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICB9IGVsc2UgaWYgKHR5cGVvZiBhdG9tID09PSAnb2JqZWN0JyAmJiBhdG9tICYmIGF0b20uJHJlZ2V4ICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gbmV3IFJlZ0V4cChhdG9tLiRyZWdleCk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGF0b207XG4gIH1cbn07XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byB0cmFuc2Zvcm0gYW4gYXRvbSBmcm9tIFJFU1QgZm9ybWF0IHRvIE1vbmdvIGZvcm1hdC5cbi8vIEFuIGF0b20gaXMgYW55dGhpbmcgdGhhdCBjYW4ndCBjb250YWluIG90aGVyIGV4cHJlc3Npb25zLiBTbyBpdFxuLy8gaW5jbHVkZXMgdGhpbmdzIHdoZXJlIG9iamVjdHMgYXJlIHVzZWQgdG8gcmVwcmVzZW50IG90aGVyXG4vLyBkYXRhdHlwZXMsIGxpa2UgcG9pbnRlcnMgYW5kIGRhdGVzLCBidXQgaXQgZG9lcyBub3QgaW5jbHVkZSBvYmplY3RzXG4vLyBvciBhcnJheXMgd2l0aCBnZW5lcmljIHN0dWZmIGluc2lkZS5cbi8vIFJhaXNlcyBhbiBlcnJvciBpZiB0aGlzIGNhbm5vdCBwb3NzaWJseSBiZSB2YWxpZCBSRVNUIGZvcm1hdC5cbi8vIFJldHVybnMgQ2Fubm90VHJhbnNmb3JtIGlmIGl0J3MganVzdCBub3QgYW4gYXRvbVxuZnVuY3Rpb24gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKGF0b20sIGZpZWxkKSB7XG4gIHN3aXRjaCAodHlwZW9mIGF0b20pIHtcbiAgICBjYXNlICdudW1iZXInOlxuICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgIGNhc2UgJ3VuZGVmaW5lZCc6XG4gICAgICByZXR1cm4gYXRvbTtcbiAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgaWYgKGZpZWxkICYmIGZpZWxkLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICByZXR1cm4gYCR7ZmllbGQudGFyZ2V0Q2xhc3N9JCR7YXRvbX1gO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGF0b207XG4gICAgY2FzZSAnc3ltYm9sJzpcbiAgICBjYXNlICdmdW5jdGlvbic6XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgY2Fubm90IHRyYW5zZm9ybSB2YWx1ZTogJHthdG9tfWApO1xuICAgIGNhc2UgJ29iamVjdCc6XG4gICAgICBpZiAoVXRpbHMuaXNEYXRlKGF0b20pKSB7XG4gICAgICAgIC8vIFRlY2huaWNhbGx5IGRhdGVzIGFyZSBub3QgcmVzdCBmb3JtYXQsIGJ1dCwgaXQgc2VlbXMgcHJldHR5XG4gICAgICAgIC8vIGNsZWFyIHdoYXQgdGhleSBzaG91bGQgYmUgdHJhbnNmb3JtZWQgdG8sIHNvIGxldCdzIGp1c3QgZG8gaXQuXG4gICAgICAgIHJldHVybiBhdG9tO1xuICAgICAgfVxuXG4gICAgICBpZiAoYXRvbSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gYXRvbTtcbiAgICAgIH1cblxuICAgICAgLy8gVE9ETzogY2hlY2sgdmFsaWRpdHkgaGFyZGVyIGZvciB0aGUgX190eXBlLWRlZmluZWQgdHlwZXNcbiAgICAgIGlmIChhdG9tLl9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICAgICAgcmV0dXJuIGAke2F0b20uY2xhc3NOYW1lfSQke2F0b20ub2JqZWN0SWR9YDtcbiAgICAgIH1cbiAgICAgIGlmIChEYXRlQ29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICAgICAgcmV0dXJuIERhdGVDb2Rlci5KU09OVG9EYXRhYmFzZShhdG9tKTtcbiAgICAgIH1cbiAgICAgIGlmIChCeXRlc0NvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICAgIHJldHVybiBCeXRlc0NvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICAgICAgfVxuICAgICAgaWYgKEdlb1BvaW50Q29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICAgICAgcmV0dXJuIEdlb1BvaW50Q29kZXIuSlNPTlRvRGF0YWJhc2UoYXRvbSk7XG4gICAgICB9XG4gICAgICBpZiAoUG9seWdvbkNvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICAgIHJldHVybiBQb2x5Z29uQ29kZXIuSlNPTlRvRGF0YWJhc2UoYXRvbSk7XG4gICAgICB9XG4gICAgICBpZiAoRmlsZUNvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICAgIHJldHVybiBGaWxlQ29kZXIuSlNPTlRvRGF0YWJhc2UoYXRvbSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gQ2Fubm90VHJhbnNmb3JtO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIC8vIEkgZG9uJ3QgdGhpbmsgdHlwZW9mIGNhbiBldmVyIGxldCB1cyBnZXQgaGVyZVxuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICAgIGByZWFsbHkgZGlkIG5vdCBleHBlY3QgdmFsdWU6ICR7YXRvbX1gXG4gICAgICApO1xuICB9XG59XG5cbi8vIFRyYW5zZm9ybXMgYSBxdWVyeSBjb25zdHJhaW50IGZyb20gUkVTVCBBUEkgZm9ybWF0IHRvIE1vbmdvIGZvcm1hdC5cbi8vIEEgY29uc3RyYWludCBpcyBzb21ldGhpbmcgd2l0aCBmaWVsZHMgbGlrZSAkbHQuXG4vLyBJZiBpdCBpcyBub3QgYSB2YWxpZCBjb25zdHJhaW50IGJ1dCBpdCBjb3VsZCBiZSBhIHZhbGlkIHNvbWV0aGluZ1xuLy8gZWxzZSwgcmV0dXJuIENhbm5vdFRyYW5zZm9ybS5cbi8vIGluQXJyYXkgaXMgd2hldGhlciB0aGlzIGlzIGFuIGFycmF5IGZpZWxkLlxuZnVuY3Rpb24gdHJhbnNmb3JtQ29uc3RyYWludChjb25zdHJhaW50LCBmaWVsZCwgcXVlcnlLZXksIGNvdW50ID0gZmFsc2UpIHtcbiAgY29uc3QgaW5BcnJheSA9IGZpZWxkICYmIGZpZWxkLnR5cGUgJiYgZmllbGQudHlwZSA9PT0gJ0FycmF5JztcbiAgLy8gQ2hlY2sgd2V0aGVyIHRoZSBnaXZlbiBrZXkgaGFzIGAuYFxuICBjb25zdCBpc05lc3RlZEtleSA9IHF1ZXJ5S2V5LmluZGV4T2YoJy4nKSA+IC0xO1xuICBpZiAodHlwZW9mIGNvbnN0cmFpbnQgIT09ICdvYmplY3QnIHx8ICFjb25zdHJhaW50KSB7XG4gICAgcmV0dXJuIENhbm5vdFRyYW5zZm9ybTtcbiAgfVxuICAvLyBGb3IgaW5BcnJheSBvciBuZXN0ZWQga2V5LCB3ZSBuZWVkIHRvIHRyYW5zZm9ybSB0aGUgaW50ZXJpb3IgYXRvbVxuICBjb25zdCB0cmFuc2Zvcm1GdW5jdGlvbiA9IChpbkFycmF5IHx8IGlzTmVzdGVkS2V5KSA/IHRyYW5zZm9ybUludGVyaW9yQXRvbSA6IHRyYW5zZm9ybVRvcExldmVsQXRvbTtcbiAgY29uc3QgdHJhbnNmb3JtZXIgPSBhdG9tID0+IHtcbiAgICBjb25zdCByZXN1bHQgPSB0cmFuc2Zvcm1GdW5jdGlvbihhdG9tLCBmaWVsZCk7XG4gICAgaWYgKHJlc3VsdCA9PT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgYmFkIGF0b206ICR7SlNPTi5zdHJpbmdpZnkoYXRvbSl9YCk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG4gIC8vIGtleXMgaXMgdGhlIGNvbnN0cmFpbnRzIGluIHJldmVyc2UgYWxwaGFiZXRpY2FsIG9yZGVyLlxuICAvLyBUaGlzIGlzIGEgaGFjayBzbyB0aGF0OlxuICAvLyAgICRyZWdleCBpcyBoYW5kbGVkIGJlZm9yZSAkb3B0aW9uc1xuICAvLyAgICRuZWFyU3BoZXJlIGlzIGhhbmRsZWQgYmVmb3JlICRtYXhEaXN0YW5jZVxuICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKGNvbnN0cmFpbnQpLnNvcnQoKS5yZXZlcnNlKCk7XG4gIHZhciBhbnN3ZXIgPSB7fTtcbiAgZm9yICh2YXIga2V5IG9mIGtleXMpIHtcbiAgICBzd2l0Y2ggKGtleSkge1xuICAgICAgY2FzZSAnJGx0JzpcbiAgICAgIGNhc2UgJyRsdGUnOlxuICAgICAgY2FzZSAnJGd0JzpcbiAgICAgIGNhc2UgJyRndGUnOlxuICAgICAgY2FzZSAnJGV4aXN0cyc6XG4gICAgICBjYXNlICckbmUnOlxuICAgICAgY2FzZSAnJGVxJzoge1xuICAgICAgICBjb25zdCB2YWwgPSBjb25zdHJhaW50W2tleV07XG4gICAgICAgIGlmICh2YWwgJiYgdHlwZW9mIHZhbCA9PT0gJ29iamVjdCcgJiYgdmFsLiRyZWxhdGl2ZVRpbWUpIHtcbiAgICAgICAgICBpZiAoZmllbGQgJiYgZmllbGQudHlwZSAhPT0gJ0RhdGUnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgJyRyZWxhdGl2ZVRpbWUgY2FuIG9ubHkgYmUgdXNlZCB3aXRoIERhdGUgZmllbGQnXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICAgICAgICBjYXNlICckZXhpc3RzJzpcbiAgICAgICAgICAgIGNhc2UgJyRuZSc6XG4gICAgICAgICAgICBjYXNlICckZXEnOlxuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAgICckcmVsYXRpdmVUaW1lIGNhbiBvbmx5IGJlIHVzZWQgd2l0aCB0aGUgJGx0LCAkbHRlLCAkZ3QsIGFuZCAkZ3RlIG9wZXJhdG9ycydcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBwYXJzZXJSZXN1bHQgPSBVdGlscy5yZWxhdGl2ZVRpbWVUb0RhdGUodmFsLiRyZWxhdGl2ZVRpbWUpO1xuICAgICAgICAgIGlmIChwYXJzZXJSZXN1bHQuc3RhdHVzID09PSAnc3VjY2VzcycpIHtcbiAgICAgICAgICAgIGFuc3dlcltrZXldID0gcGFyc2VyUmVzdWx0LnJlc3VsdDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGxvZy5pbmZvKCdFcnJvciB3aGlsZSBwYXJzaW5nIHJlbGF0aXZlIGRhdGUnLCBwYXJzZXJSZXN1bHQpO1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgIGBiYWQgJHJlbGF0aXZlVGltZSAoJHtrZXl9KSB2YWx1ZS4gJHtwYXJzZXJSZXN1bHQuaW5mb31gXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFuc3dlcltrZXldID0gdHJhbnNmb3JtZXIodmFsKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNhc2UgJyRpbic6XG4gICAgICBjYXNlICckbmluJzoge1xuICAgICAgICBjb25zdCBhcnIgPSBjb25zdHJhaW50W2tleV07XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShhcnIpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCAnICsga2V5ICsgJyB2YWx1ZScpO1xuICAgICAgICB9XG4gICAgICAgIGFuc3dlcltrZXldID0gXy5mbGF0TWFwKGFyciwgdmFsdWUgPT4ge1xuICAgICAgICAgIHJldHVybiAoYXRvbSA9PiB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhdG9tKSkge1xuICAgICAgICAgICAgICByZXR1cm4gdmFsdWUubWFwKHRyYW5zZm9ybWVyKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJldHVybiB0cmFuc2Zvcm1lcihhdG9tKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KSh2YWx1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJyRhbGwnOiB7XG4gICAgICAgIGNvbnN0IGFyciA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGFycikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICcgKyBrZXkgKyAnIHZhbHVlJyk7XG4gICAgICAgIH1cbiAgICAgICAgYW5zd2VyW2tleV0gPSBhcnIubWFwKHRyYW5zZm9ybUludGVyaW9yQXRvbSk7XG5cbiAgICAgICAgY29uc3QgdmFsdWVzID0gYW5zd2VyW2tleV07XG4gICAgICAgIGlmIChpc0FueVZhbHVlUmVnZXgodmFsdWVzKSAmJiAhaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSh2YWx1ZXMpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ0FsbCAkYWxsIHZhbHVlcyBtdXN0IGJlIG9mIHJlZ2V4IHR5cGUgb3Igbm9uZTogJyArIHZhbHVlc1xuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJyRyZWdleCc6XG4gICAgICAgIHZhciBzID0gY29uc3RyYWludFtrZXldO1xuICAgICAgICBpZiAodHlwZW9mIHMgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCByZWdleDogJyArIHMpO1xuICAgICAgICB9XG4gICAgICAgIGFuc3dlcltrZXldID0gcztcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgJyRjb250YWluZWRCeSc6IHtcbiAgICAgICAgY29uc3QgYXJyID0gY29uc3RyYWludFtrZXldO1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoYXJyKSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGBiYWQgJGNvbnRhaW5lZEJ5OiBzaG91bGQgYmUgYW4gYXJyYXlgKTtcbiAgICAgICAgfVxuICAgICAgICBhbnN3ZXIuJGVsZW1NYXRjaCA9IHtcbiAgICAgICAgICAkbmluOiBhcnIubWFwKHRyYW5zZm9ybWVyKSxcbiAgICAgICAgfTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlICckb3B0aW9ucyc6XG4gICAgICAgIGFuc3dlcltrZXldID0gY29uc3RyYWludFtrZXldO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnJHRleHQnOiB7XG4gICAgICAgIGNvbnN0IHNlYXJjaCA9IGNvbnN0cmFpbnRba2V5XS4kc2VhcmNoO1xuICAgICAgICBpZiAodHlwZW9mIHNlYXJjaCAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgYmFkICR0ZXh0OiAkc2VhcmNoLCBzaG91bGQgYmUgb2JqZWN0YCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFzZWFyY2guJHRlcm0gfHwgdHlwZW9mIHNlYXJjaC4kdGVybSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgYmFkICR0ZXh0OiAkdGVybSwgc2hvdWxkIGJlIHN0cmluZ2ApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGFuc3dlcltrZXldID0ge1xuICAgICAgICAgICAgJHNlYXJjaDogc2VhcmNoLiR0ZXJtLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNlYXJjaC4kbGFuZ3VhZ2UgJiYgdHlwZW9mIHNlYXJjaC4kbGFuZ3VhZ2UgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYGJhZCAkdGV4dDogJGxhbmd1YWdlLCBzaG91bGQgYmUgc3RyaW5nYCk7XG4gICAgICAgIH0gZWxzZSBpZiAoc2VhcmNoLiRsYW5ndWFnZSkge1xuICAgICAgICAgIGFuc3dlcltrZXldLiRsYW5ndWFnZSA9IHNlYXJjaC4kbGFuZ3VhZ2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNlYXJjaC4kY2FzZVNlbnNpdGl2ZSAmJiB0eXBlb2Ygc2VhcmNoLiRjYXNlU2Vuc2l0aXZlICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICBgYmFkICR0ZXh0OiAkY2FzZVNlbnNpdGl2ZSwgc2hvdWxkIGJlIGJvb2xlYW5gXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChzZWFyY2guJGNhc2VTZW5zaXRpdmUpIHtcbiAgICAgICAgICBhbnN3ZXJba2V5XS4kY2FzZVNlbnNpdGl2ZSA9IHNlYXJjaC4kY2FzZVNlbnNpdGl2ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc2VhcmNoLiRkaWFjcml0aWNTZW5zaXRpdmUgJiYgdHlwZW9mIHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICBgYmFkICR0ZXh0OiAkZGlhY3JpdGljU2Vuc2l0aXZlLCBzaG91bGQgYmUgYm9vbGVhbmBcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlKSB7XG4gICAgICAgICAgYW5zd2VyW2tleV0uJGRpYWNyaXRpY1NlbnNpdGl2ZSA9IHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY2FzZSAnJG5lYXJTcGhlcmUnOiB7XG4gICAgICAgIGNvbnN0IHBvaW50ID0gY29uc3RyYWludFtrZXldO1xuICAgICAgICBpZiAoY291bnQpIHtcbiAgICAgICAgICBhbnN3ZXIuJGdlb1dpdGhpbiA9IHtcbiAgICAgICAgICAgICRjZW50ZXJTcGhlcmU6IFtbcG9pbnQubG9uZ2l0dWRlLCBwb2ludC5sYXRpdHVkZV0sIGNvbnN0cmFpbnQuJG1heERpc3RhbmNlXSxcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGFuc3dlcltrZXldID0gW3BvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGVdO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY2FzZSAnJG1heERpc3RhbmNlJzoge1xuICAgICAgICBpZiAoY291bnQpIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBhbnN3ZXJba2V5XSA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICAvLyBUaGUgU0RLcyBkb24ndCBzZWVtIHRvIHVzZSB0aGVzZSBidXQgdGhleSBhcmUgZG9jdW1lbnRlZCBpbiB0aGVcbiAgICAgIC8vIFJFU1QgQVBJIGRvY3MuXG4gICAgICBjYXNlICckbWF4RGlzdGFuY2VJblJhZGlhbnMnOlxuICAgICAgICBhbnN3ZXJbJyRtYXhEaXN0YW5jZSddID0gY29uc3RyYWludFtrZXldO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJyRtYXhEaXN0YW5jZUluTWlsZXMnOlxuICAgICAgICBhbnN3ZXJbJyRtYXhEaXN0YW5jZSddID0gY29uc3RyYWludFtrZXldIC8gMzk1OTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICckbWF4RGlzdGFuY2VJbktpbG9tZXRlcnMnOlxuICAgICAgICBhbnN3ZXJbJyRtYXhEaXN0YW5jZSddID0gY29uc3RyYWludFtrZXldIC8gNjM3MTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgJyRzZWxlY3QnOlxuICAgICAgY2FzZSAnJGRvbnRTZWxlY3QnOlxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuQ09NTUFORF9VTkFWQUlMQUJMRSxcbiAgICAgICAgICAndGhlICcgKyBrZXkgKyAnIGNvbnN0cmFpbnQgaXMgbm90IHN1cHBvcnRlZCB5ZXQnXG4gICAgICAgICk7XG5cbiAgICAgIGNhc2UgJyR3aXRoaW4nOlxuICAgICAgICB2YXIgYm94ID0gY29uc3RyYWludFtrZXldWyckYm94J107XG4gICAgICAgIGlmICghYm94IHx8IGJveC5sZW5ndGggIT0gMikge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdtYWxmb3JtYXR0ZWQgJHdpdGhpbiBhcmcnKTtcbiAgICAgICAgfVxuICAgICAgICBhbnN3ZXJba2V5XSA9IHtcbiAgICAgICAgICAkYm94OiBbXG4gICAgICAgICAgICBbYm94WzBdLmxvbmdpdHVkZSwgYm94WzBdLmxhdGl0dWRlXSxcbiAgICAgICAgICAgIFtib3hbMV0ubG9uZ2l0dWRlLCBib3hbMV0ubGF0aXR1ZGVdLFxuICAgICAgICAgIF0sXG4gICAgICAgIH07XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICckZ2VvV2l0aGluJzoge1xuICAgICAgICBjb25zdCBwb2x5Z29uID0gY29uc3RyYWludFtrZXldWyckcG9seWdvbiddO1xuICAgICAgICBjb25zdCBjZW50ZXJTcGhlcmUgPSBjb25zdHJhaW50W2tleV1bJyRjZW50ZXJTcGhlcmUnXTtcbiAgICAgICAgaWYgKHBvbHlnb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGxldCBwb2ludHM7XG4gICAgICAgICAgaWYgKHR5cGVvZiBwb2x5Z29uID09PSAnb2JqZWN0JyAmJiBwb2x5Z29uLl9fdHlwZSA9PT0gJ1BvbHlnb24nKSB7XG4gICAgICAgICAgICBpZiAoIXBvbHlnb24uY29vcmRpbmF0ZXMgfHwgcG9seWdvbi5jb29yZGluYXRlcy5sZW5ndGggPCAzKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyBQb2x5Z29uLmNvb3JkaW5hdGVzIHNob3VsZCBjb250YWluIGF0IGxlYXN0IDMgbG9uL2xhdCBwYWlycydcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBvaW50cyA9IHBvbHlnb24uY29vcmRpbmF0ZXM7XG4gICAgICAgICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KHBvbHlnb24pKSB7XG4gICAgICAgICAgICBpZiAocG9seWdvbi5sZW5ndGggPCAzKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkcG9seWdvbiBzaG91bGQgY29udGFpbiBhdCBsZWFzdCAzIEdlb1BvaW50cydcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBvaW50cyA9IHBvbHlnb247XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICBcImJhZCAkZ2VvV2l0aGluIHZhbHVlOyAkcG9seWdvbiBzaG91bGQgYmUgUG9seWdvbiBvYmplY3Qgb3IgQXJyYXkgb2YgUGFyc2UuR2VvUG9pbnQnc1wiXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBwb2ludHMgPSBwb2ludHMubWFwKHBvaW50ID0+IHtcbiAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBvaW50KSAmJiBwb2ludC5sZW5ndGggPT09IDIpIHtcbiAgICAgICAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50WzFdLCBwb2ludFswXSk7XG4gICAgICAgICAgICAgIHJldHVybiBwb2ludDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkSlNPTihwb2ludCkpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlJyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gW3BvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGVdO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGFuc3dlcltrZXldID0ge1xuICAgICAgICAgICAgJHBvbHlnb246IHBvaW50cyxcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2UgaWYgKGNlbnRlclNwaGVyZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGNlbnRlclNwaGVyZSkgfHwgY2VudGVyU3BoZXJlLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgc2hvdWxkIGJlIGFuIGFycmF5IG9mIFBhcnNlLkdlb1BvaW50IGFuZCBkaXN0YW5jZSdcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIEdldCBwb2ludCwgY29udmVydCB0byBnZW8gcG9pbnQgaWYgbmVjZXNzYXJ5IGFuZCB2YWxpZGF0ZVxuICAgICAgICAgIGxldCBwb2ludCA9IGNlbnRlclNwaGVyZVswXTtcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwb2ludCkgJiYgcG9pbnQubGVuZ3RoID09PSAyKSB7XG4gICAgICAgICAgICBwb2ludCA9IG5ldyBQYXJzZS5HZW9Qb2ludChwb2ludFsxXSwgcG9pbnRbMF0pO1xuICAgICAgICAgIH0gZWxzZSBpZiAoIUdlb1BvaW50Q29kZXIuaXNWYWxpZEpTT04ocG9pbnQpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkY2VudGVyU3BoZXJlIGdlbyBwb2ludCBpbnZhbGlkJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50LmxhdGl0dWRlLCBwb2ludC5sb25naXR1ZGUpO1xuICAgICAgICAgIC8vIEdldCBkaXN0YW5jZSBhbmQgdmFsaWRhdGVcbiAgICAgICAgICBjb25zdCBkaXN0YW5jZSA9IGNlbnRlclNwaGVyZVsxXTtcbiAgICAgICAgICBpZiAoaXNOYU4oZGlzdGFuY2UpIHx8IGRpc3RhbmNlIDwgMCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJGNlbnRlclNwaGVyZSBkaXN0YW5jZSBpbnZhbGlkJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICAgICAkY2VudGVyU3BoZXJlOiBbW3BvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGVdLCBkaXN0YW5jZV0sXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJyRnZW9JbnRlcnNlY3RzJzoge1xuICAgICAgICBjb25zdCBwb2ludCA9IGNvbnN0cmFpbnRba2V5XVsnJHBvaW50J107XG4gICAgICAgIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkSlNPTihwb2ludCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAnYmFkICRnZW9JbnRlcnNlY3QgdmFsdWU7ICRwb2ludCBzaG91bGQgYmUgR2VvUG9pbnQnXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAgIH1cbiAgICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICAgJGdlb21ldHJ5OiB7XG4gICAgICAgICAgICB0eXBlOiAnUG9pbnQnLFxuICAgICAgICAgICAgY29vcmRpbmF0ZXM6IFtwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChrZXkubWF0Y2goL15cXCQrLykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkIGNvbnN0cmFpbnQ6ICcgKyBrZXkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBDYW5ub3RUcmFuc2Zvcm07XG4gICAgfVxuICB9XG4gIHJldHVybiBhbnN3ZXI7XG59XG5cbi8vIFRyYW5zZm9ybXMgYW4gdXBkYXRlIG9wZXJhdG9yIGZyb20gUkVTVCBmb3JtYXQgdG8gbW9uZ28gZm9ybWF0LlxuLy8gVG8gYmUgdHJhbnNmb3JtZWQsIHRoZSBpbnB1dCBzaG91bGQgaGF2ZSBhbiBfX29wIGZpZWxkLlxuLy8gSWYgZmxhdHRlbiBpcyB0cnVlLCB0aGlzIHdpbGwgZmxhdHRlbiBvcGVyYXRvcnMgdG8gdGhlaXIgc3RhdGljXG4vLyBkYXRhIGZvcm1hdC4gRm9yIGV4YW1wbGUsIGFuIGluY3JlbWVudCBvZiAyIHdvdWxkIHNpbXBseSBiZWNvbWUgYVxuLy8gMi5cbi8vIFRoZSBvdXRwdXQgZm9yIGEgbm9uLWZsYXR0ZW5lZCBvcGVyYXRvciBpcyBhIGhhc2ggd2l0aCBfX29wIGJlaW5nXG4vLyB0aGUgbW9uZ28gb3AsIGFuZCBhcmcgYmVpbmcgdGhlIGFyZ3VtZW50LlxuLy8gVGhlIG91dHB1dCBmb3IgYSBmbGF0dGVuZWQgb3BlcmF0b3IgaXMganVzdCBhIHZhbHVlLlxuLy8gUmV0dXJucyB1bmRlZmluZWQgaWYgdGhpcyBzaG91bGQgYmUgYSBuby1vcC5cblxuZnVuY3Rpb24gdHJhbnNmb3JtVXBkYXRlT3BlcmF0b3IoeyBfX29wLCBhbW91bnQsIG9iamVjdHMgfSwgZmxhdHRlbikge1xuICBzd2l0Y2ggKF9fb3ApIHtcbiAgICBjYXNlICdEZWxldGUnOlxuICAgICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiB7IF9fb3A6ICckdW5zZXQnLCBhcmc6ICcnIH07XG4gICAgICB9XG5cbiAgICBjYXNlICdJbmNyZW1lbnQnOlxuICAgICAgaWYgKHR5cGVvZiBhbW91bnQgIT09ICdudW1iZXInKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdpbmNyZW1lbnRpbmcgbXVzdCBwcm92aWRlIGEgbnVtYmVyJyk7XG4gICAgICB9XG4gICAgICBpZiAoZmxhdHRlbikge1xuICAgICAgICByZXR1cm4gYW1vdW50O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHsgX19vcDogJyRpbmMnLCBhcmc6IGFtb3VudCB9O1xuICAgICAgfVxuXG4gICAgY2FzZSAnU2V0T25JbnNlcnQnOlxuICAgICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgICAgcmV0dXJuIGFtb3VudDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiB7IF9fb3A6ICckc2V0T25JbnNlcnQnLCBhcmc6IGFtb3VudCB9O1xuICAgICAgfVxuXG4gICAgY2FzZSAnQWRkJzpcbiAgICBjYXNlICdBZGRVbmlxdWUnOlxuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KG9iamVjdHMpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdvYmplY3RzIHRvIGFkZCBtdXN0IGJlIGFuIGFycmF5Jyk7XG4gICAgICB9XG4gICAgICB2YXIgdG9BZGQgPSBvYmplY3RzLm1hcCh0cmFuc2Zvcm1JbnRlcmlvckF0b20pO1xuICAgICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgICAgcmV0dXJuIHRvQWRkO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIG1vbmdvT3AgPSB7XG4gICAgICAgICAgQWRkOiAnJHB1c2gnLFxuICAgICAgICAgIEFkZFVuaXF1ZTogJyRhZGRUb1NldCcsXG4gICAgICAgIH1bX19vcF07XG4gICAgICAgIHJldHVybiB7IF9fb3A6IG1vbmdvT3AsIGFyZzogeyAkZWFjaDogdG9BZGQgfSB9O1xuICAgICAgfVxuXG4gICAgY2FzZSAnUmVtb3ZlJzpcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShvYmplY3RzKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnb2JqZWN0cyB0byByZW1vdmUgbXVzdCBiZSBhbiBhcnJheScpO1xuICAgICAgfVxuICAgICAgdmFyIHRvUmVtb3ZlID0gb2JqZWN0cy5tYXAodHJhbnNmb3JtSW50ZXJpb3JBdG9tKTtcbiAgICAgIGlmIChmbGF0dGVuKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiB7IF9fb3A6ICckcHVsbEFsbCcsIGFyZzogdG9SZW1vdmUgfTtcbiAgICAgIH1cblxuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLkNPTU1BTkRfVU5BVkFJTEFCTEUsXG4gICAgICAgIGBUaGUgJHtfX29wfSBvcGVyYXRvciBpcyBub3Qgc3VwcG9ydGVkIHlldC5gXG4gICAgICApO1xuICB9XG59XG5mdW5jdGlvbiBtYXBWYWx1ZXMob2JqZWN0LCBpdGVyYXRvcikge1xuICBjb25zdCByZXN1bHQgPSB7fTtcbiAgT2JqZWN0LmtleXMob2JqZWN0KS5mb3JFYWNoKGtleSA9PiB7XG4gICAgcmVzdWx0W2tleV0gPSBpdGVyYXRvcihvYmplY3Rba2V5XSk7XG4gIH0pO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5jb25zdCBuZXN0ZWRNb25nb09iamVjdFRvTmVzdGVkUGFyc2VPYmplY3QgPSBtb25nb09iamVjdCA9PiB7XG4gIHN3aXRjaCAodHlwZW9mIG1vbmdvT2JqZWN0KSB7XG4gICAgY2FzZSAnc3RyaW5nJzpcbiAgICBjYXNlICdudW1iZXInOlxuICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgIGNhc2UgJ3VuZGVmaW5lZCc6XG4gICAgICByZXR1cm4gbW9uZ29PYmplY3Q7XG4gICAgY2FzZSAnc3ltYm9sJzpcbiAgICBjYXNlICdmdW5jdGlvbic6XG4gICAgICB0aHJvdyAnYmFkIHZhbHVlIGluIG5lc3RlZE1vbmdvT2JqZWN0VG9OZXN0ZWRQYXJzZU9iamVjdCc7XG4gICAgY2FzZSAnb2JqZWN0JzpcbiAgICAgIGlmIChtb25nb09iamVjdCA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KG1vbmdvT2JqZWN0KSkge1xuICAgICAgICByZXR1cm4gbW9uZ29PYmplY3QubWFwKG5lc3RlZE1vbmdvT2JqZWN0VG9OZXN0ZWRQYXJzZU9iamVjdCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChVdGlscy5pc0RhdGUobW9uZ29PYmplY3QpKSB7XG4gICAgICAgIHJldHVybiBQYXJzZS5fZW5jb2RlKG1vbmdvT2JqZWN0KTtcbiAgICAgIH1cblxuICAgICAgaWYgKG1vbmdvT2JqZWN0IGluc3RhbmNlb2YgbW9uZ29kYi5Mb25nKSB7XG4gICAgICAgIHJldHVybiBtb25nb09iamVjdC50b051bWJlcigpO1xuICAgICAgfVxuXG4gICAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBtb25nb2RiLkRvdWJsZSkge1xuICAgICAgICByZXR1cm4gbW9uZ29PYmplY3QudmFsdWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChCeXRlc0NvZGVyLmlzVmFsaWREYXRhYmFzZU9iamVjdChtb25nb09iamVjdCkpIHtcbiAgICAgICAgcmV0dXJuIEJ5dGVzQ29kZXIuZGF0YWJhc2VUb0pTT04obW9uZ29PYmplY3QpO1xuICAgICAgfVxuXG4gICAgICBpZiAoXG4gICAgICAgIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChtb25nb09iamVjdCwgJ19fdHlwZScpICYmXG4gICAgICAgIG1vbmdvT2JqZWN0Ll9fdHlwZSA9PSAnRGF0ZScgJiZcbiAgICAgICAgVXRpbHMuaXNEYXRlKG1vbmdvT2JqZWN0LmlzbylcbiAgICAgICkge1xuICAgICAgICBtb25nb09iamVjdC5pc28gPSBtb25nb09iamVjdC5pc28udG9KU09OKCk7XG4gICAgICAgIHJldHVybiBtb25nb09iamVjdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG1hcFZhbHVlcyhtb25nb09iamVjdCwgbmVzdGVkTW9uZ29PYmplY3RUb05lc3RlZFBhcnNlT2JqZWN0KTtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgJ3Vua25vd24ganMgdHlwZSc7XG4gIH1cbn07XG5cbmNvbnN0IHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcgPSAoc2NoZW1hLCBmaWVsZCwgcG9pbnRlclN0cmluZykgPT4ge1xuICBjb25zdCBvYmpEYXRhID0gcG9pbnRlclN0cmluZy5zcGxpdCgnJCcpO1xuICBpZiAob2JqRGF0YVswXSAhPT0gc2NoZW1hLmZpZWxkc1tmaWVsZF0udGFyZ2V0Q2xhc3MpIHtcbiAgICB0aHJvdyAncG9pbnRlciB0byBpbmNvcnJlY3QgY2xhc3NOYW1lJztcbiAgfVxuICByZXR1cm4ge1xuICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgIGNsYXNzTmFtZTogb2JqRGF0YVswXSxcbiAgICBvYmplY3RJZDogb2JqRGF0YVsxXSxcbiAgfTtcbn07XG5cbi8vIENvbnZlcnRzIGZyb20gYSBtb25nby1mb3JtYXQgb2JqZWN0IHRvIGEgUkVTVC1mb3JtYXQgb2JqZWN0LlxuLy8gRG9lcyBub3Qgc3RyaXAgb3V0IGFueXRoaW5nIGJhc2VkIG9uIGEgbGFjayBvZiBhdXRoZW50aWNhdGlvbi5cbmNvbnN0IG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCA9IChjbGFzc05hbWUsIG1vbmdvT2JqZWN0LCBzY2hlbWEpID0+IHtcbiAgc3dpdGNoICh0eXBlb2YgbW9uZ29PYmplY3QpIHtcbiAgICBjYXNlICdzdHJpbmcnOlxuICAgIGNhc2UgJ251bWJlcic6XG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICAgIHJldHVybiBtb25nb09iamVjdDtcbiAgICBjYXNlICdzeW1ib2wnOlxuICAgIGNhc2UgJ2Z1bmN0aW9uJzpcbiAgICAgIHRocm93ICdiYWQgdmFsdWUgaW4gbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0JztcbiAgICBjYXNlICdvYmplY3QnOiB7XG4gICAgICBpZiAobW9uZ29PYmplY3QgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShtb25nb09iamVjdCkpIHtcbiAgICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0Lm1hcChuZXN0ZWRNb25nb09iamVjdFRvTmVzdGVkUGFyc2VPYmplY3QpO1xuICAgICAgfVxuXG4gICAgICBpZiAoVXRpbHMuaXNEYXRlKG1vbmdvT2JqZWN0KSkge1xuICAgICAgICByZXR1cm4gUGFyc2UuX2VuY29kZShtb25nb09iamVjdCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChtb25nb09iamVjdCBpbnN0YW5jZW9mIG1vbmdvZGIuTG9uZykge1xuICAgICAgICByZXR1cm4gbW9uZ29PYmplY3QudG9OdW1iZXIoKTtcbiAgICAgIH1cblxuICAgICAgaWYgKG1vbmdvT2JqZWN0IGluc3RhbmNlb2YgbW9uZ29kYi5Eb3VibGUpIHtcbiAgICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0LnZhbHVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoQnl0ZXNDb2Rlci5pc1ZhbGlkRGF0YWJhc2VPYmplY3QobW9uZ29PYmplY3QpKSB7XG4gICAgICAgIHJldHVybiBCeXRlc0NvZGVyLmRhdGFiYXNlVG9KU09OKG1vbmdvT2JqZWN0KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzdE9iamVjdCA9IHt9O1xuICAgICAgaWYgKG1vbmdvT2JqZWN0Ll9ycGVybSB8fCBtb25nb09iamVjdC5fd3Blcm0pIHtcbiAgICAgICAgcmVzdE9iamVjdC5fcnBlcm0gPSBtb25nb09iamVjdC5fcnBlcm0gfHwgW107XG4gICAgICAgIHJlc3RPYmplY3QuX3dwZXJtID0gbW9uZ29PYmplY3QuX3dwZXJtIHx8IFtdO1xuICAgICAgICBkZWxldGUgbW9uZ29PYmplY3QuX3JwZXJtO1xuICAgICAgICBkZWxldGUgbW9uZ29PYmplY3QuX3dwZXJtO1xuICAgICAgfVxuXG4gICAgICBmb3IgKHZhciBrZXkgaW4gbW9uZ29PYmplY3QpIHtcbiAgICAgICAgc3dpdGNoIChrZXkpIHtcbiAgICAgICAgICBjYXNlICdfaWQnOlxuICAgICAgICAgICAgcmVzdE9iamVjdFsnb2JqZWN0SWQnXSA9ICcnICsgbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ19oYXNoZWRfcGFzc3dvcmQnOlxuICAgICAgICAgICAgcmVzdE9iamVjdC5faGFzaGVkX3Bhc3N3b3JkID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ19hY2wnOlxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnX2VtYWlsX3ZlcmlmeV90b2tlbic6XG4gICAgICAgICAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW4nOlxuICAgICAgICAgIGNhc2UgJ19wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgICAgICAgIGNhc2UgJ19wYXNzd29yZF9jaGFuZ2VkX2F0JzpcbiAgICAgICAgICBjYXNlICdfdG9tYnN0b25lJzpcbiAgICAgICAgICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgICAgICAgIGNhc2UgJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCc6XG4gICAgICAgICAgY2FzZSAnX2ZhaWxlZF9sb2dpbl9jb3VudCc6XG4gICAgICAgICAgY2FzZSAnX3Bhc3N3b3JkX2hpc3RvcnknOlxuICAgICAgICAgICAgLy8gVGhvc2Uga2V5cyB3aWxsIGJlIGRlbGV0ZWQgaWYgbmVlZGVkIGluIHRoZSBEQiBDb250cm9sbGVyXG4gICAgICAgICAgICByZXN0T2JqZWN0W2tleV0gPSBtb25nb09iamVjdFtrZXldO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnX3Nlc3Npb25fdG9rZW4nOlxuICAgICAgICAgICAgcmVzdE9iamVjdFsnc2Vzc2lvblRva2VuJ10gPSBtb25nb09iamVjdFtrZXldO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAndXBkYXRlZEF0JzpcbiAgICAgICAgICBjYXNlICdfdXBkYXRlZF9hdCc6XG4gICAgICAgICAgICByZXN0T2JqZWN0Wyd1cGRhdGVkQXQnXSA9IFBhcnNlLl9lbmNvZGUobmV3IERhdGUobW9uZ29PYmplY3Rba2V5XSkpLmlzbztcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ2NyZWF0ZWRBdCc6XG4gICAgICAgICAgY2FzZSAnX2NyZWF0ZWRfYXQnOlxuICAgICAgICAgICAgcmVzdE9iamVjdFsnY3JlYXRlZEF0J10gPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKG1vbmdvT2JqZWN0W2tleV0pKS5pc287XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdleHBpcmVzQXQnOlxuICAgICAgICAgIGNhc2UgJ19leHBpcmVzQXQnOlxuICAgICAgICAgICAgcmVzdE9iamVjdFsnZXhwaXJlc0F0J10gPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKG1vbmdvT2JqZWN0W2tleV0pKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ2xhc3RVc2VkJzpcbiAgICAgICAgICBjYXNlICdfbGFzdF91c2VkJzpcbiAgICAgICAgICAgIHJlc3RPYmplY3RbJ2xhc3RVc2VkJ10gPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKG1vbmdvT2JqZWN0W2tleV0pKS5pc287XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICd0aW1lc1VzZWQnOlxuICAgICAgICAgIGNhc2UgJ3RpbWVzX3VzZWQnOlxuICAgICAgICAgICAgcmVzdE9iamVjdFsndGltZXNVc2VkJ10gPSBtb25nb09iamVjdFtrZXldO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnYXV0aERhdGEnOlxuICAgICAgICAgICAgaWYgKGNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgICAgICAgICAgICBsb2cud2FybihcbiAgICAgICAgICAgICAgICAnaWdub3JpbmcgYXV0aERhdGEgaW4gX1VzZXIgYXMgdGhpcyBrZXkgaXMgcmVzZXJ2ZWQgdG8gYmUgc3ludGhlc2l6ZWQgb2YgYF9hdXRoX2RhdGFfKmAga2V5cydcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJlc3RPYmplY3RbJ2F1dGhEYXRhJ10gPSBtb25nb09iamVjdFtrZXldO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIC8vIENoZWNrIG90aGVyIGF1dGggZGF0YSBrZXlzXG4gICAgICAgICAgICB2YXIgYXV0aERhdGFNYXRjaCA9IGtleS5tYXRjaCgvXl9hdXRoX2RhdGFfKFthLXpBLVowLTlfXSspJC8pO1xuICAgICAgICAgICAgaWYgKGF1dGhEYXRhTWF0Y2ggJiYgY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgICAgICAgICAgIHZhciBwcm92aWRlciA9IGF1dGhEYXRhTWF0Y2hbMV07XG4gICAgICAgICAgICAgIHJlc3RPYmplY3RbJ2F1dGhEYXRhJ10gPSByZXN0T2JqZWN0WydhdXRoRGF0YSddIHx8IHt9O1xuICAgICAgICAgICAgICByZXN0T2JqZWN0WydhdXRoRGF0YSddW3Byb3ZpZGVyXSA9IG1vbmdvT2JqZWN0W2tleV07XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoa2V5LmluZGV4T2YoJ19wXycpID09IDApIHtcbiAgICAgICAgICAgICAgdmFyIG5ld0tleSA9IGtleS5zdWJzdHJpbmcoMyk7XG4gICAgICAgICAgICAgIGlmICghc2NoZW1hLmZpZWxkc1tuZXdLZXldKSB7XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXG4gICAgICAgICAgICAgICAgICAndHJhbnNmb3JtLmpzJyxcbiAgICAgICAgICAgICAgICAgICdGb3VuZCBhIHBvaW50ZXIgY29sdW1uIG5vdCBpbiB0aGUgc2NoZW1hLCBkcm9wcGluZyBpdC4nLFxuICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAgbmV3S2V5XG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAoc2NoZW1hLmZpZWxkc1tuZXdLZXldLnR5cGUgIT09ICdQb2ludGVyJykge1xuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFxuICAgICAgICAgICAgICAgICAgJ3RyYW5zZm9ybS5qcycsXG4gICAgICAgICAgICAgICAgICAnRm91bmQgYSBwb2ludGVyIGluIGEgbm9uLXBvaW50ZXIgY29sdW1uLCBkcm9wcGluZyBpdC4nLFxuICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAga2V5XG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAobW9uZ29PYmplY3Rba2V5XSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJlc3RPYmplY3RbbmV3S2V5XSA9IHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcoc2NoZW1hLCBuZXdLZXksIG1vbmdvT2JqZWN0W2tleV0pO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoa2V5WzBdID09ICdfJyAmJiBrZXkgIT0gJ19fdHlwZScpIHtcbiAgICAgICAgICAgICAgdGhyb3cgJ2JhZCBrZXkgaW4gdW50cmFuc2Zvcm06ICcgKyBrZXk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB2YXIgdmFsdWUgPSBtb25nb09iamVjdFtrZXldO1xuICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgc2NoZW1hLmZpZWxkc1trZXldICYmXG4gICAgICAgICAgICAgICAgc2NoZW1hLmZpZWxkc1trZXldLnR5cGUgPT09ICdGaWxlJyAmJlxuICAgICAgICAgICAgICAgIEZpbGVDb2Rlci5pc1ZhbGlkRGF0YWJhc2VPYmplY3QodmFsdWUpXG4gICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIHJlc3RPYmplY3Rba2V5XSA9IEZpbGVDb2Rlci5kYXRhYmFzZVRvSlNPTih2YWx1ZSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIHNjaGVtYS5maWVsZHNba2V5XSAmJlxuICAgICAgICAgICAgICAgIHNjaGVtYS5maWVsZHNba2V5XS50eXBlID09PSAnR2VvUG9pbnQnICYmXG4gICAgICAgICAgICAgICAgR2VvUG9pbnRDb2Rlci5pc1ZhbGlkRGF0YWJhc2VPYmplY3QodmFsdWUpXG4gICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIHJlc3RPYmplY3Rba2V5XSA9IEdlb1BvaW50Q29kZXIuZGF0YWJhc2VUb0pTT04odmFsdWUpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICBzY2hlbWEuZmllbGRzW2tleV0gJiZcbiAgICAgICAgICAgICAgICBzY2hlbWEuZmllbGRzW2tleV0udHlwZSA9PT0gJ1BvbHlnb24nICYmXG4gICAgICAgICAgICAgICAgUG9seWdvbkNvZGVyLmlzVmFsaWREYXRhYmFzZU9iamVjdCh2YWx1ZSlcbiAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgcmVzdE9iamVjdFtrZXldID0gUG9seWdvbkNvZGVyLmRhdGFiYXNlVG9KU09OKHZhbHVlKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgc2NoZW1hLmZpZWxkc1trZXldICYmXG4gICAgICAgICAgICAgICAgc2NoZW1hLmZpZWxkc1trZXldLnR5cGUgPT09ICdCeXRlcycgJiZcbiAgICAgICAgICAgICAgICBCeXRlc0NvZGVyLmlzVmFsaWREYXRhYmFzZU9iamVjdCh2YWx1ZSlcbiAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgcmVzdE9iamVjdFtrZXldID0gQnl0ZXNDb2Rlci5kYXRhYmFzZVRvSlNPTih2YWx1ZSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlc3RPYmplY3Rba2V5XSA9IG5lc3RlZE1vbmdvT2JqZWN0VG9OZXN0ZWRQYXJzZU9iamVjdChtb25nb09iamVjdFtrZXldKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGlvbkZpZWxkTmFtZXMgPSBPYmplY3Qua2V5cyhzY2hlbWEuZmllbGRzKS5maWx0ZXIoXG4gICAgICAgIGZpZWxkTmFtZSA9PiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1JlbGF0aW9uJ1xuICAgICAgKTtcbiAgICAgIGNvbnN0IHJlbGF0aW9uRmllbGRzID0ge307XG4gICAgICByZWxhdGlvbkZpZWxkTmFtZXMuZm9yRWFjaChyZWxhdGlvbkZpZWxkTmFtZSA9PiB7XG4gICAgICAgIHJlbGF0aW9uRmllbGRzW3JlbGF0aW9uRmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX3R5cGU6ICdSZWxhdGlvbicsXG4gICAgICAgICAgY2xhc3NOYW1lOiBzY2hlbWEuZmllbGRzW3JlbGF0aW9uRmllbGROYW1lXS50YXJnZXRDbGFzcyxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuXG4gICAgICByZXR1cm4geyAuLi5yZXN0T2JqZWN0LCAuLi5yZWxhdGlvbkZpZWxkcyB9O1xuICAgIH1cbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgJ3Vua25vd24ganMgdHlwZSc7XG4gIH1cbn07XG5cbnZhciBEYXRlQ29kZXIgPSB7XG4gIEpTT05Ub0RhdGFiYXNlKGpzb24pIHtcbiAgICByZXR1cm4gbmV3IERhdGUoanNvbi5pc28pO1xuICB9LFxuXG4gIGlzVmFsaWRKU09OKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgIT09IG51bGwgJiYgdmFsdWUuX190eXBlID09PSAnRGF0ZSc7XG4gIH0sXG59O1xuXG52YXIgQnl0ZXNDb2RlciA9IHtcbiAgYmFzZTY0UGF0dGVybjogbmV3IFJlZ0V4cCgnXig/OltBLVphLXowLTkrL117NH0pKig/OltBLVphLXowLTkrL117Mn09PXxbQS1aYS16MC05Ky9dezN9PSk/JCcpLFxuICBpc0Jhc2U2NFZhbHVlKG9iamVjdCkge1xuICAgIGlmICh0eXBlb2Ygb2JqZWN0ICE9PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5iYXNlNjRQYXR0ZXJuLnRlc3Qob2JqZWN0KTtcbiAgfSxcblxuICBkYXRhYmFzZVRvSlNPTihvYmplY3QpIHtcbiAgICBsZXQgdmFsdWU7XG4gICAgaWYgKHRoaXMuaXNCYXNlNjRWYWx1ZShvYmplY3QpKSB7XG4gICAgICB2YWx1ZSA9IG9iamVjdDtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgPSBvYmplY3QuYnVmZmVyLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIF9fdHlwZTogJ0J5dGVzJyxcbiAgICAgIGJhc2U2NDogdmFsdWUsXG4gICAgfTtcbiAgfSxcblxuICBpc1ZhbGlkRGF0YWJhc2VPYmplY3Qob2JqZWN0KSB7XG4gICAgcmV0dXJuIG9iamVjdCBpbnN0YW5jZW9mIG1vbmdvZGIuQmluYXJ5IHx8IHRoaXMuaXNCYXNlNjRWYWx1ZShvYmplY3QpO1xuICB9LFxuXG4gIEpTT05Ub0RhdGFiYXNlKGpzb24pIHtcbiAgICByZXR1cm4gbmV3IG1vbmdvZGIuQmluYXJ5KEJ1ZmZlci5mcm9tKGpzb24uYmFzZTY0LCAnYmFzZTY0JykpO1xuICB9LFxuXG4gIGlzVmFsaWRKU09OKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgIT09IG51bGwgJiYgdmFsdWUuX190eXBlID09PSAnQnl0ZXMnO1xuICB9LFxufTtcblxudmFyIEdlb1BvaW50Q29kZXIgPSB7XG4gIGRhdGFiYXNlVG9KU09OKG9iamVjdCkge1xuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdHZW9Qb2ludCcsXG4gICAgICBsYXRpdHVkZTogb2JqZWN0WzFdLFxuICAgICAgbG9uZ2l0dWRlOiBvYmplY3RbMF0sXG4gICAgfTtcbiAgfSxcblxuICBpc1ZhbGlkRGF0YWJhc2VPYmplY3Qob2JqZWN0KSB7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkob2JqZWN0KSAmJiBvYmplY3QubGVuZ3RoID09IDI7XG4gIH0sXG5cbiAgSlNPTlRvRGF0YWJhc2UoanNvbikge1xuICAgIHJldHVybiBbanNvbi5sb25naXR1ZGUsIGpzb24ubGF0aXR1ZGVdO1xuICB9LFxuXG4gIGlzVmFsaWRKU09OKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgIT09IG51bGwgJiYgdmFsdWUuX190eXBlID09PSAnR2VvUG9pbnQnO1xuICB9LFxufTtcblxudmFyIFBvbHlnb25Db2RlciA9IHtcbiAgZGF0YWJhc2VUb0pTT04ob2JqZWN0KSB7XG4gICAgLy8gQ29udmVydCBsbmcvbGF0IC0+IGxhdC9sbmdcbiAgICBjb25zdCBjb29yZHMgPSBvYmplY3QuY29vcmRpbmF0ZXNbMF0ubWFwKGNvb3JkID0+IHtcbiAgICAgIHJldHVybiBbY29vcmRbMV0sIGNvb3JkWzBdXTtcbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgX190eXBlOiAnUG9seWdvbicsXG4gICAgICBjb29yZGluYXRlczogY29vcmRzLFxuICAgIH07XG4gIH0sXG5cbiAgaXNWYWxpZERhdGFiYXNlT2JqZWN0KG9iamVjdCkge1xuICAgIGNvbnN0IGNvb3JkcyA9IG9iamVjdC5jb29yZGluYXRlc1swXTtcbiAgICBpZiAob2JqZWN0LnR5cGUgIT09ICdQb2x5Z29uJyB8fCAhQXJyYXkuaXNBcnJheShjb29yZHMpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBwb2ludCA9IGNvb3Jkc1tpXTtcbiAgICAgIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkRGF0YWJhc2VPYmplY3QocG9pbnQpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwYXJzZUZsb2F0KHBvaW50WzFdKSwgcGFyc2VGbG9hdChwb2ludFswXSkpO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBKU09OVG9EYXRhYmFzZShqc29uKSB7XG4gICAgbGV0IGNvb3JkcyA9IGpzb24uY29vcmRpbmF0ZXM7XG4gICAgLy8gQWRkIGZpcnN0IHBvaW50IHRvIHRoZSBlbmQgdG8gY2xvc2UgcG9seWdvblxuICAgIGlmIChcbiAgICAgIGNvb3Jkc1swXVswXSAhPT0gY29vcmRzW2Nvb3Jkcy5sZW5ndGggLSAxXVswXSB8fFxuICAgICAgY29vcmRzWzBdWzFdICE9PSBjb29yZHNbY29vcmRzLmxlbmd0aCAtIDFdWzFdXG4gICAgKSB7XG4gICAgICBjb29yZHMucHVzaChjb29yZHNbMF0pO1xuICAgIH1cbiAgICBjb25zdCB1bmlxdWUgPSBjb29yZHMuZmlsdGVyKChpdGVtLCBpbmRleCwgYXIpID0+IHtcbiAgICAgIGxldCBmb3VuZEluZGV4ID0gLTE7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFyLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGNvbnN0IHB0ID0gYXJbaV07XG4gICAgICAgIGlmIChwdFswXSA9PT0gaXRlbVswXSAmJiBwdFsxXSA9PT0gaXRlbVsxXSkge1xuICAgICAgICAgIGZvdW5kSW5kZXggPSBpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gZm91bmRJbmRleCA9PT0gaW5kZXg7XG4gICAgfSk7XG4gICAgaWYgKHVuaXF1ZS5sZW5ndGggPCAzKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUixcbiAgICAgICAgJ0dlb0pTT046IExvb3AgbXVzdCBoYXZlIGF0IGxlYXN0IDMgZGlmZmVyZW50IHZlcnRpY2VzJ1xuICAgICAgKTtcbiAgICB9XG4gICAgLy8gQ29udmVydCBsYXQvbG9uZyAtPiBsb25nL2xhdFxuICAgIGNvb3JkcyA9IGNvb3Jkcy5tYXAoY29vcmQgPT4ge1xuICAgICAgcmV0dXJuIFtjb29yZFsxXSwgY29vcmRbMF1dO1xuICAgIH0pO1xuICAgIHJldHVybiB7IHR5cGU6ICdQb2x5Z29uJywgY29vcmRpbmF0ZXM6IFtjb29yZHNdIH07XG4gIH0sXG5cbiAgaXNWYWxpZEpTT04odmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZS5fX3R5cGUgPT09ICdQb2x5Z29uJztcbiAgfSxcbn07XG5cbnZhciBGaWxlQ29kZXIgPSB7XG4gIGRhdGFiYXNlVG9KU09OKG9iamVjdCkge1xuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdGaWxlJyxcbiAgICAgIG5hbWU6IG9iamVjdCxcbiAgICB9O1xuICB9LFxuXG4gIGlzVmFsaWREYXRhYmFzZU9iamVjdChvYmplY3QpIHtcbiAgICByZXR1cm4gdHlwZW9mIG9iamVjdCA9PT0gJ3N0cmluZyc7XG4gIH0sXG5cbiAgSlNPTlRvRGF0YWJhc2UoanNvbikge1xuICAgIHJldHVybiBqc29uLm5hbWU7XG4gIH0sXG5cbiAgaXNWYWxpZEpTT04odmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZS5fX3R5cGUgPT09ICdGaWxlJztcbiAgfSxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICB0cmFuc2Zvcm1LZXksXG4gIHBhcnNlT2JqZWN0VG9Nb25nb09iamVjdEZvckNyZWF0ZSxcbiAgdHJhbnNmb3JtVXBkYXRlLFxuICB0cmFuc2Zvcm1XaGVyZSxcbiAgbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0LFxuICB0cmFuc2Zvcm1Db25zdHJhaW50LFxuICB0cmFuc2Zvcm1Qb2ludGVyU3RyaW5nLFxufTtcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQSxJQUFBQSxPQUFBLEdBQUFDLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxPQUFBLEdBQUFGLHNCQUFBLENBQUFDLE9BQUE7QUFBdUIsU0FBQUQsdUJBQUFHLENBQUEsV0FBQUEsQ0FBQSxJQUFBQSxDQUFBLENBQUFDLFVBQUEsR0FBQUQsQ0FBQSxLQUFBRSxPQUFBLEVBQUFGLENBQUE7QUFDdkIsSUFBSUcsT0FBTyxHQUFHTCxPQUFPLENBQUMsU0FBUyxDQUFDO0FBQ2hDLElBQUlNLEtBQUssR0FBR04sT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDTSxLQUFLO0FBQ3ZDLE1BQU1DLEtBQUssR0FBR1AsT0FBTyxDQUFDLGdCQUFnQixDQUFDO0FBRXZDLE1BQU1RLFlBQVksR0FBR0EsQ0FBQ0MsU0FBUyxFQUFFQyxTQUFTLEVBQUVDLE1BQU0sS0FBSztFQUNyRDtFQUNBLFFBQVFELFNBQVM7SUFDZixLQUFLLFVBQVU7TUFDYixPQUFPLEtBQUs7SUFDZCxLQUFL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