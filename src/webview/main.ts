import { Markmap, deriveOptions } from 'markmap-view';
import type { IPureNode } from 'markmap-common';

interface PanelData {
  id: string;
  name: string;
  status: string;
  hasReview: boolean;
  intentHtml?: string;
  mindmap?: { root: IPureNode; options?: Record<string, unknown> };
  videoUri?: string;
  scenarioFile?: string;
  platform: string;
  files: string[];
}

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage: () => {} };

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', review: 'Needs review', approved: 'Approved' };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let markmap: Markmap | undefined;
let lastRoot: IPureNode | undefined;
let currentTab = 'intent';

function selectTab(tab: string) {
  currentTab = tab;
  document.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  });
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('active', s.id === `tab-${tab}`));
  if (tab === 'impl') markmap?.fit();
}

document.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) =>
  b.addEventListener('click', () => selectTab(b.dataset.tab!)),
);
$('record').addEventListener('click', () => vscode.postMessage({ type: 'record' }));
$('fit').addEventListener('click', () => markmap?.fit());
$('expand').addEventListener('click', () => {
  if (!markmap || !lastRoot) return;
  const open = (n: IPureNode) => {
    n.payload = { ...n.payload, fold: 0 };
    n.children?.forEach(open);
  };
  open(lastRoot);
  markmap.setData(lastRoot);
  markmap.fit();
});

// Links inside the mind map and intent are handled by VS Code (open a file, jump to another feature)
document.addEventListener(
  'click',
  (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    vscode.postMessage({ type: 'link', href: a.getAttribute('href') });
  },
  true,
);

function render(data: PanelData) {
  $('name').textContent = data.name;
  const status = $('status');
  status.textContent = STATUS_LABEL[data.status] ?? data.status;
  status.className = `badge ${data.status}`;
  $('review').textContent = data.hasReview ? 'Has review comments' : '';
  $('path').textContent = `.features/${data.id}`;

  $('intent').innerHTML =
    data.intentHtml ??
    `<p class="empty">No <code>intent.md</code> yet. It is written here when your agent works on this feature.</p>`;

  const svg = $<HTMLElement>('mindmap');
  const implEmpty = $('impl-empty');
  if (data.mindmap) {
    svg.style.display = '';
    implEmpty.style.display = 'none';
    lastRoot = data.mindmap.root;
    const options = { ...deriveOptions(data.mindmap.options as never), maxInitialScale: 1 };
    if (!markmap) markmap = Markmap.create(svg as unknown as SVGElement, options, lastRoot);
    else {
      markmap.setOptions(options);
      markmap.setData(lastRoot);
    }
    if (currentTab === 'impl') markmap.fit();
  } else {
    svg.style.display = 'none';
    implEmpty.style.display = '';
    implEmpty.innerHTML = 'No <code>implementation.mm.md</code> yet.';
  }

  const PLATFORM_LABEL: Record<string, string> = { web: 'Web (Playwright)', ios: 'iOS simulator', android: 'Android emulator' };
  const record = $<HTMLButtonElement>('record');
  const wanted = data.platform === 'web' ? 'scenario.spec.ts' : 'scenario.dart';
  record.disabled = false;
  record.textContent = !data.scenarioFile ? 'Create scenario' : data.videoUri ? 'Re-record' : 'Record video';
  $('record-hint').textContent = data.scenarioFile
    ? `${PLATFORM_LABEL[data.platform] ?? data.platform} · ${data.scenarioFile}`
    : `${wanted} does not exist yet. Click to have Claude Code create it (${PLATFORM_LABEL[data.platform] ?? data.platform})`;

  $('video').innerHTML = data.videoUri
    ? `<video controls preload="metadata" src="${data.videoUri}"></video>`
    : `<p class="empty">No video yet.<br>Click <b>Record video</b> above to run the scenario and save the recording to <code>.features/${data.id}/.out/</code>.</p>`;
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'feature') render(msg.data);
  if (msg.type === 'missing') {
    $('name').textContent = 'Feature not found';
    $('path').textContent = `.features/${msg.id}`;
  }
});

vscode.postMessage({ type: 'ready' });

// for the preview harness
(window as unknown as { __render: typeof render; __select: typeof selectTab }).__render = render;
(window as unknown as { __select: typeof selectTab }).__select = selectTab;
