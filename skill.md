# LandTrack — MVP 1 Development Specification (Agent-Ready)
**Version 1.3 | October 2026 | Confidential**

> **Instructions to the coding agent.** This file is the single source of truth for building LandTrack MVP 1. Build exactly what is described here, in the order given in Section 15. Use TypeScript in strict mode everywhere. Where a detail is marked **Default**, implement that default and make it configurable. Do not add features marked out of scope. Do not invent costing, pricing or vendor lock-in; every external service sits behind an interface so it can be swapped.

---

## 1. Product Summary

**LandTrack** is a web portal for Non-Resident Indians (NRIs) to register land and properties in **Hyderabad, Telangana (MVP 1 launch region only)**, pay a minimum registration charge online, and communicate with a Hyderabad-based agent through appointments, in-portal chat, WhatsApp and browser audio/video calls. Admin assigns agents. An Auditor dashboard gives read-only visibility of properties, payments and all communication.

**Modules**
1. **User (NRI) portal**
2. **Admin portal** (full access)
3. **Audit dashboard** (read-only; includes property details and communication audit)
4. **Agent** self-registration plus a minimal agent area (assigned appointments, chat, calls)

---

## 2. MVP 1 Scope

### In scope
- NRI registration with origin country, current country, mobile OTP verification, WhatsApp opt-in
- Agent self-registration, Admin approval
- Property registration with state, city, district, taluka, village, details and document upload
- Registration charge payment via a payment gateway (hosted checkout and webhook)
- Appointment booking by calendar date, time slot and mode (AUDIO, VIDEO, SITE_VISIT)
- Email to Admin on every appointment request; Admin assigns an agent
- WhatsApp notifications (opt-in, template based) and two-way reply capture
- In-portal real-time chat (NRI, agent, Admin) with attachments
- Audio and video calls in the browser tied to appointments, with call records and optional recording
- Admin portal with full access
- Audit dashboard (read-only) including communication audit
- Hyderabad-only location masters

### Out of scope (do not build)
Other cities or states, mobile apps, agent site-audit checklist and photo reports, buyer or tenant marketplace and public listings, e-sign, rent collection, agent commissions, AI assistant, document OCR, costing or billing modules.

---

## 3. Technology Stack (Decided)

Decision basis: React with TypeScript has the larger hiring pool and component ecosystem; Angular is a valid but unused alternative for role-heavy portals. On the backend, Node with NestJS (or Java Spring) with PostgreSQL are both viable; **this build uses NestJS**, with PostgreSQL and object storage for documents and images.

| Layer | Use | Not used (alternatives noted) |
|---|---|---|
| Frontend framework | **React 18 + TypeScript (strict)**, built with **Next.js (App Router)** so public pages can be SEO-friendly later | Angular |
| UI | Tailwind CSS + shadcn/ui (Radix) components; light theme, blue primary | |
| Forms and validation | React Hook Form + Zod (schemas shared with backend) | |
| Server state | TanStack Query | |
| Client state | Zustand (minimal) | |
| Calendar and slots | FullCalendar or a custom slot picker | |
| Charts | Apache ECharts | |
| Maps | Leaflet + OpenStreetMap tiles | Google Maps |
| Realtime client | socket.io-client | |
| Video client | Jitsi IFrame API | |
| i18n | i18next (English first) | |
| Backend | **Node.js 20 + NestJS (TypeScript)**, REST + OpenAPI (Swagger), WebSocket gateway (Socket.IO) | Java Spring |
| ORM and migrations | Prisma | |
| Database | **PostgreSQL 16** | |
| Cache, queue, pub/sub | Redis 7, BullMQ | |
| Object storage | **S3-compatible** (MinIO locally, S3 in India region in cloud), presigned URLs, server-side encryption | |
| Auth | Custom NestJS auth: OTP + password, JWT access and rotating refresh tokens, RBAC guards, TOTP MFA for Admin and Auditor | |
| Password hashing | argon2 | |
| Email | SMTP via Nodemailer (provider-agnostic; Amazon SES in cloud) | |
| SMS OTP | `SmsProvider` interface; default adapter for an international SMS provider | |
| WhatsApp | `WhatsAppProvider` interface; WhatsApp Business Platform (Cloud API) adapter | |
| Payments | `PaymentProvider` interface; default adapter **Razorpay** (hosted checkout + signed webhook); adapters for Cashfree or PayU possible | |
| Audio and video | Jitsi Meet (self-hosted) with JWT auth and coturn TURN; Jibri for optional recording | LiveKit |
| Virus scan | ClamAV | |
| Testing | Vitest and React Testing Library (web), Jest and Supertest (api), Playwright (E2E) | |
| Lint and format | ESLint, Prettier, Husky, lint-staged | |
| Containers | Docker, docker-compose for local development | |
| CI | GitHub Actions (lint, test, build, Trivy, Gitleaks, npm audit) | |
| Observability | OpenTelemetry, Prometheus metrics endpoint, structured JSON logs (pino), Sentry hook | |

