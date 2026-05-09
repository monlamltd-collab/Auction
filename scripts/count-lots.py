#!/usr/bin/env python3
"""Print lot counts from Supabase for a given list of house slugs.

Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from env. Each house slug is
queried via PostgREST count exact-mode header so we don't pull row data
just to count it.
"""
import os
import sys
import urllib.request
import urllib.parse


HOUSES = sys.argv[1:] or [
    'pattinson', 'hollismorgan', 'barnardmarcus', 'bondwolfe',
    'savills', 'cliveemson', 'edwardmellor',
]


def count(house: str) -> str:
    url = os.environ['SUPABASE_URL']
    key = os.environ['SUPABASE_SERVICE_KEY']
    qs = urllib.parse.urlencode({'house': f'ilike.{house}', 'select': 'id'})
    req = urllib.request.Request(
        f'{url}/rest/v1/lots?{qs}',
        headers={
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Prefer': 'count=exact',
            'Range': '0-0',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            cr = resp.headers.get('content-range', '')
            # Format: "0-0/1234"
            return cr.rsplit('/', 1)[-1] or '?'
    except Exception as e:
        return f'ERROR {e}'


for h in HOUSES:
    print(f'{h}: {count(h)} lots')
