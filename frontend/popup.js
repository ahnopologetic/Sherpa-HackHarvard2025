// popup.js — Project Atlas

// ---- Config ----
const BACKEND_BASE = 'https://sherpa-hackharvard2025-production.up.railway.app'; // Update this to your backend URL

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
let currentSessionId = null;
let pageStructureData = null;

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

// ---- Voice Command UI (Text Input Version) ----
let voiceSection, textInput, submitBtn, voiceDisplay;

function ensureVoiceUI() {
  if (voiceSection) return;

  const main = document.querySelector('main') || document.body;

  voiceSection = document.createElement('section');
  voiceSection.id = 'voiceSection';
  voiceSection.style.marginTop = '12px';
  voiceSection.style.background = 'rgba(255, 255, 255, 0.18)';
  voiceSection.style.borderRadius = '8px';
  voiceSection.style.padding = '12px';
  voiceSection.style.display = 'none';

  const header = document.createElement('div');
  header.style.marginBottom = '8px';

  const title = document.createElement('h2');
  title.textContent = 'Navigation Command';
  title.style.fontSize = '16px';
  title.style.fontWeight = '700';
  header.appendChild(title);

  // Text input for commands
  textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Type your command here (e.g., "go to navigation", "scroll to footer")';
  textInput.style.width = '100%';
  textInput.style.padding = '8px';
  textInput.style.border = '1px solid #ccc';
  textInput.style.borderRadius = '4px';
  textInput.style.marginBottom = '8px';
  textInput.style.fontSize = '14px';
  textInput.style.boxSizing = 'border-box';

  // Submit button
  submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Command';
  submitBtn.style.width = '100%';
  submitBtn.style.padding = '10px';
  submitBtn.style.background = '#10b981';
  submitBtn.style.color = 'white';
  submitBtn.style.border = 'none';
  submitBtn.style.borderRadius = '4px';
  submitBtn.style.cursor = 'pointer';
  submitBtn.style.fontWeight = '600';
  submitBtn.style.marginBottom = '10px';

  voiceDisplay = document.createElement('div');
  voiceDisplay.id = 'voiceDisplay';
  voiceDisplay.style.minHeight = '60px';
  voiceDisplay.style.padding = '10px';
  voiceDisplay.style.background = 'rgba(255,255,255,0.9)';
  voiceDisplay.style.borderRadius = '6px';
  voiceDisplay.style.color = '#1f2937';
  voiceDisplay.style.fontSize = '14px';
  voiceDisplay.style.lineHeight = '1.4';
  voiceDisplay.style.marginTop = '10px';
  voiceDisplay.textContent = 'Type your navigation command above and click Submit...';

  // Event listeners
  submitBtn.addEventListener('click', handleCommand);
  textInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleCommand();
    }
  });

  voiceSection.appendChild(header);
  voiceSection.appendChild(textInput);
  voiceSection.appendChild(submitBtn);
  voiceSection.appendChild(voiceDisplay);

  main.appendChild(voiceSection);
}

// ---- Backend Integration Functions ----

