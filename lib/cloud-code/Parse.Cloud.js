"use strict";

var _node = require("parse/node");
var triggers = _interopRequireWildcard(require("../triggers"));
var _middlewares = require("../middlewares");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
const Config = require('../Config');
function isParseObjectConstructor(object) {
  return typeof object === 'function' && Object.prototype.hasOwnProperty.call(object, 'className');
}
function validateValidator(validator) {
  if (!validator || typeof validator === 'function') {
    return;
  }
  const fieldOptions = {
    type: ['Any'],
    constant: [Boolean],
    default: ['Any'],
    options: [Array, 'function', 'Any'],
    required: [Boolean],
    error: [String]
  };
  const allowedKeys = {
    requireUser: [Boolean],
    requireAnyUserRoles: [Array, 'function'],
    requireAllUserRoles: [Array, 'function'],
    requireMaster: [Boolean],
    validateMasterKey: [Boolean],
    skipWithMasterKey: [Boolean],
    requireUserKeys: [Array, Object],
    fields: [Array, Object],
    rateLimit: [Object]
  };
  const getType = fn => {
    if (Array.isArray(fn)) {
      return 'array';
    }
    if (fn === 'Any' || fn === 'function') {
      return fn;
    }
    const type = typeof fn;
    if (typeof fn === 'function') {
      const match = fn && fn.toString().match(/^\s*function (\w+)/);
      return (match ? match[1] : 'function').toLowerCase();
    }
    return type;
  };
  const checkKey = (key, data, validatorParam) => {
    const parameter = data[key];
    if (!parameter) {
      throw `${key} is not a supported parameter for Cloud Function validations.`;
    }
    const types = parameter.map(type => getType(type));
    const type = getType(validatorParam);
    if (!types.includes(type) && !types.includes('Any')) {
      throw `Invalid type for Cloud Function validation key ${key}. Expected ${types.join('|')}, actual ${type}`;
    }
  };
  for (const key in validator) {
    checkKey(key, allowedKeys, validator[key]);
    if (key === 'fields' || key === 'requireUserKeys') {
      const values = validator[key];
      if (Array.isArray(values)) {
        continue;
      }
      for (const value in values) {
        const data = values[value];
        for (const subKey in data) {
          checkKey(subKey, fieldOptions, data[subKey]);
        }
      }
    }
  }
}
const getRoute = parseClass => {
  const route = {
    _User: 'users',
    _Session: 'sessions',
    '@File': 'files',
    '@Config': 'config'
  }[parseClass] || 'classes';
  if (parseClass === '@File') {
    return `/${route}{/*id}`;
  }
  if (parseClass === '@Config') {
    return `/${route}`;
  }
  return `/${route}/${parseClass}{/*id}`;
};
/** @namespace
 * @name Parse
 * @description The Parse SDK.
 *  see [api docs](https://docs.parseplatform.org/js/api) and [guide](https://docs.parseplatform.org/js/guide)
 */

/** @namespace
 * @name Parse.Cloud
 * @memberof Parse
 * @description The Parse Cloud Code SDK.
 */

var ParseCloud = {};
/**
 * Defines a Cloud Function.
 *
 * **Available in Cloud Code only.**
 *
 * **Traditional Style:**
 * ```
 * Parse.Cloud.define('functionName', (request) => {
 *   // code here
 *   return result;
 * }, (request) => {
 *   // validation code here
 * });
 *
 * Parse.Cloud.define('functionName', (request) => {
 *   // code here
 *   return result;
 * }, { ...validationObject });
 * ```
 *
 * **Express Style with Custom HTTP Status Codes:**
 * ```
 * Parse.Cloud.define('functionName', (request, response) => {
 *   // Set custom HTTP status code and send response
 *   response.status(201).success({ message: 'Created' });
 * });
 *
 * Parse.Cloud.define('unauthorizedFunction', (request, response) => {
 *   if (!request.user) {
 *     response.status(401).error('Unauthorized');
 *   } else {
 *     response.success({ data: 'OK' });
 *   }
 * });
 *
 * Parse.Cloud.define('withCustomHeaders', (request, response) => {
 *   response.header('X-Custom-Header', 'value').success({ data: 'OK' });
 * });
 *
 * Parse.Cloud.define('errorFunction', (request, response) => {
 *   response.error('Something went wrong');
 * });
 * ```
 *
 * @static
 * @memberof Parse.Cloud
 * @param {String} name The name of the Cloud Function
 * @param {Function} data The Cloud Function to register. This function can be an async function and should take one parameter a {@link Parse.Cloud.FunctionRequest}, or two parameters (request, response) for Express-style functions where response is a {@link Parse.Cloud.FunctionResponse}.
 * @param {(Object|Function)} validator An optional function to help validating cloud code. This function can be an async function and should take one parameter a {@link Parse.Cloud.FunctionRequest}, or a {@link Parse.Cloud.ValidatorObject}.
 */
ParseCloud.define = function (functionName, handler, validationHandler) {
  validateValidator(validationHandler);
  triggers.addFunction(functionName, handler, validationHandler, _node.Parse.applicationId);
  if (validationHandler && validationHandler.rateLimit) {
    (0, _middlewares.addRateLimit)({
      requestPath: `/functions/${functionName}`,
      ...validationHandler.rateLimit
    }, _node.Parse.applicationId, true);
  }
};

/**
 * Defines a Background Job.
 *
 * **Available in Cloud Code only.**
 *
 * @method job
 * @name Parse.Cloud.job
 * @param {String} name The name of the Background Job
 * @param {Function} func The Background Job to register. This function can be async should take a single parameters a {@link Parse.Cloud.JobRequest}
 *
 */
ParseCloud.job = function (functionName, handler) {
  triggers.addJob(functionName, handler, _node.Parse.applicationId);
};

/**
 *
 * Registers a before save function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use beforeSave for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User} or {@link Parse.File}), you should pass the class itself and not the String for arg1.
 *
 * ```
 * Parse.Cloud.beforeSave('MyCustomClass', (request) => {
 *   // code here
 * }, (request) => {
 *   // validation code here
 * });
 *
 * Parse.Cloud.beforeSave(Parse.User, (request) => {
 *   // code here
 * }, { ...validationObject })
 * ```
 *
 * @method beforeSave
 * @name Parse.Cloud.beforeSave
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the after save function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run before a save. This function can be async and should take one parameter a {@link Parse.Cloud.TriggerRequest};
 * @param {(Object|Function)} validator An optional function to help validating cloud code. This function can be an async function and should take one parameter a {@link Parse.Cloud.TriggerRequest}, or a {@link Parse.Cloud.ValidatorObject}.
 */
ParseCloud.beforeSave = function (parseClass, handler, validationHandler) {
  const className = triggers.getClassName(parseClass);
  validateValidator(validationHandler);
  triggers.addTrigger(triggers.Types.beforeSave, className, handler, _node.Parse.applicationId, validationHandler);
  if (validationHandler && validationHandler.rateLimit) {
    (0, _middlewares.addRateLimit)({
      requestPath: getRoute(className),
      requestMethods: ['POST', 'PUT'],
      ...validationHandler.rateLimit
    }, _node.Parse.applicationId, true);
  }
};

/**
 * Registers a before delete function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use beforeDelete for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User} or {@link Parse.File}), you should pass the class itself and not the String for arg1.
 * ```
 * Parse.Cloud.beforeDelete('MyCustomClass', (request) => {
 *   // code here
 * }, (request) => {
 *   // validation code here
 * });
 *
 * Parse.Cloud.beforeDelete(Parse.User, (request) => {
 *   // code here
 * }, { ...validationObject })
 *```
 *
 * @method beforeDelete
 * @name Parse.Cloud.beforeDelete
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the before delete function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run before a delete. This function can be async and should take one parameter, a {@link Parse.Cloud.TriggerRequest}.
 * @param {(Object|Function)} validator An optional function to help validating cloud code. This function can be an async function and should take one parameter a {@link Parse.Cloud.TriggerRequest}, or a {@link Parse.Cloud.ValidatorObject}.
 */
ParseCloud.beforeDelete = function (parseClass, handler, validationHandler) {
  const className = triggers.getClassName(parseClass);
  validateValidator(validationHandler);
  triggers.addTrigger(triggers.Types.beforeDelete, className, handler, _node.Parse.applicationId, validationHandler);
  if (validationHandler && validationHandler.rateLimit) {
    (0, _middlewares.addRateLimit)({
      requestPath: getRoute(className),
      requestMethods: 'DELETE',
      ...validationHandler.rateLimit
    }, _node.Parse.applicationId, true);
  }
};

/**
 *
 * Registers the before login function.
 *
 * **Available in Cloud Code only.**
 *
 * This function provides further control
 * in validating a login attempt. Specifically,
 * it is triggered after a user enters
 * correct credentials (or other valid authData),
 * but prior to a session being generated.
 *
 * ```
 * Parse.Cloud.beforeLogin((request) => {
 *   // code here
 * })
 *
 * ```
 *
 * @method beforeLogin
 * @name Parse.Cloud.beforeLogin
 * @param {Function} func The function to run before a login. This function can be async and should take one parameter a {@link Parse.Cloud.TriggerRequest};
 */
ParseCloud.beforeLogin = function (handler, validationHandler) {
  let className = '_User';
  if (typeof handler === 'string' || isParseObjectConstructor(handler)) {
    // validation will occur downstream, this is to maintain internal
    // code consistency with the other hook types.
    className = triggers.getClassName(handler);
    handler = arguments[1];
    validationHandler = arguments.length >= 2 ? arguments[2] : null;
  }
  triggers.addTrigger(triggers.Types.beforeLogin, className, handler, _node.Parse.applicationId);
  if (validationHandler && validationHandler.rateLimit) {
    (0, _middlewares.addRateLimit)({
      requestPath: `/login`,
      requestMethods: ['POST', 'GET'],
      ...validationHandler.rateLimit
    }, _node.Parse.applicationId, true);
  }
};

/**
 *
 * Registers the after login function.
 *
 * **Available in Cloud Code only.**
 *
 * This function is triggered after a user logs in successfully,
 * and after a _Session object has been created.
 *
 * ```
 * Parse.Cloud.afterLogin((request) => {
 *   // code here
 * });
 * ```
 *
 * @method afterLogin
 * @name Parse.Cloud.afterLogin
 * @param {Function} func The function to run after a login. This function can be async and should take one parameter a {@link Parse.Cloud.TriggerRequest};
 */
ParseCloud.afterLogin = function (handler) {
  let className = '_User';
  if (typeof handler === 'string' || isParseObjectConstructor(handler)) {
    // validation will occur downstream, this is to maintain internal
    // code consistency with the other hook types.
    className = triggers.getClassName(handler);
    handler = arguments[1];
  }
  triggers.addTrigger(triggers.Types.afterLogin, className, handler, _node.Parse.applicationId);
};

/**
 *
 * Registers the after logout function.
 *
 * **Available in Cloud Code only.**
 *
 * This function is triggered after a user logs out.
 *
 * ```
 * Parse.Cloud.afterLogout((request) => {
 *   // code here
 * });
 * ```
 *
 * @method afterLogout
 * @name Parse.Cloud.afterLogout
 * @param {Function} func The function to run after a logout. This function can be async and should take one parameter a {@link Parse.Cloud.TriggerRequest};
 */
ParseCloud.afterLogout = function (handler) {
  let className = '_Session';
  if (typeof handler === 'string' || isParseObjectConstructor(handler)) {
    // validation will occur downstream, this is to maintain internal
    // code consistency with the other hook types.
    className = triggers.getClassName(handler);
    handler = arguments[1];
  }
  triggers.addTrigger(triggers.Types.afterLogout, className, handler, _node.Parse.applicationId);
};

/**
 * Registers the before password reset request function.
 *
 * **Available in Cloud Code only.**
 *
 * This function provides control in validating a password reset request
 * before the reset email is sent. It is triggered after the user is found
 * by email, but before the reset token is generated and the email is sent.
 *
 * Code example:
 *
 * ```
 * Parse.Cloud.beforePasswordResetRequest(request => {
 *   if (request.object.get('banned')) {
 *     throw new Parse.Error(Parse.Error.EMAIL_NOT_FOUND, 'User is banned.');
 *   }
 * });
 * ```
 *
 * @method beforePasswordResetRequest
 * @name Parse.Cloud.beforePasswordResetRequest
 * @param {Function} func The function to run before a password reset request. This function can be async and should take one parameter a {@link Parse.Cloud.TriggerRequest};
 */
ParseCloud.beforePasswordResetRequest = function (handler, validationHandler) {
  let className = '_User';
  if (typeof handler === 'string' || isParseObjectConstructor(handler)) {
    // validation will occur downstream, this is to maintain internal
    // code consistency with the other hook types.
    className = triggers.getClassName(handler);
    handler = arguments[1];
    validationHandler = arguments.length >= 2 ? arguments[2] : null;
  }
  triggers.addTrigger(triggers.Types.beforePasswordResetRequest, className, handler, _node.Parse.applicationId);
  if (validationHandler && validationHandler.rateLimit) {
    (0, _middlewares.addRateLimit)({
      requestPath: `/requestPasswordReset`,
      requestMethods: 'POST',
      ...validationHandler.rateLimit
    }, _node.Parse.applicationId, true);
  }
};

/**
 * Registers an after save function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use afterSave for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User} or {@link Parse.File}), you should pass the class itself and not the String for arg1.
 *
 * ```
 * Parse.Cloud.afterSave('MyCustomClass', async function(request) {
 *   // code here
 * }, (request) => {
 *   // validation code here
 * });
 *
 * Parse.Cloud.afterSave(Parse.User, async function(request) {
 *   // code here
 * }, { ...validationObject });
 * ```
 *
 * @method afterSave
 * @name Parse.Cloud.afterSave
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the after save function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run after a save. This function can be an async function and should take just one parameter, {@link Parse.Cloud.TriggerRequest}.
 * @param {(Object|Function)} validator An optional function to help validating cloud code. This function can be an async function and should take one parameter a {@link Parse.Cloud.TriggerRequest}, or a {@link Parse.Cloud.ValidatorObject}.
 */
ParseCloud.afterSave = function (parseClass, handler, validationHandler) {
  const className = triggers.getClassName(parseClass);
  validateValidator(validationHandler);
  triggers.addTrigger(triggers.Types.afterSave, className, handler, _node.Parse.applicationId, validationHandler);
};

/**
 * Registers an after delete function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use afterDelete for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User} or {@link Parse.File}), you should pass the class itself and not the String for arg1.
 * ```
 * Parse.Cloud.afterDelete('MyCustomClass', async (request) => {
 *   // code here
 * }, (request) => {
 *   // validation code here
 * });
 *
 * Parse.Cloud.afterDelete(Parse.User, async (request) => {
 *   // code here
 * }, { ...validationObject });
 *```
 *
 * @method afterDelete
 * @name Parse.Cloud.afterDelete
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the after delete function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run after a delete. This function can be async and should take just one parameter, {@link Parse.Cloud.TriggerRequest}.
 * @param {(Object|Function)} validator An optional function to help validating cloud code. This function can be an async function and should take one parameter a {@link Parse.Cloud.TriggerRequest}, or a {@link Parse.Cloud.ValidatorObject}.
 */
ParseCloud.afterDelete = function (parseClass, handler, validationHandler) {
  const className = triggers.getClassName(parseClass);
  validateValidator(validationHandler);
  triggers.addTrigger(triggers.Types.afterDelete, className, handler, _node.Parse.applicationId, validationHandler);
};

/**
 * Registers a before find function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use beforeFind for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User} or {@link Parse.File}), you should pass the class itself and not the String for arg1.
 * ```
 * Parse.Cloud.beforeFind('MyCustomClass', async (request) => {
 *   // code here
 * }, (request) => {
 *   // validation code here
 * });
 *
 * Parse.Cloud.beforeFind(Parse.User, async (request) => {
 *   // code here
 * }, { ...validationObject });
 *```
 *
 * @method beforeFind
 * @name Parse.Cloud.beforeFind
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the before find function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run before a find. This function can be async and should take just one parameter, {@link Parse.Cloud.BeforeFindRequest}.
 * @param {(Object|Function)} validator An optional function to help validating cloud code. This function can be an async function and should take one parameter a {@link Parse.Cloud.BeforeFindRequest}, or a {@link Parse.Cloud.ValidatorObject}.
 */
ParseCloud.beforeFind = function (parseClass, handler, validationHandler) {
  const className = triggers.getClassName(parseClass);
  validateValidator(validationHandler);
  triggers.addTrigger(triggers.Types.beforeFind, className, handler, _node.Parse.applicationId, validationHandler);
  if (validationHandler && validationHandler.rateLimit) {
    (0, _middlewares.addRateLimit)({
      requestPath: getRoute(className),
      requestMethods: 'GET',
      ...validationHandler.rateLimit
    }, _node.Parse.applicationId, true);
  }
};

/**
 * Registers an after find function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use afterFind for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User} or {@link Parse.File}), you should pass the class itself and not the String for arg1.
 * ```
 * Parse.Cloud.afterFind('MyCustomClass', async (request) => {
 *   // code here
 * }, (request) => {
 *   // validation code here
 * });
 *
 * Parse.Cloud.afterFind(Parse.User, async (request) => {
 *   // code here
 * }, { ...validationObject });
 *```
 *
 * @method afterFind
 * @name Parse.Cloud.afterFind
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the after find function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run before a find. This function can be async and should take just one parameter, {@link Parse.Cloud.AfterFindRequest}.
 * @param {(Object|Function)} validator An optional function to help validating cloud code. This function can be an async function and should take one parameter a {@link Parse.Cloud.AfterFindRequest}, or a {@link Parse.Cloud.ValidatorObject}.
 */
ParseCloud.afterFind = function (parseClass, handler, validationHandler) {
  const className = triggers.getClassName(parseClass);
  validateValidator(validationHandler);
  triggers.addTrigger(triggers.Types.afterFind, className, handler, _node.Parse.applicationId, validationHandler);
};

