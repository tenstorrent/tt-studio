// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export async function fetchDeviceTelemetry() {
  try {
    const res = await fetch("/board-api/telemetry/");
    const json = await res.json();
    if (res.ok) return json as TelemetryResponse;
    throw new Error(json.error || "Failed to fetch telemetry data.");
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Failed to fetch telemetry data.";
    console.error(message);
    return null;
  }
}

/**
 * Types for the JSON returned by `GET /board-api/telemetry/`
 * (backend: `board_control.views.DeviceTelemetryView`).
 *
 * The endpoint does no reshaping: it returns the raw output of `tt-smi -s`
 * (via `SystemResourceService.get_tt_smi_data()`), so these types describe the
 * tt-smi snapshot, not a TT Studio-defined schema.
 *
 * Verified against:
 *  - real `tt-smi -s` output from a Wormhole n300 (two chips), and
 *  - the tt-smi v6.7.0 source (`tt_smi/backend.py`, `utils.py`, `constants.py`,
 *    `tests/test_snapshot.py`) and tt-tools-common v1.6.0 (`get_host_info`).
 *    Both Wormhole and Blackhole code paths were read, but Blackhole output
 *    has not been seen on real hardware.
 *
 * Do NOT use tt-smi's `tt_smi/log.py` pydantic models as a reference: every
 * field there is optional, and the per-device dicts are assigned past
 * validation, so the declared types disagree with real output (e.g. it says
 * `dram_status: str`, but the output is a boolean).
 *
 * Which fields are required depends on the tt-smi version. TT Studio's backend
 * image (`app/backend/Dockerfile`) installs tt-smi v4.1.2, while newer hosts
 * emit more (verified here for v6.7.0). Fields present in both versions are
 * required: tt-smi builds each section from a fixed key list, and its own
 * snapshot tests assert their presence on every device. Fields added after
 * v4.1.2 are optional and marked "Absent in tt-smi 4.1.2" (checked in the
 * v4.1.2 source, not on real hardware):
 * `gddr_telemetry`, `processes`, `telemetry.board_power`,
 * `limits.fan_rpm_limit`, `limits.board_power_limit`, `firmwares.gddr_fw`.
 * Other versions have not been checked.
 */

/**
 * A number that tt-smi encodes as a string, from Python format specs like
 * `f"{x:5.1f}"`.
 *
 * Values can be left-padded (`" 21.0"`, `" 500"`, `" 85"`) and are `"N/A"`
 * when the reading is unavailable. `Number(value)` trims the padding and
 * yields `NaN` for `"N/A"`, so check `Number.isNaN()` before using the result.
 */
export type TtSmiNumericString = string;

/**
 * A limit value: a numeric string when the register is available, otherwise
 * the integer `0` (tt-smi's fallback when the register is missing or the ARC
 * firmware isn't running). Note `0` is a number here, not the string `"0"`.
 */
export type TtSmiLimitValue = TtSmiNumericString | 0;

/**
 * A raw hardware register value rendered as a hex string (e.g. `"0x2fe88"`),
 * or `null` when the register is not populated.
 */
export type TtSmiRegisterValue = string | null;

/** Host machine details (from tt-tools-common). All values are strings. */
export interface TtSmiHostInfo {
  OS: string;
  Distro: string;
  Kernel: string;
  Hostname: string;
  /** CPU architecture, e.g. `"x86_64"`. */
  Platform: string;
  /** Python version running tt-smi, e.g. `"3.10.21"`. */
  Python: string;
  /** Total host memory with units, e.g. `"47.14 GB"`. */
  Memory: string;
  /** TT-KMD driver version, always prefixed, e.g. `"TT-KMD 2.11.1-pre"`. */
  Driver: string;
}

/** Versions of the Tenstorrent software stack that produced the snapshot. */
export interface TtSmiHostSwVersions {
  tt_smi: string;
  pyluwen: string;
  tt_umd: string;
}

/** Static board identity and link information for one device. */
export interface TtSmiBoardInfo {
  /**
   * PCIe bus address, e.g. `"0000:04:00.0"`. `"N/A"` for a remote chip, which
   * is reached over ethernet through its local partner rather than over PCIe.
   */
  bus_id: string;
  /**
   * Board model, e.g. `"n300"`, `"n150"`, `"p150a"`, `"p300c"`, `"wh_4u"`,
   * `"tt-galaxy-wh"`, `"tt-galaxy-bh"`; `"N/A"` if the board id is not
   * recognised. On **Wormhole only**, tt-smi appends `" L"` (local,
   * PCIe-attached chip) or `" R"` (remote chip), e.g. `"n300 L"`. Blackhole
   * boards have no suffix.
   */
  board_type: string;
  /** Board serial id as 16 hex characters, e.g. `"010001461190506e"`. */
  board_id: string;
  /**
   * Wormhole: mesh coordinates `"(x, y, rack, shelf)"`, e.g. `"(0, 0, 0, 0)"`.
   * Any other architecture (Blackhole): `"N/A"`.
   */
  coords: string;
  /** `true` if DRAM training passed; `false` if it failed or never ran. */
  dram_status: boolean;
  /**
   * DRAM speed, e.g. `"12G"`. Blackhole reports a bare MHz number string
   * instead when the speed is not a whole number of GHz. `"N/A"` if
   * unavailable, and `null` on Wormhole when the firmware reports an
   * unrecognised speed code.
   */
  dram_speed: string | null;
  /** PCIe link generation (1-5, e.g. `4`), or `"N/A"` for a remote chip. */
  pcie_speed: number | "N/A";
  /** PCIe link width as a string (e.g. `"16"`), or `"N/A"` for a remote chip. */
  pcie_width: string;
}

