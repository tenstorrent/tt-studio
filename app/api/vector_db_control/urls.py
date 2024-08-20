from django.urls import path
from rest_framework import routers

from .views import VectorCollectionsAPIView

app_name = "rag"

router = routers.DefaultRouter(trailing_slash=False)
router.register("", VectorCollectionsAPIView, basename="collections")

urlpatterns = router.urls
