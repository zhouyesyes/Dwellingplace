# 工作间：Codex（固定版本）+ 连接程序。容器里没有栖所的数据，只有项目文件夹（/work）和 Codex 自己的登录目录
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep python3 && rm -rf /var/lib/apt/lists/*
ARG CODEX_VERSION=0.162.1
RUN npm install -g @openai/codex@${CODEX_VERSION} --no-audit --no-fund
RUN useradd -m -u 1001 codex
COPY bridge.mjs /opt/bridge.mjs
WORKDIR /work
# 连接程序以 root 运行（钥匙、记录别人读不到），Codex 和它的命令降成 codex 用户
CMD ["node", "/opt/bridge.mjs"]
