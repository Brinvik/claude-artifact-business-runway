/**
 * Business Runway: save receipts from Gmail into Google Drive, sorted by month.
 * Free template from Brinvik. MIT license.
 *
 * What it does
 *  - Finds emails with a PDF or image attachment that looks like an invoice or receipt.
 *  - Saves the file into Drive: Receipts/2026-09/2026-09-02_sender.com_ab12cd_filename.pdf
 *  - Moves anything you drop into Receipts/_INBOX (photos from your phone) into the right month.
 *  - Files it is unsure about go to Receipts/_CHECK-ME.
 *  - Adds the Gmail label "Receipt saved" so you can see what it has handled.
 *
 * What it never does
 *  - It never deletes, forwards or sends email. It has no code that sends anything.
 *  - It sends no data outside your own Google account.
 *
 * Access Google will ask for
 *  - Gmail: read your mail and add labels. Google shows this as full Gmail access,
 *    because the built-in Gmail service in Apps Script asks for it.
 *  - Drive: create folders and files, and move the photos you drop in _INBOX.
 *
 * Setup, about 5 minutes
 *  1. Go to script.google.com and click New project. Name it "Business Runway receipts".
 *  2. Delete the code in the editor and paste all of this file.
 *  3. Click the gear icon (Project Settings) and check that the time zone is where you live.
 *  4. In the menu bar, pick the function "setup" and click Run. Approve the access Google asks for.
 *     This creates the Receipts folder with _INBOX and _CHECK-ME inside.
 *  5. Pick the function "runAll" and click Run once to test it. Open Executions to see the log.
 *  6. Click the clock icon (Triggers), Add trigger: function "runAll", time-driven, every hour.
 *
 * Then tell Claude in your runway chat where the Receipts folder is.
 *
 * Good to know: receipts that arrive as plain email text, with no attachment, are not saved.
 * Forward those to Claude or save them as PDF yourself.
 */

/* ------------------------------------------------------------ settings */

var ROOT_FOLDER_NAME   = 'Receipts';
var INBOX_FOLDER_NAME  = '_INBOX';
var REVIEW_FOLDER_NAME = '_CHECK-ME';
var DONE_LABEL         = 'Receipt saved';
var FIRST_RUN_DAYS     = 180;             // how far back the very first run looks
var PAGE_SIZE          = 50;              // threads per search page
var MAX_BYTES          = 8 * 1024 * 1024; // files bigger than 8 MB go to _CHECK-ME
var TIME_BUDGET_MS     = 4.5 * 60 * 1000; // stop before Google's 6 minute limit, the next run continues

/**
 * Optional. Only look at mail from these senders, for example ['stripe.com', 'google.com'].
 * Leave empty to look at all mail with an attachment, sorted by the words below.
 */
var ONLY_FROM = [];

/**
 * Words that mean "this is a receipt". They match whole words.
 * A star at the end also matches longer words: 'faktura*' matches "fakturanr".
 * Add words in your own language.
 */
var RECEIPT_WORDS = [
  'invoice*', 'receipt*', 'billing', 'bill', 'bills', 'payment*', 'paid', 'charged',
  'credit note', 'creditnote', 'refund*', 'order confirmation', 'statement', 'subscription*', 'renewal',
  'faktura*', 'kvittering*', 'regning*', 'rechnung*', 'quittung*', 'kvitto*', 'factuur*', 'facture*', 'recu'
];

/** Words that mean "this is not a receipt", even from a known sender. Same matching rules. */
var NOT_RECEIPT_WORDS = [
  'contract*', 'agreement*', 'terms', 'nda', 'dpa', 'policy', 'privacy', 'guide*', 'whitepaper*',
  'ebook*', 'report*', 'newsletter*', 'brochure*', 'case study', 'presentation*', 'slides', 'deck',
  'roadmap*', 'security', 'certificate*', 'onboarding', 'manual*', 'handbook*', 'release notes',
  'changelog*', 'survey*', 'webinar*', 'invitation*', 'agenda*', 'kontrakt*', 'vertrag*'
];

