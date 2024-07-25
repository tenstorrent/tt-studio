# docker_control/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("get_containers/", views.ContainersView.as_view()),
    path("deploy/", views.DeployView.as_view()),
    path("stop/", views.StopView.as_view()),
    path("status/", views.StatusView.as_view()),
    path("redeploy/", views.RedeployView.as_view()),
    path('reset-board/', views.ResetBoardView.as_view(), name='reset-board'),
]