async function createBackendSession(pageData) {
  try {
    voiceDisplay.textContent = '🔄 Creating navigation session...';
    
    const payload = {
      url: pageData.url,
      locale: pageData.language || 'en-US',
      section_map: {
        title: pageData.title,
        sections: pageData.sections,
        aliases: {} // Can be enhanced later
      }
      
    };
    console.log('📤 SENDING TO BACKEND:', JSON.stringify(payload, null, 2));

    const response = await fetch(`${BACKEND_BASE}/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Session creation failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    currentSessionId = result.session_id;
    
    voiceDisplay.textContent = `✅ Session created! You can now use navigation commands.\n\nTry: "go to navigation", "scroll to footer", etc.`;
    
    console.log('Session created:', currentSessionId);
    return result;
    
  } catch (error) {
    console.error('Session creation error:', error);
    voiceDisplay.textContent = `❌ Failed to create session: ${error.message}\n\nMake sure your backend server is running at ${BACKEND_BASE}`;
    throw error;
  }
}

async function interpretCommand(command) {
  if (!currentSessionId) {
    throw new Error('No active session. Please analyze the page first.');
  }

  try {
    const formData = new FormData();
    formData.append('text', command);

    const response = await fetch(
      `${BACKEND_BASE}/v1/sessions/${currentSessionId}/interpret?mode=text`,
      {
        method: 'POST',
        body: formData
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Interpretation failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log('Interpretation result:', result);
    return result;
    
  } catch (error) {
    console.error('Interpretation error:', error);
    throw error;
  }
}

async function navigateToSection(sectionId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    const response = await chrome.tabs.sendMessage(tab.id, {
      command: 'navigate_to_section',
      sectionId: sectionId
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Navigation failed');
    }

    return true;
  } catch (error) {
    console.error('Navigation error:', error);
    throw error;
  }
  console.log('🧭 NAVIGATING TO:', sectionId);
}

async function handleCommand() {
  const command = textInput.value.trim();
  if (!command) {
    voiceDisplay.textContent = '❌ Please enter a command first.';
    return;
  }

  submitBtn.disabled = true;
  voiceDisplay.textContent = `🔄 Processing: "${command}"...`;
  
  try {
    // Step 1: Interpret the command
    const interpretation = await interpretCommand(command);
    console.log('🎯 INTERPRETATION:', JSON.stringify(interpretation, null, 2));
    // Step 2: Show the TTS text from backend
    voiceDisplay.textContent = `💬 ${interpretation.tts_text}\n\n`;
    
    // Step 3: Navigate if intent is NAVIGATE
    if (interpretation.intent === 'NAVIGATE' && interpretation.target_section_id) {
      voiceDisplay.textContent += `🧭 Navigating to: ${interpretation.target_section_id}...\n`;
      
      await navigateToSection(interpretation.target_section_id);
      
      voiceDisplay.textContent += `✅ Successfully navigated!\n\nConfidence: ${(interpretation.confidence * 100).toFixed(1)}%`;
    } else if (interpretation.intent === 'LIST_SECTIONS') {
      voiceDisplay.textContent += '\n📋 Available sections:\n';
      if (pageStructureData && pageStructureData.sections) {
        pageStructureData.sections.forEach(section => {
          voiceDisplay.textContent += `  • ${section.label} (${section.role})\n`;
        });
      }
    } else {
      voiceDisplay.textContent += `\nIntent: ${interpretation.intent}`;
    }
    
    // Show alternatives if available
    if (interpretation.alternatives && interpretation.alternatives.length > 0) {
      voiceDisplay.textContent += '\n\n📌 Alternatives:';
      interpretation.alternatives.forEach(alt => {
        voiceDisplay.textContent += `\n  • ${alt.label} (${(alt.confidence * 100).toFixed(1)}%)`;
      });
    }
    
    // Clear input
    textInput.value = '';
    
  } catch (error) {
    voiceDisplay.textContent = `❌ Error: ${error.message}`;
  } finally {
    submitBtn.disabled = false;
  }
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
  if (message.type === 'atlas_status') {
    switch (message.status) {
      case 'loading':
        showLoading();
        break;
      case 'speaking':
        isAnalyzing = false;
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

  if (message.type === 'analysis_complete') {
    isAnalyzing = false;
    clearAnalyzeTimeout();
    showSuccess();

    ensureSummaryUI();
    summaryText.value = message.summary || '';
    summarySource.textContent = message.source ? `source: ${message.source}` : '';
    summaryModel.textContent  = message.model  ? `model: ${message.model}`   : '';
    summarySection.style.display = 'block';
    
    // Show voice command UI and create backend session
    ensureVoiceUI();
    voiceSection.style.display = 'block';
    
    // Store page structure for later use
    if (message.pageStructure) {
      pageStructureData = message.pageStructure;
    }
    
    return;
  }

  // Handle page structure data for backend session
  if (message.type === 'page_structure_for_session') {
    pageStructureData = message.data;
    
    // Create backend session with the page structure
    createBackendSession(message.data).catch(error => {
      console.error('Failed to create backend session:', error);
    });
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

