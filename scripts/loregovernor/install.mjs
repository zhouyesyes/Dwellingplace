#!/usr/bin/env node
// 只安装 #337 的视觉补丁；不安装软件、不改酒馆数据或原作者许可证。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const marker = '.qisuo-native-panel.json';
const expected = {
    'LICENSE': 'f4983f9b35bdcf560880dd2ad91d3a87221cd0c7e60c55244916f67de35dc3f4',
    'README.md': 'a7e19b7c2ac1df081e67c3619f6954dcb711a5f23444ebcca6f3f3b9f13e60bc',
    'index.js': '5493fab9fd9d3b6266a3c5ce6f4e8bb226a7ee8585f8ac8b3091ce26d62a0b42',
    'manifest.json': '2e6c00117f5e58cae9d4cc3e80280c165089f98c8470d7a49dd085524d498580',
    'style.css': 'f1b1c2a8c3926e1e904d82985ac4ba6c451bd54d47ca0d17ce56648de8b765eb',
};
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function check(ok, message) { if (!ok) throw Error(message); }
function run(args, cwd) { execFileSync('git', args, { cwd, stdio: 'pipe' }); }

// 跳过虚拟文件系统和 Docker 的容器镜像层，仍搜索宿主目录和命名卷。
function discover(root) {
    const found = [];
    const skip = new Set(['.git', 'node_modules', '.cache', '.Trash']);
    function walk(dir) {
        if (['/proc', '/sys', '/dev', '/run', '/var/lib/docker/overlay2', '/var/lib/docker/buildkit', '/var/lib/containerd'].includes(dir)) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch (error) { if (['EACCES', 'EPERM', 'ENOENT'].includes(error.code)) return; throw error; }
        if (entries.some(e => e.name === 'manifest.json' && e.isFile())) {
            try {
                const m = read(path.join(dir, 'manifest.json'));
                if (m.display_name === 'Lore Governor' || /LoreGovernor/i.test(m.homePage || '')) {
                    found.push(dir);
                    return;
                }
            } catch { /* 其他软件的 manifest 不属于目标。 */ }
        }
        for (const entry of entries) {
            if (entry.isDirectory() && !skip.has(entry.name) && !entry.name.startsWith('.qisuo-lg-')) walk(path.join(dir, entry.name));
        }
    }
    walk(root);
    check(found.length === 1, `找到 ${found.length} 份 LoreGovernor，已停止且未修改。${found.length ? '\n' + found.join('\n') : '请确认扩展已安装，且在宿主服务器运行。'}`);
    return found[0];
}

