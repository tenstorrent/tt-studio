# docker_control/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("start/", views.start_container, name="start-container"),
    path("stop/<str:container_id>/", views.stop_container_view, name="stop-container"),
    path("get_containers/", views.ContainersView.as_view()),
    path("deploy/", views.DeployView.as_view()),
    path("stop/", views.StopView.as_view()),
    path("status/", views.StatusView.as_view()),
    path("redeploy/", views.RedeployView.as_view()),
]
