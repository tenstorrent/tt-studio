# Agent Service

This is the agent service for TT-Studio, which provides an intelligent assistant that can interact with various LLM (Large Language Model) endpoints.

## Features

- **Multi-LLM Support**: Can work with cloud LLMs, local containers, and discovered models
- **Auto-Discovery**: Automatically discovers available LLM containers
- **Health Monitoring**: Monitors LLM health and switches to healthy alternatives
- **LLM Polling**: Waits for LLM availability instead of crashing
- **Dynamic Configuration**: Supports runtime configuration changes
- **Code Execution**: Optional code interpreter tool integration

## LLM Polling Feature

The agent now includes a robust LLM polling mechanism that prevents the service from crashing when no LLM is available. Instead, it will:

1. **Wait for LLM**: Continuously poll for LLM availability every 3 minutes (configurable)
2. **Graceful Degradation**: Return appropriate status messages while waiting
3. **Auto-Recovery**: Automatically initialize once an LLM becomes available
4. **Configurable**: Polling behavior can be customized via environment variables

### Configuration

The following environment variables control the LLM polling behavior:

```bash
# Enable/disable LLM polling (default: true)
AGENT_LLM_POLLING_ENABLED=true

# Polling interval in seconds (default: 180 = 3 minutes)
AGENT_LLM_POLLING_INTERVAL=180

# Maximum polling attempts (default: 0 = infinite)
AGENT_LLM_POLLING_MAX_ATTEMPTS=0
```

### Status Endpoints

The agent provides status endpoints that reflect the current state:

- **`GET /`**: Health check with initialization status
- **`GET /status`**: Detailed status including available models
- **`POST /poll_requests`**: Request handling (returns waiting message if not ready)

### Example Status Responses

**When initializing (waiting for LLM):**

```json
{
  "message": "Agent server is running but waiting for LLM",
  "status": "initializing",
  "llm_mode": "none",
  "llm_info": "No LLM available yet",
  "next_poll": "Will retry every 3 minutes"
}
```

**When ready:**

```json
{
  "message": "Agent server is running",
  "status": "ready",
  "llm_mode": "local",
  "llm_info": "Discovered: Llama-3.1-70B-Instruct"
}
```

## Quick Start

1. **Start the agent service:**

   ```bash
   cd app/agent
   python agent.py
   ```

2. **Check status:**

   ```bash
   curl http://localhost:8080/
   ```

3. **Test with requests:**
   ```bash
   curl -X POST http://localhost:8080/poll_requests \
     -H "Content-Type: application/json" \
     -d '{"message": "Hello", "thread_id": "test-123"}'
   ```

## Environment Variables

### Core Configuration

- `JWT_SECRET`: Secret for JWT authentication
- `TAVILY_API_KEY`: API key for search functionality
- `E2B_API_KEY`: API key for code execution (optional)

### LLM Configuration

- `USE_CLOUD_LLM`: Enable cloud LLM (true/false)
- `CLOUD_CHAT_UI_URL`: Cloud LLM endpoint URL
- `CLOUD_CHAT_UI_AUTH_TOKEN`: Cloud LLM authentication token
- `LLM_CONTAINER_NAME`: Specific local container to use
- `AGENT_BACKEND_URL`: Backend API URL for model discovery

### Discovery Configuration

- `AGENT_AUTO_DISCOVERY`: Enable auto-discovery (true/false)
- `AGENT_DISCOVERY_CACHE_TTL`: Discovery cache TTL in seconds
- `AGENT_DISCOVERY_INTERVAL`: Discovery interval in seconds

### Health Monitoring

- `AGENT_HEALTH_CHECK_ENABLED`: Enable health monitoring (true/false)
- `AGENT_HEALTH_CHECK_INTERVAL`: Health check interval in seconds
- `AGENT_HEALTH_CHECK_TIMEOUT`: Health check timeout in seconds
- `AGENT_MAX_FAILURES`: Maximum failures before switching LLM

### Polling Configuration

- `AGENT_LLM_POLLING_ENABLED`: Enable LLM polling (true/false)
- `AGENT_LLM_POLLING_INTERVAL`: Polling interval in seconds
- `AGENT_LLM_POLLING_MAX_ATTEMPTS`: Maximum polling attempts

## API Endpoints

### Health and Status

- `GET /`: Health check with initialization status
- `GET /status`: Detailed status including available models
- `GET /test_llm`: Test current LLM connection

### Request Handling

- `POST /poll_requests`: Process chat requests
- `POST /refresh`: Refresh LLM selection
- `POST /select_model`: Select specific model by deploy ID
- `POST /refresh_config`: Refresh configuration

## Troubleshooting

### Agent Not Starting

1. Check if required environment variables are set
2. Verify backend service is running
3. Check logs for specific error messages

### No LLM Available

1. The agent will now wait and poll instead of crashing
2. Check the status endpoint to see current state
3. Ensure LLM containers are running or cloud LLM is configured

### LLM Connection Issues

1. Use `/test_llm` endpoint to test current LLM
2. Check health monitoring status
3. Use `/refresh` endpoint to try different LLMs

## Development

### Running in Development Mode

```bash
cd app/agent
python agent.py
```

### Testing

```bash
# Test the polling functionality
python test_agent_polling.py
```

### Logs

The agent provides detailed logging for debugging:

- LLM discovery attempts
- Health monitoring results
- Polling status updates
- Configuration changes
