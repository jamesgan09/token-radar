// Token Radar's dashboard, rewritten. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail sheet with the model's own inputs and the protocol's farm
// plan. No network: every byte it shows is already in data.js.
(function () {
  'use strict';

  var SET = window.RADAR;
  if (!SET) return;
  var mount = document.getElementById('board');
  var view = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function recompute(row, tuning) {
    var growth = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * tuning.growth_weight;
    var yrs = row.age_days === null || row.age_days === undefined ? tuning.unknown_age_days : row.age_days;
    var maturity = tuning.maturity_floor + (Math.min(Math.max(yrs, 0), tuning.maturity_days) / tuning.maturity_days) * tuning.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity));
  }

  function node(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') el.className = attrs[k];
        else if (k === 'text') el.textContent = attrs[k];
        else if (k === 'html') el.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) el.appendChild(c); });
      else if (typeof child === 'string') el.appendChild(document.createTextNode(child));
      else el.appendChild(child);
    }
    return el;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function firstChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function nextChain(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function stakeFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(yrs) {
    if (yrs === null || yrs === undefined) return 30;
    if (yrs < 180) return 60;
    if (yrs < 365) return 45;
    return 30;
  }
  function actionText(p, stake, network) {
    var cat = (p.category || '').toLowerCase();
    var title = p.name;
    if (cat.indexOf('risk curator') >= 0 || cat.indexOf('curator') >= 0) return 'Allocate $' + stake + ' of USDC to a ' + title + ' curator vault on ' + network + ' and keep the shares.';
    if (cat.indexOf('allocator') >= 0) return 'Deposit $' + stake + ' into a ' + title + ' allocator vault on ' + network + ' and keep the shares.';
    if (cat.indexOf('basis trad') >= 0) return 'Deposit $' + stake + " of USDC into " + title + "'s basis vault on " + network + ' and hold the delta-neutral position.';
    if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) return 'Supply $' + stake + ' of USDC to ' + title + ' on ' + network + ' and keep the position open.';
    if (cat.indexOf('dex') >= 0 || cat.indexOf('yield') >= 0 || cat.indexOf('leveraged farm') >= 0) return 'Provide $' + stake + ' of liquidity to ' + title + "'s main pool on " + network + ' and keep the position open.';
    if (cat.indexOf('bridge') >= 0) return 'Bridge $' + stake + ' of USDC to ' + network + ' through ' + title + ' and use the bridged funds in its app.';
    if (cat.indexOf('staking') >= 0 || cat.indexOf('restak') >= 0) return "Stake $" + stake + " of the chain's staking asset through " + title + ' and keep the receipt.';
    if (cat.indexOf('perpetual') >= 0 || cat.indexOf('derivative') >= 0) return 'Deposit $' + stake + ' of USDC as margin on ' + title + ' and open one small hedge.';
    if (cat.indexOf('prediction') >= 0) return 'Fund $' + stake + ' and place one market position on ' + title + '.';
    if (cat.indexOf('governance') >= 0) return 'Lock $' + stake + ' of the governance asset in ' + title + ' on ' + network + ' and vote once.';
    if (cat.indexOf('payment') >= 0) return 'Route $' + stake + ' of payments through ' + title + ' on ' + network + ' and keep the receipt.';
    if (cat.indexOf('stable') >= 0) return 'Mint or deposit $' + stake + ' of the stable asset through ' + title + ' on ' + network + '.';
    if (cat.indexOf('rwa') >= 0) return "Mint $" + stake + " of the protocol's yield asset on " + network + ' and hold it.';
    if (cat.indexOf('insurance') >= 0) return 'Buy $' + stake + ' of cover from ' + title + ' on ' + network + ' and keep the policy.';
    if (cat.indexOf('chain') >= 0) return 'Bridge $' + stake + ' of USDC to ' + title + ' and use it in one app on the chain.';
    return 'Deposit $' + stake + ' of USDC into ' + title + ' on ' + network + ' and keep the position open.';
  }
  function weeklyText(p) {
    var cat = (p.category || '').toLowerCase();
    if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) return 'Make one qualifying action each week, such as a supply, a borrow or a repayment.';
    if (cat.indexOf('dex') >= 0 || cat.indexOf('yield') >= 0) return 'Make one qualifying action each week, such as a swap, an add of liquidity or a claim of fees.';
    if (cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0) return 'Make one qualifying action each week, such as a deposit, a rebalance or a vote on the vault.';
    if (cat.indexOf('governance') >= 0) return 'Vote once a week on an open proposal, and keep the lock in place.';
    if (cat.indexOf('bridge') >= 0) return 'Bridge a small amount each week and use it in the destination app.';
    if (cat.indexOf('perpetual') >= 0 || cat.indexOf('derivative') >= 0) return 'Make one qualifying action each week, such as a trade, a funding payment or a close.';
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function planLine(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function planSteps(p) {
    var network = firstChain(p);
    var other = nextChain(p);
    var stake = stakeFor(p);
    var wait = holdFor(p.age_days);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionText(p, stake, network), cost: '$' + stake + ' of capital and about $' + (stake >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyText(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + wait + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + stake + ' stays in the position', time: wait + ' days' }
    ];
    if (other !== null) {
      steps.push({ text: 'Repeat the first deposit once on ' + other + ' so the farm covers a second chain the protocol runs on.', cost: '$' + Math.max(25, Math.round(stake / 2)) + ' of capital and about $3 of gas', time: '15 minutes' });
    }
    steps.push(
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    );
    return steps.map(planLine);
  }

  function fromHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
  }
  function toHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visible() {
    var q = view.q.trim().toLowerCase();
    return SET.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function ordered(list) {
    var key = view.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function topBar() {
    return node('header', { class: 'top' },
      node('div', { class: 'brand' }, node('span', { class: 'mark' }), node('span', { class: 'brand-name', text: 'Token Radar' })),
      node('div', { class: 'top-meta' },
        node('span', { text: 'Snapshot ' + SET.as_of }),
        node('span', { text: 'DefiLlama protocol index' }),
        node('span', { text: SET.model_version + ' model' })
      )
    );
  }

  function intro() {
    return node('section', { class: 'lede' },
      node('div', null,
        node('h1', { text: SET.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        node('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(SET.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + SET.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      node('div', { class: 'facts' },
        node('div', { class: 'fact' }, node('span', { text: 'Watchlist covered' }), node('b', { text: SET.watchlist_size + ' / ' + SET.watchlist_size })),
        node('div', { class: 'fact' }, node('span', { text: 'Pre-token rows scored' }), node('b', { text: String(SET.board_size) })),
        node('div', { class: 'fact' }, node('span', { text: 'Early rows below the floor' }), node('b', { text: String(SET.early_size) })),
        node('div', { class: 'fact' }, node('span', { text: 'Live-token protocols set aside' }), node('b', { text: String(SET.live_size) }))
      )
    );
  }

  function filters() {
    var categories = Array.from(new Set(SET.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = node('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; toHash(); paint(); });
    var select = node('select', { id: 'category', 'aria-label': 'Filter by category' },
      node('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return node('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { view.category = select.value; toHash(); paint(); });
    var pre = node('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; paint(); } });
    var live = node('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; paint(); } });
    return node('div', { class: 'controls' },
      node('div', { class: 'field' }, node('label', { for: 'q', text: 'Search' }), search),
      node('div', { class: 'field' }, node('label', { for: 'category', text: 'Category' }), select),
      node('div', { class: 'field' }, node('span', { class: 'sub', text: 'Token status' }), node('div', { class: 'tabs' }, pre, live)),
      node('span', { class: 'count', text: view.tab === 'pre-token' ? visible().length + ' rows shown' : SET.live.length + ' live-token protocols' })
    );
  }

  function sortCell(key, label) {
    return node('th', { scope: 'col' },
      node('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } paint(); } },
        label,
        view.sort === key ? node('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardView() {
    var list = ordered(visible());
    if (list.length === 0) {
      return node('div', { class: 'panel' }, node('div', { class: 'empty' },
        node('h2', { text: 'No protocol matches that filter' }),
        node('p', { text: 'Clear the search or pick another category to see the board again.' }),
        node('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; toHash(); paint(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = node('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = node('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { showDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } }
      },
        node('td', { class: 'num', text: String(r.rank) }),
        node('td', null, node('div', { class: 'name' },
          node('b', { text: r.name }),
          node('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        node('td', { class: 'num', text: usd(r.tvl_usd) }),
        node('td', { class: 'num ' + growthClass, text: growth }),
        node('td', { class: 'num', text: age(r.age_days) }),
        node('td', null, node('div', { class: 'implied' },
          node('div', { class: 'bar', 'aria-hidden': 'true' }, node('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          node('span', { class: 'num', text: usd(r.implied_value_usd) })
        )),
        node('td', null, node('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return node('div', { class: 'panel' },
      node('div', { class: 'table-wrap' },
        node('table', null,
          node('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          node('thead', null, node('tr', null,
            sortCell('implied', 'Rank'),
            sortCell('name', 'Protocol'),
            sortCell('tvl', 'TVL'),
            sortCell('growth', '7d'),
            sortCell('age', 'Age'),
            sortCell('implied', 'Implied value'),
            node('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveView() {
    var tbody = node('tbody');
    SET.live.forEach(function (r) {
      tbody.appendChild(node('tr', null,
        node('td', { class: 'num', text: 'live' }),
        node('td', null, node('div', { class: 'name' }, node('b', { text: r.name }), node('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        node('td', { class: 'num', text: usd(r.tvl_usd) }),
        node('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        node('td', { class: 'num', text: usd(r.mcap_usd) }),
        node('td', null, node('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return node('div', { class: 'panel' },
      node('div', { class: 'table-wrap' },
        node('table', null,
          node('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          node('thead', null, node('tr', null, node('th', { scope: 'col', text: 'Status' }), node('th', { scope: 'col', text: 'Protocol' }), node('th', { scope: 'col', text: 'TVL' }), node('th', { scope: 'col', text: '7d' }), node('th', { scope: 'col', text: 'Market cap' }), node('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelBox() {
    var m = SET.model;
    var comps = SET.comps || [];
    var compRows = comps.map(function (c) {
      return node('tr', null,
        node('td', { text: c.category }),
        node('td', { class: 'num', text: String(c.n) }),
        node('td', { class: 'num', text: c.median === null || c.median === undefined ? 'no comps' : String(c.median) }),
        node('td', { class: 'num', text: String(c.multiple) })
      );
    });
    return node('section', { class: 'panel model' },
      node('h2', { text: 'How implied value is computed' }),
      node('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      node('div', { class: 'formula' },
        'implied = round( tvl_usd x multiple(category) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      node('p', { class: 'sub', text: 'The multiple is the market\u2019s own pricing, not a house guess: for each category it is the median market-cap-to-TVL ratio of that category\u2019s protocols that already trade, shrunk toward the global median (' + SET.global_median + ') with a pseudo-count of ' + m.shrink_k + ' so a thin category cannot set the price on one or two names, and capped at ' + m.multiple_cap + '. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      node('h3', { text: 'Category multiples, from the snapshot\u2019s own traded protocols' }),
      node('div', { class: 'table-wrap' },
        node('table', { class: 'comps' },
          node('thead', null, node('tr', null,
            node('th', { scope: 'col', text: 'Category' }),
            node('th', { scope: 'col', text: 'Traded comps' }),
            node('th', { scope: 'col', text: 'Median mcap / TVL' }),
            node('th', { scope: 'col', text: 'Multiple used' })
          )),
          node('tbody', null, compRows)
        )
      )
    );
  }

  var sheet = node('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  sheet.addEventListener('close', function () { view.selected = null; toHash(); });

  function showDetail(slug) {
    var row = SET.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    toHash();
    sheet.textContent = '';
    var steps = planSteps(row);
    sheet.appendChild(node('div', { class: 'detail-head' },
      node('div', null,
        node('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + SET.board_size }),
        node('h2', { id: 'detail-title', text: row.name }),
        node('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      node('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { sheet.close(); } })
    ));
    sheet.appendChild(node('section', { class: 'detail-section' },
      node('h3', { text: 'Implied value' }),
      node('div', { class: 'equation' },
        node('div', null, node('span', { text: 'TVL' }), node('b', { class: 'num', text: usd(row.tvl_usd) })),
        node('div', null, node('span', { text: 'Category multiple' }), node('b', { class: 'num', text: String(row.category_multiple) })),
        node('div', null, node('span', { text: 'Seven-day growth' }), node('b', { class: 'num', text: pct(row.change_7d) })),
        node('div', null, node('span', { text: 'Age with no token' }), node('b', { class: 'num', text: age(row.age_days) })),
        node('div', null, node('span', { text: 'Growth multiplier' }), node('b', { class: 'num', text: String(row.growth_multiplier) })),
        node('div', null, node('span', { text: 'Maturity multiplier' }), node('b', { class: 'num', text: String(row.maturity_multiplier) })),
        node('div', null, node('span', { text: 'Implied value' }), node('b', { class: 'num', text: usd(row.implied_value_usd) }))
      ),
      node('p', { class: 'sub', text: 'Model ' + SET.model_version + ': the same function scores every protocol. The page recomputes this row as ' + usd(recompute(row, SET.model)) + (recompute(row, SET.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    sheet.appendChild(node('section', { class: 'detail-section' },
      node('h3', { text: 'Farm plan' }),
      node('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return node('li', null, node('b', { text: action }), node('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof sheet.showModal === 'function') {
      if (!sheet.open) sheet.showModal();
    } else {
      sheet.setAttribute('open', '');
    }
  }

  function paint() {
    mount.textContent = '';
    var shell = node('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(filters());
    shell.appendChild(view.tab === 'pre-token' ? boardView() : liveView());
    if (view.tab === 'pre-token') shell.appendChild(modelBox());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!sheet.isConnected) mount.appendChild(sheet);
    if (view.selected) showDetail(view.selected);
  }

  fromHash();
  paint();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheet.open) sheet.close();
  });
})();
