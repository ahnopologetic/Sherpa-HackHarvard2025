// background.js (MV3 service worker)
// Project Sherpa — Central orchestrator for AI + TTS

// ===== Side Panel Setup =====
// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ===== Config =====
const GEMINI_MODEL = 'gemini-2.5-flash'; // fast & low-cost; try 'gemini-2.5-pro' for higher quality
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
  chrome.runtime.sendMessage({ type: 'atlas_status', status, detail }).catch(() => { });
}

// ===== Prompt builder =====
function buildPrompt(pageStructure) {
  const jsonStr = JSON.stringify(pageStructure, null, 2);
  return `You are an expert web accessibility assistant helping screen reader users understand webpage layouts quickly.

A user has just landed on a webpage. Based on the semantic structure data below, generate a concise audio summary that helps them understand:
1) the page's purpose, 2) the primary sections, 3) key navigation options, 4) notable accessibility features.

For the navigation options, you must be more friendly about it and say something like "You can navigate to the <section name> section where you can find more information about <section purpose>."
Give the navigation options in the end so that user can know the options available to them.

Keep it conversational and concise (3–5 sentences). Provide ONLY the spoken summary text.

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

// ===== Request page structure for backend =====
async function requestPageForBackend(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { command: 'get_page_for_backend' },
      (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.ok) {
          reject(new Error(resp?.error || 'Failed to get page data'));
          return;
        }
        resolve(resp.data);
      }
    );
  });
}

// ===== Core workflow =====
async function handlePageAnalysis(pageStructure, options = {}) {
  const { autoTriggered = false } = options;
  
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
    // Get current tab and request page structure for backend
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      try {
        await requestPageForBackend(tabs[0].id);
      } catch (err) {
        console.warn('[Sherpa] Could not get page for backend:', err);
      }
    }

    // 🚀 Send summary to popup immediately (before TTS) so UI updates right away
    chrome.runtime.sendMessage({
      type: 'analysis_complete',
      summary,
      source: usedSource || (apiKey ? 'cloud' : 'built-in'),
      model: GEMINI_MODEL,
      pageStructure: pageStructure, // Send page structure too
      autoTriggered: autoTriggered, // Flag to indicate if auto-triggered
      langHint: pageStructure?.language || pageStructure?.lang || null
    }).catch(() => { });

    // Only speak TTS if NOT auto-triggered (i.e., user manually clicked analyze)
    if (!autoTriggered) {
      // Then speak, updating status along the way
      notifyPopup('speaking', 'Speaking summary…');
      
      // Notify popup that TTS started
      chrome.runtime.sendMessage({ type: 'tts_started' }).catch(() => { });
      
      const langHint = pageStructure?.language || pageStructure?.lang || null;
      await speakText(summary, langHint);

      // Notify popup that TTS ended
      chrome.runtime.sendMessage({ type: 'tts_ended' }).catch(() => { });
    } else {
      // If auto-triggered, play notification sound via content script
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0]) {
        try {
          await chrome.tabs.sendMessage(tabs[0].id, { 
            command: 'play_notification_sound' 
          });
        } catch (err) {
          console.log('[Sherpa] Could not play notification sound:', err);
        }
      }
    }
    
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
    
    // Only speak error if not auto-triggered
    if (!autoTriggered) {
      await speakText(audible).catch(() => { });
    }
    
    chrome.runtime.sendMessage({ type: 'analysis_error', error: error.message }).catch(() => { });
    throw error;
  }
}

// ===== Message wiring =====
chrome.runtime.onMessage.addListener(async (message, _sender, sendResponse) => {
  if (message?.type === 'page_structure_extracted') {
    handlePageAnalysis(message.data)
      .then(() => sendResponse({ status: 'success' }))
      .catch((e) => sendResponse({ status: 'error', message: e.message }));
    return true; // keep port open for async
  }

  // Handle TTS request from popup
  if (message?.type === 'speak_text') {
    const { text, langHint } = message;
    
    // Notify that TTS started
    chrome.runtime.sendMessage({ type: 'tts_started' }).catch(() => { });
    
    speakText(text, langHint)
      .then(() => {
        chrome.runtime.sendMessage({ type: 'tts_ended' }).catch(() => { });
        sendResponse({ status: 'success' });
      })
      .catch((e) => {
        chrome.runtime.sendMessage({ type: 'tts_ended' }).catch(() => { });
        sendResponse({ status: 'error', message: e.message });
      });
    return true; // keep port open for async
  }

  // Stop TTS (pause functionality)
  if (message?.type === 'stop_tts') {
    chrome.tts.stop();
    console.log('[Sherpa] TTS stopped by user');
    
    // Notify that TTS ended
    chrome.runtime.sendMessage({ type: 'tts_ended' }).catch(() => { });
    
    sendResponse({ status: 'success' });
    return true;
  }

  // Stop TTS when recording starts
  if (message?.type === 'start-recording') {
    chrome.tts.stop();
    console.log('[Sherpa] TTS stopped - recording started');
    
    // Notify that TTS ended
    chrome.runtime.sendMessage({ type: 'tts_ended' }).catch(() => { });
  }

  if (message.target === "service-worker") {
    switch (message.type) {
      case "request-recording":
        try {
          // Stop TTS before starting recording
          chrome.tts.stop();
          console.log('[Sherpa] TTS stopped - recording requested');
          
          // Notify that TTS ended
          chrome.runtime.sendMessage({ type: 'tts_ended' }).catch(() => { });

          const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });

          // Check if we can record this tab
          if (
            !tab ||
            tab.url.startsWith("chrome://") ||
            tab.url.startsWith("chrome-extension://")
          ) {
            chrome.runtime.sendMessage({
              type: "recording-error",
              target: "offscreen",
              error:
                "Cannot record Chrome system pages. Please try on a regular webpage.",
            });
            return;
          }

          // Ensure we have access to the tab
          await chrome.tabs.update(tab.id, {});

          // Get a MediaStream for the active tab
          const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: tab.id,
          });

          // Send the stream ID to the offscreen document to start recording
          chrome.runtime.sendMessage({
            type: "start-recording",
            target: "offscreen",
            data: streamId,
          });

          chrome.action.setIcon({ path: "/icons/recording.png" });
        } catch (error) {
          chrome.runtime.sendMessage({
            type: "recording-error",
            target: "offscreen",
            error: error.message,
          });
        }
        break;

      case "recording-stopped":
        chrome.action.setIcon({ path: "icons/not-recording.png" });
        break;

      case "update-icon":
        chrome.action.setIcon({
          path: message.recording
            ? "icons/recording.png"
            : "icons/not-recording.png",
        });
        break;
    }
  }
});

// ===== Auto-analyze for Wikipedia and NYTimes =====
const AUTO_ANALYZE_DOMAINS = [
  'wikipedia.org',
  'nytimes.com'
];

function shouldAutoAnalyze(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return AUTO_ANALYZE_DOMAINS.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

// Track processed tabs to avoid duplicate analysis
const processedTabs = new Map();

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only trigger on complete page load
  if (changeInfo.status !== 'complete') return;
  
  // Check if this is a target domain
  if (!shouldAutoAnalyze(tab.url)) return;
  
  // Avoid duplicate processing for the same page
  const tabKey = `${tabId}-${tab.url}`;
  if (processedTabs.has(tabKey)) return;
  processedTabs.set(tabKey, Date.now());
  
  // Clean up old entries (older than 5 minutes)
  const now = Date.now();
  for (const [key, timestamp] of processedTabs.entries()) {
    if (now - timestamp > 300000) {
      processedTabs.delete(key);
    }
  }
  
  console.log('[Sherpa] Auto-analyzing page:', tab.url);
  
  // Wait a bit for the page to fully render
  setTimeout(async () => {
    try {
      // Request page structure from content script
      const response = await chrome.tabs.sendMessage(tabId, { 
        command: 'get_page_for_backend' 
      });
      
      if (response && response.ok && response.data) {
        // Trigger analysis with autoTriggered flag
        await handlePageAnalysis(response.data, { autoTriggered: true });
        
        // Notify popup that auto-analysis was triggered
        chrome.runtime.sendMessage({ 
          type: 'auto_analysis_triggered',
          url: tab.url 
        }).catch(() => {});
      }
    } catch (error) {
      console.log('[Sherpa] Auto-analysis failed:', error.message);
    }
  }, 1500); // Wait 1.5 seconds for page to stabilize
});

// Clean up processed tabs when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  // Remove all entries for this tab
  for (const [key] of processedTabs.entries()) {
    if (key.startsWith(`${tabId}-`)) {
      processedTabs.delete(key);
    }
  }
});

// ===== Install hook =====
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Project Atlas installed');
  }
});

console.log('Project Atlas background service worker loaded');
