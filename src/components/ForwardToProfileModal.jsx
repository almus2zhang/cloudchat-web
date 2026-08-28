import React, { useState } from 'react';

export default function ForwardToProfileModal({
  isOpen,
  profiles = [],
  activeProfileId,
  messageCount = 1,
  onConfirm,
  onCancel
}) {
  const [selectedProfileId, setSelectedProfileId] = useState('');

  // Filter out current active profile
  const availableProfiles = profiles.filter(p => p.id !== activeProfileId);

  // Set default selected profile
  React.useEffect(() => {
    if (isOpen) {
      if (availableProfiles.length > 0) {
        setSelectedProfileId(availableProfiles[0].id);
      } else {
        setSelectedProfileId('');
      }
    }
  }, [isOpen, activeProfileId, profiles]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in backdrop-blur-sm">
      <div className="bg-bgSecondary border border-borderColor rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden shadow-2xl scale-in">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-borderColor flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 text-lg">
              <i className="fa-solid fa-paper-plane"></i>
            </div>
            <div>
              <h3 className="text-textPrimary text-base font-semibold">转发到其他配置</h3>
              <p className="text-textMuted text-xs mt-0.5">
                已选中 <span className="text-purple-400 font-semibold">{messageCount}</span> 条消息，将逐条发送至目标配置
              </p>
            </div>
          </div>
          <button 
            onClick={onCancel}
            className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textPrimary transition-colors"
          >
            <i className="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>

        {/* Content Profile List */}
        <div className="p-4 sm:p-5 flex-1 overflow-y-auto space-y-2.5">
          {availableProfiles.length === 0 ? (
            <div className="py-8 text-center text-textMuted text-sm">
              <i className="fa-solid fa-folder-open text-2xl mb-2 opacity-50 block"></i>
              暂无其他可用配置。请先在「设置」中添加更多配置。
            </div>
          ) : (
            availableProfiles.map((p) => {
              const isSelected = selectedProfileId === p.id;
              const displayName = p.name || p.username || '未命名配置';
              const protocol = p.type || 'WEBDAV';
              const serverAddr = p.serverUrl || (p.s3Endpoint ? `${p.s3Endpoint}/${p.s3Bucket}` : '云端存储');

              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedProfileId(p.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected 
                      ? 'bg-purple-500/15 border-purple-500/60 ring-1 ring-purple-500/40' 
                      : 'bg-bgPrimary/60 border-borderColor/60 hover:bg-bgPrimary hover:border-borderColor'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                      isSelected ? 'bg-purple-500 text-white' : 'bg-bgSecondary text-textSecondary border border-borderColor'
                    }`}>
                      {p.avatar ? (
                        <img src={p.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        displayName.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-textPrimary truncate">{displayName}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-textSecondary uppercase">
                          {protocol}
                        </span>
                      </div>
                      <p className="text-xs text-textMuted truncate mt-0.5" title={serverAddr}>
                        {serverAddr}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                      isSelected ? 'border-purple-500 bg-purple-500 text-white' : 'border-borderColor bg-bgSecondary'
                    }`}>
                      {isSelected && <i className="fa-solid fa-check text-[10px]"></i>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-borderColor flex items-center justify-end gap-2.5 bg-bgPrimary/30">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-textSecondary hover:text-textPrimary hover:bg-white/5 rounded-xl transition-colors"
          >
            取消
          </button>
          <button
            disabled={!selectedProfileId || availableProfiles.length === 0}
            onClick={() => onConfirm(selectedProfileId)}
            className={`px-5 py-2 text-sm font-semibold rounded-xl flex items-center gap-2 transition-all ${
              selectedProfileId && availableProfiles.length > 0
                ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 active:scale-95'
                : 'bg-white/10 text-textMuted cursor-not-allowed opacity-50'
            }`}
          >
            <i className="fa-solid fa-paper-plane text-xs"></i>
            <span>确认转发</span>
          </button>
        </div>
      </div>
    </div>
  );
}
