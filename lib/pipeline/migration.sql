-- Experiment logging table for A/B pipeline comparison
-- Run this in Supabase SQL editor before enabling the experiment

create table if not exists experiment_log (
  id bigserial primary key,
  group_name text not null,        -- 'control' | 'treatment' | 'meta'
  house_slug text not null,
  cycle_ts timestamptz not null,
  metric text not null,            -- e.g. 'lot_count', 'scrape_duration_ms', 'image_coverage'
  value numeric,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Index for querying by group + house + cycle
create index if not exists idx_experiment_group_house
  on experiment_log (group_name, house_slug, cycle_ts);

-- Index for querying by metric across all houses
create index if not exists idx_experiment_metric
  on experiment_log (metric, cycle_ts);

-- View: compare treatment vs control per metric per cycle
create or replace view experiment_comparison as
select
  cycle_ts,
  metric,
  house_slug,
  max(case when group_name = 'treatment' then value end) as treatment_value,
  max(case when group_name = 'control' then value end) as control_value,
  max(case when group_name = 'treatment' then value end) -
    max(case when group_name = 'control' then value end) as delta
from experiment_log
where group_name in ('treatment', 'control')
group by cycle_ts, metric, house_slug
order by cycle_ts desc, metric;

-- View: daily averages per group per metric (for trend analysis)
create or replace view experiment_daily_summary as
select
  date_trunc('day', cycle_ts) as day,
  group_name,
  metric,
  round(avg(value), 2) as avg_value,
  round(stddev(value), 2) as stddev_value,
  count(*) as sample_count
from experiment_log
where group_name in ('treatment', 'control')
group by date_trunc('day', cycle_ts), group_name, metric
order by day desc, metric, group_name;
