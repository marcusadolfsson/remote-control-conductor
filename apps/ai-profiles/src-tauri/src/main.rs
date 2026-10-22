// SPDX-License-Identifier: MIT

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use ai_profiles_lib::cli::{invocation, open_profile, revive_rc_servers, Invocation};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match invocation(&args) {
        Invocation::Gui => ai_profiles_lib::run(),
        Invocation::OpenProfile(id) => {
            if let Err(message) = open_profile(id) {
                eprintln!("remote-control-conductor: {message}");
                std::process::exit(1);
            }
        }
        Invocation::Mcp => {
            if let Err(message) = ai_profiles_lib::mcp::serve() {
                eprintln!("remote-control-conductor: {message}");
                std::process::exit(1);
            }
        }
        Invocation::ReviveRcServers => revive_rc_servers(),
        Invocation::Misuse(message) => {
            eprintln!("remote-control-conductor: {message}");
            std::process::exit(2);
        }
    }
}
