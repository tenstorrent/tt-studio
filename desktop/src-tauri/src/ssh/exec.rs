// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Remote command execution over an [`SshSession`].
//!
//! Two shapes, both running one command in one exec channel:
//!
//! - [`SshSession::exec_capture`] — short one-shot probes (`test -f`,
//!   `python3 --version`, `run.py --status --json`), buffered and bounded by
//!   a timeout;
//! - [`SshSession::exec_stream`] — long-running commands (`run.py
//!   --json-events`, `run.py --stop`) whose stdout is delivered line by line
//!   as it arrives. Unbounded: the caller decides when to give up by closing
//!   the session, which ends the stream.

use std::time::Duration;

use russh::ChannelMsg;

use super::session::SshSession;
use super::SshError;

/// One-shot probes must answer quickly; `run.py --status --json` is the
/// slowest (it health-checks every service) so the bound is generous.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(60);

/// Everything a finished one-shot command produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecOutput {
    /// The remote command's exit code; `None` when the channel closed
    /// without reporting one (e.g. the session died mid-command).
    pub exit_code: Option<u32>,
    pub stdout: String,
    pub stderr: String,
}

impl ExecOutput {
    pub fn success(&self) -> bool {
        self.exit_code == Some(0)
    }
}

impl SshSession {
    /// Run `command` and buffer everything until it exits.
    pub async fn exec_capture(&self, command: &str) -> Result<ExecOutput, SshError> {
        tokio::time::timeout(CAPTURE_TIMEOUT, self.exec_capture_inner(command))
            .await
            .map_err(|_| SshError::Timeout {
                message: format!("remote command timed out: {command}"),
            })?
    }

    async fn exec_capture_inner(&self, command: &str) -> Result<ExecOutput, SshError> {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut channel = self.open_session_channel().await?;
        channel.exec(true, command).await?;
        let mut exit_code = None;
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { ref data } => stdout.extend_from_slice(data),
                ChannelMsg::ExtendedData { ref data, ext: 1 } => stderr.extend_from_slice(data),
                ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                _ => {}
            }
        }
        Ok(ExecOutput {
            exit_code,
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
        })
    }

    /// Run `command`, delivering each complete stdout line to
    /// `on_stdout_line` as it arrives and raw stderr chunks to `on_stderr`.
    /// Returns the exit code once the channel closes. No timeout — cancel by
    /// closing the session, which terminates the stream.
    pub async fn exec_stream(
        &self,
        command: &str,
        mut on_stdout_line: impl FnMut(&str) + Send,
        mut on_stderr: impl FnMut(&[u8]) + Send,
    ) -> Result<Option<u32>, SshError> {
        let mut channel = self.open_session_channel().await?;
        channel.exec(true, command).await?;
        let mut lines = LineBuffer::default();
        let mut exit_code = None;
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { ref data } => lines.push(data, &mut on_stdout_line),
                ChannelMsg::ExtendedData { ref data, ext: 1 } => on_stderr(data),
                ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                _ => {}
            }
        }
        lines.finish(&mut on_stdout_line);
        Ok(exit_code)
    }
}

/// Reassembles complete lines from arbitrarily chunked byte data (an SSH
/// channel splits on packet boundaries, not newlines).
#[derive(Default)]
struct LineBuffer {
    buf: Vec<u8>,
}

impl LineBuffer {
    fn push(&mut self, data: &[u8], mut emit: impl FnMut(&str)) {
        self.buf.extend_from_slice(data);
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            let line = &line[..line.len() - 1];
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            emit(&String::from_utf8_lossy(line));
        }
    }

    /// Flush a trailing unterminated line (a crashed remote command may not
    /// end its last write with a newline).
    fn finish(self, mut emit: impl FnMut(&str)) {
        if !self.buf.is_empty() {
            emit(&String::from_utf8_lossy(&self.buf));
        }
    }
}

/// POSIX single-quote `s` so it survives the remote shell verbatim.
pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Quote a remote path while keeping a leading `~` meaningful: profiles
/// store paths the way users type them (`~/tt-studio`), and quoting the
/// tilde would make the remote shell take it literally.
pub fn quote_path(path: &str) -> String {
    if path == "~" {
        return "\"$HOME\"".to_string();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return format!("\"$HOME\"/{}", shell_quote(rest));
    }
    shell_quote(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect_lines(chunks: &[&[u8]]) -> Vec<String> {
        let mut buf = LineBuffer::default();
        let mut lines = Vec::new();
        for chunk in chunks {
            buf.push(chunk, |l| lines.push(l.to_string()));
        }
        buf.finish(|l| lines.push(l.to_string()));
        lines
    }

    #[test]
    fn lines_reassemble_across_chunk_boundaries() {
        let lines = collect_lines(&[b"{\"a\":", b"1}\n{\"b\"", b":2}\n"]);
        assert_eq!(lines, vec![r#"{"a":1}"#, r#"{"b":2}"#]);
    }

    #[test]
    fn trailing_unterminated_line_is_flushed() {
        let lines = collect_lines(&[b"complete\npartial"]);
        assert_eq!(lines, vec!["complete", "partial"]);
    }

    #[test]
    fn carriage_returns_are_stripped() {
        let lines = collect_lines(&[b"one\r\ntwo\n"]);
        assert_eq!(lines, vec!["one", "two"]);
    }

    #[test]
    fn empty_lines_are_preserved_but_empty_tail_is_not() {
        let lines = collect_lines(&[b"a\n\nb\n"]);
        assert_eq!(lines, vec!["a", "", "b"]);
    }

    #[test]
    fn shell_quote_wraps_and_escapes() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("has space"), "'has space'");
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
    }

    #[test]
    fn quote_path_keeps_tilde_expandable() {
        assert_eq!(quote_path("~/tt-studio"), "\"$HOME\"/'tt-studio'");
        assert_eq!(quote_path("~"), "\"$HOME\"");
        assert_eq!(quote_path("/opt/tt studio"), "'/opt/tt studio'");
        // A tilde not at the start is a literal character, not an expansion.
        assert_eq!(quote_path("/data/~cache"), "'/data/~cache'");
    }
}
