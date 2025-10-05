#!/usr/bin/env python3
"""
Test script for the new general Q&A endpoint
"""

import httpx
import asyncio

async def test_general_qa():
    """Test the /v1/ask endpoint"""
    url = "http://localhost:8000/v1/ask"
    
    # Test data
    payload = {
        "question": "Please create a concise summary of this section for a visually impaired user.",
        "context": "This is a test section about Harvard University's history. It covers the founding in 1636, early development, and key milestones in the university's growth.",
        "page_title": "Harvard University - Wikipedia",
        "page_url": "https://en.wikipedia.org/wiki/Harvard_University"
    }
    
    print("🧪 Testing General Q&A Endpoint...")
    print(f"📤 Sending request to: {url}")
    print(f"📋 Payload: {payload}")
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload)
            
        print(f"📊 Status Code: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Success!")
            print(f"📝 Answer: {result.get('answer', 'No answer')}")
            print(f"🎯 Confidence: {result.get('confidence', 'No confidence')}")
            print(f"🔊 TTS Text: {result.get('tts_text', 'No TTS text')}")
        else:
            print(f"❌ Error: {response.status_code}")
            print(f"📄 Response: {response.text}")
            
    except Exception as e:
        print(f"❌ Exception: {e}")

if __name__ == "__main__":
    asyncio.run(test_general_qa())
