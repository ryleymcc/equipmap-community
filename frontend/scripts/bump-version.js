import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.resolve(__dirname, '../package.json');
const pkgLockPath = path.resolve(__dirname, '../package-lock.json');
const rootVersionPath = path.resolve(__dirname, '../../version.json');
const backendVersionPath = path.resolve(__dirname, '../../backend/version.json');

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  let [major, minor, patch] = (pkg.version && pkg.version !== '0.0.0' ? pkg.version : '1.0.0')
    .split('.')
    .map((num) => parseInt(num, 10) || 0);

  // Auto-increment patch
  patch += 1;
  const newVersion = `${major}.${minor}.${patch}`;

  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  if (fs.existsSync(pkgLockPath)) {
    try {
      const pkgLock = JSON.parse(fs.readFileSync(pkgLockPath, 'utf8'));
      pkgLock.version = newVersion;
      if (pkgLock.packages && pkgLock.packages['']) {
        pkgLock.packages[''].version = newVersion;
      }
      fs.writeFileSync(pkgLockPath, JSON.stringify(pkgLock, null, 2) + '\n');
    } catch (e) {
      console.warn('Could not update package-lock.json version:', e.message);
    }
  }

  const versionPayload = JSON.stringify({ version: newVersion, updatedAt: new Date().toISOString() }, null, 2) + '\n';

  const additionalPaths = [
    path.resolve(__dirname, '../public/version.json'),
    rootVersionPath,
    backendVersionPath,
  ];

  for (const targetPath of additionalPaths) {
    try {
      const dir = path.dirname(targetPath);
      if (fs.existsSync(dir)) {
        fs.writeFileSync(targetPath, versionPayload);
      }
    } catch (e) {
      // Non-fatal if parent directories are outside container build context
    }
  }

  console.log(`[version] Auto-incremented to version ${newVersion}`);
} catch (err) {
  console.error('[version] Error auto-incrementing version:', err);
  process.exit(1);
}
