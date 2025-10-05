"""
Business logic for Sherpa API
"""

import logging
import os
from typing import Any, Dict, Optional

import uuid
import wave
from google import genai
from google.genai import types


from datetime import datetime, timedelta
from models import (
    CreateSessionRequest,
    CreateSessionResponse,
    ImmersiveSummaryResponse,
    ImmersiveSummaryTranscriptResponse,
    InterpretResponse,
)
from config import settings


# In-memory session storage (replace with Redis/database in production)
logger = logging.getLogger("uvicorn.error")
logger.setLevel(logging.DEBUG)  # Set your desired logging level

sessions: Dict[str, Dict] = {}
jobs: Dict[str, dict] = {}
MOCK_SECTION_MAP = {
    "title": "Why bees matter",
    "sections": [
        {"id": "main-article", "label": "Main article", "role": "main"},
        {"id": "comments", "label": "Comments", "role": "region"},
    ],
    "aliases": {"discussion": "comments"},
}


def wave_file(filename, pcm, channels=1, rate=24000, sample_width=2):
    with wave.open(filename, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm)


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
            content_parts.append(
                types.Part(inline_data=types.Blob(mime_type="audio/ogg", data=audio))
            )
            content_parts.append(
                types.Part(text="Transcribe this audio and interpret the command.")
            )
        elif text:
            # For text mode, use the text directly
            content_parts.append(types.Part(text=f"Command: {text}"))
        else:
            raise ValueError("Either audio (in audio mode) or text must be provided")

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[types.Content(role="user", parts=content_parts)],
            config=types.GenerateContentConfig(
                system_instruction=f"""
                You are a helpful assistant that can interpret voice or text commands to navigate through different sections of a page.
                You are given a section map of the page and a command.
                If audio is provided, first transcribe it and then interpret the command. Include the transcription in the "transcription" field.
                You need to return the intent, target section id, confidence, tts text, transcription (for audio), and alternatives.
                The intent can be NAVIGATE, READ_SECTION, LIST_SECTIONS, or UNKNOWN.
                
                Intent Guidelines:
                - NAVIGATE: User wants to jump/scroll to a specific section (e.g., "go to comments", "show me the footer")
                - READ_SECTION: User wants to read/hear the content of a specific section (e.g., "read the main article")
                - LIST_SECTIONS: User wants to know what sections are available (e.g., "what sections are there?", "what can I navigate to?", "show available sections", "list sections")
                - UNKNOWN: Cannot determine intent or section
                
                For LIST_SECTIONS intent:
                - Set target_section_id to an empty string ""
                - In tts_text, provide a friendly spoken list of available sections with brief descriptions based on their labels and roles
                - Example tts_text: "There are 3 sections available: Main article for the main content, Comments section for discussions, and Footer for additional information."
                - Keep it concise and natural for text-to-speech
                
                For other intents:
                - The target_section_id is the id of the section that the user wants to navigate to or read
                - The confidence is a number between 0 and 1
                - For the transcription field: if this is audio input, include the transcribed text. If text input, you can leave it null or copy the text.

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


class GeneralQuestionService:
    """Service for handling general questions using Gemini"""

    @staticmethod
    async def answer_question(
        question: str,
        context: Optional[str] = None,
        page_title: Optional[str] = None,
        page_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Answer a general question using Gemini API

        Args:
            question: The question to answer
            context: Additional context for the question
            page_title: Title of the current page
            page_url: URL of the current page

        Returns:
            Dictionary with answer, confidence, and tts_text
        """
        try:
            # Initialize Gemini client
            client = genai.Client(
                api_key=settings.GOOGLE_VERTEX_AI_API_KEY,
            )

            # Create a prompt for general questions
            prompt = f"""You are a helpful AI assistant that answers questions about web content for accessibility purposes.

Question: {question}

Context Information:
- Page Title: {page_title or "Not specified"}
- Page URL: {page_url or "Not specified"}
- Additional Context: {context or "No additional context provided"}

Please provide a helpful, accurate, and accessible answer to the question. If the question is about summarizing content, provide a clear and concise summary. If it's about explaining something, provide a detailed explanation that would be helpful for visually impaired users.

Keep your response conversational, clear, and under 200 words. Focus on being helpful and accessible."""

            # Call Gemini API
            response = client.models.generate_content(
                model="gemini-2.0-flash-exp",
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.3, top_k=20, top_p=0.8, max_output_tokens=300
                ),
            )

            # Extract text from response
            answer = response.text.strip()

            return {
                "answer": answer,
                "confidence": 0.9,  # High confidence for general questions
                "tts_text": answer,
            }

        except Exception as e:
            logger.error(f"General question error: {e}")
            return {
                "answer": f"Sorry, I couldn't answer that question: {str(e)}",
                "confidence": 0.0,
                "tts_text": "Sorry, I couldn't answer that question.",
            }


