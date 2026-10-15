import { fetchWithTimeout } from '../services/storage';

function logDebug(msg) {
    if (typeof window !== 'undefined' && window.__addDebugLog) {
        window.__addDebugLog(msg);
    }
}

/**
 * 缓存解析结果：key -> { resolvedUrl, expireAt }
 * 缓存时间 60 秒，避免频繁重复查询；但过期后即自动重新解析
 */
const dynamicUrlCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

export function clearDynamicUrlCache() {
    dynamicUrlCache.clear();
}

/**
 * 规范化动态协议前缀（处理中文冒号、大小写与多余空格）
 * 若为 302: 开头，返回 { type: '302', target: '...' }
 * 若为 txt: 开头，返回 { type: 'txt', target: '...' }
 * 否则返回 null
 */
export function parseDynamicUrlPrefix(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    // 兼容全角冒号：和半角冒号:
    const normalized = trimmed.replace(/^(302|txt)[：:]\s*/i, (match, p1) => `${p1.toLowerCase()}:`);
    if (normalized.toLowerCase().startsWith('302:')) {
        return {
            type: '302',
            target: normalized.substring(4).trim()
        };
    }
    if (normalized.toLowerCase().startsWith('txt:')) {
        return {
            type: 'txt',
            target: normalized.substring(4).trim()
        };
    }
    return null;
}

/**
 * 确保 URL 带有 http:// 或 https:// 协议头，默认补全 http://
 */
export function normalizeHttpProtocol(url) {
    if (!url || typeof url !== 'string') return '';
    let trimmed = url.trim();
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) {
        trimmed = 'http://' + trimmed;
    }
    return trimmed;
}

/**
 * 通过 DoH (DNS over HTTPS) 并发竞速解析 DNS TXT 记录
 * 优先国内高可用节点：阿里公共 DNS 与 腾讯 DNSPod；备用：Cloudflare
 */
