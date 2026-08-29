const Parse = require('parse/node').Parse;

/**
 * Extract a hostname from a server URL string.
 * Functions (async publicServerURL) and invalid URLs are skipped.
 */
function hostnameFromUrl(url) {
  if (typeof url !== 'string' || url === '') {
    return;
  }
  try {
    const hostname = new URL(url).hostname;
    return hostname ? hostname.toLowerCase() : undefined;
  } catch {
    return;
  }
}

/**
 * Build the default file-URL allowlist from Parse Server's own URLs.
 * Unconfigured allowedFileUrlDomains should trust the server's public host,
 * not every domain on the internet.
 */
function defaultAllowedFileUrlDomains(urls = []) {
  const seen = new Set();
  const hostnames = [];
  for (const url of urls) {
    const hostname = hostnameFromUrl(url);
    if (hostname && !seen.has(hostname)) {
      seen.add(hostname);
      hostnames.push(hostname);
    }
  }
  return hostnames;
}

/**
 * When the allowlist was defaulted (not set by the operator), also include
 * hostnames from the current publicServerURL / serverURL. publicServerURL can
 * be a function resolved later via loadKeys, so the stored array may be stale.
 */
function resolveAllowedFileUrlDomains(config) {
  const domains = config?.fileUpload?.allowedFileUrlDomains;
  if (!Array.isArray(domains) || !config?._allowedFileUrlDomainsIsDefault) {
    return domains;
  }
  const derived = defaultAllowedFileUrlDomains([config.publicServerURL, config.serverURL]);
  if (derived.length === 0) {
    return domains;
  }
  const seen = new Set(domains.map(domain => domain.toLowerCase()));
  const merged = domains.slice();
  for (const hostname of derived) {
    if (!seen.has(hostname)) {
      seen.add(hostname);
      merged.push(hostname);
    }
  }
  return merged;
}

/**
 * Validates whether a File URL is allowed based on the configured allowed domains.
 * @param {string} fileUrl - The URL to validate.
 * @param {Object} config - The Parse Server config object.
 * @throws {Parse.Error} If the URL is not allowed.
 */
function validateFileUrl(fileUrl, config) {
  if (fileUrl == null || fileUrl === '') {
    return;
  }

  const domains = resolveAllowedFileUrlDomains(config);
  if (!Array.isArray(domains) || domains.includes('*')) {
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(fileUrl);
  } catch {
    throw new Parse.Error(Parse.Error.FILE_SAVE_ERROR, `Invalid file URL.`);
  }

  const fileHostname = parsedUrl.hostname.toLowerCase();
  for (const domain of domains) {
    const d = domain.toLowerCase();
    if (fileHostname === d) {
      return;
    }
    if (d.startsWith('*.') && fileHostname.endsWith(d.slice(1))) {
      return;
    }
  }

  throw new Parse.Error(Parse.Error.FILE_SAVE_ERROR, `File URL domain '${parsedUrl.hostname}' is not allowed.`);
}

/**
 * Recursively scans an object for File type fields and validates their URLs.
 * @param {any} obj - The object to scan.
 * @param {Object} config - The Parse Server config object.
 * @throws {Parse.Error} If any File URL is not allowed.
 */
function validateFileUrlsInObject(obj, config) {
  if (obj == null || typeof obj !== 'object') {
    return;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      validateFileUrlsInObject(item, config);
    }
    return;
  }
  if (obj.__type === 'File' && obj.url) {
    validateFileUrl(obj.url, config);
    return;
  }
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value && typeof value === 'object') {
      validateFileUrlsInObject(value, config);
    }
  }
}

module.exports = {
  validateFileUrl,
  validateFileUrlsInObject,
  defaultAllowedFileUrlDomains,
};
