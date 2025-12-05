// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Link } from "react-router-dom";
import type { Model } from "./types";
import { useState, useEffect, useCallback, useRef } from "react";
import React from "react";
import { Eye, Mic, Brain, Bot, Network, Video } from "lucide-react";
import { HardwareIcon } from "./HardwareIcon";
import { ModelLogo } from "./ModelLogo";

type ModelCardProps = Omit<Model, "id"> & {
  modelType?: "LLM" | "CNN" | "Audio" | "NLP" | "ImageGen" | "VideoGen";
  statusIndicator?: { show: boolean; color: string; animate: boolean };
  hoverEffects?: {
    rotate: boolean;
    scale: number;
    glow: boolean;
    particleEffect?: {
      enabled: boolean;
      count?: number;
      speed?: number;
      color?: string;
    };
  };
  modelTypeIcon?: {
    position: string;
    showBackground: boolean;
    rotate: boolean;
    size: string;
  };
};

export function ModelCard({
  title = "Model Name",
  image,
  path = "/",
  filter,
  TTDevice,
  modelType = "LLM",
  poweredByText = "Powered by a Tenstorrent Device!",
  tpBadge = {},
  statusIndicator = { show: true, color: "green-500", animate: true },
  hoverEffects = {
    rotate: true,
    scale: 1.03,
    glow: true,
    particleEffect: { enabled: true, count: 10 },
  },
  modelTypeIcon = {
    position: "top-right",
    showBackground: true,
    rotate: true,
    size: "medium",
  },
}: ModelCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [particles, setParticles] = useState<
    Array<{ x: number; y: number; opacity: number; speed: number }>
  >([]);
  const animationFrameRef = useRef<number>();
  const lastUpdateRef = useRef<number>();

  console.log("ModelCard props:", { title, tpBadge });

  // Generate floating particles effect
  useEffect(() => {
    if (isHovered && hoverEffects?.particleEffect?.enabled) {
      const newParticles = Array.from(
        { length: hoverEffects.particleEffect?.count || 10 },
        () => ({
          x: Math.random() * 100,
          y: Math.random() * 100,
          opacity: Math.random(),
          speed:
            (hoverEffects.particleEffect?.speed || 0.5) + Math.random() * 1.5,
        })
      );
      setParticles(newParticles);
    } else {
      setParticles([]);
    }
  }, [
    isHovered,
    hoverEffects?.particleEffect?.enabled,
    hoverEffects?.particleEffect?.count,
    hoverEffects?.particleEffect?.speed,
  ]);

  // Update particle positions with requestAnimationFrame
  const updateParticles = useCallback(() => {
    const now = performance.now();
    if (!lastUpdateRef.current) lastUpdateRef.current = now;
    const deltaTime = (now - lastUpdateRef.current) / 16; // Normalize to ~60fps

    setParticles((prevParticles) =>
      prevParticles
        .map((particle) => ({
          ...particle,
          y: particle.y - particle.speed * deltaTime,
          opacity: particle.y < 10 ? particle.y / 10 : particle.opacity,
        }))
        .filter((particle) => particle.y > 0)
    );

    lastUpdateRef.current = now;
    if (particles.length > 0) {
      animationFrameRef.current = requestAnimationFrame(updateParticles);
    }
  }, []);

  // Manage animation frame
  useEffect(() => {
    if (particles.length > 0) {
      animationFrameRef.current = requestAnimationFrame(updateParticles);
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [particles.length, updateParticles]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    setMousePosition({ x, y });
  };

  const getModelIcon = () => {
    if (title.toLowerCase().includes("yolo")) {
      return <Eye className="w-6 h-6" />;
    }
    switch (modelType) {
      case "CNN":
        return <Network className="w-6 h-6" />;
      case "Audio":
        return <Mic className="w-6 h-6" />;
      case "NLP":
        return <Brain className="w-6 h-6" />;
      case "VideoGen":
        return <Video className="w-6 h-6" />;
      default:
        return <Bot className="w-6 h-6" />; // Default for LLM
    }
  };

  const getIconSize = () => {
    switch (modelTypeIcon.size) {
      case "small":
        return "w-4 h-4";
      case "large":
        return "w-8 h-8";
      default:
        return "w-6 h-6";
    }
  };

  console.log("tpBadge.customText:", tpBadge.customText);

  return (
    <Link to={path} className="block w-full h-full perspective-[2000px]">
      <div
        className="relative h-full transition-all duration-500 ease-out transform-style-3d"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseMove={handleMouseMove}
        onTouchStart={() => setIsHovered(true)}
        onTouchEnd={() => setIsHovered(false)}
        style={{
          transform:
            isHovered && hoverEffects.rotate
              ? `rotateY(${mousePosition.x * 5}deg) rotateX(${-mousePosition.y * 5}deg)`
              : "none",
        }}
      >
        {/* TP configuration badge */}
        {tpBadge.show !== false && (
          <div
            className={`
              absolute ${tpBadge.position || "-top-2 -left-2"} z-20
              transition-all duration-500 ease-out transform-style-3d
              ${isHovered ? "translate-z-[40px] scale-110" : "translate-z-[20px]"}
            `}
          >
            <div
              className={`
                px-2 py-1 rounded-lg bg-white dark:bg-[#1a1e24] text-gray-700 dark:text-[#a0aec0] text-xs font-medium
                shadow-[0_4px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.5)]
                transition-all duration-300 flex items-center gap-1.5
                border border-gray-200 dark:border-[#2a2e34]
                ${isHovered ? "text-[#7C68FA] border-[#7C68FA]" : ""}
                cursor-help
              `}
              title="Tensor Processor (TP) configuration - Number of tensor processors used for model parallelism"
            >
              <div className="flex flex-col gap-[2px] mr-1.5">
                <div
                  className={`w-3 h-[2px] ${isHovered ? "bg-red-500" : "bg-gray-500"} transition-colors duration-300`}
                ></div>
                <div
                  className={`w-3 h-[2px] ${isHovered ? "bg-red-500" : "bg-gray-500"} transition-colors duration-300`}
                ></div>
                <div
                  className={`w-3 h-[2px] ${isHovered ? "bg-red-500" : "bg-gray-500"} transition-colors duration-300`}
                ></div>
              </div>
              <span className="font-mono">
                {tpBadge.customText && tpBadge.customText}
              </span>
            </div>
          </div>
        )}

        {/* Floating model type badge with status indicator */}
        <div
          className={`
            absolute ${
              modelTypeIcon.position === "top-right"
                ? "-top-3 -right-3"
                : modelTypeIcon.position === "top-left"
                  ? "-top-3 -left-3"
                  : modelTypeIcon.position === "bottom-right"
                    ? "-bottom-3 -right-3"
                    : "-bottom-3 -left-3"
            } z-20
            transition-all duration-500 ease-out transform-style-3d
            ${isHovered ? "translate-z-[40px] scale-110" : "translate-z-[20px]"}
          `}
        >
          <div className="relative">
            {/* Status indicator */}
            {statusIndicator.show && (
              <div className="absolute -top-1 -right-1 z-30">
                <div className="relative">
                  <div
                    className={`w-2.5 h-2.5 bg-${statusIndicator.color} rounded-full`}
                  ></div>
                  {statusIndicator.animate && (
                    <>
                      <div
                        className={`absolute inset-0 w-2.5 h-2.5 bg-${statusIndicator.color} rounded-full animate-ping opacity-75`}
                      ></div>
                      <div
                        className={`absolute inset-0 w-2.5 h-2.5 bg-${statusIndicator.color} rounded-full animate-pulse`}
                      ></div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Model type icon */}
            <div
              className={`
                p-2 rounded-full
                bg-white dark:bg-[#1a1e24]
                text-gray-500
                shadow-[0_4px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.5)]
                transition-all duration-300
                ${isHovered ? "text-red-500" : ""} 
                ${isHovered && modelTypeIcon.rotate ? "rotate-[360deg]" : ""}
              `}
            >
              {React.cloneElement(getModelIcon(), {
                className: `${getIconSize()} transition-colors duration-300`,
              })}
            </div>
          </div>
        </div>

        {/* Floating particles */}
        {particles.map((particle, index) => (
          <div
            key={index}
            className={`absolute w-1 h-1 rounded-full ${hoverEffects.particleEffect?.color || "bg-[var(--TT-purple-accent1)]"}`}
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              opacity: particle.opacity,
              transform: `translateZ(${20 + Math.random() * 30}px)`,
            }}
          />
        ))}

        <div
          className={`
            relative h-full rounded-2xl 
            bg-gray-100 dark:bg-[#1a1e24] 
            transition-all duration-300 ease-out transform-style-3d
            ${
              isHovered
                ? `transform ${hoverEffects.scale ? `scale-[${hoverEffects.scale}]` : ""} 
                   border-2 border-[#7C68FA] 
                   ${hoverEffects.glow ? "shadow-[12px_12px_24px_rgba(0,0,0,0.1),0_0_20px_rgba(124,104,250,0.2)] dark:shadow-[12px_12px_24px_rgba(0,0,0,0.8),0_0_20px_rgba(80,100,120,0.3)]" : ""}`
                : "shadow-[8px_8px_16px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.5),inset_1px_1px_2px_rgba(255,255,255,0.1)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.8),-4px_-4px_12px_rgba(35,40,45,0.2),inset_1px_1px_2px_rgba(60,70,80,0.1)]"
            }
          `}
        >
          <div
            className={`absolute inset-0 rounded-2xl overflow-hidden 
                          bg-gradient-to-br from-gray-200/70 via-transparent to-transparent dark:from-[rgba(255,255,255,0.07)]
                          transition-all duration-300
                          ${isHovered ? "opacity-60 from-[#7C68FA]/20" : "opacity-30"}`}
          ></div>

          {/* Inner content with enhanced 3D effect */}
          <div
            className={`
            relative h-full rounded-2xl overflow-hidden
            transition-all duration-300 ease-out transform-style-3d
            ${
              isHovered
                ? "shadow-[inset_3px_3px_8px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.5)] dark:shadow-[inset_3px_3px_8px_rgba(0,0,0,0.6),inset_-2px_-2px_5px_rgba(40,45,50,0.3)]"
                : "shadow-[inset_1px_1px_3px_rgba(0,0,0,0.05),inset_-1px_-1px_3px_rgba(255,255,255,0.5)] dark:shadow-[inset_1px_1px_3px_rgba(0,0,0,0.4),inset_-1px_-1px_3px_rgba(40,45,50,0.2)]"
            }
          `}
          >
            {/* Image container with 3D perspective */}
            <div className="relative aspect-[16/10] md:aspect-[4/3] lg:aspect-[16/10] xl:aspect-[4/3] w-full overflow-hidden rounded-t-2xl">
              <ModelLogo
                path={image}
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
                      ? "inset 0 0 30px rgba(0,0,0,0.1)"
                      : "none",
                  }}
                />
              )}

              {/* Enhanced 3D gradient overlay */}
              <div
                className={`
                absolute inset-0 bg-gradient-to-t from-gray-900/95 via-gray-900/40 to-transparent dark:from-[#1a1e24]/95 dark:via-[#1a1e24]/40
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
                    text-gray-700 dark:text-[#a0aec0] text-sm sm:text-base md:text-lg xl:text-xl font-mono px-4 sm:px-6 md:px-8 py-3 sm:py-4 md:py-5 rounded-xl 
                    bg-gray-100/90 dark:bg-[#1a1e24] 
                    transition-all duration-500 ease-out transform-style-3d
                    ${
                      isHovered
                        ? "translate-y-0 scale-100 translate-z-[30px] rotate-y-[-5deg] border border-[#7C68FA]/40 shadow-[5px_5px_15px_rgba(0,0,0,0.1),-3px_-3px_10px_rgba(255,255,255,0.5)] dark:shadow-[5px_5px_15px_rgba(0,0,0,0.8),-3px_-3px_10px_rgba(40,45,50,0.3)]"
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
                  ${isHovered ? "text-[#7C68FA] translate-x-1 translate-z-[15px]" : "text-gray-800 dark:text-[#a0aec0]"}
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
                      px-3 py-1 sm:px-4 sm:py-2 rounded-xl bg-gray-200 dark:bg-[#1a1e24] text-gray-700 dark:text-[#a0aec0] font-medium text-xs sm:text-sm
                      transition-all duration-300 ease-out flex items-center gap-2
                      ${
                        isHovered
                          ? "shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.5)] rotate-y-[5deg] text-[#7C68FA] dark:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.7),inset_-2px_-2px_5px_rgba(40,45,50,0.3)]"
                          : "shadow-[3px_3px_8px_rgba(0,0,0,0.1),-2px_-2px_6px_rgba(255,255,255,0.5)] dark:shadow-[3px_3px_8px_rgba(0,0,0,0.7),-2px_-2px_6px_rgba(40,45,50,0.2)]"
                      }
                    `}
                  >
                    <HardwareIcon
                      type={TTDevice}
                      className={`w-5 h-5 object-contain filter ${isHovered ? "brightness-125" : ""}`}
                    />
                    <span>{TTDevice}</span>
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
              ? "opacity-80 scale-x-[1.05] bg-gradient-to-b from-[#7C68FA]/50 to-transparent"
              : `opacity-40 bg-gradient-to-b from-[${filter || "#3182ce"}]/30 to-transparent`
          }
        `}
        ></div>

        {/* Additional neumorphic effects */}
        <div
          className={`
            absolute inset-0 rounded-2xl pointer-events-none
            transition-all duration-300 ease-out
            ${isHovered ? "opacity-40" : "opacity-20"}
          `}
          style={{
            boxShadow:
              "inset 1px 1px 2px rgba(255,255,255,0.5), inset -1px -1px 2px rgba(0,0,0,0.1) dark:inset 1px 1px 2px rgba(255,255,255,0.05), dark:inset -1px -1px 2px rgba(0,0,0,0.5)",
          }}
        ></div>

        {/* Subtle edge light effect */}
        <div
          className={`
            absolute -inset-[1px] rounded-2xl pointer-events-none
            bg-gradient-to-br from-gray-200/70 to-transparent dark:from-[rgba(255,255,255,0.07)]
            transition-all duration-300 ease-out
            ${isHovered ? "opacity-30" : "opacity-10"}
          `}
        ></div>
      </div>
    </Link>
  );
}
