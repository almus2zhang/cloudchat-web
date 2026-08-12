import os
import sys

# Disable WebView2 CORS and Private Network Access restrictions
os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = (
    '--disable-web-security '
    '--allow-file-access-from-files '
    '--disable-features=BlockInsecurePrivateNetworkRequests,IsolateOrigins,site-per-process '
    '--ignore-certificate-errors'
)

import webview

webview.settings['IGNORE_SSL_ERRORS'] = True
webview.settings['ALLOW_FILE_URLS'] = True

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
        if self.window:
            self.window.destroy()

def get_dist_path():
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller executable
        base_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(sys.argv[0])))
        dist_dir = os.path.join(base_dir, 'dist')
        if os.path.exists(dist_dir):
            return dist_dir
        return base_dir
    else:
        # Running as python script
        base_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(base_dir, 'dist')

if __name__ == '__main__':
    dist_dir = get_dist_path()
    index_file = os.path.join(dist_dir, 'index.html')

    appdata = os.getenv('APPDATA', os.path.expanduser('~'))
    storage_dir = os.path.join(appdata, 'CloudChatLight')
    os.makedirs(storage_dir, exist_ok=True)

    api = DesktopApi()

    # Create native WebView2 window with CORS disabled and frameless dark style
    window = webview.create_window(
        title='CloudChat Desktop',
        url=index_file,
        width=1380,
        height=820,
        resizable=True,
        frameless=True,
        easy_drag=True,
        min_size=(400, 500),
        js_api=api
    )
    api.set_window(window)

    # Start PyWebView using Edge Chromium / WebView2 engine with persistent storage
    webview.start(
        gui='edgechromium',
        debug=False,
        private_mode=False,
        storage_path=storage_dir
    )
