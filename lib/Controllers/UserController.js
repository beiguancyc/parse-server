"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.UserController = void 0;
var _cryptoUtils = require("../cryptoUtils");
var _triggers = require("../triggers");
var _AdaptableController = _interopRequireDefault(require("./AdaptableController"));
var _MailAdapter = _interopRequireDefault(require("../Adapters/Email/MailAdapter"));
var _rest = _interopRequireDefault(require("../rest"));
var _node = _interopRequireDefault(require("parse/node"));
var _AccountLockout = _interopRequireDefault(require("../AccountLockout"));
var _Config = _interopRequireDefault(require("../Config"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var RestQuery = require('../RestQuery');
var Auth = require('../Auth');
class UserController extends _AdaptableController.default {
  constructor(adapter, appId, options = {}) {
    super(adapter, appId, options);
  }
  get config() {
    return _Config.default.get(this.appId);
  }
  validateAdapter(adapter) {
    // Allow no adapter
    if (!adapter && !this.shouldVerifyEmails) {
      return;
    }
    super.validateAdapter(adapter);
  }
  expectedAdapterType() {
    return _MailAdapter.default;
  }
  get shouldVerifyEmails() {
    return (this.config || this.options).verifyUserEmails;
  }
  async setEmailVerifyToken(user, req, storage = {}) {
    const shouldSendEmail = this.shouldVerifyEmails === true || typeof this.shouldVerifyEmails === 'function' && (await Promise.resolve(this.shouldVerifyEmails(req))) === true;
    if (!shouldSendEmail) {
      return false;
    }
    storage.sendVerificationEmail = true;
    user._email_verify_token = (0, _cryptoUtils.randomString)(25);
    if (!storage.fieldsChangedByTrigger || !storage.fieldsChangedByTrigger.includes('emailVerified')) {
      user.emailVerified = false;
    }
    if (this.config.emailVerifyTokenValidityDuration) {
      user._email_verify_token_expires_at = _node.default._encode(this.config.generateEmailVerifyTokenExpiresAt());
    }
    return true;
  }
  async verifyEmail(token) {
    if (!this.shouldVerifyEmails) {
      // Trying to verify email when not enabled
      // TODO: Better error here.
      throw undefined;
    }
    const query = {
      _email_verify_token: token
    };
    const updateFields = {
      emailVerified: true,
      _email_verify_token: {
        __op: 'Delete'
      }
    };

    // if the email verify token needs to be validated then
    // add additional query params and additional fields that need to be updated
    if (this.config.emailVerifyTokenValidityDuration) {
      query.emailVerified = false;
      query._email_verify_token_expires_at = {
        $gt: _node.default._encode(new Date())
      };
      updateFields._email_verify_token_expires_at = {
        __op: 'Delete'
      };
    }
    const maintenanceAuth = Auth.maintenance(this.config);
    const restQuery = await RestQuery({
      method: RestQuery.Method.get,
      config: this.config,
      auth: maintenanceAuth,
      className: '_User',
      restWhere: query
    });
    const result = await restQuery.execute();
    if (result.results.length) {
      query.objectId = result.results[0].objectId;
    }
    return await _rest.default.update(this.config, maintenanceAuth, '_User', query, updateFields);
  }
  async checkResetTokenValidity(token) {
    const results = await this.config.database.find('_User', {
      _perishable_token: token
    }, {
      limit: 1
    }, Auth.maintenance(this.config));
    if (results.length !== 1) {
      throw 'Failed to reset password: username / email / token is invalid';
    }
    if (this.config.passwordPolicy && this.config.passwordPolicy.resetTokenValidityDuration) {
      let expiresDate = results[0]._perishable_token_expires_at;
      if (expiresDate && expiresDate.__type == 'Date') {
        expiresDate = new Date(expiresDate.iso);
      }
      if (expiresDate < new Date()) {
        throw 'The password reset link has expired';
      }
    }
    return results[0];
  }
  async getUserIfNeeded(user) {
    var where = {};
    if (user.username) {
      where.username = user.username;
    }
    if (user.email) {
      where.email = user.email;
    }
    if (user._email_verify_token) {
      where._email_verify_token = user._email_verify_token;
    }
    var query = await RestQuery({
      method: RestQuery.Method.get,
      config: this.config,
      runBeforeFind: false,
      auth: Auth.master(this.config),
      className: '_User',
      restWhere: where
    });
    const result = await query.execute();
    if (result.results.length != 1) {
      throw undefined;
    }
    return result.results[0];
  }
  async sendVerificationEmail(user, req) {
    if (!this.shouldVerifyEmails) {
      return;
    }
    const token = encodeURIComponent(user._email_verify_token);
    // We may need to fetch the user in case of update email; only use the `fetchedUser`
    // from this point onwards; do not use the `user` as it may not contain all fields.
    const fetchedUser = await this.getUserIfNeeded(user);
    let shouldSendEmail = this.config.sendUserEmailVerification;
    if (typeof shouldSendEmail === 'function') {
      const response = await Promise.resolve(this.config.sendUserEmailVerification({
        user: _node.default.Object.fromJSON({
          className: '_User',
          ...fetchedUser
        }),
        master: req.auth?.isMaster
      }));
      shouldSendEmail = !!response;
    }
    if (!shouldSendEmail) {
      return;
    }
    const link = buildEmailLink(this.config.verifyEmailURL, token, this.config);
    const options = {
      appName: this.config.appName,
      link: link,
      user: (0, _triggers.inflate)('_User', fetchedUser)
    };
    if (this.adapter.sendVerificationEmail) {
      this.adapter.sendVerificationEmail(options);
    } else {
      this.adapter.sendMail(this.defaultVerificationEmail(options));
    }
  }

  /**
   * Regenerates the given user's email verification token
   *
   * @param user
   * @returns {*}
   */
  async regenerateEmailVerifyToken(user, master, installationId, ip) {
    const {
      _email_verify_token
    } = user;
    let {
      _email_verify_token_expires_at
    } = user;
    if (_email_verify_token_expires_at && _email_verify_token_expires_at.__type === 'Date') {
      _email_verify_token_expires_at = _email_verify_token_expires_at.iso;
    }
    if (this.config.emailVerifyTokenReuseIfValid && this.config.emailVerifyTokenValidityDuration && _email_verify_token && new Date() < new Date(_email_verify_token_expires_at)) {
      return Promise.resolve(true);
    }
    const shouldSend = await this.setEmailVerifyToken(user, {
      object: _node.default.User.fromJSON(Object.assign({
        className: '_User'
      }, user)),
      master,
      installationId,
      ip,
      resendRequest: true
    });
    if (!shouldSend) {
      return;
    }
    return this.config.database.update('_User', {
      username: user.username
    }, user);
  }
  async resendVerificationEmail(username, req, token) {
    const aUser = await this.getUserIfNeeded({
      username,
      _email_verify_token: token
    });
    if (!aUser || aUser.emailVerified) {
      throw undefined;
    }
    const generate = await this.regenerateEmailVerifyToken(aUser, req.auth?.isMaster, req.auth?.installationId, req.ip);
    if (generate) {
      this.sendVerificationEmail(aUser, req);
    }
  }
  setPasswordResetToken(email) {
    const token = {
      _perishable_token: (0, _cryptoUtils.randomString)(25)
    };
    if (this.config.passwordPolicy && this.config.passwordPolicy.resetTokenValidityDuration) {
      token._perishable_token_expires_at = _node.default._encode(this.config.generatePasswordResetTokenExpiresAt());
    }
    return this.config.database.update('_User', {
      $or: [{
        email
      }, {
        username: email,
        email: {
          $exists: false
        }
      }]
    }, token, {}, true);
  }
  async sendPasswordResetEmail(email) {
    if (!this.adapter) {
      throw 'Trying to send a reset password but no adapter is set';
      //  TODO: No adapter?
    }
    let user;
    if (this.config.passwordPolicy && this.config.passwordPolicy.resetTokenReuseIfValid && this.config.passwordPolicy.resetTokenValidityDuration) {
      const results = await this.config.database.find('_User', {
        $or: [{
          email,
          _perishable_token: {
            $exists: true
          }
        }, {
          username: email,
          email: {
            $exists: false
          },
          _perishable_token: {
            $exists: true
          }
        }]
      }, {
        limit: 1
      }, Auth.maintenance(this.config));
      if (results.length == 1) {
        let expiresDate = results[0]._perishable_token_expires_at;
        if (expiresDate && expiresDate.__type == 'Date') {
          expiresDate = new Date(expiresDate.iso);
        }
        if (expiresDate > new Date()) {
          user = results[0];
        }
      }
    }
    if (!user || !user._perishable_token) {
      user = await this.setPasswordResetToken(email);
    }
    const token = encodeURIComponent(user._perishable_token);
    const link = buildEmailLink(this.config.requestResetPasswordURL, token, this.config);
    const options = {
      appName: this.config.appName,
      link: link,
      user: (0, _triggers.inflate)('_User', user)
    };
    if (this.adapter.sendPasswordResetEmail) {
      this.adapter.sendPasswordResetEmail(options);
    } else {
      this.adapter.sendMail(this.defaultResetPasswordEmail(options));
    }
    return Promise.resolve(user);
  }
  async updatePassword(token, password) {
    try {
      const rawUser = await this.checkResetTokenValidity(token);
      let user;
      try {
        user = await updateUserPassword(rawUser, password, this.config);
      } catch (error) {
        if (error && error.code === _node.default.Error.OBJECT_NOT_FOUND) {
          throw 'Failed to reset password: username / email / token is invalid';
        }
        throw error;
      }
      const accountLockoutPolicy = new _AccountLockout.default(user, this.config);
      return await accountLockoutPolicy.unlockAccount();
    } catch (error) {
      if (error && error.message) {
        // in case of Parse.Error, fail with the error message only
        return Promise.reject(error.message);
      }
      return Promise.reject(error);
    }
  }
  defaultVerificationEmail({
    link,
    user,
    appName
  }) {
    const text = 'Hi,\n\n' + 'You are being asked to confirm the e-mail address ' + user.get('email') + ' with ' + appName + '\n\n' + '' + 'Click here to confirm it:\n' + link;
    const to = user.get('email');
    const subject = 'Please verify your e-mail for ' + appName;
    return {
      text,
      to,
      subject
    };
  }
  defaultResetPasswordEmail({
    link,
    user,
    appName
  }) {
    const text = 'Hi,\n\n' + 'You requested to reset your password for ' + appName + (user.get('username') ? " (your username is '" + user.get('username') + "')" : '') + '.\n\n' + '' + 'Click here to reset it:\n' + link;
    const to = user.get('email') || user.get('username');
    const subject = 'Password Reset for ' + appName;
    return {
      text,
      to,
      subject
    };
  }
}

// Mark this private
exports.UserController = UserController;
function updateUserPassword(user, password, config) {
  return _rest.default.update(config, Auth.master(config), '_User', {
    objectId: user.objectId,
    _perishable_token: user._perishable_token
  }, {
    password: password
  }).then(() => user);
}
function buildEmailLink(destination, token, config) {
  token = `token=${token}`;
  if (config.parseFrameURL) {
    const destinationWithoutHost = destination.replace(config.publicServerURL, '');
    return `${config.parseFrameURL}?link=${encodeURIComponent(destinationWithoutHost)}&${token}`;
  } else {
    return `${destination}?${token}`;
  }
}
var _default = exports.default = UserController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfY3J5cHRvVXRpbHMiLCJyZXF1aXJlIiwiX3RyaWdnZXJzIiwiX0FkYXB0YWJsZUNvbnRyb2xsZXIiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwiX01haWxBZGFwdGVyIiwiX3Jlc3QiLCJfbm9kZSIsIl9BY2NvdW50TG9ja291dCIsIl9Db25maWciLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJSZXN0UXVlcnkiLCJBdXRoIiwiVXNlckNvbnRyb2xsZXIiLCJBZGFwdGFibGVDb250cm9sbGVyIiwiY29uc3RydWN0b3IiLCJhZGFwdGVyIiwiYXBwSWQiLCJvcHRpb25zIiwiY29uZmlnIiwiQ29uZmlnIiwiZ2V0IiwidmFsaWRhdGVBZGFwdGVyIiwic2hvdWxkVmVyaWZ5RW1haWxzIiwiZXhwZWN0ZWRBZGFwdGVyVHlwZSIsIk1haWxBZGFwdGVyIiwidmVyaWZ5VXNlckVtYWlscyIsInNldEVtYWlsVmVyaWZ5VG9rZW4iLCJ1c2VyIiwicmVxIiwic3RvcmFnZSIsInNob3VsZFNlbmRFbWFpbCIsIlByb21pc2UiLCJyZXNvbHZlIiwic2VuZFZlcmlmaWNhdGlvbkVtYWlsIiwiX2VtYWlsX3ZlcmlmeV90b2tlbiIsInJhbmRvbVN0cmluZyIsImZpZWxkc0NoYW5nZWRCeVRyaWdnZXIiLCJpbmNsdWRlcyIsImVtYWlsVmVyaWZpZWQiLCJlbWFpbFZlcmlmeVRva2VuVmFsaWRpdHlEdXJhdGlvbiIsIl9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCIsIlBhcnNlIiwiX2VuY29kZSIsImdlbmVyYXRlRW1haWxWZXJpZnlUb2tlbkV4cGlyZXNBdCIsInZlcmlmeUVtYWlsIiwidG9rZW4iLCJ1bmRlZmluZWQiLCJxdWVyeSIsInVwZGF0ZUZpZWxkcyIsIl9fb3AiLCIkZ3QiLCJEYXRlIiwibWFpbnRlbmFuY2VBdXRoIiwibWFpbnRlbmFuY2UiLCJyZXN0UXVlcnkiLCJtZXRob2QiLCJNZXRob2QiLCJhdXRoIiwiY2xhc3NOYW1lIiwicmVzdFdoZXJlIiwicmVzdWx0IiwiZXhlY3V0ZSIsInJlc3VsdHMiLCJsZW5ndGgiLCJvYmplY3RJZCIsInJlc3QiLCJ1cGRhdGUiLCJjaGVja1Jlc2V0VG9rZW5WYWxpZGl0eSIsImRhdGFiYXNlIiwiZmluZCIsIl9wZXJpc2hhYmxlX3Rva2VuIiwibGltaXQiLCJwYXNzd29yZFBvbGljeSIsInJlc2V0VG9rZW5WYWxpZGl0eUR1cmF0aW9uIiwiZXhwaXJlc0RhdGUiLCJfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0IiwiX190eXBlIiwiaXNvIiwiZ2V0VXNlcklmTmVlZGVkIiwid2hlcmUiLCJ1c2VybmFtZSIsImVtYWlsIiwicnVuQmVmb3JlRmluZCIsIm1hc3RlciIsImVuY29kZVVSSUNvbXBvbmVudCIsImZldGNoZWRVc2VyIiwic2VuZFVzZXJFbWFpbFZlcmlmaWNhdGlvbiIsInJlc3BvbnNlIiwiT2JqZWN0IiwiZnJvbUpTT04iLCJpc01hc3RlciIsImxpbmsiLCJidWlsZEVtYWlsTGluayIsInZlcmlmeUVtYWlsVVJMIiwiYXBwTmFtZSIsImluZmxhdGUiLCJzZW5kTWFpbCIsImRlZmF1bHRWZXJpZmljYXRpb25FbWFpbCIsInJlZ2VuZXJhdGVFbWFpbFZlcmlmeVRva2VuIiwiaW5zdGFsbGF0aW9uSWQiLCJpcCIsImVtYWlsVmVyaWZ5VG9rZW5SZXVzZUlmVmFsaWQiLCJzaG91bGRTZW5kIiwib2JqZWN0IiwiVXNlciIsImFzc2lnbiIsInJlc2VuZFJlcXVlc3QiLCJyZXNlbmRWZXJpZmljYXRpb25FbWFpbCIsImFVc2VyIiwiZ2VuZXJhdGUiLCJzZXRQYXNzd29yZFJlc2V0VG9rZW4iLCJnZW5lcmF0ZVBhc3N3b3JkUmVzZXRUb2tlbkV4cGlyZXNBdCIsIiRvciIsIiRleGlzdHMiLCJzZW5kUGFzc3dvcmRSZXNldEVtYWlsIiwicmVzZXRUb2tlblJldXNlSWZWYWxpZCIsInJlcXVlc3RSZXNldFBhc3N3b3JkVVJMIiwiZGVmYXVsdFJlc2V0UGFzc3dvcmRFbWFpbCIsInVwZGF0ZVBhc3N3b3JkIiwicGFzc3dvcmQiLCJyYXdVc2VyIiwidXBkYXRlVXNlclBhc3N3b3JkIiwiZXJyb3IiLCJjb2RlIiwiRXJyb3IiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwiYWNjb3VudExvY2tvdXRQb2xpY3kiLCJBY2NvdW50TG9ja291dCIsInVubG9ja0FjY291bnQiLCJtZXNzYWdlIiwicmVqZWN0IiwidGV4dCIsInRvIiwic3ViamVjdCIsImV4cG9ydHMiLCJ0aGVuIiwiZGVzdGluYXRpb24iLCJwYXJzZUZyYW1lVVJMIiwiZGVzdGluYXRpb25XaXRob3V0SG9zdCIsInJlcGxhY2UiLCJwdWJsaWNTZXJ2ZXJVUkwiLCJfZGVmYXVsdCJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9Vc2VyQ29udHJvbGxlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyByYW5kb21TdHJpbmcgfSBmcm9tICcuLi9jcnlwdG9VdGlscyc7XG5pbXBvcnQgeyBpbmZsYXRlIH0gZnJvbSAnLi4vdHJpZ2dlcnMnO1xuaW1wb3J0IEFkYXB0YWJsZUNvbnRyb2xsZXIgZnJvbSAnLi9BZGFwdGFibGVDb250cm9sbGVyJztcbmltcG9ydCBNYWlsQWRhcHRlciBmcm9tICcuLi9BZGFwdGVycy9FbWFpbC9NYWlsQWRhcHRlcic7XG5pbXBvcnQgcmVzdCBmcm9tICcuLi9yZXN0JztcbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBBY2NvdW50TG9ja291dCBmcm9tICcuLi9BY2NvdW50TG9ja291dCc7XG5pbXBvcnQgQ29uZmlnIGZyb20gJy4uL0NvbmZpZyc7XG5cbnZhciBSZXN0UXVlcnkgPSByZXF1aXJlKCcuLi9SZXN0UXVlcnknKTtcbnZhciBBdXRoID0gcmVxdWlyZSgnLi4vQXV0aCcpO1xuXG5leHBvcnQgY2xhc3MgVXNlckNvbnRyb2xsZXIgZXh0ZW5kcyBBZGFwdGFibGVDb250cm9sbGVyIHtcbiAgY29uc3RydWN0b3IoYWRhcHRlciwgYXBwSWQsIG9wdGlvbnMgPSB7fSkge1xuICAgIHN1cGVyKGFkYXB0ZXIsIGFwcElkLCBvcHRpb25zKTtcbiAgfVxuXG4gIGdldCBjb25maWcoKSB7XG4gICAgcmV0dXJuIENvbmZpZy5nZXQodGhpcy5hcHBJZCk7XG4gIH1cblxuICB2YWxpZGF0ZUFkYXB0ZXIoYWRhcHRlcikge1xuICAgIC8vIEFsbG93IG5vIGFkYXB0ZXJcbiAgICBpZiAoIWFkYXB0ZXIgJiYgIXRoaXMuc2hvdWxkVmVyaWZ5RW1haWxzKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHN1cGVyLnZhbGlkYXRlQWRhcHRlcihhZGFwdGVyKTtcbiAgfVxuXG4gIGV4cGVjdGVkQWRhcHRlclR5cGUoKSB7XG4gICAgcmV0dXJuIE1haWxBZGFwdGVyO1xuICB9XG5cbiAgZ2V0IHNob3VsZFZlcmlmeUVtYWlscygpIHtcbiAgICByZXR1cm4gKHRoaXMuY29uZmlnIHx8IHRoaXMub3B0aW9ucykudmVyaWZ5VXNlckVtYWlscztcbiAgfVxuXG4gIGFzeW5jIHNldEVtYWlsVmVyaWZ5VG9rZW4odXNlciwgcmVxLCBzdG9yYWdlID0ge30pIHtcbiAgICBjb25zdCBzaG91bGRTZW5kRW1haWwgPVxuICAgICAgdGhpcy5zaG91bGRWZXJpZnlFbWFpbHMgPT09IHRydWUgfHxcbiAgICAgICh0eXBlb2YgdGhpcy5zaG91bGRWZXJpZnlFbWFpbHMgPT09ICdmdW5jdGlvbicgJiZcbiAgICAgICAgKGF3YWl0IFByb21pc2UucmVzb2x2ZSh0aGlzLnNob3VsZFZlcmlmeUVtYWlscyhyZXEpKSkgPT09IHRydWUpO1xuICAgIGlmICghc2hvdWxkU2VuZEVtYWlsKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHN0b3JhZ2Uuc2VuZFZlcmlmaWNhdGlvbkVtYWlsID0gdHJ1ZTtcbiAgICB1c2VyLl9lbWFpbF92ZXJpZnlfdG9rZW4gPSByYW5kb21TdHJpbmcoMjUpO1xuICAgIGlmIChcbiAgICAgICFzdG9yYWdlLmZpZWxkc0NoYW5nZWRCeVRyaWdnZXIgfHxcbiAgICAgICFzdG9yYWdlLmZpZWxkc0NoYW5nZWRCeVRyaWdnZXIuaW5jbHVkZXMoJ2VtYWlsVmVyaWZpZWQnKVxuICAgICkge1xuICAgICAgdXNlci5lbWFpbFZlcmlmaWVkID0gZmFsc2U7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29uZmlnLmVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uKSB7XG4gICAgICB1c2VyLl9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCA9IFBhcnNlLl9lbmNvZGUoXG4gICAgICAgIHRoaXMuY29uZmlnLmdlbmVyYXRlRW1haWxWZXJpZnlUb2tlbkV4cGlyZXNBdCgpXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGFzeW5jIHZlcmlmeUVtYWlsKHRva2VuKSB7XG4gICAgaWYgKCF0aGlzLnNob3VsZFZlcmlmeUVtYWlscykge1xuICAgICAgLy8gVHJ5aW5nIHRvIHZlcmlmeSBlbWFpbCB3aGVuIG5vdCBlbmFibGVkXG4gICAgICAvLyBUT0RPOiBCZXR0ZXIgZXJyb3IgaGVyZS5cbiAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeSA9IHsgX2VtYWlsX3ZlcmlmeV90b2tlbjogdG9rZW4gfTtcbiAgICBjb25zdCB1cGRhdGVGaWVsZHMgPSB7XG4gICAgICBlbWFpbFZlcmlmaWVkOiB0cnVlLFxuICAgICAgX2VtYWlsX3ZlcmlmeV90b2tlbjogeyBfX29wOiAnRGVsZXRlJyB9LFxuICAgIH07XG5cbiAgICAvLyBpZiB0aGUgZW1haWwgdmVyaWZ5IHRva2VuIG5lZWRzIHRvIGJlIHZhbGlkYXRlZCB0aGVuXG4gICAgLy8gYWRkIGFkZGl0aW9uYWwgcXVlcnkgcGFyYW1zIGFuZCBhZGRpdGlvbmFsIGZpZWxkcyB0aGF0IG5lZWQgdG8gYmUgdXBkYXRlZFxuICAgIGlmICh0aGlzLmNvbmZpZy5lbWFpbFZlcmlmeVRva2VuVmFsaWRpdHlEdXJhdGlvbikge1xuICAgICAgcXVlcnkuZW1haWxWZXJpZmllZCA9IGZhbHNlO1xuICAgICAgcXVlcnkuX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0ID0geyAkZ3Q6IFBhcnNlLl9lbmNvZGUobmV3IERhdGUoKSkgfTtcblxuICAgICAgdXBkYXRlRmllbGRzLl9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCA9IHsgX19vcDogJ0RlbGV0ZScgfTtcbiAgICB9XG4gICAgY29uc3QgbWFpbnRlbmFuY2VBdXRoID0gQXV0aC5tYWludGVuYW5jZSh0aGlzLmNvbmZpZyk7XG4gICAgY29uc3QgcmVzdFF1ZXJ5ID0gYXdhaXQgUmVzdFF1ZXJ5KHtcbiAgICAgIG1ldGhvZDogUmVzdFF1ZXJ5Lk1ldGhvZC5nZXQsXG4gICAgICBjb25maWc6IHRoaXMuY29uZmlnLFxuICAgICAgYXV0aDogbWFpbnRlbmFuY2VBdXRoLFxuICAgICAgY2xhc3NOYW1lOiAnX1VzZXInLFxuICAgICAgcmVzdFdoZXJlOiBxdWVyeSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3RRdWVyeS5leGVjdXRlKCk7XG4gICAgaWYgKHJlc3VsdC5yZXN1bHRzLmxlbmd0aCkge1xuICAgICAgcXVlcnkub2JqZWN0SWQgPSByZXN1bHQucmVzdWx0c1swXS5vYmplY3RJZDtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHJlc3QudXBkYXRlKHRoaXMuY29uZmlnLCBtYWludGVuYW5jZUF1dGgsICdfVXNlcicsIHF1ZXJ5LCB1cGRhdGVGaWVsZHMpO1xuICB9XG5cbiAgYXN5bmMgY2hlY2tSZXNldFRva2VuVmFsaWRpdHkodG9rZW4pIHtcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZChcbiAgICAgICdfVXNlcicsXG4gICAgICB7XG4gICAgICAgIF9wZXJpc2hhYmxlX3Rva2VuOiB0b2tlbixcbiAgICAgIH0sXG4gICAgICB7IGxpbWl0OiAxIH0sXG4gICAgICBBdXRoLm1haW50ZW5hbmNlKHRoaXMuY29uZmlnKVxuICAgICk7XG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9PSAxKSB7XG4gICAgICB0aHJvdyAnRmFpbGVkIHRvIHJlc2V0IHBhc3N3b3JkOiB1c2VybmFtZSAvIGVtYWlsIC8gdG9rZW4gaXMgaW52YWxpZCc7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5ICYmIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnJlc2V0VG9rZW5WYWxpZGl0eUR1cmF0aW9uKSB7XG4gICAgICBsZXQgZXhwaXJlc0RhdGUgPSByZXN1bHRzWzBdLl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQ7XG4gICAgICBpZiAoZXhwaXJlc0RhdGUgJiYgZXhwaXJlc0RhdGUuX190eXBlID09ICdEYXRlJykge1xuICAgICAgICBleHBpcmVzRGF0ZSA9IG5ldyBEYXRlKGV4cGlyZXNEYXRlLmlzbyk7XG4gICAgICB9XG4gICAgICBpZiAoZXhwaXJlc0RhdGUgPCBuZXcgRGF0ZSgpKSB7XG4gICAgICAgIHRocm93ICdUaGUgcGFzc3dvcmQgcmVzZXQgbGluayBoYXMgZXhwaXJlZCc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHNbMF07XG4gIH1cblxuICBhc3luYyBnZXRVc2VySWZOZWVkZWQodXNlcikge1xuICAgIHZhciB3aGVyZSA9IHt9O1xuICAgIGlmICh1c2VyLnVzZXJuYW1lKSB7XG4gICAgICB3aGVyZS51c2VybmFtZSA9IHVzZXIudXNlcm5hbWU7XG4gICAgfVxuICAgIGlmICh1c2VyLmVtYWlsKSB7XG4gICAgICB3aGVyZS5lbWFpbCA9IHVzZXIuZW1haWw7XG4gICAgfVxuICAgIGlmICh1c2VyLl9lbWFpbF92ZXJpZnlfdG9rZW4pIHtcbiAgICAgIHdoZXJlLl9lbWFpbF92ZXJpZnlfdG9rZW4gPSB1c2VyLl9lbWFpbF92ZXJpZnlfdG9rZW47XG4gICAgfVxuXG4gICAgdmFyIHF1ZXJ5ID0gYXdhaXQgUmVzdFF1ZXJ5KHtcbiAgICAgIG1ldGhvZDogUmVzdFF1ZXJ5Lk1ldGhvZC5nZXQsXG4gICAgICBjb25maWc6IHRoaXMuY29uZmlnLFxuICAgICAgcnVuQmVmb3JlRmluZDogZmFsc2UsXG4gICAgICBhdXRoOiBBdXRoLm1hc3Rlcih0aGlzLmNvbmZpZyksXG4gICAgICBjbGFzc05hbWU6ICdfVXNlcicsXG4gICAgICByZXN0V2hlcmU6IHdoZXJlLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKTtcbiAgICBpZiAocmVzdWx0LnJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdC5yZXN1bHRzWzBdO1xuICB9XG5cbiAgYXN5bmMgc2VuZFZlcmlmaWNhdGlvbkVtYWlsKHVzZXIsIHJlcSkge1xuICAgIGlmICghdGhpcy5zaG91bGRWZXJpZnlFbWFpbHMpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdG9rZW4gPSBlbmNvZGVVUklDb21wb25lbnQodXNlci5fZW1haWxfdmVyaWZ5X3Rva2VuKTtcbiAgICAvLyBXZSBtYXkgbmVlZCB0byBmZXRjaCB0aGUgdXNlciBpbiBjYXNlIG9mIHVwZGF0ZSBlbWFpbDsgb25seSB1c2UgdGhlIGBmZXRjaGVkVXNlcmBcbiAgICAvLyBmcm9tIHRoaXMgcG9pbnQgb253YXJkczsgZG8gbm90IHVzZSB0aGUgYHVzZXJgIGFzIGl0IG1heSBub3QgY29udGFpbiBhbGwgZmllbGRzLlxuICAgIGNvbnN0IGZldGNoZWRVc2VyID0gYXdhaXQgdGhpcy5nZXRVc2VySWZOZWVkZWQodXNlcik7XG4gICAgbGV0IHNob3VsZFNlbmRFbWFpbCA9IHRoaXMuY29uZmlnLnNlbmRVc2VyRW1haWxWZXJpZmljYXRpb247XG4gICAgaWYgKHR5cGVvZiBzaG91bGRTZW5kRW1haWwgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgUHJvbWlzZS5yZXNvbHZlKFxuICAgICAgICB0aGlzLmNvbmZpZy5zZW5kVXNlckVtYWlsVmVyaWZpY2F0aW9uKHtcbiAgICAgICAgICB1c2VyOiBQYXJzZS5PYmplY3QuZnJvbUpTT04oeyBjbGFzc05hbWU6ICdfVXNlcicsIC4uLmZldGNoZWRVc2VyIH0pLFxuICAgICAgICAgIG1hc3RlcjogcmVxLmF1dGg/LmlzTWFzdGVyLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICAgIHNob3VsZFNlbmRFbWFpbCA9ICEhcmVzcG9uc2U7XG4gICAgfVxuICAgIGlmICghc2hvdWxkU2VuZEVtYWlsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGxpbmsgPSBidWlsZEVtYWlsTGluayh0aGlzLmNvbmZpZy52ZXJpZnlFbWFpbFVSTCwgdG9rZW4sIHRoaXMuY29uZmlnKTtcbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgYXBwTmFtZTogdGhpcy5jb25maWcuYXBwTmFtZSxcbiAgICAgIGxpbms6IGxpbmssXG4gICAgICB1c2VyOiBpbmZsYXRlKCdfVXNlcicsIGZldGNoZWRVc2VyKSxcbiAgICB9O1xuICAgIGlmICh0aGlzLmFkYXB0ZXIuc2VuZFZlcmlmaWNhdGlvbkVtYWlsKSB7XG4gICAgICB0aGlzLmFkYXB0ZXIuc2VuZFZlcmlmaWNhdGlvbkVtYWlsKG9wdGlvbnMpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmFkYXB0ZXIuc2VuZE1haWwodGhpcy5kZWZhdWx0VmVyaWZpY2F0aW9uRW1haWwob3B0aW9ucykpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdlbmVyYXRlcyB0aGUgZ2l2ZW4gdXNlcidzIGVtYWlsIHZlcmlmaWNhdGlvbiB0b2tlblxuICAgKlxuICAgKiBAcGFyYW0gdXNlclxuICAgKiBAcmV0dXJucyB7Kn1cbiAgICovXG4gIGFzeW5jIHJlZ2VuZXJhdGVFbWFpbFZlcmlmeVRva2VuKHVzZXIsIG1hc3RlciwgaW5zdGFsbGF0aW9uSWQsIGlwKSB7XG4gICAgY29uc3QgeyBfZW1haWxfdmVyaWZ5X3Rva2VuIH0gPSB1c2VyO1xuICAgIGxldCB7IF9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCB9ID0gdXNlcjtcbiAgICBpZiAoX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0ICYmIF9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdC5fX3R5cGUgPT09ICdEYXRlJykge1xuICAgICAgX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0ID0gX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0LmlzbztcbiAgICB9XG4gICAgaWYgKFxuICAgICAgdGhpcy5jb25maWcuZW1haWxWZXJpZnlUb2tlblJldXNlSWZWYWxpZCAmJlxuICAgICAgdGhpcy5jb25maWcuZW1haWxWZXJpZnlUb2tlblZhbGlkaXR5RHVyYXRpb24gJiZcbiAgICAgIF9lbWFpbF92ZXJpZnlfdG9rZW4gJiZcbiAgICAgIG5ldyBEYXRlKCkgPCBuZXcgRGF0ZShfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQpXG4gICAgKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRydWUpO1xuICAgIH1cbiAgICBjb25zdCBzaG91bGRTZW5kID0gYXdhaXQgdGhpcy5zZXRFbWFpbFZlcmlmeVRva2VuKHVzZXIsIHtcbiAgICAgIG9iamVjdDogUGFyc2UuVXNlci5mcm9tSlNPTihPYmplY3QuYXNzaWduKHsgY2xhc3NOYW1lOiAnX1VzZXInIH0sIHVzZXIpKSxcbiAgICAgIG1hc3RlcixcbiAgICAgIGluc3RhbGxhdGlvbklkLFxuICAgICAgaXAsXG4gICAgICByZXNlbmRSZXF1ZXN0OiB0cnVlXG4gICAgfSk7XG4gICAgaWYgKCFzaG91bGRTZW5kKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS51cGRhdGUoJ19Vc2VyJywgeyB1c2VybmFtZTogdXNlci51c2VybmFtZSB9LCB1c2VyKTtcbiAgfVxuXG4gIGFzeW5jIHJlc2VuZFZlcmlmaWNhdGlvbkVtYWlsKHVzZXJuYW1lLCByZXEsIHRva2VuKSB7XG4gICAgY29uc3QgYVVzZXIgPSBhd2FpdCB0aGlzLmdldFVzZXJJZk5lZWRlZCh7IHVzZXJuYW1lLCBfZW1haWxfdmVyaWZ5X3Rva2VuOiB0b2tlbiB9KTtcbiAgICBpZiAoIWFVc2VyIHx8IGFVc2VyLmVtYWlsVmVyaWZpZWQpIHtcbiAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgY29uc3QgZ2VuZXJhdGUgPSBhd2FpdCB0aGlzLnJlZ2VuZXJhdGVFbWFpbFZlcmlmeVRva2VuKGFVc2VyLCByZXEuYXV0aD8uaXNNYXN0ZXIsIHJlcS5hdXRoPy5pbnN0YWxsYXRpb25JZCwgcmVxLmlwKTtcbiAgICBpZiAoZ2VuZXJhdGUpIHtcbiAgICAgIHRoaXMuc2VuZFZlcmlmaWNhdGlvbkVtYWlsKGFVc2VyLCByZXEpO1xuICAgIH1cbiAgfVxuXG4gIHNldFBhc3N3b3JkUmVzZXRUb2tlbihlbWFpbCkge1xuICAgIGNvbnN0IHRva2VuID0geyBfcGVyaXNoYWJsZV90b2tlbjogcmFuZG9tU3RyaW5nKDI1KSB9O1xuXG4gICAgaWYgKHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5ICYmIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnJlc2V0VG9rZW5WYWxpZGl0eUR1cmF0aW9uKSB7XG4gICAgICB0b2tlbi5fcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0ID0gUGFyc2UuX2VuY29kZShcbiAgICAgICAgdGhpcy5jb25maWcuZ2VuZXJhdGVQYXNzd29yZFJlc2V0VG9rZW5FeHBpcmVzQXQoKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UudXBkYXRlKFxuICAgICAgJ19Vc2VyJyxcbiAgICAgIHsgJG9yOiBbeyBlbWFpbCB9LCB7IHVzZXJuYW1lOiBlbWFpbCwgZW1haWw6IHsgJGV4aXN0czogZmFsc2UgfSB9XSB9LFxuICAgICAgdG9rZW4sXG4gICAgICB7fSxcbiAgICAgIHRydWVcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgc2VuZFBhc3N3b3JkUmVzZXRFbWFpbChlbWFpbCkge1xuICAgIGlmICghdGhpcy5hZGFwdGVyKSB7XG4gICAgICB0aHJvdyAnVHJ5aW5nIHRvIHNlbmQgYSByZXNldCBwYXNzd29yZCBidXQgbm8gYWRhcHRlciBpcyBzZXQnO1xuICAgICAgLy8gIFRPRE86IE5vIGFkYXB0ZXI/XG4gICAgfVxuICAgIGxldCB1c2VyO1xuICAgIGlmIChcbiAgICAgIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5ICYmXG4gICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5yZXNldFRva2VuUmV1c2VJZlZhbGlkICYmXG4gICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5yZXNldFRva2VuVmFsaWRpdHlEdXJhdGlvblxuICAgICkge1xuICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoXG4gICAgICAgICdfVXNlcicsXG4gICAgICAgIHtcbiAgICAgICAgICAkb3I6IFtcbiAgICAgICAgICAgIHsgZW1haWwsIF9wZXJpc2hhYmxlX3Rva2VuOiB7ICRleGlzdHM6IHRydWUgfSB9LFxuICAgICAgICAgICAgeyB1c2VybmFtZTogZW1haWwsIGVtYWlsOiB7ICRleGlzdHM6IGZhbHNlIH0sIF9wZXJpc2hhYmxlX3Rva2VuOiB7ICRleGlzdHM6IHRydWUgfSB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHsgbGltaXQ6IDEgfSxcbiAgICAgICAgQXV0aC5tYWludGVuYW5jZSh0aGlzLmNvbmZpZylcbiAgICAgICk7XG4gICAgICBpZiAocmVzdWx0cy5sZW5ndGggPT0gMSkge1xuICAgICAgICBsZXQgZXhwaXJlc0RhdGUgPSByZXN1bHRzWzBdLl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQ7XG4gICAgICAgIGlmIChleHBpcmVzRGF0ZSAmJiBleHBpcmVzRGF0ZS5fX3R5cGUgPT0gJ0RhdGUnKSB7XG4gICAgICAgICAgZXhwaXJlc0RhdGUgPSBuZXcgRGF0ZShleHBpcmVzRGF0ZS5pc28pO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHBpcmVzRGF0ZSA+IG5ldyBEYXRlKCkpIHtcbiAgICAgICAgICB1c2VyID0gcmVzdWx0c1swXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIXVzZXIgfHwgIXVzZXIuX3BlcmlzaGFibGVfdG9rZW4pIHtcbiAgICAgIHVzZXIgPSBhd2FpdCB0aGlzLnNldFBhc3N3b3JkUmVzZXRUb2tlbihlbWFpbCk7XG4gICAgfVxuICAgIGNvbnN0IHRva2VuID0gZW5jb2RlVVJJQ29tcG9uZW50KHVzZXIuX3BlcmlzaGFibGVfdG9rZW4pO1xuICAgIGNvbnN0IGxpbmsgPSBidWlsZEVtYWlsTGluayh0aGlzLmNvbmZpZy5yZXF1ZXN0UmVzZXRQYXNzd29yZFVSTCwgdG9rZW4sIHRoaXMuY29uZmlnKTtcbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgYXBwTmFtZTogdGhpcy5jb25maWcuYXBwTmFtZSxcbiAgICAgIGxpbms6IGxpbmssXG4gICAgICB1c2VyOiBpbmZsYXRlKCdfVXNlcicsIHVzZXIpLFxuICAgIH07XG5cbiAgICBpZiAodGhpcy5hZGFwdGVyLnNlbmRQYXNzd29yZFJlc2V0RW1haWwpIHtcbiAgICAgIHRoaXMuYWRhcHRlci5zZW5kUGFzc3dvcmRSZXNldEVtYWlsKG9wdGlvbnMpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmFkYXB0ZXIuc2VuZE1haWwodGhpcy5kZWZhdWx0UmVzZXRQYXNzd29yZEVtYWlsKG9wdGlvbnMpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVzZXIpO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlUGFzc3dvcmQodG9rZW4sIHBhc3N3b3JkKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJhd1VzZXIgPSBhd2FpdCB0aGlzLmNoZWNrUmVzZXRUb2tlblZhbGlkaXR5KHRva2VuKTtcbiAgICAgIGxldCB1c2VyO1xuICAgICAgdHJ5IHtcbiAgICAgICAgdXNlciA9IGF3YWl0IHVwZGF0ZVVzZXJQYXNzd29yZChyYXdVc2VyLCBwYXNzd29yZCwgdGhpcy5jb25maWcpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yICYmIGVycm9yLmNvZGUgPT09IFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQpIHtcbiAgICAgICAgICB0aHJvdyAnRmFpbGVkIHRvIHJlc2V0IHBhc3N3b3JkOiB1c2VybmFtZSAvIGVtYWlsIC8gdG9rZW4gaXMgaW52YWxpZCc7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFjY291bnRMb2Nrb3V0UG9saWN5ID0gbmV3IEFjY291bnRMb2Nrb3V0KHVzZXIsIHRoaXMuY29uZmlnKTtcbiAgICAgIHJldHVybiBhd2FpdCBhY2NvdW50TG9ja291dFBvbGljeS51bmxvY2tBY2NvdW50KCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciAmJiBlcnJvci5tZXNzYWdlKSB7XG4gICAgICAgIC8vIGluIGNhc2Ugb2YgUGFyc2UuRXJyb3IsIGZhaWwgd2l0aCB0aGUgZXJyb3IgbWVzc2FnZSBvbmx5XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChlcnJvci5tZXNzYWdlKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgZGVmYXVsdFZlcmlmaWNhdGlvbkVtYWlsKHsgbGluaywgdXNlciwgYXBwTmFtZSB9KSB7XG4gICAgY29uc3QgdGV4dCA9XG4gICAgICAnSGksXFxuXFxuJyArXG4gICAgICAnWW91IGFyZSBiZWluZyBhc2tlZCB0byBjb25maXJtIHRoZSBlLW1haWwgYWRkcmVzcyAnICtcbiAgICAgIHVzZXIuZ2V0KCdlbWFpbCcpICtcbiAgICAgICcgd2l0aCAnICtcbiAgICAgIGFwcE5hbWUgK1xuICAgICAgJ1xcblxcbicgK1xuICAgICAgJycgK1xuICAgICAgJ0NsaWNrIGhlcmUgdG8gY29uZmlybSBpdDpcXG4nICtcbiAgICAgIGxpbms7XG4gICAgY29uc3QgdG8gPSB1c2VyLmdldCgnZW1haWwnKTtcbiAgICBjb25zdCBzdWJqZWN0ID0gJ1BsZWFzZSB2ZXJpZnkgeW91ciBlLW1haWwgZm9yICcgKyBhcHBOYW1lO1xuICAgIHJldHVybiB7IHRleHQsIHRvLCBzdWJqZWN0IH07XG4gIH1cblxuICBkZWZhdWx0UmVzZXRQYXNzd29yZEVtYWlsKHsgbGluaywgdXNlciwgYXBwTmFtZSB9KSB7XG4gICAgY29uc3QgdGV4dCA9XG4gICAgICAnSGksXFxuXFxuJyArXG4gICAgICAnWW91IHJlcXVlc3RlZCB0byByZXNldCB5b3VyIHBhc3N3b3JkIGZvciAnICtcbiAgICAgIGFwcE5hbWUgK1xuICAgICAgKHVzZXIuZ2V0KCd1c2VybmFtZScpID8gXCIgKHlvdXIgdXNlcm5hbWUgaXMgJ1wiICsgdXNlci5nZXQoJ3VzZXJuYW1lJykgKyBcIicpXCIgOiAnJykgK1xuICAgICAgJy5cXG5cXG4nICtcbiAgICAgICcnICtcbiAgICAgICdDbGljayBoZXJlIHRvIHJlc2V0IGl0OlxcbicgK1xuICAgICAgbGluaztcbiAgICBjb25zdCB0byA9IHVzZXIuZ2V0KCdlbWFpbCcpIHx8IHVzZXIuZ2V0KCd1c2VybmFtZScpO1xuICAgIGNvbnN0IHN1YmplY3QgPSAnUGFzc3dvcmQgUmVzZXQgZm9yICcgKyBhcHBOYW1lO1xuICAgIHJldHVybiB7IHRleHQsIHRvLCBzdWJqZWN0IH07XG4gIH1cbn1cblxuLy8gTWFyayB0aGlzIHByaXZhdGVcbmZ1bmN0aW9uIHVwZGF0ZVVzZXJQYXNzd29yZCh1c2VyLCBwYXNzd29yZCwgY29uZmlnKSB7XG4gIHJldHVybiByZXN0XG4gICAgLnVwZGF0ZShcbiAgICAgIGNvbmZpZyxcbiAgICAgIEF1dGgubWFzdGVyKGNvbmZpZyksXG4gICAgICAnX1VzZXInLFxuICAgICAgeyBvYmplY3RJZDogdXNlci5vYmplY3RJZCwgX3BlcmlzaGFibGVfdG9rZW46IHVzZXIuX3BlcmlzaGFibGVfdG9rZW4gfSxcbiAgICAgIHtcbiAgICAgICAgcGFzc3dvcmQ6IHBhc3N3b3JkLFxuICAgICAgfVxuICAgIClcbiAgICAudGhlbigoKSA9PiB1c2VyKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRFbWFpbExpbmsoZGVzdGluYXRpb24sIHRva2VuLCBjb25maWcpIHtcbiAgdG9rZW4gPSBgdG9rZW49JHt0b2tlbn1gO1xuICBpZiAoY29uZmlnLnBhcnNlRnJhbWVVUkwpIHtcbiAgICBjb25zdCBkZXN0aW5hdGlvbldpdGhvdXRIb3N0ID0gZGVzdGluYXRpb24ucmVwbGFjZShjb25maWcucHVibGljU2VydmVyVVJMLCAnJyk7XG5cbiAgICByZXR1cm4gYCR7Y29uZmlnLnBhcnNlRnJhbWVVUkx9P2xpbms9JHtlbmNvZGVVUklDb21wb25lbnQoZGVzdGluYXRpb25XaXRob3V0SG9zdCl9JiR7dG9rZW59YDtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYCR7ZGVzdGluYXRpb259PyR7dG9rZW59YDtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBVc2VyQ29udHJvbGxlcjtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsSUFBQUEsWUFBQSxHQUFBQyxPQUFBO0FBQ0EsSUFBQUMsU0FBQSxHQUFBRCxPQUFBO0FBQ0EsSUFBQUUsb0JBQUEsR0FBQUMsc0JBQUEsQ0FBQUgsT0FBQTtBQUNBLElBQUFJLFlBQUEsR0FBQUQsc0JBQUEsQ0FBQUgsT0FBQTtBQUNBLElBQUFLLEtBQUEsR0FBQUYsc0JBQUEsQ0FBQUgsT0FBQTtBQUNBLElBQUFNLEtBQUEsR0FBQUgsc0JBQUEsQ0FBQUgsT0FBQTtBQUNBLElBQUFPLGVBQUEsR0FBQUosc0JBQUEsQ0FBQUgsT0FBQTtBQUNBLElBQUFRLE9BQUEsR0FBQUwsc0JBQUEsQ0FBQUgsT0FBQTtBQUErQixTQUFBRyx1QkFBQU0sQ0FBQSxXQUFBQSxD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