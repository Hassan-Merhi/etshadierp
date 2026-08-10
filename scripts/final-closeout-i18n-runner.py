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

targets = [finding for finding in report['findings'] if is_target(finding)]
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
