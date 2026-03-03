// ═══════════════════════════════════════════════════════════════
// API: LEAD CAPTURE (from bridging validation tool)
// ═══════════════════════════════════════════════════════════════
// Add this BEFORE the /welcome and /check routes in server.js

app.post('/api/leads', async (req, res) => {
  const {
    name, email, phone, contactPref,
    isRegulated, occupancy,
    propertyPrice, loanAmount, ltvPercent, worksBudget,
    matchingLenders, propertyType, propertyAddress,
    depositRange, experienceLevel,
    auctionHouse, auctionUrl,
    dealData
  } = req.body || {};

  // Validation
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  // Rate limit: max 5 lead submissions per email per hour
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('investor_email', email.toLowerCase().trim())
      .gte('created_at', oneHourAgo);

    if (count >= 5) {
      return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    }
  } catch (e) {
    console.error('Lead rate limit check error:', e);
    // Continue anyway — don't block lead capture on rate limit failures
  }

  // Parse numeric values
  const parseNum = (v) => {
    if (!v) return null;
    const n = typeof v === 'string' ? parseInt(v.replace(/[£,%\s]/g, '')) : v;
    return isNaN(n) ? null : n;
  };

  const parseDecimal = (v) => {
    if (!v) return null;
    const n = typeof v === 'string' ? parseFloat(v.replace(/[%\s]/g, '')) : v;
    return isNaN(n) ? null : n;
  };

  try {
    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        investor_name: name.trim(),
        investor_email: email.toLowerCase().trim(),
        investor_phone: phone?.trim() || null,
        contact_pref: contactPref || 'email',
        is_regulated: isRegulated || false,
        occupancy: occupancy || 'investment',
        property_price: parseNum(propertyPrice),
        loan_amount: parseNum(loanAmount),
        ltv_percent: parseDecimal(ltvPercent),
        works_budget: parseNum(worksBudget),
        matching_lenders: parseNum(matchingLenders),
        property_type: propertyType || null,
        property_address: propertyAddress || null,
        deposit_range: depositRange || null,
        experience_level: experienceLevel || null,
        source: 'bridgematch_lite',
        auction_house: auctionHouse || null,
        auction_url: auctionUrl || null,
        deal_data_json: dealData || null,
        consent_given: true,
        consent_timestamp: new Date().toISOString()
      })
      .select('id, is_regulated')
      .single();

    if (error) throw error;

    // Send notification email (non-blocking)
    sendLeadNotification({
      id: lead.id,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone?.trim(),
      contactPref,
      isRegulated: lead.is_regulated,
      propertyPrice,
      loanAmount,
      ltvPercent,
      worksBudget,
      matchingLenders,
      propertyAddress
    }).catch(err => console.error('Lead notification failed:', err));

    return res.json({
      success: true,
      leadId: lead.id,
      isRegulated: lead.is_regulated,
      message: lead.is_regulated
        ? 'Your enquiry has been received. As this involves a regulated mortgage, it will be handled by Mortgage Style, authorised and regulated by the Financial Conduct Authority.'
        : 'Thank you! A bridging finance specialist will review your enquiry and be in touch within 24 hours.'
    });

  } catch (err) {
    console.error('Lead capture error:', err);
    return res.status(500).json({ error: 'Failed to submit enquiry. Please try again.' });
  }
});

// Lead notification helper
async function sendLeadNotification(lead) {
  // For MVP: log to console. Replace with email service (SendGrid/Mailgun) when ready.
  console.log('\n═══════════════════════════════════════');
  console.log('🔔 NEW BRIDGEMATCH LEAD');
  console.log('═══════════════════════════════════════');
  console.log(`Name:     ${lead.name}`);
  console.log(`Email:    ${lead.email}`);
  console.log(`Phone:    ${lead.phone || 'Not provided'}`);
  console.log(`Contact:  ${lead.contactPref === 'call' ? '📞 Call' : '📧 Email'}`);
  console.log(`Regulated: ${lead.isRegulated ? '⚠️ YES — Mortgage Style' : '✅ No — Unregulated'}`);
  console.log('───────────────────────────────────────');
  console.log(`Property: ${lead.propertyAddress || 'Address not provided'}`);
  console.log(`Price:    ${lead.propertyPrice || '?'}`);
  console.log(`Loan:     ${lead.loanAmount || '?'}`);
  console.log(`LTV:      ${lead.ltvPercent || '?'}%`);
  console.log(`Works:    ${lead.worksBudget || 'N/A'}`);
  console.log(`Lenders:  ${lead.matchingLenders || '?'} matching`);
  console.log('═══════════════════════════════════════\n');

  // TODO: Replace with actual email sending:
  // await sendgrid.send({
  //   to: 'simon@bridgematch.co.uk',
  //   from: 'leads@bridgematch.co.uk',
  //   subject: `🔔 New Lead: ${lead.propertyPrice} property ${lead.isRegulated ? '(REGULATED)' : ''}`,
  //   text: `...lead details...`
  // });
}

// API: Get leads (admin — requires ADMIN_SECRET header)
app.get('/api/leads', async (req, res) => {
  if (!process.env.ADMIN_SECRET || req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { status, regulated, limit = 50 } = req.query;
  const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);

  let query = supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (status) query = query.eq('status', status);
  if (regulated === 'true') query = query.eq('is_regulated', true);
  if (regulated === 'false') query = query.eq('is_regulated', false);

  try {
    const { data, error } = await query;
    if (error) throw error;
    return res.json({ leads: data, count: data.length });
  } catch (err) {
    console.error('Get leads error:', err);
    return res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// API: Update lead status (admin — requires ADMIN_SECRET header)
app.patch('/api/leads/:id', async (req, res) => {
  if (!process.env.ADMIN_SECRET || req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { id } = req.params;
  const { status, referred_to, outcome_notes, proc_fee_earned } = req.body;

  const updates = {};
  if (status) updates.status = status;
  if (referred_to) {
    updates.referred_to = referred_to;
    updates.referral_date = new Date().toISOString();
  }
  if (outcome_notes) updates.outcome_notes = outcome_notes;
  if (proc_fee_earned !== undefined) updates.proc_fee_earned = proc_fee_earned;

  try {
    const { data, error } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ lead: data });
  } catch (err) {
    console.error('Update lead error:', err);
    return res.status(500).json({ error: 'Failed to update lead' });
  }
});
