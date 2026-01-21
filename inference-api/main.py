# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
TT Studio Inference API

Main entry point that imports and exposes the api.py FastAPI application.
The api.py file contains the actual implementation and imports from the artifact.
"""

# Import the app from api.py (which handles artifact imports)
from api import app

# Export the app for uvicorn
__all__ = ["app"]
