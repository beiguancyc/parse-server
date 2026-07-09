"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.PagesRouter = void 0;
var _PromiseRouter = _interopRequireDefault(require("../PromiseRouter"));
var _Config = _interopRequireDefault(require("../Config"));
var _express = _interopRequireDefault(require("express"));
var _path = _interopRequireDefault(require("path"));
var _fs = require("fs");
var _node = require("parse/node");
var _Utils = _interopRequireDefault(require("../Utils"));
var _mustache = _interopRequireDefault(require("mustache"));
var _Page = _interopRequireDefault(require("../Page"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// All pages with custom page key for reference and file name
const pages = Object.freeze({
  passwordReset: new _Page.default({
    id: 'passwordReset',
    defaultFile: 'password_reset.html'
  }),
  passwordResetSuccess: new _Page.default({
    id: 'passwordResetSuccess',
    defaultFile: 'password_reset_success.html'
  }),
  passwordResetLinkInvalid: new _Page.default({
    id: 'passwordResetLinkInvalid',
    defaultFile: 'password_reset_link_invalid.html'
  }),
  emailVerificationSuccess: new _Page.default({
    id: 'emailVerificationSuccess',
    defaultFile: 'email_verification_success.html'
  }),
  emailVerificationSendFail: new _Page.default({
    id: 'emailVerificationSendFail',
    defaultFile: 'email_verification_send_fail.html'
  }),
  emailVerificationSendSuccess: new _Page.default({
    id: 'emailVerificationSendSuccess',
    defaultFile: 'email_verification_send_success.html'
  }),
  emailVerificationLinkInvalid: new _Page.default({
    id: 'emailVerificationLinkInvalid',
    defaultFile: 'email_verification_link_invalid.html'
  }),
  emailVerificationLinkExpired: new _Page.default({
    id: 'emailVerificationLinkExpired',
    defaultFile: 'email_verification_link_expired.html'
  })
});

// All page parameters for reference to be used as template placeholders or query params
const pageParams = Object.freeze({
  appName: 'appName',
  appId: 'appId',
  token: 'token',
  username: 'username',
  error: 'error',
  locale: 'locale',
  publicServerUrl: 'publicServerUrl'
});

// The header prefix to add page params as response headers
const pageParamHeaderPrefix = 'x-parse-page-param-';

// The errors being thrown
const errors = Object.freeze({
  jsonFailedFileLoading: 'failed to load JSON file',
  fileOutsideAllowedScope: 'not allowed to read file outside of pages directory'
});
class PagesRouter extends _PromiseRouter.default {
  /**
   * Constructs a PagesRouter.
   * @param {Object} pages The pages options from the Parse Server configuration.
   */
  constructor(pages = {}) {
    super();

    // Set instance properties
    this.pagesConfig = pages;
    this.pagesEndpoint = pages.pagesEndpoint ? pages.pagesEndpoint : 'apps';
    this.pagesPath = pages.pagesPath ? _path.default.resolve('./', pages.pagesPath) : _path.default.resolve(__dirname, '../../public');
    this.loadJsonResource();
    this.mountPagesRoutes();
    this.mountCustomRoutes();
    this.mountStaticRoute();
  }
  verifyEmail(req) {
    const config = req.config;
    const {
      token: rawToken
    } = req.query;
    const token = typeof rawToken === 'string' ? rawToken : undefined;
    if (!config) {
      this.invalidRequest();
    }
    if (!token) {
      return this.goToPage(req, pages.emailVerificationLinkInvalid);
    }
    const userController = config.userController;
    return userController.verifyEmail(token).then(() => {
      return this.goToPage(req, pages.emailVerificationSuccess);
    }, () => {
      return this.goToPage(req, pages.emailVerificationLinkInvalid);
    });
  }
  resendVerificationEmail(req) {
    const config = req.config;
    const username = req.body?.username;
    const rawToken = req.body?.token;
    const token = typeof rawToken === 'string' ? rawToken : undefined;
    if (!config) {
      this.invalidRequest();
    }
    if (!username && !token) {
      return this.goToPage(req, pages.emailVerificationLinkInvalid);
    }
    const userController = config.userController;
    const suppressError = config.emailVerifySuccessOnInvalidEmail ?? true;
    return userController.resendVerificationEmail(username, req, token).then(() => {
      return this.goToPage(req, pages.emailVerificationSendSuccess);
    }, () => {
      if (suppressError) {
        return this.goToPage(req, pages.emailVerificationSendSuccess);
      }
      return this.goToPage(req, pages.emailVerificationSendFail);
    });
  }
  passwordReset(req) {
    const config = req.config;
    const params = {
      [pageParams.appId]: req.params.appId,
      [pageParams.appName]: config.appName,
      [pageParams.token]: req.query.token,
      [pageParams.username]: req.query.username,
      [pageParams.publicServerUrl]: config.publicServerURL
    };
    return this.goToPage(req, pages.passwordReset, params);
  }
  requestResetPassword(req) {
    const config = req.config;
    if (!config) {
      this.invalidRequest();
    }
    const {
      token: rawToken
    } = req.query;
    const token = typeof rawToken === 'string' ? rawToken : undefined;
    if (!token) {
      return this.goToPage(req, pages.passwordResetLinkInvalid);
    }
    return config.userController.checkResetTokenValidity(token).then(() => {
      const params = {
        [pageParams.token]: token,
        [pageParams.appId]: config.applicationId,
        [pageParams.appName]: config.appName
      };
      return this.goToPage(req, pages.passwordReset, params);
    }, () => {
      return this.goToPage(req, pages.passwordResetLinkInvalid);
    });
  }
  resetPassword(req) {
    const config = req.config;
    if (!config) {
      this.invalidRequest();
    }
    const {
      new_password,
      token: rawToken
    } = req.body || {};
    const token = typeof rawToken === 'string' ? rawToken : undefined;
    if ((!token || !new_password) && req.xhr === false) {
      return this.goToPage(req, pages.passwordResetLinkInvalid);
    }
    if (!token) {
      throw new _node.Parse.Error(_node.Parse.Error.OTHER_CAUSE, 'Missing token');
    }
    if (!new_password) {
      throw new _node.Parse.Error(_node.Parse.Error.PASSWORD_MISSING, 'Missing password');
    }
    return config.userController.updatePassword(token, new_password).then(() => {
      return Promise.resolve({
        success: true
      });
    }, err => {
      return Promise.resolve({
        success: false,
        err
      });
    }).then(result => {
      if (req.xhr) {
        if (result.success) {
          return Promise.resolve({
            status: 200,
            response: 'Password successfully reset'
          });
        }
        if (result.err) {
          throw new _node.Parse.Error(_node.Parse.Error.OTHER_CAUSE, `${result.err}`);
        }
      }
      const query = result.success ? {} : {
        [pageParams.token]: token,
        [pageParams.appId]: config.applicationId,
        [pageParams.error]: result.err,
        [pageParams.appName]: config.appName
      };
      if (result?.err === 'The password reset link has expired') {
        delete query[pageParams.token];
        query[pageParams.token] = token;
      }
      const page = result.success ? pages.passwordResetSuccess : pages.passwordReset;
      return this.goToPage(req, page, query, false);
    });
  }

  /**
   * Returns page content if the page is a local file or returns a
   * redirect to a custom page.
   * @param {Object} req The express request.
   * @param {Page} page The page to go to.
   * @param {Object} [params={}] The query parameters to attach to the URL in case of
   * HTTP redirect responses for POST requests, or the placeholders to fill into
   * the response content in case of HTTP content responses for GET requests.
   * @param {Boolean} [responseType] Is true if a redirect response should be forced,
   * false if a content response should be forced, undefined if the response type
   * should depend on the request type by default:
   * - GET request -> content response
   * - POST request -> redirect response (PRG pattern)
   * @returns {Promise<Object>} The PromiseRouter response.
   */
  goToPage(req, page, params = {}, responseType) {
    const config = req.config;

    // Determine redirect either by force, response setting or request method
    const redirect = config.pages.forceRedirect ? true : responseType !== undefined ? responseType : req.method == 'POST';

    // Include default parameters
    const defaultParams = this.getDefaultParams(config);
    if (Object.values(defaultParams).includes(undefined)) {
      return this.notFound();
    }
    params = Object.assign(params, defaultParams);

    // Add locale to params to ensure it is passed on with every request;
    // that means, once a locale is set, it is passed on to any follow-up page,
    // e.g. request_password_reset -> password_reset -> password_reset_success
    const locale = this.getLocale(req);
    params[pageParams.locale] = locale;

    // Compose paths and URLs
    const defaultFile = page.defaultFile;
    const defaultPath = this.defaultPagePath(defaultFile);
    const defaultUrl = this.composePageUrl(defaultFile, config.publicServerURL);

    // If custom URL is set redirect to it without localization
    const customUrl = config.pages.customUrls[page.id];
    if (customUrl && !_Utils.default.isPath(customUrl)) {
      return this.redirectResponse(customUrl, params);
    }

    // Get JSON placeholders
    let placeholders = {};
    if (config.pages.enableLocalization && config.pages.localizationJsonPath) {
      placeholders = this.getJsonPlaceholders(locale, params);
    }

    // Send response
    if (config.pages.enableLocalization && locale) {
      return _Utils.default.getLocalizedPath(defaultPath, locale).then(({
        path,
        subdir
      }) => redirect ? this.redirectResponse(this.composePageUrl(defaultFile, config.publicServerURL, subdir), params) : this.pageResponse(path, params, placeholders));
    } else {
      return redirect ? this.redirectResponse(defaultUrl, params) : this.pageResponse(defaultPath, params, placeholders);
    }
  }

  /**
   * Serves a request to a static resource and localizes the resource if it
   * is a HTML file.
   * @param {Object} req The request object.
   * @returns {Promise<Object>} The response.
   */
  staticRoute(req) {
    // Get requested path
    const relativePath = req.params['resource'][0];

    // Resolve requested path to absolute path
    const absolutePath = _path.default.resolve(this.pagesPath, relativePath);

    // If the requested file is not a HTML file send its raw content
    if (!absolutePath || !absolutePath.endsWith('.html')) {
      return this.fileResponse(absolutePath);
    }

    // Get parameters
    const params = this.getDefaultParams(req.config);
    const locale = this.getLocale(req);
    if (locale) {
      params.locale = locale;
    }

    // Get JSON placeholders
    const placeholders = this.getJsonPlaceholders(locale, params);
    return this.pageResponse(absolutePath, params, placeholders);
  }

  /**
   * Returns a translation from the JSON resource for a given locale. The JSON
   * resource is parsed according to i18next syntax.
   *
   * Example JSON content:
   * ```js
   *  {
   *    "en": {               // resource for language `en` (English)
   *      "translation": {
   *        "greeting": "Hello!"
   *      }
   *    },
   *    "de": {               // resource for language `de` (German)
   *      "translation": {
   *        "greeting": "Hallo!"
   *      }
   *    }
   *    "de-CH": {            // resource for locale `de-CH` (Swiss German)
   *      "translation": {
   *        "greeting": "Grüezi!"
   *      }
   *    }
   *  }
   * ```
   * @param {String} locale The locale to translate to.
   * @returns {Object} The translation or an empty object if no matching
   * translation was found.
   */
  getJsonTranslation(locale) {
    // If there is no JSON resource
    if (this.jsonParameters === undefined) {
      return {};
    }

    // If locale is not set use the fallback locale
    locale = locale || this.pagesConfig.localizationFallbackLocale;

    // Get matching translation by locale, language or fallback locale
    const language = locale.split('-')[0];
    const resource = this.jsonParameters[locale] || this.jsonParameters[language] || this.jsonParameters[this.pagesConfig.localizationFallbackLocale] || {};
    const translation = resource.translation || {};
    return translation;
  }

  /**
   * Returns a translation from the JSON resource for a given locale with
   * placeholders filled in by given parameters.
   * @param {String} locale The locale to translate to.
   * @param {Object} params The parameters to fill into any placeholders
   * within the translations.
   * @returns {Object} The translation or an empty object if no matching
   * translation was found.
   */
  getJsonPlaceholders(locale, params = {}) {
    // If localization is disabled or there is no JSON resource
    if (!this.pagesConfig.enableLocalization || !this.pagesConfig.localizationJsonPath) {
      return {};
    }

    // Get JSON placeholders
    let placeholders = this.getJsonTranslation(locale);

    // Fill in any placeholders in the translation; this allows a translation
    // to contain default placeholders like {{appName}} which are filled here
    placeholders = JSON.stringify(placeholders);
    placeholders = _mustache.default.render(placeholders, params);
    placeholders = JSON.parse(placeholders);
    return placeholders;
  }

  /**
   * Creates a response with file content.
   * @param {String} path The path of the file to return.
   * @param {Object} [params={}] The parameters to be included in the response
   * header. These will also be used to fill placeholders.
   * @param {Object} [placeholders={}] The placeholders to fill in the content.
   * These will not be included in the response header.
   * @returns {Object} The Promise Router response.
   */
  async pageResponse(path, params = {}, placeholders = {}) {
    // Get file content
    let data;
    try {
      data = await this.readFile(path);
    } catch {
      return this.notFound();
    }

    // Get config placeholders; can be an object, a function or an async function
    let configPlaceholders = typeof this.pagesConfig.placeholders === 'function' ? this.pagesConfig.placeholders(params) : Object.prototype.toString.call(this.pagesConfig.placeholders) === '[object Object]' ? this.pagesConfig.placeholders : {};
    if (_Utils.default.isPromise(configPlaceholders)) {
      configPlaceholders = await configPlaceholders;
    }

    // Fill placeholders
    const allPlaceholders = Object.assign({}, configPlaceholders, placeholders);
    const paramsAndPlaceholders = Object.assign({}, params, allPlaceholders);
    data = _mustache.default.render(data, paramsAndPlaceholders);

    // Add placeholders in header to allow parsing for programmatic use
    // of response, instead of having to parse the HTML content.
    const headers = this.composePageParamHeaders(params);
    return {
      text: data,
      headers: headers
    };
  }

  /**
   * Creates a response with file content.
   * @param {String} path The path of the file to return.
   * @returns {Object} The PromiseRouter response.
   */
  async fileResponse(path) {
    // Get file content
    let data;
    try {
      data = await this.readFile(path);
    } catch {
      return this.notFound();
    }
    return {
      text: data
    };
  }

  /**
   * Reads and returns the content of a file at a given path. File reading to
   * serve content on the static route is only allowed from the pages
   * directory on downwards.
   * -----------------------------------------------------------------------
   * **WARNING:** All file reads in the PagesRouter must be executed by this
   * wrapper because it also detects and prevents common exploits.
   * -----------------------------------------------------------------------
   * @param {String} filePath The path to the file to read.
   * @returns {Promise<String>} The file content.
   */
  async readFile(filePath) {
    // Normalize path to prevent it from containing any directory changing
    // UNIX patterns which could expose the whole file system, e.g.
    // `http://example.com/parse/apps/../file.txt` requests a file outside
    // of the pages directory scope.
    const normalizedPath = _path.default.normalize(filePath);

    // Abort if the path is outside of the path directory scope
    if (!normalizedPath.startsWith(this.pagesPath + _path.default.sep)) {
      throw errors.fileOutsideAllowedScope;
    }
    return await _fs.promises.readFile(normalizedPath, 'utf-8');
  }

  /**
   * Loads a language resource JSON file that is used for translations.
   */
  loadJsonResource() {
    if (this.pagesConfig.localizationJsonPath === undefined) {
      return;
    }
    try {
      const json = require(_path.default.resolve('./', this.pagesConfig.localizationJsonPath));
      this.jsonParameters = json;
    } catch {
      throw errors.jsonFailedFileLoading;
    }
  }

  /**
   * Extracts and returns the page default parameters from the Parse Server
   * configuration. These parameters are made accessible in every page served
   * by this router.
   * @param {Object} config The Parse Server configuration.
   * @returns {Object} The default parameters.
   */
  getDefaultParams(config) {
    return config ? {
      [pageParams.appId]: config.appId,
      [pageParams.appName]: config.appName,
      [pageParams.publicServerUrl]: config.publicServerURL
    } : {};
  }

  /**
   * Extracts and returns the locale from an express request.
   * @param {Object} req The express request.
   * @returns {String|undefined} The locale, or undefined if no locale was set.
   */
  getLocale(req) {
    const locale = (req.query || {})[pageParams.locale] || (req.body || {})[pageParams.locale] || (req.params || {})[pageParams.locale] || (req.headers || {})[pageParamHeaderPrefix + pageParams.locale];

    // Validate locale format to prevent path traversal; only allow
    // standard locale patterns like "en", "en-US", "de-AT", "zh-Hans-CN"
    if (locale !== undefined && typeof locale !== 'string') {
      return undefined;
    }
    if (typeof locale === 'string' && !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(locale)) {
      return undefined;
    }
    return locale;
  }

  /**
   * Composes page parameter headers from the given parameters. Control
   * characters are always stripped from header values to prevent
   * ERR_INVALID_CHAR errors. Values are URI-encoded if the
   * `encodePageParamHeaders` option is enabled.
   * @param {Object} params The parameters to include in the headers.
   * @returns {Object} The headers object.
   */
  composePageParamHeaders(params) {
    const encode = this.pagesConfig.encodePageParamHeaders;
    return Object.entries(params).reduce((m, p) => {
      if (p[1] !== undefined) {
        let value = encode ? encodeURIComponent(p[1]) : p[1];
        if (typeof value === 'string') {
          // eslint-disable-next-line no-control-regex
          value = value.replace(/[\x00-\x1f\x7f]/g, '');
        }
        m[`${pageParamHeaderPrefix}${p[0].toLowerCase()}`] = value;
      }
      return m;
    }, {});
  }

  /**
   * Creates a response with http redirect.
   * @param {Object} req The express request.
   * @param {String} path The path of the file to return.
   * @param {Object} params The query parameters to include.
   * @returns {Object} The Promise Router response.
   */
  async redirectResponse(url, params) {
    // Remove any parameters with undefined value
    params = Object.entries(params).reduce((m, p) => {
      if (p[1] !== undefined) {
        m[p[0]] = p[1];
      }
      return m;
    }, {});

    // Compose URL with parameters in query
    const location = new URL(url);
    Object.entries(params).forEach(p => location.searchParams.set(p[0], p[1]));
    const locationString = location.toString();

    // Add parameters to header to allow parsing for programmatic use
    // of response, instead of having to parse the HTML content.
    const headers = this.composePageParamHeaders(params);
    return {
      status: 303,
      location: locationString,
      headers: headers
    };
  }
  defaultPagePath(file) {
    return _path.default.join(this.pagesPath, file);
  }
  composePageUrl(file, publicServerUrl, locale) {
    let url = publicServerUrl;
    url += url.endsWith('/') ? '' : '/';
    url += this.pagesEndpoint + '/';
    url += locale === undefined ? '' : locale + '/';
    url += file;
    return url;
  }
  notFound() {
    return {
      text: 'Not found.',
      status: 404
    };
  }
  invalidRequest() {
    const error = new Error();
    error.status = 403;
    error.message = 'unauthorized';
    throw error;
  }

  /**
   * Sets the Parse Server configuration in the request object to make it
   * easily accessible throughtout request processing.
   * @param {Object} req The request.
   * @param {Boolean} failGracefully Is true if failing to set the config should
   * not result in an invalid request response. Default is `false`.
   */
  async setConfig(req, failGracefully = false) {
    req.config = _Config.default.get(req.params.appId || req.query.appId);
    if (!req.config && !failGracefully) {
      this.invalidRequest();
    }
    if (req.config) {
      await req.config.loadKeys();
    }
  }
  mountPagesRoutes() {
    this.route('GET', `/${this.pagesEndpoint}/:appId/verify_email`, req => {
      return this.setConfig(req);
    }, req => {
      return this.verifyEmail(req);
    });
    this.route('POST', `/${this.pagesEndpoint}/:appId/resend_verification_email`, req => {
      return this.setConfig(req);
    }, req => {
      return this.resendVerificationEmail(req);
    });
    this.route('GET', `/${this.pagesEndpoint}/choose_password`, req => {
      return this.setConfig(req);
    }, req => {
      return this.passwordReset(req);
    });
    this.route('POST', `/${this.pagesEndpoint}/:appId/request_password_reset`, req => {
      return this.setConfig(req);
    }, req => {
      return this.resetPassword(req);
    });
    this.route('GET', `/${this.pagesEndpoint}/:appId/request_password_reset`, req => {
      return this.setConfig(req);
    }, req => {
      return this.requestResetPassword(req);
    });
  }
  mountCustomRoutes() {
    for (const route of this.pagesConfig.customRoutes || []) {
      this.route(route.method, `/${this.pagesEndpoint}/:appId/${route.path}`, req => {
        return this.setConfig(req);
      }, async req => {
        const {
          file,
          query = {}
        } = (await route.handler(req)) || {};

        // If route handler did not return a page send 404 response
        if (!file) {
          return this.notFound();
        }

        // Send page response
        const page = new _Page.default({
          id: file,
          defaultFile: file
        });
        return this.goToPage(req, page, query, false);
      });
    }
  }
  mountStaticRoute() {
    this.route('GET', `/${this.pagesEndpoint}/*resource`, req => {
      return this.setConfig(req, true);
    }, req => {
      return this.staticRoute(req);
    });
  }
  expressRouter() {
    const router = _express.default.Router();
    router.use('/', super.expressRouter());
    return router;
  }
}
exports.PagesRouter = PagesRouter;
var _default = exports.default = PagesRouter;
module.exports = {
  PagesRouter,
  pageParamHeaderPrefix,
  pageParams,
  pages
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfUHJvbWlzZVJvdXRlciIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiX0NvbmZpZyIsIl9leHByZXNzIiwiX3BhdGgiLCJfZnMiLCJfbm9kZSIsIl9VdGlscyIsIl9tdXN0YWNoZSIsIl9QYWdlIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwicGFnZXMiLCJPYmplY3QiLCJmcmVlemUiLCJwYXNzd29yZFJlc2V0IiwiUGFnZSIsImlkIiwiZGVmYXVsdEZpbGUiLCJwYXNzd29yZFJlc2V0U3VjY2VzcyIsInBhc3N3b3JkUmVzZXRMaW5rSW52YWxpZCIsImVtYWlsVmVyaWZpY2F0aW9uU3VjY2VzcyIsImVtYWlsVmVyaWZpY2F0aW9uU2VuZEZhaWwiLCJlbWFpbFZlcmlmaWNhdGlvblNlbmRTdWNjZXNzIiwiZW1haWxWZXJpZmljYXRpb25MaW5rSW52YWxpZCIsImVtYWlsVmVyaWZpY2F0aW9uTGlua0V4cGlyZWQiLCJwYWdlUGFyYW1zIiwiYXBwTmFtZSIsImFwcElkIiwidG9rZW4iLCJ1c2VybmFtZSIsImVycm9yIiwibG9jYWxlIiwicHVibGljU2VydmVyVXJsIiwicGFnZVBhcmFtSGVhZGVyUHJlZml4IiwiZXJyb3JzIiwianNvbkZhaWxlZEZpbGVMb2FkaW5nIiwiZmlsZU91dHNpZGVBbGxvd2VkU2NvcGUiLCJQYWdlc1JvdXRlciIsIlByb21pc2VSb3V0ZXIiLCJjb25zdHJ1Y3RvciIsInBhZ2VzQ29uZmlnIiwicGFnZXNFbmRwb2ludCIsInBhZ2VzUGF0aCIsInBhdGgiLCJyZXNvbHZlIiwiX19kaXJuYW1lIiwibG9hZEpzb25SZXNvdXJjZSIsIm1vdW50UGFnZXNSb3V0ZXMiLCJtb3VudEN1c3RvbVJvdXRlcyIsIm1vdW50U3RhdGljUm91dGUiLCJ2ZXJpZnlFbWFpbCIsInJlcSIsImNvbmZpZyIsInJhd1Rva2VuIiwicXVlcnkiLCJ1bmRlZmluZWQiLCJpbnZhbGlkUmVxdWVzdCIsImdvVG9QYWdlIiwidXNlckNvbnRyb2xsZXIiLCJ0aGVuIiwicmVzZW5kVmVyaWZpY2F0aW9uRW1haWwiLCJib2R5Iiwic3VwcHJlc3NFcnJvciIsImVtYWlsVmVyaWZ5U3VjY2Vzc09uSW52YWxpZEVtYWlsIiwicGFyYW1zIiwicHVibGljU2VydmVyVVJMIiwicmVxdWVzdFJlc2V0UGFzc3dvcmQiLCJjaGVja1Jlc2V0VG9rZW5WYWxpZGl0eSIsImFwcGxpY2F0aW9uSWQiLCJyZXNldFBhc3N3b3JkIiwibmV3X3Bhc3N3b3JkIiwieGhyIiwiUGFyc2UiLCJFcnJvciIsIk9USEVSX0NBVVNFIiwiUEFTU1dPUkRfTUlTU0lORyIsInVwZGF0ZVBhc3N3b3JkIiwiUHJvbWlzZSIsInN1Y2Nlc3MiLCJlcnIiLCJyZXN1bHQiLCJzdGF0dXMiLCJyZXNwb25zZSIsInBhZ2UiLCJyZXNwb25zZVR5cGUiLCJyZWRpcmVjdCIsImZvcmNlUmVkaXJlY3QiLCJtZXRob2QiLCJkZWZhdWx0UGFyYW1zIiwiZ2V0RGVmYXVsdFBhcmFtcyIsInZhbHVlcyIsImluY2x1ZGVzIiwibm90Rm91bmQiLCJhc3NpZ24iLCJnZXRMb2NhbGUiLCJkZWZhdWx0UGF0aCIsImRlZmF1bHRQYWdlUGF0aCIsImRlZmF1bHRVcmwiLCJjb21wb3NlUGFnZVVybCIsImN1c3RvbVVybCIsImN1c3RvbVVybHMiLCJVdGlscyIsImlzUGF0aCIsInJlZGlyZWN0UmVzcG9uc2UiLCJwbGFjZWhvbGRlcnMiLCJlbmFibGVMb2NhbGl6YXRpb24iLCJsb2NhbGl6YXRpb25Kc29uUGF0aCIsImdldEpzb25QbGFjZWhvbGRlcnMiLCJnZXRMb2NhbGl6ZWRQYXRoIiwic3ViZGlyIiwicGFnZVJlc3BvbnNlIiwic3RhdGljUm91dGUiLCJyZWxhdGl2ZVBhdGgiLCJhYnNvbHV0ZVBhdGgiLCJlbmRzV2l0aCIsImZpbGVSZXNwb25zZSIsImdldEpzb25UcmFuc2xhdGlvbiIsImpzb25QYXJhbWV0ZXJzIiwibG9jYWxpemF0aW9uRmFsbGJhY2tMb2NhbGUiLCJsYW5ndWFnZSIsInNwbGl0IiwicmVzb3VyY2UiLCJ0cmFuc2xhdGlvbiIsIkpTT04iLCJzdHJpbmdpZnkiLCJtdXN0YWNoZSIsInJlbmRlciIsInBhcnNlIiwiZGF0YSIsInJlYWRGaWxlIiwiY29uZmlnUGxhY2Vob2xkZXJzIiwicHJvdG90eXBlIiwidG9TdHJpbmciLCJjYWxsIiwiaXNQcm9taXNlIiwiYWxsUGxhY2Vob2xkZXJzIiwicGFyYW1zQW5kUGxhY2Vob2xkZXJzIiwiaGVhZGVycyIsImNvbXBvc2VQYWdlUGFyYW1IZWFkZXJzIiwidGV4dCIsImZpbGVQYXRoIiwibm9ybWFsaXplZFBhdGgiLCJub3JtYWxpemUiLCJzdGFydHNXaXRoIiwic2VwIiwiZnMiLCJqc29uIiwidGVzdCIsImVuY29kZSIsImVuY29kZVBhZ2VQYXJhbUhlYWRlcnMiLCJlbnRyaWVzIiwicmVkdWNlIiwibSIsInAiLCJ2YWx1ZSIsImVuY29kZVVSSUNvbXBvbmVudCIsInJlcGxhY2UiLCJ0b0xvd2VyQ2FzZSIsInVybCIsImxvY2F0aW9uIiwiVVJMIiwiZm9yRWFjaCIsInNlYXJjaFBhcmFtcyIsInNldCIsImxvY2F0aW9uU3RyaW5nIiwiZmlsZSIsImpvaW4iLCJtZXNzYWdlIiwic2V0Q29uZmlnIiwiZmFpbEdyYWNlZnVsbHkiLCJDb25maWciLCJnZXQiLCJsb2FkS2V5cyIsInJvdXRlIiwiY3VzdG9tUm91dGVzIiwiaGFuZGxlciIsImV4cHJlc3NSb3V0ZXIiLCJyb3V0ZXIiLCJleHByZXNzIiwiUm91dGVyIiwidXNlIiwiZXhwb3J0cyIsIl9kZWZhdWx0IiwibW9kdWxlIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL1JvdXRlcnMvUGFnZXNSb3V0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IFByb21pc2VSb3V0ZXIgZnJvbSAnLi4vUHJvbWlzZVJvdXRlcic7XG5pbXBvcnQgQ29uZmlnIGZyb20gJy4uL0NvbmZpZyc7XG5pbXBvcnQgZXhwcmVzcyBmcm9tICdleHByZXNzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgcHJvbWlzZXMgYXMgZnMgfSBmcm9tICdmcyc7XG5pbXBvcnQgeyBQYXJzZSB9IGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IFV0aWxzIGZyb20gJy4uL1V0aWxzJztcbmltcG9ydCBtdXN0YWNoZSBmcm9tICdtdXN0YWNoZSc7XG5pbXBvcnQgUGFnZSBmcm9tICcuLi9QYWdlJztcblxuLy8gQWxsIHBhZ2VzIHdpdGggY3VzdG9tIHBhZ2Uga2V5IGZvciByZWZlcmVuY2UgYW5kIGZpbGUgbmFtZVxuY29uc3QgcGFnZXMgPSBPYmplY3QuZnJlZXplKHtcbiAgcGFzc3dvcmRSZXNldDogbmV3IFBhZ2UoeyBpZDogJ3Bhc3N3b3JkUmVzZXQnLCBkZWZhdWx0RmlsZTogJ3Bhc3N3b3JkX3Jlc2V0Lmh0bWwnIH0pLFxuICBwYXNzd29yZFJlc2V0U3VjY2VzczogbmV3IFBhZ2Uoe1xuICAgIGlkOiAncGFzc3dvcmRSZXNldFN1Y2Nlc3MnLFxuICAgIGRlZmF1bHRGaWxlOiAncGFzc3dvcmRfcmVzZXRfc3VjY2Vzcy5odG1sJyxcbiAgfSksXG4gIHBhc3N3b3JkUmVzZXRMaW5rSW52YWxpZDogbmV3IFBhZ2Uoe1xuICAgIGlkOiAncGFzc3dvcmRSZXNldExpbmtJbnZhbGlkJyxcbiAgICBkZWZhdWx0RmlsZTogJ3Bhc3N3b3JkX3Jlc2V0X2xpbmtfaW52YWxpZC5odG1sJyxcbiAgfSksXG4gIGVtYWlsVmVyaWZpY2F0aW9uU3VjY2VzczogbmV3IFBhZ2Uoe1xuICAgIGlkOiAnZW1haWxWZXJpZmljYXRpb25TdWNjZXNzJyxcbiAgICBkZWZhdWx0RmlsZTogJ2VtYWlsX3ZlcmlmaWNhdGlvbl9zdWNjZXNzLmh0bWwnLFxuICB9KSxcbiAgZW1haWxWZXJpZmljYXRpb25TZW5kRmFpbDogbmV3IFBhZ2Uoe1xuICAgIGlkOiAnZW1haWxWZXJpZmljYXRpb25TZW5kRmFpbCcsXG4gICAgZGVmYXVsdEZpbGU6ICdlbWFpbF92ZXJpZmljYXRpb25fc2VuZF9mYWlsLmh0bWwnLFxuICB9KSxcbiAgZW1haWxWZXJpZmljYXRpb25TZW5kU3VjY2VzczogbmV3IFBhZ2Uoe1xuICAgIGlkOiAnZW1haWxWZXJpZmljYXRpb25TZW5kU3VjY2VzcycsXG4gICAgZGVmYXVsdEZpbGU6ICdlbWFpbF92ZXJpZmljYXRpb25fc2VuZF9zdWNjZXNzLmh0bWwnLFxuICB9KSxcbiAgZW1haWxWZXJpZmljYXRpb25MaW5rSW52YWxpZDogbmV3IFBhZ2Uoe1xuICAgIGlkOiAnZW1haWxWZXJpZmljYXRpb25MaW5rSW52YWxpZCcsXG4gICAgZGVmYXVsdEZpbGU6ICdlbWFpbF92ZXJpZmljYXRpb25fbGlua19pbnZhbGlkLmh0bWwnLFxuICB9KSxcbiAgZW1haWxWZXJpZmljYXRpb25MaW5rRXhwaXJlZDogbmV3IFBhZ2Uoe1xuICAgIGlkOiAnZW1haWxWZXJpZmljYXRpb25MaW5rRXhwaXJlZCcsXG4gICAgZGVmYXVsdEZpbGU6ICdlbWFpbF92ZXJpZmljYXRpb25fbGlua19leHBpcmVkLmh0bWwnLFxuICB9KSxcbn0pO1xuXG4vLyBBbGwgcGFnZSBwYXJhbWV0ZXJzIGZvciByZWZlcmVuY2UgdG8gYmUgdXNlZCBhcyB0ZW1wbGF0ZSBwbGFjZWhvbGRlcnMgb3IgcXVlcnkgcGFyYW1zXG5jb25zdCBwYWdlUGFyYW1zID0gT2JqZWN0LmZyZWV6ZSh7XG4gIGFwcE5hbWU6ICdhcHBOYW1lJyxcbiAgYXBwSWQ6ICdhcHBJZCcsXG4gIHRva2VuOiAndG9rZW4nLFxuICB1c2VybmFtZTogJ3VzZXJuYW1lJyxcbiAgZXJyb3I6ICdlcnJvcicsXG4gIGxvY2FsZTogJ2xvY2FsZScsXG4gIHB1YmxpY1NlcnZlclVybDogJ3B1YmxpY1NlcnZlclVybCcsXG59KTtcblxuLy8gVGhlIGhlYWRlciBwcmVmaXggdG8gYWRkIHBhZ2UgcGFyYW1zIGFzIHJlc3BvbnNlIGhlYWRlcnNcbmNvbnN0IHBhZ2VQYXJhbUhlYWRlclByZWZpeCA9ICd4LXBhcnNlLXBhZ2UtcGFyYW0tJztcblxuLy8gVGhlIGVycm9ycyBiZWluZyB0aHJvd25cbmNvbnN0IGVycm9ycyA9IE9iamVjdC5mcmVlemUoe1xuICBqc29uRmFpbGVkRmlsZUxvYWRpbmc6ICdmYWlsZWQgdG8gbG9hZCBKU09OIGZpbGUnLFxuICBmaWxlT3V0c2lkZUFsbG93ZWRTY29wZTogJ25vdCBhbGxvd2VkIHRvIHJlYWQgZmlsZSBvdXRzaWRlIG9mIHBhZ2VzIGRpcmVjdG9yeScsXG59KTtcblxuZXhwb3J0IGNsYXNzIFBhZ2VzUm91dGVyIGV4dGVuZHMgUHJvbWlzZVJvdXRlciB7XG4gIC8qKlxuICAgKiBDb25zdHJ1Y3RzIGEgUGFnZXNSb3V0ZXIuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBwYWdlcyBUaGUgcGFnZXMgb3B0aW9ucyBmcm9tIHRoZSBQYXJzZSBTZXJ2ZXIgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHBhZ2VzID0ge30pIHtcbiAgICBzdXBlcigpO1xuXG4gICAgLy8gU2V0IGluc3RhbmNlIHByb3BlcnRpZXNcbiAgICB0aGlzLnBhZ2VzQ29uZmlnID0gcGFnZXM7XG4gICAgdGhpcy5wYWdlc0VuZHBvaW50ID0gcGFnZXMucGFnZXNFbmRwb2ludCA/IHBhZ2VzLnBhZ2VzRW5kcG9pbnQgOiAnYXBwcyc7XG4gICAgdGhpcy5wYWdlc1BhdGggPSBwYWdlcy5wYWdlc1BhdGhcbiAgICAgID8gcGF0aC5yZXNvbHZlKCcuLycsIHBhZ2VzLnBhZ2VzUGF0aClcbiAgICAgIDogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3B1YmxpYycpO1xuICAgIHRoaXMubG9hZEpzb25SZXNvdXJjZSgpO1xuICAgIHRoaXMubW91bnRQYWdlc1JvdXRlcygpO1xuICAgIHRoaXMubW91bnRDdXN0b21Sb3V0ZXMoKTtcbiAgICB0aGlzLm1vdW50U3RhdGljUm91dGUoKTtcbiAgfVxuXG4gIHZlcmlmeUVtYWlsKHJlcSkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHJlcS5jb25maWc7XG4gICAgY29uc3QgeyB0b2tlbjogcmF3VG9rZW4gfSA9IHJlcS5xdWVyeTtcbiAgICBjb25zdCB0b2tlbiA9IHR5cGVvZiByYXdUb2tlbiA9PT0gJ3N0cmluZycgPyByYXdUb2tlbiA6IHVuZGVmaW5lZDtcblxuICAgIGlmICghY29uZmlnKSB7XG4gICAgICB0aGlzLmludmFsaWRSZXF1ZXN0KCk7XG4gICAgfVxuXG4gICAgaWYgKCF0b2tlbikge1xuICAgICAgcmV0dXJuIHRoaXMuZ29Ub1BhZ2UocmVxLCBwYWdlcy5lbWFpbFZlcmlmaWNhdGlvbkxpbmtJbnZhbGlkKTtcbiAgICB9XG5cbiAgICBjb25zdCB1c2VyQ29udHJvbGxlciA9IGNvbmZpZy51c2VyQ29udHJvbGxlcjtcbiAgICByZXR1cm4gdXNlckNvbnRyb2xsZXIudmVyaWZ5RW1haWwodG9rZW4pLnRoZW4oXG4gICAgICAoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLmdvVG9QYWdlKHJlcSwgcGFnZXMuZW1haWxWZXJpZmljYXRpb25TdWNjZXNzKTtcbiAgICAgIH0sXG4gICAgICAoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLmdvVG9QYWdlKHJlcSwgcGFnZXMuZW1haWxWZXJpZmljYXRpb25MaW5rSW52YWxpZCk7XG4gICAgICB9XG4gICAgKTtcbiAgfVxuXG4gIHJlc2VuZFZlcmlmaWNhdGlvbkVtYWlsKHJlcSkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHJlcS5jb25maWc7XG4gICAgY29uc3QgdXNlcm5hbWUgPSByZXEuYm9keT8udXNlcm5hbWU7XG4gICAgY29uc3QgcmF3VG9rZW4gPSByZXEuYm9keT8udG9rZW47XG4gICAgY29uc3QgdG9rZW4gPSB0eXBlb2YgcmF3VG9rZW4gPT09ICdzdHJpbmcnID8gcmF3VG9rZW4gOiB1bmRlZmluZWQ7XG5cbiAgICBpZiAoIWNvbmZpZykge1xuICAgICAgdGhpcy5pbnZhbGlkUmVxdWVzdCgpO1xuICAgIH1cblxuICAgIGlmICghdXNlcm5hbWUgJiYgIXRva2VuKSB7XG4gICAgICByZXR1cm4gdGhpcy5nb1RvUGFnZShyZXEsIHBhZ2VzLmVtYWlsVmVyaWZpY2F0aW9uTGlua0ludmFsaWQpO1xuICAgIH1cblxuICAgIGNvbnN0IHVzZXJDb250cm9sbGVyID0gY29uZmlnLnVzZXJDb250cm9sbGVyO1xuICAgIGNvbnN0IHN1cHByZXNzRXJyb3IgPSBjb25maWcuZW1haWxWZXJpZnlTdWNjZXNzT25JbnZhbGlkRW1haWwgPz8gdHJ1ZTtcblxuICAgIHJldHVybiB1c2VyQ29udHJvbGxlci5yZXNlbmRWZXJpZmljYXRpb25FbWFpbCh1c2VybmFtZSwgcmVxLCB0b2tlbikudGhlbihcbiAgICAgICgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ29Ub1BhZ2UocmVxLCBwYWdlcy5lbWFpbFZlcmlmaWNhdGlvblNlbmRTdWNjZXNzKTtcbiAgICAgIH0sXG4gICAgICAoKSA9PiB7XG4gICAgICAgIGlmIChzdXBwcmVzc0Vycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuZ29Ub1BhZ2UocmVxLCBwYWdlcy5lbWFpbFZlcmlmaWNhdGlvblNlbmRTdWNjZXNzKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5nb1RvUGFnZShyZXEsIHBhZ2VzLmVtYWlsVmVyaWZpY2F0aW9uU2VuZEZhaWwpO1xuICAgICAgfVxuICAgICk7XG4gIH1cblxuICBwYXNzd29yZFJlc2V0KHJlcSkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHJlcS5jb25maWc7XG4gICAgY29uc3QgcGFyYW1zID0ge1xuICAgICAgW3BhZ2VQYXJhbXMuYXBwSWRdOiByZXEucGFyYW1zLmFwcElkLFxuICAgICAgW3BhZ2VQYXJhbXMuYXBwTmFtZV06IGNvbmZpZy5hcHBOYW1lLFxuICAgICAgW3BhZ2VQYXJhbXMudG9rZW5dOiByZXEucXVlcnkudG9rZW4sXG4gICAgICBbcGFnZVBhcmFtcy51c2VybmFtZV06IHJlcS5xdWVyeS51c2VybmFtZSxcbiAgICAgIFtwYWdlUGFyYW1zLnB1YmxpY1NlcnZlclVybF06IGNvbmZpZy5wdWJsaWNTZXJ2ZXJVUkwsXG4gICAgfTtcbiAgICByZXR1cm4gdGhpcy5nb1RvUGFnZShyZXEsIHBhZ2VzLnBhc3N3b3JkUmVzZXQsIHBhcmFtcyk7XG4gIH1cblxuICByZXF1ZXN0UmVzZXRQYXNzd29yZChyZXEpIHtcbiAgICBjb25zdCBjb25maWcgPSByZXEuY29uZmlnO1xuXG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgIHRoaXMuaW52YWxpZFJlcXVlc3QoKTtcbiAgICB9XG5cbiAgICBjb25zdCB7IHRva2VuOiByYXdUb2tlbiB9ID0gcmVxLnF1ZXJ5O1xuICAgIGNvbnN0IHRva2VuID0gdHlwZW9mIHJhd1Rva2VuID09PSAnc3RyaW5nJyA/IHJhd1Rva2VuIDogdW5kZWZpbmVkO1xuXG4gICAgaWYgKCF0b2tlbikge1xuICAgICAgcmV0dXJuIHRoaXMuZ29Ub1BhZ2UocmVxLCBwYWdlcy5wYXNzd29yZFJlc2V0TGlua0ludmFsaWQpO1xuICAgIH1cblxuICAgIHJldHVybiBjb25maWcudXNlckNvbnRyb2xsZXIuY2hlY2tSZXNldFRva2VuVmFsaWRpdHkodG9rZW4pLnRoZW4oXG4gICAgICAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHBhcmFtcyA9IHtcbiAgICAgICAgICBbcGFnZVBhcmFtcy50b2tlbl06IHRva2VuLFxuICAgICAgICAgIFtwYWdlUGFyYW1zLmFwcElkXTogY29uZmlnLmFwcGxpY2F0aW9uSWQsXG4gICAgICAgICAgW3BhZ2VQYXJhbXMuYXBwTmFtZV06IGNvbmZpZy5hcHBOYW1lLFxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gdGhpcy5nb1RvUGFnZShyZXEsIHBhZ2VzLnBhc3N3b3JkUmVzZXQsIHBhcmFtcyk7XG4gICAgICB9LFxuICAgICAgKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5nb1RvUGFnZShyZXEsIHBhZ2VzLnBhc3N3b3JkUmVzZXRMaW5rSW52YWxpZCk7XG4gICAgICB9XG4gICAgKTtcbiAgfVxuXG4gIHJlc2V0UGFzc3dvcmQocmVxKSB7XG4gICAgY29uc3QgY29uZmlnID0gcmVxLmNvbmZpZztcblxuICAgIGlmICghY29uZmlnKSB7XG4gICAgICB0aGlzLmludmFsaWRSZXF1ZXN0KCk7XG4gICAgfVxuXG4gICAgY29uc3QgeyBuZXdfcGFzc3dvcmQsIHRva2VuOiByYXdUb2tlbiB9ID0gcmVxLmJvZHkgfHwge307XG4gICAgY29uc3QgdG9rZW4gPSB0eXBlb2YgcmF3VG9rZW4gPT09ICdzdHJpbmcnID8gcmF3VG9rZW4gOiB1bmRlZmluZWQ7XG5cbiAgICBpZiAoKCF0b2tlbiB8fCAhbmV3X3Bhc3N3b3JkKSAmJiByZXEueGhyID09PSBmYWxzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuZ29Ub1BhZ2UocmVxLCBwYWdlcy5wYXNzd29yZFJlc2V0TGlua0ludmFsaWQpO1xuICAgIH1cblxuICAgIGlmICghdG9rZW4pIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PVEhFUl9DQVVTRSwgJ01pc3NpbmcgdG9rZW4nKTtcbiAgICB9XG5cbiAgICBpZiAoIW5ld19wYXNzd29yZCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBBU1NXT1JEX01JU1NJTkcsICdNaXNzaW5nIHBhc3N3b3JkJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbmZpZy51c2VyQ29udHJvbGxlclxuICAgICAgLnVwZGF0ZVBhc3N3b3JkKHRva2VuLCBuZXdfcGFzc3dvcmQpXG4gICAgICAudGhlbihcbiAgICAgICAgKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSxcbiAgICAgICAgZXJyID0+IHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgZXJyLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICApXG4gICAgICAudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICBpZiAocmVxLnhocikge1xuICAgICAgICAgIGlmIChyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgICAgICByZXNwb25zZTogJ1Bhc3N3b3JkIHN1Y2Nlc3NmdWxseSByZXNldCcsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHJlc3VsdC5lcnIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PVEhFUl9DQVVTRSwgYCR7cmVzdWx0LmVycn1gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBxdWVyeSA9IHJlc3VsdC5zdWNjZXNzXG4gICAgICAgICAgPyB7fVxuICAgICAgICAgIDoge1xuICAgICAgICAgICAgW3BhZ2VQYXJhbXMudG9rZW5dOiB0b2tlbixcbiAgICAgICAgICAgIFtwYWdlUGFyYW1zLmFwcElkXTogY29uZmlnLmFwcGxpY2F0aW9uSWQsXG4gICAgICAgICAgICBbcGFnZVBhcmFtcy5lcnJvcl06IHJlc3VsdC5lcnIsXG4gICAgICAgICAgICBbcGFnZVBhcmFtcy5hcHBOYW1lXTogY29uZmlnLmFwcE5hbWUsXG4gICAgICAgICAgfTtcblxuICAgICAgICBpZiAocmVzdWx0Py5lcnIgPT09ICdUaGUgcGFzc3dvcmQgcmVzZXQgbGluayBoYXMgZXhwaXJlZCcpIHtcbiAgICAgICAgICBkZWxldGUgcXVlcnlbcGFnZVBhcmFtcy50b2tlbl07XG4gICAgICAgICAgcXVlcnlbcGFnZVBhcmFtcy50b2tlbl0gPSB0b2tlbjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYWdlID0gcmVzdWx0LnN1Y2Nlc3MgPyBwYWdlcy5wYXNzd29yZFJlc2V0U3VjY2VzcyA6IHBhZ2VzLnBhc3N3b3JkUmVzZXQ7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZ29Ub1BhZ2UocmVxLCBwYWdlLCBxdWVyeSwgZmFsc2UpO1xuICAgICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBwYWdlIGNvbnRlbnQgaWYgdGhlIHBhZ2UgaXMgYSBsb2NhbCBmaWxlIG9yIHJldHVybnMgYVxuICAgKiByZWRpcmVjdCB0byBhIGN1c3RvbSBwYWdlLlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxIFRoZSBleHByZXNzIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7UGFnZX0gcGFnZSBUaGUgcGFnZSB0byBnbyB0by5cbiAgICogQHBhcmFtIHtPYmplY3R9IFtwYXJhbXM9e31dIFRoZSBxdWVyeSBwYXJhbWV0ZXJzIHRvIGF0dGFjaCB0byB0aGUgVVJMIGluIGNhc2Ugb2ZcbiAgICogSFRUUCByZWRpcmVjdCByZXNwb25zZXMgZm9yIFBPU1QgcmVxdWVzdHMsIG9yIHRoZSBwbGFjZWhvbGRlcnMgdG8gZmlsbCBpbnRvXG4gICAqIHRoZSByZXNwb25zZSBjb250ZW50IGluIGNhc2Ugb2YgSFRUUCBjb250ZW50IHJlc3BvbnNlcyBmb3IgR0VUIHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge0Jvb2xlYW59IFtyZXNwb25zZVR5cGVdIElzIHRydWUgaWYgYSByZWRpcmVjdCByZXNwb25zZSBzaG91bGQgYmUgZm9yY2VkLFxuICAgKiBmYWxzZSBpZiBhIGNvbnRlbnQgcmVzcG9uc2Ugc2hvdWxkIGJlIGZvcmNlZCwgdW5kZWZpbmVkIGlmIHRoZSByZXNwb25zZSB0eXBlXG4gICAqIHNob3VsZCBkZXBlbmQgb24gdGhlIHJlcXVlc3QgdHlwZSBieSBkZWZhdWx0OlxuICAgKiAtIEdFVCByZXF1ZXN0IC0+IGNvbnRlbnQgcmVzcG9uc2VcbiAgICogLSBQT1NUIHJlcXVlc3QgLT4gcmVkaXJlY3QgcmVzcG9uc2UgKFBSRyBwYXR0ZXJuKVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBUaGUgUHJvbWlzZVJvdXRlciByZXNwb25zZS5cbiAgICovXG4gIGdvVG9QYWdlKHJlcSwgcGFnZSwgcGFyYW1zID0ge30sIHJlc3BvbnNlVHlwZSkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHJlcS5jb25maWc7XG5cbiAgICAvLyBEZXRlcm1pbmUgcmVkaXJlY3QgZWl0aGVyIGJ5IGZvcmNlLCByZXNwb25zZSBzZXR0aW5nIG9yIHJlcXVlc3QgbWV0aG9kXG4gICAgY29uc3QgcmVkaXJlY3QgPSBjb25maWcucGFnZXMuZm9yY2VSZWRpcmVjdFxuICAgICAgPyB0cnVlXG4gICAgICA6IHJlc3BvbnNlVHlwZSAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8gcmVzcG9uc2VUeXBlXG4gICAgICAgIDogcmVxLm1ldGhvZCA9PSAnUE9TVCc7XG5cbiAgICAvLyBJbmNsdWRlIGRlZmF1bHQgcGFyYW1ldGVyc1xuICAgIGNvbnN0IGRlZmF1bHRQYXJhbXMgPSB0aGlzLmdldERlZmF1bHRQYXJhbXMoY29uZmlnKTtcbiAgICBpZiAoT2JqZWN0LnZhbHVlcyhkZWZhdWx0UGFyYW1zKS5pbmNsdWRlcyh1bmRlZmluZWQpKSB7XG4gICAgICByZXR1cm4gdGhpcy5ub3RGb3VuZCgpO1xuICAgIH1cbiAgICBwYXJhbXMgPSBPYmplY3QuYXNzaWduKHBhcmFtcywgZGVmYXVsdFBhcmFtcyk7XG5cbiAgICAvLyBBZGQgbG9jYWxlIHRvIHBhcmFtcyB0byBlbnN1cmUgaXQgaXMgcGFzc2VkIG9uIHdpdGggZXZlcnkgcmVxdWVzdDtcbiAgICAvLyB0aGF0IG1lYW5zLCBvbmNlIGEgbG9jYWxlIGlzIHNldCwgaXQgaXMgcGFzc2VkIG9uIHRvIGFueSBmb2xsb3ctdXAgcGFnZSxcbiAgICAvLyBlLmcuIHJlcXVlc3RfcGFzc3dvcmRfcmVzZXQgLT4gcGFzc3dvcmRfcmVzZXQgLT4gcGFzc3dvcmRfcmVzZXRfc3VjY2Vzc1xuICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuZ2V0TG9jYWxlKHJlcSk7XG4gICAgcGFyYW1zW3BhZ2VQYXJhbXMubG9jYWxlXSA9IGxvY2FsZTtcblxuICAgIC8vIENvbXBvc2UgcGF0aHMgYW5kIFVSTHNcbiAgICBjb25zdCBkZWZhdWx0RmlsZSA9IHBhZ2UuZGVmYXVsdEZpbGU7XG4gICAgY29uc3QgZGVmYXVsdFBhdGggPSB0aGlzLmRlZmF1bHRQYWdlUGF0aChkZWZhdWx0RmlsZSk7XG4gICAgY29uc3QgZGVmYXVsdFVybCA9IHRoaXMuY29tcG9zZVBhZ2VVcmwoZGVmYXVsdEZpbGUsIGNvbmZpZy5wdWJsaWNTZXJ2ZXJVUkwpO1xuXG4gICAgLy8gSWYgY3VzdG9tIFVSTCBpcyBzZXQgcmVkaXJlY3QgdG8gaXQgd2l0aG91dCBsb2NhbGl6YXRpb25cbiAgICBjb25zdCBjdXN0b21VcmwgPSBjb25maWcucGFnZXMuY3VzdG9tVXJsc1twYWdlLmlkXTtcbiAgICBpZiAoY3VzdG9tVXJsICYmICFVdGlscy5pc1BhdGgoY3VzdG9tVXJsKSkge1xuICAgICAgcmV0dXJuIHRoaXMucmVkaXJlY3RSZXNwb25zZShjdXN0b21VcmwsIHBhcmFtcyk7XG4gICAgfVxuXG4gICAgLy8gR2V0IEpTT04gcGxhY2Vob2xkZXJzXG4gICAgbGV0IHBsYWNlaG9sZGVycyA9IHt9O1xuICAgIGlmIChjb25maWcucGFnZXMuZW5hYmxlTG9jYWxpemF0aW9uICYmIGNvbmZpZy5wYWdlcy5sb2NhbGl6YXRpb25Kc29uUGF0aCkge1xuICAgICAgcGxhY2Vob2xkZXJzID0gdGhpcy5nZXRKc29uUGxhY2Vob2xkZXJzKGxvY2FsZSwgcGFyYW1zKTtcbiAgICB9XG5cbiAgICAvLyBTZW5kIHJlc3BvbnNlXG4gICAgaWYgKGNvbmZpZy5wYWdlcy5lbmFibGVMb2NhbGl6YXRpb24gJiYgbG9jYWxlKSB7XG4gICAgICByZXR1cm4gVXRpbHMuZ2V0TG9jYWxpemVkUGF0aChkZWZhdWx0UGF0aCwgbG9jYWxlKS50aGVuKCh7IHBhdGgsIHN1YmRpciB9KSA9PlxuICAgICAgICByZWRpcmVjdFxuICAgICAgICAgID8gdGhpcy5yZWRpcmVjdFJlc3BvbnNlKFxuICAgICAgICAgICAgdGhpcy5jb21wb3NlUGFnZVVybChkZWZhdWx0RmlsZSwgY29uZmlnLnB1YmxpY1NlcnZlclVSTCwgc3ViZGlyKSxcbiAgICAgICAgICAgIHBhcmFtc1xuICAgICAgICAgIClcbiAgICAgICAgICA6IHRoaXMucGFnZVJlc3BvbnNlKHBhdGgsIHBhcmFtcywgcGxhY2Vob2xkZXJzKVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHJlZGlyZWN0XG4gICAgICAgID8gdGhpcy5yZWRpcmVjdFJlc3BvbnNlKGRlZmF1bHRVcmwsIHBhcmFtcylcbiAgICAgICAgOiB0aGlzLnBhZ2VSZXNwb25zZShkZWZhdWx0UGF0aCwgcGFyYW1zLCBwbGFjZWhvbGRlcnMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJ2ZXMgYSByZXF1ZXN0IHRvIGEgc3RhdGljIHJlc291cmNlIGFuZCBsb2NhbGl6ZXMgdGhlIHJlc291cmNlIGlmIGl0XG4gICAqIGlzIGEgSFRNTCBmaWxlLlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gVGhlIHJlc3BvbnNlLlxuICAgKi9cbiAgc3RhdGljUm91dGUocmVxKSB7XG4gICAgLy8gR2V0IHJlcXVlc3RlZCBwYXRoXG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcmVxLnBhcmFtc1sncmVzb3VyY2UnXVswXTtcblxuICAgIC8vIFJlc29sdmUgcmVxdWVzdGVkIHBhdGggdG8gYWJzb2x1dGUgcGF0aFxuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHBhdGgucmVzb2x2ZSh0aGlzLnBhZ2VzUGF0aCwgcmVsYXRpdmVQYXRoKTtcblxuICAgIC8vIElmIHRoZSByZXF1ZXN0ZWQgZmlsZSBpcyBub3QgYSBIVE1MIGZpbGUgc2VuZCBpdHMgcmF3IGNvbnRlbnRcbiAgICBpZiAoIWFic29sdXRlUGF0aCB8fCAhYWJzb2x1dGVQYXRoLmVuZHNXaXRoKCcuaHRtbCcpKSB7XG4gICAgICByZXR1cm4gdGhpcy5maWxlUmVzcG9uc2UoYWJzb2x1dGVQYXRoKTtcbiAgICB9XG5cbiAgICAvLyBHZXQgcGFyYW1ldGVyc1xuICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuZ2V0RGVmYXVsdFBhcmFtcyhyZXEuY29uZmlnKTtcbiAgICBjb25zdCBsb2NhbGUgPSB0aGlzLmdldExvY2FsZShyZXEpO1xuICAgIGlmIChsb2NhbGUpIHtcbiAgICAgIHBhcmFtcy5sb2NhbGUgPSBsb2NhbGU7XG4gICAgfVxuXG4gICAgLy8gR2V0IEpTT04gcGxhY2Vob2xkZXJzXG4gICAgY29uc3QgcGxhY2Vob2xkZXJzID0gdGhpcy5nZXRKc29uUGxhY2Vob2xkZXJzKGxvY2FsZSwgcGFyYW1zKTtcblxuICAgIHJldHVybiB0aGlzLnBhZ2VSZXNwb25zZShhYnNvbHV0ZVBhdGgsIHBhcmFtcywgcGxhY2Vob2xkZXJzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgdHJhbnNsYXRpb24gZnJvbSB0aGUgSlNPTiByZXNvdXJjZSBmb3IgYSBnaXZlbiBsb2NhbGUuIFRoZSBKU09OXG4gICAqIHJlc291cmNlIGlzIHBhcnNlZCBhY2NvcmRpbmcgdG8gaTE4bmV4dCBzeW50YXguXG4gICAqXG4gICAqIEV4YW1wbGUgSlNPTiBjb250ZW50OlxuICAgKiBgYGBqc1xuICAgKiAge1xuICAgKiAgICBcImVuXCI6IHsgICAgICAgICAgICAgICAvLyByZXNvdXJjZSBmb3IgbGFuZ3VhZ2UgYGVuYCAoRW5nbGlzaClcbiAgICogICAgICBcInRyYW5zbGF0aW9uXCI6IHtcbiAgICogICAgICAgIFwiZ3JlZXRpbmdcIjogXCJIZWxsbyFcIlxuICAgKiAgICAgIH1cbiAgICogICAgfSxcbiAgICogICAgXCJkZVwiOiB7ICAgICAgICAgICAgICAgLy8gcmVzb3VyY2UgZm9yIGxhbmd1YWdlIGBkZWAgKEdlcm1hbilcbiAgICogICAgICBcInRyYW5zbGF0aW9uXCI6IHtcbiAgICogICAgICAgIFwiZ3JlZXRpbmdcIjogXCJIYWxsbyFcIlxuICAgKiAgICAgIH1cbiAgICogICAgfVxuICAgKiAgICBcImRlLUNIXCI6IHsgICAgICAgICAgICAvLyByZXNvdXJjZSBmb3IgbG9jYWxlIGBkZS1DSGAgKFN3aXNzIEdlcm1hbilcbiAgICogICAgICBcInRyYW5zbGF0aW9uXCI6IHtcbiAgICogICAgICAgIFwiZ3JlZXRpbmdcIjogXCJHcsO8ZXppIVwiXG4gICAqICAgICAgfVxuICAgKiAgICB9XG4gICAqICB9XG4gICAqIGBgYFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbG9jYWxlIFRoZSBsb2NhbGUgdG8gdHJhbnNsYXRlIHRvLlxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBUaGUgdHJhbnNsYXRpb24gb3IgYW4gZW1wdHkgb2JqZWN0IGlmIG5vIG1hdGNoaW5nXG4gICAqIHRyYW5zbGF0aW9uIHdhcyBmb3VuZC5cbiAgICovXG4gIGdldEpzb25UcmFuc2xhdGlvbihsb2NhbGUpIHtcbiAgICAvLyBJZiB0aGVyZSBpcyBubyBKU09OIHJlc291cmNlXG4gICAgaWYgKHRoaXMuanNvblBhcmFtZXRlcnMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHt9O1xuICAgIH1cblxuICAgIC8vIElmIGxvY2FsZSBpcyBub3Qgc2V0IHVzZSB0aGUgZmFsbGJhY2sgbG9jYWxlXG4gICAgbG9jYWxlID0gbG9jYWxlIHx8IHRoaXMucGFnZXNDb25maWcubG9jYWxpemF0aW9uRmFsbGJhY2tMb2NhbGU7XG5cbiAgICAvLyBHZXQgbWF0Y2hpbmcgdHJhbnNsYXRpb24gYnkgbG9jYWxlLCBsYW5ndWFnZSBvciBmYWxsYmFjayBsb2NhbGVcbiAgICBjb25zdCBsYW5ndWFnZSA9IGxvY2FsZS5zcGxpdCgnLScpWzBdO1xuICAgIGNvbnN0IHJlc291cmNlID1cbiAgICAgIHRoaXMuanNvblBhcmFtZXRlcnNbbG9jYWxlXSB8fFxuICAgICAgdGhpcy5qc29uUGFyYW1ldGVyc1tsYW5ndWFnZV0gfHxcbiAgICAgIHRoaXMuanNvblBhcmFtZXRlcnNbdGhpcy5wYWdlc0NvbmZpZy5sb2NhbGl6YXRpb25GYWxsYmFja0xvY2FsZV0gfHxcbiAgICAgIHt9O1xuICAgIGNvbnN0IHRyYW5zbGF0aW9uID0gcmVzb3VyY2UudHJhbnNsYXRpb24gfHwge307XG4gICAgcmV0dXJuIHRyYW5zbGF0aW9uO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSB0cmFuc2xhdGlvbiBmcm9tIHRoZSBKU09OIHJlc291cmNlIGZvciBhIGdpdmVuIGxvY2FsZSB3aXRoXG4gICAqIHBsYWNlaG9sZGVycyBmaWxsZWQgaW4gYnkgZ2l2ZW4gcGFyYW1ldGVycy5cbiAgICogQHBhcmFtIHtTdHJpbmd9IGxvY2FsZSBUaGUgbG9jYWxlIHRvIHRyYW5zbGF0ZSB0by5cbiAgICogQHBhcmFtIHtPYmplY3R9IHBhcmFtcyBUaGUgcGFyYW1ldGVycyB0byBmaWxsIGludG8gYW55IHBsYWNlaG9sZGVyc1xuICAgKiB3aXRoaW4gdGhlIHRyYW5zbGF0aW9ucy5cbiAgICogQHJldHVybnMge09iamVjdH0gVGhlIHRyYW5zbGF0aW9uIG9yIGFuIGVtcHR5IG9iamVjdCBpZiBubyBtYXRjaGluZ1xuICAgKiB0cmFuc2xhdGlvbiB3YXMgZm91bmQuXG4gICAqL1xuICBnZXRKc29uUGxhY2Vob2xkZXJzKGxvY2FsZSwgcGFyYW1zID0ge30pIHtcbiAgICAvLyBJZiBsb2NhbGl6YXRpb24gaXMgZGlzYWJsZWQgb3IgdGhlcmUgaXMgbm8gSlNPTiByZXNvdXJjZVxuICAgIGlmICghdGhpcy5wYWdlc0NvbmZpZy5lbmFibGVMb2NhbGl6YXRpb24gfHwgIXRoaXMucGFnZXNDb25maWcubG9jYWxpemF0aW9uSnNvblBhdGgpIHtcbiAgICAgIHJldHVybiB7fTtcbiAgICB9XG5cbiAgICAvLyBHZXQgSlNPTiBwbGFjZWhvbGRlcnNcbiAgICBsZXQgcGxhY2Vob2xkZXJzID0gdGhpcy5nZXRKc29uVHJhbnNsYXRpb24obG9jYWxlKTtcblxuICAgIC8vIEZpbGwgaW4gYW55IHBsYWNlaG9sZGVycyBpbiB0aGUgdHJhbnNsYXRpb247IHRoaXMgYWxsb3dzIGEgdHJhbnNsYXRpb25cbiAgICAvLyB0byBjb250YWluIGRlZmF1bHQgcGxhY2Vob2xkZXJzIGxpa2Uge3thcHBOYW1lfX0gd2hpY2ggYXJlIGZpbGxlZCBoZXJlXG4gICAgcGxhY2Vob2xkZXJzID0gSlNPTi5zdHJpbmdpZnkocGxhY2Vob2xkZXJzKTtcbiAgICBwbGFjZWhvbGRlcnMgPSBtdXN0YWNoZS5yZW5kZXIocGxhY2Vob2xkZXJzLCBwYXJhbXMpO1xuICAgIHBsYWNlaG9sZGVycyA9IEpTT04ucGFyc2UocGxhY2Vob2xkZXJzKTtcblxuICAgIHJldHVybiBwbGFjZWhvbGRlcnM7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHJlc3BvbnNlIHdpdGggZmlsZSBjb250ZW50LlxuICAgKiBAcGFyYW0ge1N0cmluZ30gcGF0aCBUaGUgcGF0aCBvZiB0aGUgZmlsZSB0byByZXR1cm4uXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbcGFyYW1zPXt9XSBUaGUgcGFyYW1ldGVycyB0byBiZSBpbmNsdWRlZCBpbiB0aGUgcmVzcG9uc2VcbiAgICogaGVhZGVyLiBUaGVzZSB3aWxsIGFsc28gYmUgdXNlZCB0byBmaWxsIHBsYWNlaG9sZGVycy5cbiAgICogQHBhcmFtIHtPYmplY3R9IFtwbGFjZWhvbGRlcnM9e31dIFRoZSBwbGFjZWhvbGRlcnMgdG8gZmlsbCBpbiB0aGUgY29udGVudC5cbiAgICogVGhlc2Ugd2lsbCBub3QgYmUgaW5jbHVkZWQgaW4gdGhlIHJlc3BvbnNlIGhlYWRlci5cbiAgICogQHJldHVybnMge09iamVjdH0gVGhlIFByb21pc2UgUm91dGVyIHJlc3BvbnNlLlxuICAgKi9cbiAgYXN5bmMgcGFnZVJlc3BvbnNlKHBhdGgsIHBhcmFtcyA9IHt9LCBwbGFjZWhvbGRlcnMgPSB7fSkge1xuICAgIC8vIEdldCBmaWxlIGNvbnRlbnRcbiAgICBsZXQgZGF0YTtcbiAgICB0cnkge1xuICAgICAgZGF0YSA9IGF3YWl0IHRoaXMucmVhZEZpbGUocGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gdGhpcy5ub3RGb3VuZCgpO1xuICAgIH1cblxuICAgIC8vIEdldCBjb25maWcgcGxhY2Vob2xkZXJzOyBjYW4gYmUgYW4gb2JqZWN0LCBhIGZ1bmN0aW9uIG9yIGFuIGFzeW5jIGZ1bmN0aW9uXG4gICAgbGV0IGNvbmZpZ1BsYWNlaG9sZGVycyA9XG4gICAgICB0eXBlb2YgdGhpcy5wYWdlc0NvbmZpZy5wbGFjZWhvbGRlcnMgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB0aGlzLnBhZ2VzQ29uZmlnLnBsYWNlaG9sZGVycyhwYXJhbXMpXG4gICAgICAgIDogT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHRoaXMucGFnZXNDb25maWcucGxhY2Vob2xkZXJzKSA9PT0gJ1tvYmplY3QgT2JqZWN0XSdcbiAgICAgICAgICA/IHRoaXMucGFnZXNDb25maWcucGxhY2Vob2xkZXJzXG4gICAgICAgICAgOiB7fTtcbiAgICBpZiAoVXRpbHMuaXNQcm9taXNlKGNvbmZpZ1BsYWNlaG9sZGVycykpIHtcbiAgICAgIGNvbmZpZ1BsYWNlaG9sZGVycyA9IGF3YWl0IGNvbmZpZ1BsYWNlaG9sZGVycztcbiAgICB9XG5cbiAgICAvLyBGaWxsIHBsYWNlaG9sZGVyc1xuICAgIGNvbnN0IGFsbFBsYWNlaG9sZGVycyA9IE9iamVjdC5hc3NpZ24oe30sIGNvbmZpZ1BsYWNlaG9sZGVycywgcGxhY2Vob2xkZXJzKTtcbiAgICBjb25zdCBwYXJhbXNBbmRQbGFjZWhvbGRlcnMgPSBPYmplY3QuYXNzaWduKHt9LCBwYXJhbXMsIGFsbFBsYWNlaG9sZGVycyk7XG4gICAgZGF0YSA9IG11c3RhY2hlLnJlbmRlcihkYXRhLCBwYXJhbXNBbmRQbGFjZWhvbGRlcnMpO1xuXG4gICAgLy8gQWRkIHBsYWNlaG9sZGVycyBpbiBoZWFkZXIgdG8gYWxsb3cgcGFyc2luZyBmb3IgcHJvZ3JhbW1hdGljIHVzZVxuICAgIC8vIG9mIHJlc3BvbnNlLCBpbnN0ZWFkIG9mIGhhdmluZyB0byBwYXJzZSB0aGUgSFRNTCBjb250ZW50LlxuICAgIGNvbnN0IGhlYWRlcnMgPSB0aGlzLmNvbXBvc2VQYWdlUGFyYW1IZWFkZXJzKHBhcmFtcyk7XG5cbiAgICByZXR1cm4geyB0ZXh0OiBkYXRhLCBoZWFkZXJzOiBoZWFkZXJzIH07XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHJlc3BvbnNlIHdpdGggZmlsZSBjb250ZW50LlxuICAgKiBAcGFyYW0ge1N0cmluZ30gcGF0aCBUaGUgcGF0aCBvZiB0aGUgZmlsZSB0byByZXR1cm4uXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IFRoZSBQcm9taXNlUm91dGVyIHJlc3BvbnNlLlxuICAgKi9cbiAgYXN5bmMgZmlsZVJlc3BvbnNlKHBhdGgpIHtcbiAgICAvLyBHZXQgZmlsZSBjb250ZW50XG4gICAgbGV0IGRhdGE7XG4gICAgdHJ5IHtcbiAgICAgIGRhdGEgPSBhd2FpdCB0aGlzLnJlYWRGaWxlKHBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHRoaXMubm90Rm91bmQoKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyB0ZXh0OiBkYXRhIH07XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYW5kIHJldHVybnMgdGhlIGNvbnRlbnQgb2YgYSBmaWxlIGF0IGEgZ2l2ZW4gcGF0aC4gRmlsZSByZWFkaW5nIHRvXG4gICAqIHNlcnZlIGNvbnRlbnQgb24gdGhlIHN0YXRpYyByb3V0ZSBpcyBvbmx5IGFsbG93ZWQgZnJvbSB0aGUgcGFnZXNcbiAgICogZGlyZWN0b3J5IG9uIGRvd253YXJkcy5cbiAgICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICogKipXQVJOSU5HOioqIEFsbCBmaWxlIHJlYWRzIGluIHRoZSBQYWdlc1JvdXRlciBtdXN0IGJlIGV4ZWN1dGVkIGJ5IHRoaXNcbiAgICogd3JhcHBlciBiZWNhdXNlIGl0IGFsc28gZGV0ZWN0cyBhbmQgcHJldmVudHMgY29tbW9uIGV4cGxvaXRzLlxuICAgKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgKiBAcGFyYW0ge1N0cmluZ30gZmlsZVBhdGggVGhlIHBhdGggdG8gdGhlIGZpbGUgdG8gcmVhZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3RyaW5nPn0gVGhlIGZpbGUgY29udGVudC5cbiAgICovXG4gIGFzeW5jIHJlYWRGaWxlKGZpbGVQYXRoKSB7XG4gICAgLy8gTm9ybWFsaXplIHBhdGggdG8gcHJldmVudCBpdCBmcm9tIGNvbnRhaW5pbmcgYW55IGRpcmVjdG9yeSBjaGFuZ2luZ1xuICAgIC8vIFVOSVggcGF0dGVybnMgd2hpY2ggY291bGQgZXhwb3NlIHRoZSB3aG9sZSBmaWxlIHN5c3RlbSwgZS5nLlxuICAgIC8vIGBodHRwOi8vZXhhbXBsZS5jb20vcGFyc2UvYXBwcy8uLi9maWxlLnR4dGAgcmVxdWVzdHMgYSBmaWxlIG91dHNpZGVcbiAgICAvLyBvZiB0aGUgcGFnZXMgZGlyZWN0b3J5IHNjb3BlLlxuICAgIGNvbnN0IG5vcm1hbGl6ZWRQYXRoID0gcGF0aC5ub3JtYWxpemUoZmlsZVBhdGgpO1xuXG4gICAgLy8gQWJvcnQgaWYgdGhlIHBhdGggaXMgb3V0c2lkZSBvZiB0aGUgcGF0aCBkaXJlY3Rvcnkgc2NvcGVcbiAgICBpZiAoIW5vcm1hbGl6ZWRQYXRoLnN0YXJ0c1dpdGgodGhpcy5wYWdlc1BhdGggKyBwYXRoLnNlcCkpIHtcbiAgICAgIHRocm93IGVycm9ycy5maWxlT3V0c2lkZUFsbG93ZWRTY29wZTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgZnMucmVhZEZpbGUobm9ybWFsaXplZFBhdGgsICd1dGYtOCcpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGEgbGFuZ3VhZ2UgcmVzb3VyY2UgSlNPTiBmaWxlIHRoYXQgaXMgdXNlZCBmb3IgdHJhbnNsYXRpb25zLlxuICAgKi9cbiAgbG9hZEpzb25SZXNvdXJjZSgpIHtcbiAgICBpZiAodGhpcy5wYWdlc0NvbmZpZy5sb2NhbGl6YXRpb25Kc29uUGF0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBqc29uID0gcmVxdWlyZShwYXRoLnJlc29sdmUoJy4vJywgdGhpcy5wYWdlc0NvbmZpZy5sb2NhbGl6YXRpb25Kc29uUGF0aCkpO1xuICAgICAgdGhpcy5qc29uUGFyYW1ldGVycyA9IGpzb247XG4gICAgfSBjYXRjaCB7XG4gICAgICB0aHJvdyBlcnJvcnMuanNvbkZhaWxlZEZpbGVMb2FkaW5nO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBhbmQgcmV0dXJucyB0aGUgcGFnZSBkZWZhdWx0IHBhcmFtZXRlcnMgZnJvbSB0aGUgUGFyc2UgU2VydmVyXG4gICAqIGNvbmZpZ3VyYXRpb24uIFRoZXNlIHBhcmFtZXRlcnMgYXJlIG1hZGUgYWNjZXNzaWJsZSBpbiBldmVyeSBwYWdlIHNlcnZlZFxuICAgKiBieSB0aGlzIHJvdXRlci5cbiAgICogQHBhcmFtIHtPYmplY3R9IGNvbmZpZyBUaGUgUGFyc2UgU2VydmVyIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IFRoZSBkZWZhdWx0IHBhcmFtZXRlcnMuXG4gICAqL1xuICBnZXREZWZhdWx0UGFyYW1zKGNvbmZpZykge1xuICAgIHJldHVybiBjb25maWdcbiAgICAgID8ge1xuICAgICAgICBbcGFnZVBhcmFtcy5hcHBJZF06IGNvbmZpZy5hcHBJZCxcbiAgICAgICAgW3BhZ2VQYXJhbXMuYXBwTmFtZV06IGNvbmZpZy5hcHBOYW1lLFxuICAgICAgICBbcGFnZVBhcmFtcy5wdWJsaWNTZXJ2ZXJVcmxdOiBjb25maWcucHVibGljU2VydmVyVVJMLFxuICAgICAgfVxuICAgICAgOiB7fTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBhbmQgcmV0dXJucyB0aGUgbG9jYWxlIGZyb20gYW4gZXhwcmVzcyByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxIFRoZSBleHByZXNzIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtTdHJpbmd8dW5kZWZpbmVkfSBUaGUgbG9jYWxlLCBvciB1bmRlZmluZWQgaWYgbm8gbG9jYWxlIHdhcyBzZXQuXG4gICAqL1xuICBnZXRMb2NhbGUocmVxKSB7XG4gICAgY29uc3QgbG9jYWxlID1cbiAgICAgIChyZXEucXVlcnkgfHwge30pW3BhZ2VQYXJhbXMubG9jYWxlXSB8fFxuICAgICAgKHJlcS5ib2R5IHx8IHt9KVtwYWdlUGFyYW1zLmxvY2FsZV0gfHxcbiAgICAgIChyZXEucGFyYW1zIHx8IHt9KVtwYWdlUGFyYW1zLmxvY2FsZV0gfHxcbiAgICAgIChyZXEuaGVhZGVycyB8fCB7fSlbcGFnZVBhcmFtSGVhZGVyUHJlZml4ICsgcGFnZVBhcmFtcy5sb2NhbGVdO1xuXG4gICAgLy8gVmFsaWRhdGUgbG9jYWxlIGZvcm1hdCB0byBwcmV2ZW50IHBhdGggdHJhdmVyc2FsOyBvbmx5IGFsbG93XG4gICAgLy8gc3RhbmRhcmQgbG9jYWxlIHBhdHRlcm5zIGxpa2UgXCJlblwiLCBcImVuLVVTXCIsIFwiZGUtQVRcIiwgXCJ6aC1IYW5zLUNOXCJcbiAgICBpZiAobG9jYWxlICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGxvY2FsZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgbG9jYWxlID09PSAnc3RyaW5nJyAmJiAhL15bYS16QS1aXXsyLDN9KC1bYS16QS1aMC05XXsyLDh9KSokLy50ZXN0KGxvY2FsZSkpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiBsb2NhbGU7XG4gIH1cblxuICAvKipcbiAgICogQ29tcG9zZXMgcGFnZSBwYXJhbWV0ZXIgaGVhZGVycyBmcm9tIHRoZSBnaXZlbiBwYXJhbWV0ZXJzLiBDb250cm9sXG4gICAqIGNoYXJhY3RlcnMgYXJlIGFsd2F5cyBzdHJpcHBlZCBmcm9tIGhlYWRlciB2YWx1ZXMgdG8gcHJldmVudFxuICAgKiBFUlJfSU5WQUxJRF9DSEFSIGVycm9ycy4gVmFsdWVzIGFyZSBVUkktZW5jb2RlZCBpZiB0aGVcbiAgICogYGVuY29kZVBhZ2VQYXJhbUhlYWRlcnNgIG9wdGlvbiBpcyBlbmFibGVkLlxuICAgKiBAcGFyYW0ge09iamVjdH0gcGFyYW1zIFRoZSBwYXJhbWV0ZXJzIHRvIGluY2x1ZGUgaW4gdGhlIGhlYWRlcnMuXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IFRoZSBoZWFkZXJzIG9iamVjdC5cbiAgICovXG4gIGNvbXBvc2VQYWdlUGFyYW1IZWFkZXJzKHBhcmFtcykge1xuICAgIGNvbnN0IGVuY29kZSA9IHRoaXMucGFnZXNDb25maWcuZW5jb2RlUGFnZVBhcmFtSGVhZGVycztcbiAgICByZXR1cm4gT2JqZWN0LmVudHJpZXMocGFyYW1zKS5yZWR1Y2UoKG0sIHApID0+IHtcbiAgICAgIGlmIChwWzFdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbGV0IHZhbHVlID0gZW5jb2RlID8gZW5jb2RlVVJJQ29tcG9uZW50KHBbMV0pIDogcFsxXTtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29udHJvbC1yZWdleFxuICAgICAgICAgIHZhbHVlID0gdmFsdWUucmVwbGFjZSgvW1xceDAwLVxceDFmXFx4N2ZdL2csICcnKTtcbiAgICAgICAgfVxuICAgICAgICBtW2Ake3BhZ2VQYXJhbUhlYWRlclByZWZpeH0ke3BbMF0udG9Mb3dlckNhc2UoKX1gXSA9IHZhbHVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG07XG4gICAgfSwge30pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSByZXNwb25zZSB3aXRoIGh0dHAgcmVkaXJlY3QuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXEgVGhlIGV4cHJlc3MgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhdGggVGhlIHBhdGggb2YgdGhlIGZpbGUgdG8gcmV0dXJuLlxuICAgKiBAcGFyYW0ge09iamVjdH0gcGFyYW1zIFRoZSBxdWVyeSBwYXJhbWV0ZXJzIHRvIGluY2x1ZGUuXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IFRoZSBQcm9taXNlIFJvdXRlciByZXNwb25zZS5cbiAgICovXG4gIGFzeW5jIHJlZGlyZWN0UmVzcG9uc2UodXJsLCBwYXJhbXMpIHtcbiAgICAvLyBSZW1vdmUgYW55IHBhcmFtZXRlcnMgd2l0aCB1bmRlZmluZWQgdmFsdWVcbiAgICBwYXJhbXMgPSBPYmplY3QuZW50cmllcyhwYXJhbXMpLnJlZHVjZSgobSwgcCkgPT4ge1xuICAgICAgaWYgKHBbMV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBtW3BbMF1dID0gcFsxXTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBtO1xuICAgIH0sIHt9KTtcblxuICAgIC8vIENvbXBvc2UgVVJMIHdpdGggcGFyYW1ldGVycyBpbiBxdWVyeVxuICAgIGNvbnN0IGxvY2F0aW9uID0gbmV3IFVSTCh1cmwpO1xuICAgIE9iamVjdC5lbnRyaWVzKHBhcmFtcykuZm9yRWFjaChwID0+IGxvY2F0aW9uLnNlYXJjaFBhcmFtcy5zZXQocFswXSwgcFsxXSkpO1xuICAgIGNvbnN0IGxvY2F0aW9uU3RyaW5nID0gbG9jYXRpb24udG9TdHJpbmcoKTtcblxuICAgIC8vIEFkZCBwYXJhbWV0ZXJzIHRvIGhlYWRlciB0byBhbGxvdyBwYXJzaW5nIGZvciBwcm9ncmFtbWF0aWMgdXNlXG4gICAgLy8gb2YgcmVzcG9uc2UsIGluc3RlYWQgb2YgaGF2aW5nIHRvIHBhcnNlIHRoZSBIVE1MIGNvbnRlbnQuXG4gICAgY29uc3QgaGVhZGVycyA9IHRoaXMuY29tcG9zZVBhZ2VQYXJhbUhlYWRlcnMocGFyYW1zKTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXM6IDMwMyxcbiAgICAgIGxvY2F0aW9uOiBsb2NhdGlvblN0cmluZyxcbiAgICAgIGhlYWRlcnM6IGhlYWRlcnMsXG4gICAgfTtcbiAgfVxuXG4gIGRlZmF1bHRQYWdlUGF0aChmaWxlKSB7XG4gICAgcmV0dXJuIHBhdGguam9pbih0aGlzLnBhZ2VzUGF0aCwgZmlsZSk7XG4gIH1cblxuICBjb21wb3NlUGFnZVVybChmaWxlLCBwdWJsaWNTZXJ2ZXJVcmwsIGxvY2FsZSkge1xuICAgIGxldCB1cmwgPSBwdWJsaWNTZXJ2ZXJVcmw7XG4gICAgdXJsICs9IHVybC5lbmRzV2l0aCgnLycpID8gJycgOiAnLyc7XG4gICAgdXJsICs9IHRoaXMucGFnZXNFbmRwb2ludCArICcvJztcbiAgICB1cmwgKz0gbG9jYWxlID09PSB1bmRlZmluZWQgPyAnJyA6IGxvY2FsZSArICcvJztcbiAgICB1cmwgKz0gZmlsZTtcbiAgICByZXR1cm4gdXJsO1xuICB9XG5cbiAgbm90Rm91bmQoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHRleHQ6ICdOb3QgZm91bmQuJyxcbiAgICAgIHN0YXR1czogNDA0LFxuICAgIH07XG4gIH1cblxuICBpbnZhbGlkUmVxdWVzdCgpIHtcbiAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcigpO1xuICAgIGVycm9yLnN0YXR1cyA9IDQwMztcbiAgICBlcnJvci5tZXNzYWdlID0gJ3VuYXV0aG9yaXplZCc7XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgUGFyc2UgU2VydmVyIGNvbmZpZ3VyYXRpb24gaW4gdGhlIHJlcXVlc3Qgb2JqZWN0IHRvIG1ha2UgaXRcbiAgICogZWFzaWx5IGFjY2Vzc2libGUgdGhyb3VnaHRvdXQgcmVxdWVzdCBwcm9jZXNzaW5nLlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxIFRoZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge0Jvb2xlYW59IGZhaWxHcmFjZWZ1bGx5IElzIHRydWUgaWYgZmFpbGluZyB0byBzZXQgdGhlIGNvbmZpZyBzaG91bGRcbiAgICogbm90IHJlc3VsdCBpbiBhbiBpbnZhbGlkIHJlcXVlc3QgcmVzcG9uc2UuIERlZmF1bHQgaXMgYGZhbHNlYC5cbiAgICovXG4gIGFzeW5jIHNldENvbmZpZyhyZXEsIGZhaWxHcmFjZWZ1bGx5ID0gZmFsc2UpIHtcbiAgICByZXEuY29uZmlnID0gQ29uZmlnLmdldChyZXEucGFyYW1zLmFwcElkIHx8IHJlcS5xdWVyeS5hcHBJZCk7XG4gICAgaWYgKCFyZXEuY29uZmlnICYmICFmYWlsR3JhY2VmdWxseSkge1xuICAgICAgdGhpcy5pbnZhbGlkUmVxdWVzdCgpO1xuICAgIH1cbiAgICBpZiAocmVxLmNvbmZpZykge1xuICAgICAgYXdhaXQgcmVxLmNvbmZpZy5sb2FkS2V5cygpO1xuICAgIH1cbiAgfVxuXG4gIG1vdW50UGFnZXNSb3V0ZXMoKSB7XG4gICAgdGhpcy5yb3V0ZShcbiAgICAgICdHRVQnLFxuICAgICAgYC8ke3RoaXMucGFnZXNFbmRwb2ludH0vOmFwcElkL3ZlcmlmeV9lbWFpbGAsXG4gICAgICByZXEgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5zZXRDb25maWcocmVxKTtcbiAgICAgIH0sXG4gICAgICByZXEgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy52ZXJpZnlFbWFpbChyZXEpO1xuICAgICAgfVxuICAgICk7XG5cbiAgICB0aGlzLnJvdXRlKFxuICAgICAgJ1BPU1QnLFxuICAgICAgYC8ke3RoaXMucGFnZXNFbmRwb2ludH0vOmFwcElkL3Jlc2VuZF92ZXJpZmljYXRpb25fZW1haWxgLFxuICAgICAgcmVxID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0Q29uZmlnKHJlcSk7XG4gICAgICB9LFxuICAgICAgcmVxID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVzZW5kVmVyaWZpY2F0aW9uRW1haWwocmVxKTtcbiAgICAgIH1cbiAgICApO1xuXG4gICAgdGhpcy5yb3V0ZShcbiAgICAgICdHRVQnLFxuICAgICAgYC8ke3RoaXMucGFnZXNFbmRwb2ludH0vY2hvb3NlX3Bhc3N3b3JkYCxcbiAgICAgIHJlcSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLnNldENvbmZpZyhyZXEpO1xuICAgICAgfSxcbiAgICAgIHJlcSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLnBhc3N3b3JkUmVzZXQocmVxKTtcbiAgICAgIH1cbiAgICApO1xuXG4gICAgdGhpcy5yb3V0ZShcbiAgICAgICdQT1NUJyxcbiAgICAgIGAvJHt0aGlzLnBhZ2VzRW5kcG9pbnR9LzphcHBJZC9yZXF1ZXN0X3Bhc3N3b3JkX3Jlc2V0YCxcbiAgICAgIHJlcSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLnNldENvbmZpZyhyZXEpO1xuICAgICAgfSxcbiAgICAgIHJlcSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlc2V0UGFzc3dvcmQocmVxKTtcbiAgICAgIH1cbiAgICApO1xuXG4gICAgdGhpcy5yb3V0ZShcbiAgICAgICdHRVQnLFxuICAgICAgYC8ke3RoaXMucGFnZXNFbmRwb2ludH0vOmFwcElkL3JlcXVlc3RfcGFzc3dvcmRfcmVzZXRgLFxuICAgICAgcmVxID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0Q29uZmlnKHJlcSk7XG4gICAgICB9LFxuICAgICAgcmVxID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdFJlc2V0UGFzc3dvcmQocmVxKTtcbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgbW91bnRDdXN0b21Sb3V0ZXMoKSB7XG4gICAgZm9yIChjb25zdCByb3V0ZSBvZiB0aGlzLnBhZ2VzQ29uZmlnLmN1c3RvbVJvdXRlcyB8fCBbXSkge1xuICAgICAgdGhpcy5yb3V0ZShcbiAgICAgICAgcm91dGUubWV0aG9kLFxuICAgICAgICBgLyR7dGhpcy5wYWdlc0VuZHBvaW50fS86YXBwSWQvJHtyb3V0ZS5wYXRofWAsXG4gICAgICAgIHJlcSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuc2V0Q29uZmlnKHJlcSk7XG4gICAgICAgIH0sXG4gICAgICAgIGFzeW5jIHJlcSA9PiB7XG4gICAgICAgICAgY29uc3QgeyBmaWxlLCBxdWVyeSA9IHt9IH0gPSAoYXdhaXQgcm91dGUuaGFuZGxlcihyZXEpKSB8fCB7fTtcblxuICAgICAgICAgIC8vIElmIHJvdXRlIGhhbmRsZXIgZGlkIG5vdCByZXR1cm4gYSBwYWdlIHNlbmQgNDA0IHJlc3BvbnNlXG4gICAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5ub3RGb3VuZCgpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFNlbmQgcGFnZSByZXNwb25zZVxuICAgICAgICAgIGNvbnN0IHBhZ2UgPSBuZXcgUGFnZSh7IGlkOiBmaWxlLCBkZWZhdWx0RmlsZTogZmlsZSB9KTtcbiAgICAgICAgICByZXR1cm4gdGhpcy5nb1RvUGFnZShyZXEsIHBhZ2UsIHF1ZXJ5LCBmYWxzZSk7XG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgbW91bnRTdGF0aWNSb3V0ZSgpIHtcbiAgICB0aGlzLnJvdXRlKFxuICAgICAgJ0dFVCcsXG4gICAgICBgLyR7dGhpcy5wYWdlc0VuZHBvaW50fS8qcmVzb3VyY2VgLFxuICAgICAgcmVxID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0Q29uZmlnKHJlcSwgdHJ1ZSk7XG4gICAgICB9LFxuICAgICAgcmVxID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdGljUm91dGUocmVxKTtcbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgZXhwcmVzc1JvdXRlcigpIHtcbiAgICBjb25zdCByb3V0ZXIgPSBleHByZXNzLlJvdXRlcigpO1xuICAgIHJvdXRlci51c2UoJy8nLCBzdXBlci5leHByZXNzUm91dGVyKCkpO1xuICAgIHJldHVybiByb3V0ZXI7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUGFnZXNSb3V0ZXI7XG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgUGFnZXNSb3V0ZXIsXG4gIHBhZ2VQYXJhbUhlYWRlclByZWZpeCxcbiAgcGFnZVBh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SUFBSTtRQUNMLE9BQU8sSUFBSSxDQUFDcUgsU0FBUyxDQUFDckgsR0FBRyxDQUFDO01BQzVCLENBQUMsRUFDRCxNQUFNQSxHQUFHLElBQUk7UUFDWCxNQUFNO1VBQUVrSCxJQUFJO1VBQUUvRyxLQUFLLEdBQUcsQ0FBQztRQUFFLENBQUMsR0FBRyxDQUFDLE1BQU11SCxLQUFLLENBQUNFLE9BQU8sQ0FBQzVILEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQzs7UUFFN0Q7UUFDQSxJQUFJLENBQUNrSCxJQUFJLEVBQUU7VUFDVCxPQUFPLElBQUksQ0FBQ3pFLFFBQVEsQ0FBQyxDQUFDO1FBQ3hCOztRQUVBO1FBQ0EsTUFBTVQsSUFBSSxHQUFHLElBQUlwRSxhQUFJLENBQUM7VUFBRUMsRUFBRSxFQUFFcUosSUFBSTtVQUFFcEosV0FBVyxFQUFFb0o7UUFBSyxDQUFDLENBQUM7UUFDdEQsT0FBTyxJQUFJLENBQUM1RyxRQUFRLENBQUNOLEdBQUcsRUFBRWdDLElBQUksRUFBRTdCLEtBQUssRUFBRSxLQUFLLENBQUM7TUFDL0MsQ0FDRixDQUFDO0lBQ0g7RUFDRjtFQUVBTCxnQkFBZ0JBLENBQUEsRUFBRztJQUNqQixJQUFJLENBQUM0SCxLQUFLLENBQ1IsS0FBSyxFQUNMLElBQUksSUFBSSxDQUFDcEksYUFBYSxZQUFZLEVBQ2xDVSxHQUFHLElBQUk7TUFDTCxPQUFPLElBQUksQ0FBQ3FILFNBQVMsQ0FBQ3JILEdBQUcsRUFBRSxJQUFJLENBQUM7SUFDbEMsQ0FBQyxFQUNEQSxHQUFHLElBQUk7TUFDTCxPQUFPLElBQUksQ0FBQzRELFdBQVcsQ0FBQzVELEdBQUcsQ0FBQztJQUM5QixDQUNGLENBQUM7RUFDSDtFQUVBNkgsYUFBYUEsQ0FBQSxFQUFHO0lBQ2QsTUFBTUMsTUFBTSxHQUFHQyxnQkFBTyxDQUFDQyxNQUFNLENBQUMsQ0FBQztJQUMvQkYsTUFBTSxDQUFDRyxHQUFHLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQ0osYUFBYSxDQUFDLENBQUMsQ0FBQztJQUN0QyxPQUFPQyxNQUFNO0VBQ2Y7QUFDRjtBQUFDSSxPQUFBLENBQUFoSixXQUFBLEdBQUFBLFdBQUE7QUFBQSxJQUFBaUosUUFBQSxHQUFBRCxPQUFBLENBQUEzSyxPQUFBLEdBRWMyQixXQUFXO0FBQzFCa0osTUFBTSxDQUFDRixPQUFPLEdBQUc7RUFDZmhKLFdBQVc7RUFDWEoscUJBQXFCO0VBQ3JCUixVQUFVO0VBQ1ZkO0FBQ0YsQ0FBQyIsImlnbm9yZUxpc3QiOltdfQ==