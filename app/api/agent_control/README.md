# AI Agent 

TT-Studio now supports a search agent that can be integrated with your deployed LLM model. 
To use the search agent before starting TT-Studio or deploying a model , follow these steps to enable the search agent:

1. Pull the search agent container from GitHub Container Registry (GCHR):

    docker pull ghcr.io/tenstorrent/tt-studio/agent_image:v1.1

docker pull ghcr.io/tenstorrent/tt-studio/agent_image:v1.1
```

2. Create and add your [Tavily API key](https://tavily.com/) to the environment file located at `tt-studio/app/env`.

How the agent works is depicted in the visual below.

![Agent Workflow](./Agent_flow.png)
