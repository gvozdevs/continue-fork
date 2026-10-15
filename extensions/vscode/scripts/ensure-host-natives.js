/**
 * After packaging for another OS (e.g. win32-x64), out/bin hold that OS's
 * native modules. Local debug on the host then fails to load them.
 * Re-run prepackage for the host when markers do not match.
 */
const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { autodetectPlatformAndArch } = require("../../../scripts/util/index");

const vscodeExtDir = path.join(__dirname, "..");
const [os, arch] = autodetectPlatformAndArch();
const target = `${os}-${arch}`;
const exe = os === "win32" ? ".exe" : "";
const isWinTarget = target.startsWith("win");
const isLinuxTarget = target.startsWith("linux");

function exists(relPath) {
  return fs.existsSync(path.join(vscodeExtDir, relPath));
}

function sqliteLooksLikeHost() {
  const sqlitePath = path.join(
    vscodeExtDir,
    "out/build/Release/node_sqlite3.node",
  );
  if (!fs.existsSync(sqlitePath)) {
    return false;
  }
  if (process.platform === "win32") {
    return true;
  }
  try {
    const info = execFileSync("file", ["-b", sqlitePath], {
      encoding: "utf8",
    });
    if (process.platform === "darwin") {
      return /Mach-O/i.test(info);
    }
    if (process.platform === "linux") {
      return /ELF/i.test(info);
    }
  } catch {
    // If `file` is unavailable, fall back to path checks only.
  }
  return true;
}

function hostNativesReady() {
  const rgHost = `out/node_modules/@vscode/ripgrep/bin/rg${exe}`;
  if (!exists(rgHost)) {
    return false;
  }

  // Cross-package left the other OS binary and dropped the host one.
  const rgWrong = `out/node_modules/@vscode/ripgrep/bin/${
    os === "win32" ? "rg" : "rg.exe"
  }`;
  if (exists(rgWrong) && !exists(rgHost)) {
    return false;
  }

  const lanceDir = `out/node_modules/@lancedb/vectordb-${target}${
    isWinTarget ? "-msvc" : ""
  }${isLinuxTarget ? "-gnu" : ""}`;
  if (!exists(`${lanceDir}/index.node`)) {
    return false;
  }

  const onnxOs = os === "win32" ? "win32" : os;
  if (!exists(`bin/napi-v3/${onnxOs}`)) {
    return false;
  }

  if (!sqliteLooksLikeHost()) {
    return false;
  }

  return true;
}

function main() {
  if (hostNativesReady()) {
    console.log(
      `[ensure-host-natives] Native binaries already match ${target}`,
    );
    return;
  }

  console.log(
    `[ensure-host-natives] Native binaries do not match ${target}; running prepackage for the host...`,
  );
  execSync("node scripts/prepackage.js", {
    cwd: vscodeExtDir,
    stdio: "inherit",
    env: {
      ...process.env,
      // Clear any leftover cross-compile target from the environment.
      CONTINUE_VSCODE_TARGET: "",
      CONTINUE_BUILD_TARGET: "",
      VSCODE_TARGET: "",
    },
  });

  if (!hostNativesReady()) {
    console.error(
      `[ensure-host-natives] prepackage finished but natives still do not match ${target}`,
    );
    process.exit(1);
  }
  console.log(`[ensure-host-natives] Host natives restored for ${target}`);
}

main();
