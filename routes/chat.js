const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  if (!user || user.is_suspended) return res.status(403).json({ error: 'Account suspended' });
  req.user = user;
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
  }),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// ---------- AWS Bedrock: primary key + optional fallback key ----------
// If AWS_BEARER_TOKEN_BEDROCK_2 is set, and the primary key fails for any
// reason (expired, rate-limited, no access, etc), we automatically retry the
// same request with the second key before giving up.
// The Bedrock SDK reads its auth token from the AWS_BEARER_TOKEN_BEDROCK
// env var at call time, so to try a second key we set that env var to each
// candidate key in turn (this happens per-request, on the server only).
const BEDROCK_KEYS = [process.env.AWS_BEARER_TOKEN_BEDROCK, process.env.AWS_BEARER_TOKEN_BEDROCK_2]
  .filter(Boolean);

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0';

// ---------- OpenAI: used as a fallback if every AWS Bedrock key fails ----------
// Uses Node's built-in fetch, no extra npm package needed.
async function callOpenAI(bedrockMessages) {
  if (!process.env.OPENAI_API_KEY) throw new Error('No OPENAI_API_KEY configured');

  const openaiMessages = [
    { role: 'system', content: 'You are ZyreX, a helpful AI assistant. Format code in markdown code blocks with the correct language tag so it can be copied easily.' },
    ...bedrockMessages.map(m => ({
      role: m.role,
      content: m.content.map(c => c.text).join('\n')
    }))
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: openaiMessages,
      max_tokens: 4096,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI API error (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '(no response)';
}

// ---------- Chats CRUD ----------
router.get('/chats', requireAuth, (req, res) => {
  const chats = db.prepare('SELECT * FROM chats WHERE user_id=? AND is_suspended=0 ORDER BY updated_at DESC').all(req.user.id);
  res.json({ chats });
});

router.post('/chats', requireAuth, (req, res) => {
  const info = db.prepare('INSERT INTO chats (user_id, title) VALUES (?, ?)').run(req.user.id, 'New Chat');
  res.json({ id: info.lastInsertRowid, title: 'New Chat' });
});

router.patch('/chats/:id', requireAuth, (req, res) => {
  const { title } = req.body;
  const chat = db.prepare('SELECT * FROM chats WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE chats SET title=? WHERE id=?').run(title, chat.id);
  res.json({ ok: true });
});

router.delete('/chats/:id', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM chats WHERE id=?').run(chat.id);
  res.json({ ok: true });
});

router.get('/chats/:id/messages', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  const messages = db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY id ASC').all(chat.id);
  res.json({ messages });
});

// ---------- Send message to AI ----------
router.post('/chats/:id/messages', requireAuth, async (req, res) => {
  const { content, webSearch } = req.body;
  const chat = db.prepare('SELECT * FROM chats WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  if (chat.is_suspended) return res.status(403).json({ error: 'This chat has been suspended' });

  db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)').run(chat.id, 'user', content);

  if (chat.title === 'New Chat') {
    const shortTitle = content.slice(0, 40) + (content.length > 40 ? '...' : '');
    db.prepare('UPDATE chats SET title=? WHERE id=?').run(shortTitle, chat.id);
  }

  const history = db.prepare('SELECT role, content FROM messages WHERE chat_id=? ORDER BY id ASC').all(chat.id);
  const bedrockMessages = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: [{ text: m.content }]
  }));

  try {
    if (BEDROCK_KEYS.length === 0 && !process.env.OPENAI_API_KEY) {
      throw new Error('No AI provider is configured (set AWS_BEARER_TOKEN_BEDROCK or OPENAI_API_KEY in .env)');
    }

    const commandInput = {
      modelId: MODEL_ID,
      messages: bedrockMessages,
      system: [{ text: 'You are ZyreX, a helpful AI assistant. Format code in markdown code blocks with the correct language tag so it can be copied easily.' }],
      inferenceConfig: { maxTokens: 4096, temperature: 0.7 }
    };
    // Optional server-side web search tool (Bedrock only - not used on the OpenAI fallback).
    if (webSearch) {
      commandInput.toolConfig = {
        tools: [{ toolSpec: { name: 'web_search', description: 'Search the web for current information', inputSchema: { json: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } } }]
      };
    }
    const command = new ConverseCommand(commandInput);

    let reply = null;
    let lastErr = null;

    // 1. Try each configured AWS Bedrock key in order.
    for (let i = 0; i < BEDROCK_KEYS.length; i++) {
      process.env.AWS_BEARER_TOKEN_BEDROCK = BEDROCK_KEYS[i];
      const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
      try {
        const response = await client.send(command);
        reply = response.output?.message?.content?.map(c => c.text).filter(Boolean).join('\n') || '(no response)';
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`Bedrock request failed using key #${i + 1}:`, err.message);
      }
    }

    // 2. If every AWS key failed (or none were configured), fall back to OpenAI.
    if (reply === null && process.env.OPENAI_API_KEY) {
      try {
        console.error('Falling back to OpenAI...');
        reply = await callOpenAI(bedrockMessages);
        lastErr = null;
      } catch (err) {
        lastErr = err;
        console.error('OpenAI fallback also failed:', err.message);
      }
    }

    if (reply === null) throw lastErr;

    db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)').run(chat.id, 'assistant', reply);
    db.prepare(`UPDATE chats SET updated_at=datetime('now') WHERE id=?`).run(chat.id);

    res.json({ reply });
  } catch (err) {
    console.error('AI error:', err);
    const errText = 'Error: AI request failed: ' + err.message;
    db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)').run(chat.id, 'assistant', errText);
    db.prepare(`UPDATE chats SET updated_at=datetime('now') WHERE id=?`).run(chat.id);
    res.status(500).json({ error: 'AI request failed: ' + err.message });
  }
});

// ---------- File upload (attach to chat) ----------
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, path: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

// ---------- Generate downloadable file from AI text ----------
router.post('/generate-file', requireAuth, (req, res) => {
  const { content, filename } = req.body;
  if (!content) return res.status(400).json({ error: 'No content provided' });
  const safeName = (filename || 'zyrex-output.txt').replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalName = `${uuidv4()}-${safeName}`;
  fs.writeFileSync(path.join(__dirname, '..', 'generated', finalName), content, 'utf8');
  res.json({ ok: true, url: `/generated/${finalName}`, name: safeName });
});

module.exports = router;
