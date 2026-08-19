import type { Phase7BackendMessagesEntry } from "./backendMessagesPhase7TranslationTypes";

/** Bandwidth Phases 1–5 messages reviewed during the final integrated verification pass. */
export const backendMessagesPhase7TranslationsPart11: readonly Phase7BackendMessagesEntry[] = [
  {
    en: "Failed to load location summary (${response.status})",
    ar: "فشل تحميل ملخص المواقع ({0})",
    fr: "Échec du chargement du récapitulatif des emplacements ({0})",
  },
  {
    en: "groupId is required for profile=group",
    ar: "groupId مطلوب عندما يكون profile=group",
    fr: "groupId est requis lorsque profile=group",
  },
  {
    en: "Stock group not found",
    ar: "لم يتم العثور على مجموعة المخزون",
    fr: "Groupe de stock introuvable",
  },
  {
    en: "Barcode code is required",
    ar: "رمز الباركود مطلوب",
    fr: "Le code-barres est requis",
  },
  {
    en: "Barcode code is too long",
    ar: "رمز الباركود طويل جدًا",
    fr: "Le code-barres est trop long",
  },
  {
    en: "format must be svg or png",
    ar: "يجب أن يكون التنسيق svg أو png",
    fr: "Le format doit être svg ou png",
  },
  {
    en: "Invalid section",
    ar: "قسم غير صالح",
    fr: "Section invalide",
  },
  {
    en: "Invalid productId",
    ar: "معرّف المنتج غير صالح",
    fr: "productId invalide",
  },
  {
    en: "No location found for this user",
    ar: "لم يتم العثور على موقع لهذا المستخدم",
    fr: "Aucun emplacement trouvé pour cet utilisateur",
  },
  {
    en: "Location not found",
    ar: "لم يتم العثور على الموقع",
    fr: "Emplacement introuvable",
  },
  {
    en: "No WhatsApp group configured for this location",
    ar: "لم يتم إعداد مجموعة واتساب لهذا الموقع",
    fr: "Aucun groupe WhatsApp configuré pour cet emplacement",
  },
  {
    en: "PDF pagination error detected: ${pageCount} pages generated for ${rowCount} stock items (expected ≤${maxAllowedPages}). Report not sent to WhatsApp.",
    ar: "تم اكتشاف خطأ في تقسيم صفحات PDF: تم إنشاء {0} صفحة لـ {1} عنصر مخزون (المتوقع ≤{2}). لم يتم إرسال التقرير إلى واتساب.",
    fr: "Erreur de pagination PDF détectée : {0} pages générées pour {1} articles en stock (≤{2} attendu). Le rapport n’a pas été envoyé sur WhatsApp.",
  },
  {
    en: "voucherId is required",
    ar: "voucherId مطلوب",
    fr: "voucherId est requis",
  },
  {
    en: "Invalid voucherId",
    ar: "voucherId غير صالح",
    fr: "voucherId invalide",
  },
  {
    en: "Voucher has no location",
    ar: "القسيمة ليس لها موقع",
    fr: "Le bon n’a aucun emplacement",
  },
  {
    en: "PDF generation failed: invalid or empty PDF",
    ar: "فشل إنشاء PDF: الملف غير صالح أو فارغ",
    fr: "Échec de génération du PDF : PDF invalide ou vide",
  },
  {
    en: "PDF page count (${pageCount}) is excessive for ${itemCount} items — aborting WhatsApp send",
    ar: "عدد صفحات PDF ({0}) كبير جدًا بالنسبة إلى {1} عنصر — تم إيقاف الإرسال عبر واتساب",
    fr: "Le nombre de pages PDF ({0}) est excessif pour {1} articles — envoi WhatsApp annulé",
  },
  {
    en: "pdfBase64 is required",
    ar: "pdfBase64 مطلوب",
    fr: "pdfBase64 est requis",
  },
  {
    en: "locationId is required",
    ar: "locationId مطلوب",
    fr: "locationId est requis",
  },
  {
    en: "No WhatsApp target configured for this account",
    ar: "لم يتم إعداد وجهة واتساب لهذا الحساب",
    fr: "Aucune destination WhatsApp configurée pour ce compte",
  },
  {
    en: "Green API blocked this WhatsApp group because the configured Developer plan has reached its monthly chat limit. The ERP also tried its fallback delivery path. Configure/upgrade an instance that is allowed to message this group.",
    ar: "حظرت Green API مجموعة واتساب هذه لأن خطة المطور المهيأة وصلت إلى حد المحادثات الشهري. حاول نظام ERP أيضًا مسار الإرسال الاحتياطي. قم بتهيئة أو ترقية مثيل مسموح له بمراسلة هذه المجموعة.",
    fr: "Green API a bloqué ce groupe WhatsApp car le forfait Developer configuré a atteint sa limite mensuelle de conversations. L’ERP a également essayé le mode d’envoi de secours. Configurez ou mettez à niveau une instance autorisée à envoyer des messages à ce groupe.",
  },
  {
    en: "Green API monthly quota has been reached. The ERP also tried its fallback delivery path, but the provider still blocked the send.",
    ar: "تم بلوغ الحصة الشهرية لـ Green API. حاول نظام ERP أيضًا مسار الإرسال الاحتياطي، لكن المزود ما زال يمنع الإرسال.",
    fr: "Le quota mensuel de Green API a été atteint. L’ERP a également essayé le mode d’envoi de secours, mais le fournisseur bloque toujours l’envoi.",
  },
  {
    en: "Invalid companyId in request path.",
    ar: "معرّف الشركة غير صالح في مسار الطلب.",
    fr: "Identifiant de société invalide dans le chemin de la requête.",
  },
  {
    en: 'Container "${containerNumber}" already has ${existingPOs.length} PO(s) imported (${existingPOs.map((p) => p.poNumber).join(", ")}). To avoid duplicates, please delete the existing POs first or use a different container number.',
    ar: "تحتوي الحاوية «{0}» بالفعل على {1} أمر شراء مستورد ({2}). لتجنب التكرار، احذف أوامر الشراء الحالية أولاً أو استخدم رقم حاوية مختلفًا.",
    fr: "Le conteneur « {0} » contient déjà {1} bon(s) de commande importé(s) ({2}). Pour éviter les doublons, supprimez d’abord les bons existants ou utilisez un autre numéro de conteneur.",
  },
  {
    en: "startDate cannot be after endDate",
    ar: "لا يمكن أن يكون تاريخ البدء بعد تاريخ الانتهاء",
    fr: "La date de début ne peut pas être postérieure à la date de fin",
  },
  {
    en: "Statement PDF generation returned an invalid or empty PDF buffer",
    ar: "أعاد إنشاء كشف الحساب PDF ملف PDF غير صالح أو فارغ",
    fr: "La génération du relevé PDF a renvoyé un PDF invalide ou vide",
  },
];
