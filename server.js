// Sentry must be imported before everything else for proper instrumentation
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
  });
  console.log('Sentry error tracking enabled');
}

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's reverse proxy for correct client IP via req.ip / X-Forwarded-For
app.set('trust proxy', 1);

app.use(express.json());

// ═══════════════════════════════════════════════════════════════
// CORS
// ═══════════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://auctions.bridgematch.co.uk,https://www.bridgematch.co.uk,https://bridgematch.co.uk').split(',');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ═══════════════════════════════════════════════════════════════
// SUPABASE CLIENT
// ═══════════════════════════════════════════════════════════════
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// ═══════════════════════════════════════════════════════════════
// STRUCTURED LOGGING
// ═══════════════════════════════════════════════════════════════
function log(level, message, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, msg: message, ...meta };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
log.info = (msg, meta) => log('info', msg, meta);
log.warn = (msg, meta) => log('warn', msg, meta);
log.error = (msg, meta) => log('error', msg, meta);

// Request logging middleware
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const start = Date.now();
  res.on('finish', () => {
    log.info('request', { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start, ip: getClientIP(req) });
  });
  next();
});

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const RATE_LIMIT = 5;
const CACHE_DAYS = 7;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};
const MAX_PAGES = 40;
const TIMEOUT = 25000;

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

