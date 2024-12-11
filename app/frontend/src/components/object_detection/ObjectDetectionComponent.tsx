// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useState } from "react";
import { Card } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import SourcePicker from "./SourcePicker";
import WebcamPicker from "./WebcamPicker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

export const ObjectDetectionComponent = () => {
  const [image, setImage] = useState<string | null>(null);
  const [tableData, setTableData] = useState([
    { col1: "TEST", col2: "TESTING", index: 0 },
    { col1: "TEST2", col2: "TESTING2", index: 1 },
  ]);

  return (
    <div className="flex flex-col overflow-scroll h-full gap-8 w-3/4 mx-auto max-w-7xl px-4 md:px-8 py-10">
      <Card className="border-2 p-4 rounded-md space-y-4">
        {/* Tabs for File Picker and Webcam */}
        <Tabs defaultValue="file" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="file">File Upload</TabsTrigger>
            <TabsTrigger value="webcam">Webcam</TabsTrigger>
          </TabsList>
          <TabsContent value="file">
            <SourcePicker setImage={setImage} />
          </TabsContent>
          <TabsContent value="webcam">
            <WebcamPicker setImage={setImage} />
          </TabsContent>
        </Tabs>

        {/* Image Display */}
        {image && (
          <Card className="flex overflow-hidden items-center justify-center border-dashed border-2 border-gray-300 mt-4">
            <img
              src={image}
              alt="Uploaded"
              className="max-h-full max-w-full object-contain"
            />
          </Card>
        )}

        {/* Table Display */}

        {image && (
          <Card className="p-4 mt-4">
            {tableData.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Header 1</TableHead>
                    <TableHead>Header 2</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableData.map((row) => (
                    <TableRow key={row.index}>
                      <TableCell>{row.col1}</TableCell>
                      <TableCell>{row.col2}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-gray-500">No data available</p>
            )}
          </Card>
        )}
      </Card>
    </div>
  );
};
