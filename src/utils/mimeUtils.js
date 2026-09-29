export const MIME_MAP = {
  // Images
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'bmp': 'image/bmp',
  'svg': 'image/svg+xml',
  'ico': 'image/x-icon',
  'heic': 'image/heic',
  'heif': 'image/heif',
  'tif': 'image/tiff',
  'tiff': 'image/tiff',

  // Videos
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'mov': 'video/quicktime',
  'mkv': 'video/x-matroska',
  'avi': 'video/x-msvideo',
  'm4v': 'video/x-m4v',
  'flv': 'video/x-flv',
  '3gp': 'video/3gpp',

  // Audio
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'ogg': 'audio/ogg',
  'm4a': 'audio/mp4',
  'flac': 'audio/flac',
  'aac': 'audio/aac',
  'wma': 'audio/x-ms-wma',

  // Documents
  'pdf': 'application/pdf',
  'txt': 'text/plain',
  'log': 'text/plain',
  'md': 'text/markdown',
  'json': 'application/json',
  'xml': 'application/xml',
  'html': 'text/html',
  'htm': 'text/html',
  'css': 'text/css',
  'js': 'application/javascript',
  'jsx': 'text/plain',
  'ts': 'text/plain',
  'tsx': 'text/plain',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt': 'application/vnd.ms-powerpoint',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Archives & Executables
  'zip': 'application/zip',
  'rar': 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  'tar': 'application/x-tar',
  'gz': 'application/gzip',
  'apk': 'application/vnd.android.package-archive',
  'exe': 'application/x-msdownload'
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'heic', 'heif', 'tif', 'tiff']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'flv', '3gp']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma']);

export function getFileExtension(fileName = '') {
  if (!fileName || typeof fileName !== 'string') return '';
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) return '';
  return fileName.substring(lastDot + 1).toLowerCase();
}

export function getMimeType(fileName = '', fallback = 'application/octet-stream') {
  const ext = getFileExtension(fileName);
  return MIME_MAP[ext] || fallback;
}

export function isImageFile(fileOrName) {
  if (!fileOrName) return false;
  if (typeof fileOrName === 'string') {
    const ext = getFileExtension(fileOrName);
    return IMAGE_EXTS.has(ext);
  }
  if (fileOrName.type && fileOrName.type.startsWith('image/')) return true;
  const ext = getFileExtension(fileOrName.name);
  return IMAGE_EXTS.has(ext);
}

export function isVideoFile(fileOrName) {
  if (!fileOrName) return false;
  if (typeof fileOrName === 'string') {
    const ext = getFileExtension(fileOrName);
    return VIDEO_EXTS.has(ext);
  }
  if (fileOrName.type && fileOrName.type.startsWith('video/')) return true;
  const ext = getFileExtension(fileOrName.name);
  return VIDEO_EXTS.has(ext);
}

export function isAudioFile(fileOrName) {
  if (!fileOrName) return false;
  if (typeof fileOrName === 'string') {
    const ext = getFileExtension(fileOrName);
    return AUDIO_EXTS.has(ext);
  }
  if (fileOrName.type && fileOrName.type.startsWith('audio/')) return true;
  const ext = getFileExtension(fileOrName.name);
  return AUDIO_EXTS.has(ext);
}

export function getMessageType(file) {
  if (isImageFile(file)) return 'IMAGE';
  if (isVideoFile(file)) return 'VIDEO';
  if (isAudioFile(file)) return 'AUDIO';
  return 'FILE';
}

/**
 * Ensures the File object has a correct MIME type according to its name/extension.
 * Fixes drag-and-drop and binary-loaded files where type might be generic application/octet-stream or empty.
 */
export function ensureProperFile(file) {
  if (!file) return file;
  const currentType = file.type || '';
  if (!currentType || currentType === 'application/octet-stream') {
    const properType = getMimeType(file.name, currentType || 'application/octet-stream');
    if (properType !== currentType) {
      try {
        return new File([file], file.name, { type: properType, lastModified: file.lastModified || Date.now() });
      } catch (e) {
        return file;
      }
    }
  }
  return file;
}
