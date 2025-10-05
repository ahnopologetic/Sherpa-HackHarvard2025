"""
Business logic for Sherpa API
"""

import logging
import os
import hashlib
from typing import Any, Dict, Optional

import uuid
import wave
from google import genai
from google.genai import types


from datetime import datetime, timedelta
from models import (
    CreateSessionRequest,
    CreateSessionResponse,
    ImmersiveSummaryTranscriptResponse,
    InterpretResponse,
)
from config import settings


# In-memory session storage (replace with Redis/database in production)
logger = logging.getLogger("uvicorn.error")
logger.setLevel(logging.DEBUG)  # Set your desired logging level

sessions: Dict[str, Dict] = {}
jobs: Dict[str, dict] = {}
# Cache for immersive summaries by URL hash
immersive_cache: Dict[str, dict] = {}
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


def generate_url_hash(page_url: str, page_title: str, context: Optional[str] = None) -> str:
    """
    Generate a hash for caching based on URL, title, and context.
    """
    # Create a string that represents the unique content
    content_string = f"{page_url}|{page_title}|{context or ''}"
    
    # Generate SHA-256 hash
    return hashlib.sha256(content_string.encode()).hexdigest()[:16]  # Use first 16 chars


def get_cached_immersive_summary(url_hash: str) -> Optional[dict]:
    """
    Get cached immersive summary if it exists.
    """
    if url_hash in immersive_cache:
        cached = immersive_cache[url_hash]
        # Check if the audio file still exists
        if os.path.exists(cached["audio_file"]):
            logger.info(f"📦 Using cached immersive summary for hash: {url_hash}")
            return cached
        else:
            # Clean up stale cache entry
            del immersive_cache[url_hash]
            logger.info(f"🗑️ Removed stale cache entry for hash: {url_hash}")
    
    return None


def cache_immersive_summary(url_hash: str, audio_file: str, transcript_data: ImmersiveSummaryTranscriptResponse) -> None:
    """
    Cache the immersive summary for future use.
    """
    immersive_cache[url_hash] = {
        "audio_file": audio_file,
        "transcript_data": transcript_data,
        "created_at": datetime.utcnow(),
    }
    logger.info(f"💾 Cached immersive summary for hash: {url_hash}")


def cleanup_old_cache_entries(max_age_hours: int = 24) -> None:
    """
    Clean up cache entries older than max_age_hours.
    """
    current_time = datetime.utcnow()
    cutoff_time = current_time - timedelta(hours=max_age_hours)
    
    to_remove = []
    for url_hash, cache_entry in immersive_cache.items():
        if cache_entry["created_at"] < cutoff_time:
            to_remove.append(url_hash)
    
    for url_hash in to_remove:
        cache_entry = immersive_cache[url_hash]
        # Try to delete the audio file
        try:
            if os.path.exists(cache_entry["audio_file"]):
                os.remove(cache_entry["audio_file"])
        except OSError:
            pass  # File might be in use
        
        del immersive_cache[url_hash]
        logger.info(f"🗑️ Cleaned up old cache entry: {url_hash}")
    
    if to_remove:
        logger.info(f"🧹 Cleaned up {len(to_remove)} old cache entries")


