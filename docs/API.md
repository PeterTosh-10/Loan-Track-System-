# API reference

Base URL: `http://localhost:3000/api`. All bodies are JSON. Money is an **integer number of KES**.

**Auth:** every endpoint except `GET /health`, `POST /auth/login`, and `POST /auth/register` needs `Authorization: Bearer <token>`. Staff authenticate with their username; clients use their email.

**Response envelope**
```json
{ "success": true,  "data": { } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Human readable text" } }
```
| Status | Code | Meaning |
|---|---|---|
| 200 / 201 | | OK / Created |
| 400 | `VALIDATION_ERROR`, `BAD_JSON` | Invalid input |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | Missing/bad token or login |
| 403 | `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED` | Wrong role or temporary password not changed |
| 404 | `NOT_FOUND` | Client / loan / endpoint not found |
| 409 | `CONFLICT` | Duplicate client number or payment reference |
| 422 | `BUSINESS_RULE_VIOLATION` | Overpayment, or loan already fully paid |
| 500 | `INTERNAL_ERROR` | Unexpected; details only in server log |

## Auth
**POST /auth/login** `{ "username": "...", "password": "..." }` (staff) or `{ "email": "...", "password": "..." }` (client) → session token and user role. Imported clients must call `POST /auth/change-password` with `{ "password": "..." }` before using other authenticated endpoints.
**POST /auth/register** `{ "full_name": "...", "phone": "...", "email": "...", "password": "..." }` → 201 and a client session.
**GET /auth/me** → `{ id, username, role, client_id, must_change_password }`.

## Client portal
**GET /client/profile** → the signed-in client's profile and loans.
**POST /client/loan-requests** `{ "requested_amount": 25000, "purpose": "Business stock" }` → 201 pending request. Clients can only view their own requests.
**GET /client/loan-requests** → the signed-in client's requests and decision status.

## Staff review and client spreadsheets
All endpoints below require the staff/admin role.
**GET /admin/loan-requests?status=pending|approved|rejected** → loan requests with client details.
**POST /admin/loan-requests/:id/approve** `{ "loan_amount": 20000, "total_due": 22000, "created_at": "2026-11-14", "review_note": "Optional" }` → approves the request and creates the loan atomically.
**POST /admin/loan-requests/:id/reject** `{ "review_note": "Optional" }` → rejects a pending request.
**POST /clients/import** JSON `{ "file_name": "clients.csv", "data": "<base64 file bytes>" }` → imports up to 100 `.csv` or `.xlsx` rows. Required columns: `Full name`, `Phone number`, `Email`; optional `Client number`. A matching client number updates that existing record; otherwise the import creates a record. The all-or-nothing response includes one-time temporary passwords. Clients must change these at first sign-in.
**GET /clients/export?format=csv|xlsx** → downloads client number, full name, phone, and email. Passwords are never exported.

## Clients
**POST /clients** `{ "full_name": "Amina Wanjiru", "client_number": "CL-100" }` (`client_number` optional - auto `CL-0001`…) → 201 client. 409 if number exists.
**GET /clients?search=text** → list (`id, client_number, full_name, phone, email, created_at, loan_count`); search matches name, number, phone, or email.
**GET /clients/:id** → client + `loans[]` (each with `total_repaid`, `outstanding_balance`, `status`).

## Loans
**POST /loans** `{ "client_id": 1, "loan_amount": 50000, "total_due": 56000, "created_at": "2026-11-13" }` (`created_at` optional, default today) → 201 loan with generated `loan_reference`.
Rules: amounts positive whole numbers; `total_due >= loan_amount`; client must exist (404).
**GET /loans?search=&status=outstanding|paid** → list.
**GET /loans/:id** → loan + client info + `repayments[]` (each with `balance_after`).
**GET /loans/:id/repayments** → `{ loan, repayments[] }`.

Loan object: `id, loan_reference, client_id, client_number, client_name, loan_amount, total_due, created_at, total_repaid, outstanding_balance, status`.

## Repayments
**POST /repayments** `{ "loan_id": 1, "amount": 3000, "payment_reference": "MPESA-QK81A2", "payment_date": "2026-11-13" }`
→ 201 `{ repayment, loan }` where `loan` shows the new `outstanding_balance`.
Rejections: amount ≤ 0 or not an integer (400); bad date/reference (400); loan missing (404); duplicate reference (409); amount > outstanding or loan fully paid (422). A rejected request changes nothing.
**GET /repayments** → latest 200 repayments with loan reference, client name and `balance_after`.

## Dashboard
**GET /dashboard** →
```json
{ "total_clients": 6, "total_loans": 5, "total_loan_amount_issued": 201000, "total_amount_due": 221000,
  "total_repayments_received": 81000, "total_outstanding_balance": 140000,
  "fully_paid_loans": 1, "outstanding_loans": 4, "recent_repayments": [ ] }
```

## Quick curl example
```bash
TOKEN=$(curl -s localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"yourname","password":"your-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')
curl -s localhost:3000/api/dashboard -H "Authorization: Bearer $TOKEN"
```
