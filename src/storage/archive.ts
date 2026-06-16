import { migrateAppData } from "../domain/seed";
import type { AppData, EvidenceItem } from "../domain/types";

export interface ArchiveEvidenceFile {
  evidenceId: string;
  path: string;
  fileName: string;
  mimeType?: string | undefined;
  sizeBytes: number;
}

export interface ParsedArchive {
  data: AppData;
  files: Array<ArchiveEvidenceFile & { blob: Blob }>;
}

interface TarEntry {
  name: string;
  blob: Blob;
}

interface ParsedTarEntry {
  name: string;
  bytes: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BLOCK_SIZE = 512;
const DATA_FILE = "sojourn-data.json";
const MANIFEST_FILE = "sojourn-manifest.json";

const extensionFor = (item: EvidenceItem): string => {
  const source = item.fileName ?? "";
  const match = /(\.[A-Za-z0-9]{1,8})$/.exec(source);
  if (match?.[1]) {
    return match[1].toLowerCase();
  }
  if (item.mimeType === "application/pdf") {
    return ".pdf";
  }
  if (item.mimeType === "image/png") {
    return ".png";
  }
  if (item.mimeType === "image/jpeg") {
    return ".jpg";
  }
  return "";
};

const sanitizeName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "evidence";

export const archiveFileNameForEvidence = (item: EvidenceItem): string =>
  `${item.type}_${sanitizeName(item.title || item.fileName || item.id)}_${sanitizeName(item.id)}${extensionFor(item)}`;

const writeString = (target: Uint8Array, offset: number, length: number, value: string): void => {
  const bytes = encoder.encode(value).slice(0, length);
  target.set(bytes, offset);
};

const writeOctal = (target: Uint8Array, offset: number, length: number, value: number): void => {
  const text = value.toString(8).padStart(length - 1, "0");
  writeString(target, offset, length - 1, text);
  target[offset + length - 1] = 0;
};

const checksum = (header: Uint8Array): number =>
  header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);

const headerFor = (name: string, size: number): Uint8Array => {
  const header = new Uint8Array(BLOCK_SIZE);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(32, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");
  writeOctal(header, 148, 8, checksum(header));
  return header;
};

const paddedLength = (size: number): number => Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

const bytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

export const blobToArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read file bytes."));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read file.")));
    reader.readAsArrayBuffer(blob);
  });
};

const makeEntry = async (entry: TarEntry): Promise<BlobPart[]> => {
  const buffer = await blobToArrayBuffer(entry.blob);
  const bytes = new Uint8Array(buffer);
  const padded = new Uint8Array(paddedLength(bytes.length));
  padded.set(bytes);
  return [bytesToArrayBuffer(headerFor(entry.name, bytes.length)), bytesToArrayBuffer(padded)];
};

export const createArchive = async (
  data: AppData,
  getFile: (item: EvidenceItem) => Promise<Blob | undefined>
): Promise<Blob> => {
  const manifestFiles: ArchiveEvidenceFile[] = [];
  const entries: TarEntry[] = [];
  const nextData: AppData = {
    ...data,
    evidence: data.evidence.map((item) => ({ ...item }))
  };

  for (const item of nextData.evidence) {
    const blob = await getFile(item);
    if (!blob) {
      continue;
    }
    const fileName = archiveFileNameForEvidence(item);
    const path = `evidence/${fileName}`;
    item.fileName = fileName;
    item.mimeType = item.mimeType ?? blob.type;
    item.sizeBytes = blob.size;
    manifestFiles.push({
      evidenceId: item.id,
      path,
      fileName,
      ...(item.mimeType ? { mimeType: item.mimeType } : {}),
      sizeBytes: blob.size
    });
    entries.push({ name: path, blob });
  }

  entries.unshift({
    name: MANIFEST_FILE,
    blob: new Blob([JSON.stringify({ version: 1, files: manifestFiles }, null, 2)], {
      type: "application/json"
    })
  });
  entries.unshift({
    name: DATA_FILE,
    blob: new Blob([JSON.stringify(nextData, null, 2)], { type: "application/json" })
  });

  const parts: BlobPart[] = [];
  for (const entry of entries) {
    parts.push(...(await makeEntry(entry)));
  }
  parts.push(new ArrayBuffer(BLOCK_SIZE), new ArrayBuffer(BLOCK_SIZE));
  return new Blob(parts, { type: "application/x-tar" });
};

const parseOctal = (bytes: Uint8Array): number => {
  const text = decoder
    .decode(bytes)
    .replace(/\0.*$/u, "")
    .trim();
  return text ? Number.parseInt(text, 8) : 0;
};

const isEmptyBlock = (bytes: Uint8Array): boolean => bytes.every((value) => value === 0);

const parseTar = async (blob: Blob): Promise<ParsedTarEntry[]> => {
  const bytes = new Uint8Array(await blobToArrayBuffer(blob));
  const entries: ParsedTarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK_SIZE <= bytes.length) {
    const header = bytes.slice(offset, offset + BLOCK_SIZE);
    if (isEmptyBlock(header)) {
      break;
    }
    const name = decoder.decode(header.slice(0, 100)).replace(/\0.*$/u, "");
    const size = parseOctal(header.slice(124, 136));
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    entries.push({ name, bytes: bytes.slice(dataStart, dataEnd) });
    offset = dataStart + paddedLength(size);
  }
  return entries;
};

export const parseArchive = async (blob: Blob): Promise<ParsedArchive> => {
  const entries = await parseTar(blob);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const dataEntry = byName.get(DATA_FILE);
  if (!dataEntry) {
    throw new Error("Archive does not contain Sojourn data.");
  }
  const data = migrateAppData(JSON.parse(decoder.decode(dataEntry.bytes)) as AppData);
  const manifestEntry = byName.get(MANIFEST_FILE);
  const manifest = manifestEntry
    ? (JSON.parse(decoder.decode(manifestEntry.bytes)) as { files?: ArchiveEvidenceFile[] })
    : { files: [] };
  const files = (manifest.files ?? [])
    .map((file) => {
      const entry = byName.get(file.path);
      if (!entry) {
        return undefined;
      }
      return {
        ...file,
        blob: new Blob([bytesToArrayBuffer(entry.bytes)], {
          type: file.mimeType ?? "application/octet-stream"
        })
      };
    })
    .filter((file): file is ArchiveEvidenceFile & { blob: Blob } => file !== undefined);
  return { data, files };
};
