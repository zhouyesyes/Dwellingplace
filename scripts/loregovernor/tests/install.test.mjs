// 用真实基线副本验证安装、完整回退和失败时不改目录；不接触真实扩展。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-installer-test-'));
const installer = path.resolve('scripts/loregovernor/install.mjs');
function run(action, success = true) {
    const r = spawnSync(process.execPath, [installer, action, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status === 0, success, r.stdout + r.stderr);
    return r.stdout + r.stderr;
}
function snapshot(dir) {
    return fs.readdirSync(dir).sort().map(name => {
        const file = path.join(dir, name), s = fs.lstatSync(file);
        return [name, s.mode, s.isDirectory() ? snapshot(file) : fs.readFileSync(file).toString('base64')];
    });
}
try {
    const base = path.join(root, 'source');
    execFileSync('git', ['clone', '-q', 'https://github.com/zhouyesyes/LoreGovernor', base]);
    execFileSync('git', ['checkout', '-q', 'fea3fd70303b9a7a971eef9e96b391a7d0d2a722'], { cwd: base });
    const target = path.join(root, 'Silly Tavern/public/scripts/extensions/third-party/LoreGovernor');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(base, target);
    fs.writeFileSync(path.join(target, '.local-note'), '保留隐藏文件');
    const before = snapshot(target);
    const index = path.join(target, 'index.js');
    fs.appendFileSync(index, '\n// 不兼容的本地修改\n');
    const incompatible = snapshot(target);
    assert.match(run('install', false), /不兼容/);
    assert.deepEqual(snapshot(target), incompatible);
    fs.writeFileSync(index, Buffer.from(before.find(x => x[0] === 'index.js')[2], 'base64'));
    const second = path.join(root, 'another');
    fs.cpSync(target, second, { recursive: true });
    assert.match(run('install', false), /找到 2 份/);
    assert.deepEqual(snapshot(target), before);
    fs.rmSync(second, { recursive: true });
    assert.match(run('install'), /安装完成/);
    const installed = snapshot(target);
    assert.match(run('install'), /已经安装过/);
    assert.deepEqual(snapshot(target), installed);
    const state = JSON.parse(fs.readFileSync(path.join(target, '.qisuo-native-panel.json')));
    const original = path.join(state.backup, 'original');
    assert.deepEqual(snapshot(original), before);
    fs.appendFileSync(path.join(original, '.local-note'), '篡改');
    assert.match(run('rollback', false), /完整性检查失败/);
    assert.deepEqual(snapshot(target), installed);
    fs.writeFileSync(path.join(original, '.local-note'), '保留隐藏文件');
    fs.writeFileSync(path.join(target, 'after-install.txt'), '安装后新增也应完整撤回');
    assert.match(run('rollback'), /已完整回退/);
    assert.deepEqual(snapshot(target), before);
    console.log('通过：不兼容、多目录、安装、重复运行、备份完整性、完整回退（含 .git 与隐藏文件）');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
