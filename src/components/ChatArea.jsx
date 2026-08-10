import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createDownloadState } from '../services/storage';
import { getCachedFile, cacheFile } from '../services/db';

const CATEGORY_MAP = {
  'diary': '日记',
  'transfer': '传输',
  'work': '工作',
  'privacy': '隐私'
};

export default function ChatArea({
  currentProfile,
  messages,
  activeCategory,
  selectedMessageIds,
  onToggleMessageSelection,
  onClearSelection,
  onDeleteSelected,
  onAddCategorySelected,
  onRemoveCategorySelected,
  onDeleteMessage,
  onEditMessageCategories,
  onQuickAddCategory,
  onGroupSelected,
  onUngroupMessage,
  onPackFolder,
  onRemoveMessagesFromFolder,
  onUnpackFolder,
  onRenameFolder,
  onOpenDiaryExport,
  isPrivacyMode = false,
  onEnterPrivacyMode,
  onExitPrivacyMode,
  onChangePrivacyPin,
  onToggleHideMessage,
  onEditTextMessage,
  onUpdateCaption,
  onSendMessage,
  onToggleSidebar,
  storageClient,
  resolveAvatarUrl,
  isSyncing,
  activeUploads
}) {
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  // Cache of resolved avatar blob URLs keyed by raw avatar value (filename or data: URL)
  const [avatarBlobUrls, setAvatarBlobUrls] = useState({});

  // Resolve all unique avatar values in current messages to displayable URLs
  useEffect(() => {
    if (!resolveAvatarUrl) return;
    const avatarValues = new Set();
    messages.forEach(item => {
      if (item.senderAvatar) avatarValues.add(item.senderAvatar);
    });
    avatarValues.forEach(async (av) => {
      if (avatarBlobUrls[av]) return; // already resolved
      const resolved = await resolveAvatarUrl(av);
      if (resolved) {
        setAvatarBlobUrls(prev => ({ ...prev, [av]: resolved }));
      }
    });
  }, [messages, resolveAvatarUrl]);

  // Search query state for persistent header search
  const [searchQuery, setSearchQuery] = useState('');

  // Submenu open states for category selection
  const [showCategorySubmenu, setShowCategorySubmenu] = useState(false);
  const [showBulkAddCatSubmenu, setShowBulkAddCatSubmenu] = useState(false);

  // Privacy Mode states
  const [viewHiddenOnly, setViewHiddenOnly] = useState(false);
  const sendLongPressRef = useRef(null);
  
  // Touch long press state ref
  const touchTimersRef = useRef({});

  const handleTouchStart = (e, msgId) => {
    if (e.type === 'mousedown' && e.button !== 0) return;
    if (touchTimersRef.current[msgId]) clearTimeout(touchTimersRef.current[msgId]);
    
    const touch = e.type === 'touchstart' ? e.touches[0] : e;
    const startX = touch.clientX;
    const startY = touch.clientY;
    
    const token = {
      isLongPress: false,
      startX,
      startY
    };
    
    touchTimersRef.current[msgId] = setTimeout(() => {
      token.isLongPress = true;
      onToggleMessageSelection(msgId);
      touchTimersRef.current[`longpress_active_${msgId}`] = true;
      
      // Position selection menu top-right of cursor
      setSelectionMenuCoords({ x: token.startX, y: token.startY });
    }, 600);
    
    touchTimersRef.current[`meta_${msgId}`] = token;
  };

  const handleTouchEnd = (e, msgId) => {
    const timer = touchTimersRef.current[msgId];
    if (timer) {
      clearTimeout(timer);
      delete touchTimersRef.current[msgId];
    }
    setTimeout(() => {
      delete touchTimersRef.current[`longpress_active_${msgId}`];
    }, 150);
  };

  const handleTouchMove = (e, msgId) => {
    const timer = touchTimersRef.current[msgId];
    const token = touchTimersRef.current[`meta_${msgId}`];
    if (!timer || !token) return;
    
    const touch = e.type === 'touchmove' ? e.touches[0] : e;
    const dist = Math.hypot(touch.clientX - token.startX, touch.clientY - token.startY);
    if (dist > 15) {
      clearTimeout(timer);
      delete touchTimersRef.current[msgId];
      delete touchTimersRef.current[`meta_${msgId}`];
    }
  };

  const handleItemClick = (e, msgId, defaultClickCallback) => {
    if (touchTimersRef.current[`longpress_active_${msgId}`]) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    if (selectedMessageIds.size > 0) {
      e.preventDefault();
      e.stopPropagation();
      onToggleMessageSelection(msgId);
      // Position menu near the click
      setSelectionMenuCoords({ x: e.clientX, y: e.clientY });
      return;
    }
    
    defaultClickCallback();
  };
  
  // Downloads progress state: { [msgId]: { progress, status, dlState } }
  const [downloads, setDownloads] = useState({});
  const [audioPlayingId, setAudioPlayingId] = useState(null);
  const [audioProgress, setAudioProgress] = useState({}); // { [msgId]: { progress, duration, currentTime } }
  
  // Floating selection menu coordinates
  const [selectionMenuCoords, setSelectionMenuCoords] = useState(null);

  // Right-click context menu state: { msg, x, y } or null
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);

  // Scroll lock preference state
  const [lockScroll, setLockScroll] = useState(false);

  // Folder navigation state
  const [currentFolderId, setCurrentFolderId] = useState(null);

  // Pagination & Lazy Load States
  const [visibleCount, setVisibleCount] = useState(100);
  const scrollPositionRef = useRef(null);
  const prevMessagesLengthRef = useRef(messages.length);

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    const handleScrollOrResize = () => setContextMenu(null);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [contextMenu]);

  // Reset pagination count when category, folder, search, or privacy filter changes
  useEffect(() => {
    setVisibleCount(100);
  }, [activeCategory, currentFolderId, searchQuery, viewHiddenOnly]);

  // Adjust pagination count and Auto-scroll when new messages arrive
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      const diff = messages.length - prevMessagesLengthRef.current;
      setVisibleCount(prev => prev + diff);

      if (listRef.current && !lockScroll) {
        setTimeout(() => {
          if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
          }
        }, 150);
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length, lockScroll]);

  // Auto reset coords when selection is cleared
  useEffect(() => {
    if (selectedMessageIds.size === 0) {
      setSelectionMenuCoords(null);
    }
  }, [selectedMessageIds.size]);
  
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const audioRefs = useRef({});

  // Anchor the scroll position when more history is loaded on top scroll
  useLayoutEffect(() => {
    if (scrollPositionRef.current && listRef.current) {
      const { scrollHeight, scrollTop } = scrollPositionRef.current;
      const newScrollHeight = listRef.current.scrollHeight;
      listRef.current.scrollTop = newScrollHeight - scrollHeight + scrollTop;
      scrollPositionRef.current = null;
    }
  }, [visibleCount]);

  // Memoized filtered messages
  const normalizeCategory = (cat) => cat === '工作' ? 'work' : (cat === '日记' ? 'diary' : (cat === '传输' ? 'transfer' : (cat === '隐私' ? 'privacy' : cat)));

  const filteredMessages = React.useMemo(() => {
    return messages.filter(msg => {
      // 0. Folder filter
      if (currentFolderId) {
        if (msg.folderId !== currentFolderId) return false;
      } else {
        if (msg.folderId) return false;
      }

      // 1. Privacy filter
      if (!isPrivacyMode && msg.isHidden) {
        return false;
      }
      if (isPrivacyMode && viewHiddenOnly && !msg.isHidden) {
        return false;
      }
      // 2. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchContent = msg.content && msg.content.toLowerCase().includes(q);
        const matchCaption = msg.caption && msg.caption.toLowerCase().includes(q);
        if (!matchContent && !matchCaption) return false;
      }
      // 3. Category filter
      if (activeCategory === 'all') return true;
      return Array.isArray(msg.categories) && msg.categories.map(normalizeCategory).includes(normalizeCategory(activeCategory));
    });
  }, [messages, currentFolderId, isPrivacyMode, viewHiddenOnly, searchQuery, activeCategory]);

  // Scroll event listener on chat container
  const handleScroll = (e) => {
    const el = e.currentTarget;
    const totalFiltered = filteredMessages.length;

    // Trigger load more when scrolling near top (< 15px)
    if (el.scrollTop < 15 && visibleCount < totalFiltered) {
      scrollPositionRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop
      };
      setVisibleCount(prev => Math.min(totalFiltered, prev + 100));
    }
  };

  // Adjust textarea height dynamically
  const handleInputChange = (e) => {
    setInputText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleSend = () => {
    if (!inputText.trim() && !selectedFile) return;
    onSendMessage(inputText, selectedFile, null, currentFolderId);
    setInputText('');
    setSelectedFile(null);
    setFilePreview(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleSendMouseDown = (e) => {
    if (e.type === 'mousedown' && e.button !== 0) return;
    const match = inputText.trim().match(/^##(.+)##$/);
    if (match) {
      if (sendLongPressRef.current) clearTimeout(sendLongPressRef.current);
      sendLongPressRef.current = setTimeout(() => {
        const pin = match[1];
        if (onEnterPrivacyMode) {
          const success = onEnterPrivacyMode(pin);
          if (success) {
            setInputText('');
            alert('🔓 已成功解密进入隐私模式！隐藏条目已取消掩盖。');
          } else {
            alert('❌ 密码错误，无法解锁隐私模式');
          }
        }
      }, 600);
    }
  };

  const handleSendMouseUp = () => {
    if (sendLongPressRef.current) {
      clearTimeout(sendLongPressRef.current);
      sendLongPressRef.current = null;
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    // Assign a common batchGroupId if multiple files selected together during sending
    const isMultiple = files.length > 1;
    const batchGroupId = isMultiple ? 'group_' + Date.now() : null;

    files.forEach(file => {
      onSendMessage('', file, batchGroupId, currentFolderId);
    });
    e.target.value = '';
  };

  const handleShareLocation = () => {
    // Simulate share location
    const lat = (22.5 + Math.random() * 0.1).toFixed(6);
    const lng = (113.9 + Math.random() * 0.1).toFixed(6);
    onSendMessage(`[位置] 纬度: ${lat}, 经度: ${lng}`, null, null, currentFolderId);
  };

  // --- Download Handler ---
  const handleStartDownload = async (msg, openInBrowser = false) => {
    if (downloads[msg.id]?.status === 'downloading') return;
    
    const dlState = createDownloadState();
    setDownloads(prev => ({
      ...prev,
      [msg.id]: { progress: 0, status: 'downloading', dlState }
    }));

    try {
      let blob = null;
      const displayName = msg.content.replace(/^\d+_/, '');
      
      // Check IndexedDB cache first
      blob = await getCachedFile(msg.id);
      
      if (!blob) {
        if (msg.isChunked && msg.totalChunks > 0) {
          const chunks = [];
          for (let i = 0; i < msg.totalChunks; i++) {
            if (dlState.isPaused) await dlState.waitForResume();
            if (dlState.isCancelled) throw new DOMException('Cancelled', 'AbortError');
            
            const chunkBlob = await storageClient.downloadFile(`${msg.content}.part${i}`);
            chunks.push(chunkBlob);
            
            const pct = Math.round(((i + 1) / msg.totalChunks) * 100);
            setDownloads(prev => ({
              ...prev,
              [msg.id]: { ...prev[msg.id], progress: pct }
            }));
          }
          blob = new Blob(chunks);
        } else {
          blob = await storageClient.downloadFileWithProgress(msg.content, (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
            setDownloads(prev => ({
              ...prev,
              [msg.id]: { ...prev[msg.id], progress: pct }
            }));
          }, dlState);
        }
        
        // Cache file
        if (blob) {
          cacheFile(msg.id, blob);
        }
      }

      if (blob) {
        const ext = displayName.split('.').pop().toLowerCase();
        const MIME_MAP = {
          'pdf': 'application/pdf',
          'txt': 'text/plain',
          'json': 'application/json',
          'xml': 'application/xml',
          'html': 'text/html',
          'htm': 'text/html',
          'js': 'application/javascript',
          'css': 'text/css',
          'md': 'text/markdown',
          'log': 'text/plain',
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'gif': 'image/gif',
          'webp': 'image/webp',
          'svg': 'image/svg+xml',
          'mp3': 'audio/mpeg',
          'wav': 'audio/wav',
          'ogg': 'audio/ogg',
          'm4a': 'audio/mp4',
          'mp4': 'video/mp4',
          'webm': 'video/webm'
        };

        const mimeType = MIME_MAP[ext] || blob.type || 'application/octet-stream';
        const typedBlob = new Blob([blob], { type: mimeType });
        const url = URL.createObjectURL(typedBlob);
        
        const previewableExtensions = Object.keys(MIME_MAP);
        
        if (openInBrowser && previewableExtensions.includes(ext)) {
          // Open natively supported previewable files in a new tab
          window.open(url, '_blank');
        } else {
          // Fall back to forced file downloads for binary files
          const a = document.createElement('a');
          a.href = url;
          a.download = displayName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      
      setDownloads(prev => ({
        ...prev,
        [msg.id]: { progress: 100, status: 'done', dlState: null }
      }));
      setTimeout(() => {
        setDownloads(prev => {
          const c = { ...prev };
          delete c[msg.id];
          return c;
        });
      }, 2000);

    } catch (err) {
      if (err.name === 'AbortError') {
        setDownloads(prev => {
          const c = { ...prev };
          delete c[msg.id];
          return c;
        });
      } else {
        console.error('File download failed:', err);
        setDownloads(prev => ({
          ...prev,
          [msg.id]: { progress: 0, status: 'error', dlState: null }
        }));
      }
    }
  };

  const handlePauseDownload = (msgId) => {
    const dl = downloads[msgId];
    if (dl && dl.dlState) {
      dl.dlState.pause();
      setDownloads(prev => ({
        ...prev,
        [msgId]: { ...prev[msgId], status: 'paused' }
      }));
    }
  };

  const handleResumeDownload = (msgId) => {
    const dl = downloads[msgId];
    if (dl && dl.dlState) {
      dl.dlState.resume();
      setDownloads(prev => ({
        ...prev,
        [msgId]: { ...prev[msgId], status: 'downloading' }
      }));
    }
  };

  const handleCancelDownload = (msgId) => {
    const dl = downloads[msgId];
    if (dl && dl.dlState) {
      dl.dlState.cancel();
      setDownloads(prev => {
        const c = { ...prev };
        delete c[msgId];
        return c;
      });
    }
  };

  // --- Audio Player ---
  const handleToggleAudio = (msgId) => {
    const audio = audioRefs.current[msgId];
    if (!audio) return;
    
    if (audioPlayingId === msgId) {
      audio.pause();
      setAudioPlayingId(null);
    } else {
      // Pause current
      if (audioPlayingId && audioRefs.current[audioPlayingId]) {
        audioRefs.current[audioPlayingId].pause();
      }
      audio.play();
      setAudioPlayingId(msgId);
    }
  };

  const handleAudioTimeUpdate = (msgId) => {
    const audio = audioRefs.current[msgId];
    if (!audio) return;
    
    const pct = Math.round((audio.currentTime / audio.duration) * 100);
    setAudioProgress(prev => ({
      ...prev,
      [msgId]: { 
        progress: pct, 
        duration: audio.duration || 0, 
        currentTime: audio.currentTime 
      }
    }));
  };

  const handleAudioSeek = (msgId, e) => {
    const audio = audioRefs.current[msgId];
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pos * audio.duration;
  };

  const formatAudioTime = (seconds) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // --- Message grouping by explicit groupId & Privacy filtering ---
  const grouped = React.useMemo(() => {
    // Slice only the latest visibleCount messages to optimize DOM node performance
    const totalCount = filteredMessages.length;
    const sliced = filteredMessages.slice(Math.max(0, totalCount - visibleCount));

    const groups = [];
    const groupMap = {};

    sliced.forEach(msg => {
      if (msg.groupId && msg.type !== 'TEXT') {
        if (!groupMap[msg.groupId]) {
          groupMap[msg.groupId] = {
            id: msg.groupId,
            sender: msg.sender,
            senderName: msg.senderName,
            timestamp: msg.timestamp,
            isOutgoing: msg.isOutgoing,
            isGroup: true,
            groupId: msg.groupId,
            messages: []
          };
          groups.push(groupMap[msg.groupId]);
        }
        groupMap[msg.groupId].messages.push(msg);
      } else {
        groups.push({
          ...msg,
          isGroup: false
        });
      }
    });

    return groups;
  }, [filteredMessages, visibleCount]);

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleOpenMediaViewer = (msgId) => {
    const mediaList = [];
    grouped.forEach(item => {
      if (item.isGroup) {
        item.messages.forEach(m => {
          if (m.type === 'IMAGE' || m.type === 'VIDEO') mediaList.push(m);
        });
      } else {
        if (item.type === 'IMAGE' || item.type === 'VIDEO') mediaList.push(item);
      }
    });
    window.dispatchEvent(new CustomEvent('open-media-viewer', { 
      detail: { msgId, mediaList } 
    }));
  };

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-bgPrimary relative h-full">
      {/* Header */}
      <header className="h-14 border-b border-borderColor flex items-center px-4 justify-between bg-bgSecondary shrink-0 relative">
        <div className="flex items-center gap-3 min-w-0">
          <button 
            onClick={onToggleSidebar}
            className="md:hidden text-textSecondary hover:text-textPrimary transition-colors p-1"
          >
            <i className="fa-solid fa-bars text-base"></i>
          </button>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-textPrimary truncate">
              {activeCategory === 'all' ? 'All Messages' : `# ${CATEGORY_MAP[activeCategory] || activeCategory}`}
            </h2>
            <p className="text-[10px] text-textMuted truncate">
              {messages.length} messages cached locally
            </p>
          </div>
        </div>

        {/* Persistent Header Search Bar */}
        {selectedMessageIds.size === 0 && (
          <div className="relative flex items-center w-36 sm:w-56 shrink-0 mx-2">
            <i className="fa-solid fa-magnifying-glass absolute left-2.5 text-[11px] text-textMuted pointer-events-none"></i>
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索消息 / 注释..."
              autoComplete="off"
              className="w-full bg-bgPrimary border border-borderColor rounded-full pl-7 pr-6 py-1 text-xs text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-accentColor transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-xs text-textMuted hover:text-textPrimary"
                title="清空搜索"
              >
                <i className="fa-solid fa-xmark text-xs"></i>
              </button>
            )}
          </div>
        )}

        {/* Scroll Lock & Privacy Controls */}
        {selectedMessageIds.size === 0 && (
          <div className="flex items-center shrink-0 ml-2 gap-2">
            {isPrivacyMode && (
              <>
                <span className="hidden sm:flex px-2.5 py-1 bg-purple-500/15 border border-purple-500/30 text-purple-400 rounded-full text-xs font-semibold items-center gap-1.5 animate-pulse">
                  <i className="fa-solid fa-user-shield"></i> 隐私模式
                </span>
                
                {/* View Hidden Filter Toggle */}
                <button 
                  onClick={() => setViewHiddenOnly(!viewHiddenOnly)}
                  className={`px-2.5 py-1 text-xs border rounded-full transition-all flex items-center gap-1.5 ${
                    viewHiddenOnly 
                      ? 'bg-purple-500/20 border-purple-500/50 text-purple-300' 
                      : 'bg-bgPrimary border-borderColor text-textSecondary hover:text-textPrimary'
                  }`}
                  title="切换隐藏条目显示模式"
                >
                  <i className={`fa-solid ${viewHiddenOnly ? 'fa-eye text-purple-400' : 'fa-eye-slash text-textMuted'}`}></i>
                  <span>{viewHiddenOnly ? '显示全部' : '只看隐藏'}</span>
                </button>

                {/* Change PIN */}
                <button 
                  onClick={() => {
                    const p = prompt('请输入新设定的隐私访问密码：');
                    if (p && p.trim()) {
                      if (onChangePrivacyPin) onChangePrivacyPin(p.trim());
                      alert('✅ 密码更改成功！后续请使用 ##新密码## 访问。');
                    }
                  }}
                  className="px-2 py-1 text-xs text-textSecondary hover:text-textPrimary bg-bgPrimary border border-borderColor rounded-full transition-all flex items-center gap-1"
                  title="修改隐私解锁密码"
                >
                  <i className="fa-solid fa-key text-[10px]"></i>
                  <span className="hidden md:inline">修改密码</span>
                </button>

                {/* Exit Privacy Mode */}
                <button 
                  onClick={onExitPrivacyMode}
                  className="px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20 rounded-full transition-all flex items-center gap-1 font-semibold"
                  title="退出隐私模式并隐藏所有隐私卡片"
                >
                  <i className="fa-solid fa-lock text-[10px]"></i>
                  <span>退出隐私</span>
                </button>
              </>
            )}

            <label className="flex items-center gap-1.5 text-xs text-textSecondary hover:text-textPrimary cursor-pointer select-none bg-bgPrimary/30 border border-borderColor rounded-full px-2.5 py-1.5 transition-all">
              <input 
                type="checkbox" 
                checked={lockScroll} 
                onChange={(e) => setLockScroll(e.target.checked)} 
                className="rounded border-borderColor bg-transparent text-accentColor focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer accent-accentColor"
              />
              <span className="font-semibold flex items-center gap-1 text-[10px] sm:text-[11px]">
                <i className={`fa-solid ${lockScroll ? 'fa-anchor text-accentColor' : 'fa-arrows-up-down text-textMuted'}`}></i> 锁定滚动
              </span>
            </label>
          </div>
        )}

        {/* Multi-Selection Toolbar */}
        {selectedMessageIds.size > 0 && (
          <div className="absolute inset-0 bg-bgSecondary flex items-center px-4 justify-between animate-fade-in z-20">
            <span className="text-xs font-semibold text-accentColor flex items-center gap-2">
              <i className="fa-solid fa-square-check"></i> {selectedMessageIds.size} items selected
            </span>
            <button 
              onClick={onClearSelection}
              className="w-8 h-8 flex items-center justify-center text-textSecondary hover:text-textPrimary transition-all"
              title="Clear Selection"
            >
              <i className="fa-solid fa-xmark text-sm"></i>
            </button>
          </div>
        )}
      </header>

      {/* Message List */}
      <div 
        ref={listRef}
        onScroll={handleScroll}
        onContextMenu={(e) => {
          // If right clicking on empty list background (not on a message row/bubble)
          if (!e.target.closest('.message-bubble') && !e.target.closest('.group')) {
            e.preventDefault();
            setContextMenu(null);
          }
        }}
        onClick={(e) => {
          if (selectedMessageIds.size > 0 && !e.target.closest('.message-bubble') && !e.target.closest('.checkbox-container')) {
            onClearSelection();
          }
        }}
        className="flex-1 overflow-y-auto px-2 py-4 space-y-4 min-w-0 cursor-default"
      >
        {currentFolderId && (() => {
          const folderMsg = messages.find(m => m.id === currentFolderId);
          const folderName = folderMsg ? (folderMsg.content || '文件夹') : '文件夹';
          return (
            <div className="flex items-center justify-between p-2 mb-2 bg-bgSecondary/90 backdrop-blur border border-borderColor rounded-lg sticky top-0 z-10 shadow-sm w-full">
              <div className="flex items-center gap-2 cursor-pointer hover:opacity-80" onClick={() => setCurrentFolderId(null)}>
                <i className="fa-solid fa-arrow-left text-cyan-400"></i>
                <i className="fa-solid fa-folder text-cyan-500 text-base"></i>
                <span className="font-semibold text-textPrimary text-sm truncate max-w-[200px]">{folderName}</span>
                <span className="text-[10px] text-textMuted">(点击返回主界面)</span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => folderMsg && onOpenDiaryExport && onOpenDiaryExport(folderMsg)}
                  className="px-2.5 py-1 text-xs text-cyan-300 hover:text-white bg-gradient-to-r from-cyan-500/20 to-emerald-500/20 border border-cyan-500/40 rounded-full transition-all flex items-center gap-1 font-semibold"
                  title="生成精美静态日记网页并存入服务器"
                >
                  <i className="fa-solid fa-book-bookmark text-[10px] text-cyan-400"></i> 生成静态日记
                </button>
                <button 
                  onClick={() => folderMsg && onRenameFolder && onRenameFolder(folderMsg)}
                  className="px-2.5 py-1 text-xs text-textSecondary hover:text-textPrimary bg-bgPrimary border border-borderColor rounded-full transition-all flex items-center gap-1"
                  title="重命名文件夹"
                >
                  <i className="fa-solid fa-pen text-[10px] text-accentColor"></i> 重命名
                </button>
                <button 
                  onClick={() => folderMsg && onUnpackFolder && onUnpackFolder(folderMsg)}
                  className="px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20 rounded-full transition-all flex items-center gap-1 font-semibold"
                  title="解散文件夹"
                >
                  <i className="fa-solid fa-folder-minus text-[10px]"></i> 解散文件夹
                </button>
              </div>
            </div>
          );
        })()}
        {grouped.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <i className="fa-solid fa-comments-question text-3xl text-textMuted mb-2"></i>
            <h3 className="text-textPrimary font-semibold text-sm">No Messages Yet</h3>
            <p className="text-xs text-textMuted max-w-xs mt-1">
              Configure WebDAV/S3 to sync history, or send a new message below.
            </p>
          </div>
        ) : (
          grouped.map(item => {
            const isGroup = item.isGroup;
            const allSelected = isGroup 
              ? item.messages.every(m => selectedMessageIds.has(m.id))
              : selectedMessageIds.has(item.id);
            const someSelected = isGroup && !allSelected && item.messages.some(m => selectedMessageIds.has(m.id));
            const msgIdOrIds = isGroup ? item.messages.map(m => m.id) : item.id;
            const gestureMsgId = isGroup ? item.messages[0].id : item.id;
            
            const handleRowContextMenu = (e) => {
              e.preventDefault();
              e.stopPropagation();
              const targetMsg = isGroup ? item.messages[0] : item;
              setContextMenu({ msg: targetMsg, msgs: isGroup ? item.messages : [item], x: e.clientX, y: e.clientY });
            };

            return (
              <div 
                key={item.id} 
                onContextMenu={handleRowContextMenu}
                className="flex gap-3 min-w-0 group relative my-1 items-start justify-start"
              >
                {/* Selection Checkbox */}
                {selectedMessageIds.size > 0 && (
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMessageSelection(msgIdOrIds);
                      setSelectionMenuCoords({ x: e.clientX, y: e.clientY });
                    }}
                    className="flex items-center justify-center cursor-pointer px-1 shrink-0 select-none animate-fade-in checkbox-container self-center"
                  >
                    <i className={`text-base fa-regular ${
                      allSelected 
                        ? 'fa-square-check text-accentColor' 
                        : (someSelected 
                            ? 'fa-square-minus text-accentColor' 
                            : 'fa-square text-textMuted')
                    }`}></i>
                  </div>
                )}
                
                {/* Bubble Wrapper */}
                <div 
                  onMouseDown={(e) => handleTouchStart(e, gestureMsgId)}
                  onMouseUp={(e) => handleTouchEnd(e, gestureMsgId)}
                  onMouseMove={(e) => handleTouchMove(e, gestureMsgId)}
                  onTouchStart={(e) => handleTouchStart(e, gestureMsgId)}
                  onTouchEnd={(e) => handleTouchEnd(e, gestureMsgId)}
                  onTouchMove={(e) => handleTouchMove(e, gestureMsgId)}
                  onContextMenu={handleRowContextMenu}
                  className="flex flex-col max-w-[80%] md:max-w-[68%] min-w-0 relative message-bubble items-start"
                >
                  {isPrivacyMode && item.isHidden && (
                    <div className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 font-mono flex items-center gap-1 leading-none mb-1">
                      <i className="fa-solid fa-eye-slash text-[8px]"></i> 隐藏
                    </div>
                  )}

                  {/* Bubble Content Body */}
                  <div className="relative">
                    {isGroup ? (
                      /* RENDER GRID GROUP (NINE GRID) */
                      <div className="border border-borderColor bg-bgSecondary p-1 rounded-lg overflow-hidden shadow-md max-w-[240px]">
                        <div 
                          className="grid gap-1"
                          style={{
                            gridTemplateColumns: `repeat(${item.messages.length === 1 ? 1 : (item.messages.length <= 4 ? 2 : 3)}, 1fr)`
                          }}
                        >
                          {item.messages.map(msg => {
                            const isImgSelected = selectedMessageIds.has(msg.id);
                            return (
                              <div 
                                key={msg.id}
                                className={`relative aspect-square overflow-hidden cursor-pointer bg-bgPrimary hover:opacity-90 border transition-all ${
                                  isImgSelected ? 'border-accentColor ring-1 ring-accentColor' : 'border-transparent'
                                }`}
                                onClick={(e) => {
                                  handleItemClick(e, msg.id, () => {
                                    if (selectedMessageIds.size > 0) {
                                      onToggleMessageSelection(msg.id);
                                    } else {
                                      // Open viewer event handled by App
                                      handleOpenMediaViewer(msg.id);
                                    }
                                  });
                                }}
                              >
                                <img src={msg.url} alt="Grid attachment" className={`w-full h-full object-cover select-none transition-all duration-200 ${isImgSelected ? 'brightness-50' : ''}`} />
                              </div>
                            );
                          })}
                        </div>
                        {item.messages.some(m => m.caption) && (
                          <div className="mt-1 pt-1 border-t border-borderColor/40 text-[11px] text-textSecondary flex items-center gap-1.5 px-1 break-words">
                            <i className="fa-solid fa-note-sticky text-[9px] opacity-70 shrink-0"></i>
                            <span>{item.messages.filter(m => m.caption).map(m => m.caption).join('，')}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* RENDER SINGLE MESSAGE CARD */
                      <div 
                        onClick={(e) => {
                          if (selectedMessageIds.size > 0) {
                            handleItemClick(e, item.id, () => {
                              onToggleMessageSelection(item.id);
                            });
                          }
                        }}
                        className={`text-sm relative break-words select-text ${
                          ['IMAGE', 'VIDEO'].includes(item.type) && !item.caption
                            ? ''
                            : `px-3.5 py-2.5 rounded-xl border shadow-sm ${
                                item.isOutgoing 
                                  ? (['IMAGE', 'VIDEO'].includes(item.type) ? 'bg-bgSecondary border-borderColor text-textPrimary rounded-tr-none' : 'bg-accentColor border-accentColor/40 text-white rounded-tr-none')
                                  : 'bg-bgSecondary border-borderColor text-textPrimary rounded-tl-none'
                              }`
                        }`}
                      >
                        {item.type === 'TEXT' && (
                          /* Text message */
                          <span>{item.content}</span>
                        )}

                        {item.type === 'LOCATION' && (
                          /* Location Card */
                          <div className="flex flex-col gap-2 p-1 cursor-pointer hover:opacity-90 font-sans" onClick={() => {
                            let latlng = '';
                            if (item.content.startsWith('[位置]')) {
                              // Android format: [位置] 纬度: 22.5, 经度: 113.9
                              // Or web format: [位置] 纬度: 22.5, 经度: 113.9
                              const coords = item.content.match(/[0-9.]+/g);
                              if (coords && coords.length >= 2) {
                                latlng = `${coords[0]},${coords[1]}`;
                              }
                            }
                            window.open(`https://maps.google.com/?q=${latlng}`, '_blank');
                          }}>
                            <div className="w-full h-24 bg-black/10 rounded overflow-hidden flex items-center justify-center relative">
                              <i className="fa-solid fa-location-dot text-2xl text-green-500"></i>
                            </div>
                            <div className="text-xs font-semibold px-1 text-center">
                              {item.content.replace('[位置]', '').trim()}
                            </div>
                          </div>
                        )}

                        {item.type === 'AUDIO' && (
                          /* Audio Player Card */
                          <div className="flex items-center gap-3.5 min-w-[200px] font-sans">
                            <audio 
                              ref={el => audioRefs.current[item.id] = el}
                              src={item.url}
                              onTimeUpdate={() => handleAudioTimeUpdate(item.id)}
                              onEnded={() => setAudioPlayingId(null)}
                            />
                            <button 
                              onClick={() => handleToggleAudio(item.id)}
                              className={`w-9 h-9 rounded-full flex items-center justify-center text-sm transition-all shrink-0 ${
                                item.isOutgoing 
                                  ? 'bg-white text-accentColor' 
                                  : 'bg-accentColor text-white'
                              }`}
                            >
                              <i className={`fa-solid ${audioPlayingId === item.id ? 'fa-pause' : 'fa-play'}`}></i>
                            </button>
                            <div className="flex-1 flex flex-col gap-1.5">
                              <div 
                                className="h-1.5 bg-black/20 hover:bg-black/35 rounded-full overflow-hidden cursor-pointer relative"
                                onClick={(e) => handleAudioSeek(item.id, e)}
                              >
                                <div 
                                  className={`h-full ${item.isOutgoing ? 'bg-white' : 'bg-accentColor'}`}
                                  style={{ width: `${audioProgress[item.id]?.progress || 0}%` }}
                                />
                              </div>
                              <span className={`text-[10px] font-mono leading-none ${
                                item.isOutgoing ? 'text-white/80' : 'text-textSecondary'
                              }`}>
                                {formatAudioTime(audioProgress[item.id]?.currentTime || 0)} / {formatAudioTime(audioProgress[item.id]?.duration || 0)}
                              </span>
                            </div>
                          </div>
                        )}

                        {item.type === 'FILE' && (
                          /* File card (APK, PDF, ZIP, etc.) */
                          <div className="flex items-center gap-3.5 min-w-[240px] font-sans justify-between">
                            <div 
                              onClick={(e) => {
                                if (selectedMessageIds.size > 0) return;
                                e.stopPropagation();
                                handleStartDownload(item, true);
                              }}
                              className="flex items-center gap-3.5 min-w-0 flex-1 cursor-pointer hover:opacity-90 active:scale-[0.99] transition-all"
                              title="Click to Preview"
                            >
                              <div className="w-10 h-10 rounded bg-black/10 border border-black/5 flex items-center justify-center text-lg shrink-0">
                                <i className={`fa-solid ${
                                  item.content.toUpperCase().endsWith('.APK') ? 'fa-box-archive' : 
                                  item.content.toUpperCase().endsWith('.PDF') ? 'fa-file-pdf' : 
                                  (['.ZIP', '.RAR', '.7Z'].some(ext => item.content.toUpperCase().endsWith(ext))) ? 'fa-file-zipper' : 
                                  'fa-file'
                                }`}></i>
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="font-semibold block text-xs truncate leading-snug">
                                  {item.content.replace(/^\d+_/, '')}
                                </span>
                                <span className="text-[10px] text-textMuted block mt-0.5">
                                  {item.fileSize ? formatSize(item.fileSize) : 'Unknown size'}
                                </span>
                                {downloads[item.id] && (
                                  <div className="mt-1.5 flex flex-col gap-1">
                                    <div className="h-1 bg-black/20 rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-accentColor transition-all"
                                        style={{ width: `${downloads[item.id].progress}%` }}
                                      />
                                    </div>
                                    <span className="text-[9px] text-textMuted block font-mono">
                                      {downloads[item.id].progress}% {downloads[item.id].status === 'paused' ? '(paused)' : ''}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1.5 shrink-0 z-10" onClick={(e) => e.stopPropagation()}>
                              {!downloads[item.id] && (
                                <button 
                                  onClick={() => handleStartDownload(item, false)}
                                  className="w-7 h-7 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-xs"
                                  title="Download"
                                >
                                  <i className="fa-solid fa-download"></i>
                                </button>
                              )}
                              {downloads[item.id]?.status === 'downloading' && (
                                <button 
                                  onClick={() => handlePauseDownload(item.id)}
                                  className="w-7 h-7 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-xs"
                                  title="Pause"
                                >
                                  <i className="fa-solid fa-pause"></i>
                                </button>
                              )}
                              {downloads[item.id]?.status === 'paused' && (
                                <button 
                                  onClick={() => handleResumeDownload(item.id)}
                                  className="w-7 h-7 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-xs"
                                  title="Resume"
                                >
                                  <i className="fa-solid fa-play"></i>
                                </button>
                              )}
                              {downloads[item.id] && (
                                <button 
                                  onClick={() => handleCancelDownload(item.id)}
                                  className="w-7 h-7 rounded-full bg-black/5 hover:bg-red-500/10 flex items-center justify-center text-xs hover:text-red-500"
                                  title="Cancel"
                                >
                                  <i className="fa-solid fa-xmark"></i>
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {item.type === 'FOLDER' && (
                          /* Folder Card */
                          <div 
                            className="flex items-center gap-3.5 min-w-[200px] font-sans cursor-pointer hover:opacity-80 p-1"
                            onClick={(e) => {
                              if (selectedMessageIds.size > 0) return;
                              e.stopPropagation();
                              setCurrentFolderId(item.id);
                            }}
                          >
                            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-500 text-lg shrink-0">
                              <i className="fa-solid fa-folder"></i>
                            </div>
                            <div className="flex flex-col flex-1 min-w-0">
                              <span className="text-sm font-semibold truncate text-textPrimary">
                                {item.content || '文件夹'}
                              </span>
                              <span className="text-[10px] text-textMuted">点击进入文件夹</span>
                            </div>
                          </div>
                        )}

                        {item.type === 'IMAGE' && (
                          /* Single Image attachment */
                          <div 
                            className="message-media"
                            onClick={(e) => {
                              handleItemClick(e, item.id, () => {
                                if (selectedMessageIds.size > 0) {
                                  onToggleMessageSelection(item.id);
                                } else {
                                  handleOpenMediaViewer(item.id);
                                }
                              });
                            }}
                          >
                            <img src={item.url} alt="Attachment" className={`select-none transition-all duration-200 ${allSelected ? 'brightness-50' : ''}`} />
                          </div>
                        )}

                        {item.type === 'VIDEO' && (
                          /* Single Video attachment */
                          <div 
                            className="message-media"
                            onClick={(e) => {
                              handleItemClick(e, item.id, () => {
                                if (selectedMessageIds.size > 0) {
                                  onToggleMessageSelection(item.id);
                                } else {
                                  const video = e.currentTarget.querySelector('video');
                                  if (e.nativeEvent.offsetY < video.clientHeight - 40) {
                                    video.pause();
                                    handleOpenMediaViewer(item.id);
                                  }
                                }
                              });
                            }}
                          >
                            <video src={item.url} controls className={`transition-all duration-200 ${allSelected ? 'brightness-50' : ''}`} />
                          </div>
                        )}

                        {item.status === 'SENDING' && activeUploads && activeUploads[item.id] !== undefined && (
                          <div className="mt-2 w-full min-w-[180px] font-sans">
                            <div className="flex justify-between items-center text-[10px] text-white/80 mb-1 leading-none">
                              <span className="flex items-center gap-1">
                                <i className="fa-solid fa-spinner fa-spin text-[8px]"></i> Uploading...
                              </span>
                              <span className="font-mono font-semibold">{activeUploads[item.id]}%</span>
                            </div>
                            <div className="h-1 bg-black/25 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-white transition-all duration-150"
                                style={{ width: `${activeUploads[item.id]}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {item.caption && (
                          <div className={`mt-1 px-2 py-1 rounded text-xs border flex items-center gap-1.5 break-words ${
                            item.isOutgoing 
                              ? 'bg-black/20 text-white/85 border-white/15' 
                              : 'bg-black/10 text-textSecondary border-borderColor/50'
                          }`}>
                            <i className="fa-solid fa-note-sticky text-[10px] opacity-70 shrink-0"></i>
                            <span>{item.caption}</span>
                          </div>
                        )}

                        {/* Message Time and Status (Sending / Failed / Edited) */}
                        <div className={`flex items-center gap-1 text-[9px] font-mono leading-none mt-1 justify-end ${
                          item.isOutgoing ? 'text-white/70' : 'text-textMuted'
                        }`}>
                          {item.isEdited && <span className="opacity-80">(已编辑)</span>}
                          {formatTime(item.timestamp)}
                          {item.isOutgoing && (
                            <span className="shrink-0">
                              {item.status === 'SENDING' ? (
                                <i className="fa-solid fa-spinner fa-spin text-[8px]"></i>
                              ) : item.status === 'FAILED' ? (
                                <i className="fa-solid fa-circle-exclamation text-red-500 text-[8px]"></i>
                              ) : null}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Side Column (name + avatar) for ALL messages */}
                <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                  <span className="text-[11px] font-semibold text-textMuted leading-tight whitespace-nowrap max-w-[72px] text-right truncate">
                    {item.senderName || item.sender || (item.isOutgoing ? (currentProfile?.username || 'Me') : 'User')}
                  </span>
                  {(() => {
                    const senderName = item.senderName || item.sender || (item.isOutgoing ? (currentProfile?.username || 'Me') : 'User');
                    const fallback = `https://api.dicebear.com/7.x/bottts/png?seed=${encodeURIComponent(senderName)}`;
                    // Only fallback to currentProfile.avatar if the message belongs to current profile user
                    const isCurrentProfileUser = item.isOutgoing || 
                      (currentProfile?.username && (item.sender === currentProfile.username || item.senderName === currentProfile.username));
                    const rawAvatar = item.senderAvatar || (isCurrentProfileUser ? currentProfile?.avatar : null);
                    // Look up the resolved blob URL; for data:/blob: URLs or Dicebear presets use directly
                    const isSafe = (u) => u && (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('https://api.dicebear.com'));
                    const resolvedBlob = rawAvatar && avatarBlobUrls[rawAvatar];
                    const avatarSrc = resolvedBlob || (isSafe(rawAvatar) ? rawAvatar : fallback);
                    return (
                      <img 
                        src={avatarSrc}
                        alt="Avatar"
                        className="w-11 h-11 rounded-2xl object-cover border-2 border-borderColor/60 bg-bgSecondary shadow-sm"
                      />
                    );
                  })()}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Inputs Footer Area - Zero rounding to save space, flat alignment */}
      <footer className="border-t border-borderColor bg-bgSecondary p-2 shrink-0">
        <div className="flex gap-2 items-end">
          <label className="w-9 h-9 rounded flex items-center justify-center text-textSecondary hover:text-accentColor hover:bg-white/5 transition-all cursor-pointer shrink-0">
            <input 
              type="file" 
              multiple 
              onChange={handleFileChange}
              className="hidden" 
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip"
            />
            <i className="fa-solid fa-plus text-lg"></i>
          </label>
          <button 
            onClick={handleShareLocation}
            className="w-9 h-9 rounded flex items-center justify-center text-textSecondary hover:text-accentColor hover:bg-white/5 transition-all shrink-0"
            title="Share simulated location"
          >
            <i className="fa-solid fa-location-dot text-base"></i>
          </button>
          
          <div className="flex-1 min-w-0 bg-bgPrimary border border-borderColor rounded px-3 py-1 flex items-center">
            <textarea 
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type a message..."
              className="flex-1 bg-transparent text-textPrimary text-sm py-1.5 focus:outline-none resize-none overflow-y-auto max-h-32"
            />
          </div>

          <button 
            onClick={handleSend}
            onMouseDown={handleSendMouseDown}
            onMouseUp={handleSendMouseUp}
            onTouchStart={handleSendMouseDown}
            onTouchEnd={handleSendMouseUp}
            disabled={!inputText.trim()}
            className={`w-9 h-9 rounded flex items-center justify-center text-white transition-all shrink-0 ${
              inputText.trim() ? 'bg-accentColor hover:bg-accentHover shadow-md shadow-accentColor/10' : 'bg-borderColor/50 text-textMuted cursor-not-allowed'
            }`}
          >
            <i className="fa-solid fa-paper-plane"></i>
          </button>
        </div>
      </footer>

      {/* Floating Contextual Multi-Selection Actions Bar */}
      {selectedMessageIds.size > 0 && selectionMenuCoords && (
        <div 
          style={{ 
            position: 'fixed',
            left: Math.max(10, Math.min(selectionMenuCoords.x + 25, window.innerWidth - 300)),
            top: Math.max(10, Math.min(selectionMenuCoords.y - 25, window.innerHeight - 60)),
            zIndex: 9999
          }}
          className="bg-bgSecondary border border-borderColor rounded-lg shadow-2xl p-1 flex gap-1.5 items-center animate-fade-in"
        >
          {/* 添加分类 with Dropdown Submenu */}
          <div 
            className="relative"
            onMouseEnter={() => setShowBulkAddCatSubmenu(true)}
            onMouseLeave={() => setShowBulkAddCatSubmenu(false)}
          >
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                setShowBulkAddCatSubmenu(!showBulkAddCatSubmenu); 
              }}
              className="px-2.5 py-1.5 text-xs font-semibold text-textPrimary hover:bg-white/5 rounded transition-all flex items-center gap-1.5 shrink-0"
            >
              <i className="fa-solid fa-tag text-accentColor"></i> 添加分类
              <i className="fa-solid fa-chevron-down text-[9px] text-textMuted"></i>
            </button>

            {/* Bulk Add Category Dropdown Submenu with Bridge Zone */}
            {showBulkAddCatSubmenu && (
              <div 
                className="absolute left-0 bottom-full mb-1 bg-bgSecondary border border-borderColor rounded-xl shadow-2xl py-1.5 min-w-[140px] animate-fade-in backdrop-blur-sm z-50 before:content-[''] before:absolute before:-bottom-3 before:left-0 before:right-0 before:h-4"
              >
                {Object.entries(CATEGORY_MAP).map(([catId, label]) => (
                  <button
                    key={catId}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onQuickAddCategory) onQuickAddCategory(catId, null);
                      setShowBulkAddCatSubmenu(false);
                    }}
                    className="w-full px-3 py-1.5 text-xs text-textPrimary hover:bg-white/5 transition-colors flex items-center gap-2"
                  >
                    <i className={`text-xs ${
                      catId === 'diary' ? 'fa-solid fa-book text-amber-400' :
                      catId === 'transfer' ? 'fa-solid fa-right-left text-blue-400' :
                      catId === 'work' ? 'fa-solid fa-briefcase text-purple-400' :
                      'fa-solid fa-user-lock text-red-400'
                    }`}></i>
                    {label}
                  </button>
                ))}
                <div className="my-1 border-t border-borderColor"></div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddCategorySelected();
                    setShowBulkAddCatSubmenu(false);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-textMuted hover:bg-white/5 transition-colors flex items-center gap-2"
                >
                  <i className="fa-solid fa-ellipsis w-4 text-center"></i> 更多分类...
                </button>
              </div>
            )}
          </div>

          {/* Pack to Folder Option */}
          <button 
            onClick={(e) => { e.stopPropagation(); onPackFolder(); }}
            className="px-2.5 py-1.5 text-xs font-semibold text-cyan-400 hover:bg-cyan-500/10 rounded transition-all flex items-center gap-1.5 shrink-0"
            title="将选中的消息打包合并到文件夹中"
          >
            <i className="fa-solid fa-folder-plus"></i> 打包文件夹
          </button>

          {/* Remove from Folder Option (only when inside a folder) */}
          {currentFolderId && (
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                if (onRemoveMessagesFromFolder) {
                  onRemoveMessagesFromFolder(messages.filter(m => selectedMessageIds.has(m.id))); 
                }
              }}
              className="px-2.5 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/10 rounded transition-all flex items-center gap-1.5 shrink-0"
              title="将选中的消息移出当前文件夹"
            >
              <i className="fa-solid fa-folder-minus"></i> 移出文件夹
            </button>
          )}

          {/* Merge Selected Messages Option */}
          {(() => {
            const nonFolderSelected = messages.filter(m => selectedMessageIds.has(m.id) && m.type !== 'FOLDER');
            const existingGroupIds = new Set(
              nonFolderSelected.filter(m => m.groupId).map(m => m.groupId)
            );
            const totalTargetCount = messages.filter(
              m => m.type !== 'FOLDER' && (selectedMessageIds.has(m.id) || (m.groupId && existingGroupIds.has(m.groupId)))
            ).length;
            return totalTargetCount >= 2 ? (
              <button 
                onClick={(e) => { e.stopPropagation(); onGroupSelected(); }}
                className="px-2.5 py-1.5 text-xs font-semibold text-purple-400 hover:bg-purple-500/10 rounded transition-all flex items-center gap-1.5 shrink-0"
                title="将选中的非文件夹消息合并为一个组合"
              >
                <i className="fa-solid fa-object-group"></i> 合并消息
              </button>
            ) : null;
          })()}

          {/* Ungroup Selected Messages Option */}
          {Array.from(selectedMessageIds).some(id => messages.find(m => m.id === id)?.groupId) && (
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                onUngroupMessage(messages.filter(m => selectedMessageIds.has(m.id))); 
              }}
              className="px-2.5 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/10 rounded transition-all flex items-center gap-1.5 shrink-0"
              title="将选中的消息从所在组合中拆散出来"
            >
              <i className="fa-solid fa-object-ungroup"></i> 拆散选中消息
            </button>
          )}

          {/* Privacy Hide/Unhide Selected Messages */}
          {isPrivacyMode && (
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                if (onToggleHideMessage) {
                  onToggleHideMessage(messages.filter(m => selectedMessageIds.has(m.id))); 
                }
              }}
              className="px-2.5 py-1.5 text-xs font-semibold text-purple-400 hover:bg-purple-500/10 rounded transition-all flex items-center gap-1.5 shrink-0"
              title="切换选中条目的隐藏/展示状态"
            >
              <i className="fa-solid fa-eye-slash"></i> 隐藏/取消隐藏
            </button>
          )}

          {/* Generate Diary from Selected Messages */}
          <button 
            onClick={(e) => {
              e.stopPropagation();
              const selectedMsgs = messages.filter(m => selectedMessageIds.has(m.id));
              if (onOpenDiaryExport) onOpenDiaryExport(selectedMsgs);
            }}
            className="px-2.5 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/30 rounded transition-all flex items-center gap-1.5 shrink-0"
            title="将选中的消息直接生成精美 HTML 静态日记网页"
          >
            <i className="fa-solid fa-book-bookmark text-emerald-400"></i> 生成日记
          </button>

          {activeCategory !== 'all' && (
            <button 
              onClick={(e) => { e.stopPropagation(); onRemoveCategorySelected(); }}
              className="px-2.5 py-1.5 text-xs font-semibold text-textPrimary hover:bg-white/5 rounded transition-all flex items-center gap-1.5 shrink-0"
            >
              <i className="fa-solid fa-tags text-textMuted"></i> 移出分类
            </button>
          )}
          <button 
            onPointerDown={(e) => {
              e.stopPropagation();
              window.deleteBtnTimer = setTimeout(() => {
                window.deleteBtnTimer = null;
                if (navigator.vibrate) navigator.vibrate(50);
                const msgsToHide = messages.filter(m => selectedMessageIds.has(m.id));
                onToggleHideMessage(msgsToHide);
                onClearSelection();
              }, 2000);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              if (window.deleteBtnTimer) {
                clearTimeout(window.deleteBtnTimer);
                window.deleteBtnTimer = null;
                onDeleteSelected();
              }
            }}
            onPointerLeave={(e) => {
              if (window.deleteBtnTimer) {
                clearTimeout(window.deleteBtnTimer);
                window.deleteBtnTimer = null;
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
            className="px-2.5 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-500/10 rounded transition-all flex items-center gap-1.5 shrink-0"
          >
            <i className="fa-regular fa-trash-can"></i> 删除
          </button>
        </div>
      )}

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            left: Math.max(10, Math.min(contextMenu.x + 15, window.innerWidth - 190)),
            top: Math.max(10, Math.min(contextMenu.y - 5, window.innerHeight - 250)),
            zIndex: 9999
          }}
          className="bg-bgSecondary border border-borderColor rounded-xl shadow-2xl py-1.5 min-w-[170px] animate-fade-in backdrop-blur-sm"
        >
          {/* Copy Text — only for text messages */}
          {contextMenu.msg.type === 'TEXT' && (
            <>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.msg.content).catch(() => {});
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-xs text-textPrimary hover:bg-white/5 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-regular fa-copy text-textMuted w-4 text-center"></i> 复制文本
              </button>

              <button
                onClick={() => {
                  const newText = prompt('编辑文本消息：', contextMenu.msg.content);
                  if (newText !== null && newText.trim()) {
                    if (onEditTextMessage) onEditTextMessage(contextMenu.msg.id, newText.trim());
                  }
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-xs text-textPrimary hover:bg-white/5 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-pen-to-square text-accentColor w-4 text-center"></i> 编辑消息
              </button>
            </>
          )}

          {/* Folder Specific Actions */}
          {contextMenu.msg.type === 'FOLDER' && (
            <>
              <button
                onClick={() => {
                  if (onOpenDiaryExport) onOpenDiaryExport(contextMenu.msg);
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-xs text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center gap-2.5 font-semibold"
              >
                <i className="fa-solid fa-book-bookmark text-emerald-400 w-4 text-center"></i> 生成静态日记网页
              </button>
              <button
                onClick={() => {
                  if (onRenameFolder) onRenameFolder(contextMenu.msg);
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-xs text-cyan-400 hover:bg-cyan-500/10 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-pen text-cyan-400 w-4 text-center"></i> 重命名文件夹
              </button>
              <button
                onClick={() => {
                  if (onUnpackFolder) onUnpackFolder(contextMenu.msg);
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-folder-minus text-red-400 w-4 text-center"></i> 解散文件夹
              </button>
            </>
          )}

          {/* Remove from Folder Action (when inside a folder) */}
          {currentFolderId && contextMenu.msg.type !== 'FOLDER' && (
            <button
              onClick={() => {
                if (onRemoveMessagesFromFolder) onRemoveMessagesFromFolder(contextMenu.msgs);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-2.5"
            >
              <i className="fa-solid fa-folder-minus text-amber-400 w-4 text-center"></i> 移出当前文件夹
            </button>
          )}

          {/* Add/Edit Caption — for non-text & non-folder messages */}
          {contextMenu.msg.type !== 'TEXT' && contextMenu.msg.type !== 'FOLDER' && (
            <button
              onClick={() => {
                const newCap = prompt('为该非文本条目添加/修改注释（方便搜索）：', contextMenu.msg.caption || '');
                if (newCap !== null) {
                  if (onUpdateCaption) onUpdateCaption(contextMenu.msg.id, newCap.trim());
                }
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-2.5"
            >
              <i className="fa-solid fa-note-sticky w-4 text-center"></i> {contextMenu.msg.caption ? '修改注释' : '添加注释'}
            </button>
          )}

          {/* Select — enter multi-select mode */}
          <button
            onClick={() => {
              const ids = contextMenu.msgs.map(m => m.id);
              ids.forEach(id => onToggleMessageSelection(id));
              setSelectionMenuCoords({ x: contextMenu.x, y: contextMenu.y });
              setContextMenu(null);
            }}
            className="w-full px-4 py-2 text-xs text-textPrimary hover:bg-white/5 transition-colors flex items-center gap-2.5"
          >
            <i className="fa-regular fa-square-check text-textMuted w-4 text-center"></i> 多选
          </button>

          {/* Hide / Unhide Option (Only in Privacy Mode) */}
          {isPrivacyMode && (
            <button
              onClick={() => {
                if (onToggleHideMessage) onToggleHideMessage(contextMenu.msgs);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-xs text-purple-400 hover:bg-purple-500/10 transition-colors flex items-center gap-2.5"
            >
              <i className={`fa-solid ${contextMenu.msg.isHidden ? 'fa-eye' : 'fa-eye-slash'} w-4 text-center`}></i>
              {contextMenu.msg.isHidden ? '取消隐藏此消息' : '设为隐藏条目'}
            </button>
          )}

          {/* Ungroup option if right clicking a grouped card */}
          {(contextMenu.msg.groupId || contextMenu.msgs.length > 1) && (
            <button
              onClick={() => {
                onUngroupMessage(contextMenu.msgs);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-2.5"
            >
              <i className="fa-solid fa-object-ungroup w-4 text-center"></i> 拆散组合
            </button>
          )}

          {/* Divider */}
          <div className="my-1 border-t border-borderColor"></div>

          {/* Add to Category with Seamless Flyout Secondary Submenu */}
          <div 
            className="relative"
            onMouseEnter={() => setShowCategorySubmenu(true)}
            onMouseLeave={() => setShowCategorySubmenu(false)}
          >
            <button
              onClick={() => {
                setShowCategorySubmenu(!showCategorySubmenu);
              }}
              className="w-full px-4 py-2 text-xs text-textPrimary hover:bg-white/5 transition-colors flex items-center justify-between gap-2.5"
            >
              <span className="flex items-center gap-2.5">
                <i className="fa-solid fa-tag text-accentColor w-4 text-center"></i> 添加到分类
              </span>
              <i className="fa-solid fa-chevron-right text-[10px] text-textMuted"></i>
            </button>

            {/* Category Flyout Submenu with Bridge Zone */}
            {showCategorySubmenu && (
              <div 
                className="absolute left-full top-0 -ml-1 bg-bgSecondary border border-borderColor rounded-xl shadow-2xl py-1.5 min-w-[140px] animate-fade-in backdrop-blur-sm z-50 before:content-[''] before:absolute before:-left-4 before:top-0 before:bottom-0 before:w-6"
              >
                {Object.entries(CATEGORY_MAP).map(([catId, label]) => {
                  const hasCat = (contextMenu.msg.categories || []).includes(catId) || (contextMenu.msg.categories || []).includes(label);
                  return (
                    <button
                      key={catId}
                      onClick={() => {
                        if (onQuickAddCategory) onQuickAddCategory(catId, contextMenu.msg);
                        setContextMenu(null);
                        setShowCategorySubmenu(false);
                      }}
                      className="w-full px-3 py-1.5 text-xs text-textPrimary hover:bg-white/5 transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-2">
                        <i className={`text-xs ${
                          catId === 'diary' ? 'fa-solid fa-book text-amber-400' :
                          catId === 'transfer' ? 'fa-solid fa-right-left text-blue-400' :
                          catId === 'work' ? 'fa-solid fa-briefcase text-purple-400' :
                          'fa-solid fa-user-lock text-red-400'
                        }`}></i>
                        {label}
                      </span>
                      {hasCat && <i className="fa-solid fa-check text-accentColor text-[10px]"></i>}
                    </button>
                  );
                })}
                <div className="my-1 border-t border-borderColor"></div>
                <button
                  onClick={() => {
                    onEditMessageCategories(contextMenu.msg);
                    setContextMenu(null);
                    setShowCategorySubmenu(false);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-textMuted hover:bg-white/5 transition-colors flex items-center gap-2"
                >
                  <i className="fa-solid fa-ellipsis w-4 text-center"></i> 更多分类...
                </button>
              </div>
            )}
          </div>

          {/* Remove from current category — only when viewing a specific category */}
          {activeCategory !== 'all' && (contextMenu.msg.categories || []).includes(activeCategory) && (
            <button
              onClick={() => {
                // Select just this message and call remove
                onToggleMessageSelection(contextMenu.msg.id);
                setTimeout(() => onRemoveCategorySelected(), 50);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-xs text-textPrimary hover:bg-white/5 transition-colors flex items-center gap-2.5"
            >
              <i className="fa-solid fa-tags text-textMuted w-4 text-center"></i> 移出当前分类
            </button>
          )}

          {/* Divider */}
          <div className="my-1 border-t border-borderColor"></div>

          {/* Delete */}
          <button
            onClick={() => {
              onDeleteMessage(contextMenu.msg);
              setContextMenu(null);
            }}
            className="w-full px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2.5"
          >
            <i className="fa-regular fa-trash-can w-4 text-center"></i> 删除消息
          </button>
        </div>
      )}
    </main>
  );
}
