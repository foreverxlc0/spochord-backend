
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function parseJsStore(html) {
  const $ = cheerio.load(html);
  const raw = $('div.js-store').attr('data-content');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      const decoded = raw
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

function walkFind(obj, predicate, results = []) {
  if (!obj || typeof obj !== 'object') return results;
  if (predicate(obj)) results.push(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) walkFind(item, predicate, results);
  } else {
    for (const key of Object.keys(obj)) walkFind(obj[key], predicate, results);
  }
  return results;
}

function findBestChordTab(searchData) {
  const tabs = walkFind(
    searchData,
    (o) =>
      o &&
      typeof o === 'object' &&
      (o.type === 'Chords' || o.type === 'chords') &&
      (o.tab_url || o.tabUrl)
  );

  if (!tabs.length) {
    const any = walkFind(
      searchData,
      (o) =>
        o &&
        typeof o === 'object' &&
        typeof (o.tab_url || o.tabUrl) === 'string' &&
        String(o.tab_url || o.tabUrl).includes('-chords-')
    );
    tabs.push(...any);
  }

  tabs.sort((a, b) => {
    const r = (b.rating || 0) - (a.rating || 0);
    if (r !== 0) return r;
    return (b.votes || 0) - (a.votes || 0);
  });

  const best = tabs[0];
  if (!best) return null;
  return best.tab_url || best.tabUrl;
}

function findTabContent(tabData) {
  const withContent = walkFind(
    tabData,
    (o) =>
      o &&
      typeof o === 'object' &&
      typeof o.content === 'string' &&
      o.content.length > 80
  );
  withContent.sort((a, b) => {
    const score = (c) => {
      let s = 0;
      if (c.includes('[ch]') || c.includes('[tab]')) s += 10;
      if (c.includes('[Verse') || c.includes('[Chorus') || c.includes('[Intro')) s += 5;
      return s + Math.min(c.length / 1000, 5);
    };
    return score(b.content) - score(a.content);
  });
  return withContent[0]?.content || null;
}

function cleanContent(content) {
  return content
    .replace(/\[tab\]/gi, '')
    .replace(/\[\/tab\]/gi, '')
    .replace(/\[ch\]/gi, '')
    .replace(/\[\/ch\]/gi, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 15000,
    maxRedirects: 5,
  });
  return res.data;
}

app.get('/api/chords', async (req, res) => {
  try {
    const artist = (req.query.artist || '').toString().trim();
    const title = (req.query.title || '').toString().trim();

    if (!artist && !title) {
      return res.status(400).json({ error: 'artist or title required' });
    }

    const q = encodeURIComponent([artist, title].filter(Boolean).join(' '));
    const searchUrl = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q}`;

    const searchHtml = await fetchHtml(searchUrl);
    const searchData = parseJsStore(searchHtml);

    let tabUrl = null;
    if (searchData) {
      tabUrl = findBestChordTab(searchData);
    }

    if (!tabUrl) {
      const matches = [
        ...String(searchHtml).matchAll(
          /https:\/\/tabs\.ultimate-guitar\.com\/tab\/[^"'\\\s]+-chords-\d+/gi
        ),
      ];
      if (matches.length) {
        tabUrl = matches[0][0].replace(/&quot;/g, '').replace(/&amp;/g, '&');
      }
    }

    if (!tabUrl) {
      return res.status(404).json({ error: 'Chord sheet not found', query: { artist, title } });
    }

    const tabHtml = await fetchHtml(tabUrl);
    const tabData = parseJsStore(tabHtml);
    let content = tabData ? findTabContent(tabData) : null;

    if (!content) {
      const $ = cheerio.load(tabHtml);
      content = $('pre').text() || '';
    }

    if (!content || content.length < 40) {
      return res.status(404).json({
        error: 'Could not extract chord content',
        source: tabUrl,
      });
    }

    res.json({
      artist,
      title,
      source: tabUrl,
      content: cleanContent(content),
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: 'Scraping failed',
      details: error.message,
    });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`SpoChord backend running on port ${PORT}`);
});