**Compliance note (for humans, not code):** property ownership and cross-border rules (NRI property transaction rules, data protection, document verification, call recording consent) must be confirmed by a legal advisor before launch.

---

## 4. Repository Layout (Monorepo, pnpm workspaces)

```
landtrack/
├─ apps/
│  ├─ web/                  # Next.js app (NRI, Agent, Admin, Auditor UIs)
│  │  ├─ app/               # routes (see Section 10)
│  │  ├─ components/
│  │  ├─ lib/               # api client, auth, socket, jitsi helpers
│  │  └─ styles/
│  └─ api/                  # NestJS app
│     ├─ src/
│     │  ├─ main.ts
│     │  ├─ app.module.ts
│     │  ├─ common/         # guards, decorators, interceptors, filters, pipes
│     │  ├─ config/         # env validation (zod)
│     │  ├─ modules/
│     │  │  ├─ auth/ users/ consents/ agents/ masters/ properties/
│     │  │  ├─ documents/ payments/ appointments/ slots/
│     │  │  ├─ chat/ calls/ whatsapp/ notifications/
│     │  │  ├─ admin/ audit/ settings/
│     │  │  └─ health/
│     │  ├─ providers/      # sms, whatsapp, payment, email, storage, jitsi (interfaces + adapters)
│     │  └─ jobs/           # BullMQ processors
│     ├─ prisma/            # schema.prisma, migrations, seed.ts
│     └─ test/
├─ packages/
│  └─ shared/               # zod schemas, enums, types shared by web and api
├─ infra/
│  ├─ docker-compose.yml    # postgres, redis, minio, clamav, mailhog, jitsi (dev)
│  ├─ terraform/            # optional IaC skeleton
│  └─ nginx/ or traefik/
├─ .github/workflows/
├─ .env.example
└─ README.md
```

---

## 5. Roles and Permission Matrix

Roles: `NRI`, `AGENT`, `ADMIN`, `AUDITOR`. Enforce with a global `RolesGuard` plus object-level ownership checks in services.

| Capability | NRI | Agent | Admin | Auditor |
|---|---|---|---|---|
| Register / login | ✔ | ✔ | created by Admin | created by Admin |
| Create and edit own property (while DRAFT or REJECTED) | ✔ | ✘ | ✔ | ✘ |
| View own properties | ✔ | assigned only | all | all (read-only) |
| Upload documents | ✔ (own) | ✘ | ✔ | ✘ |
| Pay registration charge | ✔ | ✘ | ✘ | ✘ |
| Book, reschedule, cancel appointment | ✔ (own) | ✘ | ✔ | ✘ |
| Assign agent | ✘ | ✘ | ✔ | ✘ |
| Confirm or complete appointment | ✘ | ✔ (assigned) | ✔ | ✘ |
| Chat | own conversations | assigned conversations | all, can join | read-only |
| Join call | own appointments | assigned appointments | can join | ✘ (recording playback only) |
| Approve agents and properties | ✘ | ✘ | ✔ | ✘ |
| Manage masters, slots, settings | ✘ | ✘ | ✔ | ✘ |
| Audit dashboard | ✘ | ✘ | ✔ | ✔ |
| Export | own payments | ✘ | ✔ | ✔ (logged) |

---

## 6. Data Model (Prisma Schema)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role { NRI AGENT ADMIN AUDITOR }
enum UserStatus { PENDING_OTP ACTIVE SUSPENDED }
enum AgentApproval { PENDING APPROVED REJECTED }
enum PropertyType { PLOT FLAT AGRICULTURAL_LAND VILLA COMMERCIAL }
enum Intent { SELL LEASE RENT TRACK_ONLY }
enum AreaUnit { SQ_YD SQ_FT ACRES GUNTAS }
enum OwnershipType { SOLE JOINT INHERITED POWER_OF_ATTORNEY }
enum PropertyStatus { DRAFT PAYMENT_PENDING SUBMITTED UNDER_REVIEW APPROVED REJECTED }
enum PaymentStatus { CREATED PENDING SUCCESS FAILED REFUNDED }
enum AppointmentMode { AUDIO VIDEO SITE_VISIT }
enum AppointmentStatus { REQUESTED AGENT_ASSIGNED CONFIRMED COMPLETED CANCELLED RESCHEDULED NO_SHOW }
enum Channel { PORTAL WHATSAPP EMAIL SMS }
enum ConsentType { TERMS PRIVACY WHATSAPP RECORDING }
enum CallStatus { SCHEDULED ONGOING COMPLETED FAILED MISSED }

