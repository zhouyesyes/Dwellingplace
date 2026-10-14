const assert = require("node:assert");
const { add, double } = require("./math.js");
assert.strictEqual(add(2, 3), 5, "add(2, 3) 应该是 5");
assert.strictEqual(double(4), 8, "double(4) 应该是 8");
console.log("全部通过");
