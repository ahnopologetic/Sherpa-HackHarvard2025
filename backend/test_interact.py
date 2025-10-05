"""
Test script for the immersive summary interaction endpoint

This script demonstrates how to:
1. Create a session
2. Generate an immersive summary
3. Interact with it by asking questions via audio
"""

import requests
import time
import wave
import io


BASE_URL = "http://localhost:8000"


def create_test_session():
    """Create a test session"""
    print("📝 Creating test session...")
    response = requests.post(
        f"{BASE_URL}/v1/sessions",
        json={
            "url": "https://example.com/article",
            "locale": "en-US",
            "section_map": {
                "title": "The Future of AI",
                "sections": [
                    {"id": "main-article", "label": "Main article", "role": "main"},
                    {"id": "comments", "label": "Comments", "role": "region"},
                ],
                "aliases": {"discussion": "comments"},
            },
        },
    )
    response.raise_for_status()
    session_id = response.json()["session_id"]
    print(f"✅ Session created: {session_id}")
    return session_id


def generate_immersive_summary(session_id):
    """Generate an immersive summary"""
    print("\n🎧 Generating immersive summary...")
    response = requests.post(
        f"{BASE_URL}/v1/immersive-summary",
        json={
            "session_id": session_id,
            "page_url": "https://example.com/article",
            "page_title": "The Future of AI",
            "context": "An in-depth article about artificial intelligence trends",
        },
    )
    response.raise_for_status()
    job_id = response.json()["job_id"]
    print(f"✅ Job created: {job_id}")
    return job_id


def wait_for_job_completion(job_id, max_wait=60):
    """Wait for the immersive summary job to complete"""
    print("\n⏳ Waiting for job to complete...")
    start_time = time.time()
    
    while time.time() - start_time < max_wait:
        try:
            response = requests.get(f"{BASE_URL}/v1/immersive-summary/{job_id}")
            if response.status_code == 200:
                print("✅ Immersive summary generated successfully!")
                return True
        except requests.exceptions.RequestException:
            pass
        
        time.sleep(2)
    
    print("❌ Timeout waiting for job completion")
    return False


def create_test_audio():
    """
    Create a simple test audio file (silence) for demonstration
    In real usage, this would be actual recorded audio from the user
    """
    # Create a 2-second silent audio file
    sample_rate = 16000
    duration = 2
    
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        # Write silence
        wf.writeframes(b'\x00\x00' * sample_rate * duration)
    
    buffer.seek(0)
    return buffer.read()


def interact_with_summary(job_id, audio_data, current_position=None):
    """
    Ask a question during immersive summary playback
    
    Args:
        job_id: The job ID of the immersive summary
        audio_data: Audio bytes containing the user's question
        current_position: Optional current playback position in seconds
    """
    print("\n🎤 Asking question to the immersive summary...")
    
    files = {
        'audio': ('question.wav', audio_data, 'audio/wav')
    }
    
    data = {}
    if current_position is not None:
        data['current_position'] = current_position
    
    response = requests.post(
        f"{BASE_URL}/v1/immersive-summary/{job_id}/interact",
        files=files,
        data=data,
    )
    
    response.raise_for_status()
    
    # Get the transcribed question and answer from headers
    transcribed_question = response.headers.get('X-Transcribed-Question', 'N/A')
    answer_text = response.headers.get('X-Answer-Text', 'N/A')
    
    print(f"📝 Transcribed Question: {transcribed_question}")
    print(f"💬 Answer: {answer_text}")
    
    # Save the answer audio
    answer_filename = f"answer_{job_id}.wav"
    with open(answer_filename, 'wb') as f:
        f.write(response.content)
    
    print(f"🔊 Answer audio saved to: {answer_filename}")
    print("▶️  You can now play this audio, and then resume the original summary!")
    
    return answer_filename


def main():
    """Main test flow"""
    print("🚀 Testing Immersive Summary Interaction Feature\n")
    print("=" * 60)
    
    try:
        # Step 1: Create session
        session_id = create_test_session()
        
        # Step 2: Generate immersive summary
        job_id = generate_immersive_summary(session_id)
        
        # Step 3: Wait for completion
        if not wait_for_job_completion(job_id):
            print("❌ Job did not complete in time")
            return
        
        # Step 4: Create test audio (in real usage, record from microphone)
        print("\n📹 Creating test audio...")
        print("   (In real usage, this would be recorded from the user's microphone)")
        audio_data = create_test_audio()
        
        # Step 5: Interact with the summary
        current_position = 15.5  # Example: user was at 15.5 seconds
        answer_file = interact_with_summary(job_id, audio_data, current_position)
        
        print("\n" + "=" * 60)
        print("✅ Test completed successfully!")
        print("\n📖 How it works:")
        print("   1. User is listening to the immersive summary")
        print("   2. User pauses and asks a question (audio)")
        print("   3. System transcribes and answers the question")
        print("   4. System returns audio that answers and transitions back")
        print("   5. Frontend plays the answer, then resumes the summary")
        
    except requests.exceptions.RequestException as e:
        print(f"\n❌ Error: {e}")
        print("\nMake sure the backend server is running:")
        print("   cd backend && python app.py")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")


if __name__ == "__main__":
    main()
