# Synthetic SMTP TLS fixture

This public test key is intentionally non-secret and must never be used by a real service. The self-signed certificate covers only `mail.fixture.test` and loopback `127.0.0.1`, is valid from 2020 through 2040, and is trusted explicitly by isolated tests. Release packaging excludes the entire tests directory.
