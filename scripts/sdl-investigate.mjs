import puppeteer from 'puppeteer';

const URL = 'https://www.sdlauctions.co.uk/property-auctions/upcoming-auctions/';

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  // Block images/fonts/media to speed up
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (['font', 'media', 'stylesheet'].includes(type)) req.abort();
    else req.continue();
  });

  console.log('Loading SDL page...');
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('Page loaded, waiting 3s...');
  await new Promise(r => setTimeout(r, 3000));

  // Scroll fully
  await page.evaluate(async () => {
    for (let i = 0; i < 15; i++) {
      window.scrollBy(0, window.innerHeight);
      await new Promise(r => setTimeout(r, 500));
    }
    window.scrollTo(0, 0);
  });
  console.log('Scrolled, waiting 2s...');
  await new Promise(r => setTimeout(r, 2000));

  const result = await page.evaluate(() => {
    const output = {};

    // 1. Find relevant CSS class names
    const allElements = document.querySelectorAll('*');
    const relevantClasses = new Set();
    for (const el of allElements) {
      for (const cls of el.classList) {
        if (/lot|property|card|listing|result|auction/i.test(cls)) {
          relevantClasses.add(cls);
        }
      }
    }
    output.relevantClasses = [...relevantClasses].sort();

    // 2. Find a tags with /property/ or /lot/ in href
    const propertyLinks = document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"]');
    output.propertyLinkCount = propertyLinks.length;
    output.sampleLinks = [...propertyLinks].slice(0, 5).map(a => ({
      href: a.href,
      text: a.textContent.trim().substring(0, 100),
      parentClasses: a.parentElement?.className || '',
      grandparentClasses: a.parentElement?.parentElement?.className || '',
      outerHTML: a.outerHTML.substring(0, 300)
    }));

    // 3. Check for data attributes
    const dataLotEls = document.querySelectorAll('[data-lot], [data-property], [data-id], [data-lot-id]');
    output.dataAttrCount = dataLotEls.length;
    output.dataAttrSamples = [...dataLotEls].slice(0, 3).map(el => ({
      tag: el.tagName,
      attrs: [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`),
      classes: el.className
    }));

    // 4. Find likely lot card containers
    const cardSelectors = [
      '.lot-card', '.property-card', '.listing-card', '.result-card',
      '.auction-lot', '.property-listing', '.lot-item', '.property-item',
      '[class*="PropertyCard"]', '[class*="LotCard"]', '[class*="property-card"]',
      '[class*="lot-card"]', '[class*="auction-card"]',
      'article', '.card'
    ];
    output.cardCounts = {};
    for (const sel of cardSelectors) {
      const count = document.querySelectorAll(sel).length;
      if (count > 0) output.cardCounts[sel] = count;
    }

    // 5. First matching card outerHTML
    for (const sel of cardSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        output.firstCardSelector = sel;
        output.firstCardHTML = el.outerHTML.substring(0, 2000);
        break;
      }
    }

    // 6. Try to find the lot cards by looking for repeated patterns with images and prices
    const allDivs = document.querySelectorAll('div, article, section, li');
    const pricePattern = /£[\d,]+/;
    const candidates = [];
    for (const el of allDivs) {
      const text = el.textContent;
      const hasPrice = pricePattern.test(text);
      const hasImg = el.querySelector('img') !== null;
      const hasLink = el.querySelector('a[href*="/property/"]') !== null || el.querySelector('a[href*="/lot/"]') !== null;
      if (hasPrice && (hasImg || hasLink) && text.length < 2000 && text.length > 50) {
        candidates.push({
          tag: el.tagName,
          classes: el.className.substring(0, 200),
          childCount: el.children.length,
          textLen: text.length,
          hasImg,
          hasLink,
          imgSrc: el.querySelector('img')?.src?.substring(0, 200) || null,
          linkHref: (el.querySelector('a[href*="/property/"]') || el.querySelector('a[href*="/lot/"]'))?.href || null,
          priceMatch: text.match(/£[\d,]+/)?.[0] || null,
          preview: text.substring(0, 300)
        });
      }
    }
    // Sort by textLen ascending (smaller = more specific card)
    candidates.sort((a, b) => a.textLen - b.textLen);
    output.lotCandidates = candidates.slice(0, 8);

    // 7. Body text preview
    output.bodyTextPreview = document.body.innerText.substring(0, 2000);

    // 8. Count images on the page
    const allImgs = document.querySelectorAll('img');
    output.totalImages = allImgs.length;
    output.imageSamples = [...allImgs].slice(0, 10).map(img => ({
      src: img.src?.substring(0, 200),
      alt: img.alt?.substring(0, 100),
      width: img.naturalWidth || img.width,
      parentClasses: img.parentElement?.className?.substring(0, 100) || ''
    }));

    return output;
  });

  console.log('\n=== INVESTIGATION RESULTS ===\n');
  console.log('Relevant CSS classes:', JSON.stringify(result.relevantClasses, null, 2));
  console.log('\nProperty link count:', result.propertyLinkCount);
  console.log('Sample links:', JSON.stringify(result.sampleLinks, null, 2));
  console.log('\nData attribute elements:', result.dataAttrCount);
  console.log('Data attr samples:', JSON.stringify(result.dataAttrSamples, null, 2));
  console.log('\nCard selector counts:', JSON.stringify(result.cardCounts, null, 2));
  console.log('\nFirst card selector:', result.firstCardSelector);
  console.log('First card HTML:', result.firstCardHTML);
  console.log('\nLot candidates (by price+img/link):', JSON.stringify(result.lotCandidates, null, 2));
  console.log('\nTotal images:', result.totalImages);
  console.log('Image samples:', JSON.stringify(result.imageSamples, null, 2));
  console.log('\nBody text (first 2000 chars):');
  console.log(result.bodyTextPreview);

  await browser.close();
})();
