// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import VoiceAgentApp from "../components/voiceAgent/VoiceAgentApp";

const VoiceAgentPage = () => {
  return (
    <div className="h-[calc(100vh-4rem)] w-full overflow-hidden flex items-center justify-center">
      <VoiceAgentApp />
    </div>
  );
};

export default VoiceAgentPage;
