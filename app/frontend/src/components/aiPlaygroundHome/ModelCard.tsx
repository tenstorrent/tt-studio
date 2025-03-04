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
      >
        {/* Main dark neumorphic container with enhanced 3D effect */}
        <div
          className={`
          relative h-full rounded-2xl 
          bg-[#1e2329] 
          transition-all duration-300 ease-out transform-style-3d
          ${
            isHovered
              ? "transform scale-[1.03] rotate-y-[5deg] shadow-[12px_12px_24px_rgba(0,0,0,0.7),0_0_20px_rgba(80,100,120,0.2)]"
              : "shadow-[5px_5px_15px_rgba(0,0,0,0.6),-5px_-5px_15px_rgba(40,45,50,0.4)]"
          }
        `}
        >
          {/* 3D edge highlight effect */}
          <div
            className={`absolute inset-0 rounded-2xl overflow-hidden opacity-30 
                          bg-gradient-to-br from-[rgba(255,255,255,0.1)] via-transparent to-transparent
                          ${isHovered ? "opacity-40" : "opacity-20"}`}
          ></div>

          {/* Inner content with enhanced 3D effect */}
          <div
            className={`
            relative h-full rounded-2xl overflow-hidden
            transition-all duration-300 ease-out transform-style-3d
            ${isHovered ? "shadow-[inset_3px_3px_8px_rgba(0,0,0,0.5),inset_-2px_-2px_5px_rgba(40,45,50,0.3)]" : ""}
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
                absolute inset-0 bg-gradient-to-t from-[#1e2329]/95 via-[#1e2329]/40 to-transparent
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
                    text-[#a0aec0] text-xl font-mono px-8 py-5 rounded-xl 
                    bg-[#1e2329] 
                    shadow-[5px_5px_15px_rgba(0,0,0,0.7),-5px_-5px_15px_rgba(40,45,50,0.4)]
                    transition-all duration-500 ease-out transform-style-3d
                    ${isHovered ? "translate-y-0 scale-100 translate-z-[30px] rotate-y-[-5deg]" : "translate-y-8 scale-95 translate-z-0"}
                  `}
                >
                  {poweredByText}
                </div>
              </div>
            </div>

            {/* Title and badge section with enhanced 3D effects */}
            <div className="p-6 flex items-center justify-between z-10">
              <h3
                className={`
                  text-lg md:text-xl font-semibold 
                  transition-all duration-500 ease-out
                  ${isHovered ? "text-[#e2e8f0] translate-x-1 translate-z-[15px]" : "text-[#a0aec0]"}
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
                      px-4 py-2 rounded-xl bg-[#1e2329] text-[#a0aec0] font-medium text-sm
                      transition-all duration-300 ease-out
                      ${
                        isHovered
                          ? "shadow-[inset_3px_3px_6px_rgba(0,0,0,0.6),inset_-3px_-3px_6px_rgba(40,45,50,0.3)] rotate-y-[5deg]"
                          : "shadow-[3px_3px_8px_rgba(0,0,0,0.6),-3px_-3px_8px_rgba(40,45,50,0.3)]"
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
          bg-gradient-to-b from-[${filter || "#3182ce"}]/30 to-transparent 
          rounded-b-full blur-lg
          transition-all duration-300 ease-out
          ${isHovered ? "opacity-80 scale-x-[1.05]" : "opacity-40"}
        `}
        ></div>
      </div>
    </Link>
  );
}
