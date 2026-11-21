"use strict";
/* Private part of the site: setup, money put in, costs, spends.
   - Saving uses a GitHub key (only people who can change this repo can save).
   - Money put in, costs and spends are locked with your shared password (AES-GCM) before they are saved,
     so the file in the public repo is scrambled for everyone else.
   - The key and password stay only in this phone's browser. */
var REPO = "harrisonfire86/fire-salt-live";
var P = { key: "", pass: "", ok: false, data: null, sha: "", salt: "", err: "", msg: {}, sure: {}, busy: false, needCreate: false };
try { P.key = localStorage.getItem("fsKey") || ""; P.pass = localStorage.getItem("fsPass") || ""; } catch (e) {}

/* ---------- base64 helpers (UTF-8 safe) ---------- */
function b64(bytes) { var s = ""; bytes = new Uint8Array(bytes); for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
function unb64(s) { var b = atob(String(s).replace(/\s/g, "")), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function utf8b64(t) { return b64(new TextEncoder().encode(t)); }
function b64utf8(s) { return new TextDecoder().decode(unb64(s)); }

/* ---------- lock and unlock (password -> AES key) ---------- */
function deriveKey(pass, salt) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]).then(function (k) {
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(salt), iterations: 250000, hash: "SHA-256" }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  });
}
function lock(obj, pass, salt) {
  var iv = crypto.getRandomValues(new Uint8Array(12));
  return deriveKey(pass, salt).then(function (k) { return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj))); })
    .then(function (ct) { return { v: 1, note: "Locked with the Fire & Salt password.", salt: salt, iv: b64(iv), ct: b64(ct) }; });
}
function unlock(box, pass) {
  return deriveKey(pass, box.salt).then(function (k) { return crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, k, unb64(box.ct)); })
    .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); }, function () { throw new Error("wrong password"); });
}

/* ---------- GitHub API ---------- */
function gh(path, opts) {
  opts = opts || {};
  return fetch("https://api.github.com/repos/" + REPO + path, { method: opts.method || "GET", cache: "no-store", headers: { "Authorization": "Bearer " + P.key, "Accept": "application/vnd.github+json" }, body: opts.body ? JSON.stringify(opts.body) : undefined })
    .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) {} if (!r.ok) { var er = new Error((j && j.message) || ("GitHub said " + r.status)); er.status = r.status; throw er; } return j; }); });
}
function readFile(path) { return gh("/contents/" + path + "?ref=main&t=" + Date.now()).then(function (j) { return { sha: j.sha, text: b64utf8(j.content) }; }); }
function writeFile(path, text, sha, msg) { var body = { message: msg, content: utf8b64(text), branch: "main" }; if (sha) body.sha = sha; return gh("/contents/" + path, { method: "PUT", body: body }).then(function (j) { return j.content.sha; }); }

/* read the private file, change it, lock it, save it. Re-reads and tries once more if someone else saved in between. */
function savePrivate(change, msg, tries) {
  tries = tries || 0;
  return readFile("data/private.json").then(function (f) {
    var box = JSON.parse(f.text);
    return unlock(box, P.pass).then(function (data) { change(data); return lock(data, P.pass, box.salt).then(function (nb) { return writeFile("data/private.json", JSON.stringify(nb, null, 1) + "\n", f.sha, msg).then(function (sha) { P.data = data; P.sha = sha; P.salt = box.salt; }); }); });
  }).catch(function (e) { if ((e.status === 409 || e.status === 422) && tries < 1) return savePrivate(change, msg, tries + 1); throw e; });
}
function emptyLog() { return { payments: [], costs: [], spent: [] }; }

