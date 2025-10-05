// popup.js — Project Sherpa

// ---- Config ----
const BACKEND_BASE = 'https://sherpa-hackharvard2025-production.up.railway.app'; // Update this to your backend URL
// const BACKEND_BASE = 'http://localhost:8000'; // Update this to your backend URL

// ---- Elements (existing IDs in your HTML) ----
const analyzeBtn = document.getElementById('analyzeBtn');
const buttonText = document.getElementById('buttonText');
const statusContainer = document.getElementById('statusContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const successIndicator = document.getElementById('successIndicator');
const errorIndicator = document.getElementById('errorIndicator');
const errorMessage = document.getElementById('errorMessage');

const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const apiKeyInput = document.getElementById('apiKey');
const saveApiKeyBtn = document.getElementById('saveApiKey');
const apiKeyStatus = document.getElementById('apiKeyStatus');

// ---- State ----
let isAnalyzing = false;
let analyzeTimeoutId = null;
let currentSessionId = null;
let pageStructureData = null;
let isRecording = false;

// ---- Microphone Permission Handling ----
async function checkMicrophonePermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Clean up the stream immediately
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error) {
    console.log('Microphone permission not granted:', error);
    return false;
  }
}

async function checkRecordingState() {
  const hasPermission = await checkMicrophonePermission();
  if (!hasPermission) {
    // Open permission page if microphone access is not granted
    chrome.tabs.create({ url: 'permission.html' });
    return;
  }

  // Check if recording is already in progress
  const contexts = await chrome.runtime.getContexts({});
  const offscreenDocument = contexts.find(
    (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
  );

  if (offscreenDocument && offscreenDocument.documentUrl.endsWith('#recording')) {
    isRecording = true;
    updateRecordButtonState();
  }
}

function updateRecordButtonState() {
  if (!recordBtn) return;

  if (isRecording) {
    recordBtn.textContent = '⏹️ Stop Recording';
    recordBtn.classList.add('recording');
    recordBtn.style.background = '#ef4444';
  } else {
    recordBtn.textContent = '🎤 Record Audio';
    recordBtn.classList.remove('recording');
    recordBtn.style.background = '';
  }
}

async function handleRecordToggle() {
  if (isRecording) {
    // Stop recording
    chrome.runtime.sendMessage({
      type: 'stop-recording',
      target: 'offscreen'
    });
    isRecording = false;
    updateRecordButtonState();
  } else {
    // Start recording
    try {
      const hasPermission = await checkMicrophonePermission();
      if (!hasPermission) {
        chrome.tabs.create({ url: 'permission.html' });
        return;
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        alert('Cannot record Chrome system pages. Please try on a regular webpage.');
        return;
      }

      // Create offscreen document if it doesn't exist
      const contexts = await chrome.runtime.getContexts({});
      const offscreenDocument = contexts.find(
        (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
      );

      if (!offscreenDocument) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['USER_MEDIA'],
          justification: 'Recording audio from the current tab'
        });
      }

      // Get stream ID and start recording
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tab.id
      });

      chrome.runtime.sendMessage({
        type: 'start-recording',
        target: 'offscreen',
        data: {
          streamId: streamId,
          session_id: currentSessionId
        }
      });
      console.log({ currentSessionId, streamId });

      isRecording = true;
      updateRecordButtonState();

    } catch (error) {
      console.error('Recording error:', error);
      alert('Failed to start recording: ' + error.message);
    }
  }
}

