'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupFilesLink } = require('../lib/Adapters/Files/setupFilesLink');

describe('setupFilesLink', () => {
  const originalCwd = process.cwd();
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-files-link-'));
    process.chdir(tempRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('does nothing when filesLinkTarget is not set', () => {
    setupFilesLink({
      module: '@parse/fs-files-adapter',
      options: { filesSubDirectory: 'parse-file' },
    });
    expect(fs.existsSync(path.join('files', 'parse-file'))).toBe(false);
  });

  it('throws when filesLinkTarget is set without filesSubDirectory', () => {
    expect(() =>
      setupFilesLink({
        options: { filesLinkTarget: path.join(tempRoot, 'storage') },
      })
    ).toThrowError(/filesSubDirectory is required/);
  });

  it('creates files/{filesSubDirectory} symlink to filesLinkTarget', () => {
    const target = path.join(tempRoot, 'real-storage');
    setupFilesLink({
      options: {
        filesSubDirectory: 'parse-file',
        filesLinkTarget: target,
      },
    });

    const linkPath = path.join('files', 'parse-file');
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.lstatSync(linkPath).isSymbolicLink() || fs.lstatSync(linkPath).isDirectory()).toBe(
      true
    );
    expect(path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath))).toBe(
      path.resolve(target)
    );
  });

  it('is idempotent when link already points to the same target', () => {
    const target = path.join(tempRoot, 'real-storage');
    const config = {
      options: {
        filesSubDirectory: 'parse-file',
        filesLinkTarget: target,
      },
    };
    setupFilesLink(config);
    expect(() => setupFilesLink(config)).not.toThrow();
  });

  it('throws when link path exists as a real directory', () => {
    const target = path.join(tempRoot, 'real-storage');
    fs.mkdirSync(path.join('files', 'parse-file'), { recursive: true });

    expect(() =>
      setupFilesLink({
        options: {
          filesSubDirectory: 'parse-file',
          filesLinkTarget: target,
        },
      })
    ).toThrowError(/already exists and is not a symlink/);
  });

  it('throws when existing symlink points to a different target', () => {
    const targetA = path.join(tempRoot, 'storage-a');
    const targetB = path.join(tempRoot, 'storage-b');
    fs.mkdirSync(targetA, { recursive: true });
    fs.mkdirSync(targetB, { recursive: true });
    fs.mkdirSync('files', { recursive: true });
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(targetA, path.join('files', 'parse-file'), type);

    expect(() =>
      setupFilesLink({
        options: {
          filesSubDirectory: 'parse-file',
          filesLinkTarget: targetB,
        },
      })
    ).toThrowError(/already points to/);
  });
});
