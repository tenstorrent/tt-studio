// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { Tabs } from "@tenstorrent/vesper/tabs";
import { Bug, Lock, Server } from "@tenstorrent/vesper/icons";
import { Keys, BugReport, ServingBackend } from "./components";

const DEFAULT_TAB = "keys";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB);

  return (
    <div className="px-vesper-4 py-vesper-16 w-full max-w-xl mx-auto text-left">
      <Tabs
        items={[
          {
            label: "Keys",
            value: "keys",
            icon: <Lock />,
            content: <Keys />,
          },
          {
            label: "Report a Bug",
            value: "report-a-bug",
            icon: <Bug />,
            content: <BugReport />,
          },
          {
            label: "Serving Backend",
            value: "serving-backend",
            icon: <Server />,
            content: <ServingBackend />,
          },
        ]}
        value={activeTab}
        onValueChange={setActiveTab}
      />
    </div>
  );
}