model User {
  id               String   @id @default(uuid())
  role             Role
  name             String
  email            String   @unique
  mobile           String   @unique            // E.164
  whatsappNumber   String?
  passwordHash     String
  originCountry    String?                     // ISO 3166-1 alpha-2
  currentCountry   String?                     // ISO 3166-1 alpha-2
  timeZone         String?                     // IANA, e.g. America/New_York
  status           UserStatus @default(PENDING_OTP)
  mobileVerifiedAt DateTime?
  mfaSecret        String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  agentProfile     AgentProfile?
  properties       Property[]
  consents         Consent[]
}

model Consent {
  id String @id @default(uuid())
  userId String
  type ConsentType
  acceptedAt DateTime @default(now())
  withdrawnAt DateTime?
  version String
  user User @relation(fields: [userId], references: [id])
  @@index([userId, type])
}

model AgentProfile {
  userId String @id
  experienceYears Int?
  languages String[]
  areasCovered String[]                      // village or taluka ids
  idDocumentKey String?
  approval AgentApproval @default(PENDING)
  approvedById String?
  approvedAt DateTime?
  rejectionReason String?
  user User @relation(fields: [userId], references: [id])
}

model District { id String @id @default(uuid()) name String @unique talukas Taluka[] active Boolean @default(true) }
model Taluka   { id String @id @default(uuid()) name String districtId String district District @relation(fields:[districtId], references:[id]) villages Village[] active Boolean @default(true) @@unique([districtId, name]) }
model Village  { id String @id @default(uuid()) name String talukaId String taluka Taluka @relation(fields:[talukaId], references:[id]) active Boolean @default(true) @@unique([talukaId, name]) }

model Property {
  id            String @id @default(uuid())
  ownerId       String
  name          String
  type          PropertyType
  surveyNumber  String
  state         String @default("Telangana")
  city          String @default("Hyderabad")
  districtId    String
  talukaId      String
  villageId     String
  address       String?
  landmark      String?
  latitude      Float?
  longitude     Float?
  area          Decimal
  areaUnit      AreaUnit
  ownership     OwnershipType
  intent        Intent @default(TRACK_ONLY)
  expectedPrice Decimal?                      // INR; sale price or rent or lease amount
  notes         String?
  status        PropertyStatus @default(DRAFT)
  rejectionReason String?
  submittedAt   DateTime?
  reviewedById  String?
  reviewedAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  owner User @relation(fields:[ownerId], references:[id])
  documents Document[]
  payments Payment[]
  appointments Appointment[]
  conversations Conversation[]
  @@index([districtId, talukaId, villageId])
  @@index([status])
}

model Document {
  id String @id @default(uuid())
  propertyId String
  kind String                                 // SALE_DEED, LAND_RECORD, TAX_RECEIPT, PHOTO, OTHER
  storageKey String
  mimeType String
  sizeBytes Int
  sha256 String
  scanStatus String @default("PENDING")       // PENDING, CLEAN, INFECTED
  uploadedById String
  uploadedAt DateTime @default(now())
  property Property @relation(fields:[propertyId], references:[id])
}

model Payment {
  id String @id @default(uuid())
  userId String
  propertyId String
  provider String                             // razorpay
  providerOrderId String @unique
  providerPaymentId String?
  amount Decimal
  currency String @default("INR")
  status PaymentStatus @default(CREATED)
  receiptNo String?
  rawWebhook Json?
  createdAt DateTime @default(now())
  paidAt DateTime?
  property Property @relation(fields:[propertyId], references:[id])
}

model SlotTemplate {
  id String @id @default(uuid())
  dayOfWeek Int                               // 0-6, IST
  startTime String                            // "10:00" IST
  endTime String
  durationMin Int @default(30)
  capacity Int @default(1)                    // parallel appointments per slot
  active Boolean @default(true)
}
model SlotException { id String @id @default(uuid()) date DateTime reason String? }   // blocked dates

model Appointment {
  id String @id @default(uuid())
  propertyId String
  nriId String
  agentId String?
  mode AppointmentMode
  startUtc DateTime
  endUtc DateTime
  status AppointmentStatus @default(REQUESTED)
  notes String?
  assignedAt DateTime?
  assignedById String?
  createdAt DateTime @default(now())
  property Property @relation(fields:[propertyId], references:[id])
  call Call?
  conversation Conversation?
  @@index([startUtc, status])
}

model Conversation {
  id String @id @default(uuid())
  propertyId String
  appointmentId String? @unique
  createdAt DateTime @default(now())
  property Property @relation(fields:[propertyId], references:[id])
  appointment Appointment? @relation(fields:[appointmentId], references:[id])
  participants ConversationParticipant[]
  messages Message[]
}
model ConversationParticipant { conversationId String userId String lastReadAt DateTime? @@id([conversationId, userId]) conversation Conversation @relation(fields:[conversationId], references:[id]) }

model Message {
  id String @id @default(uuid())
  conversationId String
  senderId String?
  channel Channel @default(PORTAL)
  body String?
  attachmentKey String?
  attachmentMime String?
  externalId String?                          // WhatsApp message id
  deliveryStatus String?                      // SENT, DELIVERED, READ, FAILED
  hidden Boolean @default(false)              // soft delete, always retained
  reported Boolean @default(false)
  sentAt DateTime @default(now())
  conversation Conversation @relation(fields:[conversationId], references:[id])
  @@index([conversationId, sentAt])
}

