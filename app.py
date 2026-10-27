"""IRONFLOW backend: Flask + SQLite (stdlib sqlite3). Run: python app.py"""
import csv, io, json, os, re, secrets, sqlite3, time
from datetime import date, datetime, timedelta, timezone
from flask import Flask, Response, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get('IRONFLOW_DB', os.path.join(BASE, 'ironflow.db'))
CURRENCY = 'INR'                       # centralised; frontend formatting lives in app.js CONFIG
IST = timezone(timedelta(hours=5, minutes=30))   # all calendar dates are IST days

def _secret():
    if os.environ.get('IRONFLOW_SECRET'): return os.environ['IRONFLOW_SECRET']
    p = os.path.join(BASE, '.secret')
    if not os.path.exists(p): open(p, 'w').write(secrets.token_hex(32))
    return open(p).read().strip()

app = Flask(__name__, static_folder=os.path.join(BASE, 'frontend'), static_url_path='')
app.config.update(SECRET_KEY=_secret(), SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
                  SESSION_COOKIE_SECURE=os.environ.get('IRONFLOW_ENV') == 'production', PERMANENT_SESSION_LIFETIME=timedelta(hours=8))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN('ADMIN','STAFF')), created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS user_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, theme TEXT DEFAULT 'system', accent TEXT DEFAULT '#C7FF4A', notify_expiry INTEGER DEFAULT 1, notify_dues INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS trainers(id TEXT PRIMARY KEY, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT, specialization TEXT NOT NULL, experience_years INTEGER DEFAULT 0, certifications TEXT, is_active INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL UNIQUE, dob TEXT, gender TEXT, join_date TEXT NOT NULL, emergency_contact TEXT, notes TEXT, is_active INTEGER DEFAULT 1, is_demo INTEGER DEFAULT 0, trainer_id TEXT REFERENCES trainers(id) ON DELETE RESTRICT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_members_name ON members(full_name);
CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, duration_days INTEGER NOT NULL CHECK(duration_days>0), price REAL NOT NULL CHECK(price>=0), description TEXT, benefits TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT, plan_name TEXT NOT NULL, price_snapshot REAL NOT NULL, duration_days_snapshot INTEGER NOT NULL, starts_on TEXT NOT NULL, expires_on TEXT NOT NULL, status TEXT DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','CANCELLED')), cancelled_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_sub_member ON subscriptions(member_id, expires_on);
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, receipt_no TEXT NOT NULL UNIQUE, idempotency_key TEXT UNIQUE, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT, subscription_id TEXT REFERENCES subscriptions(id), amount REAL NOT NULL CHECK(amount>0), currency TEXT DEFAULT 'INR', paid_on TEXT NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PAID' CHECK(status IN('PAID','PENDING','FAILED','REFUNDED')), description TEXT, refund_of_id TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_pay_date ON payments(paid_on, status);
CREATE TABLE IF NOT EXISTS renewals(id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT, subscription_id TEXT NOT NULL UNIQUE REFERENCES subscriptions(id), was_early INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT, message TEXT, dedupe_key TEXT NOT NULL UNIQUE, read_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY, user_id TEXT, action TEXT, entity TEXT, entity_id TEXT, meta TEXT, created_at TEXT DEFAULT (datetime('now')));
"""

# ---------- helpers ----------
def db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10); g.db.row_factory = sqlite3.Row; g.db.execute('PRAGMA foreign_keys=ON')
    return g.db
@app.teardown_appcontext
def _close(_):
    d = g.pop('db', None)
    if d: d.close()
BOOLS = {'wasEarly'}
def camel(r):
    o = {}
    for k, v in r.items():
        p = k.split('_'); k = p[0] + ''.join(x.title() for x in p[1:])
        if (k.startswith('is') and k[2:3].isupper()) or k in BOOLS: v = bool(v)
        o[k] = v
    return o
def q(sql, args=(), one=False):
    rows = [camel(dict(r)) for r in db().execute(sql, args).fetchall()]
    return (rows[0] if rows else None) if one else rows
def ex(sql, args=()): return db().execute(sql, args)
def snake(k): return re.sub(r'([A-Z])', lambda m: '_' + m.group(1).lower(), k)
def uid(): return secrets.token_hex(8)
def today(): return datetime.now(IST).date()
iso = lambda d: d.isoformat()
def D(y, m): t = y * 12 + (m - 1); return date(t // 12, t % 12 + 1, 1)
def rcpt(): return 'RC-' + secrets.token_hex(4).upper()
# NOTE: table/column names below come only from code constants, never from user input; values are always bound parameters.
def insert(table, d):
    i = uid(); d = {snake(k): (int(v) if isinstance(v, bool) else v) for k, v in d.items()}
    ex(f"INSERT INTO {table} (id,{','.join(d)}) VALUES ({','.join('?' * (len(d) + 1))})", [i, *d.values()]); return i
def update(table, i, d):
    d = {snake(k): (int(v) if isinstance(v, bool) else v) for k, v in d.items()}
    ts = ", updated_at=datetime('now')" if table in ('members', 'trainers', 'plans') else ''
    c = ex(f"UPDATE {table} SET {','.join(k + '=?' for k in d)}{ts} WHERE id=?", [*d.values(), i])
    if not c.rowcount: raise Err(404, 'Not found')
def audit(action, entity, eid, meta=None):
    ex('INSERT INTO audit_logs(id,user_id,action,entity,entity_id,meta) VALUES(?,?,?,?,?,?)', (uid(), session['u']['id'], action, entity, eid, json.dumps(meta) if meta else None))

class Err(Exception):
    def __init__(s, status, msg, details=None): s.status, s.msg, s.details = status, msg, details
@app.errorhandler(Err)
def _err(e): return jsonify(error={'message': e.msg, **({'details': e.details} if e.details else {})}), e.status
@app.errorhandler(sqlite3.IntegrityError)
def _int(e): return jsonify(error={'message': 'Record is referenced by other data' if 'FOREIGN KEY' in str(e) else 'Duplicate record'}), 409
@app.errorhandler(ValueError)
def _val(e): return jsonify(error={'message': 'Invalid parameter'}), 400
@app.errorhandler(404)
def _404(e): return jsonify(error={'message': 'Not found'}), 404
@app.errorhandler(500)
def _500(e): return jsonify(error={'message': 'Server error'}), 500

# ---------- validation ----------
EMAIL, PHONE = re.compile(r'^\S+@\S+\.\S+$'), re.compile(r'^\+?\d{10,13}$')
def _n(v, lo, cast):
    if isinstance(v, bool): raise ValueError('Invalid number')
    n = cast(v)
    if n < lo: raise ValueError(f'Must be at least {lo}')
    return n
def _str(v):
    v = str(v).strip()
    if len(v) < 2: raise ValueError('Too short')
    return v
def _re(rx, msg, low=False):
    def f(v):
        v = str(v).strip(); v = v.lower() if low else v
        if not rx.match(v): raise ValueError(msg)
        return v
    return f
def _list(v):
    if not isinstance(v, list): raise ValueError('Must be a list')
    return [str(x).strip() for x in v if str(x).strip()]
CONV = {'str': _str, 'text': lambda v: str(v).strip(), 'email': _re(EMAIL, 'Enter a valid email', True), 'phone': _re(PHONE, '10–13 digits, optional leading +'),
        'int0': lambda v: _n(v, 0, int), 'int1': lambda v: _n(v, 1, int), 'num0': lambda v: _n(v, 0, float), 'num1': lambda v: _n(v, 0.01, float),
        'date': lambda v: date.fromisoformat(str(v)[:10]).isoformat(), 'bool': lambda v: bool(v), 'list': _list, 'id': lambda v: str(v),
        'key': lambda v: (str(v) if len(str(v)) >= 8 else (_ for _ in ()).throw(ValueError('Too short')))}
def parse(rules, partial=False, body=None):
    body = request.get_json(silent=True) if body is None else body
    if not isinstance(body, dict): raise Err(400, 'Invalid JSON body')
    out, errs = {}, []
    for k, (kind, req) in rules.items():
        v = body.get(k)
        if v is None or v == '':
            if v is None and k in body and kind == 'id': out[k] = None
            elif req and not partial: errs.append({'path': [k], 'message': 'Required'})
            continue
        try:
            if kind.startswith('enum:'):
                if v not in kind[5:].split('|'): raise ValueError('Invalid choice')
                out[k] = v
            else: out[k] = CONV[kind](v)
        except (ValueError, TypeError) as e: errs.append({'path': [k], 'message': str(e) or 'Invalid'})
    if errs: raise Err(400, 'Validation failed', errs)
    return out
def admin():
    if session['u']['role'] != 'ADMIN': raise Err(403, 'Forbidden')

# ---------- request lifecycle ----------
HITS = {}
@app.before_request
def guard():
    if not request.path.startswith('/api/'): return
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.headers.get('X-Requested-With') != 'ironflow': raise Err(403, 'CSRF check failed')
    if request.path in ('/api/auth/login', '/api/auth/logout'): return
    if 'u' not in session: raise Err(401, 'Not signed in')
    cur = q('SELECT role, name FROM users WHERE id=?', (session['u']['id'],), one=True)
    if not cur: session.clear(); raise Err(401, 'Not signed in')
    if cur['role'] != session['u']['role'] or cur['name'] != session['u']['name']: session['u'] = {**session['u'], 'role': cur['role'], 'name': cur['name']}
@app.after_request
def fin(r):
    if 'db' in g: db().commit() if r.status_code < 400 else db().rollback()
    r.headers.update({'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'"})
    return r
@app.get('/')
def index(): return send_from_directory(app.static_folder, 'index.html')

# ---------- auth ----------
@app.post('/api/auth/login')
def login():
    ip, now = request.remote_addr, time.time(); h = [t for t in HITS.get(ip, []) if now - t < 900]
    if len(h) >= 10: raise Err(429, 'Too many attempts. Try again later.')
    HITS[ip] = h + [now]; b = request.get_json(silent=True) or {}
    u = q('SELECT * FROM users WHERE email=?', (str(b.get('email', '')).lower(),), one=True)
    if not u or not check_password_hash(u['passwordHash'], str(b.get('password', ''))): raise Err(401, 'Invalid credentials')
    session.clear(); session.permanent = True; session['u'] = {'id': u['id'], 'role': u['role'], 'name': u['name']}
    return jsonify(data=session['u'])
@app.post('/api/auth/logout')
def logout(): session.clear(); return jsonify(data=True)
@app.get('/api/auth/me')
def me(): return jsonify(data=session['u'])
@app.post('/api/auth/password')
def change_password():
    b = request.get_json(silent=True) or {}; u = q('SELECT * FROM users WHERE id=?', (session['u']['id'],), one=True)
    if not check_password_hash(u['passwordHash'], str(b.get('current', ''))): raise Err(400, 'Current password is incorrect', [{'path': ['current'], 'message': 'Incorrect password'}])
    n = str(b.get('new', ''))
    if len(n) < 10 or n == b.get('current'): raise Err(400, 'Validation failed', [{'path': ['new'], 'message': 'Use at least 10 characters, different from the current one'}])
    ex('UPDATE users SET password_hash=? WHERE id=?', (generate_password_hash(n), u['id'])); audit('PASSWORD_CHANGE', 'User', u['id']); return jsonify(data=True)

# ---------- members ----------
MEMBER = {'fullName': ('str', 1), 'email': ('email', 1), 'phone': ('phone', 1), 'dob': ('date', 0), 'gender': ('text', 0), 'emergencyContact': ('text', 0), 'notes': ('text', 0), 'trainerId': ('id', 0), 'isActive': ('bool', 0)}
def mstatus(active, exp, t):
    dl = (date.fromisoformat(exp) - t).days if exp else None
    return dl, ('inactive' if not active else 'expired' if dl is None or dl < 0 else 'expiring' if dl <= 7 else 'active')
def create_member(d):
    r = q("SELECT code FROM members WHERE code LIKE 'IF-0%' ORDER BY code DESC LIMIT 1", one=True)
    d['code'] = f"IF-{(int(r['code'][3:]) + 1 if r else 1):04d}"; d.setdefault('joinDate', iso(today()))
    i = insert('members', d); audit('CREATE', 'Member', i); return q('SELECT * FROM members WHERE id=?', (i,), one=True)
@app.get('/api/members')
def members_list():
    a, t = request.args, today(); w, args = '1=1', []
    if a.get('q', '').strip(): w, args = '(m.full_name LIKE ? OR m.email LIKE ? OR m.phone LIKE ? OR m.code LIKE ?)', [f"%{a['q'].strip()}%"] * 4
    rows = q(f'SELECT m.*, t.full_name AS trainer_name FROM members m LEFT JOIN trainers t ON t.id=m.trainer_id WHERE {w}', args)
    subs = {}
    for s in q("SELECT * FROM subscriptions WHERE status='ACTIVE' ORDER BY expires_on DESC"): subs.setdefault(s['memberId'], s)
    out = []
    for m in rows:
        s = subs.get(m['id']); dl, st = mstatus(m['isActive'], s and s['expiresOn'], t); tn = m.pop('trainerName')
        out.append({**m, 'trainer': {'fullName': tn} if tn else None, 'subscriptions': [s] if s else [], 'daysLeft': dl, 'status': st})
    if a.get('status'): out = [m for m in out if m['status'] == a['status']]
    sort = a.get('sort', 'joinDate')
    if sort == 'fullName': out.sort(key=lambda m: m['fullName'].lower())
    elif sort == 'expiry': out.sort(key=lambda m: (m['daysLeft'] is None, m['daysLeft'] or 0))
    else: out.sort(key=lambda m: (m['joinDate'], m['createdAt']), reverse=True)
    p, n = max(1, int(a.get('page', 1))), min(100, max(1, int(a.get('pageSize', 20))))
    return jsonify(data=out[(p - 1) * n:p * n], meta={'total': len(out), 'page': p, 'pageSize': n})
@app.post('/api/members')
def member_create(): return jsonify(data=create_member(parse(MEMBER))), 201
@app.get('/api/members/<i>')
def member_get(i):
    m = q('SELECT * FROM members WHERE id=?', (i,), one=True)
    if not m: raise Err(404, 'Member not found')
    m['trainer'] = q('SELECT * FROM trainers WHERE id=?', (m['trainerId'],), one=True) if m['trainerId'] else None
    m['subscriptions'] = q('SELECT * FROM subscriptions WHERE member_id=? ORDER BY starts_on DESC', (i,))
    m['payments'] = q('SELECT * FROM payments WHERE member_id=? ORDER BY paid_on DESC, created_at DESC', (i,))
    m['renewals'] = q('SELECT * FROM renewals WHERE member_id=? ORDER BY created_at DESC', (i,))
    return jsonify(data=m)
@app.patch('/api/members/<i>')
def member_patch(i):
    update('members', i, parse(MEMBER, True)); return jsonify(data=q('SELECT * FROM members WHERE id=?', (i,), one=True))
@app.delete('/api/members/<i>')
def member_delete(i):
    admin(); ex('DELETE FROM members WHERE id=?', (i,)); return jsonify(data=True)

# ---------- plans ----------
PLAN = {'name': ('str', 1), 'durationDays': ('int1', 1), 'price': ('num0', 1), 'description': ('text', 0), 'benefits': ('list', 0), 'isActive': ('bool', 0)}
def plan_out(p): p['benefits'] = json.loads(p['benefits'] or '[]'); return p
@app.get('/api/plans')
def plans_list():
    rows = q("""SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id=p.id) AS subscription_count,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id=p.id AND s.status='ACTIVE' AND s.expires_on>=?) AS active_subs,
      (SELECT COALESCE(SUM(CASE y.status WHEN 'PAID' THEN y.amount WHEN 'REFUNDED' THEN -y.amount ELSE 0 END),0) FROM payments y JOIN subscriptions s ON s.id=y.subscription_id WHERE s.plan_id=p.id) AS revenue
      FROM plans p ORDER BY duration_days""", (iso(today()),))
    return jsonify(data=[plan_out(p) for p in rows])
def _plan_write(i=None):
    admin(); d = parse(PLAN, bool(i))
    if 'benefits' in d: d['benefits'] = json.dumps(d['benefits'])
    if i: update('plans', i, d)
    else: i = insert('plans', d)
    return jsonify(data=plan_out(q('SELECT * FROM plans WHERE id=?', (i,), one=True))), (200 if request.method == 'PATCH' else 201)
@app.post('/api/plans')
def plan_create(): return _plan_write()
@app.patch('/api/plans/<i>')
def plan_patch(i): return _plan_write(i)
@app.delete('/api/plans/<i>')
def plan_delete(i):
    admin()
    if q('SELECT COUNT(*) AS n FROM subscriptions WHERE plan_id=?', (i,), one=True)['n']:
        update('plans', i, {'isActive': False}); return jsonify(data={'archived': True}, message='Plan has subscriptions; archived instead of deleted')
    ex('DELETE FROM plans WHERE id=?', (i,)); return jsonify(data={'deleted': True})

# ---------- payments (manual records only; no gateway, no card data) ----------
METHODS = 'enum:CASH|UPI|CARD|BANK_TRANSFER|OTHER'
PAY = {'memberId': ('id', 1), 'subscriptionId': ('id', 0), 'amount': ('num1', 1), 'paidOn': ('date', 1), 'method': (METHODS, 1), 'status': ('enum:PAID|PENDING|FAILED', 0), 'description': ('text', 0), 'idempotencyKey': ('key', 1)}
@app.get('/api/payments')
def pay_list():
    a = request.args; w, args = ['1=1'], []
    if a.get('q'): w.append('(p.receipt_no LIKE ? OR m.full_name LIKE ? OR m.code LIKE ?)'); args += [f"%{a['q']}%"] * 3
    for k, c in (('memberId', 'p.member_id'), ('status', 'p.status'), ('method', 'p.method')):
        if a.get(k): w.append(c + '=?'); args.append(a[k])
    if a.get('month'): w.append('p.paid_on LIKE ?'); args.append(a['month'][:7] + '-%')
    pg, n = max(1, int(a.get('page', 1))), min(100, max(1, int(a.get('pageSize', 20)))); cond = ' AND '.join(w)
    rows = q(f"SELECT p.*, m.full_name AS mn, m.code AS mc FROM payments p JOIN members m ON m.id=p.member_id WHERE {cond} ORDER BY p.paid_on DESC, p.created_at DESC LIMIT ? OFFSET ?", [*args, n, (pg - 1) * n])
    for r in rows: r['member'] = {'fullName': r.pop('mn'), 'code': r.pop('mc')}
    total = q(f'SELECT COUNT(*) AS n FROM payments p JOIN members m ON m.id=p.member_id WHERE {cond}', args, one=True)['n']
    return jsonify(data=rows, meta={'total': total, 'page': pg, 'pageSize': n})
@app.post('/api/payments')
def pay_create():
    d = parse(PAY); dup = q('SELECT * FROM payments WHERE idempotency_key=?', (d['idempotencyKey'],), one=True)
    if dup: return jsonify(data=dup, duplicate=True)
    if not q('SELECT 1 AS x FROM members WHERE id=?', (d['memberId'],), one=True): raise Err(404, 'Member not found')
    if d.get('subscriptionId') and not q('SELECT 1 AS x FROM subscriptions WHERE id=? AND member_id=?', (d['subscriptionId'], d['memberId']), one=True): raise Err(400, 'Subscription does not belong to this member')
    d.setdefault('status', 'PAID'); d.update(currency=CURRENCY, receiptNo=rcpt()); i = insert('payments', d)
    audit('RECORD_PAYMENT', 'Payment', i, {'status': d['status'], 'amount': d['amount']})
    return jsonify(data=q('SELECT * FROM payments WHERE id=?', (i,), one=True)), 201
@app.get('/api/payments/<i>')
def pay_get(i):
    p = q('SELECT * FROM payments WHERE id=?', (i,), one=True)
    if not p: raise Err(404, 'Payment not found')
    p['member'] = q('SELECT * FROM members WHERE id=?', (p['memberId'],), one=True)
    p['refunded'] = q("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE refund_of_id=? AND status='REFUNDED'", (i,), one=True)['s']
    p['remaining'] = round(p['amount'] - p['refunded'], 2) if p['status'] == 'PAID' else 0
    return jsonify(data=p, audit=q("SELECT * FROM audit_logs WHERE entity='Payment' AND entity_id=? ORDER BY created_at", (i,)))
@app.patch('/api/payments/<i>')       # PENDING -> PAID | FAILED, once, audit-logged
def pay_patch(i):
    st = (request.get_json(silent=True) or {}).get('status')
    if st not in ('PAID', 'FAILED'): raise Err(400, 'Validation failed', [{'path': ['status'], 'message': 'Invalid choice'}])
    c = ex("UPDATE payments SET status=?, paid_on=CASE WHEN ?='PAID' THEN ? ELSE paid_on END WHERE id=? AND status='PENDING'", (st, st, iso(today()), i))
    if not c.rowcount: raise Err(409, 'Only pending payments can be changed')
    audit('PAYMENT_STATUS', 'Payment', i, {'from': 'PENDING', 'to': st}); return jsonify(data=q('SELECT * FROM payments WHERE id=?', (i,), one=True))
@app.post('/api/payments/<i>/refund')   # full or partial: each refund is a NEW REFUNDED row linked to the original; total can never exceed the amount paid
def pay_refund(i):
    admin(); o = q('SELECT * FROM payments WHERE id=?', (i,), one=True); b = request.get_json(silent=True) or {}
    if not o: raise Err(404, 'Payment not found')
    if o['status'] != 'PAID': raise Err(409, 'Only paid payments can be refunded')
    key = f"refund:{i}:{b['idempotencyKey']}" if b.get('idempotencyKey') else None
    if key:
        dup = q('SELECT * FROM payments WHERE idempotency_key=?', (key,), one=True)
        if dup: return jsonify(data=dup, duplicate=True)
    done = q("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE refund_of_id=? AND status='REFUNDED'", (i,), one=True)['s']; left = round(o['amount'] - done, 2)
    if left <= 0: raise Err(409, 'Already fully refunded')
    try: amt = round(float(b['amount']), 2) if b.get('amount') not in (None, '') else left
    except (TypeError, ValueError): raise Err(400, 'Validation failed', [{'path': ['amount'], 'message': 'Enter a number'}])
    if amt <= 0 or amt > left: raise Err(400, 'Validation failed', [{'path': ['amount'], 'message': f'Enter an amount between 0.01 and {left:g}'}])
    r = insert('payments', {'memberId': o['memberId'], 'subscriptionId': o['subscriptionId'], 'amount': amt, 'currency': o['currency'], 'paidOn': iso(today()), 'method': o['method'],
        'status': 'REFUNDED', 'description': f"Refund of {o['receiptNo']}", 'refundOfId': i, 'idempotencyKey': key or f'refund:{i}:{done}', 'receiptNo': rcpt()})
    audit('REFUND', 'Payment', i, {'refundId': r, 'amount': amt, 'remaining': round(left - amt, 2)}); return jsonify(data=q('SELECT * FROM payments WHERE id=?', (r,), one=True), remaining=round(left - amt, 2)), 201

# ---------- renewals ----------
# Policy: active plan -> new period starts the day AFTER it ends; expired/none -> starts today (IST). expires_on is inclusive.
REN = {'memberId': ('id', 1), 'planId': ('id', 1), 'idempotencyKey': ('key', 1), 'method': (METHODS, 1), 'paymentStatus': ('enum:PAID|PENDING', 0)}
@app.post('/api/renewals')
def renew():
    b = parse(REN); dup = q('SELECT * FROM renewals WHERE idempotency_key=?', (b['idempotencyKey'],), one=True)
    if dup: return jsonify(data=dup, duplicate=True)
    plan = q('SELECT * FROM plans WHERE id=?', (b['planId'],), one=True)
    if not plan or not plan['isActive']: raise Err(400, 'Plan is unavailable')
    if not q('SELECT 1 AS x FROM members WHERE id=?', (b['memberId'],), one=True): raise Err(404, 'Member not found')
    t = today(); last = q("SELECT * FROM subscriptions WHERE member_id=? AND status='ACTIVE' ORDER BY expires_on DESC LIMIT 1", (b['memberId'],), one=True)
    early = bool(last and last['expiresOn'] >= iso(t)); start = date.fromisoformat(last['expiresOn']) + timedelta(1) if early else t
    sid = insert('subscriptions', {'memberId': b['memberId'], 'planId': plan['id'], 'planName': plan['name'], 'priceSnapshot': plan['price'], 'durationDaysSnapshot': plan['durationDays'],
        'startsOn': iso(start), 'expiresOn': iso(start + timedelta(plan['durationDays'] - 1))})
    pid = insert('payments', {'memberId': b['memberId'], 'subscriptionId': sid, 'amount': plan['price'] or 0.01, 'currency': CURRENCY, 'paidOn': iso(t), 'method': b['method'],
        'status': b.get('paymentStatus', 'PAID'), 'description': f"Renewal: {plan['name']}", 'idempotencyKey': 'pay-' + b['idempotencyKey'], 'receiptNo': rcpt()})
    rid = insert('renewals', {'idempotencyKey': b['idempotencyKey'], 'memberId': b['memberId'], 'subscriptionId': sid, 'wasEarly': early})
    audit('RENEW', 'Member', b['memberId'], {'subId': sid, 'paymentId': pid})
    return jsonify(data={'renewal': q('SELECT * FROM renewals WHERE id=?', (rid,), one=True), 'subscription': q('SELECT * FROM subscriptions WHERE id=?', (sid,), one=True)}), 201
@app.get('/api/renewals')   # ?within=7|15|30 (upcoming) | expired | recent (renewed in last 30 days)
def renewals_due():
    w = request.args.get('within', '30'); t = today()
    S = "SELECT s.*, m.id AS mid, m.full_name AS mn, m.code AS mc, m.phone AS mp FROM subscriptions s JOIN members m ON m.id=s.member_id "
    if w == 'expired':
        rows = q(S + "WHERE s.status='ACTIVE' AND s.expires_on<? AND s.id=(SELECT x.id FROM subscriptions x WHERE x.member_id=s.member_id AND x.status='ACTIVE' ORDER BY x.expires_on DESC LIMIT 1) ORDER BY s.expires_on DESC", (iso(t),))
    elif w == 'recent':
        rows = q(S + "JOIN renewals r ON r.subscription_id=s.id WHERE r.created_at>=? ORDER BY r.created_at DESC", (iso(t - timedelta(30)),))
    else:
        n = int(w) if w in ('7', '15', '30') else 30
        rows = q(S + "WHERE s.status='ACTIVE' AND s.expires_on>=? AND s.expires_on<=? ORDER BY s.expires_on", (iso(t), iso(t + timedelta(n))))
    for r in rows: r['member'] = {'id': r.pop('mid'), 'fullName': r.pop('mn'), 'code': r.pop('mc'), 'phone': r.pop('mp')}; r['daysLeft'] = (date.fromisoformat(r['expiresOn']) - t).days
    return jsonify(data=rows)
@app.post('/api/subscriptions/<i>/cancel')   # no auto-refund: record a REFUNDED payment separately
def sub_cancel(i):
    admin(); s = q('SELECT * FROM subscriptions WHERE id=?', (i,), one=True)
    if not s: raise Err(404, 'Subscription not found')
    if s['status'] == 'CANCELLED': raise Err(409, 'Already cancelled')
    ex("UPDATE subscriptions SET status='CANCELLED', cancelled_at=? WHERE id=?", (datetime.now(IST).isoformat(), i)); audit('CANCEL_SUBSCRIPTION', 'Subscription', i)
    return jsonify(data=q('SELECT * FROM subscriptions WHERE id=?', (i,), one=True))

# ---------- trainers ----------
TRAINER = {'fullName': ('str', 1), 'email': ('email', 1), 'phone': ('text', 0), 'specialization': ('str', 1), 'experienceYears': ('int0', 0), 'certifications': ('text', 0), 'notes': ('text', 0), 'isActive': ('bool', 0)}
@app.get('/api/trainers')
def trainers_list():
    a = request.args; w, args = ['1=1'], []
    if a.get('specialization'): w.append('LOWER(specialization)=LOWER(?)'); args.append(a['specialization'])
    if a.get('status'): w.append('is_active=?'); args.append(1 if a['status'] == 'active' else 0)
    return jsonify(data=q(f"SELECT t.*, (SELECT COUNT(*) FROM members m WHERE m.trainer_id=t.id) AS member_count FROM trainers t WHERE {' AND '.join(w)} ORDER BY full_name", args))
@app.post('/api/trainers')
def trainer_create(): admin(); i = insert('trainers', parse(TRAINER)); return jsonify(data=q('SELECT * FROM trainers WHERE id=?', (i,), one=True)), 201
@app.get('/api/trainers/<i>')
def trainer_get(i):
    t = q('SELECT * FROM trainers WHERE id=?', (i,), one=True)
    if not t: raise Err(404, 'Trainer not found')
    t['members'] = q('SELECT id, code, full_name, is_active FROM members WHERE trainer_id=? ORDER BY full_name', (i,)); return jsonify(data=t)
@app.patch('/api/trainers/<i>')
def trainer_patch(i): admin(); update('trainers', i, parse(TRAINER, True)); return jsonify(data=q('SELECT * FROM trainers WHERE id=?', (i,), one=True))
@app.post('/api/trainers/<i>/reassign')
def trainer_reassign(i):
    admin(); b = request.get_json(silent=True) or {}; to = b.get('toTrainerId') or None; ids = b.get('memberIds')
    if to and not q('SELECT 1 AS x FROM trainers WHERE id=? AND is_active=1', (to,), one=True): raise Err(400, 'Target trainer unavailable')
    if ids: c = ex(f"UPDATE members SET trainer_id=? WHERE trainer_id=? AND id IN ({','.join('?' * len(ids))})", [to, i, *ids])
    else: c = ex('UPDATE members SET trainer_id=? WHERE trainer_id=?', (to, i))
    audit('REASSIGN', 'Trainer', i, {'toTrainerId': to, 'moved': c.rowcount}); return jsonify(data={'moved': c.rowcount})
@app.delete('/api/trainers/<i>')
def trainer_delete(i):
    admin(); n = q('SELECT COUNT(*) AS n FROM members WHERE trainer_id=?', (i,), one=True)['n']
    if n: raise Err(409, f'Trainer still has {n} assigned member(s). Reassign them first.')
    ex('DELETE FROM trainers WHERE id=?', (i,)); return jsonify(data=True)

# ---------- dashboard + analytics (revenue = PAID - REFUNDED; PENDING = dues; FAILED ignored) ----------
def net(where='1=1', args=()):
    rows = q(f'SELECT status, SUM(amount) AS s FROM payments WHERE {where} GROUP BY status', args)
    s = lambda k: next((r['s'] for r in rows if r['status'] == k), 0) or 0
    return {'revenue': round(s('PAID') - s('REFUNDED'), 2), 'dues': round(s('PENDING'), 2)}
def live_members(extra='', args=()):
    return q(f"SELECT COUNT(DISTINCT member_id) AS n FROM subscriptions WHERE status='ACTIVE' AND expires_on>=? {extra}", (iso(today()), *args), one=True)['n']
@app.get('/api/dashboard/stats')
def stats():
    t = today(); som, prev = D(t.year, t.month), D(t.year, t.month - 1); total = q('SELECT COUNT(*) AS n FROM members', one=True)['n']; act = live_members()
    return jsonify(data={'totalMembers': total, 'activeMembers': act, 'expiringIn7Days': live_members('AND expires_on<=?', (iso(t + timedelta(7)),)),
        'monthlyRevenue': net('paid_on>=?', (iso(som),))['revenue'], 'previousMonthRevenue': net('paid_on>=? AND paid_on<?', (iso(prev), iso(som)))['revenue'],
        'outstandingDues': net()['dues'], 'retention': round(act / total * 100) if total else 0,
        'includesDemoData': bool(q('SELECT 1 AS x FROM members WHERE is_demo=1 LIMIT 1', one=True))})
@app.get('/api/dashboard/recent')
def recent():
    pj = "SELECT p.*, m.full_name AS mn FROM payments p JOIN members m ON m.id=p.member_id "
    def wrap_(rows):
        for r in rows: r['member'] = {'fullName': r.pop('mn')}
        return rows
    return jsonify(data={'payments': wrap_(q(pj + 'ORDER BY p.created_at DESC LIMIT 6')),
        'members': q('SELECT id, code, full_name, join_date FROM members ORDER BY created_at DESC LIMIT 6'),
        'dues': wrap_(q(pj + "WHERE p.status='PENDING' ORDER BY p.paid_on LIMIT 6"))})
def rng(a):
    t, r = today(), a.get('range'); y, m = t.year, t.month
    if r == 'last_month': return D(y, m - 1), D(y, m)
    if r == '3m': return D(y, m - 2), D(y, m + 1)
    if r == '6m': return D(y, m - 5), D(y, m + 1)
    if r == 'year': return date(y, 1, 1), date(y + 1, 1, 1)
    if r == 'custom':
        try: f, e = date.fromisoformat(a['from']), date.fromisoformat(a['to']) + timedelta(1)
        except (KeyError, ValueError): raise Err(400, 'Invalid custom range')
        if e <= f: raise Err(400, 'Invalid custom range')
        return f, e
    return D(y, m), D(y, m + 1)
def months(f, e):
    d, out = f.replace(day=1), []
    while d < e: out.append(d); d = D(d.year, d.month + 1)
    return out
@app.get('/api/analytics/revenue')
def a_rev():
    f, e = rng(request.args); ms = {d.strftime('%Y-%m'): {'month': d.strftime('%Y-%m'), 'revenue': 0, 'dues': 0} for d in months(f, e)}; bp = {}
    for p in q("SELECT p.amount, p.status, p.paid_on, COALESCE(s.plan_name,'Unlinked') AS plan FROM payments p LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE p.paid_on>=? AND p.paid_on<?", (iso(f), iso(e))):
        row = ms.get(p['paidOn'][:7]); sign = {'PAID': 1, 'REFUNDED': -1}.get(p['status'])
        if not row: continue
        if sign: row['revenue'] += sign * p['amount']; bp[p['plan']] = bp.get(p['plan'], 0) + sign * p['amount']
        elif p['status'] == 'PENDING': row['dues'] += p['amount']
    L = [{**m, 'revenue': round(m['revenue'], 2), 'dues': round(m['dues'], 2)} for m in ms.values()]
    return jsonify(data={'range': {'from': iso(f), 'to': iso(e)}, 'months': L, 'byPlan': [{'plan': k, 'revenue': round(v, 2)} for k, v in bp.items()],
        'totals': {'revenue': round(sum(m['revenue'] for m in L), 2), 'dues': round(sum(m['dues'] for m in L), 2)}})
@app.get('/api/analytics/memberships')
def a_mem():
    f, e = rng(request.args); t = today(); mem, subs = q('SELECT id, join_date FROM members'), q('SELECT * FROM subscriptions'); out = []
    for d in months(f, e):
        end = D(d.year, d.month + 1) - timedelta(1); ei, ai, k = iso(end), iso(min(end, t)), d.strftime('%Y-%m')
        total = sum(m['joinDate'] <= ei for m in mem); act = len({s['memberId'] for s in subs if s['status'] == 'ACTIVE' and s['startsOn'] <= ai <= s['expiresOn']})
        out.append({'month': k, 'totalMembers': total, 'newMembers': sum(m['joinDate'][:7] == k for m in mem), 'cancellations': sum(bool(s['cancelledAt']) and s['cancelledAt'][:7] == k for s in subs),
                    'activeMembers': act, 'retentionPct': round(act / total * 100) if total else 0})
    ended = [s for s in subs if s['status'] == 'ACTIVE' and iso(f) <= s['expiresOn'] < iso(e) and s['expiresOn'] < iso(t)]
    renewed = [s for s in ended if any(o['id'] != s['id'] and o['memberId'] == s['memberId'] and o['status'] == 'ACTIVE' and s['startsOn'] < o['startsOn'] <= iso(date.fromisoformat(s['expiresOn']) + timedelta(8)) for o in subs)]
    live = {s['memberId'] for s in subs if s['status'] == 'ACTIVE' and s['expiresOn'] >= iso(t)}
    return jsonify(data={'range': {'from': iso(f), 'to': iso(e)}, 'months': out, 'renewal': {'ended': len(ended), 'renewed': len(renewed), 'ratePct': round(len(renewed) / len(ended) * 100) if ended else None},
                         'activeVsExpired': {'active': len(live), 'expired': max(0, len(mem) - len(live))}})
@app.get('/api/analytics/trainers')
def a_trainers():
    return jsonify(data=q('SELECT t.id, t.full_name AS name, COUNT(m.id) AS members FROM trainers t LEFT JOIN members m ON m.trainer_id=t.id WHERE t.is_active=1 GROUP BY t.id ORDER BY t.full_name'))

# ---------- notifications (in-app only; nothing is emailed or texted) ----------
def sync_notifications(u):
    p = q('SELECT * FROM user_preferences WHERE user_id=?', (u,), one=True); t = today(); items = []
    if not p or p['notifyExpiry']:
        for s in q("SELECT s.*, m.full_name AS mn FROM subscriptions s JOIN members m ON m.id=s.member_id WHERE s.status='ACTIVE' AND s.expires_on>=? AND s.expires_on<=?", (iso(t), iso(t + timedelta(7)))):
            items.append(('EXPIRY', f"{u}:exp:{s['id']}", f"{s['mn']}'s {s['planName']} membership expires on {s['expiresOn']}"))
    if not p or p['notifyDues']:
        for y in q("SELECT y.*, m.full_name AS mn FROM payments y JOIN members m ON m.id=y.member_id WHERE y.status='PENDING' AND y.paid_on<=?", (iso(t - timedelta(7)),)):
            items.append(('DUES', f"{u}:due:{y['id']}", f"Overdue payment of {y['currency']} {y['amount']:g} from {y['mn']}"))
    for ty, key, msg in items: ex('INSERT OR IGNORE INTO notifications(id,user_id,type,dedupe_key,message) VALUES(?,?,?,?,?)', (uid(), u, ty, key, msg))
@app.get('/api/notifications')
def notes():
    u = session['u']['id']; sync_notifications(u)
    return jsonify(data=q('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50', (u,)), meta={'unread': q('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL', (u,), one=True)['n']})
@app.post('/api/notifications/read-all')
def notes_read_all(): ex("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL", (session['u']['id'],)); return jsonify(data=True)
@app.post('/api/notifications/<i>/read')
def notes_read(i): ex("UPDATE notifications SET read_at=datetime('now') WHERE id=? AND user_id=?", (i, session['u']['id'])); return jsonify(data=True)
@app.get('/api/notifications/preferences')
def prefs_get(): return jsonify(data=q('SELECT * FROM user_preferences WHERE user_id=?', (session['u']['id'],), one=True) or {})
@app.put('/api/notifications/preferences')
def prefs_put():
    d = parse({'theme': ('enum:light|dark|system', 0), 'accent': ('text', 0), 'notifyExpiry': ('bool', 0), 'notifyDues': ('bool', 0)}, True)
    if 'accent' in d and not re.match(r'^#[0-9a-fA-F]{6}$', d['accent']): raise Err(400, 'Validation failed', [{'path': ['accent'], 'message': 'Use #RRGGBB'}])
    u = session['u']['id']; ex('INSERT OR IGNORE INTO user_preferences(user_id) VALUES(?)', (u,))
    if d: ex(f"UPDATE user_preferences SET {','.join(snake(k) + '=?' for k in d)} WHERE user_id=?", [*(int(v) if isinstance(v, bool) else v for v in d.values()), u])
    return jsonify(data=q('SELECT * FROM user_preferences WHERE user_id=?', (u,), one=True))

# ---------- audit log + staff accounts (admin only) ----------
@app.get('/api/audit')
def audit_list():
    admin(); a = request.args; W, p = (' WHERE a.entity=?', [a['entity']]) if a.get('entity') else ('', []); pg = max(1, int(a.get('page', 1))); sz = 15
    total = q(f'SELECT COUNT(*) AS n FROM audit_logs a{W}', p, one=True)['n']
    rows = q(f'SELECT a.id, a.action, a.entity, a.entity_id, a.meta, a.created_at, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id{W} ORDER BY a.created_at DESC, a.rowid DESC LIMIT ? OFFSET ?', p + [sz, (pg - 1) * sz])
    for r in rows: r['meta'] = json.loads(r['meta']) if r['meta'] else None
    return jsonify(data=rows, meta={'total': total, 'page': pg, 'pageSize': sz})
@app.get('/api/users')
def users_list(): admin(); return jsonify(data=q('SELECT id, name, email, role, created_at FROM users ORDER BY created_at'))
def pw_ok(pw):
    if len(str(pw or '')) < 10: raise Err(400, 'Validation failed', [{'path': ['password'], 'message': 'Use at least 10 characters'}])
@app.post('/api/users')
def user_create():
    admin(); d = parse({'name': ('str', 1), 'email': ('email', 1), 'role': ('enum:ADMIN|STAFF', 1)}); pw = (request.get_json(silent=True) or {}).get('password'); pw_ok(pw); i = uid()
    ex('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)', (i, d['name'], d['email'], generate_password_hash(str(pw)), d['role'])); audit('USER_CREATE', 'User', i, {'role': d['role']}); return jsonify(data={'id': i}), 201
@app.patch('/api/users/<i>')
def user_edit(i):
    admin(); d = parse({'name': ('str', 0), 'role': ('enum:ADMIN|STAFF', 0)}, True); pw = (request.get_json(silent=True) or {}).get('password'); u = q('SELECT * FROM users WHERE id=?', (i,), one=True)
    if not u: raise Err(404, 'User not found')
    if d.get('role') and d['role'] != u['role'] and (i == session['u']['id'] or (u['role'] == 'ADMIN' and q("SELECT COUNT(*) AS n FROM users WHERE role='ADMIN'", one=True)['n'] <= 1)): raise Err(409, 'You cannot change your own role or demote the last admin')
    if pw: pw_ok(pw)
    sets, args = [f'{k}=?' for k in d], list(d.values())
    if pw: sets.append('password_hash=?'); args.append(generate_password_hash(str(pw)))
    if sets: ex(f"UPDATE users SET {','.join(sets)} WHERE id=?", args + [i])
    audit('USER_UPDATE', 'User', i, {'fields': [*d, *(['password'] if pw else [])]}); return jsonify(data=True)
@app.delete('/api/users/<i>')
def user_delete(i):
    admin()
    if i == session['u']['id']: raise Err(409, 'You cannot remove your own account')
    ex('DELETE FROM users WHERE id=?', (i,)); audit('USER_DELETE', 'User', i); return jsonify(data=True)

# ---------- CSV export / import ----------
def csv_response(name, rows, cols):
    buf = io.StringIO(); w = csv.writer(buf); w.writerow(cols)
    for r in rows:   # leading = + - @ get a quote prefix to block spreadsheet formula injection
        w.writerow([("'" + v if isinstance(v, str) and v and v[0] in '=+-@\t\r' else v) for v in (('' if r.get(c) is None else r.get(c)) for c in cols)])
    return Response(buf.getvalue(), mimetype='text/csv', headers={'Content-Disposition': f'attachment; filename="{name}"'})
@app.get('/api/transfer/members.csv')
def export_members():
    rows = q('SELECT m.*, t.full_name AS trainer FROM members m LEFT JOIN trainers t ON t.id=m.trainer_id ORDER BY m.code')
    return csv_response('members.csv', rows, ['code', 'fullName', 'email', 'phone', 'joinDate', 'trainer', 'isActive'])
@app.get('/api/transfer/payments.csv')
def export_payments():
    w, args = '1=1', []
    if request.args.get('range'): f, e = rng(request.args); w, args = 'p.paid_on>=? AND p.paid_on<?', [iso(f), iso(e)]
    rows = q(f'SELECT p.*, m.code AS member_code FROM payments p JOIN members m ON m.id=p.member_id WHERE {w} ORDER BY p.paid_on DESC', args)
    return csv_response('payments.csv', rows, ['receiptNo', 'memberCode', 'amount', 'currency', 'paidOn', 'method', 'status', 'description'])
@app.post('/api/transfer/members')   # CSV columns: fullName,email,phone
def import_members():
    admin(); rows = list(csv.DictReader(io.StringIO(request.get_data(as_text=True))))
    if not rows: raise Err(400, 'No rows found')
    if len(rows) > 500: raise Err(400, 'Max 500 rows per import')
    ok, errs = 0, []
    for n, raw in enumerate(rows, 2):
        try: d = parse({k: MEMBER[k] for k in ('fullName', 'email', 'phone')}, body={k.strip(): (v or '').strip() for k, v in raw.items() if k})
        except Err as e: errs.append({'row': n, 'error': '; '.join(f"{x['path'][0]}: {x['message']}" for x in e.details or [])}); continue
        try: create_member(d); ok += 1
        except sqlite3.IntegrityError: errs.append({'row': n, 'error': 'Duplicate email or phone'})
    return jsonify(data={'imported': ok, 'errors': errs}), (400 if errs and not ok else 200)

# ---------- setup ----------
def init_db():
    c = sqlite3.connect(DB_PATH); c.executescript(SCHEMA)
    if not c.execute('SELECT 1 FROM users').fetchone():
        pw = os.environ.get('IRONFLOW_ADMIN_PASSWORD') or secrets.token_urlsafe(9)
        c.execute('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)', (uid(), 'Admin', 'admin@ironflow.local', generate_password_hash(pw), 'ADMIN'))
        for n, d, p, b in [('Day Pass', 1, 200, ['Gym floor']), ('Monthly', 30, 1500, ['Gym floor', 'Locker']), ('Quarterly', 90, 4000, ['Gym floor', 'Locker', 'Diet chart']),
                           ('Half-Yearly', 182, 7500, ['All Quarterly', 'Trainer sessions']), ('Annual', 365, 13000, ['All Half-Yearly', 'Guest passes'])]:
            c.execute('INSERT INTO plans(id,name,duration_days,price,benefits) VALUES(?,?,?,?,?)', (uid(), n, d, p, json.dumps(b)))
        t = uid(); c.execute('INSERT INTO trainers(id,full_name,email,specialization,experience_years) VALUES(?,?,?,?,?)', (t, 'Arjun Mehta', 'arjun@ironflow.local', 'Strength', 6))
        c.execute('INSERT INTO members(id,code,full_name,email,phone,join_date,is_demo,trainer_id) VALUES(?,?,?,?,?,?,1,?)', (uid(), 'IF-DEMO1', 'Demo Member (sample)', 'demo1@example.com', '9000000001', iso(today()), t))
        c.commit(); print(f'\n*** First run: sign in as admin@ironflow.local  password: {pw}  (shown once — save it) ***\n')
    c.close()
init_db()
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT', 5000)), debug=False)
