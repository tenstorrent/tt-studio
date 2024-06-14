# Dummy echo model

This model is for testing, it echos the prompts it is given using HTTP 1.1 chunked encoding responses.

## Docker build

```bash
docker build -t dummy_echo_model:v0.0.1 .
```

## Docker run

Run the model service using gunicorn as configured in the Dockerfile CMD:
```bash
docker run \
    -p 7000:7000 \
    -e JWT_SECRET=test-secret-456 \
    -e CACHE_ROOT=/home/user/cache_root \
    dummy_echo_model:v0.0.1
```

## Test API

```bash
export JWT_TOKEN='Bearer <your token from JWT_SECRET>'
curl "http://localhost:8001/inference/dummy_echo" \
-H "Content-Type: application/json" \
-H "Authorization: ${JWT_TOKEN}" \
-d '{"text":"What is the capital city of Texas?", "max_tokens": "32", "top_k": "1"}'
```

### Tests

This test runs the backend in a loop awaiting prompts, the script starts by adding some prompts which are processes synchronously within a single process instead of the typical multithreaded implementation so that a breakpoint can be introduced anywhere during processing.

```bash
cd models/dummy_echo_model/src
export PYTHONPATH=$PWD
export CACHE_ROOT=test_cache
python test_dummy_backend.py
```

