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
