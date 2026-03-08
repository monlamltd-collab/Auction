import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.goto('https://www.dedmangray.co.uk/auction/?q=1&tid=432', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  const data = await page.evaluate(() => {
    const lotEls = document.querySelectorAll('[class*="lot"]');
    const byClass = {};
    for (const el of lotEls) {
      const cls = el.className;
      if (byClass[cls] === undefined) byClass[cls] = 0;
      byClass[cls]++;
    }
    // Get first 3 lot containers with price content
    const samples = Array.from(lotEls)
      .filter(el => el.textContent.includes('£') || el.querySelector('img'))
      .slice(0, 3)
      .map(el => ({
        tag: el.tagName,
        class: el.className,
        html: el.outerHTML.substring(0, 1500)
      }));
    return { classCounts: byClass, samples };
  });

  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
