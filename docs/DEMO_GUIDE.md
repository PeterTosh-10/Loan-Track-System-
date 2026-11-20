# Demonstration guide (10 minutes) and interview preparation

## Before you present
```bash
npm install && npm run setup
npm run create-user -- demo "demo-password-1"
npm run seed       # optional demo data
npm start
```
Have a terminal and the browser at http://localhost:3000 side by side.

## Demo script
1. **(1 min) What it is.** "A small loan repayment tracker: clients, loans, repayments, balances. Express + SQLite + vanilla JS."
2. **(1 min) Dashboard.** Point out every figure comes from SQL aggregates.
3. **(1 min) Register a client.** Show auto client number, then try a duplicate number → rejected.
4. **(1 min) Create a loan.** Auto reference `LN-00000X`. Try total due < loan amount → rejected.
5. **(3 min) The three scenarios, live.** Repayments page:
   - Loan with balance 10,000 → pay 3,000 → balance **7,000**.
   - Re-submit the same payment reference → **rejected**, history unchanged.
   - Loan with balance 1,000 → pay 1,500 → **rejected**, balance still 1,000.
6. **(1 min) Fully paid.** Pay the remainder → status turns *Fully Paid*; another payment is refused.
7. **(1 min) Proof.** `npm test` → all green. Restart the server → data still there.
8. **(1 min) Honest limits.** Basic login only; not production ready (see README).

## Interview Q&A
**Why integers for money?** Floating-point can't store values like 0.1 exactly, so sums drift. Whole shillings as integers are exact. If cents were needed I'd store the smallest unit.

**Why not store the outstanding balance in a column?** A stored balance can get out of sync with repayments. Calculating `total_due − SUM(repayments)` each time guarantees correctness.

**How do you stop duplicate payment references?** Two layers: the service checks first (friendly 409 message) and the database has a UNIQUE constraint (the real guarantee, also safe if two requests race).

**How do you stop overpayment, even with simultaneous requests?** The balance check and insert run in one `BEGIN IMMEDIATE` transaction, so the second request waits and sees the updated balance. A database trigger is a last backstop. A test fires three concurrent payments and only one succeeds.

**What is a transaction?** A group of statements that all succeed or all fail together.

**SQL injection?** All queries use `?` placeholders; user text is never concatenated into SQL. Search text additionally has `%`/`_` escaped. There's a test with `' OR 1=1 --`.

**How does login work?** Password verified against a bcrypt hash → server signs a JWT containing the user id with `JWT_SECRET` → browser sends it as `Authorization: Bearer` → middleware verifies the signature and expiry.

**Why bcrypt?** Slow, salted, one-way hashing makes stolen hashes costly to crack. Plain/fast hashes (MD5, SHA) are unsuitable for passwords.

**Why SQLite / better-sqlite3?** Zero setup, a single file, ideal for a small app. better-sqlite3 is synchronous, which makes transactions simple and (for this scale) fast. Limitation: one writer at a time and no network access - move to PostgreSQL for a multi-user production system.

**Why separate routes and services?** Routes handle HTTP only; services hold the rules, so the rules can be tested without HTTP and reused by scripts (the seed script uses the same services).

**Why vanilla JS?** The brief asked for HTML/CSS/JS and a beginner-friendly stack; no build tooling to explain. Trade-off: more manual DOM code than React.

**What would you add next?** Roles/permissions, audit log (who recorded what), reversal entries instead of edits, interest/schedule rules once specified, pagination, login rate limiting, HTTPS, scheduled backups, CI running `npm test`.

**What did you intentionally not do?** Assume interest rates or repayment schedules (brief said not to), allow editing/deleting repayments, claim production readiness.

**Why `total_due ≥ loan_amount`?** A client can't owe less than they borrowed; the excess is interest/fees staff enter explicitly.

**HTTP status codes you used?** 200/201 success, 400 validation, 401 not logged in, 404 missing, 409 duplicate, 422 business-rule violation, 500 unexpected.
