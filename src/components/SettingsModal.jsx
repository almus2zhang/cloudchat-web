import React, { useState, useEffect } from 'react';
import { cacheFile } from '../services/db';
import { StorageClient } from '../services/storage';
import { PRESET_AVATARS, getInitialAvatar } from '../utils/avatar';
import { getAiConfig, saveAiConfig, testAiConnection, DEFAULT_AI_CONFIG } from '../services/aiService';

// 校验「设定的用户目录」合法性：目录各段只能包含数字、字母、下划线、连字符。
// 返回 null 表示合法，否则返回错误提示文案。
function validateUserDir(profile) {
  if (!profile) return '配置为空';
  const segs = [];
  const root = (profile.serverPath || '').replace(/^\/+|\/+$/g, '');
  const dir = (profile.saveDir || '').replace(/^\/+|\/+$/g, '');
  if (root) root.split('/').filter(Boolean).forEach(s => segs.push(s));
  if (dir) dir.split('/').filter(Boolean).forEach(s => segs.push(s));
  if (segs.length === 0) return '存储目录不能为空，请填写目录名';
  const valid = /^[a-zA-Z0-9_-]+$/;
  for (const seg of segs) {
    if (seg.length > 255) return `目录层级「${seg}」过长（最多 255 字符）`;
    if (seg === '.' || seg === '..') return `目录层级不能为「${seg}」`;
    if (!valid.test(seg)) return `目录层级「${seg}」含非法字符，只能使用数字、字母、下划线(_)、连字符(-)`;
  }
  return null;
}

