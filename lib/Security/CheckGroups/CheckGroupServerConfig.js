"use strict";

var _Check = require("../Check");
var _CheckGroup = _interopRequireDefault(require("../CheckGroup"));
var _Config = _interopRequireDefault(require("../../Config"));
var _node = _interopRequireDefault(require("parse/node"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * The security checks group for Parse Server configuration.
 * Checks common Parse Server parameters such as access keys.
 * @memberof module:SecurityCheck
 */
class CheckGroupServerConfig extends _CheckGroup.default {
  setName() {
    return 'Parse Server Configuration';
  }
  setChecks() {
    const config = _Config.default.get(_node.default.applicationId);
    return [new _Check.Check({
      title: 'Secure master key',
      warning: 'The Parse Server master key is insecure and vulnerable to brute force attacks.',
      solution: 'Choose a longer and/or more complex master key with a combination of upper- and lowercase characters, numbers and special characters.',
      check: () => {
        const masterKey = config.masterKey;
        const hasUpperCase = /[A-Z]/.test(masterKey);
        const hasLowerCase = /[a-z]/.test(masterKey);
        const hasNumbers = /\d/.test(masterKey);
        const hasNonAlphasNumerics = /\W/.test(masterKey);
        // Ensure length
        if (masterKey.length < 14) {
          throw 1;
        }
        // Ensure at least 3 out of 4 requirements passed
        if (hasUpperCase + hasLowerCase + hasNumbers + hasNonAlphasNumerics < 3) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'Security log disabled',
      warning: 'Security checks in logs may expose vulnerabilities to anyone with access to logs.',
      solution: "Change Parse Server configuration to 'security.enableCheckLog: false'.",
      check: () => {
        if (config.security && config.security.enableCheckLog) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'Client class creation disabled',
      warning: 'Attackers are allowed to create new classes without restriction and flood the database.',
      solution: "Change Parse Server configuration to 'allowClientClassCreation: false'.",
      check: () => {
        if (config.allowClientClassCreation || config.allowClientClassCreation == null) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'Users are created without public access',
      warning: 'Users with public read access are exposed to anyone who knows their object IDs, or to anyone who can query the Parse.User class.',
      solution: "Change Parse Server configuration to 'enforcePrivateUsers: true'.",
      check: () => {
        if (!config.enforcePrivateUsers) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'Insecure auth adapters disabled',
      warning: "Attackers may explore insecure auth adapters' vulnerabilities and log in on behalf of another user.",
      solution: "Change Parse Server configuration to 'enableInsecureAuthAdapters: false'.",
      check: () => {
        if (config.enableInsecureAuthAdapters !== false) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'GraphQL public introspection disabled',
      warning: 'GraphQL public introspection is enabled, which allows anyone to access the GraphQL schema.',
      solution: "Change Parse Server configuration to 'graphQLPublicIntrospection: false'. You will need to use master key or maintenance key to access the GraphQL schema.",
      check: () => {
        if (config.graphQLPublicIntrospection !== false) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'GraphQL Playground disabled',
      warning: 'GraphQL Playground is enabled and exposes the master key in the browser page.',
      solution: "Change Parse Server configuration to 'mountPlayground: false'. Use Parse Dashboard for GraphQL exploration in production.",
      check: () => {
        if (config.mountPlayground) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'Public database explain disabled',
      warning: 'Database explain queries are publicly accessible, which may expose sensitive database performance information and schema details.',
      solution: "Change Parse Server configuration to 'databaseOptions.allowPublicExplain: false'. You will need to use master key to run explain queries.",
      check: () => {
        if (config.databaseOptions?.allowPublicExplain === true || config.databaseOptions?.allowPublicExplain == null) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'Read-only master key IP range restricted',
      warning: 'The read-only master key can be used from any IP address, which increases the attack surface if the key is compromised.',
      solution: "Change Parse Server configuration to 'readOnlyMasterKeyIps: [\"127.0.0.1\", \"::1\"]' to restrict access to localhost, or set it to a list of specific IP addresses.",
      check: () => {
        if (!config.readOnlyMasterKey) {
          return;
        }
        const ips = config.readOnlyMasterKeyIps || [];
        const wildcards = ['0.0.0.0/0', '0.0.0.0', '::/0', '::', '::0'];
        if (ips.some(ip => wildcards.includes(ip))) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'Request complexity limits enabled',
      warning: 'One or more request complexity limits are disabled, which may allow denial-of-service attacks through deeply nested or excessively broad queries.',
      solution: "Ensure all properties in 'requestComplexity' are set to positive integers. Set to '-1' only if you have other mitigations in place.",
      check: () => {
        const rc = config.requestComplexity;
        if (!rc) {
          throw 1;
        }
        const values = [rc.includeDepth, rc.includeCount, rc.subqueryDepth, rc.queryDepth, rc.graphQLDepth, rc.graphQLFields, rc.batchRequestLimit];
        if (values.some(v => v === -1)) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'Password reset endpoint user enumeration mitigated',
      warning: 'The password reset endpoint returns distinct error responses for invalid email addresses, which allows attackers to enumerate registered users.',
      solution: "Change Parse Server configuration to 'passwordPolicy.resetPasswordSuccessOnInvalidEmail: true'.",
      check: () => {
        if (config.passwordPolicy?.resetPasswordSuccessOnInvalidEmail === false) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'Email verification endpoint user enumeration mitigated',
      warning: 'The email verification endpoint returns distinct error responses for invalid email addresses, which allows attackers to enumerate registered users.',
      solution: "Change Parse Server configuration to 'emailVerifySuccessOnInvalidEmail: true'.",
      check: () => {
        if (config.emailVerifySuccessOnInvalidEmail === false) {
          throw 1;
        }
      }
    }), new _Check.Check({
      title: 'LiveQuery regex timeout enabled',
      warning: 'LiveQuery regex timeout is disabled. A malicious client can subscribe with a crafted $regex pattern that causes catastrophic backtracking, blocking the Node.js event loop and making the server unresponsive.',
      solution: "Change Parse Server configuration to 'liveQuery.regexTimeout: 100' to set a 100ms timeout for regex evaluation in LiveQuery.",
      check: () => {
        if (config.liveQuery?.classNames?.length > 0 && config.liveQuery?.regexTimeout === 0) {
          throw 1;
        }
      }
    })];
  }
}
module.exports = CheckGroupServerConfig;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfQ2hlY2siLCJyZXF1aXJlIiwiX0NoZWNrR3JvdXAiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwiX0NvbmZpZyIsIl9ub2RlIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiQ2hlY2tHcm91cFNlcnZlckNvbmZpZyIsIkNoZWNrR3JvdXAiLCJzZXROYW1lIiwic2V0Q2hlY2tzIiwiY29uZmlnIiwiQ29uZmlnIiwiZ2V0IiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwiQ2hlY2siLCJ0aXRsZSIsIndhcm5pbmciLCJzb2x1dGlvbiIsImNoZWNrIiwibWFzdGVyS2V5IiwiaGFzVXBwZXJDYXNlIiwidGVzdCIsImhhc0xvd2VyQ2FzZSIsImhhc051bWJlcnMiLCJoYXNOb25BbHBoYXNOdW1lcmljcyIsImxlbmd0aCIsInNlY3VyaXR5IiwiZW5hYmxlQ2hlY2tMb2ciLCJhbGxvd0NsaWVudENsYXNzQ3JlYXRpb24iLCJlbmZvcmNlUHJpdmF0ZVVzZXJzIiwiZW5hYmxlSW5zZWN1cmVBdXRoQWRhcHRlcnMiLCJncmFwaFFMUHVibGljSW50cm9zcGVjdGlvbiIsIm1vdW50UGxheWdyb3VuZCIsImRhdGFiYXNlT3B0aW9ucyIsImFsbG93UHVibGljRXhwbGFpbiIsInJlYWRPbmx5TWFzdGVyS2V5IiwiaXBzIiwicmVhZE9ubHlNYXN0ZXJLZXlJcHMiLCJ3aWxkY2FyZHMiLCJzb21lIiwiaXAiLCJpbmNsdWRlcyIsInJjIiwicmVxdWVzdENvbXBsZXhpdHkiLCJ2YWx1ZXMiLCJpbmNsdWRlRGVwdGgiLCJpbmNsdWRlQ291bnQiLCJzdWJxdWVyeURlcHRoIiwicXVlcnlEZXB0aCIsImdyYXBoUUxEZXB0aCIsImdyYXBoUUxGaWVsZHMiLCJiYXRjaFJlcXVlc3RMaW1pdCIsInYiLCJwYXNzd29yZFBvbGljeSIsInJlc2V0UGFzc3dvcmRTdWNjZXNzT25JbnZhbGlkRW1haWwiLCJlbWFpbFZlcmlmeVN1Y2Nlc3NPbkludmFsaWRFbWFpbCIsImxpdmVRdWVyeSIsImNsYXNzTmFtZXMiLCJyZWdleFRpbWVvdXQiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL1NlY3VyaXR5L0NoZWNrR3JvdXBzL0NoZWNrR3JvdXBTZXJ2ZXJDb25maWcuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2hlY2sgfSBmcm9tICcuLi9DaGVjayc7XG5pbXBvcnQgQ2hlY2tHcm91cCBmcm9tICcuLi9DaGVja0dyb3VwJztcbmltcG9ydCBDb25maWcgZnJvbSAnLi4vLi4vQ29uZmlnJztcbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcblxuLyoqXG4gKiBUaGUgc2VjdXJpdHkgY2hlY2tzIGdyb3VwIGZvciBQYXJzZSBTZXJ2ZXIgY29uZmlndXJhdGlvbi5cbiAqIENoZWNrcyBjb21tb24gUGFyc2UgU2VydmVyIHBhcmFtZXRlcnMgc3VjaCBhcyBhY2Nlc3Mga2V5cy5cbiAqIEBtZW1iZXJvZiBtb2R1bGU6U2VjdXJpdHlDaGVja1xuICovXG5jbGFzcyBDaGVja0dyb3VwU2VydmVyQ29uZmlnIGV4dGVuZHMgQ2hlY2tHcm91cCB7XG4gIHNldE5hbWUoKSB7XG4gICAgcmV0dXJuICdQYXJzZSBTZXJ2ZXIgQ29uZmlndXJhdGlvbic7XG4gIH1cbiAgc2V0Q2hlY2tzKCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IENvbmZpZy5nZXQoUGFyc2UuYXBwbGljYXRpb25JZCk7XG4gICAgcmV0dXJuIFtcbiAgICAgIG5ldyBDaGVjayh7XG4gICAgICAgIHRpdGxlOiAnU2VjdXJlIG1hc3RlciBrZXknLFxuICAgICAgICB3YXJuaW5nOiAnVGhlIFBhcnNlIFNlcnZlciBtYXN0ZXIga2V5IGlzIGluc2VjdXJlIGFuZCB2dWxuZXJhYmxlIHRvIGJydXRlIGZvcmNlIGF0dGFja3MuJyxcbiAgICAgICAgc29sdXRpb246XG4gICAgICAgICAgJ0Nob29zZSBhIGxvbmdlciBhbmQvb3IgbW9yZSBjb21wbGV4IG1hc3RlciBrZXkgd2l0aCBhIGNvbWJpbmF0aW9uIG9mIHVwcGVyLSBhbmQgbG93ZXJjYXNlIGNoYXJhY3RlcnMsIG51bWJlcnMgYW5kIHNwZWNpYWwgY2hhcmFjdGVycy4nLFxuICAgICAgICBjaGVjazogKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG1hc3RlcktleSA9IGNvbmZpZy5tYXN0ZXJLZXk7XG4gICAgICAgICAgY29uc3QgaGFzVXBwZXJDYXNlID0gL1tBLVpdLy50ZXN0KG1hc3RlcktleSk7XG4gICAgICAgICAgY29uc3QgaGFzTG93ZXJDYXNlID0gL1thLXpdLy50ZXN0KG1hc3RlcktleSk7XG4gICAgICAgICAgY29uc3QgaGFzTnVtYmVycyA9IC9cXGQvLnRlc3QobWFzdGVyS2V5KTtcbiAgICAgICAgICBjb25zdCBoYXNOb25BbHBoYXNOdW1lcmljcyA9IC9cXFcvLnRlc3QobWFzdGVyS2V5KTtcbiAgICAgICAgICAvLyBFbnN1cmUgbGVuZ3RoXG4gICAgICAgICAgaWYgKG1hc3RlcktleS5sZW5ndGggPCAxNCkge1xuICAgICAgICAgICAgdGhyb3cgMTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gRW5zdXJlIGF0IGxlYXN0IDMgb3V0IG9mIDQgcmVxdWlyZW1lbnRzIHBhc3NlZFxuICAgICAgICAgIGlmIChoYXNVcHBlckNhc2UgKyBoYXNMb3dlckNhc2UgKyBoYXNOdW1iZXJzICsgaGFzTm9uQWxwaGFzTnVtZXJpY3MgPCAzKSB7XG4gICAgICAgICAgICB0aHJvdyAxO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgbmV3IENoZWNrKHtcbiAgICAgICAgdGl0bGU6ICdTZWN1cml0eSBsb2cgZGlzYWJsZWQnLFxuICAgICAgICB3YXJuaW5nOlxuICAgICAgICAgICdTZWN1cml0eSBjaGVja3MgaW4gbG9ncyBtYXkgZXhwb3NlIHZ1bG5lcmFiaWxpdGllcyB0byBhbnlvbmUgd2l0aCBhY2Nlc3MgdG8gbG9ncy4nLFxuICAgICAgICBzb2x1dGlvbjogXCJDaGFuZ2UgUGFyc2UgU2VydmVyIGNvbmZpZ3VyYXRpb24gdG8gJ3NlY3VyaXR5LmVuYWJsZUNoZWNrTG9nOiBmYWxzZScuXCIsXG4gICAgICAgIGNoZWNrOiAoKSA9PiB7XG4gICAgICAgICAgaWYgKGNvbmZpZy5zZWN1cml0eSAmJiBjb25maWcuc2VjdXJpdHkuZW5hYmxlQ2hlY2tMb2cpIHtcbiAgICAgICAgICAgIHRocm93IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgICBuZXcgQ2hlY2soe1xuICAgICAgICB0aXRsZTogJ0NsaWVudCBjbGFzcyBjcmVhdGlvbiBkaXNhYmxlZCcsXG4gICAgICAgIHdhcm5pbmc6XG4gICAgICAgICAgJ0F0dGFja2VycyBhcmUgYWxsb3dlZCB0byBjcmVhdGUgbmV3IGNsYXNzZXMgd2l0aG91dCByZXN0cmljdGlvbiBhbmQgZmxvb2QgdGhlIGRhdGFiYXNlLicsXG4gICAgICAgIHNvbHV0aW9uOiBcIkNoYW5nZSBQYXJzZSBTZXJ2ZXIgY29uZmlndXJhdGlvbiB0byAnYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uOiBmYWxzZScuXCIsXG4gICAgICAgIGNoZWNrOiAoKSA9PiB7XG4gICAgICAgICAgaWYgKGNvbmZpZy5hbGxvd0NsaWVudENsYXNzQ3JlYXRpb24gfHwgY29uZmlnLmFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiA9PSBudWxsKSB7XG4gICAgICAgICAgICB0aHJvdyAxO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgbmV3IENoZWNrKHtcbiAgICAgICAgdGl0bGU6ICdVc2VycyBhcmUgY3JlYXRlZCB3aXRob3V0IHB1YmxpYyBhY2Nlc3MnLFxuICAgICAgICB3YXJuaW5nOlxuICAgICAgICAgICdVc2VycyB3aXRoIHB1YmxpYyByZWFkIGFjY2VzcyBhcmUgZXhwb3NlZCB0byBhbnlvbmUgd2hvIGtub3dzIHRoZWlyIG9iamVjdCBJRHMsIG9yIHRvIGFueW9uZSB3aG8gY2FuIHF1ZXJ5IHRoZSBQYXJzZS5Vc2VyIGNsYXNzLicsXG4gICAgICAgIHNvbHV0aW9uOiBcIkNoYW5nZSBQYXJzZSBTZXJ2ZXIgY29uZmlndXJhdGlvbiB0byAnZW5mb3JjZVByaXZhdGVVc2VyczogdHJ1ZScuXCIsXG4gICAgICAgIGNoZWNrOiAoKSA9PiB7XG4gICAgICAgICAgaWYgKCFjb25maWcuZW5mb3JjZVByaXZhdGVVc2Vycykge1xuICAgICAgICAgICAgdGhyb3cgMTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIG5ldyBDaGVjayh7XG4gICAgICAgIHRpdGxlOiAnSW5zZWN1cmUgYXV0aCBhZGFwdGVycyBkaXNhYmxlZCcsXG4gICAgICAgIHdhcm5pbmc6XG4gICAgICAgICAgXCJBdHRhY2tlcnMgbWF5IGV4cGxvcmUgaW5zZWN1cmUgYXV0aCBhZGFwdGVycycgdnVsbmVyYWJpbGl0aWVzIGFuZCBsb2cgaW4gb24gYmVoYWxmIG9mIGFub3RoZXIgdXNlci5cIixcbiAgICAgICAgc29sdXRpb246IFwiQ2hhbmdlIFBhcnNlIFNlcnZlciBjb25maWd1cmF0aW9uIHRvICdlbmFibGVJbnNlY3VyZUF1dGhBZGFwdGVyczogZmFsc2UnLlwiLFxuICAgICAgICBjaGVjazogKCkgPT4ge1xuICAgICAgICAgIGlmIChjb25maWcuZW5hYmxlSW5zZWN1cmVBdXRoQWRhcHRlcnMgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICB0aHJvdyAxO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgbmV3IENoZWNrKHtcbiAgICAgICAgdGl0bGU6ICdHcmFwaFFMIHB1YmxpYyBpbnRyb3NwZWN0aW9uIGRpc2FibGVkJyxcbiAgICAgICAgd2FybmluZzogJ0dyYXBoUUwgcHVibGljIGludHJvc3BlY3Rpb24gaXMgZW5hYmxlZCwgd2hpY2ggYWxsb3dzIGFueW9uZSB0byBhY2Nlc3MgdGhlIEdyYXBoUUwgc2NoZW1hLicsXG4gICAgICAgIHNvbHV0aW9uOiBcIkNoYW5nZSBQYXJzZSBTZXJ2ZXIgY29uZmlndXJhdGlvbiB0byAnZ3JhcGhRTFB1YmxpY0ludHJvc3BlY3Rpb246IGZhbHNlJy4gWW91IHdpbGwgbmVlZCB0byB1c2UgbWFzdGVyIGtleSBvciBtYWludGVuYW5jZSBrZXkgdG8gYWNjZXNzIHRoZSBHcmFwaFFMIHNjaGVtYS5cIixcbiAgICAgICAgY2hlY2s6ICgpID0+IHtcbiAgICAgICAgICBpZiAoY29uZmlnLmdyYXBoUUxQdWJsaWNJbnRyb3NwZWN0aW9uICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgdGhyb3cgMTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIG5ldyBDaGVjayh7XG4gICAgICAgIHRpdGxlOiAnR3JhcGhRTCBQbGF5Z3JvdW5kIGRpc2FibGVkJyxcbiAgICAgICAgd2FybmluZzpcbiAgICAgICAgICAnR3JhcGhRTCBQbGF5Z3JvdW5kIGlzIGVuYWJsZWQgYW5kIGV4cG9zZXMgdGhlIG1hc3RlciBrZXkgaW4gdGhlIGJyb3dzZXIgcGFnZS4nLFxuICAgICAgICBzb2x1dGlvbjpcbiAgICAgICAgICBcIkNoYW5nZSBQYXJzZSBTZXJ2ZXIgY29uZmlndXJhdGlvbiB0byAnbW91bnRQbGF5Z3JvdW5kOiBmYWxzZScuIFVzZSBQYXJzZSBEYXNoYm9hcmQgZm9yIEdyYXBoUUwgZXhwbG9yYXRpb24gaW4gcHJvZHVjdGlvbi5cIixcbiAgICAgICAgY2hlY2s6ICgpID0+IHtcbiAgICAgICAgICBpZiAoY29uZmlnLm1vdW50UGxheWdyb3VuZCkge1xuICAgICAgICAgICAgdGhyb3cgMTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIG5ldyBDaGVjayh7XG4gICAgICAgIHRpdGxlOiAnUHVibGljIGRhdGFiYXNlIGV4cGxhaW4gZGlzYWJsZWQnLFxuICAgICAgICB3YXJuaW5nOlxuICAgICAgICAgICdEYXRhYmFzZSBleHBsYWluIHF1ZXJpZXMgYXJlIHB1YmxpY2x5IGFjY2Vzc2libGUsIHdoaWNoIG1heSBleHBvc2Ugc2Vuc2l0aXZlIGRhdGFiYXNlIHBlcmZvcm1hbmNlIGluZm9ybWF0aW9uIGFuZCBzY2hlbWEgZGV0YWlscy4nLFxuICAgICAgICBzb2x1dGlvbjpcbiAgICAgICAgICBcIkNoYW5nZSBQYXJzZSBTZXJ2ZXIgY29uZmlndXJhdGlvbiB0byAnZGF0YWJhc2VPcHRpb25zLmFsbG93UHVibGljRXhwbGFpbjogZmFsc2UnLiBZb3Ugd2lsbCBuZWVkIHRvIHVzZSBtYXN0ZXIga2V5IHRvIHJ1biBleHBsYWluIHF1ZXJpZXMuXCIsXG4gICAgICAgIGNoZWNrOiAoKSA9PiB7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgY29uZmlnLmRhdGFiYXNlT3B0aW9ucz8uYWxsb3dQdWJsaWNFeHBsYWluID09PSB0cnVlIHx8XG4gICAgICAgICAgICBjb25maWcuZGF0YWJhc2VPcHRpb25zPy5hbGxvd1B1YmxpY0V4cGxhaW4gPT0gbnVsbFxuICAgICAgICAgICkge1xuICAgICAgICAgICAgdGhyb3cgMTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIG5ldyBDaGVjayh7XG4gICAgICAgIHRpdGxlOiAnUmVhZC1vbmx5IG1hc3RlciBrZXkgSVAgcmFuZ2UgcmVzdHJpY3RlZCcsXG4gICAgICAgIHdhcm5pbmc6XG4gICAgICAgICAgJ1RoZSByZWFkLW9ubHkgbWFzdGVyIGtleSBjYW4gYmUgdXNlZCBmcm9tIGFueSBJUCBhZGRyZXNzLCB3aGljaCBpbmNyZWFzZXMgdGhlIGF0dGFjayBzdXJmYWNlIGlmIHRoZSBrZXkgaXMgY29tcHJvbWlzZWQuJyxcbiAgICAgICAgc29sdXRpb246XG4gICAgICAgICAgXCJDaGFuZ2UgUGFyc2UgU2VydmVyIGNvbmZpZ3VyYXRpb24gdG8gJ3JlYWRPbmx5TWFzdGVyS2V5SXBzOiBbXFxcIjEyNy4wLjAuMVxcXCIsIFxcXCI6OjFcXFwiXScgdG8gcmVzdHJpY3QgYWNjZXNzIHRvIGxvY2FsaG9zdCwgb3Igc2V0IGl0IHRvIGEgbGlzdCBvZiBzcGVjaWZpYyBJUCBhZGRyZXNzZXMuXCIsXG4gICAgICAgIGNoZWNrOiAoKSA9PiB7XG4gICAgICAgICAgaWYgKCFjb25maWcucmVhZE9ubHlNYXN0ZXJLZXkpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgaXBzID0gY29uZmlnLnJlYWRPbmx5TWFzdGVyS2V5SXBzIHx8IFtdO1xuICAgICAgICAgIGNvbnN0IHdpbGRjYXJkcyA9IFsnMC4wLjAuMC8wJywgJzAuMC4wLjAnLCAnOjovMCcsICc6OicsICc6OjAnXTtcbiAgICAgICAgICBpZiAoaXBzLnNvbWUoaXAgPT4gd2lsZGNhcmRzLmluY2x1ZGVzKGlwKSkpIHtcbiAgICAgICAgICAgIHRocm93IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgICBuZXcgQ2hlY2soe1xuICAgICAgICB0aXRsZTogJ1JlcXVlc3QgY29tcGxleGl0eSBsaW1pdHMgZW5hYmxlZCcsXG4gICAgICAgIHdhcm5pbmc6XG4gICAgICAgICAgJ09uZSBvciBtb3JlIHJlcXVlc3QgY29tcGxleGl0eSBsaW1pdHMgYXJlIGRpc2FibGVkLCB3aGljaCBtYXkgYWxsb3cgZGVuaWFsLW9mLXNlcnZpY2UgYXR0YWNrcyB0aHJvdWdoIGRlZXBseSBuZXN0ZWQgb3IgZXhjZXNzaXZlbHkgYnJvYWQgcXVlcmllcy4nLFxuICAgICAgICBzb2x1dGlvbjpcbiAgICAgICAgICBcIkVuc3VyZSBhbGwgcHJvcGVydGllcyBpbiAncmVxdWVzdENvbXBsZXhpdHknIGFyZSBzZXQgdG8gcG9zaXRpdmUgaW50ZWdlcnMuIFNldCB0byAnLTEnIG9ubHkgaWYgeW91IGhhdmUgb3RoZXIgbWl0aWdhdGlvbnMgaW4gcGxhY2UuXCIsXG4gICAgICAgIGNoZWNrOiAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcmMgPSBjb25maWcucmVxdWVzdENvbXBsZXhpdHk7XG4gICAgICAgICAgaWYgKCFyYykge1xuICAgICAgICAgICAgdGhyb3cgMTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgdmFsdWVzID0gW3JjLmluY2x1ZGVEZXB0aCwgcmMuaW5jbHVkZUNvdW50LCByYy5zdWJxdWVyeURlcHRoLCByYy5xdWVyeURlcHRoLCByYy5ncmFwaFFMRGVwdGgsIHJjLmdyYXBoUUxGaWVsZHMsIHJjLmJhdGNoUmVxdWVzdExpbWl0XTtcbiAgICAgICAgICBpZiAodmFsdWVzLnNvbWUodiA9PiB2ID09PSAtMSkpIHtcbiAgICAgICAgICAgIHRocm93IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgICBuZXcgQ2hlY2soe1xuICAgICAgICB0aXRsZTogJ1Bhc3N3b3JkIHJlc2V0IGVuZHBvaW50IHVzZXIgZW51bWVyYXRpb24gbWl0aWdhdGVkJyxcbiAgICAgICAgd2FybmluZzpcbiAgICAgICAgICAnVGhlIHBhc3N3b3JkIHJlc2V0IGVuZHBvaW50IHJldHVybnMgZGlzdGluY3QgZXJyb3IgcmVzcG9uc2VzIGZvciBpbnZhbGlkIGVtYWlsIGFkZHJlc3Nlcywgd2hpY2ggYWxsb3dzIGF0dGFja2VycyB0byBlbnVtZXJhdGUgcmVnaXN0ZXJlZCB1c2Vycy4nLFxuICAgICAgICBzb2x1dGlvbjpcbiAgICAgICAgICBcIkNoYW5nZSBQYXJzZSBTZXJ2ZXIgY29uZmlndXJhdGlvbiB0byAncGFzc3dvcmRQb2xpY3kucmVzZXRQYXNzd29yZFN1Y2Nlc3NPbkludmFsaWRFbWFpbDogdHJ1ZScuXCIsXG4gICAgICAgIGNoZWNrOiAoKSA9PiB7XG4gICAgICAgICAgaWYgKGNvbmZpZy5wYXNzd29yZFBvbGljeT8ucmVzZXRQYXNzd29yZFN1Y2Nlc3NPbkludmFsaWRFbWFpbCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHRocm93IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgICBuZXcgQ2hlY2soe1xuICAgICAgICB0aXRsZTogJ0VtYWlsIHZlcmlmaWNhdGlvbiBlbmRwb2ludCB1c2VyIGVudW1lcmF0aW9uIG1pdGlnYXRlZCcsXG4gICAgICAgIHdhcm5pbmc6XG4gICAgICAgICAgJ1RoZSBlbWFpbCB2ZXJpZmljYXRpb24gZW5kcG9pbnQgcmV0dXJucyBkaXN0aW5jdCBlcnJvciByZXNwb25zZXMgZm9yIGludmFsaWQgZW1haWwgYWRkcmVzc2VzLCB3aGljaCBhbGxvd3MgYXR0YWNrZXJzIHRvIGVudW1lcmF0ZSByZWdpc3RlcmVkIHVzZXJzLicsXG4gICAgICAgIHNvbHV0aW9uOlxuICAgICAgICAgIFwiQ2hhbmdlIFBhcnNlIFNlcnZlciBjb25maWd1cmF0aW9uIHRvICdlbWFpbFZlcmlmeVN1Y2Nlc3NPbkludmFsaWRFbWFpbDogdHJ1ZScuXCIsXG4gICAgICAgIGNoZWNrOiAoKSA9PiB7XG4gICAgICAgICAgaWYgKGNvbmZpZy5lbWFpbFZlcmlmeVN1Y2Nlc3NPbkludmFsaWRFbWFpbCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHRocm93IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgICBuZXcgQ2hlY2soe1xuICAgICAgICB0aXRsZTogJ0xpdmVRdWVyeSByZWdleCB0aW1lb3V0IGVuYWJsZWQnLFxuICAgICAgICB3YXJuaW5nOlxuICAgICAgICAgICdMaXZlUXVlcnkgcmVnZXggdGltZW91dCBpcyBkaXNhYmxlZC4gQSBtYWxpY2lvdXMgY2xpZW50IGNhbiBzdWJzY3JpYmUgd2l0aCBhIGNyYWZ0ZWQgJHJlZ2V4IHBhdHRlcm4gdGhhdCBjYXVzZXMgY2F0YXN0cm9waGljIGJhY2t0cmFja2luZywgYmxvY2tpbmcgdGhlIE5vZGUuanMgZXZlbnQgbG9vcCBhbmQgbWFraW5nIHRoZSBzZXJ2ZXIgdW5yZXNwb25zaXZlLicsXG4gICAgICAgIHNvbHV0aW9uOlxuICAgICAgICAgIFwiQ2hhbmdlIFBhcnNlIFNlcnZlciBjb25maWd1cmF0aW9uIHRvICdsaXZlUXVlcnkucmVnZXhUaW1lb3V0OiAxMDAnIHRvIHNldCBhIDEwMG1zIHRpbWVvdXQgZm9yIHJlZ2V4IGV2YWx1YXRpb24gaW4gTGl2ZVF1ZXJ5LlwiLFxuICAgICAgICBjaGVjazogKCkgPT4ge1xuICAgICAgICAgIGlmIChjb25maWcubGl2ZVF1ZXJ5Py5jbGFzc05hbWVzPy5sZW5ndGggPiAwICYmIGNvbmZpZy5saXZlUXVlcnk/LnJlZ2V4VGltZW91dCA9PT0gMCkge1xuICAgICAgICAgICAgdGhyb3cgMTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICBdO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gQ2hlY2tHcm91cFNlcnZlckNvbmZpZztcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQSxJQUFBQSxNQUFBLEdBQUFDLE9BQUE7QUFDQSxJQUFBQyxXQUFBLEdBQUFDLHNCQUFBLENBQUFGLE9BQUE7QUFDQSxJQUFBRyxPQUFBLEdBQUFELHNCQUFBLENBQUFGLE9BQUE7QUFDQSxJQUFBSSxLQUFBLEdBQUFGLHNCQUFBLENBQUFGLE9BQUE7QUFBK0IsU0FBQUUsdUJBQUFHLENBQUEsV0FBQUEsQ0FBQSxJQUFBQSxDQUFBLENBQUFDLFVBQUEsR0FBQUQsQ0FBQSxLQUFBRSxPQUFBLEVBQUFGLENBQUE7QUFFL0I7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE1BQU1HLHNCQUFzQixTQUFTQyxtQkFBVSxDQUFDO0VBQzlDQyxPQUFPQSxDQUFBLEVBQUc7SUFDUixPQUFPLDRCQUE0QjtFQUNyQztFQUNBQyxTQUFTQSxDQUFBLEVBQUc7SUFDVixNQUFNQyxNQUFNLEdBQUdDLGVBQU0sQ0FBQ0MsR0FBRyxDQUFDQyxhQUFLLENBQUNDLGFBQWEsQ0FBQztJQUM5QyxPQUFPLENBQ0wsSUFBSUMsWUFBSyxDQUFDO01BQ1JDLEtBQUssRUFBRSxtQkFBbUI7TUFDMUJDLE9BQU8sRUFBRSxnRkFBZ0Y7TUFDekZDLFFBQVEsRUFDTix1SUFBdUk7TUFDeklDLEtBQUssRUFBRUEsQ0FBQSxLQUFNO1FBQ1gsTUFBTUMsU0FBUyxHQUFHVixNQUFNLENBQUNVLFNBQVM7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