// ---- Summary UI (created on-demand so you DON'T have to edit popup.html) ----
let summarySection, summaryText, summarySource, summaryModel, copySummaryBtn;
let playBtn, pauseBtn, replayBtn;
let currentSummary = ''; // Store the current summary for TTS controls
let isTTSSpeaking = false;

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
  summaryModel = document.createElement('span');
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
  summaryText.style.lineHeight = '1.6';
  summaryText.style.fontSize = '14px';
  summaryText.style.fontFamily =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'space-between';
  actions.style.alignItems = 'center';
  actions.style.marginTop = '8px';
  actions.style.gap = '8px';

  // TTS Control buttons container
  const ttsControls = document.createElement('div');
  ttsControls.style.display = 'flex';
  ttsControls.style.gap = '8px';

  // Play button
  playBtn = document.createElement('button');
  playBtn.innerHTML = '▶️';
  playBtn.title = 'Play summary';
  playBtn.style.background = 'white';
  playBtn.style.color = '#1f2937';
  playBtn.style.border = 'none';
  playBtn.style.padding = '8px 12px';
  playBtn.style.fontSize = '16px';
  playBtn.style.borderRadius = '6px';
  playBtn.style.cursor = 'pointer';
  playBtn.style.transition = 'all 0.2s ease';
  playBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)';
  playBtn.addEventListener('click', () => playSummary());
  playBtn.addEventListener('mouseenter', () => {
    playBtn.style.transform = 'translateY(-1px)';
    playBtn.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.2)';
  });
  playBtn.addEventListener('mouseleave', () => {
    playBtn.style.transform = 'translateY(0)';
    playBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)';
  });

  // Pause button
  pauseBtn = document.createElement('button');
  pauseBtn.innerHTML = '⏸️';
  pauseBtn.title = 'Pause summary';
  pauseBtn.style.background = 'white';
  pauseBtn.style.color = '#1f2937';
  pauseBtn.style.border = 'none';
  pauseBtn.style.padding = '8px 12px';
  pauseBtn.style.fontSize = '16px';
  pauseBtn.style.borderRadius = '6px';
  pauseBtn.style.cursor = 'pointer';
  pauseBtn.style.transition = 'all 0.2s ease';
  pauseBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)';
  pauseBtn.style.display = 'none'; // Hidden by default
  pauseBtn.addEventListener('click', () => pauseSummary());
  pauseBtn.addEventListener('mouseenter', () => {
    pauseBtn.style.transform = 'translateY(-1px)';
    pauseBtn.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.2)';
  });
  pauseBtn.addEventListener('mouseleave', () => {
    pauseBtn.style.transform = 'translateY(0)';
    pauseBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)';
  });

  // Replay button
  replayBtn = document.createElement('button');
  replayBtn.innerHTML = '🔄';
  replayBtn.title = 'Replay summary';
  replayBtn.style.background = 'white';
  replayBtn.style.color = '#1f2937';
  replayBtn.style.border = 'none';
  replayBtn.style.padding = '8px 12px';
  replayBtn.style.fontSize = '16px';
  replayBtn.style.borderRadius = '6px';
  replayBtn.style.cursor = 'pointer';
  replayBtn.style.transition = 'all 0.2s ease';
  replayBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)';
  replayBtn.addEventListener('click', () => replaySummary());
  replayBtn.addEventListener('mouseenter', () => {
    replayBtn.style.transform = 'translateY(-1px)';
    replayBtn.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.2)';
  });
  replayBtn.addEventListener('mouseleave', () => {
    replayBtn.style.transform = 'translateY(0)';
    replayBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)';
  });

  ttsControls.appendChild(playBtn);
  ttsControls.appendChild(pauseBtn);
  ttsControls.appendChild(replayBtn);

  // Copy button
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

  actions.appendChild(ttsControls);
  actions.appendChild(copySummaryBtn);

  summarySection.appendChild(header);
  summarySection.appendChild(summaryText);
  summarySection.appendChild(actions);

  main.appendChild(summarySection);
}

// ---- TTS Control Functions ----
function playSummary() {
  if (!currentSummary) return;
  
  chrome.runtime.sendMessage({
    type: 'speak_text',
    text: currentSummary,
    langHint: pageStructureData?.language || pageStructureData?.lang || null
  });
  
  // State will be updated by tts_started/tts_ended messages
}

function pauseSummary() {
  chrome.runtime.sendMessage({ type: 'stop_tts' });
  // State will be updated by tts_ended message
}

function replaySummary() {
  // Stop current TTS and replay
  chrome.runtime.sendMessage({ type: 'stop_tts' });
  setTimeout(() => {
    playSummary();
  }, 100);
}

function updateTTSButtons() {
  if (!playBtn || !pauseBtn) return;
  
  if (isTTSSpeaking) {
    playBtn.style.display = 'none';
    pauseBtn.style.display = 'block';
  } else {
    playBtn.style.display = 'block';
    pauseBtn.style.display = 'none';
  }
}