// ═══════════════════════════════════════════════════════════════
// STATIC FILES
// ═══════════════════════════════════════════════════════════════
app.use('/public', express.static(join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
// API: USER SIGNUP
// ═══════════════════════════════════════════════════════════════
app.post('/api/signup', async (req, res) => {
  const { email, name } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', existing.id);
      return res.json({ user: existing, returning: true });
    }

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ email: email.toLowerCase().trim(), name: name || null })
      .select('id, email, name')
      .single();

    if (error) throw error;
    return res.json({ user: newUser, returning: false });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTH HELPER: validate email is a registered user
// ═══════════════════════════════════════════════════════════════
async function validateUser(email) {
  if (!email || !email.includes('@')) return null;
  try {
    const { data } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('email', email.toLowerCase().trim())
      .single();
    return data || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// API: AUCTION CALENDAR
// ═══════════════════════════════════════════════════════════════

// Hardcoded fallback calendar — used when Supabase auction_calendar table is empty
const FALLBACK_CALENDAR = [
    // ── SAVILLS ──
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-02-24', dateEnd: '2026-02-25',
      title: '24 & 25 February 2026', lots: 322,
      url: 'https://auctions.savills.co.uk/auctions/24--25-february-2026-218',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-03-17', title: '17 March 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-03-31', title: '31 March 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-04-21', title: '21 April 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-05-06', title: '6 May 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── ALLSOP ──
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-02-25', dateEnd: '2026-02-26',
      title: '25 & 26 February 2026 — Residential', lots: 325,
      url: 'https://www.allsop.co.uk/residential-auction-view',
      location: 'Online (Live Stream)', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-03-24', title: '24 March 2026 — Commercial', lots: null,
      url: 'https://www.allsop.co.uk/commercial-auction-view',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-03-25', dateEnd: '2026-03-26',
      title: '25 & 26 March 2026 — Residential', lots: null,
      url: 'https://www.allsop.co.uk/residential-auction-view',
      location: 'Online (Live Stream)', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    // ── NETWORK AUCTIONS ──
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/next-auction/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-05-07', title: '7 May 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/future-auctions/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-06-18', title: '18 June 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/future-auctions/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: false,
    },
    // ── SDL AUCTIONS / BTG EDDISONS ──
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-02-24', title: '24 February 2026 — Timed', lots: null,
      url: 'https://www.sdlauctions.co.uk/auction/1310/multi-lot-timed-auction-2026-02-24/',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-02-26', title: '26 February 2026 — Live Stream', lots: null,
      url: 'https://www.sdlauctions.co.uk/auction/1292/live-streamed-auction-2026-02-26/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-03-24', title: '24 March 2026 — Timed', lots: null,
      url: 'https://www.sdlauctions.co.uk/auction/1311/multi-lot-timed-auction-2026-03-24/',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-03-26', title: '26 March 2026 — Live Stream', lots: null,
      url: 'https://www.sdlauctions.co.uk/auction/1297/live-streamed-auction-2026-03-26/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-04-28', title: '28 April 2026 — Timed', lots: null,
      url: 'https://www.sdlauctions.co.uk/auction/1312/multi-lot-timed-auction-2026-04-28/',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-04-30', title: '30 April 2026 — Live Stream', lots: null,
      url: 'https://www.sdlauctions.co.uk/auction/1298/live-streamed-auction-2026-04-30/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── BOND WOLFE ──
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.bondwolfe.com/auction/3448/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-05-14', title: '14 May 2026', lots: null,
      url: 'https://www.bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-07-09', title: '9 July 2026', lots: null,
      url: 'https://www.bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── BARNARD MARCUS ──
    {
      house: 'Barnard Marcus', houseSlug: 'barnardmarcus', logo: '🏠',
      date: '2026-03-10', title: '10 March 2026', lots: null,
      url: 'https://www.barnardmarcusauctions.co.uk/auctions/current/',
      location: 'Grand Connaught Rooms, London WC2B', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── AUCTION HOUSE LONDON ──
    {
      house: 'Auction House London', houseSlug: 'auctionhouselondon', logo: '🔑',
      date: '2026-03-04', title: '4 March 2026', lots: 45,
      url: 'https://auctionhouselondon.co.uk/current-auction',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House London', houseSlug: 'auctionhouselondon', logo: '🔑',
      date: '2026-03-18', dateEnd: '2026-03-19', title: '18 & 19 March 2026', lots: null,
      url: 'https://auctionhouselondon.co.uk/auction/march-18-19-2026',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── CLIVE EMSON ──
    {
      house: 'Clive Emson', houseSlug: 'cliveemson', logo: '🌿',
      date: '2026-03-05', title: '5 March 2026 catalogue live', lots: null,
      url: 'https://www.cliveemson.co.uk/search/',
      location: 'Online', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    // ── STRETTONS ──
    {
      house: 'Strettons', houseSlug: 'strettons', logo: '📋',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.strettons.co.uk/auctions/current-catalogue/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── ACUITUS ──
    {
      house: 'Acuitus', houseSlug: 'acuitus', logo: '🏢',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.acuitus.co.uk/find-a-property/',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Acuitus', houseSlug: 'acuitus', logo: '🏢',
      date: '2026-05-06', title: '6 May 2026', lots: null,
      url: 'https://www.acuitus.co.uk/find-a-property/',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Acuitus', houseSlug: 'acuitus', logo: '🏢',
      date: '2026-06-11', title: '11 June 2026', lots: null,
      url: 'https://www.acuitus.co.uk/find-a-property/',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── HOLLIS MORGAN (Bristol) ──
    {
      house: 'Hollis Morgan', houseSlug: 'hollismorgan', logo: '🏘️',
      date: '2026-03-11', title: '11 March 2026', lots: null,
      url: 'https://www.hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc',
      location: 'Online (Live Stream from Clifton, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Hollis Morgan', houseSlug: 'hollismorgan', logo: '🏘️',
      date: '2026-04-01', title: 'April 2026', lots: null,
      url: 'https://www.hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc',
      location: 'Online (Live Stream from Clifton, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── MAGGS & ALLEN (Bristol) ──
    {
      house: 'Maggs & Allen', houseSlug: 'maggsandallen', logo: '🔨',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.maggsandallen.co.uk/search-auction/',
      location: 'Online (Live Stream, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Maggs & Allen', houseSlug: 'maggsandallen', logo: '🔨',
      date: '2026-04-23', title: '23 April 2026', lots: null,
      url: 'https://www.maggsandallen.co.uk/search-auction/',
      location: 'Online (Live Stream, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Maggs & Allen', houseSlug: 'maggsandallen', logo: '🔨',
      date: '2026-05-20', title: '20 May 2026', lots: null,
      url: 'https://www.maggsandallen.co.uk/search-auction/',
      location: 'Online (Live Stream, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── MCHUGH & CO ──
    {
      house: 'McHugh & Co', houseSlug: 'mchughandco', logo: '🏡',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://www.mchughandco.com/pages/auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'McHugh & Co', houseSlug: 'mchughandco', logo: '🏡',
      date: '2026-05-13', title: '13 May 2026', lots: null,
      url: 'https://www.mchughandco.com/pages/auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── AUCTION HOUSE UK (National franchise) ──
    {
      house: 'Auction House UK', houseSlug: 'auctionhouse', logo: '🏛️',
      date: '2026-03-10', title: '10 March 2026 (National Online)', lots: null,
      url: 'https://www.auctionhouse.co.uk/online/auction/2026/3/10',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── KNIGHT FRANK ──
    {
      house: 'Knight Frank', houseSlug: 'knightfrank', logo: '👑',
      date: '2026-03-12', title: '12 March 2026', lots: null,
      url: 'https://www.knightfrankauctions.com/forthcoming-auctions/',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── PATTINSON ──
    {
      house: 'Pattinson', houseSlug: 'pattinson', logo: '🔷',
      date: '2026-03-05', title: '5 March 2026 (North East)', lots: null,
      url: 'https://www.pattinson.co.uk/auction/property-search',
      location: 'Newcastle', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },

    // ── BIDX1 ──
    {
      house: 'BidX1', houseSlug: 'bidx1', logo: '💻',
      date: '2026-03-01', title: 'March 2026 (Online)', lots: null,
      url: 'https://bidx1.com/en/united-kingdom',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── PHILLIP ARNOLD ──
    {
      house: 'Phillip Arnold', houseSlug: 'philliparnold', logo: '🔨',
      date: '2026-04-16', title: '16 April 2026', lots: null,
      url: 'https://www.philliparnoldauctions.co.uk/current-lots',
      location: 'London', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },

    // ── EDWARD MELLOR ──
    {
      house: 'Edward Mellor', houseSlug: 'edwardmellor', logo: '🏘️',
      date: '2026-03-04', title: '4-5 March 2026', lots: null,
      url: 'https://www.edwardmellor.co.uk/auctions/04mar2026',
      location: 'Manchester', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── PAUL FOSH ──
    {
      house: 'Paul Fosh', houseSlug: 'paulfosh', logo: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      date: '2026-03-11', title: '11 March 2026', lots: null,
      url: 'https://www.paulfosh.com/auction-lots/',
      location: 'Newport', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── COTTONS ──
    {
      house: 'Cottons', houseSlug: 'cottons', logo: '🏭',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.cottons.co.uk/current-auction/',
      location: 'Birmingham', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── DEDMAN GRAY ──
    {
      house: 'Dedman Gray', houseSlug: 'dedmangray', logo: '📋',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.dedmangray.co.uk/auction/',
      location: 'Essex', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },

    // ── BARNETT ROSS ──
    {
      house: 'Barnett Ross', houseSlug: 'barnettross', logo: '🔑',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.barnettross.co.uk/current.php',
      location: 'London', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },

    // ── BRADLEY HALL ──
    {
      house: 'Bradley Hall', houseSlug: 'bradleyhall', logo: '🏠',
      date: '2026-03-12', title: '12 March 2026', lots: null,
      url: 'https://auction.bradleyhall.co.uk/search',
      location: 'Newcastle', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── CONNECT UK ──
    {
      house: 'Connect UK', houseSlug: 'connectuk', logo: '🔗',
      date: '2026-03-10', title: '10 March 2026', lots: null,
      url: 'https://realtime.connectukauctions.co.uk/for-sale/',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── AUCTION ESTATES ──
    {
      house: 'Auction Estates', houseSlug: 'auctionestates', logo: '🏢',
      date: '2026-03-12', title: '12 March 2026', lots: null,
      url: 'https://www.auctionestates.co.uk/view-properties',
      location: 'Nottingham', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── LANDWOOD ──
    {
      house: 'Landwood', houseSlug: 'landwood', logo: '🌲',
      date: '2026-03-10', title: '10 March 2026', lots: null,
      url: 'https://www.landwoodpropertyauctions.com/Auction',
      location: 'Manchester', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── LOVEITTS ──
    {
      house: 'Loveitts', houseSlug: 'loveitts', logo: '❤️',
      date: '2026-03-11', title: '11 March 2026', lots: null,
      url: 'https://www.loveitts.co.uk/auctions',
      location: 'Coventry', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── HUNTERS ──
    {
      house: 'Hunters', houseSlug: 'hunters', logo: '🎯',
      date: '2026-03-05', title: '5 March 2026', lots: null,
      url: 'https://www.hunters.com/auction-search',
      location: 'Yorkshire', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
];

async function getAuctionCalendar() {
  // Try Supabase first
  try {
    const now = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('*')
      .gte('date', now)
      .order('date', { ascending: true });

    if (!error && data && data.length > 0) {
      return data.map(row => ({
        house: row.house,
        houseSlug: row.house_slug,
        logo: row.logo,
        date: row.date,
        dateEnd: row.date_end || undefined,
        title: row.title,
        lots: row.lots,
        url: row.url,
        location: row.location,
        type: row.type,
        status: row.status,
        catalogueReady: row.catalogue_ready,
      }));
    }
  } catch (e) {
    console.warn('Calendar DB read failed, using fallback:', e.message);
  }

  // Fallback to hardcoded
  const now = new Date().toISOString().slice(0, 10);
  return FALLBACK_CALENDAR
    .filter(a => a.date >= now || a.status === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date));
}

app.get('/api/auctions', async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  try {
    const auctions = await getAuctionCalendar();
    res.json({ updated: new Date().toISOString(), count: auctions.length, auctions });
  } catch (e) {
    console.error('Calendar endpoint error:', e.message);
    res.status(500).json({ error: 'Failed to load auction calendar' });
  }
});

// Admin: seed the Supabase calendar from hardcoded data
app.post('/api/admin/seed-calendar', async (req, res) => {
  const { secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const rows = FALLBACK_CALENDAR.map(a => ({
      house: a.house, house_slug: a.houseSlug, logo: a.logo,
      date: a.date, date_end: a.dateEnd || null, title: a.title,
      lots: a.lots || null, url: a.url, location: a.location,
      type: a.type, status: a.status, catalogue_ready: a.catalogueReady,
    }));
    const { data, error } = await supabase.from('auction_calendar').upsert(rows, { onConflict: 'url,date' });
    if (error) throw error;
    res.json({ message: `Seeded ${rows.length} auction entries`, count: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: add/update a single auction
app.post('/api/admin/calendar', async (req, res) => {
  const { secret, auction } = req.body || {};
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  if (!auction || !auction.house || !auction.date || !auction.url) {
    return res.status(400).json({ error: 'Missing required fields: house, date, url' });
  }
  try {
    const row = {
      house: auction.house,
      house_slug: auction.houseSlug || auction.house.toLowerCase().replace(/[^a-z0-9]/g, ''),
      logo: auction.logo || '🔨',
      date: auction.date,
      date_end: auction.dateEnd || null,
      title: auction.title || auction.date,
      lots: auction.lots || null,
      url: auction.url,
      location: auction.location || 'Online',
      type: auction.type || 'Residential & Commercial',
      status: auction.status || 'upcoming',
      catalogue_ready: auction.catalogueReady !== undefined ? auction.catalogueReady : false,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('auction_calendar').upsert(row, { onConflict: 'url,date' });
    if (error) throw error;
    res.json({ message: 'Auction saved', auction: row });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: delete an auction by ID
app.delete('/api/admin/calendar/:id', async (req, res) => {
  const { secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const { error } = await supabase.from('auction_calendar').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Auction deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: ANALYSE CATALOGUE
// ═══════════════════════════════════════════════════════════════
app.post('/api/analyse', async (req, res) => {
  const { url, budget, email } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  // ── Check user is signed up ──
  if (!email) return res.status(401).json({ error: 'signup_required', message: 'Please sign up to use the analyser' });

  const { data: user } = await supabase
    .from('users')
    .select('id, analyses_count')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (!user) return res.status(401).json({ error: 'signup_required', message: 'Please sign up first' });

  // ── Rate limiting ──
  const ip = getClientIP(req);
  const today = new Date().toISOString().slice(0, 10);

  const { data: rateRow } = await supabase
    .from('rate_limits')
    .select('requests')
    .eq('ip', ip)
    .eq('date', today)
    .single();

  if (rateRow && rateRow.requests >= RATE_LIMIT) {
    return res.status(429).json({
      error: 'rate_limited',
      message: `Daily limit reached (${RATE_LIMIT} analyses per day). Try again tomorrow.`
    });
  }

  // ── Check cache ──
  const normalisedUrl = url.trim().replace(/\/+$/, '').toLowerCase();
  const { data: cached } = await supabase
    .from('cached_analyses')
    .select('*')
    .eq('url', normalisedUrl)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) {
    console.log(`Cache hit for ${normalisedUrl}`);
    // Handle both old cached entries (slug like 'savills') and new ones (display name like 'Savills')
    const cachedSlug = HOUSE_DISPLAY_NAMES[cached.house]
      ? cached.house  // cached.house is already a slug
      : Object.entries(HOUSE_DISPLAY_NAMES).find(([k, v]) => v === cached.house)?.[0] || 'unknown';
    const cachedDisplayName = HOUSE_DISPLAY_NAMES[cachedSlug] || cached.house;
    return res.json({
      house: cachedDisplayName,
      houseSlug: cachedSlug,
      recognised: cachedSlug !== 'unknown',
      totalLots: cached.total_lots,
      titleSplits: cached.title_splits,
      topPicks: cached.top_picks,
      under100k: cached.under_100k || 0,
      avgYield: cached.avg_yield || null,
      devPotential: cached.dev_potential || 0,
      vacantCount: cached.vacant_count || 0,
      lots: cached.lots,
      cached: true,
    });
  }

  // ── Increment rate counter (only for fresh analyses, not cached) ──
  if (rateRow) {
    await supabase.from('rate_limits').update({ requests: rateRow.requests + 1 }).eq('ip', ip).eq('date', today);
  } else {
    await supabase.from('rate_limits').insert({ ip, date: today, requests: 1 });
  }

  // ── Fresh analysis ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const house = detectAuctionHouse(url);
    const rewritten = rewriteUrl(url, house);
    const scrapeUrl = rewritten.baseUrl;
    
    console.log(`House: ${house}, URL: ${scrapeUrl}, isApi: ${rewritten.isApi}, preferPuppeteer: ${!!rewritten.preferPuppeteer}`);

    // Validate URL first (skip for sites that block server-side fetches)
    if (!rewritten.preferPuppeteer) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const testResp = await fetch(url, { headers: HEADERS, signal: controller.signal });
        clearTimeout(timeout);
        if (!testResp.ok) {
          return res.status(400).json({
            error: 'url_error',
            message: `That URL returned an error (${testResp.status}). It may not be a catalogue page, or the catalogue hasn't been published yet.`
          });
        }
      } catch (e) {
        return res.status(400).json({ error: 'url_unreachable', message: "Couldn't reach that URL. Check it's a valid catalogue page." });
      }
    }

    let pages;
    const client = new Anthropic({ apiKey });
    let rawLots = [];

    // ── PDF catalogues — send directly to Claude ──
    if (isPdfUrl(url)) {
      log.info('pdf_detected', { url, house });
      rawLots = await extractLotsFromPdf(client, url);
    } else if (rewritten.paginateAs === 'allsop_api') {
      // Allsop API: paginate through JSON endpoint
      pages = await scrapeAllsopApi(rewritten.baseUrl);
      if (pages.length > 0) {
        rawLots = await extractLotsWithClaude(client, pages, house);
      }
    } else if (rewritten.preferPuppeteer) {
      // JS-rendered sites: go straight to Puppeteer
      console.log(`Using Puppeteer directly for ${house} (JS-rendered site)...`);
      const browser = await getBrowser();
      const page = await browser.newPage();
      await page.setUserAgent(HEADERS['User-Agent']);
      await page.setViewport({ width: 1280, height: 900 });
      await page.setRequestInterception(true);
      page.on('request', req => {
        const type = req.resourceType();
        if (['image', 'font', 'media'].includes(type)) req.abort();
        else req.continue();
      });

      try {
        // Handle paginated sites (Savills has 28+ pages)
        if (rewritten.paginateAs === 'savills_pages') {
          console.log(`Puppeteer: loading paginated Savills catalogue...`);
          // Load first page to detect total pages
          await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
          await new Promise(r => setTimeout(r, 2000));
          
          // Detect total pages from pagination links
          const totalPages = await page.evaluate(() => {
            const pageLinks = document.querySelectorAll('a[href*="/page-"]');
            let max = 1;
            for (const a of pageLinks) {
              const m = a.textContent.trim().match(/^(\d+)$/);
              if (m) max = Math.max(max, parseInt(m[1]));
            }
            return max;
          });
          console.log(`Savills: detected ${totalPages} pages`);

          // Extract from first page
          const firstPageLots = await extractWithDOM(page, house);
          if (firstPageLots && firstPageLots.length > 0) rawLots.push(...firstPageLots);
          console.log(`Page 1: ${firstPageLots ? firstPageLots.length : 0} lots`);

          // Load remaining pages
          const maxPages = Math.min(totalPages, 50);
          for (let p = 2; p <= maxPages; p++) {
            const pageUrl = `${scrapeUrl}/page-${p}`;
            try {
              await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
              await new Promise(r => setTimeout(r, 1500));
              const pageLots = await extractWithDOM(page, house);
              if (pageLots && pageLots.length > 0) rawLots.push(...pageLots);
              console.log(`Page ${p}: ${pageLots ? pageLots.length : 0} lots`);
            } catch (e) {
              console.log(`Page ${p} failed: ${e.message}`);
            }
          }
          console.log(`Savills total: ${rawLots.length} lots from ${maxPages} pages via DOM extraction`);

        } else if (rewritten.paginateAs === 'sdl_pages') {
          // ── SDL / BTG Eddisons: paginated with ?page=N ──
          console.log(`Puppeteer: loading paginated SDL catalogue...`);
          await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
          await new Promise(r => setTimeout(r, 3000));
          // Scroll to load lazy content on first page
          await page.evaluate(async () => {
            for (let i = 0; i < 15; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 500)); }
            window.scrollTo(0, 0);
          });
          await new Promise(r => setTimeout(r, 2000));

          // Detect total pages from pagination
          const sdlTotalPages = await page.evaluate(() => {
            const pageLinks = document.querySelectorAll('a[href*="page="], .pagination a, nav a');
            let max = 1;
            for (const a of pageLinks) {
              const href = a.getAttribute('href') || '';
              const pm = href.match(/page=(\d+)/);
              if (pm) max = Math.max(max, parseInt(pm[1]));
              const tm = a.textContent.trim().match(/^(\d+)$/);
              if (tm) max = Math.max(max, parseInt(tm[1]));
            }
            const bodyText = document.body.innerText;
            const ofMatch = bodyText.match(/page\s+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+pages/i);
            if (ofMatch) max = Math.max(max, parseInt(ofMatch[1]));
            return max;
          });
          console.log(`SDL: detected ${sdlTotalPages} pages`);

          // Extract from first page
          const sdlFirstLots = await extractWithDOM(page, house);
          if (sdlFirstLots && sdlFirstLots.length > 0) rawLots.push(...sdlFirstLots);
          console.log(`SDL Page 1: ${sdlFirstLots ? sdlFirstLots.length : 0} lots`);

          // Load remaining pages
          const sdlMaxPages = Math.min(sdlTotalPages, 20);
          for (let p = 2; p <= sdlMaxPages; p++) {
            const sep = scrapeUrl.includes('?') ? '&' : '?';
            const pageUrl = `${scrapeUrl}${sep}page=${p}`;
            try {
              await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
              await new Promise(r => setTimeout(r, 2000));
              await page.evaluate(async () => {
                for (let i = 0; i < 10; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 400)); }
                window.scrollTo(0, 0);
              });
              await new Promise(r => setTimeout(r, 1500));
              const pageLots = await extractWithDOM(page, house);
              if (pageLots && pageLots.length > 0) {
                rawLots.push(...pageLots);
                console.log(`SDL Page ${p}: ${pageLots.length} lots`);
              } else {
                console.log(`SDL Page ${p}: 0 lots — stopping pagination`);
                break;
              }
            } catch (e) {
              console.log(`SDL Page ${p} failed: ${e.message}`);
              break;
            }
          }
          console.log(`SDL total: ${rawLots.length} lots via DOM extraction`);

        } else {
          // ── Generic Puppeteer extraction with auto-pagination ──
          console.log(`Puppeteer: loading ${scrapeUrl} for ${house}`);
          await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
          await new Promise(r => setTimeout(r, 3000));

          // Scroll to trigger lazy loading
          await page.evaluate(async () => {
            for (let i = 0; i < 15; i++) {
              window.scrollBy(0, window.innerHeight);
              await new Promise(r => setTimeout(r, 500));
            }
            window.scrollTo(0, 0);
          });
          await new Promise(r => setTimeout(r, 2000));

          // Extract page 1
          const domLots = await extractWithDOM(page, house);
          if (domLots && domLots.length >= 3) {
            rawLots.push(...domLots);
            console.log(`${house} Page 1: ${domLots.length} lots via DOM extraction`);

            // ── Auto-detect pagination and follow it ──
            const detectedPages = await page.evaluate(() => {
              let max = 1;
              // Strategy 1: ?page=N or &page=N links
              document.querySelectorAll('a[href*="page="], a[href*="page-"], a[href*="/page/"]').forEach(a => {
                const href = a.getAttribute('href') || '';
                const m = href.match(/page[=/](\d+)/) || href.match(/page-(\d+)/);
                if (m) max = Math.max(max, parseInt(m[1]));
              });
              // Strategy 2: pagination nav with numbered links
              document.querySelectorAll('.pagination a, nav.pagination a, .paging a, .page-numbers a, [class*="pagination"] a, [class*="pager"] a').forEach(a => {
                const t = a.textContent.trim();
                if (t.match(/^\d+$/)) max = Math.max(max, parseInt(t));
              });
              // Strategy 3: "Page X of Y" text
              const bodyText = document.body.innerText;
              const ofMatch = bodyText.match(/page\s+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+pages/i);
              if (ofMatch) max = Math.max(max, parseInt(ofMatch[1]));
              // Strategy 4: "Showing 1-20 of 345" — calculate pages
              const showMatch = bodyText.match(/showing\s+\d+[\s-]+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+results?\s+found/i) || bodyText.match(/(\d+)\s+(?:lots?|properties)/i);
              if (showMatch) {
                const total = parseInt(showMatch[1]);
                if (total > 50) max = Math.max(max, Math.ceil(total / 20)); // assume ~20 per page
              }
              // Detect the pagination URL pattern
              let pattern = 'query'; // default: ?page=N
              const pageLink = document.querySelector('a[href*="page-"]');
              if (pageLink) pattern = 'path-dash'; // /page-2
              const pageSlash = document.querySelector('a[href*="/page/"]');
              if (pageSlash) pattern = 'path-slash'; // /page/2
              return { max, pattern };
            });

            if (detectedPages.max > 1) {
              const maxPages = Math.min(detectedPages.max, 25);
              console.log(`${house}: detected ${detectedPages.max} pages (pattern: ${detectedPages.pattern}), loading up to ${maxPages}`);

              for (let p = 2; p <= maxPages; p++) {
                let pageUrl;
                if (detectedPages.pattern === 'path-dash') {
                  pageUrl = scrapeUrl.replace(/\/page-\d+/, '') + `/page-${p}`;
                } else if (detectedPages.pattern === 'path-slash') {
                  pageUrl = scrapeUrl.replace(/\/page\/\d+/, '') + `/page/${p}`;
                } else {
                  const sep = scrapeUrl.includes('?') ? '&' : '?';
                  pageUrl = `${scrapeUrl}${sep}page=${p}`;
                }

                try {
                  await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                  await new Promise(r => setTimeout(r, 2000));
                  await page.evaluate(async () => {
                    for (let i = 0; i < 10; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 400)); }
                    window.scrollTo(0, 0);
                  });
                  await new Promise(r => setTimeout(r, 1500));
                  const pageLots = await extractWithDOM(page, house);
                  if (pageLots && pageLots.length > 0) {
                    rawLots.push(...pageLots);
                    console.log(`${house} Page ${p}: ${pageLots.length} lots`);
                  } else {
                    console.log(`${house} Page ${p}: 0 lots — stopping pagination`);
                    break;
                  }
                } catch (e) {
                  console.log(`${house} Page ${p} failed: ${e.message}`);
                  break;
                }
              }
            }
            console.log(`${house} total: ${rawLots.length} lots via DOM extraction (no Claude needed)`);
          } else {
            // Fall back to Claude extraction from page HTML
            if (domLots && domLots.length > 0) {
              console.log(`DOM extractor found only ${domLots.length} lots for ${house} (below threshold of 3), falling back to Claude`);
            }
            const html = await page.content();
            console.log(`Puppeteer: got ${html.length} chars, sending to Claude...`);
            const puppeteerPages = [{ page: 1, html }];
            rawLots = await extractLotsWithClaude(client, puppeteerPages, house);
            console.log(`Claude extracted ${rawLots.length} lots from Puppeteer content`);
          }
        }
      } finally {
        await page.close();
      }
    } else {
      // Standard static HTML scraping
      pages = await scrapeAllPages(scrapeUrl, house);
      if (pages && pages.length > 0) {
        rawLots = await extractLotsWithClaude(client, pages, house);
      }
      // Puppeteer fallback if static scraping found nothing
      // Skip for houses where Puppeteer wastes memory (blocked, empty, or JS-only)
      const SKIP_PUPPETEER = ['pattinson','knightfrank','paulfosh','cottons','dedmangray',
        'barnettross','philliparnold','network'];
      if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
        console.log(`No lots from static HTML, trying Puppeteer for ${house}...`);
        const puppeteerPages = await scrapeWithPuppeteer(url, house);
        if (puppeteerPages.length > 0) {
          console.log(`Puppeteer got ${puppeteerPages.length} page(s), sending to Claude...`);
          rawLots = await extractLotsWithClaude(client, puppeteerPages, house);
          console.log(`Claude extracted ${rawLots.length} lots from Puppeteer content`);
        }
      }
    }
    
    if (pages && pages.length === 0 && rawLots.length === 0) {
      return res.status(400).json({ error: 'no_content', message: "Couldn't find any content on that page." });
    }

    if (rawLots.length === 0) {
      return res.status(400).json({ error: 'no_lots', message: "Couldn't find any auction lots. Make sure you're linking to the catalogue page, not the auction house homepage." });
    }

    const analysed = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);

    // ── Enrich with Land Registry + rental yields ──
    console.log('Starting Land Registry + rental yield enrichment...');
    await enrichLots(analysed, house, url);

    // ── Cache results ──
    const displayName = getHouseDisplayName(house, url);
    const expiresAt = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const lotsWithPrice = analysed.filter(l => l.price && l.price > 0);
    const yieldsArr = analysed.map(l => l.estGrossYield).filter(y => y && y > 0);

    // Log unknown house successes for future house addition
    if (house === 'unknown' && analysed.length >= 3) {
      log.info('NEW_HOUSE_CANDIDATE', { hostname: new URL(url).hostname, lots: analysed.length, url });
    }

    await supabase.from('cached_analyses').upsert({
      url: normalisedUrl,
      house: displayName,
      total_lots: analysed.length,
      title_splits: analysed.filter(l => l.titleSplit).length,
      top_picks: analysed.filter(l => l.score >= 3).length,
      under_100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avg_yield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      dev_potential: analysed.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacant_count: analysed.filter(l => l.vacant === true).length,
      lots: analysed,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    }, { onConflict: 'url' });

    // ── Update user count ──
    await supabase.from('users')
      .update({ analyses_count: (user.analyses_count || 0) + 1 })
      .eq('id', user.id);

    return res.json({
      house: displayName,
      houseSlug: house,
      recognised: house !== 'unknown',
      totalLots: analysed.length,
      titleSplits: analysed.filter(l => l.titleSplit).length,
      topPicks: analysed.filter(l => l.score >= 3).length,
      under100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avgYield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      devPotential: analysed.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacantCount: analysed.filter(l => l.vacant === true).length,
      lots: analysed,
      cached: false,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH: Claude-powered filtering across cached analyses
// ═══════════════════════════════════════════════════════════════
app.post('/api/smart-search', async (req, res) => {
  const { query, email } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing search query' });
  if (!email) return res.status(401).json({ error: 'signup_required' });

  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .single();
  if (!user) return res.status(401).json({ error: 'signup_required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    // Get all cached analyses
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('house, url, lots, total_lots')
      .gt('expires_at', new Date().toISOString());

    if (!cached || cached.length === 0) {
      return res.json({ results: [], report: 'No cached auction data available. Please analyse some auction catalogues first.', sources: [] });
    }

    // Gather all lots from all cached analyses
    const allLots = [];
    const sources = [];
    for (const c of cached) {
      if (c.lots && Array.isArray(c.lots)) {
        sources.push({ house: c.house, url: c.url, count: c.lots.length });
        for (const lot of c.lots) {
          allLots.push({ ...lot, _house: c.house, _sourceUrl: c.url });
        }
      }
    }

    if (allLots.length === 0) {
      return res.json({ results: [], report: 'No lot data in cache. Please analyse auction catalogues first.', sources: [] });
    }

    // Build a compact lot summary for Claude, prioritising query-relevant lots
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const lotEntries = allLots.map((l, i) => {
      const summary = `[${i}] ${l._house} L${l.lot}: ${l.address} | £${l.price || '?'} | Score:${l.score || 0} | ${l.titleSplit ? 'TITLE_SPLIT' : ''} | ${(l.bullets || []).join('; ').substring(0, 150)}`;
      const searchText = summary.toLowerCase();
      const relevance = queryTerms.filter(t => searchText.includes(t)).length;
      return { summary, relevance };
    });

    // Sort: query-relevant lots first, then by original order
    lotEntries.sort((a, b) => b.relevance - a.relevance);

    // Build context string with 120K char budget (fits within Claude's context)
    const CONTEXT_LIMIT = 120000;
    let lotSummaries = '';
    let included = 0;
    for (const entry of lotEntries) {
      if (lotSummaries.length + entry.summary.length + 1 > CONTEXT_LIMIT) break;
      lotSummaries += entry.summary + '\n';
      included++;
    }
    const omitted = allLots.length - included;

    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: `You are a UK property investment analyst. A user has searched across ${allLots.length} auction lots from ${sources.length} auction house catalogues.

Their search query: "${query}"

Here are ${included} lots${omitted > 0 ? ` (${omitted} lower-relevance lots omitted for brevity)` : ''}, sorted by relevance to the query (index, house, lot number, address, price, score, title split status, key features):

${lotSummaries}

TASK:
1. Identify the lots that best match the user's query. Return the indices of matching lots.
2. Write a brief investment report (2-3 paragraphs) summarising what you found.

Respond in this exact JSON format:
{"indices":[0,5,12],"report":"Your report here..."}

Only return lots that genuinely match the query. If nothing matches well, say so in the report and return an empty indices array.` }]
    });

    const responseText = msg.content[0]?.text || '';
    let parsed;
    try {
      // Strip markdown code fences if present
      let cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      // Extract JSON object from response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(cleaned);
      }
    } catch (e) {
      console.log('Smart search JSON parse failed:', e.message, 'Raw:', responseText.substring(0, 200));
      // Try to extract report text even if JSON parsing fails
      const reportMatch = responseText.match(/"report"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      const indicesMatch = responseText.match(/"indices"\s*:\s*\[([\d,\s]*)\]/);
      parsed = {
        indices: indicesMatch ? indicesMatch[1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)) : [],
        report: reportMatch ? reportMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : responseText.replace(/\{[\s\S]*\}/, '').trim() || 'Search completed but could not parse results.'
      };
    }

    const matchingLots = (parsed.indices || [])
      .filter(i => i >= 0 && i < allLots.length)
      .map(i => allLots[i]);

    return res.json({
      results: matchingLots,
      report: parsed.report || '',
      sources,
      totalSearched: allLots.length,
    });
  } catch (err) {
    console.error('Smart search error:', err);
    return res.status(500).json({ error: err.message || 'Search failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN: Cache Status & Manual Refresh
// ═══════════════════════════════════════════════════════════════
app.get('/api/cache-status', async (req, res) => {
  try {
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('house, url, total_lots, title_splits, top_picks, under_100k, avg_yield, dev_potential, vacant_count, created_at, expires_at')
      .gt('expires_at', new Date().toISOString())
      .order('house');

    const allAuctions = getCalendarAuctions();
    const ready = allAuctions.filter(a => a.catalogueReady);
    const cachedUrls = new Set((cached || []).map(c => c.url));
    
    const totalLots = (cached || []).reduce((s, c) => s + (c.total_lots || 0), 0);
    const missing = ready.filter(a => !cachedUrls.has(a.url.trim().replace(/\/+$/, '').toLowerCase()));

    res.json({
      summary: {
        totalCached: (cached || []).length,
        totalReady: ready.length,
        totalLots,
        missingCount: missing.length,
      },
      cached: cached || [],
      missing: missing.map(a => ({ house: a.house, url: a.url })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/refresh-cache', async (req, res) => {
  const { secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  res.json({ message: 'Auto-analysis triggered. Check server logs for progress.' });
  // Run async — don't block the response
  autoAnalyseAll().catch(e => console.error('Manual refresh failed:', e));
});

// User-facing: analyse all catalogue-ready auctions
app.post('/api/analyse-all', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(401).json({ error: 'signup_required' });

  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .single();
  if (!user) return res.status(401).json({ error: 'signup_required' });

  // Trigger auto-analysis and wait for it to complete
  try {
    const result = await autoAnalyseAll();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// CATCH-ALL
// ═══════════════════════════════════════════════════════════════
app.get('/welcome', (req, res) => {
  res.sendFile(join(__dirname, 'welcome.html'));
});

// ═══════════════════════════════════════════════════════════════
// BRIDGEMATCH LITE
// ═══════════════════════════════════════════════════════════════
app.get('/check', (req, res) => {
  res.sendFile(join(__dirname, 'bridgematch-lite.html'));
});

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

// ═══════════════════════════════════════════════════════════════
// AUCTION HOUSE DETECTION
// ═══════════════════════════════════════════════════════════════
function detectAuctionHouse(url) {
  const u = url.toLowerCase();
  if (u.includes('savills')) return 'savills';
  if (u.includes('allsop')) return 'allsop';
  if (u.includes('btgeddisonspropertyauctions') || u.includes('btgeddisons')) return 'sdl';
  if (u.includes('pugh-auctions')) return 'sdl'; // Pugh merged into BTG Eddisons/SDL
  if (u.includes('sdlauctions')) return 'sdl';
  if (u.includes('networkauctions')) return 'network';
  if (u.includes('bondwolfe')) return 'bondwolfe';
  if (u.includes('barnardmarcusauctions') || u.includes('barnardmarcus')) return 'barnardmarcus';
  if (u.includes('auctionhouselondon')) return 'auctionhouselondon';
  if (u.includes('auctionhouse.co.uk')) return 'auctionhouse';
  if (u.includes('cliveemson')) return 'cliveemson';
  if (u.includes('strettons')) return 'strettons';
  if (u.includes('acuitus')) return 'acuitus';
  if (u.includes('hollismorgan')) return 'hollismorgan';
  if (u.includes('maggsandallen')) return 'maggsandallen';
  if (u.includes('mchughandco')) return 'mchughandco';
  if (u.includes('knightfrankauctions')) return 'knightfrank';
  if (u.includes('pattinson.co.uk')) return 'pattinson';
  if (u.includes('bidx1.com')) return 'bidx1';
  if (u.includes('philliparnoldauctions')) return 'philliparnold';
  if (u.includes('edwardmellor')) return 'edwardmellor';
  if (u.includes('paulfosh')) return 'paulfosh';
  if (u.includes('cottons.co.uk')) return 'cottons';
  if (u.includes('dedmangray')) return 'dedmangray';
  if (u.includes('barnettross')) return 'barnettross';
  if (u.includes('bradleyhall')) return 'bradleyhall';
  if (u.includes('connectukauctions') || u.includes('connectukgroup')) return 'connectuk';
  if (u.includes('auctionestates')) return 'auctionestates';
  if (u.includes('landwoodpropertyauctions') || u.includes('landwoodgroup')) return 'landwood';
  if (u.includes('loveitts')) return 'loveitts';
  if (u.includes('hunters.com')) return 'hunters';
  // buttersjohnbee — PDF-only catalogues, not supported for DOM extraction
  if (u.includes('auctionhouselondon')) return 'auctionhouselondon';
  if (u.includes('auctionhouse.co.uk')) return 'auctionhouse';
  if (u.includes('pughauctions') || u.includes('pugh')) return 'sdl';
  return 'unknown';
}

const HOUSE_DISPLAY_NAMES = {
  savills: 'Savills', allsop: 'Allsop', sdl: 'SDL Auctions',
  network: 'Network Auctions', bondwolfe: 'Bond Wolfe', barnardmarcus: 'Barnard Marcus',
  auctionhouselondon: 'Auction House London', auctionhouse: 'Auction House UK',
  cliveemson: 'Clive Emson', strettons: 'Strettons', acuitus: 'Acuitus',
  hollismorgan: 'Hollis Morgan', maggsandallen: 'Maggs & Allen', mchughandco: 'McHugh & Co',
  knightfrank: 'Knight Frank', pattinson: 'Pattinson', bidx1: 'BidX1',
  philliparnold: 'Phillip Arnold', edwardmellor: 'Edward Mellor', paulfosh: 'Paul Fosh',
  cottons: 'Cottons', dedmangray: 'Dedman Gray', barnettross: 'Barnett Ross',
  bradleyhall: 'Bradley Hall', connectuk: 'Connect UK', auctionestates: 'Auction Estates',
  landwood: 'Landwood', loveitts: 'Loveitts', hunters: 'Hunters',
};

function getHouseDisplayName(slug, url) {
  if (HOUSE_DISPLAY_NAMES[slug]) return HOUSE_DISPLAY_NAMES[slug];
  if (slug === 'unknown' && url) {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');
      return hostname.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    } catch { /* fall through */ }
  }
  return 'Auction';
}

// ═══════════════════════════════════════════════════════════════
// URL REWRITING (map user-friendly URLs to data endpoints)
// ═══════════════════════════════════════════════════════════════
function rewriteUrl(url, house) {
  const u = url.toLowerCase();

  if (house === 'savills') {
    // Savills: auctions.savills.co.uk/auctions/{slug} — server-rendered, paginated
    // Rewrite to specific auction page. DOM extractor handles extraction.
    // If user pastes auctions.savills.co.uk or upcoming-auctions, keep as-is for now
    if (u.includes('auctions.savills.co.uk/auctions/')) {
      return { baseUrl: url, isApi: false, paginateAs: 'savills_pages', preferPuppeteer: true };
    }
    // Generic savills URL — try the latest auction
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'allsop') {
    // Allsop: rewrite catalogue pages to their JSON API
    if (u.includes('residential-auction') || u.includes('lot_type=residential')) {
      return { 
        baseUrl: 'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=residential&page=1&react',
        isApi: true,
        paginateAs: 'allsop_api'
      };
    }
    if (u.includes('commercial-auction') || u.includes('lot_type=commercial')) {
      return {
        baseUrl: 'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=commercial&page=1&react',
        isApi: true,
        paginateAs: 'allsop_api'
      };
    }
    // If it's the property-search API URL already, use it directly
    if (u.includes('/api/property-search')) {
      return { baseUrl: url, isApi: true, paginateAs: 'allsop_api' };
    }
  }

  if (house === 'sdl') {
    // SDL / BTG Eddisons: JS-rendered with pagination (?page=2, ?page=3 etc)
    if (u.includes('btgeddisonspropertyauctions.com/properties')) {
      return { baseUrl: url, isApi: false, paginateAs: 'sdl_pages', preferPuppeteer: true };
    }
    if (u.includes('/auction/')) {
      return { baseUrl: url, isApi: false, paginateAs: 'sdl_pages', preferPuppeteer: true };
    }
    if (u.includes('/search')) {
      return { baseUrl: url, isApi: false, paginateAs: 'sdl_pages', preferPuppeteer: true };
    }
  }

  if (house === 'bondwolfe') {
    // Bond Wolfe: /auctions/properties/ or /auction/3448/ → JS-rendered, needs Puppeteer
    if (u.includes('/auction/') || u.includes('/auctions/properties')) {
      return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
    }
  }

  if (house === 'network') {
    // Network Auctions: blocks server-side fetches (403), must use Puppeteer
    // /auctions/next-auction/ or /auctions/current-lots/
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'barnardmarcus') {
    // Barnard Marcus: server-rendered but DOM extractor works better with Puppeteer
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'auctionhouselondon') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'cliveemson') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'strettons') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'auctionhouse') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'acuitus') {
    // Acuitus: /find-a-property/ — may need Puppeteer
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'hollismorgan') {
    // Always rewrite to the current lots view with proper params
    return { baseUrl: 'https://www.hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc', isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'maggsandallen') {
    // Always rewrite to the current auction lots
    return { baseUrl: 'https://www.maggsandallen.co.uk/search-auction/?auction=1&orderby=lot_no&n=0', isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'mchughandco') {
    // McHugh & Co: /pages/auctions or /Auctions/LotList.aspx — may need Puppeteer
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // buttersjohnbee removed — PDF-only catalogues

  // Unknown houses: prefer Puppeteer since most modern auction sites are JS-rendered
  if (house === 'unknown') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // Known houses without specific rewrite rules — static HTML works for these
  return { baseUrl: url, isApi: false, paginateAs: null };
}

// ═══════════════════════════════════════════════════════════════
// SCRAPING
// ═══════════════════════════════════════════════════════════════
async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function scrapeAllPages(baseUrl, house) {
  const pages = [];
  const html1 = await fetchPage(baseUrl);
  pages.push({ page: 1, html: html1 });
  const totalPages = detectTotalPages(html1, baseUrl, house);
  for (let pg = 2; pg <= Math.min(totalPages, MAX_PAGES); pg++) {
    const pageUrl = buildPageUrl(baseUrl, pg, house);
    try {
      const html = await fetchPage(pageUrl);
      if (html.length > 1000) { pages.push({ page: pg, html }); }
      else { break; }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { break; }
  }
  return pages;
}

// Allsop JSON API pagination
async function scrapeAllsopApi(baseUrl) {
  const pages = [];
  for (let pg = 1; pg <= MAX_PAGES; pg++) {
    const pageUrl = baseUrl.replace(/page=\d+/, `page=${pg}`);
    try {
      const html = await fetchPage(pageUrl);
      if (html.length < 100 || html.includes('"data":[]') || html.includes('"template":"404"')) {
        console.log(`Allsop API: page ${pg} empty, stopping`);
        break;
      }
      pages.push({ page: pg, html });
      console.log(`Allsop API: got ${html.length} chars from page ${pg}`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`Allsop API: page ${pg} failed: ${e.message}`);
      break;
    }
  }
  return pages;
}

function detectTotalPages(html, url, house) {
  const pageMatches = [...html.matchAll(/page[=-](\d+)/gi)];
  if (pageMatches.length > 0) return Math.max(...pageMatches.map(m => parseInt(m[1])));
  const ofMatch = html.match(/page\s+\d+\s+of\s+(\d+)/i);
  if (ofMatch) return parseInt(ofMatch[1]);
  const numMatches = [...html.matchAll(/<a[^>]*>\s*(\d{1,3})\s*<\/a>/g)];
  const nums = numMatches.map(m => parseInt(m[1])).filter(n => n >= 2 && n <= 100);
  if (nums.length) return Math.max(...nums);
  return 1;
}

function buildPageUrl(baseUrl, page, house) {
  const clean = baseUrl.replace(/\/page[-=]\d+/i, '').replace(/[?&]page=\d+/i, '');
  switch (house) {
    case 'savills': return `${clean}/page-${page}`;
    case 'allsop': return `${clean}?page=${page}`;
    case 'sdl': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'network': return `${clean}?page=${page}`;
    case 'bondwolfe': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'barnardmarcus': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'acuitus': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    default:
      if (baseUrl.includes('/page-')) return `${clean}/page-${page}`;
      return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// PUPPETEER SCRAPING (for JS-rendered sites)
// ═══════════════════════════════════════════════════════════════
let browserInstance = null;
let browserUseCount = 0;
const BROWSER_MAX_USES = 10;

async function getBrowser() {
  // Restart browser after N uses to prevent memory bloat
  if (browserInstance && browserUseCount >= BROWSER_MAX_USES) {
    console.log(`Puppeteer: recycling browser after ${browserUseCount} uses`);
    try { await browserInstance.close(); } catch (e) { /* ignore */ }
    browserInstance = null;
    browserUseCount = 0;
  }
  if (browserInstance && browserInstance.isConnected()) {
    browserUseCount++;
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
    ],
  });
  browserUseCount = 1;
  return browserInstance;
}

async function scrapeWithPuppeteer(url, house) {
  const pages = [];
  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setViewport({ width: 1280, height: 900 });

    // Block images/fonts/media to speed up loading
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) req.abort();
      else req.continue();
    });

    console.log(`Puppeteer: loading ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

    // Wait a bit more for dynamic content to render
    await new Promise(r => setTimeout(r, 3000));

    // Scroll down to trigger lazy loading
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 800));
      }
      window.scrollTo(0, 0);
    });

    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();
    pages.push({ page: 1, html });
    console.log(`Puppeteer: got ${html.length} chars from page 1`);

    // Check for pagination and scrape more pages
    const totalPages = detectTotalPages(html, url, house);
    for (let pg = 2; pg <= Math.min(totalPages, MAX_PAGES); pg++) {
      try {
        const pageUrl = buildPageUrl(url, pg, house);
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        // Scroll to trigger lazy loading
        await page.evaluate(async () => {
          for (let i = 0; i < 3; i++) {
            window.scrollBy(0, window.innerHeight);
            await new Promise(r => setTimeout(r, 600));
          }
        });
        await new Promise(r => setTimeout(r, 1500));

        const pgHtml = await page.content();
        if (pgHtml.length > 2000) {
          pages.push({ page: pg, html: pgHtml });
          console.log(`Puppeteer: got ${pgHtml.length} chars from page ${pg}`);
        } else { break; }
      } catch (e) {
        console.log(`Puppeteer: page ${pg} failed: ${e.message}`);
        break;
      }
    }

    await page.close();
  } catch (err) {
    console.error(`Puppeteer scrape failed: ${err.message}`);
  }
  return pages;
}

// ═══════════════════════════════════════════════════════════════
// CLAUDE EXTRACTION
// ═══════════════════════════════════════════════════════════════
async function extractLotsWithClaude(client, pages, house) {
  const allLots = [];
  const seenLots = new Set();
  const batchSize = 3;
  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize);
    const strippedBatch = batch.map(p => ({ page: p.page, content: stripHtml(p.html) }));
    const totalStrippedLen = strippedBatch.reduce((sum, p) => sum + p.content.length, 0);
    console.log(`Batch ${Math.floor(i/batchSize)+1}: ${strippedBatch.length} page(s), ${totalStrippedLen} chars after stripping`);
    const prompt = `You are extracting property auction lot data from a UK auction house catalogue (${house}).

Below are ${strippedBatch.length} page(s) of catalogue content. Extract EVERY auction lot you find.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (detail page URL if found, empty string if not)
- bullets: array of strings (key features/description points - tenure, bedrooms, condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text. If a page has no lots, return an empty array.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Bullet points include things like: property type, bedrooms, tenure (freehold/leasehold), condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
- Include ALL lots, even commercial ones or land

${strippedBatch.map(p => `=== PAGE ${p.page} ===\n${p.content}`).join('\n\n')}

Return ONLY the JSON array:`;
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.content.map(c => c.text || '').join('');
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const lots = JSON.parse(jsonMatch[0]);
        for (const lot of lots) {
          if (lot.lot && !seenLots.has(lot.lot)) {
            seenLots.add(lot.lot);
            allLots.push({
              lot: lot.lot, address: lot.address || '',
              price: lot.price || null,
              priceText: lot.price ? `£${lot.price.toLocaleString()}` : 'TBA',
              url: lot.url || '', bullets: lot.bullets || [],
            });
          }
        }
      }
    } catch (err) {
      console.error(`Claude extraction failed for batch starting at page ${batch[0].page}:`, err.message);
    }
  }
  return allLots;
}

// ═══════════════════════════════════════════════════════════════
// PDF EXTRACTION — Send PDF directly to Claude for lot extraction
// ═══════════════════════════════════════════════════════════════
function isPdfUrl(url) {
  return /\.pdf(\?|$|#)/i.test(url) || /content-type=application\/pdf/i.test(url);
}

async function extractLotsFromPdf(client, url) {
  log.info('pdf_download', { url });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let pdfBuffer;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`PDF download failed: HTTP ${resp.status}`);
    pdfBuffer = Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    clearTimeout(timeout);
    throw new Error(`Couldn't download PDF: ${e.message}`);
  }

  const pdfBase64 = pdfBuffer.toString('base64');
  const sizeMB = (pdfBuffer.length / 1024 / 1024).toFixed(1);
  log.info('pdf_loaded', { sizeMB, bytes: pdfBuffer.length });

  // Claude supports PDFs up to 32MB
  if (pdfBuffer.length > 32 * 1024 * 1024) {
    throw new Error('PDF is too large (over 32MB). Try a smaller catalogue.');
  }

  const allLots = [];
  const seenLots = new Set();

  // Send full PDF to Claude — it can read the document natively
  const prompt = `You are extracting property auction lot data from a UK auction house catalogue PDF.

Extract EVERY auction lot you find in this PDF document.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (empty string — PDFs don't have lot URLs)
- bullets: array of strings (key features/description points - tenure, bedrooms, condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Bullet points include things like: property type, bedrooms, tenure (freehold/leasehold), condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
- Include ALL lots, even commercial ones or land
- Do NOT include terms & conditions, legal text, or non-lot pages

Return ONLY the JSON array:`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });
    const text = response.content.map(c => c.text || '').join('');
    if (response.stop_reason === 'max_tokens') {
      log.warn('pdf_truncated', { url, textLength: text.length });
    }
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const lots = JSON.parse(jsonMatch[0]);
      for (const lot of lots) {
        if (lot.lot && !seenLots.has(lot.lot)) {
          seenLots.add(lot.lot);
          allLots.push({
            lot: lot.lot, address: lot.address || '',
            price: lot.price || null,
            priceText: lot.price ? `£${lot.price.toLocaleString()}` : 'TBA',
            url: '', bullets: lot.bullets || [],
          });
        }
      }
    }
    log.info('pdf_extracted', { lots: allLots.length, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens });
  } catch (err) {
    log.error('pdf_extraction_failed', { error: err.message });
    throw new Error(`PDF extraction failed: ${err.message}`);
  }

  return allLots;
}

function stripHtml(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    // Remove common noise sections by class/id patterns
    .replace(/<div[^>]*class="[^"]*(?:testimonial|review|cookie|consent|modal|popup|newsletter|sidebar|social|share|footer|banner|advert)[^"]*"[\s\S]*?<\/div>/gi, '')
    .replace(/<section[^>]*class="[^"]*(?:testimonial|review|cookie|consent|modal|popup|newsletter)[^"]*"[\s\S]*?<\/section>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    // Remove repeated whitespace more aggressively
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/ \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Allow up to 120k for large catalogues (Claude can handle it)
  if (text.length > 120000) text = text.substring(0, 120000);
  return text;
}

// ═══════════════════════════════════════════════════════════════
// DOM EXTRACTORS - Per-house JS that runs inside Puppeteer
// Returns structured lot data directly, no Claude needed for extraction
// ═══════════════════════════════════════════════════════════════

const DOM_EXTRACTORS = {
  // ─── SAVILLS ───────────────────────────────────────────────
  // auctions.savills.co.uk — each lot is a <li> containing:
  // "Lot X", "Guide Price £X", address in link title, bullets, "Full details" link
  // Paginated: need to handle via Puppeteer scrolling or multi-page
  savills: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Each lot card is inside a list item with image carousel + details
      // The lot number appears as plain text "Lot X"
      // Address is in a link with title attribute and href to lot detail page
      // Price appears after "Guide Price" or "Hammer Price"
      // Bullets are in nested li elements
      const allLi = document.querySelectorAll('li');
      for (const li of allLi) {
        const text = li.textContent || '';
        // Must contain "Lot" followed by a number
        const lotMatch = text.match(/Lot\\s+(\\d+)/);
        if (!lotMatch) continue;
        const lotNum = parseInt(lotMatch[1]);
        if (lotNum === 0 || seen.has(lotNum)) continue; // Skip lot 0 (commercial section header)
        seen.add(lotNum);
        // Address from link with title containing a postcode or street
        let address = '';
        let url = '';
        const links = li.querySelectorAll('a[href]');
        for (const a of links) {
          const title = a.getAttribute('title') || '';
          const href = a.getAttribute('href') || '';
          const linkText = a.textContent.trim();
          // Address link has a meaningful title with location info
          if (title && title.match(/[A-Z]{1,2}\\d/) && !address) {
            address = title;
            url = href;
          } else if (linkText && linkText.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && !address) {
            address = linkText;
            url = href;
          }
        }
        if (!address) {
          // Try finding address in any text that looks like a street + postcode
          const addrMatch = text.match(/\\d+[a-z]?\\s+[A-Z][a-z]+[\\s\\S]*?[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/);
          if (addrMatch) address = addrMatch[0].trim();
        }
        if (!address) continue;
        // Full details link
        if (!url) {
          for (const a of links) {
            if (a.textContent.includes('Full details')) {
              url = a.getAttribute('href') || '';
              break;
            }
          }
        }
        // Price: Guide Price or Hammer Price
        let price = null;
        const priceMatch = text.match(/(?:Guide Price|Hammer Price)\\s*£([\\d,]+)/i);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        else {
          const pm2 = text.match(/£([\\d,]+)/);
          if (pm2) price = parseInt(pm2[1].replace(/,/g, ''));
        }
        // Bullets from nested list items
        const bullets = [];
        const subLis = li.querySelectorAll('li');
        for (const sub of subLis) {
          const t = sub.textContent.trim();
          if (t.length > 5 && t.length < 200 && !t.match(/^Lot\\s+\\d|^£|^Guide|^Hammer|Cancel proxy/i)) {
            bullets.push(t);
          }
        }
        // Detect sold/withdrawn
        if (text.match(/\\bSold\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/sold|withdrawn/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets });
      }
      return lots;
    })()
  `,

  // ─── HOLLIS MORGAN ─────────────────────────────────────────
  // hollismorgan.co.uk — anchored on "SHOW ME MORE" detail links
  // Each lot: h3=address, h4=price, h4="Lot TBC", li=bullets
  hollismorgan: `
    (() => {
      const lots = [];
      const detailLinks = document.querySelectorAll('a[href*="property-details"]');
      let lotIndex = 1;
      for (const link of detailLinks) {
        const url = link.getAttribute('href') || '';
        if (!url || link.textContent.trim() === '') continue;
        let card = link.parentElement;
        for (let i = 0; i < 5 && card; i++) {
          if (card.querySelector('h3') && card.querySelector('h4')) break;
          card = card.parentElement;
        }
        if (!card) continue;
        const h3 = card.querySelector('h3');
        const address = h3 ? h3.textContent.trim() : '';
        if (!address) continue;
        let price = null;
        const h4s = card.querySelectorAll('h4');
        for (const h4 of h4s) {
          const t = h4.textContent.trim();
          const pm = t.match(/£([\\d,]+)/);
          if (pm) { price = parseInt(pm[1].replace(/,/g, '')); break; }
        }
        let lotNum = lotIndex;
        for (const h4 of h4s) {
          const t = h4.textContent.trim();
          const lm = t.match(/Lot\\s+(\\d+)/i);
          if (lm) { lotNum = parseInt(lm[1]); break; }
        }
        const bullets = [];
        const lis = card.querySelectorAll('li');
        for (const li of lis) {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        }
        const cardText = card.textContent;
        if (cardText.match(/\\bSOLD\\b|\\bSALEAGREED\\b|\\bSALE AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets });
        lotIndex++;
      }
      return lots;
    })()
  `,

  // ─── MAGGS & ALLEN ─────────────────────────────────────────
  // maggsandallen.co.uk — same CMS as Hollis Morgan (Auction2 platform)
  maggsandallen: `
    (() => {
      const lots = [];
      const detailLinks = document.querySelectorAll('a[href*="property-details"]');
      let lotIndex = 1;
      for (const link of detailLinks) {
        const url = link.getAttribute('href') || '';
        if (!url || link.textContent.trim() === '') continue;
        let card = link.parentElement;
        for (let i = 0; i < 5 && card; i++) {
          if (card.querySelector('h3') && card.querySelector('h4')) break;
          card = card.parentElement;
        }
        if (!card) continue;
        const h3 = card.querySelector('h3');
        const address = h3 ? h3.textContent.trim() : '';
        if (!address) continue;
        let price = null;
        const h4s = card.querySelectorAll('h4');
        for (const h4 of h4s) {
          const t = h4.textContent.trim();
          const pm = t.match(/£([\\d,]+)/);
          if (pm) { price = parseInt(pm[1].replace(/,/g, '')); break; }
        }
        let lotNum = lotIndex;
        for (const h4 of h4s) {
          const t = h4.textContent.trim();
          const lm = t.match(/Lot\\s+(\\d+)/i);
          if (lm) { lotNum = parseInt(lm[1]); break; }
        }
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        const cardText = card.textContent;
        if (cardText.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets });
        lotIndex++;
      }
      return lots;
    })()
  `,

  // ─── SDL / BTG EDDISONS ────────────────────────────────────
  // sdlauctions.co.uk — WordPress + EIG. Lot cards are div.auction-card
  // Each has: data-id, auction-card--content, content-title, auction-meta,
  // content-list with "Find out more" link, content-image-container with href
  sdl: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.auction-card, div[class*="auction-card"]');
      let lotIndex = 1;
      for (const card of cards) {
        const dataId = card.getAttribute('data-id') || '';
        if (seen.has(dataId) && dataId) continue;
        if (dataId) seen.add(dataId);
        const text = card.textContent || '';
        // URL from image container link or "Find out more" link
        let url = '';
        const imgLink = card.querySelector('a.auction-card--content-image-container, a[href*="/property/"]');
        if (imgLink) url = imgLink.getAttribute('href') || '';
        const findMore = card.querySelector('a.btn, a[href*="/property/"]');
        if (!url && findMore) url = findMore.getAttribute('href') || '';
        // Address: look for content-title and address text
        let address = '';
        const titleEl = card.querySelector('.auction-card--content-title, p[class*="content-title"]');
        // Full address is usually below title in plain text with postcode
        const contentEl = card.querySelector('.auction-card--content, div[class*="auction-card--content"]');
        if (contentEl) {
          // Get all text lines that look like address parts
          const lines = contentEl.innerText.split('\\n').map(s => s.trim()).filter(s => s.length > 0);
          // Find the line with a postcode
          for (const line of lines) {
            if (line.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i)) {
              address = line;
              break;
            }
          }
          // If no postcode line, use title + next lines
          if (!address && titleEl) {
            address = titleEl.textContent.trim();
            // Append subsequent address lines
            const addrLines = lines.filter(l => l.length > 5 && l.length < 100 && !l.match(/Guide|Price|Auction|Find out|plus fees|Withdrawn|Sold/i));
            if (addrLines.length > 1) address = addrLines.slice(0, 3).join(', ');
          }
        }
        if (!address && titleEl) address = titleEl.textContent.trim();
        if (!address) continue;
        // Price
        let price = null;
        const priceMatch = text.match(/(?:Guide price|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Lot number from text or sequential
        let lotNum = lotIndex;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Bullets from auction-meta list items and property type
        const bullets = [];
        card.querySelectorAll('.auction-meta li, .property-type, li').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 1 && t.length < 200) bullets.push(t);
        });
        // Property type
        const typeEl = card.querySelector('.property-type');
        if (typeEl) {
          const pt = typeEl.textContent.trim();
          if (pt && !bullets.includes(pt)) bullets.unshift(pt);
        }
        // Detect status
        if (text.match(/\\bWithdrawn\\b|\\bSOLD\\b|\\bSTC\\b|\\bSale Agreed\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets });
        lotIndex++;
      }
      return lots;
    })()
  `,

  // ─── BOND WOLFE ────────────────────────────────────────────
  // bondwolfe.com — WordPress + EIG. Similar card structure to SDL
  bondwolfe: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Bond Wolfe lot cards
      const cards = document.querySelectorAll('.property-card, .lot-card, [class*="property"], article, .search-result');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        const link = card.querySelector('a[href*="/property/"], a[href*="/lot/"], a[href*="/properties/"]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .property-title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li, .feature, .tag').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets });
      }
      return lots;
    })()
  `,

  // ─── NETWORK AUCTIONS ─────────────────────────────────────
  network: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-card, .property-card, [class*="lot-item"], [class*="property"], article');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets });
      }
      return lots;
    })()
  `,

  // ─── BARNARD MARCUS ────────────────────────────────────────
  // barnardmarcusauctions.co.uk — Countrywide CMS, server-rendered
  barnardmarcus: `
    (() => {
      const lots = [];
      const seen = new Set();
      const headers = document.querySelectorAll('h2, h3, h4, h5');
      for (const h of headers) {
        const text = h.textContent.trim();
        const lotMatch = text.match(/^\\s*(\\d{1,4})\\s*$/) || text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const parent = h.closest('.lot, .property, div[class*="lot"], div, li, article') || h.parentElement;
        if (!parent) continue;
        let address = '', price = null, url = '';
        const links = parent.querySelectorAll('a[href]');
        for (const link of links) {
          const lt = link.textContent.trim();
          const href = link.getAttribute('href') || '';
          if (lt.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && !address) {
            address = lt;
            if (href && href !== '#') url = href;
          }
        }
        const priceMatch = parent.textContent.match(/(?:Guide|Price|£)\\s*£?([\\d,]+(?:,\\d{3})*)/i);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        const bullets = [];
        parent.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (parent.textContent.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        if (address || price) lots.push({ lot: num, address, price, url, bullets });
      }
      return lots;
    })()
  `,

  // ─── AUCTION HOUSE LONDON ─────────────────────────────────
  auctionhouselondon: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('a[href*="/lot/"]');
      const seen = new Set();
      for (const card of cards) {
        const text = card.textContent;
        const lotMatch = text.match(/LOT\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const href = card.getAttribute('href') || '';
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = text.replace(/LOT\\s+\\d+/i, '').replace(/Guide Price[^£]*£[\\d,]+\\+?/i, '').replace(/£[\\d,]+\\+?/g, '').trim();
        address = address.split('\\n').map(s=>s.trim()).filter(s=>s.length>5)[0] || '';
        const bullets = [];
        const desc = text.split('\\n').map(s=>s.trim()).filter(s=>s.length>10 && !s.match(/^LOT|^Guide|^£/i));
        if (desc.length > 0) bullets.push(desc[0]);
        lots.push({ lot: num, address, price, url: href, bullets });
      }
      return lots;
    })()
  `,

  // ─── McHUGH & CO ──────────────────────────────────────────
  mchughandco: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Try card-based approach first
      const cards = document.querySelectorAll('.lot-item, [class*="lot"], [class*="property"], article');
      for (const card of cards) {
        const text = card.textContent;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const addrEl = card.querySelector('.address, h2, h3, h4, [class*="address"]');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s=>s.trim()).filter(s=>s.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i));
          if (lines.length) address = lines[0];
        }
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets });
      }
      return lots;
    })()
  `,

  // ─── CLIVE EMSON ───────────────────────────────────────────
  // cliveemson.co.uk — server-rendered catalogue
  cliveemson: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Clive Emson has lot cards with lot numbers, addresses, guide prices
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], .search-result, article');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li, p').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 10 && t.length < 200 && !t.match(/^Lot|^Guide|^£/i)) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets });
      }
      return lots;
    })()
  `,

  // ─── STRETTONS ─────────────────────────────────────────────
  strettons: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], .catalogue-item, article');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets });
      }
      return lots;
    })()
  `,

  // ─── ACUITUS ───────────────────────────────────────────────
  acuitus: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], article, .search-result');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li, .description, .feature').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets });
      }
      return lots;
    })()
  `,

  // ─── AUCTION HOUSE UK ─────────────────────────────────────
  auctionhouse: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], article, .search-result');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets });
      }
      return lots;
    })()
  `,

  // ── KNIGHT FRANK (EIG platform) ──
  knightfrank: `
    (() => {
      const lots = [];
      document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], .lot-card, .property-card, [class*="lot"]').forEach(el => {
        const text = el.textContent || '';
        const href = el.getAttribute('href') || '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:guide|price|reserve)[:\\s]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const pcMatch = text.match(/[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}/i);
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/£[\\d,]+/g, '').replace(/guide\\s*price/i, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets: [] });
        }
      });
      return lots;
    })()
  `,

  // ── PATTINSON (React SPA with bid cards) ──
  pattinson: `
    (() => {
      const lots = [];
      document.querySelectorAll('[class*="card"], [class*="property"], [class*="auction-item"], .lot-item').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a[href*="auction"]') || card.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:starting|current|guide)\\s*(?:bid|price)[:\\s]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.split('\\n').find(l => l.trim().length > 10 && !l.match(/^(?:lot|starting|current|guide|£|bid)/i));
        if (address) {
          lots.push({ lot: num, address: address.trim().substring(0, 150), price, url: href, bullets: [] });
        }
      });
      return lots;
    })()
  `,

  // ── BIDX1 (React SPA) ──
  bidx1: `
    (() => {
      const lots = [];
      document.querySelectorAll('[class*="property"], [class*="card"], [class*="listing"], [class*="lot"]').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/€([\\d,]+)/) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 5);
        const address = lines.find(l => !l.match(/^(?:€|£|\\d+\\s*bed|guide|reserve|sold)/i));
        if (address) {
          lots.push({ lot: lots.length + 1, address: address.substring(0, 150), price, url: href, bullets: [] });
        }
      });
      return lots;
    })()
  `,

  // ── PHILLIP ARNOLD (PHP gallery) ──
  philliparnold: `
    (() => {
      const lots = [];
      document.querySelectorAll('.gallery-item, .lot-item, .property-item, [class*="lot"]').forEach(el => {
        const text = el.textContent || '';
        const link = el.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*price\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/guide\\s*price\\s*£[\\d,]+/i, '').replace(/£[\\d,]+/g, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets: [] });
        }
      });
      return lots;
    })()
  `,

  // ── EDWARD MELLOR (WordPress, verified HTML) ──
  edwardmellor: `
    (() => {
      const lots = [];
      document.querySelectorAll('a[href*="/property-for-sale/"]').forEach(link => {
        const text = link.textContent || '';
        const href = link.getAttribute('href') || '';
        const lotMatch = text.match(/lot\\s*(\\d+|TBC)/i);
        const num = lotMatch && lotMatch[1] !== 'TBC' ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*price\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const pcMatch = text.match(/[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}/i);
        const addressLine = text.split('\\n').find(l => l.trim().length > 10 && l.match(/[A-Z]{1,2}\\d/));
        const address = addressLine ? addressLine.trim() : text.split('\\n')[0].trim();
        if (address && address.length > 5) {
          const bullets = [];
          const beds = text.match(/(\\d+)\\s*bed/i);
          if (beds) bullets.push(beds[1] + ' bed');
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets });
        }
      });
      return lots;
    })()
  `,

  // ── BARNETT ROSS (PHP) ──
  barnettross: `
    (() => {
      const lots = [];
      document.querySelectorAll('a[href*="property.php"], .lot-row, .property-row, [class*="lot"]').forEach(el => {
        const text = el.textContent || '';
        const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:guide|sold|price)[:\\s]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const pcMatch = text.match(/[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}/i);
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/£[\\d,]+/g, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets: [] });
        }
      });
      return lots;
    })()
  `,

  // ── COTTONS (WordPress) ──
  cottons: `
    (() => {
      const lots = [];
      document.querySelectorAll('.property-card, .lot-card, [class*="property"], [class*="lot"]').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*(?:price)?\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.split('\\n').find(l => l.trim().length > 10 && !l.match(/^(?:lot|guide|£|sold)/i));
        if (address) {
          lots.push({ lot: num, address: address.trim().substring(0, 150), price, url: href, bullets: [] });
        }
      });
      return lots;
    })()
  `,

  // ── DEDMAN GRAY (PHP) ──
  dedmangray: `
    (() => {
      const lots = [];
      document.querySelectorAll('.property-card, .auction-lot, [class*="property"], [class*="lot"]').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*(?:price)?\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.split('\\n').find(l => l.trim().length > 10 && !l.match(/^(?:lot|guide|£|sold)/i));
        if (address) {
          lots.push({ lot: num, address: address.trim().substring(0, 150), price, url: href, bullets: [] });
        }
      });
      return lots;
    })()
  `,

  // ── EIG PLATFORM (reusable for any EIG-hosted house) ──
  eigplatform: `
    (() => {
      const lots = [];
      document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], .lot-card').forEach(el => {
        const text = el.textContent || '';
        const href = el.getAttribute('href') || '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const pcMatch = text.match(/[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}/i);
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/£[\\d,]+/g, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets: [] });
        }
      });
      return lots;
    })()
  `,

};

// Universal DOM extractor — works on any auction site by detecting common patterns
const UNIVERSAL_DOM_EXTRACTOR = `
  (() => {
    const lots = [];
    const seen = new Set();
    
    // Strategy 1: Find all links to individual property/lot pages
    const propLinks = document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], a[href*="property-details"], a[href*="/properties/"]');
    const linkSet = new Set();
    
    for (const link of propLinks) {
      const href = link.getAttribute('href') || '';
      if (linkSet.has(href)) continue;
      linkSet.add(href);
      
      // Walk up to find the card container (look for a repeating parent element)
      let card = link;
      for (let i = 0; i < 8 && card.parentElement; i++) {
        card = card.parentElement;
        // Stop when we find an element that likely wraps a single lot
        const cl = (card.className || '').toLowerCase();
        const tag = card.tagName.toLowerCase();
        if (cl.match(/card|lot|property|listing|item|result|auction/) || 
            (tag === 'article') || 
            (tag === 'li' && card.querySelector('a[href]'))) break;
      }
      
      const text = card.innerText || card.textContent || '';
      if (text.length < 20 || text.length > 5000) continue;
      
      // Extract price
      let price = null;
      const priceMatch = text.match(/(?:Guide[\\s]*(?:Price)?|Price|Starting|Reserve|Estimate)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
      
      // Extract address — look for postcode pattern
      let address = '';
      const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 0);
      // First try: line with a UK postcode
      for (const line of lines) {
        if (line.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && line.length < 200) {
          address = line;
          break;
        }
      }
      // Second try: first heading in the card
      if (!address) {
        const heading = card.querySelector('h1, h2, h3, h4, h5, .title, .address, [class*="title"], [class*="address"]');
        if (heading) address = heading.textContent.trim();
      }
      // Third try: link title or first substantial text
      if (!address) {
        const title = link.getAttribute('title');
        if (title && title.length > 5) address = title;
      }
      if (!address) {
        const substantial = lines.find(l => l.length > 10 && l.length < 150 && !l.match(/^(Guide|Price|Lot|Find|View|More|Search|Filter|Sort|Show|Order|£)/i));
        if (substantial) address = substantial;
      }
      if (!address || address.length < 5) continue;
      
      // Deduplicate by address
      const addrKey = address.toLowerCase().replace(/\\s+/g, ' ').substring(0, 60);
      if (seen.has(addrKey)) continue;
      seen.add(addrKey);
      
      // Extract lot number
      let lotNum = lots.length + 1;
      const lotMatch = text.match(/Lot\\s+(\\d+)/i);
      if (lotMatch) lotNum = parseInt(lotMatch[1]);
      
      // Extract bullets/features
      const bullets = [];
      card.querySelectorAll('li, .feature, .tag, .type, .property-type, .meta').forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 2 && t.length < 200 && !t.match(/^(Search|Filter|Sort|Show|View|Order|My|Menu|Buy|Sell|About|Contact|Home)/i)) {
          bullets.push(t);
        }
      });
      // Also grab description-like paragraphs
      card.querySelectorAll('p, .description, [class*="desc"]').forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 15 && t.length < 300 && !bullets.includes(t)) bullets.push(t);
      });
      
      // Detect sold/withdrawn status
      if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
        if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
      }
      
      lots.push({ lot: lotNum, address, price, url: href, bullets: bullets.slice(0, 8) });
    }
    
    // Strategy 2: If no property links found, look for repeated card-like elements
    if (lots.length === 0) {
      // Find the most common class pattern that appears 5+ times with £ prices
      const candidates = document.querySelectorAll('[class*="card"], [class*="lot"], [class*="property"], [class*="listing"], [class*="item"], [class*="auction"], article');
      for (const card of candidates) {
        const text = card.innerText || card.textContent || '';
        if (text.length < 30 || text.length > 5000) continue;
        const priceMatch = text.match(/£([\\d,]+)/);
        if (!priceMatch) continue;
        const price = parseInt(priceMatch[1].replace(/,/g, ''));
        if (price < 1000) continue; // Skip non-property prices
        
        let address = '';
        const heading = card.querySelector('h1, h2, h3, h4, h5, .title, .address, [class*="title"], [class*="address"]');
        if (heading) address = heading.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 10 && s.length < 150);
          if (lines.length) address = lines[0];
        }
        if (!address || address.length < 5) continue;
        
        const addrKey = address.toLowerCase().replace(/\\s+/g, ' ').substring(0, 60);
        if (seen.has(addrKey)) continue;
        seen.add(addrKey);
        
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bSALE.?AGREED\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        
        lots.push({ lot: lotMatch ? parseInt(lotMatch[1]) : lots.length + 1, address, price, url, bullets: bullets.slice(0, 8) });
      }
    }
    
    return lots;
  })()
`;

async function extractWithDOM(page, house) {
  // Try house-specific extractor first
  const extractor = DOM_EXTRACTORS[house];
  if (extractor) {
    try {
      const lots = await page.evaluate(extractor);
      if (Array.isArray(lots) && lots.length > 0) {
        console.log(`DOM extractor for ${house}: found ${lots.length} lots directly`);
        return lots;
      }
    } catch (err) {
      console.log(`DOM extractor error for ${house}: ${err.message}`);
    }
  }
  
  // Fall back to universal extractor
  try {
    const lots = await page.evaluate(UNIVERSAL_DOM_EXTRACTOR);
    if (Array.isArray(lots) && lots.length > 0) {
      console.log(`Universal DOM extractor for ${house}: found ${lots.length} lots`);
      return lots;
    }
  } catch (err) {
    console.log(`Universal DOM extractor error for ${house}: ${err.message}`);
  }
  
  console.log(`All DOM extractors for ${house}: found 0 lots, falling back to Claude`);
  return null;
}

// ═══════════════════════════════════════════════════════════════
// ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════
const W2N = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };

function analyseLot(raw) {
  const t = (raw.bullets.join(' ') + ' ' + raw.address).toLowerCase();
  const L = { ...raw, score: 0, opps: [], risks: [], dealType: 'Standard', propType: '', beds: null,
    tenure: '', condition: '', vacant: true, sqft: null, titleSplit: false, units: 0 };

  if (/flat|apartment|maisonette/.test(t)) L.propType = 'flat';
  else if (/bungalow/.test(t)) L.propType = 'bungalow';
  else if (/semi[- ]?detached|terraced?|terrace house|detached house|town\s?house|end of terrace|mid[- ]terrace/.test(t)) L.propType = 'house';
  else if (/\bhouse\b/.test(t)) L.propType = 'house';
  else if (/shop|office|commercial|retail|industrial|warehouse|investment|ground rent/.test(t)) L.propType = 'commercial';
  else if (/\bland\b|plot|site|church|hall|chapel/.test(t)) L.propType = 'land';
  else if (/garage|parking|lock.?up/.test(t)) L.propType = 'garage';
  else L.propType = 'other';

  const bm = t.match(/(\w+)\s*[-\s]?bed/);
  if (bm) { const v = bm[1].toLowerCase(); L.beds = W2N[v] || (v.match(/^\d+$/) ? +v : null); }
  if (/studio/.test(t) && L.beds === null) L.beds = 0;

  if (/share of freehold/.test(t)) L.tenure = 'Share of Freehold';
  else if (/freehold/.test(t) && !/leasehold/.test(t)) L.tenure = 'Freehold';
  else if (/leasehold/.test(t)) L.tenure = 'Leasehold';

  if (/modernis|refurbishment|renovation|updating|in need of/.test(t)) L.condition = 'needs work';
  else if (/good order|good decorative|well maintained|recently refurbished/.test(t)) L.condition = 'good';
  else if (/derelict|dilapidated|fire damage/.test(t)) L.condition = 'poor';

  if (/vacant/.test(t)) L.vacant = true;
  else if (/tenant|let to|tenanted|occupied|sitting tenant/.test(t)) L.vacant = false;

  const executor = /executor|probate|estate of|personal representative/.test(t);
  const receivership = /receiver|receivership|administrator|liquidator|lpa receiver/.test(t);
  const devP = /development potential|development opportunity|planning permission|pp granted|change of use|conversion potential|redevelopment|building plot/.test(t);
  const extP = /extension potential|scope to extend|subject to requi[st]i?te? consents|loft conversion|\bhmo\b|potential to extend/.test(t);

  const sm = t.match(/([\d,]+)\s*sq\s*(?:ft|feet)/);
  if (sm) L.sqft = parseInt(sm[1].replace(/,/g, ''));

  let uc = 0;
  const um = t.match(/(\d+)\s*(?:x\s*)?(?:self[- ]contained\s+)?(?:flat|apartment|unit)/); if (um) uc = Math.max(uc, +um[1]);
  const bk = t.match(/block\s+of\s+(\d+)/); if (bk) uc = Math.max(uc, +bk[1]);
  const mx = [...t.matchAll(/(\d+)\s*x\s*(?:one|two|three|1|2|3)\s*[-\s]?bed/g)];
  if (mx.length) uc = Math.max(uc, mx.reduce((s, m) => s + +m[1], 0));
  const fr = raw.address.toLowerCase().match(/flats?\s*([a-z])\s*[-–&]\s*([a-z])/);
  if (fr) uc = Math.max(uc, fr[2].charCodeAt(0) - fr[1].charCodeAt(0) + 1);
  const ar = raw.address.match(/^(\d+)\s*[-–]\s*(\d+)\s/);
  if (ar) { const d = +ar[2] - +ar[1] + 1; if (d >= 2 && d <= 20) uc = Math.max(uc, d); }
  if (/gff|fff|sff|tff/.test(raw.address.toLowerCase())) uc = Math.max(uc, 2);
  const apt = t.match(/(\d+)\s*(?:self[- ]contained\s+)?apartments/); if (apt) uc = Math.max(uc, +apt[1]);
  const isFH = /freehold/.test(t), hasFlats = /flats|apartments|self[- ]contained|arranged as/.test(t);
  const indivSales = /individual flat sales|individual sales/.test(t);
  if (uc >= 2 || ((isFH && hasFlats) || indivSales)) { L.titleSplit = true; L.units = uc || 2; }

  let s = 0;
  if (L.condition === 'needs work') { s += 2; L.opps.push('Needs modernisation'); }
  if (L.condition === 'poor') { s += 2.5; L.opps.push('Poor condition'); }
  if (executor) { s += 1.5; L.opps.push('Executor/probate'); }
  if (receivership) { s += 2; L.opps.push('Receivership'); }
  if (devP) { s += 2; L.opps.push('Development potential'); }
  if (extP) { s += 1.5; L.opps.push('Extension/HMO potential'); }
  if (L.vacant && ['house', 'bungalow', 'flat', 'land'].includes(L.propType)) { s += 1; L.opps.push('Vacant'); }
  if (L.tenure === 'Freehold' && ['house', 'bungalow'].includes(L.propType)) { s += 0.5; L.opps.push('Freehold'); }
  if (L.sqft && L.price) {
    const p = L.price / L.sqft;
    if (p < 200) { s += 2; L.opps.push(`£${Math.round(p)}/sqft`); }
    else if (p < 300) { s += 1; L.opps.push(`£${Math.round(p)}/sqft`); }
  }

  const rm = t.match(/(?:let\s+at|rent\s+of|income\s+of|producing)\s+£?([\d,]+)\s*(?:p\.?a|per\s*annum)/);
  if (rm && L.price) {
    const rent = parseInt(rm[1].replace(/,/g, '')); const gy = (rent / L.price) * 100;
    if (gy > 8) { s += 2.5; L.opps.push(`${gy.toFixed(1)}% GIY`); }
    else if (gy > 6) { s += 1.5; L.opps.push(`${gy.toFixed(1)}% GIY`); }
  }

  if (/(?:4|5|6)\s*week\s*completion|six week/.test(t)) { s += 0.5; L.opps.push('Quick completion'); }
  if (/by order of/.test(t) && !executor && !receivership) { s += 0.5; L.opps.push('Motivated seller'); }
  if (L.titleSplit) { s += 1; L.opps.push(`Title split (${L.units} units)`); }

  if (/sitting tenant/.test(t)) { s -= 2; L.risks.push('Sitting tenant'); }
  if (/knotweed/.test(t)) { s -= 2; L.risks.push('Knotweed'); }
  if (/flying freehold/.test(t)) { s -= 1; L.risks.push('Flying freehold'); }
  if (/non[- ]?standard|timber frame|prefab|prc/.test(t)) { s -= 1; L.risks.push('Non-std construction'); }
  if (/flood risk|flood zone/.test(t)) { s -= 1; L.risks.push('Flood risk'); }
  if (/asbestos|contamination/.test(t)) { s -= 1; L.risks.push('Contamination'); }
  if (/grade ii|listed/.test(t)) L.risks.push('Listed building');
  if (!L.price) L.risks.push('Guide TBA');

  if (devP) L.dealType = 'Development';
  else if ((L.condition === 'needs work' || L.condition === 'poor') && extP) L.dealType = 'Refurb+Extend';
  else if (L.condition === 'needs work' || L.condition === 'poor') L.dealType = 'Refurb';
  else if (L.titleSplit) L.dealType = 'Title Split';
  else if (executor || receivership) L.dealType = 'Motivated';
  else L.dealType = 'Standard';

  L.score = Math.round(s * 10) / 10;
  return L;
}

// ═══════════════════════════════════════════════════════════════
// LAND REGISTRY ENRICHMENT
// ═══════════════════════════════════════════════════════════════
function extractPostcode(address) {
  if (!address) return null;
  const m = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
  return m ? m[0].toUpperCase().replace(/\s+/g, ' ') : null;
}

function extractStreet(address) {
  if (!address) return null;
  // Try to pull street name from address (between number and town/postcode)
  const m = address.match(/\d+[a-z]?\s+(.+?)(?:,|\s+[A-Z]{1,2}\d)/i);
  return m ? m[1].trim().toUpperCase() : null;
}

async function queryLandRegistry(postcode) {
  if (!postcode) return [];
  const sparql = `
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?paon ?saon ?street ?town ?postcode ?amount ?date ?category ?propertyType
WHERE {
  VALUES ?postcode {"${postcode}"^^xsd:string}
  ?addr lrcommon:postcode ?postcode.
  ?transx lrppi:propertyAddress ?addr ;
          lrppi:pricePaid ?amount ;
          lrppi:transactionDate ?date ;
          lrppi:transactionCategory/skos:prefLabel ?category .
  OPTIONAL {?addr lrcommon:paon ?paon}
  OPTIONAL {?addr lrcommon:saon ?saon}
  OPTIONAL {?addr lrcommon:street ?street}
  OPTIONAL {?addr lrcommon:town ?town}
  OPTIONAL {?transx lrppi:propertyType/skos:prefLabel ?propertyType}
  FILTER(?date >= "${new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}"^^xsd:date)
}
ORDER BY DESC(?date)
LIMIT 30`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch('http://landregistry.data.gov.uk/landregistry/query', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `query=${encodeURIComponent(sparql)}`,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const data = await resp.json();
    const results = (data.results?.bindings || []).map(b => ({
      address: [b.saon?.value, b.paon?.value, b.street?.value].filter(Boolean).join(', '),
      town: b.town?.value || '',
      postcode: b.postcode?.value || '',
      price: parseInt(b.amount?.value) || 0,
      date: b.date?.value || '',
      category: b.category?.value || '',
      propertyType: b.propertyType?.value || '',
    }));
    return results;
  } catch (e) {
    console.log(`Land Registry query failed for ${postcode}: ${e.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// VOA RENTAL ESTIMATES (local authority averages by beds)
// Monthly rent in £ — source: VOA Private Rental Market Statistics 2024/25
// Format: { area_keyword: { 0: studio, 1: 1bed, 2: 2bed, 3: 3bed, 4: 4bed+ } }
// ═══════════════════════════════════════════════════════════════
const VOA_RENTS = {
  // London boroughs
  'london': { 0: 1200, 1: 1500, 2: 1800, 3: 2200, 4: 2800 },
  'westminster': { 0: 1600, 1: 2000, 2: 2800, 3: 3800, 4: 5000 },
  'camden': { 0: 1400, 1: 1800, 2: 2400, 3: 3200, 4: 4000 },
  'islington': { 0: 1350, 1: 1750, 2: 2300, 3: 3000, 4: 3800 },
  'hackney': { 0: 1200, 1: 1550, 2: 2000, 3: 2600, 4: 3200 },
  'tower hamlets': { 0: 1300, 1: 1650, 2: 2100, 3: 2700, 4: 3400 },
  'southwark': { 0: 1200, 1: 1550, 2: 2000, 3: 2600, 4: 3200 },
  'lambeth': { 0: 1150, 1: 1500, 2: 1900, 3: 2500, 4: 3100 },
  'lewisham': { 0: 1000, 1: 1300, 2: 1600, 3: 2000, 4: 2500 },
  'greenwich': { 0: 1000, 1: 1300, 2: 1600, 3: 2000, 4: 2500 },
  'newham': { 0: 950, 1: 1250, 2: 1550, 3: 1900, 4: 2400 },
  'barking': { 0: 850, 1: 1100, 2: 1400, 3: 1700, 4: 2100 },
  'croydon': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'ealing': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'brent': { 0: 1050, 1: 1350, 2: 1700, 3: 2200, 4: 2700 },
  'haringey': { 0: 1100, 1: 1400, 2: 1800, 3: 2300, 4: 2800 },
  'waltham forest': { 0: 950, 1: 1250, 2: 1550, 3: 1950, 4: 2400 },
  'enfield': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'hounslow': { 0: 950, 1: 1200, 2: 1500, 3: 1900, 4: 2400 },
  'redbridge': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'hillingdon': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'barnet': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'bromley': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'wandsworth': { 0: 1200, 1: 1550, 2: 2000, 3: 2600, 4: 3200 },
  'richmond': { 0: 1100, 1: 1450, 2: 1850, 3: 2400, 4: 3000 },
  'kingston': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'merton': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'sutton': { 0: 850, 1: 1100, 2: 1400, 3: 1750, 4: 2100 },
  // Major cities & regions
  'manchester': { 0: 700, 1: 850, 2: 1050, 3: 1300, 4: 1600 },
  'birmingham': { 0: 600, 1: 750, 2: 900, 3: 1100, 4: 1400 },
  'liverpool': { 0: 500, 1: 600, 2: 750, 3: 900, 4: 1100 },
  'leeds': { 0: 600, 1: 700, 2: 850, 3: 1050, 4: 1300 },
  'sheffield': { 0: 500, 1: 600, 2: 750, 3: 900, 4: 1100 },
  'bristol': { 0: 750, 1: 900, 2: 1100, 3: 1400, 4: 1700 },
  'newcastle': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'nottingham': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'leicester': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'coventry': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'cardiff': { 0: 600, 1: 700, 2: 850, 3: 1050, 4: 1300 },
  'swansea': { 0: 450, 1: 550, 2: 650, 3: 800, 4: 1000 },
  'edinburgh': { 0: 700, 1: 850, 2: 1050, 3: 1350, 4: 1700 },
  'glasgow': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1250 },
  'reading': { 0: 750, 1: 950, 2: 1200, 3: 1500, 4: 1800 },
  'oxford': { 0: 800, 1: 1000, 2: 1300, 3: 1600, 4: 2000 },
  'cambridge': { 0: 800, 1: 1000, 2: 1300, 3: 1600, 4: 2000 },
  'brighton': { 0: 750, 1: 950, 2: 1200, 3: 1500, 4: 1800 },
  'southampton': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'portsmouth': { 0: 550, 1: 700, 2: 850, 3: 1050, 4: 1300 },
  'bournemouth': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'exeter': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'plymouth': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'bath': { 0: 700, 1: 850, 2: 1100, 3: 1400, 4: 1700 },
  'york': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'chester': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'norwich': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'ipswich': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'stoke': { 0: 400, 1: 500, 2: 600, 3: 750, 4: 950 },
  'derby': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'wolverhampton': { 0: 450, 1: 550, 2: 700, 3: 850, 4: 1050 },
  'walsall': { 0: 450, 1: 550, 2: 700, 3: 850, 4: 1050 },
  'sunderland': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'middlesbrough': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'bradford': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'hull': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'blackburn': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'burnley': { 0: 375, 1: 450, 2: 550, 3: 675, 4: 850 },
  'clitheroe': { 0: 425, 1: 525, 2: 650, 3: 800, 4: 1000 },
  // Regional fallbacks
  'south east': { 0: 750, 1: 950, 2: 1200, 3: 1500, 4: 1800 },
  'south west': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'east midlands': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'west midlands': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1250 },
  'north west': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'north east': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'yorkshire': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'east': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'wales': { 0: 475, 1: 575, 2: 700, 3: 875, 4: 1050 },
  'scotland': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1200 },
  // Default UK fallback
  '_default': { 0: 550, 1: 675, 2: 825, 3: 1025, 4: 1275 },
};

function estimateMonthlyRent(address, beds) {
  const a = (address || '').toLowerCase();
  // Try specific towns/cities first, then regions
  for (const [key, rents] of Object.entries(VOA_RENTS)) {
    if (key === '_default') continue;
    if (a.includes(key)) return rents[Math.min(beds ?? 2, 4)];
  }
  return VOA_RENTS._default[Math.min(beds ?? 2, 4)];
}

// ═══════════════════════════════════════════════════════════════
// LOT URL CONSTRUCTION
// ═══════════════════════════════════════════════════════════════
function buildLotUrl(lot, house, sourceUrl) {
  // If Claude already extracted a URL, use it
  if (lot.url && lot.url.startsWith('http')) return lot.url;

  switch (house) {
    case 'savills':
      // Savills lot pages: /auctions/auction-name/lot-number
      if (sourceUrl.includes('savills.co.uk')) {
        const base = sourceUrl.replace(/\/page-\d+.*/, '');
        return `${base}?lot=${lot.lot}`;
      }
      break;
    case 'allsop':
      // Allsop: individual lot pages are /lot/{lot-number}/
      return `https://www.allsop.co.uk/lot/${lot.lot}/`;
    case 'sdl':
      // SDL/BTG Eddisons: individual property pages are /property/{id}/slug
      // If we have a property ID from Claude extraction, construct the URL
      if (lot.propertyId) {
        return `https://www.sdlauctions.co.uk/property/${lot.propertyId}/`;
      }
      // If lot URL was extracted as relative, make absolute
      if (lot.url && lot.url.startsWith('/')) {
        if (sourceUrl.includes('btgeddisonspropertyauctions')) {
          return `https://www.btgeddisonspropertyauctions.com${lot.url}`;
        }
        return `https://www.sdlauctions.co.uk${lot.url}`;
      }
      break;
    case 'bondwolfe':
      // Bond Wolfe: /auctions/properties/{id}-property-auction-{location}/
      if (lot.propertyId) {
        return `https://www.bondwolfe.com/auctions/properties/${lot.propertyId}/`;
      }
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.bondwolfe.com${lot.url}`;
      }
      break;
    case 'network':
      // Network Auctions: individual lot pages
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.networkauctions.co.uk${lot.url}`;
      }
      break;
    case 'barnardmarcus':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.barnardmarcusauctions.co.uk${lot.url}`;
      }
      break;
    case 'auctionhouselondon':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://auctionhouselondon.co.uk${lot.url}`;
      }
      break;
    case 'cliveemson':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.cliveemson.co.uk${lot.url}`;
      }
      break;
    case 'strettons':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.strettons.co.uk${lot.url}`;
      }
      break;
    case 'acuitus':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.acuitus.co.uk${lot.url}`;
      }
      break;
    case 'auctionhouse':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.auctionhouse.co.uk${lot.url}`;
      }
      break;
    case 'hollismorgan':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.hollismorgan.co.uk${lot.url}`;
      }
      break;
    case 'maggsandallen':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.maggsandallen.co.uk${lot.url}`;
      }
      break;
    case 'mchughandco':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.mchughandco.com${lot.url}`;
      }
      break;
    case 'knightfrank':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.knightfrankauctions.com${lot.url}`;
      }
      break;
    case 'pattinson':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.pattinson.co.uk${lot.url}`;
      }
      break;
    case 'bidx1':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://bidx1.com${lot.url}`;
      }
      break;
    case 'philliparnold':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.philliparnoldauctions.co.uk${lot.url}`;
      }
      break;
    case 'edwardmellor':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.edwardmellor.co.uk${lot.url}`;
      }
      break;
    case 'paulfosh':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.paulfosh.com${lot.url}`;
      }
      break;
    case 'cottons':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.cottons.co.uk${lot.url}`;
      }
      break;
    case 'dedmangray':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.dedmangray.co.uk${lot.url}`;
      }
      break;
    case 'barnettross':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.barnettross.co.uk${lot.url}`;
      }
      break;
    case 'bradleyhall':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.bradleyhall.co.uk${lot.url}`;
      }
      break;
    case 'connectuk':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.connectukauctions.co.uk${lot.url}`;
      }
      break;
    case 'auctionestates':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.auctionestates.co.uk${lot.url}`;
      }
      break;
    case 'landwood':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.landwoodgroup.com${lot.url}`;
      }
      break;
    case 'loveitts':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.loveitts.co.uk${lot.url}`;
      }
      break;
    case 'hunters':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.huntersnet.co.uk${lot.url}`;
      }
      break;
  }
  return lot.url || '';
}

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: Land Registry + Rental Yield per lot
// ═══════════════════════════════════════════════════════════════
async function enrichLots(lots, house, sourceUrl) {
  // Group lots by postcode to avoid duplicate queries
  const postcodeMap = {};
  for (const lot of lots) {
    lot.url = buildLotUrl(lot, house, sourceUrl);
    const pc = extractPostcode(lot.address);
    lot.postcode = pc;
    if (pc && !postcodeMap[pc]) postcodeMap[pc] = [];
    if (pc) postcodeMap[pc].push(lot);
  }

  const postcodes = Object.keys(postcodeMap);
  console.log(`Enriching ${lots.length} lots across ${postcodes.length} unique postcodes...`);

  // Query Land Registry for each unique postcode (with concurrency limit)
  const CONCURRENCY = 5;
  const lrCache = {};
  for (let i = 0; i < postcodes.length; i += CONCURRENCY) {
    const batch = postcodes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(pc => queryLandRegistry(pc)));
    batch.forEach((pc, idx) => { lrCache[pc] = results[idx]; });
    if (i + CONCURRENCY < postcodes.length) await new Promise(r => setTimeout(r, 200));
  }

  // Enrich each lot
  for (const lot of lots) {
    const pc = lot.postcode;
    const sales = lrCache[pc] || [];
    
    // Street sales data
    lot.streetSales = sales.slice(0, 10).map(s => ({
      address: s.address,
      price: s.price,
      date: s.date,
      type: s.propertyType,
    }));

    // Calculate street average (last 3 years)
    const relevantSales = sales.filter(s => s.price > 0);
    if (relevantSales.length > 0) {
      const avg = Math.round(relevantSales.reduce((s, x) => s + x.price, 0) / relevantSales.length);
      lot.streetAvg = avg;
      lot.streetSalesCount = relevantSales.length;
      
      // Bargain score: how far below street average is the guide price?
      if (lot.price && avg > 0) {
        const discount = ((avg - lot.price) / avg) * 100;
        lot.belowMarket = Math.round(discount);
        if (discount > 20) {
          lot.score += 2;
          lot.opps.push(`${lot.belowMarket}% below market`);
        } else if (discount > 10) {
          lot.score += 1;
          lot.opps.push(`${lot.belowMarket}% below market`);
        } else if (discount < -10) {
          lot.risks.push(`${Math.abs(lot.belowMarket)}% above market avg`);
        }
        lot.score = Math.round(lot.score * 10) / 10;
      }
    } else {
      lot.streetAvg = null;
      lot.streetSalesCount = 0;
    }

    // Rental yield estimate
    const monthlyRent = estimateMonthlyRent(lot.address, lot.beds);
    lot.estMonthlyRent = monthlyRent;
    lot.estAnnualRent = monthlyRent * 12;
    if (lot.price && lot.price > 0) {
      lot.estGrossYield = Math.round((lot.estAnnualRent / lot.price) * 1000) / 10;
      if (lot.estGrossYield > 8 && !lot.opps.some(o => o.includes('GIY'))) {
        lot.score += 1.5;
        lot.opps.push(`Est. ${lot.estGrossYield}% yield`);
      } else if (lot.estGrossYield > 6 && !lot.opps.some(o => o.includes('GIY'))) {
        lot.score += 0.5;
        lot.opps.push(`Est. ${lot.estGrossYield}% yield`);
      }
      lot.score = Math.round(lot.score * 10) / 10;
    }
  }

  // Re-sort by score after enrichment
  lots.sort((a, b) => b.score - a.score);
  console.log(`Enrichment complete. ${Object.values(lrCache).flat().length} total Land Registry sales found.`);
  return lots;
}
// Sentry error handler — must be after all routes, before app.listen
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.listen(PORT, () => {
  log.info('server_start', { port: PORT });
  if (!process.env.SUPABASE_URL) log.warn('missing_env', { var: 'SUPABASE_URL' });
  if (!process.env.SUPABASE_SERVICE_KEY) log.warn('missing_env', { var: 'SUPABASE_SERVICE_KEY' });
  if (!process.env.ANTHROPIC_API_KEY) log.warn('missing_env', { var: 'ANTHROPIC_API_KEY' });

  // ── Auto-analyse all catalogue-ready auctions ──
  // Run 30s after startup (let everything initialise), then every 6 hours
  setTimeout(() => autoAnalyseAll(), 30000);
  setInterval(() => autoAnalyseAll(), 6 * 60 * 60 * 1000);
});

