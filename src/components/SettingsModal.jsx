import React, { useState, useEffect } from 'react';

const PRESET_AVATARS = [
  'https://api.dicebear.com/7.x/bottts/png?seed=Felix',
  'https://api.dicebear.com/7.x/bottts/png?seed=Aria',
  'https://api.dicebear.com/7.x/bottts/png?seed=Zack',
  'https://api.dicebear.com/7.x/bottts/png?seed=Luna',
  'https://api.dicebear.com/7.x/bottts/png?seed=Leo',
  'https://api.dicebear.com/7.x/bottts/png?seed=Maya',
  'https://api.dicebear.com/7.x/bottts/png?seed=Milo',
  'https://api.dicebear.com/7.x/bottts/png?seed=Nova',
  'https://api.dicebear.com/7.x/bottts/png?seed=Kira',
  'https://api.dicebear.com/7.x/bottts/png?seed=Orion'
];

export default function SettingsModal({ 
  isOpen, 
  profiles, 
  activeProfileId, 
  onClose, 
  onSaveProfile, 
  onDeleteProfile,
  onSwitchProfile,
  storageClient
}) {
  const [editingProfile, setEditingProfile] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    const active = profiles.find(p => p.id === activeProfileId) || profiles[0] || null;
    if (active) {
      setEditingProfile({ ...active });
    } else {
      handleInitNewProfile();
    }
  }, [isOpen, profiles, activeProfileId]);

  if (!isOpen) return null;

  const handleInitNewProfile = () => {
    setEditingProfile({
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
  };

  const handleProfileSelectChange = (e) => {
    const pId = e.target.value;
    onSwitchProfile(pId);
  };

  const handleFieldChange = (field, val) => {
    setEditingProfile(prev => ({
      ...prev,
      [field]: val
    }));
  };

  const handleCustomAvatarSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // Compress to 128x128 square JPEG for a good quality avatar
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
      // Store as data URL temporarily; on save it will be uploaded to WebDAV
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      handleFieldChange('avatar', dataUrl);
      handleFieldChange('_avatarPendingUpload', true);
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  };

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const handleSave = async () => {
    if (!editingProfile.name.trim()) return;

    let profileToSave = { ...editingProfile };
    delete profileToSave._avatarPendingUpload;

    // If avatar is a data URL and a WebDAV client is available, upload it
    if (editingProfile._avatarPendingUpload && editingProfile.avatar?.startsWith('data:') && storageClient) {
      try {
        setIsUploadingAvatar(true);
        // Use display username as the unique key — multiple people sharing one WebDAV
        // account are distinguished by their username field, not webDavUser (which is shared).
        // Sanitize to strip characters invalid in filenames.
        const userKey = (editingProfile.username || editingProfile.webDavUser || editingProfile.saveDir || editingProfile.id || 'user')
          .replace(/[^a-zA-Z0-9_\-]/g, '_');
        const avatarFileName = `avatar_${userKey}.jpg`;
        const res = await fetch(editingProfile.avatar);
        const blob = await res.blob();
        await storageClient.uploadFile(blob, avatarFileName, 'image/jpeg');
        // Store ONLY the filename, not a WebDAV URL.
        // resolveAvatarUrl() will download it via the storage client (with auth) when needed.
        profileToSave.avatar = avatarFileName;
      } catch (err) {
        console.warn('Avatar upload failed, keeping data URL:', err);
        // Keep the data: URL as fallback — safe to display, just not shared
      } finally {
        setIsUploadingAvatar(false);
      }
    }

    onSaveProfile(profileToSave);
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete profile "${editingProfile.name}"?`)) {
      onDeleteProfile(editingProfile.id);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto animate-fade-in">
      <div className="bg-bgSecondary border border-borderColor rounded-xl w-full max-w-lg shadow-2xl scale-in my-8">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-borderColor flex justify-between items-center">
          <h2 className="text-textPrimary font-semibold text-lg flex items-center gap-2">
            <i className="fa-solid fa-server text-accentColor"></i> Storage Settings
          </h2>
          <button onClick={onClose} className="text-textMuted hover:text-textPrimary transition-colors">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[70vh] overflow-y-auto flex flex-col gap-5">
          
          {/* Profile Switcher */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-textSecondary uppercase tracking-wider">Active Profile</label>
            <div className="flex gap-2">
              <select 
                value={activeProfileId || ''} 
                onChange={handleProfileSelectChange}
                className="flex-1 bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors"
              >
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                {profiles.length === 0 && <option value="">No Profiles - Click New Profile</option>}
              </select>
              {profiles.length > 0 && (
                <button 
                  onClick={handleDelete}
                  className="px-3.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 rounded-lg transition-all"
                  title="Delete Profile"
                >
                  <i className="fa-regular fa-trash-can"></i>
                </button>
              )}
              <button 
                onClick={handleInitNewProfile}
                className="px-3 py-2 bg-accentColor hover:bg-accentHover text-white font-medium rounded-lg text-sm transition-all flex items-center gap-1"
              >
                <i className="fa-solid fa-plus"></i> New
              </button>
            </div>
          </div>

          <hr className="border-borderColor" />

          {editingProfile && (
            <div className="flex flex-col gap-4">
              {/* Form Nickname & Storage Type */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Profile Nickname</label>
                  <input 
                    type="text" 
                    value={editingProfile.name || ''}
                    onChange={(e) => handleFieldChange('name', e.target.value)}
                    placeholder="e.g. My Synology WebDAV"
                    className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Storage Engine</label>
                  <select 
                    value={editingProfile.preset === 'jianguoyun' ? 'JIANGUOYUN' : (editingProfile.type || 'WEBDAV')}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'JIANGUOYUN') {
                        setEditingProfile(prev => ({
                          ...prev,
                          type: 'WEBDAV',
                          preset: 'jianguoyun',
                          webDavUrl: 'https://dav.jianguoyun.com/dav/',
                          serverPath: 'CloudChat'
                        }));
                      } else {
                        setEditingProfile(prev => ({
                          ...prev,
                          type: val,
                          preset: undefined
                        }));
                      }
                    }}
                    className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                  >
                    <option value="JIANGUOYUN">坚果云 WebDAV (Jianguoyun Preset)</option>
                    <option value="WEBDAV">WebDAV (Nextcloud, NAS, etc.)</option>
                    <option value="S3">Amazon S3 / MinIO / Object Storage</option>
                  </select>
                </div>
              </div>

              {/* WebDAV Fields */}
              {editingProfile.type === 'WEBDAV' && (
                <div className="flex flex-col gap-4 animate-fade-in">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">WebDAV Server URL</label>
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
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">
                        {editingProfile.preset === 'jianguoyun' ? '坚果云账号 (邮箱)' : 'Username'}
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
                        {editingProfile.preset === 'jianguoyun' ? '坚果云应用密码' : 'Password'}
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
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Chunk Size (MB)</label>
                      <input 
                        type="number" 
                        value={editingProfile.webDavChunkSize !== undefined ? (editingProfile.webDavChunkSize / (1024 * 1024)) : 64}
                        onChange={(e) => handleFieldChange('webDavChunkSize', parseInt(e.target.value || '0') * 1024 * 1024)}
                        placeholder="64"
                        min="0"
                        className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                      />
                      <span className="text-[10px] text-textMuted mt-0.5">Set to 0 to disable chunking.</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Fallback URL (Optional)</label>
                      <input 
                        type="url" 
                        value={editingProfile.webDavFallbackUrl || ''}
                        onChange={(e) => handleFieldChange('webDavFallbackUrl', e.target.value)}
                        placeholder="https://backup-nas.local:5006/dav"
                        className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* S3 Fields */}
              {editingProfile.type === 'S3' && (
                <div className="flex flex-col gap-4 animate-fade-in">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">S3 Endpoint URL</label>
                    <input 
                      type="url" 
                      value={editingProfile.endpoint || ''}
                      onChange={(e) => handleFieldChange('endpoint', e.target.value)}
                      placeholder="https://s3.us-east-1.amazonaws.com"
                      className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Bucket Name</label>
                      <input 
                        type="text" 
                        value={editingProfile.bucket || ''}
                        onChange={(e) => handleFieldChange('bucket', e.target.value)}
                        placeholder="my-bucket"
                        className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Region (Optional)</label>
                      <input 
                        type="text" 
                        value={editingProfile.region || ''}
                        onChange={(e) => handleFieldChange('region', e.target.value)}
                        placeholder="us-east-1"
                        className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
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
                  <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Server Path Prefix</label>
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
                    {editingProfile.preset === 'jianguoyun' ? 'Solidified to CloudChat' : 'Subfolder on server root.'}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">User Directory</label>
                  <input 
                    type="text" 
                    value={editingProfile.saveDir || ''}
                    onChange={(e) => handleFieldChange('saveDir', e.target.value)}
                    placeholder="user_default"
                    className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                  />
                  <span className="text-[10px] text-textMuted mt-0.5">Isolated directory for this profile.</span>
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
                  placeholder="例如: https://diary.example.com 或 https://mywebdav.com/chat/save/"
                  className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 transition-colors w-full"
                />
                <span className="text-[10px] text-textMuted mt-0.5">
                  配置 WebDAV/S3 映射的 Web 访问绝对根域名。日记生成后自动拼接公开访问链接（留空时默认使用服务器文件原始 URL）。
                </span>
              </div>

              {/* Username & Sync interval */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Your Nickname in Chat</label>
                  <input 
                    type="text" 
                    value={editingProfile.username || ''}
                    onChange={(e) => handleFieldChange('username', e.target.value)}
                    placeholder="Me"
                    className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Sync Interval (seconds)</label>
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
                  <i className="fa-solid fa-user-gear text-accentColor"></i> 个人头像设置 (User Avatar)
                </label>

                <div className="flex items-center gap-4 py-1">
                  <div className="relative group shrink-0">
                    <img 
                      src={editingProfile.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(editingProfile.username || 'User')}`} 
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

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-bgPrimary/30 border-t border-borderColor flex justify-end gap-3">
          <button 
            className="px-4 py-2 text-sm font-medium text-textSecondary hover:bg-white/5 rounded-lg transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button 
            className="px-5 py-2 text-sm font-semibold text-white bg-accentColor hover:bg-accentHover rounded-lg transition-colors shadow-lg shadow-accentColor/10"
            onClick={handleSave}
          >
            Save & Apply
          </button>
        </div>

      </div>
    </div>
  );
}
