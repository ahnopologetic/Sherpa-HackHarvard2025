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
let pendingAutoSummary = null; // Store summary that needs to be played when popup opens

// ---- Audio ----
let loadingSound = null;
let loadingSoundInterval = null;
let notificationSound = null;

function initLoadingSound() {
  if (!loadingSound) {
    loadingSound = new Audio('assets/viscous-liquid-fall-in-83980.mp3');
    loadingSound.loop = false; // Don't use native loop, we'll use setInterval
  }
}

function initNotificationSound() {
  if (!notificationSound) {
    notificationSound = new Audio('assets/notification-291227.mp3');
    notificationSound.loop = false;
  }
}

function playNotificationSound() {
  try {
    initNotificationSound();
    notificationSound.currentTime = 0;
    notificationSound.play().catch(err => {
      console.log('Could not play notification sound:', err);
    });
  } catch (error) {
    console.log('Error initializing notification sound:', error);
  }
}

function playLoadingSound() {
  try {
    initLoadingSound();
    
    // Play immediately first time
    loadingSound.currentTime = 0;
    loadingSound.play().catch(err => {
      console.log('Could not play loading sound:', err);
    });
    
    // Then repeat every 5 seconds
    if (loadingSoundInterval) {
      clearInterval(loadingSoundInterval);
    }
    
    loadingSoundInterval = setInterval(() => {
      loadingSound.currentTime = 0; // Reset to start
      loadingSound.play().catch(err => {
        console.log('Could not play loading sound:', err);
      });
    }, 5000); // 5 seconds
    
  } catch (error) {
    console.log('Error initializing loading sound:', error);
  }
}

function stopLoadingSound() {
  // Clear the interval
  if (loadingSoundInterval) {
    clearInterval(loadingSoundInterval);
    loadingSoundInterval = null;
  }
  
  // Stop the audio
  if (loadingSound) {
    loadingSound.pause();
    loadingSound.currentTime = 0;
  }
}

// ---- Accessibility Helper Functions ----
function announceToScreenReader(message, priority = 'polite') {
  const announcer = document.getElementById('srAnnouncements');
  if (!announcer) return;
  
  // Clear previous announcement
  announcer.textContent = '';
  
  // Set new announcement with slight delay to ensure it's picked up
  setTimeout(() => {
    announcer.textContent = message;
    announcer.setAttribute('aria-live', priority);
  }, 100);
  
  // Clear after 3 seconds
  setTimeout(() => {
    announcer.textContent = '';
  }, 3000);
}

function setAriaLabelForButton(button, label) {
  if (button) {
    button.setAttribute('aria-label', label);
  }
}

function setAriaDisabled(element, disabled) {
  if (element) {
    element.setAttribute('aria-disabled', disabled.toString());
    if (disabled) {
      element.disabled = true;
    } else {
      element.disabled = false;
    }
  }
}