class ImmersiveSummaryService:
    """Service for generating immersive summary"""

    @staticmethod
    def generate_immersive_summary_transcript(
        session_id: str,
        page_url: str,
        page_title: str,
        context: Optional[str] = None,
    ) -> ImmersiveSummaryTranscriptResponse:
        """
        Generate an immersive summary of the page.
        """
        logger.info("Generating immersive summary transcript")
        client = genai.Client(
            api_key=settings.GOOGLE_VERTEX_AI_API_KEY,
        )

        prompt = f"""
### 🧩 Prompt: *Immersive Summary Transcript Generator*

**Role:**
You are an *audio narrator and sensory writer* tasked with generating an *immersive transcript* for a visually-impaired listener. Your goal is to capture **not just what the page says**, but also **how it feels** — tone, layout, imagery, and flow — so the listener experiences the emotional and structural essence of the webpage as if seeing it.

**Input:**
- Page URL: {page_url}
- Page Title: {page_title}
- Page Section Map: {sessions.get(session_id, {}).get("section_map") or MOCK_SECTION_MAP}

**Instructions:**
Based on the provided section map, split the immersive summary into distinct sections. For each section, generate a *spoken-style transcript* (not a plain summary) that includes:

1. **Section Title and Timestamp**
   - Start each section with its title and a timestamp (e.g., "[00:00] Main article").
   - The timestamp should reflect the approximate start time of the section in the overall narration.

2. **Section Content**
   - Describe the content, layout, and emotional tone of the section.
   - Read key sentences naturally, summarizing paragraphs concisely.
   - Insert gentle transitions between sections (“Next, the article shifts focus to…”).
   - When encountering an image, describe it vividly but succinctly (“A photo of three students holding signs, smiling under the sunlight”).
   - Maintain rhythm, tone, and pacing consistent with the sentiment of each section (e.g., calm, urgent, celebratory).

3. **Visual and Emotional Context**
   - Convey color, typography, or layout as emotional cues, not raw data.
   - Example: “The next section, written in bold white letters over a deep blue background, gives a sense of quiet determination.”
   - For pull quotes or asides, use expressive narration: “In a highlighted note to the side, the author writes…”

4. **Closure**
   - End with a short reflection that feels like the visual “bottom” of the page.
   - Mention footers or author credits naturally (“At the end, the article credits journalist Alex Kim, writing for The Atlantic.”).
   - Close with a gentle sign-off cue (“End of immersive summary.”).

**Style Requirements:**
- Keep the total transcript under 5 minutes when read aloud (~500–700 words).
- Use conversational pacing, not robotic summarization.
- Include the timestamp of each section in the summary.
- Prioritize sensory verbs: *see, feel, stand, hover, glow, flow, stretch, rise*.
- Avoid data or URLs unless crucial for meaning.
- Use accessible language: vivid yet clear.
        """

        try:
            # Create a prompt for immersive summary
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    top_k=10,
                    top_p=0.8,
                    response_schema=ImmersiveSummaryTranscriptResponse,
                    response_mime_type="application/json",
                ),
            )
            logger.info("Immersive summary transcript generated successfully")
            return response.parsed
        except Exception as e:
            logger.error(f"Immersive summary error: {e}")
            return ImmersiveSummaryTranscriptResponse(
                transcript=f"Sorry, I couldn't generate a summary: {str(e)}",
                error=str(e),
            )

    @staticmethod
    def generate_immersive_summary_audio(
        transcript: str,
        output_filepath: str,
    ) -> bytes:
        """
        Generate an immersive summary of the page.
        """
        client = genai.Client(
            api_key=settings.GOOGLE_VERTEX_AI_API_KEY,
        )

        response = client.models.generate_content(
            model="gemini-2.5-flash-preview-tts",
            contents=transcript,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name="Kore",
                        )
                    )
                ),
            ),
        )

        data = response.candidates[0].content.parts[0].inline_data.data
        wave_file(output_filepath, data)
        logger.info("Immersive summary audio generated successfully")
        return data

    def generate_immersive_summary_audio_job(
        job_id: str,
        session_id: str,
        page_url: str,
        page_title: str,
        context: Optional[str] = None,
    ) -> None:
        """
        Generate an immersive summary of the page.
        """
        jobs[job_id] = {
            "session_id": session_id,
            "page_url": page_url,
            "page_title": page_title,
            "context": context,
            "status": "pending",
        }
        result = ImmersiveSummaryService.generate_immersive_summary_transcript(
            session_id=session_id,
            page_url=page_url,
            page_title=page_title,
            context=context,
        )
        ImmersiveSummaryService.generate_immersive_summary_audio(
            transcript=result.transcript,
            output_filepath=f"{job_id}.wav",
        )
        jobs[job_id]["status"] = "completed"
        logger.info("Immersive summary audio job completed")

    def get_immersive_summary_audio(job_id: str) -> bytes:
        """
        Get the immersive summary audio.
        """
        if job_id not in jobs:
            raise ValueError("Job not found")
        if jobs[job_id]["status"] != "completed":
            raise ValueError("Job not completed")
        if not os.path.exists(f"{job_id}.wav"):
            raise ValueError("File not found")
        return open(f"{job_id}.wav", "rb").read()
