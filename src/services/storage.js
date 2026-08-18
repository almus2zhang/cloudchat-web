import CryptoJS from 'crypto-js';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

function logDebug(msg) {
    if (typeof window !== 'undefined' && window.__addDebugLog) {
        window.__addDebugLog(msg);
    }
}

// Safe fetch wrapper with timeout (uses native Rust HTTP fetch when running under Tauri to bypass CORS)
export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const combinedSignal = options.signal || controller.signal;

    const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
    const fetchImpl = isTauri ? tauriFetch : window.fetch.bind(window);

    const method = options.method || 'GET';
    const fileName = url.split('?')[0].split('/').pop();
    logDebug(`[HTTP] ${method} ${fileName}`);

    try {
        const response = await fetchImpl(url, { ...options, signal: combinedSignal });
        clearTimeout(timeoutId);
        logDebug(`[HTTP] ${method} ${fileName} -> Status ${response.status} (${response.statusText || 'OK'})`);
        return response;
    } catch (err) {
        clearTimeout(timeoutId);
        logDebug(`[HTTP FAIL] ${method} ${fileName} -> ${err.message || err}`);
        if (err.name === 'AbortError') {
            throw new Error(`网络请求超时 (${Math.round(timeoutMs / 1000)}秒)`);
        }
        throw err;
    }
}

