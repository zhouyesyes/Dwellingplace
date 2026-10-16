// 隔离预览专用虚构数据，不连接真实服务器或读取任何用户文件。
const assert = require('node:assert/strict');
const png = Buffer.from('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','base64');
const id = '12345678-1234-1234-1234-123456789abc';
const task = { id:'preview-task', project:'栖所', title:'贴纸原图调色（虚构验收）', turnId:'preview-turn', createdAt:1, updatedAt:1 };
exports.install = async (context, origin) => {
  const materials = [{id,name:'测试贴纸原图.png',originalName:'测试贴纸原图.png',type:'image/png',size:png.length,path:'/work/.qisuo-attachments/projects/栖所/inbox/'+id+'/测试贴纸原图.png',purpose:'保留透明背景，统一调色；此为无敏感信息的测试 PNG',status:'pending',tasks:[],projectPath:'../.qisuo-attachments/projects/栖所/inbox/'+id+'/测试贴纸原图.png'}];
  const attachments = [{...materials[0],projectPath:undefined,path:'/work/.qisuo-attachments/tasks/preview-task/'+id+'/测试贴纸原图.png',notification:'pending'}];
  const calls = [];
  await context.addInitScript(() => { Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text => {window.copiedMaterialPath=text;}}}); window.EventSource = class { constructor() { this.readyState=1; queueMicrotask(()=>this.onopen?.()); } close(){this.readyState=2;} }; });
  await context.route(origin + '/p/preview/**', async route => {
    const req = route.request(), url = new URL(req.url()), p = decodeURIComponent(url.pathname.replace('/p/preview/codex',''));
    const send = json => route.fulfill({json});
    if(p==='/status') return send({ready:true,account:{type:'chatgpt'},projects:['栖所'],threads:[task],policy:{},seq:0});
    if(p==='/projects/git') return send({cloned:false});
    if(p==='/threads/preview-task/events') return send({thread:task,events:[],approvals:[]});
    if(p==='/threads/preview-task/attachments' && req.method()==='GET') return send({attachments});
    if(p==='/projects/栖所/materials' && req.method()==='GET') return send({materials});
    if((p.startsWith('/threads/preview-task/attachments/') || p.startsWith('/projects/栖所/materials/')) && req.method()==='GET') return route.fulfill({contentType:'image/png',body:png,headers:{'Content-Disposition':url.searchParams.has('download')?'attachment; filename=test.png':'inline'}});
    const b = req.headers()['content-type']?.startsWith('application/json') ? req.postDataJSON() : {};
    if(p.endsWith('/material')) return send(materials[0]);
    if(p.endsWith('/rename')) { materials[0].name=b.name; return send(materials[0]); }
    if(p.endsWith('/archive')) { materials[0].status='archived'; materials[0].libraryPath=materials[0].path.replace('/inbox/','/library/'); materials[0].libraryProjectPath=materials[0].projectPath.replace('/inbox/','/library/'); return send(materials[0]); }
    if(p.endsWith('/attach')) return send(attachments[0]);
    if(p.endsWith('/send')) { calls.push(b); for(const a of attachments) if(b.attachments?.includes(a.id)) a.notification='delivered'; for(const a of materials) if(b.attachments?.includes(a.id)) {a.tasks=[task.id];a.status='used';} return send({steer:true,notified:true}); }
    if(p==='/threads/preview-task/attachments' || p==='/projects/栖所/materials') {
      const a={...materials[0],id:'22345678-1234-1234-1234-123456789abc',name:url.searchParams.get('name'),purpose:url.searchParams.get('purpose'),notification:'pending',status:'pending',tasks:[]};
      if(p.includes('/threads/')) attachments.push(a); else materials.push(a);
      return send(a);
    }
    return route.fulfill({status:404,json:{error:{message:'隔离预览不提供这个接口'}}});
  });
  return {calls};
};
exports.prepare = async (page, origin, mode) => {
  // 原生 IndexedDB，与应用相同的库；只存在本次空白浏览器中。
  await page.goto(origin);
  await page.evaluate(() => new Promise((resolve,reject) => {
    const r = indexedDB.open('keyval-store',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('keyval');
    r.onerror=()=>reject(r.error);
    r.onsuccess=()=>{const db=r.result,tx=db.transaction('keyval','readwrite');tx.objectStore('keyval').put({url:location.origin+'/p/preview/sync'},'sync:conf');tx.oncomplete=()=>{db.close();resolve();};};
  }));
  await page.goto(origin+'/#/work');
  await page.getByText('项目素材收件箱',{exact:true}).waitFor();
  if(mode==='workroom-attachments') {
    await page.locator('button.row').filter({hasText:task.title}).click();
    await page.getByText('直接用 Codex',{exact:true}).click();
    await page.getByText('任务原始附件',{exact:true}).waitFor();
  }
  await page.locator('.material-file img').first().waitFor();
  await page.waitForFunction(()=>document.querySelector('.material-file img')?.naturalWidth>0);
  await page.evaluate(()=>{const el=document.querySelector('main.tl');if(el) el.scrollTop=0;});
};
exports.verify = async (page, mode, state) => {
  const panel = page.locator('.material-panel');
  await panel.getByRole('button',{name:'复制路径',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.copiedMaterialPath),await panel.locator('.material-file code').first().innerText());
  if(mode==='workroom-materials') assert((await page.evaluate(()=>window.copiedMaterialPath)).startsWith('../.qisuo-attachments/projects/栖所/'));

  assert(await panel.getByText('下载原件',{exact:true}).count());
  await panel.getByRole('button',{name:'预览 测试贴纸原图.png',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:'关闭预览',exact:true}).click();
  if(mode==='workroom-attachments') {
    await panel.getByRole('button',{name:'通知 Codex / 重试',exact:true}).click();
    await panel.getByText(`image/png · ${Math.ceil(png.length/1024)} KB · 已通知 Codex`,{exact:true}).waitFor();
    assert(state.calls[0].attachments.includes(id));
    await panel.getByRole('button',{name:'保存到项目收件箱',exact:true}).click();
    await panel.getByRole('button',{name:'从项目素材选择',exact:true}).click();
    await panel.getByRole('button',{name:'附加并通知任务',exact:true}).waitFor();
    await panel.getByRole('button',{name:'返回任务附件',exact:true}).click();
  } else {
    await panel.locator('select').selectOption(task.id);
    await panel.getByRole('button',{name:'附加并通知任务',exact:true}).click();
    await panel.getByText(`image/png · ${Math.ceil(png.length/1024)} KB · 已用于任务`,{exact:true}).waitFor();
    assert(state.calls[0].attachments.includes(id));
    page.once('dialog',d=>d.accept('调色素材.png'));
    await panel.getByRole('button',{name:'重命名',exact:true}).click();
    await panel.getByText('调色素材.png',{exact:true}).waitFor();
    await panel.getByRole('button',{name:'保存到素材库',exact:true}).click();
    await panel.getByText(`image/png · ${Math.ceil(png.length/1024)} KB · 已归档`,{exact:true}).waitFor();
  }
  await panel.getByPlaceholder('例如：保留透明背景，统一贴纸颜色').fill('追加上传验收');
  await panel.locator('input[type=file]').setInputFiles({name:'追加原图.png',mimeType:'image/png',buffer:png});
  await panel.getByText('追加原图.png',{exact:true}).waitFor();
  if(mode==='workroom-attachments') { assert(state.calls.some(c=>c.attachments?.includes('22345678-1234-1234-1234-123456789abc'))); }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'页面不应横向溢出');
};
// fixture 的数据全是上述常量；只在此处保留详细断言，普通截图仍不输出页面错误。
for (const key of ['prepare','verify']) {
  const run = exports[key];
  exports[key] = async (...args) => { try { return await run(...args); } catch(e) { console.error('虚构数据界面验收失败：'+key+' '+e.message); throw e; } };
}
