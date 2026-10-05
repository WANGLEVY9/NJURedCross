# Registration guidance layout

Introduced a shared guidanceCards component for blood vehicle and ordinary activity details. Each item has a 42px icon tile, 22px geometric SVG, aligned heading and description. Added a camera icon for photo attendance and a people icon for replacement registration. The three guidance cards stack on mobile.

Reviewed related public forms: notices now use a fixed 20px icon column and wrapping text; community fact lists use 18px icons; form progress uses larger markers and three equal columns below 400px. Verified blood detail at desktop, 390px and 320px; materials progress and community notices at 320px without horizontal overflow. Browser preview is synthetic and no business forms were submitted.

Validation: npm run verify passed with 103 identity, 28 profile and 84 Node tests; JavaScript and documentation checks plus lint passed. CSS-only narrow-screen step adjustment was subsequently verified in browser. Production runtime file hashes and service state are checked separately after deployment.
