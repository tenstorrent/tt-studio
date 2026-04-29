#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
#
# Runs via nginx:alpine's /docker-entrypoint.d/ hook before nginx starts.
# Substitutes __TT_ACCESS_TOKEN__ in nginx.conf with the real token.

set -e

ME="10-token-setup.sh"
NGINX_CONF="/etc/nginx/conf.d/default.conf"
PLACEHOLDER="__TT_ACCESS_TOKEN__"

if [ -z "${TT_ACCESS_TOKEN:-}" ]; then
    echo "$ME: ERROR: TT_ACCESS_TOKEN is not set. Start TT Studio via run.py."
    exit 1
fi

sed -i "s|${PLACEHOLDER}|${TT_ACCESS_TOKEN}|g" "$NGINX_CONF"
echo "$ME: Access token configured."
