import os
import sys
import webview

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

    # Create native WebView2 window with CORS disabled
    window = webview.create_window(
        title='CloudChat Desktop (Lightweight)',
        url=index_file,
        width=1380,
        height=820,
        resizable=True,
        min_size=(900, 600)
    )

    # Start PyWebView using Edge Chromium / WebView2 engine
    webview.start(gui='qt' if 'qt' in sys.argv else 'edgechromium', debug=False)
