# Lessons — Ask Frosty

Every mistake, what it cost, and the rule that prevents it.

### 1. Ask Frosty failed on every FHL question (2026-11-15)
- **What happened:** "Failed to create chat session." The chat session row was
  saved with the profile id; the database only accepts the login id. On HVAC
  the two are equal, on FHL they are not, so nobody had noticed.
- **Cost:** Ask Frosty was useless on FHL from the day it shipped.
- **Rule:** anything keyed to "who is signed in" uses the auth user id
  (`authUser.id`), never the profile row id. frosty-saas #584.

### 2. It answered from documents only (2026-11-15)
- **What happened:** "Frosty isn't any help." It could not see leads, quotes
  or money unless a keyword in the question happened to trigger a read.
- **Rule:** give it look-up tools and tell it to use them instead of saying it
  has no access. frosty-saas #584.

### 3. It could not act (2026-11-15)
- **What happened:** "Can you take action?" — "No, I'm read-only."
- **Rule:** actions as confirm-first cards on the existing endpoints (this
  repo, v0.2).
