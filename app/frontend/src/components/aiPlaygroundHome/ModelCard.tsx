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
      <div className="group relative h-full rounded-xl transition-all duration-300 ease-out hover:scale-[1.02] hover:shadow-xl">
        {/* Card Container */}
        <div className="relative h-full overflow-hidden rounded-xl bg-black">
          {/* Image with Aspect Ratio */}
          <div className="relative aspect-[16/10] md:aspect-[4/3] lg:aspect-[16/10] xl:aspect-[4/3] w-full">
            <img
              src={image || "/placeholder.svg"}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {/* Color Overlay */}
            <div
              className="absolute inset-0 opacity-60 transition-opacity duration-300 group-hover:opacity-70"
              style={{
                backgroundColor: filter,
                mixBlendMode: "color",
              }}
            />
            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />

            {/* Hover Text Overlay */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/50">
              <p className="text-white text-xl font-mono">{poweredByText}</p>
            </div>
          </div>

          {/* Title and Badge */}
          <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between">
            <h3 className="text-lg md:text-xl font-semibold text-white group-hover:text-white/90">
              {title}
            </h3>
            {TTDevice && <Badge>{TTDevice}</Badge>}
          </div>
        </div>
      </div>
    </Link>
  );
}
