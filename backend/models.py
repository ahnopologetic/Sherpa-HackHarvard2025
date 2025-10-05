"""
Pydantic models for Sherpa API based on OpenAPI specification
"""

from typing import Optional, List, Dict
from pydantic import BaseModel, Field


# Schema models for SectionMapV1
class SectionModel(BaseModel):
    """Model for a navigable section of a page"""

    id: str = Field(
        ..., description="Section id (e.g., 'footer', 'main-article', 'comments')"
    )
    label: str = Field(..., description="Spoken label for the section")
    role: str = Field(
        ...,
        description="ARIA role (e.g., 'main', 'contentinfo', 'region', 'complementary')",
    )


class SectionMapV1(BaseModel):
    """Simplified section map for page navigation"""

    title: str = Field(
        ..., description="Required: clean page title (from <h1> or document.title)"
    )
    sections: List[SectionModel] = Field(
        ..., description="Required: list of navigable regions (order doesn't matter)"
    )
    aliases: Optional[Dict[str, str]] = Field(
        None, description="Optional: simple synonyms → section id mapping"
    )


# Request/Response models for API endpoints
class CreateSessionRequest(BaseModel):
    url: str = Field(..., description="Canonical page URL for this session")
    locale: str = Field(..., description="Locale (e.g., en-US)")
    voice: Optional[str] = None
    section_map: SectionMapV1


class CreateSessionResponse(BaseModel):
    session_id: str
    expires_in: int = Field(..., description="Session expiration time in seconds")


class AlternativeModel(BaseModel):
    label: str
    section_id: str
    confidence: float


class TelemetryModel(BaseModel):
    asr_ms: int = Field(..., description="ASR processing time in milliseconds")
    nlu_ms: int = Field(..., description="NLU processing time in milliseconds")


class InterpretRequest(BaseModel):
    text: Optional[str] = None
    audio: Optional[bytes] = None
    hint: Optional[str] = None


class InterpretResponse(BaseModel):
    intent: str = Field(
        ..., description="NAVIGATE | READ_SECTION | LIST_SECTIONS | UNKNOWN"
    )
    target_section_id: str = Field(..., description="Present when resolvable")
    confidence: float
    tts_text: str = Field(..., description="Short text ready to read aloud")
    transcription: Optional[str] = Field(
        None, description="Transcribed text from audio (for voice mode)"
    )
    alternatives: List[AlternativeModel]
    telemetry: TelemetryModel


# General Q&A Models
class GeneralQuestionRequest(BaseModel):
    """Request model for general questions"""

    question: str = Field(..., description="The question to ask")
    context: Optional[str] = Field(
        None, description="Additional context for the question"
    )
    page_title: Optional[str] = Field(None, description="Title of the current page")
    page_url: Optional[str] = Field(None, description="URL of the current page")


class GeneralQuestionResponse(BaseModel):
    """Response model for general questions"""

    answer: str = Field(..., description="AI-generated answer to the question")
    confidence: float = Field(..., description="Confidence score (0.0 to 1.0)")
    tts_text: str = Field(..., description="Text-to-speech version of the answer")


class ImmersiveSummaryRequest(BaseModel):
    """Request model for immersive summary"""

    session_id: str = Field(..., description="Session ID for the immersive summary")
    page_url: str = Field(..., description="URL of the current page")
    page_title: str = Field(..., description="Title of the current page")
    context: Optional[str] = Field(
        None, description="Additional context for the summary"
    )


class ImmersiveSummaryResponse(BaseModel):
    """Response model for immersive summary"""

    job_id: str = Field(..., description="Job ID for the immersive summary")


class ImmersiveSummaryTranscriptPlaybackTime(BaseModel):
    """Response model for immersive summary transcript playback time"""

    name: str = Field(..., description="Name of the section")
    playback_time: str = Field(..., description="Playback time of the section")


class ImmersiveSummaryTranscriptResponse(BaseModel):
    """Response model for immersive summary transcript"""

    transcript: str = Field(..., description="Transcript of the immersive summary")
    error: Optional[str] = Field(None, description="Error message if the job failed")
    playback_time: Optional[List[ImmersiveSummaryTranscriptPlaybackTime]] = Field(
        None,
        description="Playback time of the transcript. For example: [{'name': 'Main article', 'playback_time': '00:00'}, ...]",
    )


class ImmersiveSummaryInteractRequest(BaseModel):
    """Request model for interacting with immersive summary"""

    current_position: Optional[float] = Field(
        None, description="Current playback position in seconds"
    )


class ImmersiveSummaryInteractResponse(BaseModel):
    """Response model for interacting with immersive summary"""

    answer_text: str = Field(..., description="Text of the answer")
    transcribed_question: str = Field(
        ..., description="Transcribed question from user audio"
    )
