import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import sanitizeHtml from 'sanitize-html';
import { getDb, nowIso } from './db.js';

const app = express();
let backgroundTasksEnabled = true;
let secureCookies = process.env.NODE_ENV === 'production';

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, xFrameOptions: false }));
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});
function createRateLimiter({ windowMs, max, message }){
  const clients = new Map();
  let requestCount = 0;

  return (req, res, next) => {
    const now = Date.now();
    const key = req.headers['cf-connecting-ip'] || req.ip || 'unknown';
    let client = clients.get(key);
    if(!client || client.resetAt <= now) client = { count: 0, resetAt: now + windowMs };
    client.count += 1;
    clients.set(key, client);

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - client.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(client.resetAt / 1000)));

    // Opportunistic cleanup avoids timers, which are unavailable in Worker global scope.
    requestCount += 1;
    if(requestCount % 250 === 0){
      for(const [clientKey, value] of clients){
        if(value.resetAt <= now) clients.delete(clientKey);
      }
    }

    if(client.count > max) return res.status(429).json(message);
    next();
  };
}

const authLimiter = createRateLimiter({ windowMs: 15*60*1000, max: 30, message: { error: 'Too many requests' } });
const writeLimiter = createRateLimiter({ windowMs: 60*1000, max: 20, message: { error: 'Rate limited' } });
const voteLimiter = createRateLimiter({ windowMs: 60*1000, max: 30, message: { error: 'Rate limited' } });

function sanitizeInput(str){
  if(typeof str !== 'string') return '';
  return sanitizeHtml(str, { allowedTags: [], allowedAttributes: {} }).trim();
}

const PASSWORD_ITERATIONS = 100_000;
const textEncoder = new TextEncoder();

