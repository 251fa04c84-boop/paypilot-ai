'use strict';
// Recovery message drafting. Real AI (Google Gemini) when GEMINI_API_KEY is set; otherwise a clearly-labelled template.
// Model output is UNTRUSTED: it is validated before it ever reaches the user, and the source label never over-claims.
const TONES = {
  courtesy: 'a warm, brief courtesy reminder that the invoice is due soon',
  friendly: 'a friendly, polite reminder that the invoice is a little overdue',
  firm: 'a professional, firm follow-up: clear about the overdue amount and asking for a payment date',
  final: 'a serious but respectful final notice asking for payment or a call within 7 days',
};
const LINK = '{{PAYMENT_LINK}}';
const TIMEOUT_MS = 15000;

function buildPrompt(inv, a, sender) {
  return [
    'You write short payment-recovery emails for a small business.',
    `Write ${TONES[a.tone] || TONES.friendly}.`,
    `Rules: under 120 words; plain text; no subject line; no threats, penalties, or legal claims; do not invent facts or links; use only the details below; include the exact text ${LINK} once where the client can pay; sign off with the sender name.`,
    `Client: ${inv.client}`, `Invoice number: ${inv.number}`, `Amount: ${inv.amount.toFixed(2)} ${inv.currency}`,
    `Due date: ${inv.dueDate}`, `Days overdue: ${a.overdueDays}`, `Reminders already sent: ${inv.reminderCount || 0}`,
    `Sender name: ${sender}`,
  ].join('\n');
}

function templateDraft(inv, a, sender) {
  const amt = `${inv.amount.toFixed(2)} ${inv.currency}`;
  const lines = {
    courtesy: `Hi ${inv.client},\n\nA quick heads-up that invoice ${inv.number} for ${amt} is due on ${inv.dueDate}. You can pay securely here: ${LINK}\n\nThank you,\n${sender}`,
    friendly: `Hi ${inv.client},\n\nInvoice ${inv.number} for ${amt} was due on ${inv.dueDate} and I can't see a payment yet. If it's already on its way, thank you! Otherwise you can pay here: ${LINK}\n\nBest regards,\n${sender}`,
    firm: `Hi ${inv.client},\n\nInvoice ${inv.number} for ${amt} is now ${a.overdueDays} days overdue (due ${inv.dueDate}). Please pay using ${LINK} or tell me the date you expect to pay.\n\nRegards,\n${sender}`,
    final: `Hi ${inv.client},\n\nThis is a final reminder that invoice ${inv.number} for ${amt} is ${a.overdueDays} days overdue. Please pay via ${LINK} or contact me within 7 days to agree a plan.\n\nRegards,\n${sender}`,
  };
  return lines[a.tone] || lines.friendly;
}

// Deterministic checks on model output. Returns {ok, text} or {ok:false, reason}.
function validateDraft(raw, inv) {
  let t = String(raw || '').replace(/```[a-z]*/gi, '').trim();
  if (t.length < 40) return { ok: false, reason: 'too short' };
  if (t.length > 1500) return { ok: false, reason: 'too long' };
  const rest = t.split(LINK).join('');
  if (/https?:\/\/|www\./i.test(rest)) return { ok: false, reason: 'it invented a link' };
  if (/\{\{|\}\}/.test(rest)) return { ok: false, reason: 'unknown placeholder' };
  const links = t.split(LINK).length - 1;
  if (links > 1) return { ok: false, reason: 'repeated payment link' };
  if (!(t.includes(inv.number) || t.includes(inv.amount.toFixed(2)) || t.includes(String(inv.amount)))) return { ok: false, reason: 'it does not mention this invoice' };
  if (links === 0) t += `\n\nPay securely here: ${LINK}`;
  return { ok: true, text: t };
}

async function generateDraft({ invoice, assessment, sender = 'Accounts team', apiKey, model = 'gemini-2.5-flash', fetchImpl = fetch, timeoutMs = TIMEOUT_MS }) {
  const fallback = (why) => ({ text: templateDraft(invoice, assessment, sender), source: `template (${why})` });
  if (!apiKey) return fallback('no AI key configured');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: buildPrompt(invoice, assessment, sender) }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 400 } }),
    });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j && j.error && j.error.message ? ` - ${String(j.error.message).replace(/\s+/g, ' ').slice(0, 100)}` : ''; } catch (_) { /* no body */ }
      throw new Error(`HTTP ${res.status}${detail}`);
    }
    const data = await res.json();
    const raw = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || []).map((p) => p.text || '').join('');
    const v = validateDraft(raw, invoice);
    if (!v.ok) return fallback(`AI output rejected: ${v.reason}`);
    return { text: v.text, source: `AI: Google Gemini (${model})` };
  } catch (e) {
    return fallback(`AI request failed: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
  } finally { clearTimeout(timer); }
}
module.exports = { generateDraft, templateDraft, buildPrompt, validateDraft };
