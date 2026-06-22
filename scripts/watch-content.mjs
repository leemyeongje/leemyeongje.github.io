#!/usr/bin/env node
// Watch the Obsidian vault and mirror it into ./content automatically.
//
//   node scripts/watch-content.mjs            # sync only (local mirror)
//   node scripts/watch-content.mjs --deploy   # sync + auto commit & push
//
// Env overrides:
//   CONTENT_SOURCE     vault path (defaults to the Google Drive kiwi vault)
//   DEPLOY_DEBOUNCE_MS quiet period before a deploy push (default 120000 = 2m)
//   WATCH_POLL=1       use polling (set this if Google Drive events are flaky)

import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import chokidar from "chokidar"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const VAULT =
  process.env.CONTENT_SOURCE ||
  "/Users/leemyeongje/Library/CloudStorage/GoogleDrive-mangsoonggi6@gmail.com/My Drive/obsidian/kiwi"

const DEPLOY = process.argv.includes("--deploy")
const SYNC_DEBOUNCE_MS = 1500
const DEPLOY_DEBOUNCE_MS = Number(process.env.DEPLOY_DEBOUNCE_MS || 120000)
const USE_POLLING = process.env.WATCH_POLL === "1"

const log = (...args) => console.log(`[watch ${new Date().toLocaleTimeString()}]`, ...args)

if (!fs.existsSync(VAULT)) {
  console.error(`error: vault source not found: ${VAULT}`)
  console.error("set CONTENT_SOURCE to override the path.")
  process.exit(1)
}

function runSync() {
  const res = spawnSync("bash", [path.join(__dirname, "sync-content.sh")], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, CONTENT_SOURCE: VAULT },
  })
  if (res.status !== 0) {
    log("sync failed (rc=" + res.status + ")")
    return false
  }
  // rsync -av prints one line per changed file; surface a short summary.
  const changed = (res.stdout?.toString() || "")
    .split("\n")
    .filter((l) => l && !l.startsWith("sending") && !l.startsWith("sent") && !l.startsWith("total") && !l.endsWith("/"))
  log(`synced vault -> content${changed.length ? ` (${changed.length} path(s))` : " (no changes)"}`)
  return true
}

function deploy() {
  // Stage only content/, so unrelated working-tree edits aren't swept in.
  spawnSync("git", ["add", "content"], { cwd: repoRoot, stdio: "inherit" })
  const diff = spawnSync("git", ["diff", "--cached", "--quiet", "--", "content"], { cwd: repoRoot })
  if (diff.status === 0) {
    log("nothing staged in content/, skipping deploy")
    return
  }
  const msg = `Sync vault content (${new Date().toISOString()})`
  const commit = spawnSync("git", ["commit", "-m", msg], { cwd: repoRoot, stdio: "inherit" })
  if (commit.status !== 0) {
    log("commit failed, skipping push")
    return
  }
  log("pushing to origin...")
  const push = spawnSync("git", ["push", "origin", "HEAD"], { cwd: repoRoot, stdio: "inherit" })
  if (push.status !== 0) {
    log("push failed — run `git push` manually once the issue is resolved")
    return
  }
  log("pushed — GitHub Pages will rebuild in a few minutes")
}

let syncTimer = null
let deployTimer = null

function schedule() {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    const ok = runSync()
    if (ok && DEPLOY) {
      clearTimeout(deployTimer)
      log(`deploy scheduled in ${Math.round(DEPLOY_DEBOUNCE_MS / 1000)}s (resets on further edits)`)
      deployTimer = setTimeout(deploy, DEPLOY_DEBOUNCE_MS)
    }
  }, SYNC_DEBOUNCE_MS)
}

log(`watching: ${VAULT}`)
log(`mode: ${DEPLOY ? "sync + auto-deploy" : "sync only"}${USE_POLLING ? " (polling)" : ""}`)

const watcher = chokidar.watch(VAULT, {
  ignored: (p) => p.includes("/.obsidian") || p.endsWith(".DS_Store"),
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  usePolling: USE_POLLING,
})

watcher.on("ready", () => log("ready — edit notes in Obsidian and they'll mirror into content/"))
watcher.on("all", (event, p) => {
  log(`${event}: ${path.basename(p)}`)
  schedule()
})

process.on("SIGINT", () => {
  log("stopping")
  watcher.close().then(() => process.exit(0))
})
