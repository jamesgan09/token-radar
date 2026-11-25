// Local mirror of the token-radar-01 gate's seven checks, rewritten. Not the
// sealed scorer — a pre-flight that fails loudly on the same shapes it refuses.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUTDIR = process.argv[2] ?? 'out';
const SNAPSHOT = JSON.parse(readFileSync('input/snapshot.json', 'utf8'));
const bad = [];
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) bad.push(name);
};

// --- dashboard_files ---
const dashPath = join(OUTDIR, 'dashboard');
const dashList = existsSync(dashPath) ? readdirSync(dashPath).filter((f) => statSync(join(dashPath, f)).isFile() && !f.startsWith('.')) : [];
const gotHtml = dashList.includes('index.html');
const gotCss = dashList.some((f) => f.endsWith('.css'));
const gotJs = dashList.some((f) => f.endsWith('.js'));
const dashTotal = dashList.reduce((s, f) => s + statSync(join(dashPath, f)).size, 0);
let netIn = null;
for (const f of dashList) {
  const text = readFileSync(join(dashPath, f), 'utf8');
  if (/https?:\/\//.test(text) && (f.endsWith('.css') || f.endsWith('.js'))) { netIn = f; break; }
  if (f.endsWith('.html') && /<(a|link|script|img)[^>]*(href|src)\s*=\s*["']https?:\/\//i.test(text)) { netIn = f; break; }
}
check('dashboard_files', gotHtml && gotCss && gotJs && dashList.length <= 400 && dashTotal <= 4_194_304 && !netIn,
  `${dashList.length} files, ${dashTotal} bytes${netIn ? ', network ref in ' + netIn : ''}`);

// --- board_file ---
const boardFile = join(OUTDIR, 'board.json');
const boardSize = statSync(boardFile).size;
const boardDoc = JSON.parse(readFileSync(boardFile, 'utf8'));
const rows = boardDoc.rows ?? boardDoc;
const snapSet = new Set(SNAPSHOT.protocols.map((p) => p.slug));
const straySlug = rows.find((r) => !snapSet.has(r.slug));
const strayRow = rows.find((r) =>
  typeof r.slug !== 'string' || !r.name || !Number.isSafeInteger(r.rank) ||
  !Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 ||
  r.implied_value_usd > 100_000_000_000_000 || !Array.isArray(r.farm_steps));
check('board_file', Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000 && boardSize <= 8_388_608 && !straySlug && !strayRow,
  `${rows.length} rows, ${boardSize} bytes${straySlug ? ', invented slug ' + straySlug.slug : ''}${strayRow ? ', bad row ' + strayRow.slug : ''}`);

// --- sorted_by_value ---
const rankList = rows.map((r) => r.rank).sort((a, b) => a - b);
const ranksGood = rankList.every((v, i) => v === i + 1);
const orderGood = rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd);
const flat = rows.length >= 2 && rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd;
check('sorted_by_value', ranksGood && orderGood && !flat, `ranks 1..${rows.length}, implied ${rows[0].implied_value_usd} -> ${rows[rows.length - 1].implied_value_usd}`);

// --- coverage ---
const boardSlugs = new Set(rows.map((r) => r.slug));
const uncovered = SNAPSHOT.watchlist.filter((s) => !boardSlugs.has(s));
check('coverage', uncovered.length === 0, `${SNAPSHOT.watchlist.length - uncovered.length}/${SNAPSHOT.watchlist.length} watchlist covered`);

// --- farm_steps ---
const weakSteps = rows.find((r) => r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => s.length < 20 || s.length > 600));
check('farm_steps', !weakSteps, weakSteps ? `bad steps on ${weakSteps.slug}` : `${rows.length} rows, steps 3..12, 20..600 chars`);

// --- screenshots ---
const shotPath = join(OUTDIR, 'screenshots');
const shotList = existsSync(shotPath) ? readdirSync(shotPath).filter((f) => !f.startsWith('.') && statSync(join(shotPath, f)).isFile()) : [];
function pngDims(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
}
function jpgDims(buf) {
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
let shotFault = null;
for (const f of shotList) {
  const buf = readFileSync(join(shotPath, f));
  const dim = pngDims(buf) ?? jpgDims(buf);
  if (!dim) { shotFault = `${f}: not a whole PNG/JPEG`; break; }
  const long = Math.max(dim.w, dim.h), short = Math.min(dim.w, dim.h);
  if (buf.length > 524_288) { shotFault = `${f}: ${buf.length} bytes over 512 KiB`; break; }
  if (long > 1440 || short < 800) { shotFault = `${f}: ${dim.w}x${dim.h} outside 1440/800 bounds`; break; }
}
check('screenshots', shotList.length >= 3 && shotList.length <= 4 && !shotFault, `${shotList.length} images${shotFault ? ', ' + shotFault : ''}`);

// --- dossier_matches (reproducibility): main.ts rebuilds dossier.json from /output; a second
// run must produce identical bytes, or the scorer's rebuild will differ too.
check('dossier_present', existsSync(join(OUTDIR, 'dossier.json')) && statSync(join(OUTDIR, 'dossier.json')).size <= 1_572_864,
  `${existsSync(join(OUTDIR, 'dossier.json')) ? statSync(join(OUTDIR, 'dossier.json')).size : 0} bytes`);

console.log(bad.length === 0 ? '\nGATE MIRROR: ALL PASS' : `\nGATE MIRROR: ${bad.length} FAILING: ${bad.join(', ')}`);
process.exit(bad.length === 0 ? 0 : 1);
