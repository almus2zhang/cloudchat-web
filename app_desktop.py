import os
import sys
import json
import webview

# WebView2 flags to disable CORS restrictions & security isolation for local desktop app
os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = (
    '--disable-web-security --allow-running-insecure-content '
    '--disable-site-isolation-trials --disable-features=IsolateOrigins,site-per-process,Translate,OptimizationHints,MediaRouter '
    '--disable-background-networking --disable-sync --ignore-certificate-errors'
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


import base64
import subprocess
import platform

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
        except Exception as e:
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


if __name__ == '__main__':
    dist_dir = get_dist_path()
    index_file = os.path.join(dist_dir, 'index.html')

    state = load_window_state()
    api = DesktopApi()

    kwargs = {
        'title': 'CloudChat Desktop',
        'url': index_file,
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

    def on_resized():
        save_window_state(window)

    def on_moved():
        save_window_state(window)

    def on_closing():
        save_window_state(window)

    window.events.resized += on_resized
    window.events.moved += on_moved
    window.events.closing += on_closing

    webview.start(
        gui='edgechromium',
        debug=False,
        private_mode=False,
        storage_path=storage_dir
    )
