# Models

This directory holds reference model implementations bundled with TT-Studio. **Production model artifacts** (Llama, YOLO, Whisper, Stable Diffusion, etc.) are pulled at deploy time from `tt-inference-server` or container registries — they are not stored here.

## Layout

| Path | Purpose |
| --- | --- |
| [`dummy_echo_model/`](dummy_echo_model/README.md) | Minimal echo model used as a smoke-test fixture for the deployment flow |
| [`licenses/`](licenses/README.md) | Pointers to upstream Tenstorrent model license terms |

For end-to-end model deployment from the UI, see [docs/model-interface.md](../docs/model-interface.md). For vLLM-backed LLMs specifically, see [docs/HowToRun_vLLM_Models.md](../docs/HowToRun_vLLM_Models.md). For custom weights, see [`app/backend/README.md`](../app/backend/README.md#support-for-custom-weights).

---

## JWT auth helper

Models authenticate inbound requests via the `Authorization` header. Generate a token using `jwt_util.py`:

```bash
export JWT_ENCODED=$(/mnt/scripts/jwt_util.py --secret ${JWT_SECRET} encode '{"team_id": "tenstorrent", "token_id":"debug-test"}')
export JWT_TOKEN="Bearer ${JWT_ENCODED}"
```

Requires `pyjwt==2.7.0`:

```bash
pip install pyjwt==2.7.0
```

Equivalent in Python:

```python
import json, jwt
jwt_secret = "test-secret-456"
payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
print(jwt.encode(payload, jwt_secret, algorithm="HS256"))
```
