"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.MongoStorageAdapter = void 0;
var _mongodbUrl = require("../../../vendor/mongodbUrl");
var _StorageAdapter = require("../StorageAdapter");
var _Utils = _interopRequireDefault(require("../../../Utils"));
var _MongoCollection = _interopRequireDefault(require("./MongoCollection"));
var _MongoSchemaCollection = _interopRequireDefault(require("./MongoSchemaCollection"));
var _MongoTransform = require("./MongoTransform");
var _node = _interopRequireDefault(require("parse/node"));
var _lodash = _interopRequireDefault(require("lodash"));
var _bson = require("bson");
var _defaults = _interopRequireWildcard(require("../../../defaults"));
var _logger = _interopRequireDefault(require("../../../logger"));
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// -disable-next
// -disable-next
// -disable-next
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const ReadPreference = mongodb.ReadPreference;
const MongoSchemaCollectionName = '_SCHEMA';

/**
 * Determines if a MongoDB error is a transient infrastructure error
 * (connection pool, network, server selection) as opposed to a query-level error.
 */
function isTransientError(error) {
  if (!error) {
    return false;
  }

  // Connection pool, network, and server selection errors
  const transientErrorNames = ['MongoWaitQueueTimeoutError', 'MongoServerSelectionError', 'MongoNetworkTimeoutError', 'MongoNetworkError'];
  if (transientErrorNames.includes(error.name)) {
    return true;
  }

  // Check for MongoDB's transient transaction error label
  if (typeof error.hasErrorLabel === 'function') {
    if (error.hasErrorLabel('TransientTransactionError')) {
      return true;
    }
  }
  return false;
}
const storageAdapterAllCollections = mongoAdapter => {
  return mongoAdapter.connect().then(() => mongoAdapter.database.collections()).then(collections => {
    return collections.filter(collection => {
      if (collection.namespace.match(/\.system\./)) {
        return false;
      }
      // TODO: If you have one app with a collection prefix that happens to be a prefix of another
      // apps prefix, this will go very very badly. We should fix that somehow.
      return collection.collectionName.indexOf(mongoAdapter._collectionPrefix) == 0;
    });
  });
};
const convertParseSchemaToMongoSchema = ({
  ...schema
}) => {
  delete schema.fields._rperm;
  delete schema.fields._wperm;
  if (schema.className === '_User') {
    // Legacy mongo adapter knows about the difference between password and _hashed_password.
    // Future database adapters will only know about _hashed_password.
    // Note: Parse Server will bring back password with injectDefaultSchema, so we don't need
    // to add _hashed_password back ever.
    delete schema.fields._hashed_password;
  }
  return schema;
};

// Returns { code, error } if invalid, or { result }, an object
// suitable for inserting into _SCHEMA collection, otherwise.
const mongoSchemaFromFieldsAndClassNameAndCLP = (fields, className, classLevelPermissions, indexes) => {
  const mongoObject = {
    _id: className,
    objectId: 'string',
    updatedAt: 'string',
    createdAt: 'string',
    _metadata: undefined
  };
  for (const fieldName in fields) {
    const {
      type,
      targetClass,
      ...fieldOptions
    } = fields[fieldName];
    mongoObject[fieldName] = _MongoSchemaCollection.default.parseFieldTypeToMongoFieldType({
      type,
      targetClass
    });
    if (fieldOptions && Object.keys(fieldOptions).length > 0) {
      mongoObject._metadata = mongoObject._metadata || {};
      mongoObject._metadata.fields_options = mongoObject._metadata.fields_options || {};
      mongoObject._metadata.fields_options[fieldName] = fieldOptions;
    }
  }
  if (typeof classLevelPermissions !== 'undefined') {
    mongoObject._metadata = mongoObject._metadata || {};
    if (!classLevelPermissions) {
      delete mongoObject._metadata.class_permissions;
    } else {
      mongoObject._metadata.class_permissions = classLevelPermissions;
    }
  }
  if (indexes && typeof indexes === 'object' && Object.keys(indexes).length > 0) {
    mongoObject._metadata = mongoObject._metadata || {};
    mongoObject._metadata.indexes = indexes;
  }
  if (!mongoObject._metadata) {
    // cleanup the unused _metadata
    delete mongoObject._metadata;
  }
  return mongoObject;
};
function validateExplainValue(explain) {
  if (explain) {
    // The list of allowed explain values is from node-mongodb-native/lib/explain.js
    const explainAllowedValues = ['queryPlanner', 'queryPlannerExtended', 'executionStats', 'allPlansExecution', false, true];
    if (!explainAllowedValues.includes(explain)) {
      throw new _node.default.Error(_node.default.Error.INVALID_QUERY, 'Invalid value for explain');
    }
  }
}
class MongoStorageAdapter {
  // Private

  // Public

  constructor({
    uri = _defaults.default.DefaultMongoURI,
    collectionPrefix = '',
    mongoOptions = {}
  }) {
    this._uri = uri;
    this._collectionPrefix = collectionPrefix;
    this._onchange = () => {};

    // MaxTimeMS is not a global MongoDB client option, it is applied per operation.
    this._maxTimeMS = mongoOptions.maxTimeMS;
    // BatchSize is not a global MongoDB client option, it is applied per cursor operation.
    this._batchSize = mongoOptions.batchSize;
    this.canSortOnJoinTables = true;
    this.enableSchemaHooks = !!mongoOptions.enableSchemaHooks;
    this.schemaCacheTtl = mongoOptions.schemaCacheTtl;
    this.disableIndexFieldValidation = !!mongoOptions.disableIndexFieldValidation;
    this._logClientEvents = mongoOptions.logClientEvents;
    this._clientMetadata = mongoOptions.clientMetadata;

    // Create a copy of mongoOptions and remove Parse Server-specific options that should not
    // be passed to MongoDB client. Note: We only delete from this._mongoOptions, not from the
    // original mongoOptions object, because other components (like DatabaseController) need
    // access to these options.
    this._mongoOptions = {
      ...mongoOptions
    };
    for (const key of _defaults.ParseServerDatabaseOptions) {
      delete this._mongoOptions[key];
    }
  }
  watch(callback) {
    this._onchange = callback;
  }
  connect() {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // parsing and re-formatting causes the auth value (if there) to get URI
    // encoded
    const encodedUri = (0, _mongodbUrl.format)((0, _mongodbUrl.parse)(this._uri));

    // Only use driverInfo if clientMetadata option is set
    const options = {
      ...this._mongoOptions
    };
    if (this._clientMetadata) {
      options.driverInfo = {
        name: this._clientMetadata.name,
        version: this._clientMetadata.version
      };
    }
    this.connectionPromise = MongoClient.connect(encodedUri, options).then(client => {
      // Starting mongoDB 3.0, the MongoClient.connect don't return a DB anymore but a client
      // Fortunately, we can get back the options and use them to select the proper DB.
      // https://github.com/mongodb/node-mongodb-native/blob/2c35d76f08574225b8db02d7bef687123e6bb018/lib/mongo_client.js#L885
      const options = client.s.options;
      const database = client.db(options.dbName);
      if (!database) {
        delete this.connectionPromise;
        return;
      }
      client.on('error', () => {
        delete this.connectionPromise;
      });
      client.on('close', () => {
        delete this.connectionPromise;
      });

      // Set up client event logging if configured
      if (this._logClientEvents && Array.isArray(this._logClientEvents)) {
        this._logClientEvents.forEach(eventConfig => {
          client.on(eventConfig.name, event => {
            let logData = {};
            if (!eventConfig.keys || eventConfig.keys.length === 0) {
              logData = event;
            } else {
              eventConfig.keys.forEach(keyPath => {
                logData[keyPath] = _lodash.default.get(event, keyPath);
              });
            }

            // Validate log level exists, fallback to 'info'
            const logLevel = typeof _logger.default[eventConfig.logLevel] === 'function' ? eventConfig.logLevel : 'info';

            // Safe JSON serialization with Map/Set and circular reference support
            const logMessage = `MongoDB client event ${eventConfig.name}: ${JSON.stringify(logData, _Utils.default.getCircularReplacer())}`;
            _logger.default[logLevel](logMessage);
          });
        });
      }
      this.client = client;
      this.database = database;
    }).catch(err => {
      delete this.connectionPromise;
      return Promise.reject(err);
    });
    return this.connectionPromise;
  }
  handleError(error) {
    if (error && error.code === 13) {
      // Unauthorized error
      delete this.client;
      delete this.database;
      delete this.connectionPromise;
      _logger.default.error('Received unauthorized error', {
        error: error
      });
    }

    // Transform infrastructure/transient errors into Parse.Error.INTERNAL_SERVER_ERROR
    if (isTransientError(error)) {
      _logger.default.error('Database transient error', error);
      throw new _node.default.Error(_node.default.Error.INTERNAL_SERVER_ERROR, 'Database error');
    }
    throw error;
  }
  async handleShutdown() {
    if (!this.client) {
      return;
    }
    await this.client.close(false);
    delete this.connectionPromise;
  }
  _adaptiveCollection(name) {
    return this.connect().then(() => this.database.collection(this._collectionPrefix + name)).then(rawCollection => new _MongoCollection.default(rawCollection)).catch(err => this.handleError(err));
  }
  _schemaCollection() {
    return this.connect().then(() => this._adaptiveCollection(MongoSchemaCollectionName)).then(collection => {
      if (!this._stream && this.enableSchemaHooks) {
        this._stream = collection._mongoCollection.watch();
        this._stream.on('change', () => this._onchange());
      }
      return new _MongoSchemaCollection.default(collection);
    });
  }
  classExists(name) {
    return this.connect().then(() => {
      return this.database.listCollections({
        name: this._collectionPrefix + name
      }).toArray();
    }).then(collections => {
      return collections.length > 0;
    }).catch(err => this.handleError(err));
  }
  setClassLevelPermissions(className, CLPs) {
    return this._schemaCollection().then(schemaCollection => schemaCollection.updateSchema(className, {
      $set: {
        '_metadata.class_permissions': CLPs
      }
    })).catch(err => this.handleError(err));
  }
  setIndexesWithSchemaFormat(className, submittedIndexes, existingIndexes = {}, fields) {
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
    const deletePromises = [];
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
        const promise = this.dropIndex(className, name);
        deletePromises.push(promise);
        delete existingIndexes[name];
      } else {
        Object.keys(field).forEach(key => {
          if (!this.disableIndexFieldValidation && !Object.prototype.hasOwnProperty.call(fields, key.indexOf('_p_') === 0 ? key.replace('_p_', '') : key)) {
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
    let insertPromise = Promise.resolve();
    if (insertedIndexes.length > 0) {
      insertPromise = this.createIndexes(className, insertedIndexes);
    }
    return Promise.all(deletePromises).then(() => insertPromise).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.updateSchema(className, {
      $set: {
        '_metadata.indexes': existingIndexes
      }
    })).catch(err => this.handleError(err));
  }
  setIndexesFromMongo(className) {
    return this.getIndexes(className).then(indexes => {
      indexes = indexes.reduce((obj, index) => {
        if (index.key._fts) {
          delete index.key._fts;
          delete index.key._ftsx;
          for (const field in index.weights) {
            index.key[field] = 'text';
          }
        }
        obj[index.name] = index.key;
        return obj;
      }, {});
      return this._schemaCollection().then(schemaCollection => schemaCollection.updateSchema(className, {
        $set: {
          '_metadata.indexes': indexes
        }
      }));
    }).catch(err => this.handleError(err)).catch(() => {
      // Ignore if collection not found
      return Promise.resolve();
    });
  }
  createClass(className, schema) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoObject = mongoSchemaFromFieldsAndClassNameAndCLP(schema.fields, className, schema.classLevelPermissions, schema.indexes);
    mongoObject._id = className;
    return this.setIndexesWithSchemaFormat(className, schema.indexes, {}, schema.fields).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.insertSchema(mongoObject)).catch(err => this.handleError(err));
  }
  async updateFieldOptions(className, fieldName, type) {
    const schemaCollection = await this._schemaCollection();
    await schemaCollection.updateFieldOptions(className, fieldName, type);
  }
  addFieldIfNotExists(className, fieldName, type) {
    return this._schemaCollection().then(schemaCollection => schemaCollection.addFieldIfNotExists(className, fieldName, type)).then(() => this.createIndexesIfNeeded(className, fieldName, type)).catch(err => this.handleError(err));
  }

