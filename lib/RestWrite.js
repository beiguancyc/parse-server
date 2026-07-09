"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _RestQuery = _interopRequireDefault(require("./RestQuery"));
var _lodash = _interopRequireDefault(require("lodash"));
var _logger = _interopRequireDefault(require("./logger"));
var _SchemaController = require("./Controllers/SchemaController");
var _Error = require("./Error");
var _AuthDataLock = require("./AuthDataLock");
var InstallationDedup = _interopRequireWildcard(require("./InstallationDedup"));
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// A RestWrite encapsulates everything we need to run an operation
// that writes to the database.
// This could be either a "create" or an "update".

var SchemaController = require('./Controllers/SchemaController');
const Auth = require('./Auth');
const Utils = require('./Utils');
var cryptoUtils = require('./cryptoUtils');
var passwordCrypto = require('./password');
var Parse = require('parse/node');
var triggers = require('./triggers');
var ClientSDK = require('./ClientSDK');
const util = require('util');
// query and data are both provided in REST API format. So data
// types are encoded by plain old objects.
// If query is null, this is a "create" and the data in data should be
// created.
// Otherwise this is an "update" - the object matching the query
// should get updated with data.
// RestWrite will handle objectId, createdAt, and updatedAt for
// everything. It also knows to use triggers and special modifications
// for the _User class.
function RestWrite(config, auth, className, query, data, originalData, clientSDK, context, action) {
  if (auth.isReadOnly) {
    throw (0, _Error.createSanitizedError)(Parse.Error.OPERATION_FORBIDDEN, 'Cannot perform a write operation when using readOnlyMasterKey', config);
  }
  this.config = config;
  this.auth = auth;
  this.className = className;
  this.clientSDK = clientSDK;
  this.storage = {};
  this.runOptions = {};
  this.context = context || {};
  if (action) {
    this.runOptions.action = action;
  }
  if (!query) {
    if (this.config.allowCustomObjectId) {
      if (Object.prototype.hasOwnProperty.call(data, 'objectId') && !data.objectId) {
        throw new Parse.Error(Parse.Error.MISSING_OBJECT_ID, 'objectId must not be empty, null or undefined');
      }
    } else {
      if (data.objectId) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'objectId is an invalid field name.');
      }
      if (data.id) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'id is an invalid field name.');
      }
    }
  }

  // When the operation is complete, this.response may have several
  // fields.
  // response: the actual data to be returned
  // status: the http status code. if not present, treated like a 200
  // location: the location header. if not present, no location header
  this.response = null;

  // Processing this operation may mutate our data, so we operate on a
  // copy
  this.query = structuredClone(query);
  this.data = structuredClone(data);
  // We never change originalData, so we do not need a deep copy
  this.originalData = originalData;

  // The timestamp we'll use for this whole operation
  this.updatedAt = Parse._encode(new Date()).iso;

  // Shared SchemaController to be reused to reduce the number of loadSchema() calls per request
  // Once set the schemaData should be immutable
  this.validSchemaController = null;
  this.pendingOps = {
    operations: null,
    identifier: null
  };
}

// A convenient method to perform all the steps of processing the
// write, in order.
// Returns a promise for a {response, status, location} object.
// status and location are optional.
RestWrite.prototype.execute = function () {
  return Promise.resolve().then(() => {
    return this.getUserAndRoleACL();
  }).then(() => {
    return this.validateClientClassCreation();
  }).then(() => {
    return this.handleInstallation();
  }).then(() => {
    return this.handleSession();
  }).then(() => {
    return this.validateAuthData();
  }).then(() => {
    return this.checkRestrictedFields();
  }).then(() => {
    return this.runBeforeSaveTrigger();
  }).then(() => {
    return this.ensureUniqueAuthDataId();
  }).then(() => {
    return this.deleteEmailResetTokenIfNeeded();
  }).then(() => {
    return this.validateSchema();
  }).then(schemaController => {
    this.validSchemaController = schemaController;
    return this.setRequiredFieldsIfNeeded();
  }).then(() => {
    return this.validateCreatePermission();
  }).then(() => {
    return this.transformUser();
  }).then(() => {
    return this.expandFilesForExistingObjects();
  }).then(() => {
    return this.destroyDuplicatedSessions();
  }).then(() => {
    return this.runDatabaseOperation();
  }).then(() => {
    return this.createSessionTokenIfNeeded();
  }).then(() => {
    return this.handleFollowup();
  }).then(() => {
    return this.runAfterSaveTrigger();
  }).then(() => {
    return this.cleanUserAuthData();
  }).then(() => {
    return this.filterProtectedFieldsInResponse();
  }).then(() => {
    // Append the authDataResponse if exists
    if (this.authDataResponse) {
      if (this.response && this.response.response) {
        this.response.response.authDataResponse = this.authDataResponse;
      }
    }
    if (this.storage.rejectSignup && this.config.preventSignupWithUnverifiedEmail) {
      throw new Parse.Error(Parse.Error.EMAIL_NOT_FOUND, 'User email is not verified.');
    }
    return this.response;
  });
};

// Uses the Auth object to get the list of roles, adds the user id
RestWrite.prototype.getUserAndRoleACL = function () {
  if (this.auth.isMaster || this.auth.isMaintenance) {
    return Promise.resolve();
  }
  this.runOptions.acl = ['*'];
  if (this.auth.user) {
    return this.auth.getUserRoles().then(roles => {
      this.runOptions.acl = this.runOptions.acl.concat(roles, [this.auth.user.id]);
      return;
    });
  } else {
    return Promise.resolve();
  }
};

// Validates this operation against the allowClientClassCreation config.
RestWrite.prototype.validateClientClassCreation = function () {
  if (this.config.allowClientClassCreation === false && !this.auth.isMaster && !this.auth.isMaintenance && SchemaController.systemClasses.indexOf(this.className) === -1) {
    return this.config.database.loadSchema().then(schemaController => schemaController.hasClass(this.className)).then(hasClass => {
      if (hasClass !== true) {
        throw (0, _Error.createSanitizedError)(Parse.Error.OPERATION_FORBIDDEN, 'This user is not allowed to access non-existent class: ' + this.className, this.config);
      }
    });
  } else {
    return Promise.resolve();
  }
};

// Validates this operation against the schema.
RestWrite.prototype.validateSchema = function () {
  return this.config.database.validateObject(this.className, this.data, this.query, this.runOptions, this.auth.isMaintenance);
};

