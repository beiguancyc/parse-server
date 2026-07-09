"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FunctionsRouter = void 0;
var _PromiseRouter = _interopRequireDefault(require("../PromiseRouter"));
var _middlewares = require("../middlewares");
var _StatusHandler = require("../StatusHandler");
var _lodash = _interopRequireDefault(require("lodash"));
var _logger = require("../logger");
var _Error = require("../Error");
var _busboy = _interopRequireDefault(require("@fastify/busboy"));
var _Utils = _interopRequireDefault(require("../Utils"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// FunctionsRouter.js

var Parse = require('parse/node').Parse,
  triggers = require('../triggers');
function redactBuffers(obj) {
  if (Buffer.isBuffer(obj)) {
    return `[Buffer: ${obj.length} bytes]`;
  }
  if (Array.isArray(obj)) {
    return obj.map(redactBuffers);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = redactBuffers(obj[key]);
    }
    return result;
  }
  return obj;
}
function parseObject(obj, config) {
  if (Array.isArray(obj)) {
    return obj.map(item => {
      return parseObject(item, config);
    });
  } else if (obj && obj.__type == 'Date') {
    return Object.assign(new Date(obj.iso), obj);
  } else if (obj && obj.__type == 'File') {
    if (obj.url) {
      const {
        validateFileUrl
      } = require('../FileUrlValidator');
      validateFileUrl(obj.url, config);
    }
    return Parse.File.fromJSON(obj);
  } else if (obj && obj.__type == 'Pointer') {
    return Parse.Object.fromJSON({
      __type: 'Pointer',
      className: obj.className,
      objectId: obj.objectId
    });
  } else if (Buffer.isBuffer(obj)) {
    return obj;
  } else if (obj && typeof obj === 'object') {
    return parseParams(obj, config);
  } else {
    return obj;
  }
}
function parseParams(params, config) {
  return _lodash.default.mapValues(params, item => parseObject(item, config));
}
class FunctionsRouter extends _PromiseRouter.default {
  mountRoutes() {
    this.route('POST', '/functions/:functionName', _middlewares.promiseEnsureIdempotency, FunctionsRouter.multipartMiddleware, FunctionsRouter.handleCloudFunction);
    this.route('POST', '/jobs/:jobName', _middlewares.promiseEnsureIdempotency, _middlewares.promiseEnforceMasterKeyAccess, function (req) {
      return FunctionsRouter.handleCloudJob(req);
    });
    this.route('POST', '/jobs', _middlewares.promiseEnforceMasterKeyAccess, function (req) {
      return FunctionsRouter.handleCloudJob(req);
    });
  }
  static handleCloudJob(req) {
    if (req.auth.isReadOnly) {
      throw (0, _Error.createSanitizedError)(Parse.Error.OPERATION_FORBIDDEN, "read-only masterKey isn't allowed to run a job.", req.config);
    }
    const jobName = req.params.jobName || req.body?.jobName;
    const applicationId = req.config.applicationId;
    const jobHandler = (0, _StatusHandler.jobStatusHandler)(req.config);
    const jobFunction = triggers.getJob(jobName, applicationId);
    if (!jobFunction) {
      throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Invalid job.');
    }
    let params = Object.assign({}, req.body, req.query);
    params = parseParams(params, req.config);
    const request = {
      params: params,
      log: req.config.loggerController,
      headers: req.config.headers,
      ip: req.config.ip,
      jobName,
      config: req.config,
      message: jobHandler.setMessage.bind(jobHandler)
    };
    return jobHandler.setRunning(jobName).then(jobStatus => {
      request.jobId = jobStatus.objectId;
      // run the function async
      process.nextTick(() => {
        Promise.resolve().then(() => {
          return jobFunction(request);
        }).then(result => {
          jobHandler.setSucceeded(result);
        }, error => {
          jobHandler.setFailed(error);
        });
      });
      return {
        headers: {
          'X-Parse-Job-Status-Id': jobStatus.objectId
        },
        response: {}
      };
    });
  }
  static createResponseObject(resolve, reject, statusCode = null) {
    let httpStatusCode = statusCode;
    const customHeaders = {};
    let responseSent = false;
    const responseObject = {
      success: function (result) {
        if (responseSent) {
          throw new Error('Cannot call success() after response has already been sent. Make sure to call success() or error() only once per cloud function execution.');
        }
        responseSent = true;
        const response = {
          response: {
            result: Parse._encode(result)
          }
        };
        if (httpStatusCode !== null) {
          response.status = httpStatusCode;
        }
        if (Object.keys(customHeaders).length > 0) {
          response.headers = customHeaders;
        }
        resolve(response);
      },
      error: function (message) {
        if (responseSent) {
          throw new Error('Cannot call error() after response has already been sent. Make sure to call success() or error() only once per cloud function execution.');
        }
        responseSent = true;
        const error = triggers.resolveError(message);
        // If a custom status code was set, attach it to the error
        if (httpStatusCode !== null) {
          error.status = httpStatusCode;
        }
        reject(error);
      },
      status: function (code) {
        httpStatusCode = code;
        return responseObject;
      },
      header: function (key, value) {
        customHeaders[key] = value;
        return responseObject;
      },
      _isResponseSent: () => responseSent
    };
    return responseObject;
  }

  /**
   * Parses multipart/form-data requests for Cloud Function invocation.
   * For non-multipart requests, this is a no-op.
   *
   * Text fields are set as strings in `req.body`. File fields are set as
   * objects with the shape `{ filename: string, contentType: string, data: Buffer }`.
   * All fields are merged flat into `req.body`; the caller is responsible for
   * avoiding name collisions between text and file fields.
   *
   * The total request size is limited by the server's `maxUploadSize` option.
   */
  static multipartMiddleware(req) {
    if (!req.is || !req.is('multipart/form-data')) {
      return Promise.resolve();
    }
    const maxBytes = _Utils.default.parseSizeToBytes(req.config.maxUploadSize);
    return new Promise((resolve, reject) => {
      const fields = Object.create(null);
      let totalBytes = 0;
      let settled = false;
      let busboy;
      try {
        busboy = (0, _busboy.default)({
          headers: req.headers,
          limits: {
            fieldSize: maxBytes
          }
        });
      } catch (err) {
        return reject(new Parse.Error(Parse.Error.INVALID_JSON, `Invalid multipart request: ${err.message}`));
      }
      const safeReject = err => {
        if (settled) {
          return;
        }
        settled = true;
        busboy.destroy();
        reject(err);
      };
      busboy.on('field', (name, value, fieldnameTruncated, valueTruncated) => {
        if (valueTruncated) {
          return safeReject(new Parse.Error(Parse.Error.OBJECT_TOO_LARGE, 'Multipart request exceeds maximum upload size.'));
        }
        totalBytes += Buffer.byteLength(value);
        if (totalBytes > maxBytes) {
          return safeReject(new Parse.Error(Parse.Error.OBJECT_TOO_LARGE, 'Multipart request exceeds maximum upload size.'));
        }
        fields[name] = value;
      });
      busboy.on('file', (name, stream, filename, transferEncoding, mimeType) => {
        const chunks = [];
        stream.on('data', chunk => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            stream.destroy();
            return safeReject(new Parse.Error(Parse.Error.OBJECT_TOO_LARGE, 'Multipart request exceeds maximum upload size.'));
          }
          chunks.push(chunk);
        });
        stream.on('end', () => {
          if (settled) {
            return;
          }
          fields[name] = {
            filename,
            contentType: mimeType || 'application/octet-stream',
            data: Buffer.concat(chunks)
          };
        });
      });
      busboy.on('finish', () => {
        if (settled) {
          return;
        }
        settled = true;
        req.body = fields;
        resolve();
      });
      busboy.on('error', err => {
        safeReject(new Parse.Error(Parse.Error.INVALID_JSON, `Invalid multipart request: ${err.message}`));
      });
      req.pipe(busboy);
    });
  }
  static handleCloudFunction(req) {
    const functionName = req.params.functionName;
    const applicationId = req.config.applicationId;
    const theFunction = triggers.getFunction(functionName, applicationId);
    if (!theFunction) {
      throw new Parse.Error(Parse.Error.SCRIPT_FAILED, `Invalid function: "${functionName}"`);
    }
    let params = Object.assign({}, req.body, req.query);
    params = parseParams(params, req.config);
    const request = {
      params: params,
      config: req.config,
      master: req.auth && req.auth.isMaster,
      isReadOnly: !!(req.auth && req.auth.isReadOnly),
      user: req.auth && req.auth.user,
      installationId: req.info.installationId,
      log: req.config.loggerController,
      headers: req.config.headers,
      ip: req.config.ip,
      functionName,
      context: req.info.context
    };
    return new Promise(function (resolve, reject) {
      const userString = req.auth && req.auth.user ? req.auth.user.id : undefined;
      const responseObject = FunctionsRouter.createResponseObject(result => {
        try {
          if (req.config.logLevels.cloudFunctionSuccess !== 'silent') {
            const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(redactBuffers(params)));
            const cleanResult = _logger.logger.truncateLogMessage(JSON.stringify(result.response.result));
            _logger.logger[req.config.logLevels.cloudFunctionSuccess](`Ran cloud function ${functionName} for user ${userString} with:\n  Input: ${cleanInput}\n  Result: ${cleanResult}`, {
              functionName,
              params,
              user: userString
            });
          }
          resolve(result);
        } catch (e) {
          reject(e);
        }
      }, error => {
        try {
          if (req.config.logLevels.cloudFunctionError !== 'silent') {
            const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(redactBuffers(params)));
            _logger.logger[req.config.logLevels.cloudFunctionError](`Failed running cloud function ${functionName} for user ${userString} with:\n  Input: ${cleanInput}\n  Error: ` + JSON.stringify(error), {
              functionName,
              error,
              params,
              user: userString
            });
          }
          reject(error);
        } catch (e) {
          reject(e);
        }
      });
      const {
        success,
        error
      } = responseObject;
      return Promise.resolve().then(() => {
        return triggers.maybeRunValidator(request, functionName, req.auth);
      }).then(() => {
        // Check if function expects 2 parameters (req, res) - Express style
        if (theFunction.length >= 2) {
          return theFunction(request, responseObject);
        } else {
          // Traditional style - single parameter
          return theFunction(request);
        }
      }).then(result => {
        // For Express-style functions, only send response if not already sent
        if (theFunction.length >= 2) {
          if (!responseObject._isResponseSent()) {
            // If Express-style function returns a value without calling res.success/error
            if (result !== undefined) {
              success(result);
            }
            // If no response sent and no value returned, this is an error in user code
            // but we don't handle it here to maintain backward compatibility
          }
        } else {
          // For traditional functions, always call success with the result (even if undefined)
          success(result);
        }
      }, error);
    });
  }
}
exports.FunctionsRouter = FunctionsRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfUHJvbWlzZVJvdXRlciIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiX21pZGRsZXdhcmVzIiwiX1N0YXR1c0hhbmRsZXIiLCJfbG9kYXNoIiwiX2xvZ2dlciIsIl9FcnJvciIsIl9idXNib3kiLCJfVXRpbHMiLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJQYXJzZSIsInRyaWdnZXJzIiwicmVkYWN0QnVmZmVycyIsIm9iaiIsIkJ1ZmZlciIsImlzQnVmZmVyIiwibGVuZ3RoIiwiQXJyYXkiLCJpc0FycmF5IiwibWFwIiwicmVzdWx0Iiwia2V5IiwiT2JqZWN0Iiwia2V5cyIsInBhcnNlT2JqZWN0IiwiY29uZmlnIiwiaXRlbSIsIl9fdHlwZSIsImFzc2lnbiIsIkRhdGUiLCJpc28iLCJ1cmwiLCJ2YWxpZGF0ZUZpbGVVcmwiLCJGaWxlIiwiZnJvbUpTT04iLCJjbGFzc05hbWUiLCJvYmplY3RJZCIsInBhcnNlUGFyYW1zIiwicGFyYW1zIiwiXyIsIm1hcFZhbHVlcyIsIkZ1bmN0aW9uc1JvdXRlciIsIlByb21pc2VSb3V0ZXIiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwicHJvbWlzZUVuc3VyZUlkZW1wb3RlbmN5IiwibXVsdGlwYXJ0TWlkZGxld2FyZSIsImhhbmRsZUNsb3VkRnVuY3Rpb24iLCJwcm9taXNlRW5mb3JjZU1hc3RlcktleUFjY2VzcyIsInJlcSIsImhhbmRsZUNsb3VkSm9iIiwiYXV0aCIsImlzUmVhZE9ubHkiLCJjcmVhdGVTYW5pdGl6ZWRFcnJvciIsIkVycm9yIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsImpvYk5hbWUiLCJib2R5IiwiYXBwbGljYXRpb25JZCIsImpvYkhhbmRsZXIiLCJqb2JTdGF0dXNIYW5kbGVyIiwiam9iRnVuY3Rpb24iLCJnZXRKb2IiLCJTQ1JJUFRfRkFJTEVEIiwicXVlcnkiLCJyZXF1ZXN0IiwibG9nIiwibG9nZ2VyQ29udHJvbGxlciIsImhlYWRlcnMiLCJpcCIsIm1lc3NhZ2UiLCJzZXRNZXNzYWdlIiwiYmluZCIsInNldFJ1bm5pbmciLCJ0aGVuIiwiam9iU3RhdHVzIiwiam9iSWQiLCJwcm9jZXNzIiwibmV4dFRpY2siLCJQcm9taXNlIiwicmVzb2x2ZSIsInNldFN1Y2NlZWRlZCIsImVycm9yIiwic2V0RmFpbGVkIiwicmVzcG9uc2UiLCJjcmVhdGVSZXNwb25zZU9iamVjdCIsInJlamVjdCIsInN0YXR1c0NvZGUiLCJodHRwU3RhdHVzQ29kZSIsImN1c3RvbUhlYWRlcnMiLCJyZXNwb25zZVNlbnQiLCJyZXNwb25zZU9iamVjdCIsInN1Y2Nlc3MiLCJfZW5jb2RlIiwic3RhdHVzIiwicmVzb2x2ZUVycm9yIiwiY29kZSIsImhlYWRlciIsInZhbHVlIiwiX2lzUmVzcG9uc2VTZW50IiwiaXMiLCJtYXhCeXRlcyIsIlV0aWxzIiwicGFyc2VTaXplVG9CeXRlcyIsIm1heFVwbG9hZFNpemUiLCJmaWVsZHMiLCJjcmVhdGUiLCJ0b3RhbEJ5dGVzIiwic2V0dGxlZCIsImJ1c2JveSIsIkJ1c2JveSIsImxpbWl0cyIsImZpZWxkU2l6ZSIsImVyciIsIklOVkFMSURfSlNPTiIsInNhZmVSZWplY3QiLCJkZXN0cm95Iiwib24iLCJuYW1lIiwiZmllbGRuYW1lVHJ1bmNhdGVkIiwidmFsdWVUcnVuY2F0ZWQiLCJPQkpFQ1RfVE9PX0xBUkdFIiwiYnl0ZUxlbmd0aCIsInN0cmVhbSIsImZpbGVuYW1lIiwidHJhbnNmZXJFbmNvZGluZyIsIm1pbWVUeXBlIiwiY2h1bmtzIiwiY2h1bmsiLCJwdXNoIiwiY29udGVudFR5cGUiLCJkYXRhIiwiY29uY2F0IiwicGlwZSIsImZ1bmN0aW9uTmFtZSIsInRoZUZ1bmN0aW9uIiwiZ2V0RnVuY3Rpb24iLCJtYXN0ZXIiLCJpc01hc3RlciIsInVzZXIiLCJpbnN0YWxsYXRpb25JZCIsImluZm8iLCJjb250ZXh0IiwidXNlclN0cmluZyIsImlkIiwidW5kZWZpbmVkIiwibG9nTGV2ZWxzIiwiY2xvdWRGdW5jdGlvblN1Y2Nlc3MiLCJjbGVhbklucHV0IiwibG9nZ2VyIiwidHJ1bmNhdGVMb2dNZXNzYWdlIiwiSlNPTiIsInN0cmluZ2lmeSIsImNsZWFuUmVzdWx0IiwiY2xvdWRGdW5jdGlvbkVycm9yIiwibWF5YmVSdW5WYWxpZGF0b3IiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL1JvdXRlcnMvRnVuY3Rpb25zUm91dGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIEZ1bmN0aW9uc1JvdXRlci5qc1xuXG52YXIgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJykuUGFyc2UsXG4gIHRyaWdnZXJzID0gcmVxdWlyZSgnLi4vdHJpZ2dlcnMnKTtcblxuaW1wb3J0IFByb21pc2VSb3V0ZXIgZnJvbSAnLi4vUHJvbWlzZVJvdXRlcic7XG5pbXBvcnQgeyBwcm9taXNlRW5mb3JjZU1hc3RlcktleUFjY2VzcywgcHJvbWlzZUVuc3VyZUlkZW1wb3RlbmN5IH0gZnJvbSAnLi4vbWlkZGxld2FyZXMnO1xuaW1wb3J0IHsgam9iU3RhdHVzSGFuZGxlciB9IGZyb20gJy4uL1N0YXR1c0hhbmRsZXInO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlcic7XG5pbXBvcnQgeyBjcmVhdGVTYW5pdGl6ZWRFcnJvciB9IGZyb20gJy4uL0Vycm9yJztcbmltcG9ydCBCdXNib3kgZnJvbSAnQGZhc3RpZnkvYnVzYm95JztcbmltcG9ydCBVdGlscyBmcm9tICcuLi9VdGlscyc7XG5cbmZ1bmN0aW9uIHJlZGFjdEJ1ZmZlcnMob2JqKSB7XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIob2JqKSkge1xuICAgIHJldHVybiBgW0J1ZmZlcjogJHtvYmoubGVuZ3RofSBieXRlc11gO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KG9iaikpIHtcbiAgICByZXR1cm4gb2JqLm1hcChyZWRhY3RCdWZmZXJzKTtcbiAgfVxuICBpZiAob2JqICYmIHR5cGVvZiBvYmogPT09ICdvYmplY3QnKSB7XG4gICAgY29uc3QgcmVzdWx0ID0ge307XG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMob2JqKSkge1xuICAgICAgcmVzdWx0W2tleV0gPSByZWRhY3RCdWZmZXJzKG9ialtrZXldKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuICByZXR1cm4gb2JqO1xufVxuXG5mdW5jdGlvbiBwYXJzZU9iamVjdChvYmosIGNvbmZpZykge1xuICBpZiAoQXJyYXkuaXNBcnJheShvYmopKSB7XG4gICAgcmV0dXJuIG9iai5tYXAoaXRlbSA9PiB7XG4gICAgICByZXR1cm4gcGFyc2VPYmplY3QoaXRlbSwgY29uZmlnKTtcbiAgICB9KTtcbiAgfSBlbHNlIGlmIChvYmogJiYgb2JqLl9fdHlwZSA9PSAnRGF0ZScpIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihuZXcgRGF0ZShvYmouaXNvKSwgb2JqKTtcbiAgfSBlbHNlIGlmIChvYmogJiYgb2JqLl9fdHlwZSA9PSAnRmlsZScpIHtcbiAgICBpZiAob2JqLnVybCkge1xuICAgICAgY29uc3QgeyB2YWxpZGF0ZUZpbGVVcmwgfSA9IHJlcXVpcmUoJy4uL0ZpbGVVcmxWYWxpZGF0b3InKTtcbiAgICAgIHZhbGlkYXRlRmlsZVVybChvYmoudXJsLCBjb25maWcpO1xuICAgIH1cbiAgICByZXR1cm4gUGFyc2UuRmlsZS5mcm9tSlNPTihvYmopO1xuICB9IGVsc2UgaWYgKG9iaiAmJiBvYmouX190eXBlID09ICdQb2ludGVyJykge1xuICAgIHJldHVybiBQYXJzZS5PYmplY3QuZnJvbUpTT04oe1xuICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICBjbGFzc05hbWU6IG9iai5jbGFzc05hbWUsXG4gICAgICBvYmplY3RJZDogb2JqLm9iamVjdElkLFxuICAgIH0pO1xuICB9IGVsc2UgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmopKSB7XG4gICAgcmV0dXJuIG9iajtcbiAgfSBlbHNlIGlmIChvYmogJiYgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gcGFyc2VQYXJhbXMob2JqLCBjb25maWcpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBvYmo7XG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VQYXJhbXMocGFyYW1zLCBjb25maWcpIHtcbiAgcmV0dXJuIF8ubWFwVmFsdWVzKHBhcmFtcywgaXRlbSA9PiBwYXJzZU9iamVjdChpdGVtLCBjb25maWcpKTtcbn1cblxuZXhwb3J0IGNsYXNzIEZ1bmN0aW9uc1JvdXRlciBleHRlbmRzIFByb21pc2VSb3V0ZXIge1xuICBtb3VudFJvdXRlcygpIHtcbiAgICB0aGlzLnJvdXRlKFxuICAgICAgJ1BPU1QnLFxuICAgICAgJy9mdW5jdGlvbnMvOmZ1bmN0aW9uTmFtZScsXG4gICAgICBwcm9taXNlRW5zdXJlSWRlbXBvdGVuY3ksXG4gICAgICBGdW5jdGlvbnNSb3V0ZXIubXVsdGlwYXJ0TWlkZGxld2FyZSxcbiAgICAgIEZ1bmN0aW9uc1JvdXRlci5oYW5kbGVDbG91ZEZ1bmN0aW9uXG4gICAgKTtcbiAgICB0aGlzLnJvdXRlKFxuICAgICAgJ1BPU1QnLFxuICAgICAgJy9qb2JzLzpqb2JOYW1lJyxcbiAgICAgIHByb21pc2VFbnN1cmVJZGVtcG90ZW5jeSxcbiAgICAgIHByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzLFxuICAgICAgZnVuY3Rpb24gKHJlcSkge1xuICAgICAgICByZXR1cm4gRnVuY3Rpb25zUm91dGVyLmhhbmRsZUNsb3VkSm9iKHJlcSk7XG4gICAgICB9XG4gICAgKTtcbiAgICB0aGlzLnJvdXRlKCdQT1NUJywgJy9qb2JzJywgcHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MsIGZ1bmN0aW9uIChyZXEpIHtcbiAgICAgIHJldHVybiBGdW5jdGlvbnNSb3V0ZXIuaGFuZGxlQ2xvdWRKb2IocmVxKTtcbiAgICB9KTtcbiAgfVxuXG4gIHN0YXRpYyBoYW5kbGVDbG91ZEpvYihyZXEpIHtcbiAgICBpZiAocmVxLmF1dGguaXNSZWFkT25seSkge1xuICAgICAgdGhyb3cgY3JlYXRlU2FuaXRpemVkRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAgIFwicmVhZC1vbmx5IG1hc3RlcktleSBpc24ndCBhbGxvd2VkIHRvIHJ1biBhIGpvYi5cIixcbiAgICAgICAgcmVxLmNvbmZpZ1xuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3Qgam9iTmFtZSA9IHJlcS5wYXJhbXMuam9iTmFtZSB8fCByZXEuYm9keT8uam9iTmFtZTtcbiAgICBjb25zdCBhcHBsaWNhdGlvbklkID0gcmVxLmNvbmZpZy5hcHBsaWNhdGlvbklkO1xuICAgIGNvbnN0IGpvYkhhbmRsZXIgPSBqb2JTdGF0dXNIYW5kbGVyKHJlcS5jb25maWcpO1xuICAgIGNvbnN0IGpvYkZ1bmN0aW9uID0gdHJpZ2dlcnMuZ2V0Sm9iKGpvYk5hbWUsIGFwcGxpY2F0aW9uSWQpO1xuICAgIGlmICgham9iRnVuY3Rpb24pIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5TQ1JJUFRfRkFJTEVELCAnSW52YWxpZCBqb2IuJyk7XG4gICAgfVxuICAgIGxldCBwYXJhbXMgPSBPYmplY3QuYXNzaWduKHt9LCByZXEuYm9keSwgcmVxLnF1ZXJ5KTtcbiAgICBwYXJhbXMgPSBwYXJzZVBhcmFtcyhwYXJhbXMsIHJlcS5jb25maWcpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICBwYXJhbXM6IHBhcmFtcyxcbiAgICAgIGxvZzogcmVxLmNvbmZpZy5sb2dnZXJDb250cm9sbGVyLFxuICAgICAgaGVhZGVyczogcmVxLmNvbmZpZy5oZWFkZXJzLFxuICAgICAgaXA6IHJlcS5jb25maWcuaXAsXG4gICAgICBqb2JOYW1lLFxuICAgICAgY29uZmlnOiByZXEuY29uZmlnLFxuICAgICAgbWVzc2FnZTogam9iSGFuZGxlci5zZXRNZXNzYWdlLmJpbmQoam9iSGFuZGxlciksXG4gICAgfTtcblxuICAgIHJldHVybiBqb2JIYW5kbGVyLnNldFJ1bm5pbmcoam9iTmFtZSkudGhlbihqb2JTdGF0dXMgPT4ge1xuICAgICAgcmVxdWVzdC5qb2JJZCA9IGpvYlN0YXR1cy5vYmplY3RJZDtcbiAgICAgIC8vIHJ1biB0aGUgZnVuY3Rpb24gYXN5bmNcbiAgICAgIHByb2Nlc3MubmV4dFRpY2soKCkgPT4ge1xuICAgICAgICBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBqb2JGdW5jdGlvbihyZXF1ZXN0KTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC50aGVuKFxuICAgICAgICAgICAgcmVzdWx0ID0+IHtcbiAgICAgICAgICAgICAgam9iSGFuZGxlci5zZXRTdWNjZWVkZWQocmVzdWx0KTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBlcnJvciA9PiB7XG4gICAgICAgICAgICAgIGpvYkhhbmRsZXIuc2V0RmFpbGVkKGVycm9yKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ1gtUGFyc2UtSm9iLVN0YXR1cy1JZCc6IGpvYlN0YXR1cy5vYmplY3RJZCxcbiAgICAgICAgfSxcbiAgICAgICAgcmVzcG9uc2U6IHt9LFxuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIHN0YXRpYyBjcmVhdGVSZXNwb25zZU9iamVjdChyZXNvbHZlLCByZWplY3QsIHN0YXR1c0NvZGUgPSBudWxsKSB7XG4gICAgbGV0IGh0dHBTdGF0dXNDb2RlID0gc3RhdHVzQ29kZTtcbiAgICBjb25zdCBjdXN0b21IZWFkZXJzID0ge307XG4gICAgbGV0IHJlc3BvbnNlU2VudCA9IGZhbHNlO1xuICAgIGNvbnN0IHJlc3BvbnNlT2JqZWN0ID0ge1xuICAgICAgc3VjY2VzczogZnVuY3Rpb24gKHJlc3VsdCkge1xuICAgICAgICBpZiAocmVzcG9uc2VTZW50KSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgY2FsbCBzdWNjZXNzKCkgYWZ0ZXIgcmVzcG9uc2UgaGFzIGFscmVhZHkgYmVlbiBzZW50LiBNYWtlIHN1cmUgdG8gY2FsbCBzdWNjZXNzKCkgb3IgZXJyb3IoKSBvbmx5IG9uY2UgcGVyIGNsb3VkIGZ1bmN0aW9uIGV4ZWN1dGlvbi4nKTtcbiAgICAgICAgfVxuICAgICAgICByZXNwb25zZVNlbnQgPSB0cnVlO1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IHtcbiAgICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgICAgcmVzdWx0OiBQYXJzZS5fZW5jb2RlKHJlc3VsdCksXG4gICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKGh0dHBTdGF0dXNDb2RlICE9PSBudWxsKSB7XG4gICAgICAgICAgcmVzcG9uc2Uuc3RhdHVzID0gaHR0cFN0YXR1c0NvZGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKGN1c3RvbUhlYWRlcnMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICByZXNwb25zZS5oZWFkZXJzID0gY3VzdG9tSGVhZGVycztcbiAgICAgICAgfVxuICAgICAgICByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICAgIH0sXG4gICAgICBlcnJvcjogZnVuY3Rpb24gKG1lc3NhZ2UpIHtcbiAgICAgICAgaWYgKHJlc3BvbnNlU2VudCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGNhbGwgZXJyb3IoKSBhZnRlciByZXNwb25zZSBoYXMgYWxyZWFkeSBiZWVuIHNlbnQuIE1ha2Ugc3VyZSB0byBjYWxsIHN1Y2Nlc3MoKSBvciBlcnJvcigpIG9ubHkgb25jZSBwZXIgY2xvdWQgZnVuY3Rpb24gZXhlY3V0aW9uLicpO1xuICAgICAgICB9XG4gICAgICAgIHJlc3BvbnNlU2VudCA9IHRydWU7XG4gICAgICAgIGNvbnN0IGVycm9yID0gdHJpZ2dlcnMucmVzb2x2ZUVycm9yKG1lc3NhZ2UpO1xuICAgICAgICAvLyBJZiBhIGN1c3RvbSBzdGF0dXMgY29kZSB3YXMgc2V0LCBhdHRhY2ggaXQgdG8gdGhlIGVycm9yXG4gICAgICAgIGlmIChodHRwU3RhdHVzQ29kZSAhPT0gbnVsbCkge1xuICAgICAgICAgIGVycm9yLnN0YXR1cyA9IGh0dHBTdGF0dXNDb2RlO1xuICAgICAgICB9XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9LFxuICAgICAgc3RhdHVzOiBmdW5jdGlvbiAoY29kZSkge1xuICAgICAgICBodHRwU3RhdHVzQ29kZSA9IGNvZGU7XG4gICAgICAgIHJldHVybiByZXNwb25zZU9iamVjdDtcbiAgICAgIH0sXG4gICAgICBoZWFkZXI6IGZ1bmN0aW9uIChrZXksIHZhbHVlKSB7XG4gICAgICAgIGN1c3RvbUhlYWRlcnNba2V5XSA9IHZhbHVlO1xuICAgICAgICByZXR1cm4gcmVzcG9uc2VPYmplY3Q7XG4gICAgICB9LFxuICAgICAgX2lzUmVzcG9uc2VTZW50OiAoKSA9PiByZXNwb25zZVNlbnQsXG4gICAgfTtcbiAgICByZXR1cm4gcmVzcG9uc2VPYmplY3Q7XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIG11bHRpcGFydC9mb3JtLWRhdGEgcmVxdWVzdHMgZm9yIENsb3VkIEZ1bmN0aW9uIGludm9jYXRpb24uXG4gICAqIEZvciBub24tbXVsdGlwYXJ0IHJlcXVlc3RzLCB0aGlzIGlzIGEgbm8tb3AuXG4gICAqXG4gICAqIFRleHQgZmllbGRzIGFyZSBzZXQgYXMgc3RyaW5ncyBpbiBgcmVxLmJvZHlgLiBGaWxlIGZpZWxkcyBhcmUgc2V0IGFzXG4gICAqIG9iamVjdHMgd2l0aCB0aGUgc2hhcGUgYHsgZmlsZW5hbWU6IHN0cmluZywgY29udGVudFR5cGU6IHN0cmluZywgZGF0YTogQnVmZmVyIH1gLlxuICAgKiBBbGwgZmllbGRzIGFyZSBtZXJnZWQgZmxhdCBpbnRvIGByZXEuYm9keWA7IHRoZSBjYWxsZXIgaXMgcmVzcG9uc2libGUgZm9yXG4gICAqIGF2b2lkaW5nIG5hbWUgY29sbGlzaW9ucyBiZXR3ZWVuIHRleHQgYW5kIGZpbGUgZmllbGRzLlxuICAgKlxuICAgKiBUaGUgdG90YWwgcmVxdWVzdCBzaXplIGlzIGxpbWl0ZWQgYnkgdGhlIHNlcnZlcidzIGBtYXhVcGxvYWRTaXplYCBvcHRpb24uXG4gICAqL1xuICBzdGF0aWMgbXVsdGlwYXJ0TWlkZGxld2FyZShyZXEpIHtcbiAgICBpZiAoIXJlcS5pcyB8fCAhcmVxLmlzKCdtdWx0aXBhcnQvZm9ybS1kYXRhJykpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgY29uc3QgbWF4Qnl0ZXMgPSBVdGlscy5wYXJzZVNpemVUb0J5dGVzKHJlcS5jb25maWcubWF4VXBsb2FkU2l6ZSk7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IGZpZWxkcyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgICBsZXQgdG90YWxCeXRlcyA9IDA7XG4gICAgICBsZXQgc2V0dGxlZCA9IGZhbHNlO1xuICAgICAgbGV0IGJ1c2JveTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGJ1c2JveSA9IEJ1c2JveSh7IGhlYWRlcnM6IHJlcS5oZWFkZXJzLCBsaW1pdHM6IHsgZmllbGRTaXplOiBtYXhCeXRlcyB9IH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHJldHVybiByZWplY3QoXG4gICAgICAgICAgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYEludmFsaWQgbXVsdGlwYXJ0IHJlcXVlc3Q6ICR7ZXJyLm1lc3NhZ2V9YClcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHNhZmVSZWplY3QgPSAoZXJyKSA9PiB7XG4gICAgICAgIGlmIChzZXR0bGVkKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNldHRsZWQgPSB0cnVlO1xuICAgICAgICBidXNib3kuZGVzdHJveSgpO1xuICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgIH07XG4gICAgICBidXNib3kub24oJ2ZpZWxkJywgKG5hbWUsIHZhbHVlLCBmaWVsZG5hbWVUcnVuY2F0ZWQsIHZhbHVlVHJ1bmNhdGVkKSA9PiB7XG4gICAgICAgIGlmICh2YWx1ZVRydW5jYXRlZCkge1xuICAgICAgICAgIHJldHVybiBzYWZlUmVqZWN0KFxuICAgICAgICAgICAgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5PQkpFQ1RfVE9PX0xBUkdFLFxuICAgICAgICAgICAgICAnTXVsdGlwYXJ0IHJlcXVlc3QgZXhjZWVkcyBtYXhpbXVtIHVwbG9hZCBzaXplLidcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHRvdGFsQnl0ZXMgKz0gQnVmZmVyLmJ5dGVMZW5ndGgodmFsdWUpO1xuICAgICAgICBpZiAodG90YWxCeXRlcyA+IG1heEJ5dGVzKSB7XG4gICAgICAgICAgcmV0dXJuIHNhZmVSZWplY3QoXG4gICAgICAgICAgICBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLk9CSkVDVF9UT09fTEFSR0UsXG4gICAgICAgICAgICAgICdNdWx0aXBhcnQgcmVxdWVzdCBleGNlZWRzIG1heGltdW0gdXBsb2FkIHNpemUuJ1xuICAgICAgICAgICAgKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgZmllbGRzW25hbWVdID0gdmFsdWU7XG4gICAgICB9KTtcbiAgICAgIGJ1c2JveS5vbignZmlsZScsIChuYW1lLCBzdHJlYW0sIGZpbGVuYW1lLCB0cmFuc2ZlckVuY29kaW5nLCBtaW1lVHlwZSkgPT4ge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBbXTtcbiAgICAgICAgc3RyZWFtLm9uKCdkYXRhJywgY2h1bmsgPT4ge1xuICAgICAgICAgIHRvdGFsQnl0ZXMgKz0gY2h1bmsubGVuZ3RoO1xuICAgICAgICAgIGlmICh0b3RhbEJ5dGVzID4gbWF4Qnl0ZXMpIHtcbiAgICAgICAgICAgIHN0cmVhbS5kZXN0cm95KCk7XG4gICAgICAgICAgICByZXR1cm4gc2FmZVJlamVjdChcbiAgICAgICAgICAgICAgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLk9CSkVDVF9UT09fTEFSR0UsXG4gICAgICAgICAgICAgICAgJ011bHRpcGFydCByZXF1ZXN0IGV4Y2VlZHMgbWF4aW11bSB1cGxvYWQgc2l6ZS4nXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNodW5rcy5wdXNoKGNodW5rKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHN0cmVhbS5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIGlmIChzZXR0bGVkKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGZpZWxkc1tuYW1lXSA9IHtcbiAgICAgICAgICAgIGZpbGVuYW1lLFxuICAgICAgICAgICAgY29udGVudFR5cGU6IG1pbWVUeXBlIHx8ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nLFxuICAgICAgICAgICAgZGF0YTogQnVmZmVyLmNvbmNhdChjaHVua3MpLFxuICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICBidXNib3kub24oJ2ZpbmlzaCcsICgpID0+IHtcbiAgICAgICAgaWYgKHNldHRsZWQpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2V0dGxlZCA9IHRydWU7XG4gICAgICAgIHJlcS5ib2R5ID0gZmllbGRzO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICAgIGJ1c2JveS5vbignZXJyb3InLCBlcnIgPT4ge1xuICAgICAgICBzYWZlUmVqZWN0KFxuICAgICAgICAgIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGBJbnZhbGlkIG11bHRpcGFydCByZXF1ZXN0OiAke2Vyci5tZXNzYWdlfWApXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICAgIHJlcS5waXBlKGJ1c2JveSk7XG4gICAgfSk7XG4gIH1cblxuICBzdGF0aWMgaGFuZGxlQ2xvdWRGdW5jdGlvbihyZXEpIHtcbiAgICBjb25zdCBmdW5jdGlvbk5hbWUgPSByZXEucGFyYW1zLmZ1bmN0aW9uTmFtZTtcbiAgICBjb25zdCBhcHBsaWNhdGlvbklkID0gcmVxLmNvbmZpZy5hcHBsaWNhdGlvbklkO1xuICAgIGNvbnN0IHRoZUZ1bmN0aW9uID0gdHJpZ2dlcnMuZ2V0RnVuY3Rpb24oZnVuY3Rpb25OYW1lLCBhcHBsaWNhdGlvbklkKTtcblxuICAgIGlmICghdGhlRnVuY3Rpb24pIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5TQ1JJUFRfRkFJTEVELCBgSW52YWxpZCBmdW5jdGlvbjogXCIke2Z1bmN0aW9uTmFtZX1cImApO1xuICAgIH1cbiAgICBsZXQgcGFyYW1zID0gT2JqZWN0LmFzc2lnbih7fSwgcmVxLmJvZHksIHJlcS5xdWVyeSk7XG4gICAgcGFyYW1zID0gcGFyc2VQYXJhbXMocGFyYW1zLCByZXEuY29uZmlnKTtcbiAgICBjb25zdCByZXF1ZXN0ID0ge1xuICAgICAgcGFyYW1zOiBwYXJhbXMsXG4gICAgICBjb25maWc6IHJlcS5jb25maWcsXG4gICAgICBtYXN0ZXI6IHJlcS5hdXRoICYmIHJlcS5hdXRoLmlzTWFzdGVyLFxuICAgICAgaXNSZWFkT25seTogISEocmVxLmF1dGggJiYgcmVxLmF1dGguaXNSZWFkT25seSksXG4gICAgICB1c2VyOiByZXEuYXV0aCAmJiByZXEuYXV0aC51c2VyLFxuICAgICAgaW5zdGFsbGF0aW9uSWQ6IHJlcS5pbmZvLmluc3RhbGxhdGlvbklkLFxuICAgICAgbG9nOiByZXEuY29uZmlnLmxvZ2dlckNvbnRyb2xsZXIsXG4gICAgICBoZWFkZXJzOiByZXEuY29uZmlnLmhlYWRlcnMsXG4gICAgICBpcDogcmVxLmNvbmZpZy5pcCxcbiAgICAgIGZ1bmN0aW9uTmFtZSxcbiAgICAgIGNvbnRleHQ6IHJlcS5pbmZvLmNvbnRleHQsXG4gICAgfTtcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBjb25zdCB1c2VyU3RyaW5nID0gcmVxLmF1dGggJiYgcmVxLmF1dGgudXNlciA/IHJlcS5hdXRoLnVzZXIuaWQgOiB1bmRlZmluZWQ7XG4gICAgICBjb25zdCByZXNwb25zZU9iamVjdCA9IEZ1bmN0aW9uc1JvdXRlci5jcmVhdGVSZXNwb25zZU9iamVjdChcbiAgICAgICAgcmVzdWx0ID0+IHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHJlcS5jb25maWcubG9nTGV2ZWxzLmNsb3VkRnVuY3Rpb25TdWNjZXNzICE9PSAnc2lsZW50Jykge1xuICAgICAgICAgICAgICBjb25zdCBjbGVhbklucHV0ID0gbG9nZ2VyLnRydW5jYXRlTG9nTWVzc2FnZShKU09OLnN0cmluZ2lmeShyZWRhY3RCdWZmZXJzKHBhcmFtcykpKTtcbiAgICAgICAgICAgICAgY29uc3QgY2xlYW5SZXN1bHQgPSBsb2dnZXIudHJ1bmNhdGVMb2dNZXNzYWdlKEpTT04uc3RyaW5naWZ5KHJlc3VsdC5yZXNwb25zZS5yZXN1bHQpKTtcbiAgICAgICAgICAgICAgbG9nZ2VyW3JlcS5jb25maWcubG9nTGV2ZWxzLmNsb3VkRnVuY3Rpb25TdWNjZXNzXShcbiAgICAgICAgICAgICAgICBgUmFuIGNsb3VkIGZ1bmN0aW9uICR7ZnVuY3Rpb25OYW1lfSBmb3IgdXNlciAke3VzZXJTdHJpbmd9IHdpdGg6XFxuICBJbnB1dDogJHtjbGVhbklucHV0fVxcbiAgUmVzdWx0OiAke2NsZWFuUmVzdWx0fWAsXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgZnVuY3Rpb25OYW1lLFxuICAgICAgICAgICAgICAgICAgcGFyYW1zLFxuICAgICAgICAgICAgICAgICAgdXNlcjogdXNlclN0cmluZyxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgcmVqZWN0KGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZXJyb3IgPT4ge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAocmVxLmNvbmZpZy5sb2dMZXZlbHMuY2xvdWRGdW5jdGlvbkVycm9yICE9PSAnc2lsZW50Jykge1xuICAgICAgICAgICAgICBjb25zdCBjbGVhbklucHV0ID0gbG9nZ2VyLnRydW5jYXRlTG9nTWVzc2FnZShKU09OLnN0cmluZ2lmeShyZWRhY3RCdWZmZXJzKHBhcmFtcykpKTtcbiAgICAgICAgICAgICAgbG9nZ2VyW3JlcS5jb25maWcubG9nTGV2ZWxzLmNsb3VkRnVuY3Rpb25FcnJvcl0oXG4gICAgICAgICAgICAgICAgYEZhaWxlZCBydW5uaW5nIGNsb3VkIGZ1bmN0aW9uICR7ZnVuY3Rpb25OYW1lfSBmb3IgdXNlciAke3VzZXJTdHJpbmd9IHdpdGg6XFxuICBJbnB1dDogJHtjbGVhbklucHV0fVxcbiAgRXJyb3I6IGAgK1xuICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZXJyb3IpLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uTmFtZSxcbiAgICAgICAgICAgICAgICAgIGVycm9yLFxuICAgICAgICAgICAgICAgICAgcGFyYW1zLFxuICAgICAgICAgICAgICAgICAgdXNlcjogdXNlclN0cmluZyxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHJlamVjdChlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgICBjb25zdCB7IHN1Y2Nlc3MsIGVycm9yIH0gPSByZXNwb25zZU9iamVjdDtcblxuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICByZXR1cm4gdHJpZ2dlcnMubWF5YmVSdW5WYWxpZGF0b3IocmVxdWVzdCwgZnVuY3Rpb25OYW1lLCByZXEuYXV0aCk7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAvLyBDaGVjayBpZiBmdW5jdGlvbiBleHBlY3RzIDIgcGFyYW1ldGVycyAocmVxLCByZXMpIC0gRXhwcmVzcyBzdHlsZVxuICAgICAgICAgIGlmICh0aGVGdW5jdGlvbi5sZW5ndGggPj0gMikge1xuICAgICAgICAgICAgcmV0dXJuIHRoZUZ1bmN0aW9uKHJlcXVlc3QsIHJlc3BvbnNlT2JqZWN0KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gVHJhZGl0aW9uYWwgc3R5bGUgLSBzaW5nbGUgcGFyYW1ldGVyXG4gICAgICAgICAgICByZXR1cm4gdGhlRnVuY3Rpb24ocmVxdWVzdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgICAudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgIC8vIEZvciBFeHByZXNzLXN0eWxlIGZ1bmN0aW9ucywgb25seSBzZW5kIHJlc3BvbnNlIGlmIG5vdCBhbHJlYWR5IHNlbnRcbiAgICAgICAgICBpZiAodGhlRnVuY3Rpb24ubGVuZ3RoID49IDIpIHtcbiAgICAgICAgICAgIGlmICghcmVzcG9uc2VPYmplY3QuX2lzUmVzcG9uc2VTZW50KCkpIHtcbiAgICAgICAgICAgICAgLy8gSWYgRXhwcmVzcy1zdHlsZSBmdW5jdGlvbiByZXR1cm5zIGEgdmFsdWUgd2l0aG91dCBjYWxsaW5nIHJlcy5zdWNjZXNzL2Vycm9yXG4gICAgICAgICAgICAgIGlmIChyZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHN1Y2Nlc3MocmVzdWx0KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAvLyBJZiBubyByZXNwb25zZSBzZW50IGFuZCBubyB2YWx1ZSByZXR1cm5lZCwgdGhpcyBpcyBhbiBlcnJvciBpbiB1c2VyIGNvZGVcbiAgICAgICAgICAgICAgLy8gYnV0IHdlIGRvbid0IGhhbmRsZSBpdCBoZXJlIHRvIG1haW50YWluIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRm9yIHRyYWRpdGlvbmFsIGZ1bmN0aW9ucywgYWx3YXlzIGNhbGwgc3VjY2VzcyB3aXRoIHRoZSByZXN1bHQgKGV2ZW4gaWYgdW5kZWZpbmVkKVxuICAgICAgICAgICAgc3VjY2VzcyhyZXN1bHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSwgZXJyb3IpO1xuICAgIH0pO1xuICB9XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUtBLElBQUFBLGNBQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLFlBQUEsR0FBQUQsT0FBQTtBQUNBLElBQUFFLGNBQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLE9BQUEsR0FBQUosc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFJLE9BQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLE1BQUEsR0FBQUwsT0FBQTtBQUNBLElBQUFNLE9BQUEsR0FBQVAsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFPLE1BQUEsR0FBQVIsc0JBQUEsQ0FBQUMsT0FBQTtBQUE2QixTQUFBRCx1QkFBQVMsQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FBQUMsVUFBQSxHQUFBRCxDQUFBLEtBQUFFLE9BQUEsRUFBQUYsQ0FBQTtBQVo3Qjs7QUFFQSxJQUFJRyxLQUFLLEdBQUdYLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQ1csS0FBSztFQUNyQ0MsUUFBUSxH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