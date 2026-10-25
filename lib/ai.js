'use strict';
// Recovery message drafting. Real AI (Google Gemini free tier) when GEMINI_API_KEY is set;
// otherwise a clearly-labelled template. The source is always returned so the UI never over-claims.
const TONES = {
  courtesy: 'a warm, brief courtesy reminder that the invoice is due soon',
  friendly: 'a friendly, polite reminder that the invoice is a little overdue',
  firm: 'a professional, firm follow-up: clear about the overdue amount and asking for a payment date',
  final: 'a serious but respectful final notice asking for payment or a call within 7 days',
};

function buildPrompt(inv, a, sender) {
  return [
    'You write short payment-recovery emails for a small business.',
    `Write ${TONES[a.tone] || TONES.friendly}.`,
    'Rules: under 120 words; plain text; no subject line; no threats, penalties, or legal claims; do not invent facts; use only the details below; include the exact text {{PAYMENT_LINK}} once where the client can pay; sign off with the sender name.',
    `Client: ${inv.client}`, `Invoice number: ${inv.number}`, `Amount: ${inv.amount.toFixed(2)} ${inv.currency}`,
    `Due date: ${inv.dueDate}`, `Days overdue: ${a.overdueDays}`, `Reminders already sent: ${inv.reminderCount || 0}`,
    `Sender name: ${sender}`,
  ].join('\n');
}

function templateDraft(inv, a, sender) {
  const amt = `${inv.amount.toFixed(2)} ${inv.currency}`;
  const lines = {
    courtesy: `Hi ${inv.client},\n\nA quick heads-up that invoice ${inv.number} for ${amt} is due on ${inv.dueDate}. You can pay securely here: {{PAYMENT_LINK}}\n\nThank you,\n${sender}`,
    friendly: `Hi ${inv.client},\n\nInvoice ${inv.number} for ${amt} was due on ${inv.dueDate} and I can't see a payment yet. If it's already on its way, thank you! Otherwise you can pay here: {{PAYMENT_LINK}}\n\nBest regards,\n${sender}`,
    firm: `Hi ${inv.client},\n\nInvoice ${inv.number} for ${amt} is now ${a.overdueDays} days overdue (due ${inv.dueDate}). Please pay using {{PAYMENT_LINK}} or tell me the date you expect to pay.\n\nRegards,\n${sender}`,
    final: `Hi ${inv.client},\n\nThis is a final reminder that invoice ${inv.number} for ${amt} is ${a.overdueDays} days overdue. Please pay via {{PAYMENT_LINK}} or contact me within 7 days to agree a plan.\n\nRegards,\n${sender}`,
  };
  return lines[a.tone] || lines.friendly;
}

async function generateDraft({ invoice, assessment, sender = 'Accounts team', apiKey, model = 'gemini-2.5-flash', fetchImpl = fetch }) {
  if (!apiKey) return { text: templateDraft(invoice, assessment, sender), source: 'template (no AI key configured)' };
  try {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: buildPrompt(invoice, assessment, sender) }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 400 } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || []).map((p) => p.text || '').join('').trim();
    if (!text) throw new Error('empty response');
    return { text, source: `AI: Google Gemini (${model})` };
  } catch (e) {
    return { text: templateDraft(invoice, assessment, sender), source: `template (AI request failed: ${e.message})` };
  }
}
module.exports = { generateDraft, templateDraft, buildPrompt };
