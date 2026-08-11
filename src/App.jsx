import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsModal from './components/SettingsModal';
import CategoryModal from './components/CategoryModal';
import ConfirmModal from './components/ConfirmModal';
import MediaViewer from './components/MediaViewer';
import DiaryExportModal from './components/DiaryExportModal';
import { StorageClient } from './services/storage';
import { initDB, cacheFile, getCachedFile } from './services/db';

// Global media URL lookup cache
const cachedMediaUrls = {};
// Global avatar URL lookup cache (filename -> blob URL)
const cachedAvatarUrls = {};
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

  const handleOpenDiaryExport = (folderMsgOrMsgs) => {
    if (!folderMsgOrMsgs) return;
    if (Array.isArray(folderMsgOrMsgs)) {
      setDiaryExportFolder(null);
      setDiaryExportSelectedMsgs(folderMsgOrMsgs);
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

  const activeClientRef = useRef(null);
  const syncTimerRef = useRef(null);
  const lastKnownCloudIndexTimeRef = useRef(0);
  const legacyHistoryMissingRef = useRef(false);
  const shardTimestampsRef = useRef({});
  const currentProfileRef = useRef(null);

  const currentProfile = profiles.find(p => p.id === activeProfileId) || null;
  currentProfileRef.current = currentProfile;

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
          setMessages(sanitized);
          resolveLocalMediaUrls(sanitized);
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
          setMessages(sanitized);
          resolveLocalMediaUrls(sanitized);
          // Migrate legacy cache to DB
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
      
      // Periodically sync
      const interval = Math.max(currentProfile.syncInterval || 5, 2) * 1000;
      syncTimerRef.current = setInterval(syncHistory, interval);
    }

    return () => {
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
      }
    };
  }, [activeProfileId]);

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
    if (!avatarFilename) return null;
    // Local Android URIs cannot be fetched over WebDAV
    if (avatarFilename.startsWith('content://') || avatarFilename.startsWith('file://')) {
      return null;
    }
    // If it's already a safe displayable URL (data: or https:), return as-is
    if (avatarFilename.startsWith('data:') || avatarFilename.startsWith('https://') || avatarFilename.startsWith('http://')) {
      return avatarFilename;
    }
    // Return cached blob URL if available in memory
    if (cachedAvatarUrls[avatarFilename]) return cachedAvatarUrls[avatarFilename];

    // Check IndexedDB persistent cache first (instant load on refresh before storage client connects)
    try {
      const cachedBlob = await getCachedFile(`avatar_${avatarFilename}`);
      if (cachedBlob) {
        const url = URL.createObjectURL(cachedBlob);
        cachedAvatarUrls[avatarFilename] = url;
        return url;
      }
    } catch (e) {
      console.warn('IndexedDB avatar lookup warning:', e);
    }

    // Download via storage client if available (handles auth headers internally)
    const client = activeClientRef.current;
    if (!client) return null;
    try {
      const blob = await client.downloadFile(avatarFilename);
      if (blob) {
        cacheFile(`avatar_${avatarFilename}`, blob); // Cache in IndexedDB for future refreshes
        const url = URL.createObjectURL(blob);
        cachedAvatarUrls[avatarFilename] = url;
        return url;
      }
    } catch (e) {
      console.warn('Failed to load avatar:', avatarFilename, e);
    }
    return null;
  };

  // 3. Resolve cached media files to Object URLs asynchronously
  const resolveLocalMediaUrls = async (msgs) => {
    let changed = false;
    const updated = await Promise.all(msgs.map(async (msg) => {
      if (msg.type === 'IMAGE' || msg.type === 'VIDEO' || msg.type === 'AUDIO') {
        if (!msg.url) {
          const url = await resolveMediaMessageUrl(msg);
          if (url) {
            msg.url = url;
            changed = true;
          }
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

      let safeType = msg.type;
      if (!safeType || safeType === 'TEXT') {
        const textContent = msg.content || '';
        if (textContent.startsWith('[位置] ')) {
          safeType = 'LOCATION';
        } else {
          const ext = textContent.substring(textContent.lastIndexOf('.')).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) safeType = 'IMAGE';
          else if (['.mp4', '.webm', '.mkv', '.mov'].includes(ext)) safeType = 'VIDEO';
          else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) safeType = 'AUDIO';
          else safeType = 'TEXT';
        }
      }

      let safeCategories = [];
      if (Array.isArray(msg.categories)) {
        safeCategories = msg.categories;
      } else if (msg.categories && typeof msg.categories === 'string') {
        safeCategories = [msg.categories];
      }

      return {
        ...msg,
        id: safeId,
        content: msg.content || '',
        timestamp: safeTimestamp,
        type: safeType,
        sender: msg.sender || 'Unknown',
        senderName: msg.senderName || msg.sender || 'Unknown',
        categories: safeCategories
      };
    }).filter(Boolean);

    return { sanitized, repairedCount };
  };

  const scrollToBottom = () => {
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

    try {
      const client = activeClientRef.current;
      
      if (typeof client.ensureDirectoriesExist === 'function') {
        await client.ensureDirectoriesExist();
      }

      const cloudIndexTime = await client.getLastModified('chat_index.json');
      let indexData = {};
      let needsMigration = false;

      if (cloudIndexTime === 0) {
        if (!legacyHistoryMissingRef.current) {
          const oldTime = await client.getLastModified('chat_history.json');
          if (oldTime > 0) {
            needsMigration = true;
          } else {
            legacyHistoryMissingRef.current = true;
          }
        }
        
        if (!needsMigration) {
          setStatusText('Connected (No history file)');
          setStatusDotClass('bg-green-500');
          setIsSyncing(false);
          return;
        }
      }

      if (force || cloudIndexTime > lastKnownCloudIndexTimeRef.current || needsMigration) {
        let downloadedMessages = [];
        let anyShardChanged = false;
        let repairedTotal = 0;

        if (needsMigration) {
            const blob = await client.downloadFile('chat_history.json');
            const text = await blob.text();
            const rawCloudMessages = JSON.parse(text);
            const { sanitized, repairedCount } = sanitizeMessages(rawCloudMessages);
            downloadedMessages = sanitized;
            repairedTotal = repairedCount;
            anyShardChanged = true;
        } else {
            const indexBlob = await client.downloadFile('chat_index.json');
            const indexText = await indexBlob.text();
            let parsedData = JSON.parse(indexText);
            const isArrayFormat = Array.isArray(parsedData);
            const shardList = isArrayFormat ? parsedData : Object.keys(parsedData);

            for (const shardName of shardList) {
                let timestamp = 0;
                if (!isArrayFormat && parsedData[shardName]) {
                    timestamp = parsedData[shardName];
                } else {
                    timestamp = await client.getLastModified(shardName);
                }

                if (timestamp > (shardTimestampsRef.current[shardName] || 0)) {
                    try {
                        const shardBlob = await client.downloadFile(shardName);
                        const shardText = await shardBlob.text();
                        const rawMsgs = JSON.parse(shardText);
                        const { sanitized, repairedCount } = sanitizeMessages(rawMsgs);
                        downloadedMessages = [...downloadedMessages, ...sanitized];
                        shardTimestampsRef.current[shardName] = timestamp;
                        anyShardChanged = true;
                        repairedTotal += repairedCount;
                    } catch (e) {
                        console.error("Failed to fetch shard", shardName, e);
                    }
                }
            }
        }

        if (anyShardChanged) {
          lastKnownCloudIndexTimeRef.current = cloudIndexTime;

          setMessages(prev => {
            let mergedMap = new Map();
            prev.forEach(m => mergedMap.set(m.id, m));

            downloadedMessages.forEach(m => {
                const existing = mergedMap.get(m.id);
                if (existing) {
                    if ((m.lastModified || 0) >= (existing.lastModified || 0)) {
                        mergedMap.set(m.id, m);
                    }
                } else {
                    mergedMap.set(m.id, m);
                }
            });

            const merged = Array.from(mergedMap.values());
            merged.sort((a, b) => a.timestamp - b.timestamp);

            cacheFile(`history_array_${currentProfileRef.current.id}`, merged);
            resolveLocalMediaUrls(merged);
            
            if (needsMigration || repairedTotal > 0) {
              pushHistoryToCloud(merged);
            }

            return merged;
          });

          setStatusText('Synchronized');
          setStatusDotClass('bg-green-500');
          setTimeout(() => scrollToBottom(), 150);
        } else {
          setStatusText('Synchronized');
          setStatusDotClass('bg-green-500');
        }
      } else {
        setStatusText('Synchronized');
        setStatusDotClass('bg-green-500');
      }
    } catch (e) {
      console.error('Cloud sync error:', e);
      setStatusText(`Sync failed: ${e.message || e}`);
      setStatusDotClass('bg-red-500');
    } finally {
      setIsSyncing(false);
    }
  };

  const pushHistoryToCloud = async (overrideMsgs) => {
    if (!currentProfile || !activeClientRef.current) return;
    const client = activeClientRef.current;

    const targetList = overrideMsgs || messages;
    cacheFile(`history_array_${currentProfile.id}`, targetList);

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
          
          let updatedList = [];
          setMessages(prev => {
            updatedList = prev.map(m => m.id === newMsg.id ? { ...m, status: 'SUCCESS' } : m);
            return updatedList;
          });
          
          setTimeout(() => {
            if (updatedList.length > 0) pushHistoryToCloud(updatedList);
          }, 0);
          
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
      const newMsg = {
        id: 'msg_' + Date.now() + Math.random().toString(36).substr(2, 5),
        sender: currentProfile.username,
        senderName: currentProfile.username,
        senderAvatar: currentProfile.avatar || '',
        content: text,
        timestamp: Date.now(),
        type: (text.startsWith('[位置] ')) ? 'LOCATION' : 'TEXT',
        isOutgoing: true,
        status: 'SUCCESS',
        folderId: folderId || undefined,
        categories: activeCategory !== 'all' ? [activeCategory] : [],
        lastModified: Date.now()
      };

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
    if (selectedMessageIds.size < 2) return;

    const selectedMsgs = messages
      .filter(m => selectedMessageIds.has(m.id) && !m.isDeleted)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (selectedMsgs.length < 2) return;

    const mediaMsgs = selectedMsgs.filter(m => m.type === 'IMAGE' || m.type === 'VIDEO');
    const nonMediaMsgs = selectedMsgs.filter(m => m.type !== 'IMAGE' && m.type !== 'VIDEO');

    let updated = [...messages];
    const now = Date.now();

    // 1. Group IMAGE / VIDEO into grid bubble
    if (mediaMsgs.length >= 2) {
      const existingGroupIds = new Set(
        mediaMsgs.filter(m => m.groupId).map(m => m.groupId)
      );
      const allMediaTargetIds = new Set();
      updated.forEach(m => {
        if ((m.type === 'IMAGE' || m.type === 'VIDEO') && (selectedMessageIds.has(m.id) || (m.groupId && existingGroupIds.has(m.groupId)))) {
          allMediaTargetIds.add(m.id);
        }
      });
      const newGroupId = 'group_' + now;
      updated = updated.map(m => {
        if (allMediaTargetIds.has(m.id)) {
          return { ...m, groupId: newGroupId, lastModified: now };
        }
        return m;
      });
    }

    // 2. Combine all non-media messages into one text message (preserving first sender profile)
    if (nonMediaMsgs.length >= 2) {
      const firstMsg = nonMediaMsgs[0];
      const lines = nonMediaMsgs.map(msg => {
        if (msg.type === 'TEXT') return msg.content;
        if (msg.type === 'AUDIO') return `[语音] ${msg.videoDuration || msg.duration || ''}" ${msg.caption || ''}`.trim();
        if (msg.type === 'FILE') return `[文件] ${msg.content || ''} ${msg.caption || ''}`.trim();
        if (msg.type === 'LOCATION') return `${msg.content || ''} ${msg.locationAddress || ''}`.trim();
        if (msg.type === 'FOLDER') return `[文件夹] ${msg.content || ''}`;
        return msg.content || '';
      });
      const mergedText = lines.join('\n');
      const nonMediaIds = new Set(nonMediaMsgs.map(m => m.id));

      const combinedMsg = {
        id: 'msg_' + now + Math.random().toString(36).substring(2, 6),
        sender: firstMsg.sender,
        senderName: firstMsg.senderName || firstMsg.sender,
        senderAvatar: firstMsg.senderAvatar || '',
        content: mergedText,
        timestamp: firstMsg.timestamp || now,
        type: 'TEXT',
        isOutgoing: firstMsg.isOutgoing,
        status: 'SUCCESS',
        folderId: firstMsg.folderId || undefined,
        categories: firstMsg.categories || [],
        lastModified: now
      };

      updated = updated.map(m => {
        if (nonMediaIds.has(m.id)) {
          return { ...m, isDeleted: true, lastModified: now };
        }
        return m;
      });

      updated.push(combinedMsg);
      updated.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }

    setMessages(updated);
    setSelectedMessageIds(new Set());
    pushHistoryToCloud(updated);
  };

  // --- Folder Action Handlers ---
  const handlePackFolder = (folderName = '') => {
    if (selectedMessageIds.size === 0) return;

    const selectedMsgs = messages.filter(m => selectedMessageIds.has(m.id));
    const targetFolder = selectedMsgs.find(m => m.type === 'FOLDER');

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
      // Create new folder and pack selected items into it
      const name = folderName || prompt('请输入文件夹名称/注释：');
      if (name === null) return;

      const newFolderId = 'folder_' + Date.now();
      const newFolderMsg = {
        id: newFolderId,
        sender: currentProfile.username,
        senderName: currentProfile.username,
        content: (name && name.trim()) ? name.trim() : '文件夹',
        timestamp: Date.now(),
        type: 'FOLDER',
        isOutgoing: true,
        status: 'SUCCESS',
        categories: activeCategory !== 'all' ? [activeCategory] : [],
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
    setConfirmConfig({
      title: '解散文件夹',
      message: `确定要解散文件夹 "${folderMsg.content || '文件夹'}" 吗？文件夹内的消息将重新放回到聊天列表中。`,
      onOk: () => {
        setConfirmOpen(false);
        const folderId = folderMsg.id;
        const updated = messages.map(m => {
          if (m.folderId === folderId) {
            const copy = { ...m, lastModified: Date.now() };
            delete copy.folderId;
            return copy;
          }
          if (m.id === folderId) {
            return { ...m, isDeleted: true, lastModified: Date.now() };
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

  const handleRenameFolder = (folderMsg, newName) => {
    if (!folderMsg || folderMsg.type !== 'FOLDER') return;
    const name = newName !== undefined ? newName : prompt('修改文件夹名称/注释：', folderMsg.content || '');
    if (name === null || !name.trim()) return;

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

    setSettingsOpen(false);
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

  const handleCloseMediaViewer = () => {
    setMediaViewerOpen(false);
    document.querySelectorAll('video').forEach(v => v.pause());
  };

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-bgPrimary select-none">
      
      {/* Sidebar Component */}
      <Sidebar 
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        profiles={profiles}
        activeProfileId={activeProfileId}
        currentProfile={currentProfile}
        activeCategory={activeCategory}
        onSwitchCategory={setActiveCategory}
        onOpenSettings={() => setSettingsOpen(true)}
        onSync={() => syncHistory(true)}
        isSyncing={isSyncing}
        messages={messages.filter(m => !m.isDeleted)}
        statusText={statusText}
        statusDotClass={statusDotClass}
        resolveAvatarUrl={resolveAvatarUrl}
      />

      {/* Main Chat Area */}
      <ChatArea 
        currentProfile={currentProfile}
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
        onOpenDiaryExport={handleOpenDiaryExport}
        isPrivacyMode={isPrivacyMode}
        onEnterPrivacyMode={handleEnterPrivacyMode}
        onExitPrivacyMode={handleExitPrivacyMode}
        onChangePrivacyPin={handleChangePrivacyPin}
        onToggleHideMessage={handleToggleHideMessage}
        onEditTextMessage={handleEditTextMessage}
        onUpdateCaption={handleUpdateCaption}
        onSendMessage={handleSendMessage}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        storageClient={activeClientRef.current}
        resolveAvatarUrl={resolveAvatarUrl}
        isSyncing={isSyncing}
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
          (diaryExportFolder ? messages.filter(m => !m.isDeleted && m.folderId === diaryExportFolder.id) : [])
        }
        currentProfile={currentProfile}
        storageClient={activeClientRef.current}
      />

    </div>
  );
}
