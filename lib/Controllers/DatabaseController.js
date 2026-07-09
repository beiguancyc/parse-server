"use strict";

var _node = require("parse/node");
var _lodash = _interopRequireDefault(require("lodash"));
var _intersect = _interopRequireDefault(require("intersect"));
var _logger = _interopRequireDefault(require("../logger"));
var _Utils = _interopRequireDefault(require("../Utils"));
var SchemaController = _interopRequireWildcard(require("./SchemaController"));
var _StorageAdapter = require("../Adapters/Storage/StorageAdapter");
var _MongoStorageAdapter = _interopRequireDefault(require("../Adapters/Storage/Mongo/MongoStorageAdapter"));
var _PostgresStorageAdapter = _interopRequireDefault(require("../Adapters/Storage/Postgres/PostgresStorageAdapter"));
var _SchemaCache = _interopRequireDefault(require("../Adapters/Cache/SchemaCache"));
var _Error = require("../Error");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// A database adapter that works with data exported from the hosted
// Parse database.
// -disable-next
// -disable-next
// -disable-next
// Query operators that always pass validation regardless of auth level.
const queryOperators = ['$and', '$or', '$nor'];

// Registry of internal fields with access permissions.
// Internal fields are never directly writable by clients, so clientWrite is omitted.
// - clientRead: any client can use this field in queries
// - masterRead: master key can use this field in queries
// - masterWrite: master key can use this field in updates
const internalFields = {
  _rperm: {
    clientRead: true,
    masterRead: true,
    masterWrite: true
  },
  _wperm: {
    clientRead: true,
    masterRead: true,
    masterWrite: true
  },
  _hashed_password: {
    clientRead: false,
    masterRead: false,
    masterWrite: true
  },
  _email_verify_token: {
    clientRead: false,
    masterRead: true,
    masterWrite: true
  },
  _perishable_token: {
    clientRead: false,
    masterRead: true,
    masterWrite: true
  },
  _perishable_token_expires_at: {
    clientRead: false,
    masterRead: true,
    masterWrite: true
  },
  _email_verify_token_expires_at: {
    clientRead: false,
    masterRead: true,
    masterWrite: true
  },
  _failed_login_count: {
    clientRead: false,
    masterRead: true,
    masterWrite: true
  },
  _account_lockout_expires_at: {
    clientRead: false,
    masterRead: true,
    masterWrite: true
  },
  _password_changed_at: {
    clientRead: false,
    masterRead: true,
    masterWrite: true
  },
  _password_history: {
    clientRead: false,
    masterRead: true,
    masterWrite: true
  },
  _tombstone: {
    clientRead: false,
    masterRead: true,
    masterWrite: false
  },
  _session_token: {
    clientRead: false,
    masterRead: true,
    masterWrite: false
  }
  /////////////////////////////////////////////////////////////////////////////////////////////
  // The following fields are not accessed by their _-prefixed name through the API;
  // they are mapped to REST-level names in the adapter layer or handled through
  // separate code paths.
  /////////////////////////////////////////////////////////////////////////////////////////////
  // System fields (mapped to REST-level names):
  // _id (objectId)
  // _created_at (createdAt)
  // _updated_at (updatedAt)
  // _last_used (lastUsed)
  // _expiresAt (expiresAt)
  /////////////////////////////////////////////////////////////////////////////////////////////
  // Legacy ACL format: mapped to/from _rperm/_wperm
  // _acl
  /////////////////////////////////////////////////////////////////////////////////////////////
  // Schema metadata: not data fields, used only for schema configuration
  // _metadata
  // _client_permissions
  /////////////////////////////////////////////////////////////////////////////////////////////
  // Dynamic auth data fields: used only in projections and updates, not in queries
  // _auth_data_<provider>
};

// Derived access lists
const specialQueryKeys = [...queryOperators, ...Object.keys(internalFields).filter(k => internalFields[k].clientRead)];
const specialMasterQueryKeys = [...queryOperators, ...Object.keys(internalFields).filter(k => internalFields[k].masterRead)];
function addWriteACL(query, acl) {
  const newQuery = _lodash.default.cloneDeep(query);
  //Can't be any existing '_wperm' query, we don't allow client queries on that, no need to $and
  newQuery._wperm = {
    $in: [null, ...acl]
  };
  return newQuery;
}
function addReadACL(query, acl) {
  const newQuery = _lodash.default.cloneDeep(query);
  //Can't be any existing '_rperm' query, we don't allow client queries on that, no need to $and
  newQuery._rperm = {
    $in: [null, '*', ...acl]
  };
  return newQuery;
}

