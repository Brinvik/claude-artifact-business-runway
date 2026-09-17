/** Runs every test file and prints one line per test. Exit code 1 if anything fails. */
let passed = 0, failed = 0;
function report(ok, name, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why.split('\n')[0] : '')); }
}
(async () => {
  console.log('\nreceipts-to-drive.gs');
  await require('./drive-script.test.js')(report);
  console.log('\nbusiness-runway.html');
  await require('./page.test.js')(report);
  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
