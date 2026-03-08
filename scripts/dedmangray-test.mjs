import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.goto('https://www.dedmangray.co.uk/auction/?q=1&tid=432', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  const lots = await page.evaluate(() => {
    const lots = [];
    const seen = new Set();
    const tables = document.querySelectorAll('table.lotdetails');
    for (const table of tables) {
      const lotCell = table.querySelector('td.lotnum');
      let lotNum = lots.length + 1;
      if (lotCell) {
        const m = lotCell.textContent.match(/LOT[:\s]+(\d+)/i);
        if (m) lotNum = parseInt(m[1]);
      }
      const addrCell = table.querySelector('td.lottag');
      let address = addrCell ? addrCell.textContent.trim().replace(/\s+/g, ' ') : '';
      if (!address || address.length < 5) continue;
      if (seen.has(address)) continue;
      seen.add(address);
      let price = null;
      const text = table.textContent || '';
      const pm = text.match(/Guide Price[^£]*£([\d,]+)/i);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      let url = '';
      const link = table.querySelector('a[href*="lot-details"], a[href*="lid="]');
      if (link) url = link.getAttribute('href') || '';
      let imageUrl = '';
      const img = table.querySelector('td.lotimagecol img, img[src*="eigpropertyauctions"]');
      if (img) {
        const s = img.getAttribute('src') || '';
        if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
      }
      const bullets = [];
      const descCells = table.querySelectorAll('td[colspan="2"]');
      if (descCells.length > 0) {
        const desc = descCells[0].textContent.trim().replace(/\s+/g, ' ');
        if (desc.length > 10 && desc.length < 500 && !desc.match(/^Guide Price/i)) {
          bullets.push(desc.substring(0, 250));
        }
      }
      lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
    }
    return lots;
  });

  console.log(`\n=== DEDMAN GRAY: ${lots.length} lots ===\n`);
  for (const lot of lots) {
    console.log(`Lot ${lot.lot}: ${lot.address}`);
    console.log(`  Price: ${lot.price ? '£' + lot.price.toLocaleString() : 'N/A'}`);
    console.log(`  URL: ${lot.url ? lot.url.substring(0, 80) : 'none'}`);
    console.log(`  Image: ${lot.imageUrl ? lot.imageUrl.substring(0, 80) : 'none'}`);
    console.log(`  Bullets: ${lot.bullets.join(' | ').substring(0, 120)}`);
    console.log();
  }

  const withPrice = lots.filter(l => l.price);
  const withImage = lots.filter(l => l.imageUrl);
  console.log(`Total: ${lots.length}, Price: ${withPrice.length}, Image: ${withImage.length}`);
  console.log(`RESULT: ${lots.length > 0 ? 'SUCCESS' : 'FAILURE'}`);

  await browser.close();
})();
