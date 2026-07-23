import CryptoJS from 'crypto-js';

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

    getUrl(fileName) {
        const baseUrl = this.config.webDavUrl.replace(/\/+$/, '');
        const root = (this.config.serverPath || '').replace(/^\/+|\/+$/g, '');
        const userDirClean = (this.config.saveDir || '').replace(/^\/+|\/+$/g, '');

        const parts = [];
        if (root) parts.push(root);
        if (userDirClean) parts.push(userDirClean);
        parts.push(fileName);

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
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: content
        });
        if (!response.ok) throw new Error(`Upload text failed: ${response.status}`);
        return url;
    }

    async downloadFile(fileName) {
        const url = this.getUrl(fileName);
        const response = await fetch(url, {
            headers: { 'Authorization': this.getAuthHeader() }
        });
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        return await response.blob();
    }

    async downloadFileWithProgress(fileName, onProgress, dlState) {
        const url = this.getUrl(fileName);
        const response = await fetch(url, {
            headers: { 'Authorization': this.getAuthHeader() },
            signal: dlState?.controller?.signal
        });
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        return await readResponseWithProgress(response, onProgress, dlState);
    }

    async deleteFile(fileName) {
        const url = this.getUrl(fileName);
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': this.getAuthHeader() }
        });
        if (!response.ok && response.status !== 404) {
            throw new Error(`Delete failed: ${response.status}`);
        }
    }

    async recycleFile(fileName) {
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

    async getFileSize(fileName) {
        const url = this.getUrl(fileName);
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                headers: { 'Authorization': this.getAuthHeader() }
            });
            if (response.ok) {
                return parseInt(response.headers.get('Content-Length') || '-1');
            }
        } catch (e) {}
        return -1;
    }

    async getLastModified(fileName) {
        const url = this.getUrl(fileName);
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                headers: { 'Authorization': this.getAuthHeader() }
            });
            if (response.ok) {
                const dateStr = response.headers.get('Last-Modified');
                return dateStr ? new Date(dateStr).getTime() : 0;
            }
        } catch (e) {}
        return 0;
    }
}

class S3StorageClient {
    constructor(config) {
        this.config = config;
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

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`S3 download failed: ${response.status}`);
        return await response.blob();
    }

    async downloadFileWithProgress(fileName, onProgress, dlState) {
        const url = this.getUrl(fileName);
        const headers = {};
        signS3Request('GET', url, this.config, headers);

        const response = await fetch(url, { headers, signal: dlState?.controller?.signal });
        if (!response.ok) throw new Error(`S3 download failed: ${response.status}`);
        return await readResponseWithProgress(response, onProgress, dlState);
    }

    async deleteFile(fileName) {
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