def get_cache_stats() -> dict:
    """
    Get cache statistics.
    """
    total_entries = len(immersive_cache)
    total_size = 0
    
    for cache_entry in immersive_cache.values():
        try:
            if os.path.exists(cache_entry["audio_file"]):
                total_size += os.path.getsize(cache_entry["audio_file"])
        except OSError:
            pass
    
    return {
        "total_entries": total_entries,
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / (1024 * 1024), 2),
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
        Generate an immersive summary of the page with caching support.
        """
        # Generate hash for caching
        url_hash = generate_url_hash(page_url, page_title, context)
        
        # Check if we have a cached version
        cached = get_cached_immersive_summary(url_hash)
        if cached:
            # Use cached version - copy the audio file to the job_id location
            import shutil
            shutil.copy2(cached["audio_file"], f"{job_id}.wav")
            
            # Store job data
            jobs[job_id] = {
                "session_id": session_id,
                "page_url": page_url,
                "page_title": page_title,
                "context": context,
                "status": "completed",
                "transcript_data": cached["transcript_data"],
                "cached": True,
                "cache_hash": url_hash,
            }
            logger.info(f"✅ Using cached immersive summary for job {job_id} (hash: {url_hash})")
            return
        
        # No cache found, generate new summary
        jobs[job_id] = {
            "session_id": session_id,
            "page_url": page_url,
            "page_title": page_title,
            "context": context,
            "status": "pending",
            "cache_hash": url_hash,
        }
        
        result = ImmersiveSummaryService.generate_immersive_summary_transcript(
            session_id=session_id,
            page_url=page_url,
            page_title=page_title,
            context=context,
        )
        logger.info(f"{result.playback_time=}")
        
        # Generate audio
        audio_file = f"{job_id}.wav"
        ImmersiveSummaryService.generate_immersive_summary_audio(
            transcript=result.transcript,
            output_filepath=audio_file,
        )
        
        # Cache the result
        cache_immersive_summary(url_hash, audio_file, result)
        
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["transcript_data"] = result
        jobs[job_id]["cached"] = False
        logger.info(f"✅ Generated new immersive summary for job {job_id} (hash: {url_hash})")

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

    def get_immersive_summary_transcript(
        job_id: str,
    ) -> ImmersiveSummaryTranscriptResponse:
        """
        Get the immersive summary transcript data with playback times.
        """
        if job_id not in jobs:
            raise ValueError("Job not found")
        if jobs[job_id]["status"] != "completed":
            raise ValueError("Job not completed")
        if "transcript_data" not in jobs[job_id]:
            raise ValueError("Transcript data not found")
        return jobs[job_id]["transcript_data"]

    @staticmethod
    def handle_interaction(
        job_id: str,
        audio_bytes: bytes,
        current_position: Optional[float] = None,
    ) -> tuple[str, str, bytes]:
        """
        Handle user interaction with immersive summary.
        
        Args:
            job_id: The job ID for the immersive summary
            audio_bytes: The audio bytes of the user's question
            current_position: Current playback position in seconds
        
        Returns:
            Tuple of (answer_text, transcribed_question, answer_audio_bytes)
        """
        # Check if job exists and is completed
        if job_id not in jobs:
            raise ValueError("Job not found")
        if jobs[job_id]["status"] != "completed":
            raise ValueError("Job not completed")
        
        # Get the transcript data for context
        transcript_data = jobs[job_id].get("transcript_data")
        if not transcript_data:
            raise ValueError("Transcript data not found")
        
        # Initialize Gemini client
        client = genai.Client(
            api_key=settings.GOOGLE_VERTEX_AI_API_KEY,
        )
        
        # Get the original context
        original_context = transcript_data.transcript if hasattr(transcript_data, 'transcript') else ""
        page_title = jobs[job_id].get("page_title", "")
        
        # Use Gemini to transcribe and answer the question
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Part(
                        inline_data=types.Blob(mime_type="audio/wav", data=audio_bytes)
                    ),
                    types.Part(
                        text=(
                            f"You are a thoughtful co-host for an immersive audio summary. "
                            f"The user is listening to a summary about '{page_title}'. "
                            f"They have paused and asked a question. "
                            f"\n\nOriginal content context:\n{original_context[:1000]}...\n\n"
                            f"Instructions:\n"
                            f"1. Listen to and transcribe the user's question\n"
                            f"2. Answer their question in a friendly, insightful way based on the content\n"
                            f"3. Keep your answer concise but helpful (2-3 sentences)\n"
                            f"4. At the end, naturally transition back: 'Now, let's continue with the summary.'\n\n"
                            f"Respond in JSON format with two fields:\n"
                            f"- transcribed_question: the user's question as text\n"
                            f"- answer: your complete answer including the transition back"
                        )
                    ),
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.7,
                ),
            )
            
            # Parse the response
            import json
            result = json.loads(response.text)
            transcribed_question = result.get("transcribed_question", "Could not transcribe question")
            answer_text = result.get("answer", "Sorry, I couldn't process your question.")
            
        except Exception as e:
            logger.error(f"Gemini API error during interaction: {e}")
            transcribed_question = "Error transcribing question"
            answer_text = "Sorry, I couldn't process your question. Let's continue with the summary."
        
        # Generate TTS audio for the answer using Gemini TTS
        try:
            tts_response = client.models.generate_content(
                model="gemini-2.5-flash-preview-tts",
                contents=answer_text,
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
            
            answer_audio_bytes = tts_response.candidates[0].content.parts[0].inline_data.data
            
        except Exception as e:
            logger.error(f"TTS generation error: {e}")
            # Return empty audio if TTS fails
            answer_audio_bytes = b""
        
        return answer_text, transcribed_question, answer_audio_bytes
