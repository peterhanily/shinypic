# Security policy

ShinyPic is a small, local-first image editor. Its privacy design reduces the
number of places a photo can travel, but it is not a sandbox, an anonymity
tool, or a secure-erasure system. No software or deployment should be described
as “perfect OPSEC.” See the [threat model](docs/THREAT_MODEL.md) for the trust
boundaries and known limitations.

## Supported versions

Security fixes are made on the default branch and deployed to the current live
site. Old standalone downloads, forks, and third-party deployments are not
maintained by Caddy Labs. Reproduce a report against the latest default-branch
build where possible.

## Report a vulnerability privately

Please do not disclose a suspected vulnerability in a public issue, discussion,
pull request, screenshot, or social post.

1. Open this repository's **Security** tab.
2. Select **Report a vulnerability** to create a private GitHub Security
   Advisory.
3. If private reporting is unavailable, ask a maintainer for a private channel
   without including exploit details in the request.

Include:

- the affected commit or live URL;
- the browser, operating system, and whether the PWA or standalone file was
  used;
- clear reproduction steps and the observed impact;
- a minimal proof of concept made with synthetic, non-sensitive media; and
- any suggested mitigation, if you have one.

Do not send an original private photo, credentials, access tokens, personal
data, or weaponized files. Redact logs and screenshots. The maintainers will
triage reports on a best-effort basis, coordinate a fix and disclosure when
appropriate, and credit reporters who want attribution. This project does not
promise a response SLA or bug bounty.

## Security properties and limits

- Photo processing and export are implemented in the browser. The application
  has no image-upload endpoint, account system, analytics SDK, or runtime
  package dependency.
- Selected source files are represented by browser object URLs and are not
  placed in the service-worker cache or `localStorage`. Only editor preferences
  are stored in `localStorage`.
- Exports are newly rasterized by the browser canvas. ShinyPic does not copy
  source EXIF, GPS, XMP, or IPTC blocks into the output; it adds the committed
  Rec.2100 PQ ICC profile to the HDR JPEG. Visible details in the pixels are not
  redacted, and the output filename is derived from the source filename.
- The JavaScript served by a deployment can read a photo after the user selects
  it. A compromised host, build, browser, extension, operating system, or share
  target is outside the protection offered by local processing.
- Image decoding is delegated to the browser. Avoid opening hostile or unknown
  files, and keep the browser and operating system updated.
- A receiving app or website can log, re-encode, flatten, or strip HDR data from
  an exported image. Review the destination before sharing.

For operational details and mitigations, read
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).
