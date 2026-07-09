"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _Utils = _interopRequireDefault(require("../Utils"));
var _lodash = require("lodash");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * @module SecurityCheck
 */

/**
 * A security check.
 * @class
 */
class Check {
  /**
   * Constructs a new security check.
   * @param {Object} params The parameters.
   * @param {String} params.title The title.
   * @param {String} params.warning The warning message if the check fails.
   * @param {String} params.solution The solution to fix the check.
   * @param {Promise} params.check The check as synchronous or asynchronous function.
   */
  constructor(params) {
    this._validateParams(params);
    const {
      title,
      warning,
      solution,
      check
    } = params;
    this.title = title;
    this.warning = warning;
    this.solution = solution;
    this.check = check;

    // Set default properties
    this._checkState = CheckState.none;
    this.error;
  }

  /**
   * Returns the current check state.
   * @return {CheckState} The check state.
   */
  checkState() {
    return this._checkState;
  }
  async run() {
    // Get check as synchronous or asynchronous function
    const check = _Utils.default.isPromise(this.check) ? await this.check : this.check;

    // Run check
    try {
      check();
      this._checkState = CheckState.success;
    } catch (e) {
      this.stateFailError = e;
      this._checkState = CheckState.fail;
    }
  }

  /**
   * Validates the constructor parameters.
   * @param {Object} params The parameters to validate.
   */
  _validateParams(params) {
    _Utils.default.validateParams(params, {
      group: {
        t: 'string',
        v: _lodash.isString
      },
      title: {
        t: 'string',
        v: _lodash.isString
      },
      warning: {
        t: 'string',
        v: _lodash.isString
      },
      solution: {
        t: 'string',
        v: _lodash.isString
      },
      check: {
        t: 'function',
        v: _lodash.isFunction
      }
    });
  }
}

/**
 * The check state.
 */