/**
 * Registers a before live query server connect function.
 *
 * **Available in Cloud Code only.**
 *
 * ```
 * Parse.Cloud.beforeConnect(async (request) => {
 *   // code here
 * }, (request) => {
 *   // validation code here
 * });
 *
 * Parse.Cloud.beforeConnect(async (request) => {
 *   // code here
 * }, { ...validationObject });
 *```
 *
 * @method beforeConnect
 * @name Parse.Cloud.beforeConnect
 * @param {Function} func The function to before connection is made. This function can be async and should take just one parameter, {@link Parse.Cloud.ConnectTriggerRequest}.
 * @param {(Object|Function)} validator An optional function to help validating cloud code. This function can be an async function and should take one parameter a {@link Parse.Cloud.ConnectTriggerRequest}, or a {@link Parse.Cloud.ValidatorObject}.
 */
ParseCloud.beforeConnect = function (handler, validationHandler) {
  validateValidator(validationHandler);
  triggers.addConnectTrigger(triggers.Types.beforeConnect, handler, _node.Parse.applicationId, validationHandler);
};

/**
 * Sends an email through the Parse Server mail adapter.
 *
 * **Available in Cloud Code only.**
 * **Requires a mail adapter to be configured for Parse Server.**
 *
 * ```
 * Parse.Cloud.sendEmail({
 *   from: 'Example <test@example.com>',
 *   to: 'contact@example.com',
 *   subject: 'Test email',
 *   text: 'This email is a test.'
 * });
 *```
 *
 * @method sendEmail
 * @name Parse.Cloud.sendEmail
 * @param {Object} data The object of the mail data to send.
 */
ParseCloud.sendEmail = function (data) {
  const config = Config.get(_node.Parse.applicationId);
  const emailAdapter = config.userController.adapter;
  if (!emailAdapter) {
    config.loggerController.error('Failed to send email because no mail adapter is configured for Parse Server.');
    return;
  }
  return emailAdapter.sendMail(data);
};

/**
 * Registers a before live query subscription function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use beforeSubscribe for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User} or {@link Parse.File}), you should pass the class itself and not the String for arg1.
 * ```
 * Parse.Cloud.beforeSubscribe('MyCustomClass', (request) => {
 *   // code here
 * }, (request) => {
 *   // validation code here
 * });
 *
 * Parse.Cloud.beforeSubscribe(Parse.User, (request) => {
 *   // code here
 * }, { ...validationObject });
 *```
 *
 * @method beforeSubscribe
 * @name Parse.Cloud.beforeSubscribe
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the before subscription function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run before a subscription. This function can be async and should take one parameter, a {@link Parse.Cloud.TriggerRequest}.
 * @param {(Object|Function)} validator An optional function to help validating cloud code. This function can be an async function and should take one parameter a {@link Parse.Cloud.TriggerRequest}, or a {@link Parse.Cloud.ValidatorObject}.
 */
ParseCloud.beforeSubscribe = function (parseClass, handler, validationHandler) {
  validateValidator(validationHandler);
  const className = triggers.getClassName(parseClass);
  triggers.addTrigger(triggers.Types.beforeSubscribe, className, handler, _node.Parse.applicationId, validationHandler);
};
ParseCloud.onLiveQueryEvent = function (handler) {
  triggers.addLiveQueryEventHandler(handler, _node.Parse.applicationId);
};

/**
 * Registers an after live query server event function.
 *
 * **Available in Cloud Code only.**
 *
 * ```
 * Parse.Cloud.afterLiveQueryEvent('MyCustomClass', (request) => {
 *   // code here
 * }, (request) => {
 *   // validation code here
 * });
 *
 * Parse.Cloud.afterLiveQueryEvent('MyCustomClass', (request) => {
 *   // code here
 * }, { ...validationObject });
 *```
 *
 * @method afterLiveQueryEvent
 * @name Parse.Cloud.afterLiveQueryEvent
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the after live query event function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run after a live query event. This function can be async and should take one parameter, a {@link Parse.Cloud.LiveQueryEventTrigger}.
 * @param {(Object|Function)} validator An optional function to help validating cloud code. This function can be an async function and should take one parameter a {@link Parse.Cloud.LiveQueryEventTrigger}, or a {@link Parse.Cloud.ValidatorObject}.
 */
ParseCloud.afterLiveQueryEvent = function (parseClass, handler, validationHandler) {
  const className = triggers.getClassName(parseClass);
  validateValidator(validationHandler);
  triggers.addTrigger(triggers.Types.afterEvent, className, handler, _node.Parse.applicationId, validationHandler);
};
ParseCloud._removeAllHooks = () => {
  triggers._unregisterAll();
  const config = Config.get(_node.Parse.applicationId);
  config?.unregisterRateLimiters();
};
ParseCloud.useMasterKey = () => {
  // eslint-disable-next-line
  console.warn('Parse.Cloud.useMasterKey is deprecated (and has no effect anymore) on parse-server, please refer to the cloud code migration notes: http://docs.parseplatform.org/parse-server/guide/#master-key-must-be-passed-explicitly');
};
module.exports = ParseCloud;

/**
 * @interface Parse.Cloud.TriggerRequest
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} master If true, means the master key or the read-only master key was used.
 * @property {Boolean} isReadOnly If true, means the read-only master key was used. This is a subset of `master`, so `master` will also be true. Use `master && !isReadOnly` to check for full master key access.
 * @property {Boolean} isChallenge If true, means the current request is originally triggered by an auth challenge.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {Parse.Object} object The object triggering the hook.
 * @property {String} ip The IP address of the client making the request. To ensure retrieving the correct IP address, set the Parse Server option `trustProxy: true` if Parse Server runs behind a proxy server, for example behind a load balancer.
 * @property {Object} headers The original HTTP headers for the request.
 * @property {String} triggerName The name of the trigger (`beforeSave`, `afterSave`, ...)
 * @property {Object} log The current logger inside Parse Server.
 * @property {Parse.Object} original If set, the object, as currently stored.
 * @property {Object} config The Parse Server config.
 */

/**
 * @interface Parse.Cloud.FileTriggerRequest
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} master If true, means the master key or the read-only master key was used.
 * @property {Boolean} isReadOnly If true, means the read-only master key was used. This is a subset of `master`, so `master` will also be true. Use `master && !isReadOnly` to check for full master key access.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {Parse.File} file The file that triggered the hook.
 * @property {Integer} fileSize The size of the file in bytes.
 * @property {Integer} contentLength The value from Content-Length header
 * @property {String} ip The IP address of the client making the request.
 * @property {Object} headers The original HTTP headers for the request.
 * @property {String} triggerName The name of the trigger (`beforeSave`, `afterSave`)
 * @property {Object} log The current logger inside Parse Server.
 * @property {Object} config The Parse Server config.
 * @property {Boolean} forceDownload (afterFind only) If set to `true`, the file response will include a `Content-Disposition: attachment` header, prompting the browser to download the file instead of displaying it inline.
 * @property {Object} responseHeaders (afterFind only) The headers that will be set on the file response. By default contains `{ 'X-Content-Type-Options': 'nosniff' }`. Modify this object to add, change, or remove response headers.
 */

/**
 * @interface Parse.Cloud.ConnectTriggerRequest
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} useMasterKey If true, means the master key was used.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {Integer} clients The number of clients connected.
 * @property {Integer} subscriptions The number of subscriptions connected.
 * @property {String} sessionToken If set, the session of the user that made the request.
 */

/**
 * @interface Parse.Cloud.LiveQueryEventTrigger
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} useMasterKey If true, means the master key was used.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {String} sessionToken If set, the session of the user that made the request.
 * @property {String} event The live query event that triggered the request.
 * @property {Parse.Object} object The object triggering the hook.
 * @property {Parse.Object} original If set, the object, as currently stored.
 * @property {Integer} clients The number of clients connected.
 * @property {Integer} subscriptions The number of subscriptions connected.
 * @property {Boolean} sendEvent If the LiveQuery event should be sent to the client. Set to false to prevent LiveQuery from pushing to the client.
 */

/**
 * @interface Parse.Cloud.BeforeFindRequest
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} master If true, means the master key or the read-only master key was used.
 * @property {Boolean} isReadOnly If true, means the read-only master key was used. This is a subset of `master`, so `master` will also be true. Use `master && !isReadOnly` to check for full master key access.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {Parse.Query} query The query triggering the hook.
 * @property {String} ip The IP address of the client making the request.
 * @property {Object} headers The original HTTP headers for the request.
 * @property {String} triggerName The name of the trigger (`beforeSave`, `afterSave`, ...)
 * @property {Object} log The current logger inside Parse Server.
 * @property {Boolean} isGet wether the query a `get` or a `find`
 * @property {Object} config The Parse Server config.
 */

/**
 * @interface Parse.Cloud.AfterFindRequest
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} master If true, means the master key or the read-only master key was used.
 * @property {Boolean} isReadOnly If true, means the read-only master key was used. This is a subset of `master`, so `master` will also be true. Use `master && !isReadOnly` to check for full master key access.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {Parse.Query} query The query triggering the hook.
 * @property {Array<Parse.Object>} results The results the query yielded.
 * @property {String} ip The IP address of the client making the request.
 * @property {Object} headers The original HTTP headers for the request.
 * @property {String} triggerName The name of the trigger (`beforeSave`, `afterSave`, ...)
 * @property {Object} log The current logger inside Parse Server.
 * @property {Object} config The Parse Server config.
 */

/**
 * @interface Parse.Cloud.FunctionRequest
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} master If true, means the master key or the read-only master key was used.
 * @property {Boolean} isReadOnly If true, means the read-only master key was used. This is a subset of `master`, so `master` will also be true. Use `master && !isReadOnly` to check for full master key access.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {Object} params The params passed to the cloud function. For JSON requests, values
 * retain their JSON types. For multipart/form-data requests, text fields are strings and file
 * fields are objects with `{ filename: string, contentType: string, data: Buffer }`.
 * @property {String} ip The IP address of the client making the request.
 * @property {Object} headers The original HTTP headers for the request.
 * @property {Object} log The current logger inside Parse Server.
 * @property {String} functionName The name of the cloud function.
 * @property {Object} context The context of the cloud function call.
 * @property {Object} config The Parse Server config.
 */

/**
 * @interface Parse.Cloud.FunctionResponse
 * @property {function} success Call this function to return a successful response with an optional result. Usage: `response.success(result)`
 * @property {function} error Call this function to return an error response with an error message. Usage: `response.error(message)`
 * @property {function} status Call this function to set a custom HTTP status code for the response. Returns the response object for chaining. Usage: `response.status(code).success(result)` or `response.status(code).error(message)`
 * @property {function} header Call this function to set a custom HTTP header for the response. Returns the response object for chaining. Usage: `response.header('X-Custom-Header', 'value').success(result)`
 */

/**
 * @interface Parse.Cloud.JobRequest
 * @property {Object} params The params passed to the background job.
 * @property {function} message If message is called with a string argument, will update the current message to be stored in the job status.
 * @property {Object} config The Parse Server config.
 */

