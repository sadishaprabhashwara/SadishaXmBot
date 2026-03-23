/**
 * MemoryManager.js — Conversation History Buffer
 * ─────────────────────────────────────────────────────────────
 * Stores the last N exchanges per user.
 * Backed by an in-memory LRU cache with optional Redis persistence.
 *
 * Schema per entry:
 *  { role: 'user'|'assistant', content: string, ts: number }
 */

'use strict';

const HISTORY_LIMIT = 15;         // max turns kept per user
const TTL_MS = 60 * 60 * 1000;   // 1 hour idle expiry

// Simple in-process store (swap for Redis in production)
const store = new Map();

/**
 * Get conversation history for a user (oldest → newest)
 * @param {string} userId
 * @returns {Array<{role, content}>}
 */
async function getHistory(userId) {
  const entry = store.get(userId);
  if (!entry) return [];
  return entry.messages.map(({ role, content }) => ({ role, content }));
}

/**
 * Append a new turn to the user's history, evicting oldest if over limit.
 * @param {string} userId
 * @param {{ role: string, content: string }} turn
 */
async function append(userId, turn) {
  let entry = store.get(userId);

  if (!entry) {
    entry = { messages: [], updatedAt: Date.now() };
    store.set(userId, entry);
  }

  entry.messages.push({ ...turn, ts: Date.now() });
  entry.updatedAt = Date.now();

  // Evict oldest messages beyond limit (keep pairs: user+assistant)
  while (entry.messages.length > HISTORY_LIMIT * 2) {
    entry.messages.shift();
  }
}

/**
 * Clear history for a user (e.g., user says "reset" or "clear chat")
 * @param {string} userId
 */
async function clear(userId) {
  store.delete(userId);
}

/**
 * Prune idle sessions (call on a timer or background job)
 */
function pruneIdle() {
  const now = Date.now();
  for (const [userId, entry] of store.entries()) {
    if (now - entry.updatedAt > TTL_MS) {
      store.delete(userId);
    }
  }
}

// Auto-prune every 30 minutes
setInterval(pruneIdle, 30 * 60 * 1000);

module.exports = { getHistory, append, clear };
