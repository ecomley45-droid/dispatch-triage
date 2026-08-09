// In-app help content + a tiny keyword search. Search tokenizes the query,
// drops common "stop" words, and ranks articles by where the remaining terms
// hit (title > keywords > body). No backend — everything is client-side.

// Common words ignored during search so they don't dilute ranking.
export const STOP_WORDS = new Set([
  'a', 'an', 'and', 'or', 'but', 'the', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
  'from', 'is', 'are', 'am', 'be', 'been', 'was', 'were', 'as', 'it', 'its', 'this', 'that',
  'these', 'those', 'you', 'your', 'yours', 'we', 'our', 'i', 'me', 'my', 'how', 'do', 'does',
  'did', 'can', 'could', 'should', 'would', 'will', 'if', 'when', 'what', 'why', 'where',
  'then', 'than', 'into', 'out', 'up', 'down', 'over', 'per', 'via', 'about', 'so', 'not',
  'no', 'yes', 'get', 'got', 'set', 'use', 'using', 'want', 'need',
]);

// Articles. Each `body` block is { h } | { p } | { steps:[] } | { list:[] }.
export const ARTICLES = [
  {
    id: 'getting-started', category: 'Getting started', title: 'Getting started & signing in',
    keywords: ['login', 'sign in', 'password', 'account', 'demo data', 'first time'],
    body: [
      { p: 'Dispatch runs in your web browser — there is nothing to install, and everyone is always on the latest version. Open the site and sign in with your work email.' },
      { steps: ['Open the app URL your manager shared.', 'Sign in with your work email (or Microsoft account if enabled).', 'You land on the dashboard, which shows your shift clock and your current/next job.'] },
      { p: 'To explore with sample data, a manager can open Settings → Data & backup → "Load demo data" on an empty workspace.' },
    ],
  },
  {
    id: 'customers-sites-assets', category: 'Customers & assets', title: 'Add a customer, site, and asset',
    keywords: ['customer', 'account', 'location', 'site', 'equipment', 'asset', 'serial', 'warranty'],
    body: [
      { p: 'Customers are the businesses you service. Each customer can have multiple sites (locations), and each site can have assets (the equipment you maintain).' },
      { steps: [
        'Go to Customers → "New customer" and fill in the name and billing details.',
        'Open the customer and use "Add site" for each location.',
        'Use "Add asset" to record equipment — make, model, serial, and warranty date.',
      ] },
      { p: 'Every work order can be tied to a site and asset, which builds that unit\'s full service history over time.' },
    ],
  },
  {
    id: 'create-work-order', category: 'Work orders', title: 'Create and dispatch a work order',
    keywords: ['work order', 'job', 'ticket', 'create', 'assign', 'priority', 'sla', 'due'],
    body: [
      { p: 'A work order is a single service job. Create it from the Work Orders page or from a customer.' },
      { steps: [
        'Work Orders → "New work order".',
        'Pick the customer, then the site and asset if relevant.',
        'Set a title, priority, and SLA due date.',
        'Assign a technician now, or leave it unassigned and schedule it later.',
      ] },
      { p: 'Open work orders past their SLA due time are flagged as overdue on the list, dashboard, and schedule.' },
    ],
  },
  {
    id: 'schedule-board', category: 'Scheduling & dispatch', title: 'Using the schedule board',
    keywords: ['schedule', 'calendar', 'dispatch', 'drag', 'drop', 'week', 'month', 'day', 'tech', 'reschedule'],
    body: [
      { p: 'The Schedule page is the dispatch board. Switch between Week, Month, Day, and Techs views with the toggle.' },
      { steps: [
        'Drag a card from "Unscheduled" onto a day to schedule it.',
        'Drag between days to reschedule; a drop zone shows where it will land.',
        'Tap a card to set an exact time and assign a technician.',
        'Filter by technician to focus on one person\'s route (dispatchers see only their own).',
      ] },
      { p: 'On phones the week and day views stack vertically so everything fits.' },
    ],
  },
  {
    id: 'field-actions-time', category: 'Field & time', title: 'Field actions & clocking in/out',
    keywords: ['clock', 'time', 'shift', 'start job', 'break', 'on the way', 'stop', 'timer', 'hours'],
    body: [
      { p: 'Two clocks work together: a daily shift clock (start/end of your day) and a per-job timer driven by the job buttons.' },
      { list: [
        'Shift clock — "Clock in / out" on the dashboard or schedule; they stay in sync.',
        '"On the way" — marks the job en route.',
        '"Start job" — marks you on site and starts the job timer.',
        '"Take break" — pauses the job timer.',
        '"Stop Job" — stops the timer and returns the job to scheduled.',
        '"Job complete" — stops the timer and marks the work done.',
      ] },
      { p: 'Only "Job complete" marks the job done — and a manager still has to approve it before it is truly closed.' },
    ],
  },
  {
    id: 'complete-approve', category: 'Work orders', title: 'Completing a job & manager approval',
    keywords: ['complete', 'finish', 'approve', 'sign off', 'signature', 'photo', 'resolution', 'done'],
    body: [
      { steps: [
        'On the work order, add resolution notes and any photos.',
        'Capture the customer\'s sign-off (printed name + signature).',
        'Tap "Job complete".',
        'A manager opens the job and taps "Approve" to close it out.',
      ] },
      { p: 'A completed job that has not been approved still shows as pending — approval is the final step and is manager-only.' },
    ],
  },
  {
    id: 'invoices', category: 'Invoices & payments', title: 'Generate an invoice and record payment',
    keywords: ['invoice', 'bill', 'payment', 'paid', 'tax', 'a/r', 'receivable', 'print', 'pdf', 'stripe'],
    body: [
      { steps: [
        'Open a completed work order and tap "Create invoice" — its line items are copied in.',
        'Review the draft: adjust tax, due date, and any line items.',
        'Tap "Mark as sent".',
        'When paid, tap "Record payment" (full or partial) or "Mark paid".',
      ] },
      { p: 'Outstanding A/R (unpaid, sent invoices) shows on the dashboard and the Invoices page. Use "Print / PDF" to hand a customer their invoice. Managers can set the invoice template under Invoices → "Invoice template".' },
    ],
  },
  {
    id: 'timesheets', category: 'Field & time', title: 'Timesheets & fixing a missed punch',
    keywords: ['timesheet', 'hours', 'payroll', 'missed punch', 'correction', 'approve', 'csv', 'export'],
    body: [
      { p: 'Timesheets roll up hours and labor cost by team member and project. Export to CSV for payroll.' },
      { steps: [
        'Forgot to clock in or out? On the Schedule page tap "Fix a punch".',
        'Enter the date and the correct clock-in/out times, with a reason.',
        'A manager reviews it on the Timesheets page and approves or rejects it.',
      ] },
      { p: 'Approving a correction creates the shift record — nothing changes until a manager approves.' },
    ],
  },
  {
    id: 'roles', category: 'Account & roles', title: 'Roles & permissions',
    keywords: ['role', 'permission', 'manager', 'accountant', 'dispatcher', 'access', 'admin', 'team'],
    body: [
      { list: [
        'Manager Admin — full access, including approvals, team, and the activity log.',
        'Accountant Admin — billing, invoices, rates, and reports.',
        'Dispatcher — work orders, scheduling, field work, and their own time.',
      ] },
      { p: 'Managers add and manage people under Team. Every change is recorded in the Activity log.' },
    ],
  },
  {
    id: 'personalize', category: 'Account & roles', title: 'Personalize navigation & accessibility',
    keywords: ['navigation', 'nav', 'menu', 'pin', 'reorder', 'accessibility', 'contrast', 'text size', 'font', 'dark mode'],
    body: [
      { p: 'Settings lets each person tune the app to how they work — these choices are saved on your device.' },
      { list: [
        'Pin symbols to the mobile top bar, or reorder the bottom bar and sidebar.',
        'Turn on High contrast and increase Text size under Accessibility.',
        'Toggle light/dark with the moon/sun icon in the top bar.',
      ] },
    ],
  },
  {
    id: 'data-backup', category: 'Account & roles', title: 'Exporting your data & backups',
    keywords: ['export', 'backup', 'download', 'json', 'data', 'lock-in'],
    body: [
      { p: 'Your data is yours. A manager can download a full backup anytime under Settings → Data & backup → "Export all data (JSON)".' },
      { p: 'The system also takes an automatic daily backup behind the scenes.' },
    ],
  },
  {
    id: 'troubleshooting', category: 'Troubleshooting', title: 'Troubleshooting common issues',
    keywords: ['problem', 'error', 'not working', 'empty', 'blank', 'cant sign in', 'upload', 'photo', 'slow', 'fix', 'help'],
    body: [
      { h: 'A page is empty or says "needs a database update"' },
      { p: 'A required update hasn\'t been applied yet. Tell your administrator to run the latest database migration; the page will work once it\'s applied.' },
      { h: 'I can\'t sign in' },
      { p: 'Confirm you\'re using your work email and that your manager has invited you. If you use Microsoft sign-in, use the same account your manager added.' },
      { h: 'A photo won\'t upload' },
      { p: 'Check your connection and that the file is an image under the size limit. Photos are compressed automatically; very large files may need a moment.' },
      { h: 'The job timer or clock won\'t start' },
      { p: 'Make sure you\'re signed in and assigned to the job. If a button does nothing, refresh the page and try once more.' },
      { h: 'Still stuck?' },
      { p: 'Use "Contact support" at the top of this page and describe what you were doing and what you expected to happen.' },
    ],
  },
];

