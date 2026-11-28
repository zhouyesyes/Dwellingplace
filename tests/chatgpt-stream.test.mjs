import test from 'node:test';
import assert from 'node:assert/strict';
import { responseTextCollector } from '../deploy/qisuo-server/chatgpt.mjs';
const delta = (text, oi=0, ci=0) => ({type:'response.output_text.delta',output_index:oi,content_index:ci,delta:text});
const message = text => ({type:'message',content:[{type:'output_text',text}]});

test('段落结束事件能补齐缺失的中间正文', () => {
  const collect=responseTextCollector();
  assert.equal(collect(delta('开头。末尾。')),'开头。末尾。');
  assert.equal(collect({type:'response.output_text.done',text:'开头。中间的讨论。末尾。'}),'开头。中间的讨论。末尾。');
});
test('不发 output_text.done 时从 content_part.done 补正文', () => {
  const collect=responseTextCollector();collect(delta('半句'));
  assert.equal(collect({type:'response.content_part.done',part:{type:'output_text',text:'半句话终于说完。'}}),'半句话终于说完。');
});
test('不发段落结束事件时从 output_item.done 补正文，重复事件不重复文字', () => {
  const collect=responseTextCollector();collect(delta('半句'));
  const event={type:'response.output_item.done',item:message('半句话终于说完。')};
  assert.equal(collect(event),'半句话终于说完。');assert.equal(collect(event),'半句话终于说完。');
});
test('多个输出段落乱序到达，按索引还原并用最终正文校正', () => {
  const collect=responseTextCollector();collect(delta('后段',1));collect(delta('前段',0));
  assert.equal(collect({type:'response.completed',response:{output:[message('前段完整。'),message('后段完整。')]}}),'前段完整。后段完整。');
});
test('思考和工具输出不混入正文，缺少最终正文不会清空已收到的文字', () => {
  const collect=responseTextCollector();collect(delta('保留正文。',2));
  assert.equal(collect({type:'response.output_item.done',output_index:0,item:{type:'reasoning',summary:[]}}),'保留正文。');
  assert.equal(collect({type:'response.completed',response:{output:[]}}),'保留正文。');
});

test('真实转发处理器将消息结束正文补回前端流，并明确结束', async () => {
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {Readable}=await import('node:stream');
  const {EventEmitter}=await import('node:events');
  const dir=await mkdtemp(join(tmpdir(),'qisuo-stream-test-'));
  const oldDir=process.env.DATA_DIR, oldFetch=globalThis.fetch;
  try {
    // 只在临时目录放模拟凭据，所有上游请求由本测试接管。
    process.env.DATA_DIR=dir;
    await writeFile(join(dir,'chatgpt-credentials.json'),JSON.stringify({access_token:'test-only',scopes:['chatgpt.tokens.use.direct'],expires_at:Date.now()+3600000}));
    const {handleChatGPT}=await import('../deploy/qisuo-server/chatgpt.mjs?stream-test');
    const events=[delta('开头。末尾。'),{type:'response.output_item.done',output_index:0,item:message('开头。补回中间段。末尾。')},{type:'response.completed',response:{output:[],usage:{input_tokens:12,output_tokens:20}}}];
    globalThis.fetch=async url=>{
      assert.equal(url,'https://api.openai.com/v1/responses');
      const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));
      return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));
    };
    const req=Readable.from([Buffer.from(JSON.stringify({model:'test-model',stream:true,messages:[{role:'user',content:'继续讨论'}]}))]);req.method='POST';
    const res=new EventEmitter();let out='';res.writeHead=()=>{res.headersSent=true};res.write=v=>{out+=v};res.end=v=>{out+=v||'';res.writableEnded=true};
    await handleChatGPT(req,res,'/v1/chat/completions',{});
    let text='',finish;
    for(const line of out.split('\n').filter(l=>l.startsWith('data: ')&&l!=='data: [DONE]')){
      const j=JSON.parse(line.slice(6)),d=j.choices?.[0]?.delta||{};
      text=typeof d.qisuo_full_text==='string'?d.qisuo_full_text:text+(d.content||'');finish=j.choices?.[0]?.finish_reason||finish;
    }
    assert.equal(text,'开头。补回中间段。末尾。');assert.equal(finish,'stop');assert(out.includes('data: [DONE]'));assert(res.writableEnded);
  } finally {globalThis.fetch=oldFetch;if(oldDir==null)delete process.env.DATA_DIR;else process.env.DATA_DIR=oldDir;await rm(dir,{recursive:true,force:true});}
});
