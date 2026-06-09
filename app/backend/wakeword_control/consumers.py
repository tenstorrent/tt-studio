# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import asyncio
import json
import logging

from channels.generic.websocket import AsyncWebsocketConsumer

from .detector import WakeDetector, WakeModelUnavailable

logger = logging.getLogger(__name__)


class WakeWordConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        try:
            self.detector = WakeDetector()
        except WakeModelUnavailable as exc:
            # No wake-word model on disk — accept the socket so the client gets a clear reason, then close.
            logger.warning("Wake-word connection rejected: %s", exc)
            await self.accept()
            await self.send(text_data=json.dumps({"event": "unavailable", "detail": str(exc)}))
            await self.close(code=1011)
            return
        await self.accept()

    async def disconnect(self, close_code):
        pass

    async def receive(self, text_data=None, bytes_data=None):
        if bytes_data is None or getattr(self, "detector", None) is None:
            return
        event = await asyncio.to_thread(self.detector.process_frame, bytes_data)
        if event is not None:
            await self.send(text_data=json.dumps(event))