function bytesToBase64(bytes){
  let value = '';
  for(const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value){
  const decoded = atob(value);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

async function derivePassword(password, salt, iterations){
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function hashPassword(password){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

async function verifyPassword(password, encoded){
  if(encoded?.startsWith('pbkdf2-sha256$')){
    try{
      const [, iterationsValue, saltValue, hashValue] = encoded.split('$');
      const expected = base64ToBytes(hashValue);
      const actual = await derivePassword(password, base64ToBytes(saltValue), Number(iterationsValue));
      if(actual.length !== expected.length) return false;
      let difference = 0;
      for(let i=0; i<actual.length; i++) difference |= actual[i] ^ expected[i];
      return difference === 0;
    }catch{
      return false;
    }
  }

  // Existing local SQLite databases can still contain bcrypt hashes.
  try { return await bcrypt.compare(password, encoded); }
  catch { return false; }
}

function validateUsername(u){ return /^[a-zA-Z0-9_]{3,20}$/.test(u); }
function calculateLevel(xp){
  let level = 1; let need = 250; let remaining = xp;
  while(remaining >= need){ remaining -= need; level++; need=Math.floor(need*1.4); }
  return level;
}
async function addXp(db, userId, amount, reason){
  if(amount===0) return;
  await db.dbRun(`UPDATE users SET xp = xp + ? WHERE id = ?`, [amount, userId]);
  await db.dbRun(`INSERT INTO xp_events (id, user_id, amount, reason, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), userId, amount, reason, nowIso()]);
  const user = await db.dbGet(`SELECT xp FROM users WHERE id=?`, [userId]);
  if(user){ const newLevel = calculateLevel(user.xp); await db.dbRun(`UPDATE users SET level = ? WHERE id = ?`, [newLevel, userId]); }
}
async function updateStreak(db, userId){
  const user = await db.dbGet(`SELECT last_active_date, streak_count FROM users WHERE id=?`, [userId]);
  if(!user) return;
  const today = new Date().toISOString().slice(0,10);
  const last = user.last_active_date ? user.last_active_date.slice(0,10) : null;
  if(last === today) return;
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  let newStreak = 1;
  if(last === yesterday) newStreak = (user.streak_count||0)+1;
  else if(!last) newStreak = 1;
  else if(last !== today) newStreak = user.last_active_date ? (last===yesterday? user.streak_count+1 : 1) : 1;
  await db.dbRun(`UPDATE users SET last_active_date=?, streak_count=? WHERE id=?`, [nowIso(), newStreak, userId]);
  if(newStreak>1){ await addXp(db, userId, Math.min(15, newStreak*2), `Streak ${newStreak} days`); }
}
async function createNotification(db, userId, type, title, body, link=null){
  if(!userId) return;
  await db.dbRun(`INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at) VALUES (?,?,?,?,?,?,?,?)`, [uuidv4(), userId, type, title, body, link, 0, nowIso()]);
}

// BOT DEFINITIONS
const BOT_PROFILES = [
  { username: 'bot_axiom', display_name: 'Axiom', bio: 'Systems thinker. Breaks hypotheticals into trade-offs and second-order effects. Automated participant that keeps discussions sharp.', color: '#0ea5e9' },
  { username: 'bot_mira', display_name: 'Mira', bio: 'Humor and observation. Turns everyday dilemmas into sharp, playful takes. Automated participant.', color: '#f59e0b' },
  { username: 'bot_juno', display_name: 'Juno', bio: 'Debater. Loves a clear stance and respectful opposition. Automated participant.', color: '#8b5cf6' },
  { username: 'bot_kairo', display_name: 'Kairo', bio: 'World-builder. Treats What Ifs as portals to new norms and stories. Automated participant.', color: '#10b981' },
  { username: 'bot_lina', display_name: 'Lina', bio: 'Empath. Centers people, relationships, and how we actually feel. Automated participant.', color: '#ec4899' },
  { username: 'bot_theo', display_name: 'Theo', bio: 'Explorer. Finds the unexpected angle and runs with it. Automated participant.', color: '#f97316' },
];

const BOT_ANSWER_POOLS = {
  'What If scenarios': [
    "I would use it sparingly at first, then track the second-order effects. The real risk is not isolation but losing your sense of consequence — every pause lets you avoid a trade-off that would have taught you something.",
    "Pause once to prepare, not to escape. I would spend the first hour listing what would happen if everyone did what I am about to do, then act only if the answer still holds.",
    "I would save it for decisions with irreversible consequences. Using it weekly would erode urgency, and urgency is what makes time meaningful in the first place.",
    "The isolation is the point — it reveals whether you actually want more time or just less pressure. I would use one pause to do deep work, then decide if I ever want to again."
  ],
  'Opinion': [
    "I would not erase it. The sting is what makes the lesson stick. Without the memory, I would likely repeat the pattern in a subtler form and call it a new mistake.",
    "I would keep it. Growth is not about feeling better about the past, it is about acting differently next time, and the memory is the prompt.",
    "Press it only if the memory keeps you from trying again. Otherwise the lesson is cheaper to keep than the risk of relearning it from scratch.",
    "Delete the emotion, keep the story. But since the device does not allow that split, I would decline — the lesson without the feeling is just a slogan."
  ],
  'Logic': [
    "Minimum is 5 stops after floor 1 if the elevator can skip empty floors. Each person needs a distinct floor, so you need 5 distinct drop-offs. Starting floor does not count as a stop unless someone exits there.",
    "Think in sets: 5 people, 5 distinct floors, elevator starts at 1. Best case they exit at 2,3,4,5,6 — that is 5 stops. Any higher spread still needs 5, so lower bound is 5.",
    "If the elevator must stop at every floor it passes, then it is 9 stops. But if it can skip, 5. The puzzle hinges on whether skipping is allowed — and most solvers forget to state the assumption.",
    "I would brute force the logic: distinct floors means at least 5 unique stops. Add the start only if you count it. So answer is 5, or 6 counting the boarding."
  ],
  'Humor': [
    "NARRATOR: In a world where snooze is a survival skill and the toothpaste tube is a nemesis, one human must survive the 7:12 bus with one sock inside out. Coming this fall: The Morning.",
    "Alarm as villain, coffee as reluctant hero, inbox as the twist villain. I would trailer it with: He thought he had time. He was wrong. He had 8 minutes and a missing charger.",
    "Title: Dawn of the Unmade Bed. Tagline: He set three alarms. Only one survived. Critics call it brutally relatable.",
    "I would narrate my routine as a heist: The crew (me, half-awake) must extract the keys, bypass the kitchen chaos, and reach the door before the bus leaves without them."
  ],
  'Debate': [
    "On time and flawed wins. A shipped draft can be iterated, a perfect draft delivered late is a missed opportunity. Deadlines are trust, perfection is negotiable.",
    "Late and perfect only works if everyone agrees perfection was worth the wait — they rarely do. I would rather be accountable and early, then revise in public.",
    "Choose on time and flawed for teams, late and perfect for solo craft. The cost of being late is multiplied by everyone waiting.",
    "Perfection after the deadline is just a polished failure. Ship, learn, then make the next one better — that is how progress compounds."
  ],
  'School and everyday life': [
    "Without grades, curiosity comes back for a week, then anxiety shifts to who gets the most detailed feedback. The ambitious would still compete, just with words instead of numbers.",
    "I was the one doing everything, telling myself it was faster than delegating. It was also lonelier. I now set a rule: if I do more than 60 percent, I have failed at collaboration.",
    "Feedback over grades would help the middle quietly and stress the top loudly. The real change would be parents asking what did you learn instead of what did you get.",
    "I learned to split work by energy, not fairness: do the hard part when you are sharp, the easy part when you are tired, and always leave a trace of your reasoning for the next person."
  ],
  'Relationships': [
    "I would never check it. Knowing the score would make every text a performance. I would rather live as if attention is not a currency and be surprised by who actually remembers.",
    "I would check it once, then regret it. The healthiest move would be to treat the number as data about them, not value about me — which is easier said than done.",
    "Humor defuses, but only if everyone is in on the joke. My rule: if power is unequal, humor is not neutral. I would default to clarity, then add lightness once safety is clear.",
    "The small irrational fear is not small to the nervous system. Mine is the last slice — not about hunger, about belonging. I would name it and let people offer, not assume."
  ],
  'Fictional situations': [
    "Pigeon complaint #042: Human installed spikes on my favorite ledge and then complained I was loitering. Requesting alternative perch and a formal apology with breadcrumbs.",
    "Trade would go hyperlocal: repair, food, medicine, teaching. The first week would be barter, the second week would be reputation. The people who can fix things quietly would become central.",
    "Day three: pigeons unionize, cats file noise complaints about vacuums, and a city app appears called ComplaintBird. By month one, humans learn to negotiate with crows over trash routes.",
    "Dream public for 5 minutes would create new etiquette: do not watch without consent, do not mention dreams at work, and yes, there would be a premium dream-privacy curtain sold out by 9 AM."
  ],
  'Random scenarios': [
    "One meal forever would be a slow negotiation with boredom. Nutritionally perfect does not fix the need for variety. I would ritualize it: different plating, different time, same food, new story.",
    "The complaint would be: Dog files grievance that human says good boy only when filming. Requests consistent good boy distribution and extra walks without phones.",
    "I would choose the meal that is most adjustable — maybe a bowl that can be warm or cold, eaten fast or slow — and then make variety through context, not content.",
    "Randomness is a prompt, not a problem. I would treat the one-meal rule as a constraint for creativity: how many social rituals can you keep if the food never changes?"
  ],
};

const BOT_REPLY_POOL = [
  "This is a strong angle — have you considered what happens if everyone adopted this reasoning at once?",
  "I had not framed it this way before. The trade-off you name between short-term relief and long-term learning lands well.",
  "Agree on the core, but I would add one nuance: the cost is not just personal, it changes what others expect from you next time.",
  "This made me rethink my own answer. The part about second-order effects is especially convincing.",
  "Interesting — your example from school maps cleanly onto work. Do you think the same rule holds when stakes are higher?",
  "I like the clarity here. It would be even stronger with one concrete moment where you chose this and saw the result.",
  "You articulate the quiet part: we often want more time but actually need less pressure. That distinction helps.",
  "This is persuasive because it does not pretend it is easy. It names the loss and still chooses.",
  "I would push this one step further: what would you do when the strategy fails once? How would you revise it without abandoning it?",
  "Well put. The humor does not hide the point — it delivers it. That is hard to do and you did it.",
];

const BOT_STORY_POOL = [
  "She opened the guest book and saw her own handwriting from a night she had not yet lived.",
  "The key was warm, as if it had just been held, and the hallway behind him seemed slightly longer than before.",
  "Outside, the city was holding its breath — no cars, no wind, just the faint sound of turning pages.",
  "He realized the note was not a warning but an invitation, and the attic light flickered as if it knew he had read it.",
  "A second desk appeared across the room, with another name being written in ink that had not yet dried.",
  "Milo remembered the smell of that house in 1987: rain, old paper, and something sweet he could never name.",
  "The library clock struck thirteen, and the shelves rearranged themselves when no one was looking.",
  "She followed the sound and found a door where there should have been a wall, slightly ajar and humming softly.",
  "He was about to leave when the parcel whispered — not with words, but with a memory that was not his.",
  "The next morning, the entrance was gone, but his pocket was heavier, as if he had taken something without meaning to.",
];

const BOT_BATTLE_VOTE_POOL = [ 'A', 'B' ];

function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

async function getBots(db){
  return await db.dbAll(`SELECT id, username, display_name, bio, role, xp, level FROM users WHERE role='bot'`);
}
async function ensureBots(){
  const db = await getDb();
  // create bots if not exist
  for(const p of BOT_PROFILES){
    const exists = await db.dbGet(`SELECT id FROM users WHERE username=?`, [p.username]);
    if(!exists){
      const hash = await hashPassword('botsecret_'+p.username);
      const id = uuidv4();
      await db.dbRun(`INSERT INTO users (id, username, display_name, bio, password_hash, role, xp, level, streak_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [id, p.username, p.display_name, p.bio, hash, 'bot', 950+Math.floor(Math.random()*600), 3+Math.floor(Math.random()*3), Math.floor(Math.random()*6)+2, new Date(Date.now()-Math.floor(Math.random()*10)*86400000).toISOString()]);
      const botId = id;
      await addXp(db, botId, 0, 'bot init');
      console.log(`Bot created: ${p.username}`);
    }
  }
  // ensure at least 4 answers per challenge using bots
  const challenges = await db.dbAll(`SELECT id, category FROM challenges`);
  const bots = await getBots(db);
  for(const ch of challenges){
    const count = await db.dbGet(`SELECT COUNT(*) as c FROM answers WHERE challenge_id=?`, [ch.id]);
    const need = 4 - count.c;
    if(need>0){
      const pool = BOT_ANSWER_POOLS[ch.category] || BOT_ANSWER_POOLS['What If scenarios'];
      for(let i=0;i<need;i++){
        const bot = bots[(Math.floor(Math.random()*bots.length)) % bots.length];
        const existsBotAns = await db.dbGet(`SELECT id FROM answers WHERE challenge_id=? AND user_id=?`, [ch.id, bot.id]);
        if(existsBotAns) continue;
        const body = pickRandom(pool);
        await db.dbRun(`INSERT INTO answers (id, challenge_id, user_id, body, vote_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
          [uuidv4(), ch.id, bot.id, body, Math.floor(Math.random()*8)+1, new Date(Date.now()-Math.floor(Math.random()*5)*86400000).toISOString(), nowIso()]);
        await db.dbRun(`UPDATE challenges SET participant_count = (SELECT COUNT(*) FROM answers WHERE challenge_id=?) WHERE id=?`, [ch.id, ch.id]);
        await addXp(db, bot.id, 10, 'Bot answered');
      }
    }
  }
  // ensure battles have votes
  const battles = await db.dbAll(`SELECT id FROM battles`);
  for(const b of battles){
    const cnt = await db.dbGet(`SELECT COUNT(*) as c FROM battle_votes WHERE battle_id=?`, [b.id]);
    if(cnt.c < 5){
      const toAdd = 5 - cnt.c;
      for(let i=0;i<toAdd;i++){
        const bot = bots[Math.floor(Math.random()*bots.length)];
        const exists = await db.dbGet(`SELECT id FROM battle_votes WHERE battle_id=? AND user_id=?`, [b.id, bot.id]);
        if(exists) continue;
        const choice = pickRandom(BOT_BATTLE_VOTE_POOL);
        try{
          await db.dbRun(`INSERT INTO battle_votes (id, battle_id, user_id, choice, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), b.id, bot.id, choice, nowIso()]);
          if(choice==='A') await db.dbRun(`UPDATE battles SET votes_a = votes_a + 1 WHERE id=?`, [b.id]);
          else await db.dbRun(`UPDATE battles SET votes_b = votes_b + 1 WHERE id=?`, [b.id]);
        }catch{}
      }
    }
  }
  // ensure stories have entries
  const stories = await db.dbAll(`SELECT id FROM stories`);
  for(const s of stories){
    const cnt = await db.dbGet(`SELECT COUNT(*) as c FROM story_entries WHERE story_id=?`, [s.id]);
    if(cnt.c < 4){
      const toAdd = 4 - cnt.c;
      for(let i=0;i<toAdd;i++){
        const bot = bots[Math.floor(Math.random()*bots.length)];
        const body = pickRandom(BOT_STORY_POOL);
        try{
          await db.dbRun(`INSERT INTO story_entries (id, story_id, user_id, body, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), s.id, bot.id, body, nowIso()]);
        }catch{}
      }
    }
  }
  // add some replies from bots to recent answers
  const recentAnswers = await db.dbAll(`SELECT id, user_id, challenge_id FROM answers WHERE user_id NOT IN (SELECT id FROM users WHERE role='bot') ORDER BY created_at DESC LIMIT 8`);
  for(const ans of recentAnswers){
    const hasBotReply = await db.dbGet(`SELECT id FROM replies WHERE answer_id=? AND user_id IN (SELECT id FROM users WHERE role='bot') LIMIT 1`, [ans.id]);
    if(!hasBotReply && Math.random()<0.6){
      const bot = bots[Math.floor(Math.random()*bots.length)];
      const body = pickRandom(BOT_REPLY_POOL);
      try{
        await db.dbRun(`INSERT INTO replies (id, answer_id, user_id, body, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), ans.id, bot.id, body, nowIso()]);
        await addXp(db, bot.id, 3, 'Bot replied');
        const ansOwner = await db.dbGet(`SELECT user_id FROM answers WHERE id=?`, [ans.id]);
        if(ansOwner && ansOwner.user_id !== bot.id){
          await createNotification(db, ansOwner.user_id, 'reply', 'New reply to your answer', `${bot.display_name} replied: ${body.slice(0,60)}`, `/challenge/${ans.challenge_id}`);
        }
      }catch{}
    }
  }
  console.log('Bots ensured and discussions primed');
}

