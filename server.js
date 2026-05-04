/* ═══════════════════════════════════════════════════════════
   LUCID EDGE — COMPLETE AUTO-VALIDATION SYSTEM
   
   WHAT THIS FILE CONTAINS:
   
   PART 1: Updated Pine Script (copy into TradingView)
   PART 2: Node.js webhook server (runs on Render.com free)
   PART 3: How to connect everything
   ═══════════════════════════════════════════════════════════ */


/* ─────────────────────────────────────────────────────────
   PART 1: PINE SCRIPT — copy this into TradingView Pine Editor
   ─────────────────────────────────────────────────────────
   
//@version=6
indicator(title="Lucid Edge — Auto Validator", shorttitle="Lucid Edge", overlay=true)

ema_fast = input.int(9, title="EMA Fast")
ema_slow = input.int(21, title="EMA Slow")
stop_pts = input.float(10.0, title="Stop Points")
tgt_pts  = input.float(20.0, title="Target Points")
min_sep  = input.float(3.0,  title="Min EMA Sep (3=B, 6=A)")

ema9  = ta.ema(close, ema_fast)
ema21 = ta.ema(close, ema_slow)
vwap  = ta.vwap(hlc3)

cross_up   = ta.crossover(ema9, ema21)
cross_down = ta.crossunder(ema9, ema21)
ema_sep    = math.abs(ema9 - ema21)
grade      = ema_sep >= 6.0 ? "A-GRADE" : ema_sep >= 3.0 ? "B-GRADE" : "WEAK"
quality    = ema_sep >= min_sep

long_sig  = cross_up   and close > vwap and quality
short_sig = cross_down and close < vwap and quality

plot(ema9,  color=#26A69A, linewidth=2)
plot(ema21, color=#378ADD, linewidth=2)
plot(vwap,  color=#BA7517, linewidth=2, style=plot.style_circles)

session_time = time(timeframe.period, "0830-1130", "America/New_York")
bgcolor(not na(session_time) ? color.new(#26A69A, 95) : na)

plotshape(long_sig,  style=shape.triangleup,   location=location.belowbar, color=#26A69A, size=size.small)
plotshape(short_sig, style=shape.triangledown, location=location.abovebar, color=#EF5350, size=size.small)

// ALERT CONDITIONS - these send data to your webhook
alertcondition(long_sig,
  title="LONG A/B Grade",
  message='{"direction":"LONG","ticker":"{{ticker}}","price":"{{close}}","time":"{{timenow}}","ema9":"{{plot_0}}","ema21":"{{plot_1}}","vwap":"{{plot_2}}","interval":"{{interval}}"}')

alertcondition(short_sig,
  title="SHORT A/B Grade", 
  message='{"direction":"SHORT","ticker":"{{ticker}}","price":"{{close}}","time":"{{timenow}}","ema9":"{{plot_0}}","ema21":"{{plot_1}}","vwap":"{{plot_2}}","interval":"{{interval}}"}')

alertcondition(long_sig or short_sig,
  title="ANY A/B Signal",
  message='{"direction":"{{plot_0}} > {{plot_1}} ? LONG : SHORT","ticker":"{{ticker}}","price":"{{close}}","time":"{{timenow}}","ema9":"{{plot_0}}","ema21":"{{plot_1}}","vwap":"{{plot_2}}","interval":"{{interval}}"}')

   ─────────────────────────────────────────────────────────
   END PINE SCRIPT
   ───────────────────────────────────────────────────────── */


/* ─────────────────────────────────────────────────────────
   PART 2: NODE.JS WEBHOOK SERVER
   Deploy this FREE on render.com
   ─────────────────────────────────────────────────────────
   
   File: server.js
   ─────────────────────────────────────────────────────────
*/

const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch');
const webpush  = require('web-push');
const app      = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store subscriptions and signals in memory
let pushSubscriptions = [];
let latestSignal      = null;
let signalHistory     = [];

// ── VAPID keys for web push (generate once)
// Run: npx web-push generate-vapid-keys
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || 'YOUR_VAPID_PUBLIC_KEY';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'YOUR_VAPID_PRIVATE_KEY';
webpush.setVapidDetails('mailto:trader@lucidedge.com', VAPID_PUBLIC, VAPID_PRIVATE);

