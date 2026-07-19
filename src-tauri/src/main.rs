// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Unixではrun固有inodeを保持し、Windowsでは同じleaseへPIDを書いて保持する。
    // janitorはleaseとcanonical executableの両方を再照合して対象を限定する。
    #[cfg(feature = "e2e")]
    let _e2e_lease = {
        let path = std::env::var_os("RELICO_E2E_LEASE_PATH")
            .expect("RELICO_E2E_LEASE_PATH must be set for an e2e build");
        let mut lease = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .expect("E2E process lease must already exist");
        #[cfg(target_os = "windows")]
        {
            use std::io::{Seek, SeekFrom, Write};
            lease.set_len(0).expect("truncate E2E process lease");
            lease.seek(SeekFrom::Start(0)).expect("rewind E2E process lease");
            writeln!(lease, "{}", std::process::id()).expect("write E2E process PID lease");
            lease.sync_data().expect("flush E2E process PID lease");
        }
        lease
    };

    relico_lib::run()
}
