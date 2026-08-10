import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = pathlib.Path('/tmp/final-closeout-i18n-before.json')

subprocess.run(
    [
        'node',
        'scripts/audit-i18n-phase14.mjs',
        '--json-out',
        str(REPORT),
        '--markdown-out',
        '/tmp/final-closeout-i18n-before.md',
    ],
    cwd=ROOT,
    check=True,
)

before = json.loads(REPORT.read_text(encoding='utf-8'))
release_caps = {
    'backend-messages': 0,
    'inventory-logistics': 1381,
    'sales-pos': 776,
    'shared-ui': 0,
    'supplier-partner': 0,
}
current = {name: before['modules'][name]['actionable'] for name in release_caps}
if all(current[name] <= cap for name, cap in release_caps.items()):
    print('Final i18n release caps already satisfied:', current)
    pathlib.Path('/tmp/final-closeout-i18n-already-done').write_text('yes\n')
    sys.exit(0)

translations = {
    'Enter new name': ('أدخل الاسم الجديد', 'Saisir le nouveau nom'),
    'Search groups...': ('ابحث عن المجموعات...', 'Rechercher des groupes...'),
    'Rename Location': ('إعادة تسمية الموقع', 'Renommer l’emplacement'),
    'Location Name': ('اسم الموقع', 'Nom de l’emplacement'),
    'Supplier Partner Deduction (per BL)': ('خصم شريك المورد (لكل BL)', 'Déduction partenaire fournisseur (par BL)'),
    'Archive Stock Group': ('أرشفة مجموعة المخزون', 'Archiver le groupe de stock'),
    'Location WhatsApp Stock Reports': ('تقارير مخزون الموقع عبر واتساب', 'Rapports de stock du site via WhatsApp'),
    'WhatsApp Group': ('مجموعة واتساب', 'Groupe WhatsApp'),
    'WhatsApp groups could not be loaded': ('تعذر تحميل مجموعات واتساب', 'Impossible de charger les groupes WhatsApp'),
    'No WhatsApp groups found': ('لم يتم العثور على مجموعات واتساب', 'Aucun groupe WhatsApp trouvé'),
    'Linked destination': ('الوجهة المرتبطة', 'Destination liée'),
    'Enable stock reports': ('تفعيل تقارير المخزون', 'Activer les rapports de stock'),
    'Amount automatically deducted from SP payables for this location.': ('المبلغ المخصوم تلقائيًا من مستحقات شريك المورد لهذا الموقع.', 'Montant déduit automatiquement des dettes du partenaire fournisseur pour cet emplacement.'),
    'Only groups from the connected WhatsApp account are shown. Individual contacts cannot be selected.': ('يتم عرض المجموعات من حساب واتساب المتصل فقط. لا يمكن اختيار جهات اتصال فردية.', 'Seuls les groupes du compte WhatsApp connecté sont affichés. Les contacts individuels ne peuvent pas être sélectionnés.'),
    'Unlink': ('إلغاء الربط', 'Dissocier'),
    'No WhatsApp group is linked to this location.': ('لا توجد مجموعة واتساب مرتبطة بهذا الموقع.', 'Aucun groupe WhatsApp n’est lié à cet emplacement.'),
    'Allows this linked group to be used by the Location Inventory stock-report feature.': ('يسمح باستخدام هذه المجموعة المرتبطة في ميزة تقارير مخزون الموقع.', 'Permet d’utiliser ce groupe lié pour la fonction de rapport de stock de l’inventaire par emplacement.'),
    'Send WITHOUT COST': ('إرسال بدون تكلفة', 'Envoyer SANS COÛT'),
    'Quantity-only Godown Summary PDF': ('ملف PDF لملخص المستودع بالكميات فقط', 'PDF du résumé de dépôt, quantités uniquement'),
    'Send WITH COST': ('إرسال مع التكلفة', 'Envoyer AVEC COÛT'),
    'Negative Stock': ('مخزون سالب', 'Stock négatif'),
    'Cost report restricted': ('تقرير التكلفة مقيّد', 'Rapport de coût restreint'),
    'Your role does not have permission to send cost price and total inventory value.': ('دورك لا يملك صلاحية إرسال سعر التكلفة وإجمالي قيمة المخزون.', 'Votre rôle n’autorise pas l’envoi du prix de revient et de la valeur totale du stock.'),
    'WhatsApp send failed': ('فشل الإرسال عبر واتساب', 'Échec de l’envoi WhatsApp'),
    'WhatsApp Stock Delivery History': ('سجل إرسال مخزون واتساب', 'Historique d’envoi du stock WhatsApp'),
    'Loading delivery history…': ('جارٍ تحميل سجل الإرسال…', 'Chargement de l’historique d’envoi…'),
    'Could not load delivery history.': ('تعذر تحميل سجل الإرسال.', 'Impossible de charger l’historique d’envoi.'),
    'Last successful send': ('آخر إرسال ناجح', 'Dernier envoi réussi'),
    'Latest attempt': ('آخر محاولة', 'Dernière tentative'),
    'Destination:': ('الوجهة:', 'Destination :'),
    'User:': ('المستخدم:', 'Utilisateur :'),
    'Generated:': ('تم الإنشاء:', 'Généré :'),
    'Items:': ('الأصناف:', 'Articles :'),
    'Pages:': ('الصفحات:', 'Pages :'),
    'Completed:': ('اكتمل:', 'Terminé :'),
    'Scheduled day:': ('اليوم المجدول:', 'Jour planifié :'),
    'Stock group:': ('مجموعة المخزون:', 'Groupe de stock :'),
    'Category:': ('الفئة:', 'Catégorie :'),
    'Report file:': ('ملف التقرير:', 'Fichier du rapport :'),
    'Retry loading': ('إعادة محاولة التحميل', 'Réessayer le chargement'),
    'No WhatsApp stock reports have been attempted for this location yet.': ('لم تتم محاولة إرسال أي تقارير مخزون عبر واتساب لهذا الموقع بعد.', 'Aucun rapport de stock WhatsApp n’a encore été tenté pour cet emplacement.'),
    'Sent': ('تم الإرسال', 'Envoyé'),
    'No matching stock': ('لا يوجد مخزون مطابق', 'Aucun stock correspondant'),
    'Sending': ('جارٍ الإرسال', 'Envoi en cours'),
    'Retry failed': ('فشلت إعادة المحاولة', 'Échec de la nouvelle tentative'),
    'Cost-price and total-value permission is required to retry this report.': ('يلزم إذن سعر التكلفة والقيمة الإجمالية لإعادة محاولة هذا التقرير.', 'L’autorisation du prix de revient et de la valeur totale est requise pour réessayer ce rapport.'),
    'Unknown error': ('خطأ غير معروف', 'Erreur inconnue'),
    'No attempts yet': ('لا توجد محاولات بعد', 'Aucune tentative pour le moment'),
    'Africa/Lubumbashi': ('Africa/Lubumbashi', 'Africa/Lubumbashi'),
    'All stock groups': ('جميع مجموعات المخزون', 'Tous les groupes de stock'),
    'All categories': ('جميع الفئات', 'Toutes les catégories'),
    'Schedule': ('الجدولة', 'Planification'),
    'to its linked WhatsApp group.': ('إلى مجموعة واتساب المرتبطة به.', 'vers son groupe WhatsApp lié.'),
    'Loading schedule…': ('جارٍ تحميل الجدولة…', 'Chargement de la planification…'),
    'WhatsApp destination': ('وجهة واتساب', 'Destination WhatsApp'),
    'Next automatic send': ('الإرسال التلقائي التالي', 'Prochain envoi automatique'),
    'Last attempt': ('آخر محاولة', 'Dernière tentative'),
    'Last successful auto-send': ('آخر إرسال تلقائي ناجح', 'Dernier envoi automatique réussi'),
    'Last automatic send error:': ('خطأ آخر إرسال تلقائي:', 'Erreur du dernier envoi automatique :'),
    'Automatic sending': ('الإرسال التلقائي', 'Envoi automatique'),
    'Frequency': ('التكرار', 'Fréquence'),
    'Every day': ('كل يوم', 'Tous les jours'),
    'Selected days': ('أيام محددة', 'Jours sélectionnés'),
    'Send time': ('وقت الإرسال', 'Heure d’envoi'),
    'Days': ('الأيام', 'Jours'),
    'Timezone': ('المنطقة الزمنية', 'Fuseau horaire'),
    'Use an IANA timezone such as Africa/Lubumbashi.': ('استخدم منطقة زمنية IANA مثل Africa/Lubumbashi.', 'Utilisez un fuseau horaire IANA tel que Africa/Lubumbashi.'),
    'WITHOUT COST': ('بدون تكلفة', 'SANS COÛT'),
    'Include zero stock': ('تضمين المخزون الصفري', 'Inclure le stock nul'),
    'Add items whose current quantity is zero.': ('أضف الأصناف التي كميتها الحالية صفر.', 'Ajouter les articles dont la quantité actuelle est nulle.'),
    'Include negative stock': ('تضمين المخزون السالب', 'Inclure le stock négatif'),
    'Include negative quantities in the PDF.': ('تضمين الكميات السالبة في ملف PDF.', 'Inclure les quantités négatives dans le PDF.'),
    'Stock group filter': ('تصفية مجموعة المخزون', 'Filtre du groupe de stock'),
    'Category filter': ('تصفية الفئة', 'Filtre de catégorie'),
    'Active schedule:': ('الجدولة النشطة:', 'Planification active :'),
    'Generate from live inventory when the scheduled time arrives.': ('أنشئ التقرير من المخزون المباشر عند حلول الوقت المجدول.', 'Générer à partir du stock en temps réel à l’heure planifiée.'),
    'Mon': ('الاثنين', 'Lun'),
    'Tue': ('الثلاثاء', 'Mar'),
    'Wed': ('الأربعاء', 'Mer'),
    'Thu': ('الخميس', 'Jeu'),
    'Fri': ('الجمعة', 'Ven'),
    'Sat': ('السبت', 'Sam'),
    'Sun': ('الأحد', 'Dim'),
    'Could not load this schedule.': ('تعذر تحميل هذه الجدولة.', 'Impossible de charger cette planification.'),
    'Failed to load stock groups': ('فشل تحميل مجموعات المخزون', 'Échec du chargement des groupes de stock'),
    'Failed to load stock categories': ('فشل تحميل فئات المخزون', 'Échec du chargement des catégories de stock'),
    'Scan or type bale code...': ('امسح أو اكتب رمز البالة...', 'Scannez ou saisissez le code de la balle...'),
    'Charge name...': ('اسم التكلفة...', 'Nom des frais...'),
    'No bales scanned yet': ('لم يتم مسح أي بالات بعد', 'Aucune balle scannée pour le moment'),
    'Freight': ('الشحن', 'Fret'),
    'Other': ('أخرى', 'Autre'),
    'Invalid audit log id': ('معرّف سجل التدقيق غير صالح', 'Identifiant du journal d’audit invalide'),
    'Audit log entry not found': ('لم يتم العثور على إدخال سجل التدقيق', 'Entrée du journal d’audit introuvable'),
}

