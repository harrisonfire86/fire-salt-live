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
function bitsToDiff(bits) { var e = bits >>> 24, m = bits & 0xffffff; return (0xffff / m) * Math.pow(256, 0x1d - e); }
function zerosOf(d) { return d >= 1 ? 8 + Math.floor(Math.log(d) / Math.log(16) + 1e-9) : 8; }
var LADDER_NAMES = ["", "16", "256", "4 thousand", "65 thousand", "1 million", "17 million", "268 million", "4.3 billion", "69 billion", "1.1 trillion", "17.6 trillion", "281 trillion", "4.5 quadrillion"];
function ladderHtml(coin, best, ever, mine) {
  var net = coin === "bch" ? S.live.bchDiff : S.live.btcDiff, need = net ? zerosOf(net) : 0;
  var marks = {}; function mark(d, t) { if (d > 0) { var z = zerosOf(d); (marks[z] = marks[z] || []).push(t); } }
  mark(best, "best this round"); mark(ever, "best ever"); if (mine) mark(mine, "our best");
  var top = Math.max(need || 20, 20), h = '<details class="item"><summary><span class="l" style="font-weight:800;color:var(--teal)">What do these numbers mean?</span></summary>';
  h += '<p class="small">Each try is like a lottery ticket. A block needs a ticket that starts with enough zeros. The best share number says how many times rarer a ticket was than the easiest one the pool counts (8 zeros). Each extra zero is 16 times rarer.</p><div class="ladder">';
  for (var z = top; z >= 8; z--) {
    var from = z === 8 ? "1" : LADDER_NAMES[z - 8] || "", isNeed = need && z === need, m = marks[z];
    h += '<div class="lrow' + (isNeed ? " need" : "") + (m ? " hit" : "") + '"><span class="lz">' + z + ' zeros</span><span class="lv">' + (from ? from + " and up" : "") + '</span>' + (isNeed ? '<span class="lt">block needs this</span>' : '') + (m ? '<span class="lt">' + m.join(", ") + '</span>' : '') + '</div>';
  }
  h += '</div>' + (net ? '<p class="small">A ' + coin.toUpperCase() + ' block right now needs a difficulty of ' + bigFmt(net) + ' (' + need + ' zeros), from the latest block.</p>' : '<p class="small">Waiting for the latest block to know what a block needs.</p>');
  return h + '</details>';
}
/* ---------- "Block tries" night-sky star chart (the original design), fed with real rounds ----------
   Each dot is one block round: how many zeros its best try had (left to right), oldest at the top, newest at the bottom.
   Dots turn blue -> purple -> red near the block line. Gold, silver and bronze stars mark the three best rounds. */
