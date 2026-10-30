// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Whether launching the app reconnects to the machine it was last on.
// Pure-ish view: reads and writes the setting, nothing else.
//
// The resume is always cancellable while it runs, but "cancellable" is not
// the same as "opt-out" — someone who never wants it should not have to
// press Cancel every launch.

import { useEffect, useState } from "react";
import { getResumeOnLaunch, setResumeOnLaunch } from "../lib/ipc";

function ResumeSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    getResumeOnLaunch()
      .then(setEnabled)
      // Unreadable store: say what the app will actually do (the Rust side
      // defaults to resuming too).
      .catch(() => setEnabled(true));
  }, []);

  if (enabled === null) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-500">
      <input
        type="checkbox"
        checked={enabled}
        data-testid="resume-on-launch"
        onChange={(e) => {
          const next = e.target.checked;
          setEnabled(next);
          setResumeOnLaunch(next).catch(() => {});
        }}
        className="accent-purple-600"
      />
      Reconnect on launch
    </label>
  );
}

export default ResumeSetting;
