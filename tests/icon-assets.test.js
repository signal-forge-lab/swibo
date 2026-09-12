import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const source = new URL("../assets/swibo-icon-source.png", import.meta.url);
const displayIcon = new URL("../assets/swibo-icon.png", import.meta.url);
const daemon = fs.readFileSync(new URL("../src/daemon.js", import.meta.url), "utf8");
const buildScript = fs.readFileSync(new URL("../src-tauri/build.rs", import.meta.url), "utf8");

function sha256(url) {
  return crypto.createHash("sha256").update(fs.readFileSync(url)).digest("hex");
}

test("Swibo keeps the selected original artwork byte-for-byte", () => {
  assert.equal(
    sha256(source),
    "6619588eae670c9ffe28c1327c9a7aa311438e7b65ac28130b15e649ebd450ee",
  );
});

test("Swibo display icon is the direct 256px Lanczos derivative", () => {
  assert.equal(
    sha256(displayIcon),
    "e8cae8864646a93f6f228264a4b093e573f8c2ca3d55be5ada1ba1ffa02c6e58",
  );
  assert.doesNotMatch(daemon, /swibo-icon\.b64/);
  assert.match(daemon, /assets", "swibo-icon\.png/);
});

test("Windows icon contains explicit small-size source derivatives", () => {
  assert.match(buildScript, /16, 24, 32, 48, 64, 96, 128, 256/);
  for (const size of [16, 24, 32, 48, 64, 96, 128, 256]) {
    assert.ok(fs.existsSync(new URL(`../assets/swibo-icons/${size}.png`, import.meta.url)));
  }
});
