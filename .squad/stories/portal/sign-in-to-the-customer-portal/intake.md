# Story intake

- Folder: `.squad/stories/portal/sign-in-to-the-customer-portal/intake.md`
- Source: Notion User Stories database, `US-21`
  (https://app.notion.com/p/3c69e083852381b9959edda7aebfcc90)

---

## Feature

- **Feature name (display):** Portal
- **Feature slug (folder under `plans/`):** `portal`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-21`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P02 Auth & Access - Full-stack - MVP - Must have - Persona: Customer -
  Screen: Login, Portal Home - Design File: `03-login.md`

---

## Title

```
Sign in to the customer portal
```

---

## Description

```
As a customer
I want a simple portal sign-in
So that I can reach my requests without navigating the staff application.
```

---

## Acceptance criteria

```
AC1 - Portal login
Given valid customer credentials
When I sign in at the portal URL
Then I land on the portal home, never on the staff dashboard.

AC2 - Audience isolation
Given a staff account
When it is used on the portal login form
Then sign-in is refused with a message pointing to the staff login.

AC3 - Guest browsing
Given I am not signed in
When I visit the portal
Then I can still browse the knowledge base, but submitting a request prompts me
to sign in or register.

AC4 - Post-login redirect
Given I tried to open a specific request before signing in
When I complete sign-in
Then I am taken to that request rather than the home page.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `03-login.md` is not in this repository. | |

---

## Dependencies

- **`US-20` (registration) is the stated dependency and is deferred.** Portal accounts
  come from the seed, which `.squad/plans/00-mvp-scope.md` decided when it cut US-20.
- `US-14` built the login flow, the throttle, and the `crm-portal` audience that no
  caller has ever passed. `AuthService.login` already takes it as a parameter.
- `US-82` established the portal API and its audience enforcement, with tests in both
  directions. **That enforcement must not change.**
- `US-23` `RequireAuth` already carries the attempted path in route state, which is AC4.

## Extra notes

- Position 21 of 28.
- **AC3 is largely unbuildable.** The knowledge base is all of P09, cut entirely; and
  "register" is US-20, deferred. There is no "submit a request" control to gate either —
  that is US-86.
- What makes an account a portal account is the `Customer.userId` link, the same fact
  US-82 scopes every portal query on. Not a role name.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- Passwordless magic-link login - V2, stated by the story.
- Registration - `US-20`.
- Submitting a request - `US-86`.
- The request list - `US-84`.
