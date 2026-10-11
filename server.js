require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

app.get('/api/chords', async (req, res) => {
  try {
    const { artist, title } = req.query;

    if (!artist || !title) {
      return res.status(400).json({ error: 'artist and title are required' });
    }

    const searchQuery = encodeURIComponent(`${artist} ${title}`);
    const searchUrl = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${searchQuery}`;

    const searchResponse = await axios.get(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: 12000,
    });

    const $ = cheerio.load(searchResponse.data);

    let tabUrl = null;
    $('a[href*="/tab/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('-chords-') && !tabUrl) {
        tabUrl = href.startsWith('http')
          ? href
          : `https://www.ultimate-guitar.com${href}`;
      }
    });

    if (!tabUrl) {
      return res.status(404).json({ error: 'Chord sheet not found' });
    }

    const tabResponse = await axios.get(tabUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 12000,
    });

    const $$ = cheerio.load(tabResponse.data);
    let content = '';
    const scriptTag = $$('div.js-store').attr('data-content');

    if (scriptTag) {
      try {
        const data = JSON.parse(scriptTag);
        const findContent = (obj) => {
          if (!obj || typeof obj !== 'object') return null;
          if (
            obj.content &&
            typeof obj.content === 'string' &&
            (obj.content.includes('[ch]') || obj.content.length > 100)
          ) {
            return obj.content;
          }
          for (const key of Object.keys(obj)) {
            const found = findContent(obj[key]);
            if (found) return found;
          }
          return null;
        };
        content = findContent(data) || '';
      } catch (e) {
        console.error('JSON parse error', e.message);
      }
    }

    if (!content) {
      content = $$('pre').text() || $$('.js-tab-content').text() || '';
    }

    if (!content) {
      return res.status(404).json({ error: 'Could not extract chords' });
    }

    const cleaned = content
      .replace(/\[tab\]/g, '')
      .replace(/\[\/tab\]/g, '')
      .replace(/\[ch\]/g, '')
      .replace(/\[\/ch\]/g, '')
      .trim();

    res.json({
      artist,
      title,
      source: tabUrl,
      content: cleaned,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Scraping failed', details: error.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`SpoChord backend running on http://localhost:${PORT}`);
});
