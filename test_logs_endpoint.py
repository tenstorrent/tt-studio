#!/usr/bin/env python3
"""
Test script to verify the Docker service logs endpoint
"""

import requests
import json

def test_logs_endpoint():
    """Test the Docker service logs endpoint"""
    try:
        # Test the endpoint
        response = requests.get("http://localhost:8000/docker/service-logs/", timeout=60)
        
        if response.status_code == 200:
            data = response.json()
            print("✅ Endpoint working correctly!")
            print(f"📊 Total log size: {data.get('_summary', 'Unknown')}")
            
            # Print summary of each service
            for service, logs in data.items():
                if not service.startswith('_'):
                    log_length = len(str(logs))
                    print(f"📝 {service}: {log_length} characters")
                    if log_length > 100:
                        print(f"   Preview: {str(logs)[:100]}...")
                    else:
                        print(f"   Content: {logs}")
        else:
            print(f"❌ Endpoint failed with status {response.status_code}")
            print(f"Response: {response.text}")
            
    except requests.exceptions.Timeout:
        print("❌ Request timed out (60s)")
    except requests.exceptions.ConnectionError:
        print("❌ Could not connect to backend (make sure it's running on localhost:8000)")
    except Exception as e:
        print(f"❌ Error: {str(e)}")

if __name__ == "__main__":
    test_logs_endpoint() 