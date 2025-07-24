# Enhanced TT-Studio Agent

The enhanced TT-Studio agent provides automatic discovery and health monitoring of local LLM containers, with intelligent fallback strategies and seamless switching between different LLM endpoints.

## Features

### 🔍 **Dynamic LLM Discovery**

- Automatically discovers local LLM containers via backend API
- Filters only healthy and chat-compatible models
- Intelligent model selection based on priority criteria
- Caching for performance optimization

### 🏥 **Health Monitoring**

- Continuous health checks for local LLM containers
- Automatic failover to healthy alternatives
- Configurable failure thresholds and intervals
- Real-time status reporting

### 🔄 **Smart Fallback Strategy**

- Priority-based LLM selection:
  1. Cloud LLM (if configured)
  2. Environment-specified local container
  3. Auto-discovered local containers
  4. Local host LLM
- Seamless switching without service interruption

### ⚙️ **Configuration Management**

- Centralized configuration via environment variables
- Configuration validation and error reporting
- Debug mode for troubleshooting

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Agent API     │    │  LLM Discovery   │    │ Health Monitor  │
│                 │    │     Service      │    │                 │
│ • /poll_requests│◄──►│ • Auto-discovery │◄──►│ • Health checks │
│ • /status       │    │ • Model selection│    │ • Auto-failover │
│ • /refresh      │    │ • Caching        │    │ • Status report │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  CustomLLM      │    │ Backend API      │    │ Local LLM       │
│                 │    │                  │    │ Containers      │
│ • Cloud mode    │    │ • /models/deployed│   │ • Health checks │
│ • Local mode    │    │ • Container info │    │ • Chat endpoints│
│ • Discovered    │    │ • Network info   │    │ • Auto-recovery │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Configuration

### Environment Variables

#### Discovery Configuration

```bash
# Enable/disable auto-discovery (default: true)
AGENT_AUTO_DISCOVERY=true

# Discovery cache TTL in seconds (default: 30)
AGENT_DISCOVERY_CACHE_TTL=30

# Discovery interval in seconds (default: 60)
AGENT_DISCOVERY_INTERVAL=60
```

#### Health Monitoring Configuration

```bash
# Enable/disable health monitoring (default: true)
AGENT_HEALTH_CHECK_ENABLED=true

# Health check interval in seconds (default: 30)
AGENT_HEALTH_CHECK_INTERVAL=30

# Health check timeout in seconds (default: 5)
AGENT_HEALTH_CHECK_TIMEOUT=5

# Maximum failures before failover (default: 3)
AGENT_MAX_FAILURES=3
```

#### Fallback Configuration

```bash
# Enable fallback to local host LLM (default: true)
AGENT_FALLBACK_TO_LOCAL=true

# Enable fallback to cloud LLM (default: false)
AGENT_FALLBACK_TO_CLOUD=false
```

#### LLM Priority Configuration

```bash
# Comma-separated list of priority models (larger models first)
AGENT_PRIORITY_MODELS=llama-3.1-70b,llama-3.1-8b,mistral-7b,falcon-7b
```

#### Network Configuration

```bash
# Backend API URL (default: http://tt-studio-backend-api:8000)
AGENT_BACKEND_URL=http://tt-studio-backend-api:8000

# Local host LLM configuration
LOCAL_LLM_HOST=localhost
LOCAL_LLM_PORT=7000
LOCAL_MODEL_NAME=llama-3.1-70b
```

#### Authentication Configuration

```bash
# JWT secret for local authentication
JWT_SECRET=your-jwt-secret

# Cloud authentication token
CLOUD_CHAT_UI_AUTH_TOKEN=your-cloud-token
```

#### Cloud Configuration

```bash
# Enable cloud LLM mode
USE_CLOUD_LLM=true

# Cloud endpoint URL
CLOUD_CHAT_UI_URL=https://api.openai.com/v1/chat/completions

# Cloud model name
CLOUD_MODEL_NAME=meta-llama/Llama-3.3-70B-Instruct
```

#### Local Container Configuration

```bash
# Specific container name (overrides auto-discovery)
LLM_CONTAINER_NAME=my-llm-container
```