// ═══════════════════════════════════════════════════════════════
// AUTO-ANALYSIS: Pre-analyse all catalogue-ready auctions
// ═══════════════════════════════════════════════════════════════
let _autoAnalysisRunning = false;

async function autoAnalyseAll() {
  if (_autoAnalysisRunning) {
    console.log('AUTO: Analysis already running, skipping this invocation');
    return { skipped: true, reason: 'already_running' };
  }
  _autoAnalysisRunning = true;
  try {
    return await _doAutoAnalyseAll();
  } finally {
    _autoAnalysisRunning = false;
  }
}

async function _doAutoAnalyseAll() {
  console.log('\n═══ AUTO-ANALYSIS: checking all catalogue-ready auctions ═══');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log('AUTO: No API key, skipping'); return; }

  // Get all catalogue-ready auctions from the calendar
  const ready = await getCalendarAuctions();
  console.log(`AUTO: ${ready.length} catalogue-ready auctions to check`);

  let analysed = 0, skipped = 0, failed = 0;

  for (const auction of ready) {
    try {
      const normalisedUrl = auction.url.trim().replace(/\/+$/, '').toLowerCase();

      // Check if we already have a fresh cache
      const { data: cached } = await supabase
        .from('cached_analyses')
        .select('url, total_lots, created_at')
        .eq('url', normalisedUrl)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (cached && cached.total_lots > 0) {
        console.log(`AUTO: ✓ ${auction.house} already cached (${cached.total_lots} lots)`);
        skipped++;
        continue;
      }

      console.log(`AUTO: Analysing ${auction.house} — ${auction.url}`);
      await autoAnalyseOne(auction.url, apiKey);
      analysed++;

      // Pause between analyses to be kind to servers and our resources
      await new Promise(r => setTimeout(r, 5000));

    } catch (e) {
      console.error(`AUTO: ✗ ${auction.house} failed: ${e.message}`);
      failed++;
    }
  }

  console.log(`═══ AUTO-ANALYSIS COMPLETE: ${analysed} analysed, ${skipped} cached, ${failed} failed ═══\n`);
  return { analysed, skipped, failed, total: ready.length };
}

