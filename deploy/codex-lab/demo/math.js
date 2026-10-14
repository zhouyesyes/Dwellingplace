// 几个算数的小函数
function add(a, b) {
  return a - b; // 故意写错的：实测时让 Codex 来修
}
function double(n) {
  return n * 2;
}
module.exports = { add, double };
