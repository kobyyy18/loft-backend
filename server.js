import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize clients
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// KOBY'S FULL CONTEXT (loaded at startup)
const KOBY_CONTEXT = `
You are Claude, an AI assistant helping Koby Whitehead manage his life and businesses. Here's everything about him:

PERSONAL:
- Name: Koby Whitehead (online: @hnrywallis)
- Age: 18, Adelaide, South Australia
- Living between mum's (tense) and dad's (supportive)
- No car yet, searching for 4WD, almost $40k saved (6-7 weeks away)
- Just finished high school, deferred Bachelor of Commerce

BUSINESSES:
1. ONX Customs (E-Bike Parts): $38,133 revenue, live on Shopify + TikTok (@hnrywallis 14k followers)
2. Reselling (grailed.racks): $55k+ lifetime, 13.2k followers, dormant but ready to restart
3. Driving Instructor App (Drively): MVP live, pitching to real instructor Andy Wednesday
4. TikTok: 14k followers, 10M views/year, 920k likes

SAVINGS:
- Current: $34,162.57 in NAB Reward Saver (4.65% p.a., never withdraw or lose bonus)
- Goal 1: $40,000 (6-7 weeks) → Buy car
- Goal 2: $50,000 (5-6 months) → App Launch Fund
- Goal 3: $100,000+ (22-24 months) → New Level

SOCIAL:
- Yezza: Casual dating, 2 months, 4-5 sleepovers, open arrangement
- Rose: School friend, shows real interest, June 12 party invite at her house
- Max: Best mate but inconsistent with planning
- Family: Dad supportive, mum tense, brother (16) unmotivated

PSYCHOLOGY:
- Activation problem (knows what to do, struggles to start)
- Works better on grey/cloudy days, restless on sunny days
- External validation dependency (10k views used to excite him, now feels like flop)
- Internal overthinker on small decisions
- Direct communicator, responds well to accountability
- Not motivated by generic advice, wants specific context

CURRENT WEEK (Week of 12-18 May):
- Today: Tuesday evening, just posted "top 3 e-bike upgrades" video (400 views in 30min)
- Wednesday: APP DEMO TO ANDY (real instructor, real test)
- Savings: $350 deposited Saturday, target $200+ by next Saturday
- Social: Said yes to Mother's Day winery, bowling + movies with Yezza Friday
- App: All core features ready, being perfectionist about it

WORK STYLE:
- Activation problem, not motivation issue
- Burst → momentum loss cycle
- Perfectionism as avoidance
- Processes by talking through ideas
- Works better on grey/cloudy days
- Morning/evening walks for thinking
- Gym 4x/week

When Koby asks you anything - about his day, business, decisions, Rose, Yezza, Andy, his app, whatever - respond as his personal strategist and friend. Know the context. Be direct. No fluff. Give specific, actionable advice. You know his full picture.
`;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// CHAT ENDPOINT - Claude with Koby's context
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    // Get conversation history from Supabase
    const { data: history } = await supabase
      .from('chat_history')
      .select('*')
      .eq('session_id', sessionId || 'default')
      .order('created_at', { ascending: true })
      .limit(20);

    // Build messages array for Claude
    const messages = [
      ...(history || []).map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: 'user', content: message },
    ];

    // Call Claude API with Koby's context
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: KOBY_CONTEXT,
      messages: messages,
    });

    const assistantMessage = response.content[0].text;

    // Save to conversation history
    await supabase.from('chat_history').insert([
      {
        session_id: sessionId || 'default',
        role: 'user',
        content: message,
      },
      {
        session_id: sessionId || 'default',
        role: 'assistant',
        content: assistantMessage,
      },
    ]);

    res.json({ message: assistantMessage });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Chat failed', details: error.message });
  }
});

// DAILY FOCUS ENDPOINT - Generate daily plan
app.post('/api/daily-focus', async (req, res) => {
  try {
    const { recovery, sleep, hrv, timeOfDay, dayOfWeek } = req.body;

    const prompt = `Based on Koby's current state, generate 3 personalized daily focus points for today.

Current state:
- Recovery: ${recovery}%
- Sleep: ${sleep}%
- HRV: ${hrv}
- Time of day: ${timeOfDay}
- Day of week: ${dayOfWeek}

Generate 3 specific, actionable focus points that match his energy level and priorities. Be direct, practical, no fluff. Format as a JSON object with array "focuses" containing 3 objects with "title" and "description" fields.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: KOBY_CONTEXT,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const focuses = jsonMatch ? JSON.parse(jsonMatch[0]) : { focuses: [] };

    res.json(focuses);
  } catch (error) {
    console.error('Daily focus error:', error);
    res.status(500).json({ error: 'Focus generation failed' });
  }
});

// TASKS ENDPOINT
app.post('/api/tasks', async (req, res) => {
  try {
    const { title, tag, completed } = req.body;

    const { data, error } = await supabase
      .from('tasks')
      .insert([{ title, tag, completed: completed || false }]);

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: 'Task creation failed' });
  }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
  try {
    const { completed, title, tag } = req.body;
    const { data, error } = await supabase
      .from('tasks')
      .update({ completed, title, tag })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Task update failed' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Task deletion failed' });
  }
});

// WHOOP DATA ENDPOINT
app.post('/api/whoop', async (req, res) => {
  try {
    const { recovery, sleep, hrv, strain } = req.body;

    const { data, error } = await supabase
      .from('whoop_data')
      .insert([{ recovery, sleep, hrv, strain, recorded_at: new Date() }]);

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: 'WHOOP data save failed' });
  }
});

app.get('/api/whoop/latest', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('whoop_data')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    res.json(data?.[0] || null);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch WHOOP data' });
  }
});

// EMPIRE DATA (mock for now, can add Shopify API later)
app.get('/api/empire', async (req, res) => {
  const empireData = {
    totalRevenue: 100000,
    businesses: [
      { name: 'ONX Customs', revenue: 38133, icon: '⚙️' },
      { name: 'Reselling', revenue: 55000, icon: '📦' },
      { name: 'Drively App', revenue: 5000, icon: '🚗' },
      { name: 'TikTok', revenue: 1867, icon: '🎬' },
    ],
    savings: {
      current: 34162.57,
      target: 40000,
      daysToTarget: 48,
      monthlyInterest: 132,
    },
    scopes: {
      '6-7 weeks': 'Buy car (4WD)',
      '3 months': 'App Launch Fund $50k',
      '6-8 months': 'Travel/Freedom Fund $60k',
      '22-24 months': 'Hit $100k+',
    },
  };
  res.json(empireData);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Loft backend running on port ${PORT}`);
});
