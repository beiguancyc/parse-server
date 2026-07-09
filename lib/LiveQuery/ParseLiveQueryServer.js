"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ParseLiveQueryServer = void 0;
var _tv = _interopRequireDefault(require("tv4"));
var _node = _interopRequireDefault(require("parse/node"));
var _Subscription = require("./Subscription");
var _Client = require("./Client");
var _ParseWebSocketServer = require("./ParseWebSocketServer");
var _logger = _interopRequireDefault(require("../logger"));
var _RequestSchema = _interopRequireDefault(require("./RequestSchema"));
var _QueryTools = require("./QueryTools");
var _ParsePubSub = require("./ParsePubSub");
var _SchemaController = _interopRequireDefault(require("../Controllers/SchemaController"));
var _lodash = _interopRequireDefault(require("lodash"));
var _crypto = require("crypto");
var _triggers = require("../triggers");
var _Auth = require("../Auth");
var _Controllers = require("../Controllers");
var _Config = _interopRequireDefault(require("../Config"));
var _lruCache = require("lru-cache");
var _UsersRouter = _interopRequireDefault(require("../Routers/UsersRouter"));
var _DatabaseController = _interopRequireDefault(require("../Controllers/DatabaseController"));
var _util = require("util");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// @ts-ignore

class ParseLiveQueryServer {
  // className -> (queryHash -> subscription)

  // The subscriber we use to get object update from publisher

  constructor(server, config = {}, parseServerConfig = {}) {
    this.server = server;
    this.clients = new Map();
    this.subscriptions = new Map();
    this.config = config;
    config.appId = config.appId || _node.default.applicationId;
    config.masterKey = config.masterKey || _node.default.masterKey;

    // Store keys, convert obj to map
    const keyPairs = config.keyPairs || {};
    this.keyPairs = new Map();
    for (const key of Object.keys(keyPairs)) {
      this.keyPairs.set(key, keyPairs[key]);
    }
    _logger.default.verbose('Support key pairs', this.keyPairs);

    // Initialize Parse
    _node.default.Object.disableSingleInstance();
    const serverURL = config.serverURL || _node.default.serverURL;
    _node.default.serverURL = serverURL;
    _node.default.initialize(config.appId, _node.default.javaScriptKey, config.masterKey);

    // The cache controller is a proper cache controller
    // with access to User and Roles
    this.cacheController = (0, _Controllers.getCacheController)(parseServerConfig);
    config.cacheTimeout = config.cacheTimeout || 5 * 1000; // 5s

    // This auth cache stores the promises for each auth resolution.
    // The main benefit is to be able to reuse the same user / session token resolution.
    this.authCache = new _lruCache.LRUCache({
      max: 500,
      // 500 concurrent
      ttl: config.cacheTimeout
    });
    // Initialize websocket server
    this.parseWebSocketServer = new _ParseWebSocketServer.ParseWebSocketServer(server, parseWebsocket => this._onConnect(parseWebsocket), config);
    this.subscriber = _ParsePubSub.ParsePubSub.createSubscriber(config);
    if (!this.subscriber.connect) {
      this.connect();
    }
  }
  async connect() {
    if (this.subscriber.isOpen) {
      return;
    }
    if (typeof this.subscriber.connect === 'function') {
      await Promise.resolve(this.subscriber.connect());
    } else {
      this.subscriber.isOpen = true;
    }
    this._createSubscribers();
  }
  async shutdown() {
    if (this.subscriber.isOpen) {
      await Promise.all([...[...this.clients.values()].map(client => client.parseWebSocket.ws.close()), this.parseWebSocketServer.close?.(), ...Array.from(this.subscriber.subscriptions?.keys() || []).map(key => this.subscriber.unsubscribe(key)), this.subscriber.close?.()]);
    }
    if (typeof this.subscriber.close === 'function') {
      try {
        await this.subscriber.close();
      } catch (err) {
        _logger.default.error('PubSubAdapter error on shutdown', {
          error: err
        });
      }
    } else {
      this.subscriber.isOpen = false;
    }
  }
  _createSubscribers() {
    const messageRecieved = (channel, messageStr) => {
      _logger.default.verbose('Subscribe message %j', messageStr);
      let message;
      try {
        message = JSON.parse(messageStr);
      } catch (e) {
        _logger.default.error('unable to parse message', messageStr, e);
        return;
      }
      if (channel === _node.default.applicationId + 'clearCache') {
        this._clearCachedRoles(message.userId);
        return;
      }
      this._inflateParseObject(message);
      if (channel === _node.default.applicationId + 'afterSave') {
        this._onAfterSave(message);
      } else if (channel === _node.default.applicationId + 'afterDelete') {
        this._onAfterDelete(message);
      } else {
        _logger.default.error('Get message %s from unknown channel %j', message, channel);
      }
    };
    this.subscriber.on('message', (channel, messageStr) => messageRecieved(channel, messageStr));
    for (const field of ['afterSave', 'afterDelete', 'clearCache']) {
      const channel = `${_node.default.applicationId}${field}`;
      this.subscriber.subscribe(channel, messageStr => messageRecieved(channel, messageStr));
    }
  }

  // Message is the JSON object from publisher. Message.currentParseObject is the ParseObject JSON after changes.
  // Message.originalParseObject is the original ParseObject JSON.
  _inflateParseObject(message) {
    // Inflate merged object
    const currentParseObject = message.currentParseObject;
    _UsersRouter.default.removeHiddenProperties(currentParseObject);
    let className = currentParseObject.className;
    let parseObject = new _node.default.Object(className);
    parseObject._finishFetch(currentParseObject);
    message.currentParseObject = parseObject;
    // Inflate original object
    const originalParseObject = message.originalParseObject;
    if (originalParseObject) {
      _UsersRouter.default.removeHiddenProperties(originalParseObject);
      className = originalParseObject.className;
      parseObject = new _node.default.Object(className);
      parseObject._finishFetch(originalParseObject);
      message.originalParseObject = parseObject;
    }
  }

  // Message is the JSON object from publisher after inflated. Message.currentParseObject is the ParseObject after changes.
  // Message.originalParseObject is the original ParseObject.
  async _onAfterDelete(message) {
    _logger.default.verbose(_node.default.applicationId + 'afterDelete is triggered');
    let deletedParseObject = message.currentParseObject.toJSON();
    const classLevelPermissions = message.classLevelPermissions;
    const className = deletedParseObject.className;
    _logger.default.verbose('ClassName: %j | ObjectId: %s', className, deletedParseObject.id);
    _logger.default.verbose('Current client number : %d', this.clients.size);
    const classSubscriptions = this.subscriptions.get(className);
    if (typeof classSubscriptions === 'undefined') {
      _logger.default.debug('Can not find subscriptions under this class ' + className);
      return;
    }
    for (const subscription of classSubscriptions.values()) {
      let isSubscriptionMatched;
      try {
        isSubscriptionMatched = this._matchesSubscription(deletedParseObject, subscription);
      } catch (e) {
        _logger.default.error(`Failed matching subscription for class ${className}: ${e.message}`);
        continue;
      }
      if (!isSubscriptionMatched) {
        continue;
      }
      for (const [clientId, requestIds] of _lodash.default.entries(subscription.clientRequestIds)) {
        const client = this.clients.get(clientId);
        if (typeof client === 'undefined') {
          continue;
        }
        requestIds.forEach(async requestId => {
          // Deep-clone shared object so each concurrent callback works on its own copy
          let localDeletedParseObject = JSON.parse(JSON.stringify(deletedParseObject));
          const acl = message.currentParseObject.getACL();
          // Check CLP
          const op = this._getCLPOperation(subscription.query);
          let res = {};
          try {
            const matchesCLP = await this._matchesCLP(classLevelPermissions, message.currentParseObject, client, requestId, op);
            if (matchesCLP === false) {
              return null;
            }
            const isMatched = await this._matchesACL(acl, client, requestId);
            if (!isMatched) {
              return null;
            }
            res = {
              event: 'delete',
              sessionToken: client.sessionToken,
              object: localDeletedParseObject,
              clients: this.clients.size,
              subscriptions: this.subscriptions.size,
              useMasterKey: client.hasMasterKey,
              installationId: client.installationId,
              sendEvent: true
            };
            const trigger = (0, _triggers.getTrigger)(className, 'afterEvent', _node.default.applicationId);
            if (trigger) {
              const auth = await this.getAuthFromClient(client, requestId);
              if (auth && auth.user) {
                res.user = auth.user;
              }
              if (res.object) {
                res.object = _node.default.Object.fromJSON(res.object);
              }
              await (0, _triggers.runTrigger)(trigger, `afterEvent.${className}`, res, auth);
            }
            if (!res.sendEvent) {
              return;
            }
            if (res.object && typeof res.object.toJSON === 'function') {
              localDeletedParseObject = (0, _triggers.toJSONwithObjects)(res.object, res.object.className || className);
            }
            res.object = localDeletedParseObject;
            await this._filterSensitiveData(classLevelPermissions, res, client, requestId, op, subscription.query);
            client.pushDelete(requestId, res.object);
          } catch (e) {
            const error = (0, _triggers.resolveError)(e);
            _Client.Client.pushError(client.parseWebSocket, error.code, error.message, false, requestId);
            _logger.default.error(`Failed running afterLiveQueryEvent on class ${className} for event ${res.event} with session ${res.sessionToken} with:\n Error: ` + JSON.stringify(error));
          }
        });
      }
    }
  }

