import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.goto('https://www.landwoodpropertyauctions.com/current-auction', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  const debug = await page.evaluate(() => {
    const cards = document.querySelectorAll('.lot-panel');
    return Array.from(cards).slice(0, 3).map(card => {
      const h4 = card.querySelector('h4');
      const gridAddr = card.querySelector('h4.grid-address');
      const gridGuide = card.querySelector('.grid-guideprice');
      const gridGuideB = card.querySelector('.grid-guideprice b');
      const gridGuideStrong = card.querySelector('.grid-guideprice strong');
      const tagline = card.querySelector('.grid-tagline');
      const allH4s = Array.from(card.querySelectorAll('h4')).map(e => ({ class: e.className, text: e.textContent.trim().substring(0, 200) }));
      const allPriceEls = Array.from(card.querySelectorAll('[class*="price"], [class*="guide"]')).map(e => ({
        tag: e.tagName, class: e.className, text: e.textContent.trim().substring(0, 200), html: e.innerHTML.substring(0, 300)
      }));
      const allSpans = Array.from(card.querySelectorAll('span')).filter(s => s.textContent.includes('£')).map(s => ({
        class: s.className, text: s.textContent.trim().substring(0, 100)
      }));
      return {
        h4Text: h4?.textContent?.trim()?.substring(0, 200),
        h4Class: h4?.className,
        gridAddrText: gridAddr?.textContent?.trim()?.substring(0, 200),
        gridGuideText: gridGuide?.textContent?.trim()?.substring(0, 200),
        gridGuideHTML: gridGuide?.innerHTML?.substring(0, 300),
        gridGuideBText: gridGuideB?.textContent?.trim(),
        gridGuideStrongText: gridGuideStrong?.textContent?.trim(),
        taglineText: tagline?.textContent?.trim()?.substring(0, 200),
        allH4s,
        allPriceEls,
        allSpans,
        html: card.outerHTML.substring(0, 1500)
      };
    });
  });

  console.log(JSON.stringify(debug, null, 2));
  await browser.close();
})();
