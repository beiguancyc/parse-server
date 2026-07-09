"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.GraphQLConfigKey = exports.GraphQLConfigId = exports.GraphQLConfigClassName = void 0;
var _requiredParameter = _interopRequireDefault(require("../../lib/requiredParameter"));
var _Utils = _interopRequireDefault(require("../Utils"));
var _DatabaseController = _interopRequireDefault(require("./DatabaseController"));
var _CacheController = _interopRequireDefault(require("./CacheController"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const GraphQLConfigClassName = exports.GraphQLConfigClassName = '_GraphQLConfig';
const GraphQLConfigId = exports.GraphQLConfigId = '1';
const GraphQLConfigKey = exports.GraphQLConfigKey = 'config';
class ParseGraphQLController {
  constructor(params = {}) {
    this.databaseController = params.databaseController || (0, _requiredParameter.default)(`ParseGraphQLController requires a "databaseController" to be instantiated.`);
    this.cacheController = params.cacheController;
    this.isMounted = !!params.mountGraphQL;
    this.configCacheKey = GraphQLConfigKey;
  }
  async getGraphQLConfig() {
    if (this.isMounted) {
      const _cachedConfig = await this._getCachedGraphQLConfig();
      if (_cachedConfig) {
        return _cachedConfig;
      }
    }
    const results = await this.databaseController.find(GraphQLConfigClassName, {
      objectId: GraphQLConfigId
    }, {
      limit: 1
    });
    let graphQLConfig;
    if (results.length != 1) {
      // If there is no config in the database - return empty config.
      return {};
    } else {
      graphQLConfig = results[0][GraphQLConfigKey];
    }
    if (this.isMounted) {
      this._putCachedGraphQLConfig(graphQLConfig);
    }
    return graphQLConfig;
  }
  async updateGraphQLConfig(graphQLConfig) {
    // throws if invalid
    this._validateGraphQLConfig(graphQLConfig || (0, _requiredParameter.default)('You must provide a graphQLConfig!'));

    // Transform in dot notation to make sure it works
    const update = Object.keys(graphQLConfig).reduce((acc, key) => {
      return {
        [GraphQLConfigKey]: {
          ...acc[GraphQLConfigKey],
          [key]: graphQLConfig[key]
        }
      };
    }, {
      [GraphQLConfigKey]: {}
    });
    await this.databaseController.update(GraphQLConfigClassName, {
      objectId: GraphQLConfigId
    }, update, {
      upsert: true
    });
    if (this.isMounted) {
      this._putCachedGraphQLConfig(graphQLConfig);
    }
    return {
      response: {
        result: true
      }
    };
  }
  _getCachedGraphQLConfig() {
    return this.cacheController.graphQL.get(this.configCacheKey);
  }
  _putCachedGraphQLConfig(graphQLConfig) {
    return this.cacheController.graphQL.put(this.configCacheKey, graphQLConfig, 60000);
  }
  _validateGraphQLConfig(graphQLConfig) {
    const errorMessages = [];
    if (!graphQLConfig) {
      errorMessages.push('cannot be undefined, null or empty');
    } else if (!isValidSimpleObject(graphQLConfig)) {
      errorMessages.push('must be a valid object');
    } else {
      const {
        enabledForClasses = null,
        disabledForClasses = null,
        classConfigs = null,
        ...invalidKeys
      } = graphQLConfig;
      if (Object.keys(invalidKeys).length) {
        errorMessages.push(`encountered invalid keys: [${Object.keys(invalidKeys)}]`);
      }
      if (enabledForClasses !== null && !isValidStringArray(enabledForClasses)) {
        errorMessages.push(`"enabledForClasses" is not a valid array`);
      }
      if (disabledForClasses !== null && !isValidStringArray(disabledForClasses)) {
        errorMessages.push(`"disabledForClasses" is not a valid array`);
      }
      if (classConfigs !== null) {
        if (Array.isArray(classConfigs)) {
          classConfigs.forEach(classConfig => {
            const errorMessage = this._validateClassConfig(classConfig);
            if (errorMessage) {
              errorMessages.push(`classConfig:${classConfig.className} is invalid because ${errorMessage}`);
            }
          });
        } else {
          errorMessages.push(`"classConfigs" is not a valid array`);
        }
      }
    }
    if (errorMessages.length) {
      throw new Error(`Invalid graphQLConfig: ${errorMessages.join('; ')}`);
    }
  }
  _validateClassConfig(classConfig) {
    if (!isValidSimpleObject(classConfig)) {
      return 'it must be a valid object';
    } else {
      const {
        className,
        type = null,
        query = null,
        mutation = null,
        ...invalidKeys
      } = classConfig;
      if (Object.keys(invalidKeys).length) {
        return `"invalidKeys" [${Object.keys(invalidKeys)}] should not be present`;
      }
      if (typeof className !== 'string' || !className.trim().length) {
        // TODO consider checking class exists in schema?
        return `"className" must be a valid string`;
      }
      if (type !== null) {
        if (!isValidSimpleObject(type)) {
          return `"type" must be a valid object`;
        }
        const {
          inputFields = null,
          outputFields = null,
          constraintFields = null,
          sortFields = null,
          ...invalidKeys
        } = type;
        if (Object.keys(invalidKeys).length) {
          return `"type" contains invalid keys, [${Object.keys(invalidKeys)}]`;
        } else if (outputFields !== null && !isValidStringArray(outputFields)) {
          return `"outputFields" must be a valid string array`;
        } else if (constraintFields !== null && !isValidStringArray(constraintFields)) {
          return `"constraintFields" must be a valid string array`;
        }
        if (sortFields !== null) {
          if (Array.isArray(sortFields)) {
            let errorMessage;
            sortFields.every((sortField, index) => {
              if (!isValidSimpleObject(sortField)) {
                errorMessage = `"sortField" at index ${index} is not a valid object`;
                return false;
              } else {
                const {
                  field,
                  asc,
                  desc,
                  ...invalidKeys
                } = sortField;
                if (Object.keys(invalidKeys).length) {
                  errorMessage = `"sortField" at index ${index} contains invalid keys, [${Object.keys(invalidKeys)}]`;
                  return false;
                } else {
                  if (typeof field !== 'string' || field.trim().length === 0) {
                    errorMessage = `"sortField" at index ${index} did not provide the "field" as a string`;
                    return false;
                  } else if (typeof asc !== 'boolean' || typeof desc !== 'boolean') {
                    errorMessage = `"sortField" at index ${index} did not provide "asc" or "desc" as booleans`;
                    return false;
                  }
                }
              }
              return true;
            });
            if (errorMessage) {
              return errorMessage;
            }
          } else {
            return `"sortFields" must be a valid array.`;
          }
        }
        if (inputFields !== null) {
          if (isValidSimpleObject(inputFields)) {
            const {
              create = null,
              update = null,
              ...invalidKeys
            } = inputFields;
            if (Object.keys(invalidKeys).length) {
              return `"inputFields" contains invalid keys: [${Object.keys(invalidKeys)}]`;
            } else {
              if (update !== null && !isValidStringArray(update)) {
                return `"inputFields.update" must be a valid string array`;
              } else if (create !== null) {
                if (!isValidStringArray(create)) {
                  return `"inputFields.create" must be a valid string array`;
                } else if (className === '_User') {
                  if (!create.includes('username') || !create.includes('password')) {
                    return `"inputFields.create" must include required fields, username and password`;
                  }
                }
              }
            }
          } else {
            return `"inputFields" must be a valid object`;
          }
        }
      }
      if (query !== null) {
        if (isValidSimpleObject(query)) {
          const {
            find = null,
            get = null,
            findAlias = null,
            getAlias = null,
            ...invalidKeys
          } = query;
          if (Object.keys(invalidKeys).length) {
            return `"query" contains invalid keys, [${Object.keys(invalidKeys)}]`;
          } else if (find !== null && typeof find !== 'boolean') {
            return `"query.find" must be a boolean`;
          } else if (get !== null && typeof get !== 'boolean') {
            return `"query.get" must be a boolean`;
          } else if (findAlias !== null && typeof findAlias !== 'string') {
            return `"query.findAlias" must be a string`;
          } else if (getAlias !== null && typeof getAlias !== 'string') {
            return `"query.getAlias" must be a string`;
          }
        } else {
          return `"query" must be a valid object`;
        }
      }
      if (mutation !== null) {
        if (isValidSimpleObject(mutation)) {
          const {
            create = null,
            update = null,
            destroy = null,
            createAlias = null,
            updateAlias = null,
            destroyAlias = null,
            ...invalidKeys
          } = mutation;
          if (Object.keys(invalidKeys).length) {
            return `"mutation" contains invalid keys, [${Object.keys(invalidKeys)}]`;
          }
          if (create !== null && typeof create !== 'boolean') {
            return `"mutation.create" must be a boolean`;
          }
          if (update !== null && typeof update !== 'boolean') {
            return `"mutation.update" must be a boolean`;
          }
          if (destroy !== null && typeof destroy !== 'boolean') {
            return `"mutation.destroy" must be a boolean`;
          }
          if (createAlias !== null && typeof createAlias !== 'string') {
            return `"mutation.createAlias" must be a string`;
          }
          if (updateAlias !== null && typeof updateAlias !== 'string') {
            return `"mutation.updateAlias" must be a string`;
          }
          if (destroyAlias !== null && typeof destroyAlias !== 'string') {
            return `"mutation.destroyAlias" must be a string`;
          }
        } else {
          return `"mutation" must be a valid object`;
        }
      }
    }
  }
}
const isValidStringArray = function (array) {
  return Array.isArray(array) ? !array.some(s => typeof s !== 'string' || s.trim().length < 1) : false;
};
/**
 * Ensures the obj is a simple JSON/{}
 * object, i.e. not an array, null, date
 * etc.
 */
const isValidSimpleObject = function (obj) {
  return typeof obj === 'object' && !Array.isArray(obj) && obj !== null && _Utils.default.isDate(obj) !== true && _Utils.default.isPromise(obj) !== true;
};
var _default = exports.default = ParseGraphQLController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfcmVxdWlyZWRQYXJhbWV0ZXIiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwicmVxdWlyZSIsIl9VdGlscyIsIl9EYXRhYmFzZUNvbnRyb2xsZXIiLCJfQ2FjaGVDb250cm9sbGVyIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiR3JhcGhRTENvbmZpZ0NsYXNzTmFtZSIsImV4cG9ydHMiLCJHcmFwaFFMQ29uZmlnSWQiLCJHcmFwaFFMQ29uZmlnS2V5IiwiUGFyc2VHcmFwaFFMQ29udHJvbGxlciIsImNvbnN0cnVjdG9yIiwicGFyYW1zIiwiZGF0YWJhc2VDb250cm9sbGVyIiwicmVxdWlyZWRQYXJhbWV0ZXIiLCJjYWNoZUNvbnRyb2xsZXIiLCJpc01vdW50ZWQiLCJtb3VudEdyYXBoUUwiLCJjb25maWdDYWNoZUtleSIsImdldEdyYXBoUUxDb25maWciLCJfY2FjaGVkQ29uZmlnIiwiX2dldENhY2hlZEdyYXBoUUxDb25maWciLCJyZXN1bHRzIiwiZmluZCIsIm9iamVjdElkIiwibGltaXQiLCJncmFwaFFMQ29uZmlnIiwibGVuZ3RoIiwiX3B1dENhY2hlZEdyYXBoUUxDb25maWciLCJ1cGRhdGVHcmFwaFFMQ29uZmlnIiwiX3ZhbGlkYXRlR3JhcGhRTENvbmZpZyIsInVwZGF0ZSIsIk9iamVjdCIsImtleXMiLCJyZWR1Y2UiLCJhY2MiLCJrZXkiLCJ1cHNlcnQiLCJyZXNwb25zZSIsInJlc3VsdCIsImdyYXBoUUwiLCJnZXQiLCJwdXQiLCJlcnJvck1lc3NhZ2VzIiwicHVzaCIsImlzVmFsaWRTaW1wbGVPYmplY3QiLCJlbmFibGVkRm9yQ2xhc3NlcyIsImRpc2FibGVkRm9yQ2xhc3NlcyIsImNsYXNzQ29uZmlncyIsImludmFsaWRLZXlzIiwiaXNWYWxpZFN0cmluZ0FycmF5IiwiQXJyYXkiLCJpc0FycmF5IiwiZm9yRWFjaCIsImNsYXNzQ29uZmlnIiwiZXJyb3JNZXNzYWdlIiwiX3ZhbGlkYXRlQ2xhc3NDb25maWciLCJjbGFzc05hbWUiLCJFcnJvciIsImpvaW4iLCJ0eXBlIiwicXVlcnkiLCJtdXRhdGlvbiIsInRyaW0iLCJpbnB1dEZpZWxkcyIsIm91dHB1dEZpZWxkcyIsImNvbnN0cmFpbnRGaWVsZHMiLCJzb3J0RmllbGRzIiwiZXZlcnkiLCJzb3J0RmllbGQiLCJpbmRleCIsImZpZWxkIiwiYXNjIiwiZGVzYyIsImNyZWF0ZSIsImluY2x1ZGVzIiwiZmluZEFsaWFzIiwiZ2V0QWxpYXMiLCJkZXN0cm95IiwiY3JlYXRlQWxpYXMiLCJ1cGRhdGVBbGlhcyIsImRlc3Ryb3lBbGlhcyIsImFycmF5Iiwic29tZSIsInMiLCJvYmoiLCJVdGlscyIsImlzRGF0ZSIsImlzUHJvbWlzZSIsIl9kZWZhdWx0Il0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL0NvbnRyb2xsZXJzL1BhcnNlR3JhcGhRTENvbnRyb2xsZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHJlcXVpcmVkUGFyYW1ldGVyIGZyb20gJy4uLy4uL2xpYi9yZXF1aXJlZFBhcmFtZXRlcic7XG5pbXBvcnQgVXRpbHMgZnJvbSAnLi4vVXRpbHMnO1xuaW1wb3J0IERhdGFiYXNlQ29udHJvbGxlciBmcm9tICcuL0RhdGFiYXNlQ29udHJvbGxlcic7XG5pbXBvcnQgQ2FjaGVDb250cm9sbGVyIGZyb20gJy4vQ2FjaGVDb250cm9sbGVyJztcblxuY29uc3QgR3JhcGhRTENvbmZpZ0NsYXNzTmFtZSA9ICdfR3JhcGhRTENvbmZpZyc7XG5jb25zdCBHcmFwaFFMQ29uZmlnSWQgPSAnMSc7XG5jb25zdCBHcmFwaFFMQ29uZmlnS2V5ID0gJ2NvbmZpZyc7XG5cbmNsYXNzIFBhcnNlR3JhcGhRTENvbnRyb2xsZXIge1xuICBkYXRhYmFzZUNvbnRyb2xsZXI6IERhdGFiYXNlQ29udHJvbGxlcjtcbiAgY2FjaGVDb250cm9sbGVyOiBDYWNoZUNvbnRyb2xsZXI7XG4gIGlzTW91bnRlZDogYm9vbGVhbjtcbiAgY29uZmlnQ2FjaGVLZXk6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwYXJhbXM6IHtcbiAgICAgIGRhdGFiYXNlQ29udHJvbGxlcjogRGF0YWJhc2VDb250cm9sbGVyLFxuICAgICAgY2FjaGVDb250cm9sbGVyOiBDYWNoZUNvbnRyb2xsZXIsXG4gICAgfSA9IHt9XG4gICkge1xuICAgIHRoaXMuZGF0YWJhc2VDb250cm9sbGVyID1cbiAgICAgIHBhcmFtcy5kYXRhYmFzZUNvbnRyb2xsZXIgfHxcbiAgICAgIHJlcXVpcmVkUGFyYW1ldGVyKFxuICAgICAgICBgUGFyc2VHcmFwaFFMQ29udHJvbGxlciByZXF1aXJlcyBhIFwiZGF0YWJhc2VDb250cm9sbGVyXCIgdG8gYmUgaW5zdGFudGlhdGVkLmBcbiAgICAgICk7XG4gICAgdGhpcy5jYWNoZUNvbnRyb2xsZXIgPSBwYXJhbXMuY2FjaGVDb250cm9sbGVyO1xuICAgIHRoaXMuaXNNb3VudGVkID0gISFwYXJhbXMubW91bnRHcmFwaFFMO1xuICAgIHRoaXMuY29uZmlnQ2FjaGVLZXkgPSBHcmFwaFFMQ29uZmlnS2V5O1xuICB9XG5cbiAgYXN5bmMgZ2V0R3JhcGhRTENvbmZpZygpOiBQcm9taXNlPFBhcnNlR3JhcGhRTENvbmZpZz4ge1xuICAgIGlmICh0aGlzLmlzTW91bnRlZCkge1xuICAgICAgY29uc3QgX2NhY2hlZENvbmZpZyA9IGF3YWl0IHRoaXMuX2dldENhY2hlZEdyYXBoUUxDb25maWcoKTtcbiAgICAgIGlmIChfY2FjaGVkQ29uZmlnKSB7XG4gICAgICAgIHJldHVybiBfY2FjaGVkQ29uZmlnO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB0aGlzLmRhdGFiYXNlQ29udHJvbGxlci5maW5kKFxuICAgICAgR3JhcGhRTENvbmZpZ0NsYXNzTmFtZSxcbiAgICAgIHsgb2JqZWN0SWQ6IEdyYXBoUUxDb25maWdJZCB9LFxuICAgICAgeyBsaW1pdDogMSB9XG4gICAgKTtcblxuICAgIGxldCBncmFwaFFMQ29uZmlnO1xuICAgIGlmIChyZXN1bHRzLmxlbmd0aCAhPSAxKSB7XG4gICAgICAvLyBJZiB0aGVyZSBpcyBubyBjb25maWcgaW4gdGhlIGRhdGFiYXNlIC0gcmV0dXJuIGVtcHR5IGNvbmZpZy5cbiAgICAgIHJldHVybiB7fTtcbiAgICB9IGVsc2Uge1xuICAgICAgZ3JhcGhRTENvbmZpZyA9IHJlc3VsdHNbMF1bR3JhcGhRTENvbmZpZ0tleV07XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNNb3VudGVkKSB7XG4gICAgICB0aGlzLl9wdXRDYWNoZWRHcmFwaFFMQ29uZmlnKGdyYXBoUUxDb25maWcpO1xuICAgIH1cblxuICAgIHJldHVybiBncmFwaFFMQ29uZmlnO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlR3JhcGhRTENvbmZpZyhncmFwaFFMQ29uZmlnOiBQYXJzZUdyYXBoUUxDb25maWcpOiBQcm9taXNlPFBhcnNlR3JhcGhRTENvbmZpZz4ge1xuICAgIC8vIHRocm93cyBpZiBpbnZhbGlkXG4gICAgdGhpcy5fdmFsaWRhdGVHcmFwaFFMQ29uZmlnKFxuICAgICAgZ3JhcGhRTENvbmZpZyB8fCByZXF1aXJlZFBhcmFtZXRlcignWW91IG11c3QgcHJvdmlkZSBhIGdyYXBoUUxDb25maWchJylcbiAgICApO1xuXG4gICAgLy8gVHJhbnNmb3JtIGluIGRvdCBub3RhdGlvbiB0byBtYWtlIHN1cmUgaXQgd29ya3NcbiAgICBjb25zdCB1cGRhdGUgPSBPYmplY3Qua2V5cyhncmFwaFFMQ29uZmlnKS5yZWR1Y2UoXG4gICAgICAoYWNjLCBrZXkpID0+IHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBbR3JhcGhRTENvbmZpZ0tleV06IHtcbiAgICAgICAgICAgIC4uLmFjY1tHcmFwaFFMQ29uZmlnS2V5XSxcbiAgICAgICAgICAgIFtrZXldOiBncmFwaFFMQ29uZmlnW2tleV0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICAgIH0sXG4gICAgICB7IFtHcmFwaFFMQ29uZmlnS2V5XToge30gfVxuICAgICk7XG5cbiAgICBhd2FpdCB0aGlzLmRhdGFiYXNlQ29udHJvbGxlci51cGRhdGUoXG4gICAgICBHcmFwaFFMQ29uZmlnQ2xhc3NOYW1lLFxuICAgICAgeyBvYmplY3RJZDogR3JhcGhRTENvbmZpZ0lkIH0sXG4gICAgICB1cGRhdGUsXG4gICAgICB7IHVwc2VydDogdHJ1ZSB9XG4gICAgKTtcblxuICAgIGlmICh0aGlzLmlzTW91bnRlZCkge1xuICAgICAgdGhpcy5fcHV0Q2FjaGVkR3JhcGhRTENvbmZpZyhncmFwaFFMQ29uZmlnKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyByZXNwb25zZTogeyByZXN1bHQ6IHRydWUgfSB9O1xuICB9XG5cbiAgX2dldENhY2hlZEdyYXBoUUxDb25maWcoKSB7XG4gICAgcmV0dXJuIHRoaXMuY2FjaGVDb250cm9sbGVyLmdyYXBoUUwuZ2V0KHRoaXMuY29uZmlnQ2FjaGVLZXkpO1xuICB9XG5cbiAgX3B1dENhY2hlZEdyYXBoUUxDb25maWcoZ3JhcGhRTENvbmZpZzogUGFyc2VHcmFwaFFMQ29uZmlnKSB7XG4gICAgcmV0dXJuIHRoaXMuY2FjaGVDb250cm9sbGVyLmdyYXBoUUwucHV0KHRoaXMuY29uZmlnQ2FjaGVLZXksIGdyYXBoUUxDb25maWcsIDYwMDAwKTtcbiAgfVxuXG4gIF92YWxpZGF0ZUdyYXBoUUxDb25maWcoZ3JhcGhRTENvbmZpZzogP1BhcnNlR3JhcGhRTENvbmZpZyk6IHZvaWQge1xuICAgIGNvbnN0IGVycm9yTWVzc2FnZXM6IHN0cmluZyA9IFtdO1xuICAgIGlmICghZ3JhcGhRTENvbmZpZykge1xuICAgICAgZXJyb3JNZXNzYWdlcy5wdXNoKCdjYW5ub3QgYmUgdW5kZWZpbmVkLCBudWxsIG9yIGVtcHR5Jyk7XG4gICAgfSBlbHNlIGlmICghaXNWYWxpZFNpbXBsZU9iamVjdChncmFwaFFMQ29uZmlnKSkge1xuICAgICAgZXJyb3JNZXNzYWdlcy5wdXNoKCdtdXN0IGJlIGEgdmFsaWQgb2JqZWN0Jyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHtcbiAgICAgICAgZW5hYmxlZEZvckNsYXNzZXMgPSBudWxsLFxuICAgICAgICBkaXNhYmxlZEZvckNsYXNzZXMgPSBudWxsLFxuICAgICAgICBjbGFzc0NvbmZpZ3MgPSBudWxsLFxuICAgICAgICAuLi5pbnZhbGlkS2V5c1xuICAgICAgfSA9IGdyYXBoUUxDb25maWc7XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhpbnZhbGlkS2V5cykubGVuZ3RoKSB7XG4gICAgICAgIGVycm9yTWVzc2FnZXMucHVzaChgZW5jb3VudGVyZWQgaW52YWxpZCBrZXlzOiBbJHtPYmplY3Qua2V5cyhpbnZhbGlkS2V5cyl9XWApO1xuICAgICAgfVxuICAgICAgaWYgKGVuYWJsZWRGb3JDbGFzc2VzICE9PSBudWxsICYmICFpc1ZhbGlkU3RyaW5nQXJyYXkoZW5hYmxlZEZvckNsYXNzZXMpKSB7XG4gICAgICAgIGVycm9yTWVzc2FnZXMucHVzaChgXCJlbmFibGVkRm9yQ2xhc3Nlc1wiIGlzIG5vdCBhIHZhbGlkIGFycmF5YCk7XG4gICAgICB9XG4gICAgICBpZiAoZGlzYWJsZWRGb3JDbGFzc2VzICE9PSBudWxsICYmICFpc1ZhbGlkU3RyaW5nQXJyYXkoZGlzYWJsZWRGb3JDbGFzc2VzKSkge1xuICAgICAgICBlcnJvck1lc3NhZ2VzLnB1c2goYFwiZGlzYWJsZWRGb3JDbGFzc2VzXCIgaXMgbm90IGEgdmFsaWQgYXJyYXlgKTtcbiAgICAgIH1cbiAgICAgIGlmIChjbGFzc0NvbmZpZ3MgIT09IG51bGwpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY2xhc3NDb25maWdzKSkge1xuICAgICAgICAgIGNsYXNzQ29uZmlncy5mb3JFYWNoKGNsYXNzQ29uZmlnID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IHRoaXMuX3ZhbGlkYXRlQ2xhc3NDb25maWcoY2xhc3NDb25maWcpO1xuICAgICAgICAgICAgaWYgKGVycm9yTWVzc2FnZSkge1xuICAgICAgICAgICAgICBlcnJvck1lc3NhZ2VzLnB1c2goXG4gICAgICAgICAgICAgICAgYGNsYXNzQ29uZmlnOiR7Y2xhc3NDb25maWcuY2xhc3NOYW1lfSBpcyBpbnZhbGlkIGJlY2F1c2UgJHtlcnJvck1lc3NhZ2V9YFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVycm9yTWVzc2FnZXMucHVzaChgXCJjbGFzc0NvbmZpZ3NcIiBpcyBub3QgYSB2YWxpZCBhcnJheWApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChlcnJvck1lc3NhZ2VzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGdyYXBoUUxDb25maWc6ICR7ZXJyb3JNZXNzYWdlcy5qb2luKCc7ICcpfWApO1xuICAgIH1cbiAgfVxuXG4gIF92YWxpZGF0ZUNsYXNzQ29uZmlnKGNsYXNzQ29uZmlnOiA/UGFyc2VHcmFwaFFMQ2xhc3NDb25maWcpOiBzdHJpbmcgfCB2b2lkIHtcbiAgICBpZiAoIWlzVmFsaWRTaW1wbGVPYmplY3QoY2xhc3NDb25maWcpKSB7XG4gICAgICByZXR1cm4gJ2l0IG11c3QgYmUgYSB2YWxpZCBvYmplY3QnO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCB7IGNsYXNzTmFtZSwgdHlwZSA9IG51bGwsIHF1ZXJ5ID0gbnVsbCwgbXV0YXRpb24gPSBudWxsLCAuLi5pbnZhbGlkS2V5cyB9ID0gY2xhc3NDb25maWc7XG4gICAgICBpZiAoT2JqZWN0LmtleXMoaW52YWxpZEtleXMpLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gYFwiaW52YWxpZEtleXNcIiBbJHtPYmplY3Qua2V5cyhpbnZhbGlkS2V5cyl9XSBzaG91bGQgbm90IGJlIHByZXNlbnRgO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBjbGFzc05hbWUgIT09ICdzdHJpbmcnIHx8ICFjbGFzc05hbWUudHJpbSgpLmxlbmd0aCkge1xuICAgICAgICAvLyBUT0RPIGNvbnNpZGVyIGNoZWNraW5nIGNsYXNzIGV4aXN0cyBpbiBzY2hlbWE/XG4gICAgICAgIHJldHVybiBgXCJjbGFzc05hbWVcIiBtdXN0IGJlIGEgdmFsaWQgc3RyaW5nYDtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlICE9PSBudWxsKSB7XG4gICAgICAgIGlmICghaXNWYWxpZFNpbXBsZU9iamVjdCh0eXBlKSkge1xuICAgICAgICAgIHJldHVybiBgXCJ0eXBlXCIgbXVzdCBiZSBhIHZhbGlkIG9iamVjdGA7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qge1xuICAgICAgICAgIGlucHV0RmllbGRzID0gbnVsbCxcbiAgICAgICAgICBvdXRwdXRGaWVsZHMgPSBudWxsLFxuICAgICAgICAgIGNvbnN0cmFpbnRGaWVsZHMgPSBudWxsLFxuICAgICAgICAgIHNvcnRGaWVsZHMgPSBudWxsLFxuICAgICAgICAgIC4uLmludmFsaWRLZXlzXG4gICAgICAgIH0gPSB0eXBlO1xuICAgICAgICBpZiAoT2JqZWN0LmtleXMoaW52YWxpZEtleXMpLmxlbmd0aCkge1xuICAgICAgICAgIHJldHVybiBgXCJ0eXBlXCIgY29udGFpbnMgaW52YWxpZCBrZXlzLCBbJHtPYmplY3Qua2V5cyhpbnZhbGlkS2V5cyl9XWA7XG4gICAgICAgIH0gZWxzZSBpZiAob3V0cHV0RmllbGRzICE9PSBudWxsICYmICFpc1ZhbGlkU3RyaW5nQXJyYXkob3V0cHV0RmllbGRzKSkge1xuICAgICAgICAgIHJldHVybiBgXCJvdXRwdXRGaWVsZHNcIiBtdXN0IGJlIGEgdmFsaWQgc3RyaW5nIGFycmF5YDtcbiAgICAgICAgfSBlbHNlIGlmIChjb25zdHJhaW50RmllbGRzICE9PSBudWxsICYmICFpc1ZhbGlkU3RyaW5nQXJyYXkoY29uc3RyYWludEZpZWxkcykpIHtcbiAgICAgICAgICByZXR1cm4gYFwiY29uc3RyYWludEZpZWxkc1wiIG11c3QgYmUgYSB2YWxpZCBzdHJpbmcgYXJyYXlgO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzb3J0RmllbGRzICE9PSBudWxsKSB7XG4gICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoc29ydEZpZWxkcykpIHtcbiAgICAgICAgICAgIGxldCBlcnJvck1lc3NhZ2U7XG4gICAgICAgICAgICBzb3J0RmllbGRzLmV2ZXJ5KChzb3J0RmllbGQsIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgIGlmICghaXNWYWxpZFNpbXBsZU9iamVjdChzb3J0RmllbGQpKSB7XG4gICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlID0gYFwic29ydEZpZWxkXCIgYXQgaW5kZXggJHtpbmRleH0gaXMgbm90IGEgdmFsaWQgb2JqZWN0YDtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc3QgeyBmaWVsZCwgYXNjLCBkZXNjLCAuLi5pbnZhbGlkS2V5cyB9ID0gc29ydEZpZWxkO1xuICAgICAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhpbnZhbGlkS2V5cykubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2UgPSBgXCJzb3J0RmllbGRcIiBhdCBpbmRleCAke2luZGV4fSBjb250YWlucyBpbnZhbGlkIGtleXMsIFske09iamVjdC5rZXlzKFxuICAgICAgICAgICAgICAgICAgICBpbnZhbGlkS2V5c1xuICAgICAgICAgICAgICAgICAgKX1dYDtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBmaWVsZCAhPT0gJ3N0cmluZycgfHwgZmllbGQudHJpbSgpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2UgPSBgXCJzb3J0RmllbGRcIiBhdCBpbmRleCAke2luZGV4fSBkaWQgbm90IHByb3ZpZGUgdGhlIFwiZmllbGRcIiBhcyBhIHN0cmluZ2A7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGFzYyAhPT0gJ2Jvb2xlYW4nIHx8IHR5cGVvZiBkZXNjICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlID0gYFwic29ydEZpZWxkXCIgYXQgaW5kZXggJHtpbmRleH0gZGlkIG5vdCBwcm92aWRlIFwiYXNjXCIgb3IgXCJkZXNjXCIgYXMgYm9vbGVhbnNgO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAoZXJyb3JNZXNzYWdlKSB7XG4gICAgICAgICAgICAgIHJldHVybiBlcnJvck1lc3NhZ2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBgXCJzb3J0RmllbGRzXCIgbXVzdCBiZSBhIHZhbGlkIGFycmF5LmA7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChpbnB1dEZpZWxkcyAhPT0gbnVsbCkge1xuICAgICAgICAgIGlmIChpc1ZhbGlkU2ltcGxlT2JqZWN0KGlucHV0RmllbGRzKSkge1xuICAgICAgICAgICAgY29uc3QgeyBjcmVhdGUgPSBudWxsLCB1cGRhdGUgPSBudWxsLCAuLi5pbnZhbGlkS2V5cyB9ID0gaW5wdXRGaWVsZHM7XG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMoaW52YWxpZEtleXMpLmxlbmd0aCkge1xuICAgICAgICAgICAgICByZXR1cm4gYFwiaW5wdXRGaWVsZHNcIiBjb250YWlucyBpbnZhbGlkIGtleXM6IFske09iamVjdC5rZXlzKGludmFsaWRLZXlzKX1dYDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGlmICh1cGRhdGUgIT09IG51bGwgJiYgIWlzVmFsaWRTdHJpbmdBcnJheSh1cGRhdGUpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBcImlucHV0RmllbGRzLnVwZGF0ZVwiIG11c3QgYmUgYSB2YWxpZCBzdHJpbmcgYXJyYXlgO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNyZWF0ZSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGlmICghaXNWYWxpZFN0cmluZ0FycmF5KGNyZWF0ZSkpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBgXCJpbnB1dEZpZWxkcy5jcmVhdGVcIiBtdXN0IGJlIGEgdmFsaWQgc3RyaW5nIGFycmF5YDtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgICAgICAgICAgICAgICAgaWYgKCFjcmVhdGUuaW5jbHVkZXMoJ3VzZXJuYW1lJykgfHwgIWNyZWF0ZS5pbmNsdWRlcygncGFzc3dvcmQnKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYFwiaW5wdXRGaWVsZHMuY3JlYXRlXCIgbXVzdCBpbmNsdWRlIHJlcXVpcmVkIGZpZWxkcywgdXNlcm5hbWUgYW5kIHBhc3N3b3JkYDtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGBcImlucHV0RmllbGRzXCIgbXVzdCBiZSBhIHZhbGlkIG9iamVjdGA7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocXVlcnkgIT09IG51bGwpIHtcbiAgICAgICAgaWYgKGlzVmFsaWRTaW1wbGVPYmplY3QocXVlcnkpKSB7XG4gICAgICAgICAgY29uc3Qge1xuICAgICAgICAgICAgZmluZCA9IG51bGwsXG4gICAgICAgICAgICBnZXQgPSBudWxsLFxuICAgICAgICAgICAgZmluZEFsaWFzID0gbnVsbCxcbiAgICAgICAgICAgIGdldEFsaWFzID0gbnVsbCxcbiAgICAgICAgICAgIC4uLmludmFsaWRLZXlzXG4gICAgICAgICAgfSA9IHF1ZXJ5O1xuICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhpbnZhbGlkS2V5cykubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm4gYFwicXVlcnlcIiBjb250YWlucyBpbnZhbGlkIGtleXMsIFske09iamVjdC5rZXlzKGludmFsaWRLZXlzKX1dYDtcbiAgICAgICAgICB9IGVsc2UgaWYgKGZpbmQgIT09IG51bGwgJiYgdHlwZW9mIGZpbmQgIT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgcmV0dXJuIGBcInF1ZXJ5LmZpbmRcIiBtdXN0IGJlIGEgYm9vbGVhbmA7XG4gICAgICAgICAgfSBlbHNlIGlmIChnZXQgIT09IG51bGwgJiYgdHlwZW9mIGdldCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICByZXR1cm4gYFwicXVlcnkuZ2V0XCIgbXVzdCBiZSBhIGJvb2xlYW5gO1xuICAgICAgICAgIH0gZWxzZSBpZiAoZmluZEFsaWFzICE9PSBudWxsICYmIHR5cGVvZiBmaW5kQWxpYXMgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4gYFwicXVlcnkuZmluZEFsaWFzXCIgbXVzdCBiZSBhIHN0cmluZ2A7XG4gICAgICAgICAgfSBlbHNlIGlmIChnZXRBbGlhcyAhPT0gbnVsbCAmJiB0eXBlb2YgZ2V0QWxpYXMgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4gYFwicXVlcnkuZ2V0QWxpYXNcIiBtdXN0IGJlIGEgc3RyaW5nYDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIGBcInF1ZXJ5XCIgbXVzdCBiZSBhIHZhbGlkIG9iamVjdGA7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChtdXRhdGlvbiAhPT0gbnVsbCkge1xuICAgICAgICBpZiAoaXNWYWxpZFNpbXBsZU9iamVjdChtdXRhdGlvbikpIHtcbiAgICAgICAgICBjb25zdCB7XG4gICAgICAgICAgICBjcmVhdGUgPSBudWxsLFxuICAgICAgICAgICAgdXBkYXRlID0gbnVsbCxcbiAgICAgICAgICAgIGRlc3Ryb3kgPSBudWxsLFxuICAgICAgICAgICAgY3JlYXRlQWxpYXMgPSBudWxsLFxuICAgICAgICAgICAgdXBkYXRlQWxpYXMgPSBudWxsLFxuICAgICAgICAgICAgZGVzdHJveUFsaWFzID0gbnVsbCxcbiAgICAgICAgICAgIC4uLmludmFsaWRLZXlzXG4gICAgICAgICAgfSA9IG11dGF0aW9uO1xuICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhpbnZhbGlkS2V5cykubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm4gYFwibXV0YXRpb25cIiBjb250YWlucyBpbnZhbGlkIGtleXMsIFske09iamVjdC5rZXlzKGludmFsaWRLZXlzKX1dYDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGNyZWF0ZSAhPT0gbnVsbCAmJiB0eXBlb2YgY3JlYXRlICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIHJldHVybiBgXCJtdXRhdGlvbi5jcmVhdGVcIiBtdXN0IGJlIGEgYm9vbGVhbmA7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh1cGRhdGUgIT09IG51bGwgJiYgdHlwZW9mIHVwZGF0ZSAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICByZXR1cm4gYFwibXV0YXRpb24udXBkYXRlXCIgbXVzdCBiZSBhIGJvb2xlYW5gO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZGVzdHJveSAhPT0gbnVsbCAmJiB0eXBlb2YgZGVzdHJveSAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICByZXR1cm4gYFwibXV0YXRpb24uZGVzdHJveVwiIG11c3QgYmUgYSBib29sZWFuYDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGNyZWF0ZUFsaWFzICE9PSBudWxsICYmIHR5cGVvZiBjcmVhdGVBbGlhcyAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiBgXCJtdXRhdGlvbi5jcmVhdGVBbGlhc1wiIG11c3QgYmUgYSBzdHJpbmdgO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodXBkYXRlQWxpYXMgIT09IG51bGwgJiYgdHlwZW9mIHVwZGF0ZUFsaWFzICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIGBcIm11dGF0aW9uLnVwZGF0ZUFsaWFzXCIgbXVzdCBiZSBhIHN0cmluZ2A7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChkZXN0cm95QWxpYXMgIT09IG51bGwgJiYgdHlwZW9mIGRlc3Ryb3lBbGlhcyAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiBgXCJtdXRhdGlvbi5kZXN0cm95QWxpYXNcIiBtdXN0IGJlIGEgc3RyaW5nYDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIGBcIm11dGF0aW9uXCIgbXVzdCBiZSBhIHZhbGlkIG9iamVjdGA7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuY29uc3QgaXNWYWxpZFN0cmluZ0FycmF5ID0gZnVuY3Rpb24gKGFycmF5KTogYm9vbGVhbiB7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGFycmF5KVxuICAgID8gIWFycmF5LnNvbWUocyA9PiB0eXBlb2YgcyAhPT0gJ3N0cmluZycgfHwgcy50cmltKCkubGVuZ3RoIDwgMSlcbiAgICA6IGZhbHNlO1xufTtcbi8qKlxuICogRW5zdXJlcyB0aGUgb2JqIGlzIGEgc2ltcGxlIEpTT04ve31cbiAqIG9iamVjdCwgaS5lLiBub3QgYW4gYXJyYXksIG51bGwsIGRhdGVcbiAqIGV0Yy5cbiAqL1xuY29uc3QgaXNWYWxpZFNpbXBsZU9iamVjdCA9IGZ1bmN0aW9uIChvYmopOiBib29sZWFuIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyAmJlxuICAgICFBcnJheS5pc0FycmF5KG9iaikgJiZcbiAgICBvYmogIT09IG51bGwgJiZcbiAgICBVdGlscy5pc0RhdGUob2JqKSAhPT0gdHJ1ZSAmJlxuICAgIFV0aWxzLmlzUHJvbWlzZShvYmopICE9PSB0cnVlXG4gICk7XG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNlR3JhcGhRTENvbmZpZyB7XG4gIGVuYWJsZWRGb3JDbGFzc2VzPzogc3RyaW5nW107XG4gIGRpc2FibGVkRm9yQ2xhc3Nlcz86IHN0cmluZ1tdO1xuICBjbGFzc0NvbmZpZ3M/OiBQYXJzZUdyYXBoUUxDbGFzc0NvbmZpZ1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNlR3JhcGhRTENsYXNzQ29uZmlnIHtcbiAgY2xhc3NOYW1lOiBzdHJpbmc7XG4gIC8qIFRoZSBgdHlwZWAgb2JqZWN0IGNvbnRhaW5zIG9wdGlvbnMgZm9yIGhvdyB0aGUgY2xhc3MgdHlwZXMgYXJlIGdlbmVyYXRlZCAqL1xuICB0eXBlOiA/e1xuICAgIC8qIEZpZWxkcyB0aGF0IGFyZSBhbGxvd2VkIHdoZW4gY3JlYXRpbmcgb3IgdXBkYXRpbmcgYW4gb2JqZWN0LiAqL1xuICAgIGlucHV0RmllbGRzOiA/e1xuICAgICAgLyogTGVhdmUgYmxhbmsgdG8gYWxsb3cgYWxsIGF2YWlsYWJsZSBmaWVsZHMgaW4gdGhlIHNjaGVtYS4gKi9cbiAgICAgIGNyZWF0ZT86IHN0cmluZ1tdLFxuICAgICAgdXBkYXRlPzogc3RyaW5nW10sXG4gICAgfSxcbiAgICAvKiBGaWVsZHMgb24gdGhlIGVkZ2VzIHRoYXQgY2FuIGJlIHJlc29sdmVkIGZyb20gYSBxdWVyeSwgaS5lLiB0aGUgUmVzdWx0IFR5cGUuICovXG4gICAgb3V0cHV0RmllbGRzOiA/KHN0cmluZ1tdKSxcbiAgICAvKiBGaWVsZHMgYnkgd2hpY2ggYSBxdWVyeSBjYW4gYmUgZmlsdGVyZWQsIGkuZS4gdGhlIGB3aGVyZWAgb2JqZWN0LiAqL1xuICAgIGNvbnN0cmFpbnRGaWVsZHM6ID8oc3RyaW5nW10pLFxuICAgIC8qIEZpZWxkcyBieSB3aGljaCBhIHF1ZXJ5IGNhbiBiZSBzb3J0ZWQ7ICovXG4gICAgc29ydEZpZWxkczogPyh7XG4gICAgICBmaWVsZDogc3RyaW5nLFxuICAgICAgYXNjOiBib29sZWFuLFxuICAgICAgZGVzYzogYm9vbGVhbixcbiAgICB9W10pLFxuICB9O1xuICAvKiBUaGUgYHF1ZXJ5YCBvYmplY3QgY29udGFpbnMgb3B0aW9ucyBmb3Igd2hpY2ggY2xhc3MgcXVlcmllcyBhcmUgZ2VuZXJhdGVkICovXG4gIHF1ZXJ5OiA/e1xuICAgIGdldDogP2Jvb2xlYW4sXG4gICAgZmluZDogP2Jvb2xlYW4sXG4gICAgZmluZEFsaWFzOiA/U3RyaW5nLFxuICAgIGdldEFsaWFzOiA/U3RyaW5nLFxuICB9O1xuICAvKiBUaGUgYG11dGF0aW9uYCBvYmplY3QgY29udGFpbnMgb3B0aW9ucyBmb3Igd2hpY2ggY2xhc3MgbXV0YXRpb25zIGFyZSBnZW5lcmF0ZWQgKi9cbiAgbXV0YXRpb246ID97XG4gICAgY3JlYXRlOiA/Ym9vbGVhbixcbiAgICB1cGRhdGU6ID9ib29sZWFuLFxuICAgIC8vIGRlbGV0ZSBpcyBhIHJlc2VydmVkIGtleSB3b3JkIGluIGpzXG4gICAgZGVzdHJveTogP2Jvb2xlYW4sXG4gICAgY3JlYXRlQWxpYXM6ID9TdHJpbmcsXG4gICAgdXBkYXRlQWxpYXM6ID9TdHJpbmcsXG4gICAgZGVzdHJveUFsaWFzOiA/U3RyaW5nLFxuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBQYXJzZUdyYXBoUUxDb250cm9sbGVyO1xuZXhwb3J0IHsgR3JhcGhRTENvbmZpZ0NsYXNzTmFtZSwgR3JhcGhRTENvbmZpZ0lkLCBHcmFwaFFMQ29uZmlnS2V5IH07XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLElBQUFBLGtCQUFBLEdBQUFDLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxNQUFBLEdBQUFGLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBRSxtQkFBQSxHQUFBSCxzQkFB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