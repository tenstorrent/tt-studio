// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

const MessageIndicator = ({ isMobileView = false }) => {
  return (
    <div className="flex items-center">
      <svg
        width={isMobileView ? "20" : "24"}
        height={isMobileView ? "20" : "24"}
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className="text-white"
      >
        <circle cx="4" cy="12" r="2" fill="currentColor">
          <animate
            id="dot1_animate"
            begin="0;dot3_animate.end+0.25s"
            attributeName="cy"
            calcMode="spline"
            dur="0.6s"
            values="12;6;12"
            keySplines=".33,.66,.66,1;.33,0,.66,.33"
          />
        </circle>
        <circle cx="12" cy="12" r="2" fill="currentColor">
          <animate
            id="dot2_animate"
            begin="dot1_animate.begin+0.1s"
            attributeName="cy"
            calcMode="spline"
            dur="0.6s"
            values="12;6;12"
            keySplines=".33,.66,.66,1;.33,0,.66,.33"
          />
        </circle>
        <circle cx="20" cy="12" r="2" fill="currentColor">
          <animate
            id="dot3_animate"
            begin="dot1_animate.begin+0.2s"
            attributeName="cy"
            calcMode="spline"
            dur="0.6s"
            values="12;6;12"
            keySplines=".33,.66,.66,1;.33,0,.66,.33"
          />
        </circle>
      </svg>
    </div>
  );
};

export default MessageIndicator;
