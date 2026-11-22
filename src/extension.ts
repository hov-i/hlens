import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FEATURES_DIR } from './features';
import { FeatureTreeProvider } from './tree';
import { FeaturePanel } from './panel';
import { offerFirstRun, runGenerate } from './generate';
import { recordFeature } from './record';

export function activate(context: vscode.ExtensionContext) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const tree = new FeatureTreeProvider(root);
  const panel = new FeaturePanel(context, tree, root);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('hlens.list', tree),
    vscode.commands.registerCommand('hlens.refresh', () => {
      tree.reload();
      panel.refresh();
    }),
    vscode.commands.registerCommand('hlens.open', (id: string) => panel.show(id)),
    vscode.commands.registerCommand('hlens.record', (arg?: string | { id: string }) => {
      if (!root) return vscode.window.showWarningMessage('Open a project folder first.');
      const id = typeof arg === 'string' ? arg : arg?.id;
      if (!id) return vscode.window.showWarningMessage('Pick a feature in the sidebar first.');
      return recordFeature(root, id, () => {
        tree.reload();
        panel.refresh();
      });
    }),
    vscode.commands.registerCommand('hlens.init', () => {
      if (!root) return vscode.window.showWarningMessage('Open a project folder first.');
      init(context, root, tree);
      vscode.window.showInformationMessage('HLens is ready. Ask your agent to build a feature and it will show up in this list.');
    }),
    vscode.commands.registerCommand('hlens.generate', () => {
      if (!root) return vscode.window.showWarningMessage('Open a project folder first.');
      runGenerate(root, () => init(context, root, tree));
    }),
  );

  if (root) offerFirstRun(context, root, fs.existsSync(path.join(root, FEATURES_DIR, 'RULES.md')), () => init(context, root, tree));

  if (root) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, `${FEATURES_DIR}/**`),
    );
    let timer: NodeJS.Timeout | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        tree.reload();
        panel.refresh();
      }, 300);
    };
    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    context.subscriptions.push(watcher);
  }
}

function init(context: vscode.ExtensionContext, root: string, tree: FeatureTreeProvider) {
  const kit = path.join(context.extensionPath, 'templates', 'kit');
  const base = path.join(root, FEATURES_DIR);
  fs.mkdirSync(base, { recursive: true });

  // RULES.md is the single source of truth; agent files only get a one-line reference.
  fs.copyFileSync(path.join(kit, 'RULES.md'), path.join(base, 'RULES.md'));
  copyIfMissing(path.join(kit, 'config.json'), path.join(base, 'config.json'));
  copyIfMissing(path.join(kit, 'features.gitignore'), path.join(base, '.gitignore'));
  appendOnce(path.join(root, 'AGENTS.md'), 'When adding or changing a feature, follow the rules in `.features/RULES.md`.');
  appendOnce(path.join(root, 'CLAUDE.md'), '@.features/RULES.md');

  tree.reload();
}

function copyIfMissing(from: string, to: string) {
  if (!fs.existsSync(to)) fs.copyFileSync(from, to);
}

function appendOnce(file: string, line: string) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.includes(line)) return;
  const sep = current && !current.endsWith('\n') ? '\n\n' : current ? '\n' : '';
  fs.writeFileSync(file, `${current}${sep}${line}\n`);
}

export function deactivate() {}
