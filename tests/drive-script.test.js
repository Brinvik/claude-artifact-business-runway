/**
 * Tests for receipts-to-drive.gs, run in Node against fake Gmail and Drive services.
 * The fakes are simple, so these tests check the script's own logic, not Google's.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const fakeGoogle = require('./fake-google.js');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'receipts-to-drive.gs'), 'utf8');
const at = s => new Date(s + 'T10:00:00Z');

function load(threads, now) {
  const g = fakeGoogle({ threads });
  const ctx = vm.createContext(Object.assign({ console, Math, String, Number, Object, Error, RegExp, JSON, Array }, g));
  const RealDate = Date;
  let clock = new RealDate(now).getTime();
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(clock); }
  FakeDate.now = () => clock;
  FakeDate.prototype = RealDate.prototype;
  ctx.Date = FakeDate;
  vm.runInContext(SCRIPT, ctx);
  g.setNow = s => { clock = new RealDate(s).getTime(); };
  g.call = code => vm.runInContext(code, ctx);
  g.ctx = ctx;
  return g;
}
const pdf = name => ({ name, type: 'application/pdf' });
const saved = g => g.allNames().filter(n => !n.startsWith('_INBOX/') && !n.includes('_INBOX/'));

module.exports = async function run(report) {
  function test(name, fn) {
    try { fn(); report(true, name); } catch (e) { report(false, name, e && e.message); }
  }

  test('a busy inbox of calendar invites does not block receipts', () => {
    const threads = [];
    for (let i = 0; i < 60; i++) threads.push({ id: 'i' + i, messages: [{ id: 'I' + i, date: at('2026-09-10'), subject: 'Invitation', from: 'a@cal.com', atts: [{ name: 'invite.ics', type: 'text/calendar' }] }] });
    threads.push({ id: 'r', messages: [{ id: 'R1', date: at('2026-09-01'), subject: 'Your receipt', from: 'billing@shop.com', atts: [pdf('receipt.pdf')] }] });
    const g = load(threads, '2026-09-17T12:00:00Z');
    g.call('setup(); runAll();');
    assert.strictEqual(saved(g).filter(n => /receipt\.pdf$/.test(n)).length, 1);
  });

  test('two receipts with the same file name on the same day are both kept', () => {
    const threads = [
      { id: 'a', messages: [{ id: 'AAA111', date: at('2026-09-06'), subject: 'Invoice', from: 'b@vendor.com', atts: [pdf('invoice.pdf')] }] },
      { id: 'b', messages: [{ id: 'BBB222', date: at('2026-09-06'), subject: 'Invoice', from: 'b@vendor.com', atts: [pdf('invoice.pdf')] }] }
    ];
    const g = load(threads, '2026-09-17T12:00:00Z');
    g.call('setup(); runAll();');
    assert.strictEqual(saved(g).filter(n => /invoice\.pdf$/.test(n)).length, 2);
  });

  test('a new invoice in a thread that was already handled is still saved', () => {
    const thread = { id: 'm', messages: [{ id: 'OLD111', date: at('2026-08-13'), subject: 'Your receipt', from: 'billing@ai.com', atts: [pdf('Receipt-0813.pdf')] }] };
    const g = load([thread], '2026-09-01T12:00:00Z');
    g.call('setup(); runAll();');
    thread.messages.push({ id: 'NEW222', date: new Date('2026-09-13T10:00:00Z'), subject: 'Your receipt', from: 'billing@ai.com', atts: [pdf('Receipt-0913.pdf')] });
    g.setNow('2026-09-13T12:00:00Z');
    g.call('runAll();');
    assert.strictEqual(saved(g).filter(n => /Receipt-0913\.pdf$/.test(n)).length, 1);
    assert.strictEqual(saved(g).filter(n => /Receipt-0813\.pdf$/.test(n)).length, 1, 'the old one must not be saved twice');
  });

  test('word matching uses whole words', () => {
    const g = load([], '2026-09-17T12:00:00Z');
    const m = (t, list) => g.call('matchesAny_(' + JSON.stringify(t) + ', ' + list + ')');
    assert.strictEqual(m('Invoice-2026-09.pdf', 'RECEIPT_WORDS'), true);
    assert.strictEqual(m('Fakturanr 1234', 'RECEIPT_WORDS'), true);
    assert.strictEqual(m('1 billion users.pdf', 'RECEIPT_WORDS'), false);
    assert.strictEqual(m('Border map.pdf', 'RECEIPT_WORDS'), false);
    assert.strictEqual(m('Terms of Service', 'NOT_RECEIPT_WORDS'), true);
  });

  test('non-receipts are skipped and only sender domains go in file names', () => {
    const threads = [
      { id: 'c', messages: [{ id: 'CCC333', date: at('2026-09-05'), subject: 'Contract for signature', from: 'Jane Doe <jane.doe@firm.com>', atts: [pdf('contract.pdf')] }] },
      { id: 'd', messages: [{ id: 'DDD444', date: at('2026-09-05'), subject: 'Receipt', from: 'Jane Doe <jane.doe@firm.com>', atts: [pdf('r.pdf')] }] }
    ];
    const g = load(threads, '2026-09-17T12:00:00Z');
    g.call('setup(); runAll();');
    const names = saved(g);
    assert.ok(!names.some(n => /contract/.test(n)));
    assert.ok(names.some(n => /_firm\.com_/.test(n)) && !names.some(n => /jane/.test(n)));
  });

  test('the script contains no code that sends email', () => {
    assert.ok(!/MailApp|GmailApp\.sendEmail|\.forward\(|moveToTrash|\.trash\(/.test(SCRIPT));
  });
};
