import puppeteer from 'puppeteer';

const extractor = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.lot-panel');
    let lotIndex = 1;
    for (const card of cards) {
      const addrEl = card.querySelector('h3.list-address, h3.grid-address, h4.grid-address');
      let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
      if (!address || address.length < 5) continue;
      if (seen.has(address)) continue;
      seen.add(address);
      let lotNum = lotIndex;
      const titleEl = card.querySelector('.panel-title');
      if (titleEl) {
        const m = titleEl.textContent.match(/Lot\\s+(\\d+)/i);
        if (m) lotNum = parseInt(m[1]);
      }
      let price = null;
      const priceEl = card.querySelector('.list-guideprice strong, .grid-guideprice b, .grid-guideprice strong');
      if (priceEl) {
        const pm = priceEl.textContent.match(/([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      let url = '';
      const link = card.querySelector('a[href*="/lot/details/"], a[href*="/lot/"]');
      if (link) url = link.getAttribute('href') || '';
      let imageUrl = '';
      const img = card.querySelector('img.list-image, img.grid-img, img.img-responsive, img[src*="eigpropertyauctions"]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
      }
      const bullets = [];
      const headingEl = card.querySelector('h4.lot-data-heading strong, h4.lot-data-heading');
      if (headingEl) {
        const t = headingEl.textContent.trim();
        if (t.length > 3 && t.length < 300) bullets.push(t);
      }
      lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      lotIndex++;
    }
    return lots;
  })()
`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
    else req.continue();
  });

  console.log('Loading Landwood current-auction...');
  await page.goto('https://www.landwoodpropertyauctions.com/current-auction', { waitUntil: 'networkidle2', timeout: 60000 });
  console.log(`Redirected to: ${page.url()}`);
  await new Promise(r => setTimeout(r, 3000));

  const lots = await page.evaluate(extractor);
  console.log(`\n=== LANDWOOD: ${lots.length} lots ===\n`);
  for (const lot of lots) {
    console.log(`Lot ${lot.lot}: ${lot.address}`);
    console.log(`  Price: ${lot.price ? '£' + lot.price.toLocaleString() : 'N/A'}`);
    console.log(`  URL: ${lot.url}`);
    console.log(`  Image: ${lot.imageUrl ? lot.imageUrl.substring(0, 80) : 'none'}`);
    console.log(`  Bullets: ${lot.bullets.join(' | ')}`);
    console.log();
  }

  const withPrice = lots.filter(l => l.price);
  const withImage = lots.filter(l => l.imageUrl);
  console.log(`Total: ${lots.length}, Price: ${withPrice.length}, Image: ${withImage.length}`);
  console.log(`RESULT: ${lots.length > 0 ? 'SUCCESS' : 'FAILURE'}`);

  await browser.close();
})();
