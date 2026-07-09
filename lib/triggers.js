"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Types = void 0;
exports._unregisterAll = _unregisterAll;
exports.addConnectTrigger = addConnectTrigger;
exports.addFunction = addFunction;
exports.addJob = addJob;
exports.addLiveQueryEventHandler = addLiveQueryEventHandler;
exports.addTrigger = addTrigger;
exports.getClassName = getClassName;
exports.getFunction = getFunction;
exports.getFunctionNames = getFunctionNames;
exports.getJob = getJob;
exports.getJobs = getJobs;
exports.getRequestFileObject = getRequestFileObject;
exports.getRequestObject = getRequestObject;
exports.getRequestQueryObject = getRequestQueryObject;
exports.getResponseObject = getResponseObject;
exports.getTrigger = getTrigger;
exports.getValidator = getValidator;
exports.inflate = inflate;
exports.maybeRunAfterFindTrigger = maybeRunAfterFindTrigger;
exports.maybeRunFileTrigger = maybeRunFileTrigger;
exports.maybeRunGlobalConfigTrigger = maybeRunGlobalConfigTrigger;
exports.maybeRunQueryTrigger = maybeRunQueryTrigger;
exports.maybeRunTrigger = maybeRunTrigger;
exports.maybeRunValidator = maybeRunValidator;
exports.removeFunction = removeFunction;
exports.removeTrigger = removeTrigger;
exports.resolveError = resolveError;
exports.runLiveQueryEventHandlers = runLiveQueryEventHandlers;
exports.runTrigger = runTrigger;
exports.toJSONwithObjects = toJSONwithObjects;
exports.triggerExists = triggerExists;
var _node = _interopRequireDefault(require("parse/node"));
var _logger = require("./logger");
var _Utils = _interopRequireDefault(require("./Utils"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// triggers.js

const Types = exports.Types = {
  beforeLogin: 'beforeLogin',
  afterLogin: 'afterLogin',
  afterLogout: 'afterLogout',
  beforePasswordResetRequest: 'beforePasswordResetRequest',
  beforeSave: 'beforeSave',
  afterSave: 'afterSave',
  beforeDelete: 'beforeDelete',
  afterDelete: 'afterDelete',
  beforeFind: 'beforeFind',
  afterFind: 'afterFind',
  beforeConnect: 'beforeConnect',
  beforeSubscribe: 'beforeSubscribe',
  afterEvent: 'afterEvent'
};
const ConnectClassName = '@Connect';

/**
 * Creates a prototype-free object for use as a lookup store.
 * This prevents prototype chain properties (e.g. `constructor`, `toString`)
 * from being resolved as registered handlers when using bracket notation
 * for lookups. Always use this instead of `{}` for handler stores.
 */
function createStore() {
  return Object.create(null);
}
const baseStore = function () {
  const Validators = Object.keys(Types).reduce(function (base, key) {
    base[key] = createStore();
    return base;
  }, createStore());
  const Functions = createStore();
  const Jobs = createStore();
  const LiveQuery = [];
  const Triggers = Object.keys(Types).reduce(function (base, key) {
    base[key] = createStore();
    return base;
  }, createStore());
  return Object.freeze({
    Functions,
    Jobs,
    Validators,
    Triggers,
    LiveQuery
  });
};
function getClassName(parseClass) {
  if (parseClass && parseClass.className) {
    return parseClass.className;
  }
  if (parseClass && parseClass.name) {
    return parseClass.name.replace('Parse', '@');
  }
  return parseClass;
}
function validateClassNameForTriggers(className, type) {
  if (type == Types.beforeSave && className === '_PushStatus') {
    // _PushStatus uses undocumented nested key increment ops
    // allowing beforeSave would mess up the objects big time
    // TODO: Allow proper documented way of using nested increment ops
    throw 'Only afterSave is allowed on _PushStatus';
  }
  if ((type === Types.beforeLogin || type === Types.afterLogin || type === Types.beforePasswordResetRequest) && className !== '_User') {
    // TODO: check if upstream code will handle `Error` instance rather
    // than this anti-pattern of throwing strings
    throw 'Only the _User class is allowed for the beforeLogin, afterLogin, and beforePasswordResetRequest triggers';
  }
  if (type === Types.afterLogout && className !== '_Session') {
    // TODO: check if upstream code will handle `Error` instance rather
    // than this anti-pattern of throwing strings
    throw 'Only the _Session class is allowed for the afterLogout trigger.';
  }
  if (className === '_Session' && type !== Types.afterLogout) {
    // TODO: check if upstream code will handle `Error` instance rather
    // than this anti-pattern of throwing strings
    throw 'Only the afterLogout trigger is allowed for the _Session class.';
  }
  return className;
}
const _triggerStore = Object.create(null);
const Category = {
  Functions: 'Functions',
  Validators: 'Validators',
  Jobs: 'Jobs',
  Triggers: 'Triggers'
};
function getStore(category, name, applicationId) {
  const invalidNameRegex = /['"`]/;
  if (invalidNameRegex.test(name)) {
    // Prevent a malicious user from injecting properties into the store
    return createStore();
  }
  const path = name.split('.');
  path.splice(-1); // remove last component
  applicationId = applicationId || _node.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  let store = _triggerStore[applicationId][category];
  for (const component of path) {
    if (!Object.prototype.hasOwnProperty.call(store, component)) {
      return createStore();
    }
    store = store[component];
    if (!store || Object.getPrototypeOf(store) !== null) {
      return createStore();
    }
  }
  return store;
}
function add(category, name, handler, applicationId) {
  const lastComponent = name.split('.').splice(-1);
  const store = getStore(category, name, applicationId);
  if (store[lastComponent]) {
    _logger.logger.warn(`Warning: Duplicate cloud functions exist for ${lastComponent}. Only the last one will be used and the others will be ignored.`);
  }
  store[lastComponent] = handler;
}
function remove(category, name, applicationId) {
  const lastComponent = name.split('.').splice(-1);
  const store = getStore(category, name, applicationId);
  delete store[lastComponent];
}
function get(category, name, applicationId) {
  const lastComponent = name.split('.').splice(-1);
  const store = getStore(category, name, applicationId);
  if (!Object.prototype.hasOwnProperty.call(store, lastComponent)) {
    return undefined;
  }
  return store[lastComponent];
}
function addFunction(functionName, handler, validationHandler, applicationId) {
  add(Category.Functions, functionName, handler, applicationId);
  add(Category.Validators, functionName, validationHandler, applicationId);
}
function addJob(jobName, handler, applicationId) {
  add(Category.Jobs, jobName, handler, applicationId);
}
function addTrigger(type, className, handler, applicationId, validationHandler) {
  validateClassNameForTriggers(className, type);
  add(Category.Triggers, `${type}.${className}`, handler, applicationId);
  add(Category.Validators, `${type}.${className}`, validationHandler, applicationId);
}
function addConnectTrigger(type, handler, applicationId, validationHandler) {
  add(Category.Triggers, `${type}.${ConnectClassName}`, handler, applicationId);
  add(Category.Validators, `${type}.${ConnectClassName}`, validationHandler, applicationId);
}
function addLiveQueryEventHandler(handler, applicationId) {
  applicationId = applicationId || _node.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].LiveQuery.push(handler);
}
function removeFunction(functionName, applicationId) {
  remove(Category.Functions, functionName, applicationId);
}
function removeTrigger(type, className, applicationId) {
  remove(Category.Triggers, `${type}.${className}`, applicationId);
}
function _unregisterAll() {
  Object.keys(_triggerStore).forEach(appId => delete _triggerStore[appId]);
}
function toJSONwithObjects(object, className) {
  if (!object || !object.toJSON) {
    return {};
  }
  const toJSON = object.toJSON();
  const stateController = _node.default.CoreManager.getObjectStateController();
  const [pending] = stateController.getPendingOps(object._getStateIdentifier());
  for (const key in pending) {
    const val = object.get(key);
    if (!val || !val._toFullJSON) {
      toJSON[key] = val;
      continue;
    }
    toJSON[key] = val._toFullJSON();
  }
  // Preserve original object's className if no override className is provided
  if (className) {
    toJSON.className = className;
  } else if (object.className && !toJSON.className) {
    toJSON.className = object.className;
  }
  return toJSON;
}
function getTrigger(className, triggerType, applicationId) {
  if (!applicationId) {
    throw 'Missing ApplicationID';
  }
  return get(Category.Triggers, `${triggerType}.${className}`, applicationId);
}
async function runTrigger(trigger, name, request, auth) {
  if (!trigger) {
    return;
  }
  await maybeRunValidator(request, name, auth);
  if (request.skipWithMasterKey) {
    return;
  }
  return await trigger(request);
}
function triggerExists(className, type, applicationId) {
  return getTrigger(className, type, applicationId) != undefined;
}
function getFunction(functionName, applicationId) {
  return get(Category.Functions, functionName, applicationId);
}
function getFunctionNames(applicationId) {
  const store = _triggerStore[applicationId] && _triggerStore[applicationId][Category.Functions] || {};
  const functionNames = [];
  const extractFunctionNames = (namespace, store) => {
    Object.keys(store).forEach(name => {
      const value = store[name];
      if (namespace) {
        name = `${namespace}.${name}`;
      }
      if (typeof value === 'function') {
        functionNames.push(name);
      } else {
        extractFunctionNames(name, value);
      }
    });
  };
  extractFunctionNames(null, store);
  return functionNames;
}
function getJob(jobName, applicationId) {
  return get(Category.Jobs, jobName, applicationId);
}
function getJobs(applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Jobs) {
    return manager.Jobs;
  }
  return undefined;
}
function getValidator(functionName, applicationId) {
  return get(Category.Validators, functionName, applicationId);
}
function getRequestObject(triggerType, auth, parseObject, originalParseObject, config, context, isGet) {
  const request = {
    triggerName: triggerType,
    object: parseObject,
    master: false,
    isReadOnly: false,
    log: config.loggerController,
    headers: config.headers,
    ip: config.ip,
    config
  };
  if (isGet !== undefined) {
    request.isGet = !!isGet;
  }
  if (originalParseObject) {
    request.original = originalParseObject;
  }
  if (triggerType === Types.beforeSave || triggerType === Types.afterSave || triggerType === Types.beforeDelete || triggerType === Types.afterDelete || triggerType === Types.beforeLogin || triggerType === Types.afterLogin || triggerType === Types.beforePasswordResetRequest || triggerType === Types.afterFind) {
    // Set a copy of the context on the request object.
    request.context = Object.assign(Object.create(null), context);
  }
  if (!auth) {
    return request;
  }
  if (auth.isMaster) {
    request['master'] = true;
  }
  if (auth.isReadOnly) {
    request['isReadOnly'] = true;
  }
  if (auth.user) {
    request['user'] = auth.user;
  }
  if (auth.installationId) {
    request['installationId'] = auth.installationId;
  }
  return request;
}
function getRequestQueryObject(triggerType, auth, query, count, config, context, isGet) {
  isGet = !!isGet;
  var request = {
    triggerName: triggerType,
    query,
    master: false,
    isReadOnly: false,
    count,
    log: config.loggerController,
    isGet,
    headers: config.headers,
    ip: config.ip,
    context: context || {},
    config
  };
  if (!auth) {
    return request;
  }
  if (auth.isMaster) {
    request['master'] = true;
  }
  if (auth.isReadOnly) {
    request['isReadOnly'] = true;
  }
  if (auth.user) {
    request['user'] = auth.user;
  }
  if (auth.installationId) {
    request['installationId'] = auth.installationId;
  }
  return request;
}

// Creates the response object, and uses the request object to pass data
// The API will call this with REST API formatted objects, this will
// transform them to Parse.Object instances expected by Cloud Code.
// Any changes made to the object in a beforeSave will be included.
function getResponseObject(request, resolve, reject) {
  return {
    success: function (response) {
      if (request.triggerName === Types.afterFind) {
        if (!response) {
          response = request.objects;
        }
        response = response.map(object => {
          return toJSONwithObjects(object);
        });
        return resolve(response);
      }
      // Use the JSON response
      if (response && typeof response === 'object' && !request.object.equals(response) && request.triggerName === Types.beforeSave) {
        return resolve(response);
      }
      if (response && typeof response === 'object' && request.triggerName === Types.afterSave) {
        return resolve(response);
      }
      if (request.triggerName === Types.afterSave) {
        return resolve();
      }
      response = {};
      if (request.triggerName === Types.beforeSave) {
        response['object'] = request.object._getSaveJSON();
        response['object']['objectId'] = request.object.id;
      }
      return resolve(response);
    },
    error: function (error) {
      const e = resolveError(error, {
        code: _node.default.Error.SCRIPT_FAILED,
        message: 'Script failed. Unknown error.'
      });
      reject(e);
    }
  };
}
function userIdForLog(auth) {
  return auth && auth.user ? auth.user.id : undefined;
}
function logTriggerAfterHook(triggerType, className, input, auth, logLevel) {
  if (logLevel === 'silent') {
    return;
  }
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  _logger.logger[logLevel](`${triggerType} triggered for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}`, {
    className,
    triggerType,
    user: userIdForLog(auth)
  });
}
function logTriggerSuccessBeforeHook(triggerType, className, input, result, auth, logLevel) {
  if (logLevel === 'silent') {
    return;
  }
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  const cleanResult = _logger.logger.truncateLogMessage(JSON.stringify(result));
  _logger.logger[logLevel](`${triggerType} triggered for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}\n  Result: ${cleanResult}`, {
    className,
    triggerType,
    user: userIdForLog(auth)
  });
}
function logTriggerErrorBeforeHook(triggerType, className, input, auth, error, logLevel) {
  if (logLevel === 'silent') {
    return;
  }
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  _logger.logger[logLevel](`${triggerType} failed for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}\n  Error: ${JSON.stringify(error)}`, {
    className,
    triggerType,
    error,
    user: userIdForLog(auth)
  });
}
function maybeRunAfterFindTrigger(triggerType, auth, classNameQuery, objectsInput, config, query, context, isGet) {
  return new Promise((resolve, reject) => {
    const trigger = getTrigger(classNameQuery, triggerType, config.applicationId);
    if (!trigger) {
      if (objectsInput && objectsInput.length > 0 && objectsInput[0] instanceof _node.default.Object) {
        return resolve(objectsInput.map(obj => toJSONwithObjects(obj)));
      }
      return resolve(objectsInput || []);
    }
    const request = getRequestObject(triggerType, auth, null, null, config, context, isGet);
    // Convert query parameter to Parse.Query instance
    if (query instanceof _node.default.Query) {
      request.query = query;
    } else if (typeof query === 'object' && query !== null) {
      const parseQueryInstance = new _node.default.Query(classNameQuery);
      if (query.where) {
        parseQueryInstance.withJSON(query);
      }
      request.query = parseQueryInstance;
    } else {
      request.query = new _node.default.Query(classNameQuery);
    }
    const {
      success,
      error
    } = getResponseObject(request, processedObjectsJSON => {
      resolve(processedObjectsJSON);
    }, errorData => {
      reject(errorData);
    });
    logTriggerSuccessBeforeHook(triggerType, classNameQuery, 'AfterFind Input (Pre-Transform)', JSON.stringify(objectsInput.map(o => o instanceof _node.default.Object ? o.id + ':' + o.className : o)), auth, config.logLevels.triggerBeforeSuccess);

    // Convert plain objects to Parse.Object instances for trigger
    request.objects = objectsInput.map(currentObject => {
      if (currentObject instanceof _node.default.Object) {
        return currentObject;
      }
      // Preserve the original className if it exists, otherwise use the query className
      const originalClassName = currentObject.className || classNameQuery;
      const tempObjectWithClassName = {
        ...currentObject,
        className: originalClassName
      };
      return _node.default.Object.fromJSON(tempObjectWithClassName);
    });
    return Promise.resolve().then(() => {
      return maybeRunValidator(request, `${triggerType}.${classNameQuery}`, auth);
    }).then(() => {
      if (request.skipWithMasterKey) {
        return request.objects;
      }
      const responseFromTrigger = trigger(request);
      if (responseFromTrigger && typeof responseFromTrigger.then === 'function') {
        return responseFromTrigger.then(results => {
          return results;
        });
      }
      return responseFromTrigger;
    }).then(success, error);
  }).then(resultsAsJSON => {
    logTriggerAfterHook(triggerType, classNameQuery, JSON.stringify(resultsAsJSON), auth, config.logLevels.triggerAfter);
    return resultsAsJSON;
  });
}
function maybeRunQueryTrigger(triggerType, className, restWhere, restOptions, config, auth, context, isGet) {
  const trigger = getTrigger(className, triggerType, config.applicationId);
  if (!trigger) {
    return Promise.resolve({
      restWhere,
      restOptions
    });
  }
  const json = Object.assign({}, restOptions);
  json.where = restWhere;
  const parseQuery = new _node.default.Query(className);
  parseQuery.withJSON(json);
  let count = false;
  if (restOptions) {
    count = !!restOptions.count;
  }
  const requestObject = getRequestQueryObject(triggerType, auth, parseQuery, count, config, context, isGet);
  return Promise.resolve().then(() => {
    return maybeRunValidator(requestObject, `${triggerType}.${className}`, auth);
  }).then(() => {
    if (requestObject.skipWithMasterKey) {
      return requestObject.query;
    }
    return trigger(requestObject);
  }).then(result => {
    let queryResult = parseQuery;
    if (result && result instanceof _node.default.Query) {
      queryResult = result;
    }
    const jsonQuery = queryResult.toJSON();
    if (jsonQuery.where) {
      restWhere = jsonQuery.where;
    }
    if (jsonQuery.limit) {
      restOptions = restOptions || {};
      restOptions.limit = jsonQuery.limit;
    }
    if (jsonQuery.skip) {
      restOptions = restOptions || {};
      restOptions.skip = jsonQuery.skip;
    }
    if (jsonQuery.include) {
      restOptions = restOptions || {};
      restOptions.include = jsonQuery.include;
    }
    if (jsonQuery.excludeKeys) {
      restOptions = restOptions || {};
      restOptions.excludeKeys = jsonQuery.excludeKeys;
    }
    if (jsonQuery.explain) {
      restOptions = restOptions || {};
      restOptions.explain = jsonQuery.explain;
    }
    if (jsonQuery.keys) {
      restOptions = restOptions || {};
      restOptions.keys = jsonQuery.keys;
    }
    if (jsonQuery.order) {
      restOptions = restOptions || {};
      restOptions.order = jsonQuery.order;
    }
    if (jsonQuery.hint) {
      restOptions = restOptions || {};
      restOptions.hint = jsonQuery.hint;
    }
    if (jsonQuery.comment) {
      restOptions = restOptions || {};
      restOptions.comment = jsonQuery.comment;
    }
    if (requestObject.readPreference) {
      restOptions = restOptions || {};
      restOptions.readPreference = requestObject.readPreference;
    }
    if (requestObject.includeReadPreference) {
      restOptions = restOptions || {};
      restOptions.includeReadPreference = requestObject.includeReadPreference;
    }
    if (requestObject.subqueryReadPreference) {
      restOptions = restOptions || {};
      restOptions.subqueryReadPreference = requestObject.subqueryReadPreference;
    }
    let objects = undefined;
    if (result instanceof _node.default.Object) {
      objects = [result];
    } else if (Array.isArray(result) && (!result.length || result.every(obj => obj instanceof _node.default.Object))) {
      objects = result;
    }
    return {
      restWhere,
      restOptions,
      objects
    };
  }, err => {
    const error = resolveError(err, {
      code: _node.default.Error.SCRIPT_FAILED,
      message: 'Script failed. Unknown error.'
    });
    throw error;
  });
}
function resolveError(message, defaultOpts) {
  if (!defaultOpts) {
    defaultOpts = {};
  }
  if (!message) {
    return new _node.default.Error(defaultOpts.code || _node.default.Error.SCRIPT_FAILED, defaultOpts.message || 'Script failed.');
  }
  if (message instanceof _node.default.Error) {
    return message;
  }
  const code = defaultOpts.code || _node.default.Error.SCRIPT_FAILED;
  // If it's an error, mark it as a script failed
  if (typeof message === 'string') {
    return new _node.default.Error(code, message);
  }
  const error = new _node.default.Error(code, message.message || message);
  if (_Utils.default.isNativeError(message)) {
    error.stack = message.stack;
  }
  return error;
}
function maybeRunValidator(request, functionName, auth) {
  const theValidator = getValidator(functionName, _node.default.applicationId);
  if (!theValidator) {
    return;
  }
  if (typeof theValidator === 'object' && theValidator.skipWithMasterKey && request.master) {
    request.skipWithMasterKey = true;
  }
  return new Promise((resolve, reject) => {
    return Promise.resolve().then(() => {
      return typeof theValidator === 'object' ? builtInTriggerValidator(theValidator, request, auth) : theValidator(request);
    }).then(() => {
      resolve();
    }).catch(e => {
      const error = resolveError(e, {
        code: _node.default.Error.VALIDATION_ERROR,
        message: 'Validation failed.'
      });
      reject(error);
    });
  });
}
async function builtInTriggerValidator(options, request, auth) {
  if (request.master && !options.validateMasterKey) {
    return;
  }
  let reqUser = request.user;
  if (!reqUser && request.object && request.object.className === '_User' && !request.object.existed()) {
    reqUser = request.object;
  }
  if ((options.requireUser || options.requireAnyUserRoles || options.requireAllUserRoles) && !reqUser) {
    throw 'Validation failed. Please login to continue.';
  }
  if (options.requireMaster && !request.master) {
    throw 'Validation failed. Master key is required to complete this request.';
  }
  let params = request.params || {};
  if (request.object) {
    params = request.object.toJSON();
  }
  const requiredParam = key => {
    const value = params[key];
    if (value == null) {
      throw `Validation failed. Please specify data for ${key}.`;
    }
  };
  const validateOptions = async (opt, key, val) => {
    let opts = opt.options;
    if (typeof opts === 'function') {
      try {
        const result = await opts(val);
        if (!result && result != null) {
          throw opt.error || `Validation failed. Invalid value for ${key}.`;
        }
      } catch (e) {
        if (!e) {
          throw opt.error || `Validation failed. Invalid value for ${key}.`;
        }
        throw opt.error || e.message || e;
      }
      return;
    }
    if (!Array.isArray(opts)) {
      opts = [opt.options];
    }
    if (!opts.includes(val)) {
      throw opt.error || `Validation failed. Invalid option for ${key}. Expected: ${opts.join(', ')}`;
    }
  };
  const getType = fn => {
    const match = fn && fn.toString().match(/^\s*function (\w+)/);
    return (match ? match[1] : '').toLowerCase();
  };
  if (Array.isArray(options.fields)) {
    for (const key of options.fields) {
      requiredParam(key);
    }
  } else {
    const optionPromises = [];
    for (const key in options.fields) {
      const opt = options.fields[key];
      let val = params[key];
      if (typeof opt === 'string') {
        requiredParam(opt);
      }
      if (typeof opt === 'object') {
        if (opt.default != null && val == null) {
          val = opt.default;
          params[key] = val;
          if (request.object) {
            request.object.set(key, val);
          }
        }
        if (opt.constant && request.object) {
          if (request.original) {
            request.object.revert(key);
          } else if (opt.default != null) {
            request.object.set(key, opt.default);
          }
        }
        if (opt.required) {
          requiredParam(key);
        }
        const optional = !opt.required && val === undefined;
        if (!optional) {
          if (opt.type) {
            const type = getType(opt.type);
            const valType = Array.isArray(val) ? 'array' : typeof val;
            if (valType !== type) {
              throw `Validation failed. Invalid type for ${key}. Expected: ${type}`;
            }
          }
          if (opt.options) {
            optionPromises.push(validateOptions(opt, key, val));
          }
        }
      }
    }
    await Promise.all(optionPromises);
  }
  let userRoles = options.requireAnyUserRoles;
  let requireAllRoles = options.requireAllUserRoles;
  const promises = [Promise.resolve(), Promise.resolve(), Promise.resolve()];
  if (userRoles || requireAllRoles) {
    promises[0] = auth.getUserRoles();
  }
  if (typeof userRoles === 'function') {
    promises[1] = userRoles();
  }
  if (typeof requireAllRoles === 'function') {
    promises[2] = requireAllRoles();
  }
  const [roles, resolvedUserRoles, resolvedRequireAll] = await Promise.all(promises);
  if (resolvedUserRoles && Array.isArray(resolvedUserRoles)) {
    userRoles = resolvedUserRoles;
  }
  if (resolvedRequireAll && Array.isArray(resolvedRequireAll)) {
    requireAllRoles = resolvedRequireAll;
  }
  if (userRoles) {
    const hasRole = userRoles.some(requiredRole => roles.includes(`role:${requiredRole}`));
    if (!hasRole) {
      throw `Validation failed. User does not match the required roles.`;
    }
  }
  if (requireAllRoles) {
    for (const requiredRole of requireAllRoles) {
      if (!roles.includes(`role:${requiredRole}`)) {
        throw `Validation failed. User does not match all the required roles.`;
      }
    }
  }
  const userKeys = options.requireUserKeys || [];
  if (Array.isArray(userKeys)) {
    for (const key of userKeys) {
      if (!reqUser) {
        throw 'Please login to make this request.';
      }
      if (reqUser.get(key) == null) {
        throw `Validation failed. Please set data for ${key} on your account.`;
      }
    }
  } else if (typeof userKeys === 'object') {
    const optionPromises = [];
    for (const key in options.requireUserKeys) {
      const opt = options.requireUserKeys[key];
      if (opt.options) {
        optionPromises.push(validateOptions(opt, key, reqUser.get(key)));
      }
    }
    await Promise.all(optionPromises);
  }
}

// To be used as part of the promise chain when saving/deleting an object
// Will resolve successfully if no trigger is configured
// Resolves to an object, empty or containing an object key. A beforeSave
// trigger will set the object key to the rest format object to save.
// originalParseObject is optional, we only need that for before/afterSave functions
function maybeRunTrigger(triggerType, auth, parseObject, originalParseObject, config, context) {
  if (!parseObject) {
    return Promise.resolve({});
  }
  return new Promise(function (resolve, reject) {
    var trigger = getTrigger(parseObject.className, triggerType, config.applicationId);
    if (!trigger) {
      return resolve();
    }
    var request = getRequestObject(triggerType, auth, parseObject, originalParseObject, config, context);
    var {
      success,
      error
    } = getResponseObject(request, object => {
      logTriggerSuccessBeforeHook(triggerType, parseObject.className, parseObject.toJSON(), object, auth, triggerType.startsWith('after') ? config.logLevels.triggerAfter : config.logLevels.triggerBeforeSuccess);
      if (triggerType === Types.beforeSave || triggerType === Types.afterSave || triggerType === Types.beforeDelete || triggerType === Types.afterDelete) {
        Object.assign(context, request.context);
      }
      resolve(object);
    }, error => {
      logTriggerErrorBeforeHook(triggerType, parseObject.className, parseObject.toJSON(), auth, error, config.logLevels.triggerBeforeError);
      reject(error);
    });

    // AfterSave and afterDelete triggers can return a promise, which if they
    // do, needs to be resolved before this promise is resolved,
    // so trigger execution is synced with RestWrite.execute() call.
    // If triggers do not return a promise, they can run async code parallel
    // to the RestWrite.execute() call.
    return Promise.resolve().then(() => {
      return maybeRunValidator(request, `${triggerType}.${parseObject.className}`, auth);
    }).then(() => {
      if (request.skipWithMasterKey) {
        return Promise.resolve();
      }
      const promise = trigger(request);
      if (triggerType === Types.afterSave || triggerType === Types.afterDelete || triggerType === Types.afterLogin) {
        logTriggerAfterHook(triggerType, parseObject.className, parseObject.toJSON(), auth, config.logLevels.triggerAfter);
      }
      // beforeSave is expected to return null (nothing)
      if (triggerType === Types.beforeSave) {
        if (promise && typeof promise.then === 'function') {
          return promise.then(response => {
            // response.object may come from express routing before hook
            if (response && response.object) {
              return response;
            }
            return null;
          });
        }
        return null;
      }
      return promise;
    }).then(success, error);
  });
}

// Converts a REST-format object to a Parse.Object
// data is either className or an object
function inflate(data, restObject) {
  var copy = typeof data == 'object' ? data : {
    className: data
  };
  for (var key in restObject) {
    copy[key] = restObject[key];
  }
  return _node.default.Object.fromJSON(copy);
}
function runLiveQueryEventHandlers(data, applicationId = _node.default.applicationId) {
  if (!_triggerStore || !_triggerStore[applicationId] || !_triggerStore[applicationId].LiveQuery) {
    return;
  }
  _triggerStore[applicationId].LiveQuery.forEach(handler => handler(data));
}
function getRequestFileObject(triggerType, auth, fileObject, config) {
  const request = {
    ...fileObject,
    triggerName: triggerType,
    master: false,
    isReadOnly: false,
    log: config.loggerController,
    headers: config.headers,
    ip: config.ip,
    config
  };
  if (!auth) {
    return request;
  }
  if (auth.isMaster) {
    request['master'] = true;
  }
  if (auth.isReadOnly) {
    request['isReadOnly'] = true;
  }
  if (auth.user) {
    request['user'] = auth.user;
  }
  if (auth.installationId) {
    request['installationId'] = auth.installationId;
  }
  return request;
}
async function maybeRunFileTrigger(triggerType, fileObject, config, auth) {
  const FileClassName = getClassName(_node.default.File);
  const fileTrigger = getTrigger(FileClassName, triggerType, config.applicationId);
  if (typeof fileTrigger === 'function') {
    try {
      const request = getRequestFileObject(triggerType, auth, fileObject, config);
      await maybeRunValidator(request, `${triggerType}.${FileClassName}`, auth);
      if (request.skipWithMasterKey) {
        return fileObject;
      }
      const result = await fileTrigger(request);
      if (request.forceDownload) {
        fileObject.forceDownload = true;
      }
      if (request.responseHeaders) {
        fileObject.responseHeaders = request.responseHeaders;
      }
      logTriggerSuccessBeforeHook(triggerType, 'Parse.File', {
        ...fileObject.file.toJSON(),
        fileSize: fileObject.fileSize
      }, result, auth, config.logLevels.triggerBeforeSuccess);
      return result || fileObject;
    } catch (error) {
      logTriggerErrorBeforeHook(triggerType, 'Parse.File', {
        ...fileObject.file.toJSON(),
        fileSize: fileObject.fileSize
      }, auth, error, config.logLevels.triggerBeforeError);
      throw error;
    }
  }
  return fileObject;
}
async function maybeRunGlobalConfigTrigger(triggerType, auth, configObject, originalConfigObject, config, context) {
  const GlobalConfigClassName = getClassName(_node.default.Config);
  const configTrigger = getTrigger(GlobalConfigClassName, triggerType, config.applicationId);
  if (typeof configTrigger === 'function') {
    try {
      const request = getRequestObject(triggerType, auth, configObject, originalConfigObject, config, context);
      await maybeRunValidator(request, `${triggerType}.${GlobalConfigClassName}`, auth);
      if (request.skipWithMasterKey) {
        return configObject;
      }
      const result = await configTrigger(request);
      logTriggerSuccessBeforeHook(triggerType, 'Parse.Config', configObject, result, auth, config.logLevels.triggerBeforeSuccess);
      return result || configObject;
    } catch (error) {
      logTriggerErrorBeforeHook(triggerType, 'Parse.Config', configObject, auth, error, config.logLevels.triggerBeforeError);
      throw error;
    }
  }
  return configObject;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbm9kZSIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiX2xvZ2dlciIsIl9VdGlscyIsImUiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsIlR5cGVzIiwiZXhwb3J0cyIsImJlZm9yZUxvZ2luIiwiYWZ0ZXJMb2dpbiIsImFmdGVyTG9nb3V0IiwiYmVmb3JlUGFzc3dvcmRSZXNldFJlcXVlc3QiLCJiZWZvcmVTYXZlIiwiYWZ0ZXJTYXZlIiwiYmVmb3JlRGVsZXRlIiwiYWZ0ZXJEZWxldGUiLCJiZWZvcmVGaW5kIiwiYWZ0ZXJGaW5kIiwiYmVmb3JlQ29ubmVjdCIsImJlZm9yZVN1YnNjcmliZSIsImFmdGVyRXZlbnQiLCJDb25uZWN0Q2xhc3NOYW1lIiwiY3JlYXRlU3RvcmUiLCJPYmplY3QiLCJjcmVhdGUiLCJiYXNlU3RvcmUiLCJWYWxpZGF0b3JzIiwia2V5cyIsInJlZHVjZSIsImJhc2UiLCJrZXkiLCJGdW5jdGlvbnMiLCJKb2JzIiwiTGl2ZVF1ZXJ5IiwiVHJpZ2dlcnMiLCJmcmVlemUiLCJnZXRDbGFzc05hbWUiLCJwYXJzZUNsYXNzIiwiY2xhc3NOYW1lIiwibmFtZSIsInJlcGxhY2UiLCJ2YWxpZGF0ZUNsYXNzTmFtZUZvclRyaWdnZXJzIiwidHlwZSIsIl90cmlnZ2VyU3RvcmUiLCJDYXRlZ29yeSIsImdldFN0b3JlIiwiY2F0ZWdvcnkiLCJhcHBsaWNhdGlvbklkIiwiaW52YWxpZE5hbWVSZWdleCIsInRlc3QiLCJwYXRoIiwic3BsaXQiLCJzcGxpY2UiLCJQYXJzZSIsInN0b3JlIiwiY29tcG9uZW50IiwicHJvdG90eXBlIiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwiZ2V0UHJvdG90eXBlT2YiLCJhZGQiLCJoYW5kbGVyIiwibGFzdENvbXBvbmVudCIsImxvZ2dlciIsIndhcm4iLCJyZW1vdmUiLCJnZXQiLCJ1bmRlZmluZWQiLCJhZGRGdW5jdGlvbiIsImZ1bmN0aW9uTmFtZSIsInZhbGlkYXRpb25IYW5kbGVyIiwiYWRkSm9iIiwiam9iTmFtZSIsImFkZFRyaWdnZXIiLCJhZGRDb25uZWN0VHJpZ2dlciIsImFkZExpdmVRdWVyeUV2ZW50SGFuZGxlciIsInB1c2giLCJyZW1vdmVGdW5jdGlvbiIsInJlbW92ZVRyaWdnZXIiLCJfdW5yZWdpc3RlckFsbCIsImZvckVhY2giLCJhcHBJZCIsInRvSlNPTndpdGhPYmplY3RzIiwib2JqZWN0IiwidG9KU09OIiwic3RhdGVDb250cm9sbGVyIiwiQ29yZU1hbmFnZXIiLCJnZXRPYmplY3RTdGF0ZUNvbnRyb2xsZXIiLCJwZW5kaW5nIiwiZ2V0UGVuZGluZ09wcyIsIl9nZXRTdGF0ZUlkZW50aWZpZXIiLCJ2YWwiLCJfdG9GdWxsSlNPTiIsImdldFRyaWdnZXIiLCJ0cmlnZ2VyVHlwZSIsInJ1blRyaWdnZXIiLCJ0cmlnZ2VyIiwicmVxdWVzdCIsImF1dGgiLCJtYXliZVJ1blZhbGlkYXRvciIsInNraXBXaXRoTWFzdGVyS2V5IiwidHJpZ2dlckV4aXN0cyIsImdldEZ1bmN0aW9uIiwiZ2V0RnVuY3Rpb25OYW1lcyIsImZ1bmN0aW9uTmFtZXMiLCJleHRyYWN0RnVuY3Rpb25OYW1lcyIsIm5hbWVzcGFjZSIsInZhbHVlIiwiZ2V0Sm9iIiwiZ2V0Sm9icyIsIm1hbmFnZXIiLCJnZXRWYWxpZGF0b3IiLCJnZXRSZXF1ZXN0T2JqZWN0IiwicGFyc2VPYmplY3QiLCJvcmlnaW5hbFBhcnNlT2JqZWN0IiwiY29uZmlnIiwiY29udGV4dCIsImlzR2V0IiwidHJpZ2dlck5hbWUiLCJtYXN0ZXIiLCJpc1JlYWRPbmx5IiwibG9nIiwibG9nZ2VyQ29udHJvbGxlciIsImhlYWRlcnMiLCJpcCIsIm9yaWdpbmFsIiwiYXNzaWduIiwiaXNNYXN0ZXIiLCJ1c2VyIiwiaW5zdGFsbGF0aW9uSWQiLCJnZXRSZXF1ZXN0UXVlcnlPYmplY3QiLCJxdWVyeSIsImNvdW50IiwiZ2V0UmVzcG9uc2VPYmplY3QiLCJyZXNvbHZlIiwicmVqZWN0Iiwic3VjY2VzcyIsInJlc3BvbnNlIiwib2JqZWN0cyIsIm1hcCIsImVxdWFscyIsIl9nZXRTYXZlSlNPTiIsImlkIiwiZXJyb3IiLCJyZXNvbHZlRXJyb3IiLCJjb2RlIiwiRXJyb3IiLCJTQ1JJUFRfRkFJTEVEIiwibWVzc2FnZSIsInVzZXJJZEZvckxvZyIsImxvZ1RyaWdnZXJBZnRlckhvb2siLCJpbnB1dCIsImxvZ0xldmVsIiwiY2xlYW5JbnB1dCIsInRydW5jYXRlTG9nTWVzc2FnZSIsIkpTT04iLCJzdHJpbmdpZnkiLCJsb2dUcmlnZ2VyU3VjY2Vzc0JlZm9yZUhvb2siLCJyZXN1bHQiLCJjbGVhblJlc3VsdCIsImxvZ1RyaWdnZXJFcnJvckJlZm9yZUhvb2siLCJtYXliZVJ1bkFmdGVyRmluZFRyaWdnZXIiLCJjbGFzc05hbWVRdWVyeSIsIm9iamVjdHNJbnB1dCIsIlByb21pc2UiLCJsZW5ndGgiLCJvYmoiLCJRdWVyeSIsInBhcnNlUXVlcnlJbnN0YW5jZSIsIndoZXJlIiwid2l0aEpTT04iLCJwcm9jZXNzZWRPYmplY3RzSlNPTiIsImVycm9yRGF0YSIsIm8iLCJsb2dMZXZlbHMiLCJ0cmlnZ2VyQmVmb3JlU3VjY2VzcyIsImN1cnJlbnRPYmplY3QiLCJvcmlnaW5hbENsYXNzTmFtZSIsInRlbXBPYmplY3RXaXRoQ2xhc3NOYW1lIiwiZnJvbUpTT04iLCJ0aGVuIiwicmVzcG9uc2VGcm9tVHJpZ2dlciIsInJlc3VsdHMiLCJyZXN1bHRzQXNKU09OIiwidHJpZ2dlckFmdGVyIiwibWF5YmVSdW5RdWVyeVRyaWdnZXIiLCJyZXN0V2hlcmUiLCJyZXN0T3B0aW9ucyIsImpzb24iLCJwYXJzZVF1ZXJ5IiwicmVxdWVzdE9iamVjdCIsInF1ZXJ5UmVzdWx0IiwianNvblF1ZXJ5IiwibGltaXQiLCJza2lwIiwiaW5jbHVkZSIsImV4Y2x1ZGVLZXlzIiwiZXhwbGFpbiIsIm9yZGVyIiwiaGludCIsImNvbW1lbnQiLCJyZWFkUHJlZmVyZW5jZSIsImluY2x1ZGVSZWFkUHJlZmVyZW5jZSIsInN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UiLCJBcnJheSIsImlzQXJyYXkiLCJldmVyeSIsImVyciIsImRlZmF1bHRPcHRzIiwiVXRpbHMiLCJpc05hdGl2ZUVycm9yIiwic3RhY2siLCJ0aGVWYWxpZGF0b3IiLCJidWlsdEluVHJpZ2dlclZhbGlkYXRvciIsImNhdGNoIiwiVkFMSURBVElPTl9FUlJPUiIsIm9wdGlvbnMiLCJ2YWxpZGF0ZU1hc3RlcktleSIsInJlcVVzZXIiLCJleGlzdGVkIiwicmVxdWlyZVVzZXIiLCJyZXF1aXJlQW55VXNlclJvbGVzIiwicmVxdWlyZUFsbFVzZXJSb2xlcyIsInJlcXVpcmVNYXN0ZXIiLCJwYXJhbXMiLCJyZXF1aXJlZFBhcmFtIiwidmFsaWRhdGVPcHRpb25zIiwib3B0Iiwib3B0cyIsImluY2x1ZGVzIiwiam9pbiIsImdldFR5cGUiLCJmbiIsIm1hdGNoIiwidG9TdHJpbmciLCJ0b0xvd2VyQ2FzZSIsImZpZWxkcyIsIm9wdGlvblByb21pc2VzIiwic2V0IiwiY29uc3RhbnQiLCJyZXZlcnQiLCJyZXF1aXJlZCIsIm9wdGlvbmFsIiwidmFsVHlwZSIsImFsbCIsInVzZXJSb2xlcyIsInJlcXVpcmVBbGxSb2xlcyIsInByb21pc2VzIiwiZ2V0VXNlclJvbGVzIiwicm9sZXMiLCJyZXNvbHZlZFVzZXJSb2xlcyIsInJlc29sdmVkUmVxdWlyZUFsbCIsImhhc1JvbGUiLCJzb21lIiwicmVxdWlyZWRSb2xlIiwidXNlcktleXMiLCJyZXF1aXJlVXNlcktleXMiLCJtYXliZVJ1blRyaWdnZXIiLCJzdGFydHNXaXRoIiwidHJpZ2dlckJlZm9yZUVycm9yIiwicHJvbWlzZSIsImluZmxhdGUiLCJkYXRhIiwicmVzdE9iamVjdCIsImNvcHkiLCJydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzIiwiZ2V0UmVxdWVzdEZpbGVPYmplY3QiLCJmaWxlT2JqZWN0IiwibWF5YmVSdW5GaWxlVHJpZ2dlciIsIkZpbGVDbGFzc05hbWUiLCJGaWxlIiwiZmlsZVRyaWdnZXIiLCJmb3JjZURvd25sb2FkIiwicmVzcG9uc2VIZWFkZXJzIiwiZmlsZSIsImZpbGVTaXplIiwibWF5YmVSdW5HbG9iYWxDb25maWdUcmlnZ2VyIiwiY29uZmlnT2JqZWN0Iiwib3JpZ2luYWxDb25maWdPYmplY3QiLCJHbG9iYWxDb25maWdDbGFzc05hbWUiLCJDb25maWciLCJjb25maWdUcmlnZ2VyIl0sInNvdXJjZXMiOlsiLi4vc3JjL3RyaWdnZXJzLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIHRyaWdnZXJzLmpzXG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQgVXRpbHMgZnJvbSAnLi9VdGlscyc7XG5cbmV4cG9ydCBjb25zdCBUeXBlcyA9IHtcbiAgYmVmb3JlTG9naW46ICdiZWZvcmVMb2dpbicsXG4gIGFmdGVyTG9naW46ICdhZnRlckxvZ2luJyxcbiAgYWZ0ZXJMb2dvdXQ6ICdhZnRlckxvZ291dCcsXG4gIGJlZm9yZVBhc3N3b3JkUmVzZXRSZXF1ZXN0OiAnYmVmb3JlUGFzc3dvcmRSZXNldFJlcXVlc3QnLFxuICBiZWZvcmVTYXZlOiAnYmVmb3JlU2F2ZScsXG4gIGFmdGVyU2F2ZTogJ2FmdGVyU2F2ZScsXG4gIGJlZm9yZURlbGV0ZTogJ2JlZm9yZURlbGV0ZScsXG4gIGFmdGVyRGVsZXRlOiAnYWZ0ZXJEZWxldGUnLFxuICBiZWZvcmVGaW5kOiAnYmVmb3JlRmluZCcsXG4gIGFmdGVyRmluZDogJ2FmdGVyRmluZCcsXG4gIGJlZm9yZUNvbm5lY3Q6ICdiZWZvcmVDb25uZWN0JyxcbiAgYmVmb3JlU3Vic2NyaWJlOiAnYmVmb3JlU3Vic2NyaWJlJyxcbiAgYWZ0ZXJFdmVudDogJ2FmdGVyRXZlbnQnLFxufTtcblxuY29uc3QgQ29ubmVjdENsYXNzTmFtZSA9ICdAQ29ubmVjdCc7XG5cbi8qKlxuICogQ3JlYXRlcyBhIHByb3RvdHlwZS1mcmVlIG9iamVjdCBmb3IgdXNlIGFzIGEgbG9va3VwIHN0b3JlLlxuICogVGhpcyBwcmV2ZW50cyBwcm90b3R5cGUgY2hhaW4gcHJvcGVydGllcyAoZS5nLiBgY29uc3RydWN0b3JgLCBgdG9TdHJpbmdgKVxuICogZnJvbSBiZWluZyByZXNvbHZlZCBhcyByZWdpc3RlcmVkIGhhbmRsZXJzIHdoZW4gdXNpbmcgYnJhY2tldCBub3RhdGlvblxuICogZm9yIGxvb2t1cHMuIEFsd2F5cyB1c2UgdGhpcyBpbnN0ZWFkIG9mIGB7fWAgZm9yIGhhbmRsZXIgc3RvcmVzLlxuICovXG5mdW5jdGlvbiBjcmVhdGVTdG9yZSgpIHtcbiAgcmV0dXJuIE9iamVjdC5jcmVhdGUobnVsbCk7XG59XG5cbmNvbnN0IGJhc2VTdG9yZSA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgVmFsaWRhdG9ycyA9IE9iamVjdC5rZXlzKFR5cGVzKS5yZWR1Y2UoZnVuY3Rpb24gKGJhc2UsIGtleSkge1xuICAgIGJhc2Vba2V5XSA9IGNyZWF0ZVN0b3JlKCk7XG4gICAgcmV0dXJuIGJhc2U7XG4gIH0sIGNyZWF0ZVN0b3JlKCkpO1xuICBjb25zdCBGdW5jdGlvbnMgPSBjcmVhdGVTdG9yZSgpO1xuICBjb25zdCBKb2JzID0gY3JlYXRlU3RvcmUoKTtcbiAgY29uc3QgTGl2ZVF1ZXJ5ID0gW107XG4gIGNvbnN0IFRyaWdnZXJzID0gT2JqZWN0LmtleXMoVHlwZXMpLnJlZHVjZShmdW5jdGlvbiAoYmFzZSwga2V5KSB7XG4gICAgYmFzZVtrZXldID0gY3JlYXRlU3RvcmUoKTtcbiAgICByZXR1cm4gYmFzZTtcbiAgfSwgY3JlYXRlU3RvcmUoKSk7XG5cbiAgcmV0dXJuIE9iamVjdC5mcmVlemUoe1xuICAgIEZ1bmN0aW9ucyxcbiAgICBKb2JzLFxuICAgIFZhbGlkYXRvcnMsXG4gICAgVHJpZ2dlcnMsXG4gICAgTGl2ZVF1ZXJ5LFxuICB9KTtcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRDbGFzc05hbWUocGFyc2VDbGFzcykge1xuICBpZiAocGFyc2VDbGFzcyAmJiBwYXJzZUNsYXNzLmNsYXNzTmFtZSkge1xuICAgIHJldHVybiBwYXJzZUNsYXNzLmNsYXNzTmFtZTtcbiAgfVxuICBpZiAocGFyc2VDbGFzcyAmJiBwYXJzZUNsYXNzLm5hbWUpIHtcbiAgICByZXR1cm4gcGFyc2VDbGFzcy5uYW1lLnJlcGxhY2UoJ1BhcnNlJywgJ0AnKTtcbiAgfVxuICByZXR1cm4gcGFyc2VDbGFzcztcbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVDbGFzc05hbWVGb3JUcmlnZ2VycyhjbGFzc05hbWUsIHR5cGUpIHtcbiAgaWYgKHR5cGUgPT0gVHlwZXMuYmVmb3JlU2F2ZSAmJiBjbGFzc05hbWUgPT09ICdfUHVzaFN0YXR1cycpIHtcbiAgICAvLyBfUHVzaFN0YXR1cyB1c2VzIHVuZG9jdW1lbnRlZCBuZXN0ZWQga2V5IGluY3JlbWVudCBvcHNcbiAgICAvLyBhbGxvd2luZyBiZWZvcmVTYXZlIHdvdWxkIG1lc3MgdXAgdGhlIG9iamVjdHMgYmlnIHRpbWVcbiAgICAvLyBUT0RPOiBBbGxvdyBwcm9wZXIgZG9jdW1lbnRlZCB3YXkgb2YgdXNpbmcgbmVzdGVkIGluY3JlbWVudCBvcHNcbiAgICB0aHJvdyAnT25seSBhZnRlclNhdmUgaXMgYWxsb3dlZCBvbiBfUHVzaFN0YXR1cyc7XG4gIH1cbiAgaWYgKCh0eXBlID09PSBUeXBlcy5iZWZvcmVMb2dpbiB8fCB0eXBlID09PSBUeXBlcy5hZnRlckxvZ2luIHx8IHR5cGUgPT09IFR5cGVzLmJlZm9yZVBhc3N3b3JkUmVzZXRSZXF1ZXN0KSAmJiBjbGFzc05hbWUgIT09ICdfVXNlcicpIHtcbiAgICAvLyBUT0RPOiBjaGVjayBpZiB1cHN0cmVhbSBjb2RlIHdpbGwgaGFuZGxlIGBFcnJvcmAgaW5zdGFuY2UgcmF0aGVyXG4gICAgLy8gdGhhbiB0aGlzIGFudGktcGF0dGVybiBvZiB0aHJvd2luZyBzdHJpbmdzXG4gICAgdGhyb3cgJ09ubHkgdGhlIF9Vc2VyIGNsYXNzIGlzIGFsbG93ZWQgZm9yIHRoZSBiZWZvcmVMb2dpbiwgYWZ0ZXJMb2dpbiwgYW5kIGJlZm9yZVBhc3N3b3JkUmVzZXRSZXF1ZXN0IHRyaWdnZXJzJztcbiAgfVxuICBpZiAodHlwZSA9PT0gVHlwZXMuYWZ0ZXJMb2dvdXQgJiYgY2xhc3NOYW1lICE9PSAnX1Nlc3Npb24nKSB7XG4gICAgLy8gVE9ETzogY2hlY2sgaWYgdXBzdHJlYW0gY29kZSB3aWxsIGhhbmRsZSBgRXJyb3JgIGluc3RhbmNlIHJhdGhlclxuICAgIC8vIHRoYW4gdGhpcyBhbnRpLXBhdHRlcm4gb2YgdGhyb3dpbmcgc3RyaW5nc1xuICAgIHRocm93ICdPbmx5IHRoZSBfU2Vzc2lvbiBjbGFzcyBpcyBhbGxvd2VkIGZvciB0aGUgYWZ0ZXJMb2dvdXQgdHJpZ2dlci4nO1xuICB9XG4gIGlmIChjbGFzc05hbWUgPT09ICdfU2Vzc2lvbicgJiYgdHlwZSAhPT0gVHlwZXMuYWZ0ZXJMb2dvdXQpIHtcbiAgICAvLyBUT0RPOiBjaGVjayBpZiB1cHN0cmVhbSBjb2RlIHdpbGwgaGFuZGxlIGBFcnJvcmAgaW5zdGFuY2UgcmF0aGVyXG4gICAgLy8gdGhhbiB0aGlzIGFudGktcGF0dGVybiBvZiB0aHJvd2luZyBzdHJpbmdzXG4gICAgdGhyb3cgJ09ubHkgdGhlIGFmdGVyTG9nb3V0IHRyaWdnZXIgaXMgYWxsb3dlZCBmb3IgdGhlIF9TZXNzaW9uIGNsYXNzLic7XG4gIH1cbiAgcmV0dXJuIGNsYXNzTmFtZTtcbn1cblxuY29uc3QgX3RyaWdnZXJTdG9yZSA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG5cbmNvbnN0IENhdGVnb3J5ID0ge1xuICBGdW5jdGlvbnM6ICdGdW5jdGlvbnMnLFxuICBWYWxpZGF0b3JzOiAnVmFsaWRhdG9ycycsXG4gIEpvYnM6ICdKb2JzJyxcbiAgVHJpZ2dlcnM6ICdUcmlnZ2VycycsXG59O1xuXG5mdW5jdGlvbiBnZXRTdG9yZShjYXRlZ29yeSwgbmFtZSwgYXBwbGljYXRpb25JZCkge1xuICBjb25zdCBpbnZhbGlkTmFtZVJlZ2V4ID0gL1snXCJgXS87XG4gIGlmIChpbnZhbGlkTmFtZVJlZ2V4LnRlc3QobmFtZSkpIHtcbiAgICAvLyBQcmV2ZW50IGEgbWFsaWNpb3VzIHVzZXIgZnJvbSBpbmplY3RpbmcgcHJvcGVydGllcyBpbnRvIHRoZSBzdG9yZVxuICAgIHJldHVybiBjcmVhdGVTdG9yZSgpO1xuICB9XG5cbiAgY29uc3QgcGF0aCA9IG5hbWUuc3BsaXQoJy4nKTtcbiAgcGF0aC5zcGxpY2UoLTEpOyAvLyByZW1vdmUgbGFzdCBjb21wb25lbnRcbiAgYXBwbGljYXRpb25JZCA9IGFwcGxpY2F0aW9uSWQgfHwgUGFyc2UuYXBwbGljYXRpb25JZDtcbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSA9IF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gfHwgYmFzZVN0b3JlKCk7XG4gIGxldCBzdG9yZSA9IF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF1bY2F0ZWdvcnldO1xuICBmb3IgKGNvbnN0IGNvbXBvbmVudCBvZiBwYXRoKSB7XG4gICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoc3RvcmUsIGNvbXBvbmVudCkpIHtcbiAgICAgIHJldHVybiBjcmVhdGVTdG9yZSgpO1xuICAgIH1cbiAgICBzdG9yZSA9IHN0b3JlW2NvbXBvbmVudF07XG4gICAgaWYgKCFzdG9yZSB8fCBPYmplY3QuZ2V0UHJvdG90eXBlT2Yoc3RvcmUpICE9PSBudWxsKSB7XG4gICAgICByZXR1cm4gY3JlYXRlU3RvcmUoKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN0b3JlO1xufVxuXG5mdW5jdGlvbiBhZGQoY2F0ZWdvcnksIG5hbWUsIGhhbmRsZXIsIGFwcGxpY2F0aW9uSWQpIHtcbiAgY29uc3QgbGFzdENvbXBvbmVudCA9IG5hbWUuc3BsaXQoJy4nKS5zcGxpY2UoLTEpO1xuICBjb25zdCBzdG9yZSA9IGdldFN0b3JlKGNhdGVnb3J5LCBuYW1lLCBhcHBsaWNhdGlvbklkKTtcbiAgaWYgKHN0b3JlW2xhc3RDb21wb25lbnRdKSB7XG4gICAgbG9nZ2VyLndhcm4oXG4gICAgICBgV2FybmluZzogRHVwbGljYXRlIGNsb3VkIGZ1bmN0aW9ucyBleGlzdCBmb3IgJHtsYXN0Q29tcG9uZW50fS4gT25seSB0aGUgbGFzdCBvbmUgd2lsbCBiZSB1c2VkIGFuZCB0aGUgb3RoZXJzIHdpbGwgYmUgaWdub3JlZC5gXG4gICAgKTtcbiAgfVxuICBzdG9yZVtsYXN0Q29tcG9uZW50XSA9IGhhbmRsZXI7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZShjYXRlZ29yeSwgbmFtZSwgYXBwbGljYXRpb25JZCkge1xuICBjb25zdCBsYXN0Q29tcG9uZW50ID0gbmFtZS5zcGxpdCgnLicpLnNwbGljZSgtMSk7XG4gIGNvbnN0IHN0b3JlID0gZ2V0U3RvcmUoY2F0ZWdvcnksIG5hbWUsIGFwcGxpY2F0aW9uSWQpO1xuICBkZWxldGUgc3RvcmVbbGFzdENvbXBvbmVudF07XG59XG5cbmZ1bmN0aW9uIGdldChjYXRlZ29yeSwgbmFtZSwgYXBwbGljYXRpb25JZCkge1xuICBjb25zdCBsYXN0Q29tcG9uZW50ID0gbmFtZS5zcGxpdCgnLicpLnNwbGljZSgtMSk7XG4gIGNvbnN0IHN0b3JlID0gZ2V0U3RvcmUoY2F0ZWdvcnksIG5hbWUsIGFwcGxpY2F0aW9uSWQpO1xuICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChzdG9yZSwgbGFzdENvbXBvbmVudCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBzdG9yZVtsYXN0Q29tcG9uZW50XTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZEZ1bmN0aW9uKGZ1bmN0aW9uTmFtZSwgaGFuZGxlciwgdmFsaWRhdGlvbkhhbmRsZXIsIGFwcGxpY2F0aW9uSWQpIHtcbiAgYWRkKENhdGVnb3J5LkZ1bmN0aW9ucywgZnVuY3Rpb25OYW1lLCBoYW5kbGVyLCBhcHBsaWNhdGlvbklkKTtcbiAgYWRkKENhdGVnb3J5LlZhbGlkYXRvcnMsIGZ1bmN0aW9uTmFtZSwgdmFsaWRhdGlvbkhhbmRsZXIsIGFwcGxpY2F0aW9uSWQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkSm9iKGpvYk5hbWUsIGhhbmRsZXIsIGFwcGxpY2F0aW9uSWQpIHtcbiAgYWRkKENhdGVnb3J5LkpvYnMsIGpvYk5hbWUsIGhhbmRsZXIsIGFwcGxpY2F0aW9uSWQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkVHJpZ2dlcih0eXBlLCBjbGFzc05hbWUsIGhhbmRsZXIsIGFwcGxpY2F0aW9uSWQsIHZhbGlkYXRpb25IYW5kbGVyKSB7XG4gIHZhbGlkYXRlQ2xhc3NOYW1lRm9yVHJpZ2dlcnMoY2xhc3NOYW1lLCB0eXBlKTtcbiAgYWRkKENhdGVnb3J5LlRyaWdnZXJzLCBgJHt0eXBlfS4ke2NsYXNzTmFtZX1gLCBoYW5kbGVyLCBhcHBsaWNhdGlvbklkKTtcbiAgYWRkKENhdGVnb3J5LlZhbGlkYXRvcnMsIGAke3R5cGV9LiR7Y2xhc3NOYW1lfWAsIHZhbGlkYXRpb25IYW5kbGVyLCBhcHBsaWNhdGlvbklkKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZENvbm5lY3RUcmlnZ2VyKHR5cGUsIGhhbmRsZXIsIGFwcGxpY2F0aW9uSWQsIHZhbGlkYXRpb25IYW5kbGVyKSB7XG4gIGFkZChDYXRlZ29yeS5UcmlnZ2VycywgYCR7dHlwZX0uJHtDb25uZWN0Q2xhc3NOYW1lfWAsIGhhbmRsZXIsIGFwcGxpY2F0aW9uSWQpO1xuICBhZGQoQ2F0ZWdvcnkuVmFsaWRhdG9ycywgYCR7dHlwZX0uJHtDb25uZWN0Q2xhc3NOYW1lfWAsIHZhbGlkYXRpb25IYW5kbGVyLCBhcHBsaWNhdGlvbklkKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZExpdmVRdWVyeUV2ZW50SGFuZGxlcihoYW5kbGVyLCBhcHBsaWNhdGlvbklkKSB7XG4gIGFwcGxpY2F0aW9uSWQgPSBhcHBsaWNhdGlvbklkIHx8IFBhcnNlLmFwcGxpY2F0aW9uSWQ7XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gPSBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdIHx8IGJhc2VTdG9yZSgpO1xuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdLkxpdmVRdWVyeS5wdXNoKGhhbmRsZXIpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlRnVuY3Rpb24oZnVuY3Rpb25OYW1lLCBhcHBsaWNhdGlvbklkKSB7XG4gIHJlbW92ZShDYXRlZ29yeS5GdW5jdGlvbnMsIGZ1bmN0aW9uTmFtZSwgYXBwbGljYXRpb25JZCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVUcmlnZ2VyKHR5cGUsIGNsYXNzTmFtZSwgYXBwbGljYXRpb25JZCkge1xuICByZW1vdmUoQ2F0ZWdvcnkuVHJpZ2dlcnMsIGAke3R5cGV9LiR7Y2xhc3NOYW1lfWAsIGFwcGxpY2F0aW9uSWQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gX3VucmVnaXN0ZXJBbGwoKSB7XG4gIE9iamVjdC5rZXlzKF90cmlnZ2VyU3RvcmUpLmZvckVhY2goYXBwSWQgPT4gZGVsZXRlIF90cmlnZ2VyU3RvcmVbYXBwSWRdKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvSlNPTndpdGhPYmplY3RzKG9iamVjdCwgY2xhc3NOYW1lKSB7XG4gIGlmICghb2JqZWN0IHx8ICFvYmplY3QudG9KU09OKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG4gIGNvbnN0IHRvSlNPTiA9IG9iamVjdC50b0pTT04oKTtcbiAgY29uc3Qgc3RhdGVDb250cm9sbGVyID0gUGFyc2UuQ29yZU1hbmFnZXIuZ2V0T2JqZWN0U3RhdGVDb250cm9sbGVyKCk7XG4gIGNvbnN0IFtwZW5kaW5nXSA9IHN0YXRlQ29udHJvbGxlci5nZXRQZW5kaW5nT3BzKG9iamVjdC5fZ2V0U3RhdGVJZGVudGlmaWVyKCkpO1xuICBmb3IgKGNvbnN0IGtleSBpbiBwZW5kaW5nKSB7XG4gICAgY29uc3QgdmFsID0gb2JqZWN0LmdldChrZXkpO1xuICAgIGlmICghdmFsIHx8ICF2YWwuX3RvRnVsbEpTT04pIHtcbiAgICAgIHRvSlNPTltrZXldID0gdmFsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHRvSlNPTltrZXldID0gdmFsLl90b0Z1bGxKU09OKCk7XG4gIH1cbiAgLy8gUHJlc2VydmUgb3JpZ2luYWwgb2JqZWN0J3MgY2xhc3NOYW1lIGlmIG5vIG92ZXJyaWRlIGNsYXNzTmFtZSBpcyBwcm92aWRlZFxuICBpZiAoY2xhc3NOYW1lKSB7XG4gICAgdG9KU09OLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbiAgfSBlbHNlIGlmIChvYmplY3QuY2xhc3NOYW1lICYmICF0b0pTT04uY2xhc3NOYW1lKSB7XG4gICAgdG9KU09OLmNsYXNzTmFtZSA9IG9iamVjdC5jbGFzc05hbWU7XG4gIH1cbiAgcmV0dXJuIHRvSlNPTjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFRyaWdnZXIoY2xhc3NOYW1lLCB0cmlnZ2VyVHlwZSwgYXBwbGljYXRpb25JZCkge1xuICBpZiAoIWFwcGxpY2F0aW9uSWQpIHtcbiAgICB0aHJvdyAnTWlzc2luZyBBcHBsaWNhdGlvbklEJztcbiAgfVxuICByZXR1cm4gZ2V0KENhdGVnb3J5LlRyaWdnZXJzLCBgJHt0cmlnZ2VyVHlwZX0uJHtjbGFzc05hbWV9YCwgYXBwbGljYXRpb25JZCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5UcmlnZ2VyKHRyaWdnZXIsIG5hbWUsIHJlcXVlc3QsIGF1dGgpIHtcbiAgaWYgKCF0cmlnZ2VyKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGF3YWl0IG1heWJlUnVuVmFsaWRhdG9yKHJlcXVlc3QsIG5hbWUsIGF1dGgpO1xuICBpZiAocmVxdWVzdC5za2lwV2l0aE1hc3RlcktleSkge1xuICAgIHJldHVybjtcbiAgfVxuICByZXR1cm4gYXdhaXQgdHJpZ2dlcihyZXF1ZXN0KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRyaWdnZXJFeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZywgYXBwbGljYXRpb25JZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBnZXRUcmlnZ2VyKGNsYXNzTmFtZSwgdHlwZSwgYXBwbGljYXRpb25JZCkgIT0gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RnVuY3Rpb24oZnVuY3Rpb25OYW1lLCBhcHBsaWNhdGlvbklkKSB7XG4gIHJldHVybiBnZXQoQ2F0ZWdvcnkuRnVuY3Rpb25zLCBmdW5jdGlvbk5hbWUsIGFwcGxpY2F0aW9uSWQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RnVuY3Rpb25OYW1lcyhhcHBsaWNhdGlvbklkKSB7XG4gIGNvbnN0IHN0b3JlID1cbiAgICAoX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSAmJiBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdW0NhdGVnb3J5LkZ1bmN0aW9uc10pIHx8IHt9O1xuICBjb25zdCBmdW5jdGlvbk5hbWVzID0gW107XG4gIGNvbnN0IGV4dHJhY3RGdW5jdGlvbk5hbWVzID0gKG5hbWVzcGFjZSwgc3RvcmUpID0+IHtcbiAgICBPYmplY3Qua2V5cyhzdG9yZSkuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gc3RvcmVbbmFtZV07XG4gICAgICBpZiAobmFtZXNwYWNlKSB7XG4gICAgICAgIG5hbWUgPSBgJHtuYW1lc3BhY2V9LiR7bmFtZX1gO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBmdW5jdGlvbk5hbWVzLnB1c2gobmFtZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBleHRyYWN0RnVuY3Rpb25OYW1lcyhuYW1lLCB2YWx1ZSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH07XG4gIGV4dHJhY3RGdW5jdGlvbk5hbWVzKG51bGwsIHN0b3JlKTtcbiAgcmV0dXJuIGZ1bmN0aW9uTmFtZXM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRKb2Ioam9iTmFtZSwgYXBwbGljYXRpb25JZCkge1xuICByZXR1cm4gZ2V0KENhdGVnb3J5LkpvYnMsIGpvYk5hbWUsIGFwcGxpY2F0aW9uSWQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0Sm9icyhhcHBsaWNhdGlvbklkKSB7XG4gIHZhciBtYW5hZ2VyID0gX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXTtcbiAgaWYgKG1hbmFnZXIgJiYgbWFuYWdlci5Kb2JzKSB7XG4gICAgcmV0dXJuIG1hbmFnZXIuSm9icztcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0VmFsaWRhdG9yKGZ1bmN0aW9uTmFtZSwgYXBwbGljYXRpb25JZCkge1xuICByZXR1cm4gZ2V0KENhdGVnb3J5LlZhbGlkYXRvcnMsIGZ1bmN0aW9uTmFtZSwgYXBwbGljYXRpb25JZCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRSZXF1ZXN0T2JqZWN0KFxuICB0cmlnZ2VyVHlwZSxcbiAgYXV0aCxcbiAgcGFyc2VPYmplY3QsXG4gIG9yaWdpbmFsUGFyc2VPYmplY3QsXG4gIGNvbmZpZyxcbiAgY29udGV4dCxcbiAgaXNHZXRcbikge1xuICBjb25zdCByZXF1ZXN0ID0ge1xuICAgIHRyaWdnZXJOYW1lOiB0cmlnZ2VyVHlwZSxcbiAgICBvYmplY3Q6IHBhcnNlT2JqZWN0LFxuICAgIG1hc3RlcjogZmFsc2UsXG4gICAgaXNSZWFkT25seTogZmFsc2UsXG4gICAgbG9nOiBjb25maWcubG9nZ2VyQ29udHJvbGxlcixcbiAgICBoZWFkZXJzOiBjb25maWcuaGVhZGVycyxcbiAgICBpcDogY29uZmlnLmlwLFxuICAgIGNvbmZpZyxcbiAgfTtcblxuICBpZiAoaXNHZXQgIT09IHVuZGVmaW5lZCkge1xuICAgIHJlcXVlc3QuaXNHZXQgPSAhIWlzR2V0O1xuICB9XG5cbiAgaWYgKG9yaWdpbmFsUGFyc2VPYmplY3QpIHtcbiAgICByZXF1ZXN0Lm9yaWdpbmFsID0gb3JpZ2luYWxQYXJzZU9iamVjdDtcbiAgfVxuICBpZiAoXG4gICAgdHJpZ2dlclR5cGUgPT09IFR5cGVzLmJlZm9yZVNhdmUgfHxcbiAgICB0cmlnZ2VyVHlwZSA9PT0gVHlwZXMuYWZ0ZXJTYXZlIHx8XG4gICAgdHJpZ2dlclR5cGUgPT09IFR5cGVzLmJlZm9yZURlbGV0ZSB8fFxuICAgIHRyaWdnZXJUeXBlID09PSBUeXBlcy5hZnRlckRlbGV0ZSB8fFxuICAgIHRyaWdnZXJUeXBlID09PSBUeXBlcy5iZWZvcmVMb2dpbiB8fFxuICAgIHRyaWdnZXJUeXBlID09PSBUeXBlcy5hZnRlckxvZ2luIHx8XG4gICAgdHJpZ2dlclR5cGUgPT09IFR5cGVzLmJlZm9yZVBhc3N3b3JkUmVzZXRSZXF1ZXN0IHx8XG4gICAgdHJpZ2dlclR5cGUgPT09IFR5cGVzLmFmdGVyRmluZFxuICApIHtcbiAgICAvLyBTZXQgYSBjb3B5IG9mIHRoZSBjb250ZXh0IG9uIHRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICByZXF1ZXN0LmNvbnRleHQgPSBPYmplY3QuYXNzaWduKE9iamVjdC5jcmVhdGUobnVsbCksIGNvbnRleHQpO1xuICB9XG5cbiAgaWYgKCFhdXRoKSB7XG4gICAgcmV0dXJuIHJlcXVlc3Q7XG4gIH1cbiAgaWYgKGF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXF1ZXN0WydtYXN0ZXInXSA9IHRydWU7XG4gIH1cbiAgaWYgKGF1dGguaXNSZWFkT25seSkge1xuICAgIHJlcXVlc3RbJ2lzUmVhZE9ubHknXSA9IHRydWU7XG4gIH1cbiAgaWYgKGF1dGgudXNlcikge1xuICAgIHJlcXVlc3RbJ3VzZXInXSA9IGF1dGgudXNlcjtcbiAgfVxuICBpZiAoYXV0aC5pbnN0YWxsYXRpb25JZCkge1xuICAgIHJlcXVlc3RbJ2luc3RhbGxhdGlvbklkJ10gPSBhdXRoLmluc3RhbGxhdGlvbklkO1xuICB9XG4gIHJldHVybiByZXF1ZXN0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UmVxdWVzdFF1ZXJ5T2JqZWN0KHRyaWdnZXJUeXBlLCBhdXRoLCBxdWVyeSwgY291bnQsIGNvbmZpZywgY29udGV4dCwgaXNHZXQpIHtcbiAgaXNHZXQgPSAhIWlzR2V0O1xuXG4gIHZhciByZXF1ZXN0ID0ge1xuICAgIHRyaWdnZXJOYW1lOiB0cmlnZ2VyVHlwZSxcbiAgICBxdWVyeSxcbiAgICBtYXN0ZXI6IGZhbHNlLFxuICAgIGlzUmVhZE9ubHk6IGZhbHNlLFxuICAgIGNvdW50LFxuICAgIGxvZzogY29uZmlnLmxvZ2dlckNvbnRyb2xsZXIsXG4gICAgaXNHZXQsXG4gICAgaGVhZGVyczogY29uZmlnLmhlYWRlcnMsXG4gICAgaXA6IGNvbmZpZy5pcCxcbiAgICBjb250ZXh0OiBjb250ZXh0IHx8IHt9LFxuICAgIGNvbmZpZyxcbiAgfTtcblxuICBpZiAoIWF1dGgpIHtcbiAgICByZXR1cm4gcmVxdWVzdDtcbiAgfVxuICBpZiAoYXV0aC5pc01hc3Rlcikge1xuICAgIHJlcXVlc3RbJ21hc3RlciddID0gdHJ1ZTtcbiAgfVxuICBpZiAoYXV0aC5pc1JlYWRPbmx5KSB7XG4gICAgcmVxdWVzdFsnaXNSZWFkT25seSddID0gdHJ1ZTtcbiAgfVxuICBpZiAoYXV0aC51c2VyKSB7XG4gICAgcmVxdWVzdFsndXNlciddID0gYXV0aC51c2VyO1xuICB9XG4gIGlmIChhdXRoLmluc3RhbGxhdGlvbklkKSB7XG4gICAgcmVxdWVzdFsnaW5zdGFsbGF0aW9uSWQnXSA9IGF1dGguaW5zdGFsbGF0aW9uSWQ7XG4gIH1cbiAgcmV0dXJuIHJlcXVlc3Q7XG59XG5cbi8vIENyZWF0ZXMgdGhlIHJlc3BvbnNlIG9iamVjdCwgYW5kIHVzZXMgdGhlIHJlcXVlc3Qgb2JqZWN0IHRvIHBhc3MgZGF0YVxuLy8gVGhlIEFQSSB3aWxsIGNhbGwgdGhpcyB3aXRoIFJFU1QgQVBJIGZvcm1hdHRlZCBvYmplY3RzLCB0aGlzIHdpbGxcbi8vIHRyYW5zZm9ybSB0aGVtIHRvIFBhcnNlLk9iamVjdCBpbnN0YW5jZXMgZXhwZWN0ZWQgYnkgQ2xvdWQgQ29kZS5cbi8vIEFueSBjaGFuZ2VzIG1hZGUgdG8gdGhlIG9iamVjdCBpbiBhIGJlZm9yZVNhdmUgd2lsbCBiZSBpbmNsdWRlZC5cbmV4cG9ydCBmdW5jdGlvbiBnZXRSZXNwb25zZU9iamVjdChyZXF1ZXN0LCByZXNvbHZlLCByZWplY3QpIHtcbiAgcmV0dXJuIHtcbiAgICBzdWNjZXNzOiBmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgIGlmIChyZXF1ZXN0LnRyaWdnZXJOYW1lID09PSBUeXBlcy5hZnRlckZpbmQpIHtcbiAgICAgICAgaWYgKCFyZXNwb25zZSkge1xuICAgICAgICAgIHJlc3BvbnNlID0gcmVxdWVzdC5vYmplY3RzO1xuICAgICAgICB9XG4gICAgICAgIHJlc3BvbnNlID0gcmVzcG9uc2UubWFwKG9iamVjdCA9PiB7XG4gICAgICAgICAgcmV0dXJuIHRvSlNPTndpdGhPYmplY3RzKG9iamVjdCk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzb2x2ZShyZXNwb25zZSk7XG4gICAgICB9XG4gICAgICAvLyBVc2UgdGhlIEpTT04gcmVzcG9uc2VcbiAgICAgIGlmIChcbiAgICAgICAgcmVzcG9uc2UgJiZcbiAgICAgICAgdHlwZW9mIHJlc3BvbnNlID09PSAnb2JqZWN0JyAmJlxuICAgICAgICAhcmVxdWVzdC5vYmplY3QuZXF1YWxzKHJlc3BvbnNlKSAmJlxuICAgICAgICByZXF1ZXN0LnRyaWdnZXJOYW1lID09PSBUeXBlcy5iZWZvcmVTYXZlXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHJlc29sdmUocmVzcG9uc2UpO1xuICAgICAgfVxuICAgICAgaWYgKHJlc3BvbnNlICYmIHR5cGVvZiByZXNwb25zZSA9PT0gJ29iamVjdCcgJiYgcmVxdWVzdC50cmlnZ2VyTmFtZSA9PT0gVHlwZXMuYWZ0ZXJTYXZlKSB7XG4gICAgICAgIHJldHVybiByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICAgIH1cbiAgICAgIGlmIChyZXF1ZXN0LnRyaWdnZXJOYW1lID09PSBUeXBlcy5hZnRlclNhdmUpIHtcbiAgICAgICAgcmV0dXJuIHJlc29sdmUoKTtcbiAgICAgIH1cbiAgICAgIHJlc3BvbnNlID0ge307XG4gICAgICBpZiAocmVxdWVzdC50cmlnZ2VyTmFtZSA9PT0gVHlwZXMuYmVmb3JlU2F2ZSkge1xuICAgICAgICByZXNwb25zZVsnb2JqZWN0J10gPSByZXF1ZXN0Lm9iamVjdC5fZ2V0U2F2ZUpTT04oKTtcbiAgICAgICAgcmVzcG9uc2VbJ29iamVjdCddWydvYmplY3RJZCddID0gcmVxdWVzdC5vYmplY3QuaWQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzb2x2ZShyZXNwb25zZSk7XG4gICAgfSxcbiAgICBlcnJvcjogZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICBjb25zdCBlID0gcmVzb2x2ZUVycm9yKGVycm9yLCB7XG4gICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLlNDUklQVF9GQUlMRUQsXG4gICAgICAgIG1lc3NhZ2U6ICdTY3JpcHQgZmFpbGVkLiBVbmtub3duIGVycm9yLicsXG4gICAgICB9KTtcbiAgICAgIHJlamVjdChlKTtcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiB1c2VySWRGb3JMb2coYXV0aCkge1xuICByZXR1cm4gYXV0aCAmJiBhdXRoLnVzZXIgPyBhdXRoLnVzZXIuaWQgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGxvZ1RyaWdnZXJBZnRlckhvb2sodHJpZ2dlclR5cGUsIGNsYXNzTmFtZSwgaW5wdXQsIGF1dGgsIGxvZ0xldmVsKSB7XG4gIGlmIChsb2dMZXZlbCA9PT0gJ3NpbGVudCcpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgY2xlYW5JbnB1dCA9IGxvZ2dlci50cnVuY2F0ZUxvZ01lc3NhZ2UoSlNPTi5zdHJpbmdpZnkoaW5wdXQpKTtcbiAgbG9nZ2VyW2xvZ0xldmVsXShcbiAgICBgJHt0cmlnZ2VyVHlwZX0gdHJpZ2dlcmVkIGZvciAke2NsYXNzTmFtZX0gZm9yIHVzZXIgJHt1c2VySWRGb3JMb2coXG4gICAgICBhdXRoXG4gICAgKX06XFxuICBJbnB1dDogJHtjbGVhbklucHV0fWAsXG4gICAge1xuICAgICAgY2xhc3NOYW1lLFxuICAgICAgdHJpZ2dlclR5cGUsXG4gICAgICB1c2VyOiB1c2VySWRGb3JMb2coYXV0aCksXG4gICAgfVxuICApO1xufVxuXG5mdW5jdGlvbiBsb2dUcmlnZ2VyU3VjY2Vzc0JlZm9yZUhvb2sodHJpZ2dlclR5cGUsIGNsYXNzTmFtZSwgaW5wdXQsIHJlc3VsdCwgYXV0aCwgbG9nTGV2ZWwpIHtcbiAgaWYgKGxvZ0xldmVsID09PSAnc2lsZW50Jykge1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBjbGVhbklucHV0ID0gbG9nZ2VyLnRydW5jYXRlTG9nTWVzc2FnZShKU09OLnN0cmluZ2lmeShpbnB1dCkpO1xuICBjb25zdCBjbGVhblJlc3VsdCA9IGxvZ2dlci50cnVuY2F0ZUxvZ01lc3NhZ2UoSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XG4gIGxvZ2dlcltsb2dMZXZlbF0oXG4gICAgYCR7dHJpZ2dlclR5cGV9IHRyaWdnZXJlZCBmb3IgJHtjbGFzc05hbWV9IGZvciB1c2VyICR7dXNlcklkRm9yTG9nKFxuICAgICAgYXV0aFxuICAgICl9OlxcbiAgSW5wdXQ6ICR7Y2xlYW5JbnB1dH1cXG4gIFJlc3VsdDogJHtjbGVhblJlc3VsdH1gLFxuICAgIHtcbiAgICAgIGNsYXNzTmFtZSxcbiAgICAgIHRyaWdnZXJUeXBlLFxuICAgICAgdXNlcjogdXNlcklkRm9yTG9nKGF1dGgpLFxuICAgIH1cbiAgKTtcbn1cblxuZnVuY3Rpb24gbG9nVHJpZ2dlckVycm9yQmVmb3JlSG9vayh0cmlnZ2VyVHlwZSwgY2xhc3NOYW1lLCBpbnB1dCwgYXV0aCwgZXJyb3IsIGxvZ0xldmVsKSB7XG4gIGlmIChsb2dMZXZlbCA9PT0gJ3NpbGVudCcpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgY2xlYW5JbnB1dCA9IGxvZ2dlci50cnVuY2F0ZUxvZ01lc3NhZ2UoSlNPTi5zdHJpbmdpZnkoaW5wdXQpKTtcbiAgbG9nZ2VyW2xvZ0xldmVsXShcbiAgICBgJHt0cmlnZ2VyVHlwZX0gZmFpbGVkIGZvciAke2NsYXNzTmFtZX0gZm9yIHVzZXIgJHt1c2VySWRGb3JMb2coXG4gICAgICBhdXRoXG4gICAgKX06XFxuICBJbnB1dDogJHtjbGVhbklucHV0fVxcbiAgRXJyb3I6ICR7SlNPTi5zdHJpbmdpZnkoZXJyb3IpfWAsXG4gICAge1xuICAgICAgY2xhc3NOYW1lLFxuICAgICAgdHJpZ2dlclR5cGUsXG4gICAgICBlcnJvcixcbiAgICAgIHVzZXI6IHVzZXJJZEZvckxvZyhhdXRoKSxcbiAgICB9XG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXliZVJ1bkFmdGVyRmluZFRyaWdnZXIoXG4gIHRyaWdnZXJUeXBlLFxuICBhdXRoLFxuICBjbGFzc05hbWVRdWVyeSxcbiAgb2JqZWN0c0lucHV0LFxuICBjb25maWcsXG4gIHF1ZXJ5LFxuICBjb250ZXh0LFxuICBpc0dldFxuKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgdHJpZ2dlciA9IGdldFRyaWdnZXIoY2xhc3NOYW1lUXVlcnksIHRyaWdnZXJUeXBlLCBjb25maWcuYXBwbGljYXRpb25JZCk7XG5cbiAgICBpZiAoIXRyaWdnZXIpIHtcbiAgICAgIGlmIChvYmplY3RzSW5wdXQgJiYgb2JqZWN0c0lucHV0Lmxlbmd0aCA+IDAgJiYgb2JqZWN0c0lucHV0WzBdIGluc3RhbmNlb2YgUGFyc2UuT2JqZWN0KSB7XG4gICAgICAgIHJldHVybiByZXNvbHZlKG9iamVjdHNJbnB1dC5tYXAob2JqID0+IHRvSlNPTndpdGhPYmplY3RzKG9iaikpKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXNvbHZlKG9iamVjdHNJbnB1dCB8fCBbXSk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVxdWVzdCA9IGdldFJlcXVlc3RPYmplY3QodHJpZ2dlclR5cGUsIGF1dGgsIG51bGwsIG51bGwsIGNvbmZpZywgY29udGV4dCwgaXNHZXQpO1xuICAgIC8vIENvbnZlcnQgcXVlcnkgcGFyYW1ldGVyIHRvIFBhcnNlLlF1ZXJ5IGluc3RhbmNlXG4gICAgaWYgKHF1ZXJ5IGluc3RhbmNlb2YgUGFyc2UuUXVlcnkpIHtcbiAgICAgIHJlcXVlc3QucXVlcnkgPSBxdWVyeTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBxdWVyeSA9PT0gJ29iamVjdCcgJiYgcXVlcnkgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IHBhcnNlUXVlcnlJbnN0YW5jZSA9IG5ldyBQYXJzZS5RdWVyeShjbGFzc05hbWVRdWVyeSk7XG4gICAgICBpZiAocXVlcnkud2hlcmUpIHtcbiAgICAgICAgcGFyc2VRdWVyeUluc3RhbmNlLndpdGhKU09OKHF1ZXJ5KTtcbiAgICAgIH1cbiAgICAgIHJlcXVlc3QucXVlcnkgPSBwYXJzZVF1ZXJ5SW5zdGFuY2U7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlcXVlc3QucXVlcnkgPSBuZXcgUGFyc2UuUXVlcnkoY2xhc3NOYW1lUXVlcnkpO1xuICAgIH1cblxuICAgIGNvbnN0IHsgc3VjY2VzcywgZXJyb3IgfSA9IGdldFJlc3BvbnNlT2JqZWN0KFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHByb2Nlc3NlZE9iamVjdHNKU09OID0+IHtcbiAgICAgICAgcmVzb2x2ZShwcm9jZXNzZWRPYmplY3RzSlNPTik7XG4gICAgICB9LFxuICAgICAgZXJyb3JEYXRhID0+IHtcbiAgICAgICAgcmVqZWN0KGVycm9yRGF0YSk7XG4gICAgICB9XG4gICAgKTtcbiAgICBsb2dUcmlnZ2VyU3VjY2Vzc0JlZm9yZUhvb2soXG4gICAgICB0cmlnZ2VyVHlwZSxcbiAgICAgIGNsYXNzTmFtZVF1ZXJ5LFxuICAgICAgJ0FmdGVyRmluZCBJbnB1dCAoUHJlLVRyYW5zZm9ybSknLFxuICAgICAgSlNPTi5zdHJpbmdpZnkoXG4gICAgICAgIG9iamVjdHNJbnB1dC5tYXAobyA9PiAobyBpbnN0YW5jZW9mIFBhcnNlLk9iamVjdCA/IG8uaWQgKyAnOicgKyBvLmNsYXNzTmFtZSA6IG8pKVxuICAgICAgKSxcbiAgICAgIGF1dGgsXG4gICAgICBjb25maWcubG9nTGV2ZWxzLnRyaWdnZXJCZWZvcmVTdWNjZXNzXG4gICAgKTtcblxuICAgIC8vIENvbnZlcnQgcGxhaW4gb2JqZWN0cyB0byBQYXJzZS5PYmplY3QgaW5zdGFuY2VzIGZvciB0cmlnZ2VyXG4gICAgcmVxdWVzdC5vYmplY3RzID0gb2JqZWN0c0lucHV0Lm1hcChjdXJyZW50T2JqZWN0ID0+IHtcbiAgICAgIGlmIChjdXJyZW50T2JqZWN0IGluc3RhbmNlb2YgUGFyc2UuT2JqZWN0KSB7XG4gICAgICAgIHJldHVybiBjdXJyZW50T2JqZWN0O1xuICAgICAgfVxuICAgICAgLy8gUHJlc2VydmUgdGhlIG9yaWdpbmFsIGNsYXNzTmFtZSBpZiBpdCBleGlzdHMsIG90aGVyd2lzZSB1c2UgdGhlIHF1ZXJ5IGNsYXNzTmFtZVxuICAgICAgY29uc3Qgb3JpZ2luYWxDbGFzc05hbWUgPSBjdXJyZW50T2JqZWN0LmNsYXNzTmFtZSB8fCBjbGFzc05hbWVRdWVyeTtcbiAgICAgIGNvbnN0IHRlbXBPYmplY3RXaXRoQ2xhc3NOYW1lID0geyAuLi5jdXJyZW50T2JqZWN0LCBjbGFzc05hbWU6IG9yaWdpbmFsQ2xhc3NOYW1lIH07XG4gICAgICByZXR1cm4gUGFyc2UuT2JqZWN0LmZyb21KU09OKHRlbXBPYmplY3RXaXRoQ2xhc3NOYW1lKTtcbiAgICB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIG1heWJlUnVuVmFsaWRhdG9yKHJlcXVlc3QsIGAke3RyaWdnZXJUeXBlfS4ke2NsYXNzTmFtZVF1ZXJ5fWAsIGF1dGgpO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKHJlcXVlc3Quc2tpcFdpdGhNYXN0ZXJLZXkpIHtcbiAgICAgICAgICByZXR1cm4gcmVxdWVzdC5vYmplY3RzO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlRnJvbVRyaWdnZXIgPSB0cmlnZ2VyKHJlcXVlc3QpO1xuICAgICAgICBpZiAocmVzcG9uc2VGcm9tVHJpZ2dlciAmJiB0eXBlb2YgcmVzcG9uc2VGcm9tVHJpZ2dlci50aGVuID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc3BvbnNlRnJvbVRyaWdnZXIudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHRzO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXNwb25zZUZyb21UcmlnZ2VyO1xuICAgICAgfSlcbiAgICAgIC50aGVuKHN1Y2Nlc3MsIGVycm9yKTtcbiAgfSkudGhlbihyZXN1bHRzQXNKU09OID0+IHtcbiAgICBsb2dUcmlnZ2VyQWZ0ZXJIb29rKFxuICAgICAgdHJpZ2dlclR5cGUsXG4gICAgICBjbGFzc05hbWVRdWVyeSxcbiAgICAgIEpTT04uc3RyaW5naWZ5KHJlc3VsdHNBc0pTT04pLFxuICAgICAgYXV0aCxcbiAgICAgIGNvbmZpZy5sb2dMZXZlbHMudHJpZ2dlckFmdGVyXG4gICAgKTtcbiAgICByZXR1cm4gcmVzdWx0c0FzSlNPTjtcbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXliZVJ1blF1ZXJ5VHJpZ2dlcihcbiAgdHJpZ2dlclR5cGUsXG4gIGNsYXNzTmFtZSxcbiAgcmVzdFdoZXJlLFxuICByZXN0T3B0aW9ucyxcbiAgY29uZmlnLFxuICBhdXRoLFxuICBjb250ZXh0LFxuICBpc0dldFxuKSB7XG4gIGNvbnN0IHRyaWdnZXIgPSBnZXRUcmlnZ2VyKGNsYXNzTmFtZSwgdHJpZ2dlclR5cGUsIGNvbmZpZy5hcHBsaWNhdGlvbklkKTtcbiAgaWYgKCF0cmlnZ2VyKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICByZXN0V2hlcmUsXG4gICAgICByZXN0T3B0aW9ucyxcbiAgICB9KTtcbiAgfVxuICBjb25zdCBqc29uID0gT2JqZWN0LmFzc2lnbih7fSwgcmVzdE9wdGlvbnMpO1xuICBqc29uLndoZXJlID0gcmVzdFdoZXJlO1xuXG4gIGNvbnN0IHBhcnNlUXVlcnkgPSBuZXcgUGFyc2UuUXVlcnkoY2xhc3NOYW1lKTtcbiAgcGFyc2VRdWVyeS53aXRoSlNPTihqc29uKTtcblxuICBsZXQgY291bnQgPSBmYWxzZTtcbiAgaWYgKHJlc3RPcHRpb25zKSB7XG4gICAgY291bnQgPSAhIXJlc3RPcHRpb25zLmNvdW50O1xuICB9XG4gIGNvbnN0IHJlcXVlc3RPYmplY3QgPSBnZXRSZXF1ZXN0UXVlcnlPYmplY3QoXG4gICAgdHJpZ2dlclR5cGUsXG4gICAgYXV0aCxcbiAgICBwYXJzZVF1ZXJ5LFxuICAgIGNvdW50LFxuICAgIGNvbmZpZyxcbiAgICBjb250ZXh0LFxuICAgIGlzR2V0XG4gICk7XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiBtYXliZVJ1blZhbGlkYXRvcihyZXF1ZXN0T2JqZWN0LCBgJHt0cmlnZ2VyVHlwZX0uJHtjbGFzc05hbWV9YCwgYXV0aCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICBpZiAocmVxdWVzdE9iamVjdC5za2lwV2l0aE1hc3RlcktleSkge1xuICAgICAgICByZXR1cm4gcmVxdWVzdE9iamVjdC5xdWVyeTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0cmlnZ2VyKHJlcXVlc3RPYmplY3QpO1xuICAgIH0pXG4gICAgLnRoZW4oXG4gICAgICByZXN1bHQgPT4ge1xuICAgICAgICBsZXQgcXVlcnlSZXN1bHQgPSBwYXJzZVF1ZXJ5O1xuICAgICAgICBpZiAocmVzdWx0ICYmIHJlc3VsdCBpbnN0YW5jZW9mIFBhcnNlLlF1ZXJ5KSB7XG4gICAgICAgICAgcXVlcnlSZXN1bHQgPSByZXN1bHQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QganNvblF1ZXJ5ID0gcXVlcnlSZXN1bHQudG9KU09OKCk7XG4gICAgICAgIGlmIChqc29uUXVlcnkud2hlcmUpIHtcbiAgICAgICAgICByZXN0V2hlcmUgPSBqc29uUXVlcnkud2hlcmU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGpzb25RdWVyeS5saW1pdCkge1xuICAgICAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICAgICAgcmVzdE9wdGlvbnMubGltaXQgPSBqc29uUXVlcnkubGltaXQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGpzb25RdWVyeS5za2lwKSB7XG4gICAgICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgICAgICByZXN0T3B0aW9ucy5za2lwID0ganNvblF1ZXJ5LnNraXA7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGpzb25RdWVyeS5pbmNsdWRlKSB7XG4gICAgICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgICAgICByZXN0T3B0aW9ucy5pbmNsdWRlID0ganNvblF1ZXJ5LmluY2x1ZGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGpzb25RdWVyeS5leGNsdWRlS2V5cykge1xuICAgICAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICAgICAgcmVzdE9wdGlvbnMuZXhjbHVkZUtleXMgPSBqc29uUXVlcnkuZXhjbHVkZUtleXM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGpzb25RdWVyeS5leHBsYWluKSB7XG4gICAgICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgICAgICByZXN0T3B0aW9ucy5leHBsYWluID0ganNvblF1ZXJ5LmV4cGxhaW47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGpzb25RdWVyeS5rZXlzKSB7XG4gICAgICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgICAgICByZXN0T3B0aW9ucy5rZXlzID0ganNvblF1ZXJ5LmtleXM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGpzb25RdWVyeS5vcmRlcikge1xuICAgICAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICAgICAgcmVzdE9wdGlvbnMub3JkZXIgPSBqc29uUXVlcnkub3JkZXI7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGpzb25RdWVyeS5oaW50KSB7XG4gICAgICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgICAgICByZXN0T3B0aW9ucy5oaW50ID0ganNvblF1ZXJ5LmhpbnQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGpzb25RdWVyeS5jb21tZW50KSB7XG4gICAgICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgICAgICByZXN0T3B0aW9ucy5jb21tZW50ID0ganNvblF1ZXJ5LmNvbW1lbnQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlcXVlc3RPYmplY3QucmVhZFByZWZlcmVuY2UpIHtcbiAgICAgICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgICAgIHJlc3RPcHRpb25zLnJlYWRQcmVmZXJlbmNlID0gcmVxdWVzdE9iamVjdC5yZWFkUHJlZmVyZW5jZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVxdWVzdE9iamVjdC5pbmNsdWRlUmVhZFByZWZlcmVuY2UpIHtcbiAgICAgICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgICAgIHJlc3RPcHRpb25zLmluY2x1ZGVSZWFkUHJlZmVyZW5jZSA9IHJlcXVlc3RPYmplY3QuaW5jbHVkZVJlYWRQcmVmZXJlbmNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZXF1ZXN0T2JqZWN0LnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UpIHtcbiAgICAgICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgICAgIHJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UgPSByZXF1ZXN0T2JqZWN0LnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gICAgICAgIH1cbiAgICAgICAgbGV0IG9iamVjdHMgPSB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQYXJzZS5PYmplY3QpIHtcbiAgICAgICAgICBvYmplY3RzID0gW3Jlc3VsdF07XG4gICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgQXJyYXkuaXNBcnJheShyZXN1bHQpICYmXG4gICAgICAgICAgKCFyZXN1bHQubGVuZ3RoIHx8IHJlc3VsdC5ldmVyeShvYmogPT4gb2JqIGluc3RhbmNlb2YgUGFyc2UuT2JqZWN0KSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgb2JqZWN0cyA9IHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHJlc3RXaGVyZSxcbiAgICAgICAgICByZXN0T3B0aW9ucyxcbiAgICAgICAgICBvYmplY3RzLFxuICAgICAgICB9O1xuICAgICAgfSxcbiAgICAgIGVyciA9PiB7XG4gICAgICAgIGNvbnN0IGVycm9yID0gcmVzb2x2ZUVycm9yKGVyciwge1xuICAgICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLlNDUklQVF9GQUlMRUQsXG4gICAgICAgICAgbWVzc2FnZTogJ1NjcmlwdCBmYWlsZWQuIFVua25vd24gZXJyb3IuJyxcbiAgICAgICAgfSk7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlRXJyb3IobWVzc2FnZSwgZGVmYXVsdE9wdHMpIHtcbiAgaWYgKCFkZWZhdWx0T3B0cykge1xuICAgIGRlZmF1bHRPcHRzID0ge307XG4gIH1cbiAgaWYgKCFtZXNzYWdlKSB7XG4gICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIGRlZmF1bHRPcHRzLmNvZGUgfHwgUGFyc2UuRXJyb3IuU0NSSVBUX0ZBSUxFRCxcbiAgICAgIGRlZmF1bHRPcHRzLm1lc3NhZ2UgfHwgJ1NjcmlwdCBmYWlsZWQuJ1xuICAgICk7XG4gIH1cbiAgaWYgKG1lc3NhZ2UgaW5zdGFuY2VvZiBQYXJzZS5FcnJvcikge1xuICAgIHJldHVybiBtZXNzYWdlO1xuICB9XG5cbiAgY29uc3QgY29kZSA9IGRlZmF1bHRPcHRzLmNvZGUgfHwgUGFyc2UuRXJyb3IuU0NSSVBUX0ZBSUxFRDtcbiAgLy8gSWYgaXQncyBhbiBlcnJvciwgbWFyayBpdCBhcyBhIHNjcmlwdCBmYWlsZWRcbiAgaWYgKHR5cGVvZiBtZXNzYWdlID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoY29kZSwgbWVzc2FnZSk7XG4gIH1cbiAgY29uc3QgZXJyb3IgPSBuZXcgUGFyc2UuRXJyb3IoY29kZSwgbWVzc2FnZS5tZXNzYWdlIHx8IG1lc3NhZ2UpO1xuICBpZiAoVXRpbHMuaXNOYXRpdmVFcnJvcihtZXNzYWdlKSkge1xuICAgIGVycm9yLnN0YWNrID0gbWVzc2FnZS5zdGFjaztcbiAgfVxuICByZXR1cm4gZXJyb3I7XG59XG5leHBvcnQgZnVuY3Rpb24gbWF5YmVSdW5WYWxpZGF0b3IocmVxdWVzdCwgZnVuY3Rpb25OYW1lLCBhdXRoKSB7XG4gIGNvbnN0IHRoZVZhbGlkYXRvciA9IGdldFZhbGlkYXRvcihmdW5jdGlvbk5hbWUsIFBhcnNlLmFwcGxpY2F0aW9uSWQpO1xuICBpZiAoIXRoZVZhbGlkYXRvcikge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodHlwZW9mIHRoZVZhbGlkYXRvciA9PT0gJ29iamVjdCcgJiYgdGhlVmFsaWRhdG9yLnNraXBXaXRoTWFzdGVyS2V5ICYmIHJlcXVlc3QubWFzdGVyKSB7XG4gICAgcmVxdWVzdC5za2lwV2l0aE1hc3RlcktleSA9IHRydWU7XG4gIH1cbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHR5cGVvZiB0aGVWYWxpZGF0b3IgPT09ICdvYmplY3QnXG4gICAgICAgICAgPyBidWlsdEluVHJpZ2dlclZhbGlkYXRvcih0aGVWYWxpZGF0b3IsIHJlcXVlc3QsIGF1dGgpXG4gICAgICAgICAgOiB0aGVWYWxpZGF0b3IocmVxdWVzdCk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGUgPT4ge1xuICAgICAgICBjb25zdCBlcnJvciA9IHJlc29sdmVFcnJvcihlLCB7XG4gICAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuVkFMSURBVElPTl9FUlJPUixcbiAgICAgICAgICBtZXNzYWdlOiAnVmFsaWRhdGlvbiBmYWlsZWQuJyxcbiAgICAgICAgfSk7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9KTtcbiAgfSk7XG59XG5hc3luYyBmdW5jdGlvbiBidWlsdEluVHJpZ2dlclZhbGlkYXRvcihvcHRpb25zLCByZXF1ZXN0LCBhdXRoKSB7XG4gIGlmIChyZXF1ZXN0Lm1hc3RlciAmJiAhb3B0aW9ucy52YWxpZGF0ZU1hc3RlcktleSkge1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgcmVxVXNlciA9IHJlcXVlc3QudXNlcjtcbiAgaWYgKFxuICAgICFyZXFVc2VyICYmXG4gICAgcmVxdWVzdC5vYmplY3QgJiZcbiAgICByZXF1ZXN0Lm9iamVjdC5jbGFzc05hbWUgPT09ICdfVXNlcicgJiZcbiAgICAhcmVxdWVzdC5vYmplY3QuZXhpc3RlZCgpXG4gICkge1xuICAgIHJlcVVzZXIgPSByZXF1ZXN0Lm9iamVjdDtcbiAgfVxuICBpZiAoXG4gICAgKG9wdGlvbnMucmVxdWlyZVVzZXIgfHwgb3B0aW9ucy5yZXF1aXJlQW55VXNlclJvbGVzIHx8IG9wdGlvbnMucmVxdWlyZUFsbFVzZXJSb2xlcykgJiZcbiAgICAhcmVxVXNlclxuICApIHtcbiAgICB0aHJvdyAnVmFsaWRhdGlvbiBmYWlsZWQuIFBsZWFzZSBsb2dpbiB0byBjb250aW51ZS4nO1xuICB9XG4gIGlmIChvcHRpb25zLnJlcXVpcmVNYXN0ZXIgJiYgIXJlcXVlc3QubWFzdGVyKSB7XG4gICAgdGhyb3cgJ1ZhbGlkYXRpb24gZmFpbGVkLiBNYXN0ZXIga2V5IGlzIHJlcXVpcmVkIHRvIGNvbXBsZXRlIHRoaXMgcmVxdWVzdC4nO1xuICB9XG4gIGxldCBwYXJhbXMgPSByZXF1ZXN0LnBhcmFtcyB8fCB7fTtcbiAgaWYgKHJlcXVlc3Qub2JqZWN0KSB7XG4gICAgcGFyYW1zID0gcmVxdWVzdC5vYmplY3QudG9KU09OKCk7XG4gIH1cbiAgY29uc3QgcmVxdWlyZWRQYXJhbSA9IGtleSA9PiB7XG4gICAgY29uc3QgdmFsdWUgPSBwYXJhbXNba2V5XTtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgdGhyb3cgYFZhbGlkYXRpb24gZmFpbGVkLiBQbGVhc2Ugc3BlY2lmeSBkYXRhIGZvciAke2tleX0uYDtcbiAgICB9XG4gIH07XG5cbiAgY29uc3QgdmFsaWRhdGVPcHRpb25zID0gYXN5bmMgKG9wdCwga2V5LCB2YWwpID0+IHtcbiAgICBsZXQgb3B0cyA9IG9wdC5vcHRpb25zO1xuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb3B0cyh2YWwpO1xuICAgICAgICBpZiAoIXJlc3VsdCAmJiByZXN1bHQgIT0gbnVsbCkge1xuICAgICAgICAgIHRocm93IG9wdC5lcnJvciB8fCBgVmFsaWRhdGlvbiBmYWlsZWQuIEludmFsaWQgdmFsdWUgZm9yICR7a2V5fS5gO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGlmICghZSkge1xuICAgICAgICAgIHRocm93IG9wdC5lcnJvciB8fCBgVmFsaWRhdGlvbiBmYWlsZWQuIEludmFsaWQgdmFsdWUgZm9yICR7a2V5fS5gO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgb3B0LmVycm9yIHx8IGUubWVzc2FnZSB8fCBlO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob3B0cykpIHtcbiAgICAgIG9wdHMgPSBbb3B0Lm9wdGlvbnNdO1xuICAgIH1cblxuICAgIGlmICghb3B0cy5pbmNsdWRlcyh2YWwpKSB7XG4gICAgICB0aHJvdyAoXG4gICAgICAgIG9wdC5lcnJvciB8fCBgVmFsaWRhdGlvbiBmYWlsZWQuIEludmFsaWQgb3B0aW9uIGZvciAke2tleX0uIEV4cGVjdGVkOiAke29wdHMuam9pbignLCAnKX1gXG4gICAgICApO1xuICAgIH1cbiAgfTtcblxuICBjb25zdCBnZXRUeXBlID0gZm4gPT4ge1xuICAgIGNvbnN0IG1hdGNoID0gZm4gJiYgZm4udG9TdHJpbmcoKS5tYXRjaCgvXlxccypmdW5jdGlvbiAoXFx3KykvKTtcbiAgICByZXR1cm4gKG1hdGNoID8gbWF0Y2hbMV0gOiAnJykudG9Mb3dlckNhc2UoKTtcbiAgfTtcbiAgaWYgKEFycmF5LmlzQXJyYXkob3B0aW9ucy5maWVsZHMpKSB7XG4gICAgZm9yIChjb25zdCBrZXkgb2Ygb3B0aW9ucy5maWVsZHMpIHtcbiAgICAgIHJlcXVpcmVkUGFyYW0oa2V5KTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY29uc3Qgb3B0aW9uUHJvbWlzZXMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBvcHRpb25zLmZpZWxkcykge1xuICAgICAgY29uc3Qgb3B0ID0gb3B0aW9ucy5maWVsZHNba2V5XTtcbiAgICAgIGxldCB2YWwgPSBwYXJhbXNba2V5XTtcbiAgICAgIGlmICh0eXBlb2Ygb3B0ID09PSAnc3RyaW5nJykge1xuICAgICAgICByZXF1aXJlZFBhcmFtKG9wdCk7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIG9wdCA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgaWYgKG9wdC5kZWZhdWx0ICE9IG51bGwgJiYgdmFsID09IG51bGwpIHtcbiAgICAgICAgICB2YWwgPSBvcHQuZGVmYXVsdDtcbiAgICAgICAgICBwYXJhbXNba2V5XSA9IHZhbDtcbiAgICAgICAgICBpZiAocmVxdWVzdC5vYmplY3QpIHtcbiAgICAgICAgICAgIHJlcXVlc3Qub2JqZWN0LnNldChrZXksIHZhbCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChvcHQuY29uc3RhbnQgJiYgcmVxdWVzdC5vYmplY3QpIHtcbiAgICAgICAgICBpZiAocmVxdWVzdC5vcmlnaW5hbCkge1xuICAgICAgICAgICAgcmVxdWVzdC5vYmplY3QucmV2ZXJ0KGtleSk7XG4gICAgICAgICAgfSBlbHNlIGlmIChvcHQuZGVmYXVsdCAhPSBudWxsKSB7XG4gICAgICAgICAgICByZXF1ZXN0Lm9iamVjdC5zZXQoa2V5LCBvcHQuZGVmYXVsdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChvcHQucmVxdWlyZWQpIHtcbiAgICAgICAgICByZXF1aXJlZFBhcmFtKGtleSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgb3B0aW9uYWwgPSAhb3B0LnJlcXVpcmVkICYmIHZhbCA9PT0gdW5kZWZpbmVkO1xuICAgICAgICBpZiAoIW9wdGlvbmFsKSB7XG4gICAgICAgICAgaWYgKG9wdC50eXBlKSB7XG4gICAgICAgICAgICBjb25zdCB0eXBlID0gZ2V0VHlwZShvcHQudHlwZSk7XG4gICAgICAgICAgICBjb25zdCB2YWxUeXBlID0gQXJyYXkuaXNBcnJheSh2YWwpID8gJ2FycmF5JyA6IHR5cGVvZiB2YWw7XG4gICAgICAgICAgICBpZiAodmFsVHlwZSAhPT0gdHlwZSkge1xuICAgICAgICAgICAgICB0aHJvdyBgVmFsaWRhdGlvbiBmYWlsZWQuIEludmFsaWQgdHlwZSBmb3IgJHtrZXl9LiBFeHBlY3RlZDogJHt0eXBlfWA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChvcHQub3B0aW9ucykge1xuICAgICAgICAgICAgb3B0aW9uUHJvbWlzZXMucHVzaCh2YWxpZGF0ZU9wdGlvbnMob3B0LCBrZXksIHZhbCkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCBQcm9taXNlLmFsbChvcHRpb25Qcm9taXNlcyk7XG4gIH1cbiAgbGV0IHVzZXJSb2xlcyA9IG9wdGlvbnMucmVxdWlyZUFueVVzZXJSb2xlcztcbiAgbGV0IHJlcXVpcmVBbGxSb2xlcyA9IG9wdGlvbnMucmVxdWlyZUFsbFVzZXJSb2xlcztcbiAgY29uc3QgcHJvbWlzZXMgPSBbUHJvbWlzZS5yZXNvbHZlKCksIFByb21pc2UucmVzb2x2ZSgpLCBQcm9taXNlLnJlc29sdmUoKV07XG4gIGlmICh1c2VyUm9sZXMgfHwgcmVxdWlyZUFsbFJvbGVzKSB7XG4gICAgcHJvbWlzZXNbMF0gPSBhdXRoLmdldFVzZXJSb2xlcygpO1xuICB9XG4gIGlmICh0eXBlb2YgdXNlclJvbGVzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcHJvbWlzZXNbMV0gPSB1c2VyUm9sZXMoKTtcbiAgfVxuICBpZiAodHlwZW9mIHJlcXVpcmVBbGxSb2xlcyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHByb21pc2VzWzJdID0gcmVxdWlyZUFsbFJvbGVzKCk7XG4gIH1cbiAgY29uc3QgW3JvbGVzLCByZXNvbHZlZFVzZXJSb2xlcywgcmVzb2x2ZWRSZXF1aXJlQWxsXSA9IGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgaWYgKHJlc29sdmVkVXNlclJvbGVzICYmIEFycmF5LmlzQXJyYXkocmVzb2x2ZWRVc2VyUm9sZXMpKSB7XG4gICAgdXNlclJvbGVzID0gcmVzb2x2ZWRVc2VyUm9sZXM7XG4gIH1cbiAgaWYgKHJlc29sdmVkUmVxdWlyZUFsbCAmJiBBcnJheS5pc0FycmF5KHJlc29sdmVkUmVxdWlyZUFsbCkpIHtcbiAgICByZXF1aXJlQWxsUm9sZXMgPSByZXNvbHZlZFJlcXVpcmVBbGw7XG4gIH1cbiAgaWYgKHVzZXJSb2xlcykge1xuICAgIGNvbnN0IGhhc1JvbGUgPSB1c2VyUm9sZXMuc29tZShyZXF1aXJlZFJvbGUgPT4gcm9sZXMuaW5jbHVkZXMoYHJvbGU6JHtyZXF1aXJlZFJvbGV9YCkpO1xuICAgIGlmICghaGFzUm9sZSkge1xuICAgICAgdGhyb3cgYFZhbGlkYXRpb24gZmFpbGVkLiBVc2VyIGRvZXMgbm90IG1hdGNoIHRoZSByZXF1aXJlZCByb2xlcy5gO1xuICAgIH1cbiAgfVxuICBpZiAocmVxdWlyZUFsbFJvbGVzKSB7XG4gICAgZm9yIChjb25zdCByZXF1aXJlZFJvbGUgb2YgcmVxdWlyZUFsbFJvbGVzKSB7XG4gICAgICBpZiAoIXJvbGVzLmluY2x1ZGVzKGByb2xlOiR7cmVxdWlyZWRSb2xlfWApKSB7XG4gICAgICAgIHRocm93IGBWYWxpZGF0aW9uIGZhaWxlZC4gVXNlciBkb2VzIG5vdCBtYXRjaCBhbGwgdGhlIHJlcXVpcmVkIHJvbGVzLmA7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGNvbnN0IHVzZXJLZXlzID0gb3B0aW9ucy5yZXF1aXJlVXNlcktleXMgfHwgW107XG4gIGlmIChBcnJheS5pc0FycmF5KHVzZXJLZXlzKSkge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIHVzZXJLZXlzKSB7XG4gICAgICBpZiAoIXJlcVVzZXIpIHtcbiAgICAgICAgdGhyb3cgJ1BsZWFzZSBsb2dpbiB0byBtYWtlIHRoaXMgcmVxdWVzdC4nO1xuICAgICAgfVxuXG4gICAgICBpZiAocmVxVXNlci5nZXQoa2V5KSA9PSBudWxsKSB7XG4gICAgICAgIHRocm93IGBWYWxpZGF0aW9uIGZhaWxlZC4gUGxlYXNlIHNldCBkYXRhIGZvciAke2tleX0gb24geW91ciBhY2NvdW50LmA7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGVvZiB1c2VyS2V5cyA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCBvcHRpb25Qcm9taXNlcyA9IFtdO1xuICAgIGZvciAoY29uc3Qga2V5IGluIG9wdGlvbnMucmVxdWlyZVVzZXJLZXlzKSB7XG4gICAgICBjb25zdCBvcHQgPSBvcHRpb25zLnJlcXVpcmVVc2VyS2V5c1trZXldO1xuICAgICAgaWYgKG9wdC5vcHRpb25zKSB7XG4gICAgICAgIG9wdGlvblByb21pc2VzLnB1c2godmFsaWRhdGVPcHRpb25zKG9wdCwga2V5LCByZXFVc2VyLmdldChrZXkpKSk7XG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IFByb21pc2UuYWxsKG9wdGlvblByb21pc2VzKTtcbiAgfVxufVxuXG4vLyBUbyBiZSB1c2VkIGFzIHBhcnQgb2YgdGhlIHByb21pc2UgY2hhaW4gd2hlbiBzYXZpbmcvZGVsZXRpbmcgYW4gb2JqZWN0XG4vLyBXaWxsIHJlc29sdmUgc3VjY2Vzc2Z1bGx5IGlmIG5vIHRyaWdnZXIgaXMgY29uZmlndXJlZFxuLy8gUmVzb2x2ZXMgdG8gYW4gb2JqZWN0LCBlbXB0eSBvciBjb250YWluaW5nIGFuIG9iamVjdCBrZXkuIEEgYmVmb3JlU2F2ZVxuLy8gdHJpZ2dlciB3aWxsIHNldCB0aGUgb2JqZWN0IGtleSB0byB0aGUgcmVzdCBmb3JtYXQgb2JqZWN0IHRvIHNhdmUuXG4vLyBvcmlnaW5hbFBhcnNlT2JqZWN0IGlzIG9wdGlvbmFsLCB3ZSBvbmx5IG5lZWQgdGhhdCBmb3IgYmVmb3JlL2FmdGVyU2F2ZSBmdW5jdGlvbnNcbmV4cG9ydCBmdW5jdGlvbiBtYXliZVJ1blRyaWdnZXIoXG4gIHRyaWdnZXJUeXBlLFxuICBhdXRoLFxuICBwYXJzZU9iamVjdCxcbiAgb3JpZ2luYWxQYXJzZU9iamVjdCxcbiAgY29uZmlnLFxuICBjb250ZXh0XG4pIHtcbiAgaWYgKCFwYXJzZU9iamVjdCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe30pO1xuICB9XG4gIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgdmFyIHRyaWdnZXIgPSBnZXRUcmlnZ2VyKHBhcnNlT2JqZWN0LmNsYXNzTmFtZSwgdHJpZ2dlclR5cGUsIGNvbmZpZy5hcHBsaWNhdGlvbklkKTtcbiAgICBpZiAoIXRyaWdnZXIpIHsgcmV0dXJuIHJlc29sdmUoKTsgfVxuICAgIHZhciByZXF1ZXN0ID0gZ2V0UmVxdWVzdE9iamVjdChcbiAgICAgIHRyaWdnZXJUeXBlLFxuICAgICAgYXV0aCxcbiAgICAgIHBhcnNlT2JqZWN0LFxuICAgICAgb3JpZ2luYWxQYXJzZU9iamVjdCxcbiAgICAgIGNvbmZpZyxcbiAgICAgIGNvbnRleHRcbiAgICApO1xuICAgIHZhciB7IHN1Y2Nlc3MsIGVycm9yIH0gPSBnZXRSZXNwb25zZU9iamVjdChcbiAgICAgIHJlcXVlc3QsXG4gICAgICBvYmplY3QgPT4ge1xuICAgICAgICBsb2dUcmlnZ2VyU3VjY2Vzc0JlZm9yZUhvb2soXG4gICAgICAgICAgdHJpZ2dlclR5cGUsXG4gICAgICAgICAgcGFyc2VPYmplY3QuY2xhc3NOYW1lLFxuICAgICAgICAgIHBhcnNlT2JqZWN0LnRvSlNPTigpLFxuICAgICAgICAgIG9iamVjdCxcbiAgICAgICAgICBhdXRoLFxuICAgICAgICAgIHRyaWdnZXJUeXBlLnN0YXJ0c1dpdGgoJ2FmdGVyJylcbiAgICAgICAgICAgID8gY29uZmlnLmxvZ0xldmVscy50cmlnZ2VyQWZ0ZXJcbiAgICAgICAgICAgIDogY29uZmlnLmxvZ0xldmVscy50cmlnZ2VyQmVmb3JlU3VjY2Vzc1xuICAgICAgICApO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdHJpZ2dlclR5cGUgPT09IFR5cGVzLmJlZm9yZVNhdmUgfHxcbiAgICAgICAgICB0cmlnZ2VyVHlwZSA9PT0gVHlwZXMuYWZ0ZXJTYXZlIHx8XG4gICAgICAgICAgdHJpZ2dlclR5cGUgPT09IFR5cGVzLmJlZm9yZURlbGV0ZSB8fFxuICAgICAgICAgIHRyaWdnZXJUeXBlID09PSBUeXBlcy5hZnRlckRlbGV0ZVxuICAgICAgICApIHtcbiAgICAgICAgICBPYmplY3QuYXNzaWduKGNvbnRleHQsIHJlcXVlc3QuY29udGV4dCk7XG4gICAgICAgIH1cbiAgICAgICAgcmVzb2x2ZShvYmplY3QpO1xuICAgICAgfSxcbiAgICAgIGVycm9yID0+IHtcbiAgICAgICAgbG9nVHJpZ2dlckVycm9yQmVmb3JlSG9vayhcbiAgICAgICAgICB0cmlnZ2VyVHlwZSxcbiAgICAgICAgICBwYXJzZU9iamVjdC5jbGFzc05hbWUsXG4gICAgICAgICAgcGFyc2VPYmplY3QudG9KU09OKCksXG4gICAgICAgICAgYXV0aCxcbiAgICAgICAgICBlcnJvcixcbiAgICAgICAgICBjb25maWcubG9nTGV2ZWxzLnRyaWdnZXJCZWZvcmVFcnJvclxuICAgICAgICApO1xuICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBBZnRlclNhdmUgYW5kIGFmdGVyRGVsZXRlIHRyaWdnZXJzIGNhbiByZXR1cm4gYSBwcm9taXNlLCB3aGljaCBpZiB0aGV5XG4gICAgLy8gZG8sIG5lZWRzIHRvIGJlIHJlc29sdmVkIGJlZm9yZSB0aGlzIHByb21pc2UgaXMgcmVzb2x2ZWQsXG4gICAgLy8gc28gdHJpZ2dlciBleGVjdXRpb24gaXMgc3luY2VkIHdpdGggUmVzdFdyaXRlLmV4ZWN1dGUoKSBjYWxsLlxuICAgIC8vIElmIHRyaWdnZXJzIGRvIG5vdCByZXR1cm4gYSBwcm9taXNlLCB0aGV5IGNhbiBydW4gYXN5bmMgY29kZSBwYXJhbGxlbFxuICAgIC8vIHRvIHRoZSBSZXN0V3JpdGUuZXhlY3V0ZSgpIGNhbGwuXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiBtYXliZVJ1blZhbGlkYXRvcihyZXF1ZXN0LCBgJHt0cmlnZ2VyVHlwZX0uJHtwYXJzZU9iamVjdC5jbGFzc05hbWV9YCwgYXV0aCk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICBpZiAocmVxdWVzdC5za2lwV2l0aE1hc3RlcktleSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwcm9taXNlID0gdHJpZ2dlcihyZXF1ZXN0KTtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHRyaWdnZXJUeXBlID09PSBUeXBlcy5hZnRlclNhdmUgfHxcbiAgICAgICAgICB0cmlnZ2VyVHlwZSA9PT0gVHlwZXMuYWZ0ZXJEZWxldGUgfHxcbiAgICAgICAgICB0cmlnZ2VyVHlwZSA9PT0gVHlwZXMuYWZ0ZXJMb2dpblxuICAgICAgICApIHtcbiAgICAgICAgICBsb2dUcmlnZ2VyQWZ0ZXJIb29rKFxuICAgICAgICAgICAgdHJpZ2dlclR5cGUsXG4gICAgICAgICAgICBwYXJzZU9iamVjdC5jbGFzc05hbWUsXG4gICAgICAgICAgICBwYXJzZU9iamVjdC50b0pTT04oKSxcbiAgICAgICAgICAgIGF1dGgsXG4gICAgICAgICAgICBjb25maWcubG9nTGV2ZWxzLnRyaWdnZXJBZnRlclxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gYmVmb3JlU2F2ZSBpcyBleHBlY3RlZCB0byByZXR1cm4gbnVsbCAobm90aGluZylcbiAgICAgICAgaWYgKHRyaWdnZXJUeXBlID09PSBUeXBlcy5iZWZvcmVTYXZlKSB7XG4gICAgICAgICAgaWYgKHByb21pc2UgJiYgdHlwZW9mIHByb21pc2UudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbihyZXNwb25zZSA9PiB7XG4gICAgICAgICAgICAgIC8vIHJlc3BvbnNlLm9iamVjdCBtYXkgY29tZSBmcm9tIGV4cHJlc3Mgcm91dGluZyBiZWZvcmUgaG9va1xuICAgICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2Uub2JqZWN0KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc3BvbnNlO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgICB9KVxuICAgICAgLnRoZW4oc3VjY2VzcywgZXJyb3IpO1xuICB9KTtcbn1cblxuLy8gQ29udmVydHMgYSBSRVNULWZvcm1hdCBvYmplY3QgdG8gYSBQYXJzZS5PYmplY3Rcbi8vIGRhdGEgaXMgZWl0aGVyIGNsYXNzTmFtZSBvciBhbiBvYmplY3RcbmV4cG9ydCBmdW5jdGlvbiBpbmZsYXRlKGRhdGEsIHJlc3RPYmplY3QpIHtcbiAgdmFyIGNvcHkgPSB0eXBlb2YgZGF0YSA9PSAnb2JqZWN0JyA/IGRhdGEgOiB7IGNsYXNzTmFtZTogZGF0YSB9O1xuICBmb3IgKHZhciBrZXkgaW4gcmVzdE9iamVjdCkge1xuICAgIGNvcHlba2V5XSA9IHJlc3RPYmplY3Rba2V5XTtcbiAgfVxuICByZXR1cm4gUGFyc2UuT2JqZWN0LmZyb21KU09OKGNvcHkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyhkYXRhLCBhcHBsaWNhdGlvbklkID0gUGFyc2UuYXBwbGljYXRpb25JZCkge1xuICBpZiAoIV90cmlnZ2VyU3RvcmUgfHwgIV90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gfHwgIV90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uTGl2ZVF1ZXJ5KSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uTGl2ZVF1ZXJ5LmZvckVhY2goaGFuZGxlciA9PiBoYW5kbGVyKGRhdGEpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFJlcXVlc3RGaWxlT2JqZWN0KHRyaWdnZXJUeXBlLCBhdXRoLCBmaWxlT2JqZWN0LCBjb25maWcpIHtcbiAgY29uc3QgcmVxdWVzdCA9IHtcbiAgICAuLi5maWxlT2JqZWN0LFxuICAgIHRyaWdnZXJOYW1lOiB0cmlnZ2VyVHlwZSxcbiAgICBtYXN0ZXI6IGZhbHNlLFxuICAgIGlzUmVhZE9ubHk6IGZhbHNlLFxuICAgIGxvZzogY29uZmlnLmxvZ2dlckNvbnRyb2xsZXIsXG4gICAgaGVhZGVyczogY29uZmlnLmhlYWRlcnMsXG4gICAgaXA6IGNvbmZpZy5pcCxcbiAgICBjb25maWcsXG4gIH07XG5cbiAgaWYgKCFhdXRoKSB7XG4gICAgcmV0dXJuIHJlcXVlc3Q7XG4gIH1cbiAgaWYgKGF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXF1ZXN0WydtYXN0ZXInXSA9IHRydWU7XG4gIH1cbiAgaWYgKGF1dGguaXNSZWFkT25seSkge1xuICAgIHJlcXVlc3RbJ2lzUmVhZE9ubHknXSA9IHRydWU7XG4gIH1cbiAgaWYgKGF1dGgudXNlcikge1xuICAgIHJlcXVlc3RbJ3VzZXInXSA9IGF1dGgudXNlcjtcbiAgfVxuICBpZiAoYXV0aC5pbnN0YWxsYXRpb25JZCkge1xuICAgIHJlcXVlc3RbJ2luc3RhbGxhdGlvbklkJ10gPSBhdXRoLmluc3RhbGxhdGlvbklkO1xuICB9XG4gIHJldHVybiByZXF1ZXN0O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWF5YmVSdW5GaWxlVHJpZ2dlcih0cmlnZ2VyVHlwZSwgZmlsZU9iamVjdCwgY29uZmlnLCBhdXRoKSB7XG4gIGNvbnN0IEZpbGVDbGFzc05hbWUgPSBnZXRDbGFzc05hbWUoUGFyc2UuRmlsZSk7XG4gIGNvbnN0IGZpbGVUcmlnZ2VyID0gZ2V0VHJpZ2dlcihGaWxlQ2xhc3NOYW1lLCB0cmlnZ2VyVHlwZSwgY29uZmlnLmFwcGxpY2F0aW9uSWQpO1xuICBpZiAodHlwZW9mIGZpbGVUcmlnZ2VyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBnZXRSZXF1ZXN0RmlsZU9iamVjdCh0cmlnZ2VyVHlwZSwgYXV0aCwgZmlsZU9iamVjdCwgY29uZmlnKTtcbiAgICAgIGF3YWl0IG1heWJlUnVuVmFsaWRhdG9yKHJlcXVlc3QsIGAke3RyaWdnZXJUeXBlfS4ke0ZpbGVDbGFzc05hbWV9YCwgYXV0aCk7XG4gICAgICBpZiAocmVxdWVzdC5za2lwV2l0aE1hc3RlcktleSkge1xuICAgICAgICByZXR1cm4gZmlsZU9iamVjdDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZpbGVUcmlnZ2VyKHJlcXVlc3QpO1xuICAgICAgaWYgKHJlcXVlc3QuZm9yY2VEb3dubG9hZCkge1xuICAgICAgICBmaWxlT2JqZWN0LmZvcmNlRG93bmxvYWQgPSB0cnVlO1xuICAgICAgfVxuICAgICAgaWYgKHJlcXVlc3QucmVzcG9uc2VIZWFkZXJzKSB7XG4gICAgICAgIGZpbGVPYmplY3QucmVzcG9uc2VIZWFkZXJzID0gcmVxdWVzdC5yZXNwb25zZUhlYWRlcnM7XG4gICAgICB9XG4gICAgICBsb2dUcmlnZ2VyU3VjY2Vzc0JlZm9yZUhvb2soXG4gICAgICAgIHRyaWdnZXJUeXBlLFxuICAgICAgICAnUGFyc2UuRmlsZScsXG4gICAgICAgIHsgLi4uZmlsZU9iamVjdC5maWxlLnRvSlNPTigpLCBmaWxlU2l6ZTogZmlsZU9iamVjdC5maWxlU2l6ZSB9LFxuICAgICAgICByZXN1bHQsXG4gICAgICAgIGF1dGgsXG4gICAgICAgIGNvbmZpZy5sb2dMZXZlbHMudHJpZ2dlckJlZm9yZVN1Y2Nlc3NcbiAgICAgICk7XG4gICAgICByZXR1cm4gcmVzdWx0IHx8IGZpbGVPYmplY3Q7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ1RyaWdnZXJFcnJvckJlZm9yZUhvb2soXG4gICAgICAgIHRyaWdnZXJUeXBlLFxuICAgICAgICAnUGFyc2UuRmlsZScsXG4gICAgICAgIHsgLi4uZmlsZU9iamVjdC5maWxlLnRvSlNPTigpLCBmaWxlU2l6ZTogZmlsZU9iamVjdC5maWxlU2l6ZSB9LFxuICAgICAgICBhdXRoLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgY29uZmlnLmxvZ0xldmVscy50cmlnZ2VyQmVmb3JlRXJyb3JcbiAgICAgICk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZpbGVPYmplY3Q7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYXliZVJ1bkdsb2JhbENvbmZpZ1RyaWdnZXIodHJpZ2dlclR5cGUsIGF1dGgsIGNvbmZpZ09iamVjdCwgb3JpZ2luYWxDb25maWdPYmplY3QsIGNvbmZpZywgY29udGV4dCkge1xuICBjb25zdCBHbG9iYWxDb25maWdDbGFzc05hbWUgPSBnZXRDbGFzc05hbWUoUGFyc2UuQ29uZmlnKTtcbiAgY29uc3QgY29uZmlnVHJpZ2dlciA9IGdldFRyaWdnZXIoR2xvYmFsQ29uZmlnQ2xhc3NOYW1lLCB0cmlnZ2VyVHlwZSwgY29uZmlnLmFwcGxpY2F0aW9uSWQpO1xuICBpZiAodHlwZW9mIGNvbmZpZ1RyaWdnZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVxdWVzdCA9IGdldFJlcXVlc3RPYmplY3QodHJpZ2dlclR5cGUsIGF1dGgsIGNvbmZpZ09iamVjdCwgb3JpZ2luYWxDb25maWdPYmplY3QsIGNvbmZpZywgY29udGV4dCk7XG4gICAgICBhd2FpdCBtYXliZVJ1blZhbGlkYXRvcihyZXF1ZXN0LCBgJHt0cmlnZ2VyVHlwZX0uJHtHbG9iYWxDb25maWdDbGFzc05hbWV9YCwgYXV0aCk7XG4gICAgICBpZiAocmVxdWVzdC5za2lwV2l0aE1hc3RlcktleSkge1xuICAgICAgICByZXR1cm4gY29uZmlnT2JqZWN0O1xuICAgICAgfVxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY29uZmlnVHJpZ2dlcihyZXF1ZXN0KTtcbiAgICAgIGxvZ1RyaWdnZXJTdWNjZXNzQmVmb3JlSG9vayhcbiAgICAgICAgdHJpZ2dlclR5cGUsXG4gICAgICAgICdQYXJzZS5Db25maWcnLFxuICAgICAgICBjb25maWdPYmplY3QsXG4gICAgICAgIHJlc3VsdCxcbiAgICAgICAgYXV0aCxcbiAgICAgICAgY29uZmlnLmxvZ0xldmVscy50cmlnZ2VyQmVmb3JlU3VjY2Vzc1xuICAgICAgKTtcbiAgICAgIHJldHVybiByZXN1bHQgfHwgY29uZmlnT2JqZWN0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dUcmlnZ2VyRXJyb3JCZWZvcmVIb29rKFxuICAgICAgICB0cmlnZ2VyVHlwZSxcbiAgICAgICAgJ1BhcnNlLkNvbmZpZycsXG4gICAgICAgIGNvbmZpZ09iamVjdCxcbiAgICAgICAgYXV0aCxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGNvbmZpZy5sb2dMZXZlbHMudHJpZ2dlckJlZm9yZUVycm9yXG4gICAgICApO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG4gIHJldHVybiBjb25maWdPYmplY3Q7XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxJQUFBQSxLQUFBLEdBQUFDLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxPQUFBLEdBQUFELE9BQUE7QUFDQSxJQUFBRSxNQUFBLEdBQUFILHNCQUFBLENBQUFDLE9BQUE7QUFBNEIsU0FBQUQsdUJBQUFJLENBQUEsV0FBQUEsQ0FBQSxJQUFBQSxDQUFBLENBQUFDLFVBQUEsR0FBQUQsQ0FBQSxLQUFBRSxPQUFBLEVBQUFGLENBQUE7QUFINUI7O0FBS08sTUFBTUcsS0FBSyxHQUFBQyxPQUFBLENBQUFELEtBQUEsR0FBRztFQUNuQkUsV0FBVyxFQUFFLGFBQWE7RUFDMUJDLFVBQVUsRUFBRSxZQUFZO0VBQ3hCQyxXQUFXLEVBQUUsYUFBYTtFQUMxQkMsMEJBQTBCLEVBQUUsNEJBQTRCO0VBQ3hEQyxVQUFVLEVBQUUsWUFBWTtFQUN4QkMsU0FBUyxFQUFFLFdBQVc7RUFDdEJDLFlBQVksRUFBRSxjQUFjO0VBQzVCQyxXQUFXLEVBQUUsYUFBYTtFQUMxQkMsVUFBVSxFQUFFLFlBQVk7RUFDeEJDLFNBQVMsRUFBRSxXQUFXO0VBQ3RCQyxhQUFhLEVBQUUsZUFBZTtFQUM5QkMsZUFBZSxFQUFFLGlCQUFpQjtFQUNsQ0MsVUFBVSxFQUFFO0FBQ2QsQ0FBQztBQUVELE1BQU1DLGdCQUFnQixHQUFHLFVBQVU7O0FBRW5DO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVNDLFdBQVdBLENBQUEsRUFBRztFQUNyQixPQUFPQyxNQUFNLENBQUNDLE1BQU0sQ0FBQyxJQUFJ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