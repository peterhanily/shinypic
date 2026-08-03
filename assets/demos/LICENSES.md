# Demo asset notes

The three photographic samples (`neon-rain.jpg`, `crystal-light.jpg`, and
`iris-after-rain.jpg`) were generated specifically for ShinyPic with OpenAI's
image generation tool. They contain no EXIF, GPS, XMP, people, brands, or
readable text. They are included under the repository's MIT license.

| File | SHA-256 |
| --- | --- |
| `neon-rain.jpg` | `5931da4c27ddbf6e5d5d755f3a4f1cfc050223b38cca0c7c7dd1c8fa9feee1ee` |
| `crystal-light.jpg` | `059b4b469babd7568debb4c8a3b6f93deb4e117b588a8f4dd45d505cc01c5149` |
| `iris-after-rain.jpg` | `fd832d50aaba9c279bcceace6b2cb785473c78e509a071b6387c3a90214e7c0c` |

`chainlink-original-hdr.jpg` is the exact 200 × 200 progressive JPEG supplied
by the project maintainer for the technical investigation. It was retrieved on
2026-08-03 from a LinkedIn media CDN URL whose path labels it
`chainlink_labs_logo`, and has SHA-256
`b9c8e92bafdc0eecde562514670f2181c2d71f42ded7da8baed70e0b40a73594`.
Independent inspection found a progressive 8-bit JPEG with a 6,604-byte Adobe
`Rec. 2020 PQ` ICC profile and no EXIF, XMP, animation or gain-map payload. The
CDN URL documents where the bytes were retrieved; it does not establish who
created the artwork, who owns it, whether it is official, or what license
applies. Its expiring signed query string is intentionally not preserved here.

`chainlink-case-study-sdr.jpg` is a ColorSync conversion of that file to
`sRGB IEC61966-2.1`. It gives the editor a normal-range source from which to
rebuild the HDR effect instead of feeding an already-HDR image back into the
conversion pipeline. Its SHA-256 is
`a0432c3c8ba0e4b4a499c6766628f85dedc7f40576b04617e79299b31b3cbd12`.

These two files and the derived example exports in `docs/examples/` are
included at the project maintainer's request solely as the technical reference
that motivated ShinyPic. No ownership, endorsement or open-source license is
asserted for the artwork. All rights remain with the applicable rights holder,
and these images are excluded from the repository's MIT license.