function manageFocusTrap(element, isActive) {
  if (!element) return;
  
  const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusableElements = element.querySelectorAll(focusableSelectors);
  
  if (isActive && focusableElements.length > 0) {
    // Focus first element when opening
    focusableElements[0].focus();
    
    // Trap focus within element
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    element.addEventListener('keydown', function trapFocus(e) {
      if (e.key !== 'Tab') return;
      
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    });
  }
}

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
    recordBtn.innerHTML = '<span aria-hidden="true">⏹️</span> Stop Recording';
    recordBtn.setAttribute('aria-label', 'Stop audio recording');
    recordBtn.setAttribute('aria-pressed', 'true');
    recordBtn.classList.add('recording');
    recordBtn.style.background = '#ef4444';
    announceToScreenReader('Recording started. Speak your navigation command.', 'assertive');
  } else {
    recordBtn.innerHTML = '<span aria-hidden="true">🎤</span> Record Audio';
    recordBtn.setAttribute('aria-label', 'Record audio navigation command');
    recordBtn.setAttribute('aria-pressed', 'false');
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

function ensureSummaryUI() {
  if (summarySection) return;

  const main = document.querySelector('main') || document.body;

  summarySection = document.createElement('section');
  summarySection.id = 'summarySection';
  summarySection.setAttribute('role', 'region');
  summarySection.setAttribute('aria-labelledby', 'summaryTitle');
  summarySection.setAttribute('aria-live', 'polite');
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
  title.id = 'summaryTitle';
  title.textContent = 'Summary';
  title.style.fontSize = '16px';
  title.style.fontWeight = '700';
  header.appendChild(title);

  const meta = document.createElement('div');
  meta.setAttribute('role', 'complementary');
  meta.setAttribute('aria-label', 'Summary metadata');
  meta.style.fontSize = '12px';
  meta.style.opacity = '0.9';
  meta.style.display = 'flex';
  meta.style.gap = '8px';

  summarySource = document.createElement('span');
  summarySource.setAttribute('aria-label', 'Analysis source');
  summaryModel = document.createElement('span');
  summaryModel.setAttribute('aria-label', 'AI model used');
  meta.appendChild(summarySource);
  meta.appendChild(summaryModel);
  header.appendChild(meta);

  summaryText = document.createElement('textarea');
  summaryText.id = 'summaryText';
  summaryText.rows = 7;
  summaryText.readOnly = true;
  summaryText.setAttribute('aria-label', 'AI generated page summary');
  summaryText.setAttribute('aria-describedby', 'summaryHelp');
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

  const helpText = document.createElement('span');
  helpText.id = 'summaryHelp';
  helpText.className = 'visually-hidden';
  helpText.textContent = 'This is the AI-generated summary of the current page structure. Use text-to-speech controls to listen or copy button to save the content.';

  const actions = document.createElement('div');
  actions.setAttribute('role', 'toolbar');
  actions.setAttribute('aria-label', 'Summary actions');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.marginTop = '8px';
  actions.style.gap = '8px';

  // TTS Control buttons container
  const ttsControls = document.createElement('div');
  ttsControls.setAttribute('role', 'group');
  ttsControls.setAttribute('aria-label', 'Text-to-speech controls');
  ttsControls.style.display = 'flex';
  ttsControls.style.gap = '8px';

  // Play button
  playBtn = document.createElement('button');
  playBtn.innerHTML = '<span aria-hidden="true">▶️</span>';
  playBtn.setAttribute('aria-label', 'Play summary using text-to-speech');
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
  pauseBtn.innerHTML = '<span aria-hidden="true">⏸️</span>';
  pauseBtn.setAttribute('aria-label', 'Pause text-to-speech playback');
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
  replayBtn.innerHTML = '<span aria-hidden="true">🔄</span>';
  replayBtn.setAttribute('aria-label', 'Replay summary from the beginning');
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
  copySummaryBtn.setAttribute('aria-label', 'Copy summary text to clipboard');
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
      copySummaryBtn.setAttribute('aria-label', 'Summary copied to clipboard');
      announceToScreenReader('Summary copied to clipboard', 'assertive');
      setTimeout(() => {
        copySummaryBtn.textContent = 'Copy';
        copySummaryBtn.setAttribute('aria-label', 'Copy summary text to clipboard');
      }, 1200);
    } catch {
      copySummaryBtn.textContent = 'Copy failed';
      copySummaryBtn.setAttribute('aria-label', 'Failed to copy summary');
      announceToScreenReader('Failed to copy summary', 'assertive');
      setTimeout(() => {
        copySummaryBtn.textContent = 'Copy';
        copySummaryBtn.setAttribute('aria-label', 'Copy summary text to clipboard');
      }, 1200);
    }
  });

  actions.appendChild(copySummaryBtn);

  summarySection.appendChild(header);
  summarySection.appendChild(helpText);
  summarySection.appendChild(summaryText);
  summarySection.appendChild(actions);

  main.appendChild(summarySection);
}

// ---- Voice Command UI (Text Input Version) ----
let voiceSection, textInput, submitBtn, voiceDisplay, quickNavContainer, recordBtn;

