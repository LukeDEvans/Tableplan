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
      createdAt: text(receipt?.createdAt) || new Date().toISOString(),
      lineItems
    };
  }

  function normalizeReceiptLineItem(line, receiptId, createId = defaultId) {
    const quantity = Math.max(0, number(line?.quantity, 1));
    const totalPrice = number(line?.totalPrice ?? line?.price);
    const unitPrice = number(line?.unitPrice, quantity > 0 ? totalPrice / quantity : totalPrice);
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

module.exports = {
    normalizeReceipt,
    normalizeReceiptLineItem,
    normalizeMappings,
    applyReceiptMappings,
    correctedMappingsFromReceipt,
    priceHistoryFromReceipt,
    estimateFromHistory,
    estimateGroceryListFromHistory,
    trendForItem,
    normalizedName
  };
