"use strict";

// An object that encapsulates everything we need to run a 'find'
// operation, encoded in the REST API format.

var SchemaController = require('./Controllers/SchemaController');
var Parse = require('parse/node').Parse;
var logger = require('./logger').default;
const triggers = require('./triggers');
const {
  continueWhile
} = require('parse/lib/node/promiseUtils');
const AlwaysSelectedKeys = ['objectId', 'createdAt', 'updatedAt', 'ACL'];
const {
  enforceRoleSecurity
} = require('./SharedRest');
const {
  createSanitizedError
} = require('./Error');

// restOptions can include:
//   skip
//   limit
//   order
//   count
//   include
//   keys
//   excludeKeys
//   redirectClassNameForKey
//   readPreference
//   includeReadPreference
//   subqueryReadPreference
/**
 * Use to perform a query on a class. It will run security checks and triggers.
 * @param options
 * @param options.method {RestQuery.Method} The type of query to perform
 * @param options.config {ParseServerConfiguration} The server configuration
 * @param options.auth {Auth} The auth object for the request
 * @param options.className {string} The name of the class to query
 * @param options.restWhere {object} The where object for the query
 * @param options.restOptions {object} The options object for the query
 * @param options.clientSDK {string} The client SDK that is performing the query
 * @param options.runAfterFind {boolean} Whether to run the afterFind trigger
 * @param options.runBeforeFind {boolean} Whether to run the beforeFind trigger
 * @param options.context {object} The context object for the query
 * @returns {Promise<_UnsafeRestQuery>} A promise that is resolved with the _UnsafeRestQuery object
 */
async function RestQuery({
  method,
  config,
  auth,
  className,
  restWhere = {},
  restOptions = {},
  clientSDK,
  runAfterFind = true,
  runBeforeFind = true,
  context
}) {
  if (![RestQuery.Method.find, RestQuery.Method.get].includes(method)) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'bad query type');
  }
  const isGet = method === RestQuery.Method.get;
  enforceRoleSecurity(method, className, auth, config);
  const result = runBeforeFind ? await triggers.maybeRunQueryTrigger(triggers.Types.beforeFind, className, restWhere, restOptions, config, auth, context, isGet) : Promise.resolve({
    restWhere,
    restOptions
  });
  return new _UnsafeRestQuery(config, auth, className, result.restWhere || restWhere, result.restOptions || restOptions, clientSDK, runAfterFind, context, isGet);
}
RestQuery.Method = Object.freeze({
  get: 'get',
  find: 'find'
});

/**
 * _UnsafeRestQuery is meant for specific internal usage only. When you need to skip security checks or some triggers.
 * Don't use it if you don't know what you are doing.
 * @param config
 * @param auth
 * @param className
 * @param restWhere
 * @param restOptions
 * @param clientSDK
 * @param runAfterFind
 * @param context
 */
function _UnsafeRestQuery(config, auth, className, restWhere = {}, restOptions = {}, clientSDK, runAfterFind = true, context, isGet) {
  this.config = config;
  this.auth = auth;
  this.className = className;
  this.restWhere = restWhere;
  this.restOptions = restOptions;
  this.clientSDK = clientSDK;
  this.runAfterFind = runAfterFind;
  this.response = null;
  this.findOptions = {};
  this.context = context || {};
  this.isGet = isGet;
  if (!this.auth.isMaster) {
    if (this.className == '_Session') {
      if (!this.auth.user) {
        throw createSanitizedError(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token', config);
      }
      this.restWhere = {
        $and: [this.restWhere, {
          user: {
            __type: 'Pointer',
            className: '_User',
            objectId: this.auth.user.id
          }
        }]
      };
    }
  }
  this.doCount = false;
  this.includeAll = false;

  // The format for this.include is not the same as the format for the
  // include option - it's the paths we should include, in order,
  // stored as arrays, taking into account that we need to include foo
  // before including foo.bar. Also it should dedupe.
  // For example, passing an arg of include=foo.bar,foo.baz could lead to
  // this.include = [['foo'], ['foo', 'baz'], ['foo', 'bar']]
  this.include = [];
  let keysForInclude = '';

  // If we have keys, we probably want to force some includes (n-1 level)
  // See issue: https://github.com/parse-community/parse-server/issues/3185
  if (Object.prototype.hasOwnProperty.call(restOptions, 'keys')) {
    keysForInclude = restOptions.keys;
  }

  // If we have keys, we probably want to force some includes (n-1 level)
  // in order to exclude specific keys.
  if (Object.prototype.hasOwnProperty.call(restOptions, 'excludeKeys')) {
    keysForInclude += ',' + restOptions.excludeKeys;
  }
  if (keysForInclude.length > 0) {
    keysForInclude = keysForInclude.split(',').filter(key => {
      // At least 2 components
      return key.split('.').length > 1;
    }).map(key => {
      // Slice the last component (a.b.c -> a.b)
      // Otherwise we'll include one level too much.
      return key.slice(0, key.lastIndexOf('.'));
    }).join(',');

    // Concat the possibly present include string with the one from the keys
    // Dedup / sorting is handle in 'include' case.
    if (keysForInclude.length > 0) {
      if (!restOptions.include || restOptions.include.length == 0) {
        restOptions.include = keysForInclude;
      } else {
        restOptions.include += ',' + keysForInclude;
      }
    }
  }
  for (var option in restOptions) {
    switch (option) {
      case 'keys':
        {
          const keys = restOptions.keys.split(',').filter(key => key.length > 0).concat(AlwaysSelectedKeys);
          this.keys = Array.from(new Set(keys));
          break;
        }
      case 'excludeKeys':
        {
          const exclude = restOptions.excludeKeys.split(',').filter(k => AlwaysSelectedKeys.indexOf(k) < 0);
          this.excludeKeys = Array.from(new Set(exclude));
          break;
        }
      case 'count':
        this.doCount = true;
        break;
      case 'includeAll':
        this.includeAll = true;
        break;
      case 'explain':
      case 'hint':
      case 'distinct':
      case 'pipeline':
      case 'skip':
      case 'limit':
      case 'readPreference':
      case 'comment':
      case 'rawValues':
      case 'rawFieldNames':
        this.findOptions[option] = restOptions[option];
        break;
      case 'order':
        var fields = restOptions.order.split(',');
        this.findOptions.sort = fields.reduce((sortMap, field) => {
          field = field.trim();
          if (field === '$score' || field === '-$score') {
            sortMap.score = {
              $meta: 'textScore'
            };
          } else if (field[0] == '-') {
            sortMap[field.slice(1)] = -1;
          } else {
            sortMap[field] = 1;
          }
          return sortMap;
        }, {});
        break;
      case 'include':
        {
          const paths = restOptions.include.split(',');
          if (paths.includes('*')) {
            this.includeAll = true;
            break;
          }
          // Load the existing includes (from keys)
          const pathSet = paths.reduce((memo, path) => {
            // Split each paths on . (a.b.c -> [a,b,c])
            // reduce to create all paths
            // ([a,b,c] -> {a: true, 'a.b': true, 'a.b.c': true})
            return path.split('.').reduce((memo, path, index, parts) => {
              memo[parts.slice(0, index + 1).join('.')] = true;
              return memo;
            }, memo);
          }, {});
          this.include = Object.keys(pathSet).map(s => {
            return s.split('.');
          }).sort((a, b) => {
            return a.length - b.length; // Sort by number of components
          });
          break;
        }
      case 'redirectClassNameForKey':
        this.redirectKey = restOptions.redirectClassNameForKey;
        this.redirectClassName = null;
        break;
      case 'includeReadPreference':
      case 'subqueryReadPreference':
        break;
      default:
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad option: ' + option);
    }
  }
}

// A convenient method to perform all the steps of processing a query
// in order.
// Returns a promise for the response - an object with optional keys
// 'results' and 'count'.
// TODO: consolidate the replaceX functions
_UnsafeRestQuery.prototype.execute = function (executeOptions) {
  return Promise.resolve().then(() => {
    return this.validateQueryDepth();
  }).then(() => {
    return this.buildRestWhere();
  }).then(() => {
    return this.denyProtectedFields();
  }).then(() => {
    return this.handleIncludeAll();
  }).then(() => {
    return this.validateIncludeComplexity();
  }).then(() => {
    return this.handleExcludeKeys();
  }).then(() => {
    return this.runFind(executeOptions);
  }).then(() => {
    return this.runCount();
  }).then(() => {
    return this.handleInclude();
  }).then(() => {
    return this.runAfterFindTrigger();
  }).then(() => {
    return this.handleAuthAdapters();
  }).then(() => {
    return this.response;
  });
};
_UnsafeRestQuery.prototype.each = function (callback) {
  const {
    config,
    auth,
    className,
    restWhere,
    restOptions,
    clientSDK
  } = this;
  // if the limit is set, use it
  restOptions.limit = restOptions.limit || 100;
  restOptions.order = 'objectId';
  let finished = false;
  return continueWhile(() => {
    return !finished;
  }, async () => {
    // Safe here to use _UnsafeRestQuery because the security was already
    // checked during "await RestQuery()"
    const query = new _UnsafeRestQuery(config, auth, className, restWhere, restOptions, clientSDK, this.runAfterFind, this.context);
    const {
      results
    } = await query.execute();
    results.forEach(callback);
    finished = results.length < restOptions.limit;
    if (!finished) {
      restWhere.objectId = Object.assign({}, restWhere.objectId, {
        $gt: results[results.length - 1].objectId
      });
    }
  });
};
_UnsafeRestQuery.prototype.validateQueryDepth = function () {
  if (this.auth.isMaster || this.auth.isMaintenance) {
    return;
  }
  const rc = this.config.requestComplexity;
  if (!rc || rc.queryDepth === -1) {
    return;
  }
  const maxDepth = rc.queryDepth;
  const checkDepth = (where, depth) => {
    if (depth > maxDepth) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, `Query condition nesting depth exceeds maximum allowed depth of ${maxDepth}`);
    }
    if (typeof where !== 'object' || where === null) {
      return;
    }
    for (const op of ['$or', '$and', '$nor']) {
      if (Array.isArray(where[op])) {
        for (const subQuery of where[op]) {
          checkDepth(subQuery, depth + 1);
        }
      }
    }
  };
  checkDepth(this.restWhere, 0);
};
_UnsafeRestQuery.prototype.buildRestWhere = function () {
  return Promise.resolve().then(() => {
    return this.getUserAndRoleACL();
  }).then(() => {
    return this.redirectClassNameForKey();
  }).then(() => {
    return this.validateClientClassCreation();
  }).then(() => {
    return this.checkSubqueryDepth();
  }).then(() => {
    return this.replaceSelect();
  }).then(() => {
    return this.replaceDontSelect();
  }).then(() => {
    return this.replaceInQuery();
  }).then(() => {
    return this.replaceNotInQuery();
  }).then(() => {
    return this.replaceEquality();
  });
};

// Uses the Auth object to get the list of roles, adds the user id
_UnsafeRestQuery.prototype.getUserAndRoleACL = function () {
  if (this.auth.isMaster) {
    return Promise.resolve();
  }
  this.findOptions.acl = ['*'];
  if (this.auth.user) {
    return this.auth.getUserRoles().then(roles => {
      this.findOptions.acl = this.findOptions.acl.concat(roles, [this.auth.user.id]);
      return;
    });
  } else {
    return Promise.resolve();
  }
};

// Changes the className if redirectClassNameForKey is set.
// Returns a promise.
_UnsafeRestQuery.prototype.redirectClassNameForKey = function () {
  if (!this.redirectKey) {
    return Promise.resolve();
  }

  // We need to change the class name based on the schema
  return this.config.database.redirectClassNameForKey(this.className, this.redirectKey).then(newClassName => {
    this.className = newClassName;
    this.redirectClassName = newClassName;

    // Re-apply security checks for the redirected class name, since the
    // checks in the constructor and in rest.find ran against the original
    // class name before the redirect.
    if (!this.auth.isMaster) {
      enforceRoleSecurity('find', this.className, this.auth, this.config);
      if (this.className === '_Session') {
        if (!this.auth.user) {
          throw createSanitizedError(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token', this.config);
        }
        this.restWhere = {
          $and: [this.restWhere, {
            user: {
              __type: 'Pointer',
              className: '_User',
              objectId: this.auth.user.id
            }
          }]
        };
      }
    }
  });
};

// Validates this operation against the allowClientClassCreation config.
_UnsafeRestQuery.prototype.validateClientClassCreation = function () {
  if (this.config.allowClientClassCreation === false && !this.auth.isMaster && SchemaController.systemClasses.indexOf(this.className) === -1) {
    return this.config.database.loadSchema().then(schemaController => schemaController.hasClass(this.className)).then(hasClass => {
      if (hasClass !== true) {
        throw createSanitizedError(Parse.Error.OPERATION_FORBIDDEN, 'This user is not allowed to access ' + 'non-existent class: ' + this.className, this.config);
      }
    });
  } else {
    return Promise.resolve();
  }
};
function transformInQuery(inQueryObject, className, results) {
  var values = [];
  for (var result of results) {
    values.push({
      __type: 'Pointer',
      className: className,
      objectId: result.objectId
    });
  }
  delete inQueryObject['$inQuery'];
  if (Array.isArray(inQueryObject['$in'])) {
    inQueryObject['$in'] = inQueryObject['$in'].concat(values);
  } else {
    inQueryObject['$in'] = values;
  }
}
_UnsafeRestQuery.prototype.checkSubqueryDepth = function () {
  if (this.auth.isMaster || this.auth.isMaintenance) {
    return;
  }
  const rc = this.config.requestComplexity;
  if (!rc || rc.subqueryDepth === -1) {
    return;
  }
  const depth = this.context._subqueryDepth || 0;
  if (depth > rc.subqueryDepth) {
    const message = `Subquery nesting depth exceeds maximum allowed depth of ${rc.subqueryDepth}`;
    logger.warn(message);
    throw new Parse.Error(Parse.Error.INVALID_QUERY, message);
  }
};

// Replaces a $inQuery clause by running the subquery, if there is an
// $inQuery clause.
// The $inQuery clause turns into an $in with values that are just
// pointers to the objects returned in the subquery.
_UnsafeRestQuery.prototype.replaceInQuery = async function () {
  var inQueryObject = findObjectWithKey(this.restWhere, '$inQuery');
  if (!inQueryObject) {
    return;
  }

  // The inQuery value must have precisely two keys - where and className
  var inQueryValue = inQueryObject['$inQuery'];
  if (!inQueryValue.where || !inQueryValue.className) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $inQuery');
  }
  const additionalOptions = {
    redirectClassNameForKey: inQueryValue.redirectClassNameForKey
  };
  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  } else if (this.restOptions.readPreference) {
    additionalOptions.readPreference = this.restOptions.readPreference;
  }
  if (!this.auth.isMaster && !this.auth.isMaintenance) {
    const rc = this.config.requestComplexity;
    if (rc && rc.subqueryLimit > 0) {
      additionalOptions.limit = rc.subqueryLimit;
    }
  }
  const childContext = {
    ...this.context,
    _subqueryDepth: (this.context._subqueryDepth || 0) + 1
  };
  const subquery = await RestQuery({
    method: RestQuery.Method.find,
    config: this.config,
    auth: this.auth,
    className: inQueryValue.className,
    restWhere: inQueryValue.where,
    restOptions: additionalOptions,
    context: childContext
  });
  return subquery.execute().then(response => {
    transformInQuery(inQueryObject, subquery.className, response.results);
    // Recurse to repeat
    return this.replaceInQuery();
  });
};
function transformNotInQuery(notInQueryObject, className, results) {
  var values = [];
  for (var result of results) {
    values.push({
      __type: 'Pointer',
      className: className,
      objectId: result.objectId
    });
  }
  delete notInQueryObject['$notInQuery'];
  if (Array.isArray(notInQueryObject['$nin'])) {
    notInQueryObject['$nin'] = notInQueryObject['$nin'].concat(values);
  } else {
    notInQueryObject['$nin'] = values;
  }
}

// Replaces a $notInQuery clause by running the subquery, if there is an
// $notInQuery clause.
// The $notInQuery clause turns into a $nin with values that are just
// pointers to the objects returned in the subquery.
_UnsafeRestQuery.prototype.replaceNotInQuery = async function () {
  var notInQueryObject = findObjectWithKey(this.restWhere, '$notInQuery');
  if (!notInQueryObject) {
    return;
  }

  // The notInQuery value must have precisely two keys - where and className
  var notInQueryValue = notInQueryObject['$notInQuery'];
  if (!notInQueryValue.where || !notInQueryValue.className) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $notInQuery');
  }
  const additionalOptions = {
    redirectClassNameForKey: notInQueryValue.redirectClassNameForKey
  };
  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  } else if (this.restOptions.readPreference) {
    additionalOptions.readPreference = this.restOptions.readPreference;
  }
  if (!this.auth.isMaster && !this.auth.isMaintenance) {
    const rc = this.config.requestComplexity;
    if (rc && rc.subqueryLimit > 0) {
      additionalOptions.limit = rc.subqueryLimit;
    }
  }
  const childContext = {
    ...this.context,
    _subqueryDepth: (this.context._subqueryDepth || 0) + 1
  };
  const subquery = await RestQuery({
    method: RestQuery.Method.find,
    config: this.config,
    auth: this.auth,
    className: notInQueryValue.className,
    restWhere: notInQueryValue.where,
    restOptions: additionalOptions,
    context: childContext
  });
  return subquery.execute().then(response => {
    transformNotInQuery(notInQueryObject, subquery.className, response.results);
    // Recurse to repeat
    return this.replaceNotInQuery();
  });
};

// Used to get the deepest object from json using dot notation.
const getDeepestObjectFromKey = (json, key, idx, src) => {
  if (key in json) {
    return json[key];
  }
  src.splice(1); // Exit Early
};
const transformSelect = (selectObject, key, objects) => {
  var values = [];
  for (var result of objects) {
    values.push(key.split('.').reduce(getDeepestObjectFromKey, result));
  }
  delete selectObject['$select'];
  if (Array.isArray(selectObject['$in'])) {
    selectObject['$in'] = selectObject['$in'].concat(values);
  } else {
    selectObject['$in'] = values;
  }
};

// Replaces a $select clause by running the subquery, if there is a
// $select clause.
// The $select clause turns into an $in with values selected out of
// the subquery.
// Returns a possible-promise.
_UnsafeRestQuery.prototype.replaceSelect = async function () {
  var selectObject = findObjectWithKey(this.restWhere, '$select');
  if (!selectObject) {
    return;
  }

  // The select value must have precisely two keys - query and key
  var selectValue = selectObject['$select'];
  // iOS SDK don't send where if not set, let it pass
  if (!selectValue.query || !selectValue.key || typeof selectValue.query !== 'object' || !selectValue.query.className || Object.keys(selectValue).length !== 2) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $select');
  }
  const additionalOptions = {
    redirectClassNameForKey: selectValue.query.redirectClassNameForKey
  };
  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  } else if (this.restOptions.readPreference) {
    additionalOptions.readPreference = this.restOptions.readPreference;
  }
  if (!this.auth.isMaster && !this.auth.isMaintenance) {
    const rc = this.config.requestComplexity;
    if (rc && rc.subqueryLimit > 0) {
      additionalOptions.limit = rc.subqueryLimit;
    }
  }
  const childContext = {
    ...this.context,
    _subqueryDepth: (this.context._subqueryDepth || 0) + 1
  };
  const subquery = await RestQuery({
    method: RestQuery.Method.find,
    config: this.config,
    auth: this.auth,
    className: selectValue.query.className,
    restWhere: selectValue.query.where,
    restOptions: additionalOptions,
    context: childContext
  });
  return subquery.execute().then(response => {
    transformSelect(selectObject, selectValue.key, response.results);
    // Keep replacing $select clauses
    return this.replaceSelect();
  });
};
const transformDontSelect = (dontSelectObject, key, objects) => {
  var values = [];
  for (var result of objects) {
    values.push(key.split('.').reduce(getDeepestObjectFromKey, result));
  }
  delete dontSelectObject['$dontSelect'];
  if (Array.isArray(dontSelectObject['$nin'])) {
    dontSelectObject['$nin'] = dontSelectObject['$nin'].concat(values);
  } else {
    dontSelectObject['$nin'] = values;
  }
};

