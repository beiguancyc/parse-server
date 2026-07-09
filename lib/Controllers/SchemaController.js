"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.VolatileClassesSchemas = exports.SchemaController = void 0;
exports.buildMergedSchemaObject = buildMergedSchemaObject;
exports.classNameIsValid = classNameIsValid;
exports.defaultColumns = exports.default = exports.convertSchemaToAdapterSchema = void 0;
exports.fieldNameIsValid = fieldNameIsValid;
exports.invalidClassNameMessage = invalidClassNameMessage;
exports.systemClasses = exports.requiredColumns = exports.load = void 0;
var _StorageAdapter = require("../Adapters/Storage/StorageAdapter");
var _SchemaCache = _interopRequireDefault(require("../Adapters/Cache/SchemaCache"));
var _DatabaseController = _interopRequireDefault(require("./DatabaseController"));
var _Config = _interopRequireDefault(require("../Config"));
var _Error = require("../Error");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// This class handles schema validation, persistence, and modification.
//
// Each individual Schema object should be immutable. The helpers to
// do things with the Schema just return a new schema when the schema
// is changed.
//
// The canonical place to store this Schema is in the database itself,
// in a _SCHEMA collection. This is not the right way to do it for an
// open source framework, but it's backward compatible, so we're
// keeping it this way for now.
//
// In API-handling code, you should only use the Schema class via the
// DatabaseController. This will let us replace the schema logic for
// different databases.
// TODO: hide all schema logic inside the database adapter.
// -disable-next
const Parse = require('parse/node').Parse;
const defaultColumns = exports.defaultColumns = Object.freeze({
  // Contain the default columns for every parse object type (except _Join collection)
  _Default: {
    objectId: {
      type: 'String'
    },
    createdAt: {
      type: 'Date'
    },
    updatedAt: {
      type: 'Date'
    },
    ACL: {
      type: 'ACL'
    }
  },
  // The additional default columns for the _User collection (in addition to DefaultCols)
  _User: {
    username: {
      type: 'String'
    },
    password: {
      type: 'String'
    },
    email: {
      type: 'String'
    },
    emailVerified: {
      type: 'Boolean'
    },
    authData: {
      type: 'Object'
    }
  },
  // The additional default columns for the _Installation collection (in addition to DefaultCols)
  _Installation: {
    installationId: {
      type: 'String'
    },
    deviceToken: {
      type: 'String'
    },
    channels: {
      type: 'Array'
    },
    deviceType: {
      type: 'String'
    },
    pushType: {
      type: 'String'
    },
    GCMSenderId: {
      type: 'String'
    },
    timeZone: {
      type: 'String'
    },
    localeIdentifier: {
      type: 'String'
    },
    badge: {
      type: 'Number'
    },
    appVersion: {
      type: 'String'
    },
    appName: {
      type: 'String'
    },
    appIdentifier: {
      type: 'String'
    },
    parseVersion: {
      type: 'String'
    }
  },
  // The additional default columns for the _Role collection (in addition to DefaultCols)
  _Role: {
    name: {
      type: 'String'
    },
    users: {
      type: 'Relation',
      targetClass: '_User'
    },
    roles: {
      type: 'Relation',
      targetClass: '_Role'
    }
  },
  // The additional default columns for the _Session collection (in addition to DefaultCols)
  _Session: {
    user: {
      type: 'Pointer',
      targetClass: '_User'
    },
    installationId: {
      type: 'String'
    },
    sessionToken: {
      type: 'String'
    },
    expiresAt: {
      type: 'Date'
    },
    createdWith: {
      type: 'Object'
    }
  },
  _Product: {
    productIdentifier: {
      type: 'String'
    },
    download: {
      type: 'File'
    },
    downloadName: {
      type: 'String'
    },
    icon: {
      type: 'File'
    },
    order: {
      type: 'Number'
    },
    title: {
      type: 'String'
    },
    subtitle: {
      type: 'String'
    }
  },
  _PushStatus: {
    pushTime: {
      type: 'String'
    },
    source: {
      type: 'String'
    },
    // rest or webui
    query: {
      type: 'String'
    },
    // the stringified JSON query
    payload: {
      type: 'String'
    },
    // the stringified JSON payload,
    title: {
      type: 'String'
    },
    expiry: {
      type: 'Number'
    },
    expiration_interval: {
      type: 'Number'
    },
    status: {
      type: 'String'
    },
    numSent: {
      type: 'Number'
    },
    numFailed: {
      type: 'Number'
    },
    pushHash: {
      type: 'String'
    },
    errorMessage: {
      type: 'Object'
    },
    sentPerType: {
      type: 'Object'
    },
    failedPerType: {
      type: 'Object'
    },
    sentPerUTCOffset: {
      type: 'Object'
    },
    failedPerUTCOffset: {
      type: 'Object'
    },
    count: {
      type: 'Number'
    } // tracks # of batches queued and pending
  },
  _JobStatus: {
    jobName: {
      type: 'String'
    },
    source: {
      type: 'String'
    },
    status: {
      type: 'String'
    },
    message: {
      type: 'String'
    },
    params: {
      type: 'Object'
    },
    // params received when calling the job
    finishedAt: {
      type: 'Date'
    }
  },
  _JobSchedule: {
    jobName: {
      type: 'String'
    },
    description: {
      type: 'String'
    },
    params: {
      type: 'String'
    },
    startAfter: {
      type: 'String'
    },
    daysOfWeek: {
      type: 'Array'
    },
    timeOfDay: {
      type: 'String'
    },
    lastRun: {
      type: 'Number'
    },
    repeatMinutes: {
      type: 'Number'
    }
  },
  _Hooks: {
    functionName: {
      type: 'String'
    },
    className: {
      type: 'String'
    },
    triggerName: {
      type: 'String'
    },
    url: {
      type: 'String'
    }
  },
  _GlobalConfig: {
    objectId: {
      type: 'String'
    },
    params: {
      type: 'Object'
    },
    masterKeyOnly: {
      type: 'Object'
    }
  },
  _GraphQLConfig: {
    objectId: {
      type: 'String'
    },
    config: {
      type: 'Object'
    }
  },
  _Audience: {
    objectId: {
      type: 'String'
    },
    name: {
      type: 'String'
    },
    query: {
      type: 'String'
    },
    //storing query as JSON string to prevent "Nested keys should not contain the '$' or '.' characters" error
    lastUsed: {
      type: 'Date'
    },
    timesUsed: {
      type: 'Number'
    }
  },
  _Idempotency: {
    reqId: {
      type: 'String'
    },
    expire: {
      type: 'Date'
    }
  }
});

// fields required for read or write operations on their respective classes.
const requiredColumns = exports.requiredColumns = Object.freeze({
  read: {
    _User: ['username']
  },
  write: {
    _Product: ['productIdentifier', 'icon', 'order', 'title', 'subtitle'],
    _Role: ['name', 'ACL']
  }
});
const invalidColumns = ['length'];
const systemClasses = exports.systemClasses = Object.freeze(['_User', '_Installation', '_Role', '_Session', '_Product', '_PushStatus', '_JobStatus', '_JobSchedule', '_Audience', '_Idempotency']);
const volatileClasses = Object.freeze(['_JobStatus', '_PushStatus', '_Hooks', '_GlobalConfig', '_GraphQLConfig', '_JobSchedule', '_Audience', '_Idempotency']);

// Anything that start with role
const roleRegex = /^role:.*/;
// Anything that starts with userField (allowed for protected fields only)
const protectedFieldsPointerRegex = /^userField:.*/;
// * permission
const publicRegex = /^\*$/;
const authenticatedRegex = /^authenticated$/;
const requiresAuthenticationRegex = /^requiresAuthentication$/;
const clpPointerRegex = /^pointerFields$/;

// regex for validating entities in protectedFields object
const protectedFieldsRegex = Object.freeze([protectedFieldsPointerRegex, publicRegex, authenticatedRegex, roleRegex]);

// clp regex
const clpFieldsRegex = Object.freeze([clpPointerRegex, publicRegex, requiresAuthenticationRegex, roleRegex]);
function validatePermissionKey(key, userIdRegExp) {
  let matchesSome = false;
  for (const regEx of clpFieldsRegex) {
    if (key.match(regEx) !== null) {
      matchesSome = true;
      break;
    }
  }

  // userId depends on startup options so it's dynamic
  const valid = matchesSome || key.match(userIdRegExp) !== null;
  if (!valid) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `'${key}' is not a valid key for class level permissions`);
  }
}
function validateProtectedFieldsKey(key, userIdRegExp) {
  let matchesSome = false;
  for (const regEx of protectedFieldsRegex) {
    if (key.match(regEx) !== null) {
      matchesSome = true;
      break;
    }
  }

  // userId regex depends on launch options so it's dynamic
  const valid = matchesSome || key.match(userIdRegExp) !== null;
  if (!valid) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `'${key}' is not a valid key for class level permissions`);
  }
}
const CLPValidKeys = Object.freeze(['ACL', 'find', 'count', 'get', 'create', 'update', 'delete', 'addField', 'readUserFields', 'writeUserFields', 'protectedFields']);

// validation before setting class-level permissions on collection
function validateCLP(perms, fields, userIdRegExp) {
  if (!perms) {
    return;
  }
  for (const operationKey in perms) {
    if (CLPValidKeys.indexOf(operationKey) == -1) {
      throw new Parse.Error(Parse.Error.INVALID_JSON, `${operationKey} is not a valid operation for class level permissions`);
    }
    const operation = perms[operationKey];
    // proceed with next operationKey

    // throws when root fields are of wrong type
    validateCLPjson(operation, operationKey);
    if (operationKey === 'readUserFields' || operationKey === 'writeUserFields') {
      // validate grouped pointer permissions
      // must be an array with field names
      for (const fieldName of operation) {
        validatePointerPermission(fieldName, fields, operationKey);
      }
      // readUserFields and writerUserFields do not have nesdted fields
      // proceed with next operationKey
      continue;
    }

    // validate protected fields
    if (operationKey === 'protectedFields') {
      for (const entity in operation) {
        // throws on unexpected key
        validateProtectedFieldsKey(entity, userIdRegExp);
        const protectedFields = operation[entity];
        if (!Array.isArray(protectedFields)) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, `'${protectedFields}' is not a valid value for protectedFields[${entity}] - expected an array.`);
        }

        // if the field is in form of array
        for (const field of protectedFields) {
          // do not alloow to protect default fields
          if (defaultColumns._Default[field]) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `Default field '${field}' can not be protected`);
          }
          // field should exist on collection
          if (!Object.prototype.hasOwnProperty.call(fields, field)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `Field '${field}' in protectedFields:${entity} does not exist`);
          }
        }
      }
      // proceed with next operationKey
      continue;
    }

    // validate other fields
    // Entity can be:
    // "*" - Public,
    // "requiresAuthentication" - authenticated users,
    // "objectId" - _User id,
    // "role:rolename",
    // "pointerFields" - array of field names containing pointers to users
    for (const entity in operation) {
      // throws on unexpected key
      validatePermissionKey(entity, userIdRegExp);

      // entity can be either:
      // "pointerFields": string[]
      if (entity === 'pointerFields') {
        const pointerFields = operation[entity];
        if (Array.isArray(pointerFields)) {
          for (const pointerField of pointerFields) {
            validatePointerPermission(pointerField, fields, operation);
          }
        } else {
          throw new Parse.Error(Parse.Error.INVALID_JSON, `'${pointerFields}' is not a valid value for ${operationKey}[${entity}] - expected an array.`);
        }
        // proceed with next entity key
        continue;
      }
      const permit = operation[entity];
      if (operationKey === 'ACL') {
        if (Object.prototype.toString.call(permit) !== '[object Object]') {
          throw new Parse.Error(Parse.Error.INVALID_JSON, `'${permit}' is not a valid value for class level permissions acl`);
        }
        const invalidKeys = Object.keys(permit).filter(key => !['read', 'write'].includes(key));
        const invalidValues = Object.values(permit).filter(key => typeof key !== 'boolean');
        if (invalidKeys.length) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, `'${invalidKeys.join(',')}' is not a valid key for class level permissions acl`);
        }
        if (invalidValues.length) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, `'${invalidValues.join(',')}' is not a valid value for class level permissions acl`);
        }
      } else if (permit !== true) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, `'${permit}' is not a valid value for class level permissions acl ${operationKey}:${entity}`);
      }
    }
  }
}
function validateCLPjson(operation, operationKey) {
  if (operationKey === 'readUserFields' || operationKey === 'writeUserFields') {
    if (!Array.isArray(operation)) {
      throw new Parse.Error(Parse.Error.INVALID_JSON, `'${operation}' is not a valid value for class level permissions ${operationKey} - must be an array`);
    }
  } else {
    if (typeof operation === 'object' && operation !== null) {
      // ok to proceed
      return;
    } else {
      throw new Parse.Error(Parse.Error.INVALID_JSON, `'${operation}' is not a valid value for class level permissions ${operationKey} - must be an object`);
    }
  }
}
function validatePointerPermission(fieldName, fields, operation) {
  // Uses collection schema to ensure the field is of type:
  // - Pointer<_User> (pointers)
  // - Array
  //
  //    It's not possible to enforce type on Array's items in schema
  //  so we accept any Array field, and later when applying permissions
  //  only items that are pointers to _User are considered.
  if (!(fields[fieldName] && (fields[fieldName].type == 'Pointer' && fields[fieldName].targetClass == '_User' || fields[fieldName].type == 'Array'))) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `'${fieldName}' is not a valid column for class level pointer permissions ${operation}`);
  }
}
const joinClassRegex = /^_Join:[A-Za-z0-9_]+:[A-Za-z0-9_]+/;
const classAndFieldRegex = /^[A-Za-z][A-Za-z0-9_]*$/;
function classNameIsValid(className) {
  // Valid classes must:
  return (
    // Be one of _User, _Installation, _Role, _Session OR
    systemClasses.indexOf(className) > -1 ||
    // Be a join table OR
    joinClassRegex.test(className) ||
    // Include only alpha-numeric and underscores, and not start with an underscore or number
    fieldNameIsValid(className, className)
  );
}

// Valid fields must be alpha-numeric, and not start with an underscore or number
// must not be a reserved key
function fieldNameIsValid(fieldName, className) {
  if (className && className !== '_Hooks') {
    if (fieldName === 'className') {
      return false;
    }
  }
  return classAndFieldRegex.test(fieldName) && !invalidColumns.includes(fieldName);
}

// Checks that it's not trying to clobber one of the default fields of the class.
function fieldNameIsValidForClass(fieldName, className) {
  if (!fieldNameIsValid(fieldName, className)) {
    return false;
  }
  if (defaultColumns._Default[fieldName]) {
    return false;
  }
  if (defaultColumns[className] && defaultColumns[className][fieldName]) {
    return false;
  }
  return true;
}
function invalidClassNameMessage(className) {
  return 'Invalid classname: ' + className + ', classnames can only have alphanumeric characters and _, and must start with an alpha character ';
}
const invalidJsonError = new Parse.Error(Parse.Error.INVALID_JSON, 'invalid JSON');
const validNonRelationOrPointerTypes = ['Number', 'String', 'Boolean', 'Date', 'Object', 'Array', 'GeoPoint', 'File', 'Bytes', 'Polygon'];
// Returns an error suitable for throwing if the type is invalid
const fieldTypeIsInvalid = ({
  type,
  targetClass
}) => {
  if (['Pointer', 'Relation'].indexOf(type) >= 0) {
    if (!targetClass) {
      return new Parse.Error(135, `type ${type} needs a class name`);
    } else if (typeof targetClass !== 'string') {
      return invalidJsonError;
    } else if (!classNameIsValid(targetClass)) {
      return new Parse.Error(Parse.Error.INVALID_CLASS_NAME, invalidClassNameMessage(targetClass));
    } else {
      return undefined;
    }
  }
  if (typeof type !== 'string') {
    return invalidJsonError;
  }
  if (validNonRelationOrPointerTypes.indexOf(type) < 0) {
    return new Parse.Error(Parse.Error.INCORRECT_TYPE, `invalid field type: ${type}`);
  }
  return undefined;
};
const convertSchemaToAdapterSchema = schema => {
  schema = injectDefaultSchema(schema);
  delete schema.fields.ACL;
  schema.fields._rperm = {
    type: 'Array'
  };
  schema.fields._wperm = {
    type: 'Array'
  };
  if (schema.className === '_User') {
    delete schema.fields.password;
    schema.fields._hashed_password = {
      type: 'String'
    };
  }
  return schema;
};
exports.convertSchemaToAdapterSchema = convertSchemaToAdapterSchema;
const convertAdapterSchemaToParseSchema = ({
  ...schema
}) => {
  delete schema.fields._rperm;
  delete schema.fields._wperm;
  schema.fields.ACL = {
    type: 'ACL'
  };
  if (schema.className === '_User') {
    delete schema.fields.authData; //Auth data is implicit
    delete schema.fields._hashed_password;
    schema.fields.password = {
      type: 'String'
    };
  }
  if (schema.indexes && Object.keys(schema.indexes).length === 0) {
    delete schema.indexes;
  }
  return schema;
};
class SchemaData {
  constructor(allSchemas = [], protectedFields = {}) {
    this.__data = {};
    this.__protectedFields = protectedFields;
    allSchemas.forEach(schema => {
      if (volatileClasses.includes(schema.className)) {
        return;
      }
      Object.defineProperty(this, schema.className, {
        get: () => {
          if (!this.__data[schema.className]) {
            const data = {};
            data.fields = injectDefaultSchema(schema).fields;
            data.classLevelPermissions = structuredClone(schema.classLevelPermissions);
            data.indexes = schema.indexes;
            const classProtectedFields = this.__protectedFields[schema.className];
            if (classProtectedFields) {
              for (const key in classProtectedFields) {
                const unq = new Set([...(data.classLevelPermissions.protectedFields[key] || []), ...classProtectedFields[key]]);
                data.classLevelPermissions.protectedFields[key] = Array.from(unq);
              }
            }
            this.__data[schema.className] = data;
          }
          return this.__data[schema.className];
        }
      });
    });

    // Inject the in-memory classes
    volatileClasses.forEach(className => {
      Object.defineProperty(this, className, {
        get: () => {
          if (!this.__data[className]) {
            const schema = injectDefaultSchema({
              className,
              fields: {},
              classLevelPermissions: {}
            });
            const data = {};
            data.fields = schema.fields;
            data.classLevelPermissions = schema.classLevelPermissions;
            data.indexes = schema.indexes;
            this.__data[className] = data;
          }
          return this.__data[className];
        }
      });
    });
  }
}
const injectDefaultSchema = ({
  className,
  fields,
  classLevelPermissions,
  indexes
}) => {
  const defaultSchema = {
    className,
    fields: {
      ...defaultColumns._Default,
      ...(defaultColumns[className] || {}),
      ...fields
    },
    classLevelPermissions
  };
  if (indexes && Object.keys(indexes).length !== 0) {
    defaultSchema.indexes = indexes;
  }
  return defaultSchema;
};
const _HooksSchema = {
  className: '_Hooks',
  fields: defaultColumns._Hooks
};
const _GlobalConfigSchema = {
  className: '_GlobalConfig',
  fields: defaultColumns._GlobalConfig
};
const _GraphQLConfigSchema = {
  className: '_GraphQLConfig',
  fields: defaultColumns._GraphQLConfig
};
const _PushStatusSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_PushStatus',
  fields: {},
  classLevelPermissions: {}
}));
const _JobStatusSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_JobStatus',
  fields: {},
  classLevelPermissions: {}
}));
const _JobScheduleSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_JobSchedule',
  fields: {},
  classLevelPermissions: {}
}));
const _AudienceSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_Audience',
  fields: defaultColumns._Audience,
  classLevelPermissions: {}
}));
const _IdempotencySchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_Idempotency',
  fields: defaultColumns._Idempotency,
  classLevelPermissions: {}
}));
const VolatileClassesSchemas = exports.VolatileClassesSchemas = [_HooksSchema, _JobStatusSchema, _JobScheduleSchema, _PushStatusSchema, _GlobalConfigSchema, _GraphQLConfigSchema, _AudienceSchema, _IdempotencySchema];
const dbTypeMatchesObjectType = (dbType, objectType) => {
  if (dbType.type !== objectType.type) {
    return false;
  }
  if (dbType.targetClass !== objectType.targetClass) {
    return false;
  }
  if (dbType === objectType.type) {
    return true;
  }
  if (dbType.type === objectType.type) {
    return true;
  }
  return false;
};
const typeToString = type => {
  if (typeof type === 'string') {
    return type;
  }
  if (type.targetClass) {
    return `${type.type}<${type.targetClass}>`;
  }
  return `${type.type}`;
};
const ttl = {
  date: Date.now(),
  duration: undefined
};

// Stores the entire schema of the app in a weird hybrid format somewhere between
// the mongo format and the Parse format. Soon, this will all be Parse format.
class SchemaController {
  constructor(databaseAdapter) {
    this._dbAdapter = databaseAdapter;
    const config = _Config.default.get(Parse.applicationId);
    this.schemaData = new SchemaData(_SchemaCache.default.all(), this.protectedFields);
    this.protectedFields = config.protectedFields;
    const customIds = config.allowCustomObjectId;
    const customIdRegEx = /^.{1,}$/u; // 1+ chars
    const autoIdRegEx = /^[a-zA-Z0-9]{1,}$/;
    this.userIdRegEx = customIds ? customIdRegEx : autoIdRegEx;
    this._dbAdapter.watch(() => {
      this.reloadData({
        clearCache: true
      });
    });
  }
  async reloadDataIfNeeded() {
    if (this._dbAdapter.enableSchemaHooks) {
      return;
    }
    const {
      date,
      duration
    } = ttl || {};
    if (!duration) {
      return;
    }
    const now = Date.now();
    if (now - date > duration) {
      ttl.date = now;
      await this.reloadData({
        clearCache: true
      });
    }
  }
  reloadData(options = {
    clearCache: false
  }) {
    if (this.reloadDataPromise && !options.clearCache) {
      return this.reloadDataPromise;
    }
    this.reloadDataPromise = this.getAllClasses(options).then(allSchemas => {
      this.schemaData = new SchemaData(allSchemas, this.protectedFields);
      delete this.reloadDataPromise;
    }, err => {
      this.schemaData = new SchemaData();
      delete this.reloadDataPromise;
      throw err;
    }).then(() => {});
    return this.reloadDataPromise;
  }
  async getAllClasses(options = {
    clearCache: false
  }) {
    if (options.clearCache) {
      return this.setAllClasses();
    }
    await this.reloadDataIfNeeded();
    const cached = _SchemaCache.default.all();
    if (cached && cached.length) {
      return Promise.resolve(cached);
    }
    return this.setAllClasses();
  }
  setAllClasses() {
    return this._dbAdapter.getAllClasses().then(allSchemas => allSchemas.map(injectDefaultSchema)).then(allSchemas => {
      _SchemaCache.default.put(allSchemas);
      return allSchemas;
    });
  }
  getOneSchema(className, allowVolatileClasses = false, options = {
    clearCache: false
  }) {
    if (options.clearCache) {
      _SchemaCache.default.clear();
    }
    if (allowVolatileClasses && volatileClasses.indexOf(className) > -1) {
      const data = this.schemaData[className];
      return Promise.resolve({
        className,
        fields: data.fields,
        classLevelPermissions: data.classLevelPermissions,
        indexes: data.indexes
      });
    }
    const cached = _SchemaCache.default.get(className);
    if (cached && !options.clearCache) {
      return Promise.resolve(cached);
    }
    return this.setAllClasses().then(allSchemas => {
      const oneSchema = allSchemas.find(schema => schema.className === className);
      if (!oneSchema) {
        return Promise.reject(undefined);
      }
      return oneSchema;
    });
  }

