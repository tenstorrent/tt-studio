# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from rest_framework.views import APIView
from rest_framework.response import Response

class UpStatusView(APIView):
    def get(self, request, *args, **kwargs):
        return Response(status=200)