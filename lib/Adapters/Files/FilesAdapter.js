"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.FilesAdapter = void 0;
exports.validateFilename = validateFilename;
var _node = _interopRequireDefault(require("parse/node"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/* eslint-disable unused-imports/no-unused-vars */
// Files Adapter
//
// Allows you to change the file storage mechanism.
//
// Adapter classes must implement the following functions:
// * createFile(filename, data, contentType)
// * deleteFile(filename)
// * getFileData(filename)
// * getFileLocation(config, filename)
// Adapter classes should implement the following functions:
// * validateFilename(filename)
// * handleFileStream(filename, req, res, contentType)
//
// Default is GridFSBucketAdapter, which requires mongo
// and for the API server to be using the DatabaseController with Mongo
// database adapter.

/**
 * @interface
 * @memberof module:Adapters
 */
class FilesAdapter {
  /** Responsible for storing the file in order to be retrieved later by its filename
   *
   * @param {string} filename - the filename to save
   * @param {Buffer|Readable} data - the file data as a Buffer, or a Readable stream if the adapter supports streaming (see supportsStreaming)
   * @param {string} contentType - the supposed contentType
   * @discussion the contentType can be undefined if the controller was not able to determine it
   * @param {object} options - (Optional) options to be passed to file adapter (S3 File Adapter Only)
   * - tags: object containing key value pairs that will be stored with file
   * - metadata: object containing key value pairs that will be sotred with file (https://docs.aws.amazon.com/AmazonS3/latest/user-guide/add-object-metadata.html)
   * @discussion options are not supported by all file adapters. Check the your adapter's documentation for compatibility
   *
   * @return {Promise} a promise that should fail if the storage didn't succeed
   */
  createFile(filename, data, contentType, options) {}

  /** Whether this adapter supports receiving Readable streams in createFile().
   * If false (default), streams are buffered to a Buffer before being passed.
   * Override and return true to receive Readable streams directly.
   *
   * @return {boolean}
   */
  get supportsStreaming() {
    return false;
  }

  /** Responsible for deleting the specified file
   *
   * @param {string} filename - the filename to delete
   *
   * @return {Promise} a promise that should fail if the deletion didn't succeed
   */
  deleteFile(filename) {}

  /** Responsible for retrieving the data of the specified file
   *
   * @param {string} filename - the name of file to retrieve
   *
   * @return {Promise} a promise that should pass with the file data or fail on error
   */
  getFileData(filename) {}

  /** Returns an absolute URL where the file can be accessed
   *
   * @param {Config} config - server configuration
   * @param {string} filename
   *
   * @return {string | Promise<string>} Absolute URL
   */
  getFileLocation(config, filename) {}

  /** Validate a filename for this adapter type
   *
   * @param {string} filename
   *
   * @returns {null|Parse.Error} null if there are no errors
   */
  // validateFilename(filename: string): ?Parse.Error {}

  /** Handles Byte-Range Requests for Streaming
   *
   * @param {string} filename
   * @param {object} req
   * @param {object} res
   * @param {string} contentType
   *
   * @returns {Promise} Data for byte range
   */
  // handleFileStream(filename: string, res: any, req: any, contentType: string): Promise

  /** Responsible for retrieving metadata and tags
   *
   * @param {string} filename - the filename to retrieve metadata
   *
   * @return {Promise} a promise that should pass with metadata
   */
  // getMetadata(filename: string): Promise<any> {}
}

/**
 * Simple filename validation
 *
 * @param filename
 * @returns {null|Parse.Error}
 */
exports.FilesAdapter = FilesAdapter;
function validateFilename(filename) {
  if (filename.length > 128) {
    return new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, 'Filename too long.');
  }
  const regx = /^[_a-zA-Z0-9][a-zA-Z0-9@. ~_-]*$/;
  if (!filename.match(regx)) {
    return new _node.default.Error(_node.default.Error.INVALID_FILE_NAME, 'Filename contains invalid characters.');
  }
  return null;
}
var _default = exports.default = FilesAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbm9kZSIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiRmlsZXNBZGFwdGVyIiwiY3JlYXRlRmlsZSIsImZpbGVuYW1lIiwiZGF0YSIsImNvbnRlbnRUeXBlIiwib3B0aW9ucyIsInN1cHBvcnRzU3RyZWFtaW5nIiwiZGVsZXRlRmlsZSIsImdldEZpbGVEYXRhIiwiZ2V0RmlsZUxvY2F0aW9uIiwiY29uZmlnIiwiZXhwb3J0cyIsInZhbGlkYXRlRmlsZW5hbWUiLCJsZW5ndGgiLCJQYXJzZSIsIkVycm9yIiwiSU5WQUxJRF9GSUxFX05BTUUiLCJyZWd4IiwibWF0Y2giLCJfZGVmYXVsdCJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9GaWxlcy9GaWxlc0FkYXB0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyogZXNsaW50LWRpc2FibGUgdW51c2VkLWltcG9ydHMvbm8tdW51c2VkLXZhcnMgKi9cbi8vIEZpbGVzIEFkYXB0ZXJcbi8vXG4vLyBBbGxvd3MgeW91IHRvIGNoYW5nZSB0aGUgZmlsZSBzdG9yYWdlIG1lY2hhbmlzbS5cbi8vXG4vLyBBZGFwdGVyIGNsYXNzZXMgbXVzdCBpbXBsZW1lbnQgdGhlIGZvbGxvd2luZyBmdW5jdGlvbnM6XG4vLyAqIGNyZWF0ZUZpbGUoZmlsZW5hbWUsIGRhdGEsIGNvbnRlbnRUeXBlKVxuLy8gKiBkZWxldGVGaWxlKGZpbGVuYW1lKVxuLy8gKiBnZXRGaWxlRGF0YShmaWxlbmFtZSlcbi8vICogZ2V0RmlsZUxvY2F0aW9uKGNvbmZpZywgZmlsZW5hbWUpXG4vLyBBZGFwdGVyIGNsYXNzZXMgc2hvdWxkIGltcGxlbWVudCB0aGUgZm9sbG93aW5nIGZ1bmN0aW9uczpcbi8vICogdmFsaWRhdGVGaWxlbmFtZShmaWxlbmFtZSlcbi8vICogaGFuZGxlRmlsZVN0cmVhbShmaWxlbmFtZSwgcmVxLCByZXMsIGNvbnRlbnRUeXBlKVxuLy9cbi8vIERlZmF1bHQgaXMgR3JpZEZTQnVja2V0QWRhcHRlciwgd2hpY2ggcmVxdWlyZXMgbW9uZ29cbi8vIGFuZCBmb3IgdGhlIEFQSSBzZXJ2ZXIgdG8gYmUgdXNpbmcgdGhlIERhdGFiYXNlQ29udHJvbGxlciB3aXRoIE1vbmdvXG4vLyBkYXRhYmFzZSBhZGFwdGVyLlxuXG5pbXBvcnQgdHlwZSB7IENvbmZpZyB9IGZyb20gJy4uLy4uL0NvbmZpZyc7XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG4vKipcbiAqIEBpbnRlcmZhY2VcbiAqIEBtZW1iZXJvZiBtb2R1bGU6QWRhcHRlcnNcbiAqL1xuZXhwb3J0IGNsYXNzIEZpbGVzQWRhcHRlciB7XG4gIC8qKiBSZXNwb25zaWJsZSBmb3Igc3RvcmluZyB0aGUgZmlsZSBpbiBvcmRlciB0byBiZSByZXRyaWV2ZWQgbGF0ZXIgYnkgaXRzIGZpbGVuYW1lXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlbmFtZSAtIHRoZSBmaWxlbmFtZSB0byBzYXZlXG4gICAqIEBwYXJhbSB7QnVmZmVyfFJlYWRhYmxlfSBkYXRhIC0gdGhlIGZpbGUgZGF0YSBhcyBhIEJ1ZmZlciwgb3IgYSBSZWFkYWJsZSBzdHJlYW0gaWYgdGhlIGFkYXB0ZXIgc3VwcG9ydHMgc3RyZWFtaW5nIChzZWUgc3VwcG9ydHNTdHJlYW1pbmcpXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50VHlwZSAtIHRoZSBzdXBwb3NlZCBjb250ZW50VHlwZVxuICAgKiBAZGlzY3Vzc2lvbiB0aGUgY29udGVudFR5cGUgY2FuIGJlIHVuZGVmaW5lZCBpZiB0aGUgY29udHJvbGxlciB3YXMgbm90IGFibGUgdG8gZGV0ZXJtaW5lIGl0XG4gICAqIEBwYXJhbSB7b2JqZWN0fSBvcHRpb25zIC0gKE9wdGlvbmFsKSBvcHRpb25zIHRvIGJlIHBhc3NlZCB0byBmaWxlIGFkYXB0ZXIgKFMzIEZpbGUgQWRhcHRlciBPbmx5KVxuICAgKiAtIHRhZ3M6IG9iamVjdCBjb250YWluaW5nIGtleSB2YWx1ZSBwYWlycyB0aGF0IHdpbGwgYmUgc3RvcmVkIHdpdGggZmlsZVxuICAgKiAtIG1ldGFkYXRhOiBvYmplY3QgY29udGFpbmluZyBrZXkgdmFsdWUgcGFpcnMgdGhhdCB3aWxsIGJlIHNvdHJlZCB3aXRoIGZpbGUgKGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25TMy9sYXRlc3QvdXNlci1ndWlkZS9hZGQtb2JqZWN0LW1ldGFkYXRhLmh0bWwpXG4gICAqIEBkaXNjdXNzaW9uIG9wdGlvbnMgYXJlIG5vdCBzdXBwb3J0ZWQgYnkgYWxsIGZpbGUgYWRhcHRlcnMuIENoZWNrIHRoZSB5b3VyIGFkYXB0ZXIncyBkb2N1bWVudGF0aW9uIGZvciBjb21wYXRpYmlsaXR5XG4gICAqXG4gICAqIEByZXR1cm4ge1Byb21pc2V9IGEgcHJvbWlzZSB0aGF0IHNob3VsZCBmYWlsIGlmIHRoZSBzdG9yYWdlIGRpZG4ndCBzdWNjZWVkXG4gICAqL1xuICBjcmVhdGVGaWxlKGZpbGVuYW1lOiBzdHJpbmcsIGRhdGEsIGNvbnRlbnRUeXBlOiBzdHJpbmcsIG9wdGlvbnM6IE9iamVjdCk6IFByb21pc2Uge31cblxuICAvKiogV2hldGhlciB0aGlzIGFkYXB0ZXIgc3VwcG9ydHMgcmVjZWl2aW5nIFJlYWRhYmxlIHN0cmVhbXMgaW4gY3JlYXRlRmlsZSgpLlxuICAgKiBJZiBmYWxzZSAoZGVmYXVsdCksIHN0cmVhbXMgYXJlIGJ1ZmZlcmVkIHRvIGEgQnVmZmVyIGJlZm9yZSBiZWluZyBwYXNzZWQuXG4gICAqIE92ZXJyaWRlIGFuZCByZXR1cm4gdHJ1ZSB0byByZWNlaXZlIFJlYWRhYmxlIHN0cmVhbXMgZGlyZWN0bHkuXG4gICAqXG4gICAqIEByZXR1cm4ge2Jvb2xlYW59XG4gICAqL1xuICBnZXQgc3VwcG9ydHNTdHJlYW1pbmcoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLyoqIFJlc3BvbnNpYmxlIGZvciBkZWxldGluZyB0aGUgc3BlY2lmaWVkIGZpbGVcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVuYW1lIC0gdGhlIGZpbGVuYW1lIHRvIGRlbGV0ZVxuICAgKlxuICAgKiBAcmV0dXJuIHtQcm9taXNlfSBhIHByb21pc2UgdGhhdCBzaG91bGQgZmFpbCBpZiB0aGUgZGVsZXRpb24gZGlkbid0IHN1Y2NlZWRcbiAgICovXG4gIGRlbGV0ZUZpbGUoZmlsZW5hbWU6IHN0cmluZyk6IFByb21pc2Uge31cblxuICAvKiogUmVzcG9uc2libGUgZm9yIHJldHJpZXZpbmcgdGhlIGRhdGEgb2YgdGhlIHNwZWNpZmllZCBmaWxlXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlbmFtZSAtIHRoZSBuYW1lIG9mIGZpbGUgdG8gcmV0cmlldmVcbiAgICpcbiAgICogQHJldHVybiB7UHJvbWlzZX0gYSBwcm9taXNlIHRoYXQgc2hvdWxkIHBhc3Mgd2l0aCB0aGUgZmlsZSBkYXRhIG9yIGZhaWwgb24gZXJyb3JcbiAgICovXG4gIGdldEZpbGVEYXRhKGZpbGVuYW1lOiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge31cblxuICAvKiogUmV0dXJucyBhbiBhYnNvbHV0ZSBVUkwgd2hlcmUgdGhlIGZpbGUgY2FuIGJlIGFjY2Vzc2VkXG4gICAqXG4gICAqIEBwYXJhbSB7Q29uZmlnfSBjb25maWcgLSBzZXJ2ZXIgY29uZmlndXJhdGlvblxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZW5hbWVcbiAgICpcbiAgICogQHJldHVybiB7c3RyaW5nIHwgUHJvbWlzZTxzdHJpbmc+fSBBYnNvbHV0ZSBVUkxcbiAgICovXG4gIGdldEZpbGVMb2NhdGlvbihjb25maWc6IENvbmZpZywgZmlsZW5hbWU6IHN0cmluZyk6IHN0cmluZyB8IFByb21pc2U8c3RyaW5nPiB7fVxuXG4gIC8qKiBWYWxpZGF0ZSBhIGZpbGVuYW1lIGZvciB0aGlzIGFkYXB0ZXIgdHlwZVxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZW5hbWVcbiAgICpcbiAgICogQHJldHVybnMge251bGx8UGFyc2UuRXJyb3J9IG51bGwgaWYgdGhlcmUgYXJlIG5vIGVycm9yc1xuICAgKi9cbiAgLy8gdmFsaWRhdGVGaWxlbmFtZShmaWxlbmFtZTogc3RyaW5nKTogP1BhcnNlLkVycm9yIHt9XG5cbiAgLyoqIEhhbmRsZXMgQnl0ZS1SYW5nZSBSZXF1ZXN0cyBmb3IgU3RyZWFtaW5nXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlbmFtZVxuICAgKiBAcGFyYW0ge29iamVjdH0gcmVxXG4gICAqIEBwYXJhbSB7b2JqZWN0fSByZXNcbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnRlbnRUeXBlXG4gICAqXG4gICAqIEByZXR1cm5zIHtQcm9taXNlfSBEYXRhIGZvciBieXRlIHJhbmdlXG4gICAqL1xuICAvLyBoYW5kbGVGaWxlU3RyZWFtKGZpbGVuYW1lOiBzdHJpbmcsIHJlczogYW55LCByZXE6IGFueSwgY29udGVudFR5cGU6IHN0cmluZyk6IFByb21pc2VcblxuICAvKiogUmVzcG9uc2libGUgZm9yIHJldHJpZXZpbmcgbWV0YWRhdGEgYW5kIHRhZ3NcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVuYW1lIC0gdGhlIGZpbGVuYW1lIHRvIHJldHJpZXZlIG1ldGFkYXRhXG4gICAqXG4gICAqIEByZXR1cm4ge1Byb21pc2V9IGEgcHJvbWlzZSB0aGF0IHNob3VsZCBwYXNzIHdpdGggbWV0YWRhdGFcbiAgICovXG4gIC8vIGdldE1ldGFkYXRhKGZpbGVuYW1lOiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge31cbn1cblxuLyoqXG4gKiBTaW1wbGUgZmlsZW5hbWUgdmFsaWRhdGlvblxuICpcbiAqIEBwYXJhbSBmaWxlbmFtZVxuICogQHJldHVybnMge251bGx8UGFyc2UuRXJyb3J9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUZpbGVuYW1lKGZpbGVuYW1lKTogP1BhcnNlLkVycm9yIHtcbiAgaWYgKGZpbGVuYW1lLmxlbmd0aCA+IDEyOCkge1xuICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9GSUxFX05BTUUsICdGaWxlbmFtZSB0b28gbG9uZy4nKTtcbiAgfVxuXG4gIGNvbnN0IHJlZ3ggPSAvXltfYS16QS1aMC05XVthLXpBLVowLTlALiB+Xy1dKiQvO1xuICBpZiAoIWZpbGVuYW1lLm1hdGNoKHJlZ3gpKSB7XG4gICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0ZJTEVfTkFNRSwgJ0ZpbGVuYW1lIGNvbnRhaW5zIGludmFsaWQgY2hhcmFjdGVycy4nKTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgRmlsZXNBZGFwdGVyO1xuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBbUJBLElBQUFBLEtBQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUErQixTQUFBRCx1QkFBQUUsQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FBQUMsVUFBQSxHQUFBRCxDQUFBLEtBQUFFLE9BQUEsRUFBQUYsQ0FBQTtBQW5CL0I7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFJQTtBQUNBO0FBQ0E7QUFDQTtBQUNPLE1BQU1HLFlBQVksQ0FBQztFQUN4QjtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFQyxVQUFVQSxDQUFDQyxRQUFnQixFQUFFQyxJQUFJLEVBQUVDLFdBQW1CLEVBQUVDLE9BQWUsRUFBVyxDQUFDOztFQUVuRjtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRSxJQUFJQyxpQkFBaUJBLENBQUEsRUFBRztJQUN0QixPQUFPLEtBQUs7RUFDZDs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRUMsVUFBVUEsQ0FBQ0wsUUFBZ0IsRUFBVyxDQUFDOztFQUV2QztBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRU0sV0FBV0EsQ0FBQ04sUUFBZ0IsRUFBZ0IsQ0FBQzs7RUFFN0M7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRU8sZUFBZUEsQ0FBQ0MsTUFBYyxFQUFFUixRQUFnQixFQUE0QixDQUFDOztFQUU3RTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRTs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRTs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRTtBQUNGOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUxBUyxPQUFBLENBQUFYLFlBQUEsR0FBQUEsWUFBQTtBQU1PLFNBQVNZLGdCQUFnQkEsQ0FBQ1YsUUFBUSxFQUFnQjtFQUN2RCxJQUFJQSxRQUFRLENBQUNXLE1BQU0sR0FBRyxHQUFHLEVBQUU7SUFDekIsT0FBTyxJQUFJQyxhQUFLLENBQUNDLEtBQUssQ0FBQ0QsYUFBSyxDQUFDQyxLQUFLLENBQUNDLGlCQUFpQixFQUFFLG9CQUFvQixDQUFDO0VBQzdFO0VBRUEsTUFBTUMsSUFBSSxHQUFHLGtDQUFrQztFQUMvQyxJQUFJLENBQUNmLFFBQVEsQ0FBQ2dCLEtBQUssQ0FBQ0QsSUFBSSxDQUFDLEVBQUU7SUFDekIsT0FBTyxJQUFJSCxhQUFLLENBQUNDLEtBQUssQ0FBQ0QsYUFBSyxDQUFDQyxLQUFLLENBQUNDLGlCQUFpQixFQUFFLHVDQUF1QyxDQUFDO0VBQ2hHO0VBQ0EsT0FBTyxJQUFJO0FBQ2I7QUFBQyxJQUFBRyxRQUFBLEdBQUFSLE9BQUEsQ0FBQVosT0FBQSxHQUVjQyxZQUFZIiwiaWdub3JlTGlzdCI6W119