const CheckState = Object.freeze({
  none: 'none',
  fail: 'fail',
  success: 'success'
});
var _default = exports.default = Check;
module.exports = {
  Check,
  CheckState
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfVXRpbHMiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwicmVxdWlyZSIsIl9sb2Rhc2giLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJDaGVjayIsImNvbnN0cnVjdG9yIiwicGFyYW1zIiwiX3ZhbGlkYXRlUGFyYW1zIiwidGl0bGUiLCJ3YXJuaW5nIiwic29sdXRpb24iLCJjaGVjayIsIl9jaGVja1N0YXRlIiwiQ2hlY2tTdGF0ZSIsIm5vbmUiLCJlcnJvciIsImNoZWNrU3RhdGUiLCJydW4iLCJVdGlscyIsImlzUHJvbWlzZSIsInN1Y2Nlc3MiLCJzdGF0ZUZhaWxFcnJvciIsImZhaWwiLCJ2YWxpZGF0ZVBhcmFtcyIsImdyb3VwIiwidCIsInYiLCJpc1N0cmluZyIsImlzRnVuY3Rpb24iLCJPYmplY3QiLCJmcmVlemUiLCJfZGVmYXVsdCIsImV4cG9ydHMiLCJtb2R1bGUiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvU2VjdXJpdHkvQ2hlY2suanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbW9kdWxlIFNlY3VyaXR5Q2hlY2tcbiAqL1xuXG5pbXBvcnQgVXRpbHMgZnJvbSAnLi4vVXRpbHMnO1xuaW1wb3J0IHsgaXNGdW5jdGlvbiwgaXNTdHJpbmcgfSBmcm9tICdsb2Rhc2gnO1xuXG4vKipcbiAqIEEgc2VjdXJpdHkgY2hlY2suXG4gKiBAY2xhc3NcbiAqL1xuY2xhc3MgQ2hlY2sge1xuICAvKipcbiAgICogQ29uc3RydWN0cyBhIG5ldyBzZWN1cml0eSBjaGVjay5cbiAgICogQHBhcmFtIHtPYmplY3R9IHBhcmFtcyBUaGUgcGFyYW1ldGVycy5cbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhcmFtcy50aXRsZSBUaGUgdGl0bGUuXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXJhbXMud2FybmluZyBUaGUgd2FybmluZyBtZXNzYWdlIGlmIHRoZSBjaGVjayBmYWlscy5cbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhcmFtcy5zb2x1dGlvbiBUaGUgc29sdXRpb24gdG8gZml4IHRoZSBjaGVjay5cbiAgICogQHBhcmFtIHtQcm9taXNlfSBwYXJhbXMuY2hlY2sgVGhlIGNoZWNrIGFzIHN5bmNocm9ub3VzIG9yIGFzeW5jaHJvbm91cyBmdW5jdGlvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHBhcmFtcykge1xuICAgIHRoaXMuX3ZhbGlkYXRlUGFyYW1zKHBhcmFtcyk7XG4gICAgY29uc3QgeyB0aXRsZSwgd2FybmluZywgc29sdXRpb24sIGNoZWNrIH0gPSBwYXJhbXM7XG5cbiAgICB0aGlzLnRpdGxlID0gdGl0bGU7XG4gICAgdGhpcy53YXJuaW5nID0gd2FybmluZztcbiAgICB0aGlzLnNvbHV0aW9uID0gc29sdXRpb247XG4gICAgdGhpcy5jaGVjayA9IGNoZWNrO1xuXG4gICAgLy8gU2V0IGRlZmF1bHQgcHJvcGVydGllc1xuICAgIHRoaXMuX2NoZWNrU3RhdGUgPSBDaGVja1N0YXRlLm5vbmU7XG4gICAgdGhpcy5lcnJvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjdXJyZW50IGNoZWNrIHN0YXRlLlxuICAgKiBAcmV0dXJuIHtDaGVja1N0YXRlfSBUaGUgY2hlY2sgc3RhdGUuXG4gICAqL1xuICBjaGVja1N0YXRlKCkge1xuICAgIHJldHVybiB0aGlzLl9jaGVja1N0YXRlO1xuICB9XG5cbiAgYXN5bmMgcnVuKCkge1xuICAgIC8vIEdldCBjaGVjayBhcyBzeW5jaHJvbm91cyBvciBhc3luY2hyb25vdXMgZnVuY3Rpb25cbiAgICBjb25zdCBjaGVjayA9IFV0aWxzLmlzUHJvbWlzZSh0aGlzLmNoZWNrKSA/IGF3YWl0IHRoaXMuY2hlY2sgOiB0aGlzLmNoZWNrO1xuXG4gICAgLy8gUnVuIGNoZWNrXG4gICAgdHJ5IHtcbiAgICAgIGNoZWNrKCk7XG4gICAgICB0aGlzLl9jaGVja1N0YXRlID0gQ2hlY2tTdGF0ZS5zdWNjZXNzO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMuc3RhdGVGYWlsRXJyb3IgPSBlO1xuICAgICAgdGhpcy5fY2hlY2tTdGF0ZSA9IENoZWNrU3RhdGUuZmFpbDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSBjb25zdHJ1Y3RvciBwYXJhbWV0ZXJzLlxuICAgKiBAcGFyYW0ge09iamVjdH0gcGFyYW1zIFRoZSBwYXJhbWV0ZXJzIHRvIHZhbGlkYXRlLlxuICAgKi9cbiAgX3ZhbGlkYXRlUGFyYW1zKHBhcmFtcykge1xuICAgIFV0aWxzLnZhbGlkYXRlUGFyYW1zKHBhcmFtcywge1xuICAgICAgZ3JvdXA6IHsgdDogJ3N0cmluZycsIHY6IGlzU3RyaW5nIH0sXG4gICAgICB0aXRsZTogeyB0OiAnc3RyaW5nJywgdjogaXNTdHJpbmcgfSxcbiAgICAgIHdhcm5pbmc6IHsgdDogJ3N0cmluZycsIHY6IGlzU3RyaW5nIH0sXG4gICAgICBzb2x1dGlvbjogeyB0OiAnc3RyaW5nJywgdjogaXNTdHJpbmcgfSxcbiAgICAgIGNoZWNrOiB7IHQ6ICdmdW5jdGlvbicsIHY6IGlzRnVuY3Rpb24gfSxcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBjaGVjayBzdGF0ZS5cbiAqL1xuY29uc3QgQ2hlY2tTdGF0ZSA9IE9iamVjdC5mcmVlemUoe1xuICBub25lOiAnbm9uZScsXG4gIGZhaWw6ICdmYWlsJyxcbiAgc3VjY2VzczogJ3N1Y2Nlc3MnLFxufSk7XG5cbmV4cG9ydCBkZWZhdWx0IENoZWNrO1xubW9kdWxlLmV4cG9ydHMgPSB7XG4gIENoZWNrLFxuICBDaGVja1N0YXRlLFxufTtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBSUEsSUFBQUEsTUFBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBQ0EsSUFBQUMsT0FBQSxHQUFBRCxPQUFBO0FBQThDLFNBQUFELHVCQUFBRyxDQUFBLFdBQUFBLENBQUEsSUFBQUEsQ0FBQSxDQUFBQyxVQUFBLEdBQUFELENBQUEsS0FBQUUsT0FBQSxFQUFBRixDQUFBO0FBTDlDO0FBQ0E7QUFDQTs7QUFLQTtBQUNBO0FBQ0E7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