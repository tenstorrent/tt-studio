# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The Textual application behind `python run.py --status`.

Kept separate from tt_setup.monitor so that the non-TTY text fallback works even
when `textual` isn't installed (this module imports textual at module load).
"""

import os
import subprocess
import threading
import time
import webbrowser

from textual import work
from textual.app import App, ComposeResult
from textual.containers import Horizontal
from textual.widgets import DataTable, Footer, Header, RichLog
from rich.text import Text

from tt_setup.console import _fmt_duration
from tt_setup.monitor import SERVICES, _APP_DIR, _compose_base
from tt_setup.services import snapshot_health


class MonitorApp(App):
    """Live dashboard: services + health on the left, streaming logs on the right."""

    CSS = """
    #services { width: 38%; border-right: solid $primary; }
    #logs { width: 1fr; }
    DataTable { height: 1fr; }
    """

    BINDINGS = [
        ("up,k", "cursor_up", "Up"),
        ("down,j", "cursor_down", "Down"),
        ("r", "restart", "Restart"),
        ("o", "open", "Open"),
        ("l", "clear_log", "Clear log"),
        ("q", "quit", "Quit"),
    ]

    def __init__(self, dev_mode=False):
        super().__init__()
        self.dev_mode = dev_mode
        self._compose = _compose_base(dev_mode)
        self._up_since = {}       # service name -> monotonic time first seen up
        self._row_keys = {}       # service name -> DataTable RowKey
        self._log_proc = None     # current log-stream subprocess
        self._log_seq = 0         # bumped on each stream switch (stale-reader guard)

    # ── layout ───────────────────────────────────────────────────────────────
    def compose(self) -> ComposeResult:
        mode = "Dev" if self.dev_mode else "Local"
        yield Header(show_clock=True)
        with Horizontal():
            yield DataTable(id="services", cursor_type="row", zebra_stripes=True)
            yield RichLog(id="logs", markup=False, highlight=False, wrap=False, auto_scroll=True)
        yield Footer()
        self.title = "TT Studio"
        self.sub_title = f"{mode} · live status"

    def on_mount(self) -> None:
        table = self.query_one("#services", DataTable)
        table.add_column("Service", key="service")
        table.add_column("Port", key="port")
        table.add_column("Status", key="status")
        for s in SERVICES:
            self._row_keys[s["name"]] = table.add_row(
                s["name"], str(s["port"]), Text("…", style="dim"), key=s["name"]
            )
        table.focus()
        # First probe + log stream right away, then poll every 2s.
        self._refresh_health()
        self.set_interval(2.0, self._refresh_health)
        if SERVICES:
            self._start_log_stream(SERVICES[0])

    # ── health polling ─────────────────────────────────────────────────────────
    @work(thread=True, exclusive=True, group="probe")
    def _refresh_health(self) -> None:
        health = snapshot_health([s["health"] for s in SERVICES])
        self.call_from_thread(self._apply_health, health)

    def _apply_health(self, health) -> None:
        table = self.query_one("#services", DataTable)
        now = time.monotonic()
        for s in SERVICES:
            up = health.get(s["health"], False)
            if up:
                self._up_since.setdefault(s["name"], now)
                uptime = _fmt_duration(now - self._up_since[s["name"]])
                cell = Text.from_markup(f"[green]● up[/green]  [dim]{uptime}[/dim]")
            else:
                self._up_since.pop(s["name"], None)
                cell = Text.from_markup("[red]✗ down[/red]")
            table.update_cell(self._row_keys[s["name"]], "status", cell)

    # ── log streaming ────────────────────────────────────────────────────────
    def _current_service(self):
        table = self.query_one("#services", DataTable)
        if table.row_count == 0:
            return None
        row_key, _ = table.coordinate_to_cell_key(table.cursor_coordinate)
        name = row_key.value
        return next((s for s in SERVICES if s["name"] == name), None)

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        name = event.row_key.value
        svc = next((s for s in SERVICES if s["name"] == name), None)
        if svc is not None:
            self._start_log_stream(svc)

    def _log_widget(self) -> RichLog:
        return self.query_one("#logs", RichLog)

    def _start_log_stream(self, service) -> None:
        self._stop_log_stream()
        self._log_seq += 1
        seq = self._log_seq
        log = self._log_widget()
        log.clear()
        log.write(Text.from_markup(f"[dim]── {service['name']} logs ──[/dim]"))

        if service["kind"] == "container":
            cmd = self._compose + ["logs", "-f", "--tail", "100", service["compose"]]
            cwd = _APP_DIR
        else:
            path = service.get("log")
            if not path or not os.path.exists(path):
                log.write(Text.from_markup(f"[dim](no log file yet{f' at {path}' if path else ''})[/dim]"))
                return
            cmd = ["tail", "-n", "100", "-f", path]
            cwd = None

        try:
            proc = subprocess.Popen(
                cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1,
            )
        except Exception as exc:  # noqa: BLE001 - surface any spawn failure in-pane
            log.write(Text.from_markup(f"[red]Could not stream logs: {exc}[/red]"))
            return
        self._log_proc = proc
        threading.Thread(target=self._reader, args=(proc, seq), daemon=True).start()

    def _reader(self, proc, seq) -> None:
        try:
            for line in proc.stdout:
                if seq != self._log_seq:
                    break
                self.call_from_thread(self._append_log, line.rstrip("\n"), seq)
        except Exception:
            pass

    def _append_log(self, line, seq) -> None:
        if seq == self._log_seq:
            self._log_widget().write(line)

    def _stop_log_stream(self) -> None:
        proc, self._log_proc = self._log_proc, None
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass

    # ── actions ────────────────────────────────────────────────────────────────
    def action_cursor_up(self) -> None:
        self.query_one("#services", DataTable).action_cursor_up()

    def action_cursor_down(self) -> None:
        self.query_one("#services", DataTable).action_cursor_down()

    def action_clear_log(self) -> None:
        self._log_widget().clear()

    def action_open(self) -> None:
        svc = self._current_service()
        if svc:
            url = f"http://localhost:{svc['port']}"
            webbrowser.open(url)
            self.notify(f"Opening {url}")

    def action_restart(self) -> None:
        svc = self._current_service()
        if not svc:
            return
        if svc["kind"] == "container":
            self.notify(f"Restarting {svc['name']}…")
            self._restart_container(svc)
        else:
            # Host services start/stop with their own sudo/console output, which
            # would corrupt the TUI — point the user at run.py instead.
            self.notify(f"{svc['name']} is a host service — restart it with `python run.py`.",
                        severity="warning")

    @work(thread=True, group="restart")
    def _restart_container(self, svc) -> None:
        result = subprocess.run(
            self._compose + ["restart", svc["compose"]],
            cwd=_APP_DIR, capture_output=True, text=True,
        )
        ok = result.returncode == 0
        self.call_from_thread(
            self.notify,
            f"{svc['name']} restarted" if ok else f"{svc['name']} restart failed",
            severity="information" if ok else "error",
        )

    def on_unmount(self) -> None:
        self._stop_log_stream()