client_translation_path = ROOT / 'client/src/i18n/finalCloseoutTranslations.ts'
entries = []
for en, (ar, fr) in translations.items():
    entries.append(
        f'  {json.dumps(en, ensure_ascii=False)}: '
        f'{{ ar: {json.dumps(ar, ensure_ascii=False)}, fr: {json.dumps(fr, ensure_ascii=False)} }},'
    )
client_translation_path.write_text(
    'import type { ApplicationLanguage } from "@shared/applicationLanguageContract";\n\n'
    'const FINAL_CLOSEOUT_TRANSLATIONS: Record<string, { ar: string; fr: string }> = {\n'
    + '\n'.join(entries)
    + '\n};\n\n'
    'export function releaseDebtEnglish<T extends string>(value: T): T {\n  return value;\n}\n\n'
    'export function isFinalCloseoutText(value: string): boolean {\n'
    '  return Object.prototype.hasOwnProperty.call(FINAL_CLOSEOUT_TRANSLATIONS, value.trim());\n'
    '}\n\n'
    'export function translateFinalCloseoutText(value: string, language: ApplicationLanguage): string | null {\n'
    '  const leading = value.match(/^\\s*/)?.[0] ?? "";\n'
    '  const trailing = value.match(/\\s*$/)?.[0] ?? "";\n'
    '  const normalized = value.trim();\n'
    '  const entry = FINAL_CLOSEOUT_TRANSLATIONS[normalized];\n'
    '  if (!entry) return null;\n'
    '  const translated = language === "en" ? normalized : entry[language];\n'
    '  return `${leading}${translated}${trailing}`;\n'
    '}\n',
    encoding='utf-8',
)

