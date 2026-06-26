# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from django.contrib import admin

from .models import Workflow, WorkflowRun

admin.site.register(Workflow)
admin.site.register(WorkflowRun)
