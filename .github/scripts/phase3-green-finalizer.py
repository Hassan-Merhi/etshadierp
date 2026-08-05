from pathlib import Path

# The source patch already contains the reviewed Phase 3 implementation. Main
# may independently acquire the remote-screen scale test correction while this
# branch is validating, so only normalize that assertion when the old value is
# still present.
screen_test = Path("client/src/hooks/screen-feed-viewing-quality.test.ts")
screen_source = screen_test.read_text()
old_screen = "expect(getScreenFeedCaptureScale(2)).toBe(1.25);"
new_screen = "expect(getScreenFeedCaptureScale(2)).toBe(1);"
if old_screen in screen_source:
    screen_test.write_text(screen_source.replace(old_screen, new_screen, 1))

# Newer main introduced a TypeScript-6-style generic Uint8Array annotation,
# while the repository lockfile still resolves declarations where Uint8Array is
# non-generic. Plain Uint8Array expresses the same runtime contract and remains
# compatible with both declaration generations.
buffer_helper = Path("server/lib/bufferCompatibility.ts")
if buffer_helper.exists():
    buffer_source = buffer_helper.read_text()
    old_buffer = "Uint8Array<ArrayBufferLike>"
    if old_buffer in buffer_source:
        buffer_helper.write_text(buffer_source.replace(old_buffer, "Uint8Array", 1))
