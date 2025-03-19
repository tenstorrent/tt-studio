# AI Agent 

TT-Studio now supports a search agent that can be integrated with your deployed LLM model. 
To use the search agent before starting TT-Studio or deploying a model , follow the single step below to enable the search agent:

1. Create and add your [Tavily API key](https://tavily.com/) to the environment file located at `tt-studio/app/env`.

Note the `tt-studio/startup.sh` script will pull the needed docker image required for the agent to run. If this fails, the image can be pulled directly with the following command:

```bash
docker pull ghcr.io/tenstorrent/tt-studio/agent_image:v1.1 
```

How the agent works is depicted in the visual below.

![Agent Workflow](./Agent_flow.png)
