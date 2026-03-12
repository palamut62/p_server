const { execFile } = require('child_process');
const os = require('os');

const WINDOWS_POWERSHELL = 'powershell.exe';
const DEV_RUNTIME_NAMES = new Set([
  'node',
  'node.exe',
  'bun',
  'bun.exe',
  'deno',
  'deno.exe',
  'python',
  'python.exe',
  'pythonw.exe',
  'java',
  'java.exe',
  'go',
  'go.exe',
  'php',
  'php.exe',
  'ruby',
  'ruby.exe',
  'dotnet',
  'dotnet.exe',
  'uv',
  'uv.exe'
]);

const DEV_COMMAND_HINTS = [
  'vite',
  'next',
  'nuxt',
  'astro',
  'react-scripts',
  'webpack',
  'parcel',
  'preview',
  'nodemon',
  'ts-node',
  'tsx',
  'vite-node',
  'vercel',
  'turbo',
  'fastapi',
  'uvicorn',
  'gunicorn',
  'flask',
  'django',
  'runserver',
  'manage.py',
  'php -s',
  'rails s',
  'mix phx.server',
  'http.server'
];

function runCommand(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPowerShell(script) {
  const output = await runCommand(WINDOWS_POWERSHELL, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ]);

  if (!output) {
    return [];
  }

  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function isProcessRunning(pid) {
  const normalizedPid = Number(pid);

  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return false;
  }

  const output = await runCommand(WINDOWS_POWERSHELL, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `if (Get-Process -Id ${normalizedPid} -ErrorAction SilentlyContinue) { 'running' }`
  ]);

  return output.trim() === 'running';
}

async function waitForProcessExit(pid, timeoutMs = 1500) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isProcessRunning(pid))) {
      return true;
    }

    await sleep(150);
  }

  return !(await isProcessRunning(pid));
}

function formatTerminationError(error) {
  const message = String(error && error.message ? error.message : error || '').trim();
  return message || 'Islem sonlandirilamadi.';
}

function normalizeCommandLine(commandLine) {
  return (commandLine || '').replace(/\s+/g, ' ').trim();
}

function inferRuntime(name, commandLine) {
  const normalizedName = (name || '').toLowerCase();
  const normalizedCommand = normalizeCommandLine(commandLine).toLowerCase();

  if (normalizedCommand.includes('next')) return 'Next.js';
  if (normalizedCommand.includes('vite')) return 'Vite';
  if (normalizedCommand.includes('nuxt')) return 'Nuxt';
  if (normalizedCommand.includes('astro')) return 'Astro';
  if (normalizedCommand.includes('react-scripts')) return 'CRA';
  if (normalizedCommand.includes('uvicorn') || normalizedCommand.includes('fastapi')) return 'FastAPI';
  if (normalizedCommand.includes('flask')) return 'Flask';
  if (normalizedCommand.includes('django') || normalizedCommand.includes('runserver')) return 'Django';
  if (normalizedCommand.includes('php -s')) return 'PHP';
  if (normalizedName.includes('python')) return 'Python';
  if (normalizedName.includes('node')) return 'Node.js';
  if (normalizedName.includes('bun')) return 'Bun';
  if (normalizedName.includes('deno')) return 'Deno';
  if (normalizedName.includes('dotnet')) return '.NET';
  if (normalizedName.includes('java')) return 'Java';
  return name || 'Process';
}