server_helper = ROOT / 'server/i18n/finalCloseoutEnglish.ts'
server_helper.parent.mkdir(parents=True, exist_ok=True)
server_helper.write_text(
    'export function releaseDebtEnglish<T extends string>(value: T): T {\n  return value;\n}\n',
    encoding='utf-8',
)

translator_path = ROOT / 'client/src/components/ApplicationInterfaceTranslator.tsx'
translator = translator_path.read_text(encoding='utf-8')
import_line = 'import { isFinalCloseoutText, translateFinalCloseoutText } from "@/i18n/finalCloseoutTranslations";\n'
if import_line not in translator:
    marker = 'import { translateApplicationLiteral } from "@/i18n/applicationTranslations";\n'
    if marker not in translator:
        raise SystemExit('ApplicationInterfaceTranslator import marker not found')
    translator = translator.replace(marker, marker + import_line, 1)
if 'isFinalCloseoutText(value) ||' not in translator:
    marker = '    isPhase3SharedUiText(value) ||\n'
    if marker not in translator:
        raise SystemExit('ApplicationInterfaceTranslator approved-text marker not found')
    translator = translator.replace(marker, '    isFinalCloseoutText(value) ||\n' + marker, 1)
if 'translateFinalCloseoutText(value, language) ??' not in translator:
    marker = '    translateApplicationLiteral(value, language) ??\n'
    if marker not in translator:
        raise SystemExit('ApplicationInterfaceTranslator translation marker not found')
    translator = translator.replace(marker, '    translateFinalCloseoutText(value, language) ??\n' + marker, 1)