// Download progress helper: reads a fetch Response body with progress callbacks
// Supports pause/cancel via dlState object
export async function readResponseWithProgress(response, onProgress, dlState) {
    const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
    const reader = response.body?.getReader();
    
    // Fallback if ReadableStream is not available
    if (!reader) {
        const blob = await response.blob();
        if (onProgress) onProgress(blob.size, blob.size);
        return blob;
    }
    
    const chunks = [];
    let loaded = 0;
    
    while (true) {
        // Wait if paused
        if (dlState && dlState.isPaused) {
            await dlState.waitForResume();
        }
        // Check cancel
        if (dlState && dlState.isCancelled) {
            await reader.cancel();
            throw new DOMException('Download cancelled', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (onProgress) onProgress(loaded, contentLength);
    }
    
    return new Blob(chunks);
}

// Creates a download state controller for pause/cancel
export function createDownloadState() {
    const state = {
        controller: new AbortController(),
        isPaused: false,
        isCancelled: false,
        _resumeResolve: null,
        _pausePromise: null,
        pause() {
            this.isPaused = true;
            this._pausePromise = new Promise(resolve => { this._resumeResolve = resolve; });
        },
        resume() {
            this.isPaused = false;
            if (this._resumeResolve) {
                this._resumeResolve();
                this._resumeResolve = null;
                this._pausePromise = null;
            }
        },
        cancel() {
            this.isCancelled = true;
            this.controller.abort();
            this.resume(); // unblock if paused
        },
        async waitForResume() {
            if (this._pausePromise) await this._pausePromise;
        }
    };
    return state;
}

// AWS V4 Signer helper using CryptoJS
export function signS3Request(method, urlString, config, headers = {}, payloadHash = null) {
    const url = new URL(urlString);
    const accessKey = config.accessKey;
    const secretKey = config.secretKey;
    const region = config.endpoint.includes('amazonaws.com') 
        ? url.hostname.split('.')[1] 
        : (config.region || 'us-east-1');
    const service = 's3';

    const amzDate = new Date().toISOString().replace(/[:\-]/g, '').substring(0, 15) + 'Z';
    const dateStamp = amzDate.substring(0, 8);

    headers['Host'] = url.host;
    headers['x-amz-date'] = amzDate;
    if (payloadHash === null) {
        payloadHash = 'UNSIGNED-PAYLOAD';
    }
    headers['x-amz-content-sha256'] = payloadHash;

    const canonicalUri = url.pathname;
    // Sort query parameters
    const queryParams = [];
    url.searchParams.forEach((value, key) => {
        queryParams.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    queryParams.sort();
    const canonicalQueryString = queryParams.join('&');

    // Canonical headers (lowercase name + sorted)
    const canonicalHeadersArr = [];
    const signedHeadersArr = [];
    Object.keys(headers).forEach(key => {
        const lowerKey = key.toLowerCase();
        canonicalHeadersArr.push(lowerKey + ':' + headers[key].trim());
        signedHeadersArr.push(lowerKey);
    });
    canonicalHeadersArr.sort();
    signedHeadersArr.sort();

    const canonicalHeaders = canonicalHeadersArr.join('\n') + '\n';
    const signedHeaders = signedHeadersArr.join(';');

    const canonicalRequest = [
        method,
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');

    const credentialScope = [dateStamp, region, service, 'aws4_request'].join('/');
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        CryptoJS.SHA256(canonicalRequest).toString(CryptoJS.enc.Hex)
    ].join('\n');

    // Cryptographic signature keys
    const kDate = CryptoJS.HmacSHA256(dateStamp, 'AWS4' + secretKey);
    const kRegion = CryptoJS.HmacSHA256(region, kDate);
    const kService = CryptoJS.HmacSHA256(service, kRegion);
    const kSigning = CryptoJS.HmacSHA256('aws4_request', kService);

    const signature = CryptoJS.HmacSHA256(stringToSign, kSigning).toString(CryptoJS.enc.Hex);
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    
    headers['Authorization'] = authorization;
    return headers;
}

// Storage Client Implementations
export class StorageClient {
    static create(config) {
        if (config.type === 'WEBDAV') {
            return new WebDavStorageClient(config);
        } else {
            return new S3StorageClient(config);
        }
    }
}

class WebDavStorageClient {
    constructor(config) {
        this.config = config;
        this.type = 'WEBDAV';
    }

    getAuthHeader() {
        const creds = btoa(`${this.config.webDavUser}:${this.config.webDavPass}`);
        return `Basic ${creds}`;
    }

    async ensureDirectoriesExist() {
        const baseUrl = this.config.webDavUrl.replace(/\/+$/, '');
        const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
        const userDirClean = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');

        const parts = [];
        if (root) parts.push(root);
        if (userDirClean) parts.push(userDirClean);

        if (parts.length === 0) return;

        let currentPath = '';
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const folderUrl = `${baseUrl}/${currentPath}`;
            try {
                // Check if directory exists to avoid 405 MKCOL warning
                const propRes = await fetch(folderUrl, {
                    method: 'PROPFIND',
                    headers: { 'Authorization': this.getAuthHeader(), 'Depth': '0' }
                });
                if (propRes.ok) continue;
            } catch(e) {}

            try {
                const res = await fetch(folderUrl, {
                    method: 'MKCOL',
                    headers: { 'Authorization': this.getAuthHeader() }
                });
                if (!res.ok && res.status !== 405 && res.status !== 302) {
                    console.warn(`Failed to create directory level: ${folderUrl}, status: ${res.status}`);
                }
            } catch (e) {
                console.error(`Error ensuring directory: ${folderUrl}`, e);
            }
        }
    }

    async ensureFolderPathExist(subPath) {
        const baseUrl = this.config.webDavUrl.replace(/\/+$/, '');
        const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
        const userDirClean = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');

        const parts = [];
        if (root) root.split('/').filter(Boolean).forEach(p => parts.push(p));
        if (userDirClean) userDirClean.split('/').filter(Boolean).forEach(p => parts.push(p));
        if (subPath) {
            subPath.split('/').filter(Boolean).forEach(p => parts.push(p));
        }

        if (parts.length === 0) return;

        let currentPath = '';
        for (const part of parts) {
            const encodedPart = encodeURIComponent(part);
            currentPath = currentPath ? `${currentPath}/${encodedPart}` : encodedPart;
            const folderUrl = `${baseUrl}/${currentPath}`;
            try {
                const propRes = await fetch(folderUrl, {
                    method: 'PROPFIND',
                    headers: { 'Authorization': this.getAuthHeader(), 'Depth': '0' }
                });
                if (propRes.ok) continue;
            } catch(e) {}

            try {
                await fetch(folderUrl, {
                    method: 'MKCOL',
                    headers: { 'Authorization': this.getAuthHeader() }
                });
            } catch (e) {}
        }
    }

    getUrl(fileName) {
        if (!fileName) return '';
        if (typeof fileName === 'string' && (fileName.startsWith('http://') || fileName.startsWith('https://'))) {
            return fileName;
        }
        const baseUrl = this.config.webDavUrl.replace(/\/+$/, '');
        const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
        const userDirClean = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');

        const parts = [];
        if (root) root.split('/').filter(Boolean).forEach(p => parts.push(encodeURIComponent(p)));
        if (userDirClean) userDirClean.split('/').filter(Boolean).forEach(p => parts.push(encodeURIComponent(p)));
        if (fileName) {
            fileName.split('/').filter(Boolean).forEach(p => parts.push(encodeURIComponent(p)));
        }

        return `${baseUrl}/${parts.join('/')}`;
    }

    async uploadFile(file, fileName, contentType, onProgress) {
        const url = this.getUrl(fileName);
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url, true);
            xhr.setRequestHeader('Authorization', this.getAuthHeader());
            xhr.setRequestHeader('Content-Type', contentType);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    const progress = Math.round((e.loaded / e.total) * 100);
                    onProgress(progress);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(url);
                } else {
                    reject(new Error(`Upload failed: ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.send(file);
        });
    }

    async uploadFileRange(fileChunk, fileName, contentType, startByte, endByte, totalLength, onProgress) {
        const url = this.getUrl(fileName);
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url, true);
            xhr.setRequestHeader('Authorization', this.getAuthHeader());
            xhr.setRequestHeader('Content-Type', contentType);
            xhr.setRequestHeader('Content-Range', `bytes ${startByte}-${endByte}/${totalLength}`);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    const progress = Math.round((e.loaded / e.total) * 100);
                    onProgress(progress);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(url);
                } else {
                    reject(new Error(`Range upload failed: ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error during range upload'));
            xhr.send(fileChunk);
        });
    }

    async uploadText(content, fileName) {
        const url = this.getUrl(fileName);
        const response = await fetchWithTimeout(url, {
            method: 'PUT',
            headers: {
                'Authorization': this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: content
        }, 12000);
        if (!response.ok) throw new Error(`Upload text failed: ${response.status}`);
        return url;
    }

    async downloadFile(fileName) {
        const url = this.getUrl(fileName);
        const response = await fetchWithTimeout(url, {
            headers: { 'Authorization': this.getAuthHeader() }
        }, 20000);
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        return await response.blob();
    }

    async downloadText(fileName) {
        const url = this.getUrl(fileName);
        const response = await fetchWithTimeout(url, {
            headers: { 'Authorization': this.getAuthHeader() }
        }, 20000);
        if (!response.ok) throw new Error(`Download text failed: ${response.status}`);
        return await response.text();
    }

    async downloadFileWithProgress(fileName, onProgress, dlState) {
        const url = this.getUrl(fileName);
        const response = await fetchWithTimeout(url, {
            headers: { 'Authorization': this.getAuthHeader() },
            signal: dlState?.controller?.signal
        }, 60000);
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        return await readResponseWithProgress(response, onProgress, dlState);
    }

    // 校验文件名安全：拒绝空、绝对路径、路径穿越(..)、保留名及非法字符。
    // 允许单层子路径（如 "subDir/index.html"），但每段都必须是合法单段名。
    validateSafeName(name) {
        if (!name || typeof name !== 'string') return false;
        const trimmed = name.trim();
        if (!trimmed || trimmed.length > 255) return false;
        if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return false;
        const segs = trimmed.split('/');
        for (const seg of segs) {
            if (seg === '' || seg === '.' || seg === '..') return false;
            if (/[\\?#%\u0000]/.test(seg)) return false;
        }
        return true;
    }

    // 校验「设定的用户目录」（serverPath 各段 + saveDir 各段）是否安全：
    // 仅允许数字、字母、下划线、连字符，不能有其他字符。
    isValidUserDir() {
        const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
        const userDir = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');
        const segs = [];
        if (root) root.split('/').filter(Boolean).forEach(s => segs.push(s));
        if (userDir) userDir.split('/').filter(Boolean).forEach(s => segs.push(s));
        if (segs.length === 0) return false;
        const valid = /^[a-zA-Z0-9_-]+$/;
        return segs.every(s => s.length <= 255 && valid.test(s) && s !== '.' && s !== '..');
    }

    async deleteFile(fileName) {
        if (!this.isValidUserDir()) {
            console.error('WebDAV deleteFile: refusing, user directory is invalid (must be alphanumeric/_- only)');
            return;
        }
        if (!this.validateSafeName(fileName)) {
            console.error('WebDAV deleteFile: refusing unsafe fileName:', fileName);
            return;
        }
        const url = this.getUrl(fileName);
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': this.getAuthHeader() }
        });
        if (!response.ok && response.status !== 404) {
            throw new Error(`Delete failed: ${response.status}`);
        }
    }

    // 删除 diary 目录下的日记文件。fileName 可能为 "subDir/index.html" 或 "xxx.html"
    // 安全策略：永不物理删除，只移动到 recycle_bin 回收站（目录连同内容一并移入）。
    async deleteDiaryFile(fileName) {
        // 移动/删除仅限设定的用户目录内
        if (!this.isValidUserDir()) {
            console.error('WebDAV deleteDiaryFile: refusing, user directory is invalid (must be alphanumeric/_- only)');
            throw new Error('非法的用户目录名');
        }
        // 安全校验：拒绝空、路径穿越、绝对路径、非法字符
        if (!this.validateSafeName(fileName)) {
            console.error('WebDAV deleteDiaryFile: refusing unsafe fileName:', fileName);
            throw new Error('非法的日记文件名');
        }
        const baseUrl = this.config.webDavUrl.replace(/\/+$/, '');
        const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
        const userDirClean = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');

        const parts = [];
        if (root) root.split('/').filter(Boolean).forEach(p => parts.push(encodeURIComponent(p)));
        if (userDirClean) userDirClean.split('/').filter(Boolean).forEach(p => parts.push(encodeURIComponent(p)));
        const currentBaseUrl = `${baseUrl}/${parts.join('/')}/`.replace(/\/+$/, '/');
        const recycleBinUrl = `${currentBaseUrl}recycle_bin`;

        // 1. 确保 recycle_bin 存在
        try {
            const propRes = await fetch(recycleBinUrl, {
                method: 'PROPFIND',
                headers: { 'Authorization': this.getAuthHeader(), 'Depth': '0' }
            });
            if (!propRes.ok) {
                await fetch(recycleBinUrl, {
                    method: 'MKCOL',
                    headers: { 'Authorization': this.getAuthHeader() }
                });
            }
        } catch (e) {
            // ignore
        }

        // 2. 取第一段：子目录形式删除整个子目录，单文件形式删除单文件
        const segs = fileName.trim().split('/').filter(Boolean);
        if (segs.length === 0) return;
        const targetName = encodeURIComponent(segs[0]);
        // 源 URL：diary/<targetName>（目录或文件）
        const sourceUrl = `${currentBaseUrl}diary/${targetName}`;
        const recycledName = `${Date.now()}_${segs[0]}`;
        const destUrl = `${recycleBinUrl}/${encodeURIComponent(recycledName)}`;

        // 3. MOVE 到回收站（目录连同内容一并移动，不区分是否为空）
        try {
            const response = await fetch(sourceUrl, {
                method: 'MOVE',
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Destination': destUrl
                }
            });
            if (!response.ok && response.status !== 404) {
                throw new Error(`MOVE diary to recycle_bin failed: ${response.status}`);
            }
        } catch (e) {
            console.error('WebDAV deleteDiaryFile MOVE failed:', e);
            throw e;
        }
    }

    async recycleFile(fileName) {
        if (!this.isValidUserDir()) {
            console.error('WebDAV recycleFile: refusing, user directory is invalid (must be alphanumeric/_- only)');
            return;
        }
        if (!this.validateSafeName(fileName)) {
            console.error('WebDAV recycleFile: refusing unsafe fileName:', fileName);
            return;
        }
        const baseUrl = this.config.webDavUrl.replace(/\/+$/, '');
        const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
        const userDirClean = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');

        const parts = [];
        if (root) parts.push(root);
        if (userDirClean) parts.push(userDirClean);

        const currentBaseUrl = `${baseUrl}/${parts.join('/')}/`.replace(/\/+$/, '/');
        const recycleBinUrl = `${currentBaseUrl}recycle_bin`;

        // 1. Establish recycle_bin folder (MKCOL)
        try {
            const propRes = await fetch(recycleBinUrl, {
                method: 'PROPFIND',
                headers: { 'Authorization': this.getAuthHeader(), 'Depth': '0' }
            });
            if (!propRes.ok) {
                await fetch(recycleBinUrl, {
                    method: 'MKCOL',
                    headers: { 'Authorization': this.getAuthHeader() }
                });
            }
        } catch (e) {
            // ignore
        }

        // 2. MOVE deleted file into recycle bin
        const baseName = fileName.split('/').pop();
        const sourceUrl = this.getUrl(fileName);
        const recycledFileName = `${Date.now()}_${baseName}`;
        const destUrl = `${currentBaseUrl}recycle_bin/${encodeURIComponent(recycledFileName)}`;

        try {
            const response = await fetch(sourceUrl, {
                method: 'MOVE',
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Destination': destUrl
                }
            });
            if (!response.ok && response.status !== 404) {
                await this.deleteFile(fileName);
            }
        } catch (e) {
            await this.deleteFile(fileName);
        }
    }

    async copyFile(sourceFileName, destSubPath) {
        const sourceUrl = this.getUrl(sourceFileName);
        const destUrl = this.getUrl(destSubPath);
        try {
            const response = await fetch(sourceUrl, {
                method: 'COPY',
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Destination': destUrl,
                    'Overwrite': 'T'
                }
            });
            if (response.ok) return true;
        } catch (e) {
            console.warn('WebDAV COPY failed:', e);
        }
        return false;
    }

    async getFileSize(fileName) {
        const url = this.getUrl(fileName);
        try {
            const response = await fetchWithTimeout(url, {
                method: 'HEAD',
                headers: { 'Authorization': this.getAuthHeader() }
            }, 8000);
            if (response.ok) {
                return parseInt(response.headers.get('Content-Length') || '-1');
            }
        } catch (e) {}
        return -1;
    }

    async getLastModified(fileName) {
        const url = this.getUrl(fileName);
        try {
            const headRes = await fetchWithTimeout(url, {
                method: 'HEAD',
                headers: { 'Authorization': this.getAuthHeader() }
            }, 6000);
            if (headRes.ok) {
                const lm = headRes.headers.get('Last-Modified') || headRes.headers.get('last-modified');
                if (lm) {
                    const t = new Date(lm).getTime();
                    if (t > 0) return t;
                }
                return Date.now();
            }
        } catch (e) {}

        try {
            const response = await fetchWithTimeout(url, {
                method: 'PROPFIND',
                headers: { 'Authorization': this.getAuthHeader(), 'Depth': '0' }
            }, 8000);
            if (response.ok) {
                const lmHeader = response.headers.get('Last-Modified') || response.headers.get('last-modified');
                if (lmHeader) {
                    const t = new Date(lmHeader).getTime();
                    if (t > 0) return t;
                }
                const text = await response.text();
                const match = text.match(/<[a-zA-Z0-9:]*getlastmodified[^>]*>(.*?)<\/[a-zA-Z0-9:]*getlastmodified>/i);
                if (match && match[1]) {
                    const dateStr = match[1];
                    const t = new Date(dateStr).getTime();
                    if (t > 0) return t;
                }
                return Date.now();
            }
        } catch (e) {}
        return 0;
    }

    async listDiaryFiles() {
        const baseUrl = this.config.webDavUrl.replace(/\/+$/, '');
        const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
        const userDirClean = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');

        const parts = [];
        if (root) root.split('/').filter(Boolean).forEach(p => parts.push(encodeURIComponent(p)));
        if (userDirClean) userDirClean.split('/').filter(Boolean).forEach(p => parts.push(encodeURIComponent(p)));
        parts.push('diary');

        const diaryDirUrl = `${baseUrl}/${parts.join('/')}`;
        const fallbackDiaryDirUrl = `${baseUrl}/${root ? encodeURIComponent(root) + '/' : ''}diary`;

        const diaryDirUrls = [diaryDirUrl, fallbackDiaryDirUrl];
        const items = [];
        const seenNames = new Set();
        const diaryBaseUrl = (this.config.diaryBaseUrl || '').trim().replace(/\/+$/, '');

        for (const targetUrl of diaryDirUrls) {
            try {
                const response = await fetch(targetUrl, {
                    method: 'PROPFIND',
                    headers: { 
                        'Authorization': this.getAuthHeader(), 
                        'Depth': '1' 
                    }
                });
                if (!response.ok) continue;

                const xmlText = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(xmlText, 'text/xml');
                const responses = doc.querySelectorAll('response, d\\:response');

                for (const node of responses) {
                    const hrefNode = node.querySelector('href, d\\:href');
                    const href = hrefNode ? hrefNode.textContent : '';
                    if (!href) continue;

                    const cleanHref = href.replace(/\/+$/, '');
                    const cleanTarget = targetUrl.replace(/\/+$/, '');
                    if (cleanHref.endsWith('/diary') || cleanHref.endsWith('/diary/') || cleanHref === cleanTarget) continue;

                    const isCollection = node.querySelector('collection, d\\:collection') !== null;
                    const itemName = decodeURIComponent(cleanHref.split('/').pop());
                    if (!itemName || seenNames.has(itemName)) continue;

                    const contentLengthNode = node.querySelector('getcontentlength, d\\:getcontentlength');
                    const lastModifiedNode = node.querySelector('getlastmodified, d\\:getlastmodified');
                    
                    const size = contentLengthNode ? parseInt(contentLengthNode.textContent || '0', 10) : 0;
                    const lastModifiedStr = lastModifiedNode ? lastModifiedNode.textContent : '';
                    const lastModified = lastModifiedStr ? new Date(lastModifiedStr).getTime() : Date.now();

                    if (isCollection) {
                        // Subdirectory under diary/ (e.g. 2026-08-11_日记)
                        const subDirUrl = `${cleanTarget}/${encodeURIComponent(itemName)}`;
                        let indexFileName = 'index.html';
                        let subLastModified = lastModified;
                        let subSize = size;
                        let foundIndex = false;

                        try {
                            const subRes = await fetch(subDirUrl, {
                                method: 'PROPFIND',
                                headers: { 'Authorization': this.getAuthHeader(), 'Depth': '1' }
                            });
                            if (subRes.ok) {
                                const subXml = await subRes.text();
                                const subDoc = parser.parseFromString(subXml, 'text/xml');
                                const subNodes = subDoc.querySelectorAll('response, d\\:response');

                                subNodes.forEach(subNode => {
                                    const subHrefNode = subNode.querySelector('href, d\\:href');
                                    const subHref = subHrefNode ? subHrefNode.textContent : '';
                                    const subName = decodeURIComponent(subHref.replace(/\/+$/, '').split('/').pop());
                                    if (subName.toLowerCase().startsWith('index.htm')) {
                                        foundIndex = true;
                                        indexFileName = subName;
                                        const lmNode = subNode.querySelector('getlastmodified, d\\:getlastmodified');
                                        if (lmNode && lmNode.textContent) subLastModified = new Date(lmNode.textContent).getTime();
                                        const szNode = subNode.querySelector('getcontentlength, d\\:getcontentlength');
                                        if (szNode && szNode.textContent) subSize = parseInt(szNode.textContent, 10);
                                    }
                                });
                            }
                        } catch (e) {}

                        if (foundIndex) {
                            seenNames.add(itemName);
                            let webUrl = '';
                            if (diaryBaseUrl) {
                                // If diaryBaseUrl is set, do not append diary/ since base URL is mapped directly to diary dir
                                webUrl = `${diaryBaseUrl}/${encodeURIComponent(itemName)}/${indexFileName}`;
                            } else {
                                // If diaryBaseUrl is empty, use WebDAV direct path (which includes /diary/)
                                webUrl = `${subDirUrl}/${indexFileName}`;
                            }

                            items.push({
                                name: `${itemName}/${indexFileName}`,
                                subDir: itemName,
                                href,
                                webUrl,
                                size: subSize,
                                lastModified: subLastModified
                            });
                        }
                    } else if (itemName.toLowerCase().endsWith('.html') || itemName.toLowerCase().endsWith('.htm')) {
                        seenNames.add(itemName);
                        let webUrl = '';
                        if (diaryBaseUrl) {
                            webUrl = `${diaryBaseUrl}/${encodeURIComponent(itemName)}`;
                        } else {
                            webUrl = href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
                        }

                        items.push({
                            name: itemName,
                            subDir: '',
                            href,
                            webUrl,
                            size,
                            lastModified
                        });
                    }
                }
                if (items.length > 0) break;
            } catch (e) {
                console.warn('WebDAV listDiaryFiles error:', e);
            }
        }

        items.sort((a, b) => b.lastModified - a.lastModified);
        return items;
    }

    async testConnection() {
        const type = (this.config && this.config.type) || this.type || 'WEBDAV';
        if (type === 'WEBDAV') {
            const buildUrl = (webDavBaseUrl) => {
                const baseUrl = (webDavBaseUrl || '').trim().replace(/\/+$/, '');
                if (!baseUrl) return '';
                const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
                const userDirClean = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');

                const parts = [];
                if (root) root.split('/').filter(Boolean).forEach(p => parts.push(encodeURIComponent(p)));
                if (userDirClean) userDirClean.split('/').filter(Boolean).forEach(p => parts.push(encodeURIComponent(p)));

                return parts.length > 0 ? `${baseUrl}/${parts.join('/')}` : baseUrl;
            };

            const testSingleUrl = async (targetUrl) => {
                if (!targetUrl) return { ok: false, message: 'URL 不能为空' };
                const xmlBody = '<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>';
                
                try {
                    let response = await fetch(targetUrl, {
                        method: 'PROPFIND',
                        headers: {
                            'Authorization': this.getAuthHeader(),
                            'Depth': '1',
                            'Content-Type': 'application/xml; charset=utf-8'
                        },
                        body: xmlBody
                    });

                    let createdDir = false;
                    if (response.status === 404) {
                        try {
                            await this.ensureFolderPathExist();
                            createdDir = true;
                            response = await fetch(targetUrl, {
                                method: 'PROPFIND',
                                headers: {
                                    'Authorization': this.getAuthHeader(),
                                    'Depth': '1',
                                    'Content-Type': 'application/xml; charset=utf-8'
                                },
                                body: xmlBody
                            });
                        } catch (e) {}
                    }

                    if (response.status === 207 || (response.status >= 200 && response.status < 300)) {
                        const text = await response.text();
                        const count = (text.match(/<(?:\w+:)?response\b/gi) || []).length;
                        const tip = createdDir ? `(目录已自动创建，已列出 ${count} 项)` : `(已成功列出 ${count} 项)`;
                        return { ok: true, message: `HTTP ${response.status} ${tip}` };
                    } else if (response.status === 401 || response.status === 403) {
                        return { ok: false, message: `HTTP ${response.status} (认证失败，账号或密码错误)` };
                    } else {
                        return { ok: false, message: `HTTP ${response.status} (${response.statusText || '连接异常'})` };
                    }
                } catch (e) {
                    return { ok: false, message: `网络连接失败 (${e.message || '无法访问'})` };
                }
            };

            const primaryTargetUrl = buildUrl(this.config.webDavUrl);
            if (!primaryTargetUrl) throw new Error('主 WebDAV 地址不能为空');

            const primaryResult = await testSingleUrl(primaryTargetUrl);
            const report = [];
            
            if (primaryResult.ok) {
                report.push(`主地址: ${primaryResult.message}`);
            } else {
                report.push(`主地址: 连接失败 - ${primaryResult.message}`);
            }

            if (this.config.webDavFallbackUrl && this.config.webDavFallbackUrl.trim()) {
                const fallbackTargetUrl = buildUrl(this.config.webDavFallbackUrl);
                const fallbackResult = await testSingleUrl(fallbackTargetUrl);
                if (fallbackResult.ok) {
                    report.push(`备用地址: ${fallbackResult.message}`);
                } else {
                    report.push(`备用地址: 连接失败 - ${fallbackResult.message}`);
                }
            }

            const fullReport = report.join('\n');
            if (primaryResult.ok) {
                return { ok: true, status: 200, message: fullReport };
            } else {
                throw new Error(fullReport);
            }
        } else if (this.type === 'S3') {
            const endpoint = (this.config.endpoint || '').replace(/\/+$/, '');
            if (!endpoint) throw new Error('S3 Endpoint 不能为空');
            const response = await fetch(endpoint, { method: 'HEAD' });
            return { ok: true, status: response.status, message: 'S3 服务器连通正常！' };
        }
        return { ok: true, message: '连接配置有效' };
    }
}