// ── WEBHOOK endpoint — TradingView posts here
app.post('/webhook', async (req, res) => {
  try {
    const data = req.body;
    console.log('Signal received:', data);

    const direction = data.direction || 'UNKNOWN';
    const ticker    = data.ticker    || 'MES';
    const price     = parseFloat(data.price)  || 0;
    const ema9      = parseFloat(data.ema9)   || 0;
    const ema21     = parseFloat(data.ema21)  || 0;
    const vwap      = parseFloat(data.vwap)   || 0;
    const interval  = data.interval  || '3';
    const signalTime = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York'
    }) + ' ET';

    // Calculate key metrics
    const emaSep      = Math.abs(ema9 - ema21).toFixed(2);
    const grade       = emaSep >= 6 ? 'A-GRADE' : emaSep >= 3 ? 'B-GRADE' : 'WEAK';
    const aboveVwap   = price > vwap;
    const vwapDist    = Math.abs(price - vwap).toFixed(2);
    const instrument  = ticker.replace('1!','').replace('CME:','');
    const pv          = instrument.includes('MES') ? 5 : instrument.includes('MNQ') ? 2 : instrument.includes('ES') ? 50 : 20;
    const contracts   = instrument.startsWith('M') ? 10 : 1;
    const stopPts     = instrument.includes('NQ') ? 25 : 10;
    const targetPts   = stopPts * 2;
    const risk        = stopPts * pv * contracts;
    const reward      = targetPts * pv * contracts;
    const slPrice     = direction === 'LONG' ? price - stopPts : price + stopPts;
    const tpPrice     = direction === 'LONG' ? price + targetPts : price - targetPts;

    // ── Call Claude API for validation
    const aiPrompt = `You are a prop firm trading coach. Validate this ${instrument} signal instantly.

Signal: ${direction} | Price: ${price} | Time: ${signalTime}
EMA 9: ${ema9} | EMA 21: ${ema21} | VWAP: ${vwap}
EMA Separation: ${emaSep}pts | Grade: ${grade}
Price ${aboveVwap ? 'ABOVE' : 'BELOW'} VWAP by ${vwapDist}pts
Risk: $${risk} | Reward: $${reward} | R/R: 1:2

Rules:
- LONG needs EMA9 > EMA21 + price ABOVE VWAP
- SHORT needs EMA9 < EMA21 + price BELOW VWAP  
- A-GRADE = 6+pts sep | B-GRADE = 3-5pts | WEAK = skip
- Best window: 8:30-11:30 AM ET | Pre-market 5-8:30 AM OK for A/B

Respond in exactly this format:
VERDICT: ENTER or SKIP or CAUTION
REASON: [one short sentence]
RISK: [one thing to watch]`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        messages: [{ role: 'user', content: aiPrompt }]
      })
    });

    const aiData  = await aiRes.json();
    const aiText  = aiData.content?.[0]?.text || 'Validation unavailable';
    const verdict = aiText.match(/VERDICT[:\s]+(\w+)/i)?.[1]?.toUpperCase() || 'UNKNOWN';
    const reason  = aiText.match(/REASON[:\s]+(.+)/i)?.[1]?.trim() || '';
    const risk    = aiText.match(/RISK[:\s]+(.+)/i)?.[1]?.trim() || '';

    // Store signal
    const signal = {
      id: Date.now(),
      direction, instrument, price, ema9, ema21, vwap,
      emaSep, grade, aboveVwap, vwapDist,
      slPrice: slPrice.toFixed(2),
      tpPrice: tpPrice.toFixed(2),
      riskDollar: risk, rewardDollar: reward,
      verdict, reason, riskNote: risk,
      signalTime, aiText,
      timestamp: new Date().toISOString()
    };

    latestSignal = signal;
    signalHistory.unshift(signal);
    if (signalHistory.length > 20) signalHistory.pop();

    // ── Send push notification to all subscribers
    const emoji   = verdict === 'ENTER' ? '✅' : verdict === 'SKIP' ? '❌' : '⚠️';
    const dirEmoji = direction === 'LONG' ? '▲' : '▼';
    const notifPayload = JSON.stringify({
      title: `${emoji} ${dirEmoji} ${direction} ${instrument} — ${verdict}`,
      body:  `${price} | ${grade} | SL: ${slPrice.toFixed(2)} TP: ${tpPrice.toFixed(2)} | ${signalTime}`,
      icon:  '/icon.png',
      badge: '/badge.png',
      data:  { signalId: signal.id, url: '/' }
    });

    const pushPromises = pushSubscriptions.map(sub =>
      webpush.sendNotification(sub, notifPayload).catch(err => {
        if (err.statusCode === 410) {
          pushSubscriptions = pushSubscriptions.filter(s => s !== sub);
        }
      })
    );
    await Promise.all(pushPromises);

    console.log(`Signal processed: ${direction} ${instrument} — ${verdict}`);
    res.json({ success: true, verdict, signal });

  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Get latest signal (polled by the app)
app.get('/signal/latest', (req, res) => {
  res.json({ signal: latestSignal });
});

// ── Get signal history
app.get('/signal/history', (req, res) => {
  res.json({ signals: signalHistory });
});

// ── Save push subscription
app.post('/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!pushSubscriptions.find(s => s.endpoint === sub.endpoint)) {
    pushSubscriptions.push(sub);
  }
  res.json({ success: true });
});

// ── Get VAPID public key (needed for browser push)
app.get('/push/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

// ── Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', signals: signalHistory.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lucid Edge server running on port ${PORT}`));

/* ─────────────────────────────────────────────────────────
   END SERVER.JS
   ───────────────────────────────────────────────────────── */


/* ─────────────────────────────────────────────────────────
   File: package.json
   ─────────────────────────────────────────────────────────

{
  "name": "lucid-edge-validator",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "node-fetch": "^2.7.0",
    "web-push": "^3.6.7"
  }
}

   ─────────────────────────────────────────────────────────
   END PACKAGE.JSON
   ───────────────────────────────────────────────────────── */
