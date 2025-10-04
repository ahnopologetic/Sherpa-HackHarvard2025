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
  const landmarks = document.querySelectorAll('main, aside, footer, nav, header, [role]');
  let counter = 0;

  landmarks.forEach((el) => {
    let id = el.id;
    if (!id) {
      // assign a stable ID
      id = `${GEN_ID_PREFIX}${counter++}`;
      el.id = id;
    }
    sections.push({
      id,
      label: humanLabel(el),
      role: (el.getAttribute('role') || el.tagName.toLowerCase())
    });
  });

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
  } catch (e) {
    console.error('[Sherpa] content error:', e);
    sendResponse({ ok: false, error: e.message });
  }
});
  
  // Log successful injection
  console.log('Project Sherpa content script loaded');
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
});
