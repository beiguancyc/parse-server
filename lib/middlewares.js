"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.addRateLimit = exports.DEFAULT_ALLOWED_HEADERS = void 0;
exports.allowCrossDomain = allowCrossDomain;
exports.allowDoubleForwardSlash = allowDoubleForwardSlash;
exports.allowMethodOverride = allowMethodOverride;
exports.checkIp = void 0;
exports.enforceMasterKeyAccess = enforceMasterKeyAccess;
exports.enforceRouteAllowList = enforceRouteAllowList;
exports.handleParseAuth = handleParseAuth;
exports.handleParseErrors = handleParseErrors;
exports.handleParseHeaders = handleParseHeaders;
exports.handleParseHealth = handleParseHealth;
exports.handleParseSession = void 0;
exports.promiseEnforceMasterKeyAccess = promiseEnforceMasterKeyAccess;
exports.promiseEnsureIdempotency = promiseEnsureIdempotency;
var _cache = _interopRequireDefault(require("./cache"));
var _Utils = _interopRequireDefault(require("./Utils"));
var _node = _interopRequireDefault(require("parse/node"));
var _Auth = _interopRequireDefault(require("./Auth"));
var _Config = _interopRequireDefault(require("./Config"));
var _ClientSDK = _interopRequireDefault(require("./ClientSDK"));
var _logger = _interopRequireDefault(require("./logger"));
var _rest = _interopRequireDefault(require("./rest"));
var _MongoStorageAdapter = _interopRequireDefault(require("./Adapters/Storage/Mongo/MongoStorageAdapter"));
var _PostgresStorageAdapter = _interopRequireDefault(require("./Adapters/Storage/Postgres/PostgresStorageAdapter"));
var _expressRateLimit = _interopRequireDefault(require("express-rate-limit"));
var _Definitions = require("./Options/Definitions");
var _pathToRegexp = require("path-to-regexp");
var _rateLimitRedis = _interopRequireDefault(require("rate-limit-redis"));
var _redis = require("redis");
var _net = require("net");
var _Error = require("./Error");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const DEFAULT_ALLOWED_HEADERS = exports.DEFAULT_ALLOWED_HEADERS = 'X-Parse-Master-Key, X-Parse-REST-API-Key, X-Parse-Javascript-Key, X-Parse-Application-Id, X-Parse-Client-Version, X-Parse-Session-Token, X-Requested-With, X-Parse-Revocable-Session, X-Parse-Request-Id, Content-Type, Pragma, Cache-Control';
const getMountForRequest = function (req) {
  const mountPathLength = req.originalUrl.length - req.url.length;
  const mountPath = req.originalUrl.slice(0, mountPathLength);
  return req.protocol + '://' + req.get('host') + mountPath;
};
const getBlockList = (ipRangeList, store) => {
  if (store.get('blockList')) {
    return store.get('blockList');
  }
  const blockList = new _net.BlockList();
  ipRangeList.forEach(fullIp => {
    if (fullIp === '::/0' || fullIp === '::' || fullIp === '::0') {
      store.set('allowAllIpv6', true);
      return;
    }
    if (fullIp === '0.0.0.0/0' || fullIp === '0.0.0.0') {
      store.set('allowAllIpv4', true);
      return;
    }
    const [ip, mask] = fullIp.split('/');
    if (!mask) {
      blockList.addAddress(ip, (0, _net.isIPv4)(ip) ? 'ipv4' : 'ipv6');
    } else {
      blockList.addSubnet(ip, Number(mask), (0, _net.isIPv4)(ip) ? 'ipv4' : 'ipv6');
    }
  });
  store.set('blockList', blockList);
  return blockList;
};
const checkIp = (ip, ipRangeList, store) => {
  const incomingIpIsV4 = (0, _net.isIPv4)(ip);
  const blockList = getBlockList(ipRangeList, store);
  if (store.get(ip)) {
    return true;
  }
  if (store.get('allowAllIpv4') && incomingIpIsV4) {
    return true;
  }
  if (store.get('allowAllIpv6') && !incomingIpIsV4) {
    return true;
  }
  const result = blockList.check(ip, incomingIpIsV4 ? 'ipv4' : 'ipv6');

  // If the ip is in the list, we store the result in the store
  // so we have a optimized path for the next request
  if (ipRangeList.includes(ip) && result) {
    store.set(ip, result);
  }
  return result;
};

