const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { FILES } = require('./package.cjs');
const root = path.resolve(__dirname, '..');
function check(value, message) { if (!value) throw Error(message); }
for (const file of FILES) {
  const full = path.join(root, 'extension', file);
  check(fs.existsSync(full), `Missing distribution resource: ${file}`);
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', full]);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
check(manifest.manifest_version === 3, 'Manifest V3 required');
check(JSON.stringify(manifest.permissions) === '["storage","alarms"]', 'Unexpected permissions');
for (const entry of [manifest.background.service_worker, manifest.options_page, manifest.action.default_popup, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(c => c.js), ...manifest.web_accessible_resources.flatMap(c => c.resources)]) check(FILES.includes(entry), `Unpackaged resource: ${entry}`);
for (const page of ['options.html', 'popup.html']) {
  const html = fs.readFileSync(path.join(root, 'extension', page), 'utf8');
  check(/<meta charset="utf-8"/i.test(html), `UTF-8 required: ${page}`);
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const link = match[1]; if (/^https:\/\//.test(link)) continue;
    check(FILES.includes(link), `Missing HTML resource ${page}: ${link}`);
  }
}
// oauth-provider.js is pinned to this project's modified copy (see THIRD_PARTY_NOTICES.md); key-store.js is unchanged upstream.
for (const [file, expected] of [['vendor/oauth-provider.js', 'ae1e99279bca5bd873be85c53c7bd24f431483cda193a02895e19cb03ef6924b'], ['vendor/key-store.js', 'eea24431e3855accd1c92d48b81dd0a0d7fc04d20c889fff404b44b4497fb491']]) {
  const content = fs.readFileSync(path.join(root, 'extension', file), 'utf8').replace(/\r\n/g, '\n');
  check(crypto.createHash('sha256').update(content).digest('hex') === expected, `Vendor hash changed: ${file}`);
}
console.log(`Validated Manifest V3, ${FILES.length} resources, JavaScript syntax and pinned vendor hashes.`);
execFileSync(process.execPath, ['--test', 'tests/*.test.js'], { cwd: root, stdio: 'inherit' });