function tryUnlock() {
  P.err = ""; P.needCreate = false; P.busy = true; drawAll();
  return gh("").then(function (repo) {
    if (!repo.permissions || !repo.permissions.push) throw new Error("this GitHub key cannot change the repo");
    return readFile("data/private.json").then(function (f) {
      var box = JSON.parse(f.text);
      return unlock(box, P.pass).then(function (data) { P.data = data; P.sha = f.sha; P.salt = box.salt; P.ok = true; try { localStorage.setItem("fsKey", P.key); localStorage.setItem("fsPass", P.pass); } catch (e) {} });
    }, function (e) { if (e.status === 404) { P.needCreate = true; return; } throw e; });
  }).catch(function (e) { P.ok = false; P.err = e.status === 401 ? "GitHub did not accept that key" : errTxt(e); })
    .then(function () { P.busy = false; drawAll(); });
}
function createLog() {
  P.busy = true; drawAll();
  var salt = b64(crypto.getRandomValues(new Uint8Array(16))), data = emptyLog();
  lock(data, P.pass, salt).then(function (box) { return writeFile("data/private.json", JSON.stringify(box, null, 1) + "\n", "", "Create locked private log"); })
    .then(function (sha) { P.data = data; P.sha = sha; P.salt = salt; P.ok = true; P.needCreate = false; try { localStorage.setItem("fsKey", P.key); localStorage.setItem("fsPass", P.pass); } catch (e) {} },
      function (e) { P.err = errTxt(e); })
    .then(function () { P.busy = false; drawAll(); });
}
function lockPhone() { try { localStorage.removeItem("fsKey"); localStorage.removeItem("fsPass"); } catch (e) {} P.key = ""; P.pass = ""; P.ok = false; P.data = null; drawAll(); }

/* ---------- FIFO for spends ---------- */
function dayToTs(s) { var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : 0; }
function usDate(ts) { var d = new Date(ts); return p2(d.getUTCMonth() + 1) + "/" + p2(d.getUTCDate()) + "/" + d.getUTCFullYear(); }
function fifo() {
  var lots = { BTC: [], BCH: [] }, out = [];
  allEarned().slice().sort(function (a, b) { return a.ts - b.ts; }).forEach(function (e) { lots[e.coin].push({ ts: e.ts, left: e.sats, price: e.price }); });
  (P.data ? P.data.spent : []).map(function (s) { return { id: s.id, ts: dayToTs(s.date), date: s.date, coin: s.coin, kind: s.kind, sats: s.sats, price: s.price, what: s.what, at: s.at }; })
    .sort(function (a, b) { return a.ts - b.ts || a.at - b.at; }).forEach(function (s) {
      var need = s.sats, parts = [], L = lots[s.coin] || [];
      for (var i = 0; i < L.length && need > 0; i++) { var l = L[i]; if (l.left <= 0 || l.ts > s.ts) continue; var take = Math.min(l.left, need); l.left -= take; need -= take; parts.push({ ts: l.ts, sats: take, cost: r2(take / 1e8 * l.price) }); }
      if (need > 0) parts.push({ ts: 0, sats: need, cost: 0 });
      var proceeds = r2(s.sats / 1e8 * s.price), cost = r2(parts.reduce(function (a, p) { return a + p.cost; }, 0)), first = parts.filter(function (p) { return p.ts; })[0];
      out.push({ s: s, parts: parts, proceeds: proceeds, cost: cost, gain: r2(proceeds - cost), acq: first ? first.ts : 0, box: first && s.ts - first.ts > 365 * DAY ? "L" : "I" });
    });
  return out;
}

