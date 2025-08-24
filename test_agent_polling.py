#!/usr/bin/env python3
"""
Test script to verify agent polling functionality
"""

import asyncio
import requests
import time
import json

def test_agent_status():
    """Test the agent status endpoint"""
    try:
        response = requests.get("http://localhost:8080/", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print("✓ Agent status endpoint working")
            print(f"Status: {data.get('status', 'unknown')}")
            print(f"Message: {data.get('message', 'N/A')}")
            return data
        else:
            print(f"✗ Agent status endpoint returned {response.status_code}")
            return None
    except Exception as e:
        print(f"✗ Failed to connect to agent: {e}")
        return None

def test_agent_requests():
    """Test the agent requests endpoint"""
    try:
        payload = {
            "message": "Hello, this is a test message",
            "thread_id": "test-thread-123"
        }
        response = requests.post("http://localhost:8080/poll_requests", 
                               json=payload, timeout=10)
        if response.status_code == 200:
            print("✓ Agent requests endpoint working")
            return True
        else:
            print(f"✗ Agent requests endpoint returned {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ Failed to test agent requests: {e}")
        return False

def main():
    """Main test function"""
    print("=== Testing Agent Polling Functionality ===")
    
    # Test 1: Check if agent is running
    print("\n1. Testing agent status...")
    status_data = test_agent_status()
    
    if status_data:
        status = status_data.get('status', 'unknown')
        if status == 'initializing':
            print("✓ Agent is running and waiting for LLM (expected behavior)")
        elif status == 'ready':
            print("✓ Agent is ready with LLM available")
        else:
            print(f"⚠ Agent status: {status}")
    
    # Test 2: Test request handling
    print("\n2. Testing request handling...")
    test_agent_requests()
    
    print("\n=== Test Complete ===")
    print("If the agent shows 'initializing' status, it's working correctly")
    print("and will continue polling for LLM availability every 3 minutes.")

if __name__ == "__main__":
    main() 