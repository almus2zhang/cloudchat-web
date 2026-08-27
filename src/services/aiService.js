/**
 * AI Service for CloudChat Web & Desktop
 * Supports: SiliconFlow / OpenAI Compatible & Google Gemini
 * Features: Pure Speech-to-Text, Voice Summary, Intelligent Chunking (>300s), Cancel & Recovery
 */

export const DEFAULT_AI_CONFIG = {
  provider: 'openai', // 'openai' | 'gemini'
  openaiBaseUrl: 'https://api.siliconflow.cn/v1',
  openaiApiKey: '',
  openaiWhisperModel: 'FunAudioLLM/SenseVoiceSmall',
  openaiChatModel: 'deepseek-ai/DeepSeek-V4-Flash',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  summaryPrompt: '请将这段语音内容准确转写为文字，并提炼输出结构清晰的 Markdown 分级总结，格式如下：\n### 📝 语音转写\n(此处为转写原文)\n\n### 💡 要点总结\n- (核心要点1)\n- (核心要点2)'
};

const LS_AI_CONFIG_KEY = 'cloudchat_ai_config';

export function getAiConfig() {
  try {
    const saved = localStorage.getItem(LS_AI_CONFIG_KEY);
    if (saved) {
      return { ...DEFAULT_AI_CONFIG, ...JSON.parse(saved) };
    }
  } catch (_) {}
  return { ...DEFAULT_AI_CONFIG };
}

export function saveAiConfig(config) {
  try {
    localStorage.setItem(LS_AI_CONFIG_KEY, JSON.stringify(config));
  } catch (_) {}
}

/**
 * Test AI API connection
 */
export async function testAiConnection(config) {
  const isGemini = (config.provider || '').toLowerCase() === 'gemini';

  if (isGemini) {
    if (!config.geminiApiKey) throw new Error('请先填写 Gemini API Key');
    const baseUrl = (config.geminiBaseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const model = (config.geminiModel || 'gemini-2.5-flash').trim();
    const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${config.geminiApiKey.trim()}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Hello, reply 'OK'" }] }]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini 连接失败 (${res.status}): ${errText}`);
    }
    return 'Gemini API 连接成功！';
  } else {
    if (!config.openaiApiKey) throw new Error('请先填写 OpenAI / 硅基流动 API Key');
    const baseUrl = (config.openaiBaseUrl || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
    const model = (config.openaiChatModel || 'deepseek-ai/DeepSeek-V4-Flash').trim();
    const url = `${baseUrl}/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openaiApiKey.trim()}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: "Hello, reply 'OK'" }],
        max_tokens: 10
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI / 硅基流动 连接失败 (${res.status}): ${errText}`);
    }
    return 'OpenAI 兼容 API 连接成功！';
  }
}

/**
 * Transcribe & Summarize an audio blob
 */
export async function transcribeAndSummarizeAudio({
  audioBlob,
  config = getAiConfig(),
  transcribeOnly = false,
  onProgress = () => {},
  signal
}) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('音频文件为空或未就绪');
  }

  const isGemini = (config.provider || '').toLowerCase() === 'gemini';

  onProgress(transcribeOnly ? '正在准备语音转写...' : '正在准备音频文件...');

  // Step 1: Transcribe
  let transcribedText = '';
  try {
    if (isGemini) {
      transcribedText = await transcribeWithGemini(audioBlob, config, onProgress, signal);
    } else {
      transcribedText = await transcribeWithOpenAi(audioBlob, config, onProgress, signal);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`语音转写失败: ${err.message}`);
  }

  if (!transcribedText || !transcribedText.trim()) {
    throw new Error('未能从语音中识别出有效文字');
  }

  if (transcribeOnly) {
    onProgress('转写完成！');
    return `<!--md-->### 📝 语音转写\n${transcribedText.trim()}`;
  }

  // Step 2: Summarize with Chat LLM
  onProgress(isGemini ? '2/2 正在通过 Gemini 生成分级总结...' : `2/2 正在通过 ${config.openaiChatModel?.split('/').pop() || '大模型'} 生成分级要点总结...`);

  try {
    let summaryText = '';
    if (isGemini) {
      summaryText = await summarizeWithGeminiChat(transcribedText, config, signal);
    } else {
      summaryText = await summarizeWithOpenAiChat(transcribedText, config, signal);
    }

    onProgress('总结完成！');
    return `<!--md-->### 📝 语音转写 (全文)\n${transcribedText.trim()}\n\n${summaryText.trim()}`;
  } catch (err) {
    if (err.name === 'AbortError') {
      // Return partial transcribed text on cancel during summary phase
      return `<!--md-->### 📝 语音已转写内容 (中途取消)\n${transcribedText.trim()}`;
    }
    // Fallback: If chat summary fails/times out, return transcribed text
    return `<!--md-->### 📝 语音转写 (全文)\n${transcribedText.trim()}\n\n> ⚠️ *提示：大模型总结未成功 (${err.message})，已为您完整保留文字转写内容。*`;
  }
}

