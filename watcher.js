require("dotenv").config();

const fs = require("fs");
const express = require("express");
const fetch = require("node-fetch");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

const pathFile = "./logs.json";
const SCAN_SCRIPT = "./main.js";

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL_ID;

const SCAN_INTERVAL = 10 * 60 * 1000;

let oldData = { red: {}, green: {} };
let currentData = { red: {}, green: {} };

let newlyAdded = { red: {}, green: {} };
let removed = { red: {}, green: {} };

let scanRunning = false;
let scanCompletedOnce = false;


if (fs.existsSync(pathFile)) {
  currentData = JSON.parse(fs.readFileSync(pathFile, "utf-8"));
  oldData = JSON.parse(JSON.stringify(currentData));
}


function runScan() {
  if (scanRunning) {
    console.log("Scan already running, skipping.");
    return;
  }

  console.log("Starting scan script...");
  scanRunning = true;

  const proc = spawn("node", [SCAN_SCRIPT], { stdio: "inherit" });

  proc.on("exit", (code) => {
    scanRunning = false;
    scanCompletedOnce = true;

    if (fs.existsSync(pathFile)) {
      currentData = JSON.parse(fs.readFileSync(pathFile, "utf-8"));
      oldData = JSON.parse(JSON.stringify(currentData));
    }

    console.log(`Scan completed (exit ${code}). Baseline updated.`);
  });

  proc.on("error", (err) => {
    scanRunning = false;
    console.error("Scan failed:", err.message);
  });
}

runScan();
setInterval(runScan, SCAN_INTERVAL);


async function sendSlackUpdate({ update, group, user_id, username }) {
  if (!SLACK_TOKEN || !SLACK_CHANNEL) return;

  let text;

  if (group === "red") {
    text =
      update === "added"
        ? `*${username}(${user_id}) has been BANNED... dont do fraud kids^^`
        : `*${username}(${user_id}) has been Un-BANNED... one more chance^^`;
  }

  if (group === "green") {
    text =
      update === "added"
        ? `${username}(${user_id}) has been TRUSTED :fraud-squad:... be trusted kids^^`
        : `${username}(${user_id}) has been Un-TRUSTED :fraud-squad:... dont be stupid kids^^`;
  }

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: SLACK_CHANNEL,
        text,
      }),
    });

    const json = await res.json();
    if (!json.ok) console.error("Slack API error:", json.error);
  } catch (err) {
    console.error("Slack send failed:", err.message);
  }
}

fs.watchFile(pathFile, { interval: 1000 }, async (curr, prev) => {
  if (!scanCompletedOnce) return;
  if (scanRunning) return;
  if (curr.mtimeMs === prev.mtimeMs) return;

  const newData = JSON.parse(fs.readFileSync(pathFile, "utf-8"));

  newlyAdded = { red: {}, green: {} };
  removed = { red: {}, green: {} };

  for (const group of ["red", "green"]) {
    const oldGroup = oldData[group] || {};
    const newGroup = newData[group] || {};

    for (const id in newGroup) {
      if (!(id in oldGroup)) {
        newlyAdded[group][id] = newGroup[id];
        await sendSlackUpdate({
          update: "added",
          group,
          user_id: id,
          username: newGroup[id],
        });
      }
    }

    for (const id in oldGroup) {
      if (!(id in newGroup)) {
        removed[group][id] = oldGroup[id];
        await sendSlackUpdate({
          update: "removed",
          group,
          user_id: id,
          username: oldGroup[id],
        });
      }
    }
  }

  oldData = JSON.parse(JSON.stringify(newData));
  currentData = newData;

  console.log("External update detected. Slack notified.");
});


app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    scanRunning,
    totals: {
      red: Object.keys(currentData.red || {}).length,
      green: Object.keys(currentData.green || {}).length,
    },
    lastDiff: {
      added: newlyAdded,
      removed,
    },
  });
});

app.listen(PORT, () => {
  console.log(`Health endpoint running → http://localhost:${PORT}/health`);
});
