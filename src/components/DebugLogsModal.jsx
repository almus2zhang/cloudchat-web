import React, { useRef, useEffect } from 'react';

export default function DebugLogsModal({ isOpen, onClose, logs = [], onClear, onForceSync }) {
  const logEndRef = useRef(null);

  useEffect(() => {
    if (isOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, logs]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      const text = logs.join('\n');
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      alert('已将所有调试日志复制到剪贴板！');
    } catch (e) {
      alert(`复制失败: ${e.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-bgSecondary border border-borderColor w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-borderColor flex items-center justify-between bg-bgPrimary/50">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-terminal text-accentColor text-lg"></i>
            <h3 className="font-bold text-textPrimary text-base">同步与网络调试日志 (Debug Logs)</h3>
            <span className="text-xs text-textMuted bg-bgPrimary px-2 py-0.5 rounded-full border border-borderColor">
              {logs.length} 条记录
            </span>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bgPrimary text-textMuted hover:text-textPrimary transition-all"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Modal Content - Terminal Box */}
        <div className="p-4 flex-1 overflow-hidden flex flex-col bg-slate-950">
          <div className="flex-1 overflow-y-auto font-mono text-xs leading-relaxed text-green-400 p-3 bg-black/90 rounded-xl border border-slate-800 select-text whitespace-pre-wrap break-all shadow-inner space-y-1">
            {logs.length === 0 ? (
              <div className="text-slate-500 italic text-center py-8">暂无调试日志... 点击“立即强制同步”开始触发。</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className={
                  log.includes('FAIL') || log.includes('ERR') || log.includes('Error') || log.includes('!')
                    ? 'text-red-400 font-semibold bg-red-950/30 px-1 rounded'
                    : log.includes('HTTP')
                    ? 'text-sky-300'
                    : log.includes('===')
                    ? 'text-yellow-300 font-bold border-t border-slate-800 pt-1 mt-1'
                    : 'text-green-400'
                }>
                  {log}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-3 border-t border-borderColor flex flex-wrap items-center justify-between gap-2 bg-bgPrimary/30">
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-accentColor text-white hover:opacity-90 transition-all flex items-center gap-1.5 shadow-md"
            >
              <i className="fa-regular fa-copy"></i>
              <span>复制全部分析日志</span>
            </button>
            
            <button
              onClick={onForceSync}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center gap-1.5 shadow-md"
            >
              <i className="fa-solid fa-arrows-rotate"></i>
              <span>立即重新强制同步</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClear}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-borderColor hover:bg-bgPrimary text-textMuted hover:text-textPrimary transition-all flex items-center gap-1.5"
            >
              <i className="fa-regular fa-trash-can"></i>
              <span>清空日志</span>
            </button>

            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-bgPrimary border border-borderColor text-textPrimary hover:bg-bgSecondary transition-all"
            >
              关闭
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
