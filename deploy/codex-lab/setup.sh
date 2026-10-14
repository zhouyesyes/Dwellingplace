#!/usr/bin/env bash
# 工作间实测：在单独的容器里装好 Codex（固定版本），登录你的 ChatGPT，跑三个小任务，写一份报告。
# 不动栖所：单独的文件夹（~/codex-lab）、单独的容器、单独的网络；容器里只放一个练习用的小项目。
#
# 用法（在服务器的终端里粘贴这一行）：
#   bash <(curl -fsSL https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/codex-lab/setup.sh)
#
# 跑完把 ~/codex-lab/work/report.txt 整个复制给 cc（里面没有邮箱和令牌）。
# 再跑一次：登录还在，会直接跑测试（练习项目会还原）。不想要了：rm -rf ~/codex-lab && docker rmi codex-lab
set -euo pipefail

CODEX_VERSION="0.162.1"
RAW="${RAW:-https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/codex-lab}"
DIR="$HOME/codex-lab"

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少 $1，请先安装"; exit 1; }; }
need docker; need curl
SUDO=""; docker ps >/dev/null 2>&1 || SUDO="sudo"

# 上一次的容器还在跑（按 Ctrl+C 只停了脚本，没停容器）：先停掉，免得撞名字、也免得两次一起改文件
$SUDO docker rm -f codex-lab >/dev/null 2>&1 || true

say "1/4 准备文件夹（$DIR）"
mkdir -p "$DIR/codex-home" "$DIR/work"
cd "$DIR"
curl -fsSL "$RAW/probe.mjs" -o probe.mjs
# 练习项目：每次都还原成原样（math.js 里有个故意写错的地方）
rm -rf work/demo work/logs work/report.txt && mkdir -p work/demo
for f in README.md math.js test.js; do curl -fsSL "$RAW/demo/$f" -o "work/demo/$f"; done
(cd work/demo && git init -q 2>/dev/null && git add -A 2>/dev/null && git -c user.name=qisuo -c user.email=qisuo@localhost commit -qm 原样 2>/dev/null) || true

say "2/4 做容器（Codex $CODEX_VERSION，第一次要几分钟）"
cat > Dockerfile <<DOCKER
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap git ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@${CODEX_VERSION} --no-audit --no-fund
# 不用 root：容器里的「codex」这个人只能动自己的家和 /work
RUN useradd -m -u 1001 codex
COPY probe.mjs /opt/probe.mjs
USER codex
WORKDIR /work
DOCKER
[ -n "${SKIP_BUILD:-}" ] || $SUDO docker build -q -t codex-lab . >/dev/null
# 单独的网络：和栖所、浏览器那些容器不在一起
$SUDO docker network create codex-lab-net >/dev/null 2>&1 || true
$SUDO chown -R 1001:1001 "$DIR/codex-home" "$DIR/work"
chmod 700 "$DIR/codex-home"

# Codex 的沙盒（bubblewrap）要在容器里再开一层隔离：Docker 默认的规则可能不让。
# 从最严的开始试，哪个能用就用哪个（一直都去掉全部特权、禁止提权、不用 root）
BASE=(--network codex-lab-net --memory 2g --cpus 2 --pids-limit 512 --cap-drop ALL --security-opt no-new-privileges)
MODE_NAME=""; MODE=(); LAST_ERR=""
echo "  这台机器限制普通程序开隔离环境吗（Ubuntu 24.04 默认是 1）：$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo 没有这个设置)"
for m in "默认" "seccomp=unconfined" "seccomp=unconfined apparmor=unconfined"; do
  case "$m" in
    默认) try=() ;;
    "seccomp=unconfined") try=(--security-opt seccomp=unconfined) ;;
    *) try=(--security-opt seccomp=unconfined --security-opt apparmor=unconfined) ;;
  esac
  if out=$($SUDO docker run --rm "${BASE[@]}" "${try[@]}" codex-lab codex sandbox -P :workspace -C /home/codex -- true 2>&1); then
    MODE_NAME="$m"; MODE=("${try[@]}"); break
  fi
  LAST_ERR=$(printf '%s' "$out" | grep -v "bubblewrap on PATH\|PATH aliases" | tail -1)
done
CONTAINER_SANDBOX=""
if [ -z "$MODE_NAME" ]; then
  # 退路：Codex 自己的沙盒开不了，就让容器本身当沙盒——根目录只读，只有 /work、/tmp 和 Codex 自己的目录能写，
  # 没有特权、不是 root、单独的网络；Codex 里不再套一层沙盒，靠「每条命令都先问」来把关
  echo "  Codex 自己的沙盒开不了：${LAST_ERR:-（没有说原因）}"
  echo "  改用退路：容器本身当沙盒（根目录只读，只能写项目），每条命令都先问一遍。"
  MODE_NAME="容器当沙盒（Codex 自己的沙盒开不了：${LAST_ERR:-原因不明}）"
  MODE=(--read-only --tmpfs /tmp:rw,size=256m --tmpfs /home/codex:rw,size=256m,uid=1001,gid=1001)
  CONTAINER_SANDBOX=1
fi
echo "  容器安全设置：$MODE_NAME"

say "3/4 开始实测（第一次会让你在手机上登录 ChatGPT）"
echo "  先测沙盒（不花额度），再跑三个小任务（会用一点 Codex 额度）。大概 5～10 分钟。"
# 限制：最多 2G 内存、2 个 CPU、512 个进程、没有特权；只挂 Codex 的登录目录和 /work
# 脚本被打断（Ctrl+C）时容器也一起停
trap '$SUDO docker rm -f codex-lab >/dev/null 2>&1 || true' EXIT
$SUDO docker run --rm -t --name codex-lab "${BASE[@]}" "${MODE[@]}" -e LAB_MODE="$MODE_NAME" -e LAB_CONTAINER_SANDBOX="$CONTAINER_SANDBOX" \
  -v "$DIR/codex-home:/home/codex/.codex" \
  -v "$DIR/work:/work" \
  codex-lab node /opt/probe.mjs || true

say "4/4 好了"
if [ -f "$DIR/work/report.txt" ]; then
  echo "  报告：$DIR/work/report.txt"
  echo "  看报告：cat $DIR/work/report.txt"
  echo "  把它整个复制给 cc 就行。详细的事件记录在 $DIR/work/logs/ 里（先不用发）。"
else
  echo "  没生成报告，把上面的输出截图给 cc 看看（如果屏幕上有登录码，截图前先遮住）。"
fi
