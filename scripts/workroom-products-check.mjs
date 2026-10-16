import assert from 'node:assert/strict';
import { productText } from '../src/lib/workroomProducts.js';
const files=[{name:'phone-light.png'},{name:'tablet-dark.png'}];
const links='[手机](/work/project/.qisuo-previews/task/run/phone-light.png)\n- [平板](/work/project/.qisuo-previews/task/run/tablet-dark.png)';
assert.equal(productText(links,files),'截图见本轮「任务产物」。');
assert.equal(productText(links,[]),links);
const code='正文\n```md\n'+links+'\n```\n[代码](/work/project/src/app.js)';
assert.equal(productText(code,files),code);
console.log('通过：已回传截图的重复链接折叠，未收取文件/正文/代码原样保留');
