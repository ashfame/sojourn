import {
  deleteAttachmentBlob as deleteIndexedDbAttachmentBlob,
  getAttachmentBlob as getIndexedDbAttachmentBlob,
  putAttachmentBlob
} from "./indexedDb";

export interface StoredAttachmentLocation {
  backend: "opfs" | "indexeddb";
  key: string;
}

const attachmentFilename = (sha256: string): string => `${sha256}.blob`;

const opfsAvailable = (): boolean =>
  typeof navigator !== "undefined" &&
  typeof navigator.storage?.getDirectory === "function";

const getAttachmentDirectory = async (): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("residency-days-attachments", { create: true });
};

export const storeAttachmentBlob = async (
  blob: Blob,
  sha256: string
): Promise<StoredAttachmentLocation> => {
  const key = `attachments/${sha256}`;
  if (opfsAvailable()) {
    try {
      const directory = await getAttachmentDirectory();
      const handle = await directory.getFileHandle(attachmentFilename(sha256), {
        create: true
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return {
        backend: "opfs",
        key
      };
    } catch (error) {
      console.warn("OPFS attachment write failed; falling back to IndexedDB.", error);
    }
  }

  await putAttachmentBlob(key, blob, sha256);
  return {
    backend: "indexeddb",
    key
  };
};

export const getAttachmentBlob = async (
  backend: "opfs" | "indexeddb",
  key: string
): Promise<Blob | undefined> => {
  if (backend === "opfs" && opfsAvailable()) {
    try {
      const sha256 = key.split("/").at(-1);
      if (!sha256) {
        return undefined;
      }
      const directory = await getAttachmentDirectory();
      const handle = await directory.getFileHandle(attachmentFilename(sha256));
      return handle.getFile();
    } catch {
      return undefined;
    }
  }

  return getIndexedDbAttachmentBlob(key);
};

export const deleteAttachmentBlob = async (
  backend: "opfs" | "indexeddb",
  key: string
): Promise<void> => {
  if (backend === "opfs" && opfsAvailable()) {
    try {
      const sha256 = key.split("/").at(-1);
      if (sha256) {
        const directory = await getAttachmentDirectory();
        await directory.removeEntry(attachmentFilename(sha256));
      }
      return;
    } catch {
      return;
    }
  }

  await deleteIndexedDbAttachmentBlob(key);
};

export const clearOpfsAttachments = async (): Promise<void> => {
  if (!opfsAvailable()) {
    return;
  }
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("residency-days-attachments", { recursive: true });
  } catch {
    // Missing OPFS attachment directory is already the desired state.
  }
};
