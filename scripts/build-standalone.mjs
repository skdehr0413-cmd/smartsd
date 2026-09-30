// 서버 없이 여는 단일 HTML 데모를 만든다.
// 업무 엔진까지 한 파일에 묶고, 데이터는 브라우저 localStorage 에 저장한다.
// 데모 이야기(오늘 진행 중인 작업 등)가 어긋나지 않도록 기준 시각을 캡처와 같은 2026-09-29 10:30 으로 고정한다.
//   docs/demo/smartsd-demo.html  — 더블클릭으로 여는 오프라인 데모 (완전한 HTML 문서)
//   dist/artifact.html           — 웹 게시용 본문 조각 (<head> 없이 title·style·script 만)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 브라우저는 /core/* 를 서버에서 받지만(src/core), 번들러에게는 실제 위치를 알려 준다.
const coreAlias = {
  name: 'core-alias',
  setup(b) {
    b.onResolve({ filter: /(^|\/)core\/[\w-]+\.js$/ }, (args) => {
      const resolved = path.resolve(args.resolveDir, args.path);
      const publicCore = path.join(root, 'public/core') + path.sep;
      if (!resolved.startsWith(publicCore)) return undefined;
      return { path: path.join(root, 'src/core', path.basename(resolved)) };
    });
  },
};

const out = await build({
  plugins: [coreAlias],
  entryPoints: [path.join(root, 'public/js/app.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
const icon = `data:image/svg+xml,${encodeURIComponent(fs.readFileSync(path.join(root, 'public/icon.svg'), 'utf8'))}`;

const body = `<div id="app"><div class="boot">불러오는 중…</div></div>
<div id="modal-root"></div>
<div id="toasts" class="toasts" aria-live="polite"></div>
<script>window.SMARTSD_STANDALONE = true; window.SMARTSD_NOW = '2026-09-29T10:30';</script>
<script>${js}</script>`;

const full = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#15232e">
<title>스마트설비 데모</title>
<link rel="icon" href="${icon}">
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>
`;

const fragment = `<title>스마트설비 데모</title>
<style>${css}</style>
${body}
`;

fs.mkdirSync(path.join(root, 'docs/demo'), { recursive: true });
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/demo/smartsd-demo.html'), full);
fs.writeFileSync(path.join(root, 'dist/artifact.html'), fragment);
console.log(`단독 데모 생성: docs/demo/smartsd-demo.html (${Math.round(full.length / 1024)}KB), dist/artifact.html`);
