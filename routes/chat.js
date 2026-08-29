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

// ---------- Free/backup AI providers, used if every AWS Bedrock key fails ----------
// Generic helper: works with any OpenAI-compatible chat completions endpoint,
// which includes OpenAI itself and Google's Gemini API (Gemini's free tier
// needs no credit card - see https://aistudio.google.com/apikey).
async function callOpenAICompatible(bedrockMessages, { baseUrl, apiKey, model }) {
  const chatMessages = [
    { role: 'system', content: 'You are ZyreX, a helpful AI assistant. Format code in markdown code blocks with the correct language tag so it can be copied easily.' },
    ...bedrockMessages.map(m => ({
      role: m.role,
      content: m.content.map(c => c.text).join('\n')
    }))
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // don't hang forever if the provider is unreachable
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: chatMessages,
        max_tokens: 4096,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`API error (${res.status}): ${errBody.slice(0, 300)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '(no response)';
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out after 25s');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Fallback providers, tried in this order after all AWS Bedrock keys fail.
// Gemini is listed first because its free tier needs no credit card.
const FALLBACK_PROVIDERS = [];
if (process.env.GEMINI_API_KEY) {
  FALLBACK_PROVIDERS.push({
    label: 'Gemini (free)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash'
  });
}
if (process.env.OPENAI_API_KEY) {
  FALLBACK_PROVIDERS.push({
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  });
}

// ---------- Image generation (Gemini "Nano Banana" - free, reuses GEMINI_API_KEY) ----------
async function callGeminiImage(prompt) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Image generation needs GEMINI_API_KEY set in .env');
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Gemini image API error (${res.status}): ${errBody.slice(0, 300)}`);
    }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData);
    const textPart = parts.find(p => p.text);
    if (!imagePart) throw new Error('Gemini did not return an image (it may have declined the prompt)');
    return {
      base64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || 'image/png',
      caption: textPart?.text || ''
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Image generation timed out after 30s');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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
  const { content, webSearch, generateImage } = req.body;
  const chat = db.prepare('SELECT * FROM chats WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  if (chat.is_suspended) return res.status(403).json({ error: 'This chat has been suspended' });

  db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)').run(chat.id, 'user', content);

  if (chat.title === 'New Chat') {
    const shortTitle = content.slice(0, 40) + (content.length > 40 ? '...' : '');
    db.prepare('UPDATE chats SET title=? WHERE id=?').run(shortTitle, chat.id);
  }

  // ---- Image generation path (separate from the text-chat path below) ----
  if (generateImage) {
    try {
      const img = await callGeminiImage(content);
      const ext = img.mimeType.includes('png') ? 'png' : 'jpg';
      const filename = `${uuidv4()}.${ext}`;
      fs.writeFileSync(path.join(__dirname, '..', 'generated', filename), Buffer.from(img.base64, 'base64'));
      const imageUrl = `/generated/${filename}`;
      const replyText = img.caption || 'Here is your generated image.';

      db.prepare('INSERT INTO messages (chat_id, role, content, attachment_path) VALUES (?, ?, ?, ?)')
        .run(chat.id, 'assistant', replyText, imageUrl);
      db.prepare(`UPDATE chats SET updated_at=datetime('now') WHERE id=?`).run(chat.id);

      return res.json({ reply: replyText, imageUrl });
    } catch (err) {
      console.error('Image generation error:', err);
      const errText = 'Error: Image generation failed: ' + err.message;
      db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)').run(chat.id, 'assistant', errText);
      db.prepare(`UPDATE chats SET updated_at=datetime('now') WHERE id=?`).run(chat.id);
      return res.status(500).json({ error: 'Image generation failed: ' + err.message });
    }
  }

  const history = db.prepare('SELECT role, content FROM messages WHERE chat_id=? ORDER BY id ASC').all(chat.id);
  const bedrockMessages = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: [{ text: m.content }]
  }));

  try {
    if (BEDROCK_KEYS.length === 0 && FALLBACK_PROVIDERS.length === 0) {
      throw new Error('No AI provider is configured (set AWS_BEARER_TOKEN_BEDROCK or GEMINI_API_KEY in .env)');
    }

    const commandInput = {
      modelId: MODEL_ID,
      messages: bedrockMessages,
      system: [{ text: 'You are ZyreX, a helpful AI assistant. Format code in markdown code blocks with the correct language tag so it can be copied easily.' }],
      inferenceConfig: { maxTokens: 4096, temperature: 0.7 }
    };
    // Optional server-side web search tool (Bedrock only - not used on fallback providers).
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

    // 2. If every AWS key failed (or none were configured), try fallback providers in order.
    if (reply === null) {
      for (const provider of FALLBACK_PROVIDERS) {
        try {
          console.error(`Falling back to ${provider.label}...`);
          reply = await callOpenAICompatible(bedrockMessages, provider);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.error(`${provider.label} fallback failed:`, err.message);
        }
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
