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
  
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const rect = heading.getBoundingClientRect();
    const headingTop = rect.top + scrollY;
    
    // Check if this heading is near the center of the viewport
    if (headingTop <= centerY && headingTop > scrollY - 100) {
      currentSection = heading.textContent.trim();
      currentSectionElement = heading;
      console.log(`[Sherpa] Found current section: "${currentSection}"`);
      break;
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
  
  // Get all text nodes and elements within the section
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
  
  // Clean up the text
  return text
    .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
    .replace(/\n\s*\n/g, '\n')  // Replace multiple newlines with single newline
    .trim();
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
});