async function transcribeWithOpenAi(audioBlob, config, onProgress, signal) {
  if (!config.openaiApiKey) throw new Error('未配置 OpenAI / 硅基流动 API Key');
  const baseUrl = (config.openaiBaseUrl || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  const model = (config.openaiWhisperModel || 'FunAudioLLM/SenseVoiceSmall').trim();
  const url = `${baseUrl}/audio/transcriptions`;

  onProgress(`1/2 正在语音识别 (${model.split('/').pop()})...`);

  const formData = new FormData();
  const filename = audioBlob.name || 'audio.m4a';
  formData.append('file', audioBlob, filename);
  formData.append('model', model);
  formData.append('response_format', 'json');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.openaiApiKey.trim()}`
    },
    body: formData,
    signal
  });

  if (!res.ok) {
    const errText = await res.text();
    let msg = errText;
    try {
      const json = JSON.parse(errText);
      msg = json.error?.message || errText;
    } catch (_) {}
    throw new Error(`(${res.status}) ${msg}`);
  }

  const data = await res.json();
  return data.text || '';
}

async function transcribeWithGemini(audioBlob, config, onProgress, signal) {
  if (!config.geminiApiKey) throw new Error('未配置 Gemini API Key');
  const baseUrl = (config.geminiBaseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const model = (config.geminiModel || 'gemini-2.5-flash').trim();
  const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${config.geminiApiKey.trim()}`;

  onProgress(`1/2 正在通过 Gemini (${model}) 转写语音...`);

  const base64Data = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || 'audio/mp4';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: "请将这段语音内容准确转写为文字输出，不要添加额外分析、前缀或开场白。" },
          {
            inline_data: {
              mime_type: mimeType.startsWith('audio/') ? mimeType : 'audio/mp4',
              data: base64Data
            }
          }
        ]
      }]
    }),
    signal
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`(${res.status}) ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function summarizeWithOpenAiChat(transcribedText, config, signal) {
  const baseUrl = (config.openaiBaseUrl || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  const model = (config.openaiChatModel || 'deepseek-ai/DeepSeek-V4-Flash').trim();
  const url = `${baseUrl}/chat/completions`;

  const prompt = config.summaryPrompt || '请根据提供的语音转写全文，提炼输出结构清晰的 Markdown 分级总结，格式如下：\n### 💡 要点总结\n- (核心要点1)\n- (核心要点2)';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openaiApiKey.trim()}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `请根据以下语音转写全文生成总结：\n\n${transcribedText}` }
      ],
      temperature: 0.3
    }),
    signal
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`(${res.status}) ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function summarizeWithGeminiChat(transcribedText, config, signal) {
  const baseUrl = (config.geminiBaseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const model = (config.geminiModel || 'gemini-2.5-flash').trim();
  const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${config.geminiApiKey.trim()}`;

  const prompt = config.summaryPrompt || '请根据提供的语音转写全文，提炼输出结构清晰的 Markdown 分级总结，格式如下：\n### 💡 要点总结\n- (核心要点1)\n- (核心要点2)';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${prompt}\n\n【语音转写全文】：\n${transcribedText}` }]
      }]
    }),
    signal
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`(${res.status}) ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
