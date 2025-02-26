import { Link } from "react-router-dom";
import type { Model } from "./types";
import { Badge } from "../ui/tt-device-badge";

type ModelCardProps = Omit<Model, "id">;

export function ModelCard({
  title = "Model Name",
  image,
  path = "#",
  filter,
  TTDevice,
  poweredByText = "Powered by a Tenstorrent Device!", // default text in case none is provided in data.ts
}: ModelCardProps) {
  console.log("ModelCard rendered with path:", path);
  console.log("TTDevice:", TTDevice);
  console.log("Image:", image);
  return (
    <Link to={path} className="block w-full h-full">
      <div className="group relative h-full rounded-xl transition-all duration-500 ease-out hover:scale-[1.03] hover:shadow-2xl hover:-translate-y-2">
        <div
          className="relative h-full overflow-hidden rounded-xl bg-black/90 
                        shadow-[0_0_30px_rgba(0,0,0,0.8)] 
                        before:absolute before:inset-0 before:rounded-xl before:bg-gradient-to-br before:from-white/10 before:to-transparent before:opacity-20
                        after:absolute after:inset-[1px] after:rounded-xl after:bg-gradient-to-tl after:from-white/5 after:to-transparent after:opacity-30
                        group-hover:shadow-[0_0_40px_rgba(128,128,255,0.15),0_0_20px_rgba(255,255,255,0.1)]
                        border border-white/5"
        >
          <div
            className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500
                         bg-gradient-to-br from-white/5 via-transparent to-transparent"
          ></div>

          {/* Image with Aspect Ratio */}
          <div className="relative aspect-[16/10] md:aspect-[4/3] lg:aspect-[16/10] xl:aspect-[4/3] w-full perspective-[1000px]">
            <img
              src={image || "/placeholder.svg"}
              alt={title}
              className="h-full w-full object-cover transition-all duration-500 
          group-hover:scale-105 group-hover:opacity-60"
            />
            {/* Color Overlay */}
            <div
              className="absolute inset-0 opacity-60 transition-opacity duration-500 group-hover:opacity-70"
              style={{
                backgroundColor: filter,
                mixBlendMode: "color",
              }}
            />
            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

            {/* Hover Text Overlay with Glow Effect */}
            <div
              className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 
          transition-all duration-500 bg-black/40 backdrop-blur-[2px]"
            >
              <p
                className="text-white text-xl font-mono px-6 py-4 border border-white/20 rounded-lg 
                          bg-black/60 shadow-[0_0_15px_rgba(255,255,255,0.1)] transform transition-transform duration-500 
                          group-hover:translate-y-0 translate-y-4
                          relative before:absolute before:inset-0 before:rounded-lg before:bg-gradient-to-r before:from-white/5 before:via-transparent before:to-white/5 before:opacity-50"
              >
                {poweredByText}
              </p>
            </div>
          </div>

          {/* Title and Badge with Subtle Glow */}
          <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between z-10">
            <h3
              className="text-lg md:text-xl font-semibold text-white group-hover:text-white
                          transform transition-transform duration-500 group-hover:translate-x-2
                          group-hover:text-shadow-[0_0_10px_rgba(255,255,255,0.5)]"
            >
              {title}
            </h3>
            {TTDevice && (
              <div
                className="transform transition-transform duration-500 group-hover:translate-y-[-8px]
                             group-hover:shadow-[0_0_10px_rgba(255,255,255,0.2)]"
              >
                <Badge>{TTDevice}</Badge>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
