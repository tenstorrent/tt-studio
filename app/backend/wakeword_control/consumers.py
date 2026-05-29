# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import asyncio
import json

from channels.generic.websocket import AsyncWebsocketConsumer

from .detector import WakeDetector


class WakeWordConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.detector = WakeDetector()
        await self.accept()

    async def disconnect(self, close_code):
        pass

    async def receive(self, text_data=None, bytes_data=None):
        if bytes_data is None:
            return
        event = await asyncio.to_thread(self.detector.process_frame, bytes_data)
        if event is not None:
            await self.send(text_data=json.dumps(event))
