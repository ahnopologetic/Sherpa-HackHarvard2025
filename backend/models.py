"""
Pydantic models for Sherpa API based on OpenAPI specification
"""
from typing import Optional, List, Dict
from pydantic import BaseModel, Field


# Schema models for SectionMapV1
class SectionModel(BaseModel):
    """Model for a navigable section of a page"""
    id: str = Field(..., description="Section id (e.g., 'footer', 'main-article', 'comments')")
    label: str = Field(..., description="Spoken label for the section")
    role: str = Field(..., description="ARIA role (e.g., 'main', 'contentinfo', 'region', 'complementary')")


class SectionMapV1(BaseModel):
    """Simplified section map for page navigation"""
    title: str = Field(..., description="Required: clean page title (from <h1> or document.title)")
    sections: List[SectionModel] = Field(
        ..., 
        description="Required: list of navigable regions (order doesn't matter)"
    )
    aliases: Optional[Dict[str, str]] = Field(
        None, 
        description="Optional: simple synonyms → section id mapping"
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


class InterpretResponse(BaseModel):
    intent: str = Field(..., description="NAVIGATE | READ_SECTION | LIST_SECTIONS | UNKNOWN")
    target_section_id: str = Field(..., description="Present when resolvable")
    confidence: float
    tts_text: str = Field(..., description="Short text ready to read aloud")
    alternatives: List[AlternativeModel]
    telemetry: TelemetryModel

