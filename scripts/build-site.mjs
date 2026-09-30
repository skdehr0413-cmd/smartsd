// 제출용 공개 사이트를 만든다: 사업 기획서 + 화면 캡처 + 테스트 결과를 한 페이지로 묶고
// 서버 없이 도는 데모(docs/demo/smartsd-demo.html)로 연결한다.
//   node scripts/build-site.mjs            → docs/index.html (GitHub Pages: /docs 폴더 게시)
//   node scripts/build-site.mjs artifact   → dist/report.html + dist/report-files.json (웹 게시용 조각)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] === 'artifact' ? 'artifact' : 'pages';
const GH = 'https://github.com/skdehr0413-cmd/smartsd/blob/claude/wizardly-keller-8qpafm/';
const DEMO = mode === 'pages' ? 'demo/smartsd-demo.html' : (process.argv[3] || 'demo/smartsd-demo.html');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render(file) {
  let html = marked.parse(fs.readFileSync(path.join(root, file), 'utf8'), { gfm: true });
  // 문서 사이 링크는 페이지 안 섹션으로, 데모는 데모로, 나머지는 저장소(GitHub)로 연결
  html = html.replace(/href="([^"]+)"/g, (m, href) => {
    if (/^(https?:|mailto:)/.test(href)) return `href="${href}" target="_blank" rel="noopener"`;
    if (href.startsWith('#')) return m;
    const clean = href.split('#')[0];
    if (/test-report\.md$/.test(clean)) return 'href="#tests"';
    if (/business-plan\.md$/.test(clean)) return 'href="#plan"';
    if (/screenshots\/(README\.md)?$/.test(clean)) return 'href="#screens"';
    if (/demo\/smartsd-demo\.html$/.test(clean)) return `href="${DEMO}" target="_blank" rel="noopener"`;
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(file), clean));
    return `href="${GH}${abs}" target="_blank" rel="noopener"`;
  });
  html = html.replace(/<(\/?)h([1-5])>/g, (m, slash, n) => `<${slash}h${Number(n) + 1}>`); // 페이지 h1 아래로 한 단계씩
  return html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
}

// 화면 캡처와 설명
const shotsDir = path.join(root, 'docs/screenshots');
const files = fs.readdirSync(shotsDir).filter((f) => f.endsWith('.png')).sort();
const captions = {};
for (const line of fs.readFileSync(path.join(shotsDir, 'README.md'), 'utf8').split('\n')) {
  const m = /!\[\]\(([^)]+)\)\s*\|\s*\*\*(.+?)\*\*\s*—\s*(.+?)\s*\|/.exec(line);
  if (m) captions[m[1]] = { title: m[2], text: m[3] };
  for (const mm of line.matchAll(/!\[\]\(([^)]+)\)<br>([^|]+)/g)) captions[mm[1]] = { title: mm[2].trim(), text: '' };
}
const mapping = {};
function figure(f, kind, i) {
  const src = mode === 'pages' ? `screenshots/${encodeURIComponent(f)}` : `shots/${kind}-${String(i + 1).padStart(2, '0')}.png`;
  if (mode === 'artifact') mapping[src] = path.join(shotsDir, f);
  const c = captions[f] || { title: f, text: '' };
  const [w, h] = kind === 'pc' ? [1440, 900] : [780, 1688];
  return `<figure class="shot ${kind}"><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(c.title)} 화면" loading="lazy" width="${w}" height="${h}"></a><figcaption><strong>${esc(c.title)}</strong>${c.text ? ` ${esc(c.text)}` : ''}</figcaption></figure>`;
}
const byKind = (k) => files.filter((f) => f.startsWith(`${k}-`)).map((f, i) => figure(f, k, i)).join('\n');

const tpl = fs.readFileSync(path.join(root, 'scripts/site/template.html'), 'utf8');
const content = tpl
  .replace('{{PLAN}}', render('docs/business-plan.md'))
  .replace('{{TESTS}}', render('docs/test-report.md'))
  .replace('{{PC}}', byKind('pc'))
  .replace('{{MOBILE}}', byKind('mobile'))
  .replaceAll('{{DEMO}}', DEMO)
  .replaceAll('{{GH}}', GH);

if (mode === 'pages') {
  const split = content.indexOf('<div class="page">');
  const page = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="스마트설비 — 소규모 배관 설비 업체용 현장·정산 관리 웹앱 제출물: 사업 기획서, PC·휴대폰 화면, 테스트 결과, 실제 작동 데모">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(fs.readFileSync(path.join(root, 'public/icon.svg'), 'utf8'))}">
${content.slice(0, split)}</head>
<body>
${content.slice(split)}</body>
</html>
`;
  fs.writeFileSync(path.join(root, 'docs/index.html'), page);
  fs.writeFileSync(path.join(root, 'docs/.nojekyll'), '');
  console.log(`공개 사이트 생성: docs/index.html (${Math.round(page.length / 1024)}KB)`);
} else {
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/report.html'), content);
  fs.writeFileSync(path.join(root, 'dist/report-files.json'), JSON.stringify(mapping, null, 1));
  console.log(`게시용 보고서 생성: dist/report.html, 이미지 ${Object.keys(mapping).length}장`);
}
