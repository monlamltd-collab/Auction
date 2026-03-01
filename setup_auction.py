"""
Auction Tool — One-time setup script
=====================================
Creates the auction_calendar table in Supabase and seeds it with data.
Also verifies existing tables (users, cached_analyses, rate_limits) are present.

Usage:
    python setup_auction.py

You'll be prompted for:
    - Supabase URL
    - Supabase Service Role Key
    - Admin secret (for the /api/admin endpoints)
    - Railway app URL (optional — to seed via the live API)
"""

import json
import sys
import urllib.request
import urllib.error
import ssl

# Disable SSL verification warnings for simple scripting
ctx = ssl.create_default_context()

def supabase_rest(url, key, path, method='GET', data=None):
    """Make a request to the Supabase REST API."""
    endpoint = f"{url.rstrip('/')}/rest/v1/{path}"
    headers = {
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(endpoint, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            return json.loads(resp.read().decode()), resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {'error': body, 'status': e.code}, e.code

def api_call(base_url, path, method='POST', data=None):
    """Call the Auction app's API endpoints."""
    endpoint = f"{base_url.rstrip('/')}{path}"
    headers = {'Content-Type': 'application/json'}
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(endpoint, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            return json.loads(resp.read().decode()), resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return json.loads(body), e.code
        except:
            return {'error': body, 'status': e.code}, e.code
    except Exception as e:
        return {'error': str(e)}, 0

def check_table_exists(url, key, table):
    """Check if a table exists by trying to select from it."""
    result, status = supabase_rest(url, key, f'{table}?select=*&limit=1')
    if status == 200:
        return True
    return False

def get_table_count(url, key, table):
    """Get row count from a table."""
    result, status = supabase_rest(url, key, f'{table}?select=*')
    if status == 200 and isinstance(result, list):
        return len(result)
    return -1

def insert_calendar_rows(url, key, rows):
    """Insert calendar rows directly into Supabase."""
    result, status = supabase_rest(url, key, 'auction_calendar', method='POST', data=rows)
    return result, status

def main():
    print("=" * 60)
    print("  Auction Tool — Supabase Setup")
    print("=" * 60)
    print()

    # Collect credentials
    supabase_url = input("Supabase URL (e.g. https://xxx.supabase.co): ").strip()
    if not supabase_url:
        print("ERROR: Supabase URL is required")
        sys.exit(1)

    service_key = input("Supabase Service Role Key: ").strip()
    if not service_key:
        print("ERROR: Service key is required")
        sys.exit(1)

    admin_secret = input("Admin secret (for ADMIN_SECRET env var): ").strip()

    railway_url = input("Railway app URL (optional, press Enter to skip): ").strip()

    print()
    print("-" * 60)
    print("  Step 1: Checking existing tables")
    print("-" * 60)

    for table in ['users', 'cached_analyses', 'rate_limits']:
        exists = check_table_exists(supabase_url, service_key, table)
        count = get_table_count(supabase_url, service_key, table) if exists else 0
        status = f"OK ({count} rows)" if exists else "MISSING"
        print(f"  {table}: {status}")
        if not exists:
            print(f"    -> Run schema.sql in Supabase SQL Editor to create this table")

    print()
    print("-" * 60)
    print("  Step 2: Checking auction_calendar table")
    print("-" * 60)

    cal_exists = check_table_exists(supabase_url, service_key, 'auction_calendar')
    if cal_exists:
        count = get_table_count(supabase_url, service_key, 'auction_calendar')
        print(f"  auction_calendar: OK ({count} rows)")
    else:
        print("  auction_calendar: MISSING")
        print()
        print("  You need to create this table. Copy-paste the following SQL")
        print("  into the Supabase SQL Editor and run it:")
        print()
        with open('auction_calendar_schema.sql', 'r') as f:
            print(f.read())
        print()
        input("  Press Enter after running the SQL in Supabase... ")

        # Re-check
        cal_exists = check_table_exists(supabase_url, service_key, 'auction_calendar')
        if not cal_exists:
            print("  ERROR: Table still not found. Please check the SQL and try again.")
            sys.exit(1)
        print("  auction_calendar: OK (created)")

    print()
    print("-" * 60)
    print("  Step 3: Seeding auction calendar data")
    print("-" * 60)

    count = get_table_count(supabase_url, service_key, 'auction_calendar')
    if count > 0:
        print(f"  Calendar already has {count} entries.")
        reseed = input("  Reseed? (y/N): ").strip().lower()
        if reseed != 'y':
            print("  Skipping seed.")
        else:
            _seed_calendar(supabase_url, service_key)
    else:
        _seed_calendar(supabase_url, service_key)

    print()
    print("-" * 60)
    print("  Step 4: Verifying the live app (optional)")
    print("-" * 60)

    if railway_url:
        print(f"  Testing {railway_url}/api/auctions ...")
        result, status = api_call(railway_url, '/api/auctions', method='GET')
        if status == 200:
            count = result.get('count', 0)
            print(f"  OK — {count} auctions returned")
        else:
            print(f"  WARNING — status {status}: {result}")

        if admin_secret:
            print(f"  Testing /api/admin/seed-calendar ...")
            result, status = api_call(railway_url, '/api/admin/seed-calendar', data={'secret': admin_secret})
            if status == 200:
                print(f"  OK — {result.get('message', result)}")
            else:
                print(f"  WARNING — status {status}: {result}")
    else:
        print("  Skipped (no Railway URL provided)")

    print()
    print("-" * 60)
    print("  Step 5: Environment variables checklist")
    print("-" * 60)
    print()
    print("  Ensure these are set in Railway dashboard -> Variables:")
    print()
    print(f"    SUPABASE_URL          = {supabase_url}")
    print(f"    SUPABASE_SERVICE_KEY  = {service_key[:20]}...{service_key[-10:]}")
    if admin_secret:
        print(f"    ADMIN_SECRET          = {admin_secret[:4]}...{admin_secret[-4:]}" if len(admin_secret) > 8 else f"    ADMIN_SECRET          = (set)")
    else:
        print(f"    ADMIN_SECRET          = (not provided — set one!)")
    print(f"    ANTHROPIC_API_KEY     = (check Railway)")
    print()

    print("=" * 60)
    print("  Setup complete!")
    print("=" * 60)


def _seed_calendar(supabase_url, service_key):
    """Seed the calendar with the hardcoded auction data."""
    rows = [
        {"house": "Savills", "house_slug": "savills", "logo": "🏛️", "date": "2026-02-24", "date_end": "2026-02-25", "title": "24 & 25 February 2026", "lots": 322, "url": "https://auctions.savills.co.uk/auctions/24--25-february-2026-218", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Savills", "house_slug": "savills", "logo": "🏛️", "date": "2026-03-17", "title": "17 March 2026", "url": "https://auctions.savills.co.uk/upcoming-auctions", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Savills", "house_slug": "savills", "logo": "🏛️", "date": "2026-03-31", "title": "31 March 2026", "url": "https://auctions.savills.co.uk/upcoming-auctions", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Savills", "house_slug": "savills", "logo": "🏛️", "date": "2026-04-21", "title": "21 April 2026", "url": "https://auctions.savills.co.uk/upcoming-auctions", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Savills", "house_slug": "savills", "logo": "🏛️", "date": "2026-05-06", "title": "6 May 2026", "url": "https://auctions.savills.co.uk/upcoming-auctions", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Allsop", "house_slug": "allsop", "logo": "🔨", "date": "2026-02-25", "date_end": "2026-02-26", "title": "25 & 26 February 2026 — Residential", "lots": 325, "url": "https://www.allsop.co.uk/residential-auction-view", "location": "Online (Live Stream)", "type": "Residential", "status": "upcoming", "catalogue_ready": True},
        {"house": "Allsop", "house_slug": "allsop", "logo": "🔨", "date": "2026-03-24", "title": "24 March 2026 — Commercial", "url": "https://www.allsop.co.uk/commercial-auction-view", "location": "Online (Live Stream)", "type": "Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Allsop", "house_slug": "allsop", "logo": "🔨", "date": "2026-03-25", "date_end": "2026-03-26", "title": "25 & 26 March 2026 — Residential", "url": "https://www.allsop.co.uk/residential-auction-view", "location": "Online (Live Stream)", "type": "Residential", "status": "upcoming", "catalogue_ready": True},
        {"house": "Network Auctions", "house_slug": "network", "logo": "🌐", "date": "2026-03-26", "title": "26 March 2026", "url": "https://www.networkauctions.co.uk/auctions/next-auction/", "location": "Online", "type": "Residential", "status": "upcoming", "catalogue_ready": True},
        {"house": "Network Auctions", "house_slug": "network", "logo": "🌐", "date": "2026-05-07", "title": "7 May 2026", "url": "https://www.networkauctions.co.uk/auctions/future-auctions/", "location": "Online", "type": "Residential", "status": "upcoming", "catalogue_ready": False},
        {"house": "Network Auctions", "house_slug": "network", "logo": "🌐", "date": "2026-06-18", "title": "18 June 2026", "url": "https://www.networkauctions.co.uk/auctions/future-auctions/", "location": "Online", "type": "Residential", "status": "upcoming", "catalogue_ready": False},
        {"house": "SDL Auctions", "house_slug": "sdl", "logo": "⚡", "date": "2026-02-24", "title": "24 February 2026 — Timed", "url": "https://www.sdlauctions.co.uk/auction/1310/multi-lot-timed-auction-2026-02-24/", "location": "Online (Timed)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "SDL Auctions", "house_slug": "sdl", "logo": "⚡", "date": "2026-02-26", "title": "26 February 2026 — Live Stream", "url": "https://www.sdlauctions.co.uk/auction/1292/live-streamed-auction-2026-02-26/", "location": "Online (Live Stream)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "SDL Auctions", "house_slug": "sdl", "logo": "⚡", "date": "2026-03-24", "title": "24 March 2026 — Timed", "url": "https://www.sdlauctions.co.uk/auction/1311/multi-lot-timed-auction-2026-03-24/", "location": "Online (Timed)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "SDL Auctions", "house_slug": "sdl", "logo": "⚡", "date": "2026-03-26", "title": "26 March 2026 — Live Stream", "url": "https://www.sdlauctions.co.uk/auction/1297/live-streamed-auction-2026-03-26/", "location": "Online (Live Stream)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "SDL Auctions", "house_slug": "sdl", "logo": "⚡", "date": "2026-04-28", "title": "28 April 2026 — Timed", "url": "https://www.sdlauctions.co.uk/auction/1312/multi-lot-timed-auction-2026-04-28/", "location": "Online (Timed)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "SDL Auctions", "house_slug": "sdl", "logo": "⚡", "date": "2026-04-30", "title": "30 April 2026 — Live Stream", "url": "https://www.sdlauctions.co.uk/auction/1298/live-streamed-auction-2026-04-30/", "location": "Online (Live Stream)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Bond Wolfe", "house_slug": "bondwolfe", "logo": "🔶", "date": "2026-03-26", "title": "26 March 2026", "url": "https://www.bondwolfe.com/auction/3448/", "location": "Online (Live Stream)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Bond Wolfe", "house_slug": "bondwolfe", "logo": "🔶", "date": "2026-05-14", "title": "14 May 2026", "url": "https://www.bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions/", "location": "Online (Live Stream)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Bond Wolfe", "house_slug": "bondwolfe", "logo": "🔶", "date": "2026-07-09", "title": "9 July 2026", "url": "https://www.bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions/", "location": "Online (Live Stream)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Barnard Marcus", "house_slug": "barnardmarcus", "logo": "🏠", "date": "2026-03-10", "title": "10 March 2026", "url": "https://www.barnardmarcusauctions.co.uk/auctions/current/", "location": "Grand Connaught Rooms, London WC2B", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Auction House London", "house_slug": "auctionhouselondon", "logo": "🔑", "date": "2026-03-04", "title": "4 March 2026", "lots": 45, "url": "https://auctionhouselondon.co.uk/current-auction", "location": "Online (Live Stream)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Auction House London", "house_slug": "auctionhouselondon", "logo": "🔑", "date": "2026-03-18", "date_end": "2026-03-19", "title": "18 & 19 March 2026", "url": "https://auctionhouselondon.co.uk/auction/march-18-19-2026", "location": "Online (Live Stream)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Clive Emson", "house_slug": "cliveemson", "logo": "🌿", "date": "2026-03-05", "title": "5 March 2026 catalogue live", "url": "https://www.cliveemson.co.uk/search/", "location": "Online", "type": "Residential & Land", "status": "upcoming", "catalogue_ready": True},
        {"house": "Strettons", "house_slug": "strettons", "logo": "📋", "date": "2026-03-19", "title": "19 March 2026", "url": "https://www.strettons.co.uk/auctions/current-catalogue/", "location": "Online (Live Stream)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Acuitus", "house_slug": "acuitus", "logo": "🏢", "date": "2026-03-26", "title": "26 March 2026", "url": "https://www.acuitus.co.uk/find-a-property/", "location": "Online (Live Stream)", "type": "Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Acuitus", "house_slug": "acuitus", "logo": "🏢", "date": "2026-05-06", "title": "6 May 2026", "url": "https://www.acuitus.co.uk/find-a-property/", "location": "Online (Live Stream)", "type": "Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Acuitus", "house_slug": "acuitus", "logo": "🏢", "date": "2026-06-11", "title": "11 June 2026", "url": "https://www.acuitus.co.uk/find-a-property/", "location": "Online (Live Stream)", "type": "Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Hollis Morgan", "house_slug": "hollismorgan", "logo": "🏘️", "date": "2026-03-11", "title": "11 March 2026", "url": "https://www.hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc", "location": "Online (Live Stream from Clifton, Bristol)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Hollis Morgan", "house_slug": "hollismorgan", "logo": "🏘️", "date": "2026-04-01", "title": "April 2026", "url": "https://www.hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc", "location": "Online (Live Stream from Clifton, Bristol)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Maggs & Allen", "house_slug": "maggsandallen", "logo": "🔨", "date": "2026-03-19", "title": "19 March 2026", "url": "https://www.maggsandallen.co.uk/search-auction/", "location": "Online (Live Stream, Bristol)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Maggs & Allen", "house_slug": "maggsandallen", "logo": "🔨", "date": "2026-04-23", "title": "23 April 2026", "url": "https://www.maggsandallen.co.uk/search-auction/", "location": "Online (Live Stream, Bristol)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Maggs & Allen", "house_slug": "maggsandallen", "logo": "🔨", "date": "2026-05-20", "title": "20 May 2026", "url": "https://www.maggsandallen.co.uk/search-auction/", "location": "Online (Live Stream, Bristol)", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "McHugh & Co", "house_slug": "mchughandco", "logo": "🏡", "date": "2026-03-25", "title": "25 March 2026", "url": "https://www.mchughandco.com/pages/auctions", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "McHugh & Co", "house_slug": "mchughandco", "logo": "🏡", "date": "2026-05-13", "title": "13 May 2026", "url": "https://www.mchughandco.com/pages/auctions", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Auction House UK", "house_slug": "auctionhouse", "logo": "🏛️", "date": "2026-03-10", "title": "10 March 2026 (National Online)", "url": "https://www.auctionhouse.co.uk/online/auction/2026/3/10", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Knight Frank", "house_slug": "knightfrank", "logo": "👑", "date": "2026-03-12", "title": "12 March 2026", "url": "https://www.knightfrankauctions.com/forthcoming-auctions/", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Pattinson", "house_slug": "pattinson", "logo": "🔷", "date": "2026-03-05", "title": "5 March 2026 (North East)", "url": "https://www.pattinson.co.uk/auction/property-search", "location": "Newcastle", "type": "Residential", "status": "upcoming", "catalogue_ready": True},
        {"house": "BidX1", "house_slug": "bidx1", "logo": "💻", "date": "2026-03-01", "title": "March 2026 (Online)", "url": "https://bidx1.com/en/united-kingdom", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Phillip Arnold", "house_slug": "philliparnold", "logo": "🔨", "date": "2026-04-16", "title": "16 April 2026", "url": "https://www.philliparnoldauctions.co.uk/current-lots", "location": "London", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Edward Mellor", "house_slug": "edwardmellor", "logo": "🏘️", "date": "2026-03-04", "title": "4-5 March 2026", "url": "https://www.edwardmellor.co.uk/auctions/04mar2026", "location": "Manchester", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Paul Fosh", "house_slug": "paulfosh", "logo": "🏴\U000e0067\U000e0062\U000e0077\U000e006c\U000e0073\U000e007f", "date": "2026-03-11", "title": "11 March 2026", "url": "https://www.paulfosh.com/auction-lots/", "location": "Newport", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Cottons", "house_slug": "cottons", "logo": "🏭", "date": "2026-03-19", "title": "19 March 2026", "url": "https://www.cottons.co.uk/current-auction/", "location": "Birmingham", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Dedman Gray", "house_slug": "dedmangray", "logo": "📋", "date": "2026-03-19", "title": "19 March 2026", "url": "https://www.dedmangray.co.uk/auction/", "location": "Essex", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Barnett Ross", "house_slug": "barnettross", "logo": "🔑", "date": "2026-03-19", "title": "19 March 2026", "url": "https://www.barnettross.co.uk/current.php", "location": "London", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": False},
        {"house": "Bradley Hall", "house_slug": "bradleyhall", "logo": "🏠", "date": "2026-03-12", "title": "12 March 2026", "url": "https://auction.bradleyhall.co.uk/search", "location": "Newcastle", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Connect UK", "house_slug": "connectuk", "logo": "🔗", "date": "2026-03-10", "title": "10 March 2026", "url": "https://realtime.connectukauctions.co.uk/for-sale/", "location": "Online", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Auction Estates", "house_slug": "auctionestates", "logo": "🏢", "date": "2026-03-12", "title": "12 March 2026", "url": "https://www.auctionestates.co.uk/view-properties", "location": "Nottingham", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Landwood", "house_slug": "landwood", "logo": "🌲", "date": "2026-03-10", "title": "10 March 2026", "url": "https://www.landwoodpropertyauctions.com/Auction", "location": "Manchester", "type": "Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Loveitts", "house_slug": "loveitts", "logo": "❤️", "date": "2026-03-11", "title": "11 March 2026", "url": "https://www.loveitts.co.uk/auctions", "location": "Coventry", "type": "Residential & Commercial", "status": "upcoming", "catalogue_ready": True},
        {"house": "Hunters", "house_slug": "hunters", "logo": "🎯", "date": "2026-03-05", "title": "5 March 2026", "url": "https://www.hunters.com/auction-search", "location": "Yorkshire", "type": "Residential", "status": "upcoming", "catalogue_ready": True},
    ]

    print(f"  Inserting {len(rows)} auction entries...")
    result, status = insert_calendar_rows(supabase_url, service_key, rows)
    if status in (200, 201):
        print(f"  OK — {len(rows)} entries seeded")
    else:
        print(f"  Error (status {status}): {result}")
        print("  This may mean the table needs a UNIQUE constraint on (url, date).")
        print("  You can add it with: ALTER TABLE auction_calendar ADD CONSTRAINT uq_cal_url_date UNIQUE (url, date);")

if __name__ == '__main__':
    main()