export default function SettingsModal({ 
  isOpen, 
  profiles = [], 
  activeProfileId, 
  onClose, 
  onSaveProfile, 
  onDeleteProfile,
  onSwitchProfile,
  storageClient,
  resolveAvatarUrl
}) {
  const [activeTab, setActiveTab] = useState('storage'); // 'storage' | 'ai'
  
  const handleInitNewProfileData = () => ({
    id: 'profile_' + Date.now(),
    name: 'Jianguoyun WebDAV',
    type: 'WEBDAV',
    preset: 'jianguoyun',
    username: 'WebUser',
    avatar: PRESET_AVATARS[0],
    syncInterval: 5,
    serverPath: 'CloudChat',
    saveDir: 'user_default',
    diaryBaseUrl: '',
    webDavUrl: 'https://dav.jianguoyun.com/dav/',
    webDavUser: '',
    webDavPass: '',
    webDavChunkSize: 64 * 1024 * 1024, // bytes (64MB)
    webDavFallbackUrl: '',
    endpoint: '',
    bucket: '',
    region: '',
    accessKey: '',
    secretKey: ''
  });

  const [editingProfile, setEditingProfile] = useState(() => {
    const active = (profiles || []).find(p => p.id === activeProfileId) || (profiles || [])[0] || null;
    return active ? { ...active } : handleInitNewProfileData();
  });

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // AI Configuration State
  const [aiConfig, setAiConfig] = useState(() => getAiConfig());
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    const active = (profiles || []).find(p => p.id === activeProfileId) || (profiles || [])[0] || null;
    if (active) {
      setEditingProfile({ ...active });
    } else {
      setEditingProfile(handleInitNewProfileData());
    }
    setAiConfig(getAiConfig());
  }, [isOpen, activeProfileId, profiles]);

  useEffect(() => {
    if (!editingProfile?.avatar) {
      setPreviewUrl(null);
      return;
    }
    const av = editingProfile.avatar;
    if (typeof av === 'string' && (av.startsWith('data:') || av.startsWith('https://') || av.startsWith('http://'))) {
      setPreviewUrl(av);
    } else if (resolveAvatarUrl && typeof av === 'string') {
      resolveAvatarUrl(av).then(url => {
        if (url) setPreviewUrl(url);
      }).catch(() => {});
    }
  }, [editingProfile?.avatar, resolveAvatarUrl]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    if (!editingProfile) return;
    setIsTestingConn(true);
    setTestResult(null);
    try {
      const testService = StorageClient.create(editingProfile);
      const res = await testService.testConnection();
      setTestResult({ success: true, message: res.message });
    } catch (err) {
      setTestResult({ success: false, message: err?.message || '连接失败' });
    } finally {
      setIsTestingConn(false);
    }
  };

  const handleTestAi = async () => {
    setIsTestingAi(true);
    setAiTestResult(null);
    try {
      const msg = await testAiConnection(aiConfig || DEFAULT_AI_CONFIG);
      setAiTestResult({ success: true, message: msg });
    } catch (err) {
      setAiTestResult({ success: false, message: err?.message || '连接失败' });
    } finally {
      setIsTestingAi(false);
    }
  };

  const handleInitNewProfile = () => {
    setEditingProfile(handleInitNewProfileData());
  };

  const handleProfileSelectChange = (e) => {
    const pId = e.target.value;
    if (onSwitchProfile) onSwitchProfile(pId);
  };

  const handleFieldChange = (field, val) => {
    setEditingProfile(prev => ({
      ...(prev || {}),
      [field]: val
    }));
  };

  const handleCustomAvatarSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // Compress custom avatar to 128x128 square JPEG for upload
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 128;
      const canvas = document.createElement('canvas');
      canvas.width = MAX;
      canvas.height = MAX;
      const ctx = canvas.getContext('2d');
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, MAX, MAX);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      handleFieldChange('avatar', dataUrl);
      handleFieldChange('_avatarPendingUpload', true);
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  };

  const convertAvatarToBlob = async (src) => {
    if (!src || typeof src !== 'string') return null;
    if (src.startsWith('data:')) {
      try {
        const res = await fetch(src);
        return await res.blob();
      } catch (e) {
        return null;
      }
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const MAX = 128;
          const canvas = document.createElement('canvas');
          canvas.width = MAX;
          canvas.height = MAX;
          const ctx = canvas.getContext('2d');
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, MAX, MAX);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else resolve(null);
          }, 'image/jpeg', 0.85);
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => {
        resolve(null);
      };
      img.src = src;
    });
  };

  const handleSave = async () => {
    if (!editingProfile || !editingProfile.name || !editingProfile.name.trim()) return;

    // 校验「设定的用户目录」合法性：目录各段只能包含数字、字母、下划线、连字符
    const dirError = validateUserDir(editingProfile);
    if (dirError) {
      setTestResult({ success: false, message: dirError });
      return;
    }

    let profileToSave = { ...editingProfile };
    delete profileToSave._avatarPendingUpload;

    const rawAvatar = typeof editingProfile.avatar === 'string' ? editingProfile.avatar : '';
    const isRemoteFilename = rawAvatar.startsWith('avatar_') || rawAvatar.startsWith('avatar____');

    if (!isRemoteFilename && rawAvatar && storageClient) {
      try {
        setIsUploadingAvatar(true);
        const avatarFileName = `avatar____${Date.now()}.jpg`;
        const blob = await convertAvatarToBlob(rawAvatar);
        
        if (blob) {
          await storageClient.uploadFile(blob, avatarFileName, 'image/jpeg');
          cacheFile(`avatar_${avatarFileName}`, blob);
          if (window.__cachedAvatarUrls) {
            window.__cachedAvatarUrls[avatarFileName] = URL.createObjectURL(blob);
          }
          profileToSave.avatar = avatarFileName;
        }
      } catch (err) {
        console.warn('Avatar upload to WebDAV warning:', err);
      } finally {
        setIsUploadingAvatar(false);
      }
    }

    saveAiConfig(aiConfig || DEFAULT_AI_CONFIG);
    if (onSaveProfile) onSaveProfile(profileToSave);
  };

  const handleDelete = () => {
    if (!editingProfile) return;
    if (confirm(`确定要删除配置方案 "${editingProfile.name || '当前配置'}" 吗？`)) {
      if (onDeleteProfile) onDeleteProfile(editingProfile.id);
    }
  };

  const safeAiConfig = aiConfig || DEFAULT_AI_CONFIG;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-bgSecondary border border-borderColor rounded-xl w-full max-w-xl max-w-[calc(100vw-16px)] shadow-2xl scale-in my-auto max-h-[92vh] flex flex-col">
        
        {/* Header with Tabs */}
        <div className="px-6 py-3.5 border-b border-borderColor flex justify-between items-center bg-white/5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('storage')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'storage'
                  ? 'bg-accentColor text-white shadow-sm'
                  : 'text-textSecondary hover:text-textPrimary hover:bg-white/5'
              }`}
            >
              <i className="fa-solid fa-server"></i> 存储与服务
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ai')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'ai'
                  ? 'bg-gradient-to-r from-amber-500 to-indigo-500 text-white shadow-sm'
                  : 'text-textSecondary hover:text-textPrimary hover:bg-white/5'
              }`}
            >
              <i className="fa-solid fa-wand-magic-sparkles"></i> AI 大模型
            </button>
          </div>
          <button onClick={onClose} className="text-textMuted hover:text-textPrimary transition-colors">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[75vh] overflow-y-auto flex flex-col gap-5">
          
          {activeTab === 'ai' ? (
            /* AI CONFIGURATION TAB */
            <div className="flex flex-col gap-4 animate-fade-in">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-bold text-textPrimary flex items-center gap-1.5">
                  <i className="fa-solid fa-brain text-amber-400"></i> AI 语音总结与大模型接口
                </h3>
                <p className="text-xs text-textMuted">
                  支持调用 OpenAI 兼容接口（如硅基流动 SiliconFlow）或 Google Gemini 原生接口进行语音识别转写与分级要点提炼。
                </p>
              </div>

              {/* Provider Selection */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-textSecondary uppercase tracking-wider">大模型平台协议</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), provider: 'openai' }))}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                      safeAiConfig.provider !== 'gemini'
                        ? 'bg-indigo-500/15 border-indigo-500 text-indigo-400 ring-1 ring-indigo-500/30'
                        : 'bg-bgPrimary border-borderColor text-textSecondary hover:text-textPrimary'
                    }`}
                  >
                    <i className="fa-solid fa-microchip"></i> OpenAI 兼容 / 硅基流动
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), provider: 'gemini' }))}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                      safeAiConfig.provider === 'gemini'
                        ? 'bg-amber-500/15 border-amber-500 text-amber-400 ring-1 ring-amber-500/30'
                        : 'bg-bgPrimary border-borderColor text-textSecondary hover:text-textPrimary'
                    }`}
                  >
                    <i className="fa-solid fa-bolt"></i> Google Gemini
                  </button>
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-textSecondary uppercase tracking-wider">一键快捷配置预设</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAiConfig(prev => ({
                      ...(prev || DEFAULT_AI_CONFIG),
                      provider: 'openai',
                      openaiBaseUrl: 'https://api.siliconflow.cn/v1',
                      openaiWhisperModel: 'FunAudioLLM/SenseVoiceSmall',
                      openaiChatModel: 'deepseek-ai/DeepSeek-V4-Flash'
                    }))}
                    className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all"
                  >
                    ⚡ 硅基流动预设 (SenseVoice + DeepSeek-V4-Flash)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiConfig(prev => ({
                      ...(prev || DEFAULT_AI_CONFIG),
                      provider: 'openai',
                      openaiBaseUrl: 'https://api.openai.com/v1',
                      openaiWhisperModel: 'whisper-1',
                      openaiChatModel: 'gpt-4o-mini'
                    }))}
                    className="px-2.5 py-1 text-xs font-medium rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 transition-all"
                  >
                    ⚡ OpenAI 官方
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiConfig(prev => ({
                      ...(prev || DEFAULT_AI_CONFIG),
                      provider: 'gemini',
                      geminiBaseUrl: 'https://generativelanguage.googleapis.com',
                      geminiModel: 'gemini-2.5-flash'
                    }))}
                    className="px-2.5 py-1 text-xs font-medium rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all"
                  >
                    ⚡ Gemini 官方
                  </button>
                </div>
              </div>

              {safeAiConfig.provider !== 'gemini' ? (
                /* OpenAI / SiliconFlow Fields */
                <div className="flex flex-col gap-3.5 pt-1">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-textSecondary uppercase">API Base URL</label>
                    <input
                      type="text"
                      value={safeAiConfig.openaiBaseUrl || ''}
                      onChange={(e) => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), openaiBaseUrl: e.target.value }))}
                      placeholder="https://api.siliconflow.cn/v1"
                      className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor w-full"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-textSecondary uppercase">API Key (密钥)</label>
                    <input
                      type="password"
                      value={safeAiConfig.openaiApiKey || ''}
                      onChange={(e) => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), openaiApiKey: e.target.value }))}
                      placeholder="sk-..."
                      className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor w-full font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-textSecondary uppercase">语音识别模型 (Whisper / ASR)</label>
                    <input
                      type="text"
                      value={safeAiConfig.openaiWhisperModel || ''}
                      onChange={(e) => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), openaiWhisperModel: e.target.value }))}
                      placeholder="FunAudioLLM/SenseVoiceSmall"
                      className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor w-full"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {['FunAudioLLM/SenseVoiceSmall', 'openai/whisper-large-v3-turbo', 'whisper-1'].map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), openaiWhisperModel: m }))}
                          className={`text-[11px] px-2 py-0.5 rounded border transition-all ${
                            safeAiConfig.openaiWhisperModel === m
                              ? 'bg-accentColor/20 border-accentColor text-accentColor font-bold'
                              : 'bg-bgPrimary border-borderColor text-textMuted hover:text-textPrimary'
                          }`}
                        >
                          {m.split('/').pop()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-textSecondary uppercase">对话总结大模型 (Chat Model)</label>
                    <input
                      type="text"
                      value={safeAiConfig.openaiChatModel || ''}
                      onChange={(e) => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), openaiChatModel: e.target.value }))}
                      placeholder="deepseek-ai/DeepSeek-V4-Flash"
                      className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor w-full"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {['deepseek-ai/DeepSeek-V4-Flash', 'deepseek-ai/DeepSeek-V3', 'gpt-4o-mini', 'gpt-4o'].map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), openaiChatModel: m }))}
                          className={`text-[11px] px-2 py-0.5 rounded border transition-all ${
                            safeAiConfig.openaiChatModel === m
                              ? 'bg-accentColor/20 border-accentColor text-accentColor font-bold'
                              : 'bg-bgPrimary border-borderColor text-textMuted hover:text-textPrimary'
                          }`}
                        >
                          {m.split('/').pop()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Gemini Fields */
                <div className="flex flex-col gap-3.5 pt-1">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-textSecondary uppercase">Gemini Base URL</label>
                    <input
                      type="text"
                      value={safeAiConfig.geminiBaseUrl || ''}
                      onChange={(e) => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), geminiBaseUrl: e.target.value }))}
                      placeholder="https://generativelanguage.googleapis.com"
                      className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor w-full"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-textSecondary uppercase">Gemini API Key</label>
                    <input
                      type="password"
                      value={safeAiConfig.geminiApiKey || ''}
                      onChange={(e) => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), geminiApiKey: e.target.value }))}
                      placeholder="AIzaSy..."
                      className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor w-full font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-textSecondary uppercase">Gemini 模型</label>
                    <input
                      type="text"
                      value={safeAiConfig.geminiModel || ''}
                      onChange={(e) => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), geminiModel: e.target.value }))}
                      placeholder="gemini-2.5-flash"
                      className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor w-full"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash'].map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), geminiModel: m }))}
                          className={`text-[11px] px-2 py-0.5 rounded border transition-all ${
                            safeAiConfig.geminiModel === m
                              ? 'bg-accentColor/20 border-accentColor text-accentColor font-bold'
                              : 'bg-bgPrimary border-borderColor text-textMuted hover:text-textPrimary'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Prompt */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-textSecondary uppercase">自定义总结提示词 (Prompt)</label>
                <textarea
                  rows={3}
                  value={safeAiConfig.summaryPrompt || ''}
                  onChange={(e) => setAiConfig(prev => ({ ...(prev || DEFAULT_AI_CONFIG), summaryPrompt: e.target.value }))}
                  className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg p-2.5 text-xs focus:outline-none focus:border-accentColor w-full font-mono"
                />
              </div>

              {/* Test Connection Button */}
              <div className="pt-1 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleTestAi}
                  disabled={isTestingAi}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-all flex items-center justify-center gap-2 self-start"
                >
                  {isTestingAi ? (
                    <>
                      <i className="fa-solid fa-spinner animate-spin text-xs"></i>
                      <span>正在测试 AI API 连通性...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-wand-magic-sparkles text-xs"></i>
                      <span>测试 AI 大模型 API 连接</span>
                    </>
                  )}
                </button>

                {aiTestResult && (
                  <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 border ${
                    aiTestResult.success 
                      ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}>
                    <i className={`fa-solid ${aiTestResult.success ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
                    <span>{aiTestResult.message}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* STORAGE CONFIGURATION TAB */
            <>
              {/* Profile Switcher */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-textSecondary uppercase tracking-wider">当前配置方案</label>
                <div className="flex gap-2">
                  <select 
                    value={activeProfileId || ''} 
                    onChange={handleProfileSelectChange}
                    className="flex-1 bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors"
                  >
                    {(profiles || []).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    {(profiles || []).length === 0 && <option value="">暂无配置 - 请点击新建配置</option>}
                  </select>
                  {(profiles || []).length > 0 && (
                    <button 
                      onClick={handleDelete}
                      className="px-3.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 rounded-lg transition-all"
                      title="删除当前配置"
                    >
                      <i className="fa-regular fa-trash-can"></i>
                    </button>
                  )}
                  <button 
                    onClick={handleInitNewProfile}
                    className="px-3 py-2 bg-accentColor hover:bg-accentHover text-white font-medium rounded-lg text-sm transition-all flex items-center gap-1"
                  >
                    <i className="fa-solid fa-plus"></i> 新建配置
                  </button>
                </div>
              </div>

              <hr className="border-borderColor" />

              {editingProfile && (
                <div className="flex flex-col gap-4">
                  {/* Form Nickname & Storage Type */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">配置方案名称</label>
                      <input 
                        type="text" 
                        value={editingProfile.name || ''}
                        onChange={(e) => handleFieldChange('name', e.target.value)}
                        placeholder="例如: 坚果云 WebDAV / 我的 NAS"
                        className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">存储引擎 / 服务类型</label>
                      <select 
                        value={editingProfile.preset === 'jianguoyun' ? 'JIANGUOYUN' : (editingProfile.type || 'WEBDAV')}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'JIANGUOYUN') {
                            setEditingProfile(prev => ({
                              ...(prev || {}),
                              type: 'WEBDAV',
                              preset: 'jianguoyun',
                              webDavUrl: 'https://dav.jianguoyun.com/dav/',
                              serverPath: 'CloudChat',
                              webDavFallbackUrl: '',
                              diaryBaseUrl: ''
                            }));
                          } else {
                            setEditingProfile(prev => ({
                              ...(prev || {}),
                              type: val,
                              preset: undefined
                            }));
                          }
                        }}
                        className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                      >
                        <option value="JIANGUOYUN">坚果云 WebDAV (快捷预设)</option>
                        <option value="WEBDAV">WebDAV (Nextcloud, NAS, 极空间等)</option>
                        <option value="S3">Amazon S3 / MinIO / 兼容对象存储</option>
                      </select>
                    </div>
                  </div>

                  {/* WebDAV Fields */}
                  {editingProfile.type === 'WEBDAV' && (
                    <div className="flex flex-col gap-4 animate-fade-in">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">WebDAV 服务器 URL 地址</label>
                        <input 
                          type="url" 
                          value={editingProfile.webDavUrl || ''}
                          onChange={(e) => handleFieldChange('webDavUrl', e.target.value)}
                          disabled={editingProfile.preset === 'jianguoyun'}
                          placeholder="https://nas.local:5006/dav"
                          className={`bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full ${
                            editingProfile.preset === 'jianguoyun' ? 'opacity-60 cursor-not-allowed' : ''
                          }`}
                        />
                      </div>

                      {/* 坚果云应用密码获取步骤提示 */}
                      {editingProfile.preset === 'jianguoyun' && (
                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs leading-relaxed flex items-start gap-2">
                          <i className="fa-solid fa-circle-info text-amber-400 mt-0.5 shrink-0 text-sm"></i>
                          <span>请按照此步骤获取应用密码：① 下载并安装坚果客户端；② 登录后前往 “设置” → “第三方应用管理” 进行关联获取密码。</span>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">
                            {editingProfile.preset === 'jianguoyun' ? '坚果云账号 (邮箱)' : 'WebDAV 用户名'}
                          </label>
                          <input 
                            type="text" 
                            value={editingProfile.webDavUser || ''}
                            onChange={(e) => handleFieldChange('webDavUser', e.target.value)}
                            placeholder={editingProfile.preset === 'jianguoyun' ? 'your_email@domain.com' : 'admin'}
                            className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">
                            {editingProfile.preset === 'jianguoyun' ? '坚果云应用密码' : 'WebDAV 密码'}
                          </label>
                          <input 
                            type="password" 
                            value={editingProfile.webDavPass || ''}
                            onChange={(e) => handleFieldChange('webDavPass', e.target.value)}
                            placeholder="••••••••"
                            className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">文件分块传输大小 (MB)</label>
                          <input 
                            type="number" 
                            value={editingProfile.webDavChunkSize !== undefined ? Math.round(editingProfile.webDavChunkSize / (1024 * 1024)) : 64}
                            onChange={(e) => handleFieldChange('webDavChunkSize', parseInt(e.target.value || '0') * 1024 * 1024)}
                            placeholder="64"
                            min="0"
                            className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                          />
                          <span className="text-[10px] text-textMuted mt-0.5">设为 0 表示禁用大文件分块传输。</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">WebDAV 局域网/回退地址 (可选)</label>
                          <input 
                            type="url" 
                            value={editingProfile.webDavFallbackUrl || ''}
                            onChange={(e) => handleFieldChange('webDavFallbackUrl', e.target.value)}
                            disabled={editingProfile.preset === 'jianguoyun'}
                            placeholder={editingProfile.preset === 'jianguoyun' ? '坚果云模式不可用' : 'http://192.168.1.100:5005/dav'}
                            className={`bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full ${
                              editingProfile.preset === 'jianguoyun' ? 'opacity-60 cursor-not-allowed' : ''
                            }`}
                          />
                        </div>
                      </div>

                      {/* Test Connection Button & Result */}
                      <div className="pt-1 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={handleTestConnection}
                          disabled={isTestingConn}
                          className="px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25 transition-all flex items-center justify-center gap-2 self-start"
                        >
                          {isTestingConn ? (
                            <>
                              <i className="fa-solid fa-spinner animate-spin text-xs"></i>
                              <span>正在测试服务器连通性...</span>
                            </>
                          ) : (
                            <>
                              <i className="fa-solid fa-bolt text-xs"></i>
                              <span>测试 WebDAV 服务器连接 (支持局域网 IP / HTTP / HTTPS)</span>
                            </>
                          )}
                        </button>

                        {testResult && (
                          <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 border ${
                            testResult.success 
                              ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                              : 'bg-red-500/10 border-red-500/30 text-red-400'
                          }`}>
                            <i className={`fa-solid ${testResult.success ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
                            <span>{testResult.message}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* S3 Fields */}
                  {editingProfile.type === 'S3' && (
                    <div className="flex flex-col gap-4 animate-fade-in">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Endpoint (可选，默认 AWS)</label>
                          <input 
                            type="text" 
                            value={editingProfile.endpoint || ''}
                            onChange={(e) => handleFieldChange('endpoint', e.target.value)}
                            placeholder="https://s3.amazonaws.com"
                            className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Bucket 名称</label>
                          <input 
                            type="text" 
                            value={editingProfile.bucket || ''}
                            onChange={(e) => handleFieldChange('bucket', e.target.value)}
                            placeholder="my-chat-bucket"
                            className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Region (区域)</label>
                          <input 
                            type="text" 
                            value={editingProfile.region || ''}
                            onChange={(e) => handleFieldChange('region', e.target.value)}
                            placeholder="us-east-1"
                            className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Access Key ID</label>
                          <input 
                            type="text" 
                            value={editingProfile.accessKey || ''}
                            onChange={(e) => handleFieldChange('accessKey', e.target.value)}
                            placeholder="AKIA..."
                            className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Secret Access Key</label>
                          <input 
                            type="password" 
                            value={editingProfile.secretKey || ''}
                            onChange={(e) => handleFieldChange('secretKey', e.target.value)}
                            placeholder="••••••••"
                            className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Path prefixes */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">服务器根路径前缀</label>
                      <input 
                        type="text" 
                        value={editingProfile.serverPath || ''}
                        onChange={(e) => handleFieldChange('serverPath', e.target.value)}
                        disabled={editingProfile.preset === 'jianguoyun'}
                        placeholder="CloudChat"
                        className={`bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full ${
                          editingProfile.preset === 'jianguoyun' ? 'opacity-60 cursor-not-allowed' : ''
                        }`}
                      />
                      <span className="text-[10px] text-textMuted mt-0.5">
                        {editingProfile.preset === 'jianguoyun' ? '坚果云固定锁定为 CloudChat' : '服务器根目录下的子文件夹名称'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">用户隔离存储目录</label>
                      <input 
                        type="text" 
                        value={editingProfile.saveDir || ''}
                        onChange={(e) => handleFieldChange('saveDir', e.target.value)}
                        placeholder="user_default"
                        className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                      />
                      <span className="text-[10px] text-textMuted mt-0.5">区分多账号的独立子目录。</span>
                    </div>
                  </div>

                  {/* Diary Base URL / Public Root URL */}
                  <div className="flex flex-col gap-1.5 border-t border-borderColor/40 pt-3">
                    <label className="text-xs font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                      <i className="fa-solid fa-globe text-cyan-400"></i> 日记对外访问根 URL (Diary Base URL)
                    </label>
                    <input 
                      type="url" 
                      value={editingProfile.diaryBaseUrl || ''}
                      onChange={(e) => handleFieldChange('diaryBaseUrl', e.target.value)}
                      disabled={editingProfile.preset === 'jianguoyun'}
                      placeholder={editingProfile.preset === 'jianguoyun' ? '坚果云模式不可用' : '例如: https://diary.example.com 或 https://mywebdav.com/chat/save/'}
                      className={`bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 transition-colors w-full ${
                        editingProfile.preset === 'jianguoyun' ? 'opacity-60 cursor-not-allowed' : ''
                      }`}
                    />
                    <span className="text-[10px] text-textMuted mt-0.5">
                      配置 WebDAV/S3 映射的 Web 访问绝对根域名。日记生成后自动拼接公开访问链接（留空时默认使用服务器文件原始 URL）。
                    </span>
                  </div>

                  {/* Username & Sync interval */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">聊天昵称</label>
                      <input 
                        type="text" 
                        value={editingProfile.username || ''}
                        onChange={(e) => handleFieldChange('username', e.target.value)}
                        placeholder="我"
                        className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">自动同步间隔 (秒)</label>
                      <input 
                        type="number" 
                        value={editingProfile.syncInterval || 5}
                        onChange={(e) => handleFieldChange('syncInterval', parseInt(e.target.value || '5'))}
                        placeholder="5"
                        min="2"
                        className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                      />
                    </div>
                  </div>

                  {/* Avatar Setting Section */}
                  <div className="flex flex-col gap-2.5 border-t border-borderColor/40 pt-3">
                    <label className="text-xs font-semibold text-textSecondary uppercase tracking-wider flex items-center gap-1.5">
                      <i className="fa-solid fa-user-gear text-accentColor"></i> 个人头像设置
                    </label>

                    <div className="flex items-center gap-4 py-1">
                      <div className="relative group shrink-0">
                        <img 
                          src={
                            previewUrl || 
                            getInitialAvatar(editingProfile.username || 'User')
                          } 
                          alt="Avatar Preview"
                          className="w-14 h-14 rounded-2xl object-cover border-2 border-accentColor/40 bg-bgPrimary shadow-md"
                        />
                        <label className="absolute inset-0 bg-black/50 rounded-2xl opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity text-white text-xs font-semibold">
                          <i className="fa-solid fa-camera"></i>
                          <input type="file" accept="image/*" className="hidden" onChange={handleCustomAvatarSelect} />
                        </label>
                      </div>

                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <label className="px-3 py-1.5 bg-bgPrimary border border-borderColor hover:border-accentColor text-textPrimary text-xs rounded-lg cursor-pointer transition-all flex items-center gap-1.5 font-medium">
                            <i className="fa-solid fa-image text-accentColor"></i> 选择本地图片做头像
                            <input type="file" accept="image/*" className="hidden" onChange={handleCustomAvatarSelect} />
                          </label>
                        </div>
                        <p className="text-[10px] text-textMuted">支持上传自定义 PNG/JPG/SVG 本地图片</p>
                      </div>
                    </div>

                    {/* Preset Avatars Grid */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[11px] font-medium text-textMuted">系统内置精美头像：</span>
                      <div className="grid grid-cols-5 gap-2">
                        {PRESET_AVATARS.map((url, idx) => (
                          <img 
                            key={idx}
                            src={url} 
                            alt={`Preset ${idx + 1}`}
                            onClick={() => handleFieldChange('avatar', url)}
                            className={`w-10 h-10 rounded-xl object-cover cursor-pointer border-2 transition-all hover:scale-105 ${
                              editingProfile.avatar === url ? 'border-accentColor ring-2 ring-accentColor/30 shadow-lg scale-105' : 'border-borderColor/60 hover:border-textMuted'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-bgPrimary/30 border-t border-borderColor flex justify-end gap-3">
          <button 
            className="px-4 py-2 text-sm font-medium text-textSecondary hover:bg-white/5 rounded-lg transition-colors border border-borderColor"
            onClick={onClose}
          >
            取消
          </button>
          <button 
            className="px-5 py-2 text-sm font-semibold text-white bg-accentColor hover:bg-accentHover rounded-lg transition-colors shadow-lg shadow-accentColor/10"
            onClick={handleSave}
          >
            保存配置方案
          </button>
        </div>

      </div>
    </div>
  );
}
