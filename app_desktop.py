import os
import sys
import json
import webview

# Minimal WebView2 flags
os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = (
    '--disable-web-security --ignore-certificate-errors'
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

    kwargs = {
        'title': 'CloudChat Desktop',
        'url': index_file,
        'width': state['width'],
        'height': state['height'],
        'resizable': True,
        'min_size': (400, 500)
    }

    if state['x'] is not None and state['y'] is not None:
        kwargs['x'] = state['x']
        kwargs['y'] = state['y']

    window = webview.create_window(**kwargs)

    def on_resized():
        save_window_state(window)

    def on_moved():
        save_window_state(window)

    def on_closing():
        save_window_state(window)

    window.events.resized += on_resized
    window.events.moved += on_moved
    window.events.closing += on_closing

    api = DesktopApi()
    api.set_window(window)

    webview.start(
        gui='edgechromium',
        debug=False,
        private_mode=False,
        storage_path=storage_dir
    )
