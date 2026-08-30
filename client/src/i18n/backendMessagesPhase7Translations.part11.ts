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
  {
    en: "Stock transfer belongs to a different company",
    ar: "تحويل المخزون يخص شركة أخرى",
    fr: "Le transfert de stock appartient à une autre société",
  },
  {
    en: "Revision item or source location is outside the current company",
    ar: "صنف المراجعة أو موقع المصدر خارج نطاق الشركة الحالية",
    fr: "L’article de la révision ou l’emplacement source se trouve en dehors de la société actuelle",
  },
  {
    en: "Transfer changed while saving the revision. Reload the transfer and try again.",
    ar: "تغيّر التحويل أثناء حفظ المراجعة. أعد تحميل التحويل وحاول مرة أخرى.",
    fr: "Le transfert a changé pendant l’enregistrement de la révision. Rechargez le transfert et réessayez.",
  },
  {
    en: "Revision is stale for item ${result.stockItemId} at source ${result.sourceLocationId}. Expected ${result.expected} or saved value ${result.proposed}, current transfer quantity is ${result.current}.",
    ar: "المراجعة قديمة للصنف {0} في المصدر {1}. المتوقع {2} أو القيمة المحفوظة {3}، وكمية التحويل الحالية هي {4}.",
    fr: "La révision est obsolète pour l’article {0} à la source {1}. Attendu {2} ou valeur enregistrée {3}, la quantité de transfert actuelle est {4}.",
  },
  {
    en: "Failed to save stock transfer revision",
    ar: "فشل حفظ مراجعة تحويل المخزون",
    fr: "Échec de l’enregistrement de la révision du transfert de stock",
  },
  {
    en: "Failed to create stock transfer revision",
    ar: "فشل إنشاء مراجعة تحويل المخزون",
    fr: "Échec de la création de la révision du transfert de stock",
  },
  {
    en: "Password must be at least 6 characters",
    ar: "يجب ألا تقل كلمة المرور عن 6 أحرف",
    fr: "Le mot de passe doit comporter au moins 6 caractères",
  },
  {
    en: "User not found in this company",
    ar: "لم يتم العثور على المستخدم في هذه الشركة",
    fr: "Utilisateur introuvable dans cette société",
  },
  {
    en: "Cannot modify this account",
    ar: "لا يمكن تعديل هذا الحساب",
    fr: "Impossible de modifier ce compte",
  },
  {
    en: "Only Developer can change global user credentials",
    ar: "يمكن للمطور فقط تغيير بيانات اعتماد المستخدم العامة",
    fr: "Seul le Développeur peut modifier les identifiants globaux de l’utilisateur",
  },
  {
    en: "You cannot remove your own account",
    ar: "لا يمكنك إزالة حسابك الخاص",
    fr: "Vous ne pouvez pas supprimer votre propre compte",
  },
  {
    en: "Cannot remove this account",
    ar: "لا يمكن إزالة هذا الحساب",
    fr: "Impossible de supprimer ce compte",
  },
  {
    en: "User access removed from this company",
    ar: "تمت إزالة وصول المستخدم من هذه الشركة",
    fr: "L’accès de l’utilisateur a été supprimé de cette société",
  },
  {
    en: "Browser mutation request contained an invalid Origin or Referer.",
    ar: "احتوى طلب تعديل المتصفح على قيمة Origin أو Referer غير صالحة.",
    fr: "La requête de modification du navigateur contenait un en-tête Origin ou Referer non valide.",
  },
  {
    en: "Article code for grade ${grade} must start with ${targetPrefix}",
    ar: "يجب أن يبدأ رمز الصنف للدرجة {0} بالبادئة {1}",
    fr: "Le code article de la qualité {0} doit commencer par {1}",
  },
  {
    en: "endDate must be a single YYYY-MM-DD value",
    ar: "يجب أن تكون endDate قيمة واحدة بالتنسيق YYYY-MM-DD",
    fr: "endDate doit être une valeur unique au format YYYY-MM-DD",
  },
  {
    en: "startDate must be a single YYYY-MM-DD value",
    ar: "يجب أن تكون startDate قيمة واحدة بالتنسيق YYYY-MM-DD",
    fr: "startDate doit être une valeur unique au format YYYY-MM-DD",
  },
  {
    en: "lang must be a single string value",
    ar: "يجب أن تكون lang قيمة نصية واحدة",
    fr: "lang doit être une chaîne de caractères unique",
  },
  {
    en: "accountType must be a single string value",
    ar: "يجب أن تكون accountType قيمة نصية واحدة",
    fr: "accountType doit être une chaîne de caractères unique",
  },
  {
    en: "stockItemId must be a single positive integer",
    ar: "يجب أن تكون stockItemId عددًا صحيحًا موجبًا واحدًا",
    fr: "stockItemId doit être un entier positif unique",
  },
  {
    en: "locationId must be a single positive integer",
    ar: "يجب أن تكون locationId عددًا صحيحًا موجبًا واحدًا",
    fr: "locationId doit être un entier positif unique",
  },
  {
    en: "Invalid inventory movement date range",
    ar: "نطاق تاريخ حركة المخزون غير صالح",
    fr: "Plage de dates de mouvement de stock invalide",
  },
  {
    en: "stockItemId, year, month must be single integer values",
    ar: "يجب أن تكون stockItemId وyear وmonth قيمًا صحيحة مفردة",
    fr: "stockItemId, year et month doivent être des valeurs entières uniques",
  },
  {
    en: "year must be a valid four-digit year",
    ar: "يجب أن تكون year سنة صالحة من أربعة أرقام",
    fr: "year doit être une année valide à quatre chiffres",
  },
  {
    en: "month must be between 1 and 12",
    ar: "يجب أن تكون month بين 1 و12",
    fr: "month doit être compris entre 1 et 12",
  },
  {
    en: "fromDate and toDate must each be a single YYYY-MM-DD value",
    ar: "يجب أن تكون كل من fromDate وtoDate قيمة واحدة بالتنسيق YYYY-MM-DD",
    fr: "fromDate et toDate doivent chacun être une valeur unique au format YYYY-MM-DD",
  },
  {
    en: "cashAccountId must be a single positive integer",
    ar: "يجب أن تكون cashAccountId عددًا صحيحًا موجبًا واحدًا",
    fr: "cashAccountId doit être un entier positif unique",
  },
];
