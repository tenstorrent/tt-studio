# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import logging
import os
from datetime import datetime

from shared_config.backend_config import backend_config

datetime_prefix = datetime.now().strftime("%Y-%m-%d-%H_%M_%S")


def get_logger(name, datetime_prefix=datetime_prefix):
    logging_dir = os.path.join(backend_config.backend_cache_root, "python_logs")
    os.makedirs(logging_dir, exist_ok=True)

    logger = logging.getLogger(name)
    # file_handler does logging to file
    file_handler = logging.FileHandler(
        os.path.join(logging_dir, f"{datetime_prefix}_tt_studio_backend.log")
    )
    # stream_handler does logging to stdout
    stream_handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "%(asctime)s - %(pathname)s:%(lineno)d - %(levelname)s - %(message)s"
    )
    file_handler.setFormatter(formatter)
    stream_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)
    logger.setLevel(logging.INFO)
    # pytest will give double logs if propagated
    logger.propagate = False
    return logger
