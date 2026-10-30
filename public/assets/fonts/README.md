# PDF font

`finance-report.ttf` is the renamed **NJU Finance Report** subset of the pinned
LXGW WenKai Regular source recorded in `roles/manifest.json`. It covers the
existing Kai web shards plus Latin text, numbers and punctuation used by reports.
It is embedded into generated reimbursement PDFs and does not change web fonts.

Copyright and SIL Open Font License 1.1: [roles/kai-LICENSE.txt](roles/kai-LICENSE.txt).
The font source URL and SHA-256 are recorded in the existing roles manifest.

Regenerate with fonttools and brotli installed:

```text
python scripts/build-finance-report-font.py /path/to/LXGWWenKai-Regular.ttf
```

Output SHA-256: `ac57234c20b239c1824b9dfdad73798ff25b170d565e869cbf6bbfc8d808426d`.
