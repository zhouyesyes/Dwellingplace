const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const { packWidgets } = await import('../src/lib/widgetLayout.js');
  const input = [{id:'a',size:'large',height:300},{id:'b',size:'large',height:200},{id:'c',size:'small',height:140},{id:'d',size:'small',height:140}];
  const packed = packWidgets(input);
  assert.equal(packed[2].y,0);
  assert.equal(packed[3].y,154);
  assert.deepEqual(packWidgets(input),packed);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto(process.env.QISUO_TEST_URL || 'http://127.0.0.1:5203/');
  await page.waitForSelector('.wdesk');
  await page.evaluate(async()=>{
    const {store}=await import('/src/store/index.js');
    store.widgets=[{id:'cal',type:'calendar',size:'large'},{id:'books',type:'books',size:'large'},{id:'anniv',type:'anniv',size:'small'},{id:'desk',type:'desk',size:'small'},{id:'work',type:'work',size:'large'}];
  });
  async function rects(){return page.locator('.wdesk > .widget').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.widgetId,x:r.x,y:r.y,w:r.width,h:r.height};}));}
  for(const width of [390,600,768,820,1024,1180,1366,1440]) {
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(250);
    const rs=await rects();
    for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){
      const a=rs[i],b=rs[j];
      assert(a.x+a.w<=b.x+1||b.x+b.w<=a.x+1||a.y+a.h<=b.y+1||b.y+b.h<=a.y+1,`重叠 ${width} ${a.id} ${b.id}`);
    }
    if(width>=760&&width<=1366){assert.equal(rs[0].y,rs[2].y);assert(Math.abs(rs[0].w-(rs[2].w*2+14))<2);}
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if([390,820,1180].includes(width))for(const theme of ['light','dark']){
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await page.screenshot({path:`/tmp/widget-${width}-${theme}.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:1180,height:1400});
  await page.locator('[data-widget-id="anniv"]').scrollIntoViewIfNeeded();
  let a=await page.locator('[data-widget-id="anniv"]').boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.waitForTimeout(550);await page.mouse.up();
  await page.waitForSelector('.edit-bar');
  await page.waitForTimeout(150);
  // 停止摇晃使命中检查不受动画角度影响。
  await page.addStyleTag({content:'.editing .widget {animation:none!important}'});
  a=await page.locator('[data-widget-id="anniv"]').boundingBox();
  const b=await page.locator('[data-widget-id="books"]').boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(b.x+b.width/2,b.y+30,{steps:10});await page.waitForTimeout(100);
  const order=await page.evaluate(async()=>(await import('/src/store/index.js')).store.widgets.map(w=>w.id));
  for(let i=0;i<4;i++)await page.mouse.move(b.x+b.width/2+1,b.y+31);
  assert.deepEqual(await page.evaluate(async()=>(await import('/src/store/index.js')).store.widgets.map(w=>w.id)),order);
  await page.mouse.up();
  assert.notDeepEqual(order,['cal','books','anniv','desk','work']);
  await page.locator('[data-widget-id="anniv"] .size').click();
  await page.waitForTimeout(150);
  assert(await page.locator('[data-widget-id="anniv"]').evaluate(el=>el.classList.contains('large')));
  await page.locator('[data-widget-id="anniv"] .size').click();
  await page.locator('[data-widget-id="work"] .del').click();
  await page.locator('.add-tile').click();
  await page.getByRole('button').filter({hasText:'工作间'}).last().click();
  await page.waitForTimeout(200);
  const savedOrder=await page.locator('[data-widget-id]').evaluateAll(els=>els.map(el=>el.dataset.widgetId));
  await page.locator('.add-tile').scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/widget-edit.png',fullPage:true});
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.waitForTimeout(700);await page.reload();await page.waitForSelector('.wdesk');
  assert.deepEqual(await page.locator('[data-widget-id]').evaluateAll(els=>els.map(el=>el.dataset.widgetId)),savedOrder);
  assert.deepEqual(errors,[]);
  await browser.close();console.log('通过：确定性补位、常见宽度无重叠/溢出、混排同排、拖动稳定及刷新保存');
})().catch(e=>{console.error(e);process.exit(1)});
