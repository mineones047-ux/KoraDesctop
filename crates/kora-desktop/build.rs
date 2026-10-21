fn main() {
    // `tauri.conf.json` is validated here so a malformed config fails at build time
    // rather than at startup.
    tauri_build::build()
}
