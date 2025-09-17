// netlify/functions/option.js
function parseDateFlexible(s){
  if(!s) return null;
  if(typeof s !== 'string') return new Date(s);
  const t = s.trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(t+"T00:00:00");
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(m){
    let [_, mm, dd, yy] = m; mm=+mm; dd=+dd; yy=+yy;
    if(yy<100) yy += 2000;
    return new Date(yy, mm-1, dd);
  }
  const d = new Date(t); return isNaN(d)? null: d;
}

export const handler = async (event) => {
  const q = event.queryStringParameters || {};
  const symbol = (q.symbol || "").trim();
  const type = (q.type || "put").toLowerCase() === "call" ? "call" : "put";
  const strike = Number(q.strike);
  const expStr = q.exp;
  if (!symbol || !strike || !expStr) {
    return { statusCode: 400, body: JSON.stringify({ error: "symbol, strike, exp required" }) };
  }
  const norm = symbol.toUpperCase().replaceAll(".", "-").replace("/", "-");
  const expDate = parseDateFlexible(expStr) || new Date(expStr);
  const base = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(norm)}`;
  try {
    const list = await fetch(base, { headers: { "User-Agent": "NetZeroOptions/1.0" } });
    if (!list.ok) return { statusCode: list.status, body: JSON.stringify({ error: "exp list error", status: list.status }) };
    const lj = await list.json();
    const exps = lj?.optionChain?.result?.[0]?.expirationDates || [];
    let targetEpoch = null;
    if (exps.length) {
      let best = exps[0], bestDiff = Infinity;
      for (const epoch of exps) {
        const d = new Date(epoch*1000);
        const diff = Math.abs(d.setHours(0,0,0,0) - (expDate? expDate.setHours(0,0,0,0):0));
        if (diff < bestDiff) { bestDiff = diff; best = epoch; }
      }
      targetEpoch = best;
    }
    const chain = await fetch(`${base}?date=${targetEpoch}`, { headers: { "User-Agent": "NetZeroOptions/1.0" } });
    if (!chain.ok) return { statusCode: chain.status, body: JSON.stringify({ error: "chain error", status: chain.status }) };
    const cj = await chain.json();
    const res = cj?.optionChain?.result?.[0];
    const arr = (type==='call' ? res?.options?.[0]?.calls : res?.options?.[0]?.puts) || [];
    const row = arr.find(r => Math.abs(Number(r.strike)-Number(strike))<1e-6) || null;
    const out = row ? {
      last: row.lastPrice ?? null, bid: row.bid ?? null, ask: row.ask ?? null,
      iv: row.impliedVolatility ?? null, oi: row.openInterest ?? null, vol: row.volume ?? null, source: "yahoo"
    } : null;
    return { statusCode: 200, headers: { "content-type":"application/json" }, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: "fetch failed", detail: String(e) }) };
  }
};
