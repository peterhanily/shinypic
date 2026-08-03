# Verified woven-logo HDR case study

The exact source and its ShinyPic reproduction are kept separate so the test is
honest: the editor starts from a colour-managed SDR conversion, not from an
image that already contains HDR values.

| File | Role | Profile reported by macOS `sips` | SHA-256 |
| --- | --- | --- | --- |
| `../../assets/demos/chainlink-original-hdr.jpg` | Exact supplied source | `Rec. 2020 PQ` | `b9c8e92bafdc0eecde562514670f2181c2d71f42ded7da8baed70e0b40a73594` |
| `../../assets/demos/chainlink-case-study-sdr.jpg` | ColourSync SDR editor input | `sRGB IEC61966-2.1` | `a0432c3c8ba0e4b4a499c6766628f85dedc7f40576b04617e79299b31b3cbd12` |
| `chainlink-shiny-hdr.jpg` | ShinyPic Sparkle output | `Rec. ITU-R BT.2100 PQ` | `37a6fbc6da2f4f9573012c1dc344a35f3eeaced44ef8fce6dc6fa3587545fb67` |
| `chainlink-sdr-glow.jpg` | Universal glow fallback | `sRGB` | `68f346ef8781b542640f993c9797bff56dfe6cac8d52c4ee9afaec9135d6735e` |

All four files are 200 × 200, 8-bit JPEGs. The supplied source is progressive;
the two ShinyPic outputs are freshly rasterized baseline JPEGs. Raw channel
codes in the supplied PQ source peak at `0.95294`; inverse ST 2084 decoding puts
those peak channels in the several-thousand-nit nominal range. These are
encoded values, not a measurement of any screen.

GitHub, messaging applications, and image pipelines may tone-map, flatten, or
remove HDR, so download the exact bytes before judging the effect. The supplied
artwork, its SDR conversion, and the derived examples are excluded from the MIT
license; see [`assets/demos/LICENSES.md`](../../assets/demos/LICENSES.md).