/* ---------- forms ---------- */
function field(id, label, kind, val) {
  var h = '<label for="' + id + '">' + label + '</label>';
  if (kind === "date") return h + '<input type="date" id="' + id + '" value="' + (val || isoDay(Date.now())) + '">';
  if (kind.indexOf("select:") === 0) return h + '<select id="' + id + '">' + kind.slice(7).split("|").map(function (o) { var v = o.split("=")[0], t = o.split("=")[1] || v; return '<option value="' + v + '"' + (v === val ? " selected" : "") + '>' + t + '</option>'; }).join("") + '</select>';
  return h + '<input id="' + id + '"' + (kind === "num" ? ' inputmode="decimal"' : ' autocapitalize="off" spellcheck="false" autocomplete="off"') + ' value="' + esc(val || "") + '">';
}
function v(id) { var e = $(id); return e ? e.value.trim() : ""; }
function say(k, t) { P.msg[k] = t; var e = $("pm-" + k); if (e) e.textContent = t; }
function msgDiv(k) { return '<div class="msg" id="pm-' + k + '">' + esc(P.msg[k] || "") + '</div>'; }
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function delBtn(col, id) { var k = col + "/" + id; return '<button class="btn warn" type="button" data-pdel="' + esc(k) + '">' + (P.sure[k] ? "Tap again to remove" : "Remove") + '</button>'; }

