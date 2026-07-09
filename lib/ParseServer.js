"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _QueryTools = require("./LiveQuery/QueryTools");
var _defaults = _interopRequireWildcard(require("./defaults"));
var logging = _interopRequireWildcard(require("./logger"));
var _Config = _interopRequireDefault(require("./Config"));
var _PromiseRouter = _interopRequireDefault(require("./PromiseRouter"));
var _requiredParameter = _interopRequireDefault(require("./requiredParameter"));
var _AnalyticsRouter = require("./Routers/AnalyticsRouter");
var _ClassesRouter = require("./Routers/ClassesRouter");
var _FeaturesRouter = require("./Routers/FeaturesRouter");
var _FilesRouter = require("./Routers/FilesRouter");
var _FunctionsRouter = require("./Routers/FunctionsRouter");
var _GlobalConfigRouter = require("./Routers/GlobalConfigRouter");
var _GraphQLRouter = require("./Routers/GraphQLRouter");
var _HooksRouter = require("./Routers/HooksRouter");
var _IAPValidationRouter = require("./Routers/IAPValidationRouter");
var _InstallationsRouter = require("./Routers/InstallationsRouter");
var _LogsRouter = require("./Routers/LogsRouter");
var _ParseLiveQueryServer = require("./LiveQuery/ParseLiveQueryServer");
var _PagesRouter = require("./Routers/PagesRouter");
var _PushRouter = require("./Routers/PushRouter");
var _CloudCodeRouter = require("./Routers/CloudCodeRouter");
var _RolesRouter = require("./Routers/RolesRouter");
var _SchemasRouter = require("./Routers/SchemasRouter");
var _SessionsRouter = require("./Routers/SessionsRouter");
var _UsersRouter = require("./Routers/UsersRouter");
var _PurgeRouter = require("./Routers/PurgeRouter");
var _AudiencesRouter = require("./Routers/AudiencesRouter");
var _AggregateRouter = require("./Routers/AggregateRouter");
var _ParseServerRESTController = require("./ParseServerRESTController");
var controllers = _interopRequireWildcard(require("./Controllers"));
var _ParseGraphQLServer = require("./GraphQL/ParseGraphQLServer");
var _SecurityRouter = require("./Routers/SecurityRouter");
var _CheckRunner = _interopRequireDefault(require("./Security/CheckRunner"));
var _Deprecator = _interopRequireDefault(require("./Deprecator/Deprecator"));
var _DefinedSchemas = require("./SchemaMigrations/DefinedSchemas");
var _Definitions = _interopRequireDefault(require("./Options/Definitions"));
var _TestUtils = require("./TestUtils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
// ParseServer - open-source compatible API Server for Parse apps

var batch = require('./batch'),
  express = require('express'),
  middlewares = require('./middlewares'),
  Parse = require('parse/node').Parse,
  {
    parse
  } = require('graphql'),
  path = require('path'),
  fs = require('fs');
// Mutate the Parse object to add the Cloud Code handlers
addParseCloud();

// Track connections to destroy them on shutdown
const connections = new _TestUtils.Connections();

// ParseServer works like a constructor of an express app.
// https://parseplatform.org/parse-server/api/master/ParseServerOptions.html
class ParseServer {
  /**
   * @constructor
   * @param {ParseServerOptions} options the parse server initialization options
   */
  constructor(options) {
    // Scan for deprecated Parse Server options
    _Deprecator.default.scanParseServerOptions(options);
    const interfaces = JSON.parse(JSON.stringify(_Definitions.default));
    function getValidObject(root) {
      const result = {};
      for (const key in root) {
        if (Object.prototype.hasOwnProperty.call(root[key], 'type')) {
          if (root[key].type.endsWith('[]')) {
            result[key] = [getValidObject(interfaces[root[key].type.slice(0, -2)])];
          } else {
            result[key] = getValidObject(interfaces[root[key].type]);
          }
        } else {
          result[key] = '';
        }
      }
      return result;
    }
    const optionsBlueprint = getValidObject(interfaces['ParseServerOptions']);
    function validateKeyNames(original, ref, name = '') {
      let result = [];
      const prefix = name + (name !== '' ? '.' : '');
      for (const key in original) {
        if (!Object.prototype.hasOwnProperty.call(ref, key)) {
          result.push(prefix + key);
        } else {
          if (ref[key] === '') {
            continue;
          }
          let res = [];
          if (Array.isArray(original[key]) && Array.isArray(ref[key])) {
            const type = ref[key][0];
            original[key].forEach((item, idx) => {
              if (typeof item === 'object' && item !== null) {
                res = res.concat(validateKeyNames(item, type, prefix + key + `[${idx}]`));
              }
            });
          } else if (typeof original[key] === 'object' && typeof ref[key] === 'object') {
            res = validateKeyNames(original[key], ref[key], prefix + key);
          }
          result = result.concat(res);
        }
      }
      return result;
    }
    const diff = validateKeyNames(options, optionsBlueprint);
    if (diff.length > 0) {
      const logger = logging.logger;
      logger.error(`Invalid key(s) found in Parse Server configuration: ${diff.join(', ')}`);
    }

    // Set option defaults
    injectDefaults(options);
    const {
      appId = (0, _requiredParameter.default)('You must provide an appId!'),
      masterKey = (0, _requiredParameter.default)('You must provide a masterKey!'),
      javascriptKey,
      serverURL = (0, _requiredParameter.default)('You must provide a serverURL!')
    } = options;
    // Initialize the node client SDK automatically
    Parse.initialize(appId, javascriptKey || 'unused', masterKey);
    Parse.serverURL = serverURL;
    _Config.default.validateOptions(options);
    const allControllers = controllers.getControllers(options);
    options.state = 'initialized';
    this.config = _Config.default.put(Object.assign({}, options, allControllers));
    this.config.masterKeyIpsStore = new Map();
    this.config.maintenanceKeyIpsStore = new Map();
    this.config.readOnlyMasterKeyIpsStore = new Map();
    (0, _QueryTools.setRegexTimeout)(options.liveQuery?.regexTimeout);
    logging.setLogger(allControllers.loggerController);
  }

  /**
   * Starts Parse Server as an express app; this promise resolves when Parse Server is ready to accept requests.
   */

  async start() {
    try {
      if (this.config.state === 'ok') {
        return this;
      }
      this.config.state = 'starting';
      _Config.default.put(this.config);
      const {
        databaseController,
        hooksController,
        cacheController,
        cloud,
        security,
        schema,
        liveQueryController
      } = this.config;
      try {
        await databaseController.performInitialization();
      } catch (e) {
        if (e.code !== Parse.Error.DUPLICATE_VALUE) {
          throw e;
        }
      }
      const pushController = await controllers.getPushController(this.config);
      await hooksController.load();
      const startupPromises = [this.config.loadMasterKey?.()];
      if (schema) {
        startupPromises.push(new _DefinedSchemas.DefinedSchemas(schema, this.config).execute());
      }
      if (cacheController.adapter?.connect && typeof cacheController.adapter.connect === 'function') {
        startupPromises.push(cacheController.adapter.connect());
      }
      startupPromises.push(liveQueryController.connect());
      await Promise.all(startupPromises);
      if (cloud) {
        addParseCloud();
        if (typeof cloud === 'function') {
          await Promise.resolve(cloud(Parse));
        } else if (typeof cloud === 'string') {
          let json;
          if (process.env.npm_package_json) {
            json = require(process.env.npm_package_json);
          }
          if (process.env.npm_package_type === 'module' || json?.type === 'module') {
            await import(path.resolve(process.cwd(), cloud));
          } else {
            require(path.resolve(process.cwd(), cloud));
          }
        } else {
          throw "argument 'cloud' must either be a string or a function";
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (security && security.enableCheck && security.enableCheckLog) {
        new _CheckRunner.default(security).run();
      }
      this.config.state = 'ok';
      this.config = {
        ...this.config,
        ...pushController
      };
      _Config.default.put(this.config);
      return this;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      this.config.state = 'error';
      throw error;
    }
  }
  get app() {
    if (!this._app) {
      this._app = ParseServer.app(this.config);
    }
    return this._app;
  }

  /**
   * Stops the parse server, cancels any ongoing requests and closes all connections.
   *
   * Currently, express doesn't shut down immediately after receiving SIGINT/SIGTERM
   * if it has client connections that haven't timed out.
   * (This is a known issue with node - https://github.com/nodejs/node/issues/2642)
   *
   * @returns {Promise<void>} a promise that resolves when the server is stopped
   */
  async handleShutdown() {
    const serverClosePromise = (0, _TestUtils.resolvingPromise)();
    const liveQueryServerClosePromise = (0, _TestUtils.resolvingPromise)();
    const promises = [];
    this.server.close(error => {
      /* istanbul ignore next */
      if (error) {
        // eslint-disable-next-line no-console
        console.error('Error while closing parse server', error);
      }
      serverClosePromise.resolve();
    });
    if (this.liveQueryServer?.server?.close && this.liveQueryServer.server !== this.server) {
      this.liveQueryServer.server.close(error => {
        /* istanbul ignore next */
        if (error) {
          // eslint-disable-next-line no-console
          console.error('Error while closing live query server', error);
        }
        liveQueryServerClosePromise.resolve();
      });
    } else {
      liveQueryServerClosePromise.resolve();
    }
    const {
      adapter: databaseAdapter
    } = this.config.databaseController;
    if (databaseAdapter && typeof databaseAdapter.handleShutdown === 'function') {
      promises.push(databaseAdapter.handleShutdown());
    }
    const {
      adapter: fileAdapter
    } = this.config.filesController;
    if (fileAdapter && typeof fileAdapter.handleShutdown === 'function') {
      promises.push(fileAdapter.handleShutdown());
    }
    const {
      adapter: cacheAdapter
    } = this.config.cacheController;
    if (cacheAdapter && typeof cacheAdapter.handleShutdown === 'function') {
      promises.push(cacheAdapter.handleShutdown());
    }
    if (this.liveQueryServer) {
      promises.push(this.liveQueryServer.shutdown());
    }
    await Promise.all(promises);
    connections.destroyAll();
    await Promise.all([serverClosePromise, liveQueryServerClosePromise]);
    if (this.config.serverCloseComplete) {
      this.config.serverCloseComplete();
    }
  }

  /**
   * @static
   * Allow developers to customize each request with inversion of control/dependency injection
   */
  static applyRequestContextMiddleware(api, options) {
    if (options.requestContextMiddleware) {
      if (typeof options.requestContextMiddleware !== 'function') {
        throw new Error('requestContextMiddleware must be a function');
      }
      api.use(options.requestContextMiddleware);
    }
  }
  /**
   * @static
   * Create an express app for the parse server
   * @param {Object} options let you specify the maxUploadSize when creating the express app  */
  static app(options) {
    const {
      maxUploadSize = '20mb',
      appId,
      directAccess,
      pages,
      rateLimit = []
    } = options;
    // This app serves the Parse API directly.
    // It's the equivalent of https://api.parse.com/1 in the hosted Parse API.
    var api = express();
    //api.use("/apps", express.static(__dirname + "/public"));
    api.use(middlewares.allowCrossDomain(appId));
    api.use(middlewares.allowDoubleForwardSlash);
    api.use(middlewares.handleParseAuth(appId));
    // File handling needs to be before the default JSON body parser because file
    // uploads send binary data that should not be parsed as JSON.
    api.use('/', new _FilesRouter.FilesRouter().expressRouter({
      maxUploadSize: maxUploadSize
    }));
    api.use('/health', middlewares.enforceRouteAllowList, middlewares.handleParseHealth(options));
    api.use('/', express.urlencoded({
      extended: false
    }), new _PagesRouter.PagesRouter(pages).expressRouter());
    api.use(express.json({
      type: req => !req.is('multipart/form-data'),
      limit: maxUploadSize
    }));
    api.use(middlewares.allowMethodOverride);
    api.use(middlewares.handleParseHeaders);
    api.use(middlewares.enforceRouteAllowList);
    api.set('query parser', 'extended');
    const routes = Array.isArray(rateLimit) ? rateLimit : [rateLimit];
    for (const route of routes) {
      middlewares.addRateLimit(route, options);
    }
    api.use(middlewares.handleParseSession);
    this.applyRequestContextMiddleware(api, options);
    const appRouter = ParseServer.promiseRouter({
      appId,
      options
    });
    api.use(appRouter.expressRouter());
    api.use(middlewares.handleParseErrors);

    // run the following when not testing
    if (!process.env.TESTING) {
      //This causes tests to spew some useless warnings, so disable in test
      /* istanbul ignore next */
      process.on('uncaughtException', err => {
        if (err.code === 'EADDRINUSE') {
          // user-friendly message for this common error
          process.stderr.write(`Unable to listen on port ${err.port}. The port is already in use.`);
          process.exit(0);
        } else {
          if (err.message) {
            process.stderr.write('An uncaught exception occurred: ' + err.message);
          }
          if (err.stack) {
            process.stderr.write('Stack Trace:\n' + err.stack);
          } else {
            process.stderr.write(err);
          }
          process.exit(1);
        }
      });
    }
    if (process.env.PARSE_SERVER_ENABLE_EXPERIMENTAL_DIRECT_ACCESS === '1' || directAccess) {
      Parse.CoreManager.setRESTController((0, _ParseServerRESTController.ParseServerRESTController)(appId, appRouter));
    }
    return api;
  }
  static promiseRouter({
    appId,
    options
  }) {
    const routers = [new _ClassesRouter.ClassesRouter(), new _UsersRouter.UsersRouter(), new _SessionsRouter.SessionsRouter(), new _RolesRouter.RolesRouter(), new _AnalyticsRouter.AnalyticsRouter(), new _InstallationsRouter.InstallationsRouter(), new _FunctionsRouter.FunctionsRouter(), new _SchemasRouter.SchemasRouter(), new _PushRouter.PushRouter(), new _LogsRouter.LogsRouter(), new _FeaturesRouter.FeaturesRouter(), new _GlobalConfigRouter.GlobalConfigRouter(), new _GraphQLRouter.GraphQLRouter(), new _PurgeRouter.PurgeRouter(), new _HooksRouter.HooksRouter(), new _CloudCodeRouter.CloudCodeRouter(), new _AudiencesRouter.AudiencesRouter(), new _AggregateRouter.AggregateRouter(), new _SecurityRouter.SecurityRouter()];
    if (options?.enableProductPurchaseLegacyApi !== false) {
      routers.push(new _IAPValidationRouter.IAPValidationRouter());
    }
    const routes = routers.reduce((memo, router) => {
      return memo.concat(router.routes);
    }, []);
    const appRouter = new _PromiseRouter.default(routes, appId);
    batch.mountOnto(appRouter);
    return appRouter;
  }

  /**
   * starts the parse server's express app
   * @param {ParseServerOptions} options to use to start the server
   * @returns {ParseServer} the parse server instance
   */

  async startApp(options) {
    try {
      await this.start();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error on ParseServer.startApp: ', e);
      throw e;
    }
    const app = express();
    if (options.middleware) {
      let middleware;
      if (typeof options.middleware == 'string') {
        middleware = require(path.resolve(process.cwd(), options.middleware));
      } else {
        middleware = options.middleware; // use as-is let express fail
      }
      app.use(middleware);
    }
    app.use(options.mountPath, this.app);
    if (options.mountGraphQL === true || options.mountPlayground === true) {
      let graphQLCustomTypeDefs = undefined;
      if (typeof options.graphQLSchema === 'string') {
        graphQLCustomTypeDefs = parse(fs.readFileSync(options.graphQLSchema, 'utf8'));
      } else if (typeof options.graphQLSchema === 'object' || typeof options.graphQLSchema === 'function') {
        graphQLCustomTypeDefs = options.graphQLSchema;
      }
      const parseGraphQLServer = new _ParseGraphQLServer.ParseGraphQLServer(this, {
        graphQLPath: options.graphQLPath,
        playgroundPath: options.playgroundPath,
        graphQLCustomTypeDefs
      });
      if (options.mountGraphQL) {
        parseGraphQLServer.applyGraphQL(app);
      }
      if (options.mountPlayground) {
        parseGraphQLServer.applyPlayground(app);
        logging.getLogger().warn('GraphQL Playground is deprecated and will be removed in a future version. It exposes the master key in the browser. Use Parse Dashboard as GraphQL IDE or configure a third-party GraphQL client with custom request headers.');
      }
    }
    const server = await new Promise(resolve => {
      app.listen(options.port, options.host, function () {
        resolve(this);
      });
    });
    this.server = server;
    connections.track(server);
    if (options.startLiveQueryServer || options.liveQueryServerOptions) {
      this.liveQueryServer = await ParseServer.createLiveQueryServer(server, options.liveQueryServerOptions, options);
      if (this.liveQueryServer.server !== this.server) {
        connections.track(this.liveQueryServer.server);
      }
    }
    if (options.trustProxy) {
      app.set('trust proxy', options.trustProxy);
    }
    /* istanbul ignore next */
    if (!process.env.TESTING) {
      configureListeners(this);
      if (options.verifyServerUrl !== false) {
        await ParseServer.verifyServerUrl();
      }
    }
    this.expressApp = app;
    return this;
  }

  /**
   * Creates a new ParseServer and starts it.
   * @param {ParseServerOptions} options used to start the server
   * @returns {ParseServer} the parse server instance
   */
  static async startApp(options) {
    const parseServer = new ParseServer(options);
    return parseServer.startApp(options);
  }

  /**
   * Helper method to create a liveQuery server
   * @static
   * @param {Server} httpServer an optional http server to pass
   * @param {LiveQueryServerOptions} config options for the liveQueryServer
   * @param {ParseServerOptions} options options for the ParseServer
   * @returns {Promise<ParseLiveQueryServer>} the live query server instance
   */
  static async createLiveQueryServer(httpServer, config, options) {
    if (!httpServer || config && config.port) {
      var app = express();
      httpServer = require('http').createServer(app);
      httpServer.listen(config.port);
    }
    const server = new _ParseLiveQueryServer.ParseLiveQueryServer(httpServer, config, options);
    await server.connect();
    return server;
  }
  static async verifyServerUrl() {
    // perform a health check on the serverURL value
    if (Parse.serverURL) {
      const isValidHttpUrl = string => {
        let url;
        try {
          url = new URL(string);
        } catch {
          return false;
        }
        return url.protocol === 'http:' || url.protocol === 'https:';
      };
      const url = `${Parse.serverURL.replace(/\/$/, '')}/health`;
      if (!isValidHttpUrl(url)) {
        // eslint-disable-next-line no-console
        console.warn(`\nWARNING, Unable to connect to '${Parse.serverURL}' as the URL is invalid.` + ` Cloud code and push notifications may be unavailable!\n`);
        return;
      }
      const request = require('./request');
      const response = await request({
        url
      }).catch(response => response);
      const json = response.data || null;
      const retry = response.headers?.['retry-after'];
      if (retry) {
        await new Promise(resolve => setTimeout(resolve, retry * 1000));
        return this.verifyServerUrl();
      }
      if (response.status !== 200 || json?.status !== 'ok') {
        /* eslint-disable no-console */
        console.warn(`\nWARNING, Unable to connect to '${Parse.serverURL}'.` + ` Cloud code and push notifications may be unavailable!\n`);
        /* eslint-enable no-console */
        return;
      }
      return true;
    }
  }
}
function addParseCloud() {
  const ParseCloud = require('./cloud-code/Parse.Cloud');
  const ParseServer = require('./cloud-code/Parse.Server');
  Object.defineProperty(Parse, 'Server', {
    get() {
      const conf = _Config.default.get(Parse.applicationId);
      return {
        ...conf,
        ...ParseServer
      };
    },
    set(newVal) {
      newVal.appId = Parse.applicationId;
      _Config.default.put(newVal);
    },
    configurable: true
  });
  Object.assign(Parse.Cloud, ParseCloud);
  global.Parse = Parse;
}
function injectDefaults(options) {
  Object.keys(_defaults.default).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      options[key] = _defaults.default[key];
    }
  });

  // Inject defaults for database options; only when no explicit database adapter is set,
  // because an explicit adapter manages its own options and passing databaseOptions alongside
  // it would cause a conflict error in getDatabaseController.
  if (!options.databaseAdapter) {
    if (options.databaseOptions == null) {
      options.databaseOptions = {};
    }
    if (typeof options.databaseOptions === 'object' && !Array.isArray(options.databaseOptions)) {
      Object.keys(_defaults.DatabaseOptionDefaults).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(options.databaseOptions, key)) {
          options.databaseOptions[key] = _defaults.DatabaseOptionDefaults[key];
        }
      });
    }
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'serverURL')) {
    options.serverURL = `http://localhost:${options.port}${options.mountPath}`;
  }

  // Reserved Characters
  if (options.appId) {
    const regex = /[!#$%'()*+&/:;=?@[\]{}^,|<>]/g;
    if (options.appId.match(regex)) {
      // eslint-disable-next-line no-console
      console.warn(`\nWARNING, appId that contains special characters can cause issues while using with urls.\n`);
    }
  }

  // Backwards compatibility
  if (options.userSensitiveFields) {
    /* eslint-disable no-console */
    !process.env.TESTING && console.warn(`\nDEPRECATED: userSensitiveFields has been replaced by protectedFields allowing the ability to protect fields in all classes with CLP. \n`);
    /* eslint-enable no-console */

    const userSensitiveFields = Array.from(new Set([...(_defaults.default.userSensitiveFields || []), ...(options.userSensitiveFields || [])]));

    // If the options.protectedFields is unset,
    // it'll be assigned the default above.
    // Here, protect against the case where protectedFields
    // is set, but doesn't have _User.
    if (!('_User' in options.protectedFields)) {
      options.protectedFields = Object.assign({
        _User: []
      }, options.protectedFields);
    }
    options.protectedFields['_User']['*'] = Array.from(new Set([...(options.protectedFields['_User']['*'] || []), ...userSensitiveFields]));
  }

  // Merge protectedFields options with defaults.
  Object.keys(_defaults.default.protectedFields).forEach(c => {
    const cur = options.protectedFields[c];
    if (!cur) {
      options.protectedFields[c] = _defaults.default.protectedFields[c];
    } else {
      Object.keys(_defaults.default.protectedFields[c]).forEach(r => {
        if (options.protectedFields[c][r] && options.protectedFieldsOwnerExempt === false) {
          return;
        }
        const unq = new Set([...(options.protectedFields[c][r] || []), ..._defaults.default.protectedFields[c][r]]);
        options.protectedFields[c][r] = Array.from(unq);
      });
    }
  });
}

