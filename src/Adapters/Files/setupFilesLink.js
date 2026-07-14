'use strict';

const fs = require('fs');
const path = require('path');

/**
 * When filesAdapter.options.filesLinkTarget is set, create a symlink at
 * files/{filesSubDirectory} -> filesLinkTarget before the FS adapter starts.
 * This lets multiple Parse instances use distinct link names under files/
 * without changing @parse/fs-files-adapter.
 *
 * @param {Object} filesAdapter parse-server filesAdapter config (module/class form with options)
 */
export function setupFilesLink(filesAdapter) {
  if (!filesAdapter || typeof filesAdapter !== 'object' || !filesAdapter.options) {
    return;
  }

  const { filesLinkTarget, filesSubDirectory } = filesAdapter.options;
  if (filesLinkTarget === undefined || filesLinkTarget === null || filesLinkTarget === '') {
    return;
  }

  if (!filesSubDirectory) {
    throw new Error(
      'filesAdapter.options.filesSubDirectory is required when filesLinkTarget is set.'
    );
  }

  const targetPath = path.resolve(String(filesLinkTarget));
  const linkPath = path.join('files', filesSubDirectory);
  const linkParent = path.dirname(linkPath);

  fs.mkdirSync(targetPath, { recursive: true });
  fs.mkdirSync(linkParent, { recursive: true });

  let linkStat;
  try {
    linkStat = fs.lstatSync(linkPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      createSymlink(targetPath, linkPath);
      return;
    }
    throw err;
  }

  if (linkStat.isSymbolicLink() || isWindowsJunction(linkPath, linkStat)) {
    const currentTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
    if (pathsEqual(currentTarget, targetPath)) {
      return;
    }
    throw new Error(
      `files link "${linkPath}" already points to "${currentTarget}", expected "${targetPath}".`
    );
  }

  throw new Error(
    `Cannot create files link at "${linkPath}": path already exists and is not a symlink.`
  );
}

function createSymlink(targetPath, linkPath) {
  // junction on Windows avoids elevated privileges required for directory symlinks
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(targetPath, linkPath, type);
}

function isWindowsJunction(linkPath, linkStat) {
  // Directory junctions may not always report as symbolic links; readlink is definitive.
  if (process.platform !== 'win32' || !linkStat.isDirectory()) {
    return false;
  }
  try {
    fs.readlinkSync(linkPath);
    return true;
  } catch {
    return false;
  }
}

function pathsEqual(a, b) {
  if (process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

export default setupFilesLink;