function ensureVoiceUI() {
  if (voiceSection) return;

  const main = document.querySelector('main') || document.body;

  voiceSection = document.createElement('section');
  voiceSection.id = 'voiceSection';
  voiceSection.setAttribute('role', 'region');
  voiceSection.setAttribute('aria-labelledby', 'voiceCommandTitle');
  voiceSection.style.marginTop = '12px';
  voiceSection.style.background = 'rgba(255, 255, 255, 0.18)';
  voiceSection.style.borderRadius = '8px';
  voiceSection.style.padding = '12px';
  voiceSection.style.display = 'none';

  const header = document.createElement('div');
  header.style.marginBottom = '8px';

  const title = document.createElement('h2');
  title.id = 'voiceCommandTitle';
  title.textContent = 'Navigation Command';
  title.style.fontSize = '16px';
  title.style.fontWeight = '700';
  header.appendChild(title);

  // Quick Navigation Suggestions
  quickNavContainer = document.createElement('div');
  quickNavContainer.id = 'quickNavContainer';
  quickNavContainer.setAttribute('role', 'navigation');
  quickNavContainer.setAttribute('aria-label', 'Quick navigation suggestions');
  quickNavContainer.style.marginTop = '12px';
  quickNavContainer.style.marginBottom = '12px';
  quickNavContainer.style.display = 'none'; // Hidden until we have suggestions

  const quickNavTitle = document.createElement('div');
  quickNavTitle.textContent = '✨ Quick Navigation:';
  quickNavTitle.setAttribute('aria-hidden', 'true');
  quickNavTitle.style.fontSize = '13px';
  quickNavTitle.style.fontWeight = '600';
  quickNavTitle.style.marginBottom = '8px';
  quickNavTitle.style.color = '#fff';
  quickNavTitle.style.opacity = '0.9';
  quickNavContainer.appendChild(quickNavTitle);

  const suggestionsContainer = document.createElement('div');
  suggestionsContainer.id = 'suggestionsContainer';
  suggestionsContainer.setAttribute('role', 'list');
  suggestionsContainer.style.display = 'flex';
  suggestionsContainer.style.flexWrap = 'wrap';
  suggestionsContainer.style.gap = '6px';
  quickNavContainer.appendChild(suggestionsContainer);

  // Text input for commands
  textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.setAttribute('aria-label', 'Enter navigation command');
  textInput.setAttribute('aria-describedby', 'commandInputHelp');
  textInput.placeholder = 'Type your command here (e.g., "go to navigation", "scroll to footer")';
  textInput.style.width = '100%';
  textInput.style.padding = '8px';
  textInput.style.border = '1px solid #ccc';
  textInput.style.borderRadius = '4px';
  textInput.style.marginBottom = '8px';
  textInput.style.fontSize = '14px';
  textInput.style.boxSizing = 'border-box';

  const inputHelp = document.createElement('span');
  inputHelp.id = 'commandInputHelp';
  inputHelp.className = 'visually-hidden';
  inputHelp.textContent = 'Enter a navigation command like go to navigation, scroll to footer, or press enter to submit';

  // Button container for side-by-side layout
  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '8px';
  buttonContainer.style.marginBottom = '10px';
  buttonContainer.style.justifyContent = 'space-evenly';
  buttonContainer.style.alignItems = 'stretch';
  buttonContainer.style.flexWrap = 'wrap';

  // Record button
  recordBtn = document.createElement('button');
  recordBtn.id = 'recordBtn';
  recordBtn.innerHTML = '<span aria-hidden="true">🎤</span> Record Audio';
  recordBtn.className = 'primary-button';
  recordBtn.setAttribute('aria-label', 'Record audio navigation command');
  recordBtn.setAttribute('aria-pressed', 'false');
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

  // Explain Images button
  const explainImagesBtn = document.createElement('button');
  explainImagesBtn.id = 'explainImagesBtn';
  explainImagesBtn.textContent = '🖼️ Explain Images';
  explainImagesBtn.className = 'primary-button flex-button';
  explainImagesBtn.setAttribute('aria-label', 'Explain images in viewport');
  explainImagesBtn.style.textTransform = 'uppercase';

  // Section Summary button
  const sectionSummaryBtn = document.createElement('button');
  sectionSummaryBtn.id = 'sectionSummaryBtn';
  sectionSummaryBtn.textContent = '📄 Section Summary';
  sectionSummaryBtn.className = 'primary-button flex-button';
  sectionSummaryBtn.setAttribute('aria-label', 'Generate summary of current section');
  sectionSummaryBtn.style.textTransform = 'uppercase';

  // Immersive Summary button
  const immersiveSummaryBtn = document.createElement('button');
  immersiveSummaryBtn.id = 'immersiveSummaryBtn';
  immersiveSummaryBtn.textContent = '🎭 Immersive Summary';
  immersiveSummaryBtn.className = 'primary-button flex-button';
  immersiveSummaryBtn.setAttribute('aria-label', 'Generate comprehensive summary with images and screenshots');
  immersiveSummaryBtn.style.textTransform = 'uppercase';
  explainImagesBtn.style.letterSpacing = '0.5px';

  // Hover effects for explain images button
  explainImagesBtn.addEventListener('mouseenter', () => {
    explainImagesBtn.style.transform = 'translateY(-2px) scale(1.02)';
    explainImagesBtn.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
  });
  explainImagesBtn.addEventListener('mouseleave', () => {
    explainImagesBtn.style.transform = 'translateY(0) scale(1)';
    explainImagesBtn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  });

  // Submit button (prominent primary action)
  submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Command';
  submitBtn.setAttribute('aria-label', 'Submit navigation command');
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
  voiceDisplay.setAttribute('role', 'status');
  voiceDisplay.setAttribute('aria-live', 'polite');
  voiceDisplay.setAttribute('aria-atomic', 'true');
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
  explainImagesBtn.addEventListener('click', handleExplainImages);
  sectionSummaryBtn.addEventListener('click', generateSectionSummary);
  immersiveSummaryBtn.addEventListener('click', generateImmersiveSummary);
  textInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleCommand();
    }
  });

  // Add buttons to button container
  buttonContainer.appendChild(recordBtn);
  buttonContainer.appendChild(explainImagesBtn);
  buttonContainer.appendChild(sectionSummaryBtn);
  buttonContainer.appendChild(immersiveSummaryBtn);
  buttonContainer.appendChild(submitBtn);

  voiceSection.appendChild(header);
  voiceSection.appendChild(quickNavContainer); // Add quick nav before input
  voiceSection.appendChild(inputHelp);
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
    const listItem = document.createElement('div');
    listItem.setAttribute('role', 'listitem');
    
    const btn = document.createElement('button');
    btn.textContent = section.label;
    btn.setAttribute('aria-label', `Navigate to ${section.label}`);
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
      announceToScreenReader(`Navigating to ${section.label}`, 'polite');
      await handleCommand();
    });

    listItem.appendChild(btn);
    suggestionsContainer.appendChild(listItem);
  });

  // Show the container
  quickNavContainer.style.display = 'block';
  announceToScreenReader(`${interestingSections.length} quick navigation shortcuts available`, 'polite');
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

