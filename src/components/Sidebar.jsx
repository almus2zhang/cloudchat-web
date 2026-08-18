import React from 'react';
import { getInitialAvatar } from '../utils/avatar';

export default function Sidebar({ 
  isOpen, 
  onClose,
  profiles,
  activeProfileId,
  currentProfile,
  activeCategory,
  onSwitchCategory,
  onOpenSettings,
  onSync,
  isSyncing,
  messages,
  diaryCount = 0,
  statusText,
  statusDotClass,
  resolveAvatarUrl
}) {
  const [avatarUrl, setAvatarUrl] = React.useState(null);

  React.useEffect(() => {
    const raw = currentProfile?.avatar;
    if (!raw) {
      setAvatarUrl(null);
      return;
    }
    if (raw.startsWith('data:') || raw.startsWith('https://') || raw.startsWith('http://')) {
      setAvatarUrl(raw);
    } else if (resolveAvatarUrl) {
      resolveAvatarUrl(raw).then(url => {
        if (url) setAvatarUrl(url);
      });
    }
  }, [currentProfile?.avatar, resolveAvatarUrl]);

  return (
    <>
      {/* Background Overlay when sidebar is open in drawer mode */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Drawer */}
      <aside 
        className={`fixed top-0 bottom-0 left-0 w-72 bg-bgSecondary border-r border-borderColor flex flex-col z-40 lg:z-10 lg:static transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 transition-transform duration-200 ease-out`}
      >
        {/* Header / Logo */}
        <div className="h-14 border-b border-borderColor flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-cloud-arrow-up text-accentColor text-lg"></i>
            <h1 className="font-bold text-textPrimary tracking-tight text-base">CloudChat</h1>
          </div>
          <button 
            onClick={onOpenSettings}
            className="text-textSecondary hover:text-accentColor transition-colors p-1"
            title="Storage Settings"
          >
            <i className="fa-solid fa-server text-sm"></i>
          </button>
        </div>

        {/* Sync Status Info */}
        <div className="p-3 border-b border-borderColor bg-bgPrimary/20 flex items-center gap-2.5">
          <div className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass || 'bg-red-500'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-textMuted font-medium uppercase tracking-wider truncate">
              {currentProfile ? currentProfile.name : 'No Profile'}
            </p>
            <p className="text-xs text-textSecondary truncate">{statusText || 'Disconnected'}</p>
          </div>
        </div>

        {/* Main Section Navigation Items */}
        <div className="flex-1 overflow-y-auto py-2">
          <ul className="flex flex-col">
            {/* All Messages tab */}
            <li 
              onClick={() => { onSwitchCategory('all'); onClose(); }}
              className={`flex items-center justify-between px-4 py-2.5 text-xs font-medium cursor-pointer transition-all ${
                activeCategory === 'all' 
                  ? 'bg-accentColor/10 text-accentColor border-l-2 border-accentColor font-semibold' 
                  : 'text-textSecondary hover:bg-white/5 border-l-2 border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <i className="fa-solid fa-layer-group text-sm"></i> All Messages
              </span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                activeCategory === 'all' ? 'bg-accentColor/20 text-accentColor' : 'bg-borderColor/50 text-textMuted'
              }`}>
                {messages.length}
              </span>
            </li>

            {/* 日记 (Diary) tab */}
            <li 
              onClick={() => { onSwitchCategory('diary'); onClose(); }}
              className={`flex items-center justify-between px-4 py-2.5 text-xs font-medium cursor-pointer transition-all ${
                activeCategory === 'diary' 
                  ? 'bg-accentColor/10 text-accentColor border-l-2 border-accentColor font-semibold' 
                  : 'text-textSecondary hover:bg-white/5 border-l-2 border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <i className="fa-solid fa-book-bookmark text-sm"></i> 日记
              </span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                activeCategory === 'diary' ? 'bg-accentColor/20 text-accentColor' : 'bg-borderColor/50 text-textMuted'
              }`}>
                {diaryCount}
              </span>
            </li>
          </ul>
        </div>

        {/* Profile Card & Sync Button */}
        <div className="p-3 border-t border-borderColor flex items-center justify-between gap-3 bg-bgPrimary/10">
          <div className="flex items-center gap-2 min-w-0">
            <img 
              src={avatarUrl || getInitialAvatar(currentProfile?.username || 'User')} 
              alt="Avatar"
              className="w-9 h-9 rounded-xl object-cover border border-borderColor bg-bgPrimary shrink-0 shadow-sm"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-textPrimary truncate">
                {currentProfile ? currentProfile.username : 'Guest User'}
              </p>
              <p className="text-[10px] text-textMuted truncate">Server Owner</p>
            </div>
          </div>
          <button 
            onClick={onSync}
            disabled={isSyncing}
            className={`w-8 h-8 rounded border border-borderColor flex items-center justify-center text-textSecondary hover:text-accentColor hover:border-accentColor/30 transition-all ${
              isSyncing ? 'animate-spin' : ''
            }`}
            title="Sync Now"
          >
            <i className="fa-solid fa-rotate text-sm"></i>
          </button>
        </div>

      </aside>
    </>
  );
}