  // Create a new class that includes the three default fields.
  // ACL is an implicit column that does not get an entry in the
  // _SCHEMAS database. Returns a promise that resolves with the
  // created schema, in mongo format.
  // on success, and rejects with an error on fail. Ensure you
  // have authorization (master key, or client class creation
  // enabled) before calling this function.
  async addClassIfNotExists(className, fields = {}, classLevelPermissions, indexes = {}) {
    var validationError = this.validateNewClass(className, fields, classLevelPermissions);
    if (validationError) {
      if (validationError instanceof Parse.Error) {
        return Promise.reject(validationError);
      } else if (validationError.code && validationError.error) {
        return Promise.reject(new Parse.Error(validationError.code, validationError.error));
      }
      return Promise.reject(validationError);
    }
    try {
      const adapterSchema = await this._dbAdapter.createClass(className, convertSchemaToAdapterSchema({
        fields,
        classLevelPermissions,
        indexes,
        className
      }));
      // TODO: Remove by updating schema cache directly
      await this.reloadData({
        clearCache: true
      });
      const parseSchema = convertAdapterSchemaToParseSchema(adapterSchema);
      return parseSchema;
    } catch (error) {
      if (error && error.code === Parse.Error.DUPLICATE_VALUE) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} already exists.`);
      } else {
        throw error;
      }
    }
  }
  updateClass(className, submittedFields, classLevelPermissions, indexes, database) {
    return this.getOneSchema(className).then(schema => {
      const existingFields = schema.fields;
      Object.keys(submittedFields).forEach(name => {
        const field = submittedFields[name];
        if (existingFields[name] && existingFields[name].type !== field.type && field.__op !== 'Delete') {
          throw new Parse.Error(255, `Field ${name} exists, cannot update.`);
        }
        if (!existingFields[name] && field.__op === 'Delete') {
          throw new Parse.Error(255, `Field ${name} does not exist, cannot delete.`);
        }
      });
      delete existingFields._rperm;
      delete existingFields._wperm;
      const newSchema = buildMergedSchemaObject(existingFields, submittedFields);
      const defaultFields = defaultColumns[className] || defaultColumns._Default;
      const fullNewSchema = Object.assign({}, newSchema, defaultFields);
      const validationError = this.validateSchemaData(className, newSchema, classLevelPermissions, Object.keys(existingFields));
      if (validationError) {
        throw new Parse.Error(validationError.code, validationError.error);
      }

      // Finally we have checked to make sure the request is valid and we can start deleting fields.
      // Do all deletions first, then a single save to _SCHEMA collection to handle all additions.
      const deletedFields = [];
      const insertedFields = [];
      Object.keys(submittedFields).forEach(fieldName => {
        if (submittedFields[fieldName].__op === 'Delete') {
          deletedFields.push(fieldName);
        } else {
          insertedFields.push(fieldName);
        }
      });
      let deletePromise = Promise.resolve();
      if (deletedFields.length > 0) {
        deletePromise = this.deleteFields(deletedFields, className, database);
      }
      let enforceFields = [];
      return deletePromise // Delete Everything
      .then(() => this.reloadData({
        clearCache: true
      })) // Reload our Schema, so we have all the new values
      .then(() => {
        const promises = insertedFields.map(fieldName => {
          const type = submittedFields[fieldName];
          return this.enforceFieldExists(className, fieldName, type);
        });
        return Promise.all(promises);
      }).then(results => {
        enforceFields = results.filter(result => !!result);
        return this.setPermissions(className, classLevelPermissions, newSchema);
      }).then(() => this._dbAdapter.setIndexesWithSchemaFormat(className, indexes, schema.indexes, fullNewSchema)).then(() => this.reloadData({
        clearCache: true
      }))
      //TODO: Move this logic into the database adapter
      .then(() => {
        this.ensureFields(enforceFields);
        const schema = this.schemaData[className];
        const reloadedSchema = {
          className: className,
          fields: schema.fields,
          classLevelPermissions: schema.classLevelPermissions
        };
        if (schema.indexes && Object.keys(schema.indexes).length !== 0) {
          reloadedSchema.indexes = schema.indexes;
        }
        return reloadedSchema;
      });
    }).catch(error => {
      if (error === undefined) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} does not exist.`);
      } else {
        throw error;
      }
    });
  }

  // Returns a promise that resolves successfully to the new schema
  // object or fails with a reason.
  enforceClassExists(className) {
    if (this.schemaData[className]) {
      return Promise.resolve(this);
    }
    // We don't have this class. Update the schema
    return (
      // The schema update succeeded. Reload the schema
      this.addClassIfNotExists(className).catch(() => {
        // The schema update failed. This can be okay - it might
        // have failed because there's a race condition and a different
        // client is making the exact same schema update that we want.
        // So just reload the schema.
        return this.reloadData({
          clearCache: true
        });
      }).then(() => {
        // Ensure that the schema now validates
        if (this.schemaData[className]) {
          return this;
        } else {
          throw new Parse.Error(Parse.Error.INVALID_JSON, `Failed to add ${className}`);
        }
      }).catch(() => {
        // The schema still doesn't validate. Give up
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'schema class name does not revalidate');
      })
    );
  }
  validateNewClass(className, fields = {}, classLevelPermissions) {
    if (this.schemaData[className]) {
      throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} already exists.`);
    }
    if (!classNameIsValid(className)) {
      return {
        code: Parse.Error.INVALID_CLASS_NAME,
        error: invalidClassNameMessage(className)
      };
    }
    return this.validateSchemaData(className, fields, classLevelPermissions, []);
  }
  validateSchemaData(className, fields, classLevelPermissions, existingFieldNames) {
    for (const fieldName in fields) {
      if (existingFieldNames.indexOf(fieldName) < 0) {
        if (!fieldNameIsValid(fieldName, className)) {
          return {
            code: Parse.Error.INVALID_KEY_NAME,
            error: 'invalid field name: ' + fieldName
          };
        }
        if (!fieldNameIsValidForClass(fieldName, className)) {
          return {
            code: 136,
            error: 'field ' + fieldName + ' cannot be added'
          };
        }
        const fieldType = fields[fieldName];
        const error = fieldTypeIsInvalid(fieldType);
        if (error) {
          return {
            code: error.code,
            error: error.message
          };
        }
        if (fieldType.defaultValue !== undefined) {
          let defaultValueType = getType(fieldType.defaultValue);
          if (typeof defaultValueType === 'string') {
            defaultValueType = {
              type: defaultValueType
            };
          } else if (typeof defaultValueType === 'object' && fieldType.type === 'Relation') {
            return {
              code: Parse.Error.INCORRECT_TYPE,
              error: `The 'default value' option is not applicable for ${typeToString(fieldType)}`
            };
          }
          if (!dbTypeMatchesObjectType(fieldType, defaultValueType)) {
            return {
              code: Parse.Error.INCORRECT_TYPE,
              error: `schema mismatch for ${className}.${fieldName} default value; expected ${typeToString(fieldType)} but got ${typeToString(defaultValueType)}`
            };
          }
        } else if (fieldType.required) {
          if (typeof fieldType === 'object' && fieldType.type === 'Relation') {
            return {
              code: Parse.Error.INCORRECT_TYPE,
              error: `The 'required' option is not applicable for ${typeToString(fieldType)}`
            };
          }
        }
      }
    }
    for (const fieldName in defaultColumns[className]) {
      fields[fieldName] = defaultColumns[className][fieldName];
    }
    const geoPoints = Object.keys(fields).filter(key => fields[key] && fields[key].type === 'GeoPoint');
    if (geoPoints.length > 1) {
      return {
        code: Parse.Error.INCORRECT_TYPE,
        error: 'currently, only one GeoPoint field may exist in an object. Adding ' + geoPoints[1] + ' when ' + geoPoints[0] + ' already exists.'
      };
    }
    validateCLP(classLevelPermissions, fields, this.userIdRegEx);
  }

  // Sets the Class-level permissions for a given className, which must exist.
  async setPermissions(className, perms, newSchema) {
    if (typeof perms === 'undefined') {
      return Promise.resolve();
    }
    validateCLP(perms, newSchema, this.userIdRegEx);
    await this._dbAdapter.setClassLevelPermissions(className, perms);
    const cached = _SchemaCache.default.get(className);
    if (cached) {
      cached.classLevelPermissions = perms;
    }
  }

  // Returns a promise that resolves successfully to the new schema
  // object if the provided className-fieldName-type tuple is valid.
  // The className must already be validated.
  // If 'freeze' is true, refuse to update the schema for this field.
  enforceFieldExists(className, fieldName, type, isValidation, maintenance) {
    if (fieldName.indexOf('.') > 0) {
      // "<array>.<index>" for Nested Arrays
      // "<embedded document>.<field>" for Nested Objects
      // JSON Arrays are treated as Nested Objects
      const [x, y] = fieldName.split('.');
      fieldName = x;
      const isArrayIndex = Array.from(y).every(c => c >= '0' && c <= '9');
      if (isArrayIndex && !['sentPerUTCOffset', 'failedPerUTCOffset'].includes(fieldName)) {
        type = 'Array';
      } else {
        type = 'Object';
      }
    }
    let fieldNameToValidate = `${fieldName}`;
    if (maintenance && fieldNameToValidate.charAt(0) === '_') {
      fieldNameToValidate = fieldNameToValidate.substring(1);
    }
    if (!fieldNameIsValid(fieldNameToValidate, className)) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}.`);
    }

    // If someone tries to create a new field with null/undefined as the value, return;
    if (!type) {
      return undefined;
    }
    const expectedType = this.getExpectedType(className, fieldName);
    if (typeof type === 'string') {
      type = {
        type
      };
    }
    if (type.defaultValue !== undefined) {
      let defaultValueType = getType(type.defaultValue);
      if (typeof defaultValueType === 'string') {
        defaultValueType = {
          type: defaultValueType
        };
      }
      if (!dbTypeMatchesObjectType(type, defaultValueType)) {
        throw new Parse.Error(Parse.Error.INCORRECT_TYPE, `schema mismatch for ${className}.${fieldName} default value; expected ${typeToString(type)} but got ${typeToString(defaultValueType)}`);
      }
    }
    if (expectedType) {
      if (!dbTypeMatchesObjectType(expectedType, type)) {
        throw new Parse.Error(Parse.Error.INCORRECT_TYPE, `schema mismatch for ${className}.${fieldName}; expected ${typeToString(expectedType)} but got ${typeToString(type)}`);
      }
      // If type options do not change
      // we can safely return
      if (isValidation || JSON.stringify(expectedType) === JSON.stringify(type)) {
        return undefined;
      }
      // Field options are may be changed
      // ensure to have an update to date schema field
      return this._dbAdapter.updateFieldOptions(className, fieldName, type);
    }
    return this._dbAdapter.addFieldIfNotExists(className, fieldName, type).catch(error => {
      if (error.code == Parse.Error.INCORRECT_TYPE) {
        // Make sure that we throw errors when it is appropriate to do so.
        throw error;
      }
      // The update failed. This can be okay - it might have been a race
      // condition where another client updated the schema in the same
      // way that we wanted to. So, just reload the schema
      return Promise.resolve();
    }).then(() => {
      return {
        className,
        fieldName,
        type
      };
    });
  }
  ensureFields(fields) {
    for (let i = 0; i < fields.length; i += 1) {
      const {
        className,
        fieldName
      } = fields[i];
      let {
        type
      } = fields[i];
      const expectedType = this.getExpectedType(className, fieldName);
      if (typeof type === 'string') {
        type = {
          type: type
        };
      }
      if (!expectedType || !dbTypeMatchesObjectType(expectedType, type)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, `Could not add field ${fieldName}`);
      }
    }
  }

  // maintain compatibility
  deleteField(fieldName, className, database) {
    return this.deleteFields([fieldName], className, database);
  }

  // Delete fields, and remove that data from all objects. This is intended
  // to remove unused fields, if other writers are writing objects that include
  // this field, the field may reappear. Returns a Promise that resolves with
  // no object on success, or rejects with { code, error } on failure.
  // Passing the database and prefix is necessary in order to drop relation collections
  // and remove fields from objects. Ideally the database would belong to
  // a database adapter and this function would close over it or access it via member.
  deleteFields(fieldNames, className, database) {
    if (!classNameIsValid(className)) {
      throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, invalidClassNameMessage(className));
    }
    fieldNames.forEach(fieldName => {
      if (!fieldNameIsValid(fieldName, className)) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, `invalid field name: ${fieldName}`);
      }
      //Don't allow deleting the default fields.
      if (!fieldNameIsValidForClass(fieldName, className)) {
        throw new Parse.Error(136, `field ${fieldName} cannot be changed`);
      }
    });
    return this.getOneSchema(className, false, {
      clearCache: true
    }).catch(error => {
      if (error === undefined) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} does not exist.`);
      } else {
        throw error;
      }
    }).then(schema => {
      fieldNames.forEach(fieldName => {
        if (!schema.fields[fieldName]) {
          throw new Parse.Error(255, `Field ${fieldName} does not exist, cannot delete.`);
        }
      });
      const schemaFields = {
        ...schema.fields
      };
      return database.adapter.deleteFields(className, schema, fieldNames).then(() => {
        return Promise.all(fieldNames.map(fieldName => {
          const field = schemaFields[fieldName];
          if (field && field.type === 'Relation') {
            //For relations, drop the _Join table
            return database.adapter.deleteClass(`_Join:${fieldName}:${className}`);
          }
          return Promise.resolve();
        }));
      });
    }).then(() => {
      _SchemaCache.default.clear();
    });
  }

  // Validates an object provided in REST format.
  // Returns a promise that resolves to the new schema if this object is
  // valid.
  async validateObject(className, object, query, maintenance) {
    let geocount = 0;
    const schema = await this.enforceClassExists(className);
    const promises = [];
    for (const fieldName in object) {
      if (object[fieldName] && getType(object[fieldName]) === 'GeoPoint') {
        geocount++;
      }
      if (geocount > 1) {
        return Promise.reject(new Parse.Error(Parse.Error.INCORRECT_TYPE, 'there can only be one geopoint field in a class'));
      }
    }
    for (const fieldName in object) {
      if (object[fieldName] === undefined) {
        continue;
      }
      const expected = getType(object[fieldName]);
      if (!expected) {
        continue;
      }
      if (fieldName === 'ACL') {
        // Every object has ACL implicitly.
        continue;
      }
      promises.push(schema.enforceFieldExists(className, fieldName, expected, true, maintenance));
    }
    const results = await Promise.all(promises);
    const enforceFields = results.filter(result => !!result);
    if (enforceFields.length !== 0) {
      // TODO: Remove by updating schema cache directly
      await this.reloadData({
        clearCache: true
      });
    }
    this.ensureFields(enforceFields);
    const promise = Promise.resolve(schema);
    return thenValidateRequiredColumns(promise, className, object, query);
  }

  // Validates that all the properties are set for the object
  validateRequiredColumns(className, object, query) {
    const columns = requiredColumns.write[className];
    if (!columns || columns.length == 0) {
      return Promise.resolve(this);
    }
    const missingColumns = columns.filter(function (column) {
      if (query && query.objectId) {
        if (object[column] && typeof object[column] === 'object') {
          // Trying to delete a required column
          return object[column].__op == 'Delete';
        }
        // Not trying to do anything there
        return false;
      }
      return !object[column];
    });
    if (missingColumns.length > 0) {
      throw new Parse.Error(Parse.Error.INCORRECT_TYPE, missingColumns[0] + ' is required.');
    }
    return Promise.resolve(this);
  }
  testPermissionsForClassName(className, aclGroup, operation) {
    return SchemaController.testPermissions(this.getClassLevelPermissions(className), aclGroup, operation);
  }

  // Tests that the class level permission let pass the operation for a given aclGroup
  static testPermissions(classPermissions, aclGroup, operation) {
    if (!classPermissions || !classPermissions[operation]) {
      return true;
    }
    const perms = classPermissions[operation];
    if (perms['*']) {
      return true;
    }
    // Check permissions against the aclGroup provided (array of userId/roles)
    if (aclGroup.some(acl => {
      return perms[acl] === true;
    })) {
      return true;
    }
    return false;
  }

  // Validates an operation passes class-level-permissions set in the schema
  static validatePermission(classPermissions, className, aclGroup, operation, action) {
    if (SchemaController.testPermissions(classPermissions, aclGroup, operation)) {
      return Promise.resolve();
    }
    if (!classPermissions || !classPermissions[operation]) {
      return true;
    }
    const perms = classPermissions[operation];
    const config = _Config.default.get(Parse.applicationId);
    // If only for authenticated users
    // make sure we have an aclGroup
    if (perms['requiresAuthentication']) {
      // If aclGroup has * (public)
      if (!aclGroup || aclGroup.length == 0) {
        throw (0, _Error.createSanitizedError)(Parse.Error.OBJECT_NOT_FOUND, 'Permission denied, user needs to be authenticated.', config);
      } else if (aclGroup.indexOf('*') > -1 && aclGroup.length == 1) {
        throw (0, _Error.createSanitizedError)(Parse.Error.OBJECT_NOT_FOUND, 'Permission denied, user needs to be authenticated.', config);
      }
      // requiresAuthentication passed, just move forward
      // probably would be wise at some point to rename to 'authenticatedUser'
      return Promise.resolve();
    }

    // No matching CLP, let's check the Pointer permissions
    // And handle those later
    const permissionField = ['get', 'find', 'count'].indexOf(operation) > -1 ? 'readUserFields' : 'writeUserFields';

    // Reject create when write lockdown
    if (permissionField == 'writeUserFields' && operation == 'create') {
      throw (0, _Error.createSanitizedError)(Parse.Error.OPERATION_FORBIDDEN, `Permission denied for action ${operation} on class ${className}.`, config);
    }

    // Process the readUserFields later
    if (Array.isArray(classPermissions[permissionField]) && classPermissions[permissionField].length > 0) {
      return Promise.resolve();
    }
    const pointerFields = classPermissions[operation].pointerFields;
    if (Array.isArray(pointerFields) && pointerFields.length > 0) {
      // any op except 'addField as part of create' is ok.
      if (operation !== 'addField' || action === 'update') {
        // We can allow adding field on update flow only.
        return Promise.resolve();
      }
    }
    throw (0, _Error.createSanitizedError)(Parse.Error.OPERATION_FORBIDDEN, `Permission denied for action ${operation} on class ${className}.`, config);
  }

  // Validates an operation passes class-level-permissions set in the schema
  validatePermission(className, aclGroup, operation, action) {
    return SchemaController.validatePermission(this.getClassLevelPermissions(className), className, aclGroup, operation, action);
  }
  getClassLevelPermissions(className) {
    return this.schemaData[className] && this.schemaData[className].classLevelPermissions;
  }

  // Returns the expected type for a className+key combination
  // or undefined if the schema is not set
  getExpectedType(className, fieldName) {
    if (this.schemaData[className]) {
      const expectedType = this.schemaData[className].fields[fieldName];
      return expectedType === 'map' ? 'Object' : expectedType;
    }
    return undefined;
  }

  // Checks if a given class is in the schema.
  hasClass(className) {
    if (this.schemaData[className]) {
      return Promise.resolve(true);
    }
    return this.reloadData().then(() => !!this.schemaData[className]);
  }
}

// Returns a promise for a new Schema.
exports.SchemaController = exports.default = SchemaController;
const load = (dbAdapter, options) => {
  const schema = new SchemaController(dbAdapter);
  ttl.duration = dbAdapter.schemaCacheTtl;
  return schema.reloadData(options).then(() => schema);
};

// Builds a new schema (in schema API response format) out of an
// existing mongo schema + a schemas API put request. This response
// does not include the default fields, as it is intended to be passed
// to mongoSchemaFromFieldsAndClassName. No validation is done here, it
// is done in mongoSchemaFromFieldsAndClassName.
exports.load = load;
function buildMergedSchemaObject(existingFields, putRequest) {
  const newSchema = {};
  // -disable-next
  const sysSchemaField = Object.keys(defaultColumns).indexOf(existingFields._id) === -1 ? [] : Object.keys(defaultColumns[existingFields._id]);
  for (const oldField in existingFields) {
    if (oldField !== '_id' && oldField !== 'ACL' && oldField !== 'updatedAt' && oldField !== 'createdAt' && oldField !== 'objectId') {
      if (sysSchemaField.length > 0 && sysSchemaField.indexOf(oldField) !== -1) {
        continue;
      }
      const fieldIsDeleted = putRequest[oldField] && putRequest[oldField].__op === 'Delete';
      if (!fieldIsDeleted) {
        newSchema[oldField] = existingFields[oldField];
      }
    }
  }
  for (const newField in putRequest) {
    if (newField !== 'objectId' && putRequest[newField].__op !== 'Delete') {
      if (sysSchemaField.length > 0 && sysSchemaField.indexOf(newField) !== -1) {
        continue;
      }
      newSchema[newField] = putRequest[newField];
    }
  }
  return newSchema;
}

// Given a schema promise, construct another schema promise that
// validates this field once the schema loads.
function thenValidateRequiredColumns(schemaPromise, className, object, query) {
  return schemaPromise.then(schema => {
    return schema.validateRequiredColumns(className, object, query);
  });
}

// Gets the type from a REST API formatted object, where 'type' is
// extended past javascript types to include the rest of the Parse
// type system.
// The output should be a valid schema value.
// TODO: ensure that this is compatible with the format used in Open DB
function getType(obj) {
  const type = typeof obj;
  switch (type) {
    case 'boolean':
      return 'Boolean';
    case 'string':
      return 'String';
    case 'number':
      return 'Number';
    case 'map':
    case 'object':
      if (!obj) {
        return undefined;
      }
      return getObjectType(obj);
    case 'function':
    case 'symbol':
    case 'undefined':
    default:
      throw 'bad obj: ' + obj;
  }
}

// This gets the type for non-JSON types like pointers and files, but
// also gets the appropriate type for $ operators.
// Returns null if the type is unknown.
function getObjectType(obj) {
  if (Array.isArray(obj)) {
    return 'Array';
  }
  if (obj.__type) {
    switch (obj.__type) {
      case 'Pointer':
        if (obj.className) {
          return {
            type: 'Pointer',
            targetClass: obj.className
          };
        }
        break;
      case 'Relation':
        if (obj.className) {
          return {
            type: 'Relation',
            targetClass: obj.className
          };
        }
        break;
      case 'File':
        if (obj.name) {
          return 'File';
        }
        break;
      case 'Date':
        if (obj.iso) {
          return 'Date';
        }
        break;
      case 'GeoPoint':
        if (obj.latitude != null && obj.longitude != null) {
          return 'GeoPoint';
        }
        break;
      case 'Bytes':
        if (obj.base64) {
          return 'Bytes';
        }
        break;
      case 'Polygon':
        if (obj.coordinates) {
          return 'Polygon';
        }
        break;
    }
    throw new Parse.Error(Parse.Error.INCORRECT_TYPE, 'This is not a valid ' + obj.__type);
  }
  if (obj['$ne']) {
    return getObjectType(obj['$ne']);
  }
  if (obj.__op) {
    switch (obj.__op) {
      case 'Increment':
        return 'Number';
      case 'Delete':
        return null;
      case 'Add':
      case 'AddUnique':
      case 'Remove':
        return 'Array';
      case 'AddRelation':
      case 'RemoveRelation':
        return {
          type: 'Relation',
          targetClass: obj.objects[0].className
        };
      case 'Batch':
        return getObjectType(obj.ops[0]);
      default:
        throw 'unexpected op: ' + obj.__op;
    }
  }
  return 'Object';
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfU3RvcmFnZUFkYXB0ZXIiLCJyZXF1aXJlIiwiX1NjaGVtYUNhY2hlIiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsIl9EYXRhYmFzZUNvbnRyb2xsZXIiLCJfQ29uZmlnIiwiX0Vycm9yIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiUGFyc2UiLCJkZWZhdWx0Q29sdW1ucyIsImV4cG9ydHMiLCJPYmplY3QiLCJmcmVlemUiLCJfRGVmYXVsdCIsIm9iamVjdElkIiwidHlwZSIsImNyZWF0ZWRBdCIsInVwZGF0ZWRBdCIsIkFDTCIsIl9Vc2VyIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsImVtYWlsIiwiZW1haWxWZXJpZmllZCIsImF1dGhEYXRhIiwiX0luc3RhbGxhdGlvbiIsImluc3RhbGxhdGlvbklkIiwiZGV2aWNlVG9rZW4iLCJjaGFubmVscyIsImRldmljZVR5cGUiLCJwdXNoVHlwZSIsIkdDTVNlbmRlcklkIiwidGltZVpvbmUiLCJsb2NhbGVJZGVudGlmaWVyIiwiYmFkZ2UiLCJhcHBWZXJzaW9uIiwiYXBwTmFtZSIsImFwcElkZW50aWZpZXIiLCJwYXJzZVZlcnNpb24iLCJfUm9sZSIsIm5hbWUiLCJ1c2VycyIsInRhcmdldENsYXNzIiwicm9sZXMiLCJfU2Vzc2lvbiIsInVzZXIiLCJzZXNzaW9uVG9rZW4iLCJleHBpcmVzQXQiLCJjcmVhdGVkV2l0aCIsIl9Qcm9kdWN0IiwicHJvZHVjdElkZW50aWZpZXIiLCJkb3dubG9hZCIsImRvd25sb2FkTmFtZSIsImljb24iLCJvcmRlciIsInRpdGxlIiwic3VidGl0bGUiLCJfUHVzaFN0YXR1cyIsInB1c2hUaW1lIiwic291cmNlIiwicXVlcnkiLCJwYXlsb2FkIiwiZXhwaXJ5IiwiZXhwaXJhdGlvbl9pbnRlcnZhbCIsInN0YXR1cyIsIm51bVNlbnQiLCJudW1GYWlsZWQiLCJwdXNoSGFzaCIsImVycm9yTWVzc2FnZSIsInNlbnRQZXJUeXBlIiwiZmFpbGVkUGVyVHlwZSIsInNlbnRQZXJVVENPZmZzZXQiLCJmYWlsZWRQZXJVVENPZmZzZXQiLCJjb3VudCIsIl9Kb2JTdGF0dXMiLCJqb2JOYW1lIiwibWVzc2FnZSIsInBhcmFtcyIsImZpbmlzaGVkQXQiLCJfSm9iU2NoZWR1bGUiLCJkZXNjcmlwdGlvbiIsInN0YXJ0QWZ0ZXIiLCJkYXlzT2ZXZWVrIiwidGltZU9mRGF5IiwibGFzdFJ1biIsInJlcGVhdE1pbnV0ZXMiLCJfSG9va3MiLCJmdW5jdGlvbk5hbWUiLCJjbGFzc05hbWUiLCJ0cmlnZ2VyTmFtZSIsInVybCIsIl9HbG9iYWxDb25maWciLCJtYXN0ZXJLZXlPbmx5IiwiX0dyYXBoUUxDb25maWciLCJjb25maWciLCJfQXVkaWVuY2UiLCJsYXN0VXNlZCIsInRpbWVzVXNlZCIsIl9JZGVtcG90ZW5jeSIsInJlcUlkIiwiZXhwaXJlIiwicmVxdWlyZWRDb2x1bW5zIiwicmVhZCIsIndyaXRlIiwiaW52YWxpZENvbHVtbnMiLCJzeXN0ZW1DbGFzc2VzIiwidm9sYXRpbGVDbGFzc2VzIiwicm9sZVJlZ2V4IiwicHJvdGVjdGVkRmllbGRzUG9pbnRlclJlZ2V4IiwicHVibGljUmVnZXgiLCJhdXRoZW50aWNhdGVkUmVnZXgiLCJyZXF1aXJlc0F1dGhlbnRpY2F0aW9uUmVnZXgiLCJjbHBQb2ludGVyUmVnZXgiLCJwcm90ZWN0ZWRGaWVsZHNSZWdleCIsImNscEZpZWxkc1JlZ2V4IiwidmFsaWRhdGVQZXJtaXNzaW9uS2V5Iiwia2V5IiwidXNlcklkUmVnRXhwIiwibWF0Y2hlc1NvbWUiLCJyZWdFeCIsIm1hdGNoIiwidmFsaWQiLCJFcnJvciIsIklOVkFMSURfSlNPTiIsInZhbGlkYXRlUHJvdGVjdGVkRmllbGRzS2V5IiwiQ0xQVmFsaWRLZXlzIiwidmFsaWRhdGVDTFAiLCJwZXJtcyIsImZpZWxkcyIsIm9wZXJhdGlvbktleSIsImluZGV4T2YiLCJvcGVyYXRpb24iLCJ2YWxpZGF0ZUNMUGpzb24iLCJmaWVsZE5hbWUiLCJ2YWxpZGF0ZVBvaW50ZXJQZXJtaXNzaW9uIiwiZW50aXR5IiwicHJvdGVjdGVkRmllbGRzIiwiQXJyYXkiLCJpc0FycmF5IiwiZmllbGQiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJwb2ludGVyRmllbGRzIiwicG9pbnRlckZpZWxkIiwicGVybWl0IiwidG9TdHJpbmciLCJpbnZhbGlkS2V5cyIsImtleXMiLCJmaWx0ZXIiLCJpbmNsdWRlcyIsImludmFsaWRWYWx1ZXMiLCJ2YWx1ZXMiLCJsZW5ndGgiLCJqb2luIiwiam9pbkNsYXNzUmVnZXgiLCJjbGFzc0FuZEZpZWxkUmVnZXgiLCJjbGFzc05hbWVJc1ZhbGlkIiwidGVzdCIsImZpZWxkTmFtZUlzVmFsaWQiLCJmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MiLCJpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZSIsImludmFsaWRKc29uRXJyb3IiLCJ2YWxpZE5vblJlbGF0aW9uT3JQb2ludGVyVHlwZXMiLCJmaWVsZFR5cGVJc0ludmFsaWQiLCJJTlZBTElEX0NMQVNTX05BTUUiLCJ1bmRlZmluZWQiLCJJTkNPUlJFQ1RfVFlQRSIsImNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEiLCJzY2hlbWEiLCJpbmplY3REZWZhdWx0U2NoZW1hIiwiX3JwZXJtIiwiX3dwZXJtIiwiX2hhc2hlZF9wYXNzd29yZCIsImNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYSIsImluZGV4ZXMiLCJTY2hlbWFEYXRhIiwiY29uc3RydWN0b3IiLCJhbGxTY2hlbWFzIiwiX19kYXRhIiwiX19wcm90ZWN0ZWRGaWVsZHMiLCJmb3JFYWNoIiwiZGVmaW5lUHJvcGVydHkiLCJnZXQiLCJkYXRhIiwiY2xhc3NMZXZlbFBlcm1pc3Npb25zIiwic3RydWN0dXJlZENsb25lIiwiY2xhc3NQcm90ZWN0ZWRGaWVsZHMiLCJ1bnEiLCJTZXQiLCJmcm9tIiwiZGVmYXVsdFNjaGVtYSIsIl9Ib29rc1NjaGVtYSIsIl9HbG9iYWxDb25maWdTY2hlbWEiLCJfR3JhcGhRTENvbmZpZ1NjaGVtYSIsIl9QdXNoU3RhdHVzU2NoZW1hIiwiX0pvYlN0YXR1c1NjaGVtYSIsIl9Kb2JTY2hlZHVsZVNjaGVtYSIsIl9BdWRpZW5jZVNjaGVtYSIsIl9JZGVtcG90ZW5jeVNjaGVtYSIsIlZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMiLCJkYlR5cGVNYXRjaGVzT2JqZWN0VHlwZSIsImRiVHlwZSIsIm9iamVjdFR5cGUiLCJ0eXBlVG9TdHJpbmciLCJ0dGwiLCJkYXRlIiwiRGF0ZSIsIm5vdyIsImR1cmF0aW9uIiwiU2NoZW1hQ29udHJvbGxlciIsImRhdGFiYXNlQWRhcHRlciIsIl9kYkFkYXB0ZXIiLCJDb25maWciLCJhcHBsaWNhdGlvbklkIiwic2NoZW1hRGF0YSIsIlNjaGVtYUNhY2hlIiwiYWxsIiwiY3VzdG9tSWRzIiwiYWxsb3dDdXN0b21PYmplY3RJZCIsImN1c3RvbUlkUmVnRXgiLCJhdXRvSWRSZWdFeCIsInVzZXJJZFJlZ0V4Iiwid2F0Y2giLCJyZWxvYWREYXRhIiwiY2xlYXJDYWNoZSIsInJlbG9hZERhdGFJZk5lZWRlZCIsImVuYWJsZVNjaGVtYUhvb2tzIiwib3B0aW9ucyIsInJlbG9hZERhdGFQcm9taXNlIiwiZ2V0QWxsQ2xhc3NlcyIsInRoZW4iLCJlcnIiLCJzZXRBbGxDbGFzc2VzIiwiY2FjaGVkIiwiUHJvbWlzZSIsInJlc29sdmUiLCJtYXAiLCJwdXQiLCJnZXRPbmVTY2hlbWEiLCJhbGxvd1ZvbGF0aWxlQ2xhc3NlcyIsImNsZWFyIiwib25lU2NoZW1hIiwiZmluZCIsInJlamVjdCIsImFkZENsYXNzSWZOb3RFeGlzdHMiLCJ2YWxpZGF0aW9uRXJyb3IiLCJ2YWxpZGF0ZU5ld0NsYXNzIiwiY29kZSIsImVycm9yIiwiYWRhcHRlclNjaGVtYSIsImNyZWF0ZUNsYXNzIiwicGFyc2VTY2hlbWEiLCJEVVBMSUNBVEVfVkFMVUUiLCJ1cGRhdGVDbGFzcyIsInN1Ym1pdHRlZEZpZWxkcyIsImRhdGFiYXNlIiwiZXhpc3RpbmdGaWVsZHMiLCJfX29wIiwibmV3U2NoZW1hIiwiYnVpbGRNZXJnZWRTY2hlbWFPYmplY3QiLCJkZWZhdWx0RmllbGRzIiwiZnVsbE5ld1NjaGVtYSIsImFzc2lnbiIsInZhbGlkYXRlU2NoZW1hRGF0YSIsImRlbGV0ZWRGaWVsZHMiLCJpbnNlcnRlZEZpZWxkcyIsInB1c2giLCJkZWxldGVQcm9taXNlIiwiZGVsZXRlRmllbGRzIiwiZW5mb3JjZUZpZWxkcyIsInByb21pc2VzIiwiZW5mb3JjZUZpZWxkRXhpc3RzIiwicmVzdWx0cyIsInJlc3VsdCIsInNldFBlcm1pc3Npb25zIiwic2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQiLCJlbnN1cmVGaWVsZHMiLCJyZWxvYWRlZFNjaGVtYSIsImNhdGNoIiwiZW5mb3JjZUNsYXNzRXhpc3RzIiwiZXhpc3RpbmdGaWVsZE5hbWVzIiwiSU5WQUxJRF9LRVlfTkFNRSIsImZpZWxkVHlwZSIsImRlZmF1bHRWYWx1ZSIsImRlZmF1bHRWYWx1ZVR5cGUiLCJnZXRUeXBlIiwicmVxdWlyZWQiLCJnZW9Qb2ludHMiLCJzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJpc1ZhbGlkYXRpb24iLCJtYWludGVuYW5jZSIsIngiLCJ5Iiwic3BsaXQiLCJpc0FycmF5SW5kZXgiLCJldmVyeSIsImMiLCJmaWVsZE5hbWVUb1ZhbGlkYXRlIiwiY2hhckF0Iiwic3Vic3RyaW5nIiwiZXhwZWN0ZWRUeXBlIiwiZ2V0RXhwZWN0ZWRUeXBlIiwiSlNPTiIsInN0cmluZ2lmeSIsInVwZGF0ZUZpZWxkT3B0aW9ucyIsImFkZEZpZWxkSWZOb3RFeGlzdHMiLCJpIiwiZGVsZXRlRmllbGQiLCJmaWVsZE5hbWVzIiwic2NoZW1hRmllbGRzIiwiYWRhcHRlciIsImRlbGV0ZUNsYXNzIiwidmFsaWRhdGVPYmplY3QiLCJvYmplY3QiLCJnZW9jb3VudCIsImV4cGVjdGVkIiwicHJvbWlzZSIsInRoZW5WYWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyIsInZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zIiwiY29sdW1ucyIsIm1pc3NpbmdDb2x1bW5zIiwiY29sdW1uIiwidGVzdFBlcm1pc3Npb25zRm9yQ2xhc3NOYW1lIiwiYWNsR3JvdXAiLCJ0ZXN0UGVybWlzc2lvbnMiLCJnZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJjbGFzc1Blcm1pc3Npb25zIiwic29tZSIsImFjbCIsInZhbGlkYXRlUGVybWlzc2lvbiIsImFjdGlvbiIsImNyZWF0ZVNhbml0aXplZEVycm9yIiwiT0JKRUNUX05PVF9GT1VORCIsInBlcm1pc3Npb25GaWVsZCIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJoYXNDbGFzcyIsImxvYWQiLCJkYkFkYXB0ZXIiLCJzY2hlbWFDYWNoZVR0bCIsInB1dFJlcXVlc3QiLCJzeXNTY2hlbWFGaWVsZCIsIl9pZCIsIm9sZEZpZWxkIiwiZmllbGRJc0RlbGV0ZWQiLCJuZXdGaWVsZCIsInNjaGVtYVByb21pc2UiLCJvYmoiLCJnZXRPYmplY3RUeXBlIiwiX190eXBlIiwiaXNvIiwibGF0aXR1ZGUiLCJsb25naXR1ZGUiLCJiYXNlNjQiLCJjb29yZGluYXRlcyIsIm9iamVjdHMiLCJvcHMiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvQ29udHJvbGxlcnMvU2NoZW1hQ29udHJvbGxlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAZmxvd1xuLy8gVGhpcyBjbGFzcyBoYW5kbGVzIHNjaGVtYSB2YWxpZGF0aW9uLCBwZXJzaXN0ZW5jZSwgYW5kIG1vZGlmaWNhdGlvbi5cbi8vXG4vLyBFYWNoIGluZGl2aWR1YWwgU2NoZW1hIG9iamVjdCBzaG91bGQgYmUgaW1tdXRhYmxlLiBUaGUgaGVscGVycyB0b1xuLy8gZG8gdGhpbmdzIHdpdGggdGhlIFNjaGVtYSBqdXN0IHJldHVybiBhIG5ldyBzY2hlbWEgd2hlbiB0aGUgc2NoZW1hXG4vLyBpcyBjaGFuZ2VkLlxuLy9cbi8vIFRoZSBjYW5vbmljYWwgcGxhY2UgdG8gc3RvcmUgdGhpcyBTY2hlbWEgaXMgaW4gdGhlIGRhdGFiYXNlIGl0c2VsZixcbi8vIGluIGEgX1NDSEVNQSBjb2xsZWN0aW9uLiBUaGlzIGlzIG5vdCB0aGUgcmlnaHQgd2F5IHRvIGRvIGl0IGZvciBhblxuLy8gb3BlbiBzb3VyY2UgZnJhbWV3b3JrLCBidXQgaXQncyBiYWNrd2FyZCBjb21wYXRpYmxlLCBzbyB3ZSdyZVxuLy8ga2VlcGluZyBpdCB0aGlzIHdheSBmb3Igbm93LlxuLy9cbi8vIEluIEFQSS1oYW5kbGluZyBjb2RlLCB5b3Ugc2hvdWxkIG9ubHkgdXNlIHRoZSBTY2hlbWEgY2xhc3MgdmlhIHRoZVxuLy8gRGF0YWJhc2VDb250cm9sbGVyLiBUaGlzIHdpbGwgbGV0IHVzIHJlcGxhY2UgdGhlIHNjaGVtYSBsb2dpYyBmb3Jcbi8vIGRpZmZlcmVudCBkYXRhYmFzZXMuXG4vLyBUT0RPOiBoaWRlIGFsbCBzY2hlbWEgbG9naWMgaW5zaWRlIHRoZSBkYXRhYmFzZSBhZGFwdGVyLlxuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5jb25zdCBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZTtcbmltcG9ydCB7IFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi4vQWRhcHRlcnMvU3RvcmFnZS9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgU2NoZW1hQ2FjaGUgZnJvbSAnLi4vQWRhcHRlcnMvQ2FjaGUvU2NoZW1hQ2FjaGUnO1xuaW1wb3J0IERhdGFiYXNlQ29udHJvbGxlciBmcm9tICcuL0RhdGFiYXNlQ29udHJvbGxlcic7XG5pbXBvcnQgQ29uZmlnIGZyb20gJy4uL0NvbmZpZyc7XG5pbXBvcnQgeyBjcmVhdGVTYW5pdGl6ZWRFcnJvciB9IGZyb20gJy4uL0Vycm9yJztcbmltcG9ydCB0eXBlIHtcbiAgU2NoZW1hLFxuICBTY2hlbWFGaWVsZHMsXG4gIENsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgU2NoZW1hRmllbGQsXG4gIExvYWRTY2hlbWFPcHRpb25zLFxufSBmcm9tICcuL3R5cGVzJztcblxuY29uc3QgZGVmYXVsdENvbHVtbnM6IHsgW3N0cmluZ106IFNjaGVtYUZpZWxkcyB9ID0gT2JqZWN0LmZyZWV6ZSh7XG4gIC8vIENvbnRhaW4gdGhlIGRlZmF1bHQgY29sdW1ucyBmb3IgZXZlcnkgcGFyc2Ugb2JqZWN0IHR5cGUgKGV4Y2VwdCBfSm9pbiBjb2xsZWN0aW9uKVxuICBfRGVmYXVsdDoge1xuICAgIG9iamVjdElkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgY3JlYXRlZEF0OiB7IHR5cGU6ICdEYXRlJyB9LFxuICAgIHVwZGF0ZWRBdDogeyB0eXBlOiAnRGF0ZScgfSxcbiAgICBBQ0w6IHsgdHlwZTogJ0FDTCcgfSxcbiAgfSxcbiAgLy8gVGhlIGFkZGl0aW9uYWwgZGVmYXVsdCBjb2x1bW5zIGZvciB0aGUgX1VzZXIgY29sbGVjdGlvbiAoaW4gYWRkaXRpb24gdG8gRGVmYXVsdENvbHMpXG4gIF9Vc2VyOiB7XG4gICAgdXNlcm5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBwYXNzd29yZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGVtYWlsOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZW1haWxWZXJpZmllZDogeyB0eXBlOiAnQm9vbGVhbicgfSxcbiAgICBhdXRoRGF0YTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfSW5zdGFsbGF0aW9uIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfSW5zdGFsbGF0aW9uOiB7XG4gICAgaW5zdGFsbGF0aW9uSWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkZXZpY2VUb2tlbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGNoYW5uZWxzOiB7IHR5cGU6ICdBcnJheScgfSxcbiAgICBkZXZpY2VUeXBlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcHVzaFR5cGU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBHQ01TZW5kZXJJZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHRpbWVab25lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgbG9jYWxlSWRlbnRpZmllcjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGJhZGdlOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgYXBwVmVyc2lvbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGFwcE5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBhcHBJZGVudGlmaWVyOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFyc2VWZXJzaW9uOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9Sb2xlIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfUm9sZToge1xuICAgIG5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICB1c2VyczogeyB0eXBlOiAnUmVsYXRpb24nLCB0YXJnZXRDbGFzczogJ19Vc2VyJyB9LFxuICAgIHJvbGVzOiB7IHR5cGU6ICdSZWxhdGlvbicsIHRhcmdldENsYXNzOiAnX1JvbGUnIH0sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9TZXNzaW9uIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfU2Vzc2lvbjoge1xuICAgIHVzZXI6IHsgdHlwZTogJ1BvaW50ZXInLCB0YXJnZXRDbGFzczogJ19Vc2VyJyB9LFxuICAgIGluc3RhbGxhdGlvbklkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgc2Vzc2lvblRva2VuOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZXhwaXJlc0F0OiB7IHR5cGU6ICdEYXRlJyB9LFxuICAgIGNyZWF0ZWRXaXRoOiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gIH0sXG4gIF9Qcm9kdWN0OiB7XG4gICAgcHJvZHVjdElkZW50aWZpZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkb3dubG9hZDogeyB0eXBlOiAnRmlsZScgfSxcbiAgICBkb3dubG9hZE5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBpY29uOiB7IHR5cGU6ICdGaWxlJyB9LFxuICAgIG9yZGVyOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgdGl0bGU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzdWJ0aXRsZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICBfUHVzaFN0YXR1czoge1xuICAgIHB1c2hUaW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgc291cmNlOiB7IHR5cGU6ICdTdHJpbmcnIH0sIC8vIHJlc3Qgb3Igd2VidWlcbiAgICBxdWVyeTogeyB0eXBlOiAnU3RyaW5nJyB9LCAvLyB0aGUgc3RyaW5naWZpZWQgSlNPTiBxdWVyeVxuICAgIHBheWxvYWQ6IHsgdHlwZTogJ1N0cmluZycgfSwgLy8gdGhlIHN0cmluZ2lmaWVkIEpTT04gcGF5bG9hZCxcbiAgICB0aXRsZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGV4cGlyeTogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICAgIGV4cGlyYXRpb25faW50ZXJ2YWw6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICBzdGF0dXM6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBudW1TZW50OiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgbnVtRmFpbGVkOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgcHVzaEhhc2g6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBlcnJvck1lc3NhZ2U6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBzZW50UGVyVHlwZTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICAgIGZhaWxlZFBlclR5cGU6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBzZW50UGVyVVRDT2Zmc2V0OiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gICAgZmFpbGVkUGVyVVRDT2Zmc2V0OiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gICAgY291bnQ6IHsgdHlwZTogJ051bWJlcicgfSwgLy8gdHJhY2tzICMgb2YgYmF0Y2hlcyBxdWV1ZWQgYW5kIHBlbmRpbmdcbiAgfSxcbiAgX0pvYlN0YXR1czoge1xuICAgIGpvYk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzb3VyY2U6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzdGF0dXM6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBtZXNzYWdlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFyYW1zOiB7IHR5cGU6ICdPYmplY3QnIH0sIC8vIHBhcmFtcyByZWNlaXZlZCB3aGVuIGNhbGxpbmcgdGhlIGpvYlxuICAgIGZpbmlzaGVkQXQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gIH0sXG4gIF9Kb2JTY2hlZHVsZToge1xuICAgIGpvYk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkZXNjcmlwdGlvbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHBhcmFtczogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHN0YXJ0QWZ0ZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkYXlzT2ZXZWVrOiB7IHR5cGU6ICdBcnJheScgfSxcbiAgICB0aW1lT2ZEYXk6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBsYXN0UnVuOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgcmVwZWF0TWludXRlczogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICB9LFxuICBfSG9va3M6IHtcbiAgICBmdW5jdGlvbk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBjbGFzc05hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICB0cmlnZ2VyTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHVybDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICBfR2xvYmFsQ29uZmlnOiB7XG4gICAgb2JqZWN0SWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBwYXJhbXM6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBtYXN0ZXJLZXlPbmx5OiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gIH0sXG4gIF9HcmFwaFFMQ29uZmlnOiB7XG4gICAgb2JqZWN0SWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBjb25maWc6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgfSxcbiAgX0F1ZGllbmNlOiB7XG4gICAgb2JqZWN0SWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBuYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcXVlcnk6IHsgdHlwZTogJ1N0cmluZycgfSwgLy9zdG9yaW5nIHF1ZXJ5IGFzIEpTT04gc3RyaW5nIHRvIHByZXZlbnQgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiIGVycm9yXG4gICAgbGFzdFVzZWQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gICAgdGltZXNVc2VkOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gIH0sXG4gIF9JZGVtcG90ZW5jeToge1xuICAgIHJlcUlkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZXhwaXJlOiB7IHR5cGU6ICdEYXRlJyB9LFxuICB9LFxufSk7XG5cbi8vIGZpZWxkcyByZXF1aXJlZCBmb3IgcmVhZCBvciB3cml0ZSBvcGVyYXRpb25zIG9uIHRoZWlyIHJlc3BlY3RpdmUgY2xhc3Nlcy5cbmNvbnN0IHJlcXVpcmVkQ29sdW1ucyA9IE9iamVjdC5mcmVlemUoe1xuICByZWFkOiB7XG4gICAgX1VzZXI6IFsndXNlcm5hbWUnXSxcbiAgfSxcbiAgd3JpdGU6IHtcbiAgICBfUHJvZHVjdDogWydwcm9kdWN0SWRlbnRpZmllcicsICdpY29uJywgJ29yZGVyJywgJ3RpdGxlJywgJ3N1YnRpdGxlJ10sXG4gICAgX1JvbGU6IFsnbmFtZScsICdBQ0wnXSxcbiAgfSxcbn0pO1xuXG5jb25zdCBpbnZhbGlkQ29sdW1ucyA9IFsnbGVuZ3RoJ107XG5cbmNvbnN0IHN5c3RlbUNsYXNzZXMgPSBPYmplY3QuZnJlZXplKFtcbiAgJ19Vc2VyJyxcbiAgJ19JbnN0YWxsYXRpb24nLFxuICAnX1JvbGUnLFxuICAnX1Nlc3Npb24nLFxuICAnX1Byb2R1Y3QnLFxuICAnX1B1c2hTdGF0dXMnLFxuICAnX0pvYlN0YXR1cycsXG4gICdfSm9iU2NoZWR1bGUnLFxuICAnX0F1ZGllbmNlJyxcbiAgJ19JZGVtcG90ZW5jeScsXG5dKTtcblxuY29uc3Qgdm9sYXRpbGVDbGFzc2VzID0gT2JqZWN0LmZyZWV6ZShbXG4gICdfSm9iU3RhdHVzJyxcbiAgJ19QdXNoU3RhdHVzJyxcbiAgJ19Ib29rcycsXG4gICdfR2xvYmFsQ29uZmlnJyxcbiAgJ19HcmFwaFFMQ29uZmlnJyxcbiAgJ19Kb2JTY2hlZHVsZScsXG4gICdfQXVkaWVuY2UnLFxuICAnX0lkZW1wb3RlbmN5Jyxcbl0pO1xuXG4vLyBBbnl0aGluZyB0aGF0IHN0YXJ0IHdpdGggcm9sZVxuY29uc3Qgcm9sZVJlZ2V4ID0gL15yb2xlOi4qLztcbi8vIEFueXRoaW5nIHRoYXQgc3RhcnRzIHdpdGggdXNlckZpZWxkIChhbGxvd2VkIGZvciBwcm90ZWN0ZWQgZmllbGRzIG9ubHkpXG5jb25zdCBwcm90ZWN0ZWRGaWVsZHNQb2ludGVyUmVnZXggPSAvXnVzZXJGaWVsZDouKi87XG4vLyAqIHBlcm1pc3Npb25cbmNvbnN0IHB1YmxpY1JlZ2V4ID0gL15cXCokLztcblxuY29uc3QgYXV0aGVudGljYXRlZFJlZ2V4ID0gL15hdXRoZW50aWNhdGVkJC87XG5cbmNvbnN0IHJlcXVpcmVzQXV0aGVudGljYXRpb25SZWdleCA9IC9ecmVxdWlyZXNBdXRoZW50aWNhdGlvbiQvO1xuXG5jb25zdCBjbHBQb2ludGVyUmVnZXggPSAvXnBvaW50ZXJGaWVsZHMkLztcblxuLy8gcmVnZXggZm9yIHZhbGlkYXRpbmcgZW50aXRpZXMgaW4gcHJvdGVjdGVkRmllbGRzIG9iamVjdFxuY29uc3QgcHJvdGVjdGVkRmllbGRzUmVnZXggPSBPYmplY3QuZnJlZXplKFtcbiAgcHJvdGVjdGVkRmllbGRzUG9pbnRlclJlZ2V4LFxuICBwdWJsaWNSZWdleCxcbiAgYXV0aGVudGljYXRlZFJlZ2V4LFxuICByb2xlUmVnZXgsXG5dKTtcblxuLy8gY2xwIHJlZ2V4XG5jb25zdCBjbHBGaWVsZHNSZWdleCA9IE9iamVjdC5mcmVlemUoW1xuICBjbHBQb2ludGVyUmVnZXgsXG4gIHB1YmxpY1JlZ2V4LFxuICByZXF1aXJlc0F1dGhlbnRpY2F0aW9uUmVnZXgsXG4gIHJvbGVSZWdleCxcbl0pO1xuXG5mdW5jdGlvbiB2YWxpZGF0ZVBlcm1pc3Npb25LZXkoa2V5LCB1c2VySWRSZWdFeHApIHtcbiAgbGV0IG1hdGNoZXNTb21lID0gZmFsc2U7XG4gIGZvciAoY29uc3QgcmVnRXggb2YgY2xwRmllbGRzUmVnZXgpIHtcbiAgICBpZiAoa2V5Lm1hdGNoKHJlZ0V4KSAhPT0gbnVsbCkge1xuICAgICAgbWF0Y2hlc1NvbWUgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgLy8gdXNlcklkIGRlcGVuZHMgb24gc3RhcnR1cCBvcHRpb25zIHNvIGl0J3MgZHluYW1pY1xuICBjb25zdCB2YWxpZCA9IG1hdGNoZXNTb21lIHx8IGtleS5tYXRjaCh1c2VySWRSZWdFeHApICE9PSBudWxsO1xuICBpZiAoIXZhbGlkKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgYCcke2tleX0nIGlzIG5vdCBhIHZhbGlkIGtleSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnNgXG4gICAgKTtcbiAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZVByb3RlY3RlZEZpZWxkc0tleShrZXksIHVzZXJJZFJlZ0V4cCkge1xuICBsZXQgbWF0Y2hlc1NvbWUgPSBmYWxzZTtcbiAgZm9yIChjb25zdCByZWdFeCBvZiBwcm90ZWN0ZWRGaWVsZHNSZWdleCkge1xuICAgIGlmIChrZXkubWF0Y2gocmVnRXgpICE9PSBudWxsKSB7XG4gICAgICBtYXRjaGVzU29tZSA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICAvLyB1c2VySWQgcmVnZXggZGVwZW5kcyBvbiBsYXVuY2ggb3B0aW9ucyBzbyBpdCdzIGR5bmFtaWNcbiAgY29uc3QgdmFsaWQgPSBtYXRjaGVzU29tZSB8fCBrZXkubWF0Y2godXNlcklkUmVnRXhwKSAhPT0gbnVsbDtcbiAgaWYgKCF2YWxpZCkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgIGAnJHtrZXl9JyBpcyBub3QgYSB2YWxpZCBrZXkgZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zYFxuICAgICk7XG4gIH1cbn1cblxuY29uc3QgQ0xQVmFsaWRLZXlzID0gT2JqZWN0LmZyZWV6ZShbXG4gICdBQ0wnLFxuICAnZmluZCcsXG4gICdjb3VudCcsXG4gICdnZXQnLFxuICAnY3JlYXRlJyxcbiAgJ3VwZGF0ZScsXG4gICdkZWxldGUnLFxuICAnYWRkRmllbGQnLFxuICAncmVhZFVzZXJGaWVsZHMnLFxuICAnd3JpdGVVc2VyRmllbGRzJyxcbiAgJ3Byb3RlY3RlZEZpZWxkcycsXG5dKTtcblxuLy8gdmFsaWRhdGlvbiBiZWZvcmUgc2V0dGluZyBjbGFzcy1sZXZlbCBwZXJtaXNzaW9ucyBvbiBjb2xsZWN0aW9uXG5mdW5jdGlvbiB2YWxpZGF0ZUNMUChwZXJtczogQ2xhc3NMZXZlbFBlcm1pc3Npb25zLCBmaWVsZHM6IFNjaGVtYUZpZWxkcywgdXNlcklkUmVnRXhwOiBSZWdFeHApIHtcbiAgaWYgKCFwZXJtcykge1xuICAgIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IG9wZXJhdGlvbktleSBpbiBwZXJtcykge1xuICAgIGlmIChDTFBWYWxpZEtleXMuaW5kZXhPZihvcGVyYXRpb25LZXkpID09IC0xKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgYCR7b3BlcmF0aW9uS2V5fSBpcyBub3QgYSB2YWxpZCBvcGVyYXRpb24gZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBvcGVyYXRpb24gPSBwZXJtc1tvcGVyYXRpb25LZXldO1xuICAgIC8vIHByb2NlZWQgd2l0aCBuZXh0IG9wZXJhdGlvbktleVxuXG4gICAgLy8gdGhyb3dzIHdoZW4gcm9vdCBmaWVsZHMgYXJlIG9mIHdyb25nIHR5cGVcbiAgICB2YWxpZGF0ZUNMUGpzb24ob3BlcmF0aW9uLCBvcGVyYXRpb25LZXkpO1xuXG4gICAgaWYgKG9wZXJhdGlvbktleSA9PT0gJ3JlYWRVc2VyRmllbGRzJyB8fCBvcGVyYXRpb25LZXkgPT09ICd3cml0ZVVzZXJGaWVsZHMnKSB7XG4gICAgICAvLyB2YWxpZGF0ZSBncm91cGVkIHBvaW50ZXIgcGVybWlzc2lvbnNcbiAgICAgIC8vIG11c3QgYmUgYW4gYXJyYXkgd2l0aCBmaWVsZCBuYW1lc1xuICAgICAgZm9yIChjb25zdCBmaWVsZE5hbWUgb2Ygb3BlcmF0aW9uKSB7XG4gICAgICAgIHZhbGlkYXRlUG9pbnRlclBlcm1pc3Npb24oZmllbGROYW1lLCBmaWVsZHMsIG9wZXJhdGlvbktleSk7XG4gICAgICB9XG4gICAgICAvLyByZWFkVXNlckZpZWxkcyBhbmQgd3JpdGVyVXNlckZpZWxkcyBkbyBub3QgaGF2ZSBuZXNkdGVkIGZpZWxkc1xuICAgICAgLy8gcHJvY2VlZCB3aXRoIG5leHQgb3BlcmF0aW9uS2V5XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyB2YWxpZGF0ZSBwcm90ZWN0ZWQgZmllbGRzXG4gICAgaWYgKG9wZXJhdGlvbktleSA9PT0gJ3Byb3RlY3RlZEZpZWxkcycpIHtcbiAgICAgIGZvciAoY29uc3QgZW50aXR5IGluIG9wZXJhdGlvbikge1xuICAgICAgICAvLyB0aHJvd3Mgb24gdW5leHBlY3RlZCBrZXlcbiAgICAgICAgdmFsaWRhdGVQcm90ZWN0ZWRGaWVsZHNLZXkoZW50aXR5LCB1c2VySWRSZWdFeHApO1xuXG4gICAgICAgIGNvbnN0IHByb3RlY3RlZEZpZWxkcyA9IG9wZXJhdGlvbltlbnRpdHldO1xuXG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShwcm90ZWN0ZWRGaWVsZHMpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgYCcke3Byb3RlY3RlZEZpZWxkc30nIGlzIG5vdCBhIHZhbGlkIHZhbHVlIGZvciBwcm90ZWN0ZWRGaWVsZHNbJHtlbnRpdHl9XSAtIGV4cGVjdGVkIGFuIGFycmF5LmBcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gaWYgdGhlIGZpZWxkIGlzIGluIGZvcm0gb2YgYXJyYXlcbiAgICAgICAgZm9yIChjb25zdCBmaWVsZCBvZiBwcm90ZWN0ZWRGaWVsZHMpIHtcbiAgICAgICAgICAvLyBkbyBub3QgYWxsb293IHRvIHByb3RlY3QgZGVmYXVsdCBmaWVsZHNcbiAgICAgICAgICBpZiAoZGVmYXVsdENvbHVtbnMuX0RlZmF1bHRbZmllbGRdKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgYERlZmF1bHQgZmllbGQgJyR7ZmllbGR9JyBjYW4gbm90IGJlIHByb3RlY3RlZGBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIGZpZWxkIHNob3VsZCBleGlzdCBvbiBjb2xsZWN0aW9uXG4gICAgICAgICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZmllbGRzLCBmaWVsZCkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICBgRmllbGQgJyR7ZmllbGR9JyBpbiBwcm90ZWN0ZWRGaWVsZHM6JHtlbnRpdHl9IGRvZXMgbm90IGV4aXN0YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIHByb2NlZWQgd2l0aCBuZXh0IG9wZXJhdGlvbktleVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gdmFsaWRhdGUgb3RoZXIgZmllbGRzXG4gICAgLy8gRW50aXR5IGNhbiBiZTpcbiAgICAvLyBcIipcIiAtIFB1YmxpYyxcbiAgICAvLyBcInJlcXVpcmVzQXV0aGVudGljYXRpb25cIiAtIGF1dGhlbnRpY2F0ZWQgdXNlcnMsXG4gICAgLy8gXCJvYmplY3RJZFwiIC0gX1VzZXIgaWQsXG4gICAgLy8gXCJyb2xlOnJvbGVuYW1lXCIsXG4gICAgLy8gXCJwb2ludGVyRmllbGRzXCIgLSBhcnJheSBvZiBmaWVsZCBuYW1lcyBjb250YWluaW5nIHBvaW50ZXJzIHRvIHVzZXJzXG4gICAgZm9yIChjb25zdCBlbnRpdHkgaW4gb3BlcmF0aW9uKSB7XG4gICAgICAvLyB0aHJvd3Mgb24gdW5leHBlY3RlZCBrZXlcbiAgICAgIHZhbGlkYXRlUGVybWlzc2lvbktleShlbnRpdHksIHVzZXJJZFJlZ0V4cCk7XG5cbiAgICAgIC8vIGVudGl0eSBjYW4gYmUgZWl0aGVyOlxuICAgICAgLy8gXCJwb2ludGVyRmllbGRzXCI6IHN0cmluZ1tdXG4gICAgICBpZiAoZW50aXR5ID09PSAncG9pbnRlckZpZWxkcycpIHtcbiAgICAgICAgY29uc3QgcG9pbnRlckZpZWxkcyA9IG9wZXJhdGlvbltlbnRpdHldO1xuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBvaW50ZXJGaWVsZHMpKSB7XG4gICAgICAgICAgZm9yIChjb25zdCBwb2ludGVyRmllbGQgb2YgcG9pbnRlckZpZWxkcykge1xuICAgICAgICAgICAgdmFsaWRhdGVQb2ludGVyUGVybWlzc2lvbihwb2ludGVyRmllbGQsIGZpZWxkcywgb3BlcmF0aW9uKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgYCcke3BvaW50ZXJGaWVsZHN9JyBpcyBub3QgYSB2YWxpZCB2YWx1ZSBmb3IgJHtvcGVyYXRpb25LZXl9WyR7ZW50aXR5fV0gLSBleHBlY3RlZCBhbiBhcnJheS5gXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBwcm9jZWVkIHdpdGggbmV4dCBlbnRpdHkga2V5XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwZXJtaXQgPSBvcGVyYXRpb25bZW50aXR5XTtcblxuICAgICAgaWYgKG9wZXJhdGlvbktleSA9PT0gJ0FDTCcpIHtcbiAgICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChwZXJtaXQpICE9PSAnW29iamVjdCBPYmplY3RdJykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgIGAnJHtwZXJtaXR9JyBpcyBub3QgYSB2YWxpZCB2YWx1ZSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnMgYWNsYFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaW52YWxpZEtleXMgPSBPYmplY3Qua2V5cyhwZXJtaXQpLmZpbHRlcihrZXkgPT4gIVsncmVhZCcsICd3cml0ZSddLmluY2x1ZGVzKGtleSkpO1xuICAgICAgICBjb25zdCBpbnZhbGlkVmFsdWVzID0gT2JqZWN0LnZhbHVlcyhwZXJtaXQpLmZpbHRlcihrZXkgPT4gdHlwZW9mIGtleSAhPT0gJ2Jvb2xlYW4nKTtcbiAgICAgICAgaWYgKGludmFsaWRLZXlzLmxlbmd0aCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgIGAnJHtpbnZhbGlkS2V5cy5qb2luKCcsJyl9JyBpcyBub3QgYSB2YWxpZCBrZXkgZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zIGFjbGBcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGludmFsaWRWYWx1ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgYCcke2ludmFsaWRWYWx1ZXMuam9pbignLCcpfScgaXMgbm90IGEgdmFsaWQgdmFsdWUgZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zIGFjbGBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHBlcm1pdCAhPT0gdHJ1ZSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGAnJHtwZXJtaXR9JyBpcyBub3QgYSB2YWxpZCB2YWx1ZSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnMgYWNsICR7b3BlcmF0aW9uS2V5fToke2VudGl0eX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlQ0xQanNvbihvcGVyYXRpb246IGFueSwgb3BlcmF0aW9uS2V5OiBzdHJpbmcpIHtcbiAgaWYgKG9wZXJhdGlvbktleSA9PT0gJ3JlYWRVc2VyRmllbGRzJyB8fCBvcGVyYXRpb25LZXkgPT09ICd3cml0ZVVzZXJGaWVsZHMnKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9wZXJhdGlvbikpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICBgJyR7b3BlcmF0aW9ufScgaXMgbm90IGEgdmFsaWQgdmFsdWUgZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zICR7b3BlcmF0aW9uS2V5fSAtIG11c3QgYmUgYW4gYXJyYXlgXG4gICAgICApO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBpZiAodHlwZW9mIG9wZXJhdGlvbiA9PT0gJ29iamVjdCcgJiYgb3BlcmF0aW9uICE9PSBudWxsKSB7XG4gICAgICAvLyBvayB0byBwcm9jZWVkXG4gICAgICByZXR1cm47XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICBgJyR7b3BlcmF0aW9ufScgaXMgbm90IGEgdmFsaWQgdmFsdWUgZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zICR7b3BlcmF0aW9uS2V5fSAtIG11c3QgYmUgYW4gb2JqZWN0YFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVQb2ludGVyUGVybWlzc2lvbihmaWVsZE5hbWU6IHN0cmluZywgZmllbGRzOiBPYmplY3QsIG9wZXJhdGlvbjogc3RyaW5nKSB7XG4gIC8vIFVzZXMgY29sbGVjdGlvbiBzY2hlbWEgdG8gZW5zdXJlIHRoZSBmaWVsZCBpcyBvZiB0eXBlOlxuICAvLyAtIFBvaW50ZXI8X1VzZXI+IChwb2ludGVycylcbiAgLy8gLSBBcnJheVxuICAvL1xuICAvLyAgICBJdCdzIG5vdCBwb3NzaWJsZSB0byBlbmZvcmNlIHR5cGUgb24gQXJyYXkncyBpdGVtcyBpbiBzY2hlbWFcbiAgLy8gIHNvIHdlIGFjY2VwdCBhbnkgQXJyYXkgZmllbGQsIGFuZCBsYXRlciB3aGVuIGFwcGx5aW5nIHBlcm1pc3Npb25zXG4gIC8vICBvbmx5IGl0ZW1zIHRoYXQgYXJlIHBvaW50ZXJzIHRvIF9Vc2VyIGFyZSBjb25zaWRlcmVkLlxuICBpZiAoXG4gICAgIShcbiAgICAgIGZpZWxkc1tmaWVsZE5hbWVdICYmXG4gICAgICAoKGZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT0gJ1BvaW50ZXInICYmIGZpZWxkc1tmaWVsZE5hbWVdLnRhcmdldENsYXNzID09ICdfVXNlcicpIHx8XG4gICAgICAgIGZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT0gJ0FycmF5JylcbiAgICApXG4gICkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgIGAnJHtmaWVsZE5hbWV9JyBpcyBub3QgYSB2YWxpZCBjb2x1bW4gZm9yIGNsYXNzIGxldmVsIHBvaW50ZXIgcGVybWlzc2lvbnMgJHtvcGVyYXRpb259YFxuICAgICk7XG4gIH1cbn1cblxuY29uc3Qgam9pbkNsYXNzUmVnZXggPSAvXl9Kb2luOltBLVphLXowLTlfXSs6W0EtWmEtejAtOV9dKy87XG5jb25zdCBjbGFzc0FuZEZpZWxkUmVnZXggPSAvXltBLVphLXpdW0EtWmEtejAtOV9dKiQvO1xuZnVuY3Rpb24gY2xhc3NOYW1lSXNWYWxpZChjbGFzc05hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAvLyBWYWxpZCBjbGFzc2VzIG11c3Q6XG4gIHJldHVybiAoXG4gICAgLy8gQmUgb25lIG9mIF9Vc2VyLCBfSW5zdGFsbGF0aW9uLCBfUm9sZSwgX1Nlc3Npb24gT1JcbiAgICBzeXN0ZW1DbGFzc2VzLmluZGV4T2YoY2xhc3NOYW1lKSA+IC0xIHx8XG4gICAgLy8gQmUgYSBqb2luIHRhYmxlIE9SXG4gICAgam9pbkNsYXNzUmVnZXgudGVzdChjbGFzc05hbWUpIHx8XG4gICAgLy8gSW5jbHVkZSBvbmx5IGFscGhhLW51bWVyaWMgYW5kIHVuZGVyc2NvcmVzLCBhbmQgbm90IHN0YXJ0IHdpdGggYW4gdW5kZXJzY29yZSBvciBudW1iZXJcbiAgICBmaWVsZE5hbWVJc1ZhbGlkKGNsYXNzTmFtZSwgY2xhc3NOYW1lKVxuICApO1xufVxuXG4vLyBWYWxpZCBmaWVsZHMgbXVzdCBiZSBhbHBoYS1udW1lcmljLCBhbmQgbm90IHN0YXJ0IHdpdGggYW4gdW5kZXJzY29yZSBvciBudW1iZXJcbi8vIG11c3Qgbm90IGJlIGEgcmVzZXJ2ZWQga2V5XG5mdW5jdGlvbiBmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZTogc3RyaW5nLCBjbGFzc05hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoY2xhc3NOYW1lICYmIGNsYXNzTmFtZSAhPT0gJ19Ib29rcycpIHtcbiAgICBpZiAoZmllbGROYW1lID09PSAnY2xhc3NOYW1lJykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2xhc3NBbmRGaWVsZFJlZ2V4LnRlc3QoZmllbGROYW1lKSAmJiAhaW52YWxpZENvbHVtbnMuaW5jbHVkZXMoZmllbGROYW1lKTtcbn1cblxuLy8gQ2hlY2tzIHRoYXQgaXQncyBub3QgdHJ5aW5nIHRvIGNsb2JiZXIgb25lIG9mIHRoZSBkZWZhdWx0IGZpZWxkcyBvZiB0aGUgY2xhc3MuXG5mdW5jdGlvbiBmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MoZmllbGROYW1lOiBzdHJpbmcsIGNsYXNzTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmICghZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWUsIGNsYXNzTmFtZSkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0W2ZpZWxkTmFtZV0pIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0gJiYgZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXVtmaWVsZE5hbWVdKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZShjbGFzc05hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiAoXG4gICAgJ0ludmFsaWQgY2xhc3NuYW1lOiAnICtcbiAgICBjbGFzc05hbWUgK1xuICAgICcsIGNsYXNzbmFtZXMgY2FuIG9ubHkgaGF2ZSBhbHBoYW51bWVyaWMgY2hhcmFjdGVycyBhbmQgXywgYW5kIG11c3Qgc3RhcnQgd2l0aCBhbiBhbHBoYSBjaGFyYWN0ZXIgJ1xuICApO1xufVxuXG5jb25zdCBpbnZhbGlkSnNvbkVycm9yID0gbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2ludmFsaWQgSlNPTicpO1xuY29uc3QgdmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzID0gW1xuICAnTnVtYmVyJyxcbiAgJ1N0cmluZycsXG4gICdCb29sZWFuJyxcbiAgJ0RhdGUnLFxuICAnT2JqZWN0JyxcbiAgJ0FycmF5JyxcbiAgJ0dlb1BvaW50JyxcbiAgJ0ZpbGUnLFxuICAnQnl0ZXMnLFxuICAnUG9seWdvbicsXG5dO1xuLy8gUmV0dXJucyBhbiBlcnJvciBzdWl0YWJsZSBmb3IgdGhyb3dpbmcgaWYgdGhlIHR5cGUgaXMgaW52YWxpZFxuY29uc3QgZmllbGRUeXBlSXNJbnZhbGlkID0gKHsgdHlwZSwgdGFyZ2V0Q2xhc3MgfSkgPT4ge1xuICBpZiAoWydQb2ludGVyJywgJ1JlbGF0aW9uJ10uaW5kZXhPZih0eXBlKSA+PSAwKSB7XG4gICAgaWYgKCF0YXJnZXRDbGFzcykge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcigxMzUsIGB0eXBlICR7dHlwZX0gbmVlZHMgYSBjbGFzcyBuYW1lYCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdGFyZ2V0Q2xhc3MgIT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gaW52YWxpZEpzb25FcnJvcjtcbiAgICB9IGVsc2UgaWYgKCFjbGFzc05hbWVJc1ZhbGlkKHRhcmdldENsYXNzKSkge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsIGludmFsaWRDbGFzc05hbWVNZXNzYWdlKHRhcmdldENsYXNzKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG4gIGlmICh0eXBlb2YgdHlwZSAhPT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gaW52YWxpZEpzb25FcnJvcjtcbiAgfVxuICBpZiAodmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzLmluZGV4T2YodHlwZSkgPCAwKSB7XG4gICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSwgYGludmFsaWQgZmllbGQgdHlwZTogJHt0eXBlfWApO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG5jb25zdCBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hID0gKHNjaGVtYTogYW55KSA9PiB7XG4gIHNjaGVtYSA9IGluamVjdERlZmF1bHRTY2hlbWEoc2NoZW1hKTtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuQUNMO1xuICBzY2hlbWEuZmllbGRzLl9ycGVybSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuICBzY2hlbWEuZmllbGRzLl93cGVybSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuXG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMucGFzc3dvcmQ7XG4gICAgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICB9XG5cbiAgcmV0dXJuIHNjaGVtYTtcbn07XG5cbmNvbnN0IGNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYSA9ICh7IC4uLnNjaGVtYSB9KSA9PiB7XG4gIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl9ycGVybTtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3dwZXJtO1xuXG4gIHNjaGVtYS5maWVsZHMuQUNMID0geyB0eXBlOiAnQUNMJyB9O1xuXG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuYXV0aERhdGE7IC8vQXV0aCBkYXRhIGlzIGltcGxpY2l0XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZDtcbiAgICBzY2hlbWEuZmllbGRzLnBhc3N3b3JkID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICB9XG5cbiAgaWYgKHNjaGVtYS5pbmRleGVzICYmIE9iamVjdC5rZXlzKHNjaGVtYS5pbmRleGVzKS5sZW5ndGggPT09IDApIHtcbiAgICBkZWxldGUgc2NoZW1hLmluZGV4ZXM7XG4gIH1cblxuICByZXR1cm4gc2NoZW1hO1xufTtcblxuY2xhc3MgU2NoZW1hRGF0YSB7XG4gIF9fZGF0YTogYW55O1xuICBfX3Byb3RlY3RlZEZpZWxkczogYW55O1xuICBjb25zdHJ1Y3RvcihhbGxTY2hlbWFzID0gW10sIHByb3RlY3RlZEZpZWxkcyA9IHt9KSB7XG4gICAgdGhpcy5fX2RhdGEgPSB7fTtcbiAgICB0aGlzLl9fcHJvdGVjdGVkRmllbGRzID0gcHJvdGVjdGVkRmllbGRzO1xuICAgIGFsbFNjaGVtYXMuZm9yRWFjaChzY2hlbWEgPT4ge1xuICAgICAgaWYgKHZvbGF0aWxlQ2xhc3Nlcy5pbmNsdWRlcyhzY2hlbWEuY2xhc3NOYW1lKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgc2NoZW1hLmNsYXNzTmFtZSwge1xuICAgICAgICBnZXQ6ICgpID0+IHtcbiAgICAgICAgICBpZiAoIXRoaXMuX19kYXRhW3NjaGVtYS5jbGFzc05hbWVdKSB7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0ge307XG4gICAgICAgICAgICBkYXRhLmZpZWxkcyA9IGluamVjdERlZmF1bHRTY2hlbWEoc2NoZW1hKS5maWVsZHM7XG4gICAgICAgICAgICBkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyA9IHN0cnVjdHVyZWRDbG9uZShzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zKTtcbiAgICAgICAgICAgIGRhdGEuaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuXG4gICAgICAgICAgICBjb25zdCBjbGFzc1Byb3RlY3RlZEZpZWxkcyA9IHRoaXMuX19wcm90ZWN0ZWRGaWVsZHNbc2NoZW1hLmNsYXNzTmFtZV07XG4gICAgICAgICAgICBpZiAoY2xhc3NQcm90ZWN0ZWRGaWVsZHMpIHtcbiAgICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY2xhc3NQcm90ZWN0ZWRGaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB1bnEgPSBuZXcgU2V0KFtcbiAgICAgICAgICAgICAgICAgIC4uLihkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucy5wcm90ZWN0ZWRGaWVsZHNba2V5XSB8fCBbXSksXG4gICAgICAgICAgICAgICAgICAuLi5jbGFzc1Byb3RlY3RlZEZpZWxkc1trZXldLFxuICAgICAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgICAgIGRhdGEuY2xhc3NMZXZlbFBlcm1pc3Npb25zLnByb3RlY3RlZEZpZWxkc1trZXldID0gQXJyYXkuZnJvbSh1bnEpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuX19kYXRhW3NjaGVtYS5jbGFzc05hbWVdID0gZGF0YTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX19kYXRhW3NjaGVtYS5jbGFzc05hbWVdO1xuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBJbmplY3QgdGhlIGluLW1lbW9yeSBjbGFzc2VzXG4gICAgdm9sYXRpbGVDbGFzc2VzLmZvckVhY2goY2xhc3NOYW1lID0+IHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCBjbGFzc05hbWUsIHtcbiAgICAgICAgZ2V0OiAoKSA9PiB7XG4gICAgICAgICAgaWYgKCF0aGlzLl9fZGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgICBjb25zdCBzY2hlbWEgPSBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICBmaWVsZHM6IHt9LFxuICAgICAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0ge307XG4gICAgICAgICAgICBkYXRhLmZpZWxkcyA9IHNjaGVtYS5maWVsZHM7XG4gICAgICAgICAgICBkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyA9IHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnM7XG4gICAgICAgICAgICBkYXRhLmluZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgICAgIHRoaXMuX19kYXRhW2NsYXNzTmFtZV0gPSBkYXRhO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdGhpcy5fX2RhdGFbY2xhc3NOYW1lXTtcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG5cbmNvbnN0IGluamVjdERlZmF1bHRTY2hlbWEgPSAoeyBjbGFzc05hbWUsIGZpZWxkcywgY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBpbmRleGVzIH06IFNjaGVtYSkgPT4ge1xuICBjb25zdCBkZWZhdWx0U2NoZW1hOiBTY2hlbWEgPSB7XG4gICAgY2xhc3NOYW1lLFxuICAgIGZpZWxkczoge1xuICAgICAgLi4uZGVmYXVsdENvbHVtbnMuX0RlZmF1bHQsXG4gICAgICAuLi4oZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXSB8fCB7fSksXG4gICAgICAuLi5maWVsZHMsXG4gICAgfSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gIH07XG4gIGlmIChpbmRleGVzICYmIE9iamVjdC5rZXlzKGluZGV4ZXMpLmxlbmd0aCAhPT0gMCkge1xuICAgIGRlZmF1bHRTY2hlbWEuaW5kZXhlcyA9IGluZGV4ZXM7XG4gIH1cbiAgcmV0dXJuIGRlZmF1bHRTY2hlbWE7XG59O1xuXG5jb25zdCBfSG9va3NTY2hlbWEgPSB7IGNsYXNzTmFtZTogJ19Ib29rcycsIGZpZWxkczogZGVmYXVsdENvbHVtbnMuX0hvb2tzIH07XG5jb25zdCBfR2xvYmFsQ29uZmlnU2NoZW1hID0ge1xuICBjbGFzc05hbWU6ICdfR2xvYmFsQ29uZmlnJyxcbiAgZmllbGRzOiBkZWZhdWx0Q29sdW1ucy5fR2xvYmFsQ29uZmlnLFxufTtcbmNvbnN0IF9HcmFwaFFMQ29uZmlnU2NoZW1hID0ge1xuICBjbGFzc05hbWU6ICdfR3JhcGhRTENvbmZpZycsXG4gIGZpZWxkczogZGVmYXVsdENvbHVtbnMuX0dyYXBoUUxDb25maWcsXG59O1xuY29uc3QgX1B1c2hTdGF0dXNTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKFxuICBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICBjbGFzc05hbWU6ICdfUHVzaFN0YXR1cycsXG4gICAgZmllbGRzOiB7fSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICB9KVxuKTtcbmNvbnN0IF9Kb2JTdGF0dXNTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKFxuICBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICBjbGFzc05hbWU6ICdfSm9iU3RhdHVzJyxcbiAgICBmaWVsZHM6IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gIH0pXG4pO1xuY29uc3QgX0pvYlNjaGVkdWxlU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShcbiAgaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gICAgY2xhc3NOYW1lOiAnX0pvYlNjaGVkdWxlJyxcbiAgICBmaWVsZHM6IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gIH0pXG4pO1xuY29uc3QgX0F1ZGllbmNlU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShcbiAgaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gICAgY2xhc3NOYW1lOiAnX0F1ZGllbmNlJyxcbiAgICBmaWVsZHM6IGRlZmF1bHRDb2x1bW5zLl9BdWRpZW5jZSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICB9KVxuKTtcbmNvbnN0IF9JZGVtcG90ZW5jeVNjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoXG4gIGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgIGNsYXNzTmFtZTogJ19JZGVtcG90ZW5jeScsXG4gICAgZmllbGRzOiBkZWZhdWx0Q29sdW1ucy5fSWRlbXBvdGVuY3ksXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fSxcbiAgfSlcbik7XG5jb25zdCBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzID0gW1xuICBfSG9va3NTY2hlbWEsXG4gIF9Kb2JTdGF0dXNTY2hlbWEsXG4gIF9Kb2JTY2hlZHVsZVNjaGVtYSxcbiAgX1B1c2hTdGF0dXNTY2hlbWEsXG4gIF9HbG9iYWxDb25maWdTY2hlbWEsXG4gIF9HcmFwaFFMQ29uZmlnU2NoZW1hLFxuICBfQXVkaWVuY2VTY2hlbWEsXG4gIF9JZGVtcG90ZW5jeVNjaGVtYSxcbl07XG5cbmNvbnN0IGRiVHlwZU1hdGNoZXNPYmplY3RUeXBlID0gKGRiVHlwZTogU2NoZW1hRmllbGQgfCBzdHJpbmcsIG9iamVjdFR5cGU6IFNjaGVtYUZpZWxkKSA9PiB7XG4gIGlmIChkYlR5cGUudHlwZSAhPT0gb2JqZWN0VHlwZS50eXBlKSB7IHJldHVybiBmYWxzZTsgfVxuICBpZiAoZGJUeXBlLnRhcmdldENsYXNzICE9PSBvYmplY3RUeXBlLnRhcmdldENsYXNzKSB7IHJldHVybiBmYWxzZTsgfVxuICBpZiAoZGJUeXBlID09PSBvYmplY3RUeXBlLnR5cGUpIHsgcmV0dXJuIHRydWU7IH1cbiAgaWYgKGRiVHlwZS50eXBlID09PSBvYmplY3RUeXBlLnR5cGUpIHsgcmV0dXJuIHRydWU7IH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuY29uc3QgdHlwZVRvU3RyaW5nID0gKHR5cGU6IFNjaGVtYUZpZWxkIHwgc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgaWYgKHR5cGVvZiB0eXBlID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiB0eXBlO1xuICB9XG4gIGlmICh0eXBlLnRhcmdldENsYXNzKSB7XG4gICAgcmV0dXJuIGAke3R5cGUudHlwZX08JHt0eXBlLnRhcmdldENsYXNzfT5gO1xuICB9XG4gIHJldHVybiBgJHt0eXBlLnR5cGV9YDtcbn07XG5jb25zdCB0dGwgPSB7XG4gIGRhdGU6IERhdGUubm93KCksXG4gIGR1cmF0aW9uOiB1bmRlZmluZWQsXG59O1xuXG4vLyBTdG9yZXMgdGhlIGVudGlyZSBzY2hlbWEgb2YgdGhlIGFwcCBpbiBhIHdlaXJkIGh5YnJpZCBmb3JtYXQgc29tZXdoZXJlIGJldHdlZW5cbi8vIHRoZSBtb25nbyBmb3JtYXQgYW5kIHRoZSBQYXJzZSBmb3JtYXQuIFNvb24sIHRoaXMgd2lsbCBhbGwgYmUgUGFyc2UgZm9ybWF0LlxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU2NoZW1hQ29udHJvbGxlciB7XG4gIF9kYkFkYXB0ZXI6IFN0b3JhZ2VBZGFwdGVyO1xuICBzY2hlbWFEYXRhOiB7IFtzdHJpbmddOiBTY2hlbWEgfTtcbiAgcmVsb2FkRGF0YVByb21pc2U6ID9Qcm9taXNlPGFueT47XG4gIHByb3RlY3RlZEZpZWxkczogYW55O1xuICB1c2VySWRSZWdFeDogUmVnRXhwO1xuXG4gIGNvbnN0cnVjdG9yKGRhdGFiYXNlQWRhcHRlcjogU3RvcmFnZUFkYXB0ZXIpIHtcbiAgICB0aGlzLl9kYkFkYXB0ZXIgPSBkYXRhYmFzZUFkYXB0ZXI7XG4gICAgY29uc3QgY29uZmlnID0gQ29uZmlnLmdldChQYXJzZS5hcHBsaWNhdGlvbklkKTtcbiAgICB0aGlzLnNjaGVtYURhdGEgPSBuZXcgU2NoZW1hRGF0YShTY2hlbWFDYWNoZS5hbGwoKSwgdGhpcy5wcm90ZWN0ZWRGaWVsZHMpO1xuICAgIHRoaXMucHJvdGVjdGVkRmllbGRzID0gY29uZmlnLnByb3RlY3RlZEZpZWxkcztcblxuICAgIGNvbnN0IGN1c3RvbUlkcyA9IGNvbmZpZy5hbGxvd0N1c3RvbU9iamVjdElkO1xuXG4gICAgY29uc3QgY3VzdG9tSWRSZWdFeCA9IC9eLnsxLH0kL3U7IC8vIDErIGNoYXJzXG4gICAgY29uc3QgYXV0b0lkUmVnRXggPSAvXlthLXpBLVowLTldezEsfSQvO1xuXG4gICAgdGhpcy51c2VySWRSZWdFeCA9IGN1c3RvbUlkcyA/IGN1c3RvbUlkUmVnRXggOiBhdXRvSWRSZWdFeDtcblxuICAgIHRoaXMuX2RiQWRhcHRlci53YXRjaCgoKSA9PiB7XG4gICAgICB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgcmVsb2FkRGF0YUlmTmVlZGVkKCkge1xuICAgIGlmICh0aGlzLl9kYkFkYXB0ZXIuZW5hYmxlU2NoZW1hSG9va3MpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgeyBkYXRlLCBkdXJhdGlvbiB9ID0gdHRsIHx8IHt9O1xuICAgIGlmICghZHVyYXRpb24pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICBpZiAobm93IC0gZGF0ZSA+IGR1cmF0aW9uKSB7XG4gICAgICB0dGwuZGF0ZSA9IG5vdztcbiAgICAgIGF3YWl0IHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVsb2FkRGF0YShvcHRpb25zOiBMb2FkU2NoZW1hT3B0aW9ucyA9IHsgY2xlYXJDYWNoZTogZmFsc2UgfSk6IFByb21pc2U8YW55PiB7XG4gICAgaWYgKHRoaXMucmVsb2FkRGF0YVByb21pc2UgJiYgIW9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gICAgfVxuICAgIHRoaXMucmVsb2FkRGF0YVByb21pc2UgPSB0aGlzLmdldEFsbENsYXNzZXMob3B0aW9ucylcbiAgICAgIC50aGVuKFxuICAgICAgICBhbGxTY2hlbWFzID0+IHtcbiAgICAgICAgICB0aGlzLnNjaGVtYURhdGEgPSBuZXcgU2NoZW1hRGF0YShhbGxTY2hlbWFzLCB0aGlzLnByb3RlY3RlZEZpZWxkcyk7XG4gICAgICAgICAgZGVsZXRlIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gICAgICAgIH0sXG4gICAgICAgIGVyciA9PiB7XG4gICAgICAgICAgdGhpcy5zY2hlbWFEYXRhID0gbmV3IFNjaGVtYURhdGEoKTtcbiAgICAgICAgICBkZWxldGUgdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICAgIClcbiAgICAgIC50aGVuKCgpID0+IHt9KTtcbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgfVxuXG4gIGFzeW5jIGdldEFsbENsYXNzZXMob3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7IGNsZWFyQ2FjaGU6IGZhbHNlIH0pOiBQcm9taXNlPEFycmF5PFNjaGVtYT4+IHtcbiAgICBpZiAob3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICByZXR1cm4gdGhpcy5zZXRBbGxDbGFzc2VzKCk7XG4gICAgfVxuICAgIGF3YWl0IHRoaXMucmVsb2FkRGF0YUlmTmVlZGVkKCk7XG4gICAgY29uc3QgY2FjaGVkID0gU2NoZW1hQ2FjaGUuYWxsKCk7XG4gICAgaWYgKGNhY2hlZCAmJiBjYWNoZWQubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGNhY2hlZCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnNldEFsbENsYXNzZXMoKTtcbiAgfVxuXG4gIHNldEFsbENsYXNzZXMoKTogUHJvbWlzZTxBcnJheTxTY2hlbWE+PiB7XG4gICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlclxuICAgICAgLmdldEFsbENsYXNzZXMoKVxuICAgICAgLnRoZW4oYWxsU2NoZW1hcyA9PiBhbGxTY2hlbWFzLm1hcChpbmplY3REZWZhdWx0U2NoZW1hKSlcbiAgICAgIC50aGVuKGFsbFNjaGVtYXMgPT4ge1xuICAgICAgICBTY2hlbWFDYWNoZS5wdXQoYWxsU2NoZW1hcyk7XG4gICAgICAgIHJldHVybiBhbGxTY2hlbWFzO1xuICAgICAgfSk7XG4gIH1cblxuICBnZXRPbmVTY2hlbWEoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgYWxsb3dWb2xhdGlsZUNsYXNzZXM6IGJvb2xlYW4gPSBmYWxzZSxcbiAgICBvcHRpb25zOiBMb2FkU2NoZW1hT3B0aW9ucyA9IHsgY2xlYXJDYWNoZTogZmFsc2UgfVxuICApOiBQcm9taXNlPFNjaGVtYT4ge1xuICAgIGlmIChvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIFNjaGVtYUNhY2hlLmNsZWFyKCk7XG4gICAgfVxuICAgIGlmIChhbGxvd1ZvbGF0aWxlQ2xhc3NlcyAmJiB2b2xhdGlsZUNsYXNzZXMuaW5kZXhPZihjbGFzc05hbWUpID4gLTEpIHtcbiAgICAgIGNvbnN0IGRhdGEgPSB0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgIGZpZWxkczogZGF0YS5maWVsZHMsXG4gICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogZGF0YS5jbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgIGluZGV4ZXM6IGRhdGEuaW5kZXhlcyxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBjb25zdCBjYWNoZWQgPSBTY2hlbWFDYWNoZS5nZXQoY2xhc3NOYW1lKTtcbiAgICBpZiAoY2FjaGVkICYmICFvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoY2FjaGVkKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuc2V0QWxsQ2xhc3NlcygpLnRoZW4oYWxsU2NoZW1hcyA9PiB7XG4gICAgICBjb25zdCBvbmVTY2hlbWEgPSBhbGxTY2hlbWFzLmZpbmQoc2NoZW1hID0+IHNjaGVtYS5jbGFzc05hbWUgPT09IGNsYXNzTmFtZSk7XG4gICAgICBpZiAoIW9uZVNjaGVtYSkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QodW5kZWZpbmVkKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBvbmVTY2hlbWE7XG4gICAgfSk7XG4gIH1cblxuICAvLyBDcmVhdGUgYSBuZXcgY2xhc3MgdGhhdCBpbmNsdWRlcyB0aGUgdGhyZWUgZGVmYXVsdCBmaWVsZHMuXG4gIC8vIEFDTCBpcyBhbiBpbXBsaWNpdCBjb2x1bW4gdGhhdCBkb2VzIG5vdCBnZXQgYW4gZW50cnkgaW4gdGhlXG4gIC8vIF9TQ0hFTUFTIGRhdGFiYXNlLiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlXG4gIC8vIGNyZWF0ZWQgc2NoZW1hLCBpbiBtb25nbyBmb3JtYXQuXG4gIC8vIG9uIHN1Y2Nlc3MsIGFuZCByZWplY3RzIHdpdGggYW4gZXJyb3Igb24gZmFpbC4gRW5zdXJlIHlvdVxuICAvLyBoYXZlIGF1dGhvcml6YXRpb24gKG1hc3RlciBrZXksIG9yIGNsaWVudCBjbGFzcyBjcmVhdGlvblxuICAvLyBlbmFibGVkKSBiZWZvcmUgY2FsbGluZyB0aGlzIGZ1bmN0aW9uLlxuICBhc3luYyBhZGRDbGFzc0lmTm90RXhpc3RzKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGZpZWxkczogU2NoZW1hRmllbGRzID0ge30sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBhbnksXG4gICAgaW5kZXhlczogYW55ID0ge31cbiAgKTogUHJvbWlzZTx2b2lkIHwgU2NoZW1hPiB7XG4gICAgdmFyIHZhbGlkYXRpb25FcnJvciA9IHRoaXMudmFsaWRhdGVOZXdDbGFzcyhjbGFzc05hbWUsIGZpZWxkcywgY2xhc3NMZXZlbFBlcm1pc3Npb25zKTtcbiAgICBpZiAodmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICBpZiAodmFsaWRhdGlvbkVycm9yIGluc3RhbmNlb2YgUGFyc2UuRXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KHZhbGlkYXRpb25FcnJvcik7XG4gICAgICB9IGVsc2UgaWYgKHZhbGlkYXRpb25FcnJvci5jb2RlICYmIHZhbGlkYXRpb25FcnJvci5lcnJvcikge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFBhcnNlLkVycm9yKHZhbGlkYXRpb25FcnJvci5jb2RlLCB2YWxpZGF0aW9uRXJyb3IuZXJyb3IpKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCh2YWxpZGF0aW9uRXJyb3IpO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgY29uc3QgYWRhcHRlclNjaGVtYSA9IGF3YWl0IHRoaXMuX2RiQWRhcHRlci5jcmVhdGVDbGFzcyhcbiAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKHtcbiAgICAgICAgICBmaWVsZHMsXG4gICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgICAgICAgIGluZGV4ZXMsXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICAgIC8vIFRPRE86IFJlbW92ZSBieSB1cGRhdGluZyBzY2hlbWEgY2FjaGUgZGlyZWN0bHlcbiAgICAgIGF3YWl0IHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgICBjb25zdCBwYXJzZVNjaGVtYSA9IGNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYShhZGFwdGVyU2NoZW1hKTtcbiAgICAgIHJldHVybiBwYXJzZVNjaGVtYTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yICYmIGVycm9yLmNvZGUgPT09IFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLCBgQ2xhc3MgJHtjbGFzc05hbWV9IGFscmVhZHkgZXhpc3RzLmApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdXBkYXRlQ2xhc3MoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc3VibWl0dGVkRmllbGRzOiBTY2hlbWFGaWVsZHMsXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBhbnksXG4gICAgaW5kZXhlczogYW55LFxuICAgIGRhdGFiYXNlOiBEYXRhYmFzZUNvbnRyb2xsZXJcbiAgKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nRmllbGRzID0gc2NoZW1hLmZpZWxkcztcbiAgICAgICAgT2JqZWN0LmtleXMoc3VibWl0dGVkRmllbGRzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpZWxkID0gc3VibWl0dGVkRmllbGRzW25hbWVdO1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGV4aXN0aW5nRmllbGRzW25hbWVdICYmXG4gICAgICAgICAgICBleGlzdGluZ0ZpZWxkc1tuYW1lXS50eXBlICE9PSBmaWVsZC50eXBlICYmXG4gICAgICAgICAgICBmaWVsZC5fX29wICE9PSAnRGVsZXRlJ1xuICAgICAgICAgICkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDI1NSwgYEZpZWxkICR7bmFtZX0gZXhpc3RzLCBjYW5ub3QgdXBkYXRlLmApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWV4aXN0aW5nRmllbGRzW25hbWVdICYmIGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMjU1LCBgRmllbGQgJHtuYW1lfSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGRlbGV0ZS5gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0ZpZWxkcy5fcnBlcm07XG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0ZpZWxkcy5fd3Blcm07XG4gICAgICAgIGNvbnN0IG5ld1NjaGVtYSA9IGJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0KGV4aXN0aW5nRmllbGRzLCBzdWJtaXR0ZWRGaWVsZHMpO1xuICAgICAgICBjb25zdCBkZWZhdWx0RmllbGRzID0gZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXSB8fCBkZWZhdWx0Q29sdW1ucy5fRGVmYXVsdDtcbiAgICAgICAgY29uc3QgZnVsbE5ld1NjaGVtYSA9IE9iamVjdC5hc3NpZ24oe30sIG5ld1NjaGVtYSwgZGVmYXVsdEZpZWxkcyk7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvciA9IHRoaXMudmFsaWRhdGVTY2hlbWFEYXRhKFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBuZXdTY2hlbWEsXG4gICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgICAgICAgIE9iamVjdC5rZXlzKGV4aXN0aW5nRmllbGRzKVxuICAgICAgICApO1xuICAgICAgICBpZiAodmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKHZhbGlkYXRpb25FcnJvci5jb2RlLCB2YWxpZGF0aW9uRXJyb3IuZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmluYWxseSB3ZSBoYXZlIGNoZWNrZWQgdG8gbWFrZSBzdXJlIHRoZSByZXF1ZXN0IGlzIHZhbGlkIGFuZCB3ZSBjYW4gc3RhcnQgZGVsZXRpbmcgZmllbGRzLlxuICAgICAgICAvLyBEbyBhbGwgZGVsZXRpb25zIGZpcnN0LCB0aGVuIGEgc2luZ2xlIHNhdmUgdG8gX1NDSEVNQSBjb2xsZWN0aW9uIHRvIGhhbmRsZSBhbGwgYWRkaXRpb25zLlxuICAgICAgICBjb25zdCBkZWxldGVkRmllbGRzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBjb25zdCBpbnNlcnRlZEZpZWxkcyA9IFtdO1xuICAgICAgICBPYmplY3Qua2V5cyhzdWJtaXR0ZWRGaWVsZHMpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICBpZiAoc3VibWl0dGVkRmllbGRzW2ZpZWxkTmFtZV0uX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgICAgIGRlbGV0ZWRGaWVsZHMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpbnNlcnRlZEZpZWxkcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBsZXQgZGVsZXRlUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICBpZiAoZGVsZXRlZEZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgZGVsZXRlUHJvbWlzZSA9IHRoaXMuZGVsZXRlRmllbGRzKGRlbGV0ZWRGaWVsZHMsIGNsYXNzTmFtZSwgZGF0YWJhc2UpO1xuICAgICAgICB9XG4gICAgICAgIGxldCBlbmZvcmNlRmllbGRzID0gW107XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgZGVsZXRlUHJvbWlzZSAvLyBEZWxldGUgRXZlcnl0aGluZ1xuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KSkgLy8gUmVsb2FkIG91ciBTY2hlbWEsIHNvIHdlIGhhdmUgYWxsIHRoZSBuZXcgdmFsdWVzXG4gICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHByb21pc2VzID0gaW5zZXJ0ZWRGaWVsZHMubWFwKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgdHlwZSA9IHN1Ym1pdHRlZEZpZWxkc1tmaWVsZE5hbWVdO1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmVuZm9yY2VGaWVsZEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICAgICAgICBlbmZvcmNlRmllbGRzID0gcmVzdWx0cy5maWx0ZXIocmVzdWx0ID0+ICEhcmVzdWx0KTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2V0UGVybWlzc2lvbnMoY2xhc3NOYW1lLCBjbGFzc0xldmVsUGVybWlzc2lvbnMsIG5ld1NjaGVtYSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnRoZW4oKCkgPT5cbiAgICAgICAgICAgICAgdGhpcy5fZGJBZGFwdGVyLnNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KFxuICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICBpbmRleGVzLFxuICAgICAgICAgICAgICAgIHNjaGVtYS5pbmRleGVzLFxuICAgICAgICAgICAgICAgIGZ1bGxOZXdTY2hlbWFcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KSlcbiAgICAgICAgICAgIC8vVE9ETzogTW92ZSB0aGlzIGxvZ2ljIGludG8gdGhlIGRhdGFiYXNlIGFkYXB0ZXJcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5lbnN1cmVGaWVsZHMoZW5mb3JjZUZpZWxkcyk7XG4gICAgICAgICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdO1xuICAgICAgICAgICAgICBjb25zdCByZWxvYWRlZFNjaGVtYTogU2NoZW1hID0ge1xuICAgICAgICAgICAgICAgIGNsYXNzTmFtZTogY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgIGZpZWxkczogc2NoZW1hLmZpZWxkcyxcbiAgICAgICAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgIGlmIChzY2hlbWEuaW5kZXhlcyAmJiBPYmplY3Qua2V5cyhzY2hlbWEuaW5kZXhlcykubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgICAgICAgICAgcmVsb2FkZWRTY2hlbWEuaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiByZWxvYWRlZFNjaGVtYTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgICAgICBgQ2xhc3MgJHtjbGFzc05hbWV9IGRvZXMgbm90IGV4aXN0LmBcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IHRvIHRoZSBuZXcgc2NoZW1hXG4gIC8vIG9iamVjdCBvciBmYWlscyB3aXRoIGEgcmVhc29uLlxuICBlbmZvcmNlQ2xhc3NFeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcpOiBQcm9taXNlPFNjaGVtYUNvbnRyb2xsZXI+IHtcbiAgICBpZiAodGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gICAgfVxuICAgIC8vIFdlIGRvbid0IGhhdmUgdGhpcyBjbGFzcy4gVXBkYXRlIHRoZSBzY2hlbWFcbiAgICByZXR1cm4gKFxuICAgICAgLy8gVGhlIHNjaGVtYSB1cGRhdGUgc3VjY2VlZGVkLiBSZWxvYWQgdGhlIHNjaGVtYVxuICAgICAgdGhpcy5hZGRDbGFzc0lmTm90RXhpc3RzKGNsYXNzTmFtZSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBUaGUgc2NoZW1hIHVwZGF0ZSBmYWlsZWQuIFRoaXMgY2FuIGJlIG9rYXkgLSBpdCBtaWdodFxuICAgICAgICAgIC8vIGhhdmUgZmFpbGVkIGJlY2F1c2UgdGhlcmUncyBhIHJhY2UgY29uZGl0aW9uIGFuZCBhIGRpZmZlcmVudFxuICAgICAgICAgIC8vIGNsaWVudCBpcyBtYWtpbmcgdGhlIGV4YWN0IHNhbWUgc2NoZW1hIHVwZGF0ZSB0aGF0IHdlIHdhbnQuXG4gICAgICAgICAgLy8gU28ganVzdCByZWxvYWQgdGhlIHNjaGVtYS5cbiAgICAgICAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KTtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBzY2hlbWEgbm93IHZhbGlkYXRlc1xuICAgICAgICAgIGlmICh0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGBGYWlsZWQgdG8gYWRkICR7Y2xhc3NOYW1lfWApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBUaGUgc2NoZW1hIHN0aWxsIGRvZXNuJ3QgdmFsaWRhdGUuIEdpdmUgdXBcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnc2NoZW1hIGNsYXNzIG5hbWUgZG9lcyBub3QgcmV2YWxpZGF0ZScpO1xuICAgICAgICB9KVxuICAgICk7XG4gIH1cblxuICB2YWxpZGF0ZU5ld0NsYXNzKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZHM6IFNjaGVtYUZpZWxkcyA9IHt9LCBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGFueSk6IGFueSB7XG4gICAgaWYgKHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLCBgQ2xhc3MgJHtjbGFzc05hbWV9IGFscmVhZHkgZXhpc3RzLmApO1xuICAgIH1cbiAgICBpZiAoIWNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICBlcnJvcjogaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UoY2xhc3NOYW1lKSxcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2NoZW1hRGF0YShjbGFzc05hbWUsIGZpZWxkcywgY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBbXSk7XG4gIH1cblxuICB2YWxpZGF0ZVNjaGVtYURhdGEoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGRzOiBTY2hlbWFGaWVsZHMsXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBDbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgZXhpc3RpbmdGaWVsZE5hbWVzOiBBcnJheTxzdHJpbmc+XG4gICkge1xuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIGZpZWxkcykge1xuICAgICAgaWYgKGV4aXN0aW5nRmllbGROYW1lcy5pbmRleE9mKGZpZWxkTmFtZSkgPCAwKSB7XG4gICAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWUsIGNsYXNzTmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICAgIGVycm9yOiAnaW52YWxpZCBmaWVsZCBuYW1lOiAnICsgZmllbGROYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MoZmllbGROYW1lLCBjbGFzc05hbWUpKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvZGU6IDEzNixcbiAgICAgICAgICAgIGVycm9yOiAnZmllbGQgJyArIGZpZWxkTmFtZSArICcgY2Fubm90IGJlIGFkZGVkJyxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGZpZWxkVHlwZSA9IGZpZWxkc1tmaWVsZE5hbWVdO1xuICAgICAgICBjb25zdCBlcnJvciA9IGZpZWxkVHlwZUlzSW52YWxpZChmaWVsZFR5cGUpO1xuICAgICAgICBpZiAoZXJyb3IpIHsgcmV0dXJuIHsgY29kZTogZXJyb3IuY29kZSwgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfTsgfVxuICAgICAgICBpZiAoZmllbGRUeXBlLmRlZmF1bHRWYWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbGV0IGRlZmF1bHRWYWx1ZVR5cGUgPSBnZXRUeXBlKGZpZWxkVHlwZS5kZWZhdWx0VmFsdWUpO1xuICAgICAgICAgIGlmICh0eXBlb2YgZGVmYXVsdFZhbHVlVHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZVR5cGUgPSB7IHR5cGU6IGRlZmF1bHRWYWx1ZVR5cGUgfTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBkZWZhdWx0VmFsdWVUeXBlID09PSAnb2JqZWN0JyAmJiBmaWVsZFR5cGUudHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgICAgICAgIGVycm9yOiBgVGhlICdkZWZhdWx0IHZhbHVlJyBvcHRpb24gaXMgbm90IGFwcGxpY2FibGUgZm9yICR7dHlwZVRvU3RyaW5nKGZpZWxkVHlwZSl9YCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghZGJUeXBlTWF0Y2hlc09iamVjdFR5cGUoZmllbGRUeXBlLCBkZWZhdWx0VmFsdWVUeXBlKSkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgICAgICAgIGVycm9yOiBgc2NoZW1hIG1pc21hdGNoIGZvciAke2NsYXNzTmFtZX0uJHtmaWVsZE5hbWV9IGRlZmF1bHQgdmFsdWU7IGV4cGVjdGVkICR7dHlwZVRvU3RyaW5nKFxuICAgICAgICAgICAgICAgIGZpZWxkVHlwZVxuICAgICAgICAgICAgICApfSBidXQgZ290ICR7dHlwZVRvU3RyaW5nKGRlZmF1bHRWYWx1ZVR5cGUpfWAsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZFR5cGUucmVxdWlyZWQpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGZpZWxkVHlwZSA9PT0gJ29iamVjdCcgJiYgZmllbGRUeXBlLnR5cGUgPT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICAgICAgICBlcnJvcjogYFRoZSAncmVxdWlyZWQnIG9wdGlvbiBpcyBub3QgYXBwbGljYWJsZSBmb3IgJHt0eXBlVG9TdHJpbmcoZmllbGRUeXBlKX1gLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdKSB7XG4gICAgICBmaWVsZHNbZmllbGROYW1lXSA9IGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV1bZmllbGROYW1lXTtcbiAgICB9XG5cbiAgICBjb25zdCBnZW9Qb2ludHMgPSBPYmplY3Qua2V5cyhmaWVsZHMpLmZpbHRlcihcbiAgICAgIGtleSA9PiBmaWVsZHNba2V5XSAmJiBmaWVsZHNba2V5XS50eXBlID09PSAnR2VvUG9pbnQnXG4gICAgKTtcbiAgICBpZiAoZ2VvUG9pbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICBlcnJvcjpcbiAgICAgICAgICAnY3VycmVudGx5LCBvbmx5IG9uZSBHZW9Qb2ludCBmaWVsZCBtYXkgZXhpc3QgaW4gYW4gb2JqZWN0LiBBZGRpbmcgJyArXG4gICAgICAgICAgZ2VvUG9pbnRzWzFdICtcbiAgICAgICAgICAnIHdoZW4gJyArXG4gICAgICAgICAgZ2VvUG9pbnRzWzBdICtcbiAgICAgICAgICAnIGFscmVhZHkgZXhpc3RzLicsXG4gICAgICB9O1xuICAgIH1cbiAgICB2YWxpZGF0ZUNMUChjbGFzc0xldmVsUGVybWlzc2lvbnMsIGZpZWxkcywgdGhpcy51c2VySWRSZWdFeCk7XG4gIH1cblxuICAvLyBTZXRzIHRoZSBDbGFzcy1sZXZlbCBwZXJtaXNzaW9ucyBmb3IgYSBnaXZlbiBjbGFzc05hbWUsIHdoaWNoIG11c3QgZXhpc3QuXG4gIGFzeW5jIHNldFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nLCBwZXJtczogYW55LCBuZXdTY2hlbWE6IFNjaGVtYUZpZWxkcykge1xuICAgIGlmICh0eXBlb2YgcGVybXMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICAgIHZhbGlkYXRlQ0xQKHBlcm1zLCBuZXdTY2hlbWEsIHRoaXMudXNlcklkUmVnRXgpO1xuICAgIGF3YWl0IHRoaXMuX2RiQWRhcHRlci5zZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lLCBwZXJtcyk7XG4gICAgY29uc3QgY2FjaGVkID0gU2NoZW1hQ2FjaGUuZ2V0KGNsYXNzTmFtZSk7XG4gICAgaWYgKGNhY2hlZCkge1xuICAgICAgY2FjaGVkLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyA9IHBlcm1zO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IHRvIHRoZSBuZXcgc2NoZW1hXG4gIC8vIG9iamVjdCBpZiB0aGUgcHJvdmlkZWQgY2xhc3NOYW1lLWZpZWxkTmFtZS10eXBlIHR1cGxlIGlzIHZhbGlkLlxuICAvLyBUaGUgY2xhc3NOYW1lIG11c3QgYWxyZWFkeSBiZSB2YWxpZGF0ZWQuXG4gIC8vIElmICdmcmVlemUnIGlzIHRydWUsIHJlZnVzZSB0byB1cGRhdGUgdGhlIHNjaGVtYSBmb3IgdGhpcyBmaWVsZC5cbiAgZW5mb3JjZUZpZWxkRXhpc3RzKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGZpZWxkTmFtZTogc3RyaW5nLFxuICAgIHR5cGU6IHN0cmluZyB8IFNjaGVtYUZpZWxkLFxuICAgIGlzVmFsaWRhdGlvbj86IGJvb2xlYW4sXG4gICAgbWFpbnRlbmFuY2U/OiBib29sZWFuXG4gICkge1xuICAgIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID4gMCkge1xuICAgICAgLy8gXCI8YXJyYXk+LjxpbmRleD5cIiBmb3IgTmVzdGVkIEFycmF5c1xuICAgICAgLy8gXCI8ZW1iZWRkZWQgZG9jdW1lbnQ+LjxmaWVsZD5cIiBmb3IgTmVzdGVkIE9iamVjdHNcbiAgICAgIC8vIEpTT04gQXJyYXlzIGFyZSB0cmVhdGVkIGFzIE5lc3RlZCBPYmplY3RzXG4gICAgICBjb25zdCBbeCwgeV0gPSBmaWVsZE5hbWUuc3BsaXQoJy4nKTtcbiAgICAgIGZpZWxkTmFtZSA9IHg7XG4gICAgICBjb25zdCBpc0FycmF5SW5kZXggPSBBcnJheS5mcm9tKHkpLmV2ZXJ5KGMgPT4gYyA+PSAnMCcgJiYgYyA8PSAnOScpO1xuICAgICAgaWYgKGlzQXJyYXlJbmRleCAmJiAhWydzZW50UGVyVVRDT2Zmc2V0JywgJ2ZhaWxlZFBlclVUQ09mZnNldCddLmluY2x1ZGVzKGZpZWxkTmFtZSkpIHtcbiAgICAgICAgdHlwZSA9ICdBcnJheSc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0eXBlID0gJ09iamVjdCc7XG4gICAgICB9XG4gICAgfVxuICAgIGxldCBmaWVsZE5hbWVUb1ZhbGlkYXRlID0gYCR7ZmllbGROYW1lfWA7XG4gICAgaWYgKG1haW50ZW5hbmNlICYmIGZpZWxkTmFtZVRvVmFsaWRhdGUuY2hhckF0KDApID09PSAnXycpIHtcbiAgICAgIGZpZWxkTmFtZVRvVmFsaWRhdGUgPSBmaWVsZE5hbWVUb1ZhbGlkYXRlLnN1YnN0cmluZygxKTtcbiAgICB9XG4gICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZVRvVmFsaWRhdGUsIGNsYXNzTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCBgSW52YWxpZCBmaWVsZCBuYW1lOiAke2ZpZWxkTmFtZX0uYCk7XG4gICAgfVxuXG4gICAgLy8gSWYgc29tZW9uZSB0cmllcyB0byBjcmVhdGUgYSBuZXcgZmllbGQgd2l0aCBudWxsL3VuZGVmaW5lZCBhcyB0aGUgdmFsdWUsIHJldHVybjtcbiAgICBpZiAoIXR5cGUpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gdGhpcy5nZXRFeHBlY3RlZFR5cGUoY2xhc3NOYW1lLCBmaWVsZE5hbWUpO1xuICAgIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHR5cGUgPSAoeyB0eXBlIH06IFNjaGVtYUZpZWxkKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZS5kZWZhdWx0VmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgbGV0IGRlZmF1bHRWYWx1ZVR5cGUgPSBnZXRUeXBlKHR5cGUuZGVmYXVsdFZhbHVlKTtcbiAgICAgIGlmICh0eXBlb2YgZGVmYXVsdFZhbHVlVHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgZGVmYXVsdFZhbHVlVHlwZSA9IHsgdHlwZTogZGVmYXVsdFZhbHVlVHlwZSB9O1xuICAgICAgfVxuICAgICAgaWYgKCFkYlR5cGVNYXRjaGVzT2JqZWN0VHlwZSh0eXBlLCBkZWZhdWx0VmFsdWVUeXBlKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgICAgYHNjaGVtYSBtaXNtYXRjaCBmb3IgJHtjbGFzc05hbWV9LiR7ZmllbGROYW1lfSBkZWZhdWx0IHZhbHVlOyBleHBlY3RlZCAke3R5cGVUb1N0cmluZyhcbiAgICAgICAgICAgIHR5cGVcbiAgICAgICAgICApfSBidXQgZ290ICR7dHlwZVRvU3RyaW5nKGRlZmF1bHRWYWx1ZVR5cGUpfWBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXhwZWN0ZWRUeXBlKSB7XG4gICAgICBpZiAoIWRiVHlwZU1hdGNoZXNPYmplY3RUeXBlKGV4cGVjdGVkVHlwZSwgdHlwZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICAgIGBzY2hlbWEgbWlzbWF0Y2ggZm9yICR7Y2xhc3NOYW1lfS4ke2ZpZWxkTmFtZX07IGV4cGVjdGVkICR7dHlwZVRvU3RyaW5nKFxuICAgICAgICAgICAgZXhwZWN0ZWRUeXBlXG4gICAgICAgICAgKX0gYnV0IGdvdCAke3R5cGVUb1N0cmluZyh0eXBlKX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvLyBJZiB0eXBlIG9wdGlvbnMgZG8gbm90IGNoYW5nZVxuICAgICAgLy8gd2UgY2FuIHNhZmVseSByZXR1cm5cbiAgICAgIGlmIChpc1ZhbGlkYXRpb24gfHwgSlNPTi5zdHJpbmdpZnkoZXhwZWN0ZWRUeXBlKSA9PT0gSlNPTi5zdHJpbmdpZnkodHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICAgIC8vIEZpZWxkIG9wdGlvbnMgYXJlIG1heSBiZSBjaGFuZ2VkXG4gICAgICAvLyBlbnN1cmUgdG8gaGF2ZSBhbiB1cGRhdGUgdG8gZGF0ZSBzY2hlbWEgZmllbGRcbiAgICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXIudXBkYXRlRmllbGRPcHRpb25zKGNsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyXG4gICAgICAuYWRkRmllbGRJZk5vdEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09IFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFKSB7XG4gICAgICAgICAgLy8gTWFrZSBzdXJlIHRoYXQgd2UgdGhyb3cgZXJyb3JzIHdoZW4gaXQgaXMgYXBwcm9wcmlhdGUgdG8gZG8gc28uXG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVGhlIHVwZGF0ZSBmYWlsZWQuIFRoaXMgY2FuIGJlIG9rYXkgLSBpdCBtaWdodCBoYXZlIGJlZW4gYSByYWNlXG4gICAgICAgIC8vIGNvbmRpdGlvbiB3aGVyZSBhbm90aGVyIGNsaWVudCB1cGRhdGVkIHRoZSBzY2hlbWEgaW4gdGhlIHNhbWVcbiAgICAgICAgLy8gd2F5IHRoYXQgd2Ugd2FudGVkIHRvLiBTbywganVzdCByZWxvYWQgdGhlIHNjaGVtYVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBmaWVsZE5hbWUsXG4gICAgICAgICAgdHlwZSxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICB9XG5cbiAgZW5zdXJlRmllbGRzKGZpZWxkczogYW55KSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBmaWVsZHMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgIGNvbnN0IHsgY2xhc3NOYW1lLCBmaWVsZE5hbWUgfSA9IGZpZWxkc1tpXTtcbiAgICAgIGxldCB7IHR5cGUgfSA9IGZpZWxkc1tpXTtcbiAgICAgIGNvbnN0IGV4cGVjdGVkVHlwZSA9IHRoaXMuZ2V0RXhwZWN0ZWRUeXBlKGNsYXNzTmFtZSwgZmllbGROYW1lKTtcbiAgICAgIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdHlwZSA9IHsgdHlwZTogdHlwZSB9O1xuICAgICAgfVxuICAgICAgaWYgKCFleHBlY3RlZFR5cGUgfHwgIWRiVHlwZU1hdGNoZXNPYmplY3RUeXBlKGV4cGVjdGVkVHlwZSwgdHlwZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYENvdWxkIG5vdCBhZGQgZmllbGQgJHtmaWVsZE5hbWV9YCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gbWFpbnRhaW4gY29tcGF0aWJpbGl0eVxuICBkZWxldGVGaWVsZChmaWVsZE5hbWU6IHN0cmluZywgY2xhc3NOYW1lOiBzdHJpbmcsIGRhdGFiYXNlOiBEYXRhYmFzZUNvbnRyb2xsZXIpIHtcbiAgICByZXR1cm4gdGhpcy5kZWxldGVGaWVsZHMoW2ZpZWxkTmFtZV0sIGNsYXNzTmFtZSwgZGF0YWJhc2UpO1xuICB9XG5cbiAgLy8gRGVsZXRlIGZpZWxkcywgYW5kIHJlbW92ZSB0aGF0IGRhdGEgZnJvbSBhbGwgb2JqZWN0cy4gVGhpcyBpcyBpbnRlbmRlZFxuICAvLyB0byByZW1vdmUgdW51c2VkIGZpZWxkcywgaWYgb3RoZXIgd3JpdGVycyBhcmUgd3JpdGluZyBvYmplY3RzIHRoYXQgaW5jbHVkZVxuICAvLyB0aGlzIGZpZWxkLCB0aGUgZmllbGQgbWF5IHJlYXBwZWFyLiBSZXR1cm5zIGEgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGhcbiAgLy8gbm8gb2JqZWN0IG9uIHN1Y2Nlc3MsIG9yIHJlamVjdHMgd2l0aCB7IGNvZGUsIGVycm9yIH0gb24gZmFpbHVyZS5cbiAgLy8gUGFzc2luZyB0aGUgZGF0YWJhc2UgYW5kIHByZWZpeCBpcyBuZWNlc3NhcnkgaW4gb3JkZXIgdG8gZHJvcCByZWxhdGlvbiBjb2xsZWN0aW9uc1xuICAvLyBhbmQgcmVtb3ZlIGZpZWxkcyBmcm9tIG9iamVjdHMuIElkZWFsbHkgdGhlIGRhdGFiYXNlIHdvdWxkIGJlbG9uZyB0b1xuICAvLyBhIGRhdGFiYXNlIGFkYXB0ZXIgYW5kIHRoaXMgZnVuY3Rpb24gd291bGQgY2xvc2Ugb3ZlciBpdCBvciBhY2Nlc3MgaXQgdmlhIG1lbWJlci5cbiAgZGVsZXRlRmllbGRzKGZpZWxkTmFtZXM6IEFycmF5PHN0cmluZz4sIGNsYXNzTmFtZTogc3RyaW5nLCBkYXRhYmFzZTogRGF0YWJhc2VDb250cm9sbGVyKSB7XG4gICAgaWYgKCFjbGFzc05hbWVJc1ZhbGlkKGNsYXNzTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsIGludmFsaWRDbGFzc05hbWVNZXNzYWdlKGNsYXNzTmFtZSkpO1xuICAgIH1cblxuICAgIGZpZWxkTmFtZXMuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSwgY2xhc3NOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgYGludmFsaWQgZmllbGQgbmFtZTogJHtmaWVsZE5hbWV9YCk7XG4gICAgICB9XG4gICAgICAvL0Rvbid0IGFsbG93IGRlbGV0aW5nIHRoZSBkZWZhdWx0IGZpZWxkcy5cbiAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZEZvckNsYXNzKGZpZWxkTmFtZSwgY2xhc3NOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTM2LCBgZmllbGQgJHtmaWVsZE5hbWV9IGNhbm5vdCBiZSBjaGFuZ2VkYCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGhpcy5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCBmYWxzZSwgeyBjbGVhckNhY2hlOiB0cnVlIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3QuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICBmaWVsZE5hbWVzLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICBpZiAoIXNjaGVtYS5maWVsZHNbZmllbGROYW1lXSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDI1NSwgYEZpZWxkICR7ZmllbGROYW1lfSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGRlbGV0ZS5gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYUZpZWxkcyA9IHsgLi4uc2NoZW1hLmZpZWxkcyB9O1xuICAgICAgICByZXR1cm4gZGF0YWJhc2UuYWRhcHRlci5kZWxldGVGaWVsZHMoY2xhc3NOYW1lLCBzY2hlbWEsIGZpZWxkTmFtZXMpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChcbiAgICAgICAgICAgIGZpZWxkTmFtZXMubWFwKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gc2NoZW1hRmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAgICAgICAgIGlmIChmaWVsZCAmJiBmaWVsZC50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgICAgICAgICAgLy9Gb3IgcmVsYXRpb25zLCBkcm9wIHRoZSBfSm9pbiB0YWJsZVxuICAgICAgICAgICAgICAgIHJldHVybiBkYXRhYmFzZS5hZGFwdGVyLmRlbGV0ZUNsYXNzKGBfSm9pbjoke2ZpZWxkTmFtZX06JHtjbGFzc05hbWV9YCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIFNjaGVtYUNhY2hlLmNsZWFyKCk7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlcyBhbiBvYmplY3QgcHJvdmlkZWQgaW4gUkVTVCBmb3JtYXQuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIG5ldyBzY2hlbWEgaWYgdGhpcyBvYmplY3QgaXNcbiAgLy8gdmFsaWQuXG4gIGFzeW5jIHZhbGlkYXRlT2JqZWN0KGNsYXNzTmFtZTogc3RyaW5nLCBvYmplY3Q6IGFueSwgcXVlcnk6IGFueSwgbWFpbnRlbmFuY2U6IGJvb2xlYW4pIHtcbiAgICBsZXQgZ2VvY291bnQgPSAwO1xuICAgIGNvbnN0IHNjaGVtYSA9IGF3YWl0IHRoaXMuZW5mb3JjZUNsYXNzRXhpc3RzKGNsYXNzTmFtZSk7XG4gICAgY29uc3QgcHJvbWlzZXMgPSBbXTtcblxuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIG9iamVjdCkge1xuICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdICYmIGdldFR5cGUob2JqZWN0W2ZpZWxkTmFtZV0pID09PSAnR2VvUG9pbnQnKSB7XG4gICAgICAgIGdlb2NvdW50Kys7XG4gICAgICB9XG4gICAgICBpZiAoZ2VvY291bnQgPiAxKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcbiAgICAgICAgICBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgICAgICd0aGVyZSBjYW4gb25seSBiZSBvbmUgZ2VvcG9pbnQgZmllbGQgaW4gYSBjbGFzcydcbiAgICAgICAgICApXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIG9iamVjdCkge1xuICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBleHBlY3RlZCA9IGdldFR5cGUob2JqZWN0W2ZpZWxkTmFtZV0pO1xuICAgICAgaWYgKCFleHBlY3RlZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZE5hbWUgPT09ICdBQ0wnKSB7XG4gICAgICAgIC8vIEV2ZXJ5IG9iamVjdCBoYXMgQUNMIGltcGxpY2l0bHkuXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgcHJvbWlzZXMucHVzaChzY2hlbWEuZW5mb3JjZUZpZWxkRXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCBleHBlY3RlZCwgdHJ1ZSwgbWFpbnRlbmFuY2UpKTtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgICBjb25zdCBlbmZvcmNlRmllbGRzID0gcmVzdWx0cy5maWx0ZXIocmVzdWx0ID0+ICEhcmVzdWx0KTtcblxuICAgIGlmIChlbmZvcmNlRmllbGRzLmxlbmd0aCAhPT0gMCkge1xuICAgICAgLy8gVE9ETzogUmVtb3ZlIGJ5IHVwZGF0aW5nIHNjaGVtYSBjYWNoZSBkaXJlY3RseVxuICAgICAgYXdhaXQgdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KTtcbiAgICB9XG4gICAgdGhpcy5lbnN1cmVGaWVsZHMoZW5mb3JjZUZpZWxkcyk7XG5cbiAgICBjb25zdCBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKHNjaGVtYSk7XG4gICAgcmV0dXJuIHRoZW5WYWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhwcm9taXNlLCBjbGFzc05hbWUsIG9iamVjdCwgcXVlcnkpO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIHRoYXQgYWxsIHRoZSBwcm9wZXJ0aWVzIGFyZSBzZXQgZm9yIHRoZSBvYmplY3RcbiAgdmFsaWRhdGVSZXF1aXJlZENvbHVtbnMoY2xhc3NOYW1lOiBzdHJpbmcsIG9iamVjdDogYW55LCBxdWVyeTogYW55KSB7XG4gICAgY29uc3QgY29sdW1ucyA9IHJlcXVpcmVkQ29sdW1ucy53cml0ZVtjbGFzc05hbWVdO1xuICAgIGlmICghY29sdW1ucyB8fCBjb2x1bW5zLmxlbmd0aCA9PSAwKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMpO1xuICAgIH1cblxuICAgIGNvbnN0IG1pc3NpbmdDb2x1bW5zID0gY29sdW1ucy5maWx0ZXIoZnVuY3Rpb24gKGNvbHVtbikge1xuICAgICAgaWYgKHF1ZXJ5ICYmIHF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgICAgIGlmIChvYmplY3RbY29sdW1uXSAmJiB0eXBlb2Ygb2JqZWN0W2NvbHVtbl0gPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgLy8gVHJ5aW5nIHRvIGRlbGV0ZSBhIHJlcXVpcmVkIGNvbHVtblxuICAgICAgICAgIHJldHVybiBvYmplY3RbY29sdW1uXS5fX29wID09ICdEZWxldGUnO1xuICAgICAgICB9XG4gICAgICAgIC8vIE5vdCB0cnlpbmcgdG8gZG8gYW55dGhpbmcgdGhlcmVcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuICFvYmplY3RbY29sdW1uXTtcbiAgICB9KTtcblxuICAgIGlmIChtaXNzaW5nQ29sdW1ucy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsIG1pc3NpbmdDb2x1bW5zWzBdICsgJyBpcyByZXF1aXJlZC4nKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgfVxuXG4gIHRlc3RQZXJtaXNzaW9uc0ZvckNsYXNzTmFtZShjbGFzc05hbWU6IHN0cmluZywgYWNsR3JvdXA6IHN0cmluZ1tdLCBvcGVyYXRpb246IHN0cmluZykge1xuICAgIHJldHVybiBTY2hlbWFDb250cm9sbGVyLnRlc3RQZXJtaXNzaW9ucyhcbiAgICAgIHRoaXMuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZSksXG4gICAgICBhY2xHcm91cCxcbiAgICAgIG9wZXJhdGlvblxuICAgICk7XG4gIH1cblxuICAvLyBUZXN0cyB0aGF0IHRoZSBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uIGxldCBwYXNzIHRoZSBvcGVyYXRpb24gZm9yIGEgZ2l2ZW4gYWNsR3JvdXBcbiAgc3RhdGljIHRlc3RQZXJtaXNzaW9ucyhjbGFzc1Blcm1pc3Npb25zOiA/YW55LCBhY2xHcm91cDogc3RyaW5nW10sIG9wZXJhdGlvbjogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgaWYgKCFjbGFzc1Blcm1pc3Npb25zIHx8ICFjbGFzc1Blcm1pc3Npb25zW29wZXJhdGlvbl0pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBjb25zdCBwZXJtcyA9IGNsYXNzUGVybWlzc2lvbnNbb3BlcmF0aW9uXTtcbiAgICBpZiAocGVybXNbJyonXSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIC8vIENoZWNrIHBlcm1pc3Npb25zIGFnYWluc3QgdGhlIGFjbEdyb3VwIHByb3ZpZGVkIChhcnJheSBvZiB1c2VySWQvcm9sZXMpXG4gICAgaWYgKFxuICAgICAgYWNsR3JvdXAuc29tZShhY2wgPT4ge1xuICAgICAgICByZXR1cm4gcGVybXNbYWNsXSA9PT0gdHJ1ZTtcbiAgICAgIH0pXG4gICAgKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIGFuIG9wZXJhdGlvbiBwYXNzZXMgY2xhc3MtbGV2ZWwtcGVybWlzc2lvbnMgc2V0IGluIHRoZSBzY2hlbWFcbiAgc3RhdGljIHZhbGlkYXRlUGVybWlzc2lvbihcbiAgICBjbGFzc1Blcm1pc3Npb25zOiA/YW55LFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGFjbEdyb3VwOiBzdHJpbmdbXSxcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBhY3Rpb24/OiBzdHJpbmdcbiAgKSB7XG4gICAgaWYgKFNjaGVtYUNvbnRyb2xsZXIudGVzdFBlcm1pc3Npb25zKGNsYXNzUGVybWlzc2lvbnMsIGFjbEdyb3VwLCBvcGVyYXRpb24pKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgaWYgKCFjbGFzc1Blcm1pc3Npb25zIHx8ICFjbGFzc1Blcm1pc3Npb25zW29wZXJhdGlvbl0pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBjb25zdCBwZXJtcyA9IGNsYXNzUGVybWlzc2lvbnNbb3BlcmF0aW9uXTtcbiAgICBjb25zdCBjb25maWcgPSBDb25maWcuZ2V0KFBhcnNlLmFwcGxpY2F0aW9uSWQpXG4gICAgLy8gSWYgb25seSBmb3IgYXV0aGVudGljYXRlZCB1c2Vyc1xuICAgIC8vIG1ha2Ugc3VyZSB3ZSBoYXZlIGFuIGFjbEdyb3VwXG4gICAgaWYgKHBlcm1zWydyZXF1aXJlc0F1dGhlbnRpY2F0aW9uJ10pIHtcbiAgICAgIC8vIElmIGFjbEdyb3VwIGhhcyAqIChwdWJsaWMpXG4gICAgICBpZiAoIWFjbEdyb3VwIHx8IGFjbEdyb3VwLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgJ1Blcm1pc3Npb24gZGVuaWVkLCB1c2VyIG5lZWRzIHRvIGJlIGF1dGhlbnRpY2F0ZWQuJyxcbiAgICAgICAgICBjb25maWdcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoYWNsR3JvdXAuaW5kZXhPZignKicpID4gLTEgJiYgYWNsR3JvdXAubGVuZ3RoID09IDEpIHtcbiAgICAgICAgdGhyb3cgY3JlYXRlU2FuaXRpemVkRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAnUGVybWlzc2lvbiBkZW5pZWQsIHVzZXIgbmVlZHMgdG8gYmUgYXV0aGVudGljYXRlZC4nLFxuICAgICAgICAgIGNvbmZpZ1xuICAgICAgICApO1xuICAgICAgfVxuICAgICAgLy8gcmVxdWlyZXNBdXRoZW50aWNhdGlvbiBwYXNzZWQsIGp1c3QgbW92ZSBmb3J3YXJkXG4gICAgICAvLyBwcm9iYWJseSB3b3VsZCBiZSB3aXNlIGF0IHNvbWUgcG9pbnQgdG8gcmVuYW1lIHRvICdhdXRoZW50aWNhdGVkVXNlcidcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICAvLyBObyBtYXRjaGluZyBDTFAsIGxldCdzIGNoZWNrIHRoZSBQb2ludGVyIHBlcm1pc3Npb25zXG4gICAgLy8gQW5kIGhhbmRsZSB0aG9zZSBsYXRlclxuICAgIGNvbnN0IHBlcm1pc3Npb25GaWVsZCA9XG4gICAgICBbJ2dldCcsICdmaW5kJywgJ2NvdW50J10uaW5kZXhPZihvcGVyYXRpb24pID4gLTEgPyAncmVhZFVzZXJGaWVsZHMnIDogJ3dyaXRlVXNlckZpZWxkcyc7XG5cbiAgICAvLyBSZWplY3QgY3JlYXRlIHdoZW4gd3JpdGUgbG9ja2Rvd25cbiAgICBpZiAocGVybWlzc2lvbkZpZWxkID09ICd3cml0ZVVzZXJGaWVsZHMnICYmIG9wZXJhdGlvbiA9PSAnY3JlYXRlJykge1xuICAgICAgdGhyb3cgY3JlYXRlU2FuaXRpemVkRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAgIGBQZXJtaXNzaW9uIGRlbmllZCBmb3IgYWN0aW9uICR7b3BlcmF0aW9ufSBvbiBjbGFzcyAke2NsYXNzTmFtZX0uYCxcbiAgICAgICAgY29uZmlnXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgdGhlIHJlYWRVc2VyRmllbGRzIGxhdGVyXG4gICAgaWYgKFxuICAgICAgQXJyYXkuaXNBcnJheShjbGFzc1Blcm1pc3Npb25zW3Blcm1pc3Npb25GaWVsZF0pICYmXG4gICAgICBjbGFzc1Blcm1pc3Npb25zW3Blcm1pc3Npb25GaWVsZF0ubGVuZ3RoID4gMFxuICAgICkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIGNvbnN0IHBvaW50ZXJGaWVsZHMgPSBjbGFzc1Blcm1pc3Npb25zW29wZXJhdGlvbl0ucG9pbnRlckZpZWxkcztcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwb2ludGVyRmllbGRzKSAmJiBwb2ludGVyRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIGFueSBvcCBleGNlcHQgJ2FkZEZpZWxkIGFzIHBhcnQgb2YgY3JlYXRlJyBpcyBvay5cbiAgICAgIGlmIChvcGVyYXRpb24gIT09ICdhZGRGaWVsZCcgfHwgYWN0aW9uID09PSAndXBkYXRlJykge1xuICAgICAgICAvLyBXZSBjYW4gYWxsb3cgYWRkaW5nIGZpZWxkIG9uIHVwZGF0ZSBmbG93IG9ubHkuXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aHJvdyBjcmVhdGVTYW5pdGl6ZWRFcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICBgUGVybWlzc2lvbiBkZW5pZWQgZm9yIGFjdGlvbiAke29wZXJhdGlvbn0gb24gY2xhc3MgJHtjbGFzc05hbWV9LmAsXG4gICAgICBjb25maWdcbiAgICApO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIGFuIG9wZXJhdGlvbiBwYXNzZXMgY2xhc3MtbGV2ZWwtcGVybWlzc2lvbnMgc2V0IGluIHRoZSBzY2hlbWFcbiAgdmFsaWRhdGVQZXJtaXNzaW9uKGNsYXNzTmFtZTogc3RyaW5nLCBhY2xHcm91cDogc3RyaW5nW10sIG9wZXJhdGlvbjogc3RyaW5nLCBhY3Rpb24/OiBzdHJpbmcpIHtcbiAgICByZXR1cm4gU2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oXG4gICAgICB0aGlzLmdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWUpLFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgYWNsR3JvdXAsXG4gICAgICBvcGVyYXRpb24sXG4gICAgICBhY3Rpb25cbiAgICApO1xuICB9XG5cbiAgZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nKTogYW55IHtcbiAgICByZXR1cm4gdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0gJiYgdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0uY2xhc3NMZXZlbFBlcm1pc3Npb25zO1xuICB9XG5cbiAgLy8gUmV0dXJucyB0aGUgZXhwZWN0ZWQgdHlwZSBmb3IgYSBjbGFzc05hbWUra2V5IGNvbWJpbmF0aW9uXG4gIC8vIG9yIHVuZGVmaW5lZCBpZiB0aGUgc2NoZW1hIGlzIG5vdCBzZXRcbiAgZ2V0RXhwZWN0ZWRUeXBlKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZyk6ID8oU2NoZW1hRmllbGQgfCBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgIGNvbnN0IGV4cGVjdGVkVHlwZSA9IHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdLmZpZWxkc1tmaWVsZE5hbWVdO1xuICAgICAgcmV0dXJuIGV4cGVjdGVkVHlwZSA9PT0gJ21hcCcgPyAnT2JqZWN0JyA6IGV4cGVjdGVkVHlwZTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8vIENoZWNrcyBpZiBhIGdpdmVuIGNsYXNzIGlzIGluIHRoZSBzY2hlbWEuXG4gIGhhc0NsYXNzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRydWUpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKCkudGhlbigoKSA9PiAhIXRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKTtcbiAgfVxufVxuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYSBuZXcgU2NoZW1hLlxuY29uc3QgbG9hZCA9IChkYkFkYXB0ZXI6IFN0b3JhZ2VBZGFwdGVyLCBvcHRpb25zOiBhbnkpOiBQcm9taXNlPFNjaGVtYUNvbnRyb2xsZXI+ID0+IHtcbiAgY29uc3Qgc2NoZW1hID0gbmV3IFNjaGVtYUNvbnRyb2xsZXIoZGJBZGFwdGVyKTtcbiAgdHRsLmR1cmF0aW9uID0gZGJBZGFwdGVyLnNjaGVtYUNhY2hlVHRsO1xuICByZXR1cm4gc2NoZW1hLnJlbG9hZERhdGEob3B0aW9ucykudGhlbigoKSA9PiBzY2hlbWEpO1xufTtcblxuLy8gQnVpbGRzIGEgbmV3IHNjaGVtYSAoaW4gc2NoZW1hIEFQSSByZXNwb25zZSBmb3JtYXQpIG91dCBvZiBhblxuLy8gZXhpc3RpbmcgbW9uZ28gc2NoZW1hICsgYSBzY2hlbWFzIEFQSSBwdXQgcmVxdWVzdC4gVGhpcyByZXNwb25zZVxuLy8gZG9lcyBub3QgaW5jbHVkZSB0aGUgZGVmYXVsdCBmaWVsZHMsIGFzIGl0IGlzIGludGVuZGVkIHRvIGJlIHBhc3NlZFxuLy8gdG8gbW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lLiBObyB2YWxpZGF0aW9uIGlzIGRvbmUgaGVyZSwgaXRcbi8vIGlzIGRvbmUgaW4gbW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lLlxuZnVuY3Rpb24gYnVpbGRNZXJnZWRTY2hlbWFPYmplY3QoZXhpc3RpbmdGaWVsZHM6IFNjaGVtYUZpZWxkcywgcHV0UmVxdWVzdDogYW55KTogU2NoZW1hRmllbGRzIHtcbiAgY29uc3QgbmV3U2NoZW1hID0ge307XG4gIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICBjb25zdCBzeXNTY2hlbWFGaWVsZCA9XG4gICAgT2JqZWN0LmtleXMoZGVmYXVsdENvbHVtbnMpLmluZGV4T2YoZXhpc3RpbmdGaWVsZHMuX2lkKSA9PT0gLTFcbiAgICAgID8gW11cbiAgICAgIDogT2JqZWN0LmtleXMoZGVmYXVsdENvbHVtbnNbZXhpc3RpbmdGaWVsZHMuX2lkXSk7XG4gIGZvciAoY29uc3Qgb2xkRmllbGQgaW4gZXhpc3RpbmdGaWVsZHMpIHtcbiAgICBpZiAoXG4gICAgICBvbGRGaWVsZCAhPT0gJ19pZCcgJiZcbiAgICAgIG9sZEZpZWxkICE9PSAnQUNMJyAmJlxuICAgICAgb2xkRmllbGQgIT09ICd1cGRhdGVkQXQnICYmXG4gICAgICBvbGRGaWVsZCAhPT0gJ2NyZWF0ZWRBdCcgJiZcbiAgICAgIG9sZEZpZWxkICE9PSAnb2JqZWN0SWQnXG4gICAgKSB7XG4gICAgICBpZiAoc3lzU2NoZW1hRmllbGQubGVuZ3RoID4gMCAmJiBzeXNTY2hlbWFGaWVsZC5pbmRleE9mKG9sZEZpZWxkKSAhPT0gLTEpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBmaWVsZElzRGVsZXRlZCA9IHB1dFJlcXVlc3Rbb2xkRmllbGRdICYmIHB1dFJlcXVlc3Rbb2xkRmllbGRdLl9fb3AgPT09ICdEZWxldGUnO1xuICAgICAgaWYgKCFmaWVsZElzRGVsZXRlZCkge1xuICAgICAgICBuZXdTY2hlbWFbb2xkRmllbGRdID0gZXhpc3RpbmdGaWVsZHNbb2xkRmllbGRdO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBmb3IgKGNvbnN0IG5ld0ZpZWxkIGluIHB1dFJlcXVlc3QpIHtcbiAgICBpZiAobmV3RmllbGQgIT09ICdvYmplY3RJZCcgJiYgcHV0UmVxdWVzdFtuZXdGaWVsZF0uX19vcCAhPT0gJ0RlbGV0ZScpIHtcbiAgICAgIGlmIChzeXNTY2hlbWFGaWVsZC5sZW5ndGggPiAwICYmIHN5c1NjaGVtYUZpZWxkLmluZGV4T2YobmV3RmllbGQpICE9PSAtMSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIG5ld1NjaGVtYVtuZXdGaWVsZF0gPSBwdXRSZXF1ZXN0W25ld0ZpZWxkXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ld1NjaGVtYTtcbn1cblxuLy8gR2l2ZW4gYSBzY2hlbWEgcHJvbWlzZSwgY29uc3RydWN0IGFub3RoZXIgc2NoZW1hIHByb21pc2UgdGhhdFxuLy8gdmFsaWRhdGVzIHRoaXMgZmllbGQgb25jZSB0aGUgc2NoZW1hIGxvYWRzLlxuZnVuY3Rpb24gdGhlblZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zKHNjaGVtYVByb21pc2UsIGNsYXNzTmFtZSwgb2JqZWN0LCBxdWVyeSkge1xuICByZXR1cm4gc2NoZW1hUHJvbWlzZS50aGVuKHNjaGVtYSA9PiB7XG4gICAgcmV0dXJuIHNjaGVtYS52YWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhjbGFzc05hbWUsIG9iamVjdCwgcXVlcnkpO1xuICB9KTtcbn1cblxuLy8gR2V0cyB0aGUgdHlwZSBmcm9tIGEgUkVTVCBBUEkgZm9ybWF0dGVkIG9iamVjdCwgd2hlcmUgJ3R5cGUnIGlzXG4vLyBleHRlbmRlZCBwYXN0IGphdmFzY3JpcHQgdHlwZXMgdG8gaW5jbHVkZSB0aGUgcmVzdCBvZiB0aGUgUGFyc2Vcbi8vIHR5cGUgc3lzdGVtLlxuLy8gVGhlIG91dHB1dCBzaG91bGQgYmUgYSB2YWxpZCBzY2hlbWEgdmFsdWUuXG4vLyBUT0RPOiBlbnN1cmUgdGhhdCB0aGlzIGlzIGNvbXBhdGlibGUgd2l0aCB0aGUgZm9ybWF0IHVzZWQgaW4gT3BlbiBEQlxuZnVuY3Rpb24gZ2V0VHlwZShvYmo6IGFueSk6ID8oU2NoZW1hRmllbGQgfCBzdHJpbmcpIHtcbiAgY29uc3QgdHlwZSA9IHR5cGVvZiBvYmo7XG4gIHN3aXRjaCAodHlwZSkge1xuICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgcmV0dXJuICdCb29sZWFuJztcbiAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgcmV0dXJuICdTdHJpbmcnO1xuICAgIGNhc2UgJ251bWJlcic6XG4gICAgICByZXR1cm4gJ051bWJlcic7XG4gICAgY2FzZSAnbWFwJzpcbiAgICBjYXNlICdvYmplY3QnOlxuICAgICAgaWYgKCFvYmopIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBnZXRPYmplY3RUeXBlKG9iaik7XG4gICAgY2FzZSAnZnVuY3Rpb24nOlxuICAgIGNhc2UgJ3N5bWJvbCc6XG4gICAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgJ2JhZCBvYmo6ICcgKyBvYmo7XG4gIH1cbn1cblxuLy8gVGhpcyBnZXRzIHRoZSB0eXBlIGZvciBub24tSlNPTiB0eXBlcyBsaWtlIHBvaW50ZXJzIGFuZCBmaWxlcywgYnV0XG4vLyBhbHNvIGdldHMgdGhlIGFwcHJvcHJpYXRlIHR5cGUgZm9yICQgb3BlcmF0b3JzLlxuLy8gUmV0dXJucyBudWxsIGlmIHRoZSB0eXBlIGlzIHVua25vd24uXG5mdW5jdGlvbiBnZXRPYmplY3RUeXBlKG9iaik6ID8oU2NoZW1hRmllbGQgfCBzdHJpbmcpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkob2JqKSkge1xuICAgIHJldHVybiAnQXJyYXknO1xuICB9XG4gIGlmIChvYmouX190eXBlKSB7XG4gICAgc3dpdGNoIChvYmouX190eXBlKSB7XG4gICAgICBjYXNlICdQb2ludGVyJzpcbiAgICAgICAgaWYgKG9iai5jbGFzc05hbWUpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogJ1BvaW50ZXInLFxuICAgICAgICAgICAgdGFyZ2V0Q2xhc3M6IG9iai5jbGFzc05hbWUsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1JlbGF0aW9uJzpcbiAgICAgICAgaWYgKG9iai5jbGFzc05hbWUpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgICAgIHRhcmdldENsYXNzOiBvYmouY2xhc3NOYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdGaWxlJzpcbiAgICAgICAgaWYgKG9iai5uYW1lKSB7XG4gICAgICAgICAgcmV0dXJuICdGaWxlJztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0RhdGUnOlxuICAgICAgICBpZiAob2JqLmlzbykge1xuICAgICAgICAgIHJldHVybiAnRGF0ZSc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdHZW9Qb2ludCc6XG4gICAgICAgIGlmIChvYmoubGF0aXR1ZGUgIT0gbnVsbCAmJiBvYmoubG9uZ2l0dWRlICE9IG51bGwpIHtcbiAgICAgICAgICByZXR1cm4gJ0dlb1BvaW50JztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0J5dGVzJzpcbiAgICAgICAgaWYgKG9iai5iYXNlNjQpIHtcbiAgICAgICAgICByZXR1cm4gJ0J5dGVzJztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1BvbHlnb24nOlxuICAgICAgICBpZiAob2JqLmNvb3JkaW5hdGVzKSB7XG4gICAgICAgICAgcmV0dXJuICdQb2x5Z29uJztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLCAnVGhpcyBpcyBub3QgYSB2YWxpZCAnICsgb2JqLl9fdHlwZSk7XG4gIH1cbiAgaWYgKG9ialsnJG5lJ10pIHtcbiAgICByZXR1cm4gZ2V0T2JqZWN0VHlwZShvYmpbJyRuZSddKTtcbiAgfVxuICBpZiAob2JqLl9fb3ApIHtcbiAgICBzd2l0Y2ggKG9iai5fX29wKSB7XG4gICAgICBjYXNlICdJbmNyZW1lbnQnOlxuICAgICAgICByZXR1cm4gJ051bWJlcic7XG4gICAgICBjYXNlICdEZWxldGUnOlxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIGNhc2UgJ0FkZCc6XG4gICAgICBjYXNlICdBZGRVbmlxdWUnOlxuICAgICAgY2FzZSAnUmVtb3ZlJzpcbiAgICAgICAgcmV0dXJuICdBcnJheSc7XG4gICAgICBjYXNlICdBZGRSZWxhdGlvbic6XG4gICAgICBjYXNlICdSZW1vdmVSZWxhdGlvbic6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgICB0YXJnZXRDbGFzczogb2JqLm9iamVjdHNbMF0uY2xhc3NOYW1lLFxuICAgICAgICB9O1xuICAgICAgY2FzZSAnQmF0Y2gnOlxuICAgICAgICByZXR1cm4gZ2V0T2JqZWN0VHlwZShvYmoub3BzWzBdKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93ICd1bmV4cGVjdGVkIG9wOiAnICsgb2JqLl9fb3A7XG4gICAgfVxuICB9XG4gIHJldHVybiAnT2JqZWN0Jztcbn1cblxuZXhwb3J0IHtcbiAgbG9hZCxcbiAgY2xhc3NOYW1lSXNWYWxpZCxcbiAgZmllbGROYW1lSXNWYWxpZCxcbiAgaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UsXG4gIGJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0LFxuICBzeXN0ZW1DbGFzc2VzLFxuICBkZWZhdWx0Q29sdW1ucyxcbiAgY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYSxcbiAgVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyxcbiAgU2NoZW1hQ29udHJvbGxlcixcbiAgcmVxdWlyZWRDb2x1bW5zLFxufTtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBa0JBLElBQUFBLGVBQUEsR0FBQUMsT0FBQTtBQUNBLElBQUFDLFlBQUEsR0FBQUMsc0JBQUEsQ0FBQUYsT0FBQTtBQUNBLElBQUFHLG1CQUFBLEdBQUFELHNCQUFBLENBQUFGLE9BQUE7QUFDQSxJQUFBSSxPQUFBLEdBQUFGLHNCQUFBLENBQUFGLE9BQUE7QUFDQSxJQUFBSyxNQUFBLEdBQUFMLE9BQUE7QUFBZ0QsU0FBQUUsdUJBQUFJLENBQUEsV0FBQUEsQ0FBQSxJQUFBQSxDQUFBLENBQUFDLFVBQUEsR0FBQUQsQ0FBQSxLQUFBRSxPQUFBLEVBQUFGLENBQUE7QUFyQmhEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsTUFBTUcsS0FBSyxHQUFHVCxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUNTLEtBQUs7QUFjekMsTUFBTUMsY0FBMEMsR0FBQUMsT0FBQSxDQUFBRCxjQUFBLEdBQUdFLE1BQU0sQ0FBQ0MsTUFBTSxDQUFDO0VBQy9EO0VBQ0FDLFFBQVEsRUFBRTtJQUNSQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQVMsQ0FBQztJQUM1QkMsU0FBUyxFQUFFO01BQUVELElBQUksRUFBRTtJQUFPLENBQUM7SUFDM0JFLFNBQVMsRUFBRTtNQUFFRixJQUFJLEVBQUU7SUFBTyxDQUFDO0lBQzNCRyxHQUFHLEVBQUU7TUFBRUgsSUFBSSxFQUFFO0lBQU07RUFDckIsQ0FBQztFQUNEO0VBQ0FJLEtBQUssRUFBRTtJQUNMQyxRQUFRLEVBQUU7TUFB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