  // Message is the JSON object from publisher after inflated. Message.currentParseObject is the ParseObject after changes.
  // Message.originalParseObject is the original ParseObject.
  async _onAfterSave(message) {
    _logger.default.verbose(_node.default.applicationId + 'afterSave is triggered');
    let originalParseObject = null;
    if (message.originalParseObject) {
      originalParseObject = message.originalParseObject.toJSON();
    }
    const classLevelPermissions = message.classLevelPermissions;
    let currentParseObject = message.currentParseObject.toJSON();
    const className = currentParseObject.className;
    _logger.default.verbose('ClassName: %s | ObjectId: %s', className, currentParseObject.id);
    _logger.default.verbose('Current client number : %d', this.clients.size);
    const classSubscriptions = this.subscriptions.get(className);
    if (typeof classSubscriptions === 'undefined') {
      _logger.default.debug('Can not find subscriptions under this class ' + className);
      return;
    }
    for (const subscription of classSubscriptions.values()) {
      let isOriginalSubscriptionMatched;
      let isCurrentSubscriptionMatched;
      try {
        isOriginalSubscriptionMatched = this._matchesSubscription(originalParseObject, subscription);
        isCurrentSubscriptionMatched = this._matchesSubscription(currentParseObject, subscription);
      } catch (e) {
        _logger.default.error(`Failed matching subscription for class ${className}: ${e.message}`);
        continue;
      }
      for (const [clientId, requestIds] of _lodash.default.entries(subscription.clientRequestIds)) {
        const client = this.clients.get(clientId);
        if (typeof client === 'undefined') {
          continue;
        }
        requestIds.forEach(async requestId => {
          // Deep-clone shared objects so each concurrent callback works on its own copy.
          // Without cloning, _filterSensitiveData's in-place field deletion and afterEvent
          // trigger modifications corrupt the shared state across concurrent subscribers.
          let localCurrentParseObject = JSON.parse(JSON.stringify(currentParseObject));
          let localOriginalParseObject = originalParseObject ? JSON.parse(JSON.stringify(originalParseObject)) : null;
          // Set orignal ParseObject ACL checking promise, if the object does not match
          // subscription, we do not need to check ACL
          let originalACLCheckingPromise;
          if (!isOriginalSubscriptionMatched) {
            originalACLCheckingPromise = Promise.resolve(false);
          } else {
            let originalACL;
            if (message.originalParseObject) {
              originalACL = message.originalParseObject.getACL();
            }
            originalACLCheckingPromise = this._matchesACL(originalACL, client, requestId);
          }
          // Set current ParseObject ACL checking promise, if the object does not match
          // subscription, we do not need to check ACL
          let currentACLCheckingPromise;
          let res = {};
          if (!isCurrentSubscriptionMatched) {
            currentACLCheckingPromise = Promise.resolve(false);
          } else {
            const currentACL = message.currentParseObject.getACL();
            currentACLCheckingPromise = this._matchesACL(currentACL, client, requestId);
          }
          try {
            const op = this._getCLPOperation(subscription.query);
            const matchesCLP = await this._matchesCLP(classLevelPermissions, message.currentParseObject, client, requestId, op);
            if (matchesCLP === false) {
              return;
            }
            const [isOriginalMatched, isCurrentMatched] = await Promise.all([originalACLCheckingPromise, currentACLCheckingPromise]);
            _logger.default.verbose('Original %j | Current %j | Match: %s, %s, %s, %s | Query: %s', localOriginalParseObject, localCurrentParseObject, isOriginalSubscriptionMatched, isCurrentSubscriptionMatched, isOriginalMatched, isCurrentMatched, subscription.hash);
            // Decide event type
            let type;
            if (isOriginalMatched && isCurrentMatched) {
              type = 'update';
            } else if (isOriginalMatched && !isCurrentMatched) {
              type = 'leave';
            } else if (!isOriginalMatched && isCurrentMatched) {
              if (localOriginalParseObject) {
                type = 'enter';
              } else {
                type = 'create';
              }
            } else {
              return null;
            }
            const watchFieldsChanged = this._checkWatchFields(client, requestId, message);
            if (!watchFieldsChanged && (type === 'update' || type === 'create')) {
              return;
            }
            res = {
              event: type,
              sessionToken: client.sessionToken,
              object: localCurrentParseObject,
              original: localOriginalParseObject,
              clients: this.clients.size,
              subscriptions: this.subscriptions.size,
              useMasterKey: client.hasMasterKey,
              installationId: client.installationId,
              sendEvent: true
            };
            const trigger = (0, _triggers.getTrigger)(className, 'afterEvent', _node.default.applicationId);
            if (trigger) {
              if (res.object) {
                res.object = _node.default.Object.fromJSON(res.object);
              }
              if (res.original) {
                res.original = _node.default.Object.fromJSON(res.original);
              }
              const auth = await this.getAuthFromClient(client, requestId);
              if (auth && auth.user) {
                res.user = auth.user;
              }
              await (0, _triggers.runTrigger)(trigger, `afterEvent.${className}`, res, auth);
            }
            if (!res.sendEvent) {
              return;
            }
            if (res.object && typeof res.object.toJSON === 'function') {
              localCurrentParseObject = (0, _triggers.toJSONwithObjects)(res.object, res.object.className || className);
            }
            if (res.original && typeof res.original.toJSON === 'function') {
              localOriginalParseObject = (0, _triggers.toJSONwithObjects)(res.original, res.original.className || className);
            }
            res.object = localCurrentParseObject;
            res.original = localOriginalParseObject;
            await this._filterSensitiveData(classLevelPermissions, res, client, requestId, op, subscription.query);
            const functionName = 'push' + res.event.charAt(0).toUpperCase() + res.event.slice(1);
            if (client[functionName]) {
              client[functionName](requestId, res.object, res.original ?? null);
            }
          } catch (e) {
            const error = (0, _triggers.resolveError)(e);
            _Client.Client.pushError(client.parseWebSocket, error.code, error.message, false, requestId);
            _logger.default.error(`Failed running afterLiveQueryEvent on class ${className} for event ${res.event} with session ${res.sessionToken} with:\n Error: ` + JSON.stringify(error));
          }
        });
      }
    }
  }
  _onConnect(parseWebsocket) {
    parseWebsocket.on('message', request => {
      if (typeof request === 'string') {
        try {
          request = JSON.parse(request);
        } catch (e) {
          _logger.default.error('unable to parse request', request, e);
          return;
        }
      }
      _logger.default.verbose('Request: %j', request);

      // Check whether this request is a valid request, return error directly if not
      if (!_tv.default.validate(request, _RequestSchema.default['general']) || !_tv.default.validate(request, _RequestSchema.default[request.op])) {
        _Client.Client.pushError(parseWebsocket, 1, _tv.default.error.message);
        _logger.default.error('Connect message error %s', _tv.default.error.message);
        return;
      }
      switch (request.op) {
        case 'connect':
          this._handleConnect(parseWebsocket, request);
          break;
        case 'subscribe':
          this._handleSubscribe(parseWebsocket, request);
          break;
        case 'update':
          this._handleUpdateSubscription(parseWebsocket, request);
          break;
        case 'unsubscribe':
          this._handleUnsubscribe(parseWebsocket, request);
          break;
        default:
          _Client.Client.pushError(parseWebsocket, 3, 'Get unknown operation');
          _logger.default.error('Get unknown operation', request.op);
      }
    });
    parseWebsocket.on('disconnect', () => {
      _logger.default.info(`Client disconnect: ${parseWebsocket.clientId}`);
      const clientId = parseWebsocket.clientId;
      if (!this.clients.has(clientId)) {
        (0, _triggers.runLiveQueryEventHandlers)({
          event: 'ws_disconnect_error',
          clients: this.clients.size,
          subscriptions: this.subscriptions.size,
          error: `Unable to find client ${clientId}`
        });
        _logger.default.error(`Can not find client ${clientId} on disconnect`);
        return;
      }

      // Delete client
      const client = this.clients.get(clientId);
      this.clients.delete(clientId);

      // Delete client from subscriptions
      for (const [requestId, subscriptionInfo] of _lodash.default.entries(client.subscriptionInfos)) {
        const subscription = subscriptionInfo.subscription;
        subscription.deleteClientSubscription(clientId, requestId);

        // If there is no client which is subscribing this subscription, remove it from subscriptions
        const classSubscriptions = this.subscriptions.get(subscription.className);
        if (!subscription.hasSubscribingClient()) {
          classSubscriptions.delete(subscription.hash);
        }
        // If there is no subscriptions under this class, remove it from subscriptions
        if (classSubscriptions.size === 0) {
          this.subscriptions.delete(subscription.className);
        }
      }
      _logger.default.verbose('Current clients %d', this.clients.size);
      _logger.default.verbose('Current subscriptions %d', this.subscriptions.size);
      (0, _triggers.runLiveQueryEventHandlers)({
        event: 'ws_disconnect',
        clients: this.clients.size,
        subscriptions: this.subscriptions.size,
        useMasterKey: client.hasMasterKey,
        installationId: client.installationId,
        sessionToken: client.sessionToken
      });
    });
    (0, _triggers.runLiveQueryEventHandlers)({
      event: 'ws_connect',
      clients: this.clients.size,
      subscriptions: this.subscriptions.size
    });
  }
  _validateQueryConstraints(where) {
    if (typeof where !== 'object' || where === null) {
      return;
    }
    for (const op of ['$or', '$and', '$nor']) {
      if (where[op] !== undefined && !Array.isArray(where[op])) {
        throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `${op} must be an array`);
      }
      if (Array.isArray(where[op])) {
        where[op].forEach(subQuery => {
          this._validateQueryConstraints(subQuery);
        });
      }
    }
    for (const key of Object.keys(where)) {
      const constraint = where[key];
      if (typeof constraint === 'object' && constraint !== null) {
        if (constraint.$regex !== undefined) {
          const regex = constraint.$regex;
          const isRegExpLike = regex !== null && typeof regex === 'object' && typeof regex.source === 'string' && typeof regex.flags === 'string';
          if (typeof regex !== 'string' && !isRegExpLike) {
            throw new _node.default.Error(_node.default.Error.INVALID_QUERY, 'Invalid regular expression: $regex must be a string or RegExp');
          }
          const pattern = isRegExpLike ? regex.source : regex;
          const flags = isRegExpLike ? regex.flags : constraint.$options || '';
          try {
            new RegExp(pattern, flags);
          } catch (e) {
            throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Invalid regular expression: ${e.message}`);
          }
        }
      }
    }
  }
  _matchesSubscription(parseObject, subscription) {
    // Object is undefined or null, not match
    if (!parseObject) {
      return false;
    }
    return (0, _QueryTools.matchesQuery)(structuredClone(parseObject), subscription.query);
  }
  async _clearCachedRoles(userId) {
    try {
      const validTokens = await new _node.default.Query(_node.default.Session).equalTo('user', _node.default.User.createWithoutData(userId)).find({
        useMasterKey: true
      });
      await Promise.all(validTokens.map(async token => {
        const sessionToken = token.get('sessionToken');
        const authPromise = this.authCache.get(sessionToken);
        if (!authPromise) {
          return;
        }
        const [auth1, auth2] = await Promise.all([authPromise, (0, _Auth.getAuthForSessionToken)({
          cacheController: this.cacheController,
          sessionToken
        })]);
        auth1.auth?.clearRoleCache(sessionToken);
        auth2.auth?.clearRoleCache(sessionToken);
        this.authCache.delete(sessionToken);
      }));
    } catch (e) {
      _logger.default.verbose(`Could not clear role cache. ${e}`);
    }
  }
  getAuthForSessionToken(sessionToken) {
    if (!sessionToken) {
      return Promise.resolve({});
    }
    const fromCache = this.authCache.get(sessionToken);
    if (fromCache) {
      return fromCache;
    }
    const authPromise = (0, _Auth.getAuthForSessionToken)({
      cacheController: this.cacheController,
      sessionToken: sessionToken
    }).then(auth => {
      return {
        auth,
        userId: auth && auth.user && auth.user.id
      };
    }).catch(error => {
      // There was an error with the session token
      const result = {};
      if (error && error.code === _node.default.Error.INVALID_SESSION_TOKEN) {
        result.error = error;
        this.authCache.set(sessionToken, Promise.resolve(result), this.config.cacheTimeout);
      } else {
        this.authCache.delete(sessionToken);
      }
      return result;
    });
    this.authCache.set(sessionToken, authPromise);
    return authPromise;
  }
  async _matchesCLP(classLevelPermissions, object, client, requestId, op) {
    const subscriptionInfo = client.getSubscriptionInfo(requestId);
    const aclGroup = ['*'];
    let userId;
    if (typeof subscriptionInfo !== 'undefined') {
      const result = await this.getAuthForSessionToken(subscriptionInfo.sessionToken);
      userId = result.userId;
      if (userId) {
        aclGroup.push(userId);
      }
    }
    await _SchemaController.default.validatePermission(classLevelPermissions, object.className, aclGroup, op);
    // Enforce pointer permissions that validatePermission defers.
    // Returns false to silently skip the event (like ACL), rather than
    // throwing which would push errors to the client and log noise.
    if (!client.hasMasterKey && classLevelPermissions) {
      const permissionField = ['get', 'find', 'count'].indexOf(op) > -1 ? 'readUserFields' : 'writeUserFields';
      const pointerFields = [];
      if (classLevelPermissions[op]?.pointerFields) {
        pointerFields.push(...classLevelPermissions[op].pointerFields);
      }
      if (Array.isArray(classLevelPermissions[permissionField])) {
        for (const field of classLevelPermissions[permissionField]) {
          if (!pointerFields.includes(field)) {
            pointerFields.push(field);
          }
        }
      }
      if (pointerFields.length > 0) {
        // If public or user-specific permission already grants access, skip pointer check
        if (!_SchemaController.default.testPermissions(classLevelPermissions, aclGroup, op)) {
          if (!userId) {
            return false;
          }
          // Check if any pointer field points to the current user
          const hasAccess = pointerFields.some(field => {
            const value = typeof object.get === 'function' ? object.get(field) : object[field];
            if (!value) {
              return false;
            }
            // Handle Parse.Object pointer (has .id)
            if (value.id) {
              return value.id === userId;
            }
            // Handle raw pointer JSON (has .objectId)
            if (value.objectId) {
              return value.objectId === userId;
            }
            // Handle array of pointers
            if (Array.isArray(value)) {
              return value.some(item => {
                if (item.id) {
                  return item.id === userId;
                }
                if (item.objectId) {
                  return item.objectId === userId;
                }
                return false;
              });
            }
            return false;
          });
          if (!hasAccess) {
            return false;
          }
        }
      }
    }
  }
  async _filterSensitiveData(classLevelPermissions, res, client, requestId, op, query) {
    const subscriptionInfo = client.getSubscriptionInfo(requestId);
    const aclGroup = ['*'];
    let clientAuth;
    if (typeof subscriptionInfo !== 'undefined') {
      const {
        userId,
        auth
      } = await this.getAuthForSessionToken(subscriptionInfo.sessionToken);
      if (userId) {
        aclGroup.push(userId);
      }
      clientAuth = auth;
    }
    const filter = obj => {
      if (!obj) {
        return;
      }
      let protectedFields = classLevelPermissions?.protectedFields || [];
      if (client.hasMasterKey) {
        protectedFields = [];
      } else if (!Array.isArray(protectedFields)) {
        protectedFields = (0, _Controllers.getDatabaseController)(this.config).addProtectedFields(classLevelPermissions, res.object.className, query, aclGroup, clientAuth);
      }
      return _DatabaseController.default.filterSensitiveData(client.hasMasterKey, false, aclGroup, clientAuth, op, classLevelPermissions, res.object.className, protectedFields, obj, this.config.protectedFieldsOwnerExempt);
    };
    res.object = filter(res.object);
    res.original = filter(res.original);
  }
  _getCLPOperation(query) {
    return typeof query === 'object' && Object.keys(query).length == 1 && typeof query.objectId === 'string' ? 'get' : 'find';
  }
  async _verifyACL(acl, token) {
    if (!token) {
      return false;
    }
    const {
      auth,
      userId
    } = await this.getAuthForSessionToken(token);

    // Getting the session token failed
    // This means that no additional auth is available
    // At this point, just bail out as no additional visibility can be inferred.
    if (!auth || !userId) {
      return false;
    }
    const isSubscriptionSessionTokenMatched = acl.getReadAccess(userId);
    if (isSubscriptionSessionTokenMatched) {
      return true;
    }

    // Check if the user has any roles that match the ACL
    return Promise.resolve().then(async () => {
      // Resolve false right away if the acl doesn't have any roles
      const acl_has_roles = Object.keys(acl.permissionsById).some(key => key.startsWith('role:'));
      if (!acl_has_roles) {
        return false;
      }
      const roleNames = await auth.getUserRoles();
      // Finally, see if any of the user's roles allow them read access
      for (const role of roleNames) {
        // We use getReadAccess as `role` is in the form `role:roleName`
        if (acl.getReadAccess(role)) {
          return true;
        }
      }
      return false;
    }).catch(() => {
      return false;
    });
  }
  async getAuthFromClient(client, requestId, sessionToken) {
    const getSessionFromClient = () => {
      const subscriptionInfo = client.getSubscriptionInfo(requestId);
      if (typeof subscriptionInfo === 'undefined') {
        return client.sessionToken;
      }
      return subscriptionInfo.sessionToken || client.sessionToken;
    };
    if (!sessionToken) {
      sessionToken = getSessionFromClient();
    }
    if (!sessionToken) {
      return;
    }
    const {
      auth
    } = await this.getAuthForSessionToken(sessionToken);
    return auth;
  }
  _checkWatchFields(client, requestId, message) {
    const subscriptionInfo = client.getSubscriptionInfo(requestId);
    const watch = subscriptionInfo?.watch;
    if (!watch) {
      return true;
    }
    const object = message.currentParseObject;
    const original = message.originalParseObject;
    return watch.some(field => !(0, _util.isDeepStrictEqual)(object.get(field), original?.get(field)));
  }
  async _matchesACL(acl, client, requestId) {
    // Return true directly if ACL isn't present, ACL is public read, or client has master key
    if (!acl || acl.getPublicReadAccess() || client.hasMasterKey) {
      return true;
    }
    // Check subscription sessionToken matches ACL first
    const subscriptionInfo = client.getSubscriptionInfo(requestId);
    if (typeof subscriptionInfo === 'undefined') {
      return false;
    }
    const subscriptionToken = subscriptionInfo.sessionToken;
    const clientSessionToken = client.sessionToken;
    if (await this._verifyACL(acl, subscriptionToken)) {
      return true;
    }
    if (await this._verifyACL(acl, clientSessionToken)) {
      return true;
    }
    return false;
  }
  async _handleConnect(parseWebsocket, request) {
    if (!this._validateKeys(request, this.keyPairs)) {
      _Client.Client.pushError(parseWebsocket, 4, 'Key in request is not valid');
      _logger.default.error('Key in request is not valid');
      return;
    }
    const hasMasterKey = this._hasMasterKey(request, this.keyPairs);
    const clientId = (0, _crypto.randomUUID)();
    const client = new _Client.Client(clientId, parseWebsocket, hasMasterKey, request.sessionToken, request.installationId);
    try {
      const req = {
        client,
        event: 'connect',
        clients: this.clients.size,
        subscriptions: this.subscriptions.size,
        sessionToken: request.sessionToken,
        useMasterKey: client.hasMasterKey,
        installationId: request.installationId,
        user: undefined
      };
      const trigger = (0, _triggers.getTrigger)('@Connect', 'beforeConnect', _node.default.applicationId);
      if (trigger) {
        const auth = await this.getAuthFromClient(client, request.requestId, req.sessionToken);
        if (auth && auth.user) {
          req.user = auth.user;
        }
        await (0, _triggers.runTrigger)(trigger, `beforeConnect.@Connect`, req, auth);
      }
      parseWebsocket.clientId = clientId;
      this.clients.set(parseWebsocket.clientId, client);
      _logger.default.info(`Create new client: ${parseWebsocket.clientId}`);
      client.pushConnect();
      (0, _triggers.runLiveQueryEventHandlers)(req);
    } catch (e) {
      const error = (0, _triggers.resolveError)(e);
      _Client.Client.pushError(parseWebsocket, error.code, error.message, false);
      _logger.default.error(`Failed running beforeConnect for session ${request.sessionToken} with:\n Error: ` + JSON.stringify(error));
    }
  }
  _hasMasterKey(request, validKeyPairs) {
    if (!validKeyPairs || validKeyPairs.size == 0 || !validKeyPairs.has('masterKey')) {
      return false;
    }
    if (!request || !Object.prototype.hasOwnProperty.call(request, 'masterKey')) {
      return false;
    }
    return request.masterKey === validKeyPairs.get('masterKey');
  }
  _validateKeys(request, validKeyPairs) {
    if (!validKeyPairs || validKeyPairs.size == 0) {
      return true;
    }
    let isValid = false;
    for (const [key, secret] of validKeyPairs) {
      if (!request[key] || request[key] !== secret) {
        continue;
      }
      isValid = true;
      break;
    }
    return isValid;
  }
  async _handleSubscribe(parseWebsocket, request) {
    // If we can not find this client, return error to client
    if (!Object.prototype.hasOwnProperty.call(parseWebsocket, 'clientId')) {
      _Client.Client.pushError(parseWebsocket, 2, 'Can not find this client, make sure you connect to server before subscribing');
      _logger.default.error('Can not find this client, make sure you connect to server before subscribing');
      return;
    }
    const client = this.clients.get(parseWebsocket.clientId);
    const className = request.query.className;
    let authCalled = false;
    try {
      const trigger = (0, _triggers.getTrigger)(className, 'beforeSubscribe', _node.default.applicationId);
      if (trigger) {
        const auth = await this.getAuthFromClient(client, request.requestId, request.sessionToken);
        authCalled = true;
        if (auth && auth.user) {
          request.user = auth.user;
        }
        const parseQuery = new _node.default.Query(className);
        parseQuery.withJSON(request.query);
        request.query = parseQuery;
        await (0, _triggers.runTrigger)(trigger, `beforeSubscribe.${className}`, request, auth);
        const query = request.query.toJSON();
        request.query = query;
      }
      if (className === '_Session') {
        if (!authCalled) {
          const auth = await this.getAuthFromClient(client, request.requestId, request.sessionToken);
          if (auth && auth.user) {
            request.user = auth.user;
          }
        }
        if (request.user) {
          request.query.where.user = request.user.toPointer();
        } else if (!request.master) {
          _Client.Client.pushError(parseWebsocket, _node.default.Error.INVALID_SESSION_TOKEN, 'Invalid session token', false, request.requestId);
          return;
        }
      }
      // Validate query condition depth
      const appConfig = _Config.default.get(this.config.appId);
      if (!client.hasMasterKey) {
        const rc = appConfig.requestComplexity;
        if (rc && rc.queryDepth !== -1) {
          const maxDepth = rc.queryDepth;
          const checkDepth = (where, depth) => {
            if (depth > maxDepth) {
              throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Query condition nesting depth exceeds maximum allowed depth of ${maxDepth}`);
            }
            if (typeof where !== 'object' || where === null) {
              return;
            }
            for (const op of ['$or', '$and', '$nor']) {
              if (where[op] !== undefined && !Array.isArray(where[op])) {
                throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `${op} must be an array`);
              }
              if (Array.isArray(where[op])) {
                for (const subQuery of where[op]) {
                  checkDepth(subQuery, depth + 1);
                }
              }
            }
          };
          checkDepth(request.query.where, 0);
        }
      }

      // Validate allowRegex
      if (!client.hasMasterKey) {
        const rc = appConfig.requestComplexity;
        if (rc && rc.allowRegex === false) {
          const checkRegex = where => {
            if (typeof where !== 'object' || where === null) {
              return;
            }
            for (const key of Object.keys(where)) {
              const constraint = where[key];
              if (typeof constraint === 'object' && constraint !== null && constraint.$regex !== undefined) {
                throw new _node.default.Error(_node.default.Error.INVALID_QUERY, '$regex operator is not allowed');
              }
            }
            for (const op of ['$or', '$and', '$nor']) {
              if (Array.isArray(where[op])) {
                for (const subQuery of where[op]) {
                  checkRegex(subQuery);
                }
              }
            }
          };
          checkRegex(request.query.where);
        }
      }

      // Check CLP for subscribe operation
      const schemaController = await appConfig.database.loadSchema();
      const classLevelPermissions = schemaController.getClassLevelPermissions(className);
      const op = this._getCLPOperation(request.query);
      const aclGroup = ['*'];
      if (!authCalled) {
        const auth = await this.getAuthFromClient(client, request.requestId, request.sessionToken);
        authCalled = true;
        if (auth && auth.user) {
          request.user = auth.user;
          aclGroup.push(auth.user.id);
        }
      } else if (request.user) {
        aclGroup.push(request.user.id);
      }
      await _SchemaController.default.validatePermission(classLevelPermissions, className, aclGroup, op);

      // Check protected fields in WHERE clause and WATCH parameter
      if (!client.hasMasterKey) {
        const auth = request.user ? {
          user: request.user,
          userRoles: []
        } : {};
        const protectedFields = appConfig.database.addProtectedFields(classLevelPermissions, className, request.query.where, aclGroup, auth) || [];
        if (protectedFields.length > 0 && request.query.where) {
          const checkWhere = where => {
            if (typeof where !== 'object' || where === null) {
              return;
            }
            for (const whereKey of Object.keys(where)) {
              const rootField = whereKey.split('.')[0];
              if (protectedFields.includes(whereKey) || protectedFields.includes(rootField)) {
                throw new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, 'Permission denied');
              }
            }
            for (const op of ['$or', '$and', '$nor']) {
              if (where[op] !== undefined && !Array.isArray(where[op])) {
                throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `${op} must be an array`);
              }
              if (Array.isArray(where[op])) {
                where[op].forEach(subQuery => checkWhere(subQuery));
              }
            }
          };
          checkWhere(request.query.where);
        }
        if (protectedFields.length > 0 && Array.isArray(request.query.watch)) {
          for (const watchField of request.query.watch) {
            const rootField = watchField.split('.')[0];
            if (protectedFields.includes(watchField) || protectedFields.includes(rootField)) {
              throw new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, 'Permission denied');
            }
          }
        }
      }

      // Validate regex patterns in the subscription query
      this._validateQueryConstraints(request.query.where);

      // Get subscription from subscriptions, create one if necessary
      const subscriptionHash = (0, _QueryTools.queryHash)(request.query);
      // Add className to subscriptions if necessary

      if (!this.subscriptions.has(className)) {
        this.subscriptions.set(className, new Map());
      }
      const classSubscriptions = this.subscriptions.get(className);
      let subscription;
      if (classSubscriptions.has(subscriptionHash)) {
        subscription = classSubscriptions.get(subscriptionHash);
      } else {
        subscription = new _Subscription.Subscription(className, request.query.where, subscriptionHash);
        classSubscriptions.set(subscriptionHash, subscription);
      }

      // Add subscriptionInfo to client
      const subscriptionInfo = {
        subscription: subscription
      };
      // Add selected fields, sessionToken and installationId for this subscription if necessary
      if (request.query.keys) {
        subscriptionInfo.keys = Array.isArray(request.query.keys) ? request.query.keys : request.query.keys.split(',');
      }
      if (request.query.watch) {
        subscriptionInfo.watch = request.query.watch;
      }
      if (request.sessionToken) {
        subscriptionInfo.sessionToken = request.sessionToken;
      }
      client.addSubscriptionInfo(request.requestId, subscriptionInfo);

      // Add clientId to subscription
      subscription.addClientSubscription(parseWebsocket.clientId, request.requestId);
      client.pushSubscribe(request.requestId);
      _logger.default.verbose(`Create client ${parseWebsocket.clientId} new subscription: ${request.requestId}`);
      _logger.default.verbose('Current client number: %d', this.clients.size);
      (0, _triggers.runLiveQueryEventHandlers)({
        client,
        event: 'subscribe',
        clients: this.clients.size,
        subscriptions: this.subscriptions.size,
        sessionToken: request.sessionToken,
        useMasterKey: client.hasMasterKey,
        installationId: client.installationId
      });
    } catch (e) {
      const error = (0, _triggers.resolveError)(e);
      _Client.Client.pushError(parseWebsocket, error.code, error.message, false, request.requestId);
      _logger.default.error(`Failed running beforeSubscribe on ${className} for session ${request.sessionToken} with:\n Error: ` + JSON.stringify(error));
    }
  }
  _handleUpdateSubscription(parseWebsocket, request) {
    this._handleUnsubscribe(parseWebsocket, request, false);
    this._handleSubscribe(parseWebsocket, request);
  }
  _handleUnsubscribe(parseWebsocket, request, notifyClient = true) {
    // If we can not find this client, return error to client
    if (!Object.prototype.hasOwnProperty.call(parseWebsocket, 'clientId')) {
      _Client.Client.pushError(parseWebsocket, 2, 'Can not find this client, make sure you connect to server before unsubscribing');
      _logger.default.error('Can not find this client, make sure you connect to server before unsubscribing');
      return;
    }
    const requestId = request.requestId;
    const client = this.clients.get(parseWebsocket.clientId);
    if (typeof client === 'undefined') {
      _Client.Client.pushError(parseWebsocket, 2, 'Cannot find client with clientId ' + parseWebsocket.clientId + '. Make sure you connect to live query server before unsubscribing.');
      _logger.default.error('Can not find this client ' + parseWebsocket.clientId);
      return;
    }
    const subscriptionInfo = client.getSubscriptionInfo(requestId);
    if (typeof subscriptionInfo === 'undefined') {
      _Client.Client.pushError(parseWebsocket, 2, 'Cannot find subscription with clientId ' + parseWebsocket.clientId + ' subscriptionId ' + requestId + '. Make sure you subscribe to live query server before unsubscribing.');
      _logger.default.error('Can not find subscription with clientId ' + parseWebsocket.clientId + ' subscriptionId ' + requestId);
      return;
    }

    // Remove subscription from client
    client.deleteSubscriptionInfo(requestId);
    // Remove client from subscription
    const subscription = subscriptionInfo.subscription;
    const className = subscription.className;
    subscription.deleteClientSubscription(parseWebsocket.clientId, requestId);
    // If there is no client which is subscribing this subscription, remove it from subscriptions
    const classSubscriptions = this.subscriptions.get(className);
    if (!subscription.hasSubscribingClient()) {
      classSubscriptions.delete(subscription.hash);
    }
    // If there is no subscriptions under this class, remove it from subscriptions
    if (classSubscriptions.size === 0) {
      this.subscriptions.delete(className);
    }
    (0, _triggers.runLiveQueryEventHandlers)({
      client,
      event: 'unsubscribe',
      clients: this.clients.size,
      subscriptions: this.subscriptions.size,
      sessionToken: subscriptionInfo.sessionToken,
      useMasterKey: client.hasMasterKey,
      installationId: client.installationId
    });
    if (!notifyClient) {
      return;
    }
    client.pushUnsubscribe(request.requestId);
    _logger.default.verbose(`Delete client: ${parseWebsocket.clientId} | subscription: ${request.requestId}`);
  }
}
exports.ParseLiveQueryServer = ParseLiveQueryServer;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfdHYiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwicmVxdWlyZSIsIl9ub2RlIiwiX1N1YnNjcmlwdGlvbiIsIl9DbGllbnQiLCJfUGFyc2VXZWJTb2NrZXRTZXJ2ZXIiLCJfbG9nZ2VyIiwiX1JlcXVlc3RTY2hlbWEiLCJfUXVlcnlUb29scyIsIl9QYXJzZVB1YlN1YiIsIl9TY2hlbWFDb250cm9sbGVyIiwiX2xvZGFzaCIsIl9jcnlwdG8iLCJfdHJpZ2dlcnMiLCJfQXV0aCIsIl9Db250cm9sbGVycyIsIl9Db25maWciLCJfbHJ1Q2FjaGUiLCJfVXNlcnNSb3V0ZXIiLCJfRGF0YWJhc2VDb250cm9sbGVyIiwiX3V0aWwiLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJQYXJzZUxpdmVRdWVyeVNlcnZlciIsImNvbnN0cnVjdG9yIiwic2VydmVyIiwiY29uZmlnIiwicGFyc2VTZXJ2ZXJDb25maWciLCJjbGllbnRzIiwiTWFwIiwic3Vic2NyaXB0aW9ucyIsImFwcElkIiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwibWFzdGVyS2V5Iiwia2V5UGFpcnMiLCJrZXkiLCJPYmplY3QiLCJrZXlzIiwic2V0IiwibG9nZ2VyIiwidmVyYm9zZSIsImRpc2FibGVTaW5nbGVJbnN0YW5jZSIsInNlcnZlclVSTCIsImluaXRpYWxpemUiLCJqYXZhU2NyaXB0S2V5IiwiY2FjaGVDb250cm9sbGVyIiwiZ2V0Q2FjaGVDb250cm9sbGVyIiwiY2FjaGVUaW1lb3V0IiwiYXV0aENhY2hlIiwiTFJVIiwibWF4IiwidHRsIiwicGFyc2VXZWJTb2NrZXRTZXJ2ZXIiLCJQYXJzZVdlYlNvY2tldFNlcnZlciIsInBhcnNlV2Vic29ja2V0IiwiX29uQ29ubmVjdCIsInN1YnNjcmliZXIiLCJQYXJzZVB1YlN1YiIsImNyZWF0ZVN1YnNjcmliZXIiLCJjb25uZWN0IiwiaXNPcGVuIiwiUHJvbWlzZSIsInJlc29sdmUiLCJfY3JlYXRlU3Vic2NyaWJlcnMiLCJzaHV0ZG93biIsImFsbCIsInZhbHVlcyIsIm1hcCIsImNsaWVudCIsInBhcnNlV2ViU29ja2V0Iiwid3MiLCJjbG9zZSIsIkFycmF5IiwiZnJvbSIsInVuc3Vic2NyaWJlIiwiZXJyIiwiZXJyb3IiLCJtZXNzYWdlUmVjaWV2ZWQiLCJjaGFubmVsIiwibWVzc2FnZVN0ciIsIm1lc3NhZ2UiLCJKU09OIiwicGFyc2UiLCJfY2xlYXJDYWNoZWRSb2xlcyIsInVzZXJJZCIsIl9pbmZsYXRlUGFyc2VPYmplY3QiLCJfb25BZnRlclNhdmUiLCJfb25BZnRlckRlbGV0ZSIsIm9uIiwiZmllbGQiLCJzdWJzY3JpYmUiLCJjdXJyZW50UGFyc2VPYmplY3QiLCJVc2VyUm91dGVyIiwicmVtb3ZlSGlkZGVuUHJvcGVydGllcyIsImNsYXNzTmFtZSIsInBhcnNlT2JqZWN0IiwiX2ZpbmlzaEZldGNoIiwib3JpZ2luYWxQYXJzZU9iamVjdCIsImRlbGV0ZWRQYXJzZU9iamVjdCIsInRvSlNPTiIsImNsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsImlkIiwic2l6ZSIsImNsYXNzU3Vic2NyaXB0aW9ucyIsImdldCIsImRlYnVnIiwic3Vic2NyaXB0aW9uIiwiaXNTdWJzY3JpcHRpb25NYXRjaGVkIiwiX21hdGNoZXNTdWJzY3JpcHRpb24iLCJjbGllbnRJZCIsInJlcXVlc3RJZHMiLCJfIiwiZW50cmllcyIsImNsaWVudFJlcXVlc3RJZHMiLCJmb3JFYWNoIiwicmVxdWVzdElkIiwibG9jYWxEZWxldGVkUGFyc2VPYmplY3QiLCJzdHJpbmdpZnkiLCJhY2wiLCJnZXRBQ0wiLCJvcCIsIl9nZXRDTFBPcGVyYXRpb24iLCJxdWVyeSIsInJlcyIsIm1hdGNoZXNDTFAiLCJfbWF0Y2hlc0NMUCIsImlzTWF0Y2hlZCIsIl9tYXRjaGVzQUNMIiwiZXZlbnQiLCJzZXNzaW9uVG9rZW4iLCJvYmplY3QiLCJ1c2VNYXN0ZXJLZXkiLCJoYXNNYXN0ZXJLZXkiLCJpbnN0YWxsYXRpb25JZCIsInNlbmRFdmVudCIsInRyaWdnZXIiLCJnZXRUcmlnZ2VyIiwiYXV0aCIsImdldEF1dGhGcm9tQ2xpZW50IiwidXNlciIsImZyb21KU09OIiwicnVuVHJpZ2dlciIsInRvSlNPTndpdGhPYmplY3RzIiwiX2ZpbHRlclNlbnNpdGl2ZURhdGEiLCJwdXNoRGVsZXRlIiwicmVzb2x2ZUVycm9yIiwiQ2xpZW50IiwicHVzaEVycm9yIiwiY29kZSIsImlzT3JpZ2luYWxTdWJzY3JpcHRpb25NYXRjaGVkIiwiaXNDdXJyZW50U3Vic2NyaXB0aW9uTWF0Y2hlZCIsImxvY2FsQ3VycmVudFBhcnNlT2JqZWN0IiwibG9jYWxPcmlnaW5hbFBhcnNlT2JqZWN0Iiwib3JpZ2luYWxBQ0xDaGVja2luZ1Byb21pc2UiLCJvcmlnaW5hbEFDTCIsImN1cnJlbnRBQ0xDaGVja2luZ1Byb21pc2UiLCJjdXJyZW50QUNMIiwiaXNPcmlnaW5hbE1hdGNoZWQiLCJpc0N1cnJlbnRNYXRjaGVkIiwiaGFzaCIsInR5cGUiLCJ3YXRjaEZpZWxkc0NoYW5nZWQiLCJfY2hlY2tXYXRjaEZpZWxkcyIsIm9yaWdpbmFsIiwiZnVuY3Rpb25OYW1lIiwiY2hhckF0IiwidG9VcHBlckNhc2UiLCJzbGljZSIsInJlcXVlc3QiLCJ0djQiLCJ2YWxpZGF0ZSIsIlJlcXVlc3RTY2hlbWEiLCJfaGFuZGxlQ29ubmVjdCIsIl9oYW5kbGVTdWJzY3JpYmUiLCJfaGFuZGxlVXBkYXRlU3Vic2NyaXB0aW9uIiwiX2hhbmRsZVVuc3Vic2NyaWJlIiwiaW5mbyIsImhhcyIsInJ1bkxpdmVRdWVyeUV2ZW50SGFuZGxlcnMiLCJkZWxldGUiLCJzdWJzY3JpcHRpb25JbmZvIiwic3Vic2NyaXB0aW9uSW5mb3MiLCJkZWxldGVDbGllbnRTdWJzY3JpcHRpb24iLCJoYXNTdWJzY3JpYmluZ0NsaWVudCIsIl92YWxpZGF0ZVF1ZXJ5Q29uc3RyYWludHMiLCJ3aGVyZSIsInVuZGVmaW5lZCIsImlzQXJyYXkiLCJFcnJvciIsIklOVkFMSURfUVVFUlkiLCJzdWJRdWVyeSIsImNvbnN0cmFpbnQiLCIkcmVnZXgiLCJyZWdleCIsImlzUmVnRXhwTGlrZSIsInNvdXJjZSIsImZsYWdzIiwicGF0dGVybiIsIiRvcHRpb25zIiwiUmVnRXhwIiwibWF0Y2hlc1F1ZXJ5Iiwic3RydWN0dXJlZENsb25lIiwidmFsaWRUb2tlbnMiLCJRdWVyeSIsIlNlc3Npb24iLCJlcXVhbFRvIiwiVXNlciIsImNyZWF0ZVdpdGhvdXREYXRhIiwiZmluZCIsInRva2VuIiwiYXV0aFByb21pc2UiLCJhdXRoMSIsImF1dGgyIiwiZ2V0QXV0aEZvclNlc3Npb25Ub2tlbiIsImNsZWFyUm9sZUNhY2hlIiwiZnJvbUNhY2hlIiwidGhlbiIsImNhdGNoIiwicmVzdWx0IiwiSU5WQUxJRF9TRVNTSU9OX1RPS0VOIiwiZ2V0U3Vic2NyaXB0aW9uSW5mbyIsImFjbEdyb3VwIiwicHVzaCIsIlNjaGVtYUNvbnRyb2xsZXIiLCJ2YWxpZGF0ZVBlcm1pc3Npb24iLCJwZXJtaXNzaW9uRmllbGQiLCJpbmRleE9mIiwicG9pbnRlckZpZWxkcyIsImluY2x1ZGVzIiwibGVuZ3RoIiwidGVzdFBlcm1pc3Npb25zIiwiaGFzQWNjZXNzIiwic29tZSIsInZhbHVlIiwib2JqZWN0SWQiLCJpdGVtIiwiY2xpZW50QXV0aCIsImZpbHRlciIsIm9iaiIsInByb3RlY3RlZEZpZWxkcyIsImdldERhdGFiYXNlQ29udHJvbGxlciIsImFkZFByb3RlY3RlZEZpZWxkcyIsIkRhdGFiYXNlQ29udHJvbGxlciIsImZpbHRlclNlbnNpdGl2ZURhdGEiLCJwcm90ZWN0ZWRGaWVsZHNPd25lckV4ZW1wdCIsIl92ZXJpZnlBQ0wiLCJpc1N1YnNjcmlwdGlvblNlc3Npb25Ub2tlbk1hdGNoZWQiLCJnZXRSZWFkQWNjZXNzIiwiYWNsX2hhc19yb2xlcyIsInBlcm1pc3Npb25zQnlJZCIsInN0YXJ0c1dpdGgiLCJyb2xlTmFtZXMiLCJnZXRVc2VyUm9sZXMiLCJyb2xlIiwiZ2V0U2Vzc2lvbkZyb21DbGllbnQiLCJ3YXRjaCIsImlzRGVlcFN0cmljdEVxdWFsIiwiZ2V0UHVibGljUmVhZEFjY2VzcyIsInN1YnNjcmlwdGlvblRva2VuIiwiY2xpZW50U2Vzc2lvblRva2VuIiwiX3ZhbGlkYXRlS2V5cyIsIl9oYXNNYXN0ZXJLZXkiLCJyYW5kb21VVUlEIiwicmVxIiwicHVzaENvbm5lY3QiLCJ2YWxpZEtleVBhaXJzIiwicHJvdG90eXBlIiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwiaXNWYWxpZCIsInNlY3JldCIsImF1dGhDYWxsZWQiLCJwYXJzZVF1ZXJ5Iiwid2l0aEpTT04iLCJ0b1BvaW50ZXIiLCJtYXN0ZXIiLCJhcHBDb25maWciLCJDb25maWciLCJyYyIsInJlcXVlc3RDb21wbGV4aXR5IiwicXVlcnlEZXB0aCIsIm1heERlcHRoIiwiY2hlY2tEZXB0aCIsImRlcHRoIiwiYWxsb3dSZWdleCIsImNoZWNrUmVnZXgiLCJzY2hlbWFDb250cm9sbGVyIiwiZGF0YWJhc2UiLCJsb2FkU2NoZW1hIiwiZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zIiwidXNlclJvbGVzIiwiY2hlY2tXaGVyZSIsIndoZXJlS2V5Iiwicm9vdEZpZWxkIiwic3BsaXQiLCJPUEVSQVRJT05fRk9SQklEREVOIiwid2F0Y2hGaWVsZCIsInN1YnNjcmlwdGlvbkhhc2giLCJxdWVyeUhhc2giLCJTdWJzY3JpcHRpb24iLCJhZGRTdWJzY3JpcHRpb25JbmZvIiwiYWRkQ2xpZW50U3Vic2NyaXB0aW9uIiwicHVzaFN1YnNjcmliZSIsIm5vdGlmeUNsaWVudCIsImRlbGV0ZVN1YnNjcmlwdGlvbkluZm8iLCJwdXNoVW5zdWJzY3JpYmUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL0xpdmVRdWVyeS9QYXJzZUxpdmVRdWVyeVNlcnZlci50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHY0IGZyb20gJ3R2NCc7XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgeyBTdWJzY3JpcHRpb24gfSBmcm9tICcuL1N1YnNjcmlwdGlvbic7XG5pbXBvcnQgeyBDbGllbnQgfSBmcm9tICcuL0NsaWVudCc7XG5pbXBvcnQgeyBQYXJzZVdlYlNvY2tldFNlcnZlciB9IGZyb20gJy4vUGFyc2VXZWJTb2NrZXRTZXJ2ZXInO1xuLy8gQHRzLWlnbm9yZVxuaW1wb3J0IGxvZ2dlciBmcm9tICcuLi9sb2dnZXInO1xuaW1wb3J0IFJlcXVlc3RTY2hlbWEgZnJvbSAnLi9SZXF1ZXN0U2NoZW1hJztcbmltcG9ydCB7IG1hdGNoZXNRdWVyeSwgcXVlcnlIYXNoIH0gZnJvbSAnLi9RdWVyeVRvb2xzJztcbmltcG9ydCB7IFBhcnNlUHViU3ViIH0gZnJvbSAnLi9QYXJzZVB1YlN1Yic7XG5pbXBvcnQgU2NoZW1hQ29udHJvbGxlciBmcm9tICcuLi9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyJztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7XG4gIHJ1bkxpdmVRdWVyeUV2ZW50SGFuZGxlcnMsXG4gIGdldFRyaWdnZXIsXG4gIHJ1blRyaWdnZXIsXG4gIHJlc29sdmVFcnJvcixcbiAgdG9KU09Od2l0aE9iamVjdHMsXG59IGZyb20gJy4uL3RyaWdnZXJzJztcbmltcG9ydCB7IGdldEF1dGhGb3JTZXNzaW9uVG9rZW4sIEF1dGggfSBmcm9tICcuLi9BdXRoJztcbmltcG9ydCB7IGdldENhY2hlQ29udHJvbGxlciwgZ2V0RGF0YWJhc2VDb250cm9sbGVyIH0gZnJvbSAnLi4vQ29udHJvbGxlcnMnO1xuaW1wb3J0IENvbmZpZyBmcm9tICcuLi9Db25maWcnO1xuaW1wb3J0IHsgTFJVQ2FjaGUgYXMgTFJVIH0gZnJvbSAnbHJ1LWNhY2hlJztcbmltcG9ydCBVc2VyUm91dGVyIGZyb20gJy4uL1JvdXRlcnMvVXNlcnNSb3V0ZXInO1xuaW1wb3J0IERhdGFiYXNlQ29udHJvbGxlciBmcm9tICcuLi9Db250cm9sbGVycy9EYXRhYmFzZUNvbnRyb2xsZXInO1xuaW1wb3J0IHsgaXNEZWVwU3RyaWN0RXF1YWwgfSBmcm9tICd1dGlsJztcblxuXG5jbGFzcyBQYXJzZUxpdmVRdWVyeVNlcnZlciB7XG4gIHNlcnZlcjogYW55O1xuICBjb25maWc6IGFueTtcbiAgY2xpZW50czogTWFwPHN0cmluZywgYW55PjtcbiAgLy8gY2xhc3NOYW1lIC0+IChxdWVyeUhhc2ggLT4gc3Vic2NyaXB0aW9uKVxuICBzdWJzY3JpcHRpb25zOiBNYXA8c3RyaW5nLCBhbnk+O1xuICBwYXJzZVdlYlNvY2tldFNlcnZlcjogYW55O1xuICBrZXlQYWlyczogYW55O1xuICAvLyBUaGUgc3Vic2NyaWJlciB3ZSB1c2UgdG8gZ2V0IG9iamVjdCB1cGRhdGUgZnJvbSBwdWJsaXNoZXJcbiAgc3Vic2NyaWJlcjogYW55O1xuICBhdXRoQ2FjaGU6IGFueTtcbiAgY2FjaGVDb250cm9sbGVyOiBhbnk7XG5cbiAgY29uc3RydWN0b3Ioc2VydmVyOiBhbnksIGNvbmZpZzogYW55ID0ge30sIHBhcnNlU2VydmVyQ29uZmlnOiBhbnkgPSB7fSkge1xuICAgIHRoaXMuc2VydmVyID0gc2VydmVyO1xuICAgIHRoaXMuY2xpZW50cyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLnN1YnNjcmlwdGlvbnMgPSBuZXcgTWFwKCk7XG4gICAgdGhpcy5jb25maWcgPSBjb25maWc7XG5cbiAgICBjb25maWcuYXBwSWQgPSBjb25maWcuYXBwSWQgfHwgUGFyc2UuYXBwbGljYXRpb25JZDtcbiAgICBjb25maWcubWFzdGVyS2V5ID0gY29uZmlnLm1hc3RlcktleSB8fCBQYXJzZS5tYXN0ZXJLZXk7XG5cbiAgICAvLyBTdG9yZSBrZXlzLCBjb252ZXJ0IG9iaiB0byBtYXBcbiAgICBjb25zdCBrZXlQYWlycyA9IGNvbmZpZy5rZXlQYWlycyB8fCB7fTtcbiAgICB0aGlzLmtleVBhaXJzID0gbmV3IE1hcCgpO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGtleVBhaXJzKSkge1xuICAgICAgdGhpcy5rZXlQYWlycy5zZXQoa2V5LCBrZXlQYWlyc1trZXldKTtcbiAgICB9XG4gICAgbG9nZ2VyLnZlcmJvc2UoJ1N1cHBvcnQga2V5IHBhaXJzJywgdGhpcy5rZXlQYWlycyk7XG5cbiAgICAvLyBJbml0aWFsaXplIFBhcnNlXG4gICAgUGFyc2UuT2JqZWN0LmRpc2FibGVTaW5nbGVJbnN0YW5jZSgpO1xuICAgIGNvbnN0IHNlcnZlclVSTCA9IGNvbmZpZy5zZXJ2ZXJVUkwgfHwgUGFyc2Uuc2VydmVyVVJMO1xuICAgIFBhcnNlLnNlcnZlclVSTCA9IHNlcnZlclVSTDtcbiAgICBQYXJzZS5pbml0aWFsaXplKGNvbmZpZy5hcHBJZCwgUGFyc2UuamF2YVNjcmlwdEtleSwgY29uZmlnLm1hc3RlcktleSk7XG5cbiAgICAvLyBUaGUgY2FjaGUgY29udHJvbGxlciBpcyBhIHByb3BlciBjYWNoZSBjb250cm9sbGVyXG4gICAgLy8gd2l0aCBhY2Nlc3MgdG8gVXNlciBhbmQgUm9sZXNcbiAgICB0aGlzLmNhY2hlQ29udHJvbGxlciA9IGdldENhY2hlQ29udHJvbGxlcihwYXJzZVNlcnZlckNvbmZpZyk7XG5cbiAgICBjb25maWcuY2FjaGVUaW1lb3V0ID0gY29uZmlnLmNhY2hlVGltZW91dCB8fCA1ICogMTAwMDsgLy8gNXNcblxuICAgIC8vIFRoaXMgYXV0aCBjYWNoZSBzdG9yZXMgdGhlIHByb21pc2VzIGZvciBlYWNoIGF1dGggcmVzb2x1dGlvbi5cbiAgICAvLyBUaGUgbWFpbiBiZW5lZml0IGlzIHRvIGJlIGFibGUgdG8gcmV1c2UgdGhlIHNhbWUgdXNlciAvIHNlc3Npb24gdG9rZW4gcmVzb2x1dGlvbi5cbiAgICB0aGlzLmF1dGhDYWNoZSA9IG5ldyBMUlUoe1xuICAgICAgbWF4OiA1MDAsIC8vIDUwMCBjb25jdXJyZW50XG4gICAgICB0dGw6IGNvbmZpZy5jYWNoZVRpbWVvdXQsXG4gICAgfSk7XG4gICAgLy8gSW5pdGlhbGl6ZSB3ZWJzb2NrZXQgc2VydmVyXG4gICAgdGhpcy5wYXJzZVdlYlNvY2tldFNlcnZlciA9IG5ldyBQYXJzZVdlYlNvY2tldFNlcnZlcihcbiAgICAgIHNlcnZlcixcbiAgICAgIHBhcnNlV2Vic29ja2V0ID0+IHRoaXMuX29uQ29ubmVjdChwYXJzZVdlYnNvY2tldCksXG4gICAgICBjb25maWdcbiAgICApO1xuICAgIHRoaXMuc3Vic2NyaWJlciA9IFBhcnNlUHViU3ViLmNyZWF0ZVN1YnNjcmliZXIoY29uZmlnKTtcbiAgICBpZiAoIXRoaXMuc3Vic2NyaWJlci5jb25uZWN0KSB7XG4gICAgICB0aGlzLmNvbm5lY3QoKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLnN1YnNjcmliZXIuaXNPcGVuKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0eXBlb2YgdGhpcy5zdWJzY3JpYmVyLmNvbm5lY3QgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGF3YWl0IFByb21pc2UucmVzb2x2ZSh0aGlzLnN1YnNjcmliZXIuY29ubmVjdCgpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zdWJzY3JpYmVyLmlzT3BlbiA9IHRydWU7XG4gICAgfVxuICAgIHRoaXMuX2NyZWF0ZVN1YnNjcmliZXJzKCk7XG4gIH1cblxuICBhc3luYyBzaHV0ZG93bigpIHtcbiAgICBpZiAodGhpcy5zdWJzY3JpYmVyLmlzT3Blbikge1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAuLi5bLi4udGhpcy5jbGllbnRzLnZhbHVlcygpXS5tYXAoY2xpZW50ID0+IGNsaWVudC5wYXJzZVdlYlNvY2tldC53cy5jbG9zZSgpKSxcbiAgICAgICAgdGhpcy5wYXJzZVdlYlNvY2tldFNlcnZlci5jbG9zZT8uKCksXG4gICAgICAgIC4uLkFycmF5LmZyb20odGhpcy5zdWJzY3JpYmVyLnN1YnNjcmlwdGlvbnM/LmtleXMoKSB8fCBbXSkubWFwKGtleSA9PlxuICAgICAgICAgIHRoaXMuc3Vic2NyaWJlci51bnN1YnNjcmliZShrZXkpXG4gICAgICAgICksXG4gICAgICAgIHRoaXMuc3Vic2NyaWJlci5jbG9zZT8uKCksXG4gICAgICBdKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB0aGlzLnN1YnNjcmliZXIuY2xvc2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3Vic2NyaWJlci5jbG9zZSgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcignUHViU3ViQWRhcHRlciBlcnJvciBvbiBzaHV0ZG93bicsIHsgZXJyb3I6IGVyciB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zdWJzY3JpYmVyLmlzT3BlbiA9IGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIF9jcmVhdGVTdWJzY3JpYmVycygpIHtcbiAgICBjb25zdCBtZXNzYWdlUmVjaWV2ZWQgPSAoY2hhbm5lbCwgbWVzc2FnZVN0cikgPT4ge1xuICAgICAgbG9nZ2VyLnZlcmJvc2UoJ1N1YnNjcmliZSBtZXNzYWdlICVqJywgbWVzc2FnZVN0cik7XG4gICAgICBsZXQgbWVzc2FnZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIG1lc3NhZ2UgPSBKU09OLnBhcnNlKG1lc3NhZ2VTdHIpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ3VuYWJsZSB0byBwYXJzZSBtZXNzYWdlJywgbWVzc2FnZVN0ciwgZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChjaGFubmVsID09PSBQYXJzZS5hcHBsaWNhdGlvbklkICsgJ2NsZWFyQ2FjaGUnKSB7XG4gICAgICAgIHRoaXMuX2NsZWFyQ2FjaGVkUm9sZXMobWVzc2FnZS51c2VySWQpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0aGlzLl9pbmZsYXRlUGFyc2VPYmplY3QobWVzc2FnZSk7XG4gICAgICBpZiAoY2hhbm5lbCA9PT0gUGFyc2UuYXBwbGljYXRpb25JZCArICdhZnRlclNhdmUnKSB7XG4gICAgICAgIHRoaXMuX29uQWZ0ZXJTYXZlKG1lc3NhZ2UpO1xuICAgICAgfSBlbHNlIGlmIChjaGFubmVsID09PSBQYXJzZS5hcHBsaWNhdGlvbklkICsgJ2FmdGVyRGVsZXRlJykge1xuICAgICAgICB0aGlzLl9vbkFmdGVyRGVsZXRlKG1lc3NhZ2UpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdHZXQgbWVzc2FnZSAlcyBmcm9tIHVua25vd24gY2hhbm5lbCAlaicsIG1lc3NhZ2UsIGNoYW5uZWwpO1xuICAgICAgfVxuICAgIH07XG4gICAgdGhpcy5zdWJzY3JpYmVyLm9uKCdtZXNzYWdlJywgKGNoYW5uZWwsIG1lc3NhZ2VTdHIpID0+IG1lc3NhZ2VSZWNpZXZlZChjaGFubmVsLCBtZXNzYWdlU3RyKSk7XG4gICAgZm9yIChjb25zdCBmaWVsZCBvZiBbJ2FmdGVyU2F2ZScsICdhZnRlckRlbGV0ZScsICdjbGVhckNhY2hlJ10pIHtcbiAgICAgIGNvbnN0IGNoYW5uZWwgPSBgJHtQYXJzZS5hcHBsaWNhdGlvbklkfSR7ZmllbGR9YDtcbiAgICAgIHRoaXMuc3Vic2NyaWJlci5zdWJzY3JpYmUoY2hhbm5lbCwgbWVzc2FnZVN0ciA9PiBtZXNzYWdlUmVjaWV2ZWQoY2hhbm5lbCwgbWVzc2FnZVN0cikpO1xuICAgIH1cbiAgfVxuXG4gIC8vIE1lc3NhZ2UgaXMgdGhlIEpTT04gb2JqZWN0IGZyb20gcHVibGlzaGVyLiBNZXNzYWdlLmN1cnJlbnRQYXJzZU9iamVjdCBpcyB0aGUgUGFyc2VPYmplY3QgSlNPTiBhZnRlciBjaGFuZ2VzLlxuICAvLyBNZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QgaXMgdGhlIG9yaWdpbmFsIFBhcnNlT2JqZWN0IEpTT04uXG4gIF9pbmZsYXRlUGFyc2VPYmplY3QobWVzc2FnZTogYW55KTogdm9pZCB7XG4gICAgLy8gSW5mbGF0ZSBtZXJnZWQgb2JqZWN0XG4gICAgY29uc3QgY3VycmVudFBhcnNlT2JqZWN0ID0gbWVzc2FnZS5jdXJyZW50UGFyc2VPYmplY3Q7XG4gICAgVXNlclJvdXRlci5yZW1vdmVIaWRkZW5Qcm9wZXJ0aWVzKGN1cnJlbnRQYXJzZU9iamVjdCk7XG4gICAgbGV0IGNsYXNzTmFtZSA9IGN1cnJlbnRQYXJzZU9iamVjdC5jbGFzc05hbWU7XG4gICAgbGV0IHBhcnNlT2JqZWN0ID0gbmV3IFBhcnNlLk9iamVjdChjbGFzc05hbWUpO1xuICAgIHBhcnNlT2JqZWN0Ll9maW5pc2hGZXRjaChjdXJyZW50UGFyc2VPYmplY3QpO1xuICAgIG1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0ID0gcGFyc2VPYmplY3Q7XG4gICAgLy8gSW5mbGF0ZSBvcmlnaW5hbCBvYmplY3RcbiAgICBjb25zdCBvcmlnaW5hbFBhcnNlT2JqZWN0ID0gbWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0O1xuICAgIGlmIChvcmlnaW5hbFBhcnNlT2JqZWN0KSB7XG4gICAgICBVc2VyUm91dGVyLnJlbW92ZUhpZGRlblByb3BlcnRpZXMob3JpZ2luYWxQYXJzZU9iamVjdCk7XG4gICAgICBjbGFzc05hbWUgPSBvcmlnaW5hbFBhcnNlT2JqZWN0LmNsYXNzTmFtZTtcbiAgICAgIHBhcnNlT2JqZWN0ID0gbmV3IFBhcnNlLk9iamVjdChjbGFzc05hbWUpO1xuICAgICAgcGFyc2VPYmplY3QuX2ZpbmlzaEZldGNoKG9yaWdpbmFsUGFyc2VPYmplY3QpO1xuICAgICAgbWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0ID0gcGFyc2VPYmplY3Q7XG4gICAgfVxuICB9XG5cbiAgLy8gTWVzc2FnZSBpcyB0aGUgSlNPTiBvYmplY3QgZnJvbSBwdWJsaXNoZXIgYWZ0ZXIgaW5mbGF0ZWQuIE1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0IGlzIHRoZSBQYXJzZU9iamVjdCBhZnRlciBjaGFuZ2VzLlxuICAvLyBNZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QgaXMgdGhlIG9yaWdpbmFsIFBhcnNlT2JqZWN0LlxuICBhc3luYyBfb25BZnRlckRlbGV0ZShtZXNzYWdlOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsb2dnZXIudmVyYm9zZShQYXJzZS5hcHBsaWNhdGlvbklkICsgJ2FmdGVyRGVsZXRlIGlzIHRyaWdnZXJlZCcpO1xuXG4gICAgbGV0IGRlbGV0ZWRQYXJzZU9iamVjdCA9IG1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0LnRvSlNPTigpO1xuICAgIGNvbnN0IGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyA9IG1lc3NhZ2UuY2xhc3NMZXZlbFBlcm1pc3Npb25zO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9IGRlbGV0ZWRQYXJzZU9iamVjdC5jbGFzc05hbWU7XG4gICAgbG9nZ2VyLnZlcmJvc2UoJ0NsYXNzTmFtZTogJWogfCBPYmplY3RJZDogJXMnLCBjbGFzc05hbWUsIGRlbGV0ZWRQYXJzZU9iamVjdC5pZCk7XG4gICAgbG9nZ2VyLnZlcmJvc2UoJ0N1cnJlbnQgY2xpZW50IG51bWJlciA6ICVkJywgdGhpcy5jbGllbnRzLnNpemUpO1xuXG4gICAgY29uc3QgY2xhc3NTdWJzY3JpcHRpb25zID0gdGhpcy5zdWJzY3JpcHRpb25zLmdldChjbGFzc05hbWUpO1xuICAgIGlmICh0eXBlb2YgY2xhc3NTdWJzY3JpcHRpb25zID09PSAndW5kZWZpbmVkJykge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdDYW4gbm90IGZpbmQgc3Vic2NyaXB0aW9ucyB1bmRlciB0aGlzIGNsYXNzICcgKyBjbGFzc05hbWUpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3Vic2NyaXB0aW9uIG9mIGNsYXNzU3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgICAgbGV0IGlzU3Vic2NyaXB0aW9uTWF0Y2hlZDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlzU3Vic2NyaXB0aW9uTWF0Y2hlZCA9IHRoaXMuX21hdGNoZXNTdWJzY3JpcHRpb24oZGVsZXRlZFBhcnNlT2JqZWN0LCBzdWJzY3JpcHRpb24pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCBtYXRjaGluZyBzdWJzY3JpcHRpb24gZm9yIGNsYXNzICR7Y2xhc3NOYW1lfTogJHtlLm1lc3NhZ2V9YCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFpc1N1YnNjcmlwdGlvbk1hdGNoZWQpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IFtjbGllbnRJZCwgcmVxdWVzdElkc10gb2YgXy5lbnRyaWVzKHN1YnNjcmlwdGlvbi5jbGllbnRSZXF1ZXN0SWRzKSkge1xuICAgICAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudHMuZ2V0KGNsaWVudElkKTtcbiAgICAgICAgaWYgKHR5cGVvZiBjbGllbnQgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgcmVxdWVzdElkcy5mb3JFYWNoKGFzeW5jIHJlcXVlc3RJZCA9PiB7XG4gICAgICAgICAgLy8gRGVlcC1jbG9uZSBzaGFyZWQgb2JqZWN0IHNvIGVhY2ggY29uY3VycmVudCBjYWxsYmFjayB3b3JrcyBvbiBpdHMgb3duIGNvcHlcbiAgICAgICAgICBsZXQgbG9jYWxEZWxldGVkUGFyc2VPYmplY3QgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGRlbGV0ZWRQYXJzZU9iamVjdCkpO1xuICAgICAgICAgIGNvbnN0IGFjbCA9IG1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0LmdldEFDTCgpO1xuICAgICAgICAgIC8vIENoZWNrIENMUFxuICAgICAgICAgIGNvbnN0IG9wID0gdGhpcy5fZ2V0Q0xQT3BlcmF0aW9uKHN1YnNjcmlwdGlvbi5xdWVyeSk7XG4gICAgICAgICAgbGV0IHJlczogYW55ID0ge307XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoZXNDTFAgPSBhd2FpdCB0aGlzLl9tYXRjaGVzQ0xQKFxuICAgICAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgICAgICAgIG1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0LFxuICAgICAgICAgICAgICBjbGllbnQsXG4gICAgICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICAgICAgb3BcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAobWF0Y2hlc0NMUCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBpc01hdGNoZWQgPSBhd2FpdCB0aGlzLl9tYXRjaGVzQUNMKGFjbCwgY2xpZW50LCByZXF1ZXN0SWQpO1xuICAgICAgICAgICAgaWYgKCFpc01hdGNoZWQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXMgPSB7XG4gICAgICAgICAgICAgIGV2ZW50OiAnZGVsZXRlJyxcbiAgICAgICAgICAgICAgc2Vzc2lvblRva2VuOiBjbGllbnQuc2Vzc2lvblRva2VuLFxuICAgICAgICAgICAgICBvYmplY3Q6IGxvY2FsRGVsZXRlZFBhcnNlT2JqZWN0LFxuICAgICAgICAgICAgICBjbGllbnRzOiB0aGlzLmNsaWVudHMuc2l6ZSxcbiAgICAgICAgICAgICAgc3Vic2NyaXB0aW9uczogdGhpcy5zdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgICAgICAgIHVzZU1hc3RlcktleTogY2xpZW50Lmhhc01hc3RlcktleSxcbiAgICAgICAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IGNsaWVudC5pbnN0YWxsYXRpb25JZCxcbiAgICAgICAgICAgICAgc2VuZEV2ZW50OiB0cnVlLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNvbnN0IHRyaWdnZXIgPSBnZXRUcmlnZ2VyKGNsYXNzTmFtZSwgJ2FmdGVyRXZlbnQnLCBQYXJzZS5hcHBsaWNhdGlvbklkKTtcbiAgICAgICAgICAgIGlmICh0cmlnZ2VyKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGF1dGggPSBhd2FpdCB0aGlzLmdldEF1dGhGcm9tQ2xpZW50KGNsaWVudCwgcmVxdWVzdElkKTtcbiAgICAgICAgICAgICAgaWYgKGF1dGggJiYgYXV0aC51c2VyKSB7XG4gICAgICAgICAgICAgICAgcmVzLnVzZXIgPSBhdXRoLnVzZXI7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKHJlcy5vYmplY3QpIHtcbiAgICAgICAgICAgICAgICByZXMub2JqZWN0ID0gUGFyc2UuT2JqZWN0LmZyb21KU09OKHJlcy5vYmplY3QpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGF3YWl0IHJ1blRyaWdnZXIodHJpZ2dlciwgYGFmdGVyRXZlbnQuJHtjbGFzc05hbWV9YCwgcmVzLCBhdXRoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghcmVzLnNlbmRFdmVudCkge1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVzLm9iamVjdCAmJiB0eXBlb2YgcmVzLm9iamVjdC50b0pTT04gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgbG9jYWxEZWxldGVkUGFyc2VPYmplY3QgPSB0b0pTT053aXRoT2JqZWN0cyhyZXMub2JqZWN0LCByZXMub2JqZWN0LmNsYXNzTmFtZSB8fCBjbGFzc05hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzLm9iamVjdCA9IGxvY2FsRGVsZXRlZFBhcnNlT2JqZWN0O1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5fZmlsdGVyU2Vuc2l0aXZlRGF0YShcbiAgICAgICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgICAgICAgICAgICByZXMsXG4gICAgICAgICAgICAgIGNsaWVudCxcbiAgICAgICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgICAgICBvcCxcbiAgICAgICAgICAgICAgc3Vic2NyaXB0aW9uLnF1ZXJ5XG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgY2xpZW50LnB1c2hEZWxldGUocmVxdWVzdElkLCByZXMub2JqZWN0KTtcbiAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBjb25zdCBlcnJvciA9IHJlc29sdmVFcnJvcihlKTtcbiAgICAgICAgICAgIENsaWVudC5wdXNoRXJyb3IoY2xpZW50LnBhcnNlV2ViU29ja2V0LCBlcnJvci5jb2RlLCBlcnJvci5tZXNzYWdlLCBmYWxzZSwgcmVxdWVzdElkKTtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcihcbiAgICAgICAgICAgICAgYEZhaWxlZCBydW5uaW5nIGFmdGVyTGl2ZVF1ZXJ5RXZlbnQgb24gY2xhc3MgJHtjbGFzc05hbWV9IGZvciBldmVudCAke3Jlcy5ldmVudH0gd2l0aCBzZXNzaW9uICR7cmVzLnNlc3Npb25Ub2tlbn0gd2l0aDpcXG4gRXJyb3I6IGAgK1xuICAgICAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGVycm9yKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIE1lc3NhZ2UgaXMgdGhlIEpTT04gb2JqZWN0IGZyb20gcHVibGlzaGVyIGFmdGVyIGluZmxhdGVkLiBNZXNzYWdlLmN1cnJlbnRQYXJzZU9iamVjdCBpcyB0aGUgUGFyc2VPYmplY3QgYWZ0ZXIgY2hhbmdlcy5cbiAgLy8gTWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0IGlzIHRoZSBvcmlnaW5hbCBQYXJzZU9iamVjdC5cbiAgYXN5bmMgX29uQWZ0ZXJTYXZlKG1lc3NhZ2U6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxvZ2dlci52ZXJib3NlKFBhcnNlLmFwcGxpY2F0aW9uSWQgKyAnYWZ0ZXJTYXZlIGlzIHRyaWdnZXJlZCcpO1xuXG4gICAgbGV0IG9yaWdpbmFsUGFyc2VPYmplY3QgPSBudWxsO1xuICAgIGlmIChtZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QpIHtcbiAgICAgIG9yaWdpbmFsUGFyc2VPYmplY3QgPSBtZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QudG9KU09OKCk7XG4gICAgfVxuICAgIGNvbnN0IGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyA9IG1lc3NhZ2UuY2xhc3NMZXZlbFBlcm1pc3Npb25zO1xuICAgIGxldCBjdXJyZW50UGFyc2VPYmplY3QgPSBtZXNzYWdlLmN1cnJlbnRQYXJzZU9iamVjdC50b0pTT04oKTtcbiAgICBjb25zdCBjbGFzc05hbWUgPSBjdXJyZW50UGFyc2VPYmplY3QuY2xhc3NOYW1lO1xuICAgIGxvZ2dlci52ZXJib3NlKCdDbGFzc05hbWU6ICVzIHwgT2JqZWN0SWQ6ICVzJywgY2xhc3NOYW1lLCBjdXJyZW50UGFyc2VPYmplY3QuaWQpO1xuICAgIGxvZ2dlci52ZXJib3NlKCdDdXJyZW50IGNsaWVudCBudW1iZXIgOiAlZCcsIHRoaXMuY2xpZW50cy5zaXplKTtcblxuICAgIGNvbnN0IGNsYXNzU3Vic2NyaXB0aW9ucyA9IHRoaXMuc3Vic2NyaXB0aW9ucy5nZXQoY2xhc3NOYW1lKTtcbiAgICBpZiAodHlwZW9mIGNsYXNzU3Vic2NyaXB0aW9ucyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnQ2FuIG5vdCBmaW5kIHN1YnNjcmlwdGlvbnMgdW5kZXIgdGhpcyBjbGFzcyAnICsgY2xhc3NOYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb24gb2YgY2xhc3NTdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgICBsZXQgaXNPcmlnaW5hbFN1YnNjcmlwdGlvbk1hdGNoZWQ7XG4gICAgICBsZXQgaXNDdXJyZW50U3Vic2NyaXB0aW9uTWF0Y2hlZDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlzT3JpZ2luYWxTdWJzY3JpcHRpb25NYXRjaGVkID0gdGhpcy5fbWF0Y2hlc1N1YnNjcmlwdGlvbihcbiAgICAgICAgICBvcmlnaW5hbFBhcnNlT2JqZWN0LFxuICAgICAgICAgIHN1YnNjcmlwdGlvblxuICAgICAgICApO1xuICAgICAgICBpc0N1cnJlbnRTdWJzY3JpcHRpb25NYXRjaGVkID0gdGhpcy5fbWF0Y2hlc1N1YnNjcmlwdGlvbihcbiAgICAgICAgICBjdXJyZW50UGFyc2VPYmplY3QsXG4gICAgICAgICAgc3Vic2NyaXB0aW9uXG4gICAgICAgICk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIG1hdGNoaW5nIHN1YnNjcmlwdGlvbiBmb3IgY2xhc3MgJHtjbGFzc05hbWV9OiAke2UubWVzc2FnZX1gKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IFtjbGllbnRJZCwgcmVxdWVzdElkc10gb2YgXy5lbnRyaWVzKHN1YnNjcmlwdGlvbi5jbGllbnRSZXF1ZXN0SWRzKSkge1xuICAgICAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudHMuZ2V0KGNsaWVudElkKTtcbiAgICAgICAgaWYgKHR5cGVvZiBjbGllbnQgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgcmVxdWVzdElkcy5mb3JFYWNoKGFzeW5jIHJlcXVlc3RJZCA9PiB7XG4gICAgICAgICAgLy8gRGVlcC1jbG9uZSBzaGFyZWQgb2JqZWN0cyBzbyBlYWNoIGNvbmN1cnJlbnQgY2FsbGJhY2sgd29ya3Mgb24gaXRzIG93biBjb3B5LlxuICAgICAgICAgIC8vIFdpdGhvdXQgY2xvbmluZywgX2ZpbHRlclNlbnNpdGl2ZURhdGEncyBpbi1wbGFjZSBmaWVsZCBkZWxldGlvbiBhbmQgYWZ0ZXJFdmVudFxuICAgICAgICAgIC8vIHRyaWdnZXIgbW9kaWZpY2F0aW9ucyBjb3JydXB0IHRoZSBzaGFyZWQgc3RhdGUgYWNyb3NzIGNvbmN1cnJlbnQgc3Vic2NyaWJlcnMuXG4gICAgICAgICAgbGV0IGxvY2FsQ3VycmVudFBhcnNlT2JqZWN0ID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShjdXJyZW50UGFyc2VPYmplY3QpKTtcbiAgICAgICAgICBsZXQgbG9jYWxPcmlnaW5hbFBhcnNlT2JqZWN0ID0gb3JpZ2luYWxQYXJzZU9iamVjdFxuICAgICAgICAgICAgPyBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9yaWdpbmFsUGFyc2VPYmplY3QpKVxuICAgICAgICAgICAgOiBudWxsO1xuICAgICAgICAgIC8vIFNldCBvcmlnbmFsIFBhcnNlT2JqZWN0IEFDTCBjaGVja2luZyBwcm9taXNlLCBpZiB0aGUgb2JqZWN0IGRvZXMgbm90IG1hdGNoXG4gICAgICAgICAgLy8gc3Vic2NyaXB0aW9uLCB3ZSBkbyBub3QgbmVlZCB0byBjaGVjayBBQ0xcbiAgICAgICAgICBsZXQgb3JpZ2luYWxBQ0xDaGVja2luZ1Byb21pc2U7XG4gICAgICAgICAgaWYgKCFpc09yaWdpbmFsU3Vic2NyaXB0aW9uTWF0Y2hlZCkge1xuICAgICAgICAgICAgb3JpZ2luYWxBQ0xDaGVja2luZ1Byb21pc2UgPSBQcm9taXNlLnJlc29sdmUoZmFsc2UpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsZXQgb3JpZ2luYWxBQ0w7XG4gICAgICAgICAgICBpZiAobWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0KSB7XG4gICAgICAgICAgICAgIG9yaWdpbmFsQUNMID0gbWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0LmdldEFDTCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgb3JpZ2luYWxBQ0xDaGVja2luZ1Byb21pc2UgPSB0aGlzLl9tYXRjaGVzQUNMKG9yaWdpbmFsQUNMLCBjbGllbnQsIHJlcXVlc3RJZCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFNldCBjdXJyZW50IFBhcnNlT2JqZWN0IEFDTCBjaGVja2luZyBwcm9taXNlLCBpZiB0aGUgb2JqZWN0IGRvZXMgbm90IG1hdGNoXG4gICAgICAgICAgLy8gc3Vic2NyaXB0aW9uLCB3ZSBkbyBub3QgbmVlZCB0byBjaGVjayBBQ0xcbiAgICAgICAgICBsZXQgY3VycmVudEFDTENoZWNraW5nUHJvbWlzZTtcbiAgICAgICAgICBsZXQgcmVzOiBhbnkgPSB7fTtcbiAgICAgICAgICBpZiAoIWlzQ3VycmVudFN1YnNjcmlwdGlvbk1hdGNoZWQpIHtcbiAgICAgICAgICAgIGN1cnJlbnRBQ0xDaGVja2luZ1Byb21pc2UgPSBQcm9taXNlLnJlc29sdmUoZmFsc2UpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW50QUNMID0gbWVzc2FnZS5jdXJyZW50UGFyc2VPYmplY3QuZ2V0QUNMKCk7XG4gICAgICAgICAgICBjdXJyZW50QUNMQ2hlY2tpbmdQcm9taXNlID0gdGhpcy5fbWF0Y2hlc0FDTChjdXJyZW50QUNMLCBjbGllbnQsIHJlcXVlc3RJZCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvcCA9IHRoaXMuX2dldENMUE9wZXJhdGlvbihzdWJzY3JpcHRpb24ucXVlcnkpO1xuICAgICAgICAgICAgY29uc3QgbWF0Y2hlc0NMUCA9IGF3YWl0IHRoaXMuX21hdGNoZXNDTFAoXG4gICAgICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICAgICAgbWVzc2FnZS5jdXJyZW50UGFyc2VPYmplY3QsXG4gICAgICAgICAgICAgIGNsaWVudCxcbiAgICAgICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgICAgICBvcFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChtYXRjaGVzQ0xQID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBbaXNPcmlnaW5hbE1hdGNoZWQsIGlzQ3VycmVudE1hdGNoZWRdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgICBvcmlnaW5hbEFDTENoZWNraW5nUHJvbWlzZSxcbiAgICAgICAgICAgICAgY3VycmVudEFDTENoZWNraW5nUHJvbWlzZSxcbiAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgbG9nZ2VyLnZlcmJvc2UoXG4gICAgICAgICAgICAgICdPcmlnaW5hbCAlaiB8IEN1cnJlbnQgJWogfCBNYXRjaDogJXMsICVzLCAlcywgJXMgfCBRdWVyeTogJXMnLFxuICAgICAgICAgICAgICBsb2NhbE9yaWdpbmFsUGFyc2VPYmplY3QsXG4gICAgICAgICAgICAgIGxvY2FsQ3VycmVudFBhcnNlT2JqZWN0LFxuICAgICAgICAgICAgICBpc09yaWdpbmFsU3Vic2NyaXB0aW9uTWF0Y2hlZCxcbiAgICAgICAgICAgICAgaXNDdXJyZW50U3Vic2NyaXB0aW9uTWF0Y2hlZCxcbiAgICAgICAgICAgICAgaXNPcmlnaW5hbE1hdGNoZWQsXG4gICAgICAgICAgICAgIGlzQ3VycmVudE1hdGNoZWQsXG4gICAgICAgICAgICAgIHN1YnNjcmlwdGlvbi5oYXNoXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgLy8gRGVjaWRlIGV2ZW50IHR5cGVcbiAgICAgICAgICAgIGxldCB0eXBlO1xuICAgICAgICAgICAgaWYgKGlzT3JpZ2luYWxNYXRjaGVkICYmIGlzQ3VycmVudE1hdGNoZWQpIHtcbiAgICAgICAgICAgICAgdHlwZSA9ICd1cGRhdGUnO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpc09yaWdpbmFsTWF0Y2hlZCAmJiAhaXNDdXJyZW50TWF0Y2hlZCkge1xuICAgICAgICAgICAgICB0eXBlID0gJ2xlYXZlJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoIWlzT3JpZ2luYWxNYXRjaGVkICYmIGlzQ3VycmVudE1hdGNoZWQpIHtcbiAgICAgICAgICAgICAgaWYgKGxvY2FsT3JpZ2luYWxQYXJzZU9iamVjdCkge1xuICAgICAgICAgICAgICAgIHR5cGUgPSAnZW50ZXInO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHR5cGUgPSAnY3JlYXRlJztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCB3YXRjaEZpZWxkc0NoYW5nZWQgPSB0aGlzLl9jaGVja1dhdGNoRmllbGRzKGNsaWVudCwgcmVxdWVzdElkLCBtZXNzYWdlKTtcbiAgICAgICAgICAgIGlmICghd2F0Y2hGaWVsZHNDaGFuZ2VkICYmICh0eXBlID09PSAndXBkYXRlJyB8fCB0eXBlID09PSAnY3JlYXRlJykpIHtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzID0ge1xuICAgICAgICAgICAgICBldmVudDogdHlwZSxcbiAgICAgICAgICAgICAgc2Vzc2lvblRva2VuOiBjbGllbnQuc2Vzc2lvblRva2VuLFxuICAgICAgICAgICAgICBvYmplY3Q6IGxvY2FsQ3VycmVudFBhcnNlT2JqZWN0LFxuICAgICAgICAgICAgICBvcmlnaW5hbDogbG9jYWxPcmlnaW5hbFBhcnNlT2JqZWN0LFxuICAgICAgICAgICAgICBjbGllbnRzOiB0aGlzLmNsaWVudHMuc2l6ZSxcbiAgICAgICAgICAgICAgc3Vic2NyaXB0aW9uczogdGhpcy5zdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgICAgICAgIHVzZU1hc3RlcktleTogY2xpZW50Lmhhc01hc3RlcktleSxcbiAgICAgICAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IGNsaWVudC5pbnN0YWxsYXRpb25JZCxcbiAgICAgICAgICAgICAgc2VuZEV2ZW50OiB0cnVlLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNvbnN0IHRyaWdnZXIgPSBnZXRUcmlnZ2VyKGNsYXNzTmFtZSwgJ2FmdGVyRXZlbnQnLCBQYXJzZS5hcHBsaWNhdGlvbklkKTtcbiAgICAgICAgICAgIGlmICh0cmlnZ2VyKSB7XG4gICAgICAgICAgICAgIGlmIChyZXMub2JqZWN0KSB7XG4gICAgICAgICAgICAgICAgcmVzLm9iamVjdCA9IFBhcnNlLk9iamVjdC5mcm9tSlNPTihyZXMub2JqZWN0KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAocmVzLm9yaWdpbmFsKSB7XG4gICAgICAgICAgICAgICAgcmVzLm9yaWdpbmFsID0gUGFyc2UuT2JqZWN0LmZyb21KU09OKHJlcy5vcmlnaW5hbCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY29uc3QgYXV0aCA9IGF3YWl0IHRoaXMuZ2V0QXV0aEZyb21DbGllbnQoY2xpZW50LCByZXF1ZXN0SWQpO1xuICAgICAgICAgICAgICBpZiAoYXV0aCAmJiBhdXRoLnVzZXIpIHtcbiAgICAgICAgICAgICAgICByZXMudXNlciA9IGF1dGgudXNlcjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBhd2FpdCBydW5UcmlnZ2VyKHRyaWdnZXIsIGBhZnRlckV2ZW50LiR7Y2xhc3NOYW1lfWAsIHJlcywgYXV0aCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXJlcy5zZW5kRXZlbnQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlcy5vYmplY3QgJiYgdHlwZW9mIHJlcy5vYmplY3QudG9KU09OID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgIGxvY2FsQ3VycmVudFBhcnNlT2JqZWN0ID0gdG9KU09Od2l0aE9iamVjdHMocmVzLm9iamVjdCwgcmVzLm9iamVjdC5jbGFzc05hbWUgfHwgY2xhc3NOYW1lKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXMub3JpZ2luYWwgJiYgdHlwZW9mIHJlcy5vcmlnaW5hbC50b0pTT04gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgbG9jYWxPcmlnaW5hbFBhcnNlT2JqZWN0ID0gdG9KU09Od2l0aE9iamVjdHMoXG4gICAgICAgICAgICAgICAgcmVzLm9yaWdpbmFsLFxuICAgICAgICAgICAgICAgIHJlcy5vcmlnaW5hbC5jbGFzc05hbWUgfHwgY2xhc3NOYW1lXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXMub2JqZWN0ID0gbG9jYWxDdXJyZW50UGFyc2VPYmplY3Q7XG4gICAgICAgICAgICByZXMub3JpZ2luYWwgPSBsb2NhbE9yaWdpbmFsUGFyc2VPYmplY3Q7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9maWx0ZXJTZW5zaXRpdmVEYXRhKFxuICAgICAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgICAgICAgIHJlcyxcbiAgICAgICAgICAgICAgY2xpZW50LFxuICAgICAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgICAgIG9wLFxuICAgICAgICAgICAgICBzdWJzY3JpcHRpb24ucXVlcnlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25zdCBmdW5jdGlvbk5hbWUgPSAncHVzaCcgKyByZXMuZXZlbnQuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyByZXMuZXZlbnQuc2xpY2UoMSk7XG4gICAgICAgICAgICBpZiAoY2xpZW50W2Z1bmN0aW9uTmFtZV0pIHtcbiAgICAgICAgICAgICAgY2xpZW50W2Z1bmN0aW9uTmFtZV0ocmVxdWVzdElkLCByZXMub2JqZWN0LCByZXMub3JpZ2luYWwgPz8gbnVsbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgY29uc3QgZXJyb3IgPSByZXNvbHZlRXJyb3IoZSk7XG4gICAgICAgICAgICBDbGllbnQucHVzaEVycm9yKGNsaWVudC5wYXJzZVdlYlNvY2tldCwgZXJyb3IuY29kZSwgZXJyb3IubWVzc2FnZSwgZmFsc2UsIHJlcXVlc3RJZCk7XG4gICAgICAgICAgICBsb2dnZXIuZXJyb3IoXG4gICAgICAgICAgICAgIGBGYWlsZWQgcnVubmluZyBhZnRlckxpdmVRdWVyeUV2ZW50IG9uIGNsYXNzICR7Y2xhc3NOYW1lfSBmb3IgZXZlbnQgJHtyZXMuZXZlbnR9IHdpdGggc2Vzc2lvbiAke3Jlcy5zZXNzaW9uVG9rZW59IHdpdGg6XFxuIEVycm9yOiBgICtcbiAgICAgICAgICAgICAgICBKU09OLnN0cmluZ2lmeShlcnJvcilcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBfb25Db25uZWN0KHBhcnNlV2Vic29ja2V0OiBhbnkpOiB2b2lkIHtcbiAgICBwYXJzZVdlYnNvY2tldC5vbignbWVzc2FnZScsIHJlcXVlc3QgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByZXF1ZXN0ID09PSAnc3RyaW5nJykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJlcXVlc3QgPSBKU09OLnBhcnNlKHJlcXVlc3QpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKCd1bmFibGUgdG8gcGFyc2UgcmVxdWVzdCcsIHJlcXVlc3QsIGUpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbG9nZ2VyLnZlcmJvc2UoJ1JlcXVlc3Q6ICVqJywgcmVxdWVzdCk7XG5cbiAgICAgIC8vIENoZWNrIHdoZXRoZXIgdGhpcyByZXF1ZXN0IGlzIGEgdmFsaWQgcmVxdWVzdCwgcmV0dXJuIGVycm9yIGRpcmVjdGx5IGlmIG5vdFxuICAgICAgaWYgKFxuICAgICAgICAhdHY0LnZhbGlkYXRlKHJlcXVlc3QsIFJlcXVlc3RTY2hlbWFbJ2dlbmVyYWwnXSkgfHxcbiAgICAgICAgIXR2NC52YWxpZGF0ZShyZXF1ZXN0LCBSZXF1ZXN0U2NoZW1hW3JlcXVlc3Qub3BdKVxuICAgICAgKSB7XG4gICAgICAgIENsaWVudC5wdXNoRXJyb3IocGFyc2VXZWJzb2NrZXQsIDEsIHR2NC5lcnJvci5tZXNzYWdlKTtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdDb25uZWN0IG1lc3NhZ2UgZXJyb3IgJXMnLCB0djQuZXJyb3IubWVzc2FnZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgc3dpdGNoIChyZXF1ZXN0Lm9wKSB7XG4gICAgICAgIGNhc2UgJ2Nvbm5lY3QnOlxuICAgICAgICAgIHRoaXMuX2hhbmRsZUNvbm5lY3QocGFyc2VXZWJzb2NrZXQsIHJlcXVlc3QpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdzdWJzY3JpYmUnOlxuICAgICAgICAgIHRoaXMuX2hhbmRsZVN1YnNjcmliZShwYXJzZVdlYnNvY2tldCwgcmVxdWVzdCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICAgICAgdGhpcy5faGFuZGxlVXBkYXRlU3Vic2NyaXB0aW9uKHBhcnNlV2Vic29ja2V0LCByZXF1ZXN0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAndW5zdWJzY3JpYmUnOlxuICAgICAgICAgIHRoaXMuX2hhbmRsZVVuc3Vic2NyaWJlKHBhcnNlV2Vic29ja2V0LCByZXF1ZXN0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICBDbGllbnQucHVzaEVycm9yKHBhcnNlV2Vic29ja2V0LCAzLCAnR2V0IHVua25vd24gb3BlcmF0aW9uJyk7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKCdHZXQgdW5rbm93biBvcGVyYXRpb24nLCByZXF1ZXN0Lm9wKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHBhcnNlV2Vic29ja2V0Lm9uKCdkaXNjb25uZWN0JywgKCkgPT4ge1xuICAgICAgbG9nZ2VyLmluZm8oYENsaWVudCBkaXNjb25uZWN0OiAke3BhcnNlV2Vic29ja2V0LmNsaWVudElkfWApO1xuICAgICAgY29uc3QgY2xpZW50SWQgPSBwYXJzZVdlYnNvY2tldC5jbGllbnRJZDtcbiAgICAgIGlmICghdGhpcy5jbGllbnRzLmhhcyhjbGllbnRJZCkpIHtcbiAgICAgICAgcnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyh7XG4gICAgICAgICAgZXZlbnQ6ICd3c19kaXNjb25uZWN0X2Vycm9yJyxcbiAgICAgICAgICBjbGllbnRzOiB0aGlzLmNsaWVudHMuc2l6ZSxcbiAgICAgICAgICBzdWJzY3JpcHRpb25zOiB0aGlzLnN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgICAgICBlcnJvcjogYFVuYWJsZSB0byBmaW5kIGNsaWVudCAke2NsaWVudElkfWAsXG4gICAgICAgIH0pO1xuICAgICAgICBsb2dnZXIuZXJyb3IoYENhbiBub3QgZmluZCBjbGllbnQgJHtjbGllbnRJZH0gb24gZGlzY29ubmVjdGApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIERlbGV0ZSBjbGllbnRcbiAgICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50cy5nZXQoY2xpZW50SWQpO1xuICAgICAgdGhpcy5jbGllbnRzLmRlbGV0ZShjbGllbnRJZCk7XG5cbiAgICAgIC8vIERlbGV0ZSBjbGllbnQgZnJvbSBzdWJzY3JpcHRpb25zXG4gICAgICBmb3IgKGNvbnN0IFtyZXF1ZXN0SWQsIHN1YnNjcmlwdGlvbkluZm9dIG9mIF8uZW50cmllcyhjbGllbnQuc3Vic2NyaXB0aW9uSW5mb3MpKSB7XG4gICAgICAgIGNvbnN0IHN1YnNjcmlwdGlvbiA9IHN1YnNjcmlwdGlvbkluZm8uc3Vic2NyaXB0aW9uO1xuICAgICAgICBzdWJzY3JpcHRpb24uZGVsZXRlQ2xpZW50U3Vic2NyaXB0aW9uKGNsaWVudElkLCByZXF1ZXN0SWQpO1xuXG4gICAgICAgIC8vIElmIHRoZXJlIGlzIG5vIGNsaWVudCB3aGljaCBpcyBzdWJzY3JpYmluZyB0aGlzIHN1YnNjcmlwdGlvbiwgcmVtb3ZlIGl0IGZyb20gc3Vic2NyaXB0aW9uc1xuICAgICAgICBjb25zdCBjbGFzc1N1YnNjcmlwdGlvbnMgPSB0aGlzLnN1YnNjcmlwdGlvbnMuZ2V0KHN1YnNjcmlwdGlvbi5jbGFzc05hbWUpO1xuICAgICAgICBpZiAoIXN1YnNjcmlwdGlvbi5oYXNTdWJzY3JpYmluZ0NsaWVudCgpKSB7XG4gICAgICAgICAgY2xhc3NTdWJzY3JpcHRpb25zLmRlbGV0ZShzdWJzY3JpcHRpb24uaGFzaCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gSWYgdGhlcmUgaXMgbm8gc3Vic2NyaXB0aW9ucyB1bmRlciB0aGlzIGNsYXNzLCByZW1vdmUgaXQgZnJvbSBzdWJzY3JpcHRpb25zXG4gICAgICAgIGlmIChjbGFzc1N1YnNjcmlwdGlvbnMuc2l6ZSA9PT0gMCkge1xuICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5kZWxldGUoc3Vic2NyaXB0aW9uLmNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbG9nZ2VyLnZlcmJvc2UoJ0N1cnJlbnQgY2xpZW50cyAlZCcsIHRoaXMuY2xpZW50cy5zaXplKTtcbiAgICAgIGxvZ2dlci52ZXJib3NlKCdDdXJyZW50IHN1YnNjcmlwdGlvbnMgJWQnLCB0aGlzLnN1YnNjcmlwdGlvbnMuc2l6ZSk7XG4gICAgICBydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzKHtcbiAgICAgICAgZXZlbnQ6ICd3c19kaXNjb25uZWN0JyxcbiAgICAgICAgY2xpZW50czogdGhpcy5jbGllbnRzLnNpemUsXG4gICAgICAgIHN1YnNjcmlwdGlvbnM6IHRoaXMuc3Vic2NyaXB0aW9ucy5zaXplLFxuICAgICAgICB1c2VNYXN0ZXJLZXk6IGNsaWVudC5oYXNNYXN0ZXJLZXksXG4gICAgICAgIGluc3RhbGxhdGlvbklkOiBjbGllbnQuaW5zdGFsbGF0aW9uSWQsXG4gICAgICAgIHNlc3Npb25Ub2tlbjogY2xpZW50LnNlc3Npb25Ub2tlbixcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgcnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyh7XG4gICAgICBldmVudDogJ3dzX2Nvbm5lY3QnLFxuICAgICAgY2xpZW50czogdGhpcy5jbGllbnRzLnNpemUsXG4gICAgICBzdWJzY3JpcHRpb25zOiB0aGlzLnN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICB9KTtcbiAgfVxuXG4gIF92YWxpZGF0ZVF1ZXJ5Q29uc3RyYWludHMod2hlcmU6IGFueSk6IHZvaWQge1xuICAgIGlmICh0eXBlb2Ygd2hlcmUgIT09ICdvYmplY3QnIHx8IHdoZXJlID09PSBudWxsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAoY29uc3Qgb3Agb2YgWyckb3InLCAnJGFuZCcsICckbm9yJ10pIHtcbiAgICAgIGlmICh3aGVyZVtvcF0gIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheSh3aGVyZVtvcF0pKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBgJHtvcH0gbXVzdCBiZSBhbiBhcnJheWApO1xuICAgICAgfVxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkod2hlcmVbb3BdKSkge1xuICAgICAgICB3aGVyZVtvcF0uZm9yRWFjaCgoc3ViUXVlcnk6IGFueSkgPT4ge1xuICAgICAgICAgIHRoaXMuX3ZhbGlkYXRlUXVlcnlDb25zdHJhaW50cyhzdWJRdWVyeSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyh3aGVyZSkpIHtcbiAgICAgIGNvbnN0IGNvbnN0cmFpbnQgPSB3aGVyZVtrZXldO1xuICAgICAgaWYgKHR5cGVvZiBjb25zdHJhaW50ID09PSAnb2JqZWN0JyAmJiBjb25zdHJhaW50ICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChjb25zdHJhaW50LiRyZWdleCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY29uc3QgcmVnZXggPSBjb25zdHJhaW50LiRyZWdleDtcbiAgICAgICAgICBjb25zdCBpc1JlZ0V4cExpa2UgPVxuICAgICAgICAgICAgcmVnZXggIT09IG51bGwgJiZcbiAgICAgICAgICAgIHR5cGVvZiByZWdleCA9PT0gJ29iamVjdCcgJiZcbiAgICAgICAgICAgIHR5cGVvZiByZWdleC5zb3VyY2UgPT09ICdzdHJpbmcnICYmXG4gICAgICAgICAgICB0eXBlb2YgcmVnZXguZmxhZ3MgPT09ICdzdHJpbmcnO1xuICAgICAgICAgIGlmICh0eXBlb2YgcmVnZXggIT09ICdzdHJpbmcnICYmICFpc1JlZ0V4cExpa2UpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgICAgICAgJ0ludmFsaWQgcmVndWxhciBleHByZXNzaW9uOiAkcmVnZXggbXVzdCBiZSBhIHN0cmluZyBvciBSZWdFeHAnXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBwYXR0ZXJuID0gaXNSZWdFeHBMaWtlID8gcmVnZXguc291cmNlIDogcmVnZXg7XG4gICAgICAgICAgY29uc3QgZmxhZ3MgPSBpc1JlZ0V4cExpa2UgPyByZWdleC5mbGFncyA6IGNvbnN0cmFpbnQuJG9wdGlvbnMgfHwgJyc7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIG5ldyBSZWdFeHAocGF0dGVybiwgZmxhZ3MpO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgICAgICAgYEludmFsaWQgcmVndWxhciBleHByZXNzaW9uOiAke2UubWVzc2FnZX1gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIF9tYXRjaGVzU3Vic2NyaXB0aW9uKHBhcnNlT2JqZWN0OiBhbnksIHN1YnNjcmlwdGlvbjogYW55KTogYm9vbGVhbiB7XG4gICAgLy8gT2JqZWN0IGlzIHVuZGVmaW5lZCBvciBudWxsLCBub3QgbWF0Y2hcbiAgICBpZiAoIXBhcnNlT2JqZWN0KSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiBtYXRjaGVzUXVlcnkoc3RydWN0dXJlZENsb25lKHBhcnNlT2JqZWN0KSwgc3Vic2NyaXB0aW9uLnF1ZXJ5KTtcbiAgfVxuXG4gIGFzeW5jIF9jbGVhckNhY2hlZFJvbGVzKHVzZXJJZDogc3RyaW5nKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHZhbGlkVG9rZW5zID0gYXdhaXQgbmV3IFBhcnNlLlF1ZXJ5KFBhcnNlLlNlc3Npb24pXG4gICAgICAgIC5lcXVhbFRvKCd1c2VyJywgUGFyc2UuVXNlci5jcmVhdGVXaXRob3V0RGF0YSh1c2VySWQpKVxuICAgICAgICAuZmluZCh7IHVzZU1hc3RlcktleTogdHJ1ZSB9KTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICB2YWxpZFRva2Vucy5tYXAoYXN5bmMgdG9rZW4gPT4ge1xuICAgICAgICAgIGNvbnN0IHNlc3Npb25Ub2tlbiA9IHRva2VuLmdldCgnc2Vzc2lvblRva2VuJyk7XG4gICAgICAgICAgY29uc3QgYXV0aFByb21pc2UgPSB0aGlzLmF1dGhDYWNoZS5nZXQoc2Vzc2lvblRva2VuKTtcbiAgICAgICAgICBpZiAoIWF1dGhQcm9taXNlKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IFthdXRoMSwgYXV0aDJdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgYXV0aFByb21pc2UsXG4gICAgICAgICAgICBnZXRBdXRoRm9yU2Vzc2lvblRva2VuKHsgY2FjaGVDb250cm9sbGVyOiB0aGlzLmNhY2hlQ29udHJvbGxlciwgc2Vzc2lvblRva2VuIH0pLFxuICAgICAgICAgIF0pO1xuICAgICAgICAgIGF1dGgxLmF1dGg/LmNsZWFyUm9sZUNhY2hlKHNlc3Npb25Ub2tlbik7XG4gICAgICAgICAgYXV0aDIuYXV0aD8uY2xlYXJSb2xlQ2FjaGUoc2Vzc2lvblRva2VuKTtcbiAgICAgICAgICB0aGlzLmF1dGhDYWNoZS5kZWxldGUoc2Vzc2lvblRva2VuKTtcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgbG9nZ2VyLnZlcmJvc2UoYENvdWxkIG5vdCBjbGVhciByb2xlIGNhY2hlLiAke2V9YCk7XG4gICAgfVxuICB9XG5cbiAgZ2V0QXV0aEZvclNlc3Npb25Ub2tlbihzZXNzaW9uVG9rZW4/OiBzdHJpbmcpOiBQcm9taXNlPHsgYXV0aD86IEF1dGgsIHVzZXJJZD86IHN0cmluZyB9PiB7XG4gICAgaWYgKCFzZXNzaW9uVG9rZW4pIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe30pO1xuICAgIH1cbiAgICBjb25zdCBmcm9tQ2FjaGUgPSB0aGlzLmF1dGhDYWNoZS5nZXQoc2Vzc2lvblRva2VuKTtcbiAgICBpZiAoZnJvbUNhY2hlKSB7XG4gICAgICByZXR1cm4gZnJvbUNhY2hlO1xuICAgIH1cbiAgICBjb25zdCBhdXRoUHJvbWlzZSA9IGdldEF1dGhGb3JTZXNzaW9uVG9rZW4oe1xuICAgICAgY2FjaGVDb250cm9sbGVyOiB0aGlzLmNhY2hlQ29udHJvbGxlcixcbiAgICAgIHNlc3Npb25Ub2tlbjogc2Vzc2lvblRva2VuLFxuICAgIH0pXG4gICAgICAudGhlbihhdXRoID0+IHtcbiAgICAgICAgcmV0dXJuIHsgYXV0aCwgdXNlcklkOiBhdXRoICYmIGF1dGgudXNlciAmJiBhdXRoLnVzZXIuaWQgfTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAvLyBUaGVyZSB3YXMgYW4gZXJyb3Igd2l0aCB0aGUgc2Vzc2lvbiB0b2tlblxuICAgICAgICBjb25zdCByZXN1bHQ6IGFueSA9IHt9O1xuICAgICAgICBpZiAoZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gUGFyc2UuRXJyb3IuSU5WQUxJRF9TRVNTSU9OX1RPS0VOKSB7XG4gICAgICAgICAgcmVzdWx0LmVycm9yID0gZXJyb3I7XG4gICAgICAgICAgdGhpcy5hdXRoQ2FjaGUuc2V0KHNlc3Npb25Ub2tlbiwgUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCksIHRoaXMuY29uZmlnLmNhY2hlVGltZW91dCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5hdXRoQ2FjaGUuZGVsZXRlKHNlc3Npb25Ub2tlbik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0pO1xuICAgIHRoaXMuYXV0aENhY2hlLnNldChzZXNzaW9uVG9rZW4sIGF1dGhQcm9taXNlKTtcbiAgICByZXR1cm4gYXV0aFByb21pc2U7XG4gIH1cblxuICBhc3luYyBfbWF0Y2hlc0NMUChcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM/OiBhbnksXG4gICAgb2JqZWN0PzogYW55LFxuICAgIGNsaWVudD86IGFueSxcbiAgICByZXF1ZXN0SWQ/OiBudW1iZXIsXG4gICAgb3A/OiBzdHJpbmdcbiAgKTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCBzdWJzY3JpcHRpb25JbmZvID0gY2xpZW50LmdldFN1YnNjcmlwdGlvbkluZm8ocmVxdWVzdElkKTtcbiAgICBjb25zdCBhY2xHcm91cCA9IFsnKiddO1xuICAgIGxldCB1c2VySWQ7XG4gICAgaWYgKHR5cGVvZiBzdWJzY3JpcHRpb25JbmZvICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5nZXRBdXRoRm9yU2Vzc2lvblRva2VuKHN1YnNjcmlwdGlvbkluZm8uc2Vzc2lvblRva2VuKTtcbiAgICAgIHVzZXJJZCA9IHJlc3VsdC51c2VySWQ7XG4gICAgICBpZiAodXNlcklkKSB7XG4gICAgICAgIGFjbEdyb3VwLnB1c2godXNlcklkKTtcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgU2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oXG4gICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICBvYmplY3QuY2xhc3NOYW1lLFxuICAgICAgYWNsR3JvdXAsXG4gICAgICBvcFxuICAgICk7XG4gICAgLy8gRW5mb3JjZSBwb2ludGVyIHBlcm1pc3Npb25zIHRoYXQgdmFsaWRhdGVQZXJtaXNzaW9uIGRlZmVycy5cbiAgICAvLyBSZXR1cm5zIGZhbHNlIHRvIHNpbGVudGx5IHNraXAgdGhlIGV2ZW50IChsaWtlIEFDTCksIHJhdGhlciB0aGFuXG4gICAgLy8gdGhyb3dpbmcgd2hpY2ggd291bGQgcHVzaCBlcnJvcnMgdG8gdGhlIGNsaWVudCBhbmQgbG9nIG5vaXNlLlxuICAgIGlmICghY2xpZW50Lmhhc01hc3RlcktleSAmJiBjbGFzc0xldmVsUGVybWlzc2lvbnMpIHtcbiAgICAgIGNvbnN0IHBlcm1pc3Npb25GaWVsZCA9XG4gICAgICAgIFsnZ2V0JywgJ2ZpbmQnLCAnY291bnQnXS5pbmRleE9mKG9wKSA+IC0xID8gJ3JlYWRVc2VyRmllbGRzJyA6ICd3cml0ZVVzZXJGaWVsZHMnO1xuICAgICAgY29uc3QgcG9pbnRlckZpZWxkcyA9IFtdO1xuICAgICAgaWYgKGNsYXNzTGV2ZWxQZXJtaXNzaW9uc1tvcF0/LnBvaW50ZXJGaWVsZHMpIHtcbiAgICAgICAgcG9pbnRlckZpZWxkcy5wdXNoKC4uLmNsYXNzTGV2ZWxQZXJtaXNzaW9uc1tvcF0ucG9pbnRlckZpZWxkcyk7XG4gICAgICB9XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShjbGFzc0xldmVsUGVybWlzc2lvbnNbcGVybWlzc2lvbkZpZWxkXSkpIHtcbiAgICAgICAgZm9yIChjb25zdCBmaWVsZCBvZiBjbGFzc0xldmVsUGVybWlzc2lvbnNbcGVybWlzc2lvbkZpZWxkXSkge1xuICAgICAgICAgIGlmICghcG9pbnRlckZpZWxkcy5pbmNsdWRlcyhmaWVsZCkpIHtcbiAgICAgICAgICAgIHBvaW50ZXJGaWVsZHMucHVzaChmaWVsZCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocG9pbnRlckZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIElmIHB1YmxpYyBvciB1c2VyLXNwZWNpZmljIHBlcm1pc3Npb24gYWxyZWFkeSBncmFudHMgYWNjZXNzLCBza2lwIHBvaW50ZXIgY2hlY2tcbiAgICAgICAgaWYgKFxuICAgICAgICAgICFTY2hlbWFDb250cm9sbGVyLnRlc3RQZXJtaXNzaW9ucyhjbGFzc0xldmVsUGVybWlzc2lvbnMsIGFjbEdyb3VwLCBvcClcbiAgICAgICAgKSB7XG4gICAgICAgICAgaWYgKCF1c2VySWQpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gQ2hlY2sgaWYgYW55IHBvaW50ZXIgZmllbGQgcG9pbnRzIHRvIHRoZSBjdXJyZW50IHVzZXJcbiAgICAgICAgICBjb25zdCBoYXNBY2Nlc3MgPSBwb2ludGVyRmllbGRzLnNvbWUoZmllbGQgPT4ge1xuICAgICAgICAgICAgY29uc3QgdmFsdWUgPVxuICAgICAgICAgICAgICB0eXBlb2Ygb2JqZWN0LmdldCA9PT0gJ2Z1bmN0aW9uJyA/IG9iamVjdC5nZXQoZmllbGQpIDogb2JqZWN0W2ZpZWxkXTtcbiAgICAgICAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gSGFuZGxlIFBhcnNlLk9iamVjdCBwb2ludGVyIChoYXMgLmlkKVxuICAgICAgICAgICAgaWYgKHZhbHVlLmlkKSB7XG4gICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5pZCA9PT0gdXNlcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gSGFuZGxlIHJhdyBwb2ludGVyIEpTT04gKGhhcyAub2JqZWN0SWQpXG4gICAgICAgICAgICBpZiAodmFsdWUub2JqZWN0SWQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLm9iamVjdElkID09PSB1c2VySWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBIYW5kbGUgYXJyYXkgb2YgcG9pbnRlcnNcbiAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuc29tZShpdGVtID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoaXRlbS5pZCkge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIGl0ZW0uaWQgPT09IHVzZXJJZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGl0ZW0ub2JqZWN0SWQpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBpdGVtLm9iamVjdElkID09PSB1c2VySWQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKCFoYXNBY2Nlc3MpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc3luYyBfZmlsdGVyU2Vuc2l0aXZlRGF0YShcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM/OiBhbnksXG4gICAgcmVzPzogYW55LFxuICAgIGNsaWVudD86IGFueSxcbiAgICByZXF1ZXN0SWQ/OiBudW1iZXIsXG4gICAgb3A/OiBzdHJpbmcsXG4gICAgcXVlcnk/OiBhbnlcbiAgKSB7XG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uSW5mbyA9IGNsaWVudC5nZXRTdWJzY3JpcHRpb25JbmZvKHJlcXVlc3RJZCk7XG4gICAgY29uc3QgYWNsR3JvdXAgPSBbJyonXTtcbiAgICBsZXQgY2xpZW50QXV0aDtcbiAgICBpZiAodHlwZW9mIHN1YnNjcmlwdGlvbkluZm8gIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBjb25zdCB7IHVzZXJJZCwgYXV0aCB9ID0gYXdhaXQgdGhpcy5nZXRBdXRoRm9yU2Vzc2lvblRva2VuKHN1YnNjcmlwdGlvbkluZm8uc2Vzc2lvblRva2VuKTtcbiAgICAgIGlmICh1c2VySWQpIHtcbiAgICAgICAgYWNsR3JvdXAucHVzaCh1c2VySWQpO1xuICAgICAgfVxuICAgICAgY2xpZW50QXV0aCA9IGF1dGg7XG4gICAgfVxuICAgIGNvbnN0IGZpbHRlciA9IG9iaiA9PiB7XG4gICAgICBpZiAoIW9iaikge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBsZXQgcHJvdGVjdGVkRmllbGRzID0gY2xhc3NMZXZlbFBlcm1pc3Npb25zPy5wcm90ZWN0ZWRGaWVsZHMgfHwgW107XG4gICAgICBpZiAoY2xpZW50Lmhhc01hc3RlcktleSkge1xuICAgICAgICBwcm90ZWN0ZWRGaWVsZHMgPSBbXTtcbiAgICAgIH0gZWxzZSBpZiAoIUFycmF5LmlzQXJyYXkocHJvdGVjdGVkRmllbGRzKSkge1xuICAgICAgICBwcm90ZWN0ZWRGaWVsZHMgPSBnZXREYXRhYmFzZUNvbnRyb2xsZXIodGhpcy5jb25maWcpLmFkZFByb3RlY3RlZEZpZWxkcyhcbiAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgICAgcmVzLm9iamVjdC5jbGFzc05hbWUsXG4gICAgICAgICAgcXVlcnksXG4gICAgICAgICAgYWNsR3JvdXAsXG4gICAgICAgICAgY2xpZW50QXV0aFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIERhdGFiYXNlQ29udHJvbGxlci5maWx0ZXJTZW5zaXRpdmVEYXRhKFxuICAgICAgICBjbGllbnQuaGFzTWFzdGVyS2V5LFxuICAgICAgICBmYWxzZSxcbiAgICAgICAgYWNsR3JvdXAsXG4gICAgICAgIGNsaWVudEF1dGgsXG4gICAgICAgIG9wLFxuICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgIHJlcy5vYmplY3QuY2xhc3NOYW1lLFxuICAgICAgICBwcm90ZWN0ZWRGaWVsZHMsXG4gICAgICAgIG9iaixcbiAgICAgICAgdGhpcy5jb25maWcucHJvdGVjdGVkRmllbGRzT3duZXJFeGVtcHRcbiAgICAgICk7XG4gICAgfTtcbiAgICByZXMub2JqZWN0ID0gZmlsdGVyKHJlcy5vYmplY3QpO1xuICAgIHJlcy5vcmlnaW5hbCA9IGZpbHRlcihyZXMub3JpZ2luYWwpO1xuICB9XG5cbiAgX2dldENMUE9wZXJhdGlvbihxdWVyeTogYW55KSB7XG4gICAgcmV0dXJuIHR5cGVvZiBxdWVyeSA9PT0gJ29iamVjdCcgJiZcbiAgICAgIE9iamVjdC5rZXlzKHF1ZXJ5KS5sZW5ndGggPT0gMSAmJlxuICAgICAgdHlwZW9mIHF1ZXJ5Lm9iamVjdElkID09PSAnc3RyaW5nJ1xuICAgICAgPyAnZ2V0J1xuICAgICAgOiAnZmluZCc7XG4gIH1cblxuICBhc3luYyBfdmVyaWZ5QUNMKGFjbDogYW55LCB0b2tlbjogc3RyaW5nKSB7XG4gICAgaWYgKCF0b2tlbikge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGNvbnN0IHsgYXV0aCwgdXNlcklkIH0gPSBhd2FpdCB0aGlzLmdldEF1dGhGb3JTZXNzaW9uVG9rZW4odG9rZW4pO1xuXG4gICAgLy8gR2V0dGluZyB0aGUgc2Vzc2lvbiB0b2tlbiBmYWlsZWRcbiAgICAvLyBUaGlzIG1lYW5zIHRoYXQgbm8gYWRkaXRpb25hbCBhdXRoIGlzIGF2YWlsYWJsZVxuICAgIC8vIEF0IHRoaXMgcG9pbnQsIGp1c3QgYmFpbCBvdXQgYXMgbm8gYWRkaXRpb25hbCB2aXNpYmlsaXR5IGNhbiBiZSBpbmZlcnJlZC5cbiAgICBpZiAoIWF1dGggfHwgIXVzZXJJZCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBjb25zdCBpc1N1YnNjcmlwdGlvblNlc3Npb25Ub2tlbk1hdGNoZWQgPSBhY2wuZ2V0UmVhZEFjY2Vzcyh1c2VySWQpO1xuICAgIGlmIChpc1N1YnNjcmlwdGlvblNlc3Npb25Ub2tlbk1hdGNoZWQpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIENoZWNrIGlmIHRoZSB1c2VyIGhhcyBhbnkgcm9sZXMgdGhhdCBtYXRjaCB0aGUgQUNMXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIFJlc29sdmUgZmFsc2UgcmlnaHQgYXdheSBpZiB0aGUgYWNsIGRvZXNuJ3QgaGF2ZSBhbnkgcm9sZXNcbiAgICAgICAgY29uc3QgYWNsX2hhc19yb2xlcyA9IE9iamVjdC5rZXlzKGFjbC5wZXJtaXNzaW9uc0J5SWQpLnNvbWUoa2V5ID0+IGtleS5zdGFydHNXaXRoKCdyb2xlOicpKTtcbiAgICAgICAgaWYgKCFhY2xfaGFzX3JvbGVzKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJvbGVOYW1lcyA9IGF3YWl0IGF1dGguZ2V0VXNlclJvbGVzKCk7XG4gICAgICAgIC8vIEZpbmFsbHksIHNlZSBpZiBhbnkgb2YgdGhlIHVzZXIncyByb2xlcyBhbGxvdyB0aGVtIHJlYWQgYWNjZXNzXG4gICAgICAgIGZvciAoY29uc3Qgcm9sZSBvZiByb2xlTmFtZXMpIHtcbiAgICAgICAgICAvLyBXZSB1c2UgZ2V0UmVhZEFjY2VzcyBhcyBgcm9sZWAgaXMgaW4gdGhlIGZvcm0gYHJvbGU6cm9sZU5hbWVgXG4gICAgICAgICAgaWYgKGFjbC5nZXRSZWFkQWNjZXNzKHJvbGUpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgZ2V0QXV0aEZyb21DbGllbnQoY2xpZW50OiBhbnksIHJlcXVlc3RJZDogbnVtYmVyLCBzZXNzaW9uVG9rZW4/OiBzdHJpbmcpIHtcbiAgICBjb25zdCBnZXRTZXNzaW9uRnJvbUNsaWVudCA9ICgpID0+IHtcbiAgICAgIGNvbnN0IHN1YnNjcmlwdGlvbkluZm8gPSBjbGllbnQuZ2V0U3Vic2NyaXB0aW9uSW5mbyhyZXF1ZXN0SWQpO1xuICAgICAgaWYgKHR5cGVvZiBzdWJzY3JpcHRpb25JbmZvID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICByZXR1cm4gY2xpZW50LnNlc3Npb25Ub2tlbjtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzdWJzY3JpcHRpb25JbmZvLnNlc3Npb25Ub2tlbiB8fCBjbGllbnQuc2Vzc2lvblRva2VuO1xuICAgIH07XG4gICAgaWYgKCFzZXNzaW9uVG9rZW4pIHtcbiAgICAgIHNlc3Npb25Ub2tlbiA9IGdldFNlc3Npb25Gcm9tQ2xpZW50KCk7XG4gICAgfVxuICAgIGlmICghc2Vzc2lvblRva2VuKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHsgYXV0aCB9ID0gYXdhaXQgdGhpcy5nZXRBdXRoRm9yU2Vzc2lvblRva2VuKHNlc3Npb25Ub2tlbik7XG4gICAgcmV0dXJuIGF1dGg7XG4gIH1cblxuICBfY2hlY2tXYXRjaEZpZWxkcyhjbGllbnQ6IGFueSwgcmVxdWVzdElkOiBhbnksIG1lc3NhZ2U6IGFueSkge1xuICAgIGNvbnN0IHN1YnNjcmlwdGlvbkluZm8gPSBjbGllbnQuZ2V0U3Vic2NyaXB0aW9uSW5mbyhyZXF1ZXN0SWQpO1xuICAgIGNvbnN0IHdhdGNoID0gc3Vic2NyaXB0aW9uSW5mbz8ud2F0Y2g7XG4gICAgaWYgKCF3YXRjaCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGNvbnN0IG9iamVjdCA9IG1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0O1xuICAgIGNvbnN0IG9yaWdpbmFsID0gbWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0O1xuICAgIHJldHVybiB3YXRjaC5zb21lKGZpZWxkID0+ICFpc0RlZXBTdHJpY3RFcXVhbChvYmplY3QuZ2V0KGZpZWxkKSwgb3JpZ2luYWw/LmdldChmaWVsZCkpKTtcbiAgfVxuXG4gIGFzeW5jIF9tYXRjaGVzQUNMKGFjbDogYW55LCBjbGllbnQ6IGFueSwgcmVxdWVzdElkOiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAvLyBSZXR1cm4gdHJ1ZSBkaXJlY3RseSBpZiBBQ0wgaXNuJ3QgcHJlc2VudCwgQUNMIGlzIHB1YmxpYyByZWFkLCBvciBjbGllbnQgaGFzIG1hc3RlciBrZXlcbiAgICBpZiAoIWFjbCB8fCBhY2wuZ2V0UHVibGljUmVhZEFjY2VzcygpIHx8IGNsaWVudC5oYXNNYXN0ZXJLZXkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICAvLyBDaGVjayBzdWJzY3JpcHRpb24gc2Vzc2lvblRva2VuIG1hdGNoZXMgQUNMIGZpcnN0XG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uSW5mbyA9IGNsaWVudC5nZXRTdWJzY3JpcHRpb25JbmZvKHJlcXVlc3RJZCk7XG4gICAgaWYgKHR5cGVvZiBzdWJzY3JpcHRpb25JbmZvID09PSAndW5kZWZpbmVkJykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGNvbnN0IHN1YnNjcmlwdGlvblRva2VuID0gc3Vic2NyaXB0aW9uSW5mby5zZXNzaW9uVG9rZW47XG4gICAgY29uc3QgY2xpZW50U2Vzc2lvblRva2VuID0gY2xpZW50LnNlc3Npb25Ub2tlbjtcblxuICAgIGlmIChhd2FpdCB0aGlzLl92ZXJpZnlBQ0woYWNsLCBzdWJzY3JpcHRpb25Ub2tlbikpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGlmIChhd2FpdCB0aGlzLl92ZXJpZnlBQ0woYWNsLCBjbGllbnRTZXNzaW9uVG9rZW4pKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBfaGFuZGxlQ29ubmVjdChwYXJzZVdlYnNvY2tldDogYW55LCByZXF1ZXN0OiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICAgIGlmICghdGhpcy5fdmFsaWRhdGVLZXlzKHJlcXVlc3QsIHRoaXMua2V5UGFpcnMpKSB7XG4gICAgICBDbGllbnQucHVzaEVycm9yKHBhcnNlV2Vic29ja2V0LCA0LCAnS2V5IGluIHJlcXVlc3QgaXMgbm90IHZhbGlkJyk7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0tleSBpbiByZXF1ZXN0IGlzIG5vdCB2YWxpZCcpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBoYXNNYXN0ZXJLZXkgPSB0aGlzLl9oYXNNYXN0ZXJLZXkocmVxdWVzdCwgdGhpcy5rZXlQYWlycyk7XG4gICAgY29uc3QgY2xpZW50SWQgPSByYW5kb21VVUlEKCk7XG4gICAgY29uc3QgY2xpZW50ID0gbmV3IENsaWVudChcbiAgICAgIGNsaWVudElkLFxuICAgICAgcGFyc2VXZWJzb2NrZXQsXG4gICAgICBoYXNNYXN0ZXJLZXksXG4gICAgICByZXF1ZXN0LnNlc3Npb25Ub2tlbixcbiAgICAgIHJlcXVlc3QuaW5zdGFsbGF0aW9uSWRcbiAgICApO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXEgPSB7XG4gICAgICAgIGNsaWVudCxcbiAgICAgICAgZXZlbnQ6ICdjb25uZWN0JyxcbiAgICAgICAgY2xpZW50czogdGhpcy5jbGllbnRzLnNpemUsXG4gICAgICAgIHN1YnNjcmlwdGlvbnM6IHRoaXMuc3Vic2NyaXB0aW9ucy5zaXplLFxuICAgICAgICBzZXNzaW9uVG9rZW46IHJlcXVlc3Quc2Vzc2lvblRva2VuLFxuICAgICAgICB1c2VNYXN0ZXJLZXk6IGNsaWVudC5oYXNNYXN0ZXJLZXksXG4gICAgICAgIGluc3RhbGxhdGlvbklkOiByZXF1ZXN0Lmluc3RhbGxhdGlvbklkLFxuICAgICAgICB1c2VyOiB1bmRlZmluZWQsXG4gICAgICB9O1xuICAgICAgY29uc3QgdHJpZ2dlciA9IGdldFRyaWdnZXIoJ0BDb25uZWN0JywgJ2JlZm9yZUNvbm5lY3QnLCBQYXJzZS5hcHBsaWNhdGlvbklkKTtcbiAgICAgIGlmICh0cmlnZ2VyKSB7XG4gICAgICAgIGNvbnN0IGF1dGggPSBhd2FpdCB0aGlzLmdldEF1dGhGcm9tQ2xpZW50KGNsaWVudCwgcmVxdWVzdC5yZXF1ZXN0SWQsIHJlcS5zZXNzaW9uVG9rZW4pO1xuICAgICAgICBpZiAoYXV0aCAmJiBhdXRoLnVzZXIpIHtcbiAgICAgICAgICByZXEudXNlciA9IGF1dGgudXNlcjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBydW5UcmlnZ2VyKHRyaWdnZXIsIGBiZWZvcmVDb25uZWN0LkBDb25uZWN0YCwgcmVxLCBhdXRoKTtcbiAgICAgIH1cbiAgICAgIHBhcnNlV2Vic29ja2V0LmNsaWVudElkID0gY2xpZW50SWQ7XG4gICAgICB0aGlzLmNsaWVudHMuc2V0KHBhcnNlV2Vic29ja2V0LmNsaWVudElkLCBjbGllbnQpO1xuICAgICAgbG9nZ2VyLmluZm8oYENyZWF0ZSBuZXcgY2xpZW50OiAke3BhcnNlV2Vic29ja2V0LmNsaWVudElkfWApO1xuICAgICAgY2xpZW50LnB1c2hDb25uZWN0KCk7XG4gICAgICBydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzKHJlcSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc3QgZXJyb3IgPSByZXNvbHZlRXJyb3IoZSk7XG4gICAgICBDbGllbnQucHVzaEVycm9yKHBhcnNlV2Vic29ja2V0LCBlcnJvci5jb2RlLCBlcnJvci5tZXNzYWdlLCBmYWxzZSk7XG4gICAgICBsb2dnZXIuZXJyb3IoXG4gICAgICAgIGBGYWlsZWQgcnVubmluZyBiZWZvcmVDb25uZWN0IGZvciBzZXNzaW9uICR7cmVxdWVzdC5zZXNzaW9uVG9rZW59IHdpdGg6XFxuIEVycm9yOiBgICtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShlcnJvcilcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgX2hhc01hc3RlcktleShyZXF1ZXN0OiBhbnksIHZhbGlkS2V5UGFpcnM6IGFueSk6IGJvb2xlYW4ge1xuICAgIGlmICghdmFsaWRLZXlQYWlycyB8fCB2YWxpZEtleVBhaXJzLnNpemUgPT0gMCB8fCAhdmFsaWRLZXlQYWlycy5oYXMoJ21hc3RlcktleScpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmICghcmVxdWVzdCB8fCAhT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHJlcXVlc3QsICdtYXN0ZXJLZXknKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gcmVxdWVzdC5tYXN0ZXJLZXkgPT09IHZhbGlkS2V5UGFpcnMuZ2V0KCdtYXN0ZXJLZXknKTtcbiAgfVxuXG4gIF92YWxpZGF0ZUtleXMocmVxdWVzdDogYW55LCB2YWxpZEtleVBhaXJzOiBhbnkpOiBib29sZWFuIHtcbiAgICBpZiAoIXZhbGlkS2V5UGFpcnMgfHwgdmFsaWRLZXlQYWlycy5zaXplID09IDApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBsZXQgaXNWYWxpZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgW2tleSwgc2VjcmV0XSBvZiB2YWxpZEtleVBhaXJzKSB7XG4gICAgICBpZiAoIXJlcXVlc3Rba2V5XSB8fCByZXF1ZXN0W2tleV0gIT09IHNlY3JldCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlzVmFsaWQgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHJldHVybiBpc1ZhbGlkO1xuICB9XG5cbiAgYXN5bmMgX2hhbmRsZVN1YnNjcmliZShwYXJzZVdlYnNvY2tldDogYW55LCByZXF1ZXN0OiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICAgIC8vIElmIHdlIGNhbiBub3QgZmluZCB0aGlzIGNsaWVudCwgcmV0dXJuIGVycm9yIHRvIGNsaWVudFxuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHBhcnNlV2Vic29ja2V0LCAnY2xpZW50SWQnKSkge1xuICAgICAgQ2xpZW50LnB1c2hFcnJvcihcbiAgICAgICAgcGFyc2VXZWJzb2NrZXQsXG4gICAgICAgIDIsXG4gICAgICAgICdDYW4gbm90IGZpbmQgdGhpcyBjbGllbnQsIG1ha2Ugc3VyZSB5b3UgY29ubmVjdCB0byBzZXJ2ZXIgYmVmb3JlIHN1YnNjcmliaW5nJ1xuICAgICAgKTtcbiAgICAgIGxvZ2dlci5lcnJvcignQ2FuIG5vdCBmaW5kIHRoaXMgY2xpZW50LCBtYWtlIHN1cmUgeW91IGNvbm5lY3QgdG8gc2VydmVyIGJlZm9yZSBzdWJzY3JpYmluZycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudHMuZ2V0KHBhcnNlV2Vic29ja2V0LmNsaWVudElkKTtcbiAgICBjb25zdCBjbGFzc05hbWUgPSByZXF1ZXN0LnF1ZXJ5LmNsYXNzTmFtZTtcbiAgICBsZXQgYXV0aENhbGxlZCA9IGZhbHNlO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB0cmlnZ2VyID0gZ2V0VHJpZ2dlcihjbGFzc05hbWUsICdiZWZvcmVTdWJzY3JpYmUnLCBQYXJzZS5hcHBsaWNhdGlvbklkKTtcbiAgICAgIGlmICh0cmlnZ2VyKSB7XG4gICAgICAgIGNvbnN0IGF1dGggPSBhd2FpdCB0aGlzLmdldEF1dGhGcm9tQ2xpZW50KGNsaWVudCwgcmVxdWVzdC5yZXF1ZXN0SWQsIHJlcXVlc3Quc2Vzc2lvblRva2VuKTtcbiAgICAgICAgYXV0aENhbGxlZCA9IHRydWU7XG4gICAgICAgIGlmIChhdXRoICYmIGF1dGgudXNlcikge1xuICAgICAgICAgIHJlcXVlc3QudXNlciA9IGF1dGgudXNlcjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHBhcnNlUXVlcnkgPSBuZXcgUGFyc2UuUXVlcnkoY2xhc3NOYW1lKTtcbiAgICAgICAgcGFyc2VRdWVyeS53aXRoSlNPTihyZXF1ZXN0LnF1ZXJ5KTtcbiAgICAgICAgcmVxdWVzdC5xdWVyeSA9IHBhcnNlUXVlcnk7XG4gICAgICAgIGF3YWl0IHJ1blRyaWdnZXIodHJpZ2dlciwgYGJlZm9yZVN1YnNjcmliZS4ke2NsYXNzTmFtZX1gLCByZXF1ZXN0LCBhdXRoKTtcblxuICAgICAgICBjb25zdCBxdWVyeSA9IHJlcXVlc3QucXVlcnkudG9KU09OKCk7XG4gICAgICAgIHJlcXVlc3QucXVlcnkgPSBxdWVyeTtcbiAgICAgIH1cblxuICAgICAgaWYgKGNsYXNzTmFtZSA9PT0gJ19TZXNzaW9uJykge1xuICAgICAgICBpZiAoIWF1dGhDYWxsZWQpIHtcbiAgICAgICAgICBjb25zdCBhdXRoID0gYXdhaXQgdGhpcy5nZXRBdXRoRnJvbUNsaWVudChcbiAgICAgICAgICAgIGNsaWVudCxcbiAgICAgICAgICAgIHJlcXVlc3QucmVxdWVzdElkLFxuICAgICAgICAgICAgcmVxdWVzdC5zZXNzaW9uVG9rZW5cbiAgICAgICAgICApO1xuICAgICAgICAgIGlmIChhdXRoICYmIGF1dGgudXNlcikge1xuICAgICAgICAgICAgcmVxdWVzdC51c2VyID0gYXV0aC51c2VyO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAocmVxdWVzdC51c2VyKSB7XG4gICAgICAgICAgcmVxdWVzdC5xdWVyeS53aGVyZS51c2VyID0gcmVxdWVzdC51c2VyLnRvUG9pbnRlcigpO1xuICAgICAgICB9IGVsc2UgaWYgKCFyZXF1ZXN0Lm1hc3Rlcikge1xuICAgICAgICAgIENsaWVudC5wdXNoRXJyb3IoXG4gICAgICAgICAgICBwYXJzZVdlYnNvY2tldCxcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTixcbiAgICAgICAgICAgICdJbnZhbGlkIHNlc3Npb24gdG9rZW4nLFxuICAgICAgICAgICAgZmFsc2UsXG4gICAgICAgICAgICByZXF1ZXN0LnJlcXVlc3RJZFxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBWYWxpZGF0ZSBxdWVyeSBjb25kaXRpb24gZGVwdGhcbiAgICAgIGNvbnN0IGFwcENvbmZpZyA9IENvbmZpZy5nZXQodGhpcy5jb25maWcuYXBwSWQpO1xuICAgICAgaWYgKCFjbGllbnQuaGFzTWFzdGVyS2V5KSB7XG4gICAgICAgIGNvbnN0IHJjID0gYXBwQ29uZmlnLnJlcXVlc3RDb21wbGV4aXR5O1xuICAgICAgICBpZiAocmMgJiYgcmMucXVlcnlEZXB0aCAhPT0gLTEpIHtcbiAgICAgICAgICBjb25zdCBtYXhEZXB0aCA9IHJjLnF1ZXJ5RGVwdGg7XG4gICAgICAgICAgY29uc3QgY2hlY2tEZXB0aCA9ICh3aGVyZTogYW55LCBkZXB0aDogbnVtYmVyKSA9PiB7XG4gICAgICAgICAgICBpZiAoZGVwdGggPiBtYXhEZXB0aCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgICAgICAgICBgUXVlcnkgY29uZGl0aW9uIG5lc3RpbmcgZGVwdGggZXhjZWVkcyBtYXhpbXVtIGFsbG93ZWQgZGVwdGggb2YgJHttYXhEZXB0aH1gXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodHlwZW9mIHdoZXJlICE9PSAnb2JqZWN0JyB8fCB3aGVyZSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKGNvbnN0IG9wIG9mIFsnJG9yJywgJyRhbmQnLCAnJG5vciddKSB7XG4gICAgICAgICAgICAgIGlmICh3aGVyZVtvcF0gIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheSh3aGVyZVtvcF0pKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGAke29wfSBtdXN0IGJlIGFuIGFycmF5YCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkod2hlcmVbb3BdKSkge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3Qgc3ViUXVlcnkgb2Ygd2hlcmVbb3BdKSB7XG4gICAgICAgICAgICAgICAgICBjaGVja0RlcHRoKHN1YlF1ZXJ5LCBkZXB0aCArIDEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH07XG4gICAgICAgICAgY2hlY2tEZXB0aChyZXF1ZXN0LnF1ZXJ5LndoZXJlLCAwKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBWYWxpZGF0ZSBhbGxvd1JlZ2V4XG4gICAgICBpZiAoIWNsaWVudC5oYXNNYXN0ZXJLZXkpIHtcbiAgICAgICAgY29uc3QgcmMgPSBhcHBDb25maWcucmVxdWVzdENvbXBsZXhpdHk7XG4gICAgICAgIGlmIChyYyAmJiByYy5hbGxvd1JlZ2V4ID09PSBmYWxzZSkge1xuICAgICAgICAgIGNvbnN0IGNoZWNrUmVnZXggPSAod2hlcmU6IGFueSkgPT4ge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB3aGVyZSAhPT0gJ29iamVjdCcgfHwgd2hlcmUgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMod2hlcmUpKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGNvbnN0cmFpbnQgPSB3aGVyZVtrZXldO1xuICAgICAgICAgICAgICBpZiAodHlwZW9mIGNvbnN0cmFpbnQgPT09ICdvYmplY3QnICYmIGNvbnN0cmFpbnQgIT09IG51bGwgJiYgY29uc3RyYWludC4kcmVnZXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnJHJlZ2V4IG9wZXJhdG9yIGlzIG5vdCBhbGxvd2VkJyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZvciAoY29uc3Qgb3Agb2YgWyckb3InLCAnJGFuZCcsICckbm9yJ10pIHtcbiAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkod2hlcmVbb3BdKSkge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3Qgc3ViUXVlcnkgb2Ygd2hlcmVbb3BdKSB7XG4gICAgICAgICAgICAgICAgICBjaGVja1JlZ2V4KHN1YlF1ZXJ5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9O1xuICAgICAgICAgIGNoZWNrUmVnZXgocmVxdWVzdC5xdWVyeS53aGVyZSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQ2hlY2sgQ0xQIGZvciBzdWJzY3JpYmUgb3BlcmF0aW9uXG4gICAgICBjb25zdCBzY2hlbWFDb250cm9sbGVyID0gYXdhaXQgYXBwQ29uZmlnLmRhdGFiYXNlLmxvYWRTY2hlbWEoKTtcbiAgICAgIGNvbnN0IGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyA9IHNjaGVtYUNvbnRyb2xsZXIuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZSk7XG4gICAgICBjb25zdCBvcCA9IHRoaXMuX2dldENMUE9wZXJhdGlvbihyZXF1ZXN0LnF1ZXJ5KTtcbiAgICAgIGNvbnN0IGFjbEdyb3VwID0gWycqJ107XG4gICAgICBpZiAoIWF1dGhDYWxsZWQpIHtcbiAgICAgICAgY29uc3QgYXV0aCA9IGF3YWl0IHRoaXMuZ2V0QXV0aEZyb21DbGllbnQoXG4gICAgICAgICAgY2xpZW50LFxuICAgICAgICAgIHJlcXVlc3QucmVxdWVzdElkLFxuICAgICAgICAgIHJlcXVlc3Quc2Vzc2lvblRva2VuXG4gICAgICAgICk7XG4gICAgICAgIGF1dGhDYWxsZWQgPSB0cnVlO1xuICAgICAgICBpZiAoYXV0aCAmJiBhdXRoLnVzZXIpIHtcbiAgICAgICAgICByZXF1ZXN0LnVzZXIgPSBhdXRoLnVzZXI7XG4gICAgICAgICAgYWNsR3JvdXAucHVzaChhdXRoLnVzZXIuaWQpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHJlcXVlc3QudXNlcikge1xuICAgICAgICBhY2xHcm91cC5wdXNoKHJlcXVlc3QudXNlci5pZCk7XG4gICAgICB9XG4gICAgICBhd2FpdCBTY2hlbWFDb250cm9sbGVyLnZhbGlkYXRlUGVybWlzc2lvbihcbiAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgIGFjbEdyb3VwLFxuICAgICAgICBvcFxuICAgICAgKTtcblxuICAgICAgLy8gQ2hlY2sgcHJvdGVjdGVkIGZpZWxkcyBpbiBXSEVSRSBjbGF1c2UgYW5kIFdBVENIIHBhcmFtZXRlclxuICAgICAgaWYgKCFjbGllbnQuaGFzTWFzdGVyS2V5KSB7XG4gICAgICAgIGNvbnN0IGF1dGggPSByZXF1ZXN0LnVzZXIgPyB7IHVzZXI6IHJlcXVlc3QudXNlciwgdXNlclJvbGVzOiBbXSB9IDoge307XG4gICAgICAgIGNvbnN0IHByb3RlY3RlZEZpZWxkcyA9XG4gICAgICAgICAgYXBwQ29uZmlnLmRhdGFiYXNlLmFkZFByb3RlY3RlZEZpZWxkcyhcbiAgICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgIHJlcXVlc3QucXVlcnkud2hlcmUsXG4gICAgICAgICAgICBhY2xHcm91cCxcbiAgICAgICAgICAgIGF1dGhcbiAgICAgICAgICApIHx8IFtdO1xuICAgICAgICBpZiAocHJvdGVjdGVkRmllbGRzLmxlbmd0aCA+IDAgJiYgcmVxdWVzdC5xdWVyeS53aGVyZSkge1xuICAgICAgICAgIGNvbnN0IGNoZWNrV2hlcmUgPSAod2hlcmU6IGFueSkgPT4ge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB3aGVyZSAhPT0gJ29iamVjdCcgfHwgd2hlcmUgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yIChjb25zdCB3aGVyZUtleSBvZiBPYmplY3Qua2V5cyh3aGVyZSkpIHtcbiAgICAgICAgICAgICAgY29uc3Qgcm9vdEZpZWxkID0gd2hlcmVLZXkuc3BsaXQoJy4nKVswXTtcbiAgICAgICAgICAgICAgaWYgKHByb3RlY3RlZEZpZWxkcy5pbmNsdWRlcyh3aGVyZUtleSkgfHwgcHJvdGVjdGVkRmllbGRzLmluY2x1ZGVzKHJvb3RGaWVsZCkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICAgICAgICAgICAgJ1Blcm1pc3Npb24gZGVuaWVkJ1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZvciAoY29uc3Qgb3Agb2YgWyckb3InLCAnJGFuZCcsICckbm9yJ10pIHtcbiAgICAgICAgICAgICAgaWYgKHdoZXJlW29wXSAhPT0gdW5kZWZpbmVkICYmICFBcnJheS5pc0FycmF5KHdoZXJlW29wXSkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgYCR7b3B9IG11c3QgYmUgYW4gYXJyYXlgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh3aGVyZVtvcF0pKSB7XG4gICAgICAgICAgICAgICAgd2hlcmVbb3BdLmZvckVhY2goKHN1YlF1ZXJ5OiBhbnkpID0+IGNoZWNrV2hlcmUoc3ViUXVlcnkpKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH07XG4gICAgICAgICAgY2hlY2tXaGVyZShyZXF1ZXN0LnF1ZXJ5LndoZXJlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJvdGVjdGVkRmllbGRzLmxlbmd0aCA+IDAgJiYgQXJyYXkuaXNBcnJheShyZXF1ZXN0LnF1ZXJ5LndhdGNoKSkge1xuICAgICAgICAgIGZvciAoY29uc3Qgd2F0Y2hGaWVsZCBvZiByZXF1ZXN0LnF1ZXJ5LndhdGNoKSB7XG4gICAgICAgICAgICBjb25zdCByb290RmllbGQgPSB3YXRjaEZpZWxkLnNwbGl0KCcuJylbMF07XG4gICAgICAgICAgICBpZiAocHJvdGVjdGVkRmllbGRzLmluY2x1ZGVzKHdhdGNoRmllbGQpIHx8IHByb3RlY3RlZEZpZWxkcy5pbmNsdWRlcyhyb290RmllbGQpKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICAgICAgICAgICdQZXJtaXNzaW9uIGRlbmllZCdcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gVmFsaWRhdGUgcmVnZXggcGF0dGVybnMgaW4gdGhlIHN1YnNjcmlwdGlvbiBxdWVyeVxuICAgICAgdGhpcy5fdmFsaWRhdGVRdWVyeUNvbnN0cmFpbnRzKHJlcXVlc3QucXVlcnkud2hlcmUpO1xuXG4gICAgICAvLyBHZXQgc3Vic2NyaXB0aW9uIGZyb20gc3Vic2NyaXB0aW9ucywgY3JlYXRlIG9uZSBpZiBuZWNlc3NhcnlcbiAgICAgIGNvbnN0IHN1YnNjcmlwdGlvbkhhc2ggPSBxdWVyeUhhc2gocmVxdWVzdC5xdWVyeSk7XG4gICAgICAvLyBBZGQgY2xhc3NOYW1lIHRvIHN1YnNjcmlwdGlvbnMgaWYgbmVjZXNzYXJ5XG5cbiAgICAgIGlmICghdGhpcy5zdWJzY3JpcHRpb25zLmhhcyhjbGFzc05hbWUpKSB7XG4gICAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5zZXQoY2xhc3NOYW1lLCBuZXcgTWFwKCkpO1xuICAgICAgfVxuICAgICAgY29uc3QgY2xhc3NTdWJzY3JpcHRpb25zID0gdGhpcy5zdWJzY3JpcHRpb25zLmdldChjbGFzc05hbWUpO1xuICAgICAgbGV0IHN1YnNjcmlwdGlvbjtcbiAgICAgIGlmIChjbGFzc1N1YnNjcmlwdGlvbnMuaGFzKHN1YnNjcmlwdGlvbkhhc2gpKSB7XG4gICAgICAgIHN1YnNjcmlwdGlvbiA9IGNsYXNzU3Vic2NyaXB0aW9ucy5nZXQoc3Vic2NyaXB0aW9uSGFzaCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzdWJzY3JpcHRpb24gPSBuZXcgU3Vic2NyaXB0aW9uKGNsYXNzTmFtZSwgcmVxdWVzdC5xdWVyeS53aGVyZSwgc3Vic2NyaXB0aW9uSGFzaCk7XG4gICAgICAgIGNsYXNzU3Vic2NyaXB0aW9ucy5zZXQoc3Vic2NyaXB0aW9uSGFzaCwgc3Vic2NyaXB0aW9uKTtcbiAgICAgIH1cblxuICAgICAgLy8gQWRkIHN1YnNjcmlwdGlvbkluZm8gdG8gY2xpZW50XG4gICAgICBjb25zdCBzdWJzY3JpcHRpb25JbmZvOiBhbnkgPSB7XG4gICAgICAgIHN1YnNjcmlwdGlvbjogc3Vic2NyaXB0aW9uLFxuICAgICAgfTtcbiAgICAgIC8vIEFkZCBzZWxlY3RlZCBmaWVsZHMsIHNlc3Npb25Ub2tlbiBhbmQgaW5zdGFsbGF0aW9uSWQgZm9yIHRoaXMgc3Vic2NyaXB0aW9uIGlmIG5lY2Vzc2FyeVxuICAgICAgaWYgKHJlcXVlc3QucXVlcnkua2V5cykge1xuICAgICAgICBzdWJzY3JpcHRpb25JbmZvLmtleXMgPSBBcnJheS5pc0FycmF5KHJlcXVlc3QucXVlcnkua2V5cylcbiAgICAgICAgICA/IHJlcXVlc3QucXVlcnkua2V5c1xuICAgICAgICAgIDogcmVxdWVzdC5xdWVyeS5rZXlzLnNwbGl0KCcsJyk7XG4gICAgICB9XG4gICAgICBpZiAocmVxdWVzdC5xdWVyeS53YXRjaCkge1xuICAgICAgICBzdWJzY3JpcHRpb25JbmZvLndhdGNoID0gcmVxdWVzdC5xdWVyeS53YXRjaDtcbiAgICAgIH1cbiAgICAgIGlmIChyZXF1ZXN0LnNlc3Npb25Ub2tlbikge1xuICAgICAgICBzdWJzY3JpcHRpb25JbmZvLnNlc3Npb25Ub2tlbiA9IHJlcXVlc3Quc2Vzc2lvblRva2VuO1xuICAgICAgfVxuICAgICAgY2xpZW50LmFkZFN1YnNjcmlwdGlvbkluZm8ocmVxdWVzdC5yZXF1ZXN0SWQsIHN1YnNjcmlwdGlvbkluZm8pO1xuXG4gICAgICAvLyBBZGQgY2xpZW50SWQgdG8gc3Vic2NyaXB0aW9uXG4gICAgICBzdWJzY3JpcHRpb24uYWRkQ2xpZW50U3Vic2NyaXB0aW9uKHBhcnNlV2Vic29ja2V0LmNsaWVudElkLCByZXF1ZXN0LnJlcXVlc3RJZCk7XG5cbiAgICAgIGNsaWVudC5wdXNoU3Vic2NyaWJlKHJlcXVlc3QucmVxdWVzdElkKTtcblxuICAgICAgbG9nZ2VyLnZlcmJvc2UoXG4gICAgICAgIGBDcmVhdGUgY2xpZW50ICR7cGFyc2VXZWJzb2NrZXQuY2xpZW50SWR9IG5ldyBzdWJzY3JpcHRpb246ICR7cmVxdWVzdC5yZXF1ZXN0SWR9YFxuICAgICAgKTtcbiAgICAgIGxvZ2dlci52ZXJib3NlKCdDdXJyZW50IGNsaWVudCBudW1iZXI6ICVkJywgdGhpcy5jbGllbnRzLnNpemUpO1xuICAgICAgcnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyh7XG4gICAgICAgIGNsaWVudCxcbiAgICAgICAgZXZlbnQ6ICdzdWJzY3JpYmUnLFxuICAgICAgICBjbGllbnRzOiB0aGlzLmNsaWVudHMuc2l6ZSxcbiAgICAgICAgc3Vic2NyaXB0aW9uczogdGhpcy5zdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgIHNlc3Npb25Ub2tlbjogcmVxdWVzdC5zZXNzaW9uVG9rZW4sXG4gICAgICAgIHVzZU1hc3RlcktleTogY2xpZW50Lmhhc01hc3RlcktleSxcbiAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IGNsaWVudC5pbnN0YWxsYXRpb25JZCxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gcmVzb2x2ZUVycm9yKGUpO1xuICAgICAgQ2xpZW50LnB1c2hFcnJvcihwYXJzZVdlYnNvY2tldCwgZXJyb3IuY29kZSwgZXJyb3IubWVzc2FnZSwgZmFsc2UsIHJlcXVlc3QucmVxdWVzdElkKTtcbiAgICAgIGxvZ2dlci5lcnJvcihcbiAgICAgICAgYEZhaWxlZCBydW5uaW5nIGJlZm9yZVN1YnNjcmliZSBvbiAke2NsYXNzTmFtZX0gZm9yIHNlc3Npb24gJHtyZXF1ZXN0LnNlc3Npb25Ub2tlbn0gd2l0aDpcXG4gRXJyb3I6IGAgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGVycm9yKVxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBfaGFuZGxlVXBkYXRlU3Vic2NyaXB0aW9uKHBhcnNlV2Vic29ja2V0OiBhbnksIHJlcXVlc3Q6IGFueSk6IGFueSB7XG4gICAgdGhpcy5faGFuZGxlVW5zdWJzY3JpYmUocGFyc2VXZWJzb2NrZXQsIHJlcXVlc3QsIGZhbHNlKTtcbiAgICB0aGlzLl9oYW5kbGVTdWJzY3JpYmUocGFyc2VXZWJzb2NrZXQsIHJlcXVlc3QpO1xuICB9XG5cbiAgX2hhbmRsZVVuc3Vic2NyaWJlKHBhcnNlV2Vic29ja2V0OiBhbnksIHJlcXVlc3Q6IGFueSwgbm90aWZ5Q2xpZW50OiBib29sZWFuID0gdHJ1ZSk6IGFueSB7XG4gICAgLy8gSWYgd2UgY2FuIG5vdCBmaW5kIHRoaXMgY2xpZW50LCByZXR1cm4gZXJyb3IgdG8gY2xpZW50XG4gICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocGFyc2VXZWJzb2NrZXQsICdjbGllbnRJZCcpKSB7XG4gICAgICBDbGllbnQucHVzaEVycm9yKFxuICAgICAgICBwYXJzZVdlYnNvY2tldCxcbiAgICAgICAgMixcbiAgICAgICAgJ0NhbiBub3QgZmluZCB0aGlzIGNsaWVudCwgbWFrZSBzdXJlIHlvdSBjb25uZWN0IHRvIHNlcnZlciBiZWZvcmUgdW5zdWJzY3JpYmluZydcbiAgICAgICk7XG4gICAgICBsb2dnZXIuZXJyb3IoXG4gICAgICAgICdDYW4gbm90IGZpbmQgdGhpcyBjbGllbnQsIG1ha2Ugc3VyZSB5b3UgY29ubmVjdCB0byBzZXJ2ZXIgYmVmb3JlIHVuc3Vic2NyaWJpbmcnXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXF1ZXN0SWQgPSByZXF1ZXN0LnJlcXVlc3RJZDtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudHMuZ2V0KHBhcnNlV2Vic29ja2V0LmNsaWVudElkKTtcbiAgICBpZiAodHlwZW9mIGNsaWVudCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIENsaWVudC5wdXNoRXJyb3IoXG4gICAgICAgIHBhcnNlV2Vic29ja2V0LFxuICAgICAgICAyLFxuICAgICAgICAnQ2Fubm90IGZpbmQgY2xpZW50IHdpdGggY2xpZW50SWQgJyArXG4gICAgICAgICAgcGFyc2VXZWJzb2NrZXQuY2xpZW50SWQgK1xuICAgICAgICAgICcuIE1ha2Ugc3VyZSB5b3UgY29ubmVjdCB0byBsaXZlIHF1ZXJ5IHNlcnZlciBiZWZvcmUgdW5zdWJzY3JpYmluZy4nXG4gICAgICApO1xuICAgICAgbG9nZ2VyLmVycm9yKCdDYW4gbm90IGZpbmQgdGhpcyBjbGllbnQgJyArIHBhcnNlV2Vic29ja2V0LmNsaWVudElkKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBzdWJzY3JpcHRpb25JbmZvID0gY2xpZW50LmdldFN1YnNjcmlwdGlvbkluZm8ocmVxdWVzdElkKTtcbiAgICBpZiAodHlwZW9mIHN1YnNjcmlwdGlvbkluZm8gPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBDbGllbnQucHVzaEVycm9yKFxuICAgICAgICBwYXJzZVdlYnNvY2tldCxcbiAgICAgICAgMixcbiAgICAgICAgJ0Nhbm5vdCBmaW5kIHN1YnNjcmlwdGlvbiB3aXRoIGNsaWVudElkICcgK1xuICAgICAgICAgIHBhcnNlV2Vic29ja2V0LmNsaWVudElkICtcbiAgICAgICAgICAnIHN1YnNjcmlwdGlvbklkICcgK1xuICAgICAgICAgIHJlcXVlc3RJZCArXG4gICAgICAgICAgJy4gTWFrZSBzdXJlIHlvdSBzdWJzY3JpYmUgdG8gbGl2ZSBxdWVyeSBzZXJ2ZXIgYmVmb3JlIHVuc3Vic2NyaWJpbmcuJ1xuICAgICAgKTtcbiAgICAgIGxvZ2dlci5lcnJvcihcbiAgICAgICAgJ0NhbiBub3QgZmluZCBzdWJzY3JpcHRpb24gd2l0aCBjbGllbnRJZCAnICtcbiAgICAgICAgICBwYXJzZVdlYnNvY2tldC5jbGllbnRJZCArXG4gICAgICAgICAgJyBzdWJzY3JpcHRpb25JZCAnICtcbiAgICAgICAgICByZXF1ZXN0SWRcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIHN1YnNjcmlwdGlvbiBmcm9tIGNsaWVudFxuICAgIGNsaWVudC5kZWxldGVTdWJzY3JpcHRpb25JbmZvKHJlcXVlc3RJZCk7XG4gICAgLy8gUmVtb3ZlIGNsaWVudCBmcm9tIHN1YnNjcmlwdGlvblxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbiA9IHN1YnNjcmlwdGlvbkluZm8uc3Vic2NyaXB0aW9uO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHN1YnNjcmlwdGlvbi5jbGFzc05hbWU7XG4gICAgc3Vic2NyaXB0aW9uLmRlbGV0ZUNsaWVudFN1YnNjcmlwdGlvbihwYXJzZVdlYnNvY2tldC5jbGllbnRJZCwgcmVxdWVzdElkKTtcbiAgICAvLyBJZiB0aGVyZSBpcyBubyBjbGllbnQgd2hpY2ggaXMgc3Vic2NyaWJpbmcgdGhpcyBzdWJzY3JpcHRpb24sIHJlbW92ZSBpdCBmcm9tIHN1YnNjcmlwdGlvbnNcbiAgICBjb25zdCBjbGFzc1N1YnNjcmlwdGlvbnMgPSB0aGlzLnN1YnNjcmlwdGlvbnMuZ2V0KGNsYXNzTmFtZSk7XG4gICAgaWYgKCFzdWJzY3JpcHRpb24uaGFzU3Vic2NyaWJpbmdDbGllbnQoKSkge1xuICAgICAgY2xhc3NTdWJzY3JpcHRpb25zLmRlbGV0ZShzdWJzY3JpcHRpb24uaGFzaCk7XG4gICAgfVxuICAgIC8vIElmIHRoZXJlIGlzIG5vIHN1YnNjcmlwdGlvbnMgdW5kZXIgdGhpcyBjbGFzcywgcmVtb3ZlIGl0IGZyb20gc3Vic2NyaXB0aW9uc1xuICAgIGlmIChjbGFzc1N1YnNjcmlwdGlvbnMuc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy5zdWJzY3JpcHRpb25zLmRlbGV0ZShjbGFzc05hbWUpO1xuICAgIH1cbiAgICBydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzKHtcbiAgICAgIGNsaWVudCxcbiAgICAgIGV2ZW50OiAndW5zdWJzY3JpYmUnLFxuICAgICAgY2xpZW50czogdGhpcy5jbGllbnRzLnNpemUsXG4gICAgICBzdWJzY3JpcHRpb25zOiB0aGlzLnN1YnNjcmlwdGlvbnMuc2l6ZSxcbiAgICAgIHNlc3Npb25Ub2tlbjogc3Vic2NyaXB0aW9uSW5mby5zZXNzaW9uVG9rZW4sXG4gICAgICB1c2VNYXN0ZXJLZXk6IGNsaWVudC5oYXNNYXN0ZXJLZXksXG4gICAgICBpbnN0YWxsYXRpb25JZDogY2xpZW50Lmluc3RhbGxhdGlvbklkLFxuICAgIH0pO1xuXG4gICAgaWYgKCFub3RpZnlDbGllbnQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjbGllbnQucHVzaFVuc3Vic2NyaWJlKHJlcXVlc3QucmVxdWVzdElkKTtcblxuICAgIGxvZ2dlci52ZXJib3NlKFxuICAgICAgYERlbGV0ZSBjbGllbnQ6ICR7cGFyc2VXZWJzb2NrZXQuY2xpZW50SWR9IHwgc3Vic2NyaXB0aW9uOiAke3JlcXVlc3QucmVxdWVzdElkfWBcbiAgICApO1xuICB9XG59XG5cbmV4cG9ydCB7IFBhcnNlTGl2ZVF1ZXJ5U2VydmVyIH07XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLElBQUFBLEdBQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLEtBQUEsR0FBQUYsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFFLGFBQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLE9BQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLHFCQUFB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