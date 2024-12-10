// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import SourcePicker from "./SourcePicker";

import { useState } from "react";
import { Card } from "../ui/card"; // shadcn card

export const ObjectDetectionComponent = () => {
  const [image, setImage] = useState(null);
  const [tableData, setTableData] = useState([
    { col1: "TEST", col2: "TESTING", index: 0 },
    { col1: "TEST2", col2: "TESTING2", index: 0 },
  ]);

  return (
    <div className="flex flex-col h-full gap-8 w-3/4 mx-auto max-w-7xl px-4 md:px-8 py-10">
      <Card className="border-2 p-4 rounded-md space-y-4">
        {/* Header Buttons */}
        <SourcePicker setImage={setImage} />

        {/* Image Display */}
        {image && (
          <Card className="flex overflow-hidden items-center justify-center border-dashed border-2 border-gray-300">
            {image ? (
              <img
                src={image}
                alt="Uploaded"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="text-gray-500">Image Display</p>
            )}
          </Card>
        )}

        {/* Table Display */}
        {image && (
          <Card className="p-4">
            {tableData.length > 0 ? (
              <table className="w-full table-auto border-collapse">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 px-4">Header 1</th>
                    <th className="py-2 px-4">Header 2</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, index) => (
                    <tr key={index} className="border-b">
                      <td className="py-2 px-4">{row.col1}</td>
                      <td className="py-2 px-4">{row.col2}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-gray-500">Table</p>
            )}
          </Card>
        )}
      </Card>
    </div>
  );
};