#### Logging Configuration

```bash
# Log level (DEBUG, INFO, WARNING, ERROR)
AGENT_LOG_LEVEL=INFO

# Enable debug mode
AGENT_DEBUG_MODE=false
```

## API Endpoints

### Health Check

```http
GET /
```

Returns basic health status and LLM information.

### Detailed Status

```http
GET /status
```

Returns detailed status including:

- Agent status
- Current LLM configuration
- Health monitoring status
- Discovery service summary
- Environment configuration

### Manual Refresh

```http
POST /refresh
```

Manually triggers LLM discovery and refresh.

### Chat Requests

```http
POST /poll_requests
Content-Type: application/json

{
  "message": "Hello, how are you?",
  "thread_id": "12345"
}
```

## Usage Examples

### Basic Setup (Auto-Discovery)

```bash
# Start with auto-discovery enabled
AGENT_AUTO_DISCOVERY=true
AGENT_HEALTH_CHECK_ENABLED=true
AGENT_FALLBACK_TO_LOCAL=true

# The agent will automatically:
# 1. Discover local LLM containers
# 2. Select the best available model
# 3. Start health monitoring
# 4. Provide fallback if needed
```

### Cloud-First Setup

```bash
# Prioritize cloud LLM with local fallback
USE_CLOUD_LLM=true
CLOUD_CHAT_UI_AUTH_TOKEN=your-token
AGENT_FALLBACK_TO_LOCAL=true
AGENT_AUTO_DISCOVERY=true
```

### Local-Only Setup

```bash
# Use only local containers
USE_CLOUD_LLM=false
AGENT_AUTO_DISCOVERY=true
AGENT_FALLBACK_TO_LOCAL=true
```

### Specific Container Setup

```bash
# Use specific container (disables auto-discovery)
LLM_CONTAINER_NAME=my-llm-container
AGENT_AUTO_DISCOVERY=false
```

## Monitoring and Debugging

### Status Monitoring

```bash
# Check agent status
curl http://localhost:8080/status

# Check basic health
curl http://localhost:8080/
```

### Log Analysis

The agent provides detailed logging for:

- LLM discovery process
- Health check results
- Failover events
- Configuration issues

### Debug Mode

Enable debug mode for detailed logging:

```bash
AGENT_DEBUG_MODE=true
AGENT_LOG_LEVEL=DEBUG
```

## Troubleshooting

### Common Issues

#### No LLM Available

- Check if any LLM containers are deployed
- Verify backend API connectivity
- Check authentication configuration

#### Health Check Failures

- Verify LLM container health endpoints
- Check network connectivity
- Review health check timeout settings

#### Discovery Failures

- Verify backend API is accessible
- Check container network configuration
- Review discovery cache settings

### Configuration Validation

The agent validates configuration on startup and reports issues:

```bash
# Example validation output
=== CONFIGURATION ISSUES ===
WARNING: No authentication configured
WARNING: Health check interval too low
============================
```

## Performance Considerations

### Caching

- Discovery results are cached for 30 seconds by default
- Health check results are not cached for real-time monitoring
- Cache TTL can be adjusted via `AGENT_DISCOVERY_CACHE_TTL`

### Health Monitoring Overhead

- Health checks run every 30 seconds by default
- Minimal impact on performance
- Can be disabled for high-performance requirements

### Network Optimization

- Uses internal Docker network for container communication
- Optimized for local container discovery
- Supports external cloud endpoints

## Security

### Authentication

- JWT-based authentication for local containers
- Bearer token authentication for cloud endpoints
- Secure token handling and validation

### Network Security

- Internal Docker network communication
- Health check endpoints for security validation
- Configurable timeouts and retry limits

## Future Enhancements

### Planned Features

- WebSocket-based real-time updates
- Advanced model selection algorithms
- Metrics collection and monitoring
- Load balancing across multiple LLMs
- A/B testing capabilities

### Extensibility

- Plugin architecture for custom discovery methods
- Custom health check implementations
- Configurable model selection strategies
- Integration with external monitoring systems