/* ------------------------------------------------------------- run these */

/** Run once. Creates the folders and remembers where they are. */
function setup() {
  var props = PropertiesService.getUserProperties();
  var root = props.getProperty('ROOT_ID') ? DriveApp.getFolderById(props.getProperty('ROOT_ID'))
                                          : getOrCreate_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  var inbox = getOrCreate_(root, INBOX_FOLDER_NAME);
  getOrCreate_(root, REVIEW_FOLDER_NAME);
  props.setProperty('ROOT_ID', root.getId());
  props.setProperty('INBOX_ID', inbox.getId());
  Logger.log('Ready. Time zone used for month folders: ' + Session.getScriptTimeZone());
  Logger.log('Receipts folder: ' + root.getUrl());
  Logger.log('Drop phone photos in: ' + inbox.getUrl());
}

/** Put this on a time trigger. */
function runAll() {
  var started = Date.now();
  saveFromGmail(started);
  sortInbox(started);
}

/* ---------------------------------------------------------------- Gmail */

/**
 * Reads mail newer than the last finished run. It works per message, not per thread,
 * so next month's invoice in the same email thread is still picked up.
 * The checkpoint only moves forward when every matching thread has been read,
 * so a run that stops early never skips mail. Files already saved are recognised by name.
 */
function saveFromGmail(started) {
  var props = PropertiesService.getUserProperties();
  var root = rootFolder_();
  var review = getOrCreate_(root, REVIEW_FOLDER_NAME);
  var label = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  var tz = Session.getScriptTimeZone();
  var known = existingNames_(root);

  var since = Number(props.getProperty('GMAIL_SINCE')) || (Date.now() - FIRST_RUN_DAYS * 86400000);
  var runStart = Date.now();
  var query = 'has:attachment after:' + Math.floor(since / 1000) +
    ' (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png OR filename:heic OR filename:webp)';
  if (ONLY_FROM.length) {
    query += ' (' + ONLY_FROM.map(function (s) { return 'from:' + s; }).join(' OR ') + ')';
  }

  var saved = 0, toCheck = 0, skipped = 0, duplicates = 0, finished = true;

  for (var start = 0; ; start += PAGE_SIZE) {
    var threads = GmailApp.search(query, start, PAGE_SIZE);
    if (!threads.length) { break; }

    for (var t = 0; t < threads.length; t++) {
      if (Date.now() - started > TIME_BUDGET_MS) { finished = false; break; }
      var messages = threads[t].getMessages();

      for (var m = 0; m < messages.length; m++) {
        var msg = messages[m];
        if (msg.getDate().getTime() < since) { continue; }   // already handled in an earlier run

        var subject = msg.getSubject();
        var month = Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM');
        var day = Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd');
        var sender = senderDomain_(msg.getFrom());
        var msgTag = shortId_(msg.getId());
        var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });

        for (var a = 0; a < atts.length; a++) {
          var att = atts[a];
          var name = att.getName() || 'file';
          var type = att.getContentType() || '';
          var isPdf = type === 'application/pdf' || /\.pdf$/i.test(name);
          var isImage = /^image\/(jpeg|png|heic|heif|webp)$/i.test(type);
          if (!isPdf && !isImage) { continue; }

          if (matchesAny_(name, NOT_RECEIPT_WORDS) || matchesAny_(subject, NOT_RECEIPT_WORDS)) { skipped++; continue; }

          var looksRight = matchesAny_(name, RECEIPT_WORDS) || matchesAny_(subject, RECEIPT_WORDS);
          if (!looksRight && !ONLY_FROM.length) { skipped++; continue; }

          // the message id part keeps two receipts with the same file name apart
          var target = safeName_(day + '_' + sender + '_' + msgTag + '-' + a + '_' + name);
          if (known[target]) { duplicates++; continue; }

          var tooBig = att.getSize() > MAX_BYTES;
          var folder = (looksRight && !tooBig) ? getOrCreate_(root, month) : review;
          folder.createFile(att.copyBlob().setName(target));
          known[target] = true;

          if (folder === review) { toCheck++; } else { saved++; }
        }
      }
      threads[t].addLabel(label);
    }

    if (!finished || threads.length < PAGE_SIZE) { break; }
  }

  if (finished) { props.setProperty('GMAIL_SINCE', String(runStart - 60 * 60 * 1000)); }

  Logger.log('Gmail: saved ' + saved + ', to check in ' + REVIEW_FOLDER_NAME + ' ' + toCheck +
             ', skipped ' + skipped + ', already saved ' + duplicates +
             (finished ? '' : '. Stopped early to stay inside the time limit, the next run continues.'));
}

