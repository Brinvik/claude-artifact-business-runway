/**
 * Browser tests for business-runway.html.
 * Each test opens the page in headless Chromium with a fake database and checks one behaviour.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const MOCK = require('./mock-claude.js');

const PAGE = path.join(__dirname, '..', 'business-runway.html');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* The published page is wrapped in a skeleton by claude.ai. Do the same here. */
function wrappedFile() {
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
    fs.readFileSync(PAGE, 'utf8') + '</body></html>';
  const file = path.join(os.tmpdir(), 'business-runway-test.html');
  fs.writeFileSync(file, html);
  return 'file://' + file.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:');
}

/* Local month helpers, so the tests keep working in any month */
function ym(offset) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function day(offset, dd) { return ym(offset) + '-' + String(dd).padStart(2, '0'); }

module.exports = async function run(report) {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const url = wrappedFile();

  async function open(opts) {
    opts = opts || {};
    const page = await browser.newPage({ viewport: opts.viewport || { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());   // no network needed for tests
    if (opts.mock !== false) await page.addInitScript(MOCK);
    await page.goto(url);
    await page.waitForTimeout(400);
    page.errors = errors;
    return page;
  }
  const text = (page, sel) => page.$eval(sel, e => e.textContent);
  const closing = page => page.$$eval('#cashTbody tr', rows => rows.map(r => r.lastChild.textContent));
  const costs = page => page.$$eval('#cashTbody tr', rows => rows.map(r => r.children[2].textContent));
  async function test(name, fn) {
    try { await fn(); report(true, name); }
    catch (e) { report(false, name, e && e.message); }
  }

  await test('opens without errors and shows the empty-page guide', async () => {
    const page = await open();
    assert.strictEqual(await page.$eval('#onboard', e => e.hidden), false);
    assert.match(await text(page, '#onboard'), /Nothing in here yet/);
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });

  await test('example mode shows numbers and saves nothing', async () => {
    const page = await open();
    await page.click('#demoOn');
    await page.waitForTimeout(200);
    assert.notStrictEqual(await text(page, '#verdictMonths'), '–');
    assert.match(await text(page, '#verdictText'), /months of runway/);
    const store = await page.evaluate(() => JSON.stringify(window.__store));
    assert.ok(!/Example Studio/.test(store), 'example data must not reach the database');
    await page.click('#demoOff');
    assert.strictEqual(await page.$eval('#onboard', e => e.hidden), false);
    await page.close();
  });

  await test('data from the database cannot run code (XSS)', async () => {
    const page = await open();
    await page.evaluate(() => {
      window.__seed('receipts', {
        'x"><img src=x onerror=window.__pwn1=1>': { date: '2026-01-01', vendor: '<img src=x onerror=window.__pwn2=1>', amountBase: 10, status: 'open', needsDecision: true },
        t: { date: '2026-01-02', vendor: 'Shop', amountBase: 5, thumb: 'x" onerror="window.__pwn3=1' }
      });
      window.__seed('receivables', { o: { client: '<svg onload=window.__pwn4=1>', amountBase: 10 } });
      window.__seed('subscriptions', { s: { name: '<img src=x onerror=window.__pwn5=1>', amount: 1 } });
    });
    await page.waitForTimeout(400);
    const pwned = await page.evaluate(() => [window.__pwn1, window.__pwn2, window.__pwn3, window.__pwn4, window.__pwn5].filter(Boolean).length);
    assert.strictEqual(pwned, 0);
    await page.close();
  });

  await test('overdue unpaid bills are charged in the current month', async () => {
    const page = await open();
    await page.evaluate((d) => window.__seed('receipts', { b: { date: d, vendor: 'Landlord', amountBase: 5000, paid: false, dueDate: d, status: 'business' } }), day(-2, 1));
    await page.waitForTimeout(300);
    assert.strictEqual((await costs(page))[0].replace(/[^0-9]/g, ''), '5000');
    await page.close();
  });

  await test('yearly costs are charged in full in their renewal month', async () => {
    const page = await open();
    await page.evaluate((m) => window.__seed('subscriptions', { y: { name: 'Yearly tool', amount: 1200, currency: 'EUR', cadence: 'year', nextCharge: m } }), ym(2));
    await page.waitForTimeout(300);
    const c = (await costs(page)).map(v => v.replace(/[^0-9]/g, ''));
    assert.deepStrictEqual([c[0], c[1], c[2], c[3]], ['0', '0', '1200', '0']);
    await page.close();
  });

  await test('invoices owed count in the forecast, but not when more than 60 days late', async () => {
    const page = await open();
    await page.evaluate(([late, soon]) => window.__seed('receivables', {
      late: { client: 'Late', amountBase: 5000, expectedDate: late },
      soon: { client: 'Soon', amountBase: 1000, expectedDate: soon }
    }), [day(-4, 1), day(1, 10)]);
    await page.waitForTimeout(300);
    assert.match(await text(page, '#owedTotal'), /1,000 counted, plus .*5,000 doubtful/);
    const rev = await page.$$eval('#cashTbody tr', rows => rows.slice(0, 2).map(r => r.children[1].textContent.replace(/[^0-9]/g, '')));
    assert.deepStrictEqual(rev, ['0', '1000']);
    await page.close();
  });

  await test('a bill from the same supplier only replaces a subscription when the amount is close', async () => {
    const page = await open();
    await page.evaluate((d) => {
      window.__seed('subscriptions', { g: { name: 'Google Workspace', amount: 100, currency: 'EUR', cadence: 'month' } });
      window.__seed('receipts', { ads: { date: d, vendor: 'Google Ads', amountBase: 900, paid: false, dueDate: d, status: 'business' } });
    }, day(0, 28));
    await page.waitForTimeout(300);
    assert.strictEqual((await costs(page))[0].replace(/[^0-9]/g, ''), '1000');
    await page.close();
  });

  await test('the plan saves months as YYYY-MM', async () => {
    const page = await open();
    await page.fill('#bankInput', '12345');
    await page.dispatchEvent('#bankInput', 'input');
    await page.waitForTimeout(900);
    const plan = await page.evaluate(() => window.__store.settings.plan);
    assert.strictEqual(plan.bank, 12345);
    assert.match(plan.revStart, /^\d{4}-\d{2}$/);
    await page.close();
  });

  await test('an owner pay of 0 stays 0', async () => {
    const page = await open();
    await page.fill('#drawNet', '0');
    await page.dispatchEvent('#drawNet', 'input');
    await page.waitForTimeout(100);
    assert.match(await text(page, '#lvl3label'), /plus .*0 to you/);
    await page.close();
  });

  await test('new categories show up in the filters without a reload', async () => {
    const page = await open();
    await page.evaluate(() => window.__seed('receipts', { n: { date: '2026-01-05', vendor: 'New', amountBase: 1, category: 'Brand new category', status: 'business' } }));
    await page.waitForTimeout(300);
    const chips = await page.$$eval('#fCat .chip', cs => cs.map(c => c.textContent));
    assert.ok(chips.includes('Brand new category'));
    await page.close();
  });

  await test('broken settings do not break the page', async () => {
    const page = await open();
    await page.evaluate(() => window.__setDoc('settings/config', { locale: 'xx-INVALID', currency: 'NOPE', vat: -5, tax: 500, founders: 'abc', fx: 'garbage' }));
    await page.waitForTimeout(300);
    const curs = await page.$$eval('#wiCur option', o => o.map(x => x.value));
    assert.deepStrictEqual(curs, ['EUR']);
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });

  await test('the receipt picture opens and closes with the keyboard', async () => {
    const page = await open();
    await page.evaluate((png) => window.__seed('receipts', { r: { date: '2026-01-02', vendor: 'Shop', amountBase: 10, status: 'open', needsDecision: true, source: 'photo', thumb: png } }), PNG);
    await page.waitForTimeout(300);
    await page.focus('#triageOpen img[data-zoom]');
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'lightboxClose');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.$eval('#lightbox', e => e.hidden), true);
    assert.strictEqual(await page.evaluate(() => document.activeElement.getAttribute('data-zoom')), 'r');
    await page.close();
  });

  await test('fits a phone screen without sideways scrolling', async () => {
    const page = await open({ viewport: { width: 375, height: 800 } });
    await page.click('#demoOn');
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 375);
    await page.close();
  });

  await test('works without claude.ai, with a clear message', async () => {
    const page = await open({ mock: false });
    assert.match(await text(page, '#triageState'), /claude\.ai/);
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });

  await browser.close();
};
