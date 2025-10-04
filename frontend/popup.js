// popup.js — Project Atlas

// ---- Elements (existing IDs in your HTML) ----
const analyzeBtn       = document.getElementById('analyzeBtn');
const buttonText       = document.getElementById('buttonText');
const statusContainer  = document.getElementById('statusContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const successIndicator = document.getElementById('successIndicator');
const errorIndicator   = document.getElementById('errorIndicator');
const errorMessage     = document.getElementById('errorMessage');

const settingsBtn      = document.getElementById('settingsBtn');
const settingsPanel    = document.getElementById('settingsPanel');
const apiKeyInput      = document.getElementById('apiKey');
const saveApiKeyBtn    = document.getElementById('saveApiKey');
const apiKeyStatus     = document.getElementById('apiKeyStatus');

// ---- State ----
let isAnalyzing = false;
let analyzeTimeoutId = null;

// ---- Summary UI (created on-demand so you DON'T have to edit popup.html) ----
let summarySection, summaryText, summarySource, summaryModel, copySummaryBtn;

function ensureSummaryUI() {
  if (summarySection) return;

  const main = document.querySelector('main') || document.body;

  summarySection = document.createElement('section');
  summarySection.id = 'summarySection';
  summarySection.style.marginTop = '12px';
  summarySection.style.background = 'rgba(255, 255, 255, 0.18)';
  summarySection.style.borderRadius = '8px';
  summarySection.style.padding = '12px';
  summarySection.style.display = 'none';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'baseline';
  header.style.justifyContent = 'space-between';
  header.style.marginBottom = '8px';

  const title = document.createElement('h2');
  title.textContent = 'Summary';
  title.style.fontSize = '16px';
  title.style.fontWeight = '700';
  header.appendChild(title);

  const meta = document.createElement('div');
  meta.style.fontSize = '12px';
  meta.style.opacity = '0.9';
  meta.style.display = 'flex';
  meta.style.gap = '8px';

  summarySource = document.createElement('span');
  summaryModel  = document.createElement('span');
  meta.appendChild(summarySource);
  meta.appendChild(summaryModel);
  header.appendChild(meta);

  summaryText = document.createElement('textarea');
  summaryText.id = 'summaryText';
  summaryText.rows = 7;
  summaryText.readOnly = true;
  summaryText.ariaLabel = 'AI generated summary';
  summaryText.style.width = '100%';
  summaryText.style.resize = 'vertical';
  summaryText.style.border = '1px solid rgba(255,255,255,0.3)';
  summaryText.style.borderRadius = '6px';
  summaryText.style.padding = '10px';
  summaryText.style.background = 'rgba(255,255,255,0.9)';
  summaryText.style.color = '#1f2937';
  summaryText.style.lineHeight = '1.35';
  summaryText.style.fontFamily =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.marginTop = '8px';

  copySummaryBtn = document.createElement('button');
  copySummaryBtn.textContent = 'Copy';
  copySummaryBtn.style.background = 'white';
  copySummaryBtn.style.color = '#1f2937';
  copySummaryBtn.style.border = 'none';
  copySummaryBtn.style.padding = '8px 12px';
  copySummaryBtn.style.fontSize = '13px';
  copySummaryBtn.style.fontWeight = '600';
  copySummaryBtn.style.borderRadius = '6px';
  copySummaryBtn.style.cursor = 'pointer';
  copySummaryBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(summaryText.value || '');
      copySummaryBtn.textContent = 'Copied!';
      setTimeout(() => (copySummaryBtn.textContent = 'Copy'), 1200);
    } catch {
      copySummaryBtn.textContent = 'Copy failed';
      setTimeout(() => (copySummaryBtn.textContent = 'Copy'), 1200);
    }
  });

  actions.appendChild(copySummaryBtn);

  summarySection.appendChild(header);
  summarySection.appendChild(summaryText);
  summarySection.appendChild(actions);

  main.appendChild(summarySection);
}

// ---- UI helpers ----
function hideAllIndicators() {
  loadingIndicator && loadingIndicator.classList.add('hidden');
  successIndicator && successIndicator.classList.add('hidden');
  errorIndicator   && errorIndicator.classList.add('hidden');
}

