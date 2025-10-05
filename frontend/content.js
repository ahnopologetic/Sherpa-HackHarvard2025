// Content Script - Runs in the context of web pages
// This script extracts semantic structure from the DOM

/**
 * Extracts the semantic structure of the current webpage
 * @returns {Object} Structured JSON representation of the page
 */
function extractPageStructure() {
    const structure = {
      title: '',
      headings: [],
      landmarks: [],
      ariaRoles: [],
      interactiveElements: {
        links: 0,
        buttons: 0,
        forms: 0,
        inputs: 0
      },
      metadata: {
        url: window.location.href,
        domain: window.location.hostname
      }
    };
  
    try {
      // Extract page title
      structure.title = document.title || 'Untitled Page';
  
      // Extract headings (H1-H6)
      const headingSelectors = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
      headingSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = el.textContent.trim();
          if (text && text.length > 0 && text.length < 200) {
            structure.headings.push({
              level: selector.toUpperCase(),
              text: text.substring(0, 100) // Limit length
            });
          }
        });
      });
  
      // Extract HTML5 landmark elements
      const landmarkSelectors = {
        'header': 'header',
        'nav': 'navigation',
        'main': 'main content',
        'aside': 'complementary',
        'footer': 'footer',
        'section': 'section',
        'article': 'article',
        'search': 'search'
      };
  
      Object.entries(landmarkSelectors).forEach(([selector, label]) => {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          structure.landmarks.push({
            type: label,
            count: elements.length
          });
        }
      });
  
      // Extract ARIA roles
      const ariaElements = document.querySelectorAll('[role]');
      const roleSet = new Set();
      ariaElements.forEach(el => {
        const role = el.getAttribute('role');
        if (role) {
          roleSet.add(role);
        }
      });
      structure.ariaRoles = Array.from(roleSet);
  
      // Count interactive elements
      structure.interactiveElements.links = document.querySelectorAll('a[href]').length;
      structure.interactiveElements.buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]').length;
      structure.interactiveElements.forms = document.querySelectorAll('form').length;
      structure.interactiveElements.inputs = document.querySelectorAll('input, textarea, select').length;
  
      // Extract meta description if available
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        structure.metadata.description = metaDescription.getAttribute('content')?.substring(0, 200);
      }
  
      // Detect if page has skip links (accessibility feature)
      const skipLinks = document.querySelectorAll('a[href^="#"]');
      let hasSkipToContent = false;
      skipLinks.forEach(link => {
        const text = link.textContent.toLowerCase();
        if (text.includes('skip') && (text.includes('content') || text.includes('main'))) {
          hasSkipToContent = true;
        }
      });
      structure.metadata.hasSkipLinks = hasSkipToContent;
  
      // Detect language
      structure.metadata.language = document.documentElement.lang || 'unknown';
  
    } catch (error) {
      console.error('Error extracting page structure:', error);
      structure.error = 'Failed to parse page structure';
    }
  
    return structure;
  }
  
  /**
   * Listen for messages from the popup script
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === 'get_page_structure') {
      try {
        // Extract the page structure
        const pageStructure = extractPageStructure();
        
        // Send the structured data to the background script
        chrome.runtime.sendMessage({
          type: 'page_structure_extracted',
          data: pageStructure
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error sending to background:', chrome.runtime.lastError);
            sendResponse({ status: 'error', message: chrome.runtime.lastError.message });
          } else {
            sendResponse({ status: 'success' });
          }
        });
        
        // Return true to indicate async response
        return true;
      } catch (error) {
        console.error('Content script error:', error);
        sendResponse({ status: 'error', message: error.message });
      }
    }
  });

  const GEN_ID_PREFIX = 'ctx-nav-target-';

function humanLabel(el) {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const heading = el.querySelector('h1,h2,h3,h4');
  if (heading) {
    const t = (heading.innerText || heading.textContent || '').trim();
    if (t) return t;
  }
  return el.tagName.toLowerCase();
}

function parsePageForMapping() {
  const sections = [];
  let counter = 0;

  console.log('[Atlas] Starting enhanced page parsing...');

  // ===== STEP 1: Capture ALL headings (h1-h6) with meaningful content =====
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headings.forEach((heading) => {
    const text = (heading.innerText || heading.textContent || '').trim();
    
    // Skip empty or very short headings
    if (!text || text.length < 2) return;
    
    // Skip navigation/UI headings (common patterns to ignore)
    const lowerText = text.toLowerCase();
    if (lowerText === 'contents' || 
        lowerText === 'menu' || 
        lowerText === 'navigation' ||
        lowerText.startsWith('edit') ||
        text.length > 100) return;

    // Get or create ID for this heading
    let id = heading.id;
    
    // If no ID, check if parent has ID (common pattern)
    if (!id && heading.parentElement?.id) {
      id = heading.parentElement.id;
    }
    
    // Still no ID? Look for nearby element with ID
    if (!id) {
      const parent = heading.closest('[id]');
      if (parent?.id) {
        id = parent.id;
      }
    }
    
    // Last resort: generate an ID
    if (!id) {
      id = `${GEN_ID_PREFIX}heading-${counter++}`;
      heading.id = id;
    }

    sections.push({
      id,
      label: text.substring(0, 80), // Reasonable length
      role: 'heading',
      level: heading.tagName.toLowerCase(),
      type: 'content' // Mark as actual content section
    });
  });

  console.log(`[Atlas] Found ${sections.length} heading-based sections`);

  // ===== STEP 2: Capture landmark elements (but be selective) =====
  const landmarks = document.querySelectorAll('main, footer, nav[role="navigation"], header[role="banner"]');
  landmarks.forEach((el) => {
    let id = el.id;
    if (!id) {
      id = `${GEN_ID_PREFIX}landmark-${counter++}`;
      el.id = id;
    }
    
    const label = humanLabel(el);
    
    // Only add if it has a meaningful label
    if (label && label !== 'div' && label !== el.tagName.toLowerCase()) {
    sections.push({
      id,
        label,
        role: (el.getAttribute('role') || el.tagName.toLowerCase()),
        type: 'landmark'
    });
    }
  });

  console.log(`[Atlas] Total sections mapped: ${sections.length}`);
  
  // Log first 10 sections for debugging
  console.log('[Atlas] Sample sections:', sections.slice(0, 10));

  return {
    title: document.title || 'Untitled',
    url: window.location.href,
    language: document.documentElement?.getAttribute('lang') || null,
    sections
  };
}

// Smooth scroll to a section
function navigateToSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (!el) throw new Error(`Section not found: ${sectionId}`);
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Messages from background/popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    if (msg?.command === 'parse_page_for_mapping') {
      const pageData = parsePageForMapping();
      sendResponse({ ok: true, pageData });
      return true;
    }
    if (msg?.command === 'navigate_to_section') {
      navigateToSection(msg.sectionId);
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.command === 'extract_viewport_images') {
      const viewportImages = extractViewportImages();
      sendResponse({ ok: true, ...viewportImages });
      return true;
    }
    if (msg?.command === 'extract_current_section') {
      const sectionContent = extractCurrentSectionContent();
      sendResponse({ ok: true, sectionContent });
      return true;
    }
    
    if (msg?.command === 'trigger_analysis') {
      // Trigger page analysis by sending message to background script
      chrome.runtime.sendMessage({ type: 'trigger_page_analysis' }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
  } catch (e) {
    console.error('[Sherpa] content error:', e);
    sendResponse({ ok: false, error: e.message });
  }
});
  
  // Log successful injection
  console.log('Project Sherpa content script loaded');

// ===== Viewport Image Extraction Function =====
function extractViewportImages() {
  console.log('[Sherpa] ===== STARTING VIEWPORT IMAGE EXTRACTION =====');
  
  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const scrollPosition = {
    x: window.scrollX,
    y: window.scrollY
  };
  
  console.log(`[Sherpa] Viewport: ${viewportWidth}x${viewportHeight}, Scroll: ${scrollPosition.x},${scrollPosition.y}`);
  
  const viewportImages = [];
  const allImages = document.querySelectorAll('img');
  
  console.log(`[Sherpa] Found ${allImages.length} total images on page`);
  
  allImages.forEach((img, index) => {
    console.log(`[Sherpa] --- Checking Image ${index + 1} for viewport visibility ---`);
    
    // Get image dimensions and position
    const rect = img.getBoundingClientRect();
    const imgWidth = rect.width;
    const imgHeight = rect.height;
    const imgX = rect.left;
    const imgY = rect.top;
    
    console.log(`[Sherpa] Image ${index + 1} rect:`, rect);
    
    // Check if image is in viewport
    const isInViewport = (
      imgX < viewportWidth &&
      imgY < viewportHeight &&
      imgX + imgWidth > 0 &&
      imgY + imgHeight > 0
    );
    
    if (!isInViewport) {
      console.log(`[Sherpa] Image ${index + 1} not in viewport, skipping`);
      return;
    }
    
    // Calculate visibility percentage
    const visibleLeft = Math.max(0, imgX);
    const visibleTop = Math.max(0, imgY);
    const visibleRight = Math.min(viewportWidth, imgX + imgWidth);
    const visibleBottom = Math.min(viewportHeight, imgY + imgHeight);
    
    const visibleWidth = visibleRight - visibleLeft;
    const visibleHeight = visibleBottom - visibleTop;
    const visibleArea = visibleWidth * visibleHeight;
    const totalArea = imgWidth * imgHeight;
    const visibilityPercentage = totalArea > 0 ? Math.round((visibleArea / totalArea) * 100) : 0;
    
    console.log(`[Sherpa] Image ${index + 1} visibility: ${visibilityPercentage}%`);
    
    // Skip very small or barely visible images
    if (imgWidth < 30 || imgHeight < 30 || visibilityPercentage < 10) {
      console.log(`[Sherpa] Image ${index + 1} too small or barely visible, skipping`);
      return;
    }
    
    // Get image source and basic info
    const src = img.src || img.getAttribute('data-src') || '';
    const alt = img.alt || '';
    
    if (!src || src.includes('data:image') || src.includes('pixel')) {
      console.log(`[Sherpa] Image ${index + 1} has no meaningful src, skipping`);
      return;
    }
    
    // Get context information
    const context = getImageContext(img);
    const parentElement = img.parentElement?.tagName || '';
    const section = getImageSection(img);
    
    const imageData = {
      src: src,
      alt: alt,
      width: Math.round(imgWidth),
      height: Math.round(imgHeight),
      viewportX: Math.round(imgX),
      viewportY: Math.round(imgY),
      isVisible: true,
      visibilityPercentage: visibilityPercentage,
      context: context,
      parentElement: parentElement,
      nearbyText: context,
      section: section
    };
    
    console.log(`[Sherpa] Image ${index + 1} viewport data:`, imageData);
    viewportImages.push(imageData);
  });
  
  console.log(`[Sherpa] ===== VIEWPORT IMAGE EXTRACTION COMPLETE =====`);
  console.log(`[Sherpa] Found ${viewportImages.length} images in viewport`);
  console.log(`[Sherpa] Viewport images:`, viewportImages);
  
  return {
    images: viewportImages,
    viewportWidth: viewportWidth,
    viewportHeight: viewportHeight,
    scrollPosition: scrollPosition
  };
}

// Helper function to get image context
function getImageContext(img) {
  let context = '';
  
  // Check parent element text
  const parent = img.parentElement;
  if (parent) {
    const parentText = parent.textContent.trim();
    if (parentText && parentText.length > 10 && parentText.length < 300) {
      context += parentText + ' ';
    }
  }
  
  // Check next siblings
  let sibling = img.nextSibling;
  let attempts = 0;
  while (sibling && attempts < 3) {
    if (sibling.nodeType === Node.TEXT_NODE) {
      const siblingText = sibling.textContent.trim();
      if (siblingText && siblingText.length > 5) {
        context += siblingText + ' ';
      }
    } else if (sibling.nodeType === Node.ELEMENT_NODE) {
      const siblingText = sibling.textContent.trim();
      if (siblingText && siblingText.length > 5 && siblingText.length < 200) {
        context += siblingText + ' ';
      }
    }
    sibling = sibling.nextSibling;
    attempts++;
  }
  
  return context.trim();
}

// Helper function to get the section/heading context for an image
function getImageSection(img) {
  // Look for nearby headings
  let element = img;
  let attempts = 0;
  
  while (element && attempts < 5) {
    // Check if current element is a heading
    if (element.matches('h1, h2, h3, h4, h5, h6')) {
      return element.textContent.trim();
    }
    
    // Check for headings in the same container
    const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) {
      return heading.textContent.trim();
    }
    
    element = element.parentElement;
    attempts++;
  }
  
  return '';
}

// ===== Section-Specific Summary Function =====
function extractCurrentSectionContent() {
  console.log('[Sherpa] ===== EXTRACTING CURRENT SECTION CONTENT =====');
  
  // Get the current scroll position to determine which section is in view
  const scrollY = window.scrollY;
  const viewportHeight = window.innerHeight;
  const centerY = scrollY + (viewportHeight / 2);
  
  console.log(`[Sherpa] Current scroll position: ${scrollY}, Center: ${centerY}`);
  
  // Find the section that's currently in the center of the viewport
  let currentSection = null;
  let currentSectionElement = null;
  
  // Look for headings and their associated content
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  
  // First, try to find the heading that's closest to the top of the viewport
  let bestHeading = null;
  let bestDistance = Infinity;
  
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const rect = heading.getBoundingClientRect();
    const headingTop = rect.top + scrollY;
    
    // Skip headings that are too far above the viewport
    if (headingTop < scrollY - 200) continue;
    
    // Skip headings that are too far below the viewport
    if (headingTop > scrollY + viewportHeight + 200) continue;
    
    // Calculate distance from top of viewport
    const distance = Math.abs(headingTop - scrollY);
    
    if (distance < bestDistance) {
      bestDistance = distance;
      bestHeading = heading;
    }
  }
  
  if (bestHeading) {
    currentSection = bestHeading.textContent.trim();
    currentSectionElement = bestHeading;
    console.log(`[Sherpa] Found best section: "${currentSection}" (distance: ${bestDistance})`);
  }
  
  // If no good heading found, try the center-based approach
  if (!currentSectionElement) {
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const rect = heading.getBoundingClientRect();
      const headingTop = rect.top + scrollY;
      
      // Check if this heading is near the center of the viewport
      if (headingTop <= centerY && headingTop > scrollY - 100) {
        currentSection = heading.textContent.trim();
        currentSectionElement = heading;
        console.log(`[Sherpa] Found center-based section: "${currentSection}"`);
        break;
      }
    }
  }
  
  if (!currentSectionElement) {
    console.log('[Sherpa] No specific section found, using main content area');
    // Fallback to main content area
    const mainContent = document.querySelector('main, article, .content, #content, .main-content');
    if (mainContent) {
      currentSectionElement = mainContent;
      currentSection = 'Main Content';
    } else {
      currentSectionElement = document.body;
      currentSection = 'Page Content';
    }
  }
  
  // Extract content from the current section
  const sectionContent = extractSectionText(currentSectionElement);
  
  const result = {
    sectionTitle: currentSection,
    sectionElement: currentSectionElement.tagName,
    content: sectionContent,
    wordCount: sectionContent.split(' ').length,
    scrollPosition: scrollY,
    viewportCenter: centerY
  };
  
  console.log(`[Sherpa] Section content extracted:`, result);
  return result;
}

// Helper function to extract text content from a section
function extractSectionText(element) {
  let text = '';
  
  // If it's a heading element, we need to get the content that follows it
  if (element.tagName && element.tagName.match(/^H[1-6]$/)) {
    // For headings, get the content that follows until the next heading of same or higher level
    const headingLevel = parseInt(element.tagName.charAt(1));
    let currentElement = element.nextElementSibling;
    
    while (currentElement) {
      // Stop if we hit another heading of same or higher level
      if (currentElement.tagName && currentElement.tagName.match(/^H[1-6]$/)) {
        const currentLevel = parseInt(currentElement.tagName.charAt(1));
        if (currentLevel <= headingLevel) {
          break;
        }
      }
      
      // Extract text from this element
      const elementText = currentElement.textContent.trim();
      if (elementText && elementText.length > 2) {
        text += elementText + '\n';
      }
      
      currentElement = currentElement.nextElementSibling;
    }
  } else {
    // For non-heading elements, extract all text content
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          // Skip script, style, and other non-content elements
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            if (['script', 'style', 'nav', 'footer', 'header', 'aside'].includes(tagName)) {
              return NodeFilter.FILTER_REJECT;
            }
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textContent = node.textContent.trim();
        if (textContent && textContent.length > 2) {
          text += textContent + ' ';
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();
        // Add line breaks for block elements
        if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'br'].includes(tagName)) {
          text += '\n';
        }
      }
    }
  }
  
  // Clean up the text
  return text
    .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
    .replace(/\n\s*\n/g, '\n')  // Replace multiple newlines with single newline
    .trim();
}

// ===== Immersive Summary Dock =====
let sherpaDock = null;
let dockAudio = null;
let currentTranscript = '';
let transcriptSegments = [];
let currentSegmentIndex = 0;
let isPlaying = false;

function createSherpaDock() {
  if (sherpaDock) {
    return; // Already exists
  }

  // Create dock container
  sherpaDock = document.createElement('div');
  sherpaDock.id = 'sherpa-immersive-dock';
  sherpaDock.innerHTML = `
    <div class="sherpa-dock-content">
      <!-- Music Player Controls -->
      <div class="sherpa-player-section">
        <button class="sherpa-control-btn" id="sherpa-play-pause" aria-label="Play/Pause">
          <svg class="sherpa-play-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <svg class="sherpa-pause-icon" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
          </svg>
        </button>
        
        <button class="sherpa-control-btn" id="sherpa-skip-back" aria-label="Skip back 10 seconds">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>
          </svg>
        </button>
        
        <button class="sherpa-control-btn" id="sherpa-skip-forward" aria-label="Skip forward 10 seconds">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
          </svg>
        </button>
        
        <!-- Progress Bar -->
        <div class="sherpa-progress-container">
          <div class="sherpa-progress-bar" id="sherpa-progress-bar">
            <div class="sherpa-progress-fill" id="sherpa-progress-fill"></div>
          </div>
          <div class="sherpa-time-display">
            <span id="sherpa-current-time">0:00</span> / <span id="sherpa-total-time">0:00</span>
          </div>
        </div>
        
        <!-- Volume Control -->
        <div class="sherpa-volume-container">
          <button class="sherpa-control-btn sherpa-volume-btn" id="sherpa-volume-btn" aria-label="Volume">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
            </svg>
          </button>
          <input type="range" class="sherpa-volume-slider" id="sherpa-volume-slider" 
                 min="0" max="100" value="80" aria-label="Volume slider">
        </div>
        
        <button class="sherpa-control-btn sherpa-close-btn" id="sherpa-close-dock" aria-label="Close dock">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      
      <!-- Separator -->
      <div class="sherpa-separator"></div>
      
      <!-- Transcript Viewer -->
      <div class="sherpa-transcript-section">
        <div class="sherpa-transcript-header">
          <span class="sherpa-transcript-title">📝 Live Transcript</span>
          <span class="sherpa-transcript-hint">Keyboard: Space = Play/Pause, ← → = Seek, Esc = Close</span>
        </div>
        <div class="sherpa-transcript-viewer" id="sherpa-transcript-viewer">
          <div class="sherpa-transcript-text" id="sherpa-transcript-text">
            Loading transcript...
          </div>
        </div>
      </div>
    </div>
  `;

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #sherpa-immersive-dock {
      position: fixed;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: linear-gradient(135deg, rgba(20, 20, 30, 0.98), rgba(30, 30, 45, 0.98));
      backdrop-filter: blur(20px);
      border-radius: 24px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1);
      padding: 20px 32px;
      max-width: 1000px;
      min-width: 800px;
      animation: sherpa-dock-slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes sherpa-dock-slide-up {
      from {
        opacity: 0;
        transform: translate(-50%, 20px);
      }
      to {
        opacity: 1;
        transform: translate(-50%, 0);
      }
    }

    .sherpa-dock-content {
      display: flex;
      gap: 24px;
      align-items: center;
    }

    .sherpa-player-section {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-shrink: 0;
    }

    .sherpa-control-btn {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }

    .sherpa-control-btn:hover {
      transform: translateY(-2px) scale(1.05);
      box-shadow: 0 8px 20px rgba(102, 126, 234, 0.6);
    }

    .sherpa-control-btn:active {
      transform: translateY(0) scale(0.98);
    }

    .sherpa-control-btn svg {
      width: 24px;
      height: 24px;
    }

    #sherpa-play-pause {
      width: 56px;
      height: 56px;
    }

    #sherpa-play-pause svg {
      width: 28px;
      height: 28px;
    }

    .sherpa-close-btn {
      background: rgba(255, 255, 255, 0.1);
      box-shadow: none;
    }

    .sherpa-close-btn:hover {
      background: rgba(255, 100, 100, 0.8);
    }

    .sherpa-volume-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .sherpa-volume-btn {
      width: 40px;
      height: 40px;
      background: rgba(255, 255, 255, 0.1);
      box-shadow: none;
    }

    .sherpa-volume-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .sherpa-volume-slider {
      width: 80px;
      height: 4px;
      -webkit-appearance: none;
      appearance: none;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
    }

    .sherpa-volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(102, 126, 234, 0.5);
    }

    .sherpa-volume-slider::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      cursor: pointer;
      border: none;
      box-shadow: 0 2px 6px rgba(102, 126, 234, 0.5);
    }

    .sherpa-progress-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 180px;
    }

    .sherpa-progress-bar {
      height: 6px;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 3px;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .sherpa-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      border-radius: 3px;
      width: 0%;
      transition: width 0.1s linear;
    }

    .sherpa-time-display {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.6);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    }

    .sherpa-separator {
      width: 2px;
      height: 60px;
      background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.2), transparent);
      flex-shrink: 0;
    }

    .sherpa-transcript-section {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .sherpa-transcript-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 4px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .sherpa-transcript-title {
      font-size: 13px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.9);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    }

    .sherpa-transcript-hint {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.5);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    }

    .sherpa-transcript-viewer {
      max-height: 80px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
    }

    .sherpa-transcript-viewer::-webkit-scrollbar {
      width: 6px;
    }

    .sherpa-transcript-viewer::-webkit-scrollbar-track {
      background: transparent;
    }

    .sherpa-transcript-viewer::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.3);
      border-radius: 3px;
    }

    .sherpa-transcript-text {
      color: rgba(255, 255, 255, 0.9);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      letter-spacing: 0.3px;
    }

    .sherpa-transcript-word {
      display: inline;
      transition: all 0.2s ease;
      color: rgba(255, 255, 255, 0.6);
    }

    .sherpa-transcript-word.active {
      color: #ffffff;
      font-weight: 600;
      text-shadow: 0 0 20px rgba(102, 126, 234, 0.8);
      animation: sherpa-word-glow 0.3s ease;
    }

    .sherpa-transcript-word.spoken {
      color: rgba(255, 255, 255, 0.9);
    }

    @keyframes sherpa-word-glow {
      0% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.05);
      }
      100% {
        transform: scale(1);
      }
    }

    @media (max-width: 1024px) {
      #sherpa-immersive-dock {
        min-width: 90vw;
        max-width: 90vw;
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(sherpaDock);

  // Add event listeners
  setupDockControls();
  setupKeyboardShortcuts();
}

function setupDockControls() {
  const playPauseBtn = document.getElementById('sherpa-play-pause');
  const skipBackBtn = document.getElementById('sherpa-skip-back');
  const skipForwardBtn = document.getElementById('sherpa-skip-forward');
  const closeDockBtn = document.getElementById('sherpa-close-dock');
  const progressBar = document.getElementById('sherpa-progress-bar');
  const volumeSlider = document.getElementById('sherpa-volume-slider');

  playPauseBtn?.addEventListener('click', togglePlayPause);
  skipBackBtn?.addEventListener('click', () => skipTime(-10));
  skipForwardBtn?.addEventListener('click', () => skipTime(10));
  closeDockBtn?.addEventListener('click', closeDock);
  progressBar?.addEventListener('click', seekToPosition);
  
  // Volume control
  volumeSlider?.addEventListener('input', (e) => {
    if (dockAudio) {
      dockAudio.volume = e.target.value / 100;
    }
  });
}

function setupKeyboardShortcuts() {
  // Add keyboard shortcuts for the dock
  document.addEventListener('keydown', (e) => {
    // Only handle shortcuts when dock is visible and not typing in input fields
    if (!sherpaDock || e.target.matches('input, textarea, [contenteditable]')) {
      return;
    }

    switch(e.code) {
      case 'Space':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        skipTime(-5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        skipTime(5);
        break;
      case 'Escape':
        e.preventDefault();
        closeDock();
        break;
    }
  });
}

function togglePlayPause() {
  if (!dockAudio) return;

  const playIcon = sherpaDock.querySelector('.sherpa-play-icon');
  const pauseIcon = sherpaDock.querySelector('.sherpa-pause-icon');

  if (dockAudio.paused) {
    dockAudio.play();
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
    isPlaying = true;
  } else {
    dockAudio.pause();
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    isPlaying = false;
  }
}

function skipTime(seconds) {
  if (!dockAudio) return;
  dockAudio.currentTime = Math.max(0, Math.min(dockAudio.duration, dockAudio.currentTime + seconds));
}

function seekToPosition(event) {
  if (!dockAudio) return;
  
  const progressBar = event.currentTarget;
  const rect = progressBar.getBoundingClientRect();
  const percent = (event.clientX - rect.left) / rect.width;
  dockAudio.currentTime = percent * dockAudio.duration;
}

function closeDock() {
  if (dockAudio) {
    dockAudio.pause();
    dockAudio = null;
  }
  
  if (sherpaDock) {
    sherpaDock.remove();
    sherpaDock = null;
  }
  
  // Notify popup that dock was closed
  chrome.runtime.sendMessage({ type: 'dock_closed' });
}

function updateProgress() {
  if (!dockAudio || !sherpaDock) return;

  const progressFill = document.getElementById('sherpa-progress-fill');
  const currentTimeEl = document.getElementById('sherpa-current-time');
  const totalTimeEl = document.getElementById('sherpa-total-time');

  const percent = (dockAudio.currentTime / dockAudio.duration) * 100;
  progressFill.style.width = `${percent}%`;

  currentTimeEl.textContent = formatTime(dockAudio.currentTime);
  totalTimeEl.textContent = formatTime(dockAudio.duration);

  // Update transcript highlight
  updateTranscriptHighlight();
}

function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateTranscriptHighlight() {
  if (!dockAudio || transcriptSegments.length === 0) return;

  const currentTime = dockAudio.currentTime;
  const words = sherpaDock.querySelectorAll('.sherpa-transcript-word');

  // Simple word-by-word animation based on time
  // Estimate words per second (average speaking rate is about 2-3 words per second)
  const totalWords = transcriptSegments.length;
  const wordsPerSecond = totalWords / dockAudio.duration;
  const currentWordIndex = Math.floor(currentTime * wordsPerSecond);

  let activeWord = null;
  
  words.forEach((word, index) => {
    word.classList.remove('active', 'spoken');
    
    if (index < currentWordIndex) {
      word.classList.add('spoken');
    } else if (index === currentWordIndex) {
      word.classList.add('active');
      activeWord = word;
    }
  });
  
  // Auto-scroll to keep active word in view
  if (activeWord) {
    const viewer = document.getElementById('sherpa-transcript-viewer');
    if (viewer) {
      const wordRect = activeWord.getBoundingClientRect();
      const viewerRect = viewer.getBoundingClientRect();
      
      // Check if word is out of view
      if (wordRect.bottom > viewerRect.bottom || wordRect.top < viewerRect.top) {
        activeWord.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
}

function setTranscript(transcript) {
  currentTranscript = transcript;
  transcriptSegments = transcript.split(/\s+/).filter(w => w.length > 0);

  const transcriptText = document.getElementById('sherpa-transcript-text');
  if (transcriptText) {
    transcriptText.innerHTML = transcriptSegments
      .map((word, index) => `<span class="sherpa-transcript-word" data-index="${index}">${word}</span>`)
      .join(' ');
  }
}

// Add message listener to also send page structure for backend session
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.command === 'get_page_for_backend') {
    try {
      const pageData = parsePageForMapping();
      // Also send to popup for backend session creation
      chrome.runtime.sendMessage({
        type: 'page_structure_for_session',
        data: pageData
      });
      sendResponse({ ok: true, data: pageData });
      return true;
    } catch (error) {
      console.error('[Atlas] Error getting page for backend:', error);
      sendResponse({ ok: false, error: error.message });
    }
  }
  
  // Play notification sound
  if (request.command === 'play_notification_sound') {
    try {
      const audio = new Audio(chrome.runtime.getURL('assets/notification-291227.mp3'));
      audio.play().catch(err => {
        console.log('[Sherpa] Could not play notification sound:', err);
      });
      sendResponse({ ok: true });
      return true;
    } catch (error) {
      console.error('[Sherpa] Error playing notification sound:', error);
      sendResponse({ ok: false, error: error.message });
    }
  }

  // Show immersive summary dock
  if (request.command === 'show_immersive_dock') {
    try {
      createSherpaDock();
      
      // Set up audio
      if (request.audioUrl) {
        dockAudio = new Audio(request.audioUrl);
        dockAudio.volume = 0.8; // Set default volume to 80%
        dockAudio.addEventListener('timeupdate', updateProgress);
        dockAudio.addEventListener('ended', () => {
          const playIcon = sherpaDock.querySelector('.sherpa-play-icon');
          const pauseIcon = sherpaDock.querySelector('.sherpa-pause-icon');
          playIcon.style.display = 'block';
          pauseIcon.style.display = 'none';
          isPlaying = false;
        });
        
        // Auto-play with a small delay
        setTimeout(() => {
          if (dockAudio && sherpaDock) {
            dockAudio.play().then(() => {
              const playIcon = sherpaDock.querySelector('.sherpa-play-icon');
              const pauseIcon = sherpaDock.querySelector('.sherpa-pause-icon');
              playIcon.style.display = 'none';
              pauseIcon.style.display = 'block';
              isPlaying = true;
              console.log('🎵 Auto-playing immersive summary');
            }).catch(err => {
              console.log('Auto-play blocked, user interaction required:', err);
            });
          }
        }, 500);
      }
      
      // Set transcript
      if (request.transcript) {
        setTranscript(request.transcript);
      }
      
      sendResponse({ ok: true });
      return true;
    } catch (error) {
      console.error('[Sherpa] Error showing immersive dock:', error);
      sendResponse({ ok: false, error: error.message });
    }
  }

  // Hide immersive summary dock
  if (request.command === 'hide_immersive_dock') {
    try {
      closeDock();
      sendResponse({ ok: true });
      return true;
    } catch (error) {
      console.error('[Sherpa] Error hiding immersive dock:', error);
      sendResponse({ ok: false, error: error.message });
    }
  }
});
