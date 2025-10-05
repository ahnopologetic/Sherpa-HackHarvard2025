"""
Test script for the immersive summary caching feature

This script demonstrates how the caching system works:
1. First request generates and caches the summary
2. Second request reuses the cached version
3. Shows cache statistics
"""

import requests
import time
import json


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


def generate_immersive_summary(session_id, request_num):
    """Generate an immersive summary"""
    print(f"\n🎧 Generating immersive summary (Request #{request_num})...")
    start_time = time.time()
    
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
    
    # Wait for completion
    print("⏳ Waiting for job to complete...")
    while True:
        try:
            response = requests.get(f"{BASE_URL}/v1/immersive-summary/{job_id}")
            if response.status_code == 200:
                end_time = time.time()
                duration = end_time - start_time
                print(f"✅ Immersive summary ready! (took {duration:.2f} seconds)")
                return job_id, duration
        except requests.exceptions.RequestException:
            pass
        
        time.sleep(2)


def get_cache_stats():
    """Get cache statistics"""
    print("\n📊 Getting cache statistics...")
    response = requests.get(f"{BASE_URL}/v1/cache/stats")
    response.raise_for_status()
    stats = response.json()
    
    print(f"📦 Cache entries: {stats['total_entries']}")
    print(f"💾 Total size: {stats['total_size_mb']} MB")
    
    return stats


def main():
    """Main test flow"""
    print("🚀 Testing Immersive Summary Caching Feature\n")
    print("=" * 60)
    
    try:
        # Step 1: Create session
        session_id = create_test_session()
        
        # Step 2: Check initial cache stats
        print("\n📊 Initial cache stats:")
        get_cache_stats()
        
        # Step 3: First request (should generate new summary)
        print("\n" + "=" * 40)
        print("🔄 FIRST REQUEST (should generate new summary)")
        print("=" * 40)
        job_id_1, duration_1 = generate_immersive_summary(session_id, 1)
        
        # Step 4: Check cache stats after first request
        print("\n📊 Cache stats after first request:")
        get_cache_stats()
        
        # Step 5: Second request (should use cache)
        print("\n" + "=" * 40)
        print("🔄 SECOND REQUEST (should use cached version)")
        print("=" * 40)
        job_id_2, duration_2 = generate_immersive_summary(session_id, 2)
        
        # Step 6: Compare performance
        print("\n" + "=" * 40)
        print("📈 PERFORMANCE COMPARISON")
        print("=" * 40)
        print(f"First request:  {duration_1:.2f} seconds")
        print(f"Second request: {duration_2:.2f} seconds")
        print(f"Speedup:        {duration_1/duration_2:.1f}x faster")
        
        # Step 7: Final cache stats
        print("\n📊 Final cache stats:")
        get_cache_stats()
        
        print("\n" + "=" * 60)
        print("✅ Cache test completed successfully!")
        print("\n📖 How it works:")
        print("   1. First request generates and caches the summary")
        print("   2. Second request reuses the cached audio file")
        print("   3. Cache is keyed by URL + title + context hash")
        print("   4. Old cache entries are cleaned up automatically")
        
    except requests.exceptions.RequestException as e:
        print(f"\n❌ Error: {e}")
        print("\nMake sure the backend server is running:")
        print("   cd backend && python app.py")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")


if __name__ == "__main__":
    main()
