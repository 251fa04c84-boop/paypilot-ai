'use strict';

const MAX_BYTES = 80_000;
const MAX_ROWS = 250;
const MAX_CELL = 500;

function parseCsv(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Paste a CSV export first.');
  if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) throw new Error('CSV is too large. Maximum size is 80 KB.');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new Error('CSV contains too many rows. Maximum is 250 transactions.');
    } else cell += ch;
    if (cell.length > MAX_CELL) throw new Error('A CSV cell is too long. Maximum is 500 characters.');
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one transaction.');
  if (rows.length > MAX_ROWS + 1) throw new Error('CSV contains too many rows. Maximum is 250 transactions.');
  const headers = rows.shift().map((v) => v.trim().toLowerCase().replace(/[\s_-]+/g, ''));
  const pick = (...names) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0);
  const ix = {
    invoice: pick('invoicenumber', 'invoice', 'invoiceno', 'referencenumber', 'customid'),
    amount: pick('amount', 'grossamount', 'captureamount', 'total'),
    currency: pick('currency', 'currencycode'),
    transaction: pick('transactionid', 'captureid', 'paymentid', 'id', 'paypalid'),
    status: pick('status', 'paymentstatus', 'state'),
  };
  if (ix.invoice == null || ix.amount == null || ix.currency == null) {
    throw new Error('CSV must include invoice number, amount and currency columns. Optional: transaction ID and status.');
  }
  return rows.map((values, index) => {
    const get = (i) => i == null ? '' : String(values[i] || '').trim();
    const amountText = get(ix.amount).replace(/,/g, '');
    const amount = Number(amountText);
    return {
      row: index + 2,
      invoiceNumber: get(ix.invoice).slice(0, 80),
      amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
      currency: get(ix.currency).toUpperCase().slice(0, 3),
      transactionId: get(ix.transaction).slice(0, 100),
      status: get(ix.status).toUpperCase().slice(0, 40),
    };
  });
}

function reconcile(csv, invoices) {
  const records = parseCsv(csv);
  const byNumber = new Map();
  for (const invoice of invoices) {
    const key = String(invoice.number || '').trim().toLowerCase();
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key).push(invoice);
  }
  const seenTransactions = new Set();
  return records.map((record) => {
    const base = { row: record.row, invoiceNumber: record.invoiceNumber, amount: record.amount, currency: record.currency, transactionId: record.transactionId };
    if (!record.invoiceNumber || !record.amount || !/^[A-Z]{3}$/.test(record.currency)) return { ...base, result: 'invalid', reason: 'Missing or invalid invoice reference, amount or currency.' };
    if (record.transactionId && seenTransactions.has(record.transactionId)) return { ...base, result: 'duplicate', reason: 'This transaction ID appears more than once in the uploaded file.' };
    if (record.transactionId) seenTransactions.add(record.transactionId);
    if (!record.status) return { ...base, result: 'status_missing', reason: 'No provider status was supplied. Payment completion cannot be assumed.' };
    if (!['COMPLETED', 'CAPTURED', 'SUCCESS', 'SUCCEEDED'].includes(record.status)) return { ...base, result: 'not_completed', reason: 'Provider status is not a completed payment; no invoice can be reconciled.' };
    const matches = byNumber.get(record.invoiceNumber.toLowerCase()) || [];
    if (!matches.length) return { ...base, result: 'unmatched', reason: 'No invoice with this exact invoice number exists in the current workspace.' };
    if (matches.length > 1) return { ...base, result: 'ambiguous', reason: 'Multiple invoices share this number. Manual review is required.' };
    const invoice = matches[0];
    if (invoice.currency !== record.currency || Math.round(Number(invoice.amount) * 100) !== Math.round(record.amount * 100)) {
      return { ...base, invoiceId: invoice.id, client: invoice.client, result: 'mismatch', reason: 'Amount or currency differs from the invoice. No automatic adjustment is allowed.' };
    }
    if (invoice.status === 'paid') return { ...base, invoiceId: invoice.id, client: invoice.client, result: 'already_paid', reason: 'Invoice is already marked paid. Check the existing payment evidence.' };
    if (invoice.disputed) return { ...base, invoiceId: invoice.id, client: invoice.client, result: 'disputed', reason: 'Invoice is disputed. Keep collection paused and review manually.' };
    return { ...base, invoiceId: invoice.id, client: invoice.client, result: 'candidate', reason: 'Exact invoice number, amount and currency match. This is a review candidate only; no payment is verified or recorded.' };
  });
}

module.exports = { parseCsv, reconcile, MAX_ROWS, MAX_BYTES };
