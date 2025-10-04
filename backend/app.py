"""
Sherpa API - FastAPI application for voice-controlled web navigation
"""

from fastapi import FastAPI, HTTPException, File, UploadFile, Form, Query, Path
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from models import CreateSessionRequest, CreateSessionResponse, InterpretResponse
from services import SessionService, InterpretService
from config import settings

# Initialize FastAPI app
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


@app.get(
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
    hint: Optional[str] = Form(None, description="Optional hint: 'navigate|read|list'"),
) -> InterpretResponse:
    """
    Interpret a voice or text command.

    Args:
        session_id: The session identifier
        mode: "voice" or "text"
        audio: Audio file (for voice mode)
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
            session_id=session_id, mode=mode, audio=audio_bytes, hint=hint
        )

        return InterpretResponse(**result)

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