model Call {
  id String @id @default(uuid())
  appointmentId String @unique
  roomName String @unique
  mode AppointmentMode
  scheduledStart DateTime
  actualStart DateTime?
  actualEnd DateTime?
  status CallStatus @default(SCHEDULED)
  recordingKey String?
  recordingConsentAll Boolean @default(false)
  events Json @default("[]")                  // join/leave events
  appointment Appointment @relation(fields:[appointmentId], references:[id])
}

model Notification {
  id String @id @default(uuid())
  userId String?
  channel Channel
  template String
  payload Json
  status String                               // QUEUED, SENT, DELIVERED, FAILED
  error String?
  createdAt DateTime @default(now())
}

model Setting { key String @id value Json updatedAt DateTime @updatedAt }

model AuditLog {                                // append-only: no UPDATE or DELETE grants for the app role
  id BigInt @id @default(autoincrement())
  actorId String?
  actorRole Role?
  action String                               // e.g. PROPERTY_APPROVED, DOC_VIEWED, TRANSCRIPT_VIEWED, EXPORT_CREATED
  entity String
  entityId String?
  before Json?
  after Json?
  ip String?
  userAgent String?
  at DateTime @default(now())
  @@index([entity, entityId])
  @@index([actorId, at])
}
```

**Seed data (`seed.ts`):** one Admin user (credentials from env), Setting rows (see Section 12), SlotTemplate Mon–Sat 10:00–18:00 IST 30 min, Telangana → Hyderabad district structure with a **placeholder** taluka and village list in `prisma/seed-data/hyderabad.json` (the real official list will be imported by Admin; make the seed loader accept this JSON), country list (ISO), property type and unit lists.

---

## 7. Backend API (REST, prefix `/api/v1`)

All requests and responses validated with Zod schemas from `packages/shared`. Errors use `{ code, message, details? }`. Paginate lists with `page`, `pageSize`, `sort`. Document everything in OpenAPI.

### Auth and profile
| Method and path | Role | Notes |
|---|---|---|
| POST `/auth/register/nri` | public | name, email, mobile, password, originCountry, currentCountry, timeZone, whatsappNumber?, consents (TERMS, PRIVACY required; WHATSAPP optional) → user `PENDING_OTP`, sends OTP |
| POST `/auth/register/agent` | public | name, email, mobile, password, experienceYears, languages, areasCovered, whatsappNumber? → `PENDING_OTP`, approval `PENDING` |
| POST `/auth/otp/send` | public | rate limited |
| POST `/auth/otp/verify` | public | activates user; agents stay unapproved |
| POST `/auth/login` | public | returns access token and sets httpOnly refresh cookie; Admin and Auditor require TOTP |
| POST `/auth/refresh`, `/auth/logout` | any | rotating refresh tokens |
| POST `/auth/mfa/setup`, `/auth/mfa/verify` | Admin, Auditor | TOTP |
| GET, PATCH `/me` | any | profile, time zone, WhatsApp number |
| PATCH `/me/consents` | any | opt in and out of WHATSAPP or RECORDING |

### Masters (public read, Admin write)
GET `/masters/countries`, `/masters/districts`, `/masters/talukas?districtId=`, `/masters/villages?talukaId=`, `/masters/property-types`.
Admin: POST, PATCH, DELETE (soft) on districts, talukas, villages; POST `/admin/masters/import` (JSON or CSV).

### Properties (NRI)
| Method and path | Notes |
|---|---|
| POST `/properties` | create DRAFT; validate location chain (village belongs to taluka belongs to district; state Telangana, city Hyderabad) |
| PATCH `/properties/:id` | only DRAFT or REJECTED, owner only |
| GET `/properties`, GET `/properties/:id` | own properties with documents, payments, appointments |
| POST `/properties/:id/documents/presign` | returns presigned PUT url and `documentId`; limits: 10 MB per file, PDF/JPG/PNG |
| POST `/properties/:id/documents/:docId/complete` | records hash, enqueues virus scan |
| GET `/properties/:id/documents/:docId/url` | short-lived signed download url; logs `DOC_VIEWED` |
| POST `/properties/:id/submit` | requires at least one CLEAN document; sets PAYMENT_PENDING and returns payment order |

### Payments
| Method and path | Notes |
|---|---|
| POST `/properties/:id/payment-order` | create provider order for configured registration charge; idempotent per property while status is CREATED or PENDING |
| POST `/webhooks/payments` | verify signature, idempotent by `providerPaymentId`; on SUCCESS set payment SUCCESS, property SUBMITTED, send receipt email and WhatsApp |
| GET `/payments` | own payment history |
| GET `/payments/:id/receipt` | PDF receipt |

### Slots and appointments
| Method and path | Role | Notes |
|---|---|---|
| GET `/slots?date=YYYY-MM-DD&tz=` | NRI | generated from SlotTemplate minus exceptions minus full slots; returns UTC start and display times in requester time zone and IST |
| POST `/appointments` | NRI | `propertyId`, `mode`, `startUtc`, `notes`; property must be APPROVED (setting `requireApprovalBeforeBooking`, default true); capacity checked inside a DB transaction; creates REQUESTED, a conversation with NRI and Admin support, and **emails Admin** (plus WhatsApp alert) |
| GET `/appointments`, GET `/appointments/:id` | NRI, Agent | scoped by role |
| PATCH `/appointments/:id/reschedule`, POST `/appointments/:id/cancel` | NRI | allowed until status CONFIRMED and until cutoff setting |
| POST `/appointments/:id/confirm` | Agent (assigned), Admin | → CONFIRMED |
| POST `/appointments/:id/complete`, `/no-show` | Agent, Admin | |
| POST `/admin/appointments/:id/assign` | Admin | body `agentId` (agent must be APPROVED); adds agent as conversation participant; notifies NRI and agent |
| POST `/appointments/:id/call-token` | NRI, Agent, Admin | returns Jitsi JWT and room URL only within 10 minutes before start to 60 minutes after end |

### Chat
| Method and path | Notes |
|---|---|
| GET `/conversations` | with unread counts |
| GET `/conversations/:id/messages?cursor=` | |
| POST `/conversations/:id/messages` | text or attachment (presigned upload, scanned); also relayed to WhatsApp when the recipient is opted in and offline |
| POST `/conversations/:id/messages/:mid/report` | |
| WebSocket `/ws` (namespace `chat`) | events: `message:new`, `message:read`, `typing`, `presence`; JWT auth on connect; room per conversation; Redis adapter |

### WhatsApp
GET `/webhooks/whatsapp` (verification challenge), POST `/webhooks/whatsapp` (signature verified): delivery statuses update `Message.deliveryStatus` and `Notification.status`; inbound messages are matched by sender number to a user and appended to that user's most recent open conversation as `channel=WHATSAPP`.

### Calls
POST `/webhooks/jitsi` (shared secret): receives participant joined or left and room created or destroyed, updates `Call.events`, `actualStart`, `actualEnd`, `status`. Recording is enabled only if setting `recordingEnabled` is true and `recordingConsentAll` is recorded.

### Admin
| Path | Purpose |
|---|---|
| GET `/admin/dashboard` | KPI counts and recent items |
| GET `/admin/users`, PATCH `/admin/users/:id/status` | search, suspend, reactivate |
| POST `/admin/users` | create ADMIN or AUDITOR (temporary password, forced MFA setup) |
| GET `/admin/agents`, POST `/admin/agents/:id/approve`, `/reject` | |
| GET `/admin/properties`, POST `/admin/properties/:id/approve`, `/reject`, `/request-changes` | reject requires reason; moves status accordingly |
| GET `/admin/appointments` | filters by status, date, district |
| GET `/admin/payments` | filters and export |
| GET `/admin/conversations`, `/admin/calls` | |
| GET, PUT `/admin/settings` | registration charge, slots rules, templates, recording, cutoffs |
| CRUD `/admin/slots` | templates and exceptions |
| GET `/admin/audit-logs` | filters by actor, entity, action, date |
| GET `/admin/reports/export?type=properties\|payments\|appointments\|communications` | CSV; logs `EXPORT_CREATED` |

### Audit dashboard (Auditor and Admin, read-only)
| Path | Purpose |
|---|---|
| GET `/audit/summary` | KPIs: properties by status and intent, paid vs unpaid, appointments by status, active agents, calls held, messages exchanged |
| GET `/audit/properties` | register with filters: district, taluka, village, type, intent, status, paymentStatus, date range |
| GET `/audit/properties/:id` | full record: owner country details, location chain, documents list, payment, appointment history, assigned agent, status timeline |
| GET `/audit/properties/:id/communications` | chat transcript, WhatsApp log with delivery status, call log with recording link; logs `TRANSCRIPT_VIEWED` |
| GET `/audit/calls/:id/recording-url` | signed URL; logs `RECORDING_PLAYED` |
| GET `/audit/search?q=` | keyword search across messages |
| GET `/audit/export` | CSV or PDF, logged |

**Cross-cutting rule:** an interceptor writes an `AuditLog` row for every state-changing request and for every read of documents, transcripts and recordings.

---

## 8. Business Rules

**OTP.** 6 digits, expires in 5 minutes, maximum 5 attempts, resend after 60 seconds, maximum 5 sends per mobile per hour and 10 per IP per hour. Store only a hash. Account is `ACTIVE` only after verification.

**Password.** Minimum 10 characters, one letter and one number; argon2id.

**Property status machine.**
`DRAFT → PAYMENT_PENDING → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED`; `REJECTED → DRAFT` on edit then resubmit (no second charge if a successful payment already exists for the property; **Default**). Admin may use "request changes" which sets `REJECTED` with a reason.

**Appointment status machine.**
`REQUESTED → AGENT_ASSIGNED → CONFIRMED → COMPLETED`; branches `CANCELLED`, `RESCHEDULED` (new REQUESTED slot, keeps agent if still free), `NO_SHOW`.

**Slots.** Templates are in IST. Convert to UTC for storage. Return display times in the NRI's time zone and IST. A slot is full when confirmed or requested appointments reach `capacity`. Booking must lock with a transaction or advisory lock to prevent overbooking.

**Agent assignment.** Admin picks any APPROVED, active agent. Provide a suggestion list ordered by: area match (village, then taluka, then district), fewest appointments that day, language match. Assignment adds the agent to the conversation.

**Payments.** Amount comes from setting `registrationChargeInr` (**Default 500, configurable**). Never trust client-side amounts. Webhook is the source of truth. Payment events are idempotent.

**Chat.** Participants are limited to NRI, assigned agent and Admin. Agent gains access only after assignment. Users cannot edit or delete; "delete" sets `hidden=true` for users but the row remains for audit. Attachments are scanned before they are downloadable. Offline recipients get email or WhatsApp alerts, rate limited to one per conversation per 15 minutes.

**WhatsApp.** Send only to numbers with an active WHATSAPP consent. Outside the 24-hour customer-service window use approved templates only. Template keys: `otp_optional`, `payment_receipt`, `property_status`, `appointment_requested_admin`, `appointment_assigned`, `appointment_confirmed`, `appointment_reminder`, `call_starting_soon`, `new_message_alert`. Opt-out keyword stops all messages.

**Calls.** Room is created per appointment with an unguessable name. Tokens are issued per user with role claims (moderator for agent and Admin). Recording is **off by default**; when `recordingEnabled` is on, show a consent banner before join and store `recordingConsentAll` only if all participants accept.

**Reminders.** Jobs send email and WhatsApp 24 hours and 1 hour before every appointment (**Default**).

**Retention (Default, configurable).** Audit logs, payments, transcripts and call records: 7 years. Recordings: 1 year. Soft-deleted data stays retained.

---

## 9. Notification Matrix

| Event | Recipient | Channels |
|---|---|---|
| OTP | NRI, Agent | SMS (email fallback) |
| Registration success, payment receipt or failure | NRI | Email, WhatsApp |
| Property submitted, approved, rejected | NRI | Email, WhatsApp |
| **Appointment requested** | **Admin** | **Email (required), WhatsApp** |
| Appointment assigned, confirmed, rescheduled, cancelled | NRI, Agent | Email, WhatsApp |
| Reminder (24h and 1h) and call starting soon | NRI, Agent | Email, WhatsApp, in-app |
| New chat message while offline | Recipient | Email, WhatsApp |
| New agent registration | Admin | Email |
| Agent approved or rejected | Agent | Email, WhatsApp |

All notifications are queued with BullMQ, retried with backoff, and logged in `Notification`.

---

## 10. Frontend Routes and Screens

Visual style: **light theme, white background**, primary blue `#2457D6`, navy `#172554`, soft background `#F4F6FA`, borders `#DFE4EC`, rounded cards and buttons, Inter or system sans-serif. Responsive for desktop first, usable on mobile web. Do not implement dark mode.

