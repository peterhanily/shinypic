# HDR profile and JPEG pipeline

## Profile origin

`assets/rec2100-pq.icc` is exported from the current macOS ColorSync/CoreGraphics implementation. It is not a hand-authored or downloaded profile. The exporter creates `kCGColorSpaceITUR_2100_PQ` (`CGColorSpace.itur_2100_PQ`) and writes the bytes returned by `CGColorSpace.copyICCData()`.

The committed profile makes builds reproducible on non-macOS hosts. Re-exporting may produce different bytes on a different macOS release because Apple owns the system profile implementation.

## Exporting

Run this from the repository root on macOS 11 or newer:

```sh
swift scripts/export-rec2100-pq.swift assets/rec2100-pq.icc
```

The script creates the destination directory, writes atomically, and reports the CoreGraphics color-space name and byte count.

### Committed asset verification

The checked-in export was produced on macOS with the 26.4 SDK and has:

- ICC description: `Rec. ITU-R BT.2100 PQ`
- ICC version/type: v4.0 RGB display profile with XYZ profile connection space
- Size: 13,300 bytes (matching the length declared in the ICC header)
- SHA-256: `63cd9f4a8443c71df3633aa0a2ec4594aa8fbca23b1a3231b517bc726a567b16`

On macOS, `file assets/rec2100-pq.icc`, `wc -c assets/rec2100-pq.icc`, and `shasum -a 256 assets/rec2100-pq.icc` reproduce those checks.

## What the profile signals

The profile describes Rec.2100/BT.2020 RGB colorimetry with the PQ (SMPTE ST 2084) absolute-luminance transfer function. When it is embedded in an image, an HDR-aware color pipeline can map PQ values into the display's available HDR headroom. The profile does not add a gain map and does not make the decoded pixels brighter by itself.

Support remains pipeline-dependent. ColorSync-based Apple applications and HDR-capable browsers/displays are the primary target. Other decoders may tone-map, clamp to SDR, ignore the profile, or strip it while transcoding. Keep an SDR fallback and do not rely on the profile as the only copy of uploaded content.

## Important: 8-bit JPEG is not an ISO HDR-JPEG format

The output image can be a valid, ordinary 8-bit JPEG carrying this ICC profile, and both Rec.2100 and PQ are standards. However, the combination is **not a broadly interoperable ISO-defined HDR still-image packaging format**. It has no HDR gain map and is not equivalent to ISO 21496-1 gain-map JPEG, HEIF, or AVIF HDR signalling.

Eight-bit PQ also provides only 256 code values per channel before JPEG compression, so gradients can band and chroma detail can be damaged. Treat this profile-only JPEG path as a targeted compatibility technique for small, high-contrast artwork. Preserve a higher-bit-depth master, retain an SDR derivative, and test each intended browser/display combination.