/**
 * Live telemetry readings for one device. All values are strings.
 *
 * tt-smi falls back to an empty object for a chip that is neither Wormhole nor
 * Blackhole; that case is not modelled here.
 */
export interface TtSmiDeviceTelemetry {
  /**
   * Core voltage (V), e.g. `"0.80"`. Reads `"10000.00"` when tt-smi cannot get
   * the voltage register (a sentinel, not a real reading).
   */
  voltage: TtSmiNumericString;
  /** Current draw (A), e.g. `" 21.0"`. */
  current: TtSmiNumericString;
  /** Power draw (W), e.g. `" 17.0"`. */
  power: TtSmiNumericString;
  /**
   * Whole-board input power (W); `"N/A"` if the firmware doesn't report it.
   * Absent in tt-smi 4.1.2.
   */
  board_power?: TtSmiNumericString;
  /** AI clock (MHz), e.g. `" 500"`. */
  aiclk: TtSmiNumericString;
  /** ASIC temperature (°C), e.g. `"43.1"`. */
  asic_temperature: TtSmiNumericString;
  /**
   * Raw fan speed value (the low 16 bits of the fan register). `"65535"`
   * (all ones) appeared on the n300 sample, which most likely means "no
   * reading"; tt-smi's source does not say so explicitly. tt-smi 4.1.2
   * formats it with a minimum width of 3, so it may be left-padded.
   */
  fan_speed: TtSmiNumericString;
  /**
   * Firmware watchdog heartbeat counter, about 2 per second while the device
   * is alive. Per the tt-smi changelog, a heartbeat that stops advancing means
   * telemetry is no longer being refreshed.
   */
  heartbeat: TtSmiNumericString;
}

/** Health of one GDDR channel. */
export interface TtSmiGddrChannel {
  channel: number;
  /** Channel is harvested (fused off) or disabled; always `false` on Wormhole. */
  harvested: boolean;
  enabled: boolean;
  /** Training result; `"n/a"` when the status register isn't available. */
  training: "pass" | "fail" | "n/a";
  /**
   * Built-in self test result. Always `"n/a"` on Wormhole, and on Blackhole
   * firmware too old to report BIST.
   */
  bist: "pass" | "fail" | "n/a";
  /*
   * The fields below are decimal integer strings when populated (Blackhole
   * only, enabled channels) and `"N/A"` otherwise. Wormhole always reports
   * `"N/A"`.
   */
  temp_top: TtSmiNumericString;
  temp_bottom: TtSmiNumericString;
  /** Correctable read errors. */
  corr_rd: TtSmiNumericString;
  /** Correctable write errors. */
  corr_wr: TtSmiNumericString;
  /** Uncorrectable read errors. */
  uncorr_rd: TtSmiNumericString;
  /** Uncorrectable write errors. */
  uncorr_wr: TtSmiNumericString;
}

/** GDDR memory telemetry for one device. */
export interface TtSmiGddrTelemetry {
  /** e.g. `"12G"`; `"N/A"` if unavailable. */
  speed: string;
  /** Maximum GDDR temperature (°C) as a decimal string; `"N/A"` on Wormhole. */
  max_temp: TtSmiNumericString;
  /** Enabled-channel bitmask as a hex string (e.g. `"0xff"`); `"N/A"` on Wormhole. */
  enabled_mask: string;
  /** 6 entries on Wormhole, 8 on Blackhole. */
  channels: TtSmiGddrChannel[];
}

/** Firmware versions for one device. All values are strings; `"N/A"` if unavailable. */
export interface TtSmiFirmwares {
  /** Semver-style, e.g. `"18.10.0.0"`. */
  fw_bundle_version: string;
  /** Semver-style; `"N/A"` on Galaxy (`wh_4u`) boards. */
  tt_flash_version: string;
  cm_fw: string;
  /** Date as `YYYY-MM-DD`, e.g. `"2025-07-22"`. */
  cm_fw_date: string;
  eth_fw: string;
  dm_bl_fw: string;
  dm_app_fw: string;
  /**
   * Always `"N/A"` on Wormhole; Blackhole only when tt-umd exposes it.
   * Absent in tt-smi 4.1.2.
   */
  gddr_fw?: string;
}