// ===== Viewport Image Explanation Function =====
async function handleExplainImages() {
  try {
    console.log('🖼️ Starting viewport image explanation...');
    
    if (voiceDisplay) {
      voiceDisplay.textContent = '🔄 Extracting and explaining images from current viewport...';
    }
    
    // Get the current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Send message to content script to extract viewport images
    const response = await chrome.tabs.sendMessage(tab.id, {
      command: 'extract_viewport_images'
    });
    
    if (response?.ok && response.images?.length > 0) {
      console.log('📊 VIEWPORT IMAGES EXTRACTED:', response.images);
      
      if (voiceDisplay) {
        voiceDisplay.textContent = `🖼️ Found ${response.images.length} images. Explaining each one...`;
      }
      
      // Explain each image using the new general Q&A endpoint
      const explanations = [];
      
      for (let i = 0; i < Math.min(3, response.images.length); i++) {
        const img = response.images[i];
        const filename = img.src.split('/').pop().split('.')[0] || 'image';
        
        try {
          // Create a prompt for image explanation
          const imagePrompt = `I need you to explain an image for a visually impaired user. Here are the details:

Image Information:
- Filename: ${filename}
- Alt text: ${img.alt || 'No alt text provided'}
- Context from page: ${img.context || 'No context available'}
- Page: ${tab.title}
- Section: ${img.section || 'Unknown section'}

Please provide a helpful description of what this image likely shows based on the filename, alt text, and surrounding context. Focus on:
1. What the image probably depicts
2. Why it's relevant to the article content
3. Key details that would help someone understand the image

Keep your explanation conversational and under 100 words.`;
          
          // Use new general Q&A endpoint for image explanation
          const imageResponse = await askGeneralQuestion(
            imagePrompt,
            `Image context: ${img.context || 'No context available'}. Page section: ${img.section || 'Unknown section'}`,
            tab.title,
            tab.url
          );
          
          if (imageResponse && imageResponse.answer) {
            explanations.push(`Image ${i + 1}: ${imageResponse.answer}`);
            console.log(`📷 Image ${i + 1} explained:`, imageResponse.answer);
          } else {
            explanations.push(`Image ${i + 1}: Could not analyze this image.`);
          }
          
        } catch (error) {
          console.error(`Error explaining image ${i + 1}:`, error);
          explanations.push(`Image ${i + 1}: Error analyzing image.`);
        }
      }
      
      // Display all explanations
      if (voiceDisplay) {
        voiceDisplay.textContent = `🖼️ Image Explanations:\n\n${explanations.join('\n\n')}`;
      }
      
      // Use TTS to read the first explanation
      if (explanations.length > 0) {
        chrome.runtime.sendMessage({
          type: 'speak_text',
          text: explanations[0]
        });
      }
      
    } else {
      console.log('❌ No images found in viewport');
      if (voiceDisplay) {
        voiceDisplay.textContent = '❌ No images found in the current viewport.';
      }
    }
    
  } catch (error) {
    console.error('❌ Error explaining viewport images:', error);
    if (voiceDisplay) {
      voiceDisplay.textContent = `❌ Error: ${error.message}`;
    }
  }
}

