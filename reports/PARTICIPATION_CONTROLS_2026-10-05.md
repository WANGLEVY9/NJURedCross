# Participation control presentation

Updated the activity detail back link, blood vehicle participation guide, registration feedback, and leave/check-in disclosure cards. Existing registration and attendance APIs and approval rules remain unchanged.

Validation: npm run verify passed (124 JavaScript modules, 61 Markdown documents; 103 identity, 28 volunteer profile and 84 Node regression cases). git diff --check passed. Synthetic browser preview confirmed desktop presentation, disclosure interaction and a 320 CSS pixel viewport without horizontal overflow. No registration, leave request, attendance, email or production data was submitted during UI checks.

Deployment: only the two changed frontend files are synchronized to /opt/njuredcross; no service restart is needed for static files. Production configuration remains separate.
