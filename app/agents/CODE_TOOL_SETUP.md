# Code Tool Setup and Usage Guide

## Overview

The code tool allows the AI agent to execute Python code in a secure sandbox environment using E2B's code interpreter. This enables the agent to perform calculations, data analysis, create visualizations, and run other Python code as needed.

## Prerequisites

### 1. E2B API Key

The code tool requires an E2B API key to function. You can get one for free at [https://e2b.dev/docs](https://e2b.dev/docs).

### 2. Environment Variable Setup

Set the `E2B_API_KEY` environment variable:

```bash
# Linux/Mac
export E2B_API_KEY="your_api_key_here"

# Windows
set E2B_API_KEY=your_api_key_here
```

Or add it to your `.env` file:

```
E2B_API_KEY=your_api_key_here
```

## Installation

The code tool is already implemented in the codebase. To enable it:

1. **Set the E2B API Key** (see prerequisites above)
2. **Restart the agent service** - the tool will be automatically detected and enabled

## Testing the Setup

Run the test script to verify everything is working:

```bash
cd app/agent
python test_code_tool.py
```

You should see output like:

```
🧪 Testing Code Interpreter Tool
==================================================
🔧 Initializing code interpreter tool...
🧪 Testing simple code execution...
✅ Code tool test successful!
   Input: print('Hello from code tool!')
   Output: {'results': [...], 'stdout': 'Hello from code tool!\n', 'stderr': '', 'error': None}
🔧 Testing LangChain tool wrapper...
✅ LangChain tool created successfully!
   Tool name: code_interpreter
   Tool description: Execute python code in a Jupyter notebook cell and returns any rich data (eg charts), stdout, stderr, and error.
✅ LangChain tool test successful!
   Input: import math; print(f'Pi: {math.pi}')
   Output: {'results': [...], 'stdout': 'Pi: 3.141592653589793\n', 'stderr': '', 'error': None}

==================================================
🎉 All tests passed! Code tool is ready to use.
```

## How It Works

### 1. Tool Integration

The code tool is automatically integrated into the agent when the `E2B_API_KEY` is set. The agent will:

- Initialize the `CodeInterpreterFunctionTool`
- Convert it to a LangChain tool using `to_langchain_tool()`
- Add it to the available tools list
- Make it available for the LLM to use

### 2. Code Execution Flow

1. **User Request**: User asks the agent to perform a task that requires code execution
2. **Tool Selection**: The LLM decides to use the code interpreter tool
3. **Code Generation**: The LLM generates appropriate Python code
4. **Execution**: The code is executed in an E2B sandbox
5. **Result Return**: The agent returns the execution results (stdout, stderr, errors, rich data)

### 3. Security

- Code runs in an isolated E2B sandbox
- No access to your local filesystem or network
- Timeout protection (30 minutes per execution)
- Automatic cleanup after execution

## Usage Examples

### Basic Calculations

```
User: "Calculate the factorial of 10"
Agent: [Uses code tool to run: import math; print(math.factorial(10))]
```

### Data Analysis

```
User: "Create a bar chart of sales data for Q1, Q2, Q3, Q4"
Agent: [Uses code tool to run matplotlib/seaborn code]
```

### File Processing

```
User: "Parse this CSV data and show me the summary statistics"
Agent: [Uses code tool to run pandas code]
```

## Troubleshooting

### Common Issues

1. **"E2B_API_KEY environment variable is not set"**

   - Solution: Set the environment variable as described in prerequisites

2. **"Code interpreter tool disabled"**

   - Solution: Check that the API key is valid and the environment variable is set correctly

3. **"Request failed" or timeout errors**

   - Solution: Check your internet connection and E2B service status

4. **Code execution errors**
   - The tool will return stderr output to help debug the issue
   - Check that the code is valid Python syntax

### Debug Mode

To see detailed debug information, check the agent logs for:

- Tool initialization messages
- Code execution details
- Error messages

## Advanced Configuration

### Customizing the Tool

You can modify the code tool behavior by editing `app/agent/code_tool.py`:

- **Timeout**: Change the `timeout=1800` parameter (30 minutes default)
- **Sandbox Type**: Modify the E2B sandbox configuration
- **Output Format**: Customize how results are returned

### Adding More Tools

To add additional tools alongside the code interpreter:

1. Create your tool class following the same pattern as `CodeInterpreterFunctionTool`
2. Add it to the tools list in `app/agent/agent.py`
3. Ensure proper error handling and cleanup

## Monitoring and Logs

The agent provides detailed logging for code tool usage:

- Tool initialization status
- Code execution requests
- Execution results and errors
- Performance metrics

Check the agent logs to monitor tool usage and troubleshoot issues.

## Best Practices

1. **Keep Code Simple**: Complex code is more likely to fail or timeout
2. **Handle Errors**: Always include error handling in generated code
3. **Use Libraries**: Leverage popular Python libraries (pandas, matplotlib, etc.)
4. **Clean Output**: Format results clearly for the user
5. **Resource Management**: Be mindful of memory and execution time

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Verify your E2B API key is valid
3. Test with the provided test script
4. Check agent logs for detailed error messages
5. Ensure your code follows Python best practices