// Those can't be tested as it requires a subprocess
/* istanbul ignore next */
function configureListeners(parseServer) {
  const handleShutdown = function () {
    process.stdout.write('Termination signal received. Shutting down.');
    parseServer.handleShutdown();
  };
  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
}
var _default = exports.default = ParseServer;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfUXVlcnlUb29scyIsInJlcXVpcmUiLCJfZGVmYXVsdHMiLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsImxvZ2dpbmciLCJfQ29uZmlnIiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsIl9Qcm9taXNlUm91dGVyIiwiX3JlcXVpcmVkUGFyYW1ldGVyIiwiX0FuYWx5dGljc1JvdXRlciIsIl9DbGFzc2VzUm91dGVyIiwiX0ZlYXR1cmVzUm91dGVyIiwiX0ZpbGVzUm91dGVyIiwiX0Z1bmN0aW9uc1JvdXRlciIsIl9HbG9iYWxDb25maWdSb3V0ZXIiLCJfR3JhcGhRTFJvdXRlciIsIl9Ib29rc1JvdXRlciIsIl9JQVBWYWxpZGF0aW9uUm91dGVyIiwiX0luc3RhbGxhdGlvbnNSb3V0ZXIiLCJfTG9nc1JvdXRlciIsIl9QYXJzZUxpdmVRdWVyeVNlcnZlciIsIl9QYWdlc1JvdXRlciIsIl9QdXNoUm91dGVyIiwiX0Nsb3VkQ29kZVJvdXRlciIsIl9Sb2xlc1JvdXRlciIsIl9TY2hlbWFzUm91dGVyIiwiX1Nlc3Npb25zUm91dGVyIiwiX1VzZXJzUm91dGVyIiwiX1B1cmdlUm91dGVyIiwiX0F1ZGllbmNlc1JvdXRlciIsIl9BZ2dyZWdhdGVSb3V0ZXIiLCJfUGFyc2VTZXJ2ZXJSRVNUQ29udHJvbGxlciIsImNvbnRyb2xsZXJzIiwiX1BhcnNlR3JhcGhRTFNlcnZlciIsIl9TZWN1cml0eVJvdXRlciIsIl9DaGVja1J1bm5lciIsIl9EZXByZWNhdG9yIiwiX0RlZmluZWRTY2hlbWFzIiwiX0RlZmluaXRpb25zIiwiX1Rlc3RVdGlscyIsImUiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsInQiLCJXZWFrTWFwIiwiciIsIm4iLCJvIiwiaSIsImYiLCJfX3Byb3RvX18iLCJoYXMiLCJnZXQiLCJzZXQiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsImJhdGNoIiwiZXhwcmVzcyIsIm1pZGRsZXdhcmVzIiwiUGFyc2UiLCJwYXJzZSIsInBhdGgiLCJmcyIsImFkZFBhcnNlQ2xvdWQiLCJjb25uZWN0aW9ucyIsIkNvbm5lY3Rpb25zIiwiUGFyc2VTZXJ2ZXIiLCJjb25zdHJ1Y3RvciIsIm9wdGlvbnMiLCJEZXByZWNhdG9yIiwic2NhblBhcnNlU2VydmVyT3B0aW9ucyIsImludGVyZmFjZXMiLCJKU09OIiwic3RyaW5naWZ5IiwiT3B0aW9uc0RlZmluaXRpb25zIiwiZ2V0VmFsaWRPYmplY3QiLCJyb290IiwicmVzdWx0Iiwia2V5IiwicHJvdG90eXBlIiwidHlwZSIsImVuZHNXaXRoIiwic2xpY2UiLCJvcHRpb25zQmx1ZXByaW50IiwidmFsaWRhdGVLZXlOYW1lcyIsIm9yaWdpbmFsIiwicmVmIiwibmFtZSIsInByZWZpeCIsInB1c2giLCJyZXMiLCJBcnJheSIsImlzQXJyYXkiLCJmb3JFYWNoIiwiaXRlbSIsImlkeCIsImNvbmNhdCIsImRpZmYiLCJsZW5ndGgiLCJsb2dnZXIiLCJlcnJvciIsImpvaW4iLCJpbmplY3REZWZhdWx0cyIsImFwcElkIiwicmVxdWlyZWRQYXJhbWV0ZXIiLCJtYXN0ZXJLZXkiLCJqYXZhc2NyaXB0S2V5Iiwic2VydmVyVVJMIiwiaW5pdGlhbGl6ZSIsIkNvbmZpZyIsInZhbGlkYXRlT3B0aW9ucyIsImFsbENvbnRyb2xsZXJzIiwiZ2V0Q29udHJvbGxlcnMiLCJzdGF0ZSIsImNvbmZpZyIsInB1dCIsImFzc2lnbiIsIm1hc3RlcktleUlwc1N0b3JlIiwiTWFwIiwibWFpbnRlbmFuY2VLZXlJcHNTdG9yZSIsInJlYWRPbmx5TWFzdGVyS2V5SXBzU3RvcmUiLCJzZXRSZWdleFRpbWVvdXQiLCJsaXZlUXVlcnkiLCJyZWdleFRpbWVvdXQiLCJzZXRMb2dnZXIiLCJsb2dnZXJDb250cm9sbGVyIiwic3RhcnQiLCJkYXRhYmFzZUNvbnRyb2xsZXIiLCJob29rc0NvbnRyb2xsZXIiLCJjYWNoZUNvbnRyb2xsZXIiLCJjbG91ZCIsInNlY3VyaXR5Iiwic2NoZW1hIiwibGl2ZVF1ZXJ5Q29udHJvbGxlciIsInBlcmZvcm1Jbml0aWFsaXphdGlvbiIsImNvZGUiLCJFcnJvciIsIkRVUExJQ0FURV9WQUxVRSIsInB1c2hDb250cm9sbGVyIiwiZ2V0UHVzaENvbnRyb2xsZXIiLCJsb2FkIiwic3RhcnR1cFByb21pc2VzIiwibG9hZE1hc3RlcktleSIsIkRlZmluZWRTY2hlbWFzIiwiZXhlY3V0ZSIsImFkYXB0ZXIiLCJjb25uZWN0IiwiUHJvbWlzZSIsImFsbCIsInJlc29sdmUiLCJqc29uIiwicHJvY2VzcyIsImVudiIsIm5wbV9wYWNrYWdlX2pzb24iLCJucG1fcGFja2FnZV90eXBlIiwiY3dkIiwic2V0VGltZW91dCIsImVuYWJsZUNoZWNrIiwiZW5hYmxlQ2hlY2tMb2ciLCJDaGVja1J1bm5lciIsInJ1biIsImNvbnNvbGUiLCJhcHAiLCJfYXBwIiwiaGFuZGxlU2h1dGRvd24iLCJzZXJ2ZXJDbG9zZVByb21pc2UiLCJyZXNvbHZpbmdQcm9taXNlIiwibGl2ZVF1ZXJ5U2VydmVyQ2xvc2VQcm9taXNlIiwicHJvbWlzZXMiLCJzZXJ2ZXIiLCJjbG9zZSIsImxpdmVRdWVyeVNlcnZlciIsImRhdGFiYXNlQWRhcHRlciIsImZpbGVBZGFwdGVyIiwiZmlsZXNDb250cm9sbGVyIiwiY2FjaGVBZGFwdGVyIiwic2h1dGRvd24iLCJkZXN0cm95QWxsIiwic2VydmVyQ2xvc2VDb21wbGV0ZSIsImFwcGx5UmVxdWVzdENvbnRleHRNaWRkbGV3YXJlIiwiYXBpIiwicmVxdWVzdENvbnRleHRNaWRkbGV3YXJlIiwidXNlIiwibWF4VXBsb2FkU2l6ZSIsImRpcmVjdEFjY2VzcyIsInBhZ2VzIiwicmF0ZUxpbWl0IiwiYWxsb3dDcm9zc0RvbWFpbiIsImFsbG93RG91YmxlRm9yd2FyZFNsYXNoIiwiaGFuZGxlUGFyc2VBdXRoIiwiRmlsZXNSb3V0ZXIiLCJleHByZXNzUm91dGVyIiwiZW5mb3JjZVJvdXRlQWxsb3dMaXN0IiwiaGFuZGxlUGFyc2VIZWFsdGgiLCJ1cmxlbmNvZGVkIiwiZXh0ZW5kZWQiLCJQYWdlc1JvdXRlciIsInJlcSIsImlzIiwibGltaXQiLCJhbGxvd01ldGhvZE92ZXJyaWRlIiwiaGFuZGxlUGFyc2VIZWFkZXJzIiwicm91dGVzIiwicm91dGUiLCJhZGRSYXRlTGltaXQiLCJoYW5kbGVQYXJzZVNlc3Npb24iLCJhcHBSb3V0ZXIiLCJwcm9taXNlUm91dGVyIiwiaGFuZGxlUGFyc2VFcnJvcnMiLCJURVNUSU5HIiwib24iLCJlcnIiLCJzdGRlcnIiLCJ3cml0ZSIsInBvcnQiLCJleGl0IiwibWVzc2FnZSIsInN0YWNrIiwiUEFSU0VfU0VSVkVSX0VOQUJMRV9FWFBFUklNRU5UQUxfRElSRUNUX0FDQ0VTUyIsIkNvcmVNYW5hZ2VyIiwic2V0UkVTVENvbnRyb2xsZXIiLCJQYXJzZVNlcnZlclJFU1RDb250cm9sbGVyIiwicm91dGVycyIsIkNsYXNzZXNSb3V0ZXIiLCJVc2Vyc1JvdXRlciIsIlNlc3Npb25zUm91dGVyIiwiUm9sZXNSb3V0ZXIiLCJBbmFseXRpY3NSb3V0ZXIiLCJJbnN0YWxsYXRpb25zUm91dGVyIiwiRnVuY3Rpb25zUm91dGVyIiwiU2NoZW1hc1JvdXRlciIsIlB1c2hSb3V0ZXIiLCJMb2dzUm91dGVyIiwiRmVhdHVyZXNSb3V0ZXIiLCJHbG9iYWxDb25maWdSb3V0ZXIiLCJHcmFwaFFMUm91dGVyIiwiUHVyZ2VSb3V0ZXIiLCJIb29rc1JvdXRlciIsIkNsb3VkQ29kZVJvdXRlciIsIkF1ZGllbmNlc1JvdXRlciIsIkFnZ3JlZ2F0ZVJvdXRlciIsIlNlY3VyaXR5Um91dGVyIiwiZW5hYmxlUHJvZHVjdFB1cmNoYXNlTGVnYWN5QXBpIiwiSUFQVmFsaWRhdGlvblJvdXRlciIsInJlZHVjZSIsIm1lbW8iLCJyb3V0ZXIiLCJQcm9taXNlUm91dGVyIiwibW91bnRPbnRvIiwic3RhcnRBcHAiLCJtaWRkbGV3YXJlIiwibW91bnRQYXRoIiwibW91bnRHcmFwaFFMIiwibW91bnRQbGF5Z3JvdW5kIiwiZ3JhcGhRTEN1c3RvbVR5cGVEZWZzIiwidW5kZWZpbmVkIiwiZ3JhcGhRTFNjaGVtYSIsInJlYWRGaWxlU3luYyIsInBhcnNlR3JhcGhRTFNlcnZlciIsIlBhcnNlR3JhcGhRTFNlcnZlciIsImdyYXBoUUxQYXRoIiwicGxheWdyb3VuZFBhdGgiLCJhcHBseUdyYXBoUUwiLCJhcHBseVBsYXlncm91bmQiLCJnZXRMb2dnZXIiLCJ3YXJuIiwibGlzdGVuIiwiaG9zdCIsInRyYWNrIiwic3RhcnRMaXZlUXVlcnlTZXJ2ZXIiLCJsaXZlUXVlcnlTZXJ2ZXJPcHRpb25zIiwiY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyIiwidHJ1c3RQcm94eSIsImNvbmZpZ3VyZUxpc3RlbmVycyIsInZlcmlmeVNlcnZlclVybCIsImV4cHJlc3NBcHAiLCJwYXJzZVNlcnZlciIsImh0dHBTZXJ2ZXIiLCJjcmVhdGVTZXJ2ZXIiLCJQYXJzZUxpdmVRdWVyeVNlcnZlciIsImlzVmFsaWRIdHRwVXJsIiwic3RyaW5nIiwidXJsIiwiVVJMIiwicHJvdG9jb2wiLCJyZXBsYWNlIiwicmVxdWVzdCIsInJlc3BvbnNlIiwiY2F0Y2giLCJkYXRhIiwicmV0cnkiLCJoZWFkZXJzIiwic3RhdHVzIiwiUGFyc2VDbG91ZCIsImNvbmYiLCJhcHBsaWNhdGlvbklkIiwibmV3VmFsIiwiY29uZmlndXJhYmxlIiwiQ2xvdWQiLCJnbG9iYWwiLCJrZXlzIiwiZGVmYXVsdHMiLCJkYXRhYmFzZU9wdGlvbnMiLCJEYXRhYmFzZU9wdGlvbkRlZmF1bHRzIiwicmVnZXgiLCJtYXRjaCIsInVzZXJTZW5zaXRpdmVGaWVsZHMiLCJmcm9tIiwiU2V0IiwicHJvdGVjdGVkRmllbGRzIiwiX1VzZXIiLCJjIiwiY3VyIiwicHJvdGVjdGVkRmllbGRzT3duZXJFeGVtcHQiLCJ1bnEiLCJzdGRvdXQiLCJfZGVmYXVsdCIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi9zcmMvUGFyc2VTZXJ2ZXIudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gUGFyc2VTZXJ2ZXIgLSBvcGVuLXNvdXJjZSBjb21wYXRpYmxlIEFQSSBTZXJ2ZXIgZm9yIFBhcnNlIGFwcHNcblxudmFyIGJhdGNoID0gcmVxdWlyZSgnLi9iYXRjaCcpLFxuICBleHByZXNzID0gcmVxdWlyZSgnZXhwcmVzcycpLFxuICBtaWRkbGV3YXJlcyA9IHJlcXVpcmUoJy4vbWlkZGxld2FyZXMnKSxcbiAgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJykuUGFyc2UsXG4gIHsgcGFyc2UgfSA9IHJlcXVpcmUoJ2dyYXBocWwnKSxcbiAgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKSxcbiAgZnMgPSByZXF1aXJlKCdmcycpO1xuXG5pbXBvcnQgeyBQYXJzZVNlcnZlck9wdGlvbnMsIExpdmVRdWVyeVNlcnZlck9wdGlvbnMgfSBmcm9tICcuL09wdGlvbnMnO1xuaW1wb3J0IHsgc2V0UmVnZXhUaW1lb3V0IH0gZnJvbSAnLi9MaXZlUXVlcnkvUXVlcnlUb29scyc7XG5pbXBvcnQgZGVmYXVsdHMsIHsgRGF0YWJhc2VPcHRpb25EZWZhdWx0cyB9IGZyb20gJy4vZGVmYXVsdHMnO1xuaW1wb3J0ICogYXMgbG9nZ2luZyBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQgQ29uZmlnIGZyb20gJy4vQ29uZmlnJztcbmltcG9ydCBQcm9taXNlUm91dGVyIGZyb20gJy4vUHJvbWlzZVJvdXRlcic7XG5pbXBvcnQgcmVxdWlyZWRQYXJhbWV0ZXIgZnJvbSAnLi9yZXF1aXJlZFBhcmFtZXRlcic7XG5pbXBvcnQgeyBBbmFseXRpY3NSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvQW5hbHl0aWNzUm91dGVyJztcbmltcG9ydCB7IENsYXNzZXNSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvQ2xhc3Nlc1JvdXRlcic7XG5pbXBvcnQgeyBGZWF0dXJlc1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9GZWF0dXJlc1JvdXRlcic7XG5pbXBvcnQgeyBGaWxlc1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9GaWxlc1JvdXRlcic7XG5pbXBvcnQgeyBGdW5jdGlvbnNSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvRnVuY3Rpb25zUm91dGVyJztcbmltcG9ydCB7IEdsb2JhbENvbmZpZ1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9HbG9iYWxDb25maWdSb3V0ZXInO1xuaW1wb3J0IHsgR3JhcGhRTFJvdXRlciB9IGZyb20gJy4vUm91dGVycy9HcmFwaFFMUm91dGVyJztcbmltcG9ydCB7IEhvb2tzUm91dGVyIH0gZnJvbSAnLi9Sb3V0ZXJzL0hvb2tzUm91dGVyJztcbmltcG9ydCB7IElBUFZhbGlkYXRpb25Sb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvSUFQVmFsaWRhdGlvblJvdXRlcic7XG5pbXBvcnQgeyBJbnN0YWxsYXRpb25zUm91dGVyIH0gZnJvbSAnLi9Sb3V0ZXJzL0luc3RhbGxhdGlvbnNSb3V0ZXInO1xuaW1wb3J0IHsgTG9nc1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9Mb2dzUm91dGVyJztcbmltcG9ydCB7IFBhcnNlTGl2ZVF1ZXJ5U2VydmVyIH0gZnJvbSAnLi9MaXZlUXVlcnkvUGFyc2VMaXZlUXVlcnlTZXJ2ZXInO1xuaW1wb3J0IHsgUGFnZXNSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvUGFnZXNSb3V0ZXInO1xuaW1wb3J0IHsgUHVzaFJvdXRlciB9IGZyb20gJy4vUm91dGVycy9QdXNoUm91dGVyJztcbmltcG9ydCB7IENsb3VkQ29kZVJvdXRlciB9IGZyb20gJy4vUm91dGVycy9DbG91ZENvZGVSb3V0ZXInO1xuaW1wb3J0IHsgUm9sZXNSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvUm9sZXNSb3V0ZXInO1xuaW1wb3J0IHsgU2NoZW1hc1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9TY2hlbWFzUm91dGVyJztcbmltcG9ydCB7IFNlc3Npb25zUm91dGVyIH0gZnJvbSAnLi9Sb3V0ZXJzL1Nlc3Npb25zUm91dGVyJztcbmltcG9ydCB7IFVzZXJzUm91dGVyIH0gZnJvbSAnLi9Sb3V0ZXJzL1VzZXJzUm91dGVyJztcbmltcG9ydCB7IFB1cmdlUm91dGVyIH0gZnJvbSAnLi9Sb3V0ZXJzL1B1cmdlUm91dGVyJztcbmltcG9ydCB7IEF1ZGllbmNlc1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9BdWRpZW5jZXNSb3V0ZXInO1xuaW1wb3J0IHsgQWdncmVnYXRlUm91dGVyIH0gZnJvbSAnLi9Sb3V0ZXJzL0FnZ3JlZ2F0ZVJvdXRlcic7XG5pbXBvcnQgeyBQYXJzZVNlcnZlclJFU1RDb250cm9sbGVyIH0gZnJvbSAnLi9QYXJzZVNlcnZlclJFU1RDb250cm9sbGVyJztcbmltcG9ydCAqIGFzIGNvbnRyb2xsZXJzIGZyb20gJy4vQ29udHJvbGxlcnMnO1xuaW1wb3J0IHsgUGFyc2VHcmFwaFFMU2VydmVyIH0gZnJvbSAnLi9HcmFwaFFML1BhcnNlR3JhcGhRTFNlcnZlcic7XG5pbXBvcnQgeyBTZWN1cml0eVJvdXRlciB9IGZyb20gJy4vUm91dGVycy9TZWN1cml0eVJvdXRlcic7XG5pbXBvcnQgQ2hlY2tSdW5uZXIgZnJvbSAnLi9TZWN1cml0eS9DaGVja1J1bm5lcic7XG5pbXBvcnQgRGVwcmVjYXRvciBmcm9tICcuL0RlcHJlY2F0b3IvRGVwcmVjYXRvcic7XG5pbXBvcnQgeyBEZWZpbmVkU2NoZW1hcyB9IGZyb20gJy4vU2NoZW1hTWlncmF0aW9ucy9EZWZpbmVkU2NoZW1hcyc7XG5pbXBvcnQgT3B0aW9uc0RlZmluaXRpb25zIGZyb20gJy4vT3B0aW9ucy9EZWZpbml0aW9ucyc7XG5pbXBvcnQgeyByZXNvbHZpbmdQcm9taXNlLCBDb25uZWN0aW9ucyB9IGZyb20gJy4vVGVzdFV0aWxzJztcblxuLy8gTXV0YXRlIHRoZSBQYXJzZSBvYmplY3QgdG8gYWRkIHRoZSBDbG91ZCBDb2RlIGhhbmRsZXJzXG5hZGRQYXJzZUNsb3VkKCk7XG5cbi8vIFRyYWNrIGNvbm5lY3Rpb25zIHRvIGRlc3Ryb3kgdGhlbSBvbiBzaHV0ZG93blxuY29uc3QgY29ubmVjdGlvbnMgPSBuZXcgQ29ubmVjdGlvbnMoKTtcblxuLy8gUGFyc2VTZXJ2ZXIgd29ya3MgbGlrZSBhIGNvbnN0cnVjdG9yIG9mIGFuIGV4cHJlc3MgYXBwLlxuLy8gaHR0cHM6Ly9wYXJzZXBsYXRmb3JtLm9yZy9wYXJzZS1zZXJ2ZXIvYXBpL21hc3Rlci9QYXJzZVNlcnZlck9wdGlvbnMuaHRtbFxuY2xhc3MgUGFyc2VTZXJ2ZXIge1xuICBfYXBwOiBhbnk7XG4gIGNvbmZpZzogYW55O1xuICBzZXJ2ZXI6IGFueTtcbiAgZXhwcmVzc0FwcDogYW55O1xuICBsaXZlUXVlcnlTZXJ2ZXI6IGFueTtcbiAgLyoqXG4gICAqIEBjb25zdHJ1Y3RvclxuICAgKiBAcGFyYW0ge1BhcnNlU2VydmVyT3B0aW9uc30gb3B0aW9ucyB0aGUgcGFyc2Ugc2VydmVyIGluaXRpYWxpemF0aW9uIG9wdGlvbnNcbiAgICovXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFBhcnNlU2VydmVyT3B0aW9ucykge1xuICAgIC8vIFNjYW4gZm9yIGRlcHJlY2F0ZWQgUGFyc2UgU2VydmVyIG9wdGlvbnNcbiAgICBEZXByZWNhdG9yLnNjYW5QYXJzZVNlcnZlck9wdGlvbnMob3B0aW9ucyk7XG5cbiAgICBjb25zdCBpbnRlcmZhY2VzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShPcHRpb25zRGVmaW5pdGlvbnMpKTtcblxuICAgIGZ1bmN0aW9uIGdldFZhbGlkT2JqZWN0KHJvb3QpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHt9O1xuICAgICAgZm9yIChjb25zdCBrZXkgaW4gcm9vdCkge1xuICAgICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHJvb3Rba2V5XSwgJ3R5cGUnKSkge1xuICAgICAgICAgIGlmIChyb290W2tleV0udHlwZS5lbmRzV2l0aCgnW10nKSkge1xuICAgICAgICAgICAgcmVzdWx0W2tleV0gPSBbZ2V0VmFsaWRPYmplY3QoaW50ZXJmYWNlc1tyb290W2tleV0udHlwZS5zbGljZSgwLCAtMildKV07XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc3VsdFtrZXldID0gZ2V0VmFsaWRPYmplY3QoaW50ZXJmYWNlc1tyb290W2tleV0udHlwZV0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHRba2V5XSA9ICcnO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIGNvbnN0IG9wdGlvbnNCbHVlcHJpbnQgPSBnZXRWYWxpZE9iamVjdChpbnRlcmZhY2VzWydQYXJzZVNlcnZlck9wdGlvbnMnXSk7XG5cbiAgICBmdW5jdGlvbiB2YWxpZGF0ZUtleU5hbWVzKG9yaWdpbmFsLCByZWYsIG5hbWUgPSAnJykge1xuICAgICAgbGV0IHJlc3VsdCA9IFtdO1xuICAgICAgY29uc3QgcHJlZml4ID0gbmFtZSArIChuYW1lICE9PSAnJyA/ICcuJyA6ICcnKTtcbiAgICAgIGZvciAoY29uc3Qga2V5IGluIG9yaWdpbmFsKSB7XG4gICAgICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHJlZiwga2V5KSkge1xuICAgICAgICAgIHJlc3VsdC5wdXNoKHByZWZpeCArIGtleSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKHJlZltrZXldID09PSAnJykgeyBjb250aW51ZTsgfVxuICAgICAgICAgIGxldCByZXMgPSBbXTtcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShvcmlnaW5hbFtrZXldKSAmJiBBcnJheS5pc0FycmF5KHJlZltrZXldKSkge1xuICAgICAgICAgICAgY29uc3QgdHlwZSA9IHJlZltrZXldWzBdO1xuICAgICAgICAgICAgb3JpZ2luYWxba2V5XS5mb3JFYWNoKChpdGVtLCBpZHgpID0+IHtcbiAgICAgICAgICAgICAgaWYgKHR5cGVvZiBpdGVtID09PSAnb2JqZWN0JyAmJiBpdGVtICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgcmVzID0gcmVzLmNvbmNhdCh2YWxpZGF0ZUtleU5hbWVzKGl0ZW0sIHR5cGUsIHByZWZpeCArIGtleSArIGBbJHtpZHh9XWApKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2Ygb3JpZ2luYWxba2V5XSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHJlZltrZXldID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgcmVzID0gdmFsaWRhdGVLZXlOYW1lcyhvcmlnaW5hbFtrZXldLCByZWZba2V5XSwgcHJlZml4ICsga2V5KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmVzdWx0ID0gcmVzdWx0LmNvbmNhdChyZXMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIGNvbnN0IGRpZmYgPSB2YWxpZGF0ZUtleU5hbWVzKG9wdGlvbnMsIG9wdGlvbnNCbHVlcHJpbnQpO1xuICAgIGlmIChkaWZmLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGxvZ2dlciA9IChsb2dnaW5nIGFzIGFueSkubG9nZ2VyO1xuICAgICAgbG9nZ2VyLmVycm9yKGBJbnZhbGlkIGtleShzKSBmb3VuZCBpbiBQYXJzZSBTZXJ2ZXIgY29uZmlndXJhdGlvbjogJHtkaWZmLmpvaW4oJywgJyl9YCk7XG4gICAgfVxuXG4gICAgLy8gU2V0IG9wdGlvbiBkZWZhdWx0c1xuICAgIGluamVjdERlZmF1bHRzKG9wdGlvbnMpO1xuICAgIGNvbnN0IHtcbiAgICAgIGFwcElkID0gcmVxdWlyZWRQYXJhbWV0ZXIoJ1lvdSBtdXN0IHByb3ZpZGUgYW4gYXBwSWQhJyksXG4gICAgICBtYXN0ZXJLZXkgPSByZXF1aXJlZFBhcmFtZXRlcignWW91IG11c3QgcHJvdmlkZSBhIG1hc3RlcktleSEnKSxcbiAgICAgIGphdmFzY3JpcHRLZXksXG4gICAgICBzZXJ2ZXJVUkwgPSByZXF1aXJlZFBhcmFtZXRlcignWW91IG11c3QgcHJvdmlkZSBhIHNlcnZlclVSTCEnKSxcbiAgICB9ID0gb3B0aW9ucztcbiAgICAvLyBJbml0aWFsaXplIHRoZSBub2RlIGNsaWVudCBTREsgYXV0b21hdGljYWxseVxuICAgIFBhcnNlLmluaXRpYWxpemUoYXBwSWQsIGphdmFzY3JpcHRLZXkgfHwgJ3VudXNlZCcsIG1hc3RlcktleSk7XG4gICAgUGFyc2Uuc2VydmVyVVJMID0gc2VydmVyVVJMO1xuICAgIENvbmZpZy52YWxpZGF0ZU9wdGlvbnMob3B0aW9ucyk7XG4gICAgY29uc3QgYWxsQ29udHJvbGxlcnMgPSBjb250cm9sbGVycy5nZXRDb250cm9sbGVycyhvcHRpb25zKTtcblxuICAgIChvcHRpb25zIGFzIGFueSkuc3RhdGUgPSAnaW5pdGlhbGl6ZWQnO1xuICAgIHRoaXMuY29uZmlnID0gQ29uZmlnLnB1dChPYmplY3QuYXNzaWduKHt9LCBvcHRpb25zLCBhbGxDb250cm9sbGVycykpO1xuICAgIHRoaXMuY29uZmlnLm1hc3RlcktleUlwc1N0b3JlID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuY29uZmlnLm1haW50ZW5hbmNlS2V5SXBzU3RvcmUgPSBuZXcgTWFwKCk7XG4gICAgdGhpcy5jb25maWcucmVhZE9ubHlNYXN0ZXJLZXlJcHNTdG9yZSA9IG5ldyBNYXAoKTtcbiAgICBzZXRSZWdleFRpbWVvdXQob3B0aW9ucy5saXZlUXVlcnk/LnJlZ2V4VGltZW91dCk7XG4gICAgbG9nZ2luZy5zZXRMb2dnZXIoYWxsQ29udHJvbGxlcnMubG9nZ2VyQ29udHJvbGxlcik7XG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIFBhcnNlIFNlcnZlciBhcyBhbiBleHByZXNzIGFwcDsgdGhpcyBwcm9taXNlIHJlc29sdmVzIHdoZW4gUGFyc2UgU2VydmVyIGlzIHJlYWR5IHRvIGFjY2VwdCByZXF1ZXN0cy5cbiAgICovXG5cbiAgYXN5bmMgc3RhcnQoKTogUHJvbWlzZTx0aGlzPiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLmNvbmZpZy5zdGF0ZSA9PT0gJ29rJykge1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgIH1cbiAgICAgIHRoaXMuY29uZmlnLnN0YXRlID0gJ3N0YXJ0aW5nJztcbiAgICAgIENvbmZpZy5wdXQodGhpcy5jb25maWcpO1xuICAgICAgY29uc3Qge1xuICAgICAgICBkYXRhYmFzZUNvbnRyb2xsZXIsXG4gICAgICAgIGhvb2tzQ29udHJvbGxlcixcbiAgICAgICAgY2FjaGVDb250cm9sbGVyLFxuICAgICAgICBjbG91ZCxcbiAgICAgICAgc2VjdXJpdHksXG4gICAgICAgIHNjaGVtYSxcbiAgICAgICAgbGl2ZVF1ZXJ5Q29udHJvbGxlcixcbiAgICAgIH0gPSB0aGlzLmNvbmZpZztcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGRhdGFiYXNlQ29udHJvbGxlci5wZXJmb3JtSW5pdGlhbGl6YXRpb24oKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgaWYgKGUuY29kZSAhPT0gUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFKSB7XG4gICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3QgcHVzaENvbnRyb2xsZXIgPSBhd2FpdCBjb250cm9sbGVycy5nZXRQdXNoQ29udHJvbGxlcih0aGlzLmNvbmZpZyk7XG4gICAgICBhd2FpdCBob29rc0NvbnRyb2xsZXIubG9hZCgpO1xuICAgICAgY29uc3Qgc3RhcnR1cFByb21pc2VzID0gW3RoaXMuY29uZmlnLmxvYWRNYXN0ZXJLZXk/LigpXTtcbiAgICAgIGlmIChzY2hlbWEpIHtcbiAgICAgICAgc3RhcnR1cFByb21pc2VzLnB1c2gobmV3IERlZmluZWRTY2hlbWFzKHNjaGVtYSwgdGhpcy5jb25maWcpLmV4ZWN1dGUoKSk7XG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIGNhY2hlQ29udHJvbGxlci5hZGFwdGVyPy5jb25uZWN0ICYmXG4gICAgICAgIHR5cGVvZiBjYWNoZUNvbnRyb2xsZXIuYWRhcHRlci5jb25uZWN0ID09PSAnZnVuY3Rpb24nXG4gICAgICApIHtcbiAgICAgICAgc3RhcnR1cFByb21pc2VzLnB1c2goY2FjaGVDb250cm9sbGVyLmFkYXB0ZXIuY29ubmVjdCgpKTtcbiAgICAgIH1cbiAgICAgIHN0YXJ0dXBQcm9taXNlcy5wdXNoKGxpdmVRdWVyeUNvbnRyb2xsZXIuY29ubmVjdCgpKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKHN0YXJ0dXBQcm9taXNlcyk7XG4gICAgICBpZiAoY2xvdWQpIHtcbiAgICAgICAgYWRkUGFyc2VDbG91ZCgpO1xuICAgICAgICBpZiAodHlwZW9mIGNsb3VkID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgYXdhaXQgUHJvbWlzZS5yZXNvbHZlKGNsb3VkKFBhcnNlKSk7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGNsb3VkID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIGxldCBqc29uO1xuICAgICAgICAgIGlmIChwcm9jZXNzLmVudi5ucG1fcGFja2FnZV9qc29uKSB7XG4gICAgICAgICAgICBqc29uID0gcmVxdWlyZShwcm9jZXNzLmVudi5ucG1fcGFja2FnZV9qc29uKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHByb2Nlc3MuZW52Lm5wbV9wYWNrYWdlX3R5cGUgPT09ICdtb2R1bGUnIHx8IGpzb24/LnR5cGUgPT09ICdtb2R1bGUnKSB7XG4gICAgICAgICAgICBhd2FpdCBpbXBvcnQocGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIGNsb3VkKSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcXVpcmUocGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIGNsb3VkKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IFwiYXJndW1lbnQgJ2Nsb3VkJyBtdXN0IGVpdGhlciBiZSBhIHN0cmluZyBvciBhIGZ1bmN0aW9uXCI7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwKSk7XG4gICAgICB9XG4gICAgICBpZiAoc2VjdXJpdHkgJiYgc2VjdXJpdHkuZW5hYmxlQ2hlY2sgJiYgc2VjdXJpdHkuZW5hYmxlQ2hlY2tMb2cpIHtcbiAgICAgICAgbmV3IENoZWNrUnVubmVyKHNlY3VyaXR5KS5ydW4oKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuY29uZmlnLnN0YXRlID0gJ29rJztcbiAgICAgIHRoaXMuY29uZmlnID0geyAuLi50aGlzLmNvbmZpZywgLi4ucHVzaENvbnRyb2xsZXIgfTtcbiAgICAgIENvbmZpZy5wdXQodGhpcy5jb25maWcpO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgIHRoaXMuY29uZmlnLnN0YXRlID0gJ2Vycm9yJztcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIGdldCBhcHAoKSB7XG4gICAgaWYgKCF0aGlzLl9hcHApIHtcbiAgICAgIHRoaXMuX2FwcCA9IFBhcnNlU2VydmVyLmFwcCh0aGlzLmNvbmZpZyk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9hcHA7XG4gIH1cblxuICAvKipcbiAgICogU3RvcHMgdGhlIHBhcnNlIHNlcnZlciwgY2FuY2VscyBhbnkgb25nb2luZyByZXF1ZXN0cyBhbmQgY2xvc2VzIGFsbCBjb25uZWN0aW9ucy5cbiAgICpcbiAgICogQ3VycmVudGx5LCBleHByZXNzIGRvZXNuJ3Qgc2h1dCBkb3duIGltbWVkaWF0ZWx5IGFmdGVyIHJlY2VpdmluZyBTSUdJTlQvU0lHVEVSTVxuICAgKiBpZiBpdCBoYXMgY2xpZW50IGNvbm5lY3Rpb25zIHRoYXQgaGF2ZW4ndCB0aW1lZCBvdXQuXG4gICAqIChUaGlzIGlzIGEga25vd24gaXNzdWUgd2l0aCBub2RlIC0gaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL2lzc3Vlcy8yNjQyKVxuICAgKlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgc2VydmVyIGlzIHN0b3BwZWRcbiAgICovXG4gIGFzeW5jIGhhbmRsZVNodXRkb3duKCkge1xuICAgIGNvbnN0IHNlcnZlckNsb3NlUHJvbWlzZSA9IHJlc29sdmluZ1Byb21pc2UoKTtcbiAgICBjb25zdCBsaXZlUXVlcnlTZXJ2ZXJDbG9zZVByb21pc2UgPSByZXNvbHZpbmdQcm9taXNlKCk7XG4gICAgY29uc3QgcHJvbWlzZXMgPSBbXTtcbiAgICB0aGlzLnNlcnZlci5jbG9zZSgoZXJyb3IpID0+IHtcbiAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igd2hpbGUgY2xvc2luZyBwYXJzZSBzZXJ2ZXInLCBlcnJvcik7XG4gICAgICB9XG4gICAgICBzZXJ2ZXJDbG9zZVByb21pc2UucmVzb2x2ZSgpO1xuICAgIH0pO1xuICAgIGlmICh0aGlzLmxpdmVRdWVyeVNlcnZlcj8uc2VydmVyPy5jbG9zZSAmJiB0aGlzLmxpdmVRdWVyeVNlcnZlci5zZXJ2ZXIgIT09IHRoaXMuc2VydmVyKSB7XG4gICAgICB0aGlzLmxpdmVRdWVyeVNlcnZlci5zZXJ2ZXIuY2xvc2UoKGVycm9yKSA9PiB7XG4gICAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igd2hpbGUgY2xvc2luZyBsaXZlIHF1ZXJ5IHNlcnZlcicsIGVycm9yKTtcbiAgICAgICAgfVxuICAgICAgICBsaXZlUXVlcnlTZXJ2ZXJDbG9zZVByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpdmVRdWVyeVNlcnZlckNsb3NlUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICAgIGNvbnN0IHsgYWRhcHRlcjogZGF0YWJhc2VBZGFwdGVyIH0gPSB0aGlzLmNvbmZpZy5kYXRhYmFzZUNvbnRyb2xsZXI7XG4gICAgaWYgKGRhdGFiYXNlQWRhcHRlciAmJiB0eXBlb2YgZGF0YWJhc2VBZGFwdGVyLmhhbmRsZVNodXRkb3duID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBwcm9taXNlcy5wdXNoKGRhdGFiYXNlQWRhcHRlci5oYW5kbGVTaHV0ZG93bigpKTtcbiAgICB9XG4gICAgY29uc3QgeyBhZGFwdGVyOiBmaWxlQWRhcHRlciB9ID0gdGhpcy5jb25maWcuZmlsZXNDb250cm9sbGVyO1xuICAgIGlmIChmaWxlQWRhcHRlciAmJiB0eXBlb2YgZmlsZUFkYXB0ZXIuaGFuZGxlU2h1dGRvd24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHByb21pc2VzLnB1c2goZmlsZUFkYXB0ZXIuaGFuZGxlU2h1dGRvd24oKSk7XG4gICAgfVxuICAgIGNvbnN0IHsgYWRhcHRlcjogY2FjaGVBZGFwdGVyIH0gPSB0aGlzLmNvbmZpZy5jYWNoZUNvbnRyb2xsZXI7XG4gICAgaWYgKGNhY2hlQWRhcHRlciAmJiB0eXBlb2YgY2FjaGVBZGFwdGVyLmhhbmRsZVNodXRkb3duID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBwcm9taXNlcy5wdXNoKGNhY2hlQWRhcHRlci5oYW5kbGVTaHV0ZG93bigpKTtcbiAgICB9XG4gICAgaWYgKHRoaXMubGl2ZVF1ZXJ5U2VydmVyKSB7XG4gICAgICBwcm9taXNlcy5wdXNoKHRoaXMubGl2ZVF1ZXJ5U2VydmVyLnNodXRkb3duKCkpO1xuICAgIH1cbiAgICBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgY29ubmVjdGlvbnMuZGVzdHJveUFsbCgpO1xuICAgIGF3YWl0IFByb21pc2UuYWxsKFtzZXJ2ZXJDbG9zZVByb21pc2UsIGxpdmVRdWVyeVNlcnZlckNsb3NlUHJvbWlzZV0pO1xuICAgIGlmICh0aGlzLmNvbmZpZy5zZXJ2ZXJDbG9zZUNvbXBsZXRlKSB7XG4gICAgICB0aGlzLmNvbmZpZy5zZXJ2ZXJDbG9zZUNvbXBsZXRlKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEBzdGF0aWNcbiAgICogQWxsb3cgZGV2ZWxvcGVycyB0byBjdXN0b21pemUgZWFjaCByZXF1ZXN0IHdpdGggaW52ZXJzaW9uIG9mIGNvbnRyb2wvZGVwZW5kZW5jeSBpbmplY3Rpb25cbiAgICovXG4gIHN0YXRpYyBhcHBseVJlcXVlc3RDb250ZXh0TWlkZGxld2FyZShhcGksIG9wdGlvbnMpIHtcbiAgICBpZiAob3B0aW9ucy5yZXF1ZXN0Q29udGV4dE1pZGRsZXdhcmUpIHtcbiAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5yZXF1ZXN0Q29udGV4dE1pZGRsZXdhcmUgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdyZXF1ZXN0Q29udGV4dE1pZGRsZXdhcmUgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gICAgICB9XG4gICAgICBhcGkudXNlKG9wdGlvbnMucmVxdWVzdENvbnRleHRNaWRkbGV3YXJlKTtcbiAgICB9XG4gIH1cbiAgLyoqXG4gICAqIEBzdGF0aWNcbiAgICogQ3JlYXRlIGFuIGV4cHJlc3MgYXBwIGZvciB0aGUgcGFyc2Ugc2VydmVyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIGxldCB5b3Ugc3BlY2lmeSB0aGUgbWF4VXBsb2FkU2l6ZSB3aGVuIGNyZWF0aW5nIHRoZSBleHByZXNzIGFwcCAgKi9cbiAgc3RhdGljIGFwcChvcHRpb25zKSB7XG4gICAgY29uc3Qge1xuICAgICAgbWF4VXBsb2FkU2l6ZSA9ICcyMG1iJyxcbiAgICAgIGFwcElkLFxuICAgICAgZGlyZWN0QWNjZXNzLFxuICAgICAgcGFnZXMsXG4gICAgICByYXRlTGltaXQgPSBbXSxcbiAgICB9ID0gb3B0aW9ucztcbiAgICAvLyBUaGlzIGFwcCBzZXJ2ZXMgdGhlIFBhcnNlIEFQSSBkaXJlY3RseS5cbiAgICAvLyBJdCdzIHRoZSBlcXVpdmFsZW50IG9mIGh0dHBzOi8vYXBpLnBhcnNlLmNvbS8xIGluIHRoZSBob3N0ZWQgUGFyc2UgQVBJLlxuICAgIHZhciBhcGkgPSBleHByZXNzKCk7XG4gICAgLy9hcGkudXNlKFwiL2FwcHNcIiwgZXhwcmVzcy5zdGF0aWMoX19kaXJuYW1lICsgXCIvcHVibGljXCIpKTtcbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmFsbG93Q3Jvc3NEb21haW4oYXBwSWQpKTtcbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmFsbG93RG91YmxlRm9yd2FyZFNsYXNoKTtcbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmhhbmRsZVBhcnNlQXV0aChhcHBJZCkpO1xuICAgIC8vIEZpbGUgaGFuZGxpbmcgbmVlZHMgdG8gYmUgYmVmb3JlIHRoZSBkZWZhdWx0IEpTT04gYm9keSBwYXJzZXIgYmVjYXVzZSBmaWxlXG4gICAgLy8gdXBsb2FkcyBzZW5kIGJpbmFyeSBkYXRhIHRoYXQgc2hvdWxkIG5vdCBiZSBwYXJzZWQgYXMgSlNPTi5cbiAgICBhcGkudXNlKFxuICAgICAgJy8nLFxuICAgICAgbmV3IEZpbGVzUm91dGVyKCkuZXhwcmVzc1JvdXRlcih7XG4gICAgICAgIG1heFVwbG9hZFNpemU6IG1heFVwbG9hZFNpemUsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICBhcGkudXNlKCcvaGVhbHRoJywgbWlkZGxld2FyZXMuZW5mb3JjZVJvdXRlQWxsb3dMaXN0LCBtaWRkbGV3YXJlcy5oYW5kbGVQYXJzZUhlYWx0aChvcHRpb25zKSk7XG5cbiAgICBhcGkudXNlKFxuICAgICAgJy8nLFxuICAgICAgZXhwcmVzcy51cmxlbmNvZGVkKHsgZXh0ZW5kZWQ6IGZhbHNlIH0pLFxuICAgICAgbmV3IFBhZ2VzUm91dGVyKHBhZ2VzKS5leHByZXNzUm91dGVyKClcbiAgICApO1xuXG4gICAgYXBpLnVzZShleHByZXNzLmpzb24oeyB0eXBlOiByZXEgPT4gIXJlcS5pcygnbXVsdGlwYXJ0L2Zvcm0tZGF0YScpLCBsaW1pdDogbWF4VXBsb2FkU2l6ZSB9KSk7XG4gICAgYXBpLnVzZShtaWRkbGV3YXJlcy5hbGxvd01ldGhvZE92ZXJyaWRlKTtcbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmhhbmRsZVBhcnNlSGVhZGVycyk7XG4gICAgYXBpLnVzZShtaWRkbGV3YXJlcy5lbmZvcmNlUm91dGVBbGxvd0xpc3QpO1xuICAgIGFwaS5zZXQoJ3F1ZXJ5IHBhcnNlcicsICdleHRlbmRlZCcpO1xuICAgIGNvbnN0IHJvdXRlcyA9IEFycmF5LmlzQXJyYXkocmF0ZUxpbWl0KSA/IHJhdGVMaW1pdCA6IFtyYXRlTGltaXRdO1xuICAgIGZvciAoY29uc3Qgcm91dGUgb2Ygcm91dGVzKSB7XG4gICAgICBtaWRkbGV3YXJlcy5hZGRSYXRlTGltaXQocm91dGUsIG9wdGlvbnMpO1xuICAgIH1cbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmhhbmRsZVBhcnNlU2Vzc2lvbik7XG4gICAgdGhpcy5hcHBseVJlcXVlc3RDb250ZXh0TWlkZGxld2FyZShhcGksIG9wdGlvbnMpO1xuICAgIGNvbnN0IGFwcFJvdXRlciA9IFBhcnNlU2VydmVyLnByb21pc2VSb3V0ZXIoeyBhcHBJZCwgb3B0aW9ucyB9KTtcbiAgICBhcGkudXNlKGFwcFJvdXRlci5leHByZXNzUm91dGVyKCkpO1xuXG4gICAgYXBpLnVzZShtaWRkbGV3YXJlcy5oYW5kbGVQYXJzZUVycm9ycyk7XG5cbiAgICAvLyBydW4gdGhlIGZvbGxvd2luZyB3aGVuIG5vdCB0ZXN0aW5nXG4gICAgaWYgKCFwcm9jZXNzLmVudi5URVNUSU5HKSB7XG4gICAgICAvL1RoaXMgY2F1c2VzIHRlc3RzIHRvIHNwZXcgc29tZSB1c2VsZXNzIHdhcm5pbmdzLCBzbyBkaXNhYmxlIGluIHRlc3RcbiAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgICBwcm9jZXNzLm9uKCd1bmNhdWdodEV4Y2VwdGlvbicsIChlcnI6IGFueSkgPT4ge1xuICAgICAgICBpZiAoZXJyLmNvZGUgPT09ICdFQUREUklOVVNFJykge1xuICAgICAgICAgIC8vIHVzZXItZnJpZW5kbHkgbWVzc2FnZSBmb3IgdGhpcyBjb21tb24gZXJyb3JcbiAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgVW5hYmxlIHRvIGxpc3RlbiBvbiBwb3J0ICR7ZXJyLnBvcnR9LiBUaGUgcG9ydCBpcyBhbHJlYWR5IGluIHVzZS5gKTtcbiAgICAgICAgICBwcm9jZXNzLmV4aXQoMCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKGVyci5tZXNzYWdlKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZSgnQW4gdW5jYXVnaHQgZXhjZXB0aW9uIG9jY3VycmVkOiAnICsgZXJyLm1lc3NhZ2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZXJyLnN0YWNrKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZSgnU3RhY2sgVHJhY2U6XFxuJyArIGVyci5zdGFjayk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGVycik7XG4gICAgICAgICAgfVxuICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChwcm9jZXNzLmVudi5QQVJTRV9TRVJWRVJfRU5BQkxFX0VYUEVSSU1FTlRBTF9ESVJFQ1RfQUNDRVNTID09PSAnMScgfHwgZGlyZWN0QWNjZXNzKSB7XG4gICAgICBQYXJzZS5Db3JlTWFuYWdlci5zZXRSRVNUQ29udHJvbGxlcihQYXJzZVNlcnZlclJFU1RDb250cm9sbGVyKGFwcElkLCBhcHBSb3V0ZXIpKTtcbiAgICB9XG4gICAgcmV0dXJuIGFwaTtcbiAgfVxuXG4gIHN0YXRpYyBwcm9taXNlUm91dGVyKHsgYXBwSWQsIG9wdGlvbnMgfSkge1xuICAgIGNvbnN0IHJvdXRlcnMgPSBbXG4gICAgICBuZXcgQ2xhc3Nlc1JvdXRlcigpLFxuICAgICAgbmV3IFVzZXJzUm91dGVyKCksXG4gICAgICBuZXcgU2Vzc2lvbnNSb3V0ZXIoKSxcbiAgICAgIG5ldyBSb2xlc1JvdXRlcigpLFxuICAgICAgbmV3IEFuYWx5dGljc1JvdXRlcigpLFxuICAgICAgbmV3IEluc3RhbGxhdGlvbnNSb3V0ZXIoKSxcbiAgICAgIG5ldyBGdW5jdGlvbnNSb3V0ZXIoKSxcbiAgICAgIG5ldyBTY2hlbWFzUm91dGVyKCksXG4gICAgICBuZXcgUHVzaFJvdXRlcigpLFxuICAgICAgbmV3IExvZ3NSb3V0ZXIoKSxcbiAgICAgIG5ldyBGZWF0dXJlc1JvdXRlcigpLFxuICAgICAgbmV3IEdsb2JhbENvbmZpZ1JvdXRlcigpLFxuICAgICAgbmV3IEdyYXBoUUxSb3V0ZXIoKSxcbiAgICAgIG5ldyBQdXJnZVJvdXRlcigpLFxuICAgICAgbmV3IEhvb2tzUm91dGVyKCksXG4gICAgICBuZXcgQ2xvdWRDb2RlUm91dGVyKCksXG4gICAgICBuZXcgQXVkaWVuY2VzUm91dGVyKCksXG4gICAgICBuZXcgQWdncmVnYXRlUm91dGVyKCksXG4gICAgICBuZXcgU2VjdXJpdHlSb3V0ZXIoKSxcbiAgICBdO1xuXG4gICAgaWYgKG9wdGlvbnM/LmVuYWJsZVByb2R1Y3RQdXJjaGFzZUxlZ2FjeUFwaSAhPT0gZmFsc2UpIHtcbiAgICAgIHJvdXRlcnMucHVzaChuZXcgSUFQVmFsaWRhdGlvblJvdXRlcigpKTtcbiAgICB9XG5cbiAgICBjb25zdCByb3V0ZXMgPSByb3V0ZXJzLnJlZHVjZSgobWVtbywgcm91dGVyKSA9PiB7XG4gICAgICByZXR1cm4gbWVtby5jb25jYXQocm91dGVyLnJvdXRlcyk7XG4gICAgfSwgW10pO1xuXG4gICAgY29uc3QgYXBwUm91dGVyID0gbmV3IFByb21pc2VSb3V0ZXIocm91dGVzLCBhcHBJZCk7XG5cbiAgICBiYXRjaC5tb3VudE9udG8oYXBwUm91dGVyKTtcbiAgICByZXR1cm4gYXBwUm91dGVyO1xuICB9XG5cbiAgLyoqXG4gICAqIHN0YXJ0cyB0aGUgcGFyc2Ugc2VydmVyJ3MgZXhwcmVzcyBhcHBcbiAgICogQHBhcmFtIHtQYXJzZVNlcnZlck9wdGlvbnN9IG9wdGlvbnMgdG8gdXNlIHRvIHN0YXJ0IHRoZSBzZXJ2ZXJcbiAgICogQHJldHVybnMge1BhcnNlU2VydmVyfSB0aGUgcGFyc2Ugc2VydmVyIGluc3RhbmNlXG4gICAqL1xuXG4gIGFzeW5jIHN0YXJ0QXBwKG9wdGlvbnM6IFBhcnNlU2VydmVyT3B0aW9ucykge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnN0YXJ0KCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIG9uIFBhcnNlU2VydmVyLnN0YXJ0QXBwOiAnLCBlKTtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICAgIGNvbnN0IGFwcCA9IGV4cHJlc3MoKTtcbiAgICBpZiAob3B0aW9ucy5taWRkbGV3YXJlKSB7XG4gICAgICBsZXQgbWlkZGxld2FyZTtcbiAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5taWRkbGV3YXJlID09ICdzdHJpbmcnKSB7XG4gICAgICAgIG1pZGRsZXdhcmUgPSByZXF1aXJlKHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBvcHRpb25zLm1pZGRsZXdhcmUpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1pZGRsZXdhcmUgPSBvcHRpb25zLm1pZGRsZXdhcmU7IC8vIHVzZSBhcy1pcyBsZXQgZXhwcmVzcyBmYWlsXG4gICAgICB9XG4gICAgICBhcHAudXNlKG1pZGRsZXdhcmUpO1xuICAgIH1cbiAgICBhcHAudXNlKG9wdGlvbnMubW91bnRQYXRoLCB0aGlzLmFwcCk7XG5cbiAgICBpZiAob3B0aW9ucy5tb3VudEdyYXBoUUwgPT09IHRydWUgfHwgb3B0aW9ucy5tb3VudFBsYXlncm91bmQgPT09IHRydWUpIHtcbiAgICAgIGxldCBncmFwaFFMQ3VzdG9tVHlwZURlZnMgPSB1bmRlZmluZWQ7XG4gICAgICBpZiAodHlwZW9mIG9wdGlvbnMuZ3JhcGhRTFNjaGVtYSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgZ3JhcGhRTEN1c3RvbVR5cGVEZWZzID0gcGFyc2UoZnMucmVhZEZpbGVTeW5jKG9wdGlvbnMuZ3JhcGhRTFNjaGVtYSwgJ3V0ZjgnKSk7XG4gICAgICB9IGVsc2UgaWYgKFxuICAgICAgICB0eXBlb2Ygb3B0aW9ucy5ncmFwaFFMU2NoZW1hID09PSAnb2JqZWN0JyB8fFxuICAgICAgICB0eXBlb2Ygb3B0aW9ucy5ncmFwaFFMU2NoZW1hID09PSAnZnVuY3Rpb24nXG4gICAgICApIHtcbiAgICAgICAgZ3JhcGhRTEN1c3RvbVR5cGVEZWZzID0gb3B0aW9ucy5ncmFwaFFMU2NoZW1hO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJzZUdyYXBoUUxTZXJ2ZXIgPSBuZXcgUGFyc2VHcmFwaFFMU2VydmVyKHRoaXMsIHtcbiAgICAgICAgZ3JhcGhRTFBhdGg6IG9wdGlvbnMuZ3JhcGhRTFBhdGgsXG4gICAgICAgIHBsYXlncm91bmRQYXRoOiBvcHRpb25zLnBsYXlncm91bmRQYXRoLFxuICAgICAgICBncmFwaFFMQ3VzdG9tVHlwZURlZnMsXG4gICAgICB9KTtcblxuICAgICAgaWYgKG9wdGlvbnMubW91bnRHcmFwaFFMKSB7XG4gICAgICAgIHBhcnNlR3JhcGhRTFNlcnZlci5hcHBseUdyYXBoUUwoYXBwKTtcbiAgICAgIH1cblxuICAgICAgaWYgKG9wdGlvbnMubW91bnRQbGF5Z3JvdW5kKSB7XG4gICAgICAgIHBhcnNlR3JhcGhRTFNlcnZlci5hcHBseVBsYXlncm91bmQoYXBwKTtcbiAgICAgICAgbG9nZ2luZy5nZXRMb2dnZXIoKS53YXJuKFxuICAgICAgICAgICdHcmFwaFFMIFBsYXlncm91bmQgaXMgZGVwcmVjYXRlZCBhbmQgd2lsbCBiZSByZW1vdmVkIGluIGEgZnV0dXJlIHZlcnNpb24uIEl0IGV4cG9zZXMgdGhlIG1hc3RlciBrZXkgaW4gdGhlIGJyb3dzZXIuIFVzZSBQYXJzZSBEYXNoYm9hcmQgYXMgR3JhcGhRTCBJREUgb3IgY29uZmlndXJlIGEgdGhpcmQtcGFydHkgR3JhcGhRTCBjbGllbnQgd2l0aCBjdXN0b20gcmVxdWVzdCBoZWFkZXJzLidcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgc2VydmVyID0gYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgICBhcHAubGlzdGVuKG9wdGlvbnMucG9ydCwgb3B0aW9ucy5ob3N0LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJlc29sdmUodGhpcyk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICB0aGlzLnNlcnZlciA9IHNlcnZlcjtcbiAgICBjb25uZWN0aW9ucy50cmFjayhzZXJ2ZXIpO1xuXG4gICAgaWYgKG9wdGlvbnMuc3RhcnRMaXZlUXVlcnlTZXJ2ZXIgfHwgb3B0aW9ucy5saXZlUXVlcnlTZXJ2ZXJPcHRpb25zKSB7XG4gICAgICB0aGlzLmxpdmVRdWVyeVNlcnZlciA9IGF3YWl0IFBhcnNlU2VydmVyLmNyZWF0ZUxpdmVRdWVyeVNlcnZlcihcbiAgICAgICAgc2VydmVyLFxuICAgICAgICBvcHRpb25zLmxpdmVRdWVyeVNlcnZlck9wdGlvbnMsXG4gICAgICAgIG9wdGlvbnNcbiAgICAgICk7XG4gICAgICBpZiAodGhpcy5saXZlUXVlcnlTZXJ2ZXIuc2VydmVyICE9PSB0aGlzLnNlcnZlcikge1xuICAgICAgICBjb25uZWN0aW9ucy50cmFjayh0aGlzLmxpdmVRdWVyeVNlcnZlci5zZXJ2ZXIpO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob3B0aW9ucy50cnVzdFByb3h5KSB7XG4gICAgICBhcHAuc2V0KCd0cnVzdCBwcm94eScsIG9wdGlvbnMudHJ1c3RQcm94eSk7XG4gICAgfVxuICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgaWYgKCFwcm9jZXNzLmVudi5URVNUSU5HKSB7XG4gICAgICBjb25maWd1cmVMaXN0ZW5lcnModGhpcyk7XG4gICAgICBpZiAob3B0aW9ucy52ZXJpZnlTZXJ2ZXJVcmwgIT09IGZhbHNlKSB7XG4gICAgICAgIGF3YWl0IFBhcnNlU2VydmVyLnZlcmlmeVNlcnZlclVybCgpO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmV4cHJlc3NBcHAgPSBhcHA7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBQYXJzZVNlcnZlciBhbmQgc3RhcnRzIGl0LlxuICAgKiBAcGFyYW0ge1BhcnNlU2VydmVyT3B0aW9uc30gb3B0aW9ucyB1c2VkIHRvIHN0YXJ0IHRoZSBzZXJ2ZXJcbiAgICogQHJldHVybnMge1BhcnNlU2VydmVyfSB0aGUgcGFyc2Ugc2VydmVyIGluc3RhbmNlXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgc3RhcnRBcHAob3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zKSB7XG4gICAgY29uc3QgcGFyc2VTZXJ2ZXIgPSBuZXcgUGFyc2VTZXJ2ZXIob3B0aW9ucyk7XG4gICAgcmV0dXJuIHBhcnNlU2VydmVyLnN0YXJ0QXBwKG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEhlbHBlciBtZXRob2QgdG8gY3JlYXRlIGEgbGl2ZVF1ZXJ5IHNlcnZlclxuICAgKiBAc3RhdGljXG4gICAqIEBwYXJhbSB7U2VydmVyfSBodHRwU2VydmVyIGFuIG9wdGlvbmFsIGh0dHAgc2VydmVyIHRvIHBhc3NcbiAgICogQHBhcmFtIHtMaXZlUXVlcnlTZXJ2ZXJPcHRpb25zfSBjb25maWcgb3B0aW9ucyBmb3IgdGhlIGxpdmVRdWVyeVNlcnZlclxuICAgKiBAcGFyYW0ge1BhcnNlU2VydmVyT3B0aW9uc30gb3B0aW9ucyBvcHRpb25zIGZvciB0aGUgUGFyc2VTZXJ2ZXJcbiAgICogQHJldHVybnMge1Byb21pc2U8UGFyc2VMaXZlUXVlcnlTZXJ2ZXI+fSB0aGUgbGl2ZSBxdWVyeSBzZXJ2ZXIgaW5zdGFuY2VcbiAgICovXG4gIHN0YXRpYyBhc3luYyBjcmVhdGVMaXZlUXVlcnlTZXJ2ZXIoXG4gICAgaHR0cFNlcnZlcixcbiAgICBjb25maWc6IExpdmVRdWVyeVNlcnZlck9wdGlvbnMsXG4gICAgb3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zXG4gICk6IFByb21pc2U8UGFyc2VMaXZlUXVlcnlTZXJ2ZXI+IHtcbiAgICBpZiAoIWh0dHBTZXJ2ZXIgfHwgKGNvbmZpZyAmJiBjb25maWcucG9ydCkpIHtcbiAgICAgIHZhciBhcHAgPSBleHByZXNzKCk7XG4gICAgICBodHRwU2VydmVyID0gcmVxdWlyZSgnaHR0cCcpLmNyZWF0ZVNlcnZlcihhcHApO1xuICAgICAgaHR0cFNlcnZlci5saXN0ZW4oY29uZmlnLnBvcnQpO1xuICAgIH1cbiAgICBjb25zdCBzZXJ2ZXIgPSBuZXcgUGFyc2VMaXZlUXVlcnlTZXJ2ZXIoaHR0cFNlcnZlciwgY29uZmlnLCBvcHRpb25zKTtcbiAgICBhd2FpdCBzZXJ2ZXIuY29ubmVjdCgpO1xuICAgIHJldHVybiBzZXJ2ZXI7XG4gIH1cblxuICBzdGF0aWMgYXN5bmMgdmVyaWZ5U2VydmVyVXJsKCkge1xuICAgIC8vIHBlcmZvcm0gYSBoZWFsdGggY2hlY2sgb24gdGhlIHNlcnZlclVSTCB2YWx1ZVxuICAgIGlmIChQYXJzZS5zZXJ2ZXJVUkwpIHtcbiAgICAgIGNvbnN0IGlzVmFsaWRIdHRwVXJsID0gc3RyaW5nID0+IHtcbiAgICAgICAgbGV0IHVybDtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB1cmwgPSBuZXcgVVJMKHN0cmluZyk7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdXJsLnByb3RvY29sID09PSAnaHR0cDonIHx8IHVybC5wcm90b2NvbCA9PT0gJ2h0dHBzOic7XG4gICAgICB9O1xuICAgICAgY29uc3QgdXJsID0gYCR7UGFyc2Uuc2VydmVyVVJMLnJlcGxhY2UoL1xcLyQvLCAnJyl9L2hlYWx0aGA7XG4gICAgICBpZiAoIWlzVmFsaWRIdHRwVXJsKHVybCkpIHtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAgIGBcXG5XQVJOSU5HLCBVbmFibGUgdG8gY29ubmVjdCB0byAnJHtQYXJzZS5zZXJ2ZXJVUkx9JyBhcyB0aGUgVVJMIGlzIGludmFsaWQuYCArXG4gICAgICAgICAgICBgIENsb3VkIGNvZGUgYW5kIHB1c2ggbm90aWZpY2F0aW9ucyBtYXkgYmUgdW5hdmFpbGFibGUhXFxuYFxuICAgICAgICApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCByZXF1ZXN0ID0gcmVxdWlyZSgnLi9yZXF1ZXN0Jyk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3QoeyB1cmwgfSkuY2F0Y2gocmVzcG9uc2UgPT4gcmVzcG9uc2UpO1xuICAgICAgY29uc3QganNvbiA9IHJlc3BvbnNlLmRhdGEgfHwgbnVsbDtcbiAgICAgIGNvbnN0IHJldHJ5ID0gcmVzcG9uc2UuaGVhZGVycz8uWydyZXRyeS1hZnRlciddO1xuICAgICAgaWYgKHJldHJ5KSB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCByZXRyeSAqIDEwMDApKTtcbiAgICAgICAgcmV0dXJuIHRoaXMudmVyaWZ5U2VydmVyVXJsKCk7XG4gICAgICB9XG4gICAgICBpZiAocmVzcG9uc2Uuc3RhdHVzICE9PSAyMDAgfHwganNvbj8uc3RhdHVzICE9PSAnb2snKSB7XG4gICAgICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLWNvbnNvbGUgKi9cbiAgICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAgIGBcXG5XQVJOSU5HLCBVbmFibGUgdG8gY29ubmVjdCB0byAnJHtQYXJzZS5zZXJ2ZXJVUkx9Jy5gICtcbiAgICAgICAgICAgIGAgQ2xvdWQgY29kZSBhbmQgcHVzaCBub3RpZmljYXRpb25zIG1heSBiZSB1bmF2YWlsYWJsZSFcXG5gXG4gICAgICAgICk7XG4gICAgICAgIC8qIGVzbGludC1lbmFibGUgbm8tY29uc29sZSAqL1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYWRkUGFyc2VDbG91ZCgpIHtcbiAgY29uc3QgUGFyc2VDbG91ZCA9IHJlcXVpcmUoJy4vY2xvdWQtY29kZS9QYXJzZS5DbG91ZCcpO1xuICBjb25zdCBQYXJzZVNlcnZlciA9IHJlcXVpcmUoJy4vY2xvdWQtY29kZS9QYXJzZS5TZXJ2ZXInKTtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFBhcnNlLCAnU2VydmVyJywge1xuICAgIGdldCgpIHtcbiAgICAgIGNvbnN0IGNvbmYgPSBDb25maWcuZ2V0KFBhcnNlLmFwcGxpY2F0aW9uSWQpO1xuICAgICAgcmV0dXJuIHsgLi4uY29uZiwgLi4uUGFyc2VTZXJ2ZXIgfTtcbiAgICB9LFxuICAgIHNldChuZXdWYWwpIHtcbiAgICAgIG5ld1ZhbC5hcHBJZCA9IFBhcnNlLmFwcGxpY2F0aW9uSWQ7XG4gICAgICBDb25maWcucHV0KG5ld1ZhbCk7XG4gICAgfSxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gIH0pO1xuICBPYmplY3QuYXNzaWduKFBhcnNlLkNsb3VkLCBQYXJzZUNsb3VkKTtcbiAgZ2xvYmFsLlBhcnNlID0gUGFyc2U7XG59XG5cbmZ1bmN0aW9uIGluamVjdERlZmF1bHRzKG9wdGlvbnM6IFBhcnNlU2VydmVyT3B0aW9ucykge1xuICBPYmplY3Qua2V5cyhkZWZhdWx0cykuZm9yRWFjaChrZXkgPT4ge1xuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9wdGlvbnMsIGtleSkpIHtcbiAgICAgIG9wdGlvbnNba2V5XSA9IGRlZmF1bHRzW2tleV07XG4gICAgfVxuICB9KTtcblxuICAvLyBJbmplY3QgZGVmYXVsdHMgZm9yIGRhdGFiYXNlIG9wdGlvbnM7IG9ubHkgd2hlbiBubyBleHBsaWNpdCBkYXRhYmFzZSBhZGFwdGVyIGlzIHNldCxcbiAgLy8gYmVjYXVzZSBhbiBleHBsaWNpdCBhZGFwdGVyIG1hbmFnZXMgaXRzIG93biBvcHRpb25zIGFuZCBwYXNzaW5nIGRhdGFiYXNlT3B0aW9ucyBhbG9uZ3NpZGVcbiAgLy8gaXQgd291bGQgY2F1c2UgYSBjb25mbGljdCBlcnJvciBpbiBnZXREYXRhYmFzZUNvbnRyb2xsZXIuXG4gIGlmICghb3B0aW9ucy5kYXRhYmFzZUFkYXB0ZXIpIHtcbiAgICBpZiAob3B0aW9ucy5kYXRhYmFzZU9wdGlvbnMgPT0gbnVsbCkge1xuICAgICAgb3B0aW9ucy5kYXRhYmFzZU9wdGlvbnMgPSB7fTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zLmRhdGFiYXNlT3B0aW9ucyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkob3B0aW9ucy5kYXRhYmFzZU9wdGlvbnMpKSB7XG4gICAgICBPYmplY3Qua2V5cyhEYXRhYmFzZU9wdGlvbkRlZmF1bHRzKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9wdGlvbnMuZGF0YWJhc2VPcHRpb25zLCBrZXkpKSB7XG4gICAgICAgICAgb3B0aW9ucy5kYXRhYmFzZU9wdGlvbnNba2V5XSA9IERhdGFiYXNlT3B0aW9uRGVmYXVsdHNba2V5XTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob3B0aW9ucywgJ3NlcnZlclVSTCcpKSB7XG4gICAgb3B0aW9ucy5zZXJ2ZXJVUkwgPSBgaHR0cDovL2xvY2FsaG9zdDoke29wdGlvbnMucG9ydH0ke29wdGlvbnMubW91bnRQYXRofWA7XG4gIH1cblxuICAvLyBSZXNlcnZlZCBDaGFyYWN0ZXJzXG4gIGlmIChvcHRpb25zLmFwcElkKSB7XG4gICAgY29uc3QgcmVnZXggPSAvWyEjJCUnKCkqKyYvOjs9P0BbXFxde31eLHw8Pl0vZztcbiAgICBpZiAob3B0aW9ucy5hcHBJZC5tYXRjaChyZWdleCkpIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgIGBcXG5XQVJOSU5HLCBhcHBJZCB0aGF0IGNvbnRhaW5zIHNwZWNpYWwgY2hhcmFjdGVycyBjYW4gY2F1c2UgaXNzdWVzIHdoaWxlIHVzaW5nIHdpdGggdXJscy5cXG5gXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIC8vIEJhY2t3YXJkcyBjb21wYXRpYmlsaXR5XG4gIGlmIChvcHRpb25zLnVzZXJTZW5zaXRpdmVGaWVsZHMpIHtcbiAgICAvKiBlc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG4gICAgIXByb2Nlc3MuZW52LlRFU1RJTkcgJiZcbiAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgYFxcbkRFUFJFQ0FURUQ6IHVzZXJTZW5zaXRpdmVGaWVsZHMgaGFzIGJlZW4gcmVwbGFjZWQgYnkgcHJvdGVjdGVkRmllbGRzIGFsbG93aW5nIHRoZSBhYmlsaXR5IHRvIHByb3RlY3QgZmllbGRzIGluIGFsbCBjbGFzc2VzIHdpdGggQ0xQLiBcXG5gXG4gICAgICApO1xuICAgIC8qIGVzbGludC1lbmFibGUgbm8tY29uc29sZSAqL1xuXG4gICAgY29uc3QgdXNlclNlbnNpdGl2ZUZpZWxkcyA9IEFycmF5LmZyb20oXG4gICAgICBuZXcgU2V0KFsuLi4oZGVmYXVsdHMudXNlclNlbnNpdGl2ZUZpZWxkcyB8fCBbXSksIC4uLihvcHRpb25zLnVzZXJTZW5zaXRpdmVGaWVsZHMgfHwgW10pXSlcbiAgICApO1xuXG4gICAgLy8gSWYgdGhlIG9wdGlvbnMucHJvdGVjdGVkRmllbGRzIGlzIHVuc2V0LFxuICAgIC8vIGl0J2xsIGJlIGFzc2lnbmVkIHRoZSBkZWZhdWx0IGFib3ZlLlxuICAgIC8vIEhlcmUsIHByb3RlY3QgYWdhaW5zdCB0aGUgY2FzZSB3aGVyZSBwcm90ZWN0ZWRGaWVsZHNcbiAgICAvLyBpcyBzZXQsIGJ1dCBkb2Vzbid0IGhhdmUgX1VzZXIuXG4gICAgaWYgKCEoJ19Vc2VyJyBpbiBvcHRpb25zLnByb3RlY3RlZEZpZWxkcykpIHtcbiAgICAgIG9wdGlvbnMucHJvdGVjdGVkRmllbGRzID0gT2JqZWN0LmFzc2lnbih7IF9Vc2VyOiBbXSB9LCBvcHRpb25zLnByb3RlY3RlZEZpZWxkcyk7XG4gICAgfVxuXG4gICAgb3B0aW9ucy5wcm90ZWN0ZWRGaWVsZHNbJ19Vc2VyJ11bJyonXSA9IEFycmF5LmZyb20oXG4gICAgICBuZXcgU2V0KFsuLi4ob3B0aW9ucy5wcm90ZWN0ZWRGaWVsZHNbJ19Vc2VyJ11bJyonXSB8fCBbXSksIC4uLnVzZXJTZW5zaXRpdmVGaWVsZHNdKVxuICAgICk7XG4gIH1cblxuICAvLyBNZXJnZSBwcm90ZWN0ZWRGaWVsZHMgb3B0aW9ucyB3aXRoIGRlZmF1bHRzLlxuICBPYmplY3Qua2V5cyhkZWZhdWx0cy5wcm90ZWN0ZWRGaWVsZHMpLmZvckVhY2goYyA9PiB7XG4gICAgY29uc3QgY3VyID0gb3B0aW9ucy5wcm90ZWN0ZWRGaWVsZHNbY107XG4gICAgaWYgKCFjdXIpIHtcbiAgICAgIG9wdGlvbnMucHJvdGVjdGVkRmllbGRzW2NdID0gZGVmYXVsdHMucHJvdGVjdGVkRmllbGRzW2NdO1xuICAgIH0gZWxzZSB7XG4gICAgICBPYmplY3Qua2V5cyhkZWZhdWx0cy5wcm90ZWN0ZWRGaWVsZHNbY10pLmZvckVhY2gociA9PiB7XG4gICAgICAgIGlmIChvcHRpb25zLnByb3RlY3RlZEZpZWxkc1tjXVtyXSAmJiBvcHRpb25zLnByb3RlY3RlZEZpZWxkc093bmVyRXhlbXB0ID09PSBmYWxzZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB1bnEgPSBuZXcgU2V0KFtcbiAgICAgICAgICAuLi4ob3B0aW9ucy5wcm90ZWN0ZWRGaWVsZHNbY11bcl0gfHwgW10pLFxuICAgICAgICAgIC4uLmRlZmF1bHRzLnByb3RlY3RlZEZpZWxkc1tjXVtyXSxcbiAgICAgICAgXSk7XG4gICAgICAgIG9wdGlvbnMucHJvdGVjdGVkRmllbGRzW2NdW3JdID0gQXJyYXkuZnJvbSh1bnEpO1xuICAgICAgfSk7XG4gICAgfVxuICB9KTtcbn1cblxuLy8gVGhvc2UgY2FuJ3QgYmUgdGVzdGVkIGFzIGl0IHJlcXVpcmVzIGEgc3VicHJvY2Vzc1xuLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbmZ1bmN0aW9uIGNvbmZpZ3VyZUxpc3RlbmVycyhwYXJzZVNlcnZlcikge1xuICBjb25zdCBoYW5kbGVTaHV0ZG93biA9IGZ1bmN0aW9uICgpIHtcbiAgICBwcm9jZXNzLnN0ZG91dC53cml0ZSgnVGVybWluYXRpb24gc2lnbmFsIHJlY2VpdmVkLiBTaHV0dGluZyBkb3duLicpO1xuICAgIHBhcnNlU2VydmVyLmhhbmRsZVNodXRkb3duKCk7XG4gIH07XG4gIHByb2Nlc3Mub24oJ1NJR1RFUk0nLCBoYW5kbGVTaHV0ZG93bik7XG4gIHByb2Nlc3Mub24oJ1NJR0lOVCcsIGhhbmRsZVNodXRkb3duKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgUGFyc2VTZXJ2ZXI7XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQVdBLElBQUFBLFdBQUEsR0FBQUMsT0FBQTtBQUNBLElBQUFDLFNBQUEsR0FBQUMsdUJBQUEsQ0FBQUYsT0FBQTtBQUNBLElBQUFHLE9BQUEsR0FBQUQsdUJBQUEsQ0FBQUYsT0FBQTtBQUNBLElBQUFJLE9BQUEsR0FBQUMsc0JBQUEsQ0FBQUwsT0FBQTtBQUNBLElBQUFNLGNBQUEsR0FBQUQsc0JBQUEsQ0FBQUwsT0FBQTtBQUNBLElBQUFPLGtCQUFBLEdBQUFGLHNCQUFBLENBQUFMLE9BQUE7QUFDQSxJQUFBUSxnQkFBQSxHQUFBUixPQUFBO0FBQ0EsSUFBQVMsY0FBQSxH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