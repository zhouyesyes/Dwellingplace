// 独立构建、空白浏览器、仅本地静态资源；不读取用户浏览器或生产服务。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
(async () => {
  const args = process.argv.slice(2);
  const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
  const task = option('--task', 'manual');
  const route = option('--route', '/settings');
  const sizes = { phone: [390,844], tablet: [834,1194], desktop: [1440,900] };
  const views = option('--views', 'phone,tablet,desktop').split(',');
  const themes = option('--themes', 'light,dark').split(',');
  if (!/^[\w-]{1,100}$/.test(task) || !/^\/[\w/-]*$/.test(route) || views.some(v => !sizes[v]) || themes.some(t => !['light','dark'].includes(t))) throw Error('任务编号、路由、视口或主题不合法；路由不接受查询参数');
  const fixture = option('--fixture', '');
  if (fixture && (route !== '/work' || !['workroom-materials','workroom-attachments'].includes(fixture))) throw Error('不支持这个隔离 fixture');
  const mock = fixture ? require('./fixtures/workroom-materials.cjs') : null;
  const run = randomUUID();
  const output = path.resolve('.qisuo-previews', task, run);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qisuo-preview-'));
  let browser, server;
  let stopping = false;
  const close = async () => {
    if (stopping) return;
    stopping = true;
    await browser?.close().catch(() => {});
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    fs.rmSync(temporary, { recursive: true, force: true });
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().finally(() => process.exit(130)));
  const timeout = setTimeout(() => close().finally(() => process.exit(1)), 120000);
  try {
    const { build } = await import('vite');
    const { default: vue } = await import('@vitejs/plugin-vue');
    // 不加载项目 env 文件，也不继承任何 VITE_* 环境变量。
    for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key];
    const dist = path.join(temporary, 'dist');
    await build({ configFile: false, envDir: temporary, base: './', plugins: [vue()], build: { outDir: dist, emptyOutDir: true }, logLevel: 'warn' });
    const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.woff2':'font/woff2', '.json':'application/json' };
    server = http.createServer((req, res) => {
      let file;
      try { file = path.resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname)); } catch { res.writeHead(400).end(); return; }
      if (file === dist) file = path.join(dist, 'index.html');
      if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
    fs.mkdirSync(output, { recursive: true });
    const screenshots = [];
    for (const view of views) for (const theme of themes) {
      const [width,height] = sizes[view];
      const context = await browser.newContext({ viewport: { width,height }, colorScheme: theme, serviceWorkers: 'block' });
      // 禁止 API、外部图片/字体、WebSocket；仅允许本次静态资源的 GET。
      await context.route('**/*', r => {
        const u = new URL(r.request().url());
        return u.origin === origin && r.request().method() === 'GET' && !/^\/(api|codex|sync)(\/|$)/.test(u.pathname) ? r.continue() : r.abort();
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      const state = mock ? await mock.install(context,origin) : null;
      const page = await context.newPage();
      if (mock) await mock.prepare(page,origin,fixture);
      else await page.goto(`${origin}/#${route}`);
      await page.waitForSelector('#app > *');
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      const generatedAt = new Date().toISOString();
      const label = `${route} · ${width}×${height} · ${theme} · ${generatedAt}`;
      await page.evaluate(label => {
        const el = document.createElement('div'); el.textContent = label;
        el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#17202a;color:white;font:11px sans-serif;padding:6px;pointer-events:none;overflow-wrap:anywhere';
        document.body.append(el);
      }, label);
      const file = `${view}-${theme}.png`;
      await page.screenshot({ path: path.join(output, file) });
      screenshots.push({ file, route, width, height, theme, generatedAt });
      if (mock && view === 'phone' && theme === 'light') { await mock.verify(page,fixture,state); console.log('隔离界面交互验收通过：' + fixture); }
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ version:1, screenshots }, null, 2), { flag:'wx' });
    console.log(`预览截图已生成：${output}（临时服务随后关闭）`);
  } finally { clearTimeout(timeout); await close(); }
})().catch(() => { console.error('预览失败；检查依赖、路由和本地资源。未输出可能含隐私的页面错误。'); process.exitCode = 1; });
