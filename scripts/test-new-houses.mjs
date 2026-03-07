import puppeteer from 'puppeteer';

// Extract the DOM extractor source strings directly from server.js
const EXTRACTORS = {
  countrywide: {
    url: 'https://www.countrywidepropertyauctions.co.uk/search.php?auction_location=SK&auction_date=current',
    needsPuppeteer: false,
    extractor: `
      (() => {
        const lots = [];
        const seen = new Set();
        const cards = document.querySelectorAll('.property-gallery');
        let lotIndex = 1;
        for (const card of cards) {
          const text = card.textContent || '';
          const addrEl = card.querySelector('.property-gallery__address, h3');
          let address = addrEl ? addrEl.textContent.trim() : '';
          if (!address || address.length < 5) continue;
          if (seen.has(address)) continue;
          seen.add(address);
          let price = null;
          const titleEl = card.querySelector('.property-gallery__title, h2');
          const titleText = titleEl ? titleEl.textContent.trim() : '';
          const priceMatch = titleText.match(/£([\\d,]+)/);
          if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
          let url = '';
          const detailLink = card.querySelector('a[href*="property_details"]');
          if (detailLink) url = detailLink.getAttribute('href') || '';
          let imageUrl = '';
          const img = card.querySelector('.property-gallery__image img:not(.sold)');
          if (img) imageUrl = img.getAttribute('src') || '';
          const bullets = [];
          if (titleText.match(/Sold|Withdrawn|Postponed/i)) bullets.push(titleText.trim());
          if (card.querySelector('.vu360')) bullets.push('Virtual Tour Available');
          lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
        }
        return lots;
      })()
    `
  },
  venmore: {
    url: 'https://www.venmoreauctions.co.uk/Property-Search',
    needsPuppeteer: false,
    extractor: `
      (() => {
        const lots = [];
        const cards = document.querySelectorAll('.property-strip-block');
        for (const card of cards) {
          const text = card.textContent || '';
          let lotNum = lots.length + 1;
          const lotMatch = text.match(/Lot\\s+(\\d+)/i);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
          let address = '';
          const addrEl = card.querySelector('.f-body-copy.db.marbot10, span[class*="marbot"]');
          if (addrEl) address = addrEl.textContent.trim();
          if (!address || address.length < 5) continue;
          let price = null;
          const priceEl = card.querySelector('.p-text-green, span[class*="greatprimer"]');
          if (priceEl) {
            const pm = priceEl.textContent.match(/£([\\d,]+)/);
            if (pm) price = parseInt(pm[1].replace(/,/g, ''));
          }
          let url = '';
          const link = card.querySelector('a[href*="Property-Details"]');
          if (link) url = link.getAttribute('href') || '';
          let imageUrl = '';
          const img = card.querySelector('img.img_resp, img[src*="resizeCrop"]');
          if (img) imageUrl = img.getAttribute('src') || '';
          const bullets = [];
          const statusEl = card.querySelector('.p-flash-green');
          if (statusEl) bullets.push(statusEl.textContent.trim());
          const dateMatch = text.match(/(\\d{2}\\/\\d{2}\\/\\d{4})/);
          if (dateMatch) bullets.push('Auction: ' + dateMatch[1]);
          lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        }
        return lots;
      })()
    `
  },
  tcpa: {
    url: 'https://www.townandcountrypropertyauctions.co.uk/search',
    needsPuppeteer: true,
    extractor: `
      (() => {
        const lots = [];
        const seen = new Set();
        const cards = document.querySelectorAll('.lot-panel');
        let lotIndex = 1;
        for (const card of cards) {
          const text = card.textContent || '';
          const addrEl = card.querySelector('.lot-address, span[class*="lot-address"]');
          let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
          if (!address || address.length < 5) continue;
          if (seen.has(address)) continue;
          seen.add(address);
          let price = null;
          const priceEl = card.querySelector('.grid-guideprice .price, span.price');
          if (priceEl) {
            const pm = priceEl.textContent.match(/([\\d,]+)/);
            if (pm) price = parseInt(pm[1].replace(/,/g, ''));
          }
          let url = '';
          const link = card.querySelector('.grid-img-container a[href], a[href*="/lot/details/"]');
          if (link) url = link.getAttribute('href') || '';
          let imageUrl = '';
          const img = card.querySelector('img.grid-img, img.img-responsive');
          if (img) imageUrl = img.getAttribute('src') || '';
          const bullets = [];
          const timeEl = card.querySelector('time.text-success');
          if (timeEl) bullets.push('Auction Ends: ' + timeEl.textContent.trim());
          const officeEl = card.querySelector('.lot-auctioneer-name');
          if (officeEl) bullets.push(officeEl.textContent.trim());
          card.querySelectorAll('.grid-tagline.custom-fields li').forEach(li => {
            const t = li.textContent.trim();
            if (t.length > 1) bullets.push(t);
          });
          const ribbon = card.querySelector('[data-ribbon]');
          if (ribbon) bullets.push(ribbon.getAttribute('data-ribbon'));
          lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
        }
        return lots;
      })()
    `
  },
  kivells: {
    url: 'https://www.kivells.com/residential-property/properties-for-auction',
    needsPuppeteer: false,
    extractor: `
      (() => {
        const lots = [];
        const cards = document.querySelectorAll('[class*="bg-listing-item-background"]');
        for (const card of cards) {
          const text = card.textContent || '';
          const addrEl = card.querySelector('h2.font-serif, h2');
          let address = addrEl ? addrEl.textContent.trim() : '';
          if (!address || address.length < 5) continue;
          let price = null;
          const priceEl = card.querySelector('h3.font-serif, h3');
          if (priceEl) {
            const pm = priceEl.textContent.match(/([\\d,]+)/);
            if (pm) price = parseInt(pm[1].replace(/,/g, ''));
          }
          let url = '';
          const link = card.querySelector('a[href*="/properties/"]');
          if (link) url = link.getAttribute('href') || '';
          let imageUrl = '';
          const img = card.querySelector('img[src*="/media/Properties/"]');
          if (img) imageUrl = img.getAttribute('src') || '';
          const bullets = [];
          card.querySelectorAll('ul li').forEach(li => {
            const t = li.textContent.trim();
            if (t.length > 1 && t.length < 100) bullets.push(t);
          });
          const descEl = card.querySelector('p.font-light.leading-loose, p.font-light');
          if (descEl) {
            const desc = descEl.textContent.trim();
            if (desc.length > 10 && desc.length < 300) bullets.push(desc);
          }
          lots.push({ lot: lots.length + 1, address, price, url, bullets, imageUrl: imageUrl || undefined });
        }
        return lots;
      })()
    `
  }
};