### Public
- `/` landing with sign-in and register links
- `/register/nri` (steps: account details with origin and current country, mobile OTP, WhatsApp opt-in and consents)
- `/register/agent`
- `/login`, `/verify-otp`, `/forgot-password`

### NRI (`/app`)
- `/app` dashboard: properties count, upcoming appointments, unread messages
- `/app/properties` list with status badges; `/app/properties/new` 3-step wizard: **1 Land details** (name, type, survey number, state Telangana, city Hyderabad, district, taluka, village, address, area and unit, ownership, intent and price) → **2 Documents and photos** → **3 Review and pay** (hosted checkout redirect or modal, success and failure screens)
- `/app/properties/[id]` detail with timeline, documents, payments, appointments, assigned agent, **Book appointment**, **Chat**
- `/app/appointments`, `/app/appointments/new` (property, mode, calendar, time slots showing local time and IST, notes, confirm)
- `/app/appointments/[id]` with **Join call** button (enabled in window)
- `/app/chat` conversations list and thread view
- `/app/payments`, `/app/settings` (profile, time zone, WhatsApp opt-in)

### Agent (`/agent`)
- `/agent` dashboard (pending approval notice until approved)
- `/agent/appointments` assigned list with confirm and complete actions
- `/agent/appointments/[id]` property and NRI details (no private data beyond what is needed), chat, Join call
- `/agent/chat`, `/agent/profile`