// ===== Section Summary Function =====
async function generateSectionSummary() {
  try {
    console.log('📄 Generating section summary...');
    
    if (voiceDisplay) {
      voiceDisplay.textContent = '🔄 Analyzing current section...';
    }
    
    // Get the current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Send message to content script to extract current section
    const response = await chrome.tabs.sendMessage(tab.id, {
      command: 'extract_current_section'
    });
    
    if (response?.ok && response.sectionContent) {
      const sectionData = response.sectionContent;
      console.log('📊 SECTION CONTENT EXTRACTED:', sectionData);
      
      if (voiceDisplay) {
        voiceDisplay.textContent = `📄 Analyzing section: "${sectionData.sectionTitle}" (${sectionData.wordCount} words)...`;
      }
      
      // Create a prompt for section summary
      const sectionPrompt = `Please create a concise summary of this section for a visually impaired user.

Section: "${sectionData.sectionTitle}"
Content: ${sectionData.content.substring(0, 2000)}${sectionData.content.length > 2000 ? '...' : ''}

Please provide:
1. A brief overview of what this section covers
2. The main points or key information
3. Any important details that would be helpful for accessibility

Keep the summary under 150 words and make it conversational and accessible.`;
      
      try {
        // Use new general Q&A endpoint for section summary
        const summaryResponse = await askGeneralQuestion(
          sectionPrompt,
          sectionData.content,
          tab.title,
          tab.url
        );
        
        if (summaryResponse && summaryResponse.answer) {
          if (voiceDisplay) {
            voiceDisplay.textContent = `📄 Section Summary: "${sectionData.sectionTitle}"\n\n${summaryResponse.answer}`;
          }
          
          // Use TTS to read the section summary
          chrome.runtime.sendMessage({
            type: 'speak_text',
            text: summaryResponse.answer
          });
          
          console.log('📄 Section summary generated:', summaryResponse.answer);
        } else {
          // Fallback: create a simple summary from the content
          const simpleSummary = createSimpleSummary(sectionData);
          if (voiceDisplay) {
            voiceDisplay.textContent = `📄 Section Summary: "${sectionData.sectionTitle}"\n\n${simpleSummary}`;
          }
          
          chrome.runtime.sendMessage({
            type: 'speak_text',
            text: simpleSummary
          });
        }
      } catch (error) {
        console.error('Error with general Q&A endpoint, using fallback:', error);
        // Fallback: create a simple summary from the content
        const simpleSummary = createSimpleSummary(sectionData);
        if (voiceDisplay) {
          voiceDisplay.textContent = `📄 Section Summary: "${sectionData.sectionTitle}"\n\n${simpleSummary}`;
        }
        
        chrome.runtime.sendMessage({
          type: 'speak_text',
          text: simpleSummary
        });
      }
      
    } else {
      console.log('❌ No section content found');
      if (voiceDisplay) {
        voiceDisplay.textContent = '❌ No section content found.';
      }
    }
    
  } catch (error) {
    console.error('❌ Error generating section summary:', error);
    if (voiceDisplay) {
      voiceDisplay.textContent = `❌ Error: ${error.message}`;
    }
  }
}

// ===== Simple Summary Fallback Function =====
function createSimpleSummary(sectionData) {
  const { sectionTitle, content, wordCount } = sectionData;
  
  if (wordCount <= 5) {
    return `This section is titled "${sectionTitle}" but contains very little content. It appears to be a heading or navigation element.`;
  }
  
  // Extract first few sentences or key phrases
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const firstSentence = sentences[0]?.trim() || content.substring(0, 100);
  
  return `This section is about "${sectionTitle}". ${firstSentence}${firstSentence.length < content.length ? '...' : ''}`;
}

