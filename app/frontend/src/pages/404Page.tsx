import React from "react";
import { useState, useEffect } from "react";
import {
  useMotionValue,
  useMotionTemplate,
  motion,
  type MotionValue,
} from "framer-motion";
import { useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { useLogo } from "../utils/logo";

const PageSpotlight = ({ children }: { children: React.ReactNode }) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function onMouseMove({ clientX, clientY }: React.MouseEvent<HTMLDivElement>) {
    mouseX.set(clientX);
    mouseY.set(clientY);
  }

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden bg-background"
      onMouseMove={onMouseMove}
    >
      <PagePattern mouseX={mouseX} mouseY={mouseY} />
      <div className="relative z-10">{children}</div>
    </div>
  );
};

function PagePattern({
  mouseX,
  mouseY,
}: {
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
}) {
  const maskImage = useMotionTemplate`radial-gradient(1200px at ${mouseX}px ${mouseY}px, white, transparent)`;
  const style = { maskImage, WebkitMaskImage: maskImage };

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-background opacity-100" />
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-[#6FABA0] via-[#74C5DF] to-[#323968] opacity-10 group-hover:opacity-60 transition-opacity duration-700"
        style={style}
      />
    </div>
  );
}

const LoginCard = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const [randomString, setRandomString] = useState("");

  useEffect(() => {
    const str = generateRandomString(8000); // Restored to original length
    setRandomString(str);
  }, []);

  function onMouseMove({
    currentTarget,
    clientX,
    clientY,
  }: React.MouseEvent<HTMLDivElement>) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <div
      className={cn(
        "group relative rounded-lg bg-card/80 backdrop-blur-sm transition-all duration-300 p-16 w-full max-w-4xl min-h-[800px]",
        className
      )}
      onMouseMove={onMouseMove}
    >
      <CardPattern
        mouseX={mouseX}
        mouseY={mouseY}
        randomString={randomString}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
};

function CardPattern({
  mouseX,
  mouseY,
  randomString,
}: {
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  randomString: string;
}) {
  const maskImage = useMotionTemplate`radial-gradient(250px at ${mouseX}px ${mouseY}px, white, transparent)`;
  const style = { maskImage, WebkitMaskImage: maskImage };

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-70 transition-opacity duration-300" />
      <motion.div
        className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#6FABA0] via-[#74C5DF] to-[#323968] opacity-0 group-hover:opacity-50 transition-opacity duration-300"
        style={style}
      />
      <motion.div
        className="absolute inset-0 rounded-lg opacity-0 mix-blend-overlay group-hover:opacity-100 transition-opacity duration-300"
        style={style}
      >
        <p className="absolute inset-0 text-xs h-full overflow-hidden break-words whitespace-pre-wrap text-white/80 font-mono font-bold p-4">
          {randomString}
        </p>
      </motion.div>
    </div>
  );
}

const characters =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const generateRandomString = (length: number) => {
  const word = "tenstorrent";
  let result = "";
  for (let i = 0; i < length; i++) {
    if (i % 20 === 0 && i + word.length <= length) {
      result += word;
      i += word.length - 1;
    } else {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length)
      );
    }
  }
  return result;
};

// Array of chip images
const chipImages = [
  "https://cdn.sanity.io/images/jpb4ed5r/production/a325e8a6af361ae03c162d0abfe0339d0554c90d-1460x1681.jpg",
  "https://cdn.sanity.io/images/jpb4ed5r/production/176b1c0aeb6432b315442f64860fe20100e4ba09-1510x1645.jpg",
  "https://cdn.sanity.io/images/jpb4ed5r/production/9e722e5eb94491ea28b9169f7aca889263eb190d-1510x1645.jpg",
];

// Image carousel component
function ImageCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hoverCount, setHoverCount] = useState(0);

  const nextImage = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % chipImages.length);
  };

  const prevImage = () => {
    setCurrentIndex(
      (prevIndex) => (prevIndex - 1 + chipImages.length) % chipImages.length
    );
  };

  const handleHover = () => {
    setHoverCount((prev) => (prev + 1) % 3);
  };

  return (
    <div className="flex flex-col items-center w-full">
      <div className="relative w-full flex justify-center mb-8">
        <a
          href="https://tenstorrent.com/#:~:text=to%20main%20content-,Products,-Support"
          target="_blank"
          rel="noopener noreferrer"
          className="block transition-all duration-500"
          onMouseEnter={handleHover}
        >
          <img
            src={chipImages[currentIndex] || "/placeholder.svg"}
            alt={`Tenstorrent Chip ${currentIndex + 1}`}
            className={`object-cover h-[500px] w-[500px] rounded-3xl border-4 border-[#74C5DF] shadow-lg transition-all duration-500 ${
              hoverCount === 0
                ? "brightness-[0.05]"
                : hoverCount === 1
                  ? "brightness-[0.15]"
                  : "brightness-100"
            }`}
          />
        </a>
      </div>
      <p className="text-lg text-muted-foreground text-center mb-4">
        Take a look at our innovative AI hardware products
      </p>
      <div className="flex justify-center gap-4">
        <Button
          onClick={prevImage}
          variant="outline"
          className="rounded-full w-10 h-10 p-0 flex items-center justify-center border-[#74C5DF] text-[#323968] hover:bg-[#74C5DF]/20"
        >
          ←
        </Button>
        <Button
          onClick={nextImage}
          variant="outline"
          className="rounded-full w-10 h-10 p-0 flex items-center justify-center border-[#74C5DF] text-[#323968] hover:bg-[#74C5DF]/20"
        >
          →
        </Button>
      </div>
    </div>
  );
}

export default function NotFoundPage() {
  const navigate = useNavigate();
  const { logoUrl } = useLogo();

  return (
    <PageSpotlight>
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-foreground sm:px-6 lg:px-6 py-8">
        <div className="w-full max-w-4xl space-y-6">
          <div className="flex flex-col items-center">
            <h1 className="text-5xl font-bold mb-2">404</h1>
            <p className="text-2xl text-muted-foreground text-center max-w-2xl mb-6">
              Page Not Found
            </p>
          </div>
          <LoginCard className="p-8 w-full flex flex-col items-center justify-center">
            <ImageCarousel />
            <div className="w-full flex justify-center mt-6">
              <Button
                onClick={() => navigate("/")}
                className="flex justify-center py-3 px-8 border border-transparent rounded-md shadow-sm text-lg font-medium text-white bg-[#323968] hover:bg-[#74C5DF] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-TT-purple-accent transition-colors duration-300"
              >
                Return to Homepage
              </Button>
            </div>
          </LoginCard>
          <div className="flex items-center justify-center space-x-2">
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Tenstorrent"
                className="h-6 w-auto"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <p className="text-center text-sm text-muted-foreground">
              © {new Date().getFullYear()} Tenstorrent. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </PageSpotlight>
  );
}
