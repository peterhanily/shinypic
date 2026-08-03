# Contributing to ShinyPic

Thanks for helping make ShinyPic more useful, understandable, and safe. Small,
focused changes are easiest to review.

## Local setup

ShinyPic requires Node.js 20 or newer and currently has no third-party package
dependencies.

```sh
npm start
npm test
npm run build
npm run build:single
```

The normal static build is written to `dist/`. The offline, single-file build
is written to `dist-single/`. Both directories are generated and should not be
committed.

Before opening a pull request:

1. Test the normal site and the standalone `file://` build.
2. Test at least one narrow mobile viewport and one desktop viewport.
3. Run the test suite and both build commands.
4. If the HDR pipeline changed, test a real HDR-capable path and an SDR fallback
   and update `docs/HDR_PIPELINE.md`.
5. Explain privacy, compatibility, and memory implications in the pull request.

## Privacy and security guardrails

ShinyPic's useful promise is that editing does not require sending a photo to a
server. Contributions must preserve that property unless a future change is
explicitly proposed, documented, and opt-in.

- Do not add analytics, tracking pixels, remote fonts, third-party scripts,
  automatic uploads, or hidden network requests.
- Do not log filenames, image contents, object URLs, exported blobs, or editor
  settings to a remote service.
- Treat filenames, pixels, EXIF, GPS, colour profiles, and thumbnails as
  potentially sensitive.
- Prefer browser and Node.js platform APIs. A new dependency needs a concrete
  justification, a license check, a maintenance review, and a discussion of
  its effect on the standalone build and supply-chain risk.
- Avoid `innerHTML`, dynamic code execution, and string-built URLs for
  untrusted input. Validate file type, size, dimensions, and parser results at
  every boundary.
- Keep GitHub Actions permissions minimal and pin third-party actions to full
  commit hashes. Dependabot is configured to propose action updates.
- Report vulnerabilities using `SECURITY.md`, not a public issue.

The detailed trust boundaries and non-goals are in
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Demo media

Only add media that is original to the contributor, public domain, or available
under a license compatible with redistribution. Record its source and license
in the documentation that introduces it.

Demo images must not contain private people, home addresses, precise location
clues, vehicle plates, credentials, device identifiers, or other sensitive
information. Remove source metadata before committing, use a descriptive
filename, and keep the file reasonably small. Do not use a private photo merely
because its metadata was removed—the visible pixels can still identify a
person or place.

## Pull requests

- Link the issue or explain the user problem.
- Keep unrelated formatting and generated output out of the change.
- Include before/after images only when useful, using safe demo media.
- Add or update tests for behavior changes.
- Document browser-specific behavior honestly. Do not claim universal HDR
  support from a single device test.

By contributing, you agree that your contribution is licensed under the
project's MIT License and that you have the right to submit it.
