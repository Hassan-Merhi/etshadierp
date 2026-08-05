from pathlib import Path

# The source patch already contains the reviewed Phase 3 implementation. Main
# may independently acquire the remote-screen scale test correction while this
# branch is validating, so only normalize that assertion when the old value is
# still present. Do not rewrite unrelated current-main files.
path = Path("client/src/hooks/screen-feed-viewing-quality.test.ts")
source = path.read_text()
old = "expect(getScreenFeedCaptureScale(2)).toBe(1.25);"
new = "expect(getScreenFeedCaptureScale(2)).toBe(1);"
if old in source:
    path.write_text(source.replace(old, new, 1))