// ---- Voice Command UI (Text Input Version) ----
let voiceSection, textInput, submitBtn, voiceDisplay, quickNavContainer, recordBtn;

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

  // Quick Navigation Suggestions
  quickNavContainer = document.createElement('div');
  quickNavContainer.id = 'quickNavContainer';
  quickNavContainer.style.marginTop = '12px';
  quickNavContainer.style.marginBottom = '12px';
  quickNavContainer.style.display = 'none'; // Hidden until we have suggestions

  const quickNavTitle = document.createElement('div');
  quickNavTitle.textContent = '✨ Quick Navigation:';
  quickNavTitle.style.fontSize = '13px';
  quickNavTitle.style.fontWeight = '600';
  quickNavTitle.style.marginBottom = '8px';
  quickNavTitle.style.color = '#fff';
  quickNavTitle.style.opacity = '0.9';
  quickNavContainer.appendChild(quickNavTitle);

  const suggestionsContainer = document.createElement('div');
  suggestionsContainer.id = 'suggestionsContainer';
  suggestionsContainer.style.display = 'flex';
  suggestionsContainer.style.flexWrap = 'wrap';
  suggestionsContainer.style.gap = '6px';
  quickNavContainer.appendChild(suggestionsContainer);

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

  // Button container for side-by-side layout
  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '8px';
  buttonContainer.style.marginBottom = '10px';
  buttonContainer.style.justifyContent = 'center';
  buttonContainer.style.alignItems = 'stretch';

  // Record button
  recordBtn = document.createElement('button');
  recordBtn.id = 'recordBtn';
  recordBtn.textContent = '🎤 Record Audio';
  recordBtn.className = 'primary-button';
  recordBtn.setAttribute('aria-label', 'Record audio');
  recordBtn.style.flex = '1';
  recordBtn.style.maxWidth = '156px';
  recordBtn.style.padding = '14px 24px';
  recordBtn.style.background = 'white';
  recordBtn.style.color = '#667eea';
  recordBtn.style.border = 'none';
  recordBtn.style.borderRadius = '8px';
  recordBtn.style.cursor = 'pointer';
  recordBtn.style.fontWeight = '700';
  recordBtn.style.fontSize = '16px';
  recordBtn.style.transition = 'all 0.2s ease';
  recordBtn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  recordBtn.style.textTransform = 'uppercase';
  recordBtn.style.letterSpacing = '0.5px';

  // Hover effects for record button
  recordBtn.addEventListener('mouseenter', () => {
    if (!isRecording) {
      recordBtn.style.transform = 'translateY(-2px) scale(1.02)';
      recordBtn.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
    }
  });
  recordBtn.addEventListener('mouseleave', () => {
    if (!isRecording) {
      recordBtn.style.transform = 'translateY(0) scale(1)';
      recordBtn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    }
  });

  // Submit button (prominent primary action)
  submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Command';
  submitBtn.style.flex = '1';
  submitBtn.style.maxWidth = '156px';
  submitBtn.style.padding = '14px 24px';
  submitBtn.style.background = 'white';
  submitBtn.style.color = '#667eea';
  submitBtn.style.border = 'none';
  submitBtn.style.borderRadius = '8px';
  submitBtn.style.cursor = 'pointer';
  submitBtn.style.fontWeight = '700';
  submitBtn.style.fontSize = '16px';
  submitBtn.style.transition = 'all 0.2s ease';
  submitBtn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  submitBtn.style.textTransform = 'uppercase';
  submitBtn.style.letterSpacing = '0.5px';

  // Hover effects for submit button
  submitBtn.addEventListener('mouseenter', () => {
    submitBtn.style.transform = 'translateY(-2px) scale(1.02)';
    submitBtn.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
  });
  submitBtn.addEventListener('mouseleave', () => {
    submitBtn.style.transform = 'translateY(0) scale(1)';
    submitBtn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  });

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
  recordBtn.addEventListener('click', handleRecordToggle);
  textInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleCommand();
    }
  });

  // Add buttons to button container
  buttonContainer.appendChild(recordBtn);
  buttonContainer.appendChild(submitBtn);

  voiceSection.appendChild(header);
  voiceSection.appendChild(quickNavContainer); // Add quick nav before input
  voiceSection.appendChild(textInput);
  voiceSection.appendChild(buttonContainer); // Add button container instead of individual buttons
  voiceSection.appendChild(voiceDisplay);

  main.appendChild(voiceSection);
}