  // Drops a collection. Resolves with true if it was a Parse Schema (eg. _User, Custom, etc.)
  // and resolves with false if it wasn't (eg. a join table). Rejects if deletion was impossible.
  deleteClass(className) {
    return this._adaptiveCollection(className).then(collection => collection.drop()).catch(error => {
      // 'ns not found' means collection was already gone. Ignore deletion attempt.
      if (error.message == 'ns not found') {
        return;
      }
      throw error;
    })
    // We've dropped the collection, now remove the _SCHEMA document
    .then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.findAndDeleteSchema(className)).catch(err => this.handleError(err));
  }
  deleteAllClasses(fast) {
    return storageAdapterAllCollections(this).then(collections => Promise.all(collections.map(collection => fast ? collection.deleteMany({}) : collection.drop())));
  }

  // Remove the column and all the data. For Relations, the _Join collection is handled
  // specially, this function does not delete _Join columns. It should, however, indicate
  // that the relation fields does not exist anymore. In mongo, this means removing it from
  // the _SCHEMA collection.  There should be no actual data in the collection under the same name
  // as the relation column, so it's fine to attempt to delete it. If the fields listed to be
  // deleted do not exist, this function should return successfully anyways. Checking for
  // attempts to delete non-existent fields is the responsibility of Parse Server.

  // Pointer field names are passed for legacy reasons: the original mongo
  // format stored pointer field names differently in the database, and therefore
  // needed to know the type of the field before it could delete it. Future database
  // adapters should ignore the pointerFieldNames argument. All the field names are in
  // fieldNames, they show up additionally in the pointerFieldNames database for use
  // by the mongo adapter, which deals with the legacy mongo format.

  // This function is not obligated to delete fields atomically. It is given the field
  // names in a list so that databases that are capable of deleting fields atomically
  // may do so.

  // Returns a Promise.
  deleteFields(className, schema, fieldNames) {
    const mongoFormatNames = fieldNames.map(fieldName => {
      if (schema.fields[fieldName].type === 'Pointer') {
        return `_p_${fieldName}`;
      } else {
        return fieldName;
      }
    });
    const collectionUpdate = {
      $unset: {}
    };
    mongoFormatNames.forEach(name => {
      collectionUpdate['$unset'][name] = null;
    });
    const collectionFilter = {
      $or: []
    };
    mongoFormatNames.forEach(name => {
      collectionFilter['$or'].push({
        [name]: {
          $exists: true
        }
      });
    });
    const schemaUpdate = {
      $unset: {}
    };
    fieldNames.forEach(name => {
      schemaUpdate['$unset'][name] = null;
      schemaUpdate['$unset'][`_metadata.fields_options.${name}`] = null;
    });
    return this._adaptiveCollection(className).then(collection => collection.updateMany(collectionFilter, collectionUpdate)).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.updateSchema(className, schemaUpdate)).catch(err => this.handleError(err));
  }

  // Return a promise for all schemas known to this adapter, in Parse format. In case the
  // schemas cannot be retrieved, returns a promise that rejects. Requirements for the
  // rejection reason are TBD.
  getAllClasses() {
    return this._schemaCollection().then(schemasCollection => schemasCollection._fetchAllSchemasFrom_SCHEMA()).catch(err => this.handleError(err));
  }

  // Return a promise for the schema with the given name, in Parse format. If
  // this adapter doesn't know about the schema, return a promise that rejects with
  // undefined as the reason.
  getClass(className) {
    return this._schemaCollection().then(schemasCollection => schemasCollection._fetchOneSchemaFrom_SCHEMA(className)).catch(err => this.handleError(err));
  }

  // TODO: As yet not particularly well specified. Creates an object. Maybe shouldn't even need the schema,
  // and should infer from the type. Or maybe does need the schema for validations. Or maybe needs
  // the schema only for the legacy mongo format. We'll figure that out later.
  createObject(className, schema, object, transactionalSession) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoObject = (0, _MongoTransform.parseObjectToMongoObjectForCreate)(className, object, schema);
    return this._adaptiveCollection(className).then(collection => collection.insertOne(mongoObject, transactionalSession)).then(() => ({
      ops: [mongoObject]
    })).catch(error => {
      if (error.code === 11000) {
        _logger.default.error('Duplicate key error:', error.message);
        const err = new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;
        if (error.message) {
          const matches = error.message.match(/index:[\sa-zA-Z0-9_\-\.]+\$?([a-zA-Z_-]+)_1/);
          if (matches && Array.isArray(matches)) {
            err.userInfo = {
              duplicated_field: matches[1]
            };
          }
          // Check for authData unique index violations
          if (!err.userInfo) {
            const authDataMatch = error.message.match(/index:\s+(_auth_data_[a-zA-Z0-9_]+_id)/);
            if (authDataMatch) {
              err.userInfo = {
                duplicated_field: authDataMatch[1]
              };
            }
          }
        }
        throw err;
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Remove all objects that match the given Parse Query.
  // If no objects match, reject with OBJECT_NOT_FOUND. If objects are found and deleted, resolve with undefined.
  // If there is some other error, reject with INTERNAL_SERVER_ERROR.
  deleteObjectsByQuery(className, schema, query, transactionalSession) {
    schema = convertParseSchemaToMongoSchema(schema);
    return this._adaptiveCollection(className).then(collection => {
      const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
      return collection.deleteMany(mongoWhere, transactionalSession);
    }).catch(err => this.handleError(err)).then(({
      deletedCount
    }) => {
      if (deletedCount === 0) {
        throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'Object not found.');
      }
      return Promise.resolve();
    }, () => {
      throw new _node.default.Error(_node.default.Error.INTERNAL_SERVER_ERROR, 'Database adapter error');
    });
  }

  // Apply the update to all objects that match the given Parse Query.
  updateObjectsByQuery(className, schema, query, update, transactionalSession) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection.updateMany(mongoWhere, mongoUpdate, transactionalSession)).catch(err => this.handleError(err));
  }

  // Atomically finds and updates an object based on query.
  // Return value not currently well specified.
  findOneAndUpdate(className, schema, query, update, transactionalSession) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.findOneAndUpdate(mongoWhere, mongoUpdate, {
      returnDocument: 'after',
      session: transactionalSession || undefined
    })).then(result => (0, _MongoTransform.mongoObjectToParseObject)(className, result, schema)).catch(error => {
      if (error.code === 11000) {
        _logger.default.error('Duplicate key error:', error.message);
        const err = new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;
        if (error.message) {
          const matches = error.message.match(/index:[\sa-zA-Z0-9_\-\.]+\$?([a-zA-Z_-]+)_1/);
          if (matches && Array.isArray(matches)) {
            err.userInfo = {
              duplicated_field: matches[1]
            };
          }
          if (!err.userInfo) {
            const authDataMatch = error.message.match(/index:\s+(_auth_data_[a-zA-Z0-9_]+_id)/);
            if (authDataMatch) {
              err.userInfo = {
                duplicated_field: authDataMatch[1]
              };
            }
          }
        }
        throw err;
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Hopefully we can get rid of this. It's only used for config and hooks.
  upsertOneObject(className, schema, query, update, transactionalSession) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection.upsertOne(mongoWhere, mongoUpdate, transactionalSession)).catch(err => this.handleError(err));
  }

  // Executes a find. Accepts: className, query in Parse format, and { skip, limit, sort }.
  find(className, schema, query, {
    skip,
    limit,
    sort,
    keys,
    readPreference,
    hint,
    caseInsensitive,
    explain,
    comment
  }) {
    validateExplainValue(explain);
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    const mongoSort = _lodash.default.mapKeys(sort, (value, fieldName) => (0, _MongoTransform.transformKey)(className, fieldName, schema));
    const mongoKeys = _lodash.default.reduce(keys, (memo, key) => {
      if (key === 'ACL') {
        memo['_rperm'] = 1;
        memo['_wperm'] = 1;
      } else {
        memo[(0, _MongoTransform.transformKey)(className, key, schema)] = 1;
      }
      return memo;
    }, {});

    // If we aren't requesting the `_id` field, we need to explicitly opt out
    // of it. Doing so in parse-server is unusual, but it can allow us to
    // optimize some queries with covering indexes.
    if (keys && !mongoKeys._id) {
      mongoKeys._id = 0;
    }
    readPreference = this._parseReadPreference(readPreference);
    return this.createTextIndexesIfNeeded(className, query, schema).then(() => this._adaptiveCollection(className)).then(collection => collection.find(mongoWhere, {
      skip,
      limit,
      sort: mongoSort,
      keys: mongoKeys,
      maxTimeMS: this._maxTimeMS,
      batchSize: this._batchSize,
      readPreference,
      hint,
      caseInsensitive,
      explain,
      comment
    })).then(objects => {
      if (explain) {
        return objects;
      }
      return objects.map(object => (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema));
    }).catch(err => this.handleError(err));
  }
  ensureIndex(className, schema, fieldNames, indexName, caseInsensitive = false, options = {}) {
    schema = convertParseSchemaToMongoSchema(schema);
    const indexCreationRequest = {};
    const mongoFieldNames = fieldNames.map(fieldName => (0, _MongoTransform.transformKey)(className, fieldName, schema));
    mongoFieldNames.forEach(fieldName => {
      indexCreationRequest[fieldName] = options.indexType !== undefined ? options.indexType : 1;
    });
    const defaultOptions = {
      background: true,
      sparse: true
    };
    const indexNameOptions = indexName ? {
      name: indexName
    } : {};
    const ttlOptions = options.ttl !== undefined ? {
      expireAfterSeconds: options.ttl
    } : {};
    const sparseOptions = options.sparse !== undefined ? {
      sparse: options.sparse
    } : {};
    const caseInsensitiveOptions = caseInsensitive ? {
      collation: _MongoCollection.default.caseInsensitiveCollation()
    } : {};
    const partialFilterOptions = options.partialFilterExpression !== undefined ? {
      partialFilterExpression: options.partialFilterExpression
    } : {};
    const indexOptions = {
      ...defaultOptions,
      ...caseInsensitiveOptions,
      ...indexNameOptions,
      ...ttlOptions,
      ...sparseOptions,
      ...partialFilterOptions
    };
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.createIndex(indexCreationRequest, indexOptions)).catch(err => this.handleError(err));
  }

  // Create a unique index. Unique indexes on nullable fields are not allowed. Since we don't
  // currently know which fields are nullable and which aren't, we ignore that criteria.
  // As such, we shouldn't expose this function to users of parse until we have an out-of-band
  // Way of determining if a field is nullable. Undefined doesn't count against uniqueness,
  // which is why we use sparse indexes.
  ensureUniqueness(className, schema, fieldNames) {
    schema = convertParseSchemaToMongoSchema(schema);
    const indexCreationRequest = {};
    const mongoFieldNames = fieldNames.map(fieldName => (0, _MongoTransform.transformKey)(className, fieldName, schema));
    mongoFieldNames.forEach(fieldName => {
      indexCreationRequest[fieldName] = 1;
    });
    return this._adaptiveCollection(className).then(collection => collection._ensureSparseUniqueIndexInBackground(indexCreationRequest)).catch(error => {
      if (error.code === 11000) {
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'Tried to ensure field uniqueness for a class that already has duplicates.');
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Creates a unique sparse index on _auth_data_<provider>.id to prevent
  // race conditions during concurrent signups with the same authData.
  ensureAuthDataUniqueness(provider) {
    return this._adaptiveCollection('_User').then(collection => collection._mongoCollection.createIndex({
      [`_auth_data_${provider}.id`]: 1
    }, {
      unique: true,
      sparse: true,
      background: true,
      name: `_auth_data_${provider}_id`
    })).catch(error => {
      if (error.code === 11000) {
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'Tried to ensure field uniqueness for a class that already has duplicates.');
      }
      // Ignore "index already exists with same name" or "index already exists with different options"
      if (error.code === 85 || error.code === 86) {
        return;
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Used in tests
  _rawFind(className, query) {
    return this._adaptiveCollection(className).then(collection => collection.find(query, {
      maxTimeMS: this._maxTimeMS,
      batchSize: this._batchSize
    })).catch(err => this.handleError(err));
  }

  // Executes a count.
  count(className, schema, query, readPreference, _estimate, hint, comment) {
    schema = convertParseSchemaToMongoSchema(schema);
    readPreference = this._parseReadPreference(readPreference);
    return this._adaptiveCollection(className).then(collection => collection.count((0, _MongoTransform.transformWhere)(className, query, schema, true), {
      maxTimeMS: this._maxTimeMS,
      readPreference,
      hint,
      comment
    })).catch(err => this.handleError(err));
  }
  distinct(className, schema, query, fieldName) {
    schema = convertParseSchemaToMongoSchema(schema);
    const isPointerField = schema.fields[fieldName] && schema.fields[fieldName].type === 'Pointer';
    const transformField = (0, _MongoTransform.transformKey)(className, fieldName, schema);
    return this._adaptiveCollection(className).then(collection => collection.distinct(transformField, (0, _MongoTransform.transformWhere)(className, query, schema))).then(objects => {
      objects = objects.filter(obj => obj != null);
      return objects.map(object => {
        if (isPointerField) {
          return (0, _MongoTransform.transformPointerString)(schema, fieldName, object);
        }
        return (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema);
      });
    }).catch(err => this.handleError(err));
  }
  aggregate(className, schema, pipeline, readPreference, hint, explain, comment, rawValues, rawFieldNames) {
    validateExplainValue(explain);
    if (rawValues) {
      pipeline = _bson.EJSON.deserialize(pipeline);
    }
    let isPointerField = false;
    pipeline = pipeline.map(stage => {
      if (stage.$group) {
        stage.$group = this._parseAggregateGroupArgs(schema, stage.$group, rawFieldNames);
        if (stage.$group._id && typeof stage.$group._id === 'string' && stage.$group._id.indexOf('$_p_') >= 0) {
          isPointerField = true;
        }
      }
      if (stage.$match) {
        stage.$match = this._parseAggregateArgs(schema, stage.$match, rawValues, rawFieldNames);
      }
      if (stage.$project) {
        stage.$project = this._parseAggregateProjectArgs(schema, stage.$project, rawValues, rawFieldNames);
      }
      if (stage.$geoNear && stage.$geoNear.query) {
        stage.$geoNear.query = this._parseAggregateArgs(schema, stage.$geoNear.query, rawValues, rawFieldNames);
      }
      return stage;
    });
    readPreference = this._parseReadPreference(readPreference);
    return this._adaptiveCollection(className).then(collection => collection.aggregate(pipeline, {
      readPreference,
      maxTimeMS: this._maxTimeMS,
      batchSize: this._batchSize,
      hint,
      explain,
      comment
    })).then(results => {
      if (rawFieldNames) {
        return results;
      }
      results.forEach(result => {
        if (Object.prototype.hasOwnProperty.call(result, '_id')) {
          if (isPointerField && result._id) {
            result._id = result._id.split('$')[1];
          }
          if (result._id == null || result._id == undefined || ['object', 'string'].includes(typeof result._id) && _lodash.default.isEmpty(result._id)) {
            result._id = null;
          }
          result.objectId = result._id;
          delete result._id;
        }
      });
      return results;
    }).then(objects => {
      if (rawValues) {
        return objects.map(obj => _bson.EJSON.serialize(obj));
      }
      if (rawFieldNames) {
        return objects;
      }
      return objects.map(object => (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema));
    }).catch(err => this.handleError(err));
  }

  // This function will recursively traverse the pipeline and convert any Pointer or Date columns.
  // If we detect a pointer column we will rename the column being queried for to match the column
  // in the database. We also modify the value to what we expect the value to be in the database
  // as well.
  // For dates, the driver expects a Date object, but we have a string coming in. So we'll convert
  // the string to a Date so the driver can perform the necessary comparison.
  //
  // The goal of this method is to look for the "leaves" of the pipeline and determine if it needs
  // to be converted. The pipeline can have a few different forms. For more details, see:
  //     https://docs.mongodb.com/manual/reference/operator/aggregation/
  //
  // If the pipeline is an array, it means we are probably parsing an '$and' or '$or' operator. In
  // that case we need to loop through all of it's children to find the columns being operated on.
  // If the pipeline is an object, then we'll loop through the keys checking to see if the key name
  // matches one of the schema columns. If it does match a column and the column is a Pointer or
  // a Date, then we'll convert the value as described above.
  //
  // As much as I hate recursion...this seemed like a good fit for it. We're essentially traversing
  // down a tree to find a "leaf node" and checking to see if it needs to be converted.
  _parseAggregateArgs(schema, pipeline, rawValues, rawFieldNames) {
    if (pipeline === null) {
      return null;
    } else if (_Utils.default.isDate(pipeline)) {
      return pipeline;
    } else if (Array.isArray(pipeline)) {
      return pipeline.map(value => this._parseAggregateArgs(schema, value, rawValues, rawFieldNames));
    } else if (typeof pipeline === 'object') {
      const returnValue = {};
      for (const field in pipeline) {
        if (!rawFieldNames && schema.fields[field] && schema.fields[field].type === 'Pointer') {
          if (typeof pipeline[field] === 'object') {
            returnValue[`_p_${field}`] = pipeline[field];
          } else if (rawValues) {
            returnValue[`_p_${field}`] = pipeline[field];
          } else {
            returnValue[`_p_${field}`] = `${schema.fields[field].targetClass}$${pipeline[field]}`;
          }
        } else if (schema.fields[field] && schema.fields[field].type === 'Date' && !rawValues) {
          returnValue[field] = this._convertToDate(pipeline[field]);
        } else {
          returnValue[field] = this._parseAggregateArgs(schema, pipeline[field], rawValues, rawFieldNames);
        }
        if (!rawFieldNames) {
          if (field === 'objectId') {
            returnValue['_id'] = returnValue[field];
            delete returnValue[field];
          } else if (field === 'createdAt') {
            returnValue['_created_at'] = returnValue[field];
            delete returnValue[field];
          } else if (field === 'updatedAt') {
            returnValue['_updated_at'] = returnValue[field];
            delete returnValue[field];
          }
        }
      }
      return returnValue;
    }
    return pipeline;
  }

  // This function is slightly different than the one above. Rather than trying to combine these
  // two functions and making the code even harder to understand, I decided to split it up. The
  // difference with this function is we are not transforming the values, only the keys of the
  // pipeline.
  _parseAggregateProjectArgs(schema, pipeline, rawValues, rawFieldNames) {
    const returnValue = {};
    for (const field in pipeline) {
      if (!rawFieldNames && schema.fields[field] && schema.fields[field].type === 'Pointer') {
        returnValue[`_p_${field}`] = pipeline[field];
      } else {
        returnValue[field] = this._parseAggregateArgs(schema, pipeline[field], rawValues, rawFieldNames);
      }
      if (!rawFieldNames) {
        if (field === 'objectId') {
          returnValue['_id'] = returnValue[field];
          delete returnValue[field];
        } else if (field === 'createdAt') {
          returnValue['_created_at'] = returnValue[field];
          delete returnValue[field];
        } else if (field === 'updatedAt') {
          returnValue['_updated_at'] = returnValue[field];
          delete returnValue[field];
        }
      }
    }
    return returnValue;
  }

  // This function is slightly different than the two above. MongoDB $group aggregate looks like:
  //     { $group: { _id: <expression>, <field1>: { <accumulator1> : <expression1> }, ... } }
  // The <expression> could be a column name, prefixed with the '$' character. We'll look for
  // these <expression> and check to see if it is a 'Pointer' or if it's one of createdAt,
  // updatedAt or objectId and change it accordingly.
  _parseAggregateGroupArgs(schema, pipeline, rawFieldNames) {
    if (Array.isArray(pipeline)) {
      return pipeline.map(value => this._parseAggregateGroupArgs(schema, value, rawFieldNames));
    } else if (typeof pipeline === 'object') {
      const returnValue = {};
      for (const field in pipeline) {
        returnValue[field] = this._parseAggregateGroupArgs(schema, pipeline[field], rawFieldNames);
      }
      return returnValue;
    } else if (typeof pipeline === 'string' && !rawFieldNames) {
      const field = pipeline.substring(1);
      if (schema.fields[field] && schema.fields[field].type === 'Pointer') {
        return `$_p_${field}`;
      } else if (field == 'createdAt') {
        return '$_created_at';
      } else if (field == 'updatedAt') {
        return '$_updated_at';
      }
    }
    return pipeline;
  }

  /**
   * Recursively converts values to Date objects. Since the passed object is part of an aggregation
   * pipeline and can contain various logic operators (like $gt, $lt, etc), this function will
   * traverse the object and convert any strings that can be parsed as dates into Date objects.
   * @param {any} value The value to convert.
   * @returns {any} The original value if not convertible to Date, or a Date object if it is.
   */
  _convertToDate(value) {
    if (_Utils.default.isDate(value)) {
      return value;
    }
    if (typeof value === 'string') {
      return isNaN(Date.parse(value)) ? value : new Date(value);
    }
    if (typeof value === 'object') {
      const returnValue = {};
      for (const field in value) {
        returnValue[field] = this._convertToDate(value[field]);
      }
      return returnValue;
    }
    return value;
  }
  _parseReadPreference(readPreference) {
    if (readPreference) {
      readPreference = readPreference.toUpperCase();
    }
    switch (readPreference) {
      case 'PRIMARY':
        readPreference = ReadPreference.PRIMARY;
        break;
      case 'PRIMARY_PREFERRED':
        readPreference = ReadPreference.PRIMARY_PREFERRED;
        break;
      case 'SECONDARY':
        readPreference = ReadPreference.SECONDARY;
        break;
      case 'SECONDARY_PREFERRED':
        readPreference = ReadPreference.SECONDARY_PREFERRED;
        break;
      case 'NEAREST':
        readPreference = ReadPreference.NEAREST;
        break;
      case undefined:
      case null:
      case '':
        break;
      default:
        throw new _node.default.Error(_node.default.Error.INVALID_QUERY, 'Not supported read preference.');
    }
    return readPreference;
  }
  performInitialization() {
    return Promise.resolve();
  }
  createIndex(className, index) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.createIndex(index)).catch(err => this.handleError(err));
  }
  createIndexes(className, indexes) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.createIndexes(indexes)).catch(err => this.handleError(err));
  }
  createIndexesIfNeeded(className, fieldName, type) {
    if (type && type.type === 'Polygon') {
      const index = {
        [fieldName]: '2dsphere'
      };
      return this.createIndex(className, index);
    }
    return Promise.resolve();
  }
  createTextIndexesIfNeeded(className, query, schema) {
    for (const fieldName in query) {
      if (!query[fieldName] || !query[fieldName].$text) {
        continue;
      }
      const existingIndexes = schema.indexes;
      for (const key in existingIndexes) {
        const index = existingIndexes[key];
        if (Object.prototype.hasOwnProperty.call(index, fieldName)) {
          return Promise.resolve();
        }
      }
      const indexName = `${fieldName}_text`;
      const textIndex = {
        [indexName]: {
          [fieldName]: 'text'
        }
      };
      return this.setIndexesWithSchemaFormat(className, textIndex, existingIndexes, schema.fields).catch(error => {
        if (error.code === 85) {
          // Index exist with different options
          return this.setIndexesFromMongo(className);
        }
        throw error;
      });
    }
    return Promise.resolve();
  }
  getIndexes(className) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.indexes()).catch(err => this.handleError(err));
  }
  dropIndex(className, index) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.dropIndex(index)).catch(err => this.handleError(err));
  }
  dropAllIndexes(className) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.dropIndexes()).catch(err => this.handleError(err));
  }
  updateSchemaWithIndexes() {
    return this.getAllClasses().then(classes => {
      const promises = classes.map(schema => {
        return this.setIndexesFromMongo(schema.className);
      });
      return Promise.all(promises);
    }).catch(err => this.handleError(err));
  }
  createTransactionalSession() {
    const transactionalSection = this.client.startSession();
    transactionalSection.startTransaction();
    return Promise.resolve(transactionalSection);
  }
  commitTransactionalSession(transactionalSection) {
    const commit = retries => {
      return transactionalSection.commitTransaction().catch(error => {
        if (error && error.hasErrorLabel('TransientTransactionError') && retries > 0) {
          return commit(retries - 1);
        }
        throw error;
      }).then(() => {
        transactionalSection.endSession();
      });
    };
    return commit(5);
  }
  abortTransactionalSession(transactionalSection) {
    return transactionalSection.abortTransaction().then(() => {
      transactionalSection.endSession();
    });
  }
}
exports.MongoStorageAdapter = MongoStorageAdapter;
var _default = exports.default = MongoStorageAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9uZ29kYlVybCIsInJlcXVpcmUiLCJfU3RvcmFnZUFkYXB0ZXIiLCJfVXRpbHMiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwiX01vbmdvQ29sbGVjdGlvbiIsIl9Nb25nb1NjaGVtYUNvbGxlY3Rpb24iLCJfTW9uZ29UcmFuc2Zvcm0iLCJfbm9kZSIsIl9sb2Rhc2giLCJfYnNvbiIsIl9kZWZhdWx0cyIsIl9pbnRlcm9wUmVxdWlyZVdpbGRjYXJkIiwiX2xvZ2dlciIsImUiLCJ0IiwiV2Vha01hcCIsInIiLCJuIiwiX19lc01vZHVsZSIsIm8iLCJpIiwiZiIsIl9fcHJvdG9fXyIsImRlZmF1bHQiLCJoYXMiLCJnZXQiLCJzZXQiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsIm1vbmdvZGIiLCJNb25nb0NsaWVudCIsIlJlYWRQcmVmZXJlbmNlIiwiTW9uZ29TY2hlbWFDb2xsZWN0aW9uTmFtZSIsImlzVHJhbnNpZW50RXJyb3IiLCJlcnJvciIsInRyYW5zaWVudEVycm9yTmFtZXMiLCJpbmNsdWRlcyIsIm5hbWUiLCJoYXNFcnJvckxhYmVsIiwic3RvcmFnZUFkYXB0ZXJBbGxDb2xsZWN0aW9ucyIsIm1vbmdvQWRhcHRlciIsImNvbm5lY3QiLCJ0aGVuIiwiZGF0YWJhc2UiLCJjb2xsZWN0aW9ucyIsImZpbHRlciIsImNvbGxlY3Rpb24iLCJuYW1lc3BhY2UiLCJtYXRjaCIsImNvbGxlY3Rpb25OYW1lIiwiaW5kZXhPZiIsIl9jb2xsZWN0aW9uUHJlZml4IiwiY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYSIsInNjaGVtYSIsImZpZWxkcyIsIl9ycGVybSIsIl93cGVybSIsImNsYXNzTmFtZSIsIl9oYXNoZWRfcGFzc3dvcmQiLCJtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWVBbmRDTFAiLCJjbGFzc0xldmVsUGVybWlzc2lvbnMiLCJpbmRleGVzIiwibW9uZ29PYmplY3QiLCJfaWQiLCJvYmplY3RJZCIsInVwZGF0ZWRBdCIsImNyZWF0ZWRBdCIsIl9tZXRhZGF0YSIsInVuZGVmaW5lZCIsImZpZWxkTmFtZSIsInR5cGUiLCJ0YXJnZXRDbGFzcyIsImZpZWxkT3B0aW9ucyIsIk1vbmdvU2NoZW1hQ29sbGVjdGlvbiIsInBhcnNlRmllbGRUeXBlVG9Nb25nb0ZpZWxkVHlwZSIsImtleXMiLCJsZW5ndGgiLCJmaWVsZHNfb3B0aW9ucyIsImNsYXNzX3Blcm1pc3Npb25zIiwidmFsaWRhdGVFeHBsYWluVmFsdWUiLCJleHBsYWluIiwiZXhwbGFpbkFsbG93ZWRWYWx1ZXMiLCJQYXJzZSIsIkVycm9yIiwiSU5WQUxJRF9RVUVSWSIsIk1vbmdvU3RvcmFnZUFkYXB0ZXIiLCJjb25zdHJ1Y3RvciIsInVyaSIsImRlZmF1bHRzIiwiRGVmYXVsdE1vbmdvVVJJIiwiY29sbGVjdGlvblByZWZpeCIsIm1vbmdvT3B0aW9ucyIsIl91cmkiLCJfb25jaGFuZ2UiLCJfbWF4VGltZU1TIiwibWF4VGltZU1TIiwiX2JhdGNoU2l6ZSIsImJhdGNoU2l6ZSIsImNhblNvcnRPbkpvaW5UYWJsZXMiLCJlbmFibGVTY2hlbWFIb29rcyIsInNjaGVtYUNhY2hlVHRsIiwiZGlzYWJsZUluZGV4RmllbGRWYWxpZGF0aW9uIiwiX2xvZ0NsaWVudEV2ZW50cyIsImxvZ0NsaWVudEV2ZW50cyIsIl9jbGllbnRNZXRhZGF0YSIsImNsaWVudE1ldGFkYXRhIiwiX21vbmdvT3B0aW9ucyIsImtleSIsIlBhcnNlU2VydmVyRGF0YWJhc2VPcHRpb25zIiwid2F0Y2giLCJjYWxsYmFjayIsImNvbm5lY3Rpb25Qcm9taXNlIiwiZW5jb2RlZFVyaSIsImZvcm1hdFVybCIsInBhcnNlVXJsIiwib3B0aW9ucyIsImRyaXZlckluZm8iLCJ2ZXJzaW9uIiwiY2xpZW50IiwicyIsImRiIiwiZGJOYW1lIiwib24iLCJBcnJheSIsImlzQXJyYXkiLCJmb3JFYWNoIiwiZXZlbnRDb25maWciLCJldmVudCIsImxvZ0RhdGEiLCJrZXlQYXRoIiwiXyIsImxvZ0xldmVsIiwibG9nZ2VyIiwibG9nTWVzc2FnZSIsIkpTT04iLCJzdHJpbmdpZnkiLCJVdGlscyIsImdldENpcmN1bGFyUmVwbGFjZXIiLCJjYXRjaCIsImVyciIsIlByb21pc2UiLCJyZWplY3QiLCJoYW5kbGVFcnJvciIsImNvZGUiLCJJTlRFUk5BTF9TRVJWRVJfRVJST1IiLCJoYW5kbGVTaHV0ZG93biIsImNsb3NlIiwiX2FkYXB0aXZlQ29sbGVjdGlvbiIsInJhd0NvbGxlY3Rpb24iLCJNb25nb0NvbGxlY3Rpb24iLCJfc2NoZW1hQ29sbGVjdGlvbiIsIl9zdHJlYW0iLCJfbW9uZ29Db2xsZWN0aW9uIiwiY2xhc3NFeGlzdHMiLCJsaXN0Q29sbGVjdGlvbnMiLCJ0b0FycmF5Iiwic2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiQ0xQcyIsInNjaGVtYUNvbGxlY3Rpb24iLCJ1cGRhdGVTY2hlbWEiLCIkc2V0Iiwic2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQiLCJzdWJtaXR0ZWRJbmRleGVzIiwiZXhpc3RpbmdJbmRleGVzIiwicmVzb2x2ZSIsIl9pZF8iLCJkZWxldGVQcm9taXNlcyIsImluc2VydGVkSW5kZXhlcyIsImZpZWxkIiwiX19vcCIsInByb21pc2UiLCJkcm9wSW5kZXgiLCJwdXNoIiwicHJvdG90eXBlIiwicmVwbGFjZSIsImluc2VydFByb21pc2UiLCJjcmVhdGVJbmRleGVzIiwiYWxsIiwic2V0SW5kZXhlc0Zyb21Nb25nbyIsImdldEluZGV4ZXMiLCJyZWR1Y2UiLCJvYmoiLCJpbmRleCIsIl9mdHMiLCJfZnRzeCIsIndlaWdodHMiLCJjcmVhdGVDbGFzcyIsImluc2VydFNjaGVtYSIsInVwZGF0ZUZpZWxkT3B0aW9ucyIsImFkZEZpZWxkSWZOb3RFeGlzdHMiLCJjcmVhdGVJbmRleGVzSWZOZWVkZWQiLCJkZWxldGVDbGFzcyIsImRyb3AiLCJtZXNzYWdlIiwiZmluZEFuZERlbGV0ZVNjaGVtYSIsImRlbGV0ZUFsbENsYXNzZXMiLCJmYXN0IiwibWFwIiwiZGVsZXRlTWFueSIsImRlbGV0ZUZpZWxkcyIsImZpZWxkTmFtZXMiLCJtb25nb0Zvcm1hdE5hbWVzIiwiY29sbGVjdGlvblVwZGF0ZSIsIiR1bnNldCIsImNvbGxlY3Rpb25GaWx0ZXIiLCIkb3IiLCIkZXhpc3RzIiwic2NoZW1hVXBkYXRlIiwidXBkYXRlTWFueSIsImdldEFsbENsYXNzZXMiLCJzY2hlbWFzQ29sbGVjdGlvbiIsIl9mZXRjaEFsbFNjaGVtYXNGcm9tX1NDSEVNQSIsImdldENsYXNzIiwiX2ZldGNoT25lU2NoZW1hRnJvbV9TQ0hFTUEiLCJjcmVhdGVPYmplY3QiLCJvYmplY3QiLCJ0cmFuc2FjdGlvbmFsU2Vzc2lvbiIsInBhcnNlT2JqZWN0VG9Nb25nb09iamVjdEZvckNyZWF0ZSIsImluc2VydE9uZSIsIm9wcyIsIkRVUExJQ0FURV9WQUxVRSIsInVuZGVybHlpbmdFcnJvciIsIm1hdGNoZXMiLCJ1c2VySW5mbyIsImR1cGxpY2F0ZWRfZmllbGQiLCJhdXRoRGF0YU1hdGNoIiwiZGVsZXRlT2JqZWN0c0J5UXVlcnkiLCJxdWVyeSIsIm1vbmdvV2hlcmUiLCJ0cmFuc2Zvcm1XaGVyZSIsImRlbGV0ZWRDb3VudCIsIk9CSkVDVF9OT1RfRk9VTkQiLCJ1cGRhdGVPYmplY3RzQnlRdWVyeSIsInVwZGF0ZSIsIm1vbmdvVXBkYXRlIiwidHJhbnNmb3JtVXBkYXRlIiwiZmluZE9uZUFuZFVwZGF0ZSIsInJldHVybkRvY3VtZW50Iiwic2Vzc2lvbiIsInJlc3VsdCIsIm1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCIsInVwc2VydE9uZU9iamVjdCIsInVwc2VydE9uZSIsImZpbmQiLCJza2lwIiwibGltaXQiLCJzb3J0IiwicmVhZFByZWZlcmVuY2UiLCJoaW50IiwiY2FzZUluc2Vuc2l0aXZlIiwiY29tbWVudCIsIm1vbmdvU29ydCIsIm1hcEtleXMiLCJ2YWx1ZSIsInRyYW5zZm9ybUtleSIsIm1vbmdvS2V5cyIsIm1lbW8iLCJfcGFyc2VSZWFkUHJlZmVyZW5jZSIsImNyZWF0ZVRleHRJbmRleGVzSWZOZWVkZWQiLCJvYmplY3RzIiwiZW5zdXJlSW5kZXgiLCJpbmRleE5hbWUiLCJpbmRleENyZWF0aW9uUmVxdWVzdCIsIm1vbmdvRmllbGROYW1lcyIsImluZGV4VHlwZSIsImRlZmF1bHRPcHRpb25zIiwiYmFja2dyb3VuZCIsInNwYXJzZSIsImluZGV4TmFtZU9wdGlvbnMiLCJ0dGxPcHRpb25zIiwidHRsIiwiZXhwaXJlQWZ0ZXJTZWNvbmRzIiwic3BhcnNlT3B0aW9ucyIsImNhc2VJbnNlbnNpdGl2ZU9wdGlvbnMiLCJjb2xsYXRpb24iLCJjYXNlSW5zZW5zaXRpdmVDb2xsYXRpb24iLCJwYXJ0aWFsRmlsdGVyT3B0aW9ucyIsInBhcnRpYWxGaWx0ZXJFeHByZXNzaW9uIiwiaW5kZXhPcHRpb25zIiwiY3JlYXRlSW5kZXgiLCJlbnN1cmVVbmlxdWVuZXNzIiwiX2Vuc3VyZVNwYXJzZVVuaXF1ZUluZGV4SW5CYWNrZ3JvdW5kIiwiZW5zdXJlQXV0aERhdGFVbmlxdWVuZXNzIiwicHJvdmlkZXIiLCJ1bmlxdWUiLCJfcmF3RmluZCIsImNvdW50IiwiX2VzdGltYXRlIiwiZGlzdGluY3QiLCJpc1BvaW50ZXJGaWVsZCIsInRyYW5zZm9ybUZpZWxkIiwidHJhbnNmb3JtUG9pbnRlclN0cmluZyIsImFnZ3JlZ2F0ZSIsInBpcGVsaW5lIiwicmF3VmFsdWVzIiwicmF3RmllbGROYW1lcyIsIkVKU09OIiwiZGVzZXJpYWxpemUiLCJzdGFnZSIsIiRncm91cCIsIl9wYXJzZUFnZ3JlZ2F0ZUdyb3VwQXJncyIsIiRtYXRjaCIsIl9wYXJzZUFnZ3JlZ2F0ZUFyZ3MiLCIkcHJvamVjdCIsIl9wYXJzZUFnZ3JlZ2F0ZVByb2plY3RBcmdzIiwiJGdlb05lYXIiLCJyZXN1bHRzIiwic3BsaXQiLCJpc0VtcHR5Iiwic2VyaWFsaXplIiwiaXNEYXRlIiwicmV0dXJuVmFsdWUiLCJfY29udmVydFRvRGF0ZSIsInN1YnN0cmluZyIsImlzTmFOIiwiRGF0ZSIsInBhcnNlIiwidG9VcHBlckNhc2UiLCJQUklNQVJZIiwiUFJJTUFSWV9QUkVGRVJSRUQiLCJTRUNPTkRBUlkiLCJTRUNPTkRBUllfUFJFRkVSUkVEIiwiTkVBUkVTVCIsInBlcmZvcm1Jbml0aWFsaXphdGlvbiIsIiR0ZXh0IiwidGV4dEluZGV4IiwiZHJvcEFsbEluZGV4ZXMiLCJkcm9wSW5kZXhlcyIsInVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzIiwiY2xhc3NlcyIsInByb21pc2VzIiwiY3JlYXRlVHJhbnNhY3Rpb25hbFNlc3Npb24iLCJ0cmFuc2FjdGlvbmFsU2VjdGlvbiIsInN0YXJ0U2Vzc2lvbiIsInN0YXJ0VHJhbnNhY3Rpb24iLCJjb21taXRUcmFuc2FjdGlvbmFsU2Vzc2lvbiIsImNvbW1pdCIsInJldHJpZXMiLCJjb21taXRUcmFuc2FjdGlvbiIsImVuZFNlc3Npb24iLCJhYm9ydFRyYW5zYWN0aW9uYWxTZXNzaW9uIiwiYWJvcnRUcmFuc2FjdGlvbiIsImV4cG9ydHMiLCJfZGVmYXVsdCJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvU3RvcmFnZUFkYXB0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQGZsb3dcbmltcG9ydCB7IGZvcm1hdCBhcyBmb3JtYXRVcmwsIHBhcnNlIGFzIHBhcnNlVXJsIH0gZnJvbSAnLi4vLi4vLi4vdmVuZG9yL21vbmdvZGJVcmwnO1xuaW1wb3J0IHR5cGUgeyBRdWVyeU9wdGlvbnMsIFF1ZXJ5VHlwZSwgU2NoZW1hVHlwZSwgU3RvcmFnZUNsYXNzIH0gZnJvbSAnLi4vU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IHsgU3RvcmFnZUFkYXB0ZXIgfSBmcm9tICcuLi9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgVXRpbHMgZnJvbSAnLi4vLi4vLi4vVXRpbHMnO1xuaW1wb3J0IE1vbmdvQ29sbGVjdGlvbiBmcm9tICcuL01vbmdvQ29sbGVjdGlvbic7XG5pbXBvcnQgTW9uZ29TY2hlbWFDb2xsZWN0aW9uIGZyb20gJy4vTW9uZ29TY2hlbWFDb2xsZWN0aW9uJztcbmltcG9ydCB7XG4gIG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCxcbiAgcGFyc2VPYmplY3RUb01vbmdvT2JqZWN0Rm9yQ3JlYXRlLFxuICB0cmFuc2Zvcm1LZXksXG4gIHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcsXG4gIHRyYW5zZm9ybVVwZGF0ZSxcbiAgdHJhbnNmb3JtV2hlcmUsXG59IGZyb20gJy4vTW9uZ29UcmFuc2Zvcm0nO1xuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgeyBFSlNPTiB9IGZyb20gJ2Jzb24nO1xuaW1wb3J0IGRlZmF1bHRzLCB7IFBhcnNlU2VydmVyRGF0YWJhc2VPcHRpb25zIH0gZnJvbSAnLi4vLi4vLi4vZGVmYXVsdHMnO1xuaW1wb3J0IGxvZ2dlciBmcm9tICcuLi8uLi8uLi9sb2dnZXInO1xuXG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmNvbnN0IG1vbmdvZGIgPSByZXF1aXJlKCdtb25nb2RiJyk7XG5jb25zdCBNb25nb0NsaWVudCA9IG1vbmdvZGIuTW9uZ29DbGllbnQ7XG5jb25zdCBSZWFkUHJlZmVyZW5jZSA9IG1vbmdvZGIuUmVhZFByZWZlcmVuY2U7XG5cbmNvbnN0IE1vbmdvU2NoZW1hQ29sbGVjdGlvbk5hbWUgPSAnX1NDSEVNQSc7XG5cbi8qKlxuICogRGV0ZXJtaW5lcyBpZiBhIE1vbmdvREIgZXJyb3IgaXMgYSB0cmFuc2llbnQgaW5mcmFzdHJ1Y3R1cmUgZXJyb3JcbiAqIChjb25uZWN0aW9uIHBvb2wsIG5ldHdvcmssIHNlcnZlciBzZWxlY3Rpb24pIGFzIG9wcG9zZWQgdG8gYSBxdWVyeS1sZXZlbCBlcnJvci5cbiAqL1xuZnVuY3Rpb24gaXNUcmFuc2llbnRFcnJvcihlcnJvcikge1xuICBpZiAoIWVycm9yKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gQ29ubmVjdGlvbiBwb29sLCBuZXR3b3JrLCBhbmQgc2VydmVyIHNlbGVjdGlvbiBlcnJvcnNcbiAgY29uc3QgdHJhbnNpZW50RXJyb3JOYW1lcyA9IFtcbiAgICAnTW9uZ29XYWl0UXVldWVUaW1lb3V0RXJyb3InLFxuICAgICdNb25nb1NlcnZlclNlbGVjdGlvbkVycm9yJyxcbiAgICAnTW9uZ29OZXR3b3JrVGltZW91dEVycm9yJyxcbiAgICAnTW9uZ29OZXR3b3JrRXJyb3InLFxuICBdO1xuICBpZiAodHJhbnNpZW50RXJyb3JOYW1lcy5pbmNsdWRlcyhlcnJvci5uYW1lKSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gQ2hlY2sgZm9yIE1vbmdvREIncyB0cmFuc2llbnQgdHJhbnNhY3Rpb24gZXJyb3IgbGFiZWxcbiAgaWYgKHR5cGVvZiBlcnJvci5oYXNFcnJvckxhYmVsID09PSAnZnVuY3Rpb24nKSB7XG4gICAgaWYgKGVycm9yLmhhc0Vycm9yTGFiZWwoJ1RyYW5zaWVudFRyYW5zYWN0aW9uRXJyb3InKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5jb25zdCBzdG9yYWdlQWRhcHRlckFsbENvbGxlY3Rpb25zID0gbW9uZ29BZGFwdGVyID0+IHtcbiAgcmV0dXJuIG1vbmdvQWRhcHRlclxuICAgIC5jb25uZWN0KClcbiAgICAudGhlbigoKSA9PiBtb25nb0FkYXB0ZXIuZGF0YWJhc2UuY29sbGVjdGlvbnMoKSlcbiAgICAudGhlbihjb2xsZWN0aW9ucyA9PiB7XG4gICAgICByZXR1cm4gY29sbGVjdGlvbnMuZmlsdGVyKGNvbGxlY3Rpb24gPT4ge1xuICAgICAgICBpZiAoY29sbGVjdGlvbi5uYW1lc3BhY2UubWF0Y2goL1xcLnN5c3RlbVxcLi8pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIC8vIFRPRE86IElmIHlvdSBoYXZlIG9uZSBhcHAgd2l0aCBhIGNvbGxlY3Rpb24gcHJlZml4IHRoYXQgaGFwcGVucyB0byBiZSBhIHByZWZpeCBvZiBhbm90aGVyXG4gICAgICAgIC8vIGFwcHMgcHJlZml4LCB0aGlzIHdpbGwgZ28gdmVyeSB2ZXJ5IGJhZGx5LiBXZSBzaG91bGQgZml4IHRoYXQgc29tZWhvdy5cbiAgICAgICAgcmV0dXJuIGNvbGxlY3Rpb24uY29sbGVjdGlvbk5hbWUuaW5kZXhPZihtb25nb0FkYXB0ZXIuX2NvbGxlY3Rpb25QcmVmaXgpID09IDA7XG4gICAgICB9KTtcbiAgICB9KTtcbn07XG5cbmNvbnN0IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEgPSAoeyAuLi5zY2hlbWEgfSkgPT4ge1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fcnBlcm07XG4gIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl93cGVybTtcblxuICBpZiAoc2NoZW1hLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIC8vIExlZ2FjeSBtb25nbyBhZGFwdGVyIGtub3dzIGFib3V0IHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gcGFzc3dvcmQgYW5kIF9oYXNoZWRfcGFzc3dvcmQuXG4gICAgLy8gRnV0dXJlIGRhdGFiYXNlIGFkYXB0ZXJzIHdpbGwgb25seSBrbm93IGFib3V0IF9oYXNoZWRfcGFzc3dvcmQuXG4gICAgLy8gTm90ZTogUGFyc2UgU2VydmVyIHdpbGwgYnJpbmcgYmFjayBwYXNzd29yZCB3aXRoIGluamVjdERlZmF1bHRTY2hlbWEsIHNvIHdlIGRvbid0IG5lZWRcbiAgICAvLyB0byBhZGQgX2hhc2hlZF9wYXNzd29yZCBiYWNrIGV2ZXIuXG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZDtcbiAgfVxuXG4gIHJldHVybiBzY2hlbWE7XG59O1xuXG4vLyBSZXR1cm5zIHsgY29kZSwgZXJyb3IgfSBpZiBpbnZhbGlkLCBvciB7IHJlc3VsdCB9LCBhbiBvYmplY3Rcbi8vIHN1aXRhYmxlIGZvciBpbnNlcnRpbmcgaW50byBfU0NIRU1BIGNvbGxlY3Rpb24sIG90aGVyd2lzZS5cbmNvbnN0IG1vbmdvU2NoZW1hRnJvbUZpZWxkc0FuZENsYXNzTmFtZUFuZENMUCA9IChcbiAgZmllbGRzLFxuICBjbGFzc05hbWUsXG4gIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgaW5kZXhlc1xuKSA9PiB7XG4gIGNvbnN0IG1vbmdvT2JqZWN0ID0ge1xuICAgIF9pZDogY2xhc3NOYW1lLFxuICAgIG9iamVjdElkOiAnc3RyaW5nJyxcbiAgICB1cGRhdGVkQXQ6ICdzdHJpbmcnLFxuICAgIGNyZWF0ZWRBdDogJ3N0cmluZycsXG4gICAgX21ldGFkYXRhOiB1bmRlZmluZWQsXG4gIH07XG5cbiAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gZmllbGRzKSB7XG4gICAgY29uc3QgeyB0eXBlLCB0YXJnZXRDbGFzcywgLi4uZmllbGRPcHRpb25zIH0gPSBmaWVsZHNbZmllbGROYW1lXTtcbiAgICBtb25nb09iamVjdFtmaWVsZE5hbWVdID0gTW9uZ29TY2hlbWFDb2xsZWN0aW9uLnBhcnNlRmllbGRUeXBlVG9Nb25nb0ZpZWxkVHlwZSh7XG4gICAgICB0eXBlLFxuICAgICAgdGFyZ2V0Q2xhc3MsXG4gICAgfSk7XG4gICAgaWYgKGZpZWxkT3B0aW9ucyAmJiBPYmplY3Qua2V5cyhmaWVsZE9wdGlvbnMpLmxlbmd0aCA+IDApIHtcbiAgICAgIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YSA9IG1vbmdvT2JqZWN0Ll9tZXRhZGF0YSB8fCB7fTtcbiAgICAgIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YS5maWVsZHNfb3B0aW9ucyA9IG1vbmdvT2JqZWN0Ll9tZXRhZGF0YS5maWVsZHNfb3B0aW9ucyB8fCB7fTtcbiAgICAgIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YS5maWVsZHNfb3B0aW9uc1tmaWVsZE5hbWVdID0gZmllbGRPcHRpb25zO1xuICAgIH1cbiAgfVxuXG4gIGlmICh0eXBlb2YgY2xhc3NMZXZlbFBlcm1pc3Npb25zICE9PSAndW5kZWZpbmVkJykge1xuICAgIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YSA9IG1vbmdvT2JqZWN0Ll9tZXRhZGF0YSB8fCB7fTtcbiAgICBpZiAoIWNsYXNzTGV2ZWxQZXJtaXNzaW9ucykge1xuICAgICAgZGVsZXRlIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YS5jbGFzc19wZXJtaXNzaW9ucztcbiAgICB9IGVsc2Uge1xuICAgICAgbW9uZ29PYmplY3QuX21ldGFkYXRhLmNsYXNzX3Blcm1pc3Npb25zID0gY2xhc3NMZXZlbFBlcm1pc3Npb25zO1xuICAgIH1cbiAgfVxuXG4gIGlmIChpbmRleGVzICYmIHR5cGVvZiBpbmRleGVzID09PSAnb2JqZWN0JyAmJiBPYmplY3Qua2V5cyhpbmRleGVzKS5sZW5ndGggPiAwKSB7XG4gICAgbW9uZ29PYmplY3QuX21ldGFkYXRhID0gbW9uZ29PYmplY3QuX21ldGFkYXRhIHx8IHt9O1xuICAgIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YS5pbmRleGVzID0gaW5kZXhlcztcbiAgfVxuXG4gIGlmICghbW9uZ29PYmplY3QuX21ldGFkYXRhKSB7XG4gICAgLy8gY2xlYW51cCB0aGUgdW51c2VkIF9tZXRhZGF0YVxuICAgIGRlbGV0ZSBtb25nb09iamVjdC5fbWV0YWRhdGE7XG4gIH1cblxuICByZXR1cm4gbW9uZ29PYmplY3Q7XG59O1xuXG5mdW5jdGlvbiB2YWxpZGF0ZUV4cGxhaW5WYWx1ZShleHBsYWluKSB7XG4gIGlmIChleHBsYWluKSB7XG4gICAgLy8gVGhlIGxpc3Qgb2YgYWxsb3dlZCBleHBsYWluIHZhbHVlcyBpcyBmcm9tIG5vZGUtbW9uZ29kYi1uYXRpdmUvbGliL2V4cGxhaW4uanNcbiAgICBjb25zdCBleHBsYWluQWxsb3dlZFZhbHVlcyA9IFtcbiAgICAgICdxdWVyeVBsYW5uZXInLFxuICAgICAgJ3F1ZXJ5UGxhbm5lckV4dGVuZGVkJyxcbiAgICAgICdleGVjdXRpb25TdGF0cycsXG4gICAgICAnYWxsUGxhbnNFeGVjdXRpb24nLFxuICAgICAgZmFsc2UsXG4gICAgICB0cnVlLFxuICAgIF07XG4gICAgaWYgKCFleHBsYWluQWxsb3dlZFZhbHVlcy5pbmNsdWRlcyhleHBsYWluKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksICdJbnZhbGlkIHZhbHVlIGZvciBleHBsYWluJyk7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBNb25nb1N0b3JhZ2VBZGFwdGVyIGltcGxlbWVudHMgU3RvcmFnZUFkYXB0ZXIge1xuICAvLyBQcml2YXRlXG4gIF91cmk6IHN0cmluZztcbiAgX2NvbGxlY3Rpb25QcmVmaXg6IHN0cmluZztcbiAgX21vbmdvT3B0aW9uczogT2JqZWN0O1xuICBfb25jaGFuZ2U6IGFueTtcbiAgX3N0cmVhbTogYW55O1xuICBfbG9nQ2xpZW50RXZlbnRzOiA/QXJyYXk8YW55PjtcbiAgX2NsaWVudE1ldGFkYXRhOiA/eyBuYW1lOiBzdHJpbmcsIHZlcnNpb246IHN0cmluZyB9O1xuICAvLyBQdWJsaWNcbiAgY29ubmVjdGlvblByb21pc2U6ID9Qcm9taXNlPGFueT47XG4gIGRhdGFiYXNlOiBhbnk7XG4gIGNsaWVudDogTW9uZ29DbGllbnQ7XG4gIF9tYXhUaW1lTVM6ID9udW1iZXI7XG4gIF9iYXRjaFNpemU6ID9udW1iZXI7XG4gIGNhblNvcnRPbkpvaW5UYWJsZXM6IGJvb2xlYW47XG4gIGVuYWJsZVNjaGVtYUhvb2tzOiBib29sZWFuO1xuICBzY2hlbWFDYWNoZVR0bDogP251bWJlcjtcbiAgZGlzYWJsZUluZGV4RmllbGRWYWxpZGF0aW9uOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKHsgdXJpID0gZGVmYXVsdHMuRGVmYXVsdE1vbmdvVVJJLCBjb2xsZWN0aW9uUHJlZml4ID0gJycsIG1vbmdvT3B0aW9ucyA9IHt9IH06IGFueSkge1xuICAgIHRoaXMuX3VyaSA9IHVyaTtcbiAgICB0aGlzLl9jb2xsZWN0aW9uUHJlZml4ID0gY29sbGVjdGlvblByZWZpeDtcbiAgICB0aGlzLl9vbmNoYW5nZSA9ICgpID0+IHt9O1xuXG4gICAgLy8gTWF4VGltZU1TIGlzIG5vdCBhIGdsb2JhbCBNb25nb0RCIGNsaWVudCBvcHRpb24sIGl0IGlzIGFwcGxpZWQgcGVyIG9wZXJhdGlvbi5cbiAgICB0aGlzLl9tYXhUaW1lTVMgPSBtb25nb09wdGlvbnMubWF4VGltZU1TO1xuICAgIC8vIEJhdGNoU2l6ZSBpcyBub3QgYSBnbG9iYWwgTW9uZ29EQiBjbGllbnQgb3B0aW9uLCBpdCBpcyBhcHBsaWVkIHBlciBjdXJzb3Igb3BlcmF0aW9uLlxuICAgIHRoaXMuX2JhdGNoU2l6ZSA9IG1vbmdvT3B0aW9ucy5iYXRjaFNpemU7XG4gICAgdGhpcy5jYW5Tb3J0T25Kb2luVGFibGVzID0gdHJ1ZTtcbiAgICB0aGlzLmVuYWJsZVNjaGVtYUhvb2tzID0gISFtb25nb09wdGlvbnMuZW5hYmxlU2NoZW1hSG9va3M7XG4gICAgdGhpcy5zY2hlbWFDYWNoZVR0bCA9IG1vbmdvT3B0aW9ucy5zY2hlbWFDYWNoZVR0bDtcbiAgICB0aGlzLmRpc2FibGVJbmRleEZpZWxkVmFsaWRhdGlvbiA9ICEhbW9uZ29PcHRpb25zLmRpc2FibGVJbmRleEZpZWxkVmFsaWRhdGlvbjtcbiAgICB0aGlzLl9sb2dDbGllbnRFdmVudHMgPSBtb25nb09wdGlvbnMubG9nQ2xpZW50RXZlbnRzO1xuICAgIHRoaXMuX2NsaWVudE1ldGFkYXRhID0gbW9uZ29PcHRpb25zLmNsaWVudE1ldGFkYXRhO1xuXG4gICAgLy8gQ3JlYXRlIGEgY29weSBvZiBtb25nb09wdGlvbnMgYW5kIHJlbW92ZSBQYXJzZSBTZXJ2ZXItc3BlY2lmaWMgb3B0aW9ucyB0aGF0IHNob3VsZCBub3RcbiAgICAvLyBiZSBwYXNzZWQgdG8gTW9uZ29EQiBjbGllbnQuIE5vdGU6IFdlIG9ubHkgZGVsZXRlIGZyb20gdGhpcy5fbW9uZ29PcHRpb25zLCBub3QgZnJvbSB0aGVcbiAgICAvLyBvcmlnaW5hbCBtb25nb09wdGlvbnMgb2JqZWN0LCBiZWNhdXNlIG90aGVyIGNvbXBvbmVudHMgKGxpa2UgRGF0YWJhc2VDb250cm9sbGVyKSBuZWVkXG4gICAgLy8gYWNjZXNzIHRvIHRoZXNlIG9wdGlvbnMuXG4gICAgdGhpcy5fbW9uZ29PcHRpb25zID0geyAuLi5tb25nb09wdGlvbnMgfTtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBQYXJzZVNlcnZlckRhdGFiYXNlT3B0aW9ucykge1xuICAgICAgZGVsZXRlIHRoaXMuX21vbmdvT3B0aW9uc1trZXldO1xuICAgIH1cbiAgfVxuXG4gIHdhdGNoKGNhbGxiYWNrOiAoKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5fb25jaGFuZ2UgPSBjYWxsYmFjaztcbiAgfVxuXG4gIGNvbm5lY3QoKSB7XG4gICAgaWYgKHRoaXMuY29ubmVjdGlvblByb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICAgIH1cblxuICAgIC8vIHBhcnNpbmcgYW5kIHJlLWZvcm1hdHRpbmcgY2F1c2VzIHRoZSBhdXRoIHZhbHVlIChpZiB0aGVyZSkgdG8gZ2V0IFVSSVxuICAgIC8vIGVuY29kZWRcbiAgICBjb25zdCBlbmNvZGVkVXJpID0gZm9ybWF0VXJsKHBhcnNlVXJsKHRoaXMuX3VyaSkpO1xuXG4gICAgLy8gT25seSB1c2UgZHJpdmVySW5mbyBpZiBjbGllbnRNZXRhZGF0YSBvcHRpb24gaXMgc2V0XG4gICAgY29uc3Qgb3B0aW9ucyA9IHsgLi4udGhpcy5fbW9uZ29PcHRpb25zIH07XG4gICAgaWYgKHRoaXMuX2NsaWVudE1ldGFkYXRhKSB7XG4gICAgICBvcHRpb25zLmRyaXZlckluZm8gPSB7XG4gICAgICAgIG5hbWU6IHRoaXMuX2NsaWVudE1ldGFkYXRhLm5hbWUsXG4gICAgICAgIHZlcnNpb246IHRoaXMuX2NsaWVudE1ldGFkYXRhLnZlcnNpb25cbiAgICAgIH07XG4gICAgfVxuXG4gICAgdGhpcy5jb25uZWN0aW9uUHJvbWlzZSA9IE1vbmdvQ2xpZW50LmNvbm5lY3QoZW5jb2RlZFVyaSwgb3B0aW9ucylcbiAgICAgIC50aGVuKGNsaWVudCA9PiB7XG4gICAgICAgIC8vIFN0YXJ0aW5nIG1vbmdvREIgMy4wLCB0aGUgTW9uZ29DbGllbnQuY29ubmVjdCBkb24ndCByZXR1cm4gYSBEQiBhbnltb3JlIGJ1dCBhIGNsaWVudFxuICAgICAgICAvLyBGb3J0dW5hdGVseSwgd2UgY2FuIGdldCBiYWNrIHRoZSBvcHRpb25zIGFuZCB1c2UgdGhlbSB0byBzZWxlY3QgdGhlIHByb3BlciBEQi5cbiAgICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL21vbmdvZGIvbm9kZS1tb25nb2RiLW5hdGl2ZS9ibG9iLzJjMzVkNzZmMDg1NzQyMjViOGRiMDJkN2JlZjY4NzEyM2U2YmIwMTgvbGliL21vbmdvX2NsaWVudC5qcyNMODg1XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSBjbGllbnQucy5vcHRpb25zO1xuICAgICAgICBjb25zdCBkYXRhYmFzZSA9IGNsaWVudC5kYihvcHRpb25zLmRiTmFtZSk7XG4gICAgICAgIGlmICghZGF0YWJhc2UpIHtcbiAgICAgICAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY2xpZW50Lm9uKCdlcnJvcicsICgpID0+IHtcbiAgICAgICAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNsaWVudC5vbignY2xvc2UnLCAoKSA9PiB7XG4gICAgICAgICAgZGVsZXRlIHRoaXMuY29ubmVjdGlvblByb21pc2U7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFNldCB1cCBjbGllbnQgZXZlbnQgbG9nZ2luZyBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmICh0aGlzLl9sb2dDbGllbnRFdmVudHMgJiYgQXJyYXkuaXNBcnJheSh0aGlzLl9sb2dDbGllbnRFdmVudHMpKSB7XG4gICAgICAgICAgdGhpcy5fbG9nQ2xpZW50RXZlbnRzLmZvckVhY2goZXZlbnRDb25maWcgPT4ge1xuICAgICAgICAgICAgY2xpZW50Lm9uKGV2ZW50Q29uZmlnLm5hbWUsIGV2ZW50ID0+IHtcbiAgICAgICAgICAgICAgbGV0IGxvZ0RhdGEgPSB7fTtcbiAgICAgICAgICAgICAgaWYgKCFldmVudENvbmZpZy5rZXlzIHx8IGV2ZW50Q29uZmlnLmtleXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgbG9nRGF0YSA9IGV2ZW50O1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV2ZW50Q29uZmlnLmtleXMuZm9yRWFjaChrZXlQYXRoID0+IHtcbiAgICAgICAgICAgICAgICAgIGxvZ0RhdGFba2V5UGF0aF0gPSBfLmdldChldmVudCwga2V5UGF0aCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAvLyBWYWxpZGF0ZSBsb2cgbGV2ZWwgZXhpc3RzLCBmYWxsYmFjayB0byAnaW5mbydcbiAgICAgICAgICAgICAgY29uc3QgbG9nTGV2ZWwgPSB0eXBlb2YgbG9nZ2VyW2V2ZW50Q29uZmlnLmxvZ0xldmVsXSA9PT0gJ2Z1bmN0aW9uJyA/IGV2ZW50Q29uZmlnLmxvZ0xldmVsIDogJ2luZm8nO1xuXG4gICAgICAgICAgICAgIC8vIFNhZmUgSlNPTiBzZXJpYWxpemF0aW9uIHdpdGggTWFwL1NldCBhbmQgY2lyY3VsYXIgcmVmZXJlbmNlIHN1cHBvcnRcbiAgICAgICAgICAgICAgY29uc3QgbG9nTWVzc2FnZSA9IGBNb25nb0RCIGNsaWVudCBldmVudCAke2V2ZW50Q29uZmlnLm5hbWV9OiAke0pTT04uc3RyaW5naWZ5KGxvZ0RhdGEsIFV0aWxzLmdldENpcmN1bGFyUmVwbGFjZXIoKSl9YDtcblxuICAgICAgICAgICAgICBsb2dnZXJbbG9nTGV2ZWxdKGxvZ01lc3NhZ2UpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmNsaWVudCA9IGNsaWVudDtcbiAgICAgICAgdGhpcy5kYXRhYmFzZSA9IGRhdGFiYXNlO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KGVycik7XG4gICAgICB9KTtcblxuICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICB9XG5cbiAgaGFuZGxlRXJyb3I8VD4oZXJyb3I6ID8oRXJyb3IgfCBQYXJzZS5FcnJvcikpOiBQcm9taXNlPFQ+IHtcbiAgICBpZiAoZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gMTMpIHtcbiAgICAgIC8vIFVuYXV0aG9yaXplZCBlcnJvclxuICAgICAgZGVsZXRlIHRoaXMuY2xpZW50O1xuICAgICAgZGVsZXRlIHRoaXMuZGF0YWJhc2U7XG4gICAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICAgIGxvZ2dlci5lcnJvcignUmVjZWl2ZWQgdW5hdXRob3JpemVkIGVycm9yJywgeyBlcnJvcjogZXJyb3IgfSk7XG4gICAgfVxuXG4gICAgLy8gVHJhbnNmb3JtIGluZnJhc3RydWN0dXJlL3RyYW5zaWVudCBlcnJvcnMgaW50byBQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1JcbiAgICBpZiAoaXNUcmFuc2llbnRFcnJvcihlcnJvcikpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignRGF0YWJhc2UgdHJhbnNpZW50IGVycm9yJywgZXJyb3IpO1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUiwgJ0RhdGFiYXNlIGVycm9yJyk7XG4gICAgfVxuXG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cblxuICBhc3luYyBoYW5kbGVTaHV0ZG93bigpIHtcbiAgICBpZiAoIXRoaXMuY2xpZW50KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuY2xpZW50LmNsb3NlKGZhbHNlKTtcbiAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgfVxuXG4gIF9hZGFwdGl2ZUNvbGxlY3Rpb24obmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdCgpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLmRhdGFiYXNlLmNvbGxlY3Rpb24odGhpcy5fY29sbGVjdGlvblByZWZpeCArIG5hbWUpKVxuICAgICAgLnRoZW4ocmF3Q29sbGVjdGlvbiA9PiBuZXcgTW9uZ29Db2xsZWN0aW9uKHJhd0NvbGxlY3Rpb24pKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgX3NjaGVtYUNvbGxlY3Rpb24oKTogUHJvbWlzZTxNb25nb1NjaGVtYUNvbGxlY3Rpb24+IHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0KClcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihNb25nb1NjaGVtYUNvbGxlY3Rpb25OYW1lKSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4ge1xuICAgICAgICBpZiAoIXRoaXMuX3N0cmVhbSAmJiB0aGlzLmVuYWJsZVNjaGVtYUhvb2tzKSB7XG4gICAgICAgICAgdGhpcy5fc3RyZWFtID0gY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLndhdGNoKCk7XG4gICAgICAgICAgdGhpcy5fc3RyZWFtLm9uKCdjaGFuZ2UnLCAoKSA9PiB0aGlzLl9vbmNoYW5nZSgpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IE1vbmdvU2NoZW1hQ29sbGVjdGlvbihjb2xsZWN0aW9uKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgY2xhc3NFeGlzdHMobmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdCgpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLmRhdGFiYXNlLmxpc3RDb2xsZWN0aW9ucyh7IG5hbWU6IHRoaXMuX2NvbGxlY3Rpb25QcmVmaXggKyBuYW1lIH0pLnRvQXJyYXkoKTtcbiAgICAgIH0pXG4gICAgICAudGhlbihjb2xsZWN0aW9ucyA9PiB7XG4gICAgICAgIHJldHVybiBjb2xsZWN0aW9ucy5sZW5ndGggPiAwO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIHNldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWU6IHN0cmluZywgQ0xQczogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKVxuICAgICAgLnRoZW4oc2NoZW1hQ29sbGVjdGlvbiA9PlxuICAgICAgICBzY2hlbWFDb2xsZWN0aW9uLnVwZGF0ZVNjaGVtYShjbGFzc05hbWUsIHtcbiAgICAgICAgICAkc2V0OiB7ICdfbWV0YWRhdGEuY2xhc3NfcGVybWlzc2lvbnMnOiBDTFBzIH0sXG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdChcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBzdWJtaXR0ZWRJbmRleGVzOiBhbnksXG4gICAgZXhpc3RpbmdJbmRleGVzOiBhbnkgPSB7fSxcbiAgICBmaWVsZHM6IGFueVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoc3VibWl0dGVkSW5kZXhlcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICAgIGlmIChPYmplY3Qua2V5cyhleGlzdGluZ0luZGV4ZXMpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgZXhpc3RpbmdJbmRleGVzID0geyBfaWRfOiB7IF9pZDogMSB9IH07XG4gICAgfVxuICAgIGNvbnN0IGRlbGV0ZVByb21pc2VzID0gW107XG4gICAgY29uc3QgaW5zZXJ0ZWRJbmRleGVzID0gW107XG4gICAgT2JqZWN0LmtleXMoc3VibWl0dGVkSW5kZXhlcykuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgIGNvbnN0IGZpZWxkID0gc3VibWl0dGVkSW5kZXhlc1tuYW1lXTtcbiAgICAgIGlmIChleGlzdGluZ0luZGV4ZXNbbmFtZV0gJiYgZmllbGQuX19vcCAhPT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGBJbmRleCAke25hbWV9IGV4aXN0cywgY2Fubm90IHVwZGF0ZS5gKTtcbiAgICAgIH1cbiAgICAgIGlmICghZXhpc3RpbmdJbmRleGVzW25hbWVdICYmIGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgICAgIGBJbmRleCAke25hbWV9IGRvZXMgbm90IGV4aXN0LCBjYW5ub3QgZGVsZXRlLmBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZC5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICBjb25zdCBwcm9taXNlID0gdGhpcy5kcm9wSW5kZXgoY2xhc3NOYW1lLCBuYW1lKTtcbiAgICAgICAgZGVsZXRlUHJvbWlzZXMucHVzaChwcm9taXNlKTtcbiAgICAgICAgZGVsZXRlIGV4aXN0aW5nSW5kZXhlc1tuYW1lXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIE9iamVjdC5rZXlzKGZpZWxkKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgIXRoaXMuZGlzYWJsZUluZGV4RmllbGRWYWxpZGF0aW9uICYmXG4gICAgICAgICAgICAhT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKFxuICAgICAgICAgICAgICBmaWVsZHMsXG4gICAgICAgICAgICAgIGtleS5pbmRleE9mKCdfcF8nKSA9PT0gMCA/IGtleS5yZXBsYWNlKCdfcF8nLCAnJykgOiBrZXlcbiAgICAgICAgICAgIClcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgICAgICAgYEZpZWxkICR7a2V5fSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGFkZCBpbmRleC5gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGV4aXN0aW5nSW5kZXhlc1tuYW1lXSA9IGZpZWxkO1xuICAgICAgICBpbnNlcnRlZEluZGV4ZXMucHVzaCh7XG4gICAgICAgICAga2V5OiBmaWVsZCxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBsZXQgaW5zZXJ0UHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIGlmIChpbnNlcnRlZEluZGV4ZXMubGVuZ3RoID4gMCkge1xuICAgICAgaW5zZXJ0UHJvbWlzZSA9IHRoaXMuY3JlYXRlSW5kZXhlcyhjbGFzc05hbWUsIGluc2VydGVkSW5kZXhlcyk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLmFsbChkZWxldGVQcm9taXNlcylcbiAgICAgIC50aGVuKCgpID0+IGluc2VydFByb21pc2UpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKCkpXG4gICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+XG4gICAgICAgIHNjaGVtYUNvbGxlY3Rpb24udXBkYXRlU2NoZW1hKGNsYXNzTmFtZSwge1xuICAgICAgICAgICRzZXQ6IHsgJ19tZXRhZGF0YS5pbmRleGVzJzogZXhpc3RpbmdJbmRleGVzIH0sXG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBzZXRJbmRleGVzRnJvbU1vbmdvKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0SW5kZXhlcyhjbGFzc05hbWUpXG4gICAgICAudGhlbihpbmRleGVzID0+IHtcbiAgICAgICAgaW5kZXhlcyA9IGluZGV4ZXMucmVkdWNlKChvYmosIGluZGV4KSA9PiB7XG4gICAgICAgICAgaWYgKGluZGV4LmtleS5fZnRzKSB7XG4gICAgICAgICAgICBkZWxldGUgaW5kZXgua2V5Ll9mdHM7XG4gICAgICAgICAgICBkZWxldGUgaW5kZXgua2V5Ll9mdHN4O1xuICAgICAgICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBpbmRleC53ZWlnaHRzKSB7XG4gICAgICAgICAgICAgIGluZGV4LmtleVtmaWVsZF0gPSAndGV4dCc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIG9ialtpbmRleC5uYW1lXSA9IGluZGV4LmtleTtcbiAgICAgICAgICByZXR1cm4gb2JqO1xuICAgICAgICB9LCB7fSk7XG4gICAgICAgIHJldHVybiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKCkudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+XG4gICAgICAgICAgc2NoZW1hQ29sbGVjdGlvbi51cGRhdGVTY2hlbWEoY2xhc3NOYW1lLCB7XG4gICAgICAgICAgICAkc2V0OiB7ICdfbWV0YWRhdGEuaW5kZXhlcyc6IGluZGV4ZXMgfSxcbiAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKVxuICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgLy8gSWdub3JlIGlmIGNvbGxlY3Rpb24gbm90IGZvdW5kXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgY3JlYXRlQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb09iamVjdCA9IG1vbmdvU2NoZW1hRnJvbUZpZWxkc0FuZENsYXNzTmFtZUFuZENMUChcbiAgICAgIHNjaGVtYS5maWVsZHMsXG4gICAgICBjbGFzc05hbWUsXG4gICAgICBzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgICAgc2NoZW1hLmluZGV4ZXNcbiAgICApO1xuICAgIG1vbmdvT2JqZWN0Ll9pZCA9IGNsYXNzTmFtZTtcbiAgICByZXR1cm4gdGhpcy5zZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdChjbGFzc05hbWUsIHNjaGVtYS5pbmRleGVzLCB7fSwgc2NoZW1hLmZpZWxkcylcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKSlcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi5pbnNlcnRTY2hlbWEobW9uZ29PYmplY3QpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlRmllbGRPcHRpb25zKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZywgdHlwZTogYW55KSB7XG4gICAgY29uc3Qgc2NoZW1hQ29sbGVjdGlvbiA9IGF3YWl0IHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKTtcbiAgICBhd2FpdCBzY2hlbWFDb2xsZWN0aW9uLnVwZGF0ZUZpZWxkT3B0aW9ucyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZSk7XG4gIH1cblxuICBhZGRGaWVsZElmTm90RXhpc3RzKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZywgdHlwZTogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKVxuICAgICAgLnRoZW4oc2NoZW1hQ29sbGVjdGlvbiA9PiBzY2hlbWFDb2xsZWN0aW9uLmFkZEZpZWxkSWZOb3RFeGlzdHMoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHR5cGUpKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5jcmVhdGVJbmRleGVzSWZOZWVkZWQoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHR5cGUpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gRHJvcHMgYSBjb2xsZWN0aW9uLiBSZXNvbHZlcyB3aXRoIHRydWUgaWYgaXQgd2FzIGEgUGFyc2UgU2NoZW1hIChlZy4gX1VzZXIsIEN1c3RvbSwgZXRjLilcbiAgLy8gYW5kIHJlc29sdmVzIHdpdGggZmFsc2UgaWYgaXQgd2Fzbid0IChlZy4gYSBqb2luIHRhYmxlKS4gUmVqZWN0cyBpZiBkZWxldGlvbiB3YXMgaW1wb3NzaWJsZS5cbiAgZGVsZXRlQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLmRyb3AoKSlcbiAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICAvLyAnbnMgbm90IGZvdW5kJyBtZWFucyBjb2xsZWN0aW9uIHdhcyBhbHJlYWR5IGdvbmUuIElnbm9yZSBkZWxldGlvbiBhdHRlbXB0LlxuICAgICAgICAgIGlmIChlcnJvci5tZXNzYWdlID09ICducyBub3QgZm91bmQnKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9KVxuICAgICAgICAvLyBXZSd2ZSBkcm9wcGVkIHRoZSBjb2xsZWN0aW9uLCBub3cgcmVtb3ZlIHRoZSBfU0NIRU1BIGRvY3VtZW50XG4gICAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKSlcbiAgICAgICAgLnRoZW4oc2NoZW1hQ29sbGVjdGlvbiA9PiBzY2hlbWFDb2xsZWN0aW9uLmZpbmRBbmREZWxldGVTY2hlbWEoY2xhc3NOYW1lKSlcbiAgICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpXG4gICAgKTtcbiAgfVxuXG4gIGRlbGV0ZUFsbENsYXNzZXMoZmFzdDogYm9vbGVhbikge1xuICAgIHJldHVybiBzdG9yYWdlQWRhcHRlckFsbENvbGxlY3Rpb25zKHRoaXMpLnRoZW4oY29sbGVjdGlvbnMgPT5cbiAgICAgIFByb21pc2UuYWxsKFxuICAgICAgICBjb2xsZWN0aW9ucy5tYXAoY29sbGVjdGlvbiA9PiAoZmFzdCA/IGNvbGxlY3Rpb24uZGVsZXRlTWFueSh7fSkgOiBjb2xsZWN0aW9uLmRyb3AoKSkpXG4gICAgICApXG4gICAgKTtcbiAgfVxuXG4gIC8vIFJlbW92ZSB0aGUgY29sdW1uIGFuZCBhbGwgdGhlIGRhdGEuIEZvciBSZWxhdGlvbnMsIHRoZSBfSm9pbiBjb2xsZWN0aW9uIGlzIGhhbmRsZWRcbiAgLy8gc3BlY2lhbGx5LCB0aGlzIGZ1bmN0aW9uIGRvZXMgbm90IGRlbGV0ZSBfSm9pbiBjb2x1bW5zLiBJdCBzaG91bGQsIGhvd2V2ZXIsIGluZGljYXRlXG4gIC8vIHRoYXQgdGhlIHJlbGF0aW9uIGZpZWxkcyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBJbiBtb25nbywgdGhpcyBtZWFucyByZW1vdmluZyBpdCBmcm9tXG4gIC8vIHRoZSBfU0NIRU1BIGNvbGxlY3Rpb24uICBUaGVyZSBzaG91bGQgYmUgbm8gYWN0dWFsIGRhdGEgaW4gdGhlIGNvbGxlY3Rpb24gdW5kZXIgdGhlIHNhbWUgbmFtZVxuICAvLyBhcyB0aGUgcmVsYXRpb24gY29sdW1uLCBzbyBpdCdzIGZpbmUgdG8gYXR0ZW1wdCB0byBkZWxldGUgaXQuIElmIHRoZSBmaWVsZHMgbGlzdGVkIHRvIGJlXG4gIC8vIGRlbGV0ZWQgZG8gbm90IGV4aXN0LCB0aGlzIGZ1bmN0aW9uIHNob3VsZCByZXR1cm4gc3VjY2Vzc2Z1bGx5IGFueXdheXMuIENoZWNraW5nIGZvclxuICAvLyBhdHRlbXB0cyB0byBkZWxldGUgbm9uLWV4aXN0ZW50IGZpZWxkcyBpcyB0aGUgcmVzcG9uc2liaWxpdHkgb2YgUGFyc2UgU2VydmVyLlxuXG4gIC8vIFBvaW50ZXIgZmllbGQgbmFtZXMgYXJlIHBhc3NlZCBmb3IgbGVnYWN5IHJlYXNvbnM6IHRoZSBvcmlnaW5hbCBtb25nb1xuICAvLyBmb3JtYXQgc3RvcmVkIHBvaW50ZXIgZmllbGQgbmFtZXMgZGlmZmVyZW50bHkgaW4gdGhlIGRhdGFiYXNlLCBhbmQgdGhlcmVmb3JlXG4gIC8vIG5lZWRlZCB0byBrbm93IHRoZSB0eXBlIG9mIHRoZSBmaWVsZCBiZWZvcmUgaXQgY291bGQgZGVsZXRlIGl0LiBGdXR1cmUgZGF0YWJhc2VcbiAgLy8gYWRhcHRlcnMgc2hvdWxkIGlnbm9yZSB0aGUgcG9pbnRlckZpZWxkTmFtZXMgYXJndW1lbnQuIEFsbCB0aGUgZmllbGQgbmFtZXMgYXJlIGluXG4gIC8vIGZpZWxkTmFtZXMsIHRoZXkgc2hvdyB1cCBhZGRpdGlvbmFsbHkgaW4gdGhlIHBvaW50ZXJGaWVsZE5hbWVzIGRhdGFiYXNlIGZvciB1c2VcbiAgLy8gYnkgdGhlIG1vbmdvIGFkYXB0ZXIsIHdoaWNoIGRlYWxzIHdpdGggdGhlIGxlZ2FjeSBtb25nbyBmb3JtYXQuXG5cbiAgLy8gVGhpcyBmdW5jdGlvbiBpcyBub3Qgb2JsaWdhdGVkIHRvIGRlbGV0ZSBmaWVsZHMgYXRvbWljYWxseS4gSXQgaXMgZ2l2ZW4gdGhlIGZpZWxkXG4gIC8vIG5hbWVzIGluIGEgbGlzdCBzbyB0aGF0IGRhdGFiYXNlcyB0aGF0IGFyZSBjYXBhYmxlIG9mIGRlbGV0aW5nIGZpZWxkcyBhdG9taWNhbGx5XG4gIC8vIG1heSBkbyBzby5cblxuICAvLyBSZXR1cm5zIGEgUHJvbWlzZS5cbiAgZGVsZXRlRmllbGRzKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGZpZWxkTmFtZXM6IHN0cmluZ1tdKSB7XG4gICAgY29uc3QgbW9uZ29Gb3JtYXROYW1lcyA9IGZpZWxkTmFtZXMubWFwKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICByZXR1cm4gYF9wXyR7ZmllbGROYW1lfWA7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gZmllbGROYW1lO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGNvbnN0IGNvbGxlY3Rpb25VcGRhdGUgPSB7ICR1bnNldDoge30gfTtcbiAgICBtb25nb0Zvcm1hdE5hbWVzLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICBjb2xsZWN0aW9uVXBkYXRlWyckdW5zZXQnXVtuYW1lXSA9IG51bGw7XG4gICAgfSk7XG5cbiAgICBjb25zdCBjb2xsZWN0aW9uRmlsdGVyID0geyAkb3I6IFtdIH07XG4gICAgbW9uZ29Gb3JtYXROYW1lcy5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgY29sbGVjdGlvbkZpbHRlclsnJG9yJ10ucHVzaCh7IFtuYW1lXTogeyAkZXhpc3RzOiB0cnVlIH0gfSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBzY2hlbWFVcGRhdGUgPSB7ICR1bnNldDoge30gfTtcbiAgICBmaWVsZE5hbWVzLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICBzY2hlbWFVcGRhdGVbJyR1bnNldCddW25hbWVdID0gbnVsbDtcbiAgICAgIHNjaGVtYVVwZGF0ZVsnJHVuc2V0J11bYF9tZXRhZGF0YS5maWVsZHNfb3B0aW9ucy4ke25hbWV9YF0gPSBudWxsO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24udXBkYXRlTWFueShjb2xsZWN0aW9uRmlsdGVyLCBjb2xsZWN0aW9uVXBkYXRlKSlcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKSlcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi51cGRhdGVTY2hlbWEoY2xhc3NOYW1lLCBzY2hlbWFVcGRhdGUpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgcHJvbWlzZSBmb3IgYWxsIHNjaGVtYXMga25vd24gdG8gdGhpcyBhZGFwdGVyLCBpbiBQYXJzZSBmb3JtYXQuIEluIGNhc2UgdGhlXG4gIC8vIHNjaGVtYXMgY2Fubm90IGJlIHJldHJpZXZlZCwgcmV0dXJucyBhIHByb21pc2UgdGhhdCByZWplY3RzLiBSZXF1aXJlbWVudHMgZm9yIHRoZVxuICAvLyByZWplY3Rpb24gcmVhc29uIGFyZSBUQkQuXG4gIGdldEFsbENsYXNzZXMoKTogUHJvbWlzZTxTdG9yYWdlQ2xhc3NbXT4ge1xuICAgIHJldHVybiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKClcbiAgICAgIC50aGVuKHNjaGVtYXNDb2xsZWN0aW9uID0+IHNjaGVtYXNDb2xsZWN0aW9uLl9mZXRjaEFsbFNjaGVtYXNGcm9tX1NDSEVNQSgpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgcHJvbWlzZSBmb3IgdGhlIHNjaGVtYSB3aXRoIHRoZSBnaXZlbiBuYW1lLCBpbiBQYXJzZSBmb3JtYXQuIElmXG4gIC8vIHRoaXMgYWRhcHRlciBkb2Vzbid0IGtub3cgYWJvdXQgdGhlIHNjaGVtYSwgcmV0dXJuIGEgcHJvbWlzZSB0aGF0IHJlamVjdHMgd2l0aFxuICAvLyB1bmRlZmluZWQgYXMgdGhlIHJlYXNvbi5cbiAgZ2V0Q2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpOiBQcm9taXNlPFN0b3JhZ2VDbGFzcz4ge1xuICAgIHJldHVybiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKClcbiAgICAgIC50aGVuKHNjaGVtYXNDb2xsZWN0aW9uID0+IHNjaGVtYXNDb2xsZWN0aW9uLl9mZXRjaE9uZVNjaGVtYUZyb21fU0NIRU1BKGNsYXNzTmFtZSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBUT0RPOiBBcyB5ZXQgbm90IHBhcnRpY3VsYXJseSB3ZWxsIHNwZWNpZmllZC4gQ3JlYXRlcyBhbiBvYmplY3QuIE1heWJlIHNob3VsZG4ndCBldmVuIG5lZWQgdGhlIHNjaGVtYSxcbiAgLy8gYW5kIHNob3VsZCBpbmZlciBmcm9tIHRoZSB0eXBlLiBPciBtYXliZSBkb2VzIG5lZWQgdGhlIHNjaGVtYSBmb3IgdmFsaWRhdGlvbnMuIE9yIG1heWJlIG5lZWRzXG4gIC8vIHRoZSBzY2hlbWEgb25seSBmb3IgdGhlIGxlZ2FjeSBtb25nbyBmb3JtYXQuIFdlJ2xsIGZpZ3VyZSB0aGF0IG91dCBsYXRlci5cbiAgY3JlYXRlT2JqZWN0KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIG9iamVjdDogYW55LCB0cmFuc2FjdGlvbmFsU2Vzc2lvbjogP2FueSkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb09iamVjdCA9IHBhcnNlT2JqZWN0VG9Nb25nb09iamVjdEZvckNyZWF0ZShjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5pbnNlcnRPbmUobW9uZ29PYmplY3QsIHRyYW5zYWN0aW9uYWxTZXNzaW9uKSlcbiAgICAgIC50aGVuKCgpID0+ICh7IG9wczogW21vbmdvT2JqZWN0XSB9KSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSAxMTAwMCkge1xuICAgICAgICAgIGxvZ2dlci5lcnJvcignRHVwbGljYXRlIGtleSBlcnJvcjonLCBlcnJvci5tZXNzYWdlKTtcbiAgICAgICAgICBjb25zdCBlcnIgPSBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsXG4gICAgICAgICAgICAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCdcbiAgICAgICAgICApO1xuICAgICAgICAgIGVyci51bmRlcmx5aW5nRXJyb3IgPSBlcnJvcjtcbiAgICAgICAgICBpZiAoZXJyb3IubWVzc2FnZSkge1xuICAgICAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGVycm9yLm1lc3NhZ2UubWF0Y2goL2luZGV4OltcXHNhLXpBLVowLTlfXFwtXFwuXStcXCQ/KFthLXpBLVpfLV0rKV8xLyk7XG4gICAgICAgICAgICBpZiAobWF0Y2hlcyAmJiBBcnJheS5pc0FycmF5KG1hdGNoZXMpKSB7XG4gICAgICAgICAgICAgIGVyci51c2VySW5mbyA9IHsgZHVwbGljYXRlZF9maWVsZDogbWF0Y2hlc1sxXSB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIGF1dGhEYXRhIHVuaXF1ZSBpbmRleCB2aW9sYXRpb25zXG4gICAgICAgICAgICBpZiAoIWVyci51c2VySW5mbykge1xuICAgICAgICAgICAgICBjb25zdCBhdXRoRGF0YU1hdGNoID0gZXJyb3IubWVzc2FnZS5tYXRjaCgvaW5kZXg6XFxzKyhfYXV0aF9kYXRhX1thLXpBLVowLTlfXStfaWQpLyk7XG4gICAgICAgICAgICAgIGlmIChhdXRoRGF0YU1hdGNoKSB7XG4gICAgICAgICAgICAgICAgZXJyLnVzZXJJbmZvID0geyBkdXBsaWNhdGVkX2ZpZWxkOiBhdXRoRGF0YU1hdGNoWzFdIH07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgb2JqZWN0cyB0aGF0IG1hdGNoIHRoZSBnaXZlbiBQYXJzZSBRdWVyeS5cbiAgLy8gSWYgbm8gb2JqZWN0cyBtYXRjaCwgcmVqZWN0IHdpdGggT0JKRUNUX05PVF9GT1VORC4gSWYgb2JqZWN0cyBhcmUgZm91bmQgYW5kIGRlbGV0ZWQsIHJlc29sdmUgd2l0aCB1bmRlZmluZWQuXG4gIC8vIElmIHRoZXJlIGlzIHNvbWUgb3RoZXIgZXJyb3IsIHJlamVjdCB3aXRoIElOVEVSTkFMX1NFUlZFUl9FUlJPUi5cbiAgZGVsZXRlT2JqZWN0c0J5UXVlcnkoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgdHJhbnNhY3Rpb25hbFNlc3Npb246ID9hbnlcbiAgKSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiB7XG4gICAgICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgICAgICByZXR1cm4gY29sbGVjdGlvbi5kZWxldGVNYW55KG1vbmdvV2hlcmUsIHRyYW5zYWN0aW9uYWxTZXNzaW9uKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSlcbiAgICAgIC50aGVuKFxuICAgICAgICAoeyBkZWxldGVkQ291bnQgfSkgPT4ge1xuICAgICAgICAgIGlmIChkZWxldGVkQ291bnQgPT09IDApIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnT2JqZWN0IG5vdCBmb3VuZC4nKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9LFxuICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUiwgJ0RhdGFiYXNlIGFkYXB0ZXIgZXJyb3InKTtcbiAgICAgICAgfVxuICAgICAgKTtcbiAgfVxuXG4gIC8vIEFwcGx5IHRoZSB1cGRhdGUgdG8gYWxsIG9iamVjdHMgdGhhdCBtYXRjaCB0aGUgZ2l2ZW4gUGFyc2UgUXVlcnkuXG4gIHVwZGF0ZU9iamVjdHNCeVF1ZXJ5KFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBxdWVyeTogUXVlcnlUeXBlLFxuICAgIHVwZGF0ZTogYW55LFxuICAgIHRyYW5zYWN0aW9uYWxTZXNzaW9uOiA/YW55XG4gICkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1VwZGF0ZSA9IHRyYW5zZm9ybVVwZGF0ZShjbGFzc05hbWUsIHVwZGF0ZSwgc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1doZXJlID0gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi51cGRhdGVNYW55KG1vbmdvV2hlcmUsIG1vbmdvVXBkYXRlLCB0cmFuc2FjdGlvbmFsU2Vzc2lvbikpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBBdG9taWNhbGx5IGZpbmRzIGFuZCB1cGRhdGVzIGFuIG9iamVjdCBiYXNlZCBvbiBxdWVyeS5cbiAgLy8gUmV0dXJuIHZhbHVlIG5vdCBjdXJyZW50bHkgd2VsbCBzcGVjaWZpZWQuXG4gIGZpbmRPbmVBbmRVcGRhdGUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgdXBkYXRlOiBhbnksXG4gICAgdHJhbnNhY3Rpb25hbFNlc3Npb246ID9hbnlcbiAgKSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvVXBkYXRlID0gdHJhbnNmb3JtVXBkYXRlKGNsYXNzTmFtZSwgdXBkYXRlLCBzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PlxuICAgICAgICBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uZmluZE9uZUFuZFVwZGF0ZShtb25nb1doZXJlLCBtb25nb1VwZGF0ZSwge1xuICAgICAgICAgIHJldHVybkRvY3VtZW50OiAnYWZ0ZXInLFxuICAgICAgICAgIHNlc3Npb246IHRyYW5zYWN0aW9uYWxTZXNzaW9uIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC50aGVuKHJlc3VsdCA9PiBtb25nb09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCByZXN1bHQsIHNjaGVtYSkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gMTEwMDApIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoJ0R1cGxpY2F0ZSBrZXkgZXJyb3I6JywgZXJyb3IubWVzc2FnZSk7XG4gICAgICAgICAgY29uc3QgZXJyID0gbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLFxuICAgICAgICAgICAgJ0EgZHVwbGljYXRlIHZhbHVlIGZvciBhIGZpZWxkIHdpdGggdW5pcXVlIHZhbHVlcyB3YXMgcHJvdmlkZWQnXG4gICAgICAgICAgKTtcbiAgICAgICAgICBlcnIudW5kZXJseWluZ0Vycm9yID0gZXJyb3I7XG4gICAgICAgICAgaWYgKGVycm9yLm1lc3NhZ2UpIHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSBlcnJvci5tZXNzYWdlLm1hdGNoKFxuICAgICAgICAgICAgICAvaW5kZXg6W1xcc2EtekEtWjAtOV9cXC1cXC5dK1xcJD8oW2EtekEtWl8tXSspXzEvXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgaWYgKG1hdGNoZXMgJiYgQXJyYXkuaXNBcnJheShtYXRjaGVzKSkge1xuICAgICAgICAgICAgICBlcnIudXNlckluZm8gPSB7IGR1cGxpY2F0ZWRfZmllbGQ6IG1hdGNoZXNbMV0gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghZXJyLnVzZXJJbmZvKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGF1dGhEYXRhTWF0Y2ggPSBlcnJvci5tZXNzYWdlLm1hdGNoKC9pbmRleDpcXHMrKF9hdXRoX2RhdGFfW2EtekEtWjAtOV9dK19pZCkvKTtcbiAgICAgICAgICAgICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgICAgICAgICAgICBlcnIudXNlckluZm8gPSB7IGR1cGxpY2F0ZWRfZmllbGQ6IGF1dGhEYXRhTWF0Y2hbMV0gfTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gSG9wZWZ1bGx5IHdlIGNhbiBnZXQgcmlkIG9mIHRoaXMuIEl0J3Mgb25seSB1c2VkIGZvciBjb25maWcgYW5kIGhvb2tzLlxuICB1cHNlcnRPbmVPYmplY3QoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgdXBkYXRlOiBhbnksXG4gICAgdHJhbnNhY3Rpb25hbFNlc3Npb246ID9hbnlcbiAgKSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvVXBkYXRlID0gdHJhbnNmb3JtVXBkYXRlKGNsYXNzTmFtZSwgdXBkYXRlLCBzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLnVwc2VydE9uZShtb25nb1doZXJlLCBtb25nb1VwZGF0ZSwgdHJhbnNhY3Rpb25hbFNlc3Npb24pKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gRXhlY3V0ZXMgYSBmaW5kLiBBY2NlcHRzOiBjbGFzc05hbWUsIHF1ZXJ5IGluIFBhcnNlIGZvcm1hdCwgYW5kIHsgc2tpcCwgbGltaXQsIHNvcnQgfS5cbiAgZmluZChcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBzY2hlbWE6IFNjaGVtYVR5cGUsXG4gICAgcXVlcnk6IFF1ZXJ5VHlwZSxcbiAgICB7XG4gICAgICBza2lwLFxuICAgICAgbGltaXQsXG4gICAgICBzb3J0LFxuICAgICAga2V5cyxcbiAgICAgIHJlYWRQcmVmZXJlbmNlLFxuICAgICAgaGludCxcbiAgICAgIGNhc2VJbnNlbnNpdGl2ZSxcbiAgICAgIGV4cGxhaW4sXG4gICAgICBjb21tZW50LFxuICAgIH06IFF1ZXJ5T3B0aW9uc1xuICApOiBQcm9taXNlPGFueT4ge1xuICAgIHZhbGlkYXRlRXhwbGFpblZhbHVlKGV4cGxhaW4pO1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1doZXJlID0gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1NvcnQgPSBfLm1hcEtleXMoc29ydCwgKHZhbHVlLCBmaWVsZE5hbWUpID0+XG4gICAgICB0cmFuc2Zvcm1LZXkoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHNjaGVtYSlcbiAgICApO1xuICAgIGNvbnN0IG1vbmdvS2V5cyA9IF8ucmVkdWNlKFxuICAgICAga2V5cyxcbiAgICAgIChtZW1vLCBrZXkpID0+IHtcbiAgICAgICAgaWYgKGtleSA9PT0gJ0FDTCcpIHtcbiAgICAgICAgICBtZW1vWydfcnBlcm0nXSA9IDE7XG4gICAgICAgICAgbWVtb1snX3dwZXJtJ10gPSAxO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1lbW9bdHJhbnNmb3JtS2V5KGNsYXNzTmFtZSwga2V5LCBzY2hlbWEpXSA9IDE7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG1lbW87XG4gICAgICB9LFxuICAgICAge31cbiAgICApO1xuXG4gICAgLy8gSWYgd2UgYXJlbid0IHJlcXVlc3RpbmcgdGhlIGBfaWRgIGZpZWxkLCB3ZSBuZWVkIHRvIGV4cGxpY2l0bHkgb3B0IG91dFxuICAgIC8vIG9mIGl0LiBEb2luZyBzbyBpbiBwYXJzZS1zZXJ2ZXIgaXMgdW51c3VhbCwgYnV0IGl0IGNhbiBhbGxvdyB1cyB0b1xuICAgIC8vIG9wdGltaXplIHNvbWUgcXVlcmllcyB3aXRoIGNvdmVyaW5nIGluZGV4ZXMuXG4gICAgaWYgKGtleXMgJiYgIW1vbmdvS2V5cy5faWQpIHtcbiAgICAgIG1vbmdvS2V5cy5faWQgPSAwO1xuICAgIH1cblxuICAgIHJlYWRQcmVmZXJlbmNlID0gdGhpcy5fcGFyc2VSZWFkUHJlZmVyZW5jZShyZWFkUHJlZmVyZW5jZSk7XG4gICAgcmV0dXJuIHRoaXMuY3JlYXRlVGV4dEluZGV4ZXNJZk5lZWRlZChjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT5cbiAgICAgICAgY29sbGVjdGlvbi5maW5kKG1vbmdvV2hlcmUsIHtcbiAgICAgICAgICBza2lwLFxuICAgICAgICAgIGxpbWl0LFxuICAgICAgICAgIHNvcnQ6IG1vbmdvU29ydCxcbiAgICAgICAgICBrZXlzOiBtb25nb0tleXMsXG4gICAgICAgICAgbWF4VGltZU1TOiB0aGlzLl9tYXhUaW1lTVMsXG4gICAgICAgICAgYmF0Y2hTaXplOiB0aGlzLl9iYXRjaFNpemUsXG4gICAgICAgICAgcmVhZFByZWZlcmVuY2UsXG4gICAgICAgICAgaGludCxcbiAgICAgICAgICBjYXNlSW5zZW5zaXRpdmUsXG4gICAgICAgICAgZXhwbGFpbixcbiAgICAgICAgICBjb21tZW50LFxuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLnRoZW4ob2JqZWN0cyA9PiB7XG4gICAgICAgIGlmIChleHBsYWluKSB7XG4gICAgICAgICAgcmV0dXJuIG9iamVjdHM7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG9iamVjdHMubWFwKG9iamVjdCA9PiBtb25nb09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSkpO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGVuc3VyZUluZGV4KFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBmaWVsZE5hbWVzOiBzdHJpbmdbXSxcbiAgICBpbmRleE5hbWU6ID9zdHJpbmcsXG4gICAgY2FzZUluc2Vuc2l0aXZlOiBib29sZWFuID0gZmFsc2UsXG4gICAgb3B0aW9ucz86IE9iamVjdCA9IHt9XG4gICk6IFByb21pc2U8YW55PiB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IGluZGV4Q3JlYXRpb25SZXF1ZXN0ID0ge307XG4gICAgY29uc3QgbW9uZ29GaWVsZE5hbWVzID0gZmllbGROYW1lcy5tYXAoZmllbGROYW1lID0+IHRyYW5zZm9ybUtleShjbGFzc05hbWUsIGZpZWxkTmFtZSwgc2NoZW1hKSk7XG4gICAgbW9uZ29GaWVsZE5hbWVzLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgIGluZGV4Q3JlYXRpb25SZXF1ZXN0W2ZpZWxkTmFtZV0gPSBvcHRpb25zLmluZGV4VHlwZSAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5pbmRleFR5cGUgOiAxO1xuICAgIH0pO1xuXG4gICAgY29uc3QgZGVmYXVsdE9wdGlvbnM6IE9iamVjdCA9IHsgYmFja2dyb3VuZDogdHJ1ZSwgc3BhcnNlOiB0cnVlIH07XG4gICAgY29uc3QgaW5kZXhOYW1lT3B0aW9uczogT2JqZWN0ID0gaW5kZXhOYW1lID8geyBuYW1lOiBpbmRleE5hbWUgfSA6IHt9O1xuICAgIGNvbnN0IHR0bE9wdGlvbnM6IE9iamVjdCA9IG9wdGlvbnMudHRsICE9PSB1bmRlZmluZWQgPyB7IGV4cGlyZUFmdGVyU2Vjb25kczogb3B0aW9ucy50dGwgfSA6IHt9O1xuICAgIGNvbnN0IHNwYXJzZU9wdGlvbnM6IE9iamVjdCA9IG9wdGlvbnMuc3BhcnNlICE9PSB1bmRlZmluZWQgPyB7IHNwYXJzZTogb3B0aW9ucy5zcGFyc2UgfSA6IHt9O1xuICAgIGNvbnN0IGNhc2VJbnNlbnNpdGl2ZU9wdGlvbnM6IE9iamVjdCA9IGNhc2VJbnNlbnNpdGl2ZVxuICAgICAgPyB7IGNvbGxhdGlvbjogTW9uZ29Db2xsZWN0aW9uLmNhc2VJbnNlbnNpdGl2ZUNvbGxhdGlvbigpIH1cbiAgICAgIDoge307XG4gICAgY29uc3QgcGFydGlhbEZpbHRlck9wdGlvbnM6IE9iamVjdCA9XG4gICAgICBvcHRpb25zLnBhcnRpYWxGaWx0ZXJFeHByZXNzaW9uICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7IHBhcnRpYWxGaWx0ZXJFeHByZXNzaW9uOiBvcHRpb25zLnBhcnRpYWxGaWx0ZXJFeHByZXNzaW9uIH1cbiAgICAgICAgOiB7fTtcbiAgICBjb25zdCBpbmRleE9wdGlvbnM6IE9iamVjdCA9IHtcbiAgICAgIC4uLmRlZmF1bHRPcHRpb25zLFxuICAgICAgLi4uY2FzZUluc2Vuc2l0aXZlT3B0aW9ucyxcbiAgICAgIC4uLmluZGV4TmFtZU9wdGlvbnMsXG4gICAgICAuLi50dGxPcHRpb25zLFxuICAgICAgLi4uc3BhcnNlT3B0aW9ucyxcbiAgICAgIC4uLnBhcnRpYWxGaWx0ZXJPcHRpb25zLFxuICAgIH07XG5cbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT5cbiAgICAgICAgY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmNyZWF0ZUluZGV4KGluZGV4Q3JlYXRpb25SZXF1ZXN0LCBpbmRleE9wdGlvbnMpXG4gICAgICApXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBDcmVhdGUgYSB1bmlxdWUgaW5kZXguIFVuaXF1ZSBpbmRleGVzIG9uIG51bGxhYmxlIGZpZWxkcyBhcmUgbm90IGFsbG93ZWQuIFNpbmNlIHdlIGRvbid0XG4gIC8vIGN1cnJlbnRseSBrbm93IHdoaWNoIGZpZWxkcyBhcmUgbnVsbGFibGUgYW5kIHdoaWNoIGFyZW4ndCwgd2UgaWdub3JlIHRoYXQgY3JpdGVyaWEuXG4gIC8vIEFzIHN1Y2gsIHdlIHNob3VsZG4ndCBleHBvc2UgdGhpcyBmdW5jdGlvbiB0byB1c2VycyBvZiBwYXJzZSB1bnRpbCB3ZSBoYXZlIGFuIG91dC1vZi1iYW5kXG4gIC8vIFdheSBvZiBkZXRlcm1pbmluZyBpZiBhIGZpZWxkIGlzIG51bGxhYmxlLiBVbmRlZmluZWQgZG9lc24ndCBjb3VudCBhZ2FpbnN0IHVuaXF1ZW5lc3MsXG4gIC8vIHdoaWNoIGlzIHdoeSB3ZSB1c2Ugc3BhcnNlIGluZGV4ZXMuXG4gIGVuc3VyZVVuaXF1ZW5lc3MoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgZmllbGROYW1lczogc3RyaW5nW10pIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgaW5kZXhDcmVhdGlvblJlcXVlc3QgPSB7fTtcbiAgICBjb25zdCBtb25nb0ZpZWxkTmFtZXMgPSBmaWVsZE5hbWVzLm1hcChmaWVsZE5hbWUgPT4gdHJhbnNmb3JtS2V5KGNsYXNzTmFtZSwgZmllbGROYW1lLCBzY2hlbWEpKTtcbiAgICBtb25nb0ZpZWxkTmFtZXMuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgaW5kZXhDcmVhdGlvblJlcXVlc3RbZmllbGROYW1lXSA9IDE7XG4gICAgfSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX2Vuc3VyZVNwYXJzZVVuaXF1ZUluZGV4SW5CYWNrZ3JvdW5kKGluZGV4Q3JlYXRpb25SZXF1ZXN0KSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSAxMTAwMCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSxcbiAgICAgICAgICAgICdUcmllZCB0byBlbnN1cmUgZmllbGQgdW5pcXVlbmVzcyBmb3IgYSBjbGFzcyB0aGF0IGFscmVhZHkgaGFzIGR1cGxpY2F0ZXMuJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gQ3JlYXRlcyBhIHVuaXF1ZSBzcGFyc2UgaW5kZXggb24gX2F1dGhfZGF0YV88cHJvdmlkZXI+LmlkIHRvIHByZXZlbnRcbiAgLy8gcmFjZSBjb25kaXRpb25zIGR1cmluZyBjb25jdXJyZW50IHNpZ251cHMgd2l0aCB0aGUgc2FtZSBhdXRoRGF0YS5cbiAgZW5zdXJlQXV0aERhdGFVbmlxdWVuZXNzKHByb3ZpZGVyOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKCdfVXNlcicpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+XG4gICAgICAgIGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5jcmVhdGVJbmRleChcbiAgICAgICAgICB7IFtgX2F1dGhfZGF0YV8ke3Byb3ZpZGVyfS5pZGBdOiAxIH0sXG4gICAgICAgICAgeyB1bmlxdWU6IHRydWUsIHNwYXJzZTogdHJ1ZSwgYmFja2dyb3VuZDogdHJ1ZSwgbmFtZTogYF9hdXRoX2RhdGFfJHtwcm92aWRlcn1faWRgIH1cbiAgICAgICAgKVxuICAgICAgKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IDExMDAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLFxuICAgICAgICAgICAgJ1RyaWVkIHRvIGVuc3VyZSBmaWVsZCB1bmlxdWVuZXNzIGZvciBhIGNsYXNzIHRoYXQgYWxyZWFkeSBoYXMgZHVwbGljYXRlcy4nXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBJZ25vcmUgXCJpbmRleCBhbHJlYWR5IGV4aXN0cyB3aXRoIHNhbWUgbmFtZVwiIG9yIFwiaW5kZXggYWxyZWFkeSBleGlzdHMgd2l0aCBkaWZmZXJlbnQgb3B0aW9uc1wiXG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSA4NSB8fCBlcnJvci5jb2RlID09PSA4Nikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBVc2VkIGluIHRlc3RzXG4gIF9yYXdGaW5kKGNsYXNzTmFtZTogc3RyaW5nLCBxdWVyeTogUXVlcnlUeXBlKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+XG4gICAgICAgIGNvbGxlY3Rpb24uZmluZChxdWVyeSwge1xuICAgICAgICAgIG1heFRpbWVNUzogdGhpcy5fbWF4VGltZU1TLFxuICAgICAgICAgIGJhdGNoU2l6ZTogdGhpcy5fYmF0Y2hTaXplLFxuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gRXhlY3V0ZXMgYSBjb3VudC5cbiAgY291bnQoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgcmVhZFByZWZlcmVuY2U6ID9zdHJpbmcsXG4gICAgX2VzdGltYXRlOiA/Ym9vbGVhbixcbiAgICBoaW50OiA/bWl4ZWQsXG4gICAgY29tbWVudDogP3N0cmluZ1xuICApIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgcmVhZFByZWZlcmVuY2UgPSB0aGlzLl9wYXJzZVJlYWRQcmVmZXJlbmNlKHJlYWRQcmVmZXJlbmNlKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT5cbiAgICAgICAgY29sbGVjdGlvbi5jb3VudCh0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEsIHRydWUpLCB7XG4gICAgICAgICAgbWF4VGltZU1TOiB0aGlzLl9tYXhUaW1lTVMsXG4gICAgICAgICAgcmVhZFByZWZlcmVuY2UsXG4gICAgICAgICAgaGludCxcbiAgICAgICAgICBjb21tZW50LFxuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgZGlzdGluY3QoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgZmllbGROYW1lOiBzdHJpbmcpIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgaXNQb2ludGVyRmllbGQgPSBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdQb2ludGVyJztcbiAgICBjb25zdCB0cmFuc2Zvcm1GaWVsZCA9IHRyYW5zZm9ybUtleShjbGFzc05hbWUsIGZpZWxkTmFtZSwgc2NoZW1hKTtcblxuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PlxuICAgICAgICBjb2xsZWN0aW9uLmRpc3RpbmN0KHRyYW5zZm9ybUZpZWxkLCB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpKVxuICAgICAgKVxuICAgICAgLnRoZW4ob2JqZWN0cyA9PiB7XG4gICAgICAgIG9iamVjdHMgPSBvYmplY3RzLmZpbHRlcihvYmogPT4gb2JqICE9IG51bGwpO1xuICAgICAgICByZXR1cm4gb2JqZWN0cy5tYXAob2JqZWN0ID0+IHtcbiAgICAgICAgICBpZiAoaXNQb2ludGVyRmllbGQpIHtcbiAgICAgICAgICAgIHJldHVybiB0cmFuc2Zvcm1Qb2ludGVyU3RyaW5nKHNjaGVtYSwgZmllbGROYW1lLCBvYmplY3QpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBhZ2dyZWdhdGUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBhbnksXG4gICAgcGlwZWxpbmU6IGFueSxcbiAgICByZWFkUHJlZmVyZW5jZTogP3N0cmluZyxcbiAgICBoaW50OiA/bWl4ZWQsXG4gICAgZXhwbGFpbj86IGJvb2xlYW4sXG4gICAgY29tbWVudDogP3N0cmluZyxcbiAgICByYXdWYWx1ZXM/OiBib29sZWFuLFxuICAgIHJhd0ZpZWxkTmFtZXM/OiBib29sZWFuXG4gICkge1xuICAgIHZhbGlkYXRlRXhwbGFpblZhbHVlKGV4cGxhaW4pO1xuICAgIGlmIChyYXdWYWx1ZXMpIHtcbiAgICAgIHBpcGVsaW5lID0gRUpTT04uZGVzZXJpYWxpemUocGlwZWxpbmUpO1xuICAgIH1cbiAgICBsZXQgaXNQb2ludGVyRmllbGQgPSBmYWxzZTtcbiAgICBwaXBlbGluZSA9IHBpcGVsaW5lLm1hcChzdGFnZSA9PiB7XG4gICAgICBpZiAoc3RhZ2UuJGdyb3VwKSB7XG4gICAgICAgIHN0YWdlLiRncm91cCA9IHRoaXMuX3BhcnNlQWdncmVnYXRlR3JvdXBBcmdzKHNjaGVtYSwgc3RhZ2UuJGdyb3VwLCByYXdGaWVsZE5hbWVzKTtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHN0YWdlLiRncm91cC5faWQgJiZcbiAgICAgICAgICB0eXBlb2Ygc3RhZ2UuJGdyb3VwLl9pZCA9PT0gJ3N0cmluZycgJiZcbiAgICAgICAgICBzdGFnZS4kZ3JvdXAuX2lkLmluZGV4T2YoJyRfcF8nKSA+PSAwXG4gICAgICAgICkge1xuICAgICAgICAgIGlzUG9pbnRlckZpZWxkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHN0YWdlLiRtYXRjaCkge1xuICAgICAgICBzdGFnZS4kbWF0Y2ggPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUFyZ3Moc2NoZW1hLCBzdGFnZS4kbWF0Y2gsIHJhd1ZhbHVlcywgcmF3RmllbGROYW1lcyk7XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJHByb2plY3QpIHtcbiAgICAgICAgc3RhZ2UuJHByb2plY3QgPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZVByb2plY3RBcmdzKHNjaGVtYSwgc3RhZ2UuJHByb2plY3QsIHJhd1ZhbHVlcywgcmF3RmllbGROYW1lcyk7XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJGdlb05lYXIgJiYgc3RhZ2UuJGdlb05lYXIucXVlcnkpIHtcbiAgICAgICAgc3RhZ2UuJGdlb05lYXIucXVlcnkgPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUFyZ3Moc2NoZW1hLCBzdGFnZS4kZ2VvTmVhci5xdWVyeSwgcmF3VmFsdWVzLCByYXdGaWVsZE5hbWVzKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzdGFnZTtcbiAgICB9KTtcbiAgICByZWFkUHJlZmVyZW5jZSA9IHRoaXMuX3BhcnNlUmVhZFByZWZlcmVuY2UocmVhZFByZWZlcmVuY2UpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PlxuICAgICAgICBjb2xsZWN0aW9uLmFnZ3JlZ2F0ZShwaXBlbGluZSwge1xuICAgICAgICAgIHJlYWRQcmVmZXJlbmNlLFxuICAgICAgICAgIG1heFRpbWVNUzogdGhpcy5fbWF4VGltZU1TLFxuICAgICAgICAgIGJhdGNoU2l6ZTogdGhpcy5fYmF0Y2hTaXplLFxuICAgICAgICAgIGhpbnQsXG4gICAgICAgICAgZXhwbGFpbixcbiAgICAgICAgICBjb21tZW50LFxuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIGlmIChyYXdGaWVsZE5hbWVzKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0cy5mb3JFYWNoKHJlc3VsdCA9PiB7XG4gICAgICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChyZXN1bHQsICdfaWQnKSkge1xuICAgICAgICAgICAgaWYgKGlzUG9pbnRlckZpZWxkICYmIHJlc3VsdC5faWQpIHtcbiAgICAgICAgICAgICAgcmVzdWx0Ll9pZCA9IHJlc3VsdC5faWQuc3BsaXQoJyQnKVsxXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgcmVzdWx0Ll9pZCA9PSBudWxsIHx8XG4gICAgICAgICAgICAgIHJlc3VsdC5faWQgPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgICAgICAgIChbJ29iamVjdCcsICdzdHJpbmcnXS5pbmNsdWRlcyh0eXBlb2YgcmVzdWx0Ll9pZCkgJiYgXy5pc0VtcHR5KHJlc3VsdC5faWQpKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgIHJlc3VsdC5faWQgPSBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzdWx0Lm9iamVjdElkID0gcmVzdWx0Ll9pZDtcbiAgICAgICAgICAgIGRlbGV0ZSByZXN1bHQuX2lkO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHRzO1xuICAgICAgfSlcbiAgICAgIC50aGVuKG9iamVjdHMgPT4ge1xuICAgICAgICBpZiAocmF3VmFsdWVzKSB7XG4gICAgICAgICAgcmV0dXJuIG9iamVjdHMubWFwKG9iaiA9PiBFSlNPTi5zZXJpYWxpemUob2JqKSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJhd0ZpZWxkTmFtZXMpIHtcbiAgICAgICAgICByZXR1cm4gb2JqZWN0cztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb2JqZWN0cy5tYXAob2JqZWN0ID0+IG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiB3aWxsIHJlY3Vyc2l2ZWx5IHRyYXZlcnNlIHRoZSBwaXBlbGluZSBhbmQgY29udmVydCBhbnkgUG9pbnRlciBvciBEYXRlIGNvbHVtbnMuXG4gIC8vIElmIHdlIGRldGVjdCBhIHBvaW50ZXIgY29sdW1uIHdlIHdpbGwgcmVuYW1lIHRoZSBjb2x1bW4gYmVpbmcgcXVlcmllZCBmb3IgdG8gbWF0Y2ggdGhlIGNvbHVtblxuICAvLyBpbiB0aGUgZGF0YWJhc2UuIFdlIGFsc28gbW9kaWZ5IHRoZSB2YWx1ZSB0byB3aGF0IHdlIGV4cGVjdCB0aGUgdmFsdWUgdG8gYmUgaW4gdGhlIGRhdGFiYXNlXG4gIC8vIGFzIHdlbGwuXG4gIC8vIEZvciBkYXRlcywgdGhlIGRyaXZlciBleHBlY3RzIGEgRGF0ZSBvYmplY3QsIGJ1dCB3ZSBoYXZlIGEgc3RyaW5nIGNvbWluZyBpbi4gU28gd2UnbGwgY29udmVydFxuICAvLyB0aGUgc3RyaW5nIHRvIGEgRGF0ZSBzbyB0aGUgZHJpdmVyIGNhbiBwZXJmb3JtIHRoZSBuZWNlc3NhcnkgY29tcGFyaXNvbi5cbiAgLy9cbiAgLy8gVGhlIGdvYWwgb2YgdGhpcyBtZXRob2QgaXMgdG8gbG9vayBmb3IgdGhlIFwibGVhdmVzXCIgb2YgdGhlIHBpcGVsaW5lIGFuZCBkZXRlcm1pbmUgaWYgaXQgbmVlZHNcbiAgLy8gdG8gYmUgY29udmVydGVkLiBUaGUgcGlwZWxpbmUgY2FuIGhhdmUgYSBmZXcgZGlmZmVyZW50IGZvcm1zLiBGb3IgbW9yZSBkZXRhaWxzLCBzZWU6XG4gIC8vICAgICBodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9vcGVyYXRvci9hZ2dyZWdhdGlvbi9cbiAgLy9cbiAgLy8gSWYgdGhlIHBpcGVsaW5lIGlzIGFuIGFycmF5LCBpdCBtZWFucyB3ZSBhcmUgcHJvYmFibHkgcGFyc2luZyBhbiAnJGFuZCcgb3IgJyRvcicgb3BlcmF0b3IuIEluXG4gIC8vIHRoYXQgY2FzZSB3ZSBuZWVkIHRvIGxvb3AgdGhyb3VnaCBhbGwgb2YgaXQncyBjaGlsZHJlbiB0byBmaW5kIHRoZSBjb2x1bW5zIGJlaW5nIG9wZXJhdGVkIG9uLlxuICAvLyBJZiB0aGUgcGlwZWxpbmUgaXMgYW4gb2JqZWN0LCB0aGVuIHdlJ2xsIGxvb3AgdGhyb3VnaCB0aGUga2V5cyBjaGVja2luZyB0byBzZWUgaWYgdGhlIGtleSBuYW1lXG4gIC8vIG1hdGNoZXMgb25lIG9mIHRoZSBzY2hlbWEgY29sdW1ucy4gSWYgaXQgZG9lcyBtYXRjaCBhIGNvbHVtbiBhbmQgdGhlIGNvbHVtbiBpcyBhIFBvaW50ZXIgb3JcbiAgLy8gYSBEYXRlLCB0aGVuIHdlJ2xsIGNvbnZlcnQgdGhlIHZhbHVlIGFzIGRlc2NyaWJlZCBhYm92ZS5cbiAgLy9cbiAgLy8gQXMgbXVjaCBhcyBJIGhhdGUgcmVjdXJzaW9uLi4udGhpcyBzZWVtZWQgbGlrZSBhIGdvb2QgZml0IGZvciBpdC4gV2UncmUgZXNzZW50aWFsbHkgdHJhdmVyc2luZ1xuICAvLyBkb3duIGEgdHJlZSB0byBmaW5kIGEgXCJsZWFmIG5vZGVcIiBhbmQgY2hlY2tpbmcgdG8gc2VlIGlmIGl0IG5lZWRzIHRvIGJlIGNvbnZlcnRlZC5cbiAgX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWE6IGFueSwgcGlwZWxpbmU6IGFueSwgcmF3VmFsdWVzPzogYm9vbGVhbiwgcmF3RmllbGROYW1lcz86IGJvb2xlYW4pOiBhbnkge1xuICAgIGlmIChwaXBlbGluZSA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBlbHNlIGlmIChVdGlscy5pc0RhdGUocGlwZWxpbmUpKSB7XG4gICAgICByZXR1cm4gcGlwZWxpbmU7XG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KHBpcGVsaW5lKSkge1xuICAgICAgcmV0dXJuIHBpcGVsaW5lLm1hcCh2YWx1ZSA9PiB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUFyZ3Moc2NoZW1hLCB2YWx1ZSwgcmF3VmFsdWVzLCByYXdGaWVsZE5hbWVzKSk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcGlwZWxpbmUgPT09ICdvYmplY3QnKSB7XG4gICAgICBjb25zdCByZXR1cm5WYWx1ZSA9IHt9O1xuICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBwaXBlbGluZSkge1xuICAgICAgICBpZiAoIXJhd0ZpZWxkTmFtZXMgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZF0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBwaXBlbGluZVtmaWVsZF0gPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICByZXR1cm5WYWx1ZVtgX3BfJHtmaWVsZH1gXSA9IHBpcGVsaW5lW2ZpZWxkXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHJhd1ZhbHVlcykge1xuICAgICAgICAgICAgcmV0dXJuVmFsdWVbYF9wXyR7ZmllbGR9YF0gPSBwaXBlbGluZVtmaWVsZF07XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVyblZhbHVlW2BfcF8ke2ZpZWxkfWBdID0gYCR7c2NoZW1hLmZpZWxkc1tmaWVsZF0udGFyZ2V0Q2xhc3N9JCR7cGlwZWxpbmVbZmllbGRdfWA7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYS5maWVsZHNbZmllbGRdICYmIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdEYXRlJyAmJiAhcmF3VmFsdWVzKSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWVbZmllbGRdID0gdGhpcy5fY29udmVydFRvRGF0ZShwaXBlbGluZVtmaWVsZF0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVyblZhbHVlW2ZpZWxkXSA9IHRoaXMuX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWEsIHBpcGVsaW5lW2ZpZWxkXSwgcmF3VmFsdWVzLCByYXdGaWVsZE5hbWVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghcmF3RmllbGROYW1lcykge1xuICAgICAgICAgIGlmIChmaWVsZCA9PT0gJ29iamVjdElkJykge1xuICAgICAgICAgICAgcmV0dXJuVmFsdWVbJ19pZCddID0gcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICAgICAgZGVsZXRlIHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSAnY3JlYXRlZEF0Jykge1xuICAgICAgICAgICAgcmV0dXJuVmFsdWVbJ19jcmVhdGVkX2F0J10gPSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgICAgICBkZWxldGUgcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09ICd1cGRhdGVkQXQnKSB7XG4gICAgICAgICAgICByZXR1cm5WYWx1ZVsnX3VwZGF0ZWRfYXQnXSA9IHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgICAgIGRlbGV0ZSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcmV0dXJuVmFsdWU7XG4gICAgfVxuICAgIHJldHVybiBwaXBlbGluZTtcbiAgfVxuXG4gIC8vIFRoaXMgZnVuY3Rpb24gaXMgc2xpZ2h0bHkgZGlmZmVyZW50IHRoYW4gdGhlIG9uZSBhYm92ZS4gUmF0aGVyIHRoYW4gdHJ5aW5nIHRvIGNvbWJpbmUgdGhlc2VcbiAgLy8gdHdvIGZ1bmN0aW9ucyBhbmQgbWFraW5nIHRoZSBjb2RlIGV2ZW4gaGFyZGVyIHRvIHVuZGVyc3RhbmQsIEkgZGVjaWRlZCB0byBzcGxpdCBpdCB1cC4gVGhlXG4gIC8vIGRpZmZlcmVuY2Ugd2l0aCB0aGlzIGZ1bmN0aW9uIGlzIHdlIGFyZSBub3QgdHJhbnNmb3JtaW5nIHRoZSB2YWx1ZXMsIG9ubHkgdGhlIGtleXMgb2YgdGhlXG4gIC8vIHBpcGVsaW5lLlxuICBfcGFyc2VBZ2dyZWdhdGVQcm9qZWN0QXJncyhzY2hlbWE6IGFueSwgcGlwZWxpbmU6IGFueSwgcmF3VmFsdWVzPzogYm9vbGVhbiwgcmF3RmllbGROYW1lcz86IGJvb2xlYW4pOiBhbnkge1xuICAgIGNvbnN0IHJldHVyblZhbHVlID0ge307XG4gICAgZm9yIChjb25zdCBmaWVsZCBpbiBwaXBlbGluZSkge1xuICAgICAgaWYgKCFyYXdGaWVsZE5hbWVzICYmIHNjaGVtYS5maWVsZHNbZmllbGRdICYmIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICByZXR1cm5WYWx1ZVtgX3BfJHtmaWVsZH1gXSA9IHBpcGVsaW5lW2ZpZWxkXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVyblZhbHVlW2ZpZWxkXSA9IHRoaXMuX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWEsIHBpcGVsaW5lW2ZpZWxkXSwgcmF3VmFsdWVzLCByYXdGaWVsZE5hbWVzKTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFyYXdGaWVsZE5hbWVzKSB7XG4gICAgICAgIGlmIChmaWVsZCA9PT0gJ29iamVjdElkJykge1xuICAgICAgICAgIHJldHVyblZhbHVlWydfaWQnXSA9IHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgICBkZWxldGUgcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSAnY3JlYXRlZEF0Jykge1xuICAgICAgICAgIHJldHVyblZhbHVlWydfY3JlYXRlZF9hdCddID0gcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICAgIGRlbGV0ZSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09ICd1cGRhdGVkQXQnKSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWVbJ191cGRhdGVkX2F0J10gPSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgICAgZGVsZXRlIHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmV0dXJuVmFsdWU7XG4gIH1cblxuICAvLyBUaGlzIGZ1bmN0aW9uIGlzIHNsaWdodGx5IGRpZmZlcmVudCB0aGFuIHRoZSB0d28gYWJvdmUuIE1vbmdvREIgJGdyb3VwIGFnZ3JlZ2F0ZSBsb29rcyBsaWtlOlxuICAvLyAgICAgeyAkZ3JvdXA6IHsgX2lkOiA8ZXhwcmVzc2lvbj4sIDxmaWVsZDE+OiB7IDxhY2N1bXVsYXRvcjE+IDogPGV4cHJlc3Npb24xPiB9LCAuLi4gfSB9XG4gIC8vIFRoZSA8ZXhwcmVzc2lvbj4gY291bGQgYmUgYSBjb2x1bW4gbmFtZSwgcHJlZml4ZWQgd2l0aCB0aGUgJyQnIGNoYXJhY3Rlci4gV2UnbGwgbG9vayBmb3JcbiAgLy8gdGhlc2UgPGV4cHJlc3Npb24+IGFuZCBjaGVjayB0byBzZWUgaWYgaXQgaXMgYSAnUG9pbnRlcicgb3IgaWYgaXQncyBvbmUgb2YgY3JlYXRlZEF0LFxuICAvLyB1cGRhdGVkQXQgb3Igb2JqZWN0SWQgYW5kIGNoYW5nZSBpdCBhY2NvcmRpbmdseS5cbiAgX3BhcnNlQWdncmVnYXRlR3JvdXBBcmdzKHNjaGVtYTogYW55LCBwaXBlbGluZTogYW55LCByYXdGaWVsZE5hbWVzPzogYm9vbGVhbik6IGFueSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGlwZWxpbmUpKSB7XG4gICAgICByZXR1cm4gcGlwZWxpbmUubWFwKHZhbHVlID0+IHRoaXMuX3BhcnNlQWdncmVnYXRlR3JvdXBBcmdzKHNjaGVtYSwgdmFsdWUsIHJhd0ZpZWxkTmFtZXMpKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBwaXBlbGluZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGNvbnN0IHJldHVyblZhbHVlID0ge307XG4gICAgICBmb3IgKGNvbnN0IGZpZWxkIGluIHBpcGVsaW5lKSB7XG4gICAgICAgIHJldHVyblZhbHVlW2ZpZWxkXSA9IHRoaXMuX3BhcnNlQWdncmVnYXRlR3JvdXBBcmdzKHNjaGVtYSwgcGlwZWxpbmVbZmllbGRdLCByYXdGaWVsZE5hbWVzKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXR1cm5WYWx1ZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBwaXBlbGluZSA9PT0gJ3N0cmluZycgJiYgIXJhd0ZpZWxkTmFtZXMpIHtcbiAgICAgIGNvbnN0IGZpZWxkID0gcGlwZWxpbmUuc3Vic3RyaW5nKDEpO1xuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGRdICYmIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICByZXR1cm4gYCRfcF8ke2ZpZWxkfWA7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkID09ICdjcmVhdGVkQXQnKSB7XG4gICAgICAgIHJldHVybiAnJF9jcmVhdGVkX2F0JztcbiAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT0gJ3VwZGF0ZWRBdCcpIHtcbiAgICAgICAgcmV0dXJuICckX3VwZGF0ZWRfYXQnO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcGlwZWxpbmU7XG4gIH1cblxuICAvKipcbiAgICogUmVjdXJzaXZlbHkgY29udmVydHMgdmFsdWVzIHRvIERhdGUgb2JqZWN0cy4gU2luY2UgdGhlIHBhc3NlZCBvYmplY3QgaXMgcGFydCBvZiBhbiBhZ2dyZWdhdGlvblxuICAgKiBwaXBlbGluZSBhbmQgY2FuIGNvbnRhaW4gdmFyaW91cyBsb2dpYyBvcGVyYXRvcnMgKGxpa2UgJGd0LCAkbHQsIGV0YyksIHRoaXMgZnVuY3Rpb24gd2lsbFxuICAgKiB0cmF2ZXJzZSB0aGUgb2JqZWN0IGFuZCBjb252ZXJ0IGFueSBzdHJpbmdzIHRoYXQgY2FuIGJlIHBhcnNlZCBhcyBkYXRlcyBpbnRvIERhdGUgb2JqZWN0cy5cbiAgICogQHBhcmFtIHthbnl9IHZhbHVlIFRoZSB2YWx1ZSB0byBjb252ZXJ0LlxuICAgKiBAcmV0dXJucyB7YW55fSBUaGUgb3JpZ2luYWwgdmFsdWUgaWYgbm90IGNvbnZlcnRpYmxlIHRvIERhdGUsIG9yIGEgRGF0ZSBvYmplY3QgaWYgaXQgaXMuXG4gICAqL1xuICBfY29udmVydFRvRGF0ZSh2YWx1ZTogYW55KTogYW55IHtcbiAgICBpZiAoVXRpbHMuaXNEYXRlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGlzTmFOKERhdGUucGFyc2UodmFsdWUpKSA/IHZhbHVlIDogbmV3IERhdGUodmFsdWUpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgY29uc3QgcmV0dXJuVmFsdWUgPSB7fTtcbiAgICAgIGZvciAoY29uc3QgZmllbGQgaW4gdmFsdWUpIHtcbiAgICAgICAgcmV0dXJuVmFsdWVbZmllbGRdID0gdGhpcy5fY29udmVydFRvRGF0ZSh2YWx1ZVtmaWVsZF0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJldHVyblZhbHVlO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cblxuICBfcGFyc2VSZWFkUHJlZmVyZW5jZShyZWFkUHJlZmVyZW5jZTogP3N0cmluZyk6ID9zdHJpbmcge1xuICAgIGlmIChyZWFkUHJlZmVyZW5jZSkge1xuICAgICAgcmVhZFByZWZlcmVuY2UgPSByZWFkUHJlZmVyZW5jZS50b1VwcGVyQ2FzZSgpO1xuICAgIH1cbiAgICBzd2l0Y2ggKHJlYWRQcmVmZXJlbmNlKSB7XG4gICAgICBjYXNlICdQUklNQVJZJzpcbiAgICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5QUklNQVJZO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1BSSU1BUllfUFJFRkVSUkVEJzpcbiAgICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5QUklNQVJZX1BSRUZFUlJFRDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdTRUNPTkRBUlknOlxuICAgICAgICByZWFkUHJlZmVyZW5jZSA9IFJlYWRQcmVmZXJlbmNlLlNFQ09OREFSWTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdTRUNPTkRBUllfUFJFRkVSUkVEJzpcbiAgICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5TRUNPTkRBUllfUFJFRkVSUkVEO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ05FQVJFU1QnOlxuICAgICAgICByZWFkUHJlZmVyZW5jZSA9IFJlYWRQcmVmZXJlbmNlLk5FQVJFU1Q7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSB1bmRlZmluZWQ6XG4gICAgICBjYXNlIG51bGw6XG4gICAgICBjYXNlICcnOlxuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnTm90IHN1cHBvcnRlZCByZWFkIHByZWZlcmVuY2UuJyk7XG4gICAgfVxuICAgIHJldHVybiByZWFkUHJlZmVyZW5jZTtcbiAgfVxuXG4gIHBlcmZvcm1Jbml0aWFsaXphdGlvbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBjcmVhdGVJbmRleChjbGFzc05hbWU6IHN0cmluZywgaW5kZXg6IGFueSkge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uY3JlYXRlSW5kZXgoaW5kZXgpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgY3JlYXRlSW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZywgaW5kZXhlczogYW55KSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5jcmVhdGVJbmRleGVzKGluZGV4ZXMpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgY3JlYXRlSW5kZXhlc0lmTmVlZGVkKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZywgdHlwZTogYW55KSB7XG4gICAgaWYgKHR5cGUgJiYgdHlwZS50eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgIGNvbnN0IGluZGV4ID0ge1xuICAgICAgICBbZmllbGROYW1lXTogJzJkc3BoZXJlJyxcbiAgICAgIH07XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVJbmRleChjbGFzc05hbWUsIGluZGV4KTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgY3JlYXRlVGV4dEluZGV4ZXNJZk5lZWRlZChjbGFzc05hbWU6IHN0cmluZywgcXVlcnk6IFF1ZXJ5VHlwZSwgc2NoZW1hOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBxdWVyeSkge1xuICAgICAgaWYgKCFxdWVyeVtmaWVsZE5hbWVdIHx8ICFxdWVyeVtmaWVsZE5hbWVdLiR0ZXh0KSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgZXhpc3RpbmdJbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICBmb3IgKGNvbnN0IGtleSBpbiBleGlzdGluZ0luZGV4ZXMpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSBleGlzdGluZ0luZGV4ZXNba2V5XTtcbiAgICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChpbmRleCwgZmllbGROYW1lKSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3QgaW5kZXhOYW1lID0gYCR7ZmllbGROYW1lfV90ZXh0YDtcbiAgICAgIGNvbnN0IHRleHRJbmRleCA9IHtcbiAgICAgICAgW2luZGV4TmFtZV06IHsgW2ZpZWxkTmFtZV06ICd0ZXh0JyB9LFxuICAgICAgfTtcbiAgICAgIHJldHVybiB0aGlzLnNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KFxuICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgIHRleHRJbmRleCxcbiAgICAgICAgZXhpc3RpbmdJbmRleGVzLFxuICAgICAgICBzY2hlbWEuZmllbGRzXG4gICAgICApLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IDg1KSB7XG4gICAgICAgICAgLy8gSW5kZXggZXhpc3Qgd2l0aCBkaWZmZXJlbnQgb3B0aW9uc1xuICAgICAgICAgIHJldHVybiB0aGlzLnNldEluZGV4ZXNGcm9tTW9uZ28oY2xhc3NOYW1lKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBnZXRJbmRleGVzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5pbmRleGVzKCkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBkcm9wSW5kZXgoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4OiBhbnkpIHtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmRyb3BJbmRleChpbmRleCkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBkcm9wQWxsSW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uZHJvcEluZGV4ZXMoKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIHVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QWxsQ2xhc3NlcygpXG4gICAgICAudGhlbihjbGFzc2VzID0+IHtcbiAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBjbGFzc2VzLm1hcChzY2hlbWEgPT4ge1xuICAgICAgICAgIHJldHVybiB0aGlzLnNldEluZGV4ZXNGcm9tTW9uZ28oc2NoZW1hLmNsYXNzTmFtZSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGNyZWF0ZVRyYW5zYWN0aW9uYWxTZXNzaW9uKCk6IFByb21pc2U8YW55PiB7XG4gICAgY29uc3QgdHJhbnNhY3Rpb25hbFNlY3Rpb24gPSB0aGlzLmNsaWVudC5zdGFydFNlc3Npb24oKTtcbiAgICB0cmFuc2FjdGlvbmFsU2VjdGlvbi5zdGFydFRyYW5zYWN0aW9uKCk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0cmFuc2FjdGlvbmFsU2VjdGlvbik7XG4gIH1cblxuICBjb21taXRUcmFuc2FjdGlvbmFsU2Vzc2lvbih0cmFuc2FjdGlvbmFsU2VjdGlvbjogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29tbWl0ID0gcmV0cmllcyA9PiB7XG4gICAgICByZXR1cm4gdHJhbnNhY3Rpb25hbFNlY3Rpb25cbiAgICAgICAgLmNvbW1pdFRyYW5zYWN0aW9uKClcbiAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IgJiYgZXJyb3IuaGFzRXJyb3JMYWJlbCgnVHJhbnNpZW50VHJhbnNhY3Rpb25FcnJvcicpICYmIHJldHJpZXMgPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gY29tbWl0KHJldHJpZXMgLSAxKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICB0cmFuc2FjdGlvbmFsU2VjdGlvbi5lbmRTZXNzaW9uKCk7XG4gICAgICAgIH0pO1xuICAgIH07XG4gICAgcmV0dXJuIGNvbW1pdCg1KTtcbiAgfVxuXG4gIGFib3J0VHJhbnNhY3Rpb25hbFNlc3Npb24odHJhbnNhY3Rpb25hbFNlY3Rpb246IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiB0cmFuc2FjdGlvbmFsU2VjdGlvbi5hYm9ydFRyYW5zYWN0aW9uKCkudGhlbigoKSA9PiB7XG4gICAgICB0cmFuc2FjdGlvbmFsU2VjdGlvbi5lbmRTZXNzaW9uKCk7XG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgTW9uZ29TdG9yYWdlQWRh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