// Precompute a lowercase search blob per article (title + keywords + body text).
const blockText = (b) => b.h || b.p || (b.steps || b.list || []).join(' ') || '';
for (const a of ARTICLES) {
  a._text = [a.title, (a.keywords || []).join(' '), a.body.map(blockText).join(' ')].join(' ').toLowerCase();
}

export const getArticle = (id) => ARTICLES.find((a) => a.id === id);

export function tokenize(q) {
  return (String(q).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function snippet(text, idx, len = 130) {
  const start = Math.max(0, idx - 30);
  return (start > 0 ? '…' : '') + text.slice(start, start + len).trim() + '…';
}

export function searchDocs(query) {
  const toks = tokenize(query);
  if (!toks.length) return [];
  const results = [];
  for (const a of ARTICLES) {
    const title = a.title.toLowerCase();
    const kw = (a.keywords || []).join(' ').toLowerCase();
    let score = 0; let snip = '';
    for (const t of toks) {
      if (title.includes(t)) score += 6;
      if (kw.includes(t)) score += 3;
      const idx = a._text.indexOf(t);
      if (idx >= 0) { score += 1; if (!snip) snip = snippet(a._text, idx); }
    }
    if (score > 0) results.push({ article: a, score, snippet: snip });
  }
  return results.sort((x, y) => y.score - x.score);
}
