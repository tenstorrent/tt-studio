// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { Card } from "../ui/card";

export const ObjectDetectionComponent = () => {
  return (
    <div className="flex flex-col gap-8 w-3/4 mx-auto max-w-7xl px-4 md:px-8 pt-10 py-6">
      <Card className="h-auto py-8 px-16 border-2">
        <span>Yolo V4</span>
      </Card>
    </div>
  );
};
