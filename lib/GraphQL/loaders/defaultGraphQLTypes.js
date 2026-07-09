"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GLOBAL_OR_OBJECT_ID_ATT = exports.GEO_WITHIN_INPUT = exports.GEO_POINT_WHERE_INPUT = exports.GEO_POINT_INPUT = exports.GEO_POINT_FIELDS = exports.GEO_POINT = exports.GEO_INTERSECTS_INPUT = exports.FILE_WHERE_INPUT = exports.FILE_INPUT = exports.FILE_INFO = exports.FILE = exports.ELEMENT = exports.DATE_WHERE_INPUT = exports.DATE = exports.CREATE_RESULT_FIELDS = exports.CREATED_AT_ATT = exports.COUNT_ATT = exports.CLASS_NAME_ATT = exports.CENTER_SPHERE_INPUT = exports.BYTES_WHERE_INPUT = exports.BYTES = exports.BOX_INPUT = exports.BOOLEAN_WHERE_INPUT = exports.ARRAY_WHERE_INPUT = exports.ARRAY_RESULT = exports.ANY = exports.ACL_INPUT = exports.ACL = void 0;
Object.defineProperty(exports, "GraphQLUpload", {
  enumerable: true,
  get: function () {
    return _GraphQLUpload.default;
  }
});
exports.serializeDateIso = exports.parseValue = exports.parseStringValue = exports.parseObjectFields = exports.parseListValues = exports.parseIntValue = exports.parseFloatValue = exports.parseFileValue = exports.parseDateIsoValue = exports.parseBooleanValue = exports.options = exports.notInQueryKey = exports.notIn = exports.notEqualTo = exports.matchesRegex = exports.loadArrayResult = exports.load = exports.lessThanOrEqualTo = exports.lessThan = exports.inQueryKey = exports.inOp = exports.greaterThanOrEqualTo = exports.greaterThan = exports.exists = exports.equalTo = exports.WITHIN_INPUT = exports.WHERE_ATT = exports.USER_ACL_INPUT = exports.USER_ACL = exports.UPDATE_RESULT_FIELDS = exports.UPDATED_AT_ATT = exports.TypeValidationError = exports.TEXT_INPUT = exports.SUBQUERY_READ_PREFERENCE_ATT = exports.SUBQUERY_INPUT = exports.STRING_WHERE_INPUT = exports.SKIP_ATT = exports.SESSION_TOKEN_ATT = exports.SELECT_INPUT = exports.SEARCH_INPUT = exports.ROLE_ACL_INPUT = exports.ROLE_ACL = exports.READ_PREFERENCE_ATT = exports.READ_PREFERENCE = exports.READ_OPTIONS_INPUT = exports.READ_OPTIONS_ATT = exports.PUBLIC_ACL_INPUT = exports.PUBLIC_ACL = exports.POLYGON_WHERE_INPUT = exports.POLYGON_INPUT = exports.POLYGON = exports.PARSE_OBJECT_FIELDS = exports.PARSE_OBJECT = exports.OBJECT_WHERE_INPUT = exports.OBJECT_ID_ATT = exports.OBJECT_ID = exports.OBJECT = exports.NUMBER_WHERE_INPUT = exports.LIMIT_ATT = exports.KEY_VALUE_INPUT = exports.INPUT_FIELDS = exports.INCLUDE_READ_PREFERENCE_ATT = exports.ID_WHERE_INPUT = void 0;
var _graphql = require("graphql");
var _graphqlRelay = require("graphql-relay");
var _GraphQLUpload = _interopRequireDefault(require("graphql-upload/GraphQLUpload.js"));
var _Utils = _interopRequireDefault(require("../../Utils"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
class TypeValidationError extends Error {
  constructor(value, type) {
    super(`${value} is not a valid ${type}`);
  }
}
exports.TypeValidationError = TypeValidationError;
const parseStringValue = value => {
  if (typeof value === 'string') {
    return value;
  }
  throw new TypeValidationError(value, 'String');
};
exports.parseStringValue = parseStringValue;
const parseIntValue = value => {
  if (typeof value === 'string') {
    const int = Number(value);
    if (Number.isInteger(int)) {
      return int;
    }
  }
  throw new TypeValidationError(value, 'Int');
};
exports.parseIntValue = parseIntValue;
const parseFloatValue = value => {
  if (typeof value === 'string') {
    const float = Number(value);
    if (!isNaN(float)) {
      return float;
    }
  }
  throw new TypeValidationError(value, 'Float');
};
exports.parseFloatValue = parseFloatValue;
const parseBooleanValue = value => {
  if (typeof value === 'boolean') {
    return value;
  }
  throw new TypeValidationError(value, 'Boolean');
};
exports.parseBooleanValue = parseBooleanValue;
const parseValue = value => {
  switch (value.kind) {
    case _graphql.Kind.STRING:
      return parseStringValue(value.value);
    case _graphql.Kind.INT:
      return parseIntValue(value.value);
    case _graphql.Kind.FLOAT:
      return parseFloatValue(value.value);
    case _graphql.Kind.BOOLEAN:
      return parseBooleanValue(value.value);
    case _graphql.Kind.LIST:
      return parseListValues(value.values);
    case _graphql.Kind.OBJECT:
      return parseObjectFields(value.fields);
    default:
      return value.value;
  }
};
exports.parseValue = parseValue;
const parseListValues = values => {
  if (Array.isArray(values)) {
    return values.map(value => parseValue(value));
  }
  throw new TypeValidationError(values, 'List');
};
exports.parseListValues = parseListValues;
const parseObjectFields = fields => {
  if (Array.isArray(fields)) {
    return fields.reduce((object, field) => ({
      ...object,
      [field.name.value]: parseValue(field.value)
    }), {});
  }
  throw new TypeValidationError(fields, 'Object');
};
exports.parseObjectFields = parseObjectFields;
const ANY = exports.ANY = new _graphql.GraphQLScalarType({
  name: 'Any',
  description: 'The Any scalar type is used in operations and types that involve any type of value.',
  parseValue: value => value,
  serialize: value => value,
  parseLiteral: ast => parseValue(ast)
});
const OBJECT = exports.OBJECT = new _graphql.GraphQLScalarType({
  name: 'Object',
  description: 'The Object scalar type is used in operations and types that involve objects.',
  parseValue(value) {
    if (typeof value === 'object') {
      return value;
    }
    throw new TypeValidationError(value, 'Object');
  },
  serialize(value) {
    if (typeof value === 'object') {
      return value;
    }
    throw new TypeValidationError(value, 'Object');
  },
  parseLiteral(ast) {
    if (ast.kind === _graphql.Kind.OBJECT) {
      return parseObjectFields(ast.fields);
    }
    throw new TypeValidationError(ast.kind, 'Object');
  }
});
const parseDateIsoValue = value => {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date)) {
      return date;
    }
  } else if (_Utils.default.isDate(value)) {
    return value;
  }
  throw new TypeValidationError(value, 'Date');
};
exports.parseDateIsoValue = parseDateIsoValue;
const serializeDateIso = value => {
  if (typeof value === 'string') {
    return value;
  }
  if (_Utils.default.isDate(value)) {
    return value.toISOString();
  }
  throw new TypeValidationError(value, 'Date');
};
exports.serializeDateIso = serializeDateIso;
const parseDateIsoLiteral = ast => {
  if (ast.kind === _graphql.Kind.STRING) {
    return parseDateIsoValue(ast.value);
  }
  throw new TypeValidationError(ast.kind, 'Date');
};
const DATE = exports.DATE = new _graphql.GraphQLScalarType({
  name: 'Date',
  description: 'The Date scalar type is used in operations and types that involve dates.',
  parseValue(value) {
    if (typeof value === 'string' || _Utils.default.isDate(value)) {
      return {
        __type: 'Date',
        iso: parseDateIsoValue(value)
      };
    } else if (typeof value === 'object' && value.__type === 'Date' && value.iso) {
      return {
        __type: value.__type,
        iso: parseDateIsoValue(value.iso)
      };
    }
    throw new TypeValidationError(value, 'Date');
  },
  serialize(value) {
    if (typeof value === 'string' || _Utils.default.isDate(value)) {
      return serializeDateIso(value);
    } else if (typeof value === 'object' && value.__type === 'Date' && value.iso) {
      return serializeDateIso(value.iso);
    }
    throw new TypeValidationError(value, 'Date');
  },
  parseLiteral(ast) {
    if (ast.kind === _graphql.Kind.STRING) {
      return {
        __type: 'Date',
        iso: parseDateIsoLiteral(ast)
      };
    } else if (ast.kind === _graphql.Kind.OBJECT) {
      const __type = ast.fields.find(field => field.name.value === '__type');
      const iso = ast.fields.find(field => field.name.value === 'iso');
      if (__type && __type.value && __type.value.value === 'Date' && iso) {
        return {
          __type: __type.value.value,
          iso: parseDateIsoLiteral(iso.value)
        };
      }
    }
    throw new TypeValidationError(ast.kind, 'Date');
  }
});
const BYTES = exports.BYTES = new _graphql.GraphQLScalarType({
  name: 'Bytes',
  description: 'The Bytes scalar type is used in operations and types that involve base 64 binary data.',
  parseValue(value) {
    if (typeof value === 'string') {
      return {
        __type: 'Bytes',
        base64: value
      };
    } else if (typeof value === 'object' && value.__type === 'Bytes' && typeof value.base64 === 'string') {
      return value;
    }
    throw new TypeValidationError(value, 'Bytes');
  },
  serialize(value) {
    if (typeof value === 'string') {
      return value;
    } else if (typeof value === 'object' && value.__type === 'Bytes' && typeof value.base64 === 'string') {
      return value.base64;
    }
    throw new TypeValidationError(value, 'Bytes');
  },
  parseLiteral(ast) {
    if (ast.kind === _graphql.Kind.STRING) {
      return {
        __type: 'Bytes',
        base64: ast.value
      };
    } else if (ast.kind === _graphql.Kind.OBJECT) {
      const __type = ast.fields.find(field => field.name.value === '__type');
      const base64 = ast.fields.find(field => field.name.value === 'base64');
      if (__type && __type.value && __type.value.value === 'Bytes' && base64 && base64.value && typeof base64.value.value === 'string') {
        return {
          __type: __type.value.value,
          base64: base64.value.value
        };
      }
    }
    throw new TypeValidationError(ast.kind, 'Bytes');
  }
});
const parseFileValue = value => {
  if (typeof value === 'string') {
    return {
      __type: 'File',
      name: value
    };
  } else if (typeof value === 'object' && value.__type === 'File' && typeof value.name === 'string' && (value.url === undefined || typeof value.url === 'string')) {
    return value;
  }
  throw new TypeValidationError(value, 'File');
};
exports.parseFileValue = parseFileValue;
const FILE = exports.FILE = new _graphql.GraphQLScalarType({
  name: 'File',
  description: 'The File scalar type is used in operations and types that involve files.',
  parseValue: parseFileValue,
  serialize: value => {
    if (typeof value === 'string') {
      return value;
    } else if (typeof value === 'object' && value.__type === 'File' && typeof value.name === 'string' && (value.url === undefined || typeof value.url === 'string')) {
      return value.name;
    }
    throw new TypeValidationError(value, 'File');
  },
  parseLiteral(ast) {
    if (ast.kind === _graphql.Kind.STRING) {
      return parseFileValue(ast.value);
    } else if (ast.kind === _graphql.Kind.OBJECT) {
      const __type = ast.fields.find(field => field.name.value === '__type');
      const name = ast.fields.find(field => field.name.value === 'name');
      const url = ast.fields.find(field => field.name.value === 'url');
      if (__type && __type.value && name && name.value) {
        return parseFileValue({
          __type: __type.value.value,
          name: name.value.value,
          url: url && url.value ? url.value.value : undefined
        });
      }
    }
    throw new TypeValidationError(ast.kind, 'File');
  }
});
const FILE_INFO = exports.FILE_INFO = new _graphql.GraphQLObjectType({
  name: 'FileInfo',
  description: 'The FileInfo object type is used to return the information about files.',
  fields: {
    name: {
      description: 'This is the file name.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLString)
    },
    url: {
      description: 'This is the url in which the file can be downloaded.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLString)
    }
  }
});
const FILE_INPUT = exports.FILE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'FileInput',
  description: 'If this field is set to null the file will be unlinked (the file will not be deleted on cloud storage).',
  fields: {
    file: {
      description: 'A File Scalar can be an url or a FileInfo object.',
      type: FILE
    },
    upload: {
      description: 'Use this field if you want to create a new file.',
      type: _GraphQLUpload.default
    }
  }
});
const GEO_POINT_FIELDS = exports.GEO_POINT_FIELDS = {
  latitude: {
    description: 'This is the latitude.',
    type: new _graphql.GraphQLNonNull(_graphql.GraphQLFloat)
  },
  longitude: {
    description: 'This is the longitude.',
    type: new _graphql.GraphQLNonNull(_graphql.GraphQLFloat)
  }
};
const GEO_POINT_INPUT = exports.GEO_POINT_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'GeoPointInput',
  description: 'The GeoPointInput type is used in operations that involve inputting fields of type geo point.',
  fields: GEO_POINT_FIELDS
});
const GEO_POINT = exports.GEO_POINT = new _graphql.GraphQLObjectType({
  name: 'GeoPoint',
  description: 'The GeoPoint object type is used to return the information about geo point fields.',
  fields: GEO_POINT_FIELDS
});
const POLYGON_INPUT = exports.POLYGON_INPUT = new _graphql.GraphQLList(new _graphql.GraphQLNonNull(GEO_POINT_INPUT));
const POLYGON = exports.POLYGON = new _graphql.GraphQLList(new _graphql.GraphQLNonNull(GEO_POINT));
const USER_ACL_INPUT = exports.USER_ACL_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'UserACLInput',
  description: 'Allow to manage users in ACL.',
  fields: {
    userId: {
      description: 'ID of the targetted User.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLID)
    },
    read: {
      description: 'Allow the user to read the current object.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLBoolean)
    },
    write: {
      description: 'Allow the user to write on the current object.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLBoolean)
    }
  }
});
const ROLE_ACL_INPUT = exports.ROLE_ACL_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'RoleACLInput',
  description: 'Allow to manage roles in ACL.',
  fields: {
    roleName: {
      description: 'Name of the targetted Role.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLString)
    },
    read: {
      description: 'Allow users who are members of the role to read the current object.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLBoolean)
    },
    write: {
      description: 'Allow users who are members of the role to write on the current object.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLBoolean)
    }
  }
});
const PUBLIC_ACL_INPUT = exports.PUBLIC_ACL_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'PublicACLInput',
  description: 'Allow to manage public rights.',
  fields: {
    read: {
      description: 'Allow anyone to read the current object.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLBoolean)
    },
    write: {
      description: 'Allow anyone to write on the current object.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLBoolean)
    }
  }
});
const ACL_INPUT = exports.ACL_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'ACLInput',
  description: 'Allow to manage access rights. If not provided object will be publicly readable and writable',
  fields: {
    users: {
      description: 'Access control list for users.',
      type: new _graphql.GraphQLList(new _graphql.GraphQLNonNull(USER_ACL_INPUT))
    },
    roles: {
      description: 'Access control list for roles.',
      type: new _graphql.GraphQLList(new _graphql.GraphQLNonNull(ROLE_ACL_INPUT))
    },
    public: {
      description: 'Public access control list.',
      type: PUBLIC_ACL_INPUT
    }
  }
});
const USER_ACL = exports.USER_ACL = new _graphql.GraphQLObjectType({
  name: 'UserACL',
  description: 'Allow to manage users in ACL. If read and write are null the users have read and write rights.',
  fields: {
    userId: {
      description: 'ID of the targetted User.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLID)
    },
    read: {
      description: 'Allow the user to read the current object.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLBoolean)
    },
    write: {
      description: 'Allow the user to write on the current object.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLBoolean)
    }
  }
});
const ROLE_ACL = exports.ROLE_ACL = new _graphql.GraphQLObjectType({
  name: 'RoleACL',
  description: 'Allow to manage roles in ACL. If read and write are null the role have read and write rights.',
  fields: {
    roleName: {
      description: 'Name of the targetted Role.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLID)
    },
    read: {
      description: 'Allow users who are members of the role to read the current object.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLBoolean)
    },
    write: {
      description: 'Allow users who are members of the role to write on the current object.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLBoolean)
    }
  }
});
const PUBLIC_ACL = exports.PUBLIC_ACL = new _graphql.GraphQLObjectType({
  name: 'PublicACL',
  description: 'Allow to manage public rights.',
  fields: {
    read: {
      description: 'Allow anyone to read the current object.',
      type: _graphql.GraphQLBoolean
    },
    write: {
      description: 'Allow anyone to write on the current object.',
      type: _graphql.GraphQLBoolean
    }
  }
});
const ACL = exports.ACL = new _graphql.GraphQLObjectType({
  name: 'ACL',
  description: 'Current access control list of the current object.',
  fields: {
    users: {
      description: 'Access control list for users.',
      type: new _graphql.GraphQLList(new _graphql.GraphQLNonNull(USER_ACL)),
      resolve(p) {
        const users = [];
        Object.keys(p).forEach(rule => {
          if (rule !== '*' && rule.indexOf('role:') !== 0) {
            users.push({
              userId: (0, _graphqlRelay.toGlobalId)('_User', rule),
              read: p[rule].read ? true : false,
              write: p[rule].write ? true : false
            });
          }
        });
        return users.length ? users : null;
      }
    },
    roles: {
      description: 'Access control list for roles.',
      type: new _graphql.GraphQLList(new _graphql.GraphQLNonNull(ROLE_ACL)),
      resolve(p) {
        const roles = [];
        Object.keys(p).forEach(rule => {
          if (rule.indexOf('role:') === 0) {
            roles.push({
              roleName: rule.replace('role:', ''),
              read: p[rule].read ? true : false,
              write: p[rule].write ? true : false
            });
          }
        });
        return roles.length ? roles : null;
      }
    },
    public: {
      description: 'Public access control list.',
      type: PUBLIC_ACL,
      resolve(p) {
        /* eslint-disable */
        return p['*'] ? {
          read: p['*'].read ? true : false,
          write: p['*'].write ? true : false
        } : null;
      }
    }
  }
});
const OBJECT_ID = exports.OBJECT_ID = new _graphql.GraphQLNonNull(_graphql.GraphQLID);
const CLASS_NAME_ATT = exports.CLASS_NAME_ATT = {
  description: 'This is the class name of the object.',
  type: new _graphql.GraphQLNonNull(_graphql.GraphQLString)
};
const GLOBAL_OR_OBJECT_ID_ATT = exports.GLOBAL_OR_OBJECT_ID_ATT = {
  description: 'This is the object id. You can use either the global or the object id.',
  type: OBJECT_ID
};
const OBJECT_ID_ATT = exports.OBJECT_ID_ATT = {
  description: 'This is the object id.',
  type: OBJECT_ID
};
const CREATED_AT_ATT = exports.CREATED_AT_ATT = {
  description: 'This is the date in which the object was created.',
  type: new _graphql.GraphQLNonNull(DATE)
};
const UPDATED_AT_ATT = exports.UPDATED_AT_ATT = {
  description: 'This is the date in which the object was las updated.',
  type: new _graphql.GraphQLNonNull(DATE)
};
const INPUT_FIELDS = exports.INPUT_FIELDS = {
  ACL: {
    type: ACL
  }
};
const CREATE_RESULT_FIELDS = exports.CREATE_RESULT_FIELDS = {
  objectId: OBJECT_ID_ATT,
  createdAt: CREATED_AT_ATT
};
const UPDATE_RESULT_FIELDS = exports.UPDATE_RESULT_FIELDS = {
  updatedAt: UPDATED_AT_ATT
};
const PARSE_OBJECT_FIELDS = exports.PARSE_OBJECT_FIELDS = {
  ...CREATE_RESULT_FIELDS,
  ...UPDATE_RESULT_FIELDS,
  ...INPUT_FIELDS,
  ACL: {
    type: new _graphql.GraphQLNonNull(ACL),
    resolve: ({
      ACL
    }) => ACL ? ACL : {
      '*': {
        read: true,
        write: true
      }
    }
  }
};
const PARSE_OBJECT = exports.PARSE_OBJECT = new _graphql.GraphQLInterfaceType({
  name: 'ParseObject',
  description: 'The ParseObject interface type is used as a base type for the auto generated object types.',
  fields: PARSE_OBJECT_FIELDS
});
const SESSION_TOKEN_ATT = exports.SESSION_TOKEN_ATT = {
  description: 'The current user session token.',
  type: new _graphql.GraphQLNonNull(_graphql.GraphQLString)
};
const READ_PREFERENCE = exports.READ_PREFERENCE = new _graphql.GraphQLEnumType({
  name: 'ReadPreference',
  description: 'The ReadPreference enum type is used in queries in order to select in which database replica the operation must run.',
  values: {
    PRIMARY: {
      value: 'PRIMARY'
    },
    PRIMARY_PREFERRED: {
      value: 'PRIMARY_PREFERRED'
    },
    SECONDARY: {
      value: 'SECONDARY'
    },
    SECONDARY_PREFERRED: {
      value: 'SECONDARY_PREFERRED'
    },
    NEAREST: {
      value: 'NEAREST'
    }
  }
});
const READ_PREFERENCE_ATT = exports.READ_PREFERENCE_ATT = {
  description: 'The read preference for the main query to be executed.',
  type: READ_PREFERENCE
};
const INCLUDE_READ_PREFERENCE_ATT = exports.INCLUDE_READ_PREFERENCE_ATT = {
  description: 'The read preference for the queries to be executed to include fields.',
  type: READ_PREFERENCE
};
const SUBQUERY_READ_PREFERENCE_ATT = exports.SUBQUERY_READ_PREFERENCE_ATT = {
  description: 'The read preference for the subqueries that may be required.',
  type: READ_PREFERENCE
};
const READ_OPTIONS_INPUT = exports.READ_OPTIONS_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'ReadOptionsInput',
  description: 'The ReadOptionsInputt type is used in queries in order to set the read preferences.',
  fields: {
    readPreference: READ_PREFERENCE_ATT,
    includeReadPreference: INCLUDE_READ_PREFERENCE_ATT,
    subqueryReadPreference: SUBQUERY_READ_PREFERENCE_ATT
  }
});
const READ_OPTIONS_ATT = exports.READ_OPTIONS_ATT = {
  description: 'The read options for the query to be executed.',
  type: READ_OPTIONS_INPUT
};
const WHERE_ATT = exports.WHERE_ATT = {
  description: 'These are the conditions that the objects need to match in order to be found',
  type: OBJECT
};
const SKIP_ATT = exports.SKIP_ATT = {
  description: 'This is the number of objects that must be skipped to return.',
  type: _graphql.GraphQLInt
};
const LIMIT_ATT = exports.LIMIT_ATT = {
  description: 'This is the limit number of objects that must be returned.',
  type: _graphql.GraphQLInt
};
const COUNT_ATT = exports.COUNT_ATT = {
  description: 'This is the total matched objecs count that is returned when the count flag is set.',
  type: new _graphql.GraphQLNonNull(_graphql.GraphQLInt)
};
const SEARCH_INPUT = exports.SEARCH_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'SearchInput',
  description: 'The SearchInput type is used to specifiy a search operation on a full text search.',
  fields: {
    term: {
      description: 'This is the term to be searched.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLString)
    },
    language: {
      description: 'This is the language to tetermine the list of stop words and the rules for tokenizer.',
      type: _graphql.GraphQLString
    },
    caseSensitive: {
      description: 'This is the flag to enable or disable case sensitive search.',
      type: _graphql.GraphQLBoolean
    },
    diacriticSensitive: {
      description: 'This is the flag to enable or disable diacritic sensitive search.',
      type: _graphql.GraphQLBoolean
    }
  }
});
const TEXT_INPUT = exports.TEXT_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'TextInput',
  description: 'The TextInput type is used to specify a text operation on a constraint.',
  fields: {
    search: {
      description: 'This is the search to be executed.',
      type: new _graphql.GraphQLNonNull(SEARCH_INPUT)
    }
  }
});
const BOX_INPUT = exports.BOX_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'BoxInput',
  description: 'The BoxInput type is used to specifiy a box operation on a within geo query.',
  fields: {
    bottomLeft: {
      description: 'This is the bottom left coordinates of the box.',
      type: new _graphql.GraphQLNonNull(GEO_POINT_INPUT)
    },
    upperRight: {
      description: 'This is the upper right coordinates of the box.',
      type: new _graphql.GraphQLNonNull(GEO_POINT_INPUT)
    }
  }
});
const WITHIN_INPUT = exports.WITHIN_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'WithinInput',
  description: 'The WithinInput type is used to specify a within operation on a constraint.',
  fields: {
    box: {
      description: 'This is the box to be specified.',
      type: new _graphql.GraphQLNonNull(BOX_INPUT)
    }
  }
});
const CENTER_SPHERE_INPUT = exports.CENTER_SPHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'CenterSphereInput',
  description: 'The CenterSphereInput type is used to specifiy a centerSphere operation on a geoWithin query.',
  fields: {
    center: {
      description: 'This is the center of the sphere.',
      type: new _graphql.GraphQLNonNull(GEO_POINT_INPUT)
    },
    distance: {
      description: 'This is the radius of the sphere.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLFloat)
    }
  }
});
const GEO_WITHIN_INPUT = exports.GEO_WITHIN_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'GeoWithinInput',
  description: 'The GeoWithinInput type is used to specify a geoWithin operation on a constraint.',
  fields: {
    polygon: {
      description: 'This is the polygon to be specified.',
      type: POLYGON_INPUT
    },
    centerSphere: {
      description: 'This is the sphere to be specified.',
      type: CENTER_SPHERE_INPUT
    }
  }
});
const GEO_INTERSECTS_INPUT = exports.GEO_INTERSECTS_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'GeoIntersectsInput',
  description: 'The GeoIntersectsInput type is used to specify a geoIntersects operation on a constraint.',
  fields: {
    point: {
      description: 'This is the point to be specified.',
      type: GEO_POINT_INPUT
    }
  }
});
const equalTo = type => ({
  description: 'This is the equalTo operator to specify a constraint to select the objects where the value of a field equals to a specified value.',
  type
});
exports.equalTo = equalTo;
const notEqualTo = type => ({
  description: 'This is the notEqualTo operator to specify a constraint to select the objects where the value of a field do not equal to a specified value.',
  type
});
exports.notEqualTo = notEqualTo;
const lessThan = type => ({
  description: 'This is the lessThan operator to specify a constraint to select the objects where the value of a field is less than a specified value.',
  type
});
exports.lessThan = lessThan;
const lessThanOrEqualTo = type => ({
  description: 'This is the lessThanOrEqualTo operator to specify a constraint to select the objects where the value of a field is less than or equal to a specified value.',
  type
});
exports.lessThanOrEqualTo = lessThanOrEqualTo;
const greaterThan = type => ({
  description: 'This is the greaterThan operator to specify a constraint to select the objects where the value of a field is greater than a specified value.',
  type
});
exports.greaterThan = greaterThan;
const greaterThanOrEqualTo = type => ({
  description: 'This is the greaterThanOrEqualTo operator to specify a constraint to select the objects where the value of a field is greater than or equal to a specified value.',
  type
});
exports.greaterThanOrEqualTo = greaterThanOrEqualTo;
const inOp = type => ({
  description: 'This is the in operator to specify a constraint to select the objects where the value of a field equals any value in the specified array.',
  type: new _graphql.GraphQLList(type)
});
exports.inOp = inOp;
const notIn = type => ({
  description: 'This is the notIn operator to specify a constraint to select the objects where the value of a field do not equal any value in the specified array.',
  type: new _graphql.GraphQLList(type)
});
exports.notIn = notIn;
const exists = exports.exists = {
  description: 'This is the exists operator to specify a constraint to select the objects where a field exists (or do not exist).',
  type: _graphql.GraphQLBoolean
};
const matchesRegex = exports.matchesRegex = {
  description: 'This is the matchesRegex operator to specify a constraint to select the objects where the value of a field matches a specified regular expression.',
  type: _graphql.GraphQLString
};
const options = exports.options = {
  description: 'This is the options operator to specify optional flags (such as "i" and "m") to be added to a matchesRegex operation in the same set of constraints.',
  type: _graphql.GraphQLString
};
const SUBQUERY_INPUT = exports.SUBQUERY_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'SubqueryInput',
  description: 'The SubqueryInput type is used to specify a sub query to another class.',
  fields: {
    className: CLASS_NAME_ATT,
    where: Object.assign({}, WHERE_ATT, {
      type: new _graphql.GraphQLNonNull(WHERE_ATT.type)
    })
  }
});
const SELECT_INPUT = exports.SELECT_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'SelectInput',
  description: 'The SelectInput type is used to specify an inQueryKey or a notInQueryKey operation on a constraint.',
  fields: {
    query: {
      description: 'This is the subquery to be executed.',
      type: new _graphql.GraphQLNonNull(SUBQUERY_INPUT)
    },
    key: {
      description: 'This is the key in the result of the subquery that must match (not match) the field.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLString)
    }
  }
});
const inQueryKey = exports.inQueryKey = {
  description: 'This is the inQueryKey operator to specify a constraint to select the objects where a field equals to a key in the result of a different query.',
  type: SELECT_INPUT
};
const notInQueryKey = exports.notInQueryKey = {
  description: 'This is the notInQueryKey operator to specify a constraint to select the objects where a field do not equal to a key in the result of a different query.',
  type: SELECT_INPUT
};
const ID_WHERE_INPUT = exports.ID_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'IdWhereInput',
  description: 'The IdWhereInput input type is used in operations that involve filtering objects by an id.',
  fields: {
    equalTo: equalTo(_graphql.GraphQLID),
    notEqualTo: notEqualTo(_graphql.GraphQLID),
    lessThan: lessThan(_graphql.GraphQLID),
    lessThanOrEqualTo: lessThanOrEqualTo(_graphql.GraphQLID),
    greaterThan: greaterThan(_graphql.GraphQLID),
    greaterThanOrEqualTo: greaterThanOrEqualTo(_graphql.GraphQLID),
    in: inOp(_graphql.GraphQLID),
    notIn: notIn(_graphql.GraphQLID),
    exists,
    inQueryKey,
    notInQueryKey
  }
});
const STRING_WHERE_INPUT = exports.STRING_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'StringWhereInput',
  description: 'The StringWhereInput input type is used in operations that involve filtering objects by a field of type String.',
  fields: {
    equalTo: equalTo(_graphql.GraphQLString),
    notEqualTo: notEqualTo(_graphql.GraphQLString),
    lessThan: lessThan(_graphql.GraphQLString),
    lessThanOrEqualTo: lessThanOrEqualTo(_graphql.GraphQLString),
    greaterThan: greaterThan(_graphql.GraphQLString),
    greaterThanOrEqualTo: greaterThanOrEqualTo(_graphql.GraphQLString),
    in: inOp(_graphql.GraphQLString),
    notIn: notIn(_graphql.GraphQLString),
    exists,
    matchesRegex,
    options,
    text: {
      description: 'This is the $text operator to specify a full text search constraint.',
      type: TEXT_INPUT
    },
    inQueryKey,
    notInQueryKey
  }
});
const NUMBER_WHERE_INPUT = exports.NUMBER_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'NumberWhereInput',
  description: 'The NumberWhereInput input type is used in operations that involve filtering objects by a field of type Number.',
  fields: {
    equalTo: equalTo(_graphql.GraphQLFloat),
    notEqualTo: notEqualTo(_graphql.GraphQLFloat),
    lessThan: lessThan(_graphql.GraphQLFloat),
    lessThanOrEqualTo: lessThanOrEqualTo(_graphql.GraphQLFloat),
    greaterThan: greaterThan(_graphql.GraphQLFloat),
    greaterThanOrEqualTo: greaterThanOrEqualTo(_graphql.GraphQLFloat),
    in: inOp(_graphql.GraphQLFloat),
    notIn: notIn(_graphql.GraphQLFloat),
    exists,
    inQueryKey,
    notInQueryKey
  }
});
const BOOLEAN_WHERE_INPUT = exports.BOOLEAN_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'BooleanWhereInput',
  description: 'The BooleanWhereInput input type is used in operations that involve filtering objects by a field of type Boolean.',
  fields: {
    equalTo: equalTo(_graphql.GraphQLBoolean),
    notEqualTo: notEqualTo(_graphql.GraphQLBoolean),
    exists,
    inQueryKey,
    notInQueryKey
  }
});
const ARRAY_WHERE_INPUT = exports.ARRAY_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'ArrayWhereInput',
  description: 'The ArrayWhereInput input type is used in operations that involve filtering objects by a field of type Array.',
  fields: {
    equalTo: equalTo(ANY),
    notEqualTo: notEqualTo(ANY),
    lessThan: lessThan(ANY),
    lessThanOrEqualTo: lessThanOrEqualTo(ANY),
    greaterThan: greaterThan(ANY),
    greaterThanOrEqualTo: greaterThanOrEqualTo(ANY),
    in: inOp(ANY),
    notIn: notIn(ANY),
    exists,
    containedBy: {
      description: 'This is the containedBy operator to specify a constraint to select the objects where the values of an array field is contained by another specified array.',
      type: new _graphql.GraphQLList(ANY)
    },
    contains: {
      description: 'This is the contains operator to specify a constraint to select the objects where the values of an array field contain all elements of another specified array.',
      type: new _graphql.GraphQLList(ANY)
    },
    inQueryKey,
    notInQueryKey
  }
});
const KEY_VALUE_INPUT = exports.KEY_VALUE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'KeyValueInput',
  description: 'An entry from an object, i.e., a pair of key and value.',
  fields: {
    key: {
      description: 'The key used to retrieve the value of this entry.',
      type: new _graphql.GraphQLNonNull(_graphql.GraphQLString)
    },
    value: {
      description: 'The value of the entry. Could be any type of scalar data.',
      type: new _graphql.GraphQLNonNull(ANY)
    }
  }
});
const OBJECT_WHERE_INPUT = exports.OBJECT_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'ObjectWhereInput',
  description: 'The ObjectWhereInput input type is used in operations that involve filtering result by a field of type Object.',
  fields: {
    equalTo: equalTo(KEY_VALUE_INPUT),
    notEqualTo: notEqualTo(KEY_VALUE_INPUT),
    in: inOp(KEY_VALUE_INPUT),
    notIn: notIn(KEY_VALUE_INPUT),
    lessThan: lessThan(KEY_VALUE_INPUT),
    lessThanOrEqualTo: lessThanOrEqualTo(KEY_VALUE_INPUT),
    greaterThan: greaterThan(KEY_VALUE_INPUT),
    greaterThanOrEqualTo: greaterThanOrEqualTo(KEY_VALUE_INPUT),
    exists,
    inQueryKey,
    notInQueryKey
  }
});
const DATE_WHERE_INPUT = exports.DATE_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'DateWhereInput',
  description: 'The DateWhereInput input type is used in operations that involve filtering objects by a field of type Date.',
  fields: {
    equalTo: equalTo(DATE),
    notEqualTo: notEqualTo(DATE),
    lessThan: lessThan(DATE),
    lessThanOrEqualTo: lessThanOrEqualTo(DATE),
    greaterThan: greaterThan(DATE),
    greaterThanOrEqualTo: greaterThanOrEqualTo(DATE),
    in: inOp(DATE),
    notIn: notIn(DATE),
    exists,
    inQueryKey,
    notInQueryKey
  }
});
const BYTES_WHERE_INPUT = exports.BYTES_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'BytesWhereInput',
  description: 'The BytesWhereInput input type is used in operations that involve filtering objects by a field of type Bytes.',
  fields: {
    equalTo: equalTo(BYTES),
    notEqualTo: notEqualTo(BYTES),
    lessThan: lessThan(BYTES),
    lessThanOrEqualTo: lessThanOrEqualTo(BYTES),
    greaterThan: greaterThan(BYTES),
    greaterThanOrEqualTo: greaterThanOrEqualTo(BYTES),
    in: inOp(BYTES),
    notIn: notIn(BYTES),
    exists,
    inQueryKey,
    notInQueryKey
  }
});
const FILE_WHERE_INPUT = exports.FILE_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'FileWhereInput',
  description: 'The FileWhereInput input type is used in operations that involve filtering objects by a field of type File.',
  fields: {
    equalTo: equalTo(FILE),
    notEqualTo: notEqualTo(FILE),
    lessThan: lessThan(FILE),
    lessThanOrEqualTo: lessThanOrEqualTo(FILE),
    greaterThan: greaterThan(FILE),
    greaterThanOrEqualTo: greaterThanOrEqualTo(FILE),
    in: inOp(FILE),
    notIn: notIn(FILE),
    exists,
    matchesRegex,
    options,
    inQueryKey,
    notInQueryKey
  }
});
const GEO_POINT_WHERE_INPUT = exports.GEO_POINT_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'GeoPointWhereInput',
  description: 'The GeoPointWhereInput input type is used in operations that involve filtering objects by a field of type GeoPoint.',
  fields: {
    exists,
    nearSphere: {
      description: 'This is the nearSphere operator to specify a constraint to select the objects where the values of a geo point field is near to another geo point.',
      type: GEO_POINT_INPUT
    },
    maxDistance: {
      description: 'This is the maxDistance operator to specify a constraint to select the objects where the values of a geo point field is at a max distance (in radians) from the geo point specified in the $nearSphere operator.',
      type: _graphql.GraphQLFloat
    },
    maxDistanceInRadians: {
      description: 'This is the maxDistanceInRadians operator to specify a constraint to select the objects where the values of a geo point field is at a max distance (in radians) from the geo point specified in the $nearSphere operator.',
      type: _graphql.GraphQLFloat
    },
    maxDistanceInMiles: {
      description: 'This is the maxDistanceInMiles operator to specify a constraint to select the objects where the values of a geo point field is at a max distance (in miles) from the geo point specified in the $nearSphere operator.',
      type: _graphql.GraphQLFloat
    },
    maxDistanceInKilometers: {
      description: 'This is the maxDistanceInKilometers operator to specify a constraint to select the objects where the values of a geo point field is at a max distance (in kilometers) from the geo point specified in the $nearSphere operator.',
      type: _graphql.GraphQLFloat
    },
    within: {
      description: 'This is the within operator to specify a constraint to select the objects where the values of a geo point field is within a specified box.',
      type: WITHIN_INPUT
    },
    geoWithin: {
      description: 'This is the geoWithin operator to specify a constraint to select the objects where the values of a geo point field is within a specified polygon or sphere.',
      type: GEO_WITHIN_INPUT
    }
  }
});
const POLYGON_WHERE_INPUT = exports.POLYGON_WHERE_INPUT = new _graphql.GraphQLInputObjectType({
  name: 'PolygonWhereInput',
  description: 'The PolygonWhereInput input type is used in operations that involve filtering objects by a field of type Polygon.',
  fields: {
    exists,
    geoIntersects: {
      description: 'This is the geoIntersects operator to specify a constraint to select the objects where the values of a polygon field intersect a specified point.',
      type: GEO_INTERSECTS_INPUT
    }
  }
});
const ELEMENT = exports.ELEMENT = new _graphql.GraphQLObjectType({
  name: 'Element',
  description: "The Element object type is used to return array items' value.",
  fields: {
    value: {
      description: 'Return the value of the element in the array',
      type: new _graphql.GraphQLNonNull(ANY)
    }
  }
});