// Runs any beforeSave triggers against this operation.
// Any change leads to our data being mutated.
RestWrite.prototype.runBeforeSaveTrigger = function () {
  if (this.response || this.runOptions.many) {
    return;
  }

  // Avoid doing any setup for triggers if there is no 'beforeSave' trigger for this class.
  if (!triggers.triggerExists(this.className, triggers.Types.beforeSave, this.config.applicationId)) {
    return Promise.resolve();
  }
  const {
    originalObject,
    updatedObject
  } = this.buildParseObjects();
  const identifier = updatedObject._getStateIdentifier();
  const stateController = Parse.CoreManager.getObjectStateController();
  const [pending] = stateController.getPendingOps(identifier);
  this.pendingOps = {
    operations: {
      ...pending
    },
    identifier
  };
  return Promise.resolve().then(() => {
    // Before calling the trigger, validate the permissions for the save operation
    let databasePromise = null;
    if (this.query) {
      // Validate for updating
      databasePromise = this.config.database.update(this.className, this.query, this.data, this.runOptions, true, true);
    } else {
      // Validate for creating
      databasePromise = this.config.database.create(this.className, this.data, this.runOptions, true);
    }
    // In the case that there is no permission for the operation, it throws an error
    return databasePromise.then(result => {
      if (!result || result.length <= 0) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
      }
    });
  }).then(() => {
    return triggers.maybeRunTrigger(triggers.Types.beforeSave, this.auth, updatedObject, originalObject, this.config, this.context);
  }).then(response => {
    if (response && response.object) {
      this.storage.fieldsChangedByTrigger = _lodash.default.reduce(response.object, (result, value, key) => {
        if (!_lodash.default.isEqual(this.data[key], value)) {
          result.push(key);
        }
        return result;
      }, []);
      this.data = response.object;
      // We should delete the objectId for an update write
      if (this.query && this.query.objectId) {
        delete this.data.objectId;
      }
    }
    try {
      Utils.checkProhibitedKeywords(this.config, this.data);
    } catch (error) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, `${error}`);
    }
  });
};
RestWrite.prototype.runBeforeLoginTrigger = async function (userData) {
  // Avoid doing any setup for triggers if there is no 'beforeLogin' trigger
  if (!triggers.triggerExists(this.className, triggers.Types.beforeLogin, this.config.applicationId)) {
    return;
  }

  // Cloud code gets a bit of extra data for its objects
  const extraData = {
    className: this.className
  };

  // Expand file objects
  await this.config.filesController.expandFilesInObject(this.config, userData);
  const user = triggers.inflate(extraData, userData);

  // no need to return a response
  await triggers.maybeRunTrigger(triggers.Types.beforeLogin, this.auth, user, null, this.config, this.context);
};
RestWrite.prototype.setRequiredFieldsIfNeeded = function () {
  if (this.data) {
    return this.validSchemaController.getAllClasses().then(allClasses => {
      const schema = allClasses.find(oneClass => oneClass.className === this.className);
      const setRequiredFieldIfNeeded = (fieldName, setDefault) => {
        if (this.data[fieldName] === undefined || this.data[fieldName] === null || this.data[fieldName] === '' || typeof this.data[fieldName] === 'object' && this.data[fieldName].__op === 'Delete') {
          if (setDefault && schema.fields[fieldName] && schema.fields[fieldName].defaultValue !== null && schema.fields[fieldName].defaultValue !== undefined && (this.data[fieldName] === undefined || typeof this.data[fieldName] === 'object' && this.data[fieldName].__op === 'Delete')) {
            this.data[fieldName] = schema.fields[fieldName].defaultValue;
            this.storage.fieldsChangedByTrigger = this.storage.fieldsChangedByTrigger || [];
            if (this.storage.fieldsChangedByTrigger.indexOf(fieldName) < 0) {
              this.storage.fieldsChangedByTrigger.push(fieldName);
            }
          } else if (schema.fields[fieldName] && schema.fields[fieldName].required === true) {
            throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is required`);
          }
        }
      };

      // add default ACL (only on CREATE, not UPDATE)
      if (!this.query && schema?.classLevelPermissions?.ACL && !this.data.ACL && JSON.stringify(schema.classLevelPermissions.ACL) !== JSON.stringify({
        '*': {
          read: true,
          write: true
        }
      })) {
        const acl = structuredClone(schema.classLevelPermissions.ACL);
        if (acl.currentUser) {
          if (this.auth.user?.id) {
            acl[this.auth.user?.id] = structuredClone(acl.currentUser);
          }
          delete acl.currentUser;
        }
        this.data.ACL = acl;
        this.storage.fieldsChangedByTrigger = this.storage.fieldsChangedByTrigger || [];
        this.storage.fieldsChangedByTrigger.push('ACL');
      }

      // Add default fields
      if (!this.query) {
        // allow customizing createdAt and updatedAt when using maintenance key
        if (this.auth.isMaintenance && this.data.createdAt && this.data.createdAt.__type === 'Date') {
          this.data.createdAt = this.data.createdAt.iso;
          if (this.data.updatedAt && this.data.updatedAt.__type === 'Date') {
            const createdAt = new Date(this.data.createdAt);
            const updatedAt = new Date(this.data.updatedAt.iso);
            if (updatedAt < createdAt) {
              throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'updatedAt cannot occur before createdAt');
            }
            this.data.updatedAt = this.data.updatedAt.iso;
          }
          // if no updatedAt is provided, set it to createdAt to match default behavior
          else {
            this.data.updatedAt = this.data.createdAt;
          }
        } else {
          this.data.updatedAt = this.updatedAt;
          this.data.createdAt = this.updatedAt;
        }

        // Only assign new objectId if we are creating new object
        if (!this.data.objectId) {
          this.data.objectId = cryptoUtils.newObjectId(this.config.objectIdSize);
        }
        if (schema) {
          Object.keys(schema.fields).forEach(fieldName => {
            setRequiredFieldIfNeeded(fieldName, true);
          });
        }
      } else if (schema) {
        this.data.updatedAt = this.updatedAt;
        Object.keys(this.data).forEach(fieldName => {
          setRequiredFieldIfNeeded(fieldName, false);
        });
      }
    });
  }
  return Promise.resolve();
};

// Transforms auth data for a user object.
// Does nothing if this isn't a user object.
// Returns a promise for when we're done if it can't finish this tick.
RestWrite.prototype.validateAuthData = function () {
  if (this.className !== '_User') {
    return;
  }
  const authData = this.data.authData;
  const hasUsernameAndPassword = typeof this.data.username === 'string' && typeof this.data.password === 'string';
  const hasAuthData = authData && Object.keys(authData).some(provider => {
    const providerData = authData[provider];
    return providerData && typeof providerData === 'object' && Object.keys(providerData).length;
  });
  if (!this.query && !hasAuthData) {
    if (typeof this.data.username !== 'string' || _lodash.default.isEmpty(this.data.username)) {
      throw new Parse.Error(Parse.Error.USERNAME_MISSING, 'bad or missing username');
    }
    if (typeof this.data.password !== 'string' || _lodash.default.isEmpty(this.data.password)) {
      throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'password is required');
    }
  }
  if (!Object.prototype.hasOwnProperty.call(this.data, 'authData')) {
    // Nothing to validate here
    return;
  } else if (!this.data.authData) {
    // Handle saving authData to null
    throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
  }
  var providers = Object.keys(authData);
  if (!providers.length) {
    // Empty authData object, nothing to validate
    return;
  }
  const canHandleAuthData = providers.some(provider => {
    const providerAuthData = authData[provider] || {};
    return !!Object.keys(providerAuthData).length;
  });
  if (canHandleAuthData || hasUsernameAndPassword || this.auth.isMaster || this.getUserId()) {
    return this.handleAuthData(authData);
  }
  throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
};
RestWrite.prototype.filteredObjectsByACL = function (objects) {
  if (this.auth.isMaster || this.auth.isMaintenance) {
    return objects;
  }
  return objects.filter(object => {
    if (!object.ACL) {
      return true; // legacy users that have no ACL field on them
    }
    // Regular users that have been locked out.
    return object.ACL && Object.keys(object.ACL).length > 0;
  });
};
RestWrite.prototype.getUserId = function () {
  if (this.query && this.query.objectId && this.className === '_User') {
    return this.query.objectId;
  } else if (this.auth && this.auth.user && this.auth.user.id) {
    return this.auth.user.id;
  }
};

// Developers are allowed to change authData via before save trigger
RestWrite.prototype._throwIfAuthDataDuplicate = function (error) {
  if (this.className === '_User' && error?.code === Parse.Error.DUPLICATE_VALUE && error.userInfo?.duplicated_field?.startsWith('_auth_data_')) {
    throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
  }
};

// we need after before save to ensure that the developer
// is not currently duplicating auth data ID
RestWrite.prototype.ensureUniqueAuthDataId = async function () {
  if (this.className !== '_User' || !this.data.authData) {
    return;
  }
  const hasAuthDataId = Object.keys(this.data.authData).some(key => this.data.authData[key] && this.data.authData[key].id);
  if (!hasAuthDataId) {
    return;
  }
  const r = await Auth.findUsersWithAuthData(this.config, this.data.authData);
  const results = this.filteredObjectsByACL(r);
  if (results.length > 1) {
    throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
  }
  // use data.objectId in case of login time and found user during handle validateAuthData
  const userId = this.getUserId() || this.data.objectId;
  if (results.length === 1 && userId !== results[0].objectId) {
    throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
  }
};
RestWrite.prototype.handleAuthData = async function (authData) {
  let currentUserAuthData;
  if (this.query?.objectId) {
    const [currentUser] = await this.config.database.find('_User', {
      objectId: this.query.objectId
    });
    currentUserAuthData = currentUser?.authData;
  }
  const r = await Auth.findUsersWithAuthData(this.config, authData, true, currentUserAuthData);
  const results = this.filteredObjectsByACL(r);
  const userId = this.getUserId();
  const userResult = results[0];
  const foundUserIsNotCurrentUser = userId && userResult && userId !== userResult.objectId;
  if (results.length > 1 || foundUserIsNotCurrentUser) {
    // To avoid https://github.com/parse-community/parse-server/security/advisories/GHSA-8w3j-g983-8jh5
    // Let's run some validation before throwing
    await Auth.handleAuthDataValidation(authData, this, userResult);
    throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
  }

  // No user found with provided authData we need to validate
  if (!results.length) {
    const {
      authData: validatedAuthData,
      authDataResponse
    } = await Auth.handleAuthDataValidation(authData, this);
    this.authDataResponse = authDataResponse;
    // Replace current authData by the new validated one
    this.data.authData = validatedAuthData;
    return;
  }

  // User found with provided authData
  if (results.length === 1) {
    this.storage.authProvider = Object.keys(authData).join(',');
    const {
      hasMutatedAuthData,
      mutatedAuthData
    } = Auth.hasMutatedAuthData(authData, userResult.authData);
    const isCurrentUserLoggedOrMaster = this.auth && this.auth.user && this.auth.user.id === userResult.objectId || this.auth.isMaster;
    const isLogin = !userId;
    if (isLogin || isCurrentUserLoggedOrMaster) {
      // no user making the call
      // OR the user making the call is the right one
      // Login with auth data
      delete results[0].password;

      // need to set the objectId first otherwise location has trailing undefined
      this.data.objectId = userResult.objectId;
      if (!this.query || !this.query.objectId) {
        this.response = {
          response: userResult,
          location: this.location()
        };
        // Run beforeLogin hook before storing any updates
        // to authData on the db; changes to userResult
        // will be ignored.
        await this.runBeforeLoginTrigger(structuredClone(userResult));

        // If we are in login operation via authData
        // we need to be sure that the user has provided
        // required authData
        Auth.checkIfUserHasProvidedConfiguredProvidersForLogin({
          config: this.config,
          auth: this.auth
        }, authData, userResult.authData, this.config);
      }

      // Prevent validating if no mutated data detected on update
      if (!hasMutatedAuthData && isCurrentUserLoggedOrMaster) {
        return;
      }

      // Always validate all provided authData on login to prevent authentication
      // bypass via partial authData (e.g. sending only the provider ID without
      // an access token); on update only validate mutated ones
      if (isLogin || hasMutatedAuthData || !this.config.allowExpiredAuthDataToken) {
        const res = await Auth.handleAuthDataValidation(isLogin ? authData : mutatedAuthData, this, userResult);
        this.data.authData = res.authData;
        this.authDataResponse = res.authDataResponse;
      }

      // Capture original authData before mutating userResult via the response reference
      const originalAuthData = userResult?.authData ? Object.fromEntries(Object.entries(userResult.authData).map(([k, v]) => [k, v && typeof v === 'object' ? {
        ...v
      } : v])) : undefined;

      // IF we are in login we'll skip the database operation / beforeSave / afterSave etc...
      // we need to set it up there.
      // We are supposed to have a response only on LOGIN with authData, so we skip those
      // If we're not logging in, but just updating the current user, we can safely skip that part
      if (this.response) {
        // Assign the new authData in the response
        Object.keys(mutatedAuthData).forEach(provider => {
          this.response.response.authData[provider] = mutatedAuthData[provider];
        });

        // Run the DB update directly, as 'master' only if authData contains some keys
        // authData could not contains keys after validation if the authAdapter
        // uses the `doNotSave` option. Just update the authData part
        // Then we're good for the user, early exit of sorts
        if (Object.keys(this.data.authData).length) {
          const query = {
            objectId: this.data.objectId
          };
          // Optimistic locking: include each changed original field in the WHERE clause
          // for providers whose data is being updated. This prevents concurrent requests
          // from both succeeding when consuming single-use tokens (e.g. MFA recovery codes
          // as arrays, or MFA SMS OTP tokens as strings).
          (0, _AuthDataLock.applyAuthDataOptimisticLock)(query, originalAuthData, this.data.authData);
          try {
            await this.config.database.update(this.className, query, {
              authData: this.data.authData
            }, {});
          } catch (error) {
            if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
              throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Invalid auth data');
            }
            this._throwIfAuthDataDuplicate(error);
            throw error;
          }
        }
      } else if (this.query && this.data.authData && Object.keys(this.data.authData).length) {
        // UPDATE path (e.g. PUT /users/:id during linked-provider re-auth): apply
        // the same optimistic lock to the subsequent runDatabaseOperation update so
        // concurrent single-use token consumers cannot both succeed.
        (0, _AuthDataLock.applyAuthDataOptimisticLock)(this.query, originalAuthData, this.data.authData);
      }
    }
  }
};
RestWrite.prototype.checkRestrictedFields = async function () {
  if (this.className !== '_User') {
    return;
  }
  if (!this.auth.isMaintenance && !this.auth.isMaster && 'emailVerified' in this.data) {
    throw (0, _Error.createSanitizedError)(Parse.Error.OPERATION_FORBIDDEN, "Clients aren't allowed to manually update email verification.", this.config);
  }
};

// Validates the create class-level permission before transformUser runs.
// This prevents user enumeration (username/email existence) when public
// create is disabled on _User, because transformUser checks uniqueness
// before the CLP is enforced in runDatabaseOperation.
RestWrite.prototype.validateCreatePermission = async function () {
  if (this.query || this.auth.isMaster || this.auth.isMaintenance) {
    return;
  }
  if (!this.validSchemaController) {
    return;
  }
  await this.validSchemaController.validatePermission(this.className, this.runOptions.acl || [], 'create');
};

// The non-third-party parts of User transformation
RestWrite.prototype.transformUser = async function () {
  var promise = Promise.resolve();
  if (this.className !== '_User') {
    return promise;
  }

  // Do not cleanup session if objectId is not set
  if (this.query && this.objectId()) {
    // If we're updating a _User object, we need to clear out the cache for that user. Find all their
    // session tokens, and remove them from the cache.
    const query = await (0, _RestQuery.default)({
      method: _RestQuery.default.Method.find,
      config: this.config,
      auth: Auth.master(this.config),
      className: '_Session',
      runBeforeFind: false,
      restWhere: {
        user: {
          __type: 'Pointer',
          className: '_User',
          objectId: this.objectId()
        }
      }
    });
    promise = query.execute().then(results => {
      results.results.forEach(session => this.config.cacheController.user.del(session.sessionToken));
    });
  }
  return promise.then(() => {
    // Transform the password
    if (this.data.password === undefined) {
      // ignore only if undefined. should proceed if empty ('')
      return Promise.resolve();
    }
    if (this.query) {
      this.storage['clearSessions'] = true;
      // Generate a new session only if the user requested
      if (!this.auth.isMaster && !this.auth.isMaintenance) {
        this.storage['generateNewSession'] = true;
      }
    }
    return this._validatePasswordPolicy().then(() => {
      return passwordCrypto.hash(this.data.password).then(hashedPassword => {
        this.data._hashed_password = hashedPassword;
        delete this.data.password;
      });
    });
  }).then(() => {
    return this._validateUserName();
  }).then(() => {
    return this._validateEmail();
  });
};
RestWrite.prototype._validateUserName = function () {
  // Check for username uniqueness
  if (!this.data.username) {
    if (!this.query) {
      this.data.username = cryptoUtils.randomString(25);
      this.responseShouldHaveUsername = true;
    }
    return Promise.resolve();
  }
  /*
    Usernames should be unique when compared case insensitively
     Users should be able to make case sensitive usernames and
    login using the case they entered.  I.e. 'Snoopy' should preclude
    'snoopy' as a valid username.
  */
  return this.config.database.find(this.className, {
    username: this.data.username,
    objectId: {
      $ne: this.objectId()
    }
  }, {
    limit: 1,
    caseInsensitive: true
  }, {}, this.validSchemaController).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
    }
    return;
  });
};
RestWrite.buildCreatedWith = function (action, authProvider) {
  return {
    action,
    authProvider: authProvider || 'password'
  };
};
RestWrite.prototype.getCreatedWith = function () {
  if (this.storage.createdWith) {
    return this.storage.createdWith;
  }
  const isCreateOperation = !this.query;
  const authDataProvider = this.data?.authData && Object.keys(this.data.authData).length && Object.keys(this.data.authData).join(',');
  const authProvider = this.storage.authProvider || authDataProvider;
  // storage.authProvider is only set for login (existing user found in handleAuthData)
  const action = this.storage.authProvider ? 'login' : isCreateOperation ? 'signup' : undefined;
  if (!action) {
    return;
  }
  const resolvedAuthProvider = authProvider || (action === 'signup' ? 'password' : undefined);
  this.storage.createdWith = RestWrite.buildCreatedWith(action, resolvedAuthProvider);
  return this.storage.createdWith;
};

/*
  As with usernames, Parse should not allow case insensitive collisions of email.
  unlike with usernames (which can have case insensitive collisions in the case of
  auth adapters), emails should never have a case insensitive collision.

  This behavior can be enforced through a properly configured index see:
  https://docs.mongodb.com/manual/core/index-case-insensitive/#create-a-case-insensitive-index
  which could be implemented instead of this code based validation.

  Given that this lookup should be a relatively low use case and that the case sensitive
  unique index will be used by the db for the query, this is an adequate solution.
*/
RestWrite.prototype._validateEmail = function () {
  if (!this.data.email || this.data.email.__op === 'Delete') {
    return Promise.resolve();
  }
  // Validate basic email address format
  if (!this.data.email.match(/^.+@.+$/)) {
    return Promise.reject(new Parse.Error(Parse.Error.INVALID_EMAIL_ADDRESS, 'Email address format is invalid.'));
  }
  // Case insensitive match, see note above function.
  return this.config.database.find(this.className, {
    email: this.data.email,
    objectId: {
      $ne: this.objectId()
    }
  }, {
    limit: 1,
    caseInsensitive: true
  }, {}, this.validSchemaController).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
    }
    if (!this.data.authData || !Object.keys(this.data.authData).length || Object.keys(this.data.authData).length === 1 && Object.keys(this.data.authData)[0] === 'anonymous') {
      // We updated the email, send a new validation
      const {
        originalObject,
        updatedObject
      } = this.buildParseObjects();
      const request = {
        original: originalObject,
        object: updatedObject,
        master: this.auth.isMaster,
        ip: this.config.ip,
        installationId: this.auth.installationId,
        createdWith: this.getCreatedWith()
      };
      return this.config.userController.setEmailVerifyToken(this.data, request, this.storage);
    }
  });
};
RestWrite.prototype._validatePasswordPolicy = function () {
  if (!this.config.passwordPolicy) {
    return Promise.resolve();
  }
  return this._validatePasswordRequirements().then(() => {
    return this._validatePasswordHistory();
  });
};
RestWrite.prototype._validatePasswordRequirements = function () {
  // check if the password conforms to the defined password policy if configured
  // If we specified a custom error in our configuration use it.
  // Example: "Passwords must include a Capital Letter, Lowercase Letter, and a number."
  //
  // This is especially useful on the generic "password reset" page,
  // as it allows the programmer to communicate specific requirements instead of:
  // a. making the user guess whats wrong
  // b. making a custom password reset page that shows the requirements
  const policyError = this.config.passwordPolicy.validationError ? this.config.passwordPolicy.validationError : 'Password does not meet the Password Policy requirements.';
  const containsUsernameError = 'Password cannot contain your username.';

  // check whether the password meets the password strength requirements
  if (this.config.passwordPolicy.patternValidator && !this.config.passwordPolicy.patternValidator(this.data.password) || this.config.passwordPolicy.validatorCallback && !this.config.passwordPolicy.validatorCallback(this.data.password)) {
    return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
  }

  // check whether password contain username
  if (this.config.passwordPolicy.doNotAllowUsername === true) {
    if (this.data.username) {
      // username is not passed during password reset
      if (this.data.password.indexOf(this.data.username) >= 0) {
        return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, containsUsernameError));
      }
    } else {
      // retrieve the User object using objectId during password reset
      return this.config.database.find('_User', {
        objectId: this.objectId()
      }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }
        if (this.data.password.indexOf(results[0].username) >= 0) {
          return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, containsUsernameError));
        }
        return Promise.resolve();
      });
    }
  }
  return Promise.resolve();
};
RestWrite.prototype._validatePasswordHistory = function () {
  // check whether password is repeating from specified history
  if (this.query && this.config.passwordPolicy.maxPasswordHistory) {
    return this.config.database.find('_User', {
      objectId: this.objectId()
    }, {
      keys: ['_password_history', '_hashed_password']
    }, Auth.maintenance(this.config)).then(results => {
      if (results.length != 1) {
        throw undefined;
      }
      const user = results[0];
      let oldPasswords = [];
      if (user._password_history) {
        oldPasswords = _lodash.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory - 1);
      }
      oldPasswords.push(user.password);
      const newPassword = this.data.password;
      // compare the new password hash with all old password hashes
      const promises = oldPasswords.map(function (hash) {
        return passwordCrypto.compare(newPassword, hash).then(result => {
          if (result)
            // reject if there is a match
            {
              return Promise.reject('REPEAT_PASSWORD');
            }
          return Promise.resolve();
        });
      });
      // wait for all comparisons to complete
      return Promise.all(promises).then(() => {
        return Promise.resolve();
      }).catch(err => {
        if (err === 'REPEAT_PASSWORD')
          // a match was found
          {
            return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, `New password should not be the same as last ${this.config.passwordPolicy.maxPasswordHistory} passwords.`));
          }
        throw err;
      });
    });
  }
  return Promise.resolve();
};
RestWrite.prototype.createSessionTokenIfNeeded = async function () {
  if (this.className !== '_User') {
    return;
  }
  // Don't generate session for updating user (this.query is set) unless authData exists
  if (this.query && !this.data.authData) {
    return;
  }
  // Don't generate new sessionToken if linking via sessionToken
  if (this.auth.user && this.data.authData) {
    return;
  }
  // If sign-up call
  if (!this.storage.authProvider) {
    // Create request object for verification functions
    const {
      originalObject,
      updatedObject
    } = this.buildParseObjects();
    const request = {
      original: originalObject,
      object: updatedObject,
      master: this.auth.isMaster,
      ip: this.config.ip,
      installationId: this.auth.installationId,
      createdWith: this.getCreatedWith()
    };
    // Get verification conditions which can be booleans or functions; the purpose of this async/await
    // structure is to avoid unnecessarily executing subsequent functions if previous ones fail in the
    // conditional statement below, as a developer may decide to execute expensive operations in them
    const verifyUserEmails = async () => this.config.verifyUserEmails === true || typeof this.config.verifyUserEmails === 'function' && (await Promise.resolve(this.config.verifyUserEmails(request))) === true;
    const preventLoginWithUnverifiedEmail = async () => this.config.preventLoginWithUnverifiedEmail === true || typeof this.config.preventLoginWithUnverifiedEmail === 'function' && (await Promise.resolve(this.config.preventLoginWithUnverifiedEmail(request))) === true;
    // If verification is required
    if ((await verifyUserEmails()) && (await preventLoginWithUnverifiedEmail())) {
      this.storage.rejectSignup = true;
      return;
    }
  }
  return this.createSessionToken();
};
RestWrite.prototype.createSessionToken = async function () {
  // cloud installationId from Cloud Code,
  // never create session tokens from there.
  if (this.auth.installationId && this.auth.installationId === 'cloud') {
    return;
  }
  if (this.storage.authProvider == null && this.data.authData) {
    this.storage.authProvider = Object.keys(this.data.authData).join(',');
    // Invalidate cached createdWith since authProvider was just resolved
    delete this.storage.createdWith;
  }
  const createdWith = this.getCreatedWith();
  const {
    sessionData,
    createSession
  } = RestWrite.createSession(this.config, {
    userId: this.objectId(),
    createdWith,
    installationId: this.auth.installationId
  });
  if (this.response && this.response.response) {
    this.response.response.sessionToken = sessionData.sessionToken;
  }
  return createSession();
};
RestWrite.createSession = function (config, {
  userId,
  createdWith,
  installationId,
  additionalSessionData
}) {
  const token = 'r:' + cryptoUtils.newToken();
  const expiresAt = config.generateSessionExpiresAt();
  const sessionData = {
    sessionToken: token,
    user: {
      __type: 'Pointer',
      className: '_User',
      objectId: userId
    },
    createdWith,
    expiresAt: Parse._encode(expiresAt)
  };
  if (installationId) {
    sessionData.installationId = installationId;
  }
  Object.assign(sessionData, additionalSessionData);
  return {
    sessionData,
    createSession: () => new RestWrite(config, Auth.master(config), '_Session', null, sessionData).execute()
  };
};

// Delete email reset tokens if user is changing password or email.
RestWrite.prototype.deleteEmailResetTokenIfNeeded = function () {
  if (this.className !== '_User' || this.query === null) {
    // null query means create
    return;
  }
  if ('password' in this.data || 'email' in this.data) {
    const addOps = {
      _perishable_token: {
        __op: 'Delete'
      },
      _perishable_token_expires_at: {
        __op: 'Delete'
      }
    };
    this.data = Object.assign(this.data, addOps);
  }
};
RestWrite.prototype.destroyDuplicatedSessions = function () {
  // Only for _Session, and at creation time
  if (this.className != '_Session' || this.query) {
    return;
  }
  // Destroy the sessions in 'Background'
  const {
    user,
    installationId,
    sessionToken
  } = this.data;
  if (!user || !installationId) {
    return;
  }
  if (!user.objectId) {
    return;
  }
  return this.config.database.destroy('_Session', {
    user,
    installationId,
    sessionToken: {
      $ne: sessionToken
    }
  }, {}, this.validSchemaController).catch(e => {
    if (e.code !== Parse.Error.OBJECT_NOT_FOUND) {
      throw e;
    }
  });
};

// Handles any followup logic
RestWrite.prototype.handleFollowup = function () {
  if (this.storage && this.storage['clearSessions'] && this.config.revokeSessionOnPasswordReset) {
    var sessionQuery = {
      user: {
        __type: 'Pointer',
        className: '_User',
        objectId: this.objectId()
      }
    };
    delete this.storage['clearSessions'];
    return this.config.database.destroy('_Session', sessionQuery).then(this.handleFollowup.bind(this));
  }
  if (this.storage && this.storage['generateNewSession']) {
    delete this.storage['generateNewSession'];
    return this.createSessionToken().then(this.handleFollowup.bind(this));
  }
  if (this.storage && this.storage['sendVerificationEmail']) {
    delete this.storage['sendVerificationEmail'];
    // Fire and forget!
    this.config.userController.sendVerificationEmail(this.data, {
      auth: this.auth
    });
    return this.handleFollowup.bind(this);
  }
};

// Handles the _Session class specialness.
// Does nothing if this isn't an _Session object.
RestWrite.prototype.handleSession = function () {
  if (this.response || this.className !== '_Session') {
    return;
  }
  if (!this.auth.user && !this.auth.isMaster && !this.auth.isMaintenance) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Session token required.');
  }

  // TODO: Verify proper error to throw
  if ('ACL' in this.data) {
    throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Cannot set ' + 'ACL on a Session.');
  }
  if (this.query) {
    if ('user' in this.data && !this.auth.isMaster && this.data.user?.objectId !== this.auth.user.id) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Invalid key name: user');
    } else if ('installationId' in this.data) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Invalid key name: installationId');
    } else if ('sessionToken' in this.data) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Invalid key name: sessionToken');
    } else if ('expiresAt' in this.data && !this.auth.isMaster && !this.auth.isMaintenance) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Invalid key name: expiresAt');
    } else if ('createdWith' in this.data && !this.auth.isMaster && !this.auth.isMaintenance) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Invalid key name: createdWith');
    }
    if (!this.auth.isMaster) {
      this.query = {
        $and: [this.query, {
          user: {
            __type: 'Pointer',
            className: '_User',
            objectId: this.auth.user.id
          }
        }]
      };
    }
  }
  if (!this.query && !this.auth.isMaster && !this.auth.isMaintenance) {
    const additionalSessionData = {};
    for (var key in this.data) {
      if (key === 'objectId' || key === 'user' || key === 'sessionToken' || key === 'expiresAt' || key === 'createdWith') {
        continue;
      }
      additionalSessionData[key] = this.data[key];
    }
    const {
      sessionData,
      createSession
    } = RestWrite.createSession(this.config, {
      userId: this.auth.user.id,
      createdWith: {
        action: 'create'
      },
      additionalSessionData
    });
    return createSession().then(results => {
      if (!results.response) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Error creating session.');
      }
      sessionData['objectId'] = results.response['objectId'];
      this.response = {
        status: 201,
        location: results.location,
        response: sessionData
      };
    });
  }
};

// Handles the _Installation class specialness.
// Does nothing if this isn't an installation object.
// If an installation is found, this can mutate this.query and turn a create
// into an update.
// Returns a promise for when we're done if it can't finish this tick.
RestWrite.prototype.handleInstallation = function () {
  if (this.response || this.className !== '_Installation') {
    return;
  }
  if (!this.query && !this.data.deviceToken && !this.data.installationId && !this.auth.installationId) {
    throw new Parse.Error(135, 'at least one ID field (deviceToken, installationId) ' + 'must be specified in this operation');
  }

  // If the device token is 64 characters long, we assume it is for iOS
  // and lowercase it.
  if (this.data.deviceToken && this.data.deviceToken.length == 64) {
    this.data.deviceToken = this.data.deviceToken.toLowerCase();
  }

  // We lowercase the installationId if present
  if (this.data.installationId) {
    this.data.installationId = this.data.installationId.toLowerCase();
  }
  let installationId = this.data.installationId;

  // If data.installationId is not set and we're not master, we can lookup in auth
  if (!installationId && !this.auth.isMaster && !this.auth.isMaintenance) {
    installationId = this.auth.installationId;
  }
  if (installationId) {
    installationId = installationId.toLowerCase();
  }

  // Updating _Installation but not updating anything critical
  if (this.query && !this.data.deviceToken && !installationId && !this.data.deviceType) {
    return;
  }
  var promise = Promise.resolve();
  var idMatch; // Will be a match on either objectId or installationId
  var objectIdMatch;
  var installationIdMatch;
  var deviceTokenMatches = [];

  // Instead of issuing 3 reads, let's do it with one OR.
  const orQueries = [];
  if (this.query && this.query.objectId) {
    orQueries.push({
      objectId: this.query.objectId
    });
  }
  if (installationId) {
    orQueries.push({
      installationId: installationId
    });
  }
  if (this.data.deviceToken) {
    orQueries.push({
      deviceToken: this.data.deviceToken
    });
  }
  if (orQueries.length == 0) {
    return;
  }
  promise = promise.then(() => {
    return this.config.database.find('_Installation', {
      $or: orQueries
    }, {});
  }).then(results => {
    results.forEach(result => {
      if (this.query && this.query.objectId && result.objectId == this.query.objectId) {
        objectIdMatch = result;
      }
      if (result.installationId == installationId) {
        installationIdMatch = result;
      }
      if (result.deviceToken == this.data.deviceToken) {
        deviceTokenMatches.push(result);
      }
    });

    // Sanity checks when running a query
    if (this.query && this.query.objectId) {
      if (!objectIdMatch) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found for update.');
      }
      if (this.data.installationId && objectIdMatch.installationId && this.data.installationId !== objectIdMatch.installationId) {
        throw new Parse.Error(136, 'installationId may not be changed in this ' + 'operation');
      }
      if (this.data.deviceToken && objectIdMatch.deviceToken && this.data.deviceToken !== objectIdMatch.deviceToken && !this.data.installationId && !objectIdMatch.installationId) {
        throw new Parse.Error(136, 'deviceToken may not be changed in this ' + 'operation');
      }
      if (this.data.deviceType && this.data.deviceType && this.data.deviceType !== objectIdMatch.deviceType) {
        throw new Parse.Error(136, 'deviceType may not be changed in this ' + 'operation');
      }
    }
    if (this.query && this.query.objectId && objectIdMatch) {
      idMatch = objectIdMatch;
    }
    if (installationId && installationIdMatch) {
      idMatch = installationIdMatch;
    }
    // need to specify deviceType only if it's new
    if (!this.query && !this.data.deviceType && !idMatch) {
      throw new Parse.Error(135, 'deviceType must be specified in this operation');
    }
  }).then(() => {
    if (!idMatch) {
      if (!deviceTokenMatches.length) {
        return;
      } else if (deviceTokenMatches.length == 1 && (!deviceTokenMatches[0]['installationId'] || !installationId)) {
        // Single match on device token but none on installationId, and either
        // the passed object or the match is missing an installationId, so we
        // can just return the match.
        return deviceTokenMatches[0]['objectId'];
      } else if (!this.data.installationId) {
        throw new Parse.Error(132, 'Must specify installationId when deviceToken ' + 'matches multiple Installation objects');
      } else {
        // Multiple device token matches and we specified an installation ID,
        // or a single match where both the passed and matching objects have
        // an installation ID. Clean out other installations that match the
        // deviceToken, and return nil to signal that a new object should be
        // created.
        const delQuery = {
          deviceToken: this.data.deviceToken,
          installationId: {
            $ne: installationId
          }
        };
        if (this.data.appIdentifier) {
          delQuery['appIdentifier'] = this.data.appIdentifier;
        }
        const installationOpts = this.config.installation || {};
        return InstallationDedup.removeConflictingDeviceToken({
          database: this.config.database,
          query: delQuery,
          action: installationOpts.duplicateDeviceTokenAction || 'delete',
          enforceAuth: installationOpts.duplicateDeviceTokenActionEnforceAuth === true,
          runOptions: this.runOptions,
          validSchemaController: this.validSchemaController
        });
      }
    } else {
      if (deviceTokenMatches.length == 1 && !deviceTokenMatches[0]['installationId']) {
        // Exactly one device token match and it doesn't have an installation
        // ID. The two rows represent the same install; resolve the merge per
        // the configured options.
        const installationOpts = this.config.installation || {};
        return InstallationDedup.applyDuplicateDeviceTokenMerge({
          database: this.config.database,
          idMatch,
          deviceTokenMatch: deviceTokenMatches[0],
          action: installationOpts.duplicateDeviceTokenAction || 'delete',
          mergePriority: installationOpts.duplicateDeviceTokenMergePriority || 'deviceToken',
          enforceAuth: installationOpts.duplicateDeviceTokenActionEnforceAuth === true,
          runOptions: this.runOptions,
          validSchemaController: this.validSchemaController
        });
      } else {
        if (this.data.deviceToken && idMatch.deviceToken != this.data.deviceToken) {
          // We're setting the device token on an existing installation, so
          // we should try cleaning out old installations that match this
          // device token.
          const delQuery = {
            deviceToken: this.data.deviceToken
          };
          // We have a unique install Id, use that to preserve
          // the interesting installation
          if (this.data.installationId) {
            delQuery['installationId'] = {
              $ne: this.data.installationId
            };
          } else if (idMatch.objectId && this.data.objectId && idMatch.objectId == this.data.objectId) {
            // we passed an objectId, preserve that instalation
            delQuery['objectId'] = {
              $ne: idMatch.objectId
            };
          } else {
            // What to do here? can't really clean up everything...
            return idMatch.objectId;
          }
          if (this.data.appIdentifier) {
            delQuery['appIdentifier'] = this.data.appIdentifier;
          }
          const installationOpts = this.config.installation || {};
          return InstallationDedup.removeConflictingDeviceToken({
            database: this.config.database,
            query: delQuery,
            action: installationOpts.duplicateDeviceTokenAction || 'delete',
            enforceAuth: installationOpts.duplicateDeviceTokenActionEnforceAuth === true,
            runOptions: this.runOptions,
            validSchemaController: this.validSchemaController
          }).then(() => idMatch.objectId);
        }
        // In non-merge scenarios, just return the installation match id
        return idMatch.objectId;
      }
    }
  }).then(objId => {
    if (objId) {
      this.query = {
        objectId: objId
      };
      delete this.data.objectId;
      delete this.data.createdAt;
    }
    // TODO: Validate ops (add/remove on channels, $inc on badge, etc.)
  });
  return promise;
};

// If we short-circuited the object response - then we need to make sure we expand all the files,
// since this might not have a query, meaning it won't return the full result back.
// TODO: (nlutsenko) This should die when we move to per-class based controllers on _Session/_User
RestWrite.prototype.expandFilesForExistingObjects = async function () {
  // Check whether we have a short-circuited response - only then run expansion.
  if (this.response && this.response.response) {
    await this.config.filesController.expandFilesInObject(this.config, this.response.response);
  }
};
RestWrite.prototype.runDatabaseOperation = function () {
  if (this.response) {
    return;
  }
  if (this.className === '_Role') {
    this.config.cacheController.role.clear();
    if (this.config.liveQueryController) {
      this.config.liveQueryController.clearCachedRoles(this.auth.user);
    }
  }
  if (this.className === '_User' && this.query && this.auth.isUnauthenticated()) {
    throw (0, _Error.createSanitizedError)(Parse.Error.SESSION_MISSING, `Cannot modify user ${this.query.objectId}.`, this.config);
  }
  if (this.className === '_Product' && this.data.download) {
    this.data.downloadName = this.data.download.name;
  }

  // TODO: Add better detection for ACL, ensuring a user can't be locked from
  //       their own user record.
  if (this.data.ACL && this.data.ACL['*unresolved']) {
    throw new Parse.Error(Parse.Error.INVALID_ACL, 'Invalid ACL.');
  }
  if (this.query) {
    // Force the user to not lockout
    // Matched with parse.com
    if (this.className === '_User' && this.data.ACL && this.auth.isMaster !== true && this.auth.isMaintenance !== true) {
      this.data.ACL[this.query.objectId] = {
        read: true,
        write: true
      };
    }
    // update password timestamp if user password is being changed
    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
      this.data._password_changed_at = Parse._encode(new Date());
    }
    // Ignore createdAt when update
    delete this.data.createdAt;
    let defer = Promise.resolve();
    // if password history is enabled then save the current password to history
    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordHistory) {
      defer = this.config.database.find('_User', {
        objectId: this.objectId()
      }, {
        keys: ['_password_history', '_hashed_password']
      }, Auth.maintenance(this.config)).then(results => {
        if (results.length != 1) {
          throw undefined;
        }
        const user = results[0];
        let oldPasswords = [];
        if (user._password_history) {
          oldPasswords = _lodash.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory);
        }
        //n-1 passwords go into history including last password
        while (oldPasswords.length > Math.max(0, this.config.passwordPolicy.maxPasswordHistory - 2)) {
          oldPasswords.shift();
        }
        oldPasswords.push(user.password);
        this.data._password_history = oldPasswords;
      });
    }
    return defer.then(() => {
      // Run an update
      return this.config.database.update(this.className, this.query, this.data, this.runOptions, false, false, this.validSchemaController).catch(error => {
        this._throwIfAuthDataDuplicate(error);
        throw error;
      }).then(response => {
        response.updatedAt = this.updatedAt;
        this._updateResponseWithData(response, this.data);
        this.response = {
          response
        };
      });
    });
  } else {
    // Set the default ACL and password timestamp for the new _User
    if (this.className === '_User') {
      var ACL = this.data.ACL;
      // default public r/w ACL
      if (!ACL) {
        ACL = {};
        if (!this.config.enforcePrivateUsers) {
          ACL['*'] = {
            read: true,
            write: false
          };
        }
      }
      // make sure the user is not locked down
      ACL[this.data.objectId] = {
        read: true,
        write: true
      };
      this.data.ACL = ACL;
      // password timestamp to be used when password expiry policy is enforced
      if (this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
        this.data._password_changed_at = Parse._encode(new Date());
      }
    }

    // Run a create
    return this.config.database.create(this.className, this.data, this.runOptions, false, this.validSchemaController).catch(error => {
      if (this.className !== '_User' || error.code !== Parse.Error.DUPLICATE_VALUE) {
        throw error;
      }
      this._throwIfAuthDataDuplicate(error);

      // Quick check, if we were able to infer the duplicated field name
      if (error && error.userInfo && error.userInfo.duplicated_field === 'username') {
        throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
      }
      if (error && error.userInfo && error.userInfo.duplicated_field === 'email') {
        throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
      }

      // If this was a failed user creation due to username or email already taken, we need to
      // check whether it was username or email and return the appropriate error.
      // Fallback to the original method
      // TODO: See if we can later do this without additional queries by using named indexes.
      return this.config.database.find(this.className, {
        username: this.data.username,
        objectId: {
          $ne: this.objectId()
        }
      }, {
        limit: 1
      }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
        }
        return this.config.database.find(this.className, {
          email: this.data.email,
          objectId: {
            $ne: this.objectId()
          }
        }, {
          limit: 1
        });
      }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
        }
        throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      });
    }).then(response => {
      response.objectId = this.data.objectId;
      response.createdAt = this.data.createdAt;
      if (this.responseShouldHaveUsername) {
        response.username = this.data.username;
      }
      this._updateResponseWithData(response, this.data);
      this.response = {
        status: 201,
        response,
        location: this.location()
      };
    });
  }
};

// Returns nothing - doesn't wait for the trigger.
RestWrite.prototype.runAfterSaveTrigger = function () {
  if (!this.response || !this.response.response || this.runOptions.many) {
    return;
  }

  // Avoid doing any setup for triggers if there is no 'afterSave' trigger for this class.
  const hasAfterSaveHook = triggers.triggerExists(this.className, triggers.Types.afterSave, this.config.applicationId);
  const hasLiveQuery = this.config.liveQueryController.hasLiveQuery(this.className);
  if (!hasAfterSaveHook && !hasLiveQuery) {
    return Promise.resolve();
  }
  const {
    originalObject,
    updatedObject
  } = this.buildParseObjects();
  updatedObject._handleSaveResponse(this.response.response, this.response.status || 200);
  if (hasLiveQuery) {
    this.config.database.loadSchema().then(schemaController => {
      // Notify LiveQueryServer if possible
      const perms = schemaController.getClassLevelPermissions(updatedObject.className);
      this.config.liveQueryController.onAfterSave(updatedObject.className, updatedObject, originalObject, perms);
    });
  }
  if (!hasAfterSaveHook) {
    return Promise.resolve();
  }
  // Run afterSave trigger
  return triggers.maybeRunTrigger(triggers.Types.afterSave, this.auth, updatedObject, originalObject, this.config, this.context).then(result => {
    const jsonReturned = result && !result._toFullJSON;
    if (jsonReturned) {
      this.pendingOps.operations = {};
      this.response.response = result;
    } else {
      this.response.response = this._updateResponseWithData((result || updatedObject).toJSON(), this.data);
    }
  }).catch(function (err) {
    _logger.default.warn('afterSave caught an error', err);
  });
};

// A helper to figure out what location this operation happens at.
RestWrite.prototype.location = function () {
  var middle = this.className === '_User' ? '/users/' : '/classes/' + this.className + '/';
  const mount = this.config.mount || this.config.serverURL;
  return mount + middle + this.data.objectId;
};

// A helper to get the object id for this operation.
// Because it could be either on the query or on the data
RestWrite.prototype.objectId = function () {
  return this.data.objectId || this.query.objectId;
};

// Returns a copy of the data and delete bad keys (_auth_data, _hashed_password...)
RestWrite.prototype.sanitizedData = function () {
  const data = Object.keys(this.data).reduce((data, key) => {
    // Regexp comes from Parse.Object.prototype.validate
    if (!/^[A-Za-z][0-9A-Za-z_]*$/.test(key)) {
      delete data[key];
    }
    return data;
  }, structuredClone(this.data));
  return Parse._decode(undefined, data);
};

// Returns an updated copy of the object
RestWrite.prototype.buildParseObjects = function () {
  const extraData = {
    className: this.className,
    objectId: this.query?.objectId
  };
  let originalObject;
  if (this.query && this.query.objectId) {
    originalObject = triggers.inflate(extraData, this.originalData);
  }
  const className = Parse.Object.fromJSON(extraData);
  const readOnlyAttributes = className.constructor.readOnlyAttributes ? className.constructor.readOnlyAttributes() : [];

  // For _Role class, 'name' cannot be set after the role has an objectId.
  // In afterSave context, _handleSaveResponse has already set the objectId,
  // so we treat 'name' as read-only to avoid Parse SDK validation errors.
  const isRoleAfterSave = this.className === '_Role' && this.response && !this.query;
  if (isRoleAfterSave && this.data.name && !readOnlyAttributes.includes('name')) {
    readOnlyAttributes.push('name');
  }
  if (!this.originalData) {
    for (const attribute of readOnlyAttributes) {
      extraData[attribute] = this.data[attribute];
    }
  }
  const updatedObject = triggers.inflate(extraData, this.originalData);
  Object.keys(this.data).reduce(function (data, key) {
    if (key.indexOf('.') > 0) {
      if (typeof data[key].__op === 'string') {
        if (!readOnlyAttributes.includes(key)) {
          updatedObject.set(key, data[key]);
        }
      } else {
        // subdocument key with dot notation { 'x.y': v } => { 'x': { 'y' : v } })
        const splittedKey = key.split('.');
        const parentProp = splittedKey[0];
        let parentVal = updatedObject.get(parentProp);
        if (typeof parentVal !== 'object') {
          parentVal = {};
        }
        parentVal[splittedKey[1]] = data[key];
        updatedObject.set(parentProp, parentVal);
      }
      delete data[key];
    }
    return data;
  }, structuredClone(this.data));
  const sanitized = this.sanitizedData();
  for (const attribute of readOnlyAttributes) {
    delete sanitized[attribute];
  }
  updatedObject.set(sanitized);
  return {
    updatedObject,
    originalObject
  };
};
RestWrite.prototype.cleanUserAuthData = function () {
  if (this.response && this.response.response && this.className === '_User') {
    const user = this.response.response;
    if (user.authData) {
      Object.keys(user.authData).forEach(provider => {
        if (user.authData[provider] === null) {
          delete user.authData[provider];
        }
      });
      if (Object.keys(user.authData).length == 0) {
        delete user.authData;
      }
    }
  }
};

// Strips protected fields from the write response when protectedFieldsSaveResponseExempt is false.
RestWrite.prototype.filterProtectedFieldsInResponse = async function () {
  if (this.config.protectedFieldsSaveResponseExempt !== false) {
    return;
  }
  if (this.auth.isMaster || this.auth.isMaintenance) {
    return;
  }
  if (!this.response || !this.response.response) {
    return;
  }
  const schemaController = await this.config.database.loadSchema();
  const protectedFields = this.config.database.addProtectedFields(schemaController, this.className, this.query ? {
    objectId: this.query.objectId
  } : {}, this.auth.user ? [this.auth.user.id].concat(this.auth.userRoles || []) : [], this.auth, {});
  if (!protectedFields) {
    return;
  }
  for (const field of protectedFields) {
    delete this.response.response[field];
  }
};
RestWrite.prototype._updateResponseWithData = function (response, data) {
  const stateController = Parse.CoreManager.getObjectStateController();
  const [pending] = stateController.getPendingOps(this.pendingOps.identifier);
  for (const key in this.pendingOps.operations) {
    if (!pending[key]) {
      data[key] = this.originalData ? this.originalData[key] : {
        __op: 'Delete'
      };
      this.storage.fieldsChangedByTrigger.push(key);
    }
  }
  const skipKeys = [...(_SchemaController.requiredColumns.read[this.className] || [])];
  if (!this.query) {
    skipKeys.push('objectId', 'createdAt');
  } else {
    skipKeys.push('updatedAt');
    delete response.objectId;
  }
  for (const key in response) {
    if (skipKeys.includes(key)) {
      continue;
    }
    const value = response[key];
    if (value == null || value.__type && value.__type === 'Pointer' || util.isDeepStrictEqual(data[key], value) || util.isDeepStrictEqual((this.originalData || {})[key], value)) {
      delete response[key];
    }
  }
  if (_lodash.default.isEmpty(this.storage.fieldsChangedByTrigger)) {
    return response;
  }
  const clientSupportsDelete = ClientSDK.supportsForwardDelete(this.clientSDK);
  this.storage.fieldsChangedByTrigger.forEach(fieldName => {
    const dataValue = data[fieldName];
    if (!Object.prototype.hasOwnProperty.call(response, fieldName)) {
      response[fieldName] = dataValue;
    }

    // Strips operations from responses
    if (response[fieldName] && response[fieldName].__op) {
      delete response[fieldName];
      if (clientSupportsDelete && dataValue.__op == 'Delete') {
        response[fieldName] = dataValue;
      }
    }
  });
  return response;
};
var _default = exports.default = RestWrite;
module.exports = RestWrite;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfUmVzdFF1ZXJ5IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfbG9kYXNoIiwiX2xvZ2dlciIsIl9TY2hlbWFDb250cm9sbGVyIiwiX0Vycm9yIiwiX0F1dGhEYXRhTG9jayIsIkluc3RhbGxhdGlvbkRlZHVwIiwiX2ludGVyb3BSZXF1aXJlV2lsZGNhcmQiLCJlIiwidCIsIldlYWtNYXAiLCJyIiwibiIsIl9fZXNNb2R1bGUiLCJvIiwiaSIsImYiLCJfX3Byb3RvX18iLCJkZWZhdWx0IiwiaGFzIiwiZ2V0Iiwic2V0IiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJnZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IiLCJTY2hlbWFDb250cm9sbGVyIiwiQXV0aCIsIlV0aWxzIiwiY3J5cHRvVXRpbHMiLCJwYXNzd29yZENyeXB0byIsIlBhcnNlIiwidHJpZ2dlcnMiLCJDbGllbnRTREsiLCJ1dGlsIiwiUmVzdFdyaXRlIiwiY29uZmlnIiwiYXV0aCIsImNsYXNzTmFtZSIsInF1ZXJ5IiwiZGF0YSIsIm9yaWdpbmFsRGF0YSIsImNsaWVudFNESyIsImNvbnRleHQiLCJhY3Rpb24iLCJpc1JlYWRPbmx5IiwiY3JlYXRlU2FuaXRpemVkRXJyb3IiLCJFcnJvciIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJzdG9yYWdlIiwicnVuT3B0aW9ucyIsImFsbG93Q3VzdG9tT2JqZWN0SWQiLCJwcm90b3R5cGUiLCJvYmplY3RJZCIsIk1JU1NJTkdfT0JKRUNUX0lEIiwiSU5WQUxJRF9LRVlfTkFNRSIsImlkIiwicmVzcG9uc2UiLCJzdHJ1Y3R1cmVkQ2xvbmUiLCJ1cGRhdGVkQXQiLCJfZW5jb2RlIiwiRGF0ZSIsImlzbyIsInZhbGlkU2NoZW1hQ29udHJvbGxlciIsInBlbmRpbmdPcHMiLCJvcGVyYXRpb25zIiwiaWRlbnRpZmllciIsImV4ZWN1dGUiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJnZXRVc2VyQW5kUm9sZUFDTCIsInZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbiIsImhhbmRsZUluc3RhbGxhdGlvbiIsImhhbmRsZVNlc3Npb24iLCJ2YWxpZGF0ZUF1dGhEYXRhIiwiY2hlY2tSZXN0cmljdGVkRmllbGRzIiwicnVuQmVmb3JlU2F2ZVRyaWdnZXIiLCJlbnN1cmVVbmlxdWVBdXRoRGF0YUlkIiwiZGVsZXRlRW1haWxSZXNldFRva2VuSWZOZWVkZWQiLCJ2YWxpZGF0ZVNjaGVtYSIsInNjaGVtYUNvbnRyb2xsZXIiLCJzZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkIiwidmFsaWRhdGVDcmVhdGVQZXJtaXNzaW9uIiwidHJhbnNmb3JtVXNlciIsImV4cGFuZEZpbGVzRm9yRXhpc3RpbmdPYmplY3RzIiwiZGVzdHJveUR1cGxpY2F0ZWRTZXNzaW9ucyIsInJ1bkRhdGFiYXNlT3BlcmF0aW9uIiwiY3JlYXRlU2Vzc2lvblRva2VuSWZOZWVkZWQiLCJoYW5kbGVGb2xsb3d1cCIsInJ1bkFmdGVyU2F2ZVRyaWdnZXIiLCJjbGVhblVzZXJBdXRoRGF0YSIsImZpbHRlclByb3RlY3RlZEZpZWxkc0luUmVzcG9uc2UiLCJhdXRoRGF0YVJlc3BvbnNlIiwicmVqZWN0U2lnbnVwIiwicHJldmVudFNpZ251cFdpdGhVbnZlcmlmaWVkRW1haWwiLCJFTUFJTF9OT1RfRk9VTkQiLCJpc01hc3RlciIsImlzTWFpbnRlbmFuY2UiLCJhY2wiLCJ1c2VyIiwiZ2V0VXNlclJvbGVzIiwicm9sZXMiLCJjb25jYXQiLCJhbGxvd0NsaWVudENsYXNzQ3JlYXRpb24iLCJzeXN0ZW1DbGFzc2VzIiwiaW5kZXhPZiIsImRhdGFiYXNlIiwibG9hZFNjaGVtYSIsImhhc0NsYXNzIiwidmFsaWRhdGVPYmplY3QiLCJtYW55IiwidHJpZ2dlckV4aXN0cyIsIlR5cGVzIiwiYmVmb3JlU2F2ZSIsImFwcGxpY2F0aW9uSWQiLCJvcmlnaW5hbE9iamVjdCIsInVwZGF0ZWRPYmplY3QiLCJidWlsZFBhcnNlT2JqZWN0cyIsIl9nZXRTdGF0ZUlkZW50aWZpZXIiLCJzdGF0ZUNvbnRyb2xsZXIiLCJDb3JlTWFuYWdlciIsImdldE9iamVjdFN0YXRlQ29udHJvbGxlciIsInBlbmRpbmciLCJnZXRQZW5kaW5nT3BzIiwiZGF0YWJhc2VQcm9taXNlIiwidXBkYXRlIiwiY3JlYXRlIiwicmVzdWx0IiwibGVuZ3RoIiwiT0JKRUNUX05PVF9GT1VORCIsIm1heWJlUnVuVHJpZ2dlciIsIm9iamVjdCIsImZpZWxkc0NoYW5nZWRCeVRyaWdnZXIiLCJfIiwicmVkdWNlIiwidmFsdWUiLCJrZXkiLCJpc0VxdWFsIiwicHVzaCIsImNoZWNrUHJvaGliaXRlZEtleXdvcmRzIiwiZXJyb3IiLCJydW5CZWZvcmVMb2dpblRyaWdnZXIiLCJ1c2VyRGF0YSIsImJlZm9yZUxvZ2luIiwiZXh0cmFEYXRhIiwiZmlsZXNDb250cm9sbGVyIiwiZXhwYW5kRmlsZXNJbk9iamVjdCIsImluZmxhdGUiLCJnZXRBbGxDbGFzc2VzIiwiYWxsQ2xhc3NlcyIsInNjaGVtYSIsImZpbmQiLCJvbmVDbGFzcyIsInNldFJlcXVpcmVkRmllbGRJZk5lZWRlZCIsImZpZWxkTmFtZSIsInNldERlZmF1bHQiLCJ1bmRlZmluZWQiLCJfX29wIiwiZmllbGRzIiwiZGVmYXVsdFZhbHVlIiwicmVxdWlyZWQiLCJWQUxJREFUSU9OX0VSUk9SIiwiY2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiQUNMIiwiSlNPTiIsInN0cmluZ2lmeSIsInJlYWQiLCJ3cml0ZSIsImN1cnJlbnRVc2VyIiwiY3JlYXRlZEF0IiwiX190eXBlIiwibmV3T2JqZWN0SWQiLCJvYmplY3RJZFNpemUiLCJrZXlzIiwiZm9yRWFjaCIsImF1dGhEYXRhIiwiaGFzVXNlcm5hbWVBbmRQYXNzd29yZCIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJoYXNBdXRoRGF0YSIsInNvbWUiLCJwcm92aWRlciIsInByb3ZpZGVyRGF0YSIsImlzRW1wdHkiLCJVU0VSTkFNRV9NSVNTSU5HIiwiUEFTU1dPUkRfTUlTU0lORyIsIlVOU1VQUE9SVEVEX1NFUlZJQ0UiLCJwcm92aWRlcnMiLCJjYW5IYW5kbGVBdXRoRGF0YSIsInByb3ZpZGVyQXV0aERhdGEiLCJnZXRVc2VySWQiLCJoYW5kbGVBdXRoRGF0YSIsImZpbHRlcmVkT2JqZWN0c0J5QUNMIiwib2JqZWN0cyIsImZpbHRlciIsIl90aHJvd0lmQXV0aERhdGFEdXBsaWNhdGUiLCJjb2RlIiwiRFVQTElDQVRFX1ZBTFVFIiwidXNlckluZm8iLCJkdXBsaWNhdGVkX2ZpZWxkIiwic3RhcnRzV2l0aCIsIkFDQ09VTlRfQUxSRUFEWV9MSU5LRUQiLCJoYXNBdXRoRGF0YUlkIiwiZmluZFVzZXJzV2l0aEF1dGhEYXRhIiwicmVzdWx0cyIsInVzZXJJZCIsImN1cnJlbnRVc2VyQXV0aERhdGEiLCJ1c2VyUmVzdWx0IiwiZm91bmRVc2VySXNOb3RDdXJyZW50VXNlciIsImhhbmRsZUF1dGhEYXRhVmFsaWRhdGlvbiIsInZhbGlkYXRlZEF1dGhEYXRhIiwiYXV0aFByb3ZpZGVyIiwiam9pbiIsImhhc011dGF0ZWRBdXRoRGF0YSIsIm11dGF0ZWRBdXRoRGF0YSIsImlzQ3VycmVudFVzZXJMb2dnZWRPck1hc3RlciIsImlzTG9naW4iLCJsb2NhdGlvbiIsImNoZWNrSWZVc2VySGFzUHJvdmlkZWRDb25maWd1cmVkUHJvdmlkZXJzRm9yTG9naW4iLCJhbGxvd0V4cGlyZWRBdXRoRGF0YVRva2VuIiwicmVzIiwib3JpZ2luYWxBdXRoRGF0YSIsImZyb21FbnRyaWVzIiwiZW50cmllcyIsIm1hcCIsImsiLCJ2IiwiYXBwbHlBdXRoRGF0YU9wdGltaXN0aWNMb2NrIiwiU0NSSVBUX0ZBSUxFRCIsInZhbGlkYXRlUGVybWlzc2lvbiIsInByb21pc2UiLCJSZXN0UXVlcnkiLCJtZXRob2QiLCJNZXRob2QiLCJtYXN0ZXIiLCJydW5CZWZvcmVGaW5kIiwicmVzdFdoZXJlIiwic2Vzc2lvbiIsImNhY2hlQ29udHJvbGxlciIsImRlbCIsInNlc3Npb25Ub2tlbiIsIl92YWxpZGF0ZVBhc3N3b3JkUG9saWN5IiwiaGFzaCIsImhhc2hlZFBhc3N3b3JkIiwiX2hhc2hlZF9wYXNzd29yZCIsIl92YWxpZGF0ZVVzZXJOYW1lIiwiX3ZhbGlkYXRlRW1haWwiLCJyYW5kb21TdHJpbmciLCJyZXNwb25zZVNob3VsZEhhdmVVc2VybmFtZSIsIiRuZSIsImxpbWl0IiwiY2FzZUluc2Vuc2l0aXZlIiwiVVNFUk5BTUVfVEFLRU4iLCJidWlsZENyZWF0ZWRXaXRoIiwiZ2V0Q3JlYXRlZFdpdGgiLCJjcmVhdGVkV2l0aCIsImlzQ3JlYXRlT3BlcmF0aW9uIiwiYXV0aERhdGFQcm92aWRlciIsInJlc29sdmVkQXV0aFByb3ZpZGVyIiwiZW1haWwiLCJtYXRjaCIsInJlamVjdCIsIklOVkFMSURfRU1BSUxfQUREUkVTUyIsIkVNQUlMX1RBS0VOIiwicmVxdWVzdCIsIm9yaWdpbmFsIiwiaXAiLCJpbnN0YWxsYXRpb25JZCIsInVzZXJDb250cm9sbGVyIiwic2V0RW1haWxWZXJpZnlUb2tlbiIsInBhc3N3b3JkUG9saWN5IiwiX3ZhbGlkYXRlUGFzc3dvcmRSZXF1aXJlbWVudHMiLCJfdmFsaWRhdGVQYXNzd29yZEhpc3RvcnkiLCJwb2xpY3lFcnJvciIsInZhbGlkYXRpb25FcnJvciIsImNvbnRhaW5zVXNlcm5hbWVFcnJvciIsInBhdHRlcm5WYWxpZGF0b3IiLCJ2YWxpZGF0b3JDYWxsYmFjayIsImRvTm90QWxsb3dVc2VybmFtZSIsIm1heFBhc3N3b3JkSGlzdG9yeSIsIm1haW50ZW5hbmNlIiwib2xkUGFzc3dvcmRzIiwiX3Bhc3N3b3JkX2hpc3RvcnkiLCJ0YWtlIiwibmV3UGFzc3dvcmQiLCJwcm9taXNlcyIsImNvbXBhcmUiLCJhbGwiLCJjYXRjaCIsImVyciIsInZlcmlmeVVzZXJFbWFpbHMiLCJwcmV2ZW50TG9naW5XaXRoVW52ZXJpZmllZEVtYWlsIiwiY3JlYXRlU2Vzc2lvblRva2VuIiwic2Vzc2lvbkRhdGEiLCJjcmVhdGVTZXNzaW9uIiwiYWRkaXRpb25hbFNlc3Npb25EYXRhIiwidG9rZW4iLCJuZXdUb2tlbiIsImV4cGlyZXNBdCIsImdlbmVyYXRlU2Vzc2lvbkV4cGlyZXNBdCIsImFzc2lnbiIsImFkZE9wcyIsIl9wZXJpc2hhYmxlX3Rva2VuIiwiX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCIsImRlc3Ryb3kiLCJyZXZva2VTZXNzaW9uT25QYXNzd29yZFJlc2V0Iiwic2Vzc2lvblF1ZXJ5IiwiYmluZCIsInNlbmRWZXJpZmljYXRpb25FbWFpbCIsIklOVkFMSURfU0VTU0lPTl9UT0tFTiIsIiRhbmQiLCJJTlRFUk5BTF9TRVJWRVJfRVJST1IiLCJzdGF0dXMiLCJkZXZpY2VUb2tlbiIsInRvTG93ZXJDYXNlIiwiZGV2aWNlVHlwZSIsImlkTWF0Y2giLCJvYmplY3RJZE1hdGNoIiwiaW5zdGFsbGF0aW9uSWRNYXRjaCIsImRldmljZVRva2VuTWF0Y2hlcyIsIm9yUXVlcmllcyIsIiRvciIsImRlbFF1ZXJ5IiwiYXBwSWRlbnRpZmllciIsImluc3RhbGxhdGlvbk9wdHMiLCJpbnN0YWxsYXRpb24iLCJyZW1vdmVDb25mbGljdGluZ0RldmljZVRva2VuIiwiZHVwbGljYXRlRGV2aWNlVG9rZW5BY3Rpb24iLCJlbmZvcmNlQXV0aCIsImR1cGxpY2F0ZURldmljZVRva2VuQWN0aW9uRW5mb3JjZUF1dGgiLCJhcHBseUR1cGxpY2F0ZURldmljZVRva2VuTWVyZ2UiLCJkZXZpY2VUb2tlbk1hdGNoIiwibWVyZ2VQcmlvcml0eSIsImR1cGxpY2F0ZURldmljZVRva2VuTWVyZ2VQcmlvcml0eSIsIm9iaklkIiwicm9sZSIsImNsZWFyIiwibGl2ZVF1ZXJ5Q29udHJvbGxlciIsImNsZWFyQ2FjaGVkUm9sZXMiLCJpc1VuYXV0aGVudGljYXRlZCIsIlNFU1NJT05fTUlTU0lORyIsImRvd25sb2FkIiwiZG93bmxvYWROYW1lIiwibmFtZSIsIklOVkFMSURfQUNMIiwibWF4UGFzc3dvcmRBZ2UiLCJfcGFzc3dvcmRfY2hhbmdlZF9hdCIsImRlZmVyIiwiTWF0aCIsIm1heCIsInNoaWZ0IiwiX3VwZGF0ZVJlc3BvbnNlV2l0aERhdGEiLCJlbmZvcmNlUHJpdmF0ZVVzZXJzIiwiaGFzQWZ0ZXJTYXZlSG9vayIsImFmdGVyU2F2ZSIsImhhc0xpdmVRdWVyeSIsIl9oYW5kbGVTYXZlUmVzcG9uc2UiLCJwZXJtcyIsImdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsIm9uQWZ0ZXJTYXZlIiwianNvblJldHVybmVkIiwiX3RvRnVsbEpTT04iLCJ0b0pTT04iLCJsb2dnZXIiLCJ3YXJuIiwibWlkZGxlIiwibW91bnQiLCJzZXJ2ZXJVUkwiLCJzYW5pdGl6ZWREYXRhIiwidGVzdCIsIl9kZWNvZGUiLCJmcm9tSlNPTiIsInJlYWRPbmx5QXR0cmlidXRlcyIsImNvbnN0cnVjdG9yIiwiaXNSb2xlQWZ0ZXJTYXZlIiwiaW5jbHVkZXMiLCJhdHRyaWJ1dGUiLCJzcGxpdHRlZEtleSIsInNwbGl0IiwicGFyZW50UHJvcCIsInBhcmVudFZhbCIsInNhbml0aXplZCIsInByb3RlY3RlZEZpZWxkc1NhdmVSZXNwb25zZUV4ZW1wdCIsInByb3RlY3RlZEZpZWxkcyIsImFkZFByb3RlY3RlZEZpZWxkcyIsInVzZXJSb2xlcyIsImZpZWxkIiwic2tpcEtleXMiLCJyZXF1aXJlZENvbHVtbnMiLCJpc0RlZXBTdHJpY3RFcXVhbCIsImNsaWVudFN1cHBvcnRzRGVsZXRlIiwic3VwcG9ydHNGb3J3YXJkRGVsZXRlIiwiZGF0YVZhbHVlIiwiX2RlZmF1bHQiLCJleHBvcnRzIiwibW9kdWxlIl0sInNvdXJjZXMiOlsiLi4vc3JjL1Jlc3RXcml0ZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBBIFJlc3RXcml0ZSBlbmNhcHN1bGF0ZXMgZXZlcnl0aGluZyB3ZSBuZWVkIHRvIHJ1biBhbiBvcGVyYXRpb25cbi8vIHRoYXQgd3JpdGVzIHRvIHRoZSBkYXRhYmFzZS5cbi8vIFRoaXMgY291bGQgYmUgZWl0aGVyIGEgXCJjcmVhdGVcIiBvciBhbiBcInVwZGF0ZVwiLlxuXG52YXIgU2NoZW1hQ29udHJvbGxlciA9IHJlcXVpcmUoJy4vQ29udHJvbGxlcnMvU2NoZW1hQ29udHJvbGxlcicpO1xuXG5jb25zdCBBdXRoID0gcmVxdWlyZSgnLi9BdXRoJyk7XG5jb25zdCBVdGlscyA9IHJlcXVpcmUoJy4vVXRpbHMnKTtcbnZhciBjcnlwdG9VdGlscyA9IHJlcXVpcmUoJy4vY3J5cHRvVXRpbHMnKTtcbnZhciBwYXNzd29yZENyeXB0byA9IHJlcXVpcmUoJy4vcGFzc3dvcmQnKTtcbnZhciBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKTtcbnZhciB0cmlnZ2VycyA9IHJlcXVpcmUoJy4vdHJpZ2dlcnMnKTtcbnZhciBDbGllbnRTREsgPSByZXF1aXJlKCcuL0NsaWVudFNESycpO1xuY29uc3QgdXRpbCA9IHJlcXVpcmUoJ3V0aWwnKTtcbmltcG9ydCBSZXN0UXVlcnkgZnJvbSAnLi9SZXN0UXVlcnknO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCBsb2dnZXIgZnJvbSAnLi9sb2dnZXInO1xuaW1wb3J0IHsgcmVxdWlyZWRDb2x1bW5zIH0gZnJvbSAnLi9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyJztcbmltcG9ydCB7IGNyZWF0ZVNhbml0aXplZEVycm9yIH0gZnJvbSAnLi9FcnJvcic7XG5pbXBvcnQgeyBhcHBseUF1dGhEYXRhT3B0aW1pc3RpY0xvY2sgfSBmcm9tICcuL0F1dGhEYXRhTG9jayc7XG5pbXBvcnQgKiBhcyBJbnN0YWxsYXRpb25EZWR1cCBmcm9tICcuL0luc3RhbGxhdGlvbkRlZHVwJztcblxuLy8gcXVlcnkgYW5kIGRhdGEgYXJlIGJvdGggcHJvdmlkZWQgaW4gUkVTVCBBUEkgZm9ybWF0LiBTbyBkYXRhXG4vLyB0eXBlcyBhcmUgZW5jb2RlZCBieSBwbGFpbiBvbGQgb2JqZWN0cy5cbi8vIElmIHF1ZXJ5IGlzIG51bGwsIHRoaXMgaXMgYSBcImNyZWF0ZVwiIGFuZCB0aGUgZGF0YSBpbiBkYXRhIHNob3VsZCBiZVxuLy8gY3JlYXRlZC5cbi8vIE90aGVyd2lzZSB0aGlzIGlzIGFuIFwidXBkYXRlXCIgLSB0aGUgb2JqZWN0IG1hdGNoaW5nIHRoZSBxdWVyeVxuLy8gc2hvdWxkIGdldCB1cGRhdGVkIHdpdGggZGF0YS5cbi8vIFJlc3RXcml0ZSB3aWxsIGhhbmRsZSBvYmplY3RJZCwgY3JlYXRlZEF0LCBhbmQgdXBkYXRlZEF0IGZvclxuLy8gZXZlcnl0aGluZy4gSXQgYWxzbyBrbm93cyB0byB1c2UgdHJpZ2dlcnMgYW5kIHNwZWNpYWwgbW9kaWZpY2F0aW9uc1xuLy8gZm9yIHRoZSBfVXNlciBjbGFzcy5cbmZ1bmN0aW9uIFJlc3RXcml0ZShjb25maWcsIGF1dGgsIGNsYXNzTmFtZSwgcXVlcnksIGRhdGEsIG9yaWdpbmFsRGF0YSwgY2xpZW50U0RLLCBjb250ZXh0LCBhY3Rpb24pIHtcbiAgaWYgKGF1dGguaXNSZWFkT25seSkge1xuICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICdDYW5ub3QgcGVyZm9ybSBhIHdyaXRlIG9wZXJhdGlvbiB3aGVuIHVzaW5nIHJlYWRPbmx5TWFzdGVyS2V5JyxcbiAgICAgIGNvbmZpZ1xuICAgICk7XG4gIH1cbiAgdGhpcy5jb25maWcgPSBjb25maWc7XG4gIHRoaXMuYXV0aCA9IGF1dGg7XG4gIHRoaXMuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuICB0aGlzLmNsaWVudFNESyA9IGNsaWVudFNESztcbiAgdGhpcy5zdG9yYWdlID0ge307XG4gIHRoaXMucnVuT3B0aW9ucyA9IHt9O1xuICB0aGlzLmNvbnRleHQgPSBjb250ZXh0IHx8IHt9O1xuXG4gIGlmIChhY3Rpb24pIHtcbiAgICB0aGlzLnJ1bk9wdGlvbnMuYWN0aW9uID0gYWN0aW9uO1xuICB9XG5cbiAgaWYgKCFxdWVyeSkge1xuICAgIGlmICh0aGlzLmNvbmZpZy5hbGxvd0N1c3RvbU9iamVjdElkKSB7XG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGRhdGEsICdvYmplY3RJZCcpICYmICFkYXRhLm9iamVjdElkKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5NSVNTSU5HX09CSkVDVF9JRCxcbiAgICAgICAgICAnb2JqZWN0SWQgbXVzdCBub3QgYmUgZW1wdHksIG51bGwgb3IgdW5kZWZpbmVkJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoZGF0YS5vYmplY3RJZCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgJ29iamVjdElkIGlzIGFuIGludmFsaWQgZmllbGQgbmFtZS4nKTtcbiAgICAgIH1cbiAgICAgIGlmIChkYXRhLmlkKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCAnaWQgaXMgYW4gaW52YWxpZCBmaWVsZCBuYW1lLicpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFdoZW4gdGhlIG9wZXJhdGlvbiBpcyBjb21wbGV0ZSwgdGhpcy5yZXNwb25zZSBtYXkgaGF2ZSBzZXZlcmFsXG4gIC8vIGZpZWxkcy5cbiAgLy8gcmVzcG9uc2U6IHRoZSBhY3R1YWwgZGF0YSB0byBiZSByZXR1cm5lZFxuICAvLyBzdGF0dXM6IHRoZSBodHRwIHN0YXR1cyBjb2RlLiBpZiBub3QgcHJlc2VudCwgdHJlYXRlZCBsaWtlIGEgMjAwXG4gIC8vIGxvY2F0aW9uOiB0aGUgbG9jYXRpb24gaGVhZGVyLiBpZiBub3QgcHJlc2VudCwgbm8gbG9jYXRpb24gaGVhZGVyXG4gIHRoaXMucmVzcG9uc2UgPSBudWxsO1xuXG4gIC8vIFByb2Nlc3NpbmcgdGhpcyBvcGVyYXRpb24gbWF5IG11dGF0ZSBvdXIgZGF0YSwgc28gd2Ugb3BlcmF0ZSBvbiBhXG4gIC8vIGNvcHlcbiAgdGhpcy5xdWVyeSA9IHN0cnVjdHVyZWRDbG9uZShxdWVyeSk7XG4gIHRoaXMuZGF0YSA9IHN0cnVjdHVyZWRDbG9uZShkYXRhKTtcbiAgLy8gV2UgbmV2ZXIgY2hhbmdlIG9yaWdpbmFsRGF0YSwgc28gd2UgZG8gbm90IG5lZWQgYSBkZWVwIGNvcHlcbiAgdGhpcy5vcmlnaW5hbERhdGEgPSBvcmlnaW5hbERhdGE7XG5cbiAgLy8gVGhlIHRpbWVzdGFtcCB3ZSdsbCB1c2UgZm9yIHRoaXMgd2hvbGUgb3BlcmF0aW9uXG4gIHRoaXMudXBkYXRlZEF0ID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZSgpKS5pc287XG5cbiAgLy8gU2hhcmVkIFNjaGVtYUNvbnRyb2xsZXIgdG8gYmUgcmV1c2VkIHRvIHJlZHVjZSB0aGUgbnVtYmVyIG9mIGxvYWRTY2hlbWEoKSBjYWxscyBwZXIgcmVxdWVzdFxuICAvLyBPbmNlIHNldCB0aGUgc2NoZW1hRGF0YSBzaG91bGQgYmUgaW1tdXRhYmxlXG4gIHRoaXMudmFsaWRTY2hlbWFDb250cm9sbGVyID0gbnVsbDtcbiAgdGhpcy5wZW5kaW5nT3BzID0ge1xuICAgIG9wZXJhdGlvbnM6IG51bGwsXG4gICAgaWRlbnRpZmllcjogbnVsbCxcbiAgfTtcbn1cblxuLy8gQSBjb252ZW5pZW50IG1ldGhvZCB0byBwZXJmb3JtIGFsbCB0aGUgc3RlcHMgb2YgcHJvY2Vzc2luZyB0aGVcbi8vIHdyaXRlLCBpbiBvcmRlci5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIHtyZXNwb25zZSwgc3RhdHVzLCBsb2NhdGlvbn0gb2JqZWN0LlxuLy8gc3RhdHVzIGFuZCBsb2NhdGlvbiBhcmUgb3B0aW9uYWwuXG5SZXN0V3JpdGUucHJvdG90eXBlLmV4ZWN1dGUgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmdldFVzZXJBbmRSb2xlQUNMKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZUNsaWVudENsYXNzQ3JlYXRpb24oKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUluc3RhbGxhdGlvbigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlU2Vzc2lvbigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMudmFsaWRhdGVBdXRoRGF0YSgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuY2hlY2tSZXN0cmljdGVkRmllbGRzKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5CZWZvcmVTYXZlVHJpZ2dlcigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuZW5zdXJlVW5pcXVlQXV0aERhdGFJZCgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuZGVsZXRlRW1haWxSZXNldFRva2VuSWZOZWVkZWQoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2NoZW1hKCk7XG4gICAgfSlcbiAgICAudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHtcbiAgICAgIHRoaXMudmFsaWRTY2hlbWFDb250cm9sbGVyID0gc2NoZW1hQ29udHJvbGxlcjtcbiAgICAgIHJldHVybiB0aGlzLnNldFJlcXVpcmVkRmllbGRzSWZOZWVkZWQoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlQ3JlYXRlUGVybWlzc2lvbigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtVXNlcigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuZXhwYW5kRmlsZXNGb3JFeGlzdGluZ09iamVjdHMoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmRlc3Ryb3lEdXBsaWNhdGVkU2Vzc2lvbnMoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkRhdGFiYXNlT3BlcmF0aW9uKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVTZXNzaW9uVG9rZW5JZk5lZWRlZCgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlRm9sbG93dXAoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkFmdGVyU2F2ZVRyaWdnZXIoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmNsZWFuVXNlckF1dGhEYXRhKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5maWx0ZXJQcm90ZWN0ZWRGaWVsZHNJblJlc3BvbnNlKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICAvLyBBcHBlbmQgdGhlIGF1dGhEYXRhUmVzcG9uc2UgaWYgZXhpc3RzXG4gICAgICBpZiAodGhpcy5hdXRoRGF0YVJlc3BvbnNlKSB7XG4gICAgICAgIGlmICh0aGlzLnJlc3BvbnNlICYmIHRoaXMucmVzcG9uc2UucmVzcG9uc2UpIHtcbiAgICAgICAgICB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlLmF1dGhEYXRhUmVzcG9uc2UgPSB0aGlzLmF1dGhEYXRhUmVzcG9uc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnN0b3JhZ2UucmVqZWN0U2lnbnVwICYmIHRoaXMuY29uZmlnLnByZXZlbnRTaWdudXBXaXRoVW52ZXJpZmllZEVtYWlsKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5FTUFJTF9OT1RfRk9VTkQsICdVc2VyIGVtYWlsIGlzIG5vdCB2ZXJpZmllZC4nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLnJlc3BvbnNlO1xuICAgIH0pO1xufTtcblxuLy8gVXNlcyB0aGUgQXV0aCBvYmplY3QgdG8gZ2V0IHRoZSBsaXN0IG9mIHJvbGVzLCBhZGRzIHRoZSB1c2VyIGlkXG5SZXN0V3JpdGUucHJvdG90eXBlLmdldFVzZXJBbmRSb2xlQUNMID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5hdXRoLmlzTWFzdGVyIHx8IHRoaXMuYXV0aC5pc01haW50ZW5hbmNlKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgdGhpcy5ydW5PcHRpb25zLmFjbCA9IFsnKiddO1xuXG4gIGlmICh0aGlzLmF1dGgudXNlcikge1xuICAgIHJldHVybiB0aGlzLmF1dGguZ2V0VXNlclJvbGVzKCkudGhlbihyb2xlcyA9PiB7XG4gICAgICB0aGlzLnJ1bk9wdGlvbnMuYWNsID0gdGhpcy5ydW5PcHRpb25zLmFjbC5jb25jYXQocm9sZXMsIFt0aGlzLmF1dGgudXNlci5pZF0pO1xuICAgICAgcmV0dXJuO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufTtcblxuLy8gVmFsaWRhdGVzIHRoaXMgb3BlcmF0aW9uIGFnYWluc3QgdGhlIGFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiBjb25maWcuXG5SZXN0V3JpdGUucHJvdG90eXBlLnZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbiA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKFxuICAgIHRoaXMuY29uZmlnLmFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiA9PT0gZmFsc2UgJiZcbiAgICAhdGhpcy5hdXRoLmlzTWFzdGVyICYmXG4gICAgIXRoaXMuYXV0aC5pc01haW50ZW5hbmNlICYmXG4gICAgU2NoZW1hQ29udHJvbGxlci5zeXN0ZW1DbGFzc2VzLmluZGV4T2YodGhpcy5jbGFzc05hbWUpID09PSAtMVxuICApIHtcbiAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAgIC5sb2FkU2NoZW1hKClcbiAgICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4gc2NoZW1hQ29udHJvbGxlci5oYXNDbGFzcyh0aGlzLmNsYXNzTmFtZSkpXG4gICAgICAudGhlbihoYXNDbGFzcyA9PiB7XG4gICAgICAgIGlmIChoYXNDbGFzcyAhPT0gdHJ1ZSkge1xuICAgICAgICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgICAgICdUaGlzIHVzZXIgaXMgbm90IGFsbG93ZWQgdG8gYWNjZXNzIG5vbi1leGlzdGVudCBjbGFzczogJyArIHRoaXMuY2xhc3NOYW1lLFxuICAgICAgICAgICAgdGhpcy5jb25maWdcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbn07XG5cbi8vIFZhbGlkYXRlcyB0aGlzIG9wZXJhdGlvbiBhZ2FpbnN0IHRoZSBzY2hlbWEuXG5SZXN0V3JpdGUucHJvdG90eXBlLnZhbGlkYXRlU2NoZW1hID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UudmFsaWRhdGVPYmplY3QoXG4gICAgdGhpcy5jbGFzc05hbWUsXG4gICAgdGhpcy5kYXRhLFxuICAgIHRoaXMucXVlcnksXG4gICAgdGhpcy5ydW5PcHRpb25zLFxuICAgIHRoaXMuYXV0aC5pc01haW50ZW5hbmNlXG4gICk7XG59O1xuXG4vLyBSdW5zIGFueSBiZWZvcmVTYXZlIHRyaWdnZXJzIGFnYWluc3QgdGhpcyBvcGVyYXRpb24uXG4vLyBBbnkgY2hhbmdlIGxlYWRzIHRvIG91ciBkYXRhIGJlaW5nIG11dGF0ZWQuXG5SZXN0V3JpdGUucHJvdG90eXBlLnJ1bkJlZm9yZVNhdmVUcmlnZ2VyID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5yZXNwb25zZSB8fCB0aGlzLnJ1bk9wdGlvbnMubWFueSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEF2b2lkIGRvaW5nIGFueSBzZXR1cCBmb3IgdHJpZ2dlcnMgaWYgdGhlcmUgaXMgbm8gJ2JlZm9yZVNhdmUnIHRyaWdnZXIgZm9yIHRoaXMgY2xhc3MuXG4gIGlmIChcbiAgICAhdHJpZ2dlcnMudHJpZ2dlckV4aXN0cyh0aGlzLmNsYXNzTmFtZSwgdHJpZ2dlcnMuVHlwZXMuYmVmb3JlU2F2ZSwgdGhpcy5jb25maWcuYXBwbGljYXRpb25JZClcbiAgKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgY29uc3QgeyBvcmlnaW5hbE9iamVjdCwgdXBkYXRlZE9iamVjdCB9ID0gdGhpcy5idWlsZFBhcnNlT2JqZWN0cygpO1xuICBjb25zdCBpZGVudGlmaWVyID0gdXBkYXRlZE9iamVjdC5fZ2V0U3RhdGVJZGVudGlmaWVyKCk7XG4gIGNvbnN0IHN0YXRlQ29udHJvbGxlciA9IFBhcnNlLkNvcmVNYW5hZ2VyLmdldE9iamVjdFN0YXRlQ29udHJvbGxlcigpO1xuICBjb25zdCBbcGVuZGluZ10gPSBzdGF0ZUNvbnRyb2xsZXIuZ2V0UGVuZGluZ09wcyhpZGVudGlmaWVyKTtcbiAgdGhpcy5wZW5kaW5nT3BzID0ge1xuICAgIG9wZXJhdGlvbnM6IHsgLi4ucGVuZGluZyB9LFxuICAgIGlkZW50aWZpZXIsXG4gIH07XG5cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gQmVmb3JlIGNhbGxpbmcgdGhlIHRyaWdnZXIsIHZhbGlkYXRlIHRoZSBwZXJtaXNzaW9ucyBmb3IgdGhlIHNhdmUgb3BlcmF0aW9uXG4gICAgICBsZXQgZGF0YWJhc2VQcm9taXNlID0gbnVsbDtcbiAgICAgIGlmICh0aGlzLnF1ZXJ5KSB7XG4gICAgICAgIC8vIFZhbGlkYXRlIGZvciB1cGRhdGluZ1xuICAgICAgICBkYXRhYmFzZVByb21pc2UgPSB0aGlzLmNvbmZpZy5kYXRhYmFzZS51cGRhdGUoXG4gICAgICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICAgICAgdGhpcy5xdWVyeSxcbiAgICAgICAgICB0aGlzLmRhdGEsXG4gICAgICAgICAgdGhpcy5ydW5PcHRpb25zLFxuICAgICAgICAgIHRydWUsXG4gICAgICAgICAgdHJ1ZVxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVmFsaWRhdGUgZm9yIGNyZWF0aW5nXG4gICAgICAgIGRhdGFiYXNlUHJvbWlzZSA9IHRoaXMuY29uZmlnLmRhdGFiYXNlLmNyZWF0ZShcbiAgICAgICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgICAgICB0aGlzLmRhdGEsXG4gICAgICAgICAgdGhpcy5ydW5PcHRpb25zLFxuICAgICAgICAgIHRydWVcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIEluIHRoZSBjYXNlIHRoYXQgdGhlcmUgaXMgbm8gcGVybWlzc2lvbiBmb3IgdGhlIG9wZXJhdGlvbiwgaXQgdGhyb3dzIGFuIGVycm9yXG4gICAgICByZXR1cm4gZGF0YWJhc2VQcm9taXNlLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgaWYgKCFyZXN1bHQgfHwgcmVzdWx0Lmxlbmd0aCA8PSAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdPYmplY3Qgbm90IGZvdW5kLicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0cmlnZ2Vycy5tYXliZVJ1blRyaWdnZXIoXG4gICAgICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZVNhdmUsXG4gICAgICAgIHRoaXMuYXV0aCxcbiAgICAgICAgdXBkYXRlZE9iamVjdCxcbiAgICAgICAgb3JpZ2luYWxPYmplY3QsXG4gICAgICAgIHRoaXMuY29uZmlnLFxuICAgICAgICB0aGlzLmNvbnRleHRcbiAgICAgICk7XG4gICAgfSlcbiAgICAudGhlbihyZXNwb25zZSA9PiB7XG4gICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2Uub2JqZWN0KSB7XG4gICAgICAgIHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyID0gXy5yZWR1Y2UoXG4gICAgICAgICAgcmVzcG9uc2Uub2JqZWN0LFxuICAgICAgICAgIChyZXN1bHQsIHZhbHVlLCBrZXkpID0+IHtcbiAgICAgICAgICAgIGlmICghXy5pc0VxdWFsKHRoaXMuZGF0YVtrZXldLCB2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgcmVzdWx0LnB1c2goa2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBbXVxuICAgICAgICApO1xuICAgICAgICB0aGlzLmRhdGEgPSByZXNwb25zZS5vYmplY3Q7XG4gICAgICAgIC8vIFdlIHNob3VsZCBkZWxldGUgdGhlIG9iamVjdElkIGZvciBhbiB1cGRhdGUgd3JpdGVcbiAgICAgICAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgICAgICAgIGRlbGV0ZSB0aGlzLmRhdGEub2JqZWN0SWQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIFV0aWxzLmNoZWNrUHJvaGliaXRlZEtleXdvcmRzKHRoaXMuY29uZmlnLCB0aGlzLmRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsIGAke2Vycm9yfWApO1xuICAgICAgfVxuICAgIH0pO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5ydW5CZWZvcmVMb2dpblRyaWdnZXIgPSBhc3luYyBmdW5jdGlvbiAodXNlckRhdGEpIHtcbiAgLy8gQXZvaWQgZG9pbmcgYW55IHNldHVwIGZvciB0cmlnZ2VycyBpZiB0aGVyZSBpcyBubyAnYmVmb3JlTG9naW4nIHRyaWdnZXJcbiAgaWYgKFxuICAgICF0cmlnZ2Vycy50cmlnZ2VyRXhpc3RzKHRoaXMuY2xhc3NOYW1lLCB0cmlnZ2Vycy5UeXBlcy5iZWZvcmVMb2dpbiwgdGhpcy5jb25maWcuYXBwbGljYXRpb25JZClcbiAgKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQ2xvdWQgY29kZSBnZXRzIGEgYml0IG9mIGV4dHJhIGRhdGEgZm9yIGl0cyBvYmplY3RzXG4gIGNvbnN0IGV4dHJhRGF0YSA9IHsgY2xhc3NOYW1lOiB0aGlzLmNsYXNzTmFtZSB9O1xuXG4gIC8vIEV4cGFuZCBmaWxlIG9iamVjdHNcbiAgYXdhaXQgdGhpcy5jb25maWcuZmlsZXNDb250cm9sbGVyLmV4cGFuZEZpbGVzSW5PYmplY3QodGhpcy5jb25maWcsIHVzZXJEYXRhKTtcblxuICBjb25zdCB1c2VyID0gdHJpZ2dlcnMuaW5mbGF0ZShleHRyYURhdGEsIHVzZXJEYXRhKTtcblxuICAvLyBubyBuZWVkIHRvIHJldHVybiBhIHJlc3BvbnNlXG4gIGF3YWl0IHRyaWdnZXJzLm1heWJlUnVuVHJpZ2dlcihcbiAgICB0cmlnZ2Vycy5UeXBlcy5iZWZvcmVMb2dpbixcbiAgICB0aGlzLmF1dGgsXG4gICAgdXNlcixcbiAgICBudWxsLFxuICAgIHRoaXMuY29uZmlnLFxuICAgIHRoaXMuY29udGV4dFxuICApO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5zZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5kYXRhKSB7XG4gICAgcmV0dXJuIHRoaXMudmFsaWRTY2hlbWFDb250cm9sbGVyLmdldEFsbENsYXNzZXMoKS50aGVuKGFsbENsYXNzZXMgPT4ge1xuICAgICAgY29uc3Qgc2NoZW1hID0gYWxsQ2xhc3Nlcy5maW5kKG9uZUNsYXNzID0+IG9uZUNsYXNzLmNsYXNzTmFtZSA9PT0gdGhpcy5jbGFzc05hbWUpO1xuICAgICAgY29uc3Qgc2V0UmVxdWlyZWRGaWVsZElmTmVlZGVkID0gKGZpZWxkTmFtZSwgc2V0RGVmYXVsdCkgPT4ge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdGhpcy5kYXRhW2ZpZWxkTmFtZV0gPT09IHVuZGVmaW5lZCB8fFxuICAgICAgICAgIHRoaXMuZGF0YVtmaWVsZE5hbWVdID09PSBudWxsIHx8XG4gICAgICAgICAgdGhpcy5kYXRhW2ZpZWxkTmFtZV0gPT09ICcnIHx8XG4gICAgICAgICAgKHR5cGVvZiB0aGlzLmRhdGFbZmllbGROYW1lXSA9PT0gJ29iamVjdCcgJiYgdGhpcy5kYXRhW2ZpZWxkTmFtZV0uX19vcCA9PT0gJ0RlbGV0ZScpXG4gICAgICAgICkge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIHNldERlZmF1bHQgJiZcbiAgICAgICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJlxuICAgICAgICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLmRlZmF1bHRWYWx1ZSAhPT0gbnVsbCAmJlxuICAgICAgICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLmRlZmF1bHRWYWx1ZSAhPT0gdW5kZWZpbmVkICYmXG4gICAgICAgICAgICAodGhpcy5kYXRhW2ZpZWxkTmFtZV0gPT09IHVuZGVmaW5lZCB8fFxuICAgICAgICAgICAgICAodHlwZW9mIHRoaXMuZGF0YVtmaWVsZE5hbWVdID09PSAnb2JqZWN0JyAmJiB0aGlzLmRhdGFbZmllbGROYW1lXS5fX29wID09PSAnRGVsZXRlJykpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICB0aGlzLmRhdGFbZmllbGROYW1lXSA9IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS5kZWZhdWx0VmFsdWU7XG4gICAgICAgICAgICB0aGlzLnN0b3JhZ2UuZmllbGRzQ2hhbmdlZEJ5VHJpZ2dlciA9IHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyIHx8IFtdO1xuICAgICAgICAgICAgaWYgKHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyLmluZGV4T2YoZmllbGROYW1lKSA8IDApIHtcbiAgICAgICAgICAgICAgdGhpcy5zdG9yYWdlLmZpZWxkc0NoYW5nZWRCeVRyaWdnZXIucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS5yZXF1aXJlZCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsIGAke2ZpZWxkTmFtZX0gaXMgcmVxdWlyZWRgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIC8vIGFkZCBkZWZhdWx0IEFDTCAob25seSBvbiBDUkVBVEUsIG5vdCBVUERBVEUpXG4gICAgICBpZiAoIXRoaXMucXVlcnkgJiZcbiAgICAgICAgc2NoZW1hPy5jbGFzc0xldmVsUGVybWlzc2lvbnM/LkFDTCAmJlxuICAgICAgICAhdGhpcy5kYXRhLkFDTCAmJlxuICAgICAgICBKU09OLnN0cmluZ2lmeShzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zLkFDTCkgIT09XG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoeyAnKic6IHsgcmVhZDogdHJ1ZSwgd3JpdGU6IHRydWUgfSB9KVxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IGFjbCA9IHN0cnVjdHVyZWRDbG9uZShzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zLkFDTCk7XG4gICAgICAgIGlmIChhY2wuY3VycmVudFVzZXIpIHtcbiAgICAgICAgICBpZiAodGhpcy5hdXRoLnVzZXI/LmlkKSB7XG4gICAgICAgICAgICBhY2xbdGhpcy5hdXRoLnVzZXI/LmlkXSA9IHN0cnVjdHVyZWRDbG9uZShhY2wuY3VycmVudFVzZXIpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkZWxldGUgYWNsLmN1cnJlbnRVc2VyO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZGF0YS5BQ0wgPSBhY2w7XG4gICAgICAgIHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyID0gdGhpcy5zdG9yYWdlLmZpZWxkc0NoYW5nZWRCeVRyaWdnZXIgfHwgW107XG4gICAgICAgIHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyLnB1c2goJ0FDTCcpO1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgZGVmYXVsdCBmaWVsZHNcbiAgICAgIGlmICghdGhpcy5xdWVyeSkge1xuICAgICAgICAvLyBhbGxvdyBjdXN0b21pemluZyBjcmVhdGVkQXQgYW5kIHVwZGF0ZWRBdCB3aGVuIHVzaW5nIG1haW50ZW5hbmNlIGtleVxuICAgICAgICBpZiAoXG4gICAgICAgICAgdGhpcy5hdXRoLmlzTWFpbnRlbmFuY2UgJiZcbiAgICAgICAgICB0aGlzLmRhdGEuY3JlYXRlZEF0ICYmXG4gICAgICAgICAgdGhpcy5kYXRhLmNyZWF0ZWRBdC5fX3R5cGUgPT09ICdEYXRlJ1xuICAgICAgICApIHtcbiAgICAgICAgICB0aGlzLmRhdGEuY3JlYXRlZEF0ID0gdGhpcy5kYXRhLmNyZWF0ZWRBdC5pc287XG5cbiAgICAgICAgICBpZiAodGhpcy5kYXRhLnVwZGF0ZWRBdCAmJiB0aGlzLmRhdGEudXBkYXRlZEF0Ll9fdHlwZSA9PT0gJ0RhdGUnKSB7XG4gICAgICAgICAgICBjb25zdCBjcmVhdGVkQXQgPSBuZXcgRGF0ZSh0aGlzLmRhdGEuY3JlYXRlZEF0KTtcbiAgICAgICAgICAgIGNvbnN0IHVwZGF0ZWRBdCA9IG5ldyBEYXRlKHRoaXMuZGF0YS51cGRhdGVkQXQuaXNvKTtcblxuICAgICAgICAgICAgaWYgKHVwZGF0ZWRBdCA8IGNyZWF0ZWRBdCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuVkFMSURBVElPTl9FUlJPUixcbiAgICAgICAgICAgICAgICAndXBkYXRlZEF0IGNhbm5vdCBvY2N1ciBiZWZvcmUgY3JlYXRlZEF0J1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmRhdGEudXBkYXRlZEF0ID0gdGhpcy5kYXRhLnVwZGF0ZWRBdC5pc287XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIGlmIG5vIHVwZGF0ZWRBdCBpcyBwcm92aWRlZCwgc2V0IGl0IHRvIGNyZWF0ZWRBdCB0byBtYXRjaCBkZWZhdWx0IGJlaGF2aW9yXG4gICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmRhdGEudXBkYXRlZEF0ID0gdGhpcy5kYXRhLmNyZWF0ZWRBdDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5kYXRhLnVwZGF0ZWRBdCA9IHRoaXMudXBkYXRlZEF0O1xuICAgICAgICAgIHRoaXMuZGF0YS5jcmVhdGVkQXQgPSB0aGlzLnVwZGF0ZWRBdDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE9ubHkgYXNzaWduIG5ldyBvYmplY3RJZCBpZiB3ZSBhcmUgY3JlYXRpbmcgbmV3IG9iamVjdFxuICAgICAgICBpZiAoIXRoaXMuZGF0YS5vYmplY3RJZCkge1xuICAgICAgICAgIHRoaXMuZGF0YS5vYmplY3RJZCA9IGNyeXB0b1V0aWxzLm5ld09iamVjdElkKHRoaXMuY29uZmlnLm9iamVjdElkU2l6ZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNjaGVtYSkge1xuICAgICAgICAgIE9iamVjdC5rZXlzKHNjaGVtYS5maWVsZHMpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICAgIHNldFJlcXVpcmVkRmllbGRJZk5lZWRlZChmaWVsZE5hbWUsIHRydWUpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHNjaGVtYSkge1xuICAgICAgICB0aGlzLmRhdGEudXBkYXRlZEF0ID0gdGhpcy51cGRhdGVkQXQ7XG5cbiAgICAgICAgT2JqZWN0LmtleXModGhpcy5kYXRhKS5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgc2V0UmVxdWlyZWRGaWVsZElmTmVlZGVkKGZpZWxkTmFtZSwgZmFsc2UpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG59O1xuXG4vLyBUcmFuc2Zvcm1zIGF1dGggZGF0YSBmb3IgYSB1c2VyIG9iamVjdC5cbi8vIERvZXMgbm90aGluZyBpZiB0aGlzIGlzbid0IGEgdXNlciBvYmplY3QuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3Igd2hlbiB3ZSdyZSBkb25lIGlmIGl0IGNhbid0IGZpbmlzaCB0aGlzIHRpY2suXG5SZXN0V3JpdGUucHJvdG90eXBlLnZhbGlkYXRlQXV0aERhdGEgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPT0gJ19Vc2VyJykge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGF1dGhEYXRhID0gdGhpcy5kYXRhLmF1dGhEYXRhO1xuICBjb25zdCBoYXNVc2VybmFtZUFuZFBhc3N3b3JkID1cbiAgICB0eXBlb2YgdGhpcy5kYXRhLnVzZXJuYW1lID09PSAnc3RyaW5nJyAmJiB0eXBlb2YgdGhpcy5kYXRhLnBhc3N3b3JkID09PSAnc3RyaW5nJztcbiAgY29uc3QgaGFzQXV0aERhdGEgPVxuICAgIGF1dGhEYXRhICYmXG4gICAgT2JqZWN0LmtleXMoYXV0aERhdGEpLnNvbWUocHJvdmlkZXIgPT4ge1xuICAgICAgY29uc3QgcHJvdmlkZXJEYXRhID0gYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgcmV0dXJuIHByb3ZpZGVyRGF0YSAmJiB0eXBlb2YgcHJvdmlkZXJEYXRhID09PSAnb2JqZWN0JyAmJiBPYmplY3Qua2V5cyhwcm92aWRlckRhdGEpLmxlbmd0aDtcbiAgICB9KTtcblxuICBpZiAoIXRoaXMucXVlcnkgJiYgIWhhc0F1dGhEYXRhKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLmRhdGEudXNlcm5hbWUgIT09ICdzdHJpbmcnIHx8IF8uaXNFbXB0eSh0aGlzLmRhdGEudXNlcm5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVVNFUk5BTUVfTUlTU0lORywgJ2JhZCBvciBtaXNzaW5nIHVzZXJuYW1lJyk7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgdGhpcy5kYXRhLnBhc3N3b3JkICE9PSAnc3RyaW5nJyB8fCBfLmlzRW1wdHkodGhpcy5kYXRhLnBhc3N3b3JkKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBBU1NXT1JEX01JU1NJTkcsICdwYXNzd29yZCBpcyByZXF1aXJlZCcpO1xuICAgIH1cbiAgfVxuXG4gIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMuZGF0YSwgJ2F1dGhEYXRhJykpIHtcbiAgICAvLyBOb3RoaW5nIHRvIHZhbGlkYXRlIGhlcmVcbiAgICByZXR1cm47XG4gIH0gZWxzZSBpZiAoIXRoaXMuZGF0YS5hdXRoRGF0YSkge1xuICAgIC8vIEhhbmRsZSBzYXZpbmcgYXV0aERhdGEgdG8gbnVsbFxuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLlVOU1VQUE9SVEVEX1NFUlZJQ0UsXG4gICAgICAnVGhpcyBhdXRoZW50aWNhdGlvbiBtZXRob2QgaXMgdW5zdXBwb3J0ZWQuJ1xuICAgICk7XG4gIH1cblxuICB2YXIgcHJvdmlkZXJzID0gT2JqZWN0LmtleXMoYXV0aERhdGEpO1xuICBpZiAoIXByb3ZpZGVycy5sZW5ndGgpIHtcbiAgICAvLyBFbXB0eSBhdXRoRGF0YSBvYmplY3QsIG5vdGhpbmcgdG8gdmFsaWRhdGVcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgY2FuSGFuZGxlQXV0aERhdGEgPSBwcm92aWRlcnMuc29tZShwcm92aWRlciA9PiB7XG4gICAgY29uc3QgcHJvdmlkZXJBdXRoRGF0YSA9IGF1dGhEYXRhW3Byb3ZpZGVyXSB8fCB7fTtcbiAgICByZXR1cm4gISFPYmplY3Qua2V5cyhwcm92aWRlckF1dGhEYXRhKS5sZW5ndGg7XG4gIH0pO1xuICBpZiAoY2FuSGFuZGxlQXV0aERhdGEgfHwgaGFzVXNlcm5hbWVBbmRQYXNzd29yZCB8fCB0aGlzLmF1dGguaXNNYXN0ZXIgfHwgdGhpcy5nZXRVc2VySWQoKSkge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZUF1dGhEYXRhKGF1dGhEYXRhKTtcbiAgfVxuICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgUGFyc2UuRXJyb3IuVU5TVVBQT1JURURfU0VSVklDRSxcbiAgICAnVGhpcyBhdXRoZW50aWNhdGlvbiBtZXRob2QgaXMgdW5zdXBwb3J0ZWQuJ1xuICApO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5maWx0ZXJlZE9iamVjdHNCeUFDTCA9IGZ1bmN0aW9uIChvYmplY3RzKSB7XG4gIGlmICh0aGlzLmF1dGguaXNNYXN0ZXIgfHwgdGhpcy5hdXRoLmlzTWFpbnRlbmFuY2UpIHtcbiAgICByZXR1cm4gb2JqZWN0cztcbiAgfVxuICByZXR1cm4gb2JqZWN0cy5maWx0ZXIob2JqZWN0ID0+IHtcbiAgICBpZiAoIW9iamVjdC5BQ0wpIHtcbiAgICAgIHJldHVybiB0cnVlOyAvLyBsZWdhY3kgdXNlcnMgdGhhdCBoYXZlIG5vIEFDTCBmaWVsZCBvbiB0aGVtXG4gICAgfVxuICAgIC8vIFJlZ3VsYXIgdXNlcnMgdGhhdCBoYXZlIGJlZW4gbG9ja2VkIG91dC5cbiAgICByZXR1cm4gb2JqZWN0LkFDTCAmJiBPYmplY3Qua2V5cyhvYmplY3QuQUNMKS5sZW5ndGggPiAwO1xuICB9KTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuZ2V0VXNlcklkID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkICYmIHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkub2JqZWN0SWQ7XG4gIH0gZWxzZSBpZiAodGhpcy5hdXRoICYmIHRoaXMuYXV0aC51c2VyICYmIHRoaXMuYXV0aC51c2VyLmlkKSB7XG4gICAgcmV0dXJuIHRoaXMuYXV0aC51c2VyLmlkO1xuICB9XG59O1xuXG4vLyBEZXZlbG9wZXJzIGFyZSBhbGxvd2VkIHRvIGNoYW5nZSBhdXRoRGF0YSB2aWEgYmVmb3JlIHNhdmUgdHJpZ2dlclxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdGhyb3dJZkF1dGhEYXRhRHVwbGljYXRlID0gZnVuY3Rpb24gKGVycm9yKSB7XG4gIGlmIChcbiAgICB0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJlxuICAgIGVycm9yPy5jb2RlID09PSBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUgJiZcbiAgICBlcnJvci51c2VySW5mbz8uZHVwbGljYXRlZF9maWVsZD8uc3RhcnRzV2l0aCgnX2F1dGhfZGF0YV8nKVxuICApIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuQUNDT1VOVF9BTFJFQURZX0xJTktFRCwgJ3RoaXMgYXV0aCBpcyBhbHJlYWR5IHVzZWQnKTtcbiAgfVxufTtcblxuLy8gd2UgbmVlZCBhZnRlciBiZWZvcmUgc2F2ZSB0byBlbnN1cmUgdGhhdCB0aGUgZGV2ZWxvcGVyXG4vLyBpcyBub3QgY3VycmVudGx5IGR1cGxpY2F0aW5nIGF1dGggZGF0YSBJRFxuUmVzdFdyaXRlLnByb3RvdHlwZS5lbnN1cmVVbmlxdWVBdXRoRGF0YUlkID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicgfHwgIXRoaXMuZGF0YS5hdXRoRGF0YSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGhhc0F1dGhEYXRhSWQgPSBPYmplY3Qua2V5cyh0aGlzLmRhdGEuYXV0aERhdGEpLnNvbWUoXG4gICAga2V5ID0+IHRoaXMuZGF0YS5hdXRoRGF0YVtrZXldICYmIHRoaXMuZGF0YS5hdXRoRGF0YVtrZXldLmlkXG4gICk7XG5cbiAgaWYgKCFoYXNBdXRoRGF0YUlkKSB7IHJldHVybjsgfVxuXG4gIGNvbnN0IHIgPSBhd2FpdCBBdXRoLmZpbmRVc2Vyc1dpdGhBdXRoRGF0YSh0aGlzLmNvbmZpZywgdGhpcy5kYXRhLmF1dGhEYXRhKTtcbiAgY29uc3QgcmVzdWx0cyA9IHRoaXMuZmlsdGVyZWRPYmplY3RzQnlBQ0wocik7XG4gIGlmIChyZXN1bHRzLmxlbmd0aCA+IDEpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuQUNDT1VOVF9BTFJFQURZX0xJTktFRCwgJ3RoaXMgYXV0aCBpcyBhbHJlYWR5IHVzZWQnKTtcbiAgfVxuICAvLyB1c2UgZGF0YS5vYmplY3RJZCBpbiBjYXNlIG9mIGxvZ2luIHRpbWUgYW5kIGZvdW5kIHVzZXIgZHVyaW5nIGhhbmRsZSB2YWxpZGF0ZUF1dGhEYXRhXG4gIGNvbnN0IHVzZXJJZCA9IHRoaXMuZ2V0VXNlcklkKCkgfHwgdGhpcy5kYXRhLm9iamVjdElkO1xuICBpZiAocmVzdWx0cy5sZW5ndGggPT09IDEgJiYgdXNlcklkICE9PSByZXN1bHRzWzBdLm9iamVjdElkKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkFDQ09VTlRfQUxSRUFEWV9MSU5LRUQsICd0aGlzIGF1dGggaXMgYWxyZWFkeSB1c2VkJyk7XG4gIH1cbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuaGFuZGxlQXV0aERhdGEgPSBhc3luYyBmdW5jdGlvbiAoYXV0aERhdGEpIHtcbiAgbGV0IGN1cnJlbnRVc2VyQXV0aERhdGE7XG4gIGlmICh0aGlzLnF1ZXJ5Py5vYmplY3RJZCkge1xuICAgIGNvbnN0IFtjdXJyZW50VXNlcl0gPSBhd2FpdCB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKFxuICAgICAgJ19Vc2VyJyxcbiAgICAgIHsgb2JqZWN0SWQ6IHRoaXMucXVlcnkub2JqZWN0SWQgfVxuICAgICk7XG4gICAgY3VycmVudFVzZXJBdXRoRGF0YSA9IGN1cnJlbnRVc2VyPy5hdXRoRGF0YTtcbiAgfVxuICBjb25zdCByID0gYXdhaXQgQXV0aC5maW5kVXNlcnNXaXRoQXV0aERhdGEodGhpcy5jb25maWcsIGF1dGhEYXRhLCB0cnVlLCBjdXJyZW50VXNlckF1dGhEYXRhKTtcbiAgY29uc3QgcmVzdWx0cyA9IHRoaXMuZmlsdGVyZWRPYmplY3RzQnlBQ0wocik7XG5cbiAgY29uc3QgdXNlcklkID0gdGhpcy5nZXRVc2VySWQoKTtcbiAgY29uc3QgdXNlclJlc3VsdCA9IHJlc3VsdHNbMF07XG4gIGNvbnN0IGZvdW5kVXNlcklzTm90Q3VycmVudFVzZXIgPSB1c2VySWQgJiYgdXNlclJlc3VsdCAmJiB1c2VySWQgIT09IHVzZXJSZXN1bHQub2JqZWN0SWQ7XG5cbiAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMSB8fCBmb3VuZFVzZXJJc05vdEN1cnJlbnRVc2VyKSB7XG4gICAgLy8gVG8gYXZvaWQgaHR0cHM6Ly9naXRodWIuY29tL3BhcnNlLWNvbW11bml0eS9wYXJzZS1zZXJ2ZXIvc2VjdXJpdHkvYWR2aXNvcmllcy9HSFNBLTh3M2otZzk4My04amg1XG4gICAgLy8gTGV0J3MgcnVuIHNvbWUgdmFsaWRhdGlvbiBiZWZvcmUgdGhyb3dpbmdcbiAgICBhd2FpdCBBdXRoLmhhbmRsZUF1dGhEYXRhVmFsaWRhdGlvbihhdXRoRGF0YSwgdGhpcywgdXNlclJlc3VsdCk7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkFDQ09VTlRfQUxSRUFEWV9MSU5LRUQsICd0aGlzIGF1dGggaXMgYWxyZWFkeSB1c2VkJyk7XG4gIH1cblxuICAvLyBObyB1c2VyIGZvdW5kIHdpdGggcHJvdmlkZWQgYXV0aERhdGEgd2UgbmVlZCB0byB2YWxpZGF0ZVxuICBpZiAoIXJlc3VsdHMubGVuZ3RoKSB7XG4gICAgY29uc3QgeyBhdXRoRGF0YTogdmFsaWRhdGVkQXV0aERhdGEsIGF1dGhEYXRhUmVzcG9uc2UgfSA9IGF3YWl0IEF1dGguaGFuZGxlQXV0aERhdGFWYWxpZGF0aW9uKFxuICAgICAgYXV0aERhdGEsXG4gICAgICB0aGlzXG4gICAgKTtcbiAgICB0aGlzLmF1dGhEYXRhUmVzcG9uc2UgPSBhdXRoRGF0YVJlc3BvbnNlO1xuICAgIC8vIFJlcGxhY2UgY3VycmVudCBhdXRoRGF0YSBieSB0aGUgbmV3IHZhbGlkYXRlZCBvbmVcbiAgICB0aGlzLmRhdGEuYXV0aERhdGEgPSB2YWxpZGF0ZWRBdXRoRGF0YTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBVc2VyIGZvdW5kIHdpdGggcHJvdmlkZWQgYXV0aERhdGFcbiAgaWYgKHJlc3VsdHMubGVuZ3RoID09PSAxKSB7XG4gICAgdGhpcy5zdG9yYWdlLmF1dGhQcm92aWRlciA9IE9iamVjdC5rZXlzKGF1dGhEYXRhKS5qb2luKCcsJyk7XG5cbiAgICBjb25zdCB7IGhhc011dGF0ZWRBdXRoRGF0YSwgbXV0YXRlZEF1dGhEYXRhIH0gPSBBdXRoLmhhc011dGF0ZWRBdXRoRGF0YShcbiAgICAgIGF1dGhEYXRhLFxuICAgICAgdXNlclJlc3VsdC5hdXRoRGF0YVxuICAgICk7XG5cbiAgICBjb25zdCBpc0N1cnJlbnRVc2VyTG9nZ2VkT3JNYXN0ZXIgPVxuICAgICAgKHRoaXMuYXV0aCAmJiB0aGlzLmF1dGgudXNlciAmJiB0aGlzLmF1dGgudXNlci5pZCA9PT0gdXNlclJlc3VsdC5vYmplY3RJZCkgfHxcbiAgICAgIHRoaXMuYXV0aC5pc01hc3RlcjtcblxuICAgIGNvbnN0IGlzTG9naW4gPSAhdXNlcklkO1xuXG4gICAgaWYgKGlzTG9naW4gfHwgaXNDdXJyZW50VXNlckxvZ2dlZE9yTWFzdGVyKSB7XG4gICAgICAvLyBubyB1c2VyIG1ha2luZyB0aGUgY2FsbFxuICAgICAgLy8gT1IgdGhlIHVzZXIgbWFraW5nIHRoZSBjYWxsIGlzIHRoZSByaWdodCBvbmVcbiAgICAgIC8vIExvZ2luIHdpdGggYXV0aCBkYXRhXG4gICAgICBkZWxldGUgcmVzdWx0c1swXS5wYXNzd29yZDtcblxuICAgICAgLy8gbmVlZCB0byBzZXQgdGhlIG9iamVjdElkIGZpcnN0IG90aGVyd2lzZSBsb2NhdGlvbiBoYXMgdHJhaWxpbmcgdW5kZWZpbmVkXG4gICAgICB0aGlzLmRhdGEub2JqZWN0SWQgPSB1c2VyUmVzdWx0Lm9iamVjdElkO1xuXG4gICAgICBpZiAoIXRoaXMucXVlcnkgfHwgIXRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAgICAgdGhpcy5yZXNwb25zZSA9IHtcbiAgICAgICAgICByZXNwb25zZTogdXNlclJlc3VsdCxcbiAgICAgICAgICBsb2NhdGlvbjogdGhpcy5sb2NhdGlvbigpLFxuICAgICAgICB9O1xuICAgICAgICAvLyBSdW4gYmVmb3JlTG9naW4gaG9vayBiZWZvcmUgc3RvcmluZyBhbnkgdXBkYXRlc1xuICAgICAgICAvLyB0byBhdXRoRGF0YSBvbiB0aGUgZGI7IGNoYW5nZXMgdG8gdXNlclJlc3VsdFxuICAgICAgICAvLyB3aWxsIGJlIGlnbm9yZWQuXG4gICAgICAgIGF3YWl0IHRoaXMucnVuQmVmb3JlTG9naW5UcmlnZ2VyKHN0cnVjdHVyZWRDbG9uZSh1c2VyUmVzdWx0KSk7XG5cbiAgICAgICAgLy8gSWYgd2UgYXJlIGluIGxvZ2luIG9wZXJhdGlvbiB2aWEgYXV0aERhdGFcbiAgICAgICAgLy8gd2UgbmVlZCB0byBiZSBzdXJlIHRoYXQgdGhlIHVzZXIgaGFzIHByb3ZpZGVkXG4gICAgICAgIC8vIHJlcXVpcmVkIGF1dGhEYXRhXG4gICAgICAgIEF1dGguY2hlY2tJZlVzZXJIYXNQcm92aWRlZENvbmZpZ3VyZWRQcm92aWRlcnNGb3JMb2dpbihcbiAgICAgICAgICB7IGNvbmZpZzogdGhpcy5jb25maWcsIGF1dGg6IHRoaXMuYXV0aCB9LFxuICAgICAgICAgIGF1dGhEYXRhLFxuICAgICAgICAgIHVzZXJSZXN1bHQuYXV0aERhdGEsXG4gICAgICAgICAgdGhpcy5jb25maWdcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgLy8gUHJldmVudCB2YWxpZGF0aW5nIGlmIG5vIG11dGF0ZWQgZGF0YSBkZXRlY3RlZCBvbiB1cGRhdGVcbiAgICAgIGlmICghaGFzTXV0YXRlZEF1dGhEYXRhICYmIGlzQ3VycmVudFVzZXJMb2dnZWRPck1hc3Rlcikge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIEFsd2F5cyB2YWxpZGF0ZSBhbGwgcHJvdmlkZWQgYXV0aERhdGEgb24gbG9naW4gdG8gcHJldmVudCBhdXRoZW50aWNhdGlvblxuICAgICAgLy8gYnlwYXNzIHZpYSBwYXJ0aWFsIGF1dGhEYXRhIChlLmcuIHNlbmRpbmcgb25seSB0aGUgcHJvdmlkZXIgSUQgd2l0aG91dFxuICAgICAgLy8gYW4gYWNjZXNzIHRva2VuKTsgb24gdXBkYXRlIG9ubHkgdmFsaWRhdGUgbXV0YXRlZCBvbmVzXG4gICAgICBpZiAoaXNMb2dpbiB8fCBoYXNNdXRhdGVkQXV0aERhdGEgfHwgIXRoaXMuY29uZmlnLmFsbG93RXhwaXJlZEF1dGhEYXRhVG9rZW4pIHtcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgQXV0aC5oYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24oXG4gICAgICAgICAgaXNMb2dpbiA/IGF1dGhEYXRhIDogbXV0YXRlZEF1dGhEYXRhLFxuICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgdXNlclJlc3VsdFxuICAgICAgICApO1xuICAgICAgICB0aGlzLmRhdGEuYXV0aERhdGEgPSByZXMuYXV0aERhdGE7XG4gICAgICAgIHRoaXMuYXV0aERhdGFSZXNwb25zZSA9IHJlcy5hdXRoRGF0YVJlc3BvbnNlO1xuICAgICAgfVxuXG4gICAgICAvLyBDYXB0dXJlIG9yaWdpbmFsIGF1dGhEYXRhIGJlZm9yZSBtdXRhdGluZyB1c2VyUmVzdWx0IHZpYSB0aGUgcmVzcG9uc2UgcmVmZXJlbmNlXG4gICAgICBjb25zdCBvcmlnaW5hbEF1dGhEYXRhID0gdXNlclJlc3VsdD8uYXV0aERhdGFcbiAgICAgICAgPyBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICAgICAgT2JqZWN0LmVudHJpZXModXNlclJlc3VsdC5hdXRoRGF0YSkubWFwKChbaywgdl0pID0+XG4gICAgICAgICAgICBbaywgdiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcgPyB7IC4uLnYgfSA6IHZdXG4gICAgICAgICAgKVxuICAgICAgICApXG4gICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgICAvLyBJRiB3ZSBhcmUgaW4gbG9naW4gd2UnbGwgc2tpcCB0aGUgZGF0YWJhc2Ugb3BlcmF0aW9uIC8gYmVmb3JlU2F2ZSAvIGFmdGVyU2F2ZSBldGMuLi5cbiAgICAgIC8vIHdlIG5lZWQgdG8gc2V0IGl0IHVwIHRoZXJlLlxuICAgICAgLy8gV2UgYXJlIHN1cHBvc2VkIHRvIGhhdmUgYSByZXNwb25zZSBvbmx5IG9uIExPR0lOIHdpdGggYXV0aERhdGEsIHNvIHdlIHNraXAgdGhvc2VcbiAgICAgIC8vIElmIHdlJ3JlIG5vdCBsb2dnaW5nIGluLCBidXQganVzdCB1cGRhdGluZyB0aGUgY3VycmVudCB1c2VyLCB3ZSBjYW4gc2FmZWx5IHNraXAgdGhhdCBwYXJ0XG4gICAgICBpZiAodGhpcy5yZXNwb25zZSkge1xuICAgICAgICAvLyBBc3NpZ24gdGhlIG5ldyBhdXRoRGF0YSBpbiB0aGUgcmVzcG9uc2VcbiAgICAgICAgT2JqZWN0LmtleXMobXV0YXRlZEF1dGhEYXRhKS5mb3JFYWNoKHByb3ZpZGVyID0+IHtcbiAgICAgICAgICB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlLmF1dGhEYXRhW3Byb3ZpZGVyXSA9IG11dGF0ZWRBdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFJ1biB0aGUgREIgdXBkYXRlIGRpcmVjdGx5LCBhcyAnbWFzdGVyJyBvbmx5IGlmIGF1dGhEYXRhIGNvbnRhaW5zIHNvbWUga2V5c1xuICAgICAgICAvLyBhdXRoRGF0YSBjb3VsZCBub3QgY29udGFpbnMga2V5cyBhZnRlciB2YWxpZGF0aW9uIGlmIHRoZSBhdXRoQWRhcHRlclxuICAgICAgICAvLyB1c2VzIHRoZSBgZG9Ob3RTYXZlYCBvcHRpb24uIEp1c3QgdXBkYXRlIHRoZSBhdXRoRGF0YSBwYXJ0XG4gICAgICAgIC8vIFRoZW4gd2UncmUgZ29vZCBmb3IgdGhlIHVzZXIsIGVhcmx5IGV4aXQgb2Ygc29ydHNcbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSkubGVuZ3RoKSB7XG4gICAgICAgICAgY29uc3QgcXVlcnkgPSB7IG9iamVjdElkOiB0aGlzLmRhdGEub2JqZWN0SWQgfTtcbiAgICAgICAgICAvLyBPcHRpbWlzdGljIGxvY2tpbmc6IGluY2x1ZGUgZWFjaCBjaGFuZ2VkIG9yaWdpbmFsIGZpZWxkIGluIHRoZSBXSEVSRSBjbGF1c2VcbiAgICAgICAgICAvLyBmb3IgcHJvdmlkZXJzIHdob3NlIGRhdGEgaXMgYmVpbmcgdXBkYXRlZC4gVGhpcyBwcmV2ZW50cyBjb25jdXJyZW50IHJlcXVlc3RzXG4gICAgICAgICAgLy8gZnJvbSBib3RoIHN1Y2NlZWRpbmcgd2hlbiBjb25zdW1pbmcgc2luZ2xlLXVzZSB0b2tlbnMgKGUuZy4gTUZBIHJlY292ZXJ5IGNvZGVzXG4gICAgICAgICAgLy8gYXMgYXJyYXlzLCBvciBNRkEgU01TIE9UUCB0b2tlbnMgYXMgc3RyaW5ncykuXG4gICAgICAgICAgYXBwbHlBdXRoRGF0YU9wdGltaXN0aWNMb2NrKHF1ZXJ5LCBvcmlnaW5hbEF1dGhEYXRhLCB0aGlzLmRhdGEuYXV0aERhdGEpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNvbmZpZy5kYXRhYmFzZS51cGRhdGUoXG4gICAgICAgICAgICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgICAgeyBhdXRoRGF0YTogdGhpcy5kYXRhLmF1dGhEYXRhIH0sXG4gICAgICAgICAgICAgIHt9XG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuU0NSSVBUX0ZBSUxFRCwgJ0ludmFsaWQgYXV0aCBkYXRhJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLl90aHJvd0lmQXV0aERhdGFEdXBsaWNhdGUoZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5kYXRhLmF1dGhEYXRhICYmIE9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSkubGVuZ3RoKSB7XG4gICAgICAgIC8vIFVQREFURSBwYXRoIChlLmcuIFBVVCAvdXNlcnMvOmlkIGR1cmluZyBsaW5rZWQtcHJvdmlkZXIgcmUtYXV0aCk6IGFwcGx5XG4gICAgICAgIC8vIHRoZSBzYW1lIG9wdGltaXN0aWMgbG9jayB0byB0aGUgc3Vic2VxdWVudCBydW5EYXRhYmFzZU9wZXJhdGlvbiB1cGRhdGUgc29cbiAgICAgICAgLy8gY29uY3VycmVudCBzaW5nbGUtdXNlIHRva2VuIGNvbnN1bWVycyBjYW5ub3QgYm90aCBzdWNjZWVkLlxuICAgICAgICBhcHBseUF1dGhEYXRhT3B0aW1pc3RpY0xvY2sodGhpcy5xdWVyeSwgb3JpZ2luYWxBdXRoRGF0YSwgdGhpcy5kYXRhLmF1dGhEYXRhKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuY2hlY2tSZXN0cmljdGVkRmllbGRzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoIXRoaXMuYXV0aC5pc01haW50ZW5hbmNlICYmICF0aGlzLmF1dGguaXNNYXN0ZXIgJiYgJ2VtYWlsVmVyaWZpZWQnIGluIHRoaXMuZGF0YSkge1xuICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgIFwiQ2xpZW50cyBhcmVuJ3QgYWxsb3dlZCB0byBtYW51YWxseSB1cGRhdGUgZW1haWwgdmVyaWZpY2F0aW9uLlwiLFxuICAgICAgdGhpcy5jb25maWdcbiAgICApO1xuICB9XG59O1xuXG4vLyBWYWxpZGF0ZXMgdGhlIGNyZWF0ZSBjbGFzcy1sZXZlbCBwZXJtaXNzaW9uIGJlZm9yZSB0cmFuc2Zvcm1Vc2VyIHJ1bnMuXG4vLyBUaGlzIHByZXZlbnRzIHVzZXIgZW51bWVyYXRpb24gKHVzZXJuYW1lL2VtYWlsIGV4aXN0ZW5jZSkgd2hlbiBwdWJsaWNcbi8vIGNyZWF0ZSBpcyBkaXNhYmxlZCBvbiBfVXNlciwgYmVjYXVzZSB0cmFuc2Zvcm1Vc2VyIGNoZWNrcyB1bmlxdWVuZXNzXG4vLyBiZWZvcmUgdGhlIENMUCBpcyBlbmZvcmNlZCBpbiBydW5EYXRhYmFzZU9wZXJhdGlvbi5cblJlc3RXcml0ZS5wcm90b3R5cGUudmFsaWRhdGVDcmVhdGVQZXJtaXNzaW9uID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5xdWVyeSB8fCB0aGlzLmF1dGguaXNNYXN0ZXIgfHwgdGhpcy5hdXRoLmlzTWFpbnRlbmFuY2UpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF0aGlzLnZhbGlkU2NoZW1hQ29udHJvbGxlcikge1xuICAgIHJldHVybjtcbiAgfVxuICBhd2FpdCB0aGlzLnZhbGlkU2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oXG4gICAgdGhpcy5jbGFzc05hbWUsXG4gICAgdGhpcy5ydW5PcHRpb25zLmFjbCB8fCBbXSxcbiAgICAnY3JlYXRlJ1xuICApO1xufTtcblxuLy8gVGhlIG5vbi10aGlyZC1wYXJ0eSBwYXJ0cyBvZiBVc2VyIHRyYW5zZm9ybWF0aW9uXG5SZXN0V3JpdGUucHJvdG90eXBlLnRyYW5zZm9ybVVzZXIgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIHZhciBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPT0gJ19Vc2VyJykge1xuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG5cbiAgLy8gRG8gbm90IGNsZWFudXAgc2Vzc2lvbiBpZiBvYmplY3RJZCBpcyBub3Qgc2V0XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMub2JqZWN0SWQoKSkge1xuICAgIC8vIElmIHdlJ3JlIHVwZGF0aW5nIGEgX1VzZXIgb2JqZWN0LCB3ZSBuZWVkIHRvIGNsZWFyIG91dCB0aGUgY2FjaGUgZm9yIHRoYXQgdXNlci4gRmluZCBhbGwgdGhlaXJcbiAgICAvLyBzZXNzaW9uIHRva2VucywgYW5kIHJlbW92ZSB0aGVtIGZyb20gdGhlIGNhY2hlLlxuICAgIGNvbnN0IHF1ZXJ5ID0gYXdhaXQgUmVzdFF1ZXJ5KHtcbiAgICAgIG1ldGhvZDogUmVzdFF1ZXJ5Lk1ldGhvZC5maW5kLFxuICAgICAgY29uZmlnOiB0aGlzLmNvbmZpZyxcbiAgICAgIGF1dGg6IEF1dGgubWFzdGVyKHRoaXMuY29uZmlnKSxcbiAgICAgIGNsYXNzTmFtZTogJ19TZXNzaW9uJyxcbiAgICAgIHJ1bkJlZm9yZUZpbmQ6IGZhbHNlLFxuICAgICAgcmVzdFdoZXJlOiB7XG4gICAgICAgIHVzZXI6IHtcbiAgICAgICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgICBjbGFzc05hbWU6ICdfVXNlcicsXG4gICAgICAgICAgb2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgcHJvbWlzZSA9IHF1ZXJ5LmV4ZWN1dGUoKS50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgcmVzdWx0cy5yZXN1bHRzLmZvckVhY2goc2Vzc2lvbiA9PlxuICAgICAgICB0aGlzLmNvbmZpZy5jYWNoZUNvbnRyb2xsZXIudXNlci5kZWwoc2Vzc2lvbi5zZXNzaW9uVG9rZW4pXG4gICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHByb21pc2VcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICAvLyBUcmFuc2Zvcm0gdGhlIHBhc3N3b3JkXG4gICAgICBpZiAodGhpcy5kYXRhLnBhc3N3b3JkID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy8gaWdub3JlIG9ubHkgaWYgdW5kZWZpbmVkLiBzaG91bGQgcHJvY2VlZCBpZiBlbXB0eSAoJycpXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMucXVlcnkpIHtcbiAgICAgICAgdGhpcy5zdG9yYWdlWydjbGVhclNlc3Npb25zJ10gPSB0cnVlO1xuICAgICAgICAvLyBHZW5lcmF0ZSBhIG5ldyBzZXNzaW9uIG9ubHkgaWYgdGhlIHVzZXIgcmVxdWVzdGVkXG4gICAgICAgIGlmICghdGhpcy5hdXRoLmlzTWFzdGVyICYmICF0aGlzLmF1dGguaXNNYWludGVuYW5jZSkge1xuICAgICAgICAgIHRoaXMuc3RvcmFnZVsnZ2VuZXJhdGVOZXdTZXNzaW9uJ10gPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZVBhc3N3b3JkUG9saWN5KCkudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiBwYXNzd29yZENyeXB0by5oYXNoKHRoaXMuZGF0YS5wYXNzd29yZCkudGhlbihoYXNoZWRQYXNzd29yZCA9PiB7XG4gICAgICAgICAgdGhpcy5kYXRhLl9oYXNoZWRfcGFzc3dvcmQgPSBoYXNoZWRQYXNzd29yZDtcbiAgICAgICAgICBkZWxldGUgdGhpcy5kYXRhLnBhc3N3b3JkO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlVXNlck5hbWUoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZUVtYWlsKCk7XG4gICAgfSk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZVVzZXJOYW1lID0gZnVuY3Rpb24gKCkge1xuICAvLyBDaGVjayBmb3IgdXNlcm5hbWUgdW5pcXVlbmVzc1xuICBpZiAoIXRoaXMuZGF0YS51c2VybmFtZSkge1xuICAgIGlmICghdGhpcy5xdWVyeSkge1xuICAgICAgdGhpcy5kYXRhLnVzZXJuYW1lID0gY3J5cHRvVXRpbHMucmFuZG9tU3RyaW5nKDI1KTtcbiAgICAgIHRoaXMucmVzcG9uc2VTaG91bGRIYXZlVXNlcm5hbWUgPSB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbiAgLypcbiAgICBVc2VybmFtZXMgc2hvdWxkIGJlIHVuaXF1ZSB3aGVuIGNvbXBhcmVkIGNhc2UgaW5zZW5zaXRpdmVseVxuXG4gICAgVXNlcnMgc2hvdWxkIGJlIGFibGUgdG8gbWFrZSBjYXNlIHNlbnNpdGl2ZSB1c2VybmFtZXMgYW5kXG4gICAgbG9naW4gdXNpbmcgdGhlIGNhc2UgdGhleSBlbnRlcmVkLiAgSS5lLiAnU25vb3B5JyBzaG91bGQgcHJlY2x1ZGVcbiAgICAnc25vb3B5JyBhcyBhIHZhbGlkIHVzZXJuYW1lLlxuICAqL1xuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAuZmluZChcbiAgICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgICAge1xuICAgICAgICB1c2VybmFtZTogdGhpcy5kYXRhLnVzZXJuYW1lLFxuICAgICAgICBvYmplY3RJZDogeyAkbmU6IHRoaXMub2JqZWN0SWQoKSB9LFxuICAgICAgfSxcbiAgICAgIHsgbGltaXQ6IDEsIGNhc2VJbnNlbnNpdGl2ZTogdHJ1ZSB9LFxuICAgICAge30sXG4gICAgICB0aGlzLnZhbGlkU2NoZW1hQ29udHJvbGxlclxuICAgIClcbiAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLlVTRVJOQU1FX1RBS0VOLFxuICAgICAgICAgICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIHVzZXJuYW1lLidcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9KTtcbn07XG5cblJlc3RXcml0ZS5idWlsZENyZWF0ZWRXaXRoID0gZnVuY3Rpb24gKGFjdGlvbiwgYXV0aFByb3ZpZGVyKSB7XG4gIHJldHVybiB7IGFjdGlvbiwgYXV0aFByb3ZpZGVyOiBhdXRoUHJvdmlkZXIgfHwgJ3Bhc3N3b3JkJyB9O1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5nZXRDcmVhdGVkV2l0aCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuc3RvcmFnZS5jcmVhdGVkV2l0aCkge1xuICAgIHJldHVybiB0aGlzLnN0b3JhZ2UuY3JlYXRlZFdpdGg7XG4gIH1cbiAgY29uc3QgaXNDcmVhdGVPcGVyYXRpb24gPSAhdGhpcy5xdWVyeTtcbiAgY29uc3QgYXV0aERhdGFQcm92aWRlciA9XG4gICAgdGhpcy5kYXRhPy5hdXRoRGF0YSAmJlxuICAgIE9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSkubGVuZ3RoICYmXG4gICAgT2JqZWN0LmtleXModGhpcy5kYXRhLmF1dGhEYXRhKS5qb2luKCcsJyk7XG4gIGNvbnN0IGF1dGhQcm92aWRlciA9IHRoaXMuc3RvcmFnZS5hdXRoUHJvdmlkZXIgfHwgYXV0aERhdGFQcm92aWRlcjtcbiAgLy8gc3RvcmFnZS5hdXRoUHJvdmlkZXIgaXMgb25seSBzZXQgZm9yIGxvZ2luIChleGlzdGluZyB1c2VyIGZvdW5kIGluIGhhbmRsZUF1dGhEYXRhKVxuICBjb25zdCBhY3Rpb24gPSB0aGlzLnN0b3JhZ2UuYXV0aFByb3ZpZGVyID8gJ2xvZ2luJyA6IGlzQ3JlYXRlT3BlcmF0aW9uID8gJ3NpZ251cCcgOiB1bmRlZmluZWQ7XG4gIGlmICghYWN0aW9uKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJlc29sdmVkQXV0aFByb3ZpZGVyID0gYXV0aFByb3ZpZGVyIHx8IChhY3Rpb24gPT09ICdzaWdudXAnID8gJ3Bhc3N3b3JkJyA6IHVuZGVmaW5lZCk7XG4gIHRoaXMuc3RvcmFnZS5jcmVhdGVkV2l0aCA9IFJlc3RXcml0ZS5idWlsZENyZWF0ZWRXaXRoKGFjdGlvbiwgcmVzb2x2ZWRBdXRoUHJvdmlkZXIpO1xuICByZXR1cm4gdGhpcy5zdG9yYWdlLmNyZWF0ZWRXaXRoO1xufTtcblxuLypcbiAgQXMgd2l0aCB1c2VybmFtZXMsIFBhcnNlIHNob3VsZCBub3QgYWxsb3cgY2FzZSBpbnNlbnNpdGl2ZSBjb2xsaXNpb25zIG9mIGVtYWlsLlxuICB1bmxpa2Ugd2l0aCB1c2VybmFtZXMgKHdoaWNoIGNhbiBoYXZlIGNhc2UgaW5zZW5zaXRpdmUgY29sbGlzaW9ucyBpbiB0aGUgY2FzZSBvZlxuICBhdXRoIGFkYXB0ZXJzKSwgZW1haWxzIHNob3VsZCBuZXZlciBoYXZlIGEgY2FzZSBpbnNlbnNpdGl2ZSBjb2xsaXNpb24uXG5cbiAgVGhpcyBiZWhhdmlvciBjYW4gYmUgZW5mb3JjZWQgdGhyb3VnaCBhIHByb3Blcmx5IGNvbmZpZ3VyZWQgaW5kZXggc2VlOlxuICBodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL2NvcmUvaW5kZXgtY2FzZS1pbnNlbnNpdGl2ZS8jY3JlYXRlLWEtY2FzZS1pbnNlbnNpdGl2ZS1pbmRleFxuICB3aGljaCBjb3VsZCBiZSBpbXBsZW1lbnRlZCBpbnN0ZWFkIG9mIHRoaXMgY29kZSBiYXNlZCB2YWxpZGF0aW9uLlxuXG4gIEdpdmVuIHRoYXQgdGhpcyBsb29rdXAgc2hvdWxkIGJlIGEgcmVsYXRpdmVseSBsb3cgdXNlIGNhc2UgYW5kIHRoYXQgdGhlIGNhc2Ugc2Vuc2l0aXZlXG4gIHVuaXF1ZSBpbmRleCB3aWxsIGJlIHVzZWQgYnkgdGhlIGRiIGZvciB0aGUgcXVlcnksIHRoaXMgaXMgYW4gYWRlcXVhdGUgc29sdXRpb24uXG4qL1xuUmVzdFdyaXRlLnByb3RvdHlwZS5fdmFsaWRhdGVFbWFpbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF0aGlzLmRhdGEuZW1haWwgfHwgdGhpcy5kYXRhLmVtYWlsLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG4gIC8vIFZhbGlkYXRlIGJhc2ljIGVtYWlsIGFkZHJlc3MgZm9ybWF0XG4gIGlmICghdGhpcy5kYXRhLmVtYWlsLm1hdGNoKC9eLitALiskLykpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9FTUFJTF9BRERSRVNTLCAnRW1haWwgYWRkcmVzcyBmb3JtYXQgaXMgaW52YWxpZC4nKVxuICAgICk7XG4gIH1cbiAgLy8gQ2FzZSBpbnNlbnNpdGl2ZSBtYXRjaCwgc2VlIG5vdGUgYWJvdmUgZnVuY3Rpb24uXG4gIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgIC5maW5kKFxuICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICB7XG4gICAgICAgIGVtYWlsOiB0aGlzLmRhdGEuZW1haWwsXG4gICAgICAgIG9iamVjdElkOiB7ICRuZTogdGhpcy5vYmplY3RJZCgpIH0sXG4gICAgICB9LFxuICAgICAgeyBsaW1pdDogMSwgY2FzZUluc2Vuc2l0aXZlOiB0cnVlIH0sXG4gICAgICB7fSxcbiAgICAgIHRoaXMudmFsaWRTY2hlbWFDb250cm9sbGVyXG4gICAgKVxuICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuRU1BSUxfVEFLRU4sXG4gICAgICAgICAgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgZW1haWwgYWRkcmVzcy4nXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgICF0aGlzLmRhdGEuYXV0aERhdGEgfHxcbiAgICAgICAgIU9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSkubGVuZ3RoIHx8XG4gICAgICAgIChPYmplY3Qua2V5cyh0aGlzLmRhdGEuYXV0aERhdGEpLmxlbmd0aCA9PT0gMSAmJlxuICAgICAgICAgIE9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSlbMF0gPT09ICdhbm9ueW1vdXMnKVxuICAgICAgKSB7XG4gICAgICAgIC8vIFdlIHVwZGF0ZWQgdGhlIGVtYWlsLCBzZW5kIGEgbmV3IHZhbGlkYXRpb25cbiAgICAgICAgY29uc3QgeyBvcmlnaW5hbE9iamVjdCwgdXBkYXRlZE9iamVjdCB9ID0gdGhpcy5idWlsZFBhcnNlT2JqZWN0cygpO1xuICAgICAgICBjb25zdCByZXF1ZXN0ID0ge1xuICAgICAgICAgIG9yaWdpbmFsOiBvcmlnaW5hbE9iamVjdCxcbiAgICAgICAgICBvYmplY3Q6IHVwZGF0ZWRPYmplY3QsXG4gICAgICAgICAgbWFzdGVyOiB0aGlzLmF1dGguaXNNYXN0ZXIsXG4gICAgICAgICAgaXA6IHRoaXMuY29uZmlnLmlwLFxuICAgICAgICAgIGluc3RhbGxhdGlvbklkOiB0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQsXG4gICAgICAgICAgY3JlYXRlZFdpdGg6IHRoaXMuZ2V0Q3JlYXRlZFdpdGgoKSxcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLnVzZXJDb250cm9sbGVyLnNldEVtYWlsVmVyaWZ5VG9rZW4odGhpcy5kYXRhLCByZXF1ZXN0LCB0aGlzLnN0b3JhZ2UpO1xuICAgICAgfVxuICAgIH0pO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdmFsaWRhdGVQYXNzd29yZFBvbGljeSA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeSkgeyByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7IH1cbiAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlUGFzc3dvcmRSZXF1aXJlbWVudHMoKS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVQYXNzd29yZEhpc3RvcnkoKTtcbiAgfSk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZVBhc3N3b3JkUmVxdWlyZW1lbnRzID0gZnVuY3Rpb24gKCkge1xuICAvLyBjaGVjayBpZiB0aGUgcGFzc3dvcmQgY29uZm9ybXMgdG8gdGhlIGRlZmluZWQgcGFzc3dvcmQgcG9saWN5IGlmIGNvbmZpZ3VyZWRcbiAgLy8gSWYgd2Ugc3BlY2lmaWVkIGEgY3VzdG9tIGVycm9yIGluIG91ciBjb25maWd1cmF0aW9uIHVzZSBpdC5cbiAgLy8gRXhhbXBsZTogXCJQYXNzd29yZHMgbXVzdCBpbmNsdWRlIGEgQ2FwaXRhbCBMZXR0ZXIsIExvd2VyY2FzZSBMZXR0ZXIsIGFuZCBhIG51bWJlci5cIlxuICAvL1xuICAvLyBUaGlzIGlzIGVzcGVjaWFsbHkgdXNlZnVsIG9uIHRoZSBnZW5lcmljIFwicGFzc3dvcmQgcmVzZXRcIiBwYWdlLFxuICAvLyBhcyBpdCBhbGxvd3MgdGhlIHByb2dyYW1tZXIgdG8gY29tbXVuaWNhdGUgc3BlY2lmaWMgcmVxdWlyZW1lbnRzIGluc3RlYWQgb2Y6XG4gIC8vIGEuIG1ha2luZyB0aGUgdXNlciBndWVzcyB3aGF0cyB3cm9uZ1xuICAvLyBiLiBtYWtpbmcgYSBjdXN0b20gcGFzc3dvcmQgcmVzZXQgcGFnZSB0aGF0IHNob3dzIHRoZSByZXF1aXJlbWVudHNcbiAgY29uc3QgcG9saWN5RXJyb3IgPSB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS52YWxpZGF0aW9uRXJyb3JcbiAgICA/IHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnZhbGlkYXRpb25FcnJvclxuICAgIDogJ1Bhc3N3b3JkIGRvZXMgbm90IG1lZXQgdGhlIFBhc3N3b3JkIFBvbGljeSByZXF1aXJlbWVudHMuJztcbiAgY29uc3QgY29udGFpbnNVc2VybmFtZUVycm9yID0gJ1Bhc3N3b3JkIGNhbm5vdCBjb250YWluIHlvdXIgdXNlcm5hbWUuJztcblxuICAvLyBjaGVjayB3aGV0aGVyIHRoZSBwYXNzd29yZCBtZWV0cyB0aGUgcGFzc3dvcmQgc3RyZW5ndGggcmVxdWlyZW1lbnRzXG4gIGlmIChcbiAgICAodGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kucGF0dGVyblZhbGlkYXRvciAmJlxuICAgICAgIXRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnBhdHRlcm5WYWxpZGF0b3IodGhpcy5kYXRhLnBhc3N3b3JkKSkgfHxcbiAgICAodGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kudmFsaWRhdG9yQ2FsbGJhY2sgJiZcbiAgICAgICF0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS52YWxpZGF0b3JDYWxsYmFjayh0aGlzLmRhdGEucGFzc3dvcmQpKVxuICApIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsIHBvbGljeUVycm9yKSk7XG4gIH1cblxuICAvLyBjaGVjayB3aGV0aGVyIHBhc3N3b3JkIGNvbnRhaW4gdXNlcm5hbWVcbiAgaWYgKHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LmRvTm90QWxsb3dVc2VybmFtZSA9PT0gdHJ1ZSkge1xuICAgIGlmICh0aGlzLmRhdGEudXNlcm5hbWUpIHtcbiAgICAgIC8vIHVzZXJuYW1lIGlzIG5vdCBwYXNzZWQgZHVyaW5nIHBhc3N3b3JkIHJlc2V0XG4gICAgICBpZiAodGhpcy5kYXRhLnBhc3N3b3JkLmluZGV4T2YodGhpcy5kYXRhLnVzZXJuYW1lKSA+PSAwKVxuICAgICAgeyByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsIGNvbnRhaW5zVXNlcm5hbWVFcnJvcikpOyB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIHJldHJpZXZlIHRoZSBVc2VyIG9iamVjdCB1c2luZyBvYmplY3RJZCBkdXJpbmcgcGFzc3dvcmQgcmVzZXRcbiAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKCdfVXNlcicsIHsgb2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKSB9KS50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggIT0gMSkge1xuICAgICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5kYXRhLnBhc3N3b3JkLmluZGV4T2YocmVzdWx0c1swXS51c2VybmFtZSkgPj0gMClcbiAgICAgICAgeyByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICAgICAgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsIGNvbnRhaW5zVXNlcm5hbWVFcnJvcilcbiAgICAgICAgKTsgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdmFsaWRhdGVQYXNzd29yZEhpc3RvcnkgPSBmdW5jdGlvbiAoKSB7XG4gIC8vIGNoZWNrIHdoZXRoZXIgcGFzc3dvcmQgaXMgcmVwZWF0aW5nIGZyb20gc3BlY2lmaWVkIGhpc3RvcnlcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5KSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAuZmluZChcbiAgICAgICAgJ19Vc2VyJyxcbiAgICAgICAgeyBvYmplY3RJZDogdGhpcy5vYmplY3RJZCgpIH0sXG4gICAgICAgIHsga2V5czogWydfcGFzc3dvcmRfaGlzdG9yeScsICdfaGFzaGVkX3Bhc3N3b3JkJ10gfSxcbiAgICAgICAgQXV0aC5tYWludGVuYW5jZSh0aGlzLmNvbmZpZylcbiAgICAgIClcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggIT0gMSkge1xuICAgICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB1c2VyID0gcmVzdWx0c1swXTtcbiAgICAgICAgbGV0IG9sZFBhc3N3b3JkcyA9IFtdO1xuICAgICAgICBpZiAodXNlci5fcGFzc3dvcmRfaGlzdG9yeSlcbiAgICAgICAgeyBvbGRQYXNzd29yZHMgPSBfLnRha2UoXG4gICAgICAgICAgdXNlci5fcGFzc3dvcmRfaGlzdG9yeSxcbiAgICAgICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkgLSAxXG4gICAgICAgICk7IH1cbiAgICAgICAgb2xkUGFzc3dvcmRzLnB1c2godXNlci5wYXNzd29yZCk7XG4gICAgICAgIGNvbnN0IG5ld1Bhc3N3b3JkID0gdGhpcy5kYXRhLnBhc3N3b3JkO1xuICAgICAgICAvLyBjb21wYXJlIHRoZSBuZXcgcGFzc3dvcmQgaGFzaCB3aXRoIGFsbCBvbGQgcGFzc3dvcmQgaGFzaGVzXG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gb2xkUGFzc3dvcmRzLm1hcChmdW5jdGlvbiAoaGFzaCkge1xuICAgICAgICAgIHJldHVybiBwYXNzd29yZENyeXB0by5jb21wYXJlKG5ld1Bhc3N3b3JkLCBoYXNoKS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICBpZiAocmVzdWx0KVxuICAgICAgICAgICAgLy8gcmVqZWN0IGlmIHRoZXJlIGlzIGEgbWF0Y2hcbiAgICAgICAgICAgIHsgcmV0dXJuIFByb21pc2UucmVqZWN0KCdSRVBFQVRfUEFTU1dPUkQnKTsgfVxuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gd2FpdCBmb3IgYWxsIGNvbXBhcmlzb25zIHRvIGNvbXBsZXRlXG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcylcbiAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICAgIGlmIChlcnIgPT09ICdSRVBFQVRfUEFTU1dPUkQnKVxuICAgICAgICAgICAgLy8gYSBtYXRjaCB3YXMgZm91bmRcbiAgICAgICAgICAgIHsgcmV0dXJuIFByb21pc2UucmVqZWN0KFxuICAgICAgICAgICAgICBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuVkFMSURBVElPTl9FUlJPUixcbiAgICAgICAgICAgICAgICBgTmV3IHBhc3N3b3JkIHNob3VsZCBub3QgYmUgdGhlIHNhbWUgYXMgbGFzdCAke3RoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeX0gcGFzc3dvcmRzLmBcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTsgfVxuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5jcmVhdGVTZXNzaW9uVG9rZW5JZk5lZWRlZCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuY2xhc3NOYW1lICE9PSAnX1VzZXInKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIERvbid0IGdlbmVyYXRlIHNlc3Npb24gZm9yIHVwZGF0aW5nIHVzZXIgKHRoaXMucXVlcnkgaXMgc2V0KSB1bmxlc3MgYXV0aERhdGEgZXhpc3RzXG4gIGlmICh0aGlzLnF1ZXJ5ICYmICF0aGlzLmRhdGEuYXV0aERhdGEpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRG9uJ3QgZ2VuZXJhdGUgbmV3IHNlc3Npb25Ub2tlbiBpZiBsaW5raW5nIHZpYSBzZXNzaW9uVG9rZW5cbiAgaWYgKHRoaXMuYXV0aC51c2VyICYmIHRoaXMuZGF0YS5hdXRoRGF0YSkge1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBJZiBzaWduLXVwIGNhbGxcbiAgaWYgKCF0aGlzLnN0b3JhZ2UuYXV0aFByb3ZpZGVyKSB7XG4gICAgLy8gQ3JlYXRlIHJlcXVlc3Qgb2JqZWN0IGZvciB2ZXJpZmljYXRpb24gZnVuY3Rpb25zXG4gICAgY29uc3QgeyBvcmlnaW5hbE9iamVjdCwgdXBkYXRlZE9iamVjdCB9ID0gdGhpcy5idWlsZFBhcnNlT2JqZWN0cygpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICBvcmlnaW5hbDogb3JpZ2luYWxPYmplY3QsXG4gICAgICBvYmplY3Q6IHVwZGF0ZWRPYmplY3QsXG4gICAgICBtYXN0ZXI6IHRoaXMuYXV0aC5pc01hc3RlcixcbiAgICAgIGlwOiB0aGlzLmNvbmZpZy5pcCxcbiAgICAgIGluc3RhbGxhdGlvbklkOiB0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQsXG4gICAgICBjcmVhdGVkV2l0aDogdGhpcy5nZXRDcmVhdGVkV2l0aCgpLFxuICAgIH07XG4gICAgLy8gR2V0IHZlcmlmaWNhdGlvbiBjb25kaXRpb25zIHdoaWNoIGNhbiBiZSBib29sZWFucyBvciBmdW5jdGlvbnM7IHRoZSBwdXJwb3NlIG9mIHRoaXMgYXN5bmMvYXdhaXRcbiAgICAvLyBzdHJ1Y3R1cmUgaXMgdG8gYXZvaWQgdW5uZWNlc3NhcmlseSBleGVjdXRpbmcgc3Vic2VxdWVudCBmdW5jdGlvbnMgaWYgcHJldmlvdXMgb25lcyBmYWlsIGluIHRoZVxuICAgIC8vIGNvbmRpdGlvbmFsIHN0YXRlbWVudCBiZWxvdywgYXMgYSBkZXZlbG9wZXIgbWF5IGRlY2lkZSB0byBleGVjdXRlIGV4cGVuc2l2ZSBvcGVyYXRpb25zIGluIHRoZW1cbiAgICBjb25zdCB2ZXJpZnlVc2VyRW1haWxzID0gYXN5bmMgKCkgPT4gdGhpcy5jb25maWcudmVyaWZ5VXNlckVtYWlscyA9PT0gdHJ1ZSB8fCAodHlwZW9mIHRoaXMuY29uZmlnLnZlcmlmeVVzZXJFbWFpbHMgPT09ICdmdW5jdGlvbicgJiYgYXdhaXQgUHJvbWlzZS5yZXNvbHZlKHRoaXMuY29uZmlnLnZlcmlmeVVzZXJFbWFpbHMocmVxdWVzdCkpID09PSB0cnVlKTtcbiAgICBjb25zdCBwcmV2ZW50TG9naW5XaXRoVW52ZXJpZmllZEVtYWlsID0gYXN5bmMgKCkgPT4gdGhpcy5jb25maWcucHJldmVudExvZ2luV2l0aFVudmVyaWZpZWRFbWFpbCA9PT0gdHJ1ZSB8fCAodHlwZW9mIHRoaXMuY29uZmlnLnByZXZlbnRMb2dpbldpdGhVbnZlcmlmaWVkRW1haWwgPT09ICdmdW5jdGlvbicgJiYgYXdhaXQgUHJvbWlzZS5yZXNvbHZlKHRoaXMuY29uZmlnLnByZXZlbnRMb2dpbldpdGhVbnZlcmlmaWVkRW1haWwocmVxdWVzdCkpID09PSB0cnVlKTtcbiAgICAvLyBJZiB2ZXJpZmljYXRpb24gaXMgcmVxdWlyZWRcbiAgICBpZiAoYXdhaXQgdmVyaWZ5VXNlckVtYWlscygpICYmIGF3YWl0IHByZXZlbnRMb2dpbldpdGhVbnZlcmlmaWVkRW1haWwoKSkge1xuICAgICAgdGhpcy5zdG9yYWdlLnJlamVjdFNpZ251cCA9IHRydWU7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG4gIHJldHVybiB0aGlzLmNyZWF0ZVNlc3Npb25Ub2tlbigpO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5jcmVhdGVTZXNzaW9uVG9rZW4gPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIC8vIGNsb3VkIGluc3RhbGxhdGlvbklkIGZyb20gQ2xvdWQgQ29kZSxcbiAgLy8gbmV2ZXIgY3JlYXRlIHNlc3Npb24gdG9rZW5zIGZyb20gdGhlcmUuXG4gIGlmICh0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQgJiYgdGhpcy5hdXRoLmluc3RhbGxhdGlvbklkID09PSAnY2xvdWQnKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKHRoaXMuc3RvcmFnZS5hdXRoUHJvdmlkZXIgPT0gbnVsbCAmJiB0aGlzLmRhdGEuYXV0aERhdGEpIHtcbiAgICB0aGlzLnN0b3JhZ2UuYXV0aFByb3ZpZGVyID0gT2JqZWN0LmtleXModGhpcy5kYXRhLmF1dGhEYXRhKS5qb2luKCcsJyk7XG4gICAgLy8gSW52YWxpZGF0ZSBjYWNoZWQgY3JlYXRlZFdpdGggc2luY2UgYXV0aFByb3ZpZGVyIHdhcyBqdXN0IHJlc29sdmVkXG4gICAgZGVsZXRlIHRoaXMuc3RvcmFnZS5jcmVhdGVkV2l0aDtcbiAgfVxuXG4gIGNvbnN0IGNyZWF0ZWRXaXRoID0gdGhpcy5nZXRDcmVhdGVkV2l0aCgpO1xuICBjb25zdCB7IHNlc3Npb25EYXRhLCBjcmVhdGVTZXNzaW9uIH0gPSBSZXN0V3JpdGUuY3JlYXRlU2Vzc2lvbih0aGlzLmNvbmZpZywge1xuICAgIHVzZXJJZDogdGhpcy5vYmplY3RJZCgpLFxuICAgIGNyZWF0ZWRXaXRoLFxuICAgIGluc3RhbGxhdGlvbklkOiB0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQsXG4gIH0pO1xuXG4gIGlmICh0aGlzLnJlc3BvbnNlICYmIHRoaXMucmVzcG9uc2UucmVzcG9uc2UpIHtcbiAgICB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlLnNlc3Npb25Ub2tlbiA9IHNlc3Npb25EYXRhLnNlc3Npb25Ub2tlbjtcbiAgfVxuXG4gIHJldHVybiBjcmVhdGVTZXNzaW9uKCk7XG59O1xuXG5SZXN0V3JpdGUuY3JlYXRlU2Vzc2lvbiA9IGZ1bmN0aW9uIChcbiAgY29uZmlnLFxuICB7IHVzZXJJZCwgY3JlYXRlZFdpdGgsIGluc3RhbGxhdGlvbklkLCBhZGRpdGlvbmFsU2Vzc2lvbkRhdGEgfVxuKSB7XG4gIGNvbnN0IHRva2VuID0gJ3I6JyArIGNyeXB0b1V0aWxzLm5ld1Rva2VuKCk7XG4gIGNvbnN0IGV4cGlyZXNBdCA9IGNvbmZpZy5nZW5lcmF0ZVNlc3Npb25FeHBpcmVzQXQoKTtcbiAgY29uc3Qgc2Vzc2lvbkRhdGEgPSB7XG4gICAgc2Vzc2lvblRva2VuOiB0b2tlbixcbiAgICB1c2VyOiB7XG4gICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgIGNsYXNzTmFtZTogJ19Vc2VyJyxcbiAgICAgIG9iamVjdElkOiB1c2VySWQsXG4gICAgfSxcbiAgICBjcmVhdGVkV2l0aCxcbiAgICBleHBpcmVzQXQ6IFBhcnNlLl9lbmNvZGUoZXhwaXJlc0F0KSxcbiAgfTtcblxuICBpZiAoaW5zdGFsbGF0aW9uSWQpIHtcbiAgICBzZXNzaW9uRGF0YS5pbnN0YWxsYXRpb25JZCA9IGluc3RhbGxhdGlvbklkO1xuICB9XG5cbiAgT2JqZWN0LmFzc2lnbihzZXNzaW9uRGF0YSwgYWRkaXRpb25hbFNlc3Npb25EYXRhKTtcblxuICByZXR1cm4ge1xuICAgIHNlc3Npb25EYXRhLFxuICAgIGNyZWF0ZVNlc3Npb246ICgpID0+XG4gICAgICBuZXcgUmVzdFdyaXRlKGNvbmZpZywgQXV0aC5tYXN0ZXIoY29uZmlnKSwgJ19TZXNzaW9uJywgbnVsbCwgc2Vzc2lvbkRhdGEpLmV4ZWN1dGUoKSxcbiAgfTtcbn07XG5cbi8vIERlbGV0ZSBlbWFpbCByZXNldCB0b2tlbnMgaWYgdXNlciBpcyBjaGFuZ2luZyBwYXNzd29yZCBvciBlbWFpbC5cblJlc3RXcml0ZS5wcm90b3R5cGUuZGVsZXRlRW1haWxSZXNldFRva2VuSWZOZWVkZWQgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPT0gJ19Vc2VyJyB8fCB0aGlzLnF1ZXJ5ID09PSBudWxsKSB7XG4gICAgLy8gbnVsbCBxdWVyeSBtZWFucyBjcmVhdGVcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoJ3Bhc3N3b3JkJyBpbiB0aGlzLmRhdGEgfHwgJ2VtYWlsJyBpbiB0aGlzLmRhdGEpIHtcbiAgICBjb25zdCBhZGRPcHMgPSB7XG4gICAgICBfcGVyaXNoYWJsZV90b2tlbjogeyBfX29wOiAnRGVsZXRlJyB9LFxuICAgICAgX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdDogeyBfX29wOiAnRGVsZXRlJyB9LFxuICAgIH07XG4gICAgdGhpcy5kYXRhID0gT2JqZWN0LmFzc2lnbih0aGlzLmRhdGEsIGFkZE9wcyk7XG4gIH1cbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuZGVzdHJveUR1cGxpY2F0ZWRTZXNzaW9ucyA9IGZ1bmN0aW9uICgpIHtcbiAgLy8gT25seSBmb3IgX1Nlc3Npb24sIGFuZCBhdCBjcmVhdGlvbiB0aW1lXG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPSAnX1Nlc3Npb24nIHx8IHRoaXMucXVlcnkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRGVzdHJveSB0aGUgc2Vzc2lvbnMgaW4gJ0JhY2tncm91bmQnXG4gIGNvbnN0IHsgdXNlciwgaW5zdGFsbGF0aW9uSWQsIHNlc3Npb25Ub2tlbiB9ID0gdGhpcy5kYXRhO1xuICBpZiAoIXVzZXIgfHwgIWluc3RhbGxhdGlvbklkKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdXNlci5vYmplY3RJZCkge1xuICAgIHJldHVybjtcbiAgfVxuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZGVzdHJveShcbiAgICAnX1Nlc3Npb24nLFxuICAgIHtcbiAgICAgIHVzZXIsXG4gICAgICBpbnN0YWxsYXRpb25JZCxcbiAgICAgIHNlc3Npb25Ub2tlbjogeyAkbmU6IHNlc3Npb25Ub2tlbiB9LFxuICAgIH0sXG4gICAge30sXG4gICAgdGhpcy52YWxpZFNjaGVtYUNvbnRyb2xsZXJcbiAgKS5jYXRjaChlID0+IHtcbiAgICBpZiAoZS5jb2RlICE9PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vLyBIYW5kbGVzIGFueSBmb2xsb3d1cCBsb2dpY1xuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVGb2xsb3d1cCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuc3RvcmFnZSAmJiB0aGlzLnN0b3JhZ2VbJ2NsZWFyU2Vzc2lvbnMnXSAmJiB0aGlzLmNvbmZpZy5yZXZva2VTZXNzaW9uT25QYXNzd29yZFJlc2V0KSB7XG4gICAgdmFyIHNlc3Npb25RdWVyeSA9IHtcbiAgICAgIHVzZXI6IHtcbiAgICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICAgIGNsYXNzTmFtZTogJ19Vc2VyJyxcbiAgICAgICAgb2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBkZWxldGUgdGhpcy5zdG9yYWdlWydjbGVhclNlc3Npb25zJ107XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAuZGVzdHJveSgnX1Nlc3Npb24nLCBzZXNzaW9uUXVlcnkpXG4gICAgICAudGhlbih0aGlzLmhhbmRsZUZvbGxvd3VwLmJpbmQodGhpcykpO1xuICB9XG5cbiAgaWYgKHRoaXMuc3RvcmFnZSAmJiB0aGlzLnN0b3JhZ2VbJ2dlbmVyYXRlTmV3U2Vzc2lvbiddKSB7XG4gICAgZGVsZXRlIHRoaXMuc3RvcmFnZVsnZ2VuZXJhdGVOZXdTZXNzaW9uJ107XG4gICAgcmV0dXJuIHRoaXMuY3JlYXRlU2Vzc2lvblRva2VuKCkudGhlbih0aGlzLmhhbmRsZUZvbGxvd3VwLmJpbmQodGhpcykpO1xuICB9XG5cbiAgaWYgKHRoaXMuc3RvcmFnZSAmJiB0aGlzLnN0b3JhZ2VbJ3NlbmRWZXJpZmljYXRpb25FbWFpbCddKSB7XG4gICAgZGVsZXRlIHRoaXMuc3RvcmFnZVsnc2VuZFZlcmlmaWNhdGlvbkVtYWlsJ107XG4gICAgLy8gRmlyZSBhbmQgZm9yZ2V0IVxuICAgIHRoaXMuY29uZmlnLnVzZXJDb250cm9sbGVyLnNlbmRWZXJpZmljYXRpb25FbWFpbCh0aGlzLmRhdGEsIHsgYXV0aDogdGhpcy5hdXRoIH0pO1xuICAgIHJldHVybiB0aGlzLmhhbmRsZUZvbGxvd3VwLmJpbmQodGhpcyk7XG4gIH1cbn07XG5cbi8vIEhhbmRsZXMgdGhlIF9TZXNzaW9uIGNsYXNzIHNwZWNpYWxuZXNzLlxuLy8gRG9lcyBub3RoaW5nIGlmIHRoaXMgaXNuJ3QgYW4gX1Nlc3Npb24gb2JqZWN0LlxuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVTZXNzaW9uID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5yZXNwb25zZSB8fCB0aGlzLmNsYXNzTmFtZSAhPT0gJ19TZXNzaW9uJykge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghdGhpcy5hdXRoLnVzZXIgJiYgIXRoaXMuYXV0aC5pc01hc3RlciAmJiAhdGhpcy5hdXRoLmlzTWFpbnRlbmFuY2UpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9TRVNTSU9OX1RPS0VOLCAnU2Vzc2lvbiB0b2tlbiByZXF1aXJlZC4nKTtcbiAgfVxuXG4gIC8vIFRPRE86IFZlcmlmeSBwcm9wZXIgZXJyb3IgdG8gdGhyb3dcbiAgaWYgKCdBQ0wnIGluIHRoaXMuZGF0YSkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCAnQ2Fubm90IHNldCAnICsgJ0FDTCBvbiBhIFNlc3Npb24uJyk7XG4gIH1cblxuICBpZiAodGhpcy5xdWVyeSkge1xuICAgIGlmICgndXNlcicgaW4gdGhpcy5kYXRhICYmICF0aGlzLmF1dGguaXNNYXN0ZXIgJiYgdGhpcy5kYXRhLnVzZXI/Lm9iamVjdElkICE9PSB0aGlzLmF1dGgudXNlci5pZCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsICdJbnZhbGlkIGtleSBuYW1lOiB1c2VyJyk7XG4gICAgfSBlbHNlIGlmICgnaW5zdGFsbGF0aW9uSWQnIGluIHRoaXMuZGF0YSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsICdJbnZhbGlkIGtleSBuYW1lOiBpbnN0YWxsYXRpb25JZCcpO1xuICAgIH0gZWxzZSBpZiAoJ3Nlc3Npb25Ub2tlbicgaW4gdGhpcy5kYXRhKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgJ0ludmFsaWQga2V5IG5hbWU6IHNlc3Npb25Ub2tlbicpO1xuICAgIH0gZWxzZSBpZiAoJ2V4cGlyZXNBdCcgaW4gdGhpcy5kYXRhICYmICF0aGlzLmF1dGguaXNNYXN0ZXIgJiYgIXRoaXMuYXV0aC5pc01haW50ZW5hbmNlKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgJ0ludmFsaWQga2V5IG5hbWU6IGV4cGlyZXNBdCcpO1xuICAgIH0gZWxzZSBpZiAoJ2NyZWF0ZWRXaXRoJyBpbiB0aGlzLmRhdGEgJiYgIXRoaXMuYXV0aC5pc01hc3RlciAmJiAhdGhpcy5hdXRoLmlzTWFpbnRlbmFuY2UpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCAnSW52YWxpZCBrZXkgbmFtZTogY3JlYXRlZFdpdGgnKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICAgIHRoaXMucXVlcnkgPSB7XG4gICAgICAgICRhbmQ6IFtcbiAgICAgICAgICB0aGlzLnF1ZXJ5LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHVzZXI6IHtcbiAgICAgICAgICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICAgICAgICAgIGNsYXNzTmFtZTogJ19Vc2VyJyxcbiAgICAgICAgICAgICAgb2JqZWN0SWQ6IHRoaXMuYXV0aC51c2VyLmlkLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXRoaXMucXVlcnkgJiYgIXRoaXMuYXV0aC5pc01hc3RlciAmJiAhdGhpcy5hdXRoLmlzTWFpbnRlbmFuY2UpIHtcbiAgICBjb25zdCBhZGRpdGlvbmFsU2Vzc2lvbkRhdGEgPSB7fTtcbiAgICBmb3IgKHZhciBrZXkgaW4gdGhpcy5kYXRhKSB7XG4gICAgICBpZiAoa2V5ID09PSAnb2JqZWN0SWQnIHx8IGtleSA9PT0gJ3VzZXInIHx8IGtleSA9PT0gJ3Nlc3Npb25Ub2tlbicgfHwga2V5ID09PSAnZXhwaXJlc0F0JyB8fCBrZXkgPT09ICdjcmVhdGVkV2l0aCcpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBhZGRpdGlvbmFsU2Vzc2lvbkRhdGFba2V5XSA9IHRoaXMuZGF0YVtrZXldO1xuICAgIH1cblxuICAgIGNvbnN0IHsgc2Vzc2lvbkRhdGEsIGNyZWF0ZVNlc3Npb24gfSA9IFJlc3RXcml0ZS5jcmVhdGVTZXNzaW9uKHRoaXMuY29uZmlnLCB7XG4gICAgICB1c2VySWQ6IHRoaXMuYXV0aC51c2VyLmlkLFxuICAgICAgY3JlYXRlZFdpdGg6IHtcbiAgICAgICAgYWN0aW9uOiAnY3JlYXRlJyxcbiAgICAgIH0sXG4gICAgICBhZGRpdGlvbmFsU2Vzc2lvbkRhdGEsXG4gICAgfSk7XG5cbiAgICByZXR1cm4gY3JlYXRlU2Vzc2lvbigpLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICBpZiAoIXJlc3VsdHMucmVzcG9uc2UpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUiwgJ0Vycm9yIGNyZWF0aW5nIHNlc3Npb24uJyk7XG4gICAgICB9XG4gICAgICBzZXNzaW9uRGF0YVsnb2JqZWN0SWQnXSA9IHJlc3VsdHMucmVzcG9uc2VbJ29iamVjdElkJ107XG4gICAgICB0aGlzLnJlc3BvbnNlID0ge1xuICAgICAgICBzdGF0dXM6IDIwMSxcbiAgICAgICAgbG9jYXRpb246IHJlc3VsdHMubG9jYXRpb24sXG4gICAgICAgIHJlc3BvbnNlOiBzZXNzaW9uRGF0YSxcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cbn07XG5cbi8vIEhhbmRsZXMgdGhlIF9JbnN0YWxsYXRpb24gY2xhc3Mgc3BlY2lhbG5lc3MuXG4vLyBEb2VzIG5vdGhpbmcgaWYgdGhpcyBpc24ndCBhbiBpbnN0YWxsYXRpb24gb2JqZWN0LlxuLy8gSWYgYW4gaW5zdGFsbGF0aW9uIGlzIGZvdW5kLCB0aGlzIGNhbiBtdXRhdGUgdGhpcy5xdWVyeSBhbmQgdHVybiBhIGNyZWF0ZVxuLy8gaW50byBhbiB1cGRhdGUuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3Igd2hlbiB3ZSdyZSBkb25lIGlmIGl0IGNhbid0IGZpbmlzaCB0aGlzIHRpY2suXG5SZXN0V3JpdGUucHJvdG90eXBlLmhhbmRsZUluc3RhbGxhdGlvbiA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UgfHwgdGhpcy5jbGFzc05hbWUgIT09ICdfSW5zdGFsbGF0aW9uJykge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmIChcbiAgICAhdGhpcy5xdWVyeSAmJlxuICAgICF0aGlzLmRhdGEuZGV2aWNlVG9rZW4gJiZcbiAgICAhdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkICYmXG4gICAgIXRoaXMuYXV0aC5pbnN0YWxsYXRpb25JZFxuICApIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAxMzUsXG4gICAgICAnYXQgbGVhc3Qgb25lIElEIGZpZWxkIChkZXZpY2VUb2tlbiwgaW5zdGFsbGF0aW9uSWQpICcgKyAnbXVzdCBiZSBzcGVjaWZpZWQgaW4gdGhpcyBvcGVyYXRpb24nXG4gICAgKTtcbiAgfVxuXG4gIC8vIElmIHRoZSBkZXZpY2UgdG9rZW4gaXMgNjQgY2hhcmFjdGVycyBsb25nLCB3ZSBhc3N1bWUgaXQgaXMgZm9yIGlPU1xuICAvLyBhbmQgbG93ZXJjYXNlIGl0LlxuICBpZiAodGhpcy5kYXRhLmRldmljZVRva2VuICYmIHRoaXMuZGF0YS5kZXZpY2VUb2tlbi5sZW5ndGggPT0gNjQpIHtcbiAgICB0aGlzLmRhdGEuZGV2aWNlVG9rZW4gPSB0aGlzLmRhdGEuZGV2aWNlVG9rZW4udG9Mb3dlckNhc2UoKTtcbiAgfVxuXG4gIC8vIFdlIGxvd2VyY2FzZSB0aGUgaW5zdGFsbGF0aW9uSWQgaWYgcHJlc2VudFxuICBpZiAodGhpcy5kYXRhLmluc3RhbGxhdGlvbklkKSB7XG4gICAgdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkID0gdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkLnRvTG93ZXJDYXNlKCk7XG4gIH1cblxuICBsZXQgaW5zdGFsbGF0aW9uSWQgPSB0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQ7XG5cbiAgLy8gSWYgZGF0YS5pbnN0YWxsYXRpb25JZCBpcyBub3Qgc2V0IGFuZCB3ZSdyZSBub3QgbWFzdGVyLCB3ZSBjYW4gbG9va3VwIGluIGF1dGhcbiAgaWYgKCFpbnN0YWxsYXRpb25JZCAmJiAhdGhpcy5hdXRoLmlzTWFzdGVyICYmICF0aGlzLmF1dGguaXNNYWludGVuYW5jZSkge1xuICAgIGluc3RhbGxhdGlvbklkID0gdGhpcy5hdXRoLmluc3RhbGxhdGlvbklkO1xuICB9XG5cbiAgaWYgKGluc3RhbGxhdGlvbklkKSB7XG4gICAgaW5zdGFsbGF0aW9uSWQgPSBpbnN0YWxsYXRpb25JZC50b0xvd2VyQ2FzZSgpO1xuICB9XG5cbiAgLy8gVXBkYXRpbmcgX0luc3RhbGxhdGlvbiBidXQgbm90IHVwZGF0aW5nIGFueXRoaW5nIGNyaXRpY2FsXG4gIGlmICh0aGlzLnF1ZXJ5ICYmICF0aGlzLmRhdGEuZGV2aWNlVG9rZW4gJiYgIWluc3RhbGxhdGlvbklkICYmICF0aGlzLmRhdGEuZGV2aWNlVHlwZSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHZhciBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgdmFyIGlkTWF0Y2g7IC8vIFdpbGwgYmUgYSBtYXRjaCBvbiBlaXRoZXIgb2JqZWN0SWQgb3IgaW5zdGFsbGF0aW9uSWRcbiAgdmFyIG9iamVjdElkTWF0Y2g7XG4gIHZhciBpbnN0YWxsYXRpb25JZE1hdGNoO1xuICB2YXIgZGV2aWNlVG9rZW5NYXRjaGVzID0gW107XG5cbiAgLy8gSW5zdGVhZCBvZiBpc3N1aW5nIDMgcmVhZHMsIGxldCdzIGRvIGl0IHdpdGggb25lIE9SLlxuICBjb25zdCBvclF1ZXJpZXMgPSBbXTtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIG9yUXVlcmllcy5wdXNoKHtcbiAgICAgIG9iamVjdElkOiB0aGlzLnF1ZXJ5Lm9iamVjdElkLFxuICAgIH0pO1xuICB9XG4gIGlmIChpbnN0YWxsYXRpb25JZCkge1xuICAgIG9yUXVlcmllcy5wdXNoKHtcbiAgICAgIGluc3RhbGxhdGlvbklkOiBpbnN0YWxsYXRpb25JZCxcbiAgICB9KTtcbiAgfVxuICBpZiAodGhpcy5kYXRhLmRldmljZVRva2VuKSB7XG4gICAgb3JRdWVyaWVzLnB1c2goeyBkZXZpY2VUb2tlbjogdGhpcy5kYXRhLmRldmljZVRva2VuIH0pO1xuICB9XG5cbiAgaWYgKG9yUXVlcmllcy5sZW5ndGggPT0gMCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHByb21pc2UgPSBwcm9taXNlXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoXG4gICAgICAgICdfSW5zdGFsbGF0aW9uJyxcbiAgICAgICAge1xuICAgICAgICAgICRvcjogb3JRdWVyaWVzLFxuICAgICAgICB9LFxuICAgICAgICB7fVxuICAgICAgKTtcbiAgICB9KVxuICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgcmVzdWx0cy5mb3JFYWNoKHJlc3VsdCA9PiB7XG4gICAgICAgIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQgJiYgcmVzdWx0Lm9iamVjdElkID09IHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAgICAgICBvYmplY3RJZE1hdGNoID0gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZXN1bHQuaW5zdGFsbGF0aW9uSWQgPT0gaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgICBpbnN0YWxsYXRpb25JZE1hdGNoID0gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZXN1bHQuZGV2aWNlVG9rZW4gPT0gdGhpcy5kYXRhLmRldmljZVRva2VuKSB7XG4gICAgICAgICAgZGV2aWNlVG9rZW5NYXRjaGVzLnB1c2gocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIFNhbml0eSBjaGVja3Mgd2hlbiBydW5uaW5nIGEgcXVlcnlcbiAgICAgIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAgICAgaWYgKCFvYmplY3RJZE1hdGNoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdPYmplY3Qgbm90IGZvdW5kIGZvciB1cGRhdGUuJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCAmJlxuICAgICAgICAgIG9iamVjdElkTWF0Y2guaW5zdGFsbGF0aW9uSWQgJiZcbiAgICAgICAgICB0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQgIT09IG9iamVjdElkTWF0Y2guaW5zdGFsbGF0aW9uSWRcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEzNiwgJ2luc3RhbGxhdGlvbklkIG1heSBub3QgYmUgY2hhbmdlZCBpbiB0aGlzICcgKyAnb3BlcmF0aW9uJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHRoaXMuZGF0YS5kZXZpY2VUb2tlbiAmJlxuICAgICAgICAgIG9iamVjdElkTWF0Y2guZGV2aWNlVG9rZW4gJiZcbiAgICAgICAgICB0aGlzLmRhdGEuZGV2aWNlVG9rZW4gIT09IG9iamVjdElkTWF0Y2guZGV2aWNlVG9rZW4gJiZcbiAgICAgICAgICAhdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkICYmXG4gICAgICAgICAgIW9iamVjdElkTWF0Y2guaW5zdGFsbGF0aW9uSWRcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEzNiwgJ2RldmljZVRva2VuIG1heSBub3QgYmUgY2hhbmdlZCBpbiB0aGlzICcgKyAnb3BlcmF0aW9uJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHRoaXMuZGF0YS5kZXZpY2VUeXBlICYmXG4gICAgICAgICAgdGhpcy5kYXRhLmRldmljZVR5cGUgJiZcbiAgICAgICAgICB0aGlzLmRhdGEuZGV2aWNlVHlwZSAhPT0gb2JqZWN0SWRNYXRjaC5kZXZpY2VUeXBlXG4gICAgICAgICkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxMzYsICdkZXZpY2VUeXBlIG1heSBub3QgYmUgY2hhbmdlZCBpbiB0aGlzICcgKyAnb3BlcmF0aW9uJyk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCAmJiBvYmplY3RJZE1hdGNoKSB7XG4gICAgICAgIGlkTWF0Y2ggPSBvYmplY3RJZE1hdGNoO1xuICAgICAgfVxuXG4gICAgICBpZiAoaW5zdGFsbGF0aW9uSWQgJiYgaW5zdGFsbGF0aW9uSWRNYXRjaCkge1xuICAgICAgICBpZE1hdGNoID0gaW5zdGFsbGF0aW9uSWRNYXRjaDtcbiAgICAgIH1cbiAgICAgIC8vIG5lZWQgdG8gc3BlY2lmeSBkZXZpY2VUeXBlIG9ubHkgaWYgaXQncyBuZXdcbiAgICAgIGlmICghdGhpcy5xdWVyeSAmJiAhdGhpcy5kYXRhLmRldmljZVR5cGUgJiYgIWlkTWF0Y2gpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEzNSwgJ2RldmljZVR5cGUgbXVzdCBiZSBzcGVjaWZpZWQgaW4gdGhpcyBvcGVyYXRpb24nKTtcbiAgICAgIH1cbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIGlmICghaWRNYXRjaCkge1xuICAgICAgICBpZiAoIWRldmljZVRva2VuTWF0Y2hlcy5sZW5ndGgpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgZGV2aWNlVG9rZW5NYXRjaGVzLmxlbmd0aCA9PSAxICYmXG4gICAgICAgICAgKCFkZXZpY2VUb2tlbk1hdGNoZXNbMF1bJ2luc3RhbGxhdGlvbklkJ10gfHwgIWluc3RhbGxhdGlvbklkKVxuICAgICAgICApIHtcbiAgICAgICAgICAvLyBTaW5nbGUgbWF0Y2ggb24gZGV2aWNlIHRva2VuIGJ1dCBub25lIG9uIGluc3RhbGxhdGlvbklkLCBhbmQgZWl0aGVyXG4gICAgICAgICAgLy8gdGhlIHBhc3NlZCBvYmplY3Qgb3IgdGhlIG1hdGNoIGlzIG1pc3NpbmcgYW4gaW5zdGFsbGF0aW9uSWQsIHNvIHdlXG4gICAgICAgICAgLy8gY2FuIGp1c3QgcmV0dXJuIHRoZSBtYXRjaC5cbiAgICAgICAgICByZXR1cm4gZGV2aWNlVG9rZW5NYXRjaGVzWzBdWydvYmplY3RJZCddO1xuICAgICAgICB9IGVsc2UgaWYgKCF0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAxMzIsXG4gICAgICAgICAgICAnTXVzdCBzcGVjaWZ5IGluc3RhbGxhdGlvbklkIHdoZW4gZGV2aWNlVG9rZW4gJyArXG4gICAgICAgICAgICAgICdtYXRjaGVzIG11bHRpcGxlIEluc3RhbGxhdGlvbiBvYmplY3RzJ1xuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gTXVsdGlwbGUgZGV2aWNlIHRva2VuIG1hdGNoZXMgYW5kIHdlIHNwZWNpZmllZCBhbiBpbnN0YWxsYXRpb24gSUQsXG4gICAgICAgICAgLy8gb3IgYSBzaW5nbGUgbWF0Y2ggd2hlcmUgYm90aCB0aGUgcGFzc2VkIGFuZCBtYXRjaGluZyBvYmplY3RzIGhhdmVcbiAgICAgICAgICAvLyBhbiBpbnN0YWxsYXRpb24gSUQuIENsZWFuIG91dCBvdGhlciBpbnN0YWxsYXRpb25zIHRoYXQgbWF0Y2ggdGhlXG4gICAgICAgICAgLy8gZGV2aWNlVG9rZW4sIGFuZCByZXR1cm4gbmlsIHRvIHNpZ25hbCB0aGF0IGEgbmV3IG9iamVjdCBzaG91bGQgYmVcbiAgICAgICAgICAvLyBjcmVhdGVkLlxuICAgICAgICAgIGNvbnN0IGRlbFF1ZXJ5ID0ge1xuICAgICAgICAgICAgZGV2aWNlVG9rZW46IHRoaXMuZGF0YS5kZXZpY2VUb2tlbixcbiAgICAgICAgICAgIGluc3RhbGxhdGlvbklkOiB7XG4gICAgICAgICAgICAgICRuZTogaW5zdGFsbGF0aW9uSWQsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH07XG4gICAgICAgICAgaWYgKHRoaXMuZGF0YS5hcHBJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICBkZWxRdWVyeVsnYXBwSWRlbnRpZmllciddID0gdGhpcy5kYXRhLmFwcElkZW50aWZpZXI7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGluc3RhbGxhdGlvbk9wdHMgPSB0aGlzLmNvbmZpZy5pbnN0YWxsYXRpb24gfHwge307XG4gICAgICAgICAgcmV0dXJuIEluc3RhbGxhdGlvbkRlZHVwLnJlbW92ZUNvbmZsaWN0aW5nRGV2aWNlVG9rZW4oe1xuICAgICAgICAgICAgZGF0YWJhc2U6IHRoaXMuY29uZmlnLmRhdGFiYXNlLFxuICAgICAgICAgICAgcXVlcnk6IGRlbFF1ZXJ5LFxuICAgICAgICAgICAgYWN0aW9uOiBpbnN0YWxsYXRpb25PcHRzLmR1cGxpY2F0ZURldmljZVRva2VuQWN0aW9uIHx8ICdkZWxldGUnLFxuICAgICAgICAgICAgZW5mb3JjZUF1dGg6IGluc3RhbGxhdGlvbk9wdHMuZHVwbGljYXRlRGV2aWNlVG9rZW5BY3Rpb25FbmZvcmNlQXV0aCA9PT0gdHJ1ZSxcbiAgICAgICAgICAgIHJ1bk9wdGlvbnM6IHRoaXMucnVuT3B0aW9ucyxcbiAgICAgICAgICAgIHZhbGlkU2NoZW1hQ29udHJvbGxlcjogdGhpcy52YWxpZFNjaGVtYUNvbnRyb2xsZXIsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChkZXZpY2VUb2tlbk1hdGNoZXMubGVuZ3RoID09IDEgJiYgIWRldmljZVRva2VuTWF0Y2hlc1swXVsnaW5zdGFsbGF0aW9uSWQnXSkge1xuICAgICAgICAgIC8vIEV4YWN0bHkgb25lIGRldmljZSB0b2tlbiBtYXRjaCBhbmQgaXQgZG9lc24ndCBoYXZlIGFuIGluc3RhbGxhdGlvblxuICAgICAgICAgIC8vIElELiBUaGUgdHdvIHJvd3MgcmVwcmVzZW50IHRoZSBzYW1lIGluc3RhbGw7IHJlc29sdmUgdGhlIG1lcmdlIHBlclxuICAgICAgICAgIC8vIHRoZSBjb25maWd1cmVkIG9wdGlvbnMuXG4gICAgICAgICAgY29uc3QgaW5zdGFsbGF0aW9uT3B0cyA9IHRoaXMuY29uZmlnLmluc3RhbGxhdGlvbiB8fCB7fTtcbiAgICAgICAgICByZXR1cm4gSW5zdGFsbGF0aW9uRGVkdXAuYXBwbHlEdXBsaWNhdGVEZXZpY2VUb2tlbk1lcmdlKHtcbiAgICAgICAgICAgIGRhdGFiYXNlOiB0aGlzLmNvbmZpZy5kYXRhYmFzZSxcbiAgICAgICAgICAgIGlkTWF0Y2gsXG4gICAgICAgICAgICBkZXZpY2VUb2tlbk1hdGNoOiBkZXZpY2VUb2tlbk1hdGNoZXNbMF0sXG4gICAgICAgICAgICBhY3Rpb246IGluc3RhbGxhdGlvbk9wdHMuZHVwbGljYXRlRGV2aWNlVG9rZW5BY3Rpb24gfHwgJ2RlbGV0ZScsXG4gICAgICAgICAgICBtZXJnZVByaW9yaXR5OiBpbnN0YWxsYXRpb25PcHRzLmR1cGxpY2F0ZURldmljZVRva2VuTWVyZ2VQcmlvcml0eSB8fCAnZGV2aWNlVG9rZW4nLFxuICAgICAgICAgICAgZW5mb3JjZUF1dGg6IGluc3RhbGxhdGlvbk9wdHMuZHVwbGljYXRlRGV2aWNlVG9rZW5BY3Rpb25FbmZvcmNlQXV0aCA9PT0gdHJ1ZSxcbiAgICAgICAgICAgIHJ1bk9wdGlvbnM6IHRoaXMucnVuT3B0aW9ucyxcbiAgICAgICAgICAgIHZhbGlkU2NoZW1hQ29udHJvbGxlcjogdGhpcy52YWxpZFNjaGVtYUNvbnRyb2xsZXIsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKHRoaXMuZGF0YS5kZXZpY2VUb2tlbiAmJiBpZE1hdGNoLmRldmljZVRva2VuICE9IHRoaXMuZGF0YS5kZXZpY2VUb2tlbikge1xuICAgICAgICAgICAgLy8gV2UncmUgc2V0dGluZyB0aGUgZGV2aWNlIHRva2VuIG9uIGFuIGV4aXN0aW5nIGluc3RhbGxhdGlvbiwgc29cbiAgICAgICAgICAgIC8vIHdlIHNob3VsZCB0cnkgY2xlYW5pbmcgb3V0IG9sZCBpbnN0YWxsYXRpb25zIHRoYXQgbWF0Y2ggdGhpc1xuICAgICAgICAgICAgLy8gZGV2aWNlIHRva2VuLlxuICAgICAgICAgICAgY29uc3QgZGVsUXVlcnkgPSB7XG4gICAgICAgICAgICAgIGRldmljZVRva2VuOiB0aGlzLmRhdGEuZGV2aWNlVG9rZW4sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgLy8gV2UgaGF2ZSBhIHVuaXF1ZSBpbnN0YWxsIElkLCB1c2UgdGhhdCB0byBwcmVzZXJ2ZVxuICAgICAgICAgICAgLy8gdGhlIGludGVyZXN0aW5nIGluc3RhbGxhdGlvblxuICAgICAgICAgICAgaWYgKHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCkge1xuICAgICAgICAgICAgICBkZWxRdWVyeVsnaW5zdGFsbGF0aW9uSWQnXSA9IHtcbiAgICAgICAgICAgICAgICAkbmU6IHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCxcbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgICAgIGlkTWF0Y2gub2JqZWN0SWQgJiZcbiAgICAgICAgICAgICAgdGhpcy5kYXRhLm9iamVjdElkICYmXG4gICAgICAgICAgICAgIGlkTWF0Y2gub2JqZWN0SWQgPT0gdGhpcy5kYXRhLm9iamVjdElkXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgLy8gd2UgcGFzc2VkIGFuIG9iamVjdElkLCBwcmVzZXJ2ZSB0aGF0IGluc3RhbGF0aW9uXG4gICAgICAgICAgICAgIGRlbFF1ZXJ5WydvYmplY3RJZCddID0ge1xuICAgICAgICAgICAgICAgICRuZTogaWRNYXRjaC5vYmplY3RJZCxcbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIC8vIFdoYXQgdG8gZG8gaGVyZT8gY2FuJ3QgcmVhbGx5IGNsZWFuIHVwIGV2ZXJ5dGhpbmcuLi5cbiAgICAgICAgICAgICAgcmV0dXJuIGlkTWF0Y2gub2JqZWN0SWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5kYXRhLmFwcElkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgZGVsUXVlcnlbJ2FwcElkZW50aWZpZXInXSA9IHRoaXMuZGF0YS5hcHBJZGVudGlmaWVyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgaW5zdGFsbGF0aW9uT3B0cyA9IHRoaXMuY29uZmlnLmluc3RhbGxhdGlvbiB8fCB7fTtcbiAgICAgICAgICAgIHJldHVybiBJbnN0YWxsYXRpb25EZWR1cC5yZW1vdmVDb25mbGljdGluZ0RldmljZVRva2VuKHtcbiAgICAgICAgICAgICAgZGF0YWJhc2U6IHRoaXMuY29uZmlnLmRhdGFiYXNlLFxuICAgICAgICAgICAgICBxdWVyeTogZGVsUXVlcnksXG4gICAgICAgICAgICAgIGFjdGlvbjogaW5zdGFsbGF0aW9uT3B0cy5kdXBsaWNhdGVEZXZpY2VUb2tlbkFjdGlvbiB8fCAnZGVsZXRlJyxcbiAgICAgICAgICAgICAgZW5mb3JjZUF1dGg6IGluc3RhbGxhdGlvbk9wdHMuZHVwbGljYXRlRGV2aWNlVG9rZW5BY3Rpb25FbmZvcmNlQXV0aCA9PT0gdHJ1ZSxcbiAgICAgICAgICAgICAgcnVuT3B0aW9uczogdGhpcy5ydW5PcHRpb25zLFxuICAgICAgICAgICAgICB2YWxpZFNjaGVtYUNvbnRyb2xsZXI6IHRoaXMudmFsaWRTY2hlbWFDb250cm9sbGVyLFxuICAgICAgICAgICAgfSkudGhlbigoKSA9PiBpZE1hdGNoLm9iamVjdElkKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gSW4gbm9uLW1lcmdlIHNjZW5hcmlvcywganVzdCByZXR1cm4gdGhlIGluc3RhbGxhdGlvbiBtYXRjaCBpZFxuICAgICAgICAgIHJldHVybiBpZE1hdGNoLm9iamVjdElkO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgICAudGhlbihvYmpJZCA9PiB7XG4gICAgICBpZiAob2JqSWQpIHtcbiAgICAgICAgdGhpcy5xdWVyeSA9IHsgb2JqZWN0SWQ6IG9iaklkIH07XG4gICAgICAgIGRlbGV0ZSB0aGlzLmRhdGEub2JqZWN0SWQ7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmRhdGEuY3JlYXRlZEF0O1xuICAgICAgfVxuICAgICAgLy8gVE9ETzogVmFsaWRhdGUgb3BzIChhZGQvcmVtb3ZlIG9uIGNoYW5uZWxzLCAkaW5jIG9uIGJhZGdlLCBldGMuKVxuICAgIH0pO1xuICByZXR1cm4gcHJvbWlzZTtcbn07XG5cbi8vIElmIHdlIHNob3J0LWNpcmN1aXRlZCB0aGUgb2JqZWN0IHJlc3BvbnNlIC0gdGhlbiB3ZSBuZWVkIHRvIG1ha2Ugc3VyZSB3ZSBleHBhbmQgYWxsIHRoZSBmaWxlcyxcbi8vIHNpbmNlIHRoaXMgbWlnaHQgbm90IGhhdmUgYSBxdWVyeSwgbWVhbmluZyBpdCB3b24ndCByZXR1cm4gdGhlIGZ1bGwgcmVzdWx0IGJhY2suXG4vLyBUT0RPOiAobmx1dHNlbmtvKSBUaGlzIHNob3VsZCBkaWUgd2hlbiB3ZSBtb3ZlIHRvIHBlci1jbGFzcyBiYXNlZCBjb250cm9sbGVycyBvbiBfU2Vzc2lvbi9fVXNlclxuUmVzdFdyaXRlLnByb3RvdHlwZS5leHBhbmRGaWxlc0ZvckV4aXN0aW5nT2JqZWN0cyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgLy8gQ2hlY2sgd2hldGhlciB3ZSBoYXZlIGEgc2hvcnQtY2lyY3VpdGVkIHJlc3BvbnNlIC0gb25seSB0aGVuIHJ1biBleHBhbnNpb24uXG4gIGlmICh0aGlzLnJlc3BvbnNlICYmIHRoaXMucmVzcG9uc2UucmVzcG9uc2UpIHtcbiAgICBhd2FpdCB0aGlzLmNvbmZpZy5maWxlc0NvbnRyb2xsZXIuZXhwYW5kRmlsZXNJbk9iamVjdCh0aGlzLmNvbmZpZywgdGhpcy5yZXNwb25zZS5yZXNwb25zZSk7XG4gIH1cbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUucnVuRGF0YWJhc2VPcGVyYXRpb24gPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLnJlc3BvbnNlKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1JvbGUnKSB7XG4gICAgdGhpcy5jb25maWcuY2FjaGVDb250cm9sbGVyLnJvbGUuY2xlYXIoKTtcbiAgICBpZiAodGhpcy5jb25maWcubGl2ZVF1ZXJ5Q29udHJvbGxlcikge1xuICAgICAgdGhpcy5jb25maWcubGl2ZVF1ZXJ5Q29udHJvbGxlci5jbGVhckNhY2hlZFJvbGVzKHRoaXMuYXV0aC51c2VyKTtcbiAgICB9XG4gIH1cblxuICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiYgdGhpcy5xdWVyeSAmJiB0aGlzLmF1dGguaXNVbmF1dGhlbnRpY2F0ZWQoKSkge1xuICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuU0VTU0lPTl9NSVNTSU5HLFxuICAgICAgYENhbm5vdCBtb2RpZnkgdXNlciAke3RoaXMucXVlcnkub2JqZWN0SWR9LmAsXG4gICAgICB0aGlzLmNvbmZpZ1xuICAgICk7XG4gIH1cblxuICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfUHJvZHVjdCcgJiYgdGhpcy5kYXRhLmRvd25sb2FkKSB7XG4gICAgdGhpcy5kYXRhLmRvd25sb2FkTmFtZSA9IHRoaXMuZGF0YS5kb3dubG9hZC5uYW1lO1xuICB9XG5cbiAgLy8gVE9ETzogQWRkIGJldHRlciBkZXRlY3Rpb24gZm9yIEFDTCwgZW5zdXJpbmcgYSB1c2VyIGNhbid0IGJlIGxvY2tlZCBmcm9tXG4gIC8vICAgICAgIHRoZWlyIG93biB1c2VyIHJlY29yZC5cbiAgaWYgKHRoaXMuZGF0YS5BQ0wgJiYgdGhpcy5kYXRhLkFDTFsnKnVucmVzb2x2ZWQnXSkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0FDTCwgJ0ludmFsaWQgQUNMLicpO1xuICB9XG5cbiAgaWYgKHRoaXMucXVlcnkpIHtcbiAgICAvLyBGb3JjZSB0aGUgdXNlciB0byBub3QgbG9ja291dFxuICAgIC8vIE1hdGNoZWQgd2l0aCBwYXJzZS5jb21cbiAgICBpZiAoXG4gICAgICB0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJlxuICAgICAgdGhpcy5kYXRhLkFDTCAmJlxuICAgICAgdGhpcy5hdXRoLmlzTWFzdGVyICE9PSB0cnVlICYmXG4gICAgICB0aGlzLmF1dGguaXNNYWludGVuYW5jZSAhPT0gdHJ1ZVxuICAgICkge1xuICAgICAgdGhpcy5kYXRhLkFDTFt0aGlzLnF1ZXJ5Lm9iamVjdElkXSA9IHsgcmVhZDogdHJ1ZSwgd3JpdGU6IHRydWUgfTtcbiAgICB9XG4gICAgLy8gdXBkYXRlIHBhc3N3b3JkIHRpbWVzdGFtcCBpZiB1c2VyIHBhc3N3b3JkIGlzIGJlaW5nIGNoYW5nZWRcbiAgICBpZiAoXG4gICAgICB0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJlxuICAgICAgdGhpcy5kYXRhLl9oYXNoZWRfcGFzc3dvcmQgJiZcbiAgICAgIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5ICYmXG4gICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEFnZVxuICAgICkge1xuICAgICAgdGhpcy5kYXRhLl9wYXNzd29yZF9jaGFuZ2VkX2F0ID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZSgpKTtcbiAgICB9XG4gICAgLy8gSWdub3JlIGNyZWF0ZWRBdCB3aGVuIHVwZGF0ZVxuICAgIGRlbGV0ZSB0aGlzLmRhdGEuY3JlYXRlZEF0O1xuXG4gICAgbGV0IGRlZmVyID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgLy8gaWYgcGFzc3dvcmQgaGlzdG9yeSBpcyBlbmFibGVkIHRoZW4gc2F2ZSB0aGUgY3VycmVudCBwYXNzd29yZCB0byBoaXN0b3J5XG4gICAgaWYgKFxuICAgICAgdGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiZcbiAgICAgIHRoaXMuZGF0YS5faGFzaGVkX3Bhc3N3b3JkICYmXG4gICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeSAmJlxuICAgICAgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5XG4gICAgKSB7XG4gICAgICBkZWZlciA9IHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAgIC5maW5kKFxuICAgICAgICAgICdfVXNlcicsXG4gICAgICAgICAgeyBvYmplY3RJZDogdGhpcy5vYmplY3RJZCgpIH0sXG4gICAgICAgICAgeyBrZXlzOiBbJ19wYXNzd29yZF9oaXN0b3J5JywgJ19oYXNoZWRfcGFzc3dvcmQnXSB9LFxuICAgICAgICAgIEF1dGgubWFpbnRlbmFuY2UodGhpcy5jb25maWcpXG4gICAgICAgIClcbiAgICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgdXNlciA9IHJlc3VsdHNbMF07XG4gICAgICAgICAgbGV0IG9sZFBhc3N3b3JkcyA9IFtdO1xuICAgICAgICAgIGlmICh1c2VyLl9wYXNzd29yZF9oaXN0b3J5KSB7XG4gICAgICAgICAgICBvbGRQYXNzd29yZHMgPSBfLnRha2UoXG4gICAgICAgICAgICAgIHVzZXIuX3Bhc3N3b3JkX2hpc3RvcnksXG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy9uLTEgcGFzc3dvcmRzIGdvIGludG8gaGlzdG9yeSBpbmNsdWRpbmcgbGFzdCBwYXNzd29yZFxuICAgICAgICAgIHdoaWxlIChcbiAgICAgICAgICAgIG9sZFBhc3N3b3Jkcy5sZW5ndGggPiBNYXRoLm1heCgwLCB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkgLSAyKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgb2xkUGFzc3dvcmRzLnNoaWZ0KCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIG9sZFBhc3N3b3Jkcy5wdXNoKHVzZXIucGFzc3dvcmQpO1xuICAgICAgICAgIHRoaXMuZGF0YS5fcGFzc3dvcmRfaGlzdG9yeSA9IG9sZFBhc3N3b3JkcztcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRlZmVyLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gUnVuIGFuIHVwZGF0ZVxuICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAgIC51cGRhdGUoXG4gICAgICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICAgICAgdGhpcy5xdWVyeSxcbiAgICAgICAgICB0aGlzLmRhdGEsXG4gICAgICAgICAgdGhpcy5ydW5PcHRpb25zLFxuICAgICAgICAgIGZhbHNlLFxuICAgICAgICAgIGZhbHNlLFxuICAgICAgICAgIHRoaXMudmFsaWRTY2hlbWFDb250cm9sbGVyXG4gICAgICAgIClcbiAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICB0aGlzLl90aHJvd0lmQXV0aERhdGFEdXBsaWNhdGUoZXJyb3IpO1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbihyZXNwb25zZSA9PiB7XG4gICAgICAgICAgcmVzcG9uc2UudXBkYXRlZEF0ID0gdGhpcy51cGRhdGVkQXQ7XG4gICAgICAgICAgdGhpcy5fdXBkYXRlUmVzcG9uc2VXaXRoRGF0YShyZXNwb25zZSwgdGhpcy5kYXRhKTtcbiAgICAgICAgICB0aGlzLnJlc3BvbnNlID0geyByZXNwb25zZSB9O1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBTZXQgdGhlIGRlZmF1bHQgQUNMIGFuZCBwYXNzd29yZCB0aW1lc3RhbXAgZm9yIHRoZSBuZXcgX1VzZXJcbiAgICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICAgIHZhciBBQ0wgPSB0aGlzLmRhdGEuQUNMO1xuICAgICAgLy8gZGVmYXVsdCBwdWJsaWMgci93IEFDTFxuICAgICAgaWYgKCFBQ0wpIHtcbiAgICAgICAgQUNMID0ge307XG4gICAgICAgIGlmICghdGhpcy5jb25maWcuZW5mb3JjZVByaXZhdGVVc2Vycykge1xuICAgICAgICAgIEFDTFsnKiddID0geyByZWFkOiB0cnVlLCB3cml0ZTogZmFsc2UgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gbWFrZSBzdXJlIHRoZSB1c2VyIGlzIG5vdCBsb2NrZWQgZG93blxuICAgICAgQUNMW3RoaXMuZGF0YS5vYmplY3RJZF0gPSB7IHJlYWQ6IHRydWUsIHdyaXRlOiB0cnVlIH07XG4gICAgICB0aGlzLmRhdGEuQUNMID0gQUNMO1xuICAgICAgLy8gcGFzc3dvcmQgdGltZXN0YW1wIHRvIGJlIHVzZWQgd2hlbiBwYXNzd29yZCBleHBpcnkgcG9saWN5IGlzIGVuZm9yY2VkXG4gICAgICBpZiAodGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kgJiYgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRBZ2UpIHtcbiAgICAgICAgdGhpcy5kYXRhLl9wYXNzd29yZF9jaGFuZ2VkX2F0ID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZSgpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSdW4gYSBjcmVhdGVcbiAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAgIC5jcmVhdGUodGhpcy5jbGFzc05hbWUsIHRoaXMuZGF0YSwgdGhpcy5ydW5PcHRpb25zLCBmYWxzZSwgdGhpcy52YWxpZFNjaGVtYUNvbnRyb2xsZXIpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicgfHwgZXJyb3IuY29kZSAhPT0gUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFKSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLl90aHJvd0lmQXV0aERhdGFEdXBsaWNhdGUoZXJyb3IpO1xuXG4gICAgICAgIC8vIFF1aWNrIGNoZWNrLCBpZiB3ZSB3ZXJlIGFibGUgdG8gaW5mZXIgdGhlIGR1cGxpY2F0ZWQgZmllbGQgbmFtZVxuICAgICAgICBpZiAoZXJyb3IgJiYgZXJyb3IudXNlckluZm8gJiYgZXJyb3IudXNlckluZm8uZHVwbGljYXRlZF9maWVsZCA9PT0gJ3VzZXJuYW1lJykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLlVTRVJOQU1FX1RBS0VOLFxuICAgICAgICAgICAgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgdXNlcm5hbWUuJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZXJyb3IgJiYgZXJyb3IudXNlckluZm8gJiYgZXJyb3IudXNlckluZm8uZHVwbGljYXRlZF9maWVsZCA9PT0gJ2VtYWlsJykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLkVNQUlMX1RBS0VOLFxuICAgICAgICAgICAgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgZW1haWwgYWRkcmVzcy4nXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIHRoaXMgd2FzIGEgZmFpbGVkIHVzZXIgY3JlYXRpb24gZHVlIHRvIHVzZXJuYW1lIG9yIGVtYWlsIGFscmVhZHkgdGFrZW4sIHdlIG5lZWQgdG9cbiAgICAgICAgLy8gY2hlY2sgd2hldGhlciBpdCB3YXMgdXNlcm5hbWUgb3IgZW1haWwgYW5kIHJldHVybiB0aGUgYXBwcm9wcmlhdGUgZXJyb3IuXG4gICAgICAgIC8vIEZhbGxiYWNrIHRvIHRoZSBvcmlnaW5hbCBtZXRob2RcbiAgICAgICAgLy8gVE9ETzogU2VlIGlmIHdlIGNhbiBsYXRlciBkbyB0aGlzIHdpdGhvdXQgYWRkaXRpb25hbCBxdWVyaWVzIGJ5IHVzaW5nIG5hbWVkIGluZGV4ZXMuXG4gICAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgICAgIC5maW5kKFxuICAgICAgICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHVzZXJuYW1lOiB0aGlzLmRhdGEudXNlcm5hbWUsXG4gICAgICAgICAgICAgIG9iamVjdElkOiB7ICRuZTogdGhpcy5vYmplY3RJZCgpIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgeyBsaW1pdDogMSB9XG4gICAgICAgICAgKVxuICAgICAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuVVNFUk5BTUVfVEFLRU4sXG4gICAgICAgICAgICAgICAgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgdXNlcm5hbWUuJ1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoXG4gICAgICAgICAgICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgICAgICAgICAgICB7IGVtYWlsOiB0aGlzLmRhdGEuZW1haWwsIG9iamVjdElkOiB7ICRuZTogdGhpcy5vYmplY3RJZCgpIH0gfSxcbiAgICAgICAgICAgICAgeyBsaW1pdDogMSB9XG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5FTUFJTF9UQUtFTixcbiAgICAgICAgICAgICAgICAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyBlbWFpbCBhZGRyZXNzLidcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLFxuICAgICAgICAgICAgICAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCdcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzcG9uc2UgPT4ge1xuICAgICAgICByZXNwb25zZS5vYmplY3RJZCA9IHRoaXMuZGF0YS5vYmplY3RJZDtcbiAgICAgICAgcmVzcG9uc2UuY3JlYXRlZEF0ID0gdGhpcy5kYXRhLmNyZWF0ZWRBdDtcblxuICAgICAgICBpZiAodGhpcy5yZXNwb25zZVNob3VsZEhhdmVVc2VybmFtZSkge1xuICAgICAgICAgIHJlc3BvbnNlLnVzZXJuYW1lID0gdGhpcy5kYXRhLnVzZXJuYW1lO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3VwZGF0ZVJlc3BvbnNlV2l0aERhdGEocmVzcG9uc2UsIHRoaXMuZGF0YSk7XG4gICAgICAgIHRoaXMucmVzcG9uc2UgPSB7XG4gICAgICAgICAgc3RhdHVzOiAyMDEsXG4gICAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgICAgbG9jYXRpb246IHRoaXMubG9jYXRpb24oKSxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICB9XG59O1xuXG4vLyBSZXR1cm5zIG5vdGhpbmcgLSBkb2Vzbid0IHdhaXQgZm9yIHRoZSB0cmlnZ2VyLlxuUmVzdFdyaXRlLnByb3RvdHlwZS5ydW5BZnRlclNhdmVUcmlnZ2VyID0gZnVuY3Rpb24gKCkge1xuICBpZiAoIXRoaXMucmVzcG9uc2UgfHwgIXRoaXMucmVzcG9uc2UucmVzcG9uc2UgfHwgdGhpcy5ydW5PcHRpb25zLm1hbnkpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBdm9pZCBkb2luZyBhbnkgc2V0dXAgZm9yIHRyaWdnZXJzIGlmIHRoZXJlIGlzIG5vICdhZnRlclNhdmUnIHRyaWdnZXIgZm9yIHRoaXMgY2xhc3MuXG4gIGNvbnN0IGhhc0FmdGVyU2F2ZUhvb2sgPSB0cmlnZ2Vycy50cmlnZ2VyRXhpc3RzKFxuICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyU2F2ZSxcbiAgICB0aGlzLmNvbmZpZy5hcHBsaWNhdGlvbklkXG4gICk7XG4gIGNvbnN0IGhhc0xpdmVRdWVyeSA9IHRoaXMuY29uZmlnLmxpdmVRdWVyeUNvbnRyb2xsZXIuaGFzTGl2ZVF1ZXJ5KHRoaXMuY2xhc3NOYW1lKTtcbiAgaWYgKCFoYXNBZnRlclNhdmVIb29rICYmICFoYXNMaXZlUXVlcnkpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBjb25zdCB7IG9yaWdpbmFsT2JqZWN0LCB1cGRhdGVkT2JqZWN0IH0gPSB0aGlzLmJ1aWxkUGFyc2VPYmplY3RzKCk7XG4gIHVwZGF0ZWRPYmplY3QuX2hhbmRsZVNhdmVSZXNwb25zZSh0aGlzLnJlc3BvbnNlLnJlc3BvbnNlLCB0aGlzLnJlc3BvbnNlLnN0YXR1cyB8fCAyMDApO1xuXG4gIGlmIChoYXNMaXZlUXVlcnkpIHtcbiAgICB0aGlzLmNvbmZpZy5kYXRhYmFzZS5sb2FkU2NoZW1hKCkudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHtcbiAgICAgIC8vIE5vdGlmeSBMaXZlUXVlcnlTZXJ2ZXIgaWYgcG9zc2libGVcbiAgICAgIGNvbnN0IHBlcm1zID0gc2NoZW1hQ29udHJvbGxlci5nZXRDbGFzc0xldmVsUGVybWlzc2lvbnModXBkYXRlZE9iamVjdC5jbGFzc05hbWUpO1xuICAgICAgdGhpcy5jb25maWcubGl2ZVF1ZXJ5Q29udHJvbGxlci5vbkFmdGVyU2F2ZShcbiAgICAgICAgdXBkYXRlZE9iamVjdC5jbGFzc05hbWUsXG4gICAgICAgIHVwZGF0ZWRPYmplY3QsXG4gICAgICAgIG9yaWdpbmFsT2JqZWN0LFxuICAgICAgICBwZXJtc1xuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuICBpZiAoIWhhc0FmdGVyU2F2ZUhvb2spIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbiAgLy8gUnVuIGFmdGVyU2F2ZSB0cmlnZ2VyXG4gIHJldHVybiB0cmlnZ2Vyc1xuICAgIC5tYXliZVJ1blRyaWdnZXIoXG4gICAgICB0cmlnZ2Vycy5UeXBlcy5hZnRlclNhdmUsXG4gICAgICB0aGlzLmF1dGgsXG4gICAgICB1cGRhdGVkT2JqZWN0LFxuICAgICAgb3JpZ2luYWxPYmplY3QsXG4gICAgICB0aGlzLmNvbmZpZyxcbiAgICAgIHRoaXMuY29udGV4dFxuICAgIClcbiAgICAudGhlbihyZXN1bHQgPT4ge1xuICAgICAgY29uc3QganNvblJldHVybmVkID0gcmVzdWx0ICYmICFyZXN1bHQuX3RvRnVsbEpTT047XG4gICAgICBpZiAoanNvblJldHVybmVkKSB7XG4gICAgICAgIHRoaXMucGVuZGluZ09wcy5vcGVyYXRpb25zID0ge307XG4gICAgICAgIHRoaXMucmVzcG9uc2UucmVzcG9uc2UgPSByZXN1bHQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlID0gdGhpcy5fdXBkYXRlUmVzcG9uc2VXaXRoRGF0YShcbiAgICAgICAgICAocmVzdWx0IHx8IHVwZGF0ZWRPYmplY3QpLnRvSlNPTigpLFxuICAgICAgICAgIHRoaXMuZGF0YVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0pXG4gICAgLmNhdGNoKGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdhZnRlclNhdmUgY2F1Z2h0IGFuIGVycm9yJywgZXJyKTtcbiAgICB9KTtcbn07XG5cbi8vIEEgaGVscGVyIHRvIGZpZ3VyZSBvdXQgd2hhdCBsb2NhdGlvbiB0aGlzIG9wZXJhdGlvbiBoYXBwZW5zIGF0LlxuUmVzdFdyaXRlLnByb3RvdHlwZS5sb2NhdGlvbiA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIG1pZGRsZSA9IHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInID8gJy91c2Vycy8nIDogJy9jbGFzc2VzLycgKyB0aGlzLmNsYXNzTmFtZSArICcvJztcbiAgY29uc3QgbW91bnQgPSB0aGlzLmNvbmZpZy5tb3VudCB8fCB0aGlzLmNvbmZpZy5zZXJ2ZXJVUkw7XG4gIHJldHVybiBtb3VudCArIG1pZGRsZSArIHRoaXMuZGF0YS5vYmplY3RJZDtcbn07XG5cbi8vIEEgaGVscGVyIHRvIGdldCB0aGUgb2JqZWN0IGlkIGZvciB0aGlzIG9wZXJhdGlvbi5cbi8vIEJlY2F1c2UgaXQgY291bGQgYmUgZWl0aGVyIG9uIHRoZSBxdWVyeSBvciBvbiB0aGUgZGF0YVxuUmVzdFdyaXRlLnByb3RvdHlwZS5vYmplY3RJZCA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHRoaXMuZGF0YS5vYmplY3RJZCB8fCB0aGlzLnF1ZXJ5Lm9iamVjdElkO1xufTtcblxuLy8gUmV0dXJucyBhIGNvcHkgb2YgdGhlIGRhdGEgYW5kIGRlbGV0ZSBiYWQga2V5cyAoX2F1dGhfZGF0YSwgX2hhc2hlZF9wYXNzd29yZC4uLilcblJlc3RXcml0ZS5wcm90b3R5cGUuc2FuaXRpemVkRGF0YSA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgZGF0YSA9IE9iamVjdC5rZXlzKHRoaXMuZGF0YSkucmVkdWNlKChkYXRhLCBrZXkpID0+IHtcbiAgICAvLyBSZWdleHAgY29tZXMgZnJvbSBQYXJzZS5PYmplY3QucHJvdG90eXBlLnZhbGlkYXRlXG4gICAgaWYgKCEvXltBLVphLXpdWzAtOUEtWmEtel9dKiQvLnRlc3Qoa2V5KSkge1xuICAgICAgZGVsZXRlIGRhdGFba2V5XTtcbiAgICB9XG4gICAgcmV0dXJuIGRhdGE7XG4gIH0sIHN0cnVjdHVyZWRDbG9uZSh0aGlzLmRhdGEpKTtcbiAgcmV0dXJuIFBhcnNlLl9kZWNvZGUodW5kZWZpbmVkLCBkYXRhKTtcbn07XG5cbi8vIFJldHVybnMgYW4gdXBkYXRlZCBjb3B5IG9mIHRoZSBvYmplY3RcblJlc3RXcml0ZS5wcm90b3R5cGUuYnVpbGRQYXJzZU9iamVjdHMgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IGV4dHJhRGF0YSA9IHsgY2xhc3NOYW1lOiB0aGlzLmNsYXNzTmFtZSwgb2JqZWN0SWQ6IHRoaXMucXVlcnk/Lm9iamVjdElkIH07XG4gIGxldCBvcmlnaW5hbE9iamVjdDtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIG9yaWdpbmFsT2JqZWN0ID0gdHJpZ2dlcnMuaW5mbGF0ZShleHRyYURhdGEsIHRoaXMub3JpZ2luYWxEYXRhKTtcbiAgfVxuXG4gIGNvbnN0IGNsYXNzTmFtZSA9IFBhcnNlLk9iamVjdC5mcm9tSlNPTihleHRyYURhdGEpO1xuICBjb25zdCByZWFkT25seUF0dHJpYnV0ZXMgPSBjbGFzc05hbWUuY29uc3RydWN0b3IucmVhZE9ubHlBdHRyaWJ1dGVzXG4gICAgPyBjbGFzc05hbWUuY29uc3RydWN0b3IucmVhZE9ubHlBdHRyaWJ1dGVzKClcbiAgICA6IFtdO1xuXG4gIC8vIEZvciBfUm9sZSBjbGFzcywgJ25hbWUnIGNhbm5vdCBiZSBzZXQgYWZ0ZXIgdGhlIHJvbGUgaGFzIGFuIG9iamVjdElkLlxuICAvLyBJbiBhZnRlclNhdmUgY29udGV4dCwgX2hhbmRsZVNhdmVSZXNwb25zZSBoYXMgYWxyZWFkeSBzZXQgdGhlIG9iamVjdElkLFxuICAvLyBzbyB3ZSB0cmVhdCAnbmFtZScgYXMgcmVhZC1vbmx5IHRvIGF2b2lkIFBhcnNlIFNESyB2YWxpZGF0aW9uIGVycm9ycy5cbiAgY29uc3QgaXNSb2xlQWZ0ZXJTYXZlID0gdGhpcy5jbGFzc05hbWUgPT09ICdfUm9sZScgJiYgdGhpcy5yZXNwb25zZSAmJiAhdGhpcy5xdWVyeTtcbiAgaWYgKGlzUm9sZUFmdGVyU2F2ZSAmJiB0aGlzLmRhdGEubmFtZSAmJiAhcmVhZE9ubHlBdHRyaWJ1dGVzLmluY2x1ZGVzKCduYW1lJykpIHtcbiAgICByZWFkT25seUF0dHJpYnV0ZXMucHVzaCgnbmFtZScpO1xuICB9XG4gIGlmICghdGhpcy5vcmlnaW5hbERhdGEpIHtcbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiByZWFkT25seUF0dHJpYnV0ZXMpIHtcbiAgICAgIGV4dHJhRGF0YVthdHRyaWJ1dGVdID0gdGhpcy5kYXRhW2F0dHJpYnV0ZV07XG4gICAgfVxuICB9XG4gIGNvbnN0IHVwZGF0ZWRPYmplY3QgPSB0cmlnZ2Vycy5pbmZsYXRlKGV4dHJhRGF0YSwgdGhpcy5vcmlnaW5hbERhdGEpO1xuICBPYmplY3Qua2V5cyh0aGlzLmRhdGEpLnJlZHVjZShmdW5jdGlvbiAoZGF0YSwga2V5KSB7XG4gICAgaWYgKGtleS5pbmRleE9mKCcuJykgPiAwKSB7XG4gICAgICBpZiAodHlwZW9mIGRhdGFba2V5XS5fX29wID09PSAnc3RyaW5nJykge1xuICAgICAgICBpZiAoIXJlYWRPbmx5QXR0cmlidXRlcy5pbmNsdWRlcyhrZXkpKSB7XG4gICAgICAgICAgdXBkYXRlZE9iamVjdC5zZXQoa2V5LCBkYXRhW2tleV0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBzdWJkb2N1bWVudCBrZXkgd2l0aCBkb3Qgbm90YXRpb24geyAneC55JzogdiB9ID0+IHsgJ3gnOiB7ICd5JyA6IHYgfSB9KVxuICAgICAgICBjb25zdCBzcGxpdHRlZEtleSA9IGtleS5zcGxpdCgnLicpO1xuICAgICAgICBjb25zdCBwYXJlbnRQcm9wID0gc3BsaXR0ZWRLZXlbMF07XG4gICAgICAgIGxldCBwYXJlbnRWYWwgPSB1cGRhdGVkT2JqZWN0LmdldChwYXJlbnRQcm9wKTtcbiAgICAgICAgaWYgKHR5cGVvZiBwYXJlbnRWYWwgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgcGFyZW50VmFsID0ge307XG4gICAgICAgIH1cbiAgICAgICAgcGFyZW50VmFsW3NwbGl0dGVkS2V5WzFdXSA9IGRhdGFba2V5XTtcbiAgICAgICAgdXBkYXRlZE9iamVjdC5zZXQocGFyZW50UHJvcCwgcGFyZW50VmFsKTtcbiAgICAgIH1cbiAgICAgIGRlbGV0ZSBkYXRhW2tleV07XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9LCBzdHJ1Y3R1cmVkQ2xvbmUodGhpcy5kYXRhKSk7XG5cbiAgY29uc3Qgc2FuaXRpemVkID0gdGhpcy5zYW5pdGl6ZWREYXRhKCk7XG4gIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIHJlYWRPbmx5QXR0cmlidXRlcykge1xuICAgIGRlbGV0ZSBzYW5pdGl6ZWRbYXR0cmlidXRlXTtcbiAgfVxuICB1cGRhdGVkT2JqZWN0LnNldChzYW5pdGl6ZWQpO1xuICByZXR1cm4geyB1cGRhdGVkT2JqZWN0LCBvcmlnaW5hbE9iamVjdCB9O1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5jbGVhblVzZXJBdXRoRGF0YSA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UgJiYgdGhpcy5yZXNwb25zZS5yZXNwb25zZSAmJiB0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIGNvbnN0IHVzZXIgPSB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlO1xuICAgIGlmICh1c2VyLmF1dGhEYXRhKSB7XG4gICAgICBPYmplY3Qua2V5cyh1c2VyLmF1dGhEYXRhKS5mb3JFYWNoKHByb3ZpZGVyID0+IHtcbiAgICAgICAgaWYgKHVzZXIuYXV0aERhdGFbcHJvdmlkZXJdID09PSBudWxsKSB7XG4gICAgICAgICAgZGVsZXRlIHVzZXIuYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGlmIChPYmplY3Qua2V5cyh1c2VyLmF1dGhEYXRhKS5sZW5ndGggPT0gMCkge1xuICAgICAgICBkZWxldGUgdXNlci5hdXRoRGF0YTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbi8vIFN0cmlwcyBwcm90ZWN0ZWQgZmllbGRzIGZyb20gdGhlIHdyaXRlIHJlc3BvbnNlIHdoZW4gcHJvdGVjdGVkRmllbGRzU2F2ZVJlc3BvbnNlRXhlbXB0IGlzIGZhbHNlLlxuUmVzdFdyaXRlLnByb3RvdHlwZS5maWx0ZXJQcm90ZWN0ZWRGaWVsZHNJblJlc3BvbnNlID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5jb25maWcucHJvdGVjdGVkRmllbGRzU2F2ZVJlc3BvbnNlRXhlbXB0ICE9PSBmYWxzZSkge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5hdXRoLmlzTWFzdGVyIHx8IHRoaXMuYXV0aC5pc01haW50ZW5hbmNlKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdGhpcy5yZXNwb25zZSB8fCAhdGhpcy5yZXNwb25zZS5yZXNwb25zZSkge1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzY2hlbWFDb250cm9sbGVyID0gYXdhaXQgdGhpcy5jb25maWcuZGF0YWJhc2UubG9hZFNjaGVtYSgpO1xuICBjb25zdCBwcm90ZWN0ZWRGaWVsZHMgPSB0aGlzLmNvbmZpZy5kYXRhYmFzZS5hZGRQcm90ZWN0ZWRGaWVsZHMoXG4gICAgc2NoZW1hQ29udHJvbGxlcixcbiAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICB0aGlzLnF1ZXJ5ID8geyBvYmplY3RJZDogdGhpcy5xdWVyeS5vYmplY3RJZCB9IDoge30sXG4gICAgdGhpcy5hdXRoLnVzZXIgPyBbdGhpcy5hdXRoLnVzZXIuaWRdLmNvbmNhdCh0aGlzLmF1dGgudXNlclJvbGVzIHx8IFtdKSA6IFtdLFxuICAgIHRoaXMuYXV0aCxcbiAgICB7fVxuICApO1xuICBpZiAoIXByb3RlY3RlZEZpZWxkcykge1xuICAgIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IGZpZWxkIG9mIHByb3RlY3RlZEZpZWxkcykge1xuICAgIGRlbGV0ZSB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlW2ZpZWxkXTtcbiAgfVxufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdXBkYXRlUmVzcG9uc2VXaXRoRGF0YSA9IGZ1bmN0aW9uIChyZXNwb25zZSwgZGF0YSkge1xuICBjb25zdCBzdGF0ZUNvbnRyb2xsZXIgPSBQYXJzZS5Db3JlTWFuYWdlci5nZXRPYmplY3RTdGF0ZUNvbnRyb2xsZXIoKTtcbiAgY29uc3QgW3BlbmRpbmddID0gc3RhdGVDb250cm9sbGVyLmdldFBlbmRpbmdPcHModGhpcy5wZW5kaW5nT3BzLmlkZW50aWZpZXIpO1xuICBmb3IgKGNvbnN0IGtleSBpbiB0aGlzLnBlbmRpbmdPcHMub3BlcmF0aW9ucykge1xuICAgIGlmICghcGVuZGluZ1trZXldKSB7XG4gICAgICBkYXRhW2tleV0gPSB0aGlzLm9yaWdpbmFsRGF0YSA/IHRoaXMub3JpZ2luYWxEYXRhW2tleV0gOiB7IF9fb3A6ICdEZWxldGUnIH07XG4gICAgICB0aGlzLnN0b3JhZ2UuZmllbGRzQ2hhbmdlZEJ5VHJpZ2dlci5wdXNoKGtleSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IHNraXBLZXlzID0gWy4uLihyZXF1aXJlZENvbHVtbnMucmVhZFt0aGlzLmNsYXNzTmFtZV0gfHwgW10pXTtcbiAgaWYgKCF0aGlzLnF1ZXJ5KSB7XG4gICAgc2tpcEtleXMucHVzaCgnb2JqZWN0SWQnLCAnY3JlYXRlZEF0Jyk7XG4gIH0gZWxzZSB7XG4gICAgc2tpcEtleXMucHVzaCgndXBkYXRlZEF0Jyk7XG4gICAgZGVsZXRlIHJlc3BvbnNlLm9iamVjdElkO1xuICB9XG4gIGZvciAoY29uc3Qga2V5IGluIHJlc3BvbnNlKSB7XG4gICAgaWYgKHNraXBLZXlzLmluY2x1ZGVzKGtleSkpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCB2YWx1ZSA9IHJlc3BvbnNlW2tleV07XG4gICAgaWYgKFxuICAgICAgdmFsdWUgPT0gbnVsbCB8fFxuICAgICAgKHZhbHVlLl9fdHlwZSAmJiB2YWx1ZS5fX3R5cGUgPT09ICdQb2ludGVyJykgfHxcbiAgICAgIHV0aWwuaXNEZWVwU3RyaWN0RXF1YWwoZGF0YVtrZXldLCB2YWx1ZSkgfHxcbiAgICAgIHV0aWwuaXNEZWVwU3RyaWN0RXF1YWwoKHRoaXMub3JpZ2luYWxEYXRhIHx8IHt9KVtrZXldLCB2YWx1ZSlcbiAgICApIHtcbiAgICAgIGRlbGV0ZSByZXNwb25zZVtrZXldO1xuICAgIH1cbiAgfVxuICBpZiAoXy5pc0VtcHR5KHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyKSkge1xuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuICBjb25zdCBjbGllbnRTdXBwb3J0c0RlbGV0ZSA9IENsaWVudFNESy5zdXBwb3J0c0ZvcndhcmREZWxldGUodGhpcy5jbGllbnRTREspO1xuICB0aGlzLnN0b3JhZ2UuZmllbGRzQ2hhbmdlZEJ5VHJpZ2dlci5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgY29uc3QgZGF0YVZhbHVlID0gZGF0YVtmaWVsZE5hbWVdO1xuXG4gICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocmVzcG9uc2UsIGZpZWxkTmFtZSkpIHtcbiAgICAgIHJlc3BvbnNlW2ZpZWxkTmFtZV0gPSBkYXRhVmFsdWU7XG4gICAgfVxuXG4gICAgLy8gU3RyaXBzIG9wZXJhdGlvbnMgZnJvbSByZXNwb25zZXNcbiAgICBpZiAocmVzcG9uc2VbZmllbGROYW1lXSAmJiByZXNwb25zZVtmaWVsZE5hbWVdLl9fb3ApIHtcbiAgICAgIGRlbGV0ZSByZXNwb25zZVtmaWVsZE5hbWVdO1xuICAgICAgaWYgKGNsaWVudFN1cHBvcnRzRGVsZXRlICYmIGRhdGFWYWx1ZS5fX29wID09ICdEZWxldGUnKSB7XG4gICAgICAgIHJlc3BvbnNlW2ZpZWxkTmFtZV0gPSBkYXRhVmFsdWU7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIHJlc3BvbnNlO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgUmVzdFdyaXRlO1xubW9kdWxlLmV4cG9ydHMgPSBSZXN0V3JpdGU7XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQWNBLElBQUFBLFVBQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLE9BQUEsR0FBQUYsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFFLE9BQUEsR0FBQUgsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFHLGlCQUFBLEdBQUFILE9BQUE7QUFDQSxJQUFBSSxNQUFBLEdBQUFKLE9BQUE7QUFDQSxJQUFBSyxhQUFBLEdBQUFMLE9BQUE7QUFDQSxJQUFBTSxpQkFBQSxHQUFBQyx1QkFBQSxDQUFBUCxPQUFBO0FBQXlELFNBQUFPLHdCQUFBQyxDQUFBLEVBQUFDLENBQUEsNkJBQUFDLE9BQUEsTUFBQUMsQ0FBQSxPQUFBRCxPQUFBLElBQUFFLENBQUEsT0FBQUYsT0FBQSxZQUFBSCx1QkFBQSxZQUFBQSxDQUFBQyxDQUFBLEVBQUFDLENBQUEsU0FBQUEsQ0FBQSxJQUFBRCxDQUFBLElBQUFBLENBQUEsQ0FBQUssVUFBQSxTQUFBTCxDQUFBLE1BQUFNLENBQUEsRUFBQUMsQ0FBQSxFQUFBQyxD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