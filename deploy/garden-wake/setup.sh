#!/usr/bin/env bash
# 给一个 AI 装上「花园唤醒桥」：游戏轮到 TA 时，花园马上通知 → 栖所的中转把 TA 叫醒。
#
# 用法（在装心潮的那台服务器的终端里粘贴这一行；每个 AI 运行一次）：
#   bash <(curl -fsSL https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/garden-wake/setup.sh)
#
# 唤醒桥是 WenXiaoWendy/galatea-garden-wake-bridge。它的规矩：连接断了就停，不自动重连、不自动重启。
# 所以这里也不设自动重启；停了就照提示手动再开一次（先查清楚为什么停）。
set -euo pipefail

BRIDGE_REPO="https://github.com/WenXiaoWendy/galatea-garden-wake-bridge.git"
INJECTOR_URL="https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/garden-wake/inject-qisuo.mjs"
BASE="$HOME/garden-wake"

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ask() { local __v __d="${3:-}"; if [ -n "$__d" ]; then read -r -p "$2 [$__d]: " __v </dev/tty; else read -r -p "$2: " __v </dev/tty; fi; printf -v "$1" '%s' "${__v:-$__d}"; }
secret() { local __v; read -r -s -p "$2: " __v </dev/tty; echo; printf -v "$1" '%s' "$__v"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少 $1，请先安装"; exit 1; }; }
need git; need curl; need docker
SUDO=""; docker ps >/dev/null 2>&1 || SUDO="sudo"

say "装花园唤醒桥（每个 AI 装一次）"
ask NAME "1. 这一份的英文代号（只用小写字母，比如 xin / ji）" "xin"
NAME=$(echo "$NAME" | tr -cd 'a-z0-9'); [ -n "$NAME" ] || { echo "代号不能为空"; exit 1; }
echo "2. 花园给这个 AI 的「机器令牌」：在花园 Me 页开启「游戏行动通知」后能看到（输入时不显示）"
secret GTOKEN "   机器令牌"
ask RELAY "3. 栖所的中转地址（栖所 → 设置 → 工具 → 中转地址）" ""
secret RTOKEN "4. 中转密码（输入时不显示）"
ask ROLE "5. 这个 AI 在栖所里的编号（栖所 → 设置 → 唤醒 → 点这个 AI，最下面有「编号」）" ""
[ -n "$GTOKEN" ] && [ -n "$RELAY" ] && [ -n "$RTOKEN" ] && [ -n "$ROLE" ] || { echo "有一项没填，重新运行一次吧"; exit 1; }

say "下载唤醒桥、做成镜像（第一次要几分钟）"
mkdir -p "$BASE"; chmod 700 "$BASE"
if [ -d "$BASE/bridge/.git" ]; then git -C "$BASE/bridge" pull -q; else git clone -q --depth 1 "$BRIDGE_REPO" "$BASE/bridge"; fi
curl -fsSL "$INJECTOR_URL" -o "$BASE/bridge/inject-qisuo.mjs"
cat > "$BASE/bridge/Dockerfile.qisuo" <<'DOCKER'
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci && npm run build
CMD ["node", "dist/cli.js", "run"]
DOCKER
$SUDO docker build -q -f "$BASE/bridge/Dockerfile.qisuo" -t qisuo-garden-wake "$BASE/bridge" >/dev/null

ENVF="$BASE/$NAME.env"
umask 077
cat > "$ENVF" <<ENV
GARDEN_MACHINE_TOKEN=$GTOKEN
GARDEN_INJECTOR_EXECUTABLE=/usr/local/bin/node
GARDEN_INJECTOR_ARGS_JSON=["/app/inject-qisuo.mjs"]
GARDEN_LOG_LEVEL=info
QISUO_RELAY_URL=$RELAY
QISUO_RELAY_TOKEN=$RTOKEN
QISUO_ROLE_ID=$ROLE
ENV

# 手动开启用的小脚本：先 check，通过了再 run；不自动重启
cat > "$BASE/start-$NAME.sh" <<START
#!/usr/bin/env bash
set -e
$SUDO docker rm -f garden-wake-$NAME >/dev/null 2>&1 || true
echo "先检查连接……"
$SUDO docker run --rm --env-file "$ENVF" qisuo-garden-wake node dist/cli.js check
echo "检查通过，开始运行（断了会停，不会自己重连）"
$SUDO docker run -d --name garden-wake-$NAME --restart no --env-file "$ENVF" qisuo-garden-wake >/dev/null
echo "开好了。看情况：$SUDO docker logs --tail 30 garden-wake-$NAME"
START
chmod 700 "$BASE/start-$NAME.sh"

say "检查并开启"
bash "$BASE/start-$NAME.sh"

say "装好了"
cat <<DONE
以后：
  看它在不在跑：   $SUDO docker ps --filter name=garden-wake-$NAME
  看它最近的记录： $SUDO docker logs --tail 30 garden-wake-$NAME
  它停了（连接断了会停）：先看记录里写的原因，处理好以后再手动开一次：
                   bash $BASE/start-$NAME.sh
注意：不要给它设自动重启——花园规定断了就停、由人来重新开，反复自动重连会被封。
另一个 AI 再运行一次这个安装命令，用另一个代号。
DONE
