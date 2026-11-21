// Fire & Salt Mining collector. Runs on GitHub every ~10 minutes (and on demand).
// Reads config.json, fetches pool stats and wallet payouts, and saves them in data/.
// Nothing here is made up: if a site does not answer, that run saves nothing for it.
import fs from "node:fs";

const DATA = "data";
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, asText) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "fire-salt-live collector" } });
      if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return asText ? (await r.text()).trim() : await r.json();
    } catch (e) { if (i === 2) throw e; await sleep(2000); }
  }
  throw new Error("no answer");
}
const cleanHost = (h) => String(h || "").trim().replace(/^[a-z+]+:\/\//i, "").replace(/[/:].*$/, "").toLowerCase();
const normBch = (a) => String(a || "").trim().toLowerCase().replace(/^bitcoincash:/, "");
function statsKind(cfg) {
  const h = cleanHost(cfg.host), p = String(cfg.port || "");
  if (/ckpool/.test(h)) return "ckpool";
  if (/public-pool\.io/.test(h)) return "publicpool";
  if (/solopool\.org/.test(h) && (cfg.coin === "bch" || p === "9002")) return "solopool";
  return "";
}
function hNum(s) { const m = /^([0-9.]+)\s*([kKMGTPE]?)$/.exec(String(s ?? "")); if (!m) return 0; return Number(m[1]) * ({ "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 })[m[2]]; }

const cfg = read("config.json", {});
const now = Date.now();
fs.mkdirSync(DATA, { recursive: true });
const log = [];

// 1) Pool switch log: add an entry whenever config.json names a different pool.
const pools = read(`${DATA}/pools.json`, []);
const last = pools[pools.length - 1];
const sig = (x) => [cleanHost(x.host), x.port || "", x.coin || "", x.type || "", x.login || ""].join("|");
if (cfg.host && (!last || sig(last) !== sig(cfg))) {
  pools.push({ host: cleanHost(cfg.host), port: String(cfg.port || ""), coin: cfg.coin || "", type: cfg.type || "", login: cfg.login || "", from: now });
  write(`${DATA}/pools.json`, pools);
  log.push("pool switch logged");
}
const poolAt = (ts) => { let p = null; for (const x of pools) if (x.from <= ts && (!p || x.from > p.from)) p = x; return p; };

// 2) Pool stats.
const kind = statsKind(cfg), wallet = cfg.coin === "bch" ? normBch(cfg.bchWallet) : (cfg.btcWallet || "").trim();
const addr = (cfg.login || "").trim() || wallet;
const poolOut = { at: now, host: cleanHost(cfg.host), coin: cfg.coin || "", type: cfg.type || "", kind, login: cfg.login || "", d: null, err: "" };
if (!cfg.host) poolOut.err = "no pool set";
else if (!kind) poolOut.err = "this pool does not share stats we can read";
else if (!addr) poolOut.err = "no wallet for this coin";
else {
  try {
    let d;
    if (kind === "ckpool") {
      const j = await get(`https://${cleanHost(cfg.host)}/users/${addr}`);
      if (j.hashrate5m === undefined) throw new Error("pool does not know this address yet");
      const w = j.worker || [], t = now / 1000;
      d = { h5m: hNum(j.hashrate5m), h1h: hNum(j.hashrate1hr), h1d: hNum(j.hashrate1d), workers: j.workers || w.length,
        live: w.filter((x) => x.lastshare && t - x.lastshare < 600 && hNum(x.hashrate5m) > 0).length,
        last: (j.lastshare || 0) * 1000, shares: +j.shares || 0, best: +j.bestshare || 0, ever: +j.bestever || 0, mine: null };
      if (cfg.login && wallet) {
        const x = w.find((x) => String(x.workername || "").includes(wallet));
        if (x) d.mine = { h5m: hNum(x.hashrate5m), h1h: hNum(x.hashrate1hr), last: (x.lastshare || 0) * 1000, shares: +x.shares || 0, best: +x.bestshare || 0, ever: +x.bestever || 0 };
      }
    } else if (kind === "publicpool") {
      const j = await get(`https://public-pool.io:40557/api/client/${addr}`), a = j.accounting || {};
      d = { h5m: +a.hashRateLast10Minutes || 0, h1h: +a.hashRateLastHour || 0, h1d: 0, workers: j.workersCount || 0, live: j.workersCount || 0,
        last: a.latestShareAt ? Date.parse(a.latestShareAt) : 0, shares: +a.totalAcceptedShares || 0, best: +a.bestSubmissionDifficulty || 0, ever: +j.bestDifficulty || 0, mine: null };
    } else {
      const j = await get(`https://bch.solopool.org/api/accounts/${normBch(addr)}`);
      d = { h5m: +j.currentHashrate || 0, h1h: +j.hashrate || 0, h1d: 0, workers: j.workersOnline || 0, live: j.workersOnline || 0,
        last: j.stats && j.stats.lastShare ? j.stats.lastShare * 1000 : 0, shares: 0, best: 0, ever: 0, blocks: j.stats ? +j.stats.blocksFound || 0 : 0, mine: null };
    }
    poolOut.d = d;
    // history: every run, plus one summary per day that is kept forever
    const hist = read(`${DATA}/poolhist.json`, []);
    hist.push({ at: now, host: poolOut.host, coin: poolOut.coin, h5m: d.h5m, h1h: d.h1h, workers: d.workers, live: d.live, shares: d.shares, best: d.best, ever: d.ever, myH: d.mine ? d.mine.h1h : null, myBest: d.mine ? d.mine.best : null });
    write(`${DATA}/poolhist.json`, hist.slice(-20000));
    const days = read(`${DATA}/pooldays.json`, {});
    const key = new Date(now).toISOString().slice(0, 10) + " " + poolOut.host, p = days[key] || { day: key.slice(0, 10), host: poolOut.host, coin: poolOut.coin, checks: 0, maxH1h: 0, best: 0, myBest: 0 };
    p.checks++; p.maxH1h = Math.max(p.maxH1h, d.h1h || 0); p.best = Math.max(p.best, d.best || 0); if (d.mine) p.myBest = Math.max(p.myBest, d.mine.best || 0); p.last = now;
    days[key] = p; write(`${DATA}/pooldays.json`, days);
    log.push("pool stats saved");
  } catch (e) { poolOut.err = String(e.message || e).slice(0, 120); log.push("pool stats failed: " + poolOut.err); }
}
write(`${DATA}/pool.json`, poolOut);

// 3) Wallet payouts (BTC and BCH), each priced at the day it arrived.
const earned = read(`${DATA}/earned.json`, []);
const seen = new Set(earned.map((e) => e.txid));
let added = 0;
async function scanBtc(a) {
  let all = [], lastId = "", n = 0;
  while (n < 20) {
    const page = await get(`https://mempool.space/api/address/${a}/txs` + (lastId ? `/chain/${lastId}` : ""));
    all = all.concat(page);
    const conf = page.filter((t) => t.status && t.status.confirmed);
    if (conf.length < 25) break; lastId = conf[conf.length - 1].txid; n++;
  }
  for (const t of all) {
    if (!t.status || !t.status.confirmed || seen.has(t.txid)) continue;
    let got = 0, spent = false;
    for (const o of t.vout || []) if (o.scriptpubkey_address === a) got += o.value || 0;
    for (const i of t.vin || []) if (i.prevout && i.prevout.scriptpubkey_address === a) spent = true;
    if (!(got > 0) || spent) continue;
    const bt = t.status.block_time, j = await get(`https://mempool.space/api/v1/historical-price?currency=USD&timestamp=${bt}`);
    const px = j && j.prices && j.prices[0] && Number(j.prices[0].USD);
    if (!(px > 0)) continue; // never invent a price; try again next run
    const cb = !!(t.vin && t.vin[0] && t.vin[0].is_coinbase), h = t.status.block_height || 0, p = poolAt(bt * 1000);
    earned.push({ txid: t.txid, ts: bt * 1000, coin: "BTC", sats: got, price: px, what: cb ? `Block #${h}` : "Payout", height: h, wallet: a, pool: p ? p.host : "" });
    seen.add(t.txid); added++;
  }
}
async function scanBch(a) {
  const full = "bitcoincash:" + a; let all = [], off = 0;
  for (let n = 0; n < 20; n++) {
    const page = await get(`https://api.blockchain.info/haskoin-store/bch/address/${a}/transactions/full?limit=100&offset=${off}`);
    all = all.concat(page); if (page.length < 100) break; off += 100;
  }
  for (const t of all) {
    if (!t.block || !t.block.height || !t.time || seen.has(t.txid)) continue;
    let got = 0, spent = false;
    for (const o of t.outputs || []) if (o.address === full) got += o.value || 0;
    for (const i of t.inputs || []) if (i.address === full) spent = true;
    if (!(got > 0) || spent) continue;
    const d = new Date(t.time * 1000), ds = `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
    const j = await get(`https://api.coingecko.com/api/v3/coins/bitcoin-cash/history?date=${ds}&localization=false`);
    const px = j && j.market_data && j.market_data.current_price && Number(j.market_data.current_price.usd);
    if (!(px > 0)) continue;
    const cb = !!(t.inputs && t.inputs[0] && t.inputs[0].coinbase), p = poolAt(t.time * 1000);
    earned.push({ txid: t.txid, ts: t.time * 1000, coin: "BCH", sats: got, price: px, what: cb ? `Block #${t.block.height}` : "Payout", height: t.block.height, wallet: a, pool: p ? p.host : "" });
    seen.add(t.txid); added++;
    await sleep(1500);
  }
}
try { if (cfg.btcWallet) await scanBtc(cfg.btcWallet.trim()); } catch (e) { log.push("BTC wallet failed: " + e.message); }
try { if (cfg.bchWallet) await scanBch(normBch(cfg.bchWallet)); } catch (e) { log.push("BCH wallet failed: " + e.message); }
earned.sort((a, b) => a.ts - b.ts);
write(`${DATA}/earned.json`, earned);
log.push(`payouts: ${added} new, ${earned.length} total`);

write(`${DATA}/status.json`, { at: now, log });
console.log(log.join("\n"));
