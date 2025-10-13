

#!/usr/bin/env python3
"""
Test script to verify the code tool functionality
"""

import os
import sys
from .code_tool import CodeInterpreterFunctionTool

def test_code_tool():
    """Test the code interpreter tool"""
    
    # Check if E2B_API_KEY is set
    if "E2B_API_KEY" not in os.environ:
        print("❌ E2B_API_KEY environment variable is not set")
        print("   To enable code execution, set the E2B_API_KEY environment variable")
        print("   Get your API key from: https://e2b.dev/docs")
        return False
    
    try:
        # Initialize the code tool
        print("🔧 Initializing code interpreter tool...")
        code_tool = CodeInterpreterFunctionTool()
        
        # Test simple code execution
        print("🧪 Testing simple code execution...")
        test_code = "print('Hello from code tool!')"
        result = code_tool.langchain_call(test_code)
        
        print(f"✅ Code tool test successful!")
        print(f"   Input: {test_code}")
        print(f"   Output: {result}")
        
        # Clean up
        code_tool.close()
        return True
        
    except Exception as e:
        print(f"❌ Code tool test failed: {e}")
        return False

def test_langchain_tool():
    """Test the LangChain tool wrapper"""
    
    if "E2B_API_KEY" not in os.environ:
        print("❌ E2B_API_KEY not set, skipping LangChain tool test")
        return False
    
    try:
        print("🔧 Testing LangChain tool wrapper...")
        code_tool = CodeInterpreterFunctionTool()
        langchain_tool = code_tool.to_langchain_tool()
        
        print(f"✅ LangChain tool created successfully!")
        print(f"   Tool name: {langchain_tool.name}")
        print(f"   Tool description: {langchain_tool.description}")
        print(f"   Tool args schema: {langchain_tool.args_schema}")
        
        # Test the tool
        test_code = "import math; print(f'Pi: {math.pi}')"
        result = langchain_tool.invoke({"code": test_code})
        
        print(f"✅ LangChain tool test successful!")
        print(f"   Input: {test_code}")
        print(f"   Output: {result}")
        
        code_tool.close()
        return True
        
    except Exception as e:
        print(f"❌ LangChain tool test failed: {e}")
        return False

if __name__ == "__main__":
    print("🧪 Testing Code Interpreter Tool")
    print("=" * 50)
    
    success1 = test_code_tool()
    success2 = test_langchain_tool()
    
    print("\n" + "=" * 50)
    if success1 and success2:
        print("🎉 All tests passed! Code tool is ready to use.")
    else:
        print("⚠️  Some tests failed. Check the output above for details.")
        sys.exit(1) 