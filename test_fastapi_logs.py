#!/usr/bin/env python3
"""
Test script to verify the FastAPI logs endpoint
"""

import requests
import json

def test_fastapi_logs_endpoint():
    """Test the FastAPI logs endpoint"""
    try:
        # Test the endpoint
        response = requests.get("http://localhost:8000/logs/fastapi/", timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            print("✅ FastAPI logs endpoint working correctly!")
            print(f"📊 Found: {data.get('found', False)}")
            print(f"📝 Log content length: {len(data.get('fastapi_logs', ''))} characters")
            
            # Show preview of logs
            logs = data.get('fastapi_logs', '')
            if logs and len(logs) > 100:
                print(f"📋 Preview: {logs[:100]}...")
            else:
                print(f"📋 Content: {logs}")
                
        else:
            print(f"❌ Endpoint failed with status {response.status_code}")
            print(f"Response: {response.text}")
            
    except requests.exceptions.Timeout:
        print("❌ Request timed out (30s)")
    except requests.exceptions.ConnectionError:
        print("❌ Could not connect to backend (make sure it's running on localhost:8000)")
    except Exception as e:
        print(f"❌ Error: {str(e)}")

if __name__ == "__main__":
    test_fastapi_logs_endpoint() 