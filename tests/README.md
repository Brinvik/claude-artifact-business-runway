# Tests

Checks that the page and the Gmail script still behave after a change. You do not need them to use the kit.

## Run them on Windows

You need [Node.js](https://nodejs.org) 18 or newer. Open PowerShell in the `tests` folder:

```powershell
npm install
npx playwright install chromium
npm test
```

Every line says PASS or FAIL. The last line counts them.

## What they check

**business-runway.html**, in a real browser with a fake database:

- opens without errors, and example mode saves nothing
- data from the database cannot run code
- overdue bills, yearly costs and money owed land in the right month
- a bill only replaces a subscription when the amount is close
- the plan is saved by month, and a pay of 0 stays 0
- new categories appear in the filters, and broken settings do not break the page
- the receipt picture works with the keyboard, and the page fits a phone
- outside Cowork it saves in claude.ai storage or the browser, imports are checked and cannot run code, user choices survive a new import, and the skill zip matches the repo

**receipts-to-drive.gs**, in Node with fake Gmail and Drive:

- calendar invites cannot block receipts
- two receipts with the same file name are both kept
- a new invoice in an old email thread is still saved
- whole-word matching, non-receipts skipped, no personal email addresses in file names
- no code that sends, forwards or deletes mail

The fakes are simple. Passing tests do not prove that Gmail or claude.ai behave the same way, so test a real install too.
