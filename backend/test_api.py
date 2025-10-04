"""
Test script for Sherpa API endpoints
"""
import requests
import json

BASE_URL = "http://localhost:8000"


def test_create_session():
    """Test creating a new session"""
    print("Testing: POST /v1/sessions")
    
    payload = {
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
    
    response = requests.post(f"{BASE_URL}/v1/sessions", json=payload)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    if response.status_code == 200:
        return response.json()["session_id"]
    return None


def test_interpret_command(session_id: str):
    """Test interpreting a text command"""
    print(f"\nTesting: POST /v1/sessions/{session_id}/interpret (text mode)")
    
    params = {"mode": "text"}
    data = {
        "text": "go to comments",
        "hint": "navigate"
    }
    
    response = requests.post(
        f"{BASE_URL}/v1/sessions/{session_id}/interpret",
        params=params,
        data=data
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")


def test_interpret_voice_command(session_id: str):
    """Test interpreting a voice command (mock)"""
    print(f"\nTesting: POST /v1/sessions/{session_id}/interpret (voice mode)")
    
    params = {"mode": "voice"}
    
    # Create a mock audio file (in real scenario, this would be actual audio)
    files = {
        "audio": ("test_audio.wav", b"mock audio data", "audio/wav")
    }
    data = {
        "hint": "navigate"
    }
    
    response = requests.post(
        f"{BASE_URL}/v1/sessions/{session_id}/interpret",
        params=params,
        files=files,
        data=data
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")


def test_health():
    """Test health check endpoint"""
    print("\nTesting: GET /health")
    response = requests.get(f"{BASE_URL}/health")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")


if __name__ == "__main__":
    print("=" * 60)
    print("Sherpa API Test Suite")
    print("=" * 60)
    
    # Test health check
    test_health()
    
    # Test session creation
    session_id = test_create_session()
    
    if session_id:
        # Test text command interpretation
        test_interpret_command(session_id)
        
        # Test voice command interpretation
        test_interpret_voice_command(session_id)
    else:
        print("\nFailed to create session. Skipping interpretation tests.")
    
    print("\n" + "=" * 60)
    print("Tests completed!")
    print("=" * 60)

