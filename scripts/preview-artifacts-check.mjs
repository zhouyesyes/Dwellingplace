// 用临时工作间目录跑真实收取器及附件处理函数；不启动生产 bridge。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { collectPreviews } from '../deploy/qisuo-server/codex/previews.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-check-'));
try {
  const task = 'test', project = path.join(root,'项目');
  const run = randomUUID(), dir = path.join(project,'.qisuo-previews',task,run);
  fs.mkdirSync(dir,{recursive:true}); fs.mkdirSync(path.join(root,'.qisuo-attachments'));
  const dataRoot = path.join(root,'data');
  // 测试进程不是 root，仅将临时附件根目录的所有权查询模拟为安装后的状态。
const fixtureFs = new Proxy(fs, { get(target, key) {
  if (key === 'statSync') return file => { const st = fs.statSync(file); if (file === path.join(root,'.qisuo-attachments')) st.uid = 0; return st; };
  return target[key];
} });
const context = { fs: fixtureFs,path,Buffer,randomUUID,WORK:root,DATA:dataRoot,threads:{test:{id:task}},readJSON:(f,d)=>{try{return JSON.parse(fs.readFileSync(f));}catch{return d;}},writeJSON:(f,v)=>fs.writeFileSync(f,JSON.stringify(v)),json:(_,code,value)=>({code,value}) };
  vm.createContext(context);
  const source = fs.readFileSync('deploy/qisuo-server/codex/bridge.mjs','utf8');
  vm.runInContext(source.slice(source.indexOf('const FILE_MAX'),source.indexOf('async function route('))+'\nglobalThis.upload=attachmentRoute; globalThis.lookup=fileMeta;',context);
  const uploads=[];
  const upload=async(name,data)=>{
    const result=await context.upload({method:'POST',headers:{'content-type':'image/png'},async *[Symbol.asyncIterator](){yield data;}},{},new URL('http://local/?name='+name),[null,task]);
    assert.equal(result.code,200);uploads.push(result.value);return result.value;
  };
  // 使用本轮真实截图，而不是伪造 PNG 签名。
  const runs=fs.readdirSync('.qisuo-previews/manual');
  const actual=runs.find(r=>fs.existsSync(path.join('.qisuo-previews/manual',r,'manifest.json')));
  assert(actual,'请先运行 node scripts/ui-preview.cjs');
  fs.copyFileSync(path.join('.qisuo-previews/manual',actual,'phone-light.png'),path.join(dir,'phone-light.png'));
  const screenshot={file:'phone-light.png',route:'/settings',width:390,height:844,theme:'light',generatedAt:new Date().toISOString()};
  const write=s=>fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:1,screenshots:[s]}));
  write(screenshot);
  const collected=[];
  const attachments=await collectPreviews(project,task,collected,upload);
  assert.equal(attachments.length,1);assert.equal(attachments[0].preview.route,'/settings');
  assert.deepEqual(fs.readFileSync(attachments[0].path),fs.readFileSync(path.join(dir,screenshot.file)));
  assert.equal(context.lookup({id:task},attachments[0].id).type,'image/png');
  assert.throws(()=>context.lookup({id:'other'},attachments[0].id),/不属于/);
  assert.equal((await collectPreviews(project,task,collected,upload)).length,0);
  assert.equal((await collectPreviews(project,'other',[],upload)).length,0);
  const events=[];
  Object.assign(context,{URL,collectPreviews,ours:id=>id,saveThreads:()=>{},emit:(method,params)=>events.push({method,params})});
  context.threads.test.project='项目';
  vm.runInContext(source.slice(source.indexOf('function onLine('),source.indexOf('// ---------- 审批：'))+'\nglobalThis.handleLine=onLine;',context);
  context.handleLine(JSON.stringify({method:'turn/completed',params:{threadId:task,turn:{status:'completed'}}}));
  for(let i=0;i<100&&!events.some(e=>e.method==='turn/completed');i++) await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(events.map(e=>e.method),['qisuo/preview/ready','turn/completed']);
  assert.equal(events[0].params.attachments[0].preview.width,390);
  assert.equal(context.threads.test.previewRuns[0],run);
  write({...screenshot,file:'../secret.png'}); await assert.rejects(collectPreviews(project,task,[],upload));
  write(screenshot); fs.renameSync(path.join(dir,screenshot.file),path.join(dir,'original.png'));fs.symlinkSync('original.png',path.join(dir,screenshot.file));
  await assert.rejects(collectPreviews(project,task,[],upload));
  assert.equal(uploads.length,1);
  console.log('通过：真实截图→本轮完成事件→收取→受保护附件落盘/归属、标注、去重、跨任务隔离、路径穿越及符号链接拒绝');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
