IRONFLOW: Gym Membership Tracker

Members, plans, renewals, trainers, payments, analytics and staff accounts for a gym.
Python (Flask) + SQLite + HTML/CSS/vanilla JavaScript. No Node.js or npm.


Run it


Install Python 3.9 or newer.

pip install -r requirements.txt

python app.py and open http://127.0.0.1:5000

The first run creates ironflow.db and prints the admin password once. Login: admin@ironflow.local. To choose your own, set IRONFLOW_ADMIN_PASSWORD before the first run. To start fresh, delete ironflow.db.


Optional environment variables: PORT (default 5000), IRONFLOW_DB (database path), IRONFLOW_ADMIN_PASSWORD.
The page loads GSAP, Chart.js, Lucide and Google Fonts from CDNs, so the browser needs internet access.


What is inside

Area	Features
Landing	Animated hero, custom cursor (desktop), sample-stats preview
Dashboard	6 KPIs with trends, 3 charts, recent payments and members, renewals, dues, quick actions
Members	Search, status filters, sorting, pagination, add/edit/delete, profile, CSV import and export, renew from profile
Plans	Cards, comparison table, per-plan revenue, create/edit/archive
Trainers	Directory, workload bars, profiles, bulk reassignment, safe delete
Payments	Record, filter, saved views, settle pending, partial refunds, printable receipts, CSV export
Renewals	7/15/30-day, expired and recently-renewed lists with a timeline
Analytics	Date ranges (including custom), 8 charts, CSV export, print report
Settings	Profile, notification preferences, password change, staff accounts and audit trail (admin)
Everywhere	Global search (Ctrl+K), quick-actions menu, notification bell, dark/light/system themes, 6 accent presets plus custom colour

Project layout

app.py              Flask API + database setup (schema, validation, business rules)
requirements.txt
frontend/           index.html, css/styles.css, js/ (app, members, modules, reports, shell, admin, theme)
docs/               DATABASE_REPORT.md, er-diagram.png/.svg/.dot, schema.sql, queries.sql
tests/              ui_smoke_test.py (headless browser)

Rules worth knowing


Revenue = paid minus refunded. Pending = dues. Failed is ignored. A refund is a new entry; the original payment is never changed.

Renewing while a plan is still running starts the new period the day after it ends. All dates use India time (IST).

Double-clicks and retries cannot create duplicate payments, renewals or refunds.

Payments are manual records. Nothing is processed through a bank or gateway, and no card data is stored.

Notifications are in-app only. No email or SMS is sent.


Security

Salted password hashes, HTTP-only SameSite=Strict session cookie, CSRF header check on writes, login rate limit, server-side validation, bound SQL parameters, role re-checked from the database on every request, security headers. For a real deployment run behind HTTPS and set IRONFLOW_PROD=1 (secure cookies).


Accessibility

Keyboard-operable menus, dialogs and search; visible focus rings; every accent preset meets WCAG AA contrast for text and button labels in both themes; custom colours are automatically adjusted to stay readable; reduced-motion respected.


Tests

python tests/ui_smoke_test.py runs the 18 browser checks (needs pip install playwright and playwright install chromium).


Known limits

SQLite suits one gym; use PostgreSQL or MySQL for many concurrent staff. Email/SMS needs a provider adapter. The export/import CSV supports members and payments only.

