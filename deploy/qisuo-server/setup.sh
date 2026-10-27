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

# 构建镜像：不刷屏。进度用 plain（每步只打新的一行，不原地刷新），完整输出存进日志，屏幕上只留每一步的标题；失败时把日志末尾原样打出来
build_quiet() { # build_quiet 说明 docker-build 的参数…
  local what="$1" log rc; shift
  log=$(mktemp)
  set +e
  BUILDKIT_PROGRESS=plain $SUDO docker build --progress=plain "$@" >"$log" 2>&1
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    grep -E '^#[0-9]+ \[' "$log" | sed -E 's/^#[0-9]+ //' | awk '!seen[$0]++' | cut -c1-90 | sed 's/^/  /'
    echo "  $what 构建成功 ✓"
    rm -f "$log"
  else
    say "$what 构建失败，下面是最后的报错（完整日志在 $log）："
    tail -n 60 "$log"
    exit 1
  fi
}

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
# 小螃蟹（cc，Claude Code）：第一次问一下接不接（以后不再问；想改就编辑 settings.env 里的 CLAUDE=y / n）
if [ -z "${CLAUDE:-}" ]; then
  ask CLAUDE "要让小螃蟹（Claude Code，用你的 Claude 订阅）住进栖所吗？y / n" "y"
  case "$CLAUDE" in [Yy]*) CLAUDE=y ;; *) CLAUDE=n ;; esac
  echo "CLAUDE=$CLAUDE" >> settings.env
fi
# 工作间已经拆掉了：settings.env 里以前记的工作间设置也清掉
sed -i -E '/^(CODEX|CODEX_KEY|CODEX_GITHUB|GATE_ALLOW)=/d' settings.env
BRIDGE_REF="8db89c1a3c516a8ae7ddeb7adb070c98caafe3f2" # chrome-mcp-bridge 2.4.1
$SUDO docker network create qisuo-net >/dev/null 2>&1 || true

cat > Dockerfile <<'DOCKER'
# 构建顺序按「多久变一次」排：最不爱变的放前面，这样重跑安装时前面的层直接用缓存
# 第一段：只装依赖。依赖清单（package-lock.json）没变，这一段就整段用缓存，不用再 npm ci
FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ARG REPO
ARG LOCKHASH=0
RUN echo "依赖指纹 $LOCKHASH" && git clone --depth 1 "$REPO" /clone && mkdir /deps && cp /clone/package.json /clone/package-lock.json /deps/ \
 && cd /deps && npm ci --no-audit --no-fund && rm -rf /clone /root/.npm

# 第二段：拉最新代码、构建网页（每次都重做，只有这一步是必须的）
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ARG REPO
ARG CACHEBUST=1
RUN echo "$CACHEBUST" >/dev/null && git clone --depth 1 "$REPO" /src
WORKDIR /src
COPY --from=deps /deps/node_modules /src/node_modules
RUN npm run build

