import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.goto('https://www.barnettross.co.uk/current.php', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));

  const data = await page.evaluate(() => {
    // Check table structure
    const tables = document.querySelectorAll('table');
    const tableInfo = Array.from(tables).map(t => ({
      class: t.className,
      id: t.id,
      rows: t.rows.length,
      firstRowHTML: t.rows[0] ? t.rows[0].outerHTML.substring(0, 500) : ''
    }));

    // Get lot rows - look for rows with lot numbers or £ prices
    const allRows = document.querySelectorAll('tr');
    const lotRows = Array.from(allRows).filter(r => {
      const text = r.textContent;
      return text.match(/£[\d,]+/) && text.match(/\d+/) && r.cells && r.cells.length >= 3;
    });

    const samples = lotRows.slice(0, 3).map(r => ({
      cells: Array.from(r.cells).map(c => ({
        text: c.textContent.trim().substring(0, 150),
        html: c.innerHTML.substring(0, 300),
        class: c.className
      })),
      class: r.className,
      html: r.outerHTML.substring(0, 800)
    }));

    // Check for links in lot rows
    const lotLinks = lotRows.slice(0, 3).map(r => {
      const links = Array.from(r.querySelectorAll('a'));
      return links.map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 80) }));
    });

    // Check for images
    const lotImages = lotRows.slice(0, 3).map(r => {
      const imgs = Array.from(r.querySelectorAll('img'));
      return imgs.map(i => i.src);
    });

    return { tableInfo, samples, lotLinks, lotImages, lotRowCount: lotRows.length };
  });

  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
