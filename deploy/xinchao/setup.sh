#!/usr/bin/env bash
# 在服务器上部署一份心潮·念（给一个 AI 用）。
#
# 用法（在服务器的终端里粘贴这一行）：
#   bash <(curl -fsSL https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/xinchao/setup.sh)
#
# 会问几个问题，然后自动：下载心潮·念 → 生成所有口令 → 写好配置 → 启动 →
# 把栖所要填的东西存到 ~/xinchao-<名字>/栖所连接信息.txt
#
# 每个 AI 运行一次，每次用不同的英文名字和端口（第一份 18110，第二份 18111……）。
set -euo pipefail

REPO="https://github.com/tianyupaipai-cmd/xinchao-nian.git"
QISUO_ORIGIN="https://zhouyesyes.github.io"

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ask() { # ask 变量名 "问题" "默认值"
  local __v __d="${3:-}"
  if [ -n "$__d" ]; then read -r -p "$2 [$__d]: " __v </dev/tty; else read -r -p "$2: " __v </dev/tty; fi
  printf -v "$1" '%s' "${__v:-$__d}"
}
need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少 $1，请先安装"; exit 1; }; }
rand() { openssl rand -hex "${1:-32}"; }

need git; need openssl; need docker; need curl
docker compose version >/dev/null 2>&1 || { echo "缺少 docker compose"; exit 1; }
SUDO=""; docker ps >/dev/null 2>&1 || SUDO="sudo"

say "部署一份心潮·念"
echo "每个 AI 一份。下面的问题直接回车就是用方括号里的默认值。"

ask NAME "1. 这一份的英文代号（只用小写字母，比如 xin / ji）" "xin"
NAME=$(echo "$NAME" | tr -cd 'a-z0-9')
[ -n "$NAME" ] || { echo "代号不能为空"; exit 1; }
DIR="$HOME/xinchao-$NAME"
[ -e "$DIR" ] && { echo "$DIR 已经存在了：换一个代号，或者先删掉它"; exit 1; }

