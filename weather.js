/**
 * modules/weather.js — Weather Module
 * ─────────────────────────────────────────────────────────────
 * Uses OpenWeatherMap API (free tier).
 * Returns a formatted WhatsApp-friendly weather report.
 */

'use strict';

const axios  = require('axios');
const Logger = require('../utils/logger');

const OWM_KEY = process.env.OPENWEATHER_API_KEY;
const BASE    = 'https://api.openweathermap.org/data/2.5/weather';

async function handle({ args }) {
  const { city, units = 'metric' } = args;

  try {
    const { data } = await axios.get(BASE, {
      params: { q: city, appid: OWM_KEY, units },
    });

    const unitLabel = units === 'metric' ? '°C' : '°F';
    const icon = weatherEmoji(data.weather[0].main);

    const reply = [
      `${icon} *${data.name}, ${data.sys.country}*`,
      `🌡 Temp: *${data.main.temp}${unitLabel}* (feels ${data.main.feels_like}${unitLabel})`,
      `💧 Humidity: ${data.main.humidity}%`,
      `🌬 Wind: ${data.wind.speed} m/s`,
      `☁️ ${data.weather[0].description}`,
    ].join('\n');

    return { type: 'text', text: reply };

  } catch (err) {
    Logger.error('[Weather] API error:', err.message);
    return {
      type: 'text',
      text: `😕 "${city}" gena weather data ganna bæri una. City name check karanna!`,
    };
  }
}

function weatherEmoji(main) {
  const map = {
    Clear: '☀️', Clouds: '☁️', Rain: '🌧', Drizzle: '🌦',
    Thunderstorm: '⛈', Snow: '❄️', Mist: '🌫', Haze: '🌫',
  };
  return map[main] ?? '🌤';
}

module.exports = { handle };
