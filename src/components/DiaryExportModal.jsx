import React, { useState, useEffect } from 'react';
import { generateDiaryHtml } from '../utils/diaryGenerator';

export default function DiaryExportModal({
  isOpen,
  onClose,
  folderMsg,
  folderMessages = [],
  folderTree = null,
  currentProfile,
  storageClient,
  onGenerated
}) {
  const [exportMode, setExportMode] = useState('relative'); // 'relative' or 'single'
  const [templateId, setTemplateId] = useState('wechat');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [customSubDir, setCustomSubDir] = useState('');
  const [enablePassword, setEnablePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatusText, setExportStatusText] = useState('');
  const [resultUrl, setResultUrl] = useState(null);
  const [resultPath, setResultPath] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [existingDiaryInfo, setExistingDiaryInfo] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    const defaultName = folderMsg ? (folderMsg.content || '文件夹日记') : '精选日记';
    setTitle(defaultName);
    setAuthor(currentProfile ? (currentProfile.username || 'CloudChat User') : 'CloudChat User');
    const clean = defaultName.replace(/[\\/:*?"<>|]/g, '_');
    setCustomSubDir(`diary/${clean}`);
    setResultUrl(null);
    setResultPath('');
    setErrorMsg('');
  }, [isOpen, folderMsg]);

  // Check whether index.html exists at the PREPARED TARGET PATH
  useEffect(() => {
    if (!isOpen || !storageClient || !customSubDir.trim()) {
      setExistingDiaryInfo(null);
      return;
    }
    let isMounted = true;
    const cleanDir = customSubDir.trim().replace(/^\/+|\/+$/g, '');
    const indexPath = `${cleanDir}/index.html`;

    const checkIndex = async () => {
      try {
        const size = await storageClient.getFileSize(indexPath);
        if (isMounted) {
          if (size > 0) {
            let publicUrl = storageClient.getUrl(indexPath);
            if (currentProfile && currentProfile.diaryBaseUrl && currentProfile.diaryBaseUrl.trim()) {
              const base = currentProfile.diaryBaseUrl.trim().replace(/\/+$/, '');
              const relativePath = indexPath.replace(/^diary\//i, '');
              publicUrl = `${base}/${relativePath}`;
            }
            setExistingDiaryInfo({ url: publicUrl, path: indexPath });
          } else {
            setExistingDiaryInfo(null);
          }
        }
      } catch (e) {
        if (isMounted) setExistingDiaryInfo(null);
      }
    };

    checkIndex();
    return () => { isMounted = false; };
  }, [isOpen, customSubDir, storageClient, currentProfile]);

  if (!isOpen) return null;

  const folderName = folderMsg ? (folderMsg.content || '文件夹') : '多选条目';
  const targetDirClean = (customSubDir || 'diary/export').trim().replace(/^\/+|\/+$/g, '');
  const targetSubPath = `${targetDirClean}/index.html`;

  const templates = [
    {
      id: 'wechat',
      name: '💬 微信朋友圈九宫格',
      badge: '推荐',
      desc: '支持 2~9 图经典九宫格排版，自动萃取各图片注释与微信点赞赞赏流。',
      bgClass: 'from-emerald-500/20 to-green-600/10 border-emerald-500/40'
    },
    {
      id: 'journal',
      name: '📖 简约现代日记',
      badge: '经典',
      desc: '优雅深浅排版，时间轴穿插与图片组网格，适合日常随笔与故事记录。',
      bgClass: 'from-blue-500/20 to-slate-600/10 border-blue-500/40'
    },
    {
      id: 'polaroid',
      name: '📸 拍立得复古相册',
      badge: '复古',
      desc: '拍立得留白框与手写体注释，带随机倾斜角与悬浮动画。',
      bgClass: 'from-amber-500/20 to-orange-600/10 border-amber-500/40'
    },
    {
      id: 'film',
      name: '🎬 极简胶片风',
      badge: '暗黑',
      desc: '电影感微颗粒暗色质感，毛玻璃浮窗卡片，适合摄影与视频。',
      bgClass: 'from-purple-500/20 to-indigo-600/10 border-purple-500/40'
    },
    {
      id: 'travel',
      name: '🍃 简约风物志',
      badge: '清新',
      desc: '马卡龙与纸张质感，附带位置 Badge 与离线打印 PDF 优化。',
      bgClass: 'from-teal-500/20 to-cyan-600/10 border-teal-500/40'
    }
  ];

  const handleStartExport = async () => {
    if (!storageClient) {
      setErrorMsg('未配置服务器存储客户端，请先在设置中配置 WebDAV 或 S3。');
      return;
    }

    setIsExporting(true);
    setErrorMsg('');
    setExportProgress(20);
    setExportStatusText('正在编译聚合日记 HTML 页面...');

    try {
      // 1. Ensure target directory exists on server for WebDAV if applicable
      if (typeof storageClient.ensureFolderPathExist === 'function') {
        setExportStatusText(`在服务器创建保存目录: ${targetDirClean}/...`);
        await storageClient.ensureFolderPathExist(targetDirClean);
      }

      setExportProgress(50);
      setExportStatusText('正在解析宫格条目与提取图片注释...');

      // 2. Generate HTML code string with live progress feedback
      const htmlContent = await generateDiaryHtml({
        folderName: title.trim() || '精选日记',
        author: author.trim() || 'CloudChat User',
        avatar: currentProfile?.avatar || '',
        templateId,
        password: enablePassword ? password : '',
        messages: folderMessages,
        folderTree,
        storageClient,
        targetDirClean,
        exportMode,
        onProgress: (pct, text) => {
          setExportProgress(pct);
          setExportStatusText(text);
        }
      });

      setExportProgress(88);
      setExportStatusText('正在将 index.html 覆盖推送至服务器存储...');

      // 3. Create HTML Blob file and upload to storage client
      const blob = new Blob([htmlContent], { type: 'text/html; charset=utf-8' });
      const uploadedUrl = await storageClient.uploadFile(
        blob,
        targetSubPath,
        'text/html; charset=utf-8',
        (pct) => setExportProgress(88 + Math.round(pct * 0.12))
      );

      setExportProgress(100);
      setExportStatusText('🎉 日记网页生成部署成功！');

      let finalPublicUrl = uploadedUrl || storageClient.getUrl(targetSubPath);
      if (currentProfile && currentProfile.diaryBaseUrl && currentProfile.diaryBaseUrl.trim()) {
        const base = currentProfile.diaryBaseUrl.trim().replace(/\/+$/, '');
        const relativePath = targetSubPath.replace(/^diary\//i, '');
        finalPublicUrl = `${base}/${relativePath}`;
      }

      setResultUrl(finalPublicUrl);
      setResultPath(targetSubPath);
      if (onGenerated) onGenerated();
    } catch (err) {
      console.error('Export diary error:', err);
      setErrorMsg('生成日记失败: ' + (err.message || '网络通信异常'));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-bgSecondary border border-borderColor rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-borderColor bg-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <i className="fa-solid fa-book-bookmark text-lg"></i>
            </div>
            <div>
              <h3 className="text-base font-bold text-textPrimary">生成静态日记页面</h3>
              <p className="text-xs text-textMuted">归档文件夹 [{folderName}] ({folderMessages.length} 条目)</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-textMuted hover:text-textPrimary transition-colors"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {resultUrl ? (
            /* Success View */
            <div className="py-6 text-center space-y-4 animate-scale-up">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto text-2xl border border-emerald-500/30">
                <i className="fa-solid fa-circle-check"></i>
              </div>
              <div>
                <h4 className="text-lg font-bold text-textPrimary">日记网页已在服务器部署完毕！</h4>
                <p className="text-xs text-textMuted mt-1">云端存储路径：<span className="font-mono text-cyan-400">{resultPath}</span></p>
              </div>

              <div className="p-3 bg-black/20 rounded-xl border border-borderColor/60 font-mono text-xs text-textSecondary break-all text-left">
                {resultUrl}
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <a
                  href={resultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 bg-accentColor hover:bg-accentColor/90 text-white font-semibold text-xs rounded-xl shadow-lg transition-all flex items-center gap-2"
                >
                  <i className="fa-solid fa-arrow-up-right-from-square"></i> 打开预览日记网页
                </a>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(resultUrl);
                    alert('已复制日记网页 URL 到剪贴板！');
                  }}
                  className="px-4 py-2.5 bg-bgPrimary border border-borderColor hover:bg-white/5 text-textPrimary text-xs rounded-xl transition-all flex items-center gap-2"
                >
                  <i className="fa-solid fa-copy"></i> 复制链接
                </button>
                <button
                  onClick={() => setResultUrl(null)}
                  className="px-4 py-2.5 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 text-cyan-300 font-semibold text-xs rounded-xl transition-all flex items-center gap-1.5"
                  title="重新选择模板或修改参数再次生成"
                >
                  <i className="fa-solid fa-rotate"></i> 再次生成
                </button>
              </div>
            </div>
          ) : (
            /* Config Form View */
            <>
              {/* Form Input Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-textSecondary mb-1.5">日记专栏标题</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-bgPrimary border border-borderColor rounded-xl text-textPrimary focus:outline-none focus:border-cyan-500"
                    placeholder="输入日记标题"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-textSecondary mb-1.5">作者 / 署名</label>
                  <input
                    type="text"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-bgPrimary border border-borderColor rounded-xl text-textPrimary focus:outline-none focus:border-cyan-500"
                    placeholder="输入作者名称"
                  />
                </div>
              </div>

              {/* Export Mode Selection */}
              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-1.5">导出部署模式</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <div
                    onClick={() => setExportMode('relative')}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                      exportMode === 'relative'
                        ? 'border-cyan-400 bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-400/30'
                        : 'border-borderColor/60 bg-black/20 text-textMuted hover:border-textMuted'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-textPrimary">⚡ 云端极速部署模式</span>
                      {exportMode === 'relative' && <i className="fa-solid fa-circle-check text-cyan-400 text-xs"></i>}
                    </div>
                    <p className="text-[10px] text-textMuted leading-tight">
                      自动 WebP 图片压缩 + ServiceWorker 离线磁盘缓存。首屏秒开，再次访问 0ms 延迟。
                    </p>
                  </div>

                  <div
                    onClick={() => setExportMode('single')}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                      exportMode === 'single'
                        ? 'border-cyan-400 bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-400/30'
                        : 'border-borderColor/60 bg-black/20 text-textMuted hover:border-textMuted'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-textPrimary">📦 单文件 Base64 全包</span>
                      {exportMode === 'single' && <i className="fa-solid fa-circle-check text-cyan-400 text-xs"></i>}
                    </div>
                    <p className="text-[10px] text-textMuted leading-tight">
                      将所有图片与头像转为 Base64 嵌入单个 HTML。适合离线保存到本地或直接分享文件。
                    </p>
                  </div>
                </div>
              </div>

              {/* Custom Target Directory Field */}
              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-1.5 flex items-center justify-between">
                  <span>自定义服务器保存目录 (Custom Save Directory)</span>
                  <span className="text-[10px] text-cyan-400 font-mono">生成目标: {targetSubPath}</span>
                </label>
                <input
                  type="text"
                  value={customSubDir}
                  onChange={(e) => setCustomSubDir(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-bgPrimary border border-borderColor rounded-xl text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                  placeholder="例如: 2026夏日随笔 或 work_log"
                />
              </div>

              {/* Existing Index Banner (Only for the CURRENT custom directory) */}
              {existingDiaryInfo && (
                <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-xs flex items-center justify-between animate-fade-in">
                  <span className="text-cyan-300 flex items-center gap-1.5 font-medium">
                    <i className="fa-solid fa-circle-info text-cyan-400"></i> 该目录下已存在日记网页 (index.html)，再次生成将更新覆盖。
                  </span>
                  <a 
                    href={existingDiaryInfo.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-cyan-400 hover:underline font-mono text-[11px] shrink-0 ml-2"
                  >
                    查看已有网页 <i className="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                  </a>
                </div>
              )}

              {/* Password Protection Option */}
              <div className="p-3 bg-black/20 rounded-xl border border-borderColor/60 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-lock text-cyan-400 text-xs"></i>
                    <span className="text-xs font-semibold text-textPrimary">启用网页访问密码锁</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={enablePassword}
                      onChange={(e) => setEnablePassword(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-bgPrimary border border-borderColor peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-textMuted peer-checked:after:bg-cyan-400 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500/20 peer-checked:border-cyan-500/40"></div>
                  </label>
                </div>
                {enablePassword && (
                  <div className="pt-1 animate-fade-in">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="设置访问密码 (如 123456)..."
                      className="w-full px-3 py-1.5 text-xs bg-bgPrimary border border-borderColor rounded-lg text-textPrimary focus:outline-none focus:border-cyan-500"
                    />
                    <p className="text-[10px] text-textMuted mt-1">访客打开生成好的网页时，需先输入正确密码才能解密阅读内容。</p>
                  </div>
                )}
              </div>

              {/* Template Selectors */}
              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-2">选择精美 HTML 日记模板</label>
                <div className="grid grid-cols-1 gap-2.5">
                  {templates.map(tmpl => (
                    <div
                      key={tmpl.id}
                      onClick={() => setTemplateId(tmpl.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between bg-gradient-to-r ${tmpl.bgClass} ${
                        templateId === tmpl.id ? 'border-cyan-400 ring-2 ring-cyan-400/20 shadow-md' : 'border-borderColor/60 hover:border-textMuted'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-textPrimary">{tmpl.name}</span>
                          <span className="px-1.5 py-0.5 text-[10px] bg-cyan-500/20 text-cyan-300 rounded-md font-semibold">{tmpl.badge}</span>
                        </div>
                        <p className="text-[11px] text-textMuted">{tmpl.desc}</p>
                      </div>
                      <div className="pl-3">
                        <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          templateId === tmpl.id ? 'border-cyan-400 bg-cyan-400 text-black' : 'border-borderColor'
                        }`}>
                          {templateId === tmpl.id && <i className="fa-solid fa-check text-[10px]"></i>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Target Server Path Info */}
              <div className="p-3 bg-black/20 rounded-xl border border-borderColor/60 flex items-center justify-between text-xs">
                <span className="text-textMuted">服务器保存目录：</span>
                <span className="font-mono text-cyan-400 font-semibold">{targetSubPath}</span>
              </div>

              {errorMsg && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2">
                  <i className="fa-solid fa-circle-exclamation"></i>
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Progress Bar */}
              {isExporting && (
                <div className="space-y-2 pt-2 animate-fade-in">
                  <div className="flex justify-between text-xs text-textMuted">
                    <span>{exportStatusText}</span>
                    <span className="font-semibold text-cyan-400">{exportProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-bgPrimary rounded-full overflow-hidden border border-borderColor/40">
                    <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300" style={{ width: `${exportProgress}%` }}></div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-borderColor bg-white/5">
          {resultUrl ? (
            <button
              onClick={onClose}
              className="px-5 py-2 text-xs font-semibold text-textPrimary bg-bgPrimary border border-borderColor rounded-xl hover:bg-white/5 transition-all"
            >
              关闭窗口
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={isExporting}
                className="px-4 py-2 text-xs font-semibold text-textMuted hover:text-textPrimary transition-all disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleStartExport}
                disabled={isExporting}
                className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-black font-bold text-xs rounded-xl shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isExporting ? (
                  <>
                    <i className="fa-solid fa-circle-notch fa-spin"></i> 生成部署中...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-bolt"></i> ✨ 生成并存入服务器
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
