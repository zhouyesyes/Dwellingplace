#!/usr/bin/env bash
# 在你自己的服务器上放一份栖所：网页从这里打开，API 也从这里转发（国内不开梯子也能用 OpenRouter）。
#
# 用法（在服务器的终端里粘贴这一行）：
#   bash <(curl -fsSL https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/qisuo-server/setup.sh)
#
# 以后栖所更新了，再运行同一行就会更新（口令、端口不变）。
set -euo pipefail

REPO="https://github.com/zhouyesyes/Dwellingplace.git"
DIR="$HOME/qisuo-server"

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ask() { # ask 变量名 "问题" "默认值"
  local __v __d="${3:-}"
  if [ -n "$__d" ]; then read -r -p "$2 [$__d]: " __v </dev/tty; else read -r -p "$2: " __v </dev/tty; fi
  printf -v "$1" '%s' "${__v:-$__d}"
}
need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少 $1，请先安装"; exit 1; }; }
need docker; need curl; need openssl
SUDO=""; docker ps >/dev/null 2>&1 || SUDO="sudo"

mkdir -p "$DIR"; cd "$DIR"
if [ -f settings.env ]; then
  # shellcheck disable=SC1091
  . ./settings.env
  say "更新栖所服务器（口令、端口、网址不变）"
else
  say "在这台服务器上放一份栖所"
  ask PORT "1. 端口（不和别的冲突就行）" "18200"
  ask DOMAIN "2. 栖所的网址（比如 app.qisuo.xyz，不要写 https://）" ""
  DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN%%/*}
  [ -n "$DOMAIN" ] || { echo "网址不能为空"; exit 1; }
  TOKEN=$(openssl rand -hex 16)
  printf 'PORT=%s\nDOMAIN=%s\nTOKEN=%s\n' "$PORT" "$DOMAIN" "$TOKEN" > settings.env
  chmod 600 settings.env
fi

cat > Dockerfile <<'DOCKER'
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ARG REPO
ARG CACHEBUST=1
RUN git clone --depth 1 "$REPO" /src
WORKDIR /src
RUN npm ci --no-audit --no-fund && npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /src/dist /app/dist
COPY --from=build /src/deploy/qisuo-server/server.mjs /app/server.mjs
ENV PORT=8080 DIST=/app/dist
CMD ["node", "/app/server.mjs"]
DOCKER

say "下载最新的栖所并构建（第一次要几分钟）…"
$SUDO docker build --build-arg REPO="$REPO" --build-arg CACHEBUST="$(date +%s)" -t qisuo-server .

say "启动…"
$SUDO docker rm -f qisuo-server >/dev/null 2>&1 || true
$SUDO docker run -d --name qisuo-server --restart unless-stopped \
  -p "127.0.0.1:$PORT:8080" -e PROXY_TOKEN="$TOKEN" qisuo-server >/dev/null

ok=""
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || { say "没启动起来，看看日志："; $SUDO docker logs --tail 30 qisuo-server; exit 1; }

say "试试从这台服务器连 OpenRouter…"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "http://127.0.0.1:$PORT/p/$TOKEN/openrouter/v1/models" || true)
if [ "$code" = "200" ]; then echo "  连得上 ✓"; else echo "  没连上（返回 $code）。网页照样能用，API 转发可能不行，把这句截图给我。"; fi

# 心潮只接受认识的网页来连：把新网址加进去
for d in "$HOME"/xinchao-*/; do
  [ -f "$d/.env" ] || continue
  grep -q "^DASHBOARD_ALLOWED_ORIGINS=.*https://$DOMAIN" "$d/.env" && continue
  if grep -q "^DASHBOARD_ALLOWED_ORIGINS=" "$d/.env"; then
    sed -i "s|^DASHBOARD_ALLOWED_ORIGINS=\(.*\)|DASHBOARD_ALLOWED_ORIGINS=\1,https://$DOMAIN|" "$d/.env"
  else
    echo "DASHBOARD_ALLOWED_ORIGINS=https://$DOMAIN" >> "$d/.env"
  fi
  say "让 $(basename "$d") 认识新网址，重启它…"
  (cd "$d" && $SUDO docker compose up -d) || echo "  重启没成功：之后在 $d 里运行 $SUDO docker compose up -d"
done

INFO="$DIR/栖所服务器信息.txt"
cat > "$INFO" <<INFO_EOF
【还差一步：在 Cloudflare 隧道里加一条】
  Cloudflare → Zero Trust → 网络 → 隧道 → 你装心潮时建的那条 → 公共主机名 → 添加
  子域：${DOMAIN%%.*}　域：${DOMAIN#*.}　服务类型：HTTP　URL：localhost:$PORT
  加好后手机打开 https://$DOMAIN/health 看到 "ok":true 就通了

【栖所网页】
  https://$DOMAIN
  （这是新网址：数据要从旧的搬过来，见下面）

【API 不开梯子：在栖所「设置 → API」里把接口地址换成】
  OpenRouter：https://$DOMAIN/p/$TOKEN/openrouter/v1
  OpenAI：    https://$DOMAIN/p/$TOKEN/openai/v1
  DeepSeek：  https://$DOMAIN/p/$TOKEN/deepseek/v1
  Claude：    https://$DOMAIN/p/$TOKEN/anthropic
  Key 不用改。地址里那串是转发口令，别发给别人。

【把数据搬过来】
  1. 在旧的栖所（zhouyesyes.github.io）：设置 → 备份 → 导出
  2. 在新网址打开栖所：设置 → 备份 → 导入刚才的文件
  3. 新网址要重新「添加到主屏幕」，推送通知也要在唤醒页重新打开一次

【以后更新栖所】
  再运行一次安装那一行就行
INFO_EOF
chmod 600 "$INFO"
say "好了！"
cat "$INFO"
echo
echo "以上内容存在：$INFO"
