// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Link } from "react-router-dom";
import type { Model } from "./types";
import { useState } from "react";

type ModelCardProps = Omit<Model, "id">;

export function ModelCard({
  title = "Model Name",
  image,
  path = "/",
  filter,
  TTDevice,
  poweredByText = "Powered by a Tenstorrent Device!", // default text in case none is provided in data.ts
}: ModelCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Link to={path} className="block w-full h-full perspective-[1000px]">
      <div
        className="relative h-full transition-all duration-500 ease-out transform-style-3d"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onTouchStart={() => setIsHovered(true)}
        onTouchEnd={() => setIsHovered(false)}
      >
        <div
          className={`
          relative h-full rounded-2xl 
          bg-[#1a1e24] 
          transition-all duration-300 ease-out transform-style-3d
          ${
            isHovered
              ? "transform scale-[1.03] rotate-y-[5deg] border-2 border-[var(--TT-purple-accent1)] shadow-[12px_12px_24px_rgba(0,0,0,0.8),0_0_20px_rgba(80,100,120,0.3)]"
              : "shadow-[8px_8px_16px_rgba(0,0,0,0.8),-4px_-4px_12px_rgba(35,40,45,0.2),inset_1px_1px_2px_rgba(60,70,80,0.1)]"
          }
        `}
        >
          <div
            className={`absolute inset-0 rounded-2xl overflow-hidden 
                          bg-gradient-to-br from-[rgba(255,255,255,0.07)] via-transparent to-transparent
                          transition-all duration-300
                          ${isHovered ? "opacity-60 from-[var(--TT-purple-accent1)]/20" : "opacity-30"}`}
          ></div>

          {/* Inner content with enhanced 3D effect */}
          <div
            className={`
            relative h-full rounded-2xl overflow-hidden
            transition-all duration-300 ease-out transform-style-3d
            ${
              isHovered
                ? "shadow-[inset_3px_3px_8px_rgba(0,0,0,0.6),inset_-2px_-2px_5px_rgba(40,45,50,0.3)]"
                : "shadow-[inset_1px_1px_3px_rgba(0,0,0,0.4),inset_-1px_-1px_3px_rgba(40,45,50,0.2)]"
            }
          `}
          >
            {/* Image container with 3D perspective */}
            <div className="relative aspect-[16/10] md:aspect-[4/3] lg:aspect-[16/10] xl:aspect-[4/3] w-full overflow-hidden rounded-t-2xl">
              <img
                src={image || "/placeholder.svg"}
                alt={title}
                className={`
                  h-full w-full object-cover 
                  transition-all duration-500 ease-out
                  ${isHovered ? "scale-[1.08] opacity-80 translate-z-[10px]" : "opacity-90"}
                `}
              />

              {/* Color overlay with improved 3D lighting effect */}
              {filter && (
                <div
                  className={`
                    absolute inset-0 
                    transition-all duration-500 ease-out
                    ${isHovered ? "opacity-70 translate-z-[5px]" : "opacity-50"}
                  `}
                  style={{
                    backgroundColor: filter,
                    mixBlendMode: "overlay",
                    boxShadow: isHovered
                      ? "inset 0 0 30px rgba(0,0,0,0.3)"
                      : "none",
                  }}
                />
              )}

              {/* Enhanced 3D gradient overlay */}
              <div
                className={`
                absolute inset-0 bg-gradient-to-t from-[#1a1e24]/95 via-[#1a1e24]/40 to-transparent
                transition-all duration-300
                ${isHovered ? "opacity-90 translate-z-[3px]" : "opacity-100"}
              `}
              />

              {/* Floating info card with enhanced 3D effect */}
              <div
                className={`
                  absolute inset-0 flex items-center justify-center 
                  transition-all duration-500 ease-out backdrop-blur-[2px]
                  ${isHovered ? "opacity-100" : "opacity-0"}
                `}
              >
                <div
                  className={`
                    text-[#a0aec0] text-sm sm:text-base md:text-lg xl:text-xl font-mono px-4 sm:px-6 md:px-8 py-3 sm:py-4 md:py-5 rounded-xl 
                    bg-[#1a1e24] 
                    transition-all duration-500 ease-out transform-style-3d
                    ${
                      isHovered
                        ? "translate-y-0 scale-100 translate-z-[30px] rotate-y-[-5deg] border border-[var(--TT-purple-accent1)]/40 shadow-[5px_5px_15px_rgba(0,0,0,0.8),-3px_-3px_10px_rgba(40,45,50,0.3)]"
                        : "translate-y-8 scale-95 translate-z-0"
                    }
                  `}
                >
                  {poweredByText}
                </div>
              </div>
            </div>

            {/* Title and badge section with enhanced 3D effects */}
            <div className="p-4 md:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0 z-10">
              <h3
                className={`
                  text-base sm:text-lg md:text-xl font-semibold 
                  transition-all duration-500 ease-out
                  ${isHovered ? "text-[var(--TT-purple-accent1)] translate-x-1 translate-z-[15px]" : "text-[#a0aec0]"}
                `}
              >
                {title}
              </h3>

              {TTDevice && (
                <div
                  className={`
                  transition-all duration-500 ease-out transform-style-3d
                  ${isHovered ? "transform translate-y-[-4px] translate-z-[20px]" : ""}
                `}
                >
                  <div
                    className={`
                      px-3 py-1 sm:px-4 sm:py-2 rounded-xl bg-[#1a1e24] text-[#a0aec0] font-medium text-xs sm:text-sm
                      transition-all duration-300 ease-out
                      ${
                        isHovered
                          ? "shadow-[inset_3px_3px_6px_rgba(0,0,0,0.7),inset_-2px_-2px_5px_rgba(40,45,50,0.3)] rotate-y-[5deg] text-[var(--TT-purple-accent1)]"
                          : "shadow-[3px_3px_8px_rgba(0,0,0,0.7),-2px_-2px_6px_rgba(40,45,50,0.2)]"
                      }
                    `}
                  >
                    {TTDevice}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Enhanced 3D glow effect */}
        <div
          className={`
          absolute bottom-[-15px] left-[5%] right-[5%] h-[15px] 
          transition-all duration-300 ease-out
          rounded-b-full blur-lg
          ${
            isHovered
              ? "opacity-80 scale-x-[1.05] bg-gradient-to-b from-[var(--TT-purple-accent1)]/50 to-transparent"
              : `opacity-40 bg-gradient-to-b from-[${filter || "#3182ce"}]/30 to-transparent`
          }
        `}
        ></div>

        {/* Additional neumorphic effects for dark mode */}
        <div
          className={`
            absolute inset-0 rounded-2xl pointer-events-none
            transition-all duration-300 ease-out
            ${isHovered ? "opacity-40" : "opacity-20"}
          `}
          style={{
            boxShadow:
              "inset 1px 1px 2px rgba(255,255,255,0.05), inset -1px -1px 2px rgba(0,0,0,0.5)",
          }}
        ></div>

        {/* Subtle edge light effect */}
        <div
          className={`
            absolute -inset-[1px] rounded-2xl pointer-events-none
            bg-gradient-to-br from-[rgba(255,255,255,0.07)] to-transparent
            transition-all duration-300 ease-out
            ${isHovered ? "opacity-30" : "opacity-10"}
          `}
        ></div>
      </div>
    </Link>
  );
}
