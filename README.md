# SocialFit Origins Preview

A responsive, interactive microsite linked from the Origins email. The complete frontend is in one `index.html` file and preserves the approved SocialFit design, copy and two preview paths: Try a Signal and See a Circle.

## Frontend stack

- Tailwind CSS Browser CDN 4.3.3
- Alpine.js CDN 3.17.2
- One HTML file
- No package install, bundler or frontend build step

The CDN versions are pinned in `index.html`. Internet access is required when the page loads. The small Node server exists only to protect the preview with signed Origins links and serve the HTML securely.

## Host it

1. Create a Node.js project.
2. Extract this package at the project root.
3. Add an environment variable named `ORIGINS_LINK_SECRET`. Use a random value at least 32 characters long. Never place it in the code.
4. Run `npm start`, then deploy the project.
5. Generate the personal Origins links and import them into Brevo before sending the welcome email.

The included `.replit` file makes this immediately runnable on Replit, but the package is not Replit-specific. Any Node 18+ host can serve it unchanged.

For frontend-only review, `index.html` can also be opened or hosted on its own. That bypasses the Origins gate and should not be used for the shared link.

For temporary local design review only, set `ORIGINS_GATE_DISABLED=true`. Do not set this on the shared or production deployment.

## Origins-only access

The server is closed by default. It serves the preview only after validating a signed, time-limited Origins link. A valid link creates an HttpOnly access cookie and immediately redirects to a clean URL, so the invitation token is removed from the address bar.

Prepare a plain text file with one Origins email address per line, then generate a Brevo-ready CSV:

```bash
ORIGINS_LINK_SECRET="the-same-secret-used-in-replit" \
npm run generate:origins-links -- origins-emails.txt https://origins-preview.your-domain.com 30 \
> origins-preview-links.csv
```

The final number is the number of days for which the links remain valid. The generated CSV contains:

- `EMAIL`
- `ORIGINS_PREVIEW_URL`

Import the second field into a Brevo contact attribute with the same name. Set the separate Brevo button beneath the email HTML to:

```text
{{ contact.ORIGINS_PREVIEW_URL }}
```

Button text: `Enter the Origins Preview →`

Delete the local email list and generated CSV after the Brevo import. If the signing secret is rotated, every previously generated link and session becomes invalid.

## Connect the two final actions

Near the top of `index.html`, edit only this object:

```js
window.SOCIALFIT_PREVIEW_CONFIG = {
  keyRequestEndpoint: '',
  csrfToken: ''
};
```

`keyRequestEndpoint` is the authenticated backend route that records a request for more Keys. The POST uses the person’s same-origin session and sends only `{ "source": "origins_interactive_preview" }`; the backend should derive identity from the verified session. Set `csrfToken` only if that route requires an `X-CSRF-Token` header.

The excitement CTA currently records an analytics event and shows its acknowledgement state. The extra-Key CTA records the backend request when an endpoint is configured. With the endpoint blank, both work locally so the complete presentation can be reviewed without backend setup.

To connect analytics, listen for the `socialfit:demo` CustomEvent or load the existing GA4 setup before this file. If `window.gtag` exists, events are forwarded automatically.

## Circle

The preview focuses on the purpose of Inner, Support and Affinity: closeness and trust, care and encouragement, and shared interests and outlook. It explains private placement by the member, existing and new relationships, and how shared time nurtures them. All descriptions are visible together. The two entry paths are Try a Signal and See a Circle. Circle explains the three relationship tiers and finishes immediately with the shared final CTAs. It does not restart the Signal journey.

## Final CTAs

“I’m excited. I can’t wait to start my onboarding.” acknowledges excitement and reminds the person to watch for their Founder Key. “Request more Keys to gift to friends” is also a single-click action. It calls the configured backend endpoint, confirms receipt, and reveals the other preview branch. It records interest only; it does not issue Keys. With the endpoint left blank, the standalone demo shows the success state locally for presentation.

## Boundaries

People, responses, travel times and acceptance are illustrative. No live matching, accounts, invitations, chat, bookings, payment or emails are implemented. A Room requires at least 2 people total: the user and one invited respondent. In the demo, invited respondents accept automatically. Context changes clear earlier responses and invitations. State is in memory.

The signed personal link is the access credential for this pre-onboarding preview. It prevents the public Replit URL from exposing the HTML. Like any personal invitation link, it can be forwarded by its recipient. If access must be bound to verified identity, replace the signed-link check with the authenticated Origins member session once that account layer is available.

## Analytics

`track()` dispatches `socialfit:demo` CustomEvents, and forwards to GA4 only if a configured `window.gtag` exists. No analytics script or measurement ID is included. Events are tagged `demo: true` and should stay separate from real activation metrics. Connect analytics under your existing consent approach.

Events: `demo_started`, `demo_choice_selected`, `demo_signal_sent`, `demo_responses_viewed`, `demo_invitation_toggled`, `demo_room_formed`, `demo_plan_agreed`, `demo_circle_opened`, `demo_onboarding_excitement_selected`, `demo_extra_keys_requested`, `demo_extra_keys_request_failed`.

## Handoff checks

Before sending the Brevo email:

1. Set `ORIGINS_LINK_SECRET` on the host.
2. Configure and test `keyRequestEndpoint` if the request should be stored now.
3. Connect analytics under the existing consent approach.
4. Generate a signed link for each Origins member.
5. Test one complete Signal path and one complete Circle path on desktop and mobile.
6. Confirm that a bare public URL returns the private access page.

Both branches end with the same two CTAs. After either is selected, the other branch is offered, so a person can explore both without returning to the email.
