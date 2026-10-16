// 子进程运行完整截图命令，记录临时端口；正常及 SIGTERM 后验证端口已关闭。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'preview-lifecycle-'));
  const hook = path.join(temp,'hook.cjs');
  fs.writeFileSync(hook, `const http=require('node:http'); const original=http.createServer; http.createServer=function(...args){const server=original(...args);server.on('listening',()=>process.send?.({port:server.address().port}));return server;};`);
  try {
    for (const cancel of [false,true]) {
      let port;
      const child = fork('scripts/ui-preview.cjs',['--task',cancel?'lifecycle-cancel':'lifecycle','--views','phone','--themes','light'],{execArgv:['--require',hook],silent:true});
      const limit = setTimeout(() => child.kill('SIGTERM'),110000);
      child.stdout.resume(); child.stderr.resume();
      child.on('message', value => { port=value.port; if(cancel) child.kill('SIGTERM'); });
      const [code,signal] = await new Promise((resolve,reject) => {child.on('error',reject);child.on('exit',(code,signal)=>resolve([code,signal]));});
      clearTimeout(limit);
      assert(port,'临时服务未启动'); if (cancel) assert(code === 130 || signal === 'SIGTERM', `中断状态异常：${code}/${signal}`); else assert.equal(code,0);
      await new Promise((resolve,reject) => {
        const socket=net.connect(port,'127.0.0.1');
        socket.on('connect',()=>{socket.destroy();reject(Error('预览端口仍然开放'));});
        socket.on('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));
      });
    }
    console.log('通过：完整预览正常退出和 SIGTERM 中断后，临时端口均拒绝连接');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
