export const VERSION = "1.3.0"; export const DATA_SOURCES = ["yahoo","stooq","google","cboe"];
export function getSettings(){ try{ return JSON.parse(localStorage.getItem('netzero-settings')||'{}'); }catch{return{}}}
export function saveSettings(s){ localStorage.setItem('netzero-settings', JSON.stringify(s)); }
export const DEFAULT_ALERTS = [{ pct: 0.2, label: "watch" },{ pct: 0.1, label: "danger" }];
export function dollars(x){ if(x==null||x==='') return ''; const n=Number(x); return Number.isNaN(n)?String(x):('$'+n.toFixed(2)); }
export function pct(x){ if(x==null) return ''; const n=Number(x); if(Number.isNaN(n)) return ''; return (n*100).toFixed(1)+'%'; }
export function daysTo(d){ if(!d) return ''; const dt=new Date(d); if(isNaN(dt)) return ''; const ms=dt.setHours(0,0,0,0)-new Date().setHours(0,0,0,0); return Math.round(ms/86400000); }
export function parseNum(x){ const n=Number(x); return Number.isNaN(n)?null:n; }
export function loadState(){ try{ const t=localStorage.getItem('netzero-options'); const s=t?JSON.parse(t):{positions:[],journal:[],alerts:DEFAULT_ALERTS}; if(Array.isArray(s.rows)) s.positions=s.rows; if(!Array.isArray(s.positions)) s.positions=[]; if(!Array.isArray(s.alerts)) s.alerts=DEFAULT_ALERTS; if(!Array.isArray(s.journal)) s.journal=[]; return s;}catch{ return {positions:[],journal:[],alerts:DEFAULT_ALERTS}; } }
export function saveState(s){ localStorage.setItem('netzero-options', JSON.stringify(s)); }
export function calcCollateral(pos){ const q=Number(pos.Quantity||0); if(!q) return 0; const shorts=(pos.legs||[]).filter(l=>String(l.LegType).toLowerCase()==='short'); const longs=(pos.legs||[]).filter(l=>String(l.LegType).toLowerCase()==='long'); let width=null; if(shorts.length&&longs.length){ const sK=parseNum(shorts[0].Strike); const lK=parseNum(longs[0].Strike); if(sK!=null&&lK!=null) width=Math.abs(sK-lK);} else { const sK=parseNum(pos.ShortStrike); const lK=parseNum(pos.LongStrike); if(sK!=null&&lK!=null) width=Math.abs(sK-lK);} if(pos.CollateralOverride){ const n=Number(pos.CollateralOverride); if(!Number.isNaN(n)) return n;} const strategy=String(pos.Strategy||'').toLowerCase(); if(width!=null&&(strategy.includes('spread')||strategy.includes('iron')||strategy.includes('condor'))) return width*100*q; if(strategy.includes('cash-secured put')){ const k=parseNum(pos.ShortStrike) ?? (shorts[0]?.Strike??0); return Number(k||0)*100*q;} if(strategy.includes('covered call')) return 0; return 0; }
export function distanceToStrikePct(pos, stock){ const sK=parseNum(pos.ShortStrike) ?? parseNum((pos.legs||[]).find(l=>String(l.LegType).toLowerCase()==='short')?.Strike); if(sK==null||stock==null) return null; return Math.abs((stock-sK)/sK); }
export function isITM(pos, stock){ const side=String(pos.Side||'').toLowerCase() || String((pos.legs||[]).find(l=>String(l.LegType).toLowerCase()==='short')?.Side||'').toLowerCase(); const k=parseNum(pos.ShortStrike) ?? parseNum((pos.legs||[]).find(l=>String(l.LegType).toLowerCase()==='short')?.Strike); if(k==null||stock==null) return false; if(side==='put') return stock<k; if(side==='call') return stock>k; return false; }
async function fetchQuoteNetlify(symbol){
  try{
    const url = `/.netlify/functions/quote?symbol=${encodeURIComponent(symbol)}&src=${encodeURIComponent((getSettings().source||"yahoo").toLowerCase())}`;
    const r = await fetch(url);
    if(!r.ok) return null;
    return await r.json();
  }catch{return null;}
}
async function fetchQuoteYahoo(symbol){ const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(normSymbol(symbol))}`; const r = await fetch(url); if(!r.ok) throw new Error('quote '+r.status); const j = await r.json(); const it = j.quoteResponse?.result?.[0]; if(!it) return null; return { price: it.regularMarketPrice ?? null, currency: it.currency ?? 'USD', ts: Date.now(), source: 'yahoo' }; }
async function fetchQuoteGoogle(symbol){ return null; } async function fetchQuoteCboe(symbol){ return null; }
export async function fetchQuote(symbol){
  try{
    let q = await fetchQuoteNetlify(symbol);
    if(!q || q.price==null){ q = await fetchQuoteYahoo(symbol); }
    return q;
  } catch(e){ console.warn('quote failed', e); return null; } }
async function fetchOptionNetlify(symbol, expiration, strike, type){
  try{
    const params = new URLSearchParams({ symbol, exp: expiration, strike: String(strike), type });
    const url = `/.netlify/functions/option?${params.toString()}`;
    const r = await fetch(url);
    if(!r.ok) return null;
    return await r.json();
  }catch{return null;}
}
async function fetchOptionYahoo(symbol, expiration, strike, type){ const base=`https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`; const list=await fetch(base); if(!list.ok) throw new Error('exp list '+list.status); const lj=await list.json(); const exps=lj?.optionChain?.result?.[0]?.expirationDates||[]; let targetEpoch=null; const tgt=new Date(expiration); for(const epoch of exps){ const d=new Date(epoch*1000); if(d.getUTCFullYear()===tgt.getUTCFullYear()&&d.getUTCMonth()===tgt.getUTCMonth()&&d.getUTCDate()===tgt.getUTCDate()){ targetEpoch=epoch; break; } } if(!targetEpoch) targetEpoch=exps[0]; const chain=await fetch(`${base}?date=${targetEpoch}`); if(!chain.ok) throw new Error('chain '+chain.status); const cj=await chain.json(); const res=cj?.optionChain?.result?.[0]; const arr=(type==='call'?res?.options?.[0]?.calls:res?.options?.[0]?.puts)||[]; const row=arr.find(r=>Math.abs(Number(r.strike)-Number(strike))<1e-6); if(!row) return null; return { last: row.lastPrice ?? null, bid: row.bid ?? null, ask: row.ask ?? null, iv: row.impliedVolatility ?? null, oi: row.openInterest ?? null, vol: row.volume ?? null, source:'yahoo' }; }
async function fetchOptionGoogle(){ return null; } async function fetchOptionCboe(){ return null; }
export async function fetchOptionContract(symbol, expiration, strike, type){
  try{
    let oc = await fetchOptionNetlify(symbol, expiration, strike, type);
    if(!oc || oc.last==null){ oc = await fetchOptionYahoo(symbol, expiration, strike, type); }
    return oc;
  } catch(e){ console.warn('option failed', e); return null; } }

// --- PATCH: robustness helpers ---
function normSymbol(sym){
  if(!sym) return sym;
  // Yahoo uses BRK-B instead of BRK.B, GOOG ok, RDS/A -> RDS-A etc.
  return String(sym).trim().toUpperCase().replace(/\./g, '-').replace('/', '-');
}
function parseDateFlexible(s){
  if(!s) return null;
  if(typeof s !== 'string') return new Date(s);
  // Accept YYYY-MM-DD or M/D/YYYY (and two-digit year M/D/YY).
  const t = s.trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(t+"T00:00:00");
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(m){
    let [_, mm, dd, yy] = m; mm=+mm; dd=+dd; yy=+yy;
    if(yy<100) yy += 2000;
    return new Date(yy, mm-1, dd);
  }
  const d = new Date(t);
  return isNaN(d)? null : d;
}

export function bsDelta(S,K,tYears,r,sigma,isCall){ if([S,K,tYears,r,sigma].some(v=>v==null||isNaN(v)||v<=0)) return null; const ln=Math.log(S/K); const d1=(ln+(r+0.5*sigma*sigma)*tYears)/(sigma*Math.sqrt(tYears)); const Phi=(x)=>0.5*(1+erf(x/Math.SQRT2)); function erf(x){const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;const s=x<0?-1:1;x=Math.abs(x);const t=1/(1+p*x);const y=1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);return s*y;} return isCall?Phi(d1):(Phi(d1)-1); }
