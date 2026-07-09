"use strict";

var _util = require("util");
var _triggers = require("./triggers");
var _logger = require("./logger");
var _lruCache = require("lru-cache");
var _RestQuery = _interopRequireDefault(require("./RestQuery"));
var _RestWrite = _interopRequireDefault(require("./RestWrite"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const Parse = require('parse/node');
// An Auth object tells you who is requesting something and whether
// the master key was used.
// userObject is a Parse.User and can be null if there's no user.
function Auth({
  config,
  cacheController = undefined,
  isMaster = false,
  isMaintenance = false,
  isReadOnly = false,
  user,
  installationId
}) {
  this.config = config;
  this.cacheController = cacheController || config && config.cacheController;
  this.installationId = installationId;
  this.isMaster = isMaster;
  this.isMaintenance = isMaintenance;
  this.user = user;
  this.isReadOnly = isReadOnly;

  // Assuming a users roles won't change during a single request, we'll
  // only load them once.
  this.userRoles = [];
  this.fetchedRoles = false;
  this.rolePromise = null;
}

// Whether this auth could possibly modify the given user id.
// It still could be forbidden via ACLs even if this returns true.
Auth.prototype.isUnauthenticated = function () {
  if (this.isMaster) {
    return false;
  }
  if (this.isMaintenance) {
    return false;
  }
  if (this.user) {
    return false;
  }
  return true;
};

// A helper to get a master-level Auth object
function master(config) {
  return new Auth({
    config,
    isMaster: true
  });
}

// A helper to get a maintenance-level Auth object
function maintenance(config) {
  return new Auth({
    config,
    isMaintenance: true
  });
}

// A helper to get a master-level Auth object
function readOnly(config) {
  return new Auth({
    config,
    isMaster: true,
    isReadOnly: true
  });
}

// A helper to get a nobody-level Auth object
function nobody(config) {
  return new Auth({
    config,
    isMaster: false
  });
}
const throttle = new _lruCache.LRUCache({
  max: 10000,
  ttl: 500
});
/**
 * Checks whether session should be updated based on last update time & session length.
 */
function shouldUpdateSessionExpiry(config, session) {
  const resetAfter = config.sessionLength / 2;
  const lastUpdated = new Date(session?.updatedAt);
  const skipRange = new Date();
  skipRange.setTime(skipRange.getTime() - resetAfter * 1000);
  return lastUpdated <= skipRange;
}
const renewSessionIfNeeded = async ({
  config,
  session,
  sessionToken
}) => {
  if (!config?.extendSessionOnUse) {
    return;
  }
  if (throttle.get(sessionToken)) {
    return;
  }
  throttle.set(sessionToken, true);
  try {
    if (!session) {
      const query = await (0, _RestQuery.default)({
        method: _RestQuery.default.Method.get,
        config,
        auth: master(config),
        runBeforeFind: false,
        className: '_Session',
        restWhere: {
          sessionToken
        },
        restOptions: {
          limit: 1
        }
      });
      const {
        results
      } = await query.execute();
      session = results[0];
    }
    if (!shouldUpdateSessionExpiry(config, session) || !session) {
      return;
    }
    const expiresAt = config.generateSessionExpiresAt();
    await new _RestWrite.default(config, master(config), '_Session', {
      objectId: session.objectId
    }, {
      expiresAt: Parse._encode(expiresAt)
    }).execute();
  } catch (e) {
    if (e?.code !== Parse.Error.OBJECT_NOT_FOUND) {
      _logger.logger.error('Could not update session expiry: ', e);
    }
  }
};

// Returns a promise that resolves to an Auth object
const getAuthForSessionToken = async function ({
  config,
  cacheController,
  sessionToken,
  installationId
}) {
  cacheController = cacheController || config && config.cacheController;
  if (cacheController) {
    const cached = await cacheController.user.get(sessionToken);
    if (cached) {
      const {
        expiresAt: cachedExpiresAt,
        ...userJSON
      } = cached;
      if (cachedExpiresAt && new Date(cachedExpiresAt) < new Date()) {
        cacheController.user.del(sessionToken);
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Session token is expired.');
      }
      const cachedUser = Parse.Object.fromJSON(userJSON);
      renewSessionIfNeeded({
        config,
        sessionToken
      });
      return Promise.resolve(new Auth({
        config,
        cacheController,
        isMaster: false,
        installationId,
        user: cachedUser
      }));
    }
  }
  let results;
  if (config) {
    const restOptions = {
      limit: 1,
      include: 'user'
    };
    const RestQuery = require('./RestQuery');
    const query = await RestQuery({
      method: RestQuery.Method.get,
      config,
      runBeforeFind: false,
      auth: master(config),
      className: '_Session',
      restWhere: {
        sessionToken
      },
      restOptions
    });
    results = (await query.execute()).results;
  } else {
    results = (await new Parse.Query(Parse.Session).limit(1).include('user').equalTo('sessionToken', sessionToken).find({
      useMasterKey: true
    })).map(obj => obj.toJSON());
  }
  if (results.length !== 1 || !results[0]['user']) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
  }
  const session = results[0];
  const now = new Date(),
    expiresAt = session.expiresAt ? new Date(session.expiresAt.iso) : undefined;
  if (expiresAt < now) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Session token is expired.');
  }
  const obj = session.user;
  if (typeof obj['objectId'] === 'string' && obj['objectId'].startsWith('role:')) {
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Invalid object ID.');
  }
  delete obj.password;
  obj['className'] = '_User';
  obj['sessionToken'] = sessionToken;
  if (cacheController) {
    cacheController.user.put(sessionToken, {
      ...obj,
      expiresAt: expiresAt?.toISOString()
    });
  }
  renewSessionIfNeeded({
    config,
    session,
    sessionToken
  });
  const userObject = Parse.Object.fromJSON(obj);
  return new Auth({
    config,
    cacheController,
    isMaster: false,
    installationId,
    user: userObject
  });
};
var getAuthForLegacySessionToken = async function ({
  config,
  sessionToken,
  installationId
}) {
  var restOptions = {
    limit: 1
  };
  const RestQuery = require('./RestQuery');
  var query = await RestQuery({
    method: RestQuery.Method.get,
    config,
    runBeforeFind: false,
    auth: master(config),
    className: '_User',
    restWhere: {
      _session_token: sessionToken
    },
    restOptions
  });
  return query.execute().then(response => {
    var results = response.results;
    if (results.length !== 1) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'invalid legacy session token');
    }
    const obj = results[0];
    if (typeof obj['objectId'] === 'string' && obj['objectId'].startsWith('role:')) {
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Invalid object ID.');
    }
    obj.className = '_User';
    const userObject = Parse.Object.fromJSON(obj);
    return new Auth({
      config,
      isMaster: false,
      installationId,
      user: userObject
    });
  });
};

// Returns a promise that resolves to an array of role names
Auth.prototype.getUserRoles = function () {
  if (this.isMaster || this.isMaintenance || !this.user) {
    return Promise.resolve([]);
  }
  if (this.fetchedRoles) {
    return Promise.resolve(this.userRoles);
  }
  if (this.rolePromise) {
    return this.rolePromise;
  }
  this.rolePromise = this._loadRoles();
  return this.rolePromise;
};
Auth.prototype.getRolesForUser = async function () {
  //Stack all Parse.Role
  const results = [];
  if (this.config) {
    const restWhere = {
      users: {
        __type: 'Pointer',
        className: '_User',
        objectId: this.user.id
      }
    };
    const RestQuery = require('./RestQuery');
    const query = await RestQuery({
      method: RestQuery.Method.find,
      runBeforeFind: false,
      config: this.config,
      auth: master(this.config),
      className: '_Role',
      restWhere
    });
    await query.each(result => results.push(result));
  } else {
    await new Parse.Query(Parse.Role).equalTo('users', this.user).each(result => results.push(result.toJSON()), {
      useMasterKey: true
    });
  }
  return results;
};

// Iterates through the role tree and compiles a user's roles
Auth.prototype._loadRoles = async function () {
  if (this.cacheController) {
    const cachedRoles = await this.cacheController.role.get(this.user.id);
    if (cachedRoles != null) {
      this.fetchedRoles = true;
      this.userRoles = cachedRoles;
      return cachedRoles;
    }
  }

  // First get the role ids this user is directly a member of
  const results = await this.getRolesForUser();
  if (!results.length) {
    this.userRoles = [];
    this.fetchedRoles = true;
    this.rolePromise = null;
    this.cacheRoles();
    return this.userRoles;
  }
  const rolesMap = results.reduce((m, r) => {
    m.names.push(r.name);
    m.ids.push(r.objectId);
    return m;
  }, {
    ids: [],
    names: []
  });

  // run the recursive finding
  const roleNames = await this._getAllRolesNamesForRoleIds(rolesMap.ids, rolesMap.names);
  this.userRoles = roleNames.map(r => {
    return 'role:' + r;
  });
  this.fetchedRoles = true;
  this.rolePromise = null;
  this.cacheRoles();
  return this.userRoles;
};
Auth.prototype.cacheRoles = function () {
  if (!this.cacheController) {
    return false;
  }
  this.cacheController.role.put(this.user.id, Array(...this.userRoles));
  return true;
};
Auth.prototype.clearRoleCache = function (sessionToken) {
  if (!this.cacheController) {
    return false;
  }
  this.cacheController.role.del(this.user.id);
  this.cacheController.user.del(sessionToken);
  return true;
};
Auth.prototype.getRolesByIds = async function (ins) {
  const results = [];
  // Build an OR query across all parentRoles
  if (!this.config) {
    await new Parse.Query(Parse.Role).containedIn('roles', ins.map(id => {
      const role = new Parse.Object(Parse.Role);
      role.id = id;
      return role;
    })).each(result => results.push(result.toJSON()), {
      useMasterKey: true
    });
  } else {
    const roles = ins.map(id => {
      return {
        __type: 'Pointer',
        className: '_Role',
        objectId: id
      };
    });
    const restWhere = {
      roles: {
        $in: roles
      }
    };
    const RestQuery = require('./RestQuery');
    const query = await RestQuery({
      method: RestQuery.Method.find,
      config: this.config,
      runBeforeFind: false,
      auth: master(this.config),
      className: '_Role',
      restWhere
    });
    await query.each(result => results.push(result));
  }
  return results;
};

