// The token radar's scoring model, rewritten: one sealed snapshot of the protocol
// universe in, one ranked board out.
//
// The board covers every slug on the snapshot's watchlist (a floor, never a
// ceiling) and may add pre-token protocols below the watchlist floor: the early
// rows the radar exists to find. A protocol counts as pre-token when its index
// entry records no token at all (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown at the market's own
// values, never mixed into the ranked board.
//
// Implied value comes only from the snapshot's own figures. The multiple is not
// a house guess: it is the market's own pricing, read off the snapshot's
// tokenized protocols. Per category, the multiple is the median market-cap-to-TVL
// ratio of that category's protocols that already trade, shrunk toward the
// global median with a pseudo-count of 5 so a thin category cannot set the price
// on one or two names:
//
//   multiple(cat) = (n_cat * median_cat + 5 * median_all) / (n_cat + 5), capped at 1.0
//
// Then, per protocol:
//
//   base     = tvl_usd x multiple(category)
//   growth   = clamp(change_7d, -60, 120) per cent
//   growth_x = 1 + (growth / 100) x 0.5
//   aged     = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied  = max(1, round(base x growth_x x aged))
//
// No protocol name is ever special-cased: one function scores every row, and the
// dashboard prints the whole comp table so a reader can check each multiple
// against its own comps.

/** One protocol entry of the snapshot: exactly the ten fields the sealed input carries. */
export interface ProtocolEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolEntry[];
  watchlist: string[];
}

