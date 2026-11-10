const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { zipSync } = require('fflate');
const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'manifest.json', 'background.js', 'background-controller.js', 'core.js', 'translation-provider.js',
  'vendor/key-store.js', 'vendor/oauth-provider.js', 'vendor/LICENSE-SuperX.txt',
  'editor-adapter.js', 'content.js', 'panel.css', 'options.html', 'options.js', 'popup.html', 'popup.js', 'ui.css',
  'assets/icon.svg', 'assets/icon-16.png', 'assets/icon-32.png', 'assets/icon-48.png', 'assets/icon-128.png', 'PRIVACY.md', 'INSTALL.txt'
];
function build() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
  const entries = Object.fromEntries(FILES.map(file => [file, [new Uint8Array(fs.readFileSync(path.join(ROOT, 'extension', file))), { mtime: new Date('2026-10-27T00:00:00Z') }]]));
  const zip = zipSync(entries, { level: 9 });
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const name = `grok-input-translator-${manifest.version}.zip`;
  const output = path.join(ROOT, 'dist', name);
  fs.writeFileSync(output, zip);
  const hash = crypto.createHash('sha256').update(zip).digest('hex');
  fs.writeFileSync(output + '.sha256', `${hash}  ${name}\n`);
  console.log(`ZIP: ${output}\nFiles: ${FILES.length}\nSHA-256: ${hash}`);
  return output;
}
module.exports = { FILES, build };
if (require.main === module) build();
