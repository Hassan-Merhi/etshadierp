#!/usr/bin/env python3
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import argostranslate.package
import argostranslate.translate

HOST = "127.0.0.1"
PORT = 8765
BATCH_MARKER_RE = re.compile(r"ZXQI18N\d+ZXQ")
PLACEHOLDER_RE = re.compile(r"ZXQPH\d+X\d+ZXQ")


def install_models():
    print("Updating Argos package index...", flush=True)
    argostranslate.package.update_package_index()
    packages = argostranslate.package.get_available_packages()
    for target in ("fr", "ar"):
        installed = {
            (language.code, translated.code)
            for language in argostranslate.translate.get_installed_languages()
            for translated in language.translations_to
        }
        if ("en", target) in installed:
            continue
        package = next(
            (
                candidate
                for candidate in packages
                if candidate.from_code == "en" and candidate.to_code == target
            ),
            None,
        )
        if package is None:
            raise RuntimeError(f"No Argos English->{target} package is available")
        print(f"Downloading Argos English->{target} model {package.package_version}...", flush=True)
        model_path = package.download()
        argostranslate.package.install_from_path(model_path)


def build_translators():
    languages = {language.code: language for language in argostranslate.translate.get_installed_languages()}
    english = languages.get("en")
    if english is None:
        raise RuntimeError("Argos English language is not installed")
    translators = {}
    for target in ("fr", "ar"):
        language = languages.get(target)
        if language is None:
            raise RuntimeError(f"Argos target language {target} is not installed")
        translators[target] = english.get_translation(language)
    return translators


install_models()
TRANSLATORS = build_translators()
print("Argos Phase 3 translation engine ready.", flush=True)


def translate_static(text, target):
    if not text or not re.search(r"[A-Za-z]", text):
        return text
    return TRANSLATORS[target].translate(text)


def translate_preserving_placeholders(text, target):
    pieces = []
    cursor = 0
    for match in PLACEHOLDER_RE.finditer(text):
        pieces.append(translate_static(text[cursor : match.start()], target))
        pieces.append(match.group(0))
        cursor = match.end()
    pieces.append(translate_static(text[cursor:], target))
    return "".join(pieces)


def translate_payload(text, target):
    # The Node generator batches entries as MARKER + newline + source. Keep
    # markers byte-for-byte stable and translate each source independently so
    # model tokenization cannot corrupt batch boundaries.
    markers = list(BATCH_MARKER_RE.finditer(text))
    if not markers:
        return translate_preserving_placeholders(text, target)

    output = []
    for index, marker in enumerate(markers):
        start = marker.end()
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        source = text[start:end]
        leading = "\n" if source.startswith("\n") else ""
        if leading:
            source = source[1:]
        source = source.rstrip("\n")
        output.append(marker.group(0))
        output.append(leading)
        output.append(translate_preserving_placeholders(source, target))
        if index + 1 < len(markers):
            output.append("\n")
    return "".join(output)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stdout.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stdout.flush()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            body = json.dumps({"ok": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path != "/translate_a/single":
            self.send_error(404)
            return

        params = parse_qs(parsed.query)
        target = params.get("tl", [""])[0]
        source = params.get("q", [""])[0]
        if target not in TRANSLATORS:
            self.send_error(400, f"Unsupported target: {target}")
            return

        try:
            translated = translate_payload(source, target)
        except Exception as exc:  # pragma: no cover - diagnostic server path
            print(f"Translation failure: {exc}", file=sys.stderr, flush=True)
            self.send_error(500, str(exc))
            return

        # Match the small subset of the Google GTX response consumed by the
        # temporary Node generator: data[0][*][0] joined into one string.
        payload = [[[translated, source, None, None]], None, "en"]
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
