# Walkthrough: how this project was built, stage by stage

Use this to learn the project and to explain every decision in the interview. For each stage: **objective → concepts → files → how to check it → common errors**.

## Stage 1 - Requirements analysis
**Objective:** know exactly what to build.
- *Functional:* clients, loans, repayments, dashboard, search, history, balances.
- *Non-functional:* correct money maths, data integrity, simple code, responsive UI, safe errors, tests.
- *Architecture:* browser (HTML/CSS/JS) ⇄ REST/JSON ⇄ Express (routes → services) ⇄ SQLite file.

**Concepts:** *REST API* = URLs + HTTP verbs (GET reads, POST creates) returning JSON. *Business rule* = a "must always be true" statement, e.g. repayment ≤ balance.

## Stage 2 - Environment setup
```bash
node -v && npm -v          # expect v18+ 
npm init -y                # creates package.json (the project's manifest)
npm i express better-sqlite3 jsonwebtoken bcryptjs dotenv
npm i -D supertest         # -D = only needed for development/testing
```
| Package | Why it is needed |
|---|---|
| express | Receives HTTP requests and routes them |
| better-sqlite3 | Talks to SQLite; synchronous API = simple code, easy transactions |
| jsonwebtoken | Creates/verifies login tokens (JWT) |
| bcryptjs | One-way password hashing |
| dotenv | Reads settings from `.env` |
| exceljs | Reads and writes Excel workbooks |
| supertest | Calls the API inside tests without opening a real port |

**Error:** `npm: command not found` → install Node.js LTS from nodejs.org, reopen the terminal.

## Stage 3 - Database (`backend/db/schema.sql`)
**Concepts:** *primary key* identifies a row; *foreign key* points to a row in another table; *UNIQUE* forbids duplicates; *CHECK* rejects bad values; *index* speeds lookups; *trigger* runs automatically on insert.
- Client, loan, repayment, loan-request, and user tables.
- Money columns are `INTEGER` (KES). Floating-point numbers cannot represent values like 0.1 exactly; integers can.
- `PRAGMA foreign_keys = ON` in `backend/db/database.js` - SQLite ignores foreign keys otherwise.
- Existing databases are migrated on startup to add client roles, contact details, and loan requests.
- The trigger blocks overpayment even if someone writes raw SQL.

**Check:** `npm test` includes tests that insert bad data directly and expect the database to refuse.

## Stage 4 - Backend
**Files & roles**
- `server.js` → starts listening. `backend/app.js` → assembles Express.
- `backend/routes/index.js` → one line per endpoint; calls a service.
- `backend/services/*.js` → **the rules and SQL**. `repaymentService.recordRepayment` is the most important function in the project.
- `backend/middleware/auth.js` → reads `Authorization: Bearer <token>`, verifies it, and checks roles. `errorHandler.js` → turns errors into JSON.
- `backend/utils/validators.js` → `parseKes` (whole positive shillings), `parseDate`, `parseCode`, etc.

**`recordRepayment` step by step**
1. Validate input shape (amount integer > 0, reference text, real date).
2. Open a transaction (`BEGIN IMMEDIATE`).
3. Load the loan with its calculated balance → 404 if missing.
4. Reference already used? → 409.
5. Amount > outstanding? → 422.
6. Insert. Commit. (Any thrown error = automatic rollback, nothing saved.)
7. Return the new repayment + updated loan.

**Concepts:** *transaction* = all steps succeed or none do. *Parameterised query* (`WHERE id = ?`) = values are never pasted into SQL text, which prevents SQL injection. *Hashing* (bcrypt) = store a one-way scrambled password with a random salt; to log in, hash the attempt and compare. *JWT* = a signed token proving "this user logged in"; the server trusts it only if the signature matches `JWT_SECRET`.

**Check:** `npm start`, then `curl localhost:3000/api/health` → `{"success":true,"data":{"status":"ok"}}`.

**Errors:** `401` = missing/expired token. `400` = your input failed validation (read `error.message`). `EADDRINUSE` = port taken.

## Stage 5 - Frontend (`frontend/`)
- `index.html` = page skeleton (login view + app shell). `css/style.css` = navy/green design, CSS variables at the top, `@media` rules for tablet/phone. `js/app.js` = everything dynamic.
- *Single-page app with hash routing:* URLs like `#/loans/3`; the `hashchange` event calls `route()`, which fetches data via `api()` and writes HTML.
- Every value placed into HTML passes through `esc()` to prevent XSS (injected scripts).
- The browser calls `fetch('/api/...')` with the token from `sessionStorage`.

## Stage 6 - Testing
`npm test` runs `tests/*.test.js`. Each test builds a **fresh in-memory database**, so tests are independent and never touch `data/inuka.db`. Mandatory scenarios are in `tests/scenarios.test.js`.
**Reading output:** `✔` pass, `✖` fail with expected vs actual values. If a test fails, read the first assertion message - it names the line.

## Stage 7 - Finalisation checklist
- [x] Screenshots in `docs/screenshots/`
- [x] README, API docs, demo guide
- [ ] Push to GitHub (below)
```bash
git init && git add . && git commit -m "Inuka Africa loan tracker"
git branch -M main
git remote add origin https://github.com/<you>/inuka-loan-tracker.git
git push -u origin main
```
`.gitignore` already excludes `node_modules`, `.env` and the database - never commit those.
