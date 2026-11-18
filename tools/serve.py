"""
本地静态服务器。start.bat 调用这个。

比直接敲 "python -m http.server 8000" 多做三件事：
  1. 自动挑一个没被占用的端口（8000 → 8001 → 8002 → 8003 → 8080）
  2. 只监听 127.0.0.1，不把整个文件夹暴露到局域网
  3. 自动打开浏览器

用法：
  python tools/serve.py               # 正常启动
  python tools/serve.py --no-browser  # 不自动开浏览器
  python tools/serve.py --port 9000   # 指定端口
"""
import functools
import http.server
import os
import socket
import sys
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANDIDATE_PORTS = [8000, 8001, 8002, 8003, 8080]


def port_is_free(port):
    """连不上说明没人监听，也就是端口空着。"""
    s = socket.socket()
    s.settimeout(0.3)
    try:
        s.connect(('127.0.0.1', port))
    except OSError:
        return True
    finally:
        s.close()
    return False


def pick_port(preferred=None):
    if preferred:
        return preferred
    for p in CANDIDATE_PORTS:
        if port_is_free(p):
            return p
    return None


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """不要把每条请求都打到控制台上。"""

    def log_message(self, *args):
        pass


def main():
    args = sys.argv[1:]
    no_browser = '--no-browser' in args
    preferred = None
    if '--port' in args and args.index('--port') + 1 < len(args):
        preferred = int(args[args.index('--port') + 1])

    port = pick_port(preferred)
    if port is None:
        print('端口 %s 都被占了。' % ' / '.join(map(str, CANDIDATE_PORTS)))
        print('先关掉占用它们的程序再试，或者直接双击 dist\\魔塔-单文件版.html。')
        return 1

    url = 'http://localhost:%d/' % port
    # flush=True：输出被重定向到管道时 Python 会缓冲，不加这句就看不到提示
    print('魔塔 - 本地静态服务器', flush=True)
    print('  地址：%s' % url, flush=True)
    print('  只监听 127.0.0.1，局域网里的其它机器访问不到。', flush=True)
    print('  关闭本窗口即可停止服务。', flush=True)
    if not no_browser:
        webbrowser.open(url)

    handler = functools.partial(QuietHandler, directory=ROOT)
    # 必须用多线程版本：单线程服务器遇到浏览器 keep-alive 的连接就会卡住，
    # 页面会一直转圈加载不出来（表现就是"打不开"）。
    class Server(http.server.ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    with Server(('127.0.0.1', port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n已停止。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