/** The model's tuning, as the dashboard states it and the sandbox may change it. */
export interface Tuning {
  shrink_k: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const TUNING: Tuning = {
  shrink_k: 5,
  multiple_cap: 1.0,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_LABEL = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_LIMIT = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_LIMIT = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface PlanStep {
  text: string;
  cost: string;
  time: string;
}

/** One category's comp row: how the market prices its tokens against TVL. */
export interface CategoryComp {
  category: string;
  n: number;
  median: number | null;
  multiple: number;
}

/** The comp table the model derives from the snapshot's tokenized protocols. */
export interface CompTable {
  global_median: number;
  rows: CategoryComp[];
}

/** One row of board.json: the ranked board's row. */
export interface BoardEntry {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    comp_n: number;
    comp_median: number | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface DashboardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface DashboardData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Tuning;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  comps: CategoryComp[];
  global_median: number;
  rows: DashboardRow[];
  live: LiveEntry[];
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardCounts {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotProblem';
  }
}

const MS_PER_DAY = 86_400_000;

/** A finite number, else `fallback`. */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list of finite numbers, sorted first; null when empty. */
export function middle(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

/**
 * The comp table: for every category, the median market-cap-to-TVL ratio of its
 * protocols that already trade, and the global median across all of them. A
 * category with no tokenized protocol has a null median and falls back to the
 * global median when it is priced.
 */
export function compTable(snap: SnapshotDoc): CompTable {
  const perCat = new Map<string, number[]>();
  const ratios: number[] = [];
  for (const entry of snap.protocols) {
    if (entry.mcap_usd === null || entry.tvl_usd <= 0) continue;
    const ratio = entry.mcap_usd / entry.tvl_usd;
    if (!Number.isFinite(ratio) || ratio < 0) continue;
    ratios.push(ratio);
    const key = entry.category ?? 'Other';
    const list = perCat.get(key);
    if (list) list.push(ratio);
    else perCat.set(key, [ratio]);
  }
  const globalMed = middle(ratios) ?? 0.17;
  const rows: CategoryComp[] = [...perCat.entries()]
    .map(([category, rs]) => {
      const med = middle(rs);
      const n = rs.length;
      const multiple = Math.min(TUNING.multiple_cap, (n * (med ?? globalMed) + TUNING.shrink_k * globalMed) / (n + TUNING.shrink_k));
      return { category, n, median: med, multiple: Math.round(multiple * 1e4) / 1e4 };
    })
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  return { global_median: Math.round(globalMed * 1e4) / 1e4, rows };
}

/** A category's pricing multiple: its shrunk comp median, or the global median when it has no comps. */
export function multipleFor(cat: string | null, table: CompTable): { multiple: number; n: number; median: number | null } {
  const row = table.rows.find((r) => r.category === (cat ?? 'Other'));
  if (!row) return { multiple: table.global_median, n: 0, median: null };
  return { multiple: row.multiple, n: row.n, median: row.median };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function daysSince(asOf: string, listed: string | null): number | null {
  if (listed === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listed}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / MS_PER_DAY));
}

/** The multipliers and the implied value one protocol gets under `tuning` and `table`. */
export function scoreProtocol(
  entry: ProtocolEntry,
  asOf: string,
  tuning: Tuning,
  table: CompTable,
): { implied: number; multiple: number; compN: number; compMedian: number | null; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = daysSince(asOf, entry.listed_at);
  const { multiple, n, median: compMedian } = multipleFor(entry.category, table);
  const rawGrowth = asNumber(entry.change_7d, 0);
  const growthPct = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * tuning.growth_weight;
  const ageForModel = age ?? tuning.unknown_age_days;
  const maturityMult = tuning.maturity_floor + (Math.min(Math.max(ageForModel, 0), tuning.maturity_days) / tuning.maturity_days) * tuning.maturity_range;
  const base = entry.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, compN: n, compMedian, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSION_TAG = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function hasNoToken(entry: ProtocolEntry): boolean {
  return entry.mcap_usd === null && entry.gecko_id === null && entry.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function rankable(entry: ProtocolEntry): boolean {
  return hasNoToken(entry) && entry.category !== 'CEX' && !VERSION_TAG.test(entry.name);
}

/** The snapshot's protocols indexed by slug. */
function indexBySlug(entries: ProtocolEntry[]): Map<string, ProtocolEntry> {
  return new Map(entries.map((e) => [e.slug, e]));
}

const round4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function planLine(step: PlanStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(entry: ProtocolEntry): string {
  return entry.chains.length > 0 ? entry.chains[0]! : 'its main chain';
}

/** A second chain when the protocol runs on more than one, for the weekly-variety step. */
function nextChain(entry: ProtocolEntry): string | null {
  return entry.chains.length > 1 ? entry.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeFor(entry: ProtocolEntry): number {
  if (entry.tvl_usd >= 5_000_000_000) return 250;
  if (entry.tvl_usd >= 1_000_000_000) return 150;
  if (entry.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionText(entry: ProtocolEntry, stake: number, network: string): string {
  const cat = (entry.category ?? '').toLowerCase();
  const title = entry.name;
  if (cat.includes('risk curator') || cat.includes('curator')) return `Allocate $${stake} of USDC to a ${title} curator vault on ${network} and keep the shares.`;
  if (cat.includes('allocator')) return `Deposit $${stake} into a ${title} allocator vault on ${network} and keep the shares.`;
  if (cat.includes('basis trad')) return `Deposit $${stake} of USDC into ${title}'s basis vault on ${network} and hold the delta-neutral position.`;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) return `Supply $${stake} of USDC to ${title} on ${network} and keep the position open.`;
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm')) return `Provide $${stake} of liquidity to ${title}'s main pool on ${network} and keep the position open.`;
  if (cat.includes('bridge')) return `Bridge $${stake} of USDC to ${network} through ${title} and use the bridged funds in its app.`;
  if (cat.includes('staking') || cat.includes('restak')) return `Stake $${stake} of the chain's staking asset through ${title} and keep the receipt.`;
  if (cat.includes('perpetual') || cat.includes('derivative')) return `Deposit $${stake} of USDC as margin on ${title} and open one small hedge.`;
  if (cat.includes('prediction')) return `Fund $${stake} and place one market position on ${title}.`;
  if (cat.includes('governance')) return `Lock $${stake} of the governance asset in ${title} on ${network} and vote once.`;
  if (cat.includes('payment')) return `Route $${stake} of payments through ${title} on ${network} and keep the receipt.`;
  if (cat.includes('stable')) return `Mint or deposit $${stake} of the stable asset through ${title} on ${network}.`;
  if (cat.includes('rwa')) return `Mint $${stake} of the protocol's yield asset on ${network} and hold it.`;
  if (cat.includes('insurance')) return `Buy $${stake} of cover from ${title} on ${network} and keep the policy.`;
  if (cat.includes('chain')) return `Bridge $${stake} of USDC to ${title} and use it in one app on the chain.`;
  return `Deposit $${stake} of USDC into ${title} on ${network} and keep the position open.`;
}

/** The weekly qualifying action, varied by what the protocol does. */
function weeklyText(entry: ProtocolEntry): string {
  const cat = (entry.category ?? '').toLowerCase();
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) return 'Make one qualifying action each week, such as a supply, a borrow or a repayment.';
  if (cat.includes('dex') || cat.includes('yield')) return 'Make one qualifying action each week, such as a swap, an add of liquidity or a claim of fees.';
  if (cat.includes('curator') || cat.includes('allocator')) return 'Make one qualifying action each week, such as a deposit, a rebalance or a vote on the vault.';
  if (cat.includes('governance')) return 'Vote once a week on an open proposal, and keep the lock in place.';
  if (cat.includes('bridge')) return 'Bridge a small amount each week and use it in the destination app.';
  if (cat.includes('perpetual') || cat.includes('derivative')) return 'Make one qualifying action each week, such as a trade, a funding payment or a close.';
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function planSteps(entry: ProtocolEntry, age: number | null): PlanStep[] {
  const network = firstChain(entry);
  const other = nextChain(entry);
  const stake = stakeFor(entry);
  const wait = holdFor(age);
  const action = actionText(entry, stake, network);
  const steps: PlanStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${stake} of capital and about $${stake >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyText(entry),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${wait} days so the activity is counted in more than one snapshot.`,
      cost: `the $${stake} stays in the position`,
      time: `${wait} days`,
    },
  ];
  if (other !== null) {
    steps.push({
      text: `Repeat the first deposit once on ${other} so the farm covers a second chain the protocol runs on.`,
      cost: `$${Math.max(25, Math.round(stake / 2))} of capital and about $3 of gas`,
      time: '15 minutes',
    });
  }
  steps.push(
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function rankBoard(snap: SnapshotDoc, tuning: Tuning = TUNING, table: CompTable = compTable(snap)): BoardEntry[] {
  const index = indexBySlug(snap.protocols);
  const picked = new Map<string, ProtocolEntry>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snap.watchlist) {
    const entry = index.get(slug);
    if (entry !== undefined) picked.set(slug, entry);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a picked protocol stays picked.
  const early = snap.protocols
    .filter((e) => !picked.has(e.slug) && rankable(e) && e.tvl_usd < snap.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_LIMIT);
  for (const entry of early) picked.set(entry.slug, entry);

  const scored = [...picked.values()].map((e) => {
    const v = scoreProtocol(e, snap.as_of, tuning, table);
    return { e, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.e.slug < b.e.slug ? -1 : a.e.slug > b.e.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.e.slug,
    name: s.e.name,
    category: s.e.category,
    chains: s.e.chains,
    tvl_usd: s.e.tvl_usd,
    change_7d: s.e.change_7d,
    mcap_usd: s.e.mcap_usd,
    listed_at: s.e.listed_at,
    gecko_id: s.e.gecko_id,
    symbol: s.e.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      comp_n: s.compN,
      comp_median: s.compMedian,
      growth_pct: s.growthPct,
      growth_multiplier: round4dp(s.growthMult),
      maturity_multiplier: round4dp(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: planSteps(s.e, s.age).map(planLine),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveEntries(snap: SnapshotDoc): LiveEntry[] {
  return snap.protocols
    .filter((e) => !hasNoToken(e) && e.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_LIMIT)
    .map((e) => ({
      slug: e.slug,
      name: e.name,
      category: e.category,
      chains: e.chains,
      tvl_usd: e.tvl_usd,
      mcap_usd: e.mcap_usd,
      change_7d: e.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function dashboardRow(row: BoardEntry): DashboardRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snap: SnapshotDoc, tuning: Tuning = TUNING): { board: BoardEntry[]; radar: DashboardData } {
  const table = compTable(snap);
  const board = rankBoard(snap, tuning, table);
  const live = liveEntries(snap);
  const early = board.filter((r) => !snap.watchlist.includes(r.slug)).length;
  const radar: DashboardData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model: tuning,
    model_version: MODEL_LABEL,
    watchlist_size: snap.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    comps: table.rows,
    global_median: table.global_median,
    rows: board.map(dashboardRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotProblem('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotProblem('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotProblem('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotProblem('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotProblem('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotProblem('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotProblem('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotProblem(`snapshot.json's protocol ${i} is not an object`);
    const entry = v as Record<string, unknown>;
    if (typeof entry.slug !== 'string' || typeof entry.name !== 'string' || typeof entry.tvl_usd !== 'number' || !Number.isFinite(entry.tvl_usd)) {
      throw new SnapshotProblem(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: entry.slug,
      name: entry.name,
      category: typeof entry.category === 'string' ? entry.category : null,
      chains: Array.isArray(entry.chains) ? entry.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: entry.tvl_usd,
      change_7d: typeof entry.change_7d === 'number' && Number.isFinite(entry.change_7d) ? entry.change_7d : null,
      mcap_usd: typeof entry.mcap_usd === 'number' && Number.isFinite(entry.mcap_usd) ? entry.mcap_usd : null,
      listed_at: typeof entry.listed_at === 'string' ? entry.listed_at : null,
      gecko_id: typeof entry.gecko_id === 'string' ? entry.gecko_id : null,
      symbol: typeof entry.symbol === 'string' ? entry.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardEntry[], snap: SnapshotDoc): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: DashboardData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