ask PORT "2. 端口（第一份 18110，第二份 18111，以此类推）" "18110"
OB_PORT=$((PORT - 18110 + 18001))
ask AGENT "3. 这个 AI 的名字" "心晴"
ask HUMAN "4. TA 怎么称呼你" "粥粥"
ask DOMAIN "5. 这一份的网址（比如 xin.qisuo.xyz，不要写 https://）" ""
DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN%%/*}
[ -n "$DOMAIN" ] || { echo "网址不能为空"; exit 1; }

echo
echo "6. 记忆库要用一个「小模型」整理记忆（OpenAI 兼容格式，建议用不带思考的模型，比如 deepseek-chat）"
ask LLM_BASE "   接口地址" "https://api.deepseek.com/v1"
ask LLM_MODEL "   模型名" "deepseek-chat"
echo "   API Key：粘贴一次，然后回车（会显示在屏幕上，填完不要截图）"
while true; do
  read -r -p "   API Key: " LLM_KEY </dev/tty
  LLM_KEY=$(printf '%s' "$LLM_KEY" | tr -d '[:space:]')
  if [ -z "$LLM_KEY" ]; then echo "   没有收到，再粘贴一次"; continue; fi
  echo "   收到：${LLM_KEY:0:5}…${LLM_KEY: -4}（共 ${#LLM_KEY} 位）"
  read -r -p "   对吗？直接回车 = 对，输入 n 再粘贴一次: " OKK </dev/tty
  [ "$OKK" = "n" ] || [ "$OKK" = "N" ] || break
done
clear 2>/dev/null || true # 把 Key 从屏幕上清掉

say "下载心潮·念…"
git clone --depth 1 --recursive --shallow-submodules "$REPO" "$DIR"
cd "$DIR"

say "生成口令、写配置…"
OB_PASS=$(rand 12)
OB_TOKEN=$(rand)
DM_TOKEN=$(rand)
DASH_TOKEN=$(rand)
APPROVE_TOKEN=$(rand 16)
MCP_TOKEN=$(rand)
BRIDGE_TOKEN=$(rand)

cp .env.example .env
setenv() { # 有这一行就改，没有就加在最后
  local k="$1" v="$2"
  if grep -q "^$k=" .env; then
    local esc; esc=$(printf '%s' "$v" | sed -e 's/[\/&|]/\\&/g')
    sed -i "s|^$k=.*|$k=$esc|" .env
  else
    printf '%s=%s\n' "$k" "$v" >> .env
  fi
}
setenv COMPOSE_PROJECT_NAME "xinchao-$NAME"
setenv OMBRE_COMPRESS_API_KEY "$LLM_KEY"
setenv OMBRE_COMPRESS_BASE_URL "$LLM_BASE"
setenv OMBRE_COMPRESS_MODEL "$LLM_MODEL"
setenv OMBRE_DASHBOARD_PASSWORD "$OB_PASS"
setenv OMBRE_MCP_SERVICE_TOKEN "$OB_TOKEN"
setenv OMBRE_MCP_TOKEN "$OB_TOKEN"
setenv OMBRE_HOST_PORT "$OB_PORT"
setenv DYNAMIC_MIND_TOKEN "$DM_TOKEN"
# OB 反向读心潮：用服务名，两份互不干扰
setenv DYNAMIC_MIND_URL "http://dynamic-mind:18110"
setenv AGENT_NAME "$AGENT"
setenv NOTIFICATION_RECIPIENT "$HUMAN"
setenv TZ "Asia/Shanghai"
setenv MCP_ENABLED "true"
setenv MCP_PATH_TOKEN "$MCP_TOKEN"
setenv OAUTH_ENABLED "true"
setenv OAUTH_PUBLIC_BASE_URL "https://$DOMAIN"
setenv OAUTH_APPROVAL_TOKEN "$APPROVE_TOKEN"
# 心潮自己也用这个小模型：判断每轮对话算哪种互动、写梦
setenv MODEL_ENABLED "true"
setenv MODEL_BASE_URL "$LLM_BASE"
setenv MODEL_API_KEY "$LLM_KEY"
setenv MODEL_NAME "$LLM_MODEL"
# 桥：心潮想送进窗口的东西（她在小屋的互动、TA 自己冒出来的念头）先排队，栖所来取
setenv BRIDGE_ENABLED "true"
setenv BRIDGE_MACHINE_TOKEN "$BRIDGE_TOKEN"
setenv BRIDGE_SELF_SIGNALS "true"
setenv DASHBOARD_ENABLED "true"
setenv DASHBOARD_ACCESS_TOKEN "$DASH_TOKEN"
setenv DASHBOARD_PUBLIC_BASE_URL "https://$DOMAIN"
setenv DASHBOARD_ALLOWED_ORIGINS "https://xinchaomind.uk,$QISUO_ORIGIN"
chmod 600 .env

# 两份要共存：容器名、心潮的端口各不相同
sed -i \
  -e "s/container_name: ombre-brain$/container_name: ombre-brain-$NAME/" \
  -e "s/container_name: ombre-dynamic-mind$/container_name: ombre-dynamic-mind-$NAME/" \
  -e "s/\"127.0.0.1:18110:18110\"/\"127.0.0.1:$PORT:18110\"/" \
  compose.yaml

say "构建并启动（第一次要几分钟）…"
$SUDO docker compose up -d --build

say "等它启动…"
ok=""
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done

INFO="$DIR/栖所连接信息.txt"
cat > "$INFO" <<EOF
心潮·念（$AGENT）连接信息 —— 不要发给别人，也不要截图发到群里

【栖所 → 设置 → 工具 → 添加 MCP】
  名字：心潮·$AGENT
  地址：https://$DOMAIN/mcp/$MCP_TOKEN
  请求头：不用填
  哪些角色可以用：只勾 $AGENT

【栖所里看数据（以后会用到）】
  心潮地址：https://$DOMAIN
  看板口令：$DASH_TOKEN

【栖所实时接入（以后会用到）】
  服务口令：$DM_TOKEN
  桥口令：$BRIDGE_TOKEN

【Cloudflare 隧道里要填的】
  公共主机名：$DOMAIN
  服务：http://localhost:$PORT

【其他（一般用不到）】
  Claude.ai 连接器授权口令：$APPROVE_TOKEN
  记忆库后台（只能在服务器本机打开 http://127.0.0.1:$OB_PORT）密码：$OB_PASS
  文件夹：$DIR
EOF
chmod 600 "$INFO"

if [ -n "$ok" ]; then
  say "部署好了！"
else
  say "启动得有点慢，或者出了问题。过一会儿运行下面这句看看："
  echo "  curl http://127.0.0.1:$PORT/health"
  echo "  看日志：cd $DIR && $SUDO docker compose logs --tail 50"
fi
echo
cat "$INFO"
echo
echo "以上内容已经存到：$INFO"
echo "以后想再看：cat $INFO"