# 第三段：真正运行的镜像。只装运行要用的（git、小螃蟹），最后才放会变的网页和程序文件
FROM node:22-slim
WORKDIR /app
# 小螃蟹：Claude Code（登录用的 token 不在镜像里，启动时从 claude.env 给）；git 给小螃蟹拉对话本用
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
# CLAUDE_WEEK 每周变一次：每周顺带更新一次小螃蟹，其余时候直接用缓存
ARG CLAUDE_WEEK=0
RUN echo "第 $CLAUDE_WEEK 周" && npm install -g @anthropic-ai/claude-code --no-audit --no-fund && npm cache clean --force && rm -rf /root/.npm
ENV PORT=8080 DIST=/app/dist DATA_DIR=/app/data DISABLE_AUTOUPDATER=1
CMD ["node", "/app/server.mjs"]
COPY --from=build /src/deploy/qisuo-server/*.mjs /app/
COPY --from=build /src/dist /app/dist
DOCKER

# 依赖清单的指纹：没变就让 npm ci 那一层吃缓存（取不到就用当前时间，等于不用缓存，照样能装）
RAW_MAIN="https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main"
LOCKHASH=$( { curl -fsSL -m 20 "$RAW_MAIN/package-lock.json" && curl -fsSL -m 20 "$RAW_MAIN/package.json"; } | sha256sum | cut -c1-16 ) || LOCKHASH=""
[ -n "$LOCKHASH" ] && [ "$LOCKHASH" != "e3b0c44298fc1c14" ] || LOCKHASH="$(date +%s)"

say "下载最新的栖所并构建（第一次要几分钟）…"
build_quiet "栖所" --build-arg REPO="$REPO" --build-arg CACHEBUST="$(date +%s)" --build-arg LOCKHASH="$LOCKHASH" --build-arg CLAUDE_WEEK="$(date +%G%V)" -t qisuo-server .

CHROME_ENV=""
if [ "$CHROME" = "y" ]; then
  say "装他的浏览器（第一次要几分钟）…"
  mkdir -p chrome "$DIR/chrome-profile"
  RAW="https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/qisuo-server/chrome"
  curl -fsSL "$RAW/Dockerfile" -o chrome/Dockerfile && curl -fsSL "$RAW/start.sh" -o chrome/start.sh && curl -fsSL "$RAW/remote.py" -o chrome/remote.py
  build_quiet "他的浏览器" --build-arg BRIDGE_REF="$BRIDGE_REF" -t qisuo-chrome chrome
  $SUDO docker rm -f qisuo-chrome >/dev/null 2>&1 || true
  # 不开任何端口：只有栖所服务器在内部网络里能连到它
  $SUDO docker run -d --name qisuo-chrome --restart unless-stopped --network qisuo-net \
    --memory 1500m --shm-size 512m -v "$DIR/chrome-profile:/profile" qisuo-chrome >/dev/null
  CHROME_ENV="-e CHROME_URL=http://qisuo-chrome:9224 -e CHROME_CTL_URL=http://qisuo-chrome:9225 -e CHROME_PROFILE=/chrome-profile -v $DIR/chrome-profile:/chrome-profile"
else
  $SUDO docker rm -f qisuo-chrome >/dev/null 2>&1 || true
fi

# 工作间已经拆掉了：以前装过的话，把它的容器、镜像、内部网络一起拿掉（文件夹留着，删不删你定，见 docs/worklog.md）
$SUDO docker rm -f qisuo-codex qisuo-codex-gate >/dev/null 2>&1 || true
$SUDO docker rmi qisuo-codex qisuo-codex-gate >/dev/null 2>&1 || true

# 小螃蟹登录：只在服务器终端里做一次。token 存在 claude.env（只有你能读），不经过浏览器、不用发给任何人
CLAUDE_ENV=""
if [ "$CLAUDE" = "y" ]; then
  # 已经登录过：先试一句，不通就问要不要重新登录
  if [ -s claude.env ]; then
    if CLAUDE_TRY=$($SUDO docker run --rm --env-file claude.env -w /tmp qisuo-server claude -p "只回复 ok" --tools "" --model haiku 2>&1); then
      echo "  小螃蟹登录还好着 ✓"
    else
      echo "  小螃蟹的登录不通：$(printf '%s' "$CLAUDE_TRY" | tail -n 1 | cut -c1-200)"
      ask RELOGIN "重新给小螃蟹登录？(y/n)" "y"
      [ "$RELOGIN" = "y" ] && rm -f claude.env
    fi
  fi
  if [ ! -s claude.env ]; then
    say "给小螃蟹登录 Claude（用你的订阅，只要一次）"
    echo "  下面会显示一个链接：在手机上打开、登录 Claude、点同意，把页面上给的那串码粘回这里回车。"
    echo "  最后会打出一长串以 sk-ant-oat 开头的 token。"
    $SUDO docker run --rm -it qisuo-server claude setup-token </dev/tty || true
    read -r -s -p "把上面那串 sk-ant-oat… 的 token 粘贴在这里，回车（不会显示出来；不想现在弄就直接回车）: " CLAUDE_TOKEN </dev/tty; echo
    # 终端里一长串可能被折成几行：没粘完就接着读，空格换行都去掉
    while [ -n "$CLAUDE_TOKEN" ] && [ "${#CLAUDE_TOKEN}" -lt 100 ]; do
      read -r -s -p "  好像只粘到一半（${#CLAUDE_TOKEN} 个字）：把剩下的也粘过来回车；已经完整了就直接回车: " MORE </dev/tty; echo
      [ -z "$MORE" ] && break
      CLAUDE_TOKEN="$CLAUDE_TOKEN$MORE"
    done
    CLAUDE_TOKEN=$(printf '%s' "$CLAUDE_TOKEN" | tr -d '[:space:]')
    if [ -n "$CLAUDE_TOKEN" ]; then
      ( umask 077; printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$CLAUDE_TOKEN" > claude.env )
      if CLAUDE_TRY=$($SUDO docker run --rm --env-file claude.env -w /tmp qisuo-server claude -p "只回复 ok" --tools "" --model haiku 2>&1); then
        echo "  记好了，试了一句也通了 ✓"
      else
        echo "  记下了，但试了一句没通：$(printf '%s' "$CLAUDE_TRY" | tail -n 1 | cut -c1-200)"
        echo "  多半是 token 没粘完整。再运行一次安装那一行，选重新登录就好。"
      fi
    else
      echo "  先跳过了：以后想登录，再运行一次安装那一行。"
    fi
  fi
  [ -s claude.env ] && CLAUDE_ENV="--env-file $DIR/claude.env"

  # 小螃蟹的对话本：私人仓库 qisuo-memory 的钥匙（GitHub 上生成的、只能碰这个仓库的那把）。只在这里粘一次，存在 memory.env（只有你能读）
  if [ -n "$CLAUDE_ENV" ] && [ ! -s memory.env ]; then
    say "小螃蟹的对话本（私人仓库 qisuo-memory）"
    echo "  在 GitHub 生成一把只能碰 qisuo-memory、Contents 读写的钥匙（github_pat_ 开头），粘在这里。"
    read -r -s -p "  粘贴钥匙后回车（不会显示；不想现在弄就直接回车）: " MEM_TOKEN </dev/tty; echo
    MEM_TOKEN=$(printf '%s' "$MEM_TOKEN" | tr -d '[:space:]')
    if [ -n "$MEM_TOKEN" ]; then
      ask MEM_REPO "  仓库（你的用户名/仓库名）" "zhouyesyes/qisuo-memory"
      if curl -fsS -o /dev/null -H "Authorization: Bearer $MEM_TOKEN" "https://api.github.com/repos/$MEM_REPO/contents/"; then
        ( umask 077; printf 'CRAB_MEMORY_TOKEN=%s\nCRAB_MEMORY_REPO=%s\n' "$MEM_TOKEN" "$MEM_REPO" > memory.env )
        echo "  记好了，试了一下也能打开这个仓库 ✓"
      else
        echo "  这把钥匙打不开 $MEM_REPO：看看是不是没勾这个仓库、或者 Contents 没给读写。没记下，下次运行再粘。"
      fi
    else
      echo "  先跳过了：以后想接，再运行一次安装那一行。"
    fi
  fi
  [ -n "$CLAUDE_ENV" ] && [ -s memory.env ] && CLAUDE_ENV="$CLAUDE_ENV --env-file $DIR/memory.env"

  # 派活去云端：Claude Code 例行任务的「API 触发」地址和钥匙（在 claude.ai/code/routines 里生成的）。存在 routine.env（只有你能读）
  if [ -n "$CLAUDE_ENV" ] && [ ! -s routine.env ]; then
    say "小螃蟹派活去云端（Claude Code 例行任务的 API 触发）"
    echo "  在例行任务的 API 触发里，复制那个地址（https://api.anthropic.com/v1/claude_code/routines/…/fire）粘在这里。"
    read -r -p "  地址（不想现在弄就直接回车）: " R_URL </dev/tty
    R_URL=$(printf '%s' "$R_URL" | tr -d '[:space:]')
    case "$R_URL" in
      "") echo "  先跳过了：以后想接，再运行一次安装那一行。" ;;
      https://*) ;;
      *) R_URL="https://api.anthropic.com/v1/claude_code/routines/$R_URL/fire" ;; # 只粘了 id 也行
    esac
    if [ -n "$R_URL" ]; then
      read -r -s -p "  再粘生成的钥匙（不会显示）: " R_TOKEN </dev/tty; echo
      R_TOKEN=$(printf '%s' "$R_TOKEN" | tr -d '[:space:]')
      if [ -n "$R_TOKEN" ]; then
        ( umask 077; printf 'CRAB_ROUTINE_URL=%s\nCRAB_ROUTINE_TOKEN=%s\n' "$R_URL" "$R_TOKEN" > routine.env )
        echo "  记好了 ✓（不在这里试派一次，免得白开一个云端窗口；在栖所里让小螃蟹派第一件活就知道通没通）"
      else
        echo "  没粘钥匙，先跳过了。"
      fi
    fi
  fi
  [ -n "$CLAUDE_ENV" ] && [ -s routine.env ] && CLAUDE_ENV="$CLAUDE_ENV --env-file $DIR/routine.env"
fi

say "启动…"
$SUDO docker rm -f qisuo-server >/dev/null 2>&1 || true
$SUDO docker network rm codex-int >/dev/null 2>&1 || true # 旧的栖所服务器也连着它，拿掉服务器以后才删得掉
# shellcheck disable=SC2086
$SUDO docker run -d --name qisuo-server --restart unless-stopped --network qisuo-net \
  -p "127.0.0.1:$PORT:8080" -e PROXY_TOKEN="$TOKEN" $CHROME_ENV $CLAUDE_ENV -v "$DIR/data:/app/data" qisuo-server >/dev/null

ok=""
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || { say "没启动起来，看看日志："; $SUDO docker logs --tail 30 qisuo-server; exit 1; }

say "试试从这台服务器连 OpenRouter…"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "http://127.0.0.1:$PORT/p/$TOKEN/openrouter/v1/models" || true)
if [ "$code" = "200" ]; then echo "  连得上 ✓"; else echo "  没连上（返回 $code）。网页照样能用，API 转发可能不行，把这句截图给我。"; fi

if [ -n "$CLAUDE_ENV" ]; then CLAUDE_INFO="已登录：在栖所「设置 → 小螃蟹」点「请小螃蟹住进来」，接口地址填 https://$DOMAIN/p/$TOKEN/claude/v1"
elif [ "$CLAUDE" = "y" ]; then CLAUDE_INFO="装好了但还没登录：再运行一次安装那一行，按提示登录"
else CLAUDE_INFO="没接（想接：把 settings.env 里的 CLAUDE=n 改成 y，再运行一次安装那一行）"; fi
if [ "$CHROME" = "y" ]; then CHROME_INFO="已安装：在栖所「设置 → 工具 → 浏览器」点「接上浏览器」"
else CHROME_INFO="没装（想装：把 settings.env 里的 CHROME=n 改成 y，再运行一次安装那一行）"; fi
INFO="$DIR/栖所服务器信息.txt"
cat > "$INFO" <<INFO_EOF
【还差一步：在 Cloudflare 隧道里加一条】
  Cloudflare → Zero Trust → 网络 → 隧道 → 你的那条隧道 → 公共主机名 → 添加
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

【小螃蟹（Claude Code）】
  $CLAUDE_INFO
  用的是你的 Claude 订阅额度，和 Claude 网页、Claude Code 共用

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
