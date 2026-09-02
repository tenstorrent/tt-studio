// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Integration tests for the port-clearing allowlist against a real process
//! holding a real port.
//!
//! No Docker and no sshd, so these run under plain `cargo test`. The port
//! always comes from `common::free_port()` — the live TT-Studio stack's ports
//! (3000/8000-8002/4000/8080/8111) are never touched.

mod common;

use std::process::{Child, Command, Stdio};
use std::time::Duration;

use common::free_port;
use tt_studio_desktop_lib::port_clear::{clear_ports, facts_for, terminate_and_wait, HolderClass};

/// Hold `port` open in a child process until it is killed.
fn hold_port(port: u16) -> Option<Child> {
    let script = format!(
        "import socket,time\n\
         s=socket.socket()\n\
         s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)\n\
         s.bind(('127.0.0.1',{port}))\n\
         s.listen()\n\
         time.sleep(120)\n"
    );
    let child = Command::new("python3")
        .arg("-c")
        .arg(script)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // Wait for the bind to actually take effect.
    for _ in 0..50 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Some(child);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    None
}

fn port_is_taken(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

#[test]
fn refuses_to_kill_an_unrecognised_holder() {
    let port = free_port();
    let Some(mut child) = hold_port(port) else {
        eprintln!("skipping: could not hold a port with python3");
        return;
    };

    // A python process is exactly the case we must not touch: it could be
    // someone's dev server. This test is the proof that the allowlist is
    // closed by default rather than a denylist with holes.
    let report = clear_ports(&[port], &[]);

    assert!(
        report.freed.is_empty(),
        "an unrecognised holder must never be killed, got {:?}",
        report.freed
    );
    assert_eq!(report.skipped.len(), 1, "the conflict must be reported");
    let skipped = &report.skipped[0];
    assert_eq!(skipped.port, port);
    assert_eq!(skipped.class, HolderClass::Unknown);
    assert_eq!(
        skipped.holder.as_ref().map(|h| h.pid),
        Some(child.id()),
        "the report must name the actual holder"
    );
    assert!(port_is_taken(port), "the holder is still running");

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn terminate_and_wait_frees_a_port_it_is_pointed_at() {
    let port = free_port();
    let Some(mut child) = hold_port(port) else {
        eprintln!("skipping: could not hold a port with python3");
        return;
    };
    let pid = child.id();

    // The lower-level primitive, exercised directly: classification decides
    // *whether* to call this, and this decides whether the port is actually
    // free afterwards.
    assert!(
        terminate_and_wait(pid, port, Duration::from_secs(5)),
        "SIGTERM should free the port"
    );
    assert!(!port_is_taken(port), "the port must be bindable again");

    let _ = child.wait(); // reap
}

#[test]
fn clearing_a_free_port_touches_nothing() {
    let port = free_port();
    let report = clear_ports(&[port], &[]);
    assert!(report.freed.is_empty());
    assert!(
        report.skipped.is_empty(),
        "nothing holds it, nothing to say"
    );
}

#[test]
fn facts_for_a_vanished_pid_are_none() {
    let port = free_port();
    let Some(mut child) = hold_port(port) else {
        eprintln!("skipping: could not hold a port with python3");
        return;
    };
    let pid = child.id();
    let _ = child.kill();
    let _ = child.wait();
    // A pid that has been reaped must not resolve to stale facts, or we could
    // signal whatever reused the number.
    for _ in 0..50 {
        if facts_for(pid).is_none() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("facts_for kept reporting a reaped pid {pid}");
}
