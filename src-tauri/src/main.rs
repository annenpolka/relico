// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // just e2eが作るrun固有inodeをprocess生存中だけ保持する。
    // janitorはこのleaseとcanonical executableの両方を再照合して対象を限定する。
    #[cfg(feature = "e2e")]
    let _e2e_lease = {
        let path = std::env::var_os("RELICO_E2E_LEASE_PATH")
            .expect("RELICO_E2E_LEASE_PATH must be set for an e2e build");
        std::fs::File::open(path).expect("E2E process lease must already exist")
    };

    relico_lib::run()
}
