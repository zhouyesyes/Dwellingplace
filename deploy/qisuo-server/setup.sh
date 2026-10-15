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

mkdir -p "$DIR/data"; chmod 700 "$DIR/data"; cd "$DIR"
if [ -f settings.env ]; then
  # shellcheck disable=SC1091
  . ./settings.env
  say "更新栖所服务器（口令、端口、网址不变）"
else
  say "在这台服务器上放一份栖所"
  ask PORT "1. 端口（不和别的冲突就行）" "18200"
  ask DOMAIN "2. 栖所的网址（比如 app.example.com，不要写 https://）" ""
  DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN%%/*}
  [ -n "$DOMAIN" ] || { echo "网址不能为空"; exit 1; }
  TOKEN=$(openssl rand -hex 16)
  printf 'PORT=%s\nDOMAIN=%s\nTOKEN=%s\n' "$PORT" "$DOMAIN" "$TOKEN" > settings.env
  chmod 600 settings.env
fi

# 他的浏览器：第一次问一下装不装（以后不再问；想改就编辑 settings.env 里的 CHROME=y / n）
if [ -z "${CHROME:-}" ]; then
  ask CHROME "要给他装一个浏览器吗？能打开网页、看网页里的图（大约多占 500MB 内存）y / n" "y"
  case "$CHROME" in [Yy]*) CHROME=y ;; *) CHROME=n ;; esac
  echo "CHROME=$CHROME" >> settings.env
fi
# 工作间（Codex 在服务器上写代码、跑命令）：第一次问一下（以后不再问；想改就编辑 settings.env 里的 CODEX=y / n）
if [ -z "${CODEX:-}" ]; then
  ask CODEX "要装工作间吗？他可以叫 Codex 在服务器上一个单独的沙盒里写代码、跑命令（大约多占 300MB 内存，用你的 ChatGPT 额度）y / n" "n"
  case "$CODEX" in [Yy]*) CODEX=y ;; *) CODEX=n ;; esac
  echo "CODEX=$CODEX" >> settings.env
fi
if [ "$CODEX" = "y" ] && [ -z "${CODEX_KEY:-}" ]; then
  CODEX_KEY=$(openssl rand -hex 24)
  echo "CODEX_KEY=$CODEX_KEY" >> settings.env
fi
# 工作间连 GitHub 上栖所的仓库：第一次问一下（以后不再问；想改就编辑 settings.env 里的 CODEX_GITHUB=y / n）
if [ "$CODEX" = "y" ] && [ -z "${CODEX_GITHUB:-}" ]; then
  ask CODEX_GITHUB "要把栖所的代码放进工作间吗？Codex 能在里面改栖所、本地提交；推上线要你在工作间里点（要一把只管这一个仓库的 GitHub 钥匙）y / n" "y"
  case "$CODEX_GITHUB" in [Yy]*) CODEX_GITHUB=y ;; *) CODEX_GITHUB=n ;; esac
  echo "CODEX_GITHUB=$CODEX_GITHUB" >> settings.env
fi
CODEX_VERSION="0.162.1"
BRIDGE_REF="8db89c1a3c516a8ae7ddeb7adb070c98caafe3f2" # chrome-mcp-bridge 2.4.1
$SUDO docker network create qisuo-net >/dev/null 2>&1 || true

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
COPY --from=build /src/deploy/qisuo-server/chatgpt.mjs /app/chatgpt.mjs
COPY --from=build /src/deploy/qisuo-server/sync.mjs /app/sync.mjs
COPY --from=build /src/deploy/qisuo-server/devices.mjs /app/devices.mjs
COPY --from=build /src/deploy/qisuo-server/preview.mjs /app/preview.mjs
ENV PORT=8080 DIST=/app/dist DATA_DIR=/app/data
CMD ["node", "/app/server.mjs"]
DOCKER

say "下载最新的栖所并构建（第一次要几分钟）…"
$SUDO docker build --build-arg REPO="$REPO" --build-arg CACHEBUST="$(date +%s)" -t qisuo-server .

CHROME_ENV=""
if [ "$CHROME" = "y" ]; then
  say "装他的浏览器（第一次要几分钟）…"
  mkdir -p chrome "$DIR/chrome-profile"
  RAW="https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/qisuo-server/chrome"
  curl -fsSL "$RAW/Dockerfile" -o chrome/Dockerfile && curl -fsSL "$RAW/start.sh" -o chrome/start.sh && curl -fsSL "$RAW/remote.py" -o chrome/remote.py
  $SUDO docker build --build-arg BRIDGE_REF="$BRIDGE_REF" -t qisuo-chrome chrome
  $SUDO docker rm -f qisuo-chrome >/dev/null 2>&1 || true
  # 不开任何端口：只有栖所服务器在内部网络里能连到它
  $SUDO docker run -d --name qisuo-chrome --restart unless-stopped --network qisuo-net \
    --memory 1500m --shm-size 512m -v "$DIR/chrome-profile:/profile" qisuo-chrome >/dev/null
  CHROME_ENV="-e CHROME_URL=http://qisuo-chrome:9224 -e CHROME_CTL_URL=http://qisuo-chrome:9225 -e CHROME_PROFILE=/chrome-profile -v $DIR/chrome-profile:/chrome-profile"
else
  $SUDO docker rm -f qisuo-chrome >/dev/null 2>&1 || true
fi

CODEX_ENV=""
if [ "$CODEX" = "y" ]; then
  say "装工作间（Codex $CODEX_VERSION，第一次要几分钟）…"
  mkdir -p codex "$DIR/codex-home" "$DIR/codex-work" "$DIR/codex-bridge" "$DIR/codex-gate"
  RAW="https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/qisuo-server/codex"
  for f in Dockerfile Dockerfile.gate bridge.mjs gate.mjs; do curl -fsSL "$RAW/$f" -o "codex/$f"; done
  $SUDO docker build -q --build-arg CODEX_VERSION="$CODEX_VERSION" -t qisuo-codex codex >/dev/null
  $SUDO docker build -q -f codex/Dockerfile.gate -t qisuo-codex-gate codex >/dev/null
  # 实测时已经登录过：把登录搬过来，不用再输一次码
  if [ ! -f "$DIR/codex-home/auth.json" ] && [ -f "$HOME/codex-lab/codex-home/auth.json" ]; then cp -a "$HOME/codex-lab/codex-home/." "$DIR/codex-home/"; fi
  $SUDO chown -R 1001:1001 "$DIR/codex-home" "$DIR/codex-work"
  $SUDO chown -R 1000:1000 "$DIR/codex-gate"
  # Codex 自己的默认：不套隔离罩（容器里套不上）。toml 的顶层设置要写在表前面，所以加在文件最前面
  # 审批不写在这里：这个版本的 Codex 不认 approval_policy = "untrusted"，写了就起不来（审批由连接程序开线程时带上）
  CFG="$DIR/codex-home/config.toml"
  $SUDO sed -i '/^approval_policy = /d' "$CFG" 2>/dev/null || true
  if ! $SUDO grep -q '^sandbox_mode' "$CFG" 2>/dev/null; then
    { printf 'sandbox_mode = "danger-full-access"\n\n'; $SUDO cat "$CFG" 2>/dev/null; } > "$DIR/config.toml.new"
    $SUDO mv "$DIR/config.toml.new" "$CFG"
    $SUDO chown 1001:1001 "$CFG"
  fi
  # 工作间的附件放这里：归 root、Codex 只能读。连接程序被拿掉了越权写的本事，自己建不了，得在这里先建好（上面的 chown 之后）
  $SUDO mkdir -p "$DIR/codex-work/.qisuo-attachments"
  $SUDO chown -R 0:0 "$DIR/codex-work/.qisuo-attachments"
  $SUDO chmod 755 "$DIR/codex-work/.qisuo-attachments"
  chmod 700 "$DIR/codex-home" "$DIR/codex-bridge"
  # 栖所的代码：克隆一份到项目「栖所」（公开仓库，拉不用钥匙）；推上线的钥匙放在 codex-bridge 里，Codex 读不到
  GATE_LIST="${GATE_ALLOW:-}"
  if [ "${CODEX_GITHUB:-n}" = "y" ]; then
    GATE_LIST="github.com,registry.npmjs.org${GATE_LIST:+,$GATE_LIST}"
    if [ ! -d "$DIR/codex-work/栖所/.git" ]; then
      if [ -d "$DIR/codex-work/栖所" ] && [ -n "$(ls -A "$DIR/codex-work/栖所")" ]; then
        echo "codex-work/栖所 已经有东西了（不是仓库），先不克隆；想要的话把这个文件夹挪走再运行一次"
      else
        say "把栖所的代码放进工作间…"
        rmdir "$DIR/codex-work/栖所" 2>/dev/null || true
        $SUDO docker run --rm --user 1001:1001 -v "$DIR/codex-work:/work" qisuo-codex git clone -q "$REPO" "/work/栖所"
      fi
    fi
    if [ ! -s "$DIR/codex-bridge/github-token" ]; then
      cat <<'TXT'

  要一把 GitHub 钥匙（只管栖所这一个仓库）：
    1. 手机或电脑打开 https://github.com/settings/personal-access-tokens/new
    2. Token name 随便写（比如 qisuo-workroom）；Expiration 选一个期限（比如 90 天）
    3. Repository access 选 Only select repositories → 只选 zhouyesyes/Dwellingplace
    4. Permissions → Repository permissions → Contents 选 Read and write（别的都不用动）
    5. 点 Generate token，复制那串 github_pat_ 开头的字
  钥匙只粘贴在下面这里，不要发给任何人（包括 cc）。现在不想弄就直接按回车，以后再运行一次安装那一行。
TXT
      read -r -s -p "  粘贴钥匙（输入时不显示）: " GH_TOKEN </dev/tty; echo
      GH_TOKEN=$(printf '%s' "$GH_TOKEN" | tr -d '[:space:]')
      if [ -n "$GH_TOKEN" ]; then
        info=$(curl -s -m 20 -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/repos/zhouyesyes/Dwellingplace || true)
        if printf '%s' "$info" | grep -q '"push": *true'; then
          ( umask 077; printf '%s' "$GH_TOKEN" > "$DIR/codex-bridge/github-token" )
          echo "  钥匙放好了 ✓（能推栖所的仓库）"
        else
          echo "  这把钥匙不对，或者没有 Contents 的写权限，没放；检查一下再运行一次安装那一行"
        fi
      fi
      unset GH_TOKEN info
    fi
  fi
  # 单独的内部网络：Codex 在这里面自己出不了网；门卫一只脚在里面、一只脚在外面，只放行 OpenAI
  $SUDO docker network create --internal codex-int >/dev/null 2>&1 || true
  $SUDO docker rm -f qisuo-codex qisuo-codex-gate >/dev/null 2>&1 || true
  $SUDO docker run -d --name qisuo-codex-gate --restart unless-stopped --network codex-int \
    --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m \
    -e GATE_ALLOW="$GATE_LIST" -v "$DIR/codex-gate:/gate" qisuo-codex-gate >/dev/null
  $SUDO docker network connect bridge qisuo-codex-gate
  # Codex：根目录只读；只有项目（/work）、它的登录目录、临时目录能写；不用 root 跑命令；去掉全部特权（只留降成 codex 用户要的两个）
  $SUDO docker run -d --name qisuo-codex --restart unless-stopped --network codex-int \
    --read-only --tmpfs /tmp:rw,size=512m --tmpfs /home/codex:rw,size=256m,uid=1001,gid=1001 \
    --cap-drop ALL --cap-add SETUID --cap-add SETGID --security-opt no-new-privileges \
    --memory 2g --cpus 2 --pids-limit 512 --shm-size 256m \
    -e BRIDGE_KEY="$CODEX_KEY" -e HTTPS_PROXY=http://qisuo-codex-gate:3128 -e HTTP_PROXY=http://qisuo-codex-gate:3128 \
    -v "$DIR/codex-home:/home/codex/.codex" -v "$DIR/codex-work:/work" -v "$DIR/codex-bridge:/bridge" qisuo-codex >/dev/null
  CODEX_ENV="-e CODEX_URL=http://qisuo-codex:7700 -e CODEX_KEY=$CODEX_KEY"
else
  $SUDO docker rm -f qisuo-codex qisuo-codex-gate >/dev/null 2>&1 || true
fi

say "启动…"
$SUDO docker rm -f qisuo-server >/dev/null 2>&1 || true
# shellcheck disable=SC2086
$SUDO docker run -d --name qisuo-server --restart unless-stopped --network qisuo-net \
  -p "127.0.0.1:$PORT:8080" -e PROXY_TOKEN="$TOKEN" $CHROME_ENV $CODEX_ENV -v "$DIR/data:/app/data" qisuo-server >/dev/null
# 工作间：栖所服务器也进 Codex 的内部网络，才找得到它
[ "$CODEX" = "y" ] && $SUDO docker network connect codex-int qisuo-server

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

if [ "$CODEX" = "y" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "http://127.0.0.1:$PORT/p/$TOKEN/codex/status" || true)
  if [ "$code" = "200" ]; then CODEX_INFO="已安装（连得上 ✓）：栖所里的工作间还在做，做好了从那里进"; else CODEX_INFO="已安装，但现在连不上（返回 $code），把这句截图给 cc"; fi
  if [ "${CODEX_GITHUB:-n}" = "y" ]; then
    if [ -s "$DIR/codex-bridge/github-token" ]; then CODEX_INFO="$CODEX_INFO
  栖所的代码在项目「栖所」里；GitHub 钥匙放好了（推上线在工作间里点）"; else CODEX_INFO="$CODEX_INFO
  栖所的代码在项目「栖所」里；还没放 GitHub 钥匙（推不上线），再运行一次安装那一行按提示放"; fi
  fi
else CODEX_INFO="没装（想装：把 settings.env 里的 CODEX=n 改成 y，再运行一次安装那一行）"; fi
if [ "$CHROME" = "y" ]; then CHROME_INFO="已安装：在栖所「设置 → 工具 → 浏览器」点「接上浏览器」"
else CHROME_INFO="没装（想装：把 settings.env 里的 CHROME=n 改成 y，再运行一次安装那一行）"; fi
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
  ChatGPT 会员：https://$DOMAIN/p/$TOKEN/chatgpt/v1（Key 随便填，比如 plan；填好后在这条 API 里点「用 ChatGPT 登录」）
  Key 不用改。地址里那串是转发口令，别发给别人。

【多设备同步：每台设备的栖所「设置 → 同步」里填】
  https://$DOMAIN/p/$TOKEN/sync

【他的浏览器】
  $CHROME_INFO

【工作间（Codex）】
  $CODEX_INFO
  项目文件夹在服务器的 $DIR/codex-work 里；他想去的、被门卫拦下的网站记在 $DIR/codex-gate/denied.log
  门卫要多放行哪个网站：在 settings.env 里加一行 GATE_ALLOW=registry.npmjs.org（逗号隔开），再运行一次安装那一行

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
