// netlify/functions/quote.js (with Stooq fallback)
export const handler = async (event) => {
  const p = event.queryStringParameters || {};
  const symbol = (p.symbol || "").trim();
  const src = (p.src || "yahoo").toLowerCase();
  if (!symbol) return { statusCode: 400, body: JSON.stringify({ error: "symbol required" }) };

  async function yahoo(sym){
    const norm = sym.toUpperCase().replaceAll(".", "-").replace("/", "-");
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(norm)}`;
    const r = await fetch(url, { headers: { "User-Agent": "NetZeroOptions/1.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    const it = j?.quoteResponse?.result?.[0] || null;
    if(!it) return null;
    return { price: it?.regularMarketPrice ?? null, currency: it?.currency ?? "USD", ts: Date.now(), source: "yahoo" };
  }

  async function stooq(sym){
    // Stooq wants SYMBOL.US format for US stocks; if user provided AAPL, map to aapl.us
    const norm = sym.toLowerCase().includes(".us") ? sym.lower() : (sym.toLowerCase() + ".us");
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(norm)}&i=d`;
    const r = await fetch(url, { headers: { "User-Agent": "NetZeroOptions/1.0" } });
    if(!r.ok){ return null; }
    const text = await r.text();
    // CSV header: Symbol,Date,Time,Open,High,Low,Close,Volume
    const lines = text.trim().split(/\r?\n/);
    if(lines.length<2) return null;
    const row = lines[1].split(",");
    const close = Number(row[6]);
    if(Number.isNaN(close)) return null;
    return { price: close, currency: "USD", ts: Date.now(), source: "stooq" };
  }

  try {
    let out = null;
    if(src === "stooq"){
      out = await stooq(symbol);
      if(!out) out = await yahoo(symbol);
    } else {
      out = await yahoo(symbol);
      if(!out) out = await stooq(symbol);
    }
    if(!out) return { statusCode: 502, body: JSON.stringify({ error: "no data from providers" }) };
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(out) };
  } catch(e){
    return { statusCode: 502, body: JSON.stringify({ error: "fetch failed", detail: String(e) }) };
  }
};