// Replaces a $dontSelect clause by running the subquery, if there is a
// $dontSelect clause.
// The $dontSelect clause turns into an $nin with values selected out of
// the subquery.
// Returns a possible-promise.
_UnsafeRestQuery.prototype.replaceDontSelect = async function () {
  var dontSelectObject = findObjectWithKey(this.restWhere, '$dontSelect');
  if (!dontSelectObject) {
    return;
  }

  // The dontSelect value must have precisely two keys - query and key
  var dontSelectValue = dontSelectObject['$dontSelect'];
  if (!dontSelectValue.query || !dontSelectValue.key || typeof dontSelectValue.query !== 'object' || !dontSelectValue.query.className || Object.keys(dontSelectValue).length !== 2) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $dontSelect');
  }
  const additionalOptions = {
    redirectClassNameForKey: dontSelectValue.query.redirectClassNameForKey
  };
  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  } else if (this.restOptions.readPreference) {
    additionalOptions.readPreference = this.restOptions.readPreference;
  }
  if (!this.auth.isMaster && !this.auth.isMaintenance) {
    const rc = this.config.requestComplexity;
    if (rc && rc.subqueryLimit > 0) {
      additionalOptions.limit = rc.subqueryLimit;
    }
  }
  const childContext = {
    ...this.context,
    _subqueryDepth: (this.context._subqueryDepth || 0) + 1
  };
  const subquery = await RestQuery({
    method: RestQuery.Method.find,
    config: this.config,
    auth: this.auth,
    className: dontSelectValue.query.className,
    restWhere: dontSelectValue.query.where,
    restOptions: additionalOptions,
    context: childContext
  });
  return subquery.execute().then(response => {
    transformDontSelect(dontSelectObject, dontSelectValue.key, response.results);
    // Keep replacing $dontSelect clauses
    return this.replaceDontSelect();
  });
};
_UnsafeRestQuery.prototype.cleanResultAuthData = function (result) {
  delete result.password;
  if (result.authData) {
    Object.keys(result.authData).forEach(provider => {
      if (result.authData[provider] === null) {
        delete result.authData[provider];
      }
    });
    if (Object.keys(result.authData).length == 0) {
      delete result.authData;
    }
  }
};
const replaceEqualityConstraint = constraint => {
  if (typeof constraint !== 'object') {
    return constraint;
  }
  const equalToObject = {};
  let hasDirectConstraint = false;
  let hasOperatorConstraint = false;
  for (const key in constraint) {
    if (key.indexOf('$') !== 0) {
      hasDirectConstraint = true;
      equalToObject[key] = constraint[key];
    } else {
      hasOperatorConstraint = true;
    }
  }
  if (hasDirectConstraint && hasOperatorConstraint) {
    constraint['$eq'] = equalToObject;
    Object.keys(equalToObject).forEach(key => {
      delete constraint[key];
    });
  }
  return constraint;
};
_UnsafeRestQuery.prototype.replaceEquality = function () {
  if (typeof this.restWhere !== 'object') {
    return;
  }
  for (const key in this.restWhere) {
    this.restWhere[key] = replaceEqualityConstraint(this.restWhere[key]);
  }
};

// Returns a promise for whether it was successful.
// Populates this.response with an object that only has 'results'.
_UnsafeRestQuery.prototype.runFind = async function (options = {}) {
  if (this.findOptions.limit === 0) {
    this.response = {
      results: []
    };
    return Promise.resolve();
  }
  const findOptions = Object.assign({}, this.findOptions);
  if (this.keys) {
    findOptions.keys = this.keys.map(key => {
      return key.split('.')[0];
    });
    // When selecting `authData` on `_User`, also add the internal auth data fields
    // (e.g. `_auth_data_facebook`) for each configured auth provider. In MongoDB,
    // `authData` is stored as individual `_auth_data_<provider>` fields, so the
    // projection for `authData` alone won't match them. Adding both ensures it
    // works across all database adapters: Mongo uses `_auth_data_*` fields,
    // Postgres uses the `authData` column directly.
    //
    // Note: When selecting `authData`, only auth data of currently configured
    // providers is returned. Auth data entries of providers that are no longer
    // configured won't be included. To return all auth data regardless of the
    // provider configuration, do not use `authData` as a selected key.
    if (this.className === '_User' && findOptions.keys.includes('authData')) {
      const providers = this.config.authDataManager.getProviders();
      for (const provider of providers) {
        const key = `_auth_data_${provider}`;
        if (!findOptions.keys.includes(key)) {
          findOptions.keys.push(key);
        }
      }
    }
  }
  if (options.op) {
    findOptions.op = options.op;
  }
  const results = await this.config.database.find(this.className, this.restWhere, findOptions, this.auth);
  if (this.className === '_User' && !findOptions.explain) {
    for (var result of results) {
      this.cleanResultAuthData(result);
    }
  }
  await this.config.filesController.expandFilesInObject(this.config, results);
  if (this.redirectClassName) {
    for (var r of results) {
      r.className = this.redirectClassName;
    }
  }
  this.response = {
    results: results
  };
};

// Returns a promise for whether it was successful.
// Populates this.response.count with the count
_UnsafeRestQuery.prototype.runCount = function () {
  if (!this.doCount) {
    return;
  }
  this.findOptions.count = true;
  delete this.findOptions.skip;
  delete this.findOptions.limit;
  return this.config.database.find(this.className, this.restWhere, this.findOptions).then(c => {
    this.response.count = c;
  });
};
_UnsafeRestQuery.prototype.denyProtectedFields = async function () {
  if (this.auth.isMaster || this.auth.isMaintenance) {
    return;
  }
  const schemaController = await this.config.database.loadSchema();
  const protectedFields = this.config.database.addProtectedFields(schemaController, this.className, this.restWhere, this.findOptions.acl, this.auth, this.findOptions) || [];
  const checkWhere = where => {
    if (typeof where !== 'object' || where === null) {
      return;
    }
    for (const whereKey of Object.keys(where)) {
      const rootField = whereKey.split('.')[0];
      if (protectedFields.includes(whereKey) || protectedFields.includes(rootField)) {
        throw createSanitizedError(Parse.Error.OPERATION_FORBIDDEN, `This user is not allowed to query ${whereKey} on class ${this.className}`, this.config);
      }
    }
    for (const op of ['$or', '$and', '$nor']) {
      if (where[op] !== undefined && !Array.isArray(where[op])) {
        throw createSanitizedError(Parse.Error.INVALID_QUERY, `${op} must be an array`, this.config);
      }
      if (Array.isArray(where[op])) {
        where[op].forEach(subQuery => checkWhere(subQuery));
      }
    }
  };
  checkWhere(this.restWhere);

  // Check sort keys against protected fields
  if (this.findOptions.sort) {
    for (const sortKey of Object.keys(this.findOptions.sort)) {
      const rootField = sortKey.split('.')[0];
      if (protectedFields.includes(sortKey) || protectedFields.includes(rootField)) {
        throw createSanitizedError(Parse.Error.OPERATION_FORBIDDEN, `This user is not allowed to sort by ${sortKey} on class ${this.className}`, this.config);
      }
    }
  }
};

// Augments this.response with all pointers on an object
_UnsafeRestQuery.prototype.handleIncludeAll = function () {
  if (!this.includeAll) {
    return;
  }
  return this.config.database.loadSchema().then(schemaController => schemaController.getOneSchema(this.className)).then(schema => {
    const includeFields = [];
    const keyFields = [];
    for (const field in schema.fields) {
      if (schema.fields[field].type && schema.fields[field].type === 'Pointer' || schema.fields[field].type && schema.fields[field].type === 'Array') {
        includeFields.push([field]);
        keyFields.push(field);
      }
    }
    // Add fields to include, keys, remove dups
    this.include = [...new Set([...this.include, ...includeFields])];
    // if this.keys not set, then all keys are already included
    if (this.keys) {
      this.keys = [...new Set([...this.keys, ...keyFields])];
    }
  });
};
_UnsafeRestQuery.prototype.validateIncludeComplexity = function () {
  if (this.auth.isMaster || this.auth.isMaintenance) {
    return;
  }
  const rc = this.config.requestComplexity;
  if (!rc) {
    return;
  }
  if (rc.includeDepth !== -1 && this.include && this.include.length > 0) {
    const maxDepth = Math.max(...this.include.map(path => path.length));
    if (maxDepth > rc.includeDepth) {
      const message = `Include depth of ${maxDepth} exceeds maximum allowed depth of ${rc.includeDepth}`;
      logger.warn(message);
      throw new Parse.Error(Parse.Error.INVALID_QUERY, message);
    }
  }
  if (rc.includeCount !== -1 && this.include && this.include.length > rc.includeCount) {
    const message = `Number of include fields (${this.include.length}) exceeds maximum allowed (${rc.includeCount})`;
    logger.warn(message);
    throw new Parse.Error(Parse.Error.INVALID_QUERY, message);
  }
};

// Updates property `this.keys` to contain all keys but the ones unselected.
_UnsafeRestQuery.prototype.handleExcludeKeys = function () {
  if (!this.excludeKeys) {
    return;
  }
  if (this.keys) {
    this.keys = this.keys.filter(k => !this.excludeKeys.includes(k));
    return;
  }
  return this.config.database.loadSchema().then(schemaController => schemaController.getOneSchema(this.className)).then(schema => {
    const fields = Object.keys(schema.fields);
    this.keys = fields.filter(k => !this.excludeKeys.includes(k));
  });
};

// Augments this.response with data at the paths provided in this.include.
_UnsafeRestQuery.prototype.handleInclude = async function () {
  if (this.include.length == 0) {
    return;
  }
  const indexedResults = this.response.results.reduce((indexed, result, i) => {
    indexed[result.objectId] = i;
    return indexed;
  }, {});

  // Build the execution tree
  const executionTree = {};
  this.include.forEach(path => {
    let current = executionTree;
    path.forEach(node => {
      if (!current[node]) {
        current[node] = {
          path,
          children: {}
        };
      }
      current = current[node].children;
    });
  });
  const recursiveExecutionTree = async treeNode => {
    const {
      path,
      children
    } = treeNode;
    const pathResponse = includePath(this.config, this.auth, this.response, path, this.context, this.restOptions, this);
    if (pathResponse.then) {
      const newResponse = await pathResponse;
      newResponse.results.forEach(newObject => {
        // We hydrate the root of each result with sub results
        this.response.results[indexedResults[newObject.objectId]][path[0]] = newObject[path[0]];
      });
    }
    return Promise.all(Object.values(children).map(recursiveExecutionTree));
  };
  await Promise.all(Object.values(executionTree).map(recursiveExecutionTree));
  this.include = [];
};

//Returns a promise of a processed set of results
_UnsafeRestQuery.prototype.runAfterFindTrigger = function () {
  if (!this.response) {
    return;
  }
  if (!this.runAfterFind) {
    return;
  }
  // Avoid doing any setup for triggers if there is no 'afterFind' trigger for this class.
  const hasAfterFindHook = triggers.triggerExists(this.className, triggers.Types.afterFind, this.config.applicationId);
  if (!hasAfterFindHook) {
    return Promise.resolve();
  }
  // Skip Aggregate and Distinct Queries
  if (this.findOptions.pipeline || this.findOptions.distinct) {
    return Promise.resolve();
  }
  const json = Object.assign({}, this.restOptions);
  json.where = this.restWhere;
  const parseQuery = new Parse.Query(this.className);
  parseQuery.withJSON(json);
  // Run afterFind trigger and set the new results
  return triggers.maybeRunAfterFindTrigger(triggers.Types.afterFind, this.auth, this.className, this.response.results, this.config, parseQuery, this.context, this.isGet).then(results => {
    // Ensure we properly set the className back
    if (this.redirectClassName) {
      this.response.results = results.map(object => {
        if (object instanceof Parse.Object) {
          object = object.toJSON();
        }
        object.className = this.redirectClassName;
        return object;
      });
    } else {
      this.response.results = results;
    }
  });
};
_UnsafeRestQuery.prototype.handleAuthAdapters = async function () {
  if (this.className !== '_User' || this.findOptions.explain) {
    return;
  }
  await Promise.all(this.response.results.map(result => this.config.authDataManager.runAfterFind({
    config: this.config,
    auth: this.auth
  }, result.authData)));
};

// Adds included values to the response.
// Path is a list of field names.
// Returns a promise for an augmented response.
function includePath(config, auth, response, path, context, restOptions = {}) {
  var pointers = findPointers(response.results, path);
  if (pointers.length == 0) {
    return response;
  }
  const pointersHash = {};
  for (var pointer of pointers) {
    if (!pointer) {
      continue;
    }
    const className = pointer.className;
    // only include the good pointers
    if (className) {
      pointersHash[className] = pointersHash[className] || new Set();
      pointersHash[className].add(pointer.objectId);
    }
  }
  const includeRestOptions = {};
  if (restOptions.keys) {
    const keys = new Set(restOptions.keys.split(','));
    const keySet = Array.from(keys).reduce((set, key) => {
      const keyPath = key.split('.');
      let i = 0;
      for (i; i < path.length; i++) {
        if (path[i] != keyPath[i]) {
          return set;
        }
      }
      if (i < keyPath.length) {
        set.add(keyPath[i]);
      }
      return set;
    }, new Set());
    if (keySet.size > 0) {
      includeRestOptions.keys = Array.from(keySet).join(',');
    }
  }
  if (restOptions.excludeKeys) {
    const excludeKeys = new Set(restOptions.excludeKeys.split(','));
    const excludeKeySet = Array.from(excludeKeys).reduce((set, key) => {
      const keyPath = key.split('.');
      let i = 0;
      for (i; i < path.length; i++) {
        if (path[i] != keyPath[i]) {
          return set;
        }
      }
      if (i == keyPath.length - 1) {
        set.add(keyPath[i]);
      }
      return set;
    }, new Set());
    if (excludeKeySet.size > 0) {
      includeRestOptions.excludeKeys = Array.from(excludeKeySet).join(',');
    }
  }
  if (restOptions.includeReadPreference) {
    includeRestOptions.readPreference = restOptions.includeReadPreference;
    includeRestOptions.includeReadPreference = restOptions.includeReadPreference;
  } else if (restOptions.readPreference) {
    includeRestOptions.readPreference = restOptions.readPreference;
  }
  const queryPromises = Object.keys(pointersHash).map(async className => {
    const objectIds = Array.from(pointersHash[className]);
    let where;
    if (objectIds.length === 1) {
      where = {
        objectId: objectIds[0]
      };
    } else {
      where = {
        objectId: {
          $in: objectIds
        }
      };
    }
    const query = await RestQuery({
      method: objectIds.length === 1 ? RestQuery.Method.get : RestQuery.Method.find,
      config,
      auth,
      className,
      restWhere: where,
      restOptions: includeRestOptions,
      context: context
    });
    return query.execute({
      op: 'get'
    }).then(results => {
      results.className = className;
      return Promise.resolve(results);
    });
  });

  // Get the objects for all these object ids
  return Promise.all(queryPromises).then(responses => {
    var replace = responses.reduce((replace, includeResponse) => {
      for (var obj of includeResponse.results) {
        obj.__type = 'Object';
        obj.className = includeResponse.className;
        if (obj.className == '_User' && !auth.isMaster) {
          delete obj.sessionToken;
          delete obj.authData;
        }
        replace[obj.objectId] = obj;
      }
      return replace;
    }, {});
    var resp = {
      results: replacePointers(response.results, path, replace)
    };
    if (response.count) {
      resp.count = response.count;
    }
    return resp;
  });
}

// Object may be a list of REST-format object to find pointers in, or
// it may be a single object.
// If the path yields things that aren't pointers, this throws an error.
// Path is a list of fields to search into.
// Returns a list of pointers in REST format.
function findPointers(object, path) {
  if (Array.isArray(object)) {
    return object.map(x => findPointers(x, path)).flat();
  }
  if (typeof object !== 'object' || !object) {
    return [];
  }
  if (path.length == 0) {
    if (object === null || object.__type == 'Pointer') {
      return [object];
    }
    return [];
  }
  var subobject = object[path[0]];
  if (!subobject) {
    return [];
  }
  return findPointers(subobject, path.slice(1));
}

// Object may be a list of REST-format objects to replace pointers
// in, or it may be a single object.
// Path is a list of fields to search into.
// replace is a map from object id -> object.
// Returns something analogous to object, but with the appropriate
// pointers inflated.
function replacePointers(object, path, replace) {
  if (Array.isArray(object)) {
    return object.map(obj => replacePointers(obj, path, replace)).filter(obj => typeof obj !== 'undefined');
  }
  if (typeof object !== 'object' || !object) {
    return object;
  }
  if (path.length === 0) {
    if (object && object.__type === 'Pointer') {
      return replace[object.objectId];
    }
    return object;
  }
  var subobject = object[path[0]];
  if (!subobject) {
    return object;
  }
  var newsub = replacePointers(subobject, path.slice(1), replace);
  var answer = {};
  for (var key in object) {
    if (key == path[0]) {
      answer[key] = newsub;
    } else {
      answer[key] = object[key];
    }
  }
  return answer;
}