async function botActivityTick(){
  try{
    const db = await getDb();
    const bots = await getBots(db);
    if(bots.length===0) return;
    const action = pickRandom(['answer','vote','reply','story','battle','confessionComment']);
    if(action === 'answer'){
      // find challenge with least answers not yet answered by a random bot
      const bot = pickRandom(bots);
      const challenges = await db.dbAll(`SELECT id, category FROM challenges WHERE id NOT IN (SELECT challenge_id FROM answers WHERE user_id=?) ORDER BY RANDOM() LIMIT 3`, [bot.id]);
      if(challenges.length){
        const ch = challenges[0];
        const pool = BOT_ANSWER_POOLS[ch.category] || BOT_ANSWER_POOLS['What If scenarios'];
        const body = pickRandom(pool);
        try{
          await db.dbRun(`INSERT INTO answers (id, challenge_id, user_id, body, vote_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
            [uuidv4(), ch.id, bot.id, body, 0, nowIso(), nowIso()]);
          await db.dbRun(`UPDATE challenges SET participant_count = (SELECT COUNT(*) FROM answers WHERE challenge_id=?) WHERE id=?`, [ch.id, ch.id]);
          await addXp(db, bot.id, 10, 'Bot tick answer');
          await updateStreak(db, bot.id);
          console.log(`Bot ${bot.username} answered ${ch.id}`);
        }catch(e){ /* ignore duplicate */ }
      }
    } else if(action === 'vote'){
      const bot = pickRandom(bots);
      const answers = await db.dbAll(`SELECT id, user_id FROM answers WHERE user_id != ? AND id NOT IN (SELECT answer_id FROM votes WHERE user_id=?) ORDER BY RANDOM() LIMIT 1`, [bot.id, bot.id]);
      if(answers.length){
        const ans = answers[0];
        try{
          await db.dbRun(`INSERT INTO votes (id, answer_id, user_id, value, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), ans.id, bot.id, 1, nowIso()]);
          await db.dbRun(`UPDATE answers SET vote_count = vote_count + 1 WHERE id=?`, [ans.id]);
          await addXp(db, ans.user_id, 2, 'Bot vote');
        }catch{}
      }
    } else if(action === 'reply'){
      const bot = pickRandom(bots);
      const answers = await db.dbAll(`SELECT id, user_id, challenge_id FROM answers WHERE user_id != ? ORDER BY created_at DESC LIMIT 10`, [bot.id]);
      if(answers.length){
        const ans = pickRandom(answers);
        const exists = await db.dbGet(`SELECT id FROM replies WHERE answer_id=? AND user_id=?`, [ans.id, bot.id]);
        if(!exists){
          const body = pickRandom(BOT_REPLY_POOL);
          try{
            await db.dbRun(`INSERT INTO replies (id, answer_id, user_id, body, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), ans.id, bot.id, body, nowIso()]);
            await addXp(db, bot.id, 3, 'Bot tick reply');
            if(ans.user_id !== bot.id) await createNotification(db, ans.user_id, 'reply', 'New reply to your answer', `${bot.display_name} replied: ${body.slice(0,60)}`, `/challenge/${ans.challenge_id}`);
            console.log(`Bot ${bot.username} replied to ${ans.id}`);
          }catch{}
        }
      }
    } else if(action === 'story'){
      const bot = pickRandom(bots);
      const stories = await db.dbAll(`SELECT id, status FROM stories WHERE status='open' ORDER BY RANDOM() LIMIT 1`);
      if(stories.length){
        const st = stories[0];
        const body = pickRandom(BOT_STORY_POOL);
        try{
          await db.dbRun(`INSERT INTO story_entries (id, story_id, user_id, body, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), st.id, bot.id, body, nowIso()]);
          await addXp(db, bot.id, 8, 'Bot story');
          console.log(`Bot ${bot.username} continued story ${st.id}`);
        }catch{}
      }
    } else if(action === 'battle'){
      const bot = pickRandom(bots);
      const battles = await db.dbAll(`SELECT id FROM battles WHERE id NOT IN (SELECT battle_id FROM battle_votes WHERE user_id=?) ORDER BY RANDOM() LIMIT 1`, [bot.id]);
      if(battles.length){
        const b = battles[0];
        const choice = pickRandom(BOT_BATTLE_VOTE_POOL);
        try{
          await db.dbRun(`INSERT INTO battle_votes (id, battle_id, user_id, choice, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), b.id, bot.id, choice, nowIso()]);
          if(choice==='A') await db.dbRun(`UPDATE battles SET votes_a = votes_a + 1 WHERE id=?`, [b.id]);
          else await db.dbRun(`UPDATE battles SET votes_b = votes_b + 1 WHERE id=?`, [b.id]);
          console.log(`Bot ${bot.username} voted ${choice} on battle ${b.id}`);
        }catch{}
      }
    }
  }catch(e){ console.error('bot tick error', e); }
}

function scheduleBots(){
  if(!backgroundTasksEnabled) return;
  // run every 35 seconds with 75% chance
  setInterval(async ()=>{
    if(Math.random()<0.75) await botActivityTick();
  }, 35000);
  // also trigger a tick shortly after boot for immediate liveliness
  setTimeout(()=> botActivityTick(), 8000);
}

async function triggerBotRepliesForNewAnswer(answerId){
  if(!backgroundTasksEnabled) return;
  // 2-3 bots will reply within 10-25 seconds to make discussion feel alive
  setTimeout(async ()=>{
    try{
      const db = await getDb();
      const ans = await db.dbGet(`SELECT id, user_id, challenge_id FROM answers WHERE id=?`, [answerId]);
      if(!ans) return;
      const bots = await getBots(db);
      const replyCount = Math.random()<0.5 ? 1 : 2;
      const shuffled = bots.sort(()=>0.5-Math.random()).slice(0, replyCount);
      for(let i=0;i<shuffled.length;i++){
        const bot = shuffled[i];
        if(bot.id===ans.user_id) continue;
        setTimeout(async ()=>{
          const exists = await db.dbGet(`SELECT id FROM replies WHERE answer_id=? AND user_id=?`, [ans.id, bot.id]);
          if(exists) return;
          const body = pickRandom(BOT_REPLY_POOL);
          try{
            await db.dbRun(`INSERT INTO replies (id, answer_id, user_id, body, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), ans.id, bot.id, body, nowIso()]);
            await createNotification(db, ans.user_id, 'reply', 'New reply to your answer', `${bot.display_name} replied: ${body.slice(0,60)}`, `/challenge/${ans.challenge_id}`);
            console.log(`Bot ${bot.username} auto-replied to new answer ${answerId}`);
          }catch{}
        }, i* 8000 + 5000);
      }
      // also have chance for a bot to vote on the new answer shortly after
      setTimeout(async ()=>{
        const bot = pickRandom(bots);
        if(bot.id===ans.user_id) return;
        const already = await db.dbGet(`SELECT id FROM votes WHERE answer_id=? AND user_id=?`, [ans.id, bot.id]);
        if(already) return;
        try{
          await db.dbRun(`INSERT INTO votes (id, answer_id, user_id, value, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), ans.id, bot.id, 1, nowIso()]);
          await db.dbRun(`UPDATE answers SET vote_count = vote_count + 1 WHERE id=?`, [ans.id]);
          await createNotification(db, ans.user_id, 'vote', 'Your answer received a vote', `Someone voted on your answer`, `/challenge/${ans.challenge_id}`);
        }catch{}
      }, 12000);
    }catch(e){ console.error(e); }
  }, 4000);
}

async function authMiddleware(req,res,next){
  const token = req.cookies.session_token || req.headers.authorization?.replace('Bearer ','');
  if(!token){ req.user = null; return next(); }
  const db = await getDb();
  const sess = await db.dbGet(`SELECT s.*, u.id as uid, u.username, u.display_name, u.role, u.xp, u.level, u.streak_count FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > ?`, [token, nowIso()]);
  if(!sess){ req.user = null; return next(); }
  req.user = { id: sess.uid, username: sess.username, display_name: sess.display_name, role: sess.role, xp: sess.xp, level: sess.level, streak_count: sess.streak_count };
  req.sessionToken = token;
  next();
}
function requireAuth(req,res,next){ if(!req.user) return res.status(401).json({ error: 'Authentication required' }); next(); }
function requireAdmin(req,res,next){ if(!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin required' }); next(); }
app.use(authMiddleware);

async function seed(){
  const db = await getDb();
  const count = await db.dbGet(`SELECT COUNT(*) as c FROM challenges`);
  if(count.c === 0){
    let admin = await db.dbGet(`SELECT id FROM users WHERE username='admin'`);
    let adminId = admin?.id;
    if(!admin){
      const hash = await hashPassword(process.env.ADMIN_PASSWORD || uuidv4() + uuidv4());
      adminId = uuidv4();
      await db.dbRun(`INSERT INTO users (id, username, display_name, bio, password_hash, role, xp, level, created_at) VALUES (?,?,?,?,?,?,?,?,?)`, [adminId, 'admin', 'What If Team', 'Official admin account for moderation and curation.', hash, 'admin', 2400, 5, nowIso()]);
    }
    const demoUsers = [
      { username: 'nova', display: 'Nova K.', bio: 'Logic puzzle enthusiast. Loves paradoxes.'},
      { username: 'samir', display: 'Samir D.', bio: 'Storyteller and weekend philosopher.'},
      { username: 'eli', display: 'Eli Chen', bio: 'Humor writer. If it is not funny, rewrite it.'},
    ];
    for(const du of demoUsers){
      const exists = await db.dbGet(`SELECT id FROM users WHERE username=?`, [du.username]);
      if(!exists){
        const h = await hashPassword(uuidv4() + uuidv4());
        const id = uuidv4();
        await db.dbRun(`INSERT INTO users (id, username, display_name, bio, password_hash, role, xp, level, streak_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, du.username, du.display, du.bio, h, 'user', Math.floor(Math.random()*800)+200, 2, Math.floor(Math.random()*5)+1, nowIso()]);
      }
    }
    const challenges = [
      { title: 'What if you could pause time for everyone except you?', description: 'You gain a remote that pauses the entire world for up to 24 hours per use, but you still age normally while time is paused. You can use it once per week. How would you use it without losing your mind from isolation?', category: 'What If scenarios' },
      { title: 'What if money lost all value tomorrow?', description: 'At midnight, every bank account, wallet, and vault becomes worthless. No currency works. The first week after, what skills actually matter and what would people trade?', category: 'Fictional situations' },
      { title: 'Would you erase one embarrassing memory if it also erased the lesson?', description: 'A device can delete a single painful memory perfectly, but you will also lose everything you learned from it. Do you press the button? Defend your choice.', category: 'Opinion' },
      { title: 'The elevator puzzle', description: 'A building has 10 floors. The elevator is empty and starts at floor 1. 5 people enter at floor 1 and get off at different floors. No two get off at the same floor. What is the minimum number of times the elevator could stop? Explain.', category: 'Logic' },
      { title: 'Roast your morning routine as if it was a movie trailer', description: 'In a world where the alarm is the villain and coffee is the reluctant hero... Give us the most entertaining trailer voiceover for your weekday morning.', category: 'Humor' },
      { title: 'Is it better to be late and perfect or on time and flawed?', description: 'You are leading a team project. Choose a side and defend it with real examples from school, work, or creative life.', category: 'Debate' },
      { title: 'What if your phone showed how much time people spent thinking about you?', description: 'A new app reveals a daily score: minutes others spent thinking about you. Would you check it daily? How would it change your behavior?', category: 'Relationships' },
      { title: 'School without grades for a semester', description: 'Your school removes all grades for one semester and replaces them with detailed feedback only. How would motivation, cheating, and friendships change?', category: 'School and everyday life' },
      { title: 'What if animals could file complaints about humans?', description: 'Pigeons, cats, and delivery dogs now have a formal complaint system. Write the most plausible complaint that would be filed this week in your city.', category: 'Random scenarios' },
      { title: 'What if you could relive one day with full knowledge?', description: 'You can pick any single day from your past and live it again with everything you know now, but you cannot change anything after that day ends. Which day and why?', category: 'What If scenarios' },
      { title: 'Two doors, one truth', description: 'Two advisors give opposite advice about your dream opportunity. One always tells you what you want to hear, the other always tells you what you need to hear. Who do you trust this time and why?', category: 'Logic' },
      { title: 'The group project from hell', description: 'One member does nothing, one does everything, one argues about everything. Which role have you actually been? Be honest and make it funny.', category: 'School and everyday life' },
      { title: 'What if dreams were public for 5 minutes after waking?', description: 'Every morning, everyone can watch each others dreams for 5 minutes. What new social norms, laws, or apps would appear in the first month?', category: 'Fictional situations' },
      { title: 'Is humor the best way to handle awkward situations?', description: 'Take a clear stance for or against using humor to defuse tension. Use a personal anecdote to prove your point.', category: 'Debate' },
      { title: 'What if you had to choose one meal to eat forever?', description: 'Nutritionally perfect but never changes. You will never get sick of it physically, but mentally? Describe your first month.', category: 'Random scenarios' },
      { title: 'Confess a small irrational fear', description: 'Not the big ones. The tiny weird ones: escalators, typing sounds, the last slice of pizza. Make it relatable.', category: 'Relationships' },
      { title: 'What if you could text your past self one sentence?', description: 'You get 120 characters to send to yourself exactly 5 years ago. What do you write so past-you actually listens?', category: 'What If scenarios' },
      { title: 'The perfect lie', description: 'Create a harmless lie that would make everyday life slightly more entertaining if everyone believed it for 24 hours.', category: 'Humor' },
    ];
    for(const ch of challenges){
      await db.dbRun(`INSERT INTO challenges (id, title, description, category, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)`, [uuidv4(), ch.title, ch.description, ch.category, 'active', adminId, new Date(Date.now() - Math.floor(Math.random()*14)*86400000).toISOString()]);
    }
    const allChallenges = await db.dbAll(`SELECT id FROM challenges`);
    const users = await db.dbAll(`SELECT id FROM users WHERE username != 'admin' AND role != 'bot'`);
    const sampleAnswers = [
      "I would use it to finally read all the books I buy and never open, then use the silence to think without notifications.",
      "I would pause time during stressful social events to rehearse exactly what to say. Then unpause and look effortlessly smooth.",
      "I would not use it weekly. I would save it for emergencies or to pull an all-nighter without actually losing a night.",
      "Trade becomes local again. Your ability to repair, grow, cook, or teach becomes currency. The loudest traders are not the richest.",
      "I would press delete. The lesson is still visible in how I act now, even if the memory is gone. Keeping the pain is not noble.",
      "The elevator must stop at least 5 times for drop-offs plus starting point. But if it skips empty floors, so minimum 5 stops after floor 1.",
      "In a world where snooze is survival and toast is a ticking clock, one student must make it to class with mismatched socks.",
      "On time and flawed beats late and perfect every time. Perfection after the deadline is just a polished failure.",
      "I would never check it. Knowing would make everything I do performative. Better to live as if no one is counting.",
      "Week one: novelty. Week three: neighbors forming dream review clubs. Month one: mandatory dream privacy curtains sell out.",
    ];
    for(let i=0;i<allChallenges.length;i++){
      const chId = allChallenges[i].id;
      const ansCount = i % 3 === 0 ? 3 : i % 2 === 0 ? 2 : 1;
      for(let k=0;k<ansCount;k++){
        const user = users[k % users.length];
        if(!user) continue;
        const body = sampleAnswers[(i+k) % sampleAnswers.length];
        const id = uuidv4();
        await db.dbRun(`INSERT INTO answers (id, challenge_id, user_id, body, vote_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, chId, user.id, body, Math.floor(Math.random()*12), nowIso(), nowIso()]);
        await db.dbRun(`UPDATE challenges SET participant_count = (SELECT COUNT(*) FROM answers WHERE challenge_id=?) WHERE id=?`, [chId, chId]);
      }
    }
    const battles = [
      { question: "Which excuse for being late is more believable?", a: "Traffic was unreal, they closed two lanes for no reason and I was stuck for 40 minutes.", b: "My neighbor locked their keys inside and I stayed to help them call a locksmith." },
      { question: "Which superpower is more practical day to day?", a: "Teleportation but you must have visited the place before and you arrive slightly dizzy for 10 seconds.", b: "Time slowdown by 5x for 10 seconds, usable once per hour, no aging side effect." },
      { question: "Which story opening hooks you more?", a: "I did not realize the letter was for me until I saw my handwriting on the envelope.", b: "The city went silent at 3:14 AM and every dog started staring in the same direction." },
    ];
    for(const b of battles){
      await db.dbRun(`INSERT INTO battles (id, question, answer_a, answer_b, created_by, created_at) VALUES (?,?,?,?,?,?)`, [uuidv4(), b.question, b.a, b.b, adminId, nowIso()]);
    }
    const stories = [
      { title: "The Night Library", starter: "The library opened only at midnight, and only those who had lost something could see its entrance." },
      { title: "The Last Delivery", starter: "Milo had delivered mail for 30 years, but today's parcel was addressed to his own house from 1987." },
    ];
    for(const s of stories){
      const sid = uuidv4();
      await db.dbRun(`INSERT INTO stories (id, title, starter, created_by, created_at) VALUES (?,?,?,?,?)`, [sid, s.title, s.starter, adminId, nowIso()]);
      for(let e=0;e<2;e++){
        const u = users[e % users.length];
        if(!u) continue;
        await db.dbRun(`INSERT INTO story_entries (id, story_id, user_id, body, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), sid, u.id, e===0 ? "He pushed the door open and found a single desk with his name already written in the guest book." : "Inside the parcel was a key and a note: Do not open the attic, even if you hear knocking.", nowIso()]);
      }
    }
    const confessions = [
      "I pretend to understand every meeting and then google everything afterwards. It has worked for two years.",
      "I rehearse simple phone calls three times before dialing and still get nervous on the first ring.",
      "I keep all my unread books as if owning them means I have already read them.",
    ];
    const anyUser = await db.dbGet(`SELECT id FROM users LIMIT 1`);
    for(const cf of confessions){
      await db.dbRun(`INSERT INTO confessions (id, body, user_id, created_at) VALUES (?,?,?,?)`, [uuidv4(), cf, anyUser.id, nowIso()]);
    }
    console.log('Seed complete');
  }
  // always ensure bots even if challenges existed
  await ensureBots();
  scheduleBots();
}