// Default static union type, we update types and resolveType function later
let ARRAY_RESULT = exports.ARRAY_RESULT = void 0;
const loadArrayResult = (parseGraphQLSchema, parseClassesArray) => {
  const classTypes = parseClassesArray.filter(parseClass => parseGraphQLSchema.parseClassTypes[parseClass.className].classGraphQLOutputType ? true : false).map(parseClass => parseGraphQLSchema.parseClassTypes[parseClass.className].classGraphQLOutputType);
  exports.ARRAY_RESULT = ARRAY_RESULT = new _graphql.GraphQLUnionType({
    name: 'ArrayResult',
    description: 'Use Inline Fragment on Array to get results: https://graphql.org/learn/queries/#inline-fragments',
    types: () => [ELEMENT, ...classTypes],
    resolveType: value => {
      if (value.__type === 'Object' && value.className && value.objectId) {
        if (parseGraphQLSchema.parseClassTypes[value.className]) {
          return parseGraphQLSchema.parseClassTypes[value.className].classGraphQLOutputType.name;
        } else {
          return ELEMENT.name;
        }
      } else {
        return ELEMENT.name;
      }
    }
  });
  parseGraphQLSchema.graphQLTypes.push(ARRAY_RESULT);
};
exports.loadArrayResult = loadArrayResult;
const load = parseGraphQLSchema => {
  parseGraphQLSchema.addGraphQLType(_GraphQLUpload.default, true);
  parseGraphQLSchema.addGraphQLType(ANY, true);
  parseGraphQLSchema.addGraphQLType(OBJECT, true);
  parseGraphQLSchema.addGraphQLType(DATE, true);
  parseGraphQLSchema.addGraphQLType(BYTES, true);
  parseGraphQLSchema.addGraphQLType(FILE, true);
  parseGraphQLSchema.addGraphQLType(FILE_INFO, true);
  parseGraphQLSchema.addGraphQLType(FILE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(GEO_POINT_INPUT, true);
  parseGraphQLSchema.addGraphQLType(GEO_POINT, true);
  parseGraphQLSchema.addGraphQLType(PARSE_OBJECT, true);
  parseGraphQLSchema.addGraphQLType(READ_PREFERENCE, true);
  parseGraphQLSchema.addGraphQLType(READ_OPTIONS_INPUT, true);
  parseGraphQLSchema.addGraphQLType(SEARCH_INPUT, true);
  parseGraphQLSchema.addGraphQLType(TEXT_INPUT, true);
  parseGraphQLSchema.addGraphQLType(BOX_INPUT, true);
  parseGraphQLSchema.addGraphQLType(WITHIN_INPUT, true);
  parseGraphQLSchema.addGraphQLType(CENTER_SPHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(GEO_WITHIN_INPUT, true);
  parseGraphQLSchema.addGraphQLType(GEO_INTERSECTS_INPUT, true);
  parseGraphQLSchema.addGraphQLType(ID_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(STRING_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(NUMBER_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(BOOLEAN_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(ARRAY_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(KEY_VALUE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(OBJECT_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(DATE_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(BYTES_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(FILE_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(GEO_POINT_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(POLYGON_WHERE_INPUT, true);
  parseGraphQLSchema.addGraphQLType(ELEMENT, true);
  parseGraphQLSchema.addGraphQLType(ACL_INPUT, true);
  parseGraphQLSchema.addGraphQLType(USER_ACL_INPUT, true);
  parseGraphQLSchema.addGraphQLType(ROLE_ACL_INPUT, true);
  parseGraphQLSchema.addGraphQLType(PUBLIC_ACL_INPUT, true);
  parseGraphQLSchema.addGraphQLType(ACL, true);
  parseGraphQLSchema.addGraphQLType(USER_ACL, true);
  parseGraphQLSchema.addGraphQLType(ROLE_ACL, true);
  parseGraphQLSchema.addGraphQLType(PUBLIC_ACL, true);
  parseGraphQLSchema.addGraphQLType(SUBQUERY_INPUT, true);
  parseGraphQLSchema.addGraphQLType(SELECT_INPUT, true);
};
exports.load = load;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfZ3JhcGhxbCIsInJlcXVpcmUiLCJfZ3JhcGhxbFJlbGF5IiwiX0dyYXBoUUxVcGxvYWQiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwiX1V0aWxzIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiVHlwZVZhbGlkYXRpb25FcnJvciIsIkVycm9yIiwiY29uc3RydWN0b3IiLCJ2YWx1ZSIsInR5cGUiLCJleHBvcnRzIiwicGFyc2VTdHJpbmdWYWx1ZSIsInBhcnNlSW50VmFsdWUiLCJpbnQiLCJOdW1iZXIiLCJpc0ludGVnZXIiLCJwYXJzZUZsb2F0VmFsdWUiLCJmbG9hdCIsImlzTmFOIiwicGFyc2VCb29sZWFuVmFsdWUiLCJwYXJzZVZhbHVlIiwia2luZCIsIktpbmQiLCJTVFJJTkciLCJJTlQiLCJGTE9BVCIsIkJPT0xFQU4iLCJMSVNUIiwicGFyc2VMaXN0VmFsdWVzIiwidmFsdWVzIiwiT0JKRUNUIiwicGFyc2VPYmplY3RGaWVsZHMiLCJmaWVsZHMiLCJBcnJheSIsImlzQXJyYXkiLCJtYXAiLCJyZWR1Y2UiLCJvYmplY3QiLCJmaWVsZCIsIm5hbWUiLCJBTlkiLCJHcmFwaFFMU2NhbGFyVHlwZSIsImRlc2NyaXB0aW9uIiwic2VyaWFsaXplIiwicGFyc2VMaXRlcmFsIiwiYXN0IiwicGFyc2VEYXRlSXNvVmFsdWUiLCJkYXRlIiwiRGF0ZSIsIlV0aWxzIiwiaXNEYXRlIiwic2VyaWFsaXplRGF0ZUlzbyIsInRvSVNPU3RyaW5nIiwicGFyc2VEYXRlSXNvTGl0ZXJhbCIsIkRBVEUiLCJfX3R5cGUiLCJpc28iLCJmaW5kIiwiQllURVMiLCJiYXNlNjQiLCJwYXJzZUZpbGVWYWx1ZSIsInVybCIsInVuZGVmaW5lZCIsIkZJTEUiLCJGSUxFX0lORk8iLCJHcmFwaFFMT2JqZWN0VHlwZSIsIkdyYXBoUUxOb25OdWxsIiwiR3JhcGhRTFN0cmluZyIsIkZJTEVfSU5QVVQiLCJHcmFwaFFMSW5wdXRPYmplY3RUeXBlIiwiZmlsZSIsInVwbG9hZCIsIkdyYXBoUUxVcGxvYWQiLCJHRU9fUE9JTlRfRklFTERTIiwibGF0aXR1ZGUiLCJHcmFwaFFMRmxvYXQiLCJsb25naXR1ZGUiLCJHRU9fUE9JTlRfSU5QVVQiLCJHRU9fUE9JTlQiLCJQT0xZR09OX0lOUFVUIiwiR3JhcGhRTExpc3QiLCJQT0xZR09OIiwiVVNFUl9BQ0xfSU5QVVQiLCJ1c2VySWQiLCJHcmFwaFFMSUQiLCJyZWFkIiwiR3JhcGhRTEJvb2xlYW4iLCJ3cml0ZSIsIlJPTEVfQUNMX0lOUFVUIiwicm9sZU5hbWUiLCJQVUJMSUNfQUNMX0lOUFVUIiwiQUNMX0lOUFVUIiwidXNlcnMiLCJyb2xlcyIsInB1YmxpYyIsIlVTRVJfQUNMIiwiUk9MRV9BQ0wiLCJQVUJMSUNfQUNMIiwiQUNMIiwicmVzb2x2ZSIsInAiLCJPYmplY3QiLCJrZXlzIiwiZm9yRWFjaCIsInJ1bGUiLCJpbmRleE9mIiwicHVzaCIsInRvR2xvYmFsSWQiLCJsZW5ndGgiLCJyZXBsYWNlIiwiT0JKRUNUX0lEIiwiQ0xBU1NfTkFNRV9BVFQiLCJHTE9CQUxfT1JfT0JKRUNUX0lEX0FUVCIsIk9CSkVDVF9JRF9BVFQiLCJDUkVBVEVEX0FUX0FUVCIsIlVQREFURURfQVRfQVRUIiwiSU5QVVRfRklFTERTIiwiQ1JFQVRFX1JFU1VMVF9GSUVMRFMiLCJvYmplY3RJZCIsImNyZWF0ZWRBdCIsIlVQREFURV9SRVNVTFRfRklFTERTIiwidXBkYXRlZEF0IiwiUEFSU0VfT0JKRUNUX0ZJRUxEUyIsIlBBUlNFX09CSkVDVCIsIkdyYXBoUUxJbnRlcmZhY2VUeXBlIiwiU0VTU0lPTl9UT0tFTl9BVFQiLCJSRUFEX1BSRUZFUkVOQ0UiLCJHcmFwaFFMRW51bVR5cGUiLCJQUklNQVJZIiwiUFJJTUFSWV9QUkVGRVJSRUQiLCJTRUNPTkRBUlkiLCJTRUNPTkRBUllfUFJFRkVSUkVEIiwiTkVBUkVTVCIsIlJFQURfUFJFRkVSRU5DRV9BVFQiLCJJTkNMVURFX1JFQURfUFJFRkVSRU5DRV9BVFQiLCJTVUJRVUVSWV9SRUFEX1BSRUZFUkVOQ0VfQVRUIiwiUkVBRF9PUFRJT05TX0lOUFVUIiwicmVhZFByZWZlcmVuY2UiLCJpbmNsdWRlUmVhZFByZWZlcmVuY2UiLCJzdWJxdWVyeVJlYWRQcmVmZXJlbmNlIiwiUkVBRF9PUFRJT05TX0FUVCIsIldIRVJFX0FUVCIsIlNLSVBfQVRUIiwiR3JhcGhRTEludCIsIkxJTUlUX0FUVCIsIkNPVU5UX0FUVCIsIlNFQVJDSF9JTlBVVCIsInRlcm0iLCJsYW5ndWFnZSIsImNhc2VTZW5zaXRpdmUiLCJkaWFjcml0aWNTZW5zaXRpdmUiLCJURVhUX0lOUFVUIiwic2VhcmNoIiwiQk9YX0lOUFVUIiwiYm90dG9tTGVmdCIsInVwcGVyUmlnaHQiLCJXSVRISU5fSU5QVVQiLCJib3giLCJDRU5URVJfU1BIRVJFX0lOUFVUIiwiY2VudGVyIiwiZGlzdGFuY2UiLCJHRU9fV0lUSElOX0lOUFVUIiwicG9seWdvbiIsImNlbnRlclNwaGVyZSIsIkdFT19JTlRFUlNFQ1RTX0lOUFVUIiwicG9pbnQiLCJlcXVhbFRvIiwibm90RXF1YWxUbyIsImxlc3NUaGFuIiwibGVzc1RoYW5PckVxdWFsVG8iLCJncmVhdGVyVGhhbiIsImdyZWF0ZXJUaGFuT3JFcXVhbFRvIiwiaW5PcCIsIm5vdEluIiwiZXhpc3RzIiwibWF0Y2hlc1JlZ2V4Iiwib3B0aW9ucyIsIlNVQlFVRVJZX0lOUFVUIiwiY2xhc3NOYW1lIiwid2hlcmUiLCJhc3NpZ24iLCJTRUxFQ1RfSU5QVVQiLCJxdWVyeSIsImtleSIsImluUXVlcnlLZXkiLCJub3RJblF1ZXJ5S2V5IiwiSURfV0hFUkVfSU5QVVQiLCJpbiIsIlNUUklOR19XSEVSRV9JTlBVVCIsInRleHQiLCJOVU1CRVJfV0hFUkVfSU5QVVQiLCJCT09MRUFOX1dIRVJFX0lOUFVUIiwiQVJSQVlfV0hFUkVfSU5QVVQiLCJjb250YWluZWRCeSIsImNvbnRhaW5zIiwiS0VZX1ZBTFVFX0lOUFVUIiwiT0JKRUNUX1dIRVJFX0lOUFVUIiwiREFURV9XSEVSRV9JTlBVVCIsIkJZVEVTX1dIRVJFX0lOUFVUIiwiRklMRV9XSEVSRV9JTlBVVCIsIkdFT19QT0lOVF9XSEVSRV9JTlBVVCIsIm5lYXJTcGhlcmUiLCJtYXhEaXN0YW5jZSIsIm1heERpc3RhbmNlSW5SYWRpYW5zIiwibWF4RGlzdGFuY2VJbk1pbGVzIiwibWF4RGlzdGFuY2VJbktpbG9tZXRlcnMiLCJ3aXRoaW4iLCJnZW9XaXRoaW4iLCJQT0xZR09OX1dIRVJFX0lOUFVUIiwiZ2VvSW50ZXJzZWN0cyIsIkVMRU1FTlQiLCJBUlJBWV9SRVNVTFQiLCJsb2FkQXJyYXlSZXN1bHQiLCJwYXJzZUdyYXBoUUxTY2hlbWEiLCJwYXJzZUNsYXNzZXNBcnJheSIsImNsYXNzVHlwZXMiLCJmaWx0ZXIiLCJwYXJzZUNsYXNzIiwicGFyc2VDbGFzc1R5cGVzIiwiY2xhc3NHcmFwaFFMT3V0cHV0VHlwZSIsIkdyYXBoUUxVbmlvblR5cGUiLCJ0eXBlcyIsInJlc29sdmVUeXBlIiwiZ3JhcGhRTFR5cGVzIiwibG9hZCIsImFkZEdyYXBoUUxUeXBlIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL0dyYXBoUUwvbG9hZGVycy9kZWZhdWx0R3JhcGhRTFR5cGVzLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIEtpbmQsXG4gIEdyYXBoUUxOb25OdWxsLFxuICBHcmFwaFFMU2NhbGFyVHlwZSxcbiAgR3JhcGhRTElELFxuICBHcmFwaFFMU3RyaW5nLFxuICBHcmFwaFFMT2JqZWN0VHlwZSxcbiAgR3JhcGhRTEludGVyZmFjZVR5cGUsXG4gIEdyYXBoUUxFbnVtVHlwZSxcbiAgR3JhcGhRTEludCxcbiAgR3JhcGhRTEZsb2F0LFxuICBHcmFwaFFMTGlzdCxcbiAgR3JhcGhRTElucHV0T2JqZWN0VHlwZSxcbiAgR3JhcGhRTEJvb2xlYW4sXG4gIEdyYXBoUUxVbmlvblR5cGUsXG59IGZyb20gJ2dyYXBocWwnO1xuaW1wb3J0IHsgdG9HbG9iYWxJZCB9IGZyb20gJ2dyYXBocWwtcmVsYXknO1xuaW1wb3J0IEdyYXBoUUxVcGxvYWQgZnJvbSAnZ3JhcGhxbC11cGxvYWQvR3JhcGhRTFVwbG9hZC5qcyc7XG5pbXBvcnQgVXRpbHMgZnJvbSAnLi4vLi4vVXRpbHMnO1xuXG5jbGFzcyBUeXBlVmFsaWRhdGlvbkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3Rvcih2YWx1ZSwgdHlwZSkge1xuICAgIHN1cGVyKGAke3ZhbHVlfSBpcyBub3QgYSB2YWxpZCAke3R5cGV9YCk7XG4gIH1cbn1cblxuY29uc3QgcGFyc2VTdHJpbmdWYWx1ZSA9IHZhbHVlID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cblxuICB0aHJvdyBuZXcgVHlwZVZhbGlkYXRpb25FcnJvcih2YWx1ZSwgJ1N0cmluZycpO1xufTtcblxuY29uc3QgcGFyc2VJbnRWYWx1ZSA9IHZhbHVlID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICBjb25zdCBpbnQgPSBOdW1iZXIodmFsdWUpO1xuICAgIGlmIChOdW1iZXIuaXNJbnRlZ2VyKGludCkpIHtcbiAgICAgIHJldHVybiBpbnQ7XG4gICAgfVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVWYWxpZGF0aW9uRXJyb3IodmFsdWUsICdJbnQnKTtcbn07XG5cbmNvbnN0IHBhcnNlRmxvYXRWYWx1ZSA9IHZhbHVlID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICBjb25zdCBmbG9hdCA9IE51bWJlcih2YWx1ZSk7XG4gICAgaWYgKCFpc05hTihmbG9hdCkpIHtcbiAgICAgIHJldHVybiBmbG9hdDtcbiAgICB9XG4gIH1cblxuICB0aHJvdyBuZXcgVHlwZVZhbGlkYXRpb25FcnJvcih2YWx1ZSwgJ0Zsb2F0Jyk7XG59O1xuXG5jb25zdCBwYXJzZUJvb2xlYW5WYWx1ZSA9IHZhbHVlID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVWYWxpZGF0aW9uRXJyb3IodmFsdWUsICdCb29sZWFuJyk7XG59O1xuXG5jb25zdCBwYXJzZVZhbHVlID0gdmFsdWUgPT4ge1xuICBzd2l0Y2ggKHZhbHVlLmtpbmQpIHtcbiAgICBjYXNlIEtpbmQuU1RSSU5HOlxuICAgICAgcmV0dXJuIHBhcnNlU3RyaW5nVmFsdWUodmFsdWUudmFsdWUpO1xuXG4gICAgY2FzZSBLaW5kLklOVDpcbiAgICAgIHJldHVybiBwYXJzZUludFZhbHVlKHZhbHVlLnZhbHVlKTtcblxuICAgIGNhc2UgS2luZC5GTE9BVDpcbiAgICAgIHJldHVybiBwYXJzZUZsb2F0VmFsdWUodmFsdWUudmFsdWUpO1xuXG4gICAgY2FzZSBLaW5kLkJPT0xFQU46XG4gICAgICByZXR1cm4gcGFyc2VCb29sZWFuVmFsdWUodmFsdWUudmFsdWUpO1xuXG4gICAgY2FzZSBLaW5kLkxJU1Q6XG4gICAgICByZXR1cm4gcGFyc2VMaXN0VmFsdWVzKHZhbHVlLnZhbHVlcyk7XG5cbiAgICBjYXNlIEtpbmQuT0JKRUNUOlxuICAgICAgcmV0dXJuIHBhcnNlT2JqZWN0RmllbGRzKHZhbHVlLmZpZWxkcyk7XG5cbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHZhbHVlLnZhbHVlO1xuICB9XG59O1xuXG5jb25zdCBwYXJzZUxpc3RWYWx1ZXMgPSB2YWx1ZXMgPT4ge1xuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZXMpKSB7XG4gICAgcmV0dXJuIHZhbHVlcy5tYXAodmFsdWUgPT4gcGFyc2VWYWx1ZSh2YWx1ZSkpO1xuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVWYWxpZGF0aW9uRXJyb3IodmFsdWVzLCAnTGlzdCcpO1xufTtcblxuY29uc3QgcGFyc2VPYmplY3RGaWVsZHMgPSBmaWVsZHMgPT4ge1xuICBpZiAoQXJyYXkuaXNBcnJheShmaWVsZHMpKSB7XG4gICAgcmV0dXJuIGZpZWxkcy5yZWR1Y2UoXG4gICAgICAob2JqZWN0LCBmaWVsZCkgPT4gKHtcbiAgICAgICAgLi4ub2JqZWN0LFxuICAgICAgICBbZmllbGQubmFtZS52YWx1ZV06IHBhcnNlVmFsdWUoZmllbGQudmFsdWUpLFxuICAgICAgfSksXG4gICAgICB7fVxuICAgICk7XG4gIH1cblxuICB0aHJvdyBuZXcgVHlwZVZhbGlkYXRpb25FcnJvcihmaWVsZHMsICdPYmplY3QnKTtcbn07XG5cbmNvbnN0IEFOWSA9IG5ldyBHcmFwaFFMU2NhbGFyVHlwZSh7XG4gIG5hbWU6ICdBbnknLFxuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhlIEFueSBzY2FsYXIgdHlwZSBpcyB1c2VkIGluIG9wZXJhdGlvbnMgYW5kIHR5cGVzIHRoYXQgaW52b2x2ZSBhbnkgdHlwZSBvZiB2YWx1ZS4nLFxuICBwYXJzZVZhbHVlOiB2YWx1ZSA9PiB2YWx1ZSxcbiAgc2VyaWFsaXplOiB2YWx1ZSA9PiB2YWx1ZSxcbiAgcGFyc2VMaXRlcmFsOiBhc3QgPT4gcGFyc2VWYWx1ZShhc3QpLFxufSk7XG5cbmNvbnN0IE9CSkVDVCA9IG5ldyBHcmFwaFFMU2NhbGFyVHlwZSh7XG4gIG5hbWU6ICdPYmplY3QnLFxuICBkZXNjcmlwdGlvbjogJ1RoZSBPYmplY3Qgc2NhbGFyIHR5cGUgaXMgdXNlZCBpbiBvcGVyYXRpb25zIGFuZCB0eXBlcyB0aGF0IGludm9sdmUgb2JqZWN0cy4nLFxuICBwYXJzZVZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgVHlwZVZhbGlkYXRpb25FcnJvcih2YWx1ZSwgJ09iamVjdCcpO1xuICB9LFxuICBzZXJpYWxpemUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBUeXBlVmFsaWRhdGlvbkVycm9yKHZhbHVlLCAnT2JqZWN0Jyk7XG4gIH0sXG4gIHBhcnNlTGl0ZXJhbChhc3QpIHtcbiAgICBpZiAoYXN0LmtpbmQgPT09IEtpbmQuT0JKRUNUKSB7XG4gICAgICByZXR1cm4gcGFyc2VPYmplY3RGaWVsZHMoYXN0LmZpZWxkcyk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IFR5cGVWYWxpZGF0aW9uRXJyb3IoYXN0LmtpbmQsICdPYmplY3QnKTtcbiAgfSxcbn0pO1xuXG5jb25zdCBwYXJzZURhdGVJc29WYWx1ZSA9IHZhbHVlID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUodmFsdWUpO1xuICAgIGlmICghaXNOYU4oZGF0ZSkpIHtcbiAgICAgIHJldHVybiBkYXRlO1xuICAgIH1cbiAgfSBlbHNlIGlmIChVdGlscy5pc0RhdGUodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVWYWxpZGF0aW9uRXJyb3IodmFsdWUsICdEYXRlJyk7XG59O1xuXG5jb25zdCBzZXJpYWxpemVEYXRlSXNvID0gdmFsdWUgPT4ge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICBpZiAoVXRpbHMuaXNEYXRlKHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpO1xuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVWYWxpZGF0aW9uRXJyb3IodmFsdWUsICdEYXRlJyk7XG59O1xuXG5jb25zdCBwYXJzZURhdGVJc29MaXRlcmFsID0gYXN0ID0+IHtcbiAgaWYgKGFzdC5raW5kID09PSBLaW5kLlNUUklORykge1xuICAgIHJldHVybiBwYXJzZURhdGVJc29WYWx1ZShhc3QudmFsdWUpO1xuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVWYWxpZGF0aW9uRXJyb3IoYXN0LmtpbmQsICdEYXRlJyk7XG59O1xuXG5jb25zdCBEQVRFID0gbmV3IEdyYXBoUUxTY2FsYXJUeXBlKHtcbiAgbmFtZTogJ0RhdGUnLFxuICBkZXNjcmlwdGlvbjogJ1RoZSBEYXRlIHNjYWxhciB0eXBlIGlzIHVzZWQgaW4gb3BlcmF0aW9ucyBhbmQgdHlwZXMgdGhhdCBpbnZvbHZlIGRhdGVzLicsXG4gIHBhcnNlVmFsdWUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyB8fCBVdGlscy5pc0RhdGUodmFsdWUpKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBfX3R5cGU6ICdEYXRlJyxcbiAgICAgICAgaXNvOiBwYXJzZURhdGVJc29WYWx1ZSh2YWx1ZSksXG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZS5fX3R5cGUgPT09ICdEYXRlJyAmJiB2YWx1ZS5pc28pIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIF9fdHlwZTogdmFsdWUuX190eXBlLFxuICAgICAgICBpc286IHBhcnNlRGF0ZUlzb1ZhbHVlKHZhbHVlLmlzbyksXG4gICAgICB9O1xuICAgIH1cblxuICAgIHRocm93IG5ldyBUeXBlVmFsaWRhdGlvbkVycm9yKHZhbHVlLCAnRGF0ZScpO1xuICB9LFxuICBzZXJpYWxpemUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyB8fCBVdGlscy5pc0RhdGUodmFsdWUpKSB7XG4gICAgICByZXR1cm4gc2VyaWFsaXplRGF0ZUlzbyh2YWx1ZSk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlLl9fdHlwZSA9PT0gJ0RhdGUnICYmIHZhbHVlLmlzbykge1xuICAgICAgcmV0dXJuIHNlcmlhbGl6ZURhdGVJc28odmFsdWUuaXNvKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgVHlwZVZhbGlkYXRpb25FcnJvcih2YWx1ZSwgJ0RhdGUnKTtcbiAgfSxcbiAgcGFyc2VMaXRlcmFsKGFzdCkge1xuICAgIGlmIChhc3Qua2luZCA9PT0gS2luZC5TVFJJTkcpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIF9fdHlwZTogJ0RhdGUnLFxuICAgICAgICBpc286IHBhcnNlRGF0ZUlzb0xpdGVyYWwoYXN0KSxcbiAgICAgIH07XG4gICAgfSBlbHNlIGlmIChhc3Qua2luZCA9PT0gS2luZC5PQkpFQ1QpIHtcbiAgICAgIGNvbnN0IF9fdHlwZSA9IGFzdC5maWVsZHMuZmluZChmaWVsZCA9PiBmaWVsZC5uYW1lLnZhbHVlID09PSAnX190eXBlJyk7XG4gICAgICBjb25zdCBpc28gPSBhc3QuZmllbGRzLmZpbmQoZmllbGQgPT4gZmllbGQubmFtZS52YWx1ZSA9PT0gJ2lzbycpO1xuICAgICAgaWYgKF9fdHlwZSAmJiBfX3R5cGUudmFsdWUgJiYgX190eXBlLnZhbHVlLnZhbHVlID09PSAnRGF0ZScgJiYgaXNvKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgX190eXBlOiBfX3R5cGUudmFsdWUudmFsdWUsXG4gICAgICAgICAgaXNvOiBwYXJzZURhdGVJc29MaXRlcmFsKGlzby52YWx1ZSksXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IFR5cGVWYWxpZGF0aW9uRXJyb3IoYXN0LmtpbmQsICdEYXRlJyk7XG4gIH0sXG59KTtcblxuY29uc3QgQllURVMgPSBuZXcgR3JhcGhRTFNjYWxhclR5cGUoe1xuICBuYW1lOiAnQnl0ZXMnLFxuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhlIEJ5dGVzIHNjYWxhciB0eXBlIGlzIHVzZWQgaW4gb3BlcmF0aW9ucyBhbmQgdHlwZXMgdGhhdCBpbnZvbHZlIGJhc2UgNjQgYmluYXJ5IGRhdGEuJyxcbiAgcGFyc2VWYWx1ZSh2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBfX3R5cGU6ICdCeXRlcycsXG4gICAgICAgIGJhc2U2NDogdmFsdWUsXG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAoXG4gICAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICB2YWx1ZS5fX3R5cGUgPT09ICdCeXRlcycgJiZcbiAgICAgIHR5cGVvZiB2YWx1ZS5iYXNlNjQgPT09ICdzdHJpbmcnXG4gICAgKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IFR5cGVWYWxpZGF0aW9uRXJyb3IodmFsdWUsICdCeXRlcycpO1xuICB9LFxuICBzZXJpYWxpemUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH0gZWxzZSBpZiAoXG4gICAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICB2YWx1ZS5fX3R5cGUgPT09ICdCeXRlcycgJiZcbiAgICAgIHR5cGVvZiB2YWx1ZS5iYXNlNjQgPT09ICdzdHJpbmcnXG4gICAgKSB7XG4gICAgICByZXR1cm4gdmFsdWUuYmFzZTY0O1xuICAgIH1cblxuICAgIHRocm93IG5ldyBUeXBlVmFsaWRhdGlvbkVycm9yKHZhbHVlLCAnQnl0ZXMnKTtcbiAgfSxcbiAgcGFyc2VMaXRlcmFsKGFzdCkge1xuICAgIGlmIChhc3Qua2luZCA9PT0gS2luZC5TVFJJTkcpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIF9fdHlwZTogJ0J5dGVzJyxcbiAgICAgICAgYmFzZTY0OiBhc3QudmFsdWUsXG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAoYXN0LmtpbmQgPT09IEtpbmQuT0JKRUNUKSB7XG4gICAgICBjb25zdCBfX3R5cGUgPSBhc3QuZmllbGRzLmZpbmQoZmllbGQgPT4gZmllbGQubmFtZS52YWx1ZSA9PT0gJ19fdHlwZScpO1xuICAgICAgY29uc3QgYmFzZTY0ID0gYXN0LmZpZWxkcy5maW5kKGZpZWxkID0+IGZpZWxkLm5hbWUudmFsdWUgPT09ICdiYXNlNjQnKTtcbiAgICAgIGlmIChcbiAgICAgICAgX190eXBlICYmXG4gICAgICAgIF9fdHlwZS52YWx1ZSAmJlxuICAgICAgICBfX3R5cGUudmFsdWUudmFsdWUgPT09ICdCeXRlcycgJiZcbiAgICAgICAgYmFzZTY0ICYmXG4gICAgICAgIGJhc2U2NC52YWx1ZSAmJlxuICAgICAgICB0eXBlb2YgYmFzZTY0LnZhbHVlLnZhbHVlID09PSAnc3RyaW5nJ1xuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgX190eXBlOiBfX3R5cGUudmFsdWUudmFsdWUsXG4gICAgICAgICAgYmFzZTY0OiBiYXNlNjQudmFsdWUudmFsdWUsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IFR5cGVWYWxpZGF0aW9uRXJyb3IoYXN0LmtpbmQsICdCeXRlcycpO1xuICB9LFxufSk7XG5cbmNvbnN0IHBhcnNlRmlsZVZhbHVlID0gdmFsdWUgPT4ge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdGaWxlJyxcbiAgICAgIG5hbWU6IHZhbHVlLFxuICAgIH07XG4gIH0gZWxzZSBpZiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlLl9fdHlwZSA9PT0gJ0ZpbGUnICYmXG4gICAgdHlwZW9mIHZhbHVlLm5hbWUgPT09ICdzdHJpbmcnICYmXG4gICAgKHZhbHVlLnVybCA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiB2YWx1ZS51cmwgPT09ICdzdHJpbmcnKVxuICApIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cblxuICB0aHJvdyBuZXcgVHlwZVZhbGlkYXRpb25FcnJvcih2YWx1ZSwgJ0ZpbGUnKTtcbn07XG5cbmNvbnN0IEZJTEUgPSBuZXcgR3JhcGhRTFNjYWxhclR5cGUoe1xuICBuYW1lOiAnRmlsZScsXG4gIGRlc2NyaXB0aW9uOiAnVGhlIEZpbGUgc2NhbGFyIHR5cGUgaXMgdXNlZCBpbiBvcGVyYXRpb25zIGFuZCB0eXBlcyB0aGF0IGludm9sdmUgZmlsZXMuJyxcbiAgcGFyc2VWYWx1ZTogcGFyc2VGaWxlVmFsdWUsXG4gIHNlcmlhbGl6ZTogdmFsdWUgPT4ge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfSBlbHNlIGlmIChcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHZhbHVlLl9fdHlwZSA9PT0gJ0ZpbGUnICYmXG4gICAgICB0eXBlb2YgdmFsdWUubmFtZSA9PT0gJ3N0cmluZycgJiZcbiAgICAgICh2YWx1ZS51cmwgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgdmFsdWUudXJsID09PSAnc3RyaW5nJylcbiAgICApIHtcbiAgICAgIHJldHVybiB2YWx1ZS5uYW1lO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBUeXBlVmFsaWRhdGlvbkVycm9yKHZhbHVlLCAnRmlsZScpO1xuICB9LFxuICBwYXJzZUxpdGVyYWwoYXN0KSB7XG4gICAgaWYgKGFzdC5raW5kID09PSBLaW5kLlNUUklORykge1xuICAgICAgcmV0dXJuIHBhcnNlRmlsZVZhbHVlKGFzdC52YWx1ZSk7XG4gICAgfSBlbHNlIGlmIChhc3Qua2luZCA9PT0gS2luZC5PQkpFQ1QpIHtcbiAgICAgIGNvbnN0IF9fdHlwZSA9IGFzdC5maWVsZHMuZmluZChmaWVsZCA9PiBmaWVsZC5uYW1lLnZhbHVlID09PSAnX190eXBlJyk7XG4gICAgICBjb25zdCBuYW1lID0gYXN0LmZpZWxkcy5maW5kKGZpZWxkID0+IGZpZWxkLm5hbWUudmFsdWUgPT09ICduYW1lJyk7XG4gICAgICBjb25zdCB1cmwgPSBhc3QuZmllbGRzLmZpbmQoZmllbGQgPT4gZmllbGQubmFtZS52YWx1ZSA9PT0gJ3VybCcpO1xuICAgICAgaWYgKF9fdHlwZSAmJiBfX3R5cGUudmFsdWUgJiYgbmFtZSAmJiBuYW1lLnZhbHVlKSB7XG4gICAgICAgIHJldHVybiBwYXJzZUZpbGVWYWx1ZSh7XG4gICAgICAgICAgX190eXBlOiBfX3R5cGUudmFsdWUudmFsdWUsXG4gICAgICAgICAgbmFtZTogbmFtZS52YWx1ZS52YWx1ZSxcbiAgICAgICAgICB1cmw6IHVybCAmJiB1cmwudmFsdWUgPyB1cmwudmFsdWUudmFsdWUgOiB1bmRlZmluZWQsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRocm93IG5ldyBUeXBlVmFsaWRhdGlvbkVycm9yKGFzdC5raW5kLCAnRmlsZScpO1xuICB9LFxufSk7XG5cbmNvbnN0IEZJTEVfSU5GTyA9IG5ldyBHcmFwaFFMT2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdGaWxlSW5mbycsXG4gIGRlc2NyaXB0aW9uOiAnVGhlIEZpbGVJbmZvIG9iamVjdCB0eXBlIGlzIHVzZWQgdG8gcmV0dXJuIHRoZSBpbmZvcm1hdGlvbiBhYm91dCBmaWxlcy4nLFxuICBmaWVsZHM6IHtcbiAgICBuYW1lOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlIGZpbGUgbmFtZS4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKEdyYXBoUUxTdHJpbmcpLFxuICAgIH0sXG4gICAgdXJsOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlIHVybCBpbiB3aGljaCB0aGUgZmlsZSBjYW4gYmUgZG93bmxvYWRlZC4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKEdyYXBoUUxTdHJpbmcpLFxuICAgIH0sXG4gIH0sXG59KTtcblxuY29uc3QgRklMRV9JTlBVVCA9IG5ldyBHcmFwaFFMSW5wdXRPYmplY3RUeXBlKHtcbiAgbmFtZTogJ0ZpbGVJbnB1dCcsXG4gIGRlc2NyaXB0aW9uOlxuICAgICdJZiB0aGlzIGZpZWxkIGlzIHNldCB0byBudWxsIHRoZSBmaWxlIHdpbGwgYmUgdW5saW5rZWQgKHRoZSBmaWxlIHdpbGwgbm90IGJlIGRlbGV0ZWQgb24gY2xvdWQgc3RvcmFnZSkuJyxcbiAgZmllbGRzOiB7XG4gICAgZmlsZToge1xuICAgICAgZGVzY3JpcHRpb246ICdBIEZpbGUgU2NhbGFyIGNhbiBiZSBhbiB1cmwgb3IgYSBGaWxlSW5mbyBvYmplY3QuJyxcbiAgICAgIHR5cGU6IEZJTEUsXG4gICAgfSxcbiAgICB1cGxvYWQ6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnVXNlIHRoaXMgZmllbGQgaWYgeW91IHdhbnQgdG8gY3JlYXRlIGEgbmV3IGZpbGUuJyxcbiAgICAgIHR5cGU6IEdyYXBoUUxVcGxvYWQsXG4gICAgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCBHRU9fUE9JTlRfRklFTERTID0ge1xuICBsYXRpdHVkZToge1xuICAgIGRlc2NyaXB0aW9uOiAnVGhpcyBpcyB0aGUgbGF0aXR1ZGUuJyxcbiAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTEZsb2F0KSxcbiAgfSxcbiAgbG9uZ2l0dWRlOiB7XG4gICAgZGVzY3JpcHRpb246ICdUaGlzIGlzIHRoZSBsb25naXR1ZGUuJyxcbiAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTEZsb2F0KSxcbiAgfSxcbn07XG5cbmNvbnN0IEdFT19QT0lOVF9JTlBVVCA9IG5ldyBHcmFwaFFMSW5wdXRPYmplY3RUeXBlKHtcbiAgbmFtZTogJ0dlb1BvaW50SW5wdXQnLFxuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhlIEdlb1BvaW50SW5wdXQgdHlwZSBpcyB1c2VkIGluIG9wZXJhdGlvbnMgdGhhdCBpbnZvbHZlIGlucHV0dGluZyBmaWVsZHMgb2YgdHlwZSBnZW8gcG9pbnQuJyxcbiAgZmllbGRzOiBHRU9fUE9JTlRfRklFTERTLFxufSk7XG5cbmNvbnN0IEdFT19QT0lOVCA9IG5ldyBHcmFwaFFMT2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdHZW9Qb2ludCcsXG4gIGRlc2NyaXB0aW9uOiAnVGhlIEdlb1BvaW50IG9iamVjdCB0eXBlIGlzIHVzZWQgdG8gcmV0dXJuIHRoZSBpbmZvcm1hdGlvbiBhYm91dCBnZW8gcG9pbnQgZmllbGRzLicsXG4gIGZpZWxkczogR0VPX1BPSU5UX0ZJRUxEUyxcbn0pO1xuXG5jb25zdCBQT0xZR09OX0lOUFVUID0gbmV3IEdyYXBoUUxMaXN0KG5ldyBHcmFwaFFMTm9uTnVsbChHRU9fUE9JTlRfSU5QVVQpKTtcblxuY29uc3QgUE9MWUdPTiA9IG5ldyBHcmFwaFFMTGlzdChuZXcgR3JhcGhRTE5vbk51bGwoR0VPX1BPSU5UKSk7XG5cbmNvbnN0IFVTRVJfQUNMX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnVXNlckFDTElucHV0JyxcbiAgZGVzY3JpcHRpb246ICdBbGxvdyB0byBtYW5hZ2UgdXNlcnMgaW4gQUNMLicsXG4gIGZpZWxkczoge1xuICAgIHVzZXJJZDoge1xuICAgICAgZGVzY3JpcHRpb246ICdJRCBvZiB0aGUgdGFyZ2V0dGVkIFVzZXIuJyxcbiAgICAgIHR5cGU6IG5ldyBHcmFwaFFMTm9uTnVsbChHcmFwaFFMSUQpLFxuICAgIH0sXG4gICAgcmVhZDoge1xuICAgICAgZGVzY3JpcHRpb246ICdBbGxvdyB0aGUgdXNlciB0byByZWFkIHRoZSBjdXJyZW50IG9iamVjdC4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKEdyYXBoUUxCb29sZWFuKSxcbiAgICB9LFxuICAgIHdyaXRlOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0FsbG93IHRoZSB1c2VyIHRvIHdyaXRlIG9uIHRoZSBjdXJyZW50IG9iamVjdC4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKEdyYXBoUUxCb29sZWFuKSxcbiAgICB9LFxuICB9LFxufSk7XG5cbmNvbnN0IFJPTEVfQUNMX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnUm9sZUFDTElucHV0JyxcbiAgZGVzY3JpcHRpb246ICdBbGxvdyB0byBtYW5hZ2Ugcm9sZXMgaW4gQUNMLicsXG4gIGZpZWxkczoge1xuICAgIHJvbGVOYW1lOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ05hbWUgb2YgdGhlIHRhcmdldHRlZCBSb2xlLicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTFN0cmluZyksXG4gICAgfSxcbiAgICByZWFkOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0FsbG93IHVzZXJzIHdobyBhcmUgbWVtYmVycyBvZiB0aGUgcm9sZSB0byByZWFkIHRoZSBjdXJyZW50IG9iamVjdC4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKEdyYXBoUUxCb29sZWFuKSxcbiAgICB9LFxuICAgIHdyaXRlOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0FsbG93IHVzZXJzIHdobyBhcmUgbWVtYmVycyBvZiB0aGUgcm9sZSB0byB3cml0ZSBvbiB0aGUgY3VycmVudCBvYmplY3QuJyxcbiAgICAgIHR5cGU6IG5ldyBHcmFwaFFMTm9uTnVsbChHcmFwaFFMQm9vbGVhbiksXG4gICAgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCBQVUJMSUNfQUNMX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnUHVibGljQUNMSW5wdXQnLFxuICBkZXNjcmlwdGlvbjogJ0FsbG93IHRvIG1hbmFnZSBwdWJsaWMgcmlnaHRzLicsXG4gIGZpZWxkczoge1xuICAgIHJlYWQ6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWxsb3cgYW55b25lIHRvIHJlYWQgdGhlIGN1cnJlbnQgb2JqZWN0LicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTEJvb2xlYW4pLFxuICAgIH0sXG4gICAgd3JpdGU6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWxsb3cgYW55b25lIHRvIHdyaXRlIG9uIHRoZSBjdXJyZW50IG9iamVjdC4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKEdyYXBoUUxCb29sZWFuKSxcbiAgICB9LFxuICB9LFxufSk7XG5cbmNvbnN0IEFDTF9JTlBVVCA9IG5ldyBHcmFwaFFMSW5wdXRPYmplY3RUeXBlKHtcbiAgbmFtZTogJ0FDTElucHV0JyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ0FsbG93IHRvIG1hbmFnZSBhY2Nlc3MgcmlnaHRzLiBJZiBub3QgcHJvdmlkZWQgb2JqZWN0IHdpbGwgYmUgcHVibGljbHkgcmVhZGFibGUgYW5kIHdyaXRhYmxlJyxcbiAgZmllbGRzOiB7XG4gICAgdXNlcnM6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWNjZXNzIGNvbnRyb2wgbGlzdCBmb3IgdXNlcnMuJyxcbiAgICAgIHR5cGU6IG5ldyBHcmFwaFFMTGlzdChuZXcgR3JhcGhRTE5vbk51bGwoVVNFUl9BQ0xfSU5QVVQpKSxcbiAgICB9LFxuICAgIHJvbGVzOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0FjY2VzcyBjb250cm9sIGxpc3QgZm9yIHJvbGVzLicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTExpc3QobmV3IEdyYXBoUUxOb25OdWxsKFJPTEVfQUNMX0lOUFVUKSksXG4gICAgfSxcbiAgICBwdWJsaWM6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHVibGljIGFjY2VzcyBjb250cm9sIGxpc3QuJyxcbiAgICAgIHR5cGU6IFBVQkxJQ19BQ0xfSU5QVVQsXG4gICAgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCBVU0VSX0FDTCA9IG5ldyBHcmFwaFFMT2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdVc2VyQUNMJyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ0FsbG93IHRvIG1hbmFnZSB1c2VycyBpbiBBQ0wuIElmIHJlYWQgYW5kIHdyaXRlIGFyZSBudWxsIHRoZSB1c2VycyBoYXZlIHJlYWQgYW5kIHdyaXRlIHJpZ2h0cy4nLFxuICBmaWVsZHM6IHtcbiAgICB1c2VySWQ6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnSUQgb2YgdGhlIHRhcmdldHRlZCBVc2VyLicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTElEKSxcbiAgICB9LFxuICAgIHJlYWQ6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWxsb3cgdGhlIHVzZXIgdG8gcmVhZCB0aGUgY3VycmVudCBvYmplY3QuJyxcbiAgICAgIHR5cGU6IG5ldyBHcmFwaFFMTm9uTnVsbChHcmFwaFFMQm9vbGVhbiksXG4gICAgfSxcbiAgICB3cml0ZToge1xuICAgICAgZGVzY3JpcHRpb246ICdBbGxvdyB0aGUgdXNlciB0byB3cml0ZSBvbiB0aGUgY3VycmVudCBvYmplY3QuJyxcbiAgICAgIHR5cGU6IG5ldyBHcmFwaFFMTm9uTnVsbChHcmFwaFFMQm9vbGVhbiksXG4gICAgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCBST0xFX0FDTCA9IG5ldyBHcmFwaFFMT2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdSb2xlQUNMJyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ0FsbG93IHRvIG1hbmFnZSByb2xlcyBpbiBBQ0wuIElmIHJlYWQgYW5kIHdyaXRlIGFyZSBudWxsIHRoZSByb2xlIGhhdmUgcmVhZCBhbmQgd3JpdGUgcmlnaHRzLicsXG4gIGZpZWxkczoge1xuICAgIHJvbGVOYW1lOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ05hbWUgb2YgdGhlIHRhcmdldHRlZCBSb2xlLicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTElEKSxcbiAgICB9LFxuICAgIHJlYWQ6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWxsb3cgdXNlcnMgd2hvIGFyZSBtZW1iZXJzIG9mIHRoZSByb2xlIHRvIHJlYWQgdGhlIGN1cnJlbnQgb2JqZWN0LicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTEJvb2xlYW4pLFxuICAgIH0sXG4gICAgd3JpdGU6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWxsb3cgdXNlcnMgd2hvIGFyZSBtZW1iZXJzIG9mIHRoZSByb2xlIHRvIHdyaXRlIG9uIHRoZSBjdXJyZW50IG9iamVjdC4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKEdyYXBoUUxCb29sZWFuKSxcbiAgICB9LFxuICB9LFxufSk7XG5cbmNvbnN0IFBVQkxJQ19BQ0wgPSBuZXcgR3JhcGhRTE9iamVjdFR5cGUoe1xuICBuYW1lOiAnUHVibGljQUNMJyxcbiAgZGVzY3JpcHRpb246ICdBbGxvdyB0byBtYW5hZ2UgcHVibGljIHJpZ2h0cy4nLFxuICBmaWVsZHM6IHtcbiAgICByZWFkOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0FsbG93IGFueW9uZSB0byByZWFkIHRoZSBjdXJyZW50IG9iamVjdC4nLFxuICAgICAgdHlwZTogR3JhcGhRTEJvb2xlYW4sXG4gICAgfSxcbiAgICB3cml0ZToge1xuICAgICAgZGVzY3JpcHRpb246ICdBbGxvdyBhbnlvbmUgdG8gd3JpdGUgb24gdGhlIGN1cnJlbnQgb2JqZWN0LicsXG4gICAgICB0eXBlOiBHcmFwaFFMQm9vbGVhbixcbiAgICB9LFxuICB9LFxufSk7XG5cbmNvbnN0IEFDTCA9IG5ldyBHcmFwaFFMT2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdBQ0wnLFxuICBkZXNjcmlwdGlvbjogJ0N1cnJlbnQgYWNjZXNzIGNvbnRyb2wgbGlzdCBvZiB0aGUgY3VycmVudCBvYmplY3QuJyxcbiAgZmllbGRzOiB7XG4gICAgdXNlcnM6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWNjZXNzIGNvbnRyb2wgbGlzdCBmb3IgdXNlcnMuJyxcbiAgICAgIHR5cGU6IG5ldyBHcmFwaFFMTGlzdChuZXcgR3JhcGhRTE5vbk51bGwoVVNFUl9BQ0wpKSxcbiAgICAgIHJlc29sdmUocCkge1xuICAgICAgICBjb25zdCB1c2VycyA9IFtdO1xuICAgICAgICBPYmplY3Qua2V5cyhwKS5mb3JFYWNoKHJ1bGUgPT4ge1xuICAgICAgICAgIGlmIChydWxlICE9PSAnKicgJiYgcnVsZS5pbmRleE9mKCdyb2xlOicpICE9PSAwKSB7XG4gICAgICAgICAgICB1c2Vycy5wdXNoKHtcbiAgICAgICAgICAgICAgdXNlcklkOiB0b0dsb2JhbElkKCdfVXNlcicsIHJ1bGUpLFxuICAgICAgICAgICAgICByZWFkOiBwW3J1bGVdLnJlYWQgPyB0cnVlIDogZmFsc2UsXG4gICAgICAgICAgICAgIHdyaXRlOiBwW3J1bGVdLndyaXRlID8gdHJ1ZSA6IGZhbHNlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHVzZXJzLmxlbmd0aCA/IHVzZXJzIDogbnVsbDtcbiAgICAgIH0sXG4gICAgfSxcbiAgICByb2xlczoge1xuICAgICAgZGVzY3JpcHRpb246ICdBY2Nlc3MgY29udHJvbCBsaXN0IGZvciByb2xlcy4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxMaXN0KG5ldyBHcmFwaFFMTm9uTnVsbChST0xFX0FDTCkpLFxuICAgICAgcmVzb2x2ZShwKSB7XG4gICAgICAgIGNvbnN0IHJvbGVzID0gW107XG4gICAgICAgIE9iamVjdC5rZXlzKHApLmZvckVhY2gocnVsZSA9PiB7XG4gICAgICAgICAgaWYgKHJ1bGUuaW5kZXhPZigncm9sZTonKSA9PT0gMCkge1xuICAgICAgICAgICAgcm9sZXMucHVzaCh7XG4gICAgICAgICAgICAgIHJvbGVOYW1lOiBydWxlLnJlcGxhY2UoJ3JvbGU6JywgJycpLFxuICAgICAgICAgICAgICByZWFkOiBwW3J1bGVdLnJlYWQgPyB0cnVlIDogZmFsc2UsXG4gICAgICAgICAgICAgIHdyaXRlOiBwW3J1bGVdLndyaXRlID8gdHJ1ZSA6IGZhbHNlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJvbGVzLmxlbmd0aCA/IHJvbGVzIDogbnVsbDtcbiAgICAgIH0sXG4gICAgfSxcbiAgICBwdWJsaWM6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHVibGljIGFjY2VzcyBjb250cm9sIGxpc3QuJyxcbiAgICAgIHR5cGU6IFBVQkxJQ19BQ0wsXG4gICAgICByZXNvbHZlKHApIHtcbiAgICAgICAgLyogZXNsaW50LWRpc2FibGUgKi9cbiAgICAgICAgcmV0dXJuIHBbJyonXVxuICAgICAgICAgID8ge1xuICAgICAgICAgICAgICByZWFkOiBwWycqJ10ucmVhZCA/IHRydWUgOiBmYWxzZSxcbiAgICAgICAgICAgICAgd3JpdGU6IHBbJyonXS53cml0ZSA/IHRydWUgOiBmYWxzZSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICA6IG51bGw7XG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG59KTtcblxuY29uc3QgT0JKRUNUX0lEID0gbmV3IEdyYXBoUUxOb25OdWxsKEdyYXBoUUxJRCk7XG5cbmNvbnN0IENMQVNTX05BTUVfQVRUID0ge1xuICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlIGNsYXNzIG5hbWUgb2YgdGhlIG9iamVjdC4nLFxuICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTFN0cmluZyksXG59O1xuXG5jb25zdCBHTE9CQUxfT1JfT0JKRUNUX0lEX0FUVCA9IHtcbiAgZGVzY3JpcHRpb246ICdUaGlzIGlzIHRoZSBvYmplY3QgaWQuIFlvdSBjYW4gdXNlIGVpdGhlciB0aGUgZ2xvYmFsIG9yIHRoZSBvYmplY3QgaWQuJyxcbiAgdHlwZTogT0JKRUNUX0lELFxufTtcblxuY29uc3QgT0JKRUNUX0lEX0FUVCA9IHtcbiAgZGVzY3JpcHRpb246ICdUaGlzIGlzIHRoZSBvYmplY3QgaWQuJyxcbiAgdHlwZTogT0JKRUNUX0lELFxufTtcblxuY29uc3QgQ1JFQVRFRF9BVF9BVFQgPSB7XG4gIGRlc2NyaXB0aW9uOiAnVGhpcyBpcyB0aGUgZGF0ZSBpbiB3aGljaCB0aGUgb2JqZWN0IHdhcyBjcmVhdGVkLicsXG4gIHR5cGU6IG5ldyBHcmFwaFFMTm9uTnVsbChEQVRFKSxcbn07XG5cbmNvbnN0IFVQREFURURfQVRfQVRUID0ge1xuICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlIGRhdGUgaW4gd2hpY2ggdGhlIG9iamVjdCB3YXMgbGFzIHVwZGF0ZWQuJyxcbiAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKERBVEUpLFxufTtcblxuY29uc3QgSU5QVVRfRklFTERTID0ge1xuICBBQ0w6IHtcbiAgICB0eXBlOiBBQ0wsXG4gIH0sXG59O1xuXG5jb25zdCBDUkVBVEVfUkVTVUxUX0ZJRUxEUyA9IHtcbiAgb2JqZWN0SWQ6IE9CSkVDVF9JRF9BVFQsXG4gIGNyZWF0ZWRBdDogQ1JFQVRFRF9BVF9BVFQsXG59O1xuXG5jb25zdCBVUERBVEVfUkVTVUxUX0ZJRUxEUyA9IHtcbiAgdXBkYXRlZEF0OiBVUERBVEVEX0FUX0FUVCxcbn07XG5cbmNvbnN0IFBBUlNFX09CSkVDVF9GSUVMRFMgPSB7XG4gIC4uLkNSRUFURV9SRVNVTFRfRklFTERTLFxuICAuLi5VUERBVEVfUkVTVUxUX0ZJRUxEUyxcbiAgLi4uSU5QVVRfRklFTERTLFxuICBBQ0w6IHtcbiAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoQUNMKSxcbiAgICByZXNvbHZlOiAoeyBBQ0wgfSkgPT4gKEFDTCA/IEFDTCA6IHsgJyonOiB7IHJlYWQ6IHRydWUsIHdyaXRlOiB0cnVlIH0gfSksXG4gIH0sXG59O1xuXG5jb25zdCBQQVJTRV9PQkpFQ1QgPSBuZXcgR3JhcGhRTEludGVyZmFjZVR5cGUoe1xuICBuYW1lOiAnUGFyc2VPYmplY3QnLFxuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhlIFBhcnNlT2JqZWN0IGludGVyZmFjZSB0eXBlIGlzIHVzZWQgYXMgYSBiYXNlIHR5cGUgZm9yIHRoZSBhdXRvIGdlbmVyYXRlZCBvYmplY3QgdHlwZXMuJyxcbiAgZmllbGRzOiBQQVJTRV9PQkpFQ1RfRklFTERTLFxufSk7XG5cbmNvbnN0IFNFU1NJT05fVE9LRU5fQVRUID0ge1xuICBkZXNjcmlwdGlvbjogJ1RoZSBjdXJyZW50IHVzZXIgc2Vzc2lvbiB0b2tlbi4nLFxuICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTFN0cmluZyksXG59O1xuXG5jb25zdCBSRUFEX1BSRUZFUkVOQ0UgPSBuZXcgR3JhcGhRTEVudW1UeXBlKHtcbiAgbmFtZTogJ1JlYWRQcmVmZXJlbmNlJyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ1RoZSBSZWFkUHJlZmVyZW5jZSBlbnVtIHR5cGUgaXMgdXNlZCBpbiBxdWVyaWVzIGluIG9yZGVyIHRvIHNlbGVjdCBpbiB3aGljaCBkYXRhYmFzZSByZXBsaWNhIHRoZSBvcGVyYXRpb24gbXVzdCBydW4uJyxcbiAgdmFsdWVzOiB7XG4gICAgUFJJTUFSWTogeyB2YWx1ZTogJ1BSSU1BUlknIH0sXG4gICAgUFJJTUFSWV9QUkVGRVJSRUQ6IHsgdmFsdWU6ICdQUklNQVJZX1BSRUZFUlJFRCcgfSxcbiAgICBTRUNPTkRBUlk6IHsgdmFsdWU6ICdTRUNPTkRBUlknIH0sXG4gICAgU0VDT05EQVJZX1BSRUZFUlJFRDogeyB2YWx1ZTogJ1NFQ09OREFSWV9QUkVGRVJSRUQnIH0sXG4gICAgTkVBUkVTVDogeyB2YWx1ZTogJ05FQVJFU1QnIH0sXG4gIH0sXG59KTtcblxuY29uc3QgUkVBRF9QUkVGRVJFTkNFX0FUVCA9IHtcbiAgZGVzY3JpcHRpb246ICdUaGUgcmVhZCBwcmVmZXJlbmNlIGZvciB0aGUgbWFpbiBxdWVyeSB0byBiZSBleGVjdXRlZC4nLFxuICB0eXBlOiBSRUFEX1BSRUZFUkVOQ0UsXG59O1xuXG5jb25zdCBJTkNMVURFX1JFQURfUFJFRkVSRU5DRV9BVFQgPSB7XG4gIGRlc2NyaXB0aW9uOiAnVGhlIHJlYWQgcHJlZmVyZW5jZSBmb3IgdGhlIHF1ZXJpZXMgdG8gYmUgZXhlY3V0ZWQgdG8gaW5jbHVkZSBmaWVsZHMuJyxcbiAgdHlwZTogUkVBRF9QUkVGRVJFTkNFLFxufTtcblxuY29uc3QgU1VCUVVFUllfUkVBRF9QUkVGRVJFTkNFX0FUVCA9IHtcbiAgZGVzY3JpcHRpb246ICdUaGUgcmVhZCBwcmVmZXJlbmNlIGZvciB0aGUgc3VicXVlcmllcyB0aGF0IG1heSBiZSByZXF1aXJlZC4nLFxuICB0eXBlOiBSRUFEX1BSRUZFUkVOQ0UsXG59O1xuXG5jb25zdCBSRUFEX09QVElPTlNfSU5QVVQgPSBuZXcgR3JhcGhRTElucHV0T2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdSZWFkT3B0aW9uc0lucHV0JyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ1RoZSBSZWFkT3B0aW9uc0lucHV0dCB0eXBlIGlzIHVzZWQgaW4gcXVlcmllcyBpbiBvcmRlciB0byBzZXQgdGhlIHJlYWQgcHJlZmVyZW5jZXMuJyxcbiAgZmllbGRzOiB7XG4gICAgcmVhZFByZWZlcmVuY2U6IFJFQURfUFJFRkVSRU5DRV9BVFQsXG4gICAgaW5jbHVkZVJlYWRQcmVmZXJlbmNlOiBJTkNMVURFX1JFQURfUFJFRkVSRU5DRV9BVFQsXG4gICAgc3VicXVlcnlSZWFkUHJlZmVyZW5jZTogU1VCUVVFUllfUkVBRF9QUkVGRVJFTkNFX0FUVCxcbiAgfSxcbn0pO1xuXG5jb25zdCBSRUFEX09QVElPTlNfQVRUID0ge1xuICBkZXNjcmlwdGlvbjogJ1RoZSByZWFkIG9wdGlvbnMgZm9yIHRoZSBxdWVyeSB0byBiZSBleGVjdXRlZC4nLFxuICB0eXBlOiBSRUFEX09QVElPTlNfSU5QVVQsXG59O1xuXG5jb25zdCBXSEVSRV9BVFQgPSB7XG4gIGRlc2NyaXB0aW9uOiAnVGhlc2UgYXJlIHRoZSBjb25kaXRpb25zIHRoYXQgdGhlIG9iamVjdHMgbmVlZCB0byBtYXRjaCBpbiBvcmRlciB0byBiZSBmb3VuZCcsXG4gIHR5cGU6IE9CSkVDVCxcbn07XG5cbmNvbnN0IFNLSVBfQVRUID0ge1xuICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlIG51bWJlciBvZiBvYmplY3RzIHRoYXQgbXVzdCBiZSBza2lwcGVkIHRvIHJldHVybi4nLFxuICB0eXBlOiBHcmFwaFFMSW50LFxufTtcblxuY29uc3QgTElNSVRfQVRUID0ge1xuICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlIGxpbWl0IG51bWJlciBvZiBvYmplY3RzIHRoYXQgbXVzdCBiZSByZXR1cm5lZC4nLFxuICB0eXBlOiBHcmFwaFFMSW50LFxufTtcblxuY29uc3QgQ09VTlRfQVRUID0ge1xuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhpcyBpcyB0aGUgdG90YWwgbWF0Y2hlZCBvYmplY3MgY291bnQgdGhhdCBpcyByZXR1cm5lZCB3aGVuIHRoZSBjb3VudCBmbGFnIGlzIHNldC4nLFxuICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTEludCksXG59O1xuXG5jb25zdCBTRUFSQ0hfSU5QVVQgPSBuZXcgR3JhcGhRTElucHV0T2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdTZWFyY2hJbnB1dCcsXG4gIGRlc2NyaXB0aW9uOiAnVGhlIFNlYXJjaElucHV0IHR5cGUgaXMgdXNlZCB0byBzcGVjaWZpeSBhIHNlYXJjaCBvcGVyYXRpb24gb24gYSBmdWxsIHRleHQgc2VhcmNoLicsXG4gIGZpZWxkczoge1xuICAgIHRlcm06IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnVGhpcyBpcyB0aGUgdGVybSB0byBiZSBzZWFyY2hlZC4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKEdyYXBoUUxTdHJpbmcpLFxuICAgIH0sXG4gICAgbGFuZ3VhZ2U6IHtcbiAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICAnVGhpcyBpcyB0aGUgbGFuZ3VhZ2UgdG8gdGV0ZXJtaW5lIHRoZSBsaXN0IG9mIHN0b3Agd29yZHMgYW5kIHRoZSBydWxlcyBmb3IgdG9rZW5pemVyLicsXG4gICAgICB0eXBlOiBHcmFwaFFMU3RyaW5nLFxuICAgIH0sXG4gICAgY2FzZVNlbnNpdGl2ZToge1xuICAgICAgZGVzY3JpcHRpb246ICdUaGlzIGlzIHRoZSBmbGFnIHRvIGVuYWJsZSBvciBkaXNhYmxlIGNhc2Ugc2Vuc2l0aXZlIHNlYXJjaC4nLFxuICAgICAgdHlwZTogR3JhcGhRTEJvb2xlYW4sXG4gICAgfSxcbiAgICBkaWFjcml0aWNTZW5zaXRpdmU6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnVGhpcyBpcyB0aGUgZmxhZyB0byBlbmFibGUgb3IgZGlzYWJsZSBkaWFjcml0aWMgc2Vuc2l0aXZlIHNlYXJjaC4nLFxuICAgICAgdHlwZTogR3JhcGhRTEJvb2xlYW4sXG4gICAgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCBURVhUX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnVGV4dElucHV0JyxcbiAgZGVzY3JpcHRpb246ICdUaGUgVGV4dElucHV0IHR5cGUgaXMgdXNlZCB0byBzcGVjaWZ5IGEgdGV4dCBvcGVyYXRpb24gb24gYSBjb25zdHJhaW50LicsXG4gIGZpZWxkczoge1xuICAgIHNlYXJjaDoge1xuICAgICAgZGVzY3JpcHRpb246ICdUaGlzIGlzIHRoZSBzZWFyY2ggdG8gYmUgZXhlY3V0ZWQuJyxcbiAgICAgIHR5cGU6IG5ldyBHcmFwaFFMTm9uTnVsbChTRUFSQ0hfSU5QVVQpLFxuICAgIH0sXG4gIH0sXG59KTtcblxuY29uc3QgQk9YX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnQm94SW5wdXQnLFxuICBkZXNjcmlwdGlvbjogJ1RoZSBCb3hJbnB1dCB0eXBlIGlzIHVzZWQgdG8gc3BlY2lmaXkgYSBib3ggb3BlcmF0aW9uIG9uIGEgd2l0aGluIGdlbyBxdWVyeS4nLFxuICBmaWVsZHM6IHtcbiAgICBib3R0b21MZWZ0OiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlIGJvdHRvbSBsZWZ0IGNvb3JkaW5hdGVzIG9mIHRoZSBib3guJyxcbiAgICAgIHR5cGU6IG5ldyBHcmFwaFFMTm9uTnVsbChHRU9fUE9JTlRfSU5QVVQpLFxuICAgIH0sXG4gICAgdXBwZXJSaWdodDoge1xuICAgICAgZGVzY3JpcHRpb246ICdUaGlzIGlzIHRoZSB1cHBlciByaWdodCBjb29yZGluYXRlcyBvZiB0aGUgYm94LicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR0VPX1BPSU5UX0lOUFVUKSxcbiAgICB9LFxuICB9LFxufSk7XG5cbmNvbnN0IFdJVEhJTl9JTlBVVCA9IG5ldyBHcmFwaFFMSW5wdXRPYmplY3RUeXBlKHtcbiAgbmFtZTogJ1dpdGhpbklucHV0JyxcbiAgZGVzY3JpcHRpb246ICdUaGUgV2l0aGluSW5wdXQgdHlwZSBpcyB1c2VkIHRvIHNwZWNpZnkgYSB3aXRoaW4gb3BlcmF0aW9uIG9uIGEgY29uc3RyYWludC4nLFxuICBmaWVsZHM6IHtcbiAgICBib3g6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnVGhpcyBpcyB0aGUgYm94IHRvIGJlIHNwZWNpZmllZC4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKEJPWF9JTlBVVCksXG4gICAgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCBDRU5URVJfU1BIRVJFX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnQ2VudGVyU3BoZXJlSW5wdXQnLFxuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhlIENlbnRlclNwaGVyZUlucHV0IHR5cGUgaXMgdXNlZCB0byBzcGVjaWZpeSBhIGNlbnRlclNwaGVyZSBvcGVyYXRpb24gb24gYSBnZW9XaXRoaW4gcXVlcnkuJyxcbiAgZmllbGRzOiB7XG4gICAgY2VudGVyOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlIGNlbnRlciBvZiB0aGUgc3BoZXJlLicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR0VPX1BPSU5UX0lOUFVUKSxcbiAgICB9LFxuICAgIGRpc3RhbmNlOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlIHJhZGl1cyBvZiB0aGUgc3BoZXJlLicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTEZsb2F0KSxcbiAgICB9LFxuICB9LFxufSk7XG5cbmNvbnN0IEdFT19XSVRISU5fSU5QVVQgPSBuZXcgR3JhcGhRTElucHV0T2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdHZW9XaXRoaW5JbnB1dCcsXG4gIGRlc2NyaXB0aW9uOiAnVGhlIEdlb1dpdGhpbklucHV0IHR5cGUgaXMgdXNlZCB0byBzcGVjaWZ5IGEgZ2VvV2l0aGluIG9wZXJhdGlvbiBvbiBhIGNvbnN0cmFpbnQuJyxcbiAgZmllbGRzOiB7XG4gICAgcG9seWdvbjoge1xuICAgICAgZGVzY3JpcHRpb246ICdUaGlzIGlzIHRoZSBwb2x5Z29uIHRvIGJlIHNwZWNpZmllZC4nLFxuICAgICAgdHlwZTogUE9MWUdPTl9JTlBVVCxcbiAgICB9LFxuICAgIGNlbnRlclNwaGVyZToge1xuICAgICAgZGVzY3JpcHRpb246ICdUaGlzIGlzIHRoZSBzcGhlcmUgdG8gYmUgc3BlY2lmaWVkLicsXG4gICAgICB0eXBlOiBDRU5URVJfU1BIRVJFX0lOUFVULFxuICAgIH0sXG4gIH0sXG59KTtcblxuY29uc3QgR0VPX0lOVEVSU0VDVFNfSU5QVVQgPSBuZXcgR3JhcGhRTElucHV0T2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdHZW9JbnRlcnNlY3RzSW5wdXQnLFxuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhlIEdlb0ludGVyc2VjdHNJbnB1dCB0eXBlIGlzIHVzZWQgdG8gc3BlY2lmeSBhIGdlb0ludGVyc2VjdHMgb3BlcmF0aW9uIG9uIGEgY29uc3RyYWludC4nLFxuICBmaWVsZHM6IHtcbiAgICBwb2ludDoge1xuICAgICAgZGVzY3JpcHRpb246ICdUaGlzIGlzIHRoZSBwb2ludCB0byBiZSBzcGVjaWZpZWQuJyxcbiAgICAgIHR5cGU6IEdFT19QT0lOVF9JTlBVVCxcbiAgICB9LFxuICB9LFxufSk7XG5cbmNvbnN0IGVxdWFsVG8gPSB0eXBlID0+ICh7XG4gIGRlc2NyaXB0aW9uOlxuICAgICdUaGlzIGlzIHRoZSBlcXVhbFRvIG9wZXJhdG9yIHRvIHNwZWNpZnkgYSBjb25zdHJhaW50IHRvIHNlbGVjdCB0aGUgb2JqZWN0cyB3aGVyZSB0aGUgdmFsdWUgb2YgYSBmaWVsZCBlcXVhbHMgdG8gYSBzcGVjaWZpZWQgdmFsdWUuJyxcbiAgdHlwZSxcbn0pO1xuXG5jb25zdCBub3RFcXVhbFRvID0gdHlwZSA9PiAoe1xuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhpcyBpcyB0aGUgbm90RXF1YWxUbyBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlIG9mIGEgZmllbGQgZG8gbm90IGVxdWFsIHRvIGEgc3BlY2lmaWVkIHZhbHVlLicsXG4gIHR5cGUsXG59KTtcblxuY29uc3QgbGVzc1RoYW4gPSB0eXBlID0+ICh7XG4gIGRlc2NyaXB0aW9uOlxuICAgICdUaGlzIGlzIHRoZSBsZXNzVGhhbiBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlIG9mIGEgZmllbGQgaXMgbGVzcyB0aGFuIGEgc3BlY2lmaWVkIHZhbHVlLicsXG4gIHR5cGUsXG59KTtcblxuY29uc3QgbGVzc1RoYW5PckVxdWFsVG8gPSB0eXBlID0+ICh7XG4gIGRlc2NyaXB0aW9uOlxuICAgICdUaGlzIGlzIHRoZSBsZXNzVGhhbk9yRXF1YWxUbyBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlIG9mIGEgZmllbGQgaXMgbGVzcyB0aGFuIG9yIGVxdWFsIHRvIGEgc3BlY2lmaWVkIHZhbHVlLicsXG4gIHR5cGUsXG59KTtcblxuY29uc3QgZ3JlYXRlclRoYW4gPSB0eXBlID0+ICh7XG4gIGRlc2NyaXB0aW9uOlxuICAgICdUaGlzIGlzIHRoZSBncmVhdGVyVGhhbiBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlIG9mIGEgZmllbGQgaXMgZ3JlYXRlciB0aGFuIGEgc3BlY2lmaWVkIHZhbHVlLicsXG4gIHR5cGUsXG59KTtcblxuY29uc3QgZ3JlYXRlclRoYW5PckVxdWFsVG8gPSB0eXBlID0+ICh7XG4gIGRlc2NyaXB0aW9uOlxuICAgICdUaGlzIGlzIHRoZSBncmVhdGVyVGhhbk9yRXF1YWxUbyBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlIG9mIGEgZmllbGQgaXMgZ3JlYXRlciB0aGFuIG9yIGVxdWFsIHRvIGEgc3BlY2lmaWVkIHZhbHVlLicsXG4gIHR5cGUsXG59KTtcblxuY29uc3QgaW5PcCA9IHR5cGUgPT4gKHtcbiAgZGVzY3JpcHRpb246XG4gICAgJ1RoaXMgaXMgdGhlIGluIG9wZXJhdG9yIHRvIHNwZWNpZnkgYSBjb25zdHJhaW50IHRvIHNlbGVjdCB0aGUgb2JqZWN0cyB3aGVyZSB0aGUgdmFsdWUgb2YgYSBmaWVsZCBlcXVhbHMgYW55IHZhbHVlIGluIHRoZSBzcGVjaWZpZWQgYXJyYXkuJyxcbiAgdHlwZTogbmV3IEdyYXBoUUxMaXN0KHR5cGUpLFxufSk7XG5cbmNvbnN0IG5vdEluID0gdHlwZSA9PiAoe1xuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhpcyBpcyB0aGUgbm90SW4gb3BlcmF0b3IgdG8gc3BlY2lmeSBhIGNvbnN0cmFpbnQgdG8gc2VsZWN0IHRoZSBvYmplY3RzIHdoZXJlIHRoZSB2YWx1ZSBvZiBhIGZpZWxkIGRvIG5vdCBlcXVhbCBhbnkgdmFsdWUgaW4gdGhlIHNwZWNpZmllZCBhcnJheS4nLFxuICB0eXBlOiBuZXcgR3JhcGhRTExpc3QodHlwZSksXG59KTtcblxuY29uc3QgZXhpc3RzID0ge1xuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhpcyBpcyB0aGUgZXhpc3RzIG9wZXJhdG9yIHRvIHNwZWNpZnkgYSBjb25zdHJhaW50IHRvIHNlbGVjdCB0aGUgb2JqZWN0cyB3aGVyZSBhIGZpZWxkIGV4aXN0cyAob3IgZG8gbm90IGV4aXN0KS4nLFxuICB0eXBlOiBHcmFwaFFMQm9vbGVhbixcbn07XG5cbmNvbnN0IG1hdGNoZXNSZWdleCA9IHtcbiAgZGVzY3JpcHRpb246XG4gICAgJ1RoaXMgaXMgdGhlIG1hdGNoZXNSZWdleCBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlIG9mIGEgZmllbGQgbWF0Y2hlcyBhIHNwZWNpZmllZCByZWd1bGFyIGV4cHJlc3Npb24uJyxcbiAgdHlwZTogR3JhcGhRTFN0cmluZyxcbn07XG5cbmNvbnN0IG9wdGlvbnMgPSB7XG4gIGRlc2NyaXB0aW9uOlxuICAgICdUaGlzIGlzIHRoZSBvcHRpb25zIG9wZXJhdG9yIHRvIHNwZWNpZnkgb3B0aW9uYWwgZmxhZ3MgKHN1Y2ggYXMgXCJpXCIgYW5kIFwibVwiKSB0byBiZSBhZGRlZCB0byBhIG1hdGNoZXNSZWdleCBvcGVyYXRpb24gaW4gdGhlIHNhbWUgc2V0IG9mIGNvbnN0cmFpbnRzLicsXG4gIHR5cGU6IEdyYXBoUUxTdHJpbmcsXG59O1xuXG5jb25zdCBTVUJRVUVSWV9JTlBVVCA9IG5ldyBHcmFwaFFMSW5wdXRPYmplY3RUeXBlKHtcbiAgbmFtZTogJ1N1YnF1ZXJ5SW5wdXQnLFxuICBkZXNjcmlwdGlvbjogJ1RoZSBTdWJxdWVyeUlucHV0IHR5cGUgaXMgdXNlZCB0byBzcGVjaWZ5IGEgc3ViIHF1ZXJ5IHRvIGFub3RoZXIgY2xhc3MuJyxcbiAgZmllbGRzOiB7XG4gICAgY2xhc3NOYW1lOiBDTEFTU19OQU1FX0FUVCxcbiAgICB3aGVyZTogT2JqZWN0LmFzc2lnbih7fSwgV0hFUkVfQVRULCB7XG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoV0hFUkVfQVRULnR5cGUpLFxuICAgIH0pLFxuICB9LFxufSk7XG5cbmNvbnN0IFNFTEVDVF9JTlBVVCA9IG5ldyBHcmFwaFFMSW5wdXRPYmplY3RUeXBlKHtcbiAgbmFtZTogJ1NlbGVjdElucHV0JyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ1RoZSBTZWxlY3RJbnB1dCB0eXBlIGlzIHVzZWQgdG8gc3BlY2lmeSBhbiBpblF1ZXJ5S2V5IG9yIGEgbm90SW5RdWVyeUtleSBvcGVyYXRpb24gb24gYSBjb25zdHJhaW50LicsXG4gIGZpZWxkczoge1xuICAgIHF1ZXJ5OiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlIHN1YnF1ZXJ5IHRvIGJlIGV4ZWN1dGVkLicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoU1VCUVVFUllfSU5QVVQpLFxuICAgIH0sXG4gICAga2V5OiB7XG4gICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgJ1RoaXMgaXMgdGhlIGtleSBpbiB0aGUgcmVzdWx0IG9mIHRoZSBzdWJxdWVyeSB0aGF0IG11c3QgbWF0Y2ggKG5vdCBtYXRjaCkgdGhlIGZpZWxkLicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoR3JhcGhRTFN0cmluZyksXG4gICAgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCBpblF1ZXJ5S2V5ID0ge1xuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhpcyBpcyB0aGUgaW5RdWVyeUtleSBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgYSBmaWVsZCBlcXVhbHMgdG8gYSBrZXkgaW4gdGhlIHJlc3VsdCBvZiBhIGRpZmZlcmVudCBxdWVyeS4nLFxuICB0eXBlOiBTRUxFQ1RfSU5QVVQsXG59O1xuXG5jb25zdCBub3RJblF1ZXJ5S2V5ID0ge1xuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhpcyBpcyB0aGUgbm90SW5RdWVyeUtleSBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgYSBmaWVsZCBkbyBub3QgZXF1YWwgdG8gYSBrZXkgaW4gdGhlIHJlc3VsdCBvZiBhIGRpZmZlcmVudCBxdWVyeS4nLFxuICB0eXBlOiBTRUxFQ1RfSU5QVVQsXG59O1xuXG5jb25zdCBJRF9XSEVSRV9JTlBVVCA9IG5ldyBHcmFwaFFMSW5wdXRPYmplY3RUeXBlKHtcbiAgbmFtZTogJ0lkV2hlcmVJbnB1dCcsXG4gIGRlc2NyaXB0aW9uOlxuICAgICdUaGUgSWRXaGVyZUlucHV0IGlucHV0IHR5cGUgaXMgdXNlZCBpbiBvcGVyYXRpb25zIHRoYXQgaW52b2x2ZSBmaWx0ZXJpbmcgb2JqZWN0cyBieSBhbiBpZC4nLFxuICBmaWVsZHM6IHtcbiAgICBlcXVhbFRvOiBlcXVhbFRvKEdyYXBoUUxJRCksXG4gICAgbm90RXF1YWxUbzogbm90RXF1YWxUbyhHcmFwaFFMSUQpLFxuICAgIGxlc3NUaGFuOiBsZXNzVGhhbihHcmFwaFFMSUQpLFxuICAgIGxlc3NUaGFuT3JFcXVhbFRvOiBsZXNzVGhhbk9yRXF1YWxUbyhHcmFwaFFMSUQpLFxuICAgIGdyZWF0ZXJUaGFuOiBncmVhdGVyVGhhbihHcmFwaFFMSUQpLFxuICAgIGdyZWF0ZXJUaGFuT3JFcXVhbFRvOiBncmVhdGVyVGhhbk9yRXF1YWxUbyhHcmFwaFFMSUQpLFxuICAgIGluOiBpbk9wKEdyYXBoUUxJRCksXG4gICAgbm90SW46IG5vdEluKEdyYXBoUUxJRCksXG4gICAgZXhpc3RzLFxuICAgIGluUXVlcnlLZXksXG4gICAgbm90SW5RdWVyeUtleSxcbiAgfSxcbn0pO1xuXG5jb25zdCBTVFJJTkdfV0hFUkVfSU5QVVQgPSBuZXcgR3JhcGhRTElucHV0T2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdTdHJpbmdXaGVyZUlucHV0JyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ1RoZSBTdHJpbmdXaGVyZUlucHV0IGlucHV0IHR5cGUgaXMgdXNlZCBpbiBvcGVyYXRpb25zIHRoYXQgaW52b2x2ZSBmaWx0ZXJpbmcgb2JqZWN0cyBieSBhIGZpZWxkIG9mIHR5cGUgU3RyaW5nLicsXG4gIGZpZWxkczoge1xuICAgIGVxdWFsVG86IGVxdWFsVG8oR3JhcGhRTFN0cmluZyksXG4gICAgbm90RXF1YWxUbzogbm90RXF1YWxUbyhHcmFwaFFMU3RyaW5nKSxcbiAgICBsZXNzVGhhbjogbGVzc1RoYW4oR3JhcGhRTFN0cmluZyksXG4gICAgbGVzc1RoYW5PckVxdWFsVG86IGxlc3NUaGFuT3JFcXVhbFRvKEdyYXBoUUxTdHJpbmcpLFxuICAgIGdyZWF0ZXJUaGFuOiBncmVhdGVyVGhhbihHcmFwaFFMU3RyaW5nKSxcbiAgICBncmVhdGVyVGhhbk9yRXF1YWxUbzogZ3JlYXRlclRoYW5PckVxdWFsVG8oR3JhcGhRTFN0cmluZyksXG4gICAgaW46IGluT3AoR3JhcGhRTFN0cmluZyksXG4gICAgbm90SW46IG5vdEluKEdyYXBoUUxTdHJpbmcpLFxuICAgIGV4aXN0cyxcbiAgICBtYXRjaGVzUmVnZXgsXG4gICAgb3B0aW9ucyxcbiAgICB0ZXh0OiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1RoaXMgaXMgdGhlICR0ZXh0IG9wZXJhdG9yIHRvIHNwZWNpZnkgYSBmdWxsIHRleHQgc2VhcmNoIGNvbnN0cmFpbnQuJyxcbiAgICAgIHR5cGU6IFRFWFRfSU5QVVQsXG4gICAgfSxcbiAgICBpblF1ZXJ5S2V5LFxuICAgIG5vdEluUXVlcnlLZXksXG4gIH0sXG59KTtcblxuY29uc3QgTlVNQkVSX1dIRVJFX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnTnVtYmVyV2hlcmVJbnB1dCcsXG4gIGRlc2NyaXB0aW9uOlxuICAgICdUaGUgTnVtYmVyV2hlcmVJbnB1dCBpbnB1dCB0eXBlIGlzIHVzZWQgaW4gb3BlcmF0aW9ucyB0aGF0IGludm9sdmUgZmlsdGVyaW5nIG9iamVjdHMgYnkgYSBmaWVsZCBvZiB0eXBlIE51bWJlci4nLFxuICBmaWVsZHM6IHtcbiAgICBlcXVhbFRvOiBlcXVhbFRvKEdyYXBoUUxGbG9hdCksXG4gICAgbm90RXF1YWxUbzogbm90RXF1YWxUbyhHcmFwaFFMRmxvYXQpLFxuICAgIGxlc3NUaGFuOiBsZXNzVGhhbihHcmFwaFFMRmxvYXQpLFxuICAgIGxlc3NUaGFuT3JFcXVhbFRvOiBsZXNzVGhhbk9yRXF1YWxUbyhHcmFwaFFMRmxvYXQpLFxuICAgIGdyZWF0ZXJUaGFuOiBncmVhdGVyVGhhbihHcmFwaFFMRmxvYXQpLFxuICAgIGdyZWF0ZXJUaGFuT3JFcXVhbFRvOiBncmVhdGVyVGhhbk9yRXF1YWxUbyhHcmFwaFFMRmxvYXQpLFxuICAgIGluOiBpbk9wKEdyYXBoUUxGbG9hdCksXG4gICAgbm90SW46IG5vdEluKEdyYXBoUUxGbG9hdCksXG4gICAgZXhpc3RzLFxuICAgIGluUXVlcnlLZXksXG4gICAgbm90SW5RdWVyeUtleSxcbiAgfSxcbn0pO1xuXG5jb25zdCBCT09MRUFOX1dIRVJFX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnQm9vbGVhbldoZXJlSW5wdXQnLFxuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhlIEJvb2xlYW5XaGVyZUlucHV0IGlucHV0IHR5cGUgaXMgdXNlZCBpbiBvcGVyYXRpb25zIHRoYXQgaW52b2x2ZSBmaWx0ZXJpbmcgb2JqZWN0cyBieSBhIGZpZWxkIG9mIHR5cGUgQm9vbGVhbi4nLFxuICBmaWVsZHM6IHtcbiAgICBlcXVhbFRvOiBlcXVhbFRvKEdyYXBoUUxCb29sZWFuKSxcbiAgICBub3RFcXVhbFRvOiBub3RFcXVhbFRvKEdyYXBoUUxCb29sZWFuKSxcbiAgICBleGlzdHMsXG4gICAgaW5RdWVyeUtleSxcbiAgICBub3RJblF1ZXJ5S2V5LFxuICB9LFxufSk7XG5cbmNvbnN0IEFSUkFZX1dIRVJFX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnQXJyYXlXaGVyZUlucHV0JyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ1RoZSBBcnJheVdoZXJlSW5wdXQgaW5wdXQgdHlwZSBpcyB1c2VkIGluIG9wZXJhdGlvbnMgdGhhdCBpbnZvbHZlIGZpbHRlcmluZyBvYmplY3RzIGJ5IGEgZmllbGQgb2YgdHlwZSBBcnJheS4nLFxuICBmaWVsZHM6IHtcbiAgICBlcXVhbFRvOiBlcXVhbFRvKEFOWSksXG4gICAgbm90RXF1YWxUbzogbm90RXF1YWxUbyhBTlkpLFxuICAgIGxlc3NUaGFuOiBsZXNzVGhhbihBTlkpLFxuICAgIGxlc3NUaGFuT3JFcXVhbFRvOiBsZXNzVGhhbk9yRXF1YWxUbyhBTlkpLFxuICAgIGdyZWF0ZXJUaGFuOiBncmVhdGVyVGhhbihBTlkpLFxuICAgIGdyZWF0ZXJUaGFuT3JFcXVhbFRvOiBncmVhdGVyVGhhbk9yRXF1YWxUbyhBTlkpLFxuICAgIGluOiBpbk9wKEFOWSksXG4gICAgbm90SW46IG5vdEluKEFOWSksXG4gICAgZXhpc3RzLFxuICAgIGNvbnRhaW5lZEJ5OiB7XG4gICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgJ1RoaXMgaXMgdGhlIGNvbnRhaW5lZEJ5IG9wZXJhdG9yIHRvIHNwZWNpZnkgYSBjb25zdHJhaW50IHRvIHNlbGVjdCB0aGUgb2JqZWN0cyB3aGVyZSB0aGUgdmFsdWVzIG9mIGFuIGFycmF5IGZpZWxkIGlzIGNvbnRhaW5lZCBieSBhbm90aGVyIHNwZWNpZmllZCBhcnJheS4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxMaXN0KEFOWSksXG4gICAgfSxcbiAgICBjb250YWluczoge1xuICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICdUaGlzIGlzIHRoZSBjb250YWlucyBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlcyBvZiBhbiBhcnJheSBmaWVsZCBjb250YWluIGFsbCBlbGVtZW50cyBvZiBhbm90aGVyIHNwZWNpZmllZCBhcnJheS4nLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxMaXN0KEFOWSksXG4gICAgfSxcbiAgICBpblF1ZXJ5S2V5LFxuICAgIG5vdEluUXVlcnlLZXksXG4gIH0sXG59KTtcblxuY29uc3QgS0VZX1ZBTFVFX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnS2V5VmFsdWVJbnB1dCcsXG4gIGRlc2NyaXB0aW9uOiAnQW4gZW50cnkgZnJvbSBhbiBvYmplY3QsIGkuZS4sIGEgcGFpciBvZiBrZXkgYW5kIHZhbHVlLicsXG4gIGZpZWxkczoge1xuICAgIGtleToge1xuICAgICAgZGVzY3JpcHRpb246ICdUaGUga2V5IHVzZWQgdG8gcmV0cmlldmUgdGhlIHZhbHVlIG9mIHRoaXMgZW50cnkuJyxcbiAgICAgIHR5cGU6IG5ldyBHcmFwaFFMTm9uTnVsbChHcmFwaFFMU3RyaW5nKSxcbiAgICB9LFxuICAgIHZhbHVlOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1RoZSB2YWx1ZSBvZiB0aGUgZW50cnkuIENvdWxkIGJlIGFueSB0eXBlIG9mIHNjYWxhciBkYXRhLicsXG4gICAgICB0eXBlOiBuZXcgR3JhcGhRTE5vbk51bGwoQU5ZKSxcbiAgICB9LFxuICB9LFxufSk7XG5cbmNvbnN0IE9CSkVDVF9XSEVSRV9JTlBVVCA9IG5ldyBHcmFwaFFMSW5wdXRPYmplY3RUeXBlKHtcbiAgbmFtZTogJ09iamVjdFdoZXJlSW5wdXQnLFxuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhlIE9iamVjdFdoZXJlSW5wdXQgaW5wdXQgdHlwZSBpcyB1c2VkIGluIG9wZXJhdGlvbnMgdGhhdCBpbnZvbHZlIGZpbHRlcmluZyByZXN1bHQgYnkgYSBmaWVsZCBvZiB0eXBlIE9iamVjdC4nLFxuICBmaWVsZHM6IHtcbiAgICBlcXVhbFRvOiBlcXVhbFRvKEtFWV9WQUxVRV9JTlBVVCksXG4gICAgbm90RXF1YWxUbzogbm90RXF1YWxUbyhLRVlfVkFMVUVfSU5QVVQpLFxuICAgIGluOiBpbk9wKEtFWV9WQUxVRV9JTlBVVCksXG4gICAgbm90SW46IG5vdEluKEtFWV9WQUxVRV9JTlBVVCksXG4gICAgbGVzc1RoYW46IGxlc3NUaGFuKEtFWV9WQUxVRV9JTlBVVCksXG4gICAgbGVzc1RoYW5PckVxdWFsVG86IGxlc3NUaGFuT3JFcXVhbFRvKEtFWV9WQUxVRV9JTlBVVCksXG4gICAgZ3JlYXRlclRoYW46IGdyZWF0ZXJUaGFuKEtFWV9WQUxVRV9JTlBVVCksXG4gICAgZ3JlYXRlclRoYW5PckVxdWFsVG86IGdyZWF0ZXJUaGFuT3JFcXVhbFRvKEtFWV9WQUxVRV9JTlBVVCksXG4gICAgZXhpc3RzLFxuICAgIGluUXVlcnlLZXksXG4gICAgbm90SW5RdWVyeUtleSxcbiAgfSxcbn0pO1xuXG5jb25zdCBEQVRFX1dIRVJFX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnRGF0ZVdoZXJlSW5wdXQnLFxuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhlIERhdGVXaGVyZUlucHV0IGlucHV0IHR5cGUgaXMgdXNlZCBpbiBvcGVyYXRpb25zIHRoYXQgaW52b2x2ZSBmaWx0ZXJpbmcgb2JqZWN0cyBieSBhIGZpZWxkIG9mIHR5cGUgRGF0ZS4nLFxuICBmaWVsZHM6IHtcbiAgICBlcXVhbFRvOiBlcXVhbFRvKERBVEUpLFxuICAgIG5vdEVxdWFsVG86IG5vdEVxdWFsVG8oREFURSksXG4gICAgbGVzc1RoYW46IGxlc3NUaGFuKERBVEUpLFxuICAgIGxlc3NUaGFuT3JFcXVhbFRvOiBsZXNzVGhhbk9yRXF1YWxUbyhEQVRFKSxcbiAgICBncmVhdGVyVGhhbjogZ3JlYXRlclRoYW4oREFURSksXG4gICAgZ3JlYXRlclRoYW5PckVxdWFsVG86IGdyZWF0ZXJUaGFuT3JFcXVhbFRvKERBVEUpLFxuICAgIGluOiBpbk9wKERBVEUpLFxuICAgIG5vdEluOiBub3RJbihEQVRFKSxcbiAgICBleGlzdHMsXG4gICAgaW5RdWVyeUtleSxcbiAgICBub3RJblF1ZXJ5S2V5LFxuICB9LFxufSk7XG5cbmNvbnN0IEJZVEVTX1dIRVJFX0lOUFVUID0gbmV3IEdyYXBoUUxJbnB1dE9iamVjdFR5cGUoe1xuICBuYW1lOiAnQnl0ZXNXaGVyZUlucHV0JyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ1RoZSBCeXRlc1doZXJlSW5wdXQgaW5wdXQgdHlwZSBpcyB1c2VkIGluIG9wZXJhdGlvbnMgdGhhdCBpbnZvbHZlIGZpbHRlcmluZyBvYmplY3RzIGJ5IGEgZmllbGQgb2YgdHlwZSBCeXRlcy4nLFxuICBmaWVsZHM6IHtcbiAgICBlcXVhbFRvOiBlcXVhbFRvKEJZVEVTKSxcbiAgICBub3RFcXVhbFRvOiBub3RFcXVhbFRvKEJZVEVTKSxcbiAgICBsZXNzVGhhbjogbGVzc1RoYW4oQllURVMpLFxuICAgIGxlc3NUaGFuT3JFcXVhbFRvOiBsZXNzVGhhbk9yRXF1YWxUbyhCWVRFUyksXG4gICAgZ3JlYXRlclRoYW46IGdyZWF0ZXJUaGFuKEJZVEVTKSxcbiAgICBncmVhdGVyVGhhbk9yRXF1YWxUbzogZ3JlYXRlclRoYW5PckVxdWFsVG8oQllURVMpLFxuICAgIGluOiBpbk9wKEJZVEVTKSxcbiAgICBub3RJbjogbm90SW4oQllURVMpLFxuICAgIGV4aXN0cyxcbiAgICBpblF1ZXJ5S2V5LFxuICAgIG5vdEluUXVlcnlLZXksXG4gIH0sXG59KTtcblxuY29uc3QgRklMRV9XSEVSRV9JTlBVVCA9IG5ldyBHcmFwaFFMSW5wdXRPYmplY3RUeXBlKHtcbiAgbmFtZTogJ0ZpbGVXaGVyZUlucHV0JyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ1RoZSBGaWxlV2hlcmVJbnB1dCBpbnB1dCB0eXBlIGlzIHVzZWQgaW4gb3BlcmF0aW9ucyB0aGF0IGludm9sdmUgZmlsdGVyaW5nIG9iamVjdHMgYnkgYSBmaWVsZCBvZiB0eXBlIEZpbGUuJyxcbiAgZmllbGRzOiB7XG4gICAgZXF1YWxUbzogZXF1YWxUbyhGSUxFKSxcbiAgICBub3RFcXVhbFRvOiBub3RFcXVhbFRvKEZJTEUpLFxuICAgIGxlc3NUaGFuOiBsZXNzVGhhbihGSUxFKSxcbiAgICBsZXNzVGhhbk9yRXF1YWxUbzogbGVzc1RoYW5PckVxdWFsVG8oRklMRSksXG4gICAgZ3JlYXRlclRoYW46IGdyZWF0ZXJUaGFuKEZJTEUpLFxuICAgIGdyZWF0ZXJUaGFuT3JFcXVhbFRvOiBncmVhdGVyVGhhbk9yRXF1YWxUbyhGSUxFKSxcbiAgICBpbjogaW5PcChGSUxFKSxcbiAgICBub3RJbjogbm90SW4oRklMRSksXG4gICAgZXhpc3RzLFxuICAgIG1hdGNoZXNSZWdleCxcbiAgICBvcHRpb25zLFxuICAgIGluUXVlcnlLZXksXG4gICAgbm90SW5RdWVyeUtleSxcbiAgfSxcbn0pO1xuXG5jb25zdCBHRU9fUE9JTlRfV0hFUkVfSU5QVVQgPSBuZXcgR3JhcGhRTElucHV0T2JqZWN0VHlwZSh7XG4gIG5hbWU6ICdHZW9Qb2ludFdoZXJlSW5wdXQnLFxuICBkZXNjcmlwdGlvbjpcbiAgICAnVGhlIEdlb1BvaW50V2hlcmVJbnB1dCBpbnB1dCB0eXBlIGlzIHVzZWQgaW4gb3BlcmF0aW9ucyB0aGF0IGludm9sdmUgZmlsdGVyaW5nIG9iamVjdHMgYnkgYSBmaWVsZCBvZiB0eXBlIEdlb1BvaW50LicsXG4gIGZpZWxkczoge1xuICAgIGV4aXN0cyxcbiAgICBuZWFyU3BoZXJlOiB7XG4gICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgJ1RoaXMgaXMgdGhlIG5lYXJTcGhlcmUgb3BlcmF0b3IgdG8gc3BlY2lmeSBhIGNvbnN0cmFpbnQgdG8gc2VsZWN0IHRoZSBvYmplY3RzIHdoZXJlIHRoZSB2YWx1ZXMgb2YgYSBnZW8gcG9pbnQgZmllbGQgaXMgbmVhciB0byBhbm90aGVyIGdlbyBwb2ludC4nLFxuICAgICAgdHlwZTogR0VPX1BPSU5UX0lOUFVULFxuICAgIH0sXG4gICAgbWF4RGlzdGFuY2U6IHtcbiAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICAnVGhpcyBpcyB0aGUgbWF4RGlzdGFuY2Ugb3BlcmF0b3IgdG8gc3BlY2lmeSBhIGNvbnN0cmFpbnQgdG8gc2VsZWN0IHRoZSBvYmplY3RzIHdoZXJlIHRoZSB2YWx1ZXMgb2YgYSBnZW8gcG9pbnQgZmllbGQgaXMgYXQgYSBtYXggZGlzdGFuY2UgKGluIHJhZGlhbnMpIGZyb20gdGhlIGdlbyBwb2ludCBzcGVjaWZpZWQgaW4gdGhlICRuZWFyU3BoZXJlIG9wZXJhdG9yLicsXG4gICAgICB0eXBlOiBHcmFwaFFMRmxvYXQsXG4gICAgfSxcbiAgICBtYXhEaXN0YW5jZUluUmFkaWFuczoge1xuICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICdUaGlzIGlzIHRoZSBtYXhEaXN0YW5jZUluUmFkaWFucyBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlcyBvZiBhIGdlbyBwb2ludCBmaWVsZCBpcyBhdCBhIG1heCBkaXN0YW5jZSAoaW4gcmFkaWFucykgZnJvbSB0aGUgZ2VvIHBvaW50IHNwZWNpZmllZCBpbiB0aGUgJG5lYXJTcGhlcmUgb3BlcmF0b3IuJyxcbiAgICAgIHR5cGU6IEdyYXBoUUxGbG9hdCxcbiAgICB9LFxuICAgIG1heERpc3RhbmNlSW5NaWxlczoge1xuICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICdUaGlzIGlzIHRoZSBtYXhEaXN0YW5jZUluTWlsZXMgb3BlcmF0b3IgdG8gc3BlY2lmeSBhIGNvbnN0cmFpbnQgdG8gc2VsZWN0IHRoZSBvYmplY3RzIHdoZXJlIHRoZSB2YWx1ZXMgb2YgYSBnZW8gcG9pbnQgZmllbGQgaXMgYXQgYSBtYXggZGlzdGFuY2UgKGluIG1pbGVzKSBmcm9tIHRoZSBnZW8gcG9pbnQgc3BlY2lmaWVkIGluIHRoZSAkbmVhclNwaGVyZSBvcGVyYXRvci4nLFxuICAgICAgdHlwZTogR3JhcGhRTEZsb2F0LFxuICAgIH0sXG4gICAgbWF4RGlzdGFuY2VJbktpbG9tZXRlcnM6IHtcbiAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICAnVGhpcyBpcyB0aGUgbWF4RGlzdGFuY2VJbktpbG9tZXRlcnMgb3BlcmF0b3IgdG8gc3BlY2lmeSBhIGNvbnN0cmFpbnQgdG8gc2VsZWN0IHRoZSBvYmplY3RzIHdoZXJlIHRoZSB2YWx1ZXMgb2YgYSBnZW8gcG9pbnQgZmllbGQgaXMgYXQgYSBtYXggZGlzdGFuY2UgKGluIGtpbG9tZXRlcnMpIGZyb20gdGhlIGdlbyBwb2ludCBzcGVjaWZpZWQgaW4gdGhlICRuZWFyU3BoZXJlIG9wZXJhdG9yLicsXG4gICAgICB0eXBlOiBHcmFwaFFMRmxvYXQsXG4gICAgfSxcbiAgICB3aXRoaW46IHtcbiAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICAnVGhpcyBpcyB0aGUgd2l0aGluIG9wZXJhdG9yIHRvIHNwZWNpZnkgYSBjb25zdHJhaW50IHRvIHNlbGVjdCB0aGUgb2JqZWN0cyB3aGVyZSB0aGUgdmFsdWVzIG9mIGEgZ2VvIHBvaW50IGZpZWxkIGlzIHdpdGhpbiBhIHNwZWNpZmllZCBib3guJyxcbiAgICAgIHR5cGU6IFdJVEhJTl9JTlBVVCxcbiAgICB9LFxuICAgIGdlb1dpdGhpbjoge1xuICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICdUaGlzIGlzIHRoZSBnZW9XaXRoaW4gb3BlcmF0b3IgdG8gc3BlY2lmeSBhIGNvbnN0cmFpbnQgdG8gc2VsZWN0IHRoZSBvYmplY3RzIHdoZXJlIHRoZSB2YWx1ZXMgb2YgYSBnZW8gcG9pbnQgZmllbGQgaXMgd2l0aGluIGEgc3BlY2lmaWVkIHBvbHlnb24gb3Igc3BoZXJlLicsXG4gICAgICB0eXBlOiBHRU9fV0lUSElOX0lOUFVULFxuICAgIH0sXG4gIH0sXG59KTtcblxuY29uc3QgUE9MWUdPTl9XSEVSRV9JTlBVVCA9IG5ldyBHcmFwaFFMSW5wdXRPYmplY3RUeXBlKHtcbiAgbmFtZTogJ1BvbHlnb25XaGVyZUlucHV0JyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ1RoZSBQb2x5Z29uV2hlcmVJbnB1dCBpbnB1dCB0eXBlIGlzIHVzZWQgaW4gb3BlcmF0aW9ucyB0aGF0IGludm9sdmUgZmlsdGVyaW5nIG9iamVjdHMgYnkgYSBmaWVsZCBvZiB0eXBlIFBvbHlnb24uJyxcbiAgZmllbGRzOiB7XG4gICAgZXhpc3RzLFxuICAgIGdlb0ludGVyc2VjdHM6IHtcbiAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICAnVGhpcyBpcyB0aGUgZ2VvSW50ZXJzZWN0cyBvcGVyYXRvciB0byBzcGVjaWZ5IGEgY29uc3RyYWludCB0byBzZWxlY3QgdGhlIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlcyBvZiBhIHBvbHlnb24gZmllbGQgaW50ZXJzZWN0IGEgc3BlY2lmaWVkIHBvaW50LicsXG4gICAgICB0eXBlOiBHRU9fSU5URVJTRUNUU19JTlBVVCxcbiAgICB9LFxuICB9LFxufSk7XG5cbmNvbnN0IEVMRU1FTlQgPSBuZXcgR3JhcGhRTE9iamVjdFR5cGUoe1xuICBuYW1lOiAnRWxlbWVudCcsXG4gIGRlc2NyaXB0aW9uOiBcIlRoZSBFbGVtZW50IG9iamVjdCB0eXBlIGlzIHVzZWQgdG8gcmV0dXJuIGFycmF5IGl0ZW1zJyB2YWx1ZS5cIixcbiAgZmllbGRzOiB7XG4gICAgdmFsdWU6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnUmV0dXJuIHRoZSB2YWx1ZSBvZiB0aGUgZWxlbWVudCBpbiB0aGUgYXJyYXknLFxuICAgICAgdHlwZTogbmV3IEdyYXBoUUxOb25OdWxsKEFOWSksXG4gICAgfSxcbiAgfSxcbn0pO1xuXG4vLyBEZWZhdWx0IHN0YXRpYyB1bmlvbiB0eXBlLCB3ZSB1cGRhdGUgdHlwZXMgYW5kIHJlc29sdmVUeXBlIGZ1bmN0aW9uIGxhdGVyXG5sZXQgQVJSQVlfUkVTVUxUO1xuXG5jb25zdCBsb2FkQXJyYXlSZXN1bHQgPSAocGFyc2VHcmFwaFFMU2NoZW1hLCBwYXJzZUNsYXNzZXNBcnJheSkgPT4ge1xuICBjb25zdCBjbGFzc1R5cGVzID0gcGFyc2VDbGFzc2VzQXJyYXlcbiAgICAuZmlsdGVyKHBhcnNlQ2xhc3MgPT5cbiAgICAgIHBhcnNlR3JhcGhRTFNjaGVtYS5wYXJzZUNsYXNzVHlwZXNbcGFyc2VDbGFzcy5jbGFzc05hbWVdLmNsYXNzR3JhcGhRTE91dHB1dFR5cGUgPyB0cnVlIDogZmFsc2VcbiAgICApXG4gICAgLm1hcChcbiAgICAgIHBhcnNlQ2xhc3MgPT4gcGFyc2VHcmFwaFFMU2NoZW1hLnBhcnNlQ2xhc3NUeXBlc1twYXJzZUNsYXNzLmNsYXNzTmFtZV0uY2xhc3NHcmFwaFFMT3V0cHV0VHlwZVxuICAgICk7XG4gIEFSUkFZX1JFU1VMVCA9IG5ldyBHcmFwaFFMVW5pb25UeXBlKHtcbiAgICBuYW1lOiAnQXJyYXlSZXN1bHQnLFxuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1VzZSBJbmxpbmUgRnJhZ21lbnQgb24gQXJyYXkgdG8gZ2V0IHJlc3VsdHM6IGh0dHBzOi8vZ3JhcGhxbC5vcmcvbGVhcm4vcXVlcmllcy8jaW5saW5lLWZyYWdtZW50cycsXG4gICAgdHlwZXM6ICgpID0+IFtFTEVNRU5ULCAuLi5jbGFzc1R5cGVzXSxcbiAgICByZXNvbHZlVHlwZTogdmFsdWUgPT4ge1xuICAgICAgaWYgKHZhbHVlLl9fdHlwZSA9PT0gJ09iamVjdCcgJiYgdmFsdWUuY2xhc3NOYW1lICYmIHZhbHVlLm9iamVjdElkKSB7XG4gICAgICAgIGlmIChwYXJzZUdyYXBoUUxTY2hlbWEucGFyc2VDbGFzc1R5cGVzW3ZhbHVlLmNsYXNzTmFtZV0pIHtcbiAgICAgICAgICByZXR1cm4gcGFyc2VHcmFwaFFMU2NoZW1hLnBhcnNlQ2xhc3NUeXBlc1t2YWx1ZS5jbGFzc05hbWVdLmNsYXNzR3JhcGhRTE91dHB1dFR5cGUubmFtZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gRUxFTUVOVC5uYW1lO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gRUxFTUVOVC5uYW1lO1xuICAgICAgfVxuICAgIH0sXG4gIH0pO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuZ3JhcGhRTFR5cGVzLnB1c2goQVJSQVlfUkVTVUxUKTtcbn07XG5cbmNvbnN0IGxvYWQgPSBwYXJzZUdyYXBoUUxTY2hlbWEgPT4ge1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoR3JhcGhRTFVwbG9hZCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShBTlksIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoT0JKRUNULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKERBVEUsIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoQllURVMsIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoRklMRSwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShGSUxFX0lORk8sIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoRklMRV9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShHRU9fUE9JTlRfSU5QVVQsIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoR0VPX1BPSU5ULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKFBBUlNFX09CSkVDVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShSRUFEX1BSRUZFUkVOQ0UsIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoUkVBRF9PUFRJT05TX0lOUFVULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKFNFQVJDSF9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShURVhUX0lOUFVULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKEJPWF9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShXSVRISU5fSU5QVVQsIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoQ0VOVEVSX1NQSEVSRV9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShHRU9fV0lUSElOX0lOUFVULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKEdFT19JTlRFUlNFQ1RTX0lOUFVULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKElEX1dIRVJFX0lOUFVULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKFNUUklOR19XSEVSRV9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShOVU1CRVJfV0hFUkVfSU5QVVQsIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoQk9PTEVBTl9XSEVSRV9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShBUlJBWV9XSEVSRV9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShLRVlfVkFMVUVfSU5QVVQsIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoT0JKRUNUX1dIRVJFX0lOUFVULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKERBVEVfV0hFUkVfSU5QVVQsIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoQllURVNfV0hFUkVfSU5QVVQsIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoRklMRV9XSEVSRV9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShHRU9fUE9JTlRfV0hFUkVfSU5QVVQsIHRydWUpO1xuICBwYXJzZUdyYXBoUUxTY2hlbWEuYWRkR3JhcGhRTFR5cGUoUE9MWUdPTl9XSEVSRV9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShFTEVNRU5ULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKEFDTF9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShVU0VSX0FDTF9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShST0xFX0FDTF9JTlBVVCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShQVUJMSUNfQUNMX0lOUFVULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKEFDTCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShVU0VSX0FDTCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShST0xFX0FDTCwgdHJ1ZSk7XG4gIHBhcnNlR3JhcGhRTFNjaGVtYS5hZGRHcmFwaFFMVHlwZShQVUJMSUNfQUNMLCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKFNVQlFVRVJZX0lOUFVULCB0cnVlKTtcbiAgcGFyc2VHcmFwaFFMU2NoZW1hLmFkZEdyYXBoUUxUeXBlKFNFTEVDVF9JTlBVVCwgdHJ1ZSk7XG59O1xuXG5leHBvcnQge1xuICBHcmFwaFFMVXBsb2FkLFxuICBUeXBlVmFsaWRhdGlvbkVycm9yLFxuICBwYXJzZVN0cmluZ1ZhbHVlLFxuICBwYXJzZUludFZhbHVlLFxuICBwYXJzZUZsb2F0VmFsdWUsXG4gIHBhcnNlQm9vbGVhblZhbHVlLFxuICBwYXJzZVZhbHVlLFxuICBwYXJzZUxpc3RWYWx1ZXMsXG4gIHBhcnNlT2JqZWN0RmllbGRzLFxuICBBTlksXG4gIE9CSkVDVCxcbiAgcGFyc2VEYXRlSXNvVmFsdWUsXG4gIHNlcmlhbGl6ZURhdGVJc28sXG4gIERBVEUsXG4gIEJZVEVTLFxuICBwYXJzZUZpbGVWYWx1ZSxcbiAgU1VCUVVFUllfSU5QVVQsXG4gIFNFTEVDVF9JTlBVVCxcbiAgRklMRSxcbiAgRklMRV9JTkZPLFxuICBGSUxFX0lOUFVULFxuICBHRU9fUE9JTlRfRklFTERTLFxuICBHRU9fUE9JTlRfSU5QVVQsXG4gIEdFT19QT0lOVCxcbiAgUE9MWUdPTl9JTlBVVCxcbiAgUE9MWUdPTixcbiAgT0JKRUNUX0lELFxuICBDTEFTU19OQU1FX0FUVCxcbiAgR0xPQkFMX09SX09CSkVDVF9JRF9BVFQsXG4gIE9CSkVDVF9JRF9BVFQsXG4gIFVQREFURURfQVRfQVRULFxuICBDUkVBVEVEX0FUX0FUVCxcbiAgSU5QVVRfRklFTERTLFxuICBDUkVBVEVfUkVTVUxUX0ZJRUxEUyxcbiAgVVBEQVRFX1JFU1VMVF9GSUVMRFMsXG4gIFBBUlNFX09CSkVDVF9GSUVMRFMsXG4gIFBBUlNFX09CSkVDVCxcbiAgU0VTU0lPTl9UT0tFTl9BVFQsXG4gIFJFQURfUFJFRkVSRU5DRSxcbiAgUkVBRF9QUkVGRVJFTkNFX0FUVCxcbiAgSU5DTFVERV9SRUFEX1BSRUZFUkVOQ0VfQVRULFxuICBTVUJRVUVSWV9SRUFEX1BSRUZFUkVOQ0VfQVRULFxuICBSRUFEX09QVElPTlNfSU5QVVQsXG4gIFJFQURfT1BUSU9OU19BVFQsXG4gIFdIRVJFX0FUVCxcbiAgU0tJUF9BVFQsXG4gIExJTUlUX0FUVCxcbiAgQ09VTlRfQVRULFxuICBTRUFSQ0hfSU5QVVQsXG4gIFRFWFRfSU5QVVQsXG4gIEJPWF9JTlBVVCxcbiAgV0lUSElOX0lOUFVULFxuICBDRU5URVJfU1BIRVJFX0lOUFVULFxuICBHRU9fV0lUSElOX0lOUFVULFxuICBHRU9fSU5URVJTRUNUU19JTlBVVCxcbiAgZXF1YWxUbyxcbiAgbm90RXF1YWxUbyxcbiAgbGVzc1RoYW4sXG4gIGxlc3NUaGFuT3JFcXVhbFRvLFxuICBncmVhdGVyVGhhbixcbiAgZ3JlYXRlclRoYW5PckVxdWFsVG8sXG4gIGluT3AsXG4gIG5vdEluLFxuICBleGlzdHMsXG4gIG1hdGNoZXNSZWdleCxcbiAgb3B0aW9ucyxcbiAgaW5RdWVyeUtleSxcbiAgbm90SW5RdWVyeUtleSxcbiAgSURfV0hFUkVfSU5QVVQsXG4gIFNUUklOR19XSEVSRV9JTlBVVCxcbiAgTlVNQkVSX1dIRVJFX0lOUFVULFxuICBCT09MRUFOX1dIRVJFX0lOUFVULFxuICBBUlJBWV9XSEVSRV9JTlBVVCxcbiAgS0VZX1ZBTFVFX0lOUFVULFxuICBPQkpFQ1RfV0hFUkVfSU5QVVQsXG4gIERBVEVfV0hFUkVfSU5QVVQsXG4gIEJZVEVTX1dIRVJFX0lOUFVULFxuICBGSUxFX1dIRVJFX0lOUFVULFxuICBHRU9fUE9JTlRfV0hFUkVfSU5QVVQsXG4gIFBPTFlHT05fV0hFUkVfSU5QVVQsXG4gIEFSUkFZX1JFU1VMVCxcbiAgRUxFTUVOVCxcbiAgQUNMX0lOUFVULFxuICBVU0VSX0FDTF9JTlBVVCxcbiAgUk9MRV9BQ0xfSU5QVVQsXG4gIFBVQkxJQ19BQ0xfSU5QVVQsXG4gIEFDTCxcbiAgVVNFUl9BQ0wsXG4gIFJPTEVfQUNMLFxuICBQVUJMSUNfQUNMLFxuICBsb2FkLFxuICBsb2FkQXJyYXlSZXN1bHQsXG59O1xuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7O0FBQUEsSUFBQUEsUUFBQSxHQUFBQyxPQUFBO0FBZ0JBLElBQUFDLGFBQUEsR0FBQUQsT0FBQTtBQUNBLElBQUFFLGNBQUEsR0FBQUMsc0JBQUEsQ0FBQUgsT0FBQTtBQUNBLElBQUFJLE1BQUEsR0FBQUQsc0JBQUEsQ0FBQUgsT0FBQTtBQUFnQyxTQUFBRyx1QkFBQUUsQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FBQUMsVUFBQSxHQUFBRCxDQUFBLEtBQUFFLE9BQUEsRUFBQUYsQ0FBQTtBQUVoQyxNQUFNRyxtQkFBbUIsU0FBU0MsS0FBSyxDQUFDO0VBQ3RDQyxXQUFXQSxDQUFDQyxLQUFLLEVBQUVDLElBQUksRUFBRTtJQUN2QixLQUFLLENBQUMsR0FBR0QsS0FBSyxtQkFBbUJDLElBQUksRUFBRSxDQUFDO0VBQzFDO0FBQ0Y7QUFBQ0MsT0FBQSxDQUFBTCxtQkFBQSxHQUFBQSxtQkFBQTtBQUVELE1BQU1NLGdCQUFnQixHQUFHSCxLQUFLLElBQUk7RUFDaEMsSUFBSSxPQUFPQSxLQUFLLEtBQUssUUFBUSxFQUFFO0lBQzdCLE9BQU9BLEtBQUs7RUFDZDtFQUVBLE1BQU0sSUFBSUgsbUJBQW1CLENBQUNHLEtBQUssRUFBRSxRQUFRLENBQUM7QUFDaEQsQ0FBQztBQUFDRSxPQUFBLENBQUFDLGdCQUFBLEdBQUFBLGdCQUFBO0FBRUYsTUFBTUMsYUFBYSxHQUFHSixLQUFLLElBQUk7RUFDN0IsSUFBSSxPQUFPQSxLQUFLLEtBQUssUUFBUSxFQUFF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