function showLoading() {
  hideAllIndicators();
  loadingIndicator && loadingIndicator.classList.remove('hidden');
  buttonText && (buttonText.textContent = 'Analyzing…');
  analyzeBtn && (analyzeBtn.disabled = true);
}

function showSpeaking() {
  // Optional: visually indicate speaking state
  buttonText && (buttonText.textContent = 'Speaking…');
}

function showSuccess() {
  hideAllIndicators();
  successIndicator && successIndicator.classList.remove('hidden');
  buttonText && (buttonText.textContent = 'Analyze Page Structure');
  analyzeBtn && (analyzeBtn.disabled = false);
}

function showError(msg) {
  hideAllIndicators();
  errorIndicator && errorIndicator.classList.remove('hidden');
  if (errorMessage) errorMessage.textContent = msg || 'Analysis failed';
  buttonText && (buttonText.textContent = 'Analyze Page Structure');
  analyzeBtn && (analyzeBtn.disabled = false);
}

function clearAnalyzeTimeout() {
  if (analyzeTimeoutId) {
    clearTimeout(analyzeTimeoutId);
    analyzeTimeoutId = null;
  }
}

// ---- Messaging to content script ----
async function startAnalysis() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    isAnalyzing = true;
    showLoading();

    // Robust timeout (45s). Will be cleared by analysis_complete / atlas_status.
    clearAnalyzeTimeout();
    analyzeTimeoutId = setTimeout(() => {
      if (isAnalyzing) {
        isAnalyzing = false;
        showError('Timed out while analyzing the page.');
      }
    }, 45000);

    await chrome.tabs.sendMessage(tab.id, { command: 'get_page_structure' });
  } catch (err) {
    isAnalyzing = false;
    clearAnalyzeTimeout();
    showError(err.message || 'Could not start analysis');
  }
}

// ---- Listen for background updates ----
chrome.runtime.onMessage.addListener((message) => {
  // Status pings from background
  if (message.type === 'atlas_status') {
    switch (message.status) {
      case 'loading':
        showLoading();
        break;
      case 'speaking':
        isAnalyzing = false;      // generation is done
        clearAnalyzeTimeout();
        showSpeaking();
        break;
      case 'complete':
        isAnalyzing = false;
        clearAnalyzeTimeout();
        showSuccess();
        break;
      case 'error':
        isAnalyzing = false;
        clearAnalyzeTimeout();
        showError(message.detail || 'Analysis failed');
        break;
    }
    return;
  }

  // Final payload with the LLM summary (now sent BEFORE TTS)
  if (message.type === 'analysis_complete') {
    isAnalyzing = false;
    clearAnalyzeTimeout();
    showSuccess();

    ensureSummaryUI();
    summaryText.value = message.summary || '';
    summarySource.textContent = message.source ? `source: ${message.source}` : '';
    summaryModel.textContent  = message.model  ? `model: ${message.model}`   : '';
    summarySection.style.display = 'block';
    return;
  }

  if (message.type === 'analysis_error') {
    isAnalyzing = false;
    clearAnalyzeTimeout();
    showError(message.error || 'Analysis failed');
  }
});

// ---- Settings (save API key) ----
saveApiKeyBtn?.addEventListener('click', async () => {
  const apiKey = (apiKeyInput?.value || '').trim();
  if (!apiKey) {
    apiKeyStatus.textContent = 'Please enter a valid API key';
    apiKeyStatus.className = 'api-key-status error';
    return;
  }

  try {
    // Save to either storage.local or sync; background reads local-first then sync
    await chrome.storage.local.set({ geminiApiKey: apiKey });
    apiKeyStatus.textContent = '✓ API key saved';
    apiKeyStatus.className = 'api-key-status success';
    apiKeyInput.value = '';
  } catch {
    apiKeyStatus.textContent = 'Failed to save API key';
    apiKeyStatus.className = 'api-key-status error';
  }
});

// ---- Analyze button ----
analyzeBtn?.addEventListener('click', startAnalysis);

// (Optional) settings toggle if present
settingsBtn?.addEventListener('click', () => {
  if (!settingsPanel) return;
  const isHidden = settingsPanel.classList.contains('hidden');
  settingsPanel.classList.toggle('hidden', !isHidden);
});

// ---- Init ----
(function init() {
  hideAllIndicators();
})();