// ===== Immersive Summary Function =====
async function generateImmersiveSummary() {
  try {
    console.log('🎭 Collecting data for immersive summary...');
    
    if (voiceDisplay) {
      voiceDisplay.textContent = '🎭 Collecting data for comprehensive analysis...';
    }
    
    // Get the current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Step 1: Extract section content (raw data)
    if (voiceDisplay) {
      voiceDisplay.textContent = '📄 Step 1: Extracting section content...';
    }
    
    const sectionResponse = await chrome.tabs.sendMessage(tab.id, {
      command: 'extract_current_section'
    });
    
    let sectionData = null;
    if (sectionResponse?.ok && sectionResponse.sectionContent) {
      sectionData = sectionResponse.sectionContent;
      console.log('📄 Section data extracted:', sectionData);
    }
    
    // Step 2: Extract image data (raw data)
    if (voiceDisplay) {
      voiceDisplay.textContent = '🖼️ Step 2: Extracting image data...';
    }
    
    const imageResponse = await chrome.tabs.sendMessage(tab.id, {
      command: 'extract_viewport_images'
    });
    
    let imageData = null;
    if (imageResponse?.ok && imageResponse.images?.length > 0) {
      imageData = imageResponse.images;
      console.log('🖼️ Image data extracted:', imageData);
    }
    
    // Step 3: Capture screenshot using Chrome API
    if (voiceDisplay) {
      voiceDisplay.textContent = '📸 Step 3: Capturing screenshot...';
    }
    
    let screenshotData = null;
    try {
      console.log('📸 Attempting to capture screenshot...');
      console.log('📸 Chrome tabs API available:', typeof chrome.tabs !== 'undefined');
      console.log('📸 captureVisibleTab available:', typeof chrome.tabs?.captureVisibleTab !== 'undefined');
      
      // Use Chrome's built-in screenshot API (available in popup context)
      screenshotData = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            console.error('📸 Chrome API error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log('📸 Screenshot data URL length:', dataUrl ? dataUrl.length : 'null');
            resolve(dataUrl);
          }
        });
      });
      console.log('📸 Screenshot captured successfully:', screenshotData ? 'Yes' : 'No');
    } catch (error) {
      console.error('📸 Screenshot capture failed:', error.message);
      console.error('📸 Full error:', error);
      screenshotData = null;
    }
    
    // Step 4: Generate summaries from raw data
    if (voiceDisplay) {
      voiceDisplay.textContent = '📝 Step 4: Generating summaries...';
    }
    
    // Generate section summary
    let sectionSummary = '';
    if (sectionData) {
      const sectionPrompt = `Please create a concise summary of this section for a visually impaired user.

Section: "${sectionData.sectionTitle}"
Content: ${sectionData.content}

Please provide:
1. A brief overview of what this section covers
2. The main points or key information
3. Any important details that would be helpful for accessibility

Keep the summary under 150 words and make it conversational and accessible.`;
      
      const sectionSummaryResponse = await askGeneralQuestion(
        sectionPrompt,
        sectionData.content,
        tab.title,
        tab.url
      );
      
      sectionSummary = sectionSummaryResponse?.answer || 'Could not generate section summary.';
    }
    
    // Generate image summary
    let imageSummary = '';
    if (imageData && imageData.length > 0) {
      const imageDescriptions = [];
      
      for (let i = 0; i < Math.min(3, imageData.length); i++) {
        const img = imageData[i];
        const filename = img.src.split('/').pop().split('.')[0] || 'image';
        
        const imagePrompt = `I need you to explain an image for a visually impaired user. Here are the details:

Image Information:
- Filename: ${filename}
- Alt text: ${img.alt || 'No alt text provided'}
- Context from page: ${img.context || 'No context available'}
- Page: ${tab.title}
- Section: ${img.section || 'Unknown section'}

Please provide a helpful description of what this image likely shows based on the filename, alt text, and surrounding context. Focus on:
1. What the image probably depicts
2. Why it's relevant to the article content
3. Key details that would help someone understand the image

Keep your explanation conversational and under 100 words.`;
        
        const imageSummaryResponse = await askGeneralQuestion(
          imagePrompt,
          `Image context: ${img.context || 'No context available'}. Page section: ${img.section || 'Unknown section'}`,
          tab.title,
          tab.url
        );
        
        if (imageSummaryResponse?.answer) {
          imageDescriptions.push(`Image ${i + 1}: ${imageSummaryResponse.answer}`);
        }
      }
      
      imageSummary = imageDescriptions.join('\n\n');
    } else {
      imageSummary = 'No images found in the current viewport.';
    }
    
    // Step 5: Prepare final data in the requested format
    if (voiceDisplay) {
      voiceDisplay.textContent = '📦 Step 5: Preparing final data...';
    }
    
    const finalData = {
      section_summary: sectionSummary,
      image_summary: imageSummary,
      screenshot: screenshotData
    };
    
    console.log('📦 Final immersive data prepared:', finalData);
    
    // Display the final result
    if (voiceDisplay) {
      const summary = `🎭 Immersive Summary Complete!

📄 Section Summary: ${sectionSummary.substring(0, 100)}...
🖼️ Image Summary: ${imageSummary.substring(0, 100)}...
📸 Screenshot: ${screenshotData ? 'Captured' : 'Failed'}

Data ready for backend processing.`;
      
      voiceDisplay.textContent = summary;
    }
    
    // TODO: Send finalData to backend endpoint for processing
    // This is where you would call your backend endpoint with the formatted data
    
  } catch (error) {
    console.error('❌ Error collecting immersive data:', error);
    if (voiceDisplay) {
      voiceDisplay.textContent = `❌ Error: ${error.message}`;
    }
  }
}

