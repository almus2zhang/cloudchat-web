import { getCachedFile, cacheFile } from '../services/db';

async function blobToDataUrl(blob) {
  if (!blob) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

// Compress image Blob for high-performance Web export (max 1200px side, JPEG 82% quality)
async function compressImageBlob(blob, maxSide = 1200, quality = 0.82) {
  if (!blob || !blob.type || !blob.type.startsWith('image/')) return blob;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      let w = width;
      let h = height;
      if (w > maxSide || h > maxSide) {
        if (w > h) {
          h = Math.round((h * maxSide) / w);
          w = maxSide;
        } else {
          w = Math.round((w * maxSide) / h);
          h = maxSide;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (resBlob) => resolve(resBlob || blob),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    img.src = url;
  });
}

// Helper to copy or upload compressed asset file into target diary directory assets folder on server
async function syncAssetToDiaryFolder(sourceFileName, assetName, targetAssetsDir, storageClient, isImage = true) {
  if (!sourceFileName || !storageClient) return null;
  if (sourceFileName.startsWith('content://') || sourceFileName.startsWith('file://')) {
    return null;
  }
  const destSubPath = `${targetAssetsDir}/${assetName}`;
  const relativeHtmlUrl = `assets/${assetName}`;

  // For non-image binaries (videos/audio/files), try fast server-side COPY first
  if (!isImage && typeof storageClient.copyFile === 'function') {
    try {
      const ok = await storageClient.copyFile(sourceFileName, destSubPath);
      if (ok) return relativeHtmlUrl;
    } catch (e) {
      console.warn('Server copy failed, fallback to download/upload:', e);
    }
  }

  // For images, retrieve blob (from IndexedDB cache or download), compress via Canvas (max 1200px, 80% quality), and upload!
  let blob = await getCachedFile(sourceFileName);
  if (!blob && typeof storageClient.downloadFile === 'function') {
    try {
      blob = await storageClient.downloadFile(sourceFileName);
      if (blob) cacheFile(sourceFileName, blob);
    } catch (e) {}
  }

  if (blob && typeof storageClient.uploadFile === 'function') {
    try {
      const compressed = isImage ? await compressImageBlob(blob, 1200, 0.8) : blob;
      const contentType = compressed.type || (assetName.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
      await storageClient.uploadFile(compressed, destSubPath, contentType);
      return relativeHtmlUrl;
    } catch (e) {
      console.warn('Upload compressed asset error:', e);
    }
  }

  // Backup fallback for any failed upload: try server-side copyFile
  if (typeof storageClient.copyFile === 'function') {
    try {
      const ok = await storageClient.copyFile(sourceFileName, destSubPath);
      if (ok) return relativeHtmlUrl;
    } catch (e) {}
  }

  return null;
}

// Helper to get Base64 Data URL for Single-File Export Mode
async function getBase64MediaUrl(msg, storageClient) {
  if (!msg) return '';
  if (msg.url && msg.url.startsWith('data:')) return msg.url;

  let blob = await getCachedFile(msg.id) || await getCachedFile(msg.content);
  if (!blob && msg.url && msg.url.startsWith('blob:')) {
    try {
      const res = await fetch(msg.url);
      blob = await res.blob();
    } catch (e) {}
  }
  if (!blob && storageClient && msg.content) {
    try {
      blob = await storageClient.downloadFile(msg.content);
    } catch (e) {}
  }
  if (blob) {
    const compressed = await compressImageBlob(blob, 1000, 0.78);
    const dataUrl = await blobToDataUrl(compressed);
    if (dataUrl) return dataUrl;
  }
  return msg.remoteUrl || msg.url || '';
}

async function getBase64AvatarUrl(avatar, authorName, storageClient) {
  const fallback = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(authorName || 'User')}`;
  if (!avatar || !avatar.trim()) return fallback;
  if (avatar.startsWith('data:') || avatar.startsWith('https://') || avatar.startsWith('http://')) {
    return avatar;
  }
  let blob = await getCachedFile(`avatar_${avatar}`);
  if (!blob && storageClient) {
    try {
      blob = await storageClient.downloadFile(avatar);
    } catch (e) {}
  }
  if (blob) {
    const compressed = await compressImageBlob(blob, 200, 0.85);
    const dataUrl = await blobToDataUrl(compressed);
    if (dataUrl) return dataUrl;
  }
  return fallback;
}

const generateServiceWorkerJs = () => `
const CACHE_NAME = 'cloudchat-diary-cache-v1';

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (url.includes('/assets/') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.png') || url.endsWith('.webp')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;
        try {
          const response = await fetch(event.request);
          if (response && response.ok) cache.put(event.request, response.clone());
          return response;
        } catch (err) {
          return cachedResponse || Response.error();
        }
      })
    );
  }
});
`;

export async function generateDiaryHtml({ folderName, author, avatar, templateId = 'wechat', password = '', messages = [], storageClient, targetDirClean = 'diary/export', exportMode = 'relative', onProgress }) {
  const isWeChat = templateId === 'wechat';
  const sortedMsgs = [...messages].sort((a, b) => isWeChat ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);

  const titleStr = folderName || '我的日记';
  const authorStr = author || 'CloudChat User';
  const targetAssetsDir = `${targetDirClean}/assets`;

  const isSingleFile = exportMode === 'single';

  // 1. If relative mode, upload Service Worker for permanent local disk caching
  if (!isSingleFile && storageClient && typeof storageClient.uploadFile === 'function') {
    try {
      if (typeof storageClient.ensureFolderPathExist === 'function') {
        await storageClient.ensureFolderPathExist(targetAssetsDir);
      }
      const swBlob = new Blob([generateServiceWorkerJs()], { type: 'application/javascript; charset=utf-8' });
      await storageClient.uploadFile(swBlob, `${targetDirClean}/sw.js`, 'application/javascript; charset=utf-8');
    } catch (e) {}
  }

  // 2. Resolve & copy Author Avatar
  let authorAvatarStr = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(authorStr)}`;
  if (isSingleFile) {
    authorAvatarStr = await getBase64AvatarUrl(avatar, authorStr, storageClient);
  } else if (avatar && avatar.trim()) {
    if (avatar.startsWith('data:') || avatar.startsWith('https://') || avatar.startsWith('http://')) {
      authorAvatarStr = avatar;
    } else {
      const syncedAvatarUrl = await syncAssetToDiaryFolder(avatar, 'avatar.jpg', targetAssetsDir, storageClient);
      if (syncedAvatarUrl) authorAvatarStr = syncedAvatarUrl;
    }
  }

  // 3. Compute password SHA-256 hash if password provided
  let passwordHash = '';
  if (password && password.trim()) {
    passwordHash = await computeSha256Hex(password.trim());
  }

  // 4. Parallel Sync / Resolve all message media with progress updates
  const mediaMsgs = sortedMsgs.filter(m => m.type === 'IMAGE' || m.type === 'VIDEO' || m.type === 'AUDIO');
  const totalMedia = mediaMsgs.length;
  let processedCount = 0;

  if (onProgress) {
    onProgress(50, `正在准备解析 ${sortedMsgs.length} 条记录 (${totalMedia} 个大媒体资源)...`);
  }

  const mediaUrlMap = {};

  const processMediaItem = async (msg) => {
    if (isSingleFile) {
      mediaUrlMap[msg.id] = await getBase64MediaUrl(msg, storageClient);
    } else {
      const sourceName = msg.content || `${msg.id}.jpg`;
      const cleanFileName = sourceName.split('/').pop().replace(/[\\/:*?"<>|]/g, '_');
      const isImg = msg.type === 'IMAGE';
      const relativeUrl = await syncAssetToDiaryFolder(sourceName, cleanFileName, targetAssetsDir, storageClient, isImg);
      if (relativeUrl) {
        mediaUrlMap[msg.id] = relativeUrl;
      } else if (msg.url && msg.url.startsWith('data:')) {
        mediaUrlMap[msg.id] = msg.url;
      } else if (storageClient && msg.content) {
        mediaUrlMap[msg.id] = storageClient.getUrl(msg.content);
      } else {
        mediaUrlMap[msg.id] = msg.remoteUrl || msg.content || '';
      }
    }

    processedCount++;
    if (onProgress && totalMedia > 0) {
      const pct = 50 + Math.round((processedCount / totalMedia) * 35);
      onProgress(pct, `⚡ 正在压缩同步媒体资源 [ ${processedCount} / ${totalMedia} ]...`);
    }
  };

  // Run 3 tasks in parallel at a time for fast non-blocking export
  const CONCURRENCY = 3;
  for (let i = 0; i < mediaMsgs.length; i += CONCURRENCY) {
    const batch = mediaMsgs.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(msg => processMediaItem(msg)));
  }

  // 4b. Pre-resolve all unique senderAvatar values in messages
  const avatarUrlMap = {};
  const uniqueAvatars = new Set(sortedMsgs.map(m => m.senderAvatar).filter(Boolean));
  await Promise.all([...uniqueAvatars].map(async (av) => {
    if (av.startsWith('data:') || av.startsWith('https://') || av.startsWith('http://')) {
      avatarUrlMap[av] = av;
    } else if (isSingleFile) {
      const senderName = sortedMsgs.find(m => m.senderAvatar === av)?.senderName || authorStr;
      const resolved = await getBase64AvatarUrl(av, senderName, storageClient);
      if (resolved) avatarUrlMap[av] = resolved;
    } else {
      // In relative/folder mode: sync avatar file to assets dir with unique filename
      const cleanAvatarName = av.split('/').pop().replace(/[\\/:*?"<>|]/g, '_');
      const synced = await syncAssetToDiaryFolder(av, cleanAvatarName, targetAssetsDir, storageClient);
      if (synced) avatarUrlMap[av] = synced;
    }
  }));

  // Helper to get per-message avatar URL, falling back to authorAvatarStr
  const resolveItemAvatar = (item) => {
    if (item.senderAvatar && avatarUrlMap[item.senderAvatar]) return avatarUrlMap[item.senderAvatar];
    return authorAvatarStr;
  };

  // Helper to resolve media URL for template renderers
  const resolveMediaUrl = (msg) => {
    if (!msg) return '';
    if (mediaUrlMap[msg.id]) {
      return mediaUrlMap[msg.id];
    }
    if (msg.url && msg.url.startsWith('data:')) {
      return msg.url;
    }
    if (storageClient && msg.content) {
      return storageClient.getUrl(msg.content);
    }
    return msg.remoteUrl || msg.content || '';
  };

  // Format date helper
  const formatDate = (ts) => {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return { full: `${y}-${m}-${day} ${h}:${min}`, date: `${y}-${m}-${day}`, time: `${h}:${min}`, year: y, monthDay: `${m}月${day}日` };
  };

  // Group contiguous messages sharing the same groupId
  const groupMessagesForDiary = (msgs) => {
    const result = [];
    const groupMap = {};

    msgs.forEach(msg => {
      if (msg.groupId && msg.type !== 'TEXT' && msg.type !== 'FOLDER') {
        if (!groupMap[msg.groupId]) {
          groupMap[msg.groupId] = {
            id: msg.groupId,
            sender: msg.sender,
            senderName: msg.senderName,
            timestamp: msg.timestamp,
            isGroup: true,
            groupId: msg.groupId,
            messages: []
          };
          result.push(groupMap[msg.groupId]);
        }
        groupMap[msg.groupId].messages.push(msg);
      } else {
        result.push({ ...msg, isGroup: false });
      }
    });

    return result;
  };

  const groupedItems = groupMessagesForDiary(sortedMsgs);

  // Render WeChat Moments Feed Item
  const renderWeChatMoments = () => {
    return groupedItems.map((item) => {
      const dateInfo = formatDate(item.timestamp);
      let contentBlock = '';

      if (item.isGroup) {
        // Grouped Grid (2-9 items)
        const subMsgs = item.messages;
        const count = subMsgs.length;
        const gridClass = `grid-count-${Math.min(count, 9)}`;

        const imgsHtml = subMsgs.map(subMsg => {
          const mUrl = resolveMediaUrl(subMsg);
          if (subMsg.type === 'VIDEO') {
            return `<video src="${mUrl}" controls class="wechat-grid-img"></video>`;
          }
          return `<img src="${mUrl}" class="wechat-grid-img" alt="${escapeHtml(subMsg.caption || '')}" loading="lazy" onclick="openLightbox(this.src)"/>`;
        }).join('');

        // Extract captions & EXIF location notes from all grouped items
        const captions = subMsgs
          .map(sub => sub.caption || (sub.locationAddress ? sub.locationAddress : ''))
          .filter(Boolean);

        contentBlock = `
          <div class="wechat-grid-container ${gridClass}">
            ${imgsHtml}
          </div>
          ${captions.length > 0 ? `
            <div class="wechat-caption-sub">
              ${captions.map(c => `<div class="caption-item">${escapeHtml(c)}</div>`).join('')}
            </div>
          ` : ''}
        `;
      } else {
        // Single Item
        const msg = item;
        const isText = msg.type === 'TEXT';
        const isImage = msg.type === 'IMAGE';
        const isVideo = msg.type === 'VIDEO';
        const isAudio = msg.type === 'AUDIO';
        const isLocation = msg.type === 'LOCATION' || (msg.content && msg.content.startsWith('[位置]'));
        const isFile = msg.type === 'FILE';
        const mediaUrl = resolveMediaUrl(msg);

        if (isLocation) {
          const addr = msg.locationAddress || msg.content.replace(/^\[位置\]\s*/, '');
          contentBlock = `
            <div class="wechat-location-badge">
              <svg class="icon" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
              <span>${escapeHtml(addr)}</span>
            </div>`;
        } else if (isText) {
          contentBlock = `<div class="wechat-text-content">${escapeHtml(msg.content)}</div>`;
        } else if (isImage) {
          contentBlock = `
            <div class="wechat-media-box">
              <img src="${mediaUrl}" class="wechat-single-img" alt="${escapeHtml(msg.caption || '')}" loading="lazy" onclick="openLightbox(this.src)"/>
              ${msg.caption ? `<div class="wechat-caption-sub"><div class="caption-item">${escapeHtml(msg.caption)}</div></div>` : ''}
            </div>`;
        } else if (isVideo) {
          contentBlock = `
            <div class="wechat-media-box">
              <video src="${mediaUrl}" controls class="wechat-video-player"></video>
              ${msg.caption ? `<div class="wechat-caption-sub"><div class="caption-item">${escapeHtml(msg.caption)}</div></div>` : ''}
            </div>`;
        } else if (isAudio) {
          contentBlock = `
            <div class="wechat-audio-box">
              <audio src="${mediaUrl}" controls class="wechat-audio-player"></audio>
            </div>`;
        } else if (isFile) {
          contentBlock = `
            <div class="wechat-file-box">
              <svg class="file-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
              <div class="file-info">
                <a href="${mediaUrl}" target="_blank" download="${escapeHtml(msg.content)}" class="file-name">${escapeHtml(msg.content)}</a>
                <span class="file-size">${formatBytes(msg.fileSize || 0)}</span>
              </div>
            </div>`;
        }
      }

      const itemAvatarSrc = resolveItemAvatar(item);
      return `
        <div class="wechat-item">
          <img src="${itemAvatarSrc}" class="wechat-avatar" alt="Avatar"/>
          <div class="wechat-body">
            <div class="wechat-nickname">${escapeHtml(item.senderName || item.sender || authorStr)}</div>
            ${contentBlock}
            <div class="wechat-footer">
              <span class="wechat-time">${dateInfo.full}</span>
              <div class="wechat-actions">
                <button class="like-btn" onclick="toggleLike(this)">❤️ 赞</button>
              </div>
            </div>
            <div class="wechat-like-box" style="display:none;">
              <span>❤️ ${escapeHtml(authorStr)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('\n');
  };

  const renderStandardTimeline = () => {
    return groupedItems.map(item => {
      const dateInfo = formatDate(item.timestamp);
      
      if (item.isGroup) {
        const subMsgs = item.messages;
        const imgsHtml = subMsgs.map(subMsg => {
          const mUrl = resolveMediaUrl(subMsg);
          return `<img src="${mUrl}" class="card-grid-img" alt="${escapeHtml(subMsg.caption || '')}" loading="lazy" onclick="openLightbox(this.src)"/>`;
        }).join('');

        const captions = subMsgs
          .map(sub => sub.caption || (sub.locationAddress ? sub.locationAddress : ''))
          .filter(Boolean);

        return `
          <div class="timeline-node">
            <div class="timeline-dot"></div>
            <div class="timeline-content-card">
              <div class="card-header">
                <span class="card-date">${dateInfo.full}</span>
                <span class="location-badge">📷 图片组 (${subMsgs.length}张)</span>
              </div>
              <div class="card-grid-wrap grid-count-${Math.min(subMsgs.length, 9)}">
                ${imgsHtml}
              </div>
              ${captions.length > 0 ? `
                <div class="card-captions">
                  ${captions.map(c => `<div class="caption-item">${escapeHtml(c)}</div>`).join('')}
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }

      const msg = item;
      const mediaUrl = resolveMediaUrl(msg);
      const isText = msg.type === 'TEXT';
      const isImage = msg.type === 'IMAGE';
      const isVideo = msg.type === 'VIDEO';
      const isAudio = msg.type === 'AUDIO';
      const isLocation = msg.type === 'LOCATION' || (msg.content && msg.content.startsWith('[位置]'));

      let cardMedia = '';
      if (isImage) {
        cardMedia = `<div class="card-image-wrap"><img src="${mediaUrl}" class="card-img" alt="${escapeHtml(msg.caption || '')}" loading="lazy" onclick="openLightbox(this.src)"/></div>`;
      } else if (isVideo) {
        cardMedia = `<div class="card-video-wrap"><video src="${mediaUrl}" controls class="card-video"></video></div>`;
      } else if (isAudio) {
        cardMedia = `<div class="card-audio-wrap"><audio src="${mediaUrl}" controls></audio></div>`;
      }

      let textStr = isLocation ? msg.locationAddress || msg.content : (isText ? msg.content : msg.caption || '');

      return `
        <div class="timeline-node">
          <div class="timeline-dot"></div>
          <div class="timeline-content-card">
            <div class="card-header">
              <span class="card-date">${dateInfo.full}</span>
              ${isLocation ? `<span class="location-badge">📍 ${escapeHtml(textStr)}</span>` : ''}
            </div>
            ${cardMedia}
            ${!isLocation && textStr ? `<div class="card-text">${escapeHtml(textStr)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('\n');
  };

  const cssStyles = getTemplateCss(templateId);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(titleStr)} - 个人日记专栏</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <script>
    if ('serviceWorker' in navigator && !location.protocol.startsWith('file')) {
      window.addEventListener('load', function() {
        navigator.serviceWorker.register('./sw.js').catch(function(){});
      });
    }
  </script>
  <style>
    ${cssStyles}
  </style>
</head>
<body class="theme-${templateId} ${passwordHash ? 'is-locked' : ''}">
  ${passwordHash ? `
    <!-- Password Lock Overlay Screen -->
    <div id="lockScreenOverlay" class="lock-screen-overlay">
      <div class="lock-card">
        <div class="lock-icon">🔒</div>
        <h2>私密日记本</h2>
        <p class="lock-sub">此归档页面已启用访问加密保护，请输入密码解密查看</p>
        <div class="lock-form">
          <input type="password" id="diaryPassInput" class="lock-input" placeholder="输入访问密码..." onkeydown="if(event.key==='Enter') verifyPassword()"/>
          <button onclick="verifyPassword()" class="lock-btn-submit">🔓 解锁查看</button>
        </div>
        <div class="lock-remember-row">
          <input type="checkbox" id="rememberPassCheck" checked />
          <label for="rememberPassCheck">记住密码 (免重复输入)</label>
        </div>
        <div id="lockErrorMsg" class="lock-error-msg"></div>
      </div>
    </div>
  ` : ''}

  ${templateId === 'wechat' ? `
    <!-- WeChat Moments Layout -->
    <div class="wechat-container">
      <div class="wechat-header-cover">
        <div class="cover-bg"></div>
        <div class="user-profile">
          <span class="user-name">${escapeHtml(authorStr)}</span>
          <img src="${authorAvatarStr}" class="header-avatar" alt="Avatar"/>
        </div>
      </div>
      <div class="diary-title-banner">
        <h2>📂 ${escapeHtml(titleStr)}</h2>
        <p>共收录 ${sortedMsgs.length} 条记录 (${groupedItems.length} 组动态)</p>
      </div>
      <div class="wechat-feed">
        ${renderWeChatMoments()}
      </div>
    </div>
  ` : `
    <!-- Standard Layout -->
    <div class="diary-container">
      <header class="main-header">
        <div class="header-inner">
          <h1>📖 ${escapeHtml(titleStr)}</h1>
          <p class="subtitle">记录人：${escapeHtml(authorStr)} · 归档于 ${new Date().toLocaleDateString()} · 共 ${groupedItems.length} 条动态</p>
        </div>
      </header>
      <main class="timeline-container">
        ${renderStandardTimeline()}
      </main>
    </div>
  `}

  <!-- Lightbox Modal for Images -->
  <div id="lightboxModal" class="lightbox-modal" onclick="closeLightbox()">
    <span class="lightbox-close">&times;</span>
    <img class="lightbox-content" id="lightboxImg">
  </div>

  <script>
    const EXPECTED_HASH = "${passwordHash}";
    const STORAGE_KEY = "diary_pass_${encodeURIComponent(titleStr)}";

    async function sha256(str) {
      const buffer = new TextEncoder().encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function verifyPassword() {
      const input = document.getElementById('diaryPassInput').value;
      const errorDiv = document.getElementById('lockErrorMsg');
      if (!input) {
        errorDiv.innerText = "请输入访问密码";
        return;
      }
      const hash = await sha256(input.trim());
      if (hash === EXPECTED_HASH) {
        if (document.getElementById('rememberPassCheck').checked) {
          localStorage.setItem(STORAGE_KEY, input.trim());
        }
        unlockPage();
      } else {
        errorDiv.innerText = "❌ 密码错误，无法解密查看日记";
        const card = document.querySelector('.lock-card');
        if (card) {
          card.classList.add('shake');
          setTimeout(() => card.classList.remove('shake'), 500);
        }
      }
    }

    function unlockPage() {
      const overlay = document.getElementById('lockScreenOverlay');
      if (!overlay) return;
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.4s ease';
      setTimeout(() => {
        overlay.style.display = 'none';
        document.body.classList.remove('is-locked');
      }, 400);
    }

    window.addEventListener('DOMContentLoaded', async () => {
      if (EXPECTED_HASH) {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const hash = await sha256(saved);
          if (hash === EXPECTED_HASH) {
            unlockPage();
          }
        }
      }
    });

    function openLightbox(src) {
      const modal = document.getElementById('lightboxModal');
      const img = document.getElementById('lightboxImg');
      modal.style.display = "flex";
      img.src = src;
    }
    function closeLightbox() {
      document.getElementById('lightboxModal').style.display = "none";
    }
    function toggleLike(btn) {
      const item = btn.closest('.wechat-body');
      const likeBox = item.querySelector('.wechat-like-box');
      if (likeBox.style.display === 'none') {
        likeBox.style.display = 'block';
        btn.classList.add('active');
      } else {
        likeBox.style.display = 'none';
        btn.classList.remove('active');
      }
    }
  </script>
</body>
</html>`;
}

async function computeSha256Hex(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return str;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getTemplateCss(templateId) {
  return `
    /* Common Reset & Variables */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #f2f2f6; color: #1c1c1e; line-height: 1.6; }
    body.is-locked { overflow: hidden; }
    img, video { max-width: 100%; border-radius: 8px; }

    /* Password Lock Screen Overlay */
    .lock-screen-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(15, 23, 42, 0.88); backdrop-filter: blur(20px); display: flex; align-items: center; justify-content: center; padding: 20px; }
    .lock-card { background: rgba(30, 41, 59, 0.95); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 20px; width: 100%; max-width: 380px; padding: 32px 24px; text-align: center; color: #fff; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    .lock-card.shake { animation: shake 0.4s ease-in-out; }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-8px); } 40%, 80% { transform: translateX(8px); } }
    .lock-icon { font-size: 40px; margin-bottom: 12px; }
    .lock-card h2 { font-size: 20px; font-weight: 700; color: #38bdf8; margin-bottom: 6px; }
    .lock-sub { font-size: 12px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
    .lock-form { display: flex; flex-direction: column; gap: 12px; }
    .lock-input { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 12px 16px; color: #fff; font-size: 14px; outline: none; transition: border-color 0.2s; }
    .lock-input:focus { border-color: #38bdf8; }
    .lock-btn-submit { width: 100%; background: linear-gradient(135deg, #38bdf8, #34d399); border: none; border-radius: 12px; padding: 12px; color: #000; font-weight: 700; font-size: 14px; cursor: pointer; transition: opacity 0.2s; }
    .lock-btn-submit:hover { opacity: 0.9; }
    .lock-remember-row { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 14px; font-size: 12px; color: #94a3b8; }
    .lock-error-msg { font-size: 12px; color: #f87171; margin-top: 12px; min-height: 18px; font-weight: 600; }

    /* Lightbox */
    .lightbox-modal { display: none; position: fixed; z-index: 9999; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.9); align-items: center; justify-content: center; }
    .lightbox-content { max-width: 90%; max-height: 90%; border-radius: 4px; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
    .lightbox-close { position: absolute; top: 20px; right: 35px; color: #fff; font-size: 40px; font-weight: bold; cursor: pointer; }

    /* --- Template 1: WeChat Moments (朋友圈风格 & 9宫格) --- */
    .theme-wechat { background: #ededed; }
    .wechat-container { max-width: 600px; margin: 0 auto; background: #fff; min-height: 100vh; box-shadow: 0 0 20px rgba(0,0,0,0.05); }
    .wechat-header-cover { position: relative; height: 240px; background: linear-gradient(135deg, #1aad19, #07c160); }
    .cover-bg { width: 100%; height: 100%; background-size: cover; background-position: center; opacity: 0.8; }
    .user-profile { position: absolute; right: 20px; bottom: -30px; display: flex; align-items: center; gap: 12px; }
    .user-name { color: #fff; font-weight: 700; font-size: 18px; text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
    .header-avatar { width: 70px; height: 70px; border-radius: 12px; border: 2px solid #fff; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    
    .diary-title-banner { padding: 45px 20px 15px 20px; border-bottom: 1px solid #f0f0f0; }
    .diary-title-banner h2 { font-size: 20px; color: #111; }
    .diary-title-banner p { font-size: 12px; color: #888; margin-top: 4px; }

    .wechat-feed { padding: 20px 16px; }
    .wechat-item { display: flex; gap: 12px; padding-bottom: 24px; border-bottom: 1px solid #f0f0f0; margin-bottom: 20px; }
    .wechat-avatar { width: 42px; height: 42px; border-radius: 6px; flex-shrink: 0; background: #f0f0f0; }
    .wechat-body { flex: 1; min-width: 0; }
    .wechat-nickname { font-weight: 600; color: #576b95; font-size: 15px; margin-bottom: 6px; }
    .wechat-text-content { font-size: 15px; color: #111; word-break: break-word; white-space: pre-wrap; margin-bottom: 8px; line-height: 1.5; }
    .wechat-location-badge { display: inline-flex; align-items: center; gap: 4px; color: #576b95; font-size: 13px; background: #f3f4f7; padding: 4px 8px; border-radius: 4px; margin-bottom: 8px; }
    .wechat-location-badge .icon { width: 14px; height: 14px; }

    /* 9-Grid WeChat Layout */
    .wechat-grid-container { display: grid; gap: 4px; margin-bottom: 8px; }
    .wechat-grid-container.grid-count-1 { grid-template-columns: 1fr; max-width: 220px; }
    .wechat-grid-container.grid-count-2 { grid-template-columns: repeat(2, 1fr); width: 220px; }
    .wechat-grid-container.grid-count-3 { grid-template-columns: repeat(3, 1fr); width: 290px; }
    .wechat-grid-container.grid-count-4 { grid-template-columns: repeat(2, 1fr); width: 220px; }
    .wechat-grid-container.grid-count-5,
    .wechat-grid-container.grid-count-6,
    .wechat-grid-container.grid-count-7,
    .wechat-grid-container.grid-count-8,
    .wechat-grid-container.grid-count-9 { grid-template-columns: repeat(3, 1fr); width: 290px; }

    .wechat-grid-img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 4px; cursor: pointer; transition: opacity 0.2s; }
    .wechat-grid-img:hover { opacity: 0.9; }

    .wechat-single-img { max-width: 220px; max-height: 280px; object-fit: cover; border-radius: 4px; cursor: pointer; transition: opacity 0.2s; }
    .wechat-single-img:hover { opacity: 0.9; }
    
    /* Caption Style: Clean, identical font to text content, multi-line, no background fill */
    .wechat-caption-sub { font-size: 15px; color: #111; margin-top: 6px; margin-bottom: 6px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .wechat-caption-sub .caption-item { margin-bottom: 4px; }
    .wechat-caption-sub .caption-item:last-child { margin-bottom: 0; }

    .wechat-video-player { max-width: 280px; border-radius: 4px; }
    .wechat-audio-box { background: #f7f7f7; border-radius: 6px; padding: 6px; width: 100%; }
    .wechat-audio-player { width: 100%; height: 36px; }
    .wechat-file-box { display: flex; align-items: center; gap: 10px; background: #f7f7f7; padding: 10px; border-radius: 6px; max-width: 320px; }
    .wechat-file-box .file-icon { width: 32px; height: 32px; fill: #576b95; }
    .wechat-file-box .file-name { font-size: 13px; font-weight: 500; color: #111; text-decoration: none; word-break: break-all; }
    .wechat-file-box .file-size { font-size: 11px; color: #888; display: block; }

    .wechat-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 12px; color: #b2b2b2; }
    .like-btn { background: #f7f7f7; border: none; padding: 4px 10px; border-radius: 4px; color: #576b95; cursor: pointer; font-size: 12px; transition: background 0.2s; }
    .like-btn:hover, .like-btn.active { background: #e6e6e6; color: #07c160; }
    .wechat-like-box { margin-top: 8px; background: #f3f3f5; padding: 6px 10px; border-radius: 4px; font-size: 12px; color: #576b95; position: relative; }
    .wechat-like-box::before { content: ''; position: absolute; top: -6px; left: 14px; border-width: 0 6px 6px 6px; border-style: solid; border-color: transparent transparent #f3f3f5 transparent; }

    /* --- Template 2: Modern Journal (简约现代) --- */
    .theme-journal { background: #f8fafc; }
    .theme-journal .diary-container { max-width: 760px; margin: 0 auto; padding: 40px 20px; }
    .theme-journal .main-header { text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #e2e8f0; }
    .theme-journal .main-header h1 { font-size: 28px; color: #0f172a; font-weight: 800; }
    .theme-journal .main-header .subtitle { font-size: 14px; color: #64748b; margin-top: 6px; }

    .theme-journal .timeline-container { position: relative; padding-left: 20px; border-left: 2px solid #cbd5e1; }
    .theme-journal .timeline-node { position: relative; margin-bottom: 32px; }
    .theme-journal .timeline-dot { position: absolute; left: -27px; top: 16px; width: 12px; height: 12px; border-radius: 50%; background: #3b82f6; border: 2px solid #fff; }
    .theme-journal .timeline-content-card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.04); border: 1px solid #e2e8f0; }
    .theme-journal .card-header { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px; color: #64748b; }
    .theme-journal .card-img { max-height: 400px; width: 100%; object-fit: cover; border-radius: 8px; cursor: pointer; }
    .theme-journal .card-text { font-size: 15px; color: #334155; line-height: 1.7; white-space: pre-wrap; margin-top: 10px; }

    .card-grid-wrap { display: grid; gap: 6px; margin-bottom: 10px; }
    .card-grid-wrap.grid-count-1 { grid-template-columns: 1fr; }
    .card-grid-wrap.grid-count-2 { grid-template-columns: repeat(2, 1fr); }
    .card-grid-wrap.grid-count-3, .card-grid-wrap.grid-count-4, .card-grid-wrap.grid-count-5,
    .card-grid-wrap.grid-count-6, .card-grid-wrap.grid-count-7, .card-grid-wrap.grid-count-8,
    .card-grid-wrap.grid-count-9 { grid-template-columns: repeat(3, 1fr); }
    .card-grid-img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 6px; cursor: pointer; }
    .card-captions { font-size: 15px; color: #334155; margin-top: 8px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
    .card-captions .caption-item { margin-bottom: 4px; }
    .card-captions .caption-item:last-child { margin-bottom: 0; }

    /* --- Template 3: Polaroid Gallery (拍立得相册) --- */
    .theme-polaroid { background: #f5eedc; font-family: "Caveat", cursive, sans-serif; }
    .theme-polaroid .diary-container { max-width: 800px; margin: 0 auto; padding: 30px 20px; }
    .theme-polaroid .main-header h1 { font-size: 32px; color: #4a3e3d; text-align: center; margin-bottom: 30px; }
    .theme-polaroid .timeline-content-card { background: #fff; padding: 16px 16px 24px 16px; border-radius: 2px; box-shadow: 0 8px 20px rgba(0,0,0,0.12); margin-bottom: 36px; transform: rotate(-1deg); transition: transform 0.3s; }
    .theme-polaroid .timeline-node:nth-child(even) .timeline-content-card { transform: rotate(1.5deg); }
    .theme-polaroid .timeline-content-card:hover { transform: scale(1.02) rotate(0deg); z-index: 10; }
    .theme-polaroid .card-img { width: 100%; height: 360px; object-fit: cover; border-radius: 0; border: 1px solid #eee; }
    .theme-polaroid .card-text { font-size: 18px; color: #222; text-align: center; margin-top: 14px; }

    /* --- Template 4: Dark Retro Film (极简胶片) --- */
    .theme-film { background: #121214; color: #e4e4e7; }
    .theme-film .diary-container { max-width: 720px; margin: 0 auto; padding: 40px 20px; }
    .theme-film .main-header h1 { font-size: 26px; color: #f4f4f5; letter-spacing: 1px; text-align: center; margin-bottom: 40px; }
    .theme-film .timeline-content-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(10px); border-radius: 16px; padding: 24px; margin-bottom: 32px; }
    .theme-film .card-img { border-radius: 12px; max-height: 450px; object-fit: cover; }
    .theme-film .card-text { color: #d4d4d8; font-size: 15px; line-height: 1.7; margin-top: 12px; }
    .theme-film .card-header { color: #a1a1aa; }

    /* --- Template 5: Travel Notes (风物志) --- */
    .theme-travel { background: #faf7f2; color: #2c3e50; }
    .theme-travel .diary-container { max-width: 780px; margin: 0 auto; padding: 40px 20px; }
    .theme-travel .main-header { background: #eef2f5; padding: 24px; border-radius: 16px; margin-bottom: 30px; border: 1px solid #dcdfe6; }
    .theme-travel .timeline-content-card { background: #fff; border-radius: 14px; padding: 20px; border: 1px solid #e4e7ed; box-shadow: 0 4px 16px rgba(0,0,0,0.03); margin-bottom: 24px; }
    .theme-travel .location-badge { background: #e1f5fe; color: #0288d1; padding: 4px 10px; border-radius: 20px; font-size: 12px; }
  `;
}
