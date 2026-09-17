# Business Runway, a Claude artifact

A free Claude artifact that tells you how many months your business can run on the money in the bank. Cash flow forecast, burn rate, break even and receipt tracking in one page, set up by Claude in about 15 minutes.

Made by [Brinvik](https://www.brinvik.com).

⭐ **If it helps you, star the repo.** It is how other founders find it.

I built the first version for my own company. This is the clean template. No data in it.

![Business Runway with example numbers](screenshot.png)

## What you get

- **Months of runway.** How long the cash lasts if nothing comes in.
- **Cash month by month.** Twelve months ahead. Type what you expect to bill and watch the month you run dry move.
- **Break even.** What you have to invoice each month to cover costs and pay yourself.
- **Before you buy it.** Test a laptop, a tool or a hire before you commit.
- **Receipts in one place.** Claude pulls invoices from your email and reads photos of paper receipts. You click Business or Private on the ones it is unsure about.
- **Bills to pay.** Overdue and upcoming, so nothing surprises you.
- **Money owed to you.** Invoices you sent that are not paid yet, placed in the month you expect the cash.
- **Gmail to Drive script.** Optional. Saves invoices from Gmail into Drive by month, and sorts phone photos of receipts.

It works in any currency.

## Who it is for

Solo founders, consultants and small teams who want a clear picture of their cash without learning accounting software.

## Setup in three steps

You need a Claude account where artifacts can save data. Around 15 minutes.

1. **Download** `business-runway.html` and `SETUP-PROMPT.md`. On Gmail and Google Drive? Take `receipts-to-drive.gs` too.
2. **Open a new chat in Claude.** Attach the files. Paste the text from `SETUP-PROMPT.md`.
3. **Answer Claude's questions.** About 15 of them: founders, hires, rent, your own pay, ads, unpaid invoices, where your receipts are.

Claude publishes your own private copy and fills it in. Later, say "update my runway" in the same chat.

Want to look before you set anything up? Open the page and press **Show it with example numbers**.

## Your data

- Your copy is private. Only you can open it unless you share it.
- Receipts are stored in your artifact's own database inside your Claude account. Nothing goes to Brinvik or to this repo.
- Claude reads your email only when you ask it to and only for invoices.
- **Do not share the link to your own copy.** Anyone you share it with can see and change your receipts.
- The setup prompt tells Claude to leave out card numbers, bank account numbers and ID numbers. Check the first import yourself.
- The page uses Google Fonts, so Google sees your IP address when the page opens. Prefer not? Tell Claude "use system fonts for my runway page" and it removes them.

## Good to know

- It is a planning tool, not bookkeeping. Keep your accounting system and ask your accountant about tax.
- Exchange rates are the ones you give it. Update them now and then in Settings.
- Photo receipts come in when you ask Claude to update. The page does not watch your folder on its own.
- The Gmail script saves attachments only. Receipts sent as plain email text need to be forwarded to Claude or saved as PDF.
- The Gmail script asks Google for full Gmail access. It has no code that sends, forwards or deletes mail. Read it before you run it, it is short.

## What is in this repo

| File | What it is |
|---|---|
| `business-runway.html` | The page. Claude publishes your own private copy of it. |
| `SETUP-PROMPT.md` | Paste into Claude to set everything up. |
| `receipts-to-drive.gs` | Optional Google Apps Script that saves receipts from Gmail into Google Drive. |
| `tests/` | Automated checks for the page and the script. Only needed if you change the code. |
| `screenshot.png`, `screenshot-mobile.png` | The page in example mode. |

## Videos

- What it is and what you get (coming soon)
- Setting it up in 15 minutes (coming soon)

## Made by

Kim Olsen, [Brinvik](https://brinvik.com). I help companies get more out of Claude.

Found a bug or have an idea? Open an issue. And if the page saved you a spreadsheet, a star helps others find it.

MIT license. Use it, change it, share it. See `LICENSE`.

The license covers the code and the guide. It does not cover the Brinvik name or logo. You can use and rebrand the template freely, but do not present your version as made or endorsed by Brinvik.
