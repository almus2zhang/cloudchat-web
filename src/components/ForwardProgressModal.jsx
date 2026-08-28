import React from 'react';

export default function ForwardProgressModal({
  isOpen,
  isCompleted,
  isCancelled,
  current = 0,
  total = 0,
  currentDetail = '',
  targetProfileName = '',
  onCancel,
  onClose
}) {
  if (!isOpen) return null;

  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-3 sm:p-4 animate-fade-in backdrop-blur-sm">
      <div className="bg-bgSecondary border border-borderColor rounded-2xl w-full max-w-md overflow-hidden shadow-2xl scale-in flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-borderColor flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
              isCompleted
                ? isCancelled
                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                  : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                : 'bg-purple-500/10 border border-purple-500/30 text-purple-400'
            }`}>
              {isCompleted ? (
                isCancelled ? (
                  <i className="fa-solid fa-triangle-exclamation"></i>
                ) : (
                  <i className="fa-solid fa-circle-check"></i>
                )
              ) : (
                <i className="fa-solid fa-paper-plane animate-pulse"></i>
              )}
            </div>
            <div>
              <h3 className="text-textPrimary text-base font-semibold">
                {isCompleted
                  ? isCancelled
                    ? '转发已取消'
                    : '转发完成'
                  : '正在跨配置逐条转发'}
              </h3>
              <p className="text-textMuted text-xs mt-0.5">
                目标配置：<span className="text-textPrimary font-medium">{targetProfileName || '目标配置'}</span>
              </p>
            </div>
          </div>
          {isCompleted && (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textPrimary transition-colors"
            >
              <i className="fa-solid fa-xmark text-sm"></i>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Progress Info Header */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-textMuted font-medium">
              {isCompleted
                ? isCancelled
                  ? `已处理 ${current} / ${total} 条`
                  : `共 ${total} 条全部完成`
                : `正在处理第 ${current} / ${total} 条`}
            </span>
            <span className={`font-bold text-sm ${
              isCompleted
                ? isCancelled
                  ? 'text-amber-400'
                  : 'text-emerald-400'
                : 'text-purple-400'
            }`}>
              {percent}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2.5 bg-bgPrimary rounded-full overflow-hidden border border-borderColor/40 relative">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                isCompleted
                  ? isCancelled
                    ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                  : 'bg-gradient-to-r from-purple-600 to-indigo-500'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>

          {/* Detail Text */}
          <div className="bg-bgPrimary/60 border border-borderColor/50 rounded-xl p-3 text-xs text-textSecondary flex items-center gap-2.5 min-h-[44px]">
            {!isCompleted ? (
              <i className="fa-solid fa-circle-notch fa-spin text-purple-400 shrink-0"></i>
            ) : isCancelled ? (
              <i className="fa-solid fa-info-circle text-amber-400 shrink-0"></i>
            ) : (
              <i className="fa-solid fa-check text-emerald-400 shrink-0"></i>
            )}
            <span className="truncate flex-1" title={currentDetail}>
              {currentDetail || (isCompleted ? (isCancelled ? '转发已由用户取消' : '所有消息已成功转发至目标配置') : '正在准备转发...')}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-borderColor flex items-center justify-end gap-2.5 bg-bgPrimary/30">
          {!isCompleted ? (
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 rounded-xl transition-all active:scale-95 flex items-center gap-2"
            >
              <i className="fa-solid fa-ban text-xs"></i>
              <span>取消转发</span>
            </button>
          ) : (
            <button
              onClick={onClose}
              className={`px-5 py-2 text-sm font-semibold rounded-xl text-white transition-all shadow-lg active:scale-95 flex items-center gap-2 ${
                isCancelled
                  ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30'
                  : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
              }`}
            >
              <i className="fa-solid fa-check text-xs"></i>
              <span>{isCancelled ? '关闭' : '完成'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