/**
 * @interface Parse.Cloud.ValidatorObject
 * @property {Boolean} requireUser whether the cloud trigger requires a user.
 * @property {Boolean} requireMaster whether the cloud trigger requires a master key.
 * @property {Boolean} validateMasterKey whether the validator should run if masterKey is provided. Defaults to false.
 * @property {Boolean} skipWithMasterKey whether the cloud code function should be ignored using a masterKey.
 *
 * @property {Array<String>|Object} requireUserKeys If set, keys required on request.user to make the request.
 * @property {String} requireUserKeys.field If requireUserKeys is an object, name of field to validate on request user
 * @property {Array|function|Any} requireUserKeys.field.options array of options that the field can be, function to validate field, or single value. Throw an error if value is invalid.
 * @property {String} requireUserKeys.field.error custom error message if field is invalid.
 *
 * @property {Array<String>|function}requireAnyUserRoles If set, request.user has to be part of at least one roles name to make the request. If set to a function, function must return role names.
 * @property {Array<String>|function}requireAllUserRoles If set, request.user has to be part all roles name to make the request. If set to a function, function must return role names.
 *
 * @property {Object|Array<String>} fields if an array of strings, validator will look for keys in request.params, and throw if not provided. If Object, fields to validate. If the trigger is a cloud function, `request.params` will be validated, otherwise `request.object`.
 * @property {String} fields.field name of field to validate.
 * @property {String} fields.field.type expected type of data for field.
 * @property {Boolean} fields.field.constant whether the field can be modified on the object.
 * @property {Any} fields.field.default default value if field is `null`, or initial value `constant` is `true`.
 * @property {Array|function|Any} fields.field.options array of options that the field can be, function to validate field, or single value. Throw an error if value is invalid.
 * @property {String} fields.field.error custom error message if field is invalid.
 */
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbm9kZSIsInJlcXVpcmUiLCJ0cmlnZ2VycyIsIl9pbnRlcm9wUmVxdWlyZVdpbGRjYXJkIiwiX21pZGRsZXdhcmVzIiwiZSIsInQiLCJXZWFrTWFwIiwiciIsIm4iLCJfX2VzTW9kdWxlIiwibyIsImkiLCJmIiwiX19wcm90b19fIiwiZGVmYXVsdCIsImhhcyIsImdldCIsInNldCIsImhhc093blByb3BlcnR5IiwiY2FsbCIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwiQ29uZmlnIiwiaXNQYXJzZU9iamVjdENvbnN0cnVjdG9yIiwib2JqZWN0IiwicHJvdG90eXBlIiwidmFsaWRhdGVWYWxpZGF0b3IiLCJ2YWxpZGF0b3IiLCJmaWVsZE9wdGlvbnMiLCJ0eXBlIiwiY29uc3RhbnQiLCJCb29sZWFuIiwib3B0aW9ucyIsIkFycmF5IiwicmVxdWlyZWQiLCJlcnJvciIsIlN0cmluZyIsImFsbG93ZWRLZXlzIiwicmVxdWlyZVVzZXIiLCJyZXF1aXJlQW55VXNlclJvbGVzIiwicmVxdWlyZUFsbFVzZXJSb2xlcyIsInJlcXVpcmVNYXN0ZXIiLCJ2YWxpZGF0ZU1hc3RlcktleSIsInNraXBXaXRoTWFzdGVyS2V5IiwicmVxdWlyZVVzZXJLZXlzIiwiZmllbGRzIiwicmF0ZUxpbWl0IiwiZ2V0VHlwZSIsImZuIiwiaXNBcnJheSIsIm1hdGNoIiwidG9TdHJpbmciLCJ0b0xvd2VyQ2FzZSIsImNoZWNrS2V5Iiwia2V5IiwiZGF0YSIsInZhbGlkYXRvclBhcmFtIiwicGFyYW1ldGVyIiwidHlwZXMiLCJtYXAiLCJpbmNsdWRlcyIsImpvaW4iLCJ2YWx1ZXMiLCJ2YWx1ZSIsInN1YktleSIsImdldFJvdXRlIiwicGFyc2VDbGFzcyIsInJvdXRlIiwiX1VzZXIiLCJfU2Vzc2lvbiIsIlBhcnNlQ2xvdWQiLCJkZWZpbmUiLCJmdW5jdGlvbk5hbWUiLCJoYW5kbGVyIiwidmFsaWRhdGlvbkhhbmRsZXIiLCJhZGRGdW5jdGlvbiIsIlBhcnNlIiwiYXBwbGljYXRpb25JZCIsImFkZFJhdGVMaW1pdCIsInJlcXVlc3RQYXRoIiwiam9iIiwiYWRkSm9iIiwiYmVmb3JlU2F2ZSIsImNsYXNzTmFtZSIsImdldENsYXNzTmFtZSIsImFkZFRyaWdnZXIiLCJUeXBlcyIsInJlcXVlc3RNZXRob2RzIiwiYmVmb3JlRGVsZXRlIiwiYmVmb3JlTG9naW4iLCJhcmd1bWVudHMiLCJsZW5ndGgiLCJhZnRlckxvZ2luIiwiYWZ0ZXJMb2dvdXQiLCJiZWZvcmVQYXNzd29yZFJlc2V0UmVxdWVzdCIsImFmdGVyU2F2ZSIsImFmdGVyRGVsZXRlIiwiYmVmb3JlRmluZCIsImFmdGVyRmluZCIsImJlZm9yZUNvbm5lY3QiLCJhZGRDb25uZWN0VHJpZ2dlciIsInNlbmRFbWFpbCIsImNvbmZpZyIsImVtYWlsQWRhcHRlciIsInVzZXJDb250cm9sbGVyIiwiYWRhcHRlciIsImxvZ2dlckNvbnRyb2xsZXIiLCJzZW5kTWFpbCIsImJlZm9yZVN1YnNjcmliZSIsIm9uTGl2ZVF1ZXJ5RXZlbnQiLCJhZGRMaXZlUXVlcnlFdmVudEhhbmRsZXIiLCJhZnRlckxpdmVRdWVyeUV2ZW50IiwiYWZ0ZXJFdmVudCIsIl9yZW1vdmVBbGxIb29rcyIsIl91bnJlZ2lzdGVyQWxsIiwidW5yZWdpc3RlclJhdGVMaW1pdGVycyIsInVzZU1hc3RlcktleSIsImNvbnNvbGUiLCJ3YXJuIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jbG91ZC1jb2RlL1BhcnNlLkNsb3VkLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFBhcnNlIH0gZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgKiBhcyB0cmlnZ2VycyBmcm9tICcuLi90cmlnZ2Vycyc7XG5pbXBvcnQgeyBhZGRSYXRlTGltaXQgfSBmcm9tICcuLi9taWRkbGV3YXJlcyc7XG5jb25zdCBDb25maWcgPSByZXF1aXJlKCcuLi9Db25maWcnKTtcblxuZnVuY3Rpb24gaXNQYXJzZU9iamVjdENvbnN0cnVjdG9yKG9iamVjdCkge1xuICByZXR1cm4gdHlwZW9mIG9iamVjdCA9PT0gJ2Z1bmN0aW9uJyAmJiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCAnY2xhc3NOYW1lJyk7XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlVmFsaWRhdG9yKHZhbGlkYXRvcikge1xuICBpZiAoIXZhbGlkYXRvciB8fCB0eXBlb2YgdmFsaWRhdG9yID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZpZWxkT3B0aW9ucyA9IHtcbiAgICB0eXBlOiBbJ0FueSddLFxuICAgIGNvbnN0YW50OiBbQm9vbGVhbl0sXG4gICAgZGVmYXVsdDogWydBbnknXSxcbiAgICBvcHRpb25zOiBbQXJyYXksICdmdW5jdGlvbicsICdBbnknXSxcbiAgICByZXF1aXJlZDogW0Jvb2xlYW5dLFxuICAgIGVycm9yOiBbU3RyaW5nXSxcbiAgfTtcbiAgY29uc3QgYWxsb3dlZEtleXMgPSB7XG4gICAgcmVxdWlyZVVzZXI6IFtCb29sZWFuXSxcbiAgICByZXF1aXJlQW55VXNlclJvbGVzOiBbQXJyYXksICdmdW5jdGlvbiddLFxuICAgIHJlcXVpcmVBbGxVc2VyUm9sZXM6IFtBcnJheSwgJ2Z1bmN0aW9uJ10sXG4gICAgcmVxdWlyZU1hc3RlcjogW0Jvb2xlYW5dLFxuICAgIHZhbGlkYXRlTWFzdGVyS2V5OiBbQm9vbGVhbl0sXG4gICAgc2tpcFdpdGhNYXN0ZXJLZXk6IFtCb29sZWFuXSxcbiAgICByZXF1aXJlVXNlcktleXM6IFtBcnJheSwgT2JqZWN0XSxcbiAgICBmaWVsZHM6IFtBcnJheSwgT2JqZWN0XSxcbiAgICByYXRlTGltaXQ6IFtPYmplY3RdLFxuICB9O1xuICBjb25zdCBnZXRUeXBlID0gZm4gPT4ge1xuICAgIGlmIChBcnJheS5pc0FycmF5KGZuKSkge1xuICAgICAgcmV0dXJuICdhcnJheSc7XG4gICAgfVxuICAgIGlmIChmbiA9PT0gJ0FueScgfHwgZm4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBmbjtcbiAgICB9XG4gICAgY29uc3QgdHlwZSA9IHR5cGVvZiBmbjtcbiAgICBpZiAodHlwZW9mIGZuID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjb25zdCBtYXRjaCA9IGZuICYmIGZuLnRvU3RyaW5nKCkubWF0Y2goL15cXHMqZnVuY3Rpb24gKFxcdyspLyk7XG4gICAgICByZXR1cm4gKG1hdGNoID8gbWF0Y2hbMV0gOiAnZnVuY3Rpb24nKS50b0xvd2VyQ2FzZSgpO1xuICAgIH1cbiAgICByZXR1cm4gdHlwZTtcbiAgfTtcbiAgY29uc3QgY2hlY2tLZXkgPSAoa2V5LCBkYXRhLCB2YWxpZGF0b3JQYXJhbSkgPT4ge1xuICAgIGNvbnN0IHBhcmFtZXRlciA9IGRhdGFba2V5XTtcbiAgICBpZiAoIXBhcmFtZXRlcikge1xuICAgICAgdGhyb3cgYCR7a2V5fSBpcyBub3QgYSBzdXBwb3J0ZWQgcGFyYW1ldGVyIGZvciBDbG91ZCBGdW5jdGlvbiB2YWxpZGF0aW9ucy5gO1xuICAgIH1cbiAgICBjb25zdCB0eXBlcyA9IHBhcmFtZXRlci5tYXAodHlwZSA9PiBnZXRUeXBlKHR5cGUpKTtcbiAgICBjb25zdCB0eXBlID0gZ2V0VHlwZSh2YWxpZGF0b3JQYXJhbSk7XG4gICAgaWYgKCF0eXBlcy5pbmNsdWRlcyh0eXBlKSAmJiAhdHlwZXMuaW5jbHVkZXMoJ0FueScpKSB7XG4gICAgICB0aHJvdyBgSW52YWxpZCB0eXBlIGZvciBDbG91ZCBGdW5jdGlvbiB2YWxpZGF0aW9uIGtleSAke2tleX0uIEV4cGVjdGVkICR7dHlwZXMuam9pbihcbiAgICAgICAgJ3wnXG4gICAgICApfSwgYWN0dWFsICR7dHlwZX1gO1xuICAgIH1cbiAgfTtcbiAgZm9yIChjb25zdCBrZXkgaW4gdmFsaWRhdG9yKSB7XG4gICAgY2hlY2tLZXkoa2V5LCBhbGxvd2VkS2V5cywgdmFsaWRhdG9yW2tleV0pO1xuICAgIGlmIChrZXkgPT09ICdmaWVsZHMnIHx8IGtleSA9PT0gJ3JlcXVpcmVVc2VyS2V5cycpIHtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IHZhbGlkYXRvcltrZXldO1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWVzKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgdmFsdWUgaW4gdmFsdWVzKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSB2YWx1ZXNbdmFsdWVdO1xuICAgICAgICBmb3IgKGNvbnN0IHN1YktleSBpbiBkYXRhKSB7XG4gICAgICAgICAgY2hlY2tLZXkoc3ViS2V5LCBmaWVsZE9wdGlvbnMsIGRhdGFbc3ViS2V5XSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbmNvbnN0IGdldFJvdXRlID0gcGFyc2VDbGFzcyA9PiB7XG4gIGNvbnN0IHJvdXRlID1cbiAgICB7XG4gICAgICBfVXNlcjogJ3VzZXJzJyxcbiAgICAgIF9TZXNzaW9uOiAnc2Vzc2lvbnMnLFxuICAgICAgJ0BGaWxlJzogJ2ZpbGVzJyxcbiAgICAgICdAQ29uZmlnJyA6ICdjb25maWcnLFxuICAgIH1bcGFyc2VDbGFzc10gfHwgJ2NsYXNzZXMnO1xuICBpZiAocGFyc2VDbGFzcyA9PT0gJ0BGaWxlJykge1xuICAgIHJldHVybiBgLyR7cm91dGV9ey8qaWR9YDtcbiAgfVxuICBpZiAocGFyc2VDbGFzcyA9PT0gJ0BDb25maWcnKSB7XG4gICAgcmV0dXJuIGAvJHtyb3V0ZX1gO1xuICB9XG4gIHJldHVybiBgLyR7cm91dGV9LyR7cGFyc2VDbGFzc317LyppZH1gO1xufTtcbi8qKiBAbmFtZXNwYWNlXG4gKiBAbmFtZSBQYXJzZVxuICogQGRlc2NyaXB0aW9uIFRoZSBQYXJzZSBTREsuXG4gKiAgc2VlIFthcGkgZG9jc10oaHR0cHM6Ly9kb2NzLnBhcnNlcGxhdGZvcm0ub3JnL2pzL2FwaSkgYW5kIFtndWlkZV0oaHR0cHM6Ly9kb2NzLnBhcnNlcGxhdGZvcm0ub3JnL2pzL2d1aWRlKVxuICovXG5cbi8qKiBAbmFtZXNwYWNlXG4gKiBAbmFtZSBQYXJzZS5DbG91ZFxuICogQG1lbWJlcm9mIFBhcnNlXG4gKiBAZGVzY3JpcHRpb24gVGhlIFBhcnNlIENsb3VkIENvZGUgU0RLLlxuICovXG5cbnZhciBQYXJzZUNsb3VkID0ge307XG4vKipcbiAqIERlZmluZXMgYSBDbG91ZCBGdW5jdGlvbi5cbiAqXG4gKiAqKkF2YWlsYWJsZSBpbiBDbG91ZCBDb2RlIG9ubHkuKipcbiAqXG4gKiAqKlRyYWRpdGlvbmFsIFN0eWxlOioqXG4gKiBgYGBcbiAqIFBhcnNlLkNsb3VkLmRlZmluZSgnZnVuY3Rpb25OYW1lJywgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiAgIHJldHVybiByZXN1bHQ7XG4gKiB9LCAocmVxdWVzdCkgPT4ge1xuICogICAvLyB2YWxpZGF0aW9uIGNvZGUgaGVyZVxuICogfSk7XG4gKlxuICogUGFyc2UuQ2xvdWQuZGVmaW5lKCdmdW5jdGlvbk5hbWUnLCAocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqICAgcmV0dXJuIHJlc3VsdDtcbiAqIH0sIHsgLi4udmFsaWRhdGlvbk9iamVjdCB9KTtcbiAqIGBgYFxuICpcbiAqICoqRXhwcmVzcyBTdHlsZSB3aXRoIEN1c3RvbSBIVFRQIFN0YXR1cyBDb2RlczoqKlxuICogYGBgXG4gKiBQYXJzZS5DbG91ZC5kZWZpbmUoJ2Z1bmN0aW9uTmFtZScsIChyZXF1ZXN0LCByZXNwb25zZSkgPT4ge1xuICogICAvLyBTZXQgY3VzdG9tIEhUVFAgc3RhdHVzIGNvZGUgYW5kIHNlbmQgcmVzcG9uc2VcbiAqICAgcmVzcG9uc2Uuc3RhdHVzKDIwMSkuc3VjY2Vzcyh7IG1lc3NhZ2U6ICdDcmVhdGVkJyB9KTtcbiAqIH0pO1xuICpcbiAqIFBhcnNlLkNsb3VkLmRlZmluZSgndW5hdXRob3JpemVkRnVuY3Rpb24nLCAocmVxdWVzdCwgcmVzcG9uc2UpID0+IHtcbiAqICAgaWYgKCFyZXF1ZXN0LnVzZXIpIHtcbiAqICAgICByZXNwb25zZS5zdGF0dXMoNDAxKS5lcnJvcignVW5hdXRob3JpemVkJyk7XG4gKiAgIH0gZWxzZSB7XG4gKiAgICAgcmVzcG9uc2Uuc3VjY2Vzcyh7IGRhdGE6ICdPSycgfSk7XG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIFBhcnNlLkNsb3VkLmRlZmluZSgnd2l0aEN1c3RvbUhlYWRlcnMnLCAocmVxdWVzdCwgcmVzcG9uc2UpID0+IHtcbiAqICAgcmVzcG9uc2UuaGVhZGVyKCdYLUN1c3RvbS1IZWFkZXInLCAndmFsdWUnKS5zdWNjZXNzKHsgZGF0YTogJ09LJyB9KTtcbiAqIH0pO1xuICpcbiAqIFBhcnNlLkNsb3VkLmRlZmluZSgnZXJyb3JGdW5jdGlvbicsIChyZXF1ZXN0LCByZXNwb25zZSkgPT4ge1xuICogICByZXNwb25zZS5lcnJvcignU29tZXRoaW5nIHdlbnQgd3JvbmcnKTtcbiAqIH0pO1xuICogYGBgXG4gKlxuICogQHN0YXRpY1xuICogQG1lbWJlcm9mIFBhcnNlLkNsb3VkXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBUaGUgbmFtZSBvZiB0aGUgQ2xvdWQgRnVuY3Rpb25cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGRhdGEgVGhlIENsb3VkIEZ1bmN0aW9uIHRvIHJlZ2lzdGVyLiBUaGlzIGZ1bmN0aW9uIGNhbiBiZSBhbiBhc3luYyBmdW5jdGlvbiBhbmQgc2hvdWxkIHRha2Ugb25lIHBhcmFtZXRlciBhIHtAbGluayBQYXJzZS5DbG91ZC5GdW5jdGlvblJlcXVlc3R9LCBvciB0d28gcGFyYW1ldGVycyAocmVxdWVzdCwgcmVzcG9uc2UpIGZvciBFeHByZXNzLXN0eWxlIGZ1bmN0aW9ucyB3aGVyZSByZXNwb25zZSBpcyBhIHtAbGluayBQYXJzZS5DbG91ZC5GdW5jdGlvblJlc3BvbnNlfS5cbiAqIEBwYXJhbSB7KE9iamVjdHxGdW5jdGlvbil9IHZhbGlkYXRvciBBbiBvcHRpb25hbCBmdW5jdGlvbiB0byBoZWxwIHZhbGlkYXRpbmcgY2xvdWQgY29kZS4gVGhpcyBmdW5jdGlvbiBjYW4gYmUgYW4gYXN5bmMgZnVuY3Rpb24gYW5kIHNob3VsZCB0YWtlIG9uZSBwYXJhbWV0ZXIgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuRnVuY3Rpb25SZXF1ZXN0fSwgb3IgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuVmFsaWRhdG9yT2JqZWN0fS5cbiAqL1xuUGFyc2VDbG91ZC5kZWZpbmUgPSBmdW5jdGlvbiAoZnVuY3Rpb25OYW1lLCBoYW5kbGVyLCB2YWxpZGF0aW9uSGFuZGxlcikge1xuICB2YWxpZGF0ZVZhbGlkYXRvcih2YWxpZGF0aW9uSGFuZGxlcik7XG4gIHRyaWdnZXJzLmFkZEZ1bmN0aW9uKGZ1bmN0aW9uTmFtZSwgaGFuZGxlciwgdmFsaWRhdGlvbkhhbmRsZXIsIFBhcnNlLmFwcGxpY2F0aW9uSWQpO1xuICBpZiAodmFsaWRhdGlvbkhhbmRsZXIgJiYgdmFsaWRhdGlvbkhhbmRsZXIucmF0ZUxpbWl0KSB7XG4gICAgYWRkUmF0ZUxpbWl0KFxuICAgICAgeyByZXF1ZXN0UGF0aDogYC9mdW5jdGlvbnMvJHtmdW5jdGlvbk5hbWV9YCwgLi4udmFsaWRhdGlvbkhhbmRsZXIucmF0ZUxpbWl0IH0sXG4gICAgICBQYXJzZS5hcHBsaWNhdGlvbklkLFxuICAgICAgdHJ1ZVxuICAgICk7XG4gIH1cbn07XG5cbi8qKlxuICogRGVmaW5lcyBhIEJhY2tncm91bmQgSm9iLlxuICpcbiAqICoqQXZhaWxhYmxlIGluIENsb3VkIENvZGUgb25seS4qKlxuICpcbiAqIEBtZXRob2Qgam9iXG4gKiBAbmFtZSBQYXJzZS5DbG91ZC5qb2JcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIFRoZSBuYW1lIG9mIHRoZSBCYWNrZ3JvdW5kIEpvYlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgQmFja2dyb3VuZCBKb2IgdG8gcmVnaXN0ZXIuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIHNob3VsZCB0YWtlIGEgc2luZ2xlIHBhcmFtZXRlcnMgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuSm9iUmVxdWVzdH1cbiAqXG4gKi9cblBhcnNlQ2xvdWQuam9iID0gZnVuY3Rpb24gKGZ1bmN0aW9uTmFtZSwgaGFuZGxlcikge1xuICB0cmlnZ2Vycy5hZGRKb2IoZnVuY3Rpb25OYW1lLCBoYW5kbGVyLCBQYXJzZS5hcHBsaWNhdGlvbklkKTtcbn07XG5cbi8qKlxuICpcbiAqIFJlZ2lzdGVycyBhIGJlZm9yZSBzYXZlIGZ1bmN0aW9uLlxuICpcbiAqICoqQXZhaWxhYmxlIGluIENsb3VkIENvZGUgb25seS4qKlxuICpcbiAqIElmIHlvdSB3YW50IHRvIHVzZSBiZWZvcmVTYXZlIGZvciBhIHByZWRlZmluZWQgY2xhc3MgaW4gdGhlIFBhcnNlIEphdmFTY3JpcHQgU0RLIChlLmcuIHtAbGluayBQYXJzZS5Vc2VyfSBvciB7QGxpbmsgUGFyc2UuRmlsZX0pLCB5b3Ugc2hvdWxkIHBhc3MgdGhlIGNsYXNzIGl0c2VsZiBhbmQgbm90IHRoZSBTdHJpbmcgZm9yIGFyZzEuXG4gKlxuICogYGBgXG4gKiBQYXJzZS5DbG91ZC5iZWZvcmVTYXZlKCdNeUN1c3RvbUNsYXNzJywgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9LCAocmVxdWVzdCkgPT4ge1xuICogICAvLyB2YWxpZGF0aW9uIGNvZGUgaGVyZVxuICogfSk7XG4gKlxuICogUGFyc2UuQ2xvdWQuYmVmb3JlU2F2ZShQYXJzZS5Vc2VyLCAocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0sIHsgLi4udmFsaWRhdGlvbk9iamVjdCB9KVxuICogYGBgXG4gKlxuICogQG1ldGhvZCBiZWZvcmVTYXZlXG4gKiBAbmFtZSBQYXJzZS5DbG91ZC5iZWZvcmVTYXZlXG4gKiBAcGFyYW0geyhTdHJpbmd8UGFyc2UuT2JqZWN0KX0gYXJnMSBUaGUgUGFyc2UuT2JqZWN0IHN1YmNsYXNzIHRvIHJlZ2lzdGVyIHRoZSBhZnRlciBzYXZlIGZ1bmN0aW9uIGZvci4gVGhpcyBjYW4gaW5zdGVhZCBiZSBhIFN0cmluZyB0aGF0IGlzIHRoZSBjbGFzc05hbWUgb2YgdGhlIHN1YmNsYXNzLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgZnVuY3Rpb24gdG8gcnVuIGJlZm9yZSBhIHNhdmUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBvbmUgcGFyYW1ldGVyIGEge0BsaW5rIFBhcnNlLkNsb3VkLlRyaWdnZXJSZXF1ZXN0fTtcbiAqIEBwYXJhbSB7KE9iamVjdHxGdW5jdGlvbil9IHZhbGlkYXRvciBBbiBvcHRpb25hbCBmdW5jdGlvbiB0byBoZWxwIHZhbGlkYXRpbmcgY2xvdWQgY29kZS4gVGhpcyBmdW5jdGlvbiBjYW4gYmUgYW4gYXN5bmMgZnVuY3Rpb24gYW5kIHNob3VsZCB0YWtlIG9uZSBwYXJhbWV0ZXIgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuVHJpZ2dlclJlcXVlc3R9LCBvciBhIHtAbGluayBQYXJzZS5DbG91ZC5WYWxpZGF0b3JPYmplY3R9LlxuICovXG5QYXJzZUNsb3VkLmJlZm9yZVNhdmUgPSBmdW5jdGlvbiAocGFyc2VDbGFzcywgaGFuZGxlciwgdmFsaWRhdGlvbkhhbmRsZXIpIHtcbiAgY29uc3QgY2xhc3NOYW1lID0gdHJpZ2dlcnMuZ2V0Q2xhc3NOYW1lKHBhcnNlQ2xhc3MpO1xuICB2YWxpZGF0ZVZhbGlkYXRvcih2YWxpZGF0aW9uSGFuZGxlcik7XG4gIHRyaWdnZXJzLmFkZFRyaWdnZXIoXG4gICAgdHJpZ2dlcnMuVHlwZXMuYmVmb3JlU2F2ZSxcbiAgICBjbGFzc05hbWUsXG4gICAgaGFuZGxlcixcbiAgICBQYXJzZS5hcHBsaWNhdGlvbklkLFxuICAgIHZhbGlkYXRpb25IYW5kbGVyXG4gICk7XG4gIGlmICh2YWxpZGF0aW9uSGFuZGxlciAmJiB2YWxpZGF0aW9uSGFuZGxlci5yYXRlTGltaXQpIHtcbiAgICBhZGRSYXRlTGltaXQoXG4gICAgICB7XG4gICAgICAgIHJlcXVlc3RQYXRoOiBnZXRSb3V0ZShjbGFzc05hbWUpLFxuICAgICAgICByZXF1ZXN0TWV0aG9kczogWydQT1NUJywgJ1BVVCddLFxuICAgICAgICAuLi52YWxpZGF0aW9uSGFuZGxlci5yYXRlTGltaXQsXG4gICAgICB9LFxuICAgICAgUGFyc2UuYXBwbGljYXRpb25JZCxcbiAgICAgIHRydWVcbiAgICApO1xuICB9XG59O1xuXG4vKipcbiAqIFJlZ2lzdGVycyBhIGJlZm9yZSBkZWxldGUgZnVuY3Rpb24uXG4gKlxuICogKipBdmFpbGFibGUgaW4gQ2xvdWQgQ29kZSBvbmx5LioqXG4gKlxuICogSWYgeW91IHdhbnQgdG8gdXNlIGJlZm9yZURlbGV0ZSBmb3IgYSBwcmVkZWZpbmVkIGNsYXNzIGluIHRoZSBQYXJzZSBKYXZhU2NyaXB0IFNESyAoZS5nLiB7QGxpbmsgUGFyc2UuVXNlcn0gb3Ige0BsaW5rIFBhcnNlLkZpbGV9KSwgeW91IHNob3VsZCBwYXNzIHRoZSBjbGFzcyBpdHNlbGYgYW5kIG5vdCB0aGUgU3RyaW5nIGZvciBhcmcxLlxuICogYGBgXG4gKiBQYXJzZS5DbG91ZC5iZWZvcmVEZWxldGUoJ015Q3VzdG9tQ2xhc3MnLCAocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0sIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIHZhbGlkYXRpb24gY29kZSBoZXJlXG4gKiB9KTtcbiAqXG4gKiBQYXJzZS5DbG91ZC5iZWZvcmVEZWxldGUoUGFyc2UuVXNlciwgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9LCB7IC4uLnZhbGlkYXRpb25PYmplY3QgfSlcbiAqYGBgXG4gKlxuICogQG1ldGhvZCBiZWZvcmVEZWxldGVcbiAqIEBuYW1lIFBhcnNlLkNsb3VkLmJlZm9yZURlbGV0ZVxuICogQHBhcmFtIHsoU3RyaW5nfFBhcnNlLk9iamVjdCl9IGFyZzEgVGhlIFBhcnNlLk9iamVjdCBzdWJjbGFzcyB0byByZWdpc3RlciB0aGUgYmVmb3JlIGRlbGV0ZSBmdW5jdGlvbiBmb3IuIFRoaXMgY2FuIGluc3RlYWQgYmUgYSBTdHJpbmcgdGhhdCBpcyB0aGUgY2xhc3NOYW1lIG9mIHRoZSBzdWJjbGFzcy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGZ1bmN0aW9uIHRvIHJ1biBiZWZvcmUgYSBkZWxldGUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBvbmUgcGFyYW1ldGVyLCBhIHtAbGluayBQYXJzZS5DbG91ZC5UcmlnZ2VyUmVxdWVzdH0uXG4gKiBAcGFyYW0geyhPYmplY3R8RnVuY3Rpb24pfSB2YWxpZGF0b3IgQW4gb3B0aW9uYWwgZnVuY3Rpb24gdG8gaGVscCB2YWxpZGF0aW5nIGNsb3VkIGNvZGUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFuIGFzeW5jIGZ1bmN0aW9uIGFuZCBzaG91bGQgdGFrZSBvbmUgcGFyYW1ldGVyIGEge0BsaW5rIFBhcnNlLkNsb3VkLlRyaWdnZXJSZXF1ZXN0fSwgb3IgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuVmFsaWRhdG9yT2JqZWN0fS5cbiAqL1xuUGFyc2VDbG91ZC5iZWZvcmVEZWxldGUgPSBmdW5jdGlvbiAocGFyc2VDbGFzcywgaGFuZGxlciwgdmFsaWRhdGlvbkhhbmRsZXIpIHtcbiAgY29uc3QgY2xhc3NOYW1lID0gdHJpZ2dlcnMuZ2V0Q2xhc3NOYW1lKHBhcnNlQ2xhc3MpO1xuICB2YWxpZGF0ZVZhbGlkYXRvcih2YWxpZGF0aW9uSGFuZGxlcik7XG4gIHRyaWdnZXJzLmFkZFRyaWdnZXIoXG4gICAgdHJpZ2dlcnMuVHlwZXMuYmVmb3JlRGVsZXRlLFxuICAgIGNsYXNzTmFtZSxcbiAgICBoYW5kbGVyLFxuICAgIFBhcnNlLmFwcGxpY2F0aW9uSWQsXG4gICAgdmFsaWRhdGlvbkhhbmRsZXJcbiAgKTtcbiAgaWYgKHZhbGlkYXRpb25IYW5kbGVyICYmIHZhbGlkYXRpb25IYW5kbGVyLnJhdGVMaW1pdCkge1xuICAgIGFkZFJhdGVMaW1pdChcbiAgICAgIHtcbiAgICAgICAgcmVxdWVzdFBhdGg6IGdldFJvdXRlKGNsYXNzTmFtZSksXG4gICAgICAgIHJlcXVlc3RNZXRob2RzOiAnREVMRVRFJyxcbiAgICAgICAgLi4udmFsaWRhdGlvbkhhbmRsZXIucmF0ZUxpbWl0LFxuICAgICAgfSxcbiAgICAgIFBhcnNlLmFwcGxpY2F0aW9uSWQsXG4gICAgICB0cnVlXG4gICAgKTtcbiAgfVxufTtcblxuLyoqXG4gKlxuICogUmVnaXN0ZXJzIHRoZSBiZWZvcmUgbG9naW4gZnVuY3Rpb24uXG4gKlxuICogKipBdmFpbGFibGUgaW4gQ2xvdWQgQ29kZSBvbmx5LioqXG4gKlxuICogVGhpcyBmdW5jdGlvbiBwcm92aWRlcyBmdXJ0aGVyIGNvbnRyb2xcbiAqIGluIHZhbGlkYXRpbmcgYSBsb2dpbiBhdHRlbXB0LiBTcGVjaWZpY2FsbHksXG4gKiBpdCBpcyB0cmlnZ2VyZWQgYWZ0ZXIgYSB1c2VyIGVudGVyc1xuICogY29ycmVjdCBjcmVkZW50aWFscyAob3Igb3RoZXIgdmFsaWQgYXV0aERhdGEpLFxuICogYnV0IHByaW9yIHRvIGEgc2Vzc2lvbiBiZWluZyBnZW5lcmF0ZWQuXG4gKlxuICogYGBgXG4gKiBQYXJzZS5DbG91ZC5iZWZvcmVMb2dpbigocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0pXG4gKlxuICogYGBgXG4gKlxuICogQG1ldGhvZCBiZWZvcmVMb2dpblxuICogQG5hbWUgUGFyc2UuQ2xvdWQuYmVmb3JlTG9naW5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGZ1bmN0aW9uIHRvIHJ1biBiZWZvcmUgYSBsb2dpbi4gVGhpcyBmdW5jdGlvbiBjYW4gYmUgYXN5bmMgYW5kIHNob3VsZCB0YWtlIG9uZSBwYXJhbWV0ZXIgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuVHJpZ2dlclJlcXVlc3R9O1xuICovXG5QYXJzZUNsb3VkLmJlZm9yZUxvZ2luID0gZnVuY3Rpb24gKGhhbmRsZXIsIHZhbGlkYXRpb25IYW5kbGVyKSB7XG4gIGxldCBjbGFzc05hbWUgPSAnX1VzZXInO1xuICBpZiAodHlwZW9mIGhhbmRsZXIgPT09ICdzdHJpbmcnIHx8IGlzUGFyc2VPYmplY3RDb25zdHJ1Y3RvcihoYW5kbGVyKSkge1xuICAgIC8vIHZhbGlkYXRpb24gd2lsbCBvY2N1ciBkb3duc3RyZWFtLCB0aGlzIGlzIHRvIG1haW50YWluIGludGVybmFsXG4gICAgLy8gY29kZSBjb25zaXN0ZW5jeSB3aXRoIHRoZSBvdGhlciBob29rIHR5cGVzLlxuICAgIGNsYXNzTmFtZSA9IHRyaWdnZXJzLmdldENsYXNzTmFtZShoYW5kbGVyKTtcbiAgICBoYW5kbGVyID0gYXJndW1lbnRzWzFdO1xuICAgIHZhbGlkYXRpb25IYW5kbGVyID0gYXJndW1lbnRzLmxlbmd0aCA+PSAyID8gYXJndW1lbnRzWzJdIDogbnVsbDtcbiAgfVxuICB0cmlnZ2Vycy5hZGRUcmlnZ2VyKHRyaWdnZXJzLlR5cGVzLmJlZm9yZUxvZ2luLCBjbGFzc05hbWUsIGhhbmRsZXIsIFBhcnNlLmFwcGxpY2F0aW9uSWQpO1xuICBpZiAodmFsaWRhdGlvbkhhbmRsZXIgJiYgdmFsaWRhdGlvbkhhbmRsZXIucmF0ZUxpbWl0KSB7XG4gICAgYWRkUmF0ZUxpbWl0KFxuICAgICAgeyByZXF1ZXN0UGF0aDogYC9sb2dpbmAsIHJlcXVlc3RNZXRob2RzOiBbJ1BPU1QnLCAnR0VUJ10sIC4uLnZhbGlkYXRpb25IYW5kbGVyLnJhdGVMaW1pdCB9LFxuICAgICAgUGFyc2UuYXBwbGljYXRpb25JZCxcbiAgICAgIHRydWVcbiAgICApO1xuICB9XG59O1xuXG4vKipcbiAqXG4gKiBSZWdpc3RlcnMgdGhlIGFmdGVyIGxvZ2luIGZ1bmN0aW9uLlxuICpcbiAqICoqQXZhaWxhYmxlIGluIENsb3VkIENvZGUgb25seS4qKlxuICpcbiAqIFRoaXMgZnVuY3Rpb24gaXMgdHJpZ2dlcmVkIGFmdGVyIGEgdXNlciBsb2dzIGluIHN1Y2Nlc3NmdWxseSxcbiAqIGFuZCBhZnRlciBhIF9TZXNzaW9uIG9iamVjdCBoYXMgYmVlbiBjcmVhdGVkLlxuICpcbiAqIGBgYFxuICogUGFyc2UuQ2xvdWQuYWZ0ZXJMb2dpbigocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0pO1xuICogYGBgXG4gKlxuICogQG1ldGhvZCBhZnRlckxvZ2luXG4gKiBAbmFtZSBQYXJzZS5DbG91ZC5hZnRlckxvZ2luXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jIFRoZSBmdW5jdGlvbiB0byBydW4gYWZ0ZXIgYSBsb2dpbi4gVGhpcyBmdW5jdGlvbiBjYW4gYmUgYXN5bmMgYW5kIHNob3VsZCB0YWtlIG9uZSBwYXJhbWV0ZXIgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuVHJpZ2dlclJlcXVlc3R9O1xuICovXG5QYXJzZUNsb3VkLmFmdGVyTG9naW4gPSBmdW5jdGlvbiAoaGFuZGxlcikge1xuICBsZXQgY2xhc3NOYW1lID0gJ19Vc2VyJztcbiAgaWYgKHR5cGVvZiBoYW5kbGVyID09PSAnc3RyaW5nJyB8fCBpc1BhcnNlT2JqZWN0Q29uc3RydWN0b3IoaGFuZGxlcikpIHtcbiAgICAvLyB2YWxpZGF0aW9uIHdpbGwgb2NjdXIgZG93bnN0cmVhbSwgdGhpcyBpcyB0byBtYWludGFpbiBpbnRlcm5hbFxuICAgIC8vIGNvZGUgY29uc2lzdGVuY3kgd2l0aCB0aGUgb3RoZXIgaG9vayB0eXBlcy5cbiAgICBjbGFzc05hbWUgPSB0cmlnZ2Vycy5nZXRDbGFzc05hbWUoaGFuZGxlcik7XG4gICAgaGFuZGxlciA9IGFyZ3VtZW50c1sxXTtcbiAgfVxuICB0cmlnZ2Vycy5hZGRUcmlnZ2VyKHRyaWdnZXJzLlR5cGVzLmFmdGVyTG9naW4sIGNsYXNzTmFtZSwgaGFuZGxlciwgUGFyc2UuYXBwbGljYXRpb25JZCk7XG59O1xuXG4vKipcbiAqXG4gKiBSZWdpc3RlcnMgdGhlIGFmdGVyIGxvZ291dCBmdW5jdGlvbi5cbiAqXG4gKiAqKkF2YWlsYWJsZSBpbiBDbG91ZCBDb2RlIG9ubHkuKipcbiAqXG4gKiBUaGlzIGZ1bmN0aW9uIGlzIHRyaWdnZXJlZCBhZnRlciBhIHVzZXIgbG9ncyBvdXQuXG4gKlxuICogYGBgXG4gKiBQYXJzZS5DbG91ZC5hZnRlckxvZ291dCgocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0pO1xuICogYGBgXG4gKlxuICogQG1ldGhvZCBhZnRlckxvZ291dFxuICogQG5hbWUgUGFyc2UuQ2xvdWQuYWZ0ZXJMb2dvdXRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGZ1bmN0aW9uIHRvIHJ1biBhZnRlciBhIGxvZ291dC4gVGhpcyBmdW5jdGlvbiBjYW4gYmUgYXN5bmMgYW5kIHNob3VsZCB0YWtlIG9uZSBwYXJhbWV0ZXIgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuVHJpZ2dlclJlcXVlc3R9O1xuICovXG5QYXJzZUNsb3VkLmFmdGVyTG9nb3V0ID0gZnVuY3Rpb24gKGhhbmRsZXIpIHtcbiAgbGV0IGNsYXNzTmFtZSA9ICdfU2Vzc2lvbic7XG4gIGlmICh0eXBlb2YgaGFuZGxlciA9PT0gJ3N0cmluZycgfHwgaXNQYXJzZU9iamVjdENvbnN0cnVjdG9yKGhhbmRsZXIpKSB7XG4gICAgLy8gdmFsaWRhdGlvbiB3aWxsIG9jY3VyIGRvd25zdHJlYW0sIHRoaXMgaXMgdG8gbWFpbnRhaW4gaW50ZXJuYWxcbiAgICAvLyBjb2RlIGNvbnNpc3RlbmN5IHdpdGggdGhlIG90aGVyIGhvb2sgdHlwZXMuXG4gICAgY2xhc3NOYW1lID0gdHJpZ2dlcnMuZ2V0Q2xhc3NOYW1lKGhhbmRsZXIpO1xuICAgIGhhbmRsZXIgPSBhcmd1bWVudHNbMV07XG4gIH1cbiAgdHJpZ2dlcnMuYWRkVHJpZ2dlcih0cmlnZ2Vycy5UeXBlcy5hZnRlckxvZ291dCwgY2xhc3NOYW1lLCBoYW5kbGVyLCBQYXJzZS5hcHBsaWNhdGlvbklkKTtcbn07XG5cbi8qKlxuICogUmVnaXN0ZXJzIHRoZSBiZWZvcmUgcGFzc3dvcmQgcmVzZXQgcmVxdWVzdCBmdW5jdGlvbi5cbiAqXG4gKiAqKkF2YWlsYWJsZSBpbiBDbG91ZCBDb2RlIG9ubHkuKipcbiAqXG4gKiBUaGlzIGZ1bmN0aW9uIHByb3ZpZGVzIGNvbnRyb2wgaW4gdmFsaWRhdGluZyBhIHBhc3N3b3JkIHJlc2V0IHJlcXVlc3RcbiAqIGJlZm9yZSB0aGUgcmVzZXQgZW1haWwgaXMgc2VudC4gSXQgaXMgdHJpZ2dlcmVkIGFmdGVyIHRoZSB1c2VyIGlzIGZvdW5kXG4gKiBieSBlbWFpbCwgYnV0IGJlZm9yZSB0aGUgcmVzZXQgdG9rZW4gaXMgZ2VuZXJhdGVkIGFuZCB0aGUgZW1haWwgaXMgc2VudC5cbiAqXG4gKiBDb2RlIGV4YW1wbGU6XG4gKlxuICogYGBgXG4gKiBQYXJzZS5DbG91ZC5iZWZvcmVQYXNzd29yZFJlc2V0UmVxdWVzdChyZXF1ZXN0ID0+IHtcbiAqICAgaWYgKHJlcXVlc3Qub2JqZWN0LmdldCgnYmFubmVkJykpIHtcbiAqICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRU1BSUxfTk9UX0ZPVU5ELCAnVXNlciBpcyBiYW5uZWQuJyk7XG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKlxuICogQG1ldGhvZCBiZWZvcmVQYXNzd29yZFJlc2V0UmVxdWVzdFxuICogQG5hbWUgUGFyc2UuQ2xvdWQuYmVmb3JlUGFzc3dvcmRSZXNldFJlcXVlc3RcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGZ1bmN0aW9uIHRvIHJ1biBiZWZvcmUgYSBwYXNzd29yZCByZXNldCByZXF1ZXN0LiBUaGlzIGZ1bmN0aW9uIGNhbiBiZSBhc3luYyBhbmQgc2hvdWxkIHRha2Ugb25lIHBhcmFtZXRlciBhIHtAbGluayBQYXJzZS5DbG91ZC5UcmlnZ2VyUmVxdWVzdH07XG4gKi9cblBhcnNlQ2xvdWQuYmVmb3JlUGFzc3dvcmRSZXNldFJlcXVlc3QgPSBmdW5jdGlvbiAoaGFuZGxlciwgdmFsaWRhdGlvbkhhbmRsZXIpIHtcbiAgbGV0IGNsYXNzTmFtZSA9ICdfVXNlcic7XG4gIGlmICh0eXBlb2YgaGFuZGxlciA9PT0gJ3N0cmluZycgfHwgaXNQYXJzZU9iamVjdENvbnN0cnVjdG9yKGhhbmRsZXIpKSB7XG4gICAgLy8gdmFsaWRhdGlvbiB3aWxsIG9jY3VyIGRvd25zdHJlYW0sIHRoaXMgaXMgdG8gbWFpbnRhaW4gaW50ZXJuYWxcbiAgICAvLyBjb2RlIGNvbnNpc3RlbmN5IHdpdGggdGhlIG90aGVyIGhvb2sgdHlwZXMuXG4gICAgY2xhc3NOYW1lID0gdHJpZ2dlcnMuZ2V0Q2xhc3NOYW1lKGhhbmRsZXIpO1xuICAgIGhhbmRsZXIgPSBhcmd1bWVudHNbMV07XG4gICAgdmFsaWRhdGlvbkhhbmRsZXIgPSBhcmd1bWVudHMubGVuZ3RoID49IDIgPyBhcmd1bWVudHNbMl0gOiBudWxsO1xuICB9XG4gIHRyaWdnZXJzLmFkZFRyaWdnZXIodHJpZ2dlcnMuVHlwZXMuYmVmb3JlUGFzc3dvcmRSZXNldFJlcXVlc3QsIGNsYXNzTmFtZSwgaGFuZGxlciwgUGFyc2UuYXBwbGljYXRpb25JZCk7XG4gIGlmICh2YWxpZGF0aW9uSGFuZGxlciAmJiB2YWxpZGF0aW9uSGFuZGxlci5yYXRlTGltaXQpIHtcbiAgICBhZGRSYXRlTGltaXQoXG4gICAgICB7IHJlcXVlc3RQYXRoOiBgL3JlcXVlc3RQYXNzd29yZFJlc2V0YCwgcmVxdWVzdE1ldGhvZHM6ICdQT1NUJywgLi4udmFsaWRhdGlvbkhhbmRsZXIucmF0ZUxpbWl0IH0sXG4gICAgICBQYXJzZS5hcHBsaWNhdGlvbklkLFxuICAgICAgdHJ1ZVxuICAgICk7XG4gIH1cbn07XG5cbi8qKlxuICogUmVnaXN0ZXJzIGFuIGFmdGVyIHNhdmUgZnVuY3Rpb24uXG4gKlxuICogKipBdmFpbGFibGUgaW4gQ2xvdWQgQ29kZSBvbmx5LioqXG4gKlxuICogSWYgeW91IHdhbnQgdG8gdXNlIGFmdGVyU2F2ZSBmb3IgYSBwcmVkZWZpbmVkIGNsYXNzIGluIHRoZSBQYXJzZSBKYXZhU2NyaXB0IFNESyAoZS5nLiB7QGxpbmsgUGFyc2UuVXNlcn0gb3Ige0BsaW5rIFBhcnNlLkZpbGV9KSwgeW91IHNob3VsZCBwYXNzIHRoZSBjbGFzcyBpdHNlbGYgYW5kIG5vdCB0aGUgU3RyaW5nIGZvciBhcmcxLlxuICpcbiAqIGBgYFxuICogUGFyc2UuQ2xvdWQuYWZ0ZXJTYXZlKCdNeUN1c3RvbUNsYXNzJywgYXN5bmMgZnVuY3Rpb24ocmVxdWVzdCkge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0sIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIHZhbGlkYXRpb24gY29kZSBoZXJlXG4gKiB9KTtcbiAqXG4gKiBQYXJzZS5DbG91ZC5hZnRlclNhdmUoUGFyc2UuVXNlciwgYXN5bmMgZnVuY3Rpb24ocmVxdWVzdCkge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0sIHsgLi4udmFsaWRhdGlvbk9iamVjdCB9KTtcbiAqIGBgYFxuICpcbiAqIEBtZXRob2QgYWZ0ZXJTYXZlXG4gKiBAbmFtZSBQYXJzZS5DbG91ZC5hZnRlclNhdmVcbiAqIEBwYXJhbSB7KFN0cmluZ3xQYXJzZS5PYmplY3QpfSBhcmcxIFRoZSBQYXJzZS5PYmplY3Qgc3ViY2xhc3MgdG8gcmVnaXN0ZXIgdGhlIGFmdGVyIHNhdmUgZnVuY3Rpb24gZm9yLiBUaGlzIGNhbiBpbnN0ZWFkIGJlIGEgU3RyaW5nIHRoYXQgaXMgdGhlIGNsYXNzTmFtZSBvZiB0aGUgc3ViY2xhc3MuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jIFRoZSBmdW5jdGlvbiB0byBydW4gYWZ0ZXIgYSBzYXZlLiBUaGlzIGZ1bmN0aW9uIGNhbiBiZSBhbiBhc3luYyBmdW5jdGlvbiBhbmQgc2hvdWxkIHRha2UganVzdCBvbmUgcGFyYW1ldGVyLCB7QGxpbmsgUGFyc2UuQ2xvdWQuVHJpZ2dlclJlcXVlc3R9LlxuICogQHBhcmFtIHsoT2JqZWN0fEZ1bmN0aW9uKX0gdmFsaWRhdG9yIEFuIG9wdGlvbmFsIGZ1bmN0aW9uIHRvIGhlbHAgdmFsaWRhdGluZyBjbG91ZCBjb2RlLiBUaGlzIGZ1bmN0aW9uIGNhbiBiZSBhbiBhc3luYyBmdW5jdGlvbiBhbmQgc2hvdWxkIHRha2Ugb25lIHBhcmFtZXRlciBhIHtAbGluayBQYXJzZS5DbG91ZC5UcmlnZ2VyUmVxdWVzdH0sIG9yIGEge0BsaW5rIFBhcnNlLkNsb3VkLlZhbGlkYXRvck9iamVjdH0uXG4gKi9cblBhcnNlQ2xvdWQuYWZ0ZXJTYXZlID0gZnVuY3Rpb24gKHBhcnNlQ2xhc3MsIGhhbmRsZXIsIHZhbGlkYXRpb25IYW5kbGVyKSB7XG4gIGNvbnN0IGNsYXNzTmFtZSA9IHRyaWdnZXJzLmdldENsYXNzTmFtZShwYXJzZUNsYXNzKTtcbiAgdmFsaWRhdGVWYWxpZGF0b3IodmFsaWRhdGlvbkhhbmRsZXIpO1xuICB0cmlnZ2Vycy5hZGRUcmlnZ2VyKFxuICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyU2F2ZSxcbiAgICBjbGFzc05hbWUsXG4gICAgaGFuZGxlcixcbiAgICBQYXJzZS5hcHBsaWNhdGlvbklkLFxuICAgIHZhbGlkYXRpb25IYW5kbGVyXG4gICk7XG59O1xuXG4vKipcbiAqIFJlZ2lzdGVycyBhbiBhZnRlciBkZWxldGUgZnVuY3Rpb24uXG4gKlxuICogKipBdmFpbGFibGUgaW4gQ2xvdWQgQ29kZSBvbmx5LioqXG4gKlxuICogSWYgeW91IHdhbnQgdG8gdXNlIGFmdGVyRGVsZXRlIGZvciBhIHByZWRlZmluZWQgY2xhc3MgaW4gdGhlIFBhcnNlIEphdmFTY3JpcHQgU0RLIChlLmcuIHtAbGluayBQYXJzZS5Vc2VyfSBvciB7QGxpbmsgUGFyc2UuRmlsZX0pLCB5b3Ugc2hvdWxkIHBhc3MgdGhlIGNsYXNzIGl0c2VsZiBhbmQgbm90IHRoZSBTdHJpbmcgZm9yIGFyZzEuXG4gKiBgYGBcbiAqIFBhcnNlLkNsb3VkLmFmdGVyRGVsZXRlKCdNeUN1c3RvbUNsYXNzJywgYXN5bmMgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9LCAocmVxdWVzdCkgPT4ge1xuICogICAvLyB2YWxpZGF0aW9uIGNvZGUgaGVyZVxuICogfSk7XG4gKlxuICogUGFyc2UuQ2xvdWQuYWZ0ZXJEZWxldGUoUGFyc2UuVXNlciwgYXN5bmMgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9LCB7IC4uLnZhbGlkYXRpb25PYmplY3QgfSk7XG4gKmBgYFxuICpcbiAqIEBtZXRob2QgYWZ0ZXJEZWxldGVcbiAqIEBuYW1lIFBhcnNlLkNsb3VkLmFmdGVyRGVsZXRlXG4gKiBAcGFyYW0geyhTdHJpbmd8UGFyc2UuT2JqZWN0KX0gYXJnMSBUaGUgUGFyc2UuT2JqZWN0IHN1YmNsYXNzIHRvIHJlZ2lzdGVyIHRoZSBhZnRlciBkZWxldGUgZnVuY3Rpb24gZm9yLiBUaGlzIGNhbiBpbnN0ZWFkIGJlIGEgU3RyaW5nIHRoYXQgaXMgdGhlIGNsYXNzTmFtZSBvZiB0aGUgc3ViY2xhc3MuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jIFRoZSBmdW5jdGlvbiB0byBydW4gYWZ0ZXIgYSBkZWxldGUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBqdXN0IG9uZSBwYXJhbWV0ZXIsIHtAbGluayBQYXJzZS5DbG91ZC5UcmlnZ2VyUmVxdWVzdH0uXG4gKiBAcGFyYW0geyhPYmplY3R8RnVuY3Rpb24pfSB2YWxpZGF0b3IgQW4gb3B0aW9uYWwgZnVuY3Rpb24gdG8gaGVscCB2YWxpZGF0aW5nIGNsb3VkIGNvZGUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFuIGFzeW5jIGZ1bmN0aW9uIGFuZCBzaG91bGQgdGFrZSBvbmUgcGFyYW1ldGVyIGEge0BsaW5rIFBhcnNlLkNsb3VkLlRyaWdnZXJSZXF1ZXN0fSwgb3IgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuVmFsaWRhdG9yT2JqZWN0fS5cbiAqL1xuUGFyc2VDbG91ZC5hZnRlckRlbGV0ZSA9IGZ1bmN0aW9uIChwYXJzZUNsYXNzLCBoYW5kbGVyLCB2YWxpZGF0aW9uSGFuZGxlcikge1xuICBjb25zdCBjbGFzc05hbWUgPSB0cmlnZ2Vycy5nZXRDbGFzc05hbWUocGFyc2VDbGFzcyk7XG4gIHZhbGlkYXRlVmFsaWRhdG9yKHZhbGlkYXRpb25IYW5kbGVyKTtcbiAgdHJpZ2dlcnMuYWRkVHJpZ2dlcihcbiAgICB0cmlnZ2Vycy5UeXBlcy5hZnRlckRlbGV0ZSxcbiAgICBjbGFzc05hbWUsXG4gICAgaGFuZGxlcixcbiAgICBQYXJzZS5hcHBsaWNhdGlvbklkLFxuICAgIHZhbGlkYXRpb25IYW5kbGVyXG4gICk7XG59O1xuXG4vKipcbiAqIFJlZ2lzdGVycyBhIGJlZm9yZSBmaW5kIGZ1bmN0aW9uLlxuICpcbiAqICoqQXZhaWxhYmxlIGluIENsb3VkIENvZGUgb25seS4qKlxuICpcbiAqIElmIHlvdSB3YW50IHRvIHVzZSBiZWZvcmVGaW5kIGZvciBhIHByZWRlZmluZWQgY2xhc3MgaW4gdGhlIFBhcnNlIEphdmFTY3JpcHQgU0RLIChlLmcuIHtAbGluayBQYXJzZS5Vc2VyfSBvciB7QGxpbmsgUGFyc2UuRmlsZX0pLCB5b3Ugc2hvdWxkIHBhc3MgdGhlIGNsYXNzIGl0c2VsZiBhbmQgbm90IHRoZSBTdHJpbmcgZm9yIGFyZzEuXG4gKiBgYGBcbiAqIFBhcnNlLkNsb3VkLmJlZm9yZUZpbmQoJ015Q3VzdG9tQ2xhc3MnLCBhc3luYyAocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0sIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIHZhbGlkYXRpb24gY29kZSBoZXJlXG4gKiB9KTtcbiAqXG4gKiBQYXJzZS5DbG91ZC5iZWZvcmVGaW5kKFBhcnNlLlVzZXIsIGFzeW5jIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIGNvZGUgaGVyZVxuICogfSwgeyAuLi52YWxpZGF0aW9uT2JqZWN0IH0pO1xuICpgYGBcbiAqXG4gKiBAbWV0aG9kIGJlZm9yZUZpbmRcbiAqIEBuYW1lIFBhcnNlLkNsb3VkLmJlZm9yZUZpbmRcbiAqIEBwYXJhbSB7KFN0cmluZ3xQYXJzZS5PYmplY3QpfSBhcmcxIFRoZSBQYXJzZS5PYmplY3Qgc3ViY2xhc3MgdG8gcmVnaXN0ZXIgdGhlIGJlZm9yZSBmaW5kIGZ1bmN0aW9uIGZvci4gVGhpcyBjYW4gaW5zdGVhZCBiZSBhIFN0cmluZyB0aGF0IGlzIHRoZSBjbGFzc05hbWUgb2YgdGhlIHN1YmNsYXNzLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgZnVuY3Rpb24gdG8gcnVuIGJlZm9yZSBhIGZpbmQuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBqdXN0IG9uZSBwYXJhbWV0ZXIsIHtAbGluayBQYXJzZS5DbG91ZC5CZWZvcmVGaW5kUmVxdWVzdH0uXG4gKiBAcGFyYW0geyhPYmplY3R8RnVuY3Rpb24pfSB2YWxpZGF0b3IgQW4gb3B0aW9uYWwgZnVuY3Rpb24gdG8gaGVscCB2YWxpZGF0aW5nIGNsb3VkIGNvZGUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFuIGFzeW5jIGZ1bmN0aW9uIGFuZCBzaG91bGQgdGFrZSBvbmUgcGFyYW1ldGVyIGEge0BsaW5rIFBhcnNlLkNsb3VkLkJlZm9yZUZpbmRSZXF1ZXN0fSwgb3IgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuVmFsaWRhdG9yT2JqZWN0fS5cbiAqL1xuUGFyc2VDbG91ZC5iZWZvcmVGaW5kID0gZnVuY3Rpb24gKHBhcnNlQ2xhc3MsIGhhbmRsZXIsIHZhbGlkYXRpb25IYW5kbGVyKSB7XG4gIGNvbnN0IGNsYXNzTmFtZSA9IHRyaWdnZXJzLmdldENsYXNzTmFtZShwYXJzZUNsYXNzKTtcbiAgdmFsaWRhdGVWYWxpZGF0b3IodmFsaWRhdGlvbkhhbmRsZXIpO1xuICB0cmlnZ2Vycy5hZGRUcmlnZ2VyKFxuICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZUZpbmQsXG4gICAgY2xhc3NOYW1lLFxuICAgIGhhbmRsZXIsXG4gICAgUGFyc2UuYXBwbGljYXRpb25JZCxcbiAgICB2YWxpZGF0aW9uSGFuZGxlclxuICApO1xuICBpZiAodmFsaWRhdGlvbkhhbmRsZXIgJiYgdmFsaWRhdGlvbkhhbmRsZXIucmF0ZUxpbWl0KSB7XG4gICAgYWRkUmF0ZUxpbWl0KFxuICAgICAge1xuICAgICAgICByZXF1ZXN0UGF0aDogZ2V0Um91dGUoY2xhc3NOYW1lKSxcbiAgICAgICAgcmVxdWVzdE1ldGhvZHM6ICdHRVQnLFxuICAgICAgICAuLi52YWxpZGF0aW9uSGFuZGxlci5yYXRlTGltaXQsXG4gICAgICB9LFxuICAgICAgUGFyc2UuYXBwbGljYXRpb25JZCxcbiAgICAgIHRydWVcbiAgICApO1xuICB9XG59O1xuXG4vKipcbiAqIFJlZ2lzdGVycyBhbiBhZnRlciBmaW5kIGZ1bmN0aW9uLlxuICpcbiAqICoqQXZhaWxhYmxlIGluIENsb3VkIENvZGUgb25seS4qKlxuICpcbiAqIElmIHlvdSB3YW50IHRvIHVzZSBhZnRlckZpbmQgZm9yIGEgcHJlZGVmaW5lZCBjbGFzcyBpbiB0aGUgUGFyc2UgSmF2YVNjcmlwdCBTREsgKGUuZy4ge0BsaW5rIFBhcnNlLlVzZXJ9IG9yIHtAbGluayBQYXJzZS5GaWxlfSksIHlvdSBzaG91bGQgcGFzcyB0aGUgY2xhc3MgaXRzZWxmIGFuZCBub3QgdGhlIFN0cmluZyBmb3IgYXJnMS5cbiAqIGBgYFxuICogUGFyc2UuQ2xvdWQuYWZ0ZXJGaW5kKCdNeUN1c3RvbUNsYXNzJywgYXN5bmMgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9LCAocmVxdWVzdCkgPT4ge1xuICogICAvLyB2YWxpZGF0aW9uIGNvZGUgaGVyZVxuICogfSk7XG4gKlxuICogUGFyc2UuQ2xvdWQuYWZ0ZXJGaW5kKFBhcnNlLlVzZXIsIGFzeW5jIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIGNvZGUgaGVyZVxuICogfSwgeyAuLi52YWxpZGF0aW9uT2JqZWN0IH0pO1xuICpgYGBcbiAqXG4gKiBAbWV0aG9kIGFmdGVyRmluZFxuICogQG5hbWUgUGFyc2UuQ2xvdWQuYWZ0ZXJGaW5kXG4gKiBAcGFyYW0geyhTdHJpbmd8UGFyc2UuT2JqZWN0KX0gYXJnMSBUaGUgUGFyc2UuT2JqZWN0IHN1YmNsYXNzIHRvIHJlZ2lzdGVyIHRoZSBhZnRlciBmaW5kIGZ1bmN0aW9uIGZvci4gVGhpcyBjYW4gaW5zdGVhZCBiZSBhIFN0cmluZyB0aGF0IGlzIHRoZSBjbGFzc05hbWUgb2YgdGhlIHN1YmNsYXNzLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgZnVuY3Rpb24gdG8gcnVuIGJlZm9yZSBhIGZpbmQuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBqdXN0IG9uZSBwYXJhbWV0ZXIsIHtAbGluayBQYXJzZS5DbG91ZC5BZnRlckZpbmRSZXF1ZXN0fS5cbiAqIEBwYXJhbSB7KE9iamVjdHxGdW5jdGlvbil9IHZhbGlkYXRvciBBbiBvcHRpb25hbCBmdW5jdGlvbiB0byBoZWxwIHZhbGlkYXRpbmcgY2xvdWQgY29kZS4gVGhpcyBmdW5jdGlvbiBjYW4gYmUgYW4gYXN5bmMgZnVuY3Rpb24gYW5kIHNob3VsZCB0YWtlIG9uZSBwYXJhbWV0ZXIgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuQWZ0ZXJGaW5kUmVxdWVzdH0sIG9yIGEge0BsaW5rIFBhcnNlLkNsb3VkLlZhbGlkYXRvck9iamVjdH0uXG4gKi9cblBhcnNlQ2xvdWQuYWZ0ZXJGaW5kID0gZnVuY3Rpb24gKHBhcnNlQ2xhc3MsIGhhbmRsZXIsIHZhbGlkYXRpb25IYW5kbGVyKSB7XG4gIGNvbnN0IGNsYXNzTmFtZSA9IHRyaWdnZXJzLmdldENsYXNzTmFtZShwYXJzZUNsYXNzKTtcbiAgdmFsaWRhdGVWYWxpZGF0b3IodmFsaWRhdGlvbkhhbmRsZXIpO1xuICB0cmlnZ2Vycy5hZGRUcmlnZ2VyKFxuICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyRmluZCxcbiAgICBjbGFzc05hbWUsXG4gICAgaGFuZGxlcixcbiAgICBQYXJzZS5hcHBsaWNhdGlvbklkLFxuICAgIHZhbGlkYXRpb25IYW5kbGVyXG4gICk7XG59O1xuXG4vKipcbiAqIFJlZ2lzdGVycyBhIGJlZm9yZSBsaXZlIHF1ZXJ5IHNlcnZlciBjb25uZWN0IGZ1bmN0aW9uLlxuICpcbiAqICoqQXZhaWxhYmxlIGluIENsb3VkIENvZGUgb25seS4qKlxuICpcbiAqIGBgYFxuICogUGFyc2UuQ2xvdWQuYmVmb3JlQ29ubmVjdChhc3luYyAocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0sIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIHZhbGlkYXRpb24gY29kZSBoZXJlXG4gKiB9KTtcbiAqXG4gKiBQYXJzZS5DbG91ZC5iZWZvcmVDb25uZWN0KGFzeW5jIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIGNvZGUgaGVyZVxuICogfSwgeyAuLi52YWxpZGF0aW9uT2JqZWN0IH0pO1xuICpgYGBcbiAqXG4gKiBAbWV0aG9kIGJlZm9yZUNvbm5lY3RcbiAqIEBuYW1lIFBhcnNlLkNsb3VkLmJlZm9yZUNvbm5lY3RcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGZ1bmN0aW9uIHRvIGJlZm9yZSBjb25uZWN0aW9uIGlzIG1hZGUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBqdXN0IG9uZSBwYXJhbWV0ZXIsIHtAbGluayBQYXJzZS5DbG91ZC5Db25uZWN0VHJpZ2dlclJlcXVlc3R9LlxuICogQHBhcmFtIHsoT2JqZWN0fEZ1bmN0aW9uKX0gdmFsaWRhdG9yIEFuIG9wdGlvbmFsIGZ1bmN0aW9uIHRvIGhlbHAgdmFsaWRhdGluZyBjbG91ZCBjb2RlLiBUaGlzIGZ1bmN0aW9uIGNhbiBiZSBhbiBhc3luYyBmdW5jdGlvbiBhbmQgc2hvdWxkIHRha2Ugb25lIHBhcmFtZXRlciBhIHtAbGluayBQYXJzZS5DbG91ZC5Db25uZWN0VHJpZ2dlclJlcXVlc3R9LCBvciBhIHtAbGluayBQYXJzZS5DbG91ZC5WYWxpZGF0b3JPYmplY3R9LlxuICovXG5QYXJzZUNsb3VkLmJlZm9yZUNvbm5lY3QgPSBmdW5jdGlvbiAoaGFuZGxlciwgdmFsaWRhdGlvbkhhbmRsZXIpIHtcbiAgdmFsaWRhdGVWYWxpZGF0b3IodmFsaWRhdGlvbkhhbmRsZXIpO1xuICB0cmlnZ2Vycy5hZGRDb25uZWN0VHJpZ2dlcihcbiAgICB0cmlnZ2Vycy5UeXBlcy5iZWZvcmVDb25uZWN0LFxuICAgIGhhbmRsZXIsXG4gICAgUGFyc2UuYXBwbGljYXRpb25JZCxcbiAgICB2YWxpZGF0aW9uSGFuZGxlclxuICApO1xufTtcblxuLyoqXG4gKiBTZW5kcyBhbiBlbWFpbCB0aHJvdWdoIHRoZSBQYXJzZSBTZXJ2ZXIgbWFpbCBhZGFwdGVyLlxuICpcbiAqICoqQXZhaWxhYmxlIGluIENsb3VkIENvZGUgb25seS4qKlxuICogKipSZXF1aXJlcyBhIG1haWwgYWRhcHRlciB0byBiZSBjb25maWd1cmVkIGZvciBQYXJzZSBTZXJ2ZXIuKipcbiAqXG4gKiBgYGBcbiAqIFBhcnNlLkNsb3VkLnNlbmRFbWFpbCh7XG4gKiAgIGZyb206ICdFeGFtcGxlIDx0ZXN0QGV4YW1wbGUuY29tPicsXG4gKiAgIHRvOiAnY29udGFjdEBleGFtcGxlLmNvbScsXG4gKiAgIHN1YmplY3Q6ICdUZXN0IGVtYWlsJyxcbiAqICAgdGV4dDogJ1RoaXMgZW1haWwgaXMgYSB0ZXN0LidcbiAqIH0pO1xuICpgYGBcbiAqXG4gKiBAbWV0aG9kIHNlbmRFbWFpbFxuICogQG5hbWUgUGFyc2UuQ2xvdWQuc2VuZEVtYWlsXG4gKiBAcGFyYW0ge09iamVjdH0gZGF0YSBUaGUgb2JqZWN0IG9mIHRoZSBtYWlsIGRhdGEgdG8gc2VuZC5cbiAqL1xuUGFyc2VDbG91ZC5zZW5kRW1haWwgPSBmdW5jdGlvbiAoZGF0YSkge1xuICBjb25zdCBjb25maWcgPSBDb25maWcuZ2V0KFBhcnNlLmFwcGxpY2F0aW9uSWQpO1xuICBjb25zdCBlbWFpbEFkYXB0ZXIgPSBjb25maWcudXNlckNvbnRyb2xsZXIuYWRhcHRlcjtcbiAgaWYgKCFlbWFpbEFkYXB0ZXIpIHtcbiAgICBjb25maWcubG9nZ2VyQ29udHJvbGxlci5lcnJvcihcbiAgICAgICdGYWlsZWQgdG8gc2VuZCBlbWFpbCBiZWNhdXNlIG5vIG1haWwgYWRhcHRlciBpcyBjb25maWd1cmVkIGZvciBQYXJzZSBTZXJ2ZXIuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJldHVybiBlbWFpbEFkYXB0ZXIuc2VuZE1haWwoZGF0YSk7XG59O1xuXG4vKipcbiAqIFJlZ2lzdGVycyBhIGJlZm9yZSBsaXZlIHF1ZXJ5IHN1YnNjcmlwdGlvbiBmdW5jdGlvbi5cbiAqXG4gKiAqKkF2YWlsYWJsZSBpbiBDbG91ZCBDb2RlIG9ubHkuKipcbiAqXG4gKiBJZiB5b3Ugd2FudCB0byB1c2UgYmVmb3JlU3Vic2NyaWJlIGZvciBhIHByZWRlZmluZWQgY2xhc3MgaW4gdGhlIFBhcnNlIEphdmFTY3JpcHQgU0RLIChlLmcuIHtAbGluayBQYXJzZS5Vc2VyfSBvciB7QGxpbmsgUGFyc2UuRmlsZX0pLCB5b3Ugc2hvdWxkIHBhc3MgdGhlIGNsYXNzIGl0c2VsZiBhbmQgbm90IHRoZSBTdHJpbmcgZm9yIGFyZzEuXG4gKiBgYGBcbiAqIFBhcnNlLkNsb3VkLmJlZm9yZVN1YnNjcmliZSgnTXlDdXN0b21DbGFzcycsIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIGNvZGUgaGVyZVxuICogfSwgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gdmFsaWRhdGlvbiBjb2RlIGhlcmVcbiAqIH0pO1xuICpcbiAqIFBhcnNlLkNsb3VkLmJlZm9yZVN1YnNjcmliZShQYXJzZS5Vc2VyLCAocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0sIHsgLi4udmFsaWRhdGlvbk9iamVjdCB9KTtcbiAqYGBgXG4gKlxuICogQG1ldGhvZCBiZWZvcmVTdWJzY3JpYmVcbiAqIEBuYW1lIFBhcnNlLkNsb3VkLmJlZm9yZVN1YnNjcmliZVxuICogQHBhcmFtIHsoU3RyaW5nfFBhcnNlLk9iamVjdCl9IGFyZzEgVGhlIFBhcnNlLk9iamVjdCBzdWJjbGFzcyB0byByZWdpc3RlciB0aGUgYmVmb3JlIHN1YnNjcmlwdGlvbiBmdW5jdGlvbiBmb3IuIFRoaXMgY2FuIGluc3RlYWQgYmUgYSBTdHJpbmcgdGhhdCBpcyB0aGUgY2xhc3NOYW1lIG9mIHRoZSBzdWJjbGFzcy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGZ1bmN0aW9uIHRvIHJ1biBiZWZvcmUgYSBzdWJzY3JpcHRpb24uIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBvbmUgcGFyYW1ldGVyLCBhIHtAbGluayBQYXJzZS5DbG91ZC5UcmlnZ2VyUmVxdWVzdH0uXG4gKiBAcGFyYW0geyhPYmplY3R8RnVuY3Rpb24pfSB2YWxpZGF0b3IgQW4gb3B0aW9uYWwgZnVuY3Rpb24gdG8gaGVscCB2YWxpZGF0aW5nIGNsb3VkIGNvZGUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFuIGFzeW5jIGZ1bmN0aW9uIGFuZCBzaG91bGQgdGFrZSBvbmUgcGFyYW1ldGVyIGEge0BsaW5rIFBhcnNlLkNsb3VkLlRyaWdnZXJSZXF1ZXN0fSwgb3IgYSB7QGxpbmsgUGFyc2UuQ2xvdWQuVmFsaWRhdG9yT2JqZWN0fS5cbiAqL1xuUGFyc2VDbG91ZC5iZWZvcmVTdWJzY3JpYmUgPSBmdW5jdGlvbiAocGFyc2VDbGFzcywgaGFuZGxlciwgdmFsaWRhdGlvbkhhbmRsZXIpIHtcbiAgdmFsaWRhdGVWYWxpZGF0b3IodmFsaWRhdGlvbkhhbmRsZXIpO1xuICBjb25zdCBjbGFzc05hbWUgPSB0cmlnZ2Vycy5nZXRDbGFzc05hbWUocGFyc2VDbGFzcyk7XG4gIHRyaWdnZXJzLmFkZFRyaWdnZXIoXG4gICAgdHJpZ2dlcnMuVHlwZXMuYmVmb3JlU3Vic2NyaWJlLFxuICAgIGNsYXNzTmFtZSxcbiAgICBoYW5kbGVyLFxuICAgIFBhcnNlLmFwcGxpY2F0aW9uSWQsXG4gICAgdmFsaWRhdGlvbkhhbmRsZXJcbiAgKTtcbn07XG5cblBhcnNlQ2xvdWQub25MaXZlUXVlcnlFdmVudCA9IGZ1bmN0aW9uIChoYW5kbGVyKSB7XG4gIHRyaWdnZXJzLmFkZExpdmVRdWVyeUV2ZW50SGFuZGxlcihoYW5kbGVyLCBQYXJzZS5hcHBsaWNhdGlvbklkKTtcbn07XG5cbi8qKlxuICogUmVnaXN0ZXJzIGFuIGFmdGVyIGxpdmUgcXVlcnkgc2VydmVyIGV2ZW50IGZ1bmN0aW9uLlxuICpcbiAqICoqQXZhaWxhYmxlIGluIENsb3VkIENvZGUgb25seS4qKlxuICpcbiAqIGBgYFxuICogUGFyc2UuQ2xvdWQuYWZ0ZXJMaXZlUXVlcnlFdmVudCgnTXlDdXN0b21DbGFzcycsIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIGNvZGUgaGVyZVxuICogfSwgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gdmFsaWRhdGlvbiBjb2RlIGhlcmVcbiAqIH0pO1xuICpcbiAqIFBhcnNlLkNsb3VkLmFmdGVyTGl2ZVF1ZXJ5RXZlbnQoJ015Q3VzdG9tQ2xhc3MnLCAocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0sIHsgLi4udmFsaWRhdGlvbk9iamVjdCB9KTtcbiAqYGBgXG4gKlxuICogQG1ldGhvZCBhZnRlckxpdmVRdWVyeUV2ZW50XG4gKiBAbmFtZSBQYXJzZS5DbG91ZC5hZnRlckxpdmVRdWVyeUV2ZW50XG4gKiBAcGFyYW0geyhTdHJpbmd8UGFyc2UuT2JqZWN0KX0gYXJnMSBUaGUgUGFyc2UuT2JqZWN0IHN1YmNsYXNzIHRvIHJlZ2lzdGVyIHRoZSBhZnRlciBsaXZlIHF1ZXJ5IGV2ZW50IGZ1bmN0aW9uIGZvci4gVGhpcyBjYW4gaW5zdGVhZCBiZSBhIFN0cmluZyB0aGF0IGlzIHRoZSBjbGFzc05hbWUgb2YgdGhlIHN1YmNsYXNzLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgZnVuY3Rpb24gdG8gcnVuIGFmdGVyIGEgbGl2ZSBxdWVyeSBldmVudC4gVGhpcyBmdW5jdGlvbiBjYW4gYmUgYXN5bmMgYW5kIHNob3VsZCB0YWtlIG9uZSBwYXJhbWV0ZXIsIGEge0BsaW5rIFBhcnNlLkNsb3VkLkxpdmVRdWVyeUV2ZW50VHJpZ2dlcn0uXG4gKiBAcGFyYW0geyhPYmplY3R8RnVuY3Rpb24pfSB2YWxpZGF0b3IgQW4gb3B0aW9uYWwgZnVuY3Rpb24gdG8gaGVscCB2YWxpZGF0aW5nIGNsb3VkIGNvZGUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFuIGFzeW5jIGZ1bmN0aW9uIGFuZCBzaG91bGQgdGFrZSBvbmUgcGFyYW1ldGVyIGEge0BsaW5rIFBhcnNlLkNsb3VkLkxpdmVRdWVyeUV2ZW50VHJpZ2dlcn0sIG9yIGEge0BsaW5rIFBhcnNlLkNsb3VkLlZhbGlkYXRvck9iamVjdH0uXG4gKi9cblBhcnNlQ2xvdWQuYWZ0ZXJMaXZlUXVlcnlFdmVudCA9IGZ1bmN0aW9uIChwYXJzZUNsYXNzLCBoYW5kbGVyLCB2YWxpZGF0aW9uSGFuZGxlcikge1xuICBjb25zdCBjbGFzc05hbWUgPSB0cmlnZ2Vycy5nZXRDbGFzc05hbWUocGFyc2VDbGFzcyk7XG4gIHZhbGlkYXRlVmFsaWRhdG9yKHZhbGlkYXRpb25IYW5kbGVyKTtcbiAgdHJpZ2dlcnMuYWRkVHJpZ2dlcihcbiAgICB0cmlnZ2Vycy5UeXBlcy5hZnRlckV2ZW50LFxuICAgIGNsYXNzTmFtZSxcbiAgICBoYW5kbGVyLFxuICAgIFBhcnNlLmFwcGxpY2F0aW9uSWQsXG4gICAgdmFsaWRhdGlvbkhhbmRsZXJcbiAgKTtcbn07XG5cblBhcnNlQ2xvdWQuX3JlbW92ZUFsbEhvb2tzID0gKCkgPT4ge1xuICB0cmlnZ2Vycy5fdW5yZWdpc3RlckFsbCgpO1xuICBjb25zdCBjb25maWcgPSBDb25maWcuZ2V0KFBhcnNlLmFwcGxpY2F0aW9uSWQpO1xuICBjb25maWc/LnVucmVnaXN0ZXJSYXRlTGltaXRlcnMoKTtcbn07XG5cblBhcnNlQ2xvdWQudXNlTWFzdGVyS2V5ID0gKCkgPT4ge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmVcbiAgY29uc29sZS53YXJuKFxuICAgICdQYXJzZS5DbG91ZC51c2VNYXN0ZXJLZXkgaXMgZGVwcmVjYXRlZCAoYW5kIGhhcyBubyBlZmZlY3QgYW55bW9yZSkgb24gcGFyc2Utc2VydmVyLCBwbGVhc2UgcmVmZXIgdG8gdGhlIGNsb3VkIGNvZGUgbWlncmF0aW9uIG5vdGVzOiBodHRwOi8vZG9jcy5wYXJzZXBsYXRmb3JtLm9yZy9wYXJzZS1zZXJ2ZXIvZ3VpZGUvI21hc3Rlci1rZXktbXVzdC1iZS1wYXNzZWQtZXhwbGljaXRseSdcbiAgKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gUGFyc2VDbG91ZDtcblxuLyoqXG4gKiBAaW50ZXJmYWNlIFBhcnNlLkNsb3VkLlRyaWdnZXJSZXF1ZXN0XG4gKiBAcHJvcGVydHkge1N0cmluZ30gaW5zdGFsbGF0aW9uSWQgSWYgc2V0LCB0aGUgaW5zdGFsbGF0aW9uSWQgdHJpZ2dlcmluZyB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7Qm9vbGVhbn0gbWFzdGVyIElmIHRydWUsIG1lYW5zIHRoZSBtYXN0ZXIga2V5IG9yIHRoZSByZWFkLW9ubHkgbWFzdGVyIGtleSB3YXMgdXNlZC5cbiAqIEBwcm9wZXJ0eSB7Qm9vbGVhbn0gaXNSZWFkT25seSBJZiB0cnVlLCBtZWFucyB0aGUgcmVhZC1vbmx5IG1hc3RlciBrZXkgd2FzIHVzZWQuIFRoaXMgaXMgYSBzdWJzZXQgb2YgYG1hc3RlcmAsIHNvIGBtYXN0ZXJgIHdpbGwgYWxzbyBiZSB0cnVlLiBVc2UgYG1hc3RlciAmJiAhaXNSZWFkT25seWAgdG8gY2hlY2sgZm9yIGZ1bGwgbWFzdGVyIGtleSBhY2Nlc3MuXG4gKiBAcHJvcGVydHkge0Jvb2xlYW59IGlzQ2hhbGxlbmdlIElmIHRydWUsIG1lYW5zIHRoZSBjdXJyZW50IHJlcXVlc3QgaXMgb3JpZ2luYWxseSB0cmlnZ2VyZWQgYnkgYW4gYXV0aCBjaGFsbGVuZ2UuXG4gKiBAcHJvcGVydHkge1BhcnNlLlVzZXJ9IHVzZXIgSWYgc2V0LCB0aGUgdXNlciB0aGF0IG1hZGUgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge1BhcnNlLk9iamVjdH0gb2JqZWN0IFRoZSBvYmplY3QgdHJpZ2dlcmluZyB0aGUgaG9vay5cbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBpcCBUaGUgSVAgYWRkcmVzcyBvZiB0aGUgY2xpZW50IG1ha2luZyB0aGUgcmVxdWVzdC4gVG8gZW5zdXJlIHJldHJpZXZpbmcgdGhlIGNvcnJlY3QgSVAgYWRkcmVzcywgc2V0IHRoZSBQYXJzZSBTZXJ2ZXIgb3B0aW9uIGB0cnVzdFByb3h5OiB0cnVlYCBpZiBQYXJzZSBTZXJ2ZXIgcnVucyBiZWhpbmQgYSBwcm94eSBzZXJ2ZXIsIGZvciBleGFtcGxlIGJlaGluZCBhIGxvYWQgYmFsYW5jZXIuXG4gKiBAcHJvcGVydHkge09iamVjdH0gaGVhZGVycyBUaGUgb3JpZ2luYWwgSFRUUCBoZWFkZXJzIGZvciB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSB0cmlnZ2VyTmFtZSBUaGUgbmFtZSBvZiB0aGUgdHJpZ2dlciAoYGJlZm9yZVNhdmVgLCBgYWZ0ZXJTYXZlYCwgLi4uKVxuICogQHByb3BlcnR5IHtPYmplY3R9IGxvZyBUaGUgY3VycmVudCBsb2dnZXIgaW5zaWRlIFBhcnNlIFNlcnZlci5cbiAqIEBwcm9wZXJ0eSB7UGFyc2UuT2JqZWN0fSBvcmlnaW5hbCBJZiBzZXQsIHRoZSBvYmplY3QsIGFzIGN1cnJlbnRseSBzdG9yZWQuXG4gKiBAcHJvcGVydHkge09iamVjdH0gY29uZmlnIFRoZSBQYXJzZSBTZXJ2ZXIgY29uZmlnLlxuICovXG5cbi8qKlxuICogQGludGVyZmFjZSBQYXJzZS5DbG91ZC5GaWxlVHJpZ2dlclJlcXVlc3RcbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBpbnN0YWxsYXRpb25JZCBJZiBzZXQsIHRoZSBpbnN0YWxsYXRpb25JZCB0cmlnZ2VyaW5nIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtCb29sZWFufSBtYXN0ZXIgSWYgdHJ1ZSwgbWVhbnMgdGhlIG1hc3RlciBrZXkgb3IgdGhlIHJlYWQtb25seSBtYXN0ZXIga2V5IHdhcyB1c2VkLlxuICogQHByb3BlcnR5IHtCb29sZWFufSBpc1JlYWRPbmx5IElmIHRydWUsIG1lYW5zIHRoZSByZWFkLW9ubHkgbWFzdGVyIGtleSB3YXMgdXNlZC4gVGhpcyBpcyBhIHN1YnNldCBvZiBgbWFzdGVyYCwgc28gYG1hc3RlcmAgd2lsbCBhbHNvIGJlIHRydWUuIFVzZSBgbWFzdGVyICYmICFpc1JlYWRPbmx5YCB0byBjaGVjayBmb3IgZnVsbCBtYXN0ZXIga2V5IGFjY2Vzcy5cbiAqIEBwcm9wZXJ0eSB7UGFyc2UuVXNlcn0gdXNlciBJZiBzZXQsIHRoZSB1c2VyIHRoYXQgbWFkZSB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7UGFyc2UuRmlsZX0gZmlsZSBUaGUgZmlsZSB0aGF0IHRyaWdnZXJlZCB0aGUgaG9vay5cbiAqIEBwcm9wZXJ0eSB7SW50ZWdlcn0gZmlsZVNpemUgVGhlIHNpemUgb2YgdGhlIGZpbGUgaW4gYnl0ZXMuXG4gKiBAcHJvcGVydHkge0ludGVnZXJ9IGNvbnRlbnRMZW5ndGggVGhlIHZhbHVlIGZyb20gQ29udGVudC1MZW5ndGggaGVhZGVyXG4gKiBAcHJvcGVydHkge1N0cmluZ30gaXAgVGhlIElQIGFkZHJlc3Mgb2YgdGhlIGNsaWVudCBtYWtpbmcgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge09iamVjdH0gaGVhZGVycyBUaGUgb3JpZ2luYWwgSFRUUCBoZWFkZXJzIGZvciB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSB0cmlnZ2VyTmFtZSBUaGUgbmFtZSBvZiB0aGUgdHJpZ2dlciAoYGJlZm9yZVNhdmVgLCBgYWZ0ZXJTYXZlYClcbiAqIEBwcm9wZXJ0eSB7T2JqZWN0fSBsb2cgVGhlIGN1cnJlbnQgbG9nZ2VyIGluc2lkZSBQYXJzZSBTZXJ2ZXIuXG4gKiBAcHJvcGVydHkge09iamVjdH0gY29uZmlnIFRoZSBQYXJzZSBTZXJ2ZXIgY29uZmlnLlxuICogQHByb3BlcnR5IHtCb29sZWFufSBmb3JjZURvd25sb2FkIChhZnRlckZpbmQgb25seSkgSWYgc2V0IHRvIGB0cnVlYCwgdGhlIGZpbGUgcmVzcG9uc2Ugd2lsbCBpbmNsdWRlIGEgYENvbnRlbnQtRGlzcG9zaXRpb246IGF0dGFjaG1lbnRgIGhlYWRlciwgcHJvbXB0aW5nIHRoZSBicm93c2VyIHRvIGRvd25sb2FkIHRoZSBmaWxlIGluc3RlYWQgb2YgZGlzcGxheWluZyBpdCBpbmxpbmUuXG4gKiBAcHJvcGVydHkge09iamVjdH0gcmVzcG9uc2VIZWFkZXJzIChhZnRlckZpbmQgb25seSkgVGhlIGhlYWRlcnMgdGhhdCB3aWxsIGJlIHNldCBvbiB0aGUgZmlsZSByZXNwb25zZS4gQnkgZGVmYXVsdCBjb250YWlucyBgeyAnWC1Db250ZW50LVR5cGUtT3B0aW9ucyc6ICdub3NuaWZmJyB9YC4gTW9kaWZ5IHRoaXMgb2JqZWN0IHRvIGFkZCwgY2hhbmdlLCBvciByZW1vdmUgcmVzcG9uc2UgaGVhZGVycy5cbiAqL1xuXG4vKipcbiAqIEBpbnRlcmZhY2UgUGFyc2UuQ2xvdWQuQ29ubmVjdFRyaWdnZXJSZXF1ZXN0XG4gKiBAcHJvcGVydHkge1N0cmluZ30gaW5zdGFsbGF0aW9uSWQgSWYgc2V0LCB0aGUgaW5zdGFsbGF0aW9uSWQgdHJpZ2dlcmluZyB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7Qm9vbGVhbn0gdXNlTWFzdGVyS2V5IElmIHRydWUsIG1lYW5zIHRoZSBtYXN0ZXIga2V5IHdhcyB1c2VkLlxuICogQHByb3BlcnR5IHtQYXJzZS5Vc2VyfSB1c2VyIElmIHNldCwgdGhlIHVzZXIgdGhhdCBtYWRlIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtJbnRlZ2VyfSBjbGllbnRzIFRoZSBudW1iZXIgb2YgY2xpZW50cyBjb25uZWN0ZWQuXG4gKiBAcHJvcGVydHkge0ludGVnZXJ9IHN1YnNjcmlwdGlvbnMgVGhlIG51bWJlciBvZiBzdWJzY3JpcHRpb25zIGNvbm5lY3RlZC5cbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBzZXNzaW9uVG9rZW4gSWYgc2V0LCB0aGUgc2Vzc2lvbiBvZiB0aGUgdXNlciB0aGF0IG1hZGUgdGhlIHJlcXVlc3QuXG4gKi9cblxuLyoqXG4gKiBAaW50ZXJmYWNlIFBhcnNlLkNsb3VkLkxpdmVRdWVyeUV2ZW50VHJpZ2dlclxuICogQHByb3BlcnR5IHtTdHJpbmd9IGluc3RhbGxhdGlvbklkIElmIHNldCwgdGhlIGluc3RhbGxhdGlvbklkIHRyaWdnZXJpbmcgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge0Jvb2xlYW59IHVzZU1hc3RlcktleSBJZiB0cnVlLCBtZWFucyB0aGUgbWFzdGVyIGtleSB3YXMgdXNlZC5cbiAqIEBwcm9wZXJ0eSB7UGFyc2UuVXNlcn0gdXNlciBJZiBzZXQsIHRoZSB1c2VyIHRoYXQgbWFkZSB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBzZXNzaW9uVG9rZW4gSWYgc2V0LCB0aGUgc2Vzc2lvbiBvZiB0aGUgdXNlciB0aGF0IG1hZGUgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge1N0cmluZ30gZXZlbnQgVGhlIGxpdmUgcXVlcnkgZXZlbnQgdGhhdCB0cmlnZ2VyZWQgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge1BhcnNlLk9iamVjdH0gb2JqZWN0IFRoZSBvYmplY3QgdHJpZ2dlcmluZyB0aGUgaG9vay5cbiAqIEBwcm9wZXJ0eSB7UGFyc2UuT2JqZWN0fSBvcmlnaW5hbCBJZiBzZXQsIHRoZSBvYmplY3QsIGFzIGN1cnJlbnRseSBzdG9yZWQuXG4gKiBAcHJvcGVydHkge0ludGVnZXJ9IGNsaWVudHMgVGhlIG51bWJlciBvZiBjbGllbnRzIGNvbm5lY3RlZC5cbiAqIEBwcm9wZXJ0eSB7SW50ZWdlcn0gc3Vic2NyaXB0aW9ucyBUaGUgbnVtYmVyIG9mIHN1YnNjcmlwdGlvbnMgY29ubmVjdGVkLlxuICogQHByb3BlcnR5IHtCb29sZWFufSBzZW5kRXZlbnQgSWYgdGhlIExpdmVRdWVyeSBldmVudCBzaG91bGQgYmUgc2VudCB0byB0aGUgY2xpZW50LiBTZXQgdG8gZmFsc2UgdG8gcHJldmVudCBMaXZlUXVlcnkgZnJvbSBwdXNoaW5nIHRvIHRoZSBjbGllbnQuXG4gKi9cblxuLyoqXG4gKiBAaW50ZXJmYWNlIFBhcnNlLkNsb3VkLkJlZm9yZUZpbmRSZXF1ZXN0XG4gKiBAcHJvcGVydHkge1N0cmluZ30gaW5zdGFsbGF0aW9uSWQgSWYgc2V0LCB0aGUgaW5zdGFsbGF0aW9uSWQgdHJpZ2dlcmluZyB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7Qm9vbGVhbn0gbWFzdGVyIElmIHRydWUsIG1lYW5zIHRoZSBtYXN0ZXIga2V5IG9yIHRoZSByZWFkLW9ubHkgbWFzdGVyIGtleSB3YXMgdXNlZC5cbiAqIEBwcm9wZXJ0eSB7Qm9vbGVhbn0gaXNSZWFkT25seSBJZiB0cnVlLCBtZWFucyB0aGUgcmVhZC1vbmx5IG1hc3RlciBrZXkgd2FzIHVzZWQuIFRoaXMgaXMgYSBzdWJzZXQgb2YgYG1hc3RlcmAsIHNvIGBtYXN0ZXJgIHdpbGwgYWxzbyBiZSB0cnVlLiBVc2UgYG1hc3RlciAmJiAhaXNSZWFkT25seWAgdG8gY2hlY2sgZm9yIGZ1bGwgbWFzdGVyIGtleSBhY2Nlc3MuXG4gKiBAcHJvcGVydHkge1BhcnNlLlVzZXJ9IHVzZXIgSWYgc2V0LCB0aGUgdXNlciB0aGF0IG1hZGUgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge1BhcnNlLlF1ZXJ5fSBxdWVyeSBUaGUgcXVlcnkgdHJpZ2dlcmluZyB0aGUgaG9vay5cbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBpcCBUaGUgSVAgYWRkcmVzcyBvZiB0aGUgY2xpZW50IG1ha2luZyB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7T2JqZWN0fSBoZWFkZXJzIFRoZSBvcmlnaW5hbCBIVFRQIGhlYWRlcnMgZm9yIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtTdHJpbmd9IHRyaWdnZXJOYW1lIFRoZSBuYW1lIG9mIHRoZSB0cmlnZ2VyIChgYmVmb3JlU2F2ZWAsIGBhZnRlclNhdmVgLCAuLi4pXG4gKiBAcHJvcGVydHkge09iamVjdH0gbG9nIFRoZSBjdXJyZW50IGxvZ2dlciBpbnNpZGUgUGFyc2UgU2VydmVyLlxuICogQHByb3BlcnR5IHtCb29sZWFufSBpc0dldCB3ZXRoZXIgdGhlIHF1ZXJ5IGEgYGdldGAgb3IgYSBgZmluZGBcbiAqIEBwcm9wZXJ0eSB7T2JqZWN0fSBjb25maWcgVGhlIFBhcnNlIFNlcnZlciBjb25maWcuXG4gKi9cblxuLyoqXG4gKiBAaW50ZXJmYWNlIFBhcnNlLkNsb3VkLkFmdGVyRmluZFJlcXVlc3RcbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBpbnN0YWxsYXRpb25JZCBJZiBzZXQsIHRoZSBpbnN0YWxsYXRpb25JZCB0cmlnZ2VyaW5nIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtCb29sZWFufSBtYXN0ZXIgSWYgdHJ1ZSwgbWVhbnMgdGhlIG1hc3RlciBrZXkgb3IgdGhlIHJlYWQtb25seSBtYXN0ZXIga2V5IHdhcyB1c2VkLlxuICogQHByb3BlcnR5IHtCb29sZWFufSBpc1JlYWRPbmx5IElmIHRydWUsIG1lYW5zIHRoZSByZWFkLW9ubHkgbWFzdGVyIGtleSB3YXMgdXNlZC4gVGhpcyBpcyBhIHN1YnNldCBvZiBgbWFzdGVyYCwgc28gYG1hc3RlcmAgd2lsbCBhbHNvIGJlIHRydWUuIFVzZSBgbWFzdGVyICYmICFpc1JlYWRPbmx5YCB0byBjaGVjayBmb3IgZnVsbCBtYXN0ZXIga2V5IGFjY2Vzcy5cbiAqIEBwcm9wZXJ0eSB7UGFyc2UuVXNlcn0gdXNlciBJZiBzZXQsIHRoZSB1c2VyIHRoYXQgbWFkZSB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7UGFyc2UuUXVlcnl9IHF1ZXJ5IFRoZSBxdWVyeSB0cmlnZ2VyaW5nIHRoZSBob29rLlxuICogQHByb3BlcnR5IHtBcnJheTxQYXJzZS5PYmplY3Q+fSByZXN1bHRzIFRoZSByZXN1bHRzIHRoZSBxdWVyeSB5aWVsZGVkLlxuICogQHByb3BlcnR5IHtTdHJpbmd9IGlwIFRoZSBJUCBhZGRyZXNzIG9mIHRoZSBjbGllbnQgbWFraW5nIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtPYmplY3R9IGhlYWRlcnMgVGhlIG9yaWdpbmFsIEhUVFAgaGVhZGVycyBmb3IgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge1N0cmluZ30gdHJpZ2dlck5hbWUgVGhlIG5hbWUgb2YgdGhlIHRyaWdnZXIgKGBiZWZvcmVTYXZlYCwgYGFmdGVyU2F2ZWAsIC4uLilcbiAqIEBwcm9wZXJ0eSB7T2JqZWN0fSBsb2cgVGhlIGN1cnJlbnQgbG9nZ2VyIGluc2lkZSBQYXJzZSBTZXJ2ZXIuXG4gKiBAcHJvcGVydHkge09iamVjdH0gY29uZmlnIFRoZSBQYXJzZSBTZXJ2ZXIgY29uZmlnLlxuICovXG5cbi8qKlxuICogQGludGVyZmFjZSBQYXJzZS5DbG91ZC5GdW5jdGlvblJlcXVlc3RcbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBpbnN0YWxsYXRpb25JZCBJZiBzZXQsIHRoZSBpbnN0YWxsYXRpb25JZCB0cmlnZ2VyaW5nIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtCb29sZWFufSBtYXN0ZXIgSWYgdHJ1ZSwgbWVhbnMgdGhlIG1hc3RlciBrZXkgb3IgdGhlIHJlYWQtb25seSBtYXN0ZXIga2V5IHdhcyB1c2VkLlxuICogQHByb3BlcnR5IHtCb29sZWFufSBpc1JlYWRPbmx5IElmIHRydWUsIG1lYW5zIHRoZSByZWFkLW9ubHkgbWFzdGVyIGtleSB3YXMgdXNlZC4gVGhpcyBpcyBhIHN1YnNldCBvZiBgbWFzdGVyYCwgc28gYG1hc3RlcmAgd2lsbCBhbHNvIGJlIHRydWUuIFVzZSBgbWFzdGVyICYmICFpc1JlYWRPbmx5YCB0byBjaGVjayBmb3IgZnVsbCBtYXN0ZXIga2V5IGFjY2Vzcy5cbiAqIEBwcm9wZXJ0eSB7UGFyc2UuVXNlcn0gdXNlciBJZiBzZXQsIHRoZSB1c2VyIHRoYXQgbWFkZSB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7T2JqZWN0fSBwYXJhbXMgVGhlIHBhcmFtcyBwYXNzZWQgdG8gdGhlIGNsb3VkIGZ1bmN0aW9uLiBGb3IgSlNPTiByZXF1ZXN0cywgdmFsdWVzXG4gKiByZXRhaW4gdGhlaXIgSlNPTiB0eXBlcy4gRm9yIG11bHRpcGFydC9mb3JtLWRhdGEgcmVxdWVzdHMsIHRleHQgZmllbGRzIGFyZSBzdHJpbmdzIGFuZCBmaWxlXG4gKiBmaWVsZHMgYXJlIG9iamVjdHMgd2l0aCBgeyBmaWxlbmFtZTogc3RyaW5nLCBjb250ZW50VHlwZTogc3RyaW5nLCBkYXRhOiBCdWZmZXIgfWAuXG4gKiBAcHJvcGVydHkge1N0cmluZ30gaXAgVGhlIElQIGFkZHJlc3Mgb2YgdGhlIGNsaWVudCBtYWtpbmcgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge09iamVjdH0gaGVhZGVycyBUaGUgb3JpZ2luYWwgSFRUUCBoZWFkZXJzIGZvciB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7T2JqZWN0fSBsb2cgVGhlIGN1cnJlbnQgbG9nZ2VyIGluc2lkZSBQYXJzZSBTZXJ2ZXIuXG4gKiBAcHJvcGVydHkge1N0cmluZ30gZnVuY3Rpb25OYW1lIFRoZSBuYW1lIG9mIHRoZSBjbG91ZCBmdW5jdGlvbi5cbiAqIEBwcm9wZXJ0eSB7T2JqZWN0fSBjb250ZXh0IFRoZSBjb250ZXh0IG9mIHRoZSBjbG91ZCBmdW5jdGlvbiBjYWxsLlxuICogQHByb3BlcnR5IHtPYmplY3R9IGNvbmZpZyBUaGUgUGFyc2UgU2VydmVyIGNvbmZpZy5cbiAqL1xuXG4vKipcbiAqIEBpbnRlcmZhY2UgUGFyc2UuQ2xvdWQuRnVuY3Rpb25SZXNwb25zZVxuICogQHByb3BlcnR5IHtmdW5jdGlvbn0gc3VjY2VzcyBDYWxsIHRoaXMgZnVuY3Rpb24gdG8gcmV0dXJuIGEgc3VjY2Vzc2Z1bCByZXNwb25zZSB3aXRoIGFuIG9wdGlvbmFsIHJlc3VsdC4gVXNhZ2U6IGByZXNwb25zZS5zdWNjZXNzKHJlc3VsdClgXG4gKiBAcHJvcGVydHkge2Z1bmN0aW9ufSBlcnJvciBDYWxsIHRoaXMgZnVuY3Rpb24gdG8gcmV0dXJuIGFuIGVycm9yIHJlc3BvbnNlIHdpdGggYW4gZXJyb3IgbWVzc2FnZS4gVXNhZ2U6IGByZXNwb25zZS5lcnJvcihtZXNzYWdlKWBcbiAqIEBwcm9wZXJ0eSB7ZnVuY3Rpb259IHN0YXR1cyBDYWxsIHRoaXMgZnVuY3Rpb24gdG8gc2V0IGEgY3VzdG9tIEhUVFAgc3RhdHVzIGNvZGUgZm9yIHRoZSByZXNwb25zZS4gUmV0dXJucyB0aGUgcmVzcG9uc2Ugb2JqZWN0IGZvciBjaGFpbmluZy4gVXNhZ2U6IGByZXNwb25zZS5zdGF0dXMoY29kZSkuc3VjY2VzcyhyZXN1bHQpYCBvciBgcmVzcG9uc2Uuc3RhdHVzKGNvZGUpLmVycm9yKG1lc3NhZ2UpYFxuICogQHByb3BlcnR5IHtmdW5jdGlvbn0gaGVhZGVyIENhbGwgdGhpcyBmdW5jdGlvbiB0byBzZXQgYSBjdXN0b20gSFRUUCBoZWFkZXIgZm9yIHRoZSByZXNwb25zZS4gUmV0dXJucyB0aGUgcmVzcG9uc2Ugb2JqZWN0IGZvciBjaGFpbmluZy4gVXNhZ2U6IGByZXNwb25zZS5oZWFkZXIoJ1gtQ3VzdG9tLUhlYWRlcicsICd2YWx1ZScpLnN1Y2Nlc3MocmVzdWx0KWBcbiAqL1xuXG4vKipcbiAqIEBpbnRlcmZhY2UgUGFyc2UuQ2xvdWQuSm9iUmVxdWVzdFxuICogQHByb3BlcnR5IHtPYmplY3R9IHBhcmFtcyBUaGUgcGFyYW1zIHBhc3NlZCB0byB0aGUgYmFja2dyb3VuZCBqb2IuXG4gKiBAcHJvcGVydHkge2Z1bmN0aW9ufSBtZXNzYWdlIElmIG1lc3NhZ2UgaXMgY2FsbGVkIHdpdGggYSBzdHJpbmcgYXJndW1lbnQsIHdpbGwgdXBkYXRlIHRoZSBjdXJyZW50IG1lc3NhZ2UgdG8gYmUgc3RvcmVkIGluIHRoZSBqb2Igc3RhdHVzLlxuICogQHByb3BlcnR5IHtPYmplY3R9IGNvbmZpZyBUaGUgUGFyc2UgU2VydmVyIGNvbmZpZy5cbiAqL1xuXG4vKipcbiAqIEBpbnRlcmZhY2UgUGFyc2UuQ2xvdWQuVmFsaWRhdG9yT2JqZWN0XG4gKiBAcHJvcGVydHkge0Jvb2xlYW59IHJlcXVpcmVVc2VyIHdoZXRoZXIgdGhlIGNsb3VkIHRyaWdnZXIgcmVxdWlyZXMgYSB1c2VyLlxuICogQHByb3BlcnR5IHtCb29sZWFufSByZXF1aXJlTWFzdGVyIHdoZXRoZXIgdGhlIGNsb3VkIHRyaWdnZXIgcmVxdWlyZXMgYSBtYXN0ZXIga2V5LlxuICogQHByb3BlcnR5IHtCb29sZWFufSB2YWxpZGF0ZU1hc3RlcktleSB3aGV0aGVyIHRoZSB2YWxpZGF0b3Igc2hvdWxkIHJ1biBpZiBtYXN0ZXJLZXkgaXMgcHJvdmlkZWQuIERlZmF1bHRzIHRvIGZhbHNlLlxuICogQHByb3BlcnR5IHtCb29sZWFufSBza2lwV2l0aE1hc3RlcktleSB3aGV0aGVyIHRoZSBjbG91ZCBjb2RlIGZ1bmN0aW9uIHNob3VsZCBiZSBpZ25vcmVkIHVzaW5nIGEgbWFzdGVyS2V5LlxuICpcbiAqIEBwcm9wZXJ0eSB7QXJyYXk8U3RyaW5nPnxPYmplY3R9IHJlcXVpcmVVc2VyS2V5cyBJZiBzZXQsIGtleXMgcmVxdWlyZWQgb24gcmVxdWVzdC51c2VyIHRvIG1ha2UgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge1N0cmluZ30gcmVxdWlyZVVzZXJLZXlzLmZpZWxkIElmIHJlcXVpcmVVc2VyS2V5cyBpcyBhbiBvYmplY3QsIG5hbWUgb2YgZmllbGQgdG8gdmFsaWRhdGUgb24gcmVxdWVzdCB1c2VyXG4gKiBAcHJvcGVydHkge0FycmF5fGZ1bmN0aW9ufEFueX0gcmVxdWlyZVVzZXJLZXlzLmZpZWxkLm9wdGlvbnMgYXJyYXkgb2Ygb3B0aW9ucyB0aGF0IHRoZSBmaWVsZCBjYW4gYmUsIGZ1bmN0aW9uIHRvIHZhbGlkYXRlIGZpZWxkLCBvciBzaW5nbGUgdmFsdWUuIFRocm93IGFuIGVycm9yIGlmIHZhbHVlIGlzIGludmFsaWQuXG4gKiBAcHJvcGVydHkge1N0cmluZ30gcmVxdWlyZVVzZXJLZXlzLmZpZWxkLmVycm9yIGN1c3RvbSBlcnJvciBtZXNzYWdlIGlmIGZpZWxkIGlzIGludmFsaWQuXG4gKlxuICogQHByb3BlcnR5IHtBcnJheTxTdHJpbmc+fGZ1bmN0aW9ufXJlcXVpcmVBbnlVc2VyUm9sZXMgSWYgc2V0LCByZXF1ZXN0LnVzZXIgaGFzIHRvIGJlIHBhcnQgb2YgYXQgbGVhc3Qgb25lIHJvbGVzIG5hbWUgdG8gbWFrZSB0aGUgcmVxdWVzdC4gSWYgc2V0IHRvIGEgZnVuY3Rpb24sIGZ1bmN0aW9uIG11c3QgcmV0dXJuIHJvbGUgbmFtZXMuXG4gKiBAcHJvcGVydHkge0FycmF5PFN0cmluZz58ZnVuY3Rpb259cmVxdWlyZUFsbFVzZXJSb2xlcyBJZiBzZXQsIHJlcXVlc3QudXNlciBoYXMgdG8gYmUgcGFydCBhbGwgcm9sZXMgbmFtZSB0byBtYWtlIHRoZSByZXF1ZXN0LiBJZiBzZXQgdG8gYSBmdW5jdGlvbiwgZnVuY3Rpb24gbXVzdCByZXR1cm4gcm9sZSBuYW1lcy5cbiAqXG4gKiBAcHJvcGVydHkge09iamVjdHxBcnJheTxTdHJpbmc+fSBmaWVsZHMgaWYgYW4gYXJyYXkgb2Ygc3RyaW5ncywgdmFsaWRhdG9yIHdpbGwgbG9vayBmb3Iga2V5cyBpbiByZXF1ZXN0LnBhcmFtcywgYW5kIHRocm93IGlmIG5vdCBwcm92aWRlZC4gSWYgT2JqZWN0LCBmaWVsZHMgdG8gdmFsaWRhdGUuIElmIHRoZSB0cmlnZ2VyIGlzIGEgY2xvdWQgZnVuY3Rpb24sIGByZXF1ZXN0LnBhcmFtc2Agd2lsbCBiZSB2YWxpZGF0ZWQsIG90aGVyd2lzZSBgcmVxdWVzdC5vYmplY3RgLlxuICogQHByb3BlcnR5IHtTdHJpbmd9IGZpZWxkcy5maWVsZCBuYW1lIG9mIGZpZWxkIHRvIHZhbGlkYXRlLlxuICogQHByb3BlcnR5IHtTdHJpbmd9IGZpZWxkcy5maWVsZC50eXBlIGV4cGVjdGVkIHR5cGUgb2YgZGF0YSBmb3IgZmllbGQuXG4gKiBAcHJvcGVydHkge0Jvb2xlYW59IGZpZWxkcy5maWVsZC5jb25zdGFudCB3aGV0aGVyIHRoZSBmaWVsZCBjYW4gYmUgbW9kaWZpZWQgb24gdGhlIG9iamVjdC5cbiAqIEBwcm9wZXJ0eSB7QW55fSBmaWVsZHMuZmllbGQuZGVmYXVsdCBkZWZhdWx0IHZhbHVlIGlmIGZpZWxkIGlzIGBudWxsYCwgb3IgaW5pdGlhbCB2YWx1ZSBgY29uc3RhbnRgIGlzIGB0cnVlYC5cbiAqIEBwcm9wZXJ0eSB7QXJyYXl8ZnVuY3Rpb258QW55fSBmaWVsZHMuZmllbGQub3B0aW9ucyBhcnJheSBvZiBvcHRpb25zIHRoYXQgdGhlIGZpZWxkIGNhbiBiZSwgZnVuY3Rpb24gdG8gdmFsaWRhdGUgZmllbGQsIG9yIHNpbmdsZSB2YWx1ZS4gVGhyb3cgYW4gZXJyb3IgaWYgdmFsdWUgaXMgaW52YWxpZC5cbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBmaWVsZHMuZmllbGQuZXJyb3IgY3VzdG9tIGVycm9yIG1lc3NhZ2UgaWYgZmllbGQgaXMgaW52YWxpZC5cbiAqL1xuIl0sIm1hcHBpbmdzIjoiOztBQUFBLElBQUFBLEtBQUEsR0FBQUMsT0FBQTtBQUNBLElBQUFDLFFBQUEsR0FBQUMsdUJBQUEsQ0FBQUYsT0FBQTtBQUNBLElBQUFHLFlBQUEsR0FBQUgsT0FBQTtBQUE4QyxTQUFBRSx3QkFBQUUsQ0FBQSxFQUFBQyxDQUFBLDZCQUFBQyxPQUFBLE1BQUFDLENBQUEsT0FBQUQsT0FBQSxJQUFBRSxDQUFBLE9BQUFGLE9BQUEsWUFBQUosdUJBQUEsWUFBQUEsQ0FBQUUsQ0FBQSxFQUFBQyxDQUFBLFNBQUFBLENBQUEsSUFBQUQsQ0FBQSxJQUFBQSxDQUFBLENBQUFLLFVBQUEsU0FBQUwsQ0FBQSxNQUFBTSxDQUFBLEVBQUFDLENBQUEsRUFBQUMsQ0FBQSxLQUFBQyxTQUFBLFFBQUFDLE9BQUEsRUFBQVYsQ0FBQSxpQkFBQUEsQ0FBQSx1QkFBQUEsQ0FBQSx5QkFBQUEsQ0FBQSxTQUFBUSxDQUFBLE1BQUFGLENBQUEsR0FBQUwsQ0FBQSxHQUFBRyxDQUFBLEdBQUFELENBQUEsUUFBQUcsQ0FBQSxDQUFBSyxHQUFBLENBQUFYLENBQUEsVUFBQU0sQ0FBQSxDQUFBTSxHQUFBLENBQUFaLENBQUEsR0FBQU0sQ0FBQSxDQUFBTyxHQUFBLENBQUFiLENBQUEsRUFBQVEsQ0FBQSxnQkFBQVAsQ0FBQSxJQUFBRCxDQUFBLGdCQUFBQyxDQUFBLE9BQUFhLGNBQUEsQ0FBQUMsSUFBQSxDQUFBZixDQUFBLEVBQUFDLENBQUEsT0FBQU0sQ0FBQSxJQUFBRCxDQUFBLEdBQUFVLE1BQUEsQ0FBQUMsY0FBQSxLQUFBRCxNQUFBLENBQUFFLHdCQUFBLENBQUFsQixDQUFBLEVBQUFDLENBQUEsT0FBQU0sQ0FBQSxDQUFBSyxHQUFBLElBQUFMLENBQUEsQ0FBQU0sR0FBQSxJQUFBUCxDQUFBLENBQUFFLENBQUEsRUFBQVAsQ0FB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QWlCLEVBQUU7RUFDakYsTUFBTVMsU0FBUyxHQUFHbkYsUUFBUSxDQUFDb0YsWUFBWSxDQUFDbEIsVUFBVSxDQUFDO0VBQ25EeEMsaUJBQWlCLENBQUNnRCxpQkFBaUIsQ0FBQztFQUNwQzFFLFFBQVEsQ0FBQ3FGLFVBQVUsQ0FDakJyRixRQUFRLENBQUNzRixLQUFLLENBQUMwQixVQUFVLEVBQ3pCN0IsU0FBUyxFQUNUVixPQUFPLEVBQ1BHLFdBQUssQ0FBQ0MsYUFBYSxFQUNuQkgsaUJBQ0YsQ0FBQztBQUNILENBQUM7QUFFREosVUFBVSxDQUFDMkMsZUFBZSxHQUFHLE1BQU07RUFDakNqSCxRQUFRLENBQUNrSCxjQUFjLENBQUMsQ0FBQztFQUN6QixNQUFNWixNQUFNLEdBQUdoRixNQUFNLENBQUNQLEdBQUcsQ0FBQzZELFdBQUssQ0FBQ0MsYUFBYSxDQUFDO0VBQzlDeUIsTUFBTSxFQUFFYSxzQkFBc0IsQ0FBQyxDQUFDO0FBQ2xDLENBQUM7QUFFRDdDLFVBQVUsQ0FBQzhDLFlBQVksR0FBRyxNQUFNO0VBQzlCO0VBQ0FDLE9BQU8sQ0FBQ0MsSUFBSSxDQUNWLDROQUNGLENBQUM7QUFDSCxDQUFDO0FBRURDLE1BQU0sQ0FBQ0MsT0FBTyxHQUFHbEQsVUFBVTs7QUFFM0I7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImlnbm9yZUxpc3QiOltdfQ==