"""
Sherpa API - FastAPI application for voice-controlled web navigation
"""

import logging

from fastapi import (
    FastAPI,
    HTTPException,
    File,
    UploadFile,
    Form,
    Query,
    Path,
)
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from models import (
    CreateSessionRequest,
    CreateSessionResponse,
    InterpretResponse,
    GeneralQuestionRequest,
    GeneralQuestionResponse,
)
from services import SessionService, InterpretService, GeneralQuestionService
from config import settings

# Initialize FastAPI app
logger = logging.getLogger('uvicorn.error')
logger.setLevel(logging.DEBUG)

app = FastAPI(
    title=settings.API_TITLE,
    description=settings.API_DESCRIPTION,
    version=settings.API_VERSION,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post(
    "/v1/sessions",
    response_model=CreateSessionResponse,
    summary="Create Sessions",
    description="Create a short-lived 'page session' so the server can reuse the section map and summary while you're on the tab.",
)
async def create_session(request: CreateSessionRequest) -> CreateSessionResponse:
    """
    Create a new session for voice navigation.

    Args:
        request: Session creation request with URL, locale, and section map

    Returns:
        CreateSessionResponse with session_id and expiration time
    """
    try:
        response = SessionService.create_session(request)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post(
    "/v1/sessions/{session_id}/interpret",
    response_model=InterpretResponse,
    summary="Interpret a command (text or audio)",
    description="Send either text or an audio clip (push-to-talk). Server returns an intent + target (if any) and a short confirmation line you can TTS on the client.",
)
async def interpret_command(
    session_id: str = Path(..., description="Session identifier"),
    mode: str = Query("text", description="Mode: 'voice' or 'text'"),
    audio: Optional[UploadFile] = File(
        None, description="Audio file (wav/mp3/ogg), 16k–48kHz"
    ),
    text: Optional[str] = Form(None, description="Text command (for text mode)"),
    hint: Optional[str] = Form(None, description="Optional hint: 'navigate|read|list'"),
) -> InterpretResponse:
    """
    Interpret a voice or text command using form data.

    Args:
        session_id: The session identifier
        mode: "voice" or "text"
        audio: Audio file (for voice mode) - multipart/form-data
        text: Text command (for text mode) - form field
        hint: Optional hint about expected intent

    Returns:
        InterpretResponse with intent, target section, and TTS text
    """
    try:
        # Process audio if in voice mode
        audio_bytes = None
        if mode == "voice" and audio:
            audio_bytes = await audio.read()

        # Call interpretation service
        result = InterpretService.interpret_command(
            session_id=session_id,
            mode=mode,
            audio=audio_bytes,
            text=text,
            hint=hint,
        )

        return result.parsed

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post(
    "/v1/ask",
    response_model=GeneralQuestionResponse,
    summary="Ask a general question",
    description="Ask any question and get an AI-generated answer. Perfect for summaries, explanations, and general Q&A.",
)
async def ask_question(request: GeneralQuestionRequest) -> GeneralQuestionResponse:
    """
    Ask a general question and get an AI-generated answer.

    Args:
        request: General question request with question, context, and page info

    Returns:
        GeneralQuestionResponse with answer, confidence, and TTS text
    """
    try:
        # Call general question service
        result = await GeneralQuestionService.answer_question(
            question=request.question,
            context=request.context,
            page_title=request.page_title,
            page_url=request.page_url
        )

        return GeneralQuestionResponse(**result)

    except Exception as e:
        logger.error(f"General question endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG
    )
