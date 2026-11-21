// Fire & Salt relay (Cloudflare Worker).
// Asks ckpool for one address's stats and hands the answer to the Fire & Salt site.
// It only talks to ckpool addresses, and only lets the Fire & Salt site read the answer.
const SITE = "https://harrisonfire86.github.io";

export default {
  async fetch(request) {
    const cors = { "Access-Control-Allow-Origin": SITE, "Access-Control-Allow-Methods": "GET", "Cache-Control": "no-store" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const host = (url.searchParams.get("host") || "solo.ckpool.org").toLowerCase();
    const addr = url.searchParams.get("addr") || "";
    if (!/^([a-z0-9-]+\.)*ckpool\.org$/.test(host)) return new Response('{"error":"only ckpool pools"}', { status: 400, headers: cors });
    if (!/^[A-Za-z0-9]{20,100}$/.test(addr)) return new Response('{"error":"bad address"}', { status: 400, headers: cors });
    try {
      const r = await fetch(`https://${host}/users/${addr}`, { headers: { "user-agent": "fire-salt-relay" }, cf: { cacheTtl: 0 } });
      const body = await r.text();
      return new Response(body, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: "ckpool did not answer" }), { status: 502, headers: cors });
    }
  },
};
