// background.js (MV3 service worker)
// Project Atlas — Central orchestrator for AI + TTS

// ===== Config =====
const GEMINI_MODEL = 'gemini-1.5-flash'; // fast & low-cost; try 'gemini-1.5-pro' for higher quality
const GEMINI_API_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const REQUEST_TIMEOUT_MS = 15000; // 15s hard timeout

// ===== Utils =====
function fetchWithTimeout(resource, options = {}, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(resource, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

function asApiErrorText(data) {
  return data?.error?.message || data?.message || '';
}

function notifyPopup(status, detail) {
  // Safe if no popup is open
  chrome.runtime.sendMessage({ type: 'atlas_status', status, detail }).catch(() => {});
}

// ===== Prompt builder =====
function buildPrompt(pageStructure) {
  const jsonStr = JSON.stringify(pageStructure, null, 2);
  return `You are an expert web accessibility assistant helping screen reader users understand webpage layouts quickly.

A user has just landed on a webpage. Based on the semantic structure data below, generate a concise audio summary that helps them understand:
1) the page's purpose, 2) the primary sections, 3) key navigation options, 4) notable accessibility features.

Keep it conversational and concise (2–4 sentences). Provide ONLY the spoken summary text.

Page Structure Data:
${jsonStr}`;
}

// ===== Cloud Gemini call =====
async function callGeminiAPI(prompt, apiKey) {
  const url = `${GEMINI_API_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, topK: 32, topP: 1, maxOutputTokens: 200 }
  };

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let errMsg = '';
    try { errMsg = asApiErrorText(await res.json()); } catch { /* ignore */ }
    throw new Error(`API Error ${res.status}${errMsg ? `: ${errMsg}` : ''}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const part = candidate?.content?.parts?.[0];
  const text = part?.text
    || (candidate?.content?.parts || []).map(p => p?.text).filter(Boolean).join('\n');

  if (!text) throw new Error('Unexpected API response format (no text)');
  return text.trim();
}

// ===== Built-in AI fallback (Summarizer API) =====
async function tryBuiltInSummarizer(pageStructure) {
  try {
    if (!('Summarizer' in self)) return null;
    const availability = await Summarizer.availability();
    if (availability === 'unavailable') return null;

    const summarizer = await Summarizer.create({
      type: 'tldr',              // concise paragraph style
      length: 'medium',          // ~3 sentences
      format: 'plain-text',
      sharedContext: 'Create a short spoken summary for a screen reader user.'
    });

    const input = [
      'Summarize the page purpose, primary sections, navigation options, and notable accessibility features in 2–4 sentences.',
      'Page structure JSON:',
      JSON.stringify(pageStructure)
    ].join('\n');

    const summary = await summarizer.summarize(input, {
      context: 'Keep it concise and conversational for TTS.'
    });

    return (typeof summary === 'string' ? summary : String(summary)).trim();
  } catch {
    return null;
  }
}

// ===== TTS =====
function speakText(text, langHint) {
  return new Promise((resolve, reject) => {
    chrome.tts.stop();
    chrome.tts.speak(text, {
      lang: (langHint && /^[a-z]{2}(-[A-Z]{2})?$/.test(langHint)) ? langHint : undefined,
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      onEvent: (ev) => {
        if (ev.type === 'end') resolve();
        else if (ev.type === 'error') reject(new Error('TTS error'));
      }
    });
  });
}

// ===== Storage (local first, then sync) =====
async function getApiKey() {
  const local = await chrome.storage.local.get(['geminiApiKey']);
  if (local?.geminiApiKey) return local.geminiApiKey;

  const sync = await chrome.storage.sync.get(['geminiApiKey']).catch(() => ({}));
  return sync?.geminiApiKey || null;
}

// ===== Core workflow =====
async function handlePageAnalysis(pageStructure) {
  notifyPopup('loading', 'Preparing summary…');

  try {
    if (pageStructure?.error) throw new Error(pageStructure.error);

    const apiKey = await getApiKey();
    const prompt = buildPrompt(pageStructure);

    let summary = null;
    let usedSource = null;

    if (apiKey) {
      try {
        summary = await callGeminiAPI(prompt, apiKey);
        usedSource = 'cloud';
      } catch (cloudErr) {
        summary = await tryBuiltInSummarizer(pageStructure);
        usedSource = summary ? 'built-in' : null;
        if (!summary) throw cloudErr; // rethrow original if no fallback
      }
    } else {
      summary = await tryBuiltInSummarizer(pageStructure);
      usedSource = summary ? 'built-in' : null;
      if (!summary) {
        throw new Error('API key not configured and built-in AI unavailable');
      }
    }

    // 🚀 Send summary to popup immediately (before TTS) so UI updates right away
    chrome.runtime.sendMessage({
      type: 'analysis_complete',
      summary,
      source: usedSource || (apiKey ? 'cloud' : 'built-in'),
      model: GEMINI_MODEL
    }).catch(() => {});

    // Then speak, updating status along the way
    notifyPopup('speaking', 'Speaking summary…');
    const langHint = pageStructure?.language || pageStructure?.lang || null;
    await speakText(summary, langHint);

    notifyPopup('complete');
  } catch (error) {
    console.error('[Atlas] Analysis workflow error:', error);

    let audible = 'Sorry, the page analysis failed. ';
    if (/API key/i.test(error.message)) {
      audible += 'Please configure your API key in the extension settings.';
    } else if (/API Error|fetch|network|aborted/i.test(error.message)) {
      audible += 'There was an issue connecting to the AI service or the network.';
    } else {
      audible += 'Please try again.';
    }

    notifyPopup('error', error.message);
    await speakText(audible).catch(() => {});
    chrome.runtime.sendMessage({ type: 'analysis_error', error: error.message }).catch(() => {});
    throw error;
  }
}

// ===== Message wiring =====
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'page_structure_extracted') {
    handlePageAnalysis(message.data)
      .then(() => sendResponse({ status: 'success' }))
      .catch((e) => sendResponse({ status: 'error', message: e.message }));
    return true; // keep port open for async
  }
});

// ===== Install hook =====
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Project Atlas installed');
  }
});

console.log('Project Atlas background service worker loaded');
