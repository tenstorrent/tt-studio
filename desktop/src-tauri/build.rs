// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/// Tauri's default Windows app manifest: a dependency on Common Controls v6.
const COMMON_CONTROLS_MANIFEST: &str = r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#;

fn main() {
    // tauri-build embeds the manifest into the app binary only, so test
    // executables that build a mock app fail to load on Windows with
    // STATUS_ENTRYPOINT_NOT_FOUND (comctl32 v5 lacks the v6 entry points).
    // On MSVC, have the linker embed it into every binary of the package.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo");
        let manifest = std::path::Path::new(&out_dir).join("app.manifest");
        std::fs::write(&manifest, COMMON_CONTROLS_MANIFEST).expect("write app manifest");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attributes).expect("tauri-build failed");
    } else {
        tauri_build::build()
    }
}
