# Church Attendance & Management (Windows) Plan

A Windows desktop program for a Reformed Presbyterian congregation. It tracks attendance for members, non-residents, adherents and visitors, exports to CSV and Excel, and copies the useful parts of Tithely ChMS (people, households, groups, events, check-in, email and text messaging). Giving and tithing are left out on purpose.

## 1. Goals

1. Fast attendance entry on the Lord's Day, under two minutes for a whole service.
2. Clear membership categories that fit Reformed Presbyterian practice.
3. Reports the Session and Clerk actually use, exported to CSV or XLSX.
4. Email and SMS to the whole congregation or any filtered group.
5. Several PCs share the same live data (sound booth PC, pastor's PC, and others later), from church or from home.
6. The sound booth PC keeps working on the Lord's Day even if the internet drops.
7. Simple enough for a volunteer to run without training.

Not in scope: giving, pledges, accounting, online donation pages.

## 2. People Categories

Each person has one **membership status** and can also carry flags.

| Status | Meaning |
|---|---|
| Communicant Member | Professed faith, admitted to the Lord's Table |
| Baptized (Non-communicant) Member | Covenant children and others baptized but not yet professing |
| Non-resident Member | Member whose residence is away from the congregation |
| Adherent | Regular attender who has not joined |
| Visitor | First time or occasional guest |
| Former | Transferred, removed, deceased (kept for history, hidden by default) |

Extra fields that matter for RP churches
* Date received, how received (profession, transfer, reaffirmation), received from (congregation)
* Baptism date and place, profession date
* Transfer out date and destination
* Elder district / shepherding elder assignment
* Officer role (Pastor, Elder, Deacon) with ordination and installation dates
* Under discipline flag (Session only, hidden from normal users)
* Deceased date

Status changes are logged with date and reason so the Clerk has a full membership history.

## 3. Feature List (Tithely ChMS parity minus giving)

### 3.1 People & Households
* Person record with photo, contact info, birthday, anniversary, custom fields
* Households with head, spouse, children, shared address
* Search, filter, saved lists ("All adherents who missed 4 weeks")
* Merge duplicates
* Import from CSV/XLSX (for moving off spreadsheets or Tithely)
* Timeline per person showing attendance, messages sent, notes, status changes

### 3.2 Attendance
* Service types set up by the church, such as Lord's Day Morning, Lord's Day Evening, Midweek Prayer, Sabbath School classes, Communion Season
* **Quick roll call screen** with a checklist of all active people grouped by household, one click marks the whole family
* Headcount only mode for services where names are not taken
* Visitor quick add right on the attendance screen
* Optional **self check-in kiosk mode** (tablet or second monitor, search by last name or phone)
* Optional **children's check-in** with printed name labels and matching parent tags (Dymo / Brother label printers)
* Absence alerts, for example "flag anyone absent 3 Lord's Days in a row" sent to their shepherding elder

### 3.3 Groups
* Small groups, Sabbath School classes, choir, committees, Diaconate, Session
* Group leaders, meeting schedule, group attendance
* Message a whole group in one step

### 3.4 Events & Calendar
* Church calendar with recurring events
* Event registration and RSVP list
* Volunteer / serving schedule (nursery, ushers, psalm leaders, meal teams) with reminder texts

### 3.5 Communication (email and text)
* Compose to a person, household, group, status, or saved list
* Merge fields like `{FirstName}` and `{ServiceTime}`
* Templates, signatures, attachments for email
* Schedule a message for later
* Two-way SMS inbox (replies show up on the person's timeline)
* Opt-out handling (STOP / UNSUBSCRIBE honored automatically)
* Delivery log with sent, delivered, failed
* Prayer chain and emergency broadcast list

### 3.6 Pastoral Care
* Private notes with visibility levels (Pastor only, Session, Deacons)
* Visit log and follow-up tasks assigned to an elder or deacon
* Diaconal needs list (meals, rides, benevolence requests without money amounts)

### 3.7 Reports & Exports
All reports export to **CSV and XLSX** and print to PDF.
* Attendance by service, by date range, by person, by status
* Weekly totals and averages, trend chart
* Members vs adherents vs visitors breakdown
* Absentee report
* First time visitors and follow-up status
* Membership roll (communicant, baptized, non-resident) for the Clerk
* Annual statistical report figures for presbytery/synod (received, removed, baptisms, professions, deaths, totals)
* Birthdays and anniversaries
* Directory print (photo directory as PDF)

### 3.8 Users & Security
* Logins with roles: Admin, Pastor, Clerk of Session, Elder, Deacon, Attendance Volunteer, Read Only
* Field level hiding for sensitive data
* Each person logs in with their own account on any PC. The sound booth PC can stay logged in as an Attendance Volunteer account that only sees the roll call screen, while the pastor logs in with full access from the office or home
* All traffic encrypted (HTTPS), passwords hashed, auto lock after idle, local cache encrypted
* Audit log of who changed what
* Automatic nightly server backup kept 30 days, plus an Export Everything button for a local copy

### 3.9 Optional later
* Member portal / phone app for directory and RSVP (needs a hosted server, so it is phase 4)
* Online forms (visitor card, event sign up)

## 4. Technical Design

### 4.1 Stack
| Part | Choice | Why |
|---|---|---|
| Language / runtime | C# on .NET 8 (LTS) | Native Windows, long support, free |
| UI | WPF with MVVM (CommunityToolkit.Mvvm), styled with WPF-UI for a modern Windows 11 look | Mature, fast, works on Windows 10 and 11 |
| Server | ASP.NET Core Web API (.NET 8) hosted in the cloud (Azure App Service, Railway, or a small VPS) | Every PC talks to one place, works at church or home |
| Database | PostgreSQL through Entity Framework Core, managed hosting with daily backups | Reliable, handles many users at once |
| Local cache | SQLite (SQLCipher encrypted) on each PC | Sound booth keeps working offline, syncs when back online |
| Sign in | Username and password with JWT tokens, optional two step login for Admin and Pastor | Safe over the internet |
| Live updates | SignalR | When the pastor edits a person, the sound booth PC sees it right away |
| Excel export | ClosedXML | Free, no Excel install needed |
| CSV | CsvHelper | Standard |
| PDF / printing | QuestPDF | Reports, directory, labels |
| Charts | LiveCharts2 | Attendance trends |
| Email | MailKit over SMTP (Google Workspace, Microsoft 365, or any SMTP), optional SendGrid / Mailgun API for bulk | Church keeps its own address |
| SMS | Twilio API (provider interface so Telnyx or others can be swapped in) | Reliable, two-way, cheap |
| Installer | MSIX or Velopack with auto update | One click install and updates |
| Tests | xUnit plus FluentAssertions | Core logic covered |

### 4.2 Project layout
```
src/
  ChurchApp.Api/           ASP.NET Core server, auth, SMS webhooks, scheduled jobs
  ChurchApp.Client/        Typed API client + offline cache and sync used by the desktop app
  ChurchApp.Core/          Domain models, business rules, interfaces
  ChurchApp.Data/          EF Core DbContext, migrations, repositories
  ChurchApp.Messaging/     Email + SMS providers, queue, opt-out logic
  ChurchApp.Reporting/     Report queries, CSV/XLSX/PDF exporters
  ChurchApp.Desktop/       WPF app (views, view models)
  ChurchApp.Kiosk/         Self check-in window (can be same exe, kiosk flag)
tests/
  ChurchApp.Core.Tests/
  ChurchApp.Reporting.Tests/
```

### 4.3 Core data model
```
Person(Id, FirstName, LastName, PreferredName, Gender, BirthDate, Email, MobilePhone,
       HomePhone, PhotoPath, HouseholdId, MembershipStatus, ElderDistrictId,
       SmsOptIn, EmailOptIn, IsDeceased, Notes, CreatedAt, UpdatedAt)
Household(Id, Name, Address1, Address2, City, State, Zip, HomePhone)
MembershipEvent(Id, PersonId, Date, FromStatus, ToStatus, Method, OtherChurch, Reason)
Sacrament(Id, PersonId, Type[Baptism|Profession], Date, Place, Officiant)
Office(Id, PersonId, Role[Pastor|Elder|Deacon], OrdainedOn, InstalledOn, EndedOn)
ElderDistrict(Id, Name, ElderPersonId)
ServiceType(Id, Name, DayOfWeek, DefaultTime, IsActive)
Service(Id, ServiceTypeId, Date, HeadcountOverride, Notes)
Attendance(Id, ServiceId, PersonId, CheckedInAt, Method[Roll|Kiosk|Import])
VisitorCount(ServiceId, AnonymousCount)
Group(Id, Name, Type, LeaderPersonId)   GroupMember(GroupId, PersonId, Role)
Event(Id, Title, Start, End, Recurrence, Location)   EventRsvp(EventId, PersonId, Status)
ServingRole / ServingSchedule
Message(Id, Channel[Email|Sms], Subject, Body, ScheduledFor, SentAt, SentByUserId)
MessageRecipient(MessageId, PersonId, Address, Status, ProviderId, Error)
InboundSms(Id, FromNumber, PersonId?, Body, ReceivedAt)
CareNote(Id, PersonId, AuthorUserId, Visibility, Body, CreatedAt)
FollowUpTask(Id, PersonId, AssignedToUserId, DueDate, Done)
User(Id, PersonId?, Username, PasswordHash, Role)
AuditLog(Id, UserId, Entity, EntityId, Action, Changes, At)
CustomField / CustomFieldValue
```

### 4.4 Text messaging details (the hard part)
* **Sending** happens on the server, not the PCs. Twilio and email credentials live only on the server, so no PC holds them.
* **Receiving replies** is easy because the server has a public address. Twilio posts each reply to the server, it gets matched to the person, and every logged in PC sees it in the inbox.
* **Scheduled messages and reminders** run on the server, so they go out even when every church PC is turned off.
* **US carrier rules** require A2P 10DLC registration for a church number (brand + campaign). Nonprofits get reduced fees. Plan a week or two for approval. Cost roughly $0.008 to $0.01 per text segment plus a few dollars a month for the number.
* STOP, START, HELP keywords handled, opt-out stored on the person and always respected.
* Rate limiting and a send queue so a 300 person blast does not get blocked.

### 4.5 Multiple PCs and offline use
* Every PC runs the same Windows app and signs in to the church's server.
* Two people editing the same record is handled with version checks. If the pastor and the booth both change one person, the second save shows what changed and asks which to keep. Attendance check marks never conflict because each is its own row.
* The booth PC downloads the people list and service schedule ahead of time. If the internet is down on the Lord's Day, attendance is saved locally and uploads on its own once the connection returns.
* Adding another PC later is just installing the app and signing in.

### 4.6 Email details
* SMTP with the church's own account (app password or OAuth for Gmail / Microsoft 365).
* Bulk sends batched to stay under provider limits (Gmail Workspace is about 2,000 per day).
* Optional SendGrid / Mailgun key for larger lists and open tracking.
* Unsubscribe footer and per person email opt-out.

### 4.7 Export details
* Every grid in the app gets an Export button (CSV or XLSX) that exports exactly what is filtered on screen.
* XLSX exports include a header row, frozen panes, auto column widths, date formatting, and a second "Summary" sheet when the report has totals.
* Attendance matrix export, people down the side and dates across the top, with check marks and per person totals.

## 5. Screens

1. **Dashboard** with this week's attendance, trend chart, birthdays, follow-ups due, absent-alert list
2. **People** list and person detail (tabs for Info, Household, Membership, Attendance, Groups, Messages, Notes)
3. **Households**
4. **Take Attendance** roll call screen
5. **Kiosk** check-in (full screen)
6. **Groups**
7. **Calendar & Events**
8. **Serving Schedule**
9. **Messages** (compose, scheduled, sent log, SMS inbox)
10. **Reports**
11. **Settings** (church info, service types, statuses, custom fields, users, email/SMS setup, backup)

## 6. Phased Roadmap

**Phase 1, Attendance core (MVP, about 6 to 8 weeks)**
* Project setup, hosted server and PostgreSQL database, user logins and roles
* Desktop app connected to the server, offline cache and sync for the booth PC
* People, households, membership statuses and history
* Service types, roll call attendance, headcount, visitor quick add
* Attendance reports with CSV and XLSX export
* CSV/XLSX import of existing people
* Server backups, desktop installer with auto update

**Phase 2, Communication (about 3 to 4 weeks)**
* Email via SMTP with templates and merge fields
* SMS via Twilio with opt-out handling and polling inbox
* Message log on each person, scheduled sends
* Absence alerts to shepherding elders

**Phase 3, ChMS extras (about 4 to 6 weeks)**
* Groups with group attendance
* Calendar, events, RSVPs
* Serving schedule with reminder texts
* Pastoral care notes, follow-up tasks, role based visibility
* Kiosk and children's check-in with label printing
* Annual statistical report, photo directory PDF

**Phase 4, Optional online pieces**
* Member portal or phone app for directory and RSVP
* Online forms (visitor card, event sign up)

## 7. Running Costs (estimate for a 150 person church)
| Item | Cost |
|---|---|
| Software | Free (built in house) |
| Server and database hosting | about $10 to $25 per month (Azure nonprofit credits can cover this) |
| Twilio number | about $1.15 per month |
| Texts | about $0.008 to $0.01 each, so a weekly 150 person text is about $6 per month |
| 10DLC registration | one time about $4 to $45 depending on brand type, small monthly campaign fee |
| Email | Free through existing Google or Microsoft account |
| Code signing certificate (optional, stops Windows warnings) | about $100 to $300 per year, or free through Azure Trusted Signing for eligible orgs |

## 8. Open Questions for the Session
1. ~~One PC only, or several PCs sharing data?~~ Decided. Several PCs (sound booth and pastor to start), shared through a hosted server.
2. Will children be checked in with labels, or just marked on the roll?
3. Which services get name-by-name attendance and which get headcount only?
4. Who should see pastoral notes and discipline flags?
5. Is there existing data (Tithely export, spreadsheet) to import?
6. Does the church already have Google Workspace or Microsoft 365 for email?
7. Does the presbytery want a specific statistical report layout?

## 9. Next Step
Approve this plan (with any changes), answer the open questions, and Phase 1 development starts with the solution scaffold, database schema and roll call screen.
