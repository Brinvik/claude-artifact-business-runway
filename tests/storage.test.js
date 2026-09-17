/**
 * Tests for saving outside Cowork: the browser store, the claude.ai chat store,
 * import from Claude, backups and the safety checks on imported files.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'business-runway.html'), 'utf8');
const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + PAGE + '</body></html>';
const ORIGIN = 'https://runway.test/';

/* A stand-in for the chat artifact store: window.storage.get/set/delete/list with a shared flag.
   Data lives in window.__kv so a test can carry it to a fresh page. */
const CHAT_STORE = `
(function(){
  var kv = window.__kvSeed ? JSON.parse(window.__kvSeed) : {};
  window.__kv = kv; window.__kvCalls = 0;
  function key(k, shared){ if(shared) throw new Error('shared storage must not be used'); if(/[\\s\\/]/.test(k) || k.length > 200) throw new Error('bad key'); return k; }
  window.storage = {
    get: async function(k, shared){ window.__kvCalls++; k = key(k, shared); if(!(k in kv)) throw new Error('Key not found'); return {key:k, value:kv[k], shared:false}; },
    set: async function(k, v, shared){ window.__kvCalls++; k = key(k, shared); if(typeof v !== 'string') throw new Error('text only'); if(v.length > 5000000) throw new Error('too big'); kv[k] = v; return {key:k, value:v, shared:false}; },
    delete: async function(k, shared){ k = key(k, shared); delete kv[k]; return {key:k, deleted:true, shared:false}; },
    list: async function(p, shared){ return {keys:Object.keys(kv).filter(function(k){ return !p || k.indexOf(p) === 0; })}; }
  };
})();`;

function importFile(extra) {
  return Object.assign({
    format: 'business-runway', version: 1,
    config: { name: 'Test Co', currency: 'EUR', locale: 'en-GB', vat: 25, reclaim: true, tax: 30, founders: 1 },
    subscriptions: { claude: { name: 'Claude', what: 'Pro', amount: 20, currency: 'EUR', cadence: 'month', vat: false, active: true, kind: 'software' } },
    receipts: {
      '2026-09-02-print-shop': { date: '2026-09-02', vendor: 'Print shop', amountBase: 125, currency: 'EUR', category: 'Other', status: 'open', needsDecision: true, source: 'email', addedAt: '2026-09-10T10:00:00Z' }
    },
    receivables: { 'inv-1': { client: 'Client A', amountBase: 3000, expectedDate: '2026-10-15', paid: false } },
    questions: {}
  }, extra || {});
}

