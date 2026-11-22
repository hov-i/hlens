import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import MarkdownIt from 'markdown-it';
import { Transformer } from 'markmap-lib';
import { FEATURES_DIR, findVideo, readText, resolvePlatform, scenarioFileName } from './features';
import { FeatureTreeProvider } from './tree';

const md = new MarkdownIt({ html: false, linkify: true });
const transformer = new Transformer();

export interface PanelData {
  id: string;
  name: string;
  status: string;
  hasReview: boolean;
  intentHtml?: string;
  mindmap?: { root: unknown; options?: unknown };
  videoUri?: string;
  /** Scenario file used for recording; undefined if missing. */
  scenarioFile?: string;
  /** Current platform (web | ios | android). */
  platform: string;
  files: string[];
}

export class FeaturePanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentId: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tree: FeatureTreeProvider,
    private readonly root: string | undefined,
  ) {}

  show(id: string) {
    this.currentId = id;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('hlens.detail', 'Feature', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
          ...(this.root ? [vscode.Uri.file(path.join(this.root, FEATURES_DIR))] : []),
        ],
      });
      this.panel.webview.html = this.html(this.panel.webview);
      this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
      this.panel.onDidDispose(() => (this.panel = undefined));
    } else {
      this.panel.reveal();
    }
    this.post();
  }

  refresh() {
    if (this.panel && this.currentId) this.post();
  }

  private post() {
    if (!this.panel || !this.currentId) return;
    const node = this.tree.findById(this.currentId);
    if (!node) {
      this.panel.webview.postMessage({ type: 'missing', id: this.currentId });
      return;
    }
    this.panel.title = node.label;

    const intent = readText(path.join(node.dir, 'intent.md'));
    const impl = readText(path.join(node.dir, 'implementation.mm.md'));
    const video = findVideo(node.dir);

    const platform = this.root ? resolvePlatform(this.root) : 'web';
    const scenarioName = scenarioFileName(platform);

    let mindmap: PanelData['mindmap'];
    if (impl) {
      const { root, frontmatter } = transformer.transform(impl);
      mindmap = { root, options: (frontmatter as { markmap?: unknown } | undefined)?.markmap };
    }

    const data: PanelData = {
      id: node.id,
      name: node.label,
      status: node.meta?.status ?? 'draft',
      hasReview: node.hasReview,
      intentHtml: intent ? md.render(intent) : undefined,
      mindmap,
      videoUri: video
        ? this.panel.webview.asWebviewUri(vscode.Uri.file(video)).toString() + `?t=${fs.statSync(video).mtimeMs}`
        : undefined,
      scenarioFile: fs.existsSync(path.join(node.dir, scenarioName)) ? scenarioName : undefined,
      platform,
      files: node.meta?.files ?? [],
    };
    this.panel.webview.postMessage({ type: 'feature', data });
  }

  private async onMessage(msg: { type: string; href?: string }) {
    if (msg.type === 'ready') return this.post();
    if (msg.type === 'openVideo' && this.currentId) {
      const node = this.tree.findById(this.currentId);
      const video = node && findVideo(node.dir);
      if (video) openWithSystemPlayer(video);
      return;
    }
    if (msg.type === 'record' && this.currentId) {
      vscode.commands.executeCommand('hlens.record', this.currentId);
      return;
    }
    if (msg.type !== 'link' || !msg.href || !this.root || !this.currentId) return;

    const href = decodeURI(msg.href.split('#')[0]);
    if (/^[a-z]+:\/\//i.test(href)) {
      vscode.env.openExternal(vscode.Uri.parse(msg.href));
      return;
    }

    const node = this.tree.findById(this.currentId);
    const target = href.startsWith('/') ? path.join(this.root, href) : path.resolve(node?.dir ?? this.root, href);

    // If the link points at another feature, open it in the panel.
    const featuresRoot = path.join(this.root, FEATURES_DIR);
    if (target.startsWith(featuresRoot)) {
      const dir = fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : path.dirname(target);
      const id = path.relative(featuresRoot, dir).split(path.sep).join('/');
      if (this.tree.findById(id)) return this.show(id);
    }

    if (!fs.existsSync(target)) {
      vscode.window.showWarningMessage(`File not found: ${href}`);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(target);
    vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return renderShell({ cspSource: webview.cspSource, nonce, scriptUri: script.toString() });
  }
}

