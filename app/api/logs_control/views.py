# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import os
from django.http import JsonResponse, HttpResponse, Http404
from rest_framework.views import APIView
from shared_config.backend_config import backend_config
from datetime import datetime
import logging

# Setting up logger
from shared_config.logger_config import get_logger
logger = get_logger(__name__)

#  define backend cache root directory for testing POC of log viewer feature
LOGS_DIR = os.path.join(backend_config.backend_cache_root, "python_logs")
os.makedirs(LOGS_DIR, exist_ok=True)  # Ensure directory exists


class ListLogsView(APIView):
    """
    Lists all available log files in the python_logs directory
    """
    def get(self, request, *args, **kwargs):
        logger.info("ListLogsView endpoint hit")
        try:
            # Only include files with `.log` extension
            logs = [filename for filename in os.listdir(LOGS_DIR) if filename.endswith(".log")]
            logger.info(f"Listed logs: {logs}")
            return JsonResponse({'logs': logs}, status=200)
        except Exception as e:
            logger.error(f"Error listing logs: {e}")
            return JsonResponse({'error': str(e)}, status=500)


class GetLogView(APIView):
    """
    Retrieves the content of a specific log file from the python_logs directory
    """
    def get(self, request, filename, *args, **kwargs):
        logger.info(f"GetLogView endpoint hit for log: {filename}")
        file_path = os.path.join(LOGS_DIR, filename)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            try:
                with open(file_path, 'r') as file:
                    content = file.read()
                logger.info(f"Successfully retrieved content for log: {filename}")
                return HttpResponse(content, content_type='text/plain')
            except Exception as e:
                logger.error(f"Error reading log file {filename}: {e}")
                return JsonResponse({'error': str(e)}, status=500)
        else:
            logger.error(f"Log file {filename} not found")
            raise Http404(f"Log file {filename} not found.")
