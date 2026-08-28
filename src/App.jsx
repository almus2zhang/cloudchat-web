import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsModal from './components/SettingsModal';
import CategoryModal from './components/CategoryModal';
import ConfirmModal from './components/ConfirmModal';
import FolderPickerModal from './components/FolderPickerModal';
import MediaViewer from './components/MediaViewer';
import DiaryExportModal from './components/DiaryExportModal';
import InputModal from './components/InputModal';
import DebugLogsModal from './components/DebugLogsModal';
import GuideModal from './components/GuideModal';
import ForwardToProfileModal from './components/ForwardToProfileModal';
import { StorageClient, checkWebLanStatus } from './services/storage';
import { initDB, cacheFile, getCachedFile, clearAllCache, deleteCachedFile } from './services/db';
import { generateInitialAvatarBlob } from './utils/avatar';

// Global media URL lookup cache
const cachedMediaUrls = {};
// Global avatar URL lookup cache (filename -> blob URL)
const cachedAvatarUrls = {};
// Persistent tracker: avatars that are locally-generated fallbacks (NOT real server files).
// Stored in localStorage so it survives page refresh.
const LS_GENERATED_AVATARS_KEY = 'cloudchat_generated_avatar_keys';
const generatedAvatarKeys = {
  _set: null,
  _load() {
    if (!this._set) {
      try { this._set = new Set(JSON.parse(localStorage.getItem(LS_GENERATED_AVATARS_KEY) || '[]')); }
      catch { this._set = new Set(); }
    }
    return this._set;
  },
  has(key) { return this._load().has(key); },
  add(key) { this._load().add(key); try { localStorage.setItem(LS_GENERATED_AVATARS_KEY, JSON.stringify([...this._set])); } catch {} },
  delete(key) { this._load().delete(key); try { localStorage.setItem(LS_GENERATED_AVATARS_KEY, JSON.stringify([...this._set])); } catch {} },
};
if (typeof window !== 'undefined') {
  window.__cachedAvatarUrls = cachedAvatarUrls;
}

