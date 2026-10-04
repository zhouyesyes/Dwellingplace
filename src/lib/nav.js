// 返回上一页；如果是直接打开的页面（没有上一页），就回到指定页面
export function goBack(router, fallback) {
  if (window.history.state?.back) router.back();
  else router.replace(fallback);
}