async function autoAnalyseOne(url, apiKey) {
  const house = detectAuctionHouse(url);
  const rewritten = rewriteUrl(url, house);
  const scrapeUrl = rewritten.baseUrl;
  const client = new Anthropic({ apiKey });
  let rawLots = [];

  if (rewritten.paginateAs === 'allsop_api') {
    const pages = await scrapeAllsopApi(rewritten.baseUrl);
    if (pages.length > 0) rawLots = await extractLotsWithClaude(client, pages, house);

  } else if (rewritten.preferPuppeteer) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) req.abort();
      else req.continue();
    });

    try {
      if (rewritten.paginateAs === 'savills_pages') {
        await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2000));
        const totalPages = await page.evaluate(() => {
          const pageLinks = document.querySelectorAll('a[href*="/page-"]');
          let max = 1;
          for (const a of pageLinks) {
            const m = a.textContent.trim().match(/^(\d+)$/);
            if (m) max = Math.max(max, parseInt(m[1]));
          }
          return max;
        });
        const firstPageLots = await extractWithDOM(page, house);
        if (firstPageLots && firstPageLots.length > 0) rawLots.push(...firstPageLots);
        const maxPages = Math.min(totalPages, 50);
        for (let p = 2; p <= maxPages; p++) {
          try {
            await page.goto(`${scrapeUrl}/page-${p}`, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(r => setTimeout(r, 1500));
            const pageLots = await extractWithDOM(page, house);
            if (pageLots && pageLots.length > 0) rawLots.push(...pageLots);
          } catch (e) { console.log(`AUTO: Page ${p} failed: ${e.message}`); }
        }
        console.log(`AUTO: Savills total: ${rawLots.length} lots from ${maxPages} pages`);

      } else if (rewritten.paginateAs === 'sdl_pages') {
        await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 3000));
        await page.evaluate(async () => {
          for (let i = 0; i < 15; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 500)); }
          window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 2000));
        const sdlTotalPages = await page.evaluate(() => {
          const pageLinks = document.querySelectorAll('a[href*="page="], .pagination a, nav a');
          let max = 1;
          for (const a of pageLinks) {
            const href = a.getAttribute('href') || '';
            const pm = href.match(/page=(\d+)/);
            if (pm) max = Math.max(max, parseInt(pm[1]));
            const tm = a.textContent.trim().match(/^(\d+)$/);
            if (tm) max = Math.max(max, parseInt(tm[1]));
          }
          const bodyText = document.body.innerText;
          const ofMatch = bodyText.match(/page\s+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+pages/i);
          if (ofMatch) max = Math.max(max, parseInt(ofMatch[1]));
          return max;
        });
        console.log(`AUTO: SDL detected ${sdlTotalPages} pages`);
        const firstLots = await extractWithDOM(page, house);
        if (firstLots && firstLots.length > 0) rawLots.push(...firstLots);
        console.log(`AUTO: SDL Page 1: ${firstLots ? firstLots.length : 0} lots`);
        const sdlMaxPages = Math.min(sdlTotalPages, 20);
        for (let p = 2; p <= sdlMaxPages; p++) {
          const sep = scrapeUrl.includes('?') ? '&' : '?';
          const pageUrl = `${scrapeUrl}${sep}page=${p}`;
          try {
            await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));
            await page.evaluate(async () => {
              for (let i = 0; i < 10; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 400)); }
              window.scrollTo(0, 0);
            });
            await new Promise(r => setTimeout(r, 1500));
            const pageLots = await extractWithDOM(page, house);
            if (pageLots && pageLots.length > 0) {
              rawLots.push(...pageLots);
              console.log(`AUTO: SDL Page ${p}: ${pageLots.length} lots`);
            } else {
              console.log(`AUTO: SDL Page ${p}: 0 lots — stopping`);
              break;
            }
          } catch (e) { console.log(`AUTO: SDL Page ${p} failed: ${e.message}`); break; }
        }
        console.log(`AUTO: SDL total: ${rawLots.length} lots`);

      } else {
        // ── Generic auto-paginating Puppeteer extraction ──
        await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 3000));
        await page.evaluate(async () => {
          for (let i = 0; i < 15; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 500)); }
          window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 2000));

        const domLots = await extractWithDOM(page, house);
        if (domLots && domLots.length >= 3) {
          rawLots.push(...domLots);
          console.log(`AUTO: ${house} Page 1: ${domLots.length} lots`);

          // Auto-detect pagination
          const detectedPages = await page.evaluate(() => {
            let max = 1;
            document.querySelectorAll('a[href*="page="], a[href*="page-"], a[href*="/page/"]').forEach(a => {
              const href = a.getAttribute('href') || '';
              const m = href.match(/page[=/](\d+)/) || href.match(/page-(\d+)/);
              if (m) max = Math.max(max, parseInt(m[1]));
            });
            document.querySelectorAll('.pagination a, nav.pagination a, .paging a, .page-numbers a, [class*="pagination"] a, [class*="pager"] a').forEach(a => {
              const t = a.textContent.trim();
              if (t.match(/^\d+$/)) max = Math.max(max, parseInt(t));
            });
            const bodyText = document.body.innerText;
            const ofMatch = bodyText.match(/page\s+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+pages/i);
            if (ofMatch) max = Math.max(max, parseInt(ofMatch[1]));
            const showMatch = bodyText.match(/showing\s+\d+[\s-]+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+results?\s+found/i) || bodyText.match(/(\d+)\s+(?:lots?|properties)/i);
            if (showMatch) { const total = parseInt(showMatch[1]); if (total > 50) max = Math.max(max, Math.ceil(total / 20)); }
            let pattern = 'query';
            if (document.querySelector('a[href*="page-"]')) pattern = 'path-dash';
            if (document.querySelector('a[href*="/page/"]')) pattern = 'path-slash';
            return { max, pattern };
          });

          if (detectedPages.max > 1) {
            const maxPages = Math.min(detectedPages.max, 25);
            console.log(`AUTO: ${house}: detected ${detectedPages.max} pages (${detectedPages.pattern}), loading up to ${maxPages}`);
            for (let p = 2; p <= maxPages; p++) {
              let pageUrl;
              if (detectedPages.pattern === 'path-dash') pageUrl = scrapeUrl.replace(/\/page-\d+/, '') + `/page-${p}`;
              else if (detectedPages.pattern === 'path-slash') pageUrl = scrapeUrl.replace(/\/page\/\d+/, '') + `/page/${p}`;
              else { const sep = scrapeUrl.includes('?') ? '&' : '?'; pageUrl = `${scrapeUrl}${sep}page=${p}`; }
              try {
                await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(r => setTimeout(r, 2000));
                await page.evaluate(async () => { for (let i = 0; i < 10; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 400)); } window.scrollTo(0, 0); });
                await new Promise(r => setTimeout(r, 1500));
                const pageLots = await extractWithDOM(page, house);
                if (pageLots && pageLots.length > 0) { rawLots.push(...pageLots); console.log(`AUTO: ${house} Page ${p}: ${pageLots.length} lots`); }
                else { console.log(`AUTO: ${house} Page ${p}: 0 lots — stopping`); break; }
              } catch (e) { console.log(`AUTO: ${house} Page ${p} failed: ${e.message}`); break; }
            }
          }
          console.log(`AUTO: ${house} total: ${rawLots.length} lots`);
        } else {
          const html = await page.content();
          const puppeteerPages = [{ page: 1, html }];
          rawLots = await extractLotsWithClaude(client, puppeteerPages, house);
          console.log(`AUTO: ${house}: ${rawLots.length} lots via Claude fallback`);
        }
      }
    } finally {
      await page.close();
    }

  } else {
    const pages = await scrapeAllPages(scrapeUrl, house);
    if (pages && pages.length > 0) rawLots = await extractLotsWithClaude(client, pages, house);
    // Skip Puppeteer fallback for houses where it wastes memory (blocked, empty, or JS-only)
    const SKIP_PUPPETEER = ['pattinson','knightfrank','paulfosh','cottons','dedmangray',
      'barnettross','philliparnold','network'];
    if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
      const puppeteerPages = await scrapeWithPuppeteer(url, house);
      if (puppeteerPages.length > 0) rawLots = await extractLotsWithClaude(client, puppeteerPages, house);
    }
  }

  if (rawLots.length === 0) {
    console.log(`AUTO: ${house}: 0 lots found, skipping cache`);
    return;
  }

  const lots = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);
  await enrichLots(lots, house, url);

  const normalisedUrl = url.trim().replace(/\/+$/, '').toLowerCase();
  const expiresAt = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const lotsWithPrice = lots.filter(l => l.price && l.price > 0);
  const yieldsArr = lots.map(l => l.estGrossYield).filter(y => y && y > 0);
  await supabase.from('cached_analyses').upsert({
    url: normalisedUrl,
    house,
    total_lots: lots.length,
    title_splits: lots.filter(l => l.titleSplit).length,
    top_picks: lots.filter(l => l.score >= 3).length,
    under_100k: lotsWithPrice.filter(l => l.price < 100000).length,
    avg_yield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
    dev_potential: lots.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
    vacant_count: lots.filter(l => l.vacant === true).length,
    lots,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
  }, { onConflict: 'url' });

  console.log(`AUTO: ✓ ${house}: ${lots.length} lots cached (${lots.filter(l => l.titleSplit).length} title splits, ${lots.filter(l => l.score >= 3).length} top picks)`);
}

// Helper: get catalogue-ready auctions (used by auto-analyse)
async function getCalendarAuctions() {
  // Try Supabase first
  try {
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('house, url, catalogue_ready')
      .eq('catalogue_ready', true);

    if (!error && data && data.length > 0) {
      return data.map(row => ({
        house: row.house,
        url: row.url,
        catalogueReady: row.catalogue_ready,
      }));
    }
  } catch (e) {
    console.warn('Calendar DB read failed in getCalendarAuctions, using fallback:', e.message);
  }

  // Fallback to hardcoded
  return FALLBACK_CALENDAR.filter(a => a.catalogueReady).map(a => ({
    house: a.house,
    url: a.url,
    catalogueReady: a.catalogueReady,
  }));
}
