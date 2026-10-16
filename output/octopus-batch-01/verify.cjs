// 原件字节、最终 PNG 透明边距和不透明奶白内部检查。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
(async()=>{
  const originals=JSON.parse(fs.readFileSync(path.join(__dirname,'原图校验.json')));
  for(const item of originals)if(crypto.createHash('sha256').update(fs.readFileSync(item.path)).digest('hex')!==item.sha256)throw Error('原件校验失败');
  const b=await chromium.launch();const page=await b.newPage();const checks=[];
  try{for(const name of fs.readdirSync(__dirname).filter(n=>/^0[1-5]-.*\.png$/.test(n))){
    const stats=await page.evaluate(async src=>{const im=new Image();im.src=src;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let edge=0,cream=0,solid=0;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const k=(y*c.width+x)*4;if((x<24||y<24||x>=c.width-24||y>=c.height-24)&&d[k+3])edge++;if(d[k]>235&&d[k+1]>225&&d[k+2]>200&&d[k+2]<245&&d[k+3]===255)cream++;if(d[k+3]===255)solid++;}
      return {size:[im.width,im.height],edge,cream,solid};},'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,name)).toString('base64'));
    if(stats.edge!==0||stats.cream<1000||stats.solid<100000)throw Error('透明边距或实体不透明检查失败：'+name);checks.push({name,...stats});
  }}finally{await b.close();}
  fs.writeFileSync(path.join(__dirname,'最终验收.json'),JSON.stringify({originalHashesUnchanged:true,checks},null,2));console.log(`${originals.length} 原件 SHA-256 不变；${checks.length} 成品 RGBA、24px 透明边距、不透明奶白内部均通过`);
})().catch(e=>{console.error(e);process.exitCode=1;});
