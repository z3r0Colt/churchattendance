# Phase 6 attendance reports and dashboard

Reports now provides attendance summaries, a household matrix, shepherding and visitor follow-up reports, and the membership roll. Annual statistics, the congregational meeting summary and the photo directory remain under Annual reports.

## Report definitions

Choose a date range of up to 366 days. Service types include inactive templates so archived meetings remain reportable. District filtering uses the person's current assignment because the database does not store district assignment history. Names, households and contact details are also current. Membership filtering uses recorded status on each meeting date.

Historical categories are reconstructed from the membership events. Missing histories and histories that do not agree with the current membership status need review. A mark belonging to a missing person is retained as unclassified. A mark before a recorded initial roll entry also needs review. A specific membership filter cannot include marks whose status is unknown. Do not use current membership to fill a historical gap.

Unfiltered category totals include Former and Unclassified columns so they reconcile with recorded attendance marks. Review records lists data problems that should be resolved before distribution. Changing a current status does not relabel an earlier meeting when a consistent dated history is present.

The summary has one row per recorded service. Its comparison average uses recorded services of the same type during the preceding 28 days, excluding the current service date. Its year comparison uses the same weekday 52 weeks earlier. Missing meetings and missing comparison dates display no record rather than zero. A recorded service with no marks does count as zero. There is no separate service-completion flag, so the app cannot distinguish an unfinished roll call from a completed empty meeting.

The matrix has a column per recorded meeting, with the service ID in the heading to distinguish templates with the same name. Eligible meetings begin when recorded history places a person on the active roll and end at removal. Historically eligible former or deceased people remain in the matrix. Percentages divide attended eligible meetings by recorded eligible meetings. Unknown history produces a review label instead of an invented percentage. An inappropriate mark outside eligibility is shown for review. Gaps in the calendar do not create attendance opportunities.

Shepherding rows show last recorded attendance through the chosen end date and percentages in the selected period. The default period is three months. Shepherding percentages exclude meetings when the person was still a visitor. The absence streak counts distinct recorded Lord's Day dates, and attendance at either selected service on a date ends the streak. These are recorded dates, not necessarily consecutive calendar weeks. Select one recurring service type when comparing a regular worship pattern. The Absent 3+ filter is available separately.

Visitor rows include people who attended as visitors in the chosen period even if they later joined. Multiple services on one date count as one visit. First recorded visit and returning status use all available qualifying records through the chosen end date for the selected service types. They do not claim to establish a person's first ever visit when earlier records are absent.

The membership roll uses membership at the selected end date, with received or initial entry dates and recorded baptism/profession dates. Initial entries are labelled Initial rather than being presented as a known reception into membership. The workbook includes membership changes in the chosen period. Missing or inconsistent histories are flagged rather than silently added to the roll.

## Private care and roles

Ordinary attendance records and membership history have the existing reader permissions. The reporting callable now also serves Deacons, who already have read access to these public records. Their report selector provides the attendance summary and matrix. Attendance Volunteers keep the names-only roll call interface and cannot call the reporting API.

Pastor, Clerk and Elder receive additional current open follow-up counts and dated visit information in shepherding and visitor reports. These reports display a Session only badge, and their workbook and PDF titles carry the same warning. Private task titles, note bodies and discipline details are not included in these reports. Open-task counts reflect the present state, not reconstructed task state on a historical date.

Admin without Session and Read Only accounts receive no private-care subscriptions or private follow-up counts. The report explicitly labels follow-up information as Session only. A care-loading error does not become a zero count, and Session care exports wait for those records to load. Reports do not write or complete follow-up tasks. Use Pastoral care for that work.

## Exports and printing

Export offers CSV of the visible filtered grid and an Excel workbook. On Report detail, Excel contains Summary, Detail and Data sheets with a chart and the report's source or membership-change rows. Source rows and Review records export the selected grid using the standard workbook format. Formula-like text is handled as text.

The Summary manifest records the range, count definitions and private-care scope. Attendance source rows identify Attendance and Review records separately. Review rows are not attendance marks. Visitor source marks belong to recorded visitors, and shepherding source marks follow the selected subjects and the Absent 3+ filter. The chart and attendance-mark total use the same report scope. Review records may include unclassified people outside those subjects so incomplete history is still visible. Missing-month chart values are omitted rather than plotted as zero.

Print / PDF uses the isolated report template. A matrix prints at most six meeting columns per section, repeating household names and totals. Large reports may span several Letter pages. This preserves legibility rather than forcing the whole matrix onto a single sheet. Desktop page numbers come from the existing Electron PDF handler. Browser previews open a printable report window.

## Dashboard

The Dashboard is available from the navigation for staff readers. Sign-in still opens Attendance so the booth workflow is unchanged. The service selector defaults to the earliest active Lord's Day template and supports inactive templates or all recorded types.

Attendance tiles link to the matching date range and report. The absence tile opens the shepherding report with Absent 3+ enabled. Visitor and absence counts require supporting membership history. The twelve-month line chart uses averages per recorded meeting and omits missing months. Public panels show birthdays and unassigned serving roles in the next seven days. Only Session sees the due-follow-up panel. A Deacon sees attendance tiles and no private-care panel.

## Validation and remaining work

Unit tests cover historical category reconciliation, missing histories, eligibility, recorded-meeting averages, date filters and privacy projections. Emulator/browser tests cover report permissions, charted workbooks, matrix filtering, PDF previews and dashboard links. Fixtures are fictional. No real messages are sent.

Reporting history retrieval requires a connection. Cached attendance entry and its existing offline synchronization remain available. Staff account/role administration, anniversary/custom-field editing, managed backup provisioning and native Windows release checks remain separate work. No live project, hosting site or installer release is provisioned by this phase.
