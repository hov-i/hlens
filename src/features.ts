import * as fs from 'fs';
import * as path from 'path';

export type FeatureStatus = 'draft' | 'review' | 'approved';

export interface FeatureMeta {
  name?: string;
  status?: FeatureStatus;
  files?: string[];
  sourceHash?: string;
}

export interface FeatureNode {
  /** Path relative to .features, e.g. login/social */
  id: string;
  dir: string;
  label: string;
  isFeature: boolean;
  meta?: FeatureMeta;
  hasReview: boolean;
  children: FeatureNode[];
}

export const FEATURES_DIR = '.features';

export type Platform = 'web' | 'ios' | 'android';

/** .features/config.json. If platform is omitted it is detected from the project. */
export interface FeatureConfig {
  platform?: Platform;
  /** web: server URL */
  baseUrl?: string;
  /** web: command that starts the dev server */
  devCommand?: string;
  /** web: login setup file (Playwright). ios/android: signIn helper (Dart). */
  auth?: string;
  /** ios/android: scenario command. {scenario}, {device} and {id} are substituted. */
  testCommand?: string;
  /** ios/android: device identifier. Defaults to the booted simulator/emulator. */
  device?: string;
}

export const DEFAULT_TEST_COMMAND = 'flutter test {scenario} -d {device}';

export function readConfig(root: string): FeatureConfig {
  const text = readText(path.join(root, FEATURES_DIR, 'config.json'));
  if (!text) return {};
  try {
    return JSON.parse(text) as FeatureConfig;
  } catch {
    return {};
  }
}

/**
 * Uses config.json's platform if set; otherwise detects it from the project:
 * a pubspec.yaml with flutter means mobile (ios on macOS, android elsewhere), anything else is web.
 */
export function resolvePlatform(root: string): Platform {
  const configured = readConfig(root).platform;
  if (configured) return configured;
  const pubspec = readText(path.join(root, 'pubspec.yaml'));
  if (pubspec && /^\s*flutter\s*:/m.test(pubspec)) return process.platform === 'darwin' ? 'ios' : 'android';
  return 'web';
}

export function scenarioFileName(platform: Platform | undefined): string {
  return !platform || platform === 'web' ? 'scenario.spec.ts' : 'scenario.dart';
}
const MAX_DEPTH = 3;

export function readMeta(dir: string): FeatureMeta | undefined {
  const file = path.join(dir, 'meta.json');
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FeatureMeta;
  } catch {
    return {};
  }
}

export function scanFeatures(root: string): FeatureNode[] {
  const base = path.join(root, FEATURES_DIR);
  if (!fs.existsSync(base)) return [];
  return scanDir(base, '', 1);
}

function scanDir(dir: string, idPrefix: string, depth: number): FeatureNode[] {
  if (depth > MAX_DEPTH) return [];
  const nodes: FeatureNode[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const childDir = path.join(dir, entry.name);
    const id = idPrefix ? `${idPrefix}/${entry.name}` : entry.name;
    const meta = readMeta(childDir);
    const children = scanDir(childDir, id, depth + 1);
    if (!meta && children.length === 0) continue;
    nodes.push({
      id,
      dir: childDir,
      label: meta?.name || entry.name,
      isFeature: !!meta,
      meta,
      hasReview: fs.existsSync(path.join(childDir, '.review.md')),
      children,
    });
  }
  return nodes.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

export function findVideo(dir: string): string | undefined {
  const out = path.join(dir, '.out');
  if (!fs.existsSync(out)) return undefined;
  const stack = [out];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(webm|mp4)$/i.test(entry.name)) return full;
    }
  }
  return undefined;
}

export function readText(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}