/* ------------------------------------------------------ _INBOX from phone */

/** Moves everything in _INBOX into its month. Uses a date at the start of the name, else the upload date. */
function sortInbox(started) {
  var root = rootFolder_();
  var inboxId = PropertiesService.getUserProperties().getProperty('INBOX_ID');
  if (!inboxId) { throw new Error('Run setup first.'); }
  var inbox = DriveApp.getFolderById(inboxId);
  var tz = Session.getScriptTimeZone();
  var moved = 0, left = 0, failed = 0;

  var files = inbox.getFiles();
  while (files.hasNext()) {
    if (started && Date.now() - started > TIME_BUDGET_MS) { break; }
    var f = files.next();
    var name = f.getName();
    var d = /^(\d{4})-(\d{2})-\d{2}/.exec(name);
    var month = d ? (d[1] + '-' + d[2]) : Utilities.formatDate(f.getDateCreated(), tz, 'yyyy-MM');
    var folder = getOrCreate_(root, month);
    if (folder.getFilesByName(name).hasNext()) { left++; continue; }
    try {
      f.moveTo(folder);
      moved++;
    } catch (e) {
      failed++;
      Logger.log('Could not move "' + name + '". It may be shared with you rather than yours. ' + e.message);
    }
  }
  Logger.log('_INBOX: moved ' + moved + ', left because the name exists ' + left + ', could not move ' + failed);
}

/* -------------------------------------------------------------- helpers */

function rootFolder_() {
  var id = PropertiesService.getUserProperties().getProperty('ROOT_ID');
  if (!id) { throw new Error('Run setup first.'); }
  return DriveApp.getFolderById(id);
}

function getOrCreate_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Reads every file name under Receipts once per run, instead of searching folders for each file. */
function existingNames_(root) {
  var names = {};
  var addFiles = function (folder) {
    var files = folder.getFiles();
    while (files.hasNext()) { names[files.next().getName()] = true; }
  };
  addFiles(root);
  var folders = root.getFolders();
  while (folders.hasNext()) { addFiles(folders.next()); }
  return names;
}

/** Lowercase and strip accents, so "opkrævning" and "opkraevning" match the same word. */
function normalise_(text) {
  return String(text || '').toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Whole-word match. A trailing * lets the last word run on: 'faktura*' matches "fakturanr". */
function matchesAny_(haystack, needles) {
  var h = ' ' + normalise_(haystack).replace(/[^a-z0-9]+/g, ' ') + ' ';
  for (var i = 0; i < needles.length; i++) {
    var raw = String(needles[i]);
    var prefix = raw.slice(-1) === '*';
    var n = normalise_(prefix ? raw.slice(0, -1) : raw).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!n) { continue; }
    if (prefix ? h.indexOf(' ' + n) !== -1 : h.indexOf(' ' + n + ' ') !== -1) { return true; }
  }
  return false;
}

/** Keeps only the domain of the sender, so personal addresses do not end up in file names. */
function senderDomain_(fromHeader) {
  var match = /@([A-Za-z0-9.-]+)/.exec(fromHeader || '');
  return match ? match[1].toLowerCase() : 'unknown';
}

function shortId_(id) {
  return String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'msg';
}

function safeName_(name) {
  return String(name).replace(/[\\\/:*?"<>|]/g, '_').slice(0, 180);
}
