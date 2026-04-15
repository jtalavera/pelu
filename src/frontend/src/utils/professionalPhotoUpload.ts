/**
 * HU-20: professional profile photo — allowed web formats, size, and pixel limits.
 * Allowed types: JPEG, PNG, WebP, GIF (by file extension and MIME; picker uses accept=…).
 */

export const PROFESSIONAL_PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";

export const MAX_PROFESSIONAL_PHOTO_BYTES = 5 * 1024 * 1024;

/** Each side must be at most this many pixels (width and height). */
export const MAX_PROFESSIONAL_PHOTO_SIDE_PX = 500;

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"] as const;

export type ProfessionalPhotoValidationErrorCode =
  | "EXTENSION_INVALID"
  | "FILE_TOO_LARGE"
  | "DIMENSIONS_TOO_LARGE"
  | "IMAGE_LOAD_FAILED";

export function isAllowedProfessionalPhotoExtension(fileName: string): boolean {
  const n = fileName.trim().toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => n.endsWith(ext));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") {
        resolve(r);
      } else {
        reject(new Error("READ"));
      }
    };
    reader.onerror = () => reject(new Error("READ"));
    reader.readAsDataURL(file);
  });
}

function measureImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error("IMAGE"));
    img.src = dataUrl;
  });
}

export type ProfessionalPhotoResult =
  | { ok: true; dataUrl: string }
  | { ok: false; code: ProfessionalPhotoValidationErrorCode };

/**
 * Validates extension (by file name), file size, and dimensions; returns a data URL for the API.
 */
export async function validateAndReadProfessionalPhotoFile(file: File): Promise<ProfessionalPhotoResult> {
  if (!isAllowedProfessionalPhotoExtension(file.name)) {
    return { ok: false, code: "EXTENSION_INVALID" };
  }
  if (file.size > MAX_PROFESSIONAL_PHOTO_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE" };
  }
  let dataUrl: string;
  try {
    dataUrl = await readFileAsDataUrl(file);
  } catch {
    return { ok: false, code: "IMAGE_LOAD_FAILED" };
  }
  try {
    const { width, height } = await measureImageDimensions(dataUrl);
    if (width > MAX_PROFESSIONAL_PHOTO_SIDE_PX || height > MAX_PROFESSIONAL_PHOTO_SIDE_PX) {
      return { ok: false, code: "DIMENSIONS_TOO_LARGE" };
    }
  } catch {
    return { ok: false, code: "IMAGE_LOAD_FAILED" };
  }
  return { ok: true, dataUrl };
}
