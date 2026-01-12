// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cn } from "./utils";

/**
 * Theme-aware utility functions for consistent styling across the application.
 */

export function themeClass(
  light: string,
  dark: string,
  additional?: string
): string {
  return cn(light, `dark:${dark}`, additional);
}

// ============================================================================
// Background Utilities
// ============================================================================

/**
 * Returns theme-aware surface background classes
 * Light mode: white background
 * Dark mode: dark gray background
 */
export function bgSurface(additional?: string): string {
  return themeClass("bg-surface-light", "bg-surface-dark", additional);
}

/**
 * Returns theme-aware primary background classes
 */
export function bgPrimary(additional?: string): string {
  return themeClass("bg-white", "bg-gray-100", additional);
}

/**
 * Returns theme-aware secondary background classes
 */
export function bgSecondary(additional?: string): string {
  return themeClass("bg-gray-100", "bg-gray-200", additional);
}

/**
 * Returns theme-aware card background classes
 */
export function bgCard(additional?: string): string {
  return cn("bg-card", additional);
}

/**
 * Returns theme-aware muted background classes
 */
export function bgMuted(additional?: string): string {
  return cn("bg-muted", additional);
}

/**
 * Returns theme-aware accent background classes
 */
export function bgAccent(additional?: string): string {
  return cn("bg-accent", additional);
}

/**
 * Returns theme-aware popover background classes
 */
export function bgPopover(additional?: string): string {
  return cn("bg-popover", additional);
}

// ============================================================================
// Text/Foreground Utilities
// ============================================================================

/**
 * Returns theme-aware primary text color classes
 */
export function textPrimary(additional?: string): string {
  return cn("text-foreground", additional);
}

/**
 * Returns theme-aware secondary text color classes
 */
export function textSecondary(additional?: string): string {
  return cn("text-muted-foreground", additional);
}

/**
 * Returns theme-aware muted text color classes
 */
export function textMuted(additional?: string): string {
  return cn("text-muted-foreground", additional);
}

/**
 * Returns theme-aware card text color classes
 */
export function textCard(additional?: string): string {
  return cn("text-card-foreground", additional);
}

/**
 * Returns theme-aware accent text color classes
 */
export function textAccent(additional?: string): string {
  return cn("text-accent-foreground", additional);
}

/**
 * Returns theme-aware destructive text color classes
 */
export function textDestructive(additional?: string): string {
  return cn("text-destructive-foreground", additional);
}

// ============================================================================
// Border Utilities
// ============================================================================

/**
 * Returns theme-aware border classes
 */
export function borderDefault(additional?: string): string {
  return cn("border-border", additional);
}

/**
 * Returns theme-aware input border classes
 */
export function borderInput(additional?: string): string {
  return cn("border-input", additional);
}

/**
 * Returns theme-aware muted border classes
 */
export function borderMuted(additional?: string): string {
  return themeClass("border-gray-200", "border-gray-100", additional);
}

// ============================================================================
// Ring/Focus Utilities
// ============================================================================

/**
 * Returns theme-aware focus ring classes
 */
export function ringFocus(additional?: string): string {
  return cn("ring-ring focus-visible:ring-2", additional);
}

/**
 * Returns theme-aware ring offset classes
 */
export function ringOffset(additional?: string): string {
  return cn("ring-offset-background", additional);
}

// ============================================================================
// Shadow Utilities
// ============================================================================

/**
 * Returns theme-aware neumorphic shadow classes
 */
export function shadowNeu(additional?: string): string {
  return cn("neu", additional);
}

/**
 * Returns theme-aware inset neumorphic shadow classes
 */
export function shadowNeuInset(additional?: string): string {
  return cn("neu-inset", additional);
}

// ============================================================================
// Component-Specific Utilities
// ============================================================================

/**
 * Returns theme-aware sidebar background classes
 */
export function bgSidebar(additional?: string): string {
  return cn("bg-sidebar-background", additional);
}

/**
 * Returns theme-aware sidebar text classes
 */
export function textSidebar(additional?: string): string {
  return cn("text-sidebar-foreground", additional);
}

/**
 * Returns theme-aware sidebar accent background classes
 */