export async function resolveTxtDnsRecord(domain) {
    if (!domain) throw new Error('DNS TXT 解析域名不能为空');

    // 提取纯域名（若用户误带协议或路径，进行清洗）
    let cleanDomain = domain.trim();
    cleanDomain = cleanDomain.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].split('#')[0];
    if (!cleanDomain) throw new Error('无效的解析域名: ' + domain);

    const endpoints = [
        {
            name: 'AliDNS (223.5.5.5)',
            url: `https://223.5.5.5/resolve?name=${encodeURIComponent(cleanDomain)}&type=TXT`
        },
        {
            name: 'AliDNS (dns.alidns.com)',
            url: `https://dns.alidns.com/resolve?name=${encodeURIComponent(cleanDomain)}&type=TXT`
        },
        {
            name: 'Tencent DNSPod (1.12.12.12)',
            url: `https://1.12.12.12/resolve?name=${encodeURIComponent(cleanDomain)}&type=TXT`
        },
        {
            name: 'Tencent DNSPod (doh.pub)',
            url: `https://doh.pub/resolve?name=${encodeURIComponent(cleanDomain)}&type=TXT`
        },
        {
            name: 'Cloudflare (1.1.1.1)',
            url: `https://1.1.1.1/dns-query?name=${encodeURIComponent(cleanDomain)}&type=TXT`
        },
        {
            name: 'Cloudflare (cloudflare-dns.com)',
            url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cleanDomain)}&type=TXT`
        }
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const queryEndpoint = async (ep) => {
        try {
            const res = await fetchWithTimeout(ep.url, {
                method: 'GET',
                headers: { 'Accept': 'application/dns-json' },
                signal: controller.signal
            }, 6000);

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const json = await res.json();
            const answers = json.Answer || [];
            // TXT 记录 type 为 16
            for (const ans of answers) {
                if (ans.type === 16 && ans.data) {
                    let txt = String(ans.data).trim();
                    // TXT 数据外部可能包含前后双引号
                    if (txt.startsWith('"') && txt.endsWith('"')) {
                        txt = txt.slice(1, -1);
                    }
                    txt = txt.trim();
                    if (txt) {
                        logDebug(`[DoH TXT Success] 节点 ${ep.name} 竞速成功解析 ${cleanDomain}: ${txt}`);
                        return txt;
                    }
                }
            }
            throw new Error('未包含有效 TXT 记录');
        } catch (e) {
            throw e;
        }
    };

    try {
        // 并发竞速：任意节点率先返回有效结果立即完成并中断其余连接
        const fastestResult = await Promise.any(endpoints.map(queryEndpoint));
        clearTimeout(timeoutId);
        controller.abort();
        return normalizeHttpProtocol(fastestResult);
    } catch (aggregateErr) {
        clearTimeout(timeoutId);
        controller.abort();
        throw new Error(`TXT 记录解析失败 (${cleanDomain}): 所有 DoH 节点均未响应或无 TXT 记录`);
    }
}

/**
 * 获取 302/307 重定向或真实内容地址
 * 1) 首先通过 HEAD/GET 禁止跟随重定向，提取 Location 头；
 * 2) 若无 Location 跳转头，则读取响应文本内容，若返回为 http/https 或 ip:port 字符串则作为真实地址；
 * 3) 若跟随重定向后返回有效 URL，使用最终生效 URL
 */
export async function resolve302RedirectUrl(targetUrl) {
    if (!targetUrl) throw new Error('动态跳转目标 URL 不能为空');
    let initialUrl = normalizeHttpProtocol(targetUrl);

    logDebug(`[302 Resolve] 开始从 ${initialUrl} 获取真实地址...`);

    // 尝试 1：优先不跟随重定向抓取 Location
    try {
        const res = await fetchWithTimeout(initialUrl, {
            method: 'GET',
            redirect: 'manual'
        }, 8000);

        const location = res.headers.get('location') || res.headers.get('Location');
        if (location) {
            let finalUrl = location.trim();
            if (finalUrl.startsWith('/')) {
                // 相对路径
                const base = new URL(initialUrl);
                finalUrl = `${base.origin}${finalUrl}`;
            }
            finalUrl = normalizeHttpProtocol(finalUrl);
            logDebug(`[302 Resolve] 成功捕获重定向 Location: ${finalUrl}`);
            return finalUrl;
        }

        // 如果没有 Location，检查响应内容（curl 得到字符串作为真实地址的场景）
        if (res.ok) {
            const text = (await res.text()).trim();
            // 简单校验是否形如 http... 或 host:port
            if (text && (text.startsWith('http://') || text.startsWith('https://') || /^[a-zA-Z0-9.-]+(:\d+)?(\/.*)?$/.test(text))) {
                const finalUrl = normalizeHttpProtocol(text);
                logDebug(`[302 Resolve] 从响应 Body 获取真实地址: ${finalUrl}`);
                return finalUrl;
            }
        }
    } catch (e) {
        logDebug(`[302 Resolve Manual Warning] ${e.message || e}，尝试默认跟随重定向...`);
    }

    // 尝试 2：允许跟随重定向，取 response.url 或返回的内容
    try {
        const resFollow = await fetchWithTimeout(initialUrl, {
            method: 'GET',
            redirect: 'follow'
        }, 8000);

        if (resFollow.url && resFollow.url !== initialUrl) {
            const finalUrl = normalizeHttpProtocol(resFollow.url);
            logDebug(`[302 Resolve] 跟随重定向后生效 URL: ${finalUrl}`);
            return finalUrl;
        }

        const text = (await resFollow.text()).trim();
        if (text && (text.startsWith('http://') || text.startsWith('https://') || /^[a-zA-Z0-9.-]+(:\d+)?(\/.*)?$/.test(text))) {
            const finalUrl = normalizeHttpProtocol(text);
            logDebug(`[302 Resolve] 跟随重定向从 Body 获取真实地址: ${finalUrl}`);
            return finalUrl;
        }
    } catch (e) {
        logDebug(`[302 Resolve Follow Error] ${e.message || e}`);
    }

    // 如果以上均未能提取，退回到带协议的原始地址
    return initialUrl;
}

/**
 * 综合解析动态 WebDAV URL：
 * 如果是 302:... 则动态获取跳转后真实地址
 * 如果是 txt:... 则通过 DoH 并发解析 TXT 记录获取真实地址
 * 其它常规地址则直接返回（保持原有行为）
 * 包含内存 TTL 缓存，支持 forceRefresh 强制刷新
 */
export async function resolveDynamicWebDavUrl(rawUrl, forceRefresh = false) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl || '';
    const trimmed = rawUrl.trim();
    const parsed = parseDynamicUrlPrefix(trimmed);

    if (!parsed) {
        // 普通地址
        return trimmed;
    }

    const cacheKey = `${parsed.type}:${parsed.target}`;
    const now = Date.now();
    if (!forceRefresh && dynamicUrlCache.has(cacheKey)) {
        const item = dynamicUrlCache.get(cacheKey);
        if (item && item.expireAt > now && item.resolvedUrl) {
            return item.resolvedUrl;
        }
    }

    let resolvedUrl = '';
    if (parsed.type === '302') {
        resolvedUrl = await resolve302RedirectUrl(parsed.target);
    } else if (parsed.type === 'txt') {
        resolvedUrl = await resolveTxtDnsRecord(parsed.target);
    }

    if (resolvedUrl) {
        dynamicUrlCache.set(cacheKey, {
            resolvedUrl: resolvedUrl,
            expireAt: now + CACHE_TTL_MS
        });
        logDebug(`[Dynamic URL Resolved] ${trimmed} -> ${resolvedUrl}`);
        return resolvedUrl;
    }

    return trimmed;
}