/* ---------- cards ---------- */
function unlockHtml() {
  var h = '<details class="card" style="--c:var(--green)" id="unlockCard"' + (P.err || P.needCreate || P.key ? " open" : "") + '><summary><h2>Unlock (Fire and Salty only)</h2><div class="dim">Setup, money put in, costs and spends</div></summary>';
  h += '<p class="small">Do this once on each phone. Both stay only in this browser.</p>';
  h += field("pKey", "GitHub key", "text", P.key) + field("pPass", "Fire &amp; Salt password (the same for both of you)", "text", P.pass);
  if (P.needCreate) h += '<p class="msg">No locked log yet. Create it with this password? Write the password down: if it is lost, the private entries cannot be opened.</p><button class="btn go" type="button" id="pCreate">Create the locked log</button>';
  else h += '<button class="btn go" type="button" id="pUnlock"' + (P.busy ? " disabled" : "") + '>' + (P.busy ? "Checking..." : "Unlock") + '</button>';
  if (P.err) h += '<p class="msg">' + esc(P.err) + '</p>';
  return h + '</details>';
}
function setupHtml() {
  var c = S.cfg || {};
  var h = '<details class="card" style="--c:var(--green)"><summary><h2>Setup: pool and wallets</h2><div class="dim">' + esc(cleanHost(c.host) || "No pool set") + '</div></summary>';
  h += field("sHost", "Pool address (type it, like solo.ckpool.org)", "text", c.host) + field("sPort", "Port (like 3333)", "num", c.port);
  h += '<div class="row2"><div>' + field("sCoin", "Coin", "select:=Pick one|btc=BTC|bch=BCH", c.coin) + '</div><div>' + field("sType", "Kind of mining", "select:=Pick one|solo=Solo block hunting|pool=Pool mining", c.type) + '</div></div><p class="small" id="sGuess"></p>';
  h += field("sBtc", "BTC wallet (where BTC payouts land)", "text", c.btcWallet) + field("sBch", "BCH wallet (where BCH payouts land)", "text", c.bchWallet) + field("sLogin", "Pool login address, only if it is not your wallet (like a block party address)", "text", c.login);
  return h + '<button class="btn go" type="button" id="sSave">Save</button>' + msgDiv("setup") + '<p class="small">Saving logs the pool switch and starts a check within a minute or two. Earlier history stays.</p></details>';
}
function guessPool(host, port) { var h = cleanHost(host), p = String(port || ""); if (/ckpool/.test(h)) return { coin: "btc", type: "solo" }; if (/public-pool\.io/.test(h)) return { coin: "btc", type: p === "13333" ? "pool" : "solo" }; if (/solopool\.org/.test(h) && (/^bch\./.test(h) || p === "9002")) return { coin: "bch", type: "solo" }; if (/nerdminer/.test(h)) return { coin: "btc", type: "solo" }; return {}; }
function isBtc(a) { return /^(bc1[02-9ac-hj-np-z]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/.test(a); }
function isBch(a) { return /^[qp][02-9ac-hj-np-z]{41}$/.test(normBch(a)); }
function saveSetup() {
  var host = cleanHost(v("sHost")), port = v("sPort").replace(/\D/g, ""), coin = v("sCoin"), type = v("sType"), btc = v("sBtc"), bch = normBch(v("sBch")), login = v("sLogin");
  if (!host && (coin || type || login)) return say("setup", "Type the pool address first.");
  if (host && !/^[a-z0-9.\-]+$/.test(host)) return say("setup", "That pool address does not look right.");
  if (host && (!coin || !type)) return say("setup", "Pick the coin and the kind of mining.");
  if (btc && !isBtc(btc)) return say("setup", "That BTC wallet does not look right.");
  if (bch && !isBch(bch)) return say("setup", "That BCH wallet does not look right. It should start with q.");
  if (login && !isBtc(login) && !isBch(login)) return say("setup", "That pool login address does not look like a wallet address.");
  var cfg = { host: host, port: port, coin: coin, type: type, login: login, btcWallet: btc, bchWallet: bch };
  say("setup", "Saving...");
  readFile("config.json").then(function (f) { return writeFile("config.json", JSON.stringify(cfg, null, 2) + "\n", f.sha, "Setup: " + (host || "no pool")); })
    .then(function () { S.cfg = cfg; P.msg.setup = "Saved. The pool switch is logged on the next check, within a minute or two."; S.livePool = null; drawAll(); livePool().then(drawAll); },
      function (e) { say("setup", "Could not save: " + errTxt(e)); });
}

function moneyHtml() {
  var rows = P.data.payments.slice().sort(function (a, b) { return b.date < a.date ? -1 : 1; }), who = {}, tot = 0;
  rows.forEach(function (p) { who[p.who] = (who[p.who] || 0) + p.usd; tot += p.usd; });
  var h = '<details class="card" style="--c:var(--teal)"><summary><h2>Money we put in</h2><div class="big" style="color:var(--teal)">' + usd(r2(tot)) + '</div><div class="dim">' + Object.keys(who).map(function (k) { return esc(k) + " " + usd(r2(who[k])); }).join(" &middot; ") + '</div></summary>';
  h += '<details class="item"><summary><span class="l" style="font-weight:800;color:var(--green)">+ Add an entry</span></summary>' + field("mDate", "Date", "date") + field("mWho", "Who", "select:Fire|Salty") + field("mUsd", "Amount (USD)", "num") + field("mWhat", "How (like Robinhood or Cash)", "text") + '<button class="btn go" type="button" id="mAdd">Save entry</button>' + msgDiv("money") + '</details>';
  h += '<details class="item"><summary><span class="l" style="font-weight:800;color:var(--green)">+ Bring in entries from the Claude page</span></summary><p class="small">On the Claude page, open Money we put in, tap Copy for a spreadsheet, and paste it here.</p><textarea id="mImport" rows="5" style="width:100%;background:#0a0a0f;color:var(--txt);border:1.5px solid var(--line);border-radius:12px;padding:10px;font-size:14px"></textarea><button class="btn go" type="button" id="mImportBtn">Bring them in</button>' + msgDiv("import") + '</details>';
  h += '<div class="list">';
  rows.forEach(function (p) { h += '<details class="item"><summary><span class="l">' + niceDay(dayToTs(p.date)) + ' &middot; ' + esc(p.who) + '<small>' + esc(p.what) + '</small></span><span class="r">' + usd(p.usd) + '</span></summary>' + delBtn("payments", p.id) + '</details>'; });
  if (!rows.length) h += '<p class="dim">Nothing added yet.</p>';
  return h + '</div></details>';
}
function costsHtml() {
  var rows = P.data.costs.slice().sort(function (a, b) { return b.date < a.date ? -1 : 1; }), total = r2(rows.reduce(function (a, c) { return a + c.usd; }, 0));
  var earned = r2(allEarned().reduce(function (a, e) { return a + e.sats / 1e8 * e.price; }, 0)), pct = total > 0 ? Math.min(100, earned / total * 100) : 0, by = {};
  rows.forEach(function (c) { by[c.kind] = (by[c.kind] || 0) + c.usd; });
  var h = '<details class="card" style="--c:var(--green)"><summary><h2>Costs &amp; ROI</h2><div class="big" style="color:' + (pct >= 100 ? "var(--green)" : "#ffb020") + '">' + (total > 0 ? (pct >= 100 ? "100" : Math.min(99.9, pct).toFixed(1)) + "% returned" : "No costs yet") + '</div>';
  if (total > 0) h += '<div class="bar"><i class="' + (pct >= 100 ? "done" : "") + '" style="width:' + pct.toFixed(1) + '%"></i></div><div class="dim">Earned ' + usd(earned) + ' of ' + usd(total) + '</div>';
  h += '</summary>';
  Object.keys(by).forEach(function (k) { h += '<div class="tot"><span>' + esc(k) + '</span><b>' + usd(r2(by[k])) + '</b></div>'; });
  h += '<details class="item"><summary><span class="l" style="font-weight:800;color:var(--green)">+ Add an entry</span></summary>' + field("cDate", "Date", "date") + field("cKind", "Kind of cost", "select:Miner|Hosting|Power|Rented hashrate|Setup|Repairs|Other") + field("cUsd", "Amount (USD)", "num") + field("cWhat", "What it was", "text") + '<button class="btn go" type="button" id="cAdd">Save entry</button>' + msgDiv("cost") + '</details><div class="list">';
  rows.forEach(function (c) { h += '<details class="item"><summary><span class="l">' + niceDay(dayToTs(c.date)) + ' &middot; ' + esc(c.kind) + '<small>' + esc(c.what) + '</small></span><span class="r">' + usd(c.usd) + '</span></summary>' + delBtn("costs", c.id) + '</details>'; });
  if (!rows.length) h += '<p class="dim">Nothing added yet.</p>';
  return h + '</div></details>';
}
function spentHtml() {
  var all = fifo().reverse(), P_ = r2(all.reduce(function (a, x) { return a + x.proceeds; }, 0)), C = r2(all.reduce(function (a, x) { return a + x.cost; }, 0));
  var h = '<details class="card" style="--c:var(--pink)"><summary><h2>Spent / sold</h2><div class="big" style="color:var(--pink)">' + (all.length ? (P_ - C >= 0 ? "+" : "") + usd(r2(P_ - C)) : "Nothing yet") + '</div><div class="dim">Gain or loss, oldest coins used first</div></summary>';
  if (all.length) h += '<div class="tot"><span>Proceeds</span><b>' + usd(P_) + '</b></div><div class="tot"><span>Cost</span><b>' + usd(C) + '</b></div>';
  h += '<details class="item"><summary><span class="l" style="font-weight:800;color:var(--green)">+ Add an entry</span></summary>' + field("xDate", "Date", "date") + field("xCoin", "Coin", "select:BTC|BCH") + field("xKind", "Spent or sold", "select:Spent|Sold") + field("xAmt", "How many coins", "num") + field("xPrice", "Price of one coin that day (USD)", "num") + field("xWhat", "What for", "text") + '<button class="btn go" type="button" id="xAdd">Save entry</button>' + msgDiv("spend") + '</details><div class="list">';
  all.forEach(function (x) { var s = x.s; h += '<details class="item"><summary><span class="l">' + niceDay(s.ts) + ' &middot; ' + s.kind + ' ' + s.coin + '<small>' + esc(s.what) + '</small></span><span class="r">' + (x.gain >= 0 ? "+" : "") + usd(x.gain) + '<small>' + coinAmt(s.sats) + ' ' + s.coin + '</small></span></summary><div class="math">Proceeds ' + coinAmt(s.sats) + ' @ $' + s.price.toFixed(2) + ' = ' + usd(x.proceeds) + '<br>Cost: ' + x.parts.map(function (p) { return p.ts ? coinAmt(p.sats) + " from " + isoDay(p.ts) + " = " + usd(p.cost) : coinAmt(p.sats) + " not matched to logged income, cost $0"; }).join("; ") + '</div>' + delBtn("spent", s.id) + '</details>'; });
  if (!all.length) h += '<p class="dim">Nothing added yet.</p>';
  return h + '</div><button class="btn" type="button" id="copy8949">Copy Form 8949 list</button>' + msgDiv("8949") + '</details>';
}
function f8949Tsv() { var L = [["Description (a)", "Date acquired (b)", "Date sold (c)", "Proceeds (d)", "Cost basis (e)", "Adjustment code (f)", "Adjustment amount (g)", "Gain or loss (h)", "Form 8949 box", "What for"].join("\t")]; fifo().forEach(function (x) { var s = x.s; L.push([coinAmt(s.sats) + " " + s.coin, x.acq ? usDate(x.acq) : "VARIOUS", usDate(s.ts), x.proceeds.toFixed(2), x.cost.toFixed(2), "", "", x.gain.toFixed(2), x.box, s.what].join("\t")); }); return L.join("\n"); }
function everythingTsv() {
  var c = ["Date\tKind\tWhat\tAmount (USD)"].concat(P.data.costs.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (x) { return [x.date, x.kind, x.what, x.usd.toFixed(2)].join("\t"); }));
  var m = ["Date\tWho\tHow\tAmount (USD)"].concat(P.data.payments.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (x) { return [x.date, x.who, x.what, x.usd.toFixed(2)].join("\t"); }));
  return "EARNINGS\n" + earnTsv() + "\n\nSPENT / SOLD (FORM 8949)\n" + f8949Tsv() + "\n\nCOSTS\n" + c.join("\n") + "\n\nMONEY PUT IN\n" + m.join("\n");
}

