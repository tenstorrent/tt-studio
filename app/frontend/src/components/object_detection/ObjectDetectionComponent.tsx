// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { Card } from "../ui/card";

export const ObjectDetectionComponent = () => {
  return (
    <div className="flex flex-col gap-8 w-3/4 mx-auto max-w-7xl px-4 md:px-8 pt-10 py-6">
      <div className="flex w-full gap-4">
        {/* First Column: 75% Width */}
        <Card className="h-auto w-3/4 py-8 px-16 border-2">
          <span>ImageDisplay</span>
          <p className="text-gray-500">Video Placeholder</p>
        </Card>

        {/* Second Column: 25% Width */}
        <Card className="h-auto w-1/4 py-8 px-16 border-2">
          <input
            id="file-picker"
            type="file"
            className="file-input file-input-bordered w-full max-w-xs"
            onChange={(e) =>
              console.log(
                e.target.files ? e.target.files[0] : "FILE HANDLING FAILED",
              )
            }
          />
        </Card>
      </div>
    </div>
  );
};
