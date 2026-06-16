# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from django.urls import path

from . import views

urlpatterns = [
    path("catalog/", views.TrainingCatalogView.as_view(), name="training-catalog"),
    path("jobs/", views.TrainingJobsListView.as_view(), name="training-jobs-list"),
    path("jobs/<str:job_id>/", views.TrainingJobDetailView.as_view(), name="training-job-detail"),
    path("jobs/<str:job_id>/metrics/", views.TrainingJobMetricsView.as_view(), name="training-job-metrics"),
    path("jobs/<str:job_id>/logs/", views.TrainingJobLogsView.as_view(), name="training-job-logs"),
    path("jobs/<str:job_id>/checkpoints/", views.TrainingJobCheckpointsView.as_view(), name="training-job-checkpoints"),
    path("jobs/<str:job_id>/cancel/", views.TrainingJobCancelView.as_view(), name="training-job-cancel"),
    path("jobs/<str:job_id>/checkpoints/<str:ckpt_id>/", views.TrainingCheckpointDownloadView.as_view(), name="training-checkpoint-download"),
]