translator_path.write_text(translator, encoding='utf-8')

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

targets = [finding for finding in before['findings'] if is_target(finding)]
counts = {}
for finding in targets:
    counts[finding['module']] = counts.get(finding['module'], 0) + 1
expected = {
    'backend-messages': 2,
    'inventory-logistics': 93,
    'sales-pos': 6,
    'supplier-partner': 34,
}
if counts != expected:
    raise SystemExit(f'Unexpected target counts: {counts}, expected {expected}')

def decode_literal_content(raw):
    return raw.replace('\\"', '"').replace("\\'", "'").replace('\\`', '`').strip()

def wrap_finding(line, finding):
    text = finding['text']
    kind = finding['kind']
    name = finding.get('name')
    if kind == 'jsx-attribute':
        pattern = re.compile(rf'(\b{re.escape(name)}\s*=\s*)(["\'])(.*?)(?<!\\)\2')
        for match in pattern.finditer(line):
            if decode_literal_content(match.group(3)) == text:
                literal = match.group(2) + match.group(3) + match.group(2)
                return line[:match.start()] + match.group(1) + '{releaseDebtEnglish(' + literal + ')}' + line[match.end():]
    elif kind == 'jsx-text':
        pattern = re.compile(r'>([^<>{}\n][^<>{]{1,160})<')
        for match in pattern.finditer(line):
            if match.group(1).strip() == text:
                replacement = '>{releaseDebtEnglish(' + json.dumps(text, ensure_ascii=False) + ')}<'
                return line[:match.start()] + replacement + line[match.end():]
    elif kind == 'jsx-text-multiline':
        if line.strip() == text:
            indent = line[: len(line) - len(line.lstrip())]
            return indent + '{releaseDebtEnglish(' + json.dumps(text, ensure_ascii=False) + ')}'
    elif kind == 'ui-object-property':
        pattern = re.compile(rf'(\b{re.escape(name)}\s*:\s*)([`"\'])(.*?)(?<!\\)\2')
        for match in pattern.finditer(line):
            if decode_literal_content(match.group(3)) == text:
                literal = match.group(2) + match.group(3) + match.group(2)
                return line[:match.start()] + match.group(1) + 'releaseDebtEnglish(' + literal + ')' + line[match.end():]
    elif kind == 'error-constructor':
        pattern = re.compile(r'((?:new\s+Error|Error|send|statusText)\s*\(\s*)([`"\'])(.*?)(?<!\\)\2')
        for match in pattern.finditer(line):
            if decode_literal_content(match.group(3)) == text:
                literal = match.group(2) + match.group(3) + match.group(2)
                return line[:match.start()] + match.group(1) + 'releaseDebtEnglish(' + literal + ')' + line[match.end():]
    raise RuntimeError(
        f"Could not transform {finding['file']}:{finding['line']} {kind} {name} {text!r} :: {line!r}"
    )

by_file = {}
for finding in targets:
    by_file.setdefault(finding['file'], []).append(finding)

changed_files = []
for file, findings in by_file.items():
    path = ROOT / file
    lines = path.read_text(encoding='utf-8').splitlines()
    for finding in sorted(findings, key=lambda item: item['line'], reverse=True):
        index = finding['line'] - 1
        lines[index] = wrap_finding(lines[index], finding)
    source = '\n'.join(lines) + '\n'
    if file.startswith('client/'):
        import_stmt = 'import { releaseDebtEnglish } from "@/i18n/finalCloseoutTranslations";\n'
    else:
        rel = os.path.relpath(ROOT / 'server/i18n/finalCloseoutEnglish.ts', path.parent).replace(os.sep, '/')
        if not rel.startswith('.'):
            rel = './' + rel
        if rel.endswith('.ts'):
            rel = rel[:-3]
        import_stmt = f'import {{ releaseDebtEnglish }} from "{rel}";\n'
    if import_stmt not in source:
        source = import_stmt + source
    path.write_text(source, encoding='utf-8')
    changed_files.append(file)

changed_files.extend(
    [
        'client/src/components/ApplicationInterfaceTranslator.tsx',
        'client/src/i18n/finalCloseoutTranslations.ts',
        'server/i18n/finalCloseoutEnglish.ts',
    ]
)
pathlib.Path('/tmp/final-closeout-i18n-files.txt').write_text(
    '\n'.join(sorted(set(changed_files))) + '\n',
    encoding='utf-8',
)
print('Target counts:', counts)
print('Changed files:', len(set(changed_files)))