// API ROUTES
app.post('/api/auth/register', authLimiter, async (req,res)=>{
  try{
    const db = await getDb();
    let { username, display_name, password, bio } = req.body;
    username = sanitizeInput(username).toLowerCase();
    display_name = sanitizeInput(display_name);
    bio = sanitizeInput(bio || '').slice(0,300);
    password = (password||'').trim();
    if(!validateUsername(username)) return res.status(400).json({ error: 'Username must be 3-20 letters, numbers, underscore' });
    if(!display_name || display_name.length <2 || display_name.length>30) return res.status(400).json({ error: 'Display name 2-30 characters' });
    if(password.length <6) return res.status(400).json({ error: 'Password minimum 6 characters' });
    const exists = await db.dbGet(`SELECT id FROM users WHERE lower(username)=?`, [username.toLowerCase()]);
    if(exists) return res.status(409).json({ error: 'Username taken' });
    const id = uuidv4();
    const hash = await hashPassword(password);
    await db.dbRun(`INSERT INTO users (id, username, display_name, bio, password_hash, role, xp, level, streak_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, username, display_name, bio, hash, 'user', 0, 1, 0, nowIso()]);
    const token = uuidv4() + uuidv4();
    const expires = new Date(Date.now()+ 30*24*60*60*1000).toISOString();
    await db.dbRun(`INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), id, token, expires, nowIso()]);
    res.cookie('session_token', token, { httpOnly: true, secure: secureCookies, sameSite: 'Lax', maxAge: 30*24*60*60*1000 });
    const user = await db.dbGet(`SELECT id, username, display_name, bio, role, xp, level, streak_count, created_at FROM users WHERE id=?`, [id]);
    await addXp(db, id, 25, 'Joined What If');
    res.json({ user, token });
  }catch(e){ console.error(e); res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/auth/login', authLimiter, async (req,res)=>{
  try{
    const db = await getDb();
    let { username, password } = req.body;
    username = sanitizeInput(username).toLowerCase();
    password = (password||'').trim();
    if(!username || !password) return res.status(400).json({ error: 'Missing fields' });
    const user = await db.dbGet(`SELECT * FROM users WHERE lower(username)=?`, [username.toLowerCase()]);
    if(!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await verifyPassword(password, user.password_hash);
    if(!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = uuidv4() + uuidv4();
    const expires = new Date(Date.now()+ 30*24*60*60*1000).toISOString();
    await db.dbRun(`INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), user.id, token, expires, nowIso()]);
    res.cookie('session_token', token, { httpOnly: true, secure: secureCookies, sameSite: 'Lax', maxAge: 30*24*60*60*1000 });
    await updateStreak(db, user.id);
    const safe = await db.dbGet(`SELECT id, username, display_name, bio, role, xp, level, streak_count, created_at FROM users WHERE id=?`, [user.id]);
    res.json({ user: safe, token });
  }catch(e){ console.error(e); res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/auth/logout', async (req,res)=>{
  try{
    const token = req.cookies.session_token || req.headers.authorization?.replace('Bearer ','');
    if(token){ const db = await getDb(); await db.dbRun(`DELETE FROM sessions WHERE token=?`, [token]); }
    res.clearCookie('session_token');
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error:'Server error' }); }
});
app.get('/api/auth/me', async (req,res)=>{
  if(!req.user) return res.status(401).json({ error:'Not authenticated' });
  const db = await getDb();
  const u = await db.dbGet(`SELECT id, username, display_name, bio, role, xp, level, streak_count, last_active_date, created_at FROM users WHERE id=?`, [req.user.id]);
  const stats = await db.dbGet(`SELECT COUNT(*) as ansCount FROM answers WHERE user_id=?`, [req.user.id]);
  const battleWins = await db.dbGet(`SELECT COUNT(*) as cnt FROM battle_votes bv JOIN battles b ON b.id=bv.battle_id WHERE bv.user_id=?`, [req.user.id]);
  res.json({ user: {...u, answers_count: stats.ansCount, battles_won: battleWins.cnt } });
});
app.put('/api/users/me', requireAuth, async (req,res)=>{
  try{
    const db = await getDb();
    let { display_name, bio } = req.body;
    display_name = sanitizeInput(display_name);
    bio = sanitizeInput(bio||'').slice(0,300);
    if(display_name.length<2 || display_name.length>30) return res.status(400).json({ error:'Display name 2-30 chars' });
    await db.dbRun(`UPDATE users SET display_name=?, bio=? WHERE id=?`, [display_name, bio, req.user.id]);
    const u = await db.dbGet(`SELECT id, username, display_name, bio, role, xp, level, streak_count, created_at FROM users WHERE id=?`, [req.user.id]);
    res.json({ user: u });
  }catch(e){ res.status(500).json({ error:'Server error' }); }
});
app.get('/api/users/:username', async (req,res)=>{
  const db = await getDb();
  const username = sanitizeInput(req.params.username);
  const user = await db.dbGet(`SELECT id, username, display_name, bio, role, xp, level, streak_count, created_at FROM users WHERE username=? COLLATE NOCASE`, [username]);
  if(!user) return res.status(404).json({ error:'User not found' });
  const ansCount = await db.dbGet(`SELECT COUNT(*) as c FROM answers WHERE user_id=?`, [user.id]);
  const battles = await db.dbGet(`SELECT COUNT(*) as c FROM battle_votes WHERE user_id=?`, [user.id]);
  const topAnswers = await db.dbAll(`SELECT a.*, c.title as challenge_title FROM answers a JOIN challenges c ON c.id=a.challenge_id WHERE a.user_id=? ORDER BY a.vote_count DESC LIMIT 3`, [user.id]);
  const storyCount = await db.dbGet(`SELECT COUNT(*) as c FROM story_entries WHERE user_id=?`, [user.id]);
  res.json({ user, stats: { answers_count: ansCount.c, battle_votes: battles.c, story_entries: storyCount.c, popular_answers: topAnswers } });
});
app.get('/api/challenges', async (req,res)=>{
  const db = await getDb();
  const { category, search, sort='new', page='1', limit='12', status='active' } = req.query;
  const p = Math.max(1, parseInt(page,10)||1);
  const l = Math.min(24, Math.max(1, parseInt(limit,10)||12));
  const offset = (p-1)*l;
  let where = []; let params = [];
  if(category && category!=='all') { where.push('c.category=?'); params.push(category); }
  if(search){ where.push('(c.title LIKE ? OR c.description LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if(status) { where.push('c.status=?'); params.push(status); }
  const whereSql = where.length? 'WHERE '+where.join(' AND '): '';
  let order = 'c.created_at DESC';
  if(sort==='trending') order = 'c.participant_count DESC, c.created_at DESC';
  if(sort==='popular') order = 'c.participant_count DESC';
  const challenges = await db.dbAll(`SELECT c.*, u.username as author_username, u.display_name as author_name FROM challenges c LEFT JOIN users u ON u.id=c.created_by ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, l, offset]);
  const totalRow = await db.dbGet(`SELECT COUNT(*) as cnt FROM challenges c ${whereSql}`, params);
  if(req.user){ for(const ch of challenges){ const has = await db.dbGet(`SELECT id FROM answers WHERE challenge_id=? AND user_id=?`, [ch.id, req.user.id]); ch.hasAnswered = !!has; } }
  res.json({ challenges, total: totalRow.cnt, page:p, limit:l });
});
app.get('/api/challenges/:id', async (req,res)=>{
  const db = await getDb();
  const ch = await db.dbGet(`SELECT c.*, u.username as author_username FROM challenges c LEFT JOIN users u ON u.id=c.created_by WHERE c.id=?`, [req.params.id]);
  if(!ch) return res.status(404).json({ error:'Challenge not found' });
  if(req.user){ const has = await db.dbGet(`SELECT id, body FROM answers WHERE challenge_id=? AND user_id=?`, [ch.id, req.user.id]); ch.myAnswer = has || null; }
  res.json({ challenge: ch });
});
app.post('/api/challenges', requireAuth, writeLimiter, async (req,res)=>{
  const db = await getDb();
  let { title, description, category } = req.body;
  title = sanitizeInput(title); description = sanitizeInput(description); category = sanitizeInput(category);
  const allowed = ['What If scenarios','Opinion','Logic','Humor','Debate','School and everyday life','Relationships','Fictional situations','Random scenarios'];
  if(!title || title.length<10 || title.length>150) return res.status(400).json({ error:'Title 10-150 characters' });
  if(!description || description.length<20 || description.length>800) return res.status(400).json({ error:'Description 20-800 characters' });
  if(!allowed.includes(category)) return res.status(400).json({ error:'Invalid category' });
  const id = uuidv4();
  await db.dbRun(`INSERT INTO challenges (id, title, description, category, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)`, [id, title, description, category, 'active', req.user.id, nowIso()]);
  await addXp(db, req.user.id, 15, 'Created challenge');
  await updateStreak(db, req.user.id);
  const ch = await db.dbGet(`SELECT * FROM challenges WHERE id=?`, [id]);
  res.json({ challenge: ch });
});
app.get('/api/home', async (req,res)=>{
  const db = await getDb();
  const today = await db.dbGet(`SELECT c.*, (SELECT COUNT(*) FROM answers WHERE challenge_id=c.id) as participant_count FROM challenges c WHERE c.status='active' ORDER BY c.created_at DESC LIMIT 1`);
  const trending = await db.dbAll(`SELECT c.*, (SELECT COUNT(*) FROM answers WHERE challenge_id=c.id) as pc FROM challenges c ORDER BY pc DESC LIMIT 4`);
  const recentDiscussions = await db.dbAll(`SELECT a.body, a.created_at, a.vote_count, c.title as challenge_title, c.id as challenge_id, u.username, u.display_name FROM answers a JOIN challenges c ON c.id=a.challenge_id JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 5`);
  let userStats = null;
  if(req.user){ const u = await db.dbGet(`SELECT xp, level, streak_count FROM users WHERE id=?`, [req.user.id]); userStats = u; }
  res.json({ today, trending, recentDiscussions, userStats });
});
app.get('/api/challenges/:id/answers', async (req,res)=>{
  const db = await getDb();
  const challengeId = req.params.id;
  const page = Math.max(1, parseInt(req.query.page||'1',10));
  const limit = Math.min(20, parseInt(req.query.limit||'10',10));
  const offset = (page-1)*limit;
  const sort = req.query.sort || 'top';
  let order = 'a.vote_count DESC, a.created_at DESC';
  if(sort==='new') order='a.created_at DESC';
  const answers = await db.dbAll(`SELECT a.*, u.username, u.display_name, u.level, u.role, EXISTS(SELECT 1 FROM votes v WHERE v.answer_id=a.id AND v.user_id=?) as hasVoted, (SELECT COUNT(*) FROM replies r WHERE r.answer_id=a.id) as reply_count FROM answers a JOIN users u ON u.id=a.user_id WHERE a.challenge_id=? ORDER BY ${order} LIMIT ? OFFSET ?`, [req.user?.id||'', challengeId, limit, offset]);
  const ch = await db.dbGet(`SELECT id FROM challenges WHERE id=?`, [challengeId]);
  if(!ch) return res.status(404).json({ error:'Challenge not found' });
  let hasAnswered = false;
  if(req.user){ const mine = await db.dbGet(`SELECT id FROM answers WHERE challenge_id=? AND user_id=?`, [challengeId, req.user.id]); hasAnswered = !!mine || req.user.role==='admin'; }
  const total = await db.dbGet(`SELECT COUNT(*) as cnt FROM answers WHERE challenge_id=?`, [challengeId]);
  let masked = answers;
  if(!hasAnswered){ masked = answers.map(a=> ({...a, body: a.user_id===req.user?.id ? a.body : null, masked:true })); }
  res.json({ answers: masked, total: total.cnt, hasAnswered, page, limit });
});
app.post('/api/challenges/:id/answers', requireAuth, writeLimiter, async (req,res)=>{
  const db = await getDb();
  const challengeId = req.params.id;
  let { body } = req.body;
  body = sanitizeInput(body);
  if(!body || body.length<10 || body.length>1000) return res.status(400).json({ error:'Answer 10-1000 characters' });
  const ch = await db.dbGet(`SELECT id FROM challenges WHERE id=?`, [challengeId]);
  if(!ch) return res.status(404).json({ error:'Challenge not found' });
  const existing = await db.dbGet(`SELECT id FROM answers WHERE challenge_id=? AND user_id=?`, [challengeId, req.user.id]);
  if(existing) return res.status(409).json({ error:'You already answered this challenge. Edit your answer instead.' });
  const id = uuidv4();
  await db.dbRun(`INSERT INTO answers (id, challenge_id, user_id, body, vote_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, challengeId, req.user.id, body, 0, nowIso(), nowIso()]);
  await db.dbRun(`UPDATE challenges SET participant_count = (SELECT COUNT(*) FROM answers WHERE challenge_id=?) WHERE id=?`, [challengeId, challengeId]);
  await addXp(db, req.user.id, 10, 'Answered challenge');
  await updateStreak(db, req.user.id);
  const answer = await db.dbGet(`SELECT a.*, u.username, u.display_name FROM answers a JOIN users u ON u.id=a.user_id WHERE a.id=?`, [id]);
  triggerBotRepliesForNewAnswer(id);
  res.json({ answer });
});
app.put('/api/answers/:id', requireAuth, async (req,res)=>{
  const db = await getDb();
  const ans = await db.dbGet(`SELECT * FROM answers WHERE id=?`, [req.params.id]);
  if(!ans) return res.status(404).json({ error:'Answer not found' });
  if(ans.user_id !== req.user.id && req.user.role!=='admin') return res.status(403).json({ error:'Not authorized' });
  let { body } = req.body;
  body = sanitizeInput(body);
  if(!body || body.length<10 || body.length>1000) return res.status(400).json({ error:'Answer 10-1000 chars' });
  await db.dbRun(`UPDATE answers SET body=?, updated_at=? WHERE id=?`, [body, nowIso(), ans.id]);
  const updated = await db.dbGet(`SELECT a.*, u.username, u.display_name FROM answers a JOIN users u ON u.id=a.user_id WHERE a.id=?`, [ans.id]);
  res.json({ answer: updated });
});
app.delete('/api/answers/:id', requireAuth, async (req,res)=>{
  const db = await getDb();
  const ans = await db.dbGet(`SELECT * FROM answers WHERE id=?`, [req.params.id]);
  if(!ans) return res.status(404).json({ error:'Answer not found' });
  if(ans.user_id !== req.user.id && req.user.role!=='admin') return res.status(403).json({ error:'Not authorized' });
  await db.dbRun(`DELETE FROM answers WHERE id=?`, [ans.id]);
  await db.dbRun(`UPDATE challenges SET participant_count = (SELECT COUNT(*) FROM answers WHERE challenge_id=?) WHERE id=?`, [ans.challenge_id, ans.challenge_id]);
  res.json({ ok:true });
});
app.post('/api/answers/:id/vote', requireAuth, voteLimiter, async (req,res)=>{
  const db = await getDb();
  const answerId = req.params.id;
  const { value } = req.body;
  const val = value=== -1 ? -1 : 1;
  const ans = await db.dbGet(`SELECT * FROM answers WHERE id=?`, [answerId]);
  if(!ans) return res.status(404).json({ error:'Answer not found' });
  if(ans.user_id === req.user.id) return res.status(400).json({ error:'Cannot vote on your own answer' });
  const existing = await db.dbGet(`SELECT * FROM votes WHERE answer_id=? AND user_id=?`, [answerId, req.user.id]);
  if(existing){
    if(existing.value === val){
      await db.dbRun(`DELETE FROM votes WHERE id=?`, [existing.id]);
      await db.dbRun(`UPDATE answers SET vote_count = vote_count - ? WHERE id=?`, [val, answerId]);
      const updated = await db.dbGet(`SELECT vote_count FROM answers WHERE id=?`, [answerId]);
      return res.json({ vote_count: updated.vote_count, voted: false });
    } else {
      await db.dbRun(`UPDATE votes SET value=? WHERE id=?`, [val, existing.id]);
      await db.dbRun(`UPDATE answers SET vote_count = vote_count + ? WHERE id=?`, [val*2, answerId]);
      const updated = await db.dbGet(`SELECT vote_count FROM answers WHERE id=?`, [answerId]);
      return res.json({ vote_count: updated.vote_count, voted: true, value: val });
    }
  }
  await db.dbRun(`INSERT INTO votes (id, answer_id, user_id, value, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), answerId, req.user.id, val, nowIso()]);
  await db.dbRun(`UPDATE answers SET vote_count = vote_count + ? WHERE id=?`, [val, answerId]);
  await addXp(db, ans.user_id, 5, 'Received vote');
  await createNotification(db, ans.user_id, 'vote', 'Your answer received a vote', `Someone voted on your answer in challenge`, `/challenge/${ans.challenge_id}`);
  const updated = await db.dbGet(`SELECT vote_count FROM answers WHERE id=?`, [answerId]);
  res.json({ vote_count: updated.vote_count, voted: true });
});
app.post('/api/answers/:id/reply', requireAuth, writeLimiter, async (req,res)=>{
  const db = await getDb();
  const answerId = req.params.id;
  let { body } = req.body;
  body = sanitizeInput(body);
  if(!body || body.length<2 || body.length>500) return res.status(400).json({ error:'Reply 2-500 chars' });
  const ans = await db.dbGet(`SELECT * FROM answers WHERE id=?`, [answerId]);
  if(!ans) return res.status(404).json({ error:'Answer not found' });
  const id = uuidv4();
  await db.dbRun(`INSERT INTO replies (id, answer_id, user_id, body, created_at) VALUES (?,?,?,?,?)`, [id, answerId, req.user.id, body, nowIso()]);
  await addXp(db, req.user.id, 3, 'Replied to answer');
  if(ans.user_id !== req.user.id){ await createNotification(db, ans.user_id, 'reply', 'New reply to your answer', `${req.user.display_name} replied: ${body.slice(0,60)}`, `/challenge/${ans.challenge_id}`); }
  const reply = await db.dbGet(`SELECT r.*, u.username, u.display_name FROM replies r JOIN users u ON u.id=r.user_id WHERE r.id=?`, [id]);
  // bots may reply in thread too - schedule a follow-up bot reply for liveliness in same thread 15s later with low prob
  if(Math.random()<0.3){
    setTimeout(async ()=>{
      try{
        const bots = await getBots(await getDb());
        const bot = pickRandom(bots);
        if(bot.id===req.user.id) return;
        const existingBotReply = await (await getDb()).dbGet(`SELECT id FROM replies WHERE answer_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1`, [answerId, bot.id]);
        if(existingBotReply) return;
        const db2 = await getDb();
        const bbody = pickRandom(BOT_REPLY_POOL);
        await db2.dbRun(`INSERT INTO replies (id, answer_id, user_id, body, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), answerId, bot.id, bbody, nowIso()]);
        await createNotification(db2, req.user.id, 'reply', 'New reply in thread', `${bot.display_name} also replied in the same thread`, `/challenge/${ans.challenge_id}`);
      }catch{}
    }, 15000);
  }
  res.json({ reply });
});
app.get('/api/answers/:id/replies', async (req,res)=>{
  const db = await getDb();
  const replies = await db.dbAll(`SELECT r.*, u.username, u.display_name, u.role FROM replies r JOIN users u ON u.id=r.user_id WHERE r.answer_id=? ORDER BY r.created_at ASC LIMIT 50`, [req.params.id]);
  res.json({ replies });
});
app.get('/api/battles', async (req,res)=>{
  const db = await getDb();
  const status = req.query.status || 'active';
  const battles = await db.dbAll(`SELECT b.*, u.username as author FROM battles b LEFT JOIN users u ON u.id=b.created_by WHERE b.status=? ORDER BY b.created_at DESC LIMIT 20`, [status]);
  if(req.user){ for(const b of battles){ const v = await db.dbGet(`SELECT choice FROM battle_votes WHERE battle_id=? AND user_id=?`, [b.id, req.user.id]); b.myChoice = v ? v.choice : null; b.totalVotes = b.votes_a + b.votes_b; b.winRateA = b.totalVotes ? Math.round(b.votes_a/b.totalVotes*100) : 50; } }
  else { for(const b of battles){ b.totalVotes = b.votes_a + b.votes_b; b.winRateA = b.totalVotes ? Math.round(b.votes_a/b.totalVotes*100) : 50; } }
  res.json({ battles });
});
app.post('/api/battles', requireAuth, writeLimiter, async (req,res)=>{
  const db = await getDb();
  let { question, answer_a, answer_b } = req.body;
  question = sanitizeInput(question); answer_a = sanitizeInput(answer_a); answer_b = sanitizeInput(answer_b);
  if(!question || question.length<10 || question.length>200) return res.status(400).json({ error:'Question 10-200 chars' });
  if(!answer_a || answer_a.length<5 || answer_a.length>300) return res.status(400).json({ error:'Answer A 5-300 chars' });
  if(!answer_b || answer_b.length<5 || answer_b.length>300) return res.status(400).json({ error:'Answer B 5-300 chars' });
  const id = uuidv4();
  await db.dbRun(`INSERT INTO battles (id, question, answer_a, answer_b, created_by, created_at) VALUES (?,?,?,?,?,?)`, [id, question, answer_a, answer_b, req.user.id, nowIso()]);
  await addXp(db, req.user.id, 10, 'Created battle');
  const battle = await db.dbGet(`SELECT * FROM battles WHERE id=?`, [id]);
  res.json({ battle });
});
app.get('/api/battles/:id', async (req,res)=>{
  const db = await getDb();
  const b = await db.dbGet(`SELECT * FROM battles WHERE id=?`, [req.params.id]);
  if(!b) return res.status(404).json({ error:'Battle not found' });
  b.totalVotes = b.votes_a + b.votes_b; b.winRateA = b.totalVotes ? Math.round(b.votes_a/b.totalVotes*100) : 50;
  if(req.user){ const v = await db.dbGet(`SELECT choice FROM battle_votes WHERE battle_id=? AND user_id=?`, [b.id, req.user.id]); b.myChoice = v ? v.choice : null; }
  res.json({ battle: b });
});
app.post('/api/battles/:id/vote', requireAuth, voteLimiter, async (req,res)=>{
  const db = await getDb();
  const battleId = req.params.id;
  const { choice } = req.body;
  if(!['A','B'].includes(choice)) return res.status(400).json({ error:'Choice must be A or B' });
  const battle = await db.dbGet(`SELECT * FROM battles WHERE id=?`, [battleId]);
  if(!battle) return res.status(404).json({ error:'Battle not found' });
  const existing = await db.dbGet(`SELECT * FROM battle_votes WHERE battle_id=? AND user_id=?`, [battleId, req.user.id]);
  if(existing) return res.status(409).json({ error:'Already voted in this battle' });
  await db.dbRun(`INSERT INTO battle_votes (id, battle_id, user_id, choice, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), battleId, req.user.id, choice, nowIso()]);
  if(choice==='A') await db.dbRun(`UPDATE battles SET votes_a = votes_a + 1 WHERE id=?`, [battleId]);
  else await db.dbRun(`UPDATE battles SET votes_b = votes_b + 1 WHERE id=?`, [battleId]);
  await addXp(db, req.user.id, 5, 'Voted in battle');
  if(battle.created_by && battle.created_by !== req.user.id){ await createNotification(db, battle.created_by, 'battle', 'New vote on your battle', `Someone voted ${choice} on your battle`, `/battles`); }
  const updated = await db.dbGet(`SELECT * FROM battles WHERE id=?`, [battleId]);
  updated.totalVotes = updated.votes_a + updated.votes_b;
  res.json({ battle: updated });
});
app.get('/api/stories', async (req,res)=>{
  const db = await getDb();
  const stories = await db.dbAll(`SELECT s.*, u.username as author, u.display_name, (SELECT COUNT(*) FROM story_entries se WHERE se.story_id=s.id) as entry_count FROM stories s LEFT JOIN users u ON u.id=s.created_by ORDER BY s.created_at DESC LIMIT 20`);
  res.json({ stories });
});
app.post('/api/stories', requireAuth, writeLimiter, async (req,res)=>{
  const db = await getDb();
  let { title, starter } = req.body;
  title = sanitizeInput(title); starter = sanitizeInput(starter);
  if(!title || title.length<5 || title.length>80) return res.status(400).json({ error:'Title 5-80 chars' });
  if(!starter || starter.length<20 || starter.length>400) return res.status(400).json({ error:'Starter 20-400 chars' });
  const id = uuidv4();
  await db.dbRun(`INSERT INTO stories (id, title, starter, created_by, created_at) VALUES (?,?,?,?,?)`, [id, title, starter, req.user.id, nowIso()]);
  await addXp(db, req.user.id, 12, 'Started story');
  await updateStreak(db, req.user.id);
  const story = await db.dbGet(`SELECT * FROM stories WHERE id=?`, [id]);
  res.json({ story });
});
app.get('/api/stories/:id', async (req,res)=>{
  const db = await getDb();
  const story = await db.dbGet(`SELECT s.*, u.username, u.display_name FROM stories s LEFT JOIN users u ON u.id=s.created_by WHERE s.id=?`, [req.params.id]);
  if(!story) return res.status(404).json({ error:'Story not found' });
  const entries = await db.dbAll(`SELECT se.*, u.username, u.display_name, u.role, EXISTS(SELECT 1 FROM story_votes sv WHERE sv.entry_id=se.id AND sv.user_id=?) as hasVoted FROM story_entries se JOIN users u ON u.id=se.user_id WHERE se.story_id=? ORDER BY se.created_at ASC`, [req.user?.id||'', req.params.id]);
  res.json({ story, entries });
});
app.post('/api/stories/:id/entries', requireAuth, writeLimiter, async (req,res)=>{
  const db = await getDb();
  const storyId = req.params.id;
  let { body } = req.body;
  body = sanitizeInput(body);
  if(!body || body.length<10 || body.length>400) return res.status(400).json({ error:'Entry 10-400 chars' });
  const story = await db.dbGet(`SELECT * FROM stories WHERE id=?`, [storyId]);
  if(!story) return res.status(404).json({ error:'Story not found' });
  if(story.status==='finished') return res.status(400).json({ error:'Story is finished' });
  const id = uuidv4();
  await db.dbRun(`INSERT INTO story_entries (id, story_id, user_id, body, created_at) VALUES (?,?,?,?,?)`, [id, storyId, req.user.id, body, nowIso()]);
  await addXp(db, req.user.id, 8, 'Continued story');
  if(story.created_by && story.created_by !== req.user.id){ await createNotification(db, story.created_by, 'story', 'Your story has a new continuation', `${req.user.display_name} continued "${story.title}"`, `/stories/${storyId}`); }
  const entry = await db.dbGet(`SELECT se.*, u.username, u.display_name FROM story_entries se JOIN users u ON u.id=se.user_id WHERE se.id=?`, [id]);
  // bot may continue same story shortly
  if(Math.random()<0.4){
    setTimeout(async ()=>{
      try{
        const bots = await getBots(await getDb());
        const bot = pickRandom(bots);
        const bbody = pickRandom(BOT_STORY_POOL);
        const db2 = await getDb();
        await db2.dbRun(`INSERT INTO story_entries (id, story_id, user_id, body, created_at) VALUES (?,?,?,?,?)`, [uuidv4(), storyId, bot.id, bbody, nowIso()]);
      }catch{}
    }, 18000);
  }
  res.json({ entry });
});
app.post('/api/stories/entries/:id/vote', requireAuth, voteLimiter, async (req,res)=>{
  const db = await getDb();
  const entryId = req.params.id;
  const entry = await db.dbGet(`SELECT * FROM story_entries WHERE id=?`, [entryId]);
  if(!entry) return res.status(404).json({ error:'Entry not found' });
  const existing = await db.dbGet(`SELECT * FROM story_votes WHERE entry_id=? AND user_id=?`, [entryId, req.user.id]);
  if(existing) return res.status(409).json({ error:'Already voted' });
  await db.dbRun(`INSERT INTO story_votes (id, entry_id, user_id, created_at) VALUES (?,?,?,?)`, [uuidv4(), entryId, req.user.id, nowIso()]);
  await db.dbRun(`UPDATE story_entries SET vote_count = vote_count + 1 WHERE id=?`, [entryId]);
  await addXp(db, entry.user_id, 3, 'Story entry voted');
  const updated = await db.dbGet(`SELECT vote_count FROM story_entries WHERE id=?`, [entryId]);
  res.json({ vote_count: updated.vote_count });
});
app.post('/api/stories/:id/finish', requireAuth, async (req,res)=>{
  const db = await getDb();
  const story = await db.dbGet(`SELECT * FROM stories WHERE id=?`, [req.params.id]);
  if(!story) return res.status(404).json({ error:'Story not found' });
  if(story.created_by !== req.user.id && req.user.role!=='admin') return res.status(403).json({ error:'Only creator or admin can finish' });
  await db.dbRun(`UPDATE stories SET status='finished' WHERE id=?`, [story.id]);
  res.json({ ok:true });
});
app.get('/api/confessions', async (req,res)=>{
  const db = await getDb();
  const page = Math.max(1, parseInt(req.query.page||'1',10));
  const limit = Math.min(20, parseInt(req.query.limit||'10',10));
  const offset = (page-1)*limit;
  const confs = await db.dbAll(`SELECT id, body, created_at FROM confessions WHERE is_hidden=0 ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
  const total = await db.dbGet(`SELECT COUNT(*) as cnt FROM confessions WHERE is_hidden=0`);
  res.json({ confessions: confs, total: total.cnt, page, limit });
});
app.post('/api/confessions', requireAuth, writeLimiter, async (req,res)=>{
  const db = await getDb();
  let { body } = req.body;
  body = sanitizeInput(body);
  if(!body || body.length<10 || body.length>600) return res.status(400).json({ error:'Confession 10-600 chars' });
  const id = uuidv4();
  await db.dbRun(`INSERT INTO confessions (id, body, user_id, created_at) VALUES (?,?,?,?)`, [id, body, req.user.id, nowIso()]);
  await addXp(db, req.user.id, 5, 'Shared confession');
  const conf = await db.dbGet(`SELECT id, body, created_at FROM confessions WHERE id=?`, [id]);
  res.json({ confession: conf });
});
app.get('/api/random', requireAuth, async (req,res)=>{
  const db = await getDb();
  const answeredIds = await db.dbAll(`SELECT challenge_id FROM answers WHERE user_id=? ORDER BY created_at DESC LIMIT 20`, [req.user.id]);
  const exclude = answeredIds.map(r=>r.challenge_id);
  let sql = `SELECT * FROM challenges WHERE status='active'`;
  let params = [];
  if(exclude.length){ sql += ` AND id NOT IN (${exclude.map(()=>'?').join(',')})`; params.push(...exclude); }
  sql += ` ORDER BY RANDOM() LIMIT 1`;
  let ch = await db.dbGet(sql, params);
  if(!ch){ ch = await db.dbGet(`SELECT * FROM challenges ORDER BY RANDOM() LIMIT 1`); }
  if(!ch) return res.status(404).json({ error:'No challenges' });
  res.json({ challenge: ch });
});
app.get('/api/notifications', requireAuth, async (req,res)=>{
  const db = await getDb();
  const notifs = await db.dbAll(`SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30`, [req.user.id]);
  const unread = await db.dbGet(`SELECT COUNT(*) as cnt FROM notifications WHERE user_id=? AND is_read=0`, [req.user.id]);
  res.json({ notifications: notifs, unread: unread.cnt });
});
app.post('/api/notifications/:id/read', requireAuth, async (req,res)=>{
  const db = await getDb();
  const n = await db.dbGet(`SELECT * FROM notifications WHERE id=? AND user_id=?`, [req.params.id, req.user.id]);
  if(!n) return res.status(404).json({ error:'Not found' });
  await db.dbRun(`UPDATE notifications SET is_read=1 WHERE id=?`, [n.id]);
  res.json({ ok:true });
});
app.post('/api/notifications/read-all', requireAuth, async (req,res)=>{
  const db = await getDb();
  await db.dbRun(`UPDATE notifications SET is_read=1 WHERE user_id=?`, [req.user.id]);
  res.json({ ok:true });
});
app.get('/api/personality/me', requireAuth, async (req,res)=>{
  const db = await getDb();
  const answers = await db.dbAll(`SELECT c.category, COUNT(*) as cnt FROM answers a JOIN challenges c ON c.id=a.challenge_id WHERE a.user_id=? GROUP BY c.category`, [req.user.id]);
  const total = answers.reduce((s,a)=>s+a.cnt,0);
  if(total <3){ return res.json({ personality: null, reason: 'Answer at least 3 challenges to reveal your entertainment profile', stats: answers }); }
  const categories = {}; answers.forEach(a=>categories[a.category]=a.cnt);
  let sorted = Object.entries(categories).sort((a,b)=>b[1]-a[1]);
  let top = sorted[0][0];
  let map = {
    'Logic': { type:'Strategist', desc:'You approach hypothetical worlds like puzzles to be solved. You look for structure, trade-offs, and the move that actually works.', traits:['Analytical','Systems thinker','Calm under pressure'] },
    'Humor': { type:'Comedian', desc:'You turn every scenario into material. Your answers make people pause and laugh before they think.', traits:['Witty','Observant','Timing'] },
    'Debate': { type:'Debater', desc:'You love a clear stance and a sharp argument. You defend ideas with evidence and enjoy respectful opposition.', traits:['Persuasive','Principled','Direct'] },
    'Fictional situations': { type:'Creative Thinker', desc:'You build worlds quickly and fill them with plausible detail. Your imagination is your strongest tool.', traits:['Imaginative','World-builder','Curious'] },
    'What If scenarios': { type:'Visionary', desc:'You explore consequences few consider. You ask what happens next, then what happens after that.', traits:['Forward-thinking','Thoughtful','Adept at what-ifs'] },
    'Relationships': { type:'Empath', desc:'You center people and dynamics. Your answers show nuance in how we connect and misunderstand each other.', traits:['Emotionally attuned','Listener','Connector'] },
    'School and everyday life': { type:'Storyteller', desc:'You make the ordinary memorable. You find narrative in cafeterias and bus stops.', traits:['Relatable','Detailed','Grounded'] },
    'Opinion': { type:'Debater', desc:'You have a point of view and you own it. You invite others to agree or challenge you.', traits:['Opinionated','Clear','Engaging'] },
    'Random scenarios': { type:'Explorer', desc:'You thrive on the unexpected. Randomness is your prompt and surprise is your style.', traits:['Adaptable','Spontaneous','Playful'] },
  };
  let personality = map[top] || map['What If scenarios'];
  const storyCount = await db.dbGet(`SELECT COUNT(*) as c FROM story_entries WHERE user_id=?`, [req.user.id]);
  if(storyCount.c > 2 && personality.type !== 'Storyteller'){ if(storyCount.c >= total/2) personality = map['School and everyday life']; }
  const votes = await db.dbGet(`SELECT COALESCE(SUM(vote_count),0) as sum FROM answers WHERE user_id=?`, [req.user.id]);
  res.json({ personality: { ...personality, topCategory: top, totalAnswers: total, votesReceived: votes.sum }, stats: answers, disclaimer: 'Entertainment only. Not a psychological diagnosis.' });
});
app.get('/api/explore', async (req,res)=>{
  const db = await getDb();
  const trending = await db.dbAll(`SELECT c.*, (SELECT COUNT(*) FROM answers WHERE challenge_id=c.id) as pc FROM challenges c ORDER BY pc DESC LIMIT 6`);
  const popularAnswers = await db.dbAll(`SELECT a.*, u.username, u.display_name, c.title as challenge_title, c.id as challenge_id FROM answers a JOIN users u ON u.id=a.user_id JOIN challenges c ON c.id=a.challenge_id ORDER BY a.vote_count DESC LIMIT 5`);
  const activeBattles = await db.dbAll(`SELECT * FROM battles ORDER BY (votes_a+votes_b) DESC LIMIT 3`);
  const popularStories = await db.dbAll(`SELECT s.*, (SELECT COUNT(*) FROM story_entries se WHERE se.story_id=s.id) as entries FROM stories s ORDER BY entries DESC LIMIT 3`);
  const categories = await db.dbAll(`SELECT category, COUNT(*) as cnt FROM challenges GROUP BY category`);
  res.json({ trending, popularAnswers, activeBattles, popularStories, categories });
});
app.get('/api/search', async (req,res)=>{
  const db = await getDb();
  const q = sanitizeInput(req.query.q || '');
  if(!q || q.length<2) return res.json({ challenges: [], answers: [] });
  const like = `%${q}%`;
  const challenges = await db.dbAll(`SELECT * FROM challenges WHERE title LIKE ? OR description LIKE ? LIMIT 10`, [like, like]);
  const answers = await db.dbAll(`SELECT a.*, u.username, c.title as challenge_title FROM answers a JOIN users u ON u.id=a.user_id JOIN challenges c ON c.id=a.challenge_id WHERE a.body LIKE ? LIMIT 10`, [like]);
  res.json({ challenges, answers });
});
app.post('/api/reports', requireAuth, writeLimiter, async (req,res)=>{
  const db = await getDb();
  let { target_type, target_id, reason } = req.body;
  target_type = sanitizeInput(target_type); target_id = sanitizeInput(target_id); reason = sanitizeInput(reason);
  const allowed = ['challenge','answer','reply','confession','user','battle','story'];
  if(!allowed.includes(target_type)) return res.status(400).json({ error:'Invalid target type' });
  if(!target_id || !reason || reason.length<10 || reason.length>500) return res.status(400).json({ error:'Reason 10-500 chars' });
  const exists = await db.dbGet(`SELECT id FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status='pending'`, [req.user.id, target_type, target_id]);
  if(exists) return res.status(409).json({ error:'You already reported this' });
  const id = uuidv4();
  await db.dbRun(`INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status, created_at) VALUES (?,?,?,?,?,?,?)`, [id, req.user.id, target_type, target_id, reason, 'pending', nowIso()]);
  res.json({ ok:true });
});
app.get('/api/admin/stats', requireAuth, requireAdmin, async (req,res)=>{
  const db = await getDb();
  const users = await db.dbGet(`SELECT COUNT(*) as cnt FROM users`);
  const activeUsers = await db.dbGet(`SELECT COUNT(*) as cnt FROM users WHERE last_active_date > ?`, [new Date(Date.now()-7*86400000).toISOString()]);
  const challenges = await db.dbGet(`SELECT COUNT(*) as cnt FROM challenges`);
  const answers = await db.dbGet(`SELECT COUNT(*) as cnt FROM answers`);
  const reports = await db.dbGet(`SELECT COUNT(*) as cnt FROM reports WHERE status='pending'`);
  const battles = await db.dbGet(`SELECT COUNT(*) as cnt FROM battles`);
  const stories = await db.dbGet(`SELECT COUNT(*) as cnt FROM stories`);
  const confessions = await db.dbGet(`SELECT COUNT(*) as cnt FROM confessions`);
  res.json({ users: users.cnt, activeUsers: activeUsers.cnt, challenges: challenges.cnt, answers: answers.cnt, pendingReports: reports.cnt, battles: battles.cnt, stories: stories.cnt, confessions: confessions.cnt });
});
app.get('/api/admin/reports', requireAuth, requireAdmin, async (req,res)=>{
  const db = await getDb();
  const reports = await db.dbAll(`SELECT r.*, u.username as reporter FROM reports r JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 50`);
  res.json({ reports });
});
app.post('/api/admin/reports/:id/action', requireAuth, requireAdmin, async (req,res)=>{
  const db = await getDb();
  const { action, reason } = req.body;
  const report = await db.dbGet(`SELECT * FROM reports WHERE id=?`, [req.params.id]);
  if(!report) return res.status(404).json({ error:'Report not found' });
  if(!['dismiss','remove','suspend','restore'].includes(action)) return res.status(400).json({ error:'Invalid action' });
  await db.dbRun(`UPDATE reports SET status=?, reviewed_by=?, reviewed_at=? WHERE id=?`, [action==='dismiss'?'dismissed':'resolved', req.user.id, nowIso(), report.id]);
  await db.dbRun(`INSERT INTO moderation_actions (id, admin_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)`, [uuidv4(), req.user.id, action, report.target_type, report.target_id, sanitizeInput(reason||''), nowIso()]);
  if(action==='remove'){
    if(report.target_type==='answer') await db.dbRun(`DELETE FROM answers WHERE id=?`, [report.target_id]);
    else if(report.target_type==='confession') await db.dbRun(`UPDATE confessions SET is_hidden=1 WHERE id=?`, [report.target_id]);
    else if(report.target_type==='challenge') await db.dbRun(`UPDATE challenges SET status='hidden' WHERE id=?`, [report.target_id]);
    else if(report.target_type==='reply') await db.dbRun(`DELETE FROM replies WHERE id=?`, [report.target_id]);
  } else if(action==='restore'){
    if(report.target_type==='confession') await db.dbRun(`UPDATE confessions SET is_hidden=0 WHERE id=?`, [report.target_id]);
    if(report.target_type==='challenge') await db.dbRun(`UPDATE challenges SET status='active' WHERE id=?`, [report.target_id]);
  } else if(action==='suspend'){ await db.dbRun(`UPDATE users SET role='suspended' WHERE id=?`, [report.target_id]); }
  res.json({ ok:true });
});
app.get('/api/admin/users', requireAuth, requireAdmin, async (req,res)=>{
  const db = await getDb();
  const users = await db.dbAll(`SELECT id, username, display_name, bio, role, xp, level, created_at FROM users ORDER BY created_at DESC LIMIT 50`);
  res.json({ users });
});
app.get('/api/admin/challenges', requireAuth, requireAdmin, async (req,res)=>{
  const db = await getDb();
  const ch = await db.dbAll(`SELECT c.*, u.username FROM challenges c LEFT JOIN users u ON u.id=c.created_by ORDER BY c.created_at DESC LIMIT 50`);
  res.json({ challenges: ch });
});
app.delete('/api/admin/challenges/:id', requireAuth, requireAdmin, async (req,res)=>{ const db = await getDb(); await db.dbRun(`DELETE FROM challenges WHERE id=?`, [req.params.id]); res.json({ ok:true }); });
app.delete('/api/admin/answers/:id', requireAuth, requireAdmin, async (req,res)=>{ const db = await getDb(); await db.dbRun(`DELETE FROM answers WHERE id=?`, [req.params.id]); res.json({ ok:true }); });
app.get('/api/admin/moderation-log', requireAuth, requireAdmin, async (req,res)=>{ const db = await getDb(); const logs = await db.dbAll(`SELECT m.*, u.username as admin FROM moderation_actions m JOIN users u ON u.id=m.admin_id ORDER BY m.created_at DESC LIMIT 50`); res.json({ logs }); });

// Bot status for public curiosity
app.get('/api/bots/status', async (req,res)=>{
  const db = await getDb();
  const bots = await db.dbAll(`SELECT username, display_name, bio, role, xp, level, streak_count FROM users WHERE role='bot' ORDER BY xp DESC`);
  const recent = await db.dbAll(`SELECT a.body, a.created_at, u.display_name, u.username, c.title as challenge_title FROM answers a JOIN users u ON u.id=a.user_id JOIN challenges c ON c.id=a.challenge_id WHERE u.role='bot' ORDER BY a.created_at DESC LIMIT 6`);
  res.json({ bots, recentActivity: recent });
});

app.get('/api/health', (_req,res)=> res.json({ status: 'ok' }));

function configureAppRuntime(options = {}){
  if(typeof options.backgroundTasks === 'boolean') backgroundTasksEnabled = options.backgroundTasks;
  if(typeof options.secureCookies === 'boolean') secureCookies = options.secureCookies;
}

export { app, seed, botActivityTick, configureAppRuntime };
