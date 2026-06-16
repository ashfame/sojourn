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

interface ZipEntry {
  name: string;
  blob: Blob;
}

interface ParsedZipEntry {
  name: string;
  bytes: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DATA_FILE = "sojourn-data.json";
const MANIFEST_FILE = "sojourn-manifest.json";
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_VERSION_STORED = 20;
const ZIP_METHOD_STORED = 0;
const DOS_DATE_1980_01_01 = 0x21;
const MAX_UINT_16 = 0xffff;
const MAX_UINT_32 = 0xffffffff;

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

export const blobToText = async (blob: Blob): Promise<string> => {
  if (typeof blob.text === "function") {
    return blob.text();
  }
  return decoder.decode(await blobToArrayBuffer(blob));
};

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

const crc32 = (bytes: Uint8Array): number => {
  let crc = MAX_UINT_32;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ MAX_UINT_32) >>> 0;
};

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);

const writeLocalHeader = (
  nameBytes: Uint8Array,
  dataBytes: Uint8Array,
  checksum: number
): Uint8Array => {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, ZIP_LOCAL_FILE_HEADER, true);
  view.setUint16(4, ZIP_VERSION_STORED, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, ZIP_METHOD_STORED, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, DOS_DATE_1980_01_01, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, dataBytes.length, true);
  view.setUint32(22, dataBytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  return header;
};

const writeCentralDirectoryHeader = (
  nameBytes: Uint8Array,
  dataBytes: Uint8Array,
  checksum: number,
  localHeaderOffset: number
): Uint8Array => {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, ZIP_CENTRAL_DIRECTORY_HEADER, true);
  view.setUint16(4, ZIP_VERSION_STORED, true);
  view.setUint16(6, ZIP_VERSION_STORED, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, ZIP_METHOD_STORED, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, DOS_DATE_1980_01_01, true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, dataBytes.length, true);
  view.setUint32(24, dataBytes.length, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localHeaderOffset, true);
  return header;
};

const writeEndOfCentralDirectory = (
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number
): Uint8Array => {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);
  return header;
};

const validateZipEntry = (nameBytes: Uint8Array, dataBytes: Uint8Array): void => {
  if (nameBytes.length > MAX_UINT_16) {
    throw new Error("Archive file name is too long.");
  }
  if (dataBytes.length > MAX_UINT_32) {
    throw new Error("Archive file is too large.");
  }
};

const createZip = async (entries: ZipEntry[]): Promise<Blob> => {
  if (entries.length > MAX_UINT_16) {
    throw new Error("Archive contains too many files.");
  }

  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let offset = 0;
  let centralDirectorySize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = new Uint8Array(await blobToArrayBuffer(entry.blob));
    validateZipEntry(nameBytes, dataBytes);

    const checksum = crc32(dataBytes);
    const localHeader = writeLocalHeader(nameBytes, dataBytes, checksum);
    const centralHeader = writeCentralDirectoryHeader(nameBytes, dataBytes, checksum, offset);

    localParts.push(
      bytesToArrayBuffer(localHeader),
      bytesToArrayBuffer(nameBytes),
      bytesToArrayBuffer(dataBytes)
    );
    centralParts.push(bytesToArrayBuffer(centralHeader), bytesToArrayBuffer(nameBytes));
    offset += localHeader.length + nameBytes.length + dataBytes.length;
    centralDirectorySize += centralHeader.length + nameBytes.length;
  }

  const centralDirectoryOffset = offset;
  return new Blob(
    [
      ...localParts,
      ...centralParts,
      bytesToArrayBuffer(
        writeEndOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset)
      )
    ],
    { type: "application/zip" }
  );
};

export const createArchive = async (
  data: AppData,
  getFile: (item: EvidenceItem) => Promise<Blob | undefined>
): Promise<Blob> => {
  const manifestFiles: ArchiveEvidenceFile[] = [];
  const entries: ZipEntry[] = [];
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

  return createZip(entries);
};

const findEndOfCentralDirectory = (bytes: Uint8Array): number => {
  const minOffset = Math.max(0, bytes.length - MAX_UINT_16 - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(bytes, offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new Error("Archive is not a ZIP file.");
};

const parseZip = async (blob: Blob): Promise<ParsedZipEntry[]> => {
  const bytes = new Uint8Array(await blobToArrayBuffer(blob));
  const endOffset = findEndOfCentralDirectory(bytes);
  const entryCount = readUint16(bytes, endOffset + 10);
  let directoryOffset = readUint32(bytes, endOffset + 16);
  const entries: ParsedZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(bytes, directoryOffset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error("Archive central directory is invalid.");
    }
    const method = readUint16(bytes, directoryOffset + 10);
    if (method !== ZIP_METHOD_STORED) {
      throw new Error("Compressed ZIP archives are not supported yet.");
    }
    const compressedSize = readUint32(bytes, directoryOffset + 20);
    const nameLength = readUint16(bytes, directoryOffset + 28);
    const extraLength = readUint16(bytes, directoryOffset + 30);
    const commentLength = readUint16(bytes, directoryOffset + 32);
    const localHeaderOffset = readUint32(bytes, directoryOffset + 42);
    const nameStart = directoryOffset + 46;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));

    if (readUint32(bytes, localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
      throw new Error("Archive local file header is invalid.");
    }
    const localNameLength = readUint16(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16(bytes, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    entries.push({
      name,
      bytes: bytes.slice(dataStart, dataStart + compressedSize)
    });
    directoryOffset = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
};

export const parseArchive = async (blob: Blob): Promise<ParsedArchive> => {
  const entries = await parseZip(blob);
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