// ---- Quick Navigation Suggestions ----
function populateNavigationSuggestions() {
  if (!pageStructureData || !pageStructureData.sections) return;

  const suggestionsContainer = document.getElementById('suggestionsContainer');
  if (!suggestionsContainer) return;

  // Clear existing suggestions
  suggestionsContainer.innerHTML = '';

  // Get interesting sections (content sections, not UI elements)
  const interestingSections = pageStructureData.sections
    .filter(section => {
      // Prioritize content headings
      if (section.type === 'content') return true;

      // Include main landmarks
      const goodRoles = ['main', 'footer', 'navigation'];
      if (goodRoles.includes(section.role)) return true;

      return false;
    })
    .slice(0, 8); // Limit to 8 suggestions max

  if (interestingSections.length === 0) {
    quickNavContainer.style.display = 'none';
    return;
  }

  // Create suggestion buttons (inverted style - purple background)
  interestingSections.forEach(section => {
    const btn = document.createElement('button');
    btn.textContent = section.label;
    btn.style.padding = '8px 16px';
    btn.style.background = '#667eea';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.borderRadius = '20px';
    btn.style.fontSize = '13px';
    btn.style.fontWeight = '600';
    btn.style.cursor = 'pointer';
    btn.style.transition = 'all 0.2s ease';
    btn.style.whiteSpace = 'nowrap';
    btn.style.overflow = 'hidden';
    btn.style.textOverflow = 'ellipsis';
    btn.style.maxWidth = '150px';
    btn.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)';

    // Hover effects
    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#5a67d8';
      btn.style.transform = 'translateY(-2px) scale(1.05)';
      btn.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.5)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#667eea';
      btn.style.transform = 'translateY(0) scale(1)';
      btn.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)';
    });

    // Click to navigate
    btn.addEventListener('click', async () => {
      textInput.value = `go to ${section.label}`;
      await handleCommand();
    });

    suggestionsContainer.appendChild(btn);
  });

  // Show the container
  quickNavContainer.style.display = 'block';
}

// ---- Backend Integration Functions ----