### Admin (`/admin`)
- `/admin` dashboard (KPI cards, recent submissions, pending assignments, map of properties)
- `/admin/users`, `/admin/agents`, `/admin/properties` (review with document viewer), `/admin/appointments` (assign agent dialog with suggestions), `/admin/payments`, `/admin/communications`, `/admin/masters`, `/admin/slots`, `/admin/settings`, `/admin/audit-logs`, `/admin/reports`, `/admin/admins`

### Audit dashboard (`/audit`)
- `/audit` KPI cards and charts
- `/audit/properties` register table with filters, `/audit/properties/[id]` tabs: **Details**, **Documents**, **Payment**, **Appointments**, **Communication** (chat transcript, WhatsApp log, call log with recording player), **Timeline**
- `/audit/search`, `/audit/exports`
- No create, edit, delete or approve controls anywhere in this area.

### Shared components
Form field components with Zod resolver, data table with server-side pagination and filters, status badge, stepper, calendar and slot picker, chat panel (virtualised list, attachments, typing and read receipts), Jitsi call frame with pre-join consent check, file uploader (presigned), toast and confirm dialogs, role-aware navigation, error and empty states.

---

## 11. Integrations (Provider Interfaces)

```ts
interface SmsProvider      { sendOtp(mobileE164: string, code: string): Promise<void>; }
interface EmailProvider    { send(to: string, subject: string, html: string, attachments?: File[]): Promise<void>; }
interface WhatsAppProvider { sendTemplate(to: string, template: string, vars: Record<string,string>): Promise<{id:string}>;
                             sendText(to: string, text: string): Promise<{id:string}>; verifyWebhook(req): boolean; }
interface PaymentProvider  { createOrder(amount: number, currency: string, receipt: string): Promise<{orderId:string}>;
                             verifyWebhook(rawBody: Buffer, signature: string): boolean; parseEvent(body): PaymentEvent; }
interface StorageProvider  { presignPut(key: string, mime: string, maxBytes: number): Promise<string>;
                             presignGet(key: string, ttlSec: number): Promise<string>; }
interface MeetingProvider  { createToken(room: string, user: User, moderator: boolean): string; roomUrl(room: string): string; }
```

