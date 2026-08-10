import json
import pathlib
import re
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
report_path = pathlib.Path('/tmp/final-closeout-runner-audit.json')
subprocess.run(
    [
        'node',
        'scripts/audit-i18n-phase14.mjs',
        '--json-out',
        str(report_path),
        '--markdown-out',
        '/tmp/final-closeout-runner-audit.md',
    ],
    cwd=root,
    check=True,
)
report = json.loads(report_path.read_text(encoding='utf-8'))

inventory_files = {
    'client/src/pages/location-inventory/LocationWhatsappScheduleDialog.tsx',
    'client/src/pages/location-inventory/LocationWhatsappDeliveryHistoryDialog.tsx',
    'client/src/pages/location-inventory/LocationDialogs.tsx',
    'client/src/pages/location-inventory/LocationInventoryHeader.tsx',
}
sales_file = 'client/src/pages/CustomerInvoiceCreate.tsx'
sales_targets = {
    ('jsx-attribute', 'placeholder', 'Scan or type bale code...'),
    ('jsx-attribute', 'placeholder', 'Charge name...'),
    ('jsx-text', None, 'No bales scanned yet'),
    ('jsx-text', None, 'Freight'),
    ('jsx-text', None, 'Other'),
}

def is_target(finding):
    if finding['status'] != 'actionable':
        return False
    if finding['module'] in {'backend-messages', 'supplier-partner'}:
        return True
    if (
        finding['module'] == 'inventory-logistics'
        and finding['file'] in inventory_files
        and '${' not in finding['text']
    ):
        return True
    if finding['module'] == 'sales-pos' and finding['file'] == sales_file:
        return (finding['kind'], finding.get('name'), finding['text']) in sales_targets
    return False

def finding_key(finding):
    return (
        finding['file'],
        finding['kind'],
        finding.get('name'),
        finding['text'],
    )

targets = [finding for finding in report['findings'] if is_target(finding)]
initial_target_keys = {finding_key(finding) for finding in targets}
by_file = {}
for finding in targets:
    by_file.setdefault(finding['file'], []).append(finding)

plain_text_pattern = re.compile(r'>([^<>{}\n][^<>{]{1,160})<')
for file, findings in by_file.items():
    path = root / file
    if not path.exists():
        continue
    lines = path.read_text(encoding='utf-8').splitlines()
    changed = False

    for finding in sorted(findings, key=lambda item: item['line'], reverse=True):
        if finding['kind'] != 'error-constructor':
            continue
        index = finding['line'] - 1
        if index < 0 or index >= len(lines):
            continue
        opener = lines[index]
        if re.search(r'(?:new\s+Error|Error|send|statusText)\s*\(\s*[`"\']', opener):
            continue
        text = finding['text']
        end = min(len(lines), index + 5)
        literal_index = None
        literal_line = None
        for candidate_index in range(index + 1, end):
            candidate = lines[candidate_index].strip()
            if text in candidate and candidate[:1] in {'`', '"', "'"}:
                literal_index = candidate_index
                literal_line = candidate
                break
        if literal_index is None or literal_line is None:
            continue
        close_index = literal_index + 1
        while close_index < end and lines[close_index].strip() == '':
            close_index += 1
        if close_index >= len(lines) or lines[close_index].strip() not in {');', ')'}:
            continue
        indent = opener[: len(opener) - len(opener.lstrip())]
        constructor = opener.strip()
        if not constructor.endswith('('):
            continue
        lines[index : close_index + 1] = [f'{indent}{constructor}{literal_line});']
        changed = True

    for finding in sorted(findings, key=lambda item: item['line'], reverse=True):
        if finding['kind'] != 'jsx-text':
            continue
        index = finding['line'] - 1
        if index < 0 or index >= len(lines):
            continue
        line = lines[index]
        text = finding['text']
        if any(match.group(1).strip() == text for match in plain_text_pattern.finditer(line)):
            continue
        stripped = line.rstrip()
        if not stripped.endswith(text):
            continue
        prefix = stripped[:-len(text)]
        if '>' not in prefix:
            continue
        trailing = line[len(stripped):]
        lines[index] = prefix.rstrip() + f'<span>{text}</span>' + trailing
        changed = True
    if changed:
        path.write_text('\n'.join(lines) + '\n', encoding='utf-8')

subprocess.run(['python', 'scripts/final-closeout-i18n-once.py'], cwd=root, check=True)

post_path = pathlib.Path('/tmp/final-closeout-runner-post.json')
subprocess.run(
    [
        'node',
        'scripts/audit-i18n-phase14.mjs',
        '--json-out',
        str(post_path),
        '--markdown-out',
        '/tmp/final-closeout-runner-post.md',
    ],
    cwd=root,
    check=True,
)
post = json.loads(post_path.read_text(encoding='utf-8'))
residual = [
    finding
    for finding in post['findings']
    if finding['status'] == 'actionable' and finding_key(finding) in initial_target_keys
]
if residual:
    print('Residual initial closeout targets after codemod:')
    for finding in residual:
        print(json.dumps({
            'module': finding['module'],
            'file': finding['file'],
            'line': finding['line'],
            'kind': finding['kind'],
            'name': finding.get('name'),
            'text': finding['text'],
        }, ensure_ascii=False))