export default function App() {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeUploads, setActiveUploads] = useState({});
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedMessageIds, setSelectedMessageIds] = useState(new Set());
  
  // Debug Log States
  const [debugLogs, setDebugLogs] = useState([]);
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [guideModalOpen, setGuideModalOpen] = useState(false);

  const addDebugLog = (msg) => {
    if (localStorage.getItem('cloudchat_web_debug_log_enabled') === 'false') return;
    const timeStr = new Date().toLocaleTimeString();
    const logLine = `[${timeStr}] ${msg}`;
    console.log(`[CloudChat Debug] ${logLine}`);
    setDebugLogs(prev => [...prev.slice(-300), logLine]);
  };

  if (typeof window !== 'undefined') {
    window.__addDebugLog = addDebugLog;
  }
  
  // Sidebar and Modal States
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryTarget, setCategoryTarget] = useState(null); // msg object or null (bulk mode)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '', onOk: () => {} });
  const [diaryExportOpen, setDiaryExportOpen] = useState(false);
  const [diaryExportFolder, setDiaryExportFolder] = useState(null);
  const [diaryExportSelectedMsgs, setDiaryExportSelectedMsgs] = useState(null);

  // Folder nesting states: 移入文件夹 & 打包时选择父文件夹
  const [moveIntoFolderOpen, setMoveIntoFolderOpen] = useState(false);
  const [moveIntoFolderContextId, setMoveIntoFolderContextId] = useState(null);
  const [chooseParentFolderOpen, setChooseParentFolderOpen] = useState(false);
  const [chooseParentTargets, setChooseParentTargets] = useState([]); // 候选父文件夹消息数组

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

  const handleOpenDiaryExport = (folderMsgOrMsgs) => {
    if (!folderMsgOrMsgs) return;
    if (Array.isArray(folderMsgOrMsgs)) {
      setDiaryExportFolder(null);
      // 过滤掉隐私条目，隐私条目不打入日记
      setDiaryExportSelectedMsgs(folderMsgOrMsgs.filter(m => !m.isDeleted && !m.isHidden));
      setDiaryExportOpen(true);
    } else {
      setDiaryExportFolder(folderMsgOrMsgs);
      setDiaryExportSelectedMsgs(null);
      setDiaryExportOpen(true);
    }
  };
  
  // Media Viewer States
  const [mediaViewerOpen, setMediaViewerOpen] = useState(false);
  const [mediaList, setMediaList] = useState([]);
  const [mediaIndex, setMediaIndex] = useState(0);

  // Sync status
  const [statusText, setStatusText] = useState('Connecting...');
  const [statusDotClass, setStatusDotClass] = useState('bg-yellow-500');
  const [isSyncing, setIsSyncing] = useState(false);

  // Privacy Mode States
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  const [privacyPin, setPrivacyPin] = useState('1234');

  // Forward to other profile state
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [forwardTargetMsgs, setForwardTargetMsgs] = useState([]);

  // 日记文件个数（真实 WebDAV 日记文件数，用于 Sidebar 显示）
  const [diaryFileCount, setDiaryFileCount] = useState(0);
  const activeClientRef = useRef(null);
  const syncTimerRef = useRef(null);
  const lastKnownCloudIndexTimeRef = useRef(0);
  const legacyHistoryMissingRef = useRef(false);
  const shardTimestampsRef = useRef({});
  const currentProfileRef = useRef(null);

  const currentProfile = profiles.find(p => p.id === activeProfileId) || null;
  currentProfileRef.current = currentProfile;

  const [isSameLan, setIsSameLan] = useState(true);

  useEffect(() => {
    if (!currentProfile) return;
    let isSubscribed = true;
    checkWebLanStatus(currentProfile).then(res => {
      if (isSubscribed) {
        setIsSameLan(res.isSameLan);
        const effectiveConfig = { ...currentProfile, isSameLan: res.isSameLan };
        activeClientRef.current = StorageClient.create(effectiveConfig);
      }
    });
    return () => { isSubscribed = false; };
  }, [currentProfile?.webDavUrl, currentProfile?.webDavFallbackUrl]);

  // 1. Initial Load
  useEffect(() => {
    const initApp = async () => {
      await initDB();
      
      const rawProfiles = localStorage.getItem('cloudchat_web_profiles');
      let loadedProfiles = [];
      if (rawProfiles) {
        try {
          loadedProfiles = JSON.parse(rawProfiles);
          setProfiles(loadedProfiles);
        } catch (e) {
          console.error(e);
        }
      }

      const activeId = localStorage.getItem('cloudchat_web_active_profile_id');
      const startId = activeId || (loadedProfiles[0] ? loadedProfiles[0].id : null);
      if (startId) {
        setActiveProfileId(startId);
      } else {
        setStatusText('Setup server profile in settings');
        setStatusDotClass('bg-red-500');
      }
    };
    initApp();

    // Listen to global media viewer trigger event
    const handleOpenViewer = (e) => {
      if (e.detail && e.detail.mediaList) {
        const targetMsgId = e.detail.msgId;
        const list = e.detail.mediaList;
        const index = list.findIndex(m => m.id === targetMsgId);
        if (index !== -1) {
          setMediaList(list);
          setMediaIndex(index);
          setMediaViewerOpen(true);
        }
      } else {
        const targetMsgId = typeof e.detail === 'string' ? e.detail : e.detail.msgId;
        const normalize = (cat) => cat === '工作' ? 'work' : (cat === '日记' ? 'diary' : (cat === '传输' ? '传输' : (cat === '隐私' ? 'privacy' : cat)));
        const list = messages.filter(m => {
          if (m.type !== 'IMAGE' && m.type !== 'VIDEO') return false;
          if (activeCategory !== 'all') {
            return Array.isArray(m.categories) && m.categories.map(normalize).includes(normalize(activeCategory));
          }
          return true;
        });
        const index = list.findIndex(m => m.id === targetMsgId);
        if (index !== -1) {
          setMediaList(list);
          setMediaIndex(index);
          setMediaViewerOpen(true);
        }
      }
    };
    window.addEventListener('open-media-viewer', handleOpenViewer);
    return () => {
      window.removeEventListener('open-media-viewer', handleOpenViewer);
    };
  }, [messages]);

  // 2. Profile Changed -> Reload messages and restart sync loop
  // 刷新日记文件个数（从 WebDAV 读取真实日记文件列表）
  const refreshDiaryCount = React.useCallback(async () => {
    const client = activeClientRef.current;
    if (!client || typeof client.listDiaryFiles !== 'function') return;
    try {
      const list = await client.listDiaryFiles();
      setDiaryFileCount(Array.isArray(list) ? list.length : 0);
    } catch (e) {
      console.error('Failed to refresh diary count:', e);
    }
  }, []);

  useEffect(() => {
    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }

    if (!activeProfileId) return;

    // Load local cache messages from IndexedDB asynchronously (handles legacy migration)
    const loadCache = async () => {
      try {
        const dbMsgs = await getCachedFile(`history_array_${activeProfileId}`);
        if (dbMsgs && Array.isArray(dbMsgs)) {
          const { sanitized } = sanitizeMessages(dbMsgs);
          // Clear stale blob: URLs - blob URLs don't survive page refresh
          sanitized.forEach(m => { if (m.url && String(m.url).startsWith('blob:')) { delete m.url; } });
          setMessages(sanitized);
          const alive = sanitized.filter(m => !m.isDeleted);
          resolveLocalMediaUrls(alive);
          return;
        }
      } catch (e) {
        console.warn('Failed to read from IndexedDB:', e);
      }

      const cached = localStorage.getItem(`cloudchat_history_${activeProfileId}`);
      if (cached) {
        try {
          const msgs = JSON.parse(cached);
          const { sanitized } = sanitizeMessages(msgs);
          // Clear stale blob: URLs - blob URLs don't survive page refresh
          sanitized.forEach(m => { if (m.url && String(m.url).startsWith('blob:')) { delete m.url; } });
          setMessages(sanitized);
          const alive = sanitized.filter(m => !m.isDeleted);
          resolveLocalMediaUrls(alive);
          // Migrate legacy cache to DB (keep full list with isDeleted for merge correctness)
          cacheFile(`history_array_${activeProfileId}`, sanitized);
          localStorage.removeItem(`cloudchat_history_${activeProfileId}`);
        } catch (e) {
          setMessages([]);
        }
      } else {
        setMessages([]);
      }
    };
    loadCache();

    // Reset sync state
    lastKnownCloudIndexTimeRef.current = 0;
    legacyHistoryMissingRef.current = false;
    setStatusText('Connecting...');
    setStatusDotClass('bg-yellow-500');

    if (currentProfile) {
      activeClientRef.current = StorageClient.create(currentProfile);
      
      // Initial sync
      syncHistory();
      
      // 读取真实日记文件个数
      refreshDiaryCount();
      
      // Periodically sync
      const interval = Math.max(currentProfile.syncInterval || 5, 2) * 1000;
      syncTimerRef.current = setInterval(syncHistory, interval);
    }

    return () => {
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
      }
    };
  }, [activeProfileId, refreshDiaryCount]);

  const resolveMediaMessageUrl = async (msg) => {
    if (!msg.id || msg.url) return msg.url;
    
    // 1. Check memory cache
    if (cachedMediaUrls[msg.id]) {
      return cachedMediaUrls[msg.id];
    }
    
    // 2. Check IndexedDB cache (both legacy composite key and new msg.id key)
    const cacheKey1 = `${msg.id}_${msg.content}`;
    const cacheKey2 = msg.id;
    let blob = await getCachedFile(cacheKey1) || await getCachedFile(cacheKey2);
    if (blob) {
      const url = URL.createObjectURL(blob);
      cachedMediaUrls[msg.id] = url;
      return url;
    }
    
    // 3. Fallback: Download from cloud storage provider
    const client = activeClientRef.current;
    if (!client) return null;
    
    try {
      let finalBlob = null;
      const mainSize = await client.getFileSize(msg.content);
      if (!msg.isChunked || mainSize > 0) {
        finalBlob = await client.downloadFile(msg.content);
      } else {
        const chunks = [];
        const total = msg.totalChunks;
        for (let i = 0; i < total; i++) {
          const partName = `${msg.content}.part${i}`;
          const partBlob = await client.downloadFile(partName);
          chunks.push(partBlob);
        }
        const mimeType = msg.type === 'IMAGE' ? 'image/jpeg' : (msg.type === 'VIDEO' ? 'video/mp4' : 'audio/mp4');
        finalBlob = new Blob(chunks, { type: mimeType });
      }
      
      if (finalBlob) {
        cacheFile(cacheKey1, finalBlob);
        const url = URL.createObjectURL(finalBlob);
        cachedMediaUrls[msg.id] = url;
        return url;
      }
    } catch (e) {
      console.error('Failed to download media item:', msg.content, e);
    }
    return null;
  };

  // 2b. Resolve avatar filename -> blob URL via downloadFile (avoids WebDAV auth popups)
  const resolveAvatarUrl = async (avatarFilename) => {
    if (!avatarFilename || typeof avatarFilename !== 'string') return null;
    if (avatarFilename.startsWith('content://') || avatarFilename.startsWith('file://')) return null;
    if (avatarFilename.startsWith('data:') || avatarFilename.startsWith('https://') || avatarFilename.startsWith('http://')) return avatarFilename;

    const isGenerated = generatedAvatarKeys.has(avatarFilename);

    // Return cached memory URL only for real (non-generated) avatars
    if (cachedAvatarUrls[avatarFilename] && !isGenerated) {
      return cachedAvatarUrls[avatarFilename];
    }

    // Check IndexedDB only if NOT marked as a generated fallback
    // (generated fallbacks are intentionally NOT stored in IndexedDB to avoid pollution)
    if (!isGenerated) {
      try {
        const cachedBlob = await getCachedFile(`avatar_${avatarFilename}`);
        if (cachedBlob) {
          const url = URL.createObjectURL(cachedBlob);
          cachedAvatarUrls[avatarFilename] = url;
          return url;
        }
      } catch (e) {
        console.warn('[Avatar] IndexedDB lookup warning:', e);
      }
    }

    // Try to download from server
    const client = activeClientRef.current;
    if (!client) {
      // No client yet - return existing memory URL if any (may be generated, better than nothing)
      return cachedAvatarUrls[avatarFilename] || null;
    }

    try {
      const blob = await client.downloadFile(avatarFilename);
      if (blob && blob.size > 0) {
        // Real avatar from server: clear generated marker, store in IndexedDB
        generatedAvatarKeys.delete(avatarFilename);
        cacheFile(`avatar_${avatarFilename}`, blob);
        const url = URL.createObjectURL(blob);
        cachedAvatarUrls[avatarFilename] = url;
        return url;
      }
    } catch (e) {
      const errMsg = e?.message || String(e);
      const is404 = errMsg.includes('404');
      console.warn(`[Avatar] fetch failed [${is404 ? '404' : 'network-err'}]:`, avatarFilename);

      try {
        const fallbackName = avatarFilename.replace(/^avatar_*/, '').replace(/\.jpg$/, '') || 'User';
        const fallbackBlob = await generateInitialAvatarBlob(fallbackName);
        if (fallbackBlob) {
          const url = URL.createObjectURL(fallbackBlob);
          cachedAvatarUrls[avatarFilename] = url;

          if (is404) {
            // 文件确实不存在 (404): 缓存并上传补全
            cacheFile(`avatar_${avatarFilename}`, fallbackBlob);
            client.uploadFile(fallbackBlob, avatarFilename, 'image/jpeg').catch(err =>
              console.warn('[Avatar] fallback upload warning:', err));
          } else {
            // 网络错误: 仅内存缓存，标记为本地生成，不写 IndexedDB 不上传服务器
            // 确保旧的污染 IndexedDB 缓存被清除
            generatedAvatarKeys.add(avatarFilename);
            deleteCachedFile(`avatar_${avatarFilename}`).catch(() => {});
            console.info('[Avatar] local-only generated (will retry server next call):', avatarFilename);
          }
          return url;
        }
      } catch (genErr) {
        console.warn('[Avatar] fallback generation error:', genErr);
      }
    }

    return cachedAvatarUrls[avatarFilename] || null;
  };

  const resolveTextMessageUrl = async (msg) => {
    const isTextFile = msg.isTextFile || (msg.type === 'TEXT' && msg.content && msg.content.startsWith('text_') && msg.content.endsWith('.txt'));
    if (!isTextFile) return msg.content;
    if (msg.resolvedText) return msg.resolvedText;

    const fileName = msg.content;
    const cacheKey1 = `${msg.id}_${fileName}`;
    const cacheKey2 = msg.id;

    try {
      let blob = await getCachedFile(cacheKey1) || await getCachedFile(cacheKey2);
      if (blob) {
        const text = await blob.text();
        return text;
      }

      const client = activeClientRef.current;
      if (client) {
        const text = typeof client.downloadText === 'function' ? await client.downloadText(fileName) : await (await client.downloadFile(fileName)).text();
        if (text) {
          const textBlob = new Blob([text], { type: 'text/plain;charset=utf-8' });
          cacheFile(cacheKey1, textBlob);
          return text;
        }
      }
    } catch (e) {
      console.warn('[Text] Failed to download text file:', fileName, e);
    }
    return msg.textPreview || msg.content;
  };

  // 3. Resolve cached media files & offloaded text files asynchronously
  const resolveLocalMediaUrls = async (msgs) => {
    let changed = false;
    const updated = await Promise.all(msgs.map(async (msg) => {
      const msgType = String(msg.type || '').toUpperCase();
      if (['IMAGE', 'VIDEO', 'AUDIO'].includes(msgType) && !msg.url) {
        const url = await resolveMediaMessageUrl(msg);
        if (url) {
          msg.url = url;
          changed = true;
        }
      } else if ((msgType === 'TEXT' || msg.isTextFile) && (msg.isTextFile || (msg.content && msg.content.startsWith('text_') && msg.content.endsWith('.txt'))) && !msg.resolvedText) {
        const text = await resolveTextMessageUrl(msg);
        if (text && text !== msg.content) {
          msg.resolvedText = text;
          changed = true;
        }
      }
      return msg;
    }));
    if (changed) {
      setMessages([...updated]);
    }
  };

  // Sanitizer to repair corrupted or invalid historical message objects
  const sanitizeMessages = (list) => {
    if (!Array.isArray(list)) return [];
    
    let repairedCount = 0;
    const sanitized = list.map((msg, idx) => {
      if (!msg || typeof msg !== 'object') return null;
      
      // Ignore completely empty/corrupted ghost entries
      if (!msg.id && !msg.content && !msg.remoteUrl && !msg.url) return null;

      const safeId = (msg.id && typeof msg.id === 'string' && msg.id.trim()) 
        ? msg.id.trim() 
        : `msg_repaired_${Date.now()}_${idx}`;

      // Fix invalid/zero timestamps so messages don't jump to the top
      let safeTimestamp = Number(msg.timestamp);
      if (isNaN(safeTimestamp) || safeTimestamp <= 0) {
        safeTimestamp = Date.now() - (list.length - idx) * 1000;
        repairedCount++;
      }

      let safeType = msg.type ? String(msg.type).toUpperCase() : null;
      if (!safeType) {
        const textContent = msg.content || '';
        if (textContent.startsWith('[位置] ')) {
          safeType = 'LOCATION';
        } else if (msg.remoteUrl || msg.url) {
          const ext = textContent.substring(textContent.lastIndexOf('.')).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) safeType = 'IMAGE';
          else if (['.mp4', '.webm', '.mkv', '.mov'].includes(ext)) safeType = 'VIDEO';
          else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) safeType = 'AUDIO';
          else safeType = 'TEXT';
        } else {
          safeType = 'TEXT';
        }
      }
      msg.type = safeType;

      let safeCategories = [];
      if (Array.isArray(msg.categories)) {
        safeCategories = msg.categories;
      } else if (msg.categories && typeof msg.categories === 'string') {
        safeCategories = [msg.categories];
      }

      let safeGroupId = (msg.groupId !== undefined && msg.groupId !== null && String(msg.groupId).trim() !== '') ? String(msg.groupId).trim() : null;

      return {
        ...msg,
        id: safeId,
        content: msg.content || '',
        timestamp: safeTimestamp,
        type: safeType,
        groupId: safeGroupId,
        sender: msg.sender || 'Unknown',
        senderName: msg.senderName || msg.sender || 'Unknown',
        categories: safeCategories
      };
    }).filter(Boolean);

    return { sanitized, repairedCount };
  };

  const scrollToBottom = (force = false) => {
    if (!force && typeof localStorage !== 'undefined' && localStorage.getItem('cloudchat_lock_scroll') === 'true') {
      return;
    }
    try {
      const containers = document.querySelectorAll('.chat-messages-container, [data-chat-messages], .overflow-y-auto');
      containers.forEach(el => {
        if (el && el.scrollHeight) {
          el.scrollTop = el.scrollHeight;
        }
      });
    } catch (e) {}
  };

  // --- Core Sync Logic ---
  const syncHistory = async (force = false) => {
    if (isSyncing || !currentProfileRef.current || !activeClientRef.current) return;
    setIsSyncing(true);
    if (force) {
      shardTimestampsRef.current = {};
    }

    addDebugLog(`=== 开始同步历史记录 (force=${force}) ===`);
    addDebugLog(`当前账号: ${currentProfileRef.current.name} (${currentProfileRef.current.saveDir}), 类型: ${currentProfileRef.current.serverType}`);

    try {
      const client = activeClientRef.current;
      
      if (typeof client.ensureDirectoriesExist === 'function') {
        addDebugLog(`[Sync] 检查并初始化必要子目录...`);
        await client.ensureDirectoriesExist();
      }

      addDebugLog(`[Sync] 获取 chat_index.json 修改时间...`);
      let cloudIndexTime = await client.getLastModified('chat_index.json');
      addDebugLog(`[Sync] chat_index.json 修改时间结果: ${cloudIndexTime}`);
      let indexData = {};
      let needsMigration = false;

      if (cloudIndexTime === 0) {
        addDebugLog(`[Sync] chat_index.json 修改时间为 0，尝试直接试读下载 chat_index.json...`);
        try {
          const indexText = typeof client.downloadText === 'function' ? await client.downloadText('chat_index.json') : await (await client.downloadFile('chat_index.json')).text();
          addDebugLog(`[Sync] 试读 chat_index.json 成功, 文本长度: ${indexText?.length}, 前100字: ${indexText?.slice(0, 100)}`);
          if (indexText && (indexText.trim().startsWith('{') || indexText.trim().startsWith('['))) {
            cloudIndexTime = Date.now();
          }
        } catch (e) {
          addDebugLog(`[Sync] 试读 chat_index.json 失败: ${e.message || e}`);
        }
      }

      if (cloudIndexTime === 0) {
        addDebugLog(`[Sync] 试读 index 仍为 0，检查旧版单文件 chat_history.json...`);
        if (!legacyHistoryMissingRef.current) {
          const oldTime = await client.getLastModified('chat_history.json');
          addDebugLog(`[Sync] chat_history.json 修改时间: ${oldTime}`);
          if (oldTime > 0) {
            needsMigration = true;
          } else {
            try {
              const legacyText = typeof client.downloadText === 'function' ? await client.downloadText('chat_history.json') : await (await client.downloadFile('chat_history.json')).text();
              addDebugLog(`[Sync] 试读 legacy chat_history.json 成功: ${legacyText?.slice(0, 100)}`);
              if (legacyText && legacyText.trim().startsWith('[')) {
                needsMigration = true;
              } else {
                legacyHistoryMissingRef.current = true;
              }
            } catch (e) {
              addDebugLog(`[Sync] 试读 legacy chat_history.json 失败: ${e.message || e}`);
              legacyHistoryMissingRef.current = true;
            }
          }
        }
        
        if (!needsMigration) {
          addDebugLog(`[Sync] 确认云端没有任何历史索引文件 (chat_index.json / chat_history.json)`);
          
          // 若当前无消息（如修改存储路径/前缀丢弃本地缓存后），服务器无记录时创建 dummy 记录并上传初始化
          setMessages(prev => {
            if (prev.length === 0) {
              addDebugLog(`[Sync] 本地记录为空且云端无记录，自动创建 dummy 初始化记录...`);
              const dummyMsg = {
                id: 'msg_dummy_' + Date.now(),
                sender: currentProfileRef.current?.username || 'system',
                senderName: currentProfileRef.current?.username || 'system',
                senderAvatar: currentProfileRef.current?.avatar || '',
                content: '存储路径初始化成功',
                timestamp: Date.now(),
                type: 'TEXT',
                isOutgoing: false,
                status: 'SUCCESS',
                categories: [],
                lastModified: Date.now()
              };
              cacheFile(`history_array_${currentProfileRef.current.id}`, [dummyMsg]);
              setTimeout(() => pushHistoryToCloud([dummyMsg]), 10);
              return [dummyMsg];
            }
            return prev;
          });

          setStatusText('Connected (Initialized)');
          setStatusDotClass('bg-green-500');
          setIsSyncing(false);
          return;
        }
      }

      addDebugLog(`[Sync] 比对结果: force=${force}, cloudTime=${cloudIndexTime}, lastKnown=${lastKnownCloudIndexTimeRef.current}, needsMigration=${needsMigration}`);
      if (force || cloudIndexTime > lastKnownCloudIndexTimeRef.current || needsMigration) {
        let downloadedMessages = [];
        let anyShardChanged = false;
        let repairedTotal = 0;

        if (needsMigration) {
            addDebugLog(`[Sync] 正在迁移旧版 chat_history.json...`);
            const text = typeof client.downloadText === 'function' ? await client.downloadText('chat_history.json') : await (await client.downloadFile('chat_history.json')).text();
            const rawCloudMessages = JSON.parse(text);
            const { sanitized, repairedCount } = sanitizeMessages(rawCloudMessages);
            downloadedMessages = sanitized;
            repairedTotal = repairedCount;
            anyShardChanged = true;
            addDebugLog(`[Sync] 迁移成功，解出 ${sanitized.length} 条消息`);
        } else {
            addDebugLog(`[Sync] 正在下载并解析 chat_index.json...`);
            const indexText = typeof client.downloadText === 'function' ? await client.downloadText('chat_index.json') : await (await client.downloadFile('chat_index.json')).text();
            let parsedData = JSON.parse(indexText);
            const isArrayFormat = Array.isArray(parsedData);
            const shardList = isArrayFormat ? parsedData : Object.keys(parsedData);
            addDebugLog(`[Sync] chat_index.json 包含 ${shardList.length} 个分片: ${JSON.stringify(shardList)}`);

            for (const shardName of shardList) {
                let timestamp = 0;
                if (!isArrayFormat && parsedData[shardName]) {
                    timestamp = parsedData[shardName];
                } else {
                    timestamp = await client.getLastModified(shardName);
                }

                addDebugLog(`[Sync] 检查分片 ${shardName}, 云端时间: ${timestamp}, 本地记录时间: ${shardTimestampsRef.current[shardName] || 0}`);
                if (force || timestamp > (shardTimestampsRef.current[shardName] || 0)) {
                    try {
                        addDebugLog(`[Sync] 正在下载分片文件 ${shardName}...`);
                        const shardText = typeof client.downloadText === 'function' ? await client.downloadText(shardName) : await (await client.downloadFile(shardName)).text();
                        const rawMsgs = JSON.parse(shardText);
                        const { sanitized, repairedCount } = sanitizeMessages(rawMsgs);
                        downloadedMessages = [...downloadedMessages, ...sanitized];
                        shardTimestampsRef.current[shardName] = timestamp;
                        anyShardChanged = true;
                        repairedTotal += repairedCount;
                        addDebugLog(`[Sync] 分片 ${shardName} 下载完成，包含 ${sanitized.length} 条有效消息`);
                    } catch (e) {
                        addDebugLog(`[Sync ERR] 下载/解析分片 ${shardName} 失败: ${e.message || e}`);
                    }
                }
            }
        }

        addDebugLog(`[Sync] 本轮云端读取到总计 ${downloadedMessages.length} 条消息`);
        if (anyShardChanged) {
          lastKnownCloudIndexTimeRef.current = cloudIndexTime;

          setMessages(prev => {
            let mergedMap = new Map();
            prev.forEach(m => mergedMap.set(m.id, m));

            downloadedMessages.forEach(cloudMsg => {
              const existing = mergedMap.get(cloudMsg.id);
              if (!existing) {
                mergedMap.set(cloudMsg.id, cloudMsg);
              } else {
                const existingTime = existing.lastModified || existing.timestamp || 0;
                const cloudTime = cloudMsg.lastModified || cloudMsg.timestamp || 0;

                const existingDeleted = existing.isDeleted === true || String(existing.isDeleted) === 'true';
                const cloudDeleted = cloudMsg.isDeleted === true || String(cloudMsg.isDeleted) === 'true';

                if (cloudDeleted && !existingDeleted) {
                  mergedMap.set(cloudMsg.id, { ...existing, ...cloudMsg, isDeleted: true, lastModified: Math.max(existingTime, cloudTime) });
                } else if (existingDeleted && !cloudDeleted) {
                  if (cloudTime > existingTime) {
                    mergedMap.set(cloudMsg.id, cloudMsg);
                  } else {
                    mergedMap.set(cloudMsg.id, { ...existing, isDeleted: true });
                  }
                } else {
                  if (cloudTime >= existingTime) {
                    mergedMap.set(cloudMsg.id, { ...existing, ...cloudMsg });
                  }
                }
              }
            });

            const merged = Array.from(mergedMap.values());
            merged.sort((a, b) => a.timestamp - b.timestamp);

            cacheFile(`history_array_${currentProfileRef.current.id}`, merged);
            const alive = merged.filter(m => !m.isDeleted && String(m.isDeleted) !== 'true');
            resolveLocalMediaUrls(alive);
            
            if (needsMigration || repairedTotal > 0) {
              pushHistoryToCloud(merged);
            }

            addDebugLog(`[Sync] 最终刷新界面显示 ${alive.length} 条有效消息（总记录 ${merged.length} 条）`);
            return merged;
          });

          setStatusText('Synchronized');
          setStatusDotClass('bg-green-500');
          setTimeout(() => scrollToBottom(), 150);
        } else {
          addDebugLog(`[Sync] 分片无更新`);
          setStatusText('Synchronized');
          setStatusDotClass('bg-green-500');
        }
      } else {
        addDebugLog(`[Sync] 云端索引无变化`);
        setStatusText('Synchronized');
        setStatusDotClass('bg-green-500');
      }
    } catch (e) {
      addDebugLog(`[Sync ERR] 同步失败: ${e.stack || e.message || e}`);
      setStatusText(`Sync failed: ${e.message || e}`);
      setStatusDotClass('bg-red-500');
    } finally {
      setIsSyncing(false);
    }
  };

  const pushHistoryToCloud = async (overrideMsgs) => {
    const profile = currentProfileRef.current || currentProfile;
    if (!profile || !activeClientRef.current) return;
    const client = activeClientRef.current;

    const rawList = overrideMsgs || messages;
    let targetList = rawList.filter(m => m.status === 'SUCCESS');
    if (targetList.length === 0) {
      targetList = [{
        id: 'msg_dummy_init',
        sender: 'system',
        content: '',
        timestamp: Date.now(),
        type: 'TEXT',
        status: 'SUCCESS',
        isDeleted: true
      }];
    }

    cacheFile(`history_array_${profile.id}`, targetList);

    try {
      const shards = {};
      targetList.forEach(m => {
          const date = new Date(m.timestamp);
          const yyyy = date.getFullYear();
          const mm = String(date.getMonth() + 1).padStart(2, '0');
          const shardName = `chat_history_${yyyy}_${mm}.json`;
          if (!shards[shardName]) shards[shardName] = [];
          
          const { isOutgoing, url, ...clean } = m;
          shards[shardName].push(clean);
      });

      const newIndexData = Object.keys(shards);
      for (const shardName of newIndexData) {
          const cleanJson = JSON.stringify(shards[shardName]);
          await client.uploadText(cleanJson, shardName);
          const shardTime = await client.getLastModified(shardName);
          shardTimestampsRef.current[shardName] = shardTime;
      }

      await client.uploadText(JSON.stringify(newIndexData), 'chat_index.json');
      lastKnownCloudIndexTimeRef.current = await client.getLastModified('chat_index.json');

    } catch (e) {
      console.error('Failed to push history shards:', e);
    }
  };

  // --- Thumbnail Helper ---
  const generateThumbnail = async (file) => {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve(null);
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.src = url;
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        const maxDim = 800;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.7);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
    });
  };

  // --- Message Sending ---
  const handleSendMessage = async (text, file, groupId = null, folderId = null) => {
    if (!currentProfile || !activeClientRef.current) return;
    const client = activeClientRef.current;

    if (file) {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const type = isImage ? 'IMAGE' : (isVideo ? 'VIDEO' : 'FILE');
      const fileName = `${Date.now()}_${file.name}`;
      const fileSize = file.size;

      const chunkingThreshold = currentProfile.webDavChunkSize || 0;
      const useChunking = (currentProfile.type === 'WEBDAV' && chunkingThreshold > 0 && fileSize > chunkingThreshold);
      const chunkSize = useChunking ? chunkingThreshold : 0;
      const totalChunks = useChunking ? Math.ceil(fileSize / chunkSize) : 0;

      const newMsg = {
        id: 'msg_' + Date.now(),
        sender: currentProfile.username,
        senderName: currentProfile.username,
        senderAvatar: currentProfile.avatar || '',
        content: fileName,
        timestamp: Date.now(),
        type: type,
        isOutgoing: true,
        status: 'SENDING',
        url: URL.createObjectURL(file), // Show local object URL immediately
        fileSize: fileSize,
        isChunked: useChunking,
        chunkSize: chunkSize,
        totalChunks: totalChunks,
        groupId: groupId || undefined,
        folderId: folderId || undefined,
        remoteUrl: fileName,
        thumbnailUrl: isImage ? `thumb_${fileName}` : undefined,
        categories: activeCategory !== 'all' ? [activeCategory] : [],
        lastModified: Date.now()
      };

      // Cache file locally
      cacheFile(newMsg.id, file);

      setMessages(prev => {
        return [...prev, newMsg];
      });
      setTimeout(() => scrollToBottom(), 150);

      // Perform upload asynchronously
      (async () => {
        try {
          // Check if file already exists on server with exact size
          let remoteSize = -1;
          try {
            if (client.getFileSize) {
              remoteSize = await client.getFileSize(fileName);
            }
          } catch (e) {}

          if (fileSize > 0 && remoteSize === fileSize) {
            console.log(`[Upload] File ${fileName} already exists on server (${remoteSize} bytes), marking SUCCESS`);
            newMsg.status = 'SUCCESS';
            newMsg.lastModified = Date.now();
            setMessages(prev => {
              const list = prev.map(m => m.id === newMsg.id ? { ...m, status: 'SUCCESS', lastModified: Date.now() } : m);
              setTimeout(() => pushHistoryToCloud(list), 0);
              return list;
            });
            return;
          }

          if (isImage) {
            try {
              const thumbBlob = await generateThumbnail(file);
              if (thumbBlob) {
                const thumbName = `thumb_${fileName}`;
                await client.uploadFile(thumbBlob, thumbName, 'image/jpeg', () => {});
              }
            } catch (e) {
              console.warn('Failed to upload thumbnail:', e);
            }
          }

          const updateProgress = (overall) => {
            setActiveUploads(prev => ({
              ...prev,
              [newMsg.id]: overall
            }));
          };

          if (useChunking) {
            // Self-test for Range PUT support
            let supportsRangePut = false;
            try {
              const testBytes = new Uint8Array([65, 66]);
              const testName = `range_test_${Date.now()}.tmp`;
              await client.uploadFileRange(testBytes, testName, 'application/octet-stream', 0, 0, 2);
              await client.uploadFileRange(new Uint8Array([67]), testName, 'application/octet-stream', 1, 1, 2);
              const finalSize = await client.getFileSize(testName);
              if (finalSize === 2) supportsRangePut = true;
              await client.deleteFile(testName);
            } catch (e) {
              console.warn('Range PUT self test failed, falling back to physical part chunks:', e);
            }

            if (supportsRangePut) {
              newMsg.isChunked = false;
              newMsg.chunkSize = 0;
              newMsg.totalChunks = 0;

              for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, fileSize);
                const chunk = file.slice(start, end);
                await client.uploadFileRange(chunk, fileName, file.type, start, end - 1, fileSize, (prog) => {
                  const overall = Math.round(((i * 100) / totalChunks) + (prog / totalChunks));
                  updateProgress(overall);
                });
              }
            } else {
              // Part chunk fallback (.part0, .part1...)
              for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, fileSize);
                const chunk = file.slice(start, end);
                const partName = `${fileName}.part${i}`;
                await client.uploadFile(chunk, partName, file.type, (prog) => {
                  const overall = Math.round(((i * 100) / totalChunks) + (prog / totalChunks));
                  updateProgress(overall);
                });
              }
            }
          } else {
            await client.uploadFile(file, fileName, file.type, (prog) => {
              updateProgress(prog);
            });
          }

          newMsg.status = 'SUCCESS';
          setActiveUploads(prev => {
            const next = { ...prev };
            delete next[newMsg.id];
            return next;
          });
          
          setMessages(prev => {
            const list = prev.map(m => m.id === newMsg.id ? { ...m, status: 'SUCCESS' } : m);
            pushHistoryToCloud(list);
            return list;
          });
          
        } catch (e) {
          console.error(e);
          newMsg.status = 'FAILED';
          setActiveUploads(prev => {
            const next = { ...prev };
            delete next[newMsg.id];
            return next;
          });
          setMessages(prev => prev.map(m => m.id === newMsg.id ? { ...m, status: 'FAILED' } : m));
        }
      })();

    } else if (text.trim()) {
      const isTextOffload = text.length >= 500;
      const fileName = isTextOffload ? `text_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.txt` : null;

      const newMsg = {
        id: 'msg_' + Date.now() + Math.random().toString(36).substr(2, 5),
        sender: currentProfile.username,
        senderName: currentProfile.username,
        senderAvatar: currentProfile.avatar || '',
        content: isTextOffload ? fileName : text,
        timestamp: Date.now(),
        type: (text.startsWith('[位置] ')) ? 'LOCATION' : 'TEXT',
        isOutgoing: true,
        status: 'SUCCESS',
        folderId: folderId || undefined,
        categories: activeCategory !== 'all' ? [activeCategory] : [],
        lastModified: Date.now(),
        isTextFile: isTextOffload,
        textPreview: isTextOffload ? text.slice(0, 100) : undefined,
        resolvedText: text
      };

      if (isTextOffload && activeClientRef.current) {
        activeClientRef.current.uploadText(text, fileName).catch(err => {
          console.warn('[Text File Upload Warning]:', err);
        });
        const textBlob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        cacheFile(`${newMsg.id}_${fileName}`, textBlob);
        cacheFile(newMsg.id, textBlob);
      }

      let updatedList = [];
      setMessages(prev => {
        updatedList = [...prev, newMsg];
        return updatedList;
      });
      
      setTimeout(() => {
        if (updatedList.length > 0) pushHistoryToCloud(updatedList);
        scrollToBottom();
      }, 0);
    }
  };

  const handleInsertGroupedMessage = async (targetAudioMsg, textContent) => {
    if (!currentProfile || !targetAudioMsg) return;

    const targetGroupId = targetAudioMsg.groupId || `group_${targetAudioMsg.timestamp || Date.now()}`;
    const newTextMsg = {
      id: 'msg_' + Date.now() + Math.random().toString(36).substr(2, 5),
      sender: targetAudioMsg.sender || currentProfile.username,
      senderName: targetAudioMsg.senderName || currentProfile.username,
      senderAvatar: targetAudioMsg.senderAvatar || currentProfile.avatar || '',
      content: textContent,
      timestamp: targetAudioMsg.timestamp || Date.now(),
      type: 'TEXT',
      isOutgoing: targetAudioMsg.isOutgoing,
      status: 'SUCCESS',
      folderId: targetAudioMsg.folderId,
      categories: targetAudioMsg.categories || [],
      groupId: targetGroupId,
      lastModified: Date.now()
    };

    setMessages(prev => {
      const updatedList = prev.map(m => {
        if (m.id === targetAudioMsg.id) {
          return { ...m, groupId: targetGroupId, lastModified: Date.now() };
        }
        return m;
      });

      const audioIdx = updatedList.findIndex(m => m.id === targetAudioMsg.id);
      if (audioIdx !== -1) {
        updatedList.splice(audioIdx + 1, 0, newTextMsg);
      } else {
        updatedList.push(newTextMsg);
      }

      pushHistoryToCloud(updatedList);
      return [...updatedList];
    });
  };

  const handleRetryMessage = async (messageId) => {
    if (!currentProfile || !activeClientRef.current) return;
    const client = activeClientRef.current;
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;

    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'SENDING' } : m));

    const cachedFile = fileCacheRef.current ? fileCacheRef.current.get(messageId) : null;
    const fileName = msg.content;
    const fileSize = cachedFile ? cachedFile.size : (msg.fileSize || 0);

    try {
      if (msg.type === 'TEXT' || !fileName) {
        setMessages(prev => {
          const list = prev.map(m => m.id === messageId ? { ...m, status: 'SUCCESS', lastModified: Date.now() } : m);
          pushHistoryToCloud(list);
          return list;
        });
        return;
      }

      let remoteSize = -1;
      try {
        if (client.getFileSize) {
          remoteSize = await client.getFileSize(fileName);
        }
      } catch (e) {}

      if (fileSize > 0 && remoteSize === fileSize) {
        console.log(`[Retry] File ${fileName} already exists on server (${remoteSize} bytes), marking SUCCESS`);
        setMessages(prev => {
          const list = prev.map(m => m.id === messageId ? { ...m, status: 'SUCCESS', lastModified: Date.now() } : m);
          pushHistoryToCloud(list);
          return list;
        });
        return;
      }

      if (cachedFile) {
        const updateProgress = (overall) => {
          setActiveUploads(prev => ({ ...prev, [messageId]: overall }));
        };
        await client.uploadFile(cachedFile, fileName, cachedFile.type || 'application/octet-stream', updateProgress);
      }

      setActiveUploads(prev => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });

      setMessages(prev => {
        const list = prev.map(m => m.id === messageId ? { ...m, status: 'SUCCESS', lastModified: Date.now() } : m);
        pushHistoryToCloud(list);
        return list;
      });
    } catch (e) {
      console.error('[Retry failed]', e);
      setActiveUploads(prev => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'FAILED' } : m));
    }
  };

  // --- Deletion and Category modifications ---
  const handleToggleMessageSelection = (msgIdOrIds) => {
    setSelectedMessageIds(prev => {
      const next = new Set(prev);
      const ids = Array.isArray(msgIdOrIds) ? msgIdOrIds : [msgIdOrIds];
      const allSelected = ids.every(id => next.has(id));
      
      ids.forEach(id => {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedMessageIds(new Set());
  };

  const handleDeleteSelected = () => {
    setConfirmConfig({
      title: 'Delete Selected Messages',
      message: `Are you sure you want to delete ${selectedMessageIds.size} messages? They will be removed from history and recycled.`,
      onOk: async () => {
        setConfirmOpen(false);
        const client = activeClientRef.current;
        if (!client) return;

        const idsToDelete = new Set(selectedMessageIds);
        const selectedMsgs = messages.filter(m => idsToDelete.has(m.id));
        const selectedContents = new Set(selectedMsgs.map(m => m.content).filter(Boolean));
        const selectedTimestamps = new Set(selectedMsgs.map(m => m.timestamp));

        const updatedMessages = messages.map(m => {
          if (idsToDelete.has(m.id) || (m.content && selectedContents.has(m.content) && selectedTimestamps.has(m.timestamp))) {
            return { ...m, isDeleted: true, lastModified: Date.now() };
          }
          return m;
        });

        setMessages(updatedMessages);
        setSelectedMessageIds(new Set());
        await pushHistoryToCloud(updatedMessages);
      }
    });
    setConfirmOpen(true);
  };

  const handleDeleteMessage = (msg) => {
    setConfirmConfig({
      title: 'Delete Message',
      message: 'Are you sure you want to delete this message? Its files will be moved to the recycle bin.',
      onOk: async () => {
        setConfirmOpen(false);
        const client = activeClientRef.current;
        if (!client) return;

        const updatedMessages = messages.map(m => {
          if (m.id === msg.id || (m.content && m.content === msg.content && m.timestamp === msg.timestamp)) {
            return { ...m, isDeleted: true, lastModified: Date.now() };
          }
          return m;
        });
        setMessages(updatedMessages);
        await pushHistoryToCloud(updatedMessages);

      }
    });
    setConfirmOpen(true);
  };

  const handleEditMessageCategories = (msg) => {
    setCategoryTarget(msg);
    setCategoryModalOpen(true);
  };

  const handleSaveCategory = (catId) => {
    setCategoryModalOpen(false);
    
    if (categoryTarget) {
      // Single message mode
      const updated = messages.map(m => {
        if (m.id === categoryTarget.id) {
          const cats = m.categories || [];
          if (!cats.includes(catId)) return { ...m, categories: [...cats, catId] };
        }
        return m;
      });
      setMessages(updated);
      pushHistoryToCloud(updated);
      setCategoryTarget(null);
    } else {
      // Bulk select mode
      const updated = messages.map(m => {
        if (selectedMessageIds.has(m.id)) {
          const cats = m.categories || [];
          if (!cats.includes(catId)) return { ...m, categories: [...cats, catId] };
        }
        return m;
      });
      setMessages(updated);
      setSelectedMessageIds(new Set());
      pushHistoryToCloud(updated);
    }
  };

  const handleQuickAddCategory = (catId, targetMsg = null) => {
    if (targetMsg) {
      // Single message mode
      const updated = messages.map(m => {
        if (m.id === targetMsg.id) {
          const cats = m.categories || [];
          if (!cats.includes(catId)) return { ...m, categories: [...cats, catId] };
        }
        return m;
      });
      setMessages(updated);
      pushHistoryToCloud(updated);
    } else {
      // Bulk select mode
      const updated = messages.map(m => {
        if (selectedMessageIds.has(m.id)) {
          const cats = m.categories || [];
          if (!cats.includes(catId)) return { ...m, categories: [...cats, catId] };
        }
        return m;
      });
      setMessages(updated);
      setSelectedMessageIds(new Set());
      pushHistoryToCloud(updated);
    }
  };

  const handleRemoveCategorySelected = () => {
    setConfirmConfig({
      title: 'Remove Category',
      message: `Are you sure you want to remove ${selectedMessageIds.size} messages from category "${activeCategory}"?`,
      onOk: () => {
        setConfirmOpen(false);
        const normalize = (cat) => cat === '工作' ? 'work' : (cat === '日记' ? 'diary' : (cat === '传输' ? 'transfer' : (cat === '隐私' ? 'privacy' : cat)));
        const updated = messages.map(m => {
          if (selectedMessageIds.has(m.id) && m.categories) {
            return {
              ...m,
              categories: m.categories.filter(c => normalize(c) !== normalize(activeCategory))
            };
          }
          return m;
        });
        setMessages(updated);
        setSelectedMessageIds(new Set());
        pushHistoryToCloud(updated);
      }
    });
    setConfirmOpen(true);
  };

  // --- Manual Message Grouping & Ungrouping Actions ---
  const handleGroupSelected = () => {
    // 过滤掉文件夹，文件夹不参与合并
    const selectedMsgs = messages.filter(
      m => selectedMessageIds.has(m.id) && m.type !== 'FOLDER'
    );
    if (selectedMsgs.length < 2) return;

    const newGroupId = `group_${Date.now()}`;

    const existingGroupIds = new Set(
      selectedMsgs.map(m => m.groupId).filter(Boolean)
    );

    const membersOfExistingGroups = messages
      .filter(m => m.type !== 'FOLDER' && m.groupId && existingGroupIds.has(m.groupId))
      .map(m => m.id);

    const allTargetIds = new Set([
      ...selectedMsgs.map(m => m.id),
      ...membersOfExistingGroups
    ]);

    const targetGroupId = existingGroupIds.size === 1
      ? Array.from(existingGroupIds)[0]
      : newGroupId;

    const now = Date.now();
    const updated = messages.map(m => {
      if (allTargetIds.has(m.id)) {
        return { ...m, groupId: targetGroupId, lastModified: now };
      }
      return m;
    });

    setMessages(updated);
    setSelectedMessageIds(new Set());
    pushHistoryToCloud(updated);
  };

  const handleRemoteShare = async (targetMsgs = null) => {
    const client = activeClientRef.current;
    if (!client) {
      setConfirmConfig({
        title: '存储连接提示',
        message: '存储服务未连接，请先在设置中检查连接配置。',
        confirmText: '我知道了',
        cancelText: '',
        isDanger: true,
        icon: 'fa-solid fa-circle-exclamation',
        onOk: () => setConfirmOpen(false)
      });
      setConfirmOpen(true);
      return;
    }
    const msgsToShare = targetMsgs || messages.filter(m => selectedMessageIds.has(m.id));
    if (!msgsToShare || msgsToShare.length === 0) return;

    let successCount = 0;
    const generatedLinks = [];
    const shareBaseUrl = (currentProfile?.shareBaseUrl || '').trim().replace(/\/+$/, '');

    for (const msg of msgsToShare) {
      try {
        const fileName = msg.fileName || (msg.type !== 'TEXT' && msg.type !== 'FOLDER' ? msg.content : null);
        const textContent = msg.type === 'TEXT' ? (msg.resolvedText || msg.content) : null;
        if (fileName || textContent) {
          if (client.copyToShare) {
            const destFileName = await client.copyToShare(fileName, textContent);
            if (destFileName) {
              successCount++;
              if (shareBaseUrl) {
                generatedLinks.push(`${shareBaseUrl}/${destFileName}`);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Remote Share Error]:', err);
      }
    }

    if (successCount > 0) {
      if (generatedLinks.length > 0) {
        const now = Date.now();
        const newMsgs = generatedLinks.map((link, idx) => ({
          id: 'msg_' + (now + idx) + '_' + Math.random().toString(36).substr(2, 5),
          sender: currentProfile?.username || '我',
          senderName: currentProfile?.username || '我',
          senderAvatar: currentProfile?.avatar || '',
          content: link,
          timestamp: now + idx,
          type: 'TEXT',
          isOutgoing: true,
          status: 'SUCCESS',
          categories: activeCategory && activeCategory !== 'all' ? [activeCategory] : [],
          lastModified: now + idx
        }));

        setMessages(prev => {
          const updated = [...prev, ...newMsgs];
          pushHistoryToCloud(updated);
          return updated;
        });
      }
      setConfirmConfig({
        title: '远程 Share 完成',
        message: `已成功将 ${successCount} 个条目的文件拷贝至远程 share 目录${generatedLinks.length > 0 ? `，并生成了 ${generatedLinks.length} 条分享链接消息。` : '。'}`,
        confirmText: '确定',
        cancelText: '',
        isDanger: false,
        icon: 'fa-solid fa-circle-check',
        onOk: () => setConfirmOpen(false)
      });
      setConfirmOpen(true);
    } else {
      setConfirmConfig({
        title: '远程 Share 提示',
        message: '未找到可拷贝的文件或拷贝失败，请检查文件状态及存储配置。',
        confirmText: '确定',
        cancelText: '',
        isDanger: true,
        icon: 'fa-solid fa-circle-exclamation',
        onOk: () => setConfirmOpen(false)
      });
      setConfirmOpen(true);
    }
    setSelectedMessageIds(new Set());
  };

  // --- Forward to Other Profile Handlers ---
  const handleOpenForwardModal = (targetMsgs = null) => {
    const msgs = targetMsgs || messages.filter(m => selectedMessageIds.has(m.id));
    if (!msgs || msgs.length === 0) return;
    setForwardTargetMsgs(msgs);
    setForwardModalOpen(true);
  };

  const handleForwardToProfile = async (targetProfileId) => {
    setForwardModalOpen(false);
    const targetProfile = profiles.find(p => p.id === targetProfileId);
    if (!targetProfile) return;

    const msgsToForward = forwardTargetMsgs;
    if (!msgsToForward || msgsToForward.length === 0) return;

    let targetClient;
    try {
      targetClient = StorageClient.create(targetProfile);
    } catch (e) {
      setConfirmConfig({
        title: '转发失败',
        message: `无法初始化目标配置客户端: ${e.message}`,
        confirmText: '确定',
        cancelText: '',
        isDanger: true,
        icon: 'fa-solid fa-circle-exclamation',
        onOk: () => setConfirmOpen(false)
      });
      setConfirmOpen(true);
      return;
    }

    setStatusText(`正在转发消息至 ${targetProfile.name || targetProfile.username}...`);
    let successCount = 0;
    const now = Date.now();

    try {
      // 1. Fetch target profile's cloud history index and shards
      let targetIndex = [];
      try {
        const indexBlob = await targetClient.downloadFile('chat_index.json');
        const indexText = await indexBlob.text();
        targetIndex = JSON.parse(indexText);
      } catch (e) {
        targetIndex = [];
      }

      let targetHistory = [];
      for (const shardName of targetIndex) {
        try {
          const shardBlob = await targetClient.downloadFile(shardName);
          const shardText = await shardBlob.text();
          const shardMsgs = JSON.parse(shardText);
          if (Array.isArray(shardMsgs)) {
            targetHistory.push(...shardMsgs);
          }
        } catch (e) {}
      }

      // 2. Iterate each message and upload/send to target profile
      for (let i = 0; i < msgsToForward.length; i++) {
        const msg = msgsToForward[i];
        const msgType = String(msg.type || 'TEXT').toUpperCase();
        const newMsgId = 'msg_' + (now + i) + '_' + Math.random().toString(36).substr(2, 5);
        const msgTimestamp = now + i;

        if (msgType === 'TEXT' || msgType === '' || !['IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'LOCATION', 'FOLDER'].includes(msgType)) {
          const rawText = msg.resolvedText || (msg.isTextFile ? (msg.textPreview || msg.content) : msg.content) || '';
          const isOffload = rawText.length >= 500;
          let content = rawText;
          let isTextFile = false;
          let textPreview = undefined;

          if (isOffload) {
            const txtFileName = `text_${newMsgId.slice(-8)}.txt`;
            await targetClient.uploadText(rawText, txtFileName);
            content = txtFileName;
            isTextFile = true;
            textPreview = rawText.slice(0, 100);
          }

          const newMsg = {
            id: newMsgId,
            sender: targetProfile.username || '我',
            senderName: targetProfile.username || '我',
            senderAvatar: targetProfile.avatar || '',
            content: content,
            timestamp: msgTimestamp,
            type: 'TEXT',
            status: 'SUCCESS',
            isTextFile: isTextFile,
            textPreview: textPreview,
            categories: msg.categories || [],
            lastModified: msgTimestamp
          };
          targetHistory.push(newMsg);
          successCount++;
        } else if (msgType === 'LOCATION') {
          const newMsg = {
            id: newMsgId,
            sender: targetProfile.username || '我',
            senderName: targetProfile.username || '我',
            senderAvatar: targetProfile.avatar || '',
            content: msg.content || '',
            timestamp: msgTimestamp,
            type: 'LOCATION',
            locationAddress: msg.locationAddress || undefined,
            status: 'SUCCESS',
            categories: msg.categories || [],
            lastModified: msgTimestamp
          };
          targetHistory.push(newMsg);
          successCount++;
        } else if (['IMAGE', 'VIDEO', 'AUDIO', 'FILE'].includes(msgType)) {
          // Extract file Blob
          let fileBlob = null;
          try {
            fileBlob = await getCachedFile(msg.id) || await getCachedFile(msg.content);
          } catch (e) {}

          if (!fileBlob && activeClientRef.current && msg.content) {
            try {
              fileBlob = await activeClientRef.current.downloadFile(msg.content);
            } catch (e) {
              console.warn('[Forward] Failed to download source file:', msg.content, e);
            }
          }

          if (fileBlob) {
            const origFileName = (msg.fileName || msg.content || 'attachment').replace(/^\d+_/, '');
            const newFileName = `${Date.now()}_${origFileName}`;

            if (msgType === 'IMAGE') {
              try {
                const thumbBlob = await generateThumbnail(fileBlob);
                if (thumbBlob) {
                  await targetClient.uploadFile(thumbBlob, `thumb_${newFileName}`, 'image/jpeg', () => {});
                }
              } catch (e) {}
            }

            await targetClient.uploadFile(fileBlob, newFileName, fileBlob.type || 'application/octet-stream', () => {});

            const newMsg = {
              id: newMsgId,
              sender: targetProfile.username || '我',
              senderName: targetProfile.username || '我',
              senderAvatar: targetProfile.avatar || '',
              content: newFileName,
              timestamp: msgTimestamp,
              type: msgType,
              remoteUrl: newFileName,
              thumbnailUrl: msgType === 'IMAGE' ? `thumb_${newFileName}` : undefined,
              fileSize: fileBlob.size || msg.fileSize || 0,
              videoDuration: msg.videoDuration || 0,
              status: 'SUCCESS',
              categories: msg.categories || [],
              caption: msg.caption || undefined,
              lastModified: msgTimestamp
            };
            targetHistory.push(newMsg);
            successCount++;
          }
        }
      }

      // 3. Shard and push history to target cloud storage
      const shards = {};
      targetHistory.forEach(m => {
        const date = new Date(m.timestamp);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const shardName = `chat_history_${yyyy}_${mm}.json`;
        if (!shards[shardName]) shards[shardName] = [];
        const { isOutgoing, url, ...clean } = m;
        shards[shardName].push(clean);
      });

      const newIndexData = Object.keys(shards);
      for (const shardName of newIndexData) {
        const cleanJson = JSON.stringify(shards[shardName]);
        await targetClient.uploadText(cleanJson, shardName);
      }
      await targetClient.uploadText(JSON.stringify(newIndexData), 'chat_index.json');
      cacheFile(`history_array_${targetProfile.id}`, targetHistory);

      // If forwarding to current active profile, update local messages state
      if (targetProfile.id === activeProfileId) {
        setMessages(targetHistory);
      }

      setSelectedMessageIds(new Set());
      setStatusText('Synchronized');

      setConfirmConfig({
        title: '转发完成',
        message: `已成功将 ${successCount} 条消息逐条转发至配置【${targetProfile.name || targetProfile.username}】。`,
        confirmText: '确定',
        cancelText: '',
        isDanger: false,
        icon: 'fa-solid fa-circle-check',
        onOk: () => setConfirmOpen(false)
      });
      setConfirmOpen(true);

    } catch (err) {
      console.error('[Forward Error]:', err);
      setConfirmConfig({
        title: '转发失败',
        message: `转发过程中发生错误: ${err.message || err}`,
        confirmText: '确定',
        cancelText: '',
        isDanger: true,
        icon: 'fa-solid fa-circle-exclamation',
        onOk: () => setConfirmOpen(false)
      });
      setConfirmOpen(true);
    }
  };

  // --- Folder Action Handlers ---
  const handlePackFolder = (currentFolderId, folderName = '') => {
    if (selectedMessageIds.size === 0) return;

    const selectedMsgs = messages.filter(m => selectedMessageIds.has(m.id));
    const folderMsgs = selectedMsgs.filter(m => m.type === 'FOLDER');

    // 选中含 2 个及以上文件夹：弹出选择父文件夹
    if (folderMsgs.length >= 2) {
      setChooseParentTargets(folderMsgs);
      setChooseParentFolderOpen(true);
      return;
    }

    const targetFolder = folderMsgs[0] || null;

    if (targetFolder) {
      // Pack other selected items directly into the selected existing folder
      const itemsToPack = selectedMsgs.filter(m => m.type !== 'FOLDER' && m.id !== targetFolder.id);
      if (itemsToPack.length === 0) return;

      const packIds = new Set(itemsToPack.map(m => m.id));
      const updated = messages.map(m => {
        if (packIds.has(m.id)) {
          return { ...m, folderId: targetFolder.id, lastModified: Date.now() };
        }
        return m;
      });
      setMessages(updated);
      setSelectedMessageIds(new Set());
      pushHistoryToCloud(updated);
    } else {
      // Create new folder and pack selected items into it（在文件夹内时挂到当前文件夹下）
      if (!folderName) {
        setInputModalConfig({
          isOpen: true,
          title: '新建并打包文件夹',
          hint: '请输入新建文件夹的名称或注释：',
          defaultValue: '新文件夹',
          placeholder: '请输入文件夹名称...',
          confirmText: '打包',
          onConfirm: (val) => {
            setInputModalConfig(prev => ({ ...prev, isOpen: false }));
            handlePackFolder(currentFolderId, val);
          }
        });
        return;
      }
      const name = folderName;

      const firstMsg = selectedMsgs.find(m => m.type !== 'FOLDER') || selectedMsgs[0];
      const newFolderId = 'folder_' + Date.now();
      const newFolderMsg = {
        id: newFolderId,
        sender: firstMsg?.sender || currentProfile.username,
        senderName: firstMsg?.senderName || firstMsg?.sender || currentProfile.username,
        senderAvatar: firstMsg?.senderAvatar || currentProfile.avatar || '',
        content: (name && name.trim()) ? name.trim() : '文件夹',
        timestamp: Date.now(),
        type: 'FOLDER',
        isOutgoing: firstMsg ? firstMsg.isOutgoing : true,
        status: 'SUCCESS',
        categories: activeCategory !== 'all' ? [activeCategory] : [],
        folderId: currentFolderId || undefined,
        lastModified: Date.now()
      };

      const selectedIds = new Set(selectedMessageIds);
      const updated = messages.map(m => {
        if (selectedIds.has(m.id)) {
          return { ...m, folderId: newFolderId, lastModified: Date.now() };
        }
        return m;
      });
      const finalList = [...updated, newFolderMsg];
      setMessages(finalList);
      setSelectedMessageIds(new Set());
      pushHistoryToCloud(finalList);
    }
  };

  // 选择父文件夹确认：其余所有项（含其它文件夹）放入选中的父文件夹
  const handleChooseParentFolderConfirm = (parentId) => {
    setChooseParentFolderOpen(false);
    const others = Array.from(selectedMessageIds).filter(id => id !== parentId);
    if (others.length === 0) { setSelectedMessageIds(new Set()); return; }
    const targetSet = new Set(others);
    const updated = messages.map(m => {
      if (targetSet.has(m.id)) {
        return { ...m, folderId: parentId, lastModified: Date.now() };
      }
      return m;
    });
    setMessages(updated);
    setSelectedMessageIds(new Set());
    pushHistoryToCloud(updated);
  };

  // 移入文件夹：把选中消息（含文件夹）移动到目标文件夹（防循环）
  const handleMoveIntoFolder = (currentFolderId = null) => {
    if (selectedMessageIds.size === 0) return;
    setMoveIntoFolderContextId(currentFolderId);
    setMoveIntoFolderOpen(true);
  };

  const handleMoveIntoFolderConfirm = (targetFolderId) => {
    setMoveIntoFolderOpen(false);
    const targetSet = new Set(selectedMessageIds);
    // 防循环：目标不能是选中文件夹中的某个或其祖先
    const selectedFolderIds = new Set(
      messages.filter(m => targetSet.has(m.id) && m.type === 'FOLDER').map(m => m.id)
    );
    if (selectedFolderIds.has(targetFolderId)) return;
    // 目标祖先链中不能包含选中的文件夹
    let cur = messages.find(m => m.id === targetFolderId);
    while (cur && cur.folderId) {
      if (selectedFolderIds.has(cur.folderId)) return;
      cur = messages.find(m => m.id === cur.folderId);
    }
    const updated = messages.map(m => {
      if (targetSet.has(m.id)) {
        return { ...m, folderId: targetFolderId, lastModified: Date.now() };
      }
      return m;
    });
    setMessages(updated);
    setSelectedMessageIds(new Set());
    pushHistoryToCloud(updated);
  };

  // 递归收集指定文件夹下的所有消息（排除 FOLDER 本身、isDeleted 与隐私条目）
  const collectFolderMessagesRecursive = (folderId) => {
    const result = [];
    const visited = new Set();
    const queue = [folderId];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      messages.filter(m => !m.isDeleted && !m.isHidden && m.folderId === cur).forEach(child => {
        if (child.type === 'FOLDER') queue.push(child.id);
        else result.push(child);
      });
    }
    return result;
  };

  // 构建文件夹树（用于日记折叠渲染，排除隐私条目）
  const buildFolderTree = (folderId) => {
    const folderMsg = messages.find(m => m.id === folderId);
    const name = folderMsg ? (folderMsg.content || '文件夹') : '文件夹';
    const children = messages.filter(m => !m.isDeleted && !m.isHidden && m.folderId === folderId);
    const msgs = children.filter(m => m.type !== 'FOLDER');
    const subFolders = children.filter(m => m.type === 'FOLDER').map(m => buildFolderTree(m.id));
    return { folderId, name, messages: msgs, children: subFolders };
  };

  // 递归收集指定文件夹的所有后代文件夹 id（含自身），用于防循环禁用
  const collectDescendantFolderIds = (rootId) => {
    const result = new Set([rootId]);
    const queue = [rootId];
    const visited = new Set();
    while (queue.length > 0) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      messages.filter(m => m.type === 'FOLDER' && !m.isDeleted && m.folderId === cur).forEach(child => {
        if (!result.has(child.id)) { result.add(child.id); queue.push(child.id); }
      });
    }
    return result;
  };

  const handleRemoveMessagesFromFolder = (msgOrMsgs) => {
    const msgsToRemove = Array.isArray(msgOrMsgs) ? msgOrMsgs : [msgOrMsgs];
    const targetIds = new Set(msgsToRemove.map(m => m.id));

    const updated = messages.map(m => {
      if (targetIds.has(m.id)) {
        const copy = { ...m, lastModified: Date.now() };
        delete copy.folderId;
        return copy;
      }
      return m;
    });
    setMessages(updated);
    setSelectedMessageIds(new Set());
    pushHistoryToCloud(updated);
  };

  const handleUnpackFolder = (folderMsg) => {
    if (!folderMsg || folderMsg.type !== 'FOLDER') return;

    // 递归收集所有后代文件夹 id
    const collectDescendants = (rootId) => {
      const result = new Set();
      const queue = [rootId];
      while (queue.length > 0) {
        const cur = queue.shift();
        const children = messages.filter(m => m.type === 'FOLDER' && !m.isDeleted && m.folderId === cur);
        children.forEach(c => { if (!result.has(c.id)) { result.add(c.id); queue.push(c.id); } });
      }
      return result;
    };

    const doUnpack = (recursive) => {
      setConfirmOpen(false);
      const folderId = folderMsg.id;
      const idsToDelete = recursive
        ? new Set([folderId, ...collectDescendants(folderId)])
        : new Set([folderId]);
      const updated = messages.map(m => {
        if (idsToDelete.has(m.folderId)) {
          const copy = { ...m, lastModified: Date.now() };
          delete copy.folderId;
          return copy;
        }
        if (idsToDelete.has(m.id)) {
          return { ...m, isDeleted: true, lastModified: Date.now() };
        }
        return m;
      });
      setMessages(updated);
      setSelectedMessageIds(new Set());
      pushHistoryToCloud(updated);
    };

    // 拆散方式选择：用自定义弹窗（两个按钮）
    setMoveIntoFolderOpen(false);
    setChooseParentFolderOpen(false);
    setConfirmConfig({
      title: '解散文件夹',
      message: `确定要解散文件夹 "${folderMsg.content || '文件夹'}" 吗？请选择拆散方式。`,
      customActions: [
        { label: '只拆散一级', onClick: () => doUnpack(false) },
        { label: '全部拆散', onClick: () => doUnpack(true) }
      ]
    });
    setConfirmOpen(true);
  };

  const handleRenameFolder = (folderMsg, newName) => {
    if (!folderMsg || folderMsg.type !== 'FOLDER') return;
    if (newName === undefined) {
      setInputModalConfig({
        isOpen: true,
        title: '修改文件夹名称',
        hint: '请输入新的文件夹名称或注释：',
        defaultValue: folderMsg.content || '',
        placeholder: '请输入文件夹名称...',
        confirmText: '保存',
        onConfirm: (val) => {
          setInputModalConfig(prev => ({ ...prev, isOpen: false }));
          handleRenameFolder(folderMsg, val);
        }
      });
      return;
    }
    const name = newName;
    if (!name || !name.trim()) return;

    const updated = messages.map(m => {
      if (m.id === folderMsg.id) {
        return { ...m, content: name.trim(), lastModified: Date.now() };
      }
      return m;
    });
    setMessages(updated);
    pushHistoryToCloud(updated);
  };

  const handleUngroupMessage = (msgOrMsgs) => {
    const msgsToUngroup = Array.isArray(msgOrMsgs) ? msgOrMsgs : [msgOrMsgs];
    const targetIds = new Set(msgsToUngroup.map(m => m.id));

    // Detach only the selected messages from their group
    const updated = messages.map(m => {
      if (targetIds.has(m.id)) {
        const copy = { ...m };
        delete copy.groupId;
        return copy;
      }
      return m;
    });

    // Clean up groups that have fewer than 2 remaining member messages
    const groupCounts = {};
    updated.forEach(m => {
      if (m.groupId) {
        groupCounts[m.groupId] = (groupCounts[m.groupId] || 0) + 1;
      }
    });

    const finalUpdated = updated.map(m => {
      if (m.groupId && groupCounts[m.groupId] < 2) {
        const copy = { ...m };
        delete copy.groupId;
        return copy;
      }
      return m;
    });

    setMessages(finalUpdated);
    setSelectedMessageIds(new Set());
    pushHistoryToCloud(finalUpdated);
  };

  // --- Message Edit & Caption Actions ---
  const handleEditTextMessage = (msgId, newText) => {
    if (!newText || !newText.trim()) return;
    const updated = messages.map(m => {
      if (m.id === msgId) {
        return { ...m, content: newText.trim(), isEdited: true };
      }
      return m;
    });
    setMessages(updated);
    pushHistoryToCloud(updated);
  };

  const handleUpdateCaption = (msgId, newCaption) => {
    const updated = messages.map(m => {
      if (m.id === msgId) {
        return { ...m, caption: newCaption ? newCaption.trim() : '' };
      }
      return m;
    });
    setMessages(updated);
    pushHistoryToCloud(updated);
  };

  // --- Privacy Mode Actions ---
  const handleEnterPrivacyMode = (inputPin) => {
    const storedPin = localStorage.getItem(`cloudchat_privacy_pin_${activeProfileId}`) || '1234';
    if (inputPin === storedPin) {
      setIsPrivacyMode(true);
      return true;
    }
    return false;
  };

  const handleExitPrivacyMode = () => {
    setIsPrivacyMode(false);
  };

  const handleChangePrivacyPin = (newPin) => {
    if (!newPin || !newPin.trim()) return;
    setPrivacyPin(newPin.trim());
    localStorage.setItem(`cloudchat_privacy_pin_${activeProfileId}`, newPin.trim());
  };

  const handleToggleHideMessage = (msgOrMsgs) => {
    const msgsToToggle = Array.isArray(msgOrMsgs) ? msgOrMsgs : [msgOrMsgs];
    const targetIds = new Set(msgsToToggle.map(m => m.id));

    const updated = messages.map(m => {
      if (targetIds.has(m.id)) {
        return { ...m, isHidden: !m.isHidden };
      }
      return m;
    });
    setMessages(updated);
    setSelectedMessageIds(new Set());
    pushHistoryToCloud(updated);
  };

  // --- Profile Settings Actions ---
  const handleSaveProfile = (profile) => {
    const oldProfile = currentProfile;
    // 修改服务器地址(webDavUrl/endpoint)、用户名(webDavUser)、密码(webDavPassword)不算改变存储路径，保留本地缓存
    // 仅当用户存储路径(saveDir)或服务器前缀(serverPath)更改时，才算更改配置（丢弃本地缓存并从云端重新拉取）
    const isLocationChanged = !oldProfile || 
      oldProfile.id !== profile.id ||
      oldProfile.type !== profile.type ||
      oldProfile.serverPath !== profile.serverPath ||
      oldProfile.saveDir !== profile.saveDir ||
      oldProfile.bucket !== profile.bucket;

    const exists = profiles.some(p => p.id === profile.id);
    let updated;
    if (exists) {
      updated = profiles.map(p => p.id === profile.id ? profile : p);
    } else {
      updated = [...profiles, profile];
    }
    setProfiles(updated);
    localStorage.setItem('cloudchat_web_profiles', JSON.stringify(updated));
    setActiveProfileId(profile.id);
    localStorage.setItem('cloudchat_web_active_profile_id', profile.id);

    // Update active storage client & refs immediately
    activeClientRef.current = StorageClient.create(profile);
    currentProfileRef.current = profile;

    if (isLocationChanged) {
      setMessages([]);
      cacheFile(`history_array_${profile.id}`, []);
      clearAllCache(); // 清空 IndexedDB 中所有文件缓存（附件、头像等）
      lastKnownCloudIndexTimeRef.current = 0;
      shardTimestampsRef.current = {};
      legacyHistoryMissingRef.current = false; // 重置 legacy 标志以便重新检测新路径

      // 路径更改：校验并补发头像文件到新服务器路径
      if (profile.avatar) {
        const client = activeClientRef.current;
        const avatarName = profile.avatar;
        const username = profile.username || 'User';
        (async () => {
          try {
            if (typeof client.ensureDirectoriesExist === 'function') {
              await client.ensureDirectoriesExist();
            }
            const avatarTime = await client.getLastModified(avatarName);
            if (avatarTime === 0) {
              let avatarBlob = await getCachedFile(`avatar_${avatarName}`);
              if (!avatarBlob) {
                avatarBlob = await generateInitialAvatarBlob(username);
              }
              if (avatarBlob) {
                await client.uploadFile(avatarBlob, avatarName, 'image/jpeg');
                cacheFile(`avatar_${avatarName}`, avatarBlob);
                console.log('[Profile] Avatar auto uploaded to new path:', avatarName);
              }
            }
          } catch (e) {
            console.warn('[Profile] Failed to check/re-upload avatar on path change:', e);
          }
        })();
      }
    }

    setSettingsOpen(false);
    setTimeout(() => {
      syncHistory(true);
    }, 50);
  };

  const handleDeleteProfile = (profileId) => {
    const updated = profiles.filter(p => p.id !== profileId);
    setProfiles(updated);
    localStorage.setItem('cloudchat_web_profiles', JSON.stringify(updated));
    
    const nextId = updated[0] ? updated[0].id : null;
    setActiveProfileId(nextId);
    cacheFile(`history_array_${profileId}`, null); // Clear from DB
    if (nextId) {
      localStorage.setItem('cloudchat_web_active_profile_id', nextId);
    } else {
      localStorage.removeItem('cloudchat_web_active_profile_id');
      setMessages([]);
      setStatusText('Setup server profile in settings');
      setStatusDotClass('bg-red-500');
    }
  };

  // --- Media Viewer Actions ---
  const handleMediaDownload = async () => {
    const current = mediaList[mediaIndex];
    if (!current) return;
    
    try {
      const client = activeClientRef.current;
      if (!client) return;
      const blob = await client.downloadFile(current.content);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = current.content.replace(/^\d+_/, '');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert('Download failed.');
    }
  };

  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Global Drag and Drop File Handler
  const handleSendMessageRef = useRef(handleSendMessage);
  handleSendMessageRef.current = handleSendMessage;
  const lastProcessedPathRef = useRef({});

  useEffect(() => {
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
        setIsDraggingOver(true);
      }
    };
    const handleDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        setIsDraggingOver(false);
      }
    };
    const handleDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
          handleSendMessageRef.current(null, file);
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    let unlistenTauri = null;
    let isCancelled = false;
    const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
    if (isTauri) {
      (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const { convertFileSrc } = await import('@tauri-apps/api/core');

          const processPath = async (filePath) => {
            if (!filePath) return;
            const now = Date.now();
            const lastTime = lastProcessedPathRef.current[filePath] || 0;
            // 防重复/防刷：1.5秒内同一文件路径仅处理一次
            if (now - lastTime < 1500) {
              return;
            }
            lastProcessedPathRef.current[filePath] = now;

            addDebugLog(`[Tauri DragDrop] 收到拖入文件路径: ${filePath}`);
            try {
              let file = null;
              // 1. 优先通过 Rust read_file_binary 读取
              try {
                const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
                if (invoke) {
                  const base64Str = await invoke('read_file_binary', { path: filePath });
                  const byteCharacters = atob(base64Str);
                  const byteNumbers = new Array(byteCharacters.length);
                  for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                  }
                  const byteArray = new Uint8Array(byteNumbers);
                  const fileName = filePath.split(/[/\\]/).pop() || 'file';
                  file = new File([byteArray], fileName, { type: 'application/octet-stream' });
                  addDebugLog(`[Tauri DragDrop] 框架 Rust 读取二进制成功: ${fileName} (${file.size} bytes)`);
                }
              } catch (eRust) {
                addDebugLog(`[Tauri DragDrop Warning] Rust read_file_binary 失败: ${eRust.message || eRust}，尝试 asset 协议...`);
              }

              // 2. 回退：使用 convertFileSrc + fetch
              if (!file) {
                const assetUrl = convertFileSrc(filePath);
                const resp = await window.fetch(assetUrl);
                const blob = await resp.blob();
                const fileName = filePath.split(/[/\\]/).pop() || 'file';
                file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
                addDebugLog(`[Tauri DragDrop] convertFileSrc 读取成功: ${fileName} (${file.size} bytes)`);
              }

              if (file) {
                handleSendMessageRef.current(null, file);
              }
            } catch (err) {
              addDebugLog(`[Tauri DragDrop ERR] 文件解析发送失败: ${err.stack || err.message || err}`);
              console.error('[Tauri DragDrop Error]:', err);
            }
          };

          const extractPathsFromEvent = (evt) => {
            if (!evt) return [];
            if (Array.isArray(evt)) return evt;
            if (Array.isArray(evt.payload)) return evt.payload;
            if (evt.payload && Array.isArray(evt.payload.paths)) return evt.payload.paths;
            if (Array.isArray(evt.paths)) return evt.paths;
            return [];
          };

          try {
            const currentWin = getCurrentWindow();
            if (currentWin && typeof currentWin.onDragDropEvent === 'function') {
              const cleanup = await currentWin.onDragDropEvent(async (event) => {
                const payload = event.payload || event;
                const type = payload.type || event.type;
                if (type === 'over' || type === 'enter' || type === 'hover') {
                  setIsDraggingOver(true);
                } else if (type === 'leave' || type === 'cancelled') {
                  setIsDraggingOver(false);
                } else if (type === 'drop') {
                  setIsDraggingOver(false);
                  const paths = extractPathsFromEvent(event);
                  addDebugLog(`[Tauri DragDrop] 监听到 drop 事件，路径列表: ${JSON.stringify(paths)}`);
                  for (const p of paths) {
                    await processPath(p);
                  }
                }
              });
              if (isCancelled) {
                cleanup();
              } else {
                unlistenTauri = cleanup;
              }
            }
          } catch (err) {
            addDebugLog(`[Tauri DragDrop Warning] onDragDropEvent 设置失败: ${err.message || err}`);
          }
        } catch (e) {
          console.warn('[Tauri DragDrop Setup Error]:', e);
        }
      })();
    }

    return () => {
      isCancelled = true;
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
      if (unlistenTauri) unlistenTauri();
    };
  }, []);

  const handleCloseMediaViewer = () => {
    setMediaViewerOpen(false);
    document.querySelectorAll('video').forEach(v => v.pause());
  };

  const handleSwitchProfile = (profileId) => {
    if (profileId === activeProfileId) {
      setActiveCategory('all');
      return;
    }
    setActiveProfileId(profileId);
    localStorage.setItem('cloudchat_web_active_profile_id', profileId);
    setActiveCategory('all');
  };

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-bgPrimary select-none relative">
        {/* Sidebar Component */}
        <Sidebar 
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        profiles={profiles}
        activeProfileId={activeProfileId}
        currentProfile={currentProfile}
        onSwitchProfile={handleSwitchProfile}
        activeCategory={activeCategory}
        onSwitchCategory={setActiveCategory}
        onOpenSettings={() => setSettingsOpen(true)}
        onSync={() => syncHistory(true)}
        isSyncing={isSyncing}
        messages={messages.filter(m => !m.isDeleted && String(m.isDeleted) !== 'true')}
        isPrivacyMode={isPrivacyMode}
        diaryCount={diaryFileCount}
        statusText={statusText}
        statusDotClass={statusDotClass}
        resolveAvatarUrl={resolveAvatarUrl}
        onOpenDebugLogs={() => setDebugModalOpen(true)}
        onOpenGuide={() => setGuideModalOpen(true)}
      />

      {/* Main Chat Area */}
      <ChatArea 
        currentProfile={currentProfile}
        isSameLan={isSameLan}
        messages={messages.filter(m => !m.isDeleted)}
        activeCategory={activeCategory}
        selectedMessageIds={selectedMessageIds}
        activeUploads={activeUploads}
        onToggleMessageSelection={handleToggleMessageSelection}
        onClearSelection={handleClearSelection}
        onDeleteSelected={handleDeleteSelected}
        onAddCategorySelected={() => { setCategoryTarget(null); setCategoryModalOpen(true); }}
        onRemoveCategorySelected={handleRemoveCategorySelected}
        onDeleteMessage={handleDeleteMessage}
        onEditMessageCategories={handleEditMessageCategories}
        onQuickAddCategory={handleQuickAddCategory}
        onGroupSelected={handleGroupSelected}
        onUngroupMessage={handleUngroupMessage}
        onPackFolder={handlePackFolder}
        onRemoveMessagesFromFolder={handleRemoveMessagesFromFolder}
        onUnpackFolder={handleUnpackFolder}
        onRenameFolder={handleRenameFolder}
        onMoveIntoFolder={handleMoveIntoFolder}
        onOpenDiaryExport={handleOpenDiaryExport}
        onDiaryChanged={refreshDiaryCount}
        isPrivacyMode={isPrivacyMode}
        onEnterPrivacyMode={handleEnterPrivacyMode}
        onExitPrivacyMode={handleExitPrivacyMode}
        onChangePrivacyPin={handleChangePrivacyPin}
        onToggleHideMessage={handleToggleHideMessage}
        onEditTextMessage={handleEditTextMessage}
        onUpdateCaption={handleUpdateCaption}
        onSendMessage={handleSendMessage}
        onRetryMessage={handleRetryMessage}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        storageClient={activeClientRef.current}
        resolveAvatarUrl={resolveAvatarUrl}
        isSyncing={isSyncing}
        onOpenDebugLogs={() => setDebugModalOpen(true)}
        onInsertGroupedMessage={handleInsertGroupedMessage}
        onRemoteShare={handleRemoteShare}
        onOpenForwardModal={handleOpenForwardModal}
      />

      {/* Forward to Other Profile Modal */}
      <ForwardToProfileModal
        isOpen={forwardModalOpen}
        profiles={profiles}
        activeProfileId={activeProfileId}
        messageCount={forwardTargetMsgs.length}
        onConfirm={handleForwardToProfile}
        onCancel={() => setForwardModalOpen(false)}
      />

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={settingsOpen}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onClose={() => setSettingsOpen(false)}
        onSaveProfile={handleSaveProfile}
        onDeleteProfile={handleDeleteProfile}
        onSwitchProfile={(pId) => { setActiveProfileId(pId); localStorage.setItem('cloudchat_web_active_profile_id', pId); }}
        storageClient={activeClientRef.current}
        resolveAvatarUrl={resolveAvatarUrl}
      />

      {/* Category Selection Modal */}
      <CategoryModal 
        isOpen={categoryModalOpen}
        messages={messages}
        onSave={handleSaveCategory}
        onCancel={() => { setCategoryModalOpen(false); setCategoryTarget(null); }}
      />

      {/* Confirmation Dialog Modal */}
      <ConfirmModal 
        isOpen={confirmOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onOk={confirmConfig.onOk}
        onCancel={() => setConfirmOpen(false)}
        confirmText={confirmConfig.confirmText || '确定'}
        cancelText={confirmConfig.cancelText !== undefined ? confirmConfig.cancelText : '取消'}
        isDanger={confirmConfig.isDanger !== undefined ? confirmConfig.isDanger : true}
        icon={confirmConfig.icon}
        customActions={confirmConfig.customActions}
      />

      {/* 移入文件夹选择器 */}
      <FolderPickerModal 
        isOpen={moveIntoFolderOpen}
        title="移入文件夹"
        hint="从主界面选择目标文件夹，选中消息将移入其中"
        allMessages={messages}
        currentFolderId={moveIntoFolderContextId}
        excludeIds={
          Array.from(selectedMessageIds).reduce((acc, id) => {
            const msg = messages.find(m => m.id === id);
            if (msg && msg.type === 'FOLDER') {
              collectDescendantFolderIds(id).forEach(d => acc.add(d));
            } else {
              acc.add(id);
            }
            return acc;
          }, new Set())
        }
        confirmText="移入"
        onConfirm={handleMoveIntoFolderConfirm}
        onCancel={() => setMoveIntoFolderOpen(false)}
      />

      {/* 打包时选择父文件夹 */}
      <FolderPickerModal 
        isOpen={chooseParentFolderOpen}
        title="选择父文件夹"
        hint="选中了多个文件夹，请选择其中一个作为父文件夹，其余所有条目将放入其中"
        allMessages={[]}
        directItems={chooseParentTargets}
        currentFolderId={null}
        excludeIds={new Set()}
        confirmText="确定"
        onConfirm={handleChooseParentFolderConfirm}
        onCancel={() => setChooseParentFolderOpen(false)}
      />

      {/* Gallery Media Viewer Modal */}
      <MediaViewer 
        isOpen={mediaViewerOpen}
        mediaList={mediaList}
        activeIndex={mediaIndex}
        onClose={handleCloseMediaViewer}
        onPrev={() => setMediaIndex(prev => Math.max(prev - 1, 0))}
        onNext={() => setMediaIndex(prev => Math.min(prev + 1, mediaList.length - 1))}
        onDownload={handleMediaDownload}
      />

      {/* Diary Export Modal */}
      <DiaryExportModal 
        isOpen={diaryExportOpen}
        onClose={() => setDiaryExportOpen(false)}
        folderMsg={diaryExportFolder}
        folderMessages={
          diaryExportSelectedMsgs ? diaryExportSelectedMsgs :
          (diaryExportFolder ? collectFolderMessagesRecursive(diaryExportFolder.id) : [])
        }
        folderTree={diaryExportFolder ? buildFolderTree(diaryExportFolder.id) : null}
        currentProfile={currentProfile}
        storageClient={activeClientRef.current}
        onGenerated={refreshDiaryCount}
      />

      {/* Drag-and-drop overlay */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-[100] bg-accentColor/20 border-2 border-dashed border-accentColor flex items-center justify-center pointer-events-none">
          <div className="bg-bgSecondary/90 backdrop-blur-md rounded-xl px-8 py-6 text-center shadow-2xl border border-accentColor/30">
            <i className="fa-solid fa-cloud-arrow-up text-accentColor text-4xl mb-3 block"></i>
            <p className="text-textPrimary font-semibold text-lg">拖放文件到此处发送</p>
            <p className="text-textMuted text-sm mt-1">支持图片、视频、音频、文档</p>
          </div>
        </div>
      )}

      {/* Input Modal for Rename/Create Folder */}
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

      {/* Debug Logs Modal */}
      <DebugLogsModal
        isOpen={debugModalOpen}
        onClose={() => setDebugModalOpen(false)}
        logs={debugLogs}
        onClear={() => setDebugLogs([])}
        onForceSync={() => syncHistory(true)}
      />

      {/* Guide & Icon Manual Modal */}
      <GuideModal
        isOpen={guideModalOpen}
        onClose={() => setGuideModalOpen(false)}
      />

    </div>
  );
}