// 为完整目录记录内容、权限和链接；不跟随链接，也不漏掉隐藏文件和 .git。
function inventory(root) {
    const result = [];
    function walk(rel) {
        const file = path.join(root, rel), s = fs.lstatSync(file);
        check(s.isFile() || s.isDirectory(), `目录含链接或特殊文件，无法安全复制，停止：${file}`);
        result.push([rel, s.mode, s.uid, s.gid, s.isFile() ? hash(fs.readFileSync(file)) : s.isSymbolicLink() ? fs.readlinkSync(file) : null]);
        if (s.isDirectory()) for (const n of fs.readdirSync(file).sort()) walk(path.join(rel, n));
    }
    walk('');
    return result;
}
function copyTree(source, target) {
    fs.cpSync(source, target, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    // sudo 执行时保留原文件属主，不把整个扩展变成 root 所有。
    function owners(rel) {
        const src = path.join(source, rel), dst = path.join(target, rel), s = fs.lstatSync(src);
        const d = fs.lstatSync(dst);
        if (s.uid !== d.uid || s.gid !== d.gid) fs.lchownSync(dst, s.uid, s.gid);
        if (!s.isSymbolicLink()) fs.chmodSync(dst, s.mode & 0o7777);
        if (s.isDirectory()) for (const n of fs.readdirSync(src)) owners(path.join(rel, n));
    }
    owners('');
}

async function main() {
    const [action = 'install', ...args] = process.argv.slice(2);
    check(['install', 'rollback'].includes(action), '用法：node install.mjs install|rollback [--root 搜索目录]');
    check(args.length === 0 || (args.length === 2 && args[0] === '--root'), '参数不正确');
    const target = discover(path.resolve(args[1] || '/'));
    const parent = path.dirname(target);
    const lock = path.join(parent, '.qisuo-lg-lock');
    fs.mkdirSync(lock); // 同目录互斥；遇到上次意外中断留下的锁时停止，不猜测恢复。
    let work;
    try {
        console.log(`已定位扩展：${target}`);
        const before = inventory(target);
        let backup, stage;
        work = fs.mkdtempSync(path.join(parent, '.qisuo-lg-stage-'));
        stage = path.join(work, 'extension');
        if (action === 'rollback') {
            const state = read(path.join(target, marker));
            backup = state.backup;
            check(path.dirname(backup) === parent && path.basename(backup).startsWith('.qisuo-lg-backup-'), '备份路径不兼容');
            const meta = read(path.join(backup, 'backup.json'));
            check(meta.target === target, '备份与扩展目录不匹配');
            const original = path.join(backup, 'original');
            check(JSON.stringify(inventory(original)) === JSON.stringify(meta.inventory), '备份完整性检查失败，未修改');
            copyTree(original, stage);
            check(JSON.stringify(inventory(stage)) === JSON.stringify(meta.inventory), '回退副本校验失败');
        } else {
            if (fs.existsSync(path.join(target, marker))) {
                console.log('已经安装过；不重复打补丁。需要撤销时运行 rollback。');
                return;
            }
            for (const [name, digest] of Object.entries(expected)) {
                const file = path.join(target, name);
                check(fs.lstatSync(file).isFile() && hash(fs.readFileSync(file)) === digest, `版本不兼容：${name} 与已验证基线 fea3fd7 不同，未修改。`);
            }
            check(!fs.existsSync(path.join(target, 'native-panel.mjs')) && !fs.existsSync(path.join(target, 'tests/native-panel.test.mjs')), '存在同名补丁文件，停止');
            const response = await fetch('https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/ea749e85bd1dd6b77780d9558a0e27ec1e82f05a/docs/patches/LoreGovernor-native-panel.patch', { signal: AbortSignal.timeout(60000) });
            check(response.ok, `下载补丁失败：${response.status}`);
            const patch = Buffer.from(await response.arrayBuffer());
            check(hash(patch) === 'f74f76e737b8f39586c59f706a5ca49c8decf9e85d66ba08d2e6244044c3b574', '补丁校验失败');
            const patchFile = path.join(work, 'visual.patch');
            fs.writeFileSync(patchFile, patch);
            copyTree(target, stage);
            check(JSON.stringify(inventory(stage)) === JSON.stringify(before), '复制期间目录变化，停止');
            // 隔离 Git 上级仓库和用户配置；只在临时副本里应用。
            const gitDir = path.join(stage, '.git');
            if (fs.existsSync(gitDir)) fs.renameSync(gitDir, path.join(work, 'saved-git'));
            run(['init', '-q'], stage);
            run(['apply', '--check', patchFile], stage);
            run(['apply', patchFile], stage);
            fs.rmSync(gitDir, { recursive: true, force: true });
            if (fs.existsSync(path.join(work, 'saved-git'))) fs.renameSync(path.join(work, 'saved-git'), gitDir);
            execFileSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(path.join(stage, 'index.js')) });
            execFileSync(process.execPath, ['--test', 'tests/native-panel.test.mjs'], { cwd: stage, stdio: 'pipe' });
            check(hash(fs.readFileSync(path.join(stage, 'LICENSE'))) === expected.LICENSE, '许可证检查失败');
            backup = path.join(parent, '.qisuo-lg-backup-' + stamp());
            fs.writeFileSync(path.join(stage, marker), JSON.stringify({ backup }, null, 2) + '\n');
            for (const name of Object.keys(expected)) {
                const source = fs.statSync(path.join(target, name)), file = path.join(stage, name), dest = fs.statSync(file);
                if (source.uid !== dest.uid || source.gid !== dest.gid) fs.chownSync(file, source.uid, source.gid);
                fs.chmodSync(file, source.mode & 0o7777);
            }
            const owner = fs.statSync(target);
            for (const name of [marker, 'native-panel.mjs', 'tests/native-panel.test.mjs', 'tests']) {
                const file = path.join(stage, name), s = fs.lstatSync(file);
                if (s.uid !== owner.uid || s.gid !== owner.gid) fs.lchownSync(file, owner.uid, owner.gid);
            }
        }
        check(JSON.stringify(inventory(target)) === JSON.stringify(before), '安装前目录又发生变化，停止；请暂停扩展更新后重试');
        // 先完整保留原目录，再切入已验证的副本；切换失败立刻放回原目录。
        if (action === 'install') {
            fs.mkdirSync(backup, { mode: 0o700 });
            fs.writeFileSync(path.join(backup, 'backup.json'), JSON.stringify({ target, inventory: before }));
        }
        const saved = path.join(backup, action === 'install' ? 'original' : 'rollback-before-' + stamp());
        fs.renameSync(target, saved);
        try { fs.renameSync(stage, target); }
        catch (error) { fs.renameSync(saved, target); throw error; }
        console.log(action === 'install' ? `安装完成，完整备份：${backup}\n刷新酒馆页面；测试期间不要更新扩展。` : `已完整回退，回退前目录保留在：${saved}\n请刷新酒馆页面。`);
    } finally {
        if (work) fs.rmSync(work, { recursive: true, force: true });
        fs.rmdirSync(lock);
    }
}
main().catch(error => { console.error('停止：' + error.message); process.exitCode = 1; });
