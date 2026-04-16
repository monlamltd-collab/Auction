// routes/leads.js — Lead capture & email notification
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { rateLimit } from '../lib/auth.js';
import { log } from '../lib/logging.js';
import { escHtml } from '../lib/utils.js';
import { logActivityEvent } from '../lib/analysis.js';

const router = Router();

// POST /api/leads
router.post('/api/leads', rateLimit(60000, 10), async (req, res) => {
  const {
    name, email, phone, contactPref, isRegulated, occupancy,
    propertyPrice, loanAmount, ltvPercent, worksBudget,
    matchingLenders, propertyType, propertyAddress,
    depositRange, experienceLevel, auctionUrl, dealData,
    source, consent
  } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  // Phone required unless it's a simple email capture (e.g. landing-page newsletter)
  if (!phone && source !== 'landing-page') {
    return res.status(400).json({ error: 'Name, email, and phone are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name: (name || '').trim(),
        email: email.toLowerCase().trim(),
        phone: phone ? phone.trim() : null,
        source: source || 'bridgematch_lite',
        contact_pref: contactPref || 'email',
        is_regulated: !!isRegulated,
        occupancy: occupancy || null,
        property_price: propertyPrice || null,
        loan_amount: loanAmount || null,
        ltv_percent: ltvPercent || null,
        works_budget: worksBudget || null,
        matching_lenders: matchingLenders || null,
        property_type: propertyType || null,
        property_address: propertyAddress || null,
        deposit_range: depositRange || null,
        experience_level: experienceLevel || null,
        auction_url: auctionUrl || null,
        deal_data: dealData || null,
        consent_given: !!consent,
        ip_address: req.ip || null,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;

    logActivityEvent('lead_submit', { email, propertyPrice, loanAmount, isRegulated, source: source || 'bridgematch-lite' }, email, req.ip);

    // Email notification via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const regulated = isRegulated ? '⚠️ REGULATED (owner-occupier)' : 'Investment (bridging)';
      const safeUrl = auctionUrl && /^https?:\/\//.test(auctionUrl) ? auctionUrl : null;
      const html = `
        <h2>New Lead from Auction Tool</h2>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Name</td><td>${escHtml(name)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Email</td><td><a href="mailto:${escHtml(email)}">${escHtml(email)}</a></td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Phone</td><td><a href="tel:${escHtml(phone)}">${escHtml(phone)}</a></td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Preferred contact</td><td>${escHtml(contactPref || 'email')}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Type</td><td>${regulated}</td></tr>
          ${propertyAddress ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Property</td><td>${escHtml(propertyAddress)}</td></tr>` : ''}
          ${propertyPrice ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Price</td><td>${escHtml(propertyPrice)}</td></tr>` : ''}
          ${loanAmount ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Loan needed</td><td>${escHtml(loanAmount)}</td></tr>` : ''}
          ${ltvPercent ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">LTV</td><td>${escHtml(ltvPercent)}%</td></tr>` : ''}
          ${worksBudget ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Works budget</td><td>${escHtml(worksBudget)}</td></tr>` : ''}
          ${matchingLenders ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Matching lenders</td><td>${escHtml(matchingLenders)}</td></tr>` : ''}
          ${propertyType ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Property type</td><td>${escHtml(propertyType)}</td></tr>` : ''}
          ${depositRange ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Deposit range</td><td>${escHtml(depositRange)}</td></tr>` : ''}
          ${experienceLevel ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Experience</td><td>${escHtml(experienceLevel)}</td></tr>` : ''}
          ${safeUrl ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Source</td><td><a href="${escHtml(safeUrl)}">View deal</a></td></tr>` : ''}
        </table>
      `;
      const safeName = (name || '').replace(/[\r\n\t]/g, ' ').slice(0, 100);
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'AuctionBrain <hello@auctionbrain.co.uk>',
          to: ['hello@bridgematch.co.uk', 'simon@brunel-bridging.co.uk'],
          subject: `🏠 New lead: ${safeName} — ${escHtml(propertyPrice || 'price TBC')}`,
          html,
        }),
      }).catch(e => log.warn('Lead email failed', { error: e.message }));
    }

    res.json({ ok: true, id: data?.id, isRegulated: !!isRegulated });
  } catch (err) {
    log.error('Lead submission error', { error: err.message });
    res.status(500).json({ error: 'Failed to submit enquiry' });
  }
});

export default router;
