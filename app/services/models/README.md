# Models


### JWT_TOKEN Authorization

To authenticate requests use the header `Authorization`. The JWT token can be computed using the script `jwt_util.py`. This is an example:
```bash
export JWT_ENCODED=$(/mnt/scripts/jwt_util.py --secret ${JWT_SECRET} encode '{"team_id": "tenstorrent", "token_id":"debug-test"}')
export JWT_TOKEN="Bearer ${JWT_ENCODED}"
```

Make sure you have pyjwt 2.7.0 installed:
```bash
pip install pyjwt==2.7.0
```

```python
import json
import jwt
jwt_secret = "test-secret-456"
json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
encoded_jwt = jwt.encode(json_payload, jwt_secret, algorithm="HS256")
print(encoded_jwt)
```
