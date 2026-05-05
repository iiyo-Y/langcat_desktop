#!/usr/bin/env node
/**
 * 一键发版脚本
 *
 *   pnpm release patch    # 0.1.0 → 0.1.1
 *   pnpm release minor    # 0.1.1 → 0.2.0
 *   pnpm release major    # 0.2.0 → 1.0.0
 *
 * 做的事:
 *   1. 校验工作区干净(规则 4:状态不对就立刻报错)
 *   2. 读 package.json 当前版本,按 semver bump
 *   3. 写回 package.json
 *   4. git commit "release: vX.Y.Z" + git tag vX.Y.Z
 *   5. 提示用户 git push --follow-tags 触发 CI(不擅自 push,push 是不可逆动作)
 *
 * 不做的事:
 *   - 不 push(用户自己来)
 *   - 不直接调 electron-builder(留给 CI 三平台并行)
 *   - 不写 changelog(规则 4:不假装我们有,留给用户决定)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_PATH = path.resolve(__dirname, '..', 'package.json');

const KIND = process.argv[2];
if (KIND !== 'patch' && KIND !== 'minor' && KIND !== 'major') {
  console.error('用法: pnpm release <patch|minor|major>');
  process.exit(1);
}

function sh(cmd, opts) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

// 1. 工作区必须干净
let status;
try {
  status = sh('git status --porcelain');
} catch (e) {
  console.error('❌ 当前目录不是 git 仓库,先 `git init` + `git remote add origin ...`');
  process.exit(1);
}
if (status.length > 0) {
  console.error('❌ 工作区有未提交改动,先 commit 或 stash:');
  console.error(status);
  process.exit(1);
}

// 2. 读当前版本
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
const current = pkg.version;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!m) {
  console.error(`❌ package.json version 不是合法 semver: ${current}`);
  process.exit(1);
}
let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
if (KIND === 'major') {
  maj += 1;
  min = 0;
  pat = 0;
} else if (KIND === 'minor') {
  min += 1;
  pat = 0;
} else {
  pat += 1;
}
const next = `${maj}.${min}.${pat}`;

console.log(`📦 ${current} → ${next}`);

// 3. 写回
pkg.version = next;
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

// 4. commit + tag
sh(`git add package.json`);
sh(`git commit -m "release: v${next}"`);
sh(`git tag -a v${next} -m "v${next}"`);

console.log(`✅ 已 commit + tag v${next}`);
console.log(``);
console.log(`下一步(触发三平台 CI 打包并自动发布):`);
console.log(`  git push --follow-tags`);
console.log(``);
console.log(`CI 完成后,GitHub Releases 上会出现 v${next},`);
console.log(`已安装的客户端下次启动会自动检测并下载更新。`);
