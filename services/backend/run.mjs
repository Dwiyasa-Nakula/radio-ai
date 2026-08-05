import { spawn } from 'node:child_process';

const providerEntry = process.env.YOUTUBE_PO_PROVIDER_ENTRY
  ?? '/opt/bgutil-provider/server/build/main.js';
const backendEntry = process.env.BACKEND_ENTRY
  ?? '/app/services/backend/dist/server.mjs';
const providerUrl = (process.env.YOUTUBE_PO_PROVIDER_URL ?? 'http://127.0.0.1:4416').replace(/\/$/, '');
const youtubeEnabled = process.env.YOUTUBE_STREAMING_ENABLED !== 'false';

let shuttingDown = false;
let shutdownCode = 0;
let provider;
let backend;

function start(command, args, stdio = 'inherit') {
  return spawn(command, args, {
    env: process.env,
    stdio,
  });
}

function finishShutdownWhenReady() {
  if (
    shuttingDown &&
    (!provider || provider.exitCode !== null) &&
    (!backend || backend.exitCode !== null)
  ) {
    process.exit(shutdownCode);
  }
}

function stop(signal = 'SIGTERM', exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownCode = exitCode;
  backend?.kill(signal);
  provider?.kill(signal);
  finishShutdownWhenReady();
  setTimeout(() => process.exit(shutdownCode), 8_000).unref();
}

async function waitForProvider() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (provider?.exitCode !== null) {
      throw new Error('PO-token provider exited during startup');
    }
    try {
      const response = await fetch(providerUrl + '/ping', {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('PO-token provider did not become ready within 30 seconds');
}

function watchProvider() {
  provider?.on('exit', (code, signal) => {
    if (shuttingDown) {
      finishShutdownWhenReady();
      return;
    }
    console.error(JSON.stringify({
      severity: 'ERROR',
      event: 'youtube_provider_exited',
      code,
      signal,
    }));
    backend?.kill('SIGTERM');
    process.exit(code && code !== 0 ? code : 1);
  });
}

function watchBackend() {
  backend?.on('exit', (code, signal) => {
    if (shuttingDown) {
      finishShutdownWhenReady();
      return;
    }
    provider?.kill('SIGTERM');
    process.exit(code ?? (signal ? 1 : 0));
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => stop(signal));
}

try {
  if (youtubeEnabled) {
    provider = start(process.execPath, [providerEntry], ['ignore', 'ignore', 'inherit']);
    watchProvider();
    await waitForProvider();
  }
  backend = start(process.execPath, [backendEntry]);
  watchBackend();
} catch (error) {
  console.error(JSON.stringify({
    severity: 'ERROR',
    event: 'youtube_provider_start_failed',
    message: error instanceof Error ? error.message : String(error),
  }));
  stop('SIGTERM', 1);
}