// Checks that the request is authorized for this app and checks user
// auth too.
// The bodyparser should run before this middleware.
// Adds info to the request:
// req.config - the Config for this app
// req.auth - the Auth for this request
exports.checkIp = checkIp;
async function handleParseHeaders(req, res, next) {
  var mount = getMountForRequest(req);
  let context = {};
  if (req.get('X-Parse-Cloud-Context') != null) {
    try {
      context = JSON.parse(req.get('X-Parse-Cloud-Context'));
      if (Object.prototype.toString.call(context) !== '[object Object]') {
        throw 'Context is not an object';
      }
    } catch {
      return malformedContext(req, res);
    }
  }
  var info = {
    appId: req.get('X-Parse-Application-Id'),
    sessionToken: req.get('X-Parse-Session-Token'),
    masterKey: req.get('X-Parse-Master-Key'),
    maintenanceKey: req.get('X-Parse-Maintenance-Key'),
    installationId: req.get('X-Parse-Installation-Id'),
    clientKey: req.get('X-Parse-Client-Key'),
    javascriptKey: req.get('X-Parse-Javascript-Key'),
    dotNetKey: req.get('X-Parse-Windows-Key'),
    restAPIKey: req.get('X-Parse-REST-API-Key'),
    clientVersion: req.get('X-Parse-Client-Version'),
    context: context
  };
  var basicAuth = httpAuth(req);
  if (basicAuth) {
    var basicAuthAppId = basicAuth.appId;
    if (_cache.default.get(basicAuthAppId)) {
      info.appId = basicAuthAppId;
      info.masterKey = basicAuth.masterKey || info.masterKey;
      info.javascriptKey = basicAuth.javascriptKey || info.javascriptKey;
    }
  }
  if (req.body) {
    // Unity SDK sends a _noBody key which needs to be removed.
    // Unclear at this point if action needs to be taken.
    delete req.body._noBody;
  }
  var fileViaJSON = false;
  if (!info.appId || !_cache.default.get(info.appId)) {
    // See if we can find the app id on the body.
    if (Buffer.isBuffer(req.body)) {
      // The only chance to find the app id is if this is a file
      // upload that actually is a JSON body. So try to parse it.
      // https://github.com/parse-community/parse-server/issues/6589
      // It is also possible that the client is trying to upload a file but forgot
      // to provide x-parse-app-id in header and parse a binary file will fail
      try {
        req.body = JSON.parse(req.body);
      } catch {
        return invalidRequest(req, res);
      }
      fileViaJSON = true;
    }
    if (req.body) {
      delete req.body._RevocableSession;
    }
    if (req.body && req.body._ApplicationId && _cache.default.get(req.body._ApplicationId) && (!info.masterKey || _cache.default.get(req.body._ApplicationId).masterKey === info.masterKey)) {
      info.appId = req.body._ApplicationId;
      info.javascriptKey = req.body._JavaScriptKey || '';
      delete req.body._ApplicationId;
      delete req.body._JavaScriptKey;
      // TODO: test that the REST API formats generated by the other
      // SDKs are handled ok
      if (req.body._ClientVersion) {
        if (typeof req.body._ClientVersion !== 'string') {
          return invalidRequest(req, res);
        }
        info.clientVersion = req.body._ClientVersion;
        delete req.body._ClientVersion;
      }
      if (req.body._InstallationId) {
        if (typeof req.body._InstallationId !== 'string') {
          return invalidRequest(req, res);
        }
        info.installationId = req.body._InstallationId;
        delete req.body._InstallationId;
      }
      if (req.body._SessionToken) {
        if (typeof req.body._SessionToken !== 'string') {
          return invalidRequest(req, res);
        }
        info.sessionToken = req.body._SessionToken;
        delete req.body._SessionToken;
      }
      if (req.body._MasterKey) {
        if (typeof req.body._MasterKey !== 'string') {
          return invalidRequest(req, res);
        }
        info.masterKey = req.body._MasterKey;
        delete req.body._MasterKey;
      }
      if (req.body._context) {
        if (_Utils.default.isObject(req.body._context)) {
          info.context = req.body._context;
        } else {
          try {
            info.context = JSON.parse(req.body._context);
            if (Object.prototype.toString.call(info.context) !== '[object Object]') {
              throw 'Context is not an object';
            }
          } catch {
            return malformedContext(req, res);
          }
        }
        delete req.body._context;
      }
      if (req.body._ContentType) {
        if (typeof req.body._ContentType !== 'string') {
          return invalidRequest(req, res);
        }
        req.headers['content-type'] = req.body._ContentType;
        delete req.body._ContentType;
      }
    } else {
      return invalidRequest(req, res);
    }
  }
  if (info.sessionToken && typeof info.sessionToken !== 'string') {
    return invalidRequest(req, res);
  }
  if (info.clientVersion && typeof info.clientVersion === 'string') {
    info.clientSDK = _ClientSDK.default.fromString(info.clientVersion);
  }
  if (fileViaJSON && req.body) {
    if (req.body.base64 && typeof req.body.base64 !== 'string') {
      return invalidRequest(req, res);
    }
    req.fileData = req.body.fileData;
    // We need to repopulate req.body with a buffer
    var base64 = req.body.base64;
    req.body = Buffer.from(base64, 'base64');
  }
  const clientIp = getClientIp(req);
  const config = req.config || _Config.default.get(info.appId, mount);
  if (config.state && config.state !== 'ok') {
    res.status(500);
    res.json({
      code: _node.default.Error.INTERNAL_SERVER_ERROR,
      error: `Invalid server state: ${config.state}`
    });
    return;
  }
  if (!req.config) {
    await config.loadKeys();
  }
  info.app = _cache.default.get(info.appId);
  req.config = config;
  req.config.headers = req.headers || {};
  req.config.ip = clientIp;
  req.info = info;

  // Skip key detection if already resolved by handleParseAuth (header-based).
  // Only resolve here for body-based _MasterKey (info.masterKey may come from body).
  if (!req.auth || !req.auth.isMaster && !req.auth.isMaintenance) {
    const resolved = await resolveKeyAuth({
      config: req.config,
      keyValue: info.masterKey,
      maintenanceKeyValue: info.maintenanceKey,
      installationId: info.installationId,
      clientIp
    });
    if (resolved) {
      req.auth = resolved;
    }
  }
  if (req.auth && (req.auth.isMaster || req.auth.isMaintenance)) {
    return handleRateLimit(req, res, next);
  }

  // Client keys are not required in parse-server, but if any have been configured in the server, validate them
  //  to preserve original behavior.
  const keys = ['clientKey', 'javascriptKey', 'dotNetKey', 'restAPIKey'];
  const oneKeyConfigured = keys.some(function (key) {
    return req.config[key] !== undefined;
  });
  const oneKeyMatches = keys.some(function (key) {
    return req.config[key] !== undefined && info[key] === req.config[key];
  });
  if (oneKeyConfigured && !oneKeyMatches) {
    return invalidRequest(req, res);
  }
  if (req.url == '/login') {
    delete info.sessionToken;
  }
  if (req.userFromJWT) {
    req.auth = new _Auth.default.Auth({
      config: req.config,
      installationId: info.installationId,
      isMaster: false,
      user: req.userFromJWT
    });
    return handleRateLimit(req, res, next);
  }
  if (!info.sessionToken) {
    req.auth = new _Auth.default.Auth({
      config: req.config,
      installationId: info.installationId,
      isMaster: false
    });
  }
  handleRateLimit(req, res, next);
}
const handleRateLimit = async (req, res, next) => {
  const rateLimits = req.config.rateLimits || [];
  try {
    await Promise.all(rateLimits.map(async limit => {
      const pathExp = limit.path.regexp || limit.path;
      if (pathExp.test(req.url)) {
        await limit.handler(req, res, err => {
          if (err) {
            if (err.code === _node.default.Error.CONNECTION_FAILED) {
              throw err;
            }
            req.config.loggerController.error('An unknown error occured when attempting to apply the rate limiter: ', err);
          }
        });
      }
    }));
  } catch (error) {
    res.status(429);
    res.json({
      code: _node.default.Error.CONNECTION_FAILED,
      error: error.message
    });
    return;
  }
  next();
};
const handleParseSession = async (req, res, next) => {
  try {
    const info = req.info;
    if (req.auth || req.url === '/sessions/me' && req.method === 'GET') {
      next();
      return;
    }
    let requestAuth = null;
    if (info.sessionToken && req.url === '/upgradeToRevocableSession' && info.sessionToken.indexOf('r:') != 0) {
      requestAuth = await _Auth.default.getAuthForLegacySessionToken({
        config: req.config,
        installationId: info.installationId,
        sessionToken: info.sessionToken
      });
    } else {
      requestAuth = await _Auth.default.getAuthForSessionToken({
        config: req.config,
        installationId: info.installationId,
        sessionToken: info.sessionToken
      });
    }
    req.auth = requestAuth;
    next();
  } catch (error) {
    if (error instanceof _node.default.Error) {
      next(error);
      return;
    }
    // Log full error details internally, but don't expose to client
    req.config.loggerController.error('error getting auth for sessionToken', error);
    next(new _node.default.Error(_node.default.Error.UNKNOWN_ERROR, 'Unknown error'));
  }
};
exports.handleParseSession = handleParseSession;
function getClientIp(req) {
  return req.ip;
}
function httpAuth(req) {
  if (!(req.req || req).headers.authorization) {
    return;
  }
  var header = (req.req || req).headers.authorization;
  var appId, masterKey, javascriptKey;

  // parse header
  var authPrefix = 'basic ';
  var match = header.toLowerCase().indexOf(authPrefix);
  if (match == 0) {
    var encodedAuth = header.substring(authPrefix.length, header.length);
    var credentials = decodeBase64(encodedAuth).split(':');
    if (credentials.length == 2) {
      appId = credentials[0];
      var key = credentials[1];
      var jsKeyPrefix = 'javascript-key=';
      var matchKey = key.indexOf(jsKeyPrefix);
      if (matchKey == 0) {
        javascriptKey = key.substring(jsKeyPrefix.length, key.length);
      } else {
        masterKey = key;
      }
    }
  }
  return {
    appId: appId,
    masterKey: masterKey,
    javascriptKey: javascriptKey
  };
}
function decodeBase64(str) {
  return Buffer.from(str, 'base64').toString();
}
function allowCrossDomain(appId) {
  return (req, res, next) => {
    const config = _Config.default.get(appId, getMountForRequest(req));
    let allowHeaders = DEFAULT_ALLOWED_HEADERS;
    if (config && config.allowHeaders) {
      allowHeaders += `, ${config.allowHeaders.join(', ')}`;
    }
    const baseOrigins = typeof config?.allowOrigin === 'string' ? [config.allowOrigin] : config?.allowOrigin ?? ['*'];
    const requestOrigin = req.headers.origin;
    const allowOrigins = requestOrigin && baseOrigins.includes(requestOrigin) ? requestOrigin : baseOrigins[0];
    res.header('Access-Control-Allow-Origin', allowOrigins);
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', allowHeaders);
    res.header('Access-Control-Expose-Headers', 'X-Parse-Job-Status-Id, X-Parse-Push-Status-Id');
    // intercept OPTIONS method
    if ('OPTIONS' == req.method) {
      res.sendStatus(200);
    } else {
      next();
    }
  };
}
function allowMethodOverride(req, res, next) {
  if (req.method === 'POST' && req.body?._method) {
    if (typeof req.body._method === 'string') {
      req.originalMethod = req.method;
      req.method = req.body._method.toUpperCase();
    }
    delete req.body._method;
  }
  next();
}
async function resolveKeyAuth({
  config,
  keyValue,
  maintenanceKeyValue,
  installationId,
  clientIp
}) {
  if (maintenanceKeyValue && maintenanceKeyValue === config.maintenanceKey) {
    if (checkIp(clientIp, config.maintenanceKeyIps || [], config.maintenanceKeyIpsStore)) {
      return new _Auth.default.Auth({
        config,
        installationId,
        isMaintenance: true
      });
    }
    const log = config.loggerController || _logger.default;
    log.error(`Request using maintenance key rejected as the request IP address '${clientIp}' is not set in Parse Server option 'maintenanceKeyIps'.`);
    const error = new Error();
    error.status = 403;
    error.message = 'unauthorized';
    throw error;
  }
  const masterKey = await config.loadMasterKey();
  if (keyValue === masterKey) {
    if (checkIp(clientIp, config.masterKeyIps || [], config.masterKeyIpsStore)) {
      return new _Auth.default.Auth({
        config,
        installationId,
        isMaster: true
      });
    }
    const log = config.loggerController || _logger.default;
    log.error(`Request using master key rejected as the request IP address '${clientIp}' is not set in Parse Server option 'masterKeyIps'.`);
    const error = new Error();
    error.status = 403;
    error.message = 'unauthorized';
    throw error;
  }
  if (keyValue && typeof config.readOnlyMasterKey !== 'undefined' && config.readOnlyMasterKey && keyValue === config.readOnlyMasterKey) {
    if (checkIp(clientIp, config.readOnlyMasterKeyIps || [], config.readOnlyMasterKeyIpsStore)) {
      return new _Auth.default.Auth({
        config,
        installationId,
        isMaster: true,
        isReadOnly: true
      });
    }
    const log = config.loggerController || _logger.default;
    log.error(`Request using read-only master key rejected as the request IP address '${clientIp}' is not set in Parse Server option 'readOnlyMasterKeyIps'.`);
    const error = new Error();
    error.status = 403;
    error.message = 'unauthorized';
    throw error;
  }
  return null;
}
function handleParseAuth(appId) {
  return async (req, res, next) => {
    const mount = getMountForRequest(req);
    const config = _Config.default.get(appId, mount);
    if (!config) {
      return next();
    }
    req.config = config;
    const clientIp = getClientIp(req);
    req.config.ip = clientIp;
    await config.loadKeys();
    const resolved = await resolveKeyAuth({
      config,
      keyValue: req.get('X-Parse-Master-Key') || null,
      maintenanceKeyValue: req.get('X-Parse-Maintenance-Key') || null,
      installationId: req.get('X-Parse-Installation-Id') || 'cloud',
      clientIp
    });
    if (resolved) {
      req.auth = resolved;
    }
    return next();
  };
}
function handleParseHealth(options) {
  return (req, res) => {
    res.status(options.state === 'ok' ? 200 : 503);
    if (options.state === 'starting') {
      res.set('Retry-After', 1);
    }
    res.json({
      status: options.state
    });
  };
}
function enforceRouteAllowList(req, res, next) {
  const config = req.config;
  if (!config || config.routeAllowList === undefined || config.routeAllowList === null) {
    return next();
  }
  if (req.auth && (req.auth.isMaster || req.auth.isMaintenance)) {
    return next();
  }
  let path = req.originalUrl;
  if (config.mount) {
    const mountPath = new URL(config.mount).pathname;
    if (path.startsWith(mountPath)) {
      path = path.substring(mountPath.length);
    }
  }
  if (path.startsWith('/')) {
    path = path.substring(1);
  }
  if (path.endsWith('/')) {
    path = path.substring(0, path.length - 1);
  }
  const queryIndex = path.indexOf('?');
  if (queryIndex !== -1) {
    path = path.substring(0, queryIndex);
  }
  const regexes = config._routeAllowListRegex || [];
  for (const regex of regexes) {
    if (regex.test(path)) {
      return next();
    }
  }
  throw (0, _Error.createSanitizedError)(_node.default.Error.OPERATION_FORBIDDEN, `Route not allowed by routeAllowList: ${req.method} ${path}`, config);
}
function handleParseErrors(err, req, res, next) {
  const log = req.config && req.config.loggerController || _logger.default;
  if (err instanceof _node.default.Error) {
    if (req.config && req.config.enableExpressErrorHandler) {
      return next(err);
    }
    const signupUsernameTakenLevel = req.config?.logLevels?.signupUsernameTaken || 'info';
    let httpStatus;
    // TODO: fill out this mapping
    switch (err.code) {
      case _node.default.Error.INTERNAL_SERVER_ERROR:
        httpStatus = 500;
        break;
      case _node.default.Error.OBJECT_NOT_FOUND:
        httpStatus = 404;
        break;
      default:
        httpStatus = 400;
    }
    res.status(httpStatus);
    res.json({
      code: err.code,
      error: err.message
    });
    if (err.code === _node.default.Error.USERNAME_TAKEN) {
      if (signupUsernameTakenLevel !== 'silent') {
        const loggerMethod = typeof log[signupUsernameTakenLevel] === 'function' ? log[signupUsernameTakenLevel].bind(log) : log.error.bind(log);
        loggerMethod('Parse error: ', err);
      }
    } else {
      log.error('Parse error: ', err);
    }
  } else if (err.status && err.message) {
    res.status(err.status);
    res.json({
      error: err.message
    });
    if (!(process && process.env.TESTING)) {
      next(err);
    }
  } else {
    log.error('Uncaught internal server error.', err, err.stack);
    res.status(500);
    res.json({
      code: _node.default.Error.INTERNAL_SERVER_ERROR,
      message: 'Internal server error.'
    });
    if (!(process && process.env.TESTING)) {
      next(err);
    }
  }
}
function enforceMasterKeyAccess(req, res, next) {
  if (!req.auth.isMaster) {
    const error = (0, _Error.createSanitizedHttpError)(403, 'unauthorized: master key is required', req.config);
    res.status(error.status);
    res.end(`{"error":"${error.message}"}`);
    return;
  }
  next();
}
function promiseEnforceMasterKeyAccess(request) {
  if (!request.auth.isMaster) {
    throw (0, _Error.createSanitizedHttpError)(403, 'unauthorized: master key is required', request.config);
  }
  return Promise.resolve();
}
const addRateLimit = (route, config, cloud) => {
  if (typeof config === 'string') {
    config = _Config.default.get(config);
  }
  for (const key in route) {
    if (!_Definitions.RateLimitOptions[key]) {
      throw `Invalid rate limit option "${key}"`;
    }
  }
  if (!config.rateLimits) {
    config.rateLimits = [];
  }
  const redisStore = {
    connectionPromise: Promise.resolve(),
    store: null
  };
  if (route.redisUrl) {
    const log = config?.loggerController || _logger.default;
    const client = (0, _redis.createClient)({
      url: route.redisUrl
    });
    client.on('error', err => {
      log.error('Middlewares addRateLimit Redis client error', {
        error: err
      });
    });
    client.on('connect', () => {});
    client.on('reconnecting', () => {});
    client.on('ready', () => {});
    redisStore.connectionPromise = async () => {
      if (client.isOpen) {
        return;
      }
      try {
        await client.connect();
      } catch (e) {
        log.error(`Could not connect to redisURL in rate limit: ${e}`);
      }
    };
    redisStore.connectionPromise();
    redisStore.store = new _rateLimitRedis.default({
      sendCommand: async (...args) => {
        await redisStore.connectionPromise();
        return client.sendCommand(args);
      }
    });
  }
  config.rateLimits.push({
    path: (0, _pathToRegexp.pathToRegexp)(route.requestPath),
    requestCount: route.requestCount,
    requestMethods: route.requestMethods,
    includeMasterKey: route.includeMasterKey,
    includeInternalRequests: route.includeInternalRequests,
    errorResponseMessage: route.errorResponseMessage || _Definitions.RateLimitOptions.errorResponseMessage.default,
    handler: (0, _expressRateLimit.default)({
      windowMs: route.requestTimeWindow,
      max: route.requestCount,
      message: route.errorResponseMessage || _Definitions.RateLimitOptions.errorResponseMessage.default,
      handler: (request, response, next, options) => {
        throw {
          code: _node.default.Error.CONNECTION_FAILED,
          message: options.message
        };
      },
      skip: request => {
        if (request.ip === '127.0.0.1' && !route.includeInternalRequests) {
          return true;
        }
        if (route.includeMasterKey) {
          return false;
        }
        if (route.requestMethods) {
          const methodsToCheck = new Set([request.method]);
          if (request._batchOriginalMethod) {
            methodsToCheck.add(request._batchOriginalMethod);
          }
          if (Array.isArray(route.requestMethods)) {
            if (!route.requestMethods.some(m => methodsToCheck.has(m))) {
              return true;
            }
          } else {
            const regExp = new RegExp(route.requestMethods);
            if (![...methodsToCheck].some(m => regExp.test(m))) {
              return true;
            }
          }
        }
        return request.auth?.isMaster;
      },
      keyGenerator: async request => {
        if (route.zone === _node.default.Server.RateLimitZone.global) {
          return request.config.appId;
        }
        const token = request.info.sessionToken;
        if (route.zone === _node.default.Server.RateLimitZone.session && token) {
          return token;
        }
        if (route.zone === _node.default.Server.RateLimitZone.user && token) {
          if (!request.auth) {
            await new Promise(resolve => handleParseSession(request, null, resolve));
          }
          if (request.auth?.user?.id && route.zone === 'user') {
            return request.auth.user.id;
          }
        }
        return request.config.ip;
      },
      store: redisStore.store
    }),
    cloud
  });
  _Config.default.put(config);
};

/**
 * Deduplicates a request to ensure idempotency. Duplicates are determined by the request ID
 * in the request header. If a request has no request ID, it is executed anyway.
 * @param {*} req The request to evaluate.
 * @returns Promise<{}>
 */
exports.addRateLimit = addRateLimit;
function promiseEnsureIdempotency(req) {
  // Enable feature only for MongoDB
  if (!(req.config.database.adapter instanceof _MongoStorageAdapter.default || req.config.database.adapter instanceof _PostgresStorageAdapter.default)) {
    return Promise.resolve();
  }
  // Get parameters
  const config = req.config;
  const requestId = ((req || {}).headers || {})['x-parse-request-id'];
  const {
    paths,
    ttl
  } = config.idempotencyOptions;
  if (!requestId || !config.idempotencyOptions) {
    return Promise.resolve();
  }
  // Request path may contain trailing slashes, depending on the original request, so remove
  // leading and trailing slashes to make it easier to specify paths in the configuration
  const reqPath = req.path.replace(/^\/|\/$/, '');
  // Determine whether idempotency is enabled for current request path
  let match = false;
  for (const path of paths) {
    // Assume one wants a path to always match from the beginning to prevent any mistakes
    const regex = new RegExp(path.charAt(0) === '^' ? path : '^' + path);
    if (reqPath.match(regex)) {
      match = true;
      break;
    }
  }
  if (!match) {
    return Promise.resolve();
  }
  // Try to store request
  const expiryDate = new Date(new Date().setSeconds(new Date().getSeconds() + ttl));
  return _rest.default.create(config, _Auth.default.master(config), '_Idempotency', {
    reqId: requestId,
    expire: _node.default._encode(expiryDate)
  }).catch(e => {
    if (e.code == _node.default.Error.DUPLICATE_VALUE) {
      throw new _node.default.Error(_node.default.Error.DUPLICATE_REQUEST, 'Duplicate request');
    }
    throw e;
  });
}
function invalidRequest(req, res) {
  res.status(403);
  res.end('{"error":"unauthorized"}');
}
function malformedContext(req, res) {
  res.status(400);
  res.json({
    code: _node.default.Error.INVALID_JSON,
    error: 'Invalid object for context.'
  });
}

/**
 * Express 4 allowed a double forward slash between a route and router. Although
 * this should be considered an anti-pattern, we need to support it for backwards
 * compatibility.
 *
 * Technically valid URL with double foroward slash:
 * http://localhost:1337/parse//functions/testFunction
 */
