# Evie Intake Schema

This schema defines the information the website agent should try to capture for attorney review and lead routing.

## Lead Record

```json
{
  "lead_source": "website_widget",
  "agent_name": "Evie",
  "conversation_channel": "chat_or_voice",
  "created_at": "ISO-8601 timestamp",
  "visitor_name": "",
  "visitor_phone": "",
  "visitor_email": "",
  "incident_city": "",
  "incident_state": "",
  "incident_date_text": "",
  "incident_type": "",
  "injury_summary": "",
  "medical_treatment_status": "",
  "still_treating": "",
  "commercial_vehicle_involved": "",
  "nursing_home_abuse_flag": false,
  "work_or_daily_life_impact": "",
  "insurance_status": "",
  "represented_by_other_attorney": "",
  "evidence_summary": "",
  "visitor_goal": "",
  "qualification_path": "qualified_or_review",
  "qualification_notes": "",
  "consult_link_offered": false,
  "follow_up_recommended": false,
  "conversation_summary": ""
}
```

## Field Notes

- `lead_source`
  - Always `website_widget` for this implementation.
- `conversation_channel`
  - `chat` or `voice`
- `incident_type`
  - Examples: `car_accident`, `truck_accident`, `slip_and_fall`, `nursing_home_abuse`, `unknown`
- `medical_treatment_status`
  - Examples: `same_day_treatment`, `delayed_treatment`, `no_treatment`, `unknown`
- `commercial_vehicle_involved`
  - Examples: `yes`, `no`, `unknown`
- `qualification_path`
  - `qualified`
  - `review`
- `qualification_notes`
  - Internal summary only. Never shown to the visitor.
- `consult_link_offered`
  - `true` when the Calendly link has been shared.
- `follow_up_recommended`
  - `true` when the matter should be reviewed by the firm even if the lead was not clearly qualified.

## Minimum Data for a Viable Lead

Before ending a viable conversation, Evie should try to capture:

- visitor name
- phone number
- email address
- incident state
- incident type
- injury summary
- medical treatment status
- brief conversation summary

## Qualification Routing Guidance

### Mark as `qualified` when

- the incident appears to be in Georgia
- it sounds like a personal injury matter the firm may plausibly review
- there are meaningful injuries or facts suggesting a stronger case
- the visitor is willing to continue toward consultation

### Mark as `review` when

- the matter is outside Georgia
- the injury appears minor or unclear
- treatment is delayed or absent
- the practice area fit is uncertain
- the facts do not clearly support qualification but a firm review could still be worthwhile

## Conversation Summary Format

Use a concise internal summary such as:

`Visitor reports a truck collision in Atlanta, Georgia about one month ago with a broken wrist, lacerations, ER treatment, and follow-up care. Commercial delivery vehicle involved. Consult link offered after contact capture.`