export function bgSidebarAccent(additional?: string): string {
  return cn("bg-sidebar-accent", additional);
}

/**
 * Returns theme-aware sidebar border classes
 */
export function borderSidebar(additional?: string): string {
  return cn("border-sidebar-border", additional);
}

/**
 * Returns theme-aware button classes
 * @param variant - Button variant ('default' | 'outline' | 'ghost' | 'destructive')
 */
export function buttonVariant(
  variant: "default" | "outline" | "ghost" | "destructive" = "default",
  additional?: string
): string {
  const variants = {
    default: cn("bg-primary text-primary-foreground hover:bg-primary/90"),
    outline: cn(
      "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
    ),
    ghost: cn("hover:bg-accent hover:text-accent-foreground"),
    destructive: cn(
      "bg-destructive text-destructive-foreground hover:bg-destructive/90"
    ),
  };

  return cn(variants[variant], additional);
}

/**
 * Returns theme-aware input classes
 */
export function inputDefault(additional?: string): string {
  return cn(
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2",
    "text-sm ring-offset-background",
    "file:border-0 file:bg-transparent file:text-sm file:font-medium",
    "placeholder:text-muted-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-50",
    additional
  );
}

/**
 * Returns theme-aware card container classes
 */
export function cardContainer(additional?: string): string {
  return cn(
    "rounded-lg border bg-card text-card-foreground shadow-sm",
    additional
  );
}

/**
 * Returns theme-aware dialog/modal overlay classes
 */
export function dialogOverlay(additional?: string): string {
  return themeClass(
    "bg-black/50",
    "bg-black/80",
    additional
  );
}

/**
 * Returns theme-aware dialog/modal content classes
 */
export function dialogContent(additional?: string): string {
  return cn(
    "bg-background border border-border rounded-lg shadow-lg",
    additional
  );
}

// ============================================================================
// Tenstorrent Brand Color Utilities
// ============================================================================

/**
 * Returns Tenstorrent purple background classes
 * @param shade - Color shade ('DEFAULT' | 'accent' | 'tint1' | 'tint2' | 'shade')
 */
export function bgTTPurple(
  shade: "DEFAULT" | "accent" | "tint1" | "tint2" | "shade" = "DEFAULT",
  additional?: string
): string {
  const shadeClass = shade === "DEFAULT" ? "bg-TT-purple" : `bg-TT-purple-${shade}`;
  return cn(shadeClass, additional);
}

/**
 * Returns Tenstorrent red background classes
 * @param shade - Color shade ('DEFAULT' | 'accent' | 'tint1' | 'tint2' | 'shade')
 */
export function bgTTRed(
  shade: "DEFAULT" | "accent" | "tint1" | "tint2" | "shade" = "DEFAULT",
  additional?: string
): string {
  const shadeClass = shade === "DEFAULT" ? "bg-TT-red" : `bg-TT-red-${shade}`;
  return cn(shadeClass, additional);
}

/**
 * Returns Tenstorrent blue background classes
 * @param shade - Color shade ('DEFAULT' | 'accent' | 'tint1' | 'tint2' | 'shade')
 */
export function bgTTBlue(
  shade: "DEFAULT" | "accent" | "tint1" | "tint2" | "shade" = "DEFAULT",
  additional?: string
): string {
  const shadeClass = shade === "DEFAULT" ? "bg-TT-blue" : `bg-TT-blue-${shade}`;
  return cn(shadeClass, additional);
}

/**
 * Returns Tenstorrent yellow background classes
 * @param shade - Color shade ('DEFAULT' | 'accent' | 'tint1' | 'tint2' | 'shade')
 */
export function bgTTYellow(
  shade: "DEFAULT" | "accent" | "tint1" | "tint2" | "shade" = "DEFAULT",
  additional?: string
): string {
  const shadeClass = shade === "DEFAULT" ? "bg-TT-yellow" : `bg-TT-yellow-${shade}`;
  return cn(shadeClass, additional);
}

/**
 * Returns Tenstorrent teal background classes
 * @param shade - Color shade ('DEFAULT' | 'accent' | 'tint1' | 'tint2' | 'shade')
 */
