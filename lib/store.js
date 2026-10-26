'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const newId = () => crypto.randomBytes(6).toString('hex');

function createStore(file) {
  let db = { invoices: [], drafts: [], orders: [], actions: [] };
  if (file && fs.existsSync(file)) {
    try { db = Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (e) { throw new Error(`Could not read data file ${file}: ${e.message}`); }
  }
  function save() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, file);
  }
  return { get db() { return db; }, save };
}

// Audit trail entry. `detail` must describe only what really happened.
function addAction(db, { invoiceId, type, detail }, at = new Date().toISOString()) {
  const a = { id: newId(), at, invoiceId, type, detail };
  db.actions.push(a);
  return a;
}

// Once an invoice is paid or void, any unsent message for it is no longer needed. Close it so it cannot be approved or sent.
function closeDrafts(db, invoiceId, why, at = new Date().toISOString()) {
  const open = db.drafts.filter((d) => d.invoiceId === invoiceId && (d.status === 'draft' || d.status === 'approved'));
  for (const d of open) d.status = 'discarded';
  if (open.length) addAction(db, { invoiceId, type: 'drafts_closed', detail: `${open.length} unsent message${open.length === 1 ? '' : 's'} closed because ${why}.` }, at);
}

module.exports = { createStore, addAction, newId, closeDrafts };