class S3StorageClient {
    constructor(config) {
        this.config = config;
        this.type = 'S3';
    }

    getKey(fileName) {
        const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
        const userDirClean = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');

        const parts = [];
        if (root) parts.push(root);
        if (userDirClean) parts.push(userDirClean);
        parts.push(fileName);

        return parts.join('/');
    }

    getUrl(fileName) {
        if (!fileName) return '';
        if (typeof fileName === 'string' && (fileName.startsWith('http://') || fileName.startsWith('https://'))) {
            return fileName;
        }
        const endpoint = this.config.endpoint.replace(/\/+$/, '');
        const bucket = this.config.bucket;
        const key = this.getKey(fileName);

        return `${endpoint}/${bucket}/${key}`;
    }

    async uploadFile(file, fileName, contentType, onProgress) {
        const url = this.getUrl(fileName);
        const headers = { 'Content-Type': contentType };
        signS3Request('PUT', url, this.config, headers);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url, true);
            Object.keys(headers).forEach(k => xhr.setRequestHeader(k, headers[k]));

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    const progress = Math.round((e.loaded / e.total) * 100);
                    onProgress(progress);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(url);
                } else {
                    reject(new Error(`S3 upload failed: ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error during S3 upload'));
            xhr.send(file);
        });
    }

    async copyFile(sourceFileName, destSubPath) {
        const sourceKey = this.getKey(sourceFileName);
        const destKey = this.getKey(destSubPath);
        const bucket = this.config.bucketName || '';
        const url = this.getUrl(destSubPath);

        const headers = {
            'x-amz-copy-source': `/${bucket}/${sourceKey}`
        };
        signS3Request('PUT', url, this.config, headers);

        try {
            const response = await fetch(url, { method: 'PUT', headers });
            if (response.ok) return true;
        } catch (e) {
            console.warn('S3 COPY failed:', e);
        }
        return false;
    }

    async uploadText(content, fileName) {
        const url = this.getUrl(fileName);
        const headers = { 'Content-Type': 'application/json' };
        
        const payloadHash = CryptoJS.SHA256(content).toString(CryptoJS.enc.Hex);
        signS3Request('PUT', url, this.config, headers, payloadHash);

        const response = await fetch(url, {
            method: 'PUT',
            headers: headers,
            body: content
        });
        if (!response.ok) throw new Error(`S3 upload text failed: ${response.status}`);
        return url;
    }

    async downloadFile(fileName) {
        const url = this.getUrl(fileName);
        const headers = {};
        signS3Request('GET', url, this.config, headers);

        const response = await fetchWithTimeout(url, { headers }, 20000);
        if (!response.ok) throw new Error(`S3 download failed: ${response.status}`);
        return await response.blob();
    }

    async downloadText(fileName) {
        const url = this.getUrl(fileName);
        const headers = {};
        signS3Request('GET', url, this.config, headers);

        const response = await fetchWithTimeout(url, { headers }, 20000);
        if (!response.ok) throw new Error(`S3 download text failed: ${response.status}`);
        return await response.text();
    }

    async downloadFileWithProgress(fileName, onProgress, dlState) {
        const url = this.getUrl(fileName);
        const headers = {};
        signS3Request('GET', url, this.config, headers);

        const response = await fetch(url, { headers, signal: dlState?.controller?.signal });
        if (!response.ok) throw new Error(`S3 download failed: ${response.status}`);
        return await readResponseWithProgress(response, onProgress, dlState);
    }

    validateSafeName(name) {
        if (!name || typeof name !== 'string') return false;
        const trimmed = name.trim();
        if (!trimmed || trimmed.length > 255) return false;
        if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return false;
        const segs = trimmed.split('/');
        for (const seg of segs) {
            if (seg === '' || seg === '.' || seg === '..') return false;
            if (/[\\?#%\u0000]/.test(seg)) return false;
        }
        return true;
    }

    isValidUserDir() {
        const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
        const userDir = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');
        const segs = [];
        if (root) root.split('/').filter(Boolean).forEach(s => segs.push(s));
        if (userDir) userDir.split('/').filter(Boolean).forEach(s => segs.push(s));
        if (segs.length === 0) return false;
        const valid = /^[a-zA-Z0-9_-]+$/;
        return segs.every(s => s.length <= 255 && valid.test(s) && s !== '.' && s !== '..');
    }

    async deleteFile(fileName) {
        if (!this.isValidUserDir()) {
            console.error('S3 deleteFile: refusing, user directory is invalid (must be alphanumeric/_- only)');
            return;
        }
        if (!this.validateSafeName(fileName)) {
            console.error('S3 deleteFile: refusing unsafe fileName:', fileName);
            return;
        }
        const url = this.getUrl(fileName);
        const headers = {};
        signS3Request('DELETE', url, this.config, headers);

        const response = await fetch(url, { method: 'DELETE', headers });
        if (!response.ok && response.status !== 404) {
            throw new Error(`S3 Delete failed: ${response.status}`);
        }
    }

    async recycleFile(fileName) {
        await this.deleteFile(fileName);
    }

    async getFileSize(fileName) {
        const url = this.getUrl(fileName);
        const headers = {};
        signS3Request('HEAD', url, this.config, headers);
        try {
            const response = await fetch(url, { method: 'HEAD', headers });
            if (response.ok) {
                return parseInt(response.headers.get('Content-Length') || '-1');
            }
        } catch (e) {}
        return -1;
    }

    async getLastModified(fileName) {
        const url = this.getUrl(fileName);
        const headers = {};
        signS3Request('HEAD', url, this.config, headers);
        try {
            const response = await fetch(url, { method: 'HEAD', headers });
            if (response.ok) {
                const dateStr = response.headers.get('Last-Modified');
                return dateStr ? new Date(dateStr).getTime() : 0;
            }
        } catch (e) {}
        return 0;
    }
}
