// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import svgToDataUri from "mini-svg-data-uri";
import flattenColorPalette from "tailwindcss/lib/util/flattenColorPalette";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        TT: {
          purple: {
            DEFAULT: "#BCB3F7", // Primary Purple
            accent: "#7C68FA", // Tens Purple
            tint1: "#D0C6FF", // Purple Tint 1 (+)
            tint2: "#E2DEFC", // Purple Tint 2 (++)
            shade: "#4B456E", // Purple Shade (-)
          },
          red: {
            DEFAULT: "#FF9E8A", // Primary Red
            accent: "#FA512E", // Red Accent
            tint1: "#EAB1A5", // Red Tint 1 (+)
            tint2: "#F4D8D2", // Red Tint 2 (++)
            shade: "#BD2914", // Red Shade (-)
          },
          blue: {
            DEFAULT: "#7584E6", // Primary Blue
            accent: "#5164E0", // Blue Accent
            tint1: "#9CABF2", // Blue Tint 1 (+)
            tint2: "#CCD2F9", // Blue Tint 2 (++)
            shade: "#252C5B", // Blue Shade (-)
          },
          yellow: {
            DEFAULT: "#F6BC42", // Primary Yellow
            accent: "#C2A261", // Yellow Accent
            tint1: "#F9D08E", // Yellow Tint 1 (+)
            tint2: "#F5E2BA", // Yellow Tint 2 (++)
            shade: "#B87039", // Yellow Shade (-)
          },
          teal: {
            DEFAULT: "#74C5DF", // Primary Teal
            accent: "#3E87DE", // Teal Accent
            tint1: "#90DBF0", // Teal Tint 1 (+)
            tint2: "#C7F1FF", // Teal Tint 2 (++)
            shade: "#0D4D62", // Teal Shade (-)
          },
          green: {
            DEFAULT: "#6FABA0", // Primary Green
            accent: "#608C84", // Green Accent
            tint1: "#92C9BF", // Green Tint 1 (+)
            tint2: "#C7EFE8", // Green Tint 2 (++)
            shade: "#103525", // Green Shade (-)
          },
          sand: {
            DEFAULT: "#CDC2A6", // Primary Sand
            accent: "#A2987A", // Sand Accent
            tint1: "#E5D7B5", // Sand Tint 1 (+)
            tint2: "#EEEAE0", // Sand Tint 2 (++)
            shade: "#3A3433", // Sand Shade (-)
          },
          slate: {
            DEFAULT: "#737999", // Primary Slate
            accent: "#606891", // Slate Accent
            tint1: "#97DDBD", // Slate Tint 1 (+)
            tint2: "#EDEFF9", // Slate Tint 2 (++)
            shade: "#10163G", // Slate Shade (-)
          },
          black: "#202020", // Black
          white: "#FFFFFF", // White
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: `var(--radius)`,
        md: `calc(var(--radius) - 2px)`,
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "Roboto Mono",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
        ],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "sound-wave-1": {
          "0%, 100%": { height: "8px" },
          "50%": { height: "16px" },
        },
        "sound-wave-2": {
          "0%, 100%": { height: "12px" },
          "50%": { height: "24px" },
        },
        "sound-wave-3": {
          "0%, 100%": { height: "8px" },
          "50%": { height: "16px" },
        },
        "pulse-ripple-x": {
          "0%": { transform: "scaleX(0)", opacity: "1" },
          "100%": { transform: "scaleX(1)", opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "sound-wave-1": "sound-wave-1 0.8s infinite",
        "sound-wave-2": "sound-wave-2 0.8s infinite 0.2s",
        "sound-wave-3": "sound-wave-3 0.8s infinite 0.4s",
        "pulse-ripple-x": "pulse-ripple-x 1s ease-out infinite",
        ripple: "ripple 3s ease-out infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    addVariablesForColors,
    function ({ matchUtilities, theme }) {
      matchUtilities(
        {
          "bg-grid": (value) => ({
            backgroundImage: `url("${svgToDataUri(
              `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="${value}"><path d="M0 .5H31.5V32"/></svg>`
            )}")`,
          }),
          "bg-grid-small": (value) => ({
            backgroundImage: `url("${svgToDataUri(
              `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="8" height="8" fill="none" stroke="${value}"><path d="M0 .5H31.5V32"/></svg>`
            )}")`,
          }),
          "bg-dot": (value) => ({
            backgroundImage: `url("${svgToDataUri(
              `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16" fill="none"><circle fill="${value}" id="pattern-circle" cx="10" cy="10" r="1.6257413380501518"></circle></svg>`
            )}")`,
          }),
        },
        {
          values: flattenColorPalette(theme("backgroundColor")),
          type: "color",
        }
      );
    },
    require("daisyui"),
  ],
};

function addVariablesForColors({ addBase, theme }) {
  let allColors = flattenColorPalette(theme("colors"));
  let newVars = Object.fromEntries(
    Object.entries(allColors).map(([key, val]) => [`--${key}`, val])
  );

  addBase({
    ":root": newVars,
  });
}
