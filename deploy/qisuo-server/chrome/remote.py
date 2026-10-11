"""他的浏览器的「遥控」：给你登录网站用（看画面、点一下、打字、按回车）。
只在 docker 内部网络里，栖所服务器（带口令）转发过来。

POST /  {"action": ...}
  open        {url}              打开一个新页面，返回 page_id
  pages       {}                 现在开着的页面
  screenshot  {page_id?}         截图（不传 page_id 就截最新的那个页面）
  click       {page_id, x, y}    在网页上点一下（坐标是截图上的像素）
  type        {page_id, text}    往当前光标的地方打字
  key         {page_id, key}     按键：Enter / Backspace / Tab
  close       {page_id}          关掉页面
"""
import json, os, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import websocket

CDP = "http://127.0.0.1:%s" % os.environ.get("CHROME_CDP_PORT", "9223")
PORT = int(os.environ.get("CHROME_REMOTE_PORT", "9225"))


def cdp_json(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"null")


def pages():
    return [p for p in cdp_json("/json/list") if p.get("type") == "page"]


def page_ws(page_id):
    ps = pages()
    p = next((x for x in ps if x["id"] == page_id), None) if page_id else (ps[0] if ps else None)
    if not p:
        raise ValueError("没有这个页面")
    return p


class Session:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=20, suppress_origin=True)
        self.n = 0

    def call(self, method, params=None):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(msg["error"].get("message", "CDP 出错"))
                return msg.get("result", {})

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


KEYS = {"Enter": (13, "\r"), "Backspace": (8, ""), "Tab": (9, "")}


def handle(body):
    a = body.get("action")
    if a == "pages":
        return {"pages": [{"page_id": p["id"], "title": p.get("title", ""), "url": p.get("url", "")} for p in pages()]}
    if a == "open":
        url = str(body.get("url", ""))
        if not url.startswith(("http://", "https://")):
            raise ValueError("只能打开 http(s) 网址")
        p = cdp_json("/json/new?" + urllib.parse.quote(url, safe=":/?&=%#"), method="PUT")
        return {"page_id": p["id"]}
    if a == "close":
        cdp_json("/json/close/" + body["page_id"])
        return {"ok": True}
    p = page_ws(body.get("page_id"))
    s = Session(p["webSocketDebuggerUrl"])
    try:
        if a == "screenshot":
            shot = s.call("Page.captureScreenshot", {"format": "jpeg", "quality": 80})
            return {"page_id": p["id"], "title": p.get("title", ""), "url": p.get("url", ""), "image": shot["data"]}
        if a == "click":
            x, y = float(body["x"]), float(body["y"])
            for t in ("mouseMoved", "mousePressed", "mouseReleased"):
                s.call("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": "left", "clickCount": 1})
            return {"ok": True}
        if a == "type":
            s.call("Input.insertText", {"text": str(body.get("text", ""))[:200]})
            return {"ok": True}
        if a == "key":
            k = body.get("key", "Enter")
            code, text = KEYS.get(k, KEYS["Enter"])
            for t in ("keyDown", "keyUp"):
                s.call("Input.dispatchKeyEvent", {"type": t, "key": k, "windowsVirtualKeyCode": code, "nativeVirtualKeyCode": code, **({"text": text} if t == "keyDown" and text else {})})
            return {"ok": True}
        raise ValueError("不认识的操作")
    finally:
        s.close()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            self.send(200, handle(body))
        except Exception as e:
            self.send(400, {"error": {"message": str(e)}})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
