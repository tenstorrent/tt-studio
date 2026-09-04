// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Joyride,
  type Step,
  type EventData,
  STATUS,
  ACTIONS,
  EVENTS,
  type PartialDeep,
  type Styles,
} from "react-joyride";
import { TourContext, type TourContextState } from "../contexts/TourContext";
import {
  DEFAULT_TOUR_ID,
  getTourById,
  TOUR_REGISTRY,
} from "../components/tour/tourRegistry";
import { safeGetItem, safeSetItem } from "../lib/storage";
import { useTheme } from "../hooks/useTheme";

export interface TourProviderProps {
  children: React.ReactNode;
}

export function TourProvider({ children }: TourProviderProps) {
  const { theme } = useTheme();
  const [run, setRun] = useState<boolean>(false);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>(
    () => TOUR_REGISTRY[DEFAULT_TOUR_ID]?.steps ?? []
  );

  // Auto-start onboarding tour on first visit if not previously completed
  useEffect(() => {
    const completed = safeGetItem<boolean>(
      `tourCompleted:${DEFAULT_TOUR_ID}`,
      false
    );
    if (!completed) {
      const timer = setTimeout(() => {
        const tour = getTourById(DEFAULT_TOUR_ID);
        if (tour) {
          setSteps(tour.steps);
          setActiveTourId(DEFAULT_TOUR_ID);
          setStepIndex(0);
          setRun(true);
        }
      }, 700);
      return () => clearTimeout(timer);
    }
  }, []);

  const isDark = useMemo(() => {
    if (theme === "dark") return true;
    if (theme === "light") return false;
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return true;
  }, [theme]);

  const joyrideStyles: PartialDeep<Styles> = useMemo(
    () => ({
      tooltip: {
        borderRadius: "16px",
        padding: "16px 20px",
        boxShadow: isDark
          ? "0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.6)"
          : "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
        border: isDark ? "1px solid #27272a" : "1px solid #e4e4e7",
      },
      tooltipTitle: {
        fontSize: "16px",
        fontWeight: 600,
        fontFamily: "Inter, sans-serif",
        paddingBottom: "6px",
        color: isDark ? "#ffffff" : "#18181b",
      },
      tooltipContent: {
        fontSize: "14px",
        lineHeight: "1.5",
        fontFamily: "Inter, sans-serif",
        color: isDark ? "#d4d4d8" : "#3f3f46",
        padding: "4px 0 12px",
      },
      buttonPrimary: {
        backgroundColor: "#7C68FA",
        borderRadius: "8px",
        color: "#ffffff",
        fontSize: "13px",
        fontWeight: 500,
        padding: "8px 16px",
        outline: "none",
      },
      buttonBack: {
        color: isDark ? "#a1a1aa" : "#71717a",
        fontSize: "13px",
        fontWeight: 500,
        marginRight: "10px",
      },
      buttonSkip: {
        color: isDark ? "#71717a" : "#a1a1aa",
        fontSize: "13px",
      },
    }),
    [isDark]
  );

  const handleJoyrideEvent = useCallback(
    (data: EventData) => {
      const { status, type, index, action } = data;
      const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

      if (finishedStatuses.includes(status)) {
        setRun(false);
        setStepIndex(0);
        if (activeTourId) {
          safeSetItem(`tourCompleted:${activeTourId}`, true);
        }
      } else if (action === ACTIONS.CLOSE) {
        setRun(false);
        setStepIndex(0);
      } else if (type === EVENTS.STEP_AFTER) {
        setStepIndex(index + (action === ACTIONS.PREV ? -1 : 1));
      } else if (type === EVENTS.TARGET_NOT_FOUND) {
        if (index >= steps.length - 1) {
          setRun(false);
          setStepIndex(0);
        } else {
          setStepIndex(index + 1);
        }
      }
    },
    [activeTourId, steps.length]
  );

  const startTour = useCallback(
    (tourId: string = DEFAULT_TOUR_ID, initialStepIndex = 0) => {
      const tour = getTourById(tourId);
      if (tour) {
        setSteps(tour.steps);
        setActiveTourId(tour.id);
        setStepIndex(initialStepIndex);
        setRun(true);
      }
    },
    []
  );

  const stopTour = useCallback(() => {
    setRun(false);
    setStepIndex(0);
  }, []);

  const isTourCompleted = useCallback(
    (tourId: string = DEFAULT_TOUR_ID): boolean => {
      return safeGetItem<boolean>(`tourCompleted:${tourId}`, false);
    },
    []
  );

  const resetTour = useCallback((tourId: string = DEFAULT_TOUR_ID) => {
    safeSetItem(`tourCompleted:${tourId}`, false);
  }, []);

  const value = useMemo<TourContextState>(
    () => ({
      run,
      stepIndex,
      activeTourId,
      steps,
      startTour,
      stopTour,
      setStepIndex,
      isTourCompleted,
      resetTour,
    }),
    [
      run,
      stepIndex,
      activeTourId,
      steps,
      startTour,
      stopTour,
      isTourCompleted,
      resetTour,
    ]
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <Joyride
        steps={steps}
        run={run}
        continuous={true}
        showProgress={true}
        showSkipButton={true}
        stepIndex={stepIndex}
        onEvent={handleJoyrideEvent}
        styles={joyrideStyles}
        options={{
          buttons: ["back", "primary", "skip"],
          skipBeacon: true,
          arrowColor: isDark ? "#18181b" : "#ffffff",
          backgroundColor: isDark ? "#18181b" : "#ffffff",
          overlayColor: isDark ? "rgba(0, 0, 0, 0.75)" : "rgba(0, 0, 0, 0.45)",
          primaryColor: "#7C68FA",
          textColor: isDark ? "#f4f4f5" : "#18181b",
          zIndex: 10000,
          spotlightRadius: 12,
        }}
        locale={{
          back: "Back",
          last: "Done",
          next: "Next",
          nextWithProgress: "Next ({current}/{total})",
          skip: "Skip",
        }}
      />
    </TourContext.Provider>
  );
}