// Given a list of roleIds, find all the parent roles, returns a promise with all names
Auth.prototype._getAllRolesNamesForRoleIds = function (roleIDs, names = [], queriedRoles = {}) {
  const ins = roleIDs.filter(roleID => {
    const wasQueried = queriedRoles[roleID] !== true;
    queriedRoles[roleID] = true;
    return wasQueried;
  });

  // all roles are accounted for, return the names
  if (ins.length == 0) {
    return Promise.resolve([...new Set(names)]);
  }
  return this.getRolesByIds(ins).then(results => {
    // Nothing found
    if (!results.length) {
      return Promise.resolve(names);
    }
    // Map the results with all Ids and names
    const resultMap = results.reduce((memo, role) => {
      memo.names.push(role.name);
      memo.ids.push(role.objectId);
      return memo;
    }, {
      ids: [],
      names: []
    });
    // store the new found names
    names = names.concat(resultMap.names);
    // find the next ones, circular roles will be cut
    return this._getAllRolesNamesForRoleIds(resultMap.ids, names, queriedRoles);
  }).then(names => {
    return Promise.resolve([...new Set(names)]);
  });
};
const findUsersWithAuthData = async (config, authData, beforeFind, currentUserAuthData) => {
  const providers = Object.keys(authData);
  const queries = await Promise.all(providers.map(async provider => {
    const providerAuthData = authData[provider];

    // Skip providers being unlinked (null value)
    if (providerAuthData === null) {
      return null;
    }

    // Skip beforeFind only when incoming data is confirmed unchanged from stored data.
    // This handles echoed-back authData from afterFind (e.g. client sends back { id: 'x' }
    // alongside a provider unlink). On login/signup, currentUserAuthData is undefined so
    // beforeFind always runs, preserving it as the security gate for missing credentials.
    const storedProviderData = currentUserAuthData?.[provider];
    const incomingKeys = Object.keys(providerAuthData || {});
    const isUnchanged = storedProviderData && incomingKeys.length > 0 && !incomingKeys.some(key => !(0, _util.isDeepStrictEqual)(providerAuthData[key], storedProviderData[key]));
    const validatorConfig = config.authDataManager.getValidatorForProvider(provider);
    // Skip database query for unconfigured providers to avoid unindexed collection scans;
    // the provider will be rejected later in handleAuthDataValidation with UNSUPPORTED_SERVICE
    if (!validatorConfig?.validator) {
      return null;
    }
    const adapter = validatorConfig.adapter;
    if (beforeFind && typeof adapter?.beforeFind === 'function' && !isUnchanged) {
      await adapter.beforeFind(providerAuthData);
    }
    if (!providerAuthData?.id) {
      return null;
    }
    if (typeof providerAuthData.id !== 'string') {
      throw new Parse.Error(Parse.Error.INVALID_VALUE, `Invalid authData id for provider '${provider}'.`);
    }
    return {
      [`authData.${provider}.id`]: providerAuthData.id
    };
  }));

  // Filter out null queries
  const validQueries = queries.filter(query => query !== null);
  if (!validQueries.length) {
    return [];
  }

  // Perform database query
  return config.database.find('_User', {
    $or: validQueries
  }, {
    limit: 2
  });
};
const hasMutatedAuthData = (authData, userAuthData) => {
  if (!userAuthData) {
    return {
      hasMutatedAuthData: true,
      mutatedAuthData: authData
    };
  }
  const mutatedAuthData = {};
  Object.keys(authData).forEach(provider => {
    // Anonymous provider is not handled this way
    if (provider === 'anonymous') {
      return;
    }
    const providerData = authData[provider];
    const userProviderAuthData = userAuthData[provider];

    // If unlinking (setting to null), consider it mutated
    if (providerData === null) {
      mutatedAuthData[provider] = providerData;
      return;
    }

    // If provider doesn't exist in stored data, it's new
    if (!userProviderAuthData) {
      mutatedAuthData[provider] = providerData;
      return;
    }

    // Check if incoming data represents actual changes vs just echoing back
    // what afterFind returned. If incoming data is a subset of stored data
    // (all incoming fields match stored values), it's not mutated.
    // If incoming data has different values or fields not in stored data, it's mutated.
    // This handles the case where afterFind strips sensitive fields like 'code':
    // - Incoming: { id: 'x' }, Stored: { id: 'x', code: 'secret' } -> NOT mutated (subset)
    // - Incoming: { id: 'x', token: 'new' }, Stored: { id: 'x', token: 'old' } -> MUTATED
    const incomingKeys = Object.keys(providerData || {});
    const hasChanges = incomingKeys.some(key => {
      return !(0, _util.isDeepStrictEqual)(providerData[key], userProviderAuthData[key]);
    });
    if (hasChanges) {
      mutatedAuthData[provider] = providerData;
    }
  });
  const hasMutatedAuthData = Object.keys(mutatedAuthData).length !== 0;
  return {
    hasMutatedAuthData,
    mutatedAuthData
  };
};
const checkIfUserHasProvidedConfiguredProvidersForLogin = (req = {}, authData = {}, userAuthData = {}, config) => {
  const savedUserProviders = Object.keys(userAuthData).map(provider => {
    const validator = config.authDataManager.getValidatorForProvider(provider);
    if (!validator || !validator.adapter) {
      return null;
    }
    return {
      name: provider,
      adapter: validator.adapter
    };
  }).filter(Boolean);
  const hasProvidedASoloProvider = savedUserProviders.some(provider => provider && provider.adapter && provider.adapter.policy === 'solo' && authData[provider.name]);

  // Solo providers can be considered as safe, so we do not have to check if the user needs
  // to provide an additional provider to login. An auth adapter with "solo" (like webauthn) means
  // no "additional" auth needs to be provided to login (like OTP, MFA)
  if (hasProvidedASoloProvider) {
    return;
  }
  const additionProvidersNotFound = [];
  const hasProvidedAtLeastOneAdditionalProvider = savedUserProviders.some(provider => {
    let policy = provider.adapter.policy;
    if (typeof policy === 'function') {
      const requestObject = {
        ip: req.config.ip,
        user: req.auth.user,
        master: req.auth.isMaster
      };
      policy = policy.call(provider.adapter, requestObject, userAuthData[provider.name]);
    }
    if (policy === 'additional') {
      if (authData[provider.name]) {
        return true;
      } else {
        // Push missing provider for error message
        additionProvidersNotFound.push(provider.name);
      }
    }
  });
  if (hasProvidedAtLeastOneAdditionalProvider || !additionProvidersNotFound.length) {
    return;
  }
  throw new Parse.Error(Parse.Error.OTHER_CAUSE, `Missing additional authData ${additionProvidersNotFound.join(',')}`);
};

