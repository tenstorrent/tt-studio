# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import os
from urllib.parse import unquote
from django.http import JsonResponse, HttpResponse, Http404
from rest_framework.views import APIView
from shared_config.logger_config import get_logger

# Setting up logger
logger = get_logger(__name__)

# Use environment variable for the base storage volume
LOGS_ROOT = os.getenv("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/path/to/fallback")


class ListLogsView(APIView):
    """
    Lists all available directories and log files within the base logs directory
    """

    def get(self, request, *args, **kwargs):
        logger.info("ListLogsView endpoint hit")
        try:
            logs_tree = self.build_logs_tree(LOGS_ROOT)
            logger.info(f"Log tree built: {logs_tree}")
            return JsonResponse({"logs": logs_tree}, status=200)
        except Exception as e:
            logger.error(f"Error listing logs: {e}")
            return JsonResponse({"error": str(e)}, status=500)

    def build_logs_tree(self, directory):
        """
        Recursively build a tree of directories and files.
        """
        tree = []
        for entry in os.listdir(directory):
            path = os.path.join(directory, entry)
            if os.path.isdir(path):
                tree.append(
                    {
                        "name": entry,
                        "type": "directory",
                        "children": self.build_logs_tree(path),
                    }
                )
            elif entry.endswith(".log"):
                tree.append({"name": entry, "type": "file"})
        return tree


class GetLogView(APIView):
    """
    Retrieves the content of a specific log file from the logs directory.
    """

    def get(self, request, filename, *args, **kwargs):
        decoded_filename = unquote(filename)

        file_path = os.path.normpath(os.path.join(LOGS_ROOT, decoded_filename))

        # Security check: Ensure the resolved path is within LOGS_ROOT
        if not file_path.startswith(os.path.abspath(LOGS_ROOT)):
            logger.error(f"Invalid log file path: {file_path}")
            raise Http404("Invalid file path.")

        logger.info(f"Looking for log file at: {file_path}")

        if os.path.exists(file_path) and os.path.isfile(file_path):
            try:
                with open(file_path, "r") as file:
                    content = file.read()
                logger.info(
                    f"Successfully retrieved content for log: {decoded_filename}"
                )
                return HttpResponse(content, content_type="text/plain")
            except Exception as e:
                logger.error(f"Error reading log file {decoded_filename}: {e}")
                return JsonResponse({"error": str(e)}, status=500)
        else:
            logger.error(f"Log file {decoded_filename} not found at {file_path}")
            raise Http404(f"Log file {decoded_filename} not found.")


class FastAPILogsView(APIView):
    """
    Retrieves FastAPI logs specifically for bug reporting and system monitoring.
    """

    def get(self, request, *args, **kwargs):
        logger.info("FastAPILogsView endpoint hit")
        
        # Check if fastapi.log exists in multiple possible locations using relative paths
        possible_fastapi_logs = [
            "fastapi.log",  # Current directory
            os.path.join(os.getcwd(), "fastapi.log"),  # Current working directory
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "fastapi.log"),  # Go up from backend/logs_control/views.py
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "fastapi.log"),  # Relative to backend directory
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "..", "fastapi.log"),  # Two levels up from backend
            os.path.join(LOGS_ROOT, "fastapi.log"),  # Try in logs directory
            "/app/fastapi.log",  # Container path as fallback
        ]
        
        fastapi_log_found = False
        log_content = ""
        
        for fastapi_log_path in possible_fastapi_logs:
            if os.path.exists(fastapi_log_path):
                try:
                    with open(fastapi_log_path, 'r') as f:
                        lines = f.readlines()
                        # Get last 20 lines and limit size
                        log_content = ''.join(lines[-20:])
                        if len(log_content) > 2000:
                            log_content = log_content[-2000:] + "\n\n... (truncated)"
                    fastapi_log_found = True
                    logger.info(f"Successfully read FastAPI logs from: {fastapi_log_path}")
                    break
                except Exception as read_error:
                    logger.error(f"Error reading {fastapi_log_path}: {str(read_error)}")
                    continue
        
        if not fastapi_log_found:
            log_content = "fastapi.log not accessible from container (logs available from Docker containers above)"
            logger.warning("FastAPI log file not found in any expected location")
        
        return JsonResponse({
            "fastapi_logs": log_content,
            "found": fastapi_log_found,
            "timestamp": os.path.getmtime(fastapi_log_path) if fastapi_log_found else None
        }, status=200)
