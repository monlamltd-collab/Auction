import puppeteer from 'puppeteer';

const URL = 'https://www.btgeddisonspropertyauctions.com/properties/';

// This is the DOM extractor from server.js — copy-pasted for testing
const EXTRACTOR = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.property-card');
    for (const card of cards) {
      const text = card.textContent || '';
      let lotNum = 0;
      const lotMatch = text.match(/^\\s*(\\d{1,4})\\s/);
      if (lotMatch) lotNum = parseInt(lotMatch[1]);
      let url = '';
      const propLink = card.querySelector('a[href*="/properties/"]');
      if (propLink) url = propLink.getAttribute('href') || '';
      if (seen.has(url) && url) continue;
      if (url) seen.add(url);
      let address = '';
      if (propLink) address = propLink.textContent.trim();
      if (!address || address.length < 5) {
        const allLinks = card.querySelectorAll('a[href*="/properties/"]');
        for (const link of allLinks) {
          const t = link.textContent.trim();
          if (t.length > 5 && t.match(/[A-Z]{1,2}\\d/i)) { address = t; break; }
        }
      }
      if (!address) continue;
      address = address.replace(/(.{20,})\\1/g, '$1').trim();
      let price = null;
      const priceMatch = text.match(/Guide\\s*Price[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
      const bullets = [];
      const typeMatch = text.match(/(Multi-Lot Timed|Single-Lot Timed|Live Stream)\\s*Auction/i);
      if (typeMatch) bullets.push(typeMatch[0]);
      const endMatch = text.match(/Auction\\s*Ends?:\\s*(\\d{2}\\/\\d{2}\\/\\d{4})/i);
      if (endMatch) bullets.push('Auction Ends: ' + endMatch[1]);
      if (text.match(/\\bWithdrawn\\b|\\bSOLD\\b|\\bSTC\\b|\\bSale Agreed\\b/i)) {
        bullets.push('SOLD/STC');
      }
      let imageUrl = '';
      const imgs = card.querySelectorAll('img[src]');
      for (const img of imgs) {
        const s = img.getAttribute('src') || '';
        if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg')
            && !s.includes('placeholder') && s.length > 10) {
          imageUrl = s;
          break;
        }
      }
      lots.push({ lot: lotNum || lots.length + 1, address, price, url, bullets, imageUrl: imageUrl || undefined });
    }
    return lots;
  })()
`;

(async () => {
  console.log('Launching Puppeteer...');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  console.log(`Loading ${URL}...`);
  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch (e) {
    console.log('Navigation timeout, continuing...');
  }
  await new Promise(r => setTimeout(r, 4000));

  // Scroll to trigger lazy loading
  await page.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      window.scrollBy(0, window.innerHeight);
      await new Promise(r => setTimeout(r, 300));
    }
    window.scrollTo(0, 0);
  });
  await new Promise(r => setTimeout(r, 2000));

  console.log('Running DOM extractor...');
  const lots = await page.evaluate(EXTRACTOR);

  console.log(`\n✅ Extracted ${lots.length} lots:\n`);
  for (const lot of lots) {
    console.log(`  Lot ${String(lot.lot).padStart(3, '0')}: ${lot.address}`);
    console.log(`    Price: ${lot.price ? '£' + lot.price.toLocaleString() : 'N/A'}`);
    console.log(`    URL: ${lot.url || 'N/A'}`);
    console.log(`    Image: ${lot.imageUrl ? '✓' : '✗'}`);
    console.log(`    Bullets: ${lot.bullets.join(' | ') || 'none'}`);
    console.log('');
  }

  if (lots.length === 0) {
    console.log('❌ FAIL — No lots extracted! Extractor may need fixing.');
  } else {
    const withImages = lots.filter(l => l.imageUrl).length;
    const withPrices = lots.filter(l => l.price).length;
    console.log(`Summary: ${lots.length} lots | ${withPrices} with prices | ${withImages} with images`);
  }

  await browser.close();
})();