export function renderShell({ cspSource, nonce, scriptUri }: { cspSource: string; nonce: string; scriptUri: string }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: https:; media-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root { --gap: 16px; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  header { padding: 20px 24px 0; }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
  .meta { display: flex; gap: 8px; align-items: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .badge { padding: 2px 8px; border-radius: 10px; border: 1px solid var(--vscode-panel-border); }
  .badge.review { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
  .badge.approved { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
  nav { display: flex; gap: 4px; padding: 16px 24px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  nav button { background: none; border: none; color: var(--vscode-descriptionForeground); padding: 8px 12px; cursor: pointer; font: inherit; border-bottom: 2px solid transparent; }
  nav button[aria-selected="true"] { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
  section { display: none; padding: 20px 24px; }
  section.active { display: block; }
  #tab-impl.active { display: flex; flex-direction: column; padding: 0; height: calc(100vh - 140px); }
  #mindmap { flex: 1; width: 100%; --markmap-text-color: var(--vscode-foreground); --markmap-a-color: var(--vscode-textLink-foreground); --markmap-code-bg: var(--vscode-textCodeBlock-background); --markmap-code-color: var(--vscode-foreground); --markmap-circle-open-bg: var(--vscode-editor-background); }
  .toolbar { display: flex; gap: 6px; padding: 10px 24px; }
  .toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12px; }
  .intent { max-width: 720px; line-height: 1.6; }
  .intent h1 { display: none; }
  .intent h2 { font-size: 14px; margin: 24px 0 8px; }
  .intent h2:first-of-type { margin-top: 0; }
  .intent code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
  video { width: 100%; max-width: 960px; border-radius: 6px; background: #000; }
  /* Webviews usually block the browser Fullscreen API, so "full screen" fills the panel instead. */
  #video.fs { position: fixed; inset: 0; z-index: 1000; background: #000; display: flex; align-items: center; justify-content: center; }
  #video.fs video { width: auto; max-width: 100%; height: 100%; max-height: 100%; border-radius: 0; object-fit: contain; }
  #fs-close { display: none; position: fixed; top: 12px; right: 12px; z-index: 1001; opacity: .85; }
  #fs-close.on { display: block; }
  .hint { align-self: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .toolbar button:disabled { opacity: .5; cursor: default; }
  .empty { color: var(--vscode-descriptionForeground); padding: 24px 0; line-height: 1.6; }
  .empty code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
</style>
</head>
<body>
<header>
  <h1 id="name"></h1>
  <div class="meta"><span id="status" class="badge"></span><span id="review"></span><span id="path"></span></div>
</header>
<nav role="tablist">
  <button role="tab" data-tab="intent" aria-selected="true">Intent</button>
  <button role="tab" data-tab="impl" aria-selected="false">Implementation</button>
  <button role="tab" data-tab="video" aria-selected="false">Demo</button>
</nav>
<section id="tab-intent" class="active"><div id="intent" class="intent"></div></section>
<section id="tab-impl">
  <div class="toolbar"><button id="fit">Fit to screen</button><button id="expand">Expand all</button></div>
  <svg id="mindmap"></svg>
  <div id="impl-empty" class="empty" style="display:none;padding:24px"></div>
</section>
<button id="fs-close" title="Exit full screen (Esc)">✕ Close</button>
<section id="tab-video">
  <div class="toolbar" style="padding:0 0 12px"><button id="record">Record video</button><button id="fullscreen" disabled>Full screen</button><button id="external" disabled>Open in player</button><span id="record-hint" class="hint"></span></div>
  <div id="video"></div>
</section>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/** Opens a file with the operating system's default application. */
function openWithSystemPlayer(file: string) {
  if (process.platform === 'darwin') execFile('open', [file]);
  else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', file]);
  else execFile('xdg-open', [file]);
}
