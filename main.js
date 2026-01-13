const fs = require("fs");

const BASE_URL = "https://hackatime.hackclub.com/api/v1/users";
const MAX_ID = 25992;

const SCAN_CONCURRENCY = 50;
const STATS_CONCURRENCY = 75;

// TRUST SCAN

const redTrustUsers = [];
const greenTrustUsers = [];

let scanned = 0;

async function fetchTrust(id) {
  const res = await fetch(`${BASE_URL}/${id}/trust_factor`);
  return res.json();
}

async function scanWorker(startId) {
  let id = startId;

  while (id <= MAX_ID) {
    try {
      const data = await fetchTrust(id);
        
      if (data.trust_level === "red" && data.trust_value === 1) {
        redTrustUsers.push(id);
      }

      if (data.trust_level === "green" && data.trust_value === 2) {
        greenTrustUsers.push(id);
      }
    } catch {}

    const done = ++scanned;

    if (done % 1000 === 0 || done === MAX_ID) {
      console.log(
        `[scan] ${done}/${MAX_ID} | red: ${redTrustUsers.length} | green: ${greenTrustUsers.length}`
      );
    }

    id += SCAN_CONCURRENCY;
  }
}

// USERNAMES

const groupedUsernames = {
  red: {},
  green: {}
};

const queue = [];

function buildQueue() {
  for (const id of redTrustUsers) {
    queue.push({ id, group: "red" });
  }
  for (const id of greenTrustUsers) {
    queue.push({ id, group: "green" });
  }
}

let usernamesFetched = 0;

async function fetchUsernameWithRetry(id) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/${id}/stats`);
      const json = await res.json();

      if (json?.data?.username) {
        return json.data.username;
      }
    } catch {}

    await new Promise((r) => setTimeout(r, 50));
  }

  return null;
}

async function usernameWorker(total) {
  while (true) {
    const job = queue.pop();
    if (!job) break;

    try {
      const username = await fetchUsernameWithRetry(job.id);
      if (username) {
        groupedUsernames[job.group][job.id] = username;
      } else {
        groupedUsernames[job.group][job.id] = "Private Stats";
      }
    } catch {
      groupedUsernames[job.group][job.id] = "Private Stats";
    }

    const done = ++usernamesFetched;

    if (done % 500 === 0 || done === total) {
      console.log(`[usernames] ${done}/${total}`);
    }
  }
}

(async () => {
  console.log("=== Hackatime Scan → Usernames (Grouped) ===");
  console.log(`Max ID            : ${MAX_ID}`);
  console.log(`Scan concurrency  : ${SCAN_CONCURRENCY}`);
  console.log(`Stats concurrency : ${STATS_CONCURRENCY}\n`);

  console.time("total_time");

  console.log("Starting trust scan...\n");

  const scanWorkers = [];
  for (let i = 1; i <= SCAN_CONCURRENCY; i++) {
    scanWorkers.push(scanWorker(i));
  }

  await Promise.all(scanWorkers);

  console.log("\n=== Trust Scan Done ===");
  console.log(`Red users   : ${redTrustUsers.length}`);
  console.log(`Green users : ${greenTrustUsers.length}`);
  console.log(
    `Total       : ${redTrustUsers.length + greenTrustUsers.length}\n`
  );

  console.log("Fetching usernames...\n");

  buildQueue();
  const total = queue.length;

  const usernameWorkers = [];
  for (let i = 0; i < STATS_CONCURRENCY; i++) {
    usernameWorkers.push(usernameWorker(total));
  }

  await Promise.all(usernameWorkers);

  fs.writeFileSync(
    "logs.json",
    JSON.stringify(groupedUsernames, null, 2)
  );

  console.timeEnd("total_time");

  console.log("\n=== Done ===");
  console.log(`Red usernames   : ${Object.keys(groupedUsernames.red).length}`);
  console.log(`Green usernames : ${Object.keys(groupedUsernames.green).length}`);
  console.log(`Saved file      : logs.json`);
})();
