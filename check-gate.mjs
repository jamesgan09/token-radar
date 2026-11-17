// Local mirror of the token-radar-01 gate's seven checks. Not the sealed scorer — a
// pre-flight that fails loudly on the same shapes it refuses.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'out';
const SNAP = JSON.parse(readFileSync('input/snapshot.json', 'utf8'));
const fails = [];
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fails.push(name);
};

// --- dashboard_files ---
const dashDir = join(OUT, 'dashboard');
const dashFiles = existsSync(dashDir) ? readdirSync(dashDir).filter((f) => statSync(join(dashDir, f)).isFile() && !f.startsWith('.')) : [];
const hasHtml = dashFiles.includes('index.html');
const hasCss = dashFiles.some((f) => f.endsWith('.css'));
const hasJs = dashFiles.some((f) => f.endsWith('.js'));
const dashBytes = dashFiles.reduce((s, f) => s + statSync(join(dashDir, f)).size, 0);
let netRef = null;
for (const f of dashFiles) {
  const text = readFileSync(join(dashDir, f), 'utf8');
  if (/https?:\/\//.test(text) && (f.endsWith('.css') || f.endsWith('.js'))) { netRef = f; break; }
  if (f.endsWith('.html') && /<(a|link|script|img)[^>]*(href|src)\s*=\s*["']https?:\/\//i.test(text)) { netRef = f; break; }
}
ok('dashboard_files', hasHtml && hasCss && hasJs && dashFiles.length <= 400 && dashBytes <= 4_194_304 && !netRef,
  `${dashFiles.length} files, ${dashBytes} bytes${netRef ? ', network ref in ' + netRef : ''}`);

// --- board_file ---
const boardPath = join(OUT, 'board.json');
const boardBytes = statSync(boardPath).size;
const board = JSON.parse(readFileSync(boardPath, 'utf8'));
const rows = board.rows ?? board;
const snapSlugs = new Set(SNAP.protocols.map((p) => p.slug));
const badSlug = rows.find((r) => !snapSlugs.has(r.slug));
const badRow = rows.find((r) =>
  typeof r.slug !== 'string' || !r.name || !Number.isSafeInteger(r.rank) ||
  !Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 ||
  r.implied_value_usd > 100_000_000_000_000 || !Array.isArray(r.farm_steps));
ok('board_file', Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000 && boardBytes <= 8_388_608 && !badSlug && !badRow,
  `${rows.length} rows, ${boardBytes} bytes${badSlug ? ', invented slug ' + badSlug.slug : ''}${badRow ? ', bad row ' + badRow.slug : ''}`);

// --- sorted_by_value ---
const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
const ranksOk = ranks.every((v, i) => v === i + 1);
const orderOk = rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd);
const allSame = rows.length >= 2 && rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd;
ok('sorted_by_value', ranksOk && orderOk && !allSame, `ranks 1..${rows.length}, implied ${rows[0].implied_value_usd} -> ${rows[rows.length - 1].implied_value_usd}`);

// --- coverage ---
const rowSlugs = new Set(rows.map((r) => r.slug));
const missing = SNAP.watchlist.filter((s) => !rowSlugs.has(s));
ok('coverage', missing.length === 0, `${SNAP.watchlist.length - missing.length}/${SNAP.watchlist.length} watchlist covered`);

// --- farm_steps ---
const badSteps = rows.find((r) => r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => s.length < 20 || s.length > 600));
ok('farm_steps', !badSteps, badSteps ? `bad steps on ${badSteps.slug}` : `${rows.length} rows, steps 3..12, 20..600 chars`);

// --- screenshots ---
const shotDir = join(OUT, 'screenshots');
const shots = existsSync(shotDir) ? readdirSync(shotDir).filter((f) => !f.startsWith('.') && statSync(join(shotDir, f)).isFile()) : [];
function pngSize(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
}
function jpgSize(buf) {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'jpg' };
    }
    i += 2 + len;
  }
  return null;
}
let shotBad = null;
for (const f of shots) {
  const buf = readFileSync(join(shotDir, f));
  const dim = pngSize(buf) ?? jpgSize(buf);
  if (!dim) { shotBad = `${f}: not a whole PNG/JPEG`; break; }
  const long = Math.max(dim.w, dim.h), short = Math.min(dim.w, dim.h);
  if (buf.length > 524_288) { shotBad = `${f}: ${buf.length} bytes over 512 KiB`; break; }
  if (long > 1440 || short < 800) { shotBad = `${f}: ${dim.w}x${dim.h} outside 1440/800 bounds`; break; }
}
ok('screenshots', shots.length >= 3 && shots.length <= 4 && !shotBad, `${shots.length} images${shotBad ? ', ' + shotBad : ''}`);

// --- dossier_matches (reproducibility): main.ts rebuilds dossier.json from /output; a second
// run must produce identical bytes, or the scorer's rebuild will differ too.
ok('dossier_present', existsSync(join(OUT, 'dossier.json')) && statSync(join(OUT, 'dossier.json')).size <= 1_572_864,
  `${existsSync(join(OUT, 'dossier.json')) ? statSync(join(OUT, 'dossier.json')).size : 0} bytes`);

console.log(fails.length === 0 ? '\nGATE MIRROR: ALL PASS' : `\nGATE MIRROR: ${fails.length} FAILING: ${fails.join(', ')}`);
process.exit(fails.length === 0 ? 0 : 1);
