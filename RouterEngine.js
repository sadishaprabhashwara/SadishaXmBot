/**
 * RouterEngine.js — The LLM Brain
 * ─────────────────────────────────────────────────────────────
 * Uses Claude (or GPT) with Tool/Function Calling to decide WHICH
 * module handles the request, instead of fragile if-else chains.
 *
 * Flow:
 *   User message → LLM with tools defined → LLM picks tool (or none)
 *   → Dispatch to correct Module → return unified Reply object
 */

'use strict';

const Anthropic  = require('@anthropic-ai/sdk');
const modules    = require('../modules');      // auto-loads all modules
const { SYSTEM_PROMPT } = require('../config/systemPrompt');
const Logger     = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Tool Schema (Function Calling Definitions) ───────────────
const TOOLS = [
  {
    name       : 'get_weather',
    description: 'Get current weather and forecast for a city. Trigger when user asks about weather, rain, temperature, hot/cold.',
    input_schema: {
      type      : 'object',
      properties: {
        city    : { type: 'string', description: 'City name e.g. "Colombo", "Kandy"' },
        units   : { type: 'string', enum: ['metric', 'imperial'], default: 'metric' },
      },
      required: ['city'],
    },
  },
  {
    name       : 'search_web',
    description: 'Search the internet for current information, news, facts. Trigger for "search", "find", "what is", recent news requests.',
    input_schema: {
      type      : 'object',
      properties: {
        query   : { type: 'string', description: 'Search query string' },
        language: { type: 'string', description: 'Response language: "si" for Sinhala, "en" for English', default: 'en' },
      },
      required: ['query'],
    },
  },
  {
    name       : 'generate_image',
    description: 'Generate an AI image from a text description. Trigger for "draw", "create image", "generate pic", "image ekak hadapan".',
    input_schema: {
      type      : 'object',
      properties: {
        prompt  : { type: 'string', description: 'Detailed image description' },
        style   : { type: 'string', enum: ['photorealistic', 'anime', 'cartoon', 'oil_painting', 'sketch'], default: 'photorealistic' },
        size    : { type: 'string', enum: ['square', 'landscape', 'portrait'], default: 'square' },
      },
      required: ['prompt'],
    },
  },
  {
    name       : 'convert_currency',
    description: 'Convert amount between currencies. Trigger for currency, exchange rate, rupees, dollars, "maeka dollars walata".',
    input_schema: {
      type      : 'object',
      properties: {
        amount  : { type: 'number' },
        from    : { type: 'string', description: '3-letter ISO code e.g. LKR, USD, EUR' },
        to      : { type: 'string', description: '3-letter ISO code' },
      },
      required: ['amount', 'from', 'to'],
    },
  },
  {
    name       : 'translate_text',
    description: 'Translate text between languages. Trigger for "translate", "karapan", "translate karanna", "meaning of".',
    input_schema: {
      type      : 'object',
      properties: {
        text          : { type: 'string' },
        target_language: { type: 'string', description: 'Target language name or code e.g. "Sinhala", "si", "English", "en"' },
      },
      required: ['text', 'target_language'],
    },
  },
  {
    name       : 'analyze_media',
    description: 'Analyze an image or document sent by the user. Auto-triggered when user sends media with or without a caption.',
    input_schema: {
      type      : 'object',
      properties: {
        media_type : { type: 'string', enum: ['image', 'document', 'audio'] },
        instruction: { type: 'string', description: 'What to do: describe, extract_text, summarize, translate' },
      },
      required: ['media_type', 'instruction'],
    },
  },
];

// ── Main Router ───────────────────────────────────────────────
async function route({ userMessage, history, session, senderId }) {
  Logger.debug(`[Router] Routing message from ${senderId}`);

  // Build conversation history for Claude (last 15 turns)
  const formattedHistory = history.map((h) => ({
    role   : h.role,
    content: h.content,
  }));

  // Add current message
  const currentContent = userMessage.type === 'text'
    ? userMessage.text
    : `[User sent a ${userMessage.type}. MIME: ${userMessage.mimetype ?? 'unknown'}]`;

  formattedHistory.push({ role: 'user', content: currentContent });

  try {
    const response = await client.messages.create({
      model    : 'claude-opus-4-5',
      max_tokens: 1024,
      system   : SYSTEM_PROMPT,
      tools    : TOOLS,
      messages : formattedHistory,
    });

    Logger.debug(`[Router] Stop reason: ${response.stop_reason}`);

    // ── Case 1: LLM chose a tool ───────────────────────────────
    if (response.stop_reason === 'tool_use') {
      const toolUse  = response.content.find((b) => b.type === 'tool_use');
      const toolName = toolUse.name;
      const toolArgs = toolUse.input;

      Logger.info(`[Router] Dispatching to module: ${toolName}`, toolArgs);

      const mod = modules[toolName];
      if (!mod) {
        return makeTextReply(`⚠️ Module "${toolName}" not implemented yet.`);
      }

      // Return an executable wrapper
      return {
        module  : toolName,
        execute : () => mod.handle({ args: toolArgs, userMessage, session }),
      };
    }

    // ── Case 2: Plain conversational response ──────────────────
    const textBlock = response.content.find((b) => b.type === 'text');
    const replyText = textBlock?.text ?? '🤔 Hmm, I got confused. Try again!';

    return {
      module  : 'chat',
      execute : () => Promise.resolve({ type: 'text', text: replyText }),
    };

  } catch (err) {
    Logger.error('[Router] LLM call failed:', err.message);
    return {
      module  : 'error',
      execute : () => Promise.resolve({
        type: 'text',
        text: '⚠️ AI engine is taking a break. Try in a moment!',
      }),
    };
  }
}

function makeTextReply(text) {
  return { module: 'fallback', execute: () => Promise.resolve({ type: 'text', text }) };
}

module.exports = { route, TOOLS };
