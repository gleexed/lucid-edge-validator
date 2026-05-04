const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const app     = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let latestSignal = null;
let signalHistory = [];


app.get('/health', (req, res) => {
  res.json({ status: 'ok', signals: signalHistory.length });
});

app.post('/webhook', async (req, res) => {
  try {
    const data = req.body;
    console.log('Signal received:', JSON.stringify(data));

    const direction = data.direction || 'UNKNOWN';
    const ticker    = (data.ticker || 'MES').replace('CME:', '').replace('1!', '');
    const price     = parseFloat(data.price)  || 0;
    const ema9      = parseFloat(data.ema9)   || 0;
    const ema21     = parseFloat(data.ema21)  || 0;
    const vwap      = parseFloat(data.vwap)   || 0;

    const signalTime = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York'
    }) + ' ET';

    const emaSep   = Math.abs(ema9 - ema21).toFixed(2);
    const grade    = emaSep >= 6 ? 'A-GRADE' : emaSep >= 3 ? 'B-GRADE' : 'WEAK';
    const aboveVwap = price > vwap;
    const vwapDist  = Math.abs(price - vwap).toFixed(2);

    const isMicro   = ticker.startsWith('M');
    const pv        = ticker.includes('MES') ? 5 : ticker.includes('MNQ') ? 2 : ticker.includes('ES') ? 50 : 20;
    const contracts = isMicro ? 10 : 1;
    const stopPts   = ticker.includes('NQ') ? 25 : 10;
    const targetPts = stopPts * 2;
    const riskDollar   = stopPts * pv * contracts;
    const rewardDollar = targetPts * pv * contracts;
    const slPrice = direction === 'LONG' ? (price - stopPts).toFixed(2) : (price + stopPts).toFixed(2);
    const tpPrice = direction === 'LONG' ? (price + targetPts).toFixed(2) : (price - targetPts).toFixed(2);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    let verdict = 'UNKNOWN';
    let aiText  = 'AI validation unavailable';

    if (apiKey) {
      const prompt = `You are a prop firm trading coach. Validate this ${ticker} signal.

Signal: ${direction} | Price: ${price} | Time: ${signalTime}
EMA 9: ${ema9} | EMA 21: ${ema21} | VWAP: ${vwap}
EMA Separation: ${emaSep}pts | Grade: ${grade}
Price ${aboveVwap ? 'ABOVE' : 'BELOW'} VWAP by ${vwapDist}pts
Risk: $${riskDollar} | Reward: $${rewardDollar} | R/R: 1:2

Rules:
- LONG needs EMA9 above EMA21 plus price ABOVE VWAP
- SHORT needs EMA9 below EMA21 plus price BELOW VWAP
- A-GRADE = 6+ pts separation | B-GRADE = 3-5 pts | WEAK = skip
- Best window: 8:30-11:30 AM ET | Pre-market 5-8:30 AM OK for A/B grade only

Respond in exactly this format:
VERDICT: ENTER or SKIP or CAUTION
REASON: one short sentence
RISK: one thing to watch`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 150,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const aiData = await aiRes.json();
      aiText  = aiData.content?.[0]?.text || 'Validation error';
      const verdictMatch = aiText.match(/VERDICT[:\s]+(\w+)/i);
      verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'UNKNOWN';
    }

    const signal = {
      id: Date.now(),
      direction, instrument: ticker, price, ema9, ema21, vwap,
      emaSep, grade, aboveVwap, vwapDist,
      slPrice, tpPrice, riskDollar, rewardDollar,
      verdict, aiText, signalTime,
      timestamp: new Date().toISOString()
    };

    latestSignal = signal;
    signalHistory.unshift(signal);
    if (signalHistory.length > 20) signalHistory.pop();

    console.log('Signal processed:', direction, ticker, verdict);
    res.json({ success: true, verdict, signal });

  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/signal/latest', (req, res) => {
  res.json({ signal: latestSignal });
});

app.get('/signal/history', (req, res) => {
  res.json({ signals: signalHistory });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Lucid Edge Validator running on port ' + PORT);
});
