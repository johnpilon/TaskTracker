import { execSync } from 'node:child_process';

const ports = [3000, 3001];

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim();
  } catch {
    return '';
  }
}

function uniq(arr) {
  return [...new Set(arr)];
}

function killOnWindows(port) {
  // netstat output includes PID in the 5th column for LISTENING lines
  const out = run(`cmd /c "netstat -ano | findstr :${port} | findstr LISTENING"`);
  if (!out) return;

  const pids = uniq(
    out
      .split(/\r?\n/g)
      .map((line) => line.trim().split(/\s+/))
      .map((cols) => cols[cols.length - 1])
      .filter((pid) => /^\d+$/.test(pid))
  );

  for (const pid of pids) {
    run(`cmd /c "taskkill /PID ${pid} /T /F"`);
  }
}

function killOnUnix(port) {
  // best-effort: lsof is common on mac/linux, fuser on many linux distros
  const lsofPids = run(`sh -lc "command -v lsof >/dev/null 2>&1 && lsof -ti tcp:${port} || true"`);
  if (lsofPids) {
    for (const pid of uniq(lsofPids.split(/\s+/).filter(Boolean))) {
      run(`sh -lc "kill -9 ${pid} >/dev/null 2>&1 || true"`);
    }
    return;
  }

  run(`sh -lc "command -v fuser >/dev/null 2>&1 && fuser -k ${port}/tcp >/dev/null 2>&1 || true"`);
}

for (const port of ports) {
  if (process.platform === 'win32') {
    killOnWindows(port);
  } else {
    killOnUnix(port);
  }
}


