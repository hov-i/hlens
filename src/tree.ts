import * as vscode from 'vscode';
import { FeatureNode, scanFeatures } from './features';

const STATUS_LABEL = { draft: 'Draft', review: 'Needs review', approved: 'Approved' } as const;
const STATUS_ICON = {
  draft: new vscode.ThemeIcon('edit', new vscode.ThemeColor('descriptionForeground')),
  review: new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.yellow')),
  approved: new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green')),
} as const;

export class FeatureTreeProvider implements vscode.TreeDataProvider<FeatureNode> {
  private readonly emitter = new vscode.EventEmitter<FeatureNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private roots: FeatureNode[] = [];

  constructor(private readonly workspaceRoot: string | undefined) {
    this.reload();
  }

  reload() {
    this.roots = this.workspaceRoot ? scanFeatures(this.workspaceRoot) : [];
    vscode.commands.executeCommand('setContext', 'hlens.hasFeatures', this.roots.length > 0);
    this.emitter.fire(undefined);
  }

  hasFeatures() {
    return this.roots.length > 0;
  }

  findById(id: string, nodes = this.roots): FeatureNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = this.findById(id, node.children);
      if (found) return found;
    }
    return undefined;
  }

  getChildren(node?: FeatureNode): FeatureNode[] {
    return node ? node.children : this.roots;
  }

  getTreeItem(node: FeatureNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.id;

    if (!node.isFeature) {
      item.iconPath = vscode.ThemeIcon.Folder;
      item.contextValue = 'group';
      return item;
    }

    const status = node.meta?.status ?? 'draft';
    item.iconPath = STATUS_ICON[status] ?? STATUS_ICON.draft;
    item.description = [STATUS_LABEL[status] ?? status, node.hasReview ? 'Has comments' : '']
      .filter(Boolean)
      .join(' · ');
    item.tooltip = `${node.label}\n.features/${node.id}`;
    item.contextValue = 'feature';
    item.command = { command: 'hlens.open', title: 'Open feature', arguments: [node.id] };
    return item;
  }
}