function allowDoubleForwardSlash(req, res, next) {
  req.url = req.url.startsWith('//') ? req.url.substring(1) : req.url;
  next();
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfY2FjaGUiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwicmVxdWlyZSIsIl9VdGlscyIsIl9ub2RlIiwiX0F1dGgiLCJfQ29uZmlnIiwiX0NsaWVudFNESyIsIl9sb2dnZXIiLCJfcmVzdCIsIl9Nb25nb1N0b3JhZ2VBZGFwdGVyIiwiX1Bvc3RncmVzU3RvcmFnZUFkYXB0ZXIiLCJfZXhwcmVzc1JhdGVMaW1pdCIsIl9EZWZpbml0aW9ucyIsIl9wYXRoVG9SZWdleHAiLCJfcmF0ZUxpbWl0UmVkaXMiLCJfcmVkaXMiLCJfbmV0IiwiX0Vycm9yIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiREVGQVVMVF9BTExPV0VEX0hFQURFUlMiLCJleHBvcnRzIiwiZ2V0TW91bnRGb3JSZXF1ZXN0IiwicmVxIiwibW91bnRQYXRoTGVuZ3RoIiwib3JpZ2luYWxVcmwiLCJsZW5ndGgiLCJ1cmwiLCJtb3VudFBhdGgiLCJzbGljZSIsInByb3RvY29sIiwiZ2V0IiwiZ2V0QmxvY2tMaXN0IiwiaXBSYW5nZUxpc3QiLCJzdG9yZSIsImJsb2NrTGlzdCIsIkJsb2NrTGlzdCIsImZvckVhY2giLCJmdWxsSXAiLCJzZXQiLCJpcCIsIm1hc2siLCJzcGxpdCIsImFkZEFkZHJlc3MiLCJpc0lQdjQiLCJhZGRTdWJuZXQiLCJOdW1iZXIiLCJjaGVja0lwIiwiaW5jb21pbmdJcElzVjQiLCJyZXN1bHQiLCJjaGVjayIsImluY2x1ZGVzIiwiaGFuZGxlUGFyc2VIZWFkZXJzIiwicmVzIiwibmV4dCIsIm1vdW50IiwiY29udGV4dCIsIkpTT04iLCJwYXJzZSIsIk9iamVjdCIsInByb3RvdHlwZSIsInRvU3RyaW5nIiwiY2FsbCIsIm1hbGZvcm1lZENvbnRleHQiLCJpbmZvIiwiYXBwSWQiLCJzZXNzaW9uVG9rZW4iLCJtYXN0ZXJLZXkiLCJtYWludGVuYW5jZUtleSIsImluc3RhbGxhdGlvbklkIiwiY2xpZW50S2V5IiwiamF2YXNjcmlwdEtleSIsImRvdE5ldEtleSIsInJlc3RBUElLZXkiLCJjbGllbnRWZXJzaW9uIiwiYmFzaWNBdXRoIiwiaHR0cEF1dGgiLCJiYXNpY0F1dGhBcHBJZCIsIkFwcENhY2hlIiwiYm9keSIsIl9ub0JvZHkiLCJmaWxlVmlhSlNPTiIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiaW52YWxpZFJlcXVlc3QiLCJfUmV2b2NhYmxlU2Vzc2lvbiIsIl9BcHBsaWNhdGlvbklkIiwiX0phdmFTY3JpcHRLZXkiLCJfQ2xpZW50VmVyc2lvbiIsIl9JbnN0YWxsYXRpb25JZCIsIl9TZXNzaW9uVG9rZW4iLCJfTWFzdGVyS2V5IiwiX2NvbnRleHQiLCJVdGlscyIsImlzT2JqZWN0IiwiX0NvbnRlbnRUeXBlIiwiaGVhZGVycyIsImNsaWVudFNESyIsIkNsaWVudFNESyIsImZyb21TdHJpbmciLCJiYXNlNjQiLCJmaWxlRGF0YSIsImZyb20iLCJjbGllbnRJcCIsImdldENsaWVudElwIiwiY29uZmlnIiwiQ29uZmlnIiwic3RhdGUiLCJzdGF0dXMiLCJqc29uIiwiY29kZSIsIlBhcnNlIiwiRXJyb3IiLCJJTlRFUk5BTF9TRVJWRVJfRVJST1IiLCJlcnJvciIsImxvYWRLZXlzIiwiYXBwIiwiYXV0aCIsImlzTWFzdGVyIiwiaXNNYWludGVuYW5jZSIsInJlc29sdmVkIiwicmVzb2x2ZUtleUF1dGgiLCJrZXlWYWx1ZSIsIm1haW50ZW5hbmNlS2V5VmFsdWUiLCJoYW5kbGVSYXRlTGltaXQiLCJrZXlzIiwib25lS2V5Q29uZmlndXJlZCIsInNvbWUiLCJrZXkiLCJ1bmRlZmluZWQiLCJvbmVLZXlNYXRjaGVzIiwidXNlckZyb21KV1QiLCJBdXRoIiwidXNlciIsInJhdGVMaW1pdHMiLCJQcm9taXNlIiwiYWxsIiwibWFwIiwibGltaXQiLCJwYXRoRXhwIiwicGF0aCIsInJlZ2V4cCIsInRlc3QiLCJoYW5kbGVyIiwiZXJyIiwiQ09OTkVDVElPTl9GQUlMRUQiLCJsb2dnZXJDb250cm9sbGVyIiwibWVzc2FnZSIsImhhbmRsZVBhcnNlU2Vzc2lvbiIsIm1ldGhvZCIsInJlcXVlc3RBdXRoIiwiaW5kZXhPZiIsImdldEF1dGhGb3JMZWdhY3lTZXNzaW9uVG9rZW4iLCJnZXRBdXRoRm9yU2Vzc2lvblRva2VuIiwiVU5LTk9XTl9FUlJPUiIsImF1dGhvcml6YXRpb24iLCJoZWFkZXIiLCJhdXRoUHJlZml4IiwibWF0Y2giLCJ0b0xvd2VyQ2FzZSIsImVuY29kZWRBdXRoIiwic3Vic3RyaW5nIiwiY3JlZGVudGlhbHMiLCJkZWNvZGVCYXNlNjQiLCJqc0tleVByZWZpeCIsIm1hdGNoS2V5Iiwic3RyIiwiYWxsb3dDcm9zc0RvbWFpbiIsImFsbG93SGVhZGVycyIsImpvaW4iLCJiYXNlT3JpZ2lucyIsImFsbG93T3JpZ2luIiwicmVxdWVzdE9yaWdpbiIsIm9yaWdpbiIsImFsbG93T3JpZ2lucyIsInNlbmRTdGF0dXMiLCJhbGxvd01ldGhvZE92ZXJyaWRlIiwiX21ldGhvZCIsIm9yaWdpbmFsTWV0aG9kIiwidG9VcHBlckNhc2UiLCJtYWludGVuYW5jZUtleUlwcyIsIm1haW50ZW5hbmNlS2V5SXBzU3RvcmUiLCJsb2ciLCJkZWZhdWx0TG9nZ2VyIiwibG9hZE1hc3RlcktleSIsIm1hc3RlcktleUlwcyIsIm1hc3RlcktleUlwc1N0b3JlIiwicmVhZE9ubHlNYXN0ZXJLZXkiLCJyZWFkT25seU1hc3RlcktleUlwcyIsInJlYWRPbmx5TWFzdGVyS2V5SXBzU3RvcmUiLCJpc1JlYWRPbmx5IiwiaGFuZGxlUGFyc2VBdXRoIiwiaGFuZGxlUGFyc2VIZWFsdGgiLCJvcHRpb25zIiwiZW5mb3JjZVJvdXRlQWxsb3dMaXN0Iiwicm91dGVBbGxvd0xpc3QiLCJVUkwiLCJwYXRobmFtZSIsInN0YXJ0c1dpdGgiLCJlbmRzV2l0aCIsInF1ZXJ5SW5kZXgiLCJyZWdleGVzIiwiX3JvdXRlQWxsb3dMaXN0UmVnZXgiLCJyZWdleCIsImNyZWF0ZVNhbml0aXplZEVycm9yIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsImhhbmRsZVBhcnNlRXJyb3JzIiwiZW5hYmxlRXhwcmVzc0Vycm9ySGFuZGxlciIsInNpZ251cFVzZXJuYW1lVGFrZW5MZXZlbCIsImxvZ0xldmVscyIsInNpZ251cFVzZXJuYW1lVGFrZW4iLCJodHRwU3RhdHVzIiwiT0JKRUNUX05PVF9GT1VORCIsIlVTRVJOQU1FX1RBS0VOIiwibG9nZ2VyTWV0aG9kIiwiYmluZCIsInByb2Nlc3MiLCJlbnYiLCJURVNUSU5HIiwic3RhY2siLCJlbmZvcmNlTWFzdGVyS2V5QWNjZXNzIiwiY3JlYXRlU2FuaXRpemVkSHR0cEVycm9yIiwiZW5kIiwicHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MiLCJyZXF1ZXN0IiwicmVzb2x2ZSIsImFkZFJhdGVMaW1pdCIsInJvdXRlIiwiY2xvdWQiLCJSYXRlTGltaXRPcHRpb25zIiwicmVkaXNTdG9yZSIsImNvbm5lY3Rpb25Qcm9taXNlIiwicmVkaXNVcmwiLCJjbGllbnQiLCJjcmVhdGVDbGllbnQiLCJvbiIsImlzT3BlbiIsImNvbm5lY3QiLCJSZWRpc1N0b3JlIiwic2VuZENvbW1hbmQiLCJhcmdzIiwicHVzaCIsInBhdGhUb1JlZ2V4cCIsInJlcXVlc3RQYXRoIiwicmVxdWVzdENvdW50IiwicmVxdWVzdE1ldGhvZHMiLCJpbmNsdWRlTWFzdGVyS2V5IiwiaW5jbHVkZUludGVybmFsUmVxdWVzdHMiLCJlcnJvclJlc3BvbnNlTWVzc2FnZSIsInJhdGVMaW1pdCIsIndpbmRvd01zIiwicmVxdWVzdFRpbWVXaW5kb3ciLCJtYXgiLCJyZXNwb25zZSIsInNraXAiLCJtZXRob2RzVG9DaGVjayIsIlNldCIsIl9iYXRjaE9yaWdpbmFsTWV0aG9kIiwiYWRkIiwiQXJyYXkiLCJpc0FycmF5IiwibSIsImhhcyIsInJlZ0V4cCIsIlJlZ0V4cCIsImtleUdlbmVyYXRvciIsInpvbmUiLCJTZXJ2ZXIiLCJSYXRlTGltaXRab25lIiwiZ2xvYmFsIiwidG9rZW4iLCJzZXNzaW9uIiwiaWQiLCJwdXQiLCJwcm9taXNlRW5zdXJlSWRlbXBvdGVuY3kiLCJkYXRhYmFzZSIsImFkYXB0ZXIiLCJNb25nb1N0b3JhZ2VBZGFwdGVyIiwiUG9zdGdyZXNTdG9yYWdlQWRhcHRlciIsInJlcXVlc3RJZCIsInBhdGhzIiwidHRsIiwiaWRlbXBvdGVuY3lPcHRpb25zIiwicmVxUGF0aCIsInJlcGxhY2UiLCJjaGFyQXQiLCJleHBpcnlEYXRlIiwiRGF0ZSIsInNldFNlY29uZHMiLCJnZXRTZWNvbmRzIiwicmVzdCIsImNyZWF0ZSIsIm1hc3RlciIsInJlcUlkIiwiZXhwaXJlIiwiX2VuY29kZSIsImNhdGNoIiwiRFVQTElDQVRFX1ZBTFVFIiwiRFVQTElDQVRFX1JFUVVFU1QiLCJJTlZBTElEX0pTT04iLCJhbGxvd0RvdWJsZUZvcndhcmRTbGFzaCJdLCJzb3VyY2VzIjpbIi4uL3NyYy9taWRkbGV3YXJlcy5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgQXBwQ2FjaGUgZnJvbSAnLi9jYWNoZSc7XG5pbXBvcnQgVXRpbHMgZnJvbSAnLi9VdGlscyc7XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgYXV0aCBmcm9tICcuL0F1dGgnO1xuaW1wb3J0IENvbmZpZyBmcm9tICcuL0NvbmZpZyc7XG5pbXBvcnQgQ2xpZW50U0RLIGZyb20gJy4vQ2xpZW50U0RLJztcbmltcG9ydCBkZWZhdWx0TG9nZ2VyIGZyb20gJy4vbG9nZ2VyJztcbmltcG9ydCByZXN0IGZyb20gJy4vcmVzdCc7XG5pbXBvcnQgTW9uZ29TdG9yYWdlQWRhcHRlciBmcm9tICcuL0FkYXB0ZXJzL1N0b3JhZ2UvTW9uZ28vTW9uZ29TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgUG9zdGdyZXNTdG9yYWdlQWRhcHRlciBmcm9tICcuL0FkYXB0ZXJzL1N0b3JhZ2UvUG9zdGdyZXMvUG9zdGdyZXNTdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgcmF0ZUxpbWl0IGZyb20gJ2V4cHJlc3MtcmF0ZS1saW1pdCc7XG5pbXBvcnQgeyBSYXRlTGltaXRPcHRpb25zIH0gZnJvbSAnLi9PcHRpb25zL0RlZmluaXRpb25zJztcbmltcG9ydCB7IHBhdGhUb1JlZ2V4cCB9IGZyb20gJ3BhdGgtdG8tcmVnZXhwJztcbmltcG9ydCBSZWRpc1N0b3JlIGZyb20gJ3JhdGUtbGltaXQtcmVkaXMnO1xuaW1wb3J0IHsgY3JlYXRlQ2xpZW50IH0gZnJvbSAncmVkaXMnO1xuaW1wb3J0IHsgQmxvY2tMaXN0LCBpc0lQdjQgfSBmcm9tICduZXQnO1xuaW1wb3J0IHsgY3JlYXRlU2FuaXRpemVkSHR0cEVycm9yLCBjcmVhdGVTYW5pdGl6ZWRFcnJvciB9IGZyb20gJy4vRXJyb3InO1xuXG5leHBvcnQgY29uc3QgREVGQVVMVF9BTExPV0VEX0hFQURFUlMgPVxuICAnWC1QYXJzZS1NYXN0ZXItS2V5LCBYLVBhcnNlLVJFU1QtQVBJLUtleSwgWC1QYXJzZS1KYXZhc2NyaXB0LUtleSwgWC1QYXJzZS1BcHBsaWNhdGlvbi1JZCwgWC1QYXJzZS1DbGllbnQtVmVyc2lvbiwgWC1QYXJzZS1TZXNzaW9uLVRva2VuLCBYLVJlcXVlc3RlZC1XaXRoLCBYLVBhcnNlLVJldm9jYWJsZS1TZXNzaW9uLCBYLVBhcnNlLVJlcXVlc3QtSWQsIENvbnRlbnQtVHlwZSwgUHJhZ21hLCBDYWNoZS1Db250cm9sJztcblxuY29uc3QgZ2V0TW91bnRGb3JSZXF1ZXN0ID0gZnVuY3Rpb24gKHJlcSkge1xuICBjb25zdCBtb3VudFBhdGhMZW5ndGggPSByZXEub3JpZ2luYWxVcmwubGVuZ3RoIC0gcmVxLnVybC5sZW5ndGg7XG4gIGNvbnN0IG1vdW50UGF0aCA9IHJlcS5vcmlnaW5hbFVybC5zbGljZSgwLCBtb3VudFBhdGhMZW5ndGgpO1xuICByZXR1cm4gcmVxLnByb3RvY29sICsgJzovLycgKyByZXEuZ2V0KCdob3N0JykgKyBtb3VudFBhdGg7XG59O1xuXG5jb25zdCBnZXRCbG9ja0xpc3QgPSAoaXBSYW5nZUxpc3QsIHN0b3JlKSA9PiB7XG4gIGlmIChzdG9yZS5nZXQoJ2Jsb2NrTGlzdCcpKSB7IHJldHVybiBzdG9yZS5nZXQoJ2Jsb2NrTGlzdCcpOyB9XG4gIGNvbnN0IGJsb2NrTGlzdCA9IG5ldyBCbG9ja0xpc3QoKTtcbiAgaXBSYW5nZUxpc3QuZm9yRWFjaChmdWxsSXAgPT4ge1xuICAgIGlmIChmdWxsSXAgPT09ICc6Oi8wJyB8fCBmdWxsSXAgPT09ICc6OicgfHwgZnVsbElwID09PSAnOjowJykge1xuICAgICAgc3RvcmUuc2V0KCdhbGxvd0FsbElwdjYnLCB0cnVlKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGZ1bGxJcCA9PT0gJzAuMC4wLjAvMCcgfHwgZnVsbElwID09PSAnMC4wLjAuMCcpIHtcbiAgICAgIHN0b3JlLnNldCgnYWxsb3dBbGxJcHY0JywgdHJ1ZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IFtpcCwgbWFza10gPSBmdWxsSXAuc3BsaXQoJy8nKTtcbiAgICBpZiAoIW1hc2spIHtcbiAgICAgIGJsb2NrTGlzdC5hZGRBZGRyZXNzKGlwLCBpc0lQdjQoaXApID8gJ2lwdjQnIDogJ2lwdjYnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYmxvY2tMaXN0LmFkZFN1Ym5ldChpcCwgTnVtYmVyKG1hc2spLCBpc0lQdjQoaXApID8gJ2lwdjQnIDogJ2lwdjYnKTtcbiAgICB9XG4gIH0pO1xuICBzdG9yZS5zZXQoJ2Jsb2NrTGlzdCcsIGJsb2NrTGlzdCk7XG4gIHJldHVybiBibG9ja0xpc3Q7XG59O1xuXG5leHBvcnQgY29uc3QgY2hlY2tJcCA9IChpcCwgaXBSYW5nZUxpc3QsIHN0b3JlKSA9PiB7XG4gIGNvbnN0IGluY29taW5nSXBJc1Y0ID0gaXNJUHY0KGlwKTtcbiAgY29uc3QgYmxvY2tMaXN0ID0gZ2V0QmxvY2tMaXN0KGlwUmFuZ2VMaXN0LCBzdG9yZSk7XG5cbiAgaWYgKHN0b3JlLmdldChpcCkpIHsgcmV0dXJuIHRydWU7IH1cbiAgaWYgKHN0b3JlLmdldCgnYWxsb3dBbGxJcHY0JykgJiYgaW5jb21pbmdJcElzVjQpIHsgcmV0dXJuIHRydWU7IH1cbiAgaWYgKHN0b3JlLmdldCgnYWxsb3dBbGxJcHY2JykgJiYgIWluY29taW5nSXBJc1Y0KSB7IHJldHVybiB0cnVlOyB9XG4gIGNvbnN0IHJlc3VsdCA9IGJsb2NrTGlzdC5jaGVjayhpcCwgaW5jb21pbmdJcElzVjQgPyAnaXB2NCcgOiAnaXB2NicpO1xuXG4gIC8vIElmIHRoZSBpcCBpcyBpbiB0aGUgbGlzdCwgd2Ugc3RvcmUgdGhlIHJlc3VsdCBpbiB0aGUgc3RvcmVcbiAgLy8gc28gd2UgaGF2ZSBhIG9wdGltaXplZCBwYXRoIGZvciB0aGUgbmV4dCByZXF1ZXN0XG4gIGlmIChpcFJhbmdlTGlzdC5pbmNsdWRlcyhpcCkgJiYgcmVzdWx0KSB7XG4gICAgc3RvcmUuc2V0KGlwLCByZXN1bHQpO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59O1xuXG4vLyBDaGVja3MgdGhhdCB0aGUgcmVxdWVzdCBpcyBhdXRob3JpemVkIGZvciB0aGlzIGFwcCBhbmQgY2hlY2tzIHVzZXJcbi8vIGF1dGggdG9vLlxuLy8gVGhlIGJvZHlwYXJzZXIgc2hvdWxkIHJ1biBiZWZvcmUgdGhpcyBtaWRkbGV3YXJlLlxuLy8gQWRkcyBpbmZvIHRvIHRoZSByZXF1ZXN0OlxuLy8gcmVxLmNvbmZpZyAtIHRoZSBDb25maWcgZm9yIHRoaXMgYXBwXG4vLyByZXEuYXV0aCAtIHRoZSBBdXRoIGZvciB0aGlzIHJlcXVlc3RcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVQYXJzZUhlYWRlcnMocmVxLCByZXMsIG5leHQpIHtcbiAgdmFyIG1vdW50ID0gZ2V0TW91bnRGb3JSZXF1ZXN0KHJlcSk7XG5cbiAgbGV0IGNvbnRleHQgPSB7fTtcbiAgaWYgKHJlcS5nZXQoJ1gtUGFyc2UtQ2xvdWQtQ29udGV4dCcpICE9IG51bGwpIHtcbiAgICB0cnkge1xuICAgICAgY29udGV4dCA9IEpTT04ucGFyc2UocmVxLmdldCgnWC1QYXJzZS1DbG91ZC1Db250ZXh0JykpO1xuICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChjb250ZXh0KSAhPT0gJ1tvYmplY3QgT2JqZWN0XScpIHtcbiAgICAgICAgdGhyb3cgJ0NvbnRleHQgaXMgbm90IGFuIG9iamVjdCc7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbWFsZm9ybWVkQ29udGV4dChyZXEsIHJlcyk7XG4gICAgfVxuICB9XG4gIHZhciBpbmZvID0ge1xuICAgIGFwcElkOiByZXEuZ2V0KCdYLVBhcnNlLUFwcGxpY2F0aW9uLUlkJyksXG4gICAgc2Vzc2lvblRva2VuOiByZXEuZ2V0KCdYLVBhcnNlLVNlc3Npb24tVG9rZW4nKSxcbiAgICBtYXN0ZXJLZXk6IHJlcS5nZXQoJ1gtUGFyc2UtTWFzdGVyLUtleScpLFxuICAgIG1haW50ZW5hbmNlS2V5OiByZXEuZ2V0KCdYLVBhcnNlLU1haW50ZW5hbmNlLUtleScpLFxuICAgIGluc3RhbGxhdGlvbklkOiByZXEuZ2V0KCdYLVBhcnNlLUluc3RhbGxhdGlvbi1JZCcpLFxuICAgIGNsaWVudEtleTogcmVxLmdldCgnWC1QYXJzZS1DbGllbnQtS2V5JyksXG4gICAgamF2YXNjcmlwdEtleTogcmVxLmdldCgnWC1QYXJzZS1KYXZhc2NyaXB0LUtleScpLFxuICAgIGRvdE5ldEtleTogcmVxLmdldCgnWC1QYXJzZS1XaW5kb3dzLUtleScpLFxuICAgIHJlc3RBUElLZXk6IHJlcS5nZXQoJ1gtUGFyc2UtUkVTVC1BUEktS2V5JyksXG4gICAgY2xpZW50VmVyc2lvbjogcmVxLmdldCgnWC1QYXJzZS1DbGllbnQtVmVyc2lvbicpLFxuICAgIGNvbnRleHQ6IGNvbnRleHQsXG4gIH07XG5cbiAgdmFyIGJhc2ljQXV0aCA9IGh0dHBBdXRoKHJlcSk7XG5cbiAgaWYgKGJhc2ljQXV0aCkge1xuICAgIHZhciBiYXNpY0F1dGhBcHBJZCA9IGJhc2ljQXV0aC5hcHBJZDtcbiAgICBpZiAoQXBwQ2FjaGUuZ2V0KGJhc2ljQXV0aEFwcElkKSkge1xuICAgICAgaW5mby5hcHBJZCA9IGJhc2ljQXV0aEFwcElkO1xuICAgICAgaW5mby5tYXN0ZXJLZXkgPSBiYXNpY0F1dGgubWFzdGVyS2V5IHx8IGluZm8ubWFzdGVyS2V5O1xuICAgICAgaW5mby5qYXZhc2NyaXB0S2V5ID0gYmFzaWNBdXRoLmphdmFzY3JpcHRLZXkgfHwgaW5mby5qYXZhc2NyaXB0S2V5O1xuICAgIH1cbiAgfVxuXG4gIGlmIChyZXEuYm9keSkge1xuICAgIC8vIFVuaXR5IFNESyBzZW5kcyBhIF9ub0JvZHkga2V5IHdoaWNoIG5lZWRzIHRvIGJlIHJlbW92ZWQuXG4gICAgLy8gVW5jbGVhciBhdCB0aGlzIHBvaW50IGlmIGFjdGlvbiBuZWVkcyB0byBiZSB0YWtlbi5cbiAgICBkZWxldGUgcmVxLmJvZHkuX25vQm9keTtcbiAgfVxuXG4gIHZhciBmaWxlVmlhSlNPTiA9IGZhbHNlO1xuXG4gIGlmICghaW5mby5hcHBJZCB8fCAhQXBwQ2FjaGUuZ2V0KGluZm8uYXBwSWQpKSB7XG4gICAgLy8gU2VlIGlmIHdlIGNhbiBmaW5kIHRoZSBhcHAgaWQgb24gdGhlIGJvZHkuXG4gICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihyZXEuYm9keSkpIHtcbiAgICAgIC8vIFRoZSBvbmx5IGNoYW5jZSB0byBmaW5kIHRoZSBhcHAgaWQgaXMgaWYgdGhpcyBpcyBhIGZpbGVcbiAgICAgIC8vIHVwbG9hZCB0aGF0IGFjdHVhbGx5IGlzIGEgSlNPTiBib2R5LiBTbyB0cnkgdG8gcGFyc2UgaXQuXG4gICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vcGFyc2UtY29tbXVuaXR5L3BhcnNlLXNlcnZlci9pc3N1ZXMvNjU4OVxuICAgICAgLy8gSXQgaXMgYWxzbyBwb3NzaWJsZSB0aGF0IHRoZSBjbGllbnQgaXMgdHJ5aW5nIHRvIHVwbG9hZCBhIGZpbGUgYnV0IGZvcmdvdFxuICAgICAgLy8gdG8gcHJvdmlkZSB4LXBhcnNlLWFwcC1pZCBpbiBoZWFkZXIgYW5kIHBhcnNlIGEgYmluYXJ5IGZpbGUgd2lsbCBmYWlsXG4gICAgICB0cnkge1xuICAgICAgICByZXEuYm9keSA9IEpTT04ucGFyc2UocmVxLmJvZHkpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBpbnZhbGlkUmVxdWVzdChyZXEsIHJlcyk7XG4gICAgICB9XG4gICAgICBmaWxlVmlhSlNPTiA9IHRydWU7XG4gICAgfVxuXG4gICAgaWYgKHJlcS5ib2R5KSB7XG4gICAgICBkZWxldGUgcmVxLmJvZHkuX1Jldm9jYWJsZVNlc3Npb247XG4gICAgfVxuXG4gICAgaWYgKFxuICAgICAgcmVxLmJvZHkgJiZcbiAgICAgIHJlcS5ib2R5Ll9BcHBsaWNhdGlvbklkICYmXG4gICAgICBBcHBDYWNoZS5nZXQocmVxLmJvZHkuX0FwcGxpY2F0aW9uSWQpICYmXG4gICAgICAoIWluZm8ubWFzdGVyS2V5IHx8IEFwcENhY2hlLmdldChyZXEuYm9keS5fQXBwbGljYXRpb25JZCkubWFzdGVyS2V5ID09PSBpbmZvLm1hc3RlcktleSlcbiAgICApIHtcbiAgICAgIGluZm8uYXBwSWQgPSByZXEuYm9keS5fQXBwbGljYXRpb25JZDtcbiAgICAgIGluZm8uamF2YXNjcmlwdEtleSA9IHJlcS5ib2R5Ll9KYXZhU2NyaXB0S2V5IHx8ICcnO1xuICAgICAgZGVsZXRlIHJlcS5ib2R5Ll9BcHBsaWNhdGlvbklkO1xuICAgICAgZGVsZXRlIHJlcS5ib2R5Ll9KYXZhU2NyaXB0S2V5O1xuICAgICAgLy8gVE9ETzogdGVzdCB0aGF0IHRoZSBSRVNUIEFQSSBmb3JtYXRzIGdlbmVyYXRlZCBieSB0aGUgb3RoZXJcbiAgICAgIC8vIFNES3MgYXJlIGhhbmRsZWQgb2tcbiAgICAgIGlmIChyZXEuYm9keS5fQ2xpZW50VmVyc2lvbikge1xuICAgICAgICBpZiAodHlwZW9mIHJlcS5ib2R5Ll9DbGllbnRWZXJzaW9uICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgIHJldHVybiBpbnZhbGlkUmVxdWVzdChyZXEsIHJlcyk7XG4gICAgICAgIH1cbiAgICAgICAgaW5mby5jbGllbnRWZXJzaW9uID0gcmVxLmJvZHkuX0NsaWVudFZlcnNpb247XG4gICAgICAgIGRlbGV0ZSByZXEuYm9keS5fQ2xpZW50VmVyc2lvbjtcbiAgICAgIH1cbiAgICAgIGlmIChyZXEuYm9keS5fSW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgaWYgKHR5cGVvZiByZXEuYm9keS5fSW5zdGFsbGF0aW9uSWQgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgcmV0dXJuIGludmFsaWRSZXF1ZXN0KHJlcSwgcmVzKTtcbiAgICAgICAgfVxuICAgICAgICBpbmZvLmluc3RhbGxhdGlvbklkID0gcmVxLmJvZHkuX0luc3RhbGxhdGlvbklkO1xuICAgICAgICBkZWxldGUgcmVxLmJvZHkuX0luc3RhbGxhdGlvbklkO1xuICAgICAgfVxuICAgICAgaWYgKHJlcS5ib2R5Ll9TZXNzaW9uVG9rZW4pIHtcbiAgICAgICAgaWYgKHR5cGVvZiByZXEuYm9keS5fU2Vzc2lvblRva2VuICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgIHJldHVybiBpbnZhbGlkUmVxdWVzdChyZXEsIHJlcyk7XG4gICAgICAgIH1cbiAgICAgICAgaW5mby5zZXNzaW9uVG9rZW4gPSByZXEuYm9keS5fU2Vzc2lvblRva2VuO1xuICAgICAgICBkZWxldGUgcmVxLmJvZHkuX1Nlc3Npb25Ub2tlbjtcbiAgICAgIH1cbiAgICAgIGlmIChyZXEuYm9keS5fTWFzdGVyS2V5KSB7XG4gICAgICAgIGlmICh0eXBlb2YgcmVxLmJvZHkuX01hc3RlcktleSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICByZXR1cm4gaW52YWxpZFJlcXVlc3QocmVxLCByZXMpO1xuICAgICAgICB9XG4gICAgICAgIGluZm8ubWFzdGVyS2V5ID0gcmVxLmJvZHkuX01hc3RlcktleTtcbiAgICAgICAgZGVsZXRlIHJlcS5ib2R5Ll9NYXN0ZXJLZXk7XG4gICAgICB9XG4gICAgICBpZiAocmVxLmJvZHkuX2NvbnRleHQpIHtcbiAgICAgICAgaWYgKFV0aWxzLmlzT2JqZWN0KHJlcS5ib2R5Ll9jb250ZXh0KSkge1xuICAgICAgICAgIGluZm8uY29udGV4dCA9IHJlcS5ib2R5Ll9jb250ZXh0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpbmZvLmNvbnRleHQgPSBKU09OLnBhcnNlKHJlcS5ib2R5Ll9jb250ZXh0KTtcbiAgICAgICAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoaW5mby5jb250ZXh0KSAhPT0gJ1tvYmplY3QgT2JqZWN0XScpIHtcbiAgICAgICAgICAgICAgdGhyb3cgJ0NvbnRleHQgaXMgbm90IGFuIG9iamVjdCc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICByZXR1cm4gbWFsZm9ybWVkQ29udGV4dChyZXEsIHJlcyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGRlbGV0ZSByZXEuYm9keS5fY29udGV4dDtcbiAgICAgIH1cbiAgICAgIGlmIChyZXEuYm9keS5fQ29udGVudFR5cGUpIHtcbiAgICAgICAgaWYgKHR5cGVvZiByZXEuYm9keS5fQ29udGVudFR5cGUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgcmV0dXJuIGludmFsaWRSZXF1ZXN0KHJlcSwgcmVzKTtcbiAgICAgICAgfVxuICAgICAgICByZXEuaGVhZGVyc1snY29udGVudC10eXBlJ10gPSByZXEuYm9keS5fQ29udGVudFR5cGU7XG4gICAgICAgIGRlbGV0ZSByZXEuYm9keS5fQ29udGVudFR5cGU7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBpbnZhbGlkUmVxdWVzdChyZXEsIHJlcyk7XG4gICAgfVxuICB9XG5cbiAgaWYgKGluZm8uc2Vzc2lvblRva2VuICYmIHR5cGVvZiBpbmZvLnNlc3Npb25Ub2tlbiAhPT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gaW52YWxpZFJlcXVlc3QocmVxLCByZXMpO1xuICB9XG5cbiAgaWYgKGluZm8uY2xpZW50VmVyc2lvbiAmJiB0eXBlb2YgaW5mby5jbGllbnRWZXJzaW9uID09PSAnc3RyaW5nJykge1xuICAgIGluZm8uY2xpZW50U0RLID0gQ2xpZW50U0RLLmZyb21TdHJpbmcoaW5mby5jbGllbnRWZXJzaW9uKTtcbiAgfVxuXG4gIGlmIChmaWxlVmlhSlNPTiAmJiByZXEuYm9keSkge1xuICAgIGlmIChyZXEuYm9keS5iYXNlNjQgJiYgdHlwZW9mIHJlcS5ib2R5LmJhc2U2NCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBpbnZhbGlkUmVxdWVzdChyZXEsIHJlcyk7XG4gICAgfVxuICAgIHJlcS5maWxlRGF0YSA9IHJlcS5ib2R5LmZpbGVEYXRhO1xuICAgIC8vIFdlIG5lZWQgdG8gcmVwb3B1bGF0ZSByZXEuYm9keSB3aXRoIGEgYnVmZmVyXG4gICAgdmFyIGJhc2U2NCA9IHJlcS5ib2R5LmJhc2U2NDtcbiAgICByZXEuYm9keSA9IEJ1ZmZlci5mcm9tKGJhc2U2NCwgJ2Jhc2U2NCcpO1xuICB9XG5cbiAgY29uc3QgY2xpZW50SXAgPSBnZXRDbGllbnRJcChyZXEpO1xuICBjb25zdCBjb25maWcgPSByZXEuY29uZmlnIHx8IENvbmZpZy5nZXQoaW5mby5hcHBJZCwgbW91bnQpO1xuICBpZiAoY29uZmlnLnN0YXRlICYmIGNvbmZpZy5zdGF0ZSAhPT0gJ29rJykge1xuICAgIHJlcy5zdGF0dXMoNTAwKTtcbiAgICByZXMuanNvbih7XG4gICAgICBjb2RlOiBQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICBlcnJvcjogYEludmFsaWQgc2VydmVyIHN0YXRlOiAke2NvbmZpZy5zdGF0ZX1gLFxuICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXJlcS5jb25maWcpIHtcbiAgICBhd2FpdCBjb25maWcubG9hZEtleXMoKTtcbiAgfVxuXG4gIGluZm8uYXBwID0gQXBwQ2FjaGUuZ2V0KGluZm8uYXBwSWQpO1xuICByZXEuY29uZmlnID0gY29uZmlnO1xuICByZXEuY29uZmlnLmhlYWRlcnMgPSByZXEuaGVhZGVycyB8fCB7fTtcbiAgcmVxLmNvbmZpZy5pcCA9IGNsaWVudElwO1xuICByZXEuaW5mbyA9IGluZm87XG5cbiAgLy8gU2tpcCBrZXkgZGV0ZWN0aW9uIGlmIGFscmVhZHkgcmVzb2x2ZWQgYnkgaGFuZGxlUGFyc2VBdXRoIChoZWFkZXItYmFzZWQpLlxuICAvLyBPbmx5IHJlc29sdmUgaGVyZSBmb3IgYm9keS1iYXNlZCBfTWFzdGVyS2V5IChpbmZvLm1hc3RlcktleSBtYXkgY29tZSBmcm9tIGJvZHkpLlxuICBpZiAoIXJlcS5hdXRoIHx8ICghcmVxLmF1dGguaXNNYXN0ZXIgJiYgIXJlcS5hdXRoLmlzTWFpbnRlbmFuY2UpKSB7XG4gICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCByZXNvbHZlS2V5QXV0aCh7XG4gICAgICBjb25maWc6IHJlcS5jb25maWcsXG4gICAgICBrZXlWYWx1ZTogaW5mby5tYXN0ZXJLZXksXG4gICAgICBtYWludGVuYW5jZUtleVZhbHVlOiBpbmZvLm1haW50ZW5hbmNlS2V5LFxuICAgICAgaW5zdGFsbGF0aW9uSWQ6IGluZm8uaW5zdGFsbGF0aW9uSWQsXG4gICAgICBjbGllbnRJcCxcbiAgICB9KTtcbiAgICBpZiAocmVzb2x2ZWQpIHtcbiAgICAgIHJlcS5hdXRoID0gcmVzb2x2ZWQ7XG4gICAgfVxuICB9XG5cbiAgaWYgKHJlcS5hdXRoICYmIChyZXEuYXV0aC5pc01hc3RlciB8fCByZXEuYXV0aC5pc01haW50ZW5hbmNlKSkge1xuICAgIHJldHVybiBoYW5kbGVSYXRlTGltaXQocmVxLCByZXMsIG5leHQpO1xuICB9XG5cbiAgLy8gQ2xpZW50IGtleXMgYXJlIG5vdCByZXF1aXJlZCBpbiBwYXJzZS1zZXJ2ZXIsIGJ1dCBpZiBhbnkgaGF2ZSBiZWVuIGNvbmZpZ3VyZWQgaW4gdGhlIHNlcnZlciwgdmFsaWRhdGUgdGhlbVxuICAvLyAgdG8gcHJlc2VydmUgb3JpZ2luYWwgYmVoYXZpb3IuXG4gIGNvbnN0IGtleXMgPSBbJ2NsaWVudEtleScsICdqYXZhc2NyaXB0S2V5JywgJ2RvdE5ldEtleScsICdyZXN0QVBJS2V5J107XG4gIGNvbnN0IG9uZUtleUNvbmZpZ3VyZWQgPSBrZXlzLnNvbWUoZnVuY3Rpb24gKGtleSkge1xuICAgIHJldHVybiByZXEuY29uZmlnW2tleV0gIT09IHVuZGVmaW5lZDtcbiAgfSk7XG4gIGNvbnN0IG9uZUtleU1hdGNoZXMgPSBrZXlzLnNvbWUoZnVuY3Rpb24gKGtleSkge1xuICAgIHJldHVybiByZXEuY29uZmlnW2tleV0gIT09IHVuZGVmaW5lZCAmJiBpbmZvW2tleV0gPT09IHJlcS5jb25maWdba2V5XTtcbiAgfSk7XG5cbiAgaWYgKG9uZUtleUNvbmZpZ3VyZWQgJiYgIW9uZUtleU1hdGNoZXMpIHtcbiAgICByZXR1cm4gaW52YWxpZFJlcXVlc3QocmVxLCByZXMpO1xuICB9XG5cbiAgaWYgKHJlcS51cmwgPT0gJy9sb2dpbicpIHtcbiAgICBkZWxldGUgaW5mby5zZXNzaW9uVG9rZW47XG4gIH1cblxuICBpZiAocmVxLnVzZXJGcm9tSldUKSB7XG4gICAgcmVxLmF1dGggPSBuZXcgYXV0aC5BdXRoKHtcbiAgICAgIGNvbmZpZzogcmVxLmNvbmZpZyxcbiAgICAgIGluc3RhbGxhdGlvbklkOiBpbmZvLmluc3RhbGxhdGlvbklkLFxuICAgICAgaXNNYXN0ZXI6IGZhbHNlLFxuICAgICAgdXNlcjogcmVxLnVzZXJGcm9tSldULFxuICAgIH0pO1xuICAgIHJldHVybiBoYW5kbGVSYXRlTGltaXQocmVxLCByZXMsIG5leHQpO1xuICB9XG5cbiAgaWYgKCFpbmZvLnNlc3Npb25Ub2tlbikge1xuICAgIHJlcS5hdXRoID0gbmV3IGF1dGguQXV0aCh7XG4gICAgICBjb25maWc6IHJlcS5jb25maWcsXG4gICAgICBpbnN0YWxsYXRpb25JZDogaW5mby5pbnN0YWxsYXRpb25JZCxcbiAgICAgIGlzTWFzdGVyOiBmYWxzZSxcbiAgICB9KTtcbiAgfVxuICBoYW5kbGVSYXRlTGltaXQocmVxLCByZXMsIG5leHQpO1xufVxuXG5jb25zdCBoYW5kbGVSYXRlTGltaXQgPSBhc3luYyAocmVxLCByZXMsIG5leHQpID0+IHtcbiAgY29uc3QgcmF0ZUxpbWl0cyA9IHJlcS5jb25maWcucmF0ZUxpbWl0cyB8fCBbXTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgIHJhdGVMaW1pdHMubWFwKGFzeW5jIGxpbWl0ID0+IHtcbiAgICAgICAgY29uc3QgcGF0aEV4cCA9IGxpbWl0LnBhdGgucmVnZXhwIHx8IGxpbWl0LnBhdGg7XG4gICAgICAgIGlmIChwYXRoRXhwLnRlc3QocmVxLnVybCkpIHtcbiAgICAgICAgICBhd2FpdCBsaW1pdC5oYW5kbGVyKHJlcSwgcmVzLCBlcnIgPT4ge1xuICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICBpZiAoZXJyLmNvZGUgPT09IFBhcnNlLkVycm9yLkNPTk5FQ1RJT05fRkFJTEVEKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJlcS5jb25maWcubG9nZ2VyQ29udHJvbGxlci5lcnJvcihcbiAgICAgICAgICAgICAgICAnQW4gdW5rbm93biBlcnJvciBvY2N1cmVkIHdoZW4gYXR0ZW1wdGluZyB0byBhcHBseSB0aGUgcmF0ZSBsaW1pdGVyOiAnLFxuICAgICAgICAgICAgICAgIGVyclxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmVzLnN0YXR1cyg0MjkpO1xuICAgIHJlcy5qc29uKHsgY29kZTogUGFyc2UuRXJyb3IuQ09OTkVDVElPTl9GQUlMRUQsIGVycm9yOiBlcnJvci5tZXNzYWdlIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBuZXh0KCk7XG59O1xuXG5leHBvcnQgY29uc3QgaGFuZGxlUGFyc2VTZXNzaW9uID0gYXN5bmMgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgaW5mbyA9IHJlcS5pbmZvO1xuICAgIGlmIChyZXEuYXV0aCB8fCAocmVxLnVybCA9PT0gJy9zZXNzaW9ucy9tZScgJiYgcmVxLm1ldGhvZCA9PT0gJ0dFVCcpKSB7XG4gICAgICBuZXh0KCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGxldCByZXF1ZXN0QXV0aCA9IG51bGw7XG4gICAgaWYgKFxuICAgICAgaW5mby5zZXNzaW9uVG9rZW4gJiZcbiAgICAgIHJlcS51cmwgPT09ICcvdXBncmFkZVRvUmV2b2NhYmxlU2Vzc2lvbicgJiZcbiAgICAgIGluZm8uc2Vzc2lvblRva2VuLmluZGV4T2YoJ3I6JykgIT0gMFxuICAgICkge1xuICAgICAgcmVxdWVzdEF1dGggPSBhd2FpdCBhdXRoLmdldEF1dGhGb3JMZWdhY3lTZXNzaW9uVG9rZW4oe1xuICAgICAgICBjb25maWc6IHJlcS5jb25maWcsXG4gICAgICAgIGluc3RhbGxhdGlvbklkOiBpbmZvLmluc3RhbGxhdGlvbklkLFxuICAgICAgICBzZXNzaW9uVG9rZW46IGluZm8uc2Vzc2lvblRva2VuLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlcXVlc3RBdXRoID0gYXdhaXQgYXV0aC5nZXRBdXRoRm9yU2Vzc2lvblRva2VuKHtcbiAgICAgICAgY29uZmlnOiByZXEuY29uZmlnLFxuICAgICAgICBpbnN0YWxsYXRpb25JZDogaW5mby5pbnN0YWxsYXRpb25JZCxcbiAgICAgICAgc2Vzc2lvblRva2VuOiBpbmZvLnNlc3Npb25Ub2tlbixcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXEuYXV0aCA9IHJlcXVlc3RBdXRoO1xuICAgIG5leHQoKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBQYXJzZS5FcnJvcikge1xuICAgICAgbmV4dChlcnJvcik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIExvZyBmdWxsIGVycm9yIGRldGFpbHMgaW50ZXJuYWxseSwgYnV0IGRvbid0IGV4cG9zZSB0byBjbGllbnRcbiAgICByZXEuY29uZmlnLmxvZ2dlckNvbnRyb2xsZXIuZXJyb3IoJ2Vycm9yIGdldHRpbmcgYXV0aCBmb3Igc2Vzc2lvblRva2VuJywgZXJyb3IpO1xuICAgIG5leHQobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlVOS05PV05fRVJST1IsICdVbmtub3duIGVycm9yJykpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBnZXRDbGllbnRJcChyZXEpIHtcbiAgcmV0dXJuIHJlcS5pcDtcbn1cblxuZnVuY3Rpb24gaHR0cEF1dGgocmVxKSB7XG4gIGlmICghKHJlcS5yZXEgfHwgcmVxKS5oZWFkZXJzLmF1dGhvcml6YXRpb24pIHsgcmV0dXJuOyB9XG5cbiAgdmFyIGhlYWRlciA9IChyZXEucmVxIHx8IHJlcSkuaGVhZGVycy5hdXRob3JpemF0aW9uO1xuICB2YXIgYXBwSWQsIG1hc3RlcktleSwgamF2YXNjcmlwdEtleTtcblxuICAvLyBwYXJzZSBoZWFkZXJcbiAgdmFyIGF1dGhQcmVmaXggPSAnYmFzaWMgJztcblxuICB2YXIgbWF0Y2ggPSBoZWFkZXIudG9Mb3dlckNhc2UoKS5pbmRleE9mKGF1dGhQcmVmaXgpO1xuXG4gIGlmIChtYXRjaCA9PSAwKSB7XG4gICAgdmFyIGVuY29kZWRBdXRoID0gaGVhZGVyLnN1YnN0cmluZyhhdXRoUHJlZml4Lmxlbmd0aCwgaGVhZGVyLmxlbmd0aCk7XG4gICAgdmFyIGNyZWRlbnRpYWxzID0gZGVjb2RlQmFzZTY0KGVuY29kZWRBdXRoKS5zcGxpdCgnOicpO1xuXG4gICAgaWYgKGNyZWRlbnRpYWxzLmxlbmd0aCA9PSAyKSB7XG4gICAgICBhcHBJZCA9IGNyZWRlbnRpYWxzWzBdO1xuICAgICAgdmFyIGtleSA9IGNyZWRlbnRpYWxzWzFdO1xuXG4gICAgICB2YXIganNLZXlQcmVmaXggPSAnamF2YXNjcmlwdC1rZXk9JztcblxuICAgICAgdmFyIG1hdGNoS2V5ID0ga2V5LmluZGV4T2YoanNLZXlQcmVmaXgpO1xuICAgICAgaWYgKG1hdGNoS2V5ID09IDApIHtcbiAgICAgICAgamF2YXNjcmlwdEtleSA9IGtleS5zdWJzdHJpbmcoanNLZXlQcmVmaXgubGVuZ3RoLCBrZXkubGVuZ3RoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1hc3RlcktleSA9IGtleTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4geyBhcHBJZDogYXBwSWQsIG1hc3RlcktleTogbWFzdGVyS2V5LCBqYXZhc2NyaXB0S2V5OiBqYXZhc2NyaXB0S2V5IH07XG59XG5cbmZ1bmN0aW9uIGRlY29kZUJhc2U2NChzdHIpIHtcbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHN0ciwgJ2Jhc2U2NCcpLnRvU3RyaW5nKCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhbGxvd0Nyb3NzRG9tYWluKGFwcElkKSB7XG4gIHJldHVybiAocmVxLCByZXMsIG5leHQpID0+IHtcbiAgICBjb25zdCBjb25maWcgPSBDb25maWcuZ2V0KGFwcElkLCBnZXRNb3VudEZvclJlcXVlc3QocmVxKSk7XG4gICAgbGV0IGFsbG93SGVhZGVycyA9IERFRkFVTFRfQUxMT1dFRF9IRUFERVJTO1xuICAgIGlmIChjb25maWcgJiYgY29uZmlnLmFsbG93SGVhZGVycykge1xuICAgICAgYWxsb3dIZWFkZXJzICs9IGAsICR7Y29uZmlnLmFsbG93SGVhZGVycy5qb2luKCcsICcpfWA7XG4gICAgfVxuXG4gICAgY29uc3QgYmFzZU9yaWdpbnMgPVxuICAgICAgdHlwZW9mIGNvbmZpZz8uYWxsb3dPcmlnaW4gPT09ICdzdHJpbmcnID8gW2NvbmZpZy5hbGxvd09yaWdpbl0gOiBjb25maWc/LmFsbG93T3JpZ2luID8/IFsnKiddO1xuICAgIGNvbnN0IHJlcXVlc3RPcmlnaW4gPSByZXEuaGVhZGVycy5vcmlnaW47XG4gICAgY29uc3QgYWxsb3dPcmlnaW5zID1cbiAgICAgIHJlcXVlc3RPcmlnaW4gJiYgYmFzZU9yaWdpbnMuaW5jbHVkZXMocmVxdWVzdE9yaWdpbikgPyByZXF1ZXN0T3JpZ2luIDogYmFzZU9yaWdpbnNbMF07XG4gICAgcmVzLmhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgYWxsb3dPcmlnaW5zKTtcbiAgICByZXMuaGVhZGVyKCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJywgJ0dFVCxQVVQsUE9TVCxERUxFVEUsT1BUSU9OUycpO1xuICAgIHJlcy5oZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLCBhbGxvd0hlYWRlcnMpO1xuICAgIHJlcy5oZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUV4cG9zZS1IZWFkZXJzJywgJ1gtUGFyc2UtSm9iLVN0YXR1cy1JZCwgWC1QYXJzZS1QdXNoLVN0YXR1cy1JZCcpO1xuICAgIC8vIGludGVyY2VwdCBPUFRJT05TIG1ldGhvZFxuICAgIGlmICgnT1BUSU9OUycgPT0gcmVxLm1ldGhvZCkge1xuICAgICAgcmVzLnNlbmRTdGF0dXMoMjAwKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV4dCgpO1xuICAgIH1cbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFsbG93TWV0aG9kT3ZlcnJpZGUocmVxLCByZXMsIG5leHQpIHtcbiAgaWYgKHJlcS5tZXRob2QgPT09ICdQT1NUJyAmJiByZXEuYm9keT8uX21ldGhvZCkge1xuICAgIGlmICh0eXBlb2YgcmVxLmJvZHkuX21ldGhvZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJlcS5vcmlnaW5hbE1ldGhvZCA9IHJlcS5tZXRob2Q7XG4gICAgICByZXEubWV0aG9kID0gcmVxLmJvZHkuX21ldGhvZC50b1VwcGVyQ2FzZSgpO1xuICAgIH1cbiAgICBkZWxldGUgcmVxLmJvZHkuX21ldGhvZDtcbiAgfVxuICBuZXh0KCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVLZXlBdXRoKHsgY29uZmlnLCBrZXlWYWx1ZSwgbWFpbnRlbmFuY2VLZXlWYWx1ZSwgaW5zdGFsbGF0aW9uSWQsIGNsaWVudElwIH0pIHtcbiAgaWYgKG1haW50ZW5hbmNlS2V5VmFsdWUgJiYgbWFpbnRlbmFuY2VLZXlWYWx1ZSA9PT0gY29uZmlnLm1haW50ZW5hbmNlS2V5KSB7XG4gICAgaWYgKGNoZWNrSXAoY2xpZW50SXAsIGNvbmZpZy5tYWludGVuYW5jZUtleUlwcyB8fCBbXSwgY29uZmlnLm1haW50ZW5hbmNlS2V5SXBzU3RvcmUpKSB7XG4gICAgICByZXR1cm4gbmV3IGF1dGguQXV0aCh7IGNvbmZpZywgaW5zdGFsbGF0aW9uSWQsIGlzTWFpbnRlbmFuY2U6IHRydWUgfSk7XG4gICAgfVxuICAgIGNvbnN0IGxvZyA9IGNvbmZpZy5sb2dnZXJDb250cm9sbGVyIHx8IGRlZmF1bHRMb2dnZXI7XG4gICAgbG9nLmVycm9yKFxuICAgICAgYFJlcXVlc3QgdXNpbmcgbWFpbnRlbmFuY2Uga2V5IHJlamVjdGVkIGFzIHRoZSByZXF1ZXN0IElQIGFkZHJlc3MgJyR7Y2xpZW50SXB9JyBpcyBub3Qgc2V0IGluIFBhcnNlIFNlcnZlciBvcHRpb24gJ21haW50ZW5hbmNlS2V5SXBzJy5gXG4gICAgKTtcbiAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcigpO1xuICAgIGVycm9yLnN0YXR1cyA9IDQwMztcbiAgICBlcnJvci5tZXNzYWdlID0gJ3VuYXV0aG9yaXplZCc7XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbiAgY29uc3QgbWFzdGVyS2V5ID0gYXdhaXQgY29uZmlnLmxvYWRNYXN0ZXJLZXkoKTtcbiAgaWYgKGtleVZhbHVlID09PSBtYXN0ZXJLZXkpIHtcbiAgICBpZiAoY2hlY2tJcChjbGllbnRJcCwgY29uZmlnLm1hc3RlcktleUlwcyB8fCBbXSwgY29uZmlnLm1hc3RlcktleUlwc1N0b3JlKSkge1xuICAgICAgcmV0dXJuIG5ldyBhdXRoLkF1dGgoeyBjb25maWcsIGluc3RhbGxhdGlvbklkLCBpc01hc3RlcjogdHJ1ZSB9KTtcbiAgICB9XG4gICAgY29uc3QgbG9nID0gY29uZmlnLmxvZ2dlckNvbnRyb2xsZXIgfHwgZGVmYXVsdExvZ2dlcjtcbiAgICBsb2cuZXJyb3IoXG4gICAgICBgUmVxdWVzdCB1c2luZyBtYXN0ZXIga2V5IHJlamVjdGVkIGFzIHRoZSByZXF1ZXN0IElQIGFkZHJlc3MgJyR7Y2xpZW50SXB9JyBpcyBub3Qgc2V0IGluIFBhcnNlIFNlcnZlciBvcHRpb24gJ21hc3RlcktleUlwcycuYFxuICAgICk7XG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoKTtcbiAgICBlcnJvci5zdGF0dXMgPSA0MDM7XG4gICAgZXJyb3IubWVzc2FnZSA9ICd1bmF1dGhvcml6ZWQnO1xuICAgIHRocm93IGVycm9yO1xuICB9XG4gIGlmIChcbiAgICBrZXlWYWx1ZSAmJlxuICAgIHR5cGVvZiBjb25maWcucmVhZE9ubHlNYXN0ZXJLZXkgIT09ICd1bmRlZmluZWQnICYmXG4gICAgY29uZmlnLnJlYWRPbmx5TWFzdGVyS2V5ICYmXG4gICAga2V5VmFsdWUgPT09IGNvbmZpZy5yZWFkT25seU1hc3RlcktleVxuICApIHtcbiAgICBpZiAoY2hlY2tJcChjbGllbnRJcCwgY29uZmlnLnJlYWRPbmx5TWFzdGVyS2V5SXBzIHx8IFtdLCBjb25maWcucmVhZE9ubHlNYXN0ZXJLZXlJcHNTdG9yZSkpIHtcbiAgICAgIHJldHVybiBuZXcgYXV0aC5BdXRoKHsgY29uZmlnLCBpbnN0YWxsYXRpb25JZCwgaXNNYXN0ZXI6IHRydWUsIGlzUmVhZE9ubHk6IHRydWUgfSk7XG4gICAgfVxuICAgIGNvbnN0IGxvZyA9IGNvbmZpZy5sb2dnZXJDb250cm9sbGVyIHx8IGRlZmF1bHRMb2dnZXI7XG4gICAgbG9nLmVycm9yKFxuICAgICAgYFJlcXVlc3QgdXNpbmcgcmVhZC1vbmx5IG1hc3RlciBrZXkgcmVqZWN0ZWQgYXMgdGhlIHJlcXVlc3QgSVAgYWRkcmVzcyAnJHtjbGllbnRJcH0nIGlzIG5vdCBzZXQgaW4gUGFyc2UgU2VydmVyIG9wdGlvbiAncmVhZE9ubHlNYXN0ZXJLZXlJcHMnLmBcbiAgICApO1xuICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCk7XG4gICAgZXJyb3Iuc3RhdHVzID0gNDAzO1xuICAgIGVycm9yLm1lc3NhZ2UgPSAndW5hdXRob3JpemVkJztcbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhbmRsZVBhcnNlQXV0aChhcHBJZCkge1xuICByZXR1cm4gYXN5bmMgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgY29uc3QgbW91bnQgPSBnZXRNb3VudEZvclJlcXVlc3QocmVxKTtcbiAgICBjb25zdCBjb25maWcgPSBDb25maWcuZ2V0KGFwcElkLCBtb3VudCk7XG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgfVxuICAgIHJlcS5jb25maWcgPSBjb25maWc7XG4gICAgY29uc3QgY2xpZW50SXAgPSBnZXRDbGllbnRJcChyZXEpO1xuICAgIHJlcS5jb25maWcuaXAgPSBjbGllbnRJcDtcbiAgICBhd2FpdCBjb25maWcubG9hZEtleXMoKTtcbiAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IHJlc29sdmVLZXlBdXRoKHtcbiAgICAgIGNvbmZpZyxcbiAgICAgIGtleVZhbHVlOiByZXEuZ2V0KCdYLVBhcnNlLU1hc3Rlci1LZXknKSB8fCBudWxsLFxuICAgICAgbWFpbnRlbmFuY2VLZXlWYWx1ZTogcmVxLmdldCgnWC1QYXJzZS1NYWludGVuYW5jZS1LZXknKSB8fCBudWxsLFxuICAgICAgaW5zdGFsbGF0aW9uSWQ6IHJlcS5nZXQoJ1gtUGFyc2UtSW5zdGFsbGF0aW9uLUlkJykgfHwgJ2Nsb3VkJyxcbiAgICAgIGNsaWVudElwLFxuICAgIH0pO1xuICAgIGlmIChyZXNvbHZlZCkge1xuICAgICAgcmVxLmF1dGggPSByZXNvbHZlZDtcbiAgICB9XG4gICAgcmV0dXJuIG5leHQoKTtcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhbmRsZVBhcnNlSGVhbHRoKG9wdGlvbnMpIHtcbiAgcmV0dXJuIChyZXEsIHJlcykgPT4ge1xuICAgIHJlcy5zdGF0dXMob3B0aW9ucy5zdGF0ZSA9PT0gJ29rJyA/IDIwMCA6IDUwMyk7XG4gICAgaWYgKG9wdGlvbnMuc3RhdGUgPT09ICdzdGFydGluZycpIHtcbiAgICAgIHJlcy5zZXQoJ1JldHJ5LUFmdGVyJywgMSk7XG4gICAgfVxuICAgIHJlcy5qc29uKHtcbiAgICAgIHN0YXR1czogb3B0aW9ucy5zdGF0ZSxcbiAgICB9KTtcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGVuZm9yY2VSb3V0ZUFsbG93TGlzdChyZXEsIHJlcywgbmV4dCkge1xuICBjb25zdCBjb25maWcgPSByZXEuY29uZmlnO1xuICBpZiAoIWNvbmZpZyB8fCBjb25maWcucm91dGVBbGxvd0xpc3QgPT09IHVuZGVmaW5lZCB8fCBjb25maWcucm91dGVBbGxvd0xpc3QgPT09IG51bGwpIHtcbiAgICByZXR1cm4gbmV4dCgpO1xuICB9XG4gIGlmIChyZXEuYXV0aCAmJiAocmVxLmF1dGguaXNNYXN0ZXIgfHwgcmVxLmF1dGguaXNNYWludGVuYW5jZSkpIHtcbiAgICByZXR1cm4gbmV4dCgpO1xuICB9XG4gIGxldCBwYXRoID0gcmVxLm9yaWdpbmFsVXJsO1xuICBpZiAoY29uZmlnLm1vdW50KSB7XG4gICAgY29uc3QgbW91bnRQYXRoID0gbmV3IFVSTChjb25maWcubW91bnQpLnBhdGhuYW1lO1xuICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgobW91bnRQYXRoKSkge1xuICAgICAgcGF0aCA9IHBhdGguc3Vic3RyaW5nKG1vdW50UGF0aC5sZW5ndGgpO1xuICAgIH1cbiAgfVxuICBpZiAocGF0aC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBwYXRoID0gcGF0aC5zdWJzdHJpbmcoMSk7XG4gIH1cbiAgaWYgKHBhdGguZW5kc1dpdGgoJy8nKSkge1xuICAgIHBhdGggPSBwYXRoLnN1YnN0cmluZygwLCBwYXRoLmxlbmd0aCAtIDEpO1xuICB9XG4gIGNvbnN0IHF1ZXJ5SW5kZXggPSBwYXRoLmluZGV4T2YoJz8nKTtcbiAgaWYgKHF1ZXJ5SW5kZXggIT09IC0xKSB7XG4gICAgcGF0aCA9IHBhdGguc3Vic3RyaW5nKDAsIHF1ZXJ5SW5kZXgpO1xuICB9XG4gIGNvbnN0IHJlZ2V4ZXMgPSBjb25maWcuX3JvdXRlQWxsb3dMaXN0UmVnZXggfHwgW107XG4gIGZvciAoY29uc3QgcmVnZXggb2YgcmVnZXhlcykge1xuICAgIGlmIChyZWdleC50ZXN0KHBhdGgpKSB7XG4gICAgICByZXR1cm4gbmV4dCgpO1xuICAgIH1cbiAgfVxuICB0aHJvdyBjcmVhdGVTYW5pdGl6ZWRFcnJvcihcbiAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgIGBSb3V0ZSBub3QgYWxsb3dlZCBieSByb3V0ZUFsbG93TGlzdDogJHtyZXEubWV0aG9kfSAke3BhdGh9YCxcbiAgICBjb25maWdcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhbmRsZVBhcnNlRXJyb3JzKGVyciwgcmVxLCByZXMsIG5leHQpIHtcbiAgY29uc3QgbG9nID0gKHJlcS5jb25maWcgJiYgcmVxLmNvbmZpZy5sb2dnZXJDb250cm9sbGVyKSB8fCBkZWZhdWx0TG9nZ2VyO1xuICBpZiAoZXJyIGluc3RhbmNlb2YgUGFyc2UuRXJyb3IpIHtcbiAgICBpZiAocmVxLmNvbmZpZyAmJiByZXEuY29uZmlnLmVuYWJsZUV4cHJlc3NFcnJvckhhbmRsZXIpIHtcbiAgICAgIHJldHVybiBuZXh0KGVycik7XG4gICAgfVxuICAgIGNvbnN0IHNpZ251cFVzZXJuYW1lVGFrZW5MZXZlbCA9XG4gICAgICByZXEuY29uZmlnPy5sb2dMZXZlbHM/LnNpZ251cFVzZXJuYW1lVGFrZW4gfHwgJ2luZm8nO1xuICAgIGxldCBodHRwU3RhdHVzO1xuICAgIC8vIFRPRE86IGZpbGwgb3V0IHRoaXMgbWFwcGluZ1xuICAgIHN3aXRjaCAoZXJyLmNvZGUpIHtcbiAgICAgIGNhc2UgUGFyc2UuRXJyb3IuSU5URVJOQUxfU0VSVkVSX0VSUk9SOlxuICAgICAgICBodHRwU3RhdHVzID0gNTAwO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORDpcbiAgICAgICAgaHR0cFN0YXR1cyA9IDQwNDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBodHRwU3RhdHVzID0gNDAwO1xuICAgIH1cbiAgICByZXMuc3RhdHVzKGh0dHBTdGF0dXMpO1xuICAgIHJlcy5qc29uKHsgY29kZTogZXJyLmNvZGUsIGVycm9yOiBlcnIubWVzc2FnZSB9KTtcbiAgICBpZiAoZXJyLmNvZGUgPT09IFBhcnNlLkVycm9yLlVTRVJOQU1FX1RBS0VOKSB7XG4gICAgICBpZiAoc2lnbnVwVXNlcm5hbWVUYWtlbkxldmVsICE9PSAnc2lsZW50Jykge1xuICAgICAgICBjb25zdCBsb2dnZXJNZXRob2QgPVxuICAgICAgICAgIHR5cGVvZiBsb2dbc2lnbnVwVXNlcm5hbWVUYWtlbkxldmVsXSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgPyBsb2dbc2lnbnVwVXNlcm5hbWVUYWtlbkxldmVsXS5iaW5kKGxvZylcbiAgICAgICAgICAgIDogbG9nLmVycm9yLmJpbmQobG9nKTtcbiAgICAgICAgbG9nZ2VyTWV0aG9kKCdQYXJzZSBlcnJvcjogJywgZXJyKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbG9nLmVycm9yKCdQYXJzZSBlcnJvcjogJywgZXJyKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoZXJyLnN0YXR1cyAmJiBlcnIubWVzc2FnZSkge1xuICAgIHJlcy5zdGF0dXMoZXJyLnN0YXR1cyk7XG4gICAgcmVzLmpzb24oeyBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XG4gICAgaWYgKCEocHJvY2VzcyAmJiBwcm9jZXNzLmVudi5URVNUSU5HKSkge1xuICAgICAgbmV4dChlcnIpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBsb2cuZXJyb3IoJ1VuY2F1Z2h0IGludGVybmFsIHNlcnZlciBlcnJvci4nLCBlcnIsIGVyci5zdGFjayk7XG4gICAgcmVzLnN0YXR1cyg1MDApO1xuICAgIHJlcy5qc29uKHtcbiAgICAgIGNvZGU6IFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUixcbiAgICAgIG1lc3NhZ2U6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3IuJyxcbiAgICB9KTtcbiAgICBpZiAoIShwcm9jZXNzICYmIHByb2Nlc3MuZW52LlRFU1RJTkcpKSB7XG4gICAgICBuZXh0KGVycik7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbmZvcmNlTWFzdGVyS2V5QWNjZXNzKHJlcSwgcmVzLCBuZXh0KSB7XG4gIGlmICghcmVxLmF1dGguaXNNYXN0ZXIpIHtcbiAgICBjb25zdCBlcnJvciA9IGNyZWF0ZVNhbml0aXplZEh0dHBFcnJvcig0MDMsICd1bmF1dGhvcml6ZWQ6IG1hc3RlciBrZXkgaXMgcmVxdWlyZWQnLCByZXEuY29uZmlnKTtcbiAgICByZXMuc3RhdHVzKGVycm9yLnN0YXR1cyk7XG4gICAgcmVzLmVuZChge1wiZXJyb3JcIjpcIiR7ZXJyb3IubWVzc2FnZX1cIn1gKTtcbiAgICByZXR1cm47XG4gIH1cbiAgbmV4dCgpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MocmVxdWVzdCkge1xuICBpZiAoIXJlcXVlc3QuYXV0aC5pc01hc3Rlcikge1xuICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEh0dHBFcnJvcig0MDMsICd1bmF1dGhvcml6ZWQ6IG1hc3RlciBrZXkgaXMgcmVxdWlyZWQnLCByZXF1ZXN0LmNvbmZpZyk7XG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xufVxuXG5leHBvcnQgY29uc3QgYWRkUmF0ZUxpbWl0ID0gKHJvdXRlLCBjb25maWcsIGNsb3VkKSA9PiB7XG4gIGlmICh0eXBlb2YgY29uZmlnID09PSAnc3RyaW5nJykge1xuICAgIGNvbmZpZyA9IENvbmZpZy5nZXQoY29uZmlnKTtcbiAgfVxuICBmb3IgKGNvbnN0IGtleSBpbiByb3V0ZSkge1xuICAgIGlmICghUmF0ZUxpbWl0T3B0aW9uc1trZXldKSB7XG4gICAgICB0aHJvdyBgSW52YWxpZCByYXRlIGxpbWl0IG9wdGlvbiBcIiR7a2V5fVwiYDtcbiAgICB9XG4gIH1cbiAgaWYgKCFjb25maWcucmF0ZUxpbWl0cykge1xuICAgIGNvbmZpZy5yYXRlTGltaXRzID0gW107XG4gIH1cbiAgY29uc3QgcmVkaXNTdG9yZSA9IHtcbiAgICBjb25uZWN0aW9uUHJvbWlzZTogUHJvbWlzZS5yZXNvbHZlKCksXG4gICAgc3RvcmU6IG51bGwsXG4gIH07XG4gIGlmIChyb3V0ZS5yZWRpc1VybCkge1xuICAgIGNvbnN0IGxvZyA9IGNvbmZpZz8ubG9nZ2VyQ29udHJvbGxlciB8fCBkZWZhdWx0TG9nZ2VyO1xuICAgIGNvbnN0IGNsaWVudCA9IGNyZWF0ZUNsaWVudCh7XG4gICAgICB1cmw6IHJvdXRlLnJlZGlzVXJsLFxuICAgIH0pO1xuICAgIGNsaWVudC5vbignZXJyb3InLCBlcnIgPT4geyBsb2cuZXJyb3IoJ01pZGRsZXdhcmVzIGFkZFJhdGVMaW1pdCBSZWRpcyBjbGllbnQgZXJyb3InLCB7IGVycm9yOiBlcnIgfSkgfSk7XG4gICAgY2xpZW50Lm9uKCdjb25uZWN0JywgKCkgPT4geyB9KTtcbiAgICBjbGllbnQub24oJ3JlY29ubmVjdGluZycsICgpID0+IHsgfSk7XG4gICAgY2xpZW50Lm9uKCdyZWFkeScsICgpID0+IHsgfSk7XG4gICAgcmVkaXNTdG9yZS5jb25uZWN0aW9uUHJvbWlzZSA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChjbGllbnQuaXNPcGVuKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGxvZy5lcnJvcihgQ291bGQgbm90IGNvbm5lY3QgdG8gcmVkaXNVUkwgaW4gcmF0ZSBsaW1pdDogJHtlfWApO1xuICAgICAgfVxuICAgIH07XG4gICAgcmVkaXNTdG9yZS5jb25uZWN0aW9uUHJvbWlzZSgpO1xuICAgIHJlZGlzU3RvcmUuc3RvcmUgPSBuZXcgUmVkaXNTdG9yZSh7XG4gICAgICBzZW5kQ29tbWFuZDogYXN5bmMgKC4uLmFyZ3MpID0+IHtcbiAgICAgICAgYXdhaXQgcmVkaXNTdG9yZS5jb25uZWN0aW9uUHJvbWlzZSgpO1xuICAgICAgICByZXR1cm4gY2xpZW50LnNlbmRDb21tYW5kKGFyZ3MpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuICBjb25maWcucmF0ZUxpbWl0cy5wdXNoKHtcbiAgICBwYXRoOiBwYXRoVG9SZWdleHAocm91dGUucmVxdWVzdFBhdGgpLFxuICAgIHJlcXVlc3RDb3VudDogcm91dGUucmVxdWVzdENvdW50LFxuICAgIHJlcXVlc3RNZXRob2RzOiByb3V0ZS5yZXF1ZXN0TWV0aG9kcyxcbiAgICBpbmNsdWRlTWFzdGVyS2V5OiByb3V0ZS5pbmNsdWRlTWFzdGVyS2V5LFxuICAgIGluY2x1ZGVJbnRlcm5hbFJlcXVlc3RzOiByb3V0ZS5pbmNsdWRlSW50ZXJuYWxSZXF1ZXN0cyxcbiAgICBlcnJvclJlc3BvbnNlTWVzc2FnZTogcm91dGUuZXJyb3JSZXNwb25zZU1lc3NhZ2UgfHwgUmF0ZUxpbWl0T3B0aW9ucy5lcnJvclJlc3BvbnNlTWVzc2FnZS5kZWZhdWx0LFxuICAgIGhhbmRsZXI6IHJhdGVMaW1pdCh7XG4gICAgICB3aW5kb3dNczogcm91dGUucmVxdWVzdFRpbWVXaW5kb3csXG4gICAgICBtYXg6IHJvdXRlLnJlcXVlc3RDb3VudCxcbiAgICAgIG1lc3NhZ2U6IHJvdXRlLmVycm9yUmVzcG9uc2VNZXNzYWdlIHx8IFJhdGVMaW1pdE9wdGlvbnMuZXJyb3JSZXNwb25zZU1lc3NhZ2UuZGVmYXVsdCxcbiAgICAgIGhhbmRsZXI6IChyZXF1ZXN0LCByZXNwb25zZSwgbmV4dCwgb3B0aW9ucykgPT4ge1xuICAgICAgICB0aHJvdyB7XG4gICAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuQ09OTkVDVElPTl9GQUlMRUQsXG4gICAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5tZXNzYWdlLFxuICAgICAgICB9O1xuICAgICAgfSxcbiAgICAgIHNraXA6IHJlcXVlc3QgPT4ge1xuICAgICAgICBpZiAocmVxdWVzdC5pcCA9PT0gJzEyNy4wLjAuMScgJiYgIXJvdXRlLmluY2x1ZGVJbnRlcm5hbFJlcXVlc3RzKSB7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJvdXRlLmluY2x1ZGVNYXN0ZXJLZXkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJvdXRlLnJlcXVlc3RNZXRob2RzKSB7XG4gICAgICAgICAgY29uc3QgbWV0aG9kc1RvQ2hlY2sgPSBuZXcgU2V0KFtyZXF1ZXN0Lm1ldGhvZF0pO1xuICAgICAgICAgIGlmIChyZXF1ZXN0Ll9iYXRjaE9yaWdpbmFsTWV0aG9kKSB7XG4gICAgICAgICAgICBtZXRob2RzVG9DaGVjay5hZGQocmVxdWVzdC5fYmF0Y2hPcmlnaW5hbE1ldGhvZCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHJvdXRlLnJlcXVlc3RNZXRob2RzKSkge1xuICAgICAgICAgICAgaWYgKCFyb3V0ZS5yZXF1ZXN0TWV0aG9kcy5zb21lKG0gPT4gbWV0aG9kc1RvQ2hlY2suaGFzKG0pKSkge1xuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgcmVnRXhwID0gbmV3IFJlZ0V4cChyb3V0ZS5yZXF1ZXN0TWV0aG9kcyk7XG4gICAgICAgICAgICBpZiAoIVsuLi5tZXRob2RzVG9DaGVja10uc29tZShtID0+IHJlZ0V4cC50ZXN0KG0pKSkge1xuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlcXVlc3QuYXV0aD8uaXNNYXN0ZXI7XG4gICAgICB9LFxuICAgICAga2V5R2VuZXJhdG9yOiBhc3luYyByZXF1ZXN0ID0+IHtcbiAgICAgICAgaWYgKHJvdXRlLnpvbmUgPT09IFBhcnNlLlNlcnZlci5SYXRlTGltaXRab25lLmdsb2JhbCkge1xuICAgICAgICAgIHJldHVybiByZXF1ZXN0LmNvbmZpZy5hcHBJZDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0b2tlbiA9IHJlcXVlc3QuaW5mby5zZXNzaW9uVG9rZW47XG4gICAgICAgIGlmIChyb3V0ZS56b25lID09PSBQYXJzZS5TZXJ2ZXIuUmF0ZUxpbWl0Wm9uZS5zZXNzaW9uICYmIHRva2VuKSB7XG4gICAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyb3V0ZS56b25lID09PSBQYXJzZS5TZXJ2ZXIuUmF0ZUxpbWl0Wm9uZS51c2VyICYmIHRva2VuKSB7XG4gICAgICAgICAgaWYgKCFyZXF1ZXN0LmF1dGgpIHtcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gaGFuZGxlUGFyc2VTZXNzaW9uKHJlcXVlc3QsIG51bGwsIHJlc29sdmUpKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHJlcXVlc3QuYXV0aD8udXNlcj8uaWQgJiYgcm91dGUuem9uZSA9PT0gJ3VzZXInKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVxdWVzdC5hdXRoLnVzZXIuaWQ7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXF1ZXN0LmNvbmZpZy5pcDtcbiAgICAgIH0sXG4gICAgICBzdG9yZTogcmVkaXNTdG9yZS5zdG9yZSxcbiAgICB9KSxcbiAgICBjbG91ZCxcbiAgfSk7XG4gIENvbmZpZy5wdXQoY29uZmlnKTtcbn07XG5cbi8qKlxuICogRGVkdXBsaWNhdGVzIGEgcmVxdWVzdCB0byBlbnN1cmUgaWRlbXBvdGVuY3kuIER1cGxpY2F0ZXMgYXJlIGRldGVybWluZWQgYnkgdGhlIHJlcXVlc3QgSURcbiAqIGluIHRoZSByZXF1ZXN0IGhlYWRlci4gSWYgYSByZXF1ZXN0IGhhcyBubyByZXF1ZXN0IElELCBpdCBpcyBleGVjdXRlZCBhbnl3YXkuXG4gKiBAcGFyYW0geyp9IHJlcSBUaGUgcmVxdWVzdCB0byBldmFsdWF0ZS5cbiAqIEByZXR1cm5zIFByb21pc2U8e30+XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcm9taXNlRW5zdXJlSWRlbXBvdGVuY3kocmVxKSB7XG4gIC8vIEVuYWJsZSBmZWF0dXJlIG9ubHkgZm9yIE1vbmdvREJcbiAgaWYgKFxuICAgICEoXG4gICAgICByZXEuY29uZmlnLmRhdGFiYXNlLmFkYXB0ZXIgaW5zdGFuY2VvZiBNb25nb1N0b3JhZ2VBZGFwdGVyIHx8XG4gICAgICByZXEuY29uZmlnLmRhdGFiYXNlLmFkYXB0ZXIgaW5zdGFuY2VvZiBQb3N0Z3Jlc1N0b3JhZ2VBZGFwdGVyXG4gICAgKVxuICApIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbiAgLy8gR2V0IHBhcmFtZXRlcnNcbiAgY29uc3QgY29uZmlnID0gcmVxLmNvbmZpZztcbiAgY29uc3QgcmVxdWVzdElkID0gKChyZXEgfHwge30pLmhlYWRlcnMgfHwge30pWyd4LXBhcnNlLXJlcXVlc3QtaWQnXTtcbiAgY29uc3QgeyBwYXRocywgdHRsIH0gPSBjb25maWcuaWRlbXBvdGVuY3lPcHRpb25zO1xuICBpZiAoIXJlcXVlc3RJZCB8fCAhY29uZmlnLmlkZW1wb3RlbmN5T3B0aW9ucykge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuICAvLyBSZXF1ZXN0IHBhdGggbWF5IGNvbnRhaW4gdHJhaWxpbmcgc2xhc2hlcywgZGVwZW5kaW5nIG9uIHRoZSBvcmlnaW5hbCByZXF1ZXN0LCBzbyByZW1vdmVcbiAgLy8gbGVhZGluZyBhbmQgdHJhaWxpbmcgc2xhc2hlcyB0byBtYWtlIGl0IGVhc2llciB0byBzcGVjaWZ5IHBhdGhzIGluIHRoZSBjb25maWd1cmF0aW9uXG4gIGNvbnN0IHJlcVBhdGggPSByZXEucGF0aC5yZXBsYWNlKC9eXFwvfFxcLyQvLCAnJyk7XG4gIC8vIERldGVybWluZSB3aGV0aGVyIGlkZW1wb3RlbmN5IGlzIGVuYWJsZWQgZm9yIGN1cnJlbnQgcmVxdWVzdCBwYXRoXG4gIGxldCBtYXRjaCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IHBhdGggb2YgcGF0aHMpIHtcbiAgICAvLyBBc3N1bWUgb25lIHdhbnRzIGEgcGF0aCB0byBhbHdheXMgbWF0Y2ggZnJvbSB0aGUgYmVnaW5uaW5nIHRvIHByZXZlbnQgYW55IG1pc3Rha2VzXG4gICAgY29uc3QgcmVnZXggPSBuZXcgUmVnRXhwKHBhdGguY2hhckF0KDApID09PSAnXicgPyBwYXRoIDogJ14nICsgcGF0aCk7XG4gICAgaWYgKHJlcVBhdGgubWF0Y2gocmVnZXgpKSB7XG4gICAgICBtYXRjaCA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuICAvLyBUcnkgdG8gc3RvcmUgcmVxdWVzdFxuICBjb25zdCBleHBpcnlEYXRlID0gbmV3IERhdGUobmV3IERhdGUoKS5zZXRTZWNvbmRzKG5ldyBEYXRlKCkuZ2V0U2Vjb25kcygpICsgdHRsKSk7XG4gIHJldHVybiByZXN0XG4gICAgLmNyZWF0ZShjb25maWcsIGF1dGgubWFzdGVyKGNvbmZpZyksICdfSWRlbXBvdGVuY3knLCB7XG4gICAgICByZXFJZDogcmVxdWVzdElkLFxuICAgICAgZXhwaXJlOiBQYXJzZS5fZW5jb2RlKGV4cGlyeURhdGUpLFxuICAgIH0pXG4gICAgLmNhdGNoKGUgPT4ge1xuICAgICAgaWYgKGUuY29kZSA9PSBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkRVUExJQ0FURV9SRVFVRVNULCAnRHVwbGljYXRlIHJlcXVlc3QnKTtcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGludmFsaWRSZXF1ZXN0KHJlcSwgcmVzKSB7XG4gIHJlcy5zdGF0dXMoNDAzKTtcbiAgcmVzLmVuZCgne1wiZXJyb3JcIjpcInVuYXV0aG9yaXplZFwifScpO1xufVxuXG5mdW5jdGlvbiBtYWxmb3JtZWRDb250ZXh0KHJlcSwgcmVzKSB7XG4gIHJlcy5zdGF0dXMoNDAwKTtcbiAgcmVzLmpzb24oeyBjb2RlOiBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGVycm9yOiAnSW52YWxpZCBvYmplY3QgZm9yIGNvbnRleHQuJyB9KTtcbn1cblxuLyoqXG4gKiBFeHByZXNzIDQgYWxsb3dlZCBhIGRvdWJsZSBmb3J3YXJkIHNsYXNoIGJldHdlZW4gYSByb3V0ZSBhbmQgcm91dGVyLiBBbHRob3VnaFxuICogdGhpcyBzaG91bGQgYmUgY29uc2lkZXJlZCBhbiBhbnRpLXBhdHRlcm4sIHdlIG5lZWQgdG8gc3VwcG9ydCBpdCBmb3IgYmFja3dhcmRzXG4gKiBjb21wYXRpYmlsaXR5LlxuICpcbiAqIFRlY2huaWNhbGx5IHZhbGlkIFVSTCB3aXRoIGRvdWJsZSBmb3Jvd2FyZCBzbGFzaDpcbiAqIGh0dHA6Ly9sb2NhbGhvc3Q6MTMzNy9wYXJzZS8vZnVuY3Rpb25zL3Rlc3RGdW5jdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gYWxsb3dEb3VibGVGb3J3YXJkU2xhc2gocmVxLCByZXMsIG5leHQpIHtcbiAgcmVxLnVybCA9IHJlcS51cmwuc3RhcnRzV2l0aCgnLy8nKSA/IHJlcS51cmwuc3Vic3RyaW5nKDEpIDogcmVxLnVybDtcbiAgbmV4dCgpO1xufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsSUFBQUEsTUFBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBQ0EsSUFBQUMsTUFBQSxHQUFBRixzQkFBQSxDQUFBQyxPQUFBO0FBQ0EsSUFBQUUsS0FBQSxHQUFBSCxzQkFBQSxDQUFBQyxPQUFBO0FBQ0EsSUFB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