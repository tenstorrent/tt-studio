// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Video, Play, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { videoExamples } from "./videoExamplesData";

export default function VideoExamplesPage() {
  const navigate = useNavigate();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleStartGenerating = () => {
    navigate("/video-generation");
  };

  const handlePrevious = () => {
    setCurrentIndex((prev) =>
      prev === 0 ? videoExamples.length - 1 : prev - 1
    );
  };

  const handleNext = () => {
    setCurrentIndex((prev) =>
      prev === videoExamples.length - 1 ? 0 : prev + 1
    );
  };

  const handleUsePrompt = (prompt: string) => {
    // Navigate to video generation with the prompt as a query parameter
    navigate(`/video-generation?prompt=${encodeURIComponent(prompt)}`);
  };

  const handleCopyPrompt = async (prompt: string, id: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const currentExample = videoExamples[currentIndex];

  return (
    <div className="min-h-screen w-full bg-white dark:bg-black relative overflow-hidden">
      {/* Background Grid */}
      <div className="absolute inset-0 bg-grid-white/[0.2] dark:bg-grid-white/[0.2] bg-grid-black/[0.2]" />

      {/* Gradient Overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.3) 100%)",
        }}
      />

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20">
        {/* Container with background */}
        <div className="bg-white/80 dark:bg-black/80 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8 lg:p-12">
          {/* Hero Section */}
          <div className="text-center mb-12 sm:mb-16">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-4">
              Wan2.2-T2V-A14B-Diffusers
            </h1>
            <p className="text-xl sm:text-2xl text-[#7C68FA] font-semibold mb-6">
              Video Generation
            </p>
            <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 max-w-3xl mx-auto mb-8">
              Experience cutting-edge AI video generation with professional
              cinematic storytelling, precise motion control, and exceptional
              instruction following capabilities.
            </p>
            <Button
              onClick={handleStartGenerating}
              className="bg-[#7C68FA] hover:bg-[#6C54E8] text-white px-8 py-6 text-lg font-semibold rounded-lg shadow-lg transition-all duration-200"
            >
              <Video className="mr-2 h-5 w-5" />
              Start Generating Videos
            </Button>
          </div>

          {/* Examples - Carousel View */}
          <div className="mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-8 text-center">
              Example Capabilities
            </h2>

            {/* Single Example Card with Navigation */}
            <div className="max-w-4xl mx-auto">
              <Card
                className="overflow-hidden bg-white dark:bg-[#1a1e24] border-gray-200 dark:border-[#7C68FA]/20 shadow-2xl"
                onMouseEnter={() => setHoveredId(currentExample.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Video Placeholder */}
                <div className="relative aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-[#2a2e34] dark:to-[#1a1e24] flex items-center justify-center overflow-hidden">
                  {/* Placeholder Icon */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div
                      className={`transition-all duration-300 ${
                        hoveredId === currentExample.id
                          ? "scale-110 opacity-80"
                          : "scale-100 opacity-60"
                      }`}
                    >
                      <Play className="h-20 w-20 text-[#7C68FA]" />
                    </div>
                    <p className="mt-4 text-base text-gray-500 dark:text-gray-400 font-medium">
                      Video Placeholder
                    </p>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                      Drag and drop video here
                    </p>
                  </div>

                  {/* Hover Overlay */}
                  {hoveredId === currentExample.id && (
                    <div className="absolute inset-0 bg-[#7C68FA]/10 backdrop-blur-[2px] transition-opacity duration-300" />
                  )}

                  {/* Category Badge */}
                  <div className="absolute top-4 left-4 z-10">
                    <span className="bg-[#7C68FA] text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg">
                      {currentExample.category}
                    </span>
                  </div>

                  {/* Navigation Arrows */}
                  <button
                    onClick={handlePrevious}
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-white/90 dark:bg-black/90 hover:bg-white dark:hover:bg-black p-3 rounded-full shadow-lg transition-all duration-200 hover:scale-110"
                    aria-label="Previous example"
                  >
                    <ChevronLeft className="h-6 w-6 text-gray-800 dark:text-white" />
                  </button>
                  <button
                    onClick={handleNext}
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-white/90 dark:bg-black/90 hover:bg-white dark:hover:bg-black p-3 rounded-full shadow-lg transition-all duration-200 hover:scale-110"
                    aria-label="Next example"
                  >
                    <ChevronRight className="h-6 w-6 text-gray-800 dark:text-white" />
                  </button>

                  {/* Progress Indicator */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                    {videoExamples.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setCurrentIndex(index)}
                        className={`w-2 h-2 rounded-full transition-all duration-300 ${
                          index === currentIndex
                            ? "bg-[#7C68FA] w-8"
                            : "bg-gray-400 dark:bg-gray-600 hover:bg-gray-500"
                        }`}
                        aria-label={`Go to example ${index + 1}`}
                      />
                    ))}
                  </div>
                </div>

                {/* Prompt Section */}
                <div className="p-6 sm:p-8">
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-base font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      Prompt
                    </h3>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {currentIndex + 1} of {videoExamples.length}
                    </span>
                  </div>
                  <p className="text-base sm:text-lg text-gray-700 dark:text-gray-300 leading-relaxed mb-6">
                    {currentExample.prompt}
                  </p>

                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      onClick={() => handleUsePrompt(currentExample.prompt)}
                      className="flex-1 bg-[#7C68FA] hover:bg-[#6C54E8] text-white py-3 rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg"
                    >
                      <Video className="mr-2 h-4 w-4" />
                      Use this prompt
                    </Button>
                    <Button
                      onClick={() =>
                        handleCopyPrompt(
                          currentExample.prompt,
                          currentExample.id
                        )
                      }
                      variant="outline"
                      className="sm:w-auto border-[#7C68FA] text-[#7C68FA] hover:bg-[#7C68FA]/10 py-3 rounded-lg font-semibold transition-all duration-200"
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      {copiedId === currentExample.id ? "Copied!" : "Copy"}
                    </Button>
                  </div>

                  {/* Navigation Buttons */}
                  <div className="flex justify-between mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                    <Button
                      onClick={handlePrevious}
                      variant="ghost"
                      className="text-gray-600 dark:text-gray-300 hover:text-[#7C68FA] dark:hover:text-[#7C68FA]"
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      onClick={handleNext}
                      variant="ghost"
                      className="text-gray-600 dark:text-gray-300 hover:text-[#7C68FA] dark:hover:text-[#7C68FA]"
                    >
                      Next
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* Bottom CTA */}
          <div className="text-center pt-8 border-t border-gray-200 dark:border-gray-800">
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Ready to create your own videos with AI?
            </p>
            <Button
              onClick={handleStartGenerating}
              size="lg"
              className="bg-[#7C68FA] hover:bg-[#6C54E8] text-white px-10 py-6 text-lg font-semibold rounded-lg shadow-lg transition-all duration-200"
            >
              <Video className="mr-2 h-5 w-5" />
              Start Generating
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
