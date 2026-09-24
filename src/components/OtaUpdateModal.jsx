import React, { useState } from 'react';
import { setIgnoredDesktopVersion, universalFetch } from '../services/otaService';

async function invokeTauri(cmd, args = {}) {
  if (typeof window !== 'undefined') {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      return await window.__TAURI__.core.invoke(cmd, args);
    }
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
      return await window.__TAURI_INTERNALS__.invoke(cmd, args);
    }
  }
  return null;
}

function uint8ArrayToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunk to prevent call stack overflow
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export default function OtaUpdateModal({
  isOpen,
  onClose,
  updateInfo,
  currentVersion = '1.0.0'
}) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen || !updateInfo) return null;

  const isTauri = typeof window !== 'undefined' && !!(window.__TAURI_INTERNALS__ || window.__TAURI__);

  const handleStartUpdate = async () => {
    setDownloading(true);
    setProgress(0);
    setErrorMsg('');
    setStatusText('正在连接服务器下载更新...');

    try {
      if (isTauri) {
        const response = await universalFetch(updateInfo.downloadUrl, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`下载失败 (HTTP ${response.status})`);
        }

        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
        let loadedBytes = 0;

        const reader = response.body.getReader();
        const chunks = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loadedBytes += value.length;
          if (totalBytes > 0) {
            const pct = Math.round((loadedBytes / totalBytes) * 100);
            setProgress(pct);
            setStatusText(`正在下载更新包... ${pct}% (${(loadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
          } else {
            setStatusText(`正在下载更新包... ${(loadedBytes / 1024 / 1024).toFixed(1)}MB`);
          }
        }

        setStatusText('下载完成，正在写入文件...');
        const totalArray = new Uint8Array(loadedBytes);
        let offset = 0;
        for (const chunk of chunks) {
          totalArray.set(chunk, offset);
          offset += chunk.length;
        }

        const base64 = uint8ArrayToBase64(totalArray);
        const fileName = updateInfo.downloadUrl.split('/').pop() || `CloudChat_${updateInfo.version}_Setup.exe`;

        const savedPath = await invokeTauri('save_file_to_downloads', {
          suggestedName: fileName,
          suggested_name: fileName,
          base64Content: base64,
          base64_content: base64
        });

        if (!savedPath) {
          throw new Error('保存安装包失败');
        }

        setStatusText('已保存更新安装包，正在启动安装程序...');
        await invokeTauri('open_file', { path: savedPath });

        setTimeout(() => {
          setDownloading(false);
          onClose();
        }, 1200);
      } else {
        // Web 浏览器环境：直接触发浏览器下载
        const a = document.createElement('a');
        a.href = updateInfo.downloadUrl;
        a.download = updateInfo.downloadUrl.split('/').pop() || 'CloudChat_Setup.exe';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setStatusText('已触发浏览器下载，请在下载完成后安装。');
        setTimeout(() => {
          setDownloading(false);
          onClose();
        }, 2000);
      }
    } catch (err) {
      console.error('OTA Update error:', err);
      setErrorMsg(err.message || '更新下载失败，请检查网络后重试');
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md p-6 overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xl font-bold">
            <i className="fa-solid fa-cloud-arrow-down"></i>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">
              发现新版本 v{updateInfo.version}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              当前版本: v{currentVersion}
            </p>
          </div>
        </div>

        {/* 更新说明 */}
        <div className="mb-5 bg-slate-50 dark:bg-slate-900/60 rounded-xl p-3.5 border border-slate-100 dark:border-slate-800 max-h-48 overflow-y-auto">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
            <i className="fa-solid fa-list-check text-blue-500"></i> 更新内容：
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
            {updateInfo.changelog || '优化系统体验与多项问题修复。'}
          </div>
        </div>

        {/* 下载进度条与状态 */}
        {downloading && (
          <div className="mb-4">
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(5, progress)}%` }}
              ></div>
            </div>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 font-medium">
              {statusText}
            </p>
          </div>
        )}

        {/* 错误提示 */}
        {errorMsg && (
          <div className="mb-4 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-600 dark:text-red-400">
            {errorMsg}
          </div>
        )}

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-700/60">
          {!downloading && (
            <>
              <button
                type="button"
                onClick={() => {
                  setIgnoredDesktopVersion(updateInfo.version);
                  onClose();
                }}
                className="px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-xl transition-colors"
                title="不再自动提醒此版本"
              >
                忽略此版本
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
              >
                稍后提醒
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleStartUpdate}
            disabled={downloading}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 rounded-xl shadow-sm transition-colors flex items-center gap-2"
          >
            {downloading ? (
              <>
                <i className="fa-solid fa-spinner fa-spin"></i>
                <span>更新中...</span>
              </>
            ) : (
              <>
                <i className="fa-solid fa-download"></i>
                <span>立即更新</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
