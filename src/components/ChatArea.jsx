import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createDownloadState } from '../services/storage';
import { getCachedFile, cacheFile } from '../services/db';
import CalendarModal from './CalendarModal';
import InputModal from './InputModal';
import { getInitialAvatar } from '../utils/avatar';

const logDebug = (msg) => {
  if (typeof window !== 'undefined' && window.__addDebugLog) {
    window.__addDebugLog(msg);
  }
};

async function invokeTauri(cmd, args = {}) {
  if (typeof window !== 'undefined') {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      return await window.__TAURI__.core.invoke(cmd, args);
    }
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
      return await window.__TAURI_INTERNALS__.invoke(cmd, args);
    }
  }
  return await invoke(cmd, args);
}

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
  onMoveIntoFolder,
  onOpenDiaryExport,
  onDiaryChanged,
  isPrivacyMode = false,
  onEnterPrivacyMode,
  onExitPrivacyMode,
  onChangePrivacyPin,
  onToggleHideMessage,
  onEditTextMessage,
  onUpdateCaption,
  onSendMessage,
  onRetryMessage,
  onToggleSidebar,
  storageClient,
  resolveAvatarUrl,
  isSyncing,
  activeUploads
}) {
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const lastSavedFilePathRef = useRef('');
  // Cache of resolved avatar blob URLs keyed by raw avatar value (filename or data: URL)
  const [avatarBlobUrls, setAvatarBlobUrls] = useState({});
  const [expandedFileIds, setExpandedFileIds] = useState(new Set());

  // Resolve all unique avatar values in current messages to displayable URLs
  useEffect(() => {
    if (!resolveAvatarUrl) return;
    const avatarValues = new Set();
    messages.forEach(item => {
      if (item.senderAvatar) avatarValues.add(item.senderAvatar);
    });
    avatarValues.forEach(async (av) => {
      const resolved = await resolveAvatarUrl(av);
      if (resolved) {
        setAvatarBlobUrls(prev => {
          if (prev[av] === resolved) return prev;
          return { ...prev, [av]: resolved };
        });
      }
    });
  }, [messages, resolveAvatarUrl]);

  // Search query state for persistent header search
  const [searchQuery, setSearchQuery] = useState('');
  const [showCalendarModal, setShowCalendarModal] = useState(false);

  const handleSelectCalendarDate = (dateStr) => {
    const targetIdx = filteredMessages.findIndex(m => {
      if (!m.timestamp) return false;
      const d = new Date(m.timestamp);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}` === dateStr;
    });

    if (targetIdx !== -1) {
      const targetMsg = filteredMessages[targetIdx];
      const offsetFromEnd = filteredMessages.length - targetIdx;
      if (offsetFromEnd > visibleCount) {
        setVisibleCount(offsetFromEnd + 50);
      }
      setTimeout(() => {
        const el = document.getElementById(`msg-item-${targetMsg.id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-accentColor', 'bg-accentColor/10');
          setTimeout(() => el.classList.remove('ring-2', 'ring-accentColor', 'bg-accentColor/10'), 2500);
        }
      }, 150);
    }
  };

  // Privacy Mode states
  const [viewHiddenOnly, setViewHiddenOnly] = useState(false);
  const sendLongPressRef = useRef(null);

  // Detect whether a precise pointer (mouse) is available
  const [hasMouse, setHasMouse] = useState(false);
  useEffect(() => {
    const mqHover = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setHasMouse(mqHover.matches);
    update();
    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse') setHasMouse(true);
    };
    window.addEventListener('pointerdown', onPointerDown);
    if (typeof mqHover.addEventListener === 'function') {
      mqHover.addEventListener('change', update);
    }
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      if (typeof mqHover.removeEventListener === 'function') {
        mqHover.removeEventListener('change', update);
      }
    };
  }, []);
  
  // Touch long press state ref
  const touchTimersRef = useRef({});
  // Long-press timer for the delete button (long press = move to privacy)
  const deleteLongPressRef = useRef(null);
  const deleteLongPressFiredRef = useRef(false);

  // —— 范围选择（Shift 模式）——
  // 激活后，点击任意条目会把「当前已选中的第一条」到「点击的条目」之间全选
  const [rangeSelectActive, setRangeSelectActive] = useState(false);
  const rangeAnchorRef = useRef(null);

  const handleToggleRangeSelect = () => {
    if (rangeSelectActive) {
      setRangeSelectActive(false);
      rangeAnchorRef.current = null;
      return;
    }
    if (selectedMessageIds.size === 0) return;
    // 锚点 = 当前已选条目中，在列表里索引最小的一条
    const selectedIndices = filteredMessages
      .map((m, i) => selectedMessageIds.has(m.id) ? i : -1)
      .filter(i => i >= 0);
    if (selectedIndices.length === 0) return;
    const anchorIndex = Math.min(...selectedIndices);
    rangeAnchorRef.current = filteredMessages[anchorIndex]?.id ?? null;
    setRangeSelectActive(true);
  };

  // 范围选择：选中 anchor 与 target 之间（含两端）的所有条目
  const selectRangeTo = (targetMsgId) => {
    const anchorId = rangeAnchorRef.current;
    if (!anchorId) {
      setRangeSelectActive(false);
      onToggleMessageSelection(targetMsgId);
      return;
    }
    const anchorIdx = filteredMessages.findIndex(m => m.id === anchorId);
    const targetIdx = filteredMessages.findIndex(m => m.id === targetMsgId);
    if (anchorIdx === -1 || targetIdx === -1) {
      setRangeSelectActive(false);
      rangeAnchorRef.current = null;
      return;
    }
    const lo = Math.min(anchorIdx, targetIdx);
    const hi = Math.max(anchorIdx, targetIdx);
    const rangeIds = filteredMessages.slice(lo, hi + 1).map(m => m.id);
    onToggleMessageSelection(rangeIds);
    setRangeSelectActive(false);
    rangeAnchorRef.current = null;
  };

  // 清理：取消多选时退出范围模式
  useEffect(() => {
    if (selectedMessageIds.size === 0 && rangeSelectActive) {
      setRangeSelectActive(false);
      rangeAnchorRef.current = null;
    }
  }, [selectedMessageIds.size, rangeSelectActive]);

  const handleTouchStart = (e, msgId) => {
    // Only allow left mouse button; touch devices handled by pointerType
    if (e.type === 'mousedown' && e.button !== 0) return;
    // With a mouse, long-press should NOT enter multi-select (right-click menu is used instead)
    if (e.pointerType === 'mouse') return;
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
      if (rangeSelectActive) {
        selectRangeTo(msgId);
      } else {
        onToggleMessageSelection(msgId);
        // Position menu near the click
        setSelectionMenuCoords({ x: e.clientX, y: e.clientY });
      }
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

  // Scroll lock preference state (persisted in localStorage)
  const [lockScroll, setLockScroll] = useState(() => {
    return typeof localStorage !== 'undefined' && localStorage.getItem('cloudchat_lock_scroll') === 'true';
  });

  // Fast scrollbar thumb state & refs
  const [scrollThumbInfo, setScrollThumbInfo] = useState({ visible: false, topRatio: 0, heightRatio: 0.1, isDragging: false });
  const scrollHideTimerRef = useRef(null);
  const isDraggingThumbRef = useRef(false);
  const scrollStartTopRef = useRef(null);

  // Folder navigation state (multi-level stack)
  const [folderStack, setFolderStack] = useState([]);
  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1] : null;

  // Pagination & Lazy Load States
  const [visibleCount, setVisibleCount] = useState(100);

  // Generic Input Modal State
  const [inputModalConfig, setInputModalConfig] = useState({
    isOpen: false,
    title: '',
    hint: '',
    defaultValue: '',
    placeholder: '',
    inputType: 'text',
    confirmText: '确定',
    onConfirm: () => {}
  });

  // WebDAV Diary Files listing state
  const [diaryFiles, setDiaryFiles] = useState([]);
  const [isLoadingDiary, setIsLoadingDiary] = useState(false);
  const [previewWebUrl, setPreviewWebUrl] = useState(null);

  const fetchDiaryFiles = React.useCallback(async () => {
    if (!storageClient || !storageClient.listDiaryFiles) return;
    setIsLoadingDiary(true);
    try {
      const list = await storageClient.listDiaryFiles();
      setDiaryFiles(list || []);
    } catch (e) {
      console.error('Failed to list WebDAV diary files:', e);
    } finally {
      setIsLoadingDiary(false);
    }
  }, [storageClient]);

  useEffect(() => {
    if (activeCategory === 'diary') {
      fetchDiaryFiles();
      if (listRef.current) {
        listRef.current.scrollTop = 0;
      }
    }
  }, [activeCategory, fetchDiaryFiles]);
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
      // 0. Deleted filter
      if (msg.isDeleted) return false;

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

  const startScrollTopRef = useRef(null);

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

    // Fast scrollbar position update (ignore during active touch/mouse dragging)
    if (isDraggingThumbRef.current) return;

    const scrollableDist = el.scrollHeight - el.clientHeight;
    if (scrollableDist > 40) {
      if (scrollStartTopRef.current === null) {
        scrollStartTopRef.current = el.scrollTop;
      }

      const distanceScrolled = Math.abs(el.scrollTop - scrollStartTopRef.current);
      const isPastThreshold = distanceScrolled > el.clientHeight * 1.5;

      const fraction = Math.max(0, Math.min(1, el.scrollTop / scrollableDist));

      if (isPastThreshold) {
        setScrollThumbInfo(prev => ({
          ...prev,
          visible: true,
          topRatio: fraction
        }));
      } else {
        setScrollThumbInfo(prev => ({
          ...prev,
          topRatio: fraction
        }));
      }

      if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
      scrollHideTimerRef.current = setTimeout(() => {
        if (!isDraggingThumbRef.current) {
          setScrollThumbInfo(prev => ({ ...prev, visible: false }));
          scrollStartTopRef.current = null;
        }
      }, 1000);
    }
  };

  const handleThumbPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const targetEl = e.currentTarget;
    try {
      targetEl.setPointerCapture(e.pointerId);
    } catch (_) {}

    isDraggingThumbRef.current = true;
    setScrollThumbInfo(prev => ({ ...prev, isDragging: true, visible: true }));

    const containerEl = listRef.current;
    if (!containerEl) return;

    const rect = containerEl.getBoundingClientRect();
    const containerHeight = rect.height;
    const thumbSize = 48;
    const availableTravel = Math.max(1, containerHeight - thumbSize);
    const scrollableDist = containerEl.scrollHeight - containerEl.clientHeight;

    const updateScrollPos = (clientY) => {
      const offsetY = Math.max(0, Math.min(availableTravel, clientY - rect.top - (thumbSize / 2)));
      const fraction = offsetY / availableTravel;
      containerEl.scrollTop = fraction * scrollableDist;
      setScrollThumbInfo(prev => ({ ...prev, topRatio: fraction }));
    };

    updateScrollPos(e.clientY);

    const onPointerMove = (moveEvt) => {
      if (isDraggingThumbRef.current) {
        moveEvt.preventDefault();
        updateScrollPos(moveEvt.clientY);
      }
    };

    const onPointerUp = (upEvt) => {
      try {
        targetEl.releasePointerCapture(upEvt.pointerId);
      } catch (_) {}
      isDraggingThumbRef.current = false;
      setScrollThumbInfo(prev => ({ ...prev, isDragging: false }));
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
      scrollHideTimerRef.current = setTimeout(() => {
        setScrollThumbInfo(prev => ({ ...prev, visible: false }));
      }, 500);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
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
          if (onEnterPrivacyMode(pin)) {
            setInputText('');
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
    
    const displayName = msg.content.replace(/^\d+_/, '');
    
    // 先查询本地 IndexedDB 缓存（如果已缓存，则为秒开，绝不触发 UI 下载动画）
    let blob = await getCachedFile(msg.id);
    const isCached = !!blob;

    let dlState = null;
    if (!isCached) {
      dlState = createDownloadState();
      setDownloads(prev => ({
        ...prev,
        [msg.id]: { progress: 0, status: 'downloading', dlState }
      }));
    }

    try {
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

        const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
        const isPyWebView = typeof window !== 'undefined' && window.pywebview && window.pywebview.api;
        const isDesktopApp = isTauri || isPyWebView;

        // 在桌面客户端模式下，只有图片/音视频在内建播放器查看，PDF 及所有文档走原生关联程序打开
        const previewableExtensions = isDesktopApp 
          ? ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm']
          : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'pdf', 'txt', 'json', 'xml', 'html', 'htm', 'js', 'css', 'md', 'log'];
        const isPreviewable = previewableExtensions.includes(ext);

        if (isTauri) {
          logDebug(`[Tauri File Action] file: ${displayName}, openInBrowser: ${openInBrowser}, isPreviewable: ${isPreviewable}`);
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64 = reader.result.split(',')[1];
            if (openInBrowser) {
              if (isPreviewable) {
                logDebug(`[Tauri Media View] Opening media file: ${displayName}`);
                const mimeType = MIME_MAP[ext] || blob.type || 'application/octet-stream';
                const typedBlob = new Blob([blob], { type: mimeType });
                const url = URL.createObjectURL(typedBlob);
                window.open(url, '_blank');
                setTimeout(() => URL.revokeObjectURL(url), 10000);
              } else {
                // 点击 PDF/文档/二进制文件卡片，保存至 Downloads 并启动 Windows 默认关联软件打开
                try {
                  logDebug(`[Tauri Open File] Saving to downloads: ${displayName}...`);
                  const savedPath = await invokeTauri('save_file_to_downloads', {
                    suggestedName: displayName,
                    suggested_name: displayName,
                    base64Content: base64,
                    base64_content: base64
                  });
                  logDebug(`[Tauri Open File] Saved path: ${savedPath}. Launching open_file...`);
                  if (savedPath) {
                    lastSavedFilePathRef.current = savedPath;
                    await invokeTauri('open_file', { path: savedPath });
                    logDebug(`[Tauri Open File] open_file invoked successfully!`);
                  }
                } catch (e) {
                  logDebug(`[Tauri Open File ERR] ${e.message || e}`);
                }
              }
            } else {
              // 点击下载按钮，自动保存至系统 Downloads 目录并打开 Explorer 高亮显示
              try {
                logDebug(`[Tauri Download] Saving to downloads: ${displayName}...`);
                const savedPath = await invokeTauri('save_file_to_downloads', {
                  suggestedName: displayName,
                  suggested_name: displayName,
                  base64Content: base64,
                  base64_content: base64
                });
                logDebug(`[Tauri Download] Saved path: ${savedPath}. Opening explorer folder...`);
                if (savedPath) {
                  lastSavedFilePathRef.current = savedPath;
                  await invokeTauri('open_folder', { path: savedPath });
                  logDebug(`[Tauri Download] open_folder invoked successfully!`);
                }
              } catch (e) {
                logDebug(`[Tauri Download ERR] ${e.message || e}`);
              }
            }
          };
          reader.readAsDataURL(blob);
        } else if (window.pywebview && window.pywebview.api) {
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64 = reader.result.split(',')[1];
            if (openInBrowser) {
              if (isPreviewable) {
                const mimeType = MIME_MAP[ext] || blob.type || 'application/octet-stream';
                const typedBlob = new Blob([blob], { type: mimeType });
                const url = URL.createObjectURL(typedBlob);
                window.open(url, '_blank');
                setTimeout(() => URL.revokeObjectURL(url), 10000);
              } else {
                // 点击二进制文件卡片直接在桌面保存并调用系统关联程序打开
                const savedPath = await window.pywebview.api.save_file_to_downloads(displayName, base64);
                if (savedPath) {
                  window.pywebview.api.open_file(savedPath);
                }
              }
            } else {
              // 点击下载按钮，自动保存至系统 Downloads 目录
              const savedPath = await window.pywebview.api.save_file_to_downloads(displayName, base64);
              if (savedPath) {
                alert(`文件已保存至下载目录:\n${savedPath}`);
              }
            }
          };
          reader.readAsDataURL(blob);
        } else {
          // 标准 Web 浏览器适配
          const mimeType = MIME_MAP[ext] || blob.type || 'application/octet-stream';
          const typedBlob = new Blob([blob], { type: mimeType });
          const url = URL.createObjectURL(typedBlob);

          if (openInBrowser && isPreviewable) {
            const win = window.open(url, '_blank');
            if (!win) {
              const a = document.createElement('a');
              a.href = url;
              a.download = displayName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }
          } else {
            // 下载或非预览文件：强制标准下载，绝不调用 window.open(blob) 避免“获取打开'blob'连接的应用”提示
            const a = document.createElement('a');
            a.href = url;
            a.download = displayName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
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

  // --- Multi-Selection Batch Download Handler ---
  const handleBatchDownload = async (targetMsgs) => {
    const msgs = Array.isArray(targetMsgs) && targetMsgs.length > 0
      ? targetMsgs
      : messages.filter(m => selectedMessageIds.has(m.id));

    if (msgs.length === 0) return;

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      if (msg.type === 'FOLDER') continue;

      const isMediaOrFile = ['FILE', 'IMAGE', 'VIDEO', 'AUDIO'].includes(String(msg.type).toUpperCase()) || msg.fileSize > 0 || (msg.content && msg.content.includes('/'));
      
      if (isMediaOrFile) {
        handleStartDownload(msg, false);
      } else if (msg.content) {
        // 下载纯文本消息为 .txt 文件
        const textContent = msg.caption ? `${msg.content}\n\n[注释] ${msg.caption}` : msg.content;
        const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
        const fileName = `message_${msg.id || Date.now()}.txt`;
        
        const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
        if (isTauri) {
          try {
            const reader = new FileReader();
            reader.onloadend = async () => {
              const base64 = reader.result.split(',')[1];
              await invokeTauri('save_file_to_downloads', {
                suggestedName: fileName,
                suggested_name: fileName,
                base64Content: base64,
                base64_content: base64
              });
            };
            reader.readAsDataURL(blob);
          } catch (_) {}
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
      }
      
      if (msgs.length > 1) {
        await new Promise(res => setTimeout(res, 200));
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

  // --- Save As & Open Downloads Folder ---
  const handleSaveAs = async (msg) => {
    try {
      const displayName = msg.content.replace(/^\d+_/, '');
      let blob = await getCachedFile(msg.id);
      if (!blob && storageClient) {
        blob = await storageClient.downloadFile(msg.content);
        if (blob) cacheFile(msg.id, blob);
      }
      if (!blob) {
        alert('文件尚未下载，请先点击下载按钮下载');
        return;
      }

      // 桌面 PyInstaller Webview Bridge
      if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = reader.result.split(',')[1];
          await window.pywebview.api.save_file_dialog(displayName, base64);
        };
        reader.readAsDataURL(blob);
        return;
      }

      // File System Access API (支持的 Chrome / Edge 浏览器弹框选择文件保存路径)
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({ suggestedName: displayName });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      // 退回到标准下载
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = displayName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error('Save as error:', err);
    }
  };

  const handleOpenDownloadsFolder = async () => {
    const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
    logDebug(`[Tauri Folder Action] handleOpenDownloadsFolder called, isTauri: ${isTauri}, lastSavedPath: ${lastSavedFilePathRef.current}`);
    if (isTauri) {
      try {
        const savedPath = lastSavedFilePathRef.current || '';
        logDebug(`[Tauri Folder Action] Invoking open_folder for path: ${savedPath}...`);
        await invokeTauri('open_folder', { path: savedPath });
        logDebug(`[Tauri Folder Action] open_folder invoked successfully!`);
      } catch (e) {
        logDebug(`[Tauri Folder Action ERR] ${e.message || e}`);
      }
    } else if (window.pywebview && window.pywebview.api && window.pywebview.api.open_downloads_folder) {
      window.pywebview.api.open_downloads_folder();
    } else {
      alert('下载文件已保存至您系统的 Downloads (下载) 目录。');
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

  const handleLoadedAudioMetadata = (msgId, e) => {
    const audio = e.target;
    if (audio && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
      setAudioProgress(prev => ({
        ...prev,
        [msgId]: { 
          progress: prev[msgId]?.progress || 0, 
          duration: audio.duration, 
          currentTime: prev[msgId]?.currentTime || 0 
        }
      }));
    }
  };

  const getDurationFromMsg = (msg) => {
    if (msg.duration && !isNaN(msg.duration)) return msg.duration;
    if (msg.videoDuration && !isNaN(msg.videoDuration)) return msg.videoDuration;
    if (msg.audioDuration && !isNaN(msg.audioDuration)) return msg.audioDuration;
    if (msg.content) {
      const match = msg.content.match(/(\d+)\s*(?:秒|s|"|'|”)/);
      if (match) return parseInt(match[1], 10);
    }
    return 0;
  };

  const handleAudioSeek = (msgId, e) => {
    const audio = audioRefs.current[msgId];
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pos * audio.duration;
  };

  const formatAudioTime = (seconds) => {
    if (isNaN(seconds) || seconds <= 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // --- Message grouping by explicit groupId & Privacy filtering ---
  const grouped = React.useMemo(() => {
    const emitted = new Set();
    const result = [];
    const totalCount = filteredMessages.length;
    const sliced = filteredMessages.slice(Math.max(0, totalCount - visibleCount));

    for (let i = 0; i < sliced.length; i++) {
      const msg = sliced[i];
      if (emitted.has(msg.id)) continue;

      const gid = (msg.groupId !== undefined && msg.groupId !== null && String(msg.groupId).trim() !== '') ? String(msg.groupId).trim() : null;
      if (gid) {
        // Gather ALL members in sliced sharing this groupId
        const groupMembers = sliced.filter(m => {
          const mGid = (m.groupId !== undefined && m.groupId !== null && String(m.groupId).trim() !== '') ? String(m.groupId).trim() : null;
          return mGid === gid;
        });

        groupMembers.forEach(m => emitted.add(m.id));

        if (groupMembers.size > 1 || groupMembers.length > 1) {
          result.push({
            id: gid,
            sender: groupMembers[0].sender,
            senderName: groupMembers[0].senderName,
            senderAvatar: groupMembers[0].senderAvatar,
            timestamp: groupMembers[0].timestamp,
            isOutgoing: groupMembers[0].isOutgoing,
            isGroup: true,
            groupId: gid,
            messages: groupMembers
          });
        } else {
          result.push({
            ...msg,
            isGroup: false
          });
        }
      } else {
        result.push({
          ...msg,
          isGroup: false
        });
        emitted.add(msg.id);
      }
    }

    return result;
  }, [filteredMessages, visibleCount]);

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    
    // Check if same day (Today)
    const isToday = date.getFullYear() === now.getFullYear() &&
                    date.getMonth() === now.getMonth() &&
                    date.getDate() === now.getDate();
                    
    // Check if Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.getFullYear() === yesterday.getFullYear() &&
                        date.getMonth() === yesterday.getMonth() &&
                        date.getDate() === yesterday.getDate();

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    if (isToday) {
      return timeStr;
    } else if (isYesterday) {
      return `昨天 ${timeStr}`;
    } else {
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      if (date.getFullYear() === now.getFullYear()) {
        return `${month}/${day} ${timeStr}`;
      } else {
        return `${date.getFullYear()}/${month}/${day} ${timeStr}`;
      }
    }
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
            className="lg:hidden text-textSecondary hover:text-textPrimary transition-colors p-1"
          >
            <i className="fa-solid fa-bars text-base"></i>
          </button>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-textPrimary truncate">
              {activeCategory === 'all' ? 'All Messages' : `# ${CATEGORY_MAP[activeCategory] || activeCategory}`}
            </h2>
            <p className="text-[10px] text-textMuted truncate">
              {filteredMessages.length} 条消息
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

        {/* Calendar Jump Button */}
        {selectedMessageIds.size === 0 && (
          <button
            onClick={() => setShowCalendarModal(true)}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-bgPrimary/60 border border-borderColor hover:border-accentColor hover:bg-bgPrimary text-textMuted hover:text-accentColor transition-all shrink-0 ml-1"
            title="按日历查看条目"
          >
            <i className="fa-regular fa-calendar-days text-sm"></i>
          </button>
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
                    setInputModalConfig({
                      isOpen: true,
                      title: '修改隐私访问密码',
                      hint: '请输入新的隐私解锁密码（后续使用 ##新密码## 唤醒）：',
                      defaultValue: '',
                      inputType: 'password',
                      placeholder: '请输入新密码...',
                      confirmText: '保存密码',
                      onConfirm: (p) => {
                        setInputModalConfig(prev => ({ ...prev, isOpen: false }));
                        if (onChangePrivacyPin) onChangePrivacyPin(p.trim());
                      }
                    });
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
                onChange={(e) => {
                  const val = e.target.checked;
                  setLockScroll(val);
                  if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('cloudchat_lock_scroll', val ? 'true' : 'false');
                  }
                }} 
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
          <div className="absolute inset-0 bg-bgSecondary flex flex-wrap items-center justify-end px-2 py-1 gap-1.5 sm:gap-2 animate-fade-in z-20 overflow-y-auto max-h-full border-b border-borderColor">
            {/* 仅显示选中的数字 Badge，去除 long text "* items selected" */}
            <div className="flex items-center gap-1 text-xs font-bold text-accentColor bg-accentColor/10 border border-accentColor/30 rounded-lg px-2 py-1 shrink-0 mr-auto" title={`已选中 ${selectedMessageIds.size} 条`}>
              <i className="fa-solid fa-square-check text-xs"></i>
              <span>{selectedMessageIds.size}</span>
            </div>

            {/* 打包文件夹 */}
            <button
              onClick={() => onPackFolder(currentFolderId)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-cyan-400 hover:bg-cyan-500/10 transition-all shrink-0"
              title="打包文件夹"
            >
              <i className="fa-solid fa-folder-plus text-sm"></i>
            </button>

            {/* 移入文件夹 */}
            <button
              onClick={() => onMoveIntoFolder(currentFolderId)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-sky-400 hover:bg-sky-500/10 transition-all shrink-0"
              title="移入文件夹"
            >
              <i className="fa-solid fa-folder-open text-sm"></i>
            </button>

            {/* 移出文件夹 */}
            {currentFolderId && (
              <button
                onClick={() => onRemoveMessagesFromFolder(messages.filter(m => selectedMessageIds.has(m.id)))}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-amber-400 hover:bg-amber-500/10 transition-all shrink-0"
                title="移出文件夹"
              >
                <i className="fa-solid fa-folder-minus text-sm"></i>
              </button>
            )}

            {/* 合并消息 */}
            {(() => {
              const nonFolderSelected = messages.filter(m => selectedMessageIds.has(m.id) && m.type !== 'FOLDER');
              const existingGroupIds = new Set(nonFolderSelected.filter(m => m.groupId).map(m => m.groupId));
              const totalTargetCount = messages.filter(
                m => m.type !== 'FOLDER' && (selectedMessageIds.has(m.id) || (m.groupId && existingGroupIds.has(m.groupId)))
              ).length;
              return totalTargetCount >= 2 ? (
                <button
                  onClick={() => onGroupSelected()}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-purple-400 hover:bg-purple-500/10 transition-all shrink-0"
                  title="合并消息"
                >
                  <i className="fa-solid fa-object-group text-sm"></i>
                </button>
              ) : null;
            })()}

            {/* 拆散组合 */}
            {Array.from(selectedMessageIds).some(id => messages.find(m => m.id === id)?.groupId) && (
              <button
                onClick={() => onUngroupMessage(messages.filter(m => selectedMessageIds.has(m.id)))}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-amber-400 hover:bg-amber-500/10 transition-all shrink-0"
                title="拆散组合"
              >
                <i className="fa-solid fa-object-ungroup text-sm"></i>
              </button>
            )}

            {/* 移出隐私（仅隐私模式下显示，移入只能长按删除按钮触发） */}
            {isPrivacyMode && (
              <button
                onClick={() => onToggleHideMessage(messages.filter(m => selectedMessageIds.has(m.id)))}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-purple-400 hover:bg-purple-500/10 transition-all shrink-0"
                title="移出隐私空间"
              >
                <i className="fa-solid fa-lock-open text-sm"></i>
              </button>
            )}

            {/* 生成日记 */}
            <button
              onClick={() => onOpenDiaryExport(messages.filter(m => selectedMessageIds.has(m.id)))}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-all shrink-0"
              title="生成日记"
            >
              <i className="fa-solid fa-book-bookmark text-sm"></i>
            </button>

            {/* 批量下载 */}
            <button
              onClick={() => handleBatchDownload(messages.filter(m => selectedMessageIds.has(m.id)))}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-teal-400 hover:bg-teal-500/10 transition-all shrink-0"
              title="批量下载选中条目"
            >
              <i className="fa-solid fa-download text-sm"></i>
            </button>

            {/* 范围选择（Shift 模式）：选中第一条到最后一条中间全部 */}
            <button
              onClick={handleToggleRangeSelect}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all shrink-0 ${
                rangeSelectActive ? 'bg-accentColor/20 text-accentColor ring-1 ring-accentColor' : 'text-sky-400 hover:bg-sky-500/10'
              }`}
              title={rangeSelectActive ? '范围选择已激活，点击目标条目完成全选（再点取消）' : '范围选择（选中第一条到最后一条中间全部）'}
            >
              <i className="fa-solid fa-check-double text-sm"></i>
            </button>

            {/* 删除（短按删除，长按移入隐私） */}
            <button
              onPointerDown={(e) => {
                e.stopPropagation();
                deleteLongPressFiredRef.current = false;
                deleteLongPressRef.current = setTimeout(() => {
                  deleteLongPressFiredRef.current = true;
                  onToggleHideMessage(messages.filter(m => selectedMessageIds.has(m.id)));
                }, 600);
              }}
              onPointerUp={() => {
                if (deleteLongPressRef.current) {
                  clearTimeout(deleteLongPressRef.current);
                  deleteLongPressRef.current = null;
                }
              }}
              onPointerLeave={() => {
                if (deleteLongPressRef.current) {
                  clearTimeout(deleteLongPressRef.current);
                  deleteLongPressRef.current = null;
                }
              }}
              onClick={(e) => {
                if (deleteLongPressFiredRef.current) return;
                onDeleteSelected();
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10 transition-all shrink-0"
              title="删除选中（长按移入隐私）"
            >
              <i className="fa-regular fa-trash-can text-sm"></i>
            </button>

            <button
              onClick={onClearSelection}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-textSecondary hover:text-textPrimary transition-all shrink-0"
              title="取消多选"
            >
              <i className="fa-solid fa-xmark text-sm"></i>
            </button>
          </div>
        )}
      </header>

      {/* Message List Container (Middle Window Only) */}
      <div className="flex-1 min-h-0 relative flex flex-col">
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
        {/* WebDAV Diary Web Pages Section */}
        {activeCategory === 'diary' && (
          <div className="w-full mb-4 animate-fade-in space-y-4">
            <div className="flex items-center justify-between border-b border-borderColor/60 pb-3 bg-bgSecondary/40 p-3 rounded-xl border border-borderColor">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <i className="fa-solid fa-book-bookmark text-base"></i>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-textPrimary flex items-center gap-2">
                    <span>WebDAV 日记网页列表</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400">
                      {diaryFiles.length} 篇网页日记
                    </span>
                  </h3>
                  <p className="text-[11px] text-textMuted">
                    WebDAV 路径: <span className="font-mono text-cyan-400">{[currentProfile?.serverPath, currentProfile?.saveDir].filter(Boolean).join('/') || 'CloudChat'}</span>
                    {currentProfile?.diaryBaseUrl ? ` | 映射地址: ${currentProfile.diaryBaseUrl}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchDiaryFiles}
                  disabled={isLoadingDiary}
                  className="px-3 py-1.5 rounded-lg text-xs bg-bgPrimary border border-borderColor text-textSecondary hover:text-cyan-400 hover:border-cyan-500/40 transition-all flex items-center gap-1.5"
                  title="刷新 WebDAV 日记文件列表"
                >
                  <i className={`fa-solid fa-rotate-right text-xs ${isLoadingDiary ? 'animate-spin' : ''}`}></i>
                  <span>刷新</span>
                </button>
                <button
                  onClick={onOpenDiaryExport}
                  className="px-3 py-1.5 rounded-lg text-xs bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25 transition-all flex items-center gap-1.5 font-medium"
                >
                  <i className="fa-solid fa-square-plus text-xs"></i>
                  <span>生成新日记</span>
                </button>
              </div>
            </div>

            {isLoadingDiary ? (
              <div className="py-8 flex items-center justify-center gap-2 text-textMuted text-xs">
                <i className="fa-solid fa-spinner animate-spin text-cyan-400 text-sm"></i>
                <span>正在读取 WebDAV 设定目录下的子文件夹...</span>
              </div>
            ) : diaryFiles.length === 0 ? (
              <div className="py-6 text-center text-textMuted text-xs bg-bgPrimary/30 rounded-xl border border-dashed border-borderColor">
                <i className="fa-solid fa-folder-open text-2xl text-textMuted/40 mb-2 block"></i>
                <span>设定目录下暂无包含 index.html 的日记子文件夹</span>
                <button
                  onClick={onOpenDiaryExport}
                  className="mt-2 block mx-auto text-xs text-cyan-400 underline hover:text-cyan-300"
                >
                  点击生成全量或选定日期的 HTML 日记
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 p-1">
                {diaryFiles.map((file, idx) => (
                  <div
                    key={file.name + idx}
                    className="p-3 bg-bgPrimary/60 border border-borderColor hover:border-cyan-500/50 rounded-xl transition-all flex flex-col justify-between gap-2 shadow-sm group hover:shadow-cyan-500/5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-accentColor/10 border border-accentColor/20 flex items-center justify-center shrink-0">
                          <i className="fa-solid fa-globe text-accentColor text-xs"></i>
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-semibold text-textPrimary truncate group-hover:text-cyan-400 transition-colors" title={file.name}>
                            {file.name}
                          </h4>
                          <p className="text-[10px] text-textMuted truncate font-mono" title={file.webUrl}>
                            {file.webUrl}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-textMuted pt-1 border-t border-borderColor/30 font-mono">
                      <span>{new Date(file.lastModified).toLocaleString()}</span>
                      <span>{(file.size / 1024).toFixed(1)} KB</span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <a
                        href={file.webUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-1 px-2.5 rounded-lg text-[11px] font-medium bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25 transition-all text-center flex items-center justify-center gap-1.5"
                      >
                        <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                        <span>打开页面</span>
                      </a>
                      <button
                        onClick={() => setPreviewWebUrl(file.webUrl)}
                        className="py-1 px-2.5 rounded-lg text-[11px] font-medium bg-bgPrimary border border-borderColor text-textSecondary hover:text-textPrimary hover:bg-white/5 transition-all flex items-center gap-1"
                        title="在框架中快速预览"
                      >
                        <i className="fa-solid fa-eye text-[10px]"></i>
                        <span>预览</span>
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(file.webUrl);
                          alert('✅ 已复制日记 URL 到剪贴板！');
                        }}
                        className="py-1 px-2.5 rounded-lg text-[11px] text-textMuted hover:text-textPrimary bg-bgPrimary border border-borderColor hover:bg-white/5 transition-all"
                        title="复制 URL 地址"
                      >
                        <i className="fa-solid fa-copy text-[10px]"></i>
                      </button>
                      <button
                        onClick={async () => {
                          if (window.confirm(`确定要从 WebDAV 删除日记页面 "${file.name}" 吗？`)) {
                            try {
                              await storageClient.deleteDiaryFile(file.name);
                              fetchDiaryFiles();
                              if (onDiaryChanged) onDiaryChanged();
                            } catch (e) {
                              alert(`删除失败: ${e.message}`);
                            }
                          }
                        }}
                        className="py-1 px-2.5 rounded-lg text-[11px] text-red-400 hover:text-red-300 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all"
                        title="删除此日记网页"
                      >
                        <i className="fa-solid fa-trash-can text-[10px]"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {folderStack.length > 0 && (() => {
          const folderMsg = messages.find(m => m.id === currentFolderId);
          const breadcrumbItems = (() => {
            const names = folderStack.map(id => {
              const f = messages.find(m => m.id === id);
              return { id, name: f ? (f.content || '文件夹') : '文件夹' };
            });
            if (names.length <= 4) return names;
            // 过长折叠中间：保留首层 + ... + 末层
            return [names[0], { id: null, name: '…' }, names[names.length - 1]];
          })();
          return (
            <div className="flex flex-wrap items-center justify-between gap-2 p-2 mb-2 bg-bgSecondary/90 backdrop-blur border border-borderColor rounded-lg sticky top-0 z-10 shadow-sm w-full">
              <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto flex-1">
                <button
                  className="flex items-center gap-1 text-cyan-400 hover:opacity-80 shrink-0"
                  onClick={() => setFolderStack(folderStack.slice(0, -1))}
                  title="返回上一级"
                >
                  <i className="fa-solid fa-arrow-left"></i>
                </button>
                <i className="fa-solid fa-folder text-cyan-500 text-base shrink-0"></i>
                {breadcrumbItems.map((item, idx) => (
                  <React.Fragment key={item.id || `sep-${idx}`}>
                    {idx > 0 && <span className="text-textMuted text-xs">›</span>}
                    {item.id === null ? (
                      <span className="text-textMuted text-xs px-1">…</span>
                    ) : (
                      <button
                        className={`font-semibold text-sm truncate max-w-[160px] px-1 rounded hover:bg-white/5 ${
                          idx === breadcrumbItems.length - 1 ? 'text-cyan-400' : 'text-textPrimary'
                        }`}
                        onClick={() => {
                          const targetIndex = folderStack.indexOf(item.id);
                          if (targetIndex >= 0) setFolderStack(folderStack.slice(0, targetIndex + 1));
                        }}
                        title="点击跳转到此层级"
                      >
                        {item.name}
                      </button>
                    )}
                  </React.Fragment>
                ))}
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button 
                  onClick={() => folderMsg && onOpenDiaryExport && onOpenDiaryExport(folderMsg)}
                  className="px-2.5 py-1 text-xs text-cyan-300 hover:text-white bg-gradient-to-r from-cyan-500/20 to-emerald-500/20 border border-cyan-500/40 rounded-full transition-all flex items-center gap-1 font-semibold"
                  title="生成精美静态日记网页并存入服务器"
                >
                  <i className="fa-solid fa-book-bookmark text-[10px] text-cyan-400"></i> <span className="hidden sm:inline">生成静态日记</span>
                </button>
                <button 
                  onClick={() => folderMsg && onRenameFolder && onRenameFolder(folderMsg)}
                  className="px-2.5 py-1 text-xs text-textSecondary hover:text-textPrimary bg-bgPrimary border border-borderColor rounded-full transition-all flex items-center gap-1"
                  title="重命名文件夹"
                >
                  <i className="fa-solid fa-pen text-[10px] text-accentColor"></i> <span className="hidden sm:inline">重命名</span>
                </button>
                <button 
                  onClick={() => folderMsg && onUnpackFolder && onUnpackFolder(folderMsg)}
                  className="px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20 rounded-full transition-all flex items-center gap-1 font-semibold"
                  title="解散文件夹"
                >
                  <i className="fa-solid fa-folder-minus text-[10px]"></i> <span className="hidden sm:inline">解散文件夹</span>
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
                id={`msg-item-${item.id}`}
                onContextMenu={handleRowContextMenu}
                className="flex gap-3.5 min-w-0 group relative my-5 items-start justify-start transition-all duration-300 rounded-xl"
              >
                {/* Selection Checkbox */}
                {selectedMessageIds.size > 0 && (
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      if (rangeSelectActive) {
                        selectRangeTo(Array.isArray(msgIdOrIds) ? msgIdOrIds[0] : msgIdOrIds);
                      } else {
                        onToggleMessageSelection(msgIdOrIds);
                        setSelectionMenuCoords({ x: e.clientX, y: e.clientY });
                      }
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
                
                {/* Left Side Avatar */}
                <div className="shrink-0 mt-0.5 select-none">
                  {(() => {
                    const senderName = item.senderName || item.sender || (item.isOutgoing ? (currentProfile?.username || 'Me') : 'User');
                    const fallback = getInitialAvatar(senderName);
                    const matchesCurrentProfile = currentProfile?.username && 
                      (item.sender === currentProfile.username || item.senderName === currentProfile.username);
                    const rawAvatar = item.senderAvatar || (matchesCurrentProfile ? currentProfile?.avatar : null);
                    const isSafe = (u) => u && (u.startsWith('data:') || u.startsWith('blob:'));
                    const resolvedBlob = rawAvatar && avatarBlobUrls[rawAvatar];
                    const avatarSrc = resolvedBlob || (isSafe(rawAvatar) ? rawAvatar : fallback);
                    const firstLetter = (senderName || 'U').charAt(0).toUpperCase();

                    return (
                      <div className="w-10 h-10 rounded-lg bg-[#212c3d] border border-white/10 flex items-center justify-center overflow-hidden shadow-sm">
                        {avatarSrc ? (
                          <img 
                            src={avatarSrc} 
                            alt="Avatar"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <span className={`font-bold text-sm text-indigo-400 ${avatarSrc ? 'hidden' : 'flex'} items-center justify-center w-full h-full`}>
                          {firstLetter}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* Bubble Wrapper (Content Column) */}
                <div 
                  onMouseDown={(e) => handleTouchStart(e, gestureMsgId)}
                  onMouseUp={(e) => handleTouchEnd(e, gestureMsgId)}
                  onMouseMove={(e) => handleTouchMove(e, gestureMsgId)}
                  onTouchStart={(e) => handleTouchStart(e, gestureMsgId)}
                  onTouchEnd={(e) => handleTouchEnd(e, gestureMsgId)}
                  onTouchMove={(e) => handleTouchMove(e, gestureMsgId)}
                  onContextMenu={handleRowContextMenu}
                  className="flex flex-col max-w-[85%] md:max-w-[75%] min-w-0 relative message-bubble items-start"
                >
                  {/* Sender Name above message */}
                  <span className="text-[12px] font-semibold text-textMuted/90 leading-tight mb-1 truncate max-w-[240px]">
                    {item.senderName || item.sender || (item.isOutgoing ? (currentProfile?.username || 'Me') : 'User')}
                  </span>

                  {isPrivacyMode && item.isHidden && (
                    <div className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 font-mono flex items-center gap-1 leading-none mb-1">
                      <i className="fa-solid fa-eye-slash text-[8px]"></i> 隐藏
                    </div>
                  )}

                  {/* Bubble Content Body */}
                  <div className="relative">
                    {isGroup ? (
                      item.messages.every(m => {
                        const t = String(m.type || '').toUpperCase();
                        return t === 'IMAGE' || t === 'VIDEO';
                      }) ? (
                        /* RENDER GRID GROUP (NINE GRID FOR ALL MEDIA) */
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
                                  {msg.url ? (
                                    <img src={msg.url} alt="Grid attachment" className={`w-full h-full object-cover select-none transition-all duration-200 ${isImgSelected ? 'brightness-50' : ''}`} />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-black/10 text-[10px] text-textMuted p-1">
                                      <i className="fa-solid fa-spinner fa-spin"></i>
                                    </div>
                                  )}
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
                        /* RENDER COMPOSITE GROUP (MIXED / NON-MEDIA CARD) */
                        <div className={`p-3 rounded-2xl border shadow-sm max-w-[300px] flex flex-col gap-1.5 font-sans ${
                          item.isOutgoing
                            ? 'bg-accentColor border-accentColor/40 text-white rounded-tr-none'
                            : 'bg-bgSecondary border-borderColor text-textPrimary rounded-tl-none'
                        }`}>
                          {item.messages.map((msg, idx) => {
                            const msgType = String(msg.type || '').toUpperCase();
                            const isTextOrUnknown = msgType === 'TEXT' || msgType === '' || !['AUDIO', 'FILE', 'IMAGE', 'VIDEO', 'LOCATION', 'FOLDER'].includes(msgType);
                            const isSubSelected = selectedMessageIds.has(msg.id);

                            const handleSubItemClick = (e) => {
                              if (selectedMessageIds.size > 0) {
                                e.stopPropagation();
                                if (rangeSelectActive) {
                                  selectRangeTo(msg.id);
                                } else {
                                  onToggleMessageSelection(msg.id);
                                  setSelectionMenuCoords({ x: e.clientX, y: e.clientY });
                                }
                              }
                            };

                            const handleSubItemContextMenu = (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setContextMenu({ msg, msgs: [msg], x: e.clientX, y: e.clientY });
                            };

                            return (
                              <div 
                                key={msg.id || idx} 
                                onMouseDown={(e) => handleTouchStart(e, msg.id)}
                                onMouseUp={(e) => handleTouchEnd(e, msg.id)}
                                onMouseMove={(e) => handleTouchMove(e, msg.id)}
                                onTouchStart={(e) => handleTouchStart(e, msg.id)}
                                onTouchEnd={(e) => handleTouchEnd(e, msg.id)}
                                onTouchMove={(e) => handleTouchMove(e, msg.id)}
                                onContextMenu={handleSubItemContextMenu}
                                onClick={handleSubItemClick}
                                className={`flex flex-col gap-1 relative transition-all rounded-lg p-1.5 cursor-pointer ${
                                  idx > 0 ? (item.isOutgoing ? 'border-t border-white/20' : 'border-t border-borderColor/40') : ''
                                } ${
                                  isSubSelected ? (item.isOutgoing ? 'bg-white/25 ring-1 ring-white' : 'bg-accentColor/15 ring-1 ring-accentColor') : 'hover:bg-black/5'
                                }`}
                              >
                                {isSubSelected && (
                                  <div className="absolute top-1 right-1 text-xs z-10">
                                    <i className={`fa-solid fa-circle-check ${item.isOutgoing ? 'text-white' : 'text-accentColor'}`}></i>
                                  </div>
                                )}
                                {isTextOrUnknown && (
                                  <span className={`text-[14.5px] whitespace-pre-wrap break-words leading-relaxed select-text font-normal pr-4 ${item.isOutgoing ? 'text-white' : 'text-textPrimary'}`}>
                                    {msg.content || (typeof msg === 'string' ? msg : '')}
                                  </span>
                                )}
                                {msgType === 'LOCATION' && (
                                  <div className={`flex items-center gap-1.5 text-xs py-0.5 pr-4 ${item.isOutgoing ? 'text-white/90' : 'text-textSecondary'}`}>
                                    <i className={`fa-solid fa-location-dot text-sm shrink-0 ${item.isOutgoing ? 'text-white' : 'text-red-500'}`}></i>
                                    <span className="break-words font-medium">{msg.content}</span>
                                  </div>
                                )}
                                {msgType === 'FOLDER' && (
                                  <div className={`flex items-center gap-2 p-2 rounded-xl border text-xs pr-4 ${item.isOutgoing ? 'bg-white/10 border-white/20' : 'bg-cyan-500/10 border-cyan-500/20'}`}>
                                    <i className={`fa-solid fa-folder text-base shrink-0 ${item.isOutgoing ? 'text-white' : 'text-cyan-500'}`}></i>
                                    <span className={`font-semibold block truncate ${item.isOutgoing ? 'text-white' : 'text-textPrimary'}`}>{msg.content || '文件夹'}</span>
                                  </div>
                                )}
                                {msgType === 'AUDIO' && (() => {
                                  const loadedDur = audioProgress[msg.id]?.duration;
                                  const fallbackDur = getDurationFromMsg(msg);
                                  const totalDuration = (loadedDur && !isNaN(loadedDur) && isFinite(loadedDur) && loadedDur > 0) ? loadedDur : fallbackDur;
                                  return (
                                    <div className="flex items-center gap-2 text-xs my-0.5 pr-4">
                                      <audio 
                                        ref={el => audioRefs.current[msg.id] = el}
                                        src={msg.url}
                                        onLoadedMetadata={(e) => handleLoadedAudioMetadata(msg.id, e)}
                                        onTimeUpdate={() => handleAudioTimeUpdate(msg.id)}
                                        onEnded={() => setAudioPlayingId(null)}
                                        preload="metadata"
                                      />
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); handleToggleAudio(msg.id); }}
                                        className={`px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shrink-0 shadow-sm hover:opacity-90 cursor-pointer font-medium text-xs ${
                                          item.isOutgoing ? 'bg-white text-accentColor' : 'bg-[#07C160] text-white'
                                        }`}
                                      >
                                        <i className={`fa-solid ${audioPlayingId === msg.id ? 'fa-pause text-xs' : 'fa-play text-xs'}`}></i>
                                        <span>{totalDuration ? `${Math.round(totalDuration)}s` : '语音'}</span>
                                      </button>
                                      {msg.caption && <span className={`text-[11px] ml-1 truncate ${item.isOutgoing ? 'text-white/80' : 'text-textMuted'}`}>{msg.caption}</span>}
                                    </div>
                                  );
                                })()}
                                {msgType === 'FILE' && (() => {
                                  const fileName = msg.content.replace(/^\d+_/, '');
                                  const isLong = fileName.length > 25;
                                  const isExpanded = expandedFileIds.has(msg.id);
                                  return (
                                    <div className={`flex items-center gap-2 p-2 rounded-xl border text-xs pr-4 ${item.isOutgoing ? 'bg-white/10 border-white/20' : 'bg-bgPrimary/60 border-borderColor/40'}`}>
                                      <i className={`fa-solid fa-file-arrow-down text-base shrink-0 ${item.isOutgoing ? 'text-white' : 'text-cyan-400'}`}></i>
                                      <div className="min-w-0 flex-1">
                                        <span className={`font-semibold block text-xs leading-snug ${isExpanded ? 'break-all whitespace-pre-wrap' : 'line-clamp-2 break-all'} ${item.isOutgoing ? 'text-white' : 'text-textPrimary'}`}>
                                          {fileName}
                                        </span>
                                        {isLong && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExpandedFileIds(prev => {
                                                const next = new Set(prev);
                                                if (next.has(msg.id)) next.delete(msg.id);
                                                else next.add(msg.id);
                                                return next;
                                              });
                                            }}
                                            className={`text-[10px] hover:underline cursor-pointer font-normal mt-0.5 inline-block ${
                                              item.isOutgoing ? 'text-white/80 hover:text-white' : 'text-cyan-400 hover:text-cyan-300'
                                            }`}
                                          >
                                            {isExpanded ? '收起' : '展开全文'}
                                          </button>
                                        )}
                                        <span className={`text-[10px] block ${item.isOutgoing ? 'text-white/80' : 'text-textMuted'}`}>{msg.fileSize ? formatSize(msg.fileSize) : ''}</span>
                                      </div>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); handleStartDownload(msg, false); }}
                                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 cursor-pointer ${
                                          item.isOutgoing ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-black/10 hover:bg-black/20 text-textPrimary'
                                        }`}
                                        title="下载文件"
                                      >
                                        <i className="fa-solid fa-download"></i>
                                      </button>
                                    </div>
                                  );
                                })()}
                                {(msgType === 'IMAGE' || msgType === 'VIDEO') && (
                                  <div className="rounded-xl overflow-hidden max-h-48 bg-black/10 border border-borderColor/40 cursor-pointer" onClick={() => handleOpenMediaViewer(msg.id)}>
                                    {msg.url ? (
                                      msgType === 'IMAGE' ? (
                                        <img src={msg.url} alt="Group media" className="w-full h-full object-cover max-h-48" />
                                      ) : (
                                        <video src={msg.url} className="w-full h-full object-cover max-h-48" />
                                      )
                                    ) : (
                                      <div className="w-full h-32 flex items-center justify-center text-xs text-textMuted gap-2">
                                        <i className="fa-solid fa-spinner fa-spin"></i>
                                        <span>加载媒体...</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {msg.caption && msgType !== 'AUDIO' && (
                                  <span className="text-[11px] text-textMuted mt-0.5 block">{msg.caption}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )
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

                        {item.type === 'AUDIO' && (() => {
                          const loadedDur = audioProgress[item.id]?.duration;
                          const fallbackDur = getDurationFromMsg(item);
                          const totalDuration = (loadedDur && !isNaN(loadedDur) && isFinite(loadedDur) && loadedDur > 0) 
                            ? loadedDur 
                            : fallbackDur;
                          const currentAudioTime = audioProgress[item.id]?.currentTime || 0;

                          return (
                            /* Audio Player Card */
                            <div className="flex items-center gap-3.5 min-w-[210px] font-sans">
                              <audio 
                                ref={el => audioRefs.current[item.id] = el}
                                src={item.url}
                                onLoadedMetadata={(e) => handleLoadedAudioMetadata(item.id, e)}
                                onLoadedData={(e) => handleLoadedAudioMetadata(item.id, e)}
                                onTimeUpdate={() => handleAudioTimeUpdate(item.id)}
                                onEnded={() => setAudioPlayingId(null)}
                                preload="metadata"
                              />
                              <button 
                                onClick={() => handleToggleAudio(item.id)}
                                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm transition-all shrink-0 ${
                                  item.isOutgoing 
                                    ? 'bg-white text-accentColor shadow-sm' 
                                    : 'bg-accentColor text-white shadow-sm'
                                }`}
                              >
                                <i className={`fa-solid ${audioPlayingId === item.id ? 'fa-pause' : 'fa-play'}`}></i>
                              </button>
                              <div className="flex-1 flex flex-col gap-1.5 min-w-[120px]">
                                <div 
                                  className="h-2 bg-black/20 hover:bg-black/35 rounded-full overflow-hidden cursor-pointer relative"
                                  onClick={(e) => handleAudioSeek(item.id, e)}
                                >
                                  <div 
                                    className={`h-full transition-all ${item.isOutgoing ? 'bg-white' : 'bg-accentColor'}`}
                                    style={{ width: `${audioProgress[item.id]?.progress || 0}%` }}
                                  />
                                </div>
                                <div className={`flex items-center justify-between text-[10px] font-mono leading-none ${
                                  item.isOutgoing ? 'text-white/80' : 'text-textSecondary'
                                }`}>
                                  <span>{formatAudioTime(currentAudioTime)}</span>
                                  <span className="font-semibold">{formatAudioTime(totalDuration)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

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
                                <span className={`font-semibold block text-xs leading-snug ${expandedFileIds.has(item.id) ? 'break-all whitespace-pre-wrap' : 'line-clamp-2 break-all'}`}>
                                  {item.content.replace(/^\d+_/, '')}
                                </span>
                                {item.content.replace(/^\d+_/, '').length > 25 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedFileIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(item.id)) next.delete(item.id);
                                        else next.add(item.id);
                                        return next;
                                      });
                                    }}
                                    className={`text-[10px] hover:underline cursor-pointer font-normal mt-0.5 inline-block ${
                                      item.isOutgoing ? 'text-white/80 hover:text-white' : 'text-cyan-400 hover:text-cyan-300'
                                    }`}
                                  >
                                    {expandedFileIds.has(item.id) ? '收起' : '展开全文'}
                                  </button>
                                )}
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
                              <button 
                                onClick={() => handleOpenDownloadsFolder()}
                                className="w-7 h-7 rounded-full bg-black/5 hover:bg-amber-500/20 flex items-center justify-center text-xs text-amber-400"
                                title="打开下载文件夹"
                              >
                                <i className="fa-solid fa-folder-open"></i>
                              </button>

                              {!downloads[item.id] && (
                                <button 
                                  onClick={() => handleStartDownload(item, false)}
                                  className="w-7 h-7 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-xs"
                                  title="下载文件"
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
                              setFolderStack([...folderStack, item.id]);
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
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    if (onRetryMessage) onRetryMessage(item); 
                                  }}
                                  className="text-red-400 hover:text-red-300 cursor-pointer flex items-center gap-0.5 text-[10px] font-semibold bg-red-500/10 hover:bg-red-500/20 px-1 py-0.5 rounded border border-red-500/30 transition-all"
                                  title="发送失败，点击检查服务器并重发"
                                >
                                  <i className="fa-solid fa-rotate-right text-[9px] animate-pulse"></i>
                                  <span>重发</span>
                                </button>
                              ) : null}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Web Draggable Fast-Scrollbar Extra Large Floating Circle Overlay */}
      {scrollThumbInfo.visible && (
        <div 
          className={`absolute right-2 z-40 transition-opacity duration-300 select-none touch-none ${
            scrollThumbInfo.isDragging ? 'opacity-100 scale-110 shadow-2xl' : 'opacity-90 hover:opacity-100'
          }`}
          style={{
            top: `calc(${scrollThumbInfo.topRatio * 100}% * ((100% - 56px) / 100%))`,
            width: '56px',
            height: '56px',
            touchAction: 'none'
          }}
          onPointerDown={handleThumbPointerDown}
          title="按住拖动可快速滚动历史消息"
        >
          <div className={`w-14 h-14 rounded-full border-2 border-white/40 shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors ${
            scrollThumbInfo.isDragging ? 'bg-indigo-600 ring-4 ring-indigo-400/50' : 'bg-slate-700/90 hover:bg-indigo-600'
          }`}>
            <i className="fa-solid fa-up-down text-base text-white"></i>
          </div>
        </div>
      )}
      </div>

      {/* Inputs Footer Area - Hide when viewing diary category */}
      {activeCategory !== 'diary' && (
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
      )}

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            left: Math.max(8, Math.min(contextMenu.x + 8, window.innerWidth - 195)),
            top: Math.max(8, Math.min(contextMenu.y - 5, window.innerHeight - 360)),
            zIndex: 9999
          }}
          className="bg-bgSecondary border border-borderColor rounded-xl shadow-2xl py-1.5 min-w-[160px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-20px)] overflow-y-auto animate-fade-in backdrop-blur-sm"
        >
          {/* 多选状态：显示所有多选操作（替代单条操作） */}
          {selectedMessageIds.size > 1 && (
            <>
              <div className="px-3 py-1.5 text-[10px] text-textMuted border-b border-borderColor/60 flex items-center gap-1.5">
                <i className="fa-regular fa-square-check"></i> 已选中 {selectedMessageIds.size} 条
              </div>

              <button
                onClick={() => { onPackFolder(currentFolderId); setContextMenu(null); }}
                className="w-full px-4 py-2 text-xs font-semibold text-cyan-400 hover:bg-cyan-500/10 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-folder-plus w-4 text-center"></i> 打包文件夹
              </button>

              <button
                onClick={() => { if (onMoveIntoFolder) onMoveIntoFolder(currentFolderId); setContextMenu(null); }}
                className="w-full px-4 py-2 text-xs font-semibold text-sky-400 hover:bg-sky-500/10 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-folder-open w-4 text-center"></i> 移入文件夹
              </button>

              {currentFolderId && (
                <button
                  onClick={() => {
                    if (onRemoveMessagesFromFolder) onRemoveMessagesFromFolder(messages.filter(m => selectedMessageIds.has(m.id)));
                    setContextMenu(null);
                  }}
                  className="w-full px-4 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-2.5"
                >
                  <i className="fa-solid fa-folder-minus w-4 text-center"></i> 移出文件夹
                </button>
              )}

              {(() => {
                const nonFolderSelected = messages.filter(m => selectedMessageIds.has(m.id) && m.type !== 'FOLDER');
                const existingGroupIds = new Set(nonFolderSelected.filter(m => m.groupId).map(m => m.groupId));
                const totalTargetCount = messages.filter(
                  m => m.type !== 'FOLDER' && (selectedMessageIds.has(m.id) || (m.groupId && existingGroupIds.has(m.groupId)))
                ).length;
                return totalTargetCount >= 2 ? (
                  <button
                    onClick={() => { onGroupSelected(); setContextMenu(null); }}
                    className="w-full px-4 py-2 text-xs font-semibold text-purple-400 hover:bg-purple-500/10 transition-colors flex items-center gap-2.5"
                  >
                    <i className="fa-solid fa-object-group w-4 text-center"></i> 合并消息
                  </button>
                ) : null;
              })()}

              {Array.from(selectedMessageIds).some(id => messages.find(m => m.id === id)?.groupId) && (
                <button
                  onClick={() => { onUngroupMessage(messages.filter(m => selectedMessageIds.has(m.id))); setContextMenu(null); }}
                  className="w-full px-4 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-2.5"
                >
                  <i className="fa-solid fa-object-ungroup w-4 text-center"></i> 拆散选中消息
                </button>
              )}

              {isPrivacyMode && (
                <button
                  onClick={() => { if (onToggleHideMessage) onToggleHideMessage(messages.filter(m => selectedMessageIds.has(m.id))); setContextMenu(null); }}
                  className="w-full px-4 py-2 text-xs font-semibold text-purple-400 hover:bg-purple-500/10 transition-colors flex items-center gap-2.5"
                >
                  <i className="fa-solid fa-lock-open w-4 text-center"></i> 移出隐私
                </button>
              )}

              <button
                onClick={() => {
                  const selectedMsgs = messages.filter(m => selectedMessageIds.has(m.id));
                  if (onOpenDiaryExport) onOpenDiaryExport(selectedMsgs);
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-book-bookmark w-4 text-center"></i> 生成日记
              </button>

              <button
                onClick={() => {
                  const selectedMsgs = messages.filter(m => selectedMessageIds.has(m.id));
                  handleBatchDownload(selectedMsgs);
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-xs font-semibold text-teal-400 hover:bg-teal-500/10 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-download w-4 text-center"></i> 下载所选 ({selectedMessageIds.size})
              </button>

              <div className="my-1 border-t border-borderColor"></div>

              <button
                onClick={() => { onDeleteSelected(); setContextMenu(null); }}
                className="w-full px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-regular fa-trash-can w-4 text-center"></i> 删除选中 ({selectedMessageIds.size})
              </button>

              <button
                onClick={() => { onClearSelection(); setContextMenu(null); }}
                className="w-full px-4 py-2 text-xs text-textMuted hover:bg-white/5 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-xmark w-4 text-center"></i> 取消多选
              </button>
            </>
          )}

          {/* Copy Text — only for text messages (single-select) */}
          {selectedMessageIds.size <= 1 && contextMenu.msg.type === 'TEXT' && (
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
                  const targetMsg = contextMenu.msg;
                  setContextMenu(null);
                  setInputModalConfig({
                    isOpen: true,
                    title: '编辑文本消息',
                    hint: '修改后的文本内容将同步更新：',
                    defaultValue: targetMsg.content || '',
                    placeholder: '请输入消息内容...',
                    confirmText: '保存编辑',
                    onConfirm: (newText) => {
                      setInputModalConfig(prev => ({ ...prev, isOpen: false }));
                      if (onEditTextMessage) onEditTextMessage(targetMsg.id, newText);
                    }
                  });
                }}
                className="w-full px-4 py-2 text-xs text-textPrimary hover:bg-white/5 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-pen-to-square text-accentColor w-4 text-center"></i> 编辑消息
              </button>
            </>
          )}

          {/* Folder Specific Actions */}
          {selectedMessageIds.size <= 1 && contextMenu.msg.type === 'FOLDER' && (
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
          {selectedMessageIds.size <= 1 && currentFolderId && contextMenu.msg.type !== 'FOLDER' && (
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
          {selectedMessageIds.size <= 1 && contextMenu.msg.type !== 'TEXT' && contextMenu.msg.type !== 'FOLDER' && (
            <>
              <button
                onClick={() => {
                  const targetMsg = contextMenu.msg;
                  setContextMenu(null);
                  handleSaveAs(targetMsg);
                }}
                className="w-full px-4 py-2 text-xs text-cyan-400 hover:bg-cyan-500/10 transition-colors flex items-center gap-2.5 font-semibold"
              >
                <i className="fa-solid fa-floppy-disk text-cyan-400 w-4 text-center"></i> 另存为...
              </button>

              <button
                onClick={() => {
                  handleBatchDownload([contextMenu.msg]);
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-xs text-teal-400 hover:bg-teal-500/10 transition-colors flex items-center gap-2.5 font-semibold"
              >
                <i className="fa-solid fa-download text-teal-400 w-4 text-center"></i> 下载文件/消息
              </button>

              <button
                onClick={() => {
                  setContextMenu(null);
                  handleOpenDownloadsFolder();
                }}
                className="w-full px-4 py-2 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-folder-open text-amber-400 w-4 text-center"></i> 打开下载文件夹
              </button>

              <button
                onClick={() => {
                  const targetMsg = contextMenu.msg;
                  setContextMenu(null);
                  setInputModalConfig({
                    isOpen: true,
                    title: targetMsg.caption ? '修改注释' : '添加注释',
                    hint: '给该条目添加便于搜索与检索的关联描述：',
                    defaultValue: targetMsg.caption || '',
                    placeholder: '请输入注释文字...',
                    confirmText: '保存注释',
                    onConfirm: (newCap) => {
                      setInputModalConfig(prev => ({ ...prev, isOpen: false }));
                      if (onUpdateCaption) onUpdateCaption(targetMsg.id, newCap);
                    }
                  });
                }}
                className="w-full px-4 py-2 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-2.5"
              >
                <i className="fa-solid fa-note-sticky w-4 text-center"></i> {contextMenu.msg.caption ? '修改注释' : '添加注释'}
              </button>
            </>
          )}

          {/* Select — enter multi-select mode */}
          {selectedMessageIds.size <= 1 && (
            <button
              onClick={() => {
                const ids = contextMenu.msgs.map(m => m.id);
                ids.forEach(id => onToggleMessageSelection(id));
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-xs text-textPrimary hover:bg-white/5 transition-colors flex items-center gap-2.5"
            >
              <i className="fa-regular fa-square-check text-textMuted w-4 text-center"></i> 多选
            </button>
          )}

          {/* Move out of Privacy (only when in privacy mode) */}
          {selectedMessageIds.size <= 1 && isPrivacyMode && (
            <button
              onClick={() => {
                if (onToggleHideMessage) onToggleHideMessage(contextMenu.msgs);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-xs text-purple-400 hover:bg-purple-500/10 transition-colors flex items-center gap-2.5"
            >
              <i className="fa-solid fa-lock-open w-4 text-center"></i>
              移出隐私
            </button>
          )}

          {/* Ungroup option if right clicking a grouped card */}
          {selectedMessageIds.size <= 1 && (contextMenu.msg.groupId || contextMenu.msgs.length > 1) && (
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

          {/* Delete (single) */}
          {selectedMessageIds.size <= 1 && (
            <button
              onClick={() => {
                onDeleteMessage(contextMenu.msg);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2.5"
            >
              <i className="fa-regular fa-trash-can w-4 text-center"></i> 删除消息
            </button>
          )}
        </div>
      )}

      {/* Calendar Jump Modal */}
      <CalendarModal
        isOpen={showCalendarModal}
        onClose={() => setShowCalendarModal(false)}
        messages={filteredMessages}
        onSelectDate={handleSelectCalendarDate}
      />

      {/* Diary Web Page Live Preview Modal */}
      {previewWebUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-bgSecondary border border-borderColor rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-borderColor bg-bgPrimary/60">
              <div className="flex items-center gap-2 min-w-0">
                <i className="fa-solid fa-globe text-cyan-400"></i>
                <span className="text-xs font-mono text-textPrimary truncate max-w-md">{previewWebUrl}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 rounded-lg text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-all flex items-center gap-1"
                >
                  <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                  <span>新窗口打开</span>
                </a>
                <button
                  onClick={() => setPreviewWebUrl(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-bgPrimary text-textMuted hover:text-textPrimary transition-all"
                >
                  <i className="fa-solid fa-xmark text-sm"></i>
                </button>
              </div>
            </div>
            <iframe
              src={previewWebUrl}
              className="flex-1 w-full h-full border-none bg-white"
              title="Diary Preview"
            />
          </div>
        </div>
      )}
      {/* Input Modal for Edit Message, Caption, Privacy PIN */}
      <InputModal
        isOpen={inputModalConfig.isOpen}
        title={inputModalConfig.title}
        hint={inputModalConfig.hint}
        defaultValue={inputModalConfig.defaultValue}
        placeholder={inputModalConfig.placeholder}
        inputType={inputModalConfig.inputType || 'text'}
        confirmText={inputModalConfig.confirmText || '确定'}
        onConfirm={inputModalConfig.onConfirm}
        onCancel={() => setInputModalConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </main>
  );
}
