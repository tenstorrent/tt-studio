from rest_framework.views import APIView
from rest_framework.response import Response

class UpStatusView(APIView):
    def get(self, request, *args, **kwargs):
        return Response(status=200)