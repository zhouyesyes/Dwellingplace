import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { createBindingPayload, parseBindingPayload, bindingOrigin, qrMatrix } from '../src/lib/bindingQr.js';
import { createQrCamera } from '../src/lib/qrScanner.js';
const now = Date.now(), code = 'ABCD-EFGH-JKLM';
const create = origin => createBindingPayload({code, origin, expiresAt: now + 300000}, now);
const raster = (matrix, turn = false) => {
  const n = matrix.length, size = (n + 8) * 5, data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const a=Math.floor(x/5)-4,b=Math.floor(y/5)-4;
    if(a<0||b<0||a>=n||b>=n)continue;
    if(turn?matrix[n-1-a][b]:matrix[b][a]) { const i=(y*size+x)*4; data[i]=data[i+1]=data[i+2]=0; }
  }
  return {data,size};
};
for (const origin of ['https://app.example.com','https://sub.example.com:8443','http://localhost:5199','http://127.0.0.1:5199','http://[::1]:5199','https://栖所.example']) {
  const text=create(origin);assert.equal(parseBindingPayload(text).origin,new URL(origin).origin);
  for (const rotate of [false,true]) { const {data,size}=raster(qrMatrix(text),rotate);assert.equal(jsQR(data,size,size)?.data,text); }
}
const long='X'.repeat(271),pixels=raster(qrMatrix(long));assert.equal(jsQR(pixels.data,pixels.size,pixels.size)?.data,long);
assert.throws(()=>qrMatrix('X'.repeat(272)),/太长/);
const text=create('https://app.example.com');
const v=JSON.parse(text);
for (const bad of ['',null,'https://example.com/?code='+code,'[]','null',JSON.stringify({...v,v:2}),JSON.stringify({...v,type:'other'}),JSON.stringify({...v,token:'never-accept'}),JSON.stringify({...v,code:'ABCD-EFGH-IJKL'}),text.replace('"v":1','"v":1,"v":1'),text+' ', 'x'.repeat(601)]) assert.throws(()=>parseBindingPayload(bad));
for(const origin of ['http://evil.example','javascript:alert(1)','data:text/plain,foo','//evil.example','https://user:pass@evil.example','https://evil.example/sync','https://evil.example?token=x','https://evil.example/#x','http://127.0.0.1.evil.example','https://evil.example\\@good.example','https://evil.example\n']) assert.throws(()=>bindingOrigin(origin));
for(const expiresAt of [undefined,NaN,now-1,now,now+300001]) assert.throws(()=>createBindingPayload({code,origin:'https://example.com',expiresAt},now));
assert(!createBindingPayload({code,origin:'https://example.com',expiresAt:now+1000,token:'never-serialize'},now).includes('never-serialize'));
console.log('通过：绑定协议/非法字段/重复字段/版本/不安全 origin/过期生成校验；二维码真实回读、旋转和容量边界');

// 控制器的权限延迟、取消、回调在途和循环清理，不需要真实摄像头。
let frames=new Map(),next=0,stops=0,results=0,errors=[];
const video={readyState:2,srcObject:null,pause(){},play:async()=>{}};
const stream=()=>({getTracks:()=>[{stop(){stops++;}}]});
const opts={video,onResult:()=>results++,onError:e=>errors.push(e),requestFrame:fn=>{frames.set(++next,fn);return next;},cancelFrame:id=>frames.delete(id)};
let resolvePermission;
const pending=createQrCamera({...opts,getStream:()=>new Promise(r=>resolvePermission=r)});
const start=pending.start();pending.stop();resolvePermission(stream());await start;assert.equal(stops,1);assert.equal(frames.size,0);
const denied=createQrCamera({...opts,getStream:async()=>{throw Object.assign(Error(),{name:'NotAllowedError'});}});await denied.start();assert.match(errors.pop(),/授权/);
const unavailable=createQrCamera({...opts,getStream:async()=>{throw Error();}});await unavailable.start();assert.match(errors.pop(),/不可用/);
const success=createQrCamera({...opts,getStream:async()=>stream(),decode:async()=>text});await success.start();
let entry=[...frames][0];frames.delete(entry[0]);await entry[1](300);assert.equal(results,1);assert.equal(stops,2);assert.equal(frames.size,0);
let resolveDecode;
const inFlight=createQrCamera({...opts,getStream:async()=>stream(),decode:()=>new Promise(r=>resolveDecode=r)});await inFlight.start();
entry=[...frames][0];frames.delete(entry[0]);const scan=entry[1](600);inFlight.stop();resolveDecode(text);await scan;
assert.equal(results,1);assert.equal(frames.size,0);assert.equal(stops,3);assert.equal(video.srcObject,null);
console.log('通过：取消等待授权后关闭迟到流、拒绝授权/不可用提示、成功后清理、解码在途关闭后不回调');
