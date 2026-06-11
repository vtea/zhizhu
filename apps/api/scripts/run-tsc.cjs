const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const path = require("node:path");

const pkgDir = path.join(__dirname, "..");
const req = createRequire(path.join(pkgDir, "package.json"));
let tsc;
try {
  tsc = req.resolve("typescript/lib/tsc.js");
} catch {
  console.error(
    "[@zhizhu/api] 找不到 typescript。请在仓库根目录执行 npm install（勿仅在 apps 子目录安装）。",
  );
  process.exit(1);
}

const r = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
  cwd: pkgDir,
  stdio: "inherit",
});

process.exit(r.status === null ? 1 : r.status);
