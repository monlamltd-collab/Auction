import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.goto('https://www.barnettross.co.uk/current.php', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));

  const lots = await page.evaluate(() => {
    const lots = [];
    const seen = new Set();
    const table = document.querySelector('table.auction-archive-table');
    if (!table) return lots;
    const rows = table.querySelectorAll('tr[onclick], tr[style*="cursor"]');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const lotNum = parseInt(cells[0].textContent.trim()) || (lots.length + 1);
      const address = cells[1].textContent.trim();
      if (!address || address.length < 5) continue;
      if (seen.has(address)) continue;
      seen.add(address);
      let price = null;
      const priceText = cells[3].textContent || '';
      const pm = priceText.match(/£([\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      let url = '';
      const onclick = row.getAttribute('onclick') || '';
      const urlMatch = onclick.match(/document\.location='([^']+)'/);
      if (urlMatch) url = urlMatch[1];
      lots.push({ lot: lotNum, address, price, url, bullets: [] });
    }
    return lots;
  });

  console.log(`\n=== BARNETT ROSS: ${lots.length} lots ===\n`);
  for (const lot of lots) {
    console.log(`Lot ${lot.lot}: ${lot.address}`);
    console.log(`  Price: ${lot.price ? '£' + lot.price.toLocaleString() : 'N/A'}`);
    console.log(`  URL: ${lot.url}`);
    console.log();
  }

  const withPrice = lots.filter(l => l.price);
  console.log(`Total: ${lots.length}, Price: ${withPrice.length}`);
  console.log(`RESULT: ${lots.length > 0 ? 'SUCCESS' : 'FAILURE'}`);

  await browser.close();
})();