module.exports = async function run(report) {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  async function test(name, fn) { try { await fn(); report(true, name); } catch (e) { report(false, name, e && e.message); } }

  async function open(ctx, opts) {
    opts = opts || {};
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.route(ORIGIN, r => r.fulfill({ status: 200, contentType: 'text/html', body: HTML }));
    if (opts.kvSeed !== undefined) await page.addInitScript(s => { window.__kvSeed = s; }, opts.kvSeed);
    if (opts.chat) await page.addInitScript(CHAT_STORE);
    await page.goto(ORIGIN);
    await page.waitForTimeout(500);
    page.errors = errors;
    return page;
  }
  async function doImport(page, obj) {
    await page.fill('#impText', typeof obj === 'string' ? obj : JSON.stringify(obj));
    await page.click('#impCheck');
    await page.waitForTimeout(150);
    return page.$eval('#impResult', e => e.textContent);
  }
  async function confirmImport(page) {
    await page.click('#impGo');
    await page.waitForTimeout(1600); /* saves are grouped, give them time */
  }

  await test('browser: an import survives a reload', async () => {
    const ctx = await browser.newContext();
    let page = await open(ctx);
    assert.match(await page.$eval('#storeNote', e => e.textContent), /this browser only/);
    const msg = await doImport(page, importFile());
    assert.match(msg, /Found 1 receipt, 1 recurring cost, 1 unpaid invoice/);
    await confirmImport(page);
    assert.match(await page.$eval('#impResult', e => e.textContent), /Imported/);
    await page.close();
    page = await open(ctx);
    await page.waitForTimeout(400);
    assert.strictEqual(await page.$eval('#stName', e => e.value), 'Test Co');
    assert.strictEqual(await page.$eval('#onboard', e => e.hidden), true);
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  });

  await test('chat: saves in personal storage only and loads it back', async () => {
    const ctx = await browser.newContext();
    let page = await open(ctx, { chat: true });
    assert.match(await page.$eval('#storeNote', e => e.textContent), /Only you can see/);
    await doImport(page, importFile());
    await confirmImport(page);
    const kv = await page.evaluate(() => JSON.stringify(window.__kv));
    assert.ok(/business-runway:v1:receipts/.test(kv), 'receipts saved');
    const calls = await page.evaluate(() => window.__kvCalls);
    assert.ok(calls < 40, 'saves are grouped, got ' + calls + ' storage calls');
    await page.close();
    page = await open(ctx, { chat: true, kvSeed: kv });
    await page.waitForTimeout(400);
    assert.strictEqual(await page.$eval('#stName', e => e.value), 'Test Co');
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  });

  await test('import keeps a business or private choice the user already made', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, { chat: true });
    await doImport(page, importFile()); await confirmImport(page);
    /* make the choice the same way the page does */
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#triageOpen button')].find(x => /business/i.test(x.textContent));
      if (b) { b.click(); return true; } return false;
    });
    assert.ok(clicked, 'a Business button was found');
    await page.waitForTimeout(1600);
    const second = importFile(); second.receipts['2026-09-02-print-shop'].status = 'open'; second.receipts['2026-09-02-print-shop'].amountBase = 130;
    const msg = await doImport(page, second);
    assert.match(msg, /Keeping the choices you already made: 1/);
    await confirmImport(page);
    const doc = await page.evaluate(() => JSON.parse(window.__kv['business-runway:v1:receipts:0'])['2026-09-02-print-shop']);
    assert.strictEqual(doc.status, 'business');
    assert.strictEqual(doc.amountBase, 130);
    await ctx.close();
  });

  await test('imported text cannot run code or pollute objects', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, { chat: true });
    const bad = importFile({
      receipts: {
        'x"><img src=x onerror=window.__pwn1=1>': { vendor: 'bad id' },
        evil: { date: '2026-09-03', vendor: '<img src=x onerror=window.__pwn2=1>', amountBase: 5, status: 'open', needsDecision: true, thumb: 'javascript:window.__pwn3=1' }
      },
      subscriptions: { s: { name: '<svg onload=window.__pwn4=1>', amount: 1, cadence: 'month' } }
    });
    const text = JSON.stringify(bad).replace('"format"', '"__proto__":{"polluted":1},"format"').replace('"vendor":"bad id"', '"vendor":"bad id","__proto__":{"polluted":2}');
    const msg = await doImport(page, text);
    assert.match(msg, /broken id: 1/);
    await confirmImport(page);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ pwn: [window.__pwn1, window.__pwn2, window.__pwn3, window.__pwn4].filter(Boolean).length, polluted: ({}).polluted, thumb: JSON.parse(window.__kv['business-runway:v1:receipts:0']).evil.thumb }));
    assert.strictEqual(r.pwn, 0); assert.strictEqual(r.polluted, undefined); assert.strictEqual(r.thumb, undefined);
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  });

  await test('wrong files are refused with a plain message', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx);
    assert.match(await doImport(page, 'not json'), /could not be read as JSON/);
    assert.match(await doImport(page, { hello: 1 }), /not a Business Runway file/);
    assert.match(await doImport(page, { format: 'business-runway', version: 2 }), /newer version/);
    assert.strictEqual(await page.$eval('#impConfirmRow', e => e.hidden), true);
    await ctx.close();
  });

  await test('large data is split into parts under the size limit and loads back', async () => {
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    let page = await open(ctx, { chat: true });
    const big = importFile(); const png = 'data:image/png;base64,' + 'A'.repeat(280000);
    for (let i = 0; i < 25; i++) big.receipts['2026-08-' + String(i + 1).padStart(2, '0') + '-shop'] = { date: '2026-08-01', vendor: 'Shop ' + i, amountBase: 10, status: 'business', source: 'photo', thumb: png };
    await doImport(page, big); await confirmImport(page); await page.waitForTimeout(800);
    const kv = await page.evaluate(() => JSON.stringify(window.__kv));
    const head = await page.evaluate(() => JSON.parse(window.__kv['business-runway:v1:receipts']));
    assert.ok(head.chunks >= 4, 'expected several parts, got ' + head.chunks);
    await page.close();
    page = await open(ctx, { chat: true, kvSeed: kv });
    await page.waitForTimeout(600);
    await page.click('#expShort'); await page.waitForTimeout(200);
    const back = JSON.parse(await page.$eval('#expBox', e => e.value));
    assert.strictEqual(Object.keys(back.receipts).length, 26);
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  });

  await test('the short copy for Claude leaves out pictures', async () => {
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await open(ctx, { chat: true });
    const f = importFile(); f.receipts['2026-09-02-print-shop'].thumb = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await doImport(page, f); await confirmImport(page);
    await page.click('#expShort'); await page.waitForTimeout(200);
    const out = JSON.parse(await page.$eval('#expBox', e => e.value));
    assert.strictEqual(out.format, 'business-runway');
    assert.strictEqual(out.receipts['2026-09-02-print-shop'].thumb, undefined);
    assert.strictEqual(out.receipts['2026-09-02-print-shop'].amountBase, 125);
    await ctx.close();
  });

  await test('the example cannot be imported into or backed up', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx);
    await page.click('#demoOn');
    assert.match(await doImport(page, importFile()), /Leave the example first/);
    await ctx.close();
  });

  await test('if saved data cannot be read, nothing gets overwritten', async () => {
    const ctx = await browser.newContext();
    const seed = JSON.stringify({ 'business-runway:v1:receipts': JSON.stringify({ v: 1, chunks: 1 }), 'business-runway:v1:receipts:0': '{"keep":{"vendor":"Old"}}' });
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.route(ORIGIN, r => r.fulfill({ status: 200, contentType: 'text/html', body: HTML }));
    await page.addInitScript(s => { window.__kvSeed = s; }, seed);
    await page.addInitScript(CHAT_STORE);
    await page.addInitScript(() => { const g = window.storage.get; window.storage.get = async function(k, sh){ if (/receipts:0$/.test(k)) throw new Error('network down'); return g(k, sh); }; });
    await page.goto(ORIGIN); await page.waitForTimeout(600);
    assert.match(await page.$eval('#storeNote', e => e.textContent), /could not be read/);
    await page.fill('#impText', JSON.stringify(importFile())); await page.click('#impCheck'); await page.waitForTimeout(150);
    await page.click('#impGo'); await page.waitForTimeout(1500);
    assert.match(await page.$eval('#impResult', e => e.textContent), /Import stopped/);
    const kept = await page.evaluate(() => window.__kv['business-runway:v1:receipts:0']);
    assert.strictEqual(kept, '{"keep":{"vendor":"Old"}}');
    await ctx.close();
  });

  await test('the skill zip carries the same page and script as the repo', async () => {
    const zlib = require('zlib');
    const zipPath = path.join(__dirname, '..', 'business-runway-skill.zip');
    assert.ok(fs.existsSync(zipPath), 'business-runway-skill.zip is missing');
    const buf = fs.readFileSync(zipPath);
    /* read the zip's central directory, no extra tools needed */
    let eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(eocd >= 0, 'not a zip file');
    const count = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16);
    const files = {};
    for (let i = 0; i < count; i++) {
      const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
      const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32), local = buf.readUInt32LE(off + 42);
      const name = buf.slice(off + 46, off + 46 + nlen).toString();
      const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
      const data = buf.slice(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
      files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
      off += 46 + nlen + xlen + clen;
    }
    ['business-runway/SKILL.md', 'business-runway/assets/business-runway.html', 'business-runway/assets/receipts-to-drive.gs', 'business-runway/references/data-format.md', 'business-runway/references/receipts.md']
      .forEach(f => assert.ok(files[f], f + ' missing in zip'));
    assert.ok(files['business-runway/assets/business-runway.html'].toString() === PAGE, 'the page in the zip differs from business-runway.html');
    assert.ok(files['business-runway/assets/receipts-to-drive.gs'].toString() === fs.readFileSync(path.join(__dirname, '..', 'receipts-to-drive.gs'), 'utf8'), 'the script in the zip differs');
    const desc = /description: (.*)/.exec(files['business-runway/SKILL.md'].toString());
    assert.ok(desc && desc[1].length <= 200, 'skill description must be 200 characters or less');
  });

  await browser.close();
};
