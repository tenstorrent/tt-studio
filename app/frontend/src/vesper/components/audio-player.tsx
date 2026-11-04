// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from "react";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Download } from "@tenstorrent/vesper/icons";
import { Slider } from "@tenstorrent/vesper/slider";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4.5 2.8v10.4a.5.5 0 0 0 .76.43l8.4-5.2a.5.5 0 0 0 0-.86l-8.4-5.2a.5.5 0 0 0-.76.43Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.5" y="2.5" width="3" height="11" rx="0.75" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="0.75" />
    </svg>
  );
}

/** A compact audio player: play/pause, a seek slider, time and download. */
export function AudioPlayer({
  src,
  autoPlay = false,
  downloadName = "audio.wav",
  className,
  onEnded,
}: {
  src: string;
  autoPlay?: boolean;
  downloadName?: string;
  className?: string;
  onEnded?(): void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setTime(0);
    setPlaying(false);
    if (autoPlay) audioRef.current?.play().catch(() => undefined);
  }, [src, autoPlay]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => undefined);
    else audio.pause();
  };

  return (
    <div
      className={cn(
        "flex items-center gap-vesper-3 p-vesper-2 pr-vesper-3 rounded-vesper-2 border border-vesper-border-secondary bg-vesper-background-primary",
        className
      )}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          onEnded?.();
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
      />
      <IconButton
        type="button"
        size="sm"
        variant="subtle"
        icon={playing ? <PauseIcon /> : <PlayIcon />}
        aria-label={playing ? "Pause" : "Play"}
        onClick={toggle}
      />
      <Slider
        className="flex-1"
        min={0}
        max={Number.isFinite(duration) && duration > 0 ? duration : 1}
        step={0.01}
        value={time}
        thumbAriaLabel="Seek"
        onValueChange={(value) => {
          setTime(value);
          if (audioRef.current) audioRef.current.currentTime = value;
        }}
      />
      <Typography
        variant="label-xs-mono"
        className="tabular-nums text-vesper-text-secondary whitespace-nowrap"
      >
        {formatTime(time)} / {formatTime(duration)}
      </Typography>
      <IconButton
        as="a"
        href={src}
        download={downloadName}
        size="sm"
        variant="ghost"
        icon={<Download />}
        aria-label="Download audio"
      />
    </div>
  );
}