Provide a `Fake` or sandbox adapter for each so the whole app runs locally without external accounts (OTP printed to logs, mail in MailHog, payments simulated by a local checkout page, WhatsApp logged to console).

---

## 12. Configuration

**Environment variables (`.env.example`)**
```
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
DATABASE_URL=postgresql://landtrack:landtrack@localhost:5432/landtrack
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
OTP_HASH_SECRET=
S3_ENDPOINT=http://localhost:9000
S3_REGION=ap-south-1
S3_BUCKET=landtrack
S3_ACCESS_KEY=
S3_SECRET_KEY=
SMTP_URL=smtp://localhost:1025
MAIL_FROM=no-reply@landtrack.example
SMS_PROVIDER=fake
WHATSAPP_PROVIDER=fake
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
PAYMENT_PROVIDER=fake
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
JITSI_DOMAIN=localhost:8443
JITSI_APP_ID=landtrack
JITSI_APP_SECRET=
JITSI_WEBHOOK_SECRET=
CLAMAV_HOST=localhost
ADMIN_EMAIL=
ADMIN_INITIAL_PASSWORD=
ADMIN_NOTIFY_EMAIL=
```

**Settings table keys (Admin editable):** `registrationChargeInr` (500), `requireApprovalBeforeBooking` (true), `appointmentCancelCutoffHours` (2), `slotDurationMin` (30), `recordingEnabled` (false), `reminderHours` ([24,1]), `chatRetentionYears` (7), `recordingRetentionMonths` (12), email and WhatsApp template texts.

---

## 13. Security Requirements (Implement)

- TLS only; HSTS; secure, httpOnly, sameSite cookies for refresh tokens; CSRF protection on cookie-authenticated routes
- Helmet, strict CORS allow-list, global rate limiting (default 60 req/min/user; stricter on OTP, login, chat messages)
- RBAC guard on every route, plus ownership checks; deny by default
- Input validation with Zod on every endpoint; output DTOs never expose password hashes, secrets or other users' data
- Argon2 passwords; MFA (TOTP) mandatory for ADMIN and AUDITOR
- Uploads: MIME and magic-byte check, size limits, ClamAV scan, private bucket, presigned URLs under 5 minutes, no public ACLs
- Payment: hosted checkout only, no card data stored, webhook signature verification, idempotency
- WhatsApp and Jitsi webhooks verified by signature or shared secret
- Audit log table: application database role has INSERT and SELECT only
- Secrets only from environment; no secrets in code or logs; PII redacted in logs
- Dependency, secret and container scanning in CI
- Encrypt at rest (database, storage) in deployment configuration; field-level encryption for ID documents

---

## 14. Non-Functional Targets