window.privateHtml = function () {
  if (!P.ok) return unlockHtml();
  return setupHtml() + moneyHtml() + costsHtml() + spentHtml() +
    '<section class="card" style="--c:var(--line)"><h2>Copy everything</h2><p class="small">Earnings, Spent / sold (Form 8949), costs and money put in, in one copy for a spreadsheet.</p><button class="btn" type="button" id="copyAll">Copy everything</button>' + msgDiv("all") + '<p class="small" style="margin-top:14px">This phone is unlocked. <button class="btn" type="button" id="pLock">Lock this phone</button></p></section>';
};
function copyTo(k, t) { navigator.clipboard.writeText(t).then(function () { say(k, "Copied. Paste it into a spreadsheet."); }, function () { say(k, "Could not copy here."); }); }
function add(col, doc, k, label) {
  say(k, "Saving...");
  savePrivate(function (d) { d[col].push(doc); }, "Add " + label).then(function () { P.msg[k] = "Saved."; drawAll(); }, function (e) { say(k, "Could not save: " + errTxt(e)); });
}
window.privateWire = function () {
  var u = $("pUnlock"); if (u) u.onclick = function () { P.key = v("pKey"); P.pass = $("pPass").value; if (!P.key || !P.pass) { P.err = "Fill in both boxes."; drawAll(); return; } tryUnlock(); };
  var cr = $("pCreate"); if (cr) cr.onclick = function () { P.key = v("pKey"); P.pass = $("pPass").value; createLog(); };
  var lk = $("pLock"); if (lk) lk.onclick = lockPhone;
  var sv = $("sSave"); if (sv) sv.onclick = saveSetup;
  ["sHost", "sPort"].forEach(function (id) { var e = $(id); if (e) e.oninput = function () { var g = guessPool(v("sHost"), v("sPort")); if (g.coin) $("sCoin").value = g.coin; if (g.type) $("sType").value = g.type; var el = $("sGuess"); if (el) el.textContent = cleanHost(v("sHost")) ? (g.coin ? "Looks like " + g.coin.toUpperCase() + ", " + (g.type === "solo" ? "solo block hunting" : "pool mining") + ". Change it if that is wrong." : "I do not know this pool yet. Pick the coin and kind of mining.") : ""; }; });
  var ma = $("mAdd"); if (ma) ma.onclick = function () { var u = r2(parseFloat(v("mUsd"))); if (!dayToTs(v("mDate"))) return say("money", "Pick a date."); if (!(u > 0)) return say("money", "Type an amount in dollars."); add("payments", { id: newId(), date: v("mDate"), who: v("mWho"), usd: u, what: v("mWhat") || "Payment", at: Date.now() }, "money", "money put in"); };
  var ca = $("cAdd"); if (ca) ca.onclick = function () { var u = r2(parseFloat(v("cUsd"))); if (!dayToTs(v("cDate"))) return say("cost", "Pick a date."); if (!(u > 0)) return say("cost", "Type an amount in dollars."); add("costs", { id: newId(), date: v("cDate"), kind: v("cKind"), usd: u, what: v("cWhat") || v("cKind"), at: Date.now() }, "cost", "cost"); };
  var xa = $("xAdd"); if (xa) xa.onclick = function () { var a = parseFloat(v("xAmt")), p = parseFloat(v("xPrice")); if (!dayToTs(v("xDate"))) return say("spend", "Pick a date."); if (!(a > 0)) return say("spend", "Type how many coins."); if (!(p > 0)) return say("spend", "Type the price of one coin that day."); add("spent", { id: newId(), date: v("xDate"), coin: v("xCoin"), kind: v("xKind"), sats: Math.round(a * 1e8), price: p, what: v("xWhat") || v("xKind"), at: Date.now() }, "spend", "spend"); };
  var mi = $("mImportBtn"); if (mi) mi.onclick = function () {
    var lines = ($("mImport").value || "").split(/\r?\n/), add_ = [];
    lines.forEach(function (l) { var c = l.split("\t"); if (c.length >= 4 && /^\d{4}-\d\d-\d\d$/.test(c[0].trim())) { var u = r2(parseFloat(c[3])); if (u > 0) add_.push({ date: c[0].trim(), who: c[1].trim(), what: c[2].trim(), usd: u }); } });
    if (!add_.length) return say("import", "Nothing to bring in. Paste the copied text from the Claude page.");
    say("import", "Saving...");
    savePrivate(function (d) { var have = {}; d.payments.forEach(function (p) { have[[p.date, p.who, p.what, p.usd].join("|")] = 1; }); add_.forEach(function (p) { if (!have[[p.date, p.who, p.what, p.usd].join("|")]) { p.id = newId() + Math.random().toString(36).slice(2, 4); p.at = Date.now(); d.payments.push(p); } }); }, "Bring in money put in")
      .then(function () { P.msg.import = "Brought in. Entries already there were skipped."; drawAll(); }, function (e) { say("import", "Could not save: " + errTxt(e)); });
  };
  Array.prototype.forEach.call(document.querySelectorAll("[data-pdel]"), function (b) { b.onclick = function () { var k = b.getAttribute("data-pdel"); if (!P.sure[k]) { P.sure[k] = true; b.textContent = "Tap again to remove"; return; } delete P.sure[k]; var col = k.split("/")[0], id = k.split("/")[1]; savePrivate(function (d) { d[col] = d[col].filter(function (x) { return x.id !== id; }); }, "Remove entry").then(drawAll, function (e) { alertMsg(errTxt(e)); }); }; });
  var c8 = $("copy8949"); if (c8) c8.onclick = function () { copyTo("8949", f8949Tsv()); };
  var call = $("copyAll"); if (call) call.onclick = function () { copyTo("all", everythingTsv()); };
};
function alertMsg(t) { var s = $("status"); if (s) s.textContent = "Could not remove: " + t; }
if (P.key && P.pass) tryUnlock();
drawAll();
