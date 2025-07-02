import React from "react";
import { motion } from "framer-motion";
import { Button } from "../ui/button";
import { X, Thermometer, TextQuote, Shuffle, ListFilter, Info } from "lucide-react";
import { Slider } from "@/src/components/ui/slider";
import { Input } from "../ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  settings: {
    temperature: number;
    maxLength: number;
    topP: number;
    topK: number;
  };
  onSettingsChange: (key: string, value: number) => void;
}

// Parameter validation ranges
const PARAM_RANGES = {
  temperature: { min: 0.1, max: 1.0, step: 0.1 },
  maxLength: { min: 1, max: 2048, step: 1 },
  topP: { min: 0.1, max: 1.0, step: 0.1 },
  topK: { min: 1, max: 50, step: 1 },
};

// Default values
const DEFAULT_VALUES = {
  temperature: 1,
  maxLength: 512,
  topP: 0.9,
  topK: 20,
};

const validateParam = (key: string, value: number): number => {
  const range = PARAM_RANGES[key as keyof typeof PARAM_RANGES];
  if (!range) return DEFAULT_VALUES[key as keyof typeof DEFAULT_VALUES];

  // If value is zero or less than minimum, use default
  if (value <= 0) {
    console.warn(
      `Invalid ${key} value: ${value}. Using default: ${DEFAULT_VALUES[key as keyof typeof DEFAULT_VALUES]}`
    );
    return DEFAULT_VALUES[key as keyof typeof DEFAULT_VALUES];
  }

  // Clamp value within range
  const clamped = Math.max(range.min, Math.min(range.max, value));

  // Round to nearest step
  const steps = Math.round((clamped - range.min) / range.step);
  return range.min + steps * range.step;
};

interface ParameterProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  onChange: (value: string) => void;
  onBlur: () => void;
  min: number;
  max: number;
  step: number;
  tooltip: string;
  description: string;
}

const Parameter = ({
  label,
  value,
  icon,
  onChange,
  onBlur,
  min,
  max,
  step,
  tooltip,
  description,
}: ParameterProps) => (
  <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-md bg-[#7C68FA]/10 text-[#7C68FA]">{icon}</div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-gray-400 cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-20 h-8 text-right"
        min={min}
        max={max}
        step={step}
      />
    </div>
    <Slider
      value={[value]}
      onValueChange={(val: number[]) => onChange(val[0].toString())}
      min={min}
      max={max}
      step={step}
      className="[&_[role=slider]]:bg-[#7C68FA]"
    />
    <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
  </div>
);

export default function Settings({ isOpen, onClose, settings, onSettingsChange }: SettingsProps) {
  const handleInputChange = (key: string, value: string) => {
    const numValue = parseFloat(value);
    if (!value || isNaN(numValue) || numValue <= 0) {
      onSettingsChange(key, DEFAULT_VALUES[key as keyof typeof DEFAULT_VALUES]);
      return;
    }
    const validatedValue = validateParam(key, numValue);
    onSettingsChange(key, validatedValue);
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/50 z-40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Settings Panel */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: isOpen ? 0 : "100%" }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-[350px] bg-white dark:bg-[#1E1E1E] shadow-xl z-50 border-l border-gray-200 dark:border-[#7C68FA]/20"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-[#7C68FA]/20">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <ListFilter className="h-5 w-5 text-[#7C68FA]" />
              Model Parameters
            </h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Settings Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <Parameter
              label="Temperature"
              value={settings.temperature || DEFAULT_VALUES.temperature}
              icon={<Thermometer className="h-4 w-4" />}
              onChange={(value) => handleInputChange("temperature", value)}
              onBlur={() => {
                if (!settings.temperature || settings.temperature <= 0) {
                  onSettingsChange("temperature", DEFAULT_VALUES.temperature);
                }
              }}
              min={PARAM_RANGES.temperature.min}
              max={PARAM_RANGES.temperature.max}
              step={PARAM_RANGES.temperature.step}
              tooltip="Controls the randomness of the model's output"
              description="Lower values are more focused, higher values more creative"
            />

            <Parameter
              label="Maximum Length"
              value={settings.maxLength || DEFAULT_VALUES.maxLength}
              icon={<TextQuote className="h-4 w-4" />}
              onChange={(value) => handleInputChange("maxLength", value)}
              onBlur={() => {
                if (!settings.maxLength || settings.maxLength <= 0) {
                  onSettingsChange("maxLength", DEFAULT_VALUES.maxLength);
                }
              }}
              min={PARAM_RANGES.maxLength.min}
              max={PARAM_RANGES.maxLength.max}
              step={PARAM_RANGES.maxLength.step}
              tooltip="Sets the maximum length of the generated response"
              description="Maximum number of tokens to generate"
            />

            <Parameter
              label="Top P"
              value={settings.topP || DEFAULT_VALUES.topP}
              icon={<Shuffle className="h-4 w-4" />}
              onChange={(value) => handleInputChange("topP", value)}
              onBlur={() => {
                if (!settings.topP || settings.topP <= 0) {
                  onSettingsChange("topP", DEFAULT_VALUES.topP);
                }
              }}
              min={PARAM_RANGES.topP.min}
              max={PARAM_RANGES.topP.max}
              step={PARAM_RANGES.topP.step}
              tooltip="Controls the diversity of token selection"
              description="Nucleus sampling: Controls diversity of generated text"
            />

            <Parameter
              label="Top K"
              value={settings.topK || DEFAULT_VALUES.topK}
              icon={<ListFilter className="h-4 w-4" />}
              onChange={(value) => handleInputChange("topK", value)}
              onBlur={() => {
                if (!settings.topK || settings.topK <= 0) {
                  onSettingsChange("topK", DEFAULT_VALUES.topK);
                }
              }}
              min={PARAM_RANGES.topK.min}
              max={PARAM_RANGES.topK.max}
              step={PARAM_RANGES.topK.step}
              tooltip="Limits the vocabulary size for token selection"
              description="Limits vocabulary: Lower values make text more focused"
            />
          </div>
        </div>
      </motion.div>
    </>
  );
}