export function bgTTTeal(
  shade: "DEFAULT" | "accent" | "tint1" | "tint2" | "shade" = "DEFAULT",
  additional?: string
): string {
  const shadeClass = shade === "DEFAULT" ? "bg-TT-teal" : `bg-TT-teal-${shade}`;
  return cn(shadeClass, additional);
}

/**
 * Returns Tenstorrent green background classes
 * @param shade - Color shade ('DEFAULT' | 'accent' | 'tint1' | 'tint2' | 'shade')
 */
export function bgTTGreen(
  shade: "DEFAULT" | "accent" | "tint1" | "tint2" | "shade" = "DEFAULT",
  additional?: string
): string {
  const shadeClass = shade === "DEFAULT" ? "bg-TT-green" : `bg-TT-green-${shade}`;
  return cn(shadeClass, additional);
}

/**
 * Returns Tenstorrent sand background classes
 * @param shade - Color shade ('DEFAULT' | 'accent' | 'tint1' | 'tint2' | 'shade')
 */
export function bgTTSand(
  shade: "DEFAULT" | "accent" | "tint1" | "tint2" | "shade" = "DEFAULT",
  additional?: string
): string {
  const shadeClass = shade === "DEFAULT" ? "bg-TT-sand" : `bg-TT-sand-${shade}`;
  return cn(shadeClass, additional);
}

/**
 * Returns Tenstorrent slate background classes
 * @param shade - Color shade ('DEFAULT' | 'accent' | 'tint1' | 'tint2' | 'shade')
 */
export function bgTTSlate(
  shade: "DEFAULT" | "accent" | "tint1" | "tint2" | "shade" = "DEFAULT",
  additional?: string
): string {
  const shadeClass = shade === "DEFAULT" ? "bg-TT-slate" : `bg-TT-slate-${shade}`;
  return cn(shadeClass, additional);
}

// Text color variants for TT brand colors
/**
 * Returns Tenstorrent purple text classes
 */
export function textTTPurple(
  shade: "DEFAULT" | "accent" | "tint1" | "tint2" | "shade" = "DEFAULT",
  additional?: string
): string {
  const shadeClass = shade === "DEFAULT" ? "text-TT-purple" : `text-TT-purple-${shade}`;
  return cn(shadeClass, additional);
}

/**
 * Returns Tenstorrent blue text classes
 */
export function textTTBlue(
  shade: "DEFAULT" | "accent" | "tint1" | "tint2" | "shade" = "DEFAULT",
  additional?: string
): string {
  const shadeClass = shade === "DEFAULT" ? "text-TT-blue" : `text-TT-blue-${shade}`;
  return cn(shadeClass, additional);
}

// ============================================================================
// Grid Pattern Utilities
// ============================================================================

/**
 * Returns theme-aware grid background pattern
 */
export function bgGridPattern(additional?: string): string {
  return cn("bg-grid-pattern", additional);
}

/**
 * Returns theme-aware dark grid background pattern
 */
export function bgGridPatternDark(additional?: string): string {
  return cn("bg-grid-pattern-dark", additional);
}

// ============================================================================
// Composite Utilities (Common Patterns)
// ============================================================================

/**
 * Returns a complete set of classes for a typical card component
 */
export function cardBase(additional?: string): string {
  return cn(
    cardContainer(),
    "p-6",
    additional
  );
}

/**
 * Returns a complete set of classes for a typical form field
 */
export function formField(additional?: string): string {
  return cn(
    "space-y-2",
    additional
  );
}

/**
 * Returns a complete set of classes for a typical label
 */
export function formLabel(additional?: string): string {
  return cn(
    "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
    additional
  );
}

/**
 * Returns a complete set of classes for a section container
 */
export function sectionContainer(additional?: string): string {
  return cn(
    bgSurface(),
    "rounded-lg p-6 shadow-sm",
    additional
  );
}

/**
 * Returns a complete set of classes for a hover-interactive element
 */
export function hoverInteractive(additional?: string): string {
  return cn(
    "transition-colors duration-200",
    "hover:bg-accent hover:text-accent-foreground",
    "cursor-pointer",
    additional
  );
}

/**
 * Returns a complete set of classes for disabled state
 */
export function disabledState(additional?: string): string {
  return cn(
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
    additional
  );
}