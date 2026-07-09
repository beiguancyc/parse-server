"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.Config = void 0;
var _lodash = require("lodash");
var _pathToRegexp = require("path-to-regexp");
var _net = _interopRequireDefault(require("net"));
var _cache = _interopRequireDefault(require("./cache"));
var _DatabaseController = _interopRequireDefault(require("./Controllers/DatabaseController"));
var _LoggerController = require("./Controllers/LoggerController");
var _package = require("../package.json");
var _Definitions = require("./Options/Definitions");
var _Parse = _interopRequireDefault(require("./cloud-code/Parse.Server"));
var _Deprecator = _interopRequireDefault(require("./Deprecator/Deprecator"));
var _Utils = _interopRequireDefault(require("./Utils"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// A Config object provides information about how a specific app is
// configured.
// mount is the URL for the root of the API; includes http, domain, etc.

function removeTrailingSlash(str) {
  if (!str) {
    return str;
  }
  if (str.endsWith('/')) {
    str = str.substring(0, str.length - 1);
  }
  return str;
}

/**
 * Config keys that need to be loaded asynchronously.
 */
const asyncKeys = ['publicServerURL'];
class Config {
  static get(applicationId, mount) {
    const cacheInfo = _cache.default.get(applicationId);
    if (!cacheInfo) {
      return;
    }
    const config = new Config();
    config.applicationId = applicationId;
    Object.keys(cacheInfo).forEach(key => {
      if (key == 'databaseController') {
        config.database = new _DatabaseController.default(cacheInfo.databaseController.adapter, config);
      } else {
        config[key] = cacheInfo[key];
      }
    });
    config.mount = removeTrailingSlash(mount);
    config.generateSessionExpiresAt = config.generateSessionExpiresAt.bind(config);
    config.generateEmailVerifyTokenExpiresAt = config.generateEmailVerifyTokenExpiresAt.bind(config);
    config.version = _package.version;
    return config;
  }
  async loadKeys() {
    await Promise.all(asyncKeys.map(async key => {
      if (typeof this[`_${key}`] === 'function') {
        try {
          this[key] = await this[`_${key}`]();
        } catch (error) {
          throw new Error(`Failed to resolve async config key '${key}': ${error.message}`);
        }
      }
    }));
    const cachedConfig = _cache.default.get(this.appId);
    if (cachedConfig) {
      const updatedConfig = {
        ...cachedConfig
      };
      asyncKeys.forEach(key => {
        updatedConfig[key] = this[key];
      });
      _cache.default.put(this.appId, updatedConfig);
    }
  }
  static transformConfiguration(serverConfiguration) {
    for (const key of Object.keys(serverConfiguration)) {
      if (asyncKeys.includes(key) && typeof serverConfiguration[key] === 'function') {
        serverConfiguration[`_${key}`] = serverConfiguration[key];
        delete serverConfiguration[key];
      }
    }
  }
  static put(serverConfiguration) {
    Config.validateOptions(serverConfiguration);
    Config.validateControllers(serverConfiguration);
    if (serverConfiguration.routeAllowList) {
      serverConfiguration._routeAllowListRegex = serverConfiguration.routeAllowList.map(pattern => new RegExp('^' + pattern + '$'));
    }
    Config.transformConfiguration(serverConfiguration);
    _cache.default.put(serverConfiguration.appId, serverConfiguration);
    Config.setupPasswordValidator(serverConfiguration.passwordPolicy);
    return serverConfiguration;
  }
  static validateOptions({
    customPages,
    publicServerURL,
    revokeSessionOnPasswordReset,
    expireInactiveSessions,
    sessionLength,
    defaultLimit,
    maxLimit,
    accountLockout,
    passwordPolicy,
    masterKeyIps,
    masterKey,
    maintenanceKey,
    maintenanceKeyIps,
    readOnlyMasterKey,
    readOnlyMasterKeyIps,
    allowHeaders,
    idempotencyOptions,
    fileUpload,
    fileDownload,
    pages,
    security,
    enforcePrivateUsers,
    enableInsecureAuthAdapters,
    schema,
    requestKeywordDenylist,
    allowExpiredAuthDataToken,
    logLevels,
    rateLimit,
    databaseOptions,
    extendSessionOnUse,
    allowClientClassCreation,
    requestComplexity,
    liveQuery,
    routeAllowList,
    installation
  }) {
    if (masterKey === readOnlyMasterKey) {
      throw new Error('masterKey and readOnlyMasterKey should be different');
    }
    if (masterKey === maintenanceKey) {
      throw new Error('masterKey and maintenanceKey should be different');
    }
    this.validateAccountLockoutPolicy(accountLockout);
    this.validatePasswordPolicy(passwordPolicy);
    this.validateFileUploadOptions(fileUpload);
    if (fileDownload == null) {
      fileDownload = {};
      arguments[0].fileDownload = fileDownload;
    }
    this.validateFileDownloadOptions(fileDownload);
    if (typeof revokeSessionOnPasswordReset !== 'boolean') {
      throw 'revokeSessionOnPasswordReset must be a boolean value';
    }
    if (typeof extendSessionOnUse !== 'boolean') {
      throw 'extendSessionOnUse must be a boolean value';
    }
    this.validatePublicServerURL({
      publicServerURL
    });
    this.validateSessionConfiguration(sessionLength, expireInactiveSessions);
    this.validateIps('masterKeyIps', masterKeyIps);
    this.validateIps('maintenanceKeyIps', maintenanceKeyIps);
    this.validateIps('readOnlyMasterKeyIps', readOnlyMasterKeyIps);
    this.validateDefaultLimit(defaultLimit);
    this.validateMaxLimit(maxLimit);
    this.validateAllowHeaders(allowHeaders);
    this.validateIdempotencyOptions(idempotencyOptions);
    this.validatePagesOptions(pages);
    this.validateSecurityOptions(security);
    this.validateSchemaOptions(schema);
    this.validateEnforcePrivateUsers(enforcePrivateUsers);
    this.validateEnableInsecureAuthAdapters(enableInsecureAuthAdapters);
    this.validateAllowExpiredAuthDataToken(allowExpiredAuthDataToken);
    this.validateRequestKeywordDenylist(requestKeywordDenylist);
    this.validateRateLimit(rateLimit);
    this.validateLogLevels(logLevels);
    this.validateDatabaseOptions(databaseOptions);
    this.validateCustomPages(customPages);
    this.validateAllowClientClassCreation(allowClientClassCreation);
    this.validateRequestComplexity(requestComplexity);
    this.validateLiveQueryOptions(liveQuery);
    this.validateRouteAllowList(routeAllowList);
    this.validateInstallation(installation);
  }
  static validateCustomPages(customPages) {
    if (!customPages) {
      return;
    }
    if (Object.prototype.toString.call(customPages) !== '[object Object]') {
      throw Error('Parse Server option customPages must be an object.');
    }
  }
  static validateControllers({
    verifyUserEmails,
    userController,
    appName,
    publicServerURL,
    _publicServerURL,
    emailVerifyTokenValidityDuration,
    emailVerifyTokenReuseIfValid,
    emailVerifySuccessOnInvalidEmail
  }) {
    const emailAdapter = userController.adapter;
    if (verifyUserEmails) {
      this.validateEmailConfiguration({
        emailAdapter,
        appName,
        publicServerURL: publicServerURL || _publicServerURL,
        emailVerifyTokenValidityDuration,
        emailVerifyTokenReuseIfValid,
        emailVerifySuccessOnInvalidEmail
      });
    }
  }
  static validateRequestKeywordDenylist(requestKeywordDenylist) {
    if (requestKeywordDenylist === undefined) {
      requestKeywordDenylist = requestKeywordDenylist.default;
    } else if (!Array.isArray(requestKeywordDenylist)) {
      throw 'Parse Server option requestKeywordDenylist must be an array.';
    }
  }
  static validateEnforcePrivateUsers(enforcePrivateUsers) {
    if (typeof enforcePrivateUsers !== 'boolean') {
      throw 'Parse Server option enforcePrivateUsers must be a boolean.';
    }
  }
  static validateAllowExpiredAuthDataToken(allowExpiredAuthDataToken) {
    if (typeof allowExpiredAuthDataToken !== 'boolean') {
      throw 'Parse Server option allowExpiredAuthDataToken must be a boolean.';
    }
  }
  static validateAllowClientClassCreation(allowClientClassCreation) {
    if (typeof allowClientClassCreation !== 'boolean') {
      throw 'Parse Server option allowClientClassCreation must be a boolean.';
    }
  }
  static validateSecurityOptions(security) {
    if (Object.prototype.toString.call(security) !== '[object Object]') {
      throw 'Parse Server option security must be an object.';
    }
    if (security.enableCheck === undefined) {
      security.enableCheck = _Definitions.SecurityOptions.enableCheck.default;
    } else if (!(0, _lodash.isBoolean)(security.enableCheck)) {
      throw 'Parse Server option security.enableCheck must be a boolean.';
    }
    if (security.enableCheckLog === undefined) {
      security.enableCheckLog = _Definitions.SecurityOptions.enableCheckLog.default;
    } else if (!(0, _lodash.isBoolean)(security.enableCheckLog)) {
      throw 'Parse Server option security.enableCheckLog must be a boolean.';
    }
  }
  static validateSchemaOptions(schema) {
    if (!schema) {
      return;
    }
    if (Object.prototype.toString.call(schema) !== '[object Object]') {
      throw 'Parse Server option schema must be an object.';
    }
    if (schema.definitions === undefined) {
      schema.definitions = _Definitions.SchemaOptions.definitions.default;
    } else if (!Array.isArray(schema.definitions)) {
      throw 'Parse Server option schema.definitions must be an array.';
    }
    if (schema.strict === undefined) {
      schema.strict = _Definitions.SchemaOptions.strict.default;
    } else if (!(0, _lodash.isBoolean)(schema.strict)) {
      throw 'Parse Server option schema.strict must be a boolean.';
    }
    if (schema.deleteExtraFields === undefined) {
      schema.deleteExtraFields = _Definitions.SchemaOptions.deleteExtraFields.default;
    } else if (!(0, _lodash.isBoolean)(schema.deleteExtraFields)) {
      throw 'Parse Server option schema.deleteExtraFields must be a boolean.';
    }
    if (schema.recreateModifiedFields === undefined) {
      schema.recreateModifiedFields = _Definitions.SchemaOptions.recreateModifiedFields.default;
    } else if (!(0, _lodash.isBoolean)(schema.recreateModifiedFields)) {
      throw 'Parse Server option schema.recreateModifiedFields must be a boolean.';
    }
    if (schema.lockSchemas === undefined) {
      schema.lockSchemas = _Definitions.SchemaOptions.lockSchemas.default;
    } else if (!(0, _lodash.isBoolean)(schema.lockSchemas)) {
      throw 'Parse Server option schema.lockSchemas must be a boolean.';
    }
    if (schema.beforeMigration === undefined) {
      schema.beforeMigration = null;
    } else if (schema.beforeMigration !== null && typeof schema.beforeMigration !== 'function') {
      throw 'Parse Server option schema.beforeMigration must be a function.';
    }
    if (schema.afterMigration === undefined) {
      schema.afterMigration = null;
    } else if (schema.afterMigration !== null && typeof schema.afterMigration !== 'function') {
      throw 'Parse Server option schema.afterMigration must be a function.';
    }
  }
  static validatePagesOptions(pages) {
    if (Object.prototype.toString.call(pages) !== '[object Object]') {
      throw 'Parse Server option pages must be an object.';
    }
    if (pages.enableLocalization === undefined) {
      pages.enableLocalization = _Definitions.PagesOptions.enableLocalization.default;
    } else if (!(0, _lodash.isBoolean)(pages.enableLocalization)) {
      throw 'Parse Server option pages.enableLocalization must be a boolean.';
    }
    if (pages.localizationJsonPath === undefined) {
      pages.localizationJsonPath = _Definitions.PagesOptions.localizationJsonPath.default;
    } else if (!(0, _lodash.isString)(pages.localizationJsonPath)) {
      throw 'Parse Server option pages.localizationJsonPath must be a string.';
    }
    if (pages.localizationFallbackLocale === undefined) {
      pages.localizationFallbackLocale = _Definitions.PagesOptions.localizationFallbackLocale.default;
    } else if (!(0, _lodash.isString)(pages.localizationFallbackLocale)) {
      throw 'Parse Server option pages.localizationFallbackLocale must be a string.';
    }
    if (pages.placeholders === undefined) {
      pages.placeholders = _Definitions.PagesOptions.placeholders.default;
    } else if (Object.prototype.toString.call(pages.placeholders) !== '[object Object]' && typeof pages.placeholders !== 'function') {
      throw 'Parse Server option pages.placeholders must be an object or a function.';
    }
    if (pages.forceRedirect === undefined) {
      pages.forceRedirect = _Definitions.PagesOptions.forceRedirect.default;
    } else if (!(0, _lodash.isBoolean)(pages.forceRedirect)) {
      throw 'Parse Server option pages.forceRedirect must be a boolean.';
    }
    if (pages.pagesPath !== undefined && !(0, _lodash.isString)(pages.pagesPath)) {
      throw 'Parse Server option pages.pagesPath must be a string.';
    }
    if (pages.pagesEndpoint === undefined) {
      pages.pagesEndpoint = _Definitions.PagesOptions.pagesEndpoint.default;
    } else if (!(0, _lodash.isString)(pages.pagesEndpoint)) {
      throw 'Parse Server option pages.pagesEndpoint must be a string.';
    }
    if (pages.customUrls === undefined) {
      pages.customUrls = _Definitions.PagesOptions.customUrls.default;
    } else if (Object.prototype.toString.call(pages.customUrls) !== '[object Object]') {
      throw 'Parse Server option pages.customUrls must be an object.';
    }
    if (pages.customRoutes === undefined) {
      pages.customRoutes = _Definitions.PagesOptions.customRoutes.default;
    } else if (!Array.isArray(pages.customRoutes)) {
      throw 'Parse Server option pages.customRoutes must be an array.';
    }
    if (pages.encodePageParamHeaders === undefined) {
      pages.encodePageParamHeaders = _Definitions.PagesOptions.encodePageParamHeaders.default;
    } else if (!(0, _lodash.isBoolean)(pages.encodePageParamHeaders)) {
      throw 'Parse Server option pages.encodePageParamHeaders must be a boolean.';
    }
  }
  static validateIdempotencyOptions(idempotencyOptions) {
    if (!idempotencyOptions) {
      return;
    }
    if (idempotencyOptions.ttl === undefined) {
      idempotencyOptions.ttl = _Definitions.IdempotencyOptions.ttl.default;
    } else if (!isNaN(idempotencyOptions.ttl) && idempotencyOptions.ttl <= 0) {
      throw 'idempotency TTL value must be greater than 0 seconds';
    } else if (isNaN(idempotencyOptions.ttl)) {
      throw 'idempotency TTL value must be a number';
    }
    if (!idempotencyOptions.paths) {
      idempotencyOptions.paths = _Definitions.IdempotencyOptions.paths.default;
    } else if (!Array.isArray(idempotencyOptions.paths)) {
      throw 'idempotency paths must be of an array of strings';
    }
  }
  static validateAccountLockoutPolicy(accountLockout) {
    if (accountLockout) {
      if (typeof accountLockout.duration !== 'number' || accountLockout.duration <= 0 || accountLockout.duration > 99999) {
        throw 'Account lockout duration should be greater than 0 and less than 100000';
      }
      if (!Number.isInteger(accountLockout.threshold) || accountLockout.threshold < 1 || accountLockout.threshold > 999) {
        throw 'Account lockout threshold should be an integer greater than 0 and less than 1000';
      }
      if (accountLockout.unlockOnPasswordReset === undefined) {
        accountLockout.unlockOnPasswordReset = _Definitions.AccountLockoutOptions.unlockOnPasswordReset.default;
      } else if (!(0, _lodash.isBoolean)(accountLockout.unlockOnPasswordReset)) {
        throw 'Parse Server option accountLockout.unlockOnPasswordReset must be a boolean.';
      }
    }
  }
  static validatePasswordPolicy(passwordPolicy) {
    if (passwordPolicy) {
      if (passwordPolicy.maxPasswordAge !== undefined && (typeof passwordPolicy.maxPasswordAge !== 'number' || passwordPolicy.maxPasswordAge < 0)) {
        throw 'passwordPolicy.maxPasswordAge must be a positive number';
      }
      if (passwordPolicy.resetTokenValidityDuration !== undefined && (typeof passwordPolicy.resetTokenValidityDuration !== 'number' || passwordPolicy.resetTokenValidityDuration <= 0)) {
        throw 'passwordPolicy.resetTokenValidityDuration must be a positive number';
      }
      if (passwordPolicy.validatorPattern) {
        if (typeof passwordPolicy.validatorPattern === 'string') {
          passwordPolicy.validatorPattern = new RegExp(passwordPolicy.validatorPattern);
        } else if (!_Utils.default.isRegExp(passwordPolicy.validatorPattern)) {
          throw 'passwordPolicy.validatorPattern must be a regex string or RegExp object.';
        }
      }
      if (passwordPolicy.validatorCallback && typeof passwordPolicy.validatorCallback !== 'function') {
        throw 'passwordPolicy.validatorCallback must be a function.';
      }
      if (passwordPolicy.doNotAllowUsername && typeof passwordPolicy.doNotAllowUsername !== 'boolean') {
        throw 'passwordPolicy.doNotAllowUsername must be a boolean value.';
      }
      if (passwordPolicy.maxPasswordHistory && (!Number.isInteger(passwordPolicy.maxPasswordHistory) || passwordPolicy.maxPasswordHistory <= 0 || passwordPolicy.maxPasswordHistory > 20)) {
        throw 'passwordPolicy.maxPasswordHistory must be an integer ranging 0 - 20';
      }
      if (passwordPolicy.resetTokenReuseIfValid && typeof passwordPolicy.resetTokenReuseIfValid !== 'boolean') {
        throw 'resetTokenReuseIfValid must be a boolean value';
      }
      if (passwordPolicy.resetTokenReuseIfValid && !passwordPolicy.resetTokenValidityDuration) {
        throw 'You cannot use resetTokenReuseIfValid without resetTokenValidityDuration';
      }
      if (passwordPolicy.resetPasswordSuccessOnInvalidEmail !== undefined && typeof passwordPolicy.resetPasswordSuccessOnInvalidEmail !== 'boolean') {
        throw 'resetPasswordSuccessOnInvalidEmail must be a boolean value';
      }
    }
  }

  // if the passwordPolicy.validatorPattern is configured then setup a callback to process the pattern
  static setupPasswordValidator(passwordPolicy) {
    if (passwordPolicy && passwordPolicy.validatorPattern) {
      passwordPolicy.patternValidator = value => {
        return passwordPolicy.validatorPattern.test(value);
      };
    }
  }
  static validatePublicServerURL({
    publicServerURL,
    required = false
  }) {
    if (!publicServerURL) {
      if (!required) {
        return;
      }
      throw 'The option publicServerURL is required.';
    }
    const type = typeof publicServerURL;
    if (type === 'string') {
      if (!publicServerURL.startsWith('http://') && !publicServerURL.startsWith('https://')) {
        throw 'The option publicServerURL must be a valid URL starting with http:// or https://.';
      }
      return;
    }
    if (type === 'function') {
      return;
    }
    throw `The option publicServerURL must be a string or function, but got ${type}.`;
  }
  static validateEmailConfiguration({
    emailAdapter,
    appName,
    publicServerURL,
    emailVerifyTokenValidityDuration,
    emailVerifyTokenReuseIfValid,
    emailVerifySuccessOnInvalidEmail
  }) {
    if (!emailAdapter) {
      throw 'An emailAdapter is required for e-mail verification and password resets.';
    }
    if (typeof appName !== 'string') {
      throw 'An app name is required for e-mail verification and password resets.';
    }
    this.validatePublicServerURL({
      publicServerURL,
      required: true
    });
    if (emailVerifyTokenValidityDuration) {
      if (isNaN(emailVerifyTokenValidityDuration)) {
        throw 'Email verify token validity duration must be a valid number.';
      } else if (emailVerifyTokenValidityDuration <= 0) {
        throw 'Email verify token validity duration must be a value greater than 0.';
      }
    }
    if (emailVerifyTokenReuseIfValid && typeof emailVerifyTokenReuseIfValid !== 'boolean') {
      throw 'emailVerifyTokenReuseIfValid must be a boolean value';
    }
    if (emailVerifyTokenReuseIfValid && !emailVerifyTokenValidityDuration) {
      throw 'You cannot use emailVerifyTokenReuseIfValid without emailVerifyTokenValidityDuration';
    }
    if (emailVerifySuccessOnInvalidEmail !== undefined && typeof emailVerifySuccessOnInvalidEmail !== 'boolean') {
      throw 'emailVerifySuccessOnInvalidEmail must be a boolean value';
    }
  }
  static validateFileUploadOptions(fileUpload) {
    try {
      if (fileUpload == null || typeof fileUpload !== 'object' || Array.isArray(fileUpload)) {
        throw 'fileUpload must be an object value.';
      }
    } catch (e) {
      if (e instanceof ReferenceError) {
        return;
      }
      throw e;
    }
    if (fileUpload.enableForAnonymousUser === undefined) {
      fileUpload.enableForAnonymousUser = _Definitions.FileUploadOptions.enableForAnonymousUser.default;
    } else if (typeof fileUpload.enableForAnonymousUser !== 'boolean') {
      throw 'fileUpload.enableForAnonymousUser must be a boolean value.';
    }
    if (fileUpload.enableForPublic === undefined) {
      fileUpload.enableForPublic = _Definitions.FileUploadOptions.enableForPublic.default;
    } else if (typeof fileUpload.enableForPublic !== 'boolean') {
      throw 'fileUpload.enableForPublic must be a boolean value.';
    }
    if (fileUpload.enableForAuthenticatedUser === undefined) {
      fileUpload.enableForAuthenticatedUser = _Definitions.FileUploadOptions.enableForAuthenticatedUser.default;
    } else if (typeof fileUpload.enableForAuthenticatedUser !== 'boolean') {
      throw 'fileUpload.enableForAuthenticatedUser must be a boolean value.';
    }
    if (fileUpload.fileExtensions === undefined) {
      fileUpload.fileExtensions = _Definitions.FileUploadOptions.fileExtensions.default;
    } else if (!Array.isArray(fileUpload.fileExtensions)) {
      throw 'fileUpload.fileExtensions must be an array.';
    }
    if (fileUpload.allowedFileUrlDomains === undefined) {
      fileUpload.allowedFileUrlDomains = _Definitions.FileUploadOptions.allowedFileUrlDomains.default;
    } else if (!Array.isArray(fileUpload.allowedFileUrlDomains)) {
      throw 'fileUpload.allowedFileUrlDomains must be an array.';
    } else {
      for (const domain of fileUpload.allowedFileUrlDomains) {
        if (typeof domain !== 'string' || domain === '') {
          throw 'fileUpload.allowedFileUrlDomains must contain only non-empty strings.';
        }
      }
    }
  }
  static validateFileDownloadOptions(fileDownload) {
    try {
      if (fileDownload == null || typeof fileDownload !== 'object' || Array.isArray(fileDownload)) {
        throw 'fileDownload must be an object value.';
      }
    } catch (e) {
      if (e instanceof ReferenceError) {
        return;
      }
      throw e;
    }
    if (fileDownload.enableForAnonymousUser === undefined) {
      fileDownload.enableForAnonymousUser = _Definitions.FileDownloadOptions.enableForAnonymousUser.default;
    } else if (typeof fileDownload.enableForAnonymousUser !== 'boolean') {
      throw 'fileDownload.enableForAnonymousUser must be a boolean value.';
    }
    if (fileDownload.enableForPublic === undefined) {
      fileDownload.enableForPublic = _Definitions.FileDownloadOptions.enableForPublic.default;
    } else if (typeof fileDownload.enableForPublic !== 'boolean') {
      throw 'fileDownload.enableForPublic must be a boolean value.';
    }
    if (fileDownload.enableForAuthenticatedUser === undefined) {
      fileDownload.enableForAuthenticatedUser = _Definitions.FileDownloadOptions.enableForAuthenticatedUser.default;
    } else if (typeof fileDownload.enableForAuthenticatedUser !== 'boolean') {
      throw 'fileDownload.enableForAuthenticatedUser must be a boolean value.';
    }
  }
  static validateIps(field, masterKeyIps) {
    for (let ip of masterKeyIps) {
      if (ip.includes('/')) {
        ip = ip.split('/')[0];
      }
      if (!_net.default.isIP(ip)) {
        throw `The Parse Server option "${field}" contains an invalid IP address "${ip}".`;
      }
    }
  }
  static validateEnableInsecureAuthAdapters(enableInsecureAuthAdapters) {
    if (enableInsecureAuthAdapters && typeof enableInsecureAuthAdapters !== 'boolean') {
      throw 'Parse Server option enableInsecureAuthAdapters must be a boolean.';
    }
    if (enableInsecureAuthAdapters) {
      _Deprecator.default.logRuntimeDeprecation({
        usage: 'insecure adapter'
      });
    }
  }
  get mount() {
    var mount = this._mount;
    if (this.publicServerURL) {
      mount = this.publicServerURL;
    }
    return mount;
  }
  set mount(newValue) {
    this._mount = newValue;
  }
  static validateSessionConfiguration(sessionLength, expireInactiveSessions) {
    if (expireInactiveSessions) {
      if (isNaN(sessionLength)) {
        throw 'Session length must be a valid number.';
      } else if (sessionLength <= 0) {
        throw 'Session length must be a value greater than 0.';
      }
    }
  }
  static validateDefaultLimit(defaultLimit) {
    if (defaultLimit == null) {
      defaultLimit = _Definitions.ParseServerOptions.defaultLimit.default;
    }
    if (typeof defaultLimit !== 'number') {
      throw 'Default limit must be a number.';
    }
    if (defaultLimit <= 0) {
      throw 'Default limit must be a value greater than 0.';
    }
  }
  static validateMaxLimit(maxLimit) {
    if (maxLimit <= 0) {
      throw 'Max limit must be a value greater than 0.';
    }
  }
  static validateRequestComplexity(requestComplexity) {
    if (requestComplexity == null) {
      return;
    }
    if (typeof requestComplexity !== 'object' || Array.isArray(requestComplexity)) {
      throw new Error('requestComplexity must be an object.');
    }
    const validKeys = Object.keys(_Definitions.RequestComplexityOptions);
    for (const key of Object.keys(requestComplexity)) {
      if (!validKeys.includes(key)) {
        throw new Error(`requestComplexity contains unknown property '${key}'.`);
      }
    }
    for (const key of validKeys) {
      if (requestComplexity[key] !== undefined) {
        const value = requestComplexity[key];
        const def = _Definitions.RequestComplexityOptions[key];
        if (typeof def.default === 'boolean') {
          if (typeof value !== 'boolean') {
            throw new Error(`requestComplexity.${key} must be a boolean.`);
          }
        } else if (!Number.isInteger(value) || value < 1 && value !== -1) {
          throw new Error(`requestComplexity.${key} must be a positive integer or -1 to disable.`);
        }
      } else {
        requestComplexity[key] = _Definitions.RequestComplexityOptions[key].default;
      }
    }
  }
  static validateInstallation(installation) {
    if (installation === undefined) {
      return;
    }
    if (typeof installation !== 'object' || Array.isArray(installation) || installation === null) {
      throw 'installation must be an object.';
    }
    const validKeys = ['duplicateDeviceTokenActionEnforceAuth', 'duplicateDeviceTokenAction', 'duplicateDeviceTokenMergePriority'];
    for (const key of Object.keys(installation)) {
      if (!validKeys.includes(key)) {
        throw `installation contains unknown property '${key}'.`;
      }
    }
    if (installation.duplicateDeviceTokenActionEnforceAuth === undefined) {
      installation.duplicateDeviceTokenActionEnforceAuth = _Definitions.InstallationOptions.duplicateDeviceTokenActionEnforceAuth.default;
    } else if (typeof installation.duplicateDeviceTokenActionEnforceAuth !== 'boolean') {
      throw 'installation.duplicateDeviceTokenActionEnforceAuth must be a boolean.';
    }
    const validActions = ['delete', 'update'];
    if (installation.duplicateDeviceTokenAction === undefined) {
      installation.duplicateDeviceTokenAction = _Definitions.InstallationOptions.duplicateDeviceTokenAction.default;
    } else if (!validActions.includes(installation.duplicateDeviceTokenAction)) {
      throw "installation.duplicateDeviceTokenAction must be one of: 'delete', 'update'.";
    }
    const validPriorities = ['deviceToken', 'installationId'];
    if (installation.duplicateDeviceTokenMergePriority === undefined) {
      installation.duplicateDeviceTokenMergePriority = _Definitions.InstallationOptions.duplicateDeviceTokenMergePriority.default;
    } else if (!validPriorities.includes(installation.duplicateDeviceTokenMergePriority)) {
      throw "installation.duplicateDeviceTokenMergePriority must be one of: 'deviceToken', 'installationId'.";
    }
  }
  static validateAllowHeaders(allowHeaders) {
    if (![null, undefined].includes(allowHeaders)) {
      if (Array.isArray(allowHeaders)) {
        allowHeaders.forEach(header => {
          if (typeof header !== 'string') {
            throw 'Allow headers must only contain strings';
          } else if (!header.trim().length) {
            throw 'Allow headers must not contain empty strings';
          }
        });
      } else {
        throw 'Allow headers must be an array';
      }
    }
  }
  static validateLogLevels(logLevels) {
    for (const key of Object.keys(_Definitions.LogLevels)) {
      if (logLevels[key]) {
        if (_LoggerController.logLevels.indexOf(logLevels[key]) === -1) {
          throw `'${key}' must be one of ${JSON.stringify(_LoggerController.logLevels)}`;
        }
      } else {
        logLevels[key] = _Definitions.LogLevels[key].default;
      }
    }
  }
  static validateDatabaseOptions(databaseOptions) {
    if (databaseOptions == undefined) {
      return;
    }
    if (Object.prototype.toString.call(databaseOptions) !== '[object Object]') {
      throw `databaseOptions must be an object`;
    }
    if (databaseOptions.enableSchemaHooks === undefined) {
      databaseOptions.enableSchemaHooks = _Definitions.DatabaseOptions.enableSchemaHooks.default;
    } else if (typeof databaseOptions.enableSchemaHooks !== 'boolean') {
      throw `databaseOptions.enableSchemaHooks must be a boolean`;
    }
    if (databaseOptions.schemaCacheTtl === undefined) {
      databaseOptions.schemaCacheTtl = _Definitions.DatabaseOptions.schemaCacheTtl.default;
    } else if (typeof databaseOptions.schemaCacheTtl !== 'number') {
      throw `databaseOptions.schemaCacheTtl must be a number`;
    }
    if (databaseOptions.allowPublicExplain === undefined) {
      databaseOptions.allowPublicExplain = _Definitions.DatabaseOptions.allowPublicExplain.default;
    } else if (typeof databaseOptions.allowPublicExplain !== 'boolean') {
      throw `Parse Server option 'databaseOptions.allowPublicExplain' must be a boolean.`;
    }
  }
  static validateLiveQueryOptions(liveQuery) {
    if (liveQuery == undefined) {
      return;
    }
    if (liveQuery.regexTimeout === undefined) {
      liveQuery.regexTimeout = _Definitions.LiveQueryOptions.regexTimeout.default;
    } else if (typeof liveQuery.regexTimeout !== 'number') {
      throw `liveQuery.regexTimeout must be a number`;
    }
  }
  static validateRouteAllowList(routeAllowList) {
    if (routeAllowList === undefined || routeAllowList === null) {
      return;
    }
    if (!Array.isArray(routeAllowList)) {
      throw 'Parse Server option routeAllowList must be an array of strings.';
    }
    for (const pattern of routeAllowList) {
      if (typeof pattern !== 'string') {
        throw `Parse Server option routeAllowList contains a non-string value.`;
      }
      try {
        new RegExp('^' + pattern + '$');
      } catch {
        throw `Parse Server option routeAllowList contains an invalid regex pattern: "${pattern}".`;
      }
    }
  }
  static validateRateLimit(rateLimit) {
    if (!rateLimit) {
      return;
    }
    if (Object.prototype.toString.call(rateLimit) !== '[object Object]' && !Array.isArray(rateLimit)) {
      throw `rateLimit must be an array or object`;
    }
    const options = Array.isArray(rateLimit) ? rateLimit : [rateLimit];
    for (const option of options) {
      if (Object.prototype.toString.call(option) !== '[object Object]') {
        throw `rateLimit must be an array of objects`;
      }
      if (option.requestPath == null) {
        throw `rateLimit.requestPath must be defined`;
      }
      if (typeof option.requestPath !== 'string') {
        throw `rateLimit.requestPath must be a string`;
      }

      // Validate that the path is valid path-to-regexp syntax
      try {
        (0, _pathToRegexp.pathToRegexp)(option.requestPath);
      } catch (error) {
        throw `rateLimit.requestPath "${option.requestPath}" is not valid: ${error.message}`;
      }
      if (option.requestTimeWindow == null) {
        throw `rateLimit.requestTimeWindow must be defined`;
      }
      if (typeof option.requestTimeWindow !== 'number') {
        throw `rateLimit.requestTimeWindow must be a number`;
      }
      if (option.includeInternalRequests && typeof option.includeInternalRequests !== 'boolean') {
        throw `rateLimit.includeInternalRequests must be a boolean`;
      }
      if (option.requestCount == null) {
        throw `rateLimit.requestCount must be defined`;
      }
      if (typeof option.requestCount !== 'number') {
        throw `rateLimit.requestCount must be a number`;
      }
      if (option.errorResponseMessage && typeof option.errorResponseMessage !== 'string') {
        throw `rateLimit.errorResponseMessage must be a string`;
      }
      const options = Object.keys(_Parse.default.RateLimitZone);
      if (option.zone && !options.includes(option.zone)) {
        const formatter = new Intl.ListFormat('en', {
          style: 'short',
          type: 'disjunction'
        });
        throw `rateLimit.zone must be one of ${formatter.format(options)}`;
      }
    }
  }
  generateEmailVerifyTokenExpiresAt() {
    if (!this.verifyUserEmails || !this.emailVerifyTokenValidityDuration) {
      return undefined;
    }
    var now = new Date();
    return new Date(now.getTime() + this.emailVerifyTokenValidityDuration * 1000);
  }
  generatePasswordResetTokenExpiresAt() {
    if (!this.passwordPolicy || !this.passwordPolicy.resetTokenValidityDuration) {
      return undefined;
    }
    const now = new Date();
    return new Date(now.getTime() + this.passwordPolicy.resetTokenValidityDuration * 1000);
  }
  generateSessionExpiresAt() {
    if (!this.expireInactiveSessions) {
      return undefined;
    }
    var now = new Date();
    return new Date(now.getTime() + this.sessionLength * 1000);
  }
  unregisterRateLimiters() {
    let i = this.rateLimits?.length;
    while (i--) {
      const limit = this.rateLimits[i];
      if (limit.cloud) {
        this.rateLimits.splice(i, 1);
      }
    }
  }
  get invalidLinkURL() {
    return this.customPages.invalidLink || `${this.publicServerURL}/apps/invalid_link.html`;
  }
  get invalidVerificationLinkURL() {
    return this.customPages.invalidVerificationLink || `${this.publicServerURL}/apps/invalid_verification_link.html`;
  }
  get linkSendSuccessURL() {
    return this.customPages.linkSendSuccess || `${this.publicServerURL}/apps/link_send_success.html`;
  }
  get linkSendFailURL() {
    return this.customPages.linkSendFail || `${this.publicServerURL}/apps/link_send_fail.html`;
  }
  get verifyEmailSuccessURL() {
    return this.customPages.verifyEmailSuccess || `${this.publicServerURL}/apps/verify_email_success.html`;
  }
  get choosePasswordURL() {
    return this.customPages.choosePassword || `${this.publicServerURL}/apps/choose_password`;
  }
  get requestResetPasswordURL() {
    return `${this.publicServerURL}/${this.pagesEndpoint}/${this.applicationId}/request_password_reset`;
  }
  get passwordResetSuccessURL() {
    return this.customPages.passwordResetSuccess || `${this.publicServerURL}/apps/password_reset_success.html`;
  }
  get parseFrameURL() {
    return this.customPages.parseFrameURL;
  }
  get verifyEmailURL() {
    return `${this.publicServerURL}/${this.pagesEndpoint}/${this.applicationId}/verify_email`;
  }
  async loadMasterKey() {
    if (typeof this.masterKey === 'function') {
      const ttlIsEmpty = !this.masterKeyTtl;
      const isExpired = this.masterKeyCache?.expiresAt && this.masterKeyCache.expiresAt < new Date();
      if ((!isExpired || ttlIsEmpty) && this.masterKeyCache?.masterKey) {
        return this.masterKeyCache.masterKey;
      }
      const masterKey = await this.masterKey();
      const expiresAt = this.masterKeyTtl ? new Date(Date.now() + 1000 * this.masterKeyTtl) : null;
      this.masterKeyCache = {
        masterKey,
        expiresAt
      };
      Config.put(this);
      return this.masterKeyCache.masterKey;
    }
    return this.masterKey;
  }
  get pagesEndpoint() {
    return this.pages && this.pages.pagesEndpoint ? this.pages.pagesEndpoint : 'apps';
  }
}
exports.Config = Config;
var _default = exports.default = Config;
module.exports = Config;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbG9kYXNoIiwicmVxdWlyZSIsIl9wYXRoVG9SZWdleHAiLCJfbmV0IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsIl9jYWNoZSIsIl9EYXRhYmFzZUNvbnRyb2xsZXIiLCJfTG9nZ2VyQ29udHJvbGxlciIsIl9wYWNrYWdlIiwiX0RlZmluaXRpb25zIiwiX1BhcnNlIiwiX0RlcHJlY2F0b3IiLCJfVXRpbHMiLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJyZW1vdmVUcmFpbGluZ1NsYXNoIiwic3RyIiwiZW5kc1dpdGgiLCJzdWJzdHJpbmciLCJsZW5ndGgiLCJhc3luY0tleXMiLCJDb25maWciLCJnZXQiLCJhcHBsaWNhdGlvbklkIiwibW91bnQiLCJjYWNoZUluZm8iLCJBcHBDYWNoZSIsImNvbmZpZyIsIk9iamVjdCIsImtleXMiLCJmb3JFYWNoIiwia2V5IiwiZGF0YWJhc2UiLCJEYXRhYmFzZUNvbnRyb2xsZXIiLCJkYXRhYmFzZUNvbnRyb2xsZXIiLCJhZGFwdGVyIiwiZ2VuZXJhdGVTZXNzaW9uRXhwaXJlc0F0IiwiYmluZCIsImdlbmVyYXRlRW1haWxWZXJpZnlUb2tlbkV4cGlyZXNBdCIsInZlcnNpb24iLCJsb2FkS2V5cyIsIlByb21pc2UiLCJhbGwiLCJtYXAiLCJlcnJvciIsIkVycm9yIiwibWVzc2FnZSIsImNhY2hlZENvbmZpZyIsImFwcElkIiwidXBkYXRlZENvbmZpZyIsInB1dCIsInRyYW5zZm9ybUNvbmZpZ3VyYXRpb24iLCJzZXJ2ZXJDb25maWd1cmF0aW9uIiwiaW5jbHVkZXMiLCJ2YWxpZGF0ZU9wdGlvbnMiLCJ2YWxpZGF0ZUNvbnRyb2xsZXJzIiwicm91dGVBbGxvd0xpc3QiLCJfcm91dGVBbGxvd0xpc3RSZWdleCIsInBhdHRlcm4iLCJSZWdFeHAiLCJzZXR1cFBhc3N3b3JkVmFsaWRhdG9yIiwicGFzc3dvcmRQb2xpY3kiLCJjdXN0b21QYWdlcyIsInB1YmxpY1NlcnZlclVSTCIsInJldm9rZVNlc3Npb25PblBhc3N3b3JkUmVzZXQiLCJleHBpcmVJbmFjdGl2ZVNlc3Npb25zIiwic2Vzc2lvbkxlbmd0aCIsImRlZmF1bHRMaW1pdCIsIm1heExpbWl0IiwiYWNjb3VudExvY2tvdXQiLCJtYXN0ZXJLZXlJcHMiLCJtYXN0ZXJLZXkiLCJtYWludGVuYW5jZUtleSIsIm1haW50ZW5hbmNlS2V5SXBzIiwicmVhZE9ubHlNYXN0ZXJLZXkiLCJyZWFkT25seU1hc3RlcktleUlwcyIsImFsbG93SGVhZGVycyIsImlkZW1wb3RlbmN5T3B0aW9ucyIsImZpbGVVcGxvYWQiLCJmaWxlRG93bmxvYWQiLCJwYWdlcyIsInNlY3VyaXR5IiwiZW5mb3JjZVByaXZhdGVVc2VycyIsImVuYWJsZUluc2VjdXJlQXV0aEFkYXB0ZXJzIiwic2NoZW1hIiwicmVxdWVzdEtleXdvcmREZW55bGlzdCIsImFsbG93RXhwaXJlZEF1dGhEYXRhVG9rZW4iLCJsb2dMZXZlbHMiLCJyYXRlTGltaXQiLCJkYXRhYmFzZU9wdGlvbnMiLCJleHRlbmRTZXNzaW9uT25Vc2UiLCJhbGxvd0NsaWVudENsYXNzQ3JlYXRpb24iLCJyZXF1ZXN0Q29tcGxleGl0eSIsImxpdmVRdWVyeSIsImluc3RhbGxhdGlvbiIsInZhbGlkYXRlQWNjb3VudExvY2tvdXRQb2xpY3kiLCJ2YWxpZGF0ZVBhc3N3b3JkUG9saWN5IiwidmFsaWRhdGVGaWxlVXBsb2FkT3B0aW9ucyIsImFyZ3VtZW50cyIsInZhbGlkYXRlRmlsZURvd25sb2FkT3B0aW9ucyIsInZhbGlkYXRlUHVibGljU2VydmVyVVJMIiwidmFsaWRhdGVTZXNzaW9uQ29uZmlndXJhdGlvbiIsInZhbGlkYXRlSXBzIiwidmFsaWRhdGVEZWZhdWx0TGltaXQiLCJ2YWxpZGF0ZU1heExpbWl0IiwidmFsaWRhdGVBbGxvd0hlYWRlcnMiLCJ2YWxpZGF0ZUlkZW1wb3RlbmN5T3B0aW9ucyIsInZhbGlkYXRlUGFnZXNPcHRpb25zIiwidmFsaWRhdGVTZWN1cml0eU9wdGlvbnMiLCJ2YWxpZGF0ZVNjaGVtYU9wdGlvbnMiLCJ2YWxpZGF0ZUVuZm9yY2VQcml2YXRlVXNlcnMiLCJ2YWxpZGF0ZUVuYWJsZUluc2VjdXJlQXV0aEFkYXB0ZXJzIiwidmFsaWRhdGVBbGxvd0V4cGlyZWRBdXRoRGF0YVRva2VuIiwidmFsaWRhdGVSZXF1ZXN0S2V5d29yZERlbnlsaXN0IiwidmFsaWRhdGVSYXRlTGltaXQiLCJ2YWxpZGF0ZUxvZ0xldmVscyIsInZhbGlkYXRlRGF0YWJhc2VPcHRpb25zIiwidmFsaWRhdGVDdXN0b21QYWdlcyIsInZhbGlkYXRlQWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uIiwidmFsaWRhdGVSZXF1ZXN0Q29tcGxleGl0eSIsInZhbGlkYXRlTGl2ZVF1ZXJ5T3B0aW9ucyIsInZhbGlkYXRlUm91dGVBbGxvd0xpc3QiLCJ2YWxpZGF0ZUluc3RhbGxhdGlvbiIsInByb3RvdHlwZSIsInRvU3RyaW5nIiwiY2FsbCIsInZlcmlmeVVzZXJFbWFpbHMiLCJ1c2VyQ29udHJvbGxlciIsImFwcE5hbWUiLCJfcHVibGljU2VydmVyVVJMIiwiZW1haWxWZXJpZnlUb2tlblZhbGlkaXR5RHVyYXRpb24iLCJlbWFpbFZlcmlmeVRva2VuUmV1c2VJZlZhbGlkIiwiZW1haWxWZXJpZnlTdWNjZXNzT25JbnZhbGlkRW1haWwiLCJlbWFpbEFkYXB0ZXIiLCJ2YWxpZGF0ZUVtYWlsQ29uZmlndXJhdGlvbiIsInVuZGVmaW5lZCIsIkFycmF5IiwiaXNBcnJheSIsImVuYWJsZUNoZWNrIiwiU2VjdXJpdHlPcHRpb25zIiwiaXNCb29sZWFuIiwiZW5hYmxlQ2hlY2tMb2ciLCJkZWZpbml0aW9ucyIsIlNjaGVtYU9wdGlvbnMiLCJzdHJpY3QiLCJkZWxldGVFeHRyYUZpZWxkcyIsInJlY3JlYXRlTW9kaWZpZWRGaWVsZHMiLCJsb2NrU2NoZW1hcyIsImJlZm9yZU1pZ3JhdGlvbiIsImFmdGVyTWlncmF0aW9uIiwiZW5hYmxlTG9jYWxpemF0aW9uIiwiUGFnZXNPcHRpb25zIiwibG9jYWxpemF0aW9uSnNvblBhdGgiLCJpc1N0cmluZyIsImxvY2FsaXphdGlvbkZhbGxiYWNrTG9jYWxlIiwicGxhY2Vob2xkZXJzIiwiZm9yY2VSZWRpcmVjdCIsInBhZ2VzUGF0aCIsInBhZ2VzRW5kcG9pbnQiLCJjdXN0b21VcmxzIiwiY3VzdG9tUm91dGVzIiwiZW5jb2RlUGFnZVBhcmFtSGVhZGVycyIsInR0bCIsIklkZW1wb3RlbmN5T3B0aW9ucyIsImlzTmFOIiwicGF0aHMiLCJkdXJhdGlvbiIsIk51bWJlciIsImlzSW50ZWdlciIsInRocmVzaG9sZCIsInVubG9ja09uUGFzc3dvcmRSZXNldCIsIkFjY291bnRMb2Nrb3V0T3B0aW9ucyIsIm1heFBhc3N3b3JkQWdlIiwicmVzZXRUb2tlblZhbGlkaXR5RHVyYXRpb24iLCJ2YWxpZGF0b3JQYXR0ZXJuIiwiVXRpbHMiLCJpc1JlZ0V4cCIsInZhbGlkYXRvckNhbGxiYWNrIiwiZG9Ob3RBbGxvd1VzZXJuYW1lIiwibWF4UGFzc3dvcmRIaXN0b3J5IiwicmVzZXRUb2tlblJldXNlSWZWYWxpZCIsInJlc2V0UGFzc3dvcmRTdWNjZXNzT25JbnZhbGlkRW1haWwiLCJwYXR0ZXJuVmFsaWRhdG9yIiwidmFsdWUiLCJ0ZXN0IiwicmVxdWlyZWQiLCJ0eXBlIiwic3RhcnRzV2l0aCIsIlJlZmVyZW5jZUVycm9yIiwiZW5hYmxlRm9yQW5vbnltb3VzVXNlciIsIkZpbGVVcGxvYWRPcHRpb25zIiwiZW5hYmxlRm9yUHVibGljIiwiZW5hYmxlRm9yQXV0aGVudGljYXRlZFVzZXIiLCJmaWxlRXh0ZW5zaW9ucyIsImFsbG93ZWRGaWxlVXJsRG9tYWlucyIsImRvbWFpbiIsIkZpbGVEb3dubG9hZE9wdGlvbnMiLCJmaWVsZCIsImlwIiwic3BsaXQiLCJuZXQiLCJpc0lQIiwiRGVwcmVjYXRvciIsImxvZ1J1bnRpbWVEZXByZWNhdGlvbiIsInVzYWdlIiwiX21vdW50IiwibmV3VmFsdWUiLCJQYXJzZVNlcnZlck9wdGlvbnMiLCJ2YWxpZEtleXMiLCJSZXF1ZXN0Q29tcGxleGl0eU9wdGlvbnMiLCJkZWYiLCJkdXBsaWNhdGVEZXZpY2VUb2tlbkFjdGlvbkVuZm9yY2VBdXRoIiwiSW5zdGFsbGF0aW9uT3B0aW9ucyIsInZhbGlkQWN0aW9ucyIsImR1cGxpY2F0ZURldmljZVRva2VuQWN0aW9uIiwidmFsaWRQcmlvcml0aWVzIiwiZHVwbGljYXRlRGV2aWNlVG9rZW5NZXJnZVByaW9yaXR5IiwiaGVhZGVyIiwidHJpbSIsIkxvZ0xldmVscyIsInZhbGlkTG9nTGV2ZWxzIiwiaW5kZXhPZiIsIkpTT04iLCJzdHJpbmdpZnkiLCJlbmFibGVTY2hlbWFIb29rcyIsIkRhdGFiYXNlT3B0aW9ucyIsInNjaGVtYUNhY2hlVHRsIiwiYWxsb3dQdWJsaWNFeHBsYWluIiwicmVnZXhUaW1lb3V0IiwiTGl2ZVF1ZXJ5T3B0aW9ucyIsIm9wdGlvbnMiLCJvcHRpb24iLCJyZXF1ZXN0UGF0aCIsInBhdGhUb1JlZ2V4cCIsInJlcXVlc3RUaW1lV2luZG93IiwiaW5jbHVkZUludGVybmFsUmVxdWVzdHMiLCJyZXF1ZXN0Q291bnQiLCJlcnJvclJlc3BvbnNlTWVzc2FnZSIsIlBhcnNlU2VydmVyIiwiUmF0ZUxpbWl0Wm9uZSIsInpvbmUiLCJmb3JtYXR0ZXIiLCJJbnRsIiwiTGlzdEZvcm1hdCIsInN0eWxlIiwiZm9ybWF0Iiwibm93IiwiRGF0ZSIsImdldFRpbWUiLCJnZW5lcmF0ZVBhc3N3b3JkUmVzZXRUb2tlbkV4cGlyZXNBdCIsInVucmVnaXN0ZXJSYXRlTGltaXRlcnMiLCJpIiwicmF0ZUxpbWl0cyIsImxpbWl0IiwiY2xvdWQiLCJzcGxpY2UiLCJpbnZhbGlkTGlua1VSTCIsImludmFsaWRMaW5rIiwiaW52YWxpZFZlcmlmaWNhdGlvbkxpbmtVUkwiLCJpbnZhbGlkVmVyaWZpY2F0aW9uTGluayIsImxpbmtTZW5kU3VjY2Vzc1VSTCIsImxpbmtTZW5kU3VjY2VzcyIsImxpbmtTZW5kRmFpbFVSTCIsImxpbmtTZW5kRmFpbCIsInZlcmlmeUVtYWlsU3VjY2Vzc1VSTCIsInZlcmlmeUVtYWlsU3VjY2VzcyIsImNob29zZVBhc3N3b3JkVVJMIiwiY2hvb3NlUGFzc3dvcmQiLCJyZXF1ZXN0UmVzZXRQYXNzd29yZFVSTCIsInBhc3N3b3JkUmVzZXRTdWNjZXNzVVJMIiwicGFzc3dvcmRSZXNldFN1Y2Nlc3MiLCJwYXJzZUZyYW1lVVJMIiwidmVyaWZ5RW1haWxVUkwiLCJsb2FkTWFzdGVyS2V5IiwidHRsSXNFbXB0eSIsIm1hc3RlcktleVR0bCIsImlzRXhwaXJlZCIsIm1hc3RlcktleUNhY2hlIiwiZXhwaXJlc0F0IiwiZXhwb3J0cyIsIl9kZWZhdWx0IiwibW9kdWxlIl0sInNvdXJjZXMiOlsiLi4vc3JjL0NvbmZpZy5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBBIENvbmZpZyBvYmplY3QgcHJvdmlkZXMgaW5mb3JtYXRpb24gYWJvdXQgaG93IGEgc3BlY2lmaWMgYXBwIGlzXG4vLyBjb25maWd1cmVkLlxuLy8gbW91bnQgaXMgdGhlIFVSTCBmb3IgdGhlIHJvb3Qgb2YgdGhlIEFQSTsgaW5jbHVkZXMgaHR0cCwgZG9tYWluLCBldGMuXG5cbmltcG9ydCB7IGlzQm9vbGVhbiwgaXNTdHJpbmcgfSBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IHsgcGF0aFRvUmVnZXhwIH0gZnJvbSAncGF0aC10by1yZWdleHAnO1xuaW1wb3J0IG5ldCBmcm9tICduZXQnO1xuaW1wb3J0IEFwcENhY2hlIGZyb20gJy4vY2FjaGUnO1xuaW1wb3J0IERhdGFiYXNlQ29udHJvbGxlciBmcm9tICcuL0NvbnRyb2xsZXJzL0RhdGFiYXNlQ29udHJvbGxlcic7XG5pbXBvcnQgeyBsb2dMZXZlbHMgYXMgdmFsaWRMb2dMZXZlbHMgfSBmcm9tICcuL0NvbnRyb2xsZXJzL0xvZ2dlckNvbnRyb2xsZXInO1xuaW1wb3J0IHsgdmVyc2lvbiB9IGZyb20gJy4uL3BhY2thZ2UuanNvbic7XG5pbXBvcnQge1xuICBBY2NvdW50TG9ja291dE9wdGlvbnMsXG4gIERhdGFiYXNlT3B0aW9ucyxcbiAgRmlsZURvd25sb2FkT3B0aW9ucyxcbiAgRmlsZVVwbG9hZE9wdGlvbnMsXG4gIElkZW1wb3RlbmN5T3B0aW9ucyxcbiAgSW5zdGFsbGF0aW9uT3B0aW9ucyxcbiAgTGl2ZVF1ZXJ5T3B0aW9ucyxcbiAgTG9nTGV2ZWxzLFxuICBQYWdlc09wdGlvbnMsXG4gIFBhcnNlU2VydmVyT3B0aW9ucyxcbiAgU2NoZW1hT3B0aW9ucyxcbiAgUmVxdWVzdENvbXBsZXhpdHlPcHRpb25zLFxuICBTZWN1cml0eU9wdGlvbnMsXG59IGZyb20gJy4vT3B0aW9ucy9EZWZpbml0aW9ucyc7XG5pbXBvcnQgUGFyc2VTZXJ2ZXIgZnJvbSAnLi9jbG91ZC1jb2RlL1BhcnNlLlNlcnZlcic7XG5pbXBvcnQgRGVwcmVjYXRvciBmcm9tICcuL0RlcHJlY2F0b3IvRGVwcmVjYXRvcic7XG5pbXBvcnQgVXRpbHMgZnJvbSAnLi9VdGlscyc7XG5cbmZ1bmN0aW9uIHJlbW92ZVRyYWlsaW5nU2xhc2goc3RyKSB7XG4gIGlmICghc3RyKSB7XG4gICAgcmV0dXJuIHN0cjtcbiAgfVxuICBpZiAoc3RyLmVuZHNXaXRoKCcvJykpIHtcbiAgICBzdHIgPSBzdHIuc3Vic3RyaW5nKDAsIHN0ci5sZW5ndGggLSAxKTtcbiAgfVxuICByZXR1cm4gc3RyO1xufVxuXG4vKipcbiAqIENvbmZpZyBrZXlzIHRoYXQgbmVlZCB0byBiZSBsb2FkZWQgYXN5bmNocm9ub3VzbHkuXG4gKi9cbmNvbnN0IGFzeW5jS2V5cyA9IFsncHVibGljU2VydmVyVVJMJ107XG5cbmV4cG9ydCBjbGFzcyBDb25maWcge1xuICBzdGF0aWMgZ2V0KGFwcGxpY2F0aW9uSWQ6IHN0cmluZywgbW91bnQ6IHN0cmluZykge1xuICAgIGNvbnN0IGNhY2hlSW5mbyA9IEFwcENhY2hlLmdldChhcHBsaWNhdGlvbklkKTtcbiAgICBpZiAoIWNhY2hlSW5mbykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBjb25maWcgPSBuZXcgQ29uZmlnKCk7XG4gICAgY29uZmlnLmFwcGxpY2F0aW9uSWQgPSBhcHBsaWNhdGlvbklkO1xuICAgIE9iamVjdC5rZXlzKGNhY2hlSW5mbykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgaWYgKGtleSA9PSAnZGF0YWJhc2VDb250cm9sbGVyJykge1xuICAgICAgICBjb25maWcuZGF0YWJhc2UgPSBuZXcgRGF0YWJhc2VDb250cm9sbGVyKGNhY2hlSW5mby5kYXRhYmFzZUNvbnRyb2xsZXIuYWRhcHRlciwgY29uZmlnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbmZpZ1trZXldID0gY2FjaGVJbmZvW2tleV07XG4gICAgICB9XG4gICAgfSk7XG4gICAgY29uZmlnLm1vdW50ID0gcmVtb3ZlVHJhaWxpbmdTbGFzaChtb3VudCk7XG4gICAgY29uZmlnLmdlbmVyYXRlU2Vzc2lvbkV4cGlyZXNBdCA9IGNvbmZpZy5nZW5lcmF0ZVNlc3Npb25FeHBpcmVzQXQuYmluZChjb25maWcpO1xuICAgIGNvbmZpZy5nZW5lcmF0ZUVtYWlsVmVyaWZ5VG9rZW5FeHBpcmVzQXQgPSBjb25maWcuZ2VuZXJhdGVFbWFpbFZlcmlmeVRva2VuRXhwaXJlc0F0LmJpbmQoXG4gICAgICBjb25maWdcbiAgICApO1xuICAgIGNvbmZpZy52ZXJzaW9uID0gdmVyc2lvbjtcbiAgICByZXR1cm4gY29uZmlnO1xuICB9XG5cbiAgYXN5bmMgbG9hZEtleXMoKSB7XG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICBhc3luY0tleXMubWFwKGFzeW5jIGtleSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpc1tgXyR7a2V5fWBdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXNba2V5XSA9IGF3YWl0IHRoaXNbYF8ke2tleX1gXSgpO1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byByZXNvbHZlIGFzeW5jIGNvbmZpZyBrZXkgJyR7a2V5fSc6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIGNvbnN0IGNhY2hlZENvbmZpZyA9IEFwcENhY2hlLmdldCh0aGlzLmFwcElkKTtcbiAgICBpZiAoY2FjaGVkQ29uZmlnKSB7XG4gICAgICBjb25zdCB1cGRhdGVkQ29uZmlnID0geyAuLi5jYWNoZWRDb25maWcgfTtcbiAgICAgIGFzeW5jS2V5cy5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgIHVwZGF0ZWRDb25maWdba2V5XSA9IHRoaXNba2V5XTtcbiAgICAgIH0pO1xuICAgICAgQXBwQ2FjaGUucHV0KHRoaXMuYXBwSWQsIHVwZGF0ZWRDb25maWcpO1xuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB0cmFuc2Zvcm1Db25maWd1cmF0aW9uKHNlcnZlckNvbmZpZ3VyYXRpb24pIHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzZXJ2ZXJDb25maWd1cmF0aW9uKSkge1xuICAgICAgaWYgKGFzeW5jS2V5cy5pbmNsdWRlcyhrZXkpICYmIHR5cGVvZiBzZXJ2ZXJDb25maWd1cmF0aW9uW2tleV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgc2VydmVyQ29uZmlndXJhdGlvbltgXyR7a2V5fWBdID0gc2VydmVyQ29uZmlndXJhdGlvbltrZXldO1xuICAgICAgICBkZWxldGUgc2VydmVyQ29uZmlndXJhdGlvbltrZXldO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyBwdXQoc2VydmVyQ29uZmlndXJhdGlvbikge1xuICAgIENvbmZpZy52YWxpZGF0ZU9wdGlvbnMoc2VydmVyQ29uZmlndXJhdGlvbik7XG4gICAgQ29uZmlnLnZhbGlkYXRlQ29udHJvbGxlcnMoc2VydmVyQ29uZmlndXJhdGlvbik7XG4gICAgaWYgKHNlcnZlckNvbmZpZ3VyYXRpb24ucm91dGVBbGxvd0xpc3QpIHtcbiAgICAgIHNlcnZlckNvbmZpZ3VyYXRpb24uX3JvdXRlQWxsb3dMaXN0UmVnZXggPSBzZXJ2ZXJDb25maWd1cmF0aW9uLnJvdXRlQWxsb3dMaXN0Lm1hcChcbiAgICAgICAgcGF0dGVybiA9PiBuZXcgUmVnRXhwKCdeJyArIHBhdHRlcm4gKyAnJCcpXG4gICAgICApO1xuICAgIH1cbiAgICBDb25maWcudHJhbnNmb3JtQ29uZmlndXJhdGlvbihzZXJ2ZXJDb25maWd1cmF0aW9uKTtcbiAgICBBcHBDYWNoZS5wdXQoc2VydmVyQ29uZmlndXJhdGlvbi5hcHBJZCwgc2VydmVyQ29uZmlndXJhdGlvbik7XG4gICAgQ29uZmlnLnNldHVwUGFzc3dvcmRWYWxpZGF0b3Ioc2VydmVyQ29uZmlndXJhdGlvbi5wYXNzd29yZFBvbGljeSk7XG4gICAgcmV0dXJuIHNlcnZlckNvbmZpZ3VyYXRpb247XG4gIH1cblxuICBzdGF0aWMgdmFsaWRhdGVPcHRpb25zKHtcbiAgICBjdXN0b21QYWdlcyxcbiAgICBwdWJsaWNTZXJ2ZXJVUkwsXG4gICAgcmV2b2tlU2Vzc2lvbk9uUGFzc3dvcmRSZXNldCxcbiAgICBleHBpcmVJbmFjdGl2ZVNlc3Npb25zLFxuICAgIHNlc3Npb25MZW5ndGgsXG4gICAgZGVmYXVsdExpbWl0LFxuICAgIG1heExpbWl0LFxuICAgIGFjY291bnRMb2Nrb3V0LFxuICAgIHBhc3N3b3JkUG9saWN5LFxuICAgIG1hc3RlcktleUlwcyxcbiAgICBtYXN0ZXJLZXksXG4gICAgbWFpbnRlbmFuY2VLZXksXG4gICAgbWFpbnRlbmFuY2VLZXlJcHMsXG4gICAgcmVhZE9ubHlNYXN0ZXJLZXksXG4gICAgcmVhZE9ubHlNYXN0ZXJLZXlJcHMsXG4gICAgYWxsb3dIZWFkZXJzLFxuICAgIGlkZW1wb3RlbmN5T3B0aW9ucyxcbiAgICBmaWxlVXBsb2FkLFxuICAgIGZpbGVEb3dubG9hZCxcbiAgICBwYWdlcyxcbiAgICBzZWN1cml0eSxcbiAgICBlbmZvcmNlUHJpdmF0ZVVzZXJzLFxuICAgIGVuYWJsZUluc2VjdXJlQXV0aEFkYXB0ZXJzLFxuICAgIHNjaGVtYSxcbiAgICByZXF1ZXN0S2V5d29yZERlbnlsaXN0LFxuICAgIGFsbG93RXhwaXJlZEF1dGhEYXRhVG9rZW4sXG4gICAgbG9nTGV2ZWxzLFxuICAgIHJhdGVMaW1pdCxcbiAgICBkYXRhYmFzZU9wdGlvbnMsXG4gICAgZXh0ZW5kU2Vzc2lvbk9uVXNlLFxuICAgIGFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbixcbiAgICByZXF1ZXN0Q29tcGxleGl0eSxcbiAgICBsaXZlUXVlcnksXG4gICAgcm91dGVBbGxvd0xpc3QsXG4gICAgaW5zdGFsbGF0aW9uLFxuICB9KSB7XG4gICAgaWYgKG1hc3RlcktleSA9PT0gcmVhZE9ubHlNYXN0ZXJLZXkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignbWFzdGVyS2V5IGFuZCByZWFkT25seU1hc3RlcktleSBzaG91bGQgYmUgZGlmZmVyZW50Jyk7XG4gICAgfVxuXG4gICAgaWYgKG1hc3RlcktleSA9PT0gbWFpbnRlbmFuY2VLZXkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignbWFzdGVyS2V5IGFuZCBtYWludGVuYW5jZUtleSBzaG91bGQgYmUgZGlmZmVyZW50Jyk7XG4gICAgfVxuXG4gICAgdGhpcy52YWxpZGF0ZUFjY291bnRMb2Nrb3V0UG9saWN5KGFjY291bnRMb2Nrb3V0KTtcbiAgICB0aGlzLnZhbGlkYXRlUGFzc3dvcmRQb2xpY3kocGFzc3dvcmRQb2xpY3kpO1xuICAgIHRoaXMudmFsaWRhdGVGaWxlVXBsb2FkT3B0aW9ucyhmaWxlVXBsb2FkKTtcbiAgICBpZiAoZmlsZURvd25sb2FkID09IG51bGwpIHtcbiAgICAgIGZpbGVEb3dubG9hZCA9IHt9O1xuICAgICAgYXJndW1lbnRzWzBdLmZpbGVEb3dubG9hZCA9IGZpbGVEb3dubG9hZDtcbiAgICB9XG4gICAgdGhpcy52YWxpZGF0ZUZpbGVEb3dubG9hZE9wdGlvbnMoZmlsZURvd25sb2FkKTtcblxuICAgIGlmICh0eXBlb2YgcmV2b2tlU2Vzc2lvbk9uUGFzc3dvcmRSZXNldCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyAncmV2b2tlU2Vzc2lvbk9uUGFzc3dvcmRSZXNldCBtdXN0IGJlIGEgYm9vbGVhbiB2YWx1ZSc7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBleHRlbmRTZXNzaW9uT25Vc2UgIT09ICdib29sZWFuJykge1xuICAgICAgdGhyb3cgJ2V4dGVuZFNlc3Npb25PblVzZSBtdXN0IGJlIGEgYm9vbGVhbiB2YWx1ZSc7XG4gICAgfVxuXG4gICAgdGhpcy52YWxpZGF0ZVB1YmxpY1NlcnZlclVSTCh7IHB1YmxpY1NlcnZlclVSTCB9KTtcbiAgICB0aGlzLnZhbGlkYXRlU2Vzc2lvbkNvbmZpZ3VyYXRpb24oc2Vzc2lvbkxlbmd0aCwgZXhwaXJlSW5hY3RpdmVTZXNzaW9ucyk7XG4gICAgdGhpcy52YWxpZGF0ZUlwcygnbWFzdGVyS2V5SXBzJywgbWFzdGVyS2V5SXBzKTtcbiAgICB0aGlzLnZhbGlkYXRlSXBzKCdtYWludGVuYW5jZUtleUlwcycsIG1haW50ZW5hbmNlS2V5SXBzKTtcbiAgICB0aGlzLnZhbGlkYXRlSXBzKCdyZWFkT25seU1hc3RlcktleUlwcycsIHJlYWRPbmx5TWFzdGVyS2V5SXBzKTtcbiAgICB0aGlzLnZhbGlkYXRlRGVmYXVsdExpbWl0KGRlZmF1bHRMaW1pdCk7XG4gICAgdGhpcy52YWxpZGF0ZU1heExpbWl0KG1heExpbWl0KTtcbiAgICB0aGlzLnZhbGlkYXRlQWxsb3dIZWFkZXJzKGFsbG93SGVhZGVycyk7XG4gICAgdGhpcy52YWxpZGF0ZUlkZW1wb3RlbmN5T3B0aW9ucyhpZGVtcG90ZW5jeU9wdGlvbnMpO1xuICAgIHRoaXMudmFsaWRhdGVQYWdlc09wdGlvbnMocGFnZXMpO1xuICAgIHRoaXMudmFsaWRhdGVTZWN1cml0eU9wdGlvbnMoc2VjdXJpdHkpO1xuICAgIHRoaXMudmFsaWRhdGVTY2hlbWFPcHRpb25zKHNjaGVtYSk7XG4gICAgdGhpcy52YWxpZGF0ZUVuZm9yY2VQcml2YXRlVXNlcnMoZW5mb3JjZVByaXZhdGVVc2Vycyk7XG4gICAgdGhpcy52YWxpZGF0ZUVuYWJsZUluc2VjdXJlQXV0aEFkYXB0ZXJzKGVuYWJsZUluc2VjdXJlQXV0aEFkYXB0ZXJzKTtcbiAgICB0aGlzLnZhbGlkYXRlQWxsb3dFeHBpcmVkQXV0aERhdGFUb2tlbihhbGxvd0V4cGlyZWRBdXRoRGF0YVRva2VuKTtcbiAgICB0aGlzLnZhbGlkYXRlUmVxdWVzdEtleXdvcmREZW55bGlzdChyZXF1ZXN0S2V5d29yZERlbnlsaXN0KTtcbiAgICB0aGlzLnZhbGlkYXRlUmF0ZUxpbWl0KHJhdGVMaW1pdCk7XG4gICAgdGhpcy52YWxpZGF0ZUxvZ0xldmVscyhsb2dMZXZlbHMpO1xuICAgIHRoaXMudmFsaWRhdGVEYXRhYmFzZU9wdGlvbnMoZGF0YWJhc2VPcHRpb25zKTtcbiAgICB0aGlzLnZhbGlkYXRlQ3VzdG9tUGFnZXMoY3VzdG9tUGFnZXMpO1xuICAgIHRoaXMudmFsaWRhdGVBbGxvd0NsaWVudENsYXNzQ3JlYXRpb24oYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uKTtcbiAgICB0aGlzLnZhbGlkYXRlUmVxdWVzdENvbXBsZXhpdHkocmVxdWVzdENvbXBsZXhpdHkpO1xuICAgIHRoaXMudmFsaWRhdGVMaXZlUXVlcnlPcHRpb25zKGxpdmVRdWVyeSk7XG4gICAgdGhpcy52YWxpZGF0ZVJvdXRlQWxsb3dMaXN0KHJvdXRlQWxsb3dMaXN0KTtcbiAgICB0aGlzLnZhbGlkYXRlSW5zdGFsbGF0aW9uKGluc3RhbGxhdGlvbik7XG4gIH1cblxuICBzdGF0aWMgdmFsaWRhdGVDdXN0b21QYWdlcyhjdXN0b21QYWdlcykge1xuICAgIGlmICghY3VzdG9tUGFnZXMpIHsgcmV0dXJuOyB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGN1c3RvbVBhZ2VzKSAhPT0gJ1tvYmplY3QgT2JqZWN0XScpIHtcbiAgICAgIHRocm93IEVycm9yKCdQYXJzZSBTZXJ2ZXIgb3B0aW9uIGN1c3RvbVBhZ2VzIG11c3QgYmUgYW4gb2JqZWN0LicpO1xuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZUNvbnRyb2xsZXJzKHtcbiAgICB2ZXJpZnlVc2VyRW1haWxzLFxuICAgIHVzZXJDb250cm9sbGVyLFxuICAgIGFwcE5hbWUsXG4gICAgcHVibGljU2VydmVyVVJMLFxuICAgIF9wdWJsaWNTZXJ2ZXJVUkwsXG4gICAgZW1haWxWZXJpZnlUb2tlblZhbGlkaXR5RHVyYXRpb24sXG4gICAgZW1haWxWZXJpZnlUb2tlblJldXNlSWZWYWxpZCxcbiAgICBlbWFpbFZlcmlmeVN1Y2Nlc3NPbkludmFsaWRFbWFpbCxcbiAgfSkge1xuICAgIGNvbnN0IGVtYWlsQWRhcHRlciA9IHVzZXJDb250cm9sbGVyLmFkYXB0ZXI7XG4gICAgaWYgKHZlcmlmeVVzZXJFbWFpbHMpIHtcbiAgICAgIHRoaXMudmFsaWRhdGVFbWFpbENvbmZpZ3VyYXRpb24oe1xuICAgICAgICBlbWFpbEFkYXB0ZXIsXG4gICAgICAgIGFwcE5hbWUsXG4gICAgICAgIHB1YmxpY1NlcnZlclVSTDogcHVibGljU2VydmVyVVJMIHx8IF9wdWJsaWNTZXJ2ZXJVUkwsXG4gICAgICAgIGVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uLFxuICAgICAgICBlbWFpbFZlcmlmeVRva2VuUmV1c2VJZlZhbGlkLFxuICAgICAgICBlbWFpbFZlcmlmeVN1Y2Nlc3NPbkludmFsaWRFbWFpbCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZVJlcXVlc3RLZXl3b3JkRGVueWxpc3QocmVxdWVzdEtleXdvcmREZW55bGlzdCkge1xuICAgIGlmIChyZXF1ZXN0S2V5d29yZERlbnlsaXN0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlcXVlc3RLZXl3b3JkRGVueWxpc3QgPSByZXF1ZXN0S2V5d29yZERlbnlsaXN0LmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICghQXJyYXkuaXNBcnJheShyZXF1ZXN0S2V5d29yZERlbnlsaXN0KSkge1xuICAgICAgdGhyb3cgJ1BhcnNlIFNlcnZlciBvcHRpb24gcmVxdWVzdEtleXdvcmREZW55bGlzdCBtdXN0IGJlIGFuIGFycmF5Lic7XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIHZhbGlkYXRlRW5mb3JjZVByaXZhdGVVc2VycyhlbmZvcmNlUHJpdmF0ZVVzZXJzKSB7XG4gICAgaWYgKHR5cGVvZiBlbmZvcmNlUHJpdmF0ZVVzZXJzICE9PSAnYm9vbGVhbicpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIGVuZm9yY2VQcml2YXRlVXNlcnMgbXVzdCBiZSBhIGJvb2xlYW4uJztcbiAgICB9XG4gIH1cblxuICBzdGF0aWMgdmFsaWRhdGVBbGxvd0V4cGlyZWRBdXRoRGF0YVRva2VuKGFsbG93RXhwaXJlZEF1dGhEYXRhVG9rZW4pIHtcbiAgICBpZiAodHlwZW9mIGFsbG93RXhwaXJlZEF1dGhEYXRhVG9rZW4gIT09ICdib29sZWFuJykge1xuICAgICAgdGhyb3cgJ1BhcnNlIFNlcnZlciBvcHRpb24gYWxsb3dFeHBpcmVkQXV0aERhdGFUb2tlbiBtdXN0IGJlIGEgYm9vbGVhbi4nO1xuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZUFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbihhbGxvd0NsaWVudENsYXNzQ3JlYXRpb24pIHtcbiAgICBpZiAodHlwZW9mIGFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyAnUGFyc2UgU2VydmVyIG9wdGlvbiBhbGxvd0NsaWVudENsYXNzQ3JlYXRpb24gbXVzdCBiZSBhIGJvb2xlYW4uJztcbiAgICB9XG4gIH1cblxuICBzdGF0aWMgdmFsaWRhdGVTZWN1cml0eU9wdGlvbnMoc2VjdXJpdHkpIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHNlY3VyaXR5KSAhPT0gJ1tvYmplY3QgT2JqZWN0XScpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIHNlY3VyaXR5IG11c3QgYmUgYW4gb2JqZWN0Lic7XG4gICAgfVxuICAgIGlmIChzZWN1cml0eS5lbmFibGVDaGVjayA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBzZWN1cml0eS5lbmFibGVDaGVjayA9IFNlY3VyaXR5T3B0aW9ucy5lbmFibGVDaGVjay5kZWZhdWx0O1xuICAgIH0gZWxzZSBpZiAoIWlzQm9vbGVhbihzZWN1cml0eS5lbmFibGVDaGVjaykpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIHNlY3VyaXR5LmVuYWJsZUNoZWNrIG11c3QgYmUgYSBib29sZWFuLic7XG4gICAgfVxuICAgIGlmIChzZWN1cml0eS5lbmFibGVDaGVja0xvZyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBzZWN1cml0eS5lbmFibGVDaGVja0xvZyA9IFNlY3VyaXR5T3B0aW9ucy5lbmFibGVDaGVja0xvZy5kZWZhdWx0O1xuICAgIH0gZWxzZSBpZiAoIWlzQm9vbGVhbihzZWN1cml0eS5lbmFibGVDaGVja0xvZykpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIHNlY3VyaXR5LmVuYWJsZUNoZWNrTG9nIG11c3QgYmUgYSBib29sZWFuLic7XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIHZhbGlkYXRlU2NoZW1hT3B0aW9ucyhzY2hlbWE6IFNjaGVtYU9wdGlvbnMpIHtcbiAgICBpZiAoIXNjaGVtYSkgeyByZXR1cm47IH1cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHNjaGVtYSkgIT09ICdbb2JqZWN0IE9iamVjdF0nKSB7XG4gICAgICB0aHJvdyAnUGFyc2UgU2VydmVyIG9wdGlvbiBzY2hlbWEgbXVzdCBiZSBhbiBvYmplY3QuJztcbiAgICB9XG4gICAgaWYgKHNjaGVtYS5kZWZpbml0aW9ucyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBzY2hlbWEuZGVmaW5pdGlvbnMgPSBTY2hlbWFPcHRpb25zLmRlZmluaXRpb25zLmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICghQXJyYXkuaXNBcnJheShzY2hlbWEuZGVmaW5pdGlvbnMpKSB7XG4gICAgICB0aHJvdyAnUGFyc2UgU2VydmVyIG9wdGlvbiBzY2hlbWEuZGVmaW5pdGlvbnMgbXVzdCBiZSBhbiBhcnJheS4nO1xuICAgIH1cbiAgICBpZiAoc2NoZW1hLnN0cmljdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBzY2hlbWEuc3RyaWN0ID0gU2NoZW1hT3B0aW9ucy5zdHJpY3QuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKCFpc0Jvb2xlYW4oc2NoZW1hLnN0cmljdCkpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIHNjaGVtYS5zdHJpY3QgbXVzdCBiZSBhIGJvb2xlYW4uJztcbiAgICB9XG4gICAgaWYgKHNjaGVtYS5kZWxldGVFeHRyYUZpZWxkcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBzY2hlbWEuZGVsZXRlRXh0cmFGaWVsZHMgPSBTY2hlbWFPcHRpb25zLmRlbGV0ZUV4dHJhRmllbGRzLmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICghaXNCb29sZWFuKHNjaGVtYS5kZWxldGVFeHRyYUZpZWxkcykpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIHNjaGVtYS5kZWxldGVFeHRyYUZpZWxkcyBtdXN0IGJlIGEgYm9vbGVhbi4nO1xuICAgIH1cbiAgICBpZiAoc2NoZW1hLnJlY3JlYXRlTW9kaWZpZWRGaWVsZHMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgc2NoZW1hLnJlY3JlYXRlTW9kaWZpZWRGaWVsZHMgPSBTY2hlbWFPcHRpb25zLnJlY3JlYXRlTW9kaWZpZWRGaWVsZHMuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKCFpc0Jvb2xlYW4oc2NoZW1hLnJlY3JlYXRlTW9kaWZpZWRGaWVsZHMpKSB7XG4gICAgICB0aHJvdyAnUGFyc2UgU2VydmVyIG9wdGlvbiBzY2hlbWEucmVjcmVhdGVNb2RpZmllZEZpZWxkcyBtdXN0IGJlIGEgYm9vbGVhbi4nO1xuICAgIH1cbiAgICBpZiAoc2NoZW1hLmxvY2tTY2hlbWFzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHNjaGVtYS5sb2NrU2NoZW1hcyA9IFNjaGVtYU9wdGlvbnMubG9ja1NjaGVtYXMuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKCFpc0Jvb2xlYW4oc2NoZW1hLmxvY2tTY2hlbWFzKSkge1xuICAgICAgdGhyb3cgJ1BhcnNlIFNlcnZlciBvcHRpb24gc2NoZW1hLmxvY2tTY2hlbWFzIG11c3QgYmUgYSBib29sZWFuLic7XG4gICAgfVxuICAgIGlmIChzY2hlbWEuYmVmb3JlTWlncmF0aW9uID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHNjaGVtYS5iZWZvcmVNaWdyYXRpb24gPSBudWxsO1xuICAgIH0gZWxzZSBpZiAoc2NoZW1hLmJlZm9yZU1pZ3JhdGlvbiAhPT0gbnVsbCAmJiB0eXBlb2Ygc2NoZW1hLmJlZm9yZU1pZ3JhdGlvbiAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgJ1BhcnNlIFNlcnZlciBvcHRpb24gc2NoZW1hLmJlZm9yZU1pZ3JhdGlvbiBtdXN0IGJlIGEgZnVuY3Rpb24uJztcbiAgICB9XG4gICAgaWYgKHNjaGVtYS5hZnRlck1pZ3JhdGlvbiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBzY2hlbWEuYWZ0ZXJNaWdyYXRpb24gPSBudWxsO1xuICAgIH0gZWxzZSBpZiAoc2NoZW1hLmFmdGVyTWlncmF0aW9uICE9PSBudWxsICYmIHR5cGVvZiBzY2hlbWEuYWZ0ZXJNaWdyYXRpb24gIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIHNjaGVtYS5hZnRlck1pZ3JhdGlvbiBtdXN0IGJlIGEgZnVuY3Rpb24uJztcbiAgICB9XG4gIH1cblxuICBzdGF0aWMgdmFsaWRhdGVQYWdlc09wdGlvbnMocGFnZXMpIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHBhZ2VzKSAhPT0gJ1tvYmplY3QgT2JqZWN0XScpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIHBhZ2VzIG11c3QgYmUgYW4gb2JqZWN0Lic7XG4gICAgfVxuICAgIGlmIChwYWdlcy5lbmFibGVMb2NhbGl6YXRpb24gPT09IHVuZGVmaW5lZCkge1xuICAgICAgcGFnZXMuZW5hYmxlTG9jYWxpemF0aW9uID0gUGFnZXNPcHRpb25zLmVuYWJsZUxvY2FsaXphdGlvbi5kZWZhdWx0O1xuICAgIH0gZWxzZSBpZiAoIWlzQm9vbGVhbihwYWdlcy5lbmFibGVMb2NhbGl6YXRpb24pKSB7XG4gICAgICB0aHJvdyAnUGFyc2UgU2VydmVyIG9wdGlvbiBwYWdlcy5lbmFibGVMb2NhbGl6YXRpb24gbXVzdCBiZSBhIGJvb2xlYW4uJztcbiAgICB9XG4gICAgaWYgKHBhZ2VzLmxvY2FsaXphdGlvbkpzb25QYXRoID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhZ2VzLmxvY2FsaXphdGlvbkpzb25QYXRoID0gUGFnZXNPcHRpb25zLmxvY2FsaXphdGlvbkpzb25QYXRoLmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICghaXNTdHJpbmcocGFnZXMubG9jYWxpemF0aW9uSnNvblBhdGgpKSB7XG4gICAgICB0aHJvdyAnUGFyc2UgU2VydmVyIG9wdGlvbiBwYWdlcy5sb2NhbGl6YXRpb25Kc29uUGF0aCBtdXN0IGJlIGEgc3RyaW5nLic7XG4gICAgfVxuICAgIGlmIChwYWdlcy5sb2NhbGl6YXRpb25GYWxsYmFja0xvY2FsZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYWdlcy5sb2NhbGl6YXRpb25GYWxsYmFja0xvY2FsZSA9IFBhZ2VzT3B0aW9ucy5sb2NhbGl6YXRpb25GYWxsYmFja0xvY2FsZS5kZWZhdWx0O1xuICAgIH0gZWxzZSBpZiAoIWlzU3RyaW5nKHBhZ2VzLmxvY2FsaXphdGlvbkZhbGxiYWNrTG9jYWxlKSkge1xuICAgICAgdGhyb3cgJ1BhcnNlIFNlcnZlciBvcHRpb24gcGFnZXMubG9jYWxpemF0aW9uRmFsbGJhY2tMb2NhbGUgbXVzdCBiZSBhIHN0cmluZy4nO1xuICAgIH1cbiAgICBpZiAocGFnZXMucGxhY2Vob2xkZXJzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhZ2VzLnBsYWNlaG9sZGVycyA9IFBhZ2VzT3B0aW9ucy5wbGFjZWhvbGRlcnMuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKFxuICAgICAgT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHBhZ2VzLnBsYWNlaG9sZGVycykgIT09ICdbb2JqZWN0IE9iamVjdF0nICYmXG4gICAgICB0eXBlb2YgcGFnZXMucGxhY2Vob2xkZXJzICE9PSAnZnVuY3Rpb24nXG4gICAgKSB7XG4gICAgICB0aHJvdyAnUGFyc2UgU2VydmVyIG9wdGlvbiBwYWdlcy5wbGFjZWhvbGRlcnMgbXVzdCBiZSBhbiBvYmplY3Qgb3IgYSBmdW5jdGlvbi4nO1xuICAgIH1cbiAgICBpZiAocGFnZXMuZm9yY2VSZWRpcmVjdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYWdlcy5mb3JjZVJlZGlyZWN0ID0gUGFnZXNPcHRpb25zLmZvcmNlUmVkaXJlY3QuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKCFpc0Jvb2xlYW4ocGFnZXMuZm9yY2VSZWRpcmVjdCkpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIHBhZ2VzLmZvcmNlUmVkaXJlY3QgbXVzdCBiZSBhIGJvb2xlYW4uJztcbiAgICB9XG4gICAgaWYgKHBhZ2VzLnBhZ2VzUGF0aCAhPT0gdW5kZWZpbmVkICYmICFpc1N0cmluZyhwYWdlcy5wYWdlc1BhdGgpKSB7XG4gICAgICB0aHJvdyAnUGFyc2UgU2VydmVyIG9wdGlvbiBwYWdlcy5wYWdlc1BhdGggbXVzdCBiZSBhIHN0cmluZy4nO1xuICAgIH1cbiAgICBpZiAocGFnZXMucGFnZXNFbmRwb2ludCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYWdlcy5wYWdlc0VuZHBvaW50ID0gUGFnZXNPcHRpb25zLnBhZ2VzRW5kcG9pbnQuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKCFpc1N0cmluZyhwYWdlcy5wYWdlc0VuZHBvaW50KSkge1xuICAgICAgdGhyb3cgJ1BhcnNlIFNlcnZlciBvcHRpb24gcGFnZXMucGFnZXNFbmRwb2ludCBtdXN0IGJlIGEgc3RyaW5nLic7XG4gICAgfVxuICAgIGlmIChwYWdlcy5jdXN0b21VcmxzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhZ2VzLmN1c3RvbVVybHMgPSBQYWdlc09wdGlvbnMuY3VzdG9tVXJscy5kZWZhdWx0O1xuICAgIH0gZWxzZSBpZiAoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHBhZ2VzLmN1c3RvbVVybHMpICE9PSAnW29iamVjdCBPYmplY3RdJykge1xuICAgICAgdGhyb3cgJ1BhcnNlIFNlcnZlciBvcHRpb24gcGFnZXMuY3VzdG9tVXJscyBtdXN0IGJlIGFuIG9iamVjdC4nO1xuICAgIH1cbiAgICBpZiAocGFnZXMuY3VzdG9tUm91dGVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhZ2VzLmN1c3RvbVJvdXRlcyA9IFBhZ2VzT3B0aW9ucy5jdXN0b21Sb3V0ZXMuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKCFBcnJheS5pc0FycmF5KHBhZ2VzLmN1c3RvbVJvdXRlcykpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIHBhZ2VzLmN1c3RvbVJvdXRlcyBtdXN0IGJlIGFuIGFycmF5Lic7XG4gICAgfVxuICAgIGlmIChwYWdlcy5lbmNvZGVQYWdlUGFyYW1IZWFkZXJzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhZ2VzLmVuY29kZVBhZ2VQYXJhbUhlYWRlcnMgPSBQYWdlc09wdGlvbnMuZW5jb2RlUGFnZVBhcmFtSGVhZGVycy5kZWZhdWx0O1xuICAgIH0gZWxzZSBpZiAoIWlzQm9vbGVhbihwYWdlcy5lbmNvZGVQYWdlUGFyYW1IZWFkZXJzKSkge1xuICAgICAgdGhyb3cgJ1BhcnNlIFNlcnZlciBvcHRpb24gcGFnZXMuZW5jb2RlUGFnZVBhcmFtSGVhZGVycyBtdXN0IGJlIGEgYm9vbGVhbi4nO1xuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZUlkZW1wb3RlbmN5T3B0aW9ucyhpZGVtcG90ZW5jeU9wdGlvbnMpIHtcbiAgICBpZiAoIWlkZW1wb3RlbmN5T3B0aW9ucykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoaWRlbXBvdGVuY3lPcHRpb25zLnR0bCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZGVtcG90ZW5jeU9wdGlvbnMudHRsID0gSWRlbXBvdGVuY3lPcHRpb25zLnR0bC5kZWZhdWx0O1xuICAgIH0gZWxzZSBpZiAoIWlzTmFOKGlkZW1wb3RlbmN5T3B0aW9ucy50dGwpICYmIGlkZW1wb3RlbmN5T3B0aW9ucy50dGwgPD0gMCkge1xuICAgICAgdGhyb3cgJ2lkZW1wb3RlbmN5IFRUTCB2YWx1ZSBtdXN0IGJlIGdyZWF0ZXIgdGhhbiAwIHNlY29uZHMnO1xuICAgIH0gZWxzZSBpZiAoaXNOYU4oaWRlbXBvdGVuY3lPcHRpb25zLnR0bCkpIHtcbiAgICAgIHRocm93ICdpZGVtcG90ZW5jeSBUVEwgdmFsdWUgbXVzdCBiZSBhIG51bWJlcic7XG4gICAgfVxuICAgIGlmICghaWRlbXBvdGVuY3lPcHRpb25zLnBhdGhzKSB7XG4gICAgICBpZGVtcG90ZW5jeU9wdGlvbnMucGF0aHMgPSBJZGVtcG90ZW5jeU9wdGlvbnMucGF0aHMuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKCFBcnJheS5pc0FycmF5KGlkZW1wb3RlbmN5T3B0aW9ucy5wYXRocykpIHtcbiAgICAgIHRocm93ICdpZGVtcG90ZW5jeSBwYXRocyBtdXN0IGJlIG9mIGFuIGFycmF5IG9mIHN0cmluZ3MnO1xuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZUFjY291bnRMb2Nrb3V0UG9saWN5KGFjY291bnRMb2Nrb3V0KSB7XG4gICAgaWYgKGFjY291bnRMb2Nrb3V0KSB7XG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBhY2NvdW50TG9ja291dC5kdXJhdGlvbiAhPT0gJ251bWJlcicgfHxcbiAgICAgICAgYWNjb3VudExvY2tvdXQuZHVyYXRpb24gPD0gMCB8fFxuICAgICAgICBhY2NvdW50TG9ja291dC5kdXJhdGlvbiA+IDk5OTk5XG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgJ0FjY291bnQgbG9ja291dCBkdXJhdGlvbiBzaG91bGQgYmUgZ3JlYXRlciB0aGFuIDAgYW5kIGxlc3MgdGhhbiAxMDAwMDAnO1xuICAgICAgfVxuXG4gICAgICBpZiAoXG4gICAgICAgICFOdW1iZXIuaXNJbnRlZ2VyKGFjY291bnRMb2Nrb3V0LnRocmVzaG9sZCkgfHxcbiAgICAgICAgYWNjb3VudExvY2tvdXQudGhyZXNob2xkIDwgMSB8fFxuICAgICAgICBhY2NvdW50TG9ja291dC50aHJlc2hvbGQgPiA5OTlcbiAgICAgICkge1xuICAgICAgICB0aHJvdyAnQWNjb3VudCBsb2Nrb3V0IHRocmVzaG9sZCBzaG91bGQgYmUgYW4gaW50ZWdlciBncmVhdGVyIHRoYW4gMCBhbmQgbGVzcyB0aGFuIDEwMDAnO1xuICAgICAgfVxuXG4gICAgICBpZiAoYWNjb3VudExvY2tvdXQudW5sb2NrT25QYXNzd29yZFJlc2V0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgYWNjb3VudExvY2tvdXQudW5sb2NrT25QYXNzd29yZFJlc2V0ID0gQWNjb3VudExvY2tvdXRPcHRpb25zLnVubG9ja09uUGFzc3dvcmRSZXNldC5kZWZhdWx0O1xuICAgICAgfSBlbHNlIGlmICghaXNCb29sZWFuKGFjY291bnRMb2Nrb3V0LnVubG9ja09uUGFzc3dvcmRSZXNldCkpIHtcbiAgICAgICAgdGhyb3cgJ1BhcnNlIFNlcnZlciBvcHRpb24gYWNjb3VudExvY2tvdXQudW5sb2NrT25QYXNzd29yZFJlc2V0IG11c3QgYmUgYSBib29sZWFuLic7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIHZhbGlkYXRlUGFzc3dvcmRQb2xpY3kocGFzc3dvcmRQb2xpY3kpIHtcbiAgICBpZiAocGFzc3dvcmRQb2xpY3kpIHtcbiAgICAgIGlmIChcbiAgICAgICAgcGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRBZ2UgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAodHlwZW9mIHBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkQWdlICE9PSAnbnVtYmVyJyB8fCBwYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEFnZSA8IDApXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgJ3Bhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkQWdlIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInO1xuICAgICAgfVxuXG4gICAgICBpZiAoXG4gICAgICAgIHBhc3N3b3JkUG9saWN5LnJlc2V0VG9rZW5WYWxpZGl0eUR1cmF0aW9uICE9PSB1bmRlZmluZWQgJiZcbiAgICAgICAgKHR5cGVvZiBwYXNzd29yZFBvbGljeS5yZXNldFRva2VuVmFsaWRpdHlEdXJhdGlvbiAhPT0gJ251bWJlcicgfHxcbiAgICAgICAgICBwYXNzd29yZFBvbGljeS5yZXNldFRva2VuVmFsaWRpdHlEdXJhdGlvbiA8PSAwKVxuICAgICAgKSB7XG4gICAgICAgIHRocm93ICdwYXNzd29yZFBvbGljeS5yZXNldFRva2VuVmFsaWRpdHlEdXJhdGlvbiBtdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyJztcbiAgICAgIH1cblxuICAgICAgaWYgKHBhc3N3b3JkUG9saWN5LnZhbGlkYXRvclBhdHRlcm4pIHtcbiAgICAgICAgaWYgKHR5cGVvZiBwYXNzd29yZFBvbGljeS52YWxpZGF0b3JQYXR0ZXJuID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIHBhc3N3b3JkUG9saWN5LnZhbGlkYXRvclBhdHRlcm4gPSBuZXcgUmVnRXhwKHBhc3N3b3JkUG9saWN5LnZhbGlkYXRvclBhdHRlcm4pO1xuICAgICAgICB9IGVsc2UgaWYgKCFVdGlscy5pc1JlZ0V4cChwYXNzd29yZFBvbGljeS52YWxpZGF0b3JQYXR0ZXJuKSkge1xuICAgICAgICAgIHRocm93ICdwYXNzd29yZFBvbGljeS52YWxpZGF0b3JQYXR0ZXJuIG11c3QgYmUgYSByZWdleCBzdHJpbmcgb3IgUmVnRXhwIG9iamVjdC4nO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChcbiAgICAgICAgcGFzc3dvcmRQb2xpY3kudmFsaWRhdG9yQ2FsbGJhY2sgJiZcbiAgICAgICAgdHlwZW9mIHBhc3N3b3JkUG9saWN5LnZhbGlkYXRvckNhbGxiYWNrICE9PSAnZnVuY3Rpb24nXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgJ3Bhc3N3b3JkUG9saWN5LnZhbGlkYXRvckNhbGxiYWNrIG11c3QgYmUgYSBmdW5jdGlvbi4nO1xuICAgICAgfVxuXG4gICAgICBpZiAoXG4gICAgICAgIHBhc3N3b3JkUG9saWN5LmRvTm90QWxsb3dVc2VybmFtZSAmJlxuICAgICAgICB0eXBlb2YgcGFzc3dvcmRQb2xpY3kuZG9Ob3RBbGxvd1VzZXJuYW1lICE9PSAnYm9vbGVhbidcbiAgICAgICkge1xuICAgICAgICB0aHJvdyAncGFzc3dvcmRQb2xpY3kuZG9Ob3RBbGxvd1VzZXJuYW1lIG11c3QgYmUgYSBib29sZWFuIHZhbHVlLic7XG4gICAgICB9XG5cbiAgICAgIGlmIChcbiAgICAgICAgcGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5ICYmXG4gICAgICAgICghTnVtYmVyLmlzSW50ZWdlcihwYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkpIHx8XG4gICAgICAgICAgcGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5IDw9IDAgfHxcbiAgICAgICAgICBwYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkgPiAyMClcbiAgICAgICkge1xuICAgICAgICB0aHJvdyAncGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5IG11c3QgYmUgYW4gaW50ZWdlciByYW5naW5nIDAgLSAyMCc7XG4gICAgICB9XG5cbiAgICAgIGlmIChcbiAgICAgICAgcGFzc3dvcmRQb2xpY3kucmVzZXRUb2tlblJldXNlSWZWYWxpZCAmJlxuICAgICAgICB0eXBlb2YgcGFzc3dvcmRQb2xpY3kucmVzZXRUb2tlblJldXNlSWZWYWxpZCAhPT0gJ2Jvb2xlYW4nXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgJ3Jlc2V0VG9rZW5SZXVzZUlmVmFsaWQgbXVzdCBiZSBhIGJvb2xlYW4gdmFsdWUnO1xuICAgICAgfVxuICAgICAgaWYgKHBhc3N3b3JkUG9saWN5LnJlc2V0VG9rZW5SZXVzZUlmVmFsaWQgJiYgIXBhc3N3b3JkUG9saWN5LnJlc2V0VG9rZW5WYWxpZGl0eUR1cmF0aW9uKSB7XG4gICAgICAgIHRocm93ICdZb3UgY2Fubm90IHVzZSByZXNldFRva2VuUmV1c2VJZlZhbGlkIHdpdGhvdXQgcmVzZXRUb2tlblZhbGlkaXR5RHVyYXRpb24nO1xuICAgICAgfVxuXG4gICAgICBpZiAoXG4gICAgICAgIHBhc3N3b3JkUG9saWN5LnJlc2V0UGFzc3dvcmRTdWNjZXNzT25JbnZhbGlkRW1haWwgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICB0eXBlb2YgcGFzc3dvcmRQb2xpY3kucmVzZXRQYXNzd29yZFN1Y2Nlc3NPbkludmFsaWRFbWFpbCAhPT0gJ2Jvb2xlYW4nXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgJ3Jlc2V0UGFzc3dvcmRTdWNjZXNzT25JbnZhbGlkRW1haWwgbXVzdCBiZSBhIGJvb2xlYW4gdmFsdWUnO1xuICAgICAgfVxuXG4gICAgfVxuICB9XG5cbiAgLy8gaWYgdGhlIHBhc3N3b3JkUG9saWN5LnZhbGlkYXRvclBhdHRlcm4gaXMgY29uZmlndXJlZCB0aGVuIHNldHVwIGEgY2FsbGJhY2sgdG8gcHJvY2VzcyB0aGUgcGF0dGVyblxuICBzdGF0aWMgc2V0dXBQYXNzd29yZFZhbGlkYXRvcihwYXNzd29yZFBvbGljeSkge1xuICAgIGlmIChwYXNzd29yZFBvbGljeSAmJiBwYXNzd29yZFBvbGljeS52YWxpZGF0b3JQYXR0ZXJuKSB7XG4gICAgICBwYXNzd29yZFBvbGljeS5wYXR0ZXJuVmFsaWRhdG9yID0gdmFsdWUgPT4ge1xuICAgICAgICByZXR1cm4gcGFzc3dvcmRQb2xpY3kudmFsaWRhdG9yUGF0dGVybi50ZXN0KHZhbHVlKTtcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIHZhbGlkYXRlUHVibGljU2VydmVyVVJMKHsgcHVibGljU2VydmVyVVJMLCByZXF1aXJlZCA9IGZhbHNlIH0pIHtcbiAgICBpZiAoIXB1YmxpY1NlcnZlclVSTCkge1xuICAgICAgaWYgKCFyZXF1aXJlZCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0aHJvdyAnVGhlIG9wdGlvbiBwdWJsaWNTZXJ2ZXJVUkwgaXMgcmVxdWlyZWQuJztcbiAgICB9XG5cbiAgICBjb25zdCB0eXBlID0gdHlwZW9mIHB1YmxpY1NlcnZlclVSTDtcblxuICAgIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgICAgaWYgKCFwdWJsaWNTZXJ2ZXJVUkwuc3RhcnRzV2l0aCgnaHR0cDovLycpICYmICFwdWJsaWNTZXJ2ZXJVUkwuc3RhcnRzV2l0aCgnaHR0cHM6Ly8nKSkge1xuICAgICAgICB0aHJvdyAnVGhlIG9wdGlvbiBwdWJsaWNTZXJ2ZXJVUkwgbXVzdCBiZSBhIHZhbGlkIFVSTCBzdGFydGluZyB3aXRoIGh0dHA6Ly8gb3IgaHR0cHM6Ly8uJztcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRocm93IGBUaGUgb3B0aW9uIHB1YmxpY1NlcnZlclVSTCBtdXN0IGJlIGEgc3RyaW5nIG9yIGZ1bmN0aW9uLCBidXQgZ290ICR7dHlwZX0uYDtcbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZUVtYWlsQ29uZmlndXJhdGlvbih7XG4gICAgZW1haWxBZGFwdGVyLFxuICAgIGFwcE5hbWUsXG4gICAgcHVibGljU2VydmVyVVJMLFxuICAgIGVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uLFxuICAgIGVtYWlsVmVyaWZ5VG9rZW5SZXVzZUlmVmFsaWQsXG4gICAgZW1haWxWZXJpZnlTdWNjZXNzT25JbnZhbGlkRW1haWwsXG4gIH0pIHtcbiAgICBpZiAoIWVtYWlsQWRhcHRlcikge1xuICAgICAgdGhyb3cgJ0FuIGVtYWlsQWRhcHRlciBpcyByZXF1aXJlZCBmb3IgZS1tYWlsIHZlcmlmaWNhdGlvbiBhbmQgcGFzc3dvcmQgcmVzZXRzLic7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgYXBwTmFtZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93ICdBbiBhcHAgbmFtZSBpcyByZXF1aXJlZCBmb3IgZS1tYWlsIHZlcmlmaWNhdGlvbiBhbmQgcGFzc3dvcmQgcmVzZXRzLic7XG4gICAgfVxuICAgIHRoaXMudmFsaWRhdGVQdWJsaWNTZXJ2ZXJVUkwoeyBwdWJsaWNTZXJ2ZXJVUkwsIHJlcXVpcmVkOiB0cnVlIH0pO1xuICAgIGlmIChlbWFpbFZlcmlmeVRva2VuVmFsaWRpdHlEdXJhdGlvbikge1xuICAgICAgaWYgKGlzTmFOKGVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uKSkge1xuICAgICAgICB0aHJvdyAnRW1haWwgdmVyaWZ5IHRva2VuIHZhbGlkaXR5IGR1cmF0aW9uIG11c3QgYmUgYSB2YWxpZCBudW1iZXIuJztcbiAgICAgIH0gZWxzZSBpZiAoZW1haWxWZXJpZnlUb2tlblZhbGlkaXR5RHVyYXRpb24gPD0gMCkge1xuICAgICAgICB0aHJvdyAnRW1haWwgdmVyaWZ5IHRva2VuIHZhbGlkaXR5IGR1cmF0aW9uIG11c3QgYmUgYSB2YWx1ZSBncmVhdGVyIHRoYW4gMC4nO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZW1haWxWZXJpZnlUb2tlblJldXNlSWZWYWxpZCAmJiB0eXBlb2YgZW1haWxWZXJpZnlUb2tlblJldXNlSWZWYWxpZCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyAnZW1haWxWZXJpZnlUb2tlblJldXNlSWZWYWxpZCBtdXN0IGJlIGEgYm9vbGVhbiB2YWx1ZSc7XG4gICAgfVxuICAgIGlmIChlbWFpbFZlcmlmeVRva2VuUmV1c2VJZlZhbGlkICYmICFlbWFpbFZlcmlmeVRva2VuVmFsaWRpdHlEdXJhdGlvbikge1xuICAgICAgdGhyb3cgJ1lvdSBjYW5ub3QgdXNlIGVtYWlsVmVyaWZ5VG9rZW5SZXVzZUlmVmFsaWQgd2l0aG91dCBlbWFpbFZlcmlmeVRva2VuVmFsaWRpdHlEdXJhdGlvbic7XG4gICAgfVxuICAgIGlmIChlbWFpbFZlcmlmeVN1Y2Nlc3NPbkludmFsaWRFbWFpbCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBlbWFpbFZlcmlmeVN1Y2Nlc3NPbkludmFsaWRFbWFpbCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyAnZW1haWxWZXJpZnlTdWNjZXNzT25JbnZhbGlkRW1haWwgbXVzdCBiZSBhIGJvb2xlYW4gdmFsdWUnO1xuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZUZpbGVVcGxvYWRPcHRpb25zKGZpbGVVcGxvYWQpIHtcbiAgICB0cnkge1xuICAgICAgaWYgKGZpbGVVcGxvYWQgPT0gbnVsbCB8fCB0eXBlb2YgZmlsZVVwbG9hZCAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShmaWxlVXBsb2FkKSkge1xuICAgICAgICB0aHJvdyAnZmlsZVVwbG9hZCBtdXN0IGJlIGFuIG9iamVjdCB2YWx1ZS4nO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChlIGluc3RhbmNlb2YgUmVmZXJlbmNlRXJyb3IpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gICAgaWYgKGZpbGVVcGxvYWQuZW5hYmxlRm9yQW5vbnltb3VzVXNlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBmaWxlVXBsb2FkLmVuYWJsZUZvckFub255bW91c1VzZXIgPSBGaWxlVXBsb2FkT3B0aW9ucy5lbmFibGVGb3JBbm9ueW1vdXNVc2VyLmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmlsZVVwbG9hZC5lbmFibGVGb3JBbm9ueW1vdXNVc2VyICE9PSAnYm9vbGVhbicpIHtcbiAgICAgIHRocm93ICdmaWxlVXBsb2FkLmVuYWJsZUZvckFub255bW91c1VzZXIgbXVzdCBiZSBhIGJvb2xlYW4gdmFsdWUuJztcbiAgICB9XG4gICAgaWYgKGZpbGVVcGxvYWQuZW5hYmxlRm9yUHVibGljID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGZpbGVVcGxvYWQuZW5hYmxlRm9yUHVibGljID0gRmlsZVVwbG9hZE9wdGlvbnMuZW5hYmxlRm9yUHVibGljLmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmlsZVVwbG9hZC5lbmFibGVGb3JQdWJsaWMgIT09ICdib29sZWFuJykge1xuICAgICAgdGhyb3cgJ2ZpbGVVcGxvYWQuZW5hYmxlRm9yUHVibGljIG11c3QgYmUgYSBib29sZWFuIHZhbHVlLic7XG4gICAgfVxuICAgIGlmIChmaWxlVXBsb2FkLmVuYWJsZUZvckF1dGhlbnRpY2F0ZWRVc2VyID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGZpbGVVcGxvYWQuZW5hYmxlRm9yQXV0aGVudGljYXRlZFVzZXIgPSBGaWxlVXBsb2FkT3B0aW9ucy5lbmFibGVGb3JBdXRoZW50aWNhdGVkVXNlci5kZWZhdWx0O1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpbGVVcGxvYWQuZW5hYmxlRm9yQXV0aGVudGljYXRlZFVzZXIgIT09ICdib29sZWFuJykge1xuICAgICAgdGhyb3cgJ2ZpbGVVcGxvYWQuZW5hYmxlRm9yQXV0aGVudGljYXRlZFVzZXIgbXVzdCBiZSBhIGJvb2xlYW4gdmFsdWUuJztcbiAgICB9XG4gICAgaWYgKGZpbGVVcGxvYWQuZmlsZUV4dGVuc2lvbnMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgZmlsZVVwbG9hZC5maWxlRXh0ZW5zaW9ucyA9IEZpbGVVcGxvYWRPcHRpb25zLmZpbGVFeHRlbnNpb25zLmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICghQXJyYXkuaXNBcnJheShmaWxlVXBsb2FkLmZpbGVFeHRlbnNpb25zKSkge1xuICAgICAgdGhyb3cgJ2ZpbGVVcGxvYWQuZmlsZUV4dGVuc2lvbnMgbXVzdCBiZSBhbiBhcnJheS4nO1xuICAgIH1cbiAgICBpZiAoZmlsZVVwbG9hZC5hbGxvd2VkRmlsZVVybERvbWFpbnMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgZmlsZVVwbG9hZC5hbGxvd2VkRmlsZVVybERvbWFpbnMgPSBGaWxlVXBsb2FkT3B0aW9ucy5hbGxvd2VkRmlsZVVybERvbWFpbnMuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKCFBcnJheS5pc0FycmF5KGZpbGVVcGxvYWQuYWxsb3dlZEZpbGVVcmxEb21haW5zKSkge1xuICAgICAgdGhyb3cgJ2ZpbGVVcGxvYWQuYWxsb3dlZEZpbGVVcmxEb21haW5zIG11c3QgYmUgYW4gYXJyYXkuJztcbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChjb25zdCBkb21haW4gb2YgZmlsZVVwbG9hZC5hbGxvd2VkRmlsZVVybERvbWFpbnMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBkb21haW4gIT09ICdzdHJpbmcnIHx8IGRvbWFpbiA9PT0gJycpIHtcbiAgICAgICAgICB0aHJvdyAnZmlsZVVwbG9hZC5hbGxvd2VkRmlsZVVybERvbWFpbnMgbXVzdCBjb250YWluIG9ubHkgbm9uLWVtcHR5IHN0cmluZ3MuJztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZUZpbGVEb3dubG9hZE9wdGlvbnMoZmlsZURvd25sb2FkKSB7XG4gICAgdHJ5IHtcbiAgICAgIGlmIChmaWxlRG93bmxvYWQgPT0gbnVsbCB8fCB0eXBlb2YgZmlsZURvd25sb2FkICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KGZpbGVEb3dubG9hZCkpIHtcbiAgICAgICAgdGhyb3cgJ2ZpbGVEb3dubG9hZCBtdXN0IGJlIGFuIG9iamVjdCB2YWx1ZS4nO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChlIGluc3RhbmNlb2YgUmVmZXJlbmNlRXJyb3IpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gICAgaWYgKGZpbGVEb3dubG9hZC5lbmFibGVGb3JBbm9ueW1vdXNVc2VyID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGZpbGVEb3dubG9hZC5lbmFibGVGb3JBbm9ueW1vdXNVc2VyID0gRmlsZURvd25sb2FkT3B0aW9ucy5lbmFibGVGb3JBbm9ueW1vdXNVc2VyLmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmlsZURvd25sb2FkLmVuYWJsZUZvckFub255bW91c1VzZXIgIT09ICdib29sZWFuJykge1xuICAgICAgdGhyb3cgJ2ZpbGVEb3dubG9hZC5lbmFibGVGb3JBbm9ueW1vdXNVc2VyIG11c3QgYmUgYSBib29sZWFuIHZhbHVlLic7XG4gICAgfVxuICAgIGlmIChmaWxlRG93bmxvYWQuZW5hYmxlRm9yUHVibGljID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGZpbGVEb3dubG9hZC5lbmFibGVGb3JQdWJsaWMgPSBGaWxlRG93bmxvYWRPcHRpb25zLmVuYWJsZUZvclB1YmxpYy5kZWZhdWx0O1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpbGVEb3dubG9hZC5lbmFibGVGb3JQdWJsaWMgIT09ICdib29sZWFuJykge1xuICAgICAgdGhyb3cgJ2ZpbGVEb3dubG9hZC5lbmFibGVGb3JQdWJsaWMgbXVzdCBiZSBhIGJvb2xlYW4gdmFsdWUuJztcbiAgICB9XG4gICAgaWYgKGZpbGVEb3dubG9hZC5lbmFibGVGb3JBdXRoZW50aWNhdGVkVXNlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBmaWxlRG93bmxvYWQuZW5hYmxlRm9yQXV0aGVudGljYXRlZFVzZXIgPSBGaWxlRG93bmxvYWRPcHRpb25zLmVuYWJsZUZvckF1dGhlbnRpY2F0ZWRVc2VyLmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmlsZURvd25sb2FkLmVuYWJsZUZvckF1dGhlbnRpY2F0ZWRVc2VyICE9PSAnYm9vbGVhbicpIHtcbiAgICAgIHRocm93ICdmaWxlRG93bmxvYWQuZW5hYmxlRm9yQXV0aGVudGljYXRlZFVzZXIgbXVzdCBiZSBhIGJvb2xlYW4gdmFsdWUuJztcbiAgICB9XG4gIH1cblxuICBzdGF0aWMgdmFsaWRhdGVJcHMoZmllbGQsIG1hc3RlcktleUlwcykge1xuICAgIGZvciAobGV0IGlwIG9mIG1hc3RlcktleUlwcykge1xuICAgICAgaWYgKGlwLmluY2x1ZGVzKCcvJykpIHtcbiAgICAgICAgaXAgPSBpcC5zcGxpdCgnLycpWzBdO1xuICAgICAgfVxuICAgICAgaWYgKCFuZXQuaXNJUChpcCkpIHtcbiAgICAgICAgdGhyb3cgYFRoZSBQYXJzZSBTZXJ2ZXIgb3B0aW9uIFwiJHtmaWVsZH1cIiBjb250YWlucyBhbiBpbnZhbGlkIElQIGFkZHJlc3MgXCIke2lwfVwiLmA7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIHZhbGlkYXRlRW5hYmxlSW5zZWN1cmVBdXRoQWRhcHRlcnMoZW5hYmxlSW5zZWN1cmVBdXRoQWRhcHRlcnMpIHtcbiAgICBpZiAoZW5hYmxlSW5zZWN1cmVBdXRoQWRhcHRlcnMgJiYgdHlwZW9mIGVuYWJsZUluc2VjdXJlQXV0aEFkYXB0ZXJzICE9PSAnYm9vbGVhbicpIHtcbiAgICAgIHRocm93ICdQYXJzZSBTZXJ2ZXIgb3B0aW9uIGVuYWJsZUluc2VjdXJlQXV0aEFkYXB0ZXJzIG11c3QgYmUgYSBib29sZWFuLic7XG4gICAgfVxuICAgIGlmIChlbmFibGVJbnNlY3VyZUF1dGhBZGFwdGVycykge1xuICAgICAgRGVwcmVjYXRvci5sb2dSdW50aW1lRGVwcmVjYXRpb24oeyB1c2FnZTogJ2luc2VjdXJlIGFkYXB0ZXInIH0pO1xuICAgIH1cbiAgfVxuXG4gIGdldCBtb3VudCgpIHtcbiAgICB2YXIgbW91bnQgPSB0aGlzLl9tb3VudDtcbiAgICBpZiAodGhpcy5wdWJsaWNTZXJ2ZXJVUkwpIHtcbiAgICAgIG1vdW50ID0gdGhpcy5wdWJsaWNTZXJ2ZXJVUkw7XG4gICAgfVxuICAgIHJldHVybiBtb3VudDtcbiAgfVxuXG4gIHNldCBtb3VudChuZXdWYWx1ZSkge1xuICAgIHRoaXMuX21vdW50ID0gbmV3VmFsdWU7XG4gIH1cblxuICBzdGF0aWMgdmFsaWRhdGVTZXNzaW9uQ29uZmlndXJhdGlvbihzZXNzaW9uTGVuZ3RoLCBleHBpcmVJbmFjdGl2ZVNlc3Npb25zKSB7XG4gICAgaWYgKGV4cGlyZUluYWN0aXZlU2Vzc2lvbnMpIHtcbiAgICAgIGlmIChpc05hTihzZXNzaW9uTGVuZ3RoKSkge1xuICAgICAgICB0aHJvdyAnU2Vzc2lvbiBsZW5ndGggbXVzdCBiZSBhIHZhbGlkIG51bWJlci4nO1xuICAgICAgfSBlbHNlIGlmIChzZXNzaW9uTGVuZ3RoIDw9IDApIHtcbiAgICAgICAgdGhyb3cgJ1Nlc3Npb24gbGVuZ3RoIG11c3QgYmUgYSB2YWx1ZSBncmVhdGVyIHRoYW4gMC4nO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZURlZmF1bHRMaW1pdChkZWZhdWx0TGltaXQpIHtcbiAgICBpZiAoZGVmYXVsdExpbWl0ID09IG51bGwpIHtcbiAgICAgIGRlZmF1bHRMaW1pdCA9IFBhcnNlU2VydmVyT3B0aW9ucy5kZWZhdWx0TGltaXQuZGVmYXVsdDtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBkZWZhdWx0TGltaXQgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyAnRGVmYXVsdCBsaW1pdCBtdXN0IGJlIGEgbnVtYmVyLic7XG4gICAgfVxuICAgIGlmIChkZWZhdWx0TGltaXQgPD0gMCkge1xuICAgICAgdGhyb3cgJ0RlZmF1bHQgbGltaXQgbXVzdCBiZSBhIHZhbHVlIGdyZWF0ZXIgdGhhbiAwLic7XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIHZhbGlkYXRlTWF4TGltaXQobWF4TGltaXQpIHtcbiAgICBpZiAobWF4TGltaXQgPD0gMCkge1xuICAgICAgdGhyb3cgJ01heCBsaW1pdCBtdXN0IGJlIGEgdmFsdWUgZ3JlYXRlciB0aGFuIDAuJztcbiAgICB9XG4gIH1cblxuICBzdGF0aWMgdmFsaWRhdGVSZXF1ZXN0Q29tcGxleGl0eShyZXF1ZXN0Q29tcGxleGl0eSkge1xuICAgIGlmIChyZXF1ZXN0Q29tcGxleGl0eSA9PSBudWxsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0eXBlb2YgcmVxdWVzdENvbXBsZXhpdHkgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkocmVxdWVzdENvbXBsZXhpdHkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3JlcXVlc3RDb21wbGV4aXR5IG11c3QgYmUgYW4gb2JqZWN0LicpO1xuICAgIH1cbiAgICBjb25zdCB2YWxpZEtleXMgPSBPYmplY3Qua2V5cyhSZXF1ZXN0Q29tcGxleGl0eU9wdGlvbnMpO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHJlcXVlc3RDb21wbGV4aXR5KSkge1xuICAgICAgaWYgKCF2YWxpZEtleXMuaW5jbHVkZXMoa2V5KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHJlcXVlc3RDb21wbGV4aXR5IGNvbnRhaW5zIHVua25vd24gcHJvcGVydHkgJyR7a2V5fScuYCk7XG4gICAgICB9XG4gICAgfVxuICAgIGZvciAoY29uc3Qga2V5IG9mIHZhbGlkS2V5cykge1xuICAgICAgaWYgKHJlcXVlc3RDb21wbGV4aXR5W2tleV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IHJlcXVlc3RDb21wbGV4aXR5W2tleV07XG4gICAgICAgIGNvbnN0IGRlZiA9IFJlcXVlc3RDb21wbGV4aXR5T3B0aW9uc1trZXldO1xuICAgICAgICBpZiAodHlwZW9mIGRlZi5kZWZhdWx0ID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgcmVxdWVzdENvbXBsZXhpdHkuJHtrZXl9IG11c3QgYmUgYSBib29sZWFuLmApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICghTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgKHZhbHVlIDwgMSAmJiB2YWx1ZSAhPT0gLTEpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGByZXF1ZXN0Q29tcGxleGl0eS4ke2tleX0gbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXIgb3IgLTEgdG8gZGlzYWJsZS5gKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVxdWVzdENvbXBsZXhpdHlba2V5XSA9IFJlcXVlc3RDb21wbGV4aXR5T3B0aW9uc1trZXldLmRlZmF1bHQ7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIHZhbGlkYXRlSW5zdGFsbGF0aW9uKGluc3RhbGxhdGlvbikge1xuICAgIGlmIChpbnN0YWxsYXRpb24gPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGluc3RhbGxhdGlvbiAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShpbnN0YWxsYXRpb24pIHx8IGluc3RhbGxhdGlvbiA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgJ2luc3RhbGxhdGlvbiBtdXN0IGJlIGFuIG9iamVjdC4nO1xuICAgIH1cbiAgICBjb25zdCB2YWxpZEtleXMgPSBbXG4gICAgICAnZHVwbGljYXRlRGV2aWNlVG9rZW5BY3Rpb25FbmZvcmNlQXV0aCcsXG4gICAgICAnZHVwbGljYXRlRGV2aWNlVG9rZW5BY3Rpb24nLFxuICAgICAgJ2R1cGxpY2F0ZURldmljZVRva2VuTWVyZ2VQcmlvcml0eScsXG4gICAgXTtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhpbnN0YWxsYXRpb24pKSB7XG4gICAgICBpZiAoIXZhbGlkS2V5cy5pbmNsdWRlcyhrZXkpKSB7XG4gICAgICAgIHRocm93IGBpbnN0YWxsYXRpb24gY29udGFpbnMgdW5rbm93biBwcm9wZXJ0eSAnJHtrZXl9Jy5gO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaW5zdGFsbGF0aW9uLmR1cGxpY2F0ZURldmljZVRva2VuQWN0aW9uRW5mb3JjZUF1dGggPT09IHVuZGVmaW5lZCkge1xuICAgICAgaW5zdGFsbGF0aW9uLmR1cGxpY2F0ZURldmljZVRva2VuQWN0aW9uRW5mb3JjZUF1dGggPVxuICAgICAgICBJbnN0YWxsYXRpb25PcHRpb25zLmR1cGxpY2F0ZURldmljZVRva2VuQWN0aW9uRW5mb3JjZUF1dGguZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBpbnN0YWxsYXRpb24uZHVwbGljYXRlRGV2aWNlVG9rZW5BY3Rpb25FbmZvcmNlQXV0aCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyAnaW5zdGFsbGF0aW9uLmR1cGxpY2F0ZURldmljZVRva2VuQWN0aW9uRW5mb3JjZUF1dGggbXVzdCBiZSBhIGJvb2xlYW4uJztcbiAgICB9XG4gICAgY29uc3QgdmFsaWRBY3Rpb25zID0gWydkZWxldGUnLCAndXBkYXRlJ107XG4gICAgaWYgKGluc3RhbGxhdGlvbi5kdXBsaWNhdGVEZXZpY2VUb2tlbkFjdGlvbiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBpbnN0YWxsYXRpb24uZHVwbGljYXRlRGV2aWNlVG9rZW5BY3Rpb24gPVxuICAgICAgICBJbnN0YWxsYXRpb25PcHRpb25zLmR1cGxpY2F0ZURldmljZVRva2VuQWN0aW9uLmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICghdmFsaWRBY3Rpb25zLmluY2x1ZGVzKGluc3RhbGxhdGlvbi5kdXBsaWNhdGVEZXZpY2VUb2tlbkFjdGlvbikpIHtcbiAgICAgIHRocm93IFwiaW5zdGFsbGF0aW9uLmR1cGxpY2F0ZURldmljZVRva2VuQWN0aW9uIG11c3QgYmUgb25lIG9mOiAnZGVsZXRlJywgJ3VwZGF0ZScuXCI7XG4gICAgfVxuICAgIGNvbnN0IHZhbGlkUHJpb3JpdGllcyA9IFsnZGV2aWNlVG9rZW4nLCAnaW5zdGFsbGF0aW9uSWQnXTtcbiAgICBpZiAoaW5zdGFsbGF0aW9uLmR1cGxpY2F0ZURldmljZVRva2VuTWVyZ2VQcmlvcml0eSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBpbnN0YWxsYXRpb24uZHVwbGljYXRlRGV2aWNlVG9rZW5NZXJnZVByaW9yaXR5ID1cbiAgICAgICAgSW5zdGFsbGF0aW9uT3B0aW9ucy5kdXBsaWNhdGVEZXZpY2VUb2tlbk1lcmdlUHJpb3JpdHkuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKCF2YWxpZFByaW9yaXRpZXMuaW5jbHVkZXMoaW5zdGFsbGF0aW9uLmR1cGxpY2F0ZURldmljZVRva2VuTWVyZ2VQcmlvcml0eSkpIHtcbiAgICAgIHRocm93IFwiaW5zdGFsbGF0aW9uLmR1cGxpY2F0ZURldmljZVRva2VuTWVyZ2VQcmlvcml0eSBtdXN0IGJlIG9uZSBvZjogJ2RldmljZVRva2VuJywgJ2luc3RhbGxhdGlvbklkJy5cIjtcbiAgICB9XG4gIH1cblxuICBzdGF0aWMgdmFsaWRhdGVBbGxvd0hlYWRlcnMoYWxsb3dIZWFkZXJzKSB7XG4gICAgaWYgKCFbbnVsbCwgdW5kZWZpbmVkXS5pbmNsdWRlcyhhbGxvd0hlYWRlcnMpKSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShhbGxvd0hlYWRlcnMpKSB7XG4gICAgICAgIGFsbG93SGVhZGVycy5mb3JFYWNoKGhlYWRlciA9PiB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBoZWFkZXIgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICB0aHJvdyAnQWxsb3cgaGVhZGVycyBtdXN0IG9ubHkgY29udGFpbiBzdHJpbmdzJztcbiAgICAgICAgICB9IGVsc2UgaWYgKCFoZWFkZXIudHJpbSgpLmxlbmd0aCkge1xuICAgICAgICAgICAgdGhyb3cgJ0FsbG93IGhlYWRlcnMgbXVzdCBub3QgY29udGFpbiBlbXB0eSBzdHJpbmdzJztcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgJ0FsbG93IGhlYWRlcnMgbXVzdCBiZSBhbiBhcnJheSc7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIHZhbGlkYXRlTG9nTGV2ZWxzKGxvZ0xldmVscykge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKExvZ0xldmVscykpIHtcbiAgICAgIGlmIChsb2dMZXZlbHNba2V5XSkge1xuICAgICAgICBpZiAodmFsaWRMb2dMZXZlbHMuaW5kZXhPZihsb2dMZXZlbHNba2V5XSkgPT09IC0xKSB7XG4gICAgICAgICAgdGhyb3cgYCcke2tleX0nIG11c3QgYmUgb25lIG9mICR7SlNPTi5zdHJpbmdpZnkodmFsaWRMb2dMZXZlbHMpfWA7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ0xldmVsc1trZXldID0gTG9nTGV2ZWxzW2tleV0uZGVmYXVsdDtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBzdGF0aWMgdmFsaWRhdGVEYXRhYmFzZU9wdGlvbnMoZGF0YWJhc2VPcHRpb25zKSB7XG4gICAgaWYgKGRhdGFiYXNlT3B0aW9ucyA9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChkYXRhYmFzZU9wdGlvbnMpICE9PSAnW29iamVjdCBPYmplY3RdJykge1xuICAgICAgdGhyb3cgYGRhdGFiYXNlT3B0aW9ucyBtdXN0IGJlIGFuIG9iamVjdGA7XG4gICAgfVxuXG4gICAgaWYgKGRhdGFiYXNlT3B0aW9ucy5lbmFibGVTY2hlbWFIb29rcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBkYXRhYmFzZU9wdGlvbnMuZW5hYmxlU2NoZW1hSG9va3MgPSBEYXRhYmFzZU9wdGlvbnMuZW5hYmxlU2NoZW1hSG9va3MuZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBkYXRhYmFzZU9wdGlvbnMuZW5hYmxlU2NoZW1hSG9va3MgIT09ICdib29sZWFuJykge1xuICAgICAgdGhyb3cgYGRhdGFiYXNlT3B0aW9ucy5lbmFibGVTY2hlbWFIb29rcyBtdXN0IGJlIGEgYm9vbGVhbmA7XG4gICAgfVxuICAgIGlmIChkYXRhYmFzZU9wdGlvbnMuc2NoZW1hQ2FjaGVUdGwgPT09IHVuZGVmaW5lZCkge1xuICAgICAgZGF0YWJhc2VPcHRpb25zLnNjaGVtYUNhY2hlVHRsID0gRGF0YWJhc2VPcHRpb25zLnNjaGVtYUNhY2hlVHRsLmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZGF0YWJhc2VPcHRpb25zLnNjaGVtYUNhY2hlVHRsICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgYGRhdGFiYXNlT3B0aW9ucy5zY2hlbWFDYWNoZVR0bCBtdXN0IGJlIGEgbnVtYmVyYDtcbiAgICB9XG4gICAgaWYgKGRhdGFiYXNlT3B0aW9ucy5hbGxvd1B1YmxpY0V4cGxhaW4gPT09IHVuZGVmaW5lZCkge1xuICAgICAgZGF0YWJhc2VPcHRpb25zLmFsbG93UHVibGljRXhwbGFpbiA9IERhdGFiYXNlT3B0aW9ucy5hbGxvd1B1YmxpY0V4cGxhaW4uZGVmYXVsdDtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBkYXRhYmFzZU9wdGlvbnMuYWxsb3dQdWJsaWNFeHBsYWluICE9PSAnYm9vbGVhbicpIHtcbiAgICAgIHRocm93IGBQYXJzZSBTZXJ2ZXIgb3B0aW9uICdkYXRhYmFzZU9wdGlvbnMuYWxsb3dQdWJsaWNFeHBsYWluJyBtdXN0IGJlIGEgYm9vbGVhbi5gO1xuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZUxpdmVRdWVyeU9wdGlvbnMobGl2ZVF1ZXJ5KSB7XG4gICAgaWYgKGxpdmVRdWVyeSA9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGxpdmVRdWVyeS5yZWdleFRpbWVvdXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgbGl2ZVF1ZXJ5LnJlZ2V4VGltZW91dCA9IExpdmVRdWVyeU9wdGlvbnMucmVnZXhUaW1lb3V0LmRlZmF1bHQ7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgbGl2ZVF1ZXJ5LnJlZ2V4VGltZW91dCAhPT0gJ251bWJlcicpIHtcbiAgICAgIHRocm93IGBsaXZlUXVlcnkucmVnZXhUaW1lb3V0IG11c3QgYmUgYSBudW1iZXJgO1xuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZVJvdXRlQWxsb3dMaXN0KHJvdXRlQWxsb3dMaXN0KSB7XG4gICAgaWYgKHJvdXRlQWxsb3dMaXN0ID09PSB1bmRlZmluZWQgfHwgcm91dGVBbGxvd0xpc3QgPT09IG51bGwpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJvdXRlQWxsb3dMaXN0KSkge1xuICAgICAgdGhyb3cgJ1BhcnNlIFNlcnZlciBvcHRpb24gcm91dGVBbGxvd0xpc3QgbXVzdCBiZSBhbiBhcnJheSBvZiBzdHJpbmdzLic7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiByb3V0ZUFsbG93TGlzdCkge1xuICAgICAgaWYgKHR5cGVvZiBwYXR0ZXJuICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBgUGFyc2UgU2VydmVyIG9wdGlvbiByb3V0ZUFsbG93TGlzdCBjb250YWlucyBhIG5vbi1zdHJpbmcgdmFsdWUuYDtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIG5ldyBSZWdFeHAoJ14nICsgcGF0dGVybiArICckJyk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgdGhyb3cgYFBhcnNlIFNlcnZlciBvcHRpb24gcm91dGVBbGxvd0xpc3QgY29udGFpbnMgYW4gaW52YWxpZCByZWdleCBwYXR0ZXJuOiBcIiR7cGF0dGVybn1cIi5gO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyB2YWxpZGF0ZVJhdGVMaW1pdChyYXRlTGltaXQpIHtcbiAgICBpZiAoIXJhdGVMaW1pdCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwocmF0ZUxpbWl0KSAhPT0gJ1tvYmplY3QgT2JqZWN0XScgJiZcbiAgICAgICFBcnJheS5pc0FycmF5KHJhdGVMaW1pdClcbiAgICApIHtcbiAgICAgIHRocm93IGByYXRlTGltaXQgbXVzdCBiZSBhbiBhcnJheSBvciBvYmplY3RgO1xuICAgIH1cbiAgICBjb25zdCBvcHRpb25zID0gQXJyYXkuaXNBcnJheShyYXRlTGltaXQpID8gcmF0ZUxpbWl0IDogW3JhdGVMaW1pdF07XG4gICAgZm9yIChjb25zdCBvcHRpb24gb2Ygb3B0aW9ucykge1xuICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvcHRpb24pICE9PSAnW29iamVjdCBPYmplY3RdJykge1xuICAgICAgICB0aHJvdyBgcmF0ZUxpbWl0IG11c3QgYmUgYW4gYXJyYXkgb2Ygb2JqZWN0c2A7XG4gICAgICB9XG4gICAgICBpZiAob3B0aW9uLnJlcXVlc3RQYXRoID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgYHJhdGVMaW1pdC5yZXF1ZXN0UGF0aCBtdXN0IGJlIGRlZmluZWRgO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBvcHRpb24ucmVxdWVzdFBhdGggIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IGByYXRlTGltaXQucmVxdWVzdFBhdGggbXVzdCBiZSBhIHN0cmluZ2A7XG4gICAgICB9XG5cbiAgICAgIC8vIFZhbGlkYXRlIHRoYXQgdGhlIHBhdGggaXMgdmFsaWQgcGF0aC10by1yZWdleHAgc3ludGF4XG4gICAgICB0cnkge1xuICAgICAgICBwYXRoVG9SZWdleHAob3B0aW9uLnJlcXVlc3RQYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRocm93IGByYXRlTGltaXQucmVxdWVzdFBhdGggXCIke29wdGlvbi5yZXF1ZXN0UGF0aH1cIiBpcyBub3QgdmFsaWQ6ICR7ZXJyb3IubWVzc2FnZX1gO1xuICAgICAgfVxuXG4gICAgICBpZiAob3B0aW9uLnJlcXVlc3RUaW1lV2luZG93ID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgYHJhdGVMaW1pdC5yZXF1ZXN0VGltZVdpbmRvdyBtdXN0IGJlIGRlZmluZWRgO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBvcHRpb24ucmVxdWVzdFRpbWVXaW5kb3cgIT09ICdudW1iZXInKSB7XG4gICAgICAgIHRocm93IGByYXRlTGltaXQucmVxdWVzdFRpbWVXaW5kb3cgbXVzdCBiZSBhIG51bWJlcmA7XG4gICAgICB9XG4gICAgICBpZiAob3B0aW9uLmluY2x1ZGVJbnRlcm5hbFJlcXVlc3RzICYmIHR5cGVvZiBvcHRpb24uaW5jbHVkZUludGVybmFsUmVxdWVzdHMgIT09ICdib29sZWFuJykge1xuICAgICAgICB0aHJvdyBgcmF0ZUxpbWl0LmluY2x1ZGVJbnRlcm5hbFJlcXVlc3RzIG11c3QgYmUgYSBib29sZWFuYDtcbiAgICAgIH1cbiAgICAgIGlmIChvcHRpb24ucmVxdWVzdENvdW50ID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgYHJhdGVMaW1pdC5yZXF1ZXN0Q291bnQgbXVzdCBiZSBkZWZpbmVkYDtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygb3B0aW9uLnJlcXVlc3RDb3VudCAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgdGhyb3cgYHJhdGVMaW1pdC5yZXF1ZXN0Q291bnQgbXVzdCBiZSBhIG51bWJlcmA7XG4gICAgICB9XG4gICAgICBpZiAob3B0aW9uLmVycm9yUmVzcG9uc2VNZXNzYWdlICYmIHR5cGVvZiBvcHRpb24uZXJyb3JSZXNwb25zZU1lc3NhZ2UgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IGByYXRlTGltaXQuZXJyb3JSZXNwb25zZU1lc3NhZ2UgbXVzdCBiZSBhIHN0cmluZ2A7XG4gICAgICB9XG4gICAgICBjb25zdCBvcHRpb25zID0gT2JqZWN0LmtleXMoUGFyc2VTZXJ2ZXIuUmF0ZUxpbWl0Wm9uZSk7XG4gICAgICBpZiAob3B0aW9uLnpvbmUgJiYgIW9wdGlvbnMuaW5jbHVkZXMob3B0aW9uLnpvbmUpKSB7XG4gICAgICAgIGNvbnN0IGZvcm1hdHRlciA9IG5ldyBJbnRsLkxpc3RGb3JtYXQoJ2VuJywgeyBzdHlsZTogJ3Nob3J0JywgdHlwZTogJ2Rpc2p1bmN0aW9uJyB9KTtcbiAgICAgICAgdGhyb3cgYHJhdGVMaW1pdC56b25lIG11c3QgYmUgb25lIG9mICR7Zm9ybWF0dGVyLmZvcm1hdChvcHRpb25zKX1gO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGdlbmVyYXRlRW1haWxWZXJpZnlUb2tlbkV4cGlyZXNBdCgpIHtcbiAgICBpZiAoIXRoaXMudmVyaWZ5VXNlckVtYWlscyB8fCAhdGhpcy5lbWFpbFZlcmlmeVRva2VuVmFsaWRpdHlEdXJhdGlvbikge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgdmFyIG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgcmV0dXJuIG5ldyBEYXRlKG5vdy5nZXRUaW1lKCkgKyB0aGlzLmVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uICogMTAwMCk7XG4gIH1cblxuICBnZW5lcmF0ZVBhc3N3b3JkUmVzZXRUb2tlbkV4cGlyZXNBdCgpIHtcbiAgICBpZiAoIXRoaXMucGFzc3dvcmRQb2xpY3kgfHwgIXRoaXMucGFzc3dvcmRQb2xpY3kucmVzZXRUb2tlblZhbGlkaXR5RHVyYXRpb24pIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgcmV0dXJuIG5ldyBEYXRlKG5vdy5nZXRUaW1lKCkgKyB0aGlzLnBhc3N3b3JkUG9saWN5LnJlc2V0VG9rZW5WYWxpZGl0eUR1cmF0aW9uICogMTAwMCk7XG4gIH1cblxuICBnZW5lcmF0ZVNlc3Npb25FeHBpcmVzQXQoKSB7XG4gICAgaWYgKCF0aGlzLmV4cGlyZUluYWN0aXZlU2Vzc2lvbnMpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHZhciBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIHJldHVybiBuZXcgRGF0ZShub3cuZ2V0VGltZSgpICsgdGhpcy5zZXNzaW9uTGVuZ3RoICogMTAwMCk7XG4gIH1cblxuICB1bnJlZ2lzdGVyUmF0ZUxpbWl0ZXJzKCkge1xuICAgIGxldCBpID0gdGhpcy5yYXRlTGltaXRzPy5sZW5ndGg7XG4gICAgd2hpbGUgKGktLSkge1xuICAgICAgY29uc3QgbGltaXQgPSB0aGlzLnJhdGVMaW1pdHNbaV07XG4gICAgICBpZiAobGltaXQuY2xvdWQpIHtcbiAgICAgICAgdGhpcy5yYXRlTGltaXRzLnNwbGljZShpLCAxKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBnZXQgaW52YWxpZExpbmtVUkwoKSB7XG4gICAgcmV0dXJuIHRoaXMuY3VzdG9tUGFnZXMuaW52YWxpZExpbmsgfHwgYCR7dGhpcy5wdWJsaWNTZXJ2ZXJVUkx9L2FwcHMvaW52YWxpZF9saW5rLmh0bWxgO1xuICB9XG5cbiAgZ2V0IGludmFsaWRWZXJpZmljYXRpb25MaW5rVVJMKCkge1xuICAgIHJldHVybiAoXG4gICAgICB0aGlzLmN1c3RvbVBhZ2VzLmludmFsaWRWZXJpZmljYXRpb25MaW5rIHx8XG4gICAgICBgJHt0aGlzLnB1YmxpY1NlcnZlclVSTH0vYXBwcy9pbnZhbGlkX3ZlcmlmaWNhdGlvbl9saW5rLmh0bWxgXG4gICAgKTtcbiAgfVxuXG4gIGdldCBsaW5rU2VuZFN1Y2Nlc3NVUkwoKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIHRoaXMuY3VzdG9tUGFnZXMubGlua1NlbmRTdWNjZXNzIHx8IGAke3RoaXMucHVibGljU2VydmVyVVJMfS9hcHBzL2xpbmtfc2VuZF9zdWNjZXNzLmh0bWxgXG4gICAgKTtcbiAgfVxuXG4gIGdldCBsaW5rU2VuZEZhaWxVUkwoKSB7XG4gICAgcmV0dXJuIHRoaXMuY3VzdG9tUGFnZXMubGlua1NlbmRGYWlsIHx8IGAke3RoaXMucHVibGljU2VydmVyVVJMfS9hcHBzL2xpbmtfc2VuZF9mYWlsLmh0bWxgO1xuICB9XG5cbiAgZ2V0IHZlcmlmeUVtYWlsU3VjY2Vzc1VSTCgpIHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5jdXN0b21QYWdlcy52ZXJpZnlFbWFpbFN1Y2Nlc3MgfHxcbiAgICAgIGAke3RoaXMucHVibGljU2VydmVyVVJMfS9hcHBzL3ZlcmlmeV9lbWFpbF9zdWNjZXNzLmh0bWxgXG4gICAgKTtcbiAgfVxuXG4gIGdldCBjaG9vc2VQYXNzd29yZFVSTCgpIHtcbiAgICByZXR1cm4gdGhpcy5jdXN0b21QYWdlcy5jaG9vc2VQYXNzd29yZCB8fCBgJHt0aGlzLnB1YmxpY1NlcnZlclVSTH0vYXBwcy9jaG9vc2VfcGFzc3dvcmRgO1xuICB9XG5cbiAgZ2V0IHJlcXVlc3RSZXNldFBhc3N3b3JkVVJMKCkge1xuICAgIHJldHVybiBgJHt0aGlzLnB1YmxpY1NlcnZlclVSTH0vJHt0aGlzLnBhZ2VzRW5kcG9pbnR9LyR7dGhpcy5hcHBsaWNhdGlvbklkfS9yZXF1ZXN0X3Bhc3N3b3JkX3Jlc2V0YDtcbiAgfVxuXG4gIGdldCBwYXNzd29yZFJlc2V0U3VjY2Vzc1VSTCgpIHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5jdXN0b21QYWdlcy5wYXNzd29yZFJlc2V0U3VjY2VzcyB8fFxuICAgICAgYCR7dGhpcy5wdWJsaWNTZXJ2ZXJVUkx9L2FwcHMvcGFzc3dvcmRfcmVzZXRfc3VjY2Vzcy5odG1sYFxuICAgICk7XG4gIH1cblxuICBnZXQgcGFyc2VGcmFtZVVSTCgpIHtcbiAgICByZXR1cm4gdGhpcy5jdXN0b21QYWdlcy5wYXJzZUZyYW1lVVJMO1xuICB9XG5cbiAgZ2V0IHZlcmlmeUVtYWlsVVJMKCkge1xuICAgIHJldHVybiBgJHt0aGlzLnB1YmxpY1NlcnZlclVSTH0vJHt0aGlzLnBhZ2VzRW5kcG9pbnR9LyR7dGhpcy5hcHBsaWNhdGlvbklkfS92ZXJpZnlfZW1haWxgO1xuICB9XG5cbiAgYXN5bmMgbG9hZE1hc3RlcktleSgpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMubWFzdGVyS2V5ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjb25zdCB0dGxJc0VtcHR5ID0gIXRoaXMubWFzdGVyS2V5VHRsO1xuICAgICAgY29uc3QgaXNFeHBpcmVkID0gdGhpcy5tYXN0ZXJLZXlDYWNoZT8uZXhwaXJlc0F0ICYmIHRoaXMubWFzdGVyS2V5Q2FjaGUuZXhwaXJlc0F0IDwgbmV3IERhdGUoKTtcblxuICAgICAgaWYgKCghaXNFeHBpcmVkIHx8IHR0bElzRW1wdHkpICYmIHRoaXMubWFzdGVyS2V5Q2FjaGU/Lm1hc3RlcktleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5tYXN0ZXJLZXlDYWNoZS5tYXN0ZXJLZXk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1hc3RlcktleSA9IGF3YWl0IHRoaXMubWFzdGVyS2V5KCk7XG5cbiAgICAgIGNvbnN0IGV4cGlyZXNBdCA9IHRoaXMubWFzdGVyS2V5VHRsID8gbmV3IERhdGUoRGF0ZS5ub3coKSArIDEwMDAgKiB0aGlzLm1hc3RlcktleVR0bCkgOiBudWxsXG4gICAgICB0aGlzLm1hc3RlcktleUNhY2hlID0geyBtYXN0ZXJLZXksIGV4cGlyZXNBdCB9O1xuICAgICAgQ29uZmlnLnB1dCh0aGlzKTtcblxuICAgICAgcmV0dXJuIHRoaXMubWFzdGVyS2V5Q2FjaGUubWFzdGVyS2V5O1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLm1hc3RlcktleTtcbiAgfVxuXG4gIGdldCBwYWdlc0VuZHBvaW50KCkge1xuICAgIHJldHVybiB0aGlzLnBhZ2VzICYmIHRoaXMucGFnZXMucGFnZXNFbmRwb2ludFxuICAgICAgPyB0aGlzLnBhZ2VzLnBhZ2VzRW5kcG9pbnRcbiAgICAgIDogJ2FwcHMnO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IENvbmZpZztcbm1vZHVsZS5leHBvcnRzID0gQ29uZmlnO1xuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFJQSxJQUFBQSxPQUFBLEdBQUFDLE9BQUE7QUFDQSxJQUFBQyxhQUFBLEdBQUFELE9BQUE7QUFDQSxJQUFBRSxJQUFBLEdBQUFDLHNCQUFBLENBQUFILE9BQUE7QUFDQSxJQUFBSSxNQUFBLEdB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