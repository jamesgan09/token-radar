// Token Radar, rebuilt for the token-radar-01 bounty: a Node 22 program, standard
// library only, that turns the sealed DefiLlama snapshot into a ranked board and a
// static dashboard. It reads /input/snapshot.json (or --input <file|dir>), scores
// every pre-token protocol with the model in lib/model.ts, writes the ranked board
// to /output/board.json, copies this repo's dashboard/ and screenshots/ into
// /output, and finishes by writing /output/dossier.json, the summary the judge
// reads, through the vendored make.fun library.
//
// The dashboard is a static page with no framework and no network calls:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read the
// /output/data.js this program writes from the same board. Outside the grader's
// container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json

import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// The scorer's own caps (reference/gate.json): the text cap shapes the bytes,
// the rest refuse outright.
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of --<name> <value> (or --<name>=<value>) among the arguments, else the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const glued = process.argv.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

/** Copy one directory's regular files into `to`, skipping dotfiles, and name what landed. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const landed: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    landed.push(name);
  }
  return landed;
}

const inputOpt = flag('input', '/input');
const inputFile = inputOpt.endsWith('.json') ? inputOpt : join(inputOpt, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snap);
const problem = boardIssue(board, snap);
if (problem !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

copyDir(join(root, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(root, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
