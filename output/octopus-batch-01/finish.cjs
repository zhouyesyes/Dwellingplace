// 只做无损裁切、验收与对比排版；调色由 imagegen 完成，不覆盖任何输入。
const fs = require('node:fs');
const {chromium} = require('playwright');
const path = require('node:path');
(async()=>{
  const dir=__dirname, config=JSON.parse(fs.readFileSync(path.join(dir,'sources.json')));
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage();
    const data=p=>'data:image/png;base64,'+fs.readFileSync(path.isAbsolute(p)?p:path.join(dir,p)).toString('base64');
    const names=config.names||['星星','爱心','雨伞','开心'];
    const report=[];
    for(let i=0;i<config.generated.length;i++){
      const result=await page.evaluate(async src=>{
        const img=new Image(); img.src=src; await img.decode();
        const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
        const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
        const pixels=ctx.getImageData(0,0,c.width,c.height),d=pixels.data;
        // 本批四张的装饰与奶白边均连着主体；去除生成结果继承的外围散点。
        // 后续若有独立文字或装饰，先人工检查，不能直接套最大连通域规则。
        const count=c.width*c.height,seen=new Uint8Array(count),queue=new Int32Array(count);let largest=[];const components=[];
        for(let k=0;k<count;k++)if(!seen[k]&&d[k*4+3]>=128){
          let start=0,end=1;queue[0]=k;seen[k]=1;
          while(start<end){const p=queue[start++],x=p%c.width,y=Math.floor(p/c.width);
            for(const n of [x>0?p-1:-1,x<c.width-1?p+1:-1,y>0?p-c.width:-1,y<c.height-1?p+c.width:-1])if(n>=0&&!seen[n]&&d[n*4+3]>=128){seen[n]=1;queue[end++]=n;}
          }
          components.push(end);if(end>largest.length)largest=Array.from(queue.subarray(0,end));
        }
        const keep=new Uint8Array(count);
        for(const p of largest){const x=p%c.width,y=Math.floor(p/c.width);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(x+dx>=0&&x+dx<c.width&&y+dy>=0&&y+dy<c.height)keep[(y+dy)*c.width+x+dx]=1;}
        for(let p=0;p<count;p++)if(!keep[p]){d[p*4]=d[p*4+1]=d[p*4+2]=d[p*4+3]=0;}
        // 生成结果内部常为 254 等近不透明值，实体内部统一为 255；保留外缘抗锯齿。
        for(const p of largest){const x=p%c.width,y=Math.floor(p/c.width);if(x>0&&x<c.width-1&&y>0&&y<c.height-1&&[p-1,p+1,p-c.width,p+c.width].every(n=>d[n*4+3]>=128))d[p*4+3]=255;}
        ctx.putImageData(pixels,0,0);
        let x0=c.width,y0=c.height,x1=-1,y1=-1,zero=0,opaque=0,partial=0;
        for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
          const a=d[(y*c.width+x)*4+3];
          if(a===0)zero++;else {if(a===255)opaque++;else partial++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
        }
        // 用所有非零 alpha 的并集，避免误删独立动作线；在外侧补 24px。
        const out=document.createElement('canvas');out.width=x1-x0+49;out.height=y1-y0+49;
        out.getContext('2d').drawImage(c,x0,y0,x1-x0+1,y1-y0+1,24,24,x1-x0+1,y1-y0+1);
        return {png:out.toDataURL(),sourceSize:[c.width,c.height],size:[out.width,out.height],bbox:[x0,y0,x1+1,y1+1],zero,opaque,partial,components:components.sort((a,b)=>b-a).slice(0,12)};
      },data(config.generated[i]));
      fs.writeFileSync(path.join(dir,`${String(i+1).padStart(2,'0')}-${names[i]}.png`),Buffer.from(result.png.split(',')[1],'base64'),{flag:'wx'});
      delete result.png;report.push(result);
    }
    const board=await page.evaluate(async ({pairs,comparison})=>{
      const footer=135+Math.ceil(pairs.length/2)*590+35;
      const c=document.createElement('canvas');c.width=1600;c.height=footer+490;const ctx=c.getContext('2d');
      ctx.fillStyle='#F5F1EB';ctx.fillRect(0,0,c.width,c.height);
      ctx.fillStyle='#4D5B73';ctx.font='bold 32px sans-serif';ctx.fillText('小章鱼 · 首批四张 + 追加读书款',48,55);
      ctx.font='20px sans-serif';ctx.fillText('左：原图　右：统一后　｜　中间档 B · 柔和灰靛蓝',48,95);
      for(let i=0;i<pairs.length;i++)for(let j=0;j<2;j++){
        const img=new Image();img.src=pairs[i][j];await img.decode();
        const x=40+(i%2)*780+j*375,y=135+Math.floor(i/2)*590;
        for(let yy=0;yy<510;yy+=18)for(let xx=0;xx<360;xx+=18){ctx.fillStyle=((xx/18+yy/18)%2)?'#E0E2E4':'#EEF0F1';ctx.fillRect(x+xx,y+yy,18,18);}
        const s=Math.min(340/img.width,490/img.height);ctx.drawImage(img,x+(360-img.width*s)/2,y+(510-img.height*s)/2,img.width*s,img.height*s);
        ctx.fillStyle='#4D5B73';ctx.font='20px sans-serif';ctx.fillText(`${i+1} · ${j?'统一后':'原图'}`,x,y+542);
      }
      ctx.fillStyle='#4D5B73';ctx.font='20px sans-serif';ctx.fillText('三档试色：A 稍深　／　B 采用　／　C 更浅',48,footer);
      const img=new Image();img.src=comparison;await img.decode();const s=Math.min(1520/img.width,410/img.height);ctx.drawImage(img,(1600-img.width*s)/2,footer+20,img.width*s,img.height*s);
      return c.toDataURL();
    },{pairs:config.original.map((p,i)=>[data(p),data(path.join(dir,`${String(i+1).padStart(2,'0')}-${names[i]}.png`))]),comparison:data(config.comparison)});
    fs.writeFileSync(path.join(dir,'效果对比.png'),Buffer.from(board.split(',')[1],'base64'),{flag:'wx'});
    fs.writeFileSync(path.join(dir,'检查报告.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }finally{await browser.close();}
})();
