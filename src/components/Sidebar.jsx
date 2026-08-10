import React from 'react';

const CATEGORY_MAP = {
  'diary': '日记',
  'transfer': '传输',
  'work': '工作',
  'privacy': '隐私'
};

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
  statusText,
  statusDotClass
}) {
  // Scan categories to build message counts
  const categoriesMap = {
    'diary': 0,
    'transfer': 0,
    'work': 0,
    'privacy': 0
  };

  messages.forEach(msg => {
    if (Array.isArray(msg.categories)) {
      msg.categories.forEach(cat => {
        // Normalize
        const catId = cat === '工作' ? 'work' : (cat === '日记' ? 'diary' : (cat === '传输' ? 'transfer' : (cat === '隐私' ? 'privacy' : cat)));
        categoriesMap[catId] = (categoriesMap[catId] || 0) + 1;
      });
    }
  });

  const defaultIds = ['diary', 'transfer', 'work', 'privacy'];
  const allCatIds = Object.keys(categoriesMap).sort((a, b) => {
    const idxA = defaultIds.indexOf(a);
    const idxB = defaultIds.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  return (
    <>
      {/* Background Overlay on Mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Drawer */}
      <aside 
        className={`fixed top-0 bottom-0 left-0 w-72 bg-bgSecondary border-r border-borderColor flex flex-col z-40 md:z-10 md:static transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0 transition-transform duration-200 ease-out`}
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

        {/* Categories List */}
        <div className="flex-1 overflow-y-auto py-2">
          <div className="px-4 py-1 text-[10px] font-semibold text-textMuted uppercase tracking-widest">
            Categories
          </div>
          <ul className="mt-1 flex flex-col">
            {/* All Messages tab */}
            <li 
              onClick={() => { onSwitchCategory('all'); onClose(); }}
              className={`flex items-center justify-between px-4 py-2 text-xs font-medium cursor-pointer transition-all ${
                activeCategory === 'all' 
                  ? 'bg-accentColor/10 text-accentColor border-l-2 border-accentColor' 
                  : 'text-textSecondary hover:bg-white/5 border-l-2 border-transparent'
              }`}
            >
              <span className="flex items-center gap-2">
                <i className="fa-solid fa-layer-group text-sm"></i> All Messages
              </span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                activeCategory === 'all' ? 'bg-accentColor/20 text-accentColor' : 'bg-borderColor/50 text-textMuted'
              }`}>
                {messages.length}
              </span>
            </li>

            {/* Custom categories */}
            {allCatIds.map(catId => {
              const count = categoriesMap[catId];
              const displayName = CATEGORY_MAP[catId] || catId;
              const isSelected = activeCategory === catId;
              return (
                <li 
                  key={catId}
                  onClick={() => { onSwitchCategory(catId); onClose(); }}
                  className={`flex items-center justify-between px-4 py-2 text-xs font-medium cursor-pointer transition-all ${
                    isSelected 
                      ? 'bg-accentColor/10 text-accentColor border-l-2 border-accentColor' 
                      : 'text-textSecondary hover:bg-white/5 border-l-2 border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <i className="fa-solid fa-hashtag text-sm text-textMuted"></i> 
                    <span className="truncate">{displayName}</span>
                  </span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    isSelected ? 'bg-accentColor/20 text-accentColor' : 'bg-borderColor/50 text-textMuted'
                  }`}>
                    {count}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Profile Card & Sync Button */}
        <div className="p-3 border-t border-borderColor flex items-center justify-between gap-3 bg-bgPrimary/10">
          <div className="flex items-center gap-2 min-w-0">
            <img 
              src={currentProfile?.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(currentProfile?.username || 'User')}`} 
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
