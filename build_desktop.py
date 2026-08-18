"""
一键打包 CloudChat 桌面端 (PyWebView + WebView2) 为 Windows 单文件 exe。

流程:
  1. vite build 生成 dist/ (前端产物)
  2. PyInstaller 将 app_desktop.py 打包为 --onefile --noconsole
     - 通过本地 HTTP 服务器加载 dist/, 规避 file:// + crossorigin 模块加载失败
     - 移除 site-per-process 等不稳定 flag, 避免渲染进程崩溃导致界面卡死

用法:
  python build_desktop.py            # 正常打包
  python build_desktop.py --debug    # 打开 WebView2 DevTools 的调试版
  python build_desktop.py --skip-build  # 跳过 vite build, 复用现有 dist/
"""

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")
SPEC_NAME = "CloudChat_Light"
EXE_NAME = f"{SPEC_NAME}.exe"


def run(cmd, **kw):
    print(">>>", " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True, **kw)


def build_frontend():
    print("[1/2] 构建前端 dist/ ...")
    # vite 是 npm 包, 用 npm run build (底层调用 vite build).
    # shell=True + 字符串命令, 以便从 PATH 解析 npm.cmd (Windows 下 python subprocess 找不到 npm)
    run("npm run build", shell=True)
    patch_dist_index()


def patch_dist_index():
    """Post-process dist/index.html produced by vite.

    The bundled ES module <script> carries a `crossorigin` attribute, which
    makes the browser run a CORS check even over same-origin localhost. Our
    local SimpleHTTP server only started returning `Access-Control-Allow-Origin`
    recently, so on older builds the module was silently blocked -> React never
    ran -> white screen / freeze with no JS error and no `loaded` event.

    We strip `crossorigin` from the module + stylesheet tags (not needed for a
    same-origin local server) so module loading cannot fail on CORS. As a belt
    and braces we also inject an early ping probe that proves the renderer at
    least parsed <head> and ran JS.
    """
    index_html = os.path.join(DIST, "index.html")
    if not os.path.exists(index_html):
        print("[patch] dist/index.html 不存在, 跳过")
        return
    with open(index_html, "r", encoding="utf-8") as f:
        html = f.read()

    original = html
    # Remove crossorigin attributes from script/link tags (keep other attrs).
    html = html.replace(' crossorigin src=', ' src=')
    html = html.replace(' crossorigin href=', ' href=')
    html = html.replace('crossorigin ', '')
    html = html.replace(' crossorigin', '')

    if html != original:
        with open(index_html, "w", encoding="utf-8") as f:
            f.write(html)
        print("[patch] 已从 dist/index.html 移除 crossorigin 属性")

    # Inject an early ping probe into <head> if not already present.
    if '/__ping?stage=head' not in html:
        probe = (
            '<script>try{fetch("/__ping?stage=head",{cache:"no-store"}).catch'
            '(function(){});}catch(e){}</script>\n'
        )
        html = html.replace('<title>', probe + '<title>', 1)
        with open(index_html, "w", encoding="utf-8") as f:
            f.write(html)
        print("[patch] 已向 dist/index.html 注入 head ping 探针")


def build_exe(debug=False):
    print("[2/2] PyInstaller 打包 exe ...")
    if debug:
        # 调试版: 打开 DevTools, 方便看卡死时的 Console / Network 报错
        os.environ["CLOUDCHAT_DEBUG"] = "1"

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconsole",
        "--onefile",
        "--add-data", "dist;dist",
        "--name", SPEC_NAME,
        "--clean",
        "--distpath", "release",
        "app_desktop.py",
    ]
    run(cmd)

    # PyInstaller --onefile 把 exe 输出到 --distpath 指定的 release/
    default_out = os.path.join(ROOT, "release", EXE_NAME)
    print(f"\n打包完成. exe 位置: {default_out}")
    print(f"调试日志: %APPDATA%\\CloudChatLight\\debug.log")
    if debug:
        print("提示: 此调试版会打开 DevTools, 正式发布请用 python build_desktop.py 重打.")


def main():
    args = sys.argv[1:]
    debug = "--debug" in args
    skip_build = "--skip-build" in args

    if not skip_build:
        build_frontend()
    else:
        print("[跳过] vite build, 复用现有 dist/")

    build_exe(debug=debug)


if __name__ == "__main__":
    main()
