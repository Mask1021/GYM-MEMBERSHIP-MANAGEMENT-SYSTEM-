-- Members and days left on their latest active plan
SELECT m.code, m.full_name, s.plan_name, s.expires_on, CAST(julianday(s.expires_on) - julianday('now', '+5.5 hours') AS INTEGER) AS days_left FROM members m JOIN subscriptions s ON s.member_id = m.id AND s.status = 'ACTIVE' WHERE s.expires_on = (SELECT MAX(x.expires_on) FROM subscriptions x WHERE x.member_id = m.id AND x.status = 'ACTIVE') ORDER BY s.expires_on;

-- Net revenue per month (paid minus refunded; pending and failed excluded)
SELECT substr(paid_on, 1, 7) AS month, SUM(CASE status WHEN 'PAID' THEN amount WHEN 'REFUNDED' THEN -amount ELSE 0 END) AS net_revenue FROM payments GROUP BY month ORDER BY month;

-- Outstanding dues per member
SELECT m.code, m.full_name, SUM(p.amount) AS due FROM payments p JOIN members m ON m.id = p.member_id WHERE p.status = 'PENDING' GROUP BY m.id HAVING due > 0 ORDER BY due DESC;

-- Trainer workload (includes trainers with no members)
SELECT t.full_name, COUNT(m.id) AS members FROM trainers t LEFT JOIN members m ON m.trainer_id = t.id WHERE t.is_active = 1 GROUP BY t.id ORDER BY members DESC;

-- Net revenue by plan
SELECT s.plan_name, SUM(CASE p.status WHEN 'PAID' THEN p.amount ELSE -p.amount END) AS net FROM payments p JOIN subscriptions s ON s.id = p.subscription_id WHERE p.status IN ('PAID', 'REFUNDED') GROUP BY s.plan_name ORDER BY net DESC;

-- Members with no live membership (NOT EXISTS)
SELECT code, full_name FROM members m WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.member_id = m.id AND s.status = 'ACTIVE' AND s.expires_on >= date('now', '+5.5 hours'));

-- Refundable balance per paid payment
SELECT p.receipt_no, p.amount, COALESCE((SELECT SUM(r.amount) FROM payments r WHERE r.refund_of_id = p.id AND r.status = 'REFUNDED'), 0) AS refunded FROM payments p WHERE p.status = 'PAID';