| Item | Target |
|---|---|
| Availability | 99.5% |
| API p95 latency | under 800 ms for non-upload endpoints |
| Chat delivery | under 1 second online |
| Backups | Daily, 14-day retention; RTO 8 h, RPO 24 h |
| Accessibility | WCAG 2.1 AA for key flows |
| Browser support | Latest Chrome, Edge, Safari, Firefox |
| Observability | Request IDs, structured logs, metrics endpoint, health and readiness endpoints |
| Alert thresholds | API error rate above 1%, p95 above 800 ms, failed payments spike, SMS or WhatsApp failures, failed call joins, disk above 80%, backup failure |

---

## 15. Build Order and Acceptance Criteria

Build milestone by milestone. Each milestone ends with passing tests and working UI.

| # | Milestone | Acceptance criteria |
|---|---|---|
| 1 | **Foundation:** monorepo, Docker Compose, Prisma schema and migrations, seed, config validation, health check, CI, shared package, base UI shell with light theme | `docker compose up` and `pnpm dev` start everything; seed creates Admin and masters |
| 2 | **Auth:** NRI and agent registration, OTP, login, refresh, RBAC guards, MFA for Admin and Auditor, consents | NRI can register with origin and current country, verify OTP, log in; OTP rate limits work; unit and E2E tests pass |
| 3 | **Masters and properties:** location cascade, property wizard steps 1 and 2, document upload with scan, status machine | Village must belong to selected taluka and district; only Hyderabad data selectable; infected file is blocked |
| 4 | **Payments:** order creation, hosted checkout (fake and Razorpay adapters), webhook, receipts, payment pages | Successful payment moves property to SUBMITTED exactly once even if the webhook is delivered twice; failure and retry work |
| 5 | **Admin core:** dashboard, user and agent management, agent approval, property review, masters and settings | Admin can approve or reject with reasons and NRI sees the result and gets notified |
| 6 | **Slots and appointments:** slot templates, calendar UI with time zones, booking, admin email on request, assignment, confirm, complete, cancel, reschedule | No overbooking under concurrent requests; Admin receives the email; assigned agent sees the appointment |
| 7 | **Chat:** WebSocket gateway, conversations tied to appointments, attachments, read receipts, offline alerts, reporting | Messages are delivered in real time across two browsers and persisted; users cannot delete; agent has access only after assignment |
| 8 | **WhatsApp:** provider, templates, opt-in and opt-out, delivery status, inbound reply capture | Events in Section 9 send via WhatsApp for opted-in users; replies appear in the chat thread with `channel=WHATSAPP` |
| 9 | **Calls:** Jitsi JWT, join window, call page with consent check, webhook events, call records, optional recording | Two users join the same room only inside the allowed window; call log records start, end and duration; recording works only when enabled and consented |
| 10 | **Audit dashboard:** summary, property register with filters, property detail, communication audit tab, search, exports, access logging | Auditor sees all data read-only; every transcript view, recording play and export appears in audit logs |
| 11 | **Hardening and release:** security review items from Section 13, load test chat and calls, E2E suite, accessibility pass, README and runbooks | CI green; no high or critical findings in scans; all acceptance criteria above pass |

**Definition of done for every feature:** typed API contract in OpenAPI, validation, authorization tests, audit logging where required, loading and error states in UI, unit tests for business rules, at least one E2E happy-path test.

---

## 16. Defaults Applied for Open Questions

| Question | Default used in code |
|---|---|
| Registration charge | One-time per property, INR 500, set by Admin; no automated refunds |
| Currency shown | INR (display only); gateway handles international cards |
| OTP channel | SMS to mobile; email fallback |
| WhatsApp | Two-way: replies stored in the conversation |
| Recording | Off by default, consent required when on |
| Retention | 7 years records and transcripts, 1 year recordings |
| Calls outside an appointment | Not allowed; calls exist only within booked AUDIO or VIDEO appointments |
| Auditor access to documents and recordings | Allowed, every access logged |
| "Hyderabad" coverage | District list is data-driven; seed with Hyderabad district, Admin can add Rangareddy and Medchal-Malkajgiri without code changes |
| Taluka vs mandal | Field label "Taluka / Mandal" |
| Booking before approval | Requires APPROVED property (setting can disable) |

---

## 17. Reference Mapping

| Reference | Use in build |
|---|---|
| LandTrack mobile mockup | Add land form fields and calendar plus time-slot picker (replace $ and acres with INR and Indian units, replace location with the Hyderabad cascade) |
| `landtrack_site_visit_wireframe.html` | NRI web layout: sidebar navigation, dashboard cards, property table, detail page, schedule flow, confirmation screen |
| RealEstate Admin dashboard image | Admin and Audit dashboard layout: KPI cards, recent submissions table, pending items, property map; **use the light theme, not the dark one** |
| RealEstate Pro audit screen | Layout idea for the Audit property detail page (details panel plus status timeline); the site-audit checklist itself is out of scope for MVP 1 |