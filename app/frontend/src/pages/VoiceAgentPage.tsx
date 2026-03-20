// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import VoiceAgentApp from "../components/voiceAgent/VoiceAgentApp";

const VoiceAgentPage = () => {
  return (
    <div className="h-[calc(100vh-9rem)] w-full overflow-hidden flex justify-center p-2 sm:p-3 lg:p-4">
      <VoiceAgentApp />
    </div>
  );
};

export default VoiceAgentPage;
