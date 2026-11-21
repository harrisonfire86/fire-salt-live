"use strict";
/* Fire & Salt Mining, live site.
   Live numbers come straight from the data sites in your browser.
   ckpool does not allow that, so its numbers come from the GitHub job (data/pool.json).
   Saved history (payouts, pool stats, pool switches) is in the data/ folder, written by the GitHub job. */
var S = { cfg: null, pool: null, earned: [], pools: [], days: {}, status: null, live: { err: {} }, livePool: null, livePoolErr: "", liveEarned: [], ui: { range: "all", coin: "all" }, busy: false, checkedAt: 0 };
var DAY = 86400000, MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function n0(x) { return Math.round(x).toLocaleString("en-US"); }
function usd(x) { return (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function r2(x) { return Math.round(x * 100) / 100; }
function p2(n) { return n < 10 ? "0" + n : "" + n; }
function isoDay(ts) { return new Date(ts).toISOString().slice(0, 10); }
function niceDay(ts) { var d = new Date(ts); return MON[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); }
function ago(ts) { if (!ts) return "never"; var s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " days ago"; }
function since(t) { var s = Math.max(0, Math.floor((Date.now() - t) / 1000)), m = Math.floor(s / 60); return (m ? m + "m " : "") + p2(s % 60) + "s ago"; }
function coinAmt(s) { return (s / 1e8).toFixed(8); }
function hFmt(h) { if (!(h > 0)) return "0 H/s"; var u = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"], i = 0; while (h >= 1000 && i < u.length - 1) { h /= 1000; i++; } return (h >= 100 ? h.toFixed(0) : h.toFixed(h >= 10 ? 1 : 2)) + " " + u[i]; }
function bigFmt(x) { if (!(x > 0)) return "0"; var u = ["", "K", "M", "G", "T", "P", "E"], i = 0; while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; } return (x >= 100 ? x.toFixed(0) : x.toFixed(1)) + u[i]; }
function cleanHost(h) { return String(h || "").trim().replace(/^[a-z+]+:\/\//i, "").replace(/[/:].*$/, "").toLowerCase(); }
function normBch(a) { return String(a || "").trim().toLowerCase().replace(/^bitcoincash:/, ""); }
function statsKind(c) { if (!c) return ""; var h = cleanHost(c.host); if (/ckpool/.test(h)) return "ckpool"; if (/public-pool\.io/.test(h)) return "publicpool"; if (/solopool\.org/.test(h) && (c.coin === "bch" || String(c.port) === "9002")) return "solopool"; return ""; }
function errTxt(e) { return String((e && e.message) || e || "error").slice(0, 100); }

function getJ(url, text) {
  var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 20000);
  return fetch(url, { cache: "no-store", signal: ctl.signal }).then(function (r) { clearTimeout(to); if (!r.ok) throw new Error("site said " + r.status); return text ? r.text() : r.json(); });
}
function own(path) { return getJ(path + "?t=" + Date.now()).catch(function () { return null; }); }

/* ---------- saved data from the GitHub job ---------- */
function loadSaved() {
  return Promise.all([own("config.json"), own("data/pool.json"), own("data/earned.json"), own("data/pools.json"), own("data/pooldays.json"), own("data/status.json")]).then(function (r) {
    S.cfg = r[0]; S.pool = r[1]; S.earned = Array.isArray(r[2]) ? r[2] : []; S.pools = Array.isArray(r[3]) ? r[3] : []; S.days = r[4] || {}; S.status = r[5];
  });
}

/* ---------- live, straight from the sites ---------- */
function liveBlocks() {
  var L = S.live;
  var btc = getJ("https://mempool.space/api/blocks/tip/hash", true).then(function (h) { return getJ("https://mempool.space/api/block/" + h.trim()); }).then(function (b) { L.btcH = b.height; L.btcT = b.timestamp * 1000; delete L.err.btc; }, function (e) { L.err.btc = errTxt(e); });
  var bch = getJ("https://api.blockchain.info/haskoin-store/bch/block/best?notx=true").then(function (b) { L.bchH = b.height; L.bchT = b.time * 1000; delete L.err.bch; }, function (e) { L.err.bch = errTxt(e); });
  return Promise.all([btc, bch]).then(function () { L.at = Date.now(); drawChips(); });
}
function livePool() {
  var c = S.cfg, kind = statsKind(c); S.livePool = null; S.livePoolErr = "";
  if (!c || !c.host || kind === "ckpool" || !kind) return Promise.resolve();
  var wal = c.coin === "bch" ? normBch(c.bchWallet) : (c.btcWallet || "").trim(), addr = (c.login || "").trim() || wal;
  if (!addr) return Promise.resolve();
  var p = kind === "publicpool" ? getJ("https://public-pool.io:40557/api/client/" + addr).then(function (j) { var a = j.accounting || {}; return { h5m: +a.hashRateLast10Minutes || 0, h1h: +a.hashRateLastHour || 0, workers: j.workersCount || 0, live: j.workersCount || 0, last: a.latestShareAt ? Date.parse(a.latestShareAt) : 0, shares: +a.totalAcceptedShares || 0, best: +a.bestSubmissionDifficulty || 0, ever: +j.bestDifficulty || 0 }; })
    : getJ("https://bch.solopool.org/api/accounts/" + normBch(addr)).then(function (j) { return { h5m: +j.currentHashrate || 0, h1h: +j.hashrate || 0, workers: j.workersOnline || 0, live: j.workersOnline || 0, last: j.stats && j.stats.lastShare ? j.stats.lastShare * 1000 : 0, blocks: j.stats ? +j.stats.blocksFound || 0 : 0 }; });
  return p.then(function (d) { S.livePool = d; S.livePool.at = Date.now(); }, function (e) { S.livePoolErr = errTxt(e); });
}
/* new payouts that the GitHub job has not saved yet: found live and priced live, shown until the job saves them */
function liveWallets() {
  var c = S.cfg || {}, saved = {}, out = [];
  S.earned.forEach(function (e) { saved[e.txid] = 1; });
  var jobs = [];
  if (c.btcWallet) jobs.push(getJ("https://mempool.space/api/address/" + c.btcWallet.trim() + "/txs").then(function (a) {
    var addr = c.btcWallet.trim();
    return a.reduce(function (pr, t) {
      return pr.then(function () {
        if (!t.status || !t.status.confirmed || saved[t.txid]) return;
        var got = 0, spent = false;
        (t.vout || []).forEach(function (o) { if (o.scriptpubkey_address === addr) got += o.value || 0; });
        (t.vin || []).forEach(function (i) { if (i.prevout && i.prevout.scriptpubkey_address === addr) spent = true; });
        if (!(got > 0) || spent) return;
        return getJ("https://mempool.space/api/v1/historical-price?currency=USD&timestamp=" + t.status.block_time).then(function (j) {
          var px = j.prices && j.prices[0] && +j.prices[0].USD; if (!(px > 0)) return;
          var cb = !!(t.vin[0] && t.vin[0].is_coinbase), h = t.status.block_height;
          out.push({ txid: t.txid, ts: t.status.block_time * 1000, coin: "BTC", sats: got, price: px, what: cb ? "Block #" + h : "Payout", pool: "", fresh: true });
        });
      });
    }, Promise.resolve());
  }));
  if (c.bchWallet) jobs.push(getJ("https://api.blockchain.info/haskoin-store/bch/address/" + normBch(c.bchWallet) + "/transactions/full?limit=50").then(function (a) {
    var full = "bitcoincash:" + normBch(c.bchWallet);
    return a.reduce(function (pr, t) {
      return pr.then(function () {
        if (!t.block || !t.block.height || saved[t.txid]) return;
        var got = 0, spent = false;
        (t.outputs || []).forEach(function (o) { if (o.address === full) got += o.value || 0; });
        (t.inputs || []).forEach(function (i) { if (i.address === full) spent = true; });
        if (!(got > 0) || spent) return;
        var d = new Date(t.time * 1000);
        return getJ("https://api.coingecko.com/api/v3/coins/bitcoin-cash/history?date=" + p2(d.getUTCDate()) + "-" + p2(d.getUTCMonth() + 1) + "-" + d.getUTCFullYear() + "&localization=false").then(function (j) {
          var px = j.market_data && +j.market_data.current_price.usd; if (!(px > 0)) return;
          var cb = !!(t.inputs[0] && t.inputs[0].coinbase);
          out.push({ txid: t.txid, ts: t.time * 1000, coin: "BCH", sats: got, price: px, what: cb ? "Block #" + t.block.height : "Payout", pool: "", fresh: true });
        });
      });
    }, Promise.resolve());
  }));
  return Promise.all(jobs.map(function (j) { return j.catch(function (e) { S.live.err.wallet = errTxt(e); }); })).then(function () { S.liveEarned = out; });
}
function checkNow() {
  if (S.busy) return; S.busy = true; delete S.live.err.wallet; drawAll();
  loadSaved().then(function () { return Promise.all([liveBlocks(), livePool(), liveWallets()]); }).then(function () { S.busy = false; S.checkedAt = Date.now(); drawAll(); });
}

/* ---------- drawing ---------- */
function drawChips() {
  var L = S.live;
  $("chips").innerHTML = '<div class="chip"><small>BTC BLOCK</small><b>' + (L.btcH ? "#" + n0(L.btcH) : "--") + '</b><small>' + (L.btcT ? since(L.btcT) : "&nbsp;") + '</small></div><div class="chip"><small>BCH BLOCK</small><b>' + (L.bchH ? "#" + n0(L.bchH) : "--") + '</b><small>' + (L.bchT ? since(L.bchT) : "&nbsp;") + '</small></div>';
}
function tag(c) { c = String(c || "").toLowerCase(); return c ? '<span class="tag' + (c === "bch" ? " bch" : "") + '">' + c.toUpperCase() + '</span>' : ''; }
function poolHtml() {
  var c = S.cfg, h = '<section class="card" style="--c:var(--blue)">';
  if (!c || !c.host) return h + '<h2>Mining now</h2><p class="dim">No pool set in config.json yet.</p></section>';
  var kind = statsKind(c), d = null, at = 0, src = "", err = "";
  if (kind === "ckpool") { if (S.pool && S.pool.host === cleanHost(c.host)) { d = S.pool.d; at = S.pool.at; err = S.pool.err; } src = "GitHub job"; }
  else if (kind) { d = S.livePool; at = d ? d.at : 0; err = S.livePoolErr; src = "pool, live"; }
  var on = d && d.last && Date.now() - d.last < 15 * 60000;
  h += '<h2><span><span class="dot' + (on ? '' : ' off') + '"></span>Mining on ' + esc(cleanHost(c.host)) + '</span></h2>';
  h += '<div>' + tag(c.coin) + (c.type ? '<span class="tag solo">' + (c.type === "solo" ? "Solo block hunting" : "Pool mining") + '</span>' : '') + '</div>';
  if (c.login) h += '<p class="small">Pool login: ' + esc(c.login.slice(0, 10)) + '...' + esc(c.login.slice(-6)) + ' (shared address)</p>';
  if (!kind) h += '<p class="dim">This pool does not share stats we can read, so only wallet payouts are tracked.</p>';
  else if (!d) h += '<p class="dim">' + (err ? 'Pool stats not in yet: ' + esc(err) + '.' : (kind === "ckpool" ? 'Waiting for the first GitHub job run (every ~10 minutes).' : 'Loading...')) + '</p>';
  else {
    h += '<div class="grid2"><div class="stat"><small>Hashrate (5 min)</small><b>' + hFmt(d.h5m) + '</b></div><div class="stat"><small>Hashrate (1 hour)</small><b>' + hFmt(d.h1h) + '</b></div>';
    h += '<div class="stat"><small>Workers mining</small><b>' + n0(d.live) + ' of ' + n0(d.workers) + '</b></div><div class="stat"><small>Last share</small><b>' + (d.last ? ago(d.last) : "none yet") + '</b></div>';
    if (kind === "solopool") h += '<div class="stat"><small>Blocks found</small><b>' + n0(d.blocks || 0) + '</b></div>';
    else h += '<div class="stat"><small>Best share (this round)</small><b>' + bigFmt(d.best) + '</b></div><div class="stat"><small>Best share ever</small><b>' + bigFmt(d.ever) + '</b></div>';
    h += '</div>';
    if (c.login && kind === "ckpool") {
      if (d.mine) h += '<p style="margin:10px 0 2px;font-weight:800">Our miner in this group</p><div class="grid2"><div class="stat"><small>Our hashrate (1 hour)</small><b>' + hFmt(d.mine.h1h) + '</b></div><div class="stat"><small>Our last share</small><b>' + (d.mine.last ? ago(d.mine.last) : "none yet") + '</b></div><div class="stat"><small>Our best share</small><b>' + bigFmt(d.mine.best) + '</b></div><div class="stat"><small>Our best ever</small><b>' + bigFmt(d.mine.ever) + '</b></div></div>';
      else h += '<p class="small">Our own miner is not in this group\'s worker list (looking for a worker named with our ' + esc(String(c.coin).toUpperCase()) + ' wallet).</p>';
    }
    h += '<p class="small">From the ' + src + ', ' + ago(at) + '.</p>';
  }
  return h + '</section>';
}
function allEarned() { var m = {}; S.earned.concat(S.liveEarned).forEach(function (e) { if (!m[e.txid]) m[e.txid] = e; }); return Object.keys(m).map(function (k) { return m[k]; }); }
function inRange(ts) { var r = S.ui.range; if (r === "all") return true; if (/^y/.test(r)) return new Date(ts).getUTCFullYear() === +r.slice(1); return ts >= Date.now() - (+r) * DAY; }
function rows() { return allEarned().filter(function (e) { return inRange(e.ts) && (S.ui.coin === "all" || S.ui.coin === e.coin.toLowerCase()); }).sort(function (a, b) { return b.ts - a.ts; }); }
function earnHtml() {
  var rs = rows(), tot = { BTC: { s: 0, u: 0 }, BCH: { s: 0, u: 0 } };
  rs.forEach(function (e) { tot[e.coin].s += e.sats; tot[e.coin].u += e.sats / 1e8 * e.price; });
  var all = r2(tot.BTC.u + tot.BCH.u), ys = {}; allEarned().forEach(function (e) { ys[new Date(e.ts).getUTCFullYear()] = 1; });
  var opts = [["all", "All time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]].concat(Object.keys(ys).sort().reverse().map(function (y) { return ["y" + y, "Tax year " + y]; }));
  var h = '<details class="card" style="--c:var(--gold)" id="earnCard"' + (S.ui.open ? " open" : "") + '><summary><h2>Earnings</h2><div class="big" style="color:var(--gold)">' + usd(all) + '</div><div class="dim">' + rs.length + (rs.length === 1 ? " payout" : " payouts") + '</div></summary>';
  h += '<div class="row2"><select id="fRange">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === S.ui.range ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select><select id="fCoin">' + [["all", "All coins"], ["btc", "BTC"], ["bch", "BCH"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === S.ui.coin ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select></div>';
  h += '<div style="margin-top:10px"><div class="tot"><span>BTC: ' + coinAmt(tot.BTC.s) + '</span><b>' + usd(r2(tot.BTC.u)) + '</b></div><div class="tot"><span>BCH: ' + coinAmt(tot.BCH.s) + '</span><b>' + usd(r2(tot.BCH.u)) + '</b></div><div class="tot"><span>Total</span><b>' + usd(all) + '</b></div></div><div class="list">';
  if (!rs.length) h += '<p class="dim">No payouts yet. They show up here by themselves once a wallet in config.json gets paid.</p>';
  rs.forEach(function (e) {
    var u = r2(e.sats / 1e8 * e.price);
    h += '<details class="item"><summary><span class="l">' + niceDay(e.ts) + ' &middot; ' + e.coin + '<small>' + esc(e.what) + (e.pool ? ' &middot; ' + esc(e.pool) : '') + (e.fresh ? ' &middot; just found, saving soon' : '') + '</small></span><span class="r">' + usd(u) + '<small>' + n0(e.sats) + ' sats</small></span></summary><div class="math">' + coinAmt(e.sats) + ' ' + e.coin + ' @ $' + e.price.toFixed(2) + ' = ' + usd(u) + '<br>Price for ' + isoDay(e.ts) + ' (UTC). Transaction ' + esc(e.txid) + '</div></details>';
  });
  return h + '</div><button class="btn" type="button" id="copyEarn">Copy for a spreadsheet</button><div class="msg" id="copyMsg"></div></details>';
}
function earnTsv() { var L = [["Date (UTC)", "Coin", "What", "Pool", "Amount (coin)", "Sats", "Price that day (USD)", "Value (USD)", "Transaction"].join("\t")]; rows().reverse().forEach(function (e) { L.push([isoDay(e.ts), e.coin, e.what, e.pool || "", coinAmt(e.sats), e.sats, e.price.toFixed(2), r2(e.sats / 1e8 * e.price).toFixed(2), e.txid].join("\t")); }); return L.join("\n"); }
function histHtml() {
  var ps = S.pools.slice().sort(function (a, b) { return b.from - a.from; }), days = Object.keys(S.days).map(function (k) { return S.days[k]; });
  var h = '<details class="card" style="--c:var(--purple)"><summary><h2>Pool history <span class="dim">' + ps.length + '</span></h2></summary>';
  if (!ps.length) h += '<p class="dim">Each pool you switch to is listed here with its dates, once the GitHub job has run.</p>';
  ps.forEach(function (p, i) {
    var until = i > 0 ? ps[i - 1].from : 0, ds = days.filter(function (d) { return d.host === p.host && (d.last || 0) >= p.from && (!until || (d.last || 0) < until); });
    var best = ds.reduce(function (a, d) { return Math.max(a, d.best || 0); }, 0), my = ds.reduce(function (a, d) { return Math.max(a, d.myBest || 0); }, 0);
    h += '<details class="item"><summary><span class="l">' + esc(p.host) + (p.port ? ':' + esc(p.port) : '') + '<small>' + niceDay(p.from) + (until ? ' to ' + niceDay(until) : ' to now') + '</small></span><span class="r">' + tag(p.coin) + '<small>' + (p.type === "solo" ? "solo" : "pool") + '</small></span></summary><div class="math">Days with saved stats: ' + ds.length + (best ? ' &middot; best share seen: ' + bigFmt(best) : '') + (my ? ' &middot; our best: ' + bigFmt(my) : '') + '</div></details>';
  });
  return h + '</details>';
}
function statusTxt() {
  var bad = [], L = S.live;
  if (L.err.btc) bad.push("BTC block (" + L.err.btc + ")"); if (L.err.bch) bad.push("BCH block (" + L.err.bch + ")"); if (L.err.wallet) bad.push("wallet check (" + L.err.wallet + ")");
  var t = bad.length ? "Not coming through: " + bad.join(", ") + "." : (L.at ? "Live data on." : "Loading...");
  t += S.status && S.status.at ? " GitHub job last ran " + ago(S.status.at) + "." : " GitHub job has not run yet.";
  return t;
}
function drawAll() {
  var ae = document.activeElement; if (ae && ae.tagName === "SELECT") return;
  var h = '<div style="text-align:center"><button class="btn go" type="button" id="checkNow"' + (S.busy ? " disabled" : "") + '>' + (S.busy ? "Checking..." : "Check now") + '</button>' + (S.checkedAt ? '<p class="small">Checked ' + ago(S.checkedAt) + '.</p>' : '') + '</div>';
  h += poolHtml() + earnHtml() + histHtml();
  h += '<section class="card" style="--c:var(--line)"><h2>Costs, spends and money put in</h2><p class="small">Those stay private on the Claude page.</p><a class="btn" href="https://claude.ai/artifact/PmE4ixmkv4VVWKyfbM1F7Y" target="_blank" rel="noopener">Open the Claude page</a></section>';
  $("main").innerHTML = h; $("status").textContent = statusTxt();
  $("checkNow").onclick = checkNow;
  var fr = $("fRange"), fc = $("fCoin"), ec = $("earnCard");
  fr.onchange = function () { S.ui.range = fr.value; S.ui.open = true; fr.blur(); drawAll(); };
  fc.onchange = function () { S.ui.coin = fc.value; S.ui.open = true; fc.blur(); drawAll(); };
  ec.ontoggle = function () { S.ui.open = ec.open; };
  $("copyEarn").onclick = function () { var m = $("copyMsg"); navigator.clipboard.writeText(earnTsv()).then(function () { m.textContent = "Copied. Paste it into a spreadsheet."; }, function () { m.textContent = "Could not copy here."; }); };
}
(function stars() { var b = $("stars"), h = ""; for (var i = 0; i < 90; i++) h += '<i style="left:' + (Math.random() * 100).toFixed(2) + '%;top:' + (Math.random() * 100).toFixed(2) + '%;animation-delay:' + (Math.random() * 6).toFixed(1) + 's"></i>'; b.innerHTML = h; })();
drawChips(); drawAll(); checkNow();
setInterval(function () { if (!document.hidden) drawChips(); }, 1000);
setInterval(function () { if (!document.hidden) { liveBlocks(); } }, 60000);
setInterval(function () { if (!document.hidden && !S.busy) { loadSaved().then(livePool).then(drawAll); } }, 120000);
document.addEventListener("visibilitychange", function () { if (!document.hidden) checkNow(); });
