#!/bin/sh
# 先开浏览器（登录状态存在 /profile 里，重启也还在），再开 bridge；浏览器挂了就重新开
# 栖所服务器在 /profile 里放一个 .reset：关掉浏览器、清空所有登录，再重新开（换账号用）
rm -f /profile/SingletonLock /profile/SingletonSocket /profile/SingletonCookie
browser() {
  while true; do
    if [ -f /profile/.reset ]; then
      echo "清空浏览器（退出所有登录）"
      find /profile -mindepth 1 -delete 2>/dev/null || true
    fi
    chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
      --no-first-run --disable-sync --disable-background-networking --disable-component-update --disable-features=PushMessaging,Translate \
      --user-data-dir=/profile --lang=zh-CN --window-size=1280,1600 \
      --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223 \
      --remote-allow-origins=http://127.0.0.1:9223 \
      --user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" \
      about:blank &
    pid=$!
    # 浏览器开着的时候，每两秒看一眼有没有人要清空
    while kill -0 "$pid" 2>/dev/null; do
      if [ -f /profile/.reset ]; then kill "$pid"; wait "$pid" 2>/dev/null; break; fi
      sleep 2
    done
    [ -f /profile/.reset ] || { echo "浏览器退出了，2 秒后重开"; sleep 2; }
  done
}
browser &
sleep 3
cd /bridge && exec python chrome_mcp_bridge.py
