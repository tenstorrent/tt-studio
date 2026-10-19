// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button } from "@tenstorrent/vesper/button";
import { Reset, Spinner } from "@tenstorrent/vesper/icons";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import { useBoardCards } from "@/src/hooks/useBoardCards";
import { useResetBoard } from "@/src/hooks/useResetBoard";
import { Card } from "./components/card";

export default function HomePage() {
  const resetBoard = useResetBoard();

  const { data, loading, refreshing, refresh } = useBoardCards();

  const cards = data?.cards ?? [];
  const hasMultipleCards = cards.length > 1;
  const loadingBoardCards = loading && !data;

  return (
    <div className="min-h-full flex items-center">
      <div className="w-full flex flex-col justify-center px-vesper-4 py-vesper-10 gap-vesper-12">
        <div className="shrink-0 w-full max-w-6xl mx-auto flex flex-col items-center">
          {loadingBoardCards ? (
            <Typography
              variant="label-sm-mono"
              className="text-vesper-text-secondary uppercase flex items-center gap-vesper-6"
            >
              <Spinner className="w-5 h-5 animate-spin" />
              <span>Detecting hardware</span>
            </Typography>
          ) : (
            <div
              className={cn(
                "grid grid-cols-1 gap-vesper-16 w-full",
                hasMultipleCards && "lg:grid-cols-2"
              )}
            >
              {cards.map((card, index) => (
                <Card
                  key={card.index}
                  card={card}
                  label={hasMultipleCards ? `Card ${index}` : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="fixed top-20 right-vesper-4 flex items-center gap-vesper-2">
        <Button
          variant="subtle"
          size="sm"
          iconLeft={
            resetBoard.state === "resetting"
              ? <Spinner className="animate-spin" />
              : <Reset />
          }
          onClick={() => void resetBoard.reset()}
          disabled={!resetBoard.canReset}
        >
          {resetBoard.state === "resetting" ? "Resetting..." : "Reset Board"}
        </Button>
        <Button
          variant="subtle"
          size="sm"
          iconLeft={
            refreshing ? <Spinner className="animate-spin" /> : <Reset />
          }
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? "Scanning..." : "Re-scan"}
        </Button>
      </div>
    </div>
  );
}
