// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import VoiceAgentApp from "../components/voiceAgent/VoiceAgentApp";

const VoiceAgentPage = () => {
  return (
    <div className="h-screen w-full dark:bg-[#0A0A0A] bg-[#FAFAFA]">
      <div className="w-full h-screen pt-16 md:pt-0">
        <VoiceAgentApp />
      </div>
    </div>
  );
};

export default VoiceAgentPage;
