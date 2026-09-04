  function text(value) {
    return String(value || "").trim();
  }

  function normalizedName(value) {
    return text(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function number(value, fallback = 0) {
    const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function dateIso(value) {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }

  // Source layer: content-store refs for the preserved original image(s). Kept
  // separate from the parsed data so the source document survives corrections.
  function normalizeImageRefs(refs) {
    if (!Array.isArray(refs)) return [];
    return refs
      .map((ref, i) => {
        if (typeof ref === "string") return { index: i, hash: text(ref), size: 0, mimeType: "image/jpeg", cloud: null };
        if (!ref || typeof ref !== "object") return null;
        const cloud = ref.cloud && typeof ref.cloud === "object"
          ? { bucket: text(ref.cloud.bucket), path: text(ref.cloud.path) }
          : null;
        return {
          index: Number.isFinite(Number(ref.index)) ? Number(ref.index) : i,
          hash: text(ref.hash),
          size: Math.max(0, number(ref.size)),
          mimeType: text(ref.mimeType) || "image/jpeg",
          cloud: cloud && cloud.bucket && cloud.path ? cloud : null,
        };
      })
      .filter((r) => r && (r.hash || r.cloud));
  }

  // Extraction layer: what engine produced the parse + its raw output, kept
  // INDEPENDENT of the interpretation so parsing can improve later (re-parse the
  // raw output / re-run on the preserved image) without rescanning.
  function normalizeExtraction(extraction) {
    if (!extraction || typeof extraction !== "object") return null;
    return {
      engine: text(extraction.engine),
      model: text(extraction.model),
      kind: text(extraction.kind) || "receipt",
      rawOutput: text(extraction.rawOutput),
      extractedAt: text(extraction.extractedAt),
      status: text(extraction.status) || "ok",
      confidence: Math.min(1, Math.max(0, number(extraction.confidence, 0))),
    };
  }

  function normalizeReceipt(receipt, createId = defaultId) {
    const receiptId = text(receipt?.id) || createId("receipt");
    const purchaseDate = dateIso(receipt?.purchaseDate || receipt?.date) || new Date().toISOString().slice(0, 10);
    const lineItems = (Array.isArray(receipt?.lineItems) ? receipt.lineItems : [])
      .map((line) => normalizeReceiptLineItem(line, receiptId, createId))
      .filter((line) => line.rawText || line.normalizedName);
return {
      id: receiptId,
      storeName: text(receipt?.storeName || receipt?.store),
      storeId: text(receipt?.storeId),
      purchaseDate,
      subtotal: number(receipt?.subtotal),
      tax: number(receipt?.tax),
      fees: number(receipt?.fees),
      discounts: number(receipt?.discounts),
      total: number(receipt?.total),
      imageUrl: text(receipt?.imageUrl),
      fileRef: text(receipt?.fileRef),
      imageRefs: normalizeImageRefs(receipt?.imageRefs),
      extraction: normalizeExtraction(receipt?.extraction),
      createdAt: text(receipt?.createdAt) || new Date().toISOString(),
      lineItems
    };
  }

  function normalizeReceiptLineItem(line, receiptId, createId = defaultId) {
    const quantity = Math.max(0, number(line?.quantity, 1));
    const totalPrice = number(line?.totalPrice ?? line?.price);
    // Derive unitPrice from total/qty whenever a real one wasn't provided. (number()
    // can't fall back here: an absent/empty unitPrice parses to 0, which is finite —
    // so a missing unitPrice must be detected explicitly, not via the fallback arg.)
    const providedUnitPrice = number(line?.unitPrice);
    const unitPrice = providedUnitPrice > 0
      ? providedUnitPrice
      : (quantity > 0 ? totalPrice / quantity : totalPrice);
return {
      id: text(line?.id) || createId("receipt-line"),
      receiptId,
      rawText: text(line?.rawText || line?.text || line?.name),
      normalizedName: text(line?.normalizedName || line?.itemName || line?.name),
      category: text(line?.category),
      quantity: quantity || 1,
      unit: text(line?.unit || "each").toLowerCase(),
      totalPrice,
      unitPrice,
      discountAmount: Math.max(0, number(line?.discountAmount || line?.discount)),
      confidenceScore: Math.min(1, Math.max(0, number(line?.confidenceScore, 0.7))),
      userCorrected: Boolean(line?.userCorrected)
    };
  }

  // Lightweight, PURE validation to steer the reviewer (never blocks saving).
  // Arithmetic reconciliation + per-line flags. The receipt TOTAL is treated as the
  // ground truth to reconcile against; tolerance is the greater of an absolute floor
  // and ±0.5% of the total (rounding/rounding-per-line noise).
  function validateReceipt(receipt, options = {}) {
    const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 0.02;
    const round2 = (n) => Math.round(n * 100) / 100;
    const lines = Array.isArray(receipt?.lineItems) ? receipt.lineItems : [];
    const subtotal = number(receipt?.subtotal);
    const tax = number(receipt?.tax);
    const fees = number(receipt?.fees);
    const discounts = number(receipt?.discounts);
    const total = number(receipt?.total);
    const lineSum = round2(lines.reduce((sum, line) => sum + number(line?.totalPrice), 0));
    const computedTotal = round2(subtotal + tax + fees - discounts);
    const subtotalDelta = round2(lineSum - subtotal);
    const totalDelta = round2(computedTotal - total);
    const tol = Math.max(tolerance, Math.abs(total) * 0.005);
    const subtotalReconciles = subtotal === 0 || Math.abs(subtotalDelta) <= tol;
    const reconciles = total === 0 || Math.abs(totalDelta) <= tol;

    const flags = [];
    if (total > 0 && !reconciles) {
      flags.push({ type: "totals-mismatch", delta: totalDelta, message: `Subtotal + tax + fees − discounts (${computedTotal.toFixed(2)}) doesn't match the total (${total.toFixed(2)}).` });
    }
    if (subtotal > 0 && !subtotalReconciles) {
      flags.push({ type: "subtotal-mismatch", delta: subtotalDelta, message: `Line items add to ${lineSum.toFixed(2)} but the subtotal says ${subtotal.toFixed(2)}.` });
    }
    const seen = new Set();
    lines.forEach((line) => {
      const name = text(line?.normalizedName || line?.rawText) || "This line";
      const price = number(line?.totalPrice);
      const qty = number(line?.quantity, 1);
      if (price === 0 && number(line?.discountAmount) === 0) flags.push({ type: "missing-price", lineId: line?.id, message: `${name} has no price.` });
      if (price < 0) flags.push({ type: "negative-line", lineId: line?.id, message: `${name} has a negative price — a discount or refund?` });
      if (qty <= 0) flags.push({ type: "bad-quantity", lineId: line?.id, message: `${name} has quantity ${line?.quantity}.` });
      if (number(line?.confidenceScore, 1) < 0.6 && !line?.userCorrected) flags.push({ type: "low-confidence", lineId: line?.id, message: `${name} was read with low confidence.` });
      const key = `${normalizedName(line?.rawText)}|${price}`;
      if (normalizedName(line?.rawText) && price !== 0) {
        if (seen.has(key)) flags.push({ type: "duplicate", lineId: line?.id, message: `${name} looks like a duplicate line.` });
        else seen.add(key);
      }
    });

    return { reconciles, subtotalReconciles, lineSum, computedTotal, subtotalDelta, totalDelta, flags };
  }

  function normalizeMappings(mappings) {
    const result = {};
    Object.entries(mappings && typeof mappings === "object" ? mappings : {}).forEach(([raw, mapping]) => {
      const key = normalizedName(raw);
      const name = text(mapping?.normalizedName || mapping?.name || mapping);
      if (!key || !name) return;
      result[key] = {
        normalizedName: name,
        category: text(mapping?.category)
      };
    });
    return result;
  }

  function applyReceiptMappings(receipt, mappings) {
    const normalizedMappings = normalizeMappings(mappings);
return {
      ...receipt,
      lineItems: receipt.lineItems.map((line) => {
        const mapping = normalizedMappings[normalizedName(line.rawText)];
        if (!mapping) return line;
return {
          ...line,
          normalizedName: mapping.normalizedName,
          category: mapping.category || line.category
        };
      })
    };
  }

  function correctedMappingsFromReceipt(receipt, existing = {}) {
    const mappings = { ...normalizeMappings(existing) };
    receipt.lineItems.forEach((line) => {
      if (!line.userCorrected || !line.normalizedName) return;
      const key = normalizedName(line.rawText);
      if (!key) return;
      mappings[key] = {
        normalizedName: line.normalizedName,
        category: line.category || ""
      };
    });
    return mappings;
  }

  function priceHistoryFromReceipt(receipt, createId = defaultId) {
    return receipt.lineItems
      .filter((line) => line.normalizedName && line.totalPrice > 0)
      .map((line) => ({
        id: createId("price-history"),
        storeId: receipt.storeId,
        storeName: receipt.storeName,
        normalizedItemName: line.normalizedName,
        category: line.category,
        unitPrice: line.unitPrice,
        packagePrice: line.totalPrice,
        quantity: line.quantity,
        unit: line.unit,
        observedAt: receipt.purchaseDate,
        sourceReceiptLineItemId: line.id,
        source: "receipt",
        confidenceScore: line.userCorrected ? 1 : line.confidenceScore
      }));
  }

  function estimateFromHistory(history, itemName, storeId = "", maxAgeDays = 365) {
    const key = normalizedName(itemName);
    const cutoff = Date.now() - maxAgeDays * 86400000;
    const matches = (Array.isArray(history) ? history : [])
      .filter((entry) => normalizedName(entry.normalizedItemName) === key)
      .filter((entry) => !storeId || entry.storeId === storeId)
      .filter((entry) => new Date(entry.observedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt));
    return matches[0] || null;
  }

  function trendForItem(history, itemName, storeId = "") {
    const key = normalizedName(itemName);
    return (Array.isArray(history) ? history : [])
      .filter((entry) => normalizedName(entry.normalizedItemName) === key)
      .filter((entry) => !storeId || entry.storeId === storeId)
      .sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
  }

  function estimateGroceryListFromHistory(items, history, storeIds = []) {
    return (Array.isArray(items) ? items : []).map((item) => {
      const estimates = (Array.isArray(storeIds) ? storeIds : [])
        .map((storeId) => estimateFromHistory(history, item.name || item.item, storeId))
        .filter(Boolean)
        .sort((a, b) => a.packagePrice - b.packagePrice);
return {
        ...item,
        estimates,
        bestEstimate: estimates[0] || null
      };
    });
  }

  function defaultId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

export {
    normalizeReceipt,
    normalizeReceiptLineItem,
    validateReceipt,
    normalizeMappings,
    applyReceiptMappings,
    correctedMappingsFromReceipt,
    priceHistoryFromReceipt,
    estimateFromHistory,
    estimateGroceryListFromHistory,
    trendForItem,
    normalizedName
  };
