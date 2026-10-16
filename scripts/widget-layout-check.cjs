const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const { packWidgets } = await import('../src/lib/widgetLayout.js');
  const input = [{id:'a',size:'large',height:300},{id:'b',size:'large',height:200},{id:'c',size:'small',height:140},{id:'d',size:'small',height:140}];
  const packed = packWidgets(input);
  assert.equal(packed[2].y,0);
  assert.equal(packed[3].y,154);
  assert.deepEqual(packWidgets(input),packed);
  // 穷举大小组合，检查算法没有改输入、越界或重叠。
  for (let mask = 0; mask < 64; mask++) {
    const items = Array.from({length:6}, (_,i)=>({id:String(i),size:mask & (1<<i) ? 'small':'large',height:83+i*37}));
    const before=JSON.stringify(items), ps=packWidgets(items);
    assert.equal(JSON.stringify(items),before);
    assert.deepEqual(ps.map(p=>p.id),items.map(p=>p.id));
    for(const a of ps) {
      assert(a.x>=0 && a.x+a.width<=3 && a.y>=0);
      for(const b of ps)if(a!==b) assert(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height+14<=b.y||b.y+b.height+14<=a.y);
    }
  }
  const browser = await chromium.launch();
  try {
  const page = await browser.newPage({hasTouch:true});
  await page.route('**/*', route => {
    const url=new URL(route.request().url());
    return ['127.0.0.1','localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.addInitScript(()=>{
    const observed=new Map(), NativeResizeObserver=window.ResizeObserver;
    window.__widgetObserved=observed;
    window.ResizeObserver=class extends NativeResizeObserver {
      constructor(cb) {super(cb);observed.set(this,new Set());}
      observe(el,opts) {observed.get(this).add(el);return super.observe(el,opts);}
      disconnect() {observed.get(this).clear();return super.disconnect();}
      unobserve(el) {observed.get(this).delete(el);return super.unobserve(el);}
    };
    const active=[];
    window.__widgetListeners=active;
    const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
    const names=['onMove','onUp','onResize','onScroll','onVisibility'];
    EventTarget.prototype.addEventListener=function(type,fn,opts){
      if(names.includes(fn?.name) && !active.some(x=>x.target===this&&x.type===type&&x.fn===fn)) active.push({target:this,type,fn});
      return add.call(this,type,fn,opts);
    };
    EventTarget.prototype.removeEventListener=function(type,fn,opts){
      const i=active.findIndex(x=>x.target===this&&x.type===type&&x.fn===fn);if(i>=0)active.splice(i,1);
      return remove.call(this,type,fn,opts);
    };
  });
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto(process.env.QISUO_TEST_URL || 'http://127.0.0.1:5204/');
  await page.waitForSelector('.wdesk');
  await page.evaluate(async()=>{
    const {store}=await import('/src/store/index.js');
    store.widgets=[{id:'cal',type:'calendar',size:'large'},{id:'books',type:'books',size:'large'},{id:'anniv',type:'anniv',size:'small'},{id:'desk',type:'desk',size:'small'},{id:'work',type:'work',size:'large'}];
  });
  async function rects(){return page.locator('.wdesk > .widget').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.widgetId,x:r.x,y:r.y,w:r.width,h:r.height};}));}
  for(const width of [390,600,759,760,761,768,820,1024,1180,1366,1367,1440]) {
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(250);
    const rs=await rects();
    assert.equal(await page.locator('[data-widget-id="cal"]').evaluate(el=>!!el.style.gridRow), width>=760&&width<=1366,JSON.stringify({width,media:await page.evaluate(()=>({w:innerWidth,coarse:matchMedia("(any-pointer: coarse)").matches})),errors}));
    assert.equal(await page.locator('.wdesk').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width<760?2:3);
    for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){
      const a=rs[i],b=rs[j];
      assert(a.x+a.w<=b.x+1||b.x+b.w<=a.x+1||a.y+a.h<=b.y+1||b.y+b.h<=a.y+1,`重叠 ${width} ${a.id} ${b.id}`);
    }
    if(width>=760&&width<=1366){assert.equal(rs[0].y,rs[2].y);assert(Math.abs(rs[0].w-(rs[2].w*2+14))<2);}
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    // 当前 Chromium 的 fullPage 截图会把 maxTouchPoints 从 1 重置为 0；用视口截图保留真实媒体条件。
    if([390,820,1180].includes(width))for(const theme of ['light','dark']){
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await page.waitForTimeout(250);
      await page.screenshot({path:`/tmp/widget-${width}-${theme}.png`,fullPage:false});
    }
  }
  await page.setViewportSize({width:1180,height:1400});
  await page.locator('[data-widget-id="anniv"]').scrollIntoViewIfNeeded();
  let a=await page.locator('[data-widget-id="anniv"]').boundingBox();
  const cdp=await page.context().newCDPSession(page);
  const touch=async(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  await touch('touchStart',[{x:a.x+a.width/2,y:a.y+a.height/2}]);
  await page.waitForTimeout(550);await touch('touchEnd');
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
  assert.deepEqual(order,['cal','anniv','books','desk','work']);
  assert.deepEqual(await page.locator('[data-widget-id]').evaluateAll(els=>els.map(el=>el.dataset.widgetId)),order);
  assert.equal(await page.locator('.dragging').count(),0);
  assert.equal(await page.locator('[data-widget-id="anniv"]').evaluate(el=>el.style.transform),'');
  async function noOverlap() {
    await page.waitForTimeout(150);
    const rs=await rects();
    for(const a of rs)for(const b of rs)if(a!==b)assert(a.x+a.w<=b.x+1||b.x+b.w<=a.x+1||a.y+a.h<=b.y+1||b.y+b.h<=a.y+1,`编辑卡片重叠 ${a.id}/${b.id}`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await noOverlap();
  // 原生鼠标保持按下时，其他 pointer 的移动/抬起不得结束或改变拖动。
  a=await page.locator('[data-widget-id="anniv"]').boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.evaluate(()=>{
    window.dispatchEvent(new PointerEvent('pointermove',{pointerId:99,clientX:1,clientY:1}));
    window.dispatchEvent(new PointerEvent('pointerup',{pointerId:99}));
  });
  assert.equal(await page.locator('.dragging').count(),1);
  assert.deepEqual(await page.evaluate(async()=>(await import('/src/store/index.js')).store.widgets.map(w=>w.id)),order);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await page.locator('.dragging').count(),0);
  assert.equal(await page.locator('[data-widget-id="anniv"]').evaluate(el=>el.style.transform),'');
  await page.mouse.up();
  // CDP 生成真实触摸 pointer 链，验证取消、继续拖动与旋转收尾。
  a=await page.locator('[data-widget-id="anniv"]').boundingBox();
  const point={x:a.x+a.width/2,y:a.y+a.height/2};
  await touch('touchStart',[point]);
  assert.equal(await page.locator('.dragging').count(),1);
  await touch('touchMove',[{x:point.x+10,y:point.y+10}]);
  await touch('touchCancel');
  assert.equal(await page.locator('.dragging').count(),0);
  assert.equal(await page.locator('[data-widget-id="anniv"]').evaluate(el=>el.style.transform),'');
  await touch('touchStart',[point]);
  await page.setViewportSize({width:820,height:1180});
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.dragging').count(),0);
  await touch('touchCancel');
  await noOverlap();
  await page.setViewportSize({width:1180,height:1400});
  await noOverlap();
  await page.locator('[data-widget-id="anniv"] .size').click();
  await noOverlap();
  await page.waitForTimeout(150);
  assert(await page.locator('[data-widget-id="anniv"]').evaluate(el=>el.classList.contains('large')));
  await page.locator('[data-widget-id="anniv"] .size').click();
  await page.locator('[data-widget-id="work"] .del').click();
  await page.locator('.add-tile').click();
  await page.getByRole('button').filter({hasText:'工作间'}).last().click();
  await page.waitForTimeout(200);
  await noOverlap();
  assert.deepEqual(await page.evaluate(async()=>(await import('/src/store/index.js')).store.widgets.map(w=>w.type)),['calendar','anniv','books','desk','work']);
  // iPad 捏合缩放改变视觉视口，不应改变文档占位和保存顺序。
  await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.25});
  await noOverlap();
  await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
  const savedOrder=await page.locator('[data-widget-id]').evaluateAll(els=>els.map(el=>el.dataset.widgetId));
  await page.locator('.add-tile').scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/widget-edit.png',fullPage:false});
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.waitForTimeout(700);await page.reload();await page.waitForSelector('.wdesk');
  assert.deepEqual(await page.locator('[data-widget-id]').evaluateAll(els=>els.map(el=>el.dataset.widgetId)),savedOrder);
  assert.deepEqual(await page.evaluate(async()=>(await import('/src/store/index.js')).store.widgets.map(w=>w.id)),savedOrder);
  // 不关闭摇晃动画再做一次点击/抬手，防止动画屏蔽实际事件问题。
  await page.locator('[data-widget-id="anniv"]').scrollIntoViewIfNeeded();
  a=await page.locator('[data-widget-id="anniv"]').boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.waitForTimeout(550);await page.mouse.up();
  await page.waitForSelector('.edit-bar');
  a=await page.locator('[data-widget-id="anniv"]').boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+5,a.y+a.height/2+5);await page.mouse.up();
  assert.equal(await page.locator('.dragging').count(),0);
  assert.notEqual(await page.locator('[data-widget-id="anniv"]').evaluate(el=>getComputedStyle(el).animationName),'none');
  const listenerCount=await page.evaluate(()=>window.__widgetListeners.length);
  assert(listenerCount>0);
  for(let i=0;i<3;i++) {
    await page.evaluate(()=>location.hash='/settings');
    await page.waitForSelector('.wdesk',{state:'detached'});
    assert.equal(await page.evaluate(()=>window.__widgetListeners.length),0);
    assert.equal(await page.evaluate(()=>[...window.__widgetObserved.values()].reduce((n,s)=>n+s.size,0)),0);
    await page.evaluate(()=>location.hash='/');
    await page.waitForSelector('.wdesk');
    assert.equal(await page.evaluate(()=>window.__widgetListeners.length),listenerCount);
  }
  // 空桌面只能有一个提示，进入编辑后添加卡必须有有效占位。
  await page.evaluate(async()=>{(await import('/src/store/index.js')).store.widgets=[];});
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.hint').count(),1);
  await page.getByRole('button',{name:'编辑桌面',exact:true}).click();
  await noOverlap();
  assert(await page.locator('.add-tile').isVisible());
  // 非触摸桌面即使为 1366px，也必须保持原自动网格。
  const desktop=await browser.newPage({viewport:{width:1366,height:1000}});
  await desktop.goto(process.env.QISUO_TEST_URL || 'http://127.0.0.1:5204/');
  await desktop.waitForSelector('.wdesk');
  for(const width of [759,760,1366,1367,1440]) {
  await desktop.setViewportSize({width,height:1000});
  await desktop.waitForTimeout(150);
  assert.equal(await desktop.locator('.widget').first().evaluate(el=>el.style.gridRow),'');
  assert.notEqual(await desktop.locator('.wdesk').evaluate(el=>getComputedStyle(el).gridAutoRows),'1px');
  }
  await desktop.close();
  assert.deepEqual(errors,[]);
  console.log('通过：确定性补位、常见宽度无重叠/溢出、混排同排、拖动稳定及刷新保存、精确顺序、断点/桌面隔离、触摸取消/多指/旋转/监听清理');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