// ===== General Q&A Function =====
async function askGeneralQuestion(question, context = null, pageTitle = null, pageUrl = null) {
  try {
    console.log('🤖 Asking general question:', question);
    
    const response = await fetch(`${BACKEND_BASE}/v1/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: question,
        context: context,
        page_title: pageTitle,
        page_url: pageUrl
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('🤖 General question response:', result);
    return result;

  } catch (error) {
    console.error('❌ Error asking general question:', error);
    throw error;
  }
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
    // Navigate if intent is NAVIGATE
    if (interpretation.intent === 'NAVIGATE' && interpretation.target_section_id) {
      voiceDisplay.textContent += `🧭 Navigating to: ${interpretation.target_section_id}...\n`;

      await navigateToSection(interpretation.target_section_id);

      voiceDisplay.textContent += `✅ Successfully navigated!\n\nConfidence: ${(interpretation.confidence * 100).toFixed(1)}%`;
      
      // Auto-generate section summary after navigation
      setTimeout(async () => {
        console.log('🔄 Auto-generating section summary after navigation...');
        await generateSectionSummary();
      }, 2000); // Wait 2 seconds for navigation to complete
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
  showVoiceCommandLoading(); // Show loading spinner and play sound
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
    hideAllIndicators(); // Hide loading spinner
    stopLoadingSound(); // Stop loading sound
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
  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.setAttribute('aria-busy', 'true');
    analyzeBtn.setAttribute('aria-disabled', 'true');
  }
  playLoadingSound(); // Play sound effect during loading
  announceToScreenReader('Analyzing page structure. Please wait.', 'polite');
}

function showVoiceCommandLoading() {
  hideAllIndicators();
  loadingIndicator && loadingIndicator.classList.remove('hidden');
  playLoadingSound(); // Play sound effect during voice command processing
}

function showSpeaking() {
  buttonText && (buttonText.textContent = 'Speaking…');
}

function showSuccess(skipNotificationSound = false) {
  hideAllIndicators();
  stopLoadingSound(); // Stop sound when loading completes
  
  // Only play notification sound if not skipped (for auto-triggered analysis)
  if (!skipNotificationSound) {
    playNotificationSound(); // Play notification sound on completion
  }
  
  successIndicator && successIndicator.classList.remove('hidden');
  buttonText && (buttonText.textContent = 'Analyze Page Structure');
  if (analyzeBtn) {
    analyzeBtn.disabled = false;
    analyzeBtn.removeAttribute('aria-busy');
    analyzeBtn.setAttribute('aria-disabled', 'false');
  }
  announceToScreenReader('Analysis complete! Summary and navigation options are now available.', 'assertive');
}

function showError(msg) {
  hideAllIndicators();
  stopLoadingSound(); // Stop sound when loading fails
  errorIndicator && errorIndicator.classList.remove('hidden');
  const errorMsg = msg || 'Analysis failed';
  if (errorMessage) errorMessage.textContent = errorMsg;
  buttonText && (buttonText.textContent = 'Analyze Page Structure');
  if (analyzeBtn) {
    analyzeBtn.disabled = false;
    analyzeBtn.removeAttribute('aria-busy');
    analyzeBtn.setAttribute('aria-disabled', 'false');
  }
  announceToScreenReader(`Error: ${errorMsg}`, 'assertive');
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

    // Hide key features and stop rotator
    const keyFeatures = document.getElementById('keyFeatures');
    if (keyFeatures) {
      keyFeatures.classList.add('hidden');
    }
    stopFeatureRotator();

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
        hideAllIndicators(); // Hide loading spinner if active
        stopLoadingSound(); // Stop loading sound if playing
        alert(message.error);
        isRecording = false;
        updateRecordButtonState();
        break;
      case 'recording-stopped':
        isRecording = false;
        updateRecordButtonState();
        showVoiceCommandLoading(); // Show loading spinner and play sound
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
        } finally {
          hideAllIndicators(); // Hide loading spinner
          stopLoadingSound(); // Stop loading sound
        }
        break;
      case 'voice-interpretation-error':
        hideAllIndicators(); // Hide loading spinner
        stopLoadingSound(); // Stop loading sound
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
    
    // Skip notification sound in showSuccess if auto-triggered (background already played it)
    showSuccess(message.autoTriggered);

    ensureSummaryUI();
    summaryText.value = message.summary || '';
    summarySource.textContent = message.source ? `source: ${message.source}` : '';
    summaryModel.textContent = message.model ? `model: ${message.model}` : '';
    summarySection.style.display = 'block';

    // Show voice command UI and create backend session
    ensureVoiceUI();
    voiceSection.style.display = 'block';

    // Store page structure for later use
    if (message.pageStructure) {
      pageStructureData = message.pageStructure;
    }

    // If this was auto-triggered and popup is visible, play TTS immediately
    if (message.autoTriggered) {
      // Popup is already open, so play TTS now
      if (currentSummary && message.langHint) {
        console.log('[Sherpa] Playing TTS for auto-analysis (popup is open)');
        chrome.runtime.sendMessage({
          type: 'speak_text',
          text: currentSummary,
          langHint: message.langHint
        }).catch(err => {
          console.error('TTS error:', err);
        });
      }
      // Clear any pending summary since we just played it
      pendingAutoSummary = null;
    }

    return;
  }

  // Handle auto-analysis notification
  if (message.type === 'auto_analysis_triggered') {
    console.log('[Sherpa] Auto-analysis triggered for:', message.url);
    announceToScreenReader('Page analysis started automatically', 'polite');
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
    announceToScreenReader('Please enter a valid API key', 'assertive');
    return;
  }

  try {
    await chrome.storage.local.set({ geminiApiKey: apiKey });
    apiKeyStatus.textContent = '✓ API key saved';
    apiKeyStatus.className = 'api-key-status success';
    apiKeyInput.value = '';
    announceToScreenReader('API key saved successfully', 'assertive');

    // Auto-close settings after 1 second
    setTimeout(() => {
      settingsPanel?.classList.add('hidden');
      // Return focus to settings button
      settingsBtn?.focus();
    }, 1000);
  } catch {
    apiKeyStatus.textContent = 'Failed to save API key';
    apiKeyStatus.className = 'api-key-status error';
    announceToScreenReader('Failed to save API key', 'assertive');
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

// ===== Key Features Rotator =====
let featureRotatorInterval = null;

function startFeatureRotator() {
  const features = document.querySelectorAll('.feature-item');
  let currentIndex = 0;
  
  function rotateFeatures() {
    // Remove active class from all features
    features.forEach(feature => feature.classList.remove('active'));
    
    // Add active class to current feature
    features[currentIndex].classList.add('active');
    
    // Move to next feature
    currentIndex = (currentIndex + 1) % features.length;
  }
  
  // Start rotation immediately
  rotateFeatures();
  
  // Rotate every 3 seconds
  featureRotatorInterval = setInterval(rotateFeatures, 3000);
}

function stopFeatureRotator() {
  if (featureRotatorInterval) {
    clearInterval(featureRotatorInterval);
    featureRotatorInterval = null;
  }
}

// ---- Stop TTS when popup closes ----
window.addEventListener('beforeunload', () => {
  console.log('[Sherpa] Popup closing - stopping TTS');
  chrome.runtime.sendMessage({ type: 'stop_tts' }).catch(() => {});
});

window.addEventListener('unload', () => {
  console.log('[Sherpa] Popup unloaded - stopping TTS');
  chrome.runtime.sendMessage({ type: 'stop_tts' }).catch(() => {});
});

// ---- Init ----
(async function init() {
  hideAllIndicators();
  // Check recording state and microphone permissions on popup load
  await checkRecordingState();
  
  // Start feature rotator
  startFeatureRotator();

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
    manageFocusTrap(settingsPanel, true);
    announceToScreenReader('Settings dialog opened', 'polite');
  });

  // Close settings button
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', (e) => {
      console.log('Close button clicked'); // Debug
      e.stopPropagation(); // Prevent event bubbling
      if (settingsPanel) {
        settingsPanel.classList.add('hidden');
        settingsBtn?.focus(); // Return focus to settings button
        announceToScreenReader('Settings dialog closed', 'polite');
      }
    });
  } else {
    console.error('Close settings button not found!');
  }

  // Close settings when clicking outside the panel
  settingsPanel?.addEventListener('click', (e) => {
    if (e.target === settingsPanel) {
      settingsPanel.classList.add('hidden');
      settingsBtn?.focus(); // Return focus to settings button
      announceToScreenReader('Settings dialog closed', 'polite');
    }
  });

  // Handle Escape key to close settings
  settingsPanel?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      settingsPanel.classList.add('hidden');
      settingsBtn?.focus();
      announceToScreenReader('Settings dialog closed', 'polite');
    }
  });
})();

