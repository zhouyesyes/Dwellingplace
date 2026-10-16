// 只收取当前任务约定目录里的 PNG；通过原附件接口复制到受保护目录。
import fs from 'node:fs';
import path from 'node:path';
export async function collectPreviews(project, task, collected, upload, publish = () => {}, reportError = error => { throw error; }) {
  if (!/^[\w-]{1,100}$/.test(task)) return [];
  const root = path.join(project, '.qisuo-previews', task);
  if (!fs.existsSync(root) || fs.realpathSync(root) !== root) return [];
  // 逐层打开目录并固定描述符，防止收取期间替换父目录符号链接骗取 root 文件。
  const handles = [];
  const openDir = (parent, name) => {
    const fd = fs.openSync(path.join(parent, name), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    handles.push(fd); return `/proc/self/fd/${fd}`;
  };
  try {
    let anchored = '/';
    for (const part of root.split(path.sep).filter(Boolean)) anchored = openDir(anchored, part);
    const read = (file, max) => {
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const st = fs.fstatSync(fd);
        if (!st.isFile() || st.size > max) throw Error('产物大小或类型不合法');
        const buffer = Buffer.alloc(max + 1);
        let size = 0, count;
        while ((count = fs.readSync(fd, buffer, size, buffer.length - size, null)) > 0) {
          size += count; if (size > max) throw Error('产物超过大小限制');
        }
        return buffer.subarray(0,size);
      } finally { fs.closeSync(fd); }
    };
    const result = [];
    for (const run of fs.readdirSync(anchored).filter(x => /^[a-f0-9-]{36}$/.test(x) && !collected.includes(x)).slice(0,20)) {
      try {
        const dir = openDir(anchored, run);
        if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
        const manifest = JSON.parse(read(path.join(dir, 'manifest.json'), 16384));
        if (manifest.version !== 1 || !Array.isArray(manifest.screenshots) || manifest.screenshots.length > 6) throw Error('产物清单不合法');
        // 先全部校验，避免坏清单触发部分上传。
        const files = manifest.screenshots.map(s => {
          if (!/^(phone|tablet|desktop)-(light|dark)\.png$/.test(s.file) || !/^\/[\w/-]*$/.test(s.route) || !Number.isInteger(s.width) || !Number.isInteger(s.height) || s.width < 1 || s.width > 4096 || s.height < 1 || s.height > 4096 || !['light','dark'].includes(s.theme) || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(s.generatedAt)) throw Error('截图标注不合法');
          const data = read(path.join(dir, s.file), 20 * 1024 * 1024);
          if (!data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) throw Error('截图不是 PNG');
          return { s, data };
        });
        const attachments = [];
        for (const { s,data } of files) attachments.push({ ...await upload(s.file, data), preview: { route:s.route, width:s.width, height:s.height, theme:s.theme, generatedAt:s.generatedAt } });
        await publish(attachments);
        collected.push(run);
        result.push(...attachments);
      } catch (error) { reportError(error); }
    }
    return result;
  } finally { for (const fd of handles.reverse()) fs.closeSync(fd); }
}

// 一般产物：Codex 把做好的图片放进 项目/.qisuo-outputs/<任务编号>/，这一轮结束收取，显示给她看。
// 和上面一样逐层固定目录；只收这一层里的图片，已经收过的（名字 + 大小 + 修改时间）不重复收。
const OUT_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
export async function collectOutputs(project, task, collected, upload) {
  if (!/^[\w-]{1,100}$/.test(task)) return [];
  const root = path.join(project, '.qisuo-outputs', task);
  if (!fs.existsSync(root) || fs.realpathSync(root) !== root) return [];
  const handles = [];
  const openDir = (parent, name) => {
    const fd = fs.openSync(path.join(parent, name), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    handles.push(fd); return `/proc/self/fd/${fd}`;
  };
  try {
    let dir = '/';
    for (const part of root.split(path.sep).filter(Boolean)) dir = openDir(dir, part);
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!OUT_TYPES[ext] || out.length >= 30) continue;
      let fd = null;
      try {
        fd = fs.openSync(path.join(dir, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); // 链接到别处的不收
        const st = fs.fstatSync(fd);
        const key = `${name}:${st.size}:${st.mtimeMs}`;
        if (!st.isFile() || !st.size || st.size > 20 * 1024 * 1024 || collected.includes(key)) continue;
        const data = Buffer.alloc(st.size);
        let size = 0, n;
        while (size < st.size && (n = fs.readSync(fd, data, size, st.size - size, null)) > 0) size += n;
        out.push({ ...await upload(name, data.subarray(0, size), OUT_TYPES[ext]) });
        collected.push(key);
      } catch { /* 这一张收不了就跳过 */ } finally { if (fd !== null) fs.closeSync(fd); }
    }
    return out;
  } finally { for (const fd of handles.reverse()) fs.closeSync(fd); }
}
