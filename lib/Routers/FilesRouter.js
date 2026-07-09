"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RESERVED_DIRECTORY_SEGMENTS = exports.FilesRouter = void 0;
exports.createSizeLimitedStream = createSizeLimitedStream;
var _express = _interopRequireDefault(require("express"));
var Middlewares = _interopRequireWildcard(require("../middlewares"));
var _node = _interopRequireDefault(require("parse/node"));
var _Config = _interopRequireDefault(require("../Config"));
var _logger = _interopRequireDefault(require("../logger"));
var _stream = require("stream");
var _Error = require("../Error");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const triggers = require('../triggers');
const Utils = require('../Utils');
/**
 * Wraps a readable stream in a Readable that enforces a byte size limit.
 * Data flow is lazy: the source is not read until a consumer starts reading
 * from the returned stream (via pipe or 'data' listener). This ensures the
 * consumer's error listener is attached before any data (or error) is emitted.
 */
function createSizeLimitedStream(source, maxBytes) {
  let totalBytes = 0;
  let started = false;
  let sourceEnded = false;
  let onData, onEnd, onError;
  const output = new _stream.Readable({
    read() {
      if (!started) {
        started = true;
        onData = chunk => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            output.destroy(new _node.default.Error(_node.default.Error.FILE_SAVE_ERROR, `File size exceeds maximum allowed: ${maxBytes} bytes.`));
            return;
          }
          if (!output.push(chunk)) {
            source.pause();
          }
        };
        onEnd = () => {
          sourceEnded = true;
          output.push(null);
        };
        onError = err => output.destroy(err);
        source.on('data', onData);
        source.on('end', onEnd);
        source.on('error', onError);
      }

      // Resume source in case it was paused due to backpressure
      if (!sourceEnded) {
        source.resume();
      }
    },
    destroy(err, callback) {
      if (onData) {
        source.removeListener('data', onData);
      }
      if (onEnd) {
        source.removeListener('end', onEnd);
      }
      if (onError) {
        source.removeListener('error', onError);
      }
      // Suppress errors emitted during drain (e.g. client disconnect)
      source.on('error', () => {});
      if (!sourceEnded) {
        source.resume();
      }
      callback(err);
    }
  });
  return output;
}

