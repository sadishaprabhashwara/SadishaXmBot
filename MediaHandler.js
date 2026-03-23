/**
 * MediaHandler.js — Media Download / Upload / Extraction
 * ─────────────────────────────────────────────────────────────
 * Handles: Images, Audio (PTTs), Documents (PDFs), Stickers
 * Converts raw Baileys message objects into a unified Content object.
 */

'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const Logger = require('../utils/logger');

/**
 * Unified Content Object returned by extractContent()
 * @typedef {Object} Content
 * @property {'text'|'image'|'audio'|'document'|'sticker'} type
 * @property {string|null}  text      - text body or caption
 * @property {Buffer|null}  buffer    - raw media bytes
 * @property {string|null}  mimetype
 * @property {string|null}  fileName  - for documents
 */

/**
 * Extract content from any incoming message type.
 * @param {Object} msg - Baileys message object
 * @returns {Promise<Content|null>}
 */
async function extractContent(msg) {
  const m = msg.message;
  if (!m) return null;

  // ── Plain text ────────────────────────────────────────────
  if (m.conversation || m.extendedTextMessage) {
    return {
      type    : 'text',
      text    : m.conversation ?? m.extendedTextMessage?.text ?? '',
      buffer  : null,
      mimetype: null,
      fileName: null,
    };
  }

  // ── Image ─────────────────────────────────────────────────
  if (m.imageMessage) {
    const buffer = await safeDownload(msg);
    return {
      type    : 'image',
      text    : m.imageMessage.caption ?? null,
      buffer,
      mimetype: m.imageMessage.mimetype ?? 'image/jpeg',
      fileName: null,
    };
  }

  // ── Audio / PTT (Voice note) ───────────────────────────────
  if (m.audioMessage) {
    const buffer = await safeDownload(msg);
    return {
      type    : 'audio',
      text    : null,
      buffer,
      mimetype: m.audioMessage.mimetype ?? 'audio/ogg',
      fileName: null,
      isPTT   : m.audioMessage.ptt ?? false,
    };
  }

  // ── Document / PDF ────────────────────────────────────────
  if (m.documentMessage) {
    const buffer = await safeDownload(msg);
    return {
      type    : 'document',
      text    : m.documentMessage.caption ?? null,
      buffer,
      mimetype: m.documentMessage.mimetype ?? 'application/octet-stream',
      fileName: m.documentMessage.fileName ?? 'document',
    };
  }

  // ── Sticker ───────────────────────────────────────────────
  if (m.stickerMessage) {
    return {
      type    : 'sticker',
      text    : null,
      buffer  : null,
      mimetype: m.stickerMessage.mimetype ?? 'image/webp',
      fileName: null,
    };
  }

  // ── Unsupported type ──────────────────────────────────────
  Logger.debug('[MediaHandler] Unsupported message type:', Object.keys(m));
  return null;
}

/**
 * Safe wrapper around Baileys downloadMediaMessage
 * @param {Object} msg
 * @returns {Promise<Buffer|null>}
 */
async function safeDownload(msg) {
  try {
    return await downloadMediaMessage(msg, 'buffer', {});
  } catch (err) {
    Logger.error('[MediaHandler] Download failed:', err.message);
    return null;
  }
}

/**
 * Convert a local file buffer to a sendable Baileys media object.
 * @param {Buffer} buffer
 * @param {'image'|'audio'|'document'} type
 * @param {Object} options - mimetype, fileName, caption
 */
function prepareOutgoing(buffer, type, options = {}) {
  return {
    type,
    buffer,
    mimetype: options.mimetype ?? defaultMime(type),
    fileName: options.fileName ?? null,
    caption : options.caption ?? null,
  };
}

function defaultMime(type) {
  const map = { image: 'image/jpeg', audio: 'audio/mp4', document: 'application/pdf' };
  return map[type] ?? 'application/octet-stream';
}

module.exports = { extractContent, prepareOutgoing };
