# 他的浏览器：一个没有屏幕的 Chromium + chrome-mcp-bridge（https://github.com/AZHi-xinxin/chrome-mcp-bridge）
# 只在 docker 的内部网络里，栖所服务器（带口令）转发过来；不对外开端口
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-noto-color-emoji git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ARG BRIDGE_REF=main
RUN git clone https://github.com/AZHi-xinxin/chrome-mcp-bridge /bridge && cd /bridge && git checkout "$BRIDGE_REF" \
  && pip install --no-cache-dir -r requirements.txt
COPY start.sh /start.sh
COPY remote.py /remote.py
RUN chmod +x /start.sh
ENV CHROME_MCP_HOST=0.0.0.0 CHROME_MCP_PORT=9224 CHROME_CDP_PORT=9223 PYTHONUNBUFFERED=1
VOLUME /profile
CMD ["/start.sh"]
