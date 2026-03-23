/**
 * ============================================================
 *  MODULAR AI WHATSAPP BOT — MVP SKELETON
 *  Stack : Node.js + Baileys + Claude (Anthropic) / GPT
 *  Author: Generated Architecture
 * ============================================================
 */

'use strict';

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino   = require('pino');
const path   = require('path');

// ── Core Services ────────────────────────────────────────────
const RouterEngine   = require('./src/core/RouterEngine');
const MemoryManager  = require('./src/core/MemoryManager');
const MediaHandler   = require('./src/core/MediaHandler');
const SessionManager = require('./src/core/SessionManager');
const Logger         = require('./src/utils/logger');

// ── Boot ─────────────────────────────────────────────────────
async function startBot() {
  Logger.info('🚀 Booting Modular AI WhatsApp Bot...');

  const { state, saveCreds } = await useMultiFileAuthState(
    path.resolve(__dirname, 'data/auth')
  );

  const sock = makeWASocket({
    logger        : pino({ level: 'silent' }),   // suppress Baileys noise
    auth          : state,
    printQRInTerminal: true,
    getMessage    : async (key) => ({ conversation: '' }),
  });

  // ── Persist credentials on update ──────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Connection State Machine ────────────────────────────────
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      Logger.warn(`Connection closed. Reconnect: ${shouldReconnect}`);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      Logger.info('✅ WhatsApp connection established.');
    }
  });

  // ── Incoming Message Handler ────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;          // ignore own messages
      if (!msg.message)   continue;          // ignore empty slots

      try {
        await handleIncomingMessage(sock, msg);
      } catch (err) {
        Logger.error('Message handling error:', err);
      }
    }
  });
}

// ── Core Message Pipeline ────────────────────────────────────
async function handleIncomingMessage(sock, msg) {
  const jid       = msg.key.remoteJid;                    // sender identifier
  const isGroup   = jid.endsWith('@g.us');
  const senderId  = isGroup ? msg.key.participant : jid;

  // ── 1. Extract content (text / media / audio) ──────────────
  const content = await MediaHandler.extractContent(msg);
  if (!content) return;                                   // unsupported type, skip

  Logger.info(`📩 [${senderId}] ${content.type}: ${content.text ?? '[media]'}`);

  // ── 2. Session & Memory hydration ──────────────────────────
  const session = await SessionManager.getOrCreate(senderId);
  const history = await MemoryManager.getHistory(senderId);   // last 15 turns

  // ── 3. "Typing..." indicator ────────────────────────────────
  await sock.sendPresenceUpdate('composing', jid);

  // ── 4. Route through LLM Brain ─────────────────────────────
  const routerResult = await RouterEngine.route({
    userMessage : content,
    history,
    session,
    senderId,
  });

  // ── 5. Execute action & collect reply ──────────────────────
  const reply = await routerResult.execute();

  // ── 6. Persist this exchange in memory ─────────────────────
  await MemoryManager.append(senderId, {
    role   : 'user',
    content: content.text ?? `[${content.type}]`,
  });
  await MemoryManager.append(senderId, {
    role   : 'assistant',
    content: reply.text,
  });

  // ── 7. Send reply ──────────────────────────────────────────
  await sendReply(sock, jid, reply);
}

// ── Polymorphic Reply Sender ─────────────────────────────────
async function sendReply(sock, jid, reply) {
  switch (reply.type) {
    case 'text':
      await sock.sendMessage(jid, { text: reply.text });
      break;

    case 'image':
      await sock.sendMessage(jid, {
        image  : reply.buffer,
        caption: reply.caption ?? '',
      });
      break;

    case 'audio':
      await sock.sendMessage(jid, {
        audio : reply.buffer,
        mimetype: 'audio/mp4',
        ptt   : true,                   // send as voice note
      });
      break;

    case 'document':
      await sock.sendMessage(jid, {
        document : reply.buffer,
        mimetype : reply.mimetype,
        fileName : reply.fileName,
      });
      break;

    case 'buttons':
      await sock.sendMessage(jid, {
        text   : reply.text,
        buttons: reply.buttons,
        footer : '🤖 Powered by AI',
      });
      break;

    default:
      await sock.sendMessage(jid, { text: reply.text ?? '⚠️ Unknown response type.' });
  }
}

// ── Entrypoint ───────────────────────────────────────────────
startBot().catch((err) => {
  Logger.error('Fatal boot error:', err);
  process.exit(1);
});