/**
 * Operating limits for one device. Each is a numeric string (often padded,
 * e.g. `" 85"`) when its register is available, otherwise the integer `0`.
 *
 * `bus_peak_limit` and `fan_rpm_limit` are never populated by tt-smi 6.7.0,
 * so they are always `0`. `board_power_limit` is `0` unless the board reports
 * a `BOARD_POWER_LIMIT` register (not the case on the n300 sample).
 *
 * tt-smi 4.1.2 emits only the first eight keys: `fan_rpm_limit` and
 * `board_power_limit` are absent there.
 */
export interface TtSmiDeviceLimits {
  vdd_min: TtSmiLimitValue;
  vdd_max: TtSmiLimitValue;
  /** Thermal design power limit (W). */
  tdp_limit: TtSmiLimitValue;
  /** Thermal design current limit (A). */
  tdc_limit: TtSmiLimitValue;
  /** Maximum AI clock (MHz). */
  asic_fmax: TtSmiLimitValue;
  /** Thermal throttle threshold (°C). */
  therm_trip_l1_limit: TtSmiLimitValue;
  /** Thermal limit (°C). */
  thm_limit: TtSmiLimitValue;
  bus_peak_limit: TtSmiLimitValue;
  /** Absent in tt-smi 4.1.2. */
  fan_rpm_limit?: TtSmiLimitValue;
  /** Absent in tt-smi 4.1.2. */
  board_power_limit?: TtSmiLimitValue;
}

/**
 * One entry of `device_info`: a single chip. A multi-chip card (e.g. n300) is
 * reported as one entry per chip.
 */
export interface TtSmiDevice {
  /**
   * Raw SMBus telemetry registers keyed by UPPER_SNAKE_CASE register name
   * (e.g. `"ASIC_TEMPERATURE"`, `"AICLK"`) with hex-string values. The key set
   * differs between Wormhole and Blackhole and across firmware, so it is left
   * open.
   */
  smbus_telem: Record<string, TtSmiRegisterValue>;
  board_info: TtSmiBoardInfo;
  telemetry: TtSmiDeviceTelemetry;
  /** Absent in tt-smi 4.1.2. */
  gddr_telemetry?: TtSmiGddrTelemetry;
  firmwares: TtSmiFirmwares;
  limits: TtSmiDeviceLimits;
}

/** A process currently holding a device open, as seen by tt-smi. */
export interface TtSmiProcess {
  pid: number;
  /** Username, or `"?"` if it could not be resolved. */
  user: string;
  /**
   * Kernel driver device number: the `N` in `/dev/tenstorrent/N` (read from
   * `/proc/driver/tenstorrent/N/pids`). This is NOT an index into
   * `device_info`: remote chips have no such node, so on a multi-chip card the
   * numbering does not line up with `device_info` positions.
   */
  device: number;
  /**
   * Command line with NUL/newline replaced by spaces and non-printable bytes
   * escaped as `\xNN`; `"?"` if it could not be read.
   */
  cmdline: string;
}

/**
 * 200 response body of `GET /board-api/telemetry/`: the raw `tt-smi -s` snapshot.
 *
 * `device_info` is ordered; the array index is the device index used elsewhere
 * in TT Studio (e.g. `/board-api/device-state/` -> `devices[].index`).
 *
 * Note that `processes` can include the `tt-smi -s` invocation that produced
 * this very snapshot, and is `[]` when no process (or no procfs entry) exists.
 * It is absent entirely in tt-smi 4.1.2.
 */
export interface TelemetryResponse {
  /**
   * Snapshot time as ISO-8601 with microseconds and NO timezone offset, e.g.
   * `"2026-10-08T20:24:38.946987"`. It is the host's local time, but
   * `new Date(time)` will interpret it in the browser's timezone.
   */
  time: string;
  host_info: TtSmiHostInfo;
  host_sw_vers: TtSmiHostSwVersions;
  device_info: TtSmiDevice[];
  /** Absent in tt-smi 4.1.2. */
  processes?: TtSmiProcess[];
}

/**
 * Error body returned by `GET /board-api/telemetry/`.
 *
 *  - 503: `tt-smi` produced no data (missing, no driver, timed out, failed, or
 *    the board is in a bad state). Body has only `error`. Failures are cached
 *    by the backend for 2-5 minutes, so retries may keep returning 503 until
 *    the cache expires or `POST /board-api/refresh-cache/` is called.
 *  - 500: unexpected exception. Body has `error` and `details`.
 */
export interface TelemetryErrorResponse {
  error: string;
  details?: string;
}
