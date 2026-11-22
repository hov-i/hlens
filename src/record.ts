import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { FEATURES_DIR, DEFAULT_TEST_COMMAND, FeatureConfig, readConfig, resolvePlatform, scenarioFileName } from './features';
import { runScenarioGenerate } from './generate';

const output = vscode.window.createOutputChannel('HLens');
let busy = false;

interface Ctx {
  root: string;
  featureDir: string;
  outDir: string;
  scenario: string;
  id: string;
  config: FeatureConfig;
  token: vscode.CancellationToken;
}

/** Runs the scenario while recording the screen and saves the video to .features/<id>/.out/. */
export async function recordFeature(root: string, id: string, onDone: () => void) {
  if (busy) {
    vscode.window.showWarningMessage('A recording is already in progress.');
    return;
  }
  const config = readConfig(root);
  const platform = resolvePlatform(root);
  const featureDir = path.join(root, FEATURES_DIR, id);
  const scenarioName = scenarioFileName(platform);
  const scenario = path.join(featureDir, scenarioName);
  if (!fs.existsSync(scenario)) {
    const pick = await vscode.window.showWarningMessage(
      `${scenarioName} does not exist yet (platform: ${platform}). Create it with Claude Code?`,
      'Create with Claude',
    );
    if (pick) runScenarioGenerate(root, id, scenarioName, platform);
    return;
  }
  if (platform === 'web' && !(await ensurePlaywright(root))) return;

  busy = true;
  output.clear();
  output.show(true);
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Recording: ${id}`, cancellable: true },
      async (_progress, token) => {
        const outDir = path.join(featureDir, '.out');
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.mkdirSync(outDir, { recursive: true });
        const ctx: Ctx = { root, featureDir, outDir, scenario, id, config, token };
        const code = platform === 'web' ? await recordWeb(ctx) : await recordMobile(ctx, platform);
        const hasVideo = fs.existsSync(outDir) && listVideos(outDir).length > 0;
        if (token.isCancellationRequested) vscode.window.showInformationMessage('Recording cancelled.');
        else if (!hasVideo) vscode.window.showErrorMessage('No video was produced. Check the HLens output panel.');
        else if (code !== 0) vscode.window.showWarningMessage('The scenario failed. The video only covers the run up to the failure.');
        else vscode.window.showInformationMessage('Video recorded. Open the Demo tab to watch it.');
      },
    );
  } catch (e) {
    vscode.window.showErrorMessage(`Recording failed: ${(e as Error).message}`);
  } finally {
    busy = false;
    onDone();
  }
}

function hasPlaywright(root: string): boolean {
  try {
    require.resolve('@playwright/test', { paths: [root] });
    return true;
  } catch {
    return false;
  }
}

/** Installs Playwright (after asking) if it is missing. Returns true when it is ready. */
async function ensurePlaywright(root: string): Promise<boolean> {
  if (hasPlaywright(root)) return true;
  const pick = await vscode.window.showInformationMessage(
    'Recording web videos needs Playwright. Install it in this project? (adds @playwright/test as a devDependency and downloads Chromium)',
    'Install',
  );
  if (!pick) return false;
  output.clear();
  output.show(true);
  const init = fs.existsSync(path.join(root, 'package.json')) ? '' : 'npm init -y && ';
  const code = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Installing Playwright…', cancellable: true },
    (_p, token) => run(`${init}npm i -D @playwright/test && npx playwright install chromium`, root, token),
  );
  if (code !== 0 || !hasPlaywright(root)) {
    vscode.window.showErrorMessage('Playwright installation failed. Check the HLens output panel.');
    return false;
  }
  return true;
}

function listVideos(dir: string): string[] {
  const found: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/\.(webm|mp4)$/i.test(e.name)) found.push(full);
    }
  }
  return found;
}

// ───────────── web (Playwright) ─────────────

async function recordWeb(ctx: Ctx): Promise<number> {
  const { root, config, scenario, outDir } = ctx;
  const featuresRoot = path.join(root, FEATURES_DIR);
  const authFile = config.auth ? path.resolve(featuresRoot, config.auth) : undefined;
  const hasAuth = !!authFile && fs.existsSync(authFile);
  const stateFile = path.join(featuresRoot, '.auth', 'state.json');
  const q = (p: string) => JSON.stringify(p.split(path.sep).join('/'));

  const projects = hasAuth
    ? `[
      { name: 'setup', testMatch: ${q(authFile!)}, use: { video: 'off' } },
      { name: 'feature', testMatch: ${q(scenario)}, dependencies: ['setup'], use: { storageState: ${q(stateFile)} } },
    ]`
    : `[{ name: 'feature', testMatch: ${q(scenario)} }]`;

  const baseUrl = config.baseUrl ?? 'http://localhost:3000';
  const webServer = config.devCommand
    ? `{ command: ${JSON.stringify(config.devCommand)}, url: ${JSON.stringify(baseUrl)}, reuseExistingServer: true, timeout: 120000 }`
    : 'undefined';

  // Lives inside .features so the project's @playwright/test can be resolved (git-ignored).
  const configPath = path.join(featuresRoot, '.playwright.config.cjs');
  fs.writeFileSync(
    configPath,
    `const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: ${q(featuresRoot)},
  outputDir: ${q(outDir)},
  reporter: 'line',
  workers: 1,
  retries: 0,
  use: { baseURL: ${JSON.stringify(baseUrl)}, video: { mode: 'on', size: { width: 1280, height: 720 } } },
  webServer: ${webServer},
  projects: ${projects},
});
`,
  );
  try {
    return await run(`npx --no-install playwright test --config ${JSON.stringify(configPath)}`, root, ctx.token);
  } finally {
    fs.rmSync(configPath, { force: true });
  }
}

// ───────────── ios / android (simulator or emulator + flutter test) ─────────────

async function recordMobile(ctx: Ctx, platform: 'ios' | 'android'): Promise<number> {
  const { root, config, scenario, outDir, id } = ctx;
  const device = await resolveDevice(platform, config.device, root);
  const video = path.join(outDir, 'scenario.mp4');
  const start = () => (platform === 'ios' ? startIosRecording(device, video) : startAndroidRecording(device));

  // Flutter only treats files under integration_test/ as on-device integration tests.
  // Anywhere else it runs as a plain widget test without plugins and throws MissingPluginException.
  const runnable = path.join(root, 'integration_test', `fv_${id.replace(/[\\/]/g, '_')}_scenario.dart`);
  fs.mkdirSync(path.dirname(runnable), { recursive: true });
  fs.copyFileSync(scenario, runnable);

  const cmd = (config.testCommand ?? DEFAULT_TEST_COMMAND)
    .replace(/\{scenario\}/g, JSON.stringify(path.relative(root, runnable)))
    .replace(/\{device\}/g, JSON.stringify(device))
    .replace(/\{id\}/g, id);

  // `flutter test` builds and installs the app first, which can take a minute. Recording from the
  // beginning would capture that idle time, so wait until the test body starts ("+0: <test name>").
  // Other commands cannot be observed this way, so they are recorded from the start.
  const gated = /\bflutter\s+test\b/.test(cmd);
  let recorder: Recorder | undefined;
  let starting: Promise<void> | undefined;
  const startOnce = () => (starting ??= Promise.resolve(start()).then((r: Recorder) => void (recorder = r)));
  if (!gated) await startOnce();

  let code = 1;
  let buffer = '';
  try {
    code = await run(cmd, root, ctx.token, (chunk) => {
      if (!gated || starting) return;
      buffer = (buffer + chunk).slice(-2000);
      if (/\+\d+: [^l(]/.test(buffer)) void startOnce();
    });
    await sleep(1500); // keep the final screen in the video
  } finally {
    fs.rmSync(runnable, { force: true });
    await starting;
    if (recorder) {
      await recorder.stop();
      if (platform === 'android') await pullAndroidVideo(device, video);
    }
  }
  return code;
}

interface Recorder {
  stop(): Promise<void>;
}

async function startIosRecording(udid: string, file: string): Promise<Recorder> {
  const proc = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', file]);
  pipe(proc);
  return { stop: () => interruptAndWait(proc) };
}

const ANDROID_REMOTE = '/sdcard/hlens.mp4';

function startAndroidRecording(serial: string): Recorder {
  // screenrecord has a device-side limit (180s by default); keep scenarios shorter than that.
  const proc = spawn('adb', ['-s', serial, 'shell', 'screenrecord', '--bit-rate', '4000000', ANDROID_REMOTE]);
  pipe(proc);
  return {
    stop: async () => {
      await exec('adb', ['-s', serial, 'shell', 'pkill', '-2', 'screenrecord']); // SIGINT lets screenrecord finalize the file
      await waitExit(proc, 10000);
      await sleep(1000);
    },
  };
}

async function pullAndroidVideo(serial: string, file: string) {
  await exec('adb', ['-s', serial, 'pull', ANDROID_REMOTE, file]);
  await exec('adb', ['-s', serial, 'shell', 'rm', ANDROID_REMOTE]);
}

async function resolveDevice(platform: 'ios' | 'android', configured: string | undefined, root: string): Promise<string> {
  if (platform === 'ios') {
    if (configured && configured !== 'booted') return configured;
    const out = await exec('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], root);
    const devices = Object.values(JSON.parse(out).devices as Record<string, { udid: string; state: string }[]>).flat();
    const booted = devices.find((d) => d.state === 'Booted');
    if (!booted) throw new Error('No booted iOS simulator found. Boot one first, or set "device" in .features/config.json.');
    return booted.udid;
  }
  if (configured) return configured;
  const out = await exec('adb', ['devices'], root);
  const serial = out
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .find((c) => c[1] === 'device')?.[0];
  if (!serial) throw new Error('No Android device or emulator connected. Start one first, or set "device" in .features/config.json.');
  return serial;
}

// ───────────── process helpers ─────────────

function pipe(proc: ChildProcess) {
  proc.stdout?.on('data', (d) => output.append(String(d)));
  proc.stderr?.on('data', (d) => output.append(String(d)));
}

/** Runs a shell command and resolves with its exit code. Cancelling interrupts the process. */
function run(command: string, cwd: string, token: vscode.CancellationToken, onData?: (chunk: string) => void): Promise<number> {
  output.appendLine(`$ ${command}`);
  return new Promise((resolve, reject) => {
    const proc = spawn(command, { cwd, shell: true });
    pipe(proc);
    if (onData) {
      proc.stdout?.on('data', (d) => onData(String(d)));
      proc.stderr?.on('data', (d) => onData(String(d)));
    }
    const sub = token.onCancellationRequested(() => proc.kill('SIGINT'));
    proc.on('error', reject);
    proc.on('close', (code) => {
      sub.dispose();
      resolve(code ?? 1);
    });
  });
}

function exec(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} failed: ${err.trim() || `exit code ${code}`}`)),
    );
  });
}

function waitExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, timeoutMs);
    proc.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function interruptAndWait(proc: ChildProcess): Promise<void> {
  proc.kill('SIGINT'); // simctl needs SIGINT to finalize the mp4
  return waitExit(proc, 10000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
