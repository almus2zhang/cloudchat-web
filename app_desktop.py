import os
import sys
import json
import socket
import threading
import subprocess
import base64
import webview
from http.server import SimpleHTTPRequestHandler, HTTPServer

# WebView2 flags for clean local desktop execution
os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = (
    '--disable-web-security --allow-running-insecure-content --ignore-certificate-errors'
)

webview.settings['IGNORE_SSL_ERRORS'] = True
webview.settings['ALLOW_FILE_URLS'] = True

appdata = os.getenv('APPDATA', os.path.expanduser('~'))
storage_dir = os.path.join(appdata, 'CloudChatLight')
os.makedirs(storage_dir, exist_ok=True)
config_file = os.path.join(storage_dir, 'window_state.json')


def load_window_state():
    defaults = {'width': 1380, 'height': 820, 'x': None, 'y': None}
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    w = data.get('width', 1380)
                    h = data.get('height', 820)
                    x = data.get('x')
                    y = data.get('y')
                    if isinstance(w, int) and w >= 400:
                        defaults['width'] = w
                    if isinstance(h, int) and h >= 500:
                        defaults['height'] = h
                    if isinstance(x, int) and x >= 0:
                        defaults['x'] = x
                    if isinstance(y, int) and y >= 0:
                        defaults['y'] = y
        except Exception:
            pass
    return defaults


def save_window_state(win):
    try:
        if win and hasattr(win, 'width') and hasattr(win, 'height'):
            w = win.width
            h = win.height
            x = getattr(win, 'x', None)
            y = getattr(win, 'y', None)
            state = {'width': w, 'height': h, 'x': x, 'y': y}
            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(state, f)
    except Exception:
        pass


class DesktopApi:
    def __init__(self):
        self.window = None

    def set_window(self, win):
        self.window = win

    def minimize(self):
        if self.window:
            self.window.minimize()

    def toggle_maximize(self):
        if self.window:
            try:
                self.window.toggle_fullscreen()
            except Exception:
                self.window.minimize()

    def close(self):
        try:
            if self.window:
                save_window_state(self.window)
                self.window.destroy()
        except Exception:
            pass
        finally:
            os._exit(0)

    def open_downloads_folder(self):
        try:
            downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
            os.makedirs(downloads_dir, exist_ok=True)
            if sys.platform == 'win32':
                os.startfile(downloads_dir)
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', downloads_dir])
            else:
                subprocess.Popen(['xdg-open', downloads_dir])
            return True
        except Exception:
            return False

    def open_file(self, file_path):
        try:
            if os.path.exists(file_path):
                if sys.platform == 'win32':
                    os.startfile(file_path)
                elif sys.platform == 'darwin':
                    subprocess.Popen(['open', file_path])
                else:
                    subprocess.Popen(['xdg-open', file_path])
                return True
        except Exception:
            pass
        return False

    def save_file_dialog(self, suggested_name, base64_content):
        try:
            if not self.window:
                return False
            result = self.window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=suggested_name
            )
            if result:
                save_path = result if isinstance(result, str) else result[0]
                data = base64.b64decode(base64_content)
                with open(save_path, 'wb') as f:
                    f.write(data)
                return True
        except Exception:
            pass
        return False

    def save_file_to_downloads(self, suggested_name, base64_content):
        try:
            downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
            os.makedirs(downloads_dir, exist_ok=True)
            save_path = os.path.join(downloads_dir, suggested_name)
            data = base64.b64decode(base64_content)
            with open(save_path, 'wb') as f:
                f.write(data)
            return save_path
        except Exception:
            return None


def get_dist_path():
    if getattr(sys, 'frozen', False):
        base_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(sys.argv[0])))
        dist_dir = os.path.join(base_dir, 'dist')
        if os.path.exists(dist_dir):
            return dist_dir
        return base_dir
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(base_dir, 'dist')


def get_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

def start_embedded_server(dist_dir, port):
    class QuietCORSHandler(SimpleHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=dist_dir, **kwargs)

        def end_headers(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PROPFIND, HEAD')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.send_header('Connection', 'close')
            super().end_headers()

        def do_OPTIONS(self):
            self.send_response(200)
            self.end_headers()

        def log_message(self, format, *args):
            pass  # Suppress HTTP server output logs

    server = ThreadingHTTPServer(('127.0.0.1', port), QuietCORSHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    return server


if __name__ == '__main__':
    dist_dir = get_dist_path()
    port = get_free_port()
    start_embedded_server(dist_dir, port)
    target_url = f'http://127.0.0.1:{port}/index.html'

    state = load_window_state()
    api = DesktopApi()

    kwargs = {
        'title': 'CloudChat Desktop',
        'url': target_url,
        'width': state['width'],
        'height': state['height'],
        'resizable': True,
        'min_size': (400, 500),
        'js_api': api
    }

    if state['x'] is not None and state['y'] is not None:
        kwargs['x'] = state['x']
        kwargs['y'] = state['y']

    window = webview.create_window(**kwargs)
    api.set_window(window)

    def on_closing():
        try:
            save_window_state(window)
        except Exception:
            pass

    window.events.closing += on_closing

    try:
        webview.start(
            gui='edgechromium',
            debug=False,
            private_mode=False
        )
    finally:
        try:
            save_window_state(window)
        except Exception:
            pass
        os._exit(0)
