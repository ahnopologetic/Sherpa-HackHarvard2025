"""
Business logic for Sherpa API
"""

import logging

import uuid
from google import genai
from google.genai import types


from datetime import datetime, timedelta
from typing import Dict, Optional
from models import CreateSessionRequest, CreateSessionResponse, InterpretResponse
from config import settings


# In-memory session storage (replace with Redis/database in production)
logger = logging.getLogger('uvicorn.error')
logger.setLevel(logging.DEBUG) # Set your desired logging level

sessions: Dict[str, Dict] = {}
MOCK_SECTION_MAP = {
    "title": "Why bees matter",
    "sections": [
        {"id": "main-article", "label": "Main article", "role": "main"},
        {"id": "comments", "label": "Comments", "role": "region"},
    ],
    "aliases": {"discussion": "comments"},
}


class SessionService:
    """Service for managing user sessions"""

    @staticmethod
    def create_session(request: CreateSessionRequest) -> CreateSessionResponse:
        """
        Create a new session for the given URL and section map.

        Args:
            request: Session creation request

        Returns:
            CreateSessionResponse with session_id and expiration time
        """
        # Generate unique session ID
        session_id = f"sess_{uuid.uuid4().hex[:12]}"

        # Set expiration time from settings
        expires_in = settings.SESSION_EXPIRE_SECONDS
        expiration_time = datetime.utcnow() + timedelta(seconds=expires_in)

        # Store session data
        sessions[session_id] = {
            "url": request.url,
            "locale": request.locale,
            "voice": request.voice or "default",
            "section_map": request.section_map.model_dump(),
            "expires_at": expiration_time,
            "created_at": datetime.utcnow(),
        }

        return CreateSessionResponse(session_id=session_id, expires_in=expires_in)

    @staticmethod
    def get_session(session_id: str) -> Optional[Dict]:
        """
        Retrieve session data by session_id.

        Args:
            session_id: The session identifier

        Returns:
            Session data if exists and not expired, None otherwise
        """
        session = sessions.get(session_id)

        if not session:
            return None

        # Check if session has expired
        if datetime.utcnow() > session["expires_at"]:
            # Clean up expired session
            del sessions[session_id]
            return None

        return session

    @staticmethod
    def cleanup_expired_sessions():
        """Remove all expired sessions from storage"""
        current_time = datetime.utcnow()
        expired_sessions = [
            sid for sid, data in sessions.items() if current_time > data["expires_at"]
        ]
        for sid in expired_sessions:
            del sessions[sid]


class InterpretService:
    """Service for interpreting voice/text commands"""

    @staticmethod
    def interpret_command(
        session_id: str,
        mode: str,
        audio: Optional[bytes] = None,
        text: Optional[str] = None,
        hint: Optional[str] = None,
    ) -> InterpretResponse:
        """
        Interpret a voice or text command.

        Args:
            session_id: The session identifier
            mode: "voice" or "text"
            audio: Audio file bytes (for voice mode)
            text: Text command (for text mode)
            hint: Optional hint (navigate|read|list)

        Returns:
            Interpretation result with intent, target, and TTS text
        """
        # Get session data
        session = SessionService.get_session(session_id)
        if not session:
            raise ValueError("Invalid or expired session")

        client = genai.Client(
            api_key=settings.GOOGLE_VERTEX_AI_API_KEY,
        )

        section_map = session.get("section_map") or MOCK_SECTION_MAP
        logger.info(f"{section_map=}")

        # Prepare content parts based on mode
        content_parts = []
        
        if mode == "voice" and audio:
            # For audio mode, pass the audio directly to Gemini for transcription
            logger.info(f"Processing audio input, size: {len(audio)} bytes")
            content_parts.append(types.Part(inline_data=types.Blob(
                mime_type="audio/ogg",
                data=audio
            )))
            content_parts.append(types.Part(text="Transcribe this audio and interpret the command."))
        elif text:
            # For text mode, use the text directly
            content_parts.append(types.Part(text=f"Command: {text}"))
        else:
            raise ValueError("Either audio (in audio mode) or text must be provided")

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Content(role="user", parts=content_parts)
            ],
            config=types.GenerateContentConfig(
                system_instruction=f"""
                You are a helpful assistant that can interpret voice or text commands to navigate through different sections of a page.
                You are given a section map of the page and a command.
                If audio is provided, first transcribe it and then interpret the command. Include the transcription in the "transcription" field.
                You need to return the intent, target section id, confidence, tts text, transcription (for audio), and alternatives.
                The intent can be NAVIGATE, READ_SECTION, LIST_SECTIONS, or UNKNOWN.
                The target section id is the id of the section that the user wants to navigate to.
                The confidence is a number between 0 and 1.
                For the transcription field: if this is audio input, include the transcribed text. If text input, you can leave it null or copy the text.

                Given the section map below, please interpret the command and return the intent, target section id, confidence, tts text, transcription, and alternatives.
                {section_map}
                """,
                response_mime_type="application/json",
                response_schema=InterpretResponse,
            ),
        )
        logger.info(f"{response.parsed=}")

        # Mock processing times
        # TODO: Implement actual ASR and NLU processing
        asr_ms = 640 if mode in ["voice", "audio"] else 0
        nlu_ms = 420

        return response