// Validate each authData step-by-step and return the provider responses
const handleAuthDataValidation = async (authData, req, foundUser) => {
  let user;
  if (foundUser) {
    user = Parse.User.fromJSON({
      className: '_User',
      ...foundUser
    });
    // Find user by session and current objectId; only pass user if it's the current user or master key is provided
  } else if (req.auth && req.auth.user && typeof req.getUserId === 'function' && req.getUserId() === req.auth.user.id || req.auth && req.auth.isMaster && typeof req.getUserId === 'function' && req.getUserId()) {
    user = new Parse.User();
    user.id = req.auth.isMaster ? req.getUserId() : req.auth.user.id;
    await user.fetch({
      useMasterKey: true
    });
  }
  const {
    updatedObject
  } = req.buildParseObjects();
  const requestObject = (0, _triggers.getRequestObject)(undefined, req.auth, updatedObject, user, req.config);
  // Perform validation as step-by-step pipeline for better error consistency
  // and also to avoid to trigger a provider (like OTP SMS) if another one fails
  const acc = {
    authData: {},
    authDataResponse: {}
  };
  const authKeys = Object.keys(authData).sort();
  for (const provider of authKeys) {
    let method = '';
    try {
      if (authData[provider] === null) {
        acc.authData[provider] = null;
        continue;
      }
      const {
        validator
      } = req.config.authDataManager.getValidatorForProvider(provider) || {};
      const authProvider = (req.config.auth || {})[provider] || {};
      if (!validator || authProvider.enabled === false) {
        throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
      }
      let validationResult = await validator(authData[provider], req, user, requestObject);
      method = validationResult && validationResult.method;
      requestObject.triggerName = method;
      if (validationResult && validationResult.validator) {
        validationResult = await validationResult.validator();
      }
      if (!validationResult) {
        acc.authData[provider] = authData[provider];
        continue;
      }
      if (!Object.keys(validationResult).length) {
        acc.authData[provider] = authData[provider];
        continue;
      }
      if (validationResult.response) {
        acc.authDataResponse[provider] = validationResult.response;
      }
      // Some auth providers after initialization will avoid to replace authData already stored
      if (!validationResult.doNotSave) {
        acc.authData[provider] = validationResult.save || authData[provider];
      }
    } catch (err) {
      const e = (0, _triggers.resolveError)(err, {
        code: Parse.Error.SCRIPT_FAILED,
        message: 'Auth failed. Unknown error.'
      });
      const userString = req.auth && req.auth.user ? req.auth.user.id : req.data.objectId || undefined;
      _logger.logger.error(`Failed running auth step ${method} for ${provider} for user ${userString} with Error: ` + JSON.stringify(e), {
        authenticationStep: method,
        error: e,
        user: userString,
        provider
      });
      throw e;
    }
  }
  return acc;
};
module.exports = {
  Auth,
  master,
  maintenance,
  nobody,
  readOnly,
  shouldUpdateSessionExpiry,
  getAuthForSessionToken,
  getAuthForLegacySessionToken,
  findUsersWithAuthData,
  hasMutatedAuthData,
  checkIfUserHasProvidedConfiguredProvidersForLogin,
  handleAuthDataValidation
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfdXRpbCIsInJlcXVpcmUiLCJfdHJpZ2dlcnMiLCJfbG9nZ2VyIiwiX2xydUNhY2hlIiwiX1Jlc3RRdWVyeSIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJfUmVzdFdyaXRlIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiUGFyc2UiLCJBdXRoIiwiY29uZmlnIiwiY2FjaGVDb250cm9sbGVyIiwidW5kZWZpbmVkIiwiaXNNYXN0ZXIiLCJpc01haW50ZW5hbmNlIiwiaXNSZWFkT25seSIsInVzZXIiLCJpbnN0YWxsYXRpb25JZCIsInVzZXJSb2xlcyIsImZldGNoZWRSb2xlcyIsInJvbGVQcm9taXNlIiwicHJvdG90eXBlIiwiaXNVbmF1dGhlbnRpY2F0ZWQiLCJtYXN0ZXIiLCJtYWludGVuYW5jZSIsInJlYWRPbmx5Iiwibm9ib2R5IiwidGhyb3R0bGUiLCJMUlUiLCJtYXgiLCJ0dGwiLCJzaG91bGRVcGRhdGVTZXNzaW9uRXhwaXJ5Iiwic2Vzc2lvbiIsInJlc2V0QWZ0ZXIiLCJzZXNzaW9uTGVuZ3RoIiwibGFzdFVwZGF0ZWQiLCJEYXRlIiwidXBkYXRlZEF0Iiwic2tpcFJhbmdlIiwic2V0VGltZSIsImdldFRpbWUiLCJyZW5ld1Nlc3Npb25JZk5lZWRlZCIsInNlc3Npb25Ub2tlbiIsImV4dGVuZFNlc3Npb25PblVzZSIsImdldCIsInNldCIsInF1ZXJ5IiwiUmVzdFF1ZXJ5IiwibWV0aG9kIiwiTWV0aG9kIiwiYXV0aCIsInJ1bkJlZm9yZUZpbmQiLCJjbGFzc05hbWUiLCJyZXN0V2hlcmUiLCJyZXN0T3B0aW9ucyIsImxpbWl0IiwicmVzdWx0cyIsImV4ZWN1dGUiLCJleHBpcmVzQXQiLCJnZW5lcmF0ZVNlc3Npb25FeHBpcmVzQXQiLCJSZXN0V3JpdGUiLCJvYmplY3RJZCIsIl9lbmNvZGUiLCJjb2RlIiwiRXJyb3IiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwibG9nZ2VyIiwiZXJyb3IiLCJnZXRBdXRoRm9yU2Vzc2lvblRva2VuIiwiY2FjaGVkIiwiY2FjaGVkRXhwaXJlc0F0IiwidXNlckpTT04iLCJkZWwiLCJJTlZBTElEX1NFU1NJT05fVE9LRU4iLCJjYWNoZWRVc2VyIiwiT2JqZWN0IiwiZnJvbUpTT04iLCJQcm9taXNlIiwicmVzb2x2ZSIsImluY2x1ZGUiLCJRdWVyeSIsIlNlc3Npb24iLCJlcXVhbFRvIiwiZmluZCIsInVzZU1hc3RlcktleSIsIm1hcCIsIm9iaiIsInRvSlNPTiIsImxlbmd0aCIsIm5vdyIsImlzbyIsInN0YXJ0c1dpdGgiLCJJTlRFUk5BTF9TRVJWRVJfRVJST1IiLCJwYXNzd29yZCIsInB1dCIsInRvSVNPU3RyaW5nIiwidXNlck9iamVjdCIsImdldEF1dGhGb3JMZWdhY3lTZXNzaW9uVG9rZW4iLCJfc2Vzc2lvbl90b2tlbiIsInRoZW4iLCJyZXNwb25zZSIsImdldFVzZXJSb2xlcyIsIl9sb2FkUm9sZXMiLCJnZXRSb2xlc0ZvclVzZXIiLCJ1c2VycyIsIl9fdHlwZSIsImlkIiwiZWFjaCIsInJlc3VsdCIsInB1c2giLCJSb2xlIiwiY2FjaGVkUm9sZXMiLCJyb2xlIiwiY2FjaGVSb2xlcyIsInJvbGVzTWFwIiwicmVkdWNlIiwibSIsInIiLCJuYW1lcyIsIm5hbWUiLCJpZHMiLCJyb2xlTmFtZXMiLCJfZ2V0QWxsUm9sZXNOYW1lc0ZvclJvbGVJZHMiLCJBcnJheSIsImNsZWFyUm9sZUNhY2hlIiwiZ2V0Um9sZXNCeUlkcyIsImlucyIsImNvbnRhaW5lZEluIiwicm9sZXMiLCIkaW4iLCJyb2xlSURzIiwicXVlcmllZFJvbGVzIiwiZmlsdGVyIiwicm9sZUlEIiwid2FzUXVlcmllZCIsIlNldCIsInJlc3VsdE1hcCIsIm1lbW8iLCJjb25jYXQiLCJmaW5kVXNlcnNXaXRoQXV0aERhdGEiLCJhdXRoRGF0YSIsImJlZm9yZUZpbmQiLCJjdXJyZW50VXNlckF1dGhEYXRhIiwicHJvdmlkZXJzIiwia2V5cyIsInF1ZXJpZXMiLCJhbGwiLCJwcm92aWRlciIsInByb3ZpZGVyQXV0aERhdGEiLCJzdG9yZWRQcm92aWRlckRhdGEiLCJpbmNvbWluZ0tleXMiLCJpc1VuY2hhbmdlZCIsInNvbWUiLCJrZXkiLCJpc0RlZXBTdHJpY3RFcXVhbCIsInZhbGlkYXRvckNvbmZpZyIsImF1dGhEYXRhTWFuYWdlciIsImdldFZhbGlkYXRvckZvclByb3ZpZGVyIiwidmFsaWRhdG9yIiwiYWRhcHRlciIsIklOVkFMSURfVkFMVUUiLCJ2YWxpZFF1ZXJpZXMiLCJkYXRhYmFzZSIsIiRvciIsImhhc011dGF0ZWRBdXRoRGF0YSIsInVzZXJBdXRoRGF0YSIsIm11dGF0ZWRBdXRoRGF0YSIsImZvckVhY2giLCJwcm92aWRlckRhdGEiLCJ1c2VyUHJvdmlkZXJBdXRoRGF0YSIsImhhc0NoYW5nZXMiLCJjaGVja0lmVXNlckhhc1Byb3ZpZGVkQ29uZmlndXJlZFByb3ZpZGVyc0ZvckxvZ2luIiwicmVxIiwic2F2ZWRVc2VyUHJvdmlkZXJzIiwiQm9vbGVhbiIsImhhc1Byb3ZpZGVkQVNvbG9Qcm92aWRlciIsInBvbGljeSIsImFkZGl0aW9uUHJvdmlkZXJzTm90Rm91bmQiLCJoYXNQcm92aWRlZEF0TGVhc3RPbmVBZGRpdGlvbmFsUHJvdmlkZXIiLCJyZXF1ZXN0T2JqZWN0IiwiaXAiLCJjYWxsIiwiT1RIRVJfQ0FVU0UiLCJqb2luIiwiaGFuZGxlQXV0aERhdGFWYWxpZGF0aW9uIiwiZm91bmRVc2VyIiwiVXNlciIsImdldFVzZXJJZCIsImZldGNoIiwidXBkYXRlZE9iamVjdCIsImJ1aWxkUGFyc2VPYmplY3RzIiwiZ2V0UmVxdWVzdE9iamVjdCIsImFjYyIsImF1dGhEYXRhUmVzcG9uc2UiLCJhdXRoS2V5cyIsInNvcnQiLCJhdXRoUHJvdmlkZXIiLCJlbmFibGVkIiwiVU5TVVBQT1JURURfU0VSVklDRSIsInZhbGlkYXRpb25SZXN1bHQiLCJ0cmlnZ2VyTmFtZSIsImRvTm90U2F2ZSIsInNhdmUiLCJlcnIiLCJyZXNvbHZlRXJyb3IiLCJTQ1JJUFRfRkFJTEVEIiwibWVzc2FnZSIsInVzZXJTdHJpbmciLCJkYXRhIiwiSlNPTiIsInN0cmluZ2lmeSIsImF1dGhlbnRpY2F0aW9uU3RlcCIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi9zcmMvQXV0aC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJjb25zdCBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKTtcbmltcG9ydCB7IGlzRGVlcFN0cmljdEVxdWFsIH0gZnJvbSAndXRpbCc7XG5pbXBvcnQgeyBnZXRSZXF1ZXN0T2JqZWN0LCByZXNvbHZlRXJyb3IgfSBmcm9tICcuL3RyaWdnZXJzJztcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4vbG9nZ2VyJztcbmltcG9ydCB7IExSVUNhY2hlIGFzIExSVSB9IGZyb20gJ2xydS1jYWNoZSc7XG5pbXBvcnQgUmVzdFF1ZXJ5IGZyb20gJy4vUmVzdFF1ZXJ5JztcbmltcG9ydCBSZXN0V3JpdGUgZnJvbSAnLi9SZXN0V3JpdGUnO1xuXG4vLyBBbiBBdXRoIG9iamVjdCB0ZWxscyB5b3Ugd2hvIGlzIHJlcXVlc3Rpbmcgc29tZXRoaW5nIGFuZCB3aGV0aGVyXG4vLyB0aGUgbWFzdGVyIGtleSB3YXMgdXNlZC5cbi8vIHVzZXJPYmplY3QgaXMgYSBQYXJzZS5Vc2VyIGFuZCBjYW4gYmUgbnVsbCBpZiB0aGVyZSdzIG5vIHVzZXIuXG5mdW5jdGlvbiBBdXRoKHtcbiAgY29uZmlnLFxuICBjYWNoZUNvbnRyb2xsZXIgPSB1bmRlZmluZWQsXG4gIGlzTWFzdGVyID0gZmFsc2UsXG4gIGlzTWFpbnRlbmFuY2UgPSBmYWxzZSxcbiAgaXNSZWFkT25seSA9IGZhbHNlLFxuICB1c2VyLFxuICBpbnN0YWxsYXRpb25JZCxcbn0pIHtcbiAgdGhpcy5jb25maWcgPSBjb25maWc7XG4gIHRoaXMuY2FjaGVDb250cm9sbGVyID0gY2FjaGVDb250cm9sbGVyIHx8IChjb25maWcgJiYgY29uZmlnLmNhY2hlQ29udHJvbGxlcik7XG4gIHRoaXMuaW5zdGFsbGF0aW9uSWQgPSBpbnN0YWxsYXRpb25JZDtcbiAgdGhpcy5pc01hc3RlciA9IGlzTWFzdGVyO1xuICB0aGlzLmlzTWFpbnRlbmFuY2UgPSBpc01haW50ZW5hbmNlO1xuICB0aGlzLnVzZXIgPSB1c2VyO1xuICB0aGlzLmlzUmVhZE9ubHkgPSBpc1JlYWRPbmx5O1xuXG4gIC8vIEFzc3VtaW5nIGEgdXNlcnMgcm9sZXMgd29uJ3QgY2hhbmdlIGR1cmluZyBhIHNpbmdsZSByZXF1ZXN0LCB3ZSdsbFxuICAvLyBvbmx5IGxvYWQgdGhlbSBvbmNlLlxuICB0aGlzLnVzZXJSb2xlcyA9IFtdO1xuICB0aGlzLmZldGNoZWRSb2xlcyA9IGZhbHNlO1xuICB0aGlzLnJvbGVQcm9taXNlID0gbnVsbDtcbn1cblxuLy8gV2hldGhlciB0aGlzIGF1dGggY291bGQgcG9zc2libHkgbW9kaWZ5IHRoZSBnaXZlbiB1c2VyIGlkLlxuLy8gSXQgc3RpbGwgY291bGQgYmUgZm9yYmlkZGVuIHZpYSBBQ0xzIGV2ZW4gaWYgdGhpcyByZXR1cm5zIHRydWUuXG5BdXRoLnByb3RvdHlwZS5pc1VuYXV0aGVudGljYXRlZCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuaXNNYXN0ZXIpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKHRoaXMuaXNNYWludGVuYW5jZSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAodGhpcy51c2VyKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gQSBoZWxwZXIgdG8gZ2V0IGEgbWFzdGVyLWxldmVsIEF1dGggb2JqZWN0XG5mdW5jdGlvbiBtYXN0ZXIoY29uZmlnKSB7XG4gIHJldHVybiBuZXcgQXV0aCh7IGNvbmZpZywgaXNNYXN0ZXI6IHRydWUgfSk7XG59XG5cbi8vIEEgaGVscGVyIHRvIGdldCBhIG1haW50ZW5hbmNlLWxldmVsIEF1dGggb2JqZWN0XG5mdW5jdGlvbiBtYWludGVuYW5jZShjb25maWcpIHtcbiAgcmV0dXJuIG5ldyBBdXRoKHsgY29uZmlnLCBpc01haW50ZW5hbmNlOiB0cnVlIH0pO1xufVxuXG4vLyBBIGhlbHBlciB0byBnZXQgYSBtYXN0ZXItbGV2ZWwgQXV0aCBvYmplY3RcbmZ1bmN0aW9uIHJlYWRPbmx5KGNvbmZpZykge1xuICByZXR1cm4gbmV3IEF1dGgoeyBjb25maWcsIGlzTWFzdGVyOiB0cnVlLCBpc1JlYWRPbmx5OiB0cnVlIH0pO1xufVxuXG4vLyBBIGhlbHBlciB0byBnZXQgYSBub2JvZHktbGV2ZWwgQXV0aCBvYmplY3RcbmZ1bmN0aW9uIG5vYm9keShjb25maWcpIHtcbiAgcmV0dXJuIG5ldyBBdXRoKHsgY29uZmlnLCBpc01hc3RlcjogZmFsc2UgfSk7XG59XG5cbmNvbnN0IHRocm90dGxlID0gbmV3IExSVSh7XG4gIG1heDogMTAwMDAsXG4gIHR0bDogNTAwLFxufSk7XG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIHNlc3Npb24gc2hvdWxkIGJlIHVwZGF0ZWQgYmFzZWQgb24gbGFzdCB1cGRhdGUgdGltZSAmIHNlc3Npb24gbGVuZ3RoLlxuICovXG5mdW5jdGlvbiBzaG91bGRVcGRhdGVTZXNzaW9uRXhwaXJ5KGNvbmZpZywgc2Vzc2lvbikge1xuICBjb25zdCByZXNldEFmdGVyID0gY29uZmlnLnNlc3Npb25MZW5ndGggLyAyO1xuICBjb25zdCBsYXN0VXBkYXRlZCA9IG5ldyBEYXRlKHNlc3Npb24/LnVwZGF0ZWRBdCk7XG4gIGNvbnN0IHNraXBSYW5nZSA9IG5ldyBEYXRlKCk7XG4gIHNraXBSYW5nZS5zZXRUaW1lKHNraXBSYW5nZS5nZXRUaW1lKCkgLSByZXNldEFmdGVyICogMTAwMCk7XG4gIHJldHVybiBsYXN0VXBkYXRlZCA8PSBza2lwUmFuZ2U7XG59XG5cbmNvbnN0IHJlbmV3U2Vzc2lvbklmTmVlZGVkID0gYXN5bmMgKHsgY29uZmlnLCBzZXNzaW9uLCBzZXNzaW9uVG9rZW4gfSkgPT4ge1xuICBpZiAoIWNvbmZpZz8uZXh0ZW5kU2Vzc2lvbk9uVXNlKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0aHJvdHRsZS5nZXQoc2Vzc2lvblRva2VuKSkge1xuICAgIHJldHVybjtcbiAgfVxuICB0aHJvdHRsZS5zZXQoc2Vzc2lvblRva2VuLCB0cnVlKTtcbiAgdHJ5IHtcbiAgICBpZiAoIXNlc3Npb24pIHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gYXdhaXQgUmVzdFF1ZXJ5KHtcbiAgICAgICAgbWV0aG9kOiBSZXN0UXVlcnkuTWV0aG9kLmdldCxcbiAgICAgICAgY29uZmlnLFxuICAgICAgICBhdXRoOiBtYXN0ZXIoY29uZmlnKSxcbiAgICAgICAgcnVuQmVmb3JlRmluZDogZmFsc2UsXG4gICAgICAgIGNsYXNzTmFtZTogJ19TZXNzaW9uJyxcbiAgICAgICAgcmVzdFdoZXJlOiB7IHNlc3Npb25Ub2tlbiB9LFxuICAgICAgICByZXN0T3B0aW9uczogeyBsaW1pdDogMSB9LFxuICAgICAgfSk7XG4gICAgICBjb25zdCB7IHJlc3VsdHMgfSA9IGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKTtcbiAgICAgIHNlc3Npb24gPSByZXN1bHRzWzBdO1xuICAgIH1cblxuICAgIGlmICghc2hvdWxkVXBkYXRlU2Vzc2lvbkV4cGlyeShjb25maWcsIHNlc3Npb24pIHx8ICFzZXNzaW9uKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGV4cGlyZXNBdCA9IGNvbmZpZy5nZW5lcmF0ZVNlc3Npb25FeHBpcmVzQXQoKTtcbiAgICBhd2FpdCBuZXcgUmVzdFdyaXRlKFxuICAgICAgY29uZmlnLFxuICAgICAgbWFzdGVyKGNvbmZpZyksXG4gICAgICAnX1Nlc3Npb24nLFxuICAgICAgeyBvYmplY3RJZDogc2Vzc2lvbi5vYmplY3RJZCB9LFxuICAgICAgeyBleHBpcmVzQXQ6IFBhcnNlLl9lbmNvZGUoZXhwaXJlc0F0KSB9XG4gICAgKS5leGVjdXRlKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoZT8uY29kZSAhPT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgbG9nZ2VyLmVycm9yKCdDb3VsZCBub3QgdXBkYXRlIHNlc3Npb24gZXhwaXJ5OiAnLCBlKTtcbiAgICB9XG4gIH1cbn07XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gYW4gQXV0aCBvYmplY3RcbmNvbnN0IGdldEF1dGhGb3JTZXNzaW9uVG9rZW4gPSBhc3luYyBmdW5jdGlvbiAoe1xuICBjb25maWcsXG4gIGNhY2hlQ29udHJvbGxlcixcbiAgc2Vzc2lvblRva2VuLFxuICBpbnN0YWxsYXRpb25JZCxcbn0pIHtcbiAgY2FjaGVDb250cm9sbGVyID0gY2FjaGVDb250cm9sbGVyIHx8IChjb25maWcgJiYgY29uZmlnLmNhY2hlQ29udHJvbGxlcik7XG4gIGlmIChjYWNoZUNvbnRyb2xsZXIpIHtcbiAgICBjb25zdCBjYWNoZWQgPSBhd2FpdCBjYWNoZUNvbnRyb2xsZXIudXNlci5nZXQoc2Vzc2lvblRva2VuKTtcbiAgICBpZiAoY2FjaGVkKSB7XG4gICAgICBjb25zdCB7IGV4cGlyZXNBdDogY2FjaGVkRXhwaXJlc0F0LCAuLi51c2VySlNPTiB9ID0gY2FjaGVkO1xuICAgICAgaWYgKGNhY2hlZEV4cGlyZXNBdCAmJiBuZXcgRGF0ZShjYWNoZWRFeHBpcmVzQXQpIDwgbmV3IERhdGUoKSkge1xuICAgICAgICBjYWNoZUNvbnRyb2xsZXIudXNlci5kZWwoc2Vzc2lvblRva2VuKTtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTiwgJ1Nlc3Npb24gdG9rZW4gaXMgZXhwaXJlZC4nKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGNhY2hlZFVzZXIgPSBQYXJzZS5PYmplY3QuZnJvbUpTT04odXNlckpTT04pO1xuICAgICAgcmVuZXdTZXNzaW9uSWZOZWVkZWQoeyBjb25maWcsIHNlc3Npb25Ub2tlbiB9KTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoXG4gICAgICAgIG5ldyBBdXRoKHtcbiAgICAgICAgICBjb25maWcsXG4gICAgICAgICAgY2FjaGVDb250cm9sbGVyLFxuICAgICAgICAgIGlzTWFzdGVyOiBmYWxzZSxcbiAgICAgICAgICBpbnN0YWxsYXRpb25JZCxcbiAgICAgICAgICB1c2VyOiBjYWNoZWRVc2VyLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBsZXQgcmVzdWx0cztcbiAgaWYgKGNvbmZpZykge1xuICAgIGNvbnN0IHJlc3RPcHRpb25zID0ge1xuICAgICAgbGltaXQ6IDEsXG4gICAgICBpbmNsdWRlOiAndXNlcicsXG4gICAgfTtcbiAgICBjb25zdCBSZXN0UXVlcnkgPSByZXF1aXJlKCcuL1Jlc3RRdWVyeScpO1xuICAgIGNvbnN0IHF1ZXJ5ID0gYXdhaXQgUmVzdFF1ZXJ5KHtcbiAgICAgIG1ldGhvZDogUmVzdFF1ZXJ5Lk1ldGhvZC5nZXQsXG4gICAgICBjb25maWcsXG4gICAgICBydW5CZWZvcmVGaW5kOiBmYWxzZSxcbiAgICAgIGF1dGg6IG1hc3Rlcihjb25maWcpLFxuICAgICAgY2xhc3NOYW1lOiAnX1Nlc3Npb24nLFxuICAgICAgcmVzdFdoZXJlOiB7IHNlc3Npb25Ub2tlbiB9LFxuICAgICAgcmVzdE9wdGlvbnMsXG4gICAgfSk7XG4gICAgcmVzdWx0cyA9IChhd2FpdCBxdWVyeS5leGVjdXRlKCkpLnJlc3VsdHM7XG4gIH0gZWxzZSB7XG4gICAgcmVzdWx0cyA9IChcbiAgICAgIGF3YWl0IG5ldyBQYXJzZS5RdWVyeShQYXJzZS5TZXNzaW9uKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLmluY2x1ZGUoJ3VzZXInKVxuICAgICAgICAuZXF1YWxUbygnc2Vzc2lvblRva2VuJywgc2Vzc2lvblRva2VuKVxuICAgICAgICAuZmluZCh7IHVzZU1hc3RlcktleTogdHJ1ZSB9KVxuICAgICkubWFwKG9iaiA9PiBvYmoudG9KU09OKCkpO1xuICB9XG5cbiAgaWYgKHJlc3VsdHMubGVuZ3RoICE9PSAxIHx8ICFyZXN1bHRzWzBdWyd1c2VyJ10pIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9TRVNTSU9OX1RPS0VOLCAnSW52YWxpZCBzZXNzaW9uIHRva2VuJyk7XG4gIH1cbiAgY29uc3Qgc2Vzc2lvbiA9IHJlc3VsdHNbMF07XG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCksXG4gICAgZXhwaXJlc0F0ID0gc2Vzc2lvbi5leHBpcmVzQXQgPyBuZXcgRGF0ZShzZXNzaW9uLmV4cGlyZXNBdC5pc28pIDogdW5kZWZpbmVkO1xuICBpZiAoZXhwaXJlc0F0IDwgbm93KSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTiwgJ1Nlc3Npb24gdG9rZW4gaXMgZXhwaXJlZC4nKTtcbiAgfVxuICBjb25zdCBvYmogPSBzZXNzaW9uLnVzZXI7XG5cbiAgaWYgKHR5cGVvZiBvYmpbJ29iamVjdElkJ10gPT09ICdzdHJpbmcnICYmIG9ialsnb2JqZWN0SWQnXS5zdGFydHNXaXRoKCdyb2xlOicpKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUiwgJ0ludmFsaWQgb2JqZWN0IElELicpO1xuICB9XG5cbiAgZGVsZXRlIG9iai5wYXNzd29yZDtcbiAgb2JqWydjbGFzc05hbWUnXSA9ICdfVXNlcic7XG4gIG9ialsnc2Vzc2lvblRva2VuJ10gPSBzZXNzaW9uVG9rZW47XG4gIGlmIChjYWNoZUNvbnRyb2xsZXIpIHtcbiAgICBjYWNoZUNvbnRyb2xsZXIudXNlci5wdXQoc2Vzc2lvblRva2VuLCB7IC4uLm9iaiwgZXhwaXJlc0F0OiBleHBpcmVzQXQ/LnRvSVNPU3RyaW5nKCkgfSk7XG4gIH1cbiAgcmVuZXdTZXNzaW9uSWZOZWVkZWQoeyBjb25maWcsIHNlc3Npb24sIHNlc3Npb25Ub2tlbiB9KTtcbiAgY29uc3QgdXNlck9iamVjdCA9IFBhcnNlLk9iamVjdC5mcm9tSlNPTihvYmopO1xuICByZXR1cm4gbmV3IEF1dGgoe1xuICAgIGNvbmZpZyxcbiAgICBjYWNoZUNvbnRyb2xsZXIsXG4gICAgaXNNYXN0ZXI6IGZhbHNlLFxuICAgIGluc3RhbGxhdGlvbklkLFxuICAgIHVzZXI6IHVzZXJPYmplY3QsXG4gIH0pO1xufTtcblxudmFyIGdldEF1dGhGb3JMZWdhY3lTZXNzaW9uVG9rZW4gPSBhc3luYyBmdW5jdGlvbiAoeyBjb25maWcsIHNlc3Npb25Ub2tlbiwgaW5zdGFsbGF0aW9uSWQgfSkge1xuICB2YXIgcmVzdE9wdGlvbnMgPSB7XG4gICAgbGltaXQ6IDEsXG4gIH07XG4gIGNvbnN0IFJlc3RRdWVyeSA9IHJlcXVpcmUoJy4vUmVzdFF1ZXJ5Jyk7XG4gIHZhciBxdWVyeSA9IGF3YWl0IFJlc3RRdWVyeSh7XG4gICAgbWV0aG9kOiBSZXN0UXVlcnkuTWV0aG9kLmdldCxcbiAgICBjb25maWcsXG4gICAgcnVuQmVmb3JlRmluZDogZmFsc2UsXG4gICAgYXV0aDogbWFzdGVyKGNvbmZpZyksXG4gICAgY2xhc3NOYW1lOiAnX1VzZXInLFxuICAgIHJlc3RXaGVyZTogeyBfc2Vzc2lvbl90b2tlbjogc2Vzc2lvblRva2VuIH0sXG4gICAgcmVzdE9wdGlvbnMsXG4gIH0pO1xuICByZXR1cm4gcXVlcnkuZXhlY3V0ZSgpLnRoZW4ocmVzcG9uc2UgPT4ge1xuICAgIHZhciByZXN1bHRzID0gcmVzcG9uc2UucmVzdWx0cztcbiAgICBpZiAocmVzdWx0cy5sZW5ndGggIT09IDEpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1NFU1NJT05fVE9LRU4sICdpbnZhbGlkIGxlZ2FjeSBzZXNzaW9uIHRva2VuJyk7XG4gICAgfVxuICAgIGNvbnN0IG9iaiA9IHJlc3VsdHNbMF07XG5cbiAgICBpZiAodHlwZW9mIG9ialsnb2JqZWN0SWQnXSA9PT0gJ3N0cmluZycgJiYgb2JqWydvYmplY3RJZCddLnN0YXJ0c1dpdGgoJ3JvbGU6JykpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsICdJbnZhbGlkIG9iamVjdCBJRC4nKTtcbiAgICB9XG5cbiAgICBvYmouY2xhc3NOYW1lID0gJ19Vc2VyJztcbiAgICBjb25zdCB1c2VyT2JqZWN0ID0gUGFyc2UuT2JqZWN0LmZyb21KU09OKG9iaik7XG4gICAgcmV0dXJuIG5ldyBBdXRoKHtcbiAgICAgIGNvbmZpZyxcbiAgICAgIGlzTWFzdGVyOiBmYWxzZSxcbiAgICAgIGluc3RhbGxhdGlvbklkLFxuICAgICAgdXNlcjogdXNlck9iamVjdCxcbiAgICB9KTtcbiAgfSk7XG59O1xuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIGFycmF5IG9mIHJvbGUgbmFtZXNcbkF1dGgucHJvdG90eXBlLmdldFVzZXJSb2xlcyA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuaXNNYXN0ZXIgfHwgdGhpcy5pc01haW50ZW5hbmNlIHx8ICF0aGlzLnVzZXIpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKFtdKTtcbiAgfVxuICBpZiAodGhpcy5mZXRjaGVkUm9sZXMpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMudXNlclJvbGVzKTtcbiAgfVxuICBpZiAodGhpcy5yb2xlUHJvbWlzZSkge1xuICAgIHJldHVybiB0aGlzLnJvbGVQcm9taXNlO1xuICB9XG4gIHRoaXMucm9sZVByb21pc2UgPSB0aGlzLl9sb2FkUm9sZXMoKTtcbiAgcmV0dXJuIHRoaXMucm9sZVByb21pc2U7XG59O1xuXG5BdXRoLnByb3RvdHlwZS5nZXRSb2xlc0ZvclVzZXIgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIC8vU3RhY2sgYWxsIFBhcnNlLlJvbGVcbiAgY29uc3QgcmVzdWx0cyA9IFtdO1xuICBpZiAodGhpcy5jb25maWcpIHtcbiAgICBjb25zdCByZXN0V2hlcmUgPSB7XG4gICAgICB1c2Vyczoge1xuICAgICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgY2xhc3NOYW1lOiAnX1VzZXInLFxuICAgICAgICBvYmplY3RJZDogdGhpcy51c2VyLmlkLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGNvbnN0IFJlc3RRdWVyeSA9IHJlcXVpcmUoJy4vUmVzdFF1ZXJ5Jyk7XG4gICAgY29uc3QgcXVlcnkgPSBhd2FpdCBSZXN0UXVlcnkoe1xuICAgICAgbWV0aG9kOiBSZXN0UXVlcnkuTWV0aG9kLmZpbmQsXG4gICAgICBydW5CZWZvcmVGaW5kOiBmYWxzZSxcbiAgICAgIGNvbmZpZzogdGhpcy5jb25maWcsXG4gICAgICBhdXRoOiBtYXN0ZXIodGhpcy5jb25maWcpLFxuICAgICAgY2xhc3NOYW1lOiAnX1JvbGUnLFxuICAgICAgcmVzdFdoZXJlLFxuICAgIH0pO1xuICAgIGF3YWl0IHF1ZXJ5LmVhY2gocmVzdWx0ID0+IHJlc3VsdHMucHVzaChyZXN1bHQpKTtcbiAgfSBlbHNlIHtcbiAgICBhd2FpdCBuZXcgUGFyc2UuUXVlcnkoUGFyc2UuUm9sZSlcbiAgICAgIC5lcXVhbFRvKCd1c2VycycsIHRoaXMudXNlcilcbiAgICAgIC5lYWNoKHJlc3VsdCA9PiByZXN1bHRzLnB1c2gocmVzdWx0LnRvSlNPTigpKSwgeyB1c2VNYXN0ZXJLZXk6IHRydWUgfSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdHM7XG59O1xuXG4vLyBJdGVyYXRlcyB0aHJvdWdoIHRoZSByb2xlIHRyZWUgYW5kIGNvbXBpbGVzIGEgdXNlcidzIHJvbGVzXG5BdXRoLnByb3RvdHlwZS5fbG9hZFJvbGVzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5jYWNoZUNvbnRyb2xsZXIpIHtcbiAgICBjb25zdCBjYWNoZWRSb2xlcyA9IGF3YWl0IHRoaXMuY2FjaGVDb250cm9sbGVyLnJvbGUuZ2V0KHRoaXMudXNlci5pZCk7XG4gICAgaWYgKGNhY2hlZFJvbGVzICE9IG51bGwpIHtcbiAgICAgIHRoaXMuZmV0Y2hlZFJvbGVzID0gdHJ1ZTtcbiAgICAgIHRoaXMudXNlclJvbGVzID0gY2FjaGVkUm9sZXM7XG4gICAgICByZXR1cm4gY2FjaGVkUm9sZXM7XG4gICAgfVxuICB9XG5cbiAgLy8gRmlyc3QgZ2V0IHRoZSByb2xlIGlkcyB0aGlzIHVzZXIgaXMgZGlyZWN0bHkgYSBtZW1iZXIgb2ZcbiAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMuZ2V0Um9sZXNGb3JVc2VyKCk7XG4gIGlmICghcmVzdWx0cy5sZW5ndGgpIHtcbiAgICB0aGlzLnVzZXJSb2xlcyA9IFtdO1xuICAgIHRoaXMuZmV0Y2hlZFJvbGVzID0gdHJ1ZTtcbiAgICB0aGlzLnJvbGVQcm9taXNlID0gbnVsbDtcblxuICAgIHRoaXMuY2FjaGVSb2xlcygpO1xuICAgIHJldHVybiB0aGlzLnVzZXJSb2xlcztcbiAgfVxuXG4gIGNvbnN0IHJvbGVzTWFwID0gcmVzdWx0cy5yZWR1Y2UoXG4gICAgKG0sIHIpID0+IHtcbiAgICAgIG0ubmFtZXMucHVzaChyLm5hbWUpO1xuICAgICAgbS5pZHMucHVzaChyLm9iamVjdElkKTtcbiAgICAgIHJldHVybiBtO1xuICAgIH0sXG4gICAgeyBpZHM6IFtdLCBuYW1lczogW10gfVxuICApO1xuXG4gIC8vIHJ1biB0aGUgcmVjdXJzaXZlIGZpbmRpbmdcbiAgY29uc3Qgcm9sZU5hbWVzID0gYXdhaXQgdGhpcy5fZ2V0QWxsUm9sZXNOYW1lc0ZvclJvbGVJZHMocm9sZXNNYXAuaWRzLCByb2xlc01hcC5uYW1lcyk7XG4gIHRoaXMudXNlclJvbGVzID0gcm9sZU5hbWVzLm1hcChyID0+IHtcbiAgICByZXR1cm4gJ3JvbGU6JyArIHI7XG4gIH0pO1xuICB0aGlzLmZldGNoZWRSb2xlcyA9IHRydWU7XG4gIHRoaXMucm9sZVByb21pc2UgPSBudWxsO1xuICB0aGlzLmNhY2hlUm9sZXMoKTtcbiAgcmV0dXJuIHRoaXMudXNlclJvbGVzO1xufTtcblxuQXV0aC5wcm90b3R5cGUuY2FjaGVSb2xlcyA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF0aGlzLmNhY2hlQ29udHJvbGxlcikge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICB0aGlzLmNhY2hlQ29udHJvbGxlci5yb2xlLnB1dCh0aGlzLnVzZXIuaWQsIEFycmF5KC4uLnRoaXMudXNlclJvbGVzKSk7XG4gIHJldHVybiB0cnVlO1xufTtcblxuQXV0aC5wcm90b3R5cGUuY2xlYXJSb2xlQ2FjaGUgPSBmdW5jdGlvbiAoc2Vzc2lvblRva2VuKSB7XG4gIGlmICghdGhpcy5jYWNoZUNvbnRyb2xsZXIpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgdGhpcy5jYWNoZUNvbnRyb2xsZXIucm9sZS5kZWwodGhpcy51c2VyLmlkKTtcbiAgdGhpcy5jYWNoZUNvbnRyb2xsZXIudXNlci5kZWwoc2Vzc2lvblRva2VuKTtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG5BdXRoLnByb3RvdHlwZS5nZXRSb2xlc0J5SWRzID0gYXN5bmMgZnVuY3Rpb24gKGlucykge1xuICBjb25zdCByZXN1bHRzID0gW107XG4gIC8vIEJ1aWxkIGFuIE9SIHF1ZXJ5IGFjcm9zcyBhbGwgcGFyZW50Um9sZXNcbiAgaWYgKCF0aGlzLmNvbmZpZykge1xuICAgIGF3YWl0IG5ldyBQYXJzZS5RdWVyeShQYXJzZS5Sb2xlKVxuICAgICAgLmNvbnRhaW5lZEluKFxuICAgICAgICAncm9sZXMnLFxuICAgICAgICBpbnMubWFwKGlkID0+IHtcbiAgICAgICAgICBjb25zdCByb2xlID0gbmV3IFBhcnNlLk9iamVjdChQYXJzZS5Sb2xlKTtcbiAgICAgICAgICByb2xlLmlkID0gaWQ7XG4gICAgICAgICAgcmV0dXJuIHJvbGU7XG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICAuZWFjaChyZXN1bHQgPT4gcmVzdWx0cy5wdXNoKHJlc3VsdC50b0pTT04oKSksIHsgdXNlTWFzdGVyS2V5OiB0cnVlIH0pO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IHJvbGVzID0gaW5zLm1hcChpZCA9PiB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgY2xhc3NOYW1lOiAnX1JvbGUnLFxuICAgICAgICBvYmplY3RJZDogaWQsXG4gICAgICB9O1xuICAgIH0pO1xuICAgIGNvbnN0IHJlc3RXaGVyZSA9IHsgcm9sZXM6IHsgJGluOiByb2xlcyB9IH07XG4gICAgY29uc3QgUmVzdFF1ZXJ5ID0gcmVxdWlyZSgnLi9SZXN0UXVlcnknKTtcbiAgICBjb25zdCBxdWVyeSA9IGF3YWl0IFJlc3RRdWVyeSh7XG4gICAgICBtZXRob2Q6IFJlc3RRdWVyeS5NZXRob2QuZmluZCxcbiAgICAgIGNvbmZpZzogdGhpcy5jb25maWcsXG4gICAgICBydW5CZWZvcmVGaW5kOiBmYWxzZSxcbiAgICAgIGF1dGg6IG1hc3Rlcih0aGlzLmNvbmZpZyksXG4gICAgICBjbGFzc05hbWU6ICdfUm9sZScsXG4gICAgICByZXN0V2hlcmUsXG4gICAgfSk7XG4gICAgYXdhaXQgcXVlcnkuZWFjaChyZXN1bHQgPT4gcmVzdWx0cy5wdXNoKHJlc3VsdCkpO1xuICB9XG4gIHJldHVybiByZXN1bHRzO1xufTtcblxuLy8gR2l2ZW4gYSBsaXN0IG9mIHJvbGVJZHMsIGZpbmQgYWxsIHRoZSBwYXJlbnQgcm9sZXMsIHJldHVybnMgYSBwcm9taXNlIHdpdGggYWxsIG5hbWVzXG5BdXRoLnByb3RvdHlwZS5fZ2V0QWxsUm9sZXNOYW1lc0ZvclJvbGVJZHMgPSBmdW5jdGlvbiAocm9sZUlEcywgbmFtZXMgPSBbXSwgcXVlcmllZFJvbGVzID0ge30pIHtcbiAgY29uc3QgaW5zID0gcm9sZUlEcy5maWx0ZXIocm9sZUlEID0+IHtcbiAgICBjb25zdCB3YXNRdWVyaWVkID0gcXVlcmllZFJvbGVzW3JvbGVJRF0gIT09IHRydWU7XG4gICAgcXVlcmllZFJvbGVzW3JvbGVJRF0gPSB0cnVlO1xuICAgIHJldHVybiB3YXNRdWVyaWVkO1xuICB9KTtcblxuICAvLyBhbGwgcm9sZXMgYXJlIGFjY291bnRlZCBmb3IsIHJldHVybiB0aGUgbmFtZXNcbiAgaWYgKGlucy5sZW5ndGggPT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoWy4uLm5ldyBTZXQobmFtZXMpXSk7XG4gIH1cblxuICByZXR1cm4gdGhpcy5nZXRSb2xlc0J5SWRzKGlucylcbiAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgIC8vIE5vdGhpbmcgZm91bmRcbiAgICAgIGlmICghcmVzdWx0cy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuYW1lcyk7XG4gICAgICB9XG4gICAgICAvLyBNYXAgdGhlIHJlc3VsdHMgd2l0aCBhbGwgSWRzIGFuZCBuYW1lc1xuICAgICAgY29uc3QgcmVzdWx0TWFwID0gcmVzdWx0cy5yZWR1Y2UoXG4gICAgICAgIChtZW1vLCByb2xlKSA9PiB7XG4gICAgICAgICAgbWVtby5uYW1lcy5wdXNoKHJvbGUubmFtZSk7XG4gICAgICAgICAgbWVtby5pZHMucHVzaChyb2xlLm9iamVjdElkKTtcbiAgICAgICAgICByZXR1cm4gbWVtbztcbiAgICAgICAgfSxcbiAgICAgICAgeyBpZHM6IFtdLCBuYW1lczogW10gfVxuICAgICAgKTtcbiAgICAgIC8vIHN0b3JlIHRoZSBuZXcgZm91bmQgbmFtZXNcbiAgICAgIG5hbWVzID0gbmFtZXMuY29uY2F0KHJlc3VsdE1hcC5uYW1lcyk7XG4gICAgICAvLyBmaW5kIHRoZSBuZXh0IG9uZXMsIGNpcmN1bGFyIHJvbGVzIHdpbGwgYmUgY3V0XG4gICAgICByZXR1cm4gdGhpcy5fZ2V0QWxsUm9sZXNOYW1lc0ZvclJvbGVJZHMocmVzdWx0TWFwLmlkcywgbmFtZXMsIHF1ZXJpZWRSb2xlcyk7XG4gICAgfSlcbiAgICAudGhlbihuYW1lcyA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKFsuLi5uZXcgU2V0KG5hbWVzKV0pO1xuICAgIH0pO1xufTtcblxuY29uc3QgZmluZFVzZXJzV2l0aEF1dGhEYXRhID0gYXN5bmMgKGNvbmZpZywgYXV0aERhdGEsIGJlZm9yZUZpbmQsIGN1cnJlbnRVc2VyQXV0aERhdGEpID0+IHtcbiAgY29uc3QgcHJvdmlkZXJzID0gT2JqZWN0LmtleXMoYXV0aERhdGEpO1xuXG4gIGNvbnN0IHF1ZXJpZXMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBwcm92aWRlcnMubWFwKGFzeW5jIHByb3ZpZGVyID0+IHtcbiAgICAgIGNvbnN0IHByb3ZpZGVyQXV0aERhdGEgPSBhdXRoRGF0YVtwcm92aWRlcl07XG5cbiAgICAgIC8vIFNraXAgcHJvdmlkZXJzIGJlaW5nIHVubGlua2VkIChudWxsIHZhbHVlKVxuICAgICAgaWYgKHByb3ZpZGVyQXV0aERhdGEgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG5cbiAgICAgIC8vIFNraXAgYmVmb3JlRmluZCBvbmx5IHdoZW4gaW5jb21pbmcgZGF0YSBpcyBjb25maXJtZWQgdW5jaGFuZ2VkIGZyb20gc3RvcmVkIGRhdGEuXG4gICAgICAvLyBUaGlzIGhhbmRsZXMgZWNob2VkLWJhY2sgYXV0aERhdGEgZnJvbSBhZnRlckZpbmQgKGUuZy4gY2xpZW50IHNlbmRzIGJhY2sgeyBpZDogJ3gnIH1cbiAgICAgIC8vIGFsb25nc2lkZSBhIHByb3ZpZGVyIHVubGluaykuIE9uIGxvZ2luL3NpZ251cCwgY3VycmVudFVzZXJBdXRoRGF0YSBpcyB1bmRlZmluZWQgc29cbiAgICAgIC8vIGJlZm9yZUZpbmQgYWx3YXlzIHJ1bnMsIHByZXNlcnZpbmcgaXQgYXMgdGhlIHNlY3VyaXR5IGdhdGUgZm9yIG1pc3NpbmcgY3JlZGVudGlhbHMuXG4gICAgICBjb25zdCBzdG9yZWRQcm92aWRlckRhdGEgPSBjdXJyZW50VXNlckF1dGhEYXRhPy5bcHJvdmlkZXJdO1xuICAgICAgY29uc3QgaW5jb21pbmdLZXlzID0gT2JqZWN0LmtleXMocHJvdmlkZXJBdXRoRGF0YSB8fCB7fSk7XG4gICAgICBjb25zdCBpc1VuY2hhbmdlZCA9IHN0b3JlZFByb3ZpZGVyRGF0YSAmJiBpbmNvbWluZ0tleXMubGVuZ3RoID4gMCAmJlxuICAgICAgICAhaW5jb21pbmdLZXlzLnNvbWUoa2V5ID0+ICFpc0RlZXBTdHJpY3RFcXVhbChwcm92aWRlckF1dGhEYXRhW2tleV0sIHN0b3JlZFByb3ZpZGVyRGF0YVtrZXldKSk7XG5cbiAgICAgIGNvbnN0IHZhbGlkYXRvckNvbmZpZyA9IGNvbmZpZy5hdXRoRGF0YU1hbmFnZXIuZ2V0VmFsaWRhdG9yRm9yUHJvdmlkZXIocHJvdmlkZXIpO1xuICAgICAgLy8gU2tpcCBkYXRhYmFzZSBxdWVyeSBmb3IgdW5jb25maWd1cmVkIHByb3ZpZGVycyB0byBhdm9pZCB1bmluZGV4ZWQgY29sbGVjdGlvbiBzY2FucztcbiAgICAgIC8vIHRoZSBwcm92aWRlciB3aWxsIGJlIHJlamVjdGVkIGxhdGVyIGluIGhhbmRsZUF1dGhEYXRhVmFsaWRhdGlvbiB3aXRoIFVOU1VQUE9SVEVEX1NFUlZJQ0VcbiAgICAgIGlmICghdmFsaWRhdG9yQ29uZmlnPy52YWxpZGF0b3IpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICBjb25zdCBhZGFwdGVyID0gdmFsaWRhdG9yQ29uZmlnLmFkYXB0ZXI7XG4gICAgICBpZiAoYmVmb3JlRmluZCAmJiB0eXBlb2YgYWRhcHRlcj8uYmVmb3JlRmluZCA9PT0gJ2Z1bmN0aW9uJyAmJiAhaXNVbmNoYW5nZWQpIHtcbiAgICAgICAgYXdhaXQgYWRhcHRlci5iZWZvcmVGaW5kKHByb3ZpZGVyQXV0aERhdGEpO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXByb3ZpZGVyQXV0aERhdGE/LmlkKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIHByb3ZpZGVyQXV0aERhdGEuaWQgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1ZBTFVFLCBgSW52YWxpZCBhdXRoRGF0YSBpZCBmb3IgcHJvdmlkZXIgJyR7cHJvdmlkZXJ9Jy5gKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHsgW2BhdXRoRGF0YS4ke3Byb3ZpZGVyfS5pZGBdOiBwcm92aWRlckF1dGhEYXRhLmlkIH07XG4gICAgfSlcbiAgKTtcblxuICAvLyBGaWx0ZXIgb3V0IG51bGwgcXVlcmllc1xuICBjb25zdCB2YWxpZFF1ZXJpZXMgPSBxdWVyaWVzLmZpbHRlcihxdWVyeSA9PiBxdWVyeSAhPT0gbnVsbCk7XG5cbiAgaWYgKCF2YWxpZFF1ZXJpZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgLy8gUGVyZm9ybSBkYXRhYmFzZSBxdWVyeVxuICByZXR1cm4gY29uZmlnLmRhdGFiYXNlLmZpbmQoJ19Vc2VyJywgeyAkb3I6IHZhbGlkUXVlcmllcyB9LCB7IGxpbWl0OiAyIH0pO1xufTtcblxuY29uc3QgaGFzTXV0YXRlZEF1dGhEYXRhID0gKGF1dGhEYXRhLCB1c2VyQXV0aERhdGEpID0+IHtcbiAgaWYgKCF1c2VyQXV0aERhdGEpIHsgcmV0dXJuIHsgaGFzTXV0YXRlZEF1dGhEYXRhOiB0cnVlLCBtdXRhdGVkQXV0aERhdGE6IGF1dGhEYXRhIH07IH1cbiAgY29uc3QgbXV0YXRlZEF1dGhEYXRhID0ge307XG4gIE9iamVjdC5rZXlzKGF1dGhEYXRhKS5mb3JFYWNoKHByb3ZpZGVyID0+IHtcbiAgICAvLyBBbm9ueW1vdXMgcHJvdmlkZXIgaXMgbm90IGhhbmRsZWQgdGhpcyB3YXlcbiAgICBpZiAocHJvdmlkZXIgPT09ICdhbm9ueW1vdXMnKSB7IHJldHVybjsgfVxuICAgIGNvbnN0IHByb3ZpZGVyRGF0YSA9IGF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICBjb25zdCB1c2VyUHJvdmlkZXJBdXRoRGF0YSA9IHVzZXJBdXRoRGF0YVtwcm92aWRlcl07XG5cbiAgICAvLyBJZiB1bmxpbmtpbmcgKHNldHRpbmcgdG8gbnVsbCksIGNvbnNpZGVyIGl0IG11dGF0ZWRcbiAgICBpZiAocHJvdmlkZXJEYXRhID09PSBudWxsKSB7XG4gICAgICBtdXRhdGVkQXV0aERhdGFbcHJvdmlkZXJdID0gcHJvdmlkZXJEYXRhO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIElmIHByb3ZpZGVyIGRvZXNuJ3QgZXhpc3QgaW4gc3RvcmVkIGRhdGEsIGl0J3MgbmV3XG4gICAgaWYgKCF1c2VyUHJvdmlkZXJBdXRoRGF0YSkge1xuICAgICAgbXV0YXRlZEF1dGhEYXRhW3Byb3ZpZGVyXSA9IHByb3ZpZGVyRGF0YTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZiBpbmNvbWluZyBkYXRhIHJlcHJlc2VudHMgYWN0dWFsIGNoYW5nZXMgdnMganVzdCBlY2hvaW5nIGJhY2tcbiAgICAvLyB3aGF0IGFmdGVyRmluZCByZXR1cm5lZC4gSWYgaW5jb21pbmcgZGF0YSBpcyBhIHN1YnNldCBvZiBzdG9yZWQgZGF0YVxuICAgIC8vIChhbGwgaW5jb21pbmcgZmllbGRzIG1hdGNoIHN0b3JlZCB2YWx1ZXMpLCBpdCdzIG5vdCBtdXRhdGVkLlxuICAgIC8vIElmIGluY29taW5nIGRhdGEgaGFzIGRpZmZlcmVudCB2YWx1ZXMgb3IgZmllbGRzIG5vdCBpbiBzdG9yZWQgZGF0YSwgaXQncyBtdXRhdGVkLlxuICAgIC8vIFRoaXMgaGFuZGxlcyB0aGUgY2FzZSB3aGVyZSBhZnRlckZpbmQgc3RyaXBzIHNlbnNpdGl2ZSBmaWVsZHMgbGlrZSAnY29kZSc6XG4gICAgLy8gLSBJbmNvbWluZzogeyBpZDogJ3gnIH0sIFN0b3JlZDogeyBpZDogJ3gnLCBjb2RlOiAnc2VjcmV0JyB9IC0+IE5PVCBtdXRhdGVkIChzdWJzZXQpXG4gICAgLy8gLSBJbmNvbWluZzogeyBpZDogJ3gnLCB0b2tlbjogJ25ldycgfSwgU3RvcmVkOiB7IGlkOiAneCcsIHRva2VuOiAnb2xkJyB9IC0+IE1VVEFURURcbiAgICBjb25zdCBpbmNvbWluZ0tleXMgPSBPYmplY3Qua2V5cyhwcm92aWRlckRhdGEgfHwge30pO1xuICAgIGNvbnN0IGhhc0NoYW5nZXMgPSBpbmNvbWluZ0tleXMuc29tZShrZXkgPT4ge1xuICAgICAgcmV0dXJuICFpc0RlZXBTdHJpY3RFcXVhbChwcm92aWRlckRhdGFba2V5XSwgdXNlclByb3ZpZGVyQXV0aERhdGFba2V5XSk7XG4gICAgfSk7XG5cbiAgICBpZiAoaGFzQ2hhbmdlcykge1xuICAgICAgbXV0YXRlZEF1dGhEYXRhW3Byb3ZpZGVyXSA9IHByb3ZpZGVyRGF0YTtcbiAgICB9XG4gIH0pO1xuICBjb25zdCBoYXNNdXRhdGVkQXV0aERhdGEgPSBPYmplY3Qua2V5cyhtdXRhdGVkQXV0aERhdGEpLmxlbmd0aCAhPT0gMDtcbiAgcmV0dXJuIHsgaGFzTXV0YXRlZEF1dGhEYXRhLCBtdXRhdGVkQXV0aERhdGEgfTtcbn07XG5cbmNvbnN0IGNoZWNrSWZVc2VySGFzUHJvdmlkZWRDb25maWd1cmVkUHJvdmlkZXJzRm9yTG9naW4gPSAoXG4gIHJlcSA9IHt9LFxuICBhdXRoRGF0YSA9IHt9LFxuICB1c2VyQXV0aERhdGEgPSB7fSxcbiAgY29uZmlnXG4pID0+IHtcbiAgY29uc3Qgc2F2ZWRVc2VyUHJvdmlkZXJzID0gT2JqZWN0LmtleXModXNlckF1dGhEYXRhKVxuICAgIC5tYXAocHJvdmlkZXIgPT4ge1xuICAgICAgY29uc3QgdmFsaWRhdG9yID0gY29uZmlnLmF1dGhEYXRhTWFuYWdlci5nZXRWYWxpZGF0b3JGb3JQcm92aWRlcihwcm92aWRlcik7XG4gICAgICBpZiAoIXZhbGlkYXRvciB8fCAhdmFsaWRhdG9yLmFkYXB0ZXIpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICByZXR1cm4geyBuYW1lOiBwcm92aWRlciwgYWRhcHRlcjogdmFsaWRhdG9yLmFkYXB0ZXIgfTtcbiAgICB9KVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG5cbiAgY29uc3QgaGFzUHJvdmlkZWRBU29sb1Byb3ZpZGVyID0gc2F2ZWRVc2VyUHJvdmlkZXJzLnNvbWUoXG4gICAgcHJvdmlkZXIgPT5cbiAgICAgIHByb3ZpZGVyICYmIHByb3ZpZGVyLmFkYXB0ZXIgJiYgcHJvdmlkZXIuYWRhcHRlci5wb2xpY3kgPT09ICdzb2xvJyAmJiBhdXRoRGF0YVtwcm92aWRlci5uYW1lXVxuICApO1xuXG4gIC8vIFNvbG8gcHJvdmlkZXJzIGNhbiBiZSBjb25zaWRlcmVkIGFzIHNhZmUsIHNvIHdlIGRvIG5vdCBoYXZlIHRvIGNoZWNrIGlmIHRoZSB1c2VyIG5lZWRzXG4gIC8vIHRvIHByb3ZpZGUgYW4gYWRkaXRpb25hbCBwcm92aWRlciB0byBsb2dpbi4gQW4gYXV0aCBhZGFwdGVyIHdpdGggXCJzb2xvXCIgKGxpa2Ugd2ViYXV0aG4pIG1lYW5zXG4gIC8vIG5vIFwiYWRkaXRpb25hbFwiIGF1dGggbmVlZHMgdG8gYmUgcHJvdmlkZWQgdG8gbG9naW4gKGxpa2UgT1RQLCBNRkEpXG4gIGlmIChoYXNQcm92aWRlZEFTb2xvUHJvdmlkZXIpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBhZGRpdGlvblByb3ZpZGVyc05vdEZvdW5kID0gW107XG4gIGNvbnN0IGhhc1Byb3ZpZGVkQXRMZWFzdE9uZUFkZGl0aW9uYWxQcm92aWRlciA9IHNhdmVkVXNlclByb3ZpZGVycy5zb21lKHByb3ZpZGVyID0+IHtcbiAgICBsZXQgcG9saWN5ID0gcHJvdmlkZXIuYWRhcHRlci5wb2xpY3k7XG4gICAgaWYgKHR5cGVvZiBwb2xpY3kgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNvbnN0IHJlcXVlc3RPYmplY3QgPSB7XG4gICAgICAgIGlwOiByZXEuY29uZmlnLmlwLFxuICAgICAgICB1c2VyOiByZXEuYXV0aC51c2VyLFxuICAgICAgICBtYXN0ZXI6IHJlcS5hdXRoLmlzTWFzdGVyLFxuICAgICAgfTtcbiAgICAgIHBvbGljeSA9IHBvbGljeS5jYWxsKHByb3ZpZGVyLmFkYXB0ZXIsIHJlcXVlc3RPYmplY3QsIHVzZXJBdXRoRGF0YVtwcm92aWRlci5uYW1lXSk7XG4gICAgfVxuICAgIGlmIChwb2xpY3kgPT09ICdhZGRpdGlvbmFsJykge1xuICAgICAgaWYgKGF1dGhEYXRhW3Byb3ZpZGVyLm5hbWVdKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gUHVzaCBtaXNzaW5nIHByb3ZpZGVyIGZvciBlcnJvciBtZXNzYWdlXG4gICAgICAgIGFkZGl0aW9uUHJvdmlkZXJzTm90Rm91bmQucHVzaChwcm92aWRlci5uYW1lKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuICBpZiAoaGFzUHJvdmlkZWRBdExlYXN0T25lQWRkaXRpb25hbFByb3ZpZGVyIHx8ICFhZGRpdGlvblByb3ZpZGVyc05vdEZvdW5kLmxlbmd0aCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICBQYXJzZS5FcnJvci5PVEhFUl9DQVVTRSxcbiAgICBgTWlzc2luZyBhZGRpdGlvbmFsIGF1dGhEYXRhICR7YWRkaXRpb25Qcm92aWRlcnNOb3RGb3VuZC5qb2luKCcsJyl9YFxuICApO1xufTtcblxuLy8gVmFsaWRhdGUgZWFjaCBhdXRoRGF0YSBzdGVwLWJ5LXN0ZXAgYW5kIHJldHVybiB0aGUgcHJvdmlkZXIgcmVzcG9uc2VzXG5jb25zdCBoYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24gPSBhc3luYyAoYXV0aERhdGEsIHJlcSwgZm91bmRVc2VyKSA9PiB7XG4gIGxldCB1c2VyO1xuICBpZiAoZm91bmRVc2VyKSB7XG4gICAgdXNlciA9IFBhcnNlLlVzZXIuZnJvbUpTT04oeyBjbGFzc05hbWU6ICdfVXNlcicsIC4uLmZvdW5kVXNlciB9KTtcbiAgICAvLyBGaW5kIHVzZXIgYnkgc2Vzc2lvbiBhbmQgY3VycmVudCBvYmplY3RJZDsgb25seSBwYXNzIHVzZXIgaWYgaXQncyB0aGUgY3VycmVudCB1c2VyIG9yIG1hc3RlciBrZXkgaXMgcHJvdmlkZWRcbiAgfSBlbHNlIGlmIChcbiAgICAocmVxLmF1dGggJiZcbiAgICAgIHJlcS5hdXRoLnVzZXIgJiZcbiAgICAgIHR5cGVvZiByZXEuZ2V0VXNlcklkID09PSAnZnVuY3Rpb24nICYmXG4gICAgICByZXEuZ2V0VXNlcklkKCkgPT09IHJlcS5hdXRoLnVzZXIuaWQpIHx8XG4gICAgKHJlcS5hdXRoICYmIHJlcS5hdXRoLmlzTWFzdGVyICYmIHR5cGVvZiByZXEuZ2V0VXNlcklkID09PSAnZnVuY3Rpb24nICYmIHJlcS5nZXRVc2VySWQoKSlcbiAgKSB7XG4gICAgdXNlciA9IG5ldyBQYXJzZS5Vc2VyKCk7XG4gICAgdXNlci5pZCA9IHJlcS5hdXRoLmlzTWFzdGVyID8gcmVxLmdldFVzZXJJZCgpIDogcmVxLmF1dGgudXNlci5pZDtcbiAgICBhd2FpdCB1c2VyLmZldGNoKHsgdXNlTWFzdGVyS2V5OiB0cnVlIH0pO1xuICB9XG5cbiAgY29uc3QgeyB1cGRhdGVkT2JqZWN0IH0gPSByZXEuYnVpbGRQYXJzZU9iamVjdHMoKTtcbiAgY29uc3QgcmVxdWVzdE9iamVjdCA9IGdldFJlcXVlc3RPYmplY3QodW5kZWZpbmVkLCByZXEuYXV0aCwgdXBkYXRlZE9iamVjdCwgdXNlciwgcmVxLmNvbmZpZyk7XG4gIC8vIFBlcmZvcm0gdmFsaWRhdGlvbiBhcyBzdGVwLWJ5LXN0ZXAgcGlwZWxpbmUgZm9yIGJldHRlciBlcnJvciBjb25zaXN0ZW5jeVxuICAvLyBhbmQgYWxzbyB0byBhdm9pZCB0byB0cmlnZ2VyIGEgcHJvdmlkZXIgKGxpa2UgT1RQIFNNUykgaWYgYW5vdGhlciBvbmUgZmFpbHNcbiAgY29uc3QgYWNjID0geyBhdXRoRGF0YToge30sIGF1dGhEYXRhUmVzcG9uc2U6IHt9IH07XG4gIGNvbnN0IGF1dGhLZXlzID0gT2JqZWN0LmtleXMoYXV0aERhdGEpLnNvcnQoKTtcbiAgZm9yIChjb25zdCBwcm92aWRlciBvZiBhdXRoS2V5cykge1xuICAgIGxldCBtZXRob2QgPSAnJztcbiAgICB0cnkge1xuICAgICAgaWYgKGF1dGhEYXRhW3Byb3ZpZGVyXSA9PT0gbnVsbCkge1xuICAgICAgICBhY2MuYXV0aERhdGFbcHJvdmlkZXJdID0gbnVsbDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCB7IHZhbGlkYXRvciB9ID0gcmVxLmNvbmZpZy5hdXRoRGF0YU1hbmFnZXIuZ2V0VmFsaWRhdG9yRm9yUHJvdmlkZXIocHJvdmlkZXIpIHx8IHt9O1xuICAgICAgY29uc3QgYXV0aFByb3ZpZGVyID0gKHJlcS5jb25maWcuYXV0aCB8fCB7fSlbcHJvdmlkZXJdIHx8IHt9O1xuICAgICAgaWYgKCF2YWxpZGF0b3IgfHwgYXV0aFByb3ZpZGVyLmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5VTlNVUFBPUlRFRF9TRVJWSUNFLFxuICAgICAgICAgICdUaGlzIGF1dGhlbnRpY2F0aW9uIG1ldGhvZCBpcyB1bnN1cHBvcnRlZC4nXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBsZXQgdmFsaWRhdGlvblJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvcihhdXRoRGF0YVtwcm92aWRlcl0sIHJlcSwgdXNlciwgcmVxdWVzdE9iamVjdCk7XG4gICAgICBtZXRob2QgPSB2YWxpZGF0aW9uUmVzdWx0ICYmIHZhbGlkYXRpb25SZXN1bHQubWV0aG9kO1xuICAgICAgcmVxdWVzdE9iamVjdC50cmlnZ2VyTmFtZSA9IG1ldGhvZDtcbiAgICAgIGlmICh2YWxpZGF0aW9uUmVzdWx0ICYmIHZhbGlkYXRpb25SZXN1bHQudmFsaWRhdG9yKSB7XG4gICAgICAgIHZhbGlkYXRpb25SZXN1bHQgPSBhd2FpdCB2YWxpZGF0aW9uUmVzdWx0LnZhbGlkYXRvcigpO1xuICAgICAgfVxuICAgICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0KSB7XG4gICAgICAgIGFjYy5hdXRoRGF0YVtwcm92aWRlcl0gPSBhdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFPYmplY3Qua2V5cyh2YWxpZGF0aW9uUmVzdWx0KS5sZW5ndGgpIHtcbiAgICAgICAgYWNjLmF1dGhEYXRhW3Byb3ZpZGVyXSA9IGF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmICh2YWxpZGF0aW9uUmVzdWx0LnJlc3BvbnNlKSB7XG4gICAgICAgIGFjYy5hdXRoRGF0YVJlc3BvbnNlW3Byb3ZpZGVyXSA9IHZhbGlkYXRpb25SZXN1bHQucmVzcG9uc2U7XG4gICAgICB9XG4gICAgICAvLyBTb21lIGF1dGggcHJvdmlkZXJzIGFmdGVyIGluaXRpYWxpemF0aW9uIHdpbGwgYXZvaWQgdG8gcmVwbGFjZSBhdXRoRGF0YSBhbHJlYWR5IHN0b3JlZFxuICAgICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0LmRvTm90U2F2ZSkge1xuICAgICAgICBhY2MuYXV0aERhdGFbcHJvdmlkZXJdID0gdmFsaWRhdGlvblJlc3VsdC5zYXZlIHx8IGF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IGUgPSByZXNvbHZlRXJyb3IoZXJyLCB7XG4gICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLlNDUklQVF9GQUlMRUQsXG4gICAgICAgIG1lc3NhZ2U6ICdBdXRoIGZhaWxlZC4gVW5rbm93biBlcnJvci4nLFxuICAgICAgfSk7XG4gICAgICBjb25zdCB1c2VyU3RyaW5nID1cbiAgICAgICAgcmVxLmF1dGggJiYgcmVxLmF1dGgudXNlciA/IHJlcS5hdXRoLnVzZXIuaWQgOiByZXEuZGF0YS5vYmplY3RJZCB8fCB1bmRlZmluZWQ7XG4gICAgICBsb2dnZXIuZXJyb3IoXG4gICAgICAgIGBGYWlsZWQgcnVubmluZyBhdXRoIHN0ZXAgJHttZXRob2R9IGZvciAke3Byb3ZpZGVyfSBmb3IgdXNlciAke3VzZXJTdHJpbmd9IHdpdGggRXJyb3I6IGAgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGUpLFxuICAgICAgICB7XG4gICAgICAgICAgYXV0aGVudGljYXRpb25TdGVwOiBtZXRob2QsXG4gICAgICAgICAgZXJyb3I6IGUsXG4gICAgICAgICAgdXNlcjogdXNlclN0cmluZyxcbiAgICAgICAgICBwcm92aWRlcixcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG4gIHJldHVybiBhY2M7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgQXV0aCxcbiAgbWFzdGVyLFxuICBtYWludGVuYW5jZSxcbiAgbm9ib2R5LFxuICByZWFkT25seSxcbiAgc2hvdWxkVXBkYXRlU2Vzc2lvbkV4cGlyeSxcbiAgZ2V0QXV0aEZvclNlc3Npb25Ub2tlbixcbiAgZ2V0QXV0aEZvckxlZ2FjeVNlc3Npb25Ub2tlbixcbiAgZmluZFVzZXJzV2l0aEF1dGhEYXRhLFxuICBoYXNNdXRhdGVkQXV0aERhdGEsXG4gIGNoZWNrSWZVc2VySGFzUHJvdmlkZWRDb25maWd1cmVkUHJvdmlkZXJzRm9yTG9naW4sXG4gIGhhbmRsZUF1dGhEYXRhVmFsaWRhdGlvbixcbn07XG4iXSwibWFwcGluZ3MiOiI7O0FBQ0EsSUFBQUEsS0FBQSxHQUFBQyxPQUFBO0FBQ0EsSUFBQUMsU0FBQSxHQUFBRCxPQUFBO0FBQ0EsSUFBQUUsT0FBQSxHQUFBRixPQUFBO0FBQ0EsSUFBQUcsU0FBQSxHQUFBSCxPQUFBO0FBQ0EsSUFBQUksVUFBQSxHQUFBQyxzQkFBQSxDQUFBTCxPQUFBO0FBQ0EsSUFBQU0sVUFBQSxHQUFBRCxzQkFBQSxDQUFBTCxPQUFBO0FBQW9DLFNBQUFLLHVCQUFBRSxDQUFBLFdBQUFBLENBQUEsSUFBQUEsQ0FBQSxDQUFBQyxVQUFBLEdBQUFELENBQUEsS0FBQUUsT0FBQSxFQUFBRixDQUFBO0FBTnBDLE1BQU1HLEtBQUssR0FBR1YsT0FBTyxDQUFDLFlBQVksQ0FBQztBQVFuQztBQUNBO0FBQ0E7QUFDQSxTQUFTVyxJQUFJQSxDQUFDO0VBQ1pDLE1BQU07RUFDTkMsZUFBZSxHQUFHQyxTQUFTO0VBQzNCQyxRQUFRLEdBQUcsS0FBSztFQUNoQkMsYUFBYSxHQUFHLEtBQUs7RUFDckJDLFVBQVUsR0FBRyxLQUFLO0VBQ2xCQyxJQUFJO0VBQ0pDO0FBQ0YsQ0FB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