// Finds a subobject that has the given key, if there is one.
// Returns undefined otherwise.
function findObjectWithKey(root, key) {
  if (typeof root !== 'object') {
    return;
  }
  if (Array.isArray(root)) {
    for (var item of root) {
      const answer = findObjectWithKey(item, key);
      if (answer) {
        return answer;
      }
    }
  }
  if (root && root[key]) {
    return root;
  }
  for (var subkey in root) {
    const answer = findObjectWithKey(root[subkey], key);
    if (answer) {
      return answer;
    }
  }
}
module.exports = RestQuery;
// For tests
module.exports._UnsafeRestQuery = _UnsafeRestQuery;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJTY2hlbWFDb250cm9sbGVyIiwicmVxdWlyZSIsIlBhcnNlIiwibG9nZ2VyIiwiZGVmYXVsdCIsInRyaWdnZXJzIiwiY29udGludWVXaGlsZSIsIkFsd2F5c1NlbGVjdGVkS2V5cyIsImVuZm9yY2VSb2xlU2VjdXJpdHkiLCJjcmVhdGVTYW5pdGl6ZWRFcnJvciIsIlJlc3RRdWVyeSIsIm1ldGhvZCIsImNvbmZpZyIsImF1dGgiLCJjbGFzc05hbWUiLCJyZXN0V2hlcmUiLCJyZXN0T3B0aW9ucyIsImNsaWVudFNESyIsInJ1bkFmdGVyRmluZCIsInJ1bkJlZm9yZUZpbmQiLCJjb250ZXh0IiwiTWV0aG9kIiwiZmluZCIsImdldCIsImluY2x1ZGVzIiwiRXJyb3IiLCJJTlZBTElEX1FVRVJZIiwiaXNHZXQiLCJyZXN1bHQiLCJtYXliZVJ1blF1ZXJ5VHJpZ2dlciIsIlR5cGVzIiwiYmVmb3JlRmluZCIsIlByb21pc2UiLCJyZXNvbHZlIiwiX1Vuc2FmZVJlc3RRdWVyeSIsIk9iamVjdCIsImZyZWV6ZSIsInJlc3BvbnNlIiwiZmluZE9wdGlvbnMiLCJpc01hc3RlciIsInVzZXIiLCJJTlZBTElEX1NFU1NJT05fVE9LRU4iLCIkYW5kIiwiX190eXBlIiwib2JqZWN0SWQiLCJpZCIsImRvQ291bnQiLCJpbmNsdWRlQWxsIiwiaW5jbHVkZSIsImtleXNGb3JJbmNsdWRlIiwicHJvdG90eXBlIiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwia2V5cyIsImV4Y2x1ZGVLZXlzIiwibGVuZ3RoIiwic3BsaXQiLCJmaWx0ZXIiLCJrZXkiLCJtYXAiLCJzbGljZSIsImxhc3RJbmRleE9mIiwiam9pbiIsIm9wdGlvbiIsImNvbmNhdCIsIkFycmF5IiwiZnJvbSIsIlNldCIsImV4Y2x1ZGUiLCJrIiwiaW5kZXhPZiIsImZpZWxkcyIsIm9yZGVyIiwic29ydCIsInJlZHVjZSIsInNvcnRNYXAiLCJmaWVsZCIsInRyaW0iLCJzY29yZSIsIiRtZXRhIiwicGF0aHMiLCJwYXRoU2V0IiwibWVtbyIsInBhdGgiLCJpbmRleCIsInBhcnRzIiwicyIsImEiLCJiIiwicmVkaXJlY3RLZXkiLCJyZWRpcmVjdENsYXNzTmFtZUZvcktleSIsInJlZGlyZWN0Q2xhc3NOYW1lIiwiSU5WQUxJRF9KU09OIiwiZXhlY3V0ZSIsImV4ZWN1dGVPcHRpb25zIiwidGhlbiIsInZhbGlkYXRlUXVlcnlEZXB0aCIsImJ1aWxkUmVzdFdoZXJlIiwiZGVueVByb3RlY3RlZEZpZWxkcyIsImhhbmRsZUluY2x1ZGVBbGwiLCJ2YWxpZGF0ZUluY2x1ZGVDb21wbGV4aXR5IiwiaGFuZGxlRXhjbHVkZUtleXMiLCJydW5GaW5kIiwicnVuQ291bnQiLCJoYW5kbGVJbmNsdWRlIiwicnVuQWZ0ZXJGaW5kVHJpZ2dlciIsImhhbmRsZUF1dGhBZGFwdGVycyIsImVhY2giLCJjYWxsYmFjayIsImxpbWl0IiwiZmluaXNoZWQiLCJxdWVyeSIsInJlc3VsdHMiLCJmb3JFYWNoIiwiYXNzaWduIiwiJGd0IiwiaXNNYWludGVuYW5jZSIsInJjIiwicmVxdWVzdENvbXBsZXhpdHkiLCJxdWVyeURlcHRoIiwibWF4RGVwdGgiLCJjaGVja0RlcHRoIiwid2hlcmUiLCJkZXB0aCIsIm9wIiwiaXNBcnJheSIsInN1YlF1ZXJ5IiwiZ2V0VXNlckFuZFJvbGVBQ0wiLCJ2YWxpZGF0ZUNsaWVudENsYXNzQ3JlYXRpb24iLCJjaGVja1N1YnF1ZXJ5RGVwdGgiLCJyZXBsYWNlU2VsZWN0IiwicmVwbGFjZURvbnRTZWxlY3QiLCJyZXBsYWNlSW5RdWVyeSIsInJlcGxhY2VOb3RJblF1ZXJ5IiwicmVwbGFjZUVxdWFsaXR5IiwiYWNsIiwiZ2V0VXNlclJvbGVzIiwicm9sZXMiLCJkYXRhYmFzZSIsIm5ld0NsYXNzTmFtZSIsImFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiIsInN5c3RlbUNsYXNzZXMiLCJsb2FkU2NoZW1hIiwic2NoZW1hQ29udHJvbGxlciIsImhhc0NsYXNzIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsInRyYW5zZm9ybUluUXVlcnkiLCJpblF1ZXJ5T2JqZWN0IiwidmFsdWVzIiwicHVzaCIsInN1YnF1ZXJ5RGVwdGgiLCJfc3VicXVlcnlEZXB0aCIsIm1lc3NhZ2UiLCJ3YXJuIiwiZmluZE9iamVjdFdpdGhLZXkiLCJpblF1ZXJ5VmFsdWUiLCJhZGRpdGlvbmFsT3B0aW9ucyIsInN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UiLCJyZWFkUHJlZmVyZW5jZSIsInN1YnF1ZXJ5TGltaXQiLCJjaGlsZENvbnRleHQiLCJzdWJxdWVyeSIsInRyYW5zZm9ybU5vdEluUXVlcnkiLCJub3RJblF1ZXJ5T2JqZWN0Iiwibm90SW5RdWVyeVZhbHVlIiwiZ2V0RGVlcGVzdE9iamVjdEZyb21LZXkiLCJqc29uIiwiaWR4Iiwic3JjIiwic3BsaWNlIiwidHJhbnNmb3JtU2VsZWN0Iiwic2VsZWN0T2JqZWN0Iiwib2JqZWN0cyIsInNlbGVjdFZhbHVlIiwidHJhbnNmb3JtRG9udFNlbGVjdCIsImRvbnRTZWxlY3RPYmplY3QiLCJkb250U2VsZWN0VmFsdWUiLCJjbGVhblJlc3VsdEF1dGhEYXRhIiwicGFzc3dvcmQiLCJhdXRoRGF0YSIsInByb3ZpZGVyIiwicmVwbGFjZUVxdWFsaXR5Q29uc3RyYWludCIsImNvbnN0cmFpbnQiLCJlcXVhbFRvT2JqZWN0IiwiaGFzRGlyZWN0Q29uc3RyYWludCIsImhhc09wZXJhdG9yQ29uc3RyYWludCIsIm9wdGlvbnMiLCJwcm92aWRlcnMiLCJhdXRoRGF0YU1hbmFnZXIiLCJnZXRQcm92aWRlcnMiLCJleHBsYWluIiwiZmlsZXNDb250cm9sbGVyIiwiZXhwYW5kRmlsZXNJbk9iamVjdCIsInIiLCJjb3VudCIsInNraXAiLCJjIiwicHJvdGVjdGVkRmllbGRzIiwiYWRkUHJvdGVjdGVkRmllbGRzIiwiY2hlY2tXaGVyZSIsIndoZXJlS2V5Iiwicm9vdEZpZWxkIiwidW5kZWZpbmVkIiwic29ydEtleSIsImdldE9uZVNjaGVtYSIsInNjaGVtYSIsImluY2x1ZGVGaWVsZHMiLCJrZXlGaWVsZHMiLCJ0eXBlIiwiaW5jbHVkZURlcHRoIiwiTWF0aCIsIm1heCIsImluY2x1ZGVDb3VudCIsImluZGV4ZWRSZXN1bHRzIiwiaW5kZXhlZCIsImkiLCJleGVjdXRpb25UcmVlIiwiY3VycmVudCIsIm5vZGUiLCJjaGlsZHJlbiIsInJlY3Vyc2l2ZUV4ZWN1dGlvblRyZWUiLCJ0cmVlTm9kZSIsInBhdGhSZXNwb25zZSIsImluY2x1ZGVQYXRoIiwibmV3UmVzcG9uc2UiLCJuZXdPYmplY3QiLCJhbGwiLCJoYXNBZnRlckZpbmRIb29rIiwidHJpZ2dlckV4aXN0cyIsImFmdGVyRmluZCIsImFwcGxpY2F0aW9uSWQiLCJwaXBlbGluZSIsImRpc3RpbmN0IiwicGFyc2VRdWVyeSIsIlF1ZXJ5Iiwid2l0aEpTT04iLCJtYXliZVJ1bkFmdGVyRmluZFRyaWdnZXIiLCJvYmplY3QiLCJ0b0pTT04iLCJwb2ludGVycyIsImZpbmRQb2ludGVycyIsInBvaW50ZXJzSGFzaCIsInBvaW50ZXIiLCJhZGQiLCJpbmNsdWRlUmVzdE9wdGlvbnMiLCJrZXlTZXQiLCJzZXQiLCJrZXlQYXRoIiwic2l6ZSIsImV4Y2x1ZGVLZXlTZXQiLCJpbmNsdWRlUmVhZFByZWZlcmVuY2UiLCJxdWVyeVByb21pc2VzIiwib2JqZWN0SWRzIiwiJGluIiwicmVzcG9uc2VzIiwicmVwbGFjZSIsImluY2x1ZGVSZXNwb25zZSIsIm9iaiIsInNlc3Npb25Ub2tlbiIsInJlc3AiLCJyZXBsYWNlUG9pbnRlcnMiLCJ4IiwiZmxhdCIsInN1Ym9iamVjdCIsIm5ld3N1YiIsImFuc3dlciIsInJvb3QiLCJpdGVtIiwic3Via2V5IiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uL3NyYy9SZXN0UXVlcnkuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQW4gb2JqZWN0IHRoYXQgZW5jYXBzdWxhdGVzIGV2ZXJ5dGhpbmcgd2UgbmVlZCB0byBydW4gYSAnZmluZCdcbi8vIG9wZXJhdGlvbiwgZW5jb2RlZCBpbiB0aGUgUkVTVCBBUEkgZm9ybWF0LlxuXG52YXIgU2NoZW1hQ29udHJvbGxlciA9IHJlcXVpcmUoJy4vQ29udHJvbGxlcnMvU2NoZW1hQ29udHJvbGxlcicpO1xudmFyIFBhcnNlID0gcmVxdWlyZSgncGFyc2Uvbm9kZScpLlBhcnNlO1xudmFyIGxvZ2dlciA9IHJlcXVpcmUoJy4vbG9nZ2VyJykuZGVmYXVsdDtcbmNvbnN0IHRyaWdnZXJzID0gcmVxdWlyZSgnLi90cmlnZ2VycycpO1xuY29uc3QgeyBjb250aW51ZVdoaWxlIH0gPSByZXF1aXJlKCdwYXJzZS9saWIvbm9kZS9wcm9taXNlVXRpbHMnKTtcbmNvbnN0IEFsd2F5c1NlbGVjdGVkS2V5cyA9IFsnb2JqZWN0SWQnLCAnY3JlYXRlZEF0JywgJ3VwZGF0ZWRBdCcsICdBQ0wnXTtcbmNvbnN0IHsgZW5mb3JjZVJvbGVTZWN1cml0eSB9ID0gcmVxdWlyZSgnLi9TaGFyZWRSZXN0Jyk7XG5jb25zdCB7IGNyZWF0ZVNhbml0aXplZEVycm9yIH0gPSByZXF1aXJlKCcuL0Vycm9yJyk7XG5cbi8vIHJlc3RPcHRpb25zIGNhbiBpbmNsdWRlOlxuLy8gICBza2lwXG4vLyAgIGxpbWl0XG4vLyAgIG9yZGVyXG4vLyAgIGNvdW50XG4vLyAgIGluY2x1ZGVcbi8vICAga2V5c1xuLy8gICBleGNsdWRlS2V5c1xuLy8gICByZWRpcmVjdENsYXNzTmFtZUZvcktleVxuLy8gICByZWFkUHJlZmVyZW5jZVxuLy8gICBpbmNsdWRlUmVhZFByZWZlcmVuY2Vcbi8vICAgc3VicXVlcnlSZWFkUHJlZmVyZW5jZVxuLyoqXG4gKiBVc2UgdG8gcGVyZm9ybSBhIHF1ZXJ5IG9uIGEgY2xhc3MuIEl0IHdpbGwgcnVuIHNlY3VyaXR5IGNoZWNrcyBhbmQgdHJpZ2dlcnMuXG4gKiBAcGFyYW0gb3B0aW9uc1xuICogQHBhcmFtIG9wdGlvbnMubWV0aG9kIHtSZXN0UXVlcnkuTWV0aG9kfSBUaGUgdHlwZSBvZiBxdWVyeSB0byBwZXJmb3JtXG4gKiBAcGFyYW0gb3B0aW9ucy5jb25maWcge1BhcnNlU2VydmVyQ29uZmlndXJhdGlvbn0gVGhlIHNlcnZlciBjb25maWd1cmF0aW9uXG4gKiBAcGFyYW0gb3B0aW9ucy5hdXRoIHtBdXRofSBUaGUgYXV0aCBvYmplY3QgZm9yIHRoZSByZXF1ZXN0XG4gKiBAcGFyYW0gb3B0aW9ucy5jbGFzc05hbWUge3N0cmluZ30gVGhlIG5hbWUgb2YgdGhlIGNsYXNzIHRvIHF1ZXJ5XG4gKiBAcGFyYW0gb3B0aW9ucy5yZXN0V2hlcmUge29iamVjdH0gVGhlIHdoZXJlIG9iamVjdCBmb3IgdGhlIHF1ZXJ5XG4gKiBAcGFyYW0gb3B0aW9ucy5yZXN0T3B0aW9ucyB7b2JqZWN0fSBUaGUgb3B0aW9ucyBvYmplY3QgZm9yIHRoZSBxdWVyeVxuICogQHBhcmFtIG9wdGlvbnMuY2xpZW50U0RLIHtzdHJpbmd9IFRoZSBjbGllbnQgU0RLIHRoYXQgaXMgcGVyZm9ybWluZyB0aGUgcXVlcnlcbiAqIEBwYXJhbSBvcHRpb25zLnJ1bkFmdGVyRmluZCB7Ym9vbGVhbn0gV2hldGhlciB0byBydW4gdGhlIGFmdGVyRmluZCB0cmlnZ2VyXG4gKiBAcGFyYW0gb3B0aW9ucy5ydW5CZWZvcmVGaW5kIHtib29sZWFufSBXaGV0aGVyIHRvIHJ1biB0aGUgYmVmb3JlRmluZCB0cmlnZ2VyXG4gKiBAcGFyYW0gb3B0aW9ucy5jb250ZXh0IHtvYmplY3R9IFRoZSBjb250ZXh0IG9iamVjdCBmb3IgdGhlIHF1ZXJ5XG4gKiBAcmV0dXJucyB7UHJvbWlzZTxfVW5zYWZlUmVzdFF1ZXJ5Pn0gQSBwcm9taXNlIHRoYXQgaXMgcmVzb2x2ZWQgd2l0aCB0aGUgX1Vuc2FmZVJlc3RRdWVyeSBvYmplY3RcbiAqL1xuYXN5bmMgZnVuY3Rpb24gUmVzdFF1ZXJ5KHtcbiAgbWV0aG9kLFxuICBjb25maWcsXG4gIGF1dGgsXG4gIGNsYXNzTmFtZSxcbiAgcmVzdFdoZXJlID0ge30sXG4gIHJlc3RPcHRpb25zID0ge30sXG4gIGNsaWVudFNESyxcbiAgcnVuQWZ0ZXJGaW5kID0gdHJ1ZSxcbiAgcnVuQmVmb3JlRmluZCA9IHRydWUsXG4gIGNvbnRleHQsXG59KSB7XG4gIGlmICghW1Jlc3RRdWVyeS5NZXRob2QuZmluZCwgUmVzdFF1ZXJ5Lk1ldGhvZC5nZXRdLmluY2x1ZGVzKG1ldGhvZCkpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgJ2JhZCBxdWVyeSB0eXBlJyk7XG4gIH1cbiAgY29uc3QgaXNHZXQgPSBtZXRob2QgPT09IFJlc3RRdWVyeS5NZXRob2QuZ2V0O1xuICBlbmZvcmNlUm9sZVNlY3VyaXR5KG1ldGhvZCwgY2xhc3NOYW1lLCBhdXRoLCBjb25maWcpO1xuICBjb25zdCByZXN1bHQgPSBydW5CZWZvcmVGaW5kXG4gICAgPyBhd2FpdCB0cmlnZ2Vycy5tYXliZVJ1blF1ZXJ5VHJpZ2dlcihcbiAgICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZUZpbmQsXG4gICAgICBjbGFzc05hbWUsXG4gICAgICByZXN0V2hlcmUsXG4gICAgICByZXN0T3B0aW9ucyxcbiAgICAgIGNvbmZpZyxcbiAgICAgIGF1dGgsXG4gICAgICBjb250ZXh0LFxuICAgICAgaXNHZXRcbiAgICApXG4gICAgOiBQcm9taXNlLnJlc29sdmUoeyByZXN0V2hlcmUsIHJlc3RPcHRpb25zIH0pO1xuXG4gIHJldHVybiBuZXcgX1Vuc2FmZVJlc3RRdWVyeShcbiAgICBjb25maWcsXG4gICAgYXV0aCxcbiAgICBjbGFzc05hbWUsXG4gICAgcmVzdWx0LnJlc3RXaGVyZSB8fCByZXN0V2hlcmUsXG4gICAgcmVzdWx0LnJlc3RPcHRpb25zIHx8IHJlc3RPcHRpb25zLFxuICAgIGNsaWVudFNESyxcbiAgICBydW5BZnRlckZpbmQsXG4gICAgY29udGV4dCxcbiAgICBpc0dldFxuICApO1xufVxuXG5SZXN0UXVlcnkuTWV0aG9kID0gT2JqZWN0LmZyZWV6ZSh7XG4gIGdldDogJ2dldCcsXG4gIGZpbmQ6ICdmaW5kJyxcbn0pO1xuXG4vKipcbiAqIF9VbnNhZmVSZXN0UXVlcnkgaXMgbWVhbnQgZm9yIHNwZWNpZmljIGludGVybmFsIHVzYWdlIG9ubHkuIFdoZW4geW91IG5lZWQgdG8gc2tpcCBzZWN1cml0eSBjaGVja3Mgb3Igc29tZSB0cmlnZ2Vycy5cbiAqIERvbid0IHVzZSBpdCBpZiB5b3UgZG9uJ3Qga25vdyB3aGF0IHlvdSBhcmUgZG9pbmcuXG4gKiBAcGFyYW0gY29uZmlnXG4gKiBAcGFyYW0gYXV0aFxuICogQHBhcmFtIGNsYXNzTmFtZVxuICogQHBhcmFtIHJlc3RXaGVyZVxuICogQHBhcmFtIHJlc3RPcHRpb25zXG4gKiBAcGFyYW0gY2xpZW50U0RLXG4gKiBAcGFyYW0gcnVuQWZ0ZXJGaW5kXG4gKiBAcGFyYW0gY29udGV4dFxuICovXG5mdW5jdGlvbiBfVW5zYWZlUmVzdFF1ZXJ5KFxuICBjb25maWcsXG4gIGF1dGgsXG4gIGNsYXNzTmFtZSxcbiAgcmVzdFdoZXJlID0ge30sXG4gIHJlc3RPcHRpb25zID0ge30sXG4gIGNsaWVudFNESyxcbiAgcnVuQWZ0ZXJGaW5kID0gdHJ1ZSxcbiAgY29udGV4dCxcbiAgaXNHZXRcbikge1xuICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgdGhpcy5hdXRoID0gYXV0aDtcbiAgdGhpcy5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG4gIHRoaXMucmVzdFdoZXJlID0gcmVzdFdoZXJlO1xuICB0aGlzLnJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnM7XG4gIHRoaXMuY2xpZW50U0RLID0gY2xpZW50U0RLO1xuICB0aGlzLnJ1bkFmdGVyRmluZCA9IHJ1bkFmdGVyRmluZDtcbiAgdGhpcy5yZXNwb25zZSA9IG51bGw7XG4gIHRoaXMuZmluZE9wdGlvbnMgPSB7fTtcbiAgdGhpcy5jb250ZXh0ID0gY29udGV4dCB8fCB7fTtcbiAgdGhpcy5pc0dldCA9IGlzR2V0O1xuICBpZiAoIXRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIGlmICh0aGlzLmNsYXNzTmFtZSA9PSAnX1Nlc3Npb24nKSB7XG4gICAgICBpZiAoIXRoaXMuYXV0aC51c2VyKSB7XG4gICAgICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTiwgJ0ludmFsaWQgc2Vzc2lvbiB0b2tlbicsIGNvbmZpZyk7XG4gICAgICB9XG4gICAgICB0aGlzLnJlc3RXaGVyZSA9IHtcbiAgICAgICAgJGFuZDogW1xuICAgICAgICAgIHRoaXMucmVzdFdoZXJlLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHVzZXI6IHtcbiAgICAgICAgICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICAgICAgICAgIGNsYXNzTmFtZTogJ19Vc2VyJyxcbiAgICAgICAgICAgICAgb2JqZWN0SWQ6IHRoaXMuYXV0aC51c2VyLmlkLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmRvQ291bnQgPSBmYWxzZTtcbiAgdGhpcy5pbmNsdWRlQWxsID0gZmFsc2U7XG5cbiAgLy8gVGhlIGZvcm1hdCBmb3IgdGhpcy5pbmNsdWRlIGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgZm9ybWF0IGZvciB0aGVcbiAgLy8gaW5jbHVkZSBvcHRpb24gLSBpdCdzIHRoZSBwYXRocyB3ZSBzaG91bGQgaW5jbHVkZSwgaW4gb3JkZXIsXG4gIC8vIHN0b3JlZCBhcyBhcnJheXMsIHRha2luZyBpbnRvIGFjY291bnQgdGhhdCB3ZSBuZWVkIHRvIGluY2x1ZGUgZm9vXG4gIC8vIGJlZm9yZSBpbmNsdWRpbmcgZm9vLmJhci4gQWxzbyBpdCBzaG91bGQgZGVkdXBlLlxuICAvLyBGb3IgZXhhbXBsZSwgcGFzc2luZyBhbiBhcmcgb2YgaW5jbHVkZT1mb28uYmFyLGZvby5iYXogY291bGQgbGVhZCB0b1xuICAvLyB0aGlzLmluY2x1ZGUgPSBbWydmb28nXSwgWydmb28nLCAnYmF6J10sIFsnZm9vJywgJ2JhciddXVxuICB0aGlzLmluY2x1ZGUgPSBbXTtcbiAgbGV0IGtleXNGb3JJbmNsdWRlID0gJyc7XG5cbiAgLy8gSWYgd2UgaGF2ZSBrZXlzLCB3ZSBwcm9iYWJseSB3YW50IHRvIGZvcmNlIHNvbWUgaW5jbHVkZXMgKG4tMSBsZXZlbClcbiAgLy8gU2VlIGlzc3VlOiBodHRwczovL2dpdGh1Yi5jb20vcGFyc2UtY29tbXVuaXR5L3BhcnNlLXNlcnZlci9pc3N1ZXMvMzE4NVxuICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHJlc3RPcHRpb25zLCAna2V5cycpKSB7XG4gICAga2V5c0ZvckluY2x1ZGUgPSByZXN0T3B0aW9ucy5rZXlzO1xuICB9XG5cbiAgLy8gSWYgd2UgaGF2ZSBrZXlzLCB3ZSBwcm9iYWJseSB3YW50IHRvIGZvcmNlIHNvbWUgaW5jbHVkZXMgKG4tMSBsZXZlbClcbiAgLy8gaW4gb3JkZXIgdG8gZXhjbHVkZSBzcGVjaWZpYyBrZXlzLlxuICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHJlc3RPcHRpb25zLCAnZXhjbHVkZUtleXMnKSkge1xuICAgIGtleXNGb3JJbmNsdWRlICs9ICcsJyArIHJlc3RPcHRpb25zLmV4Y2x1ZGVLZXlzO1xuICB9XG5cbiAgaWYgKGtleXNGb3JJbmNsdWRlLmxlbmd0aCA+IDApIHtcbiAgICBrZXlzRm9ySW5jbHVkZSA9IGtleXNGb3JJbmNsdWRlXG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLmZpbHRlcihrZXkgPT4ge1xuICAgICAgICAvLyBBdCBsZWFzdCAyIGNvbXBvbmVudHNcbiAgICAgICAgcmV0dXJuIGtleS5zcGxpdCgnLicpLmxlbmd0aCA+IDE7XG4gICAgICB9KVxuICAgICAgLm1hcChrZXkgPT4ge1xuICAgICAgICAvLyBTbGljZSB0aGUgbGFzdCBjb21wb25lbnQgKGEuYi5jIC0+IGEuYilcbiAgICAgICAgLy8gT3RoZXJ3aXNlIHdlJ2xsIGluY2x1ZGUgb25lIGxldmVsIHRvbyBtdWNoLlxuICAgICAgICByZXR1cm4ga2V5LnNsaWNlKDAsIGtleS5sYXN0SW5kZXhPZignLicpKTtcbiAgICAgIH0pXG4gICAgICAuam9pbignLCcpO1xuXG4gICAgLy8gQ29uY2F0IHRoZSBwb3NzaWJseSBwcmVzZW50IGluY2x1ZGUgc3RyaW5nIHdpdGggdGhlIG9uZSBmcm9tIHRoZSBrZXlzXG4gICAgLy8gRGVkdXAgLyBzb3J0aW5nIGlzIGhhbmRsZSBpbiAnaW5jbHVkZScgY2FzZS5cbiAgICBpZiAoa2V5c0ZvckluY2x1ZGUubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKCFyZXN0T3B0aW9ucy5pbmNsdWRlIHx8IHJlc3RPcHRpb25zLmluY2x1ZGUubGVuZ3RoID09IDApIHtcbiAgICAgICAgcmVzdE9wdGlvbnMuaW5jbHVkZSA9IGtleXNGb3JJbmNsdWRlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzdE9wdGlvbnMuaW5jbHVkZSArPSAnLCcgKyBrZXlzRm9ySW5jbHVkZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmb3IgKHZhciBvcHRpb24gaW4gcmVzdE9wdGlvbnMpIHtcbiAgICBzd2l0Y2ggKG9wdGlvbikge1xuICAgICAgY2FzZSAna2V5cyc6IHtcbiAgICAgICAgY29uc3Qga2V5cyA9IHJlc3RPcHRpb25zLmtleXNcbiAgICAgICAgICAuc3BsaXQoJywnKVxuICAgICAgICAgIC5maWx0ZXIoa2V5ID0+IGtleS5sZW5ndGggPiAwKVxuICAgICAgICAgIC5jb25jYXQoQWx3YXlzU2VsZWN0ZWRLZXlzKTtcbiAgICAgICAgdGhpcy5rZXlzID0gQXJyYXkuZnJvbShuZXcgU2V0KGtleXMpKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlICdleGNsdWRlS2V5cyc6IHtcbiAgICAgICAgY29uc3QgZXhjbHVkZSA9IHJlc3RPcHRpb25zLmV4Y2x1ZGVLZXlzXG4gICAgICAgICAgLnNwbGl0KCcsJylcbiAgICAgICAgICAuZmlsdGVyKGsgPT4gQWx3YXlzU2VsZWN0ZWRLZXlzLmluZGV4T2YoaykgPCAwKTtcbiAgICAgICAgdGhpcy5leGNsdWRlS2V5cyA9IEFycmF5LmZyb20obmV3IFNldChleGNsdWRlKSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY2FzZSAnY291bnQnOlxuICAgICAgICB0aGlzLmRvQ291bnQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2luY2x1ZGVBbGwnOlxuICAgICAgICB0aGlzLmluY2x1ZGVBbGwgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2V4cGxhaW4nOlxuICAgICAgY2FzZSAnaGludCc6XG4gICAgICBjYXNlICdkaXN0aW5jdCc6XG4gICAgICBjYXNlICdwaXBlbGluZSc6XG4gICAgICBjYXNlICdza2lwJzpcbiAgICAgIGNhc2UgJ2xpbWl0JzpcbiAgICAgIGNhc2UgJ3JlYWRQcmVmZXJlbmNlJzpcbiAgICAgIGNhc2UgJ2NvbW1lbnQnOlxuICAgICAgY2FzZSAncmF3VmFsdWVzJzpcbiAgICAgIGNhc2UgJ3Jhd0ZpZWxkTmFtZXMnOlxuICAgICAgICB0aGlzLmZpbmRPcHRpb25zW29wdGlvbl0gPSByZXN0T3B0aW9uc1tvcHRpb25dO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ29yZGVyJzpcbiAgICAgICAgdmFyIGZpZWxkcyA9IHJlc3RPcHRpb25zLm9yZGVyLnNwbGl0KCcsJyk7XG4gICAgICAgIHRoaXMuZmluZE9wdGlvbnMuc29ydCA9IGZpZWxkcy5yZWR1Y2UoKHNvcnRNYXAsIGZpZWxkKSA9PiB7XG4gICAgICAgICAgZmllbGQgPSBmaWVsZC50cmltKCk7XG4gICAgICAgICAgaWYgKGZpZWxkID09PSAnJHNjb3JlJyB8fCBmaWVsZCA9PT0gJy0kc2NvcmUnKSB7XG4gICAgICAgICAgICBzb3J0TWFwLnNjb3JlID0geyAkbWV0YTogJ3RleHRTY29yZScgfTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGZpZWxkWzBdID09ICctJykge1xuICAgICAgICAgICAgc29ydE1hcFtmaWVsZC5zbGljZSgxKV0gPSAtMTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc29ydE1hcFtmaWVsZF0gPSAxO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gc29ydE1hcDtcbiAgICAgICAgfSwge30pO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2luY2x1ZGUnOiB7XG4gICAgICAgIGNvbnN0IHBhdGhzID0gcmVzdE9wdGlvbnMuaW5jbHVkZS5zcGxpdCgnLCcpO1xuICAgICAgICBpZiAocGF0aHMuaW5jbHVkZXMoJyonKSkge1xuICAgICAgICAgIHRoaXMuaW5jbHVkZUFsbCA9IHRydWU7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTG9hZCB0aGUgZXhpc3RpbmcgaW5jbHVkZXMgKGZyb20ga2V5cylcbiAgICAgICAgY29uc3QgcGF0aFNldCA9IHBhdGhzLnJlZHVjZSgobWVtbywgcGF0aCkgPT4ge1xuICAgICAgICAgIC8vIFNwbGl0IGVhY2ggcGF0aHMgb24gLiAoYS5iLmMgLT4gW2EsYixjXSlcbiAgICAgICAgICAvLyByZWR1Y2UgdG8gY3JlYXRlIGFsbCBwYXRoc1xuICAgICAgICAgIC8vIChbYSxiLGNdIC0+IHthOiB0cnVlLCAnYS5iJzogdHJ1ZSwgJ2EuYi5jJzogdHJ1ZX0pXG4gICAgICAgICAgcmV0dXJuIHBhdGguc3BsaXQoJy4nKS5yZWR1Y2UoKG1lbW8sIHBhdGgsIGluZGV4LCBwYXJ0cykgPT4ge1xuICAgICAgICAgICAgbWVtb1twYXJ0cy5zbGljZSgwLCBpbmRleCArIDEpLmpvaW4oJy4nKV0gPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuIG1lbW87XG4gICAgICAgICAgfSwgbWVtbyk7XG4gICAgICAgIH0sIHt9KTtcblxuICAgICAgICB0aGlzLmluY2x1ZGUgPSBPYmplY3Qua2V5cyhwYXRoU2V0KVxuICAgICAgICAgIC5tYXAocyA9PiB7XG4gICAgICAgICAgICByZXR1cm4gcy5zcGxpdCgnLicpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBhLmxlbmd0aCAtIGIubGVuZ3RoOyAvLyBTb3J0IGJ5IG51bWJlciBvZiBjb21wb25lbnRzXG4gICAgICAgICAgfSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY2FzZSAncmVkaXJlY3RDbGFzc05hbWVGb3JLZXknOlxuICAgICAgICB0aGlzLnJlZGlyZWN0S2V5ID0gcmVzdE9wdGlvbnMucmVkaXJlY3RDbGFzc05hbWVGb3JLZXk7XG4gICAgICAgIHRoaXMucmVkaXJlY3RDbGFzc05hbWUgPSBudWxsO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2luY2x1ZGVSZWFkUHJlZmVyZW5jZSc6XG4gICAgICBjYXNlICdzdWJxdWVyeVJlYWRQcmVmZXJlbmNlJzpcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkIG9wdGlvbjogJyArIG9wdGlvbik7XG4gICAgfVxuICB9XG59XG5cbi8vIEEgY29udmVuaWVudCBtZXRob2QgdG8gcGVyZm9ybSBhbGwgdGhlIHN0ZXBzIG9mIHByb2Nlc3NpbmcgYSBxdWVyeVxuLy8gaW4gb3JkZXIuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgdGhlIHJlc3BvbnNlIC0gYW4gb2JqZWN0IHdpdGggb3B0aW9uYWwga2V5c1xuLy8gJ3Jlc3VsdHMnIGFuZCAnY291bnQnLlxuLy8gVE9ETzogY29uc29saWRhdGUgdGhlIHJlcGxhY2VYIGZ1bmN0aW9uc1xuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUuZXhlY3V0ZSA9IGZ1bmN0aW9uIChleGVjdXRlT3B0aW9ucykge1xuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZVF1ZXJ5RGVwdGgoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmJ1aWxkUmVzdFdoZXJlKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5kZW55UHJvdGVjdGVkRmllbGRzKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVJbmNsdWRlQWxsKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZUluY2x1ZGVDb21wbGV4aXR5KCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVFeGNsdWRlS2V5cygpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucnVuRmluZChleGVjdXRlT3B0aW9ucyk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5Db3VudCgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlSW5jbHVkZSgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucnVuQWZ0ZXJGaW5kVHJpZ2dlcigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlQXV0aEFkYXB0ZXJzKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5yZXNwb25zZTtcbiAgICB9KTtcbn07XG5cbl9VbnNhZmVSZXN0UXVlcnkucHJvdG90eXBlLmVhY2ggPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgY29uc3QgeyBjb25maWcsIGF1dGgsIGNsYXNzTmFtZSwgcmVzdFdoZXJlLCByZXN0T3B0aW9ucywgY2xpZW50U0RLIH0gPSB0aGlzO1xuICAvLyBpZiB0aGUgbGltaXQgaXMgc2V0LCB1c2UgaXRcbiAgcmVzdE9wdGlvbnMubGltaXQgPSByZXN0T3B0aW9ucy5saW1pdCB8fCAxMDA7XG4gIHJlc3RPcHRpb25zLm9yZGVyID0gJ29iamVjdElkJztcbiAgbGV0IGZpbmlzaGVkID0gZmFsc2U7XG5cbiAgcmV0dXJuIGNvbnRpbnVlV2hpbGUoXG4gICAgKCkgPT4ge1xuICAgICAgcmV0dXJuICFmaW5pc2hlZDtcbiAgICB9LFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFNhZmUgaGVyZSB0byB1c2UgX1Vuc2FmZVJlc3RRdWVyeSBiZWNhdXNlIHRoZSBzZWN1cml0eSB3YXMgYWxyZWFkeVxuICAgICAgLy8gY2hlY2tlZCBkdXJpbmcgXCJhd2FpdCBSZXN0UXVlcnkoKVwiXG4gICAgICBjb25zdCBxdWVyeSA9IG5ldyBfVW5zYWZlUmVzdFF1ZXJ5KFxuICAgICAgICBjb25maWcsXG4gICAgICAgIGF1dGgsXG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgcmVzdFdoZXJlLFxuICAgICAgICByZXN0T3B0aW9ucyxcbiAgICAgICAgY2xpZW50U0RLLFxuICAgICAgICB0aGlzLnJ1bkFmdGVyRmluZCxcbiAgICAgICAgdGhpcy5jb250ZXh0XG4gICAgICApO1xuICAgICAgY29uc3QgeyByZXN1bHRzIH0gPSBhd2FpdCBxdWVyeS5leGVjdXRlKCk7XG4gICAgICByZXN1bHRzLmZvckVhY2goY2FsbGJhY2spO1xuICAgICAgZmluaXNoZWQgPSByZXN1bHRzLmxlbmd0aCA8IHJlc3RPcHRpb25zLmxpbWl0O1xuICAgICAgaWYgKCFmaW5pc2hlZCkge1xuICAgICAgICByZXN0V2hlcmUub2JqZWN0SWQgPSBPYmplY3QuYXNzaWduKHt9LCByZXN0V2hlcmUub2JqZWN0SWQsIHtcbiAgICAgICAgICAkZ3Q6IHJlc3VsdHNbcmVzdWx0cy5sZW5ndGggLSAxXS5vYmplY3RJZCxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICApO1xufTtcblxuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUudmFsaWRhdGVRdWVyeURlcHRoID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5hdXRoLmlzTWFzdGVyIHx8IHRoaXMuYXV0aC5pc01haW50ZW5hbmNlKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJjID0gdGhpcy5jb25maWcucmVxdWVzdENvbXBsZXhpdHk7XG4gIGlmICghcmMgfHwgcmMucXVlcnlEZXB0aCA9PT0gLTEpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgbWF4RGVwdGggPSByYy5xdWVyeURlcHRoO1xuICBjb25zdCBjaGVja0RlcHRoID0gKHdoZXJlLCBkZXB0aCkgPT4ge1xuICAgIGlmIChkZXB0aCA+IG1heERlcHRoKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAgIGBRdWVyeSBjb25kaXRpb24gbmVzdGluZyBkZXB0aCBleGNlZWRzIG1heGltdW0gYWxsb3dlZCBkZXB0aCBvZiAke21heERlcHRofWBcbiAgICAgICk7XG4gICAgfVxuICAgIGlmICh0eXBlb2Ygd2hlcmUgIT09ICdvYmplY3QnIHx8IHdoZXJlID09PSBudWxsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAoY29uc3Qgb3Agb2YgWyckb3InLCAnJGFuZCcsICckbm9yJ10pIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHdoZXJlW29wXSkpIHtcbiAgICAgICAgZm9yIChjb25zdCBzdWJRdWVyeSBvZiB3aGVyZVtvcF0pIHtcbiAgICAgICAgICBjaGVja0RlcHRoKHN1YlF1ZXJ5LCBkZXB0aCArIDEpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9O1xuICBjaGVja0RlcHRoKHRoaXMucmVzdFdoZXJlLCAwKTtcbn07XG5cbl9VbnNhZmVSZXN0UXVlcnkucHJvdG90eXBlLmJ1aWxkUmVzdFdoZXJlID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRVc2VyQW5kUm9sZUFDTCgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucmVkaXJlY3RDbGFzc05hbWVGb3JLZXkoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuY2hlY2tTdWJxdWVyeURlcHRoKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5yZXBsYWNlU2VsZWN0KCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5yZXBsYWNlRG9udFNlbGVjdCgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucmVwbGFjZUluUXVlcnkoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJlcGxhY2VOb3RJblF1ZXJ5KCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5yZXBsYWNlRXF1YWxpdHkoKTtcbiAgICB9KTtcbn07XG5cbi8vIFVzZXMgdGhlIEF1dGggb2JqZWN0IHRvIGdldCB0aGUgbGlzdCBvZiByb2xlcywgYWRkcyB0aGUgdXNlciBpZFxuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUuZ2V0VXNlckFuZFJvbGVBQ0wgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICB0aGlzLmZpbmRPcHRpb25zLmFjbCA9IFsnKiddO1xuXG4gIGlmICh0aGlzLmF1dGgudXNlcikge1xuICAgIHJldHVybiB0aGlzLmF1dGguZ2V0VXNlclJvbGVzKCkudGhlbihyb2xlcyA9PiB7XG4gICAgICB0aGlzLmZpbmRPcHRpb25zLmFjbCA9IHRoaXMuZmluZE9wdGlvbnMuYWNsLmNvbmNhdChyb2xlcywgW3RoaXMuYXV0aC51c2VyLmlkXSk7XG4gICAgICByZXR1cm47XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG59O1xuXG4vLyBDaGFuZ2VzIHRoZSBjbGFzc05hbWUgaWYgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXkgaXMgc2V0LlxuLy8gUmV0dXJucyBhIHByb21pc2UuXG5fVW5zYWZlUmVzdFF1ZXJ5LnByb3RvdHlwZS5yZWRpcmVjdENsYXNzTmFtZUZvcktleSA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF0aGlzLnJlZGlyZWN0S2V5KSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgLy8gV2UgbmVlZCB0byBjaGFuZ2UgdGhlIGNsYXNzIG5hbWUgYmFzZWQgb24gdGhlIHNjaGVtYVxuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAucmVkaXJlY3RDbGFzc05hbWVGb3JLZXkodGhpcy5jbGFzc05hbWUsIHRoaXMucmVkaXJlY3RLZXkpXG4gICAgLnRoZW4obmV3Q2xhc3NOYW1lID0+IHtcbiAgICAgIHRoaXMuY2xhc3NOYW1lID0gbmV3Q2xhc3NOYW1lO1xuICAgICAgdGhpcy5yZWRpcmVjdENsYXNzTmFtZSA9IG5ld0NsYXNzTmFtZTtcblxuICAgICAgLy8gUmUtYXBwbHkgc2VjdXJpdHkgY2hlY2tzIGZvciB0aGUgcmVkaXJlY3RlZCBjbGFzcyBuYW1lLCBzaW5jZSB0aGVcbiAgICAgIC8vIGNoZWNrcyBpbiB0aGUgY29uc3RydWN0b3IgYW5kIGluIHJlc3QuZmluZCByYW4gYWdhaW5zdCB0aGUgb3JpZ2luYWxcbiAgICAgIC8vIGNsYXNzIG5hbWUgYmVmb3JlIHRoZSByZWRpcmVjdC5cbiAgICAgIGlmICghdGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgICAgIGVuZm9yY2VSb2xlU2VjdXJpdHkoJ2ZpbmQnLCB0aGlzLmNsYXNzTmFtZSwgdGhpcy5hdXRoLCB0aGlzLmNvbmZpZyk7XG5cbiAgICAgICAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1Nlc3Npb24nKSB7XG4gICAgICAgICAgaWYgKCF0aGlzLmF1dGgudXNlcikge1xuICAgICAgICAgICAgdGhyb3cgY3JlYXRlU2FuaXRpemVkRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTixcbiAgICAgICAgICAgICAgJ0ludmFsaWQgc2Vzc2lvbiB0b2tlbicsXG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLnJlc3RXaGVyZSA9IHtcbiAgICAgICAgICAgICRhbmQ6IFtcbiAgICAgICAgICAgICAgdGhpcy5yZXN0V2hlcmUsXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICB1c2VyOiB7XG4gICAgICAgICAgICAgICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZTogJ19Vc2VyJyxcbiAgICAgICAgICAgICAgICAgIG9iamVjdElkOiB0aGlzLmF1dGgudXNlci5pZCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG59O1xuXG4vLyBWYWxpZGF0ZXMgdGhpcyBvcGVyYXRpb24gYWdhaW5zdCB0aGUgYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uIGNvbmZpZy5cbl9VbnNhZmVSZXN0UXVlcnkucHJvdG90eXBlLnZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbiA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKFxuICAgIHRoaXMuY29uZmlnLmFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiA9PT0gZmFsc2UgJiZcbiAgICAhdGhpcy5hdXRoLmlzTWFzdGVyICYmXG4gICAgU2NoZW1hQ29udHJvbGxlci5zeXN0ZW1DbGFzc2VzLmluZGV4T2YodGhpcy5jbGFzc05hbWUpID09PSAtMVxuICApIHtcbiAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAgIC5sb2FkU2NoZW1hKClcbiAgICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4gc2NoZW1hQ29udHJvbGxlci5oYXNDbGFzcyh0aGlzLmNsYXNzTmFtZSkpXG4gICAgICAudGhlbihoYXNDbGFzcyA9PiB7XG4gICAgICAgIGlmIChoYXNDbGFzcyAhPT0gdHJ1ZSkge1xuICAgICAgICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgICAgICdUaGlzIHVzZXIgaXMgbm90IGFsbG93ZWQgdG8gYWNjZXNzICcgKyAnbm9uLWV4aXN0ZW50IGNsYXNzOiAnICsgdGhpcy5jbGFzc05hbWUsXG4gICAgICAgICAgICB0aGlzLmNvbmZpZ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gdHJhbnNmb3JtSW5RdWVyeShpblF1ZXJ5T2JqZWN0LCBjbGFzc05hbWUsIHJlc3VsdHMpIHtcbiAgdmFyIHZhbHVlcyA9IFtdO1xuICBmb3IgKHZhciByZXN1bHQgb2YgcmVzdWx0cykge1xuICAgIHZhbHVlcy5wdXNoKHtcbiAgICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgICAgY2xhc3NOYW1lOiBjbGFzc05hbWUsXG4gICAgICBvYmplY3RJZDogcmVzdWx0Lm9iamVjdElkLFxuICAgIH0pO1xuICB9XG4gIGRlbGV0ZSBpblF1ZXJ5T2JqZWN0WyckaW5RdWVyeSddO1xuICBpZiAoQXJyYXkuaXNBcnJheShpblF1ZXJ5T2JqZWN0WyckaW4nXSkpIHtcbiAgICBpblF1ZXJ5T2JqZWN0WyckaW4nXSA9IGluUXVlcnlPYmplY3RbJyRpbiddLmNvbmNhdCh2YWx1ZXMpO1xuICB9IGVsc2Uge1xuICAgIGluUXVlcnlPYmplY3RbJyRpbiddID0gdmFsdWVzO1xuICB9XG59XG5cbl9VbnNhZmVSZXN0UXVlcnkucHJvdG90eXBlLmNoZWNrU3VicXVlcnlEZXB0aCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuYXV0aC5pc01hc3RlciB8fCB0aGlzLmF1dGguaXNNYWludGVuYW5jZSkge1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByYyA9IHRoaXMuY29uZmlnLnJlcXVlc3RDb21wbGV4aXR5O1xuICBpZiAoIXJjIHx8IHJjLnN1YnF1ZXJ5RGVwdGggPT09IC0xKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGRlcHRoID0gdGhpcy5jb250ZXh0Ll9zdWJxdWVyeURlcHRoIHx8IDA7XG4gIGlmIChkZXB0aCA+IHJjLnN1YnF1ZXJ5RGVwdGgpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gYFN1YnF1ZXJ5IG5lc3RpbmcgZGVwdGggZXhjZWVkcyBtYXhpbXVtIGFsbG93ZWQgZGVwdGggb2YgJHtyYy5zdWJxdWVyeURlcHRofWA7XG4gICAgbG9nZ2VyLndhcm4obWVzc2FnZSk7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIG1lc3NhZ2UpO1xuICB9XG59O1xuXG4vLyBSZXBsYWNlcyBhICRpblF1ZXJ5IGNsYXVzZSBieSBydW5uaW5nIHRoZSBzdWJxdWVyeSwgaWYgdGhlcmUgaXMgYW5cbi8vICRpblF1ZXJ5IGNsYXVzZS5cbi8vIFRoZSAkaW5RdWVyeSBjbGF1c2UgdHVybnMgaW50byBhbiAkaW4gd2l0aCB2YWx1ZXMgdGhhdCBhcmUganVzdFxuLy8gcG9pbnRlcnMgdG8gdGhlIG9iamVjdHMgcmV0dXJuZWQgaW4gdGhlIHN1YnF1ZXJ5LlxuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUucmVwbGFjZUluUXVlcnkgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIHZhciBpblF1ZXJ5T2JqZWN0ID0gZmluZE9iamVjdFdpdGhLZXkodGhpcy5yZXN0V2hlcmUsICckaW5RdWVyeScpO1xuICBpZiAoIWluUXVlcnlPYmplY3QpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBUaGUgaW5RdWVyeSB2YWx1ZSBtdXN0IGhhdmUgcHJlY2lzZWx5IHR3byBrZXlzIC0gd2hlcmUgYW5kIGNsYXNzTmFtZVxuICB2YXIgaW5RdWVyeVZhbHVlID0gaW5RdWVyeU9iamVjdFsnJGluUXVlcnknXTtcbiAgaWYgKCFpblF1ZXJ5VmFsdWUud2hlcmUgfHwgIWluUXVlcnlWYWx1ZS5jbGFzc05hbWUpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgJ2ltcHJvcGVyIHVzYWdlIG9mICRpblF1ZXJ5Jyk7XG4gIH1cblxuICBjb25zdCBhZGRpdGlvbmFsT3B0aW9ucyA9IHtcbiAgICByZWRpcmVjdENsYXNzTmFtZUZvcktleTogaW5RdWVyeVZhbHVlLnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5LFxuICB9O1xuXG4gIGlmICh0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UpIHtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICB9IGVsc2UgaWYgKHRoaXMucmVzdE9wdGlvbnMucmVhZFByZWZlcmVuY2UpIHtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMucmVhZFByZWZlcmVuY2U7XG4gIH1cblxuICBpZiAoIXRoaXMuYXV0aC5pc01hc3RlciAmJiAhdGhpcy5hdXRoLmlzTWFpbnRlbmFuY2UpIHtcbiAgICBjb25zdCByYyA9IHRoaXMuY29uZmlnLnJlcXVlc3RDb21wbGV4aXR5O1xuICAgIGlmIChyYyAmJiByYy5zdWJxdWVyeUxpbWl0ID4gMCkge1xuICAgICAgYWRkaXRpb25hbE9wdGlvbnMubGltaXQgPSByYy5zdWJxdWVyeUxpbWl0O1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGNoaWxkQ29udGV4dCA9IHsgLi4udGhpcy5jb250ZXh0LCBfc3VicXVlcnlEZXB0aDogKHRoaXMuY29udGV4dC5fc3VicXVlcnlEZXB0aCB8fCAwKSArIDEgfTtcbiAgY29uc3Qgc3VicXVlcnkgPSBhd2FpdCBSZXN0UXVlcnkoe1xuICAgIG1ldGhvZDogUmVzdFF1ZXJ5Lk1ldGhvZC5maW5kLFxuICAgIGNvbmZpZzogdGhpcy5jb25maWcsXG4gICAgYXV0aDogdGhpcy5hdXRoLFxuICAgIGNsYXNzTmFtZTogaW5RdWVyeVZhbHVlLmNsYXNzTmFtZSxcbiAgICByZXN0V2hlcmU6IGluUXVlcnlWYWx1ZS53aGVyZSxcbiAgICByZXN0T3B0aW9uczogYWRkaXRpb25hbE9wdGlvbnMsXG4gICAgY29udGV4dDogY2hpbGRDb250ZXh0LFxuICB9KTtcbiAgcmV0dXJuIHN1YnF1ZXJ5LmV4ZWN1dGUoKS50aGVuKHJlc3BvbnNlID0+IHtcbiAgICB0cmFuc2Zvcm1JblF1ZXJ5KGluUXVlcnlPYmplY3QsIHN1YnF1ZXJ5LmNsYXNzTmFtZSwgcmVzcG9uc2UucmVzdWx0cyk7XG4gICAgLy8gUmVjdXJzZSB0byByZXBlYXRcbiAgICByZXR1cm4gdGhpcy5yZXBsYWNlSW5RdWVyeSgpO1xuICB9KTtcbn07XG5cbmZ1bmN0aW9uIHRyYW5zZm9ybU5vdEluUXVlcnkobm90SW5RdWVyeU9iamVjdCwgY2xhc3NOYW1lLCByZXN1bHRzKSB7XG4gIHZhciB2YWx1ZXMgPSBbXTtcbiAgZm9yICh2YXIgcmVzdWx0IG9mIHJlc3VsdHMpIHtcbiAgICB2YWx1ZXMucHVzaCh7XG4gICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgIGNsYXNzTmFtZTogY2xhc3NOYW1lLFxuICAgICAgb2JqZWN0SWQ6IHJlc3VsdC5vYmplY3RJZCxcbiAgICB9KTtcbiAgfVxuICBkZWxldGUgbm90SW5RdWVyeU9iamVjdFsnJG5vdEluUXVlcnknXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkobm90SW5RdWVyeU9iamVjdFsnJG5pbiddKSkge1xuICAgIG5vdEluUXVlcnlPYmplY3RbJyRuaW4nXSA9IG5vdEluUXVlcnlPYmplY3RbJyRuaW4nXS5jb25jYXQodmFsdWVzKTtcbiAgfSBlbHNlIHtcbiAgICBub3RJblF1ZXJ5T2JqZWN0WyckbmluJ10gPSB2YWx1ZXM7XG4gIH1cbn1cblxuLy8gUmVwbGFjZXMgYSAkbm90SW5RdWVyeSBjbGF1c2UgYnkgcnVubmluZyB0aGUgc3VicXVlcnksIGlmIHRoZXJlIGlzIGFuXG4vLyAkbm90SW5RdWVyeSBjbGF1c2UuXG4vLyBUaGUgJG5vdEluUXVlcnkgY2xhdXNlIHR1cm5zIGludG8gYSAkbmluIHdpdGggdmFsdWVzIHRoYXQgYXJlIGp1c3Rcbi8vIHBvaW50ZXJzIHRvIHRoZSBvYmplY3RzIHJldHVybmVkIGluIHRoZSBzdWJxdWVyeS5cbl9VbnNhZmVSZXN0UXVlcnkucHJvdG90eXBlLnJlcGxhY2VOb3RJblF1ZXJ5ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICB2YXIgbm90SW5RdWVyeU9iamVjdCA9IGZpbmRPYmplY3RXaXRoS2V5KHRoaXMucmVzdFdoZXJlLCAnJG5vdEluUXVlcnknKTtcbiAgaWYgKCFub3RJblF1ZXJ5T2JqZWN0KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVGhlIG5vdEluUXVlcnkgdmFsdWUgbXVzdCBoYXZlIHByZWNpc2VseSB0d28ga2V5cyAtIHdoZXJlIGFuZCBjbGFzc05hbWVcbiAgdmFyIG5vdEluUXVlcnlWYWx1ZSA9IG5vdEluUXVlcnlPYmplY3RbJyRub3RJblF1ZXJ5J107XG4gIGlmICghbm90SW5RdWVyeVZhbHVlLndoZXJlIHx8ICFub3RJblF1ZXJ5VmFsdWUuY2xhc3NOYW1lKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksICdpbXByb3BlciB1c2FnZSBvZiAkbm90SW5RdWVyeScpO1xuICB9XG5cbiAgY29uc3QgYWRkaXRpb25hbE9wdGlvbnMgPSB7XG4gICAgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXk6IG5vdEluUXVlcnlWYWx1ZS5yZWRpcmVjdENsYXNzTmFtZUZvcktleSxcbiAgfTtcblxuICBpZiAodGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlKSB7XG4gICAgYWRkaXRpb25hbE9wdGlvbnMucmVhZFByZWZlcmVuY2UgPSB0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gICAgYWRkaXRpb25hbE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgfSBlbHNlIGlmICh0aGlzLnJlc3RPcHRpb25zLnJlYWRQcmVmZXJlbmNlKSB7XG4gICAgYWRkaXRpb25hbE9wdGlvbnMucmVhZFByZWZlcmVuY2UgPSB0aGlzLnJlc3RPcHRpb25zLnJlYWRQcmVmZXJlbmNlO1xuICB9XG5cbiAgaWYgKCF0aGlzLmF1dGguaXNNYXN0ZXIgJiYgIXRoaXMuYXV0aC5pc01haW50ZW5hbmNlKSB7XG4gICAgY29uc3QgcmMgPSB0aGlzLmNvbmZpZy5yZXF1ZXN0Q29tcGxleGl0eTtcbiAgICBpZiAocmMgJiYgcmMuc3VicXVlcnlMaW1pdCA+IDApIHtcbiAgICAgIGFkZGl0aW9uYWxPcHRpb25zLmxpbWl0ID0gcmMuc3VicXVlcnlMaW1pdDtcbiAgICB9XG4gIH1cblxuICBjb25zdCBjaGlsZENvbnRleHQgPSB7IC4uLnRoaXMuY29udGV4dCwgX3N1YnF1ZXJ5RGVwdGg6ICh0aGlzLmNvbnRleHQuX3N1YnF1ZXJ5RGVwdGggfHwgMCkgKyAxIH07XG4gIGNvbnN0IHN1YnF1ZXJ5ID0gYXdhaXQgUmVzdFF1ZXJ5KHtcbiAgICBtZXRob2Q6IFJlc3RRdWVyeS5NZXRob2QuZmluZCxcbiAgICBjb25maWc6IHRoaXMuY29uZmlnLFxuICAgIGF1dGg6IHRoaXMuYXV0aCxcbiAgICBjbGFzc05hbWU6IG5vdEluUXVlcnlWYWx1ZS5jbGFzc05hbWUsXG4gICAgcmVzdFdoZXJlOiBub3RJblF1ZXJ5VmFsdWUud2hlcmUsXG4gICAgcmVzdE9wdGlvbnM6IGFkZGl0aW9uYWxPcHRpb25zLFxuICAgIGNvbnRleHQ6IGNoaWxkQ29udGV4dCxcbiAgfSk7XG5cbiAgcmV0dXJuIHN1YnF1ZXJ5LmV4ZWN1dGUoKS50aGVuKHJlc3BvbnNlID0+IHtcbiAgICB0cmFuc2Zvcm1Ob3RJblF1ZXJ5KG5vdEluUXVlcnlPYmplY3QsIHN1YnF1ZXJ5LmNsYXNzTmFtZSwgcmVzcG9uc2UucmVzdWx0cyk7XG4gICAgLy8gUmVjdXJzZSB0byByZXBlYXRcbiAgICByZXR1cm4gdGhpcy5yZXBsYWNlTm90SW5RdWVyeSgpO1xuICB9KTtcbn07XG5cbi8vIFVzZWQgdG8gZ2V0IHRoZSBkZWVwZXN0IG9iamVjdCBmcm9tIGpzb24gdXNpbmcgZG90IG5vdGF0aW9uLlxuY29uc3QgZ2V0RGVlcGVzdE9iamVjdEZyb21LZXkgPSAoanNvbiwga2V5LCBpZHgsIHNyYykgPT4ge1xuICBpZiAoa2V5IGluIGpzb24pIHtcbiAgICByZXR1cm4ganNvbltrZXldO1xuICB9XG4gIHNyYy5zcGxpY2UoMSk7IC8vIEV4aXQgRWFybHlcbn07XG5cbmNvbnN0IHRyYW5zZm9ybVNlbGVjdCA9IChzZWxlY3RPYmplY3QsIGtleSwgb2JqZWN0cykgPT4ge1xuICB2YXIgdmFsdWVzID0gW107XG4gIGZvciAodmFyIHJlc3VsdCBvZiBvYmplY3RzKSB7XG4gICAgdmFsdWVzLnB1c2goa2V5LnNwbGl0KCcuJykucmVkdWNlKGdldERlZXBlc3RPYmplY3RGcm9tS2V5LCByZXN1bHQpKTtcbiAgfVxuICBkZWxldGUgc2VsZWN0T2JqZWN0Wyckc2VsZWN0J107XG4gIGlmIChBcnJheS5pc0FycmF5KHNlbGVjdE9iamVjdFsnJGluJ10pKSB7XG4gICAgc2VsZWN0T2JqZWN0WyckaW4nXSA9IHNlbGVjdE9iamVjdFsnJGluJ10uY29uY2F0KHZhbHVlcyk7XG4gIH0gZWxzZSB7XG4gICAgc2VsZWN0T2JqZWN0WyckaW4nXSA9IHZhbHVlcztcbiAgfVxufTtcblxuLy8gUmVwbGFjZXMgYSAkc2VsZWN0IGNsYXVzZSBieSBydW5uaW5nIHRoZSBzdWJxdWVyeSwgaWYgdGhlcmUgaXMgYVxuLy8gJHNlbGVjdCBjbGF1c2UuXG4vLyBUaGUgJHNlbGVjdCBjbGF1c2UgdHVybnMgaW50byBhbiAkaW4gd2l0aCB2YWx1ZXMgc2VsZWN0ZWQgb3V0IG9mXG4vLyB0aGUgc3VicXVlcnkuXG4vLyBSZXR1cm5zIGEgcG9zc2libGUtcHJvbWlzZS5cbl9VbnNhZmVSZXN0UXVlcnkucHJvdG90eXBlLnJlcGxhY2VTZWxlY3QgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxlY3RPYmplY3QgPSBmaW5kT2JqZWN0V2l0aEtleSh0aGlzLnJlc3RXaGVyZSwgJyRzZWxlY3QnKTtcbiAgaWYgKCFzZWxlY3RPYmplY3QpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBUaGUgc2VsZWN0IHZhbHVlIG11c3QgaGF2ZSBwcmVjaXNlbHkgdHdvIGtleXMgLSBxdWVyeSBhbmQga2V5XG4gIHZhciBzZWxlY3RWYWx1ZSA9IHNlbGVjdE9iamVjdFsnJHNlbGVjdCddO1xuICAvLyBpT1MgU0RLIGRvbid0IHNlbmQgd2hlcmUgaWYgbm90IHNldCwgbGV0IGl0IHBhc3NcbiAgaWYgKFxuICAgICFzZWxlY3RWYWx1ZS5xdWVyeSB8fFxuICAgICFzZWxlY3RWYWx1ZS5rZXkgfHxcbiAgICB0eXBlb2Ygc2VsZWN0VmFsdWUucXVlcnkgIT09ICdvYmplY3QnIHx8XG4gICAgIXNlbGVjdFZhbHVlLnF1ZXJ5LmNsYXNzTmFtZSB8fFxuICAgIE9iamVjdC5rZXlzKHNlbGVjdFZhbHVlKS5sZW5ndGggIT09IDJcbiAgKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksICdpbXByb3BlciB1c2FnZSBvZiAkc2VsZWN0Jyk7XG4gIH1cblxuICBjb25zdCBhZGRpdGlvbmFsT3B0aW9ucyA9IHtcbiAgICByZWRpcmVjdENsYXNzTmFtZUZvcktleTogc2VsZWN0VmFsdWUucXVlcnkucmVkaXJlY3RDbGFzc05hbWVGb3JLZXksXG4gIH07XG5cbiAgaWYgKHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZSkge1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UgPSB0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gIH0gZWxzZSBpZiAodGhpcy5yZXN0T3B0aW9ucy5yZWFkUHJlZmVyZW5jZSkge1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5yZWFkUHJlZmVyZW5jZTtcbiAgfVxuXG4gIGlmICghdGhpcy5hdXRoLmlzTWFzdGVyICYmICF0aGlzLmF1dGguaXNNYWludGVuYW5jZSkge1xuICAgIGNvbnN0IHJjID0gdGhpcy5jb25maWcucmVxdWVzdENvbXBsZXhpdHk7XG4gICAgaWYgKHJjICYmIHJjLnN1YnF1ZXJ5TGltaXQgPiAwKSB7XG4gICAgICBhZGRpdGlvbmFsT3B0aW9ucy5saW1pdCA9IHJjLnN1YnF1ZXJ5TGltaXQ7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgY2hpbGRDb250ZXh0ID0geyAuLi50aGlzLmNvbnRleHQsIF9zdWJxdWVyeURlcHRoOiAodGhpcy5jb250ZXh0Ll9zdWJxdWVyeURlcHRoIHx8IDApICsgMSB9O1xuICBjb25zdCBzdWJxdWVyeSA9IGF3YWl0IFJlc3RRdWVyeSh7XG4gICAgbWV0aG9kOiBSZXN0UXVlcnkuTWV0aG9kLmZpbmQsXG4gICAgY29uZmlnOiB0aGlzLmNvbmZpZyxcbiAgICBhdXRoOiB0aGlzLmF1dGgsXG4gICAgY2xhc3NOYW1lOiBzZWxlY3RWYWx1ZS5xdWVyeS5jbGFzc05hbWUsXG4gICAgcmVzdFdoZXJlOiBzZWxlY3RWYWx1ZS5xdWVyeS53aGVyZSxcbiAgICByZXN0T3B0aW9uczogYWRkaXRpb25hbE9wdGlvbnMsXG4gICAgY29udGV4dDogY2hpbGRDb250ZXh0LFxuICB9KTtcblxuICByZXR1cm4gc3VicXVlcnkuZXhlY3V0ZSgpLnRoZW4ocmVzcG9uc2UgPT4ge1xuICAgIHRyYW5zZm9ybVNlbGVjdChzZWxlY3RPYmplY3QsIHNlbGVjdFZhbHVlLmtleSwgcmVzcG9uc2UucmVzdWx0cyk7XG4gICAgLy8gS2VlcCByZXBsYWNpbmcgJHNlbGVjdCBjbGF1c2VzXG4gICAgcmV0dXJuIHRoaXMucmVwbGFjZVNlbGVjdCgpO1xuICB9KTtcbn07XG5cbmNvbnN0IHRyYW5zZm9ybURvbnRTZWxlY3QgPSAoZG9udFNlbGVjdE9iamVjdCwga2V5LCBvYmplY3RzKSA9PiB7XG4gIHZhciB2YWx1ZXMgPSBbXTtcbiAgZm9yICh2YXIgcmVzdWx0IG9mIG9iamVjdHMpIHtcbiAgICB2YWx1ZXMucHVzaChrZXkuc3BsaXQoJy4nKS5yZWR1Y2UoZ2V0RGVlcGVzdE9iamVjdEZyb21LZXksIHJlc3VsdCkpO1xuICB9XG4gIGRlbGV0ZSBkb250U2VsZWN0T2JqZWN0WyckZG9udFNlbGVjdCddO1xuICBpZiAoQXJyYXkuaXNBcnJheShkb250U2VsZWN0T2JqZWN0WyckbmluJ10pKSB7XG4gICAgZG9udFNlbGVjdE9iamVjdFsnJG5pbiddID0gZG9udFNlbGVjdE9iamVjdFsnJG5pbiddLmNvbmNhdCh2YWx1ZXMpO1xuICB9IGVsc2Uge1xuICAgIGRvbnRTZWxlY3RPYmplY3RbJyRuaW4nXSA9IHZhbHVlcztcbiAgfVxufTtcblxuLy8gUmVwbGFjZXMgYSAkZG9udFNlbGVjdCBjbGF1c2UgYnkgcnVubmluZyB0aGUgc3VicXVlcnksIGlmIHRoZXJlIGlzIGFcbi8vICRkb250U2VsZWN0IGNsYXVzZS5cbi8vIFRoZSAkZG9udFNlbGVjdCBjbGF1c2UgdHVybnMgaW50byBhbiAkbmluIHdpdGggdmFsdWVzIHNlbGVjdGVkIG91dCBvZlxuLy8gdGhlIHN1YnF1ZXJ5LlxuLy8gUmV0dXJucyBhIHBvc3NpYmxlLXByb21pc2UuXG5fVW5zYWZlUmVzdFF1ZXJ5LnByb3RvdHlwZS5yZXBsYWNlRG9udFNlbGVjdCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgdmFyIGRvbnRTZWxlY3RPYmplY3QgPSBmaW5kT2JqZWN0V2l0aEtleSh0aGlzLnJlc3RXaGVyZSwgJyRkb250U2VsZWN0Jyk7XG4gIGlmICghZG9udFNlbGVjdE9iamVjdCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFRoZSBkb250U2VsZWN0IHZhbHVlIG11c3QgaGF2ZSBwcmVjaXNlbHkgdHdvIGtleXMgLSBxdWVyeSBhbmQga2V5XG4gIHZhciBkb250U2VsZWN0VmFsdWUgPSBkb250U2VsZWN0T2JqZWN0WyckZG9udFNlbGVjdCddO1xuICBpZiAoXG4gICAgIWRvbnRTZWxlY3RWYWx1ZS5xdWVyeSB8fFxuICAgICFkb250U2VsZWN0VmFsdWUua2V5IHx8XG4gICAgdHlwZW9mIGRvbnRTZWxlY3RWYWx1ZS5xdWVyeSAhPT0gJ29iamVjdCcgfHxcbiAgICAhZG9udFNlbGVjdFZhbHVlLnF1ZXJ5LmNsYXNzTmFtZSB8fFxuICAgIE9iamVjdC5rZXlzKGRvbnRTZWxlY3RWYWx1ZSkubGVuZ3RoICE9PSAyXG4gICkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnaW1wcm9wZXIgdXNhZ2Ugb2YgJGRvbnRTZWxlY3QnKTtcbiAgfVxuICBjb25zdCBhZGRpdGlvbmFsT3B0aW9ucyA9IHtcbiAgICByZWRpcmVjdENsYXNzTmFtZUZvcktleTogZG9udFNlbGVjdFZhbHVlLnF1ZXJ5LnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5LFxuICB9O1xuXG4gIGlmICh0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UpIHtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICB9IGVsc2UgaWYgKHRoaXMucmVzdE9wdGlvbnMucmVhZFByZWZlcmVuY2UpIHtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMucmVhZFByZWZlcmVuY2U7XG4gIH1cblxuICBpZiAoIXRoaXMuYXV0aC5pc01hc3RlciAmJiAhdGhpcy5hdXRoLmlzTWFpbnRlbmFuY2UpIHtcbiAgICBjb25zdCByYyA9IHRoaXMuY29uZmlnLnJlcXVlc3RDb21wbGV4aXR5O1xuICAgIGlmIChyYyAmJiByYy5zdWJxdWVyeUxpbWl0ID4gMCkge1xuICAgICAgYWRkaXRpb25hbE9wdGlvbnMubGltaXQgPSByYy5zdWJxdWVyeUxpbWl0O1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGNoaWxkQ29udGV4dCA9IHsgLi4udGhpcy5jb250ZXh0LCBfc3VicXVlcnlEZXB0aDogKHRoaXMuY29udGV4dC5fc3VicXVlcnlEZXB0aCB8fCAwKSArIDEgfTtcbiAgY29uc3Qgc3VicXVlcnkgPSBhd2FpdCBSZXN0UXVlcnkoe1xuICAgIG1ldGhvZDogUmVzdFF1ZXJ5Lk1ldGhvZC5maW5kLFxuICAgIGNvbmZpZzogdGhpcy5jb25maWcsXG4gICAgYXV0aDogdGhpcy5hdXRoLFxuICAgIGNsYXNzTmFtZTogZG9udFNlbGVjdFZhbHVlLnF1ZXJ5LmNsYXNzTmFtZSxcbiAgICByZXN0V2hlcmU6IGRvbnRTZWxlY3RWYWx1ZS5xdWVyeS53aGVyZSxcbiAgICByZXN0T3B0aW9uczogYWRkaXRpb25hbE9wdGlvbnMsXG4gICAgY29udGV4dDogY2hpbGRDb250ZXh0LFxuICB9KTtcblxuICByZXR1cm4gc3VicXVlcnkuZXhlY3V0ZSgpLnRoZW4ocmVzcG9uc2UgPT4ge1xuICAgIHRyYW5zZm9ybURvbnRTZWxlY3QoZG9udFNlbGVjdE9iamVjdCwgZG9udFNlbGVjdFZhbHVlLmtleSwgcmVzcG9uc2UucmVzdWx0cyk7XG4gICAgLy8gS2VlcCByZXBsYWNpbmcgJGRvbnRTZWxlY3QgY2xhdXNlc1xuICAgIHJldHVybiB0aGlzLnJlcGxhY2VEb250U2VsZWN0KCk7XG4gIH0pO1xufTtcblxuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUuY2xlYW5SZXN1bHRBdXRoRGF0YSA9IGZ1bmN0aW9uIChyZXN1bHQpIHtcbiAgZGVsZXRlIHJlc3VsdC5wYXNzd29yZDtcbiAgaWYgKHJlc3VsdC5hdXRoRGF0YSkge1xuICAgIE9iamVjdC5rZXlzKHJlc3VsdC5hdXRoRGF0YSkuZm9yRWFjaChwcm92aWRlciA9PiB7XG4gICAgICBpZiAocmVzdWx0LmF1dGhEYXRhW3Byb3ZpZGVyXSA9PT0gbnVsbCkge1xuICAgICAgICBkZWxldGUgcmVzdWx0LmF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChPYmplY3Qua2V5cyhyZXN1bHQuYXV0aERhdGEpLmxlbmd0aCA9PSAwKSB7XG4gICAgICBkZWxldGUgcmVzdWx0LmF1dGhEYXRhO1xuICAgIH1cbiAgfVxufTtcblxuY29uc3QgcmVwbGFjZUVxdWFsaXR5Q29uc3RyYWludCA9IGNvbnN0cmFpbnQgPT4ge1xuICBpZiAodHlwZW9mIGNvbnN0cmFpbnQgIT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIGNvbnN0cmFpbnQ7XG4gIH1cbiAgY29uc3QgZXF1YWxUb09iamVjdCA9IHt9O1xuICBsZXQgaGFzRGlyZWN0Q29uc3RyYWludCA9IGZhbHNlO1xuICBsZXQgaGFzT3BlcmF0b3JDb25zdHJhaW50ID0gZmFsc2U7XG4gIGZvciAoY29uc3Qga2V5IGluIGNvbnN0cmFpbnQpIHtcbiAgICBpZiAoa2V5LmluZGV4T2YoJyQnKSAhPT0gMCkge1xuICAgICAgaGFzRGlyZWN0Q29uc3RyYWludCA9IHRydWU7XG4gICAgICBlcXVhbFRvT2JqZWN0W2tleV0gPSBjb25zdHJhaW50W2tleV07XG4gICAgfSBlbHNlIHtcbiAgICAgIGhhc09wZXJhdG9yQ29uc3RyYWludCA9IHRydWU7XG4gICAgfVxuICB9XG4gIGlmIChoYXNEaXJlY3RDb25zdHJhaW50ICYmIGhhc09wZXJhdG9yQ29uc3RyYWludCkge1xuICAgIGNvbnN0cmFpbnRbJyRlcSddID0gZXF1YWxUb09iamVjdDtcbiAgICBPYmplY3Qua2V5cyhlcXVhbFRvT2JqZWN0KS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICBkZWxldGUgY29uc3RyYWludFtrZXldO1xuICAgIH0pO1xuICB9XG4gIHJldHVybiBjb25zdHJhaW50O1xufTtcblxuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUucmVwbGFjZUVxdWFsaXR5ID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIHRoaXMucmVzdFdoZXJlICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IGtleSBpbiB0aGlzLnJlc3RXaGVyZSkge1xuICAgIHRoaXMucmVzdFdoZXJlW2tleV0gPSByZXBsYWNlRXF1YWxpdHlDb25zdHJhaW50KHRoaXMucmVzdFdoZXJlW2tleV0pO1xuICB9XG59O1xuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3Igd2hldGhlciBpdCB3YXMgc3VjY2Vzc2Z1bC5cbi8vIFBvcHVsYXRlcyB0aGlzLnJlc3BvbnNlIHdpdGggYW4gb2JqZWN0IHRoYXQgb25seSBoYXMgJ3Jlc3VsdHMnLlxuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUucnVuRmluZCA9IGFzeW5jIGZ1bmN0aW9uIChvcHRpb25zID0ge30pIHtcbiAgaWYgKHRoaXMuZmluZE9wdGlvbnMubGltaXQgPT09IDApIHtcbiAgICB0aGlzLnJlc3BvbnNlID0geyByZXN1bHRzOiBbXSB9O1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuICBjb25zdCBmaW5kT3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuZmluZE9wdGlvbnMpO1xuICBpZiAodGhpcy5rZXlzKSB7XG4gICAgZmluZE9wdGlvbnMua2V5cyA9IHRoaXMua2V5cy5tYXAoa2V5ID0+IHtcbiAgICAgIHJldHVybiBrZXkuc3BsaXQoJy4nKVswXTtcbiAgICB9KTtcbiAgICAvLyBXaGVuIHNlbGVjdGluZyBgYXV0aERhdGFgIG9uIGBfVXNlcmAsIGFsc28gYWRkIHRoZSBpbnRlcm5hbCBhdXRoIGRhdGEgZmllbGRzXG4gICAgLy8gKGUuZy4gYF9hdXRoX2RhdGFfZmFjZWJvb2tgKSBmb3IgZWFjaCBjb25maWd1cmVkIGF1dGggcHJvdmlkZXIuIEluIE1vbmdvREIsXG4gICAgLy8gYGF1dGhEYXRhYCBpcyBzdG9yZWQgYXMgaW5kaXZpZHVhbCBgX2F1dGhfZGF0YV88cHJvdmlkZXI+YCBmaWVsZHMsIHNvIHRoZVxuICAgIC8vIHByb2plY3Rpb24gZm9yIGBhdXRoRGF0YWAgYWxvbmUgd29uJ3QgbWF0Y2ggdGhlbS4gQWRkaW5nIGJvdGggZW5zdXJlcyBpdFxuICAgIC8vIHdvcmtzIGFjcm9zcyBhbGwgZGF0YWJhc2UgYWRhcHRlcnM6IE1vbmdvIHVzZXMgYF9hdXRoX2RhdGFfKmAgZmllbGRzLFxuICAgIC8vIFBvc3RncmVzIHVzZXMgdGhlIGBhdXRoRGF0YWAgY29sdW1uIGRpcmVjdGx5LlxuICAgIC8vXG4gICAgLy8gTm90ZTogV2hlbiBzZWxlY3RpbmcgYGF1dGhEYXRhYCwgb25seSBhdXRoIGRhdGEgb2YgY3VycmVudGx5IGNvbmZpZ3VyZWRcbiAgICAvLyBwcm92aWRlcnMgaXMgcmV0dXJuZWQuIEF1dGggZGF0YSBlbnRyaWVzIG9mIHByb3ZpZGVycyB0aGF0IGFyZSBubyBsb25nZXJcbiAgICAvLyBjb25maWd1cmVkIHdvbid0IGJlIGluY2x1ZGVkLiBUbyByZXR1cm4gYWxsIGF1dGggZGF0YSByZWdhcmRsZXNzIG9mIHRoZVxuICAgIC8vIHByb3ZpZGVyIGNvbmZpZ3VyYXRpb24sIGRvIG5vdCB1c2UgYGF1dGhEYXRhYCBhcyBhIHNlbGVjdGVkIGtleS5cbiAgICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiYgZmluZE9wdGlvbnMua2V5cy5pbmNsdWRlcygnYXV0aERhdGEnKSkge1xuICAgICAgY29uc3QgcHJvdmlkZXJzID0gdGhpcy5jb25maWcuYXV0aERhdGFNYW5hZ2VyLmdldFByb3ZpZGVycygpO1xuICAgICAgZm9yIChjb25zdCBwcm92aWRlciBvZiBwcm92aWRlcnMpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gYF9hdXRoX2RhdGFfJHtwcm92aWRlcn1gO1xuICAgICAgICBpZiAoIWZpbmRPcHRpb25zLmtleXMuaW5jbHVkZXMoa2V5KSkge1xuICAgICAgICAgIGZpbmRPcHRpb25zLmtleXMucHVzaChrZXkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGlmIChvcHRpb25zLm9wKSB7XG4gICAgZmluZE9wdGlvbnMub3AgPSBvcHRpb25zLm9wO1xuICB9XG4gIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKHRoaXMuY2xhc3NOYW1lLCB0aGlzLnJlc3RXaGVyZSwgZmluZE9wdGlvbnMsIHRoaXMuYXV0aCk7XG4gIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJiAhZmluZE9wdGlvbnMuZXhwbGFpbikge1xuICAgIGZvciAodmFyIHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgICB0aGlzLmNsZWFuUmVzdWx0QXV0aERhdGEocmVzdWx0KTtcbiAgICB9XG4gIH1cblxuICBhd2FpdCB0aGlzLmNvbmZpZy5maWxlc0NvbnRyb2xsZXIuZXhwYW5kRmlsZXNJbk9iamVjdCh0aGlzLmNvbmZpZywgcmVzdWx0cyk7XG5cbiAgaWYgKHRoaXMucmVkaXJlY3RDbGFzc05hbWUpIHtcbiAgICBmb3IgKHZhciByIG9mIHJlc3VsdHMpIHtcbiAgICAgIHIuY2xhc3NOYW1lID0gdGhpcy5yZWRpcmVjdENsYXNzTmFtZTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZXNwb25zZSA9IHsgcmVzdWx0czogcmVzdWx0cyB9O1xufTtcblxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIHdoZXRoZXIgaXQgd2FzIHN1Y2Nlc3NmdWwuXG4vLyBQb3B1bGF0ZXMgdGhpcy5yZXNwb25zZS5jb3VudCB3aXRoIHRoZSBjb3VudFxuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUucnVuQ291bnQgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICghdGhpcy5kb0NvdW50KSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHRoaXMuZmluZE9wdGlvbnMuY291bnQgPSB0cnVlO1xuICBkZWxldGUgdGhpcy5maW5kT3B0aW9ucy5za2lwO1xuICBkZWxldGUgdGhpcy5maW5kT3B0aW9ucy5saW1pdDtcbiAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQodGhpcy5jbGFzc05hbWUsIHRoaXMucmVzdFdoZXJlLCB0aGlzLmZpbmRPcHRpb25zKS50aGVuKGMgPT4ge1xuICAgIHRoaXMucmVzcG9uc2UuY291bnQgPSBjO1xuICB9KTtcbn07XG5cbl9VbnNhZmVSZXN0UXVlcnkucHJvdG90eXBlLmRlbnlQcm90ZWN0ZWRGaWVsZHMgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLmF1dGguaXNNYXN0ZXIgfHwgdGhpcy5hdXRoLmlzTWFpbnRlbmFuY2UpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgc2NoZW1hQ29udHJvbGxlciA9IGF3YWl0IHRoaXMuY29uZmlnLmRhdGFiYXNlLmxvYWRTY2hlbWEoKTtcbiAgY29uc3QgcHJvdGVjdGVkRmllbGRzID1cbiAgICB0aGlzLmNvbmZpZy5kYXRhYmFzZS5hZGRQcm90ZWN0ZWRGaWVsZHMoXG4gICAgICBzY2hlbWFDb250cm9sbGVyLFxuICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICB0aGlzLnJlc3RXaGVyZSxcbiAgICAgIHRoaXMuZmluZE9wdGlvbnMuYWNsLFxuICAgICAgdGhpcy5hdXRoLFxuICAgICAgdGhpcy5maW5kT3B0aW9uc1xuICAgICkgfHwgW107XG4gIGNvbnN0IGNoZWNrV2hlcmUgPSAod2hlcmUpID0+IHtcbiAgICBpZiAodHlwZW9mIHdoZXJlICE9PSAnb2JqZWN0JyB8fCB3aGVyZSA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IHdoZXJlS2V5IG9mIE9iamVjdC5rZXlzKHdoZXJlKSkge1xuICAgICAgY29uc3Qgcm9vdEZpZWxkID0gd2hlcmVLZXkuc3BsaXQoJy4nKVswXTtcbiAgICAgIGlmIChwcm90ZWN0ZWRGaWVsZHMuaW5jbHVkZXMod2hlcmVLZXkpIHx8IHByb3RlY3RlZEZpZWxkcy5pbmNsdWRlcyhyb290RmllbGQpKSB7XG4gICAgICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAgICAgYFRoaXMgdXNlciBpcyBub3QgYWxsb3dlZCB0byBxdWVyeSAke3doZXJlS2V5fSBvbiBjbGFzcyAke3RoaXMuY2xhc3NOYW1lfWAsXG4gICAgICAgICAgdGhpcy5jb25maWdcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZm9yIChjb25zdCBvcCBvZiBbJyRvcicsICckYW5kJywgJyRub3InXSkge1xuICAgICAgaWYgKHdoZXJlW29wXSAhPT0gdW5kZWZpbmVkICYmICFBcnJheS5pc0FycmF5KHdoZXJlW29wXSkpIHtcbiAgICAgICAgdGhyb3cgY3JlYXRlU2FuaXRpemVkRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgICBgJHtvcH0gbXVzdCBiZSBhbiBhcnJheWAsXG4gICAgICAgICAgdGhpcy5jb25maWdcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHdoZXJlW29wXSkpIHtcbiAgICAgICAgd2hlcmVbb3BdLmZvckVhY2goc3ViUXVlcnkgPT4gY2hlY2tXaGVyZShzdWJRdWVyeSkpO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbiAgY2hlY2tXaGVyZSh0aGlzLnJlc3RXaGVyZSk7XG5cbiAgLy8gQ2hlY2sgc29ydCBrZXlzIGFnYWluc3QgcHJvdGVjdGVkIGZpZWxkc1xuICBpZiAodGhpcy5maW5kT3B0aW9ucy5zb3J0KSB7XG4gICAgZm9yIChjb25zdCBzb3J0S2V5IG9mIE9iamVjdC5rZXlzKHRoaXMuZmluZE9wdGlvbnMuc29ydCkpIHtcbiAgICAgIGNvbnN0IHJvb3RGaWVsZCA9IHNvcnRLZXkuc3BsaXQoJy4nKVswXTtcbiAgICAgIGlmIChwcm90ZWN0ZWRGaWVsZHMuaW5jbHVkZXMoc29ydEtleSkgfHwgcHJvdGVjdGVkRmllbGRzLmluY2x1ZGVzKHJvb3RGaWVsZCkpIHtcbiAgICAgICAgdGhyb3cgY3JlYXRlU2FuaXRpemVkRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgICBgVGhpcyB1c2VyIGlzIG5vdCBhbGxvd2VkIHRvIHNvcnQgYnkgJHtzb3J0S2V5fSBvbiBjbGFzcyAke3RoaXMuY2xhc3NOYW1lfWAsXG4gICAgICAgICAgdGhpcy5jb25maWdcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbi8vIEF1Z21lbnRzIHRoaXMucmVzcG9uc2Ugd2l0aCBhbGwgcG9pbnRlcnMgb24gYW4gb2JqZWN0XG5fVW5zYWZlUmVzdFF1ZXJ5LnByb3RvdHlwZS5oYW5kbGVJbmNsdWRlQWxsID0gZnVuY3Rpb24gKCkge1xuICBpZiAoIXRoaXMuaW5jbHVkZUFsbCkge1xuICAgIHJldHVybjtcbiAgfVxuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAubG9hZFNjaGVtYSgpXG4gICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiBzY2hlbWFDb250cm9sbGVyLmdldE9uZVNjaGVtYSh0aGlzLmNsYXNzTmFtZSkpXG4gICAgLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgIGNvbnN0IGluY2x1ZGVGaWVsZHMgPSBbXTtcbiAgICAgIGNvbnN0IGtleUZpZWxkcyA9IFtdO1xuICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBzY2hlbWEuZmllbGRzKSB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICAoc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlID09PSAnUG9pbnRlcicpIHx8XG4gICAgICAgICAgKHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSA9PT0gJ0FycmF5JylcbiAgICAgICAgKSB7XG4gICAgICAgICAgaW5jbHVkZUZpZWxkcy5wdXNoKFtmaWVsZF0pO1xuICAgICAgICAgIGtleUZpZWxkcy5wdXNoKGZpZWxkKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gQWRkIGZpZWxkcyB0byBpbmNsdWRlLCBrZXlzLCByZW1vdmUgZHVwc1xuICAgICAgdGhpcy5pbmNsdWRlID0gWy4uLm5ldyBTZXQoWy4uLnRoaXMuaW5jbHVkZSwgLi4uaW5jbHVkZUZpZWxkc10pXTtcbiAgICAgIC8vIGlmIHRoaXMua2V5cyBub3Qgc2V0LCB0aGVuIGFsbCBrZXlzIGFyZSBhbHJlYWR5IGluY2x1ZGVkXG4gICAgICBpZiAodGhpcy5rZXlzKSB7XG4gICAgICAgIHRoaXMua2V5cyA9IFsuLi5uZXcgU2V0KFsuLi50aGlzLmtleXMsIC4uLmtleUZpZWxkc10pXTtcbiAgICAgIH1cbiAgICB9KTtcbn07XG5cbl9VbnNhZmVSZXN0UXVlcnkucHJvdG90eXBlLnZhbGlkYXRlSW5jbHVkZUNvbXBsZXhpdHkgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLmF1dGguaXNNYXN0ZXIgfHwgdGhpcy5hdXRoLmlzTWFpbnRlbmFuY2UpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcmMgPSB0aGlzLmNvbmZpZy5yZXF1ZXN0Q29tcGxleGl0eTtcbiAgaWYgKCFyYykge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAocmMuaW5jbHVkZURlcHRoICE9PSAtMSAmJiB0aGlzLmluY2x1ZGUgJiYgdGhpcy5pbmNsdWRlLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBtYXhEZXB0aCA9IE1hdGgubWF4KC4uLnRoaXMuaW5jbHVkZS5tYXAocGF0aCA9PiBwYXRoLmxlbmd0aCkpO1xuICAgIGlmIChtYXhEZXB0aCA+IHJjLmluY2x1ZGVEZXB0aCkge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGBJbmNsdWRlIGRlcHRoIG9mICR7bWF4RGVwdGh9IGV4Y2VlZHMgbWF4aW11bSBhbGxvd2VkIGRlcHRoIG9mICR7cmMuaW5jbHVkZURlcHRofWA7XG4gICAgICBsb2dnZXIud2FybihtZXNzYWdlKTtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBtZXNzYWdlKTtcbiAgICB9XG4gIH1cbiAgaWYgKHJjLmluY2x1ZGVDb3VudCAhPT0gLTEgJiYgdGhpcy5pbmNsdWRlICYmIHRoaXMuaW5jbHVkZS5sZW5ndGggPiByYy5pbmNsdWRlQ291bnQpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gYE51bWJlciBvZiBpbmNsdWRlIGZpZWxkcyAoJHt0aGlzLmluY2x1ZGUubGVuZ3RofSkgZXhjZWVkcyBtYXhpbXVtIGFsbG93ZWQgKCR7cmMuaW5jbHVkZUNvdW50fSlgO1xuICAgIGxvZ2dlci53YXJuKG1lc3NhZ2UpO1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBtZXNzYWdlKTtcbiAgfVxufTtcblxuLy8gVXBkYXRlcyBwcm9wZXJ0eSBgdGhpcy5rZXlzYCB0byBjb250YWluIGFsbCBrZXlzIGJ1dCB0aGUgb25lcyB1bnNlbGVjdGVkLlxuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUuaGFuZGxlRXhjbHVkZUtleXMgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICghdGhpcy5leGNsdWRlS2V5cykge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5rZXlzKSB7XG4gICAgdGhpcy5rZXlzID0gdGhpcy5rZXlzLmZpbHRlcihrID0+ICF0aGlzLmV4Y2x1ZGVLZXlzLmluY2x1ZGVzKGspKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgLmxvYWRTY2hlbWEoKVxuICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4gc2NoZW1hQ29udHJvbGxlci5nZXRPbmVTY2hlbWEodGhpcy5jbGFzc05hbWUpKVxuICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICBjb25zdCBmaWVsZHMgPSBPYmplY3Qua2V5cyhzY2hlbWEuZmllbGRzKTtcbiAgICAgIHRoaXMua2V5cyA9IGZpZWxkcy5maWx0ZXIoayA9PiAhdGhpcy5leGNsdWRlS2V5cy5pbmNsdWRlcyhrKSk7XG4gICAgfSk7XG59O1xuXG4vLyBBdWdtZW50cyB0aGlzLnJlc3BvbnNlIHdpdGggZGF0YSBhdCB0aGUgcGF0aHMgcHJvdmlkZWQgaW4gdGhpcy5pbmNsdWRlLlxuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUuaGFuZGxlSW5jbHVkZSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuaW5jbHVkZS5sZW5ndGggPT0gMCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGluZGV4ZWRSZXN1bHRzID0gdGhpcy5yZXNwb25zZS5yZXN1bHRzLnJlZHVjZSgoaW5kZXhlZCwgcmVzdWx0LCBpKSA9PiB7XG4gICAgaW5kZXhlZFtyZXN1bHQub2JqZWN0SWRdID0gaTtcbiAgICByZXR1cm4gaW5kZXhlZDtcbiAgfSwge30pO1xuXG4gIC8vIEJ1aWxkIHRoZSBleGVjdXRpb24gdHJlZVxuICBjb25zdCBleGVjdXRpb25UcmVlID0ge31cbiAgdGhpcy5pbmNsdWRlLmZvckVhY2gocGF0aCA9PiB7XG4gICAgbGV0IGN1cnJlbnQgPSBleGVjdXRpb25UcmVlO1xuICAgIHBhdGguZm9yRWFjaCgobm9kZSkgPT4ge1xuICAgICAgaWYgKCFjdXJyZW50W25vZGVdKSB7XG4gICAgICAgIGN1cnJlbnRbbm9kZV0gPSB7XG4gICAgICAgICAgcGF0aCxcbiAgICAgICAgICBjaGlsZHJlbjoge31cbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50W25vZGVdLmNoaWxkcmVuXG4gICAgfSk7XG4gIH0pO1xuXG4gIGNvbnN0IHJlY3Vyc2l2ZUV4ZWN1dGlvblRyZWUgPSBhc3luYyAodHJlZU5vZGUpID0+IHtcbiAgICBjb25zdCB7IHBhdGgsIGNoaWxkcmVuIH0gPSB0cmVlTm9kZTtcbiAgICBjb25zdCBwYXRoUmVzcG9uc2UgPSBpbmNsdWRlUGF0aChcbiAgICAgIHRoaXMuY29uZmlnLFxuICAgICAgdGhpcy5hdXRoLFxuICAgICAgdGhpcy5yZXNwb25zZSxcbiAgICAgIHBhdGgsXG4gICAgICB0aGlzLmNvbnRleHQsXG4gICAgICB0aGlzLnJlc3RPcHRpb25zLFxuICAgICAgdGhpcyxcbiAgICApO1xuICAgIGlmIChwYXRoUmVzcG9uc2UudGhlbikge1xuICAgICAgY29uc3QgbmV3UmVzcG9uc2UgPSBhd2FpdCBwYXRoUmVzcG9uc2VcbiAgICAgIG5ld1Jlc3BvbnNlLnJlc3VsdHMuZm9yRWFjaChuZXdPYmplY3QgPT4ge1xuICAgICAgICAvLyBXZSBoeWRyYXRlIHRoZSByb290IG9mIGVhY2ggcmVzdWx0IHdpdGggc3ViIHJlc3VsdHNcbiAgICAgICAgdGhpcy5yZXNwb25zZS5yZXN1bHRzW2luZGV4ZWRSZXN1bHRzW25ld09iamVjdC5vYmplY3RJZF1dW3BhdGhbMF1dID0gbmV3T2JqZWN0W3BhdGhbMF1dO1xuICAgICAgfSlcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKE9iamVjdC52YWx1ZXMoY2hpbGRyZW4pLm1hcChyZWN1cnNpdmVFeGVjdXRpb25UcmVlKSk7XG4gIH1cblxuICBhd2FpdCBQcm9taXNlLmFsbChPYmplY3QudmFsdWVzKGV4ZWN1dGlvblRyZWUpLm1hcChyZWN1cnNpdmVFeGVjdXRpb25UcmVlKSk7XG4gIHRoaXMuaW5jbHVkZSA9IFtdXG59O1xuXG4vL1JldHVybnMgYSBwcm9taXNlIG9mIGEgcHJvY2Vzc2VkIHNldCBvZiByZXN1bHRzXG5fVW5zYWZlUmVzdFF1ZXJ5LnByb3RvdHlwZS5ydW5BZnRlckZpbmRUcmlnZ2VyID0gZnVuY3Rpb24gKCkge1xuICBpZiAoIXRoaXMucmVzcG9uc2UpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF0aGlzLnJ1bkFmdGVyRmluZCkge1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBBdm9pZCBkb2luZyBhbnkgc2V0dXAgZm9yIHRyaWdnZXJzIGlmIHRoZXJlIGlzIG5vICdhZnRlckZpbmQnIHRyaWdnZXIgZm9yIHRoaXMgY2xhc3MuXG4gIGNvbnN0IGhhc0FmdGVyRmluZEhvb2sgPSB0cmlnZ2Vycy50cmlnZ2VyRXhpc3RzKFxuICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyRmluZCxcbiAgICB0aGlzLmNvbmZpZy5hcHBsaWNhdGlvbklkXG4gICk7XG4gIGlmICghaGFzQWZ0ZXJGaW5kSG9vaykge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuICAvLyBTa2lwIEFnZ3JlZ2F0ZSBhbmQgRGlzdGluY3QgUXVlcmllc1xuICBpZiAodGhpcy5maW5kT3B0aW9ucy5waXBlbGluZSB8fCB0aGlzLmZpbmRPcHRpb25zLmRpc3RpbmN0KSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgY29uc3QganNvbiA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMucmVzdE9wdGlvbnMpO1xuICBqc29uLndoZXJlID0gdGhpcy5yZXN0V2hlcmU7XG4gIGNvbnN0IHBhcnNlUXVlcnkgPSBuZXcgUGFyc2UuUXVlcnkodGhpcy5jbGFzc05hbWUpO1xuICBwYXJzZVF1ZXJ5LndpdGhKU09OKGpzb24pO1xuICAvLyBSdW4gYWZ0ZXJGaW5kIHRyaWdnZXIgYW5kIHNldCB0aGUgbmV3IHJlc3VsdHNcbiAgcmV0dXJuIHRyaWdnZXJzXG4gICAgLm1heWJlUnVuQWZ0ZXJGaW5kVHJpZ2dlcihcbiAgICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyRmluZCxcbiAgICAgIHRoaXMuYXV0aCxcbiAgICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgICAgdGhpcy5yZXNwb25zZS5yZXN1bHRzLFxuICAgICAgdGhpcy5jb25maWcsXG4gICAgICBwYXJzZVF1ZXJ5LFxuICAgICAgdGhpcy5jb250ZXh0LFxuICAgICAgdGhpcy5pc0dldFxuICAgIClcbiAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgIC8vIEVuc3VyZSB3ZSBwcm9wZXJseSBzZXQgdGhlIGNsYXNzTmFtZSBiYWNrXG4gICAgICBpZiAodGhpcy5yZWRpcmVjdENsYXNzTmFtZSkge1xuICAgICAgICB0aGlzLnJlc3BvbnNlLnJlc3VsdHMgPSByZXN1bHRzLm1hcChvYmplY3QgPT4ge1xuICAgICAgICAgIGlmIChvYmplY3QgaW5zdGFuY2VvZiBQYXJzZS5PYmplY3QpIHtcbiAgICAgICAgICAgIG9iamVjdCA9IG9iamVjdC50b0pTT04oKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgb2JqZWN0LmNsYXNzTmFtZSA9IHRoaXMucmVkaXJlY3RDbGFzc05hbWU7XG4gICAgICAgICAgcmV0dXJuIG9iamVjdDtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlc3BvbnNlLnJlc3VsdHMgPSByZXN1bHRzO1xuICAgICAgfVxuICAgIH0pO1xufTtcblxuX1Vuc2FmZVJlc3RRdWVyeS5wcm90b3R5cGUuaGFuZGxlQXV0aEFkYXB0ZXJzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicgfHwgdGhpcy5maW5kT3B0aW9ucy5leHBsYWluKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGF3YWl0IFByb21pc2UuYWxsKFxuICAgIHRoaXMucmVzcG9uc2UucmVzdWx0cy5tYXAocmVzdWx0ID0+XG4gICAgICB0aGlzLmNvbmZpZy5hdXRoRGF0YU1hbmFnZXIucnVuQWZ0ZXJGaW5kKFxuICAgICAgICB7IGNvbmZpZzogdGhpcy5jb25maWcsIGF1dGg6IHRoaXMuYXV0aCB9LFxuICAgICAgICByZXN1bHQuYXV0aERhdGFcbiAgICAgIClcbiAgICApXG4gICk7XG59O1xuXG4vLyBBZGRzIGluY2x1ZGVkIHZhbHVlcyB0byB0aGUgcmVzcG9uc2UuXG4vLyBQYXRoIGlzIGEgbGlzdCBvZiBmaWVsZCBuYW1lcy5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhbiBhdWdtZW50ZWQgcmVzcG9uc2UuXG5mdW5jdGlvbiBpbmNsdWRlUGF0aChjb25maWcsIGF1dGgsIHJlc3BvbnNlLCBwYXRoLCBjb250ZXh0LCByZXN0T3B0aW9ucyA9IHt9KSB7XG4gIHZhciBwb2ludGVycyA9IGZpbmRQb2ludGVycyhyZXNwb25zZS5yZXN1bHRzLCBwYXRoKTtcbiAgaWYgKHBvaW50ZXJzLmxlbmd0aCA9PSAwKSB7XG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuICB9XG4gIGNvbnN0IHBvaW50ZXJzSGFzaCA9IHt9O1xuICBmb3IgKHZhciBwb2ludGVyIG9mIHBvaW50ZXJzKSB7XG4gICAgaWYgKCFwb2ludGVyKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgY2xhc3NOYW1lID0gcG9pbnRlci5jbGFzc05hbWU7XG4gICAgLy8gb25seSBpbmNsdWRlIHRoZSBnb29kIHBvaW50ZXJzXG4gICAgaWYgKGNsYXNzTmFtZSkge1xuICAgICAgcG9pbnRlcnNIYXNoW2NsYXNzTmFtZV0gPSBwb2ludGVyc0hhc2hbY2xhc3NOYW1lXSB8fCBuZXcgU2V0KCk7XG4gICAgICBwb2ludGVyc0hhc2hbY2xhc3NOYW1lXS5hZGQocG9pbnRlci5vYmplY3RJZCk7XG4gICAgfVxuICB9XG4gIGNvbnN0IGluY2x1ZGVSZXN0T3B0aW9ucyA9IHt9O1xuICBpZiAocmVzdE9wdGlvbnMua2V5cykge1xuICAgIGNvbnN0IGtleXMgPSBuZXcgU2V0KHJlc3RPcHRpb25zLmtleXMuc3BsaXQoJywnKSk7XG4gICAgY29uc3Qga2V5U2V0ID0gQXJyYXkuZnJvbShrZXlzKS5yZWR1Y2UoKHNldCwga2V5KSA9PiB7XG4gICAgICBjb25zdCBrZXlQYXRoID0ga2V5LnNwbGl0KCcuJyk7XG4gICAgICBsZXQgaSA9IDA7XG4gICAgICBmb3IgKGk7IGkgPCBwYXRoLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChwYXRoW2ldICE9IGtleVBhdGhbaV0pIHtcbiAgICAgICAgICByZXR1cm4gc2V0O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoaSA8IGtleVBhdGgubGVuZ3RoKSB7XG4gICAgICAgIHNldC5hZGQoa2V5UGF0aFtpXSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gc2V0O1xuICAgIH0sIG5ldyBTZXQoKSk7XG4gICAgaWYgKGtleVNldC5zaXplID4gMCkge1xuICAgICAgaW5jbHVkZVJlc3RPcHRpb25zLmtleXMgPSBBcnJheS5mcm9tKGtleVNldCkuam9pbignLCcpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChyZXN0T3B0aW9ucy5leGNsdWRlS2V5cykge1xuICAgIGNvbnN0IGV4Y2x1ZGVLZXlzID0gbmV3IFNldChyZXN0T3B0aW9ucy5leGNsdWRlS2V5cy5zcGxpdCgnLCcpKTtcbiAgICBjb25zdCBleGNsdWRlS2V5U2V0ID0gQXJyYXkuZnJvbShleGNsdWRlS2V5cykucmVkdWNlKChzZXQsIGtleSkgPT4ge1xuICAgICAgY29uc3Qga2V5UGF0aCA9IGtleS5zcGxpdCgnLicpO1xuICAgICAgbGV0IGkgPSAwO1xuICAgICAgZm9yIChpOyBpIDwgcGF0aC5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAocGF0aFtpXSAhPSBrZXlQYXRoW2ldKSB7XG4gICAgICAgICAgcmV0dXJuIHNldDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGkgPT0ga2V5UGF0aC5sZW5ndGggLSAxKSB7XG4gICAgICAgIHNldC5hZGQoa2V5UGF0aFtpXSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gc2V0O1xuICAgIH0sIG5ldyBTZXQoKSk7XG4gICAgaWYgKGV4Y2x1ZGVLZXlTZXQuc2l6ZSA+IDApIHtcbiAgICAgIGluY2x1ZGVSZXN0T3B0aW9ucy5leGNsdWRlS2V5cyA9IEFycmF5LmZyb20oZXhjbHVkZUtleVNldCkuam9pbignLCcpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChyZXN0T3B0aW9ucy5pbmNsdWRlUmVhZFByZWZlcmVuY2UpIHtcbiAgICBpbmNsdWRlUmVzdE9wdGlvbnMucmVhZFByZWZlcmVuY2UgPSByZXN0T3B0aW9ucy5pbmNsdWRlUmVhZFByZWZlcmVuY2U7XG4gICAgaW5jbHVkZVJlc3RPcHRpb25zLmluY2x1ZGVSZWFkUHJlZmVyZW5jZSA9IHJlc3RPcHRpb25zLmluY2x1ZGVSZWFkUHJlZmVyZW5jZTtcbiAgfSBlbHNlIGlmIChyZXN0T3B0aW9ucy5yZWFkUHJlZmVyZW5jZSkge1xuICAgIGluY2x1ZGVSZXN0T3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHJlc3RPcHRpb25zLnJlYWRQcmVmZXJlbmNlO1xuICB9XG4gIGNvbnN0IHF1ZXJ5UHJvbWlzZXMgPSBPYmplY3Qua2V5cyhwb2ludGVyc0hhc2gpLm1hcChhc3luYyBjbGFzc05hbWUgPT4ge1xuICAgIGNvbnN0IG9iamVjdElkcyA9IEFycmF5LmZyb20ocG9pbnRlcnNIYXNoW2NsYXNzTmFtZV0pO1xuICAgIGxldCB3aGVyZTtcbiAgICBpZiAob2JqZWN0SWRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgd2hlcmUgPSB7IG9iamVjdElkOiBvYmplY3RJZHNbMF0gfTtcbiAgICB9IGVsc2Uge1xuICAgICAgd2hlcmUgPSB7IG9iamVjdElkOiB7ICRpbjogb2JqZWN0SWRzIH0gfTtcbiAgICB9XG4gICAgY29uc3QgcXVlcnkgPSBhd2FpdCBSZXN0UXVlcnkoe1xuICAgICAgbWV0aG9kOiBvYmplY3RJZHMubGVuZ3RoID09PSAxID8gUmVzdFF1ZXJ5Lk1ldGhvZC5nZXQgOiBSZXN0UXVlcnkuTWV0aG9kLmZpbmQsXG4gICAgICBjb25maWcsXG4gICAgICBhdXRoLFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgcmVzdFdoZXJlOiB3aGVyZSxcbiAgICAgIHJlc3RPcHRpb25zOiBpbmNsdWRlUmVzdE9wdGlvbnMsXG4gICAgICBjb250ZXh0OiBjb250ZXh0LFxuICAgIH0pO1xuICAgIHJldHVybiBxdWVyeS5leGVjdXRlKHsgb3A6ICdnZXQnIH0pLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICByZXN1bHRzLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzdWx0cyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIEdldCB0aGUgb2JqZWN0cyBmb3IgYWxsIHRoZXNlIG9iamVjdCBpZHNcbiAgcmV0dXJuIFByb21pc2UuYWxsKHF1ZXJ5UHJvbWlzZXMpLnRoZW4ocmVzcG9uc2VzID0+IHtcbiAgICB2YXIgcmVwbGFjZSA9IHJlc3BvbnNlcy5yZWR1Y2UoKHJlcGxhY2UsIGluY2x1ZGVSZXNwb25zZSkgPT4ge1xuICAgICAgZm9yICh2YXIgb2JqIG9mIGluY2x1ZGVSZXNwb25zZS5yZXN1bHRzKSB7XG4gICAgICAgIG9iai5fX3R5cGUgPSAnT2JqZWN0JztcbiAgICAgICAgb2JqLmNsYXNzTmFtZSA9IGluY2x1ZGVSZXNwb25zZS5jbGFzc05hbWU7XG5cbiAgICAgICAgaWYgKG9iai5jbGFzc05hbWUgPT0gJ19Vc2VyJyAmJiAhYXV0aC5pc01hc3Rlcikge1xuICAgICAgICAgIGRlbGV0ZSBvYmouc2Vzc2lvblRva2VuO1xuICAgICAgICAgIGRlbGV0ZSBvYmouYXV0aERhdGE7XG4gICAgICAgIH1cbiAgICAgICAgcmVwbGFjZVtvYmoub2JqZWN0SWRdID0gb2JqO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlcGxhY2U7XG4gICAgfSwge30pO1xuICAgIHZhciByZXNwID0ge1xuICAgICAgcmVzdWx0czogcmVwbGFjZVBvaW50ZXJzKHJlc3BvbnNlLnJlc3VsdHMsIHBhdGgsIHJlcGxhY2UpLFxuICAgIH07XG4gICAgaWYgKHJlc3BvbnNlLmNvdW50KSB7XG4gICAgICByZXNwLmNvdW50ID0gcmVzcG9uc2UuY291bnQ7XG4gICAgfVxuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn1cblxuLy8gT2JqZWN0IG1heSBiZSBhIGxpc3Qgb2YgUkVTVC1mb3JtYXQgb2JqZWN0IHRvIGZpbmQgcG9pbnRlcnMgaW4sIG9yXG4vLyBpdCBtYXkgYmUgYSBzaW5nbGUgb2JqZWN0LlxuLy8gSWYgdGhlIHBhdGggeWllbGRzIHRoaW5ncyB0aGF0IGFyZW4ndCBwb2ludGVycywgdGhpcyB0aHJvd3MgYW4gZXJyb3IuXG4vLyBQYXRoIGlzIGEgbGlzdCBvZiBmaWVsZHMgdG8gc2VhcmNoIGludG8uXG4vLyBSZXR1cm5zIGEgbGlzdCBvZiBwb2ludGVycyBpbiBSRVNUIGZvcm1hdC5cbmZ1bmN0aW9uIGZpbmRQb2ludGVycyhvYmplY3QsIHBhdGgpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkob2JqZWN0KSkge1xuICAgIHJldHVybiBvYmplY3QubWFwKHggPT4gZmluZFBvaW50ZXJzKHgsIHBhdGgpKS5mbGF0KCk7XG4gIH1cblxuICBpZiAodHlwZW9mIG9iamVjdCAhPT0gJ29iamVjdCcgfHwgIW9iamVjdCkge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGlmIChwYXRoLmxlbmd0aCA9PSAwKSB7XG4gICAgaWYgKG9iamVjdCA9PT0gbnVsbCB8fCBvYmplY3QuX190eXBlID09ICdQb2ludGVyJykge1xuICAgICAgcmV0dXJuIFtvYmplY3RdO1xuICAgIH1cbiAgICByZXR1cm4gW107XG4gIH1cblxuICB2YXIgc3Vib2JqZWN0ID0gb2JqZWN0W3BhdGhbMF1dO1xuICBpZiAoIXN1Ym9iamVjdCkge1xuICAgIHJldHVybiBbXTtcbiAgfVxuICByZXR1cm4gZmluZFBvaW50ZXJzKHN1Ym9iamVjdCwgcGF0aC5zbGljZSgxKSk7XG59XG5cbi8vIE9iamVjdCBtYXkgYmUgYSBsaXN0IG9mIFJFU1QtZm9ybWF0IG9iamVjdHMgdG8gcmVwbGFjZSBwb2ludGVyc1xuLy8gaW4sIG9yIGl0IG1heSBiZSBhIHNpbmdsZSBvYmplY3QuXG4vLyBQYXRoIGlzIGEgbGlzdCBvZiBmaWVsZHMgdG8gc2VhcmNoIGludG8uXG4vLyByZXBsYWNlIGlzIGEgbWFwIGZyb20gb2JqZWN0IGlkIC0+IG9iamVjdC5cbi8vIFJldHVybnMgc29tZXRoaW5nIGFuYWxvZ291cyB0byBvYmplY3QsIGJ1dCB3aXRoIHRoZSBhcHByb3ByaWF0ZVxuLy8gcG9pbnRlcnMgaW5mbGF0ZWQuXG5mdW5jdGlvbiByZXBsYWNlUG9pbnRlcnMob2JqZWN0LCBwYXRoLCByZXBsYWNlKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KG9iamVjdCkpIHtcbiAgICByZXR1cm4gb2JqZWN0XG4gICAgICAubWFwKG9iaiA9PiByZXBsYWNlUG9pbnRlcnMob2JqLCBwYXRoLCByZXBsYWNlKSlcbiAgICAgIC5maWx0ZXIob2JqID0+IHR5cGVvZiBvYmogIT09ICd1bmRlZmluZWQnKTtcbiAgfVxuXG4gIGlmICh0eXBlb2Ygb2JqZWN0ICE9PSAnb2JqZWN0JyB8fCAhb2JqZWN0KSB7XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuXG4gIGlmIChwYXRoLmxlbmd0aCA9PT0gMCkge1xuICAgIGlmIChvYmplY3QgJiYgb2JqZWN0Ll9fdHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICByZXR1cm4gcmVwbGFjZVtvYmplY3Qub2JqZWN0SWRdO1xuICAgIH1cbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG5cbiAgdmFyIHN1Ym9iamVjdCA9IG9iamVjdFtwYXRoWzBdXTtcbiAgaWYgKCFzdWJvYmplY3QpIHtcbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG4gIHZhciBuZXdzdWIgPSByZXBsYWNlUG9pbnRlcnMoc3Vib2JqZWN0LCBwYXRoLnNsaWNlKDEpLCByZXBsYWNlKTtcbiAgdmFyIGFuc3dlciA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqZWN0KSB7XG4gICAgaWYgKGtleSA9PSBwYXRoWzBdKSB7XG4gICAgICBhbnN3ZXJba2V5XSA9IG5ld3N1YjtcbiAgICB9IGVsc2Uge1xuICAgICAgYW5zd2VyW2tleV0gPSBvYmplY3Rba2V5XTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGFuc3dlcjtcbn1cblxuLy8gRmluZHMgYSBzdWJvYmplY3QgdGhhdCBoYXMgdGhlIGdpdmVuIGtleSwgaWYgdGhlcmUgaXMgb25lLlxuLy8gUmV0dXJucyB1bmRlZmluZWQgb3RoZXJ3aXNlLlxuZnVuY3Rpb24gZmluZE9iamVjdFdpdGhLZXkocm9vdCwga2V5KSB7XG4gIGlmICh0eXBlb2Ygcm9vdCAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkocm9vdCkpIHtcbiAgICBmb3IgKHZhciBpdGVtIG9mIHJvb3QpIHtcbiAgICAgIGNvbnN0IGFuc3dlciA9IGZpbmRPYmplY3RXaXRoS2V5KGl0ZW0sIGtleSk7XG4gICAgICBpZiAoYW5zd2VyKSB7XG4gICAgICAgIHJldHVybiBhbnN3ZXI7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGlmIChyb290ICYmIHJvb3Rba2V5XSkge1xuICAgIHJldHVybiByb290O1xuICB9XG4gIGZvciAodmFyIHN1YmtleSBpbiByb290KSB7XG4gICAgY29uc3QgYW5zd2VyID0gZmluZE9iamVjdFdpdGhLZXkocm9vdFtzdWJrZXldLCBrZXkpO1xuICAgIGlmIChhbnN3ZXIpIHtcbiAgICAgIHJldHVybiBhbnN3ZXI7XG4gICAgfVxuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gUmVzdFF1ZXJ5O1xuLy8gRm9yIHRlc3RzXG5tb2R1bGUuZXhwb3J0cy5fVW5zYWZlUmVzdFF1ZXJ5ID0gX1Vuc2FmZVJlc3RRdWVyeTtcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBOztBQUVBLElBQUlBLGdCQUFnQixHQUFHQyxPQUFPLENBQUMsZ0NBQWdDLENBQUM7QUFDaEUsSUFBSUMsS0FBSyxHQUFHRCxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUNDLEtBQUs7QUFDdkMsSUFBSUMsTUFBTSxHQUFHRixPQUFPLENBQUMsVUFBVSxDQUFDLENBQUNHLE9BQU87QUFDeEMsTUFBTUMsUUFBUSxHQUFHSixPQUFPLENBQUMsWUFBWSxDQUFDO0FBQ3RDLE1BQU07RUFBRUs7QUFBYyxDQUFDLEdBQUdMLE9BQU8sQ0FBQyw2QkFBNkIsQ0FBQztBQUNoRSxNQUFNTSxrQkFBa0IsR0FBRyxDQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLEtBQUssQ0FBQztBQUN4RSxNQUFNO0VBQUVDO0FBQW9CLENBQUMsR0FBR1AsT0FBTyxDQUFDLGNBQWMsQ0FBQztBQUN2RCxNQUFNO0VBQUVRO0FBQXFCLENBQUMsR0FBR1IsT0FBTyxDQUFDLFNBQVMsQ0FBQzs7QUFFbkQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsZUFBZVMsU0FBU0EsQ0FBQztFQUN2QkMsTUFBTTtFQUNOQyxNQUFNO0VBQ05DLElBQUk7RUFDSkMsU0FBUztFQUNUQyxTQUFTLEdBQUcsQ0FBQyxDQUFDO0VBQ2RDLFdBQVcsR0FBRyxDQUFDLENBQUM7RUFDaEJDLFNBQVM7RUFDVEMsWUFBWSxHQUFHLElBQUk7RUFDbkJD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QUkwQixTQUFTLEdBQUcxQixNQUFNLENBQUMxSixJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7RUFDL0IsSUFBSSxDQUFDb0wsU0FBUyxFQUFFO0lBQ2QsT0FBTzFCLE1BQU07RUFDZjtFQUNBLElBQUkyQixNQUFNLEdBQUdKLGVBQWUsQ0FBQ0csU0FBUyxFQUFFcEwsSUFBSSxDQUFDdkIsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFbU0sT0FBTyxDQUFDO0VBQy9ELElBQUlVLE1BQU0sR0FBRyxDQUFDLENBQUM7RUFDZixLQUFLLElBQUkvTSxHQUFHLElBQUltTCxNQUFNLEVBQUU7SUFDdEIsSUFBSW5MLEdBQUcsSUFBSXlCLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRTtNQUNsQnNMLE1BQU0sQ0FBQy9NLEdBQUcsQ0FBQyxHQUFHOE0sTUFBTTtJQUN0QixDQUFDLE1BQU07TUFDTEMsTUFBTSxDQUFDL00sR0FBRyxDQUFDLEdBQUdtTCxNQUFNLENBQUNuTCxHQUFHLENBQUM7SUFDM0I7RUFDRjtFQUNBLE9BQU8rTSxNQUFNO0FBQ2Y7O0FBRUE7QUFDQTtBQUNBLFNBQVMvRyxpQkFBaUJBLENBQUNnSCxJQUFJLEVBQUVoTixHQUFHLEVBQUU7RUFDcEMsSUFBSSxPQUFPZ04sSUFBSSxLQUFLLFFBQVEsRUFBRTtJQUM1QjtFQUNGO0VBQ0EsSUFBSXpNLEtBQUssQ0FBQzRELE9BQU8sQ0FBQzZJLElBQUksQ0FBQyxFQUFFO0lBQ3ZCLEtBQUssSUFBSUMsSUFBSSxJQUFJRCxJQUFJLEVBQUU7TUFDckIsTUFBTUQsTUFBTSxHQUFHL0csaUJBQWlCLENBQUNpSCxJQUFJLEVBQUVqTixHQUFHLENBQUM7TUFDM0MsSUFBSStNLE1BQU0sRUFBRTtRQUNWLE9BQU9BLE1BQU07TUFDZjtJQUNGO0VBQ0Y7RUFDQSxJQUFJQyxJQUFJLElBQUlBLElBQUksQ0FBQ2hOLEdBQUcsQ0FBQyxFQUFFO0lBQ3JCLE9BQU9nTixJQUFJO0VBQ2I7RUFDQSxLQUFLLElBQUlFLE1BQU0sSUFBSUYsSUFBSSxFQUFFO0lBQ3ZCLE1BQU1ELE1BQU0sR0FBRy9HLGlCQUFpQixDQUFDZ0gsSUFBSSxDQUFDRSxNQUFNLENBQUMsRUFBRWxOLEdBQUcsQ0FBQztJQUNuRCxJQUFJK00sTUFBTSxFQUFFO01BQ1YsT0FBT0EsTUFBTTtJQUNmO0VBQ0Y7QUFDRjtBQUVBSSxNQUFNLENBQUNDLE9BQU8sR0FBR3BRLFNBQVM7QUFDMUI7QUFDQW1RLE1BQU0sQ0FBQ0MsT0FBTyxDQUFDNU8sZ0JBQWdCLEdBQUdBLGdCQUFnQiIsImlnbm9yZUxpc3QiOltdfQ==