async function createBackendSession(pageData) {
  try {
    // voiceDisplay.textContent = '🔄 Creating navigation session...';

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

    // voiceDisplay.textContent = `✅ Session created! You can now use navigation commands.\n\nTry: "go to navigation", "scroll to footer", etc.`;
    populateNavigationSuggestions();


    console.log('Session created:', currentSessionId);
    return result;

  } catch (error) {
    console.error('Session creation error:', error);
    // voiceDisplay.textContent = `❌ Failed to create session: ${error.message}\n\nMake sure your backend server is running at ${BACKEND_BASE}`;
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

// Process interpretation result (reusable for both text and voice commands)
async function processInterpretation(interpretation, originalCommand = null) {
  if (!voiceDisplay) {
    console.error('voiceDisplay not initialized');
    return;
  }

  console.log('🎯 INTERPRETATION:', JSON.stringify(interpretation, null, 2));

  // Show the original command if provided (for voice commands)
  let displayText = originalCommand 
    ? `🎤 Heard: "${originalCommand}"\n\n💬 ${interpretation.tts_text}\n\n`
    : `💬 ${interpretation.tts_text}\n\n`;

  voiceDisplay.textContent = displayText;

  try {
    // Speak the TTS text
    if (interpretation.tts_text) {
      const langHint = pageStructureData?.language || pageStructureData?.lang || null;
      chrome.runtime.sendMessage({
        type: 'speak_text',
        text: interpretation.tts_text,
        langHint: langHint
      }).catch(err => {
        console.error('TTS error:', err);
      });
    }

    // Navigate if intent is NAVIGATE
    if (interpretation.intent === 'NAVIGATE' && interpretation.target_section_id) {
      voiceDisplay.textContent += `🧭 Navigating to: ${interpretation.target_section_id}...\n`;

      await navigateToSection(interpretation.target_section_id);

      voiceDisplay.textContent += `✅ Successfully navigated!\n\nConfidence: ${(interpretation.confidence * 100).toFixed(1)}%`;
    } else if (interpretation.intent === 'LIST_SECTIONS') {
      // Show sections in the display
      voiceDisplay.textContent += '\n📋 Available sections:\n';
      if (pageStructureData && pageStructureData.sections) {
        pageStructureData.sections.forEach(section => {
          voiceDisplay.textContent += `  • ${section.label} (${section.role})\n`;
        });
      }
      voiceDisplay.textContent += `\nConfidence: ${(interpretation.confidence * 100).toFixed(1)}%`;
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
  } catch (error) {
    voiceDisplay.textContent += `\n\n❌ Navigation Error: ${error.message}`;
  }
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
    
    // Step 2: Process the interpretation
    await processInterpretation(interpretation);

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
  errorIndicator && errorIndicator.classList.add('hidden');
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
chrome.runtime.onMessage.addListener(async (message) => {
  // Handle recording messages
  if (message.target === 'popup') {
    switch (message.type) {
      case 'recording-error':
        alert(message.error);
        isRecording = false;
        updateRecordButtonState();
        break;
      case 'recording-stopped':
        isRecording = false;
        updateRecordButtonState();
        if (voiceDisplay) {
          voiceDisplay.textContent = '🎤 Recording stopped. Processing audio...';
        }
        break;
      case 'recording-started':
        isRecording = true;
        updateRecordButtonState();
        if (voiceDisplay) {
          voiceDisplay.textContent = '🔴 Recording in progress... Speak your command now.';
        }
        break;
      case 'voice-interpretation-complete':
        // Handle voice command interpretation result
        if (voiceDisplay) {
          voiceDisplay.textContent = '🔄 Processing voice command...';
        }
        try {
          await processInterpretation(
            message.interpretation, 
            message.interpretation.transcription || 'Voice command'
          );
        } catch (error) {
          if (voiceDisplay) {
            voiceDisplay.textContent = `❌ Error processing voice command: ${error.message}`;
          }
        }
        break;
      case 'voice-interpretation-error':
        if (voiceDisplay) {
          voiceDisplay.textContent = `❌ Voice interpretation error: ${message.error}`;
        } else {
          alert(`Voice interpretation error: ${message.error}`);
        }
        break;
    }
    return;
  }

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
    currentSummary = message.summary || ''; // Store for TTS controls
    summaryText.value = currentSummary;
    summarySource.textContent = message.source ? `source: ${message.source}` : '';
    summaryModel.textContent = message.model ? `model: ${message.model}` : '';
    summarySection.style.display = 'block';
    updateTTSButtons();

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

  // Handle TTS state changes
  if (message.type === 'tts_started') {
    isTTSSpeaking = true;
    updateTTSButtons();
  }

  if (message.type === 'tts_ended') {
    isTTSSpeaking = false;
    updateTTSButtons();
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

    // Auto-close settings after 1 second
    setTimeout(() => {
      settingsPanel?.classList.add('hidden');
    }, 1000);
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
(async function init() {
  hideAllIndicators();
  // Check recording state and microphone permissions on popup load
  await checkRecordingState();

  // Analyze button
  analyzeBtn?.addEventListener('click', startAnalysis);

  // Settings button - open overlay
  settingsBtn?.addEventListener('click', () => {
    console.log('Settings button clicked'); // Debug
    if (!settingsPanel) {
      console.error('Settings panel not found!');
      return;
    }
    settingsPanel.classList.remove('hidden');
  });

  // Close settings button
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', (e) => {
      console.log('Close button clicked'); // Debug
      e.stopPropagation(); // Prevent event bubbling
      if (settingsPanel) {
        settingsPanel.classList.add('hidden');
      }
    });
  } else {
    console.error('Close settings button not found!');
  }

  // Close settings when clicking outside the panel
  settingsPanel?.addEventListener('click', (e) => {
    if (e.target === settingsPanel) {
      settingsPanel.classList.add('hidden');
    }
  });
})();

