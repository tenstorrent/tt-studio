import { useState, useEffect } from "react";
import { customToast } from "../CustomToaster";

export interface APIInfo {
  model_name: string;
  model_type: string;
  hf_model_id?: string;
  jwt_secret: string;
  jwt_token: string;
  example_payload: any;
  chat_curl_example: string;
  completions_curl_example: string;
  internal_url: string;
  health_url: string;
  endpoints: {
    chat_completions: string;
    completions: string;
    health: string;
    tt_studio_backend: string;
  };
  deploy_info: any;
}

export interface ModelAPIInfoProps {
  modelId: string;
  modelName: string;
  onClose: () => void;
}

export const useModelAPIInfo = (modelId: string, modelName: string) => {
  const [apiInfo, setApiInfo] = useState<APIInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [testLoading, setTestLoading] = useState(false);
  const [requestPayload, setRequestPayload] = useState("");
  const [response, setResponse] = useState("");
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [isDirectModelTest, setIsDirectModelTest] = useState(true);

  useEffect(() => {
    loadAPIInfo();
  }, [modelId]);

  const loadAPIInfo = async () => {
    try {
      setLoading(true);
      console.log("ModelAPIInfo: Loading API info for modelId:", modelId);

      console.log("ModelAPIInfo: Making API request to /models-api/api-info/");
      const response = await fetch("/models-api/api-info/");
      if (!response.ok) {
        console.error(
          `ModelAPIInfo: API request failed with status ${response.status}`
        );
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const apiInfoData = await response.json();
      console.log("ModelAPIInfo: API response data:", apiInfoData);
      console.log("ModelAPIInfo: Looking for model with ID:", modelId);

      const modelApiInfo = apiInfoData[modelId];
      console.log("ModelAPIInfo: Found model API info:", modelApiInfo);

      if (!modelApiInfo) {
        console.error(
          `ModelAPIInfo: No API information found for model ${modelId}`
        );
        throw new Error(`No API information found for model ${modelId}`);
      }

      console.log("ModelAPIInfo: Setting API info and request payload");
      setApiInfo(modelApiInfo);

      const initialPayload = {
        model: modelApiInfo.hf_model_id || getHfModelId(modelApiInfo),
        messages: [
          {
            role: "user",
            content: "What is Tenstorrent?",
          },
        ],
        temperature: 0.7,
        max_tokens: 100,
        stream: false,
      };
      setRequestPayload(JSON.stringify(initialPayload, null, 2));
    } catch (error) {
      console.error("ModelAPIInfo: Error loading API info:", error);
      customToast.error("Failed to load API information");

      console.log("ModelAPIInfo: Using fallback mock data");

      const fallbackJwtToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZWFtX2lkIjoidGVuc3RvcnJlbnQiLCJ0b2tlbl9pZCI6ImRlYnVnLXRlc3QifQ.example-signature";

      const mockApiInfo: APIInfo = {
        model_name: modelName,
        model_type: "ChatModel",
        hf_model_id: "meta-llama/Llama-3.2-1B-Instruct",
        jwt_secret: "test-secret-456",
        jwt_token: fallbackJwtToken,
        example_payload: {
          model: "meta-llama/Llama-3.2-1B-Instruct",
          messages: [
            {
              role: "user",
              content: "What is Tenstorrent?",
            },
          ],
          temperature: 0.7,
          max_tokens: 100,
          stream: false,
        },
        chat_curl_example: `curl -X POST "http://localhost:[PORT]/v1/chat/completions" \\
  -H "Authorization: Bearer ${fallbackJwtToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "meta-llama/Llama-3.2-1B-Instruct",
    "messages": [
      {
        "role": "user",
        "content": "What is Tenstorrent?"
      }
    ],
    "temperature": 0.7,
    "max_tokens": 100,
    "stream": false
  }'`,
        completions_curl_example: `curl -X POST "http://localhost:[PORT]/v1/completions" \\
  -H "Authorization: Bearer ${fallbackJwtToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "meta-llama/Llama-3.2-1B-Instruct",
    "prompt": "What is Tenstorrent?",
    "temperature": 0.9,
    "top_k": 20,
    "top_p": 0.9,
    "max_tokens": 128,
    "stream": false,
    "stop": ["<|eot_id|>"]
  }'`,
        internal_url: "localhost:[PORT]/v1/chat/completions",
        health_url: "localhost:[PORT]/health",
        endpoints: {
          chat_completions: "http://localhost:[PORT]/v1/chat/completions",
          completions: "http://localhost:[PORT]/v1/completions",
          health: "http://localhost:[PORT]/health",
          tt_studio_backend: `${window.location.origin}/models-api/inference/`,
        },
        deploy_info: {
          model_impl: {
            model_name: modelName,
            hf_model_id: "meta-llama/Llama-3.2-1B-Instruct",
          },
        },
      };

      setApiInfo(mockApiInfo);
      setRequestPayload(JSON.stringify(mockApiInfo.example_payload, null, 2));
    } finally {
      setLoading(false);
    }
  };

  const getHfModelId = (apiInfoData?: APIInfo) => {
    const data = apiInfoData || apiInfo;
    if (!data) return "N/A";

    const paths = [
      data.hf_model_id,
      data.deploy_info?.model_impl?.hf_model_id,
      data.deploy_info?.model_impl?.hf_model_repo,
      data.deploy_info?.model_impl?.model_name,
    ];

    for (const path of paths) {
      if (path) return path;
    }

    return "N/A";
  };

  const handleTestAPI = async () => {
    if (!apiInfo) return;

    try {
      setTestLoading(true);
      setResponse("");
      setResponseStatus(null);

      let payload;
      try {
        payload = JSON.parse(requestPayload);
      } catch (error) {
        customToast.error("Invalid JSON payload");
        return;
      }

      let apiUrl;

      if (isDirectModelTest || (payload.model && !payload.deploy_id)) {
        apiUrl = apiInfo.endpoints.chat_completions;
        console.log("Using direct model server endpoint:", apiUrl);

        if (!payload.model) {
          payload.model = getHfModelId();
          console.log("Added missing model field:", payload.model);
        }
      } else {
        apiUrl = apiInfo.endpoints.tt_studio_backend;
        console.log("Using backend API endpoint:", apiUrl);

        if (!payload.deploy_id) {
          payload.deploy_id = modelId;
          console.log("Added missing deploy_id to payload:", modelId);
        }
      }

      console.log("Testing API with payload:", payload);
      console.log("API URL:", apiUrl);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiInfo.jwt_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      setResponseStatus(response.status);

      if (response.ok) {
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body reader available");
        }

        let responseText = "";
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            responseText += chunk;
            setResponse(responseText);
          }
        } finally {
          reader.releaseLock();
        }

        customToast.success("API test completed successfully");
      } else {
        const errorText = await response.text();
        setResponse(`Error ${response.status}: ${errorText}`);
        customToast.error(`API test failed: ${response.status}`);
      }
    } catch (error) {
      console.error("API test error:", error);
      setResponse(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
      customToast.error("API test failed");
    } finally {
      setTestLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    customToast.success(`${label} copied to clipboard!`);
  };

  const resetToExample = () => {
    if (isDirectModelTest) {
      const directModelPayload = {
        model: getHfModelId(),
        messages: [
          {
            role: "user",
            content: "What is Tenstorrent?",
          },
        ],
        temperature: 0.7,
        max_tokens: 100,
        stream: false,
      };
      setRequestPayload(JSON.stringify(directModelPayload, null, 2));
    } else {
      const backendPayload = {
        deploy_id: modelId,
        prompt: "What is Tenstorrent?",
        temperature: 1.0,
        top_k: 20,
        top_p: 0.9,
        max_tokens: 128,
        stream: true,
        stop: ["<|eot_id|>"],
      };
      setRequestPayload(JSON.stringify(backendPayload, null, 2));
    }
  };

  const switchToBackendAPI = () => {
    setIsDirectModelTest(false);
    const backendPayload = {
      deploy_id: modelId,
      prompt: "What is Tenstorrent?",
      temperature: 1.0,
      top_k: 20,
      top_p: 0.9,
      max_tokens: 128,
      stream: true,
      stop: ["<|eot_id|>"],
    };
    setRequestPayload(JSON.stringify(backendPayload, null, 2));
  };

  const switchToDirectModel = () => {
    setIsDirectModelTest(true);
    const directModelPayload = {
      model: getHfModelId(),
      messages: [
        {
          role: "user",
          content: "What is Tenstorrent?",
        },
      ],
      temperature: 0.7,
      max_tokens: 100,
      stream: false,
    };
    setRequestPayload(JSON.stringify(directModelPayload, null, 2));
  };

  return {
    apiInfo,
    loading,
    testLoading,
    requestPayload,
    response,
    responseStatus,
    isDirectModelTest,
    setRequestPayload,
    handleTestAPI,
    copyToClipboard,
    getHfModelId,
    resetToExample,
    switchToBackendAPI,
    switchToDirectModel,
  };
};
