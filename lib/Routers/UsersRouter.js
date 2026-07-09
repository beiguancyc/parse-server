"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.UsersRouter = void 0;
var _node = _interopRequireDefault(require("parse/node"));
var _Config = _interopRequireDefault(require("../Config"));
var _AccountLockout = _interopRequireDefault(require("../AccountLockout"));
var _ClassesRouter = _interopRequireDefault(require("./ClassesRouter"));
var _rest = _interopRequireDefault(require("../rest"));
var _Auth = _interopRequireDefault(require("../Auth"));
var _password = _interopRequireDefault(require("../password"));
var _triggers = require("../triggers");
var _middlewares = require("../middlewares");
var _RestWrite = _interopRequireDefault(require("../RestWrite"));
var _logger = require("../logger");
var _Error = require("../Error");
var _AuthDataLock = require("../AuthDataLock");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// These methods handle the User-related routes.

class UsersRouter extends _ClassesRouter.default {
  className() {
    return '_User';
  }

  /**
   * Removes all "_" prefixed properties from an object, except "__type"
   * @param {Object} obj An object.
   */
  static removeHiddenProperties(obj) {
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Regexp comes from Parse.Object.prototype.validate
        if (key !== '__type' && !/^[A-Za-z][0-9A-Za-z_]*$/.test(key)) {
          delete obj[key];
        }
      }
    }
  }

  /**
   * After retrieving a user directly from the database, we need to remove the
   * password from the object (for security), and fix an issue some SDKs have
   * with null values
   */
  _sanitizeAuthData(user) {
    delete user.password;

    // Sometimes the authData still has null on that keys
    // https://github.com/parse-community/parse-server/issues/935
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

  /**
   * Validates a password request in login and verifyPassword
   * @param {Object} req The request
   * @returns {Object} User object
   * @private
   */
  _authenticateUserFromRequest(req) {
    return new Promise((resolve, reject) => {
      // Use query parameters instead if provided in url
      let payload = req.body || {};
      if (!payload.username && req.query && req.query.username || !payload.email && req.query && req.query.email) {
        payload = req.query;
      }
      const {
        username,
        email,
        password,
        ignoreEmailVerification
      } = payload;

      // TODO: use the right error codes / descriptions.
      if (!username && !email) {
        throw new _node.default.Error(_node.default.Error.USERNAME_MISSING, 'username/email is required.');
      }
      if (!password) {
        throw new _node.default.Error(_node.default.Error.PASSWORD_MISSING, 'password is required.');
      }
      if (typeof password !== 'string' || email && typeof email !== 'string' || username && typeof username !== 'string') {
        throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
      }
      let user;
      let isValidPassword = false;
      let query;
      if (email && username) {
        query = {
          email,
          username
        };
      } else if (email) {
        query = {
          email
        };
      } else {
        query = {
          $or: [{
            username
          }, {
            email: username
          }]
        };
      }
      return req.config.database.find('_User', query, {}, _Auth.default.maintenance(req.config)).then(results => {
        if (!results.length) {
          // Perform a dummy bcrypt compare to normalize response timing,
          // preventing user enumeration via timing side-channel
          return _password.default.compare(password, _password.default.dummyHash).then(() => {
            throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
          });
        }
        if (results.length > 1) {
          // corner case where user1 has username == user2 email
          req.config.loggerController.warn("There is a user which email is the same as another user's username, logging in based on username");
          user = results.filter(user => user.username === username)[0];
        } else {
          user = results[0];
        }
        if (typeof user.password !== 'string' || user.password.length === 0) {
          // Passwordless account (e.g. OAuth-only): run dummy compare for
          // timing normalization, discard result, always reject
          return _password.default.compare(password, _password.default.dummyHash).then(() => false);
        }
        return _password.default.compare(password, user.password);
      }).then(correct => {
        isValidPassword = correct;
        const accountLockoutPolicy = new _AccountLockout.default(user, req.config);
        return accountLockoutPolicy.handleLoginAttempt(isValidPassword);
      }).then(async () => {
        if (!isValidPassword) {
          throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
        }
        // A user with an empty ACL (master key only) is considered locked out and
        // cannot log in. This only prevents new logins; existing session tokens
        // remain valid. To immediately revoke access, also destroy the user's
        // sessions via master key.
        if (!req.auth.isMaster && user.ACL && Object.keys(user.ACL).length == 0) {
          throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
        }
        // Create request object for verification functions
        const authProvider = req.body && req.body.authData && Object.keys(req.body.authData).length && Object.keys(req.body.authData).join(',');
        const request = {
          master: req.auth.isMaster,
          ip: req.config.ip,
          installationId: req.auth.installationId,
          object: _node.default.User.fromJSON(Object.assign({
            className: '_User'
          }, user)),
          createdWith: _RestWrite.default.buildCreatedWith('login', authProvider)
        };

        // If request doesn't use master or maintenance key with ignoring email verification
        if (!((req.auth.isMaster || req.auth.isMaintenance) && ignoreEmailVerification)) {
          // Get verification conditions which can be booleans or functions; the purpose of this async/await
          // structure is to avoid unnecessarily executing subsequent functions if previous ones fail in the
          // conditional statement below, as a developer may decide to execute expensive operations in them
          const verifyUserEmails = async () => req.config.verifyUserEmails === true || typeof req.config.verifyUserEmails === 'function' && (await Promise.resolve(req.config.verifyUserEmails(request))) === true;
          const preventLoginWithUnverifiedEmail = async () => req.config.preventLoginWithUnverifiedEmail === true || typeof req.config.preventLoginWithUnverifiedEmail === 'function' && (await Promise.resolve(req.config.preventLoginWithUnverifiedEmail(request))) === true;
          if ((await verifyUserEmails()) && (await preventLoginWithUnverifiedEmail()) && !user.emailVerified) {
            throw new _node.default.Error(_node.default.Error.EMAIL_NOT_FOUND, 'User email is not verified.');
          }
        }
        this._sanitizeAuthData(user);
        return resolve(user);
      }).catch(error => {
        return reject(error);
      });
    });
  }
  async handleMe(req) {
    if (!req.info || !req.info.sessionToken) {
      throw (0, _Error.createSanitizedError)(_node.default.Error.INVALID_SESSION_TOKEN, 'Invalid session token', req.config);
    }
    const sessionToken = req.info.sessionToken;
    // Query the session with master key to validate the session token,
    // but do NOT include 'user' to avoid leaking user data via master context
    const sessionResponse = await _rest.default.find(req.config, _Auth.default.master(req.config), '_Session', {
      sessionToken
    }, {}, req.info.clientSDK, req.info.context);
    if (!sessionResponse.results || sessionResponse.results.length == 0 || !sessionResponse.results[0].user) {
      throw (0, _Error.createSanitizedError)(_node.default.Error.INVALID_SESSION_TOKEN, 'Invalid session token', req.config);
    }
    const userId = sessionResponse.results[0].user.objectId;
    // Re-fetch the user with the caller's auth context so that
    // protectedFields, CLP, and auth adapter afterFind apply correctly
    const userResponse = await _rest.default.get(req.config, req.auth, '_User', userId, {}, req.info.clientSDK, req.info.context);
    if (!userResponse.results || userResponse.results.length == 0) {
      throw (0, _Error.createSanitizedError)(_node.default.Error.INVALID_SESSION_TOKEN, 'Invalid session token', req.config);
    }
    const user = userResponse.results[0];
    // Send token back on the login, because SDKs expect that.
    user.sessionToken = sessionToken;
    // Remove hidden properties.
    UsersRouter.removeHiddenProperties(user);
    return {
      response: user
    };
  }
  async handleLogIn(req) {
    const user = await this._authenticateUserFromRequest(req);
    const authData = req.body && req.body.authData;
    // Check if user has provided their required auth providers
    _Auth.default.checkIfUserHasProvidedConfiguredProvidersForLogin(req, authData, user.authData, req.config);
    let authDataResponse;
    let validatedAuthData;
    if (authData) {
      const res = await _Auth.default.handleAuthDataValidation(authData, new _RestWrite.default(req.config, req.auth, '_User', {
        objectId: user.objectId
      }, req.body || {}, user, req.info.clientSDK, req.info.context), user);
      authDataResponse = res.authDataResponse;
      validatedAuthData = res.authData;
    }

    // handle password expiry policy
    if (req.config.passwordPolicy && req.config.passwordPolicy.maxPasswordAge) {
      let changedAt = user._password_changed_at;
      if (!changedAt) {
        // password was created before expiry policy was enabled.
        // simply update _User object so that it will start enforcing from now
        changedAt = new Date();
        req.config.database.update('_User', {
          username: user.username
        }, {
          _password_changed_at: _node.default._encode(changedAt)
        });
      } else {
        // check whether the password has expired
        if (changedAt.__type == 'Date') {
          changedAt = new Date(changedAt.iso);
        }
        // Calculate the expiry time.
        const expiresAt = new Date(changedAt.getTime() + 86400000 * req.config.passwordPolicy.maxPasswordAge);
        if (expiresAt < new Date())
          // fail of current time is past password expiry time
          {
            throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'Your password has expired. Please reset your password.');
          }
      }
    }

    // Remove hidden properties.
    UsersRouter.removeHiddenProperties(user);
    await req.config.filesController.expandFilesInObject(req.config, user);

    // Before login trigger; throws if failure
    await (0, _triggers.maybeRunTrigger)(_triggers.Types.beforeLogin, req.auth, _node.default.User.fromJSON(Object.assign({
      className: '_User'
    }, user)), null, req.config, req.info.context);

    // If we have some new validated authData update directly
    if (validatedAuthData && Object.keys(validatedAuthData).length) {
      const query = {
        objectId: user.objectId
      };
      // Prevent concurrent requests from both succeeding when consuming single-use
      // tokens (e.g. MFA recovery codes or SMS OTP tokens) by extending the update
      // WHERE clause with the original values of changed primitive/array fields.
      (0, _AuthDataLock.applyAuthDataOptimisticLock)(query, user.authData, validatedAuthData);
      try {
        await req.config.database.update('_User', query, {
          authData: validatedAuthData
        }, {});
      } catch (error) {
        if (error.code === _node.default.Error.OBJECT_NOT_FOUND) {
          throw new _node.default.Error(_node.default.Error.SCRIPT_FAILED, 'Invalid auth data');
        }
        throw error;
      }
    }
    const {
      sessionData,
      createSession
    } = _RestWrite.default.createSession(req.config, {
      userId: user.objectId,
      createdWith: _RestWrite.default.buildCreatedWith('login'),
      installationId: req.info.installationId
    });
    user.sessionToken = sessionData.sessionToken;
    await createSession();
    const afterLoginUser = _node.default.User.fromJSON(Object.assign({
      className: '_User'
    }, user));
    await (0, _triggers.maybeRunTrigger)(_triggers.Types.afterLogin, {
      ...req.auth,
      user: afterLoginUser
    }, afterLoginUser, null, req.config, req.info.context);

    // Re-fetch the user with the caller's auth context so that
    // protectedFields and CLP apply correctly; if the caller used master key,
    // protectedFields are bypassed, matching the behavior of GET /users/:id
    const refetchAuth = req.auth.isMaster || req.auth.isMaintenance ? req.auth : new _Auth.default.Auth({
      config: req.config,
      isMaster: false,
      user: _node.default.Object.fromJSON({
        className: '_User',
        objectId: user.objectId
      }),
      installationId: req.info.installationId
    });
    let filteredUser;
    try {
      const filteredUserResponse = await _rest.default.get(req.config, refetchAuth, '_User', user.objectId, {}, req.info.clientSDK, req.info.context);
      filteredUser = filteredUserResponse.results?.[0];
    } catch {
      // re-fetch may fail for legacy users without ACL; fall through
    }
    if (!filteredUser) {
      filteredUser = user;
    }
    UsersRouter.removeHiddenProperties(filteredUser);
    filteredUser.sessionToken = user.sessionToken;
    if (authDataResponse) {
      filteredUser.authDataResponse = authDataResponse;
    }
    return {
      response: filteredUser
    };
  }

  /**
   * This allows master-key clients to create user sessions without access to
   * user credentials. This enables systems that can authenticate access another
   * way (API key, app administrators) to act on a user's behalf.
   *
   * We create a new session rather than looking for an existing session; we
   * want this to work in situations where the user is logged out on all
   * devices, since this can be used by automated systems acting on the user's
   * behalf.
   *
   * For the moment, we're omitting event hooks and lockout checks, since
   * immediate use cases suggest /loginAs could be used for semantically
   * different reasons from /login
   */
  async handleLogInAs(req) {
    if (!req.auth.isMaster) {
      throw (0, _Error.createSanitizedError)(_node.default.Error.OPERATION_FORBIDDEN, 'master key is required', req.config);
    }
    if (req.auth.isReadOnly) {
      throw (0, _Error.createSanitizedError)(_node.default.Error.OPERATION_FORBIDDEN, "read-only masterKey isn't allowed to login as another user.", req.config);
    }
    const userId = req.body?.userId || req.query.userId;
    if (!userId) {
      throw new _node.default.Error(_node.default.Error.INVALID_VALUE, 'userId must not be empty, null, or undefined');
    }
    const queryResults = await req.config.database.find('_User', {
      objectId: userId
    });
    const user = queryResults[0];
    if (!user) {
      throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'user not found');
    }
    this._sanitizeAuthData(user);
    const {
      sessionData,
      createSession
    } = _RestWrite.default.createSession(req.config, {
      userId,
      createdWith: _RestWrite.default.buildCreatedWith('login', 'masterkey'),
      installationId: req.info.installationId
    });
    user.sessionToken = sessionData.sessionToken;
    await createSession();
    return {
      response: user
    };
  }
  handleVerifyPassword(req) {
    return this._authenticateUserFromRequest(req).then(async user => {
      // Remove hidden properties.
      UsersRouter.removeHiddenProperties(user);
      // Re-fetch the user with the caller's auth context so that
      // protectedFields and CLP apply correctly; if the caller used master key,
      // protectedFields are bypassed, matching the behavior of GET /users/:id
      const refetchAuth = req.auth.isMaster || req.auth.isMaintenance ? req.auth : new _Auth.default.Auth({
        config: req.config,
        isMaster: false,
        user: _node.default.Object.fromJSON({
          className: '_User',
          objectId: user.objectId
        }),
        installationId: req.info.installationId
      });
      let filteredUser;
      try {
        const filteredUserResponse = await _rest.default.get(req.config, refetchAuth, '_User', user.objectId, {}, req.info.clientSDK, req.info.context);
        filteredUser = filteredUserResponse.results?.[0];
      } catch {
        // re-fetch may fail for legacy users without ACL; fall through
      }
      if (!filteredUser) {
        filteredUser = user;
      }
      UsersRouter.removeHiddenProperties(filteredUser);
      return {
        response: filteredUser
      };
    }).catch(error => {
      throw error;
    });
  }
  async handleLogOut(req) {
    const success = {
      response: {}
    };
    if (req.info && req.info.sessionToken) {
      const records = await _rest.default.find(req.config, _Auth.default.master(req.config), '_Session', {
        sessionToken: req.info.sessionToken
      }, undefined, req.info.clientSDK, req.info.context);
      if (records.results && records.results.length) {
        await _rest.default.del(req.config, _Auth.default.master(req.config), '_Session', records.results[0].objectId, req.info.context);
        await (0, _triggers.maybeRunTrigger)(_triggers.Types.afterLogout, req.auth, _node.default.Session.fromJSON(Object.assign({
          className: '_Session'
        }, records.results[0])), null, req.config);
      }
    }
    return success;
  }
  _throwOnBadEmailConfig(req) {
    try {
      _Config.default.validateEmailConfiguration({
        emailAdapter: req.config.userController.adapter,
        appName: req.config.appName,
        publicServerURL: req.config.publicServerURL || req.config._publicServerURL,
        emailVerifyTokenValidityDuration: req.config.emailVerifyTokenValidityDuration,
        emailVerifyTokenReuseIfValid: req.config.emailVerifyTokenReuseIfValid
      });
    } catch (e) {
      if (typeof e === 'string') {
        // Maybe we need a Bad Configuration error, but the SDKs won't understand it. For now, Internal Server Error.
        throw new _node.default.Error(_node.default.Error.INTERNAL_SERVER_ERROR, 'An appName, publicServerURL, and emailAdapter are required for password reset and email verification functionality.');
      } else {
        throw e;
      }
    }
  }
  async handleResetRequest(req) {
    this._throwOnBadEmailConfig(req);
    let email = req.body?.email;
    const token = req.body?.token;
    if (!email && !token) {
      throw new _node.default.Error(_node.default.Error.EMAIL_MISSING, 'you must provide an email');
    }
    if (token && typeof token !== 'string') {
      throw new _node.default.Error(_node.default.Error.INVALID_VALUE, 'token must be a string');
    }
    let userResults = null;
    let userData = null;

    // We can find the user using token
    if (token) {
      userResults = await req.config.database.find('_User', {
        _perishable_token: token,
        _perishable_token_expires_at: {
          $lt: _node.default._encode(new Date())
        }
      });
      if (userResults?.length > 0) {
        userData = userResults[0];
        if (userData.email) {
          email = userData.email;
        }
      }
      // Or using email if no token provided
    } else if (typeof email === 'string') {
      userResults = await req.config.database.find('_User', {
        $or: [{
          email
        }, {
          username: email,
          email: {
            $exists: false
          }
        }]
      }, {
        limit: 1
      }, _Auth.default.maintenance(req.config));
      if (userResults?.length > 0) {
        userData = userResults[0];
      }
    }
    if (typeof email !== 'string') {
      throw new _node.default.Error(_node.default.Error.INVALID_EMAIL_ADDRESS, 'you must provide a valid email string');
    }
    if (userData) {
      this._sanitizeAuthData(userData);
      // Get files attached to user
      await req.config.filesController.expandFilesInObject(req.config, userData);
      const user = (0, _triggers.inflate)('_User', userData);
      await (0, _triggers.maybeRunTrigger)(_triggers.Types.beforePasswordResetRequest, req.auth, user, null, req.config, req.info.context);
    }
    const userController = req.config.userController;
    try {
      await userController.sendPasswordResetEmail(email);
      return {
        response: {}
      };
    } catch (err) {
      if (err.code === _node.default.Error.OBJECT_NOT_FOUND) {
        if (req.config.passwordPolicy?.resetPasswordSuccessOnInvalidEmail ?? true) {
          return {
            response: {}
          };
        }
        err.message = `A user with that email does not exist.`;
      }
      throw err;
    }
  }
  async handleVerificationEmailRequest(req) {
    this._throwOnBadEmailConfig(req);
    const {
      email
    } = req.body || {};
    if (!email) {
      throw new _node.default.Error(_node.default.Error.EMAIL_MISSING, 'you must provide an email');
    }
    if (typeof email !== 'string') {
      throw new _node.default.Error(_node.default.Error.INVALID_EMAIL_ADDRESS, 'you must provide a valid email string');
    }
    const verifyEmailSuccessOnInvalidEmail = req.config.emailVerifySuccessOnInvalidEmail ?? true;
    const results = await req.config.database.find('_User', {
      email: email
    }, {}, _Auth.default.maintenance(req.config));
    if (!results.length || results.length < 1) {
      if (verifyEmailSuccessOnInvalidEmail) {
        return {
          response: {}
        };
      }
      throw new _node.default.Error(_node.default.Error.EMAIL_NOT_FOUND, `No user found with email ${email}`);
    }
    const user = results[0];

    // remove password field, messes with saving on postgres
    delete user.password;
    if (user.emailVerified) {
      if (verifyEmailSuccessOnInvalidEmail) {
        return {
          response: {}
        };
      }
      throw new _node.default.Error(_node.default.Error.OTHER_CAUSE, `Email ${email} is already verified.`);
    }
    const userController = req.config.userController;
    const send = await userController.regenerateEmailVerifyToken(user, req.auth.isMaster, req.auth.installationId, req.ip);
    if (send) {
      userController.sendVerificationEmail(user, req);
    }
    return {
      response: {}
    };
  }
  async handleChallenge(req) {
    const {
      username,
      email,
      password,
      authData,
      challengeData
    } = req.body || {};

    // if username or email provided with password try to authenticate the user by username
    let user;
    if (username || email) {
      if (!password) {
        throw new _node.default.Error(_node.default.Error.OTHER_CAUSE, 'You provided username or email, you need to also provide password.');
      }
      user = await this._authenticateUserFromRequest(req);
    }
    if (!challengeData) {
      throw new _node.default.Error(_node.default.Error.OTHER_CAUSE, 'Nothing to challenge.');
    }
    if (typeof challengeData !== 'object') {
      throw new _node.default.Error(_node.default.Error.OTHER_CAUSE, 'challengeData should be an object.');
    }
    let request;
    let parseUser;

    // Try to find user by authData
    if (authData) {
      if (typeof authData !== 'object') {
        throw new _node.default.Error(_node.default.Error.OTHER_CAUSE, 'authData should be an object.');
      }
      if (user) {
        throw new _node.default.Error(_node.default.Error.OTHER_CAUSE, 'You cannot provide username/email and authData, only use one identification method.');
      }
      for (const key of Object.keys(authData)) {
        if (authData[key] !== null && (typeof authData[key] !== 'object' || Array.isArray(authData[key]))) {
          throw new _node.default.Error(_node.default.Error.OTHER_CAUSE, `authData.${key} should be an object.`);
        }
      }
      if (Object.keys(authData).filter(key => authData[key] && authData[key].id).length > 1) {
        throw new _node.default.Error(_node.default.Error.OTHER_CAUSE, 'You cannot provide more than one authData provider with an id.');
      }
      const results = await _Auth.default.findUsersWithAuthData(req.config, authData);
      try {
        if (!results[0] || results.length > 1) {
          throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'User not found.');
        }
        // Find the provider used to find the user
        const provider = Object.keys(authData).find(key => authData[key] && authData[key].id);
        parseUser = _node.default.User.fromJSON({
          className: '_User',
          ...results[0]
        });
        request = (0, _triggers.getRequestObject)(undefined, req.auth, parseUser, parseUser, req.config);
        request.isChallenge = true;
        // Validate authData used to identify the user to avoid brute-force attack on `id`
        const {
          validator
        } = req.config.authDataManager.getValidatorForProvider(provider);
        const validatorResponse = await validator(authData[provider], req, parseUser, request);
        if (validatorResponse && validatorResponse.validator) {
          await validatorResponse.validator();
        }
      } catch (e) {
        // Rewrite the error to avoid guess id attack
        _logger.logger.error(e);
        throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'User not found.');
      }
    }
    if (!parseUser) {
      parseUser = user ? _node.default.User.fromJSON({
        className: '_User',
        ...user
      }) : undefined;
    }
    if (!request) {
      request = (0, _triggers.getRequestObject)(undefined, req.auth, parseUser, parseUser, req.config);
      request.isChallenge = true;
    }
    const acc = {};
    // Execute challenge step-by-step with consistent order for better error feedback
    // and to avoid to trigger others challenges if one of them fails
    for (const provider of Object.keys(challengeData).sort()) {
      try {
        const authAdapter = req.config.authDataManager.getValidatorForProvider(provider);
        if (!authAdapter) {
          continue;
        }
        const {
          adapter: {
            challenge
          }
        } = authAdapter;
        if (typeof challenge === 'function') {
          const providerChallengeResponse = await challenge(challengeData[provider], authData && authData[provider], req.config.auth[provider], request);
          acc[provider] = providerChallengeResponse || true;
        }
      } catch (err) {
        const e = (0, _triggers.resolveError)(err, {
          code: _node.default.Error.SCRIPT_FAILED,
          message: 'Challenge failed. Unknown error.'
        });
        const userString = req.auth && req.auth.user ? req.auth.user.id : undefined;
        _logger.logger.error(`Failed running auth step challenge for ${provider} for user ${userString} with Error: ` + JSON.stringify(e), {
          authenticationStep: 'challenge',
          error: e,
          user: userString,
          provider
        });
        throw e;
      }
    }
    return {
      response: {
        challengeData: acc
      }
    };
  }
  mountRoutes() {
    this.route('GET', '/users', req => {
      return this.handleFind(req);
    });
    this.route('POST', '/users', _middlewares.promiseEnsureIdempotency, req => {
      return this.handleCreate(req);
    });
    this.route('GET', '/users/me', req => {
      return this.handleMe(req);
    });
    this.route('GET', '/users/:objectId', req => {
      return this.handleGet(req);
    });
    this.route('PUT', '/users/:objectId', _middlewares.promiseEnsureIdempotency, req => {
      return this.handleUpdate(req);
    });
    this.route('DELETE', '/users/:objectId', req => {
      return this.handleDelete(req);
    });
    this.route('GET', '/login', req => {
      return this.handleLogIn(req);
    });
    this.route('POST', '/login', req => {
      return this.handleLogIn(req);
    });
    this.route('POST', '/loginAs', req => {
      return this.handleLogInAs(req);
    });
    this.route('POST', '/logout', req => {
      return this.handleLogOut(req);
    });
    this.route('POST', '/requestPasswordReset', req => {
      return this.handleResetRequest(req);
    });
    this.route('POST', '/verificationEmailRequest', req => {
      return this.handleVerificationEmailRequest(req);
    });
    this.route('GET', '/verifyPassword', req => {
      return this.handleVerifyPassword(req);
    });
    this.route('POST', '/verifyPassword', req => {
      return this.handleVerifyPassword(req);
    });
    this.route('POST', '/challenge', req => {
      return this.handleChallenge(req);
    });
  }
}
exports.UsersRouter = UsersRouter;
var _default = exports.default = UsersRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbm9kZSIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiX0NvbmZpZyIsIl9BY2NvdW50TG9ja291dCIsIl9DbGFzc2VzUm91dGVyIiwiX3Jlc3QiLCJfQXV0aCIsIl9wYXNzd29yZCIsIl90cmlnZ2VycyIsIl9taWRkbGV3YXJlcyIsIl9SZXN0V3JpdGUiLCJfbG9nZ2VyIiwiX0Vycm9yIiwiX0F1dGhEYXRhTG9jayIsImUiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsIlVzZXJzUm91dGVyIiwiQ2xhc3Nlc1JvdXRlciIsImNsYXNzTmFtZSIsInJlbW92ZUhpZGRlblByb3BlcnRpZXMiLCJvYmoiLCJrZXkiLCJPYmplY3QiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJ0ZXN0IiwiX3Nhbml0aXplQXV0aERhdGEiLCJ1c2VyIiwicGFzc3dvcmQiLCJhdXRoRGF0YSIsImtleXMiLCJmb3JFYWNoIiwicHJvdmlkZXIiLCJsZW5ndGgiLCJfYXV0aGVudGljYXRlVXNlckZyb21SZXF1ZXN0IiwicmVxIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJwYXlsb2FkIiwiYm9keSIsInVzZXJuYW1lIiwicXVlcnkiLCJlbWFpbCIsImlnbm9yZUVtYWlsVmVyaWZpY2F0aW9uIiwiUGFyc2UiLCJFcnJvciIsIlVTRVJOQU1FX01JU1NJTkciLCJQQVNTV09SRF9NSVNTSU5HIiwiT0JKRUNUX05PVF9GT1VORCIsImlzVmFsaWRQYXNzd29yZCIsIiRvciIsImNvbmZpZyIsImRhdGFiYXNlIiwiZmluZCIsIkF1dGgiLCJtYWludGVuYW5jZSIsInRoZW4iLCJyZXN1bHRzIiwicGFzc3dvcmRDcnlwdG8iLCJjb21wYXJlIiwiZHVtbXlIYXNoIiwibG9nZ2VyQ29udHJvbGxlciIsIndhcm4iLCJmaWx0ZXIiLCJjb3JyZWN0IiwiYWNjb3VudExvY2tvdXRQb2xpY3kiLCJBY2NvdW50TG9ja291dCIsImhhbmRsZUxvZ2luQXR0ZW1wdCIsImF1dGgiLCJpc01hc3RlciIsIkFDTCIsImF1dGhQcm92aWRlciIsImpvaW4iLCJyZXF1ZXN0IiwibWFzdGVyIiwiaXAiLCJpbnN0YWxsYXRpb25JZCIsIm9iamVjdCIsIlVzZXIiLCJmcm9tSlNPTiIsImFzc2lnbiIsImNyZWF0ZWRXaXRoIiwiUmVzdFdyaXRlIiwiYnVpbGRDcmVhdGVkV2l0aCIsImlzTWFpbnRlbmFuY2UiLCJ2ZXJpZnlVc2VyRW1haWxzIiwicHJldmVudExvZ2luV2l0aFVudmVyaWZpZWRFbWFpbCIsImVtYWlsVmVyaWZpZWQiLCJFTUFJTF9OT1RfRk9VTkQiLCJjYXRjaCIsImVycm9yIiwiaGFuZGxlTWUiLCJpbmZvIiwic2Vzc2lvblRva2VuIiwiY3JlYXRlU2FuaXRpemVkRXJyb3IiLCJJTlZBTElEX1NFU1NJT05fVE9LRU4iLCJzZXNzaW9uUmVzcG9uc2UiLCJyZXN0IiwiY2xpZW50U0RLIiwiY29udGV4dCIsInVzZXJJZCIsIm9iamVjdElkIiwidXNlclJlc3BvbnNlIiwiZ2V0IiwicmVzcG9uc2UiLCJoYW5kbGVMb2dJbiIsImNoZWNrSWZVc2VySGFzUHJvdmlkZWRDb25maWd1cmVkUHJvdmlkZXJzRm9yTG9naW4iLCJhdXRoRGF0YVJlc3BvbnNlIiwidmFsaWRhdGVkQXV0aERhdGEiLCJyZXMiLCJoYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24iLCJwYXNzd29yZFBvbGljeSIsIm1heFBhc3N3b3JkQWdlIiwiY2hhbmdlZEF0IiwiX3Bhc3N3b3JkX2NoYW5nZWRfYXQiLCJEYXRlIiwidXBkYXRlIiwiX2VuY29kZSIsIl9fdHlwZSIsImlzbyIsImV4cGlyZXNBdCIsImdldFRpbWUiLCJmaWxlc0NvbnRyb2xsZXIiLCJleHBhbmRGaWxlc0luT2JqZWN0IiwibWF5YmVSdW5UcmlnZ2VyIiwiVHJpZ2dlclR5cGVzIiwiYmVmb3JlTG9naW4iLCJhcHBseUF1dGhEYXRhT3B0aW1pc3RpY0xvY2siLCJjb2RlIiwiU0NSSVBUX0ZBSUxFRCIsInNlc3Npb25EYXRhIiwiY3JlYXRlU2Vzc2lvbiIsImFmdGVyTG9naW5Vc2VyIiwiYWZ0ZXJMb2dpbiIsInJlZmV0Y2hBdXRoIiwiZmlsdGVyZWRVc2VyIiwiZmlsdGVyZWRVc2VyUmVzcG9uc2UiLCJoYW5kbGVMb2dJbkFzIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsImlzUmVhZE9ubHkiLCJJTlZBTElEX1ZBTFVFIiwicXVlcnlSZXN1bHRzIiwiaGFuZGxlVmVyaWZ5UGFzc3dvcmQiLCJoYW5kbGVMb2dPdXQiLCJzdWNjZXNzIiwicmVjb3JkcyIsInVuZGVmaW5lZCIsImRlbCIsImFmdGVyTG9nb3V0IiwiU2Vzc2lvbiIsIl90aHJvd09uQmFkRW1haWxDb25maWciLCJDb25maWciLCJ2YWxpZGF0ZUVtYWlsQ29uZmlndXJhdGlvbiIsImVtYWlsQWRhcHRlciIsInVzZXJDb250cm9sbGVyIiwiYWRhcHRlciIsImFwcE5hbWUiLCJwdWJsaWNTZXJ2ZXJVUkwiLCJfcHVibGljU2VydmVyVVJMIiwiZW1haWxWZXJpZnlUb2tlblZhbGlkaXR5RHVyYXRpb24iLCJlbWFpbFZlcmlmeVRva2VuUmV1c2VJZlZhbGlkIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwiaGFuZGxlUmVzZXRSZXF1ZXN0IiwidG9rZW4iLCJFTUFJTF9NSVNTSU5HIiwidXNlclJlc3VsdHMiLCJ1c2VyRGF0YSIsIl9wZXJpc2hhYmxlX3Rva2VuIiwiX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCIsIiRsdCIsIiRleGlzdHMiLCJsaW1pdCIsIklOVkFMSURfRU1BSUxfQUREUkVTUyIsImluZmxhdGUiLCJiZWZvcmVQYXNzd29yZFJlc2V0UmVxdWVzdCIsInNlbmRQYXNzd29yZFJlc2V0RW1haWwiLCJlcnIiLCJyZXNldFBhc3N3b3JkU3VjY2Vzc09uSW52YWxpZEVtYWlsIiwibWVzc2FnZSIsImhhbmRsZVZlcmlmaWNhdGlvbkVtYWlsUmVxdWVzdCIsInZlcmlmeUVtYWlsU3VjY2Vzc09uSW52YWxpZEVtYWlsIiwiZW1haWxWZXJpZnlTdWNjZXNzT25JbnZhbGlkRW1haWwiLCJPVEhFUl9DQVVTRSIsInNlbmQiLCJyZWdlbmVyYXRlRW1haWxWZXJpZnlUb2tlbiIsInNlbmRWZXJpZmljYXRpb25FbWFpbCIsImhhbmRsZUNoYWxsZW5nZSIsImNoYWxsZW5nZURhdGEiLCJwYXJzZVVzZXIiLCJBcnJheSIsImlzQXJyYXkiLCJpZCIsImZpbmRVc2Vyc1dpdGhBdXRoRGF0YSIsImdldFJlcXVlc3RPYmplY3QiLCJpc0NoYWxsZW5nZSIsInZhbGlkYXRvciIsImF1dGhEYXRhTWFuYWdlciIsImdldFZhbGlkYXRvckZvclByb3ZpZGVyIiwidmFsaWRhdG9yUmVzcG9uc2UiLCJsb2dnZXIiLCJhY2MiLCJzb3J0IiwiYXV0aEFkYXB0ZXIiLCJjaGFsbGVuZ2UiLCJwcm92aWRlckNoYWxsZW5nZVJlc3BvbnNlIiwicmVzb2x2ZUVycm9yIiwidXNlclN0cmluZyIsIkpTT04iLCJzdHJpbmdpZnkiLCJhdXRoZW50aWNhdGlvblN0ZXAiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwiaGFuZGxlRmluZCIsInByb21pc2VFbnN1cmVJZGVtcG90ZW5jeSIsImhhbmRsZUNyZWF0ZSIsImhhbmRsZUdldCIsImhhbmRsZVVwZGF0ZSIsImhhbmRsZURlbGV0ZSIsImV4cG9ydHMiLCJfZGVmYXVsdCJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1VzZXJzUm91dGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIFRoZXNlIG1ldGhvZHMgaGFuZGxlIHRoZSBVc2VyLXJlbGF0ZWQgcm91dGVzLlxuXG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgQ29uZmlnIGZyb20gJy4uL0NvbmZpZyc7XG5pbXBvcnQgQWNjb3VudExvY2tvdXQgZnJvbSAnLi4vQWNjb3VudExvY2tvdXQnO1xuaW1wb3J0IENsYXNzZXNSb3V0ZXIgZnJvbSAnLi9DbGFzc2VzUm91dGVyJztcbmltcG9ydCByZXN0IGZyb20gJy4uL3Jlc3QnO1xuaW1wb3J0IEF1dGggZnJvbSAnLi4vQXV0aCc7XG5pbXBvcnQgcGFzc3dvcmRDcnlwdG8gZnJvbSAnLi4vcGFzc3dvcmQnO1xuaW1wb3J0IHtcbiAgbWF5YmVSdW5UcmlnZ2VyLFxuICBUeXBlcyBhcyBUcmlnZ2VyVHlwZXMsXG4gIGdldFJlcXVlc3RPYmplY3QsXG4gIHJlc29sdmVFcnJvcixcbiAgaW5mbGF0ZSxcbn0gZnJvbSAnLi4vdHJpZ2dlcnMnO1xuaW1wb3J0IHsgcHJvbWlzZUVuc3VyZUlkZW1wb3RlbmN5IH0gZnJvbSAnLi4vbWlkZGxld2FyZXMnO1xuaW1wb3J0IFJlc3RXcml0ZSBmcm9tICcuLi9SZXN0V3JpdGUnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyJztcbmltcG9ydCB7IGNyZWF0ZVNhbml0aXplZEVycm9yIH0gZnJvbSAnLi4vRXJyb3InO1xuaW1wb3J0IHsgYXBwbHlBdXRoRGF0YU9wdGltaXN0aWNMb2NrIH0gZnJvbSAnLi4vQXV0aERhdGFMb2NrJztcblxuZXhwb3J0IGNsYXNzIFVzZXJzUm91dGVyIGV4dGVuZHMgQ2xhc3Nlc1JvdXRlciB7XG4gIGNsYXNzTmFtZSgpIHtcbiAgICByZXR1cm4gJ19Vc2VyJztcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGFsbCBcIl9cIiBwcmVmaXhlZCBwcm9wZXJ0aWVzIGZyb20gYW4gb2JqZWN0LCBleGNlcHQgXCJfX3R5cGVcIlxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqIEFuIG9iamVjdC5cbiAgICovXG4gIHN0YXRpYyByZW1vdmVIaWRkZW5Qcm9wZXJ0aWVzKG9iaikge1xuICAgIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBrZXkpKSB7XG4gICAgICAgIC8vIFJlZ2V4cCBjb21lcyBmcm9tIFBhcnNlLk9iamVjdC5wcm90b3R5cGUudmFsaWRhdGVcbiAgICAgICAgaWYgKGtleSAhPT0gJ19fdHlwZScgJiYgIS9eW0EtWmEtel1bMC05QS1aYS16X10qJC8udGVzdChrZXkpKSB7XG4gICAgICAgICAgZGVsZXRlIG9ialtrZXldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFmdGVyIHJldHJpZXZpbmcgYSB1c2VyIGRpcmVjdGx5IGZyb20gdGhlIGRhdGFiYXNlLCB3ZSBuZWVkIHRvIHJlbW92ZSB0aGVcbiAgICogcGFzc3dvcmQgZnJvbSB0aGUgb2JqZWN0IChmb3Igc2VjdXJpdHkpLCBhbmQgZml4IGFuIGlzc3VlIHNvbWUgU0RLcyBoYXZlXG4gICAqIHdpdGggbnVsbCB2YWx1ZXNcbiAgICovXG4gIF9zYW5pdGl6ZUF1dGhEYXRhKHVzZXIpIHtcbiAgICBkZWxldGUgdXNlci5wYXNzd29yZDtcblxuICAgIC8vIFNvbWV0aW1lcyB0aGUgYXV0aERhdGEgc3RpbGwgaGFzIG51bGwgb24gdGhhdCBrZXlzXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL3BhcnNlLWNvbW11bml0eS9wYXJzZS1zZXJ2ZXIvaXNzdWVzLzkzNVxuICAgIGlmICh1c2VyLmF1dGhEYXRhKSB7XG4gICAgICBPYmplY3Qua2V5cyh1c2VyLmF1dGhEYXRhKS5mb3JFYWNoKHByb3ZpZGVyID0+IHtcbiAgICAgICAgaWYgKHVzZXIuYXV0aERhdGFbcHJvdmlkZXJdID09PSBudWxsKSB7XG4gICAgICAgICAgZGVsZXRlIHVzZXIuYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGlmIChPYmplY3Qua2V5cyh1c2VyLmF1dGhEYXRhKS5sZW5ndGggPT0gMCkge1xuICAgICAgICBkZWxldGUgdXNlci5hdXRoRGF0YTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgcGFzc3dvcmQgcmVxdWVzdCBpbiBsb2dpbiBhbmQgdmVyaWZ5UGFzc3dvcmRcbiAgICogQHBhcmFtIHtPYmplY3R9IHJlcSBUaGUgcmVxdWVzdFxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBVc2VyIG9iamVjdFxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgX2F1dGhlbnRpY2F0ZVVzZXJGcm9tUmVxdWVzdChyZXEpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgLy8gVXNlIHF1ZXJ5IHBhcmFtZXRlcnMgaW5zdGVhZCBpZiBwcm92aWRlZCBpbiB1cmxcbiAgICAgIGxldCBwYXlsb2FkID0gcmVxLmJvZHkgfHwge307XG4gICAgICBpZiAoXG4gICAgICAgICghcGF5bG9hZC51c2VybmFtZSAmJiByZXEucXVlcnkgJiYgcmVxLnF1ZXJ5LnVzZXJuYW1lKSB8fFxuICAgICAgICAoIXBheWxvYWQuZW1haWwgJiYgcmVxLnF1ZXJ5ICYmIHJlcS5xdWVyeS5lbWFpbClcbiAgICAgICkge1xuICAgICAgICBwYXlsb2FkID0gcmVxLnF1ZXJ5O1xuICAgICAgfVxuICAgICAgY29uc3QgeyB1c2VybmFtZSwgZW1haWwsIHBhc3N3b3JkLCBpZ25vcmVFbWFpbFZlcmlmaWNhdGlvbiB9ID0gcGF5bG9hZDtcblxuICAgICAgLy8gVE9ETzogdXNlIHRoZSByaWdodCBlcnJvciBjb2RlcyAvIGRlc2NyaXB0aW9ucy5cbiAgICAgIGlmICghdXNlcm5hbWUgJiYgIWVtYWlsKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5VU0VSTkFNRV9NSVNTSU5HLCAndXNlcm5hbWUvZW1haWwgaXMgcmVxdWlyZWQuJyk7XG4gICAgICB9XG4gICAgICBpZiAoIXBhc3N3b3JkKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QQVNTV09SRF9NSVNTSU5HLCAncGFzc3dvcmQgaXMgcmVxdWlyZWQuJyk7XG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXNzd29yZCAhPT0gJ3N0cmluZycgfHxcbiAgICAgICAgKGVtYWlsICYmIHR5cGVvZiBlbWFpbCAhPT0gJ3N0cmluZycpIHx8XG4gICAgICAgICh1c2VybmFtZSAmJiB0eXBlb2YgdXNlcm5hbWUgIT09ICdzdHJpbmcnKVxuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnSW52YWxpZCB1c2VybmFtZS9wYXNzd29yZC4nKTtcbiAgICAgIH1cblxuICAgICAgbGV0IHVzZXI7XG4gICAgICBsZXQgaXNWYWxpZFBhc3N3b3JkID0gZmFsc2U7XG4gICAgICBsZXQgcXVlcnk7XG4gICAgICBpZiAoZW1haWwgJiYgdXNlcm5hbWUpIHtcbiAgICAgICAgcXVlcnkgPSB7IGVtYWlsLCB1c2VybmFtZSB9O1xuICAgICAgfSBlbHNlIGlmIChlbWFpbCkge1xuICAgICAgICBxdWVyeSA9IHsgZW1haWwgfTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHF1ZXJ5ID0geyAkb3I6IFt7IHVzZXJuYW1lIH0sIHsgZW1haWw6IHVzZXJuYW1lIH1dIH07XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVxLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgICAuZmluZCgnX1VzZXInLCBxdWVyeSwge30sIEF1dGgubWFpbnRlbmFuY2UocmVxLmNvbmZpZykpXG4gICAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICAgIGlmICghcmVzdWx0cy5sZW5ndGgpIHtcbiAgICAgICAgICAgIC8vIFBlcmZvcm0gYSBkdW1teSBiY3J5cHQgY29tcGFyZSB0byBub3JtYWxpemUgcmVzcG9uc2UgdGltaW5nLFxuICAgICAgICAgICAgLy8gcHJldmVudGluZyB1c2VyIGVudW1lcmF0aW9uIHZpYSB0aW1pbmcgc2lkZS1jaGFubmVsXG4gICAgICAgICAgICByZXR1cm4gcGFzc3dvcmRDcnlwdG9cbiAgICAgICAgICAgICAgLmNvbXBhcmUocGFzc3dvcmQsIHBhc3N3b3JkQ3J5cHRvLmR1bW15SGFzaClcbiAgICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnSW52YWxpZCB1c2VybmFtZS9wYXNzd29yZC4nKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgLy8gY29ybmVyIGNhc2Ugd2hlcmUgdXNlcjEgaGFzIHVzZXJuYW1lID09IHVzZXIyIGVtYWlsXG4gICAgICAgICAgICByZXEuY29uZmlnLmxvZ2dlckNvbnRyb2xsZXIud2FybihcbiAgICAgICAgICAgICAgXCJUaGVyZSBpcyBhIHVzZXIgd2hpY2ggZW1haWwgaXMgdGhlIHNhbWUgYXMgYW5vdGhlciB1c2VyJ3MgdXNlcm5hbWUsIGxvZ2dpbmcgaW4gYmFzZWQgb24gdXNlcm5hbWVcIlxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHVzZXIgPSByZXN1bHRzLmZpbHRlcih1c2VyID0+IHVzZXIudXNlcm5hbWUgPT09IHVzZXJuYW1lKVswXTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdXNlciA9IHJlc3VsdHNbMF07XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHR5cGVvZiB1c2VyLnBhc3N3b3JkICE9PSAnc3RyaW5nJyB8fCB1c2VyLnBhc3N3b3JkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgLy8gUGFzc3dvcmRsZXNzIGFjY291bnQgKGUuZy4gT0F1dGgtb25seSk6IHJ1biBkdW1teSBjb21wYXJlIGZvclxuICAgICAgICAgICAgLy8gdGltaW5nIG5vcm1hbGl6YXRpb24sIGRpc2NhcmQgcmVzdWx0LCBhbHdheXMgcmVqZWN0XG4gICAgICAgICAgICByZXR1cm4gcGFzc3dvcmRDcnlwdG8uY29tcGFyZShwYXNzd29yZCwgcGFzc3dvcmRDcnlwdG8uZHVtbXlIYXNoKS50aGVuKCgpID0+IGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHBhc3N3b3JkQ3J5cHRvLmNvbXBhcmUocGFzc3dvcmQsIHVzZXIucGFzc3dvcmQpO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbihjb3JyZWN0ID0+IHtcbiAgICAgICAgICBpc1ZhbGlkUGFzc3dvcmQgPSBjb3JyZWN0O1xuICAgICAgICAgIGNvbnN0IGFjY291bnRMb2Nrb3V0UG9saWN5ID0gbmV3IEFjY291bnRMb2Nrb3V0KHVzZXIsIHJlcS5jb25maWcpO1xuICAgICAgICAgIHJldHVybiBhY2NvdW50TG9ja291dFBvbGljeS5oYW5kbGVMb2dpbkF0dGVtcHQoaXNWYWxpZFBhc3N3b3JkKTtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmICghaXNWYWxpZFBhc3N3b3JkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ0ludmFsaWQgdXNlcm5hbWUvcGFzc3dvcmQuJyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIEEgdXNlciB3aXRoIGFuIGVtcHR5IEFDTCAobWFzdGVyIGtleSBvbmx5KSBpcyBjb25zaWRlcmVkIGxvY2tlZCBvdXQgYW5kXG4gICAgICAgICAgLy8gY2Fubm90IGxvZyBpbi4gVGhpcyBvbmx5IHByZXZlbnRzIG5ldyBsb2dpbnM7IGV4aXN0aW5nIHNlc3Npb24gdG9rZW5zXG4gICAgICAgICAgLy8gcmVtYWluIHZhbGlkLiBUbyBpbW1lZGlhdGVseSByZXZva2UgYWNjZXNzLCBhbHNvIGRlc3Ryb3kgdGhlIHVzZXInc1xuICAgICAgICAgIC8vIHNlc3Npb25zIHZpYSBtYXN0ZXIga2V5LlxuICAgICAgICAgIGlmICghcmVxLmF1dGguaXNNYXN0ZXIgJiYgdXNlci5BQ0wgJiYgT2JqZWN0LmtleXModXNlci5BQ0wpLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ0ludmFsaWQgdXNlcm5hbWUvcGFzc3dvcmQuJyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIENyZWF0ZSByZXF1ZXN0IG9iamVjdCBmb3IgdmVyaWZpY2F0aW9uIGZ1bmN0aW9uc1xuICAgICAgICAgIGNvbnN0IGF1dGhQcm92aWRlciA9XG4gICAgICAgICAgICByZXEuYm9keSAmJlxuICAgICAgICAgICAgcmVxLmJvZHkuYXV0aERhdGEgJiZcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKHJlcS5ib2R5LmF1dGhEYXRhKS5sZW5ndGggJiZcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKHJlcS5ib2R5LmF1dGhEYXRhKS5qb2luKCcsJyk7XG4gICAgICAgICAgY29uc3QgcmVxdWVzdCA9IHtcbiAgICAgICAgICAgIG1hc3RlcjogcmVxLmF1dGguaXNNYXN0ZXIsXG4gICAgICAgICAgICBpcDogcmVxLmNvbmZpZy5pcCxcbiAgICAgICAgICAgIGluc3RhbGxhdGlvbklkOiByZXEuYXV0aC5pbnN0YWxsYXRpb25JZCxcbiAgICAgICAgICAgIG9iamVjdDogUGFyc2UuVXNlci5mcm9tSlNPTihPYmplY3QuYXNzaWduKHsgY2xhc3NOYW1lOiAnX1VzZXInIH0sIHVzZXIpKSxcbiAgICAgICAgICAgIGNyZWF0ZWRXaXRoOiBSZXN0V3JpdGUuYnVpbGRDcmVhdGVkV2l0aCgnbG9naW4nLCBhdXRoUHJvdmlkZXIpLFxuICAgICAgICAgIH07XG5cbiAgICAgICAgICAvLyBJZiByZXF1ZXN0IGRvZXNuJ3QgdXNlIG1hc3RlciBvciBtYWludGVuYW5jZSBrZXkgd2l0aCBpZ25vcmluZyBlbWFpbCB2ZXJpZmljYXRpb25cbiAgICAgICAgICBpZiAoISgocmVxLmF1dGguaXNNYXN0ZXIgfHwgcmVxLmF1dGguaXNNYWludGVuYW5jZSkgJiYgaWdub3JlRW1haWxWZXJpZmljYXRpb24pKSB7XG5cbiAgICAgICAgICAgIC8vIEdldCB2ZXJpZmljYXRpb24gY29uZGl0aW9ucyB3aGljaCBjYW4gYmUgYm9vbGVhbnMgb3IgZnVuY3Rpb25zOyB0aGUgcHVycG9zZSBvZiB0aGlzIGFzeW5jL2F3YWl0XG4gICAgICAgICAgICAvLyBzdHJ1Y3R1cmUgaXMgdG8gYXZvaWQgdW5uZWNlc3NhcmlseSBleGVjdXRpbmcgc3Vic2VxdWVudCBmdW5jdGlvbnMgaWYgcHJldmlvdXMgb25lcyBmYWlsIGluIHRoZVxuICAgICAgICAgICAgLy8gY29uZGl0aW9uYWwgc3RhdGVtZW50IGJlbG93LCBhcyBhIGRldmVsb3BlciBtYXkgZGVjaWRlIHRvIGV4ZWN1dGUgZXhwZW5zaXZlIG9wZXJhdGlvbnMgaW4gdGhlbVxuICAgICAgICAgICAgY29uc3QgdmVyaWZ5VXNlckVtYWlscyA9IGFzeW5jICgpID0+IHJlcS5jb25maWcudmVyaWZ5VXNlckVtYWlscyA9PT0gdHJ1ZSB8fCAodHlwZW9mIHJlcS5jb25maWcudmVyaWZ5VXNlckVtYWlscyA9PT0gJ2Z1bmN0aW9uJyAmJiBhd2FpdCBQcm9taXNlLnJlc29sdmUocmVxLmNvbmZpZy52ZXJpZnlVc2VyRW1haWxzKHJlcXVlc3QpKSA9PT0gdHJ1ZSk7XG4gICAgICAgICAgICBjb25zdCBwcmV2ZW50TG9naW5XaXRoVW52ZXJpZmllZEVtYWlsID0gYXN5bmMgKCkgPT4gcmVxLmNvbmZpZy5wcmV2ZW50TG9naW5XaXRoVW52ZXJpZmllZEVtYWlsID09PSB0cnVlIHx8ICh0eXBlb2YgcmVxLmNvbmZpZy5wcmV2ZW50TG9naW5XaXRoVW52ZXJpZmllZEVtYWlsID09PSAnZnVuY3Rpb24nICYmIGF3YWl0IFByb21pc2UucmVzb2x2ZShyZXEuY29uZmlnLnByZXZlbnRMb2dpbldpdGhVbnZlcmlmaWVkRW1haWwocmVxdWVzdCkpID09PSB0cnVlKTtcbiAgICAgICAgICAgIGlmIChhd2FpdCB2ZXJpZnlVc2VyRW1haWxzKCkgJiYgYXdhaXQgcHJldmVudExvZ2luV2l0aFVudmVyaWZpZWRFbWFpbCgpICYmICF1c2VyLmVtYWlsVmVyaWZpZWQpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkVNQUlMX05PVF9GT1VORCwgJ1VzZXIgZW1haWwgaXMgbm90IHZlcmlmaWVkLicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRoaXMuX3Nhbml0aXplQXV0aERhdGEodXNlcik7XG5cbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZSh1c2VyKTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycm9yKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBoYW5kbGVNZShyZXEpIHtcbiAgICBpZiAoIXJlcS5pbmZvIHx8ICFyZXEuaW5mby5zZXNzaW9uVG9rZW4pIHtcbiAgICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTiwgJ0ludmFsaWQgc2Vzc2lvbiB0b2tlbicsIHJlcS5jb25maWcpO1xuICAgIH1cbiAgICBjb25zdCBzZXNzaW9uVG9rZW4gPSByZXEuaW5mby5zZXNzaW9uVG9rZW47XG4gICAgLy8gUXVlcnkgdGhlIHNlc3Npb24gd2l0aCBtYXN0ZXIga2V5IHRvIHZhbGlkYXRlIHRoZSBzZXNzaW9uIHRva2VuLFxuICAgIC8vIGJ1dCBkbyBOT1QgaW5jbHVkZSAndXNlcicgdG8gYXZvaWQgbGVha2luZyB1c2VyIGRhdGEgdmlhIG1hc3RlciBjb250ZXh0XG4gICAgY29uc3Qgc2Vzc2lvblJlc3BvbnNlID0gYXdhaXQgcmVzdC5maW5kKFxuICAgICAgcmVxLmNvbmZpZyxcbiAgICAgIEF1dGgubWFzdGVyKHJlcS5jb25maWcpLFxuICAgICAgJ19TZXNzaW9uJyxcbiAgICAgIHsgc2Vzc2lvblRva2VuIH0sXG4gICAgICB7fSxcbiAgICAgIHJlcS5pbmZvLmNsaWVudFNESyxcbiAgICAgIHJlcS5pbmZvLmNvbnRleHRcbiAgICApO1xuICAgIGlmIChcbiAgICAgICFzZXNzaW9uUmVzcG9uc2UucmVzdWx0cyB8fFxuICAgICAgc2Vzc2lvblJlc3BvbnNlLnJlc3VsdHMubGVuZ3RoID09IDAgfHxcbiAgICAgICFzZXNzaW9uUmVzcG9uc2UucmVzdWx0c1swXS51c2VyXG4gICAgKSB7XG4gICAgICB0aHJvdyBjcmVhdGVTYW5pdGl6ZWRFcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1NFU1NJT05fVE9LRU4sICdJbnZhbGlkIHNlc3Npb24gdG9rZW4nLCByZXEuY29uZmlnKTtcbiAgICB9XG4gICAgY29uc3QgdXNlcklkID0gc2Vzc2lvblJlc3BvbnNlLnJlc3VsdHNbMF0udXNlci5vYmplY3RJZDtcbiAgICAvLyBSZS1mZXRjaCB0aGUgdXNlciB3aXRoIHRoZSBjYWxsZXIncyBhdXRoIGNvbnRleHQgc28gdGhhdFxuICAgIC8vIHByb3RlY3RlZEZpZWxkcywgQ0xQLCBhbmQgYXV0aCBhZGFwdGVyIGFmdGVyRmluZCBhcHBseSBjb3JyZWN0bHlcbiAgICBjb25zdCB1c2VyUmVzcG9uc2UgPSBhd2FpdCByZXN0LmdldChcbiAgICAgIHJlcS5jb25maWcsXG4gICAgICByZXEuYXV0aCxcbiAgICAgICdfVXNlcicsXG4gICAgICB1c2VySWQsXG4gICAgICB7fSxcbiAgICAgIHJlcS5pbmZvLmNsaWVudFNESyxcbiAgICAgIHJlcS5pbmZvLmNvbnRleHRcbiAgICApO1xuICAgIGlmICghdXNlclJlc3BvbnNlLnJlc3VsdHMgfHwgdXNlclJlc3BvbnNlLnJlc3VsdHMubGVuZ3RoID09IDApIHtcbiAgICAgIHRocm93IGNyZWF0ZVNhbml0aXplZEVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTiwgJ0ludmFsaWQgc2Vzc2lvbiB0b2tlbicsIHJlcS5jb25maWcpO1xuICAgIH1cbiAgICBjb25zdCB1c2VyID0gdXNlclJlc3BvbnNlLnJlc3VsdHNbMF07XG4gICAgLy8gU2VuZCB0b2tlbiBiYWNrIG9uIHRoZSBsb2dpbiwgYmVjYXVzZSBTREtzIGV4cGVjdCB0aGF0LlxuICAgIHVzZXIuc2Vzc2lvblRva2VuID0gc2Vzc2lvblRva2VuO1xuICAgIC8vIFJlbW92ZSBoaWRkZW4gcHJvcGVydGllcy5cbiAgICBVc2Vyc1JvdXRlci5yZW1vdmVIaWRkZW5Qcm9wZXJ0aWVzKHVzZXIpO1xuICAgIHJldHVybiB7IHJlc3BvbnNlOiB1c2VyIH07XG4gIH1cblxuICBhc3luYyBoYW5kbGVMb2dJbihyZXEpIHtcbiAgICBjb25zdCB1c2VyID0gYXdhaXQgdGhpcy5fYXV0aGVudGljYXRlVXNlckZyb21SZXF1ZXN0KHJlcSk7XG4gICAgY29uc3QgYXV0aERhdGEgPSByZXEuYm9keSAmJiByZXEuYm9keS5hdXRoRGF0YTtcbiAgICAvLyBDaGVjayBpZiB1c2VyIGhhcyBwcm92aWRlZCB0aGVpciByZXF1aXJlZCBhdXRoIHByb3ZpZGVyc1xuICAgIEF1dGguY2hlY2tJZlVzZXJIYXNQcm92aWRlZENvbmZpZ3VyZWRQcm92aWRlcnNGb3JMb2dpbihcbiAgICAgIHJlcSxcbiAgICAgIGF1dGhEYXRhLFxuICAgICAgdXNlci5hdXRoRGF0YSxcbiAgICAgIHJlcS5jb25maWdcbiAgICApO1xuXG4gICAgbGV0IGF1dGhEYXRhUmVzcG9uc2U7XG4gICAgbGV0IHZhbGlkYXRlZEF1dGhEYXRhO1xuICAgIGlmIChhdXRoRGF0YSkge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgQXV0aC5oYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24oXG4gICAgICAgIGF1dGhEYXRhLFxuICAgICAgICBuZXcgUmVzdFdyaXRlKFxuICAgICAgICAgIHJlcS5jb25maWcsXG4gICAgICAgICAgcmVxLmF1dGgsXG4gICAgICAgICAgJ19Vc2VyJyxcbiAgICAgICAgICB7IG9iamVjdElkOiB1c2VyLm9iamVjdElkIH0sXG4gICAgICAgICAgcmVxLmJvZHkgfHwge30sXG4gICAgICAgICAgdXNlcixcbiAgICAgICAgICByZXEuaW5mby5jbGllbnRTREssXG4gICAgICAgICAgcmVxLmluZm8uY29udGV4dFxuICAgICAgICApLFxuICAgICAgICB1c2VyXG4gICAgICApO1xuICAgICAgYXV0aERhdGFSZXNwb25zZSA9IHJlcy5hdXRoRGF0YVJlc3BvbnNlO1xuICAgICAgdmFsaWRhdGVkQXV0aERhdGEgPSByZXMuYXV0aERhdGE7XG4gICAgfVxuXG4gICAgLy8gaGFuZGxlIHBhc3N3b3JkIGV4cGlyeSBwb2xpY3lcbiAgICBpZiAocmVxLmNvbmZpZy5wYXNzd29yZFBvbGljeSAmJiByZXEuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkQWdlKSB7XG4gICAgICBsZXQgY2hhbmdlZEF0ID0gdXNlci5fcGFzc3dvcmRfY2hhbmdlZF9hdDtcblxuICAgICAgaWYgKCFjaGFuZ2VkQXQpIHtcbiAgICAgICAgLy8gcGFzc3dvcmQgd2FzIGNyZWF0ZWQgYmVmb3JlIGV4cGlyeSBwb2xpY3kgd2FzIGVuYWJsZWQuXG4gICAgICAgIC8vIHNpbXBseSB1cGRhdGUgX1VzZXIgb2JqZWN0IHNvIHRoYXQgaXQgd2lsbCBzdGFydCBlbmZvcmNpbmcgZnJvbSBub3dcbiAgICAgICAgY2hhbmdlZEF0ID0gbmV3IERhdGUoKTtcbiAgICAgICAgcmVxLmNvbmZpZy5kYXRhYmFzZS51cGRhdGUoXG4gICAgICAgICAgJ19Vc2VyJyxcbiAgICAgICAgICB7IHVzZXJuYW1lOiB1c2VyLnVzZXJuYW1lIH0sXG4gICAgICAgICAgeyBfcGFzc3dvcmRfY2hhbmdlZF9hdDogUGFyc2UuX2VuY29kZShjaGFuZ2VkQXQpIH1cbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIGNoZWNrIHdoZXRoZXIgdGhlIHBhc3N3b3JkIGhhcyBleHBpcmVkXG4gICAgICAgIGlmIChjaGFuZ2VkQXQuX190eXBlID09ICdEYXRlJykge1xuICAgICAgICAgIGNoYW5nZWRBdCA9IG5ldyBEYXRlKGNoYW5nZWRBdC5pc28pO1xuICAgICAgICB9XG4gICAgICAgIC8vIENhbGN1bGF0ZSB0aGUgZXhwaXJ5IHRpbWUuXG4gICAgICAgIGNvbnN0IGV4cGlyZXNBdCA9IG5ldyBEYXRlKFxuICAgICAgICAgIGNoYW5nZWRBdC5nZXRUaW1lKCkgKyA4NjQwMDAwMCAqIHJlcS5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRBZ2VcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGV4cGlyZXNBdCA8IG5ldyBEYXRlKCkpXG4gICAgICAgIC8vIGZhaWwgb2YgY3VycmVudCB0aW1lIGlzIHBhc3QgcGFzc3dvcmQgZXhwaXJ5IHRpbWVcbiAgICAgICAgeyB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAnWW91ciBwYXNzd29yZCBoYXMgZXhwaXJlZC4gUGxlYXNlIHJlc2V0IHlvdXIgcGFzc3dvcmQuJ1xuICAgICAgICApOyB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIGhpZGRlbiBwcm9wZXJ0aWVzLlxuICAgIFVzZXJzUm91dGVyLnJlbW92ZUhpZGRlblByb3BlcnRpZXModXNlcik7XG5cbiAgICBhd2FpdCByZXEuY29uZmlnLmZpbGVzQ29udHJvbGxlci5leHBhbmRGaWxlc0luT2JqZWN0KHJlcS5jb25maWcsIHVzZXIpO1xuXG4gICAgLy8gQmVmb3JlIGxvZ2luIHRyaWdnZXI7IHRocm93cyBpZiBmYWlsdXJlXG4gICAgYXdhaXQgbWF5YmVSdW5UcmlnZ2VyKFxuICAgICAgVHJpZ2dlclR5cGVzLmJlZm9yZUxvZ2luLFxuICAgICAgcmVxLmF1dGgsXG4gICAgICBQYXJzZS5Vc2VyLmZyb21KU09OKE9iamVjdC5hc3NpZ24oeyBjbGFzc05hbWU6ICdfVXNlcicgfSwgdXNlcikpLFxuICAgICAgbnVsbCxcbiAgICAgIHJlcS5jb25maWcsXG4gICAgICByZXEuaW5mby5jb250ZXh0XG4gICAgKTtcblxuICAgIC8vIElmIHdlIGhhdmUgc29tZSBuZXcgdmFsaWRhdGVkIGF1dGhEYXRhIHVwZGF0ZSBkaXJlY3RseVxuICAgIGlmICh2YWxpZGF0ZWRBdXRoRGF0YSAmJiBPYmplY3Qua2V5cyh2YWxpZGF0ZWRBdXRoRGF0YSkubGVuZ3RoKSB7XG4gICAgICBjb25zdCBxdWVyeSA9IHsgb2JqZWN0SWQ6IHVzZXIub2JqZWN0SWQgfTtcbiAgICAgIC8vIFByZXZlbnQgY29uY3VycmVudCByZXF1ZXN0cyBmcm9tIGJvdGggc3VjY2VlZGluZyB3aGVuIGNvbnN1bWluZyBzaW5nbGUtdXNlXG4gICAgICAvLyB0b2tlbnMgKGUuZy4gTUZBIHJlY292ZXJ5IGNvZGVzIG9yIFNNUyBPVFAgdG9rZW5zKSBieSBleHRlbmRpbmcgdGhlIHVwZGF0ZVxuICAgICAgLy8gV0hFUkUgY2xhdXNlIHdpdGggdGhlIG9yaWdpbmFsIHZhbHVlcyBvZiBjaGFuZ2VkIHByaW1pdGl2ZS9hcnJheSBmaWVsZHMuXG4gICAgICBhcHBseUF1dGhEYXRhT3B0aW1pc3RpY0xvY2socXVlcnksIHVzZXIuYXV0aERhdGEsIHZhbGlkYXRlZEF1dGhEYXRhKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHJlcS5jb25maWcuZGF0YWJhc2UudXBkYXRlKCdfVXNlcicsIHF1ZXJ5LCB7IGF1dGhEYXRhOiB2YWxpZGF0ZWRBdXRoRGF0YSB9LCB7fSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5TQ1JJUFRfRkFJTEVELCAnSW52YWxpZCBhdXRoIGRhdGEnKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB7IHNlc3Npb25EYXRhLCBjcmVhdGVTZXNzaW9uIH0gPSBSZXN0V3JpdGUuY3JlYXRlU2Vzc2lvbihyZXEuY29uZmlnLCB7XG4gICAgICB1c2VySWQ6IHVzZXIub2JqZWN0SWQsXG4gICAgICBjcmVhdGVkV2l0aDogUmVzdFdyaXRlLmJ1aWxkQ3JlYXRlZFdpdGgoJ2xvZ2luJyksXG4gICAgICBpbnN0YWxsYXRpb25JZDogcmVxLmluZm8uaW5zdGFsbGF0aW9uSWQsXG4gICAgfSk7XG5cbiAgICB1c2VyLnNlc3Npb25Ub2tlbiA9IHNlc3Npb25EYXRhLnNlc3Npb25Ub2tlbjtcblxuICAgIGF3YWl0IGNyZWF0ZVNlc3Npb24oKTtcblxuICAgIGNvbnN0IGFmdGVyTG9naW5Vc2VyID0gUGFyc2UuVXNlci5mcm9tSlNPTihPYmplY3QuYXNzaWduKHsgY2xhc3NOYW1lOiAnX1VzZXInIH0sIHVzZXIpKTtcbiAgICBhd2FpdCBtYXliZVJ1blRyaWdnZXIoXG4gICAgICBUcmlnZ2VyVHlwZXMuYWZ0ZXJMb2dpbixcbiAgICAgIHsgLi4ucmVxLmF1dGgsIHVzZXI6IGFmdGVyTG9naW5Vc2VyIH0sXG4gICAgICBhZnRlckxvZ2luVXNlcixcbiAgICAgIG51bGwsXG4gICAgICByZXEuY29uZmlnLFxuICAgICAgcmVxLmluZm8uY29udGV4dFxuICAgICk7XG5cbiAgICAvLyBSZS1mZXRjaCB0aGUgdXNlciB3aXRoIHRoZSBjYWxsZXIncyBhdXRoIGNvbnRleHQgc28gdGhhdFxuICAgIC8vIHByb3RlY3RlZEZpZWxkcyBhbmQgQ0xQIGFwcGx5IGNvcnJlY3RseTsgaWYgdGhlIGNhbGxlciB1c2VkIG1hc3RlciBrZXksXG4gICAgLy8gcHJvdGVjdGVkRmllbGRzIGFyZSBieXBhc3NlZCwgbWF0Y2hpbmcgdGhlIGJlaGF2aW9yIG9mIEdFVCAvdXNlcnMvOmlkXG4gICAgY29uc3QgcmVmZXRjaEF1dGggPVxuICAgICAgcmVxLmF1dGguaXNNYXN0ZXIgfHwgcmVxLmF1dGguaXNNYWludGVuYW5jZVxuICAgICAgICA/IHJlcS5hdXRoXG4gICAgICAgIDogbmV3IEF1dGguQXV0aCh7XG4gICAgICAgICAgY29uZmlnOiByZXEuY29uZmlnLFxuICAgICAgICAgIGlzTWFzdGVyOiBmYWxzZSxcbiAgICAgICAgICB1c2VyOiBQYXJzZS5PYmplY3QuZnJvbUpTT04oeyBjbGFzc05hbWU6ICdfVXNlcicsIG9iamVjdElkOiB1c2VyLm9iamVjdElkIH0pLFxuICAgICAgICAgIGluc3RhbGxhdGlvbklkOiByZXEuaW5mby5pbnN0YWxsYXRpb25JZCxcbiAgICAgICAgfSk7XG4gICAgbGV0IGZpbHRlcmVkVXNlcjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZmlsdGVyZWRVc2VyUmVzcG9uc2UgPSBhd2FpdCByZXN0LmdldChcbiAgICAgICAgcmVxLmNvbmZpZyxcbiAgICAgICAgcmVmZXRjaEF1dGgsXG4gICAgICAgICdfVXNlcicsXG4gICAgICAgIHVzZXIub2JqZWN0SWQsXG4gICAgICAgIHt9LFxuICAgICAgICByZXEuaW5mby5jbGllbnRTREssXG4gICAgICAgIHJlcS5pbmZvLmNvbnRleHRcbiAgICAgICk7XG4gICAgICBmaWx0ZXJlZFVzZXIgPSBmaWx0ZXJlZFVzZXJSZXNwb25zZS5yZXN1bHRzPy5bMF07XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyByZS1mZXRjaCBtYXkgZmFpbCBmb3IgbGVnYWN5IHVzZXJzIHdpdGhvdXQgQUNMOyBmYWxsIHRocm91Z2hcbiAgICB9XG4gICAgaWYgKCFmaWx0ZXJlZFVzZXIpIHtcbiAgICAgIGZpbHRlcmVkVXNlciA9IHVzZXI7XG4gICAgfVxuICAgIFVzZXJzUm91dGVyLnJlbW92ZUhpZGRlblByb3BlcnRpZXMoZmlsdGVyZWRVc2VyKTtcbiAgICBmaWx0ZXJlZFVzZXIuc2Vzc2lvblRva2VuID0gdXNlci5zZXNzaW9uVG9rZW47XG4gICAgaWYgKGF1dGhEYXRhUmVzcG9uc2UpIHtcbiAgICAgIGZpbHRlcmVkVXNlci5hdXRoRGF0YVJlc3BvbnNlID0gYXV0aERhdGFSZXNwb25zZTtcbiAgICB9XG5cbiAgICByZXR1cm4geyByZXNwb25zZTogZmlsdGVyZWRVc2VyIH07XG4gIH1cblxuICAvKipcbiAgICogVGhpcyBhbGxvd3MgbWFzdGVyLWtleSBjbGllbnRzIHRvIGNyZWF0ZSB1c2VyIHNlc3Npb25zIHdpdGhvdXQgYWNjZXNzIHRvXG4gICAqIHVzZXIgY3JlZGVudGlhbHMuIFRoaXMgZW5hYmxlcyBzeXN0ZW1zIHRoYXQgY2FuIGF1dGhlbnRpY2F0ZSBhY2Nlc3MgYW5vdGhlclxuICAgKiB3YXkgKEFQSSBrZXksIGFwcCBhZG1pbmlzdHJhdG9ycykgdG8gYWN0IG9uIGEgdXNlcidzIGJlaGFsZi5cbiAgICpcbiAgICogV2UgY3JlYXRlIGEgbmV3IHNlc3Npb24gcmF0aGVyIHRoYW4gbG9va2luZyBmb3IgYW4gZXhpc3Rpbmcgc2Vzc2lvbjsgd2VcbiAgICogd2FudCB0aGlzIHRvIHdvcmsgaW4gc2l0dWF0aW9ucyB3aGVyZSB0aGUgdXNlciBpcyBsb2dnZWQgb3V0IG9uIGFsbFxuICAgKiBkZXZpY2VzLCBzaW5jZSB0aGlzIGNhbiBiZSB1c2VkIGJ5IGF1dG9tYXRlZCBzeXN0ZW1zIGFjdGluZyBvbiB0aGUgdXNlcidzXG4gICAqIGJlaGFsZi5cbiAgICpcbiAgICogRm9yIHRoZSBtb21lbnQsIHdlJ3JlIG9taXR0aW5nIGV2ZW50IGhvb2tzIGFuZCBsb2Nrb3V0IGNoZWNrcywgc2luY2VcbiAgICogaW1tZWRpYXRlIHVzZSBjYXNlcyBzdWdnZXN0IC9sb2dpbkFzIGNvdWxkIGJlIHVzZWQgZm9yIHNlbWFudGljYWxseVxuICAgKiBkaWZmZXJlbnQgcmVhc29ucyBmcm9tIC9sb2dpblxuICAgKi9cbiAgYXN5bmMgaGFuZGxlTG9nSW5BcyhyZXEpIHtcbiAgICBpZiAoIXJlcS5hdXRoLmlzTWFzdGVyKSB7XG4gICAgICB0aHJvdyBjcmVhdGVTYW5pdGl6ZWRFcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgJ21hc3RlciBrZXkgaXMgcmVxdWlyZWQnLFxuICAgICAgICByZXEuY29uZmlnXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocmVxLmF1dGguaXNSZWFkT25seSkge1xuICAgICAgdGhyb3cgY3JlYXRlU2FuaXRpemVkRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAgIFwicmVhZC1vbmx5IG1hc3RlcktleSBpc24ndCBhbGxvd2VkIHRvIGxvZ2luIGFzIGFub3RoZXIgdXNlci5cIixcbiAgICAgICAgcmVxLmNvbmZpZ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCB1c2VySWQgPSByZXEuYm9keT8udXNlcklkIHx8IHJlcS5xdWVyeS51c2VySWQ7XG4gICAgaWYgKCF1c2VySWQpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9WQUxVRSxcbiAgICAgICAgJ3VzZXJJZCBtdXN0IG5vdCBiZSBlbXB0eSwgbnVsbCwgb3IgdW5kZWZpbmVkJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeVJlc3VsdHMgPSBhd2FpdCByZXEuY29uZmlnLmRhdGFiYXNlLmZpbmQoJ19Vc2VyJywgeyBvYmplY3RJZDogdXNlcklkIH0pO1xuICAgIGNvbnN0IHVzZXIgPSBxdWVyeVJlc3VsdHNbMF07XG4gICAgaWYgKCF1c2VyKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ3VzZXIgbm90IGZvdW5kJyk7XG4gICAgfVxuXG4gICAgdGhpcy5fc2FuaXRpemVBdXRoRGF0YSh1c2VyKTtcblxuICAgIGNvbnN0IHsgc2Vzc2lvbkRhdGEsIGNyZWF0ZVNlc3Npb24gfSA9IFJlc3RXcml0ZS5jcmVhdGVTZXNzaW9uKHJlcS5jb25maWcsIHtcbiAgICAgIHVzZXJJZCxcbiAgICAgIGNyZWF0ZWRXaXRoOiBSZXN0V3JpdGUuYnVpbGRDcmVhdGVkV2l0aCgnbG9naW4nLCAnbWFzdGVya2V5JyksXG4gICAgICBpbnN0YWxsYXRpb25JZDogcmVxLmluZm8uaW5zdGFsbGF0aW9uSWQsXG4gICAgfSk7XG5cbiAgICB1c2VyLnNlc3Npb25Ub2tlbiA9IHNlc3Npb25EYXRhLnNlc3Npb25Ub2tlbjtcblxuICAgIGF3YWl0IGNyZWF0ZVNlc3Npb24oKTtcblxuICAgIHJldHVybiB7IHJlc3BvbnNlOiB1c2VyIH07XG4gIH1cblxuICBoYW5kbGVWZXJpZnlQYXNzd29yZChyZXEpIHtcbiAgICByZXR1cm4gdGhpcy5fYXV0aGVudGljYXRlVXNlckZyb21SZXF1ZXN0KHJlcSlcbiAgICAgIC50aGVuKGFzeW5jIHVzZXIgPT4ge1xuICAgICAgICAvLyBSZW1vdmUgaGlkZGVuIHByb3BlcnRpZXMuXG4gICAgICAgIFVzZXJzUm91dGVyLnJlbW92ZUhpZGRlblByb3BlcnRpZXModXNlcik7XG4gICAgICAgIC8vIFJlLWZldGNoIHRoZSB1c2VyIHdpdGggdGhlIGNhbGxlcidzIGF1dGggY29udGV4dCBzbyB0aGF0XG4gICAgICAgIC8vIHByb3RlY3RlZEZpZWxkcyBhbmQgQ0xQIGFwcGx5IGNvcnJlY3RseTsgaWYgdGhlIGNhbGxlciB1c2VkIG1hc3RlciBrZXksXG4gICAgICAgIC8vIHByb3RlY3RlZEZpZWxkcyBhcmUgYnlwYXNzZWQsIG1hdGNoaW5nIHRoZSBiZWhhdmlvciBvZiBHRVQgL3VzZXJzLzppZFxuICAgICAgICBjb25zdCByZWZldGNoQXV0aCA9XG4gICAgICAgICAgcmVxLmF1dGguaXNNYXN0ZXIgfHwgcmVxLmF1dGguaXNNYWludGVuYW5jZVxuICAgICAgICAgICAgPyByZXEuYXV0aFxuICAgICAgICAgICAgOiBuZXcgQXV0aC5BdXRoKHtcbiAgICAgICAgICAgICAgY29uZmlnOiByZXEuY29uZmlnLFxuICAgICAgICAgICAgICBpc01hc3RlcjogZmFsc2UsXG4gICAgICAgICAgICAgIHVzZXI6IFBhcnNlLk9iamVjdC5mcm9tSlNPTih7IGNsYXNzTmFtZTogJ19Vc2VyJywgb2JqZWN0SWQ6IHVzZXIub2JqZWN0SWQgfSksXG4gICAgICAgICAgICAgIGluc3RhbGxhdGlvbklkOiByZXEuaW5mby5pbnN0YWxsYXRpb25JZCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICBsZXQgZmlsdGVyZWRVc2VyO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGZpbHRlcmVkVXNlclJlc3BvbnNlID0gYXdhaXQgcmVzdC5nZXQoXG4gICAgICAgICAgICByZXEuY29uZmlnLFxuICAgICAgICAgICAgcmVmZXRjaEF1dGgsXG4gICAgICAgICAgICAnX1VzZXInLFxuICAgICAgICAgICAgdXNlci5vYmplY3RJZCxcbiAgICAgICAgICAgIHt9LFxuICAgICAgICAgICAgcmVxLmluZm8uY2xpZW50U0RLLFxuICAgICAgICAgICAgcmVxLmluZm8uY29udGV4dFxuICAgICAgICAgICk7XG4gICAgICAgICAgZmlsdGVyZWRVc2VyID0gZmlsdGVyZWRVc2VyUmVzcG9uc2UucmVzdWx0cz8uWzBdO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyByZS1mZXRjaCBtYXkgZmFpbCBmb3IgbGVnYWN5IHVzZXJzIHdpdGhvdXQgQUNMOyBmYWxsIHRocm91Z2hcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWZpbHRlcmVkVXNlcikge1xuICAgICAgICAgIGZpbHRlcmVkVXNlciA9IHVzZXI7XG4gICAgICAgIH1cbiAgICAgICAgVXNlcnNSb3V0ZXIucmVtb3ZlSGlkZGVuUHJvcGVydGllcyhmaWx0ZXJlZFVzZXIpO1xuICAgICAgICByZXR1cm4geyByZXNwb25zZTogZmlsdGVyZWRVc2VyIH07XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGhhbmRsZUxvZ091dChyZXEpIHtcbiAgICBjb25zdCBzdWNjZXNzID0geyByZXNwb25zZToge30gfTtcbiAgICBpZiAocmVxLmluZm8gJiYgcmVxLmluZm8uc2Vzc2lvblRva2VuKSB7XG4gICAgICBjb25zdCByZWNvcmRzID0gYXdhaXQgcmVzdC5maW5kKFxuICAgICAgICByZXEuY29uZmlnLFxuICAgICAgICBBdXRoLm1hc3RlcihyZXEuY29uZmlnKSxcbiAgICAgICAgJ19TZXNzaW9uJyxcbiAgICAgICAgeyBzZXNzaW9uVG9rZW46IHJlcS5pbmZvLnNlc3Npb25Ub2tlbiB9LFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIHJlcS5pbmZvLmNsaWVudFNESyxcbiAgICAgICAgcmVxLmluZm8uY29udGV4dFxuICAgICAgKTtcbiAgICAgIGlmIChyZWNvcmRzLnJlc3VsdHMgJiYgcmVjb3Jkcy5yZXN1bHRzLmxlbmd0aCkge1xuICAgICAgICBhd2FpdCByZXN0LmRlbChcbiAgICAgICAgICByZXEuY29uZmlnLFxuICAgICAgICAgIEF1dGgubWFzdGVyKHJlcS5jb25maWcpLFxuICAgICAgICAgICdfU2Vzc2lvbicsXG4gICAgICAgICAgcmVjb3Jkcy5yZXN1bHRzWzBdLm9iamVjdElkLFxuICAgICAgICAgIHJlcS5pbmZvLmNvbnRleHRcbiAgICAgICAgKTtcbiAgICAgICAgYXdhaXQgbWF5YmVSdW5UcmlnZ2VyKFxuICAgICAgICAgIFRyaWdnZXJUeXBlcy5hZnRlckxvZ291dCxcbiAgICAgICAgICByZXEuYXV0aCxcbiAgICAgICAgICBQYXJzZS5TZXNzaW9uLmZyb21KU09OKE9iamVjdC5hc3NpZ24oeyBjbGFzc05hbWU6ICdfU2Vzc2lvbicgfSwgcmVjb3Jkcy5yZXN1bHRzWzBdKSksXG4gICAgICAgICAgbnVsbCxcbiAgICAgICAgICByZXEuY29uZmlnXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzdWNjZXNzO1xuICB9XG5cbiAgX3Rocm93T25CYWRFbWFpbENvbmZpZyhyZXEpIHtcbiAgICB0cnkge1xuICAgICAgQ29uZmlnLnZhbGlkYXRlRW1haWxDb25maWd1cmF0aW9uKHtcbiAgICAgICAgZW1haWxBZGFwdGVyOiByZXEuY29uZmlnLnVzZXJDb250cm9sbGVyLmFkYXB0ZXIsXG4gICAgICAgIGFwcE5hbWU6IHJlcS5jb25maWcuYXBwTmFtZSxcbiAgICAgICAgcHVibGljU2VydmVyVVJMOiByZXEuY29uZmlnLnB1YmxpY1NlcnZlclVSTCB8fCByZXEuY29uZmlnLl9wdWJsaWNTZXJ2ZXJVUkwsXG4gICAgICAgIGVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uOiByZXEuY29uZmlnLmVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uLFxuICAgICAgICBlbWFpbFZlcmlmeVRva2VuUmV1c2VJZlZhbGlkOiByZXEuY29uZmlnLmVtYWlsVmVyaWZ5VG9rZW5SZXVzZUlmVmFsaWQsXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAodHlwZW9mIGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIE1heWJlIHdlIG5lZWQgYSBCYWQgQ29uZmlndXJhdGlvbiBlcnJvciwgYnV0IHRoZSBTREtzIHdvbid0IHVuZGVyc3RhbmQgaXQuIEZvciBub3csIEludGVybmFsIFNlcnZlciBFcnJvci5cbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUixcbiAgICAgICAgICAnQW4gYXBwTmFtZSwgcHVibGljU2VydmVyVVJMLCBhbmQgZW1haWxBZGFwdGVyIGFyZSByZXF1aXJlZCBmb3IgcGFzc3dvcmQgcmVzZXQgYW5kIGVtYWlsIHZlcmlmaWNhdGlvbiBmdW5jdGlvbmFsaXR5LidcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgaGFuZGxlUmVzZXRSZXF1ZXN0KHJlcSkge1xuICAgIHRoaXMuX3Rocm93T25CYWRFbWFpbENvbmZpZyhyZXEpO1xuXG4gICAgbGV0IGVtYWlsID0gcmVxLmJvZHk/LmVtYWlsO1xuICAgIGNvbnN0IHRva2VuID0gcmVxLmJvZHk/LnRva2VuO1xuXG4gICAgaWYgKCFlbWFpbCAmJiAhdG9rZW4pIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5FTUFJTF9NSVNTSU5HLCAneW91IG11c3QgcHJvdmlkZSBhbiBlbWFpbCcpO1xuICAgIH1cblxuICAgIGlmICh0b2tlbiAmJiB0eXBlb2YgdG9rZW4gIT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9WQUxVRSwgJ3Rva2VuIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICB9XG5cbiAgICBsZXQgdXNlclJlc3VsdHMgPSBudWxsO1xuICAgIGxldCB1c2VyRGF0YSA9IG51bGw7XG5cbiAgICAvLyBXZSBjYW4gZmluZCB0aGUgdXNlciB1c2luZyB0b2tlblxuICAgIGlmICh0b2tlbikge1xuICAgICAgdXNlclJlc3VsdHMgPSBhd2FpdCByZXEuY29uZmlnLmRhdGFiYXNlLmZpbmQoJ19Vc2VyJywge1xuICAgICAgICBfcGVyaXNoYWJsZV90b2tlbjogdG9rZW4sXG4gICAgICAgIF9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQ6IHsgJGx0OiBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKCkpIH0sXG4gICAgICB9KTtcbiAgICAgIGlmICh1c2VyUmVzdWx0cz8ubGVuZ3RoID4gMCkge1xuICAgICAgICB1c2VyRGF0YSA9IHVzZXJSZXN1bHRzWzBdO1xuICAgICAgICBpZiAodXNlckRhdGEuZW1haWwpIHtcbiAgICAgICAgICBlbWFpbCA9IHVzZXJEYXRhLmVtYWlsO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgLy8gT3IgdXNpbmcgZW1haWwgaWYgbm8gdG9rZW4gcHJvdmlkZWRcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBlbWFpbCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHVzZXJSZXN1bHRzID0gYXdhaXQgcmVxLmNvbmZpZy5kYXRhYmFzZS5maW5kKFxuICAgICAgICAnX1VzZXInLFxuICAgICAgICB7ICRvcjogW3sgZW1haWwgfSwgeyB1c2VybmFtZTogZW1haWwsIGVtYWlsOiB7ICRleGlzdHM6IGZhbHNlIH0gfV0gfSxcbiAgICAgICAgeyBsaW1pdDogMSB9LFxuICAgICAgICBBdXRoLm1haW50ZW5hbmNlKHJlcS5jb25maWcpXG4gICAgICApO1xuICAgICAgaWYgKHVzZXJSZXN1bHRzPy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHVzZXJEYXRhID0gdXNlclJlc3VsdHNbMF07XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBlbWFpbCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9FTUFJTF9BRERSRVNTLFxuICAgICAgICAneW91IG11c3QgcHJvdmlkZSBhIHZhbGlkIGVtYWlsIHN0cmluZydcbiAgICAgICk7XG4gICAgfVxuXG4gICAgaWYgKHVzZXJEYXRhKSB7XG4gICAgICB0aGlzLl9zYW5pdGl6ZUF1dGhEYXRhKHVzZXJEYXRhKTtcbiAgICAgIC8vIEdldCBmaWxlcyBhdHRhY2hlZCB0byB1c2VyXG4gICAgICBhd2FpdCByZXEuY29uZmlnLmZpbGVzQ29udHJvbGxlci5leHBhbmRGaWxlc0luT2JqZWN0KHJlcS5jb25maWcsIHVzZXJEYXRhKTtcblxuICAgICAgY29uc3QgdXNlciA9IGluZmxhdGUoJ19Vc2VyJywgdXNlckRhdGEpO1xuXG4gICAgICBhd2FpdCBtYXliZVJ1blRyaWdnZXIoXG4gICAgICAgIFRyaWdnZXJUeXBlcy5iZWZvcmVQYXNzd29yZFJlc2V0UmVxdWVzdCxcbiAgICAgICAgcmVxLmF1dGgsXG4gICAgICAgIHVzZXIsXG4gICAgICAgIG51bGwsXG4gICAgICAgIHJlcS5jb25maWcsXG4gICAgICAgIHJlcS5pbmZvLmNvbnRleHRcbiAgICAgICk7XG4gICAgfVxuXG4gICAgY29uc3QgdXNlckNvbnRyb2xsZXIgPSByZXEuY29uZmlnLnVzZXJDb250cm9sbGVyO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB1c2VyQ29udHJvbGxlci5zZW5kUGFzc3dvcmRSZXNldEVtYWlsKGVtYWlsKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHJlc3BvbnNlOiB7fSxcbiAgICAgIH07XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyLmNvZGUgPT09IFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQpIHtcbiAgICAgICAgaWYgKHJlcS5jb25maWcucGFzc3dvcmRQb2xpY3k/LnJlc2V0UGFzc3dvcmRTdWNjZXNzT25JbnZhbGlkRW1haWwgPz8gdHJ1ZSkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICByZXNwb25zZToge30sXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBlcnIubWVzc2FnZSA9IGBBIHVzZXIgd2l0aCB0aGF0IGVtYWlsIGRvZXMgbm90IGV4aXN0LmA7XG4gICAgICB9XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgaGFuZGxlVmVyaWZpY2F0aW9uRW1haWxSZXF1ZXN0KHJlcSkge1xuICAgIHRoaXMuX3Rocm93T25CYWRFbWFpbENvbmZpZyhyZXEpO1xuXG4gICAgY29uc3QgeyBlbWFpbCB9ID0gcmVxLmJvZHkgfHwge307XG4gICAgaWYgKCFlbWFpbCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkVNQUlMX01JU1NJTkcsICd5b3UgbXVzdCBwcm92aWRlIGFuIGVtYWlsJyk7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgZW1haWwgIT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfRU1BSUxfQUREUkVTUyxcbiAgICAgICAgJ3lvdSBtdXN0IHByb3ZpZGUgYSB2YWxpZCBlbWFpbCBzdHJpbmcnXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IHZlcmlmeUVtYWlsU3VjY2Vzc09uSW52YWxpZEVtYWlsID0gcmVxLmNvbmZpZy5lbWFpbFZlcmlmeVN1Y2Nlc3NPbkludmFsaWRFbWFpbCA/PyB0cnVlO1xuXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHJlcS5jb25maWcuZGF0YWJhc2UuZmluZCgnX1VzZXInLCB7IGVtYWlsOiBlbWFpbCB9LCB7fSwgQXV0aC5tYWludGVuYW5jZShyZXEuY29uZmlnKSk7XG4gICAgaWYgKCFyZXN1bHRzLmxlbmd0aCB8fCByZXN1bHRzLmxlbmd0aCA8IDEpIHtcbiAgICAgIGlmICh2ZXJpZnlFbWFpbFN1Y2Nlc3NPbkludmFsaWRFbWFpbCkge1xuICAgICAgICByZXR1cm4geyByZXNwb25zZToge30gfTtcbiAgICAgIH1cbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5FTUFJTF9OT1RfRk9VTkQsIGBObyB1c2VyIGZvdW5kIHdpdGggZW1haWwgJHtlbWFpbH1gKTtcbiAgICB9XG4gICAgY29uc3QgdXNlciA9IHJlc3VsdHNbMF07XG5cbiAgICAvLyByZW1vdmUgcGFzc3dvcmQgZmllbGQsIG1lc3NlcyB3aXRoIHNhdmluZyBvbiBwb3N0Z3Jlc1xuICAgIGRlbGV0ZSB1c2VyLnBhc3N3b3JkO1xuXG4gICAgaWYgKHVzZXIuZW1haWxWZXJpZmllZCkge1xuICAgICAgaWYgKHZlcmlmeUVtYWlsU3VjY2Vzc09uSW52YWxpZEVtYWlsKSB7XG4gICAgICAgIHJldHVybiB7IHJlc3BvbnNlOiB7fSB9O1xuICAgICAgfVxuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9USEVSX0NBVVNFLCBgRW1haWwgJHtlbWFpbH0gaXMgYWxyZWFkeSB2ZXJpZmllZC5gKTtcbiAgICB9XG5cbiAgICBjb25zdCB1c2VyQ29udHJvbGxlciA9IHJlcS5jb25maWcudXNlckNvbnRyb2xsZXI7XG4gICAgY29uc3Qgc2VuZCA9IGF3YWl0IHVzZXJDb250cm9sbGVyLnJlZ2VuZXJhdGVFbWFpbFZlcmlmeVRva2VuKHVzZXIsIHJlcS5hdXRoLmlzTWFzdGVyLCByZXEuYXV0aC5pbnN0YWxsYXRpb25JZCwgcmVxLmlwKTtcbiAgICBpZiAoc2VuZCkge1xuICAgICAgdXNlckNvbnRyb2xsZXIuc2VuZFZlcmlmaWNhdGlvbkVtYWlsKHVzZXIsIHJlcSk7XG4gICAgfVxuICAgIHJldHVybiB7IHJlc3BvbnNlOiB7fSB9O1xuICB9XG5cbiAgYXN5bmMgaGFuZGxlQ2hhbGxlbmdlKHJlcSkge1xuICAgIGNvbnN0IHsgdXNlcm5hbWUsIGVtYWlsLCBwYXNzd29yZCwgYXV0aERhdGEsIGNoYWxsZW5nZURhdGEgfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG4gICAgLy8gaWYgdXNlcm5hbWUgb3IgZW1haWwgcHJvdmlkZWQgd2l0aCBwYXNzd29yZCB0cnkgdG8gYXV0aGVudGljYXRlIHRoZSB1c2VyIGJ5IHVzZXJuYW1lXG4gICAgbGV0IHVzZXI7XG4gICAgaWYgKHVzZXJuYW1lIHx8IGVtYWlsKSB7XG4gICAgICBpZiAoIXBhc3N3b3JkKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5PVEhFUl9DQVVTRSxcbiAgICAgICAgICAnWW91IHByb3ZpZGVkIHVzZXJuYW1lIG9yIGVtYWlsLCB5b3UgbmVlZCB0byBhbHNvIHByb3ZpZGUgcGFzc3dvcmQuJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgICAgdXNlciA9IGF3YWl0IHRoaXMuX2F1dGhlbnRpY2F0ZVVzZXJGcm9tUmVxdWVzdChyZXEpO1xuICAgIH1cblxuICAgIGlmICghY2hhbGxlbmdlRGF0YSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9USEVSX0NBVVNFLCAnTm90aGluZyB0byBjaGFsbGVuZ2UuJyk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBjaGFsbGVuZ2VEYXRhICE9PSAnb2JqZWN0Jykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9USEVSX0NBVVNFLCAnY2hhbGxlbmdlRGF0YSBzaG91bGQgYmUgYW4gb2JqZWN0LicpO1xuICAgIH1cblxuICAgIGxldCByZXF1ZXN0O1xuICAgIGxldCBwYXJzZVVzZXI7XG5cbiAgICAvLyBUcnkgdG8gZmluZCB1c2VyIGJ5IGF1dGhEYXRhXG4gICAgaWYgKGF1dGhEYXRhKSB7XG4gICAgICBpZiAodHlwZW9mIGF1dGhEYXRhICE9PSAnb2JqZWN0Jykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1RIRVJfQ0FVU0UsICdhdXRoRGF0YSBzaG91bGQgYmUgYW4gb2JqZWN0LicpO1xuICAgICAgfVxuICAgICAgaWYgKHVzZXIpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLk9USEVSX0NBVVNFLFxuICAgICAgICAgICdZb3UgY2Fubm90IHByb3ZpZGUgdXNlcm5hbWUvZW1haWwgYW5kIGF1dGhEYXRhLCBvbmx5IHVzZSBvbmUgaWRlbnRpZmljYXRpb24gbWV0aG9kLidcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoYXV0aERhdGEpKSB7XG4gICAgICAgIGlmIChhdXRoRGF0YVtrZXldICE9PSBudWxsICYmICh0eXBlb2YgYXV0aERhdGFba2V5XSAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShhdXRoRGF0YVtrZXldKSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5PVEhFUl9DQVVTRSxcbiAgICAgICAgICAgIGBhdXRoRGF0YS4ke2tleX0gc2hvdWxkIGJlIGFuIG9iamVjdC5gXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoYXV0aERhdGEpLmZpbHRlcihrZXkgPT4gYXV0aERhdGFba2V5XSAmJiBhdXRoRGF0YVtrZXldLmlkKS5sZW5ndGggPiAxKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5PVEhFUl9DQVVTRSxcbiAgICAgICAgICAnWW91IGNhbm5vdCBwcm92aWRlIG1vcmUgdGhhbiBvbmUgYXV0aERhdGEgcHJvdmlkZXIgd2l0aCBhbiBpZC4nXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBBdXRoLmZpbmRVc2Vyc1dpdGhBdXRoRGF0YShyZXEuY29uZmlnLCBhdXRoRGF0YSk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghcmVzdWx0c1swXSB8fCByZXN1bHRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ1VzZXIgbm90IGZvdW5kLicpO1xuICAgICAgICB9XG4gICAgICAgIC8vIEZpbmQgdGhlIHByb3ZpZGVyIHVzZWQgdG8gZmluZCB0aGUgdXNlclxuICAgICAgICBjb25zdCBwcm92aWRlciA9IE9iamVjdC5rZXlzKGF1dGhEYXRhKS5maW5kKGtleSA9PiBhdXRoRGF0YVtrZXldICYmIGF1dGhEYXRhW2tleV0uaWQpO1xuXG4gICAgICAgIHBhcnNlVXNlciA9IFBhcnNlLlVzZXIuZnJvbUpTT04oeyBjbGFzc05hbWU6ICdfVXNlcicsIC4uLnJlc3VsdHNbMF0gfSk7XG4gICAgICAgIHJlcXVlc3QgPSBnZXRSZXF1ZXN0T2JqZWN0KHVuZGVmaW5lZCwgcmVxLmF1dGgsIHBhcnNlVXNlciwgcGFyc2VVc2VyLCByZXEuY29uZmlnKTtcbiAgICAgICAgcmVxdWVzdC5pc0NoYWxsZW5nZSA9IHRydWU7XG4gICAgICAgIC8vIFZhbGlkYXRlIGF1dGhEYXRhIHVzZWQgdG8gaWRlbnRpZnkgdGhlIHVzZXIgdG8gYXZvaWQgYnJ1dGUtZm9yY2UgYXR0YWNrIG9uIGBpZGBcbiAgICAgICAgY29uc3QgeyB2YWxpZGF0b3IgfSA9IHJlcS5jb25maWcuYXV0aERhdGFNYW5hZ2VyLmdldFZhbGlkYXRvckZvclByb3ZpZGVyKHByb3ZpZGVyKTtcbiAgICAgICAgY29uc3QgdmFsaWRhdG9yUmVzcG9uc2UgPSBhd2FpdCB2YWxpZGF0b3IoYXV0aERhdGFbcHJvdmlkZXJdLCByZXEsIHBhcnNlVXNlciwgcmVxdWVzdCk7XG4gICAgICAgIGlmICh2YWxpZGF0b3JSZXNwb25zZSAmJiB2YWxpZGF0b3JSZXNwb25zZS52YWxpZGF0b3IpIHtcbiAgICAgICAgICBhd2FpdCB2YWxpZGF0b3JSZXNwb25zZS52YWxpZGF0b3IoKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBSZXdyaXRlIHRoZSBlcnJvciB0byBhdm9pZCBndWVzcyBpZCBhdHRhY2tcbiAgICAgICAgbG9nZ2VyLmVycm9yKGUpO1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ1VzZXIgbm90IGZvdW5kLicpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghcGFyc2VVc2VyKSB7XG4gICAgICBwYXJzZVVzZXIgPSB1c2VyID8gUGFyc2UuVXNlci5mcm9tSlNPTih7IGNsYXNzTmFtZTogJ19Vc2VyJywgLi4udXNlciB9KSA6IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBpZiAoIXJlcXVlc3QpIHtcbiAgICAgIHJlcXVlc3QgPSBnZXRSZXF1ZXN0T2JqZWN0KHVuZGVmaW5lZCwgcmVxLmF1dGgsIHBhcnNlVXNlciwgcGFyc2VVc2VyLCByZXEuY29uZmlnKTtcbiAgICAgIHJlcXVlc3QuaXNDaGFsbGVuZ2UgPSB0cnVlO1xuICAgIH1cbiAgICBjb25zdCBhY2MgPSB7fTtcbiAgICAvLyBFeGVjdXRlIGNoYWxsZW5nZSBzdGVwLWJ5LXN0ZXAgd2l0aCBjb25zaXN0ZW50IG9yZGVyIGZvciBiZXR0ZXIgZXJyb3IgZmVlZGJhY2tcbiAgICAvLyBhbmQgdG8gYXZvaWQgdG8gdHJpZ2dlciBvdGhlcnMgY2hhbGxlbmdlcyBpZiBvbmUgb2YgdGhlbSBmYWlsc1xuICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgT2JqZWN0LmtleXMoY2hhbGxlbmdlRGF0YSkuc29ydCgpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBhdXRoQWRhcHRlciA9IHJlcS5jb25maWcuYXV0aERhdGFNYW5hZ2VyLmdldFZhbGlkYXRvckZvclByb3ZpZGVyKHByb3ZpZGVyKTtcbiAgICAgICAgaWYgKCFhdXRoQWRhcHRlcikge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHtcbiAgICAgICAgICBhZGFwdGVyOiB7IGNoYWxsZW5nZSB9LFxuICAgICAgICB9ID0gYXV0aEFkYXB0ZXI7XG4gICAgICAgIGlmICh0eXBlb2YgY2hhbGxlbmdlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgY29uc3QgcHJvdmlkZXJDaGFsbGVuZ2VSZXNwb25zZSA9IGF3YWl0IGNoYWxsZW5nZShcbiAgICAgICAgICAgIGNoYWxsZW5nZURhdGFbcHJvdmlkZXJdLFxuICAgICAgICAgICAgYXV0aERhdGEgJiYgYXV0aERhdGFbcHJvdmlkZXJdLFxuICAgICAgICAgICAgcmVxLmNvbmZpZy5hdXRoW3Byb3ZpZGVyXSxcbiAgICAgICAgICAgIHJlcXVlc3RcbiAgICAgICAgICApO1xuICAgICAgICAgIGFjY1twcm92aWRlcl0gPSBwcm92aWRlckNoYWxsZW5nZVJlc3BvbnNlIHx8IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zdCBlID0gcmVzb2x2ZUVycm9yKGVyciwge1xuICAgICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLlNDUklQVF9GQUlMRUQsXG4gICAgICAgICAgbWVzc2FnZTogJ0NoYWxsZW5nZSBmYWlsZWQuIFVua25vd24gZXJyb3IuJyxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHVzZXJTdHJpbmcgPSByZXEuYXV0aCAmJiByZXEuYXV0aC51c2VyID8gcmVxLmF1dGgudXNlci5pZCA6IHVuZGVmaW5lZDtcbiAgICAgICAgbG9nZ2VyLmVycm9yKFxuICAgICAgICAgIGBGYWlsZWQgcnVubmluZyBhdXRoIHN0ZXAgY2hhbGxlbmdlIGZvciAke3Byb3ZpZGVyfSBmb3IgdXNlciAke3VzZXJTdHJpbmd9IHdpdGggRXJyb3I6IGAgK1xuICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZSksXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXV0aGVudGljYXRpb25TdGVwOiAnY2hhbGxlbmdlJyxcbiAgICAgICAgICAgIGVycm9yOiBlLFxuICAgICAgICAgICAgdXNlcjogdXNlclN0cmluZyxcbiAgICAgICAgICAgIHByb3ZpZGVyLFxuICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICAgICAgdGhyb3cgZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgcmVzcG9uc2U6IHsgY2hhbGxlbmdlRGF0YTogYWNjIH0gfTtcbiAgfVxuXG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0dFVCcsICcvdXNlcnMnLCByZXEgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlRmluZChyZXEpO1xuICAgIH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL3VzZXJzJywgcHJvbWlzZUVuc3VyZUlkZW1wb3RlbmN5LCByZXEgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlQ3JlYXRlKHJlcSk7XG4gICAgfSk7XG4gICAgdGhpcy5yb3V0ZSgnR0VUJywgJy91c2Vycy9tZScsIHJlcSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVNZShyZXEpO1xuICAgIH0pO1xuICAgIHRoaXMucm91dGUoJ0dFVCcsICcvdXNlcnMvOm9iamVjdElkJywgcmVxID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUdldChyZXEpO1xuICAgIH0pO1xuICAgIHRoaXMucm91dGUoJ1BVVCcsICcvdXNlcnMvOm9iamVjdElkJywgcHJvbWlzZUVuc3VyZUlkZW1wb3RlbmN5LCByZXEgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlVXBkYXRlKHJlcSk7XG4gICAgfSk7XG4gICAgdGhpcy5yb3V0ZSgnREVMRVRFJywgJy91c2Vycy86b2JqZWN0SWQnLCByZXEgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlRGVsZXRlKHJlcSk7XG4gICAgfSk7XG4gICAgdGhpcy5yb3V0ZSgnR0VUJywgJy9sb2dpbicsIHJlcSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVMb2dJbihyZXEpO1xuICAgIH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL2xvZ2luJywgcmVxID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUxvZ0luKHJlcSk7XG4gICAgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUE9TVCcsICcvbG9naW5BcycsIHJlcSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVMb2dJbkFzKHJlcSk7XG4gICAgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUE9TVCcsICcvbG9nb3V0JywgcmVxID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUxvZ091dChyZXEpO1xuICAgIH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL3JlcXVlc3RQYXNzd29yZFJlc2V0JywgcmVxID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc2V0UmVxdWVzdChyZXEpO1xuICAgIH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL3ZlcmlmaWNhdGlvbkVtYWlsUmVxdWVzdCcsIHJlcSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVWZXJpZmljYXRpb25FbWFpbFJlcXVlc3QocmVxKTtcbiAgICB9KTtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCAnL3ZlcmlmeVBhc3N3b3JkJywgcmVxID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZVZlcmlmeVBhc3N3b3JkKHJlcSk7XG4gICAgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUE9TVCcsICcvdmVyaWZ5UGFzc3dvcmQnLCByZXEgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlVmVyaWZ5UGFzc3dvcmQocmVxKTtcbiAgICB9KTtcbiAgICB0aGlzLnJvdXRlKCdQT1NUJywgJy9jaGFsbGVuZ2UnLCByZXEgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlQ2hhbGxlbmdlKHJlcSk7XG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgVXNlcnNSb3V0ZXI7XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUVBLElBQUFBLEtBQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLE9BQUEsR0FBQUYsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFFLGVBQUEsR0FBQUgsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFHLGNBQUEsR0FBQUosc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFJLEtBQUEsR0FBQUwsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFLLEtBQUEsR0FBQU4sc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFNLFNBQUEsR0FBQVAsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFPLFNBQUEsR0FBQVAsT0FBQTtBQU9BLElBQUFRLFlBQUEsR0FBQVIsT0FBQTtBQUNBLElBQUFTLFVBQUEsR0FBQVYsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFVLE9BQUEsR0FBQVYsT0FBQTtBQUNBLElBQUFXLE1BQUEsR0FBQVgsT0FBQTtBQUNBLElBQUFZLGFBQUEsR0FBQVosT0FBQTtBQUE4RCxTQUFBRCx1QkFBQWMsQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FBQUMsVUFBQSxHQUFBRCxDQUFBLEtBQUFFLE9BQUEsRUFBQUYsQ0FBQTtBQXBCOUQ7O0FBc0JPLE1BQU1HLFdBQVcsU0FBU0Msc0JBQWEsQ0FBQztFQUM3Q0MsU0FBU0EsQ0FBQSxFQUFHO0lBQ1YsT0FBTyxPQUFPO0VBQ2hCOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0VBQ0UsT0FBT0Msc0JBQXNCQSxDQUFDQyxHQUFHLEVBQUU7SUFDakMsS0FBSyxJQUFJQyxHQUFHLElBQUlELEdBQUcsRUFBRTtN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