const houses = process.argv.slice(2);
const toTest = houses.length > 0 ? houses : Object.keys(EXTRACTORS);

(async () => {
  console.log(`Testing ${toTest.length} extractors...\n`);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  for (const name of toTest) {
    const config = EXTRACTORS[name];
    if (!config) { console.log(`Unknown house: ${name}`); continue; }

    console.log(`${'='.repeat(60)}`);
    console.log(`Testing: ${name} — ${config.url}`);
    console.log(`${'='.repeat(60)}`);

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await page.setViewport({ width: 1280, height: 900 });

    try {
      await page.goto(config.url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log('Navigation timeout, continuing...');
    }

    if (config.needsPuppeteer) {
      // Scroll for lazy-loaded content
      await page.evaluate(async () => {
        for (let i = 0; i < 10; i++) {
          window.scrollBy(0, window.innerHeight);
          await new Promise(r => setTimeout(r, 400));
        }
        window.scrollTo(0, 0);
      });
      await new Promise(r => setTimeout(r, 3000));
    } else {
      await new Promise(r => setTimeout(r, 2000));
    }

    const lots = await page.evaluate(config.extractor);
    console.log(`\n  Extracted ${lots.length} lots:`);
    for (const lot of lots.slice(0, 3)) {
      console.log(`    Lot ${lot.lot}: ${lot.address}`);
      console.log(`      Price: ${lot.price ? '£' + lot.price.toLocaleString() : 'N/A'} | Image: ${lot.imageUrl ? '✓' : '✗'} | URL: ${lot.url ? '✓' : '✗'}`);
      if (lot.bullets.length) console.log(`      Bullets: ${lot.bullets.join(' | ')}`);
    }
    if (lots.length > 3) console.log(`    ... and ${lots.length - 3} more`);

    const withImages = lots.filter(l => l.imageUrl).length;
    const withPrices = lots.filter(l => l.price).length;
    const withUrls = lots.filter(l => l.url).length;
    console.log(`\n  Summary: ${lots.length} lots | ${withPrices} prices | ${withImages} images | ${withUrls} URLs`);
    console.log(lots.length > 0 ? '  ✅ PASS' : '  ❌ FAIL');
    console.log('');

    await page.close();
  }

  await browser.close();
})();