function inferDisplayName(runtime, commandLine) {
  const command = normalizeCommandLine(commandLine);
  const match = command.match(/([A-Za-z]:\\[^\s"]+|\/[^\s"]+)/);

  if (match) {
    const segments = match[0].split(/[\\/]/).filter(Boolean);
    const finalSegment = segments[segments.length - 1];

    if (finalSegment && finalSegment.includes('.')) {
      return finalSegment;
    }

    if (segments.length >= 2) {
      return segments[segments.length - 1];
    }
  }

  const tokens = command.split(' ').filter(Boolean);
  if (tokens.length > 1) {
    return tokens[1].replace(/["']/g, '');
  }

  return runtime;
}

function toArray(input) {
  return Array.isArray(input) ? input : [];
}

function bytesToMb(bytes) {
  const value = Number(bytes || 0);
  return Math.max(0, Math.round(value / (1024 * 1024)));
}

function isDevServerProcess(processInfo, listeningPorts) {
  if (!listeningPorts.length) {
    return false;
  }

  const name = (processInfo.Name || '').toLowerCase();
  const commandLine = normalizeCommandLine(processInfo.CommandLine).toLowerCase();

  if (DEV_RUNTIME_NAMES.has(name)) {
    return true;
  }

  return DEV_COMMAND_HINTS.some((hint) => commandLine.includes(hint));
}

function buildUrls(portEntries) {
  const urls = portEntries.map((entry) => {
    const address = entry.LocalAddress || '127.0.0.1';
    const localAddress = ['0.0.0.0', '::', '::1'].includes(address) ? '127.0.0.1' : address;
    return `http://${localAddress}:${entry.LocalPort}`;
  });

  return Array.from(new Set(urls));
}

async function scanServers() {
  if (os.platform() !== 'win32') {
    return {
      servers: [],
      summary: {
        activeCount: 0,
        portCount: 0,
        totalMemoryMb: 0,
        refreshedAt: new Date().toISOString(),
        error: 'Bu surum su anda yalnizca Windows taramasini destekliyor.'
      }
    };
  }

  const [processes, ports] = await Promise.all([
    runPowerShell(
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize | ConvertTo-Json -Compress'
    ),
    runPowerShell(
      "Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -gt 0 } | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress"
    )
  ]);

  const processMap = new Map(toArray(processes).map((item) => [Number(item.ProcessId), item]));
  const listeningByPid = new Map();

  for (const portEntry of toArray(ports)) {
    const pid = Number(portEntry.OwningProcess);
    if (!listeningByPid.has(pid)) {
      listeningByPid.set(pid, []);
    }

    listeningByPid.get(pid).push(portEntry);
  }

  const servers = [];

  for (const [pid, listeningPorts] of listeningByPid.entries()) {
    const processInfo = processMap.get(pid);
    if (!processInfo || !isDevServerProcess(processInfo, listeningPorts)) {
      continue;
    }

    const runtime = inferRuntime(processInfo.Name, processInfo.CommandLine);
    const portsForProcess = listeningPorts
      .map((entry) => Number(entry.LocalPort))
      .filter((port) => Number.isFinite(port))
      .sort((left, right) => left - right);

    const urls = buildUrls(listeningPorts);

    servers.push({
      pid,
      parentPid: Number(processInfo.ParentProcessId || 0),
      processName: processInfo.Name || 'process',
      runtime,
      displayName: inferDisplayName(runtime, processInfo.CommandLine),
      command: normalizeCommandLine(processInfo.CommandLine) || processInfo.Name || 'Unknown command',
      ports: portsForProcess,
      primaryPort: portsForProcess[0] || null,
      url: urls[0] || null,
      urls,
      memoryMb: bytesToMb(processInfo.WorkingSetSize),
      scope: listeningPorts.some((entry) => ['0.0.0.0', '::'].includes(entry.LocalAddress)) ? 'LAN + local' : 'Local'
    });
  }

  servers.sort((left, right) => {
    if (left.primaryPort !== right.primaryPort) {
      return (left.primaryPort || 0) - (right.primaryPort || 0);
    }

    return left.pid - right.pid;
  });

  return {
    servers,
    summary: {
      activeCount: servers.length,
      portCount: servers.reduce((total, server) => total + server.ports.length, 0),
      totalMemoryMb: servers.reduce((total, server) => total + server.memoryMb, 0),
      refreshedAt: new Date().toISOString(),
      error: ''
    }
  };
}

async function stopServerTree(pid) {
  const normalizedPid = Number(pid);

  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    throw new Error('Gecerli bir PID gerekli.');
  }

  // İlk deneme: taskkill /T /F (process tree)
  let lastError = null;

  try {
    await runCommand('taskkill.exe', ['/PID', String(normalizedPid), '/T', '/F']);
  } catch (error) {
    lastError = error;
  }

  if (await waitForProcessExit(normalizedPid)) {
    await sleep(500);
    return;
  }

  // İkinci deneme: sadece PID'yi kapat (tree olmadan)
  try {
    await runCommand('taskkill.exe', ['/PID', String(normalizedPid), '/F']);
    lastError = null;
  } catch (error) {
    lastError = error;
  }

  if (await waitForProcessExit(normalizedPid, 2000)) {
    await sleep(500);
    return;
  }

  // Üçüncü deneme: PowerShell ile Stop-Process
  try {
    await runPowerShell(
      `Stop-Process -Id ${normalizedPid} -Force -ErrorAction Stop; 'ok'`
    );
    lastError = null;
  } catch (error) {
    lastError = error;
  }

  if (await waitForProcessExit(normalizedPid, 2000)) {
    await sleep(500);
    return;
  }

  // Hata mesajını anlamlı hale getir
  const errorMsg = formatTerminationError(lastError);
  if (errorMsg.includes('engellendi') || errorMsg.includes('Access') || errorMsg.includes('denied')) {
    throw new Error(`PID ${normalizedPid}: Erisim engellendi. Uygulamayi yonetici olarak calistirin.`);
  }

  throw new Error(errorMsg);
}

async function stopAllServers(servers) {
  const seen = new Set();

  for (const server of servers) {
    if (!server || seen.has(server.pid)) {
      continue;
    }

    seen.add(server.pid);
    try {
      await stopServerTree(server.pid);
    } catch (error) {
      // Ignore already-exited processes during batch shutdown.
    }
  }
}

module.exports = {
  scanServers,
  stopServerTree,
  stopAllServers
};
