# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jamesgan09/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jamesgan09/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's `token-radar-01` bounty. It reads a sealed
DefiLlama snapshot (758 protocols, 40 on the watchlist), ranks the pre-token
protocols by implied value, and renders a static, no-network dashboard with a
farm plan for every row.

## Model (`radar-2`)

Implied value follows only from the snapshot's own figures. The multiple is the
market's own pricing: for each category, the median market-cap-to-TVL ratio of
that category's protocols that already trade, shrunk toward the global median
(0.1689) with a pseudo-count of 5 so a thin category cannot set the price on
one or two names, and capped at 1.0.

```
multiple(cat) = (n_cat * median_cat + 5 * median_all) / (n_cat + 5), capped at 1.0
implied = round( tvl_usd * multiple(category)
               * (1 + clamp(change_7d, -60, 120) / 100 * 0.5)
               * (0.6 + min(age_days, 1095) / 1095 * 0.4) )
```

Age is the time since the protocol was first listed — how long it has run with
no token. No protocol name is special-cased; the dashboard prints the whole
comp table so every multiple can be checked against its own comps.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
node check-gate.mjs out   # local mirror of the gate's seven checks
```

Node 22.18+ (type-stripping runs the `.ts` directly, standard library only).
`main.ts` writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` to the output directory.

## Layout

- `main.ts` — entry point: parse the snapshot, build the board, write the outputs.
- `lib/model.ts` — the model, the comp table, the farm plans, board validation.
- `dashboard/` — static page: sortable and filterable board, per-protocol detail
  with the model's own inputs and farm plan, live-token view, model panel.
- `screenshots/` — board, detail and filtered views of the dashboard.
- `input/snapshot.json` — the sealed snapshot (read-only).
- `vendor/makefun-board.ts` — the vendored dossier builder.
- `check-gate.mjs` — local pre-flight mirroring the gate's seven checks.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
