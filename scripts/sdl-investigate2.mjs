import puppeteer from 'puppeteer';

// BTG Eddisons is where SDL lots actually live now
const URLS = [
  'https://www.btgeddisonspropertyauctions.com/properties/',
  'https://www.btgeddisonspropertyauctions.com/properties/?auction_type=auction-event',
];

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  for (const URL of URLS) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`INVESTIGATING: ${URL}`);
    console.log('='.repeat(80));

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });

    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['font', 'media'].includes(type)) req.abort();
      else req.continue();
    });

    console.log('Loading page...');
    try {
      await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log('Navigation timeout, continuing anyway...');
    }
    console.log('Waiting 4s for JS render...');
    await new Promise(r => setTimeout(r, 4000));

    // Scroll fully
    await page.evaluate(async () => {
      for (let i = 0; i < 15; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 400));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 2000));

    const result = await page.evaluate(() => {
      const output = {};

      // 1. Relevant CSS classes
      const allElements = document.querySelectorAll('*');
      const relevantClasses = new Set();
      for (const el of allElements) {
        for (const cls of el.classList) {
          if (/lot|property|card|listing|result|auction|grid/i.test(cls)) {
            relevantClasses.add(cls);
          }
        }
      }
      output.relevantClasses = [...relevantClasses].sort();

      // 2. Property/lot links
      const propertyLinks = document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], a[href*="/properties/"]');
      output.propertyLinkCount = propertyLinks.length;
      output.sampleLinks = [...propertyLinks].slice(0, 8).map(a => ({
        href: a.href,
        text: a.textContent.trim().substring(0, 150),
        classes: a.className?.substring(0, 200) || '',
        parentTag: a.parentElement?.tagName,
        parentClasses: a.parentElement?.className?.substring(0, 200) || ''
      }));

      // 3. Card-like selectors
      const cardSelectors = [
        '.property-card', '.lot-card', '.listing-card', '.result-card',
        '.auction-lot', '.property-listing', '.lot-item', '.property-item',
        '[class*="PropertyCard"]', '[class*="LotCard"]', '[class*="property-card"]',
        '[class*="lot-card"]', '[class*="auction-card"]', '[class*="property_card"]',
        '[class*="lotCard"]', '[class*="propertyCard"]',
        '.card', 'article.property', 'article.lot',
        '[class*="grid-item"]', '[class*="grid_item"]',
        '[class*="search-result"]', '[class*="property-result"]',
      ];
      output.cardCounts = {};
      for (const sel of cardSelectors) {
        try {
          const count = document.querySelectorAll(sel).length;
          if (count > 0) output.cardCounts[sel] = count;
        } catch (e) {}
      }

      // 4. Find elements with prices and links (lot candidate detection)
      const pricePattern = /£[\d,]+/;
      const candidates = [];
      const allDivs = document.querySelectorAll('div, article, section, li, a');
      for (const el of allDivs) {
        const text = el.textContent || '';
        const hasPrice = pricePattern.test(text);
        const hasImg = el.querySelector('img') !== null;
        const hasPropertyLink = el.querySelector('a[href*="/property"]') !== null || (el.tagName === 'A' && el.href?.includes('/property'));
        if (hasPrice && text.length < 1500 && text.length > 30) {
          candidates.push({
            tag: el.tagName,
            classes: el.className?.toString().substring(0, 300) || '',
            childCount: el.children?.length || 0,
            textLen: text.length,
            hasImg,
            hasPropertyLink,
            imgSrc: el.querySelector('img')?.src?.substring(0, 250) || null,
            bgImg: el.querySelector('[style*="background"]')?.style?.backgroundImage?.substring(0, 250) || null,
            linkHref: (el.querySelector('a[href*="/property"]') || (el.tagName === 'A' && el.href?.includes('/property') ? el : null))?.href?.substring(0, 250) || null,
            priceMatch: text.match(/£[\d,]+/)?.[0] || null,
            preview: text.substring(0, 400).replace(/\s+/g, ' ')
          });
        }
      }
      candidates.sort((a, b) => a.textLen - b.textLen);
      output.lotCandidates = candidates.slice(0, 10);

      // 5. Images
      const allImgs = document.querySelectorAll('img');
      output.totalImages = allImgs.length;
      output.imageSamples = [...allImgs].filter(img => img.src && !img.src.includes('data:') && img.naturalWidth > 50).slice(0, 10).map(img => ({
        src: img.src?.substring(0, 250),
        alt: img.alt?.substring(0, 100),
        width: img.naturalWidth || img.width,
        parentClasses: img.parentElement?.className?.substring(0, 150) || '',
        grandparentClasses: img.parentElement?.parentElement?.className?.substring(0, 150) || ''
      }));

      // 6. Body text preview
      output.bodyTextPreview = document.body.innerText.substring(0, 3000);

      // 7. Page title
      output.title = document.title;

      return output;
    });

    console.log('\nPage title:', result.title);
    console.log('Relevant CSS classes:', JSON.stringify(result.relevantClasses, null, 2));
    console.log('\nProperty link count:', result.propertyLinkCount);
    console.log('Sample links:', JSON.stringify(result.sampleLinks, null, 2));
    console.log('\nCard selector counts:', JSON.stringify(result.cardCounts, null, 2));
    console.log('\nLot candidates:', JSON.stringify(result.lotCandidates, null, 2));
    console.log('\nTotal images:', result.totalImages);
    console.log('Image samples:', JSON.stringify(result.imageSamples, null, 2));
    console.log('\nBody text (first 3000 chars):');
    console.log(result.bodyTextPreview);

    await page.close();
  }

  await browser.close();
})();
