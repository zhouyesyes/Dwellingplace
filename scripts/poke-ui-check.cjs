// 临时浏览器、模拟模型，不读取真实会话或访问外部服务。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
 const browser = await chromium.launch();
 try {
 const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 let requests=[];
 await page.route('**/*',r=>{
  const u=new URL(r.request().url());
  if(u.pathname==='/mock/v1/chat/completions') {
   requests.push(r.request().postDataJSON());
   return r.fulfill({json:{choices:[{message:{content:requests.length === 1 ? '收到啦\n\n[戳一戳]\n[戳一戳]' : '[戳一戳]'}}],usage:{prompt_tokens:10,completion_tokens:8}}});
  }
  if(u.hostname!=='127.0.0.1'||u.pathname.startsWith('/sync')||u.pathname.startsWith('/.well-known'))return r.abort();
  return r.continue();
 });
 await page.goto('http://127.0.0.1:5199');
 await page.evaluate(async()=>{
  const {store,createThread,messageCache,saveMessages}=await import('/src/store/index.js');
  store.roles[0].name='小章鱼';store.roles[0].poke={ai:'<img src=x onerror=alert(1)>戳了你'};
  store.apis=[{id:'mock',type:'openai',name:'模拟',baseUrl:location.origin+'/mock/v1',model:'mock',key:'mock'}];store.defaultApiId='mock';store.tools.stream=false;
  const t=createThread('main');globalThis.testThread=t.id;
  messageCache[t.id]=[{id:'seed',parentId:'root',from:'user',text:'你好',ts:Date.now()},{id:'reply',parentId:'seed',from:'ai',text:'在这里',ts:Date.now()}];saveMessages(t.id);
  location.hash='/chat/main/'+t.id;
 });
 const avatar=page.locator('.poke-target').last();await avatar.waitFor();
 await avatar.click();await page.waitForTimeout(400);assert.equal(requests.length,0);
 await avatar.dblclick({delay:80});
 await page.getByText('<img src=x onerror=alert(1)>戳了你',{exact:true}).waitFor();
 assert.equal(requests.length,1);assert.match(JSON.stringify(requests[0]),/戳一戳互动/);
 assert.equal(await page.locator('.event').count(),2);assert.equal(await page.locator('.event img').count(),0);
 assert.equal(await page.locator('.bubble').filter({hasText:'[戳一戳]'}).count(),0);
 const result=await page.evaluate(async()=>{
  const c=await import('/src/lib/chat.js');const {POKE_RE,cleanPoke,pokeText}=await import('/src/lib/poke.js');
  const {loadMessages,saveMessages,store}=await import('/src/store/index.js');
  for(const text of ['[戳一戳]','  [戳一戳]  '])if(!c.findCmd(text,POKE_RE)||c.visibleText(text).trim())throw Error('指令未隐藏');
  for(const text of ['`[戳一戳]`','> [戳一戳]','例子[戳一戳]','```\n[戳一戳]\n```'])if(c.findCmd(text,POKE_RE))throw Error('误执行例子');
  if(c.visibleText('你好\n[戳一')!=='你好')throw Error('流式指令泄漏');
  if(cleanPoke('字'.repeat(100)).length!==60)throw Error('长度');
  if(pokeText({name:'新名字'},'user')!=='你戳了戳新名字的脑袋')throw Error('旧设置默认');
  const list=await loadMessages(testThread);saveMessages(testThread);
  return {id:testThread,pokes:list.filter(m=>m.poke).length,notes:list.flatMap(m=>m.notes||[]).filter(n=>n.poke).length};
 });
 assert.equal(result.pokes,1);assert.equal(result.notes,1);
 await page.waitForTimeout(1000);
 for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:`/tmp/poke-${theme}.png`});}
 await page.reload();await page.getByText('你戳了戳小章鱼的脑袋',{exact:true}).waitFor();await page.getByText('<img src=x onerror=alert(1)>戳了你',{exact:true}).waitFor();
 const box=await page.locator('.poke-target').last().boundingBox();
 await page.touchscreen.tap(box.x+20,box.y+20);await page.waitForTimeout(80);await page.touchscreen.tap(box.x+20,box.y+20);
 await page.waitForTimeout(1500);
 assert.equal(await page.locator('.event').count(),4);
 assert.equal(await page.locator('.bubble').count(),3,'纯动作回复不产生空气泡');
 await page.reload();await page.waitForTimeout(500);assert.equal(await page.locator('.event').count(),4,'纯动作回复仍持久化');
 await page.evaluate(()=>location.hash='/settings/role/main');
 const input=page.locator('input[placeholder="你戳了戳{他}的脑袋"]');await input.fill('{我}轻轻戳了戳{他}');
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForTimeout(1000);
 await page.reload();assert.equal(await page.evaluate(async()=>(await import('/src/store/index.js')).store.roles[0].poke.user),'{我}轻轻戳了戳{他}');
 console.log('通过：双击仅一次、单击无动作、上下文、指令解析/隐藏/去重、纯文本转义、默认/长度/昵称、消息及设置重载持久化、浅深色截图');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
