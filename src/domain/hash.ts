const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (input: string | Blob | ArrayBuffer): Promise<string> => {
  let bytes: ArrayBuffer;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input).buffer;
  } else if (input instanceof Blob) {
    bytes = await input.arrayBuffer();
  } else {
    bytes = input;
  }

  return toHex(await crypto.subtle.digest("SHA-256", bytes));
};

export const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item !== "object") {
      return item;
    }
    if (seen.has(item)) {
      throw new Error("Cannot stringify circular structure.");
    }
    seen.add(item);
    if (Array.isArray(item)) {
      return item.map(normalize);
    }
    return Object.fromEntries(
      Object.entries(item)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, normalize(nested)])
    );
  };

  return JSON.stringify(normalize(value));
};
