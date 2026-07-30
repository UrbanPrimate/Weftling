-- Weftly — schema drift check: every (table, column) the app's code actually
-- reads or writes, checked against what's really in the database.
--
-- Run this any time after applying migrations (or when something fails with
-- "column ... does not exist") to see exactly what's still missing, instead
-- of guessing which of the supabase/*.sql files got skipped.
--
-- Expect ZERO rows back. Any row returned names a column the app's code
-- depends on that isn't in the database yet — cross-reference the table
-- name against supabase/schema.sql, policies.sql, integrations.sql, or
-- xero_sync_columns.sql to find (and re-run) the migration that adds it.
-- If a whole table is missing, every one of its columns will show up here
-- at once — that's your signal the table itself, not just a column,
-- still needs creating.

with expected(table_name, column_name) as (
  values
    -- clients — supabase/schema.sql + xero_sync_columns.sql
    ('clients', 'id'), ('clients', 'user_id'), ('clients', 'name'), ('clients', 'email'),
    ('clients', 'rate'), ('clients', 'increment'), ('clients', 'created_at'),
    ('clients', 'xero_contact_id'),

    -- time_entries — supabase/schema.sql + xero_sync_columns.sql
    ('time_entries', 'id'), ('time_entries', 'user_id'), ('time_entries', 'client_id'),
    ('time_entries', 'entry_date'), ('time_entries', 'description'), ('time_entries', 'minutes'),
    ('time_entries', 'rate'), ('time_entries', 'increment'), ('time_entries', 'billable'),
    ('time_entries', 'entry_mode'), ('time_entries', 'clock_start'), ('time_entries', 'clock_end'),
    ('time_entries', 'clock_break_minutes'), ('time_entries', 'invoiced'), ('time_entries', 'created_at'),
    ('time_entries', 'xero_item_code'),

    -- materials — supabase/schema.sql + xero_sync_columns.sql
    ('materials', 'id'), ('materials', 'user_id'), ('materials', 'client_id'), ('materials', 'entry_date'),
    ('materials', 'description'), ('materials', 'qty'), ('materials', 'unit_cost'), ('materials', 'markup_pct'),
    ('materials', 'billable'), ('materials', 'invoiced'), ('materials', 'created_at'),
    ('materials', 'xero_item_code'),

    -- settings — supabase/schema.sql (incl. its own alter-table additions)
    ('settings', 'user_id'), ('settings', 'default_rate'), ('settings', 'default_increment'),
    ('settings', 'rounding_mode'), ('settings', 'min_one_increment'), ('settings', 'terms_days'),
    ('settings', 'default_markup'), ('settings', 'currency_symbol'), ('settings', 'date_format'),
    ('settings', 'xero_account_code'), ('settings', 'xero_tax_type'), ('settings', 'accounting_software'),
    ('settings', 'qb_product_service'), ('settings', 'time_entry_mode'), ('settings', 'overview_period'),
    ('settings', 'timesheet_period'), ('settings', 'contractor'), ('settings', 'timesheet_counter'),

    -- integrations — supabase/integrations.sql
    ('integrations', 'user_id'), ('integrations', 'provider'), ('integrations', 'nango_connection_id'),
    ('integrations', 'xero_tenant_id'), ('integrations', 'xero_org_name'), ('integrations', 'status'),
    ('integrations', 'connected_at')
)
select e.table_name, e.column_name
from expected e
left join information_schema.columns c
  on c.table_schema = 'public'
  and c.table_name = e.table_name
  and c.column_name = e.column_name
where c.column_name is null
order by e.table_name, e.column_name;
