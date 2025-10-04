Project Atlas - AI-Powered Web Accessibility Extension
Overview
Project Atlas is a Chrome extension designed to help screen reader users quickly understand webpage structure and layout through AI-generated audio summaries.

Features
🎯 One-Click Analysis: Instantly analyze any webpage's structure
🤖 AI-Powered Summaries: Uses Google Gemini to generate concise, helpful summaries
🔊 Audio Output: Automatically speaks summaries using built-in text-to-speech
♿ Accessibility First: Built specifically for screen reader users
🔒 Privacy Focused: Your API key is stored securely and never shared
Installation
Step 1: Get a Google Gemini API Key
Visit Google AI Studio
Sign in with your Google account
Click "Create API Key"
Copy the generated key
Step 2: Install the Extension
Download or clone this repository
Open Chrome and navigate to chrome://extensions/
Enable "Developer mode" (toggle in top-right corner)
Click "Load unpacked"
Listen to the audio summary describing the page's structure
What Gets Analyzed
The extension extracts and analyzes:

Page Title: The main title of the webpage
Headings: All H1-H6 headings to understand content hierarchy
Landmarks: HTML5 semantic elements (header, nav, main, footer, etc.)
ARIA Roles: Accessibility roles for better screen reader compatibility
Interactive Elements: Count of links, buttons, forms, and inputs
Meta Information: Language, description, and accessibility features
Example Output
"You are on a Wikipedia page titled 'Roman Empire'. The page has a main navigation bar with links to different sections. The primary content area contains multiple sections including History, Government, and Military. There are 342 links throughout the page and a search form in the header."

Project Structure
project-atlas/
├── manifest.json          # Extension configuration
├── popup.html            # Extension popup interface
├── popup.css             # Popup styling
├── popup.js              # Popup UI logic
├── content.js            # DOM parser and data extractor
├── background.js         # Service worker & AI orchestrator
├── icons/                # Extension icons (16x16, 48x48, 128x128)
└── README.md             # This file
Architecture Overview
Three-Component Design
1. Popup Script (popup.js)
User interface trigger
Handles button clicks and visual feedback
Manages settings panel for API key configuration
Displays loading, success, and error states
2. Content Script (content.js)
Runs on every webpage
Parses the DOM to extract semantic structure
Creates clean JSON representation of page layout
Sends structured data to background script
3. Background Script (background.js)
Service worker that orchestrates the entire process
Securely manages API key storage
Constructs prompts for AI analysis
Makes API calls to Google Gemini
Handles text-to-speech output
Manages error handling and user feedback
Data Flow
[User Clicks Icon] 
    ↓
[Popup Opens] 
    ↓
[User Clicks "Analyze Page"] 
    ↓
[Popup → Content Script: "get_page_structure"]
    ↓
[Content Script Parses DOM]
    ↓
[Content Script → Background: JSON structure]
    ↓
[Background Constructs AI Prompt]
    ↓
[Background → Gemini API]
    ↓
[Gemini Returns Summary]
    ↓
[Background → TTS Engine]
    ↓
[User Hears Audio Summary]
    ↓
[Background → Popup: "analysis_complete"]
    ↓
[Popup Shows Success Checkmark]
Technical Details
DOM Parsing Strategy
The content script prioritizes semantic HTML5 tags and ARIA roles to understand page structure:

Extracts headings to understand content hierarchy
Identifies landmarks (nav, main, header, footer)
Counts interactive elements for navigation complexity
Detects accessibility features like skip links
AI Prompt Engineering
The background script uses carefully crafted prompts that:

Provide context about the user's needs (screen reader user)
Include structured JSON data about the page
Request concise, actionable summaries (2-4 sentences)
Focus on navigation and page purpose
Error Handling
The extension gracefully handles multiple failure scenarios:

No API Key: Prompts user to configure settings
API Errors: Speaks clear error message to user
Network Failures: Provides helpful troubleshooting guidance
Unparseable Pages: Detects and reports pages that can't be analyzed
Browser Compatibility
✅ Chrome (Manifest V3)
✅ Edge (Chromium-based)
⚠️ Other browsers not yet supported
Privacy & Security
API keys are stored locally using Chrome's secure storage API
No data is collected or sent to any server except Google Gemini
Page content is processed locally; only structured metadata is sent to AI
Extension requires explicit user action to analyze pages
Performance Considerations
DOM parsing is optimized to run quickly even on large pages
All operations are asynchronous to prevent browser freezing
API calls include timeout protection (30 seconds)
TTS can be interrupted if another analysis is started
Limitations
Requires a Google Gemini API key (free tier available)
Cannot analyze pages that don't allow content scripts (chrome://, file://)
Summaries are limited to 200 tokens for quick responses
Requires active internet connection
Future Enhancements (Beyond Phase 1)
Custom voice selection for TTS
Adjustable speech rate
Summary history
Keyboard shortcuts
Support for additional AI models
Offline mode with cached summaries
Multi-language support
Troubleshooting
"Cannot analyze this page type"
Some pages don't support content scripts:

Chrome internal pages (chrome://)
Browser extension pages
Local file:// URLs (unless explicitly enabled)
"API key not configured"
Click the extension icon
Click "⚙️ Settings"
Enter your Gemini API key
Click "Save Key"
"Analysis failed"
Check these common issues:

Verify your API key is correct
Ensure you have an active internet connection
Check if you've exceeded your API quota
Try refreshing the page and analyzing again
No audio output
Check your system volume
Verify Chrome has permission to use audio
Try clicking "Analyze Page" again
Contributing
This is Phase 1 of Project Atlas. Contributions, bug reports, and feature suggestions are welcome!

License
MIT License - Feel free to use and modify for your needs

Credits
Built with:

Google Gemini API for AI-powered summaries
Chrome Extension APIs (Manifest V3)
Chrome Text-to-Speech API
Made with ♿ for accessibility Select the folder containing the extension files

Step 3: Configure the Extension
Click the extension icon in your Chrome toolbar
Click the "⚙️ Settings" button
Paste your Google Gemini API key
Click "Save Key"
Usage
Basic Usage
Navigate to any webpage you want to analyze
Click the Project Atlas extension icon
Click "Analyze Page Structure"
Wait a few seconds while the AI analyzes the page