// Transforms a REST API formatted ACL object to our two-field mongo format.
const transformObjectACL = ({
  ACL,
  ...result
}) => {
  if (!ACL) {
    return result;
  }
  result._wperm = [];
  result._rperm = [];
  for (const entry in ACL) {
    if (ACL[entry].read) {
      result._rperm.push(entry);
    }
    if (ACL[entry].write) {
      result._wperm.push(entry);
    }
  }
  return result;
};
const validateQuery = (query, isMaster, isMaintenance, update, options, _depth = 0) => {
  if (isMaintenance) {
    isMaster = true;
  }
  const rc = options?.requestComplexity;
  if (!isMaster && rc && rc.queryDepth !== -1 && _depth > rc.queryDepth) {
    throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, `Query condition nesting depth exceeds maximum allowed depth of ${rc.queryDepth}`);
  }
  if (query.ACL) {
    throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Cannot query on ACL.');
  }
  if (query.$or) {
    if (Array.isArray(query.$or)) {
      query.$or.forEach(value => validateQuery(value, isMaster, isMaintenance, update, options, _depth + 1));
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $or format - use an array value.');
    }
  }
  if (query.$and) {
    if (Array.isArray(query.$and)) {
      query.$and.forEach(value => validateQuery(value, isMaster, isMaintenance, update, options, _depth + 1));
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $and format - use an array value.');
    }
  }
  if (query.$nor) {
    if (Array.isArray(query.$nor) && query.$nor.length > 0) {
      query.$nor.forEach(value => validateQuery(value, isMaster, isMaintenance, update, options, _depth + 1));
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $nor format - use an array of at least 1 value.');
    }
  }
  Object.keys(query).forEach(key => {
    if (query && query[key] && query[key].$regex !== undefined) {
      if (!isMaster && rc && rc.allowRegex === false) {
        throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, '$regex operator is not allowed');
      }
      if (typeof query[key].$regex !== 'string') {
        throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, '$regex value must be a string');
      }
      if (query[key].$options !== undefined && typeof query[key].$options !== 'string') {
        throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, '$options value must be a string');
      }
      if (typeof query[key].$options === 'string') {
        if (!query[key].$options.match(/^[imxsu]+$/)) {
          throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, `Bad $options value for query: ${query[key].$options}`);
        }
      }
    }
    if (!key.match(/^[a-zA-Z][a-zA-Z0-9_\.]*$/) && !specialQueryKeys.includes(key) && !(isMaster && specialMasterQueryKeys.includes(key))) {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid key name: ${key}`);
    }
  });
};

// Filters out any data that shouldn't be on this REST-formatted object.
const filterSensitiveData = (isMaster, isMaintenance, aclGroup, auth, operation, schema, className, protectedFields, object, protectedFieldsOwnerExempt) => {
  let userId = null;
  if (auth && auth.user) {
    userId = auth.user.id;
  }

  // replace protectedFields when using pointer-permissions
  const perms = schema && schema.getClassLevelPermissions ? schema.getClassLevelPermissions(className) : {};
  if (perms) {
    const isReadOperation = ['get', 'find'].indexOf(operation) > -1;
    if (isReadOperation && perms.protectedFields) {
      // extract protectedFields added with the pointer-permission prefix
      const protectedFieldsPointerPerm = Object.keys(perms.protectedFields).filter(key => key.startsWith('userField:')).map(key => {
        return {
          key: key.substring(10),
          value: perms.protectedFields[key]
        };
      });
      const newProtectedFields = [];
      let overrideProtectedFields = false;

      // check if the object grants the current user access based on the extracted fields
      protectedFieldsPointerPerm.forEach(pointerPerm => {
        let pointerPermIncludesUser = false;
        const readUserFieldValue = object[pointerPerm.key];
        if (readUserFieldValue) {
          if (Array.isArray(readUserFieldValue)) {
            pointerPermIncludesUser = readUserFieldValue.some(user => user.objectId && user.objectId === userId);
          } else {
            pointerPermIncludesUser = readUserFieldValue.objectId && readUserFieldValue.objectId === userId;
          }
        }
        if (pointerPermIncludesUser) {
          overrideProtectedFields = true;
          newProtectedFields.push(pointerPerm.value);
        }
      });

      // if at least one pointer-permission affected the current user
      // intersect vs protectedFields from previous stage (@see addProtectedFields)
      // Sets theory (intersections): A x (B x C) == (A x B) x C
      if (overrideProtectedFields && protectedFields) {
        newProtectedFields.push(protectedFields);
      }
      // intersect all sets of protectedFields
      newProtectedFields.forEach(fields => {
        if (fields) {
          // if there're no protctedFields by other criteria ( id / role / auth)
          // then we must intersect each set (per userField)
          if (!protectedFields) {
            protectedFields = fields;
          } else {
            protectedFields = protectedFields.filter(v => fields.includes(v));
          }
        }
      });
    }
  }
  const isUserClass = className === '_User';
  if (isUserClass) {
    object.password = object._hashed_password;
    delete object._hashed_password;
    delete object.sessionToken;
  }
  if (isMaintenance) {
    return object;
  }

  /* special treat for the user class: don't filter protectedFields if currently loggedin user is
  the retrieved user, unless protectedFieldsOwnerExempt is false */
  const isOwnerExempt = protectedFieldsOwnerExempt !== false && isUserClass && userId && object.objectId === userId;
  if (!isOwnerExempt) {
    protectedFields && protectedFields.forEach(k => delete object[k]);

    // fields not requested by client (excluded),
    // but were needed to apply protectedFields
    perms?.protectedFields?.temporaryKeys?.forEach(k => delete object[k]);
  }
  for (const key in object) {
    if (key.charAt(0) === '_') {
      delete object[key];
    }
  }
  if (!isUserClass || isMaster) {
    return object;
  }
  if (aclGroup.indexOf(object.objectId) > -1) {
    return object;
  }
  delete object.authData;
  return object;
};

// Runs an update on the database.
// Returns a promise for an object with the new values for field
// modifications that don't know their results ahead of time, like
// 'increment'.
// Options:
//   acl:  a list of strings. If the object to be updated has an ACL,
//         one of the provided strings must provide the caller with
//         write permissions.
const specialKeysForUpdate = Object.keys(internalFields).filter(k => internalFields[k].masterWrite);
const isSpecialUpdateKey = key => {
  return specialKeysForUpdate.indexOf(key) >= 0;
};
function joinTableName(className, key) {
  return `_Join:${key}:${className}`;
}
const flattenUpdateOperatorsForCreate = object => {
  for (const key in object) {
    if (object[key] && object[key].__op) {
      switch (object[key].__op) {
        case 'Increment':
          if (typeof object[key].amount !== 'number') {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = object[key].amount;
          break;
        case 'SetOnInsert':
          object[key] = object[key].amount;
          break;
        case 'Add':
          if (!Array.isArray(object[key].objects)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = object[key].objects;
          break;
        case 'AddUnique':
          if (!Array.isArray(object[key].objects)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = object[key].objects;
          break;
        case 'Remove':
          if (!Array.isArray(object[key].objects)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = [];
          break;
        case 'Delete':
          delete object[key];
          break;
        default:
          throw new _node.Parse.Error(_node.Parse.Error.COMMAND_UNAVAILABLE, `The ${object[key].__op} operator is not supported yet.`);
      }
    }
  }
};
const transformAuthData = (className, object, schema) => {
  if (object.authData && className === '_User') {
    Object.keys(object.authData).forEach(provider => {
      const providerData = object.authData[provider];
      const fieldName = `_auth_data_${provider}`;
      if (providerData == null) {
        object[fieldName] = {
          __op: 'Delete'
        };
      } else {
        object[fieldName] = providerData;
        schema.fields[fieldName] = {
          type: 'Object'
        };
      }
    });
    delete object.authData;
  }
};
// Transforms a Database format ACL to a REST API format ACL
const untransformObjectACL = ({
  _rperm,
  _wperm,
  ...output
}) => {
  if (_rperm || _wperm) {
    output.ACL = {};
    (_rperm || []).forEach(entry => {
      if (!output.ACL[entry]) {
        output.ACL[entry] = {
          read: true
        };
      } else {
        output.ACL[entry]['read'] = true;
      }
    });
    (_wperm || []).forEach(entry => {
      if (!output.ACL[entry]) {
        output.ACL[entry] = {
          write: true
        };
      } else {
        output.ACL[entry]['write'] = true;
      }
    });
  }
  return output;
};

/**
 * When querying, the fieldName may be compound, extract the root fieldName
 *     `temperature.celsius` becomes `temperature`
 * @param {string} fieldName that may be a compound field name
 * @returns {string} the root name of the field
 */
const getRootFieldName = fieldName => {
  return fieldName.split('.')[0];
};
const relationSchema = {
  fields: {
    relatedId: {
      type: 'String'
    },
    owningId: {
      type: 'String'
    }
  }
};
const convertEmailToLowercase = (object, className, options) => {
  if (className === '_User' && options.convertEmailToLowercase) {
    if (typeof object['email'] === 'string') {
      object['email'] = object['email'].toLowerCase();
    }
  }
};
const convertUsernameToLowercase = (object, className, options) => {
  if (className === '_User' && options.convertUsernameToLowercase) {
    if (typeof object['username'] === 'string') {
      object['username'] = object['username'].toLowerCase();
    }
  }
};
class DatabaseController {
  constructor(adapter, options) {
    this.adapter = adapter;
    this.options = options || {};
    this.idempotencyOptions = this.options.idempotencyOptions || {};
    // Prevent mutable this.schema, otherwise one request could use
    // multiple schemas, so instead use loadSchema to get a schema.
    this.schemaPromise = null;
    this._transactionalSession = null;
    this.options = options;
  }
  collectionExists(className) {
    return this.adapter.classExists(className);
  }
  purgeCollection(className) {
    return this.loadSchema().then(schemaController => schemaController.getOneSchema(className)).then(schema => this.adapter.deleteObjectsByQuery(className, schema, {}));
  }
  validateClassName(className) {
    if (!SchemaController.classNameIsValid(className)) {
      return Promise.reject(new _node.Parse.Error(_node.Parse.Error.INVALID_CLASS_NAME, 'invalid className: ' + className));
    }
    return Promise.resolve();
  }

  // Returns a promise for a schemaController.
  loadSchema(options = {
    clearCache: false
  }) {
    if (this.schemaPromise != null) {
      return this.schemaPromise;
    }
    this.schemaPromise = SchemaController.load(this.adapter, options);
    this.schemaPromise.then(() => delete this.schemaPromise, () => delete this.schemaPromise);
    return this.loadSchema(options);
  }
  loadSchemaIfNeeded(schemaController, options = {
    clearCache: false
  }) {
    return schemaController ? Promise.resolve(schemaController) : this.loadSchema(options);
  }

  // Returns a promise for the classname that is related to the given
  // classname through the key.
  // TODO: make this not in the DatabaseController interface
  redirectClassNameForKey(className, key) {
    return this.loadSchema().then(schema => {
      var t = schema.getExpectedType(className, key);
      if (t != null && typeof t !== 'string' && t.type === 'Relation') {
        return t.targetClass;
      }
      return className;
    });
  }

  // Uses the schema to validate the object (REST API format).
  // Returns a promise that resolves to the new schema.
  // This does not update this.schema, because in a situation like a
  // batch request, that could confuse other users of the schema.
  validateObject(className, object, query, runOptions, maintenance) {
    let schema;
    const acl = runOptions.acl;
    const isMaster = acl === undefined;
    var aclGroup = acl || [];
    return this.loadSchema().then(s => {
      schema = s;
      if (isMaster) {
        return Promise.resolve();
      }
      return this.canAddField(schema, className, object, aclGroup, runOptions);
    }).then(() => {
      return schema.validateObject(className, object, query, maintenance);
    });
  }

  /**
   * Updates objects in the database that match the given query.
   * @param {Object} options
   * @param {boolean} [options.many=false] When true, updates all matching documents
   *   and returns `{ matchedCount, modifiedCount }` where values are numbers if the
   *   storage adapter supports `UpdateManyResult`, or `undefined` otherwise.
   */
  update(className, query, update, {
    acl,
    many,
    upsert,
    addsField
  } = {}, skipSanitization = false, validateOnly = false, validSchemaController) {
    try {
      _Utils.default.checkProhibitedKeywords(this.options, update);
    } catch (error) {
      return Promise.reject(new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `${error}`));
    }
    try {
      const {
        validateFileUrlsInObject
      } = require('../FileUrlValidator');
      validateFileUrlsInObject(update, this.options);
    } catch (error) {
      return Promise.reject(error instanceof _node.Parse.Error ? error : new _node.Parse.Error(_node.Parse.Error.FILE_SAVE_ERROR, error.message || error));
    }
    const originalQuery = query;
    const originalUpdate = update;
    // Make a copy of the object, so we don't mutate the incoming data.
    update = structuredClone(update);
    var relationUpdates = [];
    var isMaster = acl === undefined;
    var aclGroup = acl || [];
    return this.loadSchemaIfNeeded(validSchemaController).then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'update')).then(() => {
        relationUpdates = this.collectRelationUpdates(className, originalQuery.objectId, update);
        if (!isMaster) {
          query = this.addPointerPermissions(schemaController, className, 'update', query, aclGroup);
          if (addsField) {
            query = {
              $and: [query, this.addPointerPermissions(schemaController, className, 'addField', query, aclGroup)]
            };
          }
        }
        if (!query) {
          return Promise.resolve();
        }
        if (acl) {
          query = addWriteACL(query, acl);
        }
        validateQuery(query, isMaster, false, true, this.options);
        return schemaController.getOneSchema(className, true).catch(error => {
          // If the schema doesn't exist, pretend it exists with no fields. This behavior
          // will likely need revisiting.
          if (error === undefined) {
            return {
              fields: {}
            };
          }
          throw error;
        }).then(schema => {
          Object.keys(update).forEach(fieldName => {
            if (fieldName.match(/^authData\./)) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name for update: ${fieldName}`);
            }
            const rootFieldName = getRootFieldName(fieldName);
            if (!SchemaController.fieldNameIsValid(rootFieldName, className) && !isSpecialUpdateKey(rootFieldName)) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name for update: ${fieldName}`);
            }
          });
          for (const updateOperation in update) {
            if (update[updateOperation] && typeof update[updateOperation] === 'object' && Object.keys(update[updateOperation]).some(innerKey => innerKey.includes('$') || innerKey.includes('.'))) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
            }
          }
          update = transformObjectACL(update);
          convertEmailToLowercase(update, className, this.options);
          convertUsernameToLowercase(update, className, this.options);
          transformAuthData(className, update, schema);
          if (validateOnly) {
            return this.adapter.find(className, schema, query, {
              readPreference: 'primary'
            }).then(result => {
              if (!result || !result.length) {
                throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
              }
              return {};
            });
          }
          if (many) {
            return this.adapter.updateObjectsByQuery(className, schema, query, update, this._transactionalSession);
          } else if (upsert) {
            return this.adapter.upsertOneObject(className, schema, query, update, this._transactionalSession);
          } else {
            return this.adapter.findOneAndUpdate(className, schema, query, update, this._transactionalSession);
          }
        });
      }).then(result => {
        if (!result) {
          throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
        }
        if (validateOnly) {
          return result;
        }
        return this.handleRelationUpdates(className, originalQuery.objectId, update, relationUpdates).then(() => {
          return result;
        });
      }).then(result => {
        if (skipSanitization) {
          return Promise.resolve(result);
        }
        if (many) {
          return {
            matchedCount: typeof result?.matchedCount === 'number' ? result.matchedCount : undefined,
            modifiedCount: typeof result?.modifiedCount === 'number' ? result.modifiedCount : undefined
          };
        }
        return this._sanitizeDatabaseResult(originalUpdate, result);
      });
    });
  }

  // Collect all relation-updating operations from a REST-format update.
  // Returns a list of all relation updates to perform
  // This mutates update.
  collectRelationUpdates(className, objectId, update) {
    var ops = [];
    var deleteMe = [];
    objectId = update.objectId || objectId;
    var process = (op, key) => {
      if (!op) {
        return;
      }
      if (op.__op == 'AddRelation') {
        ops.push({
          key,
          op
        });
        deleteMe.push(key);
      }
      if (op.__op == 'RemoveRelation') {
        ops.push({
          key,
          op
        });
        deleteMe.push(key);
      }
      if (op.__op == 'Batch') {
        for (var x of op.ops) {
          process(x, key);
        }
      }
    };
    for (const key in update) {
      process(update[key], key);
    }
    for (const key of deleteMe) {
      delete update[key];
    }
    return ops;
  }

  // Processes relation-updating operations from a REST-format update.
  // Returns a promise that resolves when all updates have been performed
  handleRelationUpdates(className, objectId, update, ops) {
    var pending = [];
    objectId = update.objectId || objectId;
    ops.forEach(({
      key,
      op
    }) => {
      if (!op) {
        return;
      }
      if (op.__op == 'AddRelation') {
        for (const object of op.objects) {
          pending.push(this.addRelation(key, className, objectId, object.objectId));
        }
      }
      if (op.__op == 'RemoveRelation') {
        for (const object of op.objects) {
          pending.push(this.removeRelation(key, className, objectId, object.objectId));
        }
      }
    });
    return Promise.all(pending);
  }

  // Adds a relation.
  // Returns a promise that resolves successfully iff the add was successful.
  addRelation(key, fromClassName, fromId, toId) {
    const doc = {
      relatedId: toId,
      owningId: fromId
    };
    return this.adapter.upsertOneObject(`_Join:${key}:${fromClassName}`, relationSchema, doc, doc, this._transactionalSession);
  }

  // Removes a relation.
  // Returns a promise that resolves successfully iff the remove was
  // successful.
  removeRelation(key, fromClassName, fromId, toId) {
    var doc = {
      relatedId: toId,
      owningId: fromId
    };
    return this.adapter.deleteObjectsByQuery(`_Join:${key}:${fromClassName}`, relationSchema, doc, this._transactionalSession).catch(error => {
      // We don't care if they try to delete a non-existent relation.
      if (error.code == _node.Parse.Error.OBJECT_NOT_FOUND) {
        return;
      }
      throw error;
    });
  }

  // Removes objects matches this query from the database.
  // Returns a promise that resolves successfully iff the object was
  // deleted.
  // Options:
  //   acl:  a list of strings. If the object to be updated has an ACL,
  //         one of the provided strings must provide the caller with
  //         write permissions.
  destroy(className, query, {
    acl
  } = {}, validSchemaController) {
    const isMaster = acl === undefined;
    const aclGroup = acl || [];
    return this.loadSchemaIfNeeded(validSchemaController).then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'delete')).then(() => {
        if (!isMaster) {
          query = this.addPointerPermissions(schemaController, className, 'delete', query, aclGroup);
          if (!query) {
            throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
          }
        }
        // delete by query
        if (acl) {
          query = addWriteACL(query, acl);
        }
        validateQuery(query, isMaster, false, false, this.options);
        return schemaController.getOneSchema(className).catch(error => {
          // If the schema doesn't exist, pretend it exists with no fields. This behavior
          // will likely need revisiting.
          if (error === undefined) {
            return {
              fields: {}
            };
          }
          throw error;
        }).then(parseFormatSchema => this.adapter.deleteObjectsByQuery(className, parseFormatSchema, query, this._transactionalSession)).catch(error => {
          // When deleting sessions while changing passwords, don't throw an error if they don't have any sessions.
          if (className === '_Session' && error.code === _node.Parse.Error.OBJECT_NOT_FOUND) {
            return Promise.resolve({});
          }
          throw error;
        });
      });
    });
  }

  // Inserts an object into the database.
  // Returns a promise that resolves successfully iff the object saved.
  create(className, object, {
    acl
  } = {}, validateOnly = false, validSchemaController) {
    try {
      _Utils.default.checkProhibitedKeywords(this.options, object);
    } catch (error) {
      return Promise.reject(new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `${error}`));
    }
    try {
      const {
        validateFileUrlsInObject
      } = require('../FileUrlValidator');
      validateFileUrlsInObject(object, this.options);
    } catch (error) {
      return Promise.reject(error instanceof _node.Parse.Error ? error : new _node.Parse.Error(_node.Parse.Error.FILE_SAVE_ERROR, error.message || error));
    }
    // Make a copy of the object, so we don't mutate the incoming data.
    const originalObject = object;
    object = transformObjectACL(object);
    convertEmailToLowercase(object, className, this.options);
    convertUsernameToLowercase(object, className, this.options);
    object.createdAt = {
      iso: object.createdAt,
      __type: 'Date'
    };
    object.updatedAt = {
      iso: object.updatedAt,
      __type: 'Date'
    };
    var isMaster = acl === undefined;
    var aclGroup = acl || [];
    const relationUpdates = this.collectRelationUpdates(className, null, object);
    return this.validateClassName(className).then(() => this.loadSchemaIfNeeded(validSchemaController)).then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'create')).then(() => schemaController.enforceClassExists(className)).then(() => schemaController.getOneSchema(className, true)).then(schema => {
        transformAuthData(className, object, schema);
        flattenUpdateOperatorsForCreate(object);
        if (validateOnly) {
          return {};
        }
        return this.adapter.createObject(className, SchemaController.convertSchemaToAdapterSchema(schema), object, this._transactionalSession);
      }).then(result => {
        if (validateOnly) {
          return originalObject;
        }
        return this.handleRelationUpdates(className, object.objectId, object, relationUpdates).then(() => {
          return this._sanitizeDatabaseResult(originalObject, result.ops[0]);
        });
      });
    });
  }
  canAddField(schema, className, object, aclGroup, runOptions) {
    const classSchema = schema.schemaData[className];
    if (!classSchema) {
      return Promise.resolve();
    }
    const fields = Object.keys(object);
    const schemaFields = Object.keys(classSchema.fields);
    const newKeys = fields.filter(field => {
      // Skip fields that are unset
      if (object[field] && object[field].__op && object[field].__op === 'Delete') {
        return false;
      }
      return schemaFields.indexOf(getRootFieldName(field)) < 0;
    });
    if (newKeys.length > 0) {
      // adds a marker that new field is being adding during update
      runOptions.addsField = true;
      const action = runOptions.action;
      return schema.validatePermission(className, aclGroup, 'addField', action);
    }
    return Promise.resolve();
  }

  // Won't delete collections in the system namespace
  /**
   * Delete all classes and clears the schema cache
   *
   * @param {boolean} fast set to true if it's ok to just delete rows and not indexes
   * @returns {Promise<void>} when the deletions completes
   */
  deleteEverything(fast = false) {
    this.schemaPromise = null;
    _SchemaCache.default.clear();
    return this.adapter.deleteAllClasses(fast);
  }

  // Returns a promise for a list of related ids given an owning id.
  // className here is the owning className.
  relatedIds(className, key, owningId, queryOptions) {
    const {
      skip,
      limit,
      sort
    } = queryOptions;
    const findOptions = {};
    if (sort && sort.createdAt && this.adapter.canSortOnJoinTables) {
      findOptions.sort = {
        _id: sort.createdAt
      };
      findOptions.limit = limit;
      findOptions.skip = skip;
      queryOptions.skip = 0;
    }
    return this.adapter.find(joinTableName(className, key), relationSchema, {
      owningId
    }, findOptions).then(results => results.map(result => result.relatedId));
  }

  // Returns a promise for a list of owning ids given some related ids.
  // className here is the owning className.
  owningIds(className, key, relatedIds) {
    return this.adapter.find(joinTableName(className, key), relationSchema, {
      relatedId: {
        $in: relatedIds
      }
    }, {
      keys: ['owningId']
    }).then(results => results.map(result => result.owningId));
  }

  // Modifies query so that it no longer has $in on relation fields, or
  // equal-to-pointer constraints on relation fields.
  // Returns a promise that resolves when query is mutated
  reduceInRelation(className, query, schema) {
    // Search for an in-relation or equal-to-relation
    // Make it sequential for now, not sure of paralleization side effects
    const promises = [];
    if (query['$or']) {
      const ors = query['$or'];
      promises.push(...ors.map((aQuery, index) => {
        return this.reduceInRelation(className, aQuery, schema).then(aQuery => {
          query['$or'][index] = aQuery;
        });
      }));
    }
    if (query['$and']) {
      const ands = query['$and'];
      promises.push(...ands.map((aQuery, index) => {
        return this.reduceInRelation(className, aQuery, schema).then(aQuery => {
          query['$and'][index] = aQuery;
        });
      }));
    }
    const otherKeys = Object.keys(query).map(key => {
      if (key === '$and' || key === '$or') {
        return;
      }
      const t = schema.getExpectedType(className, key);
      if (!t || t.type !== 'Relation') {
        return Promise.resolve(query);
      }
      let queries = null;
      if (query[key] && (query[key]['$in'] || query[key]['$ne'] || query[key]['$nin'] || query[key].__type == 'Pointer')) {
        // Build the list of queries
        queries = Object.keys(query[key]).map(constraintKey => {
          let relatedIds;
          let isNegation = false;
          if (constraintKey === 'objectId') {
            relatedIds = [query[key].objectId];
          } else if (constraintKey == '$in') {
            relatedIds = query[key]['$in'].map(r => r.objectId);
          } else if (constraintKey == '$nin') {
            isNegation = true;
            relatedIds = query[key]['$nin'].map(r => r.objectId);
          } else if (constraintKey == '$ne') {
            isNegation = true;
            relatedIds = [query[key]['$ne'].objectId];
          } else {
            return;
          }
          return {
            isNegation,
            relatedIds
          };
        });
      } else {
        queries = [{
          isNegation: false,
          relatedIds: []
        }];
      }

      // remove the current queryKey as we don,t need it anymore
      delete query[key];
      // execute each query independently to build the list of
      // $in / $nin
      const promises = queries.map(q => {
        if (!q) {
          return Promise.resolve();
        }
        return this.owningIds(className, key, q.relatedIds).then(ids => {
          if (q.isNegation) {
            this.addNotInObjectIdsIds(ids, query);
          } else {
            this.addInObjectIdsIds(ids, query);
          }
          return Promise.resolve();
        });
      });
      return Promise.all(promises).then(() => {
        return Promise.resolve();
      });
    });
    return Promise.all([...promises, ...otherKeys]).then(() => {
      return Promise.resolve(query);
    });
  }

  // Modifies query so that it no longer has $relatedTo
  // Returns a promise that resolves when query is mutated
  reduceRelationKeys(className, query, queryOptions) {
    if (query['$or']) {
      return Promise.all(query['$or'].map(aQuery => {
        return this.reduceRelationKeys(className, aQuery, queryOptions);
      }));
    }
    if (query['$and']) {
      return Promise.all(query['$and'].map(aQuery => {
        return this.reduceRelationKeys(className, aQuery, queryOptions);
      }));
    }
    var relatedTo = query['$relatedTo'];
    if (relatedTo) {
      return this.relatedIds(relatedTo.object.className, relatedTo.key, relatedTo.object.objectId, queryOptions).then(ids => {
        delete query['$relatedTo'];
        this.addInObjectIdsIds(ids, query);
        return this.reduceRelationKeys(className, query, queryOptions);
      }).then(() => {});
    }
  }
  addInObjectIdsIds(ids = null, query) {
    const idsFromString = typeof query.objectId === 'string' ? [query.objectId] : null;
    const idsFromEq = query.objectId && query.objectId['$eq'] ? [query.objectId['$eq']] : null;
    const idsFromIn = query.objectId && query.objectId['$in'] ? query.objectId['$in'] : null;

    // -disable-next
    const allIds = [idsFromString, idsFromEq, idsFromIn, ids].filter(list => list !== null);
    const totalLength = allIds.reduce((memo, list) => memo + list.length, 0);
    let idsIntersection = [];
    if (totalLength > 125) {
      idsIntersection = _intersect.default.big(allIds);
    } else {
      idsIntersection = (0, _intersect.default)(allIds);
    }

    // Need to make sure we don't clobber existing shorthand $eq constraints on objectId.
    if (!('objectId' in query)) {
      query.objectId = {
        $in: undefined
      };
    } else if (typeof query.objectId === 'string') {
      query.objectId = {
        $in: undefined,
        $eq: query.objectId
      };
    }
    query.objectId['$in'] = idsIntersection;
    return query;
  }
  addNotInObjectIdsIds(ids = [], query) {
    const idsFromNin = query.objectId && query.objectId['$nin'] ? query.objectId['$nin'] : [];
    let allIds = [...idsFromNin, ...ids].filter(list => list !== null);

    // make a set and spread to remove duplicates
    allIds = [...new Set(allIds)];

    // Need to make sure we don't clobber existing shorthand $eq constraints on objectId.
    if (!('objectId' in query)) {
      query.objectId = {
        $nin: undefined
      };
    } else if (typeof query.objectId === 'string') {
      query.objectId = {
        $nin: undefined,
        $eq: query.objectId
      };
    }
    query.objectId['$nin'] = allIds;
    return query;
  }

  // Runs a query on the database.
  // Returns a promise that resolves to a list of items.
  // Options:
  //   skip    number of results to skip.
  //   limit   limit to this number of results.
  //   sort    an object where keys are the fields to sort by.
  //           the value is +1 for ascending, -1 for descending.
  //   count   run a count instead of returning results.
  //   acl     restrict this operation with an ACL for the provided array
  //           of user objectIds and roles. acl: null means no user.
  //           when this field is not present, don't do anything regarding ACLs.
  //  caseInsensitive make string comparisons case insensitive
  // TODO: make userIds not needed here. The db adapter shouldn't know
  // anything about users, ideally. Then, improve the format of the ACL
  // arg to work like the others.
  find(className, query, {
    skip,
    limit,
    acl,
    sort = {},
    count,
    keys,
    op,
    distinct,
    pipeline,
    readPreference,
    hint,
    caseInsensitive = false,
    explain,
    comment,
    rawValues,
    rawFieldNames
  } = {}, auth = {}, validSchemaController) {
    const isMaintenance = auth.isMaintenance;
    const isMaster = acl === undefined || isMaintenance;
    const aclGroup = acl || [];
    op = op || (typeof query.objectId == 'string' && Object.keys(query).length === 1 ? 'get' : 'find');
    // Count operation if counting
    op = count === true ? 'count' : op;
    let classExists = true;
    return this.loadSchemaIfNeeded(validSchemaController).then(schemaController => {
      //Allow volatile classes if querying with Master (for _PushStatus)
      //TODO: Move volatile classes concept into mongo adapter, postgres adapter shouldn't care
      //that api.parse.com breaks when _PushStatus exists in mongo.
      return schemaController.getOneSchema(className, isMaster).catch(error => {
        // Behavior for non-existent classes is kinda weird on Parse.com. Probably doesn't matter too much.
        // For now, pretend the class exists but has no objects,
        if (error === undefined) {
          classExists = false;
          return {
            fields: {}
          };
        }
        throw error;
      }).then(schema => {
        // Parse.com treats queries on _created_at and _updated_at as if they were queries on createdAt and updatedAt,
        // so duplicate that behavior here. If both are specified, the correct behavior to match Parse.com is to
        // use the one that appears first in the sort list.
        if (sort._created_at) {
          sort.createdAt = sort._created_at;
          delete sort._created_at;
        }
        if (sort._updated_at) {
          sort.updatedAt = sort._updated_at;
          delete sort._updated_at;
        }
        const queryOptions = {
          skip,
          limit,
          sort,
          keys,
          readPreference,
          hint,
          caseInsensitive: this.options.enableCollationCaseComparison ? false : caseInsensitive,
          explain,
          comment
        };
        Object.keys(sort).forEach(fieldName => {
          if (fieldName.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Cannot sort by ${fieldName}`);
          }
          const rootFieldName = getRootFieldName(fieldName);
          if (!SchemaController.fieldNameIsValid(rootFieldName, className)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}.`);
          }
          if (!schema.fields[fieldName.split('.')[0]] && fieldName !== 'score') {
            delete sort[fieldName];
          }
        });
        return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, op)).then(() => this.reduceRelationKeys(className, query, queryOptions)).then(() => this.reduceInRelation(className, query, schemaController)).then(() => {
          let protectedFields;
          if (!isMaster) {
            query = this.addPointerPermissions(schemaController, className, op, query, aclGroup);
            /* Don't use projections to optimize the protectedFields since the protectedFields
              based on pointer-permissions are determined after querying. The filtering can
              overwrite the protected fields. */
            protectedFields = this.addProtectedFields(schemaController, className, query, aclGroup, auth, queryOptions);
          }
          if (!query) {
            if (op === 'get') {
              throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
            } else {
              return [];
            }
          }
          if (!isMaster) {
            if (op === 'update' || op === 'delete') {
              query = addWriteACL(query, aclGroup);
            } else {
              query = addReadACL(query, aclGroup);
            }
          }
          validateQuery(query, isMaster, isMaintenance, false, this.options);
          if (count) {
            if (!classExists) {
              return 0;
            } else {
              return this.adapter.count(className, schema, query, readPreference, undefined, hint, comment);
            }
          } else if (distinct) {
            if (!classExists) {
              return [];
            } else {
              return this.adapter.distinct(className, schema, query, distinct);
            }
          } else if (pipeline) {
            if (!classExists) {
              return [];
            } else {
              return this.adapter.aggregate(className, schema, pipeline, readPreference, hint, explain, comment, rawValues, rawFieldNames);
            }
          } else if (explain) {
            return this.adapter.find(className, schema, query, queryOptions);
          } else {
            return this.adapter.find(className, schema, query, queryOptions).then(objects => objects.map(object => {
              object = untransformObjectACL(object);
              return filterSensitiveData(isMaster, isMaintenance, aclGroup, auth, op, schemaController, className, protectedFields, object, this.options.protectedFieldsOwnerExempt);
            })).catch(error => {
              if (error instanceof _node.Parse.Error) {
                throw error;
              }
              const detailedMessage = typeof error === 'string' ? error : error?.message || 'An internal server error occurred';
              throw (0, _Error.createSanitizedError)(_node.Parse.Error.INTERNAL_SERVER_ERROR, detailedMessage, this.options, 'An internal server error occurred');
            });
          }
        });
      });
    });
  }
  deleteSchema(className) {
    let schemaController;
    return this.loadSchema({
      clearCache: true
    }).then(s => {
      schemaController = s;
      return schemaController.getOneSchema(className, true);
    }).catch(error => {
      if (error === undefined) {
        return {
          fields: {}
        };
      } else {
        throw error;
      }
    }).then(schema => {
      return this.collectionExists(className).then(() => this.adapter.count(className, {
        fields: {}
      }, null, '', false)).then(count => {
        if (count > 0) {
          throw new _node.Parse.Error(255, `Class ${className} is not empty, contains ${count} objects, cannot drop schema.`);
        }
        return this.adapter.deleteClass(className);
      }).then(wasParseCollection => {
        if (wasParseCollection) {
          const relationFieldNames = Object.keys(schema.fields).filter(fieldName => schema.fields[fieldName].type === 'Relation');
          return Promise.all(relationFieldNames.map(name => this.adapter.deleteClass(joinTableName(className, name)))).then(() => {
            _SchemaCache.default.del(className);
            return schemaController.reloadData();
          });
        } else {
          return Promise.resolve();
        }
      });
    });
  }

  // This helps to create intermediate objects for simpler comparison of
  // key value pairs used in query objects. Each key value pair will represented
  // in a similar way to json
  objectToEntriesStrings(query) {
    return Object.entries(query).map(a => a.map(s => JSON.stringify(s)).join(':'));
  }

  // Naive logic reducer for OR operations meant to be used only for pointer permissions.
  reduceOrOperation(query) {
    if (!query.$or) {
      return query;
    }
    const queries = query.$or.map(q => this.objectToEntriesStrings(q));
    let repeat = false;
    do {
      repeat = false;
      for (let i = 0; i < queries.length - 1; i++) {
        for (let j = i + 1; j < queries.length; j++) {
          const [shorter, longer] = queries[i].length > queries[j].length ? [j, i] : [i, j];
          const foundEntries = queries[shorter].reduce((acc, entry) => acc + (queries[longer].includes(entry) ? 1 : 0), 0);
          const shorterEntries = queries[shorter].length;
          if (foundEntries === shorterEntries) {
            // If the shorter query is completely contained in the longer one, we can strike
            // out the longer query.
            query.$or.splice(longer, 1);
            queries.splice(longer, 1);
            repeat = true;
            break;
          }
        }
      }
    } while (repeat);
    if (query.$or.length === 1) {
      query = {
        ...query,
        ...query.$or[0]
      };
      delete query.$or;
    }
    return query;
  }

  // Naive logic reducer for AND operations meant to be used only for pointer permissions.
  reduceAndOperation(query) {
    if (!query.$and) {
      return query;
    }
    const queries = query.$and.map(q => this.objectToEntriesStrings(q));
    let repeat = false;
    do {
      repeat = false;
      for (let i = 0; i < queries.length - 1; i++) {
        for (let j = i + 1; j < queries.length; j++) {
          const [shorter, longer] = queries[i].length > queries[j].length ? [j, i] : [i, j];
          const foundEntries = queries[shorter].reduce((acc, entry) => acc + (queries[longer].includes(entry) ? 1 : 0), 0);
          const shorterEntries = queries[shorter].length;
          if (foundEntries === shorterEntries) {
            // If the shorter query is completely contained in the longer one, we can strike
            // out the shorter query.
            query.$and.splice(shorter, 1);
            queries.splice(shorter, 1);
            repeat = true;
            break;
          }
        }
      }
    } while (repeat);
    if (query.$and.length === 1) {
      query = {
        ...query,
        ...query.$and[0]
      };
      delete query.$and;
    }
    return query;
  }

  // Constraints query using CLP's pointer permissions (PP) if any.
  // 1. Etract the user id from caller's ACLgroup;
  // 2. Exctract a list of field names that are PP for target collection and operation;
  // 3. Constraint the original query so that each PP field must
  // point to caller's id (or contain it in case of PP field being an array)
  addPointerPermissions(schema, className, operation, query, aclGroup = []) {
    // Check if class has public permission for operation
    // If the BaseCLP pass, let go through
    if (schema.testPermissionsForClassName(className, aclGroup, operation)) {
      return query;
    }
    const perms = schema.getClassLevelPermissions(className);
    const userACL = aclGroup.filter(acl => {
      return acl.indexOf('role:') != 0 && acl != '*';
    });
    const groupKey = ['get', 'find', 'count'].indexOf(operation) > -1 ? 'readUserFields' : 'writeUserFields';
    const permFields = [];
    if (perms[operation] && perms[operation].pointerFields) {
      permFields.push(...perms[operation].pointerFields);
    }
    if (perms[groupKey]) {
      for (const field of perms[groupKey]) {
        if (!permFields.includes(field)) {
          permFields.push(field);
        }
      }
    }
    // the ACL should have exactly 1 user
    if (permFields.length > 0) {
      // the ACL should have exactly 1 user
      // No user set return undefined
      // If the length is > 1, that means we didn't de-dupe users correctly
      if (userACL.length != 1) {
        return;
      }
      const userId = userACL[0];
      const userPointer = {
        __type: 'Pointer',
        className: '_User',
        objectId: userId
      };
      const queries = permFields.map(key => {
        const fieldDescriptor = schema.getExpectedType(className, key);
        const fieldType = fieldDescriptor && typeof fieldDescriptor === 'object' && Object.prototype.hasOwnProperty.call(fieldDescriptor, 'type') ? fieldDescriptor.type : null;
        let queryClause;
        if (fieldType === 'Pointer') {
          // constraint for single pointer setup
          queryClause = {
            [key]: userPointer
          };
        } else if (fieldType === 'Array') {
          // constraint for users-array setup
          queryClause = {
            [key]: {
              $all: [userPointer]
            }
          };
        } else if (fieldType === 'Object') {
          // constraint for object setup
          queryClause = {
            [key]: userPointer
          };
        } else {
          // This means that there is a CLP field of an unexpected type. This condition should not happen, which is
          // why is being treated as an error.
          throw Error(`An unexpected condition occurred when resolving pointer permissions: ${className} ${key}`);
        }
        // if we already have a constraint on the key, use the $and
        if (Object.prototype.hasOwnProperty.call(query, key)) {
          return this.reduceAndOperation({
            $and: [queryClause, query]
          });
        }
        // otherwise just add the constaint
        return Object.assign({}, query, queryClause);
      });
      return queries.length === 1 ? queries[0] : this.reduceOrOperation({
        $or: queries
      });
    } else {
      return query;
    }
  }
  addProtectedFields(schema, className, query = {}, aclGroup = [], auth = {}, queryOptions = {}) {
    const perms = schema && schema.getClassLevelPermissions ? schema.getClassLevelPermissions(className) : schema;
    if (!perms) {
      return null;
    }
    const protectedFields = perms.protectedFields;
    if (!protectedFields) {
      return null;
    }
    if (className === '_User' && this.options.protectedFieldsOwnerExempt !== false && aclGroup.indexOf(query.objectId) > -1) {
      return null;
    }

    // for queries where "keys" are set and do not include all 'userField':{field},
    // we have to transparently include it, and then remove before returning to client
    // Because if such key not projected the permission won't be enforced properly
    // PS this is called when 'excludeKeys' already reduced to 'keys'
    const preserveKeys = queryOptions.keys;

    // these are keys that need to be included only
    // to be able to apply protectedFields by pointer
    // and then unset before returning to client (later in  filterSensitiveFields)
    const serverOnlyKeys = [];
    const authenticated = auth.user;

    // map to allow check without array search
    const roles = (auth.userRoles || []).reduce((acc, r) => {
      acc[r] = protectedFields[r];
      return acc;
    }, {});

    // array of sets of protected fields. separate item for each applicable criteria
    const protectedKeysSets = [];
    for (const key in protectedFields) {
      // skip userFields
      if (key.startsWith('userField:')) {
        if (preserveKeys) {
          const fieldName = key.substring(10);
          if (!preserveKeys.includes(fieldName)) {
            // 1. put it there temporarily
            queryOptions.keys && queryOptions.keys.push(fieldName);
            // 2. preserve it delete later
            serverOnlyKeys.push(fieldName);
          }
        }
        continue;
      }

      // add public tier
      if (key === '*') {
        protectedKeysSets.push(protectedFields[key]);
        continue;
      }
      if (authenticated) {
        if (key === 'authenticated') {
          // for logged in users
          protectedKeysSets.push(protectedFields[key]);
          continue;
        }
        if (roles[key] && key.startsWith('role:')) {
          // add applicable roles
          protectedKeysSets.push(roles[key]);
        }
      }
    }

    // check if there's a rule for current user's id
    if (authenticated) {
      const userId = auth.user.id;
      if (perms.protectedFields[userId]) {
        protectedKeysSets.push(perms.protectedFields[userId]);
      }
    }

    // preserve fields to be removed before sending response to client
    if (serverOnlyKeys.length > 0) {
      perms.protectedFields.temporaryKeys = serverOnlyKeys;
    }
    let protectedKeys = protectedKeysSets.reduce((acc, next) => {
      if (next) {
        acc.push(...next);
      }
      return acc;
    }, []);

    // intersect all sets of protectedFields
    protectedKeysSets.forEach(fields => {
      if (fields) {
        protectedKeys = protectedKeys.filter(v => fields.includes(v));
      }
    });
    return protectedKeys;
  }
  createTransactionalSession() {
    return this.adapter.createTransactionalSession().then(transactionalSession => {
      this._transactionalSession = transactionalSession;
    });
  }
  commitTransactionalSession() {
    if (!this._transactionalSession) {
      throw new Error('There is no transactional session to commit');
    }
    return this.adapter.commitTransactionalSession(this._transactionalSession).then(() => {
      this._transactionalSession = null;
    });
  }
  abortTransactionalSession() {
    if (!this._transactionalSession) {
      throw new Error('There is no transactional session to abort');
    }
    return this.adapter.abortTransactionalSession(this._transactionalSession).then(() => {
      this._transactionalSession = null;
    });
  }

  // TODO: create indexes on first creation of a _User object. Otherwise it's impossible to
  // have a Parse app without it having a _User collection.
  async performInitialization() {
    await this.adapter.performInitialization({
      VolatileClassesSchemas: SchemaController.VolatileClassesSchemas
    });
    const requiredUserFields = {
      fields: {
        ...SchemaController.defaultColumns._Default,
        ...SchemaController.defaultColumns._User
      }
    };
    const requiredRoleFields = {
      fields: {
        ...SchemaController.defaultColumns._Default,
        ...SchemaController.defaultColumns._Role
      }
    };
    const requiredIdempotencyFields = {
      fields: {
        ...SchemaController.defaultColumns._Default,
        ...SchemaController.defaultColumns._Idempotency
      }
    };
    await this.loadSchema().then(schema => schema.enforceClassExists('_User'));
    await this.loadSchema().then(schema => schema.enforceClassExists('_Role'));
    await this.loadSchema().then(schema => schema.enforceClassExists('_Idempotency'));
    const databaseOptions = this.options.databaseOptions || {};
    if (databaseOptions.createIndexUserUsername !== false) {
      await this.adapter.ensureUniqueness('_User', requiredUserFields, ['username']).catch(error => {
        _logger.default.warn('Unable to ensure uniqueness for usernames: ', error);
        throw error;
      });
    }
    if (!this.options.enableCollationCaseComparison) {
      if (databaseOptions.createIndexUserUsernameCaseInsensitive !== false) {
        await this.adapter.ensureIndex('_User', requiredUserFields, ['username'], 'case_insensitive_username', true).catch(error => {
          _logger.default.warn('Unable to create case insensitive username index: ', error);
          throw error;
        });
      }
      if (databaseOptions.createIndexUserEmailCaseInsensitive !== false) {
        await this.adapter.ensureIndex('_User', requiredUserFields, ['email'], 'case_insensitive_email', true).catch(error => {
          _logger.default.warn('Unable to create case insensitive email index: ', error);
          throw error;
        });
      }
    }
    if (databaseOptions.createIndexUserEmail !== false) {
      await this.adapter.ensureUniqueness('_User', requiredUserFields, ['email']).catch(error => {
        _logger.default.warn('Unable to ensure uniqueness for user email addresses: ', error);
        throw error;
      });
    }
    if (databaseOptions.createIndexUserEmailVerifyToken !== false) {
      await this.adapter.ensureIndex('_User', requiredUserFields, ['_email_verify_token'], '_email_verify_token', false).catch(error => {
        _logger.default.warn('Unable to create index for email verification token: ', error);
        throw error;
      });
    }
    if (databaseOptions.createIndexUserPasswordResetToken !== false) {
      await this.adapter.ensureIndex('_User', requiredUserFields, ['_perishable_token'], '_perishable_token', false).catch(error => {
        _logger.default.warn('Unable to create index for password reset token: ', error);
        throw error;
      });
    }
    if (databaseOptions.createIndexRoleName !== false) {
      await this.adapter.ensureUniqueness('_Role', requiredRoleFields, ['name']).catch(error => {
        _logger.default.warn('Unable to ensure uniqueness for role name: ', error);
        throw error;
      });
    }
    await this.adapter.ensureUniqueness('_Idempotency', requiredIdempotencyFields, ['reqId']).catch(error => {
      _logger.default.warn('Unable to ensure uniqueness for idempotency request ID: ', error);
      throw error;
    });
    const isMongoAdapter = this.adapter instanceof _MongoStorageAdapter.default;
    const isPostgresAdapter = this.adapter instanceof _PostgresStorageAdapter.default;
    if (isMongoAdapter || isPostgresAdapter) {
      let options = {};
      if (isMongoAdapter) {
        options = {
          ttl: 0
        };
      } else if (isPostgresAdapter) {
        options = this.idempotencyOptions;
        options.setIdempotencyFunction = true;
      }
      await this.adapter.ensureIndex('_Idempotency', requiredIdempotencyFields, ['expire'], 'ttl', false, options).catch(error => {
        _logger.default.warn('Unable to create TTL index for idempotency expire date: ', error);
        throw error;
      });
    }
    // Create unique indexes for authData providers to prevent race conditions
    // during concurrent signups with the same authData
    if (databaseOptions.createIndexAuthDataUniqueness !== false && typeof this.adapter.ensureAuthDataUniqueness === 'function') {
      const authProviders = Object.keys(this.options.auth || {});
      if (this.options.enableAnonymousUsers !== false) {
        if (!authProviders.includes('anonymous')) {
          authProviders.push('anonymous');
        }
      }
      await Promise.all(authProviders.map(provider => this.adapter.ensureAuthDataUniqueness(provider).catch(error => {
        _logger.default.warn(`Unable to ensure uniqueness for auth data provider "${provider}": `, error);
      })));
    }
    await this.adapter.updateSchemaWithIndexes();
  }
  _expandResultOnKeyPath(object, key, value) {
    if (key.indexOf('.') < 0) {
      object[key] = value[key];
      return object;
    }
    const path = key.split('.');
    const firstKey = path[0];
    const nextPath = path.slice(1).join('.');

    // Scan request data for denied keywords
    if (this.options && this.options.requestKeywordDenylist) {
      // Scan request data for denied keywords
      for (const keyword of this.options.requestKeywordDenylist) {
        const match = _Utils.default.objectContainsKeyValue({
          [firstKey]: true,
          [nextPath]: true
        }, keyword.key, true);
        if (match) {
          throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Prohibited keyword in request data: ${JSON.stringify(keyword)}.`);
        }
      }
    }
    object[firstKey] = this._expandResultOnKeyPath(object[firstKey] || {}, nextPath, value[firstKey]);
    delete object[key];
    return object;
  }
  _sanitizeDatabaseResult(originalObject, result) {
    const response = {};
    if (!result) {
      return Promise.resolve(response);
    }
    Object.keys(originalObject).forEach(key => {
      const keyUpdate = originalObject[key];
      // determine if that was an op
      if (keyUpdate && typeof keyUpdate === 'object' && keyUpdate.__op && ['Add', 'AddUnique', 'Remove', 'Increment', 'SetOnInsert'].indexOf(keyUpdate.__op) > -1) {
        // only valid ops that produce an actionable result
        // the op may have happened on a keypath
        this._expandResultOnKeyPath(response, key, result);
        // Revert array to object conversion on dot notation for arrays (e.g. "field.0.key")
        if (key.includes('.')) {
          const [field, index] = key.split('.');
          const isArrayIndex = Array.from(index).every(c => c >= '0' && c <= '9');
          if (isArrayIndex && Array.isArray(result[field]) && !Array.isArray(response[field])) {
            response[field] = result[field];
          }
        }
      }
    });
    return Promise.resolve(response);
  }
}
module.exports = DatabaseController;
// Expose validateQuery for tests
module.exports._validateQuery = validateQuery;
module.exports.filterSensitiveData = filterSensitiveData;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbm9kZSIsInJlcXVpcmUiLCJfbG9kYXNoIiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsIl9pbnRlcnNlY3QiLCJfbG9nZ2VyIiwiX1V0aWxzIiwiU2NoZW1hQ29udHJvbGxlciIsIl9pbnRlcm9wUmVxdWlyZVdpbGRjYXJkIiwiX1N0b3JhZ2VBZGFwdGVyIiwiX01vbmdvU3RvcmFnZUFkYXB0ZXIiLCJfUG9zdGdyZXNTdG9yYWdlQWRhcHRlciIsIl9TY2hlbWFDYWNoZSIsIl9FcnJvciIsImUiLCJ0IiwiV2Vha01hcCIsInIiLCJuIiwiX19lc01vZHVsZSIsIm8iLCJpIiwiZiIsIl9fcHJvdG9fXyIsImRlZmF1bHQiLCJoYXMiLCJnZXQiLCJzZXQiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsInF1ZXJ5T3BlcmF0b3JzIiwiaW50ZXJuYWxGaWVsZHMiLCJfcnBlcm0iLCJjbGllbnRSZWFkIiwibWFzdGVyUmVhZCIsIm1hc3RlcldyaXRlIiwiX3dwZXJtIiwiX2hhc2hlZF9wYXNzd29yZCIsIl9lbWFpbF92ZXJpZnlfdG9rZW4iLCJfcGVyaXNoYWJsZV90b2tlbiIsIl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQiLCJfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQiLCJfZmFpbGVkX2xvZ2luX2NvdW50IiwiX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0IiwiX3Bhc3N3b3JkX2NoYW5nZWRfYXQiLCJfcGFzc3dvcmRfaGlzdG9yeSIsIl90b21ic3RvbmUiLCJfc2Vzc2lvbl90b2tlbiIsInNwZWNpYWxRdWVyeUtleXMiLCJrZXlzIiwiZmlsdGVyIiwiayIsInNwZWNpYWxNYXN0ZXJRdWVyeUtleXMiLCJhZGRXcml0ZUFDTCIsInF1ZXJ5IiwiYWNsIiwibmV3UXVlcnkiLCJfIiwiY2xvbmVEZWVwIiwiJGluIiwiYWRkUmVhZEFDTCIsInRyYW5zZm9ybU9iamVjdEFDTCIsIkFDTCIsInJlc3VsdCIsImVudHJ5IiwicmVhZCIsInB1c2giLCJ3cml0ZSIsInZhbGlkYXRlUXVlcnkiLCJpc01hc3RlciIsImlzTWFpbnRlbmFuY2UiLCJ1cGRhdGUiLCJvcHRpb25zIiwiX2RlcHRoIiwicmMiLCJyZXF1ZXN0Q29tcGxleGl0eSIsInF1ZXJ5RGVwdGgiLCJQYXJzZSIsIkVycm9yIiwiSU5WQUxJRF9RVUVSWSIsIiRvciIsIkFycmF5IiwiaXNBcnJheSIsImZvckVhY2giLCJ2YWx1ZSIsIiRhbmQiLCIkbm9yIiwibGVuZ3RoIiwia2V5IiwiJHJlZ2V4IiwidW5kZWZpbmVkIiwiYWxsb3dSZWdleCIsIiRvcHRpb25zIiwibWF0Y2giLCJpbmNsdWRlcyIsIklOVkFMSURfS0VZX05BTUUiLCJmaWx0ZXJTZW5zaXRpdmVEYXRhIiwiYWNsR3JvdXAiLCJhdXRoIiwib3BlcmF0aW9uIiwic2NoZW1hIiwiY2xhc3NOYW1lIiwicHJvdGVjdGVkRmllbGRzIiwib2JqZWN0IiwicHJvdGVjdGVkRmllbGRzT3duZXJFeGVtcHQiLCJ1c2VySWQiLCJ1c2VyIiwiaWQiLCJwZXJtcyIsImdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsImlzUmVhZE9wZXJhdGlvbiIsImluZGV4T2YiLCJwcm90ZWN0ZWRGaWVsZHNQb2ludGVyUGVybSIsInN0YXJ0c1dpdGgiLCJtYXAiLCJzdWJzdHJpbmciLCJuZXdQcm90ZWN0ZWRGaWVsZHMiLCJvdmVycmlkZVByb3RlY3RlZEZpZWxkcyIsInBvaW50ZXJQZXJtIiwicG9pbnRlclBlcm1JbmNsdWRlc1VzZXIiLCJyZWFkVXNlckZpZWxkVmFsdWUiLCJzb21lIiwib2JqZWN0SWQiLCJmaWVsZHMiLCJ2IiwiaXNVc2VyQ2xhc3MiLCJwYXNzd29yZCIsInNlc3Npb25Ub2tlbiIsImlzT3duZXJFeGVtcHQiLCJ0ZW1wb3JhcnlLZXlzIiwiY2hhckF0IiwiYXV0aERhdGEiLCJzcGVjaWFsS2V5c0ZvclVwZGF0ZSIsImlzU3BlY2lhbFVwZGF0ZUtleSIsImpvaW5UYWJsZU5hbWUiLCJmbGF0dGVuVXBkYXRlT3BlcmF0b3JzRm9yQ3JlYXRlIiwiX19vcCIsImFtb3VudCIsIklOVkFMSURfSlNPTiIsIm9iamVjdHMiLCJDT01NQU5EX1VOQVZBSUxBQkxFIiwidHJhbnNmb3JtQXV0aERhdGEiLCJwcm92aWRlciIsInByb3ZpZGVyRGF0YSIsImZpZWxkTmFtZSIsInR5cGUiLCJ1bnRyYW5zZm9ybU9iamVjdEFDTCIsIm91dHB1dCIsImdldFJvb3RGaWVsZE5hbWUiLCJzcGxpdCIsInJlbGF0aW9uU2NoZW1hIiwicmVsYXRlZElkIiwib3duaW5nSWQiLCJjb252ZXJ0RW1haWxUb0xvd2VyY2FzZSIsInRvTG93ZXJDYXNlIiwiY29udmVydFVzZXJuYW1lVG9Mb3dlcmNhc2UiLCJEYXRhYmFzZUNvbnRyb2xsZXIiLCJjb25zdHJ1Y3RvciIsImFkYXB0ZXIiLCJpZGVtcG90ZW5jeU9wdGlvbnMiLCJzY2hlbWFQcm9taXNlIiwiX3RyYW5zYWN0aW9uYWxTZXNzaW9uIiwiY29sbGVjdGlvbkV4aXN0cyIsImNsYXNzRXhpc3RzIiwicHVyZ2VDb2xsZWN0aW9uIiwibG9hZFNjaGVtYSIsInRoZW4iLCJzY2hlbWFDb250cm9sbGVyIiwiZ2V0T25lU2NoZW1hIiwiZGVsZXRlT2JqZWN0c0J5UXVlcnkiLCJ2YWxpZGF0ZUNsYXNzTmFtZSIsImNsYXNzTmFtZUlzVmFsaWQiLCJQcm9taXNlIiwicmVqZWN0IiwiSU5WQUxJRF9DTEFTU19OQU1FIiwicmVzb2x2ZSIsImNsZWFyQ2FjaGUiLCJsb2FkIiwibG9hZFNjaGVtYUlmTmVlZGVkIiwicmVkaXJlY3RDbGFzc05hbWVGb3JLZXkiLCJnZXRFeHBlY3RlZFR5cGUiLCJ0YXJnZXRDbGFzcyIsInZhbGlkYXRlT2JqZWN0IiwicnVuT3B0aW9ucyIsIm1haW50ZW5hbmNlIiwicyIsImNhbkFkZEZpZWxkIiwibWFueSIsInVwc2VydCIsImFkZHNGaWVsZCIsInNraXBTYW5pdGl6YXRpb24iLCJ2YWxpZGF0ZU9ubHkiLCJ2YWxpZFNjaGVtYUNvbnRyb2xsZXIiLCJVdGlscyIsImNoZWNrUHJvaGliaXRlZEtleXdvcmRzIiwiZXJyb3IiLCJ2YWxpZGF0ZUZpbGVVcmxzSW5PYmplY3QiLCJGSUxFX1NBVkVfRVJST1IiLCJtZXNzYWdlIiwib3JpZ2luYWxRdWVyeSIsIm9yaWdpbmFsVXBkYXRlIiwic3RydWN0dXJlZENsb25lIiwicmVsYXRpb25VcGRhdGVzIiwidmFsaWRhdGVQZXJtaXNzaW9uIiwiY29sbGVjdFJlbGF0aW9uVXBkYXRlcyIsImFkZFBvaW50ZXJQZXJtaXNzaW9ucyIsImNhdGNoIiwicm9vdEZpZWxkTmFtZSIsImZpZWxkTmFtZUlzVmFsaWQiLCJ1cGRhdGVPcGVyYXRpb24iLCJpbm5lcktleSIsIklOVkFMSURfTkVTVEVEX0tFWSIsImZpbmQiLCJyZWFkUHJlZmVyZW5jZSIsIk9CSkVDVF9OT1RfRk9VTkQiLCJ1cGRhdGVPYmplY3RzQnlRdWVyeSIsInVwc2VydE9uZU9iamVjdCIsImZpbmRPbmVBbmRVcGRhdGUiLCJoYW5kbGVSZWxhdGlvblVwZGF0ZXMiLCJtYXRjaGVkQ291bnQiLCJtb2RpZmllZENvdW50IiwiX3Nhbml0aXplRGF0YWJhc2VSZXN1bHQiLCJvcHMiLCJkZWxldGVNZSIsInByb2Nlc3MiLCJvcCIsIngiLCJwZW5kaW5nIiwiYWRkUmVsYXRpb24iLCJyZW1vdmVSZWxhdGlvbiIsImFsbCIsImZyb21DbGFzc05hbWUiLCJmcm9tSWQiLCJ0b0lkIiwiZG9jIiwiY29kZSIsImRlc3Ryb3kiLCJwYXJzZUZvcm1hdFNjaGVtYSIsImNyZWF0ZSIsIm9yaWdpbmFsT2JqZWN0IiwiY3JlYXRlZEF0IiwiaXNvIiwiX190eXBlIiwidXBkYXRlZEF0IiwiZW5mb3JjZUNsYXNzRXhpc3RzIiwiY3JlYXRlT2JqZWN0IiwiY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYSIsImNsYXNzU2NoZW1hIiwic2NoZW1hRGF0YSIsInNjaGVtYUZpZWxkcyIsIm5ld0tleXMiLCJmaWVsZCIsImFjdGlvbiIsImRlbGV0ZUV2ZXJ5dGhpbmciLCJmYXN0IiwiU2NoZW1hQ2FjaGUiLCJjbGVhciIsImRlbGV0ZUFsbENsYXNzZXMiLCJyZWxhdGVkSWRzIiwicXVlcnlPcHRpb25zIiwic2tpcCIsImxpbWl0Iiwic29ydCIsImZpbmRPcHRpb25zIiwiY2FuU29ydE9uSm9pblRhYmxlcyIsIl9pZCIsInJlc3VsdHMiLCJvd25pbmdJZHMiLCJyZWR1Y2VJblJlbGF0aW9uIiwicHJvbWlzZXMiLCJvcnMiLCJhUXVlcnkiLCJpbmRleCIsImFuZHMiLCJvdGhlcktleXMiLCJxdWVyaWVzIiwiY29uc3RyYWludEtleSIsImlzTmVnYXRpb24iLCJxIiwiaWRzIiwiYWRkTm90SW5PYmplY3RJZHNJZHMiLCJhZGRJbk9iamVjdElkc0lkcyIsInJlZHVjZVJlbGF0aW9uS2V5cyIsInJlbGF0ZWRUbyIsImlkc0Zyb21TdHJpbmciLCJpZHNGcm9tRXEiLCJpZHNGcm9tSW4iLCJhbGxJZHMiLCJsaXN0IiwidG90YWxMZW5ndGgiLCJyZWR1Y2UiLCJtZW1vIiwiaWRzSW50ZXJzZWN0aW9uIiwiaW50ZXJzZWN0IiwiYmlnIiwiJGVxIiwiaWRzRnJvbU5pbiIsIlNldCIsIiRuaW4iLCJjb3VudCIsImRpc3RpbmN0IiwicGlwZWxpbmUiLCJoaW50IiwiY2FzZUluc2Vuc2l0aXZlIiwiZXhwbGFpbiIsImNvbW1lbnQiLCJyYXdWYWx1ZXMiLCJyYXdGaWVsZE5hbWVzIiwiX2NyZWF0ZWRfYXQiLCJfdXBkYXRlZF9hdCIsImVuYWJsZUNvbGxhdGlvbkNhc2VDb21wYXJpc29uIiwiYWRkUHJvdGVjdGVkRmllbGRzIiwiYWdncmVnYXRlIiwiZGV0YWlsZWRNZXNzYWdlIiwiY3JlYXRlU2FuaXRpemVkRXJyb3IiLCJJTlRFUk5BTF9TRVJWRVJfRVJST1IiLCJkZWxldGVTY2hlbWEiLCJkZWxldGVDbGFzcyIsIndhc1BhcnNlQ29sbGVjdGlvbiIsInJlbGF0aW9uRmllbGROYW1lcyIsIm5hbWUiLCJkZWwiLCJyZWxvYWREYXRhIiwib2JqZWN0VG9FbnRyaWVzU3RyaW5ncyIsImVudHJpZXMiLCJhIiwiSlNPTiIsInN0cmluZ2lmeSIsImpvaW4iLCJyZWR1Y2VPck9wZXJhdGlvbiIsInJlcGVhdCIsImoiLCJzaG9ydGVyIiwibG9uZ2VyIiwiZm91bmRFbnRyaWVzIiwiYWNjIiwic2hvcnRlckVudHJpZXMiLCJzcGxpY2UiLCJyZWR1Y2VBbmRPcGVyYXRpb24iLCJ0ZXN0UGVybWlzc2lvbnNGb3JDbGFzc05hbWUiLCJ1c2VyQUNMIiwiZ3JvdXBLZXkiLCJwZXJtRmllbGRzIiwicG9pbnRlckZpZWxkcyIsInVzZXJQb2ludGVyIiwiZmllbGREZXNjcmlwdG9yIiwiZmllbGRUeXBlIiwicHJvdG90eXBlIiwicXVlcnlDbGF1c2UiLCIkYWxsIiwiYXNzaWduIiwicHJlc2VydmVLZXlzIiwic2VydmVyT25seUtleXMiLCJhdXRoZW50aWNhdGVkIiwicm9sZXMiLCJ1c2VyUm9sZXMiLCJwcm90ZWN0ZWRLZXlzU2V0cyIsInByb3RlY3RlZEtleXMiLCJuZXh0IiwiY3JlYXRlVHJhbnNhY3Rpb25hbFNlc3Npb24iLCJ0cmFuc2FjdGlvbmFsU2Vzc2lvbiIsImNvbW1pdFRyYW5zYWN0aW9uYWxTZXNzaW9uIiwiYWJvcnRUcmFuc2FjdGlvbmFsU2Vzc2lvbiIsInBlcmZvcm1Jbml0aWFsaXphdGlvbiIsIlZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMiLCJyZXF1aXJlZFVzZXJGaWVsZHMiLCJkZWZhdWx0Q29sdW1ucyIsIl9EZWZhdWx0IiwiX1VzZXIiLCJyZXF1aXJlZFJvbGVGaWVsZHMiLCJfUm9sZSIsInJlcXVpcmVkSWRlbXBvdGVuY3lGaWVsZHMiLCJfSWRlbXBvdGVuY3kiLCJkYXRhYmFzZU9wdGlvbnMiLCJjcmVhdGVJbmRleFVzZXJVc2VybmFtZSIsImVuc3VyZVVuaXF1ZW5lc3MiLCJsb2dnZXIiLCJ3YXJuIiwiY3JlYXRlSW5kZXhVc2VyVXNlcm5hbWVDYXNlSW5zZW5zaXRpdmUiLCJlbnN1cmVJbmRleCIsImNyZWF0ZUluZGV4VXNlckVtYWlsQ2FzZUluc2Vuc2l0aXZlIiwiY3JlYXRlSW5kZXhVc2VyRW1haWwiLCJjcmVhdGVJbmRleFVzZXJFbWFpbFZlcmlmeVRva2VuIiwiY3JlYXRlSW5kZXhVc2VyUGFzc3dvcmRSZXNldFRva2VuIiwiY3JlYXRlSW5kZXhSb2xlTmFtZSIsImlzTW9uZ29BZGFwdGVyIiwiTW9uZ29TdG9yYWdlQWRhcHRlciIsImlzUG9zdGdyZXNBZGFwdGVyIiwiUG9zdGdyZXNTdG9yYWdlQWRhcHRlciIsInR0bCIsInNldElkZW1wb3RlbmN5RnVuY3Rpb24iLCJjcmVhdGVJbmRleEF1dGhEYXRhVW5pcXVlbmVzcyIsImVuc3VyZUF1dGhEYXRhVW5pcXVlbmVzcyIsImF1dGhQcm92aWRlcnMiLCJlbmFibGVBbm9ueW1vdXNVc2VycyIsInVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzIiwiX2V4cGFuZFJlc3VsdE9uS2V5UGF0aCIsInBhdGgiLCJmaXJzdEtleSIsIm5leHRQYXRoIiwic2xpY2UiLCJyZXF1ZXN0S2V5d29yZERlbnlsaXN0Iiwia2V5d29yZCIsIm9iamVjdENvbnRhaW5zS2V5VmFsdWUiLCJyZXNwb25zZSIsImtleVVwZGF0ZSIsImlzQXJyYXlJbmRleCIsImZyb20iLCJldmVyeSIsImMiLCJtb2R1bGUiLCJleHBvcnRzIiwiX3ZhbGlkYXRlUXVlcnkiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvQ29udHJvbGxlcnMvRGF0YWJhc2VDb250cm9sbGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIu+7vy8vIEBmbG93XG4vLyBBIGRhdGFiYXNlIGFkYXB0ZXIgdGhhdCB3b3JrcyB3aXRoIGRhdGEgZXhwb3J0ZWQgZnJvbSB0aGUgaG9zdGVkXG4vLyBQYXJzZSBkYXRhYmFzZS5cblxuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgeyBQYXJzZSB9IGZyb20gJ3BhcnNlL25vZGUnO1xuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgaW50ZXJzZWN0IGZyb20gJ2ludGVyc2VjdCc7XG5pbXBvcnQgbG9nZ2VyIGZyb20gJy4uL2xvZ2dlcic7XG5pbXBvcnQgVXRpbHMgZnJvbSAnLi4vVXRpbHMnO1xuaW1wb3J0ICogYXMgU2NoZW1hQ29udHJvbGxlciBmcm9tICcuL1NjaGVtYUNvbnRyb2xsZXInO1xuaW1wb3J0IHsgU3RvcmFnZUFkYXB0ZXIgfSBmcm9tICcuLi9BZGFwdGVycy9TdG9yYWdlL1N0b3JhZ2VBZGFwdGVyJztcbmltcG9ydCBNb25nb1N0b3JhZ2VBZGFwdGVyIGZyb20gJy4uL0FkYXB0ZXJzL1N0b3JhZ2UvTW9uZ28vTW9uZ29TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgUG9zdGdyZXNTdG9yYWdlQWRhcHRlciBmcm9tICcuLi9BZGFwdGVycy9TdG9yYWdlL1Bvc3RncmVzL1Bvc3RncmVzU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IFNjaGVtYUNhY2hlIGZyb20gJy4uL0FkYXB0ZXJzL0NhY2hlL1NjaGVtYUNhY2hlJztcbmltcG9ydCB0eXBlIHsgTG9hZFNjaGVtYU9wdGlvbnMgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgUGFyc2VTZXJ2ZXJPcHRpb25zIH0gZnJvbSAnLi4vT3B0aW9ucyc7XG5pbXBvcnQgdHlwZSB7IFF1ZXJ5T3B0aW9ucywgRnVsbFF1ZXJ5T3B0aW9ucyB9IGZyb20gJy4uL0FkYXB0ZXJzL1N0b3JhZ2UvU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IHsgY3JlYXRlU2FuaXRpemVkRXJyb3IgfSBmcm9tICcuLi9FcnJvcic7XG5cbi8vIFF1ZXJ5IG9wZXJhdG9ycyB0aGF0IGFsd2F5cyBwYXNzIHZhbGlkYXRpb24gcmVnYXJkbGVzcyBvZiBhdXRoIGxldmVsLlxuY29uc3QgcXVlcnlPcGVyYXRvcnMgPSBbJyRhbmQnLCAnJG9yJywgJyRub3InXTtcblxuLy8gUmVnaXN0cnkgb2YgaW50ZXJuYWwgZmllbGRzIHdpdGggYWNjZXNzIHBlcm1pc3Npb25zLlxuLy8gSW50ZXJuYWwgZmllbGRzIGFyZSBuZXZlciBkaXJlY3RseSB3cml0YWJsZSBieSBjbGllbnRzLCBzbyBjbGllbnRXcml0ZSBpcyBvbWl0dGVkLlxuLy8gLSBjbGllbnRSZWFkOiBhbnkgY2xpZW50IGNhbiB1c2UgdGhpcyBmaWVsZCBpbiBxdWVyaWVzXG4vLyAtIG1hc3RlclJlYWQ6IG1hc3RlciBrZXkgY2FuIHVzZSB0aGlzIGZpZWxkIGluIHF1ZXJpZXNcbi8vIC0gbWFzdGVyV3JpdGU6IG1hc3RlciBrZXkgY2FuIHVzZSB0aGlzIGZpZWxkIGluIHVwZGF0ZXNcbmNvbnN0IGludGVybmFsRmllbGRzID0ge1xuICBfcnBlcm06ICAgICAgICAgICAgICAgICAgICAgICAgIHsgY2xpZW50UmVhZDogdHJ1ZSwgIG1hc3RlclJlYWQ6IHRydWUsICBtYXN0ZXJXcml0ZTogdHJ1ZSAgfSxcbiAgX3dwZXJtOiAgICAgICAgICAgICAgICAgICAgICAgICB7IGNsaWVudFJlYWQ6IHRydWUsICBtYXN0ZXJSZWFkOiB0cnVlLCAgbWFzdGVyV3JpdGU6IHRydWUgIH0sXG4gIF9oYXNoZWRfcGFzc3dvcmQ6ICAgICAgICAgICAgICAgeyBjbGllbnRSZWFkOiBmYWxzZSwgbWFzdGVyUmVhZDogZmFsc2UsIG1hc3RlcldyaXRlOiB0cnVlICB9LFxuICBfZW1haWxfdmVyaWZ5X3Rva2VuOiAgICAgICAgICAgIHsgY2xpZW50UmVhZDogZmFsc2UsIG1hc3RlclJlYWQ6IHRydWUsICBtYXN0ZXJXcml0ZTogdHJ1ZSAgfSxcbiAgX3BlcmlzaGFibGVfdG9rZW46ICAgICAgICAgICAgICB7IGNsaWVudFJlYWQ6IGZhbHNlLCBtYXN0ZXJSZWFkOiB0cnVlLCAgbWFzdGVyV3JpdGU6IHRydWUgIH0sXG4gIF9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQ6ICAgeyBjbGllbnRSZWFkOiBmYWxzZSwgbWFzdGVyUmVhZDogdHJ1ZSwgIG1hc3RlcldyaXRlOiB0cnVlICB9LFxuICBfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQ6IHsgY2xpZW50UmVhZDogZmFsc2UsIG1hc3RlclJlYWQ6IHRydWUsICBtYXN0ZXJXcml0ZTogdHJ1ZSAgfSxcbiAgX2ZhaWxlZF9sb2dpbl9jb3VudDogICAgICAgICAgICB7IGNsaWVudFJlYWQ6IGZhbHNlLCBtYXN0ZXJSZWFkOiB0cnVlLCAgbWFzdGVyV3JpdGU6IHRydWUgIH0sXG4gIF9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdDogICAgeyBjbGllbnRSZWFkOiBmYWxzZSwgbWFzdGVyUmVhZDogdHJ1ZSwgIG1hc3RlcldyaXRlOiB0cnVlICB9LFxuICBfcGFzc3dvcmRfY2hhbmdlZF9hdDogICAgICAgICAgIHsgY2xpZW50UmVhZDogZmFsc2UsIG1hc3RlclJlYWQ6IHRydWUsICBtYXN0ZXJXcml0ZTogdHJ1ZSAgfSxcbiAgX3Bhc3N3b3JkX2hpc3Rvcnk6ICAgICAgICAgICAgICB7IGNsaWVudFJlYWQ6IGZhbHNlLCBtYXN0ZXJSZWFkOiB0cnVlLCAgbWFzdGVyV3JpdGU6IHRydWUgIH0sXG4gIF90b21ic3RvbmU6ICAgICAgICAgICAgICAgICAgICAgeyBjbGllbnRSZWFkOiBmYWxzZSwgbWFzdGVyUmVhZDogdHJ1ZSwgIG1hc3RlcldyaXRlOiBmYWxzZSB9LFxuICBfc2Vzc2lvbl90b2tlbjogICAgICAgICAgICAgICAgIHsgY2xpZW50UmVhZDogZmFsc2UsIG1hc3RlclJlYWQ6IHRydWUsICBtYXN0ZXJXcml0ZTogZmFsc2UgfSxcbiAgLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG4gIC8vIFRoZSBmb2xsb3dpbmcgZmllbGRzIGFyZSBub3QgYWNjZXNzZWQgYnkgdGhlaXIgXy1wcmVmaXhlZCBuYW1lIHRocm91Z2ggdGhlIEFQSTtcbiAgLy8gdGhleSBhcmUgbWFwcGVkIHRvIFJFU1QtbGV2ZWwgbmFtZXMgaW4gdGhlIGFkYXB0ZXIgbGF5ZXIgb3IgaGFuZGxlZCB0aHJvdWdoXG4gIC8vIHNlcGFyYXRlIGNvZGUgcGF0aHMuXG4gIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuICAvLyBTeXN0ZW0gZmllbGRzIChtYXBwZWQgdG8gUkVTVC1sZXZlbCBuYW1lcyk6XG4gIC8vIF9pZCAob2JqZWN0SWQpXG4gIC8vIF9jcmVhdGVkX2F0IChjcmVhdGVkQXQpXG4gIC8vIF91cGRhdGVkX2F0ICh1cGRhdGVkQXQpXG4gIC8vIF9sYXN0X3VzZWQgKGxhc3RVc2VkKVxuICAvLyBfZXhwaXJlc0F0IChleHBpcmVzQXQpXG4gIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuICAvLyBMZWdhY3kgQUNMIGZvcm1hdDogbWFwcGVkIHRvL2Zyb20gX3JwZXJtL193cGVybVxuICAvLyBfYWNsXG4gIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuICAvLyBTY2hlbWEgbWV0YWRhdGE6IG5vdCBkYXRhIGZpZWxkcywgdXNlZCBvbmx5IGZvciBzY2hlbWEgY29uZmlndXJhdGlvblxuICAvLyBfbWV0YWRhdGFcbiAgLy8gX2NsaWVudF9wZXJtaXNzaW9uc1xuICAvLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cbiAgLy8gRHluYW1pYyBhdXRoIGRhdGEgZmllbGRzOiB1c2VkIG9ubHkgaW4gcHJvamVjdGlvbnMgYW5kIHVwZGF0ZXMsIG5vdCBpbiBxdWVyaWVzXG4gIC8vIF9hdXRoX2RhdGFfPHByb3ZpZGVyPlxufTtcblxuLy8gRGVyaXZlZCBhY2Nlc3MgbGlzdHNcbmNvbnN0IHNwZWNpYWxRdWVyeUtleXMgPSBbXG4gIC4uLnF1ZXJ5T3BlcmF0b3JzLFxuICAuLi5PYmplY3Qua2V5cyhpbnRlcm5hbEZpZWxkcykuZmlsdGVyKGsgPT4gaW50ZXJuYWxGaWVsZHNba10uY2xpZW50UmVhZCksXG5dO1xuY29uc3Qgc3BlY2lhbE1hc3RlclF1ZXJ5S2V5cyA9IFtcbiAgLi4ucXVlcnlPcGVyYXRvcnMsXG4gIC4uLk9iamVjdC5rZXlzKGludGVybmFsRmllbGRzKS5maWx0ZXIoayA9PiBpbnRlcm5hbEZpZWxkc1trXS5tYXN0ZXJSZWFkKSxcbl07XG5cbmZ1bmN0aW9uIGFkZFdyaXRlQUNMKHF1ZXJ5LCBhY2wpIHtcbiAgY29uc3QgbmV3UXVlcnkgPSBfLmNsb25lRGVlcChxdWVyeSk7XG4gIC8vQ2FuJ3QgYmUgYW55IGV4aXN0aW5nICdfd3Blcm0nIHF1ZXJ5LCB3ZSBkb24ndCBhbGxvdyBjbGllbnQgcXVlcmllcyBvbiB0aGF0LCBubyBuZWVkIHRvICRhbmRcbiAgbmV3UXVlcnkuX3dwZXJtID0geyAkaW46IFtudWxsLCAuLi5hY2xdIH07XG4gIHJldHVybiBuZXdRdWVyeTtcbn1cblxuZnVuY3Rpb24gYWRkUmVhZEFDTChxdWVyeSwgYWNsKSB7XG4gIGNvbnN0IG5ld1F1ZXJ5ID0gXy5jbG9uZURlZXAocXVlcnkpO1xuICAvL0Nhbid0IGJlIGFueSBleGlzdGluZyAnX3JwZXJtJyBxdWVyeSwgd2UgZG9uJ3QgYWxsb3cgY2xpZW50IHF1ZXJpZXMgb24gdGhhdCwgbm8gbmVlZCB0byAkYW5kXG4gIG5ld1F1ZXJ5Ll9ycGVybSA9IHsgJGluOiBbbnVsbCwgJyonLCAuLi5hY2xdIH07XG4gIHJldHVybiBuZXdRdWVyeTtcbn1cblxuLy8gVHJhbnNmb3JtcyBhIFJFU1QgQVBJIGZvcm1hdHRlZCBBQ0wgb2JqZWN0IHRvIG91ciB0d28tZmllbGQgbW9uZ28gZm9ybWF0LlxuY29uc3QgdHJhbnNmb3JtT2JqZWN0QUNMID0gKHsgQUNMLCAuLi5yZXN1bHQgfSkgPT4ge1xuICBpZiAoIUFDTCkge1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICByZXN1bHQuX3dwZXJtID0gW107XG4gIHJlc3VsdC5fcnBlcm0gPSBbXTtcblxuICBmb3IgKGNvbnN0IGVudHJ5IGluIEFDTCkge1xuICAgIGlmIChBQ0xbZW50cnldLnJlYWQpIHtcbiAgICAgIHJlc3VsdC5fcnBlcm0ucHVzaChlbnRyeSk7XG4gICAgfVxuICAgIGlmIChBQ0xbZW50cnldLndyaXRlKSB7XG4gICAgICByZXN1bHQuX3dwZXJtLnB1c2goZW50cnkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufTtcblxuY29uc3QgdmFsaWRhdGVRdWVyeSA9IChcbiAgcXVlcnk6IGFueSxcbiAgaXNNYXN0ZXI6IGJvb2xlYW4sXG4gIGlzTWFpbnRlbmFuY2U6IGJvb2xlYW4sXG4gIHVwZGF0ZTogYm9vbGVhbixcbiAgb3B0aW9uczogP1BhcnNlU2VydmVyT3B0aW9ucyxcbiAgX2RlcHRoOiBudW1iZXIgPSAwXG4pOiB2b2lkID0+IHtcbiAgaWYgKGlzTWFpbnRlbmFuY2UpIHtcbiAgICBpc01hc3RlciA9IHRydWU7XG4gIH1cbiAgY29uc3QgcmMgPSBvcHRpb25zPy5yZXF1ZXN0Q29tcGxleGl0eTtcbiAgaWYgKCFpc01hc3RlciAmJiByYyAmJiByYy5xdWVyeURlcHRoICE9PSAtMSAmJiBfZGVwdGggPiByYy5xdWVyeURlcHRoKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgIGBRdWVyeSBjb25kaXRpb24gbmVzdGluZyBkZXB0aCBleGNlZWRzIG1heGltdW0gYWxsb3dlZCBkZXB0aCBvZiAke3JjLnF1ZXJ5RGVwdGh9YFxuICAgICk7XG4gIH1cbiAgaWYgKHF1ZXJ5LkFDTCkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnQ2Fubm90IHF1ZXJ5IG9uIEFDTC4nKTtcbiAgfVxuXG4gIGlmIChxdWVyeS4kb3IpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShxdWVyeS4kb3IpKSB7XG4gICAgICBxdWVyeS4kb3IuZm9yRWFjaCh2YWx1ZSA9PiB2YWxpZGF0ZVF1ZXJ5KHZhbHVlLCBpc01hc3RlciwgaXNNYWludGVuYW5jZSwgdXBkYXRlLCBvcHRpb25zLCBfZGVwdGggKyAxKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnQmFkICRvciBmb3JtYXQgLSB1c2UgYW4gYXJyYXkgdmFsdWUuJyk7XG4gICAgfVxuICB9XG5cbiAgaWYgKHF1ZXJ5LiRhbmQpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShxdWVyeS4kYW5kKSkge1xuICAgICAgcXVlcnkuJGFuZC5mb3JFYWNoKHZhbHVlID0+IHZhbGlkYXRlUXVlcnkodmFsdWUsIGlzTWFzdGVyLCBpc01haW50ZW5hbmNlLCB1cGRhdGUsIG9wdGlvbnMsIF9kZXB0aCArIDEpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksICdCYWQgJGFuZCBmb3JtYXQgLSB1c2UgYW4gYXJyYXkgdmFsdWUuJyk7XG4gICAgfVxuICB9XG5cbiAgaWYgKHF1ZXJ5LiRub3IpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShxdWVyeS4kbm9yKSAmJiBxdWVyeS4kbm9yLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5LiRub3IuZm9yRWFjaCh2YWx1ZSA9PiB2YWxpZGF0ZVF1ZXJ5KHZhbHVlLCBpc01hc3RlciwgaXNNYWludGVuYW5jZSwgdXBkYXRlLCBvcHRpb25zLCBfZGVwdGggKyAxKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgJ0JhZCAkbm9yIGZvcm1hdCAtIHVzZSBhbiBhcnJheSBvZiBhdCBsZWFzdCAxIHZhbHVlLidcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgT2JqZWN0LmtleXMocXVlcnkpLmZvckVhY2goa2V5ID0+IHtcbiAgICBpZiAocXVlcnkgJiYgcXVlcnlba2V5XSAmJiBxdWVyeVtrZXldLiRyZWdleCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoIWlzTWFzdGVyICYmIHJjICYmIHJjLmFsbG93UmVnZXggPT09IGZhbHNlKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnJHJlZ2V4IG9wZXJhdG9yIGlzIG5vdCBhbGxvd2VkJyk7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIHF1ZXJ5W2tleV0uJHJlZ2V4ICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgJyRyZWdleCB2YWx1ZSBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgICB9XG4gICAgICBpZiAocXVlcnlba2V5XS4kb3B0aW9ucyAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBxdWVyeVtrZXldLiRvcHRpb25zICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgJyRvcHRpb25zIHZhbHVlIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgcXVlcnlba2V5XS4kb3B0aW9ucyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgaWYgKCFxdWVyeVtrZXldLiRvcHRpb25zLm1hdGNoKC9eW2lteHN1XSskLykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgICAgICAgYEJhZCAkb3B0aW9ucyB2YWx1ZSBmb3IgcXVlcnk6ICR7cXVlcnlba2V5XS4kb3B0aW9uc31gXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoXG4gICAgICAha2V5Lm1hdGNoKC9eW2EtekEtWl1bYS16QS1aMC05X1xcLl0qJC8pICYmXG4gICAgICAhc3BlY2lhbFF1ZXJ5S2V5cy5pbmNsdWRlcyhrZXkpICYmXG4gICAgICAhKGlzTWFzdGVyICYmIHNwZWNpYWxNYXN0ZXJRdWVyeUtleXMuaW5jbHVkZXMoa2V5KSlcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCBgSW52YWxpZCBrZXkgbmFtZTogJHtrZXl9YCk7XG4gICAgfVxuICB9KTtcbn07XG5cbi8vIEZpbHRlcnMgb3V0IGFueSBkYXRhIHRoYXQgc2hvdWxkbid0IGJlIG9uIHRoaXMgUkVTVC1mb3JtYXR0ZWQgb2JqZWN0LlxuY29uc3QgZmlsdGVyU2Vuc2l0aXZlRGF0YSA9IChcbiAgaXNNYXN0ZXI6IGJvb2xlYW4sXG4gIGlzTWFpbnRlbmFuY2U6IGJvb2xlYW4sXG4gIGFjbEdyb3VwOiBhbnlbXSxcbiAgYXV0aDogYW55LFxuICBvcGVyYXRpb246IGFueSxcbiAgc2NoZW1hOiBTY2hlbWFDb250cm9sbGVyLlNjaGVtYUNvbnRyb2xsZXIgfCBhbnksXG4gIGNsYXNzTmFtZTogc3RyaW5nLFxuICBwcm90ZWN0ZWRGaWVsZHM6IG51bGwgfCBBcnJheTxhbnk+LFxuICBvYmplY3Q6IGFueSxcbiAgcHJvdGVjdGVkRmllbGRzT3duZXJFeGVtcHQ6ID9ib29sZWFuXG4pID0+IHtcbiAgbGV0IHVzZXJJZCA9IG51bGw7XG4gIGlmIChhdXRoICYmIGF1dGgudXNlcikgeyB1c2VySWQgPSBhdXRoLnVzZXIuaWQ7IH1cblxuICAvLyByZXBsYWNlIHByb3RlY3RlZEZpZWxkcyB3aGVuIHVzaW5nIHBvaW50ZXItcGVybWlzc2lvbnNcbiAgY29uc3QgcGVybXMgPVxuICAgIHNjaGVtYSAmJiBzY2hlbWEuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zID8gc2NoZW1hLmdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWUpIDoge307XG4gIGlmIChwZXJtcykge1xuICAgIGNvbnN0IGlzUmVhZE9wZXJhdGlvbiA9IFsnZ2V0JywgJ2ZpbmQnXS5pbmRleE9mKG9wZXJhdGlvbikgPiAtMTtcblxuICAgIGlmIChpc1JlYWRPcGVyYXRpb24gJiYgcGVybXMucHJvdGVjdGVkRmllbGRzKSB7XG4gICAgICAvLyBleHRyYWN0IHByb3RlY3RlZEZpZWxkcyBhZGRlZCB3aXRoIHRoZSBwb2ludGVyLXBlcm1pc3Npb24gcHJlZml4XG4gICAgICBjb25zdCBwcm90ZWN0ZWRGaWVsZHNQb2ludGVyUGVybSA9IE9iamVjdC5rZXlzKHBlcm1zLnByb3RlY3RlZEZpZWxkcylcbiAgICAgICAgLmZpbHRlcihrZXkgPT4ga2V5LnN0YXJ0c1dpdGgoJ3VzZXJGaWVsZDonKSlcbiAgICAgICAgLm1hcChrZXkgPT4ge1xuICAgICAgICAgIHJldHVybiB7IGtleToga2V5LnN1YnN0cmluZygxMCksIHZhbHVlOiBwZXJtcy5wcm90ZWN0ZWRGaWVsZHNba2V5XSB9O1xuICAgICAgICB9KTtcblxuICAgICAgY29uc3QgbmV3UHJvdGVjdGVkRmllbGRzOiBBcnJheTxzdHJpbmc+W10gPSBbXTtcbiAgICAgIGxldCBvdmVycmlkZVByb3RlY3RlZEZpZWxkcyA9IGZhbHNlO1xuXG4gICAgICAvLyBjaGVjayBpZiB0aGUgb2JqZWN0IGdyYW50cyB0aGUgY3VycmVudCB1c2VyIGFjY2VzcyBiYXNlZCBvbiB0aGUgZXh0cmFjdGVkIGZpZWxkc1xuICAgICAgcHJvdGVjdGVkRmllbGRzUG9pbnRlclBlcm0uZm9yRWFjaChwb2ludGVyUGVybSA9PiB7XG4gICAgICAgIGxldCBwb2ludGVyUGVybUluY2x1ZGVzVXNlciA9IGZhbHNlO1xuICAgICAgICBjb25zdCByZWFkVXNlckZpZWxkVmFsdWUgPSBvYmplY3RbcG9pbnRlclBlcm0ua2V5XTtcbiAgICAgICAgaWYgKHJlYWRVc2VyRmllbGRWYWx1ZSkge1xuICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHJlYWRVc2VyRmllbGRWYWx1ZSkpIHtcbiAgICAgICAgICAgIHBvaW50ZXJQZXJtSW5jbHVkZXNVc2VyID0gcmVhZFVzZXJGaWVsZFZhbHVlLnNvbWUoXG4gICAgICAgICAgICAgIHVzZXIgPT4gdXNlci5vYmplY3RJZCAmJiB1c2VyLm9iamVjdElkID09PSB1c2VySWRcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBvaW50ZXJQZXJtSW5jbHVkZXNVc2VyID1cbiAgICAgICAgICAgICAgcmVhZFVzZXJGaWVsZFZhbHVlLm9iamVjdElkICYmIHJlYWRVc2VyRmllbGRWYWx1ZS5vYmplY3RJZCA9PT0gdXNlcklkO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwb2ludGVyUGVybUluY2x1ZGVzVXNlcikge1xuICAgICAgICAgIG92ZXJyaWRlUHJvdGVjdGVkRmllbGRzID0gdHJ1ZTtcbiAgICAgICAgICBuZXdQcm90ZWN0ZWRGaWVsZHMucHVzaChwb2ludGVyUGVybS52YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBpZiBhdCBsZWFzdCBvbmUgcG9pbnRlci1wZXJtaXNzaW9uIGFmZmVjdGVkIHRoZSBjdXJyZW50IHVzZXJcbiAgICAgIC8vIGludGVyc2VjdCB2cyBwcm90ZWN0ZWRGaWVsZHMgZnJvbSBwcmV2aW91cyBzdGFnZSAoQHNlZSBhZGRQcm90ZWN0ZWRGaWVsZHMpXG4gICAgICAvLyBTZXRzIHRoZW9yeSAoaW50ZXJzZWN0aW9ucyk6IEEgeCAoQiB4IEMpID09IChBIHggQikgeCBDXG4gICAgICBpZiAob3ZlcnJpZGVQcm90ZWN0ZWRGaWVsZHMgJiYgcHJvdGVjdGVkRmllbGRzKSB7XG4gICAgICAgIG5ld1Byb3RlY3RlZEZpZWxkcy5wdXNoKHByb3RlY3RlZEZpZWxkcyk7XG4gICAgICB9XG4gICAgICAvLyBpbnRlcnNlY3QgYWxsIHNldHMgb2YgcHJvdGVjdGVkRmllbGRzXG4gICAgICBuZXdQcm90ZWN0ZWRGaWVsZHMuZm9yRWFjaChmaWVsZHMgPT4ge1xuICAgICAgICBpZiAoZmllbGRzKSB7XG4gICAgICAgICAgLy8gaWYgdGhlcmUncmUgbm8gcHJvdGN0ZWRGaWVsZHMgYnkgb3RoZXIgY3JpdGVyaWEgKCBpZCAvIHJvbGUgLyBhdXRoKVxuICAgICAgICAgIC8vIHRoZW4gd2UgbXVzdCBpbnRlcnNlY3QgZWFjaCBzZXQgKHBlciB1c2VyRmllbGQpXG4gICAgICAgICAgaWYgKCFwcm90ZWN0ZWRGaWVsZHMpIHtcbiAgICAgICAgICAgIHByb3RlY3RlZEZpZWxkcyA9IGZpZWxkcztcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcHJvdGVjdGVkRmllbGRzID0gcHJvdGVjdGVkRmllbGRzLmZpbHRlcih2ID0+IGZpZWxkcy5pbmNsdWRlcyh2KSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBpc1VzZXJDbGFzcyA9IGNsYXNzTmFtZSA9PT0gJ19Vc2VyJztcbiAgaWYgKGlzVXNlckNsYXNzKSB7XG4gICAgb2JqZWN0LnBhc3N3b3JkID0gb2JqZWN0Ll9oYXNoZWRfcGFzc3dvcmQ7XG4gICAgZGVsZXRlIG9iamVjdC5faGFzaGVkX3Bhc3N3b3JkO1xuICAgIGRlbGV0ZSBvYmplY3Quc2Vzc2lvblRva2VuO1xuICB9XG5cbiAgaWYgKGlzTWFpbnRlbmFuY2UpIHtcbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG5cbiAgLyogc3BlY2lhbCB0cmVhdCBmb3IgdGhlIHVzZXIgY2xhc3M6IGRvbid0IGZpbHRlciBwcm90ZWN0ZWRGaWVsZHMgaWYgY3VycmVudGx5IGxvZ2dlZGluIHVzZXIgaXNcbiAgdGhlIHJldHJpZXZlZCB1c2VyLCB1bmxlc3MgcHJvdGVjdGVkRmllbGRzT3duZXJFeGVtcHQgaXMgZmFsc2UgKi9cbiAgY29uc3QgaXNPd25lckV4ZW1wdCA9IHByb3RlY3RlZEZpZWxkc093bmVyRXhlbXB0ICE9PSBmYWxzZSAmJiBpc1VzZXJDbGFzcyAmJiB1c2VySWQgJiYgb2JqZWN0Lm9iamVjdElkID09PSB1c2VySWQ7XG4gIGlmICghaXNPd25lckV4ZW1wdCkge1xuICAgIHByb3RlY3RlZEZpZWxkcyAmJiBwcm90ZWN0ZWRGaWVsZHMuZm9yRWFjaChrID0+IGRlbGV0ZSBvYmplY3Rba10pO1xuXG4gICAgLy8gZmllbGRzIG5vdCByZXF1ZXN0ZWQgYnkgY2xpZW50IChleGNsdWRlZCksXG4gICAgLy8gYnV0IHdlcmUgbmVlZGVkIHRvIGFwcGx5IHByb3RlY3RlZEZpZWxkc1xuICAgIHBlcm1zPy5wcm90ZWN0ZWRGaWVsZHM/LnRlbXBvcmFyeUtleXM/LmZvckVhY2goayA9PiBkZWxldGUgb2JqZWN0W2tdKTtcbiAgfVxuXG4gIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xuICAgIGlmIChrZXkuY2hhckF0KDApID09PSAnXycpIHtcbiAgICAgIGRlbGV0ZSBvYmplY3Rba2V5XTtcbiAgICB9XG4gIH1cblxuICBpZiAoIWlzVXNlckNsYXNzIHx8IGlzTWFzdGVyKSB7XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuXG4gIGlmIChhY2xHcm91cC5pbmRleE9mKG9iamVjdC5vYmplY3RJZCkgPiAtMSkge1xuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cbiAgZGVsZXRlIG9iamVjdC5hdXRoRGF0YTtcbiAgcmV0dXJuIG9iamVjdDtcbn07XG5cbi8vIFJ1bnMgYW4gdXBkYXRlIG9uIHRoZSBkYXRhYmFzZS5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhbiBvYmplY3Qgd2l0aCB0aGUgbmV3IHZhbHVlcyBmb3IgZmllbGRcbi8vIG1vZGlmaWNhdGlvbnMgdGhhdCBkb24ndCBrbm93IHRoZWlyIHJlc3VsdHMgYWhlYWQgb2YgdGltZSwgbGlrZVxuLy8gJ2luY3JlbWVudCcuXG4vLyBPcHRpb25zOlxuLy8gICBhY2w6ICBhIGxpc3Qgb2Ygc3RyaW5ncy4gSWYgdGhlIG9iamVjdCB0byBiZSB1cGRhdGVkIGhhcyBhbiBBQ0wsXG4vLyAgICAgICAgIG9uZSBvZiB0aGUgcHJvdmlkZWQgc3RyaW5ncyBtdXN0IHByb3ZpZGUgdGhlIGNhbGxlciB3aXRoXG4vLyAgICAgICAgIHdyaXRlIHBlcm1pc3Npb25zLlxuY29uc3Qgc3BlY2lhbEtleXNGb3JVcGRhdGUgPSBPYmplY3Qua2V5cyhpbnRlcm5hbEZpZWxkcykuZmlsdGVyKGsgPT4gaW50ZXJuYWxGaWVsZHNba10ubWFzdGVyV3JpdGUpO1xuXG5jb25zdCBpc1NwZWNpYWxVcGRhdGVLZXkgPSBrZXkgPT4ge1xuICByZXR1cm4gc3BlY2lhbEtleXNGb3JVcGRhdGUuaW5kZXhPZihrZXkpID49IDA7XG59O1xuXG5mdW5jdGlvbiBqb2luVGFibGVOYW1lKGNsYXNzTmFtZSwga2V5KSB7XG4gIHJldHVybiBgX0pvaW46JHtrZXl9OiR7Y2xhc3NOYW1lfWA7XG59XG5cbmNvbnN0IGZsYXR0ZW5VcGRhdGVPcGVyYXRvcnNGb3JDcmVhdGUgPSBvYmplY3QgPT4ge1xuICBmb3IgKGNvbnN0IGtleSBpbiBvYmplY3QpIHtcbiAgICBpZiAob2JqZWN0W2tleV0gJiYgb2JqZWN0W2tleV0uX19vcCkge1xuICAgICAgc3dpdGNoIChvYmplY3Rba2V5XS5fX29wKSB7XG4gICAgICAgIGNhc2UgJ0luY3JlbWVudCc6XG4gICAgICAgICAgaWYgKHR5cGVvZiBvYmplY3Rba2V5XS5hbW91bnQgIT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnb2JqZWN0cyB0byBhZGQgbXVzdCBiZSBhbiBhcnJheScpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBvYmplY3Rba2V5XSA9IG9iamVjdFtrZXldLmFtb3VudDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnU2V0T25JbnNlcnQnOlxuICAgICAgICAgIG9iamVjdFtrZXldID0gb2JqZWN0W2tleV0uYW1vdW50O1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdBZGQnOlxuICAgICAgICAgIGlmICghQXJyYXkuaXNBcnJheShvYmplY3Rba2V5XS5vYmplY3RzKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ29iamVjdHMgdG8gYWRkIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgb2JqZWN0W2tleV0gPSBvYmplY3Rba2V5XS5vYmplY3RzO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdBZGRVbmlxdWUnOlxuICAgICAgICAgIGlmICghQXJyYXkuaXNBcnJheShvYmplY3Rba2V5XS5vYmplY3RzKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ29iamVjdHMgdG8gYWRkIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgb2JqZWN0W2tleV0gPSBvYmplY3Rba2V5XS5vYmplY3RzO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdSZW1vdmUnOlxuICAgICAgICAgIGlmICghQXJyYXkuaXNBcnJheShvYmplY3Rba2V5XS5vYmplY3RzKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ29iamVjdHMgdG8gYWRkIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgb2JqZWN0W2tleV0gPSBbXTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnRGVsZXRlJzpcbiAgICAgICAgICBkZWxldGUgb2JqZWN0W2tleV07XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuQ09NTUFORF9VTkFWQUlMQUJMRSxcbiAgICAgICAgICAgIGBUaGUgJHtvYmplY3Rba2V5XS5fX29wfSBvcGVyYXRvciBpcyBub3Qgc3VwcG9ydGVkIHlldC5gXG4gICAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbmNvbnN0IHRyYW5zZm9ybUF1dGhEYXRhID0gKGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpID0+IHtcbiAgaWYgKG9iamVjdC5hdXRoRGF0YSAmJiBjbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBPYmplY3Qua2V5cyhvYmplY3QuYXV0aERhdGEpLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuICAgICAgY29uc3QgcHJvdmlkZXJEYXRhID0gb2JqZWN0LmF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgIGNvbnN0IGZpZWxkTmFtZSA9IGBfYXV0aF9kYXRhXyR7cHJvdmlkZXJ9YDtcbiAgICAgIGlmIChwcm92aWRlckRhdGEgPT0gbnVsbCkge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX29wOiAnRGVsZXRlJyxcbiAgICAgICAgfTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0gcHJvdmlkZXJEYXRhO1xuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gPSB7IHR5cGU6ICdPYmplY3QnIH07XG4gICAgICB9XG4gICAgfSk7XG4gICAgZGVsZXRlIG9iamVjdC5hdXRoRGF0YTtcbiAgfVxufTtcbi8vIFRyYW5zZm9ybXMgYSBEYXRhYmFzZSBmb3JtYXQgQUNMIHRvIGEgUkVTVCBBUEkgZm9ybWF0IEFDTFxuY29uc3QgdW50cmFuc2Zvcm1PYmplY3RBQ0wgPSAoeyBfcnBlcm0sIF93cGVybSwgLi4ub3V0cHV0IH0pID0+IHtcbiAgaWYgKF9ycGVybSB8fCBfd3Blcm0pIHtcbiAgICBvdXRwdXQuQUNMID0ge307XG5cbiAgICAoX3JwZXJtIHx8IFtdKS5mb3JFYWNoKGVudHJ5ID0+IHtcbiAgICAgIGlmICghb3V0cHV0LkFDTFtlbnRyeV0pIHtcbiAgICAgICAgb3V0cHV0LkFDTFtlbnRyeV0gPSB7IHJlYWQ6IHRydWUgfTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG91dHB1dC5BQ0xbZW50cnldWydyZWFkJ10gPSB0cnVlO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgKF93cGVybSB8fCBbXSkuZm9yRWFjaChlbnRyeSA9PiB7XG4gICAgICBpZiAoIW91dHB1dC5BQ0xbZW50cnldKSB7XG4gICAgICAgIG91dHB1dC5BQ0xbZW50cnldID0geyB3cml0ZTogdHJ1ZSB9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3V0cHV0LkFDTFtlbnRyeV1bJ3dyaXRlJ10gPSB0cnVlO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG4gIHJldHVybiBvdXRwdXQ7XG59O1xuXG4vKipcbiAqIFdoZW4gcXVlcnlpbmcsIHRoZSBmaWVsZE5hbWUgbWF5IGJlIGNvbXBvdW5kLCBleHRyYWN0IHRoZSByb290IGZpZWxkTmFtZVxuICogICAgIGB0ZW1wZXJhdHVyZS5jZWxzaXVzYCBiZWNvbWVzIGB0ZW1wZXJhdHVyZWBcbiAqIEBwYXJhbSB7c3RyaW5nfSBmaWVsZE5hbWUgdGhhdCBtYXkgYmUgYSBjb21wb3VuZCBmaWVsZCBuYW1lXG4gKiBAcmV0dXJucyB7c3RyaW5nfSB0aGUgcm9vdCBuYW1lIG9mIHRoZSBmaWVsZFxuICovXG5jb25zdCBnZXRSb290RmllbGROYW1lID0gKGZpZWxkTmFtZTogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgcmV0dXJuIGZpZWxkTmFtZS5zcGxpdCgnLicpWzBdO1xufTtcblxuY29uc3QgcmVsYXRpb25TY2hlbWEgPSB7XG4gIGZpZWxkczogeyByZWxhdGVkSWQ6IHsgdHlwZTogJ1N0cmluZycgfSwgb3duaW5nSWQ6IHsgdHlwZTogJ1N0cmluZycgfSB9LFxufTtcblxuY29uc3QgY29udmVydEVtYWlsVG9Mb3dlcmNhc2UgPSAob2JqZWN0LCBjbGFzc05hbWUsIG9wdGlvbnMpID0+IHtcbiAgaWYgKGNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJiBvcHRpb25zLmNvbnZlcnRFbWFpbFRvTG93ZXJjYXNlKSB7XG4gICAgaWYgKHR5cGVvZiBvYmplY3RbJ2VtYWlsJ10gPT09ICdzdHJpbmcnKSB7XG4gICAgICBvYmplY3RbJ2VtYWlsJ10gPSBvYmplY3RbJ2VtYWlsJ10udG9Mb3dlckNhc2UoKTtcbiAgICB9XG4gIH1cbn07XG5cbmNvbnN0IGNvbnZlcnRVc2VybmFtZVRvTG93ZXJjYXNlID0gKG9iamVjdCwgY2xhc3NOYW1lLCBvcHRpb25zKSA9PiB7XG4gIGlmIChjbGFzc05hbWUgPT09ICdfVXNlcicgJiYgb3B0aW9ucy5jb252ZXJ0VXNlcm5hbWVUb0xvd2VyY2FzZSkge1xuICAgIGlmICh0eXBlb2Ygb2JqZWN0Wyd1c2VybmFtZSddID09PSAnc3RyaW5nJykge1xuICAgICAgb2JqZWN0Wyd1c2VybmFtZSddID0gb2JqZWN0Wyd1c2VybmFtZSddLnRvTG93ZXJDYXNlKCk7XG4gICAgfVxuICB9XG59O1xuXG5jbGFzcyBEYXRhYmFzZUNvbnRyb2xsZXIge1xuICBhZGFwdGVyOiBTdG9yYWdlQWRhcHRlcjtcbiAgc2NoZW1hQ2FjaGU6IGFueTtcbiAgc2NoZW1hUHJvbWlzZTogP1Byb21pc2U8U2NoZW1hQ29udHJvbGxlci5TY2hlbWFDb250cm9sbGVyPjtcbiAgX3RyYW5zYWN0aW9uYWxTZXNzaW9uOiA/YW55O1xuICBvcHRpb25zOiBQYXJzZVNlcnZlck9wdGlvbnM7XG4gIGlkZW1wb3RlbmN5T3B0aW9uczogYW55O1xuXG4gIGNvbnN0cnVjdG9yKGFkYXB0ZXI6IFN0b3JhZ2VBZGFwdGVyLCBvcHRpb25zOiBQYXJzZVNlcnZlck9wdGlvbnMpIHtcbiAgICB0aGlzLmFkYXB0ZXIgPSBhZGFwdGVyO1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gICAgdGhpcy5pZGVtcG90ZW5jeU9wdGlvbnMgPSB0aGlzLm9wdGlvbnMuaWRlbXBvdGVuY3lPcHRpb25zIHx8IHt9O1xuICAgIC8vIFByZXZlbnQgbXV0YWJsZSB0aGlzLnNjaGVtYSwgb3RoZXJ3aXNlIG9uZSByZXF1ZXN0IGNvdWxkIHVzZVxuICAgIC8vIG11bHRpcGxlIHNjaGVtYXMsIHNvIGluc3RlYWQgdXNlIGxvYWRTY2hlbWEgdG8gZ2V0IGEgc2NoZW1hLlxuICAgIHRoaXMuc2NoZW1hUHJvbWlzZSA9IG51bGw7XG4gICAgdGhpcy5fdHJhbnNhY3Rpb25hbFNlc3Npb24gPSBudWxsO1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gIH1cblxuICBjb2xsZWN0aW9uRXhpc3RzKGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5jbGFzc0V4aXN0cyhjbGFzc05hbWUpO1xuICB9XG5cbiAgcHVyZ2VDb2xsZWN0aW9uKGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSgpXG4gICAgICAudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHNjaGVtYUNvbnRyb2xsZXIuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSkpXG4gICAgICAudGhlbihzY2hlbWEgPT4gdGhpcy5hZGFwdGVyLmRlbGV0ZU9iamVjdHNCeVF1ZXJ5KGNsYXNzTmFtZSwgc2NoZW1hLCB7fSkpO1xuICB9XG5cbiAgdmFsaWRhdGVDbGFzc05hbWUoY2xhc3NOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIVNjaGVtYUNvbnRyb2xsZXIuY2xhc3NOYW1lSXNWYWxpZChjbGFzc05hbWUpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICAgIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsICdpbnZhbGlkIGNsYXNzTmFtZTogJyArIGNsYXNzTmFtZSlcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIHNjaGVtYUNvbnRyb2xsZXIuXG4gIGxvYWRTY2hlbWEoXG4gICAgb3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7IGNsZWFyQ2FjaGU6IGZhbHNlIH1cbiAgKTogUHJvbWlzZTxTY2hlbWFDb250cm9sbGVyLlNjaGVtYUNvbnRyb2xsZXI+IHtcbiAgICBpZiAodGhpcy5zY2hlbWFQcm9taXNlICE9IG51bGwpIHtcbiAgICAgIHJldHVybiB0aGlzLnNjaGVtYVByb21pc2U7XG4gICAgfVxuICAgIHRoaXMuc2NoZW1hUHJvbWlzZSA9IFNjaGVtYUNvbnRyb2xsZXIubG9hZCh0aGlzLmFkYXB0ZXIsIG9wdGlvbnMpO1xuICAgIHRoaXMuc2NoZW1hUHJvbWlzZS50aGVuKFxuICAgICAgKCkgPT4gZGVsZXRlIHRoaXMuc2NoZW1hUHJvbWlzZSxcbiAgICAgICgpID0+IGRlbGV0ZSB0aGlzLnNjaGVtYVByb21pc2VcbiAgICApO1xuICAgIHJldHVybiB0aGlzLmxvYWRTY2hlbWEob3B0aW9ucyk7XG4gIH1cblxuICBsb2FkU2NoZW1hSWZOZWVkZWQoXG4gICAgc2NoZW1hQ29udHJvbGxlcjogU2NoZW1hQ29udHJvbGxlci5TY2hlbWFDb250cm9sbGVyLFxuICAgIG9wdGlvbnM6IExvYWRTY2hlbWFPcHRpb25zID0geyBjbGVhckNhY2hlOiBmYWxzZSB9XG4gICk6IFByb21pc2U8U2NoZW1hQ29udHJvbGxlci5TY2hlbWFDb250cm9sbGVyPiB7XG4gICAgcmV0dXJuIHNjaGVtYUNvbnRyb2xsZXIgPyBQcm9taXNlLnJlc29sdmUoc2NoZW1hQ29udHJvbGxlcikgOiB0aGlzLmxvYWRTY2hlbWEob3B0aW9ucyk7XG4gIH1cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgdGhlIGNsYXNzbmFtZSB0aGF0IGlzIHJlbGF0ZWQgdG8gdGhlIGdpdmVuXG4gIC8vIGNsYXNzbmFtZSB0aHJvdWdoIHRoZSBrZXkuXG4gIC8vIFRPRE86IG1ha2UgdGhpcyBub3QgaW4gdGhlIERhdGFiYXNlQ29udHJvbGxlciBpbnRlcmZhY2VcbiAgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXkoY2xhc3NOYW1lOiBzdHJpbmcsIGtleTogc3RyaW5nKTogUHJvbWlzZTw/c3RyaW5nPiB7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSgpLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgIHZhciB0ID0gc2NoZW1hLmdldEV4cGVjdGVkVHlwZShjbGFzc05hbWUsIGtleSk7XG4gICAgICBpZiAodCAhPSBudWxsICYmIHR5cGVvZiB0ICE9PSAnc3RyaW5nJyAmJiB0LnR5cGUgPT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIHQudGFyZ2V0Q2xhc3M7XG4gICAgICB9XG4gICAgICByZXR1cm4gY2xhc3NOYW1lO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gVXNlcyB0aGUgc2NoZW1hIHRvIHZhbGlkYXRlIHRoZSBvYmplY3QgKFJFU1QgQVBJIGZvcm1hdCkuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIG5ldyBzY2hlbWEuXG4gIC8vIFRoaXMgZG9lcyBub3QgdXBkYXRlIHRoaXMuc2NoZW1hLCBiZWNhdXNlIGluIGEgc2l0dWF0aW9uIGxpa2UgYVxuICAvLyBiYXRjaCByZXF1ZXN0LCB0aGF0IGNvdWxkIGNvbmZ1c2Ugb3RoZXIgdXNlcnMgb2YgdGhlIHNjaGVtYS5cbiAgdmFsaWRhdGVPYmplY3QoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0OiBhbnksXG4gICAgcXVlcnk6IGFueSxcbiAgICBydW5PcHRpb25zOiBRdWVyeU9wdGlvbnMsXG4gICAgbWFpbnRlbmFuY2U6IGJvb2xlYW5cbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgbGV0IHNjaGVtYTtcbiAgICBjb25zdCBhY2wgPSBydW5PcHRpb25zLmFjbDtcbiAgICBjb25zdCBpc01hc3RlciA9IGFjbCA9PT0gdW5kZWZpbmVkO1xuICAgIHZhciBhY2xHcm91cDogc3RyaW5nW10gPSBhY2wgfHwgW107XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSgpXG4gICAgICAudGhlbihzID0+IHtcbiAgICAgICAgc2NoZW1hID0gcztcbiAgICAgICAgaWYgKGlzTWFzdGVyKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmNhbkFkZEZpZWxkKHNjaGVtYSwgY2xhc3NOYW1lLCBvYmplY3QsIGFjbEdyb3VwLCBydW5PcHRpb25zKTtcbiAgICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiBzY2hlbWEudmFsaWRhdGVPYmplY3QoY2xhc3NOYW1lLCBvYmplY3QsIHF1ZXJ5LCBtYWludGVuYW5jZSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGVzIG9iamVjdHMgaW4gdGhlIGRhdGFiYXNlIHRoYXQgbWF0Y2ggdGhlIGdpdmVuIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLm1hbnk9ZmFsc2VdIFdoZW4gdHJ1ZSwgdXBkYXRlcyBhbGwgbWF0Y2hpbmcgZG9jdW1lbnRzXG4gICAqICAgYW5kIHJldHVybnMgYHsgbWF0Y2hlZENvdW50LCBtb2RpZmllZENvdW50IH1gIHdoZXJlIHZhbHVlcyBhcmUgbnVtYmVycyBpZiB0aGVcbiAgICogICBzdG9yYWdlIGFkYXB0ZXIgc3VwcG9ydHMgYFVwZGF0ZU1hbnlSZXN1bHRgLCBvciBgdW5kZWZpbmVkYCBvdGhlcndpc2UuXG4gICAqL1xuICB1cGRhdGUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgcXVlcnk6IGFueSxcbiAgICB1cGRhdGU6IGFueSxcbiAgICB7IGFjbCwgbWFueSwgdXBzZXJ0LCBhZGRzRmllbGQgfTogRnVsbFF1ZXJ5T3B0aW9ucyA9IHt9LFxuICAgIHNraXBTYW5pdGl6YXRpb246IGJvb2xlYW4gPSBmYWxzZSxcbiAgICB2YWxpZGF0ZU9ubHk6IGJvb2xlYW4gPSBmYWxzZSxcbiAgICB2YWxpZFNjaGVtYUNvbnRyb2xsZXI6IFNjaGVtYUNvbnRyb2xsZXIuU2NoZW1hQ29udHJvbGxlclxuICApOiBQcm9taXNlPGFueT4ge1xuICAgIHRyeSB7XG4gICAgICBVdGlscy5jaGVja1Byb2hpYml0ZWRLZXl3b3Jkcyh0aGlzLm9wdGlvbnMsIHVwZGF0ZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgYCR7ZXJyb3J9YCkpO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgY29uc3QgeyB2YWxpZGF0ZUZpbGVVcmxzSW5PYmplY3QgfSA9IHJlcXVpcmUoJy4uL0ZpbGVVcmxWYWxpZGF0b3InKTtcbiAgICAgIHZhbGlkYXRlRmlsZVVybHNJbk9iamVjdCh1cGRhdGUsIHRoaXMub3B0aW9ucyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChlcnJvciBpbnN0YW5jZW9mIFBhcnNlLkVycm9yID8gZXJyb3IgOiBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRklMRV9TQVZFX0VSUk9SLCBlcnJvci5tZXNzYWdlIHx8IGVycm9yKSk7XG4gICAgfVxuICAgIGNvbnN0IG9yaWdpbmFsUXVlcnkgPSBxdWVyeTtcbiAgICBjb25zdCBvcmlnaW5hbFVwZGF0ZSA9IHVwZGF0ZTtcbiAgICAvLyBNYWtlIGEgY29weSBvZiB0aGUgb2JqZWN0LCBzbyB3ZSBkb24ndCBtdXRhdGUgdGhlIGluY29taW5nIGRhdGEuXG4gICAgdXBkYXRlID0gc3RydWN0dXJlZENsb25lKHVwZGF0ZSk7XG4gICAgdmFyIHJlbGF0aW9uVXBkYXRlcyA9IFtdO1xuICAgIHZhciBpc01hc3RlciA9IGFjbCA9PT0gdW5kZWZpbmVkO1xuICAgIHZhciBhY2xHcm91cCA9IGFjbCB8fCBbXTtcblxuICAgIHJldHVybiB0aGlzLmxvYWRTY2hlbWFJZk5lZWRlZCh2YWxpZFNjaGVtYUNvbnRyb2xsZXIpLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiB7XG4gICAgICByZXR1cm4gKGlzTWFzdGVyXG4gICAgICAgID8gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgICAgOiBzY2hlbWFDb250cm9sbGVyLnZhbGlkYXRlUGVybWlzc2lvbihjbGFzc05hbWUsIGFjbEdyb3VwLCAndXBkYXRlJylcbiAgICAgIClcbiAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJlbGF0aW9uVXBkYXRlcyA9IHRoaXMuY29sbGVjdFJlbGF0aW9uVXBkYXRlcyhjbGFzc05hbWUsIG9yaWdpbmFsUXVlcnkub2JqZWN0SWQsIHVwZGF0ZSk7XG4gICAgICAgICAgaWYgKCFpc01hc3Rlcikge1xuICAgICAgICAgICAgcXVlcnkgPSB0aGlzLmFkZFBvaW50ZXJQZXJtaXNzaW9ucyhcbiAgICAgICAgICAgICAgc2NoZW1hQ29udHJvbGxlcixcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAndXBkYXRlJyxcbiAgICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICAgIGFjbEdyb3VwXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBpZiAoYWRkc0ZpZWxkKSB7XG4gICAgICAgICAgICAgIHF1ZXJ5ID0ge1xuICAgICAgICAgICAgICAgICRhbmQ6IFtcbiAgICAgICAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgICAgICAgdGhpcy5hZGRQb2ludGVyUGVybWlzc2lvbnMoXG4gICAgICAgICAgICAgICAgICAgIHNjaGVtYUNvbnRyb2xsZXIsXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgJ2FkZEZpZWxkJyxcbiAgICAgICAgICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICAgICAgICAgIGFjbEdyb3VwXG4gICAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghcXVlcnkpIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGFjbCkge1xuICAgICAgICAgICAgcXVlcnkgPSBhZGRXcml0ZUFDTChxdWVyeSwgYWNsKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdmFsaWRhdGVRdWVyeShxdWVyeSwgaXNNYXN0ZXIsIGZhbHNlLCB0cnVlLCB0aGlzLm9wdGlvbnMpO1xuICAgICAgICAgIHJldHVybiBzY2hlbWFDb250cm9sbGVyXG4gICAgICAgICAgICAuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSwgdHJ1ZSlcbiAgICAgICAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgICAgICAgIC8vIElmIHRoZSBzY2hlbWEgZG9lc24ndCBleGlzdCwgcHJldGVuZCBpdCBleGlzdHMgd2l0aCBubyBmaWVsZHMuIFRoaXMgYmVoYXZpb3JcbiAgICAgICAgICAgICAgLy8gd2lsbCBsaWtlbHkgbmVlZCByZXZpc2l0aW5nLlxuICAgICAgICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7IGZpZWxkczoge30gfTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICAgICAgICBPYmplY3Qua2V5cyh1cGRhdGUpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZmllbGROYW1lLm1hdGNoKC9eYXV0aERhdGFcXC4vKSkge1xuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLFxuICAgICAgICAgICAgICAgICAgICBgSW52YWxpZCBmaWVsZCBuYW1lIGZvciB1cGRhdGU6ICR7ZmllbGROYW1lfWBcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbnN0IHJvb3RGaWVsZE5hbWUgPSBnZXRSb290RmllbGROYW1lKGZpZWxkTmFtZSk7XG4gICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgIVNjaGVtYUNvbnRyb2xsZXIuZmllbGROYW1lSXNWYWxpZChyb290RmllbGROYW1lLCBjbGFzc05hbWUpICYmXG4gICAgICAgICAgICAgICAgICAhaXNTcGVjaWFsVXBkYXRlS2V5KHJvb3RGaWVsZE5hbWUpXG4gICAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsXG4gICAgICAgICAgICAgICAgICAgIGBJbnZhbGlkIGZpZWxkIG5hbWUgZm9yIHVwZGF0ZTogJHtmaWVsZE5hbWV9YFxuICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICBmb3IgKGNvbnN0IHVwZGF0ZU9wZXJhdGlvbiBpbiB1cGRhdGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICB1cGRhdGVbdXBkYXRlT3BlcmF0aW9uXSAmJlxuICAgICAgICAgICAgICAgICAgdHlwZW9mIHVwZGF0ZVt1cGRhdGVPcGVyYXRpb25dID09PSAnb2JqZWN0JyAmJlxuICAgICAgICAgICAgICAgICAgT2JqZWN0LmtleXModXBkYXRlW3VwZGF0ZU9wZXJhdGlvbl0pLnNvbWUoXG4gICAgICAgICAgICAgICAgICAgIGlubmVyS2V5ID0+IGlubmVyS2V5LmluY2x1ZGVzKCckJykgfHwgaW5uZXJLZXkuaW5jbHVkZXMoJy4nKVxuICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX05FU1RFRF9LRVksXG4gICAgICAgICAgICAgICAgICAgIFwiTmVzdGVkIGtleXMgc2hvdWxkIG5vdCBjb250YWluIHRoZSAnJCcgb3IgJy4nIGNoYXJhY3RlcnNcIlxuICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgdXBkYXRlID0gdHJhbnNmb3JtT2JqZWN0QUNMKHVwZGF0ZSk7XG4gICAgICAgICAgICAgIGNvbnZlcnRFbWFpbFRvTG93ZXJjYXNlKHVwZGF0ZSwgY2xhc3NOYW1lLCB0aGlzLm9wdGlvbnMpO1xuICAgICAgICAgICAgICBjb252ZXJ0VXNlcm5hbWVUb0xvd2VyY2FzZSh1cGRhdGUsIGNsYXNzTmFtZSwgdGhpcy5vcHRpb25zKTtcbiAgICAgICAgICAgICAgdHJhbnNmb3JtQXV0aERhdGEoY2xhc3NOYW1lLCB1cGRhdGUsIHNjaGVtYSk7XG4gICAgICAgICAgICAgIGlmICh2YWxpZGF0ZU9ubHkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmZpbmQoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCB7IHJlYWRQcmVmZXJlbmNlOiAncHJpbWFyeScgfSkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQgfHwgIXJlc3VsdC5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdPYmplY3Qgbm90IGZvdW5kLicpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmIChtYW55KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci51cGRhdGVPYmplY3RzQnlRdWVyeShcbiAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICAgIHNjaGVtYSxcbiAgICAgICAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgICAgICAgdXBkYXRlLFxuICAgICAgICAgICAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25hbFNlc3Npb25cbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHVwc2VydCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIudXBzZXJ0T25lT2JqZWN0KFxuICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAgc2NoZW1hLFxuICAgICAgICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICAgICAgICB1cGRhdGUsXG4gICAgICAgICAgICAgICAgICB0aGlzLl90cmFuc2FjdGlvbmFsU2Vzc2lvblxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci5maW5kT25lQW5kVXBkYXRlKFxuICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAgc2NoZW1hLFxuICAgICAgICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICAgICAgICB1cGRhdGUsXG4gICAgICAgICAgICAgICAgICB0aGlzLl90cmFuc2FjdGlvbmFsU2Vzc2lvblxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbigocmVzdWx0OiBhbnkpID0+IHtcbiAgICAgICAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdPYmplY3Qgbm90IGZvdW5kLicpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodmFsaWRhdGVPbmx5KSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVSZWxhdGlvblVwZGF0ZXMoXG4gICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICBvcmlnaW5hbFF1ZXJ5Lm9iamVjdElkLFxuICAgICAgICAgICAgdXBkYXRlLFxuICAgICAgICAgICAgcmVsYXRpb25VcGRhdGVzXG4gICAgICAgICAgKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgaWYgKHNraXBTYW5pdGl6YXRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKG1hbnkpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG1hdGNoZWRDb3VudDogdHlwZW9mIHJlc3VsdD8ubWF0Y2hlZENvdW50ID09PSAnbnVtYmVyJ1xuICAgICAgICAgICAgICAgID8gcmVzdWx0Lm1hdGNoZWRDb3VudFxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgICBtb2RpZmllZENvdW50OiB0eXBlb2YgcmVzdWx0Py5tb2RpZmllZENvdW50ID09PSAnbnVtYmVyJ1xuICAgICAgICAgICAgICAgID8gcmVzdWx0Lm1vZGlmaWVkQ291bnRcbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB0aGlzLl9zYW5pdGl6ZURhdGFiYXNlUmVzdWx0KG9yaWdpbmFsVXBkYXRlLCByZXN1bHQpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIENvbGxlY3QgYWxsIHJlbGF0aW9uLXVwZGF0aW5nIG9wZXJhdGlvbnMgZnJvbSBhIFJFU1QtZm9ybWF0IHVwZGF0ZS5cbiAgLy8gUmV0dXJucyBhIGxpc3Qgb2YgYWxsIHJlbGF0aW9uIHVwZGF0ZXMgdG8gcGVyZm9ybVxuICAvLyBUaGlzIG11dGF0ZXMgdXBkYXRlLlxuICBjb2xsZWN0UmVsYXRpb25VcGRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBvYmplY3RJZDogP3N0cmluZywgdXBkYXRlOiBhbnkpIHtcbiAgICB2YXIgb3BzID0gW107XG4gICAgdmFyIGRlbGV0ZU1lID0gW107XG4gICAgb2JqZWN0SWQgPSB1cGRhdGUub2JqZWN0SWQgfHwgb2JqZWN0SWQ7XG5cbiAgICB2YXIgcHJvY2VzcyA9IChvcCwga2V5KSA9PiB7XG4gICAgICBpZiAoIW9wKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChvcC5fX29wID09ICdBZGRSZWxhdGlvbicpIHtcbiAgICAgICAgb3BzLnB1c2goeyBrZXksIG9wIH0pO1xuICAgICAgICBkZWxldGVNZS5wdXNoKGtleSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChvcC5fX29wID09ICdSZW1vdmVSZWxhdGlvbicpIHtcbiAgICAgICAgb3BzLnB1c2goeyBrZXksIG9wIH0pO1xuICAgICAgICBkZWxldGVNZS5wdXNoKGtleSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChvcC5fX29wID09ICdCYXRjaCcpIHtcbiAgICAgICAgZm9yICh2YXIgeCBvZiBvcC5vcHMpIHtcbiAgICAgICAgICBwcm9jZXNzKHgsIGtleSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuXG4gICAgZm9yIChjb25zdCBrZXkgaW4gdXBkYXRlKSB7XG4gICAgICBwcm9jZXNzKHVwZGF0ZVtrZXldLCBrZXkpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBkZWxldGVNZSkge1xuICAgICAgZGVsZXRlIHVwZGF0ZVtrZXldO1xuICAgIH1cbiAgICByZXR1cm4gb3BzO1xuICB9XG5cbiAgLy8gUHJvY2Vzc2VzIHJlbGF0aW9uLXVwZGF0aW5nIG9wZXJhdGlvbnMgZnJvbSBhIFJFU1QtZm9ybWF0IHVwZGF0ZS5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIGFsbCB1cGRhdGVzIGhhdmUgYmVlbiBwZXJmb3JtZWRcbiAgaGFuZGxlUmVsYXRpb25VcGRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBvYmplY3RJZDogc3RyaW5nLCB1cGRhdGU6IGFueSwgb3BzOiBhbnkpIHtcbiAgICB2YXIgcGVuZGluZyA9IFtdO1xuICAgIG9iamVjdElkID0gdXBkYXRlLm9iamVjdElkIHx8IG9iamVjdElkO1xuICAgIG9wcy5mb3JFYWNoKCh7IGtleSwgb3AgfSkgPT4ge1xuICAgICAgaWYgKCFvcCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAob3AuX19vcCA9PSAnQWRkUmVsYXRpb24nKSB7XG4gICAgICAgIGZvciAoY29uc3Qgb2JqZWN0IG9mIG9wLm9iamVjdHMpIHtcbiAgICAgICAgICBwZW5kaW5nLnB1c2godGhpcy5hZGRSZWxhdGlvbihrZXksIGNsYXNzTmFtZSwgb2JqZWN0SWQsIG9iamVjdC5vYmplY3RJZCkpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChvcC5fX29wID09ICdSZW1vdmVSZWxhdGlvbicpIHtcbiAgICAgICAgZm9yIChjb25zdCBvYmplY3Qgb2Ygb3Aub2JqZWN0cykge1xuICAgICAgICAgIHBlbmRpbmcucHVzaCh0aGlzLnJlbW92ZVJlbGF0aW9uKGtleSwgY2xhc3NOYW1lLCBvYmplY3RJZCwgb2JqZWN0Lm9iamVjdElkKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBQcm9taXNlLmFsbChwZW5kaW5nKTtcbiAgfVxuXG4gIC8vIEFkZHMgYSByZWxhdGlvbi5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgaWZmIHRoZSBhZGQgd2FzIHN1Y2Nlc3NmdWwuXG4gIGFkZFJlbGF0aW9uKGtleTogc3RyaW5nLCBmcm9tQ2xhc3NOYW1lOiBzdHJpbmcsIGZyb21JZDogc3RyaW5nLCB0b0lkOiBzdHJpbmcpIHtcbiAgICBjb25zdCBkb2MgPSB7XG4gICAgICByZWxhdGVkSWQ6IHRvSWQsXG4gICAgICBvd25pbmdJZDogZnJvbUlkLFxuICAgIH07XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci51cHNlcnRPbmVPYmplY3QoXG4gICAgICBgX0pvaW46JHtrZXl9OiR7ZnJvbUNsYXNzTmFtZX1gLFxuICAgICAgcmVsYXRpb25TY2hlbWEsXG4gICAgICBkb2MsXG4gICAgICBkb2MsXG4gICAgICB0aGlzLl90cmFuc2FjdGlvbmFsU2Vzc2lvblxuICAgICk7XG4gIH1cblxuICAvLyBSZW1vdmVzIGEgcmVsYXRpb24uXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IGlmZiB0aGUgcmVtb3ZlIHdhc1xuICAvLyBzdWNjZXNzZnVsLlxuICByZW1vdmVSZWxhdGlvbihrZXk6IHN0cmluZywgZnJvbUNsYXNzTmFtZTogc3RyaW5nLCBmcm9tSWQ6IHN0cmluZywgdG9JZDogc3RyaW5nKSB7XG4gICAgdmFyIGRvYyA9IHtcbiAgICAgIHJlbGF0ZWRJZDogdG9JZCxcbiAgICAgIG93bmluZ0lkOiBmcm9tSWQsXG4gICAgfTtcbiAgICByZXR1cm4gdGhpcy5hZGFwdGVyXG4gICAgICAuZGVsZXRlT2JqZWN0c0J5UXVlcnkoXG4gICAgICAgIGBfSm9pbjoke2tleX06JHtmcm9tQ2xhc3NOYW1lfWAsXG4gICAgICAgIHJlbGF0aW9uU2NoZW1hLFxuICAgICAgICBkb2MsXG4gICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uYWxTZXNzaW9uXG4gICAgICApXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAvLyBXZSBkb24ndCBjYXJlIGlmIHRoZXkgdHJ5IHRvIGRlbGV0ZSBhIG5vbi1leGlzdGVudCByZWxhdGlvbi5cbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gUmVtb3ZlcyBvYmplY3RzIG1hdGNoZXMgdGhpcyBxdWVyeSBmcm9tIHRoZSBkYXRhYmFzZS5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgaWZmIHRoZSBvYmplY3Qgd2FzXG4gIC8vIGRlbGV0ZWQuXG4gIC8vIE9wdGlvbnM6XG4gIC8vICAgYWNsOiAgYSBsaXN0IG9mIHN0cmluZ3MuIElmIHRoZSBvYmplY3QgdG8gYmUgdXBkYXRlZCBoYXMgYW4gQUNMLFxuICAvLyAgICAgICAgIG9uZSBvZiB0aGUgcHJvdmlkZWQgc3RyaW5ncyBtdXN0IHByb3ZpZGUgdGhlIGNhbGxlciB3aXRoXG4gIC8vICAgICAgICAgd3JpdGUgcGVybWlzc2lvbnMuXG4gIGRlc3Ryb3koXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgcXVlcnk6IGFueSxcbiAgICB7IGFjbCB9OiBRdWVyeU9wdGlvbnMgPSB7fSxcbiAgICB2YWxpZFNjaGVtYUNvbnRyb2xsZXI6IFNjaGVtYUNvbnRyb2xsZXIuU2NoZW1hQ29udHJvbGxlclxuICApOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IGlzTWFzdGVyID0gYWNsID09PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgYWNsR3JvdXAgPSBhY2wgfHwgW107XG5cbiAgICByZXR1cm4gdGhpcy5sb2FkU2NoZW1hSWZOZWVkZWQodmFsaWRTY2hlbWFDb250cm9sbGVyKS50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4ge1xuICAgICAgcmV0dXJuIChpc01hc3RlclxuICAgICAgICA/IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAgIDogc2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lLCBhY2xHcm91cCwgJ2RlbGV0ZScpXG4gICAgICApLnRoZW4oKCkgPT4ge1xuICAgICAgICBpZiAoIWlzTWFzdGVyKSB7XG4gICAgICAgICAgcXVlcnkgPSB0aGlzLmFkZFBvaW50ZXJQZXJtaXNzaW9ucyhcbiAgICAgICAgICAgIHNjaGVtYUNvbnRyb2xsZXIsXG4gICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICAnZGVsZXRlJyxcbiAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgYWNsR3JvdXBcbiAgICAgICAgICApO1xuICAgICAgICAgIGlmICghcXVlcnkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnT2JqZWN0IG5vdCBmb3VuZC4nKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gZGVsZXRlIGJ5IHF1ZXJ5XG4gICAgICAgIGlmIChhY2wpIHtcbiAgICAgICAgICBxdWVyeSA9IGFkZFdyaXRlQUNMKHF1ZXJ5LCBhY2wpO1xuICAgICAgICB9XG4gICAgICAgIHZhbGlkYXRlUXVlcnkocXVlcnksIGlzTWFzdGVyLCBmYWxzZSwgZmFsc2UsIHRoaXMub3B0aW9ucyk7XG4gICAgICAgIHJldHVybiBzY2hlbWFDb250cm9sbGVyXG4gICAgICAgICAgLmdldE9uZVNjaGVtYShjbGFzc05hbWUpXG4gICAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICAgIC8vIElmIHRoZSBzY2hlbWEgZG9lc24ndCBleGlzdCwgcHJldGVuZCBpdCBleGlzdHMgd2l0aCBubyBmaWVsZHMuIFRoaXMgYmVoYXZpb3JcbiAgICAgICAgICAgIC8vIHdpbGwgbGlrZWx5IG5lZWQgcmV2aXNpdGluZy5cbiAgICAgICAgICAgIGlmIChlcnJvciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHJldHVybiB7IGZpZWxkczoge30gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4ocGFyc2VGb3JtYXRTY2hlbWEgPT5cbiAgICAgICAgICAgIHRoaXMuYWRhcHRlci5kZWxldGVPYmplY3RzQnlRdWVyeShcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICBwYXJzZUZvcm1hdFNjaGVtYSxcbiAgICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uYWxTZXNzaW9uXG4gICAgICAgICAgICApXG4gICAgICAgICAgKVxuICAgICAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgICAgICAvLyBXaGVuIGRlbGV0aW5nIHNlc3Npb25zIHdoaWxlIGNoYW5naW5nIHBhc3N3b3JkcywgZG9uJ3QgdGhyb3cgYW4gZXJyb3IgaWYgdGhleSBkb24ndCBoYXZlIGFueSBzZXNzaW9ucy5cbiAgICAgICAgICAgIGlmIChjbGFzc05hbWUgPT09ICdfU2Vzc2lvbicgJiYgZXJyb3IuY29kZSA9PT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHt9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBJbnNlcnRzIGFuIG9iamVjdCBpbnRvIHRoZSBkYXRhYmFzZS5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgaWZmIHRoZSBvYmplY3Qgc2F2ZWQuXG4gIGNyZWF0ZShcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBvYmplY3Q6IGFueSxcbiAgICB7IGFjbCB9OiBRdWVyeU9wdGlvbnMgPSB7fSxcbiAgICB2YWxpZGF0ZU9ubHk6IGJvb2xlYW4gPSBmYWxzZSxcbiAgICB2YWxpZFNjaGVtYUNvbnRyb2xsZXI6IFNjaGVtYUNvbnRyb2xsZXIuU2NoZW1hQ29udHJvbGxlclxuICApOiBQcm9taXNlPGFueT4ge1xuICAgIHRyeSB7XG4gICAgICBVdGlscy5jaGVja1Byb2hpYml0ZWRLZXl3b3Jkcyh0aGlzLm9wdGlvbnMsIG9iamVjdCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgYCR7ZXJyb3J9YCkpO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgY29uc3QgeyB2YWxpZGF0ZUZpbGVVcmxzSW5PYmplY3QgfSA9IHJlcXVpcmUoJy4uL0ZpbGVVcmxWYWxpZGF0b3InKTtcbiAgICAgIHZhbGlkYXRlRmlsZVVybHNJbk9iamVjdChvYmplY3QsIHRoaXMub3B0aW9ucyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChlcnJvciBpbnN0YW5jZW9mIFBhcnNlLkVycm9yID8gZXJyb3IgOiBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRklMRV9TQVZFX0VSUk9SLCBlcnJvci5tZXNzYWdlIHx8IGVycm9yKSk7XG4gICAgfVxuICAgIC8vIE1ha2UgYSBjb3B5IG9mIHRoZSBvYmplY3QsIHNvIHdlIGRvbid0IG11dGF0ZSB0aGUgaW5jb21pbmcgZGF0YS5cbiAgICBjb25zdCBvcmlnaW5hbE9iamVjdCA9IG9iamVjdDtcbiAgICBvYmplY3QgPSB0cmFuc2Zvcm1PYmplY3RBQ0wob2JqZWN0KTtcblxuICAgIGNvbnZlcnRFbWFpbFRvTG93ZXJjYXNlKG9iamVjdCwgY2xhc3NOYW1lLCB0aGlzLm9wdGlvbnMpO1xuICAgIGNvbnZlcnRVc2VybmFtZVRvTG93ZXJjYXNlKG9iamVjdCwgY2xhc3NOYW1lLCB0aGlzLm9wdGlvbnMpO1xuICAgIG9iamVjdC5jcmVhdGVkQXQgPSB7IGlzbzogb2JqZWN0LmNyZWF0ZWRBdCwgX190eXBlOiAnRGF0ZScgfTtcbiAgICBvYmplY3QudXBkYXRlZEF0ID0geyBpc286IG9iamVjdC51cGRhdGVkQXQsIF9fdHlwZTogJ0RhdGUnIH07XG5cbiAgICB2YXIgaXNNYXN0ZXIgPSBhY2wgPT09IHVuZGVmaW5lZDtcbiAgICB2YXIgYWNsR3JvdXAgPSBhY2wgfHwgW107XG4gICAgY29uc3QgcmVsYXRpb25VcGRhdGVzID0gdGhpcy5jb2xsZWN0UmVsYXRpb25VcGRhdGVzKGNsYXNzTmFtZSwgbnVsbCwgb2JqZWN0KTtcblxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlQ2xhc3NOYW1lKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKCgpID0+IHRoaXMubG9hZFNjaGVtYUlmTmVlZGVkKHZhbGlkU2NoZW1hQ29udHJvbGxlcikpXG4gICAgICAudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHtcbiAgICAgICAgcmV0dXJuIChpc01hc3RlclxuICAgICAgICAgID8gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgICAgICA6IHNjaGVtYUNvbnRyb2xsZXIudmFsaWRhdGVQZXJtaXNzaW9uKGNsYXNzTmFtZSwgYWNsR3JvdXAsICdjcmVhdGUnKVxuICAgICAgICApXG4gICAgICAgICAgLnRoZW4oKCkgPT4gc2NoZW1hQ29udHJvbGxlci5lbmZvcmNlQ2xhc3NFeGlzdHMoY2xhc3NOYW1lKSlcbiAgICAgICAgICAudGhlbigoKSA9PiBzY2hlbWFDb250cm9sbGVyLmdldE9uZVNjaGVtYShjbGFzc05hbWUsIHRydWUpKVxuICAgICAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgICAgICB0cmFuc2Zvcm1BdXRoRGF0YShjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKTtcbiAgICAgICAgICAgIGZsYXR0ZW5VcGRhdGVPcGVyYXRvcnNGb3JDcmVhdGUob2JqZWN0KTtcbiAgICAgICAgICAgIGlmICh2YWxpZGF0ZU9ubHkpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci5jcmVhdGVPYmplY3QoXG4gICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgU2NoZW1hQ29udHJvbGxlci5jb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKHNjaGVtYSksXG4gICAgICAgICAgICAgIG9iamVjdCxcbiAgICAgICAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25hbFNlc3Npb25cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgaWYgKHZhbGlkYXRlT25seSkge1xuICAgICAgICAgICAgICByZXR1cm4gb3JpZ2luYWxPYmplY3Q7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVSZWxhdGlvblVwZGF0ZXMoXG4gICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgb2JqZWN0Lm9iamVjdElkLFxuICAgICAgICAgICAgICBvYmplY3QsXG4gICAgICAgICAgICAgIHJlbGF0aW9uVXBkYXRlc1xuICAgICAgICAgICAgKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3Nhbml0aXplRGF0YWJhc2VSZXN1bHQob3JpZ2luYWxPYmplY3QsIHJlc3VsdC5vcHNbMF0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIGNhbkFkZEZpZWxkKFxuICAgIHNjaGVtYTogU2NoZW1hQ29udHJvbGxlci5TY2hlbWFDb250cm9sbGVyLFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIG9iamVjdDogYW55LFxuICAgIGFjbEdyb3VwOiBzdHJpbmdbXSxcbiAgICBydW5PcHRpb25zOiBRdWVyeU9wdGlvbnNcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY2xhc3NTY2hlbWEgPSBzY2hlbWEuc2NoZW1hRGF0YVtjbGFzc05hbWVdO1xuICAgIGlmICghY2xhc3NTY2hlbWEpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgY29uc3QgZmllbGRzID0gT2JqZWN0LmtleXMob2JqZWN0KTtcbiAgICBjb25zdCBzY2hlbWFGaWVsZHMgPSBPYmplY3Qua2V5cyhjbGFzc1NjaGVtYS5maWVsZHMpO1xuICAgIGNvbnN0IG5ld0tleXMgPSBmaWVsZHMuZmlsdGVyKGZpZWxkID0+IHtcbiAgICAgIC8vIFNraXAgZmllbGRzIHRoYXQgYXJlIHVuc2V0XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkXSAmJiBvYmplY3RbZmllbGRdLl9fb3AgJiYgb2JqZWN0W2ZpZWxkXS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICByZXR1cm4gc2NoZW1hRmllbGRzLmluZGV4T2YoZ2V0Um9vdEZpZWxkTmFtZShmaWVsZCkpIDwgMDtcbiAgICB9KTtcbiAgICBpZiAobmV3S2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAvLyBhZGRzIGEgbWFya2VyIHRoYXQgbmV3IGZpZWxkIGlzIGJlaW5nIGFkZGluZyBkdXJpbmcgdXBkYXRlXG4gICAgICBydW5PcHRpb25zLmFkZHNGaWVsZCA9IHRydWU7XG5cbiAgICAgIGNvbnN0IGFjdGlvbiA9IHJ1bk9wdGlvbnMuYWN0aW9uO1xuICAgICAgcmV0dXJuIHNjaGVtYS52YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lLCBhY2xHcm91cCwgJ2FkZEZpZWxkJywgYWN0aW9uKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgLy8gV29uJ3QgZGVsZXRlIGNvbGxlY3Rpb25zIGluIHRoZSBzeXN0ZW0gbmFtZXNwYWNlXG4gIC8qKlxuICAgKiBEZWxldGUgYWxsIGNsYXNzZXMgYW5kIGNsZWFycyB0aGUgc2NoZW1hIGNhY2hlXG4gICAqXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gZmFzdCBzZXQgdG8gdHJ1ZSBpZiBpdCdzIG9rIHRvIGp1c3QgZGVsZXRlIHJvd3MgYW5kIG5vdCBpbmRleGVzXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSB3aGVuIHRoZSBkZWxldGlvbnMgY29tcGxldGVzXG4gICAqL1xuICBkZWxldGVFdmVyeXRoaW5nKGZhc3Q6IGJvb2xlYW4gPSBmYWxzZSk6IFByb21pc2U8YW55PiB7XG4gICAgdGhpcy5zY2hlbWFQcm9taXNlID0gbnVsbDtcbiAgICBTY2hlbWFDYWNoZS5jbGVhcigpO1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZGVsZXRlQWxsQ2xhc3NlcyhmYXN0KTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIGxpc3Qgb2YgcmVsYXRlZCBpZHMgZ2l2ZW4gYW4gb3duaW5nIGlkLlxuICAvLyBjbGFzc05hbWUgaGVyZSBpcyB0aGUgb3duaW5nIGNsYXNzTmFtZS5cbiAgcmVsYXRlZElkcyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBrZXk6IHN0cmluZyxcbiAgICBvd25pbmdJZDogc3RyaW5nLFxuICAgIHF1ZXJ5T3B0aW9uczogUXVlcnlPcHRpb25zXG4gICk6IFByb21pc2U8QXJyYXk8c3RyaW5nPj4ge1xuICAgIGNvbnN0IHsgc2tpcCwgbGltaXQsIHNvcnQgfSA9IHF1ZXJ5T3B0aW9ucztcbiAgICBjb25zdCBmaW5kT3B0aW9ucyA9IHt9O1xuICAgIGlmIChzb3J0ICYmIHNvcnQuY3JlYXRlZEF0ICYmIHRoaXMuYWRhcHRlci5jYW5Tb3J0T25Kb2luVGFibGVzKSB7XG4gICAgICBmaW5kT3B0aW9ucy5zb3J0ID0geyBfaWQ6IHNvcnQuY3JlYXRlZEF0IH07XG4gICAgICBmaW5kT3B0aW9ucy5saW1pdCA9IGxpbWl0O1xuICAgICAgZmluZE9wdGlvbnMuc2tpcCA9IHNraXA7XG4gICAgICBxdWVyeU9wdGlvbnMuc2tpcCA9IDA7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmFkYXB0ZXJcbiAgICAgIC5maW5kKGpvaW5UYWJsZU5hbWUoY2xhc3NOYW1lLCBrZXkpLCByZWxhdGlvblNjaGVtYSwgeyBvd25pbmdJZCB9LCBmaW5kT3B0aW9ucylcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4gcmVzdWx0cy5tYXAocmVzdWx0ID0+IHJlc3VsdC5yZWxhdGVkSWQpKTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIGxpc3Qgb2Ygb3duaW5nIGlkcyBnaXZlbiBzb21lIHJlbGF0ZWQgaWRzLlxuICAvLyBjbGFzc05hbWUgaGVyZSBpcyB0aGUgb3duaW5nIGNsYXNzTmFtZS5cbiAgb3duaW5nSWRzKGNsYXNzTmFtZTogc3RyaW5nLCBrZXk6IHN0cmluZywgcmVsYXRlZElkczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlclxuICAgICAgLmZpbmQoXG4gICAgICAgIGpvaW5UYWJsZU5hbWUoY2xhc3NOYW1lLCBrZXkpLFxuICAgICAgICByZWxhdGlvblNjaGVtYSxcbiAgICAgICAgeyByZWxhdGVkSWQ6IHsgJGluOiByZWxhdGVkSWRzIH0gfSxcbiAgICAgICAgeyBrZXlzOiBbJ293bmluZ0lkJ10gfVxuICAgICAgKVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiByZXN1bHRzLm1hcChyZXN1bHQgPT4gcmVzdWx0Lm93bmluZ0lkKSk7XG4gIH1cblxuICAvLyBNb2RpZmllcyBxdWVyeSBzbyB0aGF0IGl0IG5vIGxvbmdlciBoYXMgJGluIG9uIHJlbGF0aW9uIGZpZWxkcywgb3JcbiAgLy8gZXF1YWwtdG8tcG9pbnRlciBjb25zdHJhaW50cyBvbiByZWxhdGlvbiBmaWVsZHMuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiBxdWVyeSBpcyBtdXRhdGVkXG4gIHJlZHVjZUluUmVsYXRpb24oY2xhc3NOYW1lOiBzdHJpbmcsIHF1ZXJ5OiBhbnksIHNjaGVtYTogYW55KTogUHJvbWlzZTxhbnk+IHtcbiAgICAvLyBTZWFyY2ggZm9yIGFuIGluLXJlbGF0aW9uIG9yIGVxdWFsLXRvLXJlbGF0aW9uXG4gICAgLy8gTWFrZSBpdCBzZXF1ZW50aWFsIGZvciBub3csIG5vdCBzdXJlIG9mIHBhcmFsbGVpemF0aW9uIHNpZGUgZWZmZWN0c1xuICAgIGNvbnN0IHByb21pc2VzID0gW107XG4gICAgaWYgKHF1ZXJ5Wyckb3InXSkge1xuICAgICAgY29uc3Qgb3JzID0gcXVlcnlbJyRvciddO1xuICAgICAgcHJvbWlzZXMucHVzaChcbiAgICAgICAgLi4ub3JzLm1hcCgoYVF1ZXJ5LCBpbmRleCkgPT4ge1xuICAgICAgICAgIHJldHVybiB0aGlzLnJlZHVjZUluUmVsYXRpb24oY2xhc3NOYW1lLCBhUXVlcnksIHNjaGVtYSkudGhlbihhUXVlcnkgPT4ge1xuICAgICAgICAgICAgcXVlcnlbJyRvciddW2luZGV4XSA9IGFRdWVyeTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChxdWVyeVsnJGFuZCddKSB7XG4gICAgICBjb25zdCBhbmRzID0gcXVlcnlbJyRhbmQnXTtcbiAgICAgIHByb21pc2VzLnB1c2goXG4gICAgICAgIC4uLmFuZHMubWFwKChhUXVlcnksIGluZGV4KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMucmVkdWNlSW5SZWxhdGlvbihjbGFzc05hbWUsIGFRdWVyeSwgc2NoZW1hKS50aGVuKGFRdWVyeSA9PiB7XG4gICAgICAgICAgICBxdWVyeVsnJGFuZCddW2luZGV4XSA9IGFRdWVyeTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgY29uc3Qgb3RoZXJLZXlzID0gT2JqZWN0LmtleXMocXVlcnkpLm1hcChrZXkgPT4ge1xuICAgICAgaWYgKGtleSA9PT0gJyRhbmQnIHx8IGtleSA9PT0gJyRvcicpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgdCA9IHNjaGVtYS5nZXRFeHBlY3RlZFR5cGUoY2xhc3NOYW1lLCBrZXkpO1xuICAgICAgaWYgKCF0IHx8IHQudHlwZSAhPT0gJ1JlbGF0aW9uJykge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHF1ZXJ5KTtcbiAgICAgIH1cbiAgICAgIGxldCBxdWVyaWVzOiA/KGFueVtdKSA9IG51bGw7XG4gICAgICBpZiAoXG4gICAgICAgIHF1ZXJ5W2tleV0gJiZcbiAgICAgICAgKHF1ZXJ5W2tleV1bJyRpbiddIHx8XG4gICAgICAgICAgcXVlcnlba2V5XVsnJG5lJ10gfHxcbiAgICAgICAgICBxdWVyeVtrZXldWyckbmluJ10gfHxcbiAgICAgICAgICBxdWVyeVtrZXldLl9fdHlwZSA9PSAnUG9pbnRlcicpXG4gICAgICApIHtcbiAgICAgICAgLy8gQnVpbGQgdGhlIGxpc3Qgb2YgcXVlcmllc1xuICAgICAgICBxdWVyaWVzID0gT2JqZWN0LmtleXMocXVlcnlba2V5XSkubWFwKGNvbnN0cmFpbnRLZXkgPT4ge1xuICAgICAgICAgIGxldCByZWxhdGVkSWRzO1xuICAgICAgICAgIGxldCBpc05lZ2F0aW9uID0gZmFsc2U7XG4gICAgICAgICAgaWYgKGNvbnN0cmFpbnRLZXkgPT09ICdvYmplY3RJZCcpIHtcbiAgICAgICAgICAgIHJlbGF0ZWRJZHMgPSBbcXVlcnlba2V5XS5vYmplY3RJZF07XG4gICAgICAgICAgfSBlbHNlIGlmIChjb25zdHJhaW50S2V5ID09ICckaW4nKSB7XG4gICAgICAgICAgICByZWxhdGVkSWRzID0gcXVlcnlba2V5XVsnJGluJ10ubWFwKHIgPT4gci5vYmplY3RJZCk7XG4gICAgICAgICAgfSBlbHNlIGlmIChjb25zdHJhaW50S2V5ID09ICckbmluJykge1xuICAgICAgICAgICAgaXNOZWdhdGlvbiA9IHRydWU7XG4gICAgICAgICAgICByZWxhdGVkSWRzID0gcXVlcnlba2V5XVsnJG5pbiddLm1hcChyID0+IHIub2JqZWN0SWQpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoY29uc3RyYWludEtleSA9PSAnJG5lJykge1xuICAgICAgICAgICAgaXNOZWdhdGlvbiA9IHRydWU7XG4gICAgICAgICAgICByZWxhdGVkSWRzID0gW3F1ZXJ5W2tleV1bJyRuZSddLm9iamVjdElkXTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgaXNOZWdhdGlvbixcbiAgICAgICAgICAgIHJlbGF0ZWRJZHMsXG4gICAgICAgICAgfTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBxdWVyaWVzID0gW3sgaXNOZWdhdGlvbjogZmFsc2UsIHJlbGF0ZWRJZHM6IFtdIH1dO1xuICAgICAgfVxuXG4gICAgICAvLyByZW1vdmUgdGhlIGN1cnJlbnQgcXVlcnlLZXkgYXMgd2UgZG9uLHQgbmVlZCBpdCBhbnltb3JlXG4gICAgICBkZWxldGUgcXVlcnlba2V5XTtcbiAgICAgIC8vIGV4ZWN1dGUgZWFjaCBxdWVyeSBpbmRlcGVuZGVudGx5IHRvIGJ1aWxkIHRoZSBsaXN0IG9mXG4gICAgICAvLyAkaW4gLyAkbmluXG4gICAgICBjb25zdCBwcm9taXNlcyA9IHF1ZXJpZXMubWFwKHEgPT4ge1xuICAgICAgICBpZiAoIXEpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMub3duaW5nSWRzKGNsYXNzTmFtZSwga2V5LCBxLnJlbGF0ZWRJZHMpLnRoZW4oaWRzID0+IHtcbiAgICAgICAgICBpZiAocS5pc05lZ2F0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmFkZE5vdEluT2JqZWN0SWRzSWRzKGlkcywgcXVlcnkpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmFkZEluT2JqZWN0SWRzSWRzKGlkcywgcXVlcnkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcykudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFsuLi5wcm9taXNlcywgLi4ub3RoZXJLZXlzXSkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHF1ZXJ5KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE1vZGlmaWVzIHF1ZXJ5IHNvIHRoYXQgaXQgbm8gbG9uZ2VyIGhhcyAkcmVsYXRlZFRvXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiBxdWVyeSBpcyBtdXRhdGVkXG4gIHJlZHVjZVJlbGF0aW9uS2V5cyhjbGFzc05hbWU6IHN0cmluZywgcXVlcnk6IGFueSwgcXVlcnlPcHRpb25zOiBhbnkpOiA/UHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHF1ZXJ5Wyckb3InXSkge1xuICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgICBxdWVyeVsnJG9yJ10ubWFwKGFRdWVyeSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMucmVkdWNlUmVsYXRpb25LZXlzKGNsYXNzTmFtZSwgYVF1ZXJ5LCBxdWVyeU9wdGlvbnMpO1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHF1ZXJ5WyckYW5kJ10pIHtcbiAgICAgIHJldHVybiBQcm9taXNlLmFsbChcbiAgICAgICAgcXVlcnlbJyRhbmQnXS5tYXAoYVF1ZXJ5ID0+IHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5yZWR1Y2VSZWxhdGlvbktleXMoY2xhc3NOYW1lLCBhUXVlcnksIHF1ZXJ5T3B0aW9ucyk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cbiAgICB2YXIgcmVsYXRlZFRvID0gcXVlcnlbJyRyZWxhdGVkVG8nXTtcbiAgICBpZiAocmVsYXRlZFRvKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZWxhdGVkSWRzKFxuICAgICAgICByZWxhdGVkVG8ub2JqZWN0LmNsYXNzTmFtZSxcbiAgICAgICAgcmVsYXRlZFRvLmtleSxcbiAgICAgICAgcmVsYXRlZFRvLm9iamVjdC5vYmplY3RJZCxcbiAgICAgICAgcXVlcnlPcHRpb25zXG4gICAgICApXG4gICAgICAgIC50aGVuKGlkcyA9PiB7XG4gICAgICAgICAgZGVsZXRlIHF1ZXJ5WyckcmVsYXRlZFRvJ107XG4gICAgICAgICAgdGhpcy5hZGRJbk9iamVjdElkc0lkcyhpZHMsIHF1ZXJ5KTtcbiAgICAgICAgICByZXR1cm4gdGhpcy5yZWR1Y2VSZWxhdGlvbktleXMoY2xhc3NOYW1lLCBxdWVyeSwgcXVlcnlPcHRpb25zKTtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oKCkgPT4ge30pO1xuICAgIH1cbiAgfVxuXG4gIGFkZEluT2JqZWN0SWRzSWRzKGlkczogP0FycmF5PHN0cmluZz4gPSBudWxsLCBxdWVyeTogYW55KSB7XG4gICAgY29uc3QgaWRzRnJvbVN0cmluZzogP0FycmF5PHN0cmluZz4gPVxuICAgICAgdHlwZW9mIHF1ZXJ5Lm9iamVjdElkID09PSAnc3RyaW5nJyA/IFtxdWVyeS5vYmplY3RJZF0gOiBudWxsO1xuICAgIGNvbnN0IGlkc0Zyb21FcTogP0FycmF5PHN0cmluZz4gPVxuICAgICAgcXVlcnkub2JqZWN0SWQgJiYgcXVlcnkub2JqZWN0SWRbJyRlcSddID8gW3F1ZXJ5Lm9iamVjdElkWyckZXEnXV0gOiBudWxsO1xuICAgIGNvbnN0IGlkc0Zyb21JbjogP0FycmF5PHN0cmluZz4gPVxuICAgICAgcXVlcnkub2JqZWN0SWQgJiYgcXVlcnkub2JqZWN0SWRbJyRpbiddID8gcXVlcnkub2JqZWN0SWRbJyRpbiddIDogbnVsbDtcblxuICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgIGNvbnN0IGFsbElkczogQXJyYXk8QXJyYXk8c3RyaW5nPj4gPSBbaWRzRnJvbVN0cmluZywgaWRzRnJvbUVxLCBpZHNGcm9tSW4sIGlkc10uZmlsdGVyKFxuICAgICAgbGlzdCA9PiBsaXN0ICE9PSBudWxsXG4gICAgKTtcbiAgICBjb25zdCB0b3RhbExlbmd0aCA9IGFsbElkcy5yZWR1Y2UoKG1lbW8sIGxpc3QpID0+IG1lbW8gKyBsaXN0Lmxlbmd0aCwgMCk7XG5cbiAgICBsZXQgaWRzSW50ZXJzZWN0aW9uID0gW107XG4gICAgaWYgKHRvdGFsTGVuZ3RoID4gMTI1KSB7XG4gICAgICBpZHNJbnRlcnNlY3Rpb24gPSBpbnRlcnNlY3QuYmlnKGFsbElkcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlkc0ludGVyc2VjdGlvbiA9IGludGVyc2VjdChhbGxJZHMpO1xuICAgIH1cblxuICAgIC8vIE5lZWQgdG8gbWFrZSBzdXJlIHdlIGRvbid0IGNsb2JiZXIgZXhpc3Rpbmcgc2hvcnRoYW5kICRlcSBjb25zdHJhaW50cyBvbiBvYmplY3RJZC5cbiAgICBpZiAoISgnb2JqZWN0SWQnIGluIHF1ZXJ5KSkge1xuICAgICAgcXVlcnkub2JqZWN0SWQgPSB7XG4gICAgICAgICRpbjogdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBxdWVyeS5vYmplY3RJZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHF1ZXJ5Lm9iamVjdElkID0ge1xuICAgICAgICAkaW46IHVuZGVmaW5lZCxcbiAgICAgICAgJGVxOiBxdWVyeS5vYmplY3RJZCxcbiAgICAgIH07XG4gICAgfVxuICAgIHF1ZXJ5Lm9iamVjdElkWyckaW4nXSA9IGlkc0ludGVyc2VjdGlvbjtcblxuICAgIHJldHVybiBxdWVyeTtcbiAgfVxuXG4gIGFkZE5vdEluT2JqZWN0SWRzSWRzKGlkczogc3RyaW5nW10gPSBbXSwgcXVlcnk6IGFueSkge1xuICAgIGNvbnN0IGlkc0Zyb21OaW4gPSBxdWVyeS5vYmplY3RJZCAmJiBxdWVyeS5vYmplY3RJZFsnJG5pbiddID8gcXVlcnkub2JqZWN0SWRbJyRuaW4nXSA6IFtdO1xuICAgIGxldCBhbGxJZHMgPSBbLi4uaWRzRnJvbU5pbiwgLi4uaWRzXS5maWx0ZXIobGlzdCA9PiBsaXN0ICE9PSBudWxsKTtcblxuICAgIC8vIG1ha2UgYSBzZXQgYW5kIHNwcmVhZCB0byByZW1vdmUgZHVwbGljYXRlc1xuICAgIGFsbElkcyA9IFsuLi5uZXcgU2V0KGFsbElkcyldO1xuXG4gICAgLy8gTmVlZCB0byBtYWtlIHN1cmUgd2UgZG9uJ3QgY2xvYmJlciBleGlzdGluZyBzaG9ydGhhbmQgJGVxIGNvbnN0cmFpbnRzIG9uIG9iamVjdElkLlxuICAgIGlmICghKCdvYmplY3RJZCcgaW4gcXVlcnkpKSB7XG4gICAgICBxdWVyeS5vYmplY3RJZCA9IHtcbiAgICAgICAgJG5pbjogdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBxdWVyeS5vYmplY3RJZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHF1ZXJ5Lm9iamVjdElkID0ge1xuICAgICAgICAkbmluOiB1bmRlZmluZWQsXG4gICAgICAgICRlcTogcXVlcnkub2JqZWN0SWQsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHF1ZXJ5Lm9iamVjdElkWyckbmluJ10gPSBhbGxJZHM7XG4gICAgcmV0dXJuIHF1ZXJ5O1xuICB9XG5cbiAgLy8gUnVucyBhIHF1ZXJ5IG9uIHRoZSBkYXRhYmFzZS5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhIGxpc3Qgb2YgaXRlbXMuXG4gIC8vIE9wdGlvbnM6XG4gIC8vICAgc2tpcCAgICBudW1iZXIgb2YgcmVzdWx0cyB0byBza2lwLlxuICAvLyAgIGxpbWl0ICAgbGltaXQgdG8gdGhpcyBudW1iZXIgb2YgcmVzdWx0cy5cbiAgLy8gICBzb3J0ICAgIGFuIG9iamVjdCB3aGVyZSBrZXlzIGFyZSB0aGUgZmllbGRzIHRvIHNvcnQgYnkuXG4gIC8vICAgICAgICAgICB0aGUgdmFsdWUgaXMgKzEgZm9yIGFzY2VuZGluZywgLTEgZm9yIGRlc2NlbmRpbmcuXG4gIC8vICAgY291bnQgICBydW4gYSBjb3VudCBpbnN0ZWFkIG9mIHJldHVybmluZyByZXN1bHRzLlxuICAvLyAgIGFjbCAgICAgcmVzdHJpY3QgdGhpcyBvcGVyYXRpb24gd2l0aCBhbiBBQ0wgZm9yIHRoZSBwcm92aWRlZCBhcnJheVxuICAvLyAgICAgICAgICAgb2YgdXNlciBvYmplY3RJZHMgYW5kIHJvbGVzLiBhY2w6IG51bGwgbWVhbnMgbm8gdXNlci5cbiAgLy8gICAgICAgICAgIHdoZW4gdGhpcyBmaWVsZCBpcyBub3QgcHJlc2VudCwgZG9uJ3QgZG8gYW55dGhpbmcgcmVnYXJkaW5nIEFDTHMuXG4gIC8vICBjYXNlSW5zZW5zaXRpdmUgbWFrZSBzdHJpbmcgY29tcGFyaXNvbnMgY2FzZSBpbnNlbnNpdGl2ZVxuICAvLyBUT0RPOiBtYWtlIHVzZXJJZHMgbm90IG5lZWRlZCBoZXJlLiBUaGUgZGIgYWRhcHRlciBzaG91bGRuJ3Qga25vd1xuICAvLyBhbnl0aGluZyBhYm91dCB1c2VycywgaWRlYWxseS4gVGhlbiwgaW1wcm92ZSB0aGUgZm9ybWF0IG9mIHRoZSBBQ0xcbiAgLy8gYXJnIHRvIHdvcmsgbGlrZSB0aGUgb3RoZXJzLlxuICBmaW5kKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHF1ZXJ5OiBhbnksXG4gICAge1xuICAgICAgc2tpcCxcbiAgICAgIGxpbWl0LFxuICAgICAgYWNsLFxuICAgICAgc29ydCA9IHt9LFxuICAgICAgY291bnQsXG4gICAgICBrZXlzLFxuICAgICAgb3AsXG4gICAgICBkaXN0aW5jdCxcbiAgICAgIHBpcGVsaW5lLFxuICAgICAgcmVhZFByZWZlcmVuY2UsXG4gICAgICBoaW50LFxuICAgICAgY2FzZUluc2Vuc2l0aXZlID0gZmFsc2UsXG4gICAgICBleHBsYWluLFxuICAgICAgY29tbWVudCxcbiAgICAgIHJhd1ZhbHVlcyxcbiAgICAgIHJhd0ZpZWxkTmFtZXMsXG4gICAgfTogYW55ID0ge30sXG4gICAgYXV0aDogYW55ID0ge30sXG4gICAgdmFsaWRTY2hlbWFDb250cm9sbGVyOiBTY2hlbWFDb250cm9sbGVyLlNjaGVtYUNvbnRyb2xsZXJcbiAgKTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCBpc01haW50ZW5hbmNlID0gYXV0aC5pc01haW50ZW5hbmNlO1xuICAgIGNvbnN0IGlzTWFzdGVyID0gYWNsID09PSB1bmRlZmluZWQgfHwgaXNNYWludGVuYW5jZTtcbiAgICBjb25zdCBhY2xHcm91cCA9IGFjbCB8fCBbXTtcbiAgICBvcCA9XG4gICAgICBvcCB8fCAodHlwZW9mIHF1ZXJ5Lm9iamVjdElkID09ICdzdHJpbmcnICYmIE9iamVjdC5rZXlzKHF1ZXJ5KS5sZW5ndGggPT09IDEgPyAnZ2V0JyA6ICdmaW5kJyk7XG4gICAgLy8gQ291bnQgb3BlcmF0aW9uIGlmIGNvdW50aW5nXG4gICAgb3AgPSBjb3VudCA9PT0gdHJ1ZSA/ICdjb3VudCcgOiBvcDtcblxuICAgIGxldCBjbGFzc0V4aXN0cyA9IHRydWU7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYUlmTmVlZGVkKHZhbGlkU2NoZW1hQ29udHJvbGxlcikudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHtcbiAgICAgIC8vQWxsb3cgdm9sYXRpbGUgY2xhc3NlcyBpZiBxdWVyeWluZyB3aXRoIE1hc3RlciAoZm9yIF9QdXNoU3RhdHVzKVxuICAgICAgLy9UT0RPOiBNb3ZlIHZvbGF0aWxlIGNsYXNzZXMgY29uY2VwdCBpbnRvIG1vbmdvIGFkYXB0ZXIsIHBvc3RncmVzIGFkYXB0ZXIgc2hvdWxkbid0IGNhcmVcbiAgICAgIC8vdGhhdCBhcGkucGFyc2UuY29tIGJyZWFrcyB3aGVuIF9QdXNoU3RhdHVzIGV4aXN0cyBpbiBtb25nby5cbiAgICAgIHJldHVybiBzY2hlbWFDb250cm9sbGVyXG4gICAgICAgIC5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCBpc01hc3RlcilcbiAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICAvLyBCZWhhdmlvciBmb3Igbm9uLWV4aXN0ZW50IGNsYXNzZXMgaXMga2luZGEgd2VpcmQgb24gUGFyc2UuY29tLiBQcm9iYWJseSBkb2Vzbid0IG1hdHRlciB0b28gbXVjaC5cbiAgICAgICAgICAvLyBGb3Igbm93LCBwcmV0ZW5kIHRoZSBjbGFzcyBleGlzdHMgYnV0IGhhcyBubyBvYmplY3RzLFxuICAgICAgICAgIGlmIChlcnJvciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjbGFzc0V4aXN0cyA9IGZhbHNlO1xuICAgICAgICAgICAgcmV0dXJuIHsgZmllbGRzOiB7fSB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgICAgICAvLyBQYXJzZS5jb20gdHJlYXRzIHF1ZXJpZXMgb24gX2NyZWF0ZWRfYXQgYW5kIF91cGRhdGVkX2F0IGFzIGlmIHRoZXkgd2VyZSBxdWVyaWVzIG9uIGNyZWF0ZWRBdCBhbmQgdXBkYXRlZEF0LFxuICAgICAgICAgIC8vIHNvIGR1cGxpY2F0ZSB0aGF0IGJlaGF2aW9yIGhlcmUuIElmIGJvdGggYXJlIHNwZWNpZmllZCwgdGhlIGNvcnJlY3QgYmVoYXZpb3IgdG8gbWF0Y2ggUGFyc2UuY29tIGlzIHRvXG4gICAgICAgICAgLy8gdXNlIHRoZSBvbmUgdGhhdCBhcHBlYXJzIGZpcnN0IGluIHRoZSBzb3J0IGxpc3QuXG4gICAgICAgICAgaWYgKHNvcnQuX2NyZWF0ZWRfYXQpIHtcbiAgICAgICAgICAgIHNvcnQuY3JlYXRlZEF0ID0gc29ydC5fY3JlYXRlZF9hdDtcbiAgICAgICAgICAgIGRlbGV0ZSBzb3J0Ll9jcmVhdGVkX2F0O1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc29ydC5fdXBkYXRlZF9hdCkge1xuICAgICAgICAgICAgc29ydC51cGRhdGVkQXQgPSBzb3J0Ll91cGRhdGVkX2F0O1xuICAgICAgICAgICAgZGVsZXRlIHNvcnQuX3VwZGF0ZWRfYXQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHF1ZXJ5T3B0aW9ucyA9IHtcbiAgICAgICAgICAgIHNraXAsXG4gICAgICAgICAgICBsaW1pdCxcbiAgICAgICAgICAgIHNvcnQsXG4gICAgICAgICAgICBrZXlzLFxuICAgICAgICAgICAgcmVhZFByZWZlcmVuY2UsXG4gICAgICAgICAgICBoaW50LFxuICAgICAgICAgICAgY2FzZUluc2Vuc2l0aXZlOiB0aGlzLm9wdGlvbnMuZW5hYmxlQ29sbGF0aW9uQ2FzZUNvbXBhcmlzb24gPyBmYWxzZSA6IGNhc2VJbnNlbnNpdGl2ZSxcbiAgICAgICAgICAgIGV4cGxhaW4sXG4gICAgICAgICAgICBjb21tZW50LFxuICAgICAgICAgIH07XG4gICAgICAgICAgT2JqZWN0LmtleXMoc29ydCkuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgaWYgKGZpZWxkTmFtZS5tYXRjaCgvXmF1dGhEYXRhXFwuKFthLXpBLVowLTlfXSspXFwuaWQkLykpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsIGBDYW5ub3Qgc29ydCBieSAke2ZpZWxkTmFtZX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHJvb3RGaWVsZE5hbWUgPSBnZXRSb290RmllbGROYW1lKGZpZWxkTmFtZSk7XG4gICAgICAgICAgICBpZiAoIVNjaGVtYUNvbnRyb2xsZXIuZmllbGROYW1lSXNWYWxpZChyb290RmllbGROYW1lLCBjbGFzc05hbWUpKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLFxuICAgICAgICAgICAgICAgIGBJbnZhbGlkIGZpZWxkIG5hbWU6ICR7ZmllbGROYW1lfS5gXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXNjaGVtYS5maWVsZHNbZmllbGROYW1lLnNwbGl0KCcuJylbMF1dICYmIGZpZWxkTmFtZSAhPT0gJ3Njb3JlJykge1xuICAgICAgICAgICAgICBkZWxldGUgc29ydFtmaWVsZE5hbWVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybiAoaXNNYXN0ZXJcbiAgICAgICAgICAgID8gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgICAgICAgIDogc2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lLCBhY2xHcm91cCwgb3ApXG4gICAgICAgICAgKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWR1Y2VSZWxhdGlvbktleXMoY2xhc3NOYW1lLCBxdWVyeSwgcXVlcnlPcHRpb25zKSlcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMucmVkdWNlSW5SZWxhdGlvbihjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWFDb250cm9sbGVyKSlcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgbGV0IHByb3RlY3RlZEZpZWxkcztcbiAgICAgICAgICAgICAgaWYgKCFpc01hc3Rlcikge1xuICAgICAgICAgICAgICAgIHF1ZXJ5ID0gdGhpcy5hZGRQb2ludGVyUGVybWlzc2lvbnMoXG4gICAgICAgICAgICAgICAgICBzY2hlbWFDb250cm9sbGVyLFxuICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAgb3AsXG4gICAgICAgICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgICAgICAgIGFjbEdyb3VwXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAvKiBEb24ndCB1c2UgcHJvamVjdGlvbnMgdG8gb3B0aW1pemUgdGhlIHByb3RlY3RlZEZpZWxkcyBzaW5jZSB0aGUgcHJvdGVjdGVkRmllbGRzXG4gICAgICAgICAgICAgICAgICBiYXNlZCBvbiBwb2ludGVyLXBlcm1pc3Npb25zIGFyZSBkZXRlcm1pbmVkIGFmdGVyIHF1ZXJ5aW5nLiBUaGUgZmlsdGVyaW5nIGNhblxuICAgICAgICAgICAgICAgICAgb3ZlcndyaXRlIHRoZSBwcm90ZWN0ZWQgZmllbGRzLiAqL1xuICAgICAgICAgICAgICAgIHByb3RlY3RlZEZpZWxkcyA9IHRoaXMuYWRkUHJvdGVjdGVkRmllbGRzKFxuICAgICAgICAgICAgICAgICAgc2NoZW1hQ29udHJvbGxlcixcbiAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgICAgICAgYWNsR3JvdXAsXG4gICAgICAgICAgICAgICAgICBhdXRoLFxuICAgICAgICAgICAgICAgICAgcXVlcnlPcHRpb25zXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAoIXF1ZXJ5KSB7XG4gICAgICAgICAgICAgICAgaWYgKG9wID09PSAnZ2V0Jykge1xuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdPYmplY3Qgbm90IGZvdW5kLicpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmICghaXNNYXN0ZXIpIHtcbiAgICAgICAgICAgICAgICBpZiAob3AgPT09ICd1cGRhdGUnIHx8IG9wID09PSAnZGVsZXRlJykge1xuICAgICAgICAgICAgICAgICAgcXVlcnkgPSBhZGRXcml0ZUFDTChxdWVyeSwgYWNsR3JvdXApO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBxdWVyeSA9IGFkZFJlYWRBQ0wocXVlcnksIGFjbEdyb3VwKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgdmFsaWRhdGVRdWVyeShxdWVyeSwgaXNNYXN0ZXIsIGlzTWFpbnRlbmFuY2UsIGZhbHNlLCB0aGlzLm9wdGlvbnMpO1xuICAgICAgICAgICAgICBpZiAoY291bnQpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWNsYXNzRXhpc3RzKSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci5jb3VudChcbiAgICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAgICBzY2hlbWEsXG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgICAgICAgICByZWFkUHJlZmVyZW5jZSxcbiAgICAgICAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgICAgICBoaW50LFxuICAgICAgICAgICAgICAgICAgICBjb21tZW50XG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChkaXN0aW5jdCkge1xuICAgICAgICAgICAgICAgIGlmICghY2xhc3NFeGlzdHMpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci5kaXN0aW5jdChjbGFzc05hbWUsIHNjaGVtYSwgcXVlcnksIGRpc3RpbmN0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAocGlwZWxpbmUpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWNsYXNzRXhpc3RzKSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuYWdncmVnYXRlKFxuICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICAgICAgICAgIHNjaGVtYSxcbiAgICAgICAgICAgICAgICAgICAgcGlwZWxpbmUsXG4gICAgICAgICAgICAgICAgICAgIHJlYWRQcmVmZXJlbmNlLFxuICAgICAgICAgICAgICAgICAgICBoaW50LFxuICAgICAgICAgICAgICAgICAgICBleHBsYWluLFxuICAgICAgICAgICAgICAgICAgICBjb21tZW50LFxuICAgICAgICAgICAgICAgICAgICByYXdWYWx1ZXMsXG4gICAgICAgICAgICAgICAgICAgIHJhd0ZpZWxkTmFtZXNcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKGV4cGxhaW4pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmZpbmQoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCBxdWVyeU9wdGlvbnMpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXJcbiAgICAgICAgICAgICAgICAgIC5maW5kKGNsYXNzTmFtZSwgc2NoZW1hLCBxdWVyeSwgcXVlcnlPcHRpb25zKVxuICAgICAgICAgICAgICAgICAgLnRoZW4ob2JqZWN0cyA9PlxuICAgICAgICAgICAgICAgICAgICBvYmplY3RzLm1hcChvYmplY3QgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgIG9iamVjdCA9IHVudHJhbnNmb3JtT2JqZWN0QUNMKG9iamVjdCk7XG4gICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZpbHRlclNlbnNpdGl2ZURhdGEoXG4gICAgICAgICAgICAgICAgICAgICAgICBpc01hc3RlcixcbiAgICAgICAgICAgICAgICAgICAgICAgIGlzTWFpbnRlbmFuY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBhY2xHcm91cCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF1dGgsXG4gICAgICAgICAgICAgICAgICAgICAgICBvcCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNjaGVtYUNvbnRyb2xsZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm90ZWN0ZWRGaWVsZHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBvYmplY3QsXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLm9wdGlvbnMucHJvdGVjdGVkRmllbGRzT3duZXJFeGVtcHRcbiAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUGFyc2UuRXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkZXRhaWxlZE1lc3NhZ2UgPVxuICAgICAgICAgICAgICAgICAgICAgIHR5cGVvZiBlcnJvciA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgICAgICAgICAgICAgID8gZXJyb3JcbiAgICAgICAgICAgICAgICAgICAgICAgIDogZXJyb3I/Lm1lc3NhZ2UgfHwgJ0FuIGludGVybmFsIHNlcnZlciBlcnJvciBvY2N1cnJlZCc7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUixcbiAgICAgICAgICAgICAgICAgICAgICBkZXRhaWxlZE1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgICAgdGhpcy5vcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICAgICdBbiBpbnRlcm5hbCBzZXJ2ZXIgZXJyb3Igb2NjdXJyZWQnXG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZGVsZXRlU2NoZW1hKGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IHNjaGVtYUNvbnRyb2xsZXI7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSh7IGNsZWFyQ2FjaGU6IHRydWUgfSlcbiAgICAgIC50aGVuKHMgPT4ge1xuICAgICAgICBzY2hlbWFDb250cm9sbGVyID0gcztcbiAgICAgICAgcmV0dXJuIHNjaGVtYUNvbnRyb2xsZXIuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSwgdHJ1ZSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICByZXR1cm4geyBmaWVsZHM6IHt9IH07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbigoc2NoZW1hOiBhbnkpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29sbGVjdGlvbkV4aXN0cyhjbGFzc05hbWUpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5hZGFwdGVyLmNvdW50KGNsYXNzTmFtZSwgeyBmaWVsZHM6IHt9IH0sIG51bGwsICcnLCBmYWxzZSkpXG4gICAgICAgICAgLnRoZW4oY291bnQgPT4ge1xuICAgICAgICAgICAgaWYgKGNvdW50ID4gMCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgMjU1LFxuICAgICAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gaXMgbm90IGVtcHR5LCBjb250YWlucyAke2NvdW50fSBvYmplY3RzLCBjYW5ub3QgZHJvcCBzY2hlbWEuYFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci5kZWxldGVDbGFzcyhjbGFzc05hbWUpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4od2FzUGFyc2VDb2xsZWN0aW9uID0+IHtcbiAgICAgICAgICAgIGlmICh3YXNQYXJzZUNvbGxlY3Rpb24pIHtcbiAgICAgICAgICAgICAgY29uc3QgcmVsYXRpb25GaWVsZE5hbWVzID0gT2JqZWN0LmtleXMoc2NoZW1hLmZpZWxkcykuZmlsdGVyKFxuICAgICAgICAgICAgICAgIGZpZWxkTmFtZSA9PiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1JlbGF0aW9uJ1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoXG4gICAgICAgICAgICAgICAgcmVsYXRpb25GaWVsZE5hbWVzLm1hcChuYW1lID0+XG4gICAgICAgICAgICAgICAgICB0aGlzLmFkYXB0ZXIuZGVsZXRlQ2xhc3Moam9pblRhYmxlTmFtZShjbGFzc05hbWUsIG5hbWUpKVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICBTY2hlbWFDYWNoZS5kZWwoY2xhc3NOYW1lKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gc2NoZW1hQ29udHJvbGxlci5yZWxvYWREYXRhKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBUaGlzIGhlbHBzIHRvIGNyZWF0ZSBpbnRlcm1lZGlhdGUgb2JqZWN0cyBmb3Igc2ltcGxlciBjb21wYXJpc29uIG9mXG4gIC8vIGtleSB2YWx1ZSBwYWlycyB1c2VkIGluIHF1ZXJ5IG9iamVjdHMuIEVhY2gga2V5IHZhbHVlIHBhaXIgd2lsbCByZXByZXNlbnRlZFxuICAvLyBpbiBhIHNpbWlsYXIgd2F5IHRvIGpzb25cbiAgb2JqZWN0VG9FbnRyaWVzU3RyaW5ncyhxdWVyeTogYW55KTogQXJyYXk8c3RyaW5nPiB7XG4gICAgcmV0dXJuIE9iamVjdC5lbnRyaWVzKHF1ZXJ5KS5tYXAoYSA9PiBhLm1hcChzID0+IEpTT04uc3RyaW5naWZ5KHMpKS5qb2luKCc6JykpO1xuICB9XG5cbiAgLy8gTmFpdmUgbG9naWMgcmVkdWNlciBmb3IgT1Igb3BlcmF0aW9ucyBtZWFudCB0byBiZSB1c2VkIG9ubHkgZm9yIHBvaW50ZXIgcGVybWlzc2lvbnMuXG4gIHJlZHVjZU9yT3BlcmF0aW9uKHF1ZXJ5OiB7ICRvcjogQXJyYXk8YW55PiB9KTogYW55IHtcbiAgICBpZiAoIXF1ZXJ5LiRvcikge1xuICAgICAgcmV0dXJuIHF1ZXJ5O1xuICAgIH1cbiAgICBjb25zdCBxdWVyaWVzID0gcXVlcnkuJG9yLm1hcChxID0+IHRoaXMub2JqZWN0VG9FbnRyaWVzU3RyaW5ncyhxKSk7XG4gICAgbGV0IHJlcGVhdCA9IGZhbHNlO1xuICAgIGRvIHtcbiAgICAgIHJlcGVhdCA9IGZhbHNlO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBxdWVyaWVzLmxlbmd0aCAtIDE7IGkrKykge1xuICAgICAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBxdWVyaWVzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgY29uc3QgW3Nob3J0ZXIsIGxvbmdlcl0gPSBxdWVyaWVzW2ldLmxlbmd0aCA+IHF1ZXJpZXNbal0ubGVuZ3RoID8gW2osIGldIDogW2ksIGpdO1xuICAgICAgICAgIGNvbnN0IGZvdW5kRW50cmllcyA9IHF1ZXJpZXNbc2hvcnRlcl0ucmVkdWNlKFxuICAgICAgICAgICAgKGFjYywgZW50cnkpID0+IGFjYyArIChxdWVyaWVzW2xvbmdlcl0uaW5jbHVkZXMoZW50cnkpID8gMSA6IDApLFxuICAgICAgICAgICAgMFxuICAgICAgICAgICk7XG4gICAgICAgICAgY29uc3Qgc2hvcnRlckVudHJpZXMgPSBxdWVyaWVzW3Nob3J0ZXJdLmxlbmd0aDtcbiAgICAgICAgICBpZiAoZm91bmRFbnRyaWVzID09PSBzaG9ydGVyRW50cmllcykge1xuICAgICAgICAgICAgLy8gSWYgdGhlIHNob3J0ZXIgcXVlcnkgaXMgY29tcGxldGVseSBjb250YWluZWQgaW4gdGhlIGxvbmdlciBvbmUsIHdlIGNhbiBzdHJpa2VcbiAgICAgICAgICAgIC8vIG91dCB0aGUgbG9uZ2VyIHF1ZXJ5LlxuICAgICAgICAgICAgcXVlcnkuJG9yLnNwbGljZShsb25nZXIsIDEpO1xuICAgICAgICAgICAgcXVlcmllcy5zcGxpY2UobG9uZ2VyLCAxKTtcbiAgICAgICAgICAgIHJlcGVhdCA9IHRydWU7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IHdoaWxlIChyZXBlYXQpO1xuICAgIGlmIChxdWVyeS4kb3IubGVuZ3RoID09PSAxKSB7XG4gICAgICBxdWVyeSA9IHsgLi4ucXVlcnksIC4uLnF1ZXJ5LiRvclswXSB9O1xuICAgICAgZGVsZXRlIHF1ZXJ5LiRvcjtcbiAgICB9XG4gICAgcmV0dXJuIHF1ZXJ5O1xuICB9XG5cbiAgLy8gTmFpdmUgbG9naWMgcmVkdWNlciBmb3IgQU5EIG9wZXJhdGlvbnMgbWVhbnQgdG8gYmUgdXNlZCBvbmx5IGZvciBwb2ludGVyIHBlcm1pc3Npb25zLlxuICByZWR1Y2VBbmRPcGVyYXRpb24ocXVlcnk6IHsgJGFuZDogQXJyYXk8YW55PiB9KTogYW55IHtcbiAgICBpZiAoIXF1ZXJ5LiRhbmQpIHtcbiAgICAgIHJldHVybiBxdWVyeTtcbiAgICB9XG4gICAgY29uc3QgcXVlcmllcyA9IHF1ZXJ5LiRhbmQubWFwKHEgPT4gdGhpcy5vYmplY3RUb0VudHJpZXNTdHJpbmdzKHEpKTtcbiAgICBsZXQgcmVwZWF0ID0gZmFsc2U7XG4gICAgZG8ge1xuICAgICAgcmVwZWF0ID0gZmFsc2U7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHF1ZXJpZXMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IHF1ZXJpZXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICBjb25zdCBbc2hvcnRlciwgbG9uZ2VyXSA9IHF1ZXJpZXNbaV0ubGVuZ3RoID4gcXVlcmllc1tqXS5sZW5ndGggPyBbaiwgaV0gOiBbaSwgal07XG4gICAgICAgICAgY29uc3QgZm91bmRFbnRyaWVzID0gcXVlcmllc1tzaG9ydGVyXS5yZWR1Y2UoXG4gICAgICAgICAgICAoYWNjLCBlbnRyeSkgPT4gYWNjICsgKHF1ZXJpZXNbbG9uZ2VyXS5pbmNsdWRlcyhlbnRyeSkgPyAxIDogMCksXG4gICAgICAgICAgICAwXG4gICAgICAgICAgKTtcbiAgICAgICAgICBjb25zdCBzaG9ydGVyRW50cmllcyA9IHF1ZXJpZXNbc2hvcnRlcl0ubGVuZ3RoO1xuICAgICAgICAgIGlmIChmb3VuZEVudHJpZXMgPT09IHNob3J0ZXJFbnRyaWVzKSB7XG4gICAgICAgICAgICAvLyBJZiB0aGUgc2hvcnRlciBxdWVyeSBpcyBjb21wbGV0ZWx5IGNvbnRhaW5lZCBpbiB0aGUgbG9uZ2VyIG9uZSwgd2UgY2FuIHN0cmlrZVxuICAgICAgICAgICAgLy8gb3V0IHRoZSBzaG9ydGVyIHF1ZXJ5LlxuICAgICAgICAgICAgcXVlcnkuJGFuZC5zcGxpY2Uoc2hvcnRlciwgMSk7XG4gICAgICAgICAgICBxdWVyaWVzLnNwbGljZShzaG9ydGVyLCAxKTtcbiAgICAgICAgICAgIHJlcGVhdCA9IHRydWU7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IHdoaWxlIChyZXBlYXQpO1xuICAgIGlmIChxdWVyeS4kYW5kLmxlbmd0aCA9PT0gMSkge1xuICAgICAgcXVlcnkgPSB7IC4uLnF1ZXJ5LCAuLi5xdWVyeS4kYW5kWzBdIH07XG4gICAgICBkZWxldGUgcXVlcnkuJGFuZDtcbiAgICB9XG4gICAgcmV0dXJuIHF1ZXJ5O1xuICB9XG5cbiAgLy8gQ29uc3RyYWludHMgcXVlcnkgdXNpbmcgQ0xQJ3MgcG9pbnRlciBwZXJtaXNzaW9ucyAoUFApIGlmIGFueS5cbiAgLy8gMS4gRXRyYWN0IHRoZSB1c2VyIGlkIGZyb20gY2FsbGVyJ3MgQUNMZ3JvdXA7XG4gIC8vIDIuIEV4Y3RyYWN0IGEgbGlzdCBvZiBmaWVsZCBuYW1lcyB0aGF0IGFyZSBQUCBmb3IgdGFyZ2V0IGNvbGxlY3Rpb24gYW5kIG9wZXJhdGlvbjtcbiAgLy8gMy4gQ29uc3RyYWludCB0aGUgb3JpZ2luYWwgcXVlcnkgc28gdGhhdCBlYWNoIFBQIGZpZWxkIG11c3RcbiAgLy8gcG9pbnQgdG8gY2FsbGVyJ3MgaWQgKG9yIGNvbnRhaW4gaXQgaW4gY2FzZSBvZiBQUCBmaWVsZCBiZWluZyBhbiBhcnJheSlcbiAgYWRkUG9pbnRlclBlcm1pc3Npb25zKFxuICAgIHNjaGVtYTogU2NoZW1hQ29udHJvbGxlci5TY2hlbWFDb250cm9sbGVyLFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIHF1ZXJ5OiBhbnksXG4gICAgYWNsR3JvdXA6IGFueVtdID0gW11cbiAgKTogYW55IHtcbiAgICAvLyBDaGVjayBpZiBjbGFzcyBoYXMgcHVibGljIHBlcm1pc3Npb24gZm9yIG9wZXJhdGlvblxuICAgIC8vIElmIHRoZSBCYXNlQ0xQIHBhc3MsIGxldCBnbyB0aHJvdWdoXG4gICAgaWYgKHNjaGVtYS50ZXN0UGVybWlzc2lvbnNGb3JDbGFzc05hbWUoY2xhc3NOYW1lLCBhY2xHcm91cCwgb3BlcmF0aW9uKSkge1xuICAgICAgcmV0dXJuIHF1ZXJ5O1xuICAgIH1cbiAgICBjb25zdCBwZXJtcyA9IHNjaGVtYS5nZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lKTtcblxuICAgIGNvbnN0IHVzZXJBQ0wgPSBhY2xHcm91cC5maWx0ZXIoYWNsID0+IHtcbiAgICAgIHJldHVybiBhY2wuaW5kZXhPZigncm9sZTonKSAhPSAwICYmIGFjbCAhPSAnKic7XG4gICAgfSk7XG5cbiAgICBjb25zdCBncm91cEtleSA9XG4gICAgICBbJ2dldCcsICdmaW5kJywgJ2NvdW50J10uaW5kZXhPZihvcGVyYXRpb24pID4gLTEgPyAncmVhZFVzZXJGaWVsZHMnIDogJ3dyaXRlVXNlckZpZWxkcyc7XG5cbiAgICBjb25zdCBwZXJtRmllbGRzID0gW107XG5cbiAgICBpZiAocGVybXNbb3BlcmF0aW9uXSAmJiBwZXJtc1tvcGVyYXRpb25dLnBvaW50ZXJGaWVsZHMpIHtcbiAgICAgIHBlcm1GaWVsZHMucHVzaCguLi5wZXJtc1tvcGVyYXRpb25dLnBvaW50ZXJGaWVsZHMpO1xuICAgIH1cblxuICAgIGlmIChwZXJtc1tncm91cEtleV0pIHtcbiAgICAgIGZvciAoY29uc3QgZmllbGQgb2YgcGVybXNbZ3JvdXBLZXldKSB7XG4gICAgICAgIGlmICghcGVybUZpZWxkcy5pbmNsdWRlcyhmaWVsZCkpIHtcbiAgICAgICAgICBwZXJtRmllbGRzLnB1c2goZmllbGQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIC8vIHRoZSBBQ0wgc2hvdWxkIGhhdmUgZXhhY3RseSAxIHVzZXJcbiAgICBpZiAocGVybUZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAvLyB0aGUgQUNMIHNob3VsZCBoYXZlIGV4YWN0bHkgMSB1c2VyXG4gICAgICAvLyBObyB1c2VyIHNldCByZXR1cm4gdW5kZWZpbmVkXG4gICAgICAvLyBJZiB0aGUgbGVuZ3RoIGlzID4gMSwgdGhhdCBtZWFucyB3ZSBkaWRuJ3QgZGUtZHVwZSB1c2VycyBjb3JyZWN0bHlcbiAgICAgIGlmICh1c2VyQUNMLmxlbmd0aCAhPSAxKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHVzZXJJZCA9IHVzZXJBQ0xbMF07XG4gICAgICBjb25zdCB1c2VyUG9pbnRlciA9IHtcbiAgICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICAgIGNsYXNzTmFtZTogJ19Vc2VyJyxcbiAgICAgICAgb2JqZWN0SWQ6IHVzZXJJZCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHF1ZXJpZXMgPSBwZXJtRmllbGRzLm1hcChrZXkgPT4ge1xuICAgICAgICBjb25zdCBmaWVsZERlc2NyaXB0b3IgPSBzY2hlbWEuZ2V0RXhwZWN0ZWRUeXBlKGNsYXNzTmFtZSwga2V5KTtcbiAgICAgICAgY29uc3QgZmllbGRUeXBlID1cbiAgICAgICAgICBmaWVsZERlc2NyaXB0b3IgJiZcbiAgICAgICAgICB0eXBlb2YgZmllbGREZXNjcmlwdG9yID09PSAnb2JqZWN0JyAmJlxuICAgICAgICAgIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmaWVsZERlc2NyaXB0b3IsICd0eXBlJylcbiAgICAgICAgICAgID8gZmllbGREZXNjcmlwdG9yLnR5cGVcbiAgICAgICAgICAgIDogbnVsbDtcblxuICAgICAgICBsZXQgcXVlcnlDbGF1c2U7XG5cbiAgICAgICAgaWYgKGZpZWxkVHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICAgICAgLy8gY29uc3RyYWludCBmb3Igc2luZ2xlIHBvaW50ZXIgc2V0dXBcbiAgICAgICAgICBxdWVyeUNsYXVzZSA9IHsgW2tleV06IHVzZXJQb2ludGVyIH07XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGRUeXBlID09PSAnQXJyYXknKSB7XG4gICAgICAgICAgLy8gY29uc3RyYWludCBmb3IgdXNlcnMtYXJyYXkgc2V0dXBcbiAgICAgICAgICBxdWVyeUNsYXVzZSA9IHsgW2tleV06IHsgJGFsbDogW3VzZXJQb2ludGVyXSB9IH07XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGRUeXBlID09PSAnT2JqZWN0Jykge1xuICAgICAgICAgIC8vIGNvbnN0cmFpbnQgZm9yIG9iamVjdCBzZXR1cFxuICAgICAgICAgIHF1ZXJ5Q2xhdXNlID0geyBba2V5XTogdXNlclBvaW50ZXIgfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBUaGlzIG1lYW5zIHRoYXQgdGhlcmUgaXMgYSBDTFAgZmllbGQgb2YgYW4gdW5leHBlY3RlZCB0eXBlLiBUaGlzIGNvbmRpdGlvbiBzaG91bGQgbm90IGhhcHBlbiwgd2hpY2ggaXNcbiAgICAgICAgICAvLyB3aHkgaXMgYmVpbmcgdHJlYXRlZCBhcyBhbiBlcnJvci5cbiAgICAgICAgICB0aHJvdyBFcnJvcihcbiAgICAgICAgICAgIGBBbiB1bmV4cGVjdGVkIGNvbmRpdGlvbiBvY2N1cnJlZCB3aGVuIHJlc29sdmluZyBwb2ludGVyIHBlcm1pc3Npb25zOiAke2NsYXNzTmFtZX0gJHtrZXl9YFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gaWYgd2UgYWxyZWFkeSBoYXZlIGEgY29uc3RyYWludCBvbiB0aGUga2V5LCB1c2UgdGhlICRhbmRcbiAgICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChxdWVyeSwga2V5KSkge1xuICAgICAgICAgIHJldHVybiB0aGlzLnJlZHVjZUFuZE9wZXJhdGlvbih7ICRhbmQ6IFtxdWVyeUNsYXVzZSwgcXVlcnldIH0pO1xuICAgICAgICB9XG4gICAgICAgIC8vIG90aGVyd2lzZSBqdXN0IGFkZCB0aGUgY29uc3RhaW50XG4gICAgICAgIHJldHVybiBPYmplY3QuYXNzaWduKHt9LCBxdWVyeSwgcXVlcnlDbGF1c2UpO1xuICAgICAgfSk7XG5cbiAgICAgIHJldHVybiBxdWVyaWVzLmxlbmd0aCA9PT0gMSA/IHF1ZXJpZXNbMF0gOiB0aGlzLnJlZHVjZU9yT3BlcmF0aW9uKHsgJG9yOiBxdWVyaWVzIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gcXVlcnk7XG4gICAgfVxuICB9XG5cbiAgYWRkUHJvdGVjdGVkRmllbGRzKFxuICAgIHNjaGVtYTogU2NoZW1hQ29udHJvbGxlci5TY2hlbWFDb250cm9sbGVyIHwgYW55LFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHF1ZXJ5OiBhbnkgPSB7fSxcbiAgICBhY2xHcm91cDogYW55W10gPSBbXSxcbiAgICBhdXRoOiBhbnkgPSB7fSxcbiAgICBxdWVyeU9wdGlvbnM6IEZ1bGxRdWVyeU9wdGlvbnMgPSB7fVxuICApOiBudWxsIHwgc3RyaW5nW10ge1xuICAgIGNvbnN0IHBlcm1zID1cbiAgICAgIHNjaGVtYSAmJiBzY2hlbWEuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zXG4gICAgICAgID8gc2NoZW1hLmdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWUpXG4gICAgICAgIDogc2NoZW1hO1xuICAgIGlmICghcGVybXMpIHsgcmV0dXJuIG51bGw7IH1cblxuICAgIGNvbnN0IHByb3RlY3RlZEZpZWxkcyA9IHBlcm1zLnByb3RlY3RlZEZpZWxkcztcbiAgICBpZiAoIXByb3RlY3RlZEZpZWxkcykgeyByZXR1cm4gbnVsbDsgfVxuXG4gICAgaWYgKGNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJiB0aGlzLm9wdGlvbnMucHJvdGVjdGVkRmllbGRzT3duZXJFeGVtcHQgIT09IGZhbHNlICYmIGFjbEdyb3VwLmluZGV4T2YocXVlcnkub2JqZWN0SWQpID4gLTEpIHsgcmV0dXJuIG51bGw7IH1cblxuICAgIC8vIGZvciBxdWVyaWVzIHdoZXJlIFwia2V5c1wiIGFyZSBzZXQgYW5kIGRvIG5vdCBpbmNsdWRlIGFsbCAndXNlckZpZWxkJzp7ZmllbGR9LFxuICAgIC8vIHdlIGhhdmUgdG8gdHJhbnNwYXJlbnRseSBpbmNsdWRlIGl0LCBhbmQgdGhlbiByZW1vdmUgYmVmb3JlIHJldHVybmluZyB0byBjbGllbnRcbiAgICAvLyBCZWNhdXNlIGlmIHN1Y2gga2V5IG5vdCBwcm9qZWN0ZWQgdGhlIHBlcm1pc3Npb24gd29uJ3QgYmUgZW5mb3JjZWQgcHJvcGVybHlcbiAgICAvLyBQUyB0aGlzIGlzIGNhbGxlZCB3aGVuICdleGNsdWRlS2V5cycgYWxyZWFkeSByZWR1Y2VkIHRvICdrZXlzJ1xuICAgIGNvbnN0IHByZXNlcnZlS2V5cyA9IHF1ZXJ5T3B0aW9ucy5rZXlzO1xuXG4gICAgLy8gdGhlc2UgYXJlIGtleXMgdGhhdCBuZWVkIHRvIGJlIGluY2x1ZGVkIG9ubHlcbiAgICAvLyB0byBiZSBhYmxlIHRvIGFwcGx5IHByb3RlY3RlZEZpZWxkcyBieSBwb2ludGVyXG4gICAgLy8gYW5kIHRoZW4gdW5zZXQgYmVmb3JlIHJldHVybmluZyB0byBjbGllbnQgKGxhdGVyIGluICBmaWx0ZXJTZW5zaXRpdmVGaWVsZHMpXG4gICAgY29uc3Qgc2VydmVyT25seUtleXMgPSBbXTtcblxuICAgIGNvbnN0IGF1dGhlbnRpY2F0ZWQgPSBhdXRoLnVzZXI7XG5cbiAgICAvLyBtYXAgdG8gYWxsb3cgY2hlY2sgd2l0aG91dCBhcnJheSBzZWFyY2hcbiAgICBjb25zdCByb2xlcyA9IChhdXRoLnVzZXJSb2xlcyB8fCBbXSkucmVkdWNlKChhY2MsIHIpID0+IHtcbiAgICAgIGFjY1tyXSA9IHByb3RlY3RlZEZpZWxkc1tyXTtcbiAgICAgIHJldHVybiBhY2M7XG4gICAgfSwge30pO1xuXG4gICAgLy8gYXJyYXkgb2Ygc2V0cyBvZiBwcm90ZWN0ZWQgZmllbGRzLiBzZXBhcmF0ZSBpdGVtIGZvciBlYWNoIGFwcGxpY2FibGUgY3JpdGVyaWFcbiAgICBjb25zdCBwcm90ZWN0ZWRLZXlzU2V0cyA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBrZXkgaW4gcHJvdGVjdGVkRmllbGRzKSB7XG4gICAgICAvLyBza2lwIHVzZXJGaWVsZHNcbiAgICAgIGlmIChrZXkuc3RhcnRzV2l0aCgndXNlckZpZWxkOicpKSB7XG4gICAgICAgIGlmIChwcmVzZXJ2ZUtleXMpIHtcbiAgICAgICAgICBjb25zdCBmaWVsZE5hbWUgPSBrZXkuc3Vic3RyaW5nKDEwKTtcbiAgICAgICAgICBpZiAoIXByZXNlcnZlS2V5cy5pbmNsdWRlcyhmaWVsZE5hbWUpKSB7XG4gICAgICAgICAgICAvLyAxLiBwdXQgaXQgdGhlcmUgdGVtcG9yYXJpbHlcbiAgICAgICAgICAgIHF1ZXJ5T3B0aW9ucy5rZXlzICYmIHF1ZXJ5T3B0aW9ucy5rZXlzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICAgIC8vIDIuIHByZXNlcnZlIGl0IGRlbGV0ZSBsYXRlclxuICAgICAgICAgICAgc2VydmVyT25seUtleXMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gYWRkIHB1YmxpYyB0aWVyXG4gICAgICBpZiAoa2V5ID09PSAnKicpIHtcbiAgICAgICAgcHJvdGVjdGVkS2V5c1NldHMucHVzaChwcm90ZWN0ZWRGaWVsZHNba2V5XSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoYXV0aGVudGljYXRlZCkge1xuICAgICAgICBpZiAoa2V5ID09PSAnYXV0aGVudGljYXRlZCcpIHtcbiAgICAgICAgICAvLyBmb3IgbG9nZ2VkIGluIHVzZXJzXG4gICAgICAgICAgcHJvdGVjdGVkS2V5c1NldHMucHVzaChwcm90ZWN0ZWRGaWVsZHNba2V5XSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocm9sZXNba2V5XSAmJiBrZXkuc3RhcnRzV2l0aCgncm9sZTonKSkge1xuICAgICAgICAgIC8vIGFkZCBhcHBsaWNhYmxlIHJvbGVzXG4gICAgICAgICAgcHJvdGVjdGVkS2V5c1NldHMucHVzaChyb2xlc1trZXldKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGNoZWNrIGlmIHRoZXJlJ3MgYSBydWxlIGZvciBjdXJyZW50IHVzZXIncyBpZFxuICAgIGlmIChhdXRoZW50aWNhdGVkKSB7XG4gICAgICBjb25zdCB1c2VySWQgPSBhdXRoLnVzZXIuaWQ7XG4gICAgICBpZiAocGVybXMucHJvdGVjdGVkRmllbGRzW3VzZXJJZF0pIHtcbiAgICAgICAgcHJvdGVjdGVkS2V5c1NldHMucHVzaChwZXJtcy5wcm90ZWN0ZWRGaWVsZHNbdXNlcklkXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gcHJlc2VydmUgZmllbGRzIHRvIGJlIHJlbW92ZWQgYmVmb3JlIHNlbmRpbmcgcmVzcG9uc2UgdG8gY2xpZW50XG4gICAgaWYgKHNlcnZlck9ubHlLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHBlcm1zLnByb3RlY3RlZEZpZWxkcy50ZW1wb3JhcnlLZXlzID0gc2VydmVyT25seUtleXM7XG4gICAgfVxuXG4gICAgbGV0IHByb3RlY3RlZEtleXMgPSBwcm90ZWN0ZWRLZXlzU2V0cy5yZWR1Y2UoKGFjYywgbmV4dCkgPT4ge1xuICAgICAgaWYgKG5leHQpIHtcbiAgICAgICAgYWNjLnB1c2goLi4ubmV4dCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gYWNjO1xuICAgIH0sIFtdKTtcblxuICAgIC8vIGludGVyc2VjdCBhbGwgc2V0cyBvZiBwcm90ZWN0ZWRGaWVsZHNcbiAgICBwcm90ZWN0ZWRLZXlzU2V0cy5mb3JFYWNoKGZpZWxkcyA9PiB7XG4gICAgICBpZiAoZmllbGRzKSB7XG4gICAgICAgIHByb3RlY3RlZEtleXMgPSBwcm90ZWN0ZWRLZXlzLmZpbHRlcih2ID0+IGZpZWxkcy5pbmNsdWRlcyh2KSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcHJvdGVjdGVkS2V5cztcbiAgfVxuXG4gIGNyZWF0ZVRyYW5zYWN0aW9uYWxTZXNzaW9uKCkge1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuY3JlYXRlVHJhbnNhY3Rpb25hbFNlc3Npb24oKS50aGVuKHRyYW5zYWN0aW9uYWxTZXNzaW9uID0+IHtcbiAgICAgIHRoaXMuX3RyYW5zYWN0aW9uYWxTZXNzaW9uID0gdHJhbnNhY3Rpb25hbFNlc3Npb247XG4gICAgfSk7XG4gIH1cblxuICBjb21taXRUcmFuc2FjdGlvbmFsU2Vzc2lvbigpIHtcbiAgICBpZiAoIXRoaXMuX3RyYW5zYWN0aW9uYWxTZXNzaW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZXJlIGlzIG5vIHRyYW5zYWN0aW9uYWwgc2Vzc2lvbiB0byBjb21taXQnKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5jb21taXRUcmFuc2FjdGlvbmFsU2Vzc2lvbih0aGlzLl90cmFuc2FjdGlvbmFsU2Vzc2lvbikudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLl90cmFuc2FjdGlvbmFsU2Vzc2lvbiA9IG51bGw7XG4gICAgfSk7XG4gIH1cblxuICBhYm9ydFRyYW5zYWN0aW9uYWxTZXNzaW9uKCkge1xuICAgIGlmICghdGhpcy5fdHJhbnNhY3Rpb25hbFNlc3Npb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVGhlcmUgaXMgbm8gdHJhbnNhY3Rpb25hbCBzZXNzaW9uIHRvIGFib3J0Jyk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuYWJvcnRUcmFuc2FjdGlvbmFsU2Vzc2lvbih0aGlzLl90cmFuc2FjdGlvbmFsU2Vzc2lvbikudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLl90cmFuc2FjdGlvbmFsU2Vzc2lvbiA9IG51bGw7XG4gICAgfSk7XG4gIH1cblxuICAvLyBUT0RPOiBjcmVhdGUgaW5kZXhlcyBvbiBmaXJzdCBjcmVhdGlvbiBvZiBhIF9Vc2VyIG9iamVjdC4gT3RoZXJ3aXNlIGl0J3MgaW1wb3NzaWJsZSB0b1xuICAvLyBoYXZlIGEgUGFyc2UgYXBwIHdpdGhvdXQgaXQgaGF2aW5nIGEgX1VzZXIgY29sbGVjdGlvbi5cbiAgYXN5bmMgcGVyZm9ybUluaXRpYWxpemF0aW9uKCkge1xuICAgIGF3YWl0IHRoaXMuYWRhcHRlci5wZXJmb3JtSW5pdGlhbGl6YXRpb24oe1xuICAgICAgVm9sYXRpbGVDbGFzc2VzU2NoZW1hczogU2NoZW1hQ29udHJvbGxlci5Wb2xhdGlsZUNsYXNzZXNTY2hlbWFzLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlcXVpcmVkVXNlckZpZWxkcyA9IHtcbiAgICAgIGZpZWxkczoge1xuICAgICAgICAuLi5TY2hlbWFDb250cm9sbGVyLmRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0LFxuICAgICAgICAuLi5TY2hlbWFDb250cm9sbGVyLmRlZmF1bHRDb2x1bW5zLl9Vc2VyLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGNvbnN0IHJlcXVpcmVkUm9sZUZpZWxkcyA9IHtcbiAgICAgIGZpZWxkczoge1xuICAgICAgICAuLi5TY2hlbWFDb250cm9sbGVyLmRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0LFxuICAgICAgICAuLi5TY2hlbWFDb250cm9sbGVyLmRlZmF1bHRDb2x1bW5zLl9Sb2xlLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGNvbnN0IHJlcXVpcmVkSWRlbXBvdGVuY3lGaWVsZHMgPSB7XG4gICAgICBmaWVsZHM6IHtcbiAgICAgICAgLi4uU2NoZW1hQ29udHJvbGxlci5kZWZhdWx0Q29sdW1ucy5fRGVmYXVsdCxcbiAgICAgICAgLi4uU2NoZW1hQ29udHJvbGxlci5kZWZhdWx0Q29sdW1ucy5fSWRlbXBvdGVuY3ksXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgdGhpcy5sb2FkU2NoZW1hKCkudGhlbihzY2hlbWEgPT4gc2NoZW1hLmVuZm9yY2VDbGFzc0V4aXN0cygnX1VzZXInKSk7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2NoZW1hKCkudGhlbihzY2hlbWEgPT4gc2NoZW1hLmVuZm9yY2VDbGFzc0V4aXN0cygnX1JvbGUnKSk7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2NoZW1hKCkudGhlbihzY2hlbWEgPT4gc2NoZW1hLmVuZm9yY2VDbGFzc0V4aXN0cygnX0lkZW1wb3RlbmN5JykpO1xuXG4gICAgY29uc3QgZGF0YWJhc2VPcHRpb25zID0gdGhpcy5vcHRpb25zLmRhdGFiYXNlT3B0aW9ucyB8fCB7fTtcblxuICAgIGlmIChkYXRhYmFzZU9wdGlvbnMuY3JlYXRlSW5kZXhVc2VyVXNlcm5hbWUgIT09IGZhbHNlKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuZW5zdXJlVW5pcXVlbmVzcygnX1VzZXInLCByZXF1aXJlZFVzZXJGaWVsZHMsIFsndXNlcm5hbWUnXSkuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBsb2dnZXIud2FybignVW5hYmxlIHRvIGVuc3VyZSB1bmlxdWVuZXNzIGZvciB1c2VybmFtZXM6ICcsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMub3B0aW9ucy5lbmFibGVDb2xsYXRpb25DYXNlQ29tcGFyaXNvbikge1xuICAgICAgaWYgKGRhdGFiYXNlT3B0aW9ucy5jcmVhdGVJbmRleFVzZXJVc2VybmFtZUNhc2VJbnNlbnNpdGl2ZSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyXG4gICAgICAgICAgLmVuc3VyZUluZGV4KCdfVXNlcicsIHJlcXVpcmVkVXNlckZpZWxkcywgWyd1c2VybmFtZSddLCAnY2FzZV9pbnNlbnNpdGl2ZV91c2VybmFtZScsIHRydWUpXG4gICAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICAgIGxvZ2dlci53YXJuKCdVbmFibGUgdG8gY3JlYXRlIGNhc2UgaW5zZW5zaXRpdmUgdXNlcm5hbWUgaW5kZXg6ICcsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGF0YWJhc2VPcHRpb25zLmNyZWF0ZUluZGV4VXNlckVtYWlsQ2FzZUluc2Vuc2l0aXZlICE9PSBmYWxzZSkge1xuICAgICAgICBhd2FpdCB0aGlzLmFkYXB0ZXJcbiAgICAgICAgICAuZW5zdXJlSW5kZXgoJ19Vc2VyJywgcmVxdWlyZWRVc2VyRmllbGRzLCBbJ2VtYWlsJ10sICdjYXNlX2luc2Vuc2l0aXZlX2VtYWlsJywgdHJ1ZSlcbiAgICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgbG9nZ2VyLndhcm4oJ1VuYWJsZSB0byBjcmVhdGUgY2FzZSBpbnNlbnNpdGl2ZSBlbWFpbCBpbmRleDogJywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGRhdGFiYXNlT3B0aW9ucy5jcmVhdGVJbmRleFVzZXJFbWFpbCAhPT0gZmFsc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5lbnN1cmVVbmlxdWVuZXNzKCdfVXNlcicsIHJlcXVpcmVkVXNlckZpZWxkcywgWydlbWFpbCddKS5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIHVzZXIgZW1haWwgYWRkcmVzc2VzOiAnLCBlcnJvcik7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGRhdGFiYXNlT3B0aW9ucy5jcmVhdGVJbmRleFVzZXJFbWFpbFZlcmlmeVRva2VuICE9PSBmYWxzZSkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyXG4gICAgICAgIC5lbnN1cmVJbmRleCgnX1VzZXInLCByZXF1aXJlZFVzZXJGaWVsZHMsIFsnX2VtYWlsX3ZlcmlmeV90b2tlbiddLCAnX2VtYWlsX3ZlcmlmeV90b2tlbicsIGZhbHNlKVxuICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgIGxvZ2dlci53YXJuKCdVbmFibGUgdG8gY3JlYXRlIGluZGV4IGZvciBlbWFpbCB2ZXJpZmljYXRpb24gdG9rZW46ICcsIGVycm9yKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGRhdGFiYXNlT3B0aW9ucy5jcmVhdGVJbmRleFVzZXJQYXNzd29yZFJlc2V0VG9rZW4gIT09IGZhbHNlKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXJcbiAgICAgICAgLmVuc3VyZUluZGV4KCdfVXNlcicsIHJlcXVpcmVkVXNlckZpZWxkcywgWydfcGVyaXNoYWJsZV90b2tlbiddLCAnX3BlcmlzaGFibGVfdG9rZW4nLCBmYWxzZSlcbiAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICBsb2dnZXIud2FybignVW5hYmxlIHRvIGNyZWF0ZSBpbmRleCBmb3IgcGFzc3dvcmQgcmVzZXQgdG9rZW46ICcsIGVycm9yKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGRhdGFiYXNlT3B0aW9ucy5jcmVhdGVJbmRleFJvbGVOYW1lICE9PSBmYWxzZSkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLmVuc3VyZVVuaXF1ZW5lc3MoJ19Sb2xlJywgcmVxdWlyZWRSb2xlRmllbGRzLCBbJ25hbWUnXSkuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBsb2dnZXIud2FybignVW5hYmxlIHRvIGVuc3VyZSB1bmlxdWVuZXNzIGZvciByb2xlIG5hbWU6ICcsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFkYXB0ZXJcbiAgICAgIC5lbnN1cmVVbmlxdWVuZXNzKCdfSWRlbXBvdGVuY3knLCByZXF1aXJlZElkZW1wb3RlbmN5RmllbGRzLCBbJ3JlcUlkJ10pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBsb2dnZXIud2FybignVW5hYmxlIHRvIGVuc3VyZSB1bmlxdWVuZXNzIGZvciBpZGVtcG90ZW5jeSByZXF1ZXN0IElEOiAnLCBlcnJvcik7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSk7XG5cbiAgICBjb25zdCBpc01vbmdvQWRhcHRlciA9IHRoaXMuYWRhcHRlciBpbnN0YW5jZW9mIE1vbmdvU3RvcmFnZUFkYXB0ZXI7XG4gICAgY29uc3QgaXNQb3N0Z3Jlc0FkYXB0ZXIgPSB0aGlzLmFkYXB0ZXIgaW5zdGFuY2VvZiBQb3N0Z3Jlc1N0b3JhZ2VBZGFwdGVyO1xuICAgIGlmIChpc01vbmdvQWRhcHRlciB8fCBpc1Bvc3RncmVzQWRhcHRlcikge1xuICAgICAgbGV0IG9wdGlvbnMgPSB7fTtcbiAgICAgIGlmIChpc01vbmdvQWRhcHRlcikge1xuICAgICAgICBvcHRpb25zID0ge1xuICAgICAgICAgIHR0bDogMCxcbiAgICAgICAgfTtcbiAgICAgIH0gZWxzZSBpZiAoaXNQb3N0Z3Jlc0FkYXB0ZXIpIHtcbiAgICAgICAgb3B0aW9ucyA9IHRoaXMuaWRlbXBvdGVuY3lPcHRpb25zO1xuICAgICAgICBvcHRpb25zLnNldElkZW1wb3RlbmN5RnVuY3Rpb24gPSB0cnVlO1xuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyXG4gICAgICAgIC5lbnN1cmVJbmRleCgnX0lkZW1wb3RlbmN5JywgcmVxdWlyZWRJZGVtcG90ZW5jeUZpZWxkcywgWydleHBpcmUnXSwgJ3R0bCcsIGZhbHNlLCBvcHRpb25zKVxuICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgIGxvZ2dlci53YXJuKCdVbmFibGUgdG8gY3JlYXRlIFRUTCBpbmRleCBmb3IgaWRlbXBvdGVuY3kgZXhwaXJlIGRhdGU6ICcsIGVycm9yKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIC8vIENyZWF0ZSB1bmlxdWUgaW5kZXhlcyBmb3IgYXV0aERhdGEgcHJvdmlkZXJzIHRvIHByZXZlbnQgcmFjZSBjb25kaXRpb25zXG4gICAgLy8gZHVyaW5nIGNvbmN1cnJlbnQgc2lnbnVwcyB3aXRoIHRoZSBzYW1lIGF1dGhEYXRhXG4gICAgaWYgKFxuICAgICAgZGF0YWJhc2VPcHRpb25zLmNyZWF0ZUluZGV4QXV0aERhdGFVbmlxdWVuZXNzICE9PSBmYWxzZSAmJlxuICAgICAgdHlwZW9mIHRoaXMuYWRhcHRlci5lbnN1cmVBdXRoRGF0YVVuaXF1ZW5lc3MgPT09ICdmdW5jdGlvbidcbiAgICApIHtcbiAgICAgIGNvbnN0IGF1dGhQcm92aWRlcnMgPSBPYmplY3Qua2V5cyh0aGlzLm9wdGlvbnMuYXV0aCB8fCB7fSk7XG4gICAgICBpZiAodGhpcy5vcHRpb25zLmVuYWJsZUFub255bW91c1VzZXJzICE9PSBmYWxzZSkge1xuICAgICAgICBpZiAoIWF1dGhQcm92aWRlcnMuaW5jbHVkZXMoJ2Fub255bW91cycpKSB7XG4gICAgICAgICAgYXV0aFByb3ZpZGVycy5wdXNoKCdhbm9ueW1vdXMnKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIGF1dGhQcm92aWRlcnMubWFwKHByb3ZpZGVyID0+XG4gICAgICAgICAgdGhpcy5hZGFwdGVyLmVuc3VyZUF1dGhEYXRhVW5pcXVlbmVzcyhwcm92aWRlcikuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgbG9nZ2VyLndhcm4oXG4gICAgICAgICAgICAgIGBVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIGF1dGggZGF0YSBwcm92aWRlciBcIiR7cHJvdmlkZXJ9XCI6IGAsXG4gICAgICAgICAgICAgIGVycm9yXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5hZGFwdGVyLnVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzKCk7XG4gIH1cblxuICBfZXhwYW5kUmVzdWx0T25LZXlQYXRoKG9iamVjdDogYW55LCBrZXk6IHN0cmluZywgdmFsdWU6IGFueSk6IGFueSB7XG4gICAgaWYgKGtleS5pbmRleE9mKCcuJykgPCAwKSB7XG4gICAgICBvYmplY3Rba2V5XSA9IHZhbHVlW2tleV07XG4gICAgICByZXR1cm4gb2JqZWN0O1xuICAgIH1cbiAgICBjb25zdCBwYXRoID0ga2V5LnNwbGl0KCcuJyk7XG4gICAgY29uc3QgZmlyc3RLZXkgPSBwYXRoWzBdO1xuICAgIGNvbnN0IG5leHRQYXRoID0gcGF0aC5zbGljZSgxKS5qb2luKCcuJyk7XG5cbiAgICAvLyBTY2FuIHJlcXVlc3QgZGF0YSBmb3IgZGVuaWVkIGtleXdvcmRzXG4gICAgaWYgKHRoaXMub3B0aW9ucyAmJiB0aGlzLm9wdGlvbnMucmVxdWVzdEtleXdvcmREZW55bGlzdCkge1xuICAgICAgLy8gU2NhbiByZXF1ZXN0IGRhdGEgZm9yIGRlbmllZCBrZXl3b3Jkc1xuICAgICAgZm9yIChjb25zdCBrZXl3b3JkIG9mIHRoaXMub3B0aW9ucy5yZXF1ZXN0S2V5d29yZERlbnlsaXN0KSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gVXRpbHMub2JqZWN0Q29udGFpbnNLZXlWYWx1ZShcbiAgICAgICAgICB7IFtmaXJzdEtleV06IHRydWUsIFtuZXh0UGF0aF06IHRydWUgfSxcbiAgICAgICAgICBrZXl3b3JkLmtleSxcbiAgICAgICAgICB0cnVlXG4gICAgICAgICk7XG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsXG4gICAgICAgICAgICBgUHJvaGliaXRlZCBrZXl3b3JkIGluIHJlcXVlc3QgZGF0YTogJHtKU09OLnN0cmluZ2lmeShrZXl3b3JkKX0uYFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBvYmplY3RbZmlyc3RLZXldID0gdGhpcy5fZXhwYW5kUmVzdWx0T25LZXlQYXRoKFxuICAgICAgb2JqZWN0W2ZpcnN0S2V5XSB8fCB7fSxcbiAgICAgIG5leHRQYXRoLFxuICAgICAgdmFsdWVbZmlyc3RLZXldXG4gICAgKTtcbiAgICBkZWxldGUgb2JqZWN0W2tleV07XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuXG4gIF9zYW5pdGl6ZURhdGFiYXNlUmVzdWx0KG9yaWdpbmFsT2JqZWN0OiBhbnksIHJlc3VsdDogYW55KTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IHt9O1xuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3BvbnNlKTtcbiAgICB9XG4gICAgT2JqZWN0LmtleXMob3JpZ2luYWxPYmplY3QpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIGNvbnN0IGtleVVwZGF0ZSA9IG9yaWdpbmFsT2JqZWN0W2tleV07XG4gICAgICAvLyBkZXRlcm1pbmUgaWYgdGhhdCB3YXMgYW4gb3BcbiAgICAgIGlmIChcbiAgICAgICAga2V5VXBkYXRlICYmXG4gICAgICAgIHR5cGVvZiBrZXlVcGRhdGUgPT09ICdvYmplY3QnICYmXG4gICAgICAgIGtleVVwZGF0ZS5fX29wICYmXG4gICAgICAgIFsnQWRkJywgJ0FkZFVuaXF1ZScsICdSZW1vdmUnLCAnSW5jcmVtZW50JywgJ1NldE9uSW5zZXJ0J10uaW5kZXhPZihrZXlVcGRhdGUuX19vcCkgPiAtMVxuICAgICAgKSB7XG4gICAgICAgIC8vIG9ubHkgdmFsaWQgb3BzIHRoYXQgcHJvZHVjZSBhbiBhY3Rpb25hYmxlIHJlc3VsdFxuICAgICAgICAvLyB0aGUgb3AgbWF5IGhhdmUgaGFwcGVuZWQgb24gYSBrZXlwYXRoXG4gICAgICAgIHRoaXMuX2V4cGFuZFJlc3VsdE9uS2V5UGF0aChyZXNwb25zZSwga2V5LCByZXN1bHQpO1xuICAgICAgICAvLyBSZXZlcnQgYXJyYXkgdG8gb2JqZWN0IGNvbnZlcnNpb24gb24gZG90IG5vdGF0aW9uIGZvciBhcnJheXMgKGUuZy4gXCJmaWVsZC4wLmtleVwiKVxuICAgICAgICBpZiAoa2V5LmluY2x1ZGVzKCcuJykpIHtcbiAgICAgICAgICBjb25zdCBbZmllbGQsIGluZGV4XSA9IGtleS5zcGxpdCgnLicpO1xuICAgICAgICAgIGNvbnN0IGlzQXJyYXlJbmRleCA9IEFycmF5LmZyb20oaW5kZXgpLmV2ZXJ5KGMgPT4gYyA+PSAnMCcgJiYgYyA8PSAnOScpO1xuICAgICAgICAgIGlmIChpc0FycmF5SW5kZXggJiYgQXJyYXkuaXNBcnJheShyZXN1bHRbZmllbGRdKSAmJiAhQXJyYXkuaXNBcnJheShyZXNwb25zZVtmaWVsZF0pKSB7XG4gICAgICAgICAgICByZXNwb25zZVtmaWVsZF0gPSByZXN1bHRbZmllbGRdO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzcG9uc2UpO1xuICB9XG5cbiAgc3RhdGljIF92YWxpZGF0ZVF1ZXJ5OiAoYW55LCBib29sZWFuLCBib29sZWFuLCBib29sZWFuKSA9PiB2b2lkO1xuICBzdGF0aWMgZmlsdGVyU2Vuc2l0aXZlRGF0YTogKGJvb2xlYW4sIGJvb2xlYW4sIGFueVtdLCBhbnksIGFueSwgYW55LCBzdHJpbmcsIGFueVtdLCBhbnksID9ib29sZWFuKSA9PiB2b2lkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IERhdGFiYXNlQ29udHJvbGxlcjtcbi8vIEV4cG9zZSB2YWxpZGF0ZVF1ZXJ5IGZvciB0ZXN0c1xubW9kdWxlLmV4cG9ydHMuX3ZhbGlkYXRlUXVlcnkgPSB2YWxpZGF0ZVF1ZXJ5O1xubW9kdWxlLmV4cG9ydHMuZmlsdGVyU2Vuc2l0aXZlRGF0YSA9IGZpbHRlclNlbnNpdGl2ZURhdGE7XG4iXSwibWFwcGluZ3MiOiI7O0FBS0EsSUFBQUEsS0FBQSxHQUFBQyxPQUFBO0FBRUEsSUFBQUMsT0FBQSxHQUFBQyxzQkFBQSxDQUFBRixPQUFBO0FBRUEs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