// Segments that conflict with sub-routes under GET /files/:appId/*. If a file
// directory starts with one of these, its URL would match the wrong route
// handler. Update this list when adding new sub-routes to expressRouter().
const RESERVED_DIRECTORY_SEGMENTS = exports.RESERVED_DIRECTORY_SEGMENTS = ['metadata'];
class FilesRouter {
  expressRouter({
    maxUploadSize = '20Mb'
  } = {}) {
    var router = _express.default.Router();
    // Lightweight info initializer so handleParseSession can resolve session tokens.
    // Unlike POST/DELETE routes, GET file routes skip handleParseHeaders (which
    // normally sets req.info) because those requests may not carry Parse headers.
    const initInfo = (req, res, next) => {
      if (!req.info) {
        const sessionToken = req.get('X-Parse-Session-Token');
        req.info = {
          sessionToken,
          installationId: req.get('X-Parse-Installation-Id')
        };
        // If no session token and no auth yet (public access), set a minimal
        // auth object so handleParseSession skips session resolution.
        if (!sessionToken && !req.auth) {
          req.auth = {
            isMaster: false
          };
        }
      }
      next();
    };
    // Metadata route must come before the catch-all GET route
    router.get('/files/:appId/metadata/*filepath', initInfo, Middlewares.handleParseSession, this.metadataHandler);
    router.get('/files/:appId/*filepath', initInfo, Middlewares.handleParseSession, this.getHandler);
    router.post('/files', function (req, res, next) {
      next(new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, 'Filename not provided.'));
    });
    router.post('/files/:filename', this._earlyHeadersMiddleware(), this._bodyParsingMiddleware(maxUploadSize), Middlewares.handleParseHeaders, Middlewares.handleParseSession, this.createHandler.bind(this));
    router.delete('/files/*filepath', Middlewares.handleParseHeaders, Middlewares.handleParseSession, Middlewares.enforceMasterKeyAccess, this.deleteHandler);
    return router;
  }
  static _getFilenameFromParams(req) {
    const parts = req.params.filepath;
    return Array.isArray(parts) ? parts.join('/') : parts;
  }
  static validateDirectory(directory) {
    if (typeof directory !== 'string') {
      return new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, 'Directory must be a string.');
    }
    if (directory.length === 0) {
      return new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, 'Directory must not be empty.');
    }
    if (directory.length > 256) {
      return new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, 'Directory path is too long.');
    }
    if (directory.includes('..')) {
      return new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, 'Directory must not contain "..".');
    }
    if (directory.startsWith('/') || directory.endsWith('/')) {
      return new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, 'Directory must not start or end with "/".');
    }
    if (directory.includes('//')) {
      return new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, 'Directory must not contain consecutive slashes.');
    }
    const firstSegment = directory.split('/')[0];
    if (RESERVED_DIRECTORY_SEGMENTS.includes(firstSegment)) {
      return new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, `Directory must not start with reserved segment "${firstSegment}".`);
    }
    const dirRegex = /^[a-zA-Z0-9][a-zA-Z0-9_\-/]*$/;
    if (!dirRegex.test(directory)) {
      return new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, 'Directory contains invalid characters.');
    }
    return null;
  }
  static _validateFileDownload(req, config) {
    const isMaster = req.auth?.isMaster;
    const isMaintenance = req.auth?.isMaintenance;
    if (isMaster || isMaintenance) {
      return;
    }
    const user = req.auth?.user;
    const isLinked = user && _node.default.AnonymousUtils.isLinked(user);
    if (!config.fileDownload.enableForAnonymousUser && isLinked) {
      throw new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, 'File download by anonymous user is disabled.');
    }
    if (!config.fileDownload.enableForAuthenticatedUser && !isLinked && user) {
      throw new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, 'File download by authenticated user is disabled.');
    }
    if (!config.fileDownload.enableForPublic && !user) {
      throw new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, 'File download by public is disabled.');
    }
  }
  async getHandler(req, res) {
    const config = _Config.default.get(req.params.appId);
    if (!config) {
      const error = (0, _Error.createSanitizedHttpError)(403, 'Invalid application ID.', config);
      res.status(error.status);
      res.json({
        error: error.message
      });
      return;
    }
    FilesRouter._validateFileDownload(req, config);
    let filename = FilesRouter._getFilenameFromParams(req);
    try {
      const filesController = config.filesController;
      const mime = (await import('mime')).default;
      let contentType = mime.getType(filename);
      let file = new _node.default.File(filename, {
        base64: ''
      }, contentType);
      const fileAuth = req.auth;
      const triggerResult = await triggers.maybeRunFileTrigger(triggers.Types.beforeFind, {
        file
      }, config, fileAuth);
      if (triggerResult?.file?._name) {
        filename = triggerResult?.file?._name;
        contentType = mime.getType(filename);
      }
      const defaultResponseHeaders = {
        'X-Content-Type-Options': 'nosniff'
      };
      if (isFileStreamable(req, filesController)) {
        const afterFind = await triggers.maybeRunFileTrigger(triggers.Types.afterFind, {
          file,
          forceDownload: false,
          responseHeaders: {
            ...defaultResponseHeaders
          }
        }, config, fileAuth);
        if (afterFind?.forceDownload) {
          res.set('Content-Disposition', `attachment;filename=${afterFind.file?._name || filename}`);
        }
        for (const [key, value] of Object.entries(afterFind?.responseHeaders ?? defaultResponseHeaders)) {
          res.set(key, value);
        }
        filesController.handleFileStream(config, filename, req, res, contentType).catch(() => {
          res.status(404);
          res.set('Content-Type', 'text/plain');
          res.end('File not found.');
        });
        return;
      }
      let data = await filesController.getFileData(config, filename).catch(() => {
        res.status(404);
        res.set('Content-Type', 'text/plain');
        res.end('File not found.');
      });
      if (!data) {
        return;
      }
      file = new _node.default.File(filename, {
        base64: data.toString('base64')
      }, contentType);
      const afterFind = await triggers.maybeRunFileTrigger(triggers.Types.afterFind, {
        file,
        forceDownload: false,
        responseHeaders: {
          ...defaultResponseHeaders
        }
      }, config, fileAuth);
      if (afterFind?.file) {
        contentType = mime.getType(afterFind.file._name);
        data = Buffer.from(afterFind.file._data, 'base64');
      }
      res.status(200);
      res.set('Content-Type', contentType);
      res.set('Content-Length', data.length);
      if (afterFind.forceDownload) {
        res.set('Content-Disposition', `attachment;filename=${afterFind.file._name}`);
      }
      if (afterFind.responseHeaders) {
        for (const [key, value] of Object.entries(afterFind.responseHeaders)) {
          res.set(key, value);
        }
      }
      res.end(data);
    } catch (e) {
      const err = triggers.resolveError(e, {
        code: _node.default.Error.SCRIPT_FAILED,
        message: `Could not find file: ${filename}.`
      });
      res.status(403);
      res.json({
        code: err.code,
        error: err.message
      });
    }
  }

  /**
   * Middleware that runs before body parsing to handle headers that must be
   * resolved before the request body is consumed. Currently supports:
   *
   * - `X-Parse-File-Max-Upload-Size`: Overrides the server-wide `maxUploadSize`
   *   for this request. Requires the master key. The value uses the same format
   *   as the server option (e.g. `'50mb'`, `'1gb'`). Sets `req._maxUploadSizeOverride`
   *   (in bytes) for `_bodyParsingMiddleware` to use.
   */
  _earlyHeadersMiddleware() {
    return async (req, res, next) => {
      const maxUploadSizeOverride = req.get('X-Parse-File-Max-Upload-Size');
      if (!maxUploadSizeOverride) {
        return next();
      }
      const appId = req.get('X-Parse-Application-Id');
      const config = _Config.default.get(appId);
      if (!config) {
        const error = (0, _Error.createSanitizedHttpError)(403, 'Invalid application ID.', undefined);
        res.status(error.status);
        res.json({
          error: error.message
        });
        return;
      }
      const masterKey = await config.loadMasterKey();
      if (req.get('X-Parse-Master-Key') !== masterKey) {
        const error = (0, _Error.createSanitizedHttpError)(403, 'unauthorized: master key is required', config);
        res.status(error.status);
        res.json({
          error: error.message
        });
        return;
      }
      if (config.masterKeyIps?.length && !Middlewares.checkIp(req.ip, config.masterKeyIps, config.masterKeyIpsStore)) {
        const error = (0, _Error.createSanitizedHttpError)(403, 'unauthorized: master key is required', config);
        res.status(error.status);
        res.json({
          error: error.message
        });
        return;
      }
      let parsedBytes;
      try {
        parsedBytes = Utils.parseSizeToBytes(maxUploadSizeOverride);
      } catch {
        return next(new _node.default.Error(_node.default.Error.FILE_SAVE_ERROR, `Invalid maxUploadSize override value: ${maxUploadSizeOverride}`));
      }
      req._maxUploadSizeOverride = parsedBytes;
      next();
    };
  }
  _bodyParsingMiddleware(maxUploadSize) {
    const defaultMaxBytes = Utils.parseSizeToBytes(maxUploadSize);
    return (req, res, next) => {
      if (req.get('X-Parse-Upload-Mode') === 'stream') {
        req._maxUploadSizeBytes = req._maxUploadSizeOverride ?? defaultMaxBytes;
        return next();
      }
      const limit = req._maxUploadSizeOverride ?? maxUploadSize;
      return _express.default.raw({
        type: () => true,
        limit
      })(req, res, next);
    };
  }
  async createHandler(req, res, next) {
    if (req.auth.isReadOnly) {
      const error = (0, _Error.createSanitizedHttpError)(403, "read-only masterKey isn't allowed to create a file.", req.config);
      res.status(error.status);
      res.end(`{"error":"${error.message}"}`);
      return;
    }
    const config = req.config;
    const isMaster = req.auth.isMaster;
    const isMaintenance = req.auth.isMaintenance;
    if (!isMaster && !isMaintenance) {
      const user = req.auth.user;
      const isLinked = user && _node.default.AnonymousUtils.isLinked(user);
      if (!config.fileUpload.enableForAnonymousUser && isLinked) {
        next(new _node.default.Error(_node.default.Error.FILE_SAVE_ERROR, 'File upload by anonymous user is disabled.'));
        return;
      }
      if (!config.fileUpload.enableForAuthenticatedUser && !isLinked && user) {
        next(new _node.default.Error(_node.default.Error.FILE_SAVE_ERROR, 'File upload by authenticated user is disabled.'));
        return;
      }
      if (!config.fileUpload.enableForPublic && !user) {
        next(new _node.default.Error(_node.default.Error.FILE_SAVE_ERROR, 'File upload by public is disabled.'));
        return;
      }
    }
    const filesController = config.filesController;
    const {
      filename
    } = req.params;
    const contentType = req.get('Content-type');
    const error = filesController.validateFilename(filename);
    if (error) {
      next(error);
      return;
    }
    const fileExtensions = config.fileUpload?.fileExtensions;
    if (!isMaster && fileExtensions) {
      const isValidExtension = extension => {
        return fileExtensions.some(ext => {
          if (ext === '*') {
            return true;
          }
          const regex = new RegExp(ext);
          if (regex.test(extension)) {
            return true;
          }
        });
      };
      let extension = contentType;
      if (filename && filename.includes('.')) {
        extension = filename.substring(filename.lastIndexOf('.') + 1);
      } else if (contentType && contentType.includes('/')) {
        extension = contentType.split('/')[1];
      }
      // Strip MIME parameters (e.g. ";charset=utf-8") and whitespace
      extension = extension?.split(';')[0]?.replace(/\s+/g, '');
      if (extension && !isValidExtension(extension)) {
        next(new _node.default.Error(_node.default.Error.FILE_SAVE_ERROR, `File upload of extension ${extension} is disabled.`));
        return;
      }
    }

    // For streaming uploads, read file data from headers since the body is the raw stream
    if (req.get('X-Parse-Upload-Mode') === 'stream') {
      req.fileData = {};
      if (req.get('X-Parse-File-Directory')) {
        req.fileData.directory = req.get('X-Parse-File-Directory');
      }
      if (req.get('X-Parse-File-Metadata')) {
        try {
          const parsed = JSON.parse(req.get('X-Parse-File-Metadata'));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error();
          }
          req.fileData.metadata = parsed;
        } catch {
          next(new _node.default.Error(_node.default.Error.INVALID_JSON, 'Invalid JSON in X-Parse-File-Metadata header.'));
          return;
        }
      }
      if (req.get('X-Parse-File-Tags')) {
        try {
          const parsed = JSON.parse(req.get('X-Parse-File-Tags'));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error();
          }
          req.fileData.tags = parsed;
        } catch {
          next(new _node.default.Error(_node.default.Error.INVALID_JSON, 'Invalid JSON in X-Parse-File-Tags header.'));
          return;
        }
      }
    }

    // Validate directory option (requires master key)
    const directory = req.fileData?.directory;
    if (directory !== undefined) {
      if (!isMaster) {
        next(new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, 'Directory can only be set using the Master Key.'));
        return;
      }
      const directoryError = FilesRouter.validateDirectory(directory);
      if (directoryError) {
        next(directoryError);
        return;
      }
    }

    // Dispatch to the appropriate handler based on whether the body was buffered
    if (Buffer.isBuffer(req.body)) {
      return this._handleBufferedUpload(req, res, next);
    }
    return this._handleStreamUpload(req, res, next);
  }
  async _handleBufferedUpload(req, res, next) {
    const config = req.config;
    const filesController = config.filesController;
    const {
      filename
    } = req.params;
    const contentType = req.get('Content-type');
    if (!req.body || !req.body.length) {
      next(new _node.default.Error(_node.default.Error.FILE_SAVE_ERROR, 'Invalid file upload.'));
      return;
    }
    const base64 = req.body.toString('base64');
    const file = new _node.default.File(filename, {
      base64
    }, contentType);
    const {
      metadata = {},
      tags = {},
      directory
    } = req.fileData || {};
    try {
      // Scan request data for denied keywords
      Utils.checkProhibitedKeywords(config, metadata);
      Utils.checkProhibitedKeywords(config, tags);
    } catch (error) {
      next(new _node.default.Error(_node.default.Error.INVALID_KEY_NAME, error));
      return;
    }
    file.setTags(tags);
    file.setMetadata(metadata);
    if (directory) {
      file.setDirectory(directory);
    }
    const fileSize = Buffer.byteLength(req.body);
    const fileObject = {
      file,
      fileSize
    };
    try {
      // run beforeSaveFile trigger
      const triggerResult = await triggers.maybeRunFileTrigger(triggers.Types.beforeSave, fileObject, config, req.auth);
      let saveResult;
      // if a new ParseFile is returned check if it's an already saved file
      if (triggerResult instanceof _node.default.File) {
        fileObject.file = triggerResult;
        if (triggerResult.url()) {
          // set fileSize to null because we wont know how big it is here
          fileObject.fileSize = null;
          saveResult = {
            url: triggerResult.url(),
            name: triggerResult._name
          };
        }
      }
      // if the file returned by the trigger has already been saved skip saving anything
      if (!saveResult) {
        // update fileSize
        let bufferData;
        if (fileObject.file._source?.format === 'buffer') {
          bufferData = fileObject.file._source.buffer;
        } else {
          bufferData = Buffer.from(fileObject.file._data, 'base64');
        }
        fileObject.fileSize = Buffer.byteLength(bufferData);
        // prepare file options
        const fileOptions = {
          metadata: fileObject.file._metadata
        };
        // some s3-compatible providers (DigitalOcean, Linode) do not accept tags
        // so we do not include the tags option if it is empty.
        const fileTags = Object.keys(fileObject.file._tags).length > 0 ? {
          tags: fileObject.file._tags
        } : {};
        Object.assign(fileOptions, fileTags);
        // include directory if set (from client request or beforeSaveFile trigger)
        if (fileObject.file._directory) {
          fileOptions.directory = fileObject.file._directory;
        }
        // save file
        const createFileResult = await filesController.createFile(config, fileObject.file._name, bufferData, fileObject.file._source.type, fileOptions);
        // update file with new data
        fileObject.file._name = createFileResult.name;
        fileObject.file._url = createFileResult.url;
        fileObject.file._requestTask = null;
        fileObject.file._previousSave = Promise.resolve(fileObject.file);
        saveResult = {
          url: createFileResult.url,
          name: createFileResult.name
        };
      }
      // run afterSaveFile trigger
      await triggers.maybeRunFileTrigger(triggers.Types.afterSave, fileObject, config, req.auth);
      res.status(201);
      res.set('Location', saveResult.url);
      res.json(saveResult);
    } catch (e) {
      _logger.default.error('Error creating a file: ', e);
      const error = triggers.resolveError(e, {
        code: _node.default.Error.FILE_SAVE_ERROR,
        message: `Could not store file: ${fileObject.file._name}.`
      });
      next(error);
    }
  }
  async _handleStreamUpload(req, res, next) {
    const config = req.config;
    const filesController = config.filesController;
    const {
      filename
    } = req.params;
    let contentType = req.get('Content-Type');
    const maxBytes = req._maxUploadSizeBytes;
    let stream;
    try {
      // Early rejection via Content-Length header
      const contentLength = req.get('Content-Length');
      if (contentLength && parseInt(contentLength, 10) > maxBytes) {
        req.resume();
        next(new _node.default.Error(_node.default.Error.FILE_SAVE_ERROR, `File size exceeds maximum allowed: ${maxBytes} bytes.`));
        return;
      }
      const mime = (await import('mime')).default;

      // Infer content type from extension or add extension from content type
      const hasExtension = filename && filename.includes('.');
      if (hasExtension && !contentType) {
        contentType = mime.getType(filename);
      } else if (!hasExtension && contentType) {
        // extension will be added by filesController.createFile
      }

      // Create size-limited stream wrapping the request
      stream = createSizeLimitedStream(req, maxBytes);

      // Build a Parse.File with no _data (streaming mode)
      const file = new _node.default.File(filename, {
        base64: ''
      }, contentType);
      const {
        metadata = {},
        tags = {},
        directory
      } = req.fileData || {};

      // Validate metadata and tags for prohibited keywords
      try {
        Utils.checkProhibitedKeywords(config, metadata);
        Utils.checkProhibitedKeywords(config, tags);
      } catch (error) {
        stream.destroy();
        next(new _node.default.Error(_node.default.Error.INVALID_KEY_NAME, error));
        return;
      }
      file.setTags(tags);
      file.setMetadata(metadata);
      if (directory) {
        file.setDirectory(directory);
      }
      const fileSize = req.get('Content-Length') ? parseInt(req.get('Content-Length'), 10) : null;
      const fileObject = {
        file,
        fileSize,
        stream: true
      };

      // Run beforeSaveFile trigger
      const triggerResult = await triggers.maybeRunFileTrigger(triggers.Types.beforeSave, fileObject, config, req.auth);
      let saveResult;
      // If a new ParseFile is returned, check if it's an already saved file
      if (triggerResult instanceof _node.default.File) {
        fileObject.file = triggerResult;
        if (triggerResult.url()) {
          fileObject.fileSize = null;
          saveResult = {
            url: triggerResult.url(),
            name: triggerResult._name
          };
          // Destroy stream to remove listeners and drain request
          stream.destroy();
        }
      }

      // If the file returned by the trigger has already been saved, skip saving
      if (!saveResult) {
        // Prepare file options
        const fileOptions = {
          metadata: fileObject.file._metadata
        };
        const fileTags = Object.keys(fileObject.file._tags).length > 0 ? {
          tags: fileObject.file._tags
        } : {};
        Object.assign(fileOptions, fileTags);
        // include directory if set (from client request or beforeSaveFile trigger)
        if (fileObject.file._directory) {
          fileOptions.directory = fileObject.file._directory;
        }

        // Pass stream directly to filesController — it will buffer if adapter doesn't support streaming
        const sourceType = fileObject.file._source?.type || contentType;
        const createFileResult = await filesController.createFile(config, fileObject.file._name, stream, sourceType, fileOptions);

        // Update file with new data
        fileObject.file._name = createFileResult.name;
        fileObject.file._url = createFileResult.url;
        fileObject.file._requestTask = null;
        fileObject.file._previousSave = Promise.resolve(fileObject.file);
        saveResult = {
          url: createFileResult.url,
          name: createFileResult.name
        };
      }

      // Run afterSaveFile trigger
      await triggers.maybeRunFileTrigger(triggers.Types.afterSave, fileObject, config, req.auth);
      res.status(201);
      res.set('Location', saveResult.url);
      res.json(saveResult);
    } catch (e) {
      // Destroy stream to remove listeners and drain request, or resume directly
      if (stream) {
        stream.destroy();
      } else {
        req.resume();
      }
      _logger.default.error('Error creating a file: ', e);
      const error = triggers.resolveError(e, {
        code: _node.default.Error.FILE_SAVE_ERROR,
        message: `Could not store file: ${filename}.`
      });
      next(error);
    }
  }
  async deleteHandler(req, res, next) {
    if (req.auth.isReadOnly) {
      const error = (0, _Error.createSanitizedHttpError)(403, "read-only masterKey isn't allowed to delete a file.", req.config);
      res.status(error.status);
      res.end(`{"error":"${error.message}"}`);
      return;
    }
    try {
      const {
        filesController
      } = req.config;
      const filename = FilesRouter._getFilenameFromParams(req);
      // run beforeDeleteFile trigger
      const file = new _node.default.File(filename);
      file._url = await filesController.adapter.getFileLocation(req.config, filename);
      const fileObject = {
        file,
        fileSize: null
      };
      await triggers.maybeRunFileTrigger(triggers.Types.beforeDelete, fileObject, req.config, req.auth);
      // delete file
      await filesController.deleteFile(req.config, filename);
      // run afterDeleteFile trigger
      await triggers.maybeRunFileTrigger(triggers.Types.afterDelete, fileObject, req.config, req.auth);
      res.status(200);
      // TODO: return useful JSON here?
      res.end();
    } catch (e) {
      _logger.default.error('Error deleting a file: ', e);
      const error = triggers.resolveError(e, {
        code: _node.default.Error.FILE_DELETE_ERROR,
        message: 'Could not delete file.'
      });
      next(error);
    }
  }
  async metadataHandler(req, res) {
    try {
      const config = _Config.default.get(req.params.appId);
      if (!config) {
        res.status(200);
        res.json({});
        return;
      }
      FilesRouter._validateFileDownload(req, config);
      const {
        filesController
      } = config;
      let filename = FilesRouter._getFilenameFromParams(req);
      const file = new _node.default.File(filename, {
        base64: ''
      });
      const fileAuth = req.auth;
      const triggerResult = await triggers.maybeRunFileTrigger(triggers.Types.beforeFind, {
        file
      }, config, fileAuth);
      if (triggerResult?.file?._name) {
        filename = triggerResult.file._name;
      }
      const data = await filesController.getMetadata(filename).catch(() => {
        res.status(200);
        res.json({});
      });
      if (!data) {
        return;
      }
      await triggers.maybeRunFileTrigger(triggers.Types.afterFind, {
        file
      }, config, fileAuth);
      res.status(200);
      res.json(data);
    } catch (e) {
      const err = triggers.resolveError(e, {
        code: _node.default.Error.SCRIPT_FAILED,
        message: 'Could not get file metadata.'
      });
      res.status(403);
      res.json({
        code: err.code,
        error: err.message
      });
    }
  }
}
exports.FilesRouter = FilesRouter;
function isFileStreamable(req, filesController) {
  const range = (req.get('Range') || '/-/').split('-');
  const start = Number(range[0]);
  const end = Number(range[1]);
  return (!isNaN(start) || !isNaN(end)) && typeof filesController.adapter.handleFileStream === 'function';
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfZXhwcmVzcyIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiTWlkZGxld2FyZXMiLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsIl9ub2RlIiwiX0NvbmZpZyIsIl9sb2dnZXIiLCJfc3RyZWFtIiwiX0Vycm9yIiwiZSIsInQiLCJXZWFrTWFwIiwiciIsIm4iLCJfX2VzTW9kdWxlIiwibyIsImkiLCJmIiwiX19wcm90b19fIiwiZGVmYXVsdCIsImhhcyIsImdldCIsInNldCIsImhhc093blByb3BlcnR5IiwiY2FsbCIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwidHJpZ2dlcnMiLCJVdGlscyIsImNyZWF0ZVNpemVMaW1pdGVkU3RyZWFtIiwic291cmNlIiwibWF4Qnl0ZXMiLCJ0b3RhbEJ5dGVzIiwic3RhcnRlZCIsInNvdXJjZUVuZGVkIiwib25EYXRhIiwib25FbmQiLCJvbkVycm9yIiwib3V0cHV0IiwiUmVhZGFibGUiLCJyZWFkIiwiY2h1bmsiLCJsZW5ndGgiLCJkZXN0cm95IiwiUGFyc2UiLCJFcnJvciIsIkZJTEVfU0FWRV9FUlJPUiIsInB1c2giLCJwYXVzZSIsImVyciIsIm9uIiwicmVzdW1lIiwiY2FsbGJhY2siLCJyZW1vdmVMaXN0ZW5lciIsIlJFU0VSVkVEX0RJUkVDVE9SWV9TRUdNRU5UUyIsImV4cG9ydHMiLCJGaWxlc1JvdXRlciIsImV4cHJlc3NSb3V0ZXIiLCJtYXhVcGxvYWRTaXplIiwicm91dGVyIiwiZXhwcmVzcyIsIlJvdXRlciIsImluaXRJbmZvIiwicmVxIiwicmVzIiwibmV4dCIsImluZm8iLCJzZXNzaW9uVG9rZW4iLCJpbnN0YWxsYXRpb25JZCIsImF1dGgiLCJpc01hc3RlciIsImhhbmRsZVBhcnNlU2Vzc2lvbiIsIm1ldGFkYXRhSGFuZGxlciIsImdldEhhbmRsZXIiLCJwb3N0IiwiSU5WQUxJRF9GSUxFX05BTUUiLCJfZWFybHlIZWFkZXJzTWlkZGxld2FyZSIsIl9ib2R5UGFyc2luZ01pZGRsZXdhcmUiLCJoYW5kbGVQYXJzZUhlYWRlcnMiLCJjcmVhdGVIYW5kbGVyIiwiYmluZCIsImRlbGV0ZSIsImVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MiLCJkZWxldGVIYW5kbGVyIiwiX2dldEZpbGVuYW1lRnJvbVBhcmFtcyIsInBhcnRzIiwicGFyYW1zIiwiZmlsZXBhdGgiLCJBcnJheSIsImlzQXJyYXkiLCJqb2luIiwidmFsaWRhdGVEaXJlY3RvcnkiLCJkaXJlY3RvcnkiLCJpbmNsdWRlcyIsInN0YXJ0c1dpdGgiLCJlbmRzV2l0aCIsImZpcnN0U2VnbWVudCIsInNwbGl0IiwiZGlyUmVnZXgiLCJ0ZXN0IiwiX3ZhbGlkYXRlRmlsZURvd25sb2FkIiwiY29uZmlnIiwiaXNNYWludGVuYW5jZSIsInVzZXIiLCJpc0xpbmtlZCIsIkFub255bW91c1V0aWxzIiwiZmlsZURvd25sb2FkIiwiZW5hYmxlRm9yQW5vbnltb3VzVXNlciIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJlbmFibGVGb3JBdXRoZW50aWNhdGVkVXNlciIsImVuYWJsZUZvclB1YmxpYyIsIkNvbmZpZyIsImFwcElkIiwiZXJyb3IiLCJjcmVhdGVTYW5pdGl6ZWRIdHRwRXJyb3IiLCJzdGF0dXMiLCJqc29uIiwibWVzc2FnZSIsImZpbGVuYW1lIiwiZmlsZXNDb250cm9sbGVyIiwibWltZSIsImNvbnRlbnRUeXBlIiwiZ2V0VHlwZSIsImZpbGUiLCJGaWxlIiwiYmFzZTY0IiwiZmlsZUF1dGgiLCJ0cmlnZ2VyUmVzdWx0IiwibWF5YmVSdW5GaWxlVHJpZ2dlciIsIlR5cGVzIiwiYmVmb3JlRmluZCIsIl9uYW1lIiwiZGVmYXVsdFJlc3BvbnNlSGVhZGVycyIsImlzRmlsZVN0cmVhbWFibGUiLCJhZnRlckZpbmQiLCJmb3JjZURvd25sb2FkIiwicmVzcG9uc2VIZWFkZXJzIiwia2V5IiwidmFsdWUiLCJlbnRyaWVzIiwiaGFuZGxlRmlsZVN0cmVhbSIsImNhdGNoIiwiZW5kIiwiZGF0YSIsImdldEZpbGVEYXRhIiwidG9TdHJpbmciLCJCdWZmZXIiLCJmcm9tIiwiX2RhdGEiLCJyZXNvbHZlRXJyb3IiLCJjb2RlIiwiU0NSSVBUX0ZBSUxFRCIsIm1heFVwbG9hZFNpemVPdmVycmlkZSIsInVuZGVmaW5lZCIsIm1hc3RlcktleSIsImxvYWRNYXN0ZXJLZXkiLCJtYXN0ZXJLZXlJcHMiLCJjaGVja0lwIiwiaXAiLCJtYXN0ZXJLZXlJcHNTdG9yZSIsInBhcnNlZEJ5dGVzIiwicGFyc2VTaXplVG9CeXRlcyIsIl9tYXhVcGxvYWRTaXplT3ZlcnJpZGUiLCJkZWZhdWx0TWF4Qnl0ZXMiLCJfbWF4VXBsb2FkU2l6ZUJ5dGVzIiwibGltaXQiLCJyYXciLCJ0eXBlIiwiaXNSZWFkT25seSIsImZpbGVVcGxvYWQiLCJ2YWxpZGF0ZUZpbGVuYW1lIiwiZmlsZUV4dGVuc2lvbnMiLCJpc1ZhbGlkRXh0ZW5zaW9uIiwiZXh0ZW5zaW9uIiwic29tZSIsImV4dCIsInJlZ2V4IiwiUmVnRXhwIiwic3Vic3RyaW5nIiwibGFzdEluZGV4T2YiLCJyZXBsYWNlIiwiZmlsZURhdGEiLCJwYXJzZWQiLCJKU09OIiwicGFyc2UiLCJtZXRhZGF0YSIsIklOVkFMSURfSlNPTiIsInRhZ3MiLCJkaXJlY3RvcnlFcnJvciIsImlzQnVmZmVyIiwiYm9keSIsIl9oYW5kbGVCdWZmZXJlZFVwbG9hZCIsIl9oYW5kbGVTdHJlYW1VcGxvYWQiLCJjaGVja1Byb2hpYml0ZWRLZXl3b3JkcyIsIklOVkFMSURfS0VZX05BTUUiLCJzZXRUYWdzIiwic2V0TWV0YWRhdGEiLCJzZXREaXJlY3RvcnkiLCJmaWxlU2l6ZSIsImJ5dGVMZW5ndGgiLCJmaWxlT2JqZWN0IiwiYmVmb3JlU2F2ZSIsInNhdmVSZXN1bHQiLCJ1cmwiLCJuYW1lIiwiYnVmZmVyRGF0YSIsIl9zb3VyY2UiLCJmb3JtYXQiLCJidWZmZXIiLCJmaWxlT3B0aW9ucyIsIl9tZXRhZGF0YSIsImZpbGVUYWdzIiwia2V5cyIsIl90YWdzIiwiYXNzaWduIiwiX2RpcmVjdG9yeSIsImNyZWF0ZUZpbGVSZXN1bHQiLCJjcmVhdGVGaWxlIiwiX3VybCIsIl9yZXF1ZXN0VGFzayIsIl9wcmV2aW91c1NhdmUiLCJQcm9taXNlIiwicmVzb2x2ZSIsImFmdGVyU2F2ZSIsImxvZ2dlciIsInN0cmVhbSIsImNvbnRlbnRMZW5ndGgiLCJwYXJzZUludCIsImhhc0V4dGVuc2lvbiIsInNvdXJjZVR5cGUiLCJhZGFwdGVyIiwiZ2V0RmlsZUxvY2F0aW9uIiwiYmVmb3JlRGVsZXRlIiwiZGVsZXRlRmlsZSIsImFmdGVyRGVsZXRlIiwiRklMRV9ERUxFVEVfRVJST1IiLCJnZXRNZXRhZGF0YSIsInJhbmdlIiwic3RhcnQiLCJOdW1iZXIiLCJpc05hTiJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0ZpbGVzUm91dGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBleHByZXNzIGZyb20gJ2V4cHJlc3MnO1xuaW1wb3J0ICogYXMgTWlkZGxld2FyZXMgZnJvbSAnLi4vbWlkZGxld2FyZXMnO1xuaW1wb3J0IFBhcnNlIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IENvbmZpZyBmcm9tICcuLi9Db25maWcnO1xuaW1wb3J0IGxvZ2dlciBmcm9tICcuLi9sb2dnZXInO1xuY29uc3QgdHJpZ2dlcnMgPSByZXF1aXJlKCcuLi90cmlnZ2VycycpO1xuY29uc3QgVXRpbHMgPSByZXF1aXJlKCcuLi9VdGlscycpO1xuaW1wb3J0IHsgUmVhZGFibGUgfSBmcm9tICdzdHJlYW0nO1xuaW1wb3J0IHsgY3JlYXRlU2FuaXRpemVkSHR0cEVycm9yIH0gZnJvbSAnLi4vRXJyb3InO1xuXG4vKipcbiAqIFdyYXBzIGEgcmVhZGFibGUgc3RyZWFtIGluIGEgUmVhZGFibGUgdGhhdCBlbmZvcmNlcyBhIGJ5dGUgc2l6ZSBsaW1pdC5cbiAqIERhdGEgZmxvdyBpcyBsYXp5OiB0aGUgc291cmNlIGlzIG5vdCByZWFkIHVudGlsIGEgY29uc3VtZXIgc3RhcnRzIHJlYWRpbmdcbiAqIGZyb20gdGhlIHJldHVybmVkIHN0cmVhbSAodmlhIHBpcGUgb3IgJ2RhdGEnIGxpc3RlbmVyKS4gVGhpcyBlbnN1cmVzIHRoZVxuICogY29uc3VtZXIncyBlcnJvciBsaXN0ZW5lciBpcyBhdHRhY2hlZCBiZWZvcmUgYW55IGRhdGEgKG9yIGVycm9yKSBpcyBlbWl0dGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU2l6ZUxpbWl0ZWRTdHJlYW0oc291cmNlLCBtYXhCeXRlcykge1xuICBsZXQgdG90YWxCeXRlcyA9IDA7XG4gIGxldCBzdGFydGVkID0gZmFsc2U7XG4gIGxldCBzb3VyY2VFbmRlZCA9IGZhbHNlO1xuICBsZXQgb25EYXRhLCBvbkVuZCwgb25FcnJvcjtcblxuICBjb25zdCBvdXRwdXQgPSBuZXcgUmVhZGFibGUoe1xuICAgIHJlYWQoKSB7XG4gICAgICBpZiAoIXN0YXJ0ZWQpIHtcbiAgICAgICAgc3RhcnRlZCA9IHRydWU7XG5cbiAgICAgICAgb25EYXRhID0gKGNodW5rKSA9PiB7XG4gICAgICAgICAgdG90YWxCeXRlcyArPSBjaHVuay5sZW5ndGg7XG4gICAgICAgICAgaWYgKHRvdGFsQnl0ZXMgPiBtYXhCeXRlcykge1xuICAgICAgICAgICAgb3V0cHV0LmRlc3Ryb3koXG4gICAgICAgICAgICAgIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5GSUxFX1NBVkVfRVJST1IsXG4gICAgICAgICAgICAgICAgYEZpbGUgc2l6ZSBleGNlZWRzIG1heGltdW0gYWxsb3dlZDogJHttYXhCeXRlc30gYnl0ZXMuYFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIW91dHB1dC5wdXNoKGNodW5rKSkge1xuICAgICAgICAgICAgc291cmNlLnBhdXNlKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIG9uRW5kID0gKCkgPT4ge1xuICAgICAgICAgIHNvdXJjZUVuZGVkID0gdHJ1ZTtcbiAgICAgICAgICBvdXRwdXQucHVzaChudWxsKTtcbiAgICAgICAgfTtcblxuICAgICAgICBvbkVycm9yID0gKGVycikgPT4gb3V0cHV0LmRlc3Ryb3koZXJyKTtcblxuICAgICAgICBzb3VyY2Uub24oJ2RhdGEnLCBvbkRhdGEpO1xuICAgICAgICBzb3VyY2Uub24oJ2VuZCcsIG9uRW5kKTtcbiAgICAgICAgc291cmNlLm9uKCdlcnJvcicsIG9uRXJyb3IpO1xuICAgICAgfVxuXG4gICAgICAvLyBSZXN1bWUgc291cmNlIGluIGNhc2UgaXQgd2FzIHBhdXNlZCBkdWUgdG8gYmFja3ByZXNzdXJlXG4gICAgICBpZiAoIXNvdXJjZUVuZGVkKSB7XG4gICAgICAgIHNvdXJjZS5yZXN1bWUoKTtcbiAgICAgIH1cbiAgICB9LFxuICAgIGRlc3Ryb3koZXJyLCBjYWxsYmFjaykge1xuICAgICAgaWYgKG9uRGF0YSkge1xuICAgICAgICBzb3VyY2UucmVtb3ZlTGlzdGVuZXIoJ2RhdGEnLCBvbkRhdGEpO1xuICAgICAgfVxuICAgICAgaWYgKG9uRW5kKSB7XG4gICAgICAgIHNvdXJjZS5yZW1vdmVMaXN0ZW5lcignZW5kJywgb25FbmQpO1xuICAgICAgfVxuICAgICAgaWYgKG9uRXJyb3IpIHtcbiAgICAgICAgc291cmNlLnJlbW92ZUxpc3RlbmVyKCdlcnJvcicsIG9uRXJyb3IpO1xuICAgICAgfVxuICAgICAgLy8gU3VwcHJlc3MgZXJyb3JzIGVtaXR0ZWQgZHVyaW5nIGRyYWluIChlLmcuIGNsaWVudCBkaXNjb25uZWN0KVxuICAgICAgc291cmNlLm9uKCdlcnJvcicsICgpID0+IHt9KTtcbiAgICAgIGlmICghc291cmNlRW5kZWQpIHtcbiAgICAgICAgc291cmNlLnJlc3VtZSgpO1xuICAgICAgfVxuICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiBvdXRwdXQ7XG59XG5cbi8vIFNlZ21lbnRzIHRoYXQgY29uZmxpY3Qgd2l0aCBzdWItcm91dGVzIHVuZGVyIEdFVCAvZmlsZXMvOmFwcElkLyouIElmIGEgZmlsZVxuLy8gZGlyZWN0b3J5IHN0YXJ0cyB3aXRoIG9uZSBvZiB0aGVzZSwgaXRzIFVSTCB3b3VsZCBtYXRjaCB0aGUgd3Jvbmcgcm91dGVcbi8vIGhhbmRsZXIuIFVwZGF0ZSB0aGlzIGxpc3Qgd2hlbiBhZGRpbmcgbmV3IHN1Yi1yb3V0ZXMgdG8gZXhwcmVzc1JvdXRlcigpLlxuZXhwb3J0IGNvbnN0IFJFU0VSVkVEX0RJUkVDVE9SWV9TRUdNRU5UUyA9IFsnbWV0YWRhdGEnXTtcblxuZXhwb3J0IGNsYXNzIEZpbGVzUm91dGVyIHtcbiAgZXhwcmVzc1JvdXRlcih7IG1heFVwbG9hZFNpemUgPSAnMjBNYicgfSA9IHt9KSB7XG4gICAgdmFyIHJvdXRlciA9IGV4cHJlc3MuUm91dGVyKCk7XG4gICAgLy8gTGlnaHR3ZWlnaHQgaW5mbyBpbml0aWFsaXplciBzbyBoYW5kbGVQYXJzZVNlc3Npb24gY2FuIHJlc29sdmUgc2Vzc2lvbiB0b2tlbnMuXG4gICAgLy8gVW5saWtlIFBPU1QvREVMRVRFIHJvdXRlcywgR0VUIGZpbGUgcm91dGVzIHNraXAgaGFuZGxlUGFyc2VIZWFkZXJzICh3aGljaFxuICAgIC8vIG5vcm1hbGx5IHNldHMgcmVxLmluZm8pIGJlY2F1c2UgdGhvc2UgcmVxdWVzdHMgbWF5IG5vdCBjYXJyeSBQYXJzZSBoZWFkZXJzLlxuICAgIGNvbnN0IGluaXRJbmZvID0gKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgICBpZiAoIXJlcS5pbmZvKSB7XG4gICAgICAgIGNvbnN0IHNlc3Npb25Ub2tlbiA9IHJlcS5nZXQoJ1gtUGFyc2UtU2Vzc2lvbi1Ub2tlbicpO1xuICAgICAgICByZXEuaW5mbyA9IHtcbiAgICAgICAgICBzZXNzaW9uVG9rZW4sXG4gICAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IHJlcS5nZXQoJ1gtUGFyc2UtSW5zdGFsbGF0aW9uLUlkJyksXG4gICAgICAgIH07XG4gICAgICAgIC8vIElmIG5vIHNlc3Npb24gdG9rZW4gYW5kIG5vIGF1dGggeWV0IChwdWJsaWMgYWNjZXNzKSwgc2V0IGEgbWluaW1hbFxuICAgICAgICAvLyBhdXRoIG9iamVjdCBzbyBoYW5kbGVQYXJzZVNlc3Npb24gc2tpcHMgc2Vzc2lvbiByZXNvbHV0aW9uLlxuICAgICAgICBpZiAoIXNlc3Npb25Ub2tlbiAmJiAhcmVxLmF1dGgpIHtcbiAgICAgICAgICByZXEuYXV0aCA9IHsgaXNNYXN0ZXI6IGZhbHNlIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIG5leHQoKTtcbiAgICB9O1xuICAgIC8vIE1ldGFkYXRhIHJvdXRlIG11c3QgY29tZSBiZWZvcmUgdGhlIGNhdGNoLWFsbCBHRVQgcm91dGVcbiAgICByb3V0ZXIuZ2V0KCcvZmlsZXMvOmFwcElkL21ldGFkYXRhLypmaWxlcGF0aCcsIGluaXRJbmZvLCBNaWRkbGV3YXJlcy5oYW5kbGVQYXJzZVNlc3Npb24sIHRoaXMubWV0YWRhdGFIYW5kbGVyKTtcbiAgICByb3V0ZXIuZ2V0KCcvZmlsZXMvOmFwcElkLypmaWxlcGF0aCcsIGluaXRJbmZvLCBNaWRkbGV3YXJlcy5oYW5kbGVQYXJzZVNlc3Npb24sIHRoaXMuZ2V0SGFuZGxlcik7XG5cbiAgICByb3V0ZXIucG9zdCgnL2ZpbGVzJywgZnVuY3Rpb24gKHJlcSwgcmVzLCBuZXh0KSB7XG4gICAgICBuZXh0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0ZJTEVfTkFNRSwgJ0ZpbGVuYW1lIG5vdCBwcm92aWRlZC4nKSk7XG4gICAgfSk7XG5cbiAgICByb3V0ZXIucG9zdChcbiAgICAgICcvZmlsZXMvOmZpbGVuYW1lJyxcbiAgICAgIHRoaXMuX2Vhcmx5SGVhZGVyc01pZGRsZXdhcmUoKSxcbiAgICAgIHRoaXMuX2JvZHlQYXJzaW5nTWlkZGxld2FyZShtYXhVcGxvYWRTaXplKSxcbiAgICAgIE1pZGRsZXdhcmVzLmhhbmRsZVBhcnNlSGVhZGVycyxcbiAgICAgIE1pZGRsZXdhcmVzLmhhbmRsZVBhcnNlU2Vzc2lvbixcbiAgICAgIHRoaXMuY3JlYXRlSGFuZGxlci5iaW5kKHRoaXMpXG4gICAgKTtcblxuICAgIHJvdXRlci5kZWxldGUoXG4gICAgICAnL2ZpbGVzLypmaWxlcGF0aCcsXG4gICAgICBNaWRkbGV3YXJlcy5oYW5kbGVQYXJzZUhlYWRlcnMsXG4gICAgICBNaWRkbGV3YXJlcy5oYW5kbGVQYXJzZVNlc3Npb24sXG4gICAgICBNaWRkbGV3YXJlcy5lbmZvcmNlTWFzdGVyS2V5QWNjZXNzLFxuICAgICAgdGhpcy5kZWxldGVIYW5kbGVyXG4gICAgKTtcbiAgICByZXR1cm4gcm91dGVyO1xuICB9XG5cbiAgc3RhdGljIF9nZXRGaWxlbmFtZUZyb21QYXJhbXMocmVxKSB7XG4gICAgY29uc3QgcGFydHMgPSByZXEucGFyYW1zLmZpbGVwYXRoO1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KHBhcnRzKSA/IHBhcnRzLmpvaW4oJy8nKSA6IHBhcnRzO1xuICB9XG5cbiAgc3RhdGljIHZhbGlkYXRlRGlyZWN0b3J5KGRpcmVjdG9yeSkge1xuICAgIGlmICh0eXBlb2YgZGlyZWN0b3J5ICE9PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0ZJTEVfTkFNRSwgJ0RpcmVjdG9yeSBtdXN0IGJlIGEgc3RyaW5nLicpO1xuICAgIH1cbiAgICBpZiAoZGlyZWN0b3J5Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0ZJTEVfTkFNRSwgJ0RpcmVjdG9yeSBtdXN0IG5vdCBiZSBlbXB0eS4nKTtcbiAgICB9XG4gICAgaWYgKGRpcmVjdG9yeS5sZW5ndGggPiAyNTYpIHtcbiAgICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9GSUxFX05BTUUsICdEaXJlY3RvcnkgcGF0aCBpcyB0b28gbG9uZy4nKTtcbiAgICB9XG4gICAgaWYgKGRpcmVjdG9yeS5pbmNsdWRlcygnLi4nKSkge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0ZJTEVfTkFNRSwgJ0RpcmVjdG9yeSBtdXN0IG5vdCBjb250YWluIFwiLi5cIi4nKTtcbiAgICB9XG4gICAgaWYgKGRpcmVjdG9yeS5zdGFydHNXaXRoKCcvJykgfHwgZGlyZWN0b3J5LmVuZHNXaXRoKCcvJykpIHtcbiAgICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfRklMRV9OQU1FLFxuICAgICAgICAnRGlyZWN0b3J5IG11c3Qgbm90IHN0YXJ0IG9yIGVuZCB3aXRoIFwiL1wiLidcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChkaXJlY3RvcnkuaW5jbHVkZXMoJy8vJykpIHtcbiAgICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfRklMRV9OQU1FLFxuICAgICAgICAnRGlyZWN0b3J5IG11c3Qgbm90IGNvbnRhaW4gY29uc2VjdXRpdmUgc2xhc2hlcy4nXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBmaXJzdFNlZ21lbnQgPSBkaXJlY3Rvcnkuc3BsaXQoJy8nKVswXTtcbiAgICBpZiAoUkVTRVJWRURfRElSRUNUT1JZX1NFR01FTlRTLmluY2x1ZGVzKGZpcnN0U2VnbWVudCkpIHtcbiAgICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfRklMRV9OQU1FLFxuICAgICAgICBgRGlyZWN0b3J5IG11c3Qgbm90IHN0YXJ0IHdpdGggcmVzZXJ2ZWQgc2VnbWVudCBcIiR7Zmlyc3RTZWdtZW50fVwiLmBcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IGRpclJlZ2V4ID0gL15bYS16QS1aMC05XVthLXpBLVowLTlfXFwtL10qJC87XG4gICAgaWYgKCFkaXJSZWdleC50ZXN0KGRpcmVjdG9yeSkpIHtcbiAgICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfRklMRV9OQU1FLFxuICAgICAgICAnRGlyZWN0b3J5IGNvbnRhaW5zIGludmFsaWQgY2hhcmFjdGVycy4nXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHN0YXRpYyBfdmFsaWRhdGVGaWxlRG93bmxvYWQocmVxLCBjb25maWcpIHtcbiAgICBjb25zdCBpc01hc3RlciA9IHJlcS5hdXRoPy5pc01hc3RlcjtcbiAgICBjb25zdCBpc01haW50ZW5hbmNlID0gcmVxLmF1dGg/LmlzTWFpbnRlbmFuY2U7XG4gICAgaWYgKGlzTWFzdGVyIHx8IGlzTWFpbnRlbmFuY2UpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdXNlciA9IHJlcS5hdXRoPy51c2VyO1xuICAgIGNvbnN0IGlzTGlua2VkID0gdXNlciAmJiBQYXJzZS5Bbm9ueW1vdXNVdGlscy5pc0xpbmtlZCh1c2VyKTtcbiAgICBpZiAoIWNvbmZpZy5maWxlRG93bmxvYWQuZW5hYmxlRm9yQW5vbnltb3VzVXNlciAmJiBpc0xpbmtlZCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICAnRmlsZSBkb3dubG9hZCBieSBhbm9ueW1vdXMgdXNlciBpcyBkaXNhYmxlZC4nXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoIWNvbmZpZy5maWxlRG93bmxvYWQuZW5hYmxlRm9yQXV0aGVudGljYXRlZFVzZXIgJiYgIWlzTGlua2VkICYmIHVzZXIpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgJ0ZpbGUgZG93bmxvYWQgYnkgYXV0aGVudGljYXRlZCB1c2VyIGlzIGRpc2FibGVkLidcbiAgICAgICk7XG4gICAgfVxuICAgIGlmICghY29uZmlnLmZpbGVEb3dubG9hZC5lbmFibGVGb3JQdWJsaWMgJiYgIXVzZXIpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgJ0ZpbGUgZG93bmxvYWQgYnkgcHVibGljIGlzIGRpc2FibGVkLidcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZ2V0SGFuZGxlcihyZXEsIHJlcykge1xuICAgIGNvbnN0IGNvbmZpZyA9IENvbmZpZy5nZXQocmVxLnBhcmFtcy5hcHBJZCk7XG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gY3JlYXRlU2FuaXRpemVkSHR0cEVycm9yKDQwMywgJ0ludmFsaWQgYXBwbGljYXRpb24gSUQuJywgY29uZmlnKTtcbiAgICAgIHJlcy5zdGF0dXMoZXJyb3Iuc3RhdHVzKTtcbiAgICAgIHJlcy5qc29uKHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgRmlsZXNSb3V0ZXIuX3ZhbGlkYXRlRmlsZURvd25sb2FkKHJlcSwgY29uZmlnKTtcblxuICAgIGxldCBmaWxlbmFtZSA9IEZpbGVzUm91dGVyLl9nZXRGaWxlbmFtZUZyb21QYXJhbXMocmVxKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZmlsZXNDb250cm9sbGVyID0gY29uZmlnLmZpbGVzQ29udHJvbGxlcjtcbiAgICAgIGNvbnN0IG1pbWUgPSAoYXdhaXQgaW1wb3J0KCdtaW1lJykpLmRlZmF1bHQ7XG4gICAgICBsZXQgY29udGVudFR5cGUgPSBtaW1lLmdldFR5cGUoZmlsZW5hbWUpO1xuICAgICAgbGV0IGZpbGUgPSBuZXcgUGFyc2UuRmlsZShmaWxlbmFtZSwgeyBiYXNlNjQ6ICcnIH0sIGNvbnRlbnRUeXBlKTtcbiAgICAgIGNvbnN0IGZpbGVBdXRoID0gcmVxLmF1dGg7XG4gICAgICBjb25zdCB0cmlnZ2VyUmVzdWx0ID0gYXdhaXQgdHJpZ2dlcnMubWF5YmVSdW5GaWxlVHJpZ2dlcihcbiAgICAgICAgdHJpZ2dlcnMuVHlwZXMuYmVmb3JlRmluZCxcbiAgICAgICAgeyBmaWxlIH0sXG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgZmlsZUF1dGhcbiAgICAgICk7XG4gICAgICBpZiAodHJpZ2dlclJlc3VsdD8uZmlsZT8uX25hbWUpIHtcbiAgICAgICAgZmlsZW5hbWUgPSB0cmlnZ2VyUmVzdWx0Py5maWxlPy5fbmFtZTtcbiAgICAgICAgY29udGVudFR5cGUgPSBtaW1lLmdldFR5cGUoZmlsZW5hbWUpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBkZWZhdWx0UmVzcG9uc2VIZWFkZXJzID0geyAnWC1Db250ZW50LVR5cGUtT3B0aW9ucyc6ICdub3NuaWZmJyB9O1xuXG4gICAgICBpZiAoaXNGaWxlU3RyZWFtYWJsZShyZXEsIGZpbGVzQ29udHJvbGxlcikpIHtcbiAgICAgICAgY29uc3QgYWZ0ZXJGaW5kID0gYXdhaXQgdHJpZ2dlcnMubWF5YmVSdW5GaWxlVHJpZ2dlcihcbiAgICAgICAgICB0cmlnZ2Vycy5UeXBlcy5hZnRlckZpbmQsXG4gICAgICAgICAgeyBmaWxlLCBmb3JjZURvd25sb2FkOiBmYWxzZSwgcmVzcG9uc2VIZWFkZXJzOiB7IC4uLmRlZmF1bHRSZXNwb25zZUhlYWRlcnMgfSB9LFxuICAgICAgICAgIGNvbmZpZyxcbiAgICAgICAgICBmaWxlQXV0aFxuICAgICAgICApO1xuICAgICAgICBpZiAoYWZ0ZXJGaW5kPy5mb3JjZURvd25sb2FkKSB7XG4gICAgICAgICAgcmVzLnNldCgnQ29udGVudC1EaXNwb3NpdGlvbicsIGBhdHRhY2htZW50O2ZpbGVuYW1lPSR7YWZ0ZXJGaW5kLmZpbGU/Ll9uYW1lIHx8IGZpbGVuYW1lfWApO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFmdGVyRmluZD8ucmVzcG9uc2VIZWFkZXJzID8/IGRlZmF1bHRSZXNwb25zZUhlYWRlcnMpKSB7XG4gICAgICAgICAgcmVzLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgICBmaWxlc0NvbnRyb2xsZXIuaGFuZGxlRmlsZVN0cmVhbShjb25maWcsIGZpbGVuYW1lLCByZXEsIHJlcywgY29udGVudFR5cGUpLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICByZXMuc3RhdHVzKDQwNCk7XG4gICAgICAgICAgcmVzLnNldCgnQ29udGVudC1UeXBlJywgJ3RleHQvcGxhaW4nKTtcbiAgICAgICAgICByZXMuZW5kKCdGaWxlIG5vdCBmb3VuZC4nKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgbGV0IGRhdGEgPSBhd2FpdCBmaWxlc0NvbnRyb2xsZXIuZ2V0RmlsZURhdGEoY29uZmlnLCBmaWxlbmFtZSkuY2F0Y2goKCkgPT4ge1xuICAgICAgICByZXMuc3RhdHVzKDQwNCk7XG4gICAgICAgIHJlcy5zZXQoJ0NvbnRlbnQtVHlwZScsICd0ZXh0L3BsYWluJyk7XG4gICAgICAgIHJlcy5lbmQoJ0ZpbGUgbm90IGZvdW5kLicpO1xuICAgICAgfSk7XG4gICAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgZmlsZSA9IG5ldyBQYXJzZS5GaWxlKGZpbGVuYW1lLCB7IGJhc2U2NDogZGF0YS50b1N0cmluZygnYmFzZTY0JykgfSwgY29udGVudFR5cGUpO1xuICAgICAgY29uc3QgYWZ0ZXJGaW5kID0gYXdhaXQgdHJpZ2dlcnMubWF5YmVSdW5GaWxlVHJpZ2dlcihcbiAgICAgICAgdHJpZ2dlcnMuVHlwZXMuYWZ0ZXJGaW5kLFxuICAgICAgICB7IGZpbGUsIGZvcmNlRG93bmxvYWQ6IGZhbHNlLCByZXNwb25zZUhlYWRlcnM6IHsgLi4uZGVmYXVsdFJlc3BvbnNlSGVhZGVycyB9IH0sXG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgZmlsZUF1dGhcbiAgICAgICk7XG5cbiAgICAgIGlmIChhZnRlckZpbmQ/LmZpbGUpIHtcbiAgICAgICAgY29udGVudFR5cGUgPSBtaW1lLmdldFR5cGUoYWZ0ZXJGaW5kLmZpbGUuX25hbWUpO1xuICAgICAgICBkYXRhID0gQnVmZmVyLmZyb20oYWZ0ZXJGaW5kLmZpbGUuX2RhdGEsICdiYXNlNjQnKTtcbiAgICAgIH1cblxuICAgICAgcmVzLnN0YXR1cygyMDApO1xuICAgICAgcmVzLnNldCgnQ29udGVudC1UeXBlJywgY29udGVudFR5cGUpO1xuICAgICAgcmVzLnNldCgnQ29udGVudC1MZW5ndGgnLCBkYXRhLmxlbmd0aCk7XG4gICAgICBpZiAoYWZ0ZXJGaW5kLmZvcmNlRG93bmxvYWQpIHtcbiAgICAgICAgcmVzLnNldCgnQ29udGVudC1EaXNwb3NpdGlvbicsIGBhdHRhY2htZW50O2ZpbGVuYW1lPSR7YWZ0ZXJGaW5kLmZpbGUuX25hbWV9YCk7XG4gICAgICB9XG4gICAgICBpZiAoYWZ0ZXJGaW5kLnJlc3BvbnNlSGVhZGVycykge1xuICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhZnRlckZpbmQucmVzcG9uc2VIZWFkZXJzKSkge1xuICAgICAgICAgIHJlcy5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJlcy5lbmQoZGF0YSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc3QgZXJyID0gdHJpZ2dlcnMucmVzb2x2ZUVycm9yKGUsIHtcbiAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuU0NSSVBUX0ZBSUxFRCxcbiAgICAgICAgbWVzc2FnZTogYENvdWxkIG5vdCBmaW5kIGZpbGU6ICR7ZmlsZW5hbWV9LmAsXG4gICAgICB9KTtcbiAgICAgIHJlcy5zdGF0dXMoNDAzKTtcbiAgICAgIHJlcy5qc29uKHsgY29kZTogZXJyLmNvZGUsIGVycm9yOiBlcnIubWVzc2FnZSB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWlkZGxld2FyZSB0aGF0IHJ1bnMgYmVmb3JlIGJvZHkgcGFyc2luZyB0byBoYW5kbGUgaGVhZGVycyB0aGF0IG11c3QgYmVcbiAgICogcmVzb2x2ZWQgYmVmb3JlIHRoZSByZXF1ZXN0IGJvZHkgaXMgY29uc3VtZWQuIEN1cnJlbnRseSBzdXBwb3J0czpcbiAgICpcbiAgICogLSBgWC1QYXJzZS1GaWxlLU1heC1VcGxvYWQtU2l6ZWA6IE92ZXJyaWRlcyB0aGUgc2VydmVyLXdpZGUgYG1heFVwbG9hZFNpemVgXG4gICAqICAgZm9yIHRoaXMgcmVxdWVzdC4gUmVxdWlyZXMgdGhlIG1hc3RlciBrZXkuIFRoZSB2YWx1ZSB1c2VzIHRoZSBzYW1lIGZvcm1hdFxuICAgKiAgIGFzIHRoZSBzZXJ2ZXIgb3B0aW9uIChlLmcuIGAnNTBtYidgLCBgJzFnYidgKS4gU2V0cyBgcmVxLl9tYXhVcGxvYWRTaXplT3ZlcnJpZGVgXG4gICAqICAgKGluIGJ5dGVzKSBmb3IgYF9ib2R5UGFyc2luZ01pZGRsZXdhcmVgIHRvIHVzZS5cbiAgICovXG4gIF9lYXJseUhlYWRlcnNNaWRkbGV3YXJlKCkge1xuICAgIHJldHVybiBhc3luYyAocmVxLCByZXMsIG5leHQpID0+IHtcbiAgICAgIGNvbnN0IG1heFVwbG9hZFNpemVPdmVycmlkZSA9IHJlcS5nZXQoJ1gtUGFyc2UtRmlsZS1NYXgtVXBsb2FkLVNpemUnKTtcbiAgICAgIGlmICghbWF4VXBsb2FkU2l6ZU92ZXJyaWRlKSB7XG4gICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICB9XG4gICAgICBjb25zdCBhcHBJZCA9IHJlcS5nZXQoJ1gtUGFyc2UtQXBwbGljYXRpb24tSWQnKTtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IENvbmZpZy5nZXQoYXBwSWQpO1xuICAgICAgaWYgKCFjb25maWcpIHtcbiAgICAgICAgY29uc3QgZXJyb3IgPSBjcmVhdGVTYW5pdGl6ZWRIdHRwRXJyb3IoNDAzLCAnSW52YWxpZCBhcHBsaWNhdGlvbiBJRC4nLCB1bmRlZmluZWQpO1xuICAgICAgICByZXMuc3RhdHVzKGVycm9yLnN0YXR1cyk7XG4gICAgICAgIHJlcy5qc29uKHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG1hc3RlcktleSA9IGF3YWl0IGNvbmZpZy5sb2FkTWFzdGVyS2V5KCk7XG4gICAgICBpZiAocmVxLmdldCgnWC1QYXJzZS1NYXN0ZXItS2V5JykgIT09IG1hc3RlcktleSkge1xuICAgICAgICBjb25zdCBlcnJvciA9IGNyZWF0ZVNhbml0aXplZEh0dHBFcnJvcig0MDMsICd1bmF1dGhvcml6ZWQ6IG1hc3RlciBrZXkgaXMgcmVxdWlyZWQnLCBjb25maWcpO1xuICAgICAgICByZXMuc3RhdHVzKGVycm9yLnN0YXR1cyk7XG4gICAgICAgIHJlcy5qc29uKHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChjb25maWcubWFzdGVyS2V5SXBzPy5sZW5ndGggJiYgIU1pZGRsZXdhcmVzLmNoZWNrSXAocmVxLmlwLCBjb25maWcubWFzdGVyS2V5SXBzLCBjb25maWcubWFzdGVyS2V5SXBzU3RvcmUpKSB7XG4gICAgICAgIGNvbnN0IGVycm9yID0gY3JlYXRlU2FuaXRpemVkSHR0cEVycm9yKDQwMywgJ3VuYXV0aG9yaXplZDogbWFzdGVyIGtleSBpcyByZXF1aXJlZCcsIGNvbmZpZyk7XG4gICAgICAgIHJlcy5zdGF0dXMoZXJyb3Iuc3RhdHVzKTtcbiAgICAgICAgcmVzLmpzb24oeyBlcnJvcjogZXJyb3IubWVzc2FnZSB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbGV0IHBhcnNlZEJ5dGVzO1xuICAgICAgdHJ5IHtcbiAgICAgICAgcGFyc2VkQnl0ZXMgPSBVdGlscy5wYXJzZVNpemVUb0J5dGVzKG1heFVwbG9hZFNpemVPdmVycmlkZSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG5leHQoXG4gICAgICAgICAgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuRklMRV9TQVZFX0VSUk9SLFxuICAgICAgICAgICAgYEludmFsaWQgbWF4VXBsb2FkU2l6ZSBvdmVycmlkZSB2YWx1ZTogJHttYXhVcGxvYWRTaXplT3ZlcnJpZGV9YFxuICAgICAgICAgIClcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJlcS5fbWF4VXBsb2FkU2l6ZU92ZXJyaWRlID0gcGFyc2VkQnl0ZXM7XG4gICAgICBuZXh0KCk7XG4gICAgfTtcbiAgfVxuXG4gIF9ib2R5UGFyc2luZ01pZGRsZXdhcmUobWF4VXBsb2FkU2l6ZSkge1xuICAgIGNvbnN0IGRlZmF1bHRNYXhCeXRlcyA9IFV0aWxzLnBhcnNlU2l6ZVRvQnl0ZXMobWF4VXBsb2FkU2l6ZSk7XG4gICAgcmV0dXJuIChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICAgICAgaWYgKHJlcS5nZXQoJ1gtUGFyc2UtVXBsb2FkLU1vZGUnKSA9PT0gJ3N0cmVhbScpIHtcbiAgICAgICAgcmVxLl9tYXhVcGxvYWRTaXplQnl0ZXMgPSByZXEuX21heFVwbG9hZFNpemVPdmVycmlkZSA/PyBkZWZhdWx0TWF4Qnl0ZXM7XG4gICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICB9XG4gICAgICBjb25zdCBsaW1pdCA9IHJlcS5fbWF4VXBsb2FkU2l6ZU92ZXJyaWRlID8/IG1heFVwbG9hZFNpemU7XG4gICAgICByZXR1cm4gZXhwcmVzcy5yYXcoeyB0eXBlOiAoKSA9PiB0cnVlLCBsaW1pdCB9KShyZXEsIHJlcywgbmV4dCk7XG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZUhhbmRsZXIocmVxLCByZXMsIG5leHQpIHtcbiAgICBpZiAocmVxLmF1dGguaXNSZWFkT25seSkge1xuICAgICAgY29uc3QgZXJyb3IgPSBjcmVhdGVTYW5pdGl6ZWRIdHRwRXJyb3IoNDAzLCBcInJlYWQtb25seSBtYXN0ZXJLZXkgaXNuJ3QgYWxsb3dlZCB0byBjcmVhdGUgYSBmaWxlLlwiLCByZXEuY29uZmlnKTtcbiAgICAgIHJlcy5zdGF0dXMoZXJyb3Iuc3RhdHVzKTtcbiAgICAgIHJlcy5lbmQoYHtcImVycm9yXCI6XCIke2Vycm9yLm1lc3NhZ2V9XCJ9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZyA9IHJlcS5jb25maWc7XG4gICAgY29uc3QgaXNNYXN0ZXIgPSByZXEuYXV0aC5pc01hc3RlcjtcbiAgICBjb25zdCBpc01haW50ZW5hbmNlID0gcmVxLmF1dGguaXNNYWludGVuYW5jZTtcbiAgICBpZiAoIWlzTWFzdGVyICYmICFpc01haW50ZW5hbmNlKSB7XG4gICAgICBjb25zdCB1c2VyID0gcmVxLmF1dGgudXNlcjtcbiAgICAgIGNvbnN0IGlzTGlua2VkID0gdXNlciAmJiBQYXJzZS5Bbm9ueW1vdXNVdGlscy5pc0xpbmtlZCh1c2VyKTtcbiAgICAgIGlmICghY29uZmlnLmZpbGVVcGxvYWQuZW5hYmxlRm9yQW5vbnltb3VzVXNlciAmJiBpc0xpbmtlZCkge1xuICAgICAgICBuZXh0KFxuICAgICAgICAgIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5GSUxFX1NBVkVfRVJST1IsICdGaWxlIHVwbG9hZCBieSBhbm9ueW1vdXMgdXNlciBpcyBkaXNhYmxlZC4nKVxuICAgICAgICApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAoIWNvbmZpZy5maWxlVXBsb2FkLmVuYWJsZUZvckF1dGhlbnRpY2F0ZWRVc2VyICYmICFpc0xpbmtlZCAmJiB1c2VyKSB7XG4gICAgICAgIG5leHQoXG4gICAgICAgICAgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuRklMRV9TQVZFX0VSUk9SLFxuICAgICAgICAgICAgJ0ZpbGUgdXBsb2FkIGJ5IGF1dGhlbnRpY2F0ZWQgdXNlciBpcyBkaXNhYmxlZC4nXG4gICAgICAgICAgKVxuICAgICAgICApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAoIWNvbmZpZy5maWxlVXBsb2FkLmVuYWJsZUZvclB1YmxpYyAmJiAhdXNlcikge1xuICAgICAgICBuZXh0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5GSUxFX1NBVkVfRVJST1IsICdGaWxlIHVwbG9hZCBieSBwdWJsaWMgaXMgZGlzYWJsZWQuJykpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGZpbGVzQ29udHJvbGxlciA9IGNvbmZpZy5maWxlc0NvbnRyb2xsZXI7XG4gICAgY29uc3QgeyBmaWxlbmFtZSB9ID0gcmVxLnBhcmFtcztcbiAgICBjb25zdCBjb250ZW50VHlwZSA9IHJlcS5nZXQoJ0NvbnRlbnQtdHlwZScpO1xuXG4gICAgY29uc3QgZXJyb3IgPSBmaWxlc0NvbnRyb2xsZXIudmFsaWRhdGVGaWxlbmFtZShmaWxlbmFtZSk7XG4gICAgaWYgKGVycm9yKSB7XG4gICAgICBuZXh0KGVycm9yKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlRXh0ZW5zaW9ucyA9IGNvbmZpZy5maWxlVXBsb2FkPy5maWxlRXh0ZW5zaW9ucztcbiAgICBpZiAoIWlzTWFzdGVyICYmIGZpbGVFeHRlbnNpb25zKSB7XG4gICAgICBjb25zdCBpc1ZhbGlkRXh0ZW5zaW9uID0gZXh0ZW5zaW9uID0+IHtcbiAgICAgICAgcmV0dXJuIGZpbGVFeHRlbnNpb25zLnNvbWUoZXh0ID0+IHtcbiAgICAgICAgICBpZiAoZXh0ID09PSAnKicpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCByZWdleCA9IG5ldyBSZWdFeHAoZXh0KTtcbiAgICAgICAgICBpZiAocmVnZXgudGVzdChleHRlbnNpb24pKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICAgIGxldCBleHRlbnNpb24gPSBjb250ZW50VHlwZTtcbiAgICAgIGlmIChmaWxlbmFtZSAmJiBmaWxlbmFtZS5pbmNsdWRlcygnLicpKSB7XG4gICAgICAgIGV4dGVuc2lvbiA9IGZpbGVuYW1lLnN1YnN0cmluZyhmaWxlbmFtZS5sYXN0SW5kZXhPZignLicpICsgMSk7XG4gICAgICB9IGVsc2UgaWYgKGNvbnRlbnRUeXBlICYmIGNvbnRlbnRUeXBlLmluY2x1ZGVzKCcvJykpIHtcbiAgICAgICAgZXh0ZW5zaW9uID0gY29udGVudFR5cGUuc3BsaXQoJy8nKVsxXTtcbiAgICAgIH1cbiAgICAgIC8vIFN0cmlwIE1JTUUgcGFyYW1ldGVycyAoZS5nLiBcIjtjaGFyc2V0PXV0Zi04XCIpIGFuZCB3aGl0ZXNwYWNlXG4gICAgICBleHRlbnNpb24gPSBleHRlbnNpb24/LnNwbGl0KCc7JylbMF0/LnJlcGxhY2UoL1xccysvZywgJycpO1xuXG4gICAgICBpZiAoZXh0ZW5zaW9uICYmICFpc1ZhbGlkRXh0ZW5zaW9uKGV4dGVuc2lvbikpIHtcbiAgICAgICAgbmV4dChcbiAgICAgICAgICBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5GSUxFX1NBVkVfRVJST1IsXG4gICAgICAgICAgICBgRmlsZSB1cGxvYWQgb2YgZXh0ZW5zaW9uICR7ZXh0ZW5zaW9ufSBpcyBkaXNhYmxlZC5gXG4gICAgICAgICAgKVxuICAgICAgICApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRm9yIHN0cmVhbWluZyB1cGxvYWRzLCByZWFkIGZpbGUgZGF0YSBmcm9tIGhlYWRlcnMgc2luY2UgdGhlIGJvZHkgaXMgdGhlIHJhdyBzdHJlYW1cbiAgICBpZiAocmVxLmdldCgnWC1QYXJzZS1VcGxvYWQtTW9kZScpID09PSAnc3RyZWFtJykge1xuICAgICAgcmVxLmZpbGVEYXRhID0ge307XG4gICAgICBpZiAocmVxLmdldCgnWC1QYXJzZS1GaWxlLURpcmVjdG9yeScpKSB7XG4gICAgICAgIHJlcS5maWxlRGF0YS5kaXJlY3RvcnkgPSByZXEuZ2V0KCdYLVBhcnNlLUZpbGUtRGlyZWN0b3J5Jyk7XG4gICAgICB9XG4gICAgICBpZiAocmVxLmdldCgnWC1QYXJzZS1GaWxlLU1ldGFkYXRhJykpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJlcS5nZXQoJ1gtUGFyc2UtRmlsZS1NZXRhZGF0YScpKTtcbiAgICAgICAgICBpZiAoIXBhcnNlZCB8fCB0eXBlb2YgcGFyc2VkICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KHBhcnNlZCkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcigpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXEuZmlsZURhdGEubWV0YWRhdGEgPSBwYXJzZWQ7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIG5leHQobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ0ludmFsaWQgSlNPTiBpbiBYLVBhcnNlLUZpbGUtTWV0YWRhdGEgaGVhZGVyLicpKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyZXEuZ2V0KCdYLVBhcnNlLUZpbGUtVGFncycpKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyZXEuZ2V0KCdYLVBhcnNlLUZpbGUtVGFncycpKTtcbiAgICAgICAgICBpZiAoIXBhcnNlZCB8fCB0eXBlb2YgcGFyc2VkICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KHBhcnNlZCkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcigpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXEuZmlsZURhdGEudGFncyA9IHBhcnNlZDtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgbmV4dChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnSW52YWxpZCBKU09OIGluIFgtUGFyc2UtRmlsZS1UYWdzIGhlYWRlci4nKSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgZGlyZWN0b3J5IG9wdGlvbiAocmVxdWlyZXMgbWFzdGVyIGtleSlcbiAgICBjb25zdCBkaXJlY3RvcnkgPSByZXEuZmlsZURhdGE/LmRpcmVjdG9yeTtcbiAgICBpZiAoZGlyZWN0b3J5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICghaXNNYXN0ZXIpIHtcbiAgICAgICAgbmV4dChcbiAgICAgICAgICBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICAgICAgJ0RpcmVjdG9yeSBjYW4gb25seSBiZSBzZXQgdXNpbmcgdGhlIE1hc3RlciBLZXkuJ1xuICAgICAgICAgIClcbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgZGlyZWN0b3J5RXJyb3IgPSBGaWxlc1JvdXRlci52YWxpZGF0ZURpcmVjdG9yeShkaXJlY3RvcnkpO1xuICAgICAgaWYgKGRpcmVjdG9yeUVycm9yKSB7XG4gICAgICAgIG5leHQoZGlyZWN0b3J5RXJyb3IpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRGlzcGF0Y2ggdG8gdGhlIGFwcHJvcHJpYXRlIGhhbmRsZXIgYmFzZWQgb24gd2hldGhlciB0aGUgYm9keSB3YXMgYnVmZmVyZWRcbiAgICBpZiAoQnVmZmVyLmlzQnVmZmVyKHJlcS5ib2R5KSkge1xuICAgICAgcmV0dXJuIHRoaXMuX2hhbmRsZUJ1ZmZlcmVkVXBsb2FkKHJlcSwgcmVzLCBuZXh0KTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX2hhbmRsZVN0cmVhbVVwbG9hZChyZXEsIHJlcywgbmV4dCk7XG4gIH1cblxuICBhc3luYyBfaGFuZGxlQnVmZmVyZWRVcGxvYWQocmVxLCByZXMsIG5leHQpIHtcbiAgICBjb25zdCBjb25maWcgPSByZXEuY29uZmlnO1xuICAgIGNvbnN0IGZpbGVzQ29udHJvbGxlciA9IGNvbmZpZy5maWxlc0NvbnRyb2xsZXI7XG4gICAgY29uc3QgeyBmaWxlbmFtZSB9ID0gcmVxLnBhcmFtcztcbiAgICBjb25zdCBjb250ZW50VHlwZSA9IHJlcS5nZXQoJ0NvbnRlbnQtdHlwZScpO1xuXG4gICAgaWYgKCFyZXEuYm9keSB8fCAhcmVxLmJvZHkubGVuZ3RoKSB7XG4gICAgICBuZXh0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5GSUxFX1NBVkVfRVJST1IsICdJbnZhbGlkIGZpbGUgdXBsb2FkLicpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBiYXNlNjQgPSByZXEuYm9keS50b1N0cmluZygnYmFzZTY0Jyk7XG4gICAgY29uc3QgZmlsZSA9IG5ldyBQYXJzZS5GaWxlKGZpbGVuYW1lLCB7IGJhc2U2NCB9LCBjb250ZW50VHlwZSk7XG4gICAgY29uc3QgeyBtZXRhZGF0YSA9IHt9LCB0YWdzID0ge30sIGRpcmVjdG9yeSB9ID0gcmVxLmZpbGVEYXRhIHx8IHt9O1xuICAgIHRyeSB7XG4gICAgICAvLyBTY2FuIHJlcXVlc3QgZGF0YSBmb3IgZGVuaWVkIGtleXdvcmRzXG4gICAgICBVdGlscy5jaGVja1Byb2hpYml0ZWRLZXl3b3Jkcyhjb25maWcsIG1ldGFkYXRhKTtcbiAgICAgIFV0aWxzLmNoZWNrUHJvaGliaXRlZEtleXdvcmRzKGNvbmZpZywgdGFncyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIG5leHQobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsIGVycm9yKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZpbGUuc2V0VGFncyh0YWdzKTtcbiAgICBmaWxlLnNldE1ldGFkYXRhKG1ldGFkYXRhKTtcbiAgICBpZiAoZGlyZWN0b3J5KSB7XG4gICAgICBmaWxlLnNldERpcmVjdG9yeShkaXJlY3RvcnkpO1xuICAgIH1cbiAgICBjb25zdCBmaWxlU2l6ZSA9IEJ1ZmZlci5ieXRlTGVuZ3RoKHJlcS5ib2R5KTtcbiAgICBjb25zdCBmaWxlT2JqZWN0ID0geyBmaWxlLCBmaWxlU2l6ZSB9O1xuICAgIHRyeSB7XG4gICAgICAvLyBydW4gYmVmb3JlU2F2ZUZpbGUgdHJpZ2dlclxuICAgICAgY29uc3QgdHJpZ2dlclJlc3VsdCA9IGF3YWl0IHRyaWdnZXJzLm1heWJlUnVuRmlsZVRyaWdnZXIoXG4gICAgICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZVNhdmUsXG4gICAgICAgIGZpbGVPYmplY3QsXG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgcmVxLmF1dGhcbiAgICAgICk7XG4gICAgICBsZXQgc2F2ZVJlc3VsdDtcbiAgICAgIC8vIGlmIGEgbmV3IFBhcnNlRmlsZSBpcyByZXR1cm5lZCBjaGVjayBpZiBpdCdzIGFuIGFscmVhZHkgc2F2ZWQgZmlsZVxuICAgICAgaWYgKHRyaWdnZXJSZXN1bHQgaW5zdGFuY2VvZiBQYXJzZS5GaWxlKSB7XG4gICAgICAgIGZpbGVPYmplY3QuZmlsZSA9IHRyaWdnZXJSZXN1bHQ7XG4gICAgICAgIGlmICh0cmlnZ2VyUmVzdWx0LnVybCgpKSB7XG4gICAgICAgICAgLy8gc2V0IGZpbGVTaXplIHRvIG51bGwgYmVjYXVzZSB3ZSB3b250IGtub3cgaG93IGJpZyBpdCBpcyBoZXJlXG4gICAgICAgICAgZmlsZU9iamVjdC5maWxlU2l6ZSA9IG51bGw7XG4gICAgICAgICAgc2F2ZVJlc3VsdCA9IHtcbiAgICAgICAgICAgIHVybDogdHJpZ2dlclJlc3VsdC51cmwoKSxcbiAgICAgICAgICAgIG5hbWU6IHRyaWdnZXJSZXN1bHQuX25hbWUsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gaWYgdGhlIGZpbGUgcmV0dXJuZWQgYnkgdGhlIHRyaWdnZXIgaGFzIGFscmVhZHkgYmVlbiBzYXZlZCBza2lwIHNhdmluZyBhbnl0aGluZ1xuICAgICAgaWYgKCFzYXZlUmVzdWx0KSB7XG4gICAgICAgIC8vIHVwZGF0ZSBmaWxlU2l6ZVxuICAgICAgICBsZXQgYnVmZmVyRGF0YTtcbiAgICAgICAgaWYgKGZpbGVPYmplY3QuZmlsZS5fc291cmNlPy5mb3JtYXQgPT09ICdidWZmZXInKSB7XG4gICAgICAgICAgYnVmZmVyRGF0YSA9IGZpbGVPYmplY3QuZmlsZS5fc291cmNlLmJ1ZmZlcjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBidWZmZXJEYXRhID0gQnVmZmVyLmZyb20oZmlsZU9iamVjdC5maWxlLl9kYXRhLCAnYmFzZTY0Jyk7XG4gICAgICAgIH1cbiAgICAgICAgZmlsZU9iamVjdC5maWxlU2l6ZSA9IEJ1ZmZlci5ieXRlTGVuZ3RoKGJ1ZmZlckRhdGEpO1xuICAgICAgICAvLyBwcmVwYXJlIGZpbGUgb3B0aW9uc1xuICAgICAgICBjb25zdCBmaWxlT3B0aW9ucyA9IHtcbiAgICAgICAgICBtZXRhZGF0YTogZmlsZU9iamVjdC5maWxlLl9tZXRhZGF0YSxcbiAgICAgICAgfTtcbiAgICAgICAgLy8gc29tZSBzMy1jb21wYXRpYmxlIHByb3ZpZGVycyAoRGlnaXRhbE9jZWFuLCBMaW5vZGUpIGRvIG5vdCBhY2NlcHQgdGFnc1xuICAgICAgICAvLyBzbyB3ZSBkbyBub3QgaW5jbHVkZSB0aGUgdGFncyBvcHRpb24gaWYgaXQgaXMgZW1wdHkuXG4gICAgICAgIGNvbnN0IGZpbGVUYWdzID1cbiAgICAgICAgICBPYmplY3Qua2V5cyhmaWxlT2JqZWN0LmZpbGUuX3RhZ3MpLmxlbmd0aCA+IDAgPyB7IHRhZ3M6IGZpbGVPYmplY3QuZmlsZS5fdGFncyB9IDoge307XG4gICAgICAgIE9iamVjdC5hc3NpZ24oZmlsZU9wdGlvbnMsIGZpbGVUYWdzKTtcbiAgICAgICAgLy8gaW5jbHVkZSBkaXJlY3RvcnkgaWYgc2V0IChmcm9tIGNsaWVudCByZXF1ZXN0IG9yIGJlZm9yZVNhdmVGaWxlIHRyaWdnZXIpXG4gICAgICAgIGlmIChmaWxlT2JqZWN0LmZpbGUuX2RpcmVjdG9yeSkge1xuICAgICAgICAgIGZpbGVPcHRpb25zLmRpcmVjdG9yeSA9IGZpbGVPYmplY3QuZmlsZS5fZGlyZWN0b3J5O1xuICAgICAgICB9XG4gICAgICAgIC8vIHNhdmUgZmlsZVxuICAgICAgICBjb25zdCBjcmVhdGVGaWxlUmVzdWx0ID0gYXdhaXQgZmlsZXNDb250cm9sbGVyLmNyZWF0ZUZpbGUoXG4gICAgICAgICAgY29uZmlnLFxuICAgICAgICAgIGZpbGVPYmplY3QuZmlsZS5fbmFtZSxcbiAgICAgICAgICBidWZmZXJEYXRhLFxuICAgICAgICAgIGZpbGVPYmplY3QuZmlsZS5fc291cmNlLnR5cGUsXG4gICAgICAgICAgZmlsZU9wdGlvbnNcbiAgICAgICAgKTtcbiAgICAgICAgLy8gdXBkYXRlIGZpbGUgd2l0aCBuZXcgZGF0YVxuICAgICAgICBmaWxlT2JqZWN0LmZpbGUuX25hbWUgPSBjcmVhdGVGaWxlUmVzdWx0Lm5hbWU7XG4gICAgICAgIGZpbGVPYmplY3QuZmlsZS5fdXJsID0gY3JlYXRlRmlsZVJlc3VsdC51cmw7XG4gICAgICAgIGZpbGVPYmplY3QuZmlsZS5fcmVxdWVzdFRhc2sgPSBudWxsO1xuICAgICAgICBmaWxlT2JqZWN0LmZpbGUuX3ByZXZpb3VzU2F2ZSA9IFByb21pc2UucmVzb2x2ZShmaWxlT2JqZWN0LmZpbGUpO1xuICAgICAgICBzYXZlUmVzdWx0ID0ge1xuICAgICAgICAgIHVybDogY3JlYXRlRmlsZVJlc3VsdC51cmwsXG4gICAgICAgICAgbmFtZTogY3JlYXRlRmlsZVJlc3VsdC5uYW1lLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgLy8gcnVuIGFmdGVyU2F2ZUZpbGUgdHJpZ2dlclxuICAgICAgYXdhaXQgdHJpZ2dlcnMubWF5YmVSdW5GaWxlVHJpZ2dlcih0cmlnZ2Vycy5UeXBlcy5hZnRlclNhdmUsIGZpbGVPYmplY3QsIGNvbmZpZywgcmVxLmF1dGgpO1xuICAgICAgcmVzLnN0YXR1cygyMDEpO1xuICAgICAgcmVzLnNldCgnTG9jYXRpb24nLCBzYXZlUmVzdWx0LnVybCk7XG4gICAgICByZXMuanNvbihzYXZlUmVzdWx0KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIGNyZWF0aW5nIGEgZmlsZTogJywgZSk7XG4gICAgICBjb25zdCBlcnJvciA9IHRyaWdnZXJzLnJlc29sdmVFcnJvcihlLCB7XG4gICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLkZJTEVfU0FWRV9FUlJPUixcbiAgICAgICAgbWVzc2FnZTogYENvdWxkIG5vdCBzdG9yZSBmaWxlOiAke2ZpbGVPYmplY3QuZmlsZS5fbmFtZX0uYCxcbiAgICAgIH0pO1xuICAgICAgbmV4dChlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgX2hhbmRsZVN0cmVhbVVwbG9hZChyZXEsIHJlcywgbmV4dCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHJlcS5jb25maWc7XG4gICAgY29uc3QgZmlsZXNDb250cm9sbGVyID0gY29uZmlnLmZpbGVzQ29udHJvbGxlcjtcbiAgICBjb25zdCB7IGZpbGVuYW1lIH0gPSByZXEucGFyYW1zO1xuICAgIGxldCBjb250ZW50VHlwZSA9IHJlcS5nZXQoJ0NvbnRlbnQtVHlwZScpO1xuICAgIGNvbnN0IG1heEJ5dGVzID0gcmVxLl9tYXhVcGxvYWRTaXplQnl0ZXM7XG4gICAgbGV0IHN0cmVhbTtcblxuICAgIHRyeSB7XG4gICAgICAvLyBFYXJseSByZWplY3Rpb24gdmlhIENvbnRlbnQtTGVuZ3RoIGhlYWRlclxuICAgICAgY29uc3QgY29udGVudExlbmd0aCA9IHJlcS5nZXQoJ0NvbnRlbnQtTGVuZ3RoJyk7XG4gICAgICBpZiAoY29udGVudExlbmd0aCAmJiBwYXJzZUludChjb250ZW50TGVuZ3RoLCAxMCkgPiBtYXhCeXRlcykge1xuICAgICAgICByZXEucmVzdW1lKCk7XG4gICAgICAgIG5leHQobmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLkZJTEVfU0FWRV9FUlJPUixcbiAgICAgICAgICBgRmlsZSBzaXplIGV4Y2VlZHMgbWF4aW11bSBhbGxvd2VkOiAke21heEJ5dGVzfSBieXRlcy5gXG4gICAgICAgICkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1pbWUgPSAoYXdhaXQgaW1wb3J0KCdtaW1lJykpLmRlZmF1bHQ7XG5cbiAgICAgIC8vIEluZmVyIGNvbnRlbnQgdHlwZSBmcm9tIGV4dGVuc2lvbiBvciBhZGQgZXh0ZW5zaW9uIGZyb20gY29udGVudCB0eXBlXG4gICAgICBjb25zdCBoYXNFeHRlbnNpb24gPSBmaWxlbmFtZSAmJiBmaWxlbmFtZS5pbmNsdWRlcygnLicpO1xuICAgICAgaWYgKGhhc0V4dGVuc2lvbiAmJiAhY29udGVudFR5cGUpIHtcbiAgICAgICAgY29udGVudFR5cGUgPSBtaW1lLmdldFR5cGUoZmlsZW5hbWUpO1xuICAgICAgfSBlbHNlIGlmICghaGFzRXh0ZW5zaW9uICYmIGNvbnRlbnRUeXBlKSB7XG4gICAgICAgIC8vIGV4dGVuc2lvbiB3aWxsIGJlIGFkZGVkIGJ5IGZpbGVzQ29udHJvbGxlci5jcmVhdGVGaWxlXG4gICAgICB9XG5cbiAgICAgIC8vIENyZWF0ZSBzaXplLWxpbWl0ZWQgc3RyZWFtIHdyYXBwaW5nIHRoZSByZXF1ZXN0XG4gICAgICBzdHJlYW0gPSBjcmVhdGVTaXplTGltaXRlZFN0cmVhbShyZXEsIG1heEJ5dGVzKTtcblxuICAgICAgLy8gQnVpbGQgYSBQYXJzZS5GaWxlIHdpdGggbm8gX2RhdGEgKHN0cmVhbWluZyBtb2RlKVxuICAgICAgY29uc3QgZmlsZSA9IG5ldyBQYXJzZS5GaWxlKGZpbGVuYW1lLCB7IGJhc2U2NDogJycgfSwgY29udGVudFR5cGUpO1xuICAgICAgY29uc3QgeyBtZXRhZGF0YSA9IHt9LCB0YWdzID0ge30sIGRpcmVjdG9yeSB9ID0gcmVxLmZpbGVEYXRhIHx8IHt9O1xuXG4gICAgICAvLyBWYWxpZGF0ZSBtZXRhZGF0YSBhbmQgdGFncyBmb3IgcHJvaGliaXRlZCBrZXl3b3Jkc1xuICAgICAgdHJ5IHtcbiAgICAgICAgVXRpbHMuY2hlY2tQcm9oaWJpdGVkS2V5d29yZHMoY29uZmlnLCBtZXRhZGF0YSk7XG4gICAgICAgIFV0aWxzLmNoZWNrUHJvaGliaXRlZEtleXdvcmRzKGNvbmZpZywgdGFncyk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBzdHJlYW0uZGVzdHJveSgpO1xuICAgICAgICBuZXh0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCBlcnJvcikpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGZpbGUuc2V0VGFncyh0YWdzKTtcbiAgICAgIGZpbGUuc2V0TWV0YWRhdGEobWV0YWRhdGEpO1xuICAgICAgaWYgKGRpcmVjdG9yeSkge1xuICAgICAgICBmaWxlLnNldERpcmVjdG9yeShkaXJlY3RvcnkpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBmaWxlU2l6ZSA9IHJlcS5nZXQoJ0NvbnRlbnQtTGVuZ3RoJylcbiAgICAgICAgPyBwYXJzZUludChyZXEuZ2V0KCdDb250ZW50LUxlbmd0aCcpLCAxMClcbiAgICAgICAgOiBudWxsO1xuICAgICAgY29uc3QgZmlsZU9iamVjdCA9IHsgZmlsZSwgZmlsZVNpemUsIHN0cmVhbTogdHJ1ZSB9O1xuXG4gICAgICAvLyBSdW4gYmVmb3JlU2F2ZUZpbGUgdHJpZ2dlclxuICAgICAgY29uc3QgdHJpZ2dlclJlc3VsdCA9IGF3YWl0IHRyaWdnZXJzLm1heWJlUnVuRmlsZVRyaWdnZXIoXG4gICAgICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZVNhdmUsXG4gICAgICAgIGZpbGVPYmplY3QsXG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgcmVxLmF1dGhcbiAgICAgICk7XG5cbiAgICAgIGxldCBzYXZlUmVzdWx0O1xuICAgICAgLy8gSWYgYSBuZXcgUGFyc2VGaWxlIGlzIHJldHVybmVkLCBjaGVjayBpZiBpdCdzIGFuIGFscmVhZHkgc2F2ZWQgZmlsZVxuICAgICAgaWYgKHRyaWdnZXJSZXN1bHQgaW5zdGFuY2VvZiBQYXJzZS5GaWxlKSB7XG4gICAgICAgIGZpbGVPYmplY3QuZmlsZSA9IHRyaWdnZXJSZXN1bHQ7XG4gICAgICAgIGlmICh0cmlnZ2VyUmVzdWx0LnVybCgpKSB7XG4gICAgICAgICAgZmlsZU9iamVjdC5maWxlU2l6ZSA9IG51bGw7XG4gICAgICAgICAgc2F2ZVJlc3VsdCA9IHtcbiAgICAgICAgICAgIHVybDogdHJpZ2dlclJlc3VsdC51cmwoKSxcbiAgICAgICAgICAgIG5hbWU6IHRyaWdnZXJSZXN1bHQuX25hbWUsXG4gICAgICAgICAgfTtcbiAgICAgICAgICAvLyBEZXN0cm95IHN0cmVhbSB0byByZW1vdmUgbGlzdGVuZXJzIGFuZCBkcmFpbiByZXF1ZXN0XG4gICAgICAgICAgc3RyZWFtLmRlc3Ryb3koKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBJZiB0aGUgZmlsZSByZXR1cm5lZCBieSB0aGUgdHJpZ2dlciBoYXMgYWxyZWFkeSBiZWVuIHNhdmVkLCBza2lwIHNhdmluZ1xuICAgICAgaWYgKCFzYXZlUmVzdWx0KSB7XG4gICAgICAgIC8vIFByZXBhcmUgZmlsZSBvcHRpb25zXG4gICAgICAgIGNvbnN0IGZpbGVPcHRpb25zID0ge1xuICAgICAgICAgIG1ldGFkYXRhOiBmaWxlT2JqZWN0LmZpbGUuX21ldGFkYXRhLFxuICAgICAgICB9O1xuICAgICAgICBjb25zdCBmaWxlVGFncyA9XG4gICAgICAgICAgT2JqZWN0LmtleXMoZmlsZU9iamVjdC5maWxlLl90YWdzKS5sZW5ndGggPiAwID8geyB0YWdzOiBmaWxlT2JqZWN0LmZpbGUuX3RhZ3MgfSA6IHt9O1xuICAgICAgICBPYmplY3QuYXNzaWduKGZpbGVPcHRpb25zLCBmaWxlVGFncyk7XG4gICAgICAgIC8vIGluY2x1ZGUgZGlyZWN0b3J5IGlmIHNldCAoZnJvbSBjbGllbnQgcmVxdWVzdCBvciBiZWZvcmVTYXZlRmlsZSB0cmlnZ2VyKVxuICAgICAgICBpZiAoZmlsZU9iamVjdC5maWxlLl9kaXJlY3RvcnkpIHtcbiAgICAgICAgICBmaWxlT3B0aW9ucy5kaXJlY3RvcnkgPSBmaWxlT2JqZWN0LmZpbGUuX2RpcmVjdG9yeTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFBhc3Mgc3RyZWFtIGRpcmVjdGx5IHRvIGZpbGVzQ29udHJvbGxlciDigJQgaXQgd2lsbCBidWZmZXIgaWYgYWRhcHRlciBkb2Vzbid0IHN1cHBvcnQgc3RyZWFtaW5nXG4gICAgICAgIGNvbnN0IHNvdXJjZVR5cGUgPSBmaWxlT2JqZWN0LmZpbGUuX3NvdXJjZT8udHlwZSB8fCBjb250ZW50VHlwZTtcbiAgICAgICAgY29uc3QgY3JlYXRlRmlsZVJlc3VsdCA9IGF3YWl0IGZpbGVzQ29udHJvbGxlci5jcmVhdGVGaWxlKFxuICAgICAgICAgIGNvbmZpZyxcbiAgICAgICAgICBmaWxlT2JqZWN0LmZpbGUuX25hbWUsXG4gICAgICAgICAgc3RyZWFtLFxuICAgICAgICAgIHNvdXJjZVR5cGUsXG4gICAgICAgICAgZmlsZU9wdGlvbnNcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBVcGRhdGUgZmlsZSB3aXRoIG5ldyBkYXRhXG4gICAgICAgIGZpbGVPYmplY3QuZmlsZS5fbmFtZSA9IGNyZWF0ZUZpbGVSZXN1bHQubmFtZTtcbiAgICAgICAgZmlsZU9iamVjdC5maWxlLl91cmwgPSBjcmVhdGVGaWxlUmVzdWx0LnVybDtcbiAgICAgICAgZmlsZU9iamVjdC5maWxlLl9yZXF1ZXN0VGFzayA9IG51bGw7XG4gICAgICAgIGZpbGVPYmplY3QuZmlsZS5fcHJldmlvdXNTYXZlID0gUHJvbWlzZS5yZXNvbHZlKGZpbGVPYmplY3QuZmlsZSk7XG4gICAgICAgIHNhdmVSZXN1bHQgPSB7XG4gICAgICAgICAgdXJsOiBjcmVhdGVGaWxlUmVzdWx0LnVybCxcbiAgICAgICAgICBuYW1lOiBjcmVhdGVGaWxlUmVzdWx0Lm5hbWUsXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIFJ1biBhZnRlclNhdmVGaWxlIHRyaWdnZXJcbiAgICAgIGF3YWl0IHRyaWdnZXJzLm1heWJlUnVuRmlsZVRyaWdnZXIodHJpZ2dlcnMuVHlwZXMuYWZ0ZXJTYXZlLCBmaWxlT2JqZWN0LCBjb25maWcsIHJlcS5hdXRoKTtcbiAgICAgIHJlcy5zdGF0dXMoMjAxKTtcbiAgICAgIHJlcy5zZXQoJ0xvY2F0aW9uJywgc2F2ZVJlc3VsdC51cmwpO1xuICAgICAgcmVzLmpzb24oc2F2ZVJlc3VsdCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gRGVzdHJveSBzdHJlYW0gdG8gcmVtb3ZlIGxpc3RlbmVycyBhbmQgZHJhaW4gcmVxdWVzdCwgb3IgcmVzdW1lIGRpcmVjdGx5XG4gICAgICBpZiAoc3RyZWFtKSB7XG4gICAgICAgIHN0cmVhbS5kZXN0cm95KCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXEucmVzdW1lKCk7XG4gICAgICB9XG4gICAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIGNyZWF0aW5nIGEgZmlsZTogJywgZSk7XG4gICAgICBjb25zdCBlcnJvciA9IHRyaWdnZXJzLnJlc29sdmVFcnJvcihlLCB7XG4gICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLkZJTEVfU0FWRV9FUlJPUixcbiAgICAgICAgbWVzc2FnZTogYENvdWxkIG5vdCBzdG9yZSBmaWxlOiAke2ZpbGVuYW1lfS5gLFxuICAgICAgfSk7XG4gICAgICBuZXh0KGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBkZWxldGVIYW5kbGVyKHJlcSwgcmVzLCBuZXh0KSB7XG4gICAgaWYgKHJlcS5hdXRoLmlzUmVhZE9ubHkpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gY3JlYXRlU2FuaXRpemVkSHR0cEVycm9yKDQwMywgXCJyZWFkLW9ubHkgbWFzdGVyS2V5IGlzbid0IGFsbG93ZWQgdG8gZGVsZXRlIGEgZmlsZS5cIiwgcmVxLmNvbmZpZyk7XG4gICAgICByZXMuc3RhdHVzKGVycm9yLnN0YXR1cyk7XG4gICAgICByZXMuZW5kKGB7XCJlcnJvclwiOlwiJHtlcnJvci5tZXNzYWdlfVwifWApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBmaWxlc0NvbnRyb2xsZXIgfSA9IHJlcS5jb25maWc7XG4gICAgICBjb25zdCBmaWxlbmFtZSA9IEZpbGVzUm91dGVyLl9nZXRGaWxlbmFtZUZyb21QYXJhbXMocmVxKTtcbiAgICAgIC8vIHJ1biBiZWZvcmVEZWxldGVGaWxlIHRyaWdnZXJcbiAgICAgIGNvbnN0IGZpbGUgPSBuZXcgUGFyc2UuRmlsZShmaWxlbmFtZSk7XG4gICAgICBmaWxlLl91cmwgPSBhd2FpdCBmaWxlc0NvbnRyb2xsZXIuYWRhcHRlci5nZXRGaWxlTG9jYXRpb24ocmVxLmNvbmZpZywgZmlsZW5hbWUpO1xuICAgICAgY29uc3QgZmlsZU9iamVjdCA9IHsgZmlsZSwgZmlsZVNpemU6IG51bGwgfTtcbiAgICAgIGF3YWl0IHRyaWdnZXJzLm1heWJlUnVuRmlsZVRyaWdnZXIoXG4gICAgICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZURlbGV0ZSxcbiAgICAgICAgZmlsZU9iamVjdCxcbiAgICAgICAgcmVxLmNvbmZpZyxcbiAgICAgICAgcmVxLmF1dGhcbiAgICAgICk7XG4gICAgICAvLyBkZWxldGUgZmlsZVxuICAgICAgYXdhaXQgZmlsZXNDb250cm9sbGVyLmRlbGV0ZUZpbGUocmVxLmNvbmZpZywgZmlsZW5hbWUpO1xuICAgICAgLy8gcnVuIGFmdGVyRGVsZXRlRmlsZSB0cmlnZ2VyXG4gICAgICBhd2FpdCB0cmlnZ2Vycy5tYXliZVJ1bkZpbGVUcmlnZ2VyKFxuICAgICAgICB0cmlnZ2Vycy5UeXBlcy5hZnRlckRlbGV0ZSxcbiAgICAgICAgZmlsZU9iamVjdCxcbiAgICAgICAgcmVxLmNvbmZpZyxcbiAgICAgICAgcmVxLmF1dGhcbiAgICAgICk7XG4gICAgICByZXMuc3RhdHVzKDIwMCk7XG4gICAgICAvLyBUT0RPOiByZXR1cm4gdXNlZnVsIEpTT04gaGVyZT9cbiAgICAgIHJlcy5lbmQoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIGRlbGV0aW5nIGEgZmlsZTogJywgZSk7XG4gICAgICBjb25zdCBlcnJvciA9IHRyaWdnZXJzLnJlc29sdmVFcnJvcihlLCB7XG4gICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLkZJTEVfREVMRVRFX0VSUk9SLFxuICAgICAgICBtZXNzYWdlOiAnQ291bGQgbm90IGRlbGV0ZSBmaWxlLicsXG4gICAgICB9KTtcbiAgICAgIG5leHQoZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIG1ldGFkYXRhSGFuZGxlcihyZXEsIHJlcykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb25maWcgPSBDb25maWcuZ2V0KHJlcS5wYXJhbXMuYXBwSWQpO1xuICAgICAgaWYgKCFjb25maWcpIHtcbiAgICAgICAgcmVzLnN0YXR1cygyMDApO1xuICAgICAgICByZXMuanNvbih7fSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIEZpbGVzUm91dGVyLl92YWxpZGF0ZUZpbGVEb3dubG9hZChyZXEsIGNvbmZpZyk7XG4gICAgICBjb25zdCB7IGZpbGVzQ29udHJvbGxlciB9ID0gY29uZmlnO1xuICAgICAgbGV0IGZpbGVuYW1lID0gRmlsZXNSb3V0ZXIuX2dldEZpbGVuYW1lRnJvbVBhcmFtcyhyZXEpO1xuICAgICAgY29uc3QgZmlsZSA9IG5ldyBQYXJzZS5GaWxlKGZpbGVuYW1lLCB7IGJhc2U2NDogJycgfSk7XG4gICAgICBjb25zdCBmaWxlQXV0aCA9IHJlcS5hdXRoO1xuICAgICAgY29uc3QgdHJpZ2dlclJlc3VsdCA9IGF3YWl0IHRyaWdnZXJzLm1heWJlUnVuRmlsZVRyaWdnZXIoXG4gICAgICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZUZpbmQsXG4gICAgICAgIHsgZmlsZSB9LFxuICAgICAgICBjb25maWcsXG4gICAgICAgIGZpbGVBdXRoXG4gICAgICApO1xuICAgICAgaWYgKHRyaWdnZXJSZXN1bHQ/LmZpbGU/Ll9uYW1lKSB7XG4gICAgICAgIGZpbGVuYW1lID0gdHJpZ2dlclJlc3VsdC5maWxlLl9uYW1lO1xuICAgICAgfVxuICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGZpbGVzQ29udHJvbGxlci5nZXRNZXRhZGF0YShmaWxlbmFtZSkuY2F0Y2goKCkgPT4ge1xuICAgICAgICByZXMuc3RhdHVzKDIwMCk7XG4gICAgICAgIHJlcy5qc29uKHt9KTtcbiAgICAgIH0pO1xuICAgICAgaWYgKCFkYXRhKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHRyaWdnZXJzLm1heWJlUnVuRmlsZVRyaWdnZXIoXG4gICAgICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyRmluZCxcbiAgICAgICAgeyBmaWxlIH0sXG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgZmlsZUF1dGhcbiAgICAgICk7XG4gICAgICByZXMuc3RhdHVzKDIwMCk7XG4gICAgICByZXMuanNvbihkYXRhKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zdCBlcnIgPSB0cmlnZ2Vycy5yZXNvbHZlRXJyb3IoZSwge1xuICAgICAgICBjb2RlOiBQYXJzZS5FcnJvci5TQ1JJUFRfRkFJTEVELFxuICAgICAgICBtZXNzYWdlOiAnQ291bGQgbm90IGdldCBmaWxlIG1ldGFkYXRhLicsXG4gICAgICB9KTtcbiAgICAgIHJlcy5zdGF0dXMoNDAzKTtcbiAgICAgIHJlcy5qc29uKHsgY29kZTogZXJyLmNvZGUsIGVycm9yOiBlcnIubWVzc2FnZSB9KTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNGaWxlU3RyZWFtYWJsZShyZXEsIGZpbGVzQ29udHJvbGxlcikge1xuICBjb25zdCByYW5nZSA9IChyZXEuZ2V0KCdSYW5nZScpIHx8ICcvLS8nKS5zcGxpdCgnLScpO1xuICBjb25zdCBzdGFydCA9IE51bWJlcihyYW5nZVswXSk7XG4gIGNvbnN0IGVuZCA9IE51bWJlcihyYW5nZVsxXSk7XG4gIHJldHVybiAoXG4gICAgKCFpc05hTihzdGFydCkgfHwgIWlzTmFOKGVuZCkpICYmIHR5cGVvZiBmaWxlc0NvbnRyb2xsZXIuYWRhcHRlci5oYW5kbGVGaWxlU3RyZWFtID09PSAnZnVuY3Rpb24nXG4gICk7XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQSxJQUFBQSxRQUFBLEdBQUFDLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxXQUFBLEdBQUFDLHVCQUFBLENBQUFGLE9BQUE7QUFDQSxJQUFBRyxLQUFBLEdBQUFKLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBSSxPQUFBLEdBQUFMLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBSyxPQUFBLEdBQUFOLHNCQUFBLENBQUFDLE9BQUE7QUFHQSxJQUFBTSxPQUFBLEdBQUFOLE9BQUE7QUFDQSxJQUFBTyxNQUFBLEdBQUFQLE9BQUE7QUFBb0QsU0FBQUUsd0JBQUFNLENBQUEsRUFBQUMsQ0FBQSw2QkFBQUMsT0FBQSxNQUFBQyxDQUFBLE9BQUFELE9BQUEsSUFBQUUsQ0FBQSxPQUFBRixPQUFBLFlBQUFSLHVCQUFBLFlBQUFBLENBQUFNLENBQUEsRUFBQUMsQ0FBQSxTQUFBQSxDQUFBLElBQUFELENBQUEsSUFBQUEsQ0FBQSxDQUFBSyxVQUFBLFNBQUFMLENBQUEsTUFBQU0sQ0FBQSxFQUFBQyxDQUFBLEVBQUFDLENBQUEsS0FBQUMsU0FBQSxRQUFBQyxPQUFBLEVBQUFWLENBQUEsaUJBQUFBLENBQUEsdUJBQUFBLENBQUEseUJBQUFBLENBQUEsU0FBQVEsQ0FBQSxNQUFBRixDQUFBLEdBQUFMLENBQUEsR0FBQUcsQ0FBQSxHQUFBRCxDQUFBLFFBQUFHLENBQUEsQ0FBQUssR0FBQSxDQUFBWCxDQUFBLFVBQUFNLENBQUEsQ0FBQU0sR0FBQSxDQUFBWixDQUFBLEdBQUFNLENBQUEsQ0FBQU8sR0FBQSxDQUFBYixDQUFBLEVBQUFRLENBQUEsZ0JBQUFQLENBQUEsSUFB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