var SC = { range: "7", who: "group", pick: -1 };
function whenTxt(t) { var d = new Date(t); return MON[d.getMonth()] + " " + d.getDate() + ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function zf(d) { return d > 0 ? 8 + Math.log(d) / Math.log(16) : 0; }
function starRows() {
  var c = S.cfg || {}, host = cleanHost(c.host), lim = SC.range === "all" ? 0 : Date.now() - (+SC.range) * DAY;
  return (S.hist || []).filter(function (r) { return r.host === host && (r.last || r.at) >= lim; })
    .map(function (r) { return { t: r.last || r.at, b: +(SC.who === "mine" ? r.myBest : r.best) || 0, h: r.height || 0 }; })
    .filter(function (r) { return r.b > 0; }).sort(function (a, b) { return a.t - b.t; });
}
function oddsTxt() {
  var c = S.cfg || {}, net = c.coin === "bch" ? S.live.bchDiff : S.live.btcDiff, d = S.pool && S.pool.d, hr = SC.who === "mine" ? (d && d.mine ? d.mine.h1h : 0) : (d ? d.h1h : 0);
  if (!net || !(hr > 0)) return "--";
  var perDay = hr * 86400 / (net * 4294967296);
  return perDay >= 1 ? "about " + perDay.toFixed(1) + " a day" : "1 in " + Math.max(1, Math.round(1 / perDay)).toLocaleString("en-US") + " a day";
}
function starHtml() {
  var c = S.cfg || {}; if (!c.host || (statsKind(c) !== "ckpool" && statsKind(c) !== "publicpool")) return "";
  var rows = starRows(), net = c.coin === "bch" ? S.live.bchDiff : S.live.btcDiff, top = rows.reduce(function (a, r) { return Math.max(a, r.b); }, 0), hasMine = (S.hist || []).some(function (r) { return r.myBest > 0; });
  var h = '<details class="skyCard" id="starCard" open><summary class="skyHead"><span class="skyTitle">Block tries</span><span class="skyBest">' + (top ? 'Best: ' + zf(top).toFixed(1) + ' zeros &#9733;' : 'Best: none yet') + '</span></summary>';
  h += '<div class="row2" style="margin:6px 0 4px"><select id="scRange">' + [["1", "Last 24 hours"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["all", "All saved"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === SC.range ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select>';
  h += '<select id="scWho">' + [["group", c.login ? "Whole group" : "Our address"], ["mine", "Our miner only"]].filter(function (o) { return o[0] === "group" || hasMine; }).map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === SC.who ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select></div>';
  h += '<svg id="skySvg" viewBox="0 0 360 440" width="100%" role="img" aria-label="Night sky chart of our block tries. Zeros run across the bottom and time runs down the side."></svg>';
  var pk = rows[SC.pick] || rows.reduce(function (a, r) { return !a || r.b > a.b ? r : a; }, null);
  if (pk) h += '<div class="skyPick"><span class="skyPickT">' + (rows[SC.pick] ? "This round" : "Best round") + '</span><b>' + bigFmt(pk.b) + ' &middot; ' + zf(pk.b).toFixed(1) + ' zeros</b><span>' + whenTxt(pk.t) + (pk.h ? ' &middot; block #' + n0(pk.h) : '') + '</span></div><p class="skyNote" style="text-align:center">Tap any dot or star to see its round.</p>';
  h += '<div class="skyLuck skyOdds"><span class="skyLuckLbl">Odds of a block</span><span class="skyLuckNum">' + oddsTxt() + '</span></div>';
  h += '<p class="skyNote">' + rows.length + (rows.length === 1 ? ' round' : ' rounds') + ' so far. Each dot is the best try of one block round (the pool only shares each round\'s best, not every try).</p>';
  return h + '</details>';
}
function wireSky() {
  var svg = document.getElementById("skySvg"); if (!svg) return;
  var c = S.cfg || {}, rows = starRows(), net = c.coin === "bch" ? S.live.bchDiff : S.live.btcDiff;
  var NS = "http://www.w3.org/2000/svg", L = 40, R = 340, T = 40, B = 390, BG = "#0b0f22";
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function mk(n, a, t) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (t !== undefined) e.textContent = t; return e; }
  function el(n, a, t) { var e = mk(n, a, t); svg.appendChild(e); return e; }
  function pulse(node, attr, vals, dur, begin) {
    if (still) return;
    var a = mk("animate", { attributeName: attr, values: vals, dur: dur + "s", begin: begin + "s", repeatCount: "indefinite", calcMode: "spline" }), parts = vals.split(";");
    a.setAttribute("keySplines", parts.slice(1).map(function () { return "0.45 0 0.55 1"; }).join(";"));
    a.setAttribute("keyTimes", parts.map(function (_, i) { return (i / (parts.length - 1)).toFixed(3); }).join(";"));
    node.appendChild(a);
  }
  var seed = 11; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  // zeros scale: block line sits where the original had it (9 of 10)
  var zs = rows.map(function (r) { return zf(r.b); }), need = net ? zf(net) : (zs.length ? Math.ceil(Math.max.apply(null, zs)) + 1 : 20);
  var zlo = zs.length ? Math.floor(Math.min(Math.min.apply(null, zs), need - 2)) : Math.floor(need) - 6;
  function V(z) { return Math.max(0, Math.min(9.9, 9 * (z - zlo) / (need - zlo))); }
  function X(v) { return L + (v / 10) * (R - L); }
  function rowY(i, n) { return n < 2 ? (T + B) / 2 : T + 10 + i / (n - 1) * (B - T - 20); }
  var bx = X(9);
  var defs = mk("defs", {}); svg.appendChild(defs);
  defs.innerHTML = '<filter id="skyGlow" filterUnits="userSpaceOnUse" x="0" y="0" width="360" height="440"><feGaussianBlur stdDeviation="3.5"/></filter><filter id="skyHaze" filterUnits="userSpaceOnUse" x="-100" y="-100" width="560" height="640"><feGaussianBlur stdDeviation="30"/></filter>';
  var haze = el("g", { filter: "url(#skyHaze)" });
  [[100, 120, 80, "#3b7bff", 0.20, [100, 130, 95], [120, 140, 110], 50], [210, 300, 90, "#8a4fe0", 0.22, [210, 285, 230], [300, 320, 290], 62], [250, 170, 70, "#6a5af0", 0.16, [250, 190, 235], [170, 150, 185], 44], [bx, 230, 60, "#f0505a", 0.16, [bx, bx + 20, bx - 12], [230, 210, 240], 56]].forEach(function (k) {
    var e = mk("circle", { cx: k[0], cy: k[1], r: k[2], fill: k[3], "fill-opacity": k[4] });
    if (!still) {
      e.appendChild(mk("animate", { attributeName: "cx", values: k[5].join(";") + ";" + k[5][0], dur: k[7] + "s", repeatCount: "indefinite", calcMode: "spline", keyTimes: "0;0.33;0.66;1", keySplines: "0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1" }));
      e.appendChild(mk("animate", { attributeName: "cy", values: k[6].join(";") + ";" + k[6][0], dur: (k[7] + 9) + "s", repeatCount: "indefinite", calcMode: "spline", keyTimes: "0;0.33;0.66;1", keySplines: "0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1" }));
    }
    haze.appendChild(e);
  });
  var sky = el("g", {}), bg = [];
  for (var s = 0; s < 70; s++) bg.push([rnd() * 360, rnd() * 440, 0.5 + rnd() * 0.9, 0.15 + rnd() * 0.4, rnd() < 0.2]);
  [0, 360].forEach(function (off) { bg.forEach(function (b) { var k = mk("circle", { cx: b[0] + off, cy: b[1], r: b[2], fill: "#cfd8ff", "fill-opacity": b[3] }); if (b[4]) pulse(k, "fill-opacity", b[3] + ";" + (b[3] * 0.3).toFixed(2) + ";" + b[3], 5 + rnd() * 5, rnd() * 4); sky.appendChild(k); }); });
  if (!still) sky.appendChild(mk("animateTransform", { attributeName: "transform", type: "translate", from: "0 0", to: "-360 0", dur: "160s", repeatCount: "indefinite" }));
  function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
  function mix(c1, c2, t) { return "rgb(" + lerp(c1[0], c2[0], t) + "," + lerp(c1[1], c2[1], t) + "," + lerp(c1[2], c2[2], t) + ")"; }
  var BLUE = [70, 150, 255], PURP = [160, 95, 240], RED = [240, 70, 80];
  function heat(v) { if (v <= 3) return mix(BLUE, BLUE, 0); if (v < 5.8) return mix(BLUE, PURP, (v - 3) / 2.8); if (v < 9) return mix(PURP, RED, (v - 5.8) / 3.2); return mix(RED, RED, 0); }
  for (var z = Math.ceil(zlo); z <= Math.floor(need); z++) {
    var gx = X(V(z));
    el("line", { x1: gx, x2: gx, y1: T, y2: B, stroke: "rgba(255,255,255,0.07)", "stroke-width": 1 });
    if ((z - Math.ceil(zlo)) % (need - zlo > 8 ? 2 : 1) === 0) el("text", { x: gx, y: B + 16, "text-anchor": "middle", "font-size": 11, fill: "rgba(255,255,255,0.5)" }, z);
  }
  el("text", { x: R, y: B + 32, "text-anchor": "end", "font-size": 11, fill: "rgba(255,255,255,0.5)" }, "zeros");
  if (rows.length) {
    el("text", { x: L - 4, y: T - 14, "font-size": 9, fill: "rgba(255,255,255,0.5)" }, "From " + whenTxt(rows[0].t));
    el("text", { x: L + 2, y: B + 30, "font-size": 9, fill: "rgba(255,255,255,0.5)" }, "To " + whenTxt(rows[rows.length - 1].t));
  }
  el("line", { x1: bx, x2: bx, y1: T - 6, y2: B, stroke: "#f05a5a", "stroke-width": 1.5, "stroke-dasharray": "5 4" });
  el("text", { x: bx, y: T - 14, "text-anchor": "middle", "font-size": 12, fill: "#f2f2f5" }, "Block line" + (net ? " (" + need.toFixed(1) + ")" : ""));
  if (!rows.length) {
    el("text", { x: 180, y: 215, "text-anchor": "middle", "font-size": 16, fill: "rgba(255,255,255,0.75)" }, "No tries yet");
    el("text", { x: 180, y: 238, "text-anchor": "middle", "font-size": 12, fill: "rgba(255,255,255,0.45)" }, "They show up as GitHub checks the pool.");
  } else {
    var t0 = rows[0].t, t1 = rows[rows.length - 1].t, n = rows.length;
    var pts = rows.map(function (r, i) { return [X(V(zf(r.b))), rowY(i, n), i, V(zf(r.b)), r]; });
    var order = rows.map(function (r, i) { return i; }).sort(function (a, b) { return rows[b].b - rows[a].b; }), medalIdx = order.slice(0, 3);
    var MED = [{ c: "#ffc61a", r: 12, d: 3.6, b: 0 }, { c: "#b9c4ea", r: 10, d: 4.4, b: 1.3 }, { c: "#f08a45", r: 9, d: 5, b: 2.4 }];
    var animEvery = Math.max(1, Math.ceil(n / 120));
    pts.forEach(function (p) {
      if (medalIdx.indexOf(p[2]) >= 0) return;
      var col = heat(p[3]);
      el("circle", { cx: p[0], cy: p[1], r: 7, fill: col, "fill-opacity": 0.10 });
      var halo = el("circle", { cx: p[0], cy: p[1], r: 4.6, fill: col, "fill-opacity": 0.22 });
      if (p[2] % animEvery === 0) pulse(halo, "fill-opacity", "0.14;0.32;0.14", 5 + rnd() * 5, rnd() * 6);
      el("circle", { cx: p[0], cy: p[1], r: 2.4, fill: col, "fill-opacity": 0.98 });
    });
    function starPts(sx, sy, R1) { var s2 = []; for (var k = 0; k < 10; k++) { var a = -Math.PI / 2 + k * Math.PI / 5, r = (k % 2 === 0) ? R1 : R1 * 0.42; s2.push((sx + r * Math.cos(a)).toFixed(1) + "," + (sy + r * Math.sin(a)).toFixed(1)); } return s2.join(" "); }
    var usedY = [];
    medalIdx.forEach(function (i) { var y = pts[i][1] - 9; while (usedY.some(function (u) { return Math.abs(u - y) < 30; })) y += 30; usedY.push(y); pts[i].ly = y; });
    medalIdx.slice().reverse().forEach(function (i) {
      var m = MED[medalIdx.indexOf(i)], p = pts[i], sx = p[0], sy = p[1], gid = "skyg" + i;
      var g = mk("linearGradient", { id: gid, gradientUnits: "userSpaceOnUse", x1: L, x2: sx, y1: 0, y2: 0 });
      g.innerHTML = '<stop offset="0" stop-color="' + m.c + '" stop-opacity="0.08"/><stop offset="0.6" stop-color="' + m.c + '" stop-opacity="0.55"/><stop offset="1" stop-color="' + m.c + '" stop-opacity="1"/>';
      defs.appendChild(g);
      var lg = el("line", { x1: L, x2: sx, y1: sy, y2: sy, stroke: "url(#" + gid + ")", "stroke-width": 9, "stroke-opacity": 0.7, filter: "url(#skyGlow)" });
      pulse(lg, "stroke-opacity", "0.3;0.85;0.3", m.d, m.b);
      el("line", { x1: L, x2: sx, y1: sy, y2: sy, stroke: "url(#" + gid + ")", "stroke-width": 2.5, "stroke-linecap": "round" });
      el("text", { x: L + 6, y: p.ly, "font-size": 11, "font-weight": 600, fill: "#f2f2f5", stroke: BG, "stroke-width": 3, "paint-order": "stroke" }, bigFmt(p[4].b) + " · " + zf(p[4].b).toFixed(1) + " zeros");
      el("text", { x: L + 6, y: p.ly + 23, "font-size": 10, fill: "rgba(255,255,255,0.8)", stroke: BG, "stroke-width": 3, "paint-order": "stroke" }, whenTxt(p[4].t));
      var sg = el("polygon", { points: starPts(sx, sy, m.r * 1.6), fill: m.c, "fill-opacity": 0.6, filter: "url(#skyGlow)" });
      pulse(sg, "fill-opacity", "0.25;0.85;0.25", m.d, m.b);
      var st = el("polygon", { points: starPts(sx, sy, m.r), fill: m.c, stroke: BG, "stroke-width": 2, "stroke-linejoin": "round" });
      pulse(st, "fill-opacity", "0.85;1;0.85", m.d, m.b);
    });
  }
  el("line", { x1: L, x2: L, y1: T, y2: B, stroke: "rgba(255,255,255,0.25)" });
  el("line", { x1: L, x2: R, y1: B, y2: B, stroke: "rgba(255,255,255,0.25)" });
  if (rows.length) {
    var t0b = rows[0].t, t1b = rows[rows.length - 1].t;
    rows.forEach(function (r, i) {
      var x = X(V(zf(r.b))), y = rowY(i, rows.length);
      if (i === SC.pick) el("circle", { cx: x, cy: y, r: 9, fill: "none", stroke: "#2dd4bf", "stroke-width": 2 });
      var hit = el("circle", { cx: x, cy: y, r: 11, fill: "transparent", style: "cursor:pointer" });
      hit.addEventListener("click", function () { SC.pick = i; drawAll(); });
    });
  }
}
function wireStars() {
  var r = $("scRange"), w = $("scWho");
  if (r) r.onchange = function () { SC.range = r.value; SC.pick = -1; r.blur(); drawAll(); };
  if (w) w.onchange = function () { SC.who = w.value; SC.pick = -1; w.blur(); drawAll(); };
  wireSky();
}
var RELAY = "https://fire-salt-relay.harrisonfire86.workers.dev/";
function hNum(s) { var m = /^([0-9.]+)\s*([kKMGTPE]?)$/.exec(String(s == null ? "" : s)); if (!m) return 0; return Number(m[1]) * ({ "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 })[m[2]]; }
function errTxt(e) { return String((e && e.message) || e || "error").slice(0, 100); }

function getJ(url, text) {
  var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 20000);
  return fetch(url, { cache: "no-store", signal: ctl.signal }).then(function (r) { clearTimeout(to); if (!r.ok) throw new Error("site said " + r.status); return text ? r.text() : r.json(); });
}
function own(path) { return getJ(path + "?t=" + Date.now()).catch(function () { return null; }); }

/* ---------- saved data from the GitHub job ---------- */
function loadSaved() {
  return Promise.all([own("config.json"), own("data/pool.json"), own("data/earned.json"), own("data/pools.json"), own("data/pooldays.json"), own("data/status.json"), own("data/poolhist.json")]).then(function (r) {
    S.hist = Array.isArray(r[6]) ? r[6] : [];
    S.cfg = r[0]; S.pool = r[1]; S.earned = Array.isArray(r[2]) ? r[2] : []; S.pools = Array.isArray(r[3]) ? r[3] : []; S.days = r[4] || {}; S.status = r[5];
  });
}

/* ---------- live, straight from the sites ---------- */
function liveBlocks() {
  var L = S.live;
  var btc = getJ("https://mempool.space/api/blocks/tip/hash", true).then(function (h) { return getJ("https://mempool.space/api/block/" + h.trim()); }).then(function (b) { L.btcH = b.height; L.btcT = b.timestamp * 1000; if (b.difficulty) L.btcDiff = b.difficulty; delete L.err.btc; }, function (e) { L.err.btc = errTxt(e); });
  var bch = getJ("https://api.blockchain.info/haskoin-store/bch/block/best?notx=true").then(function (b) { L.bchH = b.height; L.bchT = b.time * 1000; if (b.bits) L.bchDiff = bitsToDiff(b.bits); delete L.err.bch; }, function (e) { L.err.bch = errTxt(e); });
  return Promise.all([btc, bch]).then(function () { L.at = Date.now(); drawChips(); });
}
function livePool() {
  var c = S.cfg, kind = statsKind(c); S.livePool = null; S.livePoolErr = "";
  if (!c || !c.host || !kind) return Promise.resolve();
  var wal = c.coin === "bch" ? normBch(c.bchWallet) : (c.btcWallet || "").trim(), addr = (c.login || "").trim() || wal;
  if (!addr) return Promise.resolve();
  var p = kind === "ckpool" ? getJ(RELAY + "?host=" + encodeURIComponent(cleanHost(c.host)) + "&addr=" + encodeURIComponent(addr) + "&t=" + Date.now()).then(function (j) {
      if (j.hashrate5m === undefined) throw new Error(j.error || "pool does not know this address yet");
      var w = j.worker || [], t = Date.now() / 1000, d = { h5m: hNum(j.hashrate5m), h1h: hNum(j.hashrate1hr), workers: j.workers || w.length, live: w.filter(function (x) { return x.lastshare && t - x.lastshare < 600 && hNum(x.hashrate5m) > 0; }).length, last: (j.lastshare || 0) * 1000, shares: +j.shares || 0, best: +j.bestshare || 0, ever: +j.bestever || 0, mine: null };
      if (c.login && wal) w.forEach(function (x) { if (String(x.workername || "").indexOf(wal) >= 0) d.mine = { h5m: hNum(x.hashrate5m), h1h: hNum(x.hashrate1hr), last: (x.lastshare || 0) * 1000, shares: +x.shares || 0, best: +x.bestshare || 0, ever: +x.bestever || 0 }; });
      return d;
    })
    : kind === "publicpool" ? getJ("https://public-pool.io:40557/api/client/" + addr).then(function (j) { var a = j.accounting || {}; return { h5m: +a.hashRateLast10Minutes || 0, h1h: +a.hashRateLastHour || 0, workers: j.workersCount || 0, live: j.workersCount || 0, last: a.latestShareAt ? Date.parse(a.latestShareAt) : 0, shares: +a.totalAcceptedShares || 0, best: +a.bestSubmissionDifficulty || 0, ever: +j.bestDifficulty || 0 }; })
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
  if (kind === "ckpool" && S.livePool) { d = S.livePool; at = d.at; src = "pool, live"; }
  else if (kind === "ckpool") { if (S.pool && S.pool.host === cleanHost(c.host)) { d = S.pool.d; at = S.pool.at; err = S.livePoolErr || S.pool.err; } src = "GitHub job (live check not coming through" + (S.livePoolErr ? ": " + S.livePoolErr : "") + ")"; }
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
    if (kind !== "solopool") h += ladderHtml(c.coin, d.best, d.ever, d.mine ? d.mine.ever : 0);
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
  var ae = document.activeElement; if (ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName) && $("main").contains(ae)) { S.dirty = true; return; }
  function dkey(d) { var card = d.closest("#main > *"), h = card && card.querySelector("h2"), ck = (card && card.id) || (h ? h.textContent.replace(/[^A-Za-z]/g, "").slice(0, 20) : "x"); if (d === card) return ck; return ck + ":" + Array.prototype.indexOf.call(card.querySelectorAll("details"), d); }
  var open = {}; Array.prototype.forEach.call(document.querySelectorAll("#main details"), function (d) { open[dkey(d)] = d.open; });
  var h = '<div style="text-align:center"><button class="btn go" type="button" id="checkNow"' + (S.busy ? " disabled" : "") + '>' + (S.busy ? "Checking..." : "Check now") + '</button>' + (S.checkedAt ? '<p class="small">Checked ' + ago(S.checkedAt) + '.</p>' : '') + '</div>';
  h += poolHtml() + starHtml() + earnHtml() + histHtml();
  if (window.privateHtml) h += window.privateHtml();
  $("main").innerHTML = h;
  Array.prototype.forEach.call(document.querySelectorAll("#main details"), function (d) { var k = dkey(d); if (open[k] !== undefined && d.id !== "earnCard") d.open = open[k]; });
  wireStars();
  if (window.privateWire) window.privateWire(); $("status").textContent = statusTxt();
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
setInterval(function () { if (!document.hidden && !S.busy) { livePool().then(function () { var ae = document.activeElement; if (!(ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName))) drawAll(); }); } }, 30000);
setInterval(function () { if (!document.hidden && !S.busy) { loadSaved().then(livePool).then(drawAll); } }, 120000);
document.addEventListener("visibilitychange", function () { if (!document.hidden) checkNow(); });
document.addEventListener("focusout", function () { setTimeout(function () { var ae = document.activeElement; if (S.dirty && !(ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName))) { S.dirty = false; drawAll(); } }, 300); });
