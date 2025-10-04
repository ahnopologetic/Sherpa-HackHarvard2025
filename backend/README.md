# Sherpa Backend API

Voice-controlled web navigation API built with FastAPI.

## Overview

Sherpa provides an API for voice-controlled web navigation. It allows users to create sessions for web pages and interpret voice or text commands to navigate through different sections of a page.

## Features

- **Session Management**: Create short-lived sessions for page navigation
- **Voice/Text Interpretation**: Interpret user commands via voice or text input
- **Intent Detection**: Identify user intents (NAVIGATE, READ_SECTION, LIST_SECTIONS)
- **Section Mapping**: Map web page sections for easy navigation

## API Endpoints

### 1. Create Session
**POST** `/v1/sessions`

Create a short-lived "page session" so the server can reuse the section map and summary.

**Request Body:**
```json
{
  "url": "https://news.example.com/article",
  "locale": "en-US",
  "voice": "default",
  "section_map": {
    "title": "Why bees matter",
    "sections": [
      {
        "id": "main-article",
        "label": "Main article",
        "role": "main"
      },
      {
        "id": "comments",
        "label": "Comments",
        "role": "region"
      },
      {
        "id": "sidebar",
        "label": "Sidebar",
        "role": "complementary"
      },
      {
        "id": "footer",
        "label": "Footer",
        "role": "contentinfo"
      }
    ],
    "aliases": {
      "discussion": "comments"
    }
  }
}
```

**Response:**
```json
{
  "session_id": "sess_abc123",
  "expires_in": 900
}
```

### 2. Interpret Command
**GET** `/v1/sessions/{session_id}/interpret`

Interpret a voice or text command to determine user intent and target section.

**Query Parameters:**
- `mode`: "voice" or "text" (default: "text")

**Form Data:**
- `audio`: Audio file (wav/mp3/ogg) for voice mode
- `hint`: Optional hint ("navigate|read|list")

**Response:**
```json
{
  "intent": "NAVIGATE",
  "target_section_id": "comments",
  "confidence": 0.91,
  "tts_text": "Now in comments.",
  "alternatives": [
    {
      "label": "Sidebar",
      "section_id": "sidebar",
      "confidence": 0.62
    }
  ],
  "telemetry": {
    "asr_ms": 640,
    "nlu_ms": 420
  }
}
```

### 3. Health Check
**GET** `/health`

Check API health status.

## Installation

1. Install dependencies using `uv`:
```bash
uv sync
```

2. Activate the virtual environment:
```bash
source .venv/bin/activate
```

## Running the Server

Start the development server:
```bash
python app.py
```

Or using uvicorn directly:
```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

## API Documentation

Once the server is running, access:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Section Map Structure

The `section_map` is a simplified structure representing navigable regions on a web page:

### Fields

- **`title`** (string, required): Clean page title from `<h1>` or `document.title`
- **`sections`** (array, required): List of navigable page regions
  - **`id`** (string): Unique identifier for the section (e.g., "main-article", "comments", "footer")
  - **`label`** (string): Human-readable label for voice navigation (e.g., "Main article", "Comments")
  - **`role`** (string): ARIA role defining the section type:
    - `main` - Main content area
    - `region` - Generic landmark region
    - `complementary` - Supporting content (sidebar, related articles)
    - `contentinfo` - Footer information
    - `navigation` - Navigation menu
- **`aliases`** (object, optional): Simple synonym mapping for natural language commands
  - Key: Synonym (e.g., "discussion")
  - Value: Target section ID (e.g., "comments")

### Example

```json
{
  "title": "Article Title",
  "sections": [
    {
      "id": "main-article",
      "label": "Main article",
      "role": "main"
    },
    {
      "id": "comments",
      "label": "Comments",
      "role": "region"
    }
  ],
  "aliases": {
    "discussion": "comments",
    "main content": "main-article"
  }
}
```

## Project Structure

```
backend/
├── app.py          # FastAPI application and endpoints
├── models.py       # Pydantic models for request/response
├── services.py     # Business logic and services
├── config.py       # Configuration management
├── test_api.py     # API test script
├── pyproject.toml  # Project dependencies
└── README.md       # This file
```

## Development Notes

### Current Implementation

- **Session Storage**: Currently uses in-memory storage. For production, use Redis or a database.
- **ASR/NLU**: Mock implementation. Replace with actual speech recognition and natural language understanding models.
- **Authentication**: Not implemented. Add API keys or OAuth for production.

### Future Enhancements

1. Implement actual ASR (Automatic Speech Recognition) using services like:
   - OpenAI Whisper
   - Google Speech-to-Text
   - AssemblyAI

2. Implement NLU (Natural Language Understanding) for intent detection:
   - Custom ML models
   - OpenAI GPT for intent classification
   - Rasa NLU

3. Add persistent session storage:
   - Redis for session caching
   - PostgreSQL for long-term storage

4. Add authentication and rate limiting

5. Implement telemetry and logging

## Contributing

Follow Django/FastAPI best practices:
- Keep views light, business logic in services
- Use type hints
- Write tests for all endpoints
- Follow PEP 8 style guide

## License

MIT License

