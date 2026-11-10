// Copies the open-source part of this project into the working copy of the public repository
// (github.com/chaozuoye01/xtranslate, by default the folder ../xtranslate next to this one), so it can be
// committed and pushed there:  npm run publish:public [-- <folder>]
// Only committed files are copied. Internal notes stay in this repository: real-account test records
// (VALIDATION.md), the design and implementation notes in docs/, and the store dashboard guide.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PRIVATE = [/^VALIDATION\.md$/, /^docs\/(design|implementation-plan|implementation-record)\.md$/, /^store\/上架填写指南\.md$/];
// Ignored build output in the public copy is left alone.
const SKIP = new Set(['.git', 'node_modules', 'dist', 'test-results', '.superpowers', '.browser-profile']);

function publicFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean).filter(file => !PRIVATE.some(rule => rule.test(file)));
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => SKIP.has(entry.name) ? [] : entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

function publish(target) {
  if (!fs.existsSync(path.join(target, '.git'))) throw new Error(`${target} 不是 git 仓库：先 git clone 公开仓库，或在那里 git init`);
  const files = publicFiles();
  const wanted = new Set(files.map(file => path.join(target, file)));
  let removed = 0;
  for (const file of walk(target)) if (!wanted.has(file)) { fs.rmSync(file); removed++; }
  for (const file of files) {
    const to = path.join(target, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), to);
  }
  console.log(`已复制 ${files.length} 个文件到 ${target}，删除 ${removed} 个已不公开的文件。到那里检查 git status 后提交。`);
}

module.exports = { PRIVATE, publicFiles };
if (require.main === module) publish(path.resolve(process.argv[2] || path.join(ROOT, '..', 'xtranslate')));
