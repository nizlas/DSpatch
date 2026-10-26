# Example review: the DSP-116 walk

`dsp-116.review.json` is a prepared code walk over two revisions of DSpatch itself,
bundled so that a second reviewer can open it from the main window and assess the
review's code view (DSP-129). It is an example, not a precondition for review: review
opens any `*.review.json` definition, and nothing in DSpatch depends on this file.

- **Origin.** The definition written for the DSP-116 review preparation (base
  `5e445c3305b019f43f3a319cc74d802bc748eae9`, target
  `73aaddc1e7d69662159bab117feedfb92384f85c`; walks W1 10, W2 8 and W3 4 steps), file
  SHA-256 `9c6119d8414cea16bd83bac9efe7cf6a0594b930aaf7c2ab4db4f12f0f741ee3`.
- **The one change.** `repository` went from `"repo"` to `"../.."`, the clone root
  relative to this file, so the review reads the two revisions from whichever clone it is
  opened in. Every other field, including the Swedish and English explanations, the code
  references and the walks, is unchanged. SHA-256 of the bundled file:
  `5290652ed25562ffe9b74d3bb1702196473ce19b6d9a2f26dfb3ad63d796ad56` with CRLF line ends
  (as the original, and a Windows checkout with `core.autocrlf=true`),
  `e05d684f6f1d0ec201f86bf66a412cdf6795c4a2ca47e9f6f718fdbd20e54873` with LF line ends
  (as stored in git, and a checkout without line-end conversion).
- **What it needs.** A full clone of the DSpatch repository holding both revisions. A
  shallow clone or a copy without its history does not have them; review then says so
  and shows nothing in their place.
- **How to open it.** *Open example review* beside *Open review*, or **File → Open
  Example Review**, in DSpatch running from that clone. The reviewer's notes, decisions
  and position are kept in DSpatch's user data (`userData/reviews/`), never in this file.
