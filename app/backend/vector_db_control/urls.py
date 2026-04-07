# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.urls import path
from rest_framework import routers
from .views import VectorCollectionsAPIView, rag_admin_authenticate, rag_admin_list_all_collections, rag_admin_delete_collection, rag_preinstall_status


app_name = "rag"

router = routers.DefaultRouter(trailing_slash=False)
router.register("", VectorCollectionsAPIView, basename="collections")

# Get the router URLs
router_urls = router.urls

# Add admin endpoints
urlpatterns = [
    path('preinstall-status', rag_preinstall_status, name='preinstall-status'),
    path('admin/authenticate', rag_admin_authenticate, name='admin-authenticate'),
    path('admin/collections', rag_admin_list_all_collections, name='admin-list-collections'),
    path('admin/delete-collection', rag_admin_delete_collection, name='admin-delete-collection'),
] + router_urls