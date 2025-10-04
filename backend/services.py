"""
Business logic for Sherpa API
"""
import uuid
from datetime import datetime, timedelta
from typing import Dict, Optional
from models import CreateSessionRequest, CreateSessionResponse, SectionMapV1
from config import settings


# In-memory session storage (replace with Redis/database in production)
sessions: Dict[str, Dict] = {}


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
            "created_at": datetime.utcnow()
        }
        
        return CreateSessionResponse(
            session_id=session_id,
            expires_in=expires_in
        )
    
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
            sid for sid, data in sessions.items()
            if current_time > data["expires_at"]
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
        hint: Optional[str] = None
    ) -> Dict:
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
        
        section_map = session["section_map"]
        
        # TODO: Implement actual ASR and NLU processing
        # For now, return a mock response
        
        # Mock processing times
        asr_ms = 640 if mode == "voice" else 0
        nlu_ms = 420
        
        # Mock intent detection (this would use ML models in production)
        intent = "NAVIGATE"
        target_section_id = "comments"
        confidence = 0.91
        tts_text = "Now in comments."
        alternatives = [
            {
                "label": "Sidebar",
                "section_id": "sidebar",
                "confidence": 0.62
            }
        ]
        
        return {
            "intent": intent,
            "target_section_id": target_section_id,
            "confidence": confidence,
            "tts_text": tts_text,
            "alternatives": alternatives,
            "telemetry": {
                "asr_ms": asr_ms,
                "nlu_ms": nlu